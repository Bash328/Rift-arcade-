# Netcode smoothness for a Colyseus browser arcade (30 Hz, prediction + reconciliation, 8-12 players)

Source note: several primary pages were blocked (Colyseus best-practices 404, Valve wiki 403 on direct fetch, Overwatch GDC talk paywalled). Items not backed by a fetched page are marked as Inference or Gap. Code facts come from the repo files read directly (MyRoom.ts, inputPacing.ts, src/client/index.ts, shared/movement.ts, loadtest/smoothness.ts); kit.js (createDebugHud, runLobby) was NOT read.

## Q1. Colyseus best practices: patch rate vs sim rate, bandwidth, message limits, reconnection, transport

### Takeaway
The project already matches the Colyseus-recommended shape (fixed timestep + defineInput + patch rate equal to tick + allowReconnection in onDrop). The remaining wins are: tighter message/burst limits, bandwidth measurement (none exists), a reconnection UX check, and treating WebTransport as optional/experimental. WebSocket (TCP) head-of-line blocking is the real mobile-loss cost, and it is only fixable by WebTransport datagrams.

### Cited Findings
- Colyseus `patchRate` default is 50 ms (20 fps); setting it to null disables auto patches so you can call `broadcastPatch()` yourself. Default game loop interval is 16.6 ms. — [Colyseus Room docs](https://docs.colyseus.io/room)
- `maxMessagesPerSecond` defaults to Infinity; a client exceeding it is disconnected. — [Colyseus Room docs](https://docs.colyseus.io/room)
- `setFixedTimestep(step, tickRate)` is the fixed-step loop for client-predicted games; it advances with constant dt and advertises the rate to predicting clients, which a variable step cannot do deterministically. — [Colyseus Room docs](https://docs.colyseus.io/room)
- Reconnection: `onDrop(client, code)` runs on any non-consented disconnect (e.g. 1006); call `allowReconnection(client, seconds)` there, no await needed (framework routes to onReconnect/onLeave). Not fired for CONSENTED (4000). Docs suggest ~30 s window for fast-paced games, ~5 min for turn-based. `"manual"` holds the seat until `.reject()`. — [Colyseus reconnection docs](https://docs.colyseus.io/room/reconnection)
- 0.17 SDK auto-reconnects with exponential backoff on the same `room` instance (listeners survive). Manual path: persist `room.reconnectionToken` (e.g. sessionStorage), call `client.reconnect(token)`, which returns a NEW Room instance so listeners must be reattached. Token is re-issued on each reconnect. — [Colyseus reconnection docs](https://docs.colyseus.io/room/reconnection)
- After reconnect the server sends a full state snapshot merged into the existing tree; entities added/removed while offline fire onAdd/onRemove. — [Colyseus reconnection docs](https://docs.colyseus.io/room/reconnection)
- 0.17 uses close codes 4000-4010 internally (FAILED_TO_RECONNECT 4003, MAY_TRY_RECONNECT 4010); custom kick/ban codes should be outside that range. — [Colyseus 0.17 migration](https://docs.colyseus.io/migrating/0.17)
- Colyseus WebTransport transport is `@colyseus/h3-transport` (wraps @fails-components/webtransport, HTTP/3 over QUIC/UDP) and the docs label it "Experimental - hasn't been battle tested." — [Colyseus WebTransport docs](https://docs.colyseus.io/server/transport/webtransport) (via search summary)
- Safari 26.4 shipped WebTransport (Baseline "newly available", March 2026) per secondary sources; WebSocket's TCP means one lost packet stalls everything behind it, whereas QUIC streams are independent and datagrams are unreliable/unordered; advice is WebTransport with WebSocket fallback. Implementations are uneven. — [Utsubo 2026 summary](https://www.utsubo.com/blog/frontier-web-apis-2026-production-ready), [VideoSDK Safari guide](https://www.videosdk.live/developer-hub/webtransport/safari-webtransport) (secondary sources)
- Snapshot bandwidth reference (Gaffer, physics cubes, not this game): 60 snapshots/s ~11.6 Mbit/s vs 10/s ~2 Mbit/s; higher rates need bandwidth optimization. — [Gaffer: Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)

### Code mapping (what it does / what is missing)
- DOES: `setPatchRate(1000/TICK_RATE)` (33.3 ms) + `setFixedTimestep(..., TICK_RATE)` so each patch carries exactly one step (comment says so). Colyseus default would be 50 ms, so this is a deliberate 50% bandwidth increase for smoothness.
- DOES: `maxMessagesPerSecond = 120` against ~30 inputs/s (4x headroom); `bufferMaxSize: 64`; `sanitize` clamps moveX/moveY/jump.
- DOES: `onDrop -> allowReconnection(client, 30)` with `.catch(()=>{})`; client has `reconnect: (token) => client.reconnect(token)` in runLobby (not inspected).
- MISSING: `maxClients = 8` while target is 8-12; no bandwidth numbers anywhere; no region/hosting config in repo files read; no WebTransport path; `onLeave` removes the player but `onDrop` leaves a "ghost" cube in place for up to 30 s (it keeps colliding/tagging as `it` possibly - see Inferences).

### Inferences
- Bandwidth estimate for 8-12 players: Colyseus sends only changed fields. Six moving numeric fields per player (x,y,z,vx,vy,vz) at 30 Hz, plus ~1-2 bytes of per-field/ID overhead, is on the order of 30-50 B per moving player per patch, so roughly 8-12 players x 40 B x 30 Hz = 10-15 KB/s (80-115 kbit/s) per client downstream. This is my arithmetic, not a measured number; the loadtest should measure real bytes (see Q4). Small enough for 3G-class links; the larger risk is latency/loss, not throughput.
- Staying at 30 Hz patches is justified: Gaffer's rule gives ~150 ms delay at 30 pps, ~85 ms at 60 pps; going to 20 Hz (Colyseus default) would push the recommended buffer to ~150-200 ms. Lowering patchRate to 50 ms is a legitimate "weak connection mode" lever, not a default.
- Cheap hardening: keep `maxMessagesPerSecond` but ensure the client never sends catch-up bursts after a stall (see Q2); at 120/s a 5-second resume that tries to emit 150 steps would trip a disconnect. Verify with the SDK's `predict.tick`.
- A disconnected-but-held player (30 s) stays in `players`, can be tagged / remain `it`, and keeps the round stuck. Consider marking them frozen/invulnerable or passing `it` on after ~3-5 s (game logic, not netcode, but it affects perceived smoothness for others).
- WebTransport: given "experimental" server support and uneven browsers, the practical solo-dev move is to NOT adopt it now; first measure loss-induced stalls on WebSocket. Revisit when h3-transport leaves experimental.

### Gaps
- Colyseus "best-practices" page returned 404; no official guidance on schema byte sizes, delta-encoding internals, or filters/StateView costs was retrieved.
- The Colyseus Netcode pages (Server Input & Timestep, Client Prediction, Lag Compensation) were not retrievable, so `defineInput` buffer semantics (how stale inputs are dropped, bufferMaxSize overflow behavior) are unverified.
- No sourced numbers for region/hosting latency (Colyseus Cloud regions, Fly.io, etc.); not researched.

## Q2. Prediction/reconciliation pitfalls: buffering, jitter, adaptive interpolation, extrapolation, background tabs, network switches

### Takeaway
The code uses the right architecture (shared deterministic `stepEntity`, reconciler replay, delayed lerp for remotes, bounded input drain). Gaps are static delays (100/130 ms fixed, no jitter adaptation), no explicit stale-input/backlog policy beyond a slow 2-per-tick drain, and unknown behaviour on tab resume / network switch.

### Cited Findings
- Reconciliation: tag each input with a sequence number; server reports last processed; client discards acked inputs, resets to server state, replays unacked ones. Don't predict irreversible outcomes (e.g. death). — [Gambetta: Prediction & Reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)
- Entity interpolation: render other entities slightly behind real time (example 100 ms) using real server data; each player sees self in present and others in past; dead reckoning fails for sudden direction changes; 100 ms is usually unnoticeable in fast games but hurts precise hits. — [Gambetta: Entity Interpolation](https://www.gabrielgambetta.com/entity-interpolation.html)
- Interpolation delay rule of thumb: 3x snapshot interval plus jitter allowance (jitter typically 1-2 frames at 60 fps); 10 pps -> 300-350 ms, 30 pps -> ~150 ms, 60 pps -> ~85 ms. Buffer should survive losing two packets in a row. — [Gaffer: Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- Extrapolation: 200 ms extrapolation cut effective delay 350 -> 150 ms but is poor for non-linear motion; suited to mostly linear motion over ~50-250 ms. — [Gaffer: Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- Valve Source default `cl_interp` is 0.1 s (100 ms) constant view lag; interpolation period = max(cl_interp, cl_interp_ratio/cl_updaterate); ratio 2 is advised for packet-loss tolerance; server lag compensation accounts for each client's interp. — [Valve developer wiki via search](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
- Overwatch (secondary summaries only): client runs ahead of server by ~half RTT plus a command frame; server can signal the client to simulate slightly faster when its input buffer starves; rollback/replay on mispredict. Specific 16 ms / 7 ms command frame figures unconfirmed. — [Edgegap summary](https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback), [GDC Vault abstract](https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)
- Background tabs: rAF stops in hidden tabs; timers are throttled (Chrome: independent timers max once/second; budget-based throttling is exempt for pages with WebSocket/WebRTC but the once-per-second rule still applies); use `visibilitychange` / `document.hidden`. — [MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API), [Chrome background tabs](https://developer.chrome.com/blog/background_tabs?hl=en)

### Code mapping
- DOES: `stepEntity` is pure/shared; reconciler fields include velocities and z; `predict.tick(now)` returns the number of fixed steps due so input rate tracks sim rate not display refresh; `dt = min(frameMs/1000, 0.1)` for visuals.
- DOES: remotes via `predict.attachAll("players", {mode:"lerp", delay: LITE?130:100, smoothMs:65})`. 100 ms = 3 snapshots at 33 ms (matches Gaffer's 3x rule, with ~0 left for jitter beyond the 65 ms smoothing spring). LITE (phones) gets 130 ms.
- DOES: server `inputBudget(pending)`: apply 1 input per tick, 2 if >2 pending; a burst never lunges the player. This is similar in spirit to Overwatch's input-starvation/backlog handling but one-directional (only drains backlog; never asks the client to slow down or speed up).
- MISSING: delay is static; no measure of real jitter, so a bad connection shows stalls while a good one pays extra latency. No extrapolation fallback when the lerp buffer runs dry (what Predict does when no future snapshot exists is unverified).
- MISSING: no `visibilitychange` handling visible in index.ts. On resume, `frame()` calls `predict.tick(now)`; behaviour of the SDK when `now` jumps by seconds (does it return many steps, or clamp?) is unknown. If it returns many steps, the loop `for (i<steps) input.send()` would emit a burst of inputs, risking `maxMessagesPerSecond=120` disconnect and a ~2 s server backlog.
- MISSING: no handling for the Wi-Fi<->cellular switch beyond the SDK's auto reconnect; room.onLeave only sets "Disconnected" and disposes avatars (no onDrop/onReconnect UI such as "Reconnecting...").

### Inferences
- Backlog drain math: with a budget of 2 per tick against 1 arriving per tick the queue shrinks 1 per tick, so a 30-input backlog (1 s of stale inputs) takes ~30 ticks (1 s) to clear, during which the player's authoritative position lags their input by up to 1 s while their client prediction is already ahead; reconciliation then corrects with a visible snap. A drop policy would be better for a tag game: if pending > ~6-8 (about 200-250 ms), discard the oldest down to ~3 (accept a position jump for the sake of staying current), or allow 3 per tick for pending > 8.
- Jitter-adaptive delay is the highest-value client change: track an EWMA of inter-snapshot arrival gaps (and its mean deviation, like TCP RTO); set delay = clamp(2 x interval + k x deviation, 66, 200 ms) and change it slowly (e.g. 5 ms/s) to avoid time-warping artifacts. Source basis: Gaffer's "delay = 3x interval + jitter allowance" and Valve's max(interp, ratio/updaterate) shape; the specific clamp numbers are my suggestion.
- On `visibilitychange` -> hidden: stop sending inputs (send neutral input once, or just stop; server then moves the player not at all since empty ticks advance no one - matching the MyRoom comment). On visible: reset the predictor clock (`last = performance.now()`), skip catch-up, and let the next snapshot snap the reconciler (the full-state snapshot semantic from reconnection also helps).
- iOS/Android mobile browsers freeze or kill sockets in background more aggressively than desktop; the sources found cover desktop only, so treat onDrop + allowReconnection (already present) as the main safety net and expect a reconnect on every long app-switch.
- "Extrapolation vs interpolation": for a tag game with abrupt direction changes and a 30 Hz stream, keep interpolation; allow at most ~50-100 ms of linear extrapolation (using vx,vy already in state) only when the buffer under-runs, then freeze. Ice arena (slide>0) is smoother to extrapolate than other arenas.

### Gaps
- Behaviour of `@colyseus/sdk/predict` (reconciler tick catch-up limit, what lerp does on buffer underrun, whether `delay` is adjustable at runtime) not verified; docs pages not retrievable. Read node_modules/@colyseus/sdk/predict source before implementing.
- No mobile-specific (iOS Safari/Android Chrome) background socket-kill documentation found.
- No primary source for Overwatch numbers.

## Q3. Measuring: ping/jitter/loss HUD, automated load tests, feel thresholds

### Takeaway
A debug HUD exists (`createDebugHud`, frame-time oriented from its call signature) and a smoothness load test exists, but the load test measures server-state update regularity only; it does not inject latency/loss, measure the client's rendered output, or scale to 8-12 bots. Feel thresholds below are mostly from the sources on interpolation delay; hard "good/bad ms" thresholds for tag games were not found in citable form.

### Cited Findings
- Interpolation delay of ~100 ms is the classic default and generally unnoticeable for movement in fast games; hits/precise actions are what suffer. — [Gambetta](https://www.gabrielgambetta.com/entity-interpolation.html), [Valve wiki](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
- Gaffer tested at 2-5% packet loss with the "survive two consecutive lost packets" rule; jitter 1-2 frames at 60 fps. — [Gaffer](https://gafferongames.com/post/snapshot_interpolation/)
- Colyseus `maxMessagesPerSecond` and close codes are server-side hooks usable for rate stats. — [Colyseus Room docs](https://docs.colyseus.io/room)

### Code mapping
- loadtest/smoothness.ts: mover bot sends 30 inputs/s via `host.input({mode:"reliable"})`; `--jitter 1` goes quiet 120-250 ms every 1-2 s then sends the backlog in a burst; a watcher records `x` on each `onStateChange` and reports updates/s, gap median/p95/max, per-update distance mean/sd, stalls (<25% of mean) and lunges (>175% of mean). Good as a regression check for `inputBudget`.
- Missing: (a) real WAN conditions: no latency, loss, or bandwidth shaping (needs OS-level netem/clumsy/Network Link Conditioner or a TCP proxy with delay); (b) packet loss on a TCP WebSocket shows up as bursts, which the jitter mode approximates, but not slow-start/RTO stalls of 200 ms-1 s; (c) only 2 clients, one mover; no room of 8-12 with all moving, so no CPU per tick, patch size, or bytes/s measurements; (d) watcher reads schema state, not `predict.value()` output, so it cannot see interpolation hiccups or reconciliation snap size on the owning client; (e) no pass/fail exit code; (f) server CPU/event-loop lag not measured.

### Inferences
- HUD contents worth adding (all computable client-side, small): RTT (a ping round trip over the existing connection, sampled every 1-2 s, display median + max of last 10), jitter (mean abs deviation of snapshot inter-arrival vs 33.3 ms), snapshot rate (should read ~30/s), reconciliation error (distance between predicted and server pos at each ack; count of corrections above e.g. 4 units/s), input backlog (estimated from server ack lag), bytes/s down/up via wrapping the WebSocket. Check `room.ping` availability in the SDK before writing your own (not verified).
- Suggested working thresholds (heuristic, not from a source): RTT <80 ms feels instant; 80-150 ms fine for tag with prediction; 150-250 ms noticeable on tags/near-misses; >250 ms or jitter >40 ms show a "weak connection" badge and switch to a bigger interpolation delay / lower send detail. Loss >2% or max gap >200 ms flags problem. Treat as starting points to tune on real phones.
- Load test upgrades in priority order: assert thresholds (exit nonzero if lunges+stalls >X% or p95 gap >Y ms); add a TCP proxy (e.g. a 30-line Node proxy) injecting 80 ms +- 40 ms delay with periodic 300-800 ms freezes; run 12 bots with random-walk inputs for 60 s and print server `tick` time and bytes out per client (sum of ws frame sizes); add an `--afk` mode (stop sending for 5-10 s, then resume) to exercise backlog, drop policy, and rate limit; add a `--reconnect` mode that kills the socket and calls reconnect with the token.

### Gaps
- No citable "feels smooth" ms thresholds for fast tag/party games; the numbers above are heuristics.
- Did not inspect `createDebugHud` in kit.js, so whether RTT already appears is unknown.
- No source retrieved for Colyseus built-in monitor/Playground load tooling (`@colyseus/loadtest`) specifics.

## Q4. Cheating, rate limits, and bandwidth at 8-12 players per room

### Takeaway
Server-authoritative movement with sanitized, bounded input already blocks the main cheats (teleport, speed hack). Remaining exposure is input-rate abuse (speed via more inputs per second) and resource abuse, both mostly covered by the existing 1-per-tick budget and the 120 msg/s cap.

### Cited Findings
- Server stays authoritative; a cheating client can only alter its own display, not shared state. — [Gambetta](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)
- `maxMessagesPerSecond` disconnects clients over the cap (default unlimited). — [Colyseus Room docs](https://docs.colyseus.io/room)
- Gaffer's snapshot numbers show bandwidth scales roughly linearly with snapshot rate (10 pps ~2 Mbit/s vs 60 pps ~11.6 Mbit/s in his cube demo). — [Gaffer](https://gafferongames.com/post/snapshot_interpolation/)

### Code mapping
- DOES: server runs `stepEntity` on its own state; clients only send moveX/moveY/jump clamped by `sanitize` ([-1,1], [0,1]); `inputBudget` limits to 1 (max 2 when backlogged) steps per tick per player, so flooding inputs cannot speed a player up beyond 2x for the duration of a backlog; buffer capped at 64; names trimmed to 12 chars; tagging done on server.
- RISK: the 2x drain rate means a player who deliberately maintains a >2 backlog (send 60 inputs/s, under the 120 cap) moves at up to 2x speed continuously (each tick consumes 2 of the queued inputs). Inference from the code: arrivals 60/s vs drain 2/tick = 60/s, so queue never grows past the cap and speed is doubled. Fix: cap long-run average applied steps to ticks elapsed (token bucket: allow a debt of ~3 steps, refill 1 per tick), or drop inputs beyond a backlog of ~6-8.
- RISK: fractional `moveX` sanitize range [-1,1] allows 1.0 magnitude on each axis; stepEntity normalizes only when both non-zero and uses `dirX*SPEED`; (e.g. moveX=1, moveY=0.99999 normalizes both, fine). Non-integer analog values like 0.5 slow the player, not speed up. No exploit found in what was read.
- MISSING: no per-IP or per-account room-join throttle (room creation spam via `freeRoomCode`/`assertRoomCapacity` exists but not inspected); `onJoin` accepts any `name` (sliced to 12) with no profanity/HTML escaping noted (client renders via drawBoard; XSS depends on whether it uses textContent - unchecked); `maxClients = 8` vs 8-12 target (tag collision loop is O(n); fine per the existing ponytail comment).

### Inferences
- Bandwidth at 12 players: per-client downstream grows linearly with player count (about 12/8 = 1.5x the 8-player figure); total server egress per room grows quadratically (n clients x n players): 12x12 = 144 player-updates per tick vs 64 at 8, about 2.25x. At 30 Hz with ~40 B per update that is roughly 170 KB/s (1.4 Mbit/s) per 12-player room (my estimate). A small VPS handles dozens of such rooms bandwidth-wise; CPU for patch encoding per tick will matter earlier, so measure with the 12-bot load test.
- Cheap bandwidth wins if ever needed: round positions to integers/halve precision with a smaller schema number type (e.g. int16 for x,y,z; fewer bytes than float32/float64), skip vx/vy in the schema for non-self players if the lerp does not need them (reconciler needs them only for self; but the ice arena slide state would then be reconstructed from the server only for self), and drop patchRate to 50 ms on mobile "low data" mode. Verify which field types MyRoomState.ts declares (not read).
- Region/hosting: nothing sourced; the practical lever is to host one region near the user base and show RTT on the HUD so players can pick a better room/region later. A 100 ms RTT floor will dominate any tuning of 33 ms ticks.

### Gaps
- MyRoomState.ts schema field types not read, so bytes-per-update estimate is unverified.
- No sourced anti-cheat rate-limit benchmarks for Colyseus beyond `maxMessagesPerSecond`.
- Region/provider latency figures not researched.
