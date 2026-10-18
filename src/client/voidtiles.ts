// Voidfall's tiles, drawn as a few instanced meshes however many there are: classic Voidfall is 81 square tiles with
// glowing frames, Hex-A-Gone is 270 solid hexagons on three floors (separate objects would be far too many draw calls
// for a phone). Each tile has its own entry in the instance buffers: where it is, its colour, and whether it is shown.
// The floors above a player who has dropped down are hidden (they would be in the way; the camera is lower than they are).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TILE, CELLS, HEX_CELLS, HEX_FLOORS, HEX_R, CRACKING, GONE, RED, GREEN, SQUARE_BOARD, HEX_BOARD, floorZ } from "../shared/void.js";
import { GRAVITY } from "../shared/constants.js";
import { NEON_CYAN, loadFx } from "./kit.js";

const TILE_H = 24;
const SLICE = TILE - 6; // a square tile is a little smaller than its cell, so there is a seam
const HEX_RADIUS = HEX_R - 3;

const OFF = new THREE.Color(0x000000);
const one = new THREE.Vector3(1, 1, 1);

/** Classic: dark slabs with glowing cyan frames that flash red when they crack. */
const CLASSIC = {
  edge: new THREE.Color(NEON_CYAN),
  body: new THREE.Color(0x16102b),
  flashEdge: [new THREE.Color(0xff6a6a), new THREE.Color(0xff2020)],
  flashBody: [new THREE.Color(0x7a0a0a), new THREE.Color(0x2a0404)],
  fx: new THREE.Color(0xff6a5a),
};
/** Hex-A-Gone: plain, solid colours (green lasts, yellow is quicker, red goes almost at once). A cracking tile flashes white. */
const HEX_BODY = [0x2fcf5f, 0xffd23a, 0xff4a4a].map((c) => new THREE.Color(c));
const HEX_FLASH = new THREE.Color(0xffffff);

/** Per-instance visibility for a material, read from the instanced attribute `aFade` (0 hides the tile, 1 shows it). */
function fadeable<T extends THREE.Material>(material: T, fade: Float32Array, geometry: THREE.BufferGeometry): T {
  geometry.setAttribute("aFade", new THREE.InstancedBufferAttribute(fade, 1).setUsage(THREE.DynamicDrawUsage));
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFade;\nvarying float vFade;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFade = aFade;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vFade < 0.5) { discard; }");
  };
  material.customProgramCacheKey = () => "voidtile-hide";
  return material;
}

function frameGeometry(w: number, h: number, d: number, t: number) {
  const bar = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => new THREE.BoxGeometry(bw, bh, bd).translate(x, y, z);
  const bars: THREE.BufferGeometry[] = [];
  for (const y of [-h / 2, h / 2]) { for (const z of [-d / 2, d / 2]) { bars.push(bar(w, t, t, 0, y, z)); } }
  for (const x of [-w / 2, w / 2]) { for (const z of [-d / 2, d / 2]) { bars.push(bar(t, h, t, x, 0, z)); } }
  for (const x of [-w / 2, w / 2]) { for (const y of [-h / 2, h / 2]) { bars.push(bar(t, t, d, x, y, 0)); } }
  return mergeGeometries(bars)!;
}

function stripeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 10;
  for (let k = -64; k < 128; k += 24) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface TileView {
  /** Where the local player is, to hide the floors above them: null when spectating (everything shows). */
  me: { floor: number } | null;
}

interface SetConfig {
  hex: boolean;
  max: number;
  per: number;
  bodyGeo: THREE.BufferGeometry;
  frameGeo?: THREE.BufferGeometry;
  fxGeo?: THREE.BufferGeometry;
  stripeGeo?: THREE.BufferGeometry;
}

