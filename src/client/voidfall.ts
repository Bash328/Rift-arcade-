import { ColyseusSDK, Callbacks } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import * as THREE from "three";
import type { default as server } from "../app.config.js";
import type { MoveInput } from "../rooms/schema/MyRoomState.js";
import type { VoidRoom } from "../rooms/VoidRoom.js";
import { PLAYER_HALF } from "../shared/constants.js";
import { stepVoidEntity, VOID_SIZE, SOLID, CELLS, FLOOR_GAP, floorsOf, floorZ } from "../shared/void.js";
import { VOID_MODES, voidModeOf } from "../shared/voidModes.js";
import {
  createStage, createParticles, createControls,
  runLobby, showRoomTag, leaveToLobby, wireBack, createCameraRig, drawBoard, createAudio, jumpSounds, createFullscreen, createDebugHud, gameReady, showFatal, SHADOW_MAP,
  INTERP_BASE, adaptInterpolationDelay, trackRemote, type Sfx,
} from "./kit.js";
import { Avatar } from "./avatars.js";
import { createTiles } from "./voidtiles.js";

const statusEl = document.getElementById("status")!;
const arenaEl = document.getElementById("arena")!;
const boardEl = document.getElementById("board")!;
const lampEl = document.getElementById("itLamp")!;
const roundEndEl = document.getElementById("roundEnd")!;
const roundWinnerEl = document.getElementById("roundWinner")!;
const roundNextEl = document.getElementById("roundNext")!;
const roundRulesEl = document.getElementById("roundRules")!;
const roundCountEl = document.getElementById("roundCount")!;
const roundReadyEl = document.getElementById("roundReady") as HTMLButtonElement;
const roundReadyCountEl = document.getElementById("roundReadyCount")!;
const modeBannerEl = document.getElementById("modeBanner")!;
const modeNameEl = document.getElementById("modeName")!;
const modeBlurbEl = document.getElementById("modeBlurb")!;

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
Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 1, far: 2400 });
scene.add(sun, sun.target);

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

// The tiles are drawn as a few instanced meshes (see voidtiles.ts). Sounds and sparks for them are wired up once the room is joined.
const tileEvents = { cracked: (_at: THREE.Vector3) => {}, dropped: (_at: THREE.Vector3) => {} };
const tiles = createTiles(scene, { cracked: (at) => tileEvents.cracked(at), dropped: (at) => tileEvents.dropped(at) });
// The lobby shows a whole floor behind it.
tiles.update(new Array(CELLS).fill(SOLID), [], 0, { me: null }, 0, 0);
composer.render();

// Private rooms: the host can lock one mode, or leave them taking turns.
const modeSelect = document.getElementById("modeSelect") as HTMLSelectElement;
for (const m of VOID_MODES) { modeSelect.append(new Option(m.name, m.id)); }
try { modeSelect.value = localStorage.getItem("voidMode") ?? ""; } catch { /* private mode */ }
modeSelect.addEventListener("change", () => { try { localStorage.setItem("voidMode", modeSelect.value); } catch { /* private mode */ } });

const quickPlay = (name: string) => client.joinOrCreate("void_room", { name });
type GameRoom = Awaited<ReturnType<typeof quickPlay>>;

