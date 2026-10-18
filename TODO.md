# Rift Arcade to-do

## Where things stand (end of the 2026-10-17/18 sessions)

Everything below is pushed to `main` (last commit `ac6419f`; the changes listed below are on top and not pushed). Built so far:

- **Cube Tag arenas** with their own look and feel: Neon Grid (circuit floor, light pylons), Moon Dunes (craters, stars, Earth, dust, drone), Ice Rink (hardest: very slippery, 56 blocks, snowfield, snow, wind), The Maze (hedges and stone, fireflies, trees, crickets). Arenas are 20% bigger.
- **Modes** (rotate every round, or the host locks one): Cube Tag, Orb Rush, Infection. King of the Hill was built and removed (no real challenge). A mode intro card shows for everyone who joins; a banner shows each round.
- **Bots** fill public quick-play rooms to 4 players (labelled "BOT ..."), find their way around walls with a grid (`src/rooms/botNav.ts`), jump onto blocks for orbs, and spread out when chasing.
- **Round end:** winner card, game stops, 5 second countdown, Exit button. Back arrow and Exit return to the lobby.
- **Refresh handling:** a refresh within 30 seconds resumes the same seat (both games). Landscape lock on Android after the lobby; lobby works upright.
- **Safety and measuring:** server-side name filter; `?debug` HUD shows ping, jitter, update rate, draw calls; input backlog drop and speed cap; phone graphics tier (cheaper shadows, quarter-res glow, glow off when still slow).
- **Home screen:** two cabinets side by side on narrow screens. Lobby and lobby clicks are silent; each arena has a generated background sound once in a match.
- Research report: `reports/Rift Arcade improvement roadmap.md` (notes in `research_notes/`).

Workflow note: changes are only pushed when asked ("push").

## Next up

- Tune Hex-A-Gone after playing it (the break times, the colour mix per floor, the 75 second sudden death, the floor gap). The numbers are in `src/shared/void.ts`.

## Block Party (2026-10-18, built, not pushed, not yet seen on a real phone)

- A third Voidfall mode (the modes now take turns in the order classic, Hex-A-Gone, Block Party). One 9x9 square floor painted in four colours, each with its own symbol (circle, triangle, square, star) so it does not rely on colour alone.
- A colour is called ("STAND ON GREEN" with a countdown shown in that colour). Every tile that is not that colour drops, the empty floor shows for 2 seconds, a new shuffled floor comes back (1 second), and the next colour is called. The countdown starts at 5 seconds and shrinks by 0.4 a round down to 1.2. Last player standing wins.
- The tiles that are about to drop flash white for the last 0.8 seconds. From call 4 a growing share of the called colour flashes too (10% more each call, up to 85%), so a game always ends and late deaths come from reacting too slowly, not luck.
- Bots play it: they wait out a reaction time (sharp ones are quick, sloppy ones slow, now and then one hesitates), then run to the nearest safe tile of the called colour, and run again if their tile starts flashing. In a 60 game simulation with four bots a game lasted 46 to 111 seconds (median 64) and the first bot fell around call 9.
- Plain solid colours and no glow, like Hex-A-Gone. Sound: a tick each second, a crack when the flash starts, a thump at the drop. The tunables are at the top of the Block Party part of `src/shared/void.ts`: `partyCallTime`, `PARTY_WARN`, `PARTY_DROP_TIME`, `partyExtraDrop`.
- Next (agreed): Loot Loop is folded into Orb Rush. Orbs go into a carried stack, you bank them by stepping into the glowing ring in the middle of the arena, a rival who touches you steals half (2 seconds of protection after), carry cap 15, bots follow the same rules.
- Also fixed: the red-tile stripes in Hex-A-Gone are now white (they were dark).
- 75 tests (new: party rules, the call and drop and refill, the flash, a survivor winning, a bot finding the colour).

## Hex-A-Gone looks like Fall Guys' (2026-10-18, not pushed)

- Real hexagon tiles (9 across, 10 down, every other row shifted half a tile: 90 per floor, 270 in all). Classic Voidfall keeps its 81 squares. The shared code works out which layout it has from the tile count (`boardOf` in `src/shared/void.ts`): finding the tile under a position, a tile's neighbours (6 on a hexagon floor), and which tiles a bot can jump.
- Solid flat colours: green, yellow and red hexagons, red ones striped, a cracking tile flashes white. No frames and no glow in this mode (the glow is switched off while it is on; classic keeps its neon).
- Floors are 520 units apart, more than the camera is high, and the floors above you disappear once you have dropped, so only the floor you are on (and the ones below) are in view. No more see-through dots. About 9,600 triangles (it was 42,000) and 20 to 36 draw calls.
- Bots and sudden death work on hexagons too. 70 tests (new: hexagon lookup, neighbours, floors further apart than the camera).
- `scripts/make-splash.cjs` regenerates the iPhone launch images.

