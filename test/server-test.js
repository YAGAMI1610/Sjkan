/* =====================================================
   CADE MEME MADNESS — Server Contract Test
   -----------------------------------------------------
   Boots server/server.js on an ephemeral port and exercises every endpoint the
   client calls, asserting the contracts api-client.js depends on.

   This is the half of the build where the damaging bugs lived, because none of
   them are reachable with the app running as static files: the client silently
   falls back to its local simulation, so a broken server looks like a working
   game right up until someone deploys the backend. Specifically covered here:

     - /round/submit crediting `round.profit` (a field the client never sends),
       which turned the account balance into NaN on the first win — permanently,
       and poisoned the leaderboard and records with it
     - /round/outcome labelling DOWN rows with positive percentages
     - the dir:"FLAT" row, which the client can never match against UP/DOWN
     - bestSessionNet initialised to -Infinity, which JSON cannot represent

   Run:  npm run test:server      (needs server deps: npm --prefix server install)
   ===================================================== */

const path = require("path");
const http = require("http");

const SERVER_DIR = path.join(__dirname, "..", "server");

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

let app;
try {
  // server.js calls app.listen() itself and exports the app; requiring it from
  // its own directory is what makes its node_modules resolvable.
  process.env.PORT = "0"; // ephemeral — never collide with a dev server
  app = require(path.join(SERVER_DIR, "server.js"));
} catch (e) {
  if (/Cannot find module/.test(e.message)) {
    console.error("server deps missing. Run: npm --prefix server install");
    process.exit(2);
  }
  throw e;
}

/* ---------------- request helper ---------------- */
let PORT = null;

function api(method, route, body, deviceId) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: "127.0.0.1", port: PORT, path: "/api" + route, method,
      headers: Object.assign(
        { "X-Device-Id": deviceId || "dev_test_a" },
        payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}
      )
    }, res => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (e) { /* non-JSON body */ }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------------- tests ---------------- */
