import { ColyseusSDK, Callbacks } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { default as server } from "../app.config.js";
import type { MoveInput } from "../rooms/schema/MyRoomState.js";
import type { MyRoom } from "../rooms/MyRoom.js";
import { stepEntity } from "../shared/movement.js";
import { PLAYER_HALF } from "../shared/constants.js";
import { ARENAS, arenaOf, type Arena } from "../shared/arenas.js";
import {
  createStage, neonBox, loadFx, createParticles, createControls,
  runLobby, showRoomTag, createCameraRig, drawBoard, createAudio, jumpSounds, createFullscreen, createDebugHud, LITE, gameReady, showFatal, SHADOW_MAP,
} from "./kit.js";
import { Avatar } from "./avatars.js";
import { skinObstacle, rimScenery } from "./scenery.js";

const statusEl = document.getElementById("status")!;
const arenaEl = document.getElementById("arena")!;
const boardEl = document.getElementById("board")!;
const lampEl = document.getElementById("itLamp")!;

const client = new ColyseusSDK<typeof server>(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
);

const { scene, camera, composer, renderer, adaptQuality, renderScale, look } = createStage(arenaEl);
const debug = createDebugHud(arenaEl, renderer, renderScale);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
scene.add(sun, sun.target);

/** Everything that belongs to the current arena, so it can be swapped for the next one. */
const arenaGroup = new THREE.Group();
scene.add(arenaGroup);
let shownArena = "";

// Painted once and kept: arena swaps only dispose geometry and materials, not these.
const floorTextures = new Map<string, THREE.Texture>();
let iceEnv: THREE.Texture | undefined;
let starSprite: THREE.Texture | undefined;
let earthTexture: THREE.Texture | undefined;

/** Black sky: a scatter of stars and the Earth hanging behind the arena. */
function addMoonSky(parent: THREE.Object3D, W: number, H: number) {
  const pts = new Float32Array(3 * (LITE ? 500 : 1100));
  // A backdrop behind the far wall, where the camera's sky strip actually looks.
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = -2500 + Math.random() * (W + 5000); pts[i + 1] = 80 + Math.random() * 900; pts[i + 2] = -1400 + Math.random() * 2800;
  }
  starSprite ??= loadFx("star_04");
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pts, 3)),
    new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, map: starSprite, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
  );
  stars.frustumCulled = false;
  parent.add(stars);

  if (!earthTexture) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1f5fbf"; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 14; i++) { g.fillStyle = "#3f9a5a"; g.beginPath(); g.ellipse(Math.random() * 256, 20 + Math.random() * 88, 8 + Math.random() * 26, 5 + Math.random() * 14, 0, 0, 7); g.fill(); }
    for (let i = 0; i < 18; i++) { g.fillStyle = "rgba(255,255,255,0.7)"; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 128, 10 + Math.random() * 30, 3 + Math.random() * 6, 0, 0, 7); g.fill(); }
    earthTexture = new THREE.CanvasTexture(c);
    earthTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const earth = new THREE.Mesh(new THREE.SphereGeometry(110, 32, 20), new THREE.MeshBasicMaterial({ map: earthTexture, fog: false }));
  earth.position.set(-60, 160, -120); // just behind the far-left corner, rising over the wall
  parent.add(earth);
}

/** Falling snow (ice) or slow dust motes (moon); `driftStep` moves them and wraps them back into the arena. */
let drift: { attr: THREE.BufferAttribute; fall: number; top: number; x0: number; xr: number; z0: number; zr: number } | null = null;
let flakeSprite: THREE.Texture | undefined;

function addDrift(parent: THREE.Object3D, W: number, H: number, kind: "snow" | "dust" | "fireflies" | "sparks") {
  const snow = kind === "snow";
  const count = (snow ? 520 : kind === "dust" ? 60 : kind === "sparks" ? 70 : 45) >> (LITE ? 1 : 0);
  // Snow also fills the space around the rink; the others stay over the arena.
  const [x0, xr, z0, zr] = snow ? [-1300, W + 2600, -1300, H + 1500] : [0, W, 0, H];
  const top = snow ? 500 : kind === "dust" ? 90 : kind === "sparks" ? 260 : 120;
  const pts = new Float32Array(count * 3);
  for (let i = 0; i < pts.length; i += 3) { pts[i] = x0 + Math.random() * xr; pts[i + 1] = Math.random() * top; pts[i + 2] = z0 + Math.random() * zr; }
  const attr = new THREE.BufferAttribute(pts, 3);
  flakeSprite ??= loadFx("circle_05");
  const points = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", attr),
    new THREE.PointsMaterial({
      size: kind === "fireflies" ? 9 : snow ? 6 : kind === "sparks" ? 6 : 4, map: flakeSprite, transparent: true, opacity: snow ? 0.9 : kind === "dust" ? 0.35 : kind === "sparks" ? 0.8 : 1,
      depthWrite: false, blending: THREE.AdditiveBlending, color: snow ? 0xffffff : kind === "dust" ? 0xcfcfe0 : kind === "sparks" ? 0x7af0ff : 0xd8ff6a,
    }),
  );
  points.frustumCulled = false;
  parent.add(points);
  drift = { attr, fall: snow ? 45 : kind === "sparks" ? -40 : 0, top, x0, xr, z0, zr };
}

