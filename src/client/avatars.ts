// Players as animated pets (Kenney "Cube Pets", CC0). An Avatar shows a coloured
// cube until its model has loaded, then swaps in the animal, which idles, runs,
// turns to face where it is going, and dances when it wins.

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { PETS, PLAYER_HALF } from "../shared/constants.js";

const loader = new GLTFLoader();
const models = new Map<string, Promise<GLTF>>();
const loadPet = (pet: string) => {
  let model = models.get(pet);
  if (!model) { model = loader.loadAsync(`/models/animal-${pet}.glb`); models.set(pet, model); }
  return model;
};

/** The pets are about 1.25 units wide; scale them a little past the hitbox so they read at a distance. */
const SCALE = (PLAYER_HALF * 2 * 1.35) / 1.25;
/** A pet's lowest point sits this far below its origin. */
const FEET = 0.3;

export interface AvatarLook {
  /** Glow red and grow: this player is "it". */
  it?: boolean;
  /** Play the dance (the winner). */
  celebrate?: boolean;
}

export class Avatar {
  /** Origin at the feet: x, z-above-floor, y in world coordinates. */
  readonly group = new THREE.Group();
  /** Squash-and-stretch amount, 1 -> 0. Set to 1 to pop the pet. */
  pop = 0;
  /** Last spot a trail glow was left. */
  trail?: THREE.Vector3;

  private readonly holder = new THREE.Group();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private mixer?: THREE.AnimationMixer;
  private current = "";
  private yaw = 0;
  private readonly lastFeet = new THREE.Vector3();
  private placeholder?: THREE.Mesh;
  private gone = false;

  constructor(private readonly scene: THREE.Scene, pet: number, hue: number) {
    const color = new THREE.Color().setHSL(hue / 360, 0.7, 0.55);

    // A ring in the player's colour under the feet keeps players tellable apart.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(PLAYER_HALF * 1.0, PLAYER_HALF * 1.3, 32),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.8;

    this.placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(PLAYER_HALF * 2, PLAYER_HALF * 2, PLAYER_HALF * 2),
      new THREE.MeshStandardMaterial({ color }),
    );
    this.placeholder.position.y = PLAYER_HALF;
    this.placeholder.castShadow = true;

    this.group.add(ring, this.placeholder, this.holder);
    scene.add(this.group);

    loadPet(PETS[pet % PETS.length]).then((gltf) => {
      if (this.gone) { return; }
      const model = gltf.scene.clone(true);
      model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) { return; }
        // Each avatar gets its own material so one can glow red without the rest.
        const material = (mesh.material as THREE.MeshStandardMaterial).clone();
        mesh.material = material;
        this.materials.push(material);
        mesh.castShadow = true;
      });
      this.holder.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) { this.actions.set(clip.name, this.mixer.clipAction(clip)); }
      this.group.remove(this.placeholder!);
      this.placeholder = undefined;
      this.play("idle");
    }).catch((e) => console.error("pet failed to load", e));
  }

  private play(name: string) {
    if (name === this.current) { return; }
    const next = this.actions.get(name);
    if (!next) { return; }
    next.reset().fadeIn(0.15).play();
    this.actions.get(this.current)?.fadeOut(0.15);
    this.current = name;
  }

  /** Move to `feet` and update the pose. Call once a frame. */
  update(dt: number, feet: THREE.Vector3, look: AvatarLook = {}) {
    // How fast are we moving across the floor? Drives running and facing.
    const dx = feet.x - this.lastFeet.x;
    const dz = feet.z - this.lastFeet.z;
    const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    this.lastFeet.copy(feet);
    this.group.position.copy(feet);

    if (speed > 30) {
      const target = Math.atan2(dx, dz);
      const turn = ((target - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += turn * (1 - Math.exp(-14 * dt));
      this.group.rotation.y = this.yaw;
    }

    this.play(look.celebrate ? "dance" : speed > 30 ? "run" : "idle");
    this.mixer?.update(dt);

    // Squash and stretch right after being tagged; "it" is bigger and glows.
    this.pop = Math.max(0, this.pop - dt / 0.4);
    const w = this.pop * this.pop;
    const base = look.it ? 1.3 : 1;
    const sx = base * (1 + 0.5 * w);
    const sy = base * (1 - 0.4 * w);
    this.holder.scale.set(SCALE * sx, SCALE * sy, SCALE * sx);
    this.holder.position.y = FEET * SCALE * sy;
    if (this.placeholder) { this.placeholder.scale.set(sx, sy, sx); this.placeholder.position.y = PLAYER_HALF * sy; }

    const glow = look.it ? 0xff2020 : 0x000000;
    for (const material of this.materials) { material.emissive.set(glow); }
    (this.placeholder?.material as THREE.MeshStandardMaterial | undefined)?.emissive.set(glow);
  }

  dispose() {
    this.gone = true;
    this.mixer?.stopAllAction();
    this.scene.remove(this.group);
  }
}
