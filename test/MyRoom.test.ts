import assert from "assert";
import { existsSync } from "fs";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoomState, type MoveInput } from "../src/rooms/schema/MyRoomState.js";
import { stepEntity } from "../src/shared/movement.js";
import {
  stepVoidEntity, tileAt, GRID, CELLS, GONE, SOLID, CRACKING, HEX_FLOORS, RED, GREEN, YELLOW, floorZ, fallLimit, dealKinds, breakTime, suddenDeathGap, tileUnder, SUDDEN_DEATH_AT,
} from "../src/shared/void.js";
import { voidModeOf } from "../src/shared/voidModes.js";
import type { VoidState } from "../src/rooms/schema/VoidState.js";
import { PLAYER_SPEED, TICK_RATE, PETS } from "../src/shared/constants.js";
import { ARENAS, ARENA_BY_ID } from "../src/shared/arenas.js";
import { MODES } from "../src/shared/modes.js";
import { inputBudget, InputPacer, MAX_BACKLOG } from "../src/rooms/inputPacing.js";
import { sanitizeName, FALLBACK_NAME } from "../src/shared/names.js";
import { Nav } from "../src/rooms/botNav.js";
import { Predict } from "@colyseus/sdk/predict";

const classic = ARENA_BY_ID.classic;
/** The layouts are drawn for a 1500-wide arena; block positions scale with the real width (sizes do not). */
const K = classic.width / 1500;

