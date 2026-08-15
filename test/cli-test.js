/* =====================================================
   CADE MEME MADNESS — CLI Production QA
   -----------------------------------------------------
   Drives cli.js the way a user and a script would: by spawning the real binary
   as a child process and inspecting its stdout, stderr and exit code. Nothing is
   require()d and poked at internally, because the things that break a CLI in
   production are not internal — they are argv parsing, exit codes, the save
   file, a stray colour escape in piped output, and the shell contract.

   The load-bearing checks, in the order they matter:

     1. PARITY. Every payout the CLI awards must equal Rules.scoreRound() to the
        point. The CLI, the browser and the Express backend all load rules.js, so
        this is the test that proves the terminal build is the same game rather
        than a lookalike that drifts on the next edit.
     2. LEDGER INTEGRITY. Across a whole session, sum(payouts) must equal
        (endingBalance - startingBalance) exactly. Any double-credit, any missed
        debit, any rounding slip shows up here as a single failed subtraction.
     3. EXIT CODES. 0 success / 1 refused / 2 usage / 3 internal. A script that
        does `cade claim && cade session start` is relying on this.
     4. NO ANSI IN PIPES. Captured stdout must be escape-free, or every log line
        a user pipes into a file is full of \x1b[38;2;… .
     5. --json PURITY. stdout must be exactly one JSON object. A single stray
        banner line makes JSON.parse throw for every consumer.
     6. THE SAVE FILE. Never corrupted by an interrupt, never world-readable,
        never silently reset when it can't be parsed.

   Every case runs against its own throwaway save file under a temp directory, so
   a QA run can never touch the player's real ~/.cade-meme-madness.json — and so
   cases cannot contaminate each other's state.

   Run:  npm run test:cli
   ===================================================== */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "cli.js");
const Rules = require(path.join(ROOT, "rules.js"));
const CONFIG = Rules.CONFIG;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cade-cli-qa-"));

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
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + ": " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
}
function group(t) { console.log("\n" + t); }

/* ---------------------------------------------------------
   Harness
   --------------------------------------------------------- */
let caseCounter = 0;

/** A fresh, isolated save file. Named after the caller so a failure points at
 *  the file you need to inspect. */
function newSave(label) {
  caseCounter++;
  return path.join(TMP, (label || "case") + "-" + caseCounter + ".json");
}

/** Run the CLI. stdio is piped, which also means process.stdout.isTTY is false
 *  inside the child — exactly the condition the no-ANSI and no-interactive-play
 *  checks depend on. */
function run(args, opts) {
  opts = opts || {};
  const res = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: ROOT,
    encoding: "utf8",
    timeout: opts.timeout || 20000,
    input: opts.input === undefined ? "" : opts.input,
    env: Object.assign({}, process.env, { NO_COLOR: "", CADE_DATA: "" }, opts.env || {})
  });
  return {
    code: res.status,
    signal: res.signal,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    args: args.join(" ")
  };
}

/** Run in --json mode and parse. Throws with the raw output on any impurity,
 *  which is itself the assertion for check 5 above. */
function json(args, opts) {
  const r = run(args.concat(["--json"]), opts);
  const trimmed = r.stdout.trim();
  assert(trimmed.length > 0, "`" + r.args + "` printed nothing on stdout (stderr: " + r.stderr.trim() + ")");
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new Error("`" + r.args + "` did not print one JSON object:\n      " + JSON.stringify(r.stdout.slice(0, 300)));
  }
  return Object.assign({}, r, { body: parsed });
}

