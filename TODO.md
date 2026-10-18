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

- **Hex-A-Gone mode for Voidfall** (the Fall Guys game: tiles break after you step on them, several floors, last one standing wins).
  - 3 floors about 120 units apart; falling through a gap lands you on the next floor, or you are out if there is no tile there.
  - Each tile has its own break time, shown by colour (for example green ~2s, yellow ~1.2s, red ~0.5s), random per round, faster on the lower floors.
  - A mode that rotates into Voidfall; classic Voidfall stays.
  - Start with square tiles (the grid already is); hexagons are a later visual swap.
  - Risks: seeing the lower floors (fade the floor above a player beneath it), jump and landing prediction across floors, three times the tiles on phones (draw them as one batch).
  - Estimate: 2 to 3 days, then playtest on phones.

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

## From the research report (`reports/Rift Arcade improvement roadmap.md`)

- Falling Hazards mode: parked for now (King of the Hill was tried and removed: no real challenge).
- Decided against: preset emotes, anonymous profiles and leaderboards.
- Load test the live server (`npm run loadtest:arcade`) to find the real capacity; a PC or phone-hotspot run is fine, a result limited by the home connection says so.

## Check on real devices

- Everything in the section above: the new particles and instanced scenery on a phone, the IT lamp row, the share button, how the adaptive delay feels on mobile data, and the bots.
