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
    tex.anisotropy = 4; // the texture is seen at a glancing angle: keeps thin lines from shimmering
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

/** Dark metal panels with glowing seams: the Neon Grid block skin. */
function paintPanel(g: CanvasRenderingContext2D, s: number) {
  g.fillStyle = "#1a1233"; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.05)})`; g.fillRect(rnd(s), rnd(s), 1 + rnd(3), 1); }
  g.strokeStyle = "rgba(0,229,255,0.55)"; g.lineWidth = 2;
  g.strokeRect(1, 1, s - 2, s - 2);
  g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s / 3, s / 2); g.lineTo(s / 3 + 30, s / 2 + 30); g.lineTo(s, s / 2 + 30); g.stroke();
}

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

/** Ice blocks wait here until flushIce: three instanced draws for the whole rink instead of five meshes per block. */
const ice = { body: [] as Spot[], core: [] as Spot[], spike: [] as Spot[] };

/** Draw the ice blocks that skinObstacle collected. Call once after the last obstacle. */
export function flushIce(parent: THREE.Object3D, env?: THREE.Texture) {
  instanced(parent, new THREE.BoxGeometry(1, 1, 1), iceMaterial(env, 0.55), ice.body);
  instanced(parent, new THREE.BoxGeometry(1, 1, 1), iceMaterial(env, 0.85, 0xe8fbff), ice.core);
  instanced(parent, new THREE.ConeGeometry(1, 1, 5), iceMaterial(env, 0.9, 0xd8f4ff), ice.spike);
  ice.body.length = ice.core.length = ice.spike.length = 0;
}

/** Draws one obstacle's body in the arena's look (its edges are the caller's). Returns false for the plain neon look. */
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
    // A glassy block with a brighter core and a few small crystals on top. Collected, then drawn together by flushIce.
    ice.body.push({ x: o.x, y: h / 2, z: o.y, sx: w, sy: h, sz: d });
    ice.core.push({ x: o.x, y: h / 2, z: o.y, sx: w * 0.5, sy: h * 0.9, sz: d * 0.5 });
    const r = Math.max(3, Math.min(o.hw, o.hh) * 0.25);
    for (let i = 0; i < 3; i++) {
      const sh = 14 + rnd(18);
      ice.spike.push({ x: o.x + (rnd(2) - 1) * (o.hw - r), y: h + sh / 2, z: o.y + (rnd(2) - 1) * (o.hh - r), sx: r, sy: sh, sz: r });
    }
  } else if (look === "neon") {
    // Dark tech block with a glowing cap; the cap sits inside the top face.
    const m = texturedBox(w, h, d, texture("panel", paintPanel), 0xffffff, 100);
    m.position.y = h / 2;
    // A flat glowing plate just above the top face. It used to be a thin box whose top sat exactly on the
    // block's top, and the two surfaces fought over the pixels (the stripes seen on the block tops).
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(w - 4, d - 4), new THREE.MeshBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.45, depthWrite: false }));
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = h + 0.4;
    g.add(m, cap);
  } else {
    // Maze: tall walls are hedges, the low ones you can vault are stone.
    const low = h <= 50;
    const m = texturedBox(w, h, d, low ? stoneTexture() : hedgeTexture(), 0xffffff, low ? 90 : 110);
    m.position.y = h / 2;
    g.add(m);
  }

  parent.add(g); // the glowing edges are batched by the arena (createBoxBatch)
  return true;
}

interface Spot { x: number; y: number; z: number; yaw?: number; tilt?: number; sx: number; sy: number; sz: number; color?: THREE.ColorRepresentation }

/** Every copy of one shape in a single draw call (and a single shadow draw). The geometry is a unit shape; each spot scales it. */
function instanced(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, spots: Spot[]) {
  if (!spots.length) { geometry.dispose(); material.dispose(); return; }
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  const dummy = new THREE.Object3D();
  dummy.rotation.order = "YZX"; // turn about the vertical, then lean
  const color = new THREE.Color();
  spots.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw ?? 0, p.tilt ?? 0);
    dummy.scale.set(p.sx, p.sy, p.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (p.color !== undefined) { mesh.setColorAt(i, color.set(p.color)); }
  });
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
}

/** Boulders, ice shards or trees scattered around the sides and back of the arena, never in front where the camera is. */
export function rimScenery(parent: THREE.Object3D, W: number, H: number, look: Look, lite: boolean) {
  const count = (look === "ice" ? 44 : 30) >> (lite ? 1 : 0);
  const pylons: Spot[] = [], heads: Spot[] = [], rocks: Spot[] = [], shards: Spot[] = [], drifts: Spot[] = [], trunks: Spot[] = [], foliage: Spot[] = [];
  const gemEdges = look === "neon" ? new THREE.EdgesGeometry(new THREE.OctahedronGeometry(40)) : undefined;
  const gemMaterials = [new THREE.LineBasicMaterial({ color: 0x00e5ff }), new THREE.LineBasicMaterial({ color: 0xff2bd6 })];
  for (let n = 0; n < count; n++) {
    let x: number, z: number;
    do { x = -380 + rnd(W + 760); z = -420 + rnd(H + 420); } while (x >= -50 && x <= W + 50 && z >= -50);
    const yaw = rnd(Math.PI * 2);
    if (look === "neon") {
      // A light pylon with a glowing head, and a hovering wire diamond above some.
      const hgt = 120 + rnd(180);
      pylons.push({ x, y: hgt / 2, z, yaw, sx: 14, sy: hgt, sz: 14 });
      heads.push({ x, y: hgt + 4, z, yaw, sx: 22, sy: 8, sz: 22, color: n % 2 ? 0xff2bd6 : 0x00e5ff });
      if (n % 3 === 0) {
        const gem = new THREE.LineSegments(gemEdges, gemMaterials[n % 2]);
        gem.position.set(x, hgt + 90, z);
        parent.add(gem);
      }
    } else if (look === "moon") {
      const r = 25 + rnd(55), sy = 0.5 + rnd(0.3);
      rocks.push({ x, y: r * sy * 0.5, z, yaw, sx: r, sy: r * sy, sz: r, color: new THREE.Color().setHSL(0.72, 0.05, 0.3 + rnd(0.15)) });
    } else if (look === "ice" && n % 2) {
      // Every other piece of ice scenery is a snow drift instead.
      const r = 60 + rnd(110);
      drifts.push({ x, y: -4, z, yaw, sx: r, sy: r * (0.3 + rnd(0.15)), sz: r });
    } else if (look === "ice") {
      const r = 18 + rnd(30), sh = 80 + rnd(140);
      shards.push({ x, y: sh / 2, z, yaw, tilt: (rnd(2) - 1) * 0.15, sx: r, sy: sh, sz: r });
    } else {
      const tint = new THREE.Color().setHSL(0.36, 0.5, 0.12 + rnd(0.06));
      trunks.push({ x, y: 22, z, yaw, sx: 1, sy: 1, sz: 1 });
      const r1 = 45 + rnd(25), h1 = 120 + rnd(40), r2 = 30 + rnd(15), h2 = 90 + rnd(30);
      foliage.push({ x, y: 45 + 60, z, yaw, sx: r1, sy: h1, sz: r1, color: tint }, { x, y: 45 + 120 + 30, z, yaw, sx: r2, sy: h2, sz: r2, color: tint });
    }
  }
  // Unit shapes, one draw call per kind of thing.
  instanced(parent, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x16102b, roughness: 0.6 }), pylons);
  instanced(parent, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), heads);
  instanced(parent, new THREE.DodecahedronGeometry(1), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), rocks);
  instanced(parent, new THREE.ConeGeometry(1, 1, 5), iceMaterial(undefined, 0.75, 0xbfe9ff), shards);
  instanced(parent, new THREE.SphereGeometry(1, 16, 8), new THREE.MeshStandardMaterial({ color: 0xe4f0fa, roughness: 1 }), drifts);
  instanced(parent, new THREE.CylinderGeometry(6, 9, 45, 6), new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 1 }), trunks);
  instanced(parent, new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), foliage);
}
