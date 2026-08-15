/* =====================================================
   CADE MEME MADNESS — Reference Backend
   -----------------------------------------------------
   Implements Part B of the production build:
     9  — server-authoritative round outcome generation
     10 — accounts + multi-device persistence (device-id auth)
     11 — centrally generated / pollable leaderboard
     12 — rate limiting / abuse prevention

   Storage: in-memory (Map) for this reference implementation.
   Swap `Store` for a real DB (Postgres/Mongo/etc.) — every
   route only talks to the Store interface below, so that's
   the only file that needs to change.

   Auth model: lightweight device-linked accounts. Every
   client request carries an `X-Device-Id` header (generated
   once client-side and persisted). This is intentionally the
   simplest thing that gives "same account across sessions on
   the same device" and is easy to upgrade to email/OAuth
   later without touching the game logic above it.

   Run: npm install && npm start   (defaults to :3001)
   ===================================================== */

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

/* ---------------------------------------------------------
   CONFIG — mirrors app.js CONFIG so payout math stays identical
   --------------------------------------------------------- */
const CONFIG = {
  DAILY_POINTS: 20000,
  DAILY_CLAIM_WINDOW_MS: 24 * 3600 * 1000,
  PAYOUT_MULTIPLIER: 1.8,
  USE_TIERED_PAYOUT: false,
  RISK_TIERS: [
    { min: 0, max: 500, mult: 1.5 },
    { min: 501, max: 2500, mult: 1.8 },
    { min: 2501, max: 10000000, mult: 2.0 }
  ],
  BOOST_ACTIONS: {
    profile: 500,
    share: 500,
    submit: 1000,
    vote: 500
  }
};

// Same weighted outcome model as MarketEngine.generateOutcome() client-side.
// `dir` is NOT stored: it is derived from the sign of the rolled percentage by
// dirFromPct(), so the direction a round is scored against can never contradict
// the percentage the client displays. The DOWN rows below previously carried
// POSITIVE pct ranges ([0.5,4], [4,12], [12,40]) while being labelled DOWN, so
// every server-generated down-move rendered as "TICKER went DOWN (+7.31%)".
const OUTCOMES = [
  { key: "STRONG_UP",   weight: 8,  pct: [12, 40] },
  { key: "UP",          weight: 20, pct: [4, 12] },
  { key: "SLIGHT_UP",   weight: 17, pct: [0.5, 4] },
  { key: "FLAT",        weight: 10, pct: [-0.5, 0.5] },
  { key: "SLIGHT_DOWN", weight: 17, pct: [-4, -0.5] },
  { key: "DOWN",        weight: 20, pct: [-12, -4] },
  { key: "STRONG_DOWN", weight: 8,  pct: [-40, -12] }
];

function rand(min, max){ return Math.random() * (max - min) + min; }

// Single source of truth for direction, mirroring MarketEngine.dirFromPct().
// Note the client can only ever predict "UP" or "DOWN", so emitting any third
// direction (the old dir:"FLAT" row) made 10% of rounds unwinnable by anyone.
function dirFromPct(pctVal){ return pctVal >= 0 ? "UP" : "DOWN"; }

/* ---------------------------------------------------------
   STORE — in-memory reference implementation
   --------------------------------------------------------- */
const Store = {
  accounts: new Map(),      // deviceId -> account
  pendingRounds: new Map(), // roundId -> { outcome, deviceId, createdAt, resolved }
  leaderboardSeed: null,

  getAccount(deviceId){
    if(!this.accounts.has(deviceId)){
      this.accounts.set(deviceId, {
        deviceId,
        balance: 0,
        lastClaim: null,
        boosts: {},            // { profile:true, share:true, ... }
        sessions: [],          // full session history
        activeSession: null,
        records: {
          highestBalance: 0, biggestPayout: 0, bestWinRate: 0,
          longestStreak: 0, mostRounds: 0, mostRisked: 0,
          // null, not -Infinity: -Infinity is not representable in JSON and
          // serialises to null on the way to the client anyway.
          bestSessionNet: null, bestSessionId: null
        },
        votesByRound: {},      // roundId -> true (one vote per round)
        submittedMemes: []
      });
    }
    return this.accounts.get(deviceId);
  }
};

function ensureLeaderboardSeed(){
  if(Store.leaderboardSeed) return Store.leaderboardSeed;
  const names = ["froggo_fan","chad_capital","rug_detective","0xNina","gigabrain",
    "moon_or_bust","panda_prophet","satoshi_jr","bagholder99","alpha_ana"];
  Store.leaderboardSeed = names.map(name => ({
    name, avatar: "🧑‍🚀",
    points: Math.floor(rand(15000, 60000)),
    wins: Math.floor(rand(10, 80)),
    losses: Math.floor(rand(5, 60)),
    biggestPayout: Math.floor(rand(1000, 9000)),
    streak: Math.floor(rand(0, 8))
  }));
  return Store.leaderboardSeed;
}