async function main() {
  const room = await runLobby<GameRoom>({
    quick: quickPlay,
    create: (name) => client.create("void_room", { name, private: true, mode: modeSelect.value }),
    byId: (code, name) => client.joinById<VoidRoom>(code, { name }),
    reconnect: (token) => client.reconnect(token) as Promise<GameRoom>,
  });
  showRoomTag(room, "Voidfall");
  audio.play("join");
  wireBack(room);
  debug.watch(room);
  // Others are drawn a little behind the newest update so a late or bunched-up one does not show;
  // how far behind follows the connection (adaptInterpolationDelay). The spring (smoothMs) keeps their
  // speed continuous even when the update stream is rough: ~65 ms of extra display lag.
  const predict = Predict.get(room, { mode: "lerp", delay: INTERP_BASE + 20, smoothMs: 65 });
  adaptInterpolationDelay(room, predict);
  const input = room.input<MoveInput>({ mode: "reliable" });
  document.getElementById("roundExit")!.addEventListener("click", (e) => { e.preventDefault(); void leaveToLobby(room); });

  // Ready: the next round starts as soon as everyone has pressed it, so nobody reading the rules falls behind.
  const sayReady = () => { if (!roundReadyEl.disabled) { room.send("ready"); } };
  roundReadyEl.addEventListener("click", sayReady);
  addEventListener("keydown", (e) => { if (e.key === "Enter" && !roundEndEl.hidden && (e.target as HTMLElement).tagName !== "INPUT") { sayReady(); } });
  // Share the result: the share sheet on phones, else copy the text and link. It links to the game, not the room (which ends).
  const shareEl = document.getElementById("roundShare") as HTMLButtonElement;
  shareEl.addEventListener("click", async () => {
    const { winner, mode } = room.state;
    const name = voidModeOf(mode).name;
    const text = winner === room.state.players.get(room.sessionId)?.name
      ? `I just won a round of ${name} on Rift Arcade! Can you beat me?`
      : `${winner} won a round of ${name} on Rift Arcade. Think you can do better?`;
    const url = `${location.origin}${location.pathname}`;
    try {
      if (navigator.share) { await navigator.share({ title: "Voidfall", text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      shareEl.textContent = "Copied!";
    } catch (e) {
      if ((e as Error).name === "AbortError") { return; } // closed the share sheet
      shareEl.textContent = "Could not share";
    }
    setTimeout(() => { shareEl.textContent = "Share"; }, 2500);
  });

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
    trackRemote(predict, player, ["x", "y", "z"]);
  });
  callbacks.onRemove("players", (player, sessionId) => {
    predict.detach(player);
    avatars.get(sessionId)?.dispose();
    avatars.delete(sessionId);
  });
  room.onLeave(() => {
    statusEl.textContent = "Disconnected";
    avatars.forEach((avatar) => avatar.dispose());
    avatars.clear();
  });

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
  tileEvents.cracked = (at) => hear("crack", at);
  tileEvents.dropped = (at) => {
    hear("drop", at);
    for (let k = 0; k < 6; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 200, Math.random() * 150, (Math.random() - 0.5) * 200);
      particles.emit(at.clone().setY(at.y + 4), 0xff6a4a, v, 0.6, 7, k % 2 ? "star" : "glow");
    }
  };

  // The names list: bots that sit a Hex-A-Gone round out are not shown.
  let boardKey = "";
  function refreshBoard() {
    const hex = room.state.mode === "hex";
    const rows = [...room.state.players.entries()]
      .filter(([, p]) => !(hex && p.name.startsWith("BOT ")))
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

  // Everyone who joins a room (once per room: a refresh does not repeat it) gets a card explaining the mode and the controls.
  const introEl = document.getElementById("intro")!;
  const closeIntro = () => { introEl.hidden = true; };
  document.getElementById("introClose")!.addEventListener("click", closeIntro);
  addEventListener("keydown", (e) => { if (e.key === "Escape") { closeIntro(); } });
  let shownRound = 0;
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  let introSeen = false;
  try { introSeen = sessionStorage.getItem(`intro:${room.roomId}`) === "1"; sessionStorage.setItem(`intro:${room.roomId}`, "1"); } catch { /* private mode */ }
  if (!introSeen) {
    const mode = voidModeOf(room.state.mode);
    document.getElementById("introTitle")!.textContent = mode.name;
    document.getElementById("introRules")!.textContent = mode.rules;
    const touch = matchMedia("(pointer: coarse)").matches;
    document.getElementById("introControls")!.textContent =
      `${touch ? "Drag the stick to move and tap JUMP to hop gaps." : "Move with W A S D or the arrow keys, jump with Space."} ` +
      (room.state.modeLocked ? "This room keeps one mode." : "The mode changes every round.");
    introEl.hidden = false;
    shownRound = room.state.round; // the intro already says what this round is, so skip the banner
    setTimeout(closeIntro, 15000);
  }

  function frame(now: number) {
    const frameMs = now - last;
    const dt = Math.min(frameMs / 1000, 0.1);
    last = now;
    adaptQuality(frameMs);
    debug.frame(frameMs);
    // After the tab was hidden or the phone stalled, the clock reports a pile of due steps; sending them all
    // at once would trip the server's message limit, so send a few (one right after a long stall).
    const steps = Math.min(predict.tick(now), frameMs > 500 ? 1 : 3);
    for (let i = 0; i < steps; i++) {
      Object.assign(input.data, controls.read());
      input.send();
    }

    const { phase, countdown, alive, winner, mode, tiles: tileStates, kinds } = room.state;
    const me = room.state.players.get(room.sessionId);
    const floors = floorsOf(tileStates);
    // Which floor I am on (the nearest surface to my height), for the camera and for fading the floors above me.
    const myZ = me ? predict.value(me, "z") : 0;
    const myFloor = Math.min(floors - 1, Math.max(0, Math.round(-myZ / FLOOR_GAP)));
    const watching = !me?.alive;
    tiles.update(
      tileStates, kinds, room.state.round,
      { me: watching || !me ? null : { x: predict.value(me, "x"), y: predict.value(me, "y"), floor: myFloor } },
      now, dt,
    );

    for (const [sessionId, player] of room.state.players) {
      const avatar = avatars.get(sessionId);
      if (!avatar) { continue; }
      avatar.group.visible = player.alive;
      const z = predict.value(player, "z");
      feet.set(predict.value(player, "x"), z, predict.value(player, "y"));
      avatar.update(dt, feet, { celebrate: phase === "over" && player.alive });
      // Falling players leave a streak of sparks.
      if (player.alive && player.vz < -150) {
        chest.copy(feet).y += PLAYER_HALF;
        particles.emit(chest, 0xff8ad8, zero, 0.4, 7, "star");
      }
    }
    particles.update(dt);

    const myAvatar = avatars.get(room.sessionId);
    if (me) { onVz(predict.value(me, "vz")); }
    controls.syncKnob();
    lampEl.classList.toggle("on", !!me && !me.alive && (phase === "playing" || phase === "over"));
    moveCamera(me?.alive ? myAvatar?.group.position : undefined, floorZ(myFloor));

    // A new round: say what the mode is for a few seconds.
    if (room.state.round !== shownRound && phase !== "over") {
      shownRound = room.state.round;
      const m = voidModeOf(mode);
      modeNameEl.textContent = m.name;
      modeBlurbEl.textContent = m.blurb;
      modeBannerEl.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { modeBannerEl.hidden = true; }, 4000);
    }
    if (phase === "over") { modeBannerEl.hidden = true; }

    // Game-state sounds.
    if (phase === "countdown" && countdown !== prevCountdown) { audio.play("tick"); }
    if (phase === "playing" && prevPhase !== "playing") { audio.play("go"); }
    if (phase === "over" && prevPhase !== "over") { audio.play("win", me && winner === me.name ? 1 : 0.6); }
    if (me && prevAlive && !me.alive && phase === "playing") { audio.play("fall"); }
    prevPhase = phase;
    prevCountdown = countdown;
    prevAlive = me?.alive ?? true;

    refreshBoard();

    // The winner card: who won, what is next, and Ready.
    roundEndEl.hidden = phase !== "over";
    if (phase === "over") {
      roundWinnerEl.textContent = winner === me?.name ? "You win!" : `${winner} wins!`;
      const next = voidModeOf(room.state.nextMode);
      roundNextEl.textContent = `Next: ${next.name}`;
      roundRulesEl.textContent = next.rules;
      roundCountEl.textContent = String(room.state.nextIn);
      const everyone = [...room.state.players.values()];
      roundReadyCountEl.textContent = `${everyone.filter((p) => p.ready).length} of ${everyone.length} ready`;
      roundReadyEl.disabled = !!me?.ready;
      roundReadyEl.textContent = me?.ready ? "Ready!" : "Ready";
    }

    const where = floors > 1 && me?.alive ? ` - floor ${myFloor + 1}` : "";
    statusEl.textContent =
      phase === "over" ? "" :
      phase === "waiting" ? "Waiting for another player..." :
      phase === "countdown" ? `${voidModeOf(mode).name} - get ready... ${countdown}` :
      me?.alive ? `${alive} left${where} - keep moving!` : `You fell! Watching - ${alive} left`;
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
