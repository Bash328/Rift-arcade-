# Rendering performance and frame-time smoothness (three.js, phones and low-end laptops)

Research basis: 4 searches and 4 page fetches (budget was small). Cited items come from the sources linked. Anything uncited is marked as inference. No hard measured mobile benchmarks (ms per pass on named phones) were found; that is a gap.

## 1. Bloom / post-processing, MSAA targets, HalfFloat targets

### Takeaway
Bloom is a fill-rate cost that scales with canvas pixels. The cheap fixes are a lower pixel ratio, half-res post, and bloom gated by tier. Rift's `createStage` already caps DPR and halves MSAA on LITE. The biggest remaining wins are a lower-res bloom chain, dropping HalfFloat+MSAA on LITE, and an "off" tier for the worst devices.

### Cited Findings
- Forum report: UnrealBloomPass on one object dropped a Core i7 laptop to about 40 fps with about 90% GPU use (threshold 0.21, strength 1.2, radius 0.55, pass sized to window); the thread has no replies/fix — [three.js forum](https://discourse.threejs.org/t/unreal-bloom-optimize/35476)
- Forum report: Intel MacBook Safari ran about 20 fps at full width but about 60 fps with the canvas about 400 px wide, so cost tracks canvas size. Disabling Safari's "WebGL via Metal" flag also restored 60 fps (anecdotal, one user) — [three.js forum](https://discourse.threejs.org/t/unrealbloompass-poor-performance-on-macos-safari-with-intel/42606)
- Rendering post-processing at half resolution and upscaling "can roughly double frame rate in fill-rate-bound scenes"; a 3x phone has 9x the pixels of a 1x screen, so cap DPR at 2 — [Utsubo 100 tips, tip 80](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Same source: bloom starting values intensity 0.5-2.0, threshold 0.8-1.0, radius 0.5-1.0; merge effects into one pass; on WebGL post stacks, renderer `antialias:false`, `stencil:false`, `depth:false` and set composer multisampling 0 if not needed (tips 73-81). This is a blog, not official docs.
- Discover three.js tips: built-in MSAA was found cheap on modern hardware including mobile; post-process FXAA/SMAA was slower and lower quality in the author's tests (author says the tips are not all experimentally verified) — [discoverthreejs](https://discoverthreejs.com/tips-and-tricks/)
- A commercial blog rates UnrealBloomPass "high cost, half-res only" for mobile (low authority) — [Digital Strategy Force](https://digitalstrategyforce.com/journal/how-do-you-add-post-processing-effects-to-a-webgl-scene/)

### Inferences
- Project, `createStage` (kit.ts:25-102), already good: DPR cap 1.25 LITE / 1.5 desktop, composer and renderer pixel ratio kept in sync, MSAA samples 2 on LITE, per-arena `bloom.threshold` via `look()`, resize on a ResizeObserver, and `adaptQuality` scales both.
- Cost model: UnrealBloomPass runs about 5 mip levels (down then up blur, ~10 blur passes plus composite) off the full-size target, and a HalfFloat MSAA target costs 8 bytes/pixel x samples plus a resolve. On a 1080x2400 phone at DPR 1.25 that is about 1350x3000 = 4M px, so MSAA 2 HalfFloat is about 64 MB plus resolve. This is arithmetic from the code, not a measurement.
- Ranked fixes for a solo dev (each is a few lines in `createStage`):
  1. On LITE use `samples: 0` and `type: UnsignedByteType` (or keep HalfFloat but drop MSAA). The render target is already hand-built (kit.ts:49) so this is a one-line tier switch. Test whether banding in sky/fog is visible; bloom with thresholds <1.0 on LDR content still works since the project's lights are not HDR-heavy (sun 2.2, hemi 1.6 do exceed 1, so keep HalfFloat if the glow looks wrong).
  2. Run bloom at reduced size: construct `UnrealBloomPass` with a Vector2 of half the canvas (note resize() currently calls `composer.setSize(w,h)` which resizes the bloom pass to full; override by calling `bloom.setSize(w*0.5, h*0.5)` after it). Expected up to ~2x on the post stage per the half-res claim above.
  3. Add a bloom-off tier to `adaptQuality`: after scale hits its 0.5 floor and still slow, `bloom.enabled = false` (OutputPass still runs). Currently `adaptQuality` stops at scale 0.5 with no further lever.
  4. Replace bloom with emissive sprites/fake glow on the lowest tier: the project already has additive `loadFx` sprites and neonBox `LineSegments` edges; additive sprites with a halo texture around lights/edges look like bloom for near-zero fill cost.
  5. Selective bloom (separate scene pass) is not recommended: it doubles scene renders; the threshold approach already used is cheaper.

### Gaps
- No measured ms/frame for UnrealBloomPass on specific phones (Adreno/Mali/Apple GPUs); forum evidence is anecdotal desktop/Safari.
- Official three.js docs on `UnrealBloomPass` mip count were not fetched; the 5-mip figure is from memory of the source, unverified here.

## 2. Shadows

### Takeaway
Rift uses one directional shadow (the cheapest kind) with 1024/2048 maps, which is sound. The weak points are PCFSoftShadowMap on LITE and a very wide shadow frustum that wastes texel density; a static shadow is also possible.

### Cited Findings
- Static scene: update shadow only when something changes; keep frustum as small and map as low as possible; point-light shadows render 6 times vs once for directional/spot — [discoverthreejs](https://discoverthreejs.com/tips-and-tricks/)
- Map sizes: 512-1024 mobile, 1024-2048 desktop; memory grows quadratically; set `light.shadow.autoUpdate=false` and `needsUpdate=true` for static; set `castShadow/receiveShadow` selectively; tighten frustum; budget about 3 dynamic lights; CSM 4 cascades desktop, 2 mobile — [Utsubo tips 53-61](https://www.utsubo.com/blog/threejs-best-practices-100-tips)

### Inferences
- Already well done: `SHADOW_MAP = LITE ? 1024 : 2048` (kit.ts:16), a single directional `sun` per game, no point-light shadows, frustum fit per arena in `buildArena` (index.ts:201).
- Weakness 1: frustum is `±(W/2+400)` by `±(H/2+400)` so the 1024 map covers the whole slab plus margins; at W around a few thousand units each texel is several world units and shadows look blocky, which tempts raising the map size. Fix: shrink the margin to what players actually can reach, or follow the local player with a small box (snap to texel grid to avoid shimmering). A moving small frustum beats a bigger map for both quality and cost.
- Weakness 2: `PCFSoftShadowMap` (kit.ts:29) is the most expensive built-in filter. On LITE switch to `PCFShadowMap` or `BasicShadowMap`; I did not find a measured delta in the sources, so treat as a likely win to verify with the debug HUD frame time.
- Weakness 3: the shadow pass redraws every `castShadow` mesh every frame. Scenery (`scenery.ts:69,183` sets `castShadow` on all of it) is static, so a split is valuable: render static scenery into a shadow once and only dynamic avatars per frame is not natively supported in one light; practical option is blob shadows (a dark radial-gradient transparent quad under each avatar, `loadFx`-style texture, 1 draw call each) and turn real shadows off on LITE. Avatars are about 2-8 players so cost is tiny.
- Decision rule: LITE with FPS below 30 after render scale drop: `renderer.shadowMap.enabled=false` (needs `material.needsUpdate` for programs to rebuild, so do it at arena build or accept a one-time hitch) and use blobs.
- Do not add CSM; a single arena-sized orthographic map is enough for a top-down chase view.

### Gaps
- No measured ms cost for PCFSoft vs PCF vs Basic on mobile GPUs was found.

## 3. Draw calls, geometry, textures, disposal, GC

### Takeaway
Biggest structural cost is per-mesh materials and un-instanced scenery and 300 individual sprite materials in the particle pool. Disposal and allocation habits are mostly good; a few `new Vector3` in hot paths remain.

### Cited Findings
- Budget about 100 draw calls per frame on mobile (<100k vertices guideline); 1,000 trees = 1,000 calls vs 1 InstancedMesh; `BatchedMesh` (since r156) merges different geometries sharing a material; share materials; `mergeGeometries` for static; read `renderer.info.render.calls` — [Utsubo tips 30-34](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Use instancing for hundreds/thousands of similar geometries; hide with `visible=false` instead of removing; `light.intensity=0` rather than removing lights (avoids shader recompile) — [discoverthreejs](https://discoverthreejs.com/tips-and-tricks/)
- 4096x4096 RGBA = 64 MiB VRAM (about 85 MiB with mipmaps); dispose geometry, material, texture, renderTarget; watch `renderer.info.memory` for steadily rising counts — [Utsubo tips 37-41](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Pool frequently spawned objects, prewarm during loading; do not create objects per frame (garbage collection); reuse vectors/matrices — [Utsubo tips 39, 66, 16](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Mobile: mediump fragment precision can be "up to twice as fast" on Adreno per Qualcomm (as quoted by the blog); KTX2 uses 4-8x less GPU memory than decoded PNG/JPEG — [Utsubo tips 22, 43](https://www.utsubo.com/blog/threejs-best-practices-100-tips)

### Inferences (tied to code)
- Done well:
  - `createParticles` (kit.ts:128): fixed pool of 300, no allocation in `update`, textures loaded once and shared, additive + `depthWrite:false`.
  - Snow/dust/fireflies in `addDrift`/`driftStep` (index.ts:80-115): one `Points` object with one buffer updated in place, count halved on LITE, `frustumCulled=false` on purpose. This is the right pattern and costs 1 draw call.
  - Stars as one `Points`; floor textures cached in `floorTextures` map; `iceEnv` PMREM built once and `pmrem.dispose()`d; `buildArena` disposes geometry and materials on swap (index.ts:174-180); `Avatar.dispose` disposes clones.
  - Debug HUD (`createDebugHud`) exists already and feeds `frameMs`.
- Issues:
  - Particle pool: each of 300 sprites owns its `SpriteMaterial` (kit.ts:132), so each live particle is a separate draw call (Sprites cannot batch). A burst of 50 plus trails could add 100+ calls on top of a ~100 budget. Fix: one `Points` or `InstancedMesh` quad with per-instance color/size attributes and a custom shader (about 40 lines), or cheaper, cap simultaneous particles on LITE (e.g. 120) and drop trail emit rate. `pool.find` (kit.ts:145) is an O(n) scan per emit; fine at 300, replace with a ring index if bursts grow.
  - `scenery.ts:157-166` creates a new `Mesh` + `MeshStandardMaterial` + `DodecahedronGeometry` per rock/tree. Replace with one shared geometry/material per kind and an `InstancedMesh` (per-instance color via `setColorAt`); this converts N calls into 1-3 and also cuts shadow-pass calls, since each caster is drawn again in the shadow map. Highest-value draw-call fix.
  - `neonBox` (kit.ts:105) makes geometry, material and a `LineSegments` child per box: 2 calls per box plus 2 in shadow pass. For obstacle-heavy arenas, share materials per color and merge static boxes with `mergeGeometries`, or one `InstancedMesh` for bodies and one merged `LineSegments` for edges.
  - Burst allocations: `new THREE.Vector3(...)` inside loops at index.ts:404 and voidfall.ts:173 (`tile.position.clone()` too). Short-lived, only on events, so GC impact is small but easy: reuse one scratch `Vector3`, since `emit` copies it (kit.ts:150) before returning.
  - `new THREE.Color().setHSL` per rock is fine at build time.
  - Canvas textures: `paintFloor` draws a 1024x768 canvas with up to ~9000 `fillRect`s once per theme (cached). Costs a one-time main-thread hitch (likely tens of ms; unmeasured) at first arena visit and uploads about 3 MB (+mips). Mitigate by painting in idle time / `OffscreenCanvas`, or pre-painting the next arena while in the lobby. Set `anisotropy` to small value on LITE; consider a power-of-two 1024x1024 for mipmaps (non-POT is fine in WebGL2).
  - `iceEnv` PMREM generation is also a one-time stall, acceptable, but do it during lobby/loading rather than on arena swap.
  - Materials: `MeshStandardMaterial` with per-pixel PBR and hemisphere+sun is ok; on LITE consider `MeshLambertMaterial` for scenery (cheaper fragment shader), keep Standard for the ice floor that needs env reflections.
  - Disposal gap: `buildArena` disposes materials but not textures referenced by them; here that is correct because textures are cached and shared. Make sure scenery-owned `CanvasTexture`s (scenery.ts:20) are cached the same way, otherwise swap leaks; verify with `renderer.info.memory.textures` over several swaps.

### Gaps
- Real draw-call counts per arena were not measured (would require running the game and reading `renderer.info.render.calls`). Do this first; see section 5.
- No measured canvas-texture generation timings were found in sources.

## 4. Adaptive quality, rAF pacing, hidden tab, thermal

### Takeaway
`adaptQuality` is a good dynamic-resolution governor with hysteresis. Add a second lever (effects tier), clamp frame delta, and pause on hidden tab. Thermal throttling has no web API; react via the same frame-time governor.

### Cited Findings
- Drei `PerformanceMonitor`: use `onIncline/onDecline` to adjust DPR, `flipflops` to prevent oscillation, and the same pattern for shadow size, post-processing, LOD distance — [Utsubo tip 68](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Cap DPR (Utsubo: 2; a React Three Fiber skill listing: 1.5 on mobile) — [Utsubo tip 80](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Use `THREE.Timer` with `timer.connect(document)` so it pauses on hidden tabs and avoids a large delta on return; `Clock` is deprecated since r183, `Timer` in core since r179 — [Utsubo tip 100](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Mobile GPUs can drop the WebGL context when backgrounded; handle `webglcontextlost` (tip 98) — [Utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Most browsers stop rAF callbacks in background tabs and hidden iframes to save battery — [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)

### Inferences
- Already good (`adaptQuality`, kit.ts:93-99): needs 60 consecutive frames over 40 ms (about 2 s) to drop scale by 15% with a 0.5 floor, and 600 consecutive frames under 20 ms (about 10 s) to raise by 10%; a single hitch changes nothing; resize recomputes pixel ratio for composer and renderer; `dt` clamped to 0.1 s in both game loops (index.ts:378, voidfall.ts:153), which prevents physics/particle explosions after a stall.
- Improvements:
  1. Add an effects ladder after the scale floor: shadows to Basic or off, then bloom off, then particles cap (see sections 1-3). Keep the same hysteresis.
  2. Anti-oscillation: if scale rose then fell within N seconds, lock the ceiling (the Drei `flipflops` idea). Cheap: remember `maxScale` and lower it on each drop that follows a recent raise.
  3. The `fast < 20 ms` bar means a 60 Hz display at 16.7 ms qualifies, but 30 fps devices (33 ms) never raise or lower (between 20 and 40): fine. On 120 Hz phones, frame time is 8.3 ms; budget there is looser, so the thresholds are conservative, which is good for thermal headroom.
  4. Hidden tab: rAF already pauses in browsers, but the first frame back has a huge `frameMs`. `adaptQuality` would count it as slow (only 1 frame, so harmless) and `dt` is clamped, so this is already handled. Also mute/pause audio ambience on `visibilitychange` and consider pausing network sim; optional.
  5. Battery/thermal: no standard web API (I found no source for one). Practical approach: an optional 30 fps cap on LITE (skip alternate rAF frames when `frameMs` is short) halves GPU heat and often looks smoother than uneven 40-60 fps. Offer as a "Battery saver" toggle or auto-enable after sustained slow period.
  6. Context loss: add `renderer.domElement.addEventListener('webglcontextlost', e => e.preventDefault())` and a reload prompt/restore; relevant because Rift resumes seats after refresh, so a forced reload on `webglcontextrestored` is acceptable.
  7. Device tiering at startup: `LITE` uses `(pointer: coarse)` (kit.ts:15) which also catches touch laptops/tablets and misses weak non-touch laptops. Refine with `navigator.hardwareConcurrency <= 4`, `navigator.deviceMemory` (Chromium only), or a 1-2 s startup benchmark and let `adaptQuality` do the rest.

### Gaps
- No authoritative source found for Chrome's background-tab timer throttling numbers or any thermal/battery API; search returned only MDN's general statement and third-party pages.
- No measured data for 30 fps capping benefits.

## 5. Tooling and WebGPU readiness

### Takeaway
Use `renderer.info` plus stats-gl and Spector.js on a real phone to find the real offenders before changing anything. Stay on WebGL for this project; WebGPU is supported broadly in 2026 but brings migration cost for little gain on a light neon game.

### Cited Findings
- stats-gl: FPS, CPU and GPU metrics, WebGL and WebGPU; `new Stats({trackGPU:true})`, `stats.init(renderer)`, `stats.update()` per frame — [Utsubo tip 91](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Spector.js: browser extension capturing WebGL frames with every draw call, texture bind and shader program; WebGL only; for WebGPU use Brendan Duncan's WebGPU Inspector — [Utsubo tip 93](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Watch `renderer.info.render.calls` and `renderer.info.memory`; steadily rising counts indicate leaks — [Utsubo tips 30, 37, 94](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- Official manual: `WebGPURenderer` uses WebGPU by default and falls back to a WebGL 2 backend on devices without WebGPU — [three.js manual](https://threejs.org/manual/en/webgpurenderer.html) (search snippet; the fetch of the page 404'd on one URL variant)
- Browser support per a January 2026 migration guide: Chrome/Edge from 113, Firefox 141 (Windows) / 145 (macOS), Safari 26; another listing disagrees (Safari 18+, Firefox flagged), so treat as unverified — [Utsubo WebGPU guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- Compute shaders are not available in WebGL fallback mode (same unverified skill listing) — [skillselion](https://skillselion.com/skills/openaec-foundation/three.js-claude-skill-package/threejs-impl-webgpu)
- Profile per-stage timings in the loop (Utsubo tip 99).

### Inferences
- Project already has `createDebugHud(arenaEl, renderer, renderScale)` fed with `frameMs` (index.ts:28, 382). Extend it to print `renderer.info.render.calls`, `triangles`, `memory.geometries`, `memory.textures` and the current scale; that gives the draw-call and leak numbers needed for sections 1-3 with no extra dependency.
- Recommended order for a solo dev, hours each: (1) extend HUD with `renderer.info` and measure per arena on a real phone with remote Chrome DevTools Performance panel (GPU-bound if main-thread is idle and frame time still high); (2) LITE tier: samples 0, PCFShadowMap, half-res bloom; (3) instance scenery; (4) particle pool to Points/instanced or cap; (5) effects ladder in `adaptQuality`; (6) context-loss handler.
- WebGPU: postpone. The post stack here (`EffectComposer`, `UnrealBloomPass`) is WebGL-addon code; the WebGPU path uses TSL/node-based post effects, so migration means rewriting the pipeline, and the WebGL2 fallback would still be needed for older phones. No source found showing a measured WebGPU win for a scene this simple.

### Gaps
- Could not confirm current WebGPU browser-support matrix from a primary source (caniuse/MDN not fetched).
- No benchmark comparing WebGL vs WebGPU renderer on mobile for light scenes.
