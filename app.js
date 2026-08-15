/* =====================================================
   CADE MEME MADNESS — Core Simulation Engine
   All data is fictional. LocalStorage persistence.
   ===================================================== */

const STORAGE_KEY = "cade_meme_madness_v1";

const CONFIG = {
  DAILY_POINTS: 20000,
  ROUND_SECONDS: 25,
  PAYOUT_MULTIPLIER: 1.8, // default flat multiplier
  RISK_TIERS: [
    { min: 0, max: 500, mult: 1.5 },
    { min: 501, max: 2500, mult: 1.8 },
    { min: 2501, max: 10000000, mult: 2.0 }
  ],
  USE_TIERED_PAYOUT: false, // toggle to true to use RISK_TIERS instead of flat multiplier
  QUICK_RISKS: [100, 250, 500, 1000, 2500, 5000, 10000],
  BOOST_ACTIONS: [
    { id: "profile", label: "CREATE YOUR CADE PROFILE", reward: 500, icon: "🪪" },
    { id: "share", label: "SHARE MEME MADNESS", reward: 500, icon: "📣" },
    { id: "submit", label: "SUBMIT A MEME COIN", reward: 1000, icon: "🧪" },
    { id: "vote", label: "VOTE IN MEME MADNESS", reward: 500, icon: "🗳️" }
  ]
};

/* =========================================================
   ASSET MANAGER
   Componentized art slots. Every visual element in the app
   asks AssetManager for its art via a stable key. If a real
   file exists at the expected path, it's used; otherwise the
   emoji/fallback is rendered instead. Drop real files into
   /assets using these exact paths/naming patterns and no
   other code needs to change.
   ========================================================= */
const AssetManager = {
  base: "assets/",
  cache: {}, // key -> "found" | "missing"

  paths: {
    logo: "assets/logo.jpg",
    hero: "assets/hero-artwork.svg",
    coin: ticker => `assets/coins/${ticker.toLowerCase()}.svg`,
    award: code => `assets/awards/${code.toLowerCase()}.svg`,
    avatar: id => `assets/avatars/${String(id).toLowerCase().replace(/\s+/g,'-')}.svg`
  },

  // Returns a DOM string for an art slot: tries the real asset,
  // falls back to the emoji/text placeholder if it 404s.
  slot(key, path, fallbackEmoji, className){
    const id = "art_" + key + "_" + Math.random().toString(36).slice(2,8);
    // Render fallback immediately (no flash of missing image),
    // then swap to real asset if/when confirmed available.
    setTimeout(()=> this._tryLoad(id, path, fallbackEmoji), 0);
    return `<span class="art-slot ${className||''}" id="${id}" data-fallback="${fallbackEmoji}">${fallbackEmoji}</span>`;
  },

  _tryLoad(id, path, fallbackEmoji){
    const el = document.getElementById(id);
    if(!el) return;
    if(this.cache[path] === "missing") return; // already known missing, keep fallback
    if(this.cache[path] === "found"){
      el.innerHTML = `<img src="${path}" alt="" draggable="false">`;
      return;
    }
    const img = new Image();
    img.onload = ()=>{
      this.cache[path] = "found";
      const target = document.getElementById(id);
      if(target) target.innerHTML = `<img src="${path}" alt="" draggable="false">`;
    };
    img.onerror = ()=>{ this.cache[path] = "missing"; };
    img.src = path;
  }
};

const COIN_POOL = [
  ["MOONFROG","🐸"],["BONKCAT","🐱"],["GIGAAPE","🦍"],["FROGGO","🐸"],
  ["MEMEDOG","🐶"],["CHADINU","🐕"],["ROCKETPANDA","🐼"],["WAGMIFROG","🐸"],
  ["RUGBIRD","🐦"],["PEPEBOSS","🐸"],["DUMBFROG","🐸"],["BANANADOG","🍌"],
  ["LASERSHARK","🦈"],["TURBOSNAIL","🐌"],["DIAMONDHAMSTER","🐹"],["SADCLOWN","🤡"],
  ["GIGACHAD","💪"],["MOONPIG","🐷"],["CRYOWL","🦉"],["SPICYTACO","🌮"]
];

const SIM_PLAYERS_BASE = [
  { name: "PEPE PROPHET", avatar: "🐸" },
  { name: "CHAD MEME", avatar: "💪" },
  { name: "MOONBOY", avatar: "🚀" },
  { name: "FROGGY", avatar: "🐸" },
  { name: "MEME ORACLE", avatar: "🔮" },
  { name: "DEGEN DAVE", avatar: "🎲" },
  { name: "GIGA BRAIN", avatar: "🧠" },
  { name: "ROCKET RIDER", avatar: "🛸" }
];

// NOTE: `dir` is deliberately NOT stored here — it is derived from the sign of
// the rolled percentage by MarketEngine.dirFromPct(). Storing both independently
// let them contradict each other: FLAT used to be hard-coded dir:"DOWN" while
// rolling a pct anywhere in [-0.5, +0.5], so ~4% of rounds rendered the
// self-contradictory "TICKER went DOWN (+0.32%)" and lost the round for a player
// who had correctly predicted UP. Deriving the direction makes that unrepresentable.
const OUTCOMES = [
  { key: "STRONG_UP", weight: 10, pct: [8, 18] },
  { key: "UP", weight: 20, pct: [2, 8] },
  { key: "SLIGHT_UP", weight: 15, pct: [0.2, 2] },
  { key: "FLAT", weight: 8, pct: [-0.5, 0.5] },
  { key: "SLIGHT_DOWN", weight: 15, pct: [-2, -0.2] },
  { key: "DOWN", weight: 20, pct: [-8, -2] },
  { key: "STRONG_DOWN", weight: 12, pct: [-18, -8] }
];

const AWARD_DEFS = {
  MEME_STAR: { icon: "⭐", title: "MEME STAR", desc: "Exceptional overall performance." },
  GRINDER: { icon: "🔥", title: "GRINDER", desc: "Played a high number of rounds." },
  BIGGEST_PAYOUT: { icon: "💰", title: "BIGGEST PAYOUT", desc: "Landed a massive single-round payout." },
  POINTS_KING: { icon: "🏆", title: "POINTS KING", desc: "Finished with a huge point balance." },
  PREDICTION_MASTER: { icon: "🎯", title: "PREDICTION MASTER", desc: "Kept a high win rate all session." },
  HOT_STREAK: { icon: "⚡", title: "HOT STREAK", desc: "Racked up a long winning streak." },
  MEME_ORACLE: { icon: "🧠", title: "MEME ORACLE", desc: "Consistently correct predictions." },
  HIGH_ROLLER: { icon: "💎", title: "HIGH ROLLER", desc: "Risked a large amount of points." }
};

/* ---------------- STATE ---------------- */
function defaultState(){
  return {
    balance: 0,
    lastClaim: null,
    boosts: { profile:false, share:false, submit:false, vote:false },
    session: null, // current active session
    history: [],
    records: {
      highestBalance: 0, biggestPayout: 0, bestWinRate: 0,
      // `null` (not -Infinity) is the "no session recorded yet" sentinel:
      // JSON.stringify(-Infinity) serialises to null anyway, so the original
      // -Infinity silently became null on the first save/load cycle and
      // `netResult > null` then evaluates as `netResult > 0` — meaning a first
      // session that finished down never got recorded as the best one.
      longestStreak: 0, mostRounds: 0, mostRisked: 0, bestSessionId: null, bestSessionNet: null
    },
    leaderboard: null, // {players:[...], lastUpdate}
    votes: null,
    submittedMemes: []
  };
}

let STATE = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return Object.assign(defaultState(), JSON.parse(raw));
  }catch(e){}
  return defaultState();
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
}