(async function run() {
  console.log("CADE MEME MADNESS — server contract test");

  // server.js already started listening on the ephemeral port; find it.
  await new Promise(r => setTimeout(r, 250));
  const servers = process._getActiveHandles().filter(h => h && h.constructor && h.constructor.name === "Server");
  assert(servers.length > 0, "server.js did not start listening");
  PORT = servers[0].address().port;

  group("1. Health + auth");
  {
    const h = await api("GET", "/health");
    check("GET /health responds ok", () => { eq(h.status, 200); eq(h.body.ok, true); });
  }
  {
    // Same request without the device header the client always sends.
    const r = await new Promise(resolve => {
      const req = http.request({ host: "127.0.0.1", port: PORT, path: "/api/leaderboard", method: "GET" },
        res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", () => resolve(0));
      req.end();
    });
    check("a request with no X-Device-Id is rejected", () => eq(r, 401));
  }

  group("2. Daily claim is enforced server-side (§12)");
  {
    const first = await api("POST", "/daily-claim", {}, "dev_claim");
    check("first claim credits 20,000", () => {
      eq(first.status, 200);
      eq(first.body.claimed, 20000);
      eq(first.body.balance, 20000);
    });
    const second = await api("POST", "/daily-claim", {}, "dev_claim");
    check("second claim is 429 with a retry window", () => {
      eq(second.status, 429);
      assert(typeof second.body.retryInMs === "number" && second.body.retryInMs > 0,
        "no usable retryInMs: " + JSON.stringify(second.body));
      return Math.round(second.body.retryInMs / 3600000) + "h to go";
    });
    const after = await api("GET", "/records", {}, "dev_claim");
    check("the rejected claim did not credit anything", () => eq(after.status, 200));
  }

  group("3. Round outcomes (§9) — direction can never contradict the %");
  {
    const seen = {};
    let bad = null, flat = 0;
    for (let i = 0; i < 300; i++) {
      const r = await api("POST", "/round/outcome", {}, "dev_outcome");
      const o = r.body && r.body.outcome;
      if (!o) { bad = "no outcome in response: " + r.raw; break; }
      seen[o.key] = (seen[o.key] || 0) + 1;
      if (o.dir !== "UP" && o.dir !== "DOWN") { flat++; bad = bad || "unpredictable dir: " + o.dir; }
      if ((o.dir === "UP") !== (o.pctVal >= 0)) {
        bad = bad || "contradiction: " + o.key + " dir=" + o.dir + " pct=" + o.pctVal;
      }
      if (typeof o.roundId !== "string") bad = bad || "missing roundId";
    }
    check("300 outcomes, every dir matches the sign of pctVal", () => {
      assert(!bad, bad);
      return Object.keys(seen).length + " distinct rows seen";
    });
    check("no outcome is ever a third direction the client cannot predict", () => eq(flat, 0));
  }
  {
    const r = await api("POST", "/round/outcome", {}, "dev_outcome");
    check("outcome envelope shape", () => {
      assert(r.body && typeof r.body === "object" && r.body.outcome, "not wrapped in .outcome");
      for (const k of ["key", "pctVal", "dir", "roundId"]) assert(k in r.body.outcome, "outcome missing " + k);
    });
  }

  group("4. Balance is authoritative and never NaN (the round.profit bug)");
  {
    const D = "dev_balance";
    await api("POST", "/daily-claim", {}, D);
    const sessionId = "sess_test_1";
    const start = await api("POST", "/session/start", { session: { sessionId, rounds: [] } }, D);
    check("session/start accepts the client's session", () => eq(start.status, 200));

    // The client's round record: `payout` is the signed delta. There is no
    // `profit` field — the server used to add exactly that, hence NaN.
    const win = await api("POST", "/round/submit", {
      sessionId, round: { roundId: "r1", result: "WIN", riskAmount: 1000, payout: 1800 }
    }, D);
    check("a WIN credits +1,800 on a 1,000 stake (risk × 1.8, §11)", () => {
      eq(win.status, 200);
      eq(win.body.balance, 21800);
      assert(win.body.balance === win.body.balance, "balance is NaN");
    });

    const loss = await api("POST", "/round/submit", {
      sessionId, round: { roundId: "r2", result: "LOSS", riskAmount: 500, payout: -500 }
    }, D);
    check("a LOSS debits the stake", () => eq(loss.body.balance, 21300));

    const skip = await api("POST", "/round/submit", {
      sessionId, round: { roundId: "r3", result: "SKIPPED", riskAmount: 0, payout: 0 }
    }, D);
    check("a SKIPPED round moves nothing", () => eq(skip.body.balance, 21300));

    const junk = await api("POST", "/round/submit", {
      sessionId, round: { roundId: "r4", result: "WIN", riskAmount: 100 } // no payout at all
    }, D);
    check("a round with no payout cannot poison the balance", () => {
      eq(junk.body.balance, 21300, "a malformed round changed the balance");
      assert(Number.isFinite(junk.body.balance), "balance is no longer finite");
    });

    const orphan = await api("POST", "/round/submit", {
      sessionId: "sess_does_not_exist", round: { payout: 999999 }
    }, D);
    check("a round for an unknown session is rejected", () => eq(orphan.status, 400));

    const end = await api("POST", "/session/end", {
      sessionId,
      session: { sessionId, netResult: 1300, totalRounds: 4, winRate: 50, largestPayout: 1800, totalRisked: 1600, longestWinStreak: 1 }
    }, D);
    check("session/end returns finite records, no Infinity", () => {
      eq(end.status, 200);
      assert(Number.isFinite(end.body.balance), "balance " + end.body.balance);
      eq(end.body.records.bestSessionNet, 1300);
      assert(!/Infinity/.test(JSON.stringify(end.body)), "Infinity leaked into JSON");
      return "bestSessionNet " + end.body.records.bestSessionNet;
    });

    const hist = await api("GET", "/history", undefined, D);
    check("the ended session is in /history", () => {
      eq(hist.status, 200);
      assert(hist.body.sessions.some(s => s.sessionId === sessionId), "session not archived");
      return hist.body.sessions.length + " session(s)";
    });
  }

  group("5. bestSessionNet starts as null, not -Infinity");
  {
    const fresh = await api("GET", "/records", undefined, "dev_fresh_records");
    check("a brand-new account reports null", () => {
      eq(fresh.status, 200);
      eq(fresh.body.records.bestSessionNet, null);
    });
    check("serialising it does not produce Infinity", () => {
      assert(!/Infinity/.test(fresh.raw), fresh.raw.slice(0, 120));
    });
    // -Infinity would serialise to null too, so the real test is that a genuine
    // loss-making session still registers as the best one so far.
    const D = "dev_negative_net";
    await api("POST", "/session/start", { session: { sessionId: "s_neg", rounds: [] } }, D);
    await api("POST", "/session/end", { sessionId: "s_neg", session: { sessionId: "s_neg", netResult: -4000 } }, D);
    const rec = await api("GET", "/records", undefined, D);
    check("a losing session is still recorded as the best so far", () => {
      eq(rec.body.records.bestSessionNet, -4000,
        "a negative net was discarded — the null guard is missing, so `> null` behaved as `> 0`");
    });
  }

  group("6. One-shot actions are rate limited (§12)");
  {
    const D = "dev_boosts";
    const b1 = await api("POST", "/boost", { id: "share" }, D);
    check("first boost pays out", () => { eq(b1.status, 200); eq(b1.body.awarded, 500); });
    const b2 = await api("POST", "/boost", { id: "share" }, D);
    check("the same boost twice is 429", () => eq(b2.status, 429));
    const b3 = await api("POST", "/boost", { id: "not_a_boost" }, D);
    check("an unknown boost id is 400", () => eq(b3.status, 400));

    const v1 = await api("POST", "/vote", { roundId: "vr1" }, D);
    check("first vote in a round is accepted", () => eq(v1.status, 200));
    const v2 = await api("POST", "/vote", { roundId: "vr1" }, D);
    check("voting twice in the same round is 429", () => eq(v2.status, 429));
    const v3 = await api("POST", "/vote", { roundId: "vr2" }, D);
    check("a different round is votable again", () => eq(v3.status, 200));
    const v4 = await api("POST", "/vote", {}, D);
    check("a vote with no roundId is 400", () => eq(v4.status, 400));

    const m1 = await api("POST", "/meme/submit", { meme: { name: "Moon Frog", ticker: "MOONFROG" } }, D);
    check("a meme submission is accepted and judged", () => {
      eq(m1.status, 200);
      assert(typeof m1.body.qualifies === "boolean", "no qualifies verdict");
    });
    const m2 = await api("POST", "/meme/submit", { meme: { name: "no ticker" } }, D);
    check("a submission with no ticker is 400", () => eq(m2.status, 400));
  }

  group("7. Leaderboard (§11)");
  {
    const D = "dev_lb";
    await api("POST", "/daily-claim", {}, D);
    const lb = await api("GET", "/leaderboard", undefined, D);
    check("returns a player list including exactly one YOU", () => {
      eq(lb.status, 200);
      assert(Array.isArray(lb.body.players), "players is not an array");
      const me = lb.body.players.filter(p => p.isMe);
      eq(me.length, 1, "found " + me.length + " rows flagged isMe");
      eq(me[0].points, 20000, "YOU points do not match the account balance");
      return lb.body.players.length + " players";
    });
    check("no player has a non-finite score", () => {
      const bad = lb.body.players.filter(p => !Number.isFinite(p.points));
      assert(bad.length === 0, JSON.stringify(bad.slice(0, 2)));
    });
  }

  group("8. Accounts are isolated per device (§10)");
  {
    const a = await api("POST", "/daily-claim", {}, "dev_iso_a");
    const b = await api("GET", "/leaderboard", undefined, "dev_iso_b");
    check("device A's claim does not credit device B", () => {
      eq(a.body.balance, 20000);
      eq(b.body.players.find(p => p.isMe).points, 0);
    });
  }

  group("9. Client/server payout math agrees");
  {
    const clientCfg = require("fs").readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
    const cm = clientCfg.match(/PAYOUT_MULTIPLIER:\s*([\d.]+)/);
    const sm = require("fs").readFileSync(path.join(SERVER_DIR, "server.js"), "utf8").match(/PAYOUT_MULTIPLIER:\s*([\d.]+)/);
    check("PAYOUT_MULTIPLIER matches on both sides", () => {
      assert(cm && sm, "could not find PAYOUT_MULTIPLIER in both files");
      eq(sm[1], cm[1], "server " + sm[1] + " vs client " + cm[1]);
      return "×" + cm[1];
    });
    const cd = clientCfg.match(/DAILY_POINTS:\s*(\d+)/);
    const sd = require("fs").readFileSync(path.join(SERVER_DIR, "server.js"), "utf8").match(/DAILY_POINTS:\s*(\d+)/);
    check("DAILY_POINTS matches on both sides", () => eq(sd[1], cd[1]));
  }

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
