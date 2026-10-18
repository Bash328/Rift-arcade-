// Voidfall's tiles, drawn as four instanced meshes (bodies, glowing frames, crack flashes, warning stripes) however
// many floors there are: a Hex-A-Gone round has 243 tiles, which as separate objects would be far too many draw calls
// for a phone. Each tile is told apart by its own entry in the instance buffers: where it is, its colours, and how
// see-through it is (the floors above a player who has dropped down fade out around them).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GRID, TILE, CELLS, HEX_FLOORS, SOLID, CRACKING, GONE, RED, floorZ } from "../shared/void.js";
import { GRAVITY } from "../shared/constants.js";
import { NEON_CYAN, loadFx } from "./kit.js";

const TILE_H = 24;
/** Tiles of floors above the player fade within this distance of them, to this opacity. */
const FADE_RADIUS = 260;
const FADED = 0.12;
const MAX = CELLS * HEX_FLOORS;

/** Edge and body colour of each kind of tile (green, yellow, red), and the classic cyan tile. */
const KIND_EDGE = [0x3dff7a, 0xffd23f, 0xff3b4a].map((c) => new THREE.Color(c));
const KIND_BODY = [0x0f2a1c, 0x2b2410, 0x2d0e14].map((c) => new THREE.Color(c));
const CLASSIC_EDGE = new THREE.Color(NEON_CYAN);
const CLASSIC_BODY = new THREE.Color(0x16102b);
/** A tile that is cracking flashes: white in Hex-A-Gone (never red, which is a kind), red in classic. */
const HEX_FLASH = { edge: [new THREE.Color(0xe8e8e8), new THREE.Color(0xc99a5a)], body: [new THREE.Color(0x707070), new THREE.Color(0x303030)] };
const CLASSIC_FLASH = { edge: [new THREE.Color(0xff6a6a), new THREE.Color(0xff2020)], body: [new THREE.Color(0x7a0a0a), new THREE.Color(0x2a0404)] };
const FX_HEX = new THREE.Color(0x888888);
const FX_CLASSIC = new THREE.Color(0xff6a5a);
const OFF = new THREE.Color(0x000000);

/** One instance slot per tile (the order does not matter now that every tile is opaque and writes depth). */
const SLOT = Array.from({ length: MAX }, (_, i) => (HEX_FLOORS - 1 - Math.floor(i / CELLS)) * CELLS + (i % CELLS));

/**
 * Per-instance see-through amount for a material, read from the instanced attribute `aFade`. It is a screen-door
 * dither (a pattern of pixels is dropped, more of them the more see-through the tile is) rather than real blending,
 * so every tile stays opaque, writes depth and is drawn in the right order whatever floor it is on.
 */
const BAYER = `
varying float vFade;
float bayer4(vec2 p) {
  int i = int(mod(p.x, 4.0)) + 4 * int(mod(p.y, 4.0));
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}`;
function fadeable<T extends THREE.Material>(material: T, fade: Float32Array, geometry: THREE.BufferGeometry): T {
  geometry.setAttribute("aFade", new THREE.InstancedBufferAttribute(fade, 1).setUsage(THREE.DynamicDrawUsage));
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFade;\nvarying float vFade;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFade = aFade;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>" + BAYER)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vFade < 0.999 && bayer4(gl_FragCoord.xy) >= vFade) { discard; }");
  };
  material.customProgramCacheKey = () => "voidtile-fade";
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
  g.strokeStyle = "rgba(255,230,230,0.7)";
  g.lineWidth = 9;
  for (let k = -64; k < 128; k += 22) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface TileView {
  /** Where the local player is, to fade the floors above them: null when spectating (everything shows). */
  me: { x: number; y: number; floor: number } | null;
}

