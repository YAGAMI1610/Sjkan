#!/usr/bin/env node
/* =====================================================
   CADE MEME MADNESS — Terminal Edition
   -----------------------------------------------------
   The same game as index.html, played in a terminal.

   "The same game" is meant literally: every number that decides an outcome —
   the weighted outcome table, the payout multiplier, the daily allowance, the
   award thresholds, the coin pools — comes from ./rules.js, which is the exact
   file the browser loads as a <script> and the reference backend require()s.
   Nothing about the rules is re-implemented here. This file is a front end: it
   reads input, draws boxes, and persists state.

   Two things genuinely differ from the browser build, both because a terminal
   is not a browser:

     - Persistence is a JSON file (localStorage does not exist here). It is
       written atomically — temp file + rename — because a CLI can be Ctrl-C'd
       mid-write and a half-written save file would lose a player's whole
       history. localStorage cannot be torn like that.
     - The 25-second round timer is a *decision* window, exactly as in the app:
       you have ROUND_SECONDS to choose a direction and a stake, and a round you
       don't answer in time resolves as SKIPPED. It is not a 25-second wait.

   Every command runs non-interactively too (`--json` prints one machine-readable
   object and nothing else), which is what makes the production QA suite in
   test/cli-test.js able to drive real gameplay and assert on real results.

   Usage:  node cli.js [command] [flags]      (`node cli.js help` for the list)
   ===================================================== */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const Rules = require("./rules.js");
const CONFIG = Rules.CONFIG;

const VERSION = "1.0.0";

/* =========================================================
   ARGV
   Parsed once, up front. `--flag value`, `--flag=value` and bare `--flag`
   (boolean) are all accepted; everything else is a positional.
   ========================================================= */
function parseArgv(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; }
    else flags[key] = true;
  }
  return { flags, positional };
}

const { flags: FLAGS, positional: POSITIONAL } = parseArgv(process.argv.slice(2));
const COMMAND = (POSITIONAL[0] || "").toLowerCase();
const JSON_MODE = !!FLAGS.json;


/* =========================================================
   COLOUR — the CADE palette, as truecolor ANSI
   Disabled for pipes, for NO_COLOR, for --no-color and for --json, so captured
   output is never polluted with escape sequences.
   ========================================================= */
const USE_COLOR =
  !JSON_MODE &&
  !FLAGS["no-color"] &&
  !process.env.NO_COLOR &&
  process.stdout.isTTY === true;

function ansi(code) { return USE_COLOR ? code : ""; }
function rgb(r, g, b) { return ansi(`\x1b[38;2;${r};${g};${b}m`); }

const C = {
  reset: ansi("\x1b[0m"),
  bold: ansi("\x1b[1m"),
  dim: ansi("\x1b[2m"),
  purple: rgb(123, 63, 228),
  yellow: rgb(255, 210, 63),
  orange: rgb(255, 122, 41),
  green: rgb(63, 207, 110),
  red: rgb(255, 79, 79),
  cream: rgb(255, 248, 236),
  grey: rgb(150, 145, 138)
};

const out = [];               // buffered plain lines, for --json diagnostics
function say(line) {
  if (JSON_MODE) return;
  out.push(line);
  process.stdout.write(line + "\n");
}
function blank() { say(""); }

/** Every command's single exit point. In --json mode the payload is the only
 *  thing on stdout, so a caller can `JSON.parse` it without stripping banners. */
function emit(payload, code) {
  if (JSON_MODE) process.stdout.write(JSON.stringify(payload) + "\n");
  process.exitCode = code || 0;
  return payload;
}
function fail(message, code) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  else process.stderr.write(C.red + "✗ " + message + C.reset + "\n");
  process.exit(code === undefined ? 1 : code);
}

/* =========================================================
   SEEDING
   Deliberately placed below fail(): `fail` reaches for the C palette and
   JSON_MODE, both `const`, so calling it from above their declarations dies in
   the temporal dead zone — a usage error would surface as a ReferenceError and
   exit 1 instead of 2. It still runs before loadState() and before any command,
   which is all `Math.random` interception needs.

   --seed is what makes a run reproducible, and reproducibility is the only way
   to assert on outcomes rather than on ranges. rules.js reads the global
   Math.random at call time, so replacing it here makes every shared rule
   function deterministic without the rules knowing seeding exists.
   ========================================================= */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
if (FLAGS.seed !== undefined) {
  const seed = Number(FLAGS.seed);
  if (FLAGS.seed === true || !Number.isFinite(seed)) {
    fail("--seed needs a number, e.g. --seed 42.", 2);
  }
  Math.random = mulberry32(seed);
}

/* =========================================================
   FORMATTING
   ========================================================= */
const fmt = n => Math.round(Number(n) || 0).toLocaleString("en-US");
const signed = n => (n >= 0 ? "+" : "") + fmt(n);

/** Visible width, ignoring ANSI escapes and counting emoji as two columns —
 *  otherwise every box containing a coin emoji closes one column early. */
function width(str) {
  const bare = String(str).replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of bare) {
    const cp = ch.codePointAt(0);
    if (cp === 0xFE0F || cp === 0x200D) continue;                 // variation selector / ZWJ
    if (cp >= 0x1F300 || (cp >= 0x2600 && cp <= 0x27BF)) w += 2;  // emoji & symbols
    else w += 1;
  }
  return w;
}
function pad(str, n) { return str + " ".repeat(Math.max(0, n - width(str))); }

const BOX_W = 62;
function rule(ch) { say(C.grey + (ch || "─").repeat(BOX_W) + C.reset); }
function box(title, lines) {
  const t = " " + title + " ";
  const left = 2;
  const right = Math.max(0, BOX_W - 2 - left - width(t));
  say(C.purple + "┌" + "─".repeat(left) + C.reset + C.bold + t + C.reset +
      C.purple + "─".repeat(right) + "┐" + C.reset);
  for (const l of lines) {
    say(C.purple + "│" + C.reset + " " + pad(l, BOX_W - 4) + " " + C.purple + "│" + C.reset);
  }
  say(C.purple + "└" + "─".repeat(BOX_W - 2) + "┘" + C.reset);
}

const SPARK = "▁▂▃▄▅▆▇█";
function sparkline(points) {
  if (!Array.isArray(points) || !points.length) return "";
  const lo = Math.min(...points), hi = Math.max(...points);
  const span = hi - lo || 1;
  return points.map(p => SPARK[Math.min(SPARK.length - 1,
    Math.floor(((p - lo) / span) * (SPARK.length - 1)))]).join("");
}

function bar(pct, cells) {
  const n = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return "█".repeat(n) + C.grey + "░".repeat(cells - n) + C.reset;
}

function banner() {
  if (JSON_MODE) return;
  blank();
  say(C.purple + C.bold + "  ╔═══════════════════════════════════════════════════════╗" + C.reset);
  say(C.purple + C.bold + "  ║   " + C.yellow + "CADE MEME MADNESS" + C.cream + "  ·  TERMINAL EDITION" + C.purple + "          ║" + C.reset);
  say(C.purple + C.bold + "  ╚═══════════════════════════════════════════════════════╝" + C.reset);
  say(C.grey + "   100% simulated points. No real money, no real coins." + C.reset);
  blank();
}

