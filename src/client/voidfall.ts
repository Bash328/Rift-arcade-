import { ColyseusSDK, Callbacks } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import * as THREE from "three";
import type { default as server } from "../app.config.js";
import type { MoveInput } from "../rooms/schema/MyRoomState.js";
import type { VoidRoom } from "../rooms/VoidRoom.js";
import { PLAYER_HALF, GRAVITY } from "../shared/constants.js";
import { stepVoidEntity, GRID, TILE, VOID_SIZE, SOLID, CRACKING, GONE } from "../shared/void.js";
import {
  NEON_CYAN, createStage, neonBox, createParticles, createControls,
  runLobby, showRoomTag, createCameraRig, drawBoard, createAudio, jumpSounds, createFullscreen, createDebugHud, LITE, gameReady, showFatal, loadFx, SHADOW_MAP, type Sfx,
} from "./kit.js";
import { Avatar } from "./avatars.js";

const statusEl = document.getElementById("status")!;
const arenaEl = document.getElementById("arena")!;
const boardEl = document.getElementById("board")!;
const lampEl = document.getElementById("itLamp")!;

const client = new ColyseusSDK<typeof server>(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
);

const { scene, camera, composer, renderer, adaptQuality, renderScale } = createStage(arenaEl);
const debug = createDebugHud(arenaEl, renderer, renderScale);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(VOID_SIZE / 2 + 300, 800, VOID_SIZE / 2 + 300);
sun.target.position.set(VOID_SIZE / 2, 0, VOID_SIZE / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 1, far: 2200 });
scene.add(sun, sun.target);