const ANSI = /\x1b\[/;

/* =====================================================
   TESTS
   ===================================================== */
console.log("CADE MEME MADNESS — CLI production QA");
console.log("  cli: " + CLI);
console.log("  scratch: " + TMP);

/* ---------------------------------------------------------
   1. It starts at all
   --------------------------------------------------------- */
group("1. Startup and self-description");

check("`node cli.js --check` equivalent: the file parses", () => {
  const r = spawnSync(process.execPath, ["--check", CLI], { encoding: "utf8" });
  eq(r.status, 0, "node --check failed: " + (r.stderr || "").trim());
});

check("help exits 0 and lists every documented command", () => {
  const r = run(["help"]);
  eq(r.code, 0);
  for (const cmd of ["play", "status", "claim", "boost", "session", "round", "records",
                     "history", "leaderboard", "vote", "submit", "share", "rules", "reset"]) {
    assert(r.stdout.includes(cmd), "help never mentions `" + cmd + "`");
  }
  return "14 commands documented";
});

check("--help and -h reach help too", () => {
  for (const flag of ["--help", "-h"]) {
    const r = run([flag]);
    eq(r.code, 0, flag + " exited " + r.code);
    assert(/USAGE/.test(r.stdout), flag + " did not print usage");
  }
});

check("version prints a semver and exits 0", () => {
  const r = run(["version"]);
  eq(r.code, 0);
  assert(/\d+\.\d+\.\d+/.test(r.stdout), "no version number in: " + r.stdout.trim());
  return r.stdout.trim();
});

check("a piped invocation with no command prints help, it does not hang", () => {
  /* Bare `cli.js` plays interactively on a TTY. Under a pipe there is no TTY, so
     it must fall through to help — if it tried to play it would block on a
     prompt forever and every CI job that ran it would time out. */
  const r = run([], { timeout: 8000 });
  assert(r.signal !== "SIGTERM", "bare invocation hung under a pipe (timed out)");
  eq(r.code, 0);
  assert(/USAGE/.test(r.stdout), "expected help, got: " + r.stdout.slice(0, 120));
});

check("interactive `play` refuses a non-TTY instead of blocking", () => {
  const r = run(["play", "--data", newSave("play-tty")], { timeout: 8000 });
  assert(r.signal !== "SIGTERM", "`play` hung waiting for input that can never come");
  eq(r.code, 2, "expected a usage error");
  assert(/--script/.test(r.stderr), "the error should point at the scriptable alternatives: " + r.stderr.trim());
});

/* ---------------------------------------------------------
   1b. The interactive loop, driven through --script
   -----------------------------------------------------
   `play` is the headline feature and the part a pipe cannot normally reach, so
   --script feeds it the same answers a player would type. Every case here is a
   bug that actually happened and was only visible under a real terminal.
   --------------------------------------------------------- */
group("1b. Interactive play");

/** Feed `play` a scripted set of answers. */
function play(answers, save, extra) {
  return run(["play", "--script", "--no-color", "--data", save].concat(extra || []),
    { input: answers.join("\n") + "\n", timeout: 30000 });
}

check("a scripted run plays every round it was given and ends cleanly", () => {
  const save = newSave("play-run");
  const r = play(["up", "1000", "y", "", "down", "500", "y", "", "q"], save);
  eq(r.code, 0, "play exited " + r.code + "\n" + r.stdout.slice(-400));
  assert(/ROUND 01/.test(r.stdout), "round 1 never rendered");
  assert(/ROUND 02/.test(r.stdout), "round 2 never rendered — input was dropped between prompts");
  const h = json(["history", "--data", save]).body;
  eq(h.total, 1, "the run was not archived");
  eq(h.sessions[0].totalRounds, 2, "expected 2 rounds, got " + h.sessions[0].totalRounds);
  return "2 rounds, net " + h.sessions[0].netResult;
});

check("input arriving between prompts is queued, not dropped", () => {
  /* Regression, twice over. A per-prompt readline interface discards the input
     readline already buffered, and a shared interface with a per-prompt listener
     loses lines that arrive while a result card is rendering. Either way the run
     quit itself after one answer. Five rounds fed at once proves neither is back. */
  const save = newSave("play-queue");
  const answers = [];
  for (let i = 0; i < 5; i++) answers.push("up", "100", "y", "");
  answers.push("q");
  const r = play(answers, save);
  eq(r.code, 0, r.stdout.slice(-300));
  const s = json(["history", "--data", save]).body.sessions[0];
  eq(s.totalRounds, 5, "only " + s.totalRounds + " of 5 rounds survived the prompt handoff");
  return "5 rounds fed at once, all played";
});

check("a typo at the direction prompt re-asks instead of burning the round", () => {
  const save = newSave("play-typo");
  const r = play(["sideways", "up", "500", "y", "", "q"], save);
  eq(r.code, 0);
  assert(/Not a direction/.test(r.stdout), "the typo was not reported");
  const s = json(["history", "--data", save]).body.sessions[0];
  eq(s.totalRounds, 1, "the typo consumed a round");
  eq(s.rounds[0].result === "SKIPPED", false, "the round resolved without the prediction that followed");
  eq(s.rounds[0].riskAmount, 500);
});

check("declining the lock re-asks rather than resolving the round", () => {
  /* The app's cancelReview() returns you to the prediction step for the same
     coin. Answering `n` used to resolve the round as SKIPPED and, worse, blame
     it on the clock. */
  const save = newSave("play-cancel");
  const r = play(["up", "2500", "n", "down", "100", "y", "", "q"], save);
  eq(r.code, 0);
  assert(/Cancelled/.test(r.stdout), "the cancellation was not acknowledged");
  assert(!/clock ran out/.test(r.stdout), "a declined lock was reported as a timeout");
  const s = json(["history", "--data", save]).body.sessions[0];
  eq(s.totalRounds, 1, "cancelling consumed a round");
  eq(s.rounds[0].prediction, "DOWN", "the re-asked prediction was not the one recorded");
  eq(s.rounds[0].riskAmount, 100, "the cancelled stake was used instead of the new one");
});

check("`q` mid-decision ends the run without recording a phantom round", () => {
  const save = newSave("play-quit");
  const r = play(["up", "500", "y", "", "up", "q"], save);
  eq(r.code, 0);
  const s = json(["history", "--data", save]).body.sessions[0];
  eq(s.totalRounds, 1, "quitting mid-round recorded an extra round");
});

check("stdin ending mid-run closes the session rather than hanging", () => {
  const save = newSave("play-eof");
  const r = play(["up", "500", "y"], save);      // no trailing continue/quit
  assert(r.signal !== "SIGTERM", "play hung at EOF");
  eq(r.code, 0);
  eq(json(["status", "--data", save]).body.session, null, "the session was left open after EOF");
  eq(json(["history", "--data", save]).body.total, 1, "the run was not archived on EOF");
});

check("a scripted run's ledger balances exactly like a scripted round would", () => {
  const save = newSave("play-ledger");
  const answers = [];
  for (let i = 0; i < 6; i++) answers.push(i % 2 ? "up" : "down", "750", "y", "");
  answers.push("q");
  const r = play(answers, save);
  eq(r.code, 0);
  const s = json(["history", "--data", save]).body.sessions[0];
  const sum = s.rounds.reduce((a, x) => a + x.payout, 0);
  eq(s.netResult, sum, "netResult does not equal the sum of the interactive payouts");
  eq(s.endingBalance, s.startingBalance + sum, "the interactive balance drifted from its payouts");
  for (const round of s.rounds) {
    const expect = Rules.scoreRound(round.prediction, round.actualDir, round.riskAmount);
    eq(round.payout, expect.payout, "an interactive round paid off-rule");
  }
  return s.rounds.length + " rounds, net " + s.netResult;
});

check("`all` stakes the whole balance and stops at zero", () => {
  const save = newSave("play-all");
  const answers = [];
  for (let i = 0; i < 12; i++) answers.push("up", "all", "y", "");
  answers.push("q");
  const r = play(answers, save);
  eq(r.code, 0);
  const status = json(["status", "--data", save]).body;
  assert(status.balance >= 0, "balance went negative on an all-in run: " + status.balance);
  const s = json(["history", "--data", save]).body.sessions[0];
  /* The invariant is the stake against the balance at that moment, not against
     the starting balance — after a win an all-in stake is legitimately larger
     than the run began with. */
  let balance = s.startingBalance;
  for (const round of s.rounds) {
    eq(round.riskAmount, balance, "`all` did not stake the whole balance");
    balance += round.payout;
    assert(balance >= 0, "balance went negative mid-run: " + balance);
  }
  eq(balance, s.endingBalance, "the replayed ledger does not reach the recorded ending balance");
  return s.rounds.length + " all-in rounds, ended at " + status.balance;
});

check("play resumes an open session instead of abandoning it", () => {
  const save = newSave("play-resume");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  json(["round", "--predict", "UP", "--risk", "100", "--data", save]);
  const r = play(["up", "100", "y", "", "q"], save);
  eq(r.code, 0);
  assert(/Resuming/.test(r.stdout), "play started a fresh session and orphaned the open one");
  const s = json(["history", "--data", save]).body.sessions[0];
  eq(s.totalRounds, 2, "the round played before `play` was lost");
});

check("play refuses when there are no points and nothing to claim", () => {
  const save = newSave("play-broke");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  // Burn the balance to zero.
  let balance = json(["status", "--data", save]).body.balance;
  for (let i = 0; i < 60 && balance > 0; i++) {
    const rr = json(["round", "--predict", "UP", "--risk", String(balance), "--seed", String(20000 + i), "--data", save]);
    if (rr.body.ok === false) break;
    balance = rr.body.balance;
  }
  json(["session", "end", "--data", save]);
  if (balance > 0) return "skipped — never went bust (balance " + balance + ")";
  const r = play(["up", "100", "y", "", "q"], save);
  eq(r.code, 1, "play should refuse with no points");
  assert(/out of points/i.test(r.stdout), r.stdout.slice(-200));
  return "refused at 0 points";
});

/* ---------------------------------------------------------
   2. Exit codes are the shell contract
   --------------------------------------------------------- */
group("2. Exit codes");

check("unknown command exits 2 (usage), not 1", () => {
  const r = run(["definitely-not-a-command", "--data", newSave("unknown")]);
  eq(r.code, 2, "a typo'd command must be a usage error");
});

check("a malformed flag exits 2 even when the game state is also wrong", () => {
  /* Regression: the session check used to run first, so `--predict SIDEWAYS`
     with no session reported "no session" and exited 1. A script cannot tell a
     typo from a state problem if both collapse to the same code. */
  const save = newSave("bad-flag");
  const r = run(["round", "--predict", "SIDEWAYS", "--data", save]);
  eq(r.code, 2, "expected usage error for a bad --predict");
  assert(/predict/i.test(r.stderr), "the message should name the offending flag: " + r.stderr.trim());
});

check("--risk must be numeric", () => {
  const r = run(["round", "--predict", "UP", "--risk", "lots", "--data", newSave("bad-risk")]);
  eq(r.code, 2);
  assert(/risk/i.test(r.stderr), r.stderr.trim());
});

check("a refused-but-valid action exits 1 (claiming twice)", () => {
  const save = newSave("double-claim");
  eq(run(["claim", "--data", save]).code, 0);
  const again = run(["claim", "--data", save]);
  eq(again.code, 1, "a second claim is a game refusal, not a usage error");
  assert(/claimed/i.test(again.stderr), again.stderr.trim());
});

check("--seed rejects a non-number", () => {
  const r = run(["status", "--seed", "banana", "--data", newSave("bad-seed")]);
  eq(r.code, 2);
});

check("session end with no session exits 1", () => {
  eq(run(["session", "end", "--data", newSave("no-session")]).code, 1);
});

check("an unknown session subcommand exits 2", () => {
  eq(run(["session", "sideways", "--data", newSave("bad-sub")]).code, 2);
});

/* ---------------------------------------------------------
   3. Piped output is clean
   --------------------------------------------------------- */
group("3. Piped output hygiene");

check("no ANSI escapes reach a pipe on any read-only command", () => {
  const save = newSave("ansi");
  run(["claim", "--data", save]);
  const dirty = [];
  for (const cmd of [["status"], ["records"], ["rules"], ["history"], ["leaderboard"], ["boost"], ["vote"], ["help"]]) {
    const r = run(cmd.concat(["--data", save]));
    if (ANSI.test(r.stdout)) dirty.push(cmd[0]);
  }
  assert(dirty.length === 0, "colour escapes leaked into piped stdout from: " + dirty.join(", "));
  return "8 commands checked";
});

check("--no-color is honoured even when NO_COLOR is unset", () => {
  const save = newSave("nocolor");
  const r = run(["status", "--no-color", "--data", save], { env: { NO_COLOR: undefined } });
  assert(!ANSI.test(r.stdout), "escapes present despite --no-color");
});

check("errors go to stderr, not stdout", () => {
  const r = run(["session", "end", "--data", newSave("stderr")]);
  assert(r.stderr.trim().length > 0, "nothing on stderr for a failed command");
  assert(!/✗/.test(r.stdout), "the error was written to stdout, which pollutes piped data");
});

check("--json puts exactly one object on stdout and nothing else", () => {
  const save = newSave("json-purity");
  const cmds = [["claim"], ["status"], ["records"], ["rules"], ["history"], ["leaderboard"],
                ["boost"], ["vote"], ["session", "start"], ["session", "end"], ["version"], ["help"]];
  for (const cmd of cmds) {
    const r = run(cmd.concat(["--data", save, "--json"]));
    const lines = r.stdout.trim().split("\n").filter(l => l.trim());
    eq(lines.length, 1, cmd.join(" ") + " printed " + lines.length + " lines of stdout in --json mode");
    JSON.parse(lines[0]); // throws if it isn't pure JSON
  }
  return cmds.length + " commands";
});

check("--json on a failure still emits parseable JSON with ok:false", () => {
  const save = newSave("json-fail");
  run(["claim", "--data", save]);
  const r = json(["claim", "--data", save]);
  eq(r.code, 1);
  eq(r.body.ok, false);
  assert(typeof r.body.error === "string", "no error string in the failure payload");
  return r.body.error;
});

/* ---------------------------------------------------------
   4. Payout parity with the shared rules — the important one
   --------------------------------------------------------- */
group("4. Payout parity with rules.js");

check("every scored round pays exactly Rules.scoreRound()", () => {
  const save = newSave("parity");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);

  const mismatches = [];
  let played = 0;
  /* Seeds vary so the outcome table is actually explored — a single seed could
     roll UP twelve times and never test the loss branch. */
  for (let i = 0; i < 24; i++) {
    const prediction = i % 2 === 0 ? "UP" : "DOWN";
    const stake = [100, 500, 1000, 2500][i % 4];
    const r = json(["round", "--predict", prediction, "--risk", String(stake),
                    "--seed", String(1000 + i), "--data", save]);
    if (r.body.ok === false) break;                 // ran out of points; that's fine
    const round = r.body.round;
    played++;
    const expect = Rules.scoreRound(round.prediction, round.actualDir, round.riskAmount);
    if (round.result !== expect.result || round.payout !== expect.payout) {
      mismatches.push(`${round.prediction} vs ${round.actualDir} @${round.riskAmount}: ` +
        `cli said ${round.result}/${round.payout}, rule says ${expect.result}/${expect.payout}`);
    }
    if (r.body.balance !== r.body.balanceBefore + round.payout) {
      mismatches.push(`balance moved ${r.body.balance - r.body.balanceBefore} on a payout of ${round.payout}`);
    }
  }
  assert(played >= 8, "only played " + played + " rounds — not enough to prove anything");
  assert(mismatches.length === 0, mismatches.length + " divergence(s):\n      " + mismatches.join("\n      "));
  return played + " rounds, all exact";
});

