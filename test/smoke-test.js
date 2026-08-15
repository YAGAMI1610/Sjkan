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
   message is easy to miss. Collect them for §16 rather than letting the process
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
  AssetManager, Ceremony, Records, Awards, ShareCard, Confetti, COIN_POOL,
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
  app.Game.lockInPrediction();
  await tick(5);
  check("lock-in freezes the controls and shows the banner", () => {
    assert($("#lockedBanner").style.display !== "none", "locked banner hidden");
    eq($("#upBtn").disabled, true, "UP button still live after lock-in");
    eq(app.Round.locked, true);
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
    const before = app.STATE.balance;
    window.clearInterval(app.Round.timerId);
    app.Round.resolve();
    await tick(30);
    const r = app.STATE.session.rounds[app.STATE.session.rounds.length - 1];
    check("round was recorded", () => assert(r, "no round record after resolve()"));
    check("balance moved by exactly the round's payout", () => {
      assert(Number.isFinite(app.STATE.balance), "balance is not finite: " + app.STATE.balance);
      eq(app.STATE.balance, before + r.payout, "balance " + before + " + payout " + r.payout);
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

  group("16. Nothing accumulated errors during the whole run");
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
