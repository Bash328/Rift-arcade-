import { ColyseusSDK, Callbacks } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import * as THREE from "three";
import type { default as server } from "../app.config.js";
import type { MoveInput } from "../rooms/schema/MyRoomState.js";
import type { MyRoom } from "../rooms/MyRoom.js";
import { stepEntity } from "../shared/movement.js";
import { ARENA_WIDTH, ARENA_HEIGHT, PLAYER_HALF, OBSTACLES } from "../shared/constants.js";
import {
  NEON_CYAN, NEON_PINK, createStage, neonBox, createParticles, createControls,
  runLobby, showRoomTag, createCameraRig, drawBoard, createAudio, jumpSounds, createFullscreen, SHADOW_MAP,
} from "./kit.js";
import { Avatar } from "./avatars.js";

const statusEl = document.getElementById("status")!;
const arenaEl = document.getElementById("arena")!;
const boardEl = document.getElementById("board")!;
const lampEl = document.getElementById("itLamp")!;

const client = new ColyseusSDK<typeof server>(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
);

const { scene, camera, composer } = createStage(arenaEl);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(ARENA_WIDTH / 2 + 350, 900, ARENA_HEIGHT / 2 + 350);
sun.target.position.set(ARENA_WIDTH / 2, 0, ARENA_HEIGHT / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 750, bottom: -750, near: 1, far: 2500 });
scene.add(sun, sun.target);

// Floating slab with a low rim wall around the playable area.
const RIM = 16;
const slab = neonBox(scene, ARENA_WIDTH + RIM * 2, 40, ARENA_HEIGHT + RIM * 2, ARENA_WIDTH / 2, -20, ARENA_HEIGHT / 2, NEON_CYAN);
(slab.material as THREE.MeshStandardMaterial).color.set(0x0b0b1a);
const WALL_H = 30;
neonBox(scene, RIM, WALL_H, ARENA_HEIGHT + RIM * 2, -RIM / 2, WALL_H / 2, ARENA_HEIGHT / 2, NEON_PINK);
neonBox(scene, RIM, WALL_H, ARENA_HEIGHT + RIM * 2, ARENA_WIDTH + RIM / 2, WALL_H / 2, ARENA_HEIGHT / 2, NEON_PINK);
neonBox(scene, ARENA_WIDTH + RIM * 2, WALL_H, RIM, ARENA_WIDTH / 2, WALL_H / 2, -RIM / 2, NEON_PINK);
neonBox(scene, ARENA_WIDTH + RIM * 2, WALL_H, RIM, ARENA_WIDTH / 2, WALL_H / 2, ARENA_HEIGHT + RIM / 2, NEON_PINK);
// Long walls glow pink, blocks and pillars cyan, so the layout reads at a glance.
for (const o of OBSTACLES) {
  const long = Math.max(o.hw, o.hh) > 2 * Math.min(o.hw, o.hh);
  neonBox(scene, o.hw * 2, o.h, o.hh * 2, o.x, o.h / 2, o.y, long ? NEON_PINK : NEON_CYAN);
}