/* =========================================================
   STORE — JSON persistence
   Same state shape as the browser's localStorage payload, so a save file could
   be handed to the web build (or the reverse) without translation.
   ========================================================= */
const DATA_FILE = (() => {
  if (typeof FLAGS.data === "string") return path.resolve(FLAGS.data);
  if (process.env.CADE_DATA) return path.resolve(process.env.CADE_DATA);
  return path.join(os.homedir(), ".cade-meme-madness.json");
})();

function defaultState() {
  return {
    schema: 1,
    userId: "user_" + Math.random().toString(36).slice(2, 10),
    balance: 0,
    lastClaim: null,
    boosts: { profile: false, share: false, submit: false, vote: false },
    session: null,
    history: [],
    records: {
      highestBalance: 0, biggestPayout: 0, bestWinRate: 0,
      longestStreak: 0, mostRounds: 0, mostRisked: 0,
      // null, not -Infinity: -Infinity serialises to null through JSON anyway,
      // and `net > null` silently reads as `net > 0`, so a first session that
      // finished down would never be recorded as the best one.
      bestSessionId: null, bestSessionNet: null
    },
    leaderboard: null,
    votes: null,
    submittedMemes: []
  };
}

let STATE = loadState();

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const merged = Object.assign(defaultState(), parsed);
    // Nested objects need their own merge or a save file written by an older
    // version arrives with fields missing and every read of them is undefined.
    merged.boosts = Object.assign(defaultState().boosts, parsed.boosts || {});
    merged.records = Object.assign(defaultState().records, parsed.records || {});
    if (!Array.isArray(merged.history)) merged.history = [];
    if (!Array.isArray(merged.submittedMemes)) merged.submittedMemes = [];
    return merged;
  } catch (e) {
    // Missing file is the normal first run. A corrupt one is not: refusing to
    // start beats silently resetting somebody's history to zero.
    if (e && e.code === "ENOENT") return defaultState();
    if (e instanceof SyntaxError) {
      fail("save file is corrupt: " + DATA_FILE + "\n  Move it aside or run: node cli.js reset --yes", 3);
    }
    fail("could not read save file: " + e.message, 3);
  }
}

/** Atomic save. A CLI can be killed at any instant; writing in place would give
 *  a truncated file and lose everything. Temp file + rename is atomic on POSIX,
 *  so the save is either the old one or the new one, never half of each. */
function saveState() {
  const dir = path.dirname(DATA_FILE);
  const tmp = path.join(dir, ".cade-" + process.pid + "-" + Date.now() + ".tmp");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(STATE, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* nothing to clean up */ }
    return false;
  }
}

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Rules.randInt(100, 999);
}

// A round record only needs its chart while that round is on screen. Keeping
// 24 floats per round of every session is what makes a save file grow forever.
function trimRoundForStorage(round) {
  if (round && round.coin && round.coin.history) delete round.coin.history;
  return round;
}

/* =========================================================
   GAME — mirrors app.js Game/Records/Leaderboard, minus the DOM
   ========================================================= */
const Game = {
  claimCooldownLeft() {
    if (!STATE.lastClaim) return 0;
    return Math.max(0, CONFIG.DAILY_CLAIM_WINDOW_MS - (Date.now() - STATE.lastClaim));
  },

  claimDaily() {
    const left = this.claimCooldownLeft();
    if (left > 0) return { ok: false, error: "already-claimed", cooldownMs: left };
    STATE.balance += CONFIG.DAILY_POINTS;
    STATE.lastClaim = Date.now();
    saveState();
    return { ok: true, claimed: CONFIG.DAILY_POINTS, balance: STATE.balance };
  },

  boost(id) {
    const def = CONFIG.BOOST_ACTIONS.find(b => b.id === id);
    if (!def) return { ok: false, error: "unknown-boost" };
    if (STATE.boosts[id]) return { ok: false, error: "already-claimed" };
    STATE.boosts[id] = true;
    STATE.balance += def.reward;
    saveState();
    return { ok: true, awarded: def.reward, balance: STATE.balance, label: def.label };
  },

  startSession() {
    if (STATE.session) return { ok: false, error: "session-active", sessionId: STATE.session.sessionId };
    if (STATE.balance <= 0) return { ok: false, error: "no-points" };
    STATE.session = {
      sessionId: uid("sess"),
      userId: STATE.userId,
      startedAt: Date.now(),
      endedAt: null,
      startingBalance: STATE.balance,
      endingBalance: STATE.balance,
      rounds: [],
      wins: 0, losses: 0,
      totalRisked: 0, totalProfit: 0, totalLoss: 0,
      largestRisk: 0, largestPayout: 0,
      currentStreak: 0, longestWinStreak: 0,
      awards: [],
      coinsEncountered: []
    };
    saveState();
    return { ok: true, session: STATE.session };
  },

  endSession() {
    const s = STATE.session;
    if (!s) return { ok: false, error: "no-session" };
    s.endedAt = Date.now();
    s.endingBalance = STATE.balance;
    s.totalRounds = s.rounds.length;
    s.winRate = s.totalRounds ? (s.wins / s.totalRounds * 100) : 0;
    s.netResult = s.endingBalance - s.startingBalance;
    s.awards = Rules.calculateAwards(s);

    if (Array.isArray(s.rounds)) s.rounds.forEach(trimRoundForStorage);
    STATE.history.unshift(s);
    if (STATE.history.length > CONFIG.HISTORY_LIMIT) STATE.history.length = CONFIG.HISTORY_LIMIT;
    Records.update(s);
    STATE.session = null;
    saveState();
    return { ok: true, session: s };
  },

  /** Deal a coin for the next round. The outcome is rolled here and returned
   *  separately so a caller can show the coin without holding the result. */
  dealRound() {
    const s = STATE.session;
    if (!s) return null;
    const coin = Rules.generateCoin();
    if (!s.coinsEncountered.includes(coin.ticker)) s.coinsEncountered.push(coin.ticker);
    return { coin, outcome: Rules.generateOutcome(), roundNum: s.rounds.length + 1 };
  },

  /** Score and record one round. `prediction` may be null (a round the player
   *  let the clock run out on), which the shared rule scores as SKIPPED. */
  resolveRound(dealt, prediction, riskAmount) {
    const s = STATE.session;
    if (!s) return { ok: false, error: "no-session" };

    const risk = Math.max(0, Math.floor(Number(riskAmount) || 0));
    const outcome = dealt.outcome;
    // Direction is always re-derived from the sign of the percentage, never
    // stored alongside it, so "went DOWN (+0.32%)" is unrepresentable.
    outcome.dir = Rules.dirFromPct(outcome.pctVal);

    const scored = Rules.scoreRound(prediction, outcome.dir, risk);
    const hasPrediction = scored.result !== "SKIPPED";

    if (hasPrediction) {
      STATE.balance += scored.payout;
      if (scored.result === "WIN") {
        s.wins++;
        s.totalProfit += scored.profit;
        s.currentStreak++;
        s.longestWinStreak = Math.max(s.longestWinStreak, s.currentStreak);
        if (scored.profit > s.largestPayout) s.largestPayout = scored.profit;
      } else {
        s.losses++;
        s.totalLoss += scored.loss;
        s.currentStreak = 0;
      }
      s.totalRisked += risk;
      if (risk > s.largestRisk) s.largestRisk = risk;
    }

    const record = {
      roundId: uid("r"),
      coin: dealt.coin,
      prediction: hasPrediction ? prediction : null,
      riskAmount: hasPrediction ? risk : 0,
      potentialProfit: hasPrediction ? Math.round(risk * scored.multiplier) : 0,
      potentialLoss: hasPrediction ? risk : 0,
      actualOutcome: outcome.key,
      actualDir: outcome.dir,
      pctMove: outcome.pctVal,
      result: scored.result,
      payout: scored.payout,
      timestamp: Date.now()
    };
    s.rounds.push(record);
    Leaderboard.simulateTick();
    saveState();
    return { ok: true, round: record, balance: STATE.balance };
  },

  submitMeme(name, ticker) {
    if (!name || !ticker) return { ok: false, error: "missing-fields" };
    if (STATE.boosts.submit) return { ok: false, error: "already-submitted" };
    const qualifies = Math.random() < 0.6;
    const meme = { name, ticker: String(ticker).toUpperCase(), at: Date.now(), qualifies };
    STATE.submittedMemes.push(meme);
    STATE.boosts.submit = true;
    const awarded = Rules.boostReward("submit");
    STATE.balance += awarded;
    saveState();
    return { ok: true, meme, qualifies, awarded, balance: STATE.balance };
  }
};

