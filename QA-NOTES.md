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
No brand logo file was actually included in the uploaded project (the `assets/`
folders only contained `.gitkeep` placeholders plus a generic `logo.svg`/
`hero-artwork.svg`), so "use the supplied CADE logo, don't redraw it" couldn't
be followed literally — there was nothing supplied to preserve. What's done
instead, keeping everything swap-in-ready via `AssetManager` (`app.js`) which
already tries a real file at a fixed path and silently falls back to emoji if
missing — no layout code needs to change when real art is dropped in later:

- **20 distinct coin logos** generated at `assets/coins/<ticker>.svg` (all
  tickers in `COIN_POOL`: MOONFROG, BONKCAT, GIGAAPE, FROGGO, MEMEDOG, CHADINU,
  ROCKETPANDA, WAGMIFROG, RUGBIRD, PEPEBOSS, DUMBFROG, BANANADOG, LASERSHARK,
  TURBOSNAIL, DIAMONDHAMSTER, SADCLOWN, GIGACHAD, MOONPIG, CRYOWL, SPICYTACO).
  Each is a chunky coin badge with a deterministic accent color (hashed from
  the ticker) and its own initial + ticker text — not a single reused shape.
  Coins generated dynamically beyond this pool at runtime still gracefully
  fall back to the emoji placeholder, by design.
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
- **Logo** (`assets/logo.svg`) left as-is: a simple "C" badge in CADE yellow/
  black. This is a stand-in, not final brand art — swap in the real CADE
  logo file at this exact path whenever it's available and nothing else
  needs to change.
- **MemeImage** (supporting per-round art): no dedicated slot existed for
  this in the current UI (`app.js`/`index.html`) beyond the coin logo itself
  — flagged here rather than silently skipped. If a separate "meme image per
  round" surface is wanted (e.g. in the coin card or result overlay), that's
  a small follow-up: add an `AssetManager.paths.memeImage` entry plus a slot
  call in the coin-card render function, following the exact same pattern as
  coins/awards/avatars above.

All 39 new SVGs were validated as well-formed XML. I don't have a browser
renderer available in this environment to screenshot them, so a quick visual
glance in-browser after deploying is still worth doing, but the shapes/colors
were composed by hand against the CADE palette (black/cream/purple/yellow/
orange, chunky arcade outlines, no gradients/neon/hologram effects) to match
the existing UI.

## Summary
Items 14 and 15 are now addressed in code (this pass) with the specific
diffs listed above. Item 13 requires a hands-on device pass; the layout/tap
target work above should make that pass go smoothly, and a checklist is
included so it's a quick, well-scoped QA task rather than an open-ended one.