/* ---------------- UTIL ---------------- */
const $ = sel => document.querySelector(sel);
const fmt = n => Math.round(n).toLocaleString("en-US");
function toast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("#toastRoot").appendChild(el);
  setTimeout(()=>el.remove(), 2200);
}
function rand(min,max){ return Math.random()*(max-min)+min; }
function randInt(min,max){ return Math.floor(rand(min,max+1)); }
function pick(arr){ return arr[randInt(0,arr.length-1)]; }
function uid(prefix){ return prefix + "_" + Date.now().toString(36) + randInt(100,999); }

/* ---------------- NAV ---------------- */
const Nav = {
  current: "home",
  go(screen){
    document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
    const el = document.getElementById("screen-"+screen);
    if(el) el.classList.add("active");
    this.current = screen;
    document.querySelectorAll(".bottom-nav button").forEach(b=>{
      b.classList.toggle("active", b.dataset.screen === screen);
    });
    window.scrollTo(0,0);
    // #11 — poll the (centrally simulated / server-backed) leaderboard
    // while it's on screen so rank changes feel live; stop when we leave.
    clearInterval(this._lbPoll);
    if(screen === "leaderboard"){
      Leaderboard.refreshFromServer();
      this._lbPoll = setInterval(()=>Leaderboard.refreshFromServer(), 15000);
    }
    if(screen === "leaderboard") UI.renderLeaderboard();
    if(screen === "vote") UI.renderVote();
    if(screen === "history") UI.renderHistory();
    if(screen === "records") UI.renderRecords();
    if(screen === "home") UI.renderHome();
  }
};

/* =========================================================
   GAME ENGINE
   ========================================================= */
const Game = {

  async claimDaily(){
    // #12 — server enforces the real 24h window; the local closure below is the
    // instant-feedback fallback for when no backend is reachable.
    const now = Date.now();
    try{
      // NOTE: only ONE of these two paths runs. When a backend is reachable the
      // local closure is never invoked, so the balance credit has to come from
      // the server's response — previously it didn't, and the code read
      // `STATE.balance = STATE.balance` (a no-op), leaving the player with a
      // "+20,000 POINTS CLAIMED!" toast and no points.
      const res = await Api.claimDaily(async ()=>{
        if(STATE.lastClaim && now - STATE.lastClaim < 24*3600*1000){
          const err = new Error("Already claimed"); err.status = 429; throw err;
        }
        STATE.balance += CONFIG.DAILY_POINTS;
        STATE.lastClaim = now;
        saveState();
        return { balance: STATE.balance, claimed: CONFIG.DAILY_POINTS };
      });
      if(res && typeof res.balance === "number") STATE.balance = res.balance;
      STATE.lastClaim = now;
      saveState();
      UI.renderHome();
      UI.updateHeaderPoints();
      toast("+" + fmt((res && res.claimed) || CONFIG.DAILY_POINTS) + " POINTS CLAIMED!");
    }catch(e){
      toast("Already claimed. Come back later!");
    }
  },

  async doBoost(id){
    if(STATE.boosts[id]) return;
    const def = CONFIG.BOOST_ACTIONS.find(b=>b.id===id);
    try{
      // Same one-path-only caveat as claimDaily above: take the balance from the
      // server response when it served the request, otherwise from the local
      // closure that already applied it.
      const res = await Api.doBoost(id, async ()=>{
        STATE.boosts[id] = true;
        STATE.balance += def.reward;
        saveState();
        return { balance: STATE.balance, awarded: def.reward };
      });
      if(res && typeof res.balance === "number") STATE.balance = res.balance;
      STATE.boosts[id] = true;
      saveState();
      UI.renderHome();
      UI.updateHeaderPoints();
      toast("+" + fmt((res && res.awarded) || def.reward) + " POINTS — " + def.label);
    }catch(e){
      toast("That boost was already claimed.");
    }
  },

  startSession(){
    const session = {
      sessionId: uid("sess"),
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
    STATE.session = session;
    saveState();
    Api.startSession(session, ()=>({ ok:true }));
    $("#arenaPreStart").style.display = "none";
    $("#arenaGame").style.display = "block";
    Round.begin();
  },

  selectPrediction(dir){
    if(Round.locked || !Round.active) return;
    Round.prediction = dir;
    $("#upBtn").classList.toggle("selected", dir==="UP");
    $("#downBtn").classList.toggle("selected", dir==="DOWN");
    UI.updateConfirmState();
  },

  selectRisk(amount){
    if(Round.locked || !Round.active) return;
    Round.risk = Math.min(amount, STATE.balance);
    $("#customRisk").style.display = "none";
    document.querySelectorAll(".risk-chip").forEach(c=>{
      c.classList.toggle("selected", Number(c.dataset.val) === amount);
    });
    UI.updatePayoutPreview();
    UI.updateConfirmState();
  },

  selectCustom(){
    document.querySelectorAll(".risk-chip[data-val]").forEach(c=>c.classList.remove("selected"));
    $("#customRisk").style.display = "block";
    $("#customRisk").focus();
  },

  setCustomRisk(val){
    let amount = Math.floor(Number(val)||0);
    if(amount > STATE.balance) amount = STATE.balance;
    Round.risk = amount > 0 ? amount : 0;
    UI.updatePayoutPreview();
    UI.updateConfirmState();
  },

  // STEP 1 -> STEP 2: show the review panel, don't lock yet.
  reviewPrediction(){
    if(!Round.prediction || !Round.risk || Round.risk <= 0) return;
    if(Round.risk > STATE.balance){ toast("Not enough points!"); return; }
    Round.reviewing = true;
    UI.showReview();
  },

  // User backs out of the review step to change prediction/risk.
  cancelReview(){
    Round.reviewing = false;
    UI.hideReview();
  },

  // STEP 2 confirm: this is the actual, irreversible lock.
  lockInPrediction(){
    if(!Round.reviewing) return;
    Round.reviewing = false;
    Round.locked = true;
    UI.lockUI();
    saveState();
    AudioHooks.play("predictionLock");
  },

  confirmEndSession(){
    UI.showModal({
      title: "END SESSION?",
      body: "Your current run will end and be saved to your history.",
      confirmLabel: "END SESSION",
      cancelLabel: "KEEP PLAYING",
      onConfirm: ()=> Game.endSession()
    });
  },

  endSession(){
    UI.hideModal();
    const s = STATE.session;
    if(!s) return;
    s.endedAt = Date.now();
    s.endingBalance = STATE.balance;
    s.totalRounds = s.rounds.length;
    s.winRate = s.totalRounds ? (s.wins / s.totalRounds * 100) : 0;
    s.netResult = s.endingBalance - s.startingBalance;

    s.awards = Awards.calculate(s);

    STATE.history.unshift(s);
    Records.update(s);
    STATE.session = null;
    saveState();

    Api.endSession(s.sessionId, s, ()=>({ ok:true, balance: STATE.balance, records: STATE.records }));

    AudioHooks.play("sessionEnd");
    Ceremony.run(s);
  },

  playAgain(){
    Nav.go("arena");
    $("#arenaPreStart").style.display = "block";
    $("#arenaGame").style.display = "none";
  },

  restartSessionRequest(){
    UI.showModal({
      title: "RESTART THIS SESSION?",
      body: "Your current session results will be saved to history, but your current run will end.",
      confirmLabel: "RESTART",
      cancelLabel: "KEEP PLAYING",
      onConfirm: ()=>{ Game.endSession(); setTimeout(()=>Game.startSession(), 300); }
    });
  },

  async submitMeme(){
    const name = $("#subName").value.trim();
    const ticker = $("#subTicker").value.trim().toUpperCase();
    if(!name || !ticker){ toast("Fill in at least name & ticker!"); return; }
    const meme = { name, ticker, at: Date.now() };
    const res = await Api.submitMeme(meme, async ()=>{
      const qualifies = Math.random() < 0.6;
      STATE.submittedMemes.push(Object.assign({}, meme, { qualifies }));
      if(!STATE.boosts.submit){ STATE.boosts.submit = true; STATE.balance += CONFIG.BOOST_ACTIONS.find(b=>b.id==="submit").reward; }
      saveState();
      return { qualifies, awarded: STATE.boosts.submit ? CONFIG.BOOST_ACTIONS.find(b=>b.id==="submit").reward : 0 };
    });
    const qualifies = res.qualifies;
    STATE.boosts.submit = true;
    saveState();
    UI.updateHeaderPoints();
    if(qualifies){
      UI.showModal({ title: "YOU MADE THE MADNESS! 🏆", body: name + " ($" + ticker + ") has been added to the Meme Madness roster!", confirmLabel: "NICE!", hideCancel:true, onConfirm: ()=>UI.hideModal() });
    } else {
      UI.showModal({ title: "SUBMITTED!", body: name + " didn't make the cut this round — but thanks for playing! Try again anytime.", confirmLabel: "OK", hideCancel:true, onConfirm: ()=>UI.hideModal() });
    }
    ["subName","subTicker","subDesc","subLogo","subCreator"].forEach(id=>$("#"+id).value="");
  },

  shareOnX(){
    const text = ShareCard.buildText(STATE._lastViewed || STATE.history[0]);
    const url = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text);
    window.open(url, "_blank");
  },

  copyResults(){
    const text = ShareCard.buildText(STATE._lastViewed || STATE.history[0]);
    navigator.clipboard?.writeText(text).then(()=>toast("Results copied!")).catch(()=>toast("Copy failed — select manually."));
  },

  shareImage(){
    const s = STATE._lastViewed || STATE.history[0];
    if(!s){ toast("No session to share yet!"); return; }
    ImageShare.generate(s);
  }
};

