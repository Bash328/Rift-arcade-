import { Room, Client, type StepContext } from "colyseus";
import { VoidState, VoidPlayer } from "./schema/VoidState.js";
import { MoveInput } from "./schema/MyRoomState.js";
import { freeRoomCode, assertRoomCapacity } from "./roomCode.js";
import { InputPacer } from "./inputPacing.js";
import { sanitizeName } from "../shared/names.js";
import { TICK_RATE, PETS, BOT_NAMES, ROUND_END_PAUSE, READY_LOCK } from "../shared/constants.js";
import {
  GRID, TILE, CELLS, VOID_SIZE, SOLID, CRACKING, GONE, CRACK_TIME, LAND_GRACE, FLOOR_GAP, SUDDEN_DEATH_AT,
  tileAt, tileUnder, floorsOf, fallLimit, dealKinds, breakTime, suddenDeathGap, stepVoidEntity, type VoidInput,
} from "../shared/void.js";
import { VOID_MODES, voidModeOf } from "../shared/voidModes.js";

const COUNTDOWN = 5;
const QUIET_TICKS = 6;
const IDLE = { moveX: 0, moveY: 0, jump: 0 };

/** Public rooms are topped up with bots to this many players (a lone player gets four); each human who joins sends one home. */
const BOT_FILL = 5;
const BOT_FIRST_DELAY = 6;
const BOT_NEXT_DELAY = 2;

/**
 * How good a bot is. `react`: seconds it takes to decide on each step. `leaveAt`: it starts moving off its tile when
 * that many seconds are left before it drops (a person needs about 0.35 to get clear). `slip`: chance of freezing for a
 * moment at the worst time. Every bot moves at a player's speed.
 */
const SKILLS = [
  { react: [0.25, 0.45], leaveAt: 0.75, slip: 0.06, noise: 2 },    // sloppy
  { react: [0.15, 0.3], leaveAt: 0.6, slip: 0.02, noise: 1 },      // steady
  { react: [0.08, 0.18], leaveAt: 0.5, slip: 0.005, noise: 0.3 },  // sharp
];
/** Chance a new bot is sloppy, steady or sharp: sloppy ones are rare, so the room stays a challenge. */
const SKILL_ODDS = [0.1, 0.45, 0.45];

interface BotBrain {
  skill: number;
  /** Seconds until it decides again. */
  retarget: number;
  /** The tile it is heading for (-1 = standing and waiting), and whether getting there means jumping a gap. */
  goal: number;
  hop: boolean;
}

/**
 * Voidfall: everyone stands on a grid of tiles. A tile cracks the moment someone
 * lands on it and drops away 1.2s later. Last player standing wins.
 *
 * Modes (see shared/voidModes.ts) take turns, one per round: classic is one floor with every tile breaking in 1.2s;
 * Hex-A-Gone is three floors where each tile breaks at its own speed, shown by colour.
 */
