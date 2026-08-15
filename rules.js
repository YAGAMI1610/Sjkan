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
    /* How long a whole run lasts, wall-clock, before it goes to its results and
       awards. Deliberately NOT the same knob as ROUND_SECONDS: that is the
       per-round decision window (§ the 25s countdown in the arena), this is the
       ceiling on the session that contains those rounds — about 24 of them.
       Making a *round* ten minutes long would instead reduce a session to a
       single prediction. */
    SESSION_SECONDS: 600,
    /* Don't open a round the session clock cannot finish. With less than this
       left the run goes straight to its results rather than dealing a coin
       nobody has time to call. */
    SESSION_MIN_ROUND_SECONDS: 5,
    /* How long a Meme Madness vote stays open. Matched to the session length so
       a vote cast at the start of a run can still be seen closing in the same
       sitting. This was a hard-coded hour written out twice — once in app.js and
       once in cli.js — which is exactly the kind of duplicated tunable this file
       exists to hold. */
    VOTE_WINDOW_MS: 10 * 60 * 1000,
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
     SIMULATED REAL-CAMPAIGN COMPARISON
     -----------------------------------------------------
     At the end of a run we tell the player where a score like theirs would have
     landed in the real cade.market Meme Madness campaign's daily prize table.

     Read this before touching anything below: it is an ILLUSTRATION, not a
     result. This prototype is not connected to cade.market in any way, there is
     no live competitor data to rank anybody against, and the "field" the player
     is placed in is CAMPAIGN_ENTRANTS − 1 rivals invented by
     simulateRivalScores() a moment earlier. Every front end that shows a number
     from here is required to show CAMPAIGN_DISCLAIMER with it — the tests assert
     that, because a prize figure without that sentence next to it reads as a
     promise.
     --------------------------------------------------------- */

  // The real campaign's published Tournament Day table, in USDC. Ranks past the
  // last row win nothing, which is why there is no catch-all tier.
  var PRIZE_TIERS = [
    { min: 1, max: 1, usd: 2000, label: "1st" },
    { min: 2, max: 2, usd: 1200, label: "2nd" },
    { min: 3, max: 3, usd: 800, label: "3rd" },
    { min: 4, max: 4, usd: 600, label: "4th" },
    { min: 5, max: 5, usd: 500, label: "5th" },
    { min: 6, max: 10, usd: 300, label: "6th–10th" },
    { min: 11, max: 20, usd: 120, label: "11th–20th" },
    { min: 21, max: 40, usd: 50, label: "21st–40th" },
    { min: 41, max: 100, usd: 20, label: "41st–100th" }
  ];

  // Ranks past the last row above win nothing, so 100 is the paying cut.
  var PRIZE_FIELD_SIZE = 100;

  /* How many entrants the simulated day has, the player included.
     Deliberately more than PRIZE_FIELD_SIZE. A field of exactly 100 sounds
     right — one rival per paying rank — but the table pays down to 100th, so
     every single entrant would place and "you wouldn't have placed in the top
     100" could never be shown. A real campaign day has a field the top 100 is
     cut *from*. At 150, a losing session misses out, a break-even one scrapes
     the bottom tier, and 1st still means beating all 149. */
  var CAMPAIGN_ENTRANTS = 150;

  /* The two daily Side Quests. Each is a separate pot from the leaderboard
     prizes, so a player can be told about one without having placed.
     The thresholds are what makes a player "in the running": we cannot know
     whether they'd have topped the real day's field, and the wording never
     claims they would have. */
  var SIDE_QUESTS = {
    GRINDER_QUEST: {
      id: "GRINDER_QUEST", icon: "🔥", title: "THE GRINDER QUEST", usd: 400,
      desc: "Most predictions in a day, right or wrong.",
      // A 10-minute session fits ~24 rounds at ROUND_SECONDS each; half of that
      // is a genuinely heavy day of calling rather than a participation badge.
      minPredictions: 12
    },
    SMASHER_QUEST: {
      id: "SMASHER_QUEST", icon: "💥", title: "THE SMASHER QUEST", usd: 400,
      desc: "Highest payout multiple from a single correct prediction in a day.",
      // Above the BIGGEST_PAYOUT award's 3,000 — this is the top of the day, not
      // just a good round.
      minPayout: 5000
    }
  };

  var CAMPAIGN_NAME = "CADE Meme Madness";

  var CAMPAIGN_DISCLAIMER = "Simulated comparison, shown for illustration only. " +
    "This is a prototype and is not affiliated with, endorsed by or connected to " +
    "cade.market. Every other player in the field is generated, not a real " +
    "entrant, and no prize here is real, offered, payable or guaranteed.";


  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

  /* Thousands separators, for the few strings this file builds itself (the Side
     Quest details). Hand-rolled rather than toLocaleString so a number reads the
     same in a browser, a terminal and a server with no ICU data. */
  function fmtPoints(n) {
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

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

  /* ---------------------------------------------------------
     SIMULATED REAL-CAMPAIGN COMPARISON — pure functions
     --------------------------------------------------------- */

  /** The prize row a finishing rank falls in, or null for "no prize". */
  function prizeForRank(rank) {
    var r = Math.floor(Number(rank) || 0);
    if (r < 1) return null;
    for (var i = 0; i < PRIZE_TIERS.length; i++) {
      if (r >= PRIZE_TIERS[i].min && r <= PRIZE_TIERS[i].max) return PRIZE_TIERS[i];
    }
    return null;
  }

  /** Invent a day's worth of rival results.
   *
   *  Each rival gets a stake habit, a round count and a hit rate, and then every
   *  one of their rounds is put through scoreRound() — the same function the
   *  player's own rounds go through. That is the point: the field ends up on the
   *  same scale as a real run because it is produced by the same payout rule,
   *  not by a hand-tuned range that would drift the moment PAYOUT_MULTIPLIER or
   *  RISK_TIERS changed. */
  function simulateRivalScores(count) {
    var n = Math.max(0, Math.floor(Number(count) || 0));
    var maxRounds = Math.max(3, Math.floor(CONFIG.SESSION_SECONDS / CONFIG.ROUND_SECONDS));
    var out = [];
    for (var i = 0; i < n; i++) {
      var habit = pick(CONFIG.QUICK_RISKS);
      var rounds = randInt(3, maxRounds);
      var hitRate = rand(0.32, 0.68); // the spread between a lucky day and a bad one
      var net = 0, best = 0, bestMultiple = 0, predictions = 0;
      for (var r = 0; r < rounds; r++) {
        var wager = Math.max(1, Math.round(habit * rand(0.5, 1.5)));
        var won = Math.random() < hitRate;
        var scored = scoreRound("UP", won ? "UP" : "DOWN", wager);
        net += scored.payout;
        predictions++;
        if (scored.payout > best) {
          best = scored.payout;
          bestMultiple = scored.multiplier;
        }
      }
      out.push({ net: net, predictions: predictions, bestPayout: best, bestMultiple: bestMultiple });
    }
    return out;
  }

  /** Best single winning round in a session, as an absolute payout and as a
   *  multiple of what was staked to get it. Tolerates sessions archived before
   *  per-round records existed, and rounds trimmed for storage. */
  function bestWinningRound(session) {
    var rounds = (session && Array.isArray(session.rounds)) ? session.rounds : [];
    var bestPayout = 0, bestMultiple = 0;
    for (var i = 0; i < rounds.length; i++) {
      var r = rounds[i] || {};
      var payout = Number(r.payout) || 0;
      if (r.result !== "WIN" || payout <= 0) continue;
      var risk = Number(r.riskAmount) || 0;
      if (payout > bestPayout) {
        bestPayout = payout;
        bestMultiple = risk > 0 ? +(payout / risk).toFixed(2) : 0;
      }
    }
    // A session summary carries largestPayout even when its rounds have been
    // dropped, so fall back to it rather than reporting a best of zero.
    if (!bestPayout && Number(session && session.largestPayout) > 0) {
      bestPayout = Math.floor(Number(session.largestPayout));
      bestMultiple = getMultiplier(bestPayout);
    }
    return { bestPayout: bestPayout, bestMultiple: bestMultiple };
  }

  /** Where a finished session's net would have landed in the real campaign's
   *  daily table, against a simulated field. Pure — pass `opts.rivals` to score
   *  against a fixed field instead of a freshly rolled one, which is what the
   *  tests do.
   *
   *  Ranking is on net credits for the session, the same number the share card
   *  calls NET. Ties go to the player (rank = 1 + rivals strictly ahead), which
   *  is the only tie rule that cannot hand someone a worse rank than a rival
   *  they matched. */
  function simulateCampaignResult(session, opts) {
    var o = opts || {};
    var fieldSize = Math.max(1, Math.floor(Number(o.fieldSize) || CAMPAIGN_ENTRANTS));
    var rivals = Array.isArray(o.rivals) ? o.rivals : simulateRivalScores(fieldSize - 1);

    var score = Math.round(Number(session && session.netResult) || 0);
    var wins = Math.max(0, Math.floor(Number(session && session.wins) || 0));
    var losses = Math.max(0, Math.floor(Number(session && session.losses) || 0));
    // Predictions, not rounds: a round the clock ran out on was never a call.
    var predictions = wins + losses;
    var best = bestWinningRound(session);

    var ahead = 0, rivalPredictions = 0, rivalBestPayout = 0;
    for (var i = 0; i < rivals.length; i++) {
      var rv = rivals[i] || {};
      if ((Number(rv.net) || 0) > score) ahead++;
      if ((Number(rv.predictions) || 0) > rivalPredictions) rivalPredictions = Number(rv.predictions) || 0;
      if ((Number(rv.bestPayout) || 0) > rivalBestPayout) rivalBestPayout = Number(rv.bestPayout) || 0;
    }
    var rank = ahead + 1;
    var prize = prizeForRank(rank);

    var quests = [];
    if (predictions >= SIDE_QUESTS.GRINDER_QUEST.minPredictions) {
      quests.push({
        id: SIDE_QUESTS.GRINDER_QUEST.id,
        icon: SIDE_QUESTS.GRINDER_QUEST.icon,
        title: SIDE_QUESTS.GRINDER_QUEST.title,
        usd: SIDE_QUESTS.GRINDER_QUEST.usd,
        // "in the running" is the strongest honest claim: the real day's top
        // grinder is unknowable, so leading the simulated field is the most that
        // can be said, and even that is only about the invented rivals.
        leadsField: predictions >= rivalPredictions,
        detail: predictions + " predictions this session"
      });
    }
    if (best.bestPayout >= SIDE_QUESTS.SMASHER_QUEST.minPayout) {
      quests.push({
        id: SIDE_QUESTS.SMASHER_QUEST.id,
        icon: SIDE_QUESTS.SMASHER_QUEST.icon,
        title: SIDE_QUESTS.SMASHER_QUEST.title,
        usd: SIDE_QUESTS.SMASHER_QUEST.usd,
        leadsField: best.bestPayout >= rivalBestPayout,
        detail: best.bestMultiple
          ? best.bestMultiple + "x on one call (+" + fmtPoints(best.bestPayout) + ")"
          : "+" + fmtPoints(best.bestPayout) + " on one call"
      });
    }

    return {
      campaign: CAMPAIGN_NAME,
      score: score,
      rank: rank,
      fieldSize: fieldSize,
      paidRanks: PRIZE_FIELD_SIZE,
      placed: !!prize,
      prizeUsd: prize ? prize.usd : 0,
      tierLabel: prize ? prize.label : null,
      predictions: predictions,
      bestPayout: best.bestPayout,
      bestMultiple: best.bestMultiple,
      quests: quests,
      simulated: true,
      disclaimer: CAMPAIGN_DISCLAIMER
    };
  }

  /* The quest names are stored in the arcade all-caps the UI uses everywhere
     else; mid-sentence they need to read as names. */
  function titleCaseQuest(title) {
    return String(title || "").toLowerCase().replace(/(^|\s)([a-z])/g, function (m, sp, ch) {
      return sp + ch.toUpperCase();
    });
  }

  /** The comparison as plain sentences, so the browser summary, the CLI summary
   *  and any share text all say the same thing rather than three paraphrases.
   *  Returns { headline: string, quests: [string], disclaimer: string }. */
  function campaignResultLines(result) {
    var r = result || {};
    var rank = Math.max(1, Math.floor(Number(r.rank) || 0));
    var opener = "If you performed like this in the real " + (r.campaign || CAMPAIGN_NAME) +
      " campaign, you would have ranked around number " + rank;
    var headline = r.placed
      ? opener + " and won $" + fmtPoints(r.prizeUsd) + "!"
      : opener + " — you wouldn't have placed in the top " +
        (Number(r.paidRanks) || PRIZE_FIELD_SIZE) + ".";

    var quests = (Array.isArray(r.quests) ? r.quests : []).map(function (q) {
      if (q.id === SIDE_QUESTS.SMASHER_QUEST.id) {
        return "Your best single-round multiplier could win you " +
          titleCaseQuest(q.title) + ", $" + q.usd + "!";
      }
      return "You'd be in the running for " + titleCaseQuest(q.title) +
        ", $" + q.usd + ", for most predictions today!";
    });

    return { headline: headline, quests: quests, disclaimer: r.disclaimer || CAMPAIGN_DISCLAIMER };
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
    PRIZE_TIERS: PRIZE_TIERS,
    PRIZE_FIELD_SIZE: PRIZE_FIELD_SIZE,
    CAMPAIGN_ENTRANTS: CAMPAIGN_ENTRANTS,
    SIDE_QUESTS: SIDE_QUESTS,
    CAMPAIGN_NAME: CAMPAIGN_NAME,
    CAMPAIGN_DISCLAIMER: CAMPAIGN_DISCLAIMER,
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
    awardsOf: awardsOf,
    prizeForRank: prizeForRank,
    simulateRivalScores: simulateRivalScores,
    bestWinningRound: bestWinningRound,
    simulateCampaignResult: simulateCampaignResult,
    campaignResultLines: campaignResultLines
  };
}));
