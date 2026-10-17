# Retention and social features for Rift Arcade (Colyseus + Node, no accounts)

Scope note: web search returned thin, mostly secondary sources. Hard impact numbers for tiny browser multiplayer games largely do not exist publicly; where I could not find evidence it is listed under Gaps. The Colyseus server docs URL I tried (docs.colyseus.io/server/room) returned 404, so Colyseus API specifics below are from the repo itself or search snippets.

## Project context (read from repo, not web)
- MyRoom.ts: maxClients 8; room id = 4-letter code (roomCode.ts, no I/O); `private` option sets setPrivate(true); rounds auto-loop (endRound -> ROUND_END_PAUSE -> newRound), so "rematch" already exists implicitly; `winner` is a name string only; `it` = tagger; with fewer than 2 players the round does not advance (step returns early) -> a lone player sees nothing happening; no bots, no chat/emotes (`messages = {}` is empty with a comment saying chat/emotes go there); name is only `trim().slice(0,12)` with no filtering; allowReconnection(client, 30) already used.
- kit.ts: name saved in localStorage "name"; seat reconnection token stored per `seat:${pathname}`; showRoomTag builds `?room=CODE` share URL; runLobby handles quick/create/byId.
- index.html: already has web manifest, OG tags (og:image 1200x630), viewport meta. So PWA basics and OG previews exist; verify rather than build.
- package.json: Vite dev server is the `start` script; Node >= 22; no DB dependency. No analytics found in index.html.

## 1. Empty-room problem: bots, matchmaking, play-now

### Takeaway
Bots that backfill empty slots are the standard fix for low populations and are used by shipped live games; for a 2-8 player tag game the simplest high-impact change is server-side bot players that fill to ~4 and leave when humans join, clearly labeled. Evidence on retention impact is anecdotal (developer statements, player threads), not measured.