check("a correct call pays the configured multiplier, no more and no less", () => {
  const save = newSave("multiplier");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  const stake = 1000;
  let wins = 0, checked = 0;
  for (let i = 0; i < 30 && wins < 3; i++) {
    const r = json(["round", "--predict", "UP", "--risk", String(stake), "--seed", String(500 + i), "--data", save]);
    if (r.body.ok === false) break;
    if (r.body.round.result !== "WIN") continue;
    wins++;
    checked++;
    eq(r.body.round.payout, Math.round(stake * Rules.getMultiplier(stake)),
      "a winning " + stake + "-point call paid the wrong amount");
  }
  assert(checked >= 1, "never rolled a win in 30 attempts — the outcome table looks broken");
  return checked + " wins verified at ×" + Rules.getMultiplier(stake);
});

check("a wrong call loses exactly the stake", () => {
  const save = newSave("loss");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  let losses = 0;
  for (let i = 0; i < 30 && losses < 3; i++) {
    const r = json(["round", "--predict", "UP", "--risk", "500", "--seed", String(900 + i), "--data", save]);
    if (r.body.ok === false) break;
    if (r.body.round.result !== "LOSS") continue;
    losses++;
    eq(r.body.round.payout, -500, "a losing 500-point call debited the wrong amount");
  }
  assert(losses >= 1, "never rolled a loss in 30 attempts");
  return losses + " losses verified";
});