const Records = {
  update(s) {
    const r = STATE.records;
    r.highestBalance = Math.max(r.highestBalance, s.endingBalance);
    r.biggestPayout = Math.max(r.biggestPayout, s.largestPayout);
    r.bestWinRate = Math.max(r.bestWinRate, s.winRate);
    r.longestStreak = Math.max(r.longestStreak, s.longestWinStreak);
    r.mostRounds = Math.max(r.mostRounds, s.totalRounds);
    r.mostRisked = Math.max(r.mostRisked, s.totalRisked);
    if (r.bestSessionNet === null || r.bestSessionNet === undefined || s.netResult > r.bestSessionNet) {
      r.bestSessionNet = s.netResult;
      r.bestSessionId = s.sessionId;
    }
  }
};

const Leaderboard = {
  ensure() {
    if (STATE.leaderboard && Array.isArray(STATE.leaderboard.players)) return;
    STATE.leaderboard = {
      players: Rules.SIM_PLAYERS_BASE.map(p => Object.assign({}, p, {
        points: Rules.randInt(15000, 60000),
        wins: Rules.randInt(10, 80),
        losses: Rules.randInt(5, 60),
        biggestPayout: Rules.randInt(1000, 9000),
        streak: Rules.randInt(0, 8)
      }))
    };
    saveState();
  },
  simulateTick() {
    this.ensure();
    for (const p of STATE.leaderboard.players) {
      if (Math.random() < 0.5) {
        const delta = Rules.randInt(-800, 1400);
        p.points = Math.max(0, p.points + delta);
        if (delta > 0) p.wins++; else p.losses++;
      }
    }
  },
  getRanked(category) {
    this.ensure();
    const s = STATE.session;
    const me = {
      name: "YOU", avatar: "🧑‍🚀", isMe: true,
      points: STATE.balance,
      wins: s ? s.wins : ((STATE.history[0] && STATE.history[0].wins) || 0),
      losses: s ? s.losses : ((STATE.history[0] && STATE.history[0].losses) || 0),
      biggestPayout: Math.max(STATE.records.biggestPayout, 0),
      streak: s ? s.currentStreak : 0,
      winRate: s && s.rounds.length ? (s.wins / s.rounds.length * 100) : (STATE.records.bestWinRate || 0)
    };
    // The parenthesis matters: `wins/(wins+losses||1)` parses as
    // `wins/(wins + (losses||1))`, which showed a 5W/0L player as 83%.
    const all = STATE.leaderboard.players
      .map(p => Object.assign({}, p, { winRate: (p.wins / ((p.wins + p.losses) || 1)) * 100 }))
      .concat([me]);
    const keyMap = {
      points: p => p.points,
      payout: p => p.biggestPayout,
      wins: p => p.wins,
      winrate: p => p.winRate,
      streak: p => p.streak
    };
    const k = keyMap[category] || keyMap.points;
    return all.sort((a, b) => k(b) - k(a));
  }
};

const ShareCard = {
  buildText(s) {
    if (!s) return "I just played CADE Meme Madness!";
    let text = "I just finished a CADE Meme Madness run 🤯\n\n";
    text += `${s.totalRounds} rounds\n${Math.round(s.winRate)}% win rate\n` +
            `${fmt(s.endingBalance)} final points\n${signed(s.netResult)} net\n`;
    if (s.largestPayout) text += `+${fmt(s.largestPayout)} biggest payout\n`;
    text += "\n";
    Rules.awardsOf(s).forEach(a => { text += `${a.icon} ${a.title}\n`; });
    text += "\nCan you beat my score?";
    return text;
  }
};

/* =========================================================
   RENDER
   ========================================================= */
function renderCoin(coin, roundNum) {
  const arrow = coin.move >= 0 ? "▲" : "▼";
  const col = coin.move >= 0 ? C.green : C.red;
  box("ROUND " + String(roundNum).padStart(2, "0"), [
    `${coin.emoji}  ${C.bold}$${coin.ticker}${C.reset}` +
      (coin.isGenerated ? `  ${C.yellow}NEW${C.reset}` : ""),
    `${C.grey}price${C.reset}  $${coin.price.toFixed(6)}   ` +
      `${col}${arrow} ${Math.abs(coin.move).toFixed(2)}%${C.reset} ${C.grey}24h${C.reset}`,
    `${C.purple}${sparkline(coin.history)}${C.reset}`
  ]);
}

function renderResult(round, balanceBefore, skipReason) {
  const won = round.result === "WIN";
  const skipped = round.result === "SKIPPED";
  const col = skipped ? C.grey : won ? C.green : C.red;
  const head = skipped ? "NO PREDICTION" : won ? "YOU WIN" : "YOU LOSE";
  const arrow = round.actualDir === "UP" ? "▲" : "▼";
  const lines = [
    `${col}${C.bold}${head}${C.reset}`,
    `$${round.coin.ticker} went ${round.actualDir} ${arrow} ` +
      `${round.pctMove >= 0 ? "+" : ""}${round.pctMove.toFixed(2)}%  ${C.grey}(${round.actualOutcome})${C.reset}`
  ];
  if (!skipped) {
    lines.push(`you predicted ${round.prediction} · staked ${fmt(round.riskAmount)}`);
    lines.push(`${col}${signed(round.payout)} points${C.reset}   ` +
      `${C.grey}${fmt(balanceBefore)} → ${C.reset}${C.bold}${fmt(balanceBefore + round.payout)}${C.reset}`);
  } else {
    const why = skipReason === "timeout"
      ? "the clock ran out"
      : "no prediction was locked in";
    lines.push(`${C.grey}${why} — nothing staked, nothing lost${C.reset}`);
  }
  box("RESULT", lines);
}

