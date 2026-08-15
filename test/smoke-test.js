/* =====================================================
   CADE MEME MADNESS — Build Smoke Test
   -----------------------------------------------------
   Loads index.html in jsdom, runs the real api-client.js / audio.js / app.js,
   and drives a full session end-to-end: claim -> start -> predict -> risk ->
   review -> lock in -> resolve -> ceremony -> summary -> persistence.

   It exists because most of this app's failure modes are wiring failures, not
   logic failures: an element id the JS reads but the HTML never defines, a
   render path that throws halfway through, a payout that credits NaN. Those are
   invisible to `node --check` and to reading the diff — they only surface when
   something actually executes the page.

   Run:  npm install && npm test
   ===================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  console.error("jsdom is not installed. Run: npm install");
  process.exit(2);
}

/* ---------------- tiny assertion harness ---------------- */
let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log("  ✓ " + name + (detail ? "  — " + detail : ""));
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log("  ✗ " + name + "\n      " + err.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

/* check() is deliberately synchronous — a promise returned from its callback
   would resolve after the report printed, so a failure inside it would surface
   as an unhandled rejection rather than a recorded failure. Anything that has to
   await goes through this instead. */
async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    passed++;
    console.log("  ✓ " + name + (detail ? "  — " + detail : ""));
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log("  ✗ " + name + "\n      " + err.message);
  }
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg ? msg + ": " : "") +
      "expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}
function group(title) { console.log("\n" + title); }

/* ---------------- boot the page ---------------- */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const pageErrors = [];
const consoleErrors = [];
const unhandled = [];

/* An unhandled rejection is the quietest failure this app can have: an async
   handler throws, nothing catches it, the user gets no feedback and the console
   message is easy to miss. Collect them for §20 rather than letting the process
   print a warning and carry on. */
process.on("unhandledRejection", r => unhandled.push(String(r && r.message || r)));

const vc = new VirtualConsole();
vc.on("jsdomError", e => pageErrors.push(e.message));
vc.on("error", (...a) => consoleErrors.push(a.join(" ")));
["warn", "log", "info", "debug"].forEach(ev => vc.on(ev, () => {}));

const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "http://localhost/",
  virtualConsole: vc
});

const { window } = dom;

/* Stub the browser APIs jsdom does not implement. Each is a real capability the
   app legitimately uses; stubbing keeps the test about our code rather than
   about jsdom's coverage. `fetch` rejects on purpose so the offline/local
   simulation path is the one under test here — the server path is covered
   separately by running server/server.js against these same contracts. */
window.fetch = () => Promise.reject(new Error("offline (test harness)"));
/* Every request the page attempts is tallied so §15 can assert the /health probe
   is issued exactly once per page load however many calls race at boot. */
const fetchLog = [];
window.fetch = (url) => {
  fetchLog.push(String(url));
  return Promise.reject(new Error("offline (test harness)"));
};
window.scrollTo = () => {};
window.open = () => null;
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
window.navigator.vibrate = () => true;
window.HTMLMediaElement.prototype.play = () => Promise.resolve();
window.HTMLMediaElement.prototype.load = () => {};
window.SVGElement.prototype.getTotalLength = function () { return 100; }; // chart draw-in
window.HTMLCanvasElement.prototype.getContext = () => null;              // share image only