/* =========================================================
   ROUND LOGIC
   ========================================================= */
const Round = {
  active: false, locked: false, reviewing: false, prediction: null, risk: 0,
  coin: null, outcome: null, timeLeft: CONFIG.ROUND_SECONDS, timerId: null, roundNum: 0,

  async begin(){
    const s = STATE.session;
    s.rounds.length; // no-op
    this.roundNum = s.rounds.length + 1;
    this.active = true;
    this.locked = false;
    this.prediction = null;
    this.risk = 0;
    this.timeLeft = CONFIG.ROUND_SECONDS;
    this.coin = MarketEngine.generateCoin();
    // #9 — outcome is requested from (and, when a backend is present,
    // generated + held by) the server, so nothing in client state ever
    // reveals the result before the round timer expires. Falls back to
    // the local weighted model when no backend is reachable.
    this.outcome = await Api.getRoundOutcome(()=> MarketEngine.generateOutcome());
    if(!s.coinsEncountered.includes(this.coin.ticker)) s.coinsEncountered.push(this.coin.ticker);

    $("#roundTag").textContent = "ROUND " + String(this.roundNum).padStart(2,"0");
    UI.renderCoin(this.coin);
    UI.renderChart(this.coin);
    UI.renderRiskGrid();
    UI.resetPredictionUI();
    UI.updateStatsStrip();
    this.startTimer();
  },

  startTimer(){
    clearInterval(this.timerId);
    UI.updateTimerDisplay(this.timeLeft);
    this.timerId = setInterval(()=>{
      this.timeLeft--;
      UI.updateTimerDisplay(this.timeLeft);
      if(this.timeLeft <= 5 && this.timeLeft > 0){
        AudioHooks.play("countdownTick");
      }
      if(this.timeLeft <= 0){
        clearInterval(this.timerId);
        this.resolve();
      }
    }, 1000);
  },

  resolve(){
    this.active = false;
    const s = STATE.session;
    const hasPrediction = this.locked && this.prediction && this.risk > 0;

    let result = "SKIPPED", payout = 0, profit = 0, loss = 0;
    if(hasPrediction){
      const correct = this.prediction === this.outcome.dir;
      const mult = MarketEngine.getMultiplier(this.risk);
      if(correct){
        profit = Math.round(this.risk * mult);
        payout = profit;
        result = "WIN";
        STATE.balance += profit;
        s.wins++;
        s.totalProfit += profit;
        s.currentStreak++;
        s.longestWinStreak = Math.max(s.longestWinStreak, s.currentStreak);
        if(profit > s.largestPayout) s.largestPayout = profit;
      } else {
        loss = this.risk;
        payout = -loss;
        result = "LOSS";
        STATE.balance -= loss;
        s.losses++;
        s.totalLoss += loss;
        s.currentStreak = 0;
      }
      s.totalRisked += this.risk;
      if(this.risk > s.largestRisk) s.largestRisk = this.risk;
    }

    const roundRecord = {
      roundId: uid("r"),
      coin: this.coin,
      prediction: hasPrediction ? this.prediction : null,
      riskAmount: hasPrediction ? this.risk : 0,
      potentialProfit: hasPrediction ? Math.round(this.risk*MarketEngine.getMultiplier(this.risk)) : 0,
      potentialLoss: hasPrediction ? this.risk : 0,
      actualOutcome: this.outcome.key,
      actualDir: this.outcome.dir,
      pctMove: this.outcome.pctVal,
      result, payout,
      timestamp: Date.now()
    };
    s.rounds.push(roundRecord);
    saveState();
    UI.updateHeaderPoints();
    UI.updateStatsStrip();
    Leaderboard.simulateTick();

    // #10/#12 — server is the source of truth for the balance delta;
    // local balance already applied above so gameplay never blocks on
    // network latency, this just keeps the account persisted/authoritative.
    Api.submitRound(s.sessionId, roundRecord, ()=>({ ok:true, balance: STATE.balance }));

    if(hasPrediction){
      AudioHooks.play(result === "WIN" ? "roundWin" : "roundLoss");
      UI.showRoundResult(roundRecord, s);
    } else {
      toast("Time's up! No prediction made.");
      setTimeout(()=>Round.begin(), 900);
    }
  }
};

/* =========================================================
   MARKET ENGINE
   ========================================================= */
const MarketEngine = {
  generateCoin(){
    const [name, emoji] = pick(COIN_POOL);
    const price = +(rand(0.0001, 4)).toFixed(6);
    const move = +(rand(-9,9)).toFixed(2);
    return { ticker: name, emoji, price, move, history: this.genHistory(move) };
  },
  genHistory(bias){
    const pts = [];
    let v = 50;
    for(let i=0;i<24;i++){
      v += rand(-6,6) + (bias>0?0.4:-0.4);
      v = Math.max(5, Math.min(95, v));
      pts.push(v);
    }
    return pts;
  },
  // Single source of truth for direction. Any outcome whose rolled percentage is
  // >= 0 is an UP move, anything below is DOWN — so the direction the player is
  // scored against always matches the percentage the UI shows them.
  dirFromPct(pctVal){ return pctVal >= 0 ? "UP" : "DOWN"; },

  generateOutcome(){
    const total = OUTCOMES.reduce((a,o)=>a+o.weight,0);
    let r = rand(0,total);
    for(const o of OUTCOMES){
      if(r < o.weight){
        const pctVal = +(rand(o.pct[0], o.pct[1])).toFixed(2);
        return Object.assign({}, o, { pctVal, dir: this.dirFromPct(pctVal) });
      }
      r -= o.weight;
    }
    return Object.assign({}, OUTCOMES[0], { pctVal: 1, dir: "UP" });
  },
  getMultiplier(riskAmount){
    if(!CONFIG.USE_TIERED_PAYOUT) return CONFIG.PAYOUT_MULTIPLIER;
    const tier = CONFIG.RISK_TIERS.find(t => riskAmount >= t.min && riskAmount <= t.max);
    return tier ? tier.mult : CONFIG.PAYOUT_MULTIPLIER;
  }
};

