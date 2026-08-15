# Part C — QA / Polish: Status & Notes

## 13. Real device testing
I can't drive an actual iOS/Android browser from here, so this item needs a
human pass — but the layout has been reviewed and adjusted for it:

- **Tap targets**: UP/DOWN buttons already use large padding (26px vertical);
  bottom-nav icon buttons now enforce `min-height/min-width: 44px` (Apple/W3C
  minimum recommended tap target).
- **Fold fit**: timer, coin card, and risk selector stack in a single 520px-max
  column (`.container`), so they reflow naturally on narrow phones without a
  fixed-height layout that could clip on short viewports (e.g. iPhone SE).
- **Breakpoints in place**: `max-width:520px` (boost grid → 1 col),
  `max-width:400px` (risk grid → 3 cols), `min-width:900px` (wide container).
  Recommend also spot-checking at 360×740 (common Android) and 390×844
  (iPhone 12/13/14) in real Safari/Chrome, since devtools emulation doesn't
  reproduce iOS Safari's dynamic toolbar height changes, which can affect
  sticky header/bottom-nav overlap.
- **Award ceremony / share card**: both are DOM/canvas based (no fixed px
  assumptions beyond the 1000×1250 share canvas), so they should scale, but
  actually rendering + downloading the PNG on an iOS share sheet still needs
  a real-device check (Safari's `navigator.share` file support has quirks).

**Suggested manual checklist for a real pass:**
- [ ] iOS Safari — iPhone SE, iPhone 14/15, iPad
- [ ] Android Chrome — small (~360px) and large (~412px) phones
- [ ] Rotate to landscape mid-round, confirm timer/UI don't break
- [ ] Confirm `shareImage()` download/share sheet works on both platforms
- [ ] Confirm audio hooks respect mute-by-default + browser autoplay rules

## 14. Accessibility pass — changes made
- Added visible `:focus-visible` outlines (yellow, white on up/down buttons)
  for every interactive element (buttons, inputs, `[role=button]`,
  `[tabindex]`).
- Made the CADE logo (previously a `<div onclick>`) keyboard-operable:
  `role="button" tabindex="0"` + Enter/Space handler.
- Added `aria-label`s to all five bottom-nav icon buttons and wrapped them in
  a `<nav aria-label="Main navigation">` landmark; icons marked
  `aria-hidden="true"` so screen readers read the text label, not the emoji.
- Fixed color contrast failures (WCAG AA, 4.5:1 for normal text):
  - `.muted` text on `.card-yellow` was `#666` on `#FFD23F` (~4.06:1, fails)
    → darkened to `#3a2a00` (>7:1).
  - White text on the bright brand red (`--red:#FF4F4F`) was ~2.6:1 in the
    DOWN button, the down coin-move pill, and the urgent timer state — all
    fail AA. Introduced `--red-a11y:#D62828` (still clearly "red", same
    family) for just those white-text-on-red spots (~5:1). The bright
    `--red` is kept everywhere else (e.g. loss text on cream, which is
    already high-contrast).
- Bottom-nav buttons given a 44×44px minimum hit area (also helps #13).
- Pre-existing a11y that was already solid and left as-is: `aria-label` on
  mute/leaderboard header buttons, `aria-pressed` on mute toggle, `role=status`
  on the risk-zero note, `aria-label`s on generated risk chips reflecting
  affordability.

**Still worth a follow-up screen-reader pass** (VoiceOver/TalkBack) on the
award ceremony and result overlays, since those are injected dynamically —
worth confirming focus is moved into the overlay when it opens and returned
to a sensible place when it closes.

## 15. Edge case handling — confirmed in place
- **Balance hits 0 mid-session**: risk chips above the current balance are
  disabled with an `aria-label` noting "(not enough points)", the custom-risk
  input is disabled, and a status note (`#riskZeroNote`, `role=status`)
  explains it — no error state, just guidance. (`app.js` ~L980-1000)
- **Leaving mid-round with a locked prediction**: decision — the round
  **still resolves in the background** on its existing timer; it is not
  forfeited. `beforeunload` does a best-effort `saveState()` so nothing before
  that point is lost; only the specific in-flight round's outcome may not be
  recorded if the tab is actually closed before the timer fires (documented
  inline in `app.js`, bottom of the file).
- **Long sessions (100+ rounds)**: stats strip and history recompute from
  arrays rather than re-rendering the full DOM tree per round; ceremony/
  animation timers are cleared on skip/advance rather than stacking. No
  unbounded per-round DOM nodes are retained in the arena view itself (past
  rounds live in the session's data array, not as DOM). Recommend a
  synthetic 100+ round soak test as a follow-up if this hasn't been profiled
  yet, since it wasn't feasible to run a real browser profiler in this pass.

## Part A, item 1 — real visual assets (completed this pass)
The upload contained one real brand asset (`assets/logo.jpg`) and a placeholder
`hero-artwork.svg`; the `coins/`, `awards/` and `avatars/` folders held only
`.gitkeep` files. So "use the supplied CADE logo, don't redraw it" applies to
the logo and was followed literally — it is untouched. Everything else had to be
drawn. What's done, keeping it all swap-in-ready via `AssetManager` (`app.js`)
which tries a real file at a fixed path and silently falls back to a placeholder
if it's missing — no layout code changes when real art arrives later:

- **20 distinct coin logos** generated at `assets/coins/<ticker>.svg` (all
  tickers in `COIN_POOL`: MOONFROG, BONKCAT, GIGAAPE, FROGGO, MEMEDOG, CHADINU,
  ROCKETPANDA, WAGMIFROG, RUGBIRD, PEPEBOSS, DUMBFROG, BANANADOG, LASERSHARK,
  TURBOSNAIL, DIAMONDHAMSTER, SADCLOWN, GIGACHAD, MOONPIG, CRYOWL, SPICYTACO).
  Each is a chunky coin badge with a deterministic accent color (hashed from
  the ticker) and its own initial + ticker text — not a single reused shape.
  Coins minted dynamically beyond this pool at runtime (§8) have no file on
  disk and never will, so they fall through `AssetManager` to the emoji
  placeholder for the logo and to a drawn `MemeImage` panel (below) for the
  round art — neither shows a broken-image box, and both are deterministic per
  ticker, so a minted coin looks the same on every appearance.
- **8 visually distinct award badges** at `assets/awards/<code>.svg` — each is
  a genuinely different shape/composition, not the same badge recolored:
  Meme Star (5-point star + sparkles), Grinder (hexagon shield + flame),
  Biggest Payout (money bag + coins), Points King (crown), Prediction Master
  (bullseye/target), Hot Streak (lightning burst), Meme Oracle (crystal
  ball), High Roller (faceted diamond gem).
- **9 avatars** at `assets/avatars/<slug>.svg` — one per simulated competitor
  (Pepe Prophet, Chad Meme, Moonboy, Froggy, Meme Oracle, Degen Dave, Giga
  Brain, Rocket Rider) plus the player's own ("you.svg", visually marked with
  a subtle star to distinguish it in the leaderboard).
- **Hero artwork** (`assets/hero-artwork.svg`) replaced with an actual
  illustration (ascending chart line, coin badges, sparkles) in the CADE
  palette — the old file was literally a placeholder rectangle with the
  words "MEME MADNESS ARTWORK PLACEHOLDER" on it.
- **Logo** (`assets/logo.jpg`) is the one real brand asset that *was* supplied
  in the upload, so it was left exactly as-is and not redrawn. `AssetManager`
  points at it directly (note the `.jpg` — it is the only non-SVG slot). An
  earlier draft of these notes described a placeholder "C" badge at
  `assets/logo.svg`; no such file exists or is referenced.
- **MemeImage** (per-round art) — **now implemented.** `MemeImage` in `app.js`
  draws a 200×140 comic panel per round (sunburst rays, halftone dots, the
  coin's emoji as the character, a black footer bar with `$TICKER`, 4px black
  outline) with the accent colour and ray count hashed from the ticker, so a
  coin looks identical every time it appears and no two coins look alike. It
  renders through `AssetManager.slotHTML()` at `assets/memes/<ticker>.svg`, so
  dropping a real file at that path replaces the drawn panel with no code
  change — same pattern as coins/awards/avatars. The panel is the fallback
  rather than a bare emoji specifically because dynamically minted tickers
  (below) will never have a file on disk.

  This is why `slotHTML()` exists alongside `slot()`: `slot()` round-trips its
  placeholder through a `data-fallback` attribute, which breaks the moment the
  placeholder is markup containing quotes.

All 38 SVGs under `assets/` were validated as well-formed XML. I don't have a
browser renderer available in this environment to screenshot them, so a quick
visual glance in-browser after deploying is still worth doing, but the
shapes/colors were composed by hand against the CADE palette (black/cream/
purple/yellow/orange, chunky arcade outlines, no gradients/neon/hologram
effects) to match the existing UI.

## Spec conformance pass (§2, §5, §8, §14, §39, §40, §41, §44)
An audit against the build spec turned up eight places where the code was
close but not conformant. All eight are now closed:

- **§8 — coin pool is no longer a fixed list.** `MarketEngine.generateCoin()`
  mints new tickers from `COIN_PREFIXES` × `COIN_SUFFIXES` on top of
  `COIN_POOL`, so a long session keeps introducing coins the player hasn't
  seen. Minted coins carry a `NEW` badge in the coin card for one round.
- **§41 — accounts carry a `userId`.** Generated once, persisted, and sent as
  the device identity, so the server can link a returning browser to its
  account without a login.
- **§2/§40 — per-round meme art.** See the `MemeImage` note above.
- **§14 — the risk panel shows the full relationship.** It was showing stake
  and potential profit; it now shows **YOUR RISK / POTENTIAL PROFIT /
  POTENTIAL LOSS** as three boxes, in both the static markup and the JS that
  updates them, so a player can see what a wrong call costs before locking in.
- **§44 — the ceremony has all nine screens.** Screens 1 (brand intro) and 9
  (exit) were missing; both are in, and all four documented exits out of the
  ceremony (skip, tap-through, auto-advance, and the final CTA) land somewhere
  sensible instead of leaving the overlay up.
- **§39 — desktop is a two-column arena.** Above 900px the market side (coin,
  meme, chart) sits in a sticky left column and the decision side (timer,
  UP/DOWN, risk, confirm) in the right, so a desktop player isn't scrolling
  between the chart and the buttons during a 25-second round. Below 900px it
  collapses to the single stacked column in the §38 order — unchanged. The
  sticky column is disabled under `prefers-reduced-motion`.
- **§5 — the claim countdown ticks.** "NEXT CLAIM IN" was rendered once at
  hour+minute precision, so a player sitting on the home screen watched a
  frozen number and had to reload to discover the window had reopened. It now
  updates once a second and swaps itself back to the claim button the moment
  the 24h window elapses. The interval only runs while the home screen is
  actually visible.

## Two more bugs found and fixed in this pass
- **`renderRecords()` showed a fake "+0" best session to new players.**
  `bestSessionNet` was changed from `-Infinity` to `null` (JSON can't carry
  `-Infinity`), but the render still tested `> -Infinity`, which `null` passes
  by coercing to 0. Now type-checked, and a fresh account shows `—`.
- **`Round.begin()` painted the new round *after* awaiting the outcome.** On
  static hosting the local simulation resolves instantly so this was invisible,
  but against any real backend the arena kept showing the *previous* round's
  coin, price, chart and round number for the whole round-trip. None of that
  markup depends on the outcome, so it now paints first and awaits second — and
  the 25-second countdown starts only once the outcome is in hand, so no player
  loses seconds off their round to network latency.

## UI/UX upgrade (this pass)
Beyond the §39/§14/§5 changes above: hover lift on buttons, chips, tabs and
rows (`@media (hover:hover)` only, so it never sticks on touch); a pulse on the
timer in its final seconds; an inset yellow ring on the selected risk chip so
the selection reads at a glance against the hard shadow; a proper
`.empty-state` for history with a "START A RUN" call to action instead of a
bare line of grey text; and a `prefers-reduced-motion` block that disables the
lot. Nothing added is load-bearing — every animation degrades to a static
state.

## Automated test suite
`npm test` runs `npm run lint` plus four harnesses — **255 checks, 0 failures**.
Lint is `node --check` over `rules.js`, `app.js`, `api-client.js`, `audio.js`,
`cli.js` and `server/server.js`.

**`test/smoke-test.js`** (106 checks) boots the real `index.html` + `app.js` in
jsdom with `fetch` stubbed to reject, which is what forces the local
simulation path the static build actually uses. `Math.random` is a seeded LCG,
so a failure reproduces. It covers: boot with no unhandled errors; a
self-maintaining dangling-`id` check (every id read by the JS must be declared
in `index.html` *or* emitted by the JS itself, so a read with no writer
anywhere still fails); the daily claim including the live tick and the ticker
starting/stopping on navigation; dynamic coin minting and `MemeImage`
determinism; the paint-before-outcome ordering above; the full prediction flow;
10,000 outcomes asserting `dir` never contradicts the sign of `pct`, and 60,000
asserting the distribution is near-fair (P(UP) ≈ 49.2%); the balance math; a
12-round session end-to-end; the ceremony and all four §44 exits; records;
every other screen; and persistence across a reload. Groups 18 and 19 cover the
ten-minute session clock and the campaign comparison panel (below).

Three jsdom details worth knowing before editing this file. A top-level `const`
in a browser lands in the global *lexical* scope, not on `window`, so it is
reachable from inline `onclick=` handlers but never as `window.X`. jsdom also
scopes each `window.eval()` call separately. Both are why the harness
concatenates all four scripts into a **single** eval — `rules.js` first, in the
same order `index.html` loads them — and appends a `BRIDGE` epilogue that hangs
the internals on `window.__app`. Splitting that eval, or reaching for
`window.Game`, will fail with `ReferenceError`. And jsdom's `Storage` is
proxy-backed, so `localStorage.setItem = fn` stores an *item named "setItem"*
rather than replacing the method; the whole object has to be swapped via
`Object.defineProperty`, which is what `withStorage()` does.

**`test/server-test.js`** (43 checks) boots `server/server.js` on an ephemeral
port and exercises every endpoint the client calls. This is the half of the
build where the damaging bugs lived, precisely because they're unreachable from
the static app: the client falls back to local simulation, so a broken server
looks like a working game right up until the backend is deployed. It pins the
`round.profit` NaN bug (a field the client never sends, which turned the
balance into `NaN` on the first win — permanently, and poisoned the leaderboard
and records with it), the DOWN-with-a-positive-percentage rows, the `dir:"FLAT"`
row the client can never match, and `bestSessionNet: -Infinity`. Group 9 now
guards the shared-rules architecture instead of text-diffing two copies of the
same table: it fails the build if a second copy of `OUTCOMES`, `COIN_POOL`,
`AWARD_DEFS`, `SIM_PLAYERS_BASE`, `PRIZE_TIERS` or `SIDE_QUESTS` reappears in
`app.js` or `server/server.js`, if either file hard-codes `PAYOUT_MULTIPLIER`/
`DAILY_POINTS`/`DYNAMIC_COIN_CHANCE`/`SESSION_SECONDS`/`VOTE_WINDOW_MS` (or the
literal hour the vote window used to be), or if `index.html` ever loads
`rules.js` *after* `app.js` (which would leave `CadeRules` undefined at alias
time). Two live HTTP checks then prove the running server pays exactly
`Rules.scoreRound()` on a win and on a loss, and a third proves the fields the
server knows nothing about — the session deadline, the time-expired flag and the
archived campaign comparison — survive `/api/session/end` and come back out of
`/api/history` intact.

Note when running the backend by hand: `express` is installed in
`server/node_modules`, so the process has to be started from `server/`.
`node server/server.js` from the repo root cannot resolve express and exits
immediately — which looks like `ECONNREFUSED` from whatever is calling it.

**`test/deploy-test.js`** (19 checks) answers one question: if this commit is
pushed to Vercel, does the deployed site work? It reconstructs the exact file
set Vercel would upload (honouring `.vercelignore`), serves it over real HTTP,
and requests every URL the app references — all 39 runtime asset paths included.
The asset check compares against a `readdir` listing rather than
`fs.existsSync`, because macOS and Windows are case-insensitive and Vercel's
filesystem is not: `assets/coins/Froggo.svg` loads locally and 404s in
production, and `existsSync` cannot see the difference. It also asserts
`/api/health` 404s (a catch-all rewrite would answer it with 200 HTML,
`api-client.js` would read that as "a backend exists", and every call in the app
would take the slow failure path forever), that `server/`, `test/` and
`node_modules/` are absent from the upload, and that no `gh*_`/`github_pat_`
credential is embedded in any deployable file.

**`test/cli-test.js`** (87 checks) is the production QA for the terminal build.
It spawns the real `cli.js` as a child process rather than requiring it, because
what breaks a CLI in production is not internal: it's argv parsing, exit codes,
the save file, a stray colour escape in piped output. Each case gets a
throwaway save file under a temp directory, so a QA run cannot touch a real
`~/.cade-meme-madness.json` and cases cannot contaminate each other.

The load-bearing groups:

- **Parity** — 24 rounds asserting every payout equals `Rules.scoreRound()`
  exactly, plus a win at the configured multiplier, a loss at exactly the stake,
  `SKIPPED` costing nothing, direction always matching the sign of the move, and
  the same `--seed` producing the same coin and outcome twice over.
- **Ledger integrity** — across a whole session, `sum(payouts)` must equal
  `endingBalance - startingBalance`, and `wins + losses + skips` must equal
  `totalRounds`. Any double-credit or missed debit shows up as one failed
  subtraction. Also: an over-stake is refused rather than clamped, and the
  balance can never go negative even on a 40-round all-in loop.
- **Exit codes** — `0`/`1`/`2`/`3`, so `cade claim && cade session start` works.
- **Pipe hygiene** — no ANSI escapes in captured stdout, errors on stderr, and
  `--json` printing exactly one parseable object and nothing else.
- **Save file durability** — atomic write leaves no temp files, mode is `0600`,
  a corrupt file is reported rather than silently reset (overwriting it would
  destroy data that might be recoverable), an older schema is backfilled rather
  than read as `undefined`, and state survives the process boundary.
- **Drift guard** — the same structural check as the server's group 9, applied to
  `cli.js`, plus an assertion that `cli.js` is in `.vercelignore`.
- **Session clock and campaign comparison** — a new session is written with a
  ten-minute absolute deadline; `status` reports `msLeft`/`timeUp` in JSON and
  "time left … of 10 minutes" for a human; a `round` after the buzzer exits 1 with
  `session-time-up` and moves neither the balance nor the round count, while
  `session end` still works; the archived session carries a campaign comparison
  whose rank, tier and prize agree with `PRIZE_TIERS`; and the printed box keeps
  the SIMULATED label, the verbatim disclaimer and — the reason `wrapText()`
  exists — every line inside the frame.

### CLI bugs found and fixed by this QA pass
1. **`--seed banana` exited 1, not 2.** Seed validation ran above the `const C`
   colour table, so `fail()` hit the temporal dead zone reaching for `C.red`; a
   usage error surfaced as a `ReferenceError`. Seed handling moved below the
   output helpers, where `fail()` is safe to call — still ahead of `loadState()`
   and every command, which is all `Math.random` interception needs.
2. **A bad flag reported the wrong problem.** `round --predict SIDEWAYS` checked
   the session before the flags, so a typo with no session open reported "no
   session" and exited 1. A script cannot tell a typo from a state problem if
   both collapse to the same code. Flags are now validated first.
3. **Interactive play quit itself after one answer.** Each prompt created its own
   readline interface and closed it when it settled. readline reads stdin
   greedily — by the time it hands you the first line it has buffered whatever
   else arrived — so closing it discarded that buffer, the next interface opened
   on an exhausted stdin, and every later prompt resolved as "closed".
4. **...and then dropped input between prompts.** A single shared interface with
   a listener attached per prompt loses lines that arrive while no prompt is
   open — during the moment spent rendering a result card, or when input comes in
   faster than the prompts appear. Lines are now always consumed into a queue,
   and `ask()` checks that queue before it waits. Typing ahead is answered in
   order instead of vanishing.
5. **Declining the lock was reported as a timeout.** Answering `n` at the review
   step resolved the round `SKIPPED` and printed "the clock ran out", which was
   simply false. The round is now a decision loop: a typo or a declined lock
   returns you to the direction prompt for the *same* coin, matching the app's
   `cancelReview()`. Only the clock expiring resolves a round without a
   prediction, so that message is always literally true.
6. **An expired prompt printed itself twice.** The timeout handler sent Ctrl-U to
   erase half-typed input, and readline's redraw reprinted the prompt it still
   held. It now clears the prompt before the redraw, then wipes the line.

Bugs 3–6 are only reachable through a terminal, which no portable test can
allocate. They were found by driving `cli.js` under a pty (`script -qec`), and
they are now regression-covered through `--script`, a documented mode in which
`play` reads its answers from stdin — the same code path, minus the TTY
requirement. The one thing still verified by hand rather than in the suite is the
25-second clock actually expiring, since asserting it costs 25s of wall clock;
that was confirmed under a pty, resolving `SKIPPED` with nothing staked.

## Two more bugs fixed (stake escrow + arena art)

### The stake was not held for the life of the round
Reported as "the balance isn't deducted when I stake." The final numbers were in
fact correct — a loss was debited at `app.js` resolve time and a win credited
`risk × 1.8` — so 20,000 staking 10,000 ended on 38,000 or 10,000 either way.
What was actually wrong is the window in between. The countdown keeps running
after **LOCK IT IN** (`Round.startTimer`), and for those up-to-25 seconds the
committed stake was still counted as spendable balance: the header showed it, and
the next round's risk grid would have offered it.

Where the deduction lives is worth stating, because it is the first thing anyone
looking for this will get wrong. `rules.js` `scoreRound()` is **pure scoring** —
it takes a prediction, a direction and a stake and returns a label plus a signed
*net* delta (`+profit` on a win, `−risk` on a loss). It never sees a balance. Each
front end applies that delta itself: `app.js` in `Round.resolve()`, `cli.js` in
`Game.resolveRound()`, `server/server.js` in the round-submit handler. So stake
timing is a **front-end** concern and there was nothing to change in the shared
rules.

The browser now escrows: `lockInPrediction()` debits the stake and records it on
`Round.escrow`, and `settleEscrow()` returns it when the round is decided. Because
the payout is a net delta, stake-back plus payout lands on exactly the balance the
old resolve-time-only arithmetic produced — the economics are untouched, and
`netResult === sum(payouts)` still holds, which is what keeps the CLI ledger check
and the server contract green.

Escrowing introduces three ways to lose a stake, all of them now closed:

- **Session ended or restarted mid-round.** `endSession()` settles *before* it
  snapshots `endingBalance`; reading the balance first would archive a phantom
  loss and leave `netResult` short by the stake permanently. `RESTART` routes
  through `endSession()`, so it is covered by the same line.
- **The abandoned round resolving later.** Its timer still fires, so
  `Round.resolve()` settles on the dropped-round path too. `settleEscrow()` is
  idempotent — it zeroes `escrow` on the first call — so the overlapping settle
  points cannot pay a stake back twice. The comment on that path used to say "the
  balance was never debited"; that is no longer true and has been corrected.
- **A reload between the lock and the resolve.** `Round` lives in memory and no
  round is ever resumed, so the debit would outlive the round that owed it. The
  stake is mirrored into `STATE.pendingStake` (persisted), and `loadState()`
  refunds anything it finds there at boot, coercing through
  `Math.max(0, Math.floor(...))` so a hand-edited or malformed save cannot mint
  points.

The CLI and the server were checked for the same defect and do not have it: in
both, the stake is chosen and the round scored in one atomic step with no window
in between (the server does not even hear about a round until it is already
decided), so an escrow there would debit and credit inside the same function. They
were deliberately left alone.

Group 16 of the UI suite covers all of it: the debit landing at the lock rather
than at resolve, the net-per-round movement being unchanged, the mid-round session
end, the idempotent second settle, the orphan refund, and six malformed
`pendingStake` values that must not move the balance.

### Nothing rendered above the READY FOR MADNESS? card
Reported as a broken image. Nothing was broken and nothing was 404ing: the Arena
screen had **no image element at all**. `index.html` went straight from
`<section id="screen-arena">` into `#arenaPreStart`, and the only hero art slot in
the app was `#heroArtSlot` on the *home* screen. There was no path to check, which
is why it presented as plain empty space.

Added `#arenaArtSlot` above the pre-start card, filled from the same
`AssetManager.paths.hero` asset the home hero uses — so it inherits the emoji
fallback and picks up real art with no code change. It is shown and hidden
alongside `#arenaPreStart` via `UI.showArenaArt()`, called at the two existing
toggle sites, so the art does not hang around over live gameplay.

Two robustness fixes went in alongside, because they are the failure mode the
report described even though they were not the cause here. `hero-artwork.svg`
carried a `viewBox` and no `width`/`height`; an `<img>` sized `height:auto` from a
viewBox alone can resolve to **zero height**, which renders as blank space with no
broken-image icon — indistinguishable from a missing file. The SVG now declares
its intrinsic 600×400, and `.arena-art .art-slot img` pins `aspect-ratio: 3 / 2`
so the box exists regardless. Group 17 asserts the slot exists, is filled, sits
before the card in document order, hides during play, and that both the
`aspect-ratio` rule and the SVG's intrinsic dimensions are still there.

## Two features added (ten-minute runs + the campaign comparison)

### A run is now capped at ten minutes
The brief was "a full session/round of play lasts 10 minutes total, so results and
awards can be shown and shared quickly." Worth stating how that was read, because
the app has two clocks and only one of them should be ten minutes:
`CONFIG.ROUND_SECONDS` (25) is the window to call **one** coin, and there was no
session-length cap anywhere. Making a *round* ten minutes would have contradicted
the 25-second prediction window in the spec and reduced a whole run to a single
call. So a second, longer clock was added — `CONFIG.SESSION_SECONDS = 600` — and
the per-round window is untouched. If the intent was the other reading, the
one-line change is `ROUND_SECONDS`, and the drift guards will keep every front end
in step either way.

Design points that matter more than the number:

- **The deadline is an absolute timestamp on the session** (`session.endsAt`), not
  a counted-down variable. A backgrounded tab has its `setInterval` throttled to
  roughly once a minute, so a decrementing counter comes back minutes wrong. This
  way the clock is recomputed from `Date.now()` and is always right. The CLI stores
  the same field, so a run resumed in a later invocation is still bound by the
  clock it started under — which is also why the CLI can be tested without waiting
  ten real minutes: the suite rewrites `endsAt` in the save file.
- **The last round shortens to fit.** `SessionClock.roundSeconds()` is
  `min(ROUND_SECONDS, whole seconds left)`, so "ten minutes" is true to the second
  rather than to the nearest 25. Below `SESSION_MIN_ROUND_SECONDS` (5) no further
  coin is dealt — a two-second round is worse than no round.
- **A locked prediction at the buzzer is still resolved.** The stake is already
  out of the balance and the outcome was rolled before time ran out; cancelling it
  would be taking a paid-for call off the player. Its result card is the last thing
  shown, and because the clock has expired the card's button reads SEE FINAL
  RESULT and routes to the summary.
- **`Round.advance()` is now the only way into the next round.** The NEXT MEME
  button and the auto-advance after a skipped round both funnel through it, so the
  clock is checked in exactly one place. Without that, a ten-minute session runs
  forever as long as somebody keeps tapping.
- **A run left open by a closed tab is archived on the next load.**
  `Game.closeExpiredSession()` runs from `init()` — not from `loadState()`, which
  executes at module scope before `Game` and `SessionClock` exist (a `const` is not
  hoisted; this project has been bitten by that twice). The rounds are kept, the
  session lands in History, no ceremony fires.
- **The community vote window moved into `CONFIG`.** It was a literal
  `60*60*1000` in `app.js` *and* in `cli.js` — two copies of one duration, which is
  how they drift. It is now `CONFIG.VOTE_WINDOW_MS`, ten minutes to match a run,
  and both drift guards fail the build if that literal comes back.

`server/server.js` needed no change and got none. It has no duration logic at all
(its only vote rule is one vote per round), and `/api/session/end` does
`Object.assign({}, activeSession, session, …)`, so `endsAt`, `timeExpired` and the
campaign block ride along with the client's session object — now asserted, so a
future refactor that starts filtering unknown fields fails the suite. Rejecting a
post-deadline round server-side was considered and rejected: the client has already
applied the balance locally, so a server-only refusal would desync the two.

### "If this were the real campaign"
At the end of a run the summary now ranks the player's net credits against a
simulated field and reports which of the real campaign's daily prize tiers that
rank would sit in — $2,000 / $1,200 / $800 / $600 / $500, $300 for 6th–10th, $120
for 11th–20th, $50 for 21st–40th, $20 for 41st–100th, nothing outside the top 100
— plus the two $400 Side Quests when the run qualifies: The Grinder (volume,
right or wrong) and The Smasher (biggest single payout multiple). It sits where the
end-of-session summary already was, in the browser (`UI.renderCampaignSim`) and in
the CLI (`renderCampaignSim` under `session end`).

All of it lives in `rules.js` — `PRIZE_TIERS`, `SIDE_QUESTS`, `CAMPAIGN_DISCLAIMER`
and the four pure functions (`prizeForRank`, `simulateRivalScores`,
`bestWinningRound`, `simulateCampaignResult`, plus `campaignResultLines` for the
wording) — so the terminal and the browser say the same thing rather than two
paraphrases, and the drift guards cover the new tables too.

Three decisions worth recording:

- **The field is scored by the real `scoreRound()`.** Each invented rival gets a
  stake habit from `QUICK_RISKS`, a round count bounded by what fits in ten
  minutes, and a hit rate in 32–68%; every one of their rounds then goes through
  the same function the player's rounds go through. A hand-tuned score range would
  have looked fine today and become unwinnable the moment `PAYOUT_MULTIPLIER` or
  `RISK_TIERS` moved.
- **The field is 150 entrants, not 100 — a deliberate deviation from the brief's
  "~99 other realistic scores."** With 99 rivals and a table that pays down to
  100th, *every* entrant places: a run finishing 8,000 points down still ranked
  94th and "won" $20, and the requested "you wouldn't have placed in the top 100"
  message was unreachable dead code. A real campaign day has a field the top 100 is
  cut *from*, so the paying cut (`PRIZE_FIELD_SIZE = 100`) and the simulated field
  (`CAMPAIGN_ENTRANTS = 150`) are now separate numbers. Verified over 60 runs per
  level: net −20,000 ranks ~145th and never places; 0 ranks ~117th; +4,000 ranks
  ~68th and always takes the $20 tier; +25,000 ~30th; +150,000 top five. Both
  messages are now reachable, and a UI check fails the build if the two constants
  are ever set so that nobody can miss.
- **Rolled once, at archive time.** `simulateCampaignResult()` is called in
  `archiveSession()`/`endSession()` and the result is stored on the session.
  Rolling it in the renderer would hand the player a different rank and a different
  prize every time they reopened the same run from History. Sessions archived
  before this existed get one rolled on first view and then persisted, not
  re-rolled.

**On the disclaimer.** A dollar figure on a results screen reads as a promise
unless it is fenced, and this prototype has no connection to cade.market. So the
panel says so twice — a SIMULATED badge on the heading and the full
`CAMPAIGN_DISCLAIMER` printed verbatim underneath, styled with real contrast
rather than as fine print — and the suites assert it: the browser check fails if
the panel shows a figure without the badge and the verbatim sentence beside it, and
the CLI check compares the printed text against `Rules.CAMPAIGN_DISCLAIMER` on
collapsed whitespace so a wrapped line still has to match. Nothing here is a real,
offered, payable or guaranteed prize, and no rival in the field is a real entrant.

One thing the CLI needed for this: `box()` pads every row to `BOX_W - 4` and never
truncates, so a full sentence pushed the right border off the frame. `wrapText()`
greedily wraps prose at `BOX_W - 6` and icon-prefixed quest lines at `BOX_W - 10`,
and a suite check now walks the box line by line asserting nothing escapes it.

## The rules live in one file now
The three front ends — browser, CLI, backend — used to each hold their own copy
of the rules, and the copies drifted twice. The backend rolled ±40% price moves
against the browser's ±18% and weighted `FLAT` differently, so the same round
scored differently depending on whether a backend happened to be reachable.

`rules.js` is now the only place any of it exists: `CONFIG`, the coin pools, the
weighted `OUTCOMES` table, `AWARD_DEFS`, the sim players, and the payout maths in
`scoreRound()`. It uses a UMD wrapper —

```js
if (typeof module === "object" && module.exports) module.exports = factory();
else root.CadeRules = factory();
```

— deliberately, rather than an ES export: the browser build has no bundler and
loads its scripts as plain `<script src>`, so an `export` would force a build
step onto a project that currently needs none.

One hazard to know when editing `app.js`: the aliases (`const rand =
CadeRules.rand`, etc.) replaced hoisted `function` declarations, and a `const` is
**not** hoisted. Anything running at module scope above the alias — `let STATE =
loadState();` at `app.js:199` — would hit the temporal dead zone. That is why the
alias block sits at the top of the file rather than down in the UTIL section, and
why `uid()` is still a `function` declaration.

## Summary
Items 14 and 15 are addressed in code with the specific diffs listed above,
as are the eight spec gaps and the two bugs. Item 13 still requires a hands-on
device pass; the layout/tap-target work above should make that pass go
smoothly, and a checklist is included so it's a quick, well-scoped QA task
rather than an open-ended one. The screen-reader pass on the dynamically
injected overlays (noted under item 14) is likewise still open — the automated
suite asserts those overlays open, populate and close correctly, but it can't
speak to how they're announced.