function renderSessionSummary(s) {
  const col = s.netResult >= 0 ? C.green : C.red;
  box("SESSION COMPLETE", [
    `${C.grey}rounds${C.reset}      ${s.totalRounds}`,
    `${C.grey}record${C.reset}      ${C.green}${s.wins}W${C.reset} / ${C.red}${s.losses}L${C.reset}   ` +
      `${Math.round(s.winRate)}% ${bar(s.winRate, 20)}`,
    `${C.grey}staked${C.reset}      ${fmt(s.totalRisked)}`,
    `${C.grey}best hit${C.reset}    ${fmt(s.largestPayout)}`,
    `${C.grey}streak${C.reset}      ${s.longestWinStreak}`,
    `${C.grey}balance${C.reset}     ${fmt(s.startingBalance)} → ${C.bold}${fmt(s.endingBalance)}${C.reset}`,
    `${C.grey}net${C.reset}         ${col}${C.bold}${signed(s.netResult)}${C.reset}`
  ]);
  const awards = Rules.awardsOf(s);
  if (awards.length) {
    blank();
    box("AWARDS EARNED", awards.map(a => `${a.icon}  ${C.bold}${a.title}${C.reset} ${C.grey}— ${a.desc}${C.reset}`));
  }
}

/* =========================================================
   PROMPTS
   -----------------------------------------------------
   One readline interface for the whole process, plus a queue of lines it has
   read that nothing has asked for yet.

   Both halves are load-bearing, and both were bugs first:

     - A fresh interface per prompt does not work. readline reads stdin
       greedily, so by the time it hands you the first line it has buffered
       whatever else arrived; closing it discards that buffer, the next
       interface opens on an exhausted stdin, and every later prompt resolves
       as "closed". Interactively it looked like the game quit itself after one
       answer.
     - A single interface with a listener attached per prompt does not work
       either. Lines that arrive while no prompt is open — during the moment
       spent rendering a result card, or when input is piped in faster than the
       prompts appear — are emitted to nobody and lost.

   So lines are always consumed, into LINES if no one is waiting, and ask()
   checks that queue before it waits. Typing ahead is then answered in order
   rather than thrown away.

   The queue is also what makes the round deadline safe: a timed-out prompt
   removes its waiter, so a line finished one second late is queued for the next
   question instead of being applied to the round that already resolved.
   ========================================================= */
let RL = null;
let RL_CLOSED = false;
const LINES = [];     // input read but not yet asked for
const WAITERS = [];   // ask() calls currently waiting for a line

function getRL() {
  if (!RL) {
    RL = readline.createInterface({ input: process.stdin, output: process.stdout });
    RL.on("line", line => {
      const text = String(line).trim();
      const waiter = WAITERS.shift();
      if (waiter) waiter({ answer: text });
      else LINES.push(text);
    });
    RL.on("close", () => {
      RL_CLOSED = true;
      while (WAITERS.length) WAITERS.shift()({ closed: true });
    });
    // readline swallows Ctrl-C while a prompt is open; re-raise it so the
    // process-level handler can restore the terminal.
    RL.on("SIGINT", () => process.emit("SIGINT"));
  }
  return RL;
}
function closeRL() {
  if (RL) { RL.close(); RL = null; }
}

/** Resolves to one of:
 *    { answer }    the line the player typed
 *    { timedOut }  opts.deadline passed before a line arrived
 *    { closed }    stdin ended and the queue is empty */
function ask(question, opts) {
  opts = opts || {};
  const rl = getRL();

  if (LINES.length) {
    const answer = LINES.shift();
    // A terminal has already echoed what was typed; a pipe has not.
    process.stdout.write(question + (process.stdin.isTTY ? "" : answer) + "\n");
    return Promise.resolve({ answer });
  }
  if (RL_CLOSED) return Promise.resolve({ closed: true });

  return new Promise(resolve => {
    let settled = false;
    let timer = null;
    function waiter(value) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      rl.setPrompt("");
      resolve(value);
    }
    WAITERS.push(waiter);

    if (opts.deadline) {
      const ms = opts.deadline - Date.now();
      if (ms <= 0) {
        WAITERS.splice(WAITERS.indexOf(waiter), 1);
        waiter({ timedOut: true });
        return;
      }
      timer = setTimeout(() => {
        const i = WAITERS.indexOf(waiter);
        if (i !== -1) WAITERS.splice(i, 1);
        /* Order matters. Clearing the prompt first means readline's redraw after
           the Ctrl-U reprints nothing — otherwise the expired question appears a
           second time on the same line. Then wipe the line the prompt was on. */
        rl.setPrompt("");
        if (typeof rl.write === "function") {
          try { rl.write(null, { ctrl: true, name: "u" }); } catch (_) { /* not a terminal */ }
        }
        if (process.stdout.isTTY) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
        } else {
          process.stdout.write("\n");
        }
        waiter({ timedOut: true });
      }, ms);
    }

    // setPrompt + prompt rather than a raw write: readline needs the prompt's
    // width or its line editing draws over it.
    rl.setPrompt(question);
    rl.prompt();
  });
}

const PROMPT = () => C.yellow + "› " + C.reset;
const secondsLeft = deadline => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

/* `play` is a conversation, so it needs somewhere to read answers from. A
   terminal is the normal case; --script accepts them on stdin instead, which is
   how a run gets replayed from a file (and how the QA suite exercises this loop
   at all — no portable test can allocate a pty). Without either, blocking on a
   prompt that can never be answered would hang forever, so refuse up front. */
function requireInteractive() {
  if (process.stdin.isTTY || FLAGS.script) return;
  fail("`play` needs a terminal, or --script to read answers from stdin.\n" +
       "  For scripted play use:  node cli.js session start && node cli.js round --predict UP --risk 500\n" +
       "  Or pipe answers in:     printf 'up\\n500\\ny\\n\\nq\\n' | node cli.js play --script", 2);
}

/* =========================================================
   COMMANDS
   ========================================================= */
const Commands = {};

Commands.help = function () {
  if (JSON_MODE) return emit({ ok: true, version: VERSION, commands: Object.keys(Commands).sort() });
  banner();
  say(`${C.bold}USAGE${C.reset}  node cli.js <command> [flags]`);
  blank();
  const rows = [
    ["play", "start an interactive run (the full game)"],
    ["status", "balance, streak, active session, daily claim"],
    ["claim", "collect the daily " + fmt(CONFIG.DAILY_POINTS) + " points"],
    ["boost [id]", "one-time point boosts; no id lists them"],
    ["session start|end|status", "manage a run without playing interactively"],
    ["round", "play one round: --predict UP|DOWN --risk N"],
    ["", C.grey + "(omitting --predict resolves it as SKIPPED)" + C.reset],
    ["records", "all-time personal bests"],
    ["history", "past sessions  [--limit N] [--id <sessionId>]"],
    ["leaderboard", "standings  [--sort points|payout|wins|winrate|streak]"],
    ["vote", "vote in Meme Madness  [--pick 1-4]"],
    ["submit", "submit a coin: --name \"X\" --ticker Y"],
    ["share", "share text for a run  [--id <sessionId>]"],
    ["rules", "the rule tables this build plays by"],
    ["reset", "erase local save data  [--yes]"],
    ["version", "print the version"]
  ];
  for (const [cmd, desc] of rows) say("  " + C.yellow + pad(cmd, 26) + C.reset + C.grey + desc + C.reset);
  blank();
  say(`${C.bold}GLOBAL FLAGS${C.reset}`);
  for (const [f, d] of [
    ["--json", "print one machine-readable object, nothing else"],
    ["--seed N", "deterministic RNG (reproducible runs)"],
    ["--script", "`play` reads its answers from stdin, not a terminal"],
    ["--data PATH", "use a specific save file (default " + DATA_FILE + ")"],
    ["--no-color", "disable ANSI colour"]
  ]) say("  " + C.yellow + pad(f, 26) + C.reset + C.grey + d + C.reset);
  blank();
  return emit({ ok: true });
};

