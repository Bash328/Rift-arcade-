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

/** Phones and tablets: lighter graphics (less anti-aliasing, smaller shadows, lower resolution). */
export const LITE = matchMedia("(pointer: coarse)").matches;
export const SHADOW_MAP = LITE ? 1024 : 2048;

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

  // Screen-space gradient sky; `look` repaints it per arena.
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 2; skyCanvas.height = 256;
  const sky = new THREE.CanvasTexture(skyCanvas);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
  const hemi = new THREE.HemisphereLight(0x8a6cff, 0x120826, 1.6);
  scene.add(hemi);

  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1, 4000);

  // Bloom is what makes the bright lines and emissive cubes glow.
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(960, 720, { type: THREE.HalfFloatType, samples: LITE ? 2 : 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(960, 720), 0.9, 0.5, 0.7);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /** Sky gradient (top, middle, bottom), hemisphere light (sky, ground, intensity) and bloom threshold; omitted = the purple neon default. */
  function look(l: { sky?: [string, string, string]; hemi?: [number, number, number]; bloom?: number } = {}) {
    const g = skyCanvas.getContext("2d")!;
    const [top, mid, bottom] = l.sky ?? ["#05020f", "#3b0f5c", "#0a0418"];
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top); grad.addColorStop(0.55, mid); grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    sky.needsUpdate = true;
    const [h1, h2, hi] = l.hemi ?? [0x8a6cff, 0x120826, 1.6];
    hemi.color.set(h1); hemi.groundColor.set(h2); hemi.intensity = hi;
    bloom.threshold = l.bloom ?? 0.7;
  }
  look();

  /** Render scale: drops on a device that can't keep up, and recovers when it can. */
  let scale = 1;

  function resize() {
    const w = Math.max(arenaEl.clientWidth, 1);
    const h = Math.max(arenaEl.clientHeight, 1);
    const ratio = Math.min(devicePixelRatio, LITE ? 1.25 : 1.5) * scale;
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

  // Adaptive resolution: ~2 seconds of consecutive slow frames lowers the render
  // scale; ~10 seconds of fast ones raises it again. A single hitch changes nothing.
  let slow = 0;
  let fast = 0;
  function adaptQuality(frameMs: number) {
    if (frameMs > 40) { slow++; fast = 0; }
    else if (frameMs < 20) { fast++; slow = 0; }
    else { slow = 0; fast = 0; }
    if (slow >= 60 && scale > 0.5) { scale = Math.max(0.5, scale * 0.85); slow = 0; resize(); }
    else if (fast >= 600 && scale < 1) { scale = Math.min(1, scale * 1.1); fast = 0; resize(); }
  }

  return { renderer, scene, camera, composer, adaptQuality, renderScale: () => scale, look };
}

/** A dark solid box with glowing edges. Sim (x, y) maps to world (x, z). */
export function neonBox(
  parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, edge: number, body = 0x16102b,
) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: body, roughness: 0.6 }));
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edge })));
  parent.add(mesh);
  return mesh;
}