export function createTiles(scene: THREE.Scene, events: { cracked(at: THREE.Vector3): void; dropped(at: THREE.Vector3): void }) {
  const fade = new Float32Array(MAX).fill(1);
  /** The stripes are numbered by red tile, not by slot, so they keep their own copy of the fade. */
  const stripeFade = new Float32Array(MAX).fill(1);
  const w = TILE - 6;

  const bodyGeometry = new THREE.BoxGeometry(w, TILE_H, w);
  const bodies = new THREE.InstancedMesh(bodyGeometry, fadeable(new THREE.MeshStandardMaterial({ roughness: 0.6 }), fade, bodyGeometry), MAX);
  bodies.castShadow = bodies.receiveShadow = true;

  const frameGeo = frameGeometry(w, TILE_H, w, 3);
  const frames = new THREE.InstancedMesh(frameGeo, fadeable(new THREE.MeshBasicMaterial(), fade, frameGeo), MAX);

  const fxGeo = new THREE.PlaneGeometry(TILE - 14, TILE - 14);
  const fx = new THREE.InstancedMesh(fxGeo, fadeable(new THREE.MeshBasicMaterial({ map: loadFx("spark_03"), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), fade, fxGeo), MAX);

  const stripeGeo = new THREE.PlaneGeometry(w - 16, w - 16);
  const stripes = new THREE.InstancedMesh(stripeGeo, fadeable(new THREE.MeshBasicMaterial({ map: stripeTexture(), transparent: true, depthWrite: false }), stripeFade, stripeGeo), MAX);

  for (const mesh of [bodies, frames, fx, stripes]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
  }
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let slot = 0; slot < MAX; slot++) {
    for (const mesh of [bodies, frames, fx, stripes]) { mesh.setMatrixAt(slot, hide); mesh.setColorAt(slot, OFF); }
  }

  // What each tile showed last frame, and its fall.
  const shown = new Uint8Array(MAX).fill(255);
  const fallV = new Float32Array(MAX);
  const fallY = new Float32Array(MAX);
  const falling = new Uint8Array(MAX);
  const hidden = new Uint8Array(MAX);
  const topY = new Float32Array(MAX);
  const seen = new Uint8Array(MAX);
  const tileQuat = Array.from({ length: MAX }, (_, i) => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, (i * 1.7) % (Math.PI * 2))));
  const flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const one = new THREE.Vector3(1, 1, 1);
  const place = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  let redTiles: number[] = [];
  let signature = "";

  /** A new round (or a different mode): forget what the tiles were doing and find the red ones, which get stripes. */
  function reset(states: ArrayLike<number>, kinds: ArrayLike<number>) {
    shown.fill(255); fallV.fill(0); fallY.fill(0); falling.fill(0); hidden.fill(0); fade.fill(1);
    redTiles = [];
    for (let i = 0; i < kinds.length && i < states.length; i++) { if (kinds[i] === RED) { redTiles.push(i); } }
    stripes.count = Math.max(redTiles.length, 0);
  }

  return {
    update(states: ArrayLike<number>, kinds: ArrayLike<number>, round: number, view: TileView, now: number, dt: number) {
      const count = states.length;
      const hex = count > CELLS;
      const sig = `${round}:${count}:${kinds.length}`;
      if (sig !== signature) { signature = sig; reset(states, kinds); }
      const flash = hex ? HEX_FLASH : CLASSIC_FLASH;
      const blink = Math.sin(now / 60) > 0 ? 0 : 1;
      const k = Math.min(1, dt * 10);

      for (let i = 0; i < MAX; i++) {
        const slot = SLOT[i];
        if (i >= count) {
          if (!hidden[i]) { hidden[i] = 1; for (const mesh of [bodies, frames, fx]) { mesh.setMatrixAt(slot, hide); mesh.setColorAt(slot, OFF); } }
          continue;
        }
        const state = states[i];
        const floor = Math.floor(i / CELLS), cell = i % CELLS;
        const x = ((cell % GRID) + 0.5) * TILE, z = (Math.floor(cell / GRID) + 0.5) * TILE;
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
        else if (state === GONE) {
          if (falling[i]) { fallV[i] += GRAVITY * dt; fallY[i] -= fallV[i] * dt; y += fallY[i]; if (fallY[i] < -900) { falling[i] = 0; } }
        }
        const visible = state !== GONE || falling[i] === 1;
        topY[i] = y + TILE_H / 2;
        seen[i] = visible ? 1 : 0;

        // See-through where the player dropped to a lower floor and this tile is in the way above them.
        let goal = 1;
        if (view.me && floor < view.me.floor && Math.hypot(x - view.me.x, z - view.me.y) < FADE_RADIUS) { goal = FADED; }
        fade[slot] += (goal - fade[slot]) * k;

        if (!visible) {
          for (const mesh of [bodies, frames, fx]) { mesh.setMatrixAt(slot, hide); mesh.setColorAt(slot, OFF); }
          continue;
        }
        place.set(x, y, z);
        matrix.makeTranslation(x, y, z);
        bodies.setMatrixAt(slot, matrix);
        frames.setMatrixAt(slot, matrix);
        const cracking = state === CRACKING;
        const kind = hex ? kinds[i] : -1;
        const edge = cracking ? flash.edge[blink] : hex ? KIND_EDGE[kind] : CLASSIC_EDGE;
        const body = cracking ? flash.body[blink] : hex ? KIND_BODY[kind] : CLASSIC_BODY;
        frames.setColorAt(slot, edge);
        bodies.setColorAt(slot, body);
        if (cracking) {
          place.set(x, y + TILE_H / 2 + 0.8, z);
          matrix.compose(place, tileQuat[i], one);
          fx.setMatrixAt(slot, matrix);
          fx.setColorAt(slot, (hex ? FX_HEX : FX_CLASSIC).clone().multiplyScalar(0.55 + 0.45 * Math.sin(now / 45 + i)));
        } else {
          fx.setMatrixAt(slot, hide);
          fx.setColorAt(slot, OFF);
        }
      }

      // Warning stripes over the red tiles, riding along with them.
      for (let j = 0; j < redTiles.length; j++) {
        const i = redTiles[j];
        if (!seen[i]) { stripes.setMatrixAt(j, hide); continue; }
        const cell = i % CELLS;
        place.set(((cell % GRID) + 0.5) * TILE, topY[i] + 0.5, (Math.floor(cell / GRID) + 0.5) * TILE);
        matrix.compose(place, flatQuat, one);
        stripes.setMatrixAt(j, matrix);
      }
      // Stripes share the fade of the tile they sit on.
      for (let j = 0; j < redTiles.length; j++) { stripeFade[j] = fade[SLOT[redTiles[j]]]; }
      (stripes.geometry.getAttribute("aFade") as THREE.InstancedBufferAttribute).needsUpdate = true;

      for (const mesh of [bodies, frames, fx]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) { mesh.instanceColor.needsUpdate = true; }
        (mesh.geometry.getAttribute("aFade") as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
      stripes.instanceMatrix.needsUpdate = true;
    },
  };
}