check("direction always matches the sign of the move", () => {
  /* An UP result on a negative percentage is the single most confusing bug this
     game can have, and it is only unrepresentable while direction is derived
     rather than stored. This is the check that keeps it that way. */
  const save = newSave("dir");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  const bad = [];
  for (let i = 0; i < 20; i++) {
    const r = json(["round", "--predict", "UP", "--risk", "100", "--seed", String(70 + i), "--data", save]);
    if (r.body.ok === false) break;
    const { actualDir, pctMove } = r.body.round;
    if (actualDir !== Rules.dirFromPct(pctMove)) bad.push(`${actualDir} on ${pctMove}%`);
  }
  assert(bad.length === 0, "contradictory round(s): " + bad.join(", "));
});

check("a round with no --predict resolves as SKIPPED and costs nothing", () => {
  const save = newSave("skip");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  const before = json(["status", "--data", save]).body.balance;
  const r = json(["round", "--data", save]);
  eq(r.body.round.result, "SKIPPED");
  eq(r.body.round.payout, 0);
  eq(r.body.round.prediction, null);
  eq(r.body.round.riskAmount, 0);
  eq(r.body.balance, before, "a skipped round moved the balance");
});

check("the same seed produces the same round twice over", () => {
  const a = newSave("determinism-a"), b = newSave("determinism-b");
  const play = save => {
    json(["claim", "--seed", "31337", "--data", save]);
    json(["session", "start", "--seed", "31337", "--data", save]);
    return json(["round", "--predict", "UP", "--risk", "1000", "--seed", "31337", "--data", save]).body.round;
  };
  const r1 = play(a), r2 = play(b);
  eq(r2.coin.ticker, r1.coin.ticker, "same seed dealt a different coin");
  eq(r2.pctMove, r1.pctMove, "same seed rolled a different move");
  eq(r2.result, r1.result);
  eq(r2.payout, r1.payout);
  return r1.coin.ticker + " " + r1.pctMove + "% → " + r1.result;
});

/* ---------------------------------------------------------
   5. The ledger has to balance
   --------------------------------------------------------- */
group("5. Ledger integrity across a full session");

check("sum of payouts equals the session's net result, to the point", () => {
  const save = newSave("ledger");
  json(["claim", "--data", save]);
  const start = json(["session", "start", "--data", save]);
  const startingBalance = start.body.startingBalance;

  let expected = startingBalance;
  const payouts = [];
  for (let i = 0; i < 15; i++) {
    const r = json(["round", "--predict", i % 3 === 0 ? "DOWN" : "UP",
                    "--risk", String([250, 750, 1500][i % 3]), "--seed", String(2000 + i), "--data", save]);
    if (r.body.ok === false) break;
    expected += r.body.round.payout;
    payouts.push(r.body.round.payout);
    eq(r.body.balance, expected, "balance drifted from the running total at round " + (i + 1));
  }

  const ended = json(["session", "end", "--data", save]).body.session;
  eq(ended.endingBalance, expected, "endingBalance disagrees with the sum of payouts");
  eq(ended.netResult, payouts.reduce((a, p) => a + p, 0), "netResult is not the sum of the payouts");
  eq(ended.netResult, ended.endingBalance - ended.startingBalance, "netResult is not end minus start");
  return payouts.length + " rounds, net " + ended.netResult;
});

check("wins + losses + skips accounts for every round", () => {
  const save = newSave("counts");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  for (let i = 0; i < 10; i++) {
    json(["round", "--predict", "UP", "--risk", "300", "--seed", String(4000 + i), "--data", save]);
  }
  json(["round", "--data", save]);   // one deliberate skip
  const s = json(["session", "end", "--data", save]).body.session;
  const skipped = s.rounds.filter(r => r.result === "SKIPPED").length;
  eq(s.wins + s.losses + skipped, s.totalRounds, "round counters do not sum to totalRounds");
  eq(s.rounds.filter(r => r.result === "WIN").length, s.wins, "wins counter disagrees with the round log");
  eq(s.rounds.filter(r => r.result === "LOSS").length, s.losses, "losses counter disagrees with the round log");
  return s.wins + "W/" + s.losses + "L/" + skipped + "S of " + s.totalRounds;
});

check("winRate uses total rounds as the denominator, and is 0 for an empty run", () => {
  const empty = newSave("winrate-empty");
  json(["claim", "--data", empty]);
  json(["session", "start", "--data", empty]);
  const s = json(["session", "end", "--data", empty]).body.session;
  eq(s.totalRounds, 0);
  eq(s.winRate, 0, "an empty session must not produce NaN");
  assert(Number.isFinite(s.netResult), "netResult is not finite on an empty session");
});