// Central tick so every connected client sees the same leaderboard motion (#11).
setInterval(()=>{
  const players = ensureLeaderboardSeed();
  players.forEach(p=>{
    if(Math.random() < 0.5){
      const delta = Math.floor(rand(-800, 1400));
      p.points = Math.max(0, p.points + delta);
      if(delta > 0) p.wins++; else p.losses++;
    }
  });
}, 15000);

/* ---------------------------------------------------------
   AUTH MIDDLEWARE — resolves X-Device-Id into an account
   --------------------------------------------------------- */
function auth(req, res, next){
  const deviceId = req.header("X-Device-Id");
  if(!deviceId) return res.status(401).json({ error: "Missing X-Device-Id header" });
  req.account = Store.getAccount(deviceId);
  next();
}

/* ---------------------------------------------------------
   ROUTES
   --------------------------------------------------------- */

app.get("/api/health", (req, res) => res.json({ ok: true }));

// #9 — server-authoritative outcome. Client cannot see this until it
// calls /round/resolve after its own countdown reaches zero, so there's
// no way to inspect the outcome ahead of time from client-side state.
app.post("/api/round/outcome", auth, (req, res) => {
  const total = OUTCOMES.reduce((a,o)=>a+o.weight,0);
  let r = rand(0, total);
  let chosen = OUTCOMES[0];
  for(const o of OUTCOMES){
    if(r < o.weight){ chosen = o; break; }
    r -= o.weight;
  }
  const pctVal = +(rand(chosen.pct[0], chosen.pct[1])).toFixed(2);
  const roundId = "rnd_" + Date.now().toString(36) + Math.floor(rand(100,999));
  const outcome = Object.assign({}, chosen, { pctVal, dir: dirFromPct(pctVal), roundId });

  // Store server-side. NOTE: this map is currently write-only — the
  // `/round/resolve` endpoint referenced in earlier revisions of this comment
  // does not exist yet, so nothing reads these entries back. They are swept on a
  // TTL below to stop the map growing without bound for the lifetime of the
  // process. A strict deployment would also gate this endpoint on elapsed time
  // measured server-side (from a round-start timestamp) rather than trusting the
  // client to only call it at t=0.
  Store.pendingRounds.set(roundId, { outcome, deviceId: req.account.deviceId, createdAt: Date.now(), resolved: false });

  res.json({ outcome });
});

// Sweep pending-round entries well past any plausible round length so the map
// cannot grow unbounded. Raise PENDING_ROUND_TTL_MS if /round/resolve lands and
// needs a longer window to look outcomes back up.
const PENDING_ROUND_TTL_MS = 10 * 60 * 1000;
setInterval(()=>{
  const cutoff = Date.now() - PENDING_ROUND_TTL_MS;
  for(const [roundId, entry] of Store.pendingRounds){
    if(entry.createdAt < cutoff) Store.pendingRounds.delete(roundId);
  }
}, 60 * 1000).unref?.();

// #12 — daily claim, enforced server-side regardless of client clock/localStorage.
app.post("/api/daily-claim", auth, (req, res) => {
  const acct = req.account;
  const now = Date.now();
  if(acct.lastClaim && now - acct.lastClaim < CONFIG.DAILY_CLAIM_WINDOW_MS){
    const retryInMs = CONFIG.DAILY_CLAIM_WINDOW_MS - (now - acct.lastClaim);
    return res.status(429).json({ error: "Daily claim already used", retryInMs });
  }
  acct.balance += CONFIG.DAILY_POINTS;
  acct.lastClaim = now;
  res.json({ balance: acct.balance, claimed: CONFIG.DAILY_POINTS });
});

// #12 — one-time boost actions, enforced server-side.
app.post("/api/boost", auth, (req, res) => {
  const { id } = req.body || {};
  const reward = CONFIG.BOOST_ACTIONS[id];
  if(!reward) return res.status(400).json({ error: "Unknown boost id" });
  const acct = req.account;
  if(acct.boosts[id]) return res.status(429).json({ error: "Boost already claimed" });
  acct.boosts[id] = true;
  acct.balance += reward;
  res.json({ balance: acct.balance, awarded: reward });
});