/* =========================================================
   AWARDS
   ========================================================= */
const Awards = {
  calculate(s){
    const earned = [];
    if(s.totalRounds >= 15) earned.push("GRINDER");
    if(s.largestPayout >= 3000) earned.push("BIGGEST_PAYOUT");
    if(s.endingBalance >= 40000) earned.push("POINTS_KING");
    if(s.totalRounds >= 5 && s.winRate >= 65) earned.push("PREDICTION_MASTER");
    if(s.longestWinStreak >= 4) earned.push("HOT_STREAK");
    if(s.totalRounds >= 8 && s.winRate >= 75) earned.push("MEME_ORACLE");
    if(s.totalRisked >= 15000) earned.push("HIGH_ROLLER");
    if(s.netResult >= 10000 && s.totalRounds >= 10) earned.push("MEME_STAR");
    return earned;
  }
};

/* =========================================================
   RECORDS
   ========================================================= */
const Records = {
  update(s){
    const r = STATE.records;
    r.highestBalance = Math.max(r.highestBalance, s.endingBalance);
    r.biggestPayout = Math.max(r.biggestPayout, s.largestPayout);
    r.bestWinRate = Math.max(r.bestWinRate, s.winRate);
    r.longestStreak = Math.max(r.longestStreak, s.longestWinStreak);
    r.mostRounds = Math.max(r.mostRounds, s.totalRounds);
    r.mostRisked = Math.max(r.mostRisked, s.totalRisked);
    if(r.bestSessionNet === null || r.bestSessionNet === undefined || s.netResult > r.bestSessionNet){
      r.bestSessionNet = s.netResult;
      r.bestSessionId = s.sessionId;
    }
  }
};

/* =========================================================
   LEADERBOARD (simulated)
   ========================================================= */
const Leaderboard = {
  ensure(){
    if(STATE.leaderboard) return;
    const players = SIM_PLAYERS_BASE.map(p=>({
      ...p,
      points: randInt(15000, 60000),
      wins: randInt(10,80),
      losses: randInt(5,60),
      biggestPayout: randInt(1000,9000),
      streak: randInt(0,8)
    }));
    STATE.leaderboard = { players };
    saveState();
  },
  // #11 — pulls the centrally-generated leaderboard from the backend when
  // available, so every connected user sees the same standings/motion
  // instead of each device simulating its own. Falls back to the local
  // simulateTick() model when no backend is reachable.
  async refreshFromServer(){
    const data = await Api.getLeaderboard(()=>{ this.ensure(); return null; });
    if(data && data.players){
      STATE.leaderboard = { players: data.players.filter(p=>!p.isMe) };
      saveState();
    }
    if(Nav.current === "leaderboard") UI.renderLeaderboard();
  },
  simulateTick(){
    this.ensure();
    STATE.leaderboard.players.forEach(p=>{
      if(Math.random() < 0.5){
        const delta = randInt(-800, 1400);
        p.points = Math.max(0, p.points + delta);
        if(delta > 0) p.wins++; else p.losses++;
      }
    });
    saveState();
  },
  getRanked(category){
    this.ensure();
    const me = { name: "YOU", avatar: "🧑‍🚀", isMe: true,
      points: STATE.balance,
      wins: STATE.session ? STATE.session.wins : (STATE.history[0]?.wins||0),
      losses: STATE.session ? STATE.session.losses : (STATE.history[0]?.losses||0),
      biggestPayout: Math.max(STATE.records.biggestPayout, 0),
      streak: STATE.session ? STATE.session.currentStreak : 0,
      winRate: STATE.session && STATE.session.rounds.length ? (STATE.session.wins/STATE.session.rounds.length*100) : (STATE.records.bestWinRate||0)
    };
    const all = STATE.leaderboard.players.map(p=>({...p, winRate: (p.wins/(p.wins+p.losses||1))*100})).concat([me]);
    const keyMap = {
      points: p=>p.points,
      payout: p=>p.biggestPayout,
      wins: p=>p.wins,
      winrate: p=>p.winRate,
      streak: p=>p.streak
    };
    const k = keyMap[category] || keyMap.points;
    all.sort((a,b)=>k(b)-k(a));
    return all;
  }
};

/* =========================================================
   SHARE CARD
   ========================================================= */
const ShareCard = {
  buildText(s){
    if(!s) return "I just played CADE Meme Madness!";
    let text = `I just finished a CADE Meme Madness run 🤯\n\n`;
    text += `${s.totalRounds} rounds\n${Math.round(s.winRate)}% win rate\n${fmt(s.endingBalance)} final points\n${s.netResult>=0?"+":""}${fmt(s.netResult)} net\n`;
    if(s.largestPayout) text += `+${fmt(s.largestPayout)} biggest payout\n`;
    text += `\n`;
    s.awards.forEach(a=>{ text += `${AWARD_DEFS[a].icon} ${AWARD_DEFS[a].title}\n`; });
    text += `\nCan you beat my score?`;
    return text;
  }
};

/* =========================================================
   IMAGE SHARE — renders the session result to a canvas and
   offers a PNG download or native share sheet (mobile).
   ========================================================= */
const ImageShare = {
  generate(s){
    const canvas = document.getElementById("shareCanvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    // background
    ctx.fillStyle = "#7B3FE4";
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 14;
    ctx.strokeRect(7,7,W-14,H-14);

    // header
    ctx.fillStyle = "#FFD23F";
    ctx.font = "900 34px Arial";
    ctx.fillText("CADE MEME MADNESS", 60, 100);
    ctx.fillStyle = "#FFF8EC";
    ctx.font = "900 56px Arial";
    ctx.fillText("MY MEME MADNESS RUN", 60, 170);

    // stat grid
    const stats = [
      ["FINAL POINTS", fmt(s.endingBalance)],
      ["NET", (s.netResult>=0?"+":"")+fmt(s.netResult)],
      ["ROUNDS", s.totalRounds],
      ["WIN RATE", Math.round(s.winRate)+"%"],
      ["BEST PAYOUT", "+"+fmt(s.largestPayout)],
      ["BEST STREAK", s.longestWinStreak]
    ];
    const boxW = (W-160)/2, boxH = 150, gap=20;
    stats.forEach((st,i)=>{
      const col = i%2, row = Math.floor(i/2);
      const x = 60 + col*(boxW+gap), y = 220 + row*(boxH+gap);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      this.roundRect(ctx,x,y,boxW,boxH,16); ctx.fill();
      ctx.fillStyle = "#FFD23F";
      ctx.font = "900 46px Arial";
      ctx.fillText(String(st[1]), x+24, y+70);
      ctx.fillStyle = "#FFF8EC";
      ctx.font = "700 22px Arial";
      ctx.fillText(st[0], x+24, y+112);
    });

    // awards
    let awY = 220 + Math.ceil(stats.length/2)*(boxH+gap) + 40;
    ctx.fillStyle = "#FFF8EC";
    ctx.font = "900 30px Arial";
    ctx.fillText("AWARDS EARNED", 60, awY);
    awY += 20;
    if(s.awards.length){
      s.awards.forEach((code,i)=>{
        const a = AWARD_DEFS[code];
        const x = 60 + (i%2)*((W-160)/2+20);
        const y = awY + 60 + Math.floor(i/2)*70;
        ctx.fillStyle = "#FFD23F";
        this.roundRect(ctx,x,y-40,(W-160)/2,56,28); ctx.fill();
        ctx.fillStyle = "#111111";
        ctx.font = "900 26px Arial";
        ctx.fillText(a.icon + " " + a.title, x+20, y-4);
      });
    } else {
      ctx.fillStyle = "#e3d4ff";
      ctx.font = "700 24px Arial";
      ctx.fillText("No awards this run — try again!", 60, awY+40);
    }

    ctx.fillStyle = "#FFD23F";
    ctx.font = "900 22px Arial";
    ctx.fillText("SIMULATION ONLY — NO REAL MONEY", 60, H-50);

    const dataUrl = canvas.toDataURL("image/png");
    this.present(dataUrl);
  },

  roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  },

  async present(dataUrl){
    // Try native share sheet first (mobile), fall back to a download modal.
    if(navigator.canShare && navigator.share){
      try{
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], "cade-meme-madness.png", { type: "image/png" });
        if(navigator.canShare({ files:[file] })){
          await navigator.share({ files:[file], title:"CADE Meme Madness", text:"Check out my Meme Madness run!" });
          return;
        }
      }catch(e){ /* fall through to modal */ }
    }
    const root = document.getElementById("modalRoot");
    root.innerHTML = `<div class="modal-overlay">
      <div class="modal share-img-modal">
        <h3>YOUR RESULT IMAGE</h3>
        <img src="${dataUrl}" alt="Meme Madness result">
        <div class="actions">
          <button class="btn btn-block" id="closeShareImg">CLOSE</button>
          <a class="btn btn-primary btn-block" download="cade-meme-madness.png" href="${dataUrl}">DOWNLOAD PNG</a>
        </div>
      </div>
    </div>`;
    document.getElementById("closeShareImg").onclick = ()=>{ root.innerHTML=""; };
  }
};