function driftStep(dt: number, t: number) {
  if (!drift) { return; }
  const { attr, fall, top, x0, xr, z0, zr } = drift;
  const a = attr.array as Float32Array;
  for (let i = 0; i < a.length; i += 3) {
    a[i] += Math.sin(t / 900 + i) * 12 * dt + (fall ? 0 : 8 * dt);
    a[i + 1] -= fall * dt;
    if (!fall) { a[i + 1] += Math.sin(t / 700 + i * 3) * 6 * dt; }
    if (a[i + 1] < 0) { a[i + 1] += top; } else if (a[i + 1] > top) { a[i + 1] -= top; }
    if (a[i] > x0 + xr) { a[i] -= xr; } else if (a[i] < x0) { a[i] += xr; }
    if (a[i + 2] > z0 + zr) { a[i + 2] -= zr; }
  }
  attr.needsUpdate = true;
}

/** Painted floor: grey dust and craters for the moon, pale glossy ice with cracks for the rink. */
function floorTexture(kind: "moon" | "ice" | "maze" | "neon") {
  let tex = floorTextures.get(kind);
  if (!tex) { tex = paintFloor(kind); floorTextures.set(kind, tex); }
  return tex;
}

function paintFloor(kind: "moon" | "ice" | "maze" | "neon") {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 768;
  const g = c.getContext("2d")!;
  const rnd = (n: number) => Math.random() * n;
  if (kind === "moon") {
    g.fillStyle = "#8a8795"; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${rnd(2) < 1 ? "255,255,255" : "0,0,0"},${rnd(0.08)})`; g.fillRect(rnd(c.width), rnd(c.height), 1 + rnd(3), 1 + rnd(3)); }
    for (let i = 0; i < 40; i++) {
      const x = rnd(c.width), y = rnd(c.height), r = 12 + rnd(55);
      const grad = g.createRadialGradient(x, y, r * 0.2, x, y, r);
      grad.addColorStop(0, "rgba(40,38,52,0.55)"); grad.addColorStop(0.8, "rgba(40,38,52,0.25)"); grad.addColorStop(0.92, "rgba(230,228,240,0.45)"); grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  } else if (kind === "neon") {
    g.fillStyle = "#0b0b1a"; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(120,140,255,${rnd(0.05)})`; g.fillRect(rnd(c.width), rnd(c.height), 1 + rnd(3), 1); }
    // Circuit traces: right-angle runs ending in a node.
    g.lineWidth = 2; g.lineCap = "square";
    for (let i = 0; i < 38; i++) {
      let x = rnd(c.width), y = rnd(c.height);
      g.strokeStyle = `rgba(${rnd(2) < 1 ? "0,229,255" : "255,43,214"},${0.18 + rnd(0.25)})`;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { if (k % 2) { y += rnd(120) - 60; } else { x += rnd(160) - 80; } g.lineTo(x, y); }
      g.stroke(); g.fillStyle = g.strokeStyle; g.fillRect(x - 3, y - 3, 6, 6);
    }
  } else if (kind === "maze") {
    g.fillStyle = "#26402a"; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `hsla(${90 + rnd(50)},${35 + rnd(30)}%,${12 + rnd(22)}%,0.5)`; g.fillRect(rnd(c.width), rnd(c.height), 1 + rnd(3), 2 + rnd(6)); }
    for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(80,60,35,${0.1 + rnd(0.15)})`; g.beginPath(); g.ellipse(rnd(c.width), rnd(c.height), 15 + rnd(40), 8 + rnd(20), 0, 0, 7); g.fill(); }
  } else {
    const grad = g.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, "#d6f3ff"); grad.addColorStop(0.5, "#a9dcf5"); grad.addColorStop(1, "#cdeeff");
    g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
    g.lineCap = "round";
    for (let i = 0; i < 60; i++) {
      let x = rnd(c.width), y = rnd(c.height);
      g.strokeStyle = `rgba(255,255,255,${0.2 + rnd(0.5)})`; g.lineWidth = 1 + rnd(2);
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += rnd(80) - 40; y += rnd(80) - 40; g.lineTo(x, y); }
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildArena(arena: Arena) {
  // Free the old arena's GPU memory first.
  arenaGroup.traverse((node) => {
    const item = node as THREE.Mesh;
    item.geometry?.dispose();
    const materials = Array.isArray(item.material) ? item.material : item.material ? [item.material] : [];
    materials.forEach((material) => material.dispose());
  });
  arenaGroup.clear();

  const { width: W, height: H, theme } = arena;
  (scene.fog as THREE.FogExp2).color.set(theme.fog);
  look(theme);
  sun.color.set(theme.sun?.[0] ?? 0xffffff);
  sun.intensity = theme.sun?.[1] ?? 2.2;
  drift = null;
  if (theme.floor === "moon") { addMoonSky(arenaGroup, W, H); addDrift(arenaGroup, W, H, "dust"); }
  if (theme.floor === "ice") { addDrift(arenaGroup, W, H, "snow"); }
  if (theme.floor === "maze") { addDrift(arenaGroup, W, H, "fireflies"); }
  if (theme.floor === "neon") { addDrift(arenaGroup, W, H, "sparks"); }
  audio.ambience(theme.floor);
  if (theme.floor === "ice" && !iceEnv) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    iceEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  sun.position.set(W / 2 + 350, 900, H / 2 + 350);
  sun.target.position.set(W / 2, 0, H / 2);
  Object.assign(sun.shadow.camera, { left: -(W / 2 + 400), right: W / 2 + 400, top: H / 2 + 400, bottom: -(H / 2 + 400), near: 1, far: 3000 });
  sun.shadow.camera.updateProjectionMatrix();

  // Floating slab with a low rim wall around the playable area.
  const RIM = 16;
  const WALL_H = 30;
  neonBox(arenaGroup, W + RIM * 2, 40, H + RIM * 2, W / 2, -20, H / 2, theme.edge, theme.slab);
  neonBox(arenaGroup, RIM, WALL_H, H + RIM * 2, -RIM / 2, WALL_H / 2, H / 2, theme.rim, theme.block);
  neonBox(arenaGroup, RIM, WALL_H, H + RIM * 2, W + RIM / 2, WALL_H / 2, H / 2, theme.rim, theme.block);
  neonBox(arenaGroup, W + RIM * 2, WALL_H, RIM, W / 2, WALL_H / 2, -RIM / 2, theme.rim, theme.block);
  neonBox(arenaGroup, W + RIM * 2, WALL_H, RIM, W / 2, WALL_H / 2, H + RIM / 2, theme.rim, theme.block);
  // Long walls glow in the rim colour, blocks and pillars in the edge colour, so the layout reads at a glance.
  for (const o of arena.obstacles) {
    const long = Math.max(o.hw, o.hh) > 2 * Math.min(o.hw, o.hh);
    const edge = long ? theme.rim : theme.edge;
    if (!skinObstacle(arenaGroup, o, theme, edge, iceEnv)) { neonBox(arenaGroup, o.hw * 2, o.h, o.hh * 2, o.x, o.h / 2, o.y, edge, theme.block); }
  }
  if (theme.floor) { rimScenery(arenaGroup, W, H, theme.floor, LITE); }
  if (theme.floor === "ice") {
    // A snowfield all around the rink, so the background is ground rather than empty sky.
    const snowField = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: 0xc4d8e8, roughness: 1 }));
    snowField.rotation.x = -Math.PI / 2;
    snowField.position.set(W / 2, -4, H / 2);
    snowField.receiveShadow = true;
    arenaGroup.add(snowField);
  }

  if (theme.floor) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({
        map: floorTexture(theme.floor), roughness: theme.floor === "ice" ? 0.3 : 1, metalness: theme.floor === "ice" ? 0.15 : 0,
        color: theme.floor === "ice" ? 0x8fb4c8 : 0xffffff, // dims the pale texture so it doesn't blow out
        envMap: theme.floor === "ice" ? iceEnv : null, envMapIntensity: 0.5,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0.2, H / 2);
    floor.receiveShadow = true;
    arenaGroup.add(floor);
  }

  // Glowing ring marking the spawn area in the middle.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(arena.spawnRadius - 2, arena.spawnRadius + 2, 96),
    new THREE.MeshBasicMaterial({ color: theme.edge, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(W / 2, 0.6, H / 2);
  arenaGroup.add(ring);

  // 50-unit neon grid on the floor.
  const gridPoints: THREE.Vector3[] = [];
  for (let x = 0; x <= W; x += 50) { gridPoints.push(new THREE.Vector3(x, 0.5, 0), new THREE.Vector3(x, 0.5, H)); }
  for (let z = 0; z <= H; z += 50) { gridPoints.push(new THREE.Vector3(0, 0.5, z), new THREE.Vector3(W, 0.5, z)); }
  arenaGroup.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(gridPoints),
    new THREE.LineBasicMaterial({ color: theme.grid, transparent: true, opacity: theme.floor && theme.floor !== "neon" ? 0.2 : 0.45 }),
  ));

  moveCamera.setView(
    new THREE.Vector3(W / 2, H * 1.1, H * 1.47),
    new THREE.Vector3(W / 2, 0, H / 2),
    { minX: 140, maxX: W - 140, minZ: 120, maxZ: H - 80 },
    shownArena === "", // the very first arena: put the camera there straight away
  );
  shownArena = arena.id;
}

const particles = createParticles(scene);
const controls = createControls();
const audio = createAudio();
createFullscreen();
gameReady();
const onVz = jumpSounds(audio);
const moveCamera = createCameraRig(
  camera,
  new THREE.Vector3(0, 100, 100),
  new THREE.Vector3(0, 0, 0),
  { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
);
buildArena(arenaOf("classic")); // the lobby shows this until the room says which arena is up

// Private rooms: the host can lock one arena, or leave it rotating.
const arenaSelect = document.getElementById("arenaSelect") as HTMLSelectElement;
const arenaBlurb = document.getElementById("arenaBlurb")!;
for (const a of ARENAS) { arenaSelect.append(new Option(a.name, a.id)); }
try { arenaSelect.value = localStorage.getItem("arena") ?? ""; } catch { /* private mode */ }
const showBlurb = () => {
  arenaBlurb.textContent = arenaSelect.value ? ARENAS.find((a) => a.id === arenaSelect.value)?.blurb ?? "" : "It changes every round.";
  buildArena(arenaOf(arenaSelect.value || "classic")); // preview it behind the lobby
  try { localStorage.setItem("arena", arenaSelect.value); } catch { /* private mode */ }
};
arenaSelect.addEventListener("change", showBlurb);
showBlurb();

// Quick play is one shared pool, so nobody waits alone: those rooms change arena every round.
const quickPlay = (name: string) => client.joinOrCreate("my_room", { name });
type GameRoom = Awaited<ReturnType<typeof quickPlay>>;

async function main() {
  const room = await runLobby<GameRoom>({
    quick: quickPlay,
    create: (name) => client.create("my_room", { name, private: true, arena: arenaSelect.value }),
    byId: (code, name) => client.joinById<MyRoom>(code, { name }),
    reconnect: (token) => client.reconnect(token) as Promise<GameRoom>,
  });
  showRoomTag(room, "Cube Tag");
  audio.play("join");
  // Others are drawn `delay` ms behind the newest update so a late or bunched-up one does not show.
  // Updates arrive every ~33 ms, so 100 ms is a cushion of 3 updates; phones get a little more.
  const predict = Predict.get(room, { mode: "lerp", delay: LITE ? 130 : 100 });

  // Other players' inputs aren't ours to predict: interpolate them toward the
  // latest snapshot instead. `smoothMs` springs the interpolated output - ~65 ms
  // of extra display lag buys velocity that stays continuous even when the
  // snapshot stream is rough. Use 0 where draw == hit precision matters most.
  predict.attachAll("players", { mode: "lerp", fields: ["x", "y", "z"], smoothMs: 65 });

  const input = room.input<MoveInput>({ mode: "reliable" });

  // The first patch is what creates our own Player.
  statusEl.textContent = "Joining...";
  await Promise.race([
    new Promise<void>((resolve) => room.onStateChange.once(() => resolve())),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("The server did not send the game")), 15000)),
  ]);
  const self = room.state.players.get(room.sessionId);

  predict.reconciler(self, {
    input,
    fields: ["x", "y", "vx", "vy", "z", "vz"],
    // The same function the server runs - determinism is the whole contract.
    step: (ctx, predicted, command) => stepEntity(predicted, command, ctx.dt, arenaOf(room.state.arena)),
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
    const frameMs = now - last;
    const dt = Math.min(frameMs / 1000, 0.1);
    last = now;
    adaptQuality(frameMs);
    if (renderScale() >= 0.7) { driftStep(dt, now); }
    debug.frame(frameMs);
    // Drives prediction, interpolation and the reconciler, and returns how many
    // fixed steps came due - so input rate follows the simulation rate, not the
    // monitor's refresh rate.
    const steps = predict.tick(now);

    for (let i = 0; i < steps; i++) {
      Object.assign(input.data, controls.read());
      input.send();
    }

    // A new round can be in a different arena: rebuild the scene to match.
    if (room.state.arena && room.state.arena !== shownArena) { buildArena(arenaOf(room.state.arena)); }

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
      ? `Round over! Winner: ${winner}.${room.state.locked ? "" : ` Next: ${arenaOf(room.state.nextArena).name}`}`
      : room.state.players.size < 2
        ? "Waiting for another player..."
        : `${arenaOf(room.state.arena).name} - ${timeLeft}s${it === room.sessionId ? " - YOU'RE IT!" : ""}`;
    composer.render();

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  statusEl.textContent = "Could not connect";
  showFatal("Could not start the game. Check your connection and reload.");
});
