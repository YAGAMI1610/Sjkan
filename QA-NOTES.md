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
`npm test` runs `npm run lint` plus four harnesses — **218 checks, 0 failures**.
Lint is `node --check` over `rules.js`, `app.js`, `api-client.js`, `audio.js`,
`cli.js` and `server/server.js`.

**`test/smoke-test.js`** (78 checks) boots the real `index.html` + `app.js` in
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
every other screen; and persistence across a reload.

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

**`test/server-test.js`** (42 checks) boots `server/server.js` on an ephemeral
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
`AWARD_DEFS` or `SIM_PLAYERS_BASE` reappears in `app.js` or `server/server.js`,
if either file hard-codes `PAYOUT_MULTIPLIER`/`DAILY_POINTS`/
`DYNAMIC_COIN_CHANCE`, or if `index.html` ever loads `rules.js` *after* `app.js`
(which would leave `CadeRules` undefined at alias time). Two live HTTP checks
then prove the running server pays exactly `Rules.scoreRound()` on a win and on
a loss.

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

**`test/cli-test.js`** (79 checks) is the production QA for the terminal build.
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

