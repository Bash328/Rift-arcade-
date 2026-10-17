// What the obstacles and the scenery around the arena are made of, per arena look
// (moon rock, ice crystal, maze hedge). Collision is still the plain box from the
// arena data, so every skin stays inside that footprint and top height.

import * as THREE from "three";
import type { ArenaTheme, Obstacle } from "../shared/arenas.js";

type Look = NonNullable<ArenaTheme["floor"]>;

const rnd = (n: number) => Math.random() * n;

// Tileable textures are painted once and kept: arena swaps only dispose geometry and materials.
const textures = new Map<string, THREE.Texture>();
function texture(name: string, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  let tex = textures.get(name);
  if (!tex) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    draw(c.getContext("2d")!, 256);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    textures.set(name, tex);
  }
  return tex;
}

const rockTexture = () => texture("rock", (g, s) => {
  g.fillStyle = "#8a8794"; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${rnd(2) < 1 ? "255,255,255" : "0,0,0"},${rnd(0.14)})`; g.fillRect(rnd(s), rnd(s), 1 + rnd(4), 1 + rnd(4)); }
  g.strokeStyle = "rgba(20,18,30,0.35)"; g.lineWidth = 1;
  for (let i = 0; i < 14; i++) { let x = rnd(s), y = rnd(s); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rnd(50) - 25; y += rnd(50) - 25; g.lineTo(x, y); } g.stroke(); }
});

const hedgeTexture = () => texture("hedge", (g, s) => {
  g.fillStyle = "#143d1c"; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `hsl(${105 + rnd(35)},${45 + rnd(30)}%,${14 + rnd(26)}%)`; g.beginPath(); g.arc(rnd(s), rnd(s), 2 + rnd(7), 0, 7); g.fill(); }
});

const stoneTexture = () => texture("stone", (g, s) => {
  g.fillStyle = "#8f8c82"; g.fillRect(0, 0, s, s);
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * 64 + (row % 2) * 32, y = row * 32;
      g.fillStyle = `hsl(40,6%,${48 + rnd(14)}%)`; g.fillRect(x + 2, y + 2, 60, 28);
    }
  }
  for (let i = 0; i < 800; i++) { g.fillStyle = `rgba(0,0,0,${rnd(0.12)})`; g.fillRect(rnd(s), rnd(s), 2, 2); }
});

/** A box whose texture repeats every `tile` world units instead of stretching with the box. */
function texturedBox(w: number, h: number, d: number, map: THREE.Texture, color: number, tile = 120) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Face order is +x, -x, +y, -y, +z, -z with four vertices each.
  [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]].forEach(([a, b], face) => {
    for (let i = 0; i < 4; i++) { const k = face * 4 + i; uv.setXY(k, (uv.getX(k) * a) / tile, (uv.getY(k) * b) / tile); }
  });
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, color, roughness: 1 }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const iceMaterial = (env: THREE.Texture | undefined, opacity: number, color = 0x9fd8f5) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.2, transparent: true, opacity, depthWrite: false, envMap: env ?? null, envMapIntensity: 0.8 });

/** Draws one obstacle in the arena's look. Returns false for the plain neon look. */
export function skinObstacle(parent: THREE.Object3D, o: Obstacle, theme: ArenaTheme, edgeColor: number, iceEnv?: THREE.Texture) {
  const look = theme.floor;
  if (!look) { return false; }
  const w = o.hw * 2, h = o.h, d = o.hh * 2;
  const g = new THREE.Group();
  g.position.set(o.x, 0, o.y);

  if (look === "moon") {
    // Layered rock: strata of slightly different greys, inset by a couple of units at most.
    const layers = Math.max(2, Math.round(h / 40)), lh = h / layers;
    for (let i = 0; i < layers; i++) {
      const inset = i === 0 ? 0 : rnd(2);
      const m = texturedBox(w - inset * 2, lh, d - inset * 2, rockTexture(), 0xffffff);
      (m.material as THREE.MeshStandardMaterial).color.setHSL(0.72, 0.05, 0.42 + (i % 2) * 0.09 + rnd(0.05));
      m.position.y = lh * (i + 0.5);
      g.add(m);
    }
  } else if (look === "ice") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), iceMaterial(iceEnv, 0.55));
    body.position.y = h / 2;
    const core = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, h * 0.9, d * 0.5), iceMaterial(iceEnv, 0.85, 0xe8fbff));
    core.position.y = h / 2;
    g.add(body, core);
    // A few small crystals on top.
    const r = Math.max(3, Math.min(o.hw, o.hh) * 0.25);
    for (let i = 0; i < 3; i++) {
      const sh = 14 + rnd(18);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(r, sh, 5), iceMaterial(iceEnv, 0.9, 0xd8f4ff));
      spike.position.set((rnd(2) - 1) * (o.hw - r), h + sh / 2, (rnd(2) - 1) * (o.hh - r));
      g.add(spike);
    }
  } else {
    // Maze: tall walls are hedges, the low ones you can vault are stone.
    const low = h <= 50;
    const m = texturedBox(w, h, d, low ? stoneTexture() : hedgeTexture(), 0xffffff, low ? 90 : 110);
    m.position.y = h / 2;
    g.add(m);
  }

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.6 }),
  );
  edges.position.y = h / 2;
  g.add(edges);
  parent.add(g);
  return true;
}

/** Boulders, ice shards or trees scattered around the sides and back of the arena, never in front where the camera is. */
export function rimScenery(parent: THREE.Object3D, W: number, H: number, look: Look, lite: boolean) {
  const count = lite ? 14 : 30;
  for (let n = 0; n < count; n++) {
    let x: number, z: number;
    do { x = -380 + rnd(W + 760); z = -420 + rnd(H + 420); } while (x >= -50 && x <= W + 50 && z >= -50);
    const item = new THREE.Group();
    item.position.set(x, 0, z);
    item.rotation.y = rnd(Math.PI * 2);
    if (look === "moon") {
      const r = 25 + rnd(55), sy = 0.5 + rnd(0.3);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.72, 0.05, 0.3 + rnd(0.15)), roughness: 1, flatShading: true }));
      rock.scale.y = sy; rock.position.y = r * sy * 0.5;
      item.add(rock);
    } else if (look === "ice") {
      const r = 18 + rnd(30), sh = 80 + rnd(140);
      const shard = new THREE.Mesh(new THREE.ConeGeometry(r, sh, 5), iceMaterial(undefined, 0.75, 0xbfe9ff));
      shard.position.y = sh / 2; shard.rotation.z = (rnd(2) - 1) * 0.15;
      item.add(shard);
    } else {
      const foliage = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.36, 0.5, 0.12 + rnd(0.06)), roughness: 1, flatShading: true });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(6, 9, 45, 6), new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 1 }));
      trunk.position.y = 22;
      const low = new THREE.Mesh(new THREE.ConeGeometry(45 + rnd(25), 120 + rnd(40), 7), foliage);
      low.position.y = 45 + 60;
      const top = new THREE.Mesh(new THREE.ConeGeometry(30 + rnd(15), 90 + rnd(30), 7), foliage);
      top.position.y = 45 + 120 + 30;
      item.add(trunk, low, top);
    }
    item.traverse((m) => { m.castShadow = true; });
    parent.add(item);
  }
}