check("a stake larger than the balance is refused, not silently clamped", () => {
  const save = newSave("overstake");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  const balance = json(["status", "--data", save]).body.balance;
  const r = json(["round", "--predict", "UP", "--risk", String(balance + 1), "--data", save]);
  eq(r.code, 1);
  eq(r.body.error, "insufficient-balance");
  eq(json(["status", "--data", save]).body.balance, balance, "the refused round still moved the balance");
});

check("the balance can never go negative", () => {
  const save = newSave("no-negative");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  let balance = json(["status", "--data", save]).body.balance;
  for (let i = 0; i < 40; i++) {
    const r = json(["round", "--predict", "UP", "--risk", String(balance), "--seed", String(6000 + i), "--data", save]);
    if (r.body.ok === false) break;                       // refused once broke
    balance = r.body.balance;
    assert(balance >= 0, "balance went negative: " + balance);
    if (balance === 0) break;
  }
  return "all-in loop ended at " + balance;
});

check("awards granted match Rules.calculateAwards for the finished session", () => {
  const save = newSave("awards");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  for (let i = 0; i < 16; i++) {
    const r = json(["round", "--predict", i % 2 ? "UP" : "DOWN", "--risk", "1000", "--seed", String(8000 + i), "--data", save]);
    if (r.body.ok === false) break;
  }
  const s = json(["session", "end", "--data", save]).body.session;
  const expect = Rules.calculateAwards(s);
  eq(JSON.stringify(s.awards), JSON.stringify(expect), "the CLI's awards differ from the shared rule");
  for (const code of s.awards) {
    assert(Rules.AWARD_DEFS[code], "granted an award code that has no definition: " + code);
  }
  return (s.awards.length || "no") + " award(s): " + (s.awards.join(", ") || "—");
});

/* ---------------------------------------------------------
   6. Session lifecycle
   --------------------------------------------------------- */
group("6. Session lifecycle");

check("starting a session twice is refused", () => {
  const save = newSave("double-start");
  json(["claim", "--data", save]);
  eq(json(["session", "start", "--data", save]).code, 0);
  const again = json(["session", "start", "--data", save]);
  eq(again.code, 1);
  eq(again.body.error, "session-active");
});

check("a session cannot start with no points", () => {
  const save = newSave("broke");
  const r = json(["session", "start", "--data", save]);
  eq(r.code, 1);
  eq(r.body.error, "no-points");
});

check("a round outside a session is refused and changes nothing", () => {
  const save = newSave("round-nosession");
  json(["claim", "--data", save]);
  const before = json(["status", "--data", save]).body.balance;
  const r = json(["round", "--predict", "UP", "--risk", "100", "--data", save]);
  eq(r.code, 1);
  eq(r.body.error, "no-session");
  eq(json(["status", "--data", save]).body.balance, before);
});

check("an ended session lands in history exactly once", () => {
  const save = newSave("history-once");
  json(["claim", "--data", save]);
  const started = json(["session", "start", "--data", save]).body.sessionId;
  json(["round", "--predict", "UP", "--risk", "100", "--data", save]);
  json(["session", "end", "--data", save]);
  const h = json(["history", "--data", save]).body;
  eq(h.total, 1);
  eq(h.sessions.filter(s => s.sessionId === started).length, 1, "the session was archived more than once");
});

check("history is capped at CONFIG.HISTORY_LIMIT, newest first", () => {
  /* Writing HISTORY_LIMIT+2 real sessions through the CLI would be 50+ process
     spawns. The cap is enforced in endSession, so seed the file just past the
     limit and let one real session prove the trim. */
  const save = newSave("history-cap");
  const fake = [];
  for (let i = 0; i < CONFIG.HISTORY_LIMIT + 5; i++) {
    fake.push({
      sessionId: "seed_" + i, startedAt: 1000 + i, endedAt: 2000 + i,
      startingBalance: 0, endingBalance: 0, rounds: [], wins: 0, losses: 0,
      totalRisked: 0, totalProfit: 0, totalLoss: 0, largestRisk: 0, largestPayout: 0,
      currentStreak: 0, longestWinStreak: 0, totalRounds: 0, winRate: 0, netResult: 0,
      awards: [], coinsEncountered: []
    });
  }
  fs.writeFileSync(save, JSON.stringify({
    schema: 1, userId: "user_seeded", balance: 20000, lastClaim: null,
    boosts: { profile: false, share: false, submit: false, vote: false },
    session: null, history: fake,
    records: { highestBalance: 0, biggestPayout: 0, bestWinRate: 0, longestStreak: 0, mostRounds: 0, mostRisked: 0, bestSessionId: null, bestSessionNet: null },
    leaderboard: null, votes: null, submittedMemes: []
  }));
  const id = json(["session", "start", "--data", save]).body.sessionId;
  json(["session", "end", "--data", save]);
  const h = json(["history", "--limit", "999", "--data", save]).body;
  eq(h.total, CONFIG.HISTORY_LIMIT, "history was not trimmed to the configured limit");
  eq(h.sessions[0].sessionId, id, "the newest session is not first");
  return CONFIG.HISTORY_LIMIT + " kept of " + (CONFIG.HISTORY_LIMIT + 6);
});

check("archived rounds drop their price chart", () => {
  /* 24 floats per round of every session is what makes a save file grow without
     bound; the chart is only needed while the round is on screen. */
  const save = newSave("trim-chart");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  const live = json(["round", "--predict", "UP", "--risk", "100", "--data", save]).body.round;
  assert(Array.isArray(live.coin.history), "the live round should carry its chart for rendering");
  const archived = json(["session", "end", "--data", save]).body.session.rounds[0];
  assert(!archived.coin.history, "the archived round still carries a 24-point chart");
  eq(archived.coin.ticker, live.coin.ticker, "trimming damaged the round record");
});

check("records ratchet upward and never regress", () => {
  const save = newSave("records");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  for (let i = 0; i < 8; i++) json(["round", "--predict", "UP", "--risk", "1000", "--seed", String(300 + i), "--data", save]);
  json(["session", "end", "--data", save]);
  const first = json(["records", "--data", save]).body.records;

  json(["session", "start", "--data", save]);
  json(["round", "--predict", "UP", "--risk", "100", "--seed", "999", "--data", save]);
  json(["session", "end", "--data", save]);
  const second = json(["records", "--data", save]).body.records;

  for (const k of ["highestBalance", "biggestPayout", "bestWinRate", "longestStreak", "mostRounds", "mostRisked"]) {
    assert(second[k] >= first[k], "record `" + k + "` regressed: " + first[k] + " -> " + second[k]);
  }
  return "6 records held";
});

