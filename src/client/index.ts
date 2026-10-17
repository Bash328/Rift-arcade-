import { ColyseusSDK, Callbacks } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import type { default as server } from "../app.config.js";
import type { MoveInput } from "../rooms/schema/MyRoomState.js";
import * as THREE from "three";
import { stepEntity } from "../shared/movement.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ARENA_WIDTH, ARENA_HEIGHT, PLAYER_HALF, OBSTACLES } from "../shared/constants.js";

/** Initial canvas size; resize() fits it to the cabinet screen. */
const VIEW_W = 960;
const VIEW_H = 720;

const statusEl = document.getElementById("status")!;
const arenaEl = document.getElementById("arena")!;
const boardEl = document.getElementById("board")!;
const stickEl = document.getElementById("stick")!;
const knobEl = document.getElementById("knob")!;
const lampEl = document.getElementById("itLamp")!;

const client = new ColyseusSDK<typeof server>(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(VIEW_W, VIEW_H, false); // CSS sizes the canvas to its cabinet screen
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
arenaEl.appendChild(renderer.domElement);

const NEON_CYAN = 0x00e5ff;
const NEON_PINK = 0xff2bd6;
const FOG = 0x120826;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, 0.0004);

// Screen-space gradient sky.
{
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#05020f");
  grad.addColorStop(0.55, "#3b0f5c");
  grad.addColorStop(1, "#0a0418");
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
}

scene.add(new THREE.HemisphereLight(0x8a6cff, 0x120826, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(ARENA_WIDTH / 2 + 350, 900, ARENA_HEIGHT / 2 + 350);
sun.target.position.set(ARENA_WIDTH / 2, 0, ARENA_HEIGHT / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 750, bottom: -750, near: 1, far: 2500 });
scene.add(sun, sun.target);

/** A dark solid box with glowing edges. Sim (x, y) maps to world (x, z). */
function neonBox(w: number, h: number, d: number, x: number, y: number, z: number, edge: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x16102b, roughness: 0.6 }));
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edge })));
  scene.add(mesh);
  return mesh;
}

// Floating slab with a low rim wall around the playable area.
const RIM = 16;
const slab = neonBox(ARENA_WIDTH + RIM * 2, 40, ARENA_HEIGHT + RIM * 2, ARENA_WIDTH / 2, -20, ARENA_HEIGHT / 2, NEON_CYAN);
(slab.material as THREE.MeshStandardMaterial).color.set(0x0b0b1a);
const WALL_H = 30;
neonBox(RIM, WALL_H, ARENA_HEIGHT + RIM * 2, -RIM / 2, WALL_H / 2, ARENA_HEIGHT / 2, NEON_PINK);
neonBox(RIM, WALL_H, ARENA_HEIGHT + RIM * 2, ARENA_WIDTH + RIM / 2, WALL_H / 2, ARENA_HEIGHT / 2, NEON_PINK);
neonBox(ARENA_WIDTH + RIM * 2, WALL_H, RIM, ARENA_WIDTH / 2, WALL_H / 2, -RIM / 2, NEON_PINK);
neonBox(ARENA_WIDTH + RIM * 2, WALL_H, RIM, ARENA_WIDTH / 2, WALL_H / 2, ARENA_HEIGHT + RIM / 2, NEON_PINK);
// Long walls glow pink, blocks and pillars cyan, so the layout reads at a glance.
for (const o of OBSTACLES) {
  const long = Math.max(o.hw, o.hh) > 2 * Math.min(o.hw, o.hh);
  neonBox(o.hw * 2, o.h, o.hh * 2, o.x, o.h / 2, o.y, long ? NEON_PINK : NEON_CYAN);
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

const camera = new THREE.PerspectiveCamera(50, VIEW_W / VIEW_H, 1, 4000);
// Desktop: a fixed camera that frames the whole arena.
const overviewPos = new THREE.Vector3(ARENA_WIDTH / 2, ARENA_HEIGHT * 1.1, ARENA_HEIGHT * 1.47);
const overviewLook = new THREE.Vector3(ARENA_WIDTH / 2, 0, ARENA_HEIGHT / 2);
camera.position.copy(overviewPos);
camera.lookAt(overviewLook);

// Bloom is what makes the bright lines and emissive cubes glow.
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(VIEW_W, VIEW_H, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(VIEW_W, VIEW_H), 0.9, 0.5, 0.7));
composer.addPass(new OutputPass());