/** One layout's worth of instanced tiles. */
function createSet(scene: THREE.Scene, cfg: SetConfig, events: { cracked(at: THREE.Vector3): void; dropped(at: THREE.Vector3): void }) {
  const { max, per, hex } = cfg;
  const board = hex ? HEX_BOARD : SQUARE_BOARD;
  const fade = new Float32Array(max).fill(1);
  /** The stripes are numbered by red tile, not by tile, so they keep their own copy. */
  const stripeFade = new Float32Array(max).fill(1);

  const bodyMaterial = fadeable(new THREE.MeshStandardMaterial({ roughness: hex ? 0.75 : 0.6 }), fade, cfg.bodyGeo);
  const bodies = new THREE.InstancedMesh(cfg.bodyGeo, bodyMaterial, max);
  bodies.receiveShadow = true; // pets cast onto the tiles; the tiles themselves cast nothing (hidden floors must leave no shadow)
  const meshes: THREE.InstancedMesh[] = [bodies];
  let frames: THREE.InstancedMesh | undefined;
  let fx: THREE.InstancedMesh | undefined;
  let stripes: THREE.InstancedMesh | undefined;
  if (cfg.frameGeo) { frames = new THREE.InstancedMesh(cfg.frameGeo, fadeable(new THREE.MeshBasicMaterial(), fade, cfg.frameGeo), max); meshes.push(frames); }
  if (cfg.fxGeo) {
    fx = new THREE.InstancedMesh(cfg.fxGeo, fadeable(new THREE.MeshBasicMaterial({ map: loadFx("spark_03"), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), fade, cfg.fxGeo), max);
    meshes.push(fx);
  }
  if (cfg.stripeGeo) {
    stripes = new THREE.InstancedMesh(cfg.stripeGeo, fadeable(new THREE.MeshBasicMaterial({ map: stripeTexture(), transparent: true, depthWrite: false }), stripeFade, cfg.stripeGeo), max);
    meshes.push(stripes);
  }
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const mesh of meshes) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = false;
    scene.add(mesh);
    for (let i = 0; i < max; i++) { mesh.setMatrixAt(i, hide); mesh.setColorAt(i, OFF); }
  }

  // What each tile showed last frame, and its fall.
  const shown = new Uint8Array(max).fill(255);
  const fallV = new Float32Array(max);
  const fallY = new Float32Array(max);
  const falling = new Uint8Array(max);
  const topY = new Float32Array(max);
  const seen = new Uint8Array(max);
  const tileQuat = Array.from({ length: max }, (_, i) => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, (i * 1.7) % (Math.PI * 2))));
  const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const place = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  let redTiles: number[] = [];
  let signature = "";

  /** A new round (or a different mode): forget what the tiles were doing and find the red ones, which get stripes. */
  function reset(kinds: ArrayLike<number>) {
    shown.fill(255); fallV.fill(0); fallY.fill(0); falling.fill(0); fade.fill(1);
    redTiles = [];
    if (stripes) { for (let i = 0; i < kinds.length && i < max; i++) { if (kinds[i] === RED) { redTiles.push(i); } } stripes.count = redTiles.length; }
  }

  return {
    show(on: boolean) { for (const mesh of meshes) { mesh.visible = on; } },
    update(states: ArrayLike<number>, kinds: ArrayLike<number>, round: number, view: TileView, now: number, dt: number) {
      const count = Math.min(states.length, max);
      const sig = `${round}:${count}:${kinds.length}`;
      if (sig !== signature) { signature = sig; reset(kinds); }
      const blink = Math.sin(now / 60) > 0 ? 0 : 1;
      const k = Math.min(1, dt * 14);

      for (let i = 0; i < max; i++) {
        if (i >= count) { for (const mesh of meshes) { if (mesh !== stripes) { mesh.setMatrixAt(i, hide); } } seen[i] = 0; continue; }
        const state = states[i];
        const floor = Math.floor(i / per), cell = i % per;
        const [x, z] = board.centre(cell);
        if (state !== shown[i]) {
          const first = shown[i] === 255;
          shown[i] = state;
          place.set(x, floorZ(floor), z);
          fallV[i] = 0; fallY[i] = 0;
          falling[i] = state === GONE && !first ? 1 : 0; // a tile that was already gone when we arrived is just not there
          if (state === CRACKING) { events.cracked(place); }
          if (state === GONE && !first) { events.dropped(place); }
        }
        const base = floorZ(floor) - TILE_H / 2;
        let y = base;
        if (state === CRACKING) { y += Math.sin(now / 25 + i) * 1.6; }
        else if (state === GONE && falling[i]) { fallV[i] += GRAVITY * dt; fallY[i] -= fallV[i] * dt; y += fallY[i]; if (fallY[i] < -1500) { falling[i] = 0; } }
        const visible = state !== GONE || falling[i] === 1;
        topY[i] = y + TILE_H / 2;

        // Floors above the player are hidden (quickly, so it is not a pop); everything else shows.
        const goal = view.me && floor < view.me.floor ? 0 : 1;
        fade[i] += (goal - fade[i]) * k;
        seen[i] = visible && fade[i] >= 0.5 ? 1 : 0;

        if (!visible || fade[i] < 0.02) {
          for (const mesh of meshes) { if (mesh !== stripes) { mesh.setMatrixAt(i, hide); mesh.setColorAt(i, OFF); } }
          continue;
        }
        matrix.makeTranslation(x, y, z);
        bodies.setMatrixAt(i, matrix);
        frames?.setMatrixAt(i, matrix);
        const cracking = state === CRACKING;
        if (hex) {
          const base = HEX_BODY[kinds[i] ?? GREEN];
          bodies.setColorAt(i, cracking && blink === 0 ? HEX_FLASH : base);
        } else {
          bodies.setColorAt(i, cracking ? CLASSIC.flashBody[blink] : CLASSIC.body);
          frames?.setColorAt(i, cracking ? CLASSIC.flashEdge[blink] : CLASSIC.edge);
        }
        if (fx) {
          if (cracking) {
            place.set(x, y + TILE_H / 2 + 0.8, z);
            matrix.compose(place, tileQuat[i], one);
            fx.setMatrixAt(i, matrix);
            fx.setColorAt(i, tint.copy(CLASSIC.fx).multiplyScalar(0.55 + 0.45 * Math.sin(now / 45 + i)));
          } else {
            fx.setMatrixAt(i, hide);
            fx.setColorAt(i, OFF);
          }
        }
      }

      // Warning stripes over the red tiles (so they are not told apart by colour alone), riding along with them.
      if (stripes) {
        for (let j = 0; j < redTiles.length; j++) {
          const i = redTiles[j];
          if (!seen[i]) { stripes.setMatrixAt(j, hide); stripeFade[j] = 0; continue; }
          const [x, z] = board.centre(i % per);
          place.set(x, topY[i] + 0.5, z);
          matrix.compose(place, flatQuat, one);
          stripes.setMatrixAt(j, matrix);
          stripeFade[j] = 1;
        }
        (stripes.geometry.getAttribute("aFade") as THREE.InstancedBufferAttribute).needsUpdate = true;
        stripes.instanceMatrix.needsUpdate = true;
      }

      for (const mesh of meshes) {
        if (mesh === stripes) { continue; }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) { mesh.instanceColor.needsUpdate = true; }
        (mesh.geometry.getAttribute("aFade") as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
    },
  };
}