// Deterministic RNG so a failure is reproducible instead of a coin flip.
let seed = 1234567;
window.Math.random = function () {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

window.eval('window.CADE_API_BASE = "/api";');

/* The three app scripts declare their objects with top-level `const`, which in a
   browser lands in the global *lexical* scope — reachable from inline onclick=
   handlers but never a property of `window`. jsdom's window.eval() also gives
   each call its own scope, so the scripts must be evaluated as one unit (as the
   browser's shared global scope effectively does) with a test-only bridge at the
   end to hand the objects out. Nothing in the app is modified to make this work. */
const BRIDGE = `
window.__app = {
  get STATE(){ return STATE; },
  CONFIG, Game, Round, UI, Nav, Api, AudioHooks, MarketEngine, MemeImage,
  AssetManager, Ceremony, Records, Awards, ShareCard, Confetti, COIN_POOL, SessionClock,
  COIN_PREFIXES, COIN_SUFFIXES, OUTCOMES, AWARD_DEFS, saveState, loadState,
  Leaderboard, awardsOf, trimRoundForStorage, HISTORY_LIMIT, CadeRules
};`;
/* rules.js first, in the same order index.html loads them: it defines the
   CadeRules global that app.js aliases at module scope. */
window.eval(
  ["rules.js", "api-client.js", "audio.js", "app.js"]
    .map(s => fs.readFileSync(path.join(ROOT, s), "utf8"))
    .join("\n;\n") + "\n;\n" + BRIDGE
);
const app = window.__app;

const doc = window.document;
const $ = sel => doc.querySelector(sel);
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/* Fire DOMContentLoaded so the app's own init() runs exactly as in a browser. */
window.eval('document.dispatchEvent(new Event("DOMContentLoaded"));');

/* Play one full round: predict -> stake -> review -> lock -> resolve.
   Mirrors the button order a real player goes through. */
async function playRound(dir, stake) {
  const G = app.Game, R = app.Round;
  G.selectPrediction(dir);
  G.selectRisk(stake);
  G.reviewPrediction();
  G.lockInPrediction();
  // The countdown would call resolve() itself at t=0 (clearing its own interval
  // first). Resolving by hand here means clearing it, or it fires a second time.
  window.clearInterval(R.timerId);
  R.resolve();
  await tick(15);
  return app.STATE.session.rounds[app.STATE.session.rounds.length - 1];
}

/* =====================================================
   TESTS
   ===================================================== */
(async function run() {
  console.log("CADE MEME MADNESS — build smoke test");

  await tick(40);

  group("1. Page boots");
  check("no jsdomError while loading + initialising", () => {
    assert(pageErrors.length === 0, pageErrors.join("\n      "));
  });
  check("all globals defined", () => {
    const gs = ["CONFIG", "Game", "Round", "UI", "Nav", "STATE", "Api", "AudioHooks",
      "MarketEngine", "MemeImage", "AssetManager", "Ceremony", "Records", "Awards", "COIN_POOL"];
    for (const g of gs) assert(typeof app[g] !== "undefined", g + " is undefined");
    return gs.length + " globals";
  });

  group("2. Every element id the JS reads exists in the HTML");
  check("no dangling $(\"#id\") selector", () => {
    // Cheap, high-value static check: exactly the class of bug introduced when
    // updatePayoutPreview started reading #potRisk before the markup had it.
    // An id is legitimate if index.html declares it OR the JS itself emits it
    // into an injected overlay (result card, modal, ceremony). Deriving the
    // second set from the source rather than an allowlist keeps this honest as
    // the app grows: a read with no writer anywhere still fails.
    const src = ["app.js", "api-client.js", "audio.js"]
      .map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
    const read = new Set();
    for (const re of [/\$\("#([A-Za-z0-9_-]+)"\)/g, /getElementById\("([A-Za-z0-9_-]+)"\)/g]) {
      let m;
      while ((m = re.exec(src))) read.add(m[1]);
    }
    const written = new Set();
    let w;
    const idAttr = /id="([A-Za-z0-9_${}.+-]+)"/g;
    while ((w = idAttr.exec(src))) written.add(w[1]);

    const missing = [...read].filter(id => !doc.getElementById(id) && !written.has(id));
    assert(missing.length === 0, "read but never created: " + missing.join(", "));
    return read.size + " ids read, " + [...read].filter(id => doc.getElementById(id)).length + " static / " +
      [...read].filter(id => !doc.getElementById(id)).length + " runtime";
  });
  check("§14 payout preview has all three boxes", () => {
    for (const id of ["potRisk", "potProfit", "potLoss"]) assert(doc.getElementById(id), "#" + id + " missing");
  });
  check("§39 arena markup carries the two-column wrappers", () => {
    assert($("#arenaGame .arena-cols"), ".arena-cols missing");
    assert($(".arena-cols .arena-col-left #coinCard"), "coin card not in the left column");
    assert($(".arena-cols .arena-col-left #chartCard"), "chart not in the left column");
    assert($(".arena-cols .arena-col-right #timerCircle"), "timer not in the right column");
    assert($(".arena-cols .arena-col-right #upBtn"), "UP/DOWN not in the right column");
    assert($(".arena-cols .arena-col-right #riskGrid"), "risk grid not in the right column");
    assert($(".arena-cols .arena-col-right #potRisk"), "payout preview not in the right column");
  });

  group("3. Daily claim (§5)");
  check("starts claimable", () => {
    assert($("#claimBtn").style.display !== "none", "claim button hidden on a fresh save");
  });
  await app.Game.claimDaily();
  await tick(10);
  check("claim credits exactly DAILY_POINTS", () => eq(app.STATE.balance, app.CONFIG.DAILY_POINTS));
  check("header points update", () => eq($("#headerPoints").textContent, "20,000"));
  check("countdown replaces the button, with second precision", () => {
    eq($("#claimBtn").style.display, "none", "claim button still visible");
    const txt = $("#claimStatus").textContent.replace(/\s+/g, " ").trim();
    assert(/NEXT CLAIM IN 23h \d\dm \d\ds/.test(txt), "no h/m/s countdown: " + txt);
    return txt;
  });
  {
    const before = $("#claimStatus").textContent;
    await tick(1100);
    check("countdown ticks live once per second", () => {
      assert($("#claimStatus").textContent !== before,
        "text unchanged after 1s — ticker not running (was: " + before.trim() + ")");
      return before.slice(-12).trim() + " → " + $("#claimStatus").textContent.slice(-12).trim();
    });
  }
  await app.Game.claimDaily();
  await tick(10);
  check("re-claim inside the window does not double-credit", () => {
    eq(app.STATE.balance, app.CONFIG.DAILY_POINTS);
  });
  check("ticker stops when the player leaves home", () => {
    app.Nav.go("how");
    app.UI.renderClaimPanel();
    eq(app.UI._claimTimer, null, "interval still armed off-screen");
  });
  check("ticker restarts on return to home", () => {
    app.Nav.go("home");
    assert(app.UI._claimTimer !== null, "interval not restarted");
  });

  group("4. Session + coin generation (§8)");
  app.Nav.go("arena");
  app.Game.startSession();
  await tick(40); // Round.begin() is async (awaits the outcome)
  check("arena switches to the game view", () => {
    eq($("#arenaPreStart").style.display, "none");
    assert($("#arenaGame").style.display !== "none", "#arenaGame still hidden");
  });
  check("coin card renders a meme panel + identity block (§2/§40)", () => {
    const card = $("#coinCard");
    assert(card.querySelector(".coin-meme"), ".coin-meme missing");
    assert(card.querySelector(".meme-art-slot svg"), "procedural meme SVG missing");
    assert(card.querySelector(".coin-id .coin-logo"), ".coin-id/.coin-logo missing");
    assert(/\$[A-Z]+/.test(card.textContent), "no $TICKER in the card");
    return card.querySelector(".coin-name").textContent.trim();
  });
  check("chart renders without throwing", () => {
    assert($("#chartCard").querySelector("svg path.chart-line"), "chart line missing");
  });
  {
    // With a real backend the outcome fetch is a round-trip. The arena must show
    // the NEW coin during that wait, not the previous round's — and the timer
    // must not start until the outcome is in hand, so no player loses seconds of
    // their 25 to latency.
    const realGet = app.Api.getRoundOutcome;
    let release = null;
    app.Api.getRoundOutcome = localFn => new Promise(r => { release = () => r(localFn()); });
    app.Round.outcome = null;

    const begun = app.Round.begin(); // deliberately not awaited
    await tick(25);
    const renderedTicker = $("#coinCard .coin-name").textContent.replace("NEW", "").trim();
    const outcomeAtPaint = app.Round.outcome;
    const timerAtPaint = $("#timerCircle").textContent;
    const clickableAtPaint = $("#upBtn").disabled;

    release();
    await begun;
    await tick(15);
    app.Api.getRoundOutcome = realGet;

    check("the new round paints before the outcome lands (no stale coin)", () => {
      assert(outcomeAtPaint == null, "outcome resolved too early — the wait was not exercised");
      eq(renderedTicker, app.Round.coin.ticker,
        "the card showed a different coin than Round.coin, so the paint is still behind the await");
      eq(timerAtPaint, String(app.CONFIG.ROUND_SECONDS), "timer not reset to full on paint");
      eq(clickableAtPaint, false, "UP/DOWN dead while waiting for the outcome");
      return renderedTicker + " painted with outcome still pending";
    });
    check("the countdown only starts once the outcome is in hand", () => {
      assert(app.Round.timerId, "no timer running after the outcome landed");
      eq(app.Round.timeLeft, app.CONFIG.ROUND_SECONDS, "countdown burned time during the wait");
    });
  }
  check("dynamic tickers are minted outside the curated pool", () => {
    const pool = new Set(app.COIN_POOL.map(c => c[0]));
    let generated = 0;
    const total = 600;
    for (let i = 0; i < total; i++) {
      const c = app.MarketEngine.generateCoin();
      assert(typeof c.ticker === "string" && c.ticker.length > 2, "bad ticker " + c.ticker);
      assert(Number.isFinite(c.price) && c.price > 0, "bad price " + c.price);
      if (c.isGenerated) {
        generated++;
        assert(!pool.has(c.ticker), c.ticker + " flagged NEW but is in the curated pool");
      }
    }
    const rate = generated / total;
    assert(generated > 0, "no coin was ever minted dynamically");
    assert(rate > 0.15 && rate < 0.7, "mint rate " + (rate * 100).toFixed(1) + "% is far from DYNAMIC_COIN_CHANCE");
    return (rate * 100).toFixed(1) + "% freshly minted, " + pool.size + " curated";
  });
  check("MemeImage art is stable per ticker and differs across tickers", () => {
    const a1 = app.MemeImage.panel({ ticker: "MOONFROG", emoji: "\u{1F438}" });
    const a2 = app.MemeImage.panel({ ticker: "MOONFROG", emoji: "\u{1F438}" });
    const b = app.MemeImage.panel({ ticker: "LASERSHARK", emoji: "\u{1F988}" });
    eq(a1, a2, "same ticker produced different art");
    assert(a1 !== b, "different tickers produced identical art");
    assert(/viewBox="0 0 200 140"/.test(a1), "panel is not a 200x140 SVG");
  });

  group("5. Prediction flow (§12–§16)");
  app.Game.selectPrediction("UP");
  app.Game.selectRisk(1000);
  await tick(5);
  check("payout preview shows risk, profit and loss", () => {
    eq($("#potRisk").textContent, "1,000", "#potRisk");
    eq($("#potProfit").textContent, "+1,800", "#potProfit (risk × 1.8, per §11)");
    eq($("#potLoss").textContent, "-1,000", "#potLoss");
  });
  check("confirm enables once both choices are made", () => eq($("#confirmBtn").disabled, false));
  app.Game.reviewPrediction();
  await tick(5);
  check("review panel opens with matching numbers", () => {
    assert($("#reviewPanel").style.display !== "none", "review panel hidden");
    eq($("#revRisk").textContent, "1,000");
    assert(/UP/.test($("#revPrediction").textContent), "prediction not shown");
  });
  /* Captured before the lock, because locking is now the moment the stake leaves
     the balance. Group 7's net-movement assertion measures from here. */
  const balanceBeforeLock = app.STATE.balance;
  app.Game.lockInPrediction();
  await tick(5);
  check("lock-in freezes the controls and shows the banner", () => {
    assert($("#lockedBanner").style.display !== "none", "locked banner hidden");
    eq($("#upBtn").disabled, true, "UP button still live after lock-in");
    eq(app.Round.locked, true);
  });
  check("the stake leaves the balance at lock-in, not 25s later at resolve", () => {
    // The countdown keeps running after the lock. The stake is committed for the
    // whole of it, so it cannot still be sitting in the spendable balance.
    eq(app.STATE.balance, balanceBeforeLock - 1000, "balance after lock");
    eq(app.Round.escrow, 1000, "Round.escrow");
    eq(app.STATE.pendingStake, 1000, "STATE.pendingStake (persisted for reloads)");
    return balanceBeforeLock.toLocaleString() + " → " + app.STATE.balance.toLocaleString();
  });

  group("6. Outcome resolution — direction can never contradict the %");
  check("dir is always the sign of pctVal (10k rolls)", () => {
    for (let i = 0; i < 10000; i++) {
      const o = app.MarketEngine.generateOutcome();
      assert(typeof o.pctVal === "number" && !Number.isNaN(o.pctVal), "pctVal is not a number: " + o.pctVal);
      assert(o.dir === "UP" || o.dir === "DOWN", "unpredictable direction: " + o.dir);
      eq(o.dir, o.pctVal >= 0 ? "UP" : "DOWN", "row " + o.key + " at " + o.pctVal + "%");
    }
    return "10,000 rolls consistent";
  });
  check("UP/DOWN split is close to fair", () => {
    let up = 0;
    const n = 60000;
    for (let i = 0; i < n; i++) if (app.MarketEngine.generateOutcome().dir === "UP") up++;
    const p = up / n;
    assert(p > 0.45 && p < 0.55, "P(UP) = " + (p * 100).toFixed(2) + "% is outside 45–55%");
    return "P(UP) = " + (p * 100).toFixed(2) + "% over " + n.toLocaleString() + " rolls";
  });
  {
    const bare = await app.Api.getRoundOutcome(() => ({ key: "UP", pctVal: 5.5, dir: "DOWN" }));
    check("getRoundOutcome re-derives dir instead of trusting it", () => {
      eq(bare.dir, "UP", "a contradictory dir was passed through");
      eq(bare.pctVal, 5.5);
    });
  }

  group("7. Balance math (§11/§12 — a win pays risk × 1.8)");
  {
    // Measured from before the lock: the stake was debited there, the escrow is
    // returned at resolve, and the round's payout is the *net* delta. So the
    // per-round movement is unchanged by escrowing — that is the invariant here.
    const before = balanceBeforeLock;
    window.clearInterval(app.Round.timerId);
    app.Round.resolve();
    await tick(30);
    const r = app.STATE.session.rounds[app.STATE.session.rounds.length - 1];
    check("round was recorded", () => assert(r, "no round record after resolve()"));
    check("balance moved by exactly the round's payout", () => {
      assert(Number.isFinite(app.STATE.balance), "balance is not finite: " + app.STATE.balance);
      eq(app.STATE.balance, before + r.payout, "balance " + before + " + payout " + r.payout);
    });
    check("resolve returns the escrow — nothing is left committed", () => {
      eq(app.Round.escrow, 0, "Round.escrow after resolve");
      eq(app.STATE.pendingStake, 0, "STATE.pendingStake after resolve");
    });
    check("payout honours the WIN/LOSS contract", () => {
      if (r.result === "WIN") eq(r.payout, Math.round(r.riskAmount * 1.8), "WIN payout");
      else if (r.result === "LOSS") eq(r.payout, -r.riskAmount, "LOSS payout");
      else eq(r.payout, 0, "SKIPPED payout");
      return r.result + " on " + r.actualDir + " " + r.pctMove + "% → " + (r.payout >= 0 ? "+" : "") + r.payout;
    });
    check("result overlay reads cleanly — no undefined/NaN, no contradiction", () => {
      const txt = $("#resultRoot").textContent;
      assert(txt.trim().length > 0, "result overlay is empty");
      assert(!/undefined|NaN/.test(txt), "overlay contains undefined/NaN: " + txt.slice(0, 160));
      const m = txt.match(/went (UP|DOWN) \(([+-]?[\d.]+)%\)/);
      assert(m, "no outcome line found in: " + txt.replace(/\s+/g, " ").slice(0, 160));
      assert((m[1] === "UP") === (parseFloat(m[2]) >= 0), "contradictory line: went " + m[1] + " (" + m[2] + "%)");
      return m[0];
    });
    app.UI.nextRound();
    await tick(30);
  }

  group("8. A 12-round session never desyncs the balance");
  {
    let expected = app.STATE.balance;
    let wins = 0, losses = 0;
    for (let i = 0; i < 12; i++) {
      assert(app.STATE.session, "session vanished mid-run");
      assert(app.Round.active, "round " + (i + 1) + " is not active");
      const rec = await playRound(i % 2 ? "DOWN" : "UP", 250);
      expected += rec.payout;
      if (rec.result === "WIN") wins++; else if (rec.result === "LOSS") losses++;
      app.UI.nextRound();
      await tick(25);
    }
    check("balance equals the sum of every payout", () => {
      eq(app.STATE.balance, expected);
      return wins + "W / " + losses + "L → " + app.STATE.balance.toLocaleString() + " pts";
    });
    check("no round has an unrecognised result", () => {
      const bad = app.STATE.session.rounds.filter(r => !["WIN", "LOSS", "SKIPPED"].includes(r.result));
      assert(bad.length === 0, bad.length + " rounds have a bad result");
      return app.STATE.session.rounds.length + " rounds recorded";
    });
    check("stats strip agrees with the round log", () => {
      const s = app.STATE.session;
      eq(s.wins, s.rounds.filter(r => r.result === "WIN").length, "session.wins");
      eq(s.losses, s.rounds.filter(r => r.result === "LOSS").length, "session.losses");
      const strip = $("#statsStrip").textContent;
      assert(!/undefined|NaN/.test(strip), strip);
    });
  }

  group("9. Session end, ceremony and summary (§23/§44)");
  {
    const sessionId = app.STATE.session.sessionId;
    window.clearInterval(app.Round.timerId);
    app.Game.endSession();
    await tick(60);
    check("ceremony opens on screen 1 with CADE branding", () => {
      const ov = $("#ceremonyRoot .ceremony-overlay");
      assert(ov, "no ceremony overlay");
      const first = ov.querySelector(".ceremony-step.active");
      assert(first, "no active ceremony step");
      assert(first.querySelector(".ceremony-brand"), ".ceremony-brand missing on screen 1");
      assert(/MEME MADNESS/.test(first.textContent), "screen 1 headline missing");
      assert(first.querySelector(".ceremony-sub"), "§23 sub-line missing");
      return ov.querySelectorAll(".ceremony-step").length + " screens queued";
    });
    check("final ceremony screen offers all four exits (§44)", () => {
      const steps = [...$("#ceremonyRoot").querySelectorAll(".ceremony-step")];
      const last = steps[steps.length - 1];
      const actions = [...last.querySelectorAll("button")].map(b => b.getAttribute("onclick") || "");
      for (const a of ["share", "again", "history", "home"]) {
        assert(actions.some(x => x.includes("finishThen('" + a + "')")), "no " + a + " action");
      }
      assert(typeof app.Ceremony.finishThen === "function", "finishThen is not a function");
      return actions.length + " buttons";
    });
    check("no undefined/NaN anywhere in the ceremony", () => {
      const txt = $("#ceremonyRoot").textContent;
      assert(!/undefined|NaN/.test(txt), txt.replace(/\s+/g, " ").slice(0, 200));
    });
    app.Ceremony.finish();
    await tick(30);
    check("finish closes the overlay and lands on the summary", () => {
      assert(!$("#ceremonyRoot .ceremony-overlay"), "overlay still open");
      eq(app.Nav.current, "summary");
    });
    check("summary card is clean", () => {
      const txt = $("#shareCardRoot").textContent;
      assert(txt.trim().length > 0, "summary card empty");
      assert(!/undefined|NaN/.test(txt), txt.slice(0, 200));
      return txt.replace(/\s+/g, " ").trim().slice(0, 56) + "…";
    });
    check("session archived to history", () => {
      assert(app.STATE.history.some(h => h.sessionId === sessionId), "session not in history");
      return app.STATE.history.length + " session(s)";
    });
    check("share text builds without placeholders", () => {
      const t = app.ShareCard.buildText(app.STATE.history[0]);
      assert(!/undefined|NaN/.test(t), t);
      return t.split("\n")[0];
    });
    check("finishThen('again') returns to the arena pre-start", () => {
      app.Ceremony._session = app.STATE.history[0];
      app.Ceremony.finishThen("again");
      eq(app.Nav.current, "arena");
      eq($("#arenaGame").style.display, "none");
      assert($("#arenaPreStart").style.display !== "none", "pre-start hidden");
    });
  }

  group("10. Records (§26)");
  app.Nav.go("records");
  await tick(10);
  check("records grid has no undefined/NaN/Infinity", () => {
    const txt = $("#recordsGrid").textContent;
    assert(!/undefined|NaN|Infinity/.test(txt), txt.slice(0, 200));
  });
  check("bestSessionNet is a real number after one session", () => {
    assert(typeof app.STATE.records.bestSessionNet === "number",
      "bestSessionNet is " + app.STATE.records.bestSessionNet);
  });
  check("a fresh save shows — rather than +0 for best session net", () => {
    const saved = app.STATE.records.bestSessionNet;
    app.STATE.records.bestSessionNet = null;
    app.UI.renderRecords();
    const box = [...$("#recordsGrid").querySelectorAll(".record-box")]
      .find(b => /BEST SESSION NET/.test(b.textContent));
    const shown = box.querySelector(".v").textContent;
    app.STATE.records.bestSessionNet = saved;
    app.UI.renderRecords();
    eq(shown, "—", "showed " + JSON.stringify(shown));
  });

  group("11. Every other screen renders clean");
  for (const [screen, root] of [["leaderboard", "#lbList"], ["vote", "#voteList"],
    ["history", "#historyList"], ["home", "#boostGrid"], ["how", "#screen-how"],
    ["submit", "#screen-submit"]]) {
    check(screen + " screen", () => {
      app.Nav.go(screen);
      const txt = $(root).textContent;
      assert(txt.trim().length > 0, root + " is empty");
      assert(!/undefined|NaN/.test(txt), txt.slice(0, 160));
    });
  }
  check("leaderboard marks exactly one row as YOU", () => {
    app.Nav.go("leaderboard");
    const me = $("#lbList").querySelectorAll(".lb-row.me");
    eq(me.length, 1, "found " + me.length + " rows marked .me");
  });
  check("history empty state offers a way back into the game", () => {
    const real = app.STATE.history;
    app.STATE.history = [];
    app.UI.renderHistory();
    const el = $("#historyList .empty-state");
    const txt = el ? el.textContent : "";
    app.STATE.history = real;
    app.UI.renderHistory();
    assert(el, ".empty-state missing");
    assert(/START A RUN/.test(txt), "no call to action");
  });

  group("12. Persistence round-trip");
  check("localStorage holds a complete, JSON-safe state", () => {
    const raw = window.localStorage.getItem("cade_meme_madness_v1");
    assert(raw, "nothing written to localStorage");
    const parsed = JSON.parse(raw);
    for (const k of ["balance", "lastClaim", "boosts", "history", "records", "userId"]) {
      assert(k in parsed, "saved state is missing " + k);
    }
    assert(/^user_/.test(parsed.userId), "userId not persisted (§41): " + parsed.userId);
    assert(parsed.records.bestSessionNet === null || typeof parsed.records.bestSessionNet === "number",
      "bestSessionNet survived as " + JSON.stringify(parsed.records.bestSessionNet));
    assert(Number.isFinite(parsed.balance), "balance persisted as " + parsed.balance);
    return Object.keys(parsed).length + " keys, " + raw.length + " bytes";
  });

  group("13. CSS covers every class the JS emits");
  check("no class used by app.js/index.html is missing a rule", () => {
    const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
    const watched = ["coin-meme", "coin-id", "meme-art-slot", "new-coin-badge",
      "ceremony-brand", "ceremony-sub", "claim-countdown", "empty-state",
      "arena-cols", "arena-col-left", "arena-col-right", "payout-box",
      "risk-zero-note", "tier-badge", "float-points", "coin-name"];
    const missing = watched.filter(c => !css.includes("." + c));
    assert(missing.length === 0, "no CSS rule for: " + missing.join(", "));
    return watched.length + " classes";
  });
  check("payout-box variants are all styled", () => {
    const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
    for (const v of ["risk", "profit", "loss"]) {
      assert(css.includes(".payout-box." + v), ".payout-box." + v + " has no rule");
    }
  });
  check("the desktop breakpoint actually forms two columns (§39)", () => {
    const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
    const block = css.slice(css.indexOf(".arena-cols{"));
    assert(/@media\(min-width:900px\)\{[\s\S]*?\.arena-cols\{[\s\S]*?grid-template-columns/.test(block),
      "no grid-template-columns for .arena-cols inside a min-width:900px query");
  });

  group("15. Bug-sweep regressions (each of these used to break the app)");

  check("resolving a round whose session was ended does not throw", () => {
    // The player can hit END SESSION mid-round; 25s later resolve() ran
    // s.rounds.push() on null and took the arena down with a TypeError.
    const before = app.STATE.balance;
    app.Round.active = true;
    app.Round.locked = true;
    app.Round.prediction = "UP";
    app.Round.risk = 1000;
    app.Round.session = { sessionId: "sess_gone", rounds: [] };
    app.Round.coin = { ticker: "TEST", emoji: "🧪", name: "Test", history: [1, 2, 3] };
    app.Round.outcome = null;
    app.STATE.session = null;
    app.Round.resolve();                       // must not throw
    eq(app.STATE.balance, before, "a dropped round moved the balance");
    eq(app.Round.locked, false, "resolve left the round locked");
    eq(app.Round.prediction, null, "resolve left a stale prediction");
  });

  check("a round belonging to a replaced session is dropped, not misfiled", () => {
    const live = { sessionId: "sess_new", rounds: [], wins: 0, losses: 0 };
    app.STATE.session = live;
    app.Round.active = true;
    app.Round.locked = true;
    app.Round.prediction = "UP";
    app.Round.risk = 500;
    app.Round.session = { sessionId: "sess_old", rounds: [] };  // pre-restart session
    app.Round.coin = { ticker: "TEST", emoji: "🧪", name: "Test", history: [1] };
    app.Round.resolve();
    eq(live.rounds.length, 0, "the old round was written into the new session");
    app.STATE.session = null;
  });

  /* jsdom's Storage is proxy-backed: assigning `localStorage.setItem = fn` stores
     an item literally called "setItem" and leaves the real method in place. The
     whole object has to be swapped to intercept a write. */
  function withStorage(stub, fn) {
    const real = window.localStorage;
    try {
      Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
      return fn(real);
    } finally {
      Object.defineProperty(window, "localStorage", { value: real, configurable: true });
    }
  }

  check("saveState survives storage that refuses every write", () => {
    let threw = null, result = null;
    withStorage({
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {}
    }, () => {
      try { result = app.saveState(); } catch (e) { threw = e.message; }
    });
    assert(!threw, "saveState propagated: " + threw);
    eq(result, false, "saveState claimed success with storage refusing writes");
  });

  check("saveState sheds history to get under quota rather than giving up", () => {
    const realHistory = app.STATE.history;
    app.STATE.history = Array.from({ length: 40 }, (_, i) => ({ sessionId: "s" + i, awards: [], rounds: [] }));
    let calls = 0;
    const ok = withStorage({
      getItem: () => null,
      setItem() { if (++calls < 3) throw new Error("QuotaExceededError"); },  // succeeds on the 3rd try
      removeItem: () => {}
    }, () => app.saveState());
    const len = app.STATE.history.length;
    app.STATE.history = realHistory;
    app.saveState();
    eq(ok, true, "saveState gave up instead of trimming");
    assert(len < 40, "history was not trimmed (still " + len + ")");
    return "trimmed 40 -> " + len + " over " + calls + " attempts";
  });

  check("archived rounds carry no chart data and history stays capped", () => {
    const realHistory = app.STATE.history;
    app.STATE.history = Array.from({ length: app.HISTORY_LIMIT + 5 }, (_, i) => ({ sessionId: "old" + i, awards: [] }));
    app.STATE.session = {
      sessionId: "sess_trim", startedAt: Date.now(), startingBalance: app.STATE.balance,
      rounds: [{ roundId: "r1", coin: { ticker: "T", history: [1, 2, 3] }, result: "WIN", payout: 100, riskAmount: 50 }],
      wins: 1, losses: 0, skipped: 0, currentStreak: 1, longestWinStreak: 1,
      totalRisked: 50, totalProfit: 100, totalLoss: 0, largestPayout: 100, largestLoss: 0
    };
    app.Game.endSession();
    const archived = app.STATE.history[0];
    const len = app.STATE.history.length;
    const hasChart = !!(archived.rounds && archived.rounds[0].coin && archived.rounds[0].coin.history);
    app.STATE.history = realHistory;
    app.saveState();
    assert(!hasChart, "the 24-point chart array was persisted with the round");
    assert(len <= app.HISTORY_LIMIT, "history grew past the cap: " + len);
    return "capped at " + len;
  });

  check("skipping the ceremony stops its auto-advance timer", () => {
    const s = {
      sessionId: "sess_cer", startedAt: Date.now(), endedAt: Date.now(),
      startingBalance: 20000, endingBalance: 21800, netResult: 1800,
      totalRounds: 1, wins: 1, losses: 0, skipped: 0, winRate: 100,
      totalRisked: 1000, largestPayout: 1800, largestLoss: 0, longestWinStreak: 1,
      awards: ["MEME_STAR"], rounds: []
    };
    app.Ceremony.run(s);
    assert(app.Ceremony._auto !== null, "the ceremony never armed its timer");
    app.Ceremony.finish();
    eq(app.Ceremony._auto, null, "finish() left the interval running — confetti keeps firing");
  });

  check("a 0-loss player's win rate is 100%, not 83%", () => {
    // p.wins/(p.wins+p.losses||1) parses as p.wins/(p.wins+(p.losses||1)).
    app.Leaderboard.ensure();
    const real = app.STATE.leaderboard.players;
    app.STATE.leaderboard.players = [{ name: "perfect", avatar: "🧪", points: 1, wins: 5, losses: 0, biggestPayout: 0, streak: 5 }];
    const row = app.Leaderboard.getRanked("winrate").find(p => p.name === "perfect");
    app.STATE.leaderboard.players = real;
    eq(Math.round(row.winRate), 100, "win rate is still mis-parenthesised");
  });

  check("leaving the vote screen stops the 1s countdown interval", () => {
    app.Nav.go("vote");
    assert(app.UI._voteInterval, "renderVote never started the countdown");
    app.Nav.go("home");
    eq(app.UI._voteInterval, null, "the countdown kept ticking on another screen");
  });

  check("a session with no awards field renders instead of throwing", () => {
    // Sessions archived by an older build have no `awards`; History used to go blank.
    const realHistory = app.STATE.history;
    app.STATE.history = [{
      sessionId: "legacy_1", startedAt: Date.now(), endedAt: Date.now(),
      startingBalance: 20000, endingBalance: 20500, netResult: 500,
      totalRounds: 2, wins: 1, losses: 1, skipped: 0, winRate: 50,
      largestPayout: 900, rounds: []
      // no awards key at all
    }];
    let threw = null;
    try { app.UI.renderHistory(); } catch (e) { threw = e.message; }
    const txt = $("#historyList").textContent;
    app.STATE.history = realHistory;
    app.UI.renderHistory();
    assert(!threw, "renderHistory threw: " + threw);
    assert(/legacy_1|500/.test(txt), "the legacy session did not render");
  });

  check("an unrecognised award code is skipped, not fatal", () => {
    const s = { awards: ["MEME_STAR", "NOT_A_REAL_AWARD", "HOT_STREAK"] };
    const list = app.awardsOf(s);
    eq(list.length, 2, "unknown codes were not filtered");
    assert(list.every(a => a.icon && a.title), "a resolved award is missing fields");
    eq(app.awardsOf({}).length, 0, "a session with no awards did not yield []");
    eq(app.awardsOf(null).length, 0, "a null session did not yield []");
  });

  check("ShareCard text survives a session with a bad award code", () => {
    const txt = app.ShareCard.buildText({
      totalRounds: 3, winRate: 66.6, endingBalance: 21000, netResult: 1000,
      largestPayout: 900, awards: ["BOGUS_CODE"]
    });
    assert(!/undefined/.test(txt), txt.slice(0, 120));
  });

  check("Escape closes a modal and the backdrop click does too", () => {
    app.UI.showModal({ title: "T", body: "B", confirmLabel: "OK", hideCancel: true, onConfirm: () => app.UI.hideModal() });
    assert($("#modalRoot").textContent.includes("B"), "the modal did not open");
    const esc = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    doc.dispatchEvent(esc);
    eq($("#modalRoot").innerHTML, "", "Escape did not dismiss the modal");

    app.UI.showModal({ title: "T2", body: "B2", confirmLabel: "OK", hideCancel: true, onConfirm: () => app.UI.hideModal() });
    const overlay = $("#modalOverlay");
    assert(overlay, "no #modalOverlay to click");
    overlay.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    eq($("#modalRoot").innerHTML, "", "a backdrop click did not dismiss the modal");
  });

  check("clicking inside the modal card does NOT dismiss it", () => {
    app.UI.showModal({ title: "T3", body: "B3", confirmLabel: "OK", hideCancel: true, onConfirm: () => {} });
    const card = $("#modalRoot .modal");
    card.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert($("#modalRoot").textContent.includes("B3"), "a click on the card itself closed the modal");
    app.UI.hideModal();
  });

  check("confetti is suppressed under prefers-reduced-motion", () => {
    const realMM = window.matchMedia;
    window.matchMedia = q => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    const before = doc.querySelectorAll(".confetti-piece").length;
    app.Confetti.burst(10);
    const after = doc.querySelectorAll(".confetti-piece").length;
    window.matchMedia = realMM;
    eq(after, before, "confetti still rendered with reduced motion requested");
  });

  check("the /health probe is issued exactly once per page load", () => {
    const probes = fetchLog.filter(u => /\/health$/.test(u));
    eq(probes.length, 1, "fired " + probes.length + " probes: concurrent callers each ran their own");
    return fetchLog.length + " requests total, 1 probe";
  });

  await checkAsync("the vote boost is credited exactly once", async () => {
    app.STATE.boosts.vote = false;
    app.STATE.votes = { endsAt: Date.now() + 60000, coins: [{ ticker: "AAA", emoji: "🅰️", votes: 10 }], voted: false };
    const before = app.STATE.balance;
    await app.UI.castVote(0);
    await tick(5);
    const reward = app.CONFIG.BOOST_ACTIONS.find(b => b.id === "vote").reward;
    eq(app.STATE.balance - before, reward, "the vote boost was double- or non-credited");
    eq(app.STATE.votes.voted, true, "the vote was not recorded");
    return "+" + reward + " once";
  });

  await checkAsync("a rejected meme submission is caught and surfaced to the player", async () => {
    const realFn = app.Api.submitMeme;
    app.Api.submitMeme = () => { const e = new Error("Boost already claimed"); e.status = 429; return Promise.reject(e); };
    $("#subName").value = "Rejected Frog";
    $("#subTicker").value = "REJFROG";
    try {
      await app.Game.submitMeme();
      await tick(10);
    } finally {
      app.Api.submitMeme = realFn;
    }
    assert(unhandled.length === 0, "unhandled rejection: " + unhandled.join(", "));
    const toastTxt = $("#toastRoot").textContent;
    assert(/already submitted/i.test(toastTxt), "no feedback shown, toast said: " + toastTxt.slice(0, 80));
  });

  check("the persisted mute preference is honoured before DOMContentLoaded", () => {
    /* AudioHooks.init() is bound to DOMContentLoaded, but app.js's init IIFE runs
       synchronously at the end of <body> and reads isMuted() to draw the header
       icon. Re-evaluating audio.js in its own scope (DOMContentLoaded long since
       fired here) reproduces exactly that window. */
    const src = fs.readFileSync(path.join(ROOT, "audio.js"), "utf8");
    const probe = stored => {
      if (stored === null) window.localStorage.removeItem("cade_mm_muted");
      else window.localStorage.setItem("cade_mm_muted", stored);
      window.eval(src + "\n;window.__audioProbe = AudioHooks;");
      return window.__audioProbe.isMuted();
    };
    const unmuted = probe("0");
    const muted = probe("1");
    const fresh = probe(null);
    eq(unmuted, false, "a stored 'unmuted' preference was ignored at load");
    eq(muted, true, "a stored 'muted' preference was ignored at load");
    eq(fresh, true, "a first-ever load should default to muted");
  });

  check("api-client and audio still define their globals when storage throws", () => {
    /* Safari private browsing / \"block all cookies\": localStorage.getItem throws.
       Unguarded, that threw during module evaluation, so `Api` and `AudioHooks`
       were never defined and every call site became a ReferenceError. */
    const realLS = window.localStorage;
    const throwing = {
      getItem() { throw new Error("SecurityError: storage disabled"); },
      setItem() { throw new Error("SecurityError: storage disabled"); },
      removeItem() { throw new Error("SecurityError: storage disabled"); }
    };
    let threw = null, apiOk = false, audioOk = false;
    try {
      Object.defineProperty(window, "localStorage", { value: throwing, configurable: true });
      window.eval(fs.readFileSync(path.join(ROOT, "api-client.js"), "utf8") + "\n;window.__apiProbe = Api;");
      apiOk = !!(window.__apiProbe && typeof window.__apiProbe.deviceId === "string");
      window.eval(fs.readFileSync(path.join(ROOT, "audio.js"), "utf8") + "\n;window.__audioProbe2 = AudioHooks;");
      audioOk = !!(window.__audioProbe2 && typeof window.__audioProbe2.isMuted() === "boolean");
    } catch (e) {
      threw = e.message;
    } finally {
      Object.defineProperty(window, "localStorage", { value: realLS, configurable: true });
    }
    assert(!threw, "module evaluation threw with storage disabled: " + threw);
    assert(apiOk, "Api was not defined / has no deviceId when storage throws");
    assert(audioOk, "AudioHooks was not defined when storage throws");
  });

  group("16. Stake escrow — a committed stake is held for the life of the round");

  check("ending a session mid-round returns the stake, and archives it", () => {
    /* Ending a session while a round is locked used to be harmless because the
       balance was only touched at resolve. Now the stake is already out, so
       endSession() has to settle it *before* snapshotting endingBalance —
       otherwise the archived session carries a phantom loss and netResult is
       short by the stake forever. */
    const startBal = app.STATE.balance;
    app.Game.startSession();
    const sessionStart = app.STATE.balance;
    app.Game.selectPrediction("UP");
    app.Game.selectRisk(1500);
    app.Game.reviewPrediction();
    app.Game.lockInPrediction();
    eq(app.STATE.balance, sessionStart - 1500, "stake was not debited at lock");

    app.Game.endSession();
    eq(app.STATE.balance, sessionStart, "ending mid-round did not return the stake");
    eq(app.STATE.pendingStake, 0, "pendingStake outlived the session");
    const archived = app.STATE.history[0];
    eq(archived.endingBalance, sessionStart, "archived endingBalance is off by the stake");
    eq(archived.netResult, sessionStart - archived.startingBalance, "archived netResult is wrong");

    // The abandoned round's timer still fires later. settleEscrow() is idempotent,
    // so that must not hand the stake back a second time.
    window.clearInterval(app.Round.timerId);
    app.Round.resolve();
    eq(app.STATE.balance, sessionStart, "the stake was refunded twice");
    return startBal.toLocaleString() + " → " + app.STATE.balance.toLocaleString() + " (unchanged)";
  });

  check("a stake orphaned by a reload is returned on the next load", () => {
    /* Round lives in memory and no round is ever resumed, so a reload between the
       lock and the resolve leaves a debited balance and no round to pay it back.
       loadState() has to notice and refund, or the points are simply gone. */
    const KEY = "cade_meme_madness_v1";
    const original = window.localStorage.getItem(KEY);
    try {
      window.localStorage.setItem(KEY, JSON.stringify({
        userId: "user_orphan", balance: 5000, pendingStake: 2000, history: [], session: null
      }));
      const reloaded = app.loadState();
      eq(reloaded.balance, 7000, "orphaned stake was not returned");
      eq(reloaded.pendingStake, 0, "pendingStake survived the refund");
      const persisted = JSON.parse(window.localStorage.getItem(KEY));
      eq(persisted.balance, 7000, "the refund was not persisted");
      eq(persisted.pendingStake, 0, "the persisted pendingStake was not cleared");
      return "5,000 + 2,000 orphaned → 7,000";
    } finally {
      if (original === null) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, original);
    }
  });

  check("a garbage pendingStake cannot mint points", () => {
    const KEY = "cade_meme_madness_v1";
    const original = window.localStorage.getItem(KEY);
    try {
      for (const junk of [-500, "banana", null, undefined, NaN, Infinity]) {
        window.localStorage.setItem(KEY, JSON.stringify({
          userId: "u", balance: 1000, pendingStake: junk, history: [], session: null
        }));
        const s = app.loadState();
        assert(Number.isFinite(s.balance), "balance became " + s.balance + " for pendingStake " + junk);
        eq(s.balance, 1000, "pendingStake " + JSON.stringify(junk) + " changed the balance");
      }
      return "6 malformed values ignored";
    } finally {
      if (original === null) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, original);
    }
  });

  group("17. Arena pre-start art");

  check("the arena art slot exists and is filled from the hero asset", () => {
    const slot = doc.getElementById("arenaArtSlot");
    assert(slot, "#arenaArtSlot is missing from index.html");
    const inner = slot.querySelector(".art-slot");
    assert(inner, "#arenaArtSlot was never filled by AssetManager (init() did not wire it)");
    // jsdom loads no images, so the fallback is what renders here — the point is
    // that the slot has content rather than being an empty box.
    assert(slot.textContent.trim().length > 0 || slot.querySelector("img"),
      "the arena art slot renders nothing at all — this is the empty space that was reported");
    return "filled with " + (slot.querySelector("img") ? "the real asset" : "the emoji fallback");
  });

  check("the arena art sits above the READY FOR MADNESS? card", () => {
    const slot = doc.getElementById("arenaArtSlot");
    const card = doc.getElementById("arenaPreStart");
    assert(slot && card, "one of the two elements is missing");
    eq(slot.parentElement, card.parentElement, "the art is not a sibling of the pre-start card");
    assert(slot.compareDocumentPosition(card) & 4 /* DOCUMENT_POSITION_FOLLOWING */,
      "the art renders after the card, not above it");
  });

  check("the art is hidden while a session is live and returns after it", () => {
    const slot = doc.getElementById("arenaArtSlot");
    app.Game.startSession();
    eq(slot.style.display, "none", "the art stayed on screen during play");
    app.Game.endSession();
    app.Game.playAgain();
    assert(slot.style.display !== "none", "the art did not come back on PLAY AGAIN");
  });

  check("the CSS gives the arena art a box to paint into", () => {
    // An <img> sized from a viewBox alone can resolve to zero height, which looks
    // exactly like a missing image: blank space, no broken-image icon.
    const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
    const block = css.slice(css.indexOf(".arena-art .art-slot img{"));
    assert(block, ".arena-art .art-slot img rule is missing");
    assert(/aspect-ratio\s*:/.test(block.slice(0, 300)), "no aspect-ratio on the arena art image");
    const svg = fs.readFileSync(path.join(ROOT, "assets", "hero-artwork.svg"), "utf8");
    assert(/<svg[^>]*\bwidth="/.test(svg) && /<svg[^>]*\bheight="/.test(svg),
      "hero-artwork.svg has no intrinsic width/height");
  });

  group("18. Session clock — a run is capped at ten minutes");

  check("the arena shows the clock and says how long a run is", () => {
    const clock = doc.getElementById("sessionClock");
    assert(clock, "#sessionClock is missing from index.html");
    const note = doc.getElementById("arenaSessionNote");
    assert(note, "#arenaSessionNote is missing from index.html");
    // The note is built from CONFIG rather than typed, so it cannot claim ten
    // minutes after someone retunes SESSION_SECONDS.
    const mins = app.CONFIG.SESSION_SECONDS / 60;
    assert(note.textContent.indexOf(mins + "-MINUTE") !== -1,
      "the arena note does not state the session length: " + JSON.stringify(note.textContent));
    assert(note.textContent.indexOf(app.CONFIG.ROUND_SECONDS + "s") !== -1,
      "the arena note does not state the per-round window");
    return mins + "-minute session, " + app.CONFIG.ROUND_SECONDS + "s rounds";
  });

  check("starting a session sets an absolute deadline and shows it counting", () => {
    app.Game.startSession();
    const s = app.STATE.session;
    assert(s.endsAt, "the session carries no endsAt deadline");
    const span = s.endsAt - s.startedAt;
    // A deadline rather than a counted-down number: a backgrounded tab whose
    // interval is throttled still returns to the right remaining time.
    assert(Math.abs(span - app.CONFIG.SESSION_SECONDS * 1000) < 2000,
      "the deadline is " + Math.round(span / 1000) + "s out, expected " + app.CONFIG.SESSION_SECONDS);
    eq(s.timeExpired, false, "a fresh session is already flagged as expired");
    eq(doc.getElementById("sessionClock").textContent,
      "SESSION " + app.SessionClock.format(app.CONFIG.SESSION_SECONDS * 1000),
      "the clock chip does not show the full session length");
    return "deadline " + app.SessionClock.format(app.SessionClock.remainingMs()) + " out";
  });

  check("the last round shortens to whatever the session has left", () => {
    const s = app.STATE.session;
    const full = s.endsAt;
    try {
      eq(app.SessionClock.roundSeconds(), app.CONFIG.ROUND_SECONDS, "a fresh session shortened a round");
      // 8s left is less than a 25s round, so the round has to end at the buzzer
      // or "ten minutes" is a lie by up to seventeen seconds.
      s.endsAt = Date.now() + 8000;
      eq(app.SessionClock.roundSeconds(), 8, "the final round was not clipped to the session remainder");
      assert(app.SessionClock.roundFits(), "8s should still be worth a round");
      s.endsAt = Date.now() + 2000;
      assert(!app.SessionClock.roundFits(),
        "2s left still counts as room for a round (below SESSION_MIN_ROUND_SECONDS)");
      assert(app.SessionClock.roundSeconds() >= 1, "roundSeconds() went to zero");
      return "25s → 8s → no round";
    } finally {
      s.endsAt = full;
    }
  });

  check("Round.advance() ends the session once the clock is up", () => {
    const s = app.STATE.session;
    const historyBefore = app.STATE.history.length;
    s.endsAt = Date.now() - 1;
    assert(app.SessionClock.expired(), "expired() did not notice the passed deadline");
    app.Round.advance();
    eq(app.STATE.session, null, "the session survived its own deadline");
    eq(app.STATE.history.length, historyBefore + 1, "the expired run was not archived");
    return "archived at the buzzer";
  });

  check("a locked round at the buzzer is still resolved, not cancelled", () => {
    /* The stake is out and the outcome was rolled before the clock ran out, so
       cancelling the round would take a paid-for prediction off the player. It
       resolves, its result card is the last thing shown, and the card's button
       goes to the summary rather than dealing another coin. */
    app.Game.startSession();
    const s = app.STATE.session;
    const roundsBefore = s.rounds.length;
    app.Game.selectPrediction("UP");
    app.Game.selectRisk(1000);
    app.Game.reviewPrediction();
    app.Game.lockInPrediction();
    s.endsAt = Date.now() - 1;
    app.SessionClock.timeUp();
    eq(s.timeExpired, true, "the session was not flagged as time-expired");
    eq(s.rounds.length, roundsBefore + 1, "the locked round was thrown away at the buzzer");
    eq(app.STATE.pendingStake, 0, "the stake was left in escrow");
    const card = doc.getElementById("resultRoot").textContent;
    assert(card.indexOf("SEE FINAL RESULT") !== -1,
      "the last result card still offers another round: " + card.slice(0, 160));
    // ...and that button is the only way on, so it must archive rather than deal.
    app.Round.advance();
    eq(app.STATE.session, null, "the run did not end after time expired");
    eq(app.STATE.history[0].timeExpired, true, "the archived run is not flagged as time-expired");
    return "round " + app.STATE.history[0].rounds.length + " honoured, then archived";
  });

  check("a run left open by a closed tab is archived on the next load", () => {
    const KEY = "cade_meme_madness_v1";
    const original = window.localStorage.getItem(KEY);
    const liveHistory = app.STATE.history.length;
    const stale = {
      sessionId: "sess_stale", userId: "user_stale",
      startedAt: Date.now() - 900000, endsAt: Date.now() - 300000, timeExpired: false,
      startingBalance: 9000, rounds: [{ result: "WIN", payout: 1800, riskAmount: 1000 }],
      wins: 1, losses: 0, totalRisked: 1000, totalProfit: 1800, totalLoss: 0,
      largestRisk: 1000, largestPayout: 1800, currentStreak: 1, longestWinStreak: 1,
      awards: [], coinsEncountered: []
    };
    try {
      /* loadState() has to *keep* an expired session: it runs at module scope,
         before Game and SessionClock exist, so closing the run is init()'s job and
         a load that quietly dropped it would lose the rounds outright. */
      window.localStorage.setItem(KEY, JSON.stringify({
        userId: "user_stale", balance: 10800, pendingStake: 0, history: [], session: stale
      }));
      const reloaded = app.loadState();
      assert(reloaded.session, "loadState() dropped a session whose deadline had passed");
      eq(reloaded.session.sessionId, "sess_stale");

      // STATE is a module-scope `let` the harness can only read, so stand the
      // stale run up on the live state the way a real reload would.
      app.STATE.session = reloaded.session;
      const closed = app.Game.closeExpiredSession();
      assert(closed, "closeExpiredSession() did not close a run whose deadline had passed");
      eq(app.STATE.session, null, "the stale session is still live");
      eq(app.STATE.history.length, liveHistory + 1, "the stale run was dropped instead of archived");
      const archived = app.STATE.history[0];
      eq(archived.sessionId, "sess_stale", "some other session was archived");
      eq(archived.timeExpired, true, "the archived stale run is not flagged");
      assert(archived.campaign, "the archived stale run got no campaign comparison");
      eq(app.STATE.session, null);
      return "1 round preserved, run moved to History with no ceremony";
    } finally {
      if (original === null) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, original);
    }
  });

  check("the voting window comes from CONFIG, not a hard-coded hour", () => {
    const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    assert(/CONFIG\.VOTE_WINDOW_MS/.test(src), "app.js no longer reads CONFIG.VOTE_WINDOW_MS");
    assert(!/60\s*\*\s*60\s*\*\s*1000/.test(src), "app.js hard-codes an hour-long vote window again");
    eq(app.CONFIG.VOTE_WINDOW_MS, app.CONFIG.SESSION_SECONDS * 1000,
      "the vote window and the session length have drifted apart");
    return app.CONFIG.VOTE_WINDOW_MS / 60000 + " minutes";
  });

  group("19. Campaign comparison — simulated, and labelled as such");

  const Rules = app.CadeRules;

  check("every prize tier boundary maps to the published table", () => {
    const expected = [
      [1, 2000], [2, 1200], [3, 800], [4, 600], [5, 500],
      [6, 300], [10, 300], [11, 120], [20, 120],
      [21, 50], [40, 50], [41, 20], [100, 20]
    ];
    for (const [rank, usd] of expected) {
      const tier = Rules.prizeForRank(rank);
      assert(tier, "rank " + rank + " pays nothing but should pay $" + usd);
      eq(tier.usd, usd, "rank " + rank);
    }
    eq(Rules.prizeForRank(101), null, "rank 101 was paid — the table stops at 100");
    eq(Rules.prizeForRank(0), null, "rank 0 was paid");
    eq(Rules.prizeForRank(-3), null, "a negative rank was paid");
    return expected.length + " boundaries + 3 non-paying ranks";
  });

  check("rank is one plus the rivals strictly ahead, ties to the player", () => {
    // A fixed field keeps this about the ranking rule rather than the RNG.
    const rivals = [];
    for (let i = 0; i < 149; i++) rivals.push({ net: i * 100, predictions: 4, bestPayout: 900 });
    const at = net => Rules.simulateCampaignResult(
      { netResult: net, wins: 1, losses: 1, rounds: [] }, { rivals, fieldSize: 150 });

    eq(at(1000000).rank, 1, "a runaway score did not rank first");
    eq(at(-1).rank, 150, "the worst score did not rank last");
    // 14,800 is rival index 148's exact score: matching it must not rank behind it.
    eq(at(14800).rank, 1, "a tie with the top rival cost the player the rank");
    eq(at(14700).rank, 2, "second place is off by one");
    const mid = at(9900); // 49 rivals (10,000 … 14,800) score above 9,900
    eq(mid.rank, 50, "mid-field rank is wrong");
    eq(mid.prizeUsd, 20, "rank 50 should sit in the 41st–100th tier");
    eq(mid.fieldSize, 150, "fieldSize was not reported");
    eq(mid.paidRanks, 100, "paidRanks should be the paying cut, not the field");
    return "150-entrant field, ranks 1/2/50/150 all correct";
  });

  check("both headline wordings are reachable", () => {
    const rivals = [];
    for (let i = 0; i < 149; i++) rivals.push({ net: i * 100, predictions: 4, bestPayout: 900 });
    const win = Rules.campaignResultLines(Rules.simulateCampaignResult(
      { netResult: 1000000, wins: 5, losses: 0, rounds: [] }, { rivals, fieldSize: 150 }));
    assert(/ranked around number 1 and won \$2,000!/.test(win.headline), "top-rank wording: " + win.headline);

    const miss = Rules.campaignResultLines(Rules.simulateCampaignResult(
      { netResult: -999999, wins: 0, losses: 5, rounds: [] }, { rivals, fieldSize: 150 }));
    assert(/wouldn't have placed in the top 100\.$/.test(miss.headline),
      "no-prize wording should name the paying cut, not the field: " + miss.headline);
    return "$2,000 headline + top-100 miss";
  });

  check("a field that pays 100 has to be bigger than 100, or nobody ever misses", () => {
    /* The bug this pins: with a 100-entrant field and a table paying to 100th,
       last place still wins $20 and the "wouldn't have placed" branch above is
       dead code. The simulated field is the day's entrants; the top 100 is the
       cut taken from it. */
    assert(Rules.CAMPAIGN_ENTRANTS > Rules.PRIZE_FIELD_SIZE,
      "CAMPAIGN_ENTRANTS (" + Rules.CAMPAIGN_ENTRANTS + ") must exceed PRIZE_FIELD_SIZE (" +
      Rules.PRIZE_FIELD_SIZE + ") or every entrant places");
    const worst = Rules.simulateCampaignResult({ netResult: -500000, wins: 0, losses: 9, rounds: [] });
    eq(worst.placed, false, "a catastrophic run still placed against a live field");
    eq(worst.prizeUsd, 0, "a non-placing run was given a prize");
    return Rules.CAMPAIGN_ENTRANTS + " entrants, top " + Rules.PRIZE_FIELD_SIZE + " paid";
  });

  check("the simulated field is scored by the real scoreRound()", () => {
    // Not a hand-tuned range: if PAYOUT_MULTIPLIER or RISK_TIERS move, the field
    // moves with them, so the comparison can't quietly become unwinnable.
    const field = Rules.simulateRivalScores(200);
    eq(field.length, 200);
    for (const r of field) {
      assert(Number.isFinite(r.net), "a rival scored " + r.net);
      assert(r.predictions >= 3, "a rival played " + r.predictions + " rounds");
      assert(r.bestPayout >= 0, "a rival had a negative best payout");
    }
    const nets = field.map(r => r.net);
    assert(Math.min(...nets) < 0 && Math.max(...nets) > 0,
      "the simulated field has no losers or no winners — that is not a plausible day");
    return "200 rivals, net " + Math.min(...nets).toLocaleString() + " … " + Math.max(...nets).toLocaleString();
  });

  check("side quests trigger on their own thresholds only", () => {
    const rivals = [{ net: 0, predictions: 4, bestPayout: 100 }];
    const q = (wins, losses, rounds) => Rules.simulateCampaignResult(
      { netResult: 0, wins, losses, rounds }, { rivals, fieldSize: 2 }).quests.map(x => x.id);

    const G = Rules.SIDE_QUESTS.GRINDER_QUEST.minPredictions;
    eq(q(G - 1, 0, []).length, 0, (G - 1) + " predictions should not reach The Grinder");
    assert(q(G, 0, []).indexOf("GRINDER_QUEST") !== -1, G + " predictions should reach The Grinder");
    // Predictions, not rounds: a round the clock ran out on was never a call.
    assert(q(G - 1, 1, []).indexOf("GRINDER_QUEST") !== -1, "wins + losses should both count");

    const S = Rules.SIDE_QUESTS.SMASHER_QUEST.minPayout;
    const hit = p => [{ result: "WIN", payout: p, riskAmount: Math.round(p / 1.8) }];
    eq(q(1, 0, hit(S - 1)).length, 0, "a payout below the floor reached The Smasher");
    assert(q(1, 0, hit(S)).indexOf("SMASHER_QUEST") !== -1, "a payout at the floor missed The Smasher");
    const both = Rules.simulateCampaignResult(
      { netResult: 0, wins: G, losses: 0, rounds: hit(S * 2) }, { rivals, fieldSize: 2 });
    eq(both.quests.length, 2, "both quests should be able to fire at once");
    return "grinder ≥" + G + " calls, smasher ≥" + S.toLocaleString() + " payout";
  });

  check("a losing session is never credited with a best winning round", () => {
    const b = Rules.bestWinningRound({ rounds: [
      { result: "LOSS", payout: -5000, riskAmount: 5000 },
      { result: "SKIPPED", payout: 0, riskAmount: 0 }
    ] });
    eq(b.bestPayout, 0, "a loss was read as a best payout");
    eq(b.bestMultiple, 0);
    const trimmed = Rules.bestWinningRound({ rounds: [], largestPayout: 9000 });
    eq(trimmed.bestPayout, 9000, "a trimmed session lost its largestPayout fallback");
    assert(trimmed.bestMultiple > 0, "the fallback reported no multiple");
    return "losses ignored, trimmed sessions fall back to largestPayout";
  });

  check("the quest detail formats big numbers", () => {
    const r = Rules.simulateCampaignResult({
      netResult: 0, wins: 1, losses: 0,
      rounds: [{ result: "WIN", payout: 18000, riskAmount: 10000 }]
    }, { rivals: [{ net: 0, predictions: 1, bestPayout: 0 }], fieldSize: 2 });
    const smasher = r.quests.find(q => q.id === "SMASHER_QUEST");
    assert(smasher, "a ×1.8 win on 10,000 did not reach The Smasher");
    eq(smasher.detail, "1.8x on one call (+18,000)", "quest detail");
  });

  check("the summary screen renders the comparison panel", () => {
    app.Game.startSession();
    for (let i = 0; i < 2; i++) {
      app.Game.selectPrediction("UP");
      app.Game.selectRisk(1000);
      app.Game.reviewPrediction();
      app.Game.lockInPrediction();
      window.clearInterval(app.Round.timerId);
      app.Round.resolve();
    }
    app.Game.endSession();
    const s = app.STATE.history[0];
    assert(s.campaign, "endSession() did not archive a campaign comparison");
    app.UI.renderSummary(s);
    const root = doc.getElementById("campaignSimRoot");
    assert(root, "#campaignSimRoot is missing from index.html");
    const txt = root.textContent;
    assert(root.querySelector(".campaign-sim"), "the panel did not render");
    assert(/#\d+/.test(txt), "no rank shown: " + txt.slice(0, 120));
    assert(txt.indexOf("If you performed like this in the real CADE Meme Madness") !== -1,
      "the headline sentence is missing");
    return "rank #" + s.campaign.rank + " of " + s.campaign.fieldSize;
  });

  check("no dollar figure appears without the disclaimer beside it", () => {
    /* The whole panel hangs on this. A prize number on a results screen reads as
       a promise unless it is fenced, so the badge and the full disclaimer are
       treated as part of the number, not decoration. */
    const root = doc.getElementById("campaignSimRoot");
    const txt = root.textContent;
    assert(/\$\d/.test(txt) || /NO PRIZE/.test(txt), "the panel shows neither a prize nor NO PRIZE");
    const badge = root.querySelector(".sim-badge");
    assert(badge && /SIMULATED/.test(badge.textContent), "the SIMULATED badge is missing");
    const disc = root.querySelector(".campaign-disclaimer");
    assert(disc, ".campaign-disclaimer is missing from the panel");
    for (const phrase of ["Simulated comparison", "not affiliated", "not a real", "guaranteed"]) {
      assert(disc.textContent.indexOf(phrase) !== -1,
        "the disclaimer no longer says " + JSON.stringify(phrase));
    }
    eq(disc.textContent.trim(), Rules.CAMPAIGN_DISCLAIMER,
      "the panel paraphrases the disclaimer instead of printing it");
    return disc.textContent.length + " chars, verbatim from rules.js";
  });

  check("re-opening a run from history shows the same rank, not a fresh roll", () => {
    const s = app.STATE.history[0];
    const first = JSON.stringify(s.campaign);
    app.UI.renderSummary(s);
    app.UI.renderSummary(s);
    eq(JSON.stringify(s.campaign), first, "the comparison was re-rolled on re-view");
    // A session archived before the panel existed gets one rolled once, then kept.
    delete s.campaign;
    app.UI.renderSummary(s);
    assert(s.campaign, "a legacy session got no comparison at all");
    const backfilled = JSON.stringify(s.campaign);
    app.UI.renderSummary(s);
    eq(JSON.stringify(s.campaign), backfilled, "the backfilled comparison was re-rolled");
    const persisted = JSON.parse(window.localStorage.getItem("cade_meme_madness_v1"));
    assert(persisted.history[0].campaign, "the backfilled comparison was not persisted");
    return "stable across 4 renders";
  });

  check("the CSS covers every class the panel emits", () => {
    const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
    const classes = ["campaign-sim", "campaign-head", "sim-badge", "campaign-rank",
      "campaign-headline", "campaign-quests", "campaign-quest", "campaign-disclaimer",
      "session-clock", "session-len-note"];
    const missing = classes.filter(c => css.indexOf("." + c) === -1);
    assert(missing.length === 0, "unstyled: " + missing.join(", "));
    return classes.length + " classes styled";
  });

  group("20. Nothing accumulated errors during the whole run");
  check("no jsdomError at any point", () => {
    assert(pageErrors.length === 0, pageErrors.slice(0, 3).join("\n      "));
  });
  check("no console.error at any point", () => {
    assert(consoleErrors.length === 0, consoleErrors.slice(0, 3).join("\n      "));
  });

  /* ---------------- report ---------------- */
  console.log("\n" + "=".repeat(60));
  if (failures.length === 0) {
    console.log("PASS — " + passed + " checks, 0 failures");
    process.exit(0);
  }
  console.log("FAIL — " + passed + " passed, " + failures.length + " failed\n");
  failures.forEach(f => console.log("  ✗ " + f.name + "\n      " + f.message));
  process.exit(1);
})().catch(err => {
  console.error("\nHARNESS CRASHED\n", err);
  process.exit(3);
});