Commands.version = function () {
  if (JSON_MODE) return emit({ ok: true, version: VERSION, rules: { multiplier: CONFIG.PAYOUT_MULTIPLIER } });
  say("cade-meme-madness " + VERSION);
  return emit({ ok: true });
};

Commands.status = function () {
  const cooldown = Game.claimCooldownLeft();
  const s = STATE.session;
  const payload = {
    ok: true,
    balance: STATE.balance,
    canClaim: cooldown === 0,
    cooldownMs: cooldown,
    boosts: STATE.boosts,
    session: s ? {
      sessionId: s.sessionId, rounds: s.rounds.length, wins: s.wins, losses: s.losses,
      currentStreak: s.currentStreak, netSoFar: STATE.balance - s.startingBalance
    } : null,
    sessionsPlayed: STATE.history.length,
    dataFile: DATA_FILE
  };
  if (JSON_MODE) return emit(payload);

  banner();
  const lines = [
    `${C.grey}balance${C.reset}      ${C.bold}${C.yellow}${fmt(STATE.balance)}${C.reset} points`,
    `${C.grey}daily${C.reset}        ` + (cooldown === 0
      ? `${C.green}ready — run "claim"${C.reset}`
      : `${C.grey}next in ${formatDuration(cooldown)}${C.reset}`),
    `${C.grey}sessions${C.reset}     ${STATE.history.length} played`
  ];
  if (s) {
    lines.push(`${C.grey}live run${C.reset}     round ${s.rounds.length + 1} · ` +
      `${C.green}${s.wins}W${C.reset}/${C.red}${s.losses}L${C.reset} · streak ${s.currentStreak} · ` +
      `net ${signed(STATE.balance - s.startingBalance)}`);
  }
  const unclaimed = CONFIG.BOOST_ACTIONS.filter(b => !STATE.boosts[b.id]);
  if (unclaimed.length) {
    lines.push(`${C.grey}boosts${C.reset}       ${unclaimed.length} unclaimed ` +
      `${C.grey}(${fmt(unclaimed.reduce((a, b) => a + b.reward, 0))} points available)${C.reset}`);
  }
  box("YOUR ACCOUNT", lines);
  say(C.grey + "  save file: " + DATA_FILE + C.reset);
  blank();
  return emit(payload);
};

