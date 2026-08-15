# CADE MEME MADNESS — Simulation Prototype

A prototype of the CADE Meme Madness prediction game. Runs fully client-side
with no backend; an optional server-authoritative backend and a terminal version
are included.
**100% simulated points. No real money, deposits, withdrawals, or wallets.**

## Run it
Open `index.html` in a browser, or serve the folder statically:

```bash
npm run serve          # http://localhost:8080
# or
python3 -m http.server 8080
```

Served statically it is a complete, playable game — there is nothing to
configure. The backend below is optional.

## Play it in a terminal
`cli.js` is the same game at a prompt — zero dependencies, Node builtins only.

```bash
npm run play                       # or:  node cli.js play
node cli.js                        # bare invocation plays, on a terminal
```

Every command also runs non-interactively, which is how the game is scripted or
scraped:

```bash
node cli.js claim                              # +20,000 points
node cli.js session start
node cli.js round --predict UP --risk 1000     # one round
node cli.js session end                        # summary + awards
node cli.js status | records | history | leaderboard | rules
node cli.js share                              # the share card as text
```

Useful flags: `--json` (one machine-readable object on stdout and nothing else),
`--seed N` (deterministic RNG — same seed, same coin and same outcome),
`--data PATH` or `$CADE_DATA` (which save file to use), `--script` (`play` takes
its answers from stdin instead of a terminal), `--no-color`.
Exit codes are `0` success, `1` a refused action (already claimed, not enough
points), `2` a usage error, `3` an internal one — so `cade claim && cade session
start` behaves.

Progress lives in `~/.cade-meme-madness.json`, written atomically so an
interrupt cannot truncate it. `node cli.js reset --yes` erases it.

**The terminal build is not a lookalike.** Every number that decides an outcome
comes from `rules.js`, the same file the browser loads as a `<script>` and the
backend `require()`s — so a round scores identically in all three. `npm run
test:cli` asserts that against `Rules.scoreRound()` round by round.

## Test it
```bash
npm install            # jsdom, for the UI harness
npm test               # lint + all four suites — 255 checks
npm run test:ui        # jsdom UI/gameplay smoke test (106 checks)
npm run test:server    # server contract test (43 checks)
npm run test:deploy    # Vercel build/deploy test (19 checks)
npm run test:cli       # CLI production QA (87 checks)
npm run lint           # node --check over every JS entry point
```

`npm run test:server` needs the backend's own deps once:
`npm --prefix server install`.

The UI harness boots the real `index.html` + `app.js` in jsdom with `fetch`
stubbed to reject, which forces the local-simulation path the static build
actually uses, and seeds `Math.random` so failures reproduce. The CLI QA spawns
the real `cli.js` as a child process — argv, exit codes, save file and all — and
each case gets a throwaway save file, so a QA run can never touch your own.
See [QA-NOTES.md](QA-NOTES.md) for what each suite covers and for the jsdom and
readline gotchas to know before editing them.

## Deploy it (Vercel)
A static deployment: no build step, no serverless functions.

```bash
npm run test:deploy    # verify before pushing
vercel --prod          # or connect the repo in the Vercel dashboard
```

`vercel.json` sets `cleanUrls`, security headers (including a CSP that permits
the inline handlers and the canvas/`blob:` share card this app genuinely uses),
and immutable caching for `/assets/*`. There is deliberately **no catch-all
rewrite**: `api-client.js` decides whether a backend exists by probing
`/api/health`, and a 404 is the signal to play locally. A rewrite answering
`/api/*` with `index.html` would turn that into a 200 serving HTML, and every
call in the app would take the slow failure path forever.

`.vercelignore` keeps `server/`, `test/`, `cli.js` and `node_modules/` out of the
upload — the Express backend holds state in an in-memory `Map` with a
module-scope `setInterval`, which is wrong for serverless and would be publicly
readable as static text besides.

`npm run test:deploy` builds the exact file set Vercel would upload, serves it
over real HTTP, and fetches all 39 runtime asset paths. It compares them against
a `readdir` listing rather than `fs.existsSync`, because macOS and Windows are
case-insensitive and Vercel is not — `assets/coins/Froggo.svg` loads locally and
404s in production.

## Optional backend
`server/server.js` (Express) is a reference implementation of the same rules,
server-authoritative: it owns the balance, generates round outcomes, and
enforces the daily claim, boosts and voting limits. Accounts are linked to a
device via an `X-Device-Id` header — no login.