export function createTiles(scene: THREE.Scene, events: { cracked(at: THREE.Vector3): void; dropped(at: THREE.Vector3): void }) {
  // Classic Voidfall: 81 square slabs with glowing frames and a crack flash.
  const square = createSet(scene, {
    hex: false, max: CELLS, per: CELLS,
    bodyGeo: new THREE.BoxGeometry(SLICE, TILE_H, SLICE),
    frameGeo: frameGeometry(SLICE, TILE_H, SLICE, 3),
    fxGeo: new THREE.PlaneGeometry(TILE - 14, TILE - 14),
  }, events);
  // Hex-A-Gone: 270 plain hexagon slabs, red ones striped. Cylinders of six sides have a corner pointing along z, which is
  // the way the floor is laid out (pointy side up on the plan).
  const hexStripe = new THREE.CircleGeometry(HEX_RADIUS - 11, 6).rotateZ(Math.PI / 6);
  const hex = createSet(scene, {
    hex: true, max: HEX_CELLS * HEX_FLOORS, per: HEX_CELLS,
    bodyGeo: new THREE.CylinderGeometry(HEX_RADIUS, HEX_RADIUS, TILE_H, 6),
    stripeGeo: hexStripe,
  }, events);

  return {
    update(states: ArrayLike<number>, kinds: ArrayLike<number>, round: number, view: TileView, now: number, dt: number) {
      const isHex = states.length > CELLS;
      square.show(!isHex);
      hex.show(isHex);
      (isHex ? hex : square).update(states, kinds, round, view, now, dt);
    },
  };
}