// Glowing ring marking the spawn area in the middle.
const ring = new THREE.Mesh(
  new THREE.RingGeometry(100, 104, 64),
  new THREE.MeshBasicMaterial({ color: NEON_CYAN, side: THREE.DoubleSide }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.set(ARENA_WIDTH / 2, 0.6, ARENA_HEIGHT / 2);
scene.add(ring);

// 50-unit neon grid on the floor.
const gridPoints: THREE.Vector3[] = [];
for (let x = 0; x <= ARENA_WIDTH; x += 50) { gridPoints.push(new THREE.Vector3(x, 0.5, 0), new THREE.Vector3(x, 0.5, ARENA_HEIGHT)); }
for (let z = 0; z <= ARENA_HEIGHT; z += 50) { gridPoints.push(new THREE.Vector3(0, 0.5, z), new THREE.Vector3(ARENA_WIDTH, 0.5, z)); }
scene.add(new THREE.LineSegments(
  new THREE.BufferGeometry().setFromPoints(gridPoints),
  new THREE.LineBasicMaterial({ color: 0x00b8d9, transparent: true, opacity: 0.45 }),
));

const particles = createParticles(scene);
const controls = createControls();
const audio = createAudio();
createFullscreen();
const onVz = jumpSounds(audio);
const moveCamera = createCameraRig(
  camera,
  new THREE.Vector3(ARENA_WIDTH / 2, ARENA_HEIGHT * 1.1, ARENA_HEIGHT * 1.47),
  new THREE.Vector3(ARENA_WIDTH / 2, 0, ARENA_HEIGHT / 2),
  { minX: 140, maxX: ARENA_WIDTH - 140, minZ: 120, maxZ: ARENA_HEIGHT - 80 },
);

const quickPlay = (name: string) => client.joinOrCreate("my_room", { name });
type GameRoom = Awaited<ReturnType<typeof quickPlay>>;

async function main() {
  const room = await runLobby<GameRoom>({
    quick: quickPlay,
    create: (name) => client.create("my_room", { name, private: true }),
    byId: (code, name) => client.joinById<MyRoom>(code, { name }),
  });
  showRoomTag(room, "Cube Tag");
  audio.play("join");
  const predict = Predict.get(room);

  // Other players' inputs aren't ours to predict: interpolate them toward the
  // latest snapshot instead. `smoothMs` springs the interpolated output - ~65 ms
  // of extra display lag buys velocity that stays continuous even when the
  // snapshot stream is rough. Use 0 where draw == hit precision matters most.
  predict.attachAll("players", { mode: "lerp", fields: ["x", "y", "z"], smoothMs: 65 });

  const input = room.input<MoveInput>({ mode: "reliable" });

  // The first patch is what creates our own Player.
  await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  const self = room.state.players.get(room.sessionId);

  predict.reconciler(self, {
    input,
    fields: ["x", "y", "vx", "vy", "z", "vz"],
    // The same function the server runs - determinism is the whole contract.
    step: (ctx, predicted, command) => stepEntity(predicted, command, ctx.dt),
  });

  const avatars = new Map<string, Avatar>();
  const callbacks = Callbacks.get(room);

  callbacks.onAdd("players", (player, sessionId) => {
    avatars.set(sessionId, new Avatar(scene, player.pet, player.hue));
  });

  callbacks.onRemove("players", (_player, sessionId) => {
    avatars.get(sessionId)?.dispose();
    avatars.delete(sessionId);
  });

  room.onLeave(() => {
    statusEl.textContent = "Disconnected";
    avatars.forEach((avatar) => avatar.dispose());
    avatars.clear();
  });

  let boardKey = "";
  function refreshBoard() {
    const rows = [...room.state.players.entries()]
      .map(([id, p]) => ({ id, name: p.name, hue: p.hue, score: Math.floor(p.score) }))
      .sort((a, b) => b.score - a.score);
    const key = JSON.stringify([rows, room.state.it]);
    if (key === boardKey) { return; }
    boardKey = key;
    drawBoard(boardEl, rows.map((r) => ({
      hue: r.hue,
      text: `${r.name}${r.id === room.sessionId ? " (you)" : ""}${r.id === room.state.it ? " [IT]" : ""}: ${r.score}`,
    })));
  }

  let prevIt = room.state.it;
  let last = performance.now();
  let prevWinner = "";
  const zero = new THREE.Vector3();
  const feet = new THREE.Vector3();
  const chest = new THREE.Vector3();

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    // Drives prediction, interpolation and the reconciler, and returns how many
    // fixed steps came due - so input rate follows the simulation rate, not the
    // monitor's refresh rate.
    const steps = predict.tick(now);

    for (let i = 0; i < steps; i++) {
      Object.assign(input.data, controls.read());
      input.send();
    }

    // A new "it": pop the pet and burst sparkles from it.
    if (room.state.it !== prevIt) {
      const avatar = avatars.get(room.state.it);
      if (avatar && prevIt) {
        audio.play("tag", room.state.it === room.sessionId || prevIt === room.sessionId ? 1 : 0.4);
        avatar.pop = 1;
        chest.copy(avatar.group.position).y += PLAYER_HALF;
        for (let i = 0; i < 30; i++) {
          const v = new THREE.Vector3((Math.random() - 0.5) * 500, Math.random() * 250, (Math.random() - 0.5) * 500);
          particles.emit(chest, i % 2 ? 0xff4040 : 0xffffff, v, 0.7, 7, "star");
        }
      }
      prevIt = room.state.it;
    }

    for (const [sessionId, player] of room.state.players) {
      const avatar = avatars.get(sessionId);
      if (!avatar) { continue; }
      const isIt = sessionId === room.state.it;
      // Predicted for us, interpolated for everyone else - one read either way.
      feet.set(predict.value(player, "x"), predict.value(player, "z"), predict.value(player, "y"));
      avatar.update(dt, feet, { it: isIt, celebrate: !!room.state.winner && player.name === room.state.winner });

      // Trail: a fading glow whenever the pet has moved.
      if (!avatar.trail || avatar.trail.distanceTo(feet) > 14) {
        if (avatar.trail) { particles.emit(avatar.trail, isIt ? 0xff4040 : 0x66e6ff, zero, 0.45, 5); }
        avatar.trail = feet.clone().setY(feet.y + 6);
      }
    }
    particles.update(dt);

    const me = room.state.players.get(room.sessionId);
    if (me) { onVz(predict.value(me, "vz")); }
    if (room.state.winner && !prevWinner) { audio.play("win"); }
    prevWinner = room.state.winner ?? "";

    controls.syncKnob();
    lampEl.classList.toggle("on", room.state.it === room.sessionId);
    moveCamera(avatars.get(room.sessionId)?.group.position);

    refreshBoard();
    const { timeLeft, winner, it } = room.state;
    statusEl.textContent = winner
      ? `Round over! Winner: ${winner}`
      : room.state.players.size < 2
        ? "Waiting for another player..."
        : `${timeLeft}s${it === room.sessionId ? " - YOU'RE IT!" : ""}`;
    composer.render();

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  statusEl.textContent = "Could not connect";
});