check("a first losing session is still recorded as the best one", () => {
  /* bestSessionNet starts as null. `net > null` coerces to `net > 0`, so a first
     session that finished down would leave bestSessionId unset forever — the
     null sentinel has to be tested explicitly. */
  const save = newSave("best-negative");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  let net = 0;
  for (let i = 0; i < 25 && net >= 0; i++) {
    const r = json(["round", "--predict", "UP", "--risk", "1000", "--seed", String(11000 + i), "--data", save]);
    if (r.body.ok === false) break;
    net += r.body.round.payout;
  }
  const s = json(["session", "end", "--data", save]).body.session;
  const rec = json(["records", "--data", save]).body.records;
  eq(rec.bestSessionId, s.sessionId, "the only session played was not recorded as the best");
  eq(rec.bestSessionNet, s.netResult);
  return "net " + s.netResult + " recorded";
});

/* ---------------------------------------------------------
   7. Points economy
   --------------------------------------------------------- */
group("7. Points economy");

check("the daily claim grants exactly CONFIG.DAILY_POINTS", () => {
  const save = newSave("daily");
  const r = json(["claim", "--data", save]);
  eq(r.body.claimed, CONFIG.DAILY_POINTS);
  eq(r.body.balance, CONFIG.DAILY_POINTS);
});

check("the claim cooldown is the configured window", () => {
  const save = newSave("cooldown");
  json(["claim", "--data", save]);
  const s = json(["status", "--data", save]).body;
  eq(s.canClaim, false);
  assert(s.cooldownMs > CONFIG.DAILY_CLAIM_WINDOW_MS - 60000 && s.cooldownMs <= CONFIG.DAILY_CLAIM_WINDOW_MS,
    "cooldown was " + s.cooldownMs + "ms, expected ~" + CONFIG.DAILY_CLAIM_WINDOW_MS);
  return Math.round(s.cooldownMs / 3600000) + "h remaining";
});

check("every boost pays its configured reward, exactly once", () => {
  const save = newSave("boosts");
  let balance = json(["claim", "--data", save]).body.balance;
  for (const b of CONFIG.BOOST_ACTIONS) {
    if (b.id === "submit" || b.id === "vote") continue;   // those have their own commands
    const r = json(["boost", b.id, "--data", save]);
    eq(r.code, 0, "boost " + b.id + " failed: " + JSON.stringify(r.body));
    eq(r.body.awarded, b.reward, "boost " + b.id + " paid the wrong reward");
    eq(r.body.balance, balance + b.reward, "boost " + b.id + " moved the balance by the wrong amount");
    balance = r.body.balance;
    const again = json(["boost", b.id, "--data", save]);
    eq(again.code, 1, "boost " + b.id + " could be claimed twice");
    eq(json(["status", "--data", save]).body.balance, balance, "the refused re-claim still paid out");
  }
  return "balance " + balance;
});

check("an unknown boost id is refused without paying", () => {
  const save = newSave("bad-boost");
  const before = json(["claim", "--data", save]).body.balance;
  const r = json(["boost", "free-money", "--data", save]);
  eq(r.code, 1);
  eq(r.body.error, "unknown-boost");
  eq(json(["status", "--data", save]).body.balance, before);
});

check("submitting a coin pays the submit boost once", () => {
  const save = newSave("submit");
  const before = json(["claim", "--data", save]).body.balance;
  const r = json(["submit", "--name", "Test Frog", "--ticker", "tfrog", "--data", save]);
  eq(r.code, 0);
  eq(r.body.awarded, Rules.boostReward("submit"));
  eq(r.body.meme.ticker, "TFROG", "the ticker was not upper-cased");
  eq(r.body.balance, before + Rules.boostReward("submit"));
  eq(json(["submit", "--name", "Again", "--ticker", "AGN", "--data", save]).code, 1, "submitted twice");
});

check("submit requires both --name and --ticker", () => {
  const save = newSave("submit-args");
  json(["claim", "--data", save]);
  eq(run(["submit", "--name", "Only A Name", "--data", save]).code, 2);
  eq(run(["submit", "--ticker", "ONLY", "--data", save]).code, 2);
});

check("voting pays the vote boost once and records the vote", () => {
  const save = newSave("vote");
  const before = json(["claim", "--data", save]).body.balance;
  const ballot = json(["vote", "--data", save]).body;
  eq(ballot.coins.length, 4, "the ballot should hold 4 coins");
  assert(new Set(ballot.coins.map(c => c.ticker)).size === 4, "the ballot has duplicate coins");
  const r = json(["vote", "--pick", "1", "--data", save]);
  eq(r.code, 0);
  eq(r.body.awarded, Rules.boostReward("vote"));
  eq(r.body.balance, before + Rules.boostReward("vote"));
  const again = json(["vote", "--pick", "2", "--data", save]);
  eq(again.code, 1, "voted twice in one round");
  eq(json(["status", "--data", save]).body.balance, r.body.balance, "the refused second vote still paid");
});

check("an out-of-range --pick is a usage error", () => {
  const save = newSave("vote-range");
  json(["claim", "--data", save]);
  json(["vote", "--data", save]);
  eq(run(["vote", "--pick", "9", "--data", save]).code, 2);
  eq(run(["vote", "--pick", "0", "--data", save]).code, 2);
});

/* ---------------------------------------------------------
   8. Read-only views
   --------------------------------------------------------- */
group("8. Views and reports");

check("status reports the live session accurately", () => {
  const save = newSave("status-live");
  json(["claim", "--data", save]);
  const id = json(["session", "start", "--data", save]).body.sessionId;
  json(["round", "--predict", "UP", "--risk", "500", "--data", save]);
  json(["round", "--predict", "DOWN", "--risk", "500", "--data", save]);
  const s = json(["status", "--data", save]).body;
  eq(s.session.sessionId, id);
  eq(s.session.rounds, 2);
  eq(s.session.netSoFar, s.balance - CONFIG.DAILY_POINTS, "netSoFar disagrees with the balance");
});

