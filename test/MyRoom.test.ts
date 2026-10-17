import assert from "assert";
import { existsSync } from "fs";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoomState, type MoveInput } from "../src/rooms/schema/MyRoomState.js";
import { stepEntity } from "../src/shared/movement.js";
import { stepVoidEntity, tileAt, GRID, GONE, SOLID } from "../src/shared/void.js";
import type { VoidState } from "../src/rooms/schema/VoidState.js";
import { ARENA_WIDTH, ARENA_HEIGHT, OBSTACLES, PLAYER_SPEED, TICK_RATE, PETS } from "../src/shared/constants.js";

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

    // Wait a few steps rather than exactly one: a step already in flight can use the old clock.
    const settle = async (done: () => boolean) => {
      for (let i = 0; i < 5 && !done(); i++) { await room.waitForNextTimestep(); }
    };

    (room as any).roundClock = 0.001;
    await settle(() => !!room.state.winner);
    assert.strictEqual(room.state.winner, "Bo");

    (room as any).overLeft = 0.001;
    await settle(() => !room.state.winner);
    assert.ok(!room.state.winner, "winner cleared for the new round");
    // Reset to ~0: the new round may already have ticked once or twice.
    assert.ok(room.state.players.get(b.sessionId).score < 0.2, "scores reset for the new round");
  });

  it("stops at a pillar and slides along its face", () => {
    // Corner block at (230, 170), half-extent 40: its left face is x=190, so a player (half 12) stops at 178.
    const e = { x: 177, y: 170, vx: 0, vy: 0, z: 0, vz: 0 };
    stepEntity(e, { moveX: 1, moveY: 1, jump: 0 }, 1 / TICK_RATE);
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

  it("jumps high enough for steps but not tall blocks, and lands on surfaces", () => {
    const dt = 1 / TICK_RATE;
    const idle = { moveX: 0, moveY: 0, jump: 0 };

    // Flat ground in the spawn area: leave the floor, peak, come back down.
    const e = { x: 600, y: 450, vx: 0, vy: 0, z: 0, vz: 0 };
    stepEntity(e, { ...idle, jump: 1 }, dt);
    assert.ok(e.z > 0, "left the ground");
    let apex = e.z;
    for (let i = 0; i < 40; i++) { stepEntity(e, idle, dt); apex = Math.max(apex, e.z); }
    assert.strictEqual(e.z, 0, "landed");
    assert.ok(apex > 55 && apex < 80, `apex ${apex}: clears 50-high steps, not 80-high blocks`);

    // A step (230, 275, h40): a falling player comes to rest on top of it.
    const s = { x: 230, y: 275, vx: 0, vy: 0, z: 60, vz: 0 };
    for (let i = 0; i < 30; i++) { stepEntity(s, idle, dt); }
    assert.strictEqual(s.z, 40);

    // The corner block (230, 170, h80) stops a grounded player but not one above it.
    const low = { x: 177, y: 170, vx: 0, vy: 0, z: 0, vz: 0 };
    stepEntity(low, { ...idle, moveX: 1 }, dt);
    assert.strictEqual(low.x, 177, "blocked from the ground");
    const high = { x: 177, y: 170, vx: 0, vy: 0, z: 85, vz: 0 };
    stepEntity(high, { ...idle, moveX: 1 }, dt);
    assert.ok(high.x > 177, "walks over it from above");
  });

  it("uses a 4-letter code as the room id, and keeps private rooms out of quick play", async () => {
    const priv = await colyseus.createRoom<MyRoomState>("my_room", { private: true });
    assert.match(priv.roomId, /^[A-HJ-NP-Z]{4}$/);

    // Quick play must not land in the private room; the code still works.
    const quick = await colyseus.sdk.joinOrCreate("my_room", { name: "Quick" });
    assert.notStrictEqual(quick.roomId, priv.roomId);
    const friend = await colyseus.sdk.joinById(priv.roomId, { name: "Friend" });
    assert.strictEqual(friend.roomId, priv.roomId);
    assert.strictEqual(priv.state.players.size, 1);
  });

  it("Voidfall physics: stand on a tile, fall when it is gone, land from a jump", () => {
    const dt = 1 / TICK_RATE;
    const idle = { moveX: 0, moveY: 0, jump: 0 };
    const tiles = new Array(GRID * GRID).fill(SOLID);
    const e = { x: 450, y: 450, vx: 0, vy: 0, z: 0, vz: 0 };

    for (let i = 0; i < 10; i++) { stepVoidEntity(e, idle, dt, tiles); }
    assert.strictEqual(e.z, 0, "stays put on a solid tile");

    stepVoidEntity(e, { ...idle, jump: 1 }, dt, tiles);
    assert.ok(e.z > 0, "jumps");
    for (let i = 0; i < 40; i++) { stepVoidEntity(e, idle, dt, tiles); }
    assert.strictEqual(e.z, 0, "lands again");

    tiles[tileAt(e.x, e.y)] = GONE;
    for (let i = 0; i < 40; i++) { stepVoidEntity(e, idle, dt, tiles); }
    assert.ok(e.z < -300, "falls once the tile is gone");

    // Off the edge of the grid there is nothing to stand on either.
    const edge = { x: 899, y: 450, vx: 0, vy: 0, z: 0, vz: 0 };
    for (let i = 0; i < 10; i++) { stepVoidEntity(edge, { ...idle, moveX: 1 }, dt, tiles); }
    assert.ok(edge.z < 0, "walks off the edge and drops");
  });

  it("Voidfall round: countdown, tiles crack, the last player standing wins", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", {});
    const ann = await colyseus.connectTo(room, { name: "Ann" });
    await colyseus.connectTo(room, { name: "Bo" });
    const settle = async (done: () => boolean, steps = 90) => {
      for (let i = 0; i < steps && !done(); i++) { await room.waitForNextTimestep(); }
    };

    assert.match(room.roomId, /^[A-HJ-NP-Z]{4}$/);
    await settle(() => room.state.phase === "countdown");
    assert.strictEqual(room.state.phase, "countdown");

    (room as any).phaseClock = 0.001;
    await settle(() => room.state.phase === "playing");
    assert.strictEqual(room.state.phase, "playing");

    await settle(() => [...room.state.tiles].some((t) => t !== SOLID));
    assert.ok([...room.state.tiles].some((t) => t !== SOLID), "a tile cracked under someone");

    // Take the floor out from under Ann.
    const a = room.state.players.get(ann.sessionId);
    a.x = 50; a.y = 50;
    room.state.tiles[0] = GONE;
    await settle(() => room.state.phase === "over");
    assert.strictEqual(a.alive, false);
    assert.strictEqual(room.state.phase, "over");
    assert.strictEqual(room.state.winner, "Bo");
  });

  it("has a model file for every pet", () => {
    for (const pet of PETS) { assert.ok(existsSync(`public/models/animal-${pet}.glb`), `missing ${pet}`); }
  });
});