// The tiles. Each one is a slab whose top is at y = 0 (sim x, y -> world x, z).
const TILE_H = 24;
const crackTexture = loadFx("spark_03");
const tileMeshes = Array.from({ length: GRID * GRID }, (_, i) => {
  const mesh = neonBox(
    scene, TILE - 6, TILE_H, TILE - 6,
    ((i % GRID) + 0.5) * TILE, -TILE_H / 2, (Math.floor(i / GRID) + 0.5) * TILE, NEON_CYAN,
  );
  // Lightning that flashes over the tile while it is cracking (CC0 sprite).
  const crackFx = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE - 14, TILE - 14),
    new THREE.MeshBasicMaterial({ map: crackTexture, color: 0xff6a5a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  crackFx.rotation.set(-Math.PI / 2, 0, (i * 1.7) % (Math.PI * 2));
  crackFx.position.y = TILE_H / 2 + 0.8;
  crackFx.visible = false;
  mesh.add(crackFx);
  mesh.userData = { state: SOLID, fallV: 0, crackFx };
  return mesh;
});
const edgeOf = (tile: THREE.Mesh) => (tile.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;
const slabOf = (tile: THREE.Mesh) => tile.material as THREE.MeshStandardMaterial;

const particles = createParticles(scene);
const controls = createControls();
const audio = createAudio();
createFullscreen();
gameReady();
const onVz = jumpSounds(audio);
const moveCamera = createCameraRig(
  camera,
  new THREE.Vector3(VOID_SIZE / 2, VOID_SIZE * 1.1, VOID_SIZE * 1.3),
  new THREE.Vector3(VOID_SIZE / 2, 0, VOID_SIZE / 2),
  { minX: 160, maxX: VOID_SIZE - 160, minZ: 140, maxZ: VOID_SIZE - 100 },
);

const quickPlay = (name: string) => client.joinOrCreate("void_room", { name });
type GameRoom = Awaited<ReturnType<typeof quickPlay>>;

async function main() {
  const room = await runLobby<GameRoom>({
    quick: quickPlay,
    create: (name) => client.create("void_room", { name, private: true }),
    byId: (code, name) => client.joinById<VoidRoom>(code, { name }),
  });
  showRoomTag(room, "Voidfall");
  audio.play("join");
  // Others are drawn `delay` ms behind the newest update so a late or bunched-up one does not show.
  // Updates arrive every ~33 ms, so 100 ms is a cushion of 3 updates; phones get a little more.
  const predict = Predict.get(room, { mode: "lerp", delay: LITE ? 130 : 100 });

  predict.attachAll("players", { mode: "lerp", fields: ["x", "y", "z"], smoothMs: 65 });
  const input = room.input<MoveInput>({ mode: "reliable" });

  // The first patch is what creates our own player.
  statusEl.textContent = "Joining...";
  await Promise.race([
    new Promise<void>((resolve) => room.onStateChange.once(() => resolve())),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("The server did not send the game")), 15000)),
  ]);
  const self = room.state.players.get(room.sessionId);

  predict.reconciler(self, {
    input,
    fields: ["x", "y", "vx", "vy", "z", "vz"],
    // The same function the server runs; the tile states are the server's, as synced.
    step: (ctx, predicted, command) => stepVoidEntity(predicted, command, ctx.dt, room.state.tiles),
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
      .map(([id, p]) => ({ id, name: p.name, hue: p.hue, alive: p.alive }))
      .sort((a, b) => Number(b.alive) - Number(a.alive));
    const key = JSON.stringify(rows);
    if (key === boardKey) { return; }
    boardKey = key;
    drawBoard(boardEl, rows.map((r) => ({
      hue: r.hue,
      text: `${r.name}${r.id === room.sessionId ? " (you)" : ""}${r.alive ? "" : " - out"}`,
    })));
  }

  const zero = new THREE.Vector3();
  const feet = new THREE.Vector3();
  const chest = new THREE.Vector3();
  let last = performance.now();
  let prevPhase = "";
  let prevCountdown = -1;
  let prevAlive = true;

  /** Play a sound that fades with distance from my pet, so far-off tiles stay quiet. */
  const hear = (name: Sfx, at: THREE.Vector3) => {
    const me = avatars.get(room.sessionId)?.group.position;
    if (!me) { return; }
    const volume = Math.max(0, 1 - Math.hypot(me.x - at.x, me.z - at.z) / 500);
    if (volume > 0.05) { audio.play(name, volume * 0.8, 0.9 + Math.random() * 0.2); }
  };

  function frame(now: number) {
    const frameMs = now - last;
    const dt = Math.min(frameMs / 1000, 0.1);
    last = now;
    adaptQuality(frameMs);
    debug.frame(frameMs);
    const steps = predict.tick(now);
    for (let i = 0; i < steps; i++) {
      Object.assign(input.data, controls.read());
      input.send();
    }

    // Tiles: cracking ones shake and flash red; gone ones fall away; a new round restores them.
    room.state.tiles.forEach((state, i) => {
      const tile = tileMeshes[i];
      if (state !== tile.userData.state) {
        tile.userData.state = state;
        if (state === CRACKING) { hear("crack", tile.position); }
        if (state === GONE) {
          hear("drop", tile.position);
          tile.userData.fallV = 0;
          for (let k = 0; k < 6; k++) {
            const v = new THREE.Vector3((Math.random() - 0.5) * 200, Math.random() * 150, (Math.random() - 0.5) * 200);
            particles.emit(tile.position.clone().setY(4), 0xff6a4a, v, 0.6, 7, k % 2 ? "star" : "glow");
          }
        } else if (state === SOLID) {
          tile.visible = true;
          tile.position.y = -TILE_H / 2;
          slabOf(tile).emissive.set(0x000000);
          edgeOf(tile).color.set(NEON_CYAN);
        }
      }
      const crackFx = tile.userData.crackFx as THREE.Mesh;
      crackFx.visible = state === CRACKING; // not drawn at all unless cracking: saves a draw call per tile, twice a frame
      (crackFx.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.45 * Math.sin(now / 45 + i);
      if (state === CRACKING) {
        tile.position.y = -TILE_H / 2 + Math.sin(now / 25 + i) * 1.6;
        const flash = Math.sin(now / 60) > 0;
        slabOf(tile).emissive.set(flash ? 0x7a0a0a : 0x2a0404);
        edgeOf(tile).color.set(flash ? 0xff6a6a : 0xff2020);
      } else if (state === GONE && tile.visible) {
        tile.userData.fallV += GRAVITY * dt;
        tile.position.y -= tile.userData.fallV * dt;
        if (tile.position.y < -900) { tile.visible = false; }
      }
    });

    for (const [sessionId, player] of room.state.players) {
      const avatar = avatars.get(sessionId);
      if (!avatar) { continue; }
      avatar.group.visible = player.alive;
      const z = predict.value(player, "z");
      feet.set(predict.value(player, "x"), z, predict.value(player, "y"));
      avatar.update(dt, feet, { celebrate: room.state.phase === "over" && player.alive });
      // Falling players leave a streak of sparks.
      if (player.alive && z < -30) {
        chest.copy(feet).y += PLAYER_HALF;
        particles.emit(chest, 0xff8ad8, zero, 0.4, 7, "star");
      }
    }
    particles.update(dt);

    const me = room.state.players.get(room.sessionId);
    const myAvatar = avatars.get(room.sessionId);
    if (me) { onVz(predict.value(me, "vz")); }
    controls.syncKnob();
    const { phase, countdown, alive, winner } = room.state;
    lampEl.classList.toggle("on", !!me && !me.alive && (phase === "playing" || phase === "over"));
    moveCamera(me?.alive ? myAvatar?.group.position : undefined);

    // Game-state sounds.
    if (phase === "countdown" && countdown !== prevCountdown) { audio.play("tick"); }
    if (phase === "playing" && prevPhase !== "playing") { audio.play("go"); }
    if (phase === "over" && prevPhase !== "over") { audio.play("win", me && winner === me.name ? 1 : 0.6); }
    if (me && prevAlive && !me.alive && phase === "playing") { audio.play("fall"); }
    prevPhase = phase;
    prevCountdown = countdown;
    prevAlive = me?.alive ?? true;

    refreshBoard();
    statusEl.textContent =
      phase === "waiting" ? "Waiting for another player..." :
      phase === "countdown" ? `Get ready... ${countdown}` :
      phase === "over" ? `${winner} wins!` :
      me?.alive ? `${alive} left - keep moving!` : `You fell! Watching - ${alive} left`;
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
