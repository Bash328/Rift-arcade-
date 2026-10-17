# Game modes and games for a short-session, join-by-code, phone-plus-desktop party arcade

Method note: 8 web searches plus one fetch, then a read of MyRoom.ts, VoidRoom.ts, arenas.ts, movement.ts and void.ts. Search results were mostly blogs, journalism and one conference talk summary. No formal postmortems from Mediatonic, Kitka, Tagpro or Smash Karts were found. The proposals are my own design inferences from the code and the evidence, not sourced facts.

## What makes io and party games fun in 2-5 minute sessions (round length, spectate, comebacks, simple controls, readable rules)

### Takeaway
The evidence converges on four things: understand the game in about 60 seconds, rounds of 2-6 minutes, lobbies small enough to stay readable, and one-more-round pacing. Evidence on comebacks and spectating is thin and indirect, so treat those design choices as inference.

### Cited Findings
- Io games need players to grasp the mechanics within about 60 seconds, load in about 5 seconds, allow guest play with no sign-in, and keep the initial download small (reportedly under 5 MB). — [Flurry, Lessons from 7 years of .io games](https://gitnation.com/contents/lessons-from-7-years-of-io-games-what-works-what-doesnt-work-where-to-go-from-here)
- The same talk says to use short party codes that are easy to read aloud and type, with confusable characters like 0 and 1 removed, and to make server links easy to share in Discord and streams. Network effects, especially school sharing, drove most acquisition. — [same](https://gitnation.com/contents/lessons-from-7-years-of-io-games-what-works-what-doesnt-work-where-to-go-from-here)
- The same talk says simple mechanics with clear visible resources work, fun beats graphics, and complex systems (crafting trees) did not work. Ephemeral leaderboards that reset on leave kept sessions long and need no database. Traffic can drop up to 50% on weekends and school breaks. — [same](https://gitnation.com/contents/lessons-from-7-years-of-io-games-what-works-what-doesnt-work-where-to-go-from-here)
- Fall Guys' original 100-player round was cut because "over a certain size, the games stopped being readable or fun" (Mediatonic creative director, quoted). — [Kotaku via search result](https://kotaku.com/fall-guys-was-almost-called-stumble-chums-1844794964) (I saw this only as a search snippet, not the full article)
- Fall Guys' bite-size mini-game structure is credited with making it hard to stop after one round. — [LA Times review](https://www.pressreader.com/usa/los-angeles-times/20201006/282153588739560)
- Stumble Guys games are reported to finish in under 10 minutes, versus a longer climb to Fall Guys finals (informal comparison). — [Uptodown](https://blog.en.uptodown.com/stumble-guys-copy-of-fall-differences/)
- Stumble Guys is described as repetitive over time, so short rounds alone do not sustain interest. — [Southerner Online (student paper)](https://southerneronline.com/3811/arts-entertainment/the-rise-and-fall-of-stumble-guys/)
- Hole.io rounds are about 2 minutes, and that brevity is said to drive replay. Reviewers note the lack of tactical variety numbs the fun over long play. — [Dinogame guide](https://dinogame.gg/blog/mastering-hole-io/), [Higher Plain review](https://higherplaingames.com/switch/hole-io-console-review/)
- Tagpro: a 12-minute clock, but games usually end in 5-6 minutes. Controls are arrow keys only. It runs in the browser with no install. Reviewers call it easy to learn and hard to master. — [Gameverse](https://gameverse.com/2014/06/25/tagpro-capture-the-flag-has-never-been-so-much-fun/), [ResetEra](https://www.resetera.com/threads/lets-talk-about-tagpro.257352/)
- Smash Karts: matches reportedly last 3 minutes, weapons come from loot boxes, and private games let the host choose mode, arena, weapons, length and player count. — [GameSpew, Oct 2026](https://www.gamespew.com/2026/10/5-free-multiplayer-browser-games-to-play-with-friends/) (a roundup, not a developer source)
- Jackbox: players join from a phone browser with a 4-letter code, with no app. 26^4 = 456,976 combinations. Fresh codes per session. The phone can also show private information to each player. — [Built In Chicago](https://www.builtinchicago.org/articles/jackbox-games-design-party-pack), [Jackbox support](https://support.jackboxgames.com/hc/en-us/articles/15794771245975-How-do-I-get-started-playing-Jackbox-Games)
- Pummel Party: players at zero HP drop items and respawn rather than sit out. Items handed out after minigames act as catch-up. Mario Party is criticised for luck but praised for leads reversing quickly. — [Gideon's Gaming](https://gideonsgaming.com/pummel-party-review-my-kind-of-party/), [Mario Wiki](https://www.mariowiki.com/Mario_Party)
- Halo's king-of-the-hill post-mortem points: a hill that moves on a fixed schedule penalised late capturers, instant capture was too frantic, and time limits could leave a team in an unwinnable position. — [Halopedia](https://www.halopedia.org/King_of_the_Hill)
- Camping is better treated as a rules/map problem than a conduct problem. — [Wikipedia, Griefer](https://en.wikipedia.org/wiki/Griefer) (weak, generic source)

### Inferences
- This stack already matches the evidence: 4-letter room ids (see `freeRoomCode`), guest names, 90 s tag rounds, 12-player cap in Voidfall, 8 in Cube Tag. The target round length is 60-120 s, with a lobby cycle of under 3 minutes.
- Elimination games (Voidfall) are the weak spot for retention: dead players wait. Fix with a short rounds, spectate camera, and a "ghost" role that can still influence the round (see ideas below). Cube Tag already avoids elimination (tag swaps "it"), which is why it is easier to leave running.
- Comebacks should come from the rules, not from luck: score decay on leaders, a shrinking or moving objective, and "it"-style catch-up. Items are the cheapest comeback tool, but each adds a visual and server field.
- Variety across short rounds (the existing random arena per round) is the proven antidote to repetition. A mode rotation per round is the natural next step: same room, same code, different rule set.

### Gaps
- No primary-source postmortems or GDC talks were found for Fall Guys, Stumble Guys, Among Us, Gartic, Krunker, Bomberman/Crazy Arcade or hole.io. Gartic Phone and Among Us-lite were not covered by any search result.
- No hard retention or session-length statistics for any named game. Spectator and eliminated-player design was not found in any source.

## Proposed games and modes for this stack (rules, reuse, new work, length, risk, fun)

### Takeaway
Seven proposals, ranked by value per day of work. Four are rule variants on the existing `MyRoom` loop (1-1.5 days each). The strongest are Orb Rush and King of the Hill, because both use the existing score field and need only one server-owned entity. Sumo Push and Infection come next. Race and Hot Potato are riskier.

### Cited Findings
These come from code reading, not the web. All paths are under `C:\Users\Bash\Documents\GitHub\Rift-arcade-\`.
- `src/rooms/MyRoom.ts` runs tag with a fixed-timestep `step()`, one `stepEntity` per received input, `state.it`, `cooldown`, `roundClock`, `score` accumulated as survival time, `endRound`/`newRound`, a rotating or host-locked arena, and `respawn()` onto a ring. Max 8 clients. Reconnect hold of 30 s via `onDrop`.
- `src/shared/movement.ts` is a pure function `stepEntity(entity, input, dt, arena)` shared by server and client prediction. It handles an axis-aligned obstacle collision, jump, per-arena gravity and `slide`, and it clamps to the arena bounds. Players do not collide with each other in it.
- `src/shared/arenas.ts` is plain data: four arenas (Neon Grid, Moon Dunes with gravity 0.45, The Maze, Ice Rink with slide 0.65), mirrored obstacles in four quadrants (fair by symmetry), and `roundSeconds`.
- `src/rooms/VoidRoom.ts` and `src/shared/void.ts` run a 9x9 tile grid (states SOLID/CRACKING/GONE, `CRACK_TIME` 1.2 s), a phase machine (waiting, countdown, playing, over), `alive` flags, join-as-spectator mid-round, and 12 clients. Movement is a separate `stepVoidEntity`.
- Input is just `moveX`, `moveY`, `jump` (`MoveInput`, sanitised to [-1,1] and [0,1]). There is no second action button in the protocol today.

### Inferences
Each proposal below: Rules (3 lines), Reuses, New work, Length, Risk, Expected fun.

**1. Orb Rush (coin/orb collect) - recommended first**
- Rules: Glowing orbs spawn at random free points. Touch one to score; golden orbs are worth 3 and show on a screen-edge arrow. Most orbs when the clock ends wins, and the leader drops 1 orb on being bumped (optional).
- Reuses: `MyRoom` loop, `score`, `roundClock`, `respawn`, arena obstacles for placement, per-arena physics (moon = orbs on mesas, ice = overshooting orbs).
- New work: A schema `orbs` ArraySchema (x, y, z, value). Server spawns on a free point (reject points inside `overlaps`), pickup is a distance check, same as the existing tag circle test. Client renders instanced spheres. About 1 day.
- Length: 60-90 s. Risk: low. Expected fun: high. Readable, no one is ever eliminated, the jump matters on tall obstacles (place orbs on top of blocks using `floorAt`).
- Anti-grief: none needed. Spawn orbs near the trailing players to give a mild catch-up.

**2. King of the Hill (moving zone)**
- Rules: A glowing ring sits on the map. Stand inside it alone or with the most players to gain points. Every 20 s it relocates, with a 3 s telegraph. Most points wins.
- Reuses: `score`, `roundClock`, `floorAt` (zone on top of a mesa for a climb-to-contest twist), obstacle layout.
- New work: Schema `zone` (x, y, r, nextX, nextY, moveIn). Contested zone scores nobody (so camping in a pair stalls it). Client draws a ring plus a telegraph. About 1 day.
- Length: 90 s. Risk: medium. Camping and a runaway leader are the known KotH issues; the Halo evidence says fixed-schedule hills penalise late arrivals, so move the hill on a timer but randomise position and show the next spot early. Expected fun: high with 4-8 players, weak with 2 (a stalemate).
- Pair it with physics: on Ice Rink the zone is hard to stop in, which is funny and costs nothing.

**3. Sumo Push (bumper)**
- Rules: Bump into others to knock them back. Fall off a shrinking island to lose a life. Last one standing wins.
- Reuses: `VoidRoom` phase machine, `alive`/`fell`/spectate-on-join, countdown, FALL_LIMIT, 12-client cap; `slide` from `arenas.ts` for the ice feel.
- New work: Player-versus-player collision impulse (the one thing missing in both step functions). Must run in the shared step to keep prediction clean, which is the risky part: client prediction cannot know other players' positions without snapshots. Easier: apply the push on the server only, as a velocity kick, accepting a small visual correction. Shrinking edge = reuse tile GONE from the outside in. About 2-3 days.
- Length: 60-120 s. Risk: medium-high (prediction rubber-banding on hits; phone dash/jump button needed for fun). Expected fun: very high; it is the Stumble Guys/Bomberman-adjacent hook.
- Anti-grief: no team-kill problem; cap knockback per second and give 1 s invulnerability after a hit to stop corner-trapping.

**4. Infection (team tag)**
- Rules: One player starts infected (red). Touching a healthy player infects them. Healthy survivors score per second; the last survivor gets a bonus. Infected players are fast and can see everyone.
- Reuses: Cube Tag nearly 100% - generalise `state.it` to a boolean `infected` per Player and reuse the tag overlap test; `score` as survival time; `respawn`.
- New work: One `infected` field, round ends when everyone is infected or time is up, an infected speed bonus (a `speedMul` in the shared step, so keep it deterministic). About 1 day.
- Length: 60-90 s. Risk: low. Expected fun: high; nobody sits out, because the eliminated rejoin as hunters, which solves the dead-time problem directly.
- Anti-grief: a first infected player picked as the lowest scorer or at random, never the host; a 2 s spawn shield so no one is infected at spawn.

**5. Hot Potato (bomb tag)**
- Rules: One player holds a bomb with a fuse (10-15 s, visible). Pass it by touching someone. When the fuse ends the holder is out and a new bomb starts. Last survivor wins.
- Reuses: tag overlap test, `cooldown`, `state.it`, `alive` from VoidRoom, spectate.
- New work: A `fuse` timer in state and an `alive` flag in MyRoom, plus an explosion visual. About 1.5 days.
- Length: 90-150 s overall (a round each 12 s). Risk: medium; this is an elimination game, so dead-time and a "chase the weakest" feel. Expected fun: medium-high, best as a sub-mode when lobbies are 5+.
- Anti-grief: pass cooldown stops ping-pong; the bomb prefers passing to the nearest holder; eliminated players become spectators and vote on a hazard.

**6. Checkpoint Race (race through checkpoints)**
- Rules: Reach ring 1, 2, 3 ... in order, 3 laps. First home wins. Ice and moon arenas are the twist.
- Reuses: arena obstacles and physics, `stepEntity`, `score`.
- New work: Checkpoint list per arena (data in `arenas.ts`), per-player `nextCheckpoint`, a finishing order, a course design that works with a top-down camera. About 2 days with course tuning.
- Length: 60-90 s. Risk: medium; courses on mirrored arenas are symmetric, so route design needs care. Blocking and no collision means little interaction, hence a lower party feel. Expected fun: medium.

**7. Falling Hazards (dodgeball or meteors)**
- Rules: Warning circles appear on the floor and 1.5 s later a hazard lands. Touch it and you are out, or lose a life. Survive the longest.
- Reuses: Voidfall elimination and spectate, a telegraph like the tile CRACKING state, `roundClock`.
- New work: A hazard list in state (x, y, timer), server spawn pattern ramping up over time, a hit test. Dodgeball variant adds thrown balls and needs a second button, so skip for now. About 1-1.5 days for meteors.
- Length: 60-120 s. Risk: low. Expected fun: medium; it is a good cooperative-feeling mode and a fallback for 8+ players, but there is little player interaction.

**Rule twists (cheap, apply to any mode, about 0.5 day each)**
- Per-arena modifier flags in `arenas.ts` (e.g. `lowGravity`, `speedBoost`) are already data-driven; adding a `modifier` per round is trivial.
- Shrinking arena: shrink `width`/`height` bounds on a timer in the shared step (deterministic clock needed on the client, which is the catch; the safer path is the tile grid in Voidfall, where it is just GONE from the edge).
- Power-ups: speed boost, jump boost, shield. Orb-style pickups; one active effect on a timer; keep effects out of the shared step if they change physics, or add a `speedMul` field both sides read.
- Mode rotation per round inside one room (tag, orbs, hill, infection) uses the existing "different arena each round" logic extended with a `mode` field. This is the recommended path, because it keeps the room code stable and varies the session.

### Gaps
- Fun ratings are my judgement, not playtest data. Whether the server can keep prediction clean with player-versus-player pushes is untested.
- Anti-grief behaviour with real strangers is untested; rate limits already exist (`maxMessagesPerSecond` 120).

## Which suit phones (one thumb stick plus one button), and what needs balance or anti-grief thought

### Takeaway
All seven fit one stick plus jump, because the protocol already carries only `moveX`, `moveY`, `jump`. The best phone fits are Orb Rush, Infection and King of the Hill, where the stick does all the work. Anything that needs a second action (dodgeball throw, dash, power-up use) breaks the one-thumb rule and should be avoided or made automatic.

### Cited Findings
- Touch-screen one-input games work because the whole screen can be the button, and dual-input games are harder to play one-handed (joystick under the left thumb, buttons under the right). — [Geek Extreme](https://www.geekextreme.com/simple-game-mechanics-one-button-signals/), [Tech2Geek 2026](https://www.tech2geek.net/5-best-one-handed-android-games-you-can-play-with-just-one-thumb-2026/)
- Dynamic joysticks that appear under the first thumb touch allow flexible placement, and good virtual sticks let players change direction without lifting the thumb. — [Godot touch controls guide](https://inairspace.com/blogs/learn-with-inair/godot-touch-controls-for-mobile-a-complete-practical-guide-1)
- A claim that thumb-zone placement cuts mis-clicks by 30% comes from a vendor-style article and should be treated cautiously. — [NovaTechBeacon](https://novatechbeacon.com/latest/why-2026-gaming-is-built-for-one-hand-play/)
- Jackbox shows phones can display private information to each player, which would suit hidden-role modes. — [Built In Chicago](https://www.builtinchicago.org/articles/jackbox-games-design-party-pack)

### Inferences
- Phone suitability: Orb Rush, Infection, King of the Hill, Falling Hazards = excellent (stick only; jump is optional). Sumo Push = good if bumping is automatic on contact. Hot Potato = good (passing is by touch). Checkpoint Race = good but low interaction. Dodgeball and anything with aiming = poor, skip.
- Phone-versus-desktop fairness: keyboards give 8-way digital input and phones give analogue sticks, so the existing `normalize diagonal` path in `stepEntity` is fine. Smaller screens need a closer camera or larger avatars in crowded modes (orb count, hazards).
- Balance: leader catch-up in Orb Rush and KotH (spawn near trailing players, bonus orbs), a minimum of 3 players before Infection or Hot Potato, a bot or "it" fallback for 2 players, and a 2 s spawn shield in the elimination modes.
- Anti-grief: no chat means little abuse surface. Remaining risks are (a) AFK players holding a zone or the bomb, so reuse the `quiet` counter from VoidRoom to auto-skip idle players, (b) corner-trapping in Sumo and Infection, so use post-hit invulnerability, (c) host-locked arenas let one host repeat an unwanted mode, so show a vote or default to rotation, and (d) name moderation (names are truncated to 12 chars but not filtered).
- Mid-round joiners should spectate until the next round, as VoidRoom does now. Cube Tag currently lets joiners in instantly with score 0, which would be unfair in scored modes.
- Suggested order: (1) mode field + rotation, (2) Orb Rush, (3) Infection, (4) King of the Hill, (5) Falling Hazards, then Sumo and Hot Potato once the shared step handles player contact.

### Gaps
- No phone playtest data on joystick size or placement for this specific game. No source on anti-grief design for hot-potato or bomb-tag modes was found.