describe("testing your Colyseus app", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("advances a player from its buffered input", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { arena: "classic" });
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
    const room = await colyseus.createRoom<MyRoomState>("my_room", { arena: "classic" });
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
    const room = await colyseus.createRoom<MyRoomState>("my_room", { arena: "classic" });
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
    const room = await colyseus.createRoom<MyRoomState>("my_room", { arena: "classic" });
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
    // Corner fortress at (290, 210) in base units, half-extent 45: a player (half 12) stops 57 from its centre.
    const stopX = 290 * K - 57 - 1;
    const e = { x: stopX, y: 210 * K, vx: 0, vy: 0, z: 0, vz: 0 };
    stepEntity(e, { moveX: 1, moveY: 1, jump: 0 }, 1 / TICK_RATE, classic);
    assert.strictEqual(e.x, stopX, "blocked on x");
    assert.ok(e.y > 210 * K, "still slides on y");
  });

  it("every arena is playable: no tight gaps, nothing in the spawn area", () => {
    const MIN_GAP = 40; // a cube is 24 wide
    for (const arena of ARENAS) {
      for (const [i, a] of arena.obstacles.entries()) {
        for (const [dist, name] of [[a.x - a.hw, "left"], [arena.width - a.x - a.hw, "right"], [a.y - a.hh, "top"], [arena.height - a.y - a.hh, "bottom"]] as const) {
          assert.ok(dist >= MIN_GAP, `${arena.id}: obstacle ${i} too close to ${name} edge`);
        }
        for (const b of arena.obstacles.slice(i + 1)) {
          const gap = Math.max(Math.abs(a.x - b.x) - a.hw - b.hw, Math.abs(a.y - b.y) - a.hh - b.hh);
          assert.ok(gap >= MIN_GAP, `${arena.id}: obstacles at (${a.x},${a.y}) and (${b.x},${b.y}) leave a ${gap} gap`);
        }
        // The spawn ring around the middle, plus half a cube.
        const cx = Math.max(Math.abs(arena.width / 2 - a.x) - a.hw, 0);
        const cy = Math.max(Math.abs(arena.height / 2 - a.y) - a.hh, 0);
        assert.ok(Math.hypot(cx, cy) > arena.spawnRadius + 12, `${arena.id}: obstacle ${i} overlaps the spawn ring`);
      }
    }
  });

  it("Ice Rink: you slide, walls still stop you, and normal ground stops at once", () => {
    const ice = ARENA_BY_ID.ice;
    const dt = 1 / TICK_RATE;
    const right = { moveX: 1, moveY: 0, jump: 0 };
    const idle = { moveX: 0, moveY: 0, jump: 0 };
    const e = { x: ice.width / 2, y: ice.height / 2, vx: 0, vy: 0, z: 0, vz: 0 };

    stepEntity(e, right, dt, ice);
    assert.ok(e.vx > 0 && e.vx < PLAYER_SPEED * 0.2, "speeds up gradually, not instantly");
    for (let i = 0; i < 70; i++) { stepEntity(e, right, dt, ice); }
    assert.ok(e.vx > PLAYER_SPEED * 0.95, "reaches nearly full speed");
    stepEntity(e, idle, dt, ice);
    assert.ok(e.vx > PLAYER_SPEED * 0.5, "keeps sliding after you let go");

    const wall = { x: ice.width - 12 - 2, y: ice.height / 2, vx: 250, vy: 0, z: 0, vz: 0 };
    stepEntity(wall, right, dt, ice);
    assert.strictEqual(wall.vx, 0, "the arena wall stops a slide dead");

    const grippy = { x: classic.width / 2, y: classic.height / 2, vx: 0, vy: 0, z: 0, vz: 0 };
    stepEntity(grippy, right, dt, classic);
    assert.strictEqual(grippy.vx, PLAYER_SPEED);
    stepEntity(grippy, idle, dt, classic);
    assert.strictEqual(grippy.vx, 0, "classic ground stops at once");
  });

  it("Moon Dunes: low gravity makes the same jump go much higher", () => {
    const moon = ARENA_BY_ID.moon;
    const dt = 1 / TICK_RATE;
    const apexOf = (arena: typeof moon) => {
      const e = { x: arena.width / 2, y: arena.height / 2, vx: 0, vy: 0, z: 0, vz: 0 };
      let apex = 0;
      stepEntity(e, { moveX: 0, moveY: 0, jump: 1 }, dt, arena);
      for (let i = 0; i < 80; i++) { stepEntity(e, { moveX: 0, moveY: 0, jump: 0 }, dt, arena); apex = Math.max(apex, e.z); }
      return apex;
    };
    const moonApex = apexOf(moon);
    assert.ok(moonApex > 140 && moonApex < 200, `moon apex ${moonApex}`);
    assert.ok(moonApex > apexOf(classic) * 2, "more than twice as high as classic");
  });

  it("The Maze: tall walls cannot be jumped, low walls can", () => {
    const maze = ARENA_BY_ID.maze;
    const dt = 1 / TICK_RATE;
    const climb = (fromY: number) => {
      const e = { x: 330 * K, y: fromY, vx: 0, vy: 0, z: 0, vz: 0 };
      for (let i = 0; i < 45; i++) { stepEntity(e, { moveX: 0, moveY: -1, jump: 1 }, dt, maze); }
      return e.y;
    };
    // Top rail: a tall wall (h100) centred at y=140 (base units), half-thickness 12; a player's edge stops 24 below its centre.
    assert.ok(climb(190 * K) >= 140 * K + 24 - 1, "stopped by the tall wall");
    // Hurdle: a low wall (h45) at y=225 (base units) between x 200..400.
    const hurdle = { x: 300 * K, y: 250 * K, vx: 0, vy: 0, z: 0, vz: 0 };
    for (let i = 0; i < 30; i++) { stepEntity(hurdle, { moveX: 0, moveY: -1, jump: 1 }, dt, maze); }
    assert.ok(hurdle.y < 225 * K - 12, `vaulted the low wall (ended at y=${hurdle.y})`);
  });

  it("jumps high enough for steps but not tall blocks, and lands on surfaces", () => {
    const dt = 1 / TICK_RATE;
    const idle = { moveX: 0, moveY: 0, jump: 0 };

    // Flat ground in the spawn area: leave the floor, peak, come back down.
    const e = { x: classic.width / 2, y: classic.height / 2, vx: 0, vy: 0, z: 0, vz: 0 };
    stepEntity(e, { ...idle, jump: 1 }, dt, classic);
    assert.ok(e.z > 0, "left the ground");
    let apex = e.z;
    for (let i = 0; i < 40; i++) { stepEntity(e, idle, dt, classic); apex = Math.max(apex, e.z); }
    assert.strictEqual(e.z, 0, "landed");
    assert.ok(apex > 55 && apex < 80, `apex ${apex}: clears 50-high steps, not 80-high blocks`);

    // A step (290, 330, h40): a falling player comes to rest on top of it.
    const s = { x: 290 * K, y: 330 * K, vx: 0, vy: 0, z: 60, vz: 0 };
    for (let i = 0; i < 30; i++) { stepEntity(s, idle, dt, classic); }
    assert.strictEqual(s.z, 40);

    // The corner fortress (290, 210, h80) stops a grounded player but not one above it.
    const edgeX = 290 * K - 58;
    const low = { x: edgeX, y: 210 * K, vx: 0, vy: 0, z: 0, vz: 0 };
    stepEntity(low, { ...idle, moveX: 1 }, dt, classic);
    assert.strictEqual(low.x, edgeX, "blocked from the ground");
    const high = { x: edgeX, y: 210 * K, vx: 0, vy: 0, z: 85, vz: 0 };
    stepEntity(high, { ...idle, moveX: 1 }, dt, classic);
    assert.ok(high.x > edgeX, "walks over it from above");
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

  it("rooms rotate arenas each round, respawn everyone, and can be locked", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true });
    await colyseus.connectTo(room, { name: "Ann" });
    await colyseus.connectTo(room, { name: "Bo" });
    const settle = async (done: () => boolean, steps = 90) => {
      for (let i = 0; i < steps && !done(); i++) { await room.waitForNextTimestep(); }
    };

    const first = room.state.arena;
    assert.ok(ARENAS.some((a) => a.id === first), "starts in a known arena");

    (room as any).roundClock = 0.001;
    await settle(() => !!room.state.winner);
    assert.ok(room.state.nextArena && room.state.nextArena !== first, "announces a different arena next");
    const next = room.state.nextArena;

    (room as any).overLeft = 0.001;
    await settle(() => !room.state.winner);
    assert.strictEqual(room.state.arena, next, "the next round uses the announced arena");
    const arena = ARENA_BY_ID[next];
    for (const p of room.state.players.values()) {
      const away = Math.hypot(p.x - arena.width / 2, p.y - arena.height / 2);
      assert.ok(Math.abs(away - arena.spawnRadius) < 5 && p.z === 0, "respawned on the spawn ring");
    }

    const locked = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "ice" });
    await colyseus.connectTo(locked, { name: "Cy" });
    await colyseus.connectTo(locked, { name: "Di" });
    assert.strictEqual(locked.state.arena, "ice");
    (locked as any).roundClock = 0.001;
    for (let i = 0; i < 90 && !locked.state.winner; i++) { await locked.waitForNextTimestep(); }
    assert.strictEqual(locked.state.nextArena, "ice", "a locked room keeps its arena");
  });

  it("quick play is one shared pool, and those rooms are not locked", async () => {
    const a = await colyseus.sdk.joinOrCreate("my_room", { name: "A" });
    const b = await colyseus.sdk.joinOrCreate("my_room", { name: "B" });
    assert.strictEqual(a.roomId, b.roomId, "everyone meets in one room");
    assert.strictEqual((a.state as any).locked, false, "a public room changes arena every round");
  });

  it("the host's arena is the arena from the start, and stays", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "maze" });
    await colyseus.connectTo(room, { name: "Host" });
    assert.strictEqual(room.state.arena, "maze", "the waiting area is the chosen arena");
    assert.strictEqual(room.state.locked, true);
    (room as any).roundClock = 0.001;
    await colyseus.connectTo(room, { name: "Guest" });
    for (let i = 0; i < 60 && !room.state.winner; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(room.state.nextArena, "maze", "it stays in the host's arena");
  });

  it("a burst of inputs (a phone catching up after a hiccup) is spread over ticks, not applied in one lunge", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic" });
    const a = await colyseus.connectTo(room, { name: "A" });
    const input = a.input<MoveInput>({ mode: "reliable" });
    const player = room.state.players.get(a.sessionId);
    const step = PLAYER_SPEED / TICK_RATE; // distance of one input
    const BURST = MAX_BACKLOG; // a bigger pile-up has its oldest inputs dropped (see the pacer test)

    await room.waitForNextTimestep();
    const startX = player.x;
    for (let i = 0; i < BURST; i++) { input.data.moveX = 1; input.data.moveY = 0; input.data.jump = 0; input.send(); }

    const xs: number[] = [startX];
    for (let i = 0; i < 14; i++) { await room.waitForNextTimestep(); xs.push(player.x); }
    const steps = xs.slice(1).map((x, i) => Math.round((x - xs[i]) / step));
    // The server's own clock can run two ticks back to back, so allow a few steps, but 12 in one go is a lunge.
    assert.ok(Math.max(...steps) <= 8, `moved ${Math.max(...steps)} steps in one go: ${steps}`);
    assert.ok(steps.filter((n) => n > 0).length >= 3, `all of it landed in ${steps.filter((n) => n > 0).length} moments: ${steps}`);
    assert.ok(Math.abs(xs[xs.length - 1] - startX - BURST * step) < 0.001, "every input was still applied exactly once");
  });

  it("input pacing: one input a tick, two while a backlog has built up", () => {
    assert.deepStrictEqual([0, 1, 2].map(inputBudget), [1, 1, 1]);
    assert.deepStrictEqual([3, 8, 40].map(inputBudget), [2, 2, 2]);
  });

  it("names: tidied, capped at 12, and a blocked or empty name becomes Player", () => {
    assert.strictEqual(sanitizeName("  Ann   Lee  "), "Ann Lee");
    assert.strictEqual(sanitizeName("a​b‮c"), "abc", "invisible and direction characters are dropped");
    assert.strictEqual(sanitizeName("x".repeat(30)).length, 12);
    assert.strictEqual(sanitizeName(""), FALLBACK_NAME);
    assert.strictEqual(sanitizeName(undefined), FALLBACK_NAME);
    assert.strictEqual(sanitizeName("f.u.c.k"), FALLBACK_NAME, "punctuation does not hide a word");
    assert.strictEqual(sanitizeName("Sh1t"), FALLBACK_NAME, "look-alike characters do not either");
    assert.strictEqual(sanitizeName("Nova"), "Nova");
    for (const bad of ["N1gg3r", "FAGGOT", "x_retard_x", "dildo", "p3d0phile"]) { assert.strictEqual(sanitizeName(bad), FALLBACK_NAME, bad); }
    for (const fine of ["Swank", "Raccoon", "Spice", "Janus", "Class", "Granny"]) { assert.strictEqual(sanitizeName(fine), fine, fine + " is an ordinary name"); }
  });

  it("bots: a lonely player in a public room gets bots, a joining human sends one home, private rooms get none", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { arena: "classic" });
    await colyseus.connectTo(room, { name: "Ann" });
    const bots = () => [...room.state.players.values()].filter((p) => p.name.startsWith("BOT "));
    const settle = async (done: () => boolean) => {
      for (let i = 0; i < 40 && !done(); i++) { await room.waitForNextTimestep(); }
    };

    assert.strictEqual(bots().length, 0, "no bots at first");
    (room as any).botWait = 100; // skip the wait for the first bot
    await settle(() => bots().length >= 1);
    assert.strictEqual(bots().length, 1, "the first bot arrives");
    (room as any).botWait = 100;
    await settle(() => bots().length >= 2);
    (room as any).botWait = 100;
    await settle(() => bots().length >= 3);
    (room as any).botWait = 100;
    await settle(() => bots().length >= 4);
    assert.strictEqual(bots().length, 4, "a lone player gets four bots");
    assert.ok(room.state.players.size >= 5);

    const bot = bots()[0];
    const before = { x: bot.x, y: bot.y };
    for (let i = 0; i < 15; i++) { await room.waitForNextTimestep(); }
    assert.ok(Math.hypot(bot.x - before.x, bot.y - before.y) > 0 || room.state.it !== "", "bots are driven by the room");

    await colyseus.connectTo(room, { name: "Bo" });
    await settle(() => bots().length <= 3);
    assert.strictEqual(bots().length, 3, "one bot left when a second human joined");

    const priv = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic" });
    await colyseus.connectTo(priv, { name: "Cy" });
    (priv as any).botWait = 100;
    for (let i = 0; i < 10; i++) { await priv.waitForNextTimestep(); }
    assert.strictEqual(priv.state.players.size, 1, "private rooms never get bots");
  });

  it("input pacing: a flood cannot move faster than the cap, and a long stall's old inputs are dropped", () => {
    // A client sending two inputs per tick for ten seconds: the steps applied stay near one per tick.
    const flood = new InputPacer();
    let pending = 0;
    let applied = 0;
    const TICKS = 300;
    for (let t = 0; t < TICKS; t++) {
      pending += 2;
      const { drop, apply } = flood.plan(pending);
      pending -= drop + apply;
      applied += apply;
    }
    assert.ok(applied <= TICKS * 1.1 + 3, `applied ${applied} steps in ${TICKS} ticks`);
    assert.ok(pending <= MAX_BACKLOG + 2, `backlog stays bounded (${pending})`);

    // Normal play: one input a tick is always applied.
    const calm = new InputPacer();
    for (let t = 0; t < 50; t++) { assert.deepStrictEqual(calm.plan(1), { drop: 0, apply: 1 }); }

    // A 20-input pile-up after a stall: the oldest are dropped down to the allowed backlog.
    const stall = new InputPacer();
    const plan = stall.plan(20);
    assert.strictEqual(plan.drop, 20 - MAX_BACKLOG);
    assert.ok(plan.apply >= 1 && plan.apply <= 2);
  });

  it("no tag-backs: the player who was just tagged cannot tag straight back while overlapping", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic" });
    const a = await colyseus.connectTo(room);
    const b = await colyseus.connectTo(room);
    const pa = room.state.players.get(a.sessionId);
    const pb = room.state.players.get(b.sessionId);
    pb.x = pa.x; pb.y = pa.y;
    await room.waitForNextTimestep();
    assert.strictEqual(room.state.it, b.sessionId, "tagged");

    (room as any).cooldown = 0; // the cooldown is over, but they still overlap
    for (let i = 0; i < 4; i++) { pb.x = pa.x; pb.y = pa.y; await room.waitForNextTimestep(); }
    assert.strictEqual(room.state.it, b.sessionId, "no immediate tag-back");

    (room as any).safeLeft = 0; // after the protection runs out they can tag again
    (room as any).cooldown = 0;
    pb.x = pa.x; pb.y = pa.y;
    for (let i = 0; i < 4 && room.state.it === b.sessionId; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(room.state.it, a.sessionId, "tag-back works once the protection is over");
  });

  it("round over: the game stops while the winner shows, with a countdown to the next round", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic" });
    const a = await colyseus.connectTo(room, { name: "Ann" });
    await colyseus.connectTo(room, { name: "Bo" });
    const input = a.input<MoveInput>({ mode: "reliable" });
    const pa = room.state.players.get(a.sessionId);

    (room as any).roundClock = 0.001;
    for (let i = 0; i < 6 && !room.state.winner; i++) { await room.waitForNextTimestep(); }
    assert.ok(room.state.winner, "a winner is announced");
    assert.ok(room.state.nextIn >= 1 && room.state.nextIn <= 15, `countdown shows ${room.state.nextIn}`);

    const x = pa.x;
    for (let i = 0; i < 5; i++) { input.data.moveX = 1; input.data.moveY = 0; input.data.jump = 0; input.send(); }
    for (let i = 0; i < 6; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(pa.x, x, "steering does nothing while the winner shows");

    (room as any).overLeft = 0.001;
    for (let i = 0; i < 6 && room.state.winner; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(room.state.nextIn, 0, "the countdown clears when the next round starts");
  });

  it("Orb Rush: orbs appear, touching one scores (gold is worth 3) and a new one replaces it", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic", mode: "orbs" });
    const a = await colyseus.connectTo(room, { name: "Ann" });
    const pa = room.state.players.get(a.sessionId);
    for (let i = 0; i < 8; i++) { await room.waitForNextTimestep(); }
    assert.ok(room.state.orbs.size >= 3 && room.state.orbs.size <= 5, `orbs on the field: ${room.state.orbs.size}`);

    const [id, orb] = [...room.state.orbs.entries()][0];
    const worth = orb.gold ? 3 : 1;
    pa.x = orb.x; pa.y = orb.y; pa.z = orb.z;
    const before = pa.score;
    await room.waitForNextTimestep();
    assert.ok(!room.state.orbs.has(id), "the orb is picked up");
    assert.ok(pa.score >= before + worth, `scored ${pa.score - before}, expected at least ${worth}`);
    for (let i = 0; i < 4; i++) { await room.waitForNextTimestep(); }
    assert.ok(room.state.orbs.size >= 3, "the field is topped up again");
  });

  it("Infection: one red cube spreads by touch, clean players score, and the round ends when all are red", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic", mode: "infect" });
    const ids = [(await colyseus.connectTo(room, { name: "A" })).sessionId, (await colyseus.connectTo(room, { name: "B" })).sessionId, (await colyseus.connectTo(room, { name: "C" })).sessionId];
    const players = ids.map((id) => room.state.players.get(id));
    (room as any).startMode(); // everyone is in: pick the first infected
    const red = () => players.filter((p) => p.hot).length;
    assert.strictEqual(red(), 1, "one infected to start");

    const sick = players.find((p) => p.hot)!;
    const clean = players.filter((p) => !p.hot);
    clean[0].x = sick.x; clean[0].y = sick.y; clean[0].z = sick.z;
    clean[1].x = sick.x + 600; clean[1].y = sick.y;
    await room.waitForNextTimestep();
    assert.strictEqual(red(), 2, "the touch spreads it");
    assert.ok(clean[1].score > 0 || !clean[1].hot, "players still clean keep scoring");

    clean[1].x = sick.x; clean[1].y = sick.y; clean[1].z = sick.z;
    for (let i = 0; i < 4 && !room.state.winner; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(red(), 3, "everyone is red");
    assert.ok(room.state.winner, "the round ends early");
  });

  it("modes rotate: never the same twice, and Infection is skipped with fewer than 3 players", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic" });
    await colyseus.connectTo(room, { name: "A" });
    await colyseus.connectTo(room, { name: "B" });
    assert.strictEqual(room.state.mode, "tag", "the first round is plain Cube Tag");
    for (let i = 0; i < 40; i++) {
      const next = (room as any).pickMode(room.state.mode);
      assert.notStrictEqual(next, room.state.mode, "a different mode each round");
      assert.notStrictEqual(next, "infect", "Infection needs 3 players");
    }

    const locked = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic", mode: "orbs" });
    await colyseus.connectTo(locked, { name: "A" });
    (locked as any).endRound();
    assert.strictEqual(locked.state.nextMode, "orbs", "a host-locked mode stays");
  });

  it("bot navigation: from the middle of every arena, every corner is reachable, and each step leads closer", () => {
    for (const arena of ARENAS) {
      const nav = new Nav(arena);
      const cx = arena.width / 2, cy = arena.height / 2;
      for (const [tx, ty] of [[80, 80], [arena.width - 80, 80], [80, arena.height - 80], [arena.width - 80, arena.height - 80]]) {
        const dist = nav.distancesTo(tx, ty);
        const step = nav.step(dist, cx, cy, true);
        assert.ok(step, `${arena.id}: the middle is on the grid`);
        assert.ok(step.vx || step.vy, `${arena.id}: a way to (${tx}, ${ty})`);
        // Walk it: one cell per step along the suggested direction, until there.
        let x = cx, y = cy;
        let steps = 0;
        while (Math.hypot(x - tx, y - ty) > 40 && steps++ < 400) {
          const s = nav.step(dist, x, y, true);
          if (!s) { break; }
          x += Math.sign(s.vx) * 25; y += Math.sign(s.vy) * 25;
        }
        assert.ok(Math.hypot(x - tx, y - ty) <= 40, `${arena.id}: walked to (${tx}, ${ty}) in ${steps} steps`);
      }
    }
  });

  it("adaptive delay: Predict.track follows setDefaults({ delay }), so a raised delay makes a remote player trail further", async () => {
    // The client (kit.ts trackRemote) relies on this SDK behaviour; this fails if an SDK upgrade changes it.
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic", mode: "tag" });
    const mover = await colyseus.connectTo(room, { name: "Mover" });
    const watcher = await colyseus.connectTo(room, { name: "Watcher" });
    const predict = Predict.get(watcher, { mode: "lerp", delay: 40, smoothMs: 0 });
    watcher.input<MoveInput>({ mode: "reliable" }); // the browser client has one too: it is what brings the server clock
    const remote = watcher.state.players.get(mover.sessionId)!;
    (predict as any).track(remote, "x");

    const input = mover.input<MoveInput>({ mode: "reliable" });
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const dir = remote.x < classic.width / 2 ? 1 : -1; // run toward the farther wall so the mover does not stop
    const drive = setInterval(() => { input.data.moveX = dir; input.data.moveY = 0; input.send(); }, 33);
    const pump = setInterval(() => predict.tick(performance.now()), 16);
    // Average distance the drawn position is behind the newest one over a short run (short: the arena has walls).
    const lag = async () => {
      let total = 0;
      for (let i = 0; i < 12; i++) { await sleep(33); total += dir * (remote.x - predict.value(remote, "x")); }
      return total / 12;
    };
    await sleep(700); // let the server clock settle
    const before = await lag();
    predict.setDefaults({ delay: 400 });
    await sleep(400);
    const after = await lag();
    clearInterval(drive); clearInterval(pump);
    assert.ok(after > before + 30, "lag before " + before.toFixed(0) + ", after " + after.toFixed(0) + " units");
  });

  it("bots running away: the goal is open ground they reach first, never a corner, in every arena", () => {
    for (const arena of ARENAS) {
      const nav = new Nav(arena);
      const spots: [number, number][] = [[0.25, 0.25], [0.75, 0.3], [0.3, 0.8], [0.8, 0.8], [0.15, 0.5], [0.55, 0.15], [0.9, 0.55]];
      let tested = 0;
      for (const [fx, fy] of spots) {
        const bot = { x: arena.width * fx, y: arena.height * fy };
        const threat = { x: arena.width / 2, y: arena.height / 2 };
        const fromBot = nav.distancesTo(bot.x, bot.y);
        const fromThreat = nav.distancesTo(threat.x, threat.y);
        if (fromBot.filter((d) => d >= 0).length < 1000) { continue; } // that spot is inside a block
        tested++;
        const goal = nav.fleeGoal(fromBot, fromThreat);
        const label = arena.id + " from " + fx + "," + fy;
        assert.ok(goal, label + ": has somewhere to run");
        const corner = Math.min(goal.x, arena.width - goal.x) < 150 && Math.min(goal.y, arena.height - goal.y) < 150;
        assert.ok(!corner, label + ": not a corner (" + goal.x + ", " + goal.y + ")");
        assert.ok(nav.roomAt(goal.x, goal.y) >= 35, label + ": room to keep running");
        const cell = (v: number) => Math.min(Math.floor(v / 25), 1e9);
        const i = Math.floor(goal.y / 25) * nav.cols + cell(goal.x);
        assert.ok(fromBot[i] >= 10, label + ": a real trip of at least 10 cells, so the bot keeps moving");
        assert.ok(fromBot[i] + 3 < fromThreat[i], label + ": the bot gets there first");
      }
      assert.ok(tested >= 2, arena.id + ": enough open spots to test");
    }
  });

  it("bots running away keep moving instead of standing still", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { arena: "classic", mode: "tag" });
    await colyseus.connectTo(room, { name: "Ann" });
    for (let i = 0; i < 4; i++) { (room as any).botWait = 100; for (let k = 0; k < 6; k++) { await room.waitForNextTimestep(); } }
    const bots = [...room.state.players.entries()].filter(([id]) => id.startsWith("bot-"));
    assert.strictEqual(bots.length, 4, "four bots");
    const start = new Map(bots.map(([id, p]) => [id, [p.x, p.y]]));
    const travelled = new Map(bots.map(([id]) => [id, 0]));
    const last = new Map(start);
    for (let i = 0; i < 150; i++) { // five seconds
      await room.waitForNextTimestep();
      for (const [id, p] of bots) {
        const [lx, ly] = last.get(id)!;
        travelled.set(id, travelled.get(id)! + Math.hypot(p.x - lx, p.y - ly));
        last.set(id, [p.x, p.y]);
      }
    }
    const moving = bots.filter(([id, p]) => travelled.get(id)! > 200 && !p.hot);
    const runners = bots.filter(([, p]) => !p.hot);
    assert.ok(runners.length >= 3 && moving.length >= runners.length - 1, "runners on the move: " + [...travelled.values()].map((v) => v.toFixed(0)).join(", "));
  });

  it("ready: the next round starts once every player is ready, not before; bots never hold it up; early taps are ignored", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic" });
    const a = await colyseus.connectTo(room, { name: "Ann" });
    const b = await colyseus.connectTo(room, { name: "Bo" });
    const pa = room.state.players.get(a.sessionId)!, pb = room.state.players.get(b.sessionId)!;
    (room as any).roundClock = 0.001;
    for (let i = 0; i < 6 && !room.state.winner; i++) { await room.waitForNextTimestep(); }
    assert.ok(room.state.winner, "the round ended");
    assert.ok(room.state.nextIn > 5, "there is a real wait now (" + room.state.nextIn + "s)");
    assert.ok(!pa.ready && !pb.ready, "nobody starts ready");

    a.send("ready"); // right as the round ends: ignored, so a stray tap cannot skip the card
    for (let i = 0; i < 3; i++) { await room.waitForNextTimestep(); }
    assert.ok(!pa.ready, "a tap in the first moments is ignored");

    (room as any).overLeft = 10; // past the lock
    a.send("ready");
    for (let i = 0; i < 4; i++) { await room.waitForNextTimestep(); }
    assert.ok(pa.ready && !pb.ready, "Ann is ready, Bo is not");
    assert.ok(room.state.winner, "the card stays while Bo is not ready");

    b.send("ready");
    for (let i = 0; i < 6 && room.state.winner; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(room.state.winner, "", "the next round started as soon as both were ready");
    assert.ok(!pa.ready && !pb.ready, "ready is cleared for the next wait");
  });

  it("juke: a sharp bot with a chaser right behind can sidestep, at right angles to the chase", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { arena: "classic", mode: "tag" });
    const ann = await colyseus.connectTo(room, { name: "Ann" });
    (room as any).botWait = 100;
    for (let k = 0; k < 8; k++) { await room.waitForNextTimestep(); }
    const botId = [...room.state.players.keys()].find((id) => id.startsWith("bot-"))!;
    const bot = room.state.players.get(botId)!;
    const brain = (room as any).bots.get(botId);
    const chaser = room.state.players.get(ann.sessionId)!;
    (room as any).setIt(ann.sessionId);
    bot.x = 900; bot.y = 700; chaser.x = 820; chaser.y = 700; // the chaser is 80 units to the left
    brain.skill = 2; brain.slipLeft = 0; brain.goalUntil = 0;
    const random = Math.random;
    Math.random = () => 0.01; // always under the juke chance
    try { (room as any).steer(botId, bot, brain); } finally { Math.random = random; }
    assert.ok(brain.slipLeft > 0, "it started a sidestep");
    assert.strictEqual(brain.slipX, 0, "no push along the chase line");
    assert.ok(Math.abs(brain.slipY) === 1, "it dodges sideways");

    brain.skill = 0; brain.slipLeft = 0; brain.goalUntil = 0;
    Math.random = () => 0.01;
    try { (room as any).steer(botId, bot, brain); } finally { Math.random = random; }
    assert.strictEqual(brain.slipLeft, 0, "a sloppy bot never juked");
  });

  it("ready: a lone human with bots only has to press Ready themself", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { arena: "classic", mode: "tag" });
    const a = await colyseus.connectTo(room, { name: "Ann" });
    for (let i = 0; i < 3; i++) { (room as any).botWait = 100; for (let k = 0; k < 6; k++) { await room.waitForNextTimestep(); } }
    (room as any).roundClock = 0.001;
    for (let i = 0; i < 6 && !room.state.winner; i++) { await room.waitForNextTimestep(); }
    const players = [...room.state.players.entries()];
    assert.ok(players.filter(([id]) => id.startsWith("bot-")).every(([, p]) => p.ready), "bots are ready at once");
    assert.ok(!room.state.players.get(a.sessionId)!.ready, "the human is not");
    (room as any).overLeft = 10;
    a.send("ready");
    for (let i = 0; i < 6 && room.state.winner; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(room.state.winner, "", "the round started when the one human was ready");
  });

  it("Voidfall bots: a lone player gets four, a joining human sends one home, private rooms get none", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", {});
    await colyseus.connectTo(room, { name: "Ann" });
    const step = () => (room as any).step({ dt: 1 / 30 });
    const bots = () => [...room.state.players.values()].filter((p) => p.name.startsWith("BOT "));
    for (let i = 0; i < 2000 && bots().length < 4; i++) { step(); }
    assert.strictEqual(bots().length, 4, "four bots for one human");
    await colyseus.connectTo(room, { name: "Bo" });
    for (let i = 0; i < 400 && bots().length > 3; i++) { step(); }
    assert.strictEqual(bots().length, 3, "a second human sends one home");

    const priv = await colyseus.createRoom<VoidState>("void_room", { private: true });
    await colyseus.connectTo(priv, { name: "Cy" });
    for (let i = 0; i < 600; i++) { (priv as any).step({ dt: 1 / 30 }); }
    assert.strictEqual(priv.state.players.size, 1, "private rooms never get bots");
  });

  it("Voidfall bots play a whole round: they spread their falls out and a winner is found", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", {});
    await colyseus.connectTo(room, { name: "Ann" }); // stands still and falls
    const step = () => (room as any).step({ dt: 1 / 30 });
    for (let i = 0; i < 2000 && room.state.players.size < 5; i++) { step(); }
    for (let i = 0; i < 300 && room.state.phase !== "playing"; i++) { step(); }
    assert.strictEqual(room.state.phase, "playing", "the round started with bots");
    let seconds = 0;
    const falls: number[] = [];
    const out = new Set<string>();
    for (let i = 0; i < 4000 && room.state.phase === "playing"; i++) {
      step(); seconds += 1 / 30;
      for (const [id, p] of room.state.players) { if (!p.alive && !out.has(id)) { out.add(id); falls.push(seconds); } }
    }
    assert.strictEqual(room.state.phase, "over", "the round ended");
    assert.ok(room.state.winner, "a winner was named");
    assert.ok(seconds > 2.5, "the bots lasted a while (" + seconds.toFixed(1) + "s)");
    const botFalls = falls.slice(1); // the first is Ann, who stood still
    assert.ok(botFalls.length >= 3 && botFalls[botFalls.length - 1] - botFalls[0] > 0.3, "bots did not all fall at once");
  });

  it("Voidfall bots jump a one-tile gap to reach solid ground", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", {});
    const ann = await colyseus.connectTo(room, { name: "Ann" });
    (room as any).addBot(); (room as any).addBot();
    const [a, b] = [...room.state.players.entries()].filter(([id]) => id.startsWith("bot-")).map(([, p]) => p);
    room.state.players.get(ann.sessionId)!.alive = false;
    for (let i = 0; i < room.state.tiles.length; i++) { room.state.tiles[i] = GONE; }
    const at = (x: number, y: number) => y * GRID + x;
    const crack = (room as any).crack as number[];
    // Bot A stands on tile (2,4) with its tile about to drop; (3,4) is gone; (4,4) is solid. Bot B waits elsewhere.
    room.state.tiles[at(2, 4)] = CRACKING; crack[at(2, 4)] = 0.4;
    room.state.tiles[at(4, 4)] = SOLID;
    room.state.tiles[at(7, 7)] = CRACKING; crack[at(7, 7)] = 5;
    Object.assign(a, { x: 250, y: 450, z: 0, vz: 0 });
    Object.assign(b, { x: 750, y: 750, z: 0, vz: 0 });
    (room as any).bots.get([...room.state.players.entries()].find(([, p]) => p === a)![0]).skill = 2;
    room.state.phase = "playing";
    for (let i = 0; i < 50; i++) { (room as any).step({ dt: 1 / 30 }); }
    assert.ok(a.alive, "bot A is still alive");
    assert.strictEqual(tileAt(a.x, a.y), at(4, 4), "bot A crossed the gap to (4,4)");
  });

  it("ready: a player whose connection dropped does not hold the next round up", async () => {
    const room = await colyseus.createRoom<MyRoomState>("my_room", { private: true, arena: "classic" });
    const a = await colyseus.connectTo(room, { name: "Ann" });
    const b = await colyseus.connectTo(room, { name: "Bo" });
    (room as any).roundClock = 0.001;
    for (let i = 0; i < 6 && !room.state.winner; i++) { await room.waitForNextTimestep(); }
    (room as any).overLeft = 10;
    (room as any).away.add(b.sessionId); // Bo's connection dropped (the room holds the seat)
    a.send("ready");
    for (let i = 0; i < 8 && room.state.winner; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(room.state.winner, "", "Ann was ready and Bo is away, so the round started");
  });

  // ---- Long simulations with bots, stepped by hand: bad numbers, bots leaving the arena, rounds that never end, joins and leaves mid-round.
  for (const arena of ARENAS) {
    for (const mode of MODES) {
      it(`Cube Tag ${arena.id} / ${mode.id}: 200 s with bots, everyone stays finite and inside the arena, rounds end`, async () => {
        const room = await colyseus.createRoom<any>("my_room", { arena: arena.id, mode: mode.id });
        const a = await colyseus.connectTo(room, { name: "Ann" });
        const b = await colyseus.connectTo(room, { name: "Bo" });
        const step = () => (room as any).step({ dt: 1 / 30 });
        let rounds = 0, lastRound = room.state.round, readies = 0;
        for (let i = 0; i < 30 * 200; i++) {
          if (room.state.players.size < 5) { (room as any).botWait = 100; }
          step();
          if (room.state.round !== lastRound) { rounds++; lastRound = room.state.round; }
          if (room.state.winner && (room as any).overLeft > 12 && readies < 40) { a.send("ready"); b.send("ready"); readies++; }
          if (i % 15 === 0) {
            const bounds = (room as any).arena;
            for (const [id, p] of room.state.players) {
              assert.ok([p.x, p.y, p.z, p.vx, p.vy, p.vz].every(Number.isFinite), `${id} has a bad number at step ${i}`);
              assert.ok(p.x >= -1 && p.y >= -1 && p.x <= bounds.width + 1 && p.y <= bounds.height + 1, `${id} left the arena at step ${i}`);
            }
          }
        }
        assert.ok(rounds >= 1, "a round ended and the next began");
      });
    }
  }

  it("Voidfall with bots: 40 rounds, every one ends, nothing goes wrong, bots are topped up", async () => {
    const room = await colyseus.createRoom<any>("void_room", {});
    const ann = await colyseus.connectTo(room, { name: "Ann" });
    const step = () => (room as any).step({ dt: 1 / 30 });
    let rounds = 0, phaseTime = 0, lastPhase = "";
    for (let i = 0; i < 30 * 3000 && rounds < 40; i++) {
      step();
      const s = room.state;
      if (s.phase === "over" && (room as any).phaseClock > 10) { ann.send("ready"); (room as any).phaseClock = 10; } // Ready, so the winner card does not wait out its 15 seconds
      if (s.phase !== lastPhase) { if (lastPhase === "playing") { rounds++; } lastPhase = s.phase; phaseTime = 0; }
      phaseTime += 1 / 30;
      assert.ok(!(s.phase === "playing" && phaseTime > 120), "a round is stuck");
      for (const [id, p] of s.players) { assert.ok([p.x, p.y, p.z, p.vz].every(Number.isFinite), `${id} has a bad number`); }
    }
    assert.strictEqual(rounds, 40, "40 rounds finished");
    assert.strictEqual([...room.state.players.values()].filter((p: any) => p.name.startsWith("BOT")).length, 4, "still four bots");
  });

  it("Voidfall: a human who joins mid-round watches, then plays; the last human leaving empties the room", async () => {
    const room = await colyseus.createRoom<any>("void_room", {});
    const a = await colyseus.connectTo(room, { name: "Ann" });
    const step = () => (room as any).step({ dt: 1 / 30 });
    for (let i = 0; i < 3000 && room.state.phase !== "playing"; i++) { step(); }
    const b = await colyseus.connectTo(room, { name: "Bo" });
    assert.strictEqual(room.state.players.get(b.sessionId).alive, false, "a mid-round joiner watches");
    for (let i = 0; i < 3000 && room.state.phase !== "over"; i++) { step(); }
    for (let i = 0; i < 700 && room.state.phase === "over"; i++) { step(); } // the winner card waits (up to 15 s) for Ready
    for (let i = 0; i < 100; i++) { step(); }
    assert.strictEqual(room.state.players.get(b.sessionId).alive, true, "Bo plays the next round");
    assert.strictEqual([...room.state.players.values()].filter((p: any) => p.name.startsWith("BOT")).length, 3, "three bots for two humans");
    await a.leave(); await b.leave();
    for (let i = 0; i < 100 && room.state.players.size > 0; i++) { try { step(); } catch { break; } }
    assert.strictEqual(room.state.players.size, 0, "nobody is left in the room");
  });

  it("Voidfall: the winner is not moved while the winner banner shows, even when someone joins", async () => {
    const room = await colyseus.createRoom<any>("void_room", {});
    await colyseus.connectTo(room, { name: "Ann" });
    const step = () => (room as any).step({ dt: 1 / 30 });
    // A round whose last two players fall together has nobody left standing: go again until someone survives.
    let winner: any;
    for (let attempt = 0; attempt < 6 && !winner; attempt++) {
      for (let i = 0; i < 4000 && room.state.phase !== "over"; i++) { step(); }
      assert.strictEqual(room.state.phase, "over");
      winner = [...room.state.players.values()].find((p: any) => p.alive);
      if (!winner) { (room as any).phaseClock = 0.001; for (let i = 0; i < 5; i++) { step(); } }
    }
    assert.ok(winner, "a round ended with a survivor");
    const spot = [winner.x, winner.y];
    await colyseus.connectTo(room, { name: "Bo" });
    for (let i = 0; i < 100 && room.state.phase === "over"; i++) { step(); }
    if (room.state.phase === "over") { assert.deepStrictEqual([winner.x, winner.y], spot, "the winner stayed where they were"); }
  });

  // ---------------- Hex-A-Gone
  const hexTiles = (fill = SOLID) => new Array<number>(CELLS * HEX_FLOORS).fill(fill);
  const standing = (x = 450, y = 450, z = 0) => ({ x, y, vx: 0, vy: 0, z, vz: 0 });
  const IDLE = { moveX: 0, moveY: 0, jump: 0 };

  it("Hex-A-Gone physics: a gap drops you onto the floor below, or out if there is no tile there", () => {
    const cell = tileAt(450, 450);
    // A tile below the gap: fall from floor 0 and land on floor 1.
    const tiles = hexTiles();
    tiles[cell] = GONE;
    const p = standing();
    for (let i = 0; i < 60; i++) { stepVoidEntity(p, IDLE, 1 / 30, tiles); }
    assert.strictEqual(p.z, floorZ(1), "landed on floor 1");
    assert.strictEqual(p.vz, 0);
    assert.strictEqual(tileUnder(p, tiles), CELLS + cell, "standing on the floor 1 tile");
    // No tile on floor 1 either: on to floor 2.
    tiles[CELLS + cell] = GONE;
    for (let i = 0; i < 60; i++) { stepVoidEntity(p, IDLE, 1 / 30, tiles); }
    assert.strictEqual(p.z, floorZ(2), "landed on floor 2");
    // Nothing anywhere below: falls past the limit.
    tiles[2 * CELLS + cell] = GONE;
    for (let i = 0; i < 120; i++) { stepVoidEntity(p, IDLE, 1 / 30, tiles); }
    assert.ok(p.z < fallLimit(HEX_FLOORS), "out, below the fall limit (" + p.z.toFixed(0) + ")");
  });

  it("Hex-A-Gone physics: a fast fall cannot skip a floor, and steering is full on a lower floor but weak in the air", () => {
    const tiles = hexTiles();
    const cell = tileAt(450, 450);
    tiles[cell] = GONE; // only floor 0 is open here
    const p = standing(450, 450, 0);
    p.vz = -5000; // far faster than any real fall: one tick covers more than a whole floor gap
    stepVoidEntity(p, IDLE, 1 / 30, tiles);
    assert.strictEqual(p.z, floorZ(1), "caught by floor 1 even at that speed");
    // On floor 1 you steer at full speed.
    const onLower = standing(450, 450, floorZ(1));
    stepVoidEntity(onLower, { moveX: 1, moveY: 0, jump: 0 }, 1 / 30, tiles);
    assert.ok(Math.abs(onLower.vx - PLAYER_SPEED) < 1, "full steering standing on floor 1 (" + onLower.vx + ")");
    // Between floors, falling, you do not.
    const faller = standing(450, 450, -60);
    faller.vz = -200;
    stepVoidEntity(faller, { moveX: 1, moveY: 0, jump: 0 }, 1 / 30, tiles);
    assert.ok(faller.vx < PLAYER_SPEED * 0.5, "weak steering while falling (" + faller.vx + ")");
  });

  it("Hex-A-Gone physics: a jump from a lower floor cannot reach the floor above", () => {
    const tiles = hexTiles();
    const p = standing(450, 450, floorZ(1));
    let highest = p.z;
    for (let i = 0; i < 40; i++) { stepVoidEntity(p, { moveX: 0, moveY: 0, jump: i === 0 ? 1 : 0 }, 1 / 30, tiles); highest = Math.max(highest, p.z); }
    assert.ok(highest > floorZ(1) + 40, "it did jump");
    assert.ok(highest < floorZ(0), "but stayed below the floor above (" + highest.toFixed(0) + ")");
    assert.strictEqual(p.z, floorZ(1), "and landed back on floor 1");
  });

  it("Hex-A-Gone tiles: 243 kinds, never red in the middle of the top floor, a nastier mix lower down, faster breaks lower down", () => {
    const share = (floor: number, kind: number, deals: number[][]) =>
      deals.reduce((n, d) => n + d.slice(floor * CELLS, (floor + 1) * CELLS).filter((k) => k === kind).length, 0) / (deals.length * CELLS);
    const deals = Array.from({ length: 200 }, () => dealKinds());
    assert.strictEqual(deals[0].length, CELLS * HEX_FLOORS);
    for (const deal of deals) {
      for (const j of [3, 4, 5]) { for (const i of [3, 4, 5]) { assert.notStrictEqual(deal[j * GRID + i], RED, "no red under the start ring"); } }
    }
    const red = [0, 1, 2].map((f) => share(f, RED, deals));
    assert.ok(red[0] < red[1] && red[1] < red[2], "more red lower down: " + red.map((r) => r.toFixed(2)).join(", "));
    assert.ok(Math.abs(red[2] - 0.35) < 0.05 && Math.abs(red[1] - 0.2) < 0.05, "close to the planned mix");
    assert.strictEqual(breakTime(0, GREEN), 2);
    assert.ok(breakTime(2, RED) < breakTime(0, RED) && breakTime(2, GREEN) < breakTime(1, GREEN) && breakTime(1, GREEN) < breakTime(0, GREEN), "every floor down is faster");
    assert.ok(breakTime(0, RED) < 0.6 && breakTime(0, GREEN) > 1.8, "red is almost at once, green lasts");
  });

  it("Hex-A-Gone sudden death: one crack a second at first, then faster, never faster than four a second", () => {
    assert.strictEqual(suddenDeathGap(SUDDEN_DEATH_AT), 1);
    assert.ok(Math.abs(suddenDeathGap(SUDDEN_DEATH_AT + 20) - 0.6) < 1e-9);
    assert.strictEqual(suddenDeathGap(SUDDEN_DEATH_AT + 500), 0.25);
  });

  it("Hex-A-Gone round: 243 tiles with a kind each, tiles break at their own speed, the room can be locked to it", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", { private: true, mode: "hex" });
    assert.strictEqual(room.state.mode, "hex");
    assert.ok(room.state.modeLocked);
    assert.strictEqual(room.state.tiles.length, CELLS * HEX_FLOORS);
    assert.strictEqual(room.state.kinds.length, CELLS * HEX_FLOORS);
    const a = await colyseus.connectTo(room, { name: "Ann" });
    await colyseus.connectTo(room, { name: "Bo" });
    const step = () => (room as any).step({ dt: 1 / 30 });
    for (let i = 0; i < 300 && room.state.phase !== "playing"; i++) { step(); }
    assert.strictEqual(room.state.phase, "playing");
    const me = room.state.players.get(a.sessionId)!;
    for (let i = 0; i < 3; i++) { step(); }
    const idx = tileUnder(me, room.state.tiles);
    assert.ok(idx >= 0 && idx < CELLS, "Ann is standing on a top-floor tile");
    assert.strictEqual(room.state.tiles[idx], CRACKING, "it started cracking");
    const expected = breakTime(0, room.state.kinds[idx]);
    const left = ((room as any).crack as number[])[idx];
    assert.ok(left <= expected && left > expected - 0.2, "it breaks in its own " + expected + "s (" + left.toFixed(2) + " left)");
  });

  it("Hex-A-Gone sudden death cracks a tile on a floor someone is on", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", { private: true, mode: "hex" });
    const a = await colyseus.connectTo(room, { name: "Ann" });
    const b = await colyseus.connectTo(room, { name: "Bo" });
    const me = room.state.players.get(a.sessionId)!;
    Object.assign(me, { z: floorZ(2) }); // Ann is on the bottom floor
    room.state.players.get(b.sessionId)!.alive = false; // and Bo is out, so hers is the only floor in play
    const before = [...room.state.tiles].filter((v) => v === CRACKING).length;
    for (let i = 0; i < 20; i++) { (room as any).crackRandomTile(); }
    const cracked: number[] = [];
    room.state.tiles.forEach((v, i) => { if (v === CRACKING) { cracked.push(Math.floor(i / CELLS)); } });
    assert.ok(cracked.length > before, "tiles started cracking");
    assert.ok(cracked.every((f) => f === 2), "all on the floor Ann is on");
  });

  it("Voidfall modes take turns (bots play Hex-A-Gone, so a lone human gets it too); a locked room keeps its mode", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", {});
    await colyseus.connectTo(room, { name: "Ann" });
    const seen: string[] = [room.state.mode];
    for (let r = 0; r < 4; r++) {
      room.state.phase = "playing";
      (room as any).finish(undefined);
      (room as any).phaseClock = 0.001;
      (room as any).step({ dt: 1 / 30 });
      seen.push(room.state.mode);
    }
    assert.deepStrictEqual(seen, ["classic", "hex", "classic", "hex", "classic"], "they take turns");
    assert.strictEqual(room.state.tiles.length, CELLS, "back to one floor");
    assert.strictEqual(room.state.kinds.length, 0, "and no kinds");

    const locked = await colyseus.createRoom<VoidState>("void_room", { private: true, mode: "classic" });
    await colyseus.connectTo(locked, { name: "Ann" });
    locked.state.phase = "playing";
    (locked as any).finish(undefined);
    assert.strictEqual(locked.state.nextMode, "classic", "a locked room keeps its mode");
  });

  it("Hex-A-Gone: the bots take part (alive, spread on the top floor) and come back for classic", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", {});
    await colyseus.connectTo(room, { name: "Ann" });
    const step = () => (room as any).step({ dt: 1 / 30 });
    const bots = () => [...room.state.players.values()].filter((p) => p.name.startsWith("BOT "));
    for (let i = 0; i < 3000 && bots().length < 4; i++) { step(); }
    assert.strictEqual(bots().length, 4);
    room.state.nextMode = "hex";
    (room as any).newRound();
    assert.strictEqual(room.state.mode, "hex");
    assert.ok(bots().every((b) => b.alive && b.z === 0), "bots are in the Hex-A-Gone round, on the top floor");
    room.state.nextMode = "classic";
    (room as any).newRound();
    assert.strictEqual(room.state.mode, "classic");
    assert.ok(bots().every((b) => b.alive), "and in the classic one");
  });

  it("Voidfall ready: the winner card waits for Ready and starts the next round as soon as everyone has pressed it", async () => {
    const room = await colyseus.createRoom<VoidState>("void_room", { private: true });
    const a = await colyseus.connectTo(room, { name: "Ann" });
    const b = await colyseus.connectTo(room, { name: "Bo" });
    room.state.phase = "playing";
    (room as any).finish(undefined);
    assert.ok(room.state.nextIn > 5, "a real wait (" + room.state.nextIn + "s)");
    a.send("ready");
    for (let i = 0; i < 4; i++) { await room.waitForNextTimestep(); }
    assert.ok(!room.state.players.get(a.sessionId)!.ready, "a tap in the first moments is ignored");
    (room as any).phaseClock = 10;
    a.send("ready");
    for (let i = 0; i < 4; i++) { await room.waitForNextTimestep(); }
    assert.strictEqual(room.state.phase, "over", "it waits for Bo");
    b.send("ready");
    for (let i = 0; i < 6 && room.state.phase === "over"; i++) { await room.waitForNextTimestep(); }
    assert.notStrictEqual(room.state.phase, "over", "both ready: the next round begins");
    assert.strictEqual(room.state.round, 2);
  });

  it("Hex-A-Gone long run: a public room with two humans alternates modes for 20 rounds and every round ends", async () => {
    const room = await colyseus.createRoom<any>("void_room", {});
    const a = await colyseus.connectTo(room, { name: "Ann" });
    const b = await colyseus.connectTo(room, { name: "Bo" });
    const step = () => (room as any).step({ dt: 1 / 30 });
    let rounds = 0, lastPhase = "", phaseTime = 0;
    const modes = new Set<string>();
    for (let i = 0; i < 30 * 3000 && rounds < 20; i++) {
      step();
      const s = room.state;
      if (s.phase === "over" && (room as any).phaseClock > 10) { a.send("ready"); b.send("ready"); (room as any).phaseClock = 10; }
      if (s.phase !== lastPhase) { if (lastPhase === "playing") { rounds++; modes.add(s.mode); } lastPhase = s.phase; phaseTime = 0; }
      phaseTime += 1 / 30;
      assert.ok(!(s.phase === "playing" && phaseTime > 150), "a round is stuck (" + s.mode + ")");
      assert.strictEqual(s.tiles.length, voidModeOf(s.mode).floors * CELLS, "tiles match the mode");
      for (const [id, p] of s.players) { assert.ok([p.x, p.y, p.z, p.vz].every(Number.isFinite), id + " has a bad number"); }
    }
    assert.strictEqual(rounds, 20, "20 rounds finished");
    assert.ok(modes.has("classic") && modes.has("hex"), "both modes were played");
  });

  /** A Hex-A-Gone room with one bot placed by hand, every tile gone except what a test puts back. */
  async function botOnTile(cell: [number, number], floor = 0) {
    // A public room (private ones send bots home), switched to Hex-A-Gone by hand.
    const room = await colyseus.createRoom<VoidState>("void_room", {});
    const ann = await colyseus.connectTo(room, { name: "Ann" });
    await colyseus.connectTo(room, { name: "Bo" });
    (room as any).setupMode("hex");
    (room as any).addBot();
    (room as any).addBot();
    const entries = [...room.state.players.entries()].filter(([id]) => id.startsWith("bot-"));
    const [botId, bot] = entries[0];
    // The other bot and both humans are out of the way.
    for (const [id, p] of room.state.players) { if (id !== botId) { p.alive = false; } }
    void ann;
    for (let i = 0; i < room.state.tiles.length; i++) { room.state.tiles[i] = GONE; }
    const brain = (room as any).bots.get(botId);
    brain.skill = 2;
    Object.assign(bot, { x: (cell[0] + 0.5) * 100, y: (cell[1] + 0.5) * 100, z: floorZ(floor), vz: 0 });
    const at = (f: number, x: number, y: number) => f * CELLS + y * GRID + x;
    const set = (f: number, x: number, y: number, kind: number) => {
      room.state.tiles[at(f, x, y)] = SOLID;
      room.state.kinds[at(f, x, y)] = kind;
      (room as any).breakAt[at(f, x, y)] = breakTime(f, kind);
    };
    const crackHere = (seconds: number) => {
      room.state.tiles[at(floor, cell[0], cell[1])] = CRACKING;
      ((room as any).crack as number[])[at(floor, cell[0], cell[1])] = seconds;
    };
    room.state.phase = "playing";
    // Keep a second bot alive so the round does not end at once.
    const other = entries[1][1];
    other.alive = true;
    Object.assign(other, { x: 850, y: 850, z: 0, vz: 0 });
    set(0, 8, 8, GREEN);
    (room as any).breakAt[at(0, 8, 8)] = 99;
    room.state.tiles[at(0, 8, 8)] = CRACKING;
    ((room as any).crack as number[])[at(0, 8, 8)] = 99;
    return { room, bot, set, crackHere, at };
  }
  const run = (room: any, ticks: number) => { for (let i = 0; i < ticks; i++) { room.step({ dt: 1 / 30 }); } };

  it("Hex-A-Gone bots: leaving a tile, they pick the lasting green neighbour over a red one", async () => {
    let green = 0, red = 0;
    for (let trial = 0; trial < 12; trial++) {
      const { room, bot, set, crackHere } = await botOnTile([4, 4]);
      set(0, 4, 4, YELLOW);
      set(0, 5, 4, GREEN); // east: green
      set(0, 3, 4, RED);   // west: red
      crackHere(0.3);
      run(room, 25);
      const cell = tileAt(bot.x, bot.y);
      if (bot.alive && cell === 4 * GRID + 5) { green++; }
      if (cell === 4 * GRID + 3) { red++; }
      await colyseus.cleanup();
    }
    assert.ok(green >= 9 && red <= 2, "green " + green + " times, red " + red + " times out of 12");
  });

  it("Hex-A-Gone bots: with nothing left on their floor they drop through a gap onto the floor below and live", async () => {
    const { room, bot, set, crackHere } = await botOnTile([4, 4]);
    set(0, 4, 4, YELLOW);
    set(1, 5, 4, GREEN); // below the gap east of the bot: a solid tile on floor 1
    crackHere(0.3);
    const trace: string[] = [];
    // A sharp bot hesitates at the worst moment about once in 200 decisions: pin the dice so this test is about the drop, not luck.
    const random = Math.random;
    Math.random = () => 0.5;
    try { for (let i = 0; i < 35; i++) { (room as any).step({ dt: 1 / 30 }); if (i % 3 === 0) { trace.push(i + ":x" + bot.x.toFixed(0) + ",z" + bot.z.toFixed(0)); } } } finally { Math.random = random; }
    // about a second: it has dropped and is standing on the lower tile, which has 1.7 s to live
    assert.ok(bot.alive, "still alive: " + trace.join(" "));
    assert.strictEqual(bot.z, floorZ(1), "dropped to floor 1: " + trace.join(" "));
    assert.strictEqual(tileUnder(bot, room.state.tiles), CELLS + 4 * GRID + 5, "standing on the tile below the gap");
  });

  it("Hex-A-Gone bots: a bot never drops where there is nothing below", async () => {
    const { room, bot, set, crackHere } = await botOnTile([4, 4]);
    set(0, 4, 4, YELLOW); // no tile anywhere below
    crackHere(0.3);
    run(room, 40);
    assert.ok(Math.abs(bot.x - 450) < 1 && Math.abs(bot.y - 450) < 1, "it stayed on its own tile and did not walk off on purpose");
  });

  it("Hex-A-Gone with bots: a round with only bots and one idle human ends, bots use several floors, nothing goes wrong", async () => {
    const room = await colyseus.createRoom<any>("void_room", {});
    const ann = await colyseus.connectTo(room, { name: "Ann" });
    const step = () => (room as any).step({ dt: 1 / 30 });
    for (let i = 0; i < 4000 && [...room.state.players.values()].filter((p: any) => p.name.startsWith("BOT")).length < 4; i++) { step(); }
    let hexRounds = 0, lowestSeen = 0;
    let lastPhase = "", phaseTime = 0, longest = 0;
    for (let i = 0; i < 30 * 3000 && hexRounds < 12; i++) {
      step();
      const s = room.state;
      if (s.phase === "over" && (room as any).phaseClock > 10) { ann.send("ready"); (room as any).phaseClock = 10; }
      if (s.phase !== lastPhase) { if (lastPhase === "playing" && s.mode === "hex") { hexRounds++; longest = Math.max(longest, phaseTime); } lastPhase = s.phase; phaseTime = 0; }
      phaseTime += 1 / 30;
      assert.ok(!(s.phase === "playing" && phaseTime > 200), "a round is stuck (" + s.mode + ")");
      if (s.mode === "hex" && s.phase === "playing") {
        for (const [id, p] of s.players) {
          assert.ok([p.x, p.y, p.z, p.vz].every(Number.isFinite), id + " has a bad number");
          if (id.startsWith("bot-") && p.alive) { lowestSeen = Math.min(lowestSeen, p.z); }
        }
      }
    }
    assert.strictEqual(hexRounds, 12, "12 Hex-A-Gone rounds finished");
    assert.ok(lowestSeen <= floorZ(1), "bots went down to a lower floor at some point (" + lowestSeen + ")");
  });
});