check("the leaderboard ranks by the requested category, with YOU present", () => {
  const save = newSave("leaderboard");
  json(["claim", "--data", save]);
  const keyOf = { points: "points", payout: "biggestPayout", wins: "wins", winrate: "winRate", streak: "streak" };
  for (const sort of Object.keys(keyOf)) {
    const b = json(["leaderboard", "--sort", sort, "--data", save]).body;
    assert(b.players.length >= 9, sort + ": expected the sim players plus YOU, got " + b.players.length);
    assert(b.players.some(p => p.isMe), sort + ": YOU is missing from the standings");
    const k = keyOf[sort];
    for (let i = 1; i < b.players.length; i++) {
      assert(b.players[i - 1][k] >= b.players[i][k],
        sort + " is not sorted descending at index " + i + " (" + b.players[i - 1][k] + " then " + b.players[i][k] + ")");
    }
  }
  return "5 categories sorted";
});

check("win rate never exceeds 100% (the operator-precedence bug)", () => {
  /* `wins / (wins + losses || 1)` parses as `wins / (wins + (losses || 1))`,
     which reported a 5-win/0-loss player as 83%. Both the browser and the CLI
     read from the same corrected expression; this proves the CLI's copy. */
  const save = newSave("winrate-bound");
  json(["claim", "--data", save]);
  const b = json(["leaderboard", "--sort", "winrate", "--data", save]).body;
  const bad = b.players.filter(p => p.winRate > 100 || p.winRate < 0);
  assert(bad.length === 0, "impossible win rate(s): " + bad.map(p => p.name + " " + p.winRate).join(", "));
  const perfect = b.players.filter(p => p.wins > 0 && p.losses === 0);
  for (const p of perfect) eq(Math.round(p.winRate), 100, p.name + " went " + p.wins + "-0 but shows " + p.winRate + "%");
});

check("history --id returns that exact session", () => {
  const save = newSave("history-id");
  json(["claim", "--data", save]);
  const id = json(["session", "start", "--data", save]).body.sessionId;
  json(["round", "--predict", "UP", "--risk", "100", "--data", save]);
  json(["session", "end", "--data", save]);
  const r = json(["history", "--id", id, "--data", save]);
  eq(r.body.session.sessionId, id);
  eq(json(["history", "--id", "sess_nope", "--data", save]).code, 1);
});

check("history --limit is respected", () => {
  const save = newSave("history-limit");
  json(["claim", "--data", save]);
  for (let i = 0; i < 3; i++) {
    json(["session", "start", "--data", save]);
    json(["round", "--predict", "UP", "--risk", "100", "--data", save]);
    json(["session", "end", "--data", save]);
  }
  eq(json(["history", "--limit", "2", "--data", save]).body.sessions.length, 2);
  eq(json(["history", "--data", save]).body.total, 3);
});

check("share text carries the real numbers from the run", () => {
  const save = newSave("share");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  for (let i = 0; i < 5; i++) json(["round", "--predict", "UP", "--risk", "500", "--seed", String(50 + i), "--data", save]);
  const s = json(["session", "end", "--data", save]).body.session;
  const text = json(["share", "--data", save]).body.text;
  assert(text.includes(String(s.totalRounds) + " rounds"), "round count missing from the share card");
  assert(text.includes(Math.round(s.winRate) + "% win rate"), "win rate missing from the share card");
  assert(text.includes(s.endingBalance.toLocaleString("en-US")), "final balance missing from the share card");
  assert(!ANSI.test(text), "the share card contains ANSI escapes — it is meant to be pasted");
  return text.split("\n")[2];
});

check("share with nothing played exits 1 rather than printing an empty card", () => {
  eq(json(["share", "--data", newSave("share-empty")]).code, 1);
});

check("rules reports the same numbers rules.js holds", () => {
  const b = json(["rules", "--data", newSave("rules")]).body;
  eq(b.dailyPoints, CONFIG.DAILY_POINTS);
  eq(b.roundSeconds, CONFIG.ROUND_SECONDS);
  eq(b.multiplier, CONFIG.PAYOUT_MULTIPLIER);
  eq(b.historyLimit, CONFIG.HISTORY_LIMIT);
  eq(b.outcomes.length, Rules.OUTCOMES.length);
  eq(b.awards.length, Object.keys(Rules.AWARD_DEFS).length);
  const total = b.outcomes.reduce((a, o) => a + o.chance, 0);
  assert(Math.abs(total - 1) < 1e-9, "outcome chances sum to " + total + ", not 1");
  return b.outcomes.length + " outcomes, " + b.awards.length + " awards";
});

/* ---------------------------------------------------------
   9. The save file
   --------------------------------------------------------- */
group("9. Save file durability");

check("--data is honoured and the real home save is never touched", () => {
  const save = newSave("data-flag");
  const home = path.join(os.homedir(), ".cade-meme-madness.json");
  const before = fs.existsSync(home) ? fs.statSync(home).mtimeMs : null;
  json(["claim", "--data", save]);
  assert(fs.existsSync(save), "--data did not create the file it was given");
  const after = fs.existsSync(home) ? fs.statSync(home).mtimeMs : null;
  eq(after, before, "the player's real save file was modified by a test run");
});

check("CADE_DATA env var relocates the save file", () => {
  const save = newSave("env-data");
  const r = json(["claim"], { env: { CADE_DATA: save } });
  eq(r.code, 0);
  assert(fs.existsSync(save), "CADE_DATA was ignored");
});

check("--data wins over CADE_DATA", () => {
  const flagSave = newSave("precedence-flag");
  const envSave = newSave("precedence-env");
  json(["claim", "--data", flagSave], { env: { CADE_DATA: envSave } });
  assert(fs.existsSync(flagSave), "--data target was not written");
  assert(!fs.existsSync(envSave), "CADE_DATA target was written even though --data was given");
});

check("the save file is valid JSON after every command", () => {
  const save = newSave("valid-json");
  const seq = [["claim"], ["boost", "profile"], ["session", "start"],
               ["round", "--predict", "UP", "--risk", "500"], ["vote", "--pick", "1"],
               ["submit", "--name", "X", "--ticker", "XX"], ["session", "end"], ["leaderboard"]];
  for (const cmd of seq) {
    json(cmd.concat(["--data", save]));
    const raw = fs.readFileSync(save, "utf8");
    try { JSON.parse(raw); }
    catch (e) { throw new Error("save file was left unparseable after `" + cmd.join(" ") + "`"); }
  }
  return seq.length + " commands";
});

