# CADE MEME MADNESS — Simulation Prototype

A prototype of the CADE Meme Madness prediction game. Runs fully client-side
with no backend; an optional server-authoritative backend is included.
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

## Test it
```bash
npm install            # jsdom, for the UI harness
npm test               # both suites — 92 checks
npm run test:ui        # jsdom UI/gameplay smoke test (59 checks)
npm run test:server    # server contract test (33 checks)
npm run lint           # node --check over all four JS files
```

`npm run test:server` needs the backend's own deps once:
`npm --prefix server install`.

The UI harness boots the real `index.html` + `app.js` in jsdom with `fetch`
stubbed to reject, which forces the local-simulation path the static build
actually uses, and seeds `Math.random` so failures reproduce. See
[QA-NOTES.md](QA-NOTES.md) for what each suite covers and for the two jsdom
gotchas to know before editing `test/smoke-test.js`.

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
- `app.js` — full game engine: daily points, boosts, arena gameplay, payout math,
  session tracking, awards, ceremony, leaderboard, voting, submissions, history, records.
- `api-client.js` — server/local fallback layer
- `audio.js` — sound + haptic hooks (muted by default, respects autoplay rules)
- `server/server.js` — optional server-authoritative backend
- `test/` — the two automated suites

## Key mechanics
- Claim 20,000 points every 24h (`Game.claimDaily`). The "NEXT CLAIM IN" line
  ticks down live and swaps itself back to the claim button when the window
  reopens.
- Boost actions for bonus points (`Game.doBoost`)
- Each round: 25s timer, pick UP/DOWN, pick a risk amount, see your risk /
  potential profit / potential loss side by side, confirm (locks in)
- Payout config lives in `CONFIG` at the top of `app.js`:
  - `PAYOUT_MULTIPLIER` (default flat 1.8x — a 1,000 stake wins +1,800)
  - `USE_TIERED_PAYOUT` + `RISK_TIERS` for tiered multipliers (1.5x / 1.8x / 2.0x) — flip the flag to switch models
- Hidden market outcome is generated independently of the user's prediction
  (`MarketEngine.generateOutcome`). Its direction is derived from the sign of
  the percentage move, so an "UP" row with a negative % is unrepresentable.
- Coins come from a 20-strong pool plus new tickers minted at runtime from
  prefix × suffix combinations, so a long session keeps introducing coins you
  haven't seen. Freshly minted ones are badged `NEW`.
- Full session object tracked per `sessionId`, saved to `history[]` on `END SESSION`
- Awards auto-calculated from session stats (`Awards.calculate`)
- Animated 9-screen award ceremony (`Ceremony.run`) with sequential badge reveals + confetti
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
