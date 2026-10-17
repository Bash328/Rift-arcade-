import { Room, Client, CloseCode, type StepContext } from "colyseus";
import { MyRoomState, Player, MoveInput } from "./schema/MyRoomState.js";
import { freeRoomCode, assertRoomCapacity } from "./roomCode.js";
import { InputPacer } from "./inputPacing.js";
import { stepEntity } from "../shared/movement.js";
import { TICK_RATE, PLAYER_HALF, TAG_COOLDOWN, ROUND_END_PAUSE, PETS } from "../shared/constants.js";
import { ARENAS, arenaOf, type Arena } from "../shared/arenas.js";
import { sanitizeName } from "../shared/names.js";

/** Public rooms are topped up with bots to this many players, so nobody waits alone. */
const BOT_FILL = 4;
/** Seconds before the first bot joins a lonely player, then between the rest. */
const BOT_FIRST_DELAY = 6;
const BOT_NEXT_DELAY = 2;
/** Seconds after a tag during which the player who was just tagged cannot be tagged straight back. */
const TAG_BACK_BLOCK = 2;
const BOT_NAMES = ["Pip", "Moss", "Dot", "Bolt", "Zig", "Fizz", "Nova", "Taco"];

/** What a bot is doing: how it steers, and a stuck check that makes it hop and turn. */
interface BotBrain { dirX: number; dirY: number; retarget: number; stuckClock: number; lastX: number; lastY: number; unstick: number; altX: number; altY: number; scatter: number }

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
  /** Set when a private room's host picked one arena to keep. */
  private lockedArena?: string;
  private overLeft = 0;
  private isPrivate = false;
  private botWait = 0;
  private botCount = 0;
  private bots = new Map<string, BotBrain>();
  private pacers = new Map<string, InputPacer>();
  /** Whoever was "it" before the last tag, and how long they stay safe from the player who just tagged them. */
  private safeId = "";
  private safeLeft = 0;

  messages = {
    // movement arrives through the input buffer above — register handlers here
    // only for things that are not inputs (chat, emotes, …).
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
    this.roundClock = this.arena.roundSeconds;
    this.state.timeLeft = this.roundClock;
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
    }));
    if (!this.state.it) { this.state.it = client.sessionId; }
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.removePlayer(client.sessionId);
  }

  private removePlayer(id: string) {
    this.pacers.delete(id);
    this.state.players.delete(id);
    if (this.state.it === id) {
      this.state.it = this.state.players.keys().next().value ?? "";
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
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
      for (const input of channel) {
        // Pulling an input consumes it, so every pulled one is either dropped or applied; stop right after the last.
        if (dropped < drop) { dropped++; if (dropped >= drop && apply === 0) { break; } continue; } // stale: the player moved on during a stall
        stepEntity(player, input, ctx.dt, this.arena);
        if (++applied >= apply) { break; } // the rest stay buffered for the next tick
      }
    }

    this.manageBots(ctx.dt);
    this.stepBots(ctx.dt);

    if (this.overLeft > 0) {
      this.overLeft -= ctx.dt;
      if (this.overLeft <= 0) { this.newRound(); }
      return;
    }

    const it = this.state.players.get(this.state.it);
    if (!it || this.state.players.size < 2) { return; }

    this.cooldown = Math.max(0, this.cooldown - ctx.dt);
    this.safeLeft = Math.max(0, this.safeLeft - ctx.dt);
    for (const [sessionId, player] of this.state.players) {
      if (sessionId === this.state.it) { continue; }
      player.score += ctx.dt; // survival time
      // ponytail: circle test, tagging the first overlap in map order; fine for 8 players
      // No tag-backs: two players overlapping would otherwise pass "it" back and forth every cooldown.
      if (this.safeLeft > 0 && sessionId === this.safeId) { continue; }
      if (this.cooldown === 0 && Math.hypot(player.x - it.x, player.y - it.y, player.z - it.z) < PLAYER_HALF * 2) {
        this.safeId = this.state.it;
        this.safeLeft = TAG_BACK_BLOCK;
        this.state.it = sessionId;
        this.cooldown = TAG_COOLDOWN;
        break;
      }
    }

    this.roundClock = Math.max(0, this.roundClock - ctx.dt);
    this.state.timeLeft = Math.ceil(this.roundClock);
    if (this.roundClock === 0) { this.endRound(); }
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
    }));
    this.bots.set(id, { dirX: 0, dirY: 0, retarget: 0, stuckClock: 0, lastX: 0, lastY: 0, unstick: 0, altX: 0, altY: 0, scatter: NaN });
    if (!this.state.it) { this.state.it = id; }
  }

  /**
   * Bots use the same `stepEntity` as everyone. They re-aim only every 0.25-0.45s
   * and idle now and then, so a human can outmaneuver them; "it" chases the
   * nearest player, everyone else runs away from "it" and away from the walls.
   */
  private stepBots(dt: number) {
    const arena = this.arena;
    for (const [id, brain] of this.bots) {
      const bot = this.state.players.get(id);
      if (!bot) { continue; }

      brain.retarget -= dt;
      if (brain.retarget <= 0) {
        brain.retarget = 0.25 + Math.random() * 0.2;
        let vx = 0, vy = 0;
        if (id === this.state.it) {
          // Chase the nearest player who can actually be tagged: the one who was just tagged and is protected from tag-backs
          // is skipped, or "it" would stand on them until the protection runs out and swap right back.
          const protectedId = this.safeLeft > 0 ? this.safeId : "";
          for (const skip of [protectedId, ""]) {
            let best = Infinity;
            for (const [otherId, other] of this.state.players) {
              const d = Math.hypot(other.x - bot.x, other.y - bot.y);
              if (otherId !== id && otherId !== skip && d < best) { best = d; vx = other.x - bot.x; vy = other.y - bot.y; }
            }
            if (best < Infinity) { break; } // with only two players the protected one is the only target
          }
        } else {
          const it = this.state.players.get(this.state.it);
          if (it && Math.hypot(bot.x - it.x, bot.y - it.y) < 450) {
            vx = bot.x - it.x; vy = bot.y - it.y;
            // Standing on top of "it" gives no direction to run: pick one at random and keep it until clear.
            if (Math.hypot(vx, vy) < 40) {
              if (Number.isNaN(brain.scatter)) { brain.scatter = Math.random() * Math.PI * 2; }
              vx = Math.cos(brain.scatter) * 100; vy = Math.sin(brain.scatter) * 100;
            } else { brain.scatter = NaN; }
            const edge = 160; // steer back toward the middle when near a wall
            if (bot.x < edge || bot.x > arena.width - edge) { vx += (arena.width / 2 - bot.x) * 2; }
            if (bot.y < edge || bot.y > arena.height - edge) { vy += (arena.height / 2 - bot.y) * 2; }
          }
          // Don't pile up on another runner (even when nobody is chasing): bots on top of each other look like one glitching cube.
          for (const [otherId, other] of this.state.players) {
            if (otherId === id || otherId === this.state.it) { continue; }
            const gap = Math.hypot(bot.x - other.x, bot.y - other.y);
            if (gap < 90) { vx += ((bot.x - other.x) / (gap || 1)) * 400; vy += ((bot.y - other.y) / (gap || 1)) * 400; }
          }
        }
        const idle = Math.random() < 0.04;
        brain.dirX = idle || Math.abs(vx) < 20 ? 0 : Math.sign(vx);
        brain.dirY = idle || Math.abs(vy) < 20 ? 0 : Math.sign(vy);
      }

      // Pinned against a block: hop and turn a random way for half a second.
      brain.stuckClock += dt;
      if (brain.stuckClock >= 0.5) {
        const moved = Math.hypot(bot.x - brain.lastX, bot.y - brain.lastY);
        if (moved < 8 && (brain.dirX || brain.dirY)) {
          brain.unstick = 0.5;
          brain.altX = Math.floor(Math.random() * 3) - 1;
          brain.altY = Math.floor(Math.random() * 3) - 1;
        }
        brain.lastX = bot.x; brain.lastY = bot.y; brain.stuckClock = 0;
      }
      const hopping = brain.unstick > 0;
      brain.unstick = Math.max(0, brain.unstick - dt);
      stepEntity(bot, hopping ? { moveX: brain.altX, moveY: brain.altY, jump: 1 } : { moveX: brain.dirX, moveY: brain.dirY, jump: 0 }, dt, arena);
    }
  }

  private endRound() {
    let best: Player | undefined;
    for (const player of this.state.players.values()) {
      if (!best || player.score > best.score) { best = player; }
    }
    this.state.winner = best?.name ?? "";
    this.overLeft = ROUND_END_PAUSE;
    // A room the host locked stays put; any other moves on to a different arena.
    this.state.nextArena = this.lockedArena ?? this.pickArena(this.state.arena);
  }

  private newRound() {
    for (const player of this.state.players.values()) { player.score = 0; }
    this.state.arena = this.state.nextArena;
    this.roundClock = this.arena.roundSeconds;
    this.state.timeLeft = this.roundClock;
    this.state.winner = "";
    this.cooldown = 0;
    this.safeLeft = 0;
    this.respawn();
  }

  private get arena(): Arena { return arenaOf(this.state.arena); }

  /** A random arena other than `not`. */
  private pickArena(not: string): string {
    const options = ARENAS.filter((a) => a.id !== not);
    return options[Math.floor(Math.random() * options.length)].id;
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
