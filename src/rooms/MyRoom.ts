import { Room, Client, CloseCode, type StepContext } from "colyseus";
import { MyRoomState, Player, Orb, MoveInput } from "./schema/MyRoomState.js";
import { freeRoomCode, assertRoomCapacity } from "./roomCode.js";
import { InputPacer } from "./inputPacing.js";
import { stepEntity } from "../shared/movement.js";
import { TICK_RATE, PLAYER_HALF, TAG_COOLDOWN, ROUND_END_PAUSE, READY_LOCK, PETS } from "../shared/constants.js";
import { ARENAS, arenaOf, type Arena } from "../shared/arenas.js";
import { MODES, modeOf, ORB_REACH, ORB_HEIGHT } from "../shared/modes.js";
import { sanitizeName } from "../shared/names.js";
import { navFor } from "./botNav.js";

/** Public rooms are topped up with bots to this many players, so nobody waits alone: a lone player gets four bots, and each human who joins sends one home. */
const BOT_FILL = 5;
/** Seconds a bot chases one player without tagging them before it goes after someone else. */
const CHASE_GIVE_UP = 8;
/** Seconds before the first bot joins a lonely player, then between the rest. */
const BOT_FIRST_DELAY = 6;
const BOT_NEXT_DELAY = 2;
/** Seconds after a tag during which the player who was just tagged cannot be tagged straight back. */
const TAG_BACK_BLOCK = 2;
const IDLE_INPUT = { moveX: 0, moveY: 0, jump: 0 };
const BOT_NAMES = ["Pip", "Moss", "Dot", "Bolt", "Zig", "Fizz", "Nova", "Taco"];

/**
 * How good a bot is. `react`: seconds between re-aims. `idle`: chance of pausing at a re-aim. `slip`: chance of a wrong
 * turn lasting half a second. `juke`: chance, at each re-aim with a chaser close, of a quick sidestep. `lead`: seconds ahead of a runner it aims. Every bot moves at the same speed as a player.
 */
const SKILLS = [
  { react: [0.3, 0.5], idle: 0.05, slip: 0.08, lead: 0, juke: 0 },          // sloppy
  { react: [0.2, 0.32], idle: 0.02, slip: 0.03, lead: 0.15, juke: 0.03 },   // steady
  { react: [0.12, 0.2], idle: 0.005, slip: 0.01, lead: 0.35, juke: 0.1 },   // sharp
];
/** Chance a new bot is sloppy, steady or sharp: sloppy ones are rare, so the room stays a challenge. */
const SKILL_ODDS = [0.1, 0.45, 0.45];

/** What a bot is doing: how it steers, and a stuck check that makes it hop and turn. */
interface BotBrain {
  dirX: number; dirY: number; retarget: number; stuckClock: number; lastX: number; lastY: number; unstick: number; altX: number; altY: number;
  scatter: number; jump: boolean; target: string; targetSince: number; skip: Set<string>;
  /** Index into SKILLS. */
  skill: number;
  /** A slip in progress: seconds left and the direction it goes. */
  slipLeft: number; slipX: number; slipY: number;
  /** Where a runner is heading (time it expires in ms, distances to it for stepping). */
  goalX: number; goalY: number; goalUntil: number; goalDist?: Int16Array;
}

export class MyRoom extends Room<{ state: MyRoomState, input: MoveInput }> {
  /** A client sending more than this per second is disconnected (inputs arrive ~30/s). */
  maxMessagesPerSecond = 120;
  maxClients = 8;
  state = new MyRoomState();

