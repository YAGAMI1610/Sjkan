/* =====================================================
   CADE MEME MADNESS — Shared Rules
   -----------------------------------------------------
   The one place the game's rules live. Loaded by all three front ends:

     index.html  -> <script src="rules.js">  (global CadeRules)
     cli.js      -> require("./rules.js")
     server/     -> require("../rules.js")

   This file exists because the rules were previously written out three times,
   and they drifted — twice. The reference backend rolled ±40% price moves while
   the browser rolled ±18%, and its FLAT row was weighted differently, so the
   game was measurably a different game depending on whether a backend happened
   to be reachable. Balances computed for "the same" round disagreed.

   Nothing in here touches the DOM, the filesystem, the network or any global
   state. It is pure rules + pure functions, which is what makes it safe to load
   into a browser, a terminal and a server process alike.

   The UMD wrapper is deliberate: the browser build is plain <script> tags with
   no bundler and no module system, so an ES export here would mean adding a
   build step to a project that does not need one.
   ===================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CadeRules = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------
     CONFIG — every tunable number in the game
     --------------------------------------------------------- */
  var CONFIG = {
    DAILY_POINTS: 20000,
    DAILY_CLAIM_WINDOW_MS: 24 * 3600 * 1000,
    ROUND_SECONDS: 25,
    PAYOUT_MULTIPLIER: 1.8, // default flat multiplier
    RISK_TIERS: [
      { min: 0, max: 500, mult: 1.5 },
      { min: 501, max: 2500, mult: 1.8 },
      { min: 2501, max: 10000000, mult: 2.0 }
    ],
    USE_TIERED_PAYOUT: false, // toggle to true to use RISK_TIERS instead of flat multiplier
    // §8 — share of rounds that mint a brand-new ticker instead of drawing from
    // the curated COIN_POOL. 0 = curated only, 1 = always freshly generated.
    DYNAMIC_COIN_CHANCE: 0.45,
    QUICK_RISKS: [100, 250, 500, 1000, 2500, 5000, 10000],
    BOOST_ACTIONS: [
      { id: "profile", label: "CREATE YOUR CADE PROFILE", reward: 500, icon: "🪪" },
      { id: "share", label: "SHARE MEME MADNESS", reward: 500, icon: "📣" },
      { id: "submit", label: "SUBMIT A MEME COIN", reward: 1000, icon: "🧪" },
      { id: "vote", label: "VOTE IN MEME MADNESS", reward: 500, icon: "🗳️" }
    ],
    // Archived sessions are capped so localStorage cannot fill up (browser) and
    // an account cannot grow without bound (server).
    HISTORY_LIMIT: 50
  };

  /* ---------------------------------------------------------
     COIN POOLS
     --------------------------------------------------------- */
  // The curated pool holds the hand-designed coins — each one has real SVG art
  // on disk in /assets/coins. Spec §8 also calls for "many more dynamically",
  // so a share of rounds mint a brand-new ticker from the parts below.
  var COIN_POOL = [
    ["MOONFROG", "🐸"], ["BONKCAT", "🐱"], ["GIGAAPE", "🦍"], ["FROGGO", "🐸"],
    ["MEMEDOG", "🐶"], ["CHADINU", "🐕"], ["ROCKETPANDA", "🐼"], ["WAGMIFROG", "🐸"],
    ["RUGBIRD", "🐦"], ["PEPEBOSS", "🐸"], ["DUMBFROG", "🐸"], ["BANANADOG", "🍌"],
    ["LASERSHARK", "🦈"], ["TURBOSNAIL", "🐌"], ["DIAMONDHAMSTER", "🐹"], ["SADCLOWN", "🤡"],
    ["GIGACHAD", "💪"], ["MOONPIG", "🐷"], ["CRYOWL", "🦉"], ["SPICYTACO", "🌮"]
  ];

  var COIN_PREFIXES = ["MOON", "GIGA", "TURBO", "LASER", "DIAMOND", "CHAD", "DEGEN", "BASED",
    "HYPER", "MEGA", "ULTRA", "COSMIC", "SPICY", "THICC", "ZOOM", "QUANTUM", "ANGRY", "SLEEPY",
    "ROCKET", "GALAXY", "JUMBO", "MICRO", "NEON", "VELVET"];
  var COIN_SUFFIXES = ["FROG", "DOG", "CAT", "APE", "PANDA", "SHARK", "SNAIL", "HAMSTER",
    "CLOWN", "PIG", "OWL", "BIRD", "TACO", "BONK", "INU", "WHALE", "GOBLIN", "WIZARD", "NINJA",
    "SLOTH", "LLAMA", "GECKO", "MOOSE", "TOAD"];
  var COIN_EMOJI = ["🐸", "🐶", "🐱", "🦍", "🐼", "🦈", "🐌", "🐹", "🤡", "🐷", "🦉", "🐦", "🌮",
    "💪", "🚀", "🐳", "👺", "🧙", "🥷", "🦥", "🦙", "🦎", "🫎", "🐊"];

  var SIM_PLAYERS_BASE = [
    { name: "PEPE PROPHET", avatar: "🐸" },
    { name: "CHAD MEME", avatar: "💪" },
    { name: "MOONBOY", avatar: "🚀" },
    { name: "FROGGY", avatar: "🐸" },
    { name: "MEME ORACLE", avatar: "🔮" },
    { name: "DEGEN DAVE", avatar: "🎲" },
    { name: "GIGA BRAIN", avatar: "🧠" },
    { name: "ROCKET RIDER", avatar: "🛸" }
  ];

  /* ---------------------------------------------------------
     OUTCOMES
     --------------------------------------------------------- */
  // NOTE: `dir` is deliberately NOT stored here — it is derived from the sign of
  // the rolled percentage by dirFromPct(). Storing both independently let them
  // contradict each other: FLAT used to be hard-coded dir:"DOWN" while rolling a
  // pct anywhere in [-0.5, +0.5], so ~4% of rounds rendered the
  // self-contradictory "TICKER went DOWN (+0.32%)" and lost the round for a
  // player who had correctly predicted UP. Deriving it makes that
  // unrepresentable rather than merely fixed.
  var OUTCOMES = [
    { key: "STRONG_UP", weight: 10, pct: [8, 18] },
    { key: "UP", weight: 20, pct: [2, 8] },
    { key: "SLIGHT_UP", weight: 15, pct: [0.2, 2] },
    { key: "FLAT", weight: 8, pct: [-0.5, 0.5] },
    { key: "SLIGHT_DOWN", weight: 15, pct: [-2, -0.2] },
    { key: "DOWN", weight: 20, pct: [-8, -2] },
    { key: "STRONG_DOWN", weight: 12, pct: [-18, -8] }
  ];

  /* ---------------------------------------------------------
     AWARDS
     --------------------------------------------------------- */
  var AWARD_DEFS = {
    MEME_STAR: { icon: "⭐", title: "MEME STAR", desc: "Exceptional overall performance." },
    GRINDER: { icon: "🔥", title: "GRINDER", desc: "Played a high number of rounds." },
    BIGGEST_PAYOUT: { icon: "💰", title: "BIGGEST PAYOUT", desc: "Landed a massive single-round payout." },
    POINTS_KING: { icon: "🏆", title: "POINTS KING", desc: "Finished with a huge point balance." },
    PREDICTION_MASTER: { icon: "🎯", title: "PREDICTION MASTER", desc: "Kept a high win rate all session." },
    HOT_STREAK: { icon: "⚡", title: "HOT STREAK", desc: "Racked up a long winning streak." },
    MEME_ORACLE: { icon: "🧠", title: "MEME ORACLE", desc: "Consistently correct predictions." },
    HIGH_ROLLER: { icon: "💎", title: "HIGH ROLLER", desc: "Risked a large amount of points." }
  };

  /* ---------------------------------------------------------
     PURE HELPERS
     --------------------------------------------------------- */
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

  /** Single source of truth for direction. Any outcome whose rolled percentage
   *  is >= 0 is an UP move, anything below is DOWN — so the direction a player
   *  is scored against always matches the percentage they were shown. */
  function dirFromPct(pctVal) { return pctVal >= 0 ? "UP" : "DOWN"; }

  function getMultiplier(riskAmount) {
    if (!CONFIG.USE_TIERED_PAYOUT) return CONFIG.PAYOUT_MULTIPLIER;
    var tier = CONFIG.RISK_TIERS.find(function (t) {
      return riskAmount >= t.min && riskAmount <= t.max;
    });
    return tier ? tier.mult : CONFIG.PAYOUT_MULTIPLIER;
  }

  function boostReward(id) {
    var b = CONFIG.BOOST_ACTIONS.find(function (x) { return x.id === id; });
    return b ? b.reward : 0;
  }

  function riskTierFor(riskAmount) {
    var i = CONFIG.RISK_TIERS.findIndex(function (t) {
      return riskAmount >= t.min && riskAmount <= t.max;
    });
    if (i < 0) return null;
    return { index: i, label: ["LOW RISK", "MEDIUM RISK", "HIGH RISK"][i] || "RISK", mult: CONFIG.RISK_TIERS[i].mult };
  }

  function genHistory(bias) {
    var pts = [], v = 50;
    for (var i = 0; i < 24; i++) {
      v += rand(-6, 6) + (bias > 0 ? 0.4 : -0.4);
      v = Math.max(5, Math.min(95, v));
      pts.push(v);
    }
    return pts;
  }

  function generateCoin() {
    var ticker, emoji, isGenerated = false;
    if (Math.random() < CONFIG.DYNAMIC_COIN_CHANCE) {
      ticker = pick(COIN_PREFIXES) + pick(COIN_SUFFIXES);
      emoji = pick(COIN_EMOJI);
      isGenerated = !COIN_POOL.some(function (c) { return c[0] === ticker; });
    } else {
      var row = pick(COIN_POOL);
      ticker = row[0];
      emoji = row[1];
    }
    var price = +(rand(0.0001, 4)).toFixed(6);
    var move = +(rand(-9, 9)).toFixed(2);
    return { ticker: ticker, emoji: emoji, price: price, move: move, isGenerated: isGenerated, history: genHistory(move) };
  }

  function generateOutcome() {
    var total = OUTCOMES.reduce(function (a, o) { return a + o.weight; }, 0);
    var r = rand(0, total);
    for (var i = 0; i < OUTCOMES.length; i++) {
      var o = OUTCOMES[i];
      if (r < o.weight) {
        var pctVal = +(rand(o.pct[0], o.pct[1])).toFixed(2);
        return Object.assign({}, o, { pctVal: pctVal, dir: dirFromPct(pctVal) });
      }
      r -= o.weight;
    }
    return Object.assign({}, OUTCOMES[0], { pctVal: 1, dir: "UP" });
  }

  /** The payout rule, in one place. Callers pass what happened; they get back
   *  the result label and the signed balance delta. Used by the browser, the CLI
   *  and (to avoid trusting a client-sent delta) the server. */
  function scoreRound(prediction, actualDir, riskAmount) {
    var risk = Math.max(0, Math.floor(Number(riskAmount) || 0));
    var validPrediction = prediction === "UP" || prediction === "DOWN";
    var validDir = actualDir === "UP" || actualDir === "DOWN";
    if (!validPrediction || !validDir || risk <= 0) {
      return { result: "SKIPPED", payout: 0, profit: 0, loss: 0, multiplier: getMultiplier(risk) };
    }
    var mult = getMultiplier(risk);
    if (prediction === actualDir) {
      var profit = Math.round(risk * mult);
      return { result: "WIN", payout: profit, profit: profit, loss: 0, multiplier: mult };
    }
    return { result: "LOSS", payout: -risk, profit: 0, loss: risk, multiplier: mult };
  }

  function calculateAwards(s) {
    var earned = [];
    if (s.totalRounds >= 15) earned.push("GRINDER");
    if (s.largestPayout >= 3000) earned.push("BIGGEST_PAYOUT");
    if (s.endingBalance >= 40000) earned.push("POINTS_KING");
    if (s.totalRounds >= 5 && s.winRate >= 65) earned.push("PREDICTION_MASTER");
    if (s.longestWinStreak >= 4) earned.push("HOT_STREAK");
    if (s.totalRounds >= 8 && s.winRate >= 75) earned.push("MEME_ORACLE");
    if (s.totalRisked >= 15000) earned.push("HIGH_ROLLER");
    if (s.netResult >= 10000 && s.totalRounds >= 10) earned.push("MEME_STAR");
    return earned;
  }

  /** Resolve award codes to their definitions, dropping anything unrecognised.
   *  A session archived by an older build may have no `awards` field at all, and
   *  a code from a newer build may not exist here — neither should be fatal to a
   *  screen that is only trying to show some badges. */
  function awardsOf(session) {
    var codes = (session && Array.isArray(session.awards)) ? session.awards : [];
    var out = [];
    for (var i = 0; i < codes.length; i++) {
      var def = AWARD_DEFS[codes[i]];
      if (def) out.push(Object.assign({ code: codes[i] }, def));
    }
    return out;
  }

  return {
    CONFIG: CONFIG,
    COIN_POOL: COIN_POOL,
    COIN_PREFIXES: COIN_PREFIXES,
    COIN_SUFFIXES: COIN_SUFFIXES,
    COIN_EMOJI: COIN_EMOJI,
    SIM_PLAYERS_BASE: SIM_PLAYERS_BASE,
    OUTCOMES: OUTCOMES,
    AWARD_DEFS: AWARD_DEFS,
    rand: rand,
    randInt: randInt,
    pick: pick,
    dirFromPct: dirFromPct,
    getMultiplier: getMultiplier,
    boostReward: boostReward,
    riskTierFor: riskTierFor,
    genHistory: genHistory,
    generateCoin: generateCoin,
    generateOutcome: generateOutcome,
    scoreRound: scoreRound,
    calculateAwards: calculateAwards,
    awardsOf: awardsOf
  };
}));