```bash
npm --prefix server install
npm run server         # http://localhost:3000
```

`api-client.js` sits in front of it. Every call goes through
`withFallback(serverFn, localFn)`, which runs **exactly one** path: the server
when it's reachable, the local simulation otherwise. So the static build keeps
working with no backend, and pointing it at a running server needs no change to
the UI layer.

## Files
- `index.html` — all screens/markup
- `style.css` — CADE brand styling (black / cream / purple / yellow / orange, chunky arcade look)
- `rules.js` — **the single source of truth for the rules**: every tunable
  number, the coin pools, the weighted outcome table, the award thresholds and
  the payout maths. Loaded by the browser as a `<script>`, and `require()`d by
  the CLI and the backend, so the three front ends cannot drift apart. They did
  once: the backend rolled ±40% price moves against the browser's ±18%, and the
  same round scored differently depending on whether a backend was reachable.
- `app.js` — the browser front end: daily points, boosts, arena gameplay,
  session tracking, awards, ceremony, leaderboard, voting, submissions, history,
  records. Reads its rules from `rules.js`.
- `cli.js` — the terminal front end (see above). Reads its rules from `rules.js`.
- `api-client.js` — server/local fallback layer
- `audio.js` — sound + haptic hooks (muted by default, respects autoplay rules)
- `server/server.js` — optional server-authoritative backend. Reads its rules
  from `rules.js`.
- `vercel.json` / `.vercelignore` — static deployment config
- `test/` — the four automated suites


## Key mechanics
- Claim 20,000 points every 24h (`Game.claimDaily`). The "NEXT CLAIM IN" line
  ticks down live and swaps itself back to the claim button when the window
  reopens.
- Boost actions for bonus points (`Game.doBoost`)
- **A run lasts 10 minutes.** `CONFIG.SESSION_SECONDS` (600) caps the whole
  session so results, awards and the share card arrive while they're still worth
  sharing; `CONFIG.ROUND_SECONDS` (25) is unchanged and is still how long you get
  to call one coin. The two clocks are separate: the arena header shows
  `SESSION 10:00` counting down next to the per-round timer.
  - The deadline is stored on the session as an absolute timestamp, not counted
    down in a variable, so a backgrounded tab (where `setInterval` is throttled to
    once a minute) comes back to the right remaining time instead of a clock that
    lost two minutes. The CLI stores the same field, so a resumed run is still
    bound by the clock it started under.
  - The last round shortens to whatever the session has left, so "10 minutes" is
    true to the second, and below `SESSION_MIN_ROUND_SECONDS` no further coin is
    dealt — the run goes to its results instead.
  - A prediction already locked when the buzzer goes is still resolved: the stake
    is committed and the outcome was rolled before time ran out. Its result card
    is the last thing shown and its button reads SEE FINAL RESULT.
  - A run left open by a closed tab is archived on the next load
    (`Game.closeExpiredSession`), and `node cli.js round` refuses with
    `session-time-up` (exit 1) once the deadline has passed.
- Each round: 25s timer, pick UP/DOWN, pick a risk amount, see your risk /
  potential profit / potential loss side by side, confirm (locks in)
- **Locking a prediction commits the stake immediately** — it leaves your balance
  at the lock, not 25 seconds later when the round resolves, so the header never
  offers points that are already spoken for. The stake comes back when the round
  settles, and the round's payout is applied on top: a win still nets
  `risk × 1.8` and a loss still costs exactly the stake. If a session is ended or
  restarted mid-round, or the tab is reloaded while a prediction is locked, the
  committed stake is returned rather than lost.
- Payout and duration config lives in `CONFIG` at the top of `rules.js`, which all
  three front ends read (the browser aliases it as `CadeRules.CONFIG`):
  - `PAYOUT_MULTIPLIER` (default flat 1.8x — a 1,000 stake wins +1,800)
  - `USE_TIERED_PAYOUT` + `RISK_TIERS` for tiered multipliers (1.5x / 1.8x / 2.0x) — flip the flag to switch models
  - `ROUND_SECONDS` (25) per decision, `SESSION_SECONDS` (600) per run,
    `SESSION_MIN_ROUND_SECONDS` (5) as the floor below which no further round is
    dealt, `VOTE_WINDOW_MS` (10 min) for the community vote window
