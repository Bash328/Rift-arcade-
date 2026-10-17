// Client pieces shared by every Rift Arcade game: the neon 3D stage, touch and
// keyboard controls, the lobby, the room-code chip, particles and a chase camera.
// A game file only adds its own arena, rules and HUD on top of these.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export const NEON_CYAN = 0x00e5ff;
export const NEON_PINK = 0xff2bd6;

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Renderer, scene (fog + gradient sky + soft ambient light), camera and the bloom
 * pipeline. The canvas follows whatever box the cabinet gives `arenaEl` (4:3 on
 * desktop, the whole screen on a phone).
 */
export function createStage(arenaEl: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(960, 720, false); // CSS sizes the canvas to its cabinet screen
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  arenaEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x120826, 0.0004);

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

  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1, 4000);

  // Bloom is what makes the bright lines and emissive cubes glow.
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(960, 720, { type: THREE.HalfFloatType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(960, 720), 0.9, 0.5, 0.7));
  composer.addPass(new OutputPass());

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
    composer.render(); // so the arena shows behind the lobby before the game loop starts
  }
  new ResizeObserver(resize).observe(arenaEl);
  resize();

  return { renderer, scene, camera, composer };
}

/** A dark solid box with glowing edges. Sim (x, y) maps to world (x, z). */
export function neonBox(
  scene: THREE.Scene, w: number, h: number, d: number, x: number, y: number, z: number, edge: number,
) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x16102b, roughness: 0.6 }));
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edge })));
  scene.add(mesh);
  return mesh;
}

/** Pooled particles, used for movement trails and bursts. */
export function createParticles(scene: THREE.Scene) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const pool = Array.from({ length: 300 }, () => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true }));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, vel: new THREE.Vector3(), life: 0, max: 1, size: 1 };
  });

  return {
    emit(pos: THREE.Vector3, color: THREE.ColorRepresentation, vel: THREE.Vector3, life: number, size: number) {
      const p = pool.find((q) => q.life <= 0);
      if (!p) { return; }
      p.mesh.position.copy(pos);
      (p.mesh.material as THREE.MeshBasicMaterial).color.set(color);
      p.vel.copy(vel);
      p.life = p.max = life;
      p.size = size;
      p.mesh.visible = true;
    },
    update(dt: number) {
      for (const p of pool) {
        if (p.life <= 0) { continue; }
        p.life -= dt;
        if (p.life <= 0) { p.mesh.visible = false; continue; }
        const k = p.life / p.max;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.scale.setScalar(p.size * k);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = k;
      }
    },
  };
}

type Axis = -1 | 0 | 1;

/**
 * Keyboard (WASD / arrows / space) plus the on-screen joystick (#stick, #knob)
 * and jump button (#jump). `read()` gives one input frame; `syncKnob()` makes
 * the knob mirror the keyboard when nobody is touching it.
 */
export function createControls() {
  const stickEl = byId("stick");
  const knobEl = byId("knob");
  const jumpEl = byId("jump");

  const held = new Set<string>();
  addEventListener("keydown", (e) => {
    // Typing a name or code in the lobby must not steer or jump.
    if ((e.target as HTMLElement).tagName === "INPUT") { return; }
    // Arrow keys and space would otherwise scroll the page.
    if (e.key.startsWith("Arrow") || e.key === " ") { e.preventDefault(); }
    held.add(e.key.toLowerCase());
  });
  addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));

  /** Opposite keys cancel out, so the axis is always exactly -1, 0 or 1. */
  function axis(negative: string[], positive: string[]): Axis {
    const back = negative.some((k) => held.has(k));
    const forward = positive.some((k) => held.has(k));
    if (back === forward) { return 0; }
    return back ? -1 : 1;
  }
  const keyX = () => axis(["a", "arrowleft"], ["d", "arrowright"]);
  const keyY = () => axis(["w", "arrowup"], ["s", "arrowdown"]);

  // Drag the joystick on a phone (or with a mouse): same -1/0/1 axes as the keyboard.
  const stick = { x: 0 as Axis, y: 0 as Axis, active: false };
  const moveKnob = (x: number, y: number) => { knobEl.style.transform = `translate(${x}px, ${y}px)`; };

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
  let jumpHeld = false;
  const setJump = (down: boolean) => { jumpHeld = down; jumpEl.classList.toggle("down", down); };
  jumpEl.addEventListener("pointerdown", (e) => { jumpEl.setPointerCapture(e.pointerId); setJump(true); });
  for (const type of ["pointerup", "pointercancel"]) { jumpEl.addEventListener(type, () => setJump(false)); }

  return {
    read() {
      return {
        moveX: (keyX() || stick.x) as Axis,
        moveY: (keyY() || stick.y) as Axis,
        jump: (held.has(" ") || jumpHeld ? 1 : 0) as 0 | 1,
      };
    },
    syncKnob() {
      if (stick.active) { return; }
      const reach = (stickEl.offsetWidth / 3) * 0.8;
      moveKnob(keyX() * reach, keyY() * reach);
    },
  };
}

