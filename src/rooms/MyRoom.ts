import { Room, Client, CloseCode, type StepContext } from "colyseus";
import { MyRoomState, Player, MoveInput } from "./schema/MyRoomState.js";
import { freeRoomCode } from "./roomCode.js";
import { stepEntity } from "../shared/movement.js";
import { TICK_RATE, ARENA_WIDTH, ARENA_HEIGHT, PLAYER_HALF, TAG_COOLDOWN, ROUND_SECONDS, ROUND_END_PAUSE } from "../shared/constants.js";

export class MyRoom extends Room<{ state: MyRoomState, input: MoveInput }> {
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
  private roundClock = ROUND_SECONDS;
  private overLeft = 0;

  messages = {
    // movement arrives through the input buffer above — register handlers here
    // only for things that are not inputs (chat, emotes, …).
  };

  async onCreate(options: any) {
    // The room id doubles as the invite code. Private rooms skip quick-play matchmaking.
    this.roomId = await freeRoomCode();
    if (options?.private) { await this.setPrivate(true); }
    this.state.timeLeft = ROUND_SECONDS;
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    // Deterministic spawn ring, so two players never start on top of each other.
    const n = this.joinCount++;
    const angle = n * 2.399963;
    this.state.players.set(client.sessionId, new Player({
      x: ARENA_WIDTH / 2 + Math.cos(angle) * 80,
      y: ARENA_HEIGHT / 2 + Math.sin(angle) * 80,
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      score: 0,
      name: String(options?.name ?? "").trim().slice(0, 12) || "Player",
      hue: (n * 137.5 + 200) % 360,
    }));
    if (!this.state.it) { this.state.it = client.sessionId; }
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.state.players.delete(client.sessionId);
    if (this.state.it === client.sessionId) {
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

      for (const input of channel) {
        stepEntity(player, input, ctx.dt);
      }
    }

    if (this.overLeft > 0) {
      this.overLeft -= ctx.dt;
      if (this.overLeft <= 0) { this.newRound(); }
      return;
    }

    const it = this.state.players.get(this.state.it);
    if (!it || this.state.players.size < 2) { return; }

    this.cooldown = Math.max(0, this.cooldown - ctx.dt);
    for (const [sessionId, player] of this.state.players) {
      if (sessionId === this.state.it) { continue; }
      player.score += ctx.dt; // survival time
      // ponytail: circle test, tagging the first overlap in map order; fine for 8 players
      if (this.cooldown === 0 && Math.hypot(player.x - it.x, player.y - it.y, player.z - it.z) < PLAYER_HALF * 2) {
        this.state.it = sessionId;
        this.cooldown = TAG_COOLDOWN;
        break;
      }
    }

    this.roundClock = Math.max(0, this.roundClock - ctx.dt);
    this.state.timeLeft = Math.ceil(this.roundClock);
    if (this.roundClock === 0) { this.endRound(); }
  }

  private endRound() {
    let best: Player | undefined;
    for (const player of this.state.players.values()) {
      if (!best || player.score > best.score) { best = player; }
    }
    this.state.winner = best?.name ?? "";
    this.overLeft = ROUND_END_PAUSE;
  }

  private newRound() {
    for (const player of this.state.players.values()) { player.score = 0; }
    this.roundClock = ROUND_SECONDS;
    this.state.timeLeft = ROUND_SECONDS;
    this.state.winner = "";
    this.cooldown = 0;
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
