import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoomState, type MoveInput } from "../src/rooms/schema/MyRoomState.js";
import { stepEntity } from "../src/shared/movement.js";
import { ARENA_WIDTH, ARENA_HEIGHT, OBSTACLES, PLAYER_SPEED, TICK_RATE } from "../src/shared/constants.js";

describe("testing your Colyseus app", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("advances a player from its buffered input", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const client1 = await colyseus.connectTo(room);

    const player = room.state.players.get(client1.sessionId);
    assert.ok(player, "a Player is created on join");
    const startX = player.x;

    const input = client1.input<MoveInput>({ mode: "reliable" });
    input.data.moveX = 1;
    input.data.moveY = 0;
    input.send();

    await room.waitForNextMessage();  // the input reaches the server
    await room.waitForNextTimestep(); // the step that consumes it runs

    assert.ok(player.x > startX, "the buffered input advanced the player");
  });

  it("clamps input that is out of range", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const client1 = await colyseus.connectTo(room);

    const player = room.state.players.get(client1.sessionId);
    const startX = player.x;

    // A modified client claiming a huge axis value: sanitize clamps it to 1.
    const input = client1.input<MoveInput>({ mode: "reliable" });
    input.data.moveX = 100 as any;
    input.send();

    await room.waitForNextMessage();
    await room.waitForNextTimestep();

    // The room steps once per received input, so one input is exactly one step
    // of travel — at moveX clamped to 1, not the 100 the client asked for.
    assert.strictEqual(player.x, startX + PLAYER_SPEED * (1 / TICK_RATE));
  });

  it("passes \"it\" on touch", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const a = await colyseus.connectTo(room);
    const b = await colyseus.connectTo(room);
    assert.strictEqual(room.state.it, a.sessionId, "first player starts as it");

    const pa = room.state.players.get(a.sessionId);
    const pb = room.state.players.get(b.sessionId);
    pb.x = pa.x; pb.y = pa.y;
    await room.waitForNextTimestep();

    assert.strictEqual(room.state.it, b.sessionId);
  });

  it("ends the round with the top scorer as winner, then restarts", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", {});
    const a = await colyseus.connectTo(room, { name: "Ann" });
    const b = await colyseus.connectTo(room, { name: "Bo" });
    room.state.players.get(b.sessionId).score = 10;

    (room as any).roundClock = 0.001;
    await room.waitForNextTimestep();
    assert.strictEqual(room.state.winner, "Bo");

    (room as any).overLeft = 0.001;
    await room.waitForNextTimestep();
    assert.strictEqual(room.state.winner, "");
    assert.strictEqual(room.state.players.get(b.sessionId).score, 0);
  });

  it("stops at a pillar and slides along its face", () => {
    // Corner block at (230, 170), half-extent 40: its left face is x=190, so a player (half 12) stops at 178.
    const e = { x: 177, y: 170, vx: 0, vy: 0 };
    stepEntity(e, { moveX: 1, moveY: 1 }, 1 / TICK_RATE);
    assert.strictEqual(e.x, 177, "blocked on x");
    assert.ok(e.y > 170, "still slides on y");
  });

  it("keeps every gap passable and the spawn area clear", () => {
    const MIN_GAP = 40; // a cube is 24 wide
    for (const [i, a] of OBSTACLES.entries()) {
      for (const [dist, name] of [[a.x - a.hw, "left"], [ARENA_WIDTH - a.x - a.hw, "right"], [a.y - a.hh, "top"], [ARENA_HEIGHT - a.y - a.hh, "bottom"]] as const) {
        assert.ok(dist >= MIN_GAP, `obstacle ${i} too close to ${name} edge`);
      }
      for (const b of OBSTACLES.slice(i + 1)) {
        const gap = Math.max(Math.abs(a.x - b.x) - a.hw - b.hw, Math.abs(a.y - b.y) - a.hh - b.hh);
        assert.ok(gap >= MIN_GAP, `obstacles at (${a.x},${a.y}) and (${b.x},${b.y}) leave a ${gap} gap`);
      }
      // The spawn ring has radius 80 around the center, plus half a cube.
      const cx = Math.max(Math.abs(ARENA_WIDTH / 2 - a.x) - a.hw, 0);
      const cy = Math.max(Math.abs(ARENA_HEIGHT / 2 - a.y) - a.hh, 0);
      assert.ok(Math.hypot(cx, cy) > 92, `obstacle ${i} overlaps the spawn ring`);
    }
  });
});