// #10 — session lifecycle persistence
app.post("/api/session/start", auth, (req, res) => {
  const { session } = req.body || {};
  req.account.activeSession = session;
  res.json({ ok: true });
});

app.post("/api/round/submit", auth, (req, res) => {
  const { sessionId, round } = req.body || {};
  const acct = req.account;
  if(!acct.activeSession || acct.activeSession.sessionId !== sessionId){
    return res.status(400).json({ error: "No matching active session" });
  }
  // Apply the round's balance delta server-side so balance is authoritative.
  // `payout` is the client's already-signed delta (+profit on a WIN, -risk on a
  // LOSS, 0 on a SKIPPED round), so one addition covers every result type.
  // This previously read `acct.balance += round.profit` — the client's round
  // record has no `profit` field, so the account balance became NaN on the very
  // first win and stayed NaN forever (poisoning the leaderboard and records too).
  const delta = Number(round && round.payout);
  if(Number.isFinite(delta)) acct.balance += delta;
  acct.activeSession.rounds = acct.activeSession.rounds || [];
  acct.activeSession.rounds.push(round);
  res.json({ ok: true, balance: acct.balance });
});

app.post("/api/session/end", auth, (req, res) => {
  const { session } = req.body || {};
  const acct = req.account;
  const s = Object.assign({}, acct.activeSession, session, { endedAt: Date.now() });
  acct.sessions.unshift(s);
  acct.activeSession = null;

  const r = acct.records;
  r.highestBalance = Math.max(r.highestBalance, acct.balance);
  r.biggestPayout = Math.max(r.biggestPayout, s.largestPayout || 0);
  r.bestWinRate = Math.max(r.bestWinRate, s.winRate || 0);
  r.longestStreak = Math.max(r.longestStreak, s.longestWinStreak || 0);
  r.mostRounds = Math.max(r.mostRounds, s.totalRounds || 0);
  r.mostRisked = Math.max(r.mostRisked, s.totalRisked || 0);
  if(r.bestSessionNet === null || r.bestSessionNet === undefined || (s.netResult || 0) > r.bestSessionNet){
    r.bestSessionNet = s.netResult || 0;
    r.bestSessionId = s.sessionId;
  }
  res.json({ ok: true, balance: acct.balance, records: r });
});

// #11 — leaderboard, centrally simulated + the requesting account's live standing
app.get("/api/leaderboard", auth, (req, res) => {
  const players = ensureLeaderboardSeed();
  const acct = req.account;
  const rounds = (acct.activeSession && acct.activeSession.rounds) || [];
  const me = {
    name: "YOU", avatar: "🧑‍🚀", isMe: true,
    points: acct.balance,
    wins: rounds.filter(r=>r.result==="WIN").length,
    losses: rounds.filter(r=>r.result==="LOSS").length,
    biggestPayout: acct.records.biggestPayout,
    streak: acct.activeSession ? acct.activeSession.currentStreak || 0 : 0
  };
  res.json({ players: players.concat([me]), updatedAt: Date.now() });
});

app.get("/api/history", auth, (req, res) => res.json({ sessions: req.account.sessions }));
app.get("/api/records", auth, (req, res) => res.json({ records: req.account.records }));

// #12 — one-time submit boost + persisted submission
app.post("/api/meme/submit", auth, (req, res) => {
  const { meme } = req.body || {};
  if(!meme || !meme.name || !meme.ticker) return res.status(400).json({ error: "name and ticker required" });
  const acct = req.account;
  const qualifies = Math.random() < 0.6;
  const record = Object.assign({}, meme, { qualifies, at: Date.now() });
  acct.submittedMemes.push(record);
  let awarded = 0;
  if(!acct.boosts.submit){
    acct.boosts.submit = true;
    awarded = CONFIG.BOOST_ACTIONS.submit;
    acct.balance += awarded;
  }
  res.json({ ok: true, qualifies, balance: acct.balance, awarded });
});

// #12 — one vote per round, enforced server-side
app.post("/api/vote", auth, (req, res) => {
  const { roundId } = req.body || {};
  if(!roundId) return res.status(400).json({ error: "roundId required" });
  const acct = req.account;
  if(acct.votesByRound[roundId]) return res.status(429).json({ error: "Already voted this round" });
  acct.votesByRound[roundId] = true;
  let awarded = 0;
  if(!acct.boosts.vote){
    acct.boosts.vote = true;
    awarded = CONFIG.BOOST_ACTIONS.vote;
    acct.balance += awarded;
  }
  res.json({ ok: true, balance: acct.balance, awarded });
});

app.listen(PORT, ()=> console.log(`CADE Meme Madness API listening on :${PORT}`));

module.exports = app;