### Cited Findings
- Destruction AllStars added bots that take any slots left open when a queue does not fill with real players, to help matchmaking in low-activity periods — [Checkpoint Gaming](https://checkpointgaming.net/news/2021/05/destruction-allstars-to-add-bots-to-help-with-matchmaking/)
- A two-person indie team's launch (Ace Squared) peaked below what was needed to fill one server and had no bots; commenters argued even simple bots would make low-fill lobbies enjoyable (anecdotal Steam thread) — [Steam](https://steamcommunity.com/app/3151710/discussions/0/4635988976587613313)
- Flamebait developers (modl.ai blog, vendor promotion) argue bots help new players learn solo and let small friend groups fill teams — [modl.ai](https://modl.ai/?p=673)
- A player comment describes a design where a bot yields its slot when a human joins (unverified user comment) — [Steam](https://steamcommunity.com/app/690980/discussions/0/2575445196376747850)
- Fall Guys: Mediatonic never officially confirmed bots; a fan wiki claims bots were enabled in Main Show on 7 April 2022 (unreliable, fan source); players often cannot tell bots from humans — [Dot Esports](https://dotesports.com/fall-guys/news/does-fall-guys-have-bots), [Fan wiki](https://fallguysultimateknockout.fandom.com/wiki/Matchmaking)
- Mediatonic's "Cheater Island" cheaters-only queue was dropped after it hurt reputation, showing hidden matchmaking choices carry reputational risk — [Game Developer](https://www.gamedeveloper.com/game-platforms/mediatonic-s-plan-to-exile-i-fall-guys-i-cheaters-to-a-cheaters-only-queue-backfired)
- CrazyGames Full Implementation requires, where applicable: show room info, provide an invite link, offer an instant multiplayer flow, keep rooms across rounds — [CrazyGames docs](https://docs.crazygames.com/requirements/intro/)
- Colyseus client docs: joinOrCreate joins an existing room if available else creates one; locked or private rooms are ignored by it. A forum answer suggests `filterBy` on a `code` option instead of joinOrCreateById (forum, not official; verify the API) — [Colyseus client docs](https://docs.colyseus.io/client/), [Colyseus forum](https://discuss.colyseus.io/post/1132)

### Inferences
- Implementation (Colyseus): bots need no network client. Add a `Player` entry to `state.players` with a synthetic id (e.g. `bot:1`) and a `bot=true` schema field; feed it a `MoveInput` generated in `step()` before the stepEntity loop. Tag AI: if bot is `it`, steer toward nearest non-it player (with ~150-250 ms reaction delay and capped turn rate); if not it, steer away from `it`, biased toward arena center to avoid corners. Jump randomly near edges/obstacles. Tile-collapse AI: move toward the nearest tile not about to collapse, avoid tiles flagged collapsing; random wander otherwise. Add randomness and a handicap so bots are beatable.
- Backfill rule: target ~4 occupants in public quick-play rooms; spawn a bot when humans < 4 after a short wait (~5-8 s); remove one bot per human join (bots yield the slot, so maxClients 8 never blocks humans). Never add bots to private/code rooms unless the host opts in (clean fit with the existing `private` option).
- Fix the lone-player dead state first: with <2 players `step` returns early, so one human in a room sees no game. Bots cure this directly.
- Matchmaking tweak: quick play should prefer the fullest non-locked public room, not just any room. Colyseus joinOrCreate does this loosely; consider sorting by clients count via matchMaker.query. Keep rooms joinable mid-round (join-in-progress is cheap for tag).
- Labeling: label bots visibly (e.g. a small "BOT" tag / robot icon and distinct name list). Evidence on ethics is thin (see Gaps); the Fall Guys reputational case and general expectation of honesty argue for disclosure, and it costs nothing. Also helps kids' trust.
- Retention impact is plausible but unmeasured; the real metric to track is "median time to first full game" and share of sessions that end alone.

### Gaps
- No measured retention uplift from bot backfill in any small indie game was found.
- No sources on ethics/disclosure norms for bots (Among Us, Skribbl and others returned nothing).
- No technical write-up of Colyseus server-side bot patterns found; official room docs URL 404ed.

## 2. Rematch, spectate, post-round summaries, emotes, chat alternatives

### Takeaway
Rift already auto-loops rounds, so a classic rematch screen is mostly unneeded; the higher-value additions are a post-round summary (using existing `winner` and `score`), preset emote buttons (no free text), and an optional "disable chat" setting only if free-text chat is ever added.

### Cited Findings
- CrazyGames requires keeping rooms across rounds, i.e. a play-again flow that does not drop players back to lobby — [CrazyGames docs](https://docs.crazygames.com/requirements/intro/)
- CrazyGames' only chat rule is supporting a DisableChat preference — [CrazyGames docs](https://docs.crazygames.com/requirements/intro/)
- Poki's deals terms say chat or user-generated content may only be included with Poki's prior approval — [Poki deals](https://sdk.poki.com/deals)
- Kids' site Multiplication.com used automated filtering with custom allow/deny lists on player profiles and discouraged real names in multiplayer — [WebPurify case study](https://www.webpurify.com/blog/multiplication-com-profanity-filter-case-study/) (vendor source)

### Inferences
- Post-round summary: extend state with a small `results` array (name, score, tags made) set in endRound, shown during ROUND_END_PAUSE with "next: <arena>" (already in `nextArena`). Cheap; also gives share-card data.
- Emotes: register `messages = { emote: (client, id) => ... }`, validate id is an integer in a fixed list (6-8), rate-limit (1 per 1-2 s per client), write to `player.emote` + timestamp in schema or `broadcast`. No text means no moderation burden and keeps Poki/CrazyGames chat issues away. The scaffold comment in MyRoom.ts already anticipates this.
- Spectate-while-waiting: lowest value for a continuous-round game since joining mid-round is possible; skip unless rooms are made to lock during rounds. If a room is full (8), allow a read-only spectator join via a `spectate` option (not counted in maxClients is not natively supported; simpler is to just show "room full, quick play instead").
- "Play again" for a rematch with specific friends: because the room persists, the room code is the rematch. Make the code and a copy/share button prominent in the end-of-round overlay.
- Avoid free-text chat entirely; if wanted later, use a fixed phrase list.

### Gaps
- No data on emote/reaction impact on retention in casual browser games.
- Colyseus-specific official docs on messages/rate limits not fetched (404).

## 3. Persistence without accounts: profiles, leaderboards, streaks, cosmetics, storage, anti-abuse

### Takeaway
Start with a localStorage anonymous profile (random id, name, wins, streak, unlocked cosmetics) and a server-side leaderboard keyed by that id in SQLite; this needs no accounts, costs nothing, and fits a single Node process. Treat any client-reported number as untrusted: only the server awards wins.

### Cited Findings
- Node's built-in `node:sqlite` is marked "Stability 1.2 - Release candidate" in Node 25.9 docs; a third-party source claims stable from Node 24 and flag-only on Node 22 (unconfirmed against Node 24 docs). Repo requires Node >= 22 — [Node 25 docs](https://nodejs.org/download/release/latest-v25.x/docs/api/sqlite.html), [ts-sql-query docs](https://ts-sql-query.readthedocs.io/en/latest/configuration/query-runners/recommended/node_sqlite/)
- Cloudflare D1 Workers Free plan: 5 million rows read/day, 100,000 rows written/day, 5 GB storage; counters reset midnight UTC; a changelog entry (preview domain, verify) says free accounts will hard-fail at the limit from 1 Sept 2026 — [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- Supabase free tier (third-party sources, verify): 2 active projects, 500 MB DB, 50k MAU, projects pause after about 7 days of inactivity; Pro $25/month removes pause; new explicit Postgres grants for PostgREST required from 30 Oct 2026 for existing free projects — [Jetadmin](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)
- Full CrazyGames implementation requires using CrazyGames username/avatar and linking progress to a CrazyGames account (portal replaces your profile system there) — [CrazyGames docs](https://docs.crazygames.com/requirements/intro/)
- Mobile D1/D7/D30 reference benchmarks: casual puzzle ~30-40% D1, 10-20% D7; hyper-casual ~20-30% D1, 5-10% D7; "40-20-10" is a quoted ideal. These are mobile, not web — [Juego Studio](https://www.juegostudio.com/blog/how-to-increase-user-retention-and-increase-your-games-lifetime), [NudgeNow](https://nudgenow.com/blogs/mobile-game-retention-benchmarks-industry)
- Rolling retention inflates numbers versus classic N-day retention — [Amplitude](https://amplitude.com/blog/n-day-retention-for-mobile-games.md)

### Inferences
- Storage ranking for this stack: (1) SQLite file on the Node host (better-sqlite3 or node:sqlite) if hosting has a persistent disk; zero cost, trivial ops; (2) Redis only if you scale to multiple Colyseus processes (Colyseus presence/driver); (3) D1 only if the server runs on Cloudflare Workers, which a stateful Colyseus server does not; (4) Supabase works over HTTPS from anywhere but free projects pause when idle and add a dependency. Ephemeral-disk hosts (many free PaaS tiers) would lose SQLite: check hosting first (package.json only shows Vite scripts; real deploy host not determinable from repo).
- Anonymous profile: on first load `crypto.randomUUID()` in localStorage `pid`; send in join options; server stores `(pid, name, wins, rounds, best_streak, last_day, unlocked)`. Add an "export/import profile code" (short signed string) so players can recover across devices without accounts. Caveat: localStorage can be cleared or blocked (kit.ts already try/catches).
- Server-trust: only the room awards wins (endRound `best`) and writes to DB; client never sends scores. To resist spoofing pid, store a random secret token alongside pid and verify; pid alone is guessable only if leaked.
- Leaderboards: daily and weekly boards via `day` / `week` columns, top 20 query with an index; reset by key not by deletion. Count only rounds with >= 2 human players (bots do not count) to block solo farming, and ignore rounds shorter than a minimum.
- Streaks: day-streak (played on consecutive UTC days) shown in lobby; cheap, standard retention mechanic, but no source found proving impact for browser arcades.
- Cosmetics: PETS already exists (`pet: n % PETS.length`, hue from join order). Make pet/hue player-chosen and unlock by win count/streak; stored in profile; server validates the index is unlocked.
- Name abuse: normalize (NFKC, strip control/zero-width/RTL chars, collapse spaces), enforce length, blocklist plus leetspeak-aware match, fallback to "Player"; rate-limit per IP. Currently only `trim().slice(0,12)`.

### Gaps
- No evidence found quantifying uplift from streaks, cosmetics or leaderboards in small browser games.
- No web-specific D1/D7 benchmark found; only mobile.
- Official Colyseus persistence/presence docs not retrieved.

## 4. Growth: share links, PWA, OG, SEO, portals, analytics

### Takeaway
Rift already has invite URLs, a manifest and OG tags, so growth work is (a) verify/finish those, (b) add a privacy-friendly analytics tool to measure return rate, and (c) evaluate portals, noting Poki's web exclusivity and chat approval rules.

### Cited Findings
- Poki revenue share: 100% for users arriving directly (bookmarks, search, social, your community); 50/50 for users from Poki.com or Poki marketing; Poki asks for web exclusivity (a deals page cites a seven-year term); Steam and mobile stores remain allowed; non-exclusive flat-fee licensing exists; Poki for Developers is described as closed beta with limited access — [Poki SDK](https://sdk.poki.com/), [Poki deals](https://sdk.poki.com/deals)
- Poki ad SDK must be implemented; third-party guide lists <8 MB initial download, 16:9 canvas, funnel of Player Fit Test then Web Fit Test (5-7 days) then final review; earnings estimate of about $500-3,000/month for a first game is third-party and unverified — [Cinevva guide](https://app.cinevva.com/guides/publish-game-poki)
- CrazyGames: ad revenue share primary; official page does not state the split; third-party figures (60% ads / 70% IAP jam terms; "50-70%") are unverified; Basic Launch has monetization and external ads disabled; Full Implementation requires SDK ads (AdBlock-tolerant), CrazyGames username/avatar/account link; initial download <= 50 MB, total <= 250 MB, <= 1,500 files; payout monthly via Tipalti with a EUR 100 minimum (third-party) — [CrazyGames docs](https://docs.crazygames.com/requirements/intro/), [Cinevva guide](https://app.cinevva.com/guides/publish-game-crazygames)
- Plausible and Umami are both cookieless with custom events; both free to self-host; Umami is MIT, Plausible AGPL-3.0; Umami self-host needs PostgreSQL or MySQL plus Node; cloud prices conflict between sources (about $9/mo entry for each vs $20/mo for Umami 1M events), and sources disagree on funnel/retention features — verify on vendor sites — [Vemetric comparison](https://vemetric.com/blog/plausible-vs-umami), [Swetrix comparison](https://swetrix.com/comparison/plausible/vs-umami)
- Mobile-style rolling vs classic retention caveat applies to how you measure return rate — [Amplitude](https://amplitude.com/blog/n-day-retention-for-mobile-games.md)

### Inferences
- Share/invite: existing `?room=CODE` link already prefills the code (kit.ts). Add Web Share API (`navigator.share`) button with fallback to clipboard, and a per-room OG image is unnecessary; a static OG image already exists. Per-room dynamic previews cost a server route; low priority.
- PWA: manifest exists (`manifest.webmanifest?v=3`); confirm it has icons, `display: standalone`, and a service worker if install prompts are desired (Chrome requires installability criteria). Cheap check, moderate value for phone players.
- Analytics: Umami self-hosted or cloud with custom events: `room_joined`, `round_completed`, `quick_play_wait_ms`, `bot_backfill_used`, `invite_link_opened`. Return rate can be approximated by the profile `pid` stored server-side (first_seen/last_seen) with no third-party tracker, which avoids cookie/consent concerns and is more accurate than Plausible/Umami unique counts; use the analytics tool for referrers and pageviews.
- Portals: realistic only after bots + emotes exist (empty rooms are a bad portal experience). Poki exclusivity conflicts with keeping your own domain's full open-web distribution; CrazyGames Full Implementation would replace your name/profile system with theirs. Treat portals as a later experiment, probably CrazyGames Basic Launch first for traffic, no monetization.
- SEO: single-page 3D app has little crawlable content; add a short static text section and a few landing pages per game (title, description, how to play) in index.html. Impact unquantified here.

### Gaps
- No verified current rev-share percentage for CrazyGames; third-party only.
- No data on conversion from Web Share, PWA install, or OG previews for browser games.
- Did not research itch.io requirements or browser-game SEO specifics beyond the above.
- Plausible/Umami current pricing unresolved (conflicting sources).

## 5. Safety and moderation basics (names, kids)

### Takeaway
Because the amended COPPA rule's compliance date (22 April 2026) has passed and now expressly counts cookies, IP addresses and device IDs as persistent identifiers, a kid-friendly arcade should minimize data: no free text chat, filtered names, no third-party ad/tracker identifiers, a short privacy notice, and a stated minimum age or "not directed to children" position decided with legal advice.

### Cited Findings
- Amended COPPA rule published in Federal Register 22 April 2025, effective 23 June 2025, compliance deadline 22 April 2026 (passed as of today) — [Foley Hoag](https://foleyhoag.com/news-and-insights/blogs/security-privacy-and-the-law/2026/july/the-amended-children-s-online-privacy-protection-act-(coppa)-regulations-what-your-business-needs/), [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/ftc-publishes-final-coppa-rule-amendments)
- Amended rule adds cookies, IP addresses, device IDs as persistent identifiers; operators using the internal-operations exception must disclose in the privacy notice which internal operations and the safeguards; separate verifiable parental consent is needed before sharing a child's data with third parties such as advertisers — [Usercentrics](https://usercentrics.com/?p=25409), [JD Supra](https://www.jdsupra.com/legalnews/ftc-finalizes-amendments-to-the-5148473) (law-firm summaries, not the FTC text)
- FTC settlements in 2025 involved Disney, Cognosphere (Genshin Impact) and Apitor — [Usercentrics](https://usercentrics.com/?p=25409)
- Altitude game's approach: option to replace all usernames with "Player N" and a swear-word filter; Multiplication.com used automated filter plus custom allow/deny lists — [Altitude wiki](https://altitudegame.com/wiki/index.php/Parental_Controls), [WebPurify](https://www.webpurify.com/blog/multiplication-com-profanity-filter-case-study/)
- CrazyGames states no username rules; Poki requires approval for chat/UGC — [CrazyGames docs](https://docs.crazygames.com/requirements/intro/), [Poki deals](https://sdk.poki.com/deals)

### Inferences
- Names are the only UGC today and are shown to other players. Minimum viable: server-side filter (blocklist + normalization + reject/replace with "Player"), a "hide names" toggle (show "Player N") as in Altitude, and a report button that logs room/time/name (no moderation staff needed; review occasionally and add to blocklist). Adding a profile id (pid) in localStorage and storing it server-side is a persistent identifier under the amended rule; keep it first-party, no ad/tracker sharing, and document it in a privacy notice.
- Whether COPPA applies depends on whether the site is "directed to children"; I did not find a source resolving this for a general arcade. Get legal advice if kids are the target audience.
- Do not log IPs beyond what rate limiting needs; avoid third-party analytics that set identifiers.

### Gaps
- No primary-source (FTC/eCFR) text retrieved; only law-firm summaries.
- No evidence on Roblox/Club Penguin moderation approaches (search returned nothing specific).
- Non-US rules (UK Children's Code, GDPR-K) not researched.

## Ranked roadmap (impact vs effort; ranking is my judgment, not sourced)
1. Bot backfill for public quick-play, labeled, yielding to humans (medium effort, high impact; fixes lone-player dead state and the empty-room problem directly).
2. Name sanitization plus hide-names toggle (low effort, safety baseline; required groundwork before leaderboards).
3. Preset emotes with rate limit (low effort, social feel without moderation).
4. Post-round summary with room code/share button at end screen (low effort).
5. Anonymous pid profile + SQLite stats (wins, streak) and daily/weekly leaderboard (medium effort; enables return-rate measurement and cosmetic unlocks).
6. Cosmetic unlocks from existing PETS/hue by wins/streak (low-medium effort once 5 exists).
7. Self-hosted/cloud Umami (or Plausible) with custom events (low effort); use server pid for return rate.
8. Web Share button, PWA/manifest audit, landing text for SEO (low effort, uncertain impact).
9. Portal submission (CrazyGames Basic first) after 1-3 (medium effort, uncertain; watch Poki exclusivity and chat approval rules).
10. Spectator mode, dynamic OG per room, free-text chat: skip for now.
