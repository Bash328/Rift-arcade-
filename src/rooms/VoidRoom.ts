import { Room, Client, type StepContext } from "colyseus";
import { VoidState, VoidPlayer } from "./schema/VoidState.js";
import { MoveInput } from "./schema/MyRoomState.js";
import { freeRoomCode, assertRoomCapacity } from "./roomCode.js";
import { TICK_RATE, PETS } from "../shared/constants.js";
import {
  GRID, VOID_SIZE, SOLID, CRACKING, GONE, CRACK_TIME, FALL_LIMIT, tileAt, stepVoidEntity,
} from "../shared/void.js";

const COUNTDOWN = 5;
const OVER_PAUSE = 5;
const QUIET_TICKS = 6;
const IDLE = { moveX: 0, moveY: 0, jump: 0 };

/**
 * Voidfall: everyone stands on a grid of tiles. A tile cracks the moment someone
 * lands on it and drops away 1.2s later. Last player standing wins.
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
  private crack = new Array<number>(GRID * GRID).fill(0);
  /** Session ids in the order they fell, so the last one out can win a tie. */
  private fell: string[] = [];
  /** Consecutive ticks each player has sent no input. */
  private quiet = new Map<string, number>();

  async onCreate(options: any) {
    assertRoomCapacity();
    // The room id doubles as the invite code. Private rooms skip quick-play matchmaking.
    this.roomId = await freeRoomCode();
    if (options?.private) { await this.setPrivate(true); }
    for (let i = 0; i < GRID * GRID; i++) { this.state.tiles.push(SOLID); }
    this.state.phase = "waiting";
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: any) {
    const n = this.joinCount++;
    // Joining mid-round means watching until the next one.
    const inRound = this.state.phase === "playing";
    this.state.players.set(client.sessionId, new VoidPlayer({
      x: VOID_SIZE / 2, y: VOID_SIZE / 2, vx: 0, vy: 0, z: 0, vz: 0,
      name: String(options?.name ?? "").trim().slice(0, 12) || "Player",
      hue: (n * 137.5 + 200) % 360,
      pet: n % PETS.length,
      alive: !inRound,
    }));
    if (!inRound) { this.spread(); }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.quiet.delete(client.sessionId);
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
    for (const [sessionId, p] of s.players) {
      if (!p.alive) { continue; }
      let stepped = 0;
      for (const input of this.inputs.get(sessionId) ?? []) { stepVoidEntity(p, input, ctx.dt, s.tiles); stepped++; }

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
        if (s.players.size >= 2) { s.phase = "countdown"; this.phaseClock = COUNTDOWN; s.countdown = COUNTDOWN; }
        break;
      case "countdown":
        this.recoverStragglers();
        if (s.players.size < 2) { s.phase = "waiting"; break; }
        this.phaseClock -= ctx.dt;
        s.countdown = Math.max(Math.ceil(this.phaseClock), 0);
        if (this.phaseClock <= 0) { this.start(); }
        break;
      case "playing":
        this.play(ctx.dt);
        break;
      case "over":
        this.phaseClock -= ctx.dt;
        if (this.phaseClock <= 0) { this.newRound(); }
        break;
    }
  }

  /** Before the round starts, anyone who walks off the edge is put back. */
  private recoverStragglers() {
    if ([...this.state.players.values()].some((p) => p.alive && p.z < FALL_LIMIT)) { this.spread(); }
  }

  private start() {
    this.fell = [];
    this.crack.fill(0);
    this.state.phase = "playing";
    this.state.alive = [...this.state.players.values()].filter((p) => p.alive).length;
  }

  private play(dt: number) {
    const s = this.state;

    // A tile cracks the moment someone is standing on it...
    for (const p of s.players.values()) {
      if (!p.alive || p.z !== 0) { continue; }
      const idx = tileAt(p.x, p.y);
      if (idx >= 0 && s.tiles[idx] === SOLID) { s.tiles[idx] = CRACKING; this.crack[idx] = CRACK_TIME; }
    }
    // ...and drops once its timer runs out.
    for (let i = 0; i < s.tiles.length; i++) {
      if (s.tiles[i] !== CRACKING) { continue; }
      this.crack[i] -= dt;
      if (this.crack[i] <= 0) { s.tiles[i] = GONE; }
    }

    for (const [sessionId, p] of s.players) {
      if (p.alive && p.z < FALL_LIMIT) { p.alive = false; this.fell.push(sessionId); }
    }
    const standing = [...s.players.values()].filter((p) => p.alive);
    s.alive = standing.length;
    if (standing.length <= 1) { this.finish(standing[0]); }
  }

  private finish(survivor?: VoidPlayer) {
    // If the last two fall together, whoever fell last still counts as the winner.
    const lastOut = [...this.fell].reverse().map((id) => this.state.players.get(id)).find(Boolean);
    this.state.winner = (survivor ?? lastOut)?.name ?? "Nobody";
    this.state.phase = "over";
    this.phaseClock = OVER_PAUSE;
  }

  private newRound() {
    const s = this.state;
    for (let i = 0; i < s.tiles.length; i++) { s.tiles[i] = SOLID; }
    this.crack.fill(0);
    this.fell = [];
    s.winner = "";
    for (const p of s.players.values()) { p.alive = true; }
    this.spread();
    s.phase = "waiting";
  }
}
