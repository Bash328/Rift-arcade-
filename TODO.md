# Rift Arcade to-do

## Next up

- **Hex-A-Gone mode for Voidfall** (the Fall Guys game: tiles break after you step on them, several floors, last one standing wins).
  - 3 floors about 120 units apart; falling through a gap lands you on the next floor, or you are out if there is no tile there.
  - Each tile has its own break time, shown by colour (for example green ~2s, yellow ~1.2s, red ~0.5s), random per round, faster on the lower floors.
  - A mode that rotates into Voidfall; classic Voidfall stays.
  - Start with square tiles (the grid already is); hexagons are a later visual swap.
  - Risks: seeing the lower floors (fade the floor above a player beneath it), jump and landing prediction across floors, three times the tiles on phones (draw them as one batch).
  - Estimate: 2 to 3 days, then playtest on phones.

## From the research report (`reports/Rift Arcade improvement roadmap.md`)

- Cube Tag game modes: a `mode` field that rotates each round, then Orb Rush and Infection (about a day each), then King of the Hill and Falling Hazards.
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