// The screen's size depends on the device (4:3 on desktop, tall on a phone), so
// the canvas follows whatever box the cabinet gives it.
function resize() {
  const w = Math.max(arenaEl.clientWidth, 1);
  const h = Math.max(arenaEl.clientHeight, 1);
  const ratio = Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(ratio);
  composer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(arenaEl);
resize();

// Pooled particles, used for movement trails and the tag burst.
const particleGeo = new THREE.BoxGeometry(1, 1, 1);
const pool = Array.from({ length: 300 }, () => {
  const mesh = new THREE.Mesh(particleGeo, new THREE.MeshBasicMaterial({ transparent: true }));
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, vel: new THREE.Vector3(), life: 0, max: 1, size: 1 };
});

function emit(pos: THREE.Vector3, color: THREE.ColorRepresentation, vel: THREE.Vector3, life: number, size: number) {
  const p = pool.find((q) => q.life <= 0);
  if (!p) { return; }
  p.mesh.position.copy(pos);
  (p.mesh.material as THREE.MeshBasicMaterial).color.set(color);
  p.vel.copy(vel);
  p.life = p.max = life;
  p.size = size;
  p.mesh.visible = true;
}

function updateParticles(dt: number) {
  for (const p of pool) {
    if (p.life <= 0) { continue; }
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    const k = p.life / p.max;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.scale.setScalar(p.size * k);
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = k;
  }
}

const held = new Set<string>();
addEventListener("keydown", (e) => {
  // Arrow keys would otherwise scroll the page now that the canvas is tall.
  if (e.key.startsWith("Arrow") || e.key === " ") { e.preventDefault(); }
  held.add(e.key.toLowerCase());
});
addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));

/** Opposite keys cancel out, so the axis is always exactly -1, 0 or 1. */
function axis(negative: string[], positive: string[]): -1 | 0 | 1 {
  const back = negative.some((k) => held.has(k));
  const forward = positive.some((k) => held.has(k));
  if (back === forward) { return 0; }
  return back ? -1 : 1;
}

// On-screen joystick: drag it on a phone (or with a mouse). It reports the same
// -1/0/1 axes as the keyboard, and mirrors the keyboard when nobody is touching it.
const stick = { x: 0 as -1 | 0 | 1, y: 0 as -1 | 0 | 1, active: false };

function moveKnob(x: number, y: number) {
  knobEl.style.transform = `translate(${x}px, ${y}px)`;
}

function dragStick(e: PointerEvent) {
  const r = stickEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2);
  let dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 3;
  const len = Math.hypot(dx, dy);
  if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
  const dead = max * 0.4;
  stick.x = Math.abs(dx) > dead ? (Math.sign(dx) as -1 | 1) : 0;
  stick.y = Math.abs(dy) > dead ? (Math.sign(dy) as -1 | 1) : 0;
  moveKnob(dx, dy);
}

function releaseStick() {
  stick.active = false;
  stick.x = 0;
  stick.y = 0;
  moveKnob(0, 0);
}

stickEl.addEventListener("pointerdown", (e) => {
  stick.active = true;
  stickEl.setPointerCapture(e.pointerId);
  dragStick(e);
});
stickEl.addEventListener("pointermove", (e) => { if (stick.active) { dragStick(e); } });
stickEl.addEventListener("pointerup", releaseStick);
stickEl.addEventListener("pointercancel", releaseStick);

// Jump button: hold to keep jumping. Space does the same on a keyboard.
const jumpEl = document.getElementById("jump")!;
let jumpHeld = false;
const setJump = (down: boolean) => { jumpHeld = down; jumpEl.classList.toggle("down", down); };
jumpEl.addEventListener("pointerdown", (e) => { jumpEl.setPointerCapture(e.pointerId); setJump(true); });
for (const type of ["pointerup", "pointercancel"]) { jumpEl.addEventListener(type, () => setJump(false)); }

function askName(): string {
  try {
    const saved = localStorage.getItem("name");
    if (saved) { return saved; }
    const name = prompt("Your name?")?.trim() || "Player";
    localStorage.setItem("name", name);
    return name;
  } catch {
    return "Player";
  }
}

