import assert from "assert";
import { existsSync } from "fs";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { MyRoomState, type MoveInput } from "../src/rooms/schema/MyRoomState.js";
import { stepEntity } from "../src/shared/movement.js";
import { stepVoidEntity, tileAt, GRID, GONE, SOLID } from "../src/shared/void.js";
import type { VoidState } from "../src/rooms/schema/VoidState.js";
import { PLAYER_SPEED, TICK_RATE, PETS } from "../src/shared/constants.js";
import { ARENAS, ARENA_BY_ID } from "../src/shared/arenas.js";
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
        assert.ok(fromBot[i] >= 6, label + ": a walk of at least 6 cells, so the bot keeps moving");
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
});