  /**
   * Per-client input buffer. `sanitize` clamps every field as it is decoded —
   * never trust the wire — and the buffer holds ~2s of inputs at this tick rate
   * so a burst after a stall still replays in order.
   */
  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 64,
    sanitize: { moveX: [-1, 1], moveY: [-1, 1], jump: [0, 1] },
  });

  private joinCount = 0;
  private cooldown = 0;
  private roundClock = 0;
  /** Set when a private room's host picked one arena (or one mode) to keep. */
  private lockedArena?: string;
  private lockedMode?: string;
  private overLeft = 0;
  private isPrivate = false;
  private botWait = 0;
  private botCount = 0;
  private bots = new Map<string, BotBrain>();
  private pacers = new Map<string, InputPacer>();
  /** Whoever was "it" before the last tag, and how long they stay safe from the player who just tagged them. */
  private safeId = "";
  private safeLeft = 0;
  private orbSeq = 0;

  messages = {
    // movement arrives through the input buffer above; this is for everything that is not an input.
    /** "Ready" on the winner card: the next round starts as soon as every player has pressed it (or the wait runs out). */
    ready: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (player && this.overLeft > 0 && this.overLeft <= ROUND_END_PAUSE - READY_LOCK) { player.ready = true; }
    },
  };

  async onCreate(options: any) {
    assertRoomCapacity();
    // The room id doubles as the invite code. Private rooms skip quick-play matchmaking.
    this.roomId = await freeRoomCode();
    this.isPrivate = !!options?.private;
    if (this.isPrivate) { await this.setPrivate(true); }
    // The host (whoever creates the room) picks the arena, and it is the arena from the very
    // start, so the waiting area is the real thing. With no pick, every round gets a different one.
    this.lockedArena = ARENAS.some((a) => a.id === options?.arena) ? options.arena : undefined;
    this.state.locked = !!this.lockedArena;
    this.state.arena = this.lockedArena ?? this.pickArena("");
    this.state.nextArena = this.state.arena;
    // The same for the mode: a pick stays, otherwise every round is a different one (the first is plain Cube Tag).
    this.lockedMode = MODES.some((m) => m.id === options?.mode) ? options.mode : undefined;
    this.state.modeLocked = !!this.lockedMode;
    this.state.mode = this.lockedMode ?? "tag";
    this.state.nextMode = this.state.mode;
    this.roundClock = this.roundSeconds();
    this.state.timeLeft = this.roundClock;
    this.state.round = 1;
    this.startMode();
    // One state update per movement step: every update then carries the same distance.
    this.setPatchRate(1000 / TICK_RATE);
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    // Deterministic spawn ring, so two players never start on top of each other.
    const n = this.joinCount++;
    const angle = n * 2.399963;
    this.state.players.set(client.sessionId, new Player({
      ...this.spawnPoint(angle),
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      score: 0,
      name: sanitizeName(options?.name),
      hue: (n * 137.5 + 200) % 360,
      pet: n % PETS.length,
      hot: false,
      ready: false,
    }));
    if (this.state.mode === "tag" && !this.state.it) { this.setIt(client.sessionId); }
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.removePlayer(client.sessionId);
  }

  private removePlayer(id: string) {
    this.pacers.delete(id);
    this.state.players.delete(id);
    if (this.state.it === id) {
      const next = this.state.players.keys().next().value;
      if (next) { this.setIt(next); } else { this.state.it = ""; }
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  /** Cube Tag: make this player "it" (and nobody else red). */
  private setIt(id: string) {
    for (const [sessionId, player] of this.state.players) { player.hot = sessionId === id; }
    this.state.it = id;
  }

  /**
   * One shared `stepEntity` per received input, so the set the client predicted
   * is exactly the set the server applied. A client that sends nothing simply
   * does not move — an empty tick advances no one.
   */
  private step(ctx: StepContext) {
    for (const [sessionId, player] of this.state.players) {
      const channel = this.inputs.get(sessionId);
      if (!channel) { continue; }

      let pacer = this.pacers.get(sessionId);
      if (!pacer) { pacer = new InputPacer(); this.pacers.set(sessionId, pacer); }
      const { drop, apply } = pacer.plan(channel.size);
      let dropped = 0;
      let applied = 0;
      if (drop + apply === 0) { continue; }
      const frozen = this.overLeft > 0; // the winner is showing: the game stops, so every input counts as "no input"
      for (const input of channel) {
        // Pulling an input consumes it, so every pulled one is either dropped or applied; stop right after the last.
        if (dropped < drop) { dropped++; if (dropped >= drop && apply === 0) { break; } continue; } // stale: the player moved on during a stall
        stepEntity(player, frozen ? IDLE_INPUT : input, ctx.dt, this.arena);
        if (++applied >= apply) { break; } // the rest stay buffered for the next tick
      }
    }

    this.manageBots(ctx.dt);
    this.stepBots(ctx.dt);

    if (this.overLeft > 0) {
      this.overLeft -= ctx.dt;
      // Everyone ready: no need to wait out the rest.
      if (this.overLeft > 0 && this.state.players.size > 0 && [...this.state.players.values()].every((p) => p.ready)) { this.overLeft = 0; }
      this.state.nextIn = Math.max(0, Math.ceil(this.overLeft));
      if (this.overLeft <= 0) { this.newRound(); }
      return;
    }

    switch (this.state.mode) {
      case "orbs": this.stepOrbs(); break;
      case "infect": if (!this.stepInfect(ctx.dt)) { return; } break;
      default: if (!this.stepTag(ctx.dt)) { return; }
    }

    this.roundClock = Math.max(0, this.roundClock - ctx.dt);
    this.state.timeLeft = Math.ceil(this.roundClock);
    if (this.roundClock === 0) { this.endRound(); }
  }

  /** Cube Tag. Returns false when the round should not advance (nobody to chase). */
  private stepTag(dt: number) {
    const it = this.state.players.get(this.state.it);
    if (!it || this.state.players.size < 2) { return false; }

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.safeLeft = Math.max(0, this.safeLeft - dt);
    for (const [sessionId, player] of this.state.players) {
      if (sessionId === this.state.it) { continue; }
      player.score += dt; // survival time
      // ponytail: circle test, tagging the first overlap in map order; fine for 8 players
      // No tag-backs: two players overlapping would otherwise pass "it" back and forth every cooldown.
      if (this.safeLeft > 0 && sessionId === this.safeId) { continue; }
      if (this.cooldown === 0 && Math.hypot(player.x - it.x, player.y - it.y, player.z - it.z) < PLAYER_HALF * 2) {
        this.safeId = this.state.it;
        this.safeLeft = TAG_BACK_BLOCK;
        this.setIt(sessionId);
        this.cooldown = TAG_COOLDOWN;
        break;
      }
    }
    return true;
  }

  /** Infection: the red cube spreads by touch; players still clean score for every second. Ends early when everyone is red. */
  private stepInfect(dt: number) {
    const players = [...this.state.players.entries()];
    if (players.length < 2) { return false; }
    if (!players.some(([, p]) => p.hot)) { // the infected one left: someone takes their place
      players[Math.floor(Math.random() * players.length)][1].hot = true;
    }
    const sick = players.filter(([, p]) => p.hot);
    let clean = 0;
    for (const [, player] of players) {
      if (player.hot) { continue; }
      if (sick.some(([, s]) => Math.hypot(player.x - s.x, player.y - s.y, player.z - s.z) < PLAYER_HALF * 2)) {
        player.hot = true;
      } else {
        player.score += dt;
        clean++;
      }
    }
    if (clean === 0) { this.endRound(); return false; }
    return true;
  }

  /** Orb Rush: pick up any orb you touch, then keep the field topped up. */
  private stepOrbs() {
    for (const [orbId, orb] of this.state.orbs) {
      for (const player of this.state.players.values()) {
        if (Math.hypot(player.x - orb.x, player.y - orb.y) < ORB_REACH && Math.abs(player.z - orb.z) < ORB_HEIGHT) {
          player.score += orb.gold ? 3 : 1;
          this.state.orbs.delete(orbId);
          break;
        }
      }
    }
    const want = Math.min(5, 2 + Math.ceil(this.state.players.size / 2)); // 3 for one or two players, 5 for a full room
    if (this.state.orbs.size < want) { this.spawnOrb(); }
  }

  private spawnOrb() {
    const arena = this.arena;
    // A quarter of the orbs sit on top of a block the players can reach (a jump is ~68 high, more in low gravity; 50 leaves room to land).
    const reachable = arena.obstacles.filter((o) => o.h <= 50 / arena.gravity);
    if (reachable.length && Math.random() < 0.25) {
      const o = reachable[Math.floor(Math.random() * reachable.length)];
      this.state.orbs.set(`o${this.orbSeq++}`, new Orb({
        x: o.x + (Math.random() - 0.5) * o.hw, y: o.y + (Math.random() - 0.5) * o.hh, z: o.h, gold: Math.random() < 0.3,
      }));
      return;
    }
    for (let tries = 0; tries < 30; tries++) {
      const x = 80 + Math.random() * (arena.width - 160);
      const y = 80 + Math.random() * (arena.height - 160);
      if (!this.insideObstacle(x, y, 30)) {
        this.state.orbs.set(`o${this.orbSeq++}`, new Orb({ x, y, z: 0, gold: Math.random() < 0.12 }));
        return;
      }
    }
  }

  private insideObstacle(x: number, y: number, margin: number) {
    return this.arena.obstacles.some((o) => Math.abs(x - o.x) < o.hw + margin && Math.abs(y - o.y) < o.hh + margin);
  }

  /** Top a public room up to BOT_FILL players with labelled bots, and send one home for every human who joins. */
  private manageBots(dt: number) {
    const humans = this.state.players.size - this.bots.size;
    const want = this.isPrivate || humans < 1 ? 0 : Math.max(0, BOT_FILL - humans);
    if (this.bots.size > want) {
      const id = [...this.bots.keys()].pop()!;
      this.bots.delete(id);
      this.removePlayer(id);
      this.botWait = 0;
    } else if (this.bots.size < want) {
      this.botWait += dt;
      if (this.botWait >= (this.bots.size === 0 ? BOT_FIRST_DELAY : BOT_NEXT_DELAY)) { this.addBot(); this.botWait = 0; }
    } else {
      this.botWait = 0;
    }
  }

  private addBot() {
    const n = this.botCount++;
    const id = `bot-${n}`;
    const slot = this.joinCount++;
    this.state.players.set(id, new Player({
      ...this.spawnPoint(slot * 2.399963),
      vx: 0, vy: 0, z: 0, vz: 0, score: 0,
      name: `BOT ${BOT_NAMES[n % BOT_NAMES.length]}`,
      hue: (slot * 137.5 + 200) % 360,
      pet: slot % PETS.length,
      hot: false,
      ready: this.overLeft > 0, // bots never hold the next round up
    }));
    let roll = Math.random();
    const skill = SKILL_ODDS.findIndex((odds) => (roll -= odds) < 0);
    this.bots.set(id, {
      dirX: 0, dirY: 0, retarget: 0, stuckClock: 0, lastX: 0, lastY: 0, unstick: 0, altX: 0, altY: 0, scatter: NaN, jump: false, target: "", targetSince: 0, skip: new Set(),
      skill: skill < 0 ? 1 : skill, slipLeft: 0, slipX: 0, slipY: 0, goalX: 0, goalY: 0, goalUntil: 0,
    });
    if (this.state.mode === "tag" && !this.state.it) { this.setIt(id); }
  }

  /**
   * Bots use the same `stepEntity` as everyone. They re-aim only every 0.25-0.45s
   * and idle now and then, so a human can outmaneuver them. What they aim at depends
   * on the mode (see `steer`).
   */
  private stepBots(dt: number) {
    const arena = this.arena;
    for (const [id, brain] of this.bots) {
      const bot = this.state.players.get(id);
      if (!bot) { continue; }

      const skill = SKILLS[brain.skill];
      brain.retarget -= dt;
      brain.slipLeft = Math.max(0, brain.slipLeft - dt);
      if (brain.retarget <= 0) {
        brain.retarget = skill.react[0] + Math.random() * (skill.react[1] - skill.react[0]);
        const [vx, vy] = this.steer(id, bot, brain);
        const idle = Math.random() < skill.idle;
        brain.dirX = idle || Math.abs(vx) < 20 ? 0 : Math.sign(vx);
        brain.dirY = idle || Math.abs(vy) < 20 ? 0 : Math.sign(vy);
        // Now and then a wrong turn, like a person: rare for sharp bots, more often for sloppy ones.
        if (brain.slipLeft <= 0 && Math.random() < skill.slip) {
          brain.slipLeft = 0.5;
          brain.slipX = Math.floor(Math.random() * 3) - 1; brain.slipY = Math.floor(Math.random() * 3) - 1;
        }
      }
      if (brain.slipLeft > 0) { brain.dirX = brain.slipX; brain.dirY = brain.slipY; }

      // Pinned against a block: hop and turn a random way for half a second.
      brain.stuckClock += dt;
      if (brain.stuckClock >= 0.5) {
        const moved = Math.hypot(bot.x - brain.lastX, bot.y - brain.lastY);
        if (moved < 8 && (brain.dirX || brain.dirY)) {
          brain.unstick = 0.5;
          // Hop the way it was going (gets it over a low block), or sideways along whatever is in the way, or at random.
          const roll = Math.random();
          if (roll < 0.4) { brain.altX = brain.dirX; brain.altY = brain.dirY; }
          else if (roll < 0.7) { const side = Math.random() < 0.5 ? 1 : -1; brain.altX = -brain.dirY * side; brain.altY = brain.dirX * side; }
          else { brain.altX = Math.floor(Math.random() * 3) - 1; brain.altY = Math.floor(Math.random() * 3) - 1; }
        }
        brain.lastX = bot.x; brain.lastY = bot.y; brain.stuckClock = 0;
      }
      const hopping = brain.unstick > 0;
      brain.unstick = Math.max(0, brain.unstick - dt);
      const command = this.overLeft > 0 ? IDLE_INPUT // the winner is showing: bots stop too
        : hopping ? { moveX: brain.altX, moveY: brain.altY, jump: 1 } : { moveX: brain.dirX, moveY: brain.dirY, jump: brain.jump ? 1 : 0 };
      stepEntity(bot, command, dt, arena);
    }
  }

  /**
   * Where a bot wants to go, as a direction (it is quantised to the -1/0/1 inputs a player has).
   * Walls are handled by a coarse grid of the arena (see botNav.ts): the bot steps along the shortest way
   * to its target, or away from the player chasing it, and jumps where the way crosses a low block.
   */
  private steer(id: string, bot: Player, brain: BotBrain): [number, number] {
    const arena = this.arena;
    const nav = navFor(arena);
    brain.jump = false;
    let vx = 0, vy = 0;

    /** Along the grid toward (x, y), or straight at it if the bot is not on the grid. */
    const toward = (x: number, y: number): [number, number] => {
      const step = nav.step(nav.distancesTo(x, y), bot.x, bot.y, true);
      if (!step) { return [x - bot.x, y - bot.y]; }
      brain.jump = step.hop;
      return [step.vx, step.vy];
    };

    if (this.state.mode === "orbs") {
      // The nearest orb, on the ground or on a block, skipping any this bot has chased for too long without getting it.
      for (const skipped of brain.skip) { if (!this.state.orbs.has(skipped)) { brain.skip.delete(skipped); } }
      let best = Infinity;
      let target = "";
      for (const [orbId, orb] of this.state.orbs) {
        const d = Math.hypot(orb.x - bot.x, orb.y - bot.y);
        if (d < best && !brain.skip.has(orbId)) { best = d; target = orbId; }
      }
      const orb = this.state.orbs.get(target);
      if (!orb) { return [0, 0]; }
      const now = Date.now();
      if (target !== brain.target) { brain.target = target; brain.targetSince = now; }
      else if (now - brain.targetSince > 8000) { brain.skip.add(target); brain.target = ""; } // cannot get it: try another
      [vx, vy] = toward(orb.x, orb.y);
      // Keep jumping once close to an orb that floats over a block, so the bot lands on top.
      if (orb.z > bot.z + 5 && best < 130) { brain.jump = true; }
      return [vx, vy];
    }

    // Cube Tag and Infection: red players chase, everyone else runs.
    if (bot.hot) {
      // Chase the nearest player who can actually be tagged: the one who was just tagged and is protected from tag-backs
      // is skipped, or "it" would stand on them until the protection runs out and swap right back.
      // Also skipped: anyone this bot has chased for CHASE_GIVE_UP seconds without catching (a runner who keeps getting away).
      const protectedId = this.safeLeft > 0 ? this.safeId : "";
      const pick = () => {
        for (const spare of [protectedId, ""]) { // with only two players the protected one is the only target
          let best = Infinity;
          let found: [string, Player] | undefined;
          for (const [otherId, other] of this.state.players) {
            if (otherId === id || otherId === spare || other.hot || brain.skip.has(otherId)) { continue; }
            // Nearest counts most. A person is worth chasing from further off than another bot (so a sharp bot does not
            // just farm the weaker bots), and the player who tagged this bot is not worth a straight rematch.
            const d = Math.hypot(other.x - bot.x, other.y - bot.y) * (this.bots.has(otherId) ? 1 : 0.7) * (this.state.mode === "tag" && otherId === this.safeId ? 2.5 : 1);
            if (d < best) { best = d; found = [otherId, other]; }
          }
          if (found) { return found; }
        }
      };
      let chosen = pick();
      if (!chosen && brain.skip.size) { brain.skip.clear(); chosen = pick(); } // given up on everyone: start over with the nearest
      if (!chosen) { return [0, 0]; }
      const [targetId, target] = chosen;
      const now = Date.now();
      if (targetId !== brain.target) { brain.target = targetId; brain.targetSince = now; }
      else if (now - brain.targetSince > CHASE_GIVE_UP * 1000) { brain.skip.add(targetId); brain.target = ""; }
      // Aim where the runner is heading, as far ahead as this bot's skill allows (kept inside the arena).
      const lead = SKILLS[brain.skill].lead;
      let [cx, cy] = toward(
        Math.min(Math.max(target.x + target.vx * lead, 40), arena.width - 40),
        Math.min(Math.max(target.y + target.vy * lead, 40), arena.height - 40),
      );
      // Several chasers going for the same player would end up as one stacked blob: keep a little apart.
      for (const [otherId, other] of this.state.players) {
        if (otherId === id || !other.hot) { continue; }
        const gap = Math.hypot(bot.x - other.x, bot.y - other.y);
        if (gap < 70) { cx += ((bot.x - other.x) / (gap || 1)) * 80; cy += ((bot.y - other.y) / (gap || 1)) * 80; }
      }
      return [cx, cy];
    }
    // No longer chasing (tagged someone, or became a runner): the next chase starts fresh.
    if (brain.skip.size) { brain.skip.clear(); }
    brain.target = "";

    let threat: Player | undefined;
    let nearest = Infinity;
    for (const other of this.state.players.values()) {
      const d = Math.hypot(bot.x - other.x, bot.y - other.y);
      if (other.hot && d < nearest) { nearest = d; threat = other; }
    }
    if (threat) {
      // Runners never stand still and never run into a corner: head for open ground the chaser cannot reach first,
      // re-planned every second or two (at once when the chaser is close) and when the bot gets there.
      const now = Date.now();
      if (nearest < 220 || now > brain.goalUntil || Math.hypot(bot.x - brain.goalX, bot.y - brain.goalY) < 50) {
        const goal = nav.fleeGoal(nav.distancesTo(bot.x, bot.y), nav.distancesTo(threat.x, threat.y));
        if (goal) {
          brain.goalX = goal.x; brain.goalY = goal.y;
          brain.goalDist = nav.distancesTo(goal.x, goal.y);
          brain.goalUntil = now + 1200 + Math.random() * 1200;
        } else { brain.goalUntil = 0; brain.goalDist = undefined; }
      }
      // A chaser right behind: now and then a sharp bot dodges sideways (toward the roomier side) instead of running straight.
      if (nearest < 150 && nearest >= 40 && brain.slipLeft <= 0 && Math.random() < SKILLS[brain.skill].juke) {
        const px = -(threat.y - bot.y) / nearest, py = (threat.x - bot.x) / nearest; // sideways to the line from the chaser
        const side = nav.roomAt(bot.x + px * 80, bot.y + py * 80) >= nav.roomAt(bot.x - px * 80, bot.y - py * 80) ? 1 : -1;
        brain.slipLeft = 0.3;
        brain.slipX = Math.abs(px) > 0.38 ? side * Math.sign(px) : 0;
        brain.slipY = Math.abs(py) > 0.38 ? side * Math.sign(py) : 0;
      }
      const step = brain.goalDist && nearest >= 40 ? nav.step(brain.goalDist, bot.x, bot.y, true) : null;
      if (step && (step.vx || step.vy)) {
        vx = step.vx; vy = step.vy;
        brain.jump = step.hop;
        brain.scatter = NaN;
      } else {
        // No safe spot to plan for (boxed in): fall back to the furthest neighbouring cell.
        const away = nearest < 40 ? null : nav.step(nav.distancesTo(threat.x, threat.y), bot.x, bot.y, false);
        if (away && (away.vx || away.vy)) { vx = away.vx; vy = away.vy; brain.jump = away.hop; brain.scatter = NaN; } else {
        vx = bot.x - threat.x; vy = bot.y - threat.y;
        // Standing on top of a chaser gives no direction to run: pick one at random and keep it until clear.
        if (nearest < 40) {
          if (Number.isNaN(brain.scatter)) { brain.scatter = Math.random() * Math.PI * 2; }
          vx = Math.cos(brain.scatter) * 100; vy = Math.sin(brain.scatter) * 100;
        } else { brain.scatter = NaN; }
        const edge = 160; // steer back toward the middle when near a wall
        if (bot.x < edge || bot.x > arena.width - edge) { vx += (arena.width / 2 - bot.x) * 2; }
        if (bot.y < edge || bot.y > arena.height - edge) { vy += (arena.height / 2 - bot.y) * 2; }
        }
      }
    }
    // Don't pile up on another runner (even when nobody is chasing): bots on top of each other look like one glitching cube.
    for (const [otherId, other] of this.state.players) {
      if (otherId === id || other.hot) { continue; }
      const gap = Math.hypot(bot.x - other.x, bot.y - other.y);
      if (gap < 90) { vx += ((bot.x - other.x) / (gap || 1)) * 400; vy += ((bot.y - other.y) / (gap || 1)) * 400; }
    }
    return [vx, vy];
  }

  private endRound() {
    let best: Player | undefined;
    for (const player of this.state.players.values()) {
      if (!best || player.score > best.score) { best = player; }
    }
    this.state.winner = best?.name ?? "";
    this.overLeft = ROUND_END_PAUSE;
    this.state.nextIn = ROUND_END_PAUSE;
    for (const [id, player] of this.state.players) { player.ready = this.bots.has(id); }
    // A room the host locked stays put; any other moves on to a different arena and mode.
    this.state.nextArena = this.lockedArena ?? this.pickArena(this.state.arena);
    this.state.nextMode = this.lockedMode ?? this.pickMode(this.state.mode);
  }

  private newRound() {
    for (const player of this.state.players.values()) { player.score = 0; player.ready = false; }
    this.state.arena = this.state.nextArena;
    this.state.mode = this.state.nextMode;
    // The mode chosen at the end of the last round may no longer have enough players.
    if (modeOf(this.state.mode).minPlayers > this.state.players.size && !this.lockedMode) { this.state.mode = "tag"; }
    this.state.round++;
    this.roundClock = this.roundSeconds();
    this.state.timeLeft = this.roundClock;
    this.state.winner = "";
    this.state.nextIn = 0;
    this.cooldown = 0;
    this.safeLeft = 0;
    this.respawn();
    this.startMode();
  }

  /** Reset what belongs to the mode that is about to be played. */
  private startMode() {
    for (const player of this.state.players.values()) { player.hot = false; }
    this.state.it = "";
    this.state.orbs.clear();
    const ids = [...this.state.players.keys()];
    const random = ids.length ? ids[Math.floor(Math.random() * ids.length)] : "";
    switch (this.state.mode) {
      case "tag": if (random) { this.setIt(random); } break;
      case "infect": if (random) { this.state.players.get(random)!.hot = true; } break;
    }
  }

  private roundSeconds() { return modeOf(this.state.mode).seconds ?? this.arena.roundSeconds; }

  private get arena(): Arena { return arenaOf(this.state.arena); }

  /** A random arena other than `not`. */
  private pickArena(not: string): string {
    const options = ARENAS.filter((a) => a.id !== not);
    return options[Math.floor(Math.random() * options.length)].id;
  }

  /** A random mode other than `not` that has enough players in the room (Cube Tag if none do). */
  private pickMode(not: string): string {
    const options = MODES.filter((m) => m.id !== not && m.minPlayers <= this.state.players.size);
    return options.length ? options[Math.floor(Math.random() * options.length)].id : "tag";
  }

  private spawnPoint(angle: number) {
    const { width, height, spawnRadius } = this.arena;
    return { x: width / 2 + Math.cos(angle) * spawnRadius, y: height / 2 + Math.sin(angle) * spawnRadius };
  }

  /** New arena, new round: everyone back on an even ring around the middle. */
  private respawn() {
    const players = [...this.state.players.values()];
    players.forEach((p, i) => {
      Object.assign(p, this.spawnPoint((i / players.length) * Math.PI * 2));
      p.vx = p.vy = p.z = p.vz = 0;
    });
  }

  /**
   * Called on any disconnection the client did not ask for — a network blip, a
   * suspended tab, a tunnel change. Holding the seat lets the SDK retry into the
   * same session, so the player keeps their entity and their place in the room.
   */
  onDrop(client: Client, code: CloseCode) {
    // Deliberately not awaited: the framework routes the outcome to onReconnect()
    // or onLeave() by itself. The catch is only here because the promise also
    // rejects when the room is already disposing (server shutdown), which would
    // otherwise surface as an unhandled rejection.
    this.allowReconnection(client, 30).catch(() => {});
  }

  onReconnect(client: Client) {
    console.log(client.sessionId, "reconnected!");
  }
}
