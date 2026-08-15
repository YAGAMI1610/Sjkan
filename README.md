# CADE MEME MADNESS — Simulation Prototype

A fully client-side, no-backend prototype of the CADE Meme Madness prediction game.
**100% simulated points. No real money, deposits, withdrawals, or wallets.**

## Run it
Just open `index.html` in a browser, or serve the folder statically:

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Files
- `index.html` — all screens/markup
- `style.css` — CADE brand styling (black / cream / purple / yellow / orange, chunky arcade look)
- `app.js` — full game engine: daily points, boosts, arena gameplay, payout math,
  session tracking, awards, ceremony, leaderboard, voting, submissions, history, records.

## Key mechanics
- Claim 20,000 points every 24h (`Game.claimDaily`)
- Boost actions for bonus points (`Game.doBoost`)
- Each round: 25s timer, pick UP/DOWN, pick a risk amount, see live profit/loss preview, confirm (locks in)
- Payout config lives in `CONFIG` at the top of `app.js`:
  - `PAYOUT_MULTIPLIER` (default flat 1.8x)
  - `USE_TIERED_PAYOUT` + `RISK_TIERS` for tiered multipliers (1.5x / 1.8x / 2.0x) — flip the flag to switch models
- Hidden market outcome is generated independently of the user's prediction (`MarketEngine.generateOutcome`)
- Full session object tracked per `sessionId`, saved to `history[]` on `END SESSION`
- Awards auto-calculated from session stats (`Awards.calculate`)
- Animated award ceremony (`Ceremony.run`) with sequential badge reveals + confetti
- Shareable result card + "Share on X" intent link + copy-to-clipboard
- Simulated AI leaderboard that ticks during play (`Leaderboard`)
- Everything persists in `localStorage` under key `cade_meme_madness_v1`

## Swapping in real CADE assets (DONE — asset system built)
There's now a componentized `AssetManager` in `app.js`. Every art slot (logo, hero,
coin logos, award badges, avatars) tries to load a real file first and silently
falls back to the emoji placeholder if the file is missing — so you can drop in
real art with zero code changes. Paths expected:

- `assets/logo.svg` — CADE logo (placeholder SVG included)
- `assets/hero-artwork.svg` — homepage hero illustration (placeholder SVG included)
- `assets/coins/<ticker-lowercase>.svg` — e.g. `assets/coins/moonfrog.svg`
- `assets/awards/<award_code-lowercase>.svg` — e.g. `assets/awards/hot_streak.svg`
  (codes: meme_star, grinder, biggest_payout, points_king, prediction_master,
  hot_streak, meme_oracle, high_roller)
- `assets/avatars/<player-name-lowercase-hyphenated>.svg` — e.g. `assets/avatars/pepe-prophet.svg`,
  or `assets/avatars/you.svg` for the player

Just drop a same-named file in the right folder — no code edits needed. The
`coins/`, `awards/`, and `avatars/` folders are already created and empty,
ready for real files.

## Downloadable/shareable image card (DONE)
`Game.shareImage()` (wired to the **DOWNLOAD / SHARE IMAGE** button on the
results screen) renders the full "MY MEME MADNESS RUN" card — stats, awards,
CADE branding — to an off-screen `<canvas>` and turns it into a PNG. On
devices that support the native Web Share API with files (most mobile
browsers), it opens the OS share sheet directly with the image attached.
Everywhere else, it shows a modal with the rendered image and a **DOWNLOAD
PNG** link. Text-based sharing (X intent, copy results) is unchanged and
still available alongside it.

## Restart Session — visible entry point (DONE)
A **RESTART** button now sits next to **END SESSION** in the arena header.
Tapping it opens the existing confirmation modal ("Restart this session?
Your current session results will be saved to history, but your current run
will end.") — confirming saves the current session to history and
immediately starts a brand-new one (new sessionId, reset stats, new first
coin); canceling returns to gameplay untouched.

## Session vs. lifetime stats — clarified (DONE)
- The in-arena stats strip now separates **BALANCE** (your live, all-time
  point total) from **SESSION ROUNDS / SESSION WIN % / SESSION BEST /
  SESSION STREAK** (all reset each session), with an inline note explaining
  the split.
- The Leaderboard now explicitly labels the "YOU" row as reflecting your
  all-time balance and lifetime stats, with a banner note at the top of the
  page reinforcing that leaderboard rank isn't just this session.
- The Records page now opens with a note confirming everything there is an
  all-time best across every completed session (unchanged behavior, clearer
  labeling).

## Risk tier visibility (DONE)
When `CONFIG.USE_TIERED_PAYOUT` is set to `true`, selecting a risk amount now
shows a live color-coded badge next to the risk grid — e.g. **"MEDIUM RISK —
1.8x"** — that updates instantly as the user changes their stake, using the
existing `RISK_TIERS` config (LOW 1.5x / MEDIUM 1.8x / HIGH 2.0x). With the
flag off (default), the badge stays hidden and the flat multiplier applies as
before — no visual change to the default experience.

## Distinct award ceremony animations (DONE)
Each of the 8 awards now has its own entrance animation while staying in the
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
Confirming a prediction is now a two-step flow:
1. Pick UP/DOWN + risk amount → tap **CONFIRM PREDICTION** → a review panel
   appears showing prediction, risk, potential profit/loss, with **LOCK IT IN**
   and **← CHANGE PREDICTION** options.
2. Only tapping **LOCK IT IN** actually locks the round (irreversible,
   `PREDICTION LOCKED` banner shows). Tapping **← CHANGE PREDICTION** returns
   to the picker with no changes committed. The countdown keeps running
   throughout both steps, matching the original spec.

## Extending to a backend
The data model (`Session`, `Round`, `records`, `leaderboard`) is already shaped like
API-ready objects — swap the `localStorage` read/writes in `loadState`/`saveState`
and the leaderboard simulation for real API calls without touching the UI layer.

## Not yet wired up (left as clear extension points)
- Real image *files* — the asset system is built and ready, but the actual
  CADE logo, hero art, coin logos, award artwork, and avatars still need to
  be designed and dropped into `/assets` (see paths above)
- Audio/haptic hooks
- Persistent multi-device accounts / auth
- Server-authoritative outcome generation (currently client-side RNG, fine for a prototype)
- Real device / accessibility QA pass
- Edge case handling (balance hitting 0 mid-session, leaving mid-round, very long sessions)
- Rate limiting / server-side enforcement of daily claim, boosts, and voting
