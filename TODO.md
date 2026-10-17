# Rift Arcade to-do

## Where things stand (end of the 2026-10-17/18 sessions)

Everything below is pushed to `main` (last commit `ac6419f`, 28 tests passing). Built so far:

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

## From the research report (`reports/Rift Arcade improvement roadmap.md`)

- Cube Tag game modes: a `mode` field that rotates each round, Orb Rush and Infection are done; Falling Hazards is next (King of the Hill was tried and removed: no real challenge).
- Jitter-adaptive interpolation delay (check first that the prediction library lets the delay change while the game runs).
- Phone graphics: instance the scenery and `neonBox`, rebuild the 300-material particle pool, and drop anti-aliasing if phones are still slow.
- Preset emotes and a share button on the round-over card.
- Anonymous profile with wins, streaks and a daily/weekly leaderboard (needs a persistent disk on the host), then cosmetic unlocks.
- Privacy-friendly analytics to measure return rate.
- Load test the live server from another machine (`npm run loadtest:arcade`) to find the real capacity.
- Extend the name blocklist (slurs were left out on purpose).

## Check on real devices

- The Maze look, the new Ice Rink difficulty, and the Earth's position on Moon Dunes.
- Portrait lobby then landscape lock on Android; the rotate message after the game starts on iPhone.
- Home screen cabinets in portrait.
