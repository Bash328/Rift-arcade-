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
  runLobby, showRoomTag, createCameraRig, drawBoard,
} from "./kit.js";

const statusEl = document.getElementById("status")!;
const arenaEl = document.getElementById("arena")!;
const boardEl = document.getElementById("board")!;
const lampEl = document.getElementById("itLamp")!;

const client = new ColyseusSDK<typeof server>(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
);

const { scene, camera, composer } = createStage(arenaEl);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(VOID_SIZE / 2 + 300, 800, VOID_SIZE / 2 + 300);
sun.target.position.set(VOID_SIZE / 2, 0, VOID_SIZE / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 1, far: 2200 });
scene.add(sun, sun.target);

// The tiles. Each one is a slab whose top is at y = 0 (sim x, y -> world x, z).
const TILE_H = 24;
const tileMeshes = Array.from({ length: GRID * GRID }, (_, i) => {
  const mesh = neonBox(
    scene, TILE - 6, TILE_H, TILE - 6,
    ((i % GRID) + 0.5) * TILE, -TILE_H / 2, (Math.floor(i / GRID) + 0.5) * TILE, NEON_CYAN,
  );
  mesh.userData = { state: SOLID, fallV: 0 };
  return mesh;
});
const edgeOf = (tile: THREE.Mesh) => (tile.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;
const slabOf = (tile: THREE.Mesh) => tile.material as THREE.MeshStandardMaterial;

const particles = createParticles(scene);
const controls = createControls();
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
  const predict = Predict.get(room);

  predict.attachAll("players", { mode: "lerp", fields: ["x", "y", "z"], smoothMs: 65 });
  const input = room.input<MoveInput>({ mode: "reliable" });

  // The first patch is what creates our own player.
  await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  const self = room.state.players.get(room.sessionId);

  predict.reconciler(self, {
    input,
    fields: ["x", "y", "vx", "vy", "z", "vz"],
    // The same function the server runs; the tile states are the server's, as synced.
    step: (ctx, predicted, command) => stepVoidEntity(predicted, command, ctx.dt, room.state.tiles),
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
  let last = performance.now();

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
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
        if (state === GONE) {
          tile.userData.fallV = 0;
          for (let k = 0; k < 6; k++) {
            const v = new THREE.Vector3((Math.random() - 0.5) * 200, Math.random() * 150, (Math.random() - 0.5) * 200);
            particles.emit(tile.position.clone().setY(4), 0xff4a4a, v, 0.6, 7);
          }
        } else if (state === SOLID) {
          tile.visible = true;
          tile.position.y = -TILE_H / 2;
          slabOf(tile).emissive.set(0x000000);
          edgeOf(tile).color.set(NEON_CYAN);
        }
      }
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
      const cube = cubes.get(sessionId);
      if (!cube) { continue; }
      cube.visible = player.alive;
      const z = predict.value(player, "z");
      cube.position.set(predict.value(player, "x"), PLAYER_HALF + z, predict.value(player, "y"));
      // Falling players leave a streak of sparks.
      if (player.alive && z < -30) {
        particles.emit(cube.position, 0xff8ad8, zero, 0.35, 8);
      }
    }
    particles.update(dt);

    const me = room.state.players.get(room.sessionId);
    const myCube = cubes.get(room.sessionId);
    controls.syncKnob();
    const { phase, countdown, alive, winner } = room.state;
    lampEl.classList.toggle("on", !!me && !me.alive && (phase === "playing" || phase === "over"));
    moveCamera(me?.alive ? myCube?.position : undefined);

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
});