- Hidden market outcome is generated independently of the user's prediction
  (`MarketEngine.generateOutcome`). Its direction is derived from the sign of
  the percentage move, so an "UP" row with a negative % is unrepresentable.
- Coins come from a 20-strong pool plus new tickers minted at runtime from
  prefix × suffix combinations, so a long session keeps introducing coins you
  haven't seen. Freshly minted ones are badged `NEW`.
- Full session object tracked per `sessionId`, saved to `history[]` on `END SESSION`
- Awards auto-calculated from session stats (`Awards.calculate`)
- Animated 9-screen award ceremony (`Ceremony.run`) with sequential badge reveals + confetti
- **"If this were the real campaign" panel** on the end-of-session summary (and in
  the CLI's `session end` output). It ranks the run's net credits against a
  simulated field and reports the daily prize tier that rank would sit in —
  `rules.js` holds the tier table (`PRIZE_TIERS`: $2,000 / $1,200 / $800 / $600 /
  $500 / $300 for 6th–10th / $120 / $50 / $20 down to 100th) and the two Side
  Quests (`SIDE_QUESTS`: The Grinder, $400, for volume; The Smasher, $400, for the
  biggest single multiple).
  - Every rival in the field is invented and then scored through the same
    `scoreRound()` the player's own rounds go through, so the field is on the same
    scale by construction and cannot drift if `PAYOUT_MULTIPLIER` or `RISK_TIERS`
    change (`CadeRules.simulateRivalScores`).
  - The field (`CAMPAIGN_ENTRANTS`, 150) is deliberately larger than the paying cut
    (`PRIZE_FIELD_SIZE`, 100): a 100-entrant field against a table that pays to
    100th means everybody places and "you wouldn't have placed in the top 100" can
    never be shown.
  - Rolled **once**, when the session is archived, and stored on the session — so
    reopening the same run from history shows the same rank and the same figure.
  - **It is a simulation and the UI says so twice**: a SIMULATED badge on the
    heading and `CAMPAIGN_DISCLAIMER` printed verbatim underneath. Nothing here is
    affiliated with, endorsed by or connected to cade.market, no rival is a real
    entrant, and no prize is real, offered, payable or guaranteed. The suites
    assert the disclaimer sits next to the figure, because a dollar amount on a
    results screen reads as a promise without it.
- Shareable result card + "Share on X" intent link + copy-to-clipboard
- Simulated AI leaderboard that ticks during play (`Leaderboard`)
- Everything persists in `localStorage` under key `cade_meme_madness_v1`

## Layout
One stacked column on mobile. Above 900px the arena splits in two: the market
(coin, meme art, chart) in a sticky left column, the decision controls (timer,
UP/DOWN, risk, confirm) on the right — so a desktop player isn't scrolling
between the chart and the buttons during a 25-second round. The sticky column
is disabled under `prefers-reduced-motion`, as are all the hover/pulse
animations.

## Swapping in real CADE assets (asset system built)
There's a componentized `AssetManager` in `app.js`. Every art slot tries to load
a real file first and silently falls back to a placeholder if it's missing — so
you can drop in real art with zero code changes. Paths expected:

- `assets/logo.jpg` — CADE logo (**the real supplied logo, already in place**)
- `assets/hero-artwork.svg` — homepage hero illustration
- `assets/coins/<ticker-lowercase>.svg` — e.g. `assets/coins/moonfrog.svg`
- `assets/awards/<award_code-lowercase>.svg` — e.g. `assets/awards/hot_streak.svg`
  (codes: meme_star, grinder, biggest_payout, points_king, prediction_master,
  hot_streak, meme_oracle, high_roller)
- `assets/avatars/<player-name-lowercase-hyphenated>.svg` — e.g. `assets/avatars/pepe-prophet.svg`,
  or `assets/avatars/you.svg` for the player
- `assets/memes/<ticker-lowercase>.svg` — per-round meme art (optional; see below)

The 20 coin logos, 8 award badges and 9 avatars are all drawn and in place — see
[QA-NOTES.md](QA-NOTES.md) for what each one is. Drop a same-named file over any
of them to replace it; no code edits needed.

Round meme art is the one slot with no files on disk, deliberately: coins minted
at runtime will never have one. `MemeImage` draws a comic panel instead —
sunburst, halftone, the coin's emoji, `$TICKER` on a black bar — with its colour
and ray count hashed from the ticker, so a coin looks identical every time it
appears. Drop a file at `assets/memes/<ticker>.svg` to override it for a
specific coin.

## Downloadable / shareable image card
`Game.shareImage()` (wired to the **DOWNLOAD / SHARE IMAGE** button on the
results screen) renders the full "MY MEME MADNESS RUN" card — stats, awards,
CADE branding — to an off-screen `<canvas>` and turns it into a PNG. On
devices that support the native Web Share API with files (most mobile
browsers), it opens the OS share sheet directly with the image attached.
Everywhere else, it shows a modal with the rendered image and a **DOWNLOAD
PNG** link. Text-based sharing (X intent, copy results) is unchanged and
still available alongside it.

## Restart Session
A **RESTART** button sits next to **END SESSION** in the arena header.
Tapping it opens the existing confirmation modal ("Restart this session?
Your current session results will be saved to history, but your current run
will end.") — confirming saves the current session to history and
immediately starts a brand-new one (new sessionId, reset stats, new first
coin); canceling returns to gameplay untouched.

## Session vs. lifetime stats
- The in-arena stats strip separates **BALANCE** (your live, all-time
  point total) from **SESSION ROUNDS / SESSION WIN % / SESSION BEST /
  SESSION STREAK** (all reset each session), with an inline note explaining
  the split.
- The Leaderboard explicitly labels the "YOU" row as reflecting your
  all-time balance and lifetime stats, with a banner note at the top of the
  page reinforcing that leaderboard rank isn't just this session.
- The Records page opens with a note confirming everything there is an
  all-time best across every completed session (unchanged behavior, clearer
  labeling).

## Risk tier visibility
When `CONFIG.USE_TIERED_PAYOUT` is set to `true`, selecting a risk amount makes
a live color-coded badge appears next to the risk grid — e.g. **"MEDIUM RISK —
1.8x"** — that updates instantly as the user changes their stake, using the
existing `RISK_TIERS` config (LOW 1.5x / MEDIUM 1.8x / HIGH 2.0x). With the
flag off (default), the badge stays hidden and the flat multiplier applies as
before — no visual change to the default experience.

## Award ceremony animations
Each of the 8 awards has its own entrance animation while staying in the
CADE arcade style — no cyberpunk/hologram effects:
- ⭐ Meme Star — pulse-in
- 🔥 Grinder — bounce/shake-in
- 💰 Biggest Payout — pulse-in with emphasis
- 🏆 Points King — drops in from above with a bounce
- 🎯 Prediction Master — darts in from the side
- ⚡ Hot Streak — spins in
- 🧠 Meme Oracle — glows/fades in
- 💎 High Roller — spins in
Pacing (auto-advance timing, tap-to-advance, skip button) is unchanged.

## Two-step prediction confirm
1. Pick UP/DOWN + risk amount → tap **CONFIRM PREDICTION** → a review panel
   appears showing prediction, risk, potential profit/loss, with **LOCK IT IN**
   and **← CHANGE PREDICTION** options.
2. Only tapping **LOCK IT IN** actually locks the round (irreversible,
   `PREDICTION LOCKED` banner shows). Tapping **← CHANGE PREDICTION** returns
   to the picker with no changes committed. The countdown keeps running
   throughout both steps, matching the original spec.

## Still open
- **Real device pass** — iOS Safari / Android Chrome. Layout and tap targets
  have been worked for it and there's a checklist in [QA-NOTES.md](QA-NOTES.md),
  but it needs hands-on hardware.
- **Screen-reader pass** on the dynamically injected ceremony and result
  overlays (VoiceOver / TalkBack). The rest of the a11y work — focus outlines,
  landmarks, labels, WCAG AA contrast — is done and documented in QA-NOTES.
- **Real brand art** for the hero and the round meme panels. The logo is real;
  everything else is hand-drawn stand-in art at the right paths.
- **Auth** — accounts are device-linked, which survives a reload but not a new
  browser. Real sign-in is the natural next step.
- **Persistence in the backend** is an in-memory `Map`, so it resets on
  restart. Swap `Store` in `server/server.js` for a database; nothing else
  needs to change.

## Not real money
No deposits, withdrawals, wallets, or cash-out of any kind — there is no code
path to any of them. Points are simulated, granted free every 24h, and the
"prices" are generated by `MarketEngine`, not fetched from any market.