async function main() {
  const room = await client.joinOrCreate("my_room", { name: askName() });
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

  const cubes = new Map<string, THREE.Mesh>();
  const callbacks = Callbacks.get(room);

  callbacks.onAdd("players", (player, sessionId) => {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(PLAYER_HALF * 2, PLAYER_HALF * 2, PLAYER_HALF * 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(player.hue / 360, 0.7, 0.55) }),
    );
    cube.castShadow = true;
    scene.add(cube);
    cubes.set(sessionId, cube);
  });

  callbacks.onRemove("players", (_player, sessionId) => {
    scene.remove(cubes.get(sessionId)!);
    cubes.delete(sessionId);
  });

  room.onLeave(() => {
    statusEl.textContent = "Disconnected";
    cubes.forEach((cube) => scene.remove(cube));
    cubes.clear();
  });

  let boardKey = "";
  function drawBoard() {
    const rows = [...room.state.players.entries()]
      .map(([id, p]) => ({ id, name: p.name, hue: p.hue, score: Math.floor(p.score) }))
      .sort((a, b) => b.score - a.score);
    const key = JSON.stringify([rows, room.state.it]);
    if (key === boardKey) { return; }
    boardKey = key;
    // textContent only: names come from other players.
    boardEl.replaceChildren(...rows.map((r) => {
      const row = document.createElement("div");
      const swatch = document.createElement("i");
      swatch.style.background = `hsl(${r.hue} 70% 55%)`;
      row.append(swatch, `${r.name}${r.id === room.sessionId ? " (you)" : ""}${r.id === room.state.it ? " [IT]" : ""}: ${r.score}`);
      return row;
    }));
  }

  let prevIt = room.state.it;
  let last = performance.now();
  const zero = new THREE.Vector3();

  // A phone can't fit the whole arena on screen, so the camera chases the player
  // there; desktop keeps the fixed overview.
  const followMq = matchMedia("(pointer: coarse), (max-width: 700px)");
  const camGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  const look = overviewLook.clone();

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    // Drives prediction, interpolation and the reconciler, and returns how many
    // fixed steps came due - so input rate follows the simulation rate, not the
    // monitor's refresh rate.
    const steps = predict.tick(now);

    for (let i = 0; i < steps; i++) {
      input.data.moveX = axis(["a", "arrowleft"], ["d", "arrowright"]) || stick.x;
      input.data.moveY = axis(["w", "arrowup"], ["s", "arrowdown"]) || stick.y;
      input.data.jump = held.has(" ") || jumpHeld ? 1 : 0;
      input.send();
    }

    // A new "it": pop the cube and burst particles from it.
    if (room.state.it !== prevIt) {
      const cube = cubes.get(room.state.it);
      if (cube && prevIt) {
        cube.userData.pop = 1;
        for (let i = 0; i < 30; i++) {
          const v = new THREE.Vector3((Math.random() - 0.5) * 500, Math.random() * 250, (Math.random() - 0.5) * 500);
          emit(cube.position, i % 2 ? 0xff4040 : 0xffffff, v, 0.7, 7);
        }
      }
      prevIt = room.state.it;
    }

    for (const [sessionId, player] of room.state.players) {
      const cube = cubes.get(sessionId);
      if (!cube) { continue; }
      const isIt = sessionId === room.state.it;
      const base = isIt ? 1.3 : 1;
      // Squash and stretch right after being tagged.
      const pop = cube.userData.pop ?? 0;
      cube.userData.pop = Math.max(0, pop - dt / 0.4);
      const w = pop * pop;
      cube.scale.set(base * (1 + 0.5 * w), base * (1 - 0.4 * w), base * (1 + 0.5 * w));
      // Predicted for us, interpolated for everyone else - one read either way.
      cube.position.set(predict.value(player, "x"), PLAYER_HALF * cube.scale.y + predict.value(player, "z"), predict.value(player, "y"));
      const mat = cube.material as THREE.MeshStandardMaterial;
      mat.emissive.set(isIt ? 0xff2020 : 0x000000);

      // Trail: a fading speck whenever the cube has moved.
      const prev = cube.userData.trail as THREE.Vector3 | undefined;
      if (!prev || prev.distanceTo(cube.position) > 6) {
        if (prev) { emit(prev, isIt ? 0xff4040 : mat.color, zero, 0.4, 9); }
        cube.userData.trail = cube.position.clone();
      }
    }
    updateParticles(dt);

    if (!stick.active) {
      const reach = (stickEl.offsetWidth / 3) * 0.8;
      moveKnob(axis(["a", "arrowleft"], ["d", "arrowright"]) * reach, axis(["w", "arrowup"], ["s", "arrowdown"]) * reach);
    }
    lampEl.classList.toggle("on", room.state.it === room.sessionId);

    const mine = cubes.get(room.sessionId);
    if (followMq.matches && mine) {
      const fx = Math.min(Math.max(mine.position.x, 140), ARENA_WIDTH - 140);
      const fz = Math.min(Math.max(mine.position.z, 120), ARENA_HEIGHT - 80);
      camGoal.set(fx, 300, fz + 300);
      lookGoal.set(fx, 0, fz);
    } else {
      camGoal.copy(overviewPos);
      lookGoal.copy(overviewLook);
    }
    camera.position.lerp(camGoal, 0.12);
    look.lerp(lookGoal, 0.12);
    camera.lookAt(look);

    drawBoard();
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