/** A CC0 sprite from /fx (Kenney Particle Pack), loaded once. */
export function loadFx(name: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(`/fx/${name}.png`);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Pooled glow sprites for trails and bursts. They blend additively, so with
 * bloom they read as light: "glow" is a soft dot, "star" a sparkle.
 */
export function createParticles(scene: THREE.Scene) {
  const textures = { glow: loadFx("circle_05"), star: loadFx("star_04") };
  const sizeFactor = { glow: 3.2, star: 4.5 };
  const pool = Array.from({ length: 300 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, vel: new THREE.Vector3(), life: 0, max: 1, size: 1, kind: "glow" as keyof typeof textures };
  });

  return {
    emit(
      pos: THREE.Vector3, color: THREE.ColorRepresentation, vel: THREE.Vector3,
      life: number, size: number, kind: keyof typeof textures = "glow",
    ) {
      const p = pool.find((q) => q.life <= 0);
      if (!p) { return; }
      p.sprite.position.copy(pos);
      p.sprite.material.map = textures[kind];
      p.sprite.material.color.set(color);
      p.vel.copy(vel);
      p.life = p.max = life;
      p.size = size;
      p.kind = kind;
      p.sprite.visible = true;
    },
    update(dt: number) {
      for (const p of pool) {
        if (p.life <= 0) { continue; }
        p.life -= dt;
        if (p.life <= 0) { p.sprite.visible = false; continue; }
        const k = p.life / p.max;
        p.sprite.position.addScaledVector(p.vel, dt);
        p.sprite.scale.setScalar(p.size * sizeFactor[p.kind] * (0.4 + 0.6 * k));
        p.sprite.material.opacity = k;
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
  /** Take the old seat back after an accidental refresh, if the game's room holds seats for a while. */
  reconnect?(token: string): Promise<R>;
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
export function runLobby<R extends { reconnectionToken: string }>(join: JoinFns<R>): Promise<R> {
  const lobbyEl = byId<HTMLFormElement>("lobby");
  const nameEl = byId<HTMLInputElement>("nameInput");
  const codeEl = byId<HTMLInputElement>("codeInput");
  const msgEl = byId("lobbyMsg");
  const cabEl = document.querySelector(".cab--game")!;

  nameEl.value = savedName();
  codeEl.value = cleanCode(new URLSearchParams(location.search).get("room") ?? "");

  // One seat per tab and game: sessionStorage survives a refresh but not a new tab.
  const seatKey = `seat:${location.pathname}`;
  const seat = {
    get: () => { try { return sessionStorage.getItem(seatKey); } catch { return null; } },
    set: (token: string) => { try { sessionStorage.setItem(seatKey, token); } catch { /* private mode: no resume */ } },
    clear: () => { try { sessionStorage.removeItem(seatKey); } catch { /* ignore */ } },
  };

  return new Promise((resolve) => {
    function joined(room: R) {
      seat.set(room.reconnectionToken);
      lobbyEl.hidden = true;
      cabEl.classList.remove("lobbying");
      resolve(room);
    }

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
        joined(room);
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

    const autoJoin = () => {
      if (codeEl.value.length === 4 && nameEl.value) { void enter("join"); }
      else if (codeEl.value) { msgEl.textContent = `Invited to room ${codeEl.value}. Enter your name, then Join.`; }
    };
    // A refresh drops the connection but the server holds the seat: resume it instead of joining as a new player.
    const token = seat.get();
    if (token && join.reconnect) {
      lobbyEl.classList.add("busy");
      join.reconnect(token).then(joined, () => { seat.clear(); lobbyEl.classList.remove("busy"); autoJoin(); });
    } else { autoJoin(); }
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
/** Phone camera: height above and distance behind the player. */
const PHONE_HEIGHT = 470;
const PHONE_BEHIND = 470;
/** PC camera: how much closer than the whole-arena view (1 = same), and how far it drifts toward you (0 = not at all). */
const DESKTOP_ZOOM = 0.78;
const DESKTOP_FOLLOW = 0.45;

export function createCameraRig(
  camera: THREE.PerspectiveCamera,
  overviewPos: THREE.Vector3,
  overviewLook: THREE.Vector3,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
) {
  let view = { pos: overviewPos.clone(), look: overviewLook.clone(), bounds };
  camera.position.copy(view.pos);
  camera.lookAt(view.look);

  const followMq = matchMedia("(pointer: coarse), (max-width: 700px)");
  const camGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  const look = overviewLook.clone();

  const offset = new THREE.Vector3();
  const update = (target?: THREE.Vector3) => {
    if (target) {
      const fx = Math.min(Math.max(target.x, view.bounds.minX), view.bounds.maxX);
      const fz = Math.min(Math.max(target.z, view.bounds.minZ), view.bounds.maxZ);
      if (followMq.matches) {
        // Phone: a close chase camera, a good way back so you can see who is near.
        camGoal.set(fx, PHONE_HEIGHT, fz + PHONE_BEHIND);
        lookGoal.set(fx, 0, fz);
      } else {
        // PC: closer than the whole-arena view, drifting only part of the way toward
        // you, so the screen stays calm but the pets are big enough to see.
        lookGoal.set(
          view.look.x + (fx - view.look.x) * DESKTOP_FOLLOW, 0,
          view.look.z + (fz - view.look.z) * DESKTOP_FOLLOW,
        );
        offset.copy(view.pos).sub(view.look).multiplyScalar(DESKTOP_ZOOM);
        camGoal.copy(lookGoal).add(offset);
      }
    } else {
      // No player to follow (lobby, spectating): the whole arena.
      camGoal.copy(view.pos);
      lookGoal.copy(view.look);
    }
    camera.position.lerp(camGoal, 0.12);
    look.lerp(lookGoal, 0.12);
    camera.lookAt(look);
  };
  /** Frame a different arena (the next round may be another size). */
  update.setView = (pos: THREE.Vector3, lookAt: THREE.Vector3, newBounds: typeof bounds, snap = false) => {
    view = { pos: pos.clone(), look: lookAt.clone(), bounds: newBounds };
    if (snap) { camera.position.copy(pos); look.copy(lookAt); camera.lookAt(look); } // no fly-in on first load
  };
  return update;
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
  const tipEl = document.getElementById("fsTip");

  // Opened from the home screen the page already has the whole screen.
  const installed = matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches
    || (navigator as { standalone?: boolean }).standalone === true;
  if (installed) { btn?.setAttribute("hidden", ""); }

  // Browsers that can't go full screen (iPhone, in-app browsers) get a tip on
  // how to install the page to the home screen, which opens with nothing around it.
  const showTip = () => { if (tipEl) { tipEl.hidden = false; } };
  document.getElementById("fsTipClose")?.addEventListener("click", () => { if (tipEl) { tipEl.hidden = true; } });

  const sync = () => {
    const full = !!document.fullscreenElement;
    root.classList.toggle("is-fullscreen", full);
    root.classList.toggle("immersive", full || phoneMq.matches);
    btn?.classList.toggle("on", full);
    btn?.setAttribute("aria-pressed", String(full));
  };
  const toggle = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); }
    else if (root.requestFullscreen) { root.requestFullscreen().catch(showTip); }
    else { showTip(); }
  };

  // Turning a phone to landscape is the moment to go full screen, but browsers only
  // allow it from a tap. So the first tap after rotating does it (the joystick
  // or JUMP counts), unless the page is already installed or can't do it.
  const landscape = matchMedia("(orientation: landscape)");
  const coarse = matchMedia("(pointer: coarse)");
  let armed = false;
  const armFullscreenOnTap = () => {
    if (armed || installed || !root.requestFullscreen || !coarse.matches || !landscape.matches || document.fullscreenElement) { return; }
    armed = true;
    addEventListener("pointerup", () => {
      armed = false;
      if (!document.fullscreenElement && landscape.matches) {
        root.requestFullscreen().then(() => (screen.orientation as any)?.lock?.("landscape")).catch(() => { /* refused */ });
      }
    }, { once: true, capture: true });
  };
  landscape.addEventListener("change", armFullscreenOnTap);
  armFullscreenOnTap();

  btn?.addEventListener("click", toggle);
  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "f" && (e.target as HTMLElement).tagName !== "INPUT") { toggle(); }
  });
  // Typing a name opens the on-screen keyboard. Keep the page on the part of the
  // screen that is still visible, instead of letting the browser pan it away.
  const viewport = window.visualViewport;
  if (viewport) {
    const fit = () => {
      root.style.setProperty("--vv-top", `${viewport.offsetTop}px`);
      root.style.setProperty("--vv-height", `${viewport.height}px`);
    };
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    fit();
  }
  document.addEventListener("focusin", (e) => {
    const field = e.target as HTMLElement;
    if (field.tagName === "INPUT") { setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 250); }
  });

  document.addEventListener("fullscreenchange", sync);
  phoneMq.addEventListener("change", sync);
  sync();
}