export class VoidRoom extends Room<{ state: VoidState, input: MoveInput }> {
  /** A client sending more than this per second is disconnected (inputs arrive ~30/s). */
  maxMessagesPerSecond = 120;
  maxClients = 12;
  state = new VoidState();

  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 64,
    sanitize: { moveX: [-1, 1], moveY: [-1, 1], jump: [0, 1] },
  });

  private joinCount = 0;
  private phaseClock = 0;
  /** Seconds left before each cracking tile drops, and how long each tile takes to break once landed on (both per tile of the current mode). */
  private crack: number[] = [];
  private breakAt: number[] = [];
  /** Seconds into the round, and the time to the next tile sudden death cracks. */
  private playClock = 0;
  private deathClock = 0;
  /** The mode the host locked for this room, if any. */
  private lockedMode: string | undefined;
  /** Players whose connection dropped and whose seat is held: the next round does not wait for their Ready. */
  private away = new Set<string>();
  /** Session ids in the order they fell, so the last one out can win a tie. */
  private fell: string[] = [];
  /** Consecutive ticks each player has sent no input. */
  private quiet = new Map<string, number>();
  private pacers = new Map<string, InputPacer>();
  private bots = new Map<string, BotBrain>();
  private botCount = 0;
  private botWait = 0;
  private isPrivate = false;

  messages = {
    /** "Ready" on the winner card: the next round starts as soon as every player has pressed it (or the wait runs out). */
    ready: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (player && this.state.phase === "over" && this.phaseClock <= ROUND_END_PAUSE - READY_LOCK) { player.ready = true; }
    },
  };

  async onCreate(options: any) {
    assertRoomCapacity();
    // The room id doubles as the invite code. Private rooms skip quick-play matchmaking.
    this.roomId = await freeRoomCode();
    this.isPrivate = !!options?.private;
    if (this.isPrivate) { await this.setPrivate(true); }
    // The host of a private room can lock one mode; otherwise the modes take turns, starting with classic.
    this.lockedMode = VOID_MODES.some((m) => m.id === options?.mode) ? options.mode : undefined;
    this.state.modeLocked = !!this.lockedMode;
    this.setupMode(this.lockedMode ?? "classic");
    this.state.nextMode = this.state.mode;
    this.state.round = 1;
    this.state.phase = "waiting";
    this.setPatchRate(1000 / TICK_RATE);
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: any) {
    const n = this.joinCount++;
    // Joining mid-round means watching until the next one.
    const inRound = this.state.phase === "playing";
    this.state.players.set(client.sessionId, new VoidPlayer({
      x: VOID_SIZE / 2, y: VOID_SIZE / 2, vx: 0, vy: 0, z: 0, vz: 0,
      name: sanitizeName(options?.name),
      hue: (n * 137.5 + 200) % 360,
      pet: n % PETS.length,
      alive: !inRound,
      ready: false,
    }));
    if (this.state.phase === "waiting" || this.state.phase === "countdown") { this.spread(); } // not while the winner is celebrating
  }

  /** A refresh or network blip: hold the seat for 30s so the player can resume as the same character. */
  onDrop(client: Client) {
    this.away.add(client.sessionId);
    this.allowReconnection(client, 30).catch(() => {}); // rejects only when the room is already closing
  }

  onReconnect(client: Client) {
    this.away.delete(client.sessionId);
  }

  onLeave(client: Client) {
    this.away.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.quiet.delete(client.sessionId);
    this.pacers.delete(client.sessionId);
  }

  /** Top a public room up to BOT_FILL players with labelled bots, and send one home for every human who joins. */
  private manageBots(dt: number) {
    const s = this.state;
    const humans = s.players.size - this.bots.size;
    const want = this.isPrivate || humans < 1 ? 0 : Math.max(0, BOT_FILL - humans);
    if (this.bots.size > want) {
      // Never make a bot vanish in the middle of a round: wait until it has fallen or the round is over.
      const id = [...this.bots.keys()].reverse().find((b) => s.phase !== "playing" || !s.players.get(b)?.alive);
      if (id) { this.bots.delete(id); s.players.delete(id); this.botWait = 0; }
    } else if (this.bots.size < want && (s.phase === "waiting" || s.phase === "countdown")) {
      this.botWait += dt;
      if (this.botWait >= (this.bots.size === 0 ? BOT_FIRST_DELAY : BOT_NEXT_DELAY)) { this.addBot(); this.botWait = 0; }
    } else {
      this.botWait = 0;
    }
  }

  private addBot() {
    const n = this.botCount++;
    const slot = this.joinCount++;
    const id = `bot-${n}`;
    this.state.players.set(id, new VoidPlayer({
      x: VOID_SIZE / 2, y: VOID_SIZE / 2, vx: 0, vy: 0, z: 0, vz: 0,
      name: `BOT ${BOT_NAMES[n % BOT_NAMES.length]}`,
      hue: (slot * 137.5 + 200) % 360,
      pet: slot % PETS.length,
      alive: !this.botsSitOut(),
      ready: this.state.phase === "over",
    }));
    let roll = Math.random();
    const skill = SKILL_ODDS.findIndex((odds) => (roll -= odds) < 0);
    this.bots.set(id, { skill: skill < 0 ? 1 : skill, retarget: 0, goal: -1, hop: false });
    this.spread();
  }

  /** Bots move with the same `stepVoidEntity` as everyone; they only decide what to press. */
  private stepBots(dt: number) {
    const s = this.state;
    for (const [id, brain] of this.bots) {
      const bot = s.players.get(id);
      if (!bot || !bot.alive) { continue; }
      stepVoidEntity(bot, s.phase === "playing" ? this.botCommand(bot, brain, dt) : IDLE, dt, s.tiles);
    }
  }

  /**
   * What a bot presses this tick. A tile drops 1.2s after anyone lands on it, so the way to last is to use few tiles:
   * stand until the tile is about to go, then step to the best neighbour (jumping a one-tile gap when that is the way).
   */
  private botCommand(bot: VoidPlayer, brain: BotBrain, dt: number): VoidInput {
    const s = this.state;
    const skill = SKILLS[brain.skill];
    const here = tileAt(bot.x, bot.y);
    if (here < 0 || bot.z < -LAND_GRACE) { return IDLE; } // already falling
    const dir = (delta: number) => (Math.abs(delta) > 6 ? Math.sign(delta) : 0);

    if (brain.goal >= 0) {
      const gx = ((brain.goal % GRID) + 0.5) * TILE, gy = (Math.floor(brain.goal / GRID) + 0.5) * TILE;
      if (Math.hypot(bot.x - gx, bot.y - gy) < 18) { brain.goal = -1; return IDLE; } // arrived: stand and wait
      const moveX = dir(gx - bot.x), moveY = dir(gy - bot.y);
      // Straight at a gap with the goal beyond it: jump once the missing tile is next.
      const ahead = tileAt(bot.x + moveX * 45, bot.y + moveY * 45);
      const jump = brain.hop && bot.z === 0 && (moveX === 0 || moveY === 0) && (ahead < 0 || s.tiles[ahead] === GONE) ? 1 : 0;
      return { moveX, moveY, jump };
    }

    brain.retarget -= dt;
    if (brain.retarget > 0) { return IDLE; }
    brain.retarget = skill.react[0] + Math.random() * (skill.react[1] - skill.react[0]);
    const remaining = s.tiles[here] === CRACKING ? this.crack[here] : CRACK_TIME;
    if (remaining > skill.leaveAt) { return IDLE; } // plenty of time on this one
    if (Math.random() < skill.slip) { brain.retarget += 0.35; return IDLE; } // a moment's hesitation

    // The best tile within reach: untouched ground with solid neighbours, away from other players and from the middle.
    const hx = here % GRID, hy = Math.floor(here / GRID);
    const solidAround = (i: number) => {
      const cx = i % GRID, cy = Math.floor(i / GRID);
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if ((dx || dy) && x >= 0 && y >= 0 && x < GRID && y < GRID && s.tiles[y * GRID + x] === SOLID) { n++; }
        }
      }
      return n;
    };
    // Solid tiles that touch form an island; a small island is a trap, a big one is somewhere to last.
    const island = new Int16Array(GRID * GRID).fill(-1);
    const islandSize: number[] = [];
    for (let start = 0; start < island.length; start++) {
      if (s.tiles[start] !== SOLID || island[start] >= 0) { continue; }
      const id = islandSize.length;
      const stack = [start];
      island[start] = id;
      let size = 0;
      while (stack.length) {
        const i = stack.pop()!;
        size++;
        const cx = i % GRID, cy = Math.floor(i / GRID);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx, y = cy + dy, j = y * GRID + x;
            if (x >= 0 && y >= 0 && x < GRID && y < GRID && s.tiles[j] === SOLID && island[j] < 0) { island[j] = id; stack.push(j); }
          }
        }
      }
      islandSize.push(size);
    }
    let best = -Infinity, goal = -1, hop = false;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = hx + dx, y = hy + dy;
        if ((!dx && !dy) || x < 0 || y < 0 || x >= GRID || y >= GRID) { continue; }
        const far = Math.max(Math.abs(dx), Math.abs(dy)) === 2;
        // Two tiles away is only reachable by jumping straight across a missing tile.
        if (far && !((dx === 0 || dy === 0) && s.tiles[(hy + dy / 2) * GRID + hx + dx / 2] === GONE)) { continue; }
        const i = y * GRID + x;
        if (s.tiles[i] !== SOLID) { continue; }
        const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
        let score = solidAround(i) + 0.25 * Math.min(islandSize[island[i]], 40) + 0.3 * Math.hypot(x - (GRID - 1) / 2, y - (GRID - 1) / 2) - (far ? 1.5 : 0) + Math.random() * skill.noise;
        for (const other of s.players.values()) {
          if (other !== bot && other.alive && Math.hypot(other.x - cx, other.y - cy) < 70) { score -= 2; }
        }
        if (score > best) { best = score; goal = i; hop = far; }
      }
    }
    brain.goal = goal;
    brain.hop = hop;
    if (goal < 0) { return IDLE; } // nowhere to go
    return this.botCommand(bot, brain, 0);
  }

  /** Bots only know how to play one floor, so they sit a Hex-A-Gone round out (they are listed as out and rejoin the next classic round). */
  private botsSitOut() { return this.state.mode === "hex"; }

  private humans() { return this.state.players.size - this.bots.size; }

  /** Players who can actually take part in the round now. */
  private contenders() { return this.state.players.size - (this.botsSitOut() ? this.bots.size : 0); }

  /**
   * Lay out the tiles for a mode: one floor of 81 for classic, three of 81 for Hex-A-Gone with a kind dealt to each
   * tile (and so a break time). Done between rounds, so the clients see the array change size with the new mode.
   */
  private setupMode(id: string) {
    const s = this.state;
    const mode = voidModeOf(id);
    const count = mode.floors * CELLS;
    s.mode = mode.id;
    s.tiles.clear();
    s.kinds.clear();
    for (let i = 0; i < count; i++) { s.tiles.push(SOLID); }
    this.breakAt = new Array<number>(count).fill(CRACK_TIME);
    if (mode.floors > 1) {
      dealKinds().forEach((kind, i) => { s.kinds.push(kind); this.breakAt[i] = breakTime(Math.floor(i / CELLS), kind); });
    }
    this.crack = new Array<number>(count).fill(0);
    for (const [botId] of this.bots) { const bot = s.players.get(botId); if (bot) { bot.alive = !this.botsSitOut(); } }
  }

  /** The mode after this one: they take turns, but Hex-A-Gone needs enough humans (bots cannot play it). A host's lock wins. */
  private pickMode(): string {
    if (this.lockedMode) { return this.lockedMode; }
    const next = this.state.mode === "classic" ? "hex" : "classic";
    return voidModeOf(next).minHumans > this.humans() ? "classic" : next;
  }

  /** Put every living player on an even ring around the middle of the grid. */
  private spread() {
    const players = [...this.state.players.values()].filter((p) => p.alive);
    players.forEach((p, i) => {
      const angle = (i / players.length) * Math.PI * 2;
      const radius = players.length === 1 ? 0 : 130;
      p.x = VOID_SIZE / 2 + Math.cos(angle) * radius;
      p.y = VOID_SIZE / 2 + Math.sin(angle) * radius;
      p.vx = p.vy = p.z = p.vz = 0;
    });
  }

  private step(ctx: StepContext) {
    const s = this.state;
    this.manageBots(ctx.dt);
    this.stepBots(ctx.dt);
    for (const [sessionId, p] of s.players) {
      if (!p.alive || this.bots.has(sessionId)) { continue; } // bots are moved by stepBots
      let stepped = 0;
      const channel = this.inputs.get(sessionId);
      let pacer = this.pacers.get(sessionId);
      if (!pacer) { pacer = new InputPacer(); this.pacers.set(sessionId, pacer); }
      const { drop, apply } = pacer.plan(channel?.size ?? 0);
      let dropped = 0;
      for (const input of drop + apply === 0 ? [] : channel ?? []) {
        // Pulling an input consumes it, so every pulled one is either dropped or applied; stop right after the last.
        if (dropped < drop) { dropped++; if (dropped >= drop && apply === 0) { break; } continue; } // stale: the player moved on during a stall
        stepVoidEntity(p, input, ctx.dt, s.tiles);
        if (++stepped >= apply) { break; } // the rest stay buffered for the next tick
      }

      // Inputs are the clock, so a player who stops sending them (a backgrounded
      // tab, a dead connection) would hang in mid-air over a missing tile. After a
      // short silence, let gravity run anyway.
      const quiet = stepped > 0 ? 0 : (this.quiet.get(sessionId) ?? 0) + 1;
      this.quiet.set(sessionId, quiet);
      if (quiet > QUIET_TICKS) { stepVoidEntity(p, IDLE, ctx.dt, s.tiles); }
    }

    switch (s.phase) {
      case "waiting":
        this.recoverStragglers();
        // Players left since the last round may not be enough for Hex-A-Gone: fall back to classic.
        if (!this.lockedMode && voidModeOf(s.mode).minHumans > this.humans()) { this.setupMode("classic"); s.nextMode = "classic"; this.spread(); }
        if (this.contenders() >= 2) { s.phase = "countdown"; this.phaseClock = COUNTDOWN; s.countdown = COUNTDOWN; }
        break;
      case "countdown":
        this.recoverStragglers();
        if (this.contenders() < 2) { s.phase = "waiting"; break; }
        this.phaseClock -= ctx.dt;
        s.countdown = Math.max(Math.ceil(this.phaseClock), 0);
        if (this.phaseClock <= 0) { this.start(); }
        break;
      case "playing":
        this.play(ctx.dt);
        break;
      case "over":
        this.phaseClock -= ctx.dt;
        // Everyone ready (bots always are, and so is anyone whose connection dropped): no need to wait out the rest.
        if (this.phaseClock > 0 && s.players.size > 0 && [...s.players].every(([id, p]) => p.ready || this.away.has(id))) { this.phaseClock = 0; }
        s.nextIn = Math.max(0, Math.ceil(this.phaseClock));
        if (this.phaseClock <= 0) { this.newRound(); }
        break;
    }
  }

  /** Before the round starts, anyone who walks off the edge is put back. */
  private recoverStragglers() {
    const limit = fallLimit(floorsOf(this.state.tiles));
    if ([...this.state.players.values()].some((p) => p.alive && p.z < limit)) { this.spread(); }
  }

  private start() {
    this.fell = [];
    this.crack.fill(0);
    this.playClock = 0;
    this.deathClock = 0;
    this.state.phase = "playing";
    this.state.alive = [...this.state.players.values()].filter((p) => p.alive).length;
  }

  private play(dt: number) {
    const s = this.state;

    // A tile cracks the moment someone is standing on it (on whichever floor)...
    for (const p of s.players.values()) {
      if (!p.alive) { continue; }
      const idx = tileUnder(p, s.tiles);
      if (idx >= 0 && s.tiles[idx] === SOLID) { s.tiles[idx] = CRACKING; this.crack[idx] = this.breakAt[idx]; }
    }
    // ...and drops once its timer runs out.
    for (let i = 0; i < s.tiles.length; i++) {
      if (s.tiles[i] !== CRACKING) { continue; }
      this.crack[i] -= dt;
      if (this.crack[i] <= 0) { s.tiles[i] = GONE; }
    }

    // Sudden death: after a while tiles start cracking on their own, faster and faster, so a round cannot drag on.
    this.playClock += dt;
    if (s.mode === "hex" && this.playClock >= SUDDEN_DEATH_AT) {
      this.deathClock -= dt;
      if (this.deathClock <= 0) {
        this.crackRandomTile();
        this.deathClock = suddenDeathGap(this.playClock);
      }
    }

    const limit = fallLimit(floorsOf(s.tiles));
    for (const [sessionId, p] of s.players) {
      if (p.alive && p.z < limit) { p.alive = false; this.fell.push(sessionId); }
    }
    const standing = [...s.players.values()].filter((p) => p.alive);
    s.alive = standing.length;
    if (standing.length <= 1) { this.finish(standing[0]); }
  }

  /** Start a random solid tile cracking, on a floor somebody is on (any floor if everyone is in the air). */
  private crackRandomTile() {
    const s = this.state;
    const floors = floorsOf(s.tiles);
    const occupied = new Set<number>();
    for (const p of s.players.values()) {
      if (p.alive) { occupied.add(Math.min(floors - 1, Math.max(0, Math.round(-p.z / FLOOR_GAP)))); }
    }
    const solid: number[] = [];
    for (let i = 0; i < s.tiles.length; i++) {
      if (s.tiles[i] === SOLID && (occupied.size === 0 || occupied.has(Math.floor(i / CELLS)))) { solid.push(i); }
    }
    if (!solid.length) { return; }
    const idx = solid[Math.floor(Math.random() * solid.length)];
    s.tiles[idx] = CRACKING;
    this.crack[idx] = this.breakAt[idx];
  }

  private finish(survivor?: VoidPlayer) {
    // If the last two fall together, whoever fell last still counts as the winner.
    const lastOut = [...this.fell].reverse().map((id) => this.state.players.get(id)).find(Boolean);
    this.state.winner = (survivor ?? lastOut)?.name ?? "Nobody";
    this.state.phase = "over";
    this.phaseClock = ROUND_END_PAUSE;
    this.state.nextIn = ROUND_END_PAUSE;
    this.state.nextMode = this.pickMode();
    for (const [id, p] of this.state.players) { p.ready = this.bots.has(id); }
  }

  private newRound() {
    const s = this.state;
    // The mode picked at the end of the last round may no longer have enough humans.
    const mode = !this.lockedMode && voidModeOf(s.nextMode).minHumans > this.humans() ? "classic" : s.nextMode;
    this.setupMode(mode);
    this.fell = [];
    s.winner = "";
    s.nextIn = 0;
    s.round++;
    for (const [id, p] of s.players) { p.ready = false; p.alive = !(this.bots.has(id) && this.botsSitOut()); }
    this.spread();
    s.phase = "waiting";
  }
}