## Hex-A-Gone bots (2026-10-18, not pushed)

- The bots now play Hex-A-Gone, so the two-human rule is gone: a lone player in quick play gets it too (it takes turns with classic).
- A bot waits on its tile until about 0.5 to 0.75 seconds before it breaks, then steps to the best neighbour. A tile is worth more the longer it lasts (colour and floor: green beats red), the bigger the island of solid tiles it sits in, and the fewer other players are near it.
- Dropping down on purpose: a bot steps into a gap that has a solid tile on the floor below, when that beats what is left on its floor (more so once sudden death has begun). It never drops where nothing is below.
- Same three skill levels as before (sharp bots read the tiles faster and hesitate less). In a 40 round simulation with four bots, rounds lasted 15 to 30 seconds (median 22), bots moved between floors about twice each per round, and sudden death never had to start.
- 4 new tests (green over red, a drop onto the floor below, no drop into nothing, a 12 round long run); 68 tests in all. The Hex-A-Gone bot tests pin the dice for the drop, because a sharp bot can still hesitate once in about 200 decisions.

## Hex-A-Gone (2026-10-18, not pushed, not yet seen on a real phone)

- A Voidfall mode that takes turns with classic each round (a private room's host can lock one in the lobby). Public rooms start it from the second round (the bots play it, see the bots section above).
- Three full floors of hexagons (270 tiles). Fall through a gap onto the floor below, or out if there is no tile. Each tile has a kind (green about 2s, yellow about 1.2s, red about 0.5s at the top; the middle floor is 15% faster and the bottom 30%), dealt at random each round and sent to the phones; the nine tiles under the start ring are never red. Cracking tiles flash white and shake, red tiles also have stripes.
- The camera follows your floor and the floors above you are hidden (see the section above).
- Sudden death after 75 seconds: one random solid tile cracks every second, down to four a second, on a floor somebody is on.
- Voidfall now has an intro card, a round banner and the Cube Tag winner card with the next mode and its rules, Ready (up to 15 seconds), Share and Exit. The OUT lamp sits beside the names.
- Drawn as four instanced meshes (22 to 52 draw calls in total, about 42,000 triangles, mostly the thick glowing frames). Shared physics in `src/shared/void.ts`: floors, landing that cannot skip a floor, steering that stays full on a lower floor.
- 11 new tests (physics, tile kinds, sudden death, rotation, bots sitting out, Ready, a 20-round long run); 64 tests in all.

## Built, not yet pushed or checked on a phone (2026-10-18)

- Jitter-adaptive interpolation delay (`adaptInterpolationDelay` in kit.ts): the delay for other players follows how much the ping wanders, between 80 ms (100 on phones) and 250 ms. It needs the SDK's internal `Predict.track`; a test guards that.
- Phone graphics: neon boxes, ice blocks and the rim scenery are instanced or batched, particles are two point systems instead of 300 sprites, and the quality ladder now also drops anti-aliasing. Draw calls on the desktop (all passes): classic 345 to 193, moon 313 to 232, ice 453 to 323 before the ice change (39 on a phone view after it), maze 286 to 106, neon 280 to 194.
- Share button on the Cube Tag round-over card (Voidfall has no card yet).
- Name blocklist extended with slurs and sexual terms.
- The IT lamp shows only in Cube Tag and sits in the button row on phones, clear of the timer.
- Bots: a lone player gets four bots (rooms fill to 5), and a chasing bot gives up on a runner after 8 seconds and goes for someone else.
- Faster first paint: the Google Fonts stylesheet no longer blocks the page (the blank screen when opening from the home screen). iPhone launch images (public/splash, 20 tiny palette PNGs, 152 KB in all, every iPhone size from the 8 to the 16 Pro Max in both orientations; no iPads) replace its white splash. iOS reads them when the app is added to the home screen, so re-add the app to see them. To change the look, regenerate the images (they were drawn in headless Chrome and shrunk with sharp) and keep the `<link>` tags in the three pages in step.
- Cloudflare Web Analytics beacon on the home page and both games (cookieless; read the numbers in the Cloudflare dashboard under Web Analytics).
- Fixed: `inMatch` was used before it was declared (broke the dev server, which does not bundle).

## Bots, second pass (2026-10-18, not pushed)

- Runners no longer stand still or run into corners: they plan a route to open ground they reach before the chaser (`fleeGoal` in botNav.ts), re-planned every 1 to 2 seconds, so they keep moving.
- Three skill levels per bot (sloppy 10%, steady 45%, sharp 45%): reaction time, aiming ahead of a runner, pauses and rare wrong turns. Same speed as a player.
- A chasing bot prefers people over other bots (so a sharp bot does not farm the weak ones), will not rematch whoever just tagged it, and still gives up a chase after 8 seconds.
- The IT lamp sits beside the names.
- Runner bots roam the whole arena instead of circling one patch: they commit to a far, new destination (4 to 7 seconds, not a re-pick every second), avoid their last few goals, and corners are penalised harder. In a 30 second test they visited about twice as many map regions and their paths were about twice as straight.
- Voidfall bots (not pushed): a lone player gets four, each human who joins sends one home, private rooms get none. A bot waits on its tile until about 0.5 to 0.75 seconds before it drops, then steps to a good neighbouring tile (big intact areas first, away from others) and jumps a one-tile gap in a straight line. Three skill levels as in Cube Tag. Rounds with bots last about 10 to 20 seconds.
- Juking: sharp bots (10% a re-aim) and steady ones (3%) sidestep, toward the roomier side, when a chaser is within 150 units.
- Ready status (Cube Tag): the winner card now waits up to 15 seconds and shows the next mode, its rules and "x of y ready". Each player presses Ready (or Enter); the round starts as soon as every human has, bots always count as ready, and a tap in the first 1.5 seconds is ignored. Voidfall has no winner card yet, so no Ready there.

## Found and fixed in the long test pass (2026-10-18)

- Voidfall: someone joining during the winner banner teleported the winner to the ring (already there before the bots; the bots made it more likely). Spreading now only happens before a round, and bots only join then.
- Ready: a player whose connection dropped (seat held for 30 seconds) no longer holds the next round up.
- Voidfall on a phone: the wider OUT lamp overlapped the start of "You fell!".
- New long simulations in the test suite: every arena and mode with bots for 200 simulated seconds (finite positions, nobody outside the arena, rounds end), 40 Voidfall rounds with bots, joins and leaves mid-round. Also run: the load test on both games (no server errors) and a browser smoke test of the production build on phone and desktop sizes (no errors).
- Known and left alone: a closed tab keeps its seat for 30 seconds, so it shows in the name list as a ghost for that long (this is what lets a refresh resume).

## Ideas to consider

- Temporary power-ups (for example a speed boost or a shield for a few seconds).

## From the research report (`reports/Rift Arcade improvement roadmap.md`)

- Falling Hazards mode: parked for now (King of the Hill was tried and removed: no real challenge).
- Decided against: preset emotes, anonymous profiles and leaderboards.
- **Load test of the live server (2026-10-18): done as far as this PC allows.** The server runs one Node process on one core, and `/metrics` is on (token set in the server's shell; `pm2 startOrReload ecosystem.config.cjs --update-env` with the capital O).
  - Server CPU, read from the server itself: 48 Cube Tag bots used 23% of one core, 72 used 31%, 40 Voidfall bots used 24%. Event-loop delay stayed at its idle floor (about 20 ms mean, 22 ms p99), so there was no lag at any of these loads.
  - From that: about 0.45% of a core per Cube Tag player and 0.6% per Voidfall player, so roughly 150 Cube Tag players or 110 Voidfall players at 70% of the core, and one core is full at about 220 (Cube Tag) or 165 (Voidfall). Outbound traffic is about 15 kbit/s per player (150 players is roughly 2.2 Mbit/s). These are extrapolations from 40 to 72 bots, not measured.
  - Not measured: anything past 72 bots. This PC uploads only about 0.83 Mbit/s and each bot uploads 30 inputs a second, so at 96 bots it dropped 32 bots and was slow to join; the server's CPU and event loop were fine, so that was the link, not the server.
  - To check the extrapolation, run the script from a machine with a fast upload (a cloud VM) up to about 150 Cube Tag bots and watch `--token` CPU. More than one core needs Redis and a proxy (see the note in `ecosystem.config.cjs`).

## Cloudflare (2026-10-18)

- The domain is on Cloudflare (nameservers dawn and andronicus; requests are answered from the Johannesburg edge). Checked: WebSockets work through it (Cube Tag and Voidfall, 24 bots each, about 25 ms round trip), scripts and sounds are cached at the edge, the home page's first byte takes 0.1 s.
- **To do in the Cloudflare dashboard:** the 3D models (`/models/*.glb`, 1.7 MB) are not cached at the edge, because Cloudflare does not cache `.glb` by default (`cf-cache-status: DYNAMIC`). Caching, Cache Rules, create a rule: when URI Path starts with `/models/`, then Eligible for cache, Edge TTL "Use cache-control header if present". Check with `curl -sI https://rift-arcade.online/models/animal-cat.glb` twice: the second should say HIT.
- Visitors now reach the server through Cloudflare, so the server sees Cloudflare's addresses, not theirs (nothing in the code uses addresses).

## Check on real devices

- Everything in the section above: the new particles and instanced scenery on a phone, the IT lamp row, the share button, how the adaptive delay feels on mobile data, and the bots.