/**
 * Add ?debug to a game's address for a small readout of frame time (median and
 * 95th percentile), draw calls, triangles, GPU objects and the render scale -
 * the numbers to compare across devices and releases. Does nothing otherwise.
 */
export function createDebugHud(arenaEl: HTMLElement, renderer: THREE.WebGLRenderer, renderScale: () => number) {
  if (!new URLSearchParams(location.search).has("debug")) { return { frame(_ms: number) { /* off */ } }; }

  const el = document.createElement("pre");
  el.className = "debughud";
  arenaEl.appendChild(el);
  renderer.info.autoReset = false; // one composer.render() is several passes; count them all
  const times: number[] = [];
  let n = 0;

  return {
    frame(ms: number) {
      times.push(ms);
      if (times.length > 120) { times.shift(); }
      // `info` holds the previous frame's passes: read it, then clear it for the next frame.
      const { render, memory } = renderer.info;
      const calls = render.calls;
      const triangles = render.triangles;
      renderer.info.reset();
      n++;
      if (n % 30 !== 0 && n !== 3) { return; } // first reading after 3 frames, then every 30
      const sorted = [...times].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1);
      el.textContent =
        `frame ${at(0.5)} ms (p95 ${at(0.95)})  ${(1000 / Number(at(0.5))).toFixed(0)} fps\n` +
        `calls ${calls}  tris ${triangles}\n` +
        `geometries ${memory.geometries}  textures ${memory.textures}\n` +
        `render scale ${renderScale().toFixed(2)}`;
    },
  };
}

/** The game script is running: take down the "Loading" cover the page started with. */
export function gameReady() {
  (window as unknown as { __riftReady?: () => void }).__riftReady?.();
}

/** Something broke: say so, with a way to retry, instead of leaving a blank screen. */
export function showFatal(message: string) {
  let boot = document.getElementById("boot");
  if (!boot) {
    boot = document.createElement("div");
    boot.id = "boot";
    boot.className = "boot";
    document.getElementById("arena")?.appendChild(boot);
  }
  const text = document.createElement("p");
  text.textContent = message;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "lbtn lbtn--pink";
  reload.textContent = "Reload";
  reload.onclick = () => location.reload();
  boot.replaceChildren(text, reload);
}