export interface JoinFns<R> {
  quick(name: string): Promise<R>;
  create(name: string): Promise<R>;
  byId(code: string, name: string): Promise<R>;
}

const cleanCode = (value: string) => value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);

function savedName(): string {
  try { return localStorage.getItem("name") ?? ""; } catch { return ""; }
}

/**
 * The lobby (#lobby): quick play (the public room), a private room with a
 * shareable code, or join a friend's code. An invite link (?room=CODE) joins
 * straight away once a name is known. Resolves with the joined room.
 */
export function runLobby<R>(join: JoinFns<R>): Promise<R> {
  const lobbyEl = byId<HTMLFormElement>("lobby");
  const nameEl = byId<HTMLInputElement>("nameInput");
  const codeEl = byId<HTMLInputElement>("codeInput");
  const msgEl = byId("lobbyMsg");
  const cabEl = document.querySelector(".cab--game")!;

  nameEl.value = savedName();
  codeEl.value = cleanCode(new URLSearchParams(location.search).get("room") ?? "");

  return new Promise((resolve) => {
    async function enter(how: string) {
      // On a phone, go fullscreen and landscape. Needs the tap that got us here,
      // so it comes before any await; unsupported browsers (iPhone) just skip it.
      if (matchMedia("(pointer: coarse)").matches) {
        document.documentElement.requestFullscreen?.()
          .then(() => (screen.orientation as any)?.lock?.("landscape"))
          .catch(() => { /* not supported or refused */ });
      }
      const name = nameEl.value.trim().slice(0, 12) || "Player";
      const code = cleanCode(codeEl.value);
      if (how === "join" && code.length !== 4) { msgEl.textContent = "Enter the 4-letter room code."; return; }
      msgEl.textContent = "";
      lobbyEl.classList.add("busy");
      try {
        try { localStorage.setItem("name", name); } catch { /* private mode: just don't remember it */ }
        const room = how === "create" ? await join.create(name)
          : how === "join" ? await join.byId(code, name)
          : await join.quick(name);
        lobbyEl.hidden = true;
        cabEl.classList.remove("lobbying");
        resolve(room);
      } catch (e) {
        console.error(e);
        msgEl.textContent = how === "join" ? "No open room with that code." : "Could not connect. Try again.";
        lobbyEl.classList.remove("busy");
      }
    }

    lobbyEl.addEventListener("submit", (e) => {
      e.preventDefault();
      // Enter inside the code box means "join"; otherwise use the button pressed.
      const pressed = (e.submitter as HTMLButtonElement | null)?.value;
      void enter(document.activeElement === codeEl && codeEl.value ? "join" : pressed ?? "quick");
    });
    codeEl.addEventListener("input", () => { codeEl.value = cleanCode(codeEl.value); });

    if (codeEl.value.length === 4 && nameEl.value) { void enter("join"); }
    else if (codeEl.value) { msgEl.textContent = `Invited to room ${codeEl.value}. Enter your name, then Join.`; }
  });
}