function formatDuration(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

Commands.claim = function () {
  const res = Game.claimDaily();
  if (!res.ok) {
    if (JSON_MODE) return emit(res, 1);
    fail("Already claimed. Next drop in " + formatDuration(res.cooldownMs) + ".");
  }
  if (JSON_MODE) return emit(res);
  say(C.green + C.bold + "  +" + fmt(res.claimed) + " POINTS CLAIMED!" + C.reset);
  say(C.grey + "  balance: " + C.reset + C.bold + fmt(res.balance) + C.reset);
  return emit(res);
};

Commands.boost = function () {
  const id = POSITIONAL[1];
  if (!id) {
    const list = CONFIG.BOOST_ACTIONS.map(b => ({
      id: b.id, label: b.label, reward: b.reward, claimed: !!STATE.boosts[b.id]
    }));
    if (JSON_MODE) return emit({ ok: true, boosts: list, balance: STATE.balance });
    box("POINT BOOSTS", list.map(b =>
      `${b.claimed ? C.green + "✓" : C.yellow + "○"}${C.reset} ` +
      `${pad(b.id, 9)}${C.grey}+${pad(fmt(b.reward), 7)}${C.reset}${b.label}`));
    say(C.grey + "  claim with: node cli.js boost <id>" + C.reset);
    return emit({ ok: true, boosts: list });
  }
  const res = Game.boost(id);
  if (!res.ok) {
    if (JSON_MODE) return emit(res, 1);
    fail(res.error === "unknown-boost"
      ? "Unknown boost \"" + id + "\". Run `node cli.js boost` to list them."
      : "That boost was already claimed.");
  }
  if (JSON_MODE) return emit(res);
  say(C.green + C.bold + "  +" + fmt(res.awarded) + C.reset + "  " + res.label);
  say(C.grey + "  balance: " + C.reset + C.bold + fmt(res.balance) + C.reset);
  return emit(res);
};

Commands.session = function () {
  const sub = (POSITIONAL[1] || "status").toLowerCase();

  if (sub === "start") {
    const res = Game.startSession();
    if (!res.ok) {
      if (JSON_MODE) return emit(res, 1);
      fail(res.error === "no-points"
        ? "You have no points. Run `node cli.js claim` first."
        : "A session is already running (" + res.sessionId + "). End it first.");
    }
    if (JSON_MODE) return emit({ ok: true, sessionId: res.session.sessionId, startingBalance: res.session.startingBalance });
    say(C.green + "  session started" + C.reset + C.grey + "  " + res.session.sessionId + C.reset);
    say(C.grey + "  play with: node cli.js round --predict UP --risk 500" + C.reset);
    return emit({ ok: true, sessionId: res.session.sessionId });
  }

  if (sub === "end") {
    const res = Game.endSession();
    if (!res.ok) {
      if (JSON_MODE) return emit(res, 1);
      fail("No session is running.");
    }
    if (JSON_MODE) return emit({ ok: true, session: res.session });
    blank();
    renderSessionSummary(res.session);
    blank();
    return emit({ ok: true, sessionId: res.session.sessionId });
  }

  if (sub === "status") return Commands.status();
  return fail("Unknown session subcommand \"" + sub + "\". Use start, end or status.", 2);
};

Commands.round = function () {
  /* Flags are validated before the game state is looked at, so a typo in
     --predict always reports as a usage error (exit 2) instead of being masked
     by whatever the game state happens to be — "no session" is a confusing
     thing to be told when the real problem is that you wrote SIDEWAYS. */
  const predictRaw = FLAGS.predict === undefined || FLAGS.predict === true
    ? null
    : String(FLAGS.predict).toUpperCase();
  const prediction = predictRaw === "UP" || predictRaw === "DOWN" ? predictRaw : null;
  if (predictRaw !== null && !prediction) {
    return fail("--predict must be UP or DOWN (got \"" + FLAGS.predict + "\").", 2);
  }
  if (FLAGS.risk !== undefined && FLAGS.risk !== true && !Number.isFinite(Number(FLAGS.risk))) {
    return fail("--risk must be a number (got \"" + FLAGS.risk + "\").", 2);
  }
  const risk = Math.floor(Number(FLAGS.risk) || 0);
  if (prediction && risk <= 0) return fail("--risk must be a positive number of points.", 2);

  const s = STATE.session;
  if (!s) {
    if (JSON_MODE) return emit({ ok: false, error: "no-session" }, 1);
    fail("No session is running. Run `node cli.js session start` first.");
  }
  if (prediction && risk > STATE.balance) {
    if (JSON_MODE) return emit({ ok: false, error: "insufficient-balance", balance: STATE.balance }, 1);
    fail("Not enough points: you have " + fmt(STATE.balance) + ", tried to stake " + fmt(risk) + ".");
  }

  const balanceBefore = STATE.balance;
  const dealt = Game.dealRound();
  const res = Game.resolveRound(dealt, prediction, risk);

  if (JSON_MODE) {
    return emit({
      ok: true,
      round: res.round,
      balance: res.balance,
      balanceBefore,
      sessionId: s.sessionId
    });
  }
  blank();
  renderCoin(dealt.coin, res.round ? s.rounds.length : 1);
  blank();
  renderResult(res.round, balanceBefore);
  blank();
  return emit({ ok: true, result: res.round.result, payout: res.round.payout, balance: res.balance });
};

Commands.records = function () {
  const r = STATE.records;
  if (JSON_MODE) return emit({ ok: true, records: r, sessionsPlayed: STATE.history.length });
  banner();
  box("PERSONAL RECORDS", [
    `${C.grey}highest balance${C.reset}   ${C.bold}${fmt(r.highestBalance)}${C.reset}`,
    `${C.grey}biggest payout${C.reset}    ${fmt(r.biggestPayout)}`,
    `${C.grey}best win rate${C.reset}     ${Math.round(r.bestWinRate)}%`,
    `${C.grey}longest streak${C.reset}    ${r.longestStreak}`,
    `${C.grey}most rounds${C.reset}       ${r.mostRounds}`,
    `${C.grey}most risked${C.reset}       ${fmt(r.mostRisked)}`,
    `${C.grey}best session${C.reset}      ` +
      (r.bestSessionNet === null ? C.grey + "none yet" + C.reset : signed(r.bestSessionNet))
  ]);
  blank();
  return emit({ ok: true, records: r });
};

Commands.history = function () {
  if (FLAGS.id) {
    const s = STATE.history.find(h => h.sessionId === FLAGS.id);
    if (!s) {
      if (JSON_MODE) return emit({ ok: false, error: "not-found" }, 1);
      fail("No session with id " + FLAGS.id + ".");
    }
    if (JSON_MODE) return emit({ ok: true, session: s });
    blank();
    renderSessionSummary(s);
    blank();
    return emit({ ok: true, sessionId: s.sessionId });
  }

  const limit = Math.max(1, Math.floor(Number(FLAGS.limit) || 10));
  const rows = STATE.history.slice(0, limit);
  if (JSON_MODE) return emit({ ok: true, total: STATE.history.length, sessions: rows });

  banner();
  if (!rows.length) {
    say(C.grey + "  No sessions yet. Run `node cli.js play` to start one." + C.reset);
    blank();
    return emit({ ok: true, total: 0 });
  }
  box("SESSION HISTORY", rows.map(s => {
    const col = s.netResult >= 0 ? C.green : C.red;
    const when = new Date(s.endedAt || s.startedAt).toISOString().slice(0, 16).replace("T", " ");
    return `${C.grey}${when}${C.reset}  ${pad(String(s.totalRounds) + "r", 5)}` +
      `${pad(Math.round(s.winRate) + "%", 6)}${col}${pad(signed(s.netResult), 10)}${C.reset}` +
      `${C.grey}${Rules.awardsOf(s).map(a => a.icon).join("") || "—"}${C.reset}`;
  }));
  say(C.grey + `  showing ${rows.length} of ${STATE.history.length}` +
    (STATE.history.length > rows.length ? "  (--limit N for more)" : "") + C.reset);
  blank();
  return emit({ ok: true, total: STATE.history.length });
};

Commands.leaderboard = function () {
  const sort = String(FLAGS.sort || "points").toLowerCase();
  const ranked = Leaderboard.getRanked(sort);
  saveState();
  if (JSON_MODE) return emit({ ok: true, sort, players: ranked });

  banner();
  const labels = { points: "POINTS", payout: "BIGGEST PAYOUT", wins: "WINS", winrate: "WIN RATE", streak: "STREAK" };
  const valueOf = {
    points: p => fmt(p.points),
    payout: p => fmt(p.biggestPayout),
    wins: p => String(p.wins),
    winrate: p => Math.round(p.winRate) + "%",
    streak: p => String(p.streak)
  }[sort] || (p => fmt(p.points));

  box("LEADERBOARD · " + (labels[sort] || "POINTS"), ranked.map((p, i) => {
    const rank = ["🥇", "🥈", "🥉"][i] || C.grey + String(i + 1).padStart(2, " ") + C.reset;
    const name = p.isMe ? C.yellow + C.bold + p.name + C.reset : p.name;
    return `${pad(rank, 3)} ${p.avatar}  ${pad(name, 22)}${C.bold}${valueOf(p)}${C.reset}`;
  }));
  say(C.grey + "  --sort points|payout|wins|winrate|streak" + C.reset);
  blank();
  return emit({ ok: true, sort });
};

function ensureVotes() {
  if (!STATE.votes || Date.now() > STATE.votes.endsAt) {
    const coins = [];
    const used = new Set();
    while (coins.length < 4) {
      const c = Rules.pick(Rules.COIN_POOL);
      if (used.has(c[0])) continue;
      used.add(c[0]);
      coins.push({ ticker: c[0], emoji: c[1], votes: Rules.randInt(50, 900) });
    }
    STATE.votes = { endsAt: Date.now() + 60 * 60 * 1000, coins, voted: false };
    saveState();
  }
  return STATE.votes;
}

Commands.vote = function () {
  const votes = ensureVotes();
  const pickArg = FLAGS.pick;

  if (pickArg === undefined) {
    const total = votes.coins.reduce((a, c) => a + c.votes, 0);
    const list = votes.coins.map((c, i) => ({
      index: i + 1, ticker: c.ticker, votes: c.votes, share: Math.round(c.votes / total * 100)
    }));
    if (JSON_MODE) return emit({ ok: true, voted: votes.voted, closesInMs: votes.endsAt - Date.now(), coins: list });
    banner();
    box("MEME MADNESS VOTE · closes in " + formatDuration(votes.endsAt - Date.now()),
      votes.coins.map((c, i) => {
        const pct = Math.round(c.votes / total * 100);
        return `${C.grey}${i + 1}${C.reset} ${c.emoji}  ${pad("$" + c.ticker, 17)}` +
          `${C.purple}${bar(pct, 18)}${C.reset} ${pad(pct + "%", 5)}${C.grey}${fmt(c.votes)}${C.reset}`;
      }));
    say(C.grey + (votes.voted ? "  You already voted this round." : "  vote with: node cli.js vote --pick 1") + C.reset);
    blank();
    return emit({ ok: true, voted: votes.voted });
  }

  if (votes.voted) {
    if (JSON_MODE) return emit({ ok: false, error: "already-voted" }, 1);
    fail("You already voted in this round.");
  }
  const idx = Math.floor(Number(pickArg)) - 1;
  const coin = votes.coins[idx];
  if (!coin) return fail("--pick must be between 1 and " + votes.coins.length + ".", 2);

  coin.votes++;
  votes.voted = true;
  let awarded = 0;
  if (!STATE.boosts.vote) {
    STATE.boosts.vote = true;
    awarded = Rules.boostReward("vote");
    STATE.balance += awarded;
  }
  saveState();
  const payload = { ok: true, ticker: coin.ticker, awarded, balance: STATE.balance };
  if (JSON_MODE) return emit(payload);
  say(C.green + "  ✓ voted for $" + coin.ticker + C.reset +
    (awarded ? C.yellow + "   +" + fmt(awarded) + " points" + C.reset : ""));
  return emit(payload);
};

Commands.submit = function () {
  const name = typeof FLAGS.name === "string" ? FLAGS.name.trim() : "";
  const ticker = typeof FLAGS.ticker === "string" ? FLAGS.ticker.trim() : "";
  if (!name || !ticker) return fail("Both --name and --ticker are required.", 2);
  const res = Game.submitMeme(name, ticker);
  if (!res.ok) {
    if (JSON_MODE) return emit(res, 1);
    fail("You've already submitted a meme coin.");
  }
  if (JSON_MODE) return emit(res);
  if (res.qualifies) {
    say(C.yellow + C.bold + "  🏆 YOU MADE THE MADNESS!" + C.reset);
    say("  " + name + " ($" + res.meme.ticker + ") has been added to the roster.");
  } else {
    say(C.bold + "  SUBMITTED!" + C.reset);
    say(C.grey + "  " + name + " didn't make the cut this round — try again anytime." + C.reset);
  }
  if (res.awarded) say(C.yellow + "  +" + fmt(res.awarded) + " points" + C.reset);
  return emit(res);
};

Commands.share = function () {
  const s = FLAGS.id ? STATE.history.find(h => h.sessionId === FLAGS.id) : STATE.history[0];
  if (!s) {
    if (JSON_MODE) return emit({ ok: false, error: "no-session" }, 1);
    fail("No finished session to share yet.");
  }
  const text = ShareCard.buildText(s);
  if (JSON_MODE) return emit({ ok: true, sessionId: s.sessionId, text });
  blank();
  rule("═");
  say(text);
  rule("═");
  blank();
  return emit({ ok: true, sessionId: s.sessionId });
};

Commands.rules = function () {
  const total = Rules.OUTCOMES.reduce((a, o) => a + o.weight, 0);
  const payload = {
    ok: true,
    dailyPoints: CONFIG.DAILY_POINTS,
    roundSeconds: CONFIG.ROUND_SECONDS,
    multiplier: CONFIG.PAYOUT_MULTIPLIER,
    tieredPayout: CONFIG.USE_TIERED_PAYOUT,
    riskTiers: CONFIG.RISK_TIERS,
    historyLimit: CONFIG.HISTORY_LIMIT,
    outcomes: Rules.OUTCOMES.map(o => ({ key: o.key, weight: o.weight, chance: o.weight / total, pct: o.pct })),
    awards: Object.keys(Rules.AWARD_DEFS)
  };
  if (JSON_MODE) return emit(payload);

  banner();
  box("HOW IT WORKS", [
    `${C.grey}daily points${C.reset}    ${fmt(CONFIG.DAILY_POINTS)} every ${CONFIG.DAILY_CLAIM_WINDOW_MS / 3600000}h`,
    `${C.grey}round window${C.reset}    ${CONFIG.ROUND_SECONDS}s to pick a direction and a stake`,
    `${C.grey}payout${C.reset}          ` + (CONFIG.USE_TIERED_PAYOUT
      ? "tiered — " + CONFIG.RISK_TIERS.map(t => "×" + t.mult).join(" / ")
      : "×" + CONFIG.PAYOUT_MULTIPLIER + " flat on a correct call"),
    `${C.grey}a wrong call${C.reset}    loses the stake`,
    `${C.grey}history kept${C.reset}    last ${CONFIG.HISTORY_LIMIT} sessions`
  ]);
  blank();
  box("MARKET OUTCOMES", Rules.OUTCOMES.map(o => {
    const pct = (o.weight / total) * 100;
    const col = o.pct[1] > 0 && o.pct[0] >= 0 ? C.green : o.pct[1] <= 0 ? C.red : C.yellow;
    return `${col}${pad(o.key, 14)}${C.reset}${C.purple}${bar(pct, 16)}${C.reset} ` +
      `${pad(pct.toFixed(1) + "%", 7)}${C.grey}${o.pct[0]}% … ${o.pct[1]}%${C.reset}`;
  }));
  say(C.grey + "  direction is the sign of the move — an UP call wins on any move ≥ 0%." + C.reset);
  blank();
  box("AWARDS", Object.keys(Rules.AWARD_DEFS).map(k => {
    const a = Rules.AWARD_DEFS[k];
    return `${a.icon}  ${pad(a.title, 20)}${C.grey}${a.desc}${C.reset}`;
  }));
  blank();
  return emit(payload);
};

Commands.reset = async function () {
  if (!FLAGS.yes) {
    if (!process.stdin.isTTY) return fail("Refusing to erase without confirmation. Re-run with --yes.", 2);
    say(C.red + C.bold + "  This erases your balance, records and session history." + C.reset);
    say(C.grey + "  " + DATA_FILE + C.reset);
    const res = await ask(C.yellow + "  type ERASE to confirm › " + C.reset);
    closeRL();
    if (!res.answer || res.answer !== "ERASE") {
      say(C.grey + "  Cancelled — nothing was erased." + C.reset);
      return emit({ ok: false, error: "cancelled" }, 1);
    }
  }
  STATE = defaultState();
  const saved = saveState();
  if (!saved) return fail("Could not write to " + DATA_FILE, 3);
  if (JSON_MODE) return emit({ ok: true, dataFile: DATA_FILE });
  say(C.green + "  Save data erased." + C.reset);
  return emit({ ok: true });
};

/* =========================================================
   INTERACTIVE PLAY
   ========================================================= */
Commands.play = async function () {
  requireInteractive();
  banner();

  if (Game.claimCooldownLeft() === 0) {
    const res = Game.claimDaily();
    say(C.green + C.bold + "  DAILY DROP  +" + fmt(res.claimed) + " points" + C.reset);
    blank();
  }
  if (STATE.balance <= 0) {
    say(C.grey + "  You're out of points and today's drop is already claimed." + C.reset);
    say(C.grey + "  Next drop in " + formatDuration(Game.claimCooldownLeft()) + "." + C.reset);
    const unclaimed = CONFIG.BOOST_ACTIONS.filter(b => !STATE.boosts[b.id]);
    if (unclaimed.length) say(C.yellow + "  Tip: `node cli.js boost` has " + fmt(unclaimed.reduce((a, b) => a + b.reward, 0)) + " points waiting." + C.reset);
    blank();
    return emit({ ok: false, error: "no-points" }, 1);
  }

  // A run left open by a previous invocation is resumed rather than abandoned,
  // so quitting the CLI mid-session never silently loses those rounds.
  if (STATE.session) {
    say(C.grey + "  Resuming your open run (" + STATE.session.rounds.length + " rounds so far)." + C.reset);
  } else {
    const started = Game.startSession();
    if (!started.ok) return fail("Could not start a session: " + started.error, 3);
  }

  say(C.grey + "  " + CONFIG.ROUND_SECONDS + "s per round to call it. " +
      "Type " + C.reset + C.bold + "q" + C.reset + C.grey + " at any prompt to end the run." + C.reset);
  blank();

  let playing = true;
  while (playing) {
    const s = STATE.session;
    if (!s) break;
    if (STATE.balance <= 0) {
      say(C.red + "  You're out of points — that's the run." + C.reset);
      break;
    }

    const dealt = Game.dealRound();
    blank();
    renderCoin(dealt.coin, dealt.roundNum);
    say(C.grey + "  balance " + C.reset + C.bold + fmt(STATE.balance) + C.reset +
        C.grey + "   ·   " + s.wins + "W/" + s.losses + "L   ·   streak " + s.currentStreak + C.reset);
    blank();

    const deadline = Date.now() + CONFIG.ROUND_SECONDS * 1000;

    /* The decision loop. A typo, or a declined lock, sends you back to the
       direction prompt for the *same* coin rather than burning the round —
       which is what the app's cancelReview() does. Only the clock ending the
       window resolves the round without a prediction, so the SKIPPED message
       is always literally true. */
    let prediction = null;
    let risk = 0;
    let locked = false;
    let skipReason = "timeout";

    while (!locked) {
      if (Date.now() >= deadline) { skipReason = "timeout"; break; }

      const dirRes = await ask(
        `  Will $${dealt.coin.ticker} go ${C.green}UP${C.reset} or ${C.red}DOWN${C.reset}? ` +
        `${C.grey}(${secondsLeft(deadline)}s)${C.reset} ${PROMPT()}`, { deadline });
      if (dirRes.closed) { playing = false; break; }
      if (dirRes.timedOut) { skipReason = "timeout"; break; }
      const answer = (dirRes.answer || "").toLowerCase();
      if (answer === "q" || answer === "quit") { playing = false; break; }
      const dir = answer.startsWith("u") ? "UP" : answer.startsWith("d") ? "DOWN" : null;
      if (!dir) {
        say(C.grey + "  Not a direction — type UP or DOWN." + C.reset);
        continue;
      }

      // The same deadline covers the stake and the lock: the 25 seconds are one
      // decision window, exactly as the browser's single round timer is.
      const quick = CONFIG.QUICK_RISKS.filter(r => r <= STATE.balance);
      const stakeRes = await ask(
        `  Stake how many points? ${C.grey}[${quick.join(" ")} | all]${C.reset} ` +
        `${C.grey}(${secondsLeft(deadline)}s)${C.reset} ${PROMPT()}`,
        { deadline });
      if (stakeRes.closed) { playing = false; break; }
      if (stakeRes.timedOut) { skipReason = "timeout"; break; }
      const stakeRaw = (stakeRes.answer || "").toLowerCase();
      if (stakeRaw === "q" || stakeRaw === "quit") { playing = false; break; }
      let stake = (stakeRaw === "all" || stakeRaw === "max")
        ? STATE.balance
        : Math.floor(Number(stakeRaw.replace(/[,_\s]/g, "")) || 0);
      if (stake <= 0) {
        say(C.grey + "  That isn't a stake — a number, or `all`." + C.reset);
        continue;
      }
      if (stake > STATE.balance) {
        stake = STATE.balance;
        say(C.grey + "  Capped at your balance: " + fmt(stake) + "." + C.reset);
      }

      // Review, then the irreversible lock — the same two-step confirm as the app.
      const mult = Rules.getMultiplier(stake);
      const tier = Rules.riskTierFor(stake);
      say("");
      say(`  ${C.bold}${dir}${C.reset} on $${dealt.coin.ticker} for ${C.bold}${fmt(stake)}${C.reset}` +
          `${C.grey}  ·  win ${C.green}+${fmt(Math.round(stake * mult))}${C.grey}  ·  lose ${C.red}-${fmt(stake)}${C.reset}` +
          (tier && CONFIG.USE_TIERED_PAYOUT ? C.grey + "  ·  " + tier.label : ""));
      const lockRes = await ask(
        `  Lock it in? ${C.grey}[Y/n] (${secondsLeft(deadline)}s)${C.reset} ${PROMPT()}`, { deadline });
      if (lockRes.closed) { playing = false; break; }
      if (lockRes.timedOut) { skipReason = "timeout"; break; }
      const lockAnswer = (lockRes.answer || "").toLowerCase();
      if (lockAnswer === "q" || lockAnswer === "quit") { playing = false; break; }
      if (lockAnswer && !lockAnswer.startsWith("y")) {
        say(C.grey + "  Cancelled — call it again." + C.reset);
        blank();
        continue;
      }
      prediction = dir;
      risk = stake;
      locked = true;
    }

    // Quitting mid-decision leaves the round unplayed rather than recording an
    // empty one — the run simply ends here.
    if (!playing && !locked) break;

    const balanceBefore = STATE.balance;
    const res = locked
      ? Game.resolveRound(dealt, prediction, risk)
      : Game.resolveRound(dealt, null, 0);
    blank();
    renderResult(res.round, balanceBefore, skipReason);

    if (STATE.balance <= 0) {
      blank();
      say(C.red + C.bold + "  Out of points." + C.reset);
      break;
    }

    const again = await ask(`  ${C.grey}[enter] next round  ·  [q] end run${C.reset} ${PROMPT()}`);
    if (again.closed) break;
    const a = (again.answer || "").toLowerCase();
    if (a === "q" || a === "quit") playing = false;
  }

  const ended = Game.endSession();
  closeRL();
  if (!ended.ok) {
    blank();
    say(C.grey + "  Run ended." + C.reset);
    return emit({ ok: true, rounds: 0 });
  }
  blank();
  renderSessionSummary(ended.session);
  blank();
  say(C.grey + "  share it:   " + C.reset + "node cli.js share");
  say(C.grey + "  history:    " + C.reset + "node cli.js history");
  blank();
  return emit({ ok: true, sessionId: ended.session.sessionId, net: ended.session.netResult });
};

/* Aliases for the commands people will reasonably guess at. */
Commands.balance = Commands.status;
Commands.stats = Commands.records;
Commands.lb = Commands.leaderboard;

/* =========================================================
   ENTRY
   ========================================================= */
async function main() {
  if (FLAGS.help || COMMAND === "--help" || COMMAND === "-h") return Commands.help();
  if (FLAGS.version && !COMMAND) return Commands.version();

  // Bare `node cli.js` plays if there's a terminal, and prints help if the
  // output is being piped — a help screen is useful in a pipe, a game is not.
  const name = COMMAND || (process.stdin.isTTY ? "play" : "help");
  const fn = Commands[name];
  if (!fn) {
    return fail("Unknown command \"" + name + "\". Run `node cli.js help` for the list.", 2);
  }
  await fn();
}

/* Ctrl-C mid-round: the state is already persisted after every round, so there
   is nothing to flush. Raw mode does need undoing though — a readline prompt may
   be open, and exiting out from under it leaves the shell with no echo. */
process.on("SIGINT", () => {
  closeRL();
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    try { process.stdin.setRawMode(false); } catch (_) { /* already closed */ }
  }
  if (!JSON_MODE) process.stdout.write("\n" + C.grey + "  Interrupted — your progress is saved." + C.reset + "\n");
  process.exit(130);
});

main().catch(err => {
  fail("unexpected error: " + (err && err.stack ? err.stack : err), 3);
});