/* =========================================================
   CEREMONY
   ========================================================= */
const Ceremony = {
  run(s){
    const root = $("#ceremonyRoot");
    root.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "ceremony-overlay";
    overlay.innerHTML = `
      <button class="ceremony-skip" onclick="Ceremony.finish()">SKIP ✕</button>
      <div id="cerSteps"></div>
    `;
    root.appendChild(overlay);
    const stepsRoot = overlay.querySelector("#cerSteps");

    const steps = [];
    steps.push(`<div class="ceremony-step active">
        <div class="hero-art">🐸💥</div>
        <div class="ceremony-big">YOUR MADNESS<br>IS COMPLETE</div>
      </div>`);
    steps.push(`<div class="ceremony-step">
        <div class="ceremony-big">SCORE COUNT</div>
        <div class="ceremony-count" id="cerCounter">${fmt(s.startingBalance)}</div>
      </div>`);
    steps.push(`<div class="ceremony-step">
        <div class="ceremony-big">${s.netResult>=0?"NET RESULT":"NET RESULT"}</div>
        <div class="ceremony-count" style="color:${s.netResult>=0?'#3FCF6E':'#FF4F4F'}">${s.netResult>=0?"+":""}${fmt(s.netResult)}</div>
      </div>`);
    if(s.largestPayout>0){
      steps.push(`<div class="ceremony-step">
        <div class="ceremony-big">YOUR BEST HIT</div>
        <div class="ceremony-count">+${fmt(s.largestPayout)}</div>
      </div>`);
    }
    s.awards.forEach(code=>{
      const a = AWARD_DEFS[code];
      steps.push(`<div class="ceremony-step" data-award="${code}">
        <div class="award-badge award-anim-${code.toLowerCase()}">${AssetManager.slot("award_"+code, AssetManager.paths.award(code), a.icon, "award-art-slot")}</div>
        <div class="award-title">${a.title}</div>
        <div class="award-desc">${a.desc}</div>
      </div>`);
    });
    steps.push(`<div class="ceremony-step">
        <div class="ceremony-big">THAT'S MADNESS! 🎉</div>
        <div class="hero-art">🎊🏆🎊</div>
        <div class="ceremony-actions">
          <button class="btn btn-yellow btn-block" onclick="Ceremony.finish()">SEE MY RESULTS</button>
        </div>
      </div>`);

    stepsRoot.innerHTML = steps.join("");
    const stepEls = stepsRoot.querySelectorAll(".ceremony-step");
    let idx = 0;

    function showStep(i){
      stepEls.forEach((el,j)=>el.classList.toggle("active", j===i));
      if(i===1){ animateCounter(s.startingBalance, s.endingBalance); }
      if(stepEls[i] && stepEls[i].dataset.award){ AudioHooks.play("awardReveal"); }
      Confetti.burst();
    }
    function animateCounter(from,to){
      const el = document.getElementById("cerCounter");
      const dur = 1200, start = performance.now();
      function frame(t){
        const p = Math.min(1,(t-start)/dur);
        el.textContent = fmt(from + (to-from)*p);
        if(p<1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    overlay.addEventListener("click", (e)=>{
      if(e.target.closest("button")) return;
      idx = Math.min(idx+1, stepEls.length-1);
      showStep(idx);
    });

    // auto-advance first few steps
    let auto = setInterval(()=>{
      if(idx >= stepEls.length-1){ clearInterval(auto); return; }
      idx++; showStep(idx);
      if(idx >= stepEls.length-1) clearInterval(auto);
    }, 2200);

    showStep(0);
    this._session = s;
  },
  finish(){
    $("#ceremonyRoot").innerHTML = "";
    UI.renderSummary(this._session);
    Nav.go("summary");
  }
};

/* =========================================================
   CONFETTI
   ========================================================= */
const Confetti = {
  colors: ["#7B3FE4","#FFD23F","#FF7A29","#3FCF6E","#FF4F4F"],
  burst(count=24){
    const root = document.body;
    for(let i=0;i<count;i++){
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = rand(0,100)+"vw";
      p.style.background = pick(this.colors);
      p.style.animationDelay = rand(0,0.4)+"s";
      p.style.position = "fixed";
      p.style.zIndex = 500;
      root.appendChild(p);
      setTimeout(()=>p.remove(), 2200);
    }
  }
};

// #17/#43 — small reusable count-up used by the win result and the award
// ceremony's balance/best-hit counters. Respects prefers-reduced-motion by
// jumping straight to the end value.
function countUp(el, from, to, duration=800){
  if(!el) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reduce){ el.textContent = fmt(to); return; }
  const start = performance.now();
  const diff = to - from;
  function tick(now){
    const t = Math.min(1, (now-start)/duration);
    const eased = 1 - Math.pow(1-t, 3); // ease-out cubic
    el.textContent = fmt(Math.round(from + diff*eased));
    if(t < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(to);
  }
  requestAnimationFrame(tick);
}

// #17 — a "+N" chip that floats upward and fades, layered over the result
// card on a win, reinforcing the payout without being a separate screen.
function floatPoints(amount){
  const chip = document.createElement("div");
  chip.className = "float-points";
  chip.textContent = "+" + fmt(amount);
  document.body.appendChild(chip);
  setTimeout(()=>chip.remove(), 1600);
}

/* =========================================================
   UI RENDERING
   ========================================================= */
const UI = {
  updateHeaderPoints(){
    $("#headerPoints").textContent = fmt(STATE.balance);
  },

  renderHome(){
    this.updateHeaderPoints();
    const canClaim = !STATE.lastClaim || (Date.now() - STATE.lastClaim >= 24*3600*1000);
    const claimBtn = $("#claimBtn");
    const status = $("#claimStatus");
    if(canClaim){
      claimBtn.style.display = "block";
      claimBtn.disabled = false;
      status.style.display = "none";
    } else {
      claimBtn.style.display = "none";
      status.style.display = "block";
      const remain = 24*3600*1000 - (Date.now()-STATE.lastClaim);
      const h = Math.floor(remain/3600000), m = Math.floor((remain%3600000)/60000);
      status.textContent = "20,000 POINTS CLAIMED ✓ — NEXT CLAIM IN " + h + "h " + m + "m";
    }
    const grid = $("#boostGrid");
    grid.innerHTML = "";
    CONFIG.BOOST_ACTIONS.forEach(b=>{
      const done = STATE.boosts[b.id];
      const div = document.createElement("div");
      div.className = "boost-card" + (done ? " done" : "");
      div.innerHTML = `<div style="font-size:1.4rem;">${b.icon}</div>
        <b>${b.label}</b>
        <div class="reward">+${fmt(b.reward)} POINTS</div>
        <button class="btn ${done?'':'btn-purple'}" ${done?'disabled':''} onclick="Game.doBoost('${b.id}')">${done?'COMPLETED ✓':'CLAIM BOOST'}</button>`;
      grid.appendChild(div);
    });
  },

  renderCoin(coin){
    const up = coin.move >= 0;
    $("#coinCard").innerHTML = `
      <div class="coin-logo">${AssetManager.slot("coin_"+coin.ticker, AssetManager.paths.coin(coin.ticker), coin.emoji, "coin-art-slot")}</div>
      <div>
        <div class="coin-name">${coin.ticker}</div>
        <div class="coin-ticker">$${coin.ticker}</div>
        <div class="coin-price">$${coin.price}</div>
        <div class="coin-move ${up?'up':'down'}">${up?'+':''}${coin.move}%</div>
      </div>`;
  },

  renderChart(coin){
    const pts = coin.history;
    const w = 300, h = 70;
    const stepX = w/(pts.length-1);
    const max = Math.max(...pts), min = Math.min(...pts);
    const norm = v => h - ((v-min)/(max-min||1))*h;
    const d = pts.map((v,i)=> (i===0?"M":"L") + (i*stepX).toFixed(1) + "," + norm(v).toFixed(1)).join(" ");
    const up = pts[pts.length-1] >= pts[0];
    // #8 — simple animated chart: the line draws itself in via a
    // stroke-dash reveal, and a small dot pulses at the latest point.
    const lastX = ((pts.length-1)*stepX).toFixed(1);
    const lastY = norm(pts[pts.length-1]).toFixed(1);
    $("#chartCard").innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <path class="chart-line" d="${d}" fill="none" stroke="${up?'#3FCF6E':'#FF4F4F'}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle class="chart-dot" cx="${lastX}" cy="${lastY}" r="5" fill="${up?'#3FCF6E':'#FF4F4F'}" stroke="#111111" stroke-width="2"/>
      </svg>`;
    // Draw-in: measure the path and animate stroke-dashoffset from full to 0.
    requestAnimationFrame(()=>{
      const path = document.querySelector("#chartCard .chart-line");
      if(!path) return;
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.getBoundingClientRect(); // force reflow so the transition kicks in
      path.style.transition = "stroke-dashoffset 0.9s ease-out";
      path.style.strokeDashoffset = "0";
    });
  },

  renderRiskGrid(){
    const grid = $("#riskGrid");
    grid.innerHTML = "";
    // #15 — edge case: balance at (or near) zero. No error state — just a
    // plain, friendly note, and every chip above what's left stays disabled.
    const zeroNote = $("#riskZeroNote");
    if(zeroNote){
      zeroNote.style.display = STATE.balance <= 0 ? "block" : "none";
      zeroNote.textContent = "You're out of points to risk this round — claim your daily points or complete boosts on the home screen to keep playing.";
    }
    CONFIG.QUICK_RISKS.forEach(v=>{
      const btn = document.createElement("button");
      btn.className = "risk-chip";
      btn.textContent = fmt(v);
      btn.dataset.val = v;
      btn.disabled = v > STATE.balance;
      btn.setAttribute("aria-label", "Risk " + fmt(v) + " points" + (v > STATE.balance ? " (not enough points)" : ""));
      btn.onclick = ()=>Game.selectRisk(v);
      grid.appendChild(btn);
    });
    const custom = document.createElement("button");
    custom.className = "risk-chip";
    custom.textContent = "CUSTOM";
    custom.disabled = STATE.balance <= 0;
    custom.onclick = ()=>Game.selectCustom();
    grid.appendChild(custom);
    $("#customRisk").style.display = "none";
    $("#customRisk").value = "";
    $("#customRisk").max = STATE.balance;
  },

  resetPredictionUI(){
    Round.locked = false;
    Round.reviewing = false;
    $("#reviewPanel").style.display = "none";
    $("#tierBadgeWrap").innerHTML = "";
    $("#upBtn").classList.remove("selected");
    $("#downBtn").classList.remove("selected");
    $("#upBtn").disabled = false;
    $("#downBtn").disabled = false;
    document.querySelectorAll(".risk-chip").forEach(c=>{ c.classList.remove("selected"); c.disabled = Number(c.dataset.val) > STATE.balance; });
    $("#confirmBtn").disabled = true;
    $("#confirmBtn").style.display = "block";
    $("#lockedBanner").style.display = "none";
    $("#potProfit").textContent = "+0";
    $("#potLoss").textContent = "-0";
    document.querySelectorAll(".risk-grid, .updown, #customRisk").forEach(el=>el.style.pointerEvents="auto");
  },

  updatePayoutPreview(){
    const mult = MarketEngine.getMultiplier(Round.risk||0);
    const profit = Math.round((Round.risk||0)*mult);
    $("#potProfit").textContent = "+"+fmt(profit);
    $("#potLoss").textContent = "-"+fmt(Round.risk||0);
    this.updateTierBadge();
  },

  updateTierBadge(){
    const wrap = $("#tierBadgeWrap");
    if(!wrap) return;
    if(!CONFIG.USE_TIERED_PAYOUT || !Round.risk || Round.risk<=0){
      wrap.innerHTML = "";
      return;
    }
    const tier = CONFIG.RISK_TIERS.find(t => Round.risk >= t.min && Round.risk <= t.max);
    if(!tier){ wrap.innerHTML = ""; return; }
    const labelMap = { 1.5:"LOW RISK", 1.8:"MEDIUM RISK", 2.0:"HIGH RISK" };
    const classMap = { 1.5:"low", 1.8:"medium", 2.0:"high" };
    const label = labelMap[tier.mult] || "RISK";
    const cls = classMap[tier.mult] || "medium";
    wrap.innerHTML = `<span class="tier-badge ${cls}">${label} — ${tier.mult}x</span>`;
  },

  updateConfirmState(){
    $("#confirmBtn").disabled = !(Round.prediction && Round.risk>0 && Round.risk<=STATE.balance);
  },

  showReview(){
    $("#upBtn").disabled = true;
    $("#downBtn").disabled = true;
    document.querySelectorAll(".risk-chip").forEach(c=>c.disabled=true);
    $("#customRisk").disabled = true;
    $("#confirmBtn").style.display = "none";
    const mult = MarketEngine.getMultiplier(Round.risk);
    const profit = Math.round(Round.risk*mult);
    $("#revPrediction").textContent = Round.prediction;
    $("#revRisk").textContent = fmt(Round.risk);
    $("#revProfit").textContent = "+"+fmt(profit);
    $("#revLoss").textContent = "-"+fmt(Round.risk);
    $("#reviewPanel").style.display = "block";
  },

  hideReview(){
    $("#reviewPanel").style.display = "none";
    $("#upBtn").disabled = false;
    $("#downBtn").disabled = false;
    document.querySelectorAll(".risk-chip").forEach(c=>{ c.disabled = Number(c.dataset.val) > STATE.balance; });
    $("#customRisk").disabled = false;
    $("#confirmBtn").style.display = "block";
  },

  lockUI(){
    $("#reviewPanel").style.display = "none";
    $("#upBtn").disabled = true;
    $("#downBtn").disabled = true;
    document.querySelectorAll(".risk-chip").forEach(c=>c.disabled=true);
    $("#customRisk").disabled = true;
    $("#confirmBtn").style.display = "none";
    const banner = $("#lockedBanner");
    banner.style.display = "block";
    banner.innerHTML = `PREDICTION LOCKED<br>Your prediction: ${Round.prediction} | Risk: ${fmt(Round.risk)} | Potential profit: +${fmt(Math.round(Round.risk*MarketEngine.getMultiplier(Round.risk)))}`;
  },

  updateTimerDisplay(t){
    const el = $("#timerCircle");
    el.textContent = Math.max(0,t);
    el.classList.toggle("urgent", t<=7);
  },

  updateStatsStrip(){
    const s = STATE.session;
    if(!s) return;
    const winRate = s.rounds.length ? (s.wins/s.rounds.length*100) : 0;
    const stats = [
      { lbl:"BALANCE", num: fmt(STATE.balance) },
      { lbl:"SESSION ROUNDS", num: s.rounds.length },
      { lbl:"SESSION WIN %", num: Math.round(winRate)+"%" },
      { lbl:"SESSION BEST", num: "+"+fmt(s.largestPayout) },
      { lbl:"SESSION STREAK", num: s.currentStreak }
    ];
    $("#statsStrip").innerHTML = stats.map(st=>`<div class="stat"><div class="num">${st.num}</div><div class="lbl">${st.lbl}</div></div>`).join("")
      + `<div class="muted small mt8" style="grid-column:1/-1;">BALANCE is your live, all-time point total. Everything else on this strip resets each session.</div>`;
  },

  showRoundResult(round, session){
    const win = round.result === "WIN";
    const root = $("#resultRoot");
    root.innerHTML = "";
    const balanceBefore = win ? STATE.balance - round.payout : STATE.balance + round.riskAmount;
    const overlay = document.createElement("div");
    overlay.className = "result-overlay";
    overlay.innerHTML = `
      <div class="result-card ${win?'win':'lose'}">
        <div class="result-emoji">${win?'🎉':'💀'}</div>
        <h2>${win?'YOU GOT IT!':'OOPS!'}</h2>
        <div class="result-line">${round.coin.ticker} went ${round.actualDir} (${round.pctMove>=0?'+':''}${round.pctMove}%)</div>
        <div class="result-line">Your prediction: ${round.prediction} ${win?'✓':'✕'}</div>
        <div class="result-stat"><span>${win?'RISK':'RISK'}</span><span>${fmt(round.riskAmount)}</span></div>
        <div class="result-stat"><span>${win?'PROFIT':'LOSS'}</span><span id="resultPayout">${win?'+':'-'}${fmt(round.payout)}</span></div>
        <div class="result-stat"><span>NEW BALANCE</span><span id="resultBalance">${fmt(balanceBefore)}</span></div>
        <button class="btn btn-primary btn-block mt16" onclick="UI.nextRound()">NEXT MEME →</button>
      </div>`;
    root.appendChild(overlay);
    if(win){
      Confetti.burst(30);
      floatPoints(round.payout);
      // #17 — balance counts up from its pre-round value to the new
      // total rather than just appearing, so the win actually reads as
      // points landing rather than a static number swap.
      countUp($("#resultBalance"), balanceBefore, STATE.balance, 700);
    } else {
      // #18 — a quick comic-style count-down rather than a static swap,
      // kept understated (no confetti/particles) so losses don't feel
      // punishing — just a clear, quick "ticking down" of the balance.
      countUp($("#resultBalance"), balanceBefore, STATE.balance, 500);
      const card = overlay.querySelector(".result-card");
      if(card) card.classList.add("shake-once");
    }
  },

  nextRound(){
    $("#resultRoot").innerHTML = "";
    Round.begin();
  },

  renderLeaderboard(){
    const tabs = [
      { key:"points", label:"TOP POINTS" },
      { key:"payout", label:"BIGGEST PAYOUT" },
      { key:"wins", label:"MOST WINS" },
      { key:"winrate", label:"BEST WIN RATE" },
      { key:"streak", label:"LONGEST STREAK" }
    ];
    if(!this._lbActive) this._lbActive = "points";
    $("#lbTabs").innerHTML = tabs.map(t=>`<button class="tab-btn ${t.key===this._lbActive?'active':''}" onclick="UI.setLbTab('${t.key}')">${t.label}</button>`).join("");
    const ranked = Leaderboard.getRanked(this._lbActive);
    const valFn = {
      points: p=>fmt(p.points),
      payout: p=>"+"+fmt(p.biggestPayout),
      wins: p=>p.wins,
      winrate: p=>Math.round(p.winRate)+"%",
      streak: p=>p.streak
    }[this._lbActive];
    const list = $("#lbList");
    list.innerHTML = "";
    let myRank = ranked.findIndex(p=>p.isMe)+1;
    ranked.forEach((p,i)=>{
      const row = document.createElement("div");
      row.className = "lb-row" + (p.isMe ? " me" : "");
      row.innerHTML = `<div class="lb-rank">#${i+1}</div>
        <div class="lb-avatar">${AssetManager.slot("avatar_"+p.name, AssetManager.paths.avatar(p.name), p.avatar, "avatar-art-slot")}</div>
        <div style="flex:1;">
          <div class="lb-name">${p.name}${p.isMe?'':'<span class="sim-badge">SIMULATED PLAYER</span>'}</div>
          <div class="lb-sub">${p.wins}W / ${p.losses}L</div>
          ${p.isMe ? '<div class="lb-sub-alltime">Your all-time balance, not just this session</div>' : ''}
        </div>
        <div class="lb-val">${valFn(p)}</div>`;
      list.appendChild(row);
    });
    const banner = document.createElement("div");
    banner.className = "card purple center";
    banner.innerHTML = `<b>YOU ARE #${myRank}</b><div class="muted mt8" style="color:#e3d4ff;">Leaderboard ranks use your all-time balance & lifetime stats — not just your current session.</div>`;
    list.prepend(banner);
  },
  setLbTab(key){ this._lbActive = key; this.renderLeaderboard(); },

  renderVote(){
    if(!STATE.votes || Date.now() > STATE.votes.endsAt){
      const coins = [];
      const used = new Set();
      while(coins.length<4){
        const c = pick(COIN_POOL);
        if(used.has(c[0])) continue;
        used.add(c[0]);
        coins.push({ ticker:c[0], emoji:c[1], votes: randInt(50,900) });
      }
      STATE.votes = { endsAt: Date.now()+60*60*1000, coins, voted:false };
      saveState();
    }
    clearInterval(this._voteInterval);
    this._voteInterval = setInterval(()=>{
      const remain = STATE.votes.endsAt - Date.now();
      if(remain<=0){ clearInterval(this._voteInterval); this.renderVote(); return; }
      const m = Math.floor(remain/60000), sec = Math.floor((remain%60000)/1000);
      const el = $("#voteTimer");
      if(el) el.textContent = String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");
    },1000);
    const total = STATE.votes.coins.reduce((a,c)=>a+c.votes,0);
    $("#voteList").innerHTML = STATE.votes.coins.map((c,i)=>{
      const pct = Math.round(c.votes/total*100);
      return `<div class="vote-card">
        <div class="coin-logo" style="width:48px;height:48px;font-size:1.4rem;">${c.emoji}</div>
        <div style="flex:1;">
          <b>$${c.ticker}</b>
          <div class="vote-bar-wrap"><div class="vote-bar" style="width:${pct}%"></div></div>
          <div class="muted small">${fmt(c.votes)} votes (${pct}%)</div>
        </div>
        <button class="btn btn-purple" ${STATE.votes.voted?'disabled':''} onclick="UI.castVote(${i})">VOTE</button>
      </div>`;
    }).join("");
  },
  async castVote(i){
    if(STATE.votes.voted){ toast("You already voted this round!"); return; }
    const roundId = STATE.votes.endsAt; // stable id for this voting round window
    try{
      // #12 — server enforces one vote per round; local fallback mirrors it.
      await Api.castVote(roundId, STATE.votes.coins[i].ticker, async ()=>{
        if(STATE.votes.voted){ const err = new Error("Already voted"); err.status = 429; throw err; }
        return { ok:true };
      });
      STATE.votes.coins[i].votes++;
      STATE.votes.voted = true;
      if(!STATE.boosts.vote){ STATE.boosts.vote = true; STATE.balance += CONFIG.BOOST_ACTIONS.find(b=>b.id==="vote").reward; toast("+500 POINTS — VOTED!"); }
      saveState();
      UI.updateHeaderPoints();
      this.renderVote();
    }catch(e){
      toast("You already voted this round!");
    }
  },

  renderHistory(){
    const list = $("#historyList");
    if(!STATE.history.length){
      list.innerHTML = `<div class="card center muted">No completed sessions yet. Play your first Meme Madness run!</div>`;
      return;
    }
    list.innerHTML = STATE.history.map((s,i)=>{
      const num = STATE.history.length-i;
      const date = new Date(s.startedAt).toLocaleDateString(undefined,{month:"long",day:"numeric",year:"numeric"});
      return `<div class="hist-card">
        <div class="hist-top"><span>SESSION #${String(num).padStart(3,"0")}</span><span class="muted">${date}</span></div>
        <div class="hist-grid">
          <div><div class="muted">START</div><b>${fmt(s.startingBalance)}</b></div>
          <div><div class="muted">END</div><b>${fmt(s.endingBalance)}</b></div>
          <div><div class="muted">NET</div><b style="color:${s.netResult>=0?'#3FCF6E':'#FF4F4F'}">${s.netResult>=0?'+':''}${fmt(s.netResult)}</b></div>
          <div><div class="muted">ROUNDS</div><b>${s.totalRounds}</b></div>
          <div><div class="muted">WIN RATE</div><b>${Math.round(s.winRate)}%</b></div>
          <div><div class="muted">AWARDS</div><b>${s.awards.map(a=>AWARD_DEFS[a].icon).join(" ")||"—"}</b></div>
        </div>
        <button class="btn btn-purple btn-block mt12" onclick="UI.viewSession('${s.sessionId}')">VIEW SESSION</button>
      </div>`;
    }).join("");
  },
  viewSession(id){
    const s = STATE.history.find(h=>h.sessionId===id);
    if(!s) return;
    this.renderSummary(s);
    Nav.go("summary");
  },

  renderRecords(){
    const r = STATE.records;
    const items = [
      { l:"HIGHEST POINT BALANCE", v: fmt(r.highestBalance) },
      { l:"BIGGEST PAYOUT", v: "+"+fmt(r.biggestPayout) },
      { l:"BEST WIN RATE", v: Math.round(r.bestWinRate)+"%" },
      { l:"LONGEST STREAK", v: r.longestStreak },
      { l:"MOST ROUNDS", v: r.mostRounds },
      { l:"MOST POINTS RISKED", v: fmt(r.mostRisked) }
    ];
    $("#recordsGrid").innerHTML = `<div class="muted small mt8" style="grid-column:1/-1;">These are your all-time bests across every completed session.</div>`
      + items.map(i=>`<div class="record-box"><div class="v">${i.v}</div><div class="l">${i.l}</div></div>`).join("")
      + `<div class="record-box" style="grid-column:1/-1;"><div class="l">BEST SESSION NET</div><div class="v">${r.bestSessionNet>-Infinity ? (r.bestSessionNet>=0?'+':'')+fmt(r.bestSessionNet) : '—'}</div></div>`;
  },

  renderSummary(s){
    const root = $("#shareCardRoot");
    root.innerHTML = `
      <h3>MY MEME MADNESS RUN</h3>
      <div class="share-grid">
        <div class="box"><div class="v">${fmt(s.endingBalance)}</div><div class="muted">FINAL POINTS</div></div>
        <div class="box"><div class="v">${s.netResult>=0?'+':''}${fmt(s.netResult)}</div><div class="muted">NET</div></div>
        <div class="box"><div class="v">${s.totalRounds}</div><div class="muted">ROUNDS</div></div>
        <div class="box"><div class="v">${Math.round(s.winRate)}%</div><div class="muted">WIN RATE</div></div>
        <div class="box"><div class="v">+${fmt(s.largestPayout)}</div><div class="muted">BEST PAYOUT</div></div>
        <div class="box"><div class="v">${s.longestWinStreak}</div><div class="muted">BEST STREAK</div></div>
      </div>
      <div class="award-chip-row">
        ${s.awards.length ? s.awards.map(a=>`<span class="award-chip">${AWARD_DEFS[a].icon} ${AWARD_DEFS[a].title}</span>`).join("") : '<span class="muted">No awards this run — try again!</span>'}
      </div>`;
    STATE._lastViewed = s;
  },

  showModal({title, body, confirmLabel, cancelLabel, onConfirm, hideCancel}){
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-overlay">
      <div class="modal">
        <h3>${title}</h3>
        <p class="mt12">${body}</p>
        <div class="actions">
          ${hideCancel?'':`<button class="btn btn-block" id="modalCancel">${cancelLabel||'CANCEL'}</button>`}
          <button class="btn btn-primary btn-block" id="modalConfirm">${confirmLabel||'CONFIRM'}</button>
        </div>
      </div>
    </div>`;
    $("#modalConfirm").onclick = onConfirm;
    const cancelBtn = document.getElementById("modalCancel");
    if(cancelBtn) cancelBtn.onclick = ()=>UI.hideModal();
  },
  hideModal(){ $("#modalRoot").innerHTML = ""; }
};

/* =========================================================
   INIT
   ========================================================= */
(function init(){
  Leaderboard.ensure();
  UI.updateHeaderPoints();
  UI.renderHome();
  Nav.go("home");
  // Brand-level asset slots (logo + hero art)
  const logoSlot = document.getElementById("headerLogoSlot");
  if(logoSlot) logoSlot.innerHTML = AssetManager.slot("logo", AssetManager.paths.logo, "🐸", "");
  const heroSlot = document.getElementById("heroArtSlot");
  if(heroSlot) heroSlot.innerHTML = AssetManager.slot("hero", AssetManager.paths.hero, "🐸💥🚀", "hero-art-slot");

  // #8 — one global tap sound for every button, instead of wiring each
  // handler individually. Silent no-op until unmuted / files exist.
  document.addEventListener("click", (e)=>{
    if(e.target.closest("button")) AudioHooks.play("buttonTap");
  });

  // Mute toggle button lives in the header (see index.html); reflect state.
  const muteBtn = document.getElementById("muteToggle");
  function syncMuteBtn(){
    if(!muteBtn) return;
    const muted = AudioHooks.isMuted();
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    muteBtn.setAttribute("aria-pressed", String(!muted));
  }
  if(muteBtn){
    muteBtn.addEventListener("click", ()=>{ AudioHooks.toggleMute(); syncMuteBtn(); });
    document.addEventListener("audiomutechange", syncMuteBtn);
    syncMuteBtn();
  }

  // #15 — edge case: if the tab is hidden/closed with a locked-but-unresolved
  // prediction mid-round, the round still resolves in the background on its
  // own timer (setInterval keeps running while backgrounded on most
  // browsers, just throttled) — we don't forfeit it. If the page is
  // actually torn down (closed), progress up to the last save is kept via
  // saveState()/Api calls already made when the prediction was locked, so
  // nothing is lost; only that specific in-flight round's outcome won't be
  // recorded, which is called out as expected behavior below.
  window.addEventListener("beforeunload", ()=>{
    if(Round.active && Round.locked){
      saveState(); // best-effort: persist state right up to tear-down
    }
  });
})();