/** The room code chip (#roomTag): tap to share the invite link (share sheet on phones, else copy). */
export function showRoomTag(room: { roomId: string }, gameName: string) {
  const roomTagEl = byId<HTMLButtonElement>("roomTag");
  history.replaceState(null, "", `?room=${room.roomId}`);
  const label = `ROOM ${room.roomId} - INVITE`;
  roomTagEl.hidden = false;
  roomTagEl.textContent = label;
  roomTagEl.onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${room.roomId}`;
    try {
      if (navigator.share) { await navigator.share({ title: gameName, text: `Join my ${gameName} room`, url }); return; }
      await navigator.clipboard.writeText(url);
      roomTagEl.textContent = "LINK COPIED";
    } catch {
      roomTagEl.textContent = url; // clipboard blocked: show it so it can be copied by hand
    }
    setTimeout(() => { roomTagEl.textContent = label; }, 2500);
  };
}

/**
 * Desktop keeps a fixed overview of the whole arena. A phone can't fit it, so
 * there the camera chases the player (clamped so it doesn't wander off the arena).
 * Call the returned function every frame with the player's world position.
 */
export function createCameraRig(
  camera: THREE.PerspectiveCamera,
  overviewPos: THREE.Vector3,
  overviewLook: THREE.Vector3,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
) {
  camera.position.copy(overviewPos);
  camera.lookAt(overviewLook);

  const followMq = matchMedia("(pointer: coarse), (max-width: 700px)");
  const camGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  const look = overviewLook.clone();

  return (target?: THREE.Vector3) => {
    if (followMq.matches && target) {
      const fx = Math.min(Math.max(target.x, bounds.minX), bounds.maxX);
      const fz = Math.min(Math.max(target.z, bounds.minZ), bounds.maxZ);
      camGoal.set(fx, 300, fz + 300);
      lookGoal.set(fx, 0, fz);
    } else {
      camGoal.copy(overviewPos);
      lookGoal.copy(overviewLook);
    }
    camera.position.lerp(camGoal, 0.12);
    look.lerp(lookGoal, 0.12);
    camera.lookAt(look);
  };
}

/** Names come from other players, so the scoreboard is built with textContent only. */
export function drawBoard(
  boardEl: HTMLElement,
  rows: { hue: number; text: string }[],
) {
  boardEl.replaceChildren(...rows.map((r) => {
    const row = document.createElement("div");
    const swatch = document.createElement("i");
    swatch.style.background = `hsl(${r.hue} 70% 55%)`;
    row.append(swatch, r.text);
    return row;
  }));
}

export type Sfx = "jump" | "land" | "tag" | "crack" | "drop" | "fall" | "tick" | "go" | "win" | "click" | "join";
const SFX: Sfx[] = ["jump", "land", "tag", "crack", "drop", "fall", "tick", "go", "win", "click", "join"];

/**
 * Sound effects (CC0, from public/sfx) through the Web Audio API. Browsers only
 * allow sound after a tap or key press, so the context starts on the first one.
 * The mute button (#mute) and the M key toggle sound, and the choice is remembered.
 */
export function createAudio() {
  const muteEl = document.getElementById("mute");
  let muted = false;
  try { muted = localStorage.getItem("muted") === "1"; } catch { /* private mode */ }

  let ctx: AudioContext | undefined;
  const buffers = new Map<Sfx, AudioBuffer>();

  const refresh = () => {
    muteEl?.classList.toggle("off", muted);
    muteEl?.setAttribute("aria-pressed", String(muted));
  };
  const toggle = () => {
    muted = !muted;
    try { localStorage.setItem("muted", muted ? "1" : "0"); } catch { /* private mode */ }
    refresh();
  };
  refresh();
  muteEl?.addEventListener("click", toggle);

  async function load(context: AudioContext) {
    await Promise.all(SFX.map(async (name) => {
      try {
        const res = await fetch(`/sfx/${name}.ogg`);
        buffers.set(name, await context.decodeAudioData(await res.arrayBuffer()));
      } catch { /* a browser that can't decode Ogg just plays without that sound */ }
    }));
  }
  function unlock() {
    if (!ctx) { ctx = new AudioContext(); void load(ctx); }
    void ctx.resume();
  }
  for (const type of ["pointerdown", "keydown"]) { addEventListener(type, unlock, { passive: true }); }
  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "m" && (e.target as HTMLElement).tagName !== "INPUT") { toggle(); }
  });
  // Lobby buttons click.
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest?.(".lbtn")) { api.play("click", 0.7); }
  });

  const api = {
    play(name: Sfx, volume = 1, rate = 1) {
      const buffer = buffers.get(name);
      if (muted || !ctx || ctx.state !== "running" || !buffer) { return; }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = Math.min(Math.max(volume, 0), 1) * 0.5;
      source.connect(gain).connect(ctx.destination);
      source.start();
    },
  };
  return api;
}

/** Jump and landing sounds from the player's vertical speed. Call every frame. */
export function jumpSounds(audio: ReturnType<typeof createAudio>) {
  let prev = 0;
  return (vz: number) => {
    if (vz > 200 && prev <= 0) { audio.play("jump", 0.8, 0.95 + Math.random() * 0.1); }
    else if (vz === 0 && prev < -100) { audio.play("land", 0.9); }
    prev = vz;
  };
}

/**
 * Full screen (#fs button, or the F key). The page switches to the "immersive"
 * layout - the game fills the screen with the controls drawn over it - in full
 * screen and on phone-sized screens. Hidden where the browser can't do it (iPhone).
 */
export function createFullscreen() {
  const root = document.documentElement;
  const btn = document.getElementById("fs");
  const phoneMq = matchMedia("(max-width: 700px), (max-height: 520px)");

  if (!root.requestFullscreen) { btn?.setAttribute("hidden", ""); }

  const sync = () => {
    const full = !!document.fullscreenElement;
    root.classList.toggle("is-fullscreen", full);
    root.classList.toggle("immersive", full || phoneMq.matches);
    btn?.classList.toggle("on", full);
    btn?.setAttribute("aria-pressed", String(full));
  };
  const toggle = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); }
    else { root.requestFullscreen?.().catch(() => { /* refused: stay windowed */ }); }
  };

  btn?.addEventListener("click", toggle);
  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "f" && (e.target as HTMLElement).tagName !== "INPUT") { toggle(); }
  });
  document.addEventListener("fullscreenchange", sync);
  phoneMq.addEventListener("change", sync);
  sync();
}