check("the save file is written 0600, not world-readable", () => {
  const save = newSave("perms");
  json(["claim", "--data", save]);
  const mode = fs.statSync(save).mode & 0o777;
  assert((mode & 0o077) === 0, "save file is mode " + mode.toString(8) + " — other users can read it");
  return "0" + mode.toString(8);
});

check("no temp files are left behind", () => {
  /* Saves are written to a temp file and renamed so an interrupt cannot leave a
     half-written save. That only holds up if the rename actually happens. */
  const dir = fs.mkdtempSync(path.join(TMP, "atomic-"));
  const save = path.join(dir, "state.json");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  json(["round", "--predict", "UP", "--risk", "100", "--data", save]);
  const leftovers = fs.readdirSync(dir).filter(f => f !== "state.json");
  assert(leftovers.length === 0, "temp files left in the save directory: " + leftovers.join(", "));
});

check("a corrupt save file is reported, not silently reset", () => {
  const save = newSave("corrupt");
  fs.writeFileSync(save, "{ this is not json");
  const r = run(["status", "--data", save]);
  eq(r.code, 3, "a corrupt save should be an internal error, not a fresh start");
  assert(/corrupt/i.test(r.stderr), r.stderr.trim());
  eq(fs.readFileSync(save, "utf8"), "{ this is not json", "the corrupt file was overwritten — data that might be recoverable is gone");
});

check("a save file from an older schema is upgraded, not rejected", () => {
  /* A player's file predates fields added later. Missing nested objects must be
     filled in rather than read as undefined at the first property access. */
  const save = newSave("old-schema");
  fs.writeFileSync(save, JSON.stringify({ userId: "user_ancient", balance: 1234 }));
  const s = json(["status", "--data", save]).body;
  eq(s.balance, 1234, "the old balance was lost");
  assert(s.boosts && typeof s.boosts.profile === "boolean", "boosts were not backfilled");
  const r = json(["boost", "share", "--data", save]);
  eq(r.code, 0, "an upgraded file could not be played: " + JSON.stringify(r.body));
  eq(r.body.balance, 1234 + Rules.boostReward("share"));
});

check("a save file in a directory that does not exist yet is created", () => {
  const save = path.join(TMP, "deep", "nested", "state.json");
  const r = json(["claim", "--data", save]);
  eq(r.code, 0, JSON.stringify(r.body));
  assert(fs.existsSync(save), "the parent directories were not created");
});

check("state survives across processes", () => {
  const save = newSave("persistence");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  const mid = json(["round", "--predict", "UP", "--risk", "1000", "--data", save]).body.balance;
  eq(json(["status", "--data", save]).body.balance, mid, "the balance did not survive the process boundary");
  const s = json(["session", "end", "--data", save]).body.session;
  eq(s.rounds.length, 1, "the round played by an earlier process was lost");
});

check("reset erases everything and refuses to do so unprompted", () => {
  const save = newSave("reset");
  json(["claim", "--data", save]);
  const blocked = run(["reset", "--data", save]);
  eq(blocked.code, 2, "reset erased without --yes on a non-TTY");
  eq(json(["status", "--data", save]).body.balance, CONFIG.DAILY_POINTS, "the blocked reset still erased data");
  eq(json(["reset", "--yes", "--data", save]).code, 0);
  const after = json(["status", "--data", save]).body;
  eq(after.balance, 0);
  eq(after.sessionsPlayed, 0);
  eq(after.canClaim, true);
});

/* ---------------------------------------------------------
   10. Shared-rules wiring — the drift guard
   --------------------------------------------------------- */
group("10. The CLI cannot drift from the browser build");

check("cli.js sources its rules from rules.js and re-declares none of them", () => {
  const src = fs.readFileSync(CLI, "utf8");
  assert(/require\(["']\.\/rules\.js["']\)/.test(src), "cli.js does not require ./rules.js");
  const decl = /(?:const|let|var)\s+(OUTCOMES|COIN_POOL|AWARD_DEFS|SIM_PLAYERS_BASE|RISK_TIERS)\s*=\s*[[{]/;
  assert(!decl.test(src), "cli.js declares its own copy of " + (src.match(decl) || [])[1] +
    " — that is exactly how the ±18% / ±40% divergence happened");
  const nums = /(?:PAYOUT_MULTIPLIER|DAILY_POINTS|DYNAMIC_COIN_CHANCE|ROUND_SECONDS)\s*:\s*[\d.]/;
  assert(!nums.test(src), "cli.js hard-codes a tunable that belongs in rules.js");
});

check("the CLI is excluded from the Vercel deployment", () => {
  /* The web build is static files only. Shipping cli.js would publish a Node
     entry point that can never run there. */
  const ignore = fs.readFileSync(path.join(ROOT, ".vercelignore"), "utf8");
  assert(/^cli\.js$/m.test(ignore), "cli.js is not in .vercelignore — it would be uploaded to Vercel");
});

check("no credential is embedded in cli.js", () => {
  const src = fs.readFileSync(CLI, "utf8");
  assert(!/gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}/.test(src), "a token is hard-coded in cli.js");
});

check("every coin dealt comes from the shared pool or is a generated one", () => {
  const save = newSave("coin-source");
  json(["claim", "--data", save]);
  json(["session", "start", "--data", save]);
  const known = new Set(Rules.COIN_POOL.map(c => c[0]));
  const strays = [];
  for (let i = 0; i < 20; i++) {
    const r = json(["round", "--predict", "UP", "--risk", "100", "--seed", String(400 + i), "--data", save]);
    if (r.body.ok === false) break;
    const c = r.body.round.coin;
    if (!c.isGenerated && !known.has(c.ticker)) strays.push(c.ticker);
    if (typeof c.price !== "number" || !(c.price > 0)) strays.push(c.ticker + " has price " + c.price);
    if (!c.emoji) strays.push(c.ticker + " has no emoji");
  }
  assert(strays.length === 0, "coin(s) not traceable to rules.js: " + strays.join(", "));
});

/* =====================================================
   REPORT
   ===================================================== */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* leave it for inspection */ }

console.log("\n" + "=".repeat(60));
if (failures.length === 0) {
  console.log("PASS — " + passed + " checks, 0 failures");
  process.exit(0);
}
console.log("FAIL — " + passed + " passed, " + failures.length + " failed\n");
failures.forEach(f => console.log("  ✗ " + f.name + "\n      " + f.message));
process.exit(1);
