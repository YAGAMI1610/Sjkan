/* =====================================================
   CADE MEME MADNESS — Core Simulation Engine
   All data is fictional. LocalStorage persistence.
   ===================================================== */

const STORAGE_KEY = "cade_meme_madness_v1";

/* The rules — every tunable number, the coin pools, the outcome table, the award
   thresholds and the payout maths — live in rules.js, which the CLI and the
   reference backend load too. They are aliased into locals here so the rest of
   this file reads exactly as it did when the tables were inline.

   Why not keep a copy per front end: the tables were written out three times and
   drifted twice. The backend was rolling ±40% price moves against the browser's
   ±18% and weighting FLAT differently, so the same round scored differently
   depending on whether a backend happened to be reachable. One module makes that
   impossible instead of merely fixed. */
const CONFIG = CadeRules.CONFIG;

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
    avatar: id => `assets/avatars/${String(id).toLowerCase().replace(/\s+/g,'-')}.svg`,
    // §2/§40 — per-round meme artwork. Drop a file here to override the
    // procedurally drawn comic panel MemeImage generates as its placeholder.
    meme: ticker => `assets/memes/${ticker.toLowerCase()}.svg`
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

  // As slot(), but the placeholder is an arbitrary HTML/SVG string rather than a
  // short emoji — so it is never round-tripped through a data- attribute (which
  // would break on the quotes inside markup).
  slotHTML(key, path, fallbackHTML, className){
    const id = "art_" + key + "_" + Math.random().toString(36).slice(2,8);
    setTimeout(()=> this._tryLoad(id, path, null), 0);
    return `<span class="art-slot ${className||''}" id="${id}">${fallbackHTML}</span>`;
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

/* =========================================================
   MEME IMAGE (§2, §40)
   Per-round meme artwork. A real file at assets/memes/<ticker>.svg always
   wins; until one exists, a comic panel is drawn procedurally from the
   coin's own identity so every coin — including the dynamically minted
   ones that will never have a file — still gets distinct art rather than a
   bare emoji. Palette is CADE flat colours, thick black outline, halftone
   dots: no gradients, neon or hologram effects.
   ========================================================= */
const MemeImage = {
  // Stable per-ticker hash so a coin looks identical every time it appears.
  _hash(str){
    let h = 0;
    for(let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) & 0x7fffffff;
    return h;
  },
  ACCENTS: ["#7B3FE4","#FFD23F","#FF7A29","#3FCF6E","#FF4F4F","#00B4D8","#FF6FB5"],

  panel(coin){
    const h = this._hash(coin.ticker);
    const accent = this.ACCENTS[h % this.ACCENTS.length];
    const rays = 12 + (h % 6);
    const rot = h % 30;
    // Comic sunburst + halftone + the coin's emoji as the "character".
    const raySlices = Array.from({length: rays}, (_,i)=>{
      const a1 = (360/rays)*i, a2 = a1 + (360/rays)/2;
      const p = (deg,r)=>[100+r*Math.cos(deg*Math.PI/180), 70+r*Math.sin(deg*Math.PI/180)];
      const [x1,y1] = p(a1,150), [x2,y2] = p(a2,150);
      return `<path d="M100,70 L${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${accent}" opacity=".55"/>`;
    }).join("");
    return `<svg viewBox="0 0 200 140" role="img" aria-label="${coin.ticker} meme artwork" preserveAspectRatio="xMidYMid slice">
      <defs>
        <clipPath id="mp_${h}"><rect x="0" y="0" width="200" height="140" rx="8"/></clipPath>
        <pattern id="ht_${h}" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="1.6" cy="1.6" r="1.5" fill="#111" opacity=".22"/>
        </pattern>
      </defs>
      <g clip-path="url(#mp_${h})">
        <rect width="200" height="140" fill="#FFF8EC"/>
        <g transform="rotate(${rot} 100 70)">${raySlices}</g>
        <rect width="200" height="140" fill="url(#ht_${h})"/>
        <text x="100" y="92" font-size="62" text-anchor="middle">${coin.emoji}</text>
        <rect x="0" y="112" width="200" height="28" fill="#111"/>
        <text x="100" y="132" font-size="17" font-weight="900" text-anchor="middle"
              fill="#FFF8EC" font-family="Arial Black, Arial, sans-serif"
              letter-spacing="0.5">$${coin.ticker}</text>
      </g>
      <rect x="2" y="2" width="196" height="136" rx="8" fill="none" stroke="#111" stroke-width="4"/>
    </svg>`;
  },

  // The replaceable slot the UI actually calls.
  render(coin){
    return AssetManager.slotHTML(
      "meme_" + coin.ticker,
      AssetManager.paths.meme(coin.ticker),
      this.panel(coin),
      "meme-art-slot"
    );
  }
};

/* Curated coins (each has hand-drawn SVG art on disk in /assets/coins), plus the
   parts a dynamically minted ticker is assembled from. Generated coins have no
   SVG file, so AssetManager falls them back to their emoji — intended, not a
   missing asset. All from rules.js; see the note above CONFIG. */
const COIN_POOL = CadeRules.COIN_POOL;
const COIN_PREFIXES = CadeRules.COIN_PREFIXES;
const COIN_SUFFIXES = CadeRules.COIN_SUFFIXES;
const COIN_EMOJI = CadeRules.COIN_EMOJI;
const SIM_PLAYERS_BASE = CadeRules.SIM_PLAYERS_BASE;
const OUTCOMES = CadeRules.OUTCOMES;
const AWARD_DEFS = CadeRules.AWARD_DEFS;
/* Declared here rather than down in the UTIL block: these replaced hoisted
   `function` declarations, and a `const` is not hoisted — anything running at
   module scope above its declaration would hit the temporal dead zone. */
const rand = CadeRules.rand;
const randInt = CadeRules.randInt;
const pick = CadeRules.pick;

/* Every award consumer used to index AWARD_DEFS directly and assume s.awards was
   an array — `s.awards.map(a=>AWARD_DEFS[a].icon)`. Two ways that threw:

     1. A session archived by an older build (or returned by /api/history from a
        server that doesn't compute awards) has no `awards` field at all, so
        `.map` was called on undefined and the whole History screen rendered
        blank instead of listing the runs.
     2. An award code that isn't in AWARD_DEFS — a renamed constant, a session
        from a newer build read back by an older one — made AWARD_DEFS[code]
        undefined and `.icon` threw.

   Both are recoverable: an unknown code is simply not shown. Everything that
   displays awards goes through this so the failure mode is a missing chip, not a
   dead screen. */
const awardsOf = CadeRules.awardsOf;

/* ---------------- STATE ---------------- */
function defaultState(){
  return {
    // §41 — stable local identity for the session records. Not an account: it
    // just lets a session say who played it, and gives the backend something to
    // reconcile against when real auth replaces device-linked accounts.
    userId: "user_" + Math.random().toString(36).slice(2,10),
    balance: 0,
    lastClaim: null,
    boosts: { profile:false, share:false, submit:false, vote:false },
    session: null, // current active session
    history: [],
    // Points committed to a locked round that has not resolved yet. The stake
    // leaves `balance` the moment a prediction is locked, so it lives here until
    // the round settles. Persisted, because a reload mid-round would otherwise
    // leave the balance debited with no round left to pay it back — see the
    // orphan refund in loadState().
    pendingStake: 0,
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
    if(raw){
      const merged = Object.assign(defaultState(), JSON.parse(raw));
      /* A stake is debited when a round locks and returned when it resolves. A
         reload in between kills the round — Round lives in memory and no round is
         ever resumed — so any pendingStake found at boot belongs to a round that
         can never pay it back. Return it. Without this the player is simply short
         the stake, with nothing on screen to explain where it went. */
      const orphaned = Math.max(0, Math.floor(Number(merged.pendingStake) || 0));
      if(orphaned > 0){
        merged.balance += orphaned;
        merged.pendingStake = 0;
        try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); }catch(e){}
      }
      // Persist the userId the first time an older save is upgraded, so it stays
      // stable across reloads instead of being regenerated from defaultState().
      if(!JSON.parse(raw).userId){
        try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); }catch(e){}
      }
      return merged;
    }
  }catch(e){}
  return defaultState();
}
/* saveState is called from inside gameplay (every round resolution, every claim),
   so it must never throw. Two things made it throw in production:

   1. localStorage is unavailable or write-blocked (Safari private browsing,
      "block all cookies", storage-disabled embeds). setItem raises there.
   2. QuotaExceededError. history[] was unbounded and every archived round kept
      the coin's full 24-point chart array, so a heavy player accumulated
      megabytes. Once the quota was hit, the throw propagated out of
      Round.resolve() and the round result overlay never appeared — the game
      looked frozen mid-round with no way to recover short of clearing storage.

   The fix is a guard plus back-pressure: trim history and retry rather than
   giving up, and never persist per-round chart data, which is only used to draw
   the chart during the round it belongs to. */
const HISTORY_LIMIT = CONFIG.HISTORY_LIMIT;

function safeSetItem(key, value){
  try{
    localStorage.setItem(key, value);
    return true;
  }catch(e){
    return false;
  }
}

function saveState(){
  if(safeSetItem(STORAGE_KEY, JSON.stringify(STATE))) return true;
  // Over quota (or storage refused the write). Shed the oldest history and the
  // heaviest field in it, then retry — a couple of times, halving each pass.
  for(let attempt = 0; attempt < 3; attempt++){
    if(Array.isArray(STATE.history) && STATE.history.length > 1){
      STATE.history = STATE.history.slice(0, Math.max(1, Math.floor(STATE.history.length / 2)));
    } else if(Array.isArray(STATE.history) && STATE.history.length === 1){
      STATE.history = [];
    } else {
      break;
    }
    if(safeSetItem(STORAGE_KEY, JSON.stringify(STATE))) return true;
  }
  return false; // storage is simply unavailable — keep playing in memory
}

// A round record only needs the chart while its own round is on screen. Keeping
// the 24-point array for every round of every session is what filled the quota.
function trimRoundForStorage(round){
  if(round && round.coin && round.coin.history) delete round.coin.history;
  return round;
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
    /* The vote countdown was started by renderVote() and never stopped. It ticks
       every second, and when the window expires it calls renderVote() again,
       which starts a fresh one — so after a single visit to the Vote screen the
       app did a DOM lookup every second for the rest of the tab's life, on every
       other screen, including mid-round in the arena. */
    if(screen !== "vote"){
      clearInterval(UI._voteInterval);
      UI._voteInterval = null;
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
        if(STATE.lastClaim && now - STATE.lastClaim < CONFIG.DAILY_CLAIM_WINDOW_MS){
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
      userId: STATE.userId,
      startedAt: Date.now(),
      // The 10-minute cap, as an absolute deadline. See SessionClock.
      endsAt: Date.now() + CONFIG.SESSION_SECONDS * 1000,
      timeExpired: false,
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
    UI.showArenaArt(false);
    SessionClock.start();
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

    /* The stake leaves the balance here, not 25 seconds later when the round
       resolves. Locking a prediction commits the points, and the countdown keeps
       running after the lock — so between the two the balance was still showing
       points that were already spoken for, and the risk grid still offered them
       for a stake. resolve() returns this escrow before applying the round's
       payout, so the net movement per round is unchanged: a win still nets
       +risk×multiplier and a loss still costs exactly the stake. */
    const stake = Math.max(0, Math.floor(Number(Round.risk) || 0));
    if(stake > 0){
      Round.escrow = stake;
      STATE.balance -= stake;
      STATE.pendingStake = stake;
      UI.updateHeaderPoints();
      UI.updateStatsStrip();
    }

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

  /* Close the books on the live session and archive it. Split out of
     endSession() because there are now two callers with different endings: the
     player finishing a run (ceremony, then the summary screen) and a run whose
     10-minute clock ran out while the tab was closed, which is picked up on the
     next load and archived with no ceremony at all. Returns the archived session,
     or null if there wasn't one. */
  archiveSession(){
    const s = STATE.session;
    if(!s) return null;
    SessionClock.stop();
    /* Settle any live stake *before* the snapshot below. Ending a session
       mid-round leaves a locked round whose escrow is still out; reading
       STATE.balance first would archive the session with a phantom loss, and
       netResult would be short by the stake for good. Round.resolve() settles
       again when its timer eventually fires — settleEscrow() is idempotent, so
       that second call returns nothing. */
    Round.settleEscrow();
    s.endedAt = Date.now();
    s.endingBalance = STATE.balance;
    s.totalRounds = s.rounds.length;
    s.winRate = s.totalRounds ? (s.wins / s.totalRounds * 100) : 0;
    s.netResult = s.endingBalance - s.startingBalance;

    s.awards = Awards.calculate(s);

    /* The simulated "how you'd have done in the real campaign" comparison is
       rolled ONCE, here, and archived with the session. Rolling it in the
       renderer instead would hand the player a different rank and a different
       prize every time they reopened the same run from history. */
    s.campaign = CadeRules.simulateCampaignResult(s);

    // Drop the per-round chart arrays before archiving, and keep history bounded.
    // Without this, storage grows without limit for as long as someone plays.
    if(Array.isArray(s.rounds)) s.rounds.forEach(trimRoundForStorage);
    STATE.history.unshift(s);
    if(STATE.history.length > HISTORY_LIMIT) STATE.history.length = HISTORY_LIMIT;
    Records.update(s);
    STATE.session = null;
    saveState();

    Api.endSession(s.sessionId, s, ()=>({ ok:true, balance: STATE.balance, records: STATE.records }));
    return s;
  },

  endSession(){
    UI.hideModal();
    const s = this.archiveSession();
    if(!s) return;
    AudioHooks.play("sessionEnd");
    Ceremony.run(s);
  },

  /* A run left open by a closed tab is still bound by its session clock, so on
     the next load its deadline has usually passed. Archive it instead of leaving
     it live: a stale session keeps feeding the arena stats strip, and the next
     START SESSION would overwrite it, losing the rounds the player did play.
     No ceremony and no navigation — the run is simply recorded where they can
     find it. Returns true if a session was closed out. */
  closeExpiredSession(){
    const s = STATE.session;
    if(!s || !s.endsAt || Date.now() < s.endsAt) return false;
    s.timeExpired = true;
    const archived = this.archiveSession();
    if(archived && archived.totalRounds > 0){
      toast("Your last session's " + Math.round(CONFIG.SESSION_SECONDS/60) +
        " minutes ran out — it's saved in History.");
    }
    return !!archived;
  },

  playAgain(){
    Nav.go("arena");
    $("#arenaPreStart").style.display = "block";
    $("#arenaGame").style.display = "none";
    UI.showArenaArt(true);
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

    /* This had no try/catch at all. Api.submitMeme rethrows a 429, so a second
       submission against a live backend rejected an async function nobody was
       awaiting — an unhandled rejection, and no feedback whatsoever to the
       player. And on the success path the server's balance was discarded, so a
       server-awarded +1,000 never showed up in the header (same class of bug as
       the one already fixed in claimDaily/doBoost). */
    let res;
    try{
      res = await Api.submitMeme(meme, async ()=>{
        const qualifies = Math.random() < 0.6;
        STATE.submittedMemes.push(Object.assign({}, meme, { qualifies }));
        let awarded = 0;
        if(!STATE.boosts.submit){
          STATE.boosts.submit = true;
          awarded = CONFIG.BOOST_ACTIONS.find(b=>b.id==="submit").reward;
          STATE.balance += awarded;
        }
        saveState();
        return { qualifies, awarded };
      });
    }catch(e){
      toast("You've already submitted a meme.");
      return;
    }

    if(res && typeof res.balance === "number") STATE.balance = res.balance;
    const qualifies = !!(res && res.qualifies);
    STATE.boosts.submit = true;
    saveState();
    UI.updateHeaderPoints();
    UI.renderHome();
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
  // Points already taken out of STATE.balance for this round. Set when the
  // prediction locks, returned by settleEscrow() when the round is decided,
  // abandoned or the session ends. Mirrored into STATE.pendingStake so a reload
  // can find it. Always the amount actually debited — never re-derived from
  // this.risk, so a round whose lock was never taken refunds nothing.
  escrow: 0,
  // The session this round was started for. resolve() checks it against the live
  // session so a round whose session has since ended cannot write into it.
  session: null,

  /* Returns the committed stake to the balance and clears the commitment.
     Idempotent: the second call refunds 0, so the settle points below can
     overlap without ever paying a stake back twice. */
  settleEscrow(){
    const held = Math.max(0, Math.floor(Number(this.escrow) || 0));
    this.escrow = 0;
    STATE.pendingStake = 0;
    if(held > 0){
      STATE.balance += held;
      UI.updateHeaderPoints();
    }
    return held;
  },

  async begin(){
    const s = STATE.session;
    if(!s) return; // session was ended before this round could start
    // The session clock outranks the round clock: with under
    // SESSION_MIN_ROUND_SECONDS left there is no round worth dealing, so the run
    // goes to its results instead of opening one that would be cut off.
    if(!SessionClock.roundFits()){ Game.endSession(); return; }
    this.session = s; // remember which session this round belongs to
    this.roundNum = s.rounds.length + 1;
    this.active = true;
    this.locked = false;
    this.prediction = null;
    this.risk = 0;
    this.escrow = 0;
    /* Normally the full ROUND_SECONDS, but the last round of a session is
       shortened to whatever the session has left — so "a session lasts 10
       minutes" is true to the second rather than 10 minutes plus a round. */
    this.timeLeft = SessionClock.roundSeconds();
    this.coin = MarketEngine.generateCoin();

    // Paint the new round immediately. This used to happen *after* awaiting the
    // outcome, so on any backend that isn't instant the arena kept showing the
    // previous round's coin, price and chart for the whole round-trip — with the
    // round number still on the old value. None of this markup depends on the
    // outcome, so there's no reason to hold it back.
    $("#roundTag").textContent = "ROUND " + String(this.roundNum).padStart(2,"0");
    UI.renderCoin(this.coin);
    UI.renderChart(this.coin);
    UI.renderRiskGrid();
    UI.resetPredictionUI();
    UI.updateStatsStrip();
    UI.updateTimerDisplay(this.timeLeft);

    // #9 — outcome is requested from (and, when a backend is present,
    // generated + held by) the server, so nothing in client state ever
    // reveals the result before the round timer expires. Falls back to
    // the local weighted model when no backend is reachable.
    this.outcome = await Api.getRoundOutcome(()=> MarketEngine.generateOutcome());
    if(!s.coinsEncountered.includes(this.coin.ticker)) s.coinsEncountered.push(this.coin.ticker);

    // The countdown only starts once the outcome is in hand, so no player ever
    // loses seconds off their 25 to network latency. Picking a direction and a
    // stake already worked during the wait — only resolution needs the outcome,
    // and resolution is driven exclusively by this timer.
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
    clearInterval(this.timerId);
    const s = STATE.session;

    /* The player can hit END SESSION or RESTART while a round is still counting
       down — both buttons sit in the arena header during live play. endSession()
       sets STATE.session to null, so 25 seconds later this ran `s.rounds.push()`
       on null and threw a TypeError that took the arena down with it. A round
       whose session is gone (or has been replaced by a restart) simply has
       nothing to record — but the stake was debited at lock time, so it has to be
       returned here rather than dropped with the round. (endSession() settles it
       first so the archived endingBalance is right; this call then refunds 0.) */
    if(!s || (this.session && this.session !== s)){
      this.settleEscrow();
      this.locked = false;
      this.prediction = null;
      this.risk = 0;
      return;
    }

    const hasPrediction = this.locked && this.prediction && this.risk > 0;
    /* Return the committed stake before scoring. The payout below is a *net*
       delta — +risk×multiplier on a win, −risk on a loss — which is what
       rules.js scoreRound() returns and what the server and CLI apply too. So
       stake-back plus net delta lands on exactly the same balance the old
       resolve-time-only maths produced, with the difference that the points were
       actually held for the life of the round. */
    this.settleEscrow();
    // A missing or malformed outcome must not silently score every round a loss,
    // which is what an unexpected server payload used to do: dir came back
    // undefined, never matched UP or DOWN, and the player lost their stake.
    const outcome = (this.outcome && typeof this.outcome.pctVal === "number")
      ? this.outcome
      : MarketEngine.generateOutcome();
    outcome.dir = MarketEngine.dirFromPct(outcome.pctVal);
    this.outcome = outcome;

    let result = "SKIPPED", payout = 0, profit = 0, loss = 0;
    if(hasPrediction){
      const correct = this.prediction === outcome.dir;
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
      actualOutcome: outcome.key,
      actualDir: outcome.dir,
      pctMove: outcome.pctVal,
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
    // The response IS read back now: the server derives the delta itself from
    // the stake and direction (it no longer trusts the client's signed payout),
    // so if the two ever disagree the server's number wins rather than the
    // client drifting away from the persisted account for the rest of the run.
    Api.submitRound(s.sessionId, roundRecord, ()=>({ ok:true, balance: STATE.balance }))
      .then(res=>{
        if(res && typeof res.balance === "number" && res.balance !== STATE.balance){
          STATE.balance = res.balance;
          saveState();
          UI.updateHeaderPoints();
          UI.updateStatsStrip();
        }
      })
      .catch(()=>{ /* offline / rejected — the local balance stands */ });

    if(hasPrediction){
      AudioHooks.play(result === "WIN" ? "roundWin" : "roundLoss");
      UI.showRoundResult(roundRecord, s);
    } else {
      toast("Time's up! No prediction made.");
      setTimeout(()=>Round.advance(), 900);
    }
  },

  /* The one way into the next round. Both routes here — the NEXT MEME button and
     the auto-advance after a skipped round — have to check the session clock
     first, or a 10-minute session quietly runs forever as long as somebody keeps
     tapping. */
  advance(){
    const root = document.getElementById("resultRoot");
    if(root) root.innerHTML = "";
    if(!STATE.session || !SessionClock.roundFits()){
      Game.endSession();
      return;
    }
    this.begin();
  }
};

/* =========================================================
   SESSION CLOCK
   -----------------------------------------------------
   A session is capped at CONFIG.SESSION_SECONDS (10 minutes) so a run reaches
   its results and awards while they're still worth sharing. This is a second,
   longer clock sitting above the per-round countdown: ROUND_SECONDS is how long
   you get to call one coin, SESSION_SECONDS is how long the whole run lasts.

   The deadline is stored on the session as an absolute timestamp rather than
   counted down in a variable, so a tab that was backgrounded (where setInterval
   is throttled to once a minute) comes back to the correct remaining time
   instead of a clock that lost two minutes.
   ========================================================= */
const SessionClock = {
  timerId: null,

  start(){
    this.stop();
    this.render();
    this.timerId = setInterval(()=>this.tick(), 1000);
  },

  stop(){
    clearInterval(this.timerId);
    this.timerId = null;
  },

  remainingMs(){
    const s = STATE.session;
    if(!s || !s.endsAt) return 0;
    return Math.max(0, s.endsAt - Date.now());
  },

  expired(){
    const s = STATE.session;
    if(!s) return false;
    if(!s.endsAt) return false; // a session archived before this clock existed
    return Date.now() >= s.endsAt;
  },

  /* Whether there's enough time left to be worth dealing another coin. Below the
     floor the run goes to its results rather than opening a round that the
     session clock would cut off after a couple of seconds. */
  roundFits(){
    const s = STATE.session;
    if(!s) return false;
    if(!s.endsAt) return true;
    return this.remainingMs() >= CONFIG.SESSION_MIN_ROUND_SECONDS * 1000;
  },

  /** Seconds a round starting right now can actually run for. */
  roundSeconds(){
    const s = STATE.session;
    if(!s || !s.endsAt) return CONFIG.ROUND_SECONDS;
    return Math.max(1, Math.min(CONFIG.ROUND_SECONDS, Math.floor(this.remainingMs()/1000)));
  },

  format(ms){
    const total = Math.max(0, Math.ceil(ms/1000));
    return Math.floor(total/60) + ":" + String(total%60).padStart(2,"0");
  },

  render(){
    const el = document.getElementById("sessionClock");
    if(!el) return;
    const ms = this.remainingMs();
    el.textContent = "SESSION " + this.format(ms);
    el.classList.toggle("urgent", ms > 0 && ms <= 60000);
  },

  tick(){
    this.render();
    if(this.expired()) this.timeUp();
  },

  /* Time's up. A round that's already locked is still resolved — the stake is
     committed and the outcome was rolled before the clock ran out, so cancelling
     it would be taking a prediction off the player. That resolve() shows its
     result card as usual, and because the clock has expired the card's button
     reads SEE FINAL RESULT and routes to the summary instead of dealing again.
     An unlocked round is scored SKIPPED, which auto-advances down the same path.
     Nothing in flight means the player is sitting on a result card already, so
     go straight there. */
  timeUp(){
    this.stop();
    const s = STATE.session;
    if(!s) return;
    if(s.timeExpired) return; // already handled
    s.timeExpired = true;
    this.render();
    toast("TIME! That's the " + this.format(CONFIG.SESSION_SECONDS*1000) + " — final result coming up.");
    if(Round.active){
      clearInterval(Round.timerId);
      Round.timeLeft = 0;
      UI.updateTimerDisplay(0);
      Round.resolve();
      return;
    }
    // Nothing in flight: the player is sitting on a result card, so clear it and
    // go straight to the summary.
    Round.advance();
  }
};

/* =========================================================
   MARKET ENGINE
   ========================================================= */
const MarketEngine = {
  // §8 — most rounds draw a curated coin (those have hand-drawn SVG art), the
  // rest mint an entirely new ticker so the pool never feels like a fixed list
  // of 20. `isGenerated` lets the UI badge freshly minted coins as NEW.
  generateCoin: CadeRules.generateCoin,
  genHistory: CadeRules.genHistory,
  // Single source of truth for direction. Any outcome whose rolled percentage is
  // >= 0 is an UP move, anything below is DOWN — so the direction the player is
  // scored against always matches the percentage the UI shows them.
  dirFromPct: CadeRules.dirFromPct,
  generateOutcome: CadeRules.generateOutcome,
  getMultiplier: CadeRules.getMultiplier,
  // Result + signed balance delta for a round, the same maths the CLI runs and
  // the backend re-derives rather than trusting a client-sent payout.
  scoreRound: CadeRules.scoreRound
};

/* =========================================================
   AWARDS
   ========================================================= */
const Awards = {
  calculate: CadeRules.calculateAwards
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
    /* `p.wins/(p.wins+p.losses||1)` parses as `p.wins/(p.wins + (p.losses||1))`
       because || binds looser than +. A 5W/0L player therefore showed 83% (5/6)
       instead of 100%, and every 0-loss player on the board was under-ranked on
       the WIN RATE tab. The guard belongs around the whole denominator. */
    const all = STATE.leaderboard.players.map(p=>({...p, winRate: (p.wins/((p.wins+p.losses)||1))*100})).concat([me]);
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
    awardsOf(s).forEach(a=>{ text += `${a.icon} ${a.title}\n`; });
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
    const cardAwards = awardsOf(s);
    if(cardAwards.length){
      cardAwards.forEach((a,i)=>{
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
    /* `root.innerHTML = ...` wiped whatever was already in #modalRoot, including
       a confirm modal with a pending onConfirm handler. Appending our own node
       and removing only that node leaves anything underneath intact. */
    const root = document.getElementById("modalRoot");
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="modal-overlay" id="shareImgOverlay">
      <div class="modal share-img-modal" role="dialog" aria-modal="true" aria-label="Your result image">
        <h3>YOUR RESULT IMAGE</h3>
        <img src="${dataUrl}" alt="Meme Madness result">
        <div class="actions">
          <button class="btn btn-block" id="closeShareImg">CLOSE</button>
          <a class="btn btn-primary btn-block" download="cade-meme-madness.png" href="${dataUrl}">DOWNLOAD PNG</a>
        </div>
      </div>
    </div>`;
    root.appendChild(wrap);

    const close = ()=>{
      document.removeEventListener("keydown", onKey);
      if(wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };
    const onKey = (e)=>{ if(e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);

    const overlay = wrap.querySelector("#shareImgOverlay");
    if(overlay) overlay.onclick = (e)=>{ if(e.target === overlay) close(); };
    const closeBtn = wrap.querySelector("#closeShareImg");
    closeBtn.onclick = close;
    if(closeBtn.focus) closeBtn.focus();
  }
};

/* =========================================================
   CEREMONY
   ========================================================= */
const Ceremony = {
  _auto: null,
  _session: null,

  run(s){
    const root = $("#ceremonyRoot");
    root.innerHTML = "";
    clearInterval(this._auto); // never stack two ceremonies' auto-advance timers
    this._auto = null;
    const overlay = document.createElement("div");
    overlay.className = "ceremony-overlay";
    overlay.innerHTML = `
      <button class="ceremony-skip" onclick="Ceremony.finish()">SKIP ✕</button>
      <div id="cerSteps"></div>
    `;
    root.appendChild(overlay);
    const stepsRoot = overlay.querySelector("#cerSteps");

    const steps = [];
    // §44 SCREEN 1 — headline is "MEME MADNESS COMPLETE!" with small CADE
    // branding; §23's "YOUR MADNESS IS COMPLETE" is kept as the sub-line so both
    // readings of the spec are satisfied.
    steps.push(`<div class="ceremony-step active">
        <div class="ceremony-brand">${AssetManager.slot("cerLogo", AssetManager.paths.logo, "🐸", "")}<span>CADE</span></div>
        <div class="hero-art">🐸💥</div>
        <div class="ceremony-big">MEME MADNESS<br>COMPLETE!</div>
        <div class="ceremony-sub">YOUR MADNESS IS COMPLETE</div>
      </div>`);
    steps.push(`<div class="ceremony-step">
        <div class="ceremony-big">SCORE COUNT</div>
        <div class="ceremony-count" id="cerCounter">${fmt(s.startingBalance)}</div>
      </div>`);
    steps.push(`<div class="ceremony-step">
        <div class="ceremony-big">NET RESULT</div>
        <div class="ceremony-count" style="color:${s.netResult>=0?'#3FCF6E':'#FF4F4F'}">${s.netResult>=0?"+":""}${fmt(s.netResult)}</div>
      </div>`);
    if(s.largestPayout>0){
      steps.push(`<div class="ceremony-step">
        <div class="ceremony-big">YOUR BEST HIT</div>
        <div class="ceremony-count">+${fmt(s.largestPayout)}</div>
      </div>`);
    }
    awardsOf(s).forEach(a=>{
      const code = a.code;
      steps.push(`<div class="ceremony-step" data-award="${code}">
        <div class="award-badge award-anim-${code.toLowerCase()}">${AssetManager.slot("award_"+code, AssetManager.paths.award(code), a.icon, "award-art-slot")}</div>
        <div class="award-title">${a.title}</div>
        <div class="award-desc">${a.desc}</div>
      </div>`);
    });
    // §44 SCREEN 9 — final celebration offers all four onward actions rather
    // than only routing to the results screen.
    steps.push(`<div class="ceremony-step">
        <div class="ceremony-big">THAT'S MADNESS! 🎉</div>
        <div class="hero-art">🎊🏆🎊</div>
        <div class="ceremony-actions">
          <button class="btn btn-yellow btn-block" onclick="Ceremony.finishThen('share')">SHARE MY RUN</button>
          <button class="btn btn-primary btn-block" onclick="Ceremony.finishThen('again')">PLAY AGAIN</button>
          <button class="btn btn-block" onclick="Ceremony.finishThen('history')">VIEW HISTORY</button>
          <button class="btn btn-block" onclick="Ceremony.finishThen('home')">BACK HOME</button>
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
    const self = this;
    this._auto = setInterval(()=>{
      if(idx >= stepEls.length-1){ clearInterval(self._auto); self._auto = null; return; }
      idx++; showStep(idx);
      if(idx >= stepEls.length-1){ clearInterval(self._auto); self._auto = null; }
    }, 2200);

    showStep(0);
    this._session = s;
  },

  finish(){
    /* Skipping used to leave this interval running: it kept calling showStep()
       on nodes that had just been removed from the document and, worse, kept
       firing Confetti.burst() — which appends to document.body — so confetti and
       award sounds went off every 2.2s over the summary screen until the timer
       happened to reach the last step. */
    clearInterval(this._auto);
    this._auto = null;
    $("#ceremonyRoot").innerHTML = "";
    if(!this._session) return;
    UI.renderSummary(this._session);
    Nav.go("summary");
  },

  // §44 SCREEN 9 — every onward action still lands on the results screen first
  // (so the share card exists and the session stays viewable), then performs the
  // chosen action on top of it.
  finishThen(action){
    this.finish();
    if(action === "share") Game.shareOnX();
    else if(action === "again") Game.playAgain();
    else if(action === "history") Nav.go("history");
    else if(action === "home") Nav.go("home");
  }
};

/* =========================================================
   CONFETTI
   ========================================================= */
const Confetti = {
  colors: ["#7B3FE4","#FFD23F","#FF7A29","#3FCF6E","#FF4F4F"],
  burst(count=24){
    /* Every other animation in the app honours prefers-reduced-motion; this one
       didn't, so the single most motion-heavy effect — 24-30 pieces tumbling down
       the viewport on every win and every award reveal — kept firing for exactly
       the users who asked for it to stop. */
    if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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

  // The arena art belongs to the pre-start view, so it hides when a session
  // starts and comes back on PLAY AGAIN — the two places #arenaPreStart itself
  // is toggled.
  showArenaArt(show){
    const el = document.getElementById("arenaArtSlot");
    if(el) el.style.display = show ? "flex" : "none";
  },

  renderHome(){
    this.updateHeaderPoints();
    this.renderClaimPanel();
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

  /* §5 — the "NEXT CLAIM IN" line ticks down live, once per second, and flips
     itself back to the claim button the moment the 24h window elapses. It used
     to be rendered once with hour+minute precision, so a player sitting on the
     home screen saw a frozen countdown and had to reload to claim again. */
  _claimTimer: null,

  renderClaimPanel(){
    const claimBtn = $("#claimBtn");
    const status = $("#claimStatus");
    if(!claimBtn || !status) return;

    const remain = STATE.lastClaim
      ? CONFIG.DAILY_CLAIM_WINDOW_MS - (Date.now() - STATE.lastClaim)
      : 0;

    if(remain <= 0){
      claimBtn.style.display = "block";
      claimBtn.disabled = false;
      claimBtn.textContent = "CLAIM " + fmt(CONFIG.DAILY_POINTS) + " POINTS";
      status.style.display = "none";
      this.stopClaimTicker();
      return;
    }

    claimBtn.style.display = "none";
    status.style.display = "block";
    const pad = n => String(n).padStart(2, "0");
    const h = Math.floor(remain / 3600000);
    const m = Math.floor((remain % 3600000) / 60000);
    const sec = Math.floor((remain % 60000) / 1000);
    status.innerHTML = fmt(CONFIG.DAILY_POINTS) + " POINTS CLAIMED ✓ — NEXT CLAIM IN " +
      `<span class="claim-countdown">${h}h ${pad(m)}m ${pad(sec)}s</span>`;

    // No point ticking while the player is on another screen; Nav.go("home")
    // calls renderHome() -> renderClaimPanel() again on the way back.
    const home = document.getElementById("screen-home");
    if(!home || !home.classList.contains("active")){ this.stopClaimTicker(); return; }
    this.startClaimTicker();
  },

  startClaimTicker(){
    if(this._claimTimer) return;
    this._claimTimer = setInterval(()=> this.renderClaimPanel(), 1000);
  },

  stopClaimTicker(){
    if(!this._claimTimer) return;
    clearInterval(this._claimTimer);
    this._claimTimer = null;
  },

  renderCoin(coin){
    const up = coin.move >= 0;
    $("#coinCard").innerHTML = `
      <div class="coin-meme">${MemeImage.render(coin)}</div>
      <div class="coin-id">
        <div class="coin-logo">${AssetManager.slot("coin_"+coin.ticker, AssetManager.paths.coin(coin.ticker), coin.emoji, "coin-art-slot")}</div>
        <div>
          <div class="coin-name">${coin.ticker}${coin.isGenerated?'<span class="new-coin-badge">NEW</span>':''}</div>
          <div class="coin-ticker">$${coin.ticker}</div>
          <div class="coin-price">$${coin.price}</div>
          <div class="coin-move ${up?'up':'down'}">${up?'+':''}${coin.move}%</div>
        </div>
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
    const riskEl0 = $("#potRisk");
    if(riskEl0) riskEl0.textContent = "0";
    $("#potProfit").textContent = "+0";
    $("#potLoss").textContent = "-0";
    document.querySelectorAll(".risk-grid, .updown, #customRisk").forEach(el=>el.style.pointerEvents="auto");
  },

  updatePayoutPreview(){
    const mult = MarketEngine.getMultiplier(Round.risk||0);
    const profit = Math.round((Round.risk||0)*mult);
    // §14 — the risk itself is shown alongside profit/loss so the three numbers
    // read as one relationship, and all three update on every stake change.
    const riskEl = $("#potRisk");
    if(riskEl) riskEl.textContent = fmt(Round.risk||0);
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
        <button class="btn btn-primary btn-block mt16" onclick="Round.advance()">${SessionClock.roundFits() ? 'NEXT MEME →' : 'SEE FINAL RESULT →'}</button>
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

  /* Kept as a thin alias: Round.advance() is the real entry point (it checks the
     session clock before dealing another coin), and older markup or a stale
     cached page may still call this. */
  nextRound(){
    Round.advance();
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
      // Window length comes from CONFIG (10 minutes) rather than a literal here.
      // It used to be a hard-coded hour, written out again in cli.js — two copies
      // of one tunable, which is how the vote closed at different times
      // depending on which front end you opened it in.
      STATE.votes = { endsAt: Date.now()+CONFIG.VOTE_WINDOW_MS, coins, voted:false };
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
    const coin = STATE.votes.coins[i];
    if(!coin){ return; } // stale onclick from a re-render
    const roundId = STATE.votes.endsAt; // stable id for this voting round window
    try{
      // #12 — server enforces one vote per round; local fallback mirrors it.
      const res = await Api.castVote(roundId, coin.ticker, async ()=>{
        if(STATE.votes.voted){ const err = new Error("Already voted"); err.status = 429; throw err; }
        let awarded = 0;
        if(!STATE.boosts.vote){
          STATE.boosts.vote = true;
          awarded = CONFIG.BOOST_ACTIONS.find(b=>b.id==="vote").reward;
          STATE.balance += awarded;
        }
        return { ok:true, awarded };
      });
      coin.votes++;
      STATE.votes.voted = true;
      /* The boost used to be applied here unconditionally, outside the fallback.
         Against a live backend that meant the +500 was credited twice — once by
         the server, once locally — and then overwritten by the next server
         response, so the points appeared and vanished. The award now happens on
         exactly one side, and the server's balance wins when it sent one. */
      if(res && typeof res.balance === "number") STATE.balance = res.balance;
      if(res && res.awarded > 0) toast(`+${fmt(res.awarded)} POINTS — VOTED!`);
      STATE.boosts.vote = true;
      saveState();
      UI.updateHeaderPoints();
      this.renderVote();
      UI.renderHome();
    }catch(e){
      toast("You already voted this round!");
    }
  },

  renderHistory(){
    const list = $("#historyList");
    if(!STATE.history.length){
      list.innerHTML = `<div class="empty-state">
        <span class="emo">📜</span>
        <b>NO RUNS YET</b>
        <p>Finish a Meme Madness session and it lands here with every round, award and net result.</p>
        <button class="btn btn-primary mt16" onclick="Nav.go('arena')">START A RUN</button>
      </div>`;
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
          <div><div class="muted">AWARDS</div><b>${awardsOf(s).map(a=>a.icon).join(" ")||"—"}</b></div>
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
    // "no record yet" is now null rather than -Infinity (which JSON cannot
    // represent). The old `> -Infinity` test passes for null too — null coerces
    // to 0 — so a brand-new player was shown a bogus "+0" best session.
    const hasNet = typeof r.bestSessionNet === "number";
    const netStr = hasNet ? (r.bestSessionNet>=0?'+':'') + fmt(r.bestSessionNet) : '—';
    $("#recordsGrid").innerHTML = `<div class="muted small mt8" style="grid-column:1/-1;">These are your all-time bests across every completed session.</div>`
      + items.map(i=>`<div class="record-box"><div class="v">${i.v}</div><div class="l">${i.l}</div></div>`).join("")
      + `<div class="record-box" style="grid-column:1/-1;"><div class="l">BEST SESSION NET</div><div class="v">${netStr}</div></div>`;
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
        ${awardsOf(s).length ? awardsOf(s).map(a=>`<span class="award-chip">${a.icon} ${a.title}</span>`).join("") : '<span class="muted">No awards this run — try again!</span>'}
      </div>`;
    this.renderCampaignSim(s);
    STATE._lastViewed = s;
  },

  /* "How you'd have done in the real Cade Meme Madness" — the simulated
     comparison against the real campaign's daily prize table.

     Everything here is illustrative and the markup says so twice: a SIMULATED
     badge on the heading and the full CadeRules.CAMPAIGN_DISCLAIMER underneath.
     A dollar figure on a results screen reads as a promise unless it is fenced
     that plainly, and this prototype has no connection to cade.market. */
  renderCampaignSim(s){
    const root = document.getElementById("campaignSimRoot");
    if(!root) return;
    if(!s){ root.innerHTML = ""; return; }

    /* Rolled at endSession() and archived with the session, so reopening a run
       from history shows the same rank. Sessions archived before this existed get
       one rolled on first view and stored, rather than a fresh one each time. */
    if(!s.campaign){
      s.campaign = CadeRules.simulateCampaignResult(s);
      saveState();
    }
    const c = s.campaign;
    const lines = CadeRules.campaignResultLines(c);
    const prizeStr = c.placed ? "$" + fmt(c.prizeUsd) : "NO PRIZE";

    root.innerHTML = `
      <div class="campaign-sim card">
        <div class="campaign-head">
          <h3>IF THIS WERE THE REAL CAMPAIGN</h3>
          <span class="sim-badge">SIMULATED</span>
        </div>
        <div class="campaign-rank">
          <div class="box">
            <div class="v">#${c.rank}</div>
            <div class="muted">SIMULATED RANK OF ${fmt(c.fieldSize)}</div>
          </div>
          <div class="box ${c.placed?'paid':''}">
            <div class="v">${prizeStr}</div>
            <div class="muted">${c.placed ? c.tierLabel + " PRIZE TIER" : "OUTSIDE THE TOP " + c.paidRanks}</div>
          </div>
        </div>
        <p class="campaign-headline">${lines.headline}</p>
        ${lines.quests.length ? `<div class="campaign-quests">
          <div class="campaign-quests-title">SIDE QUESTS YOU'D BE IN THE RUNNING FOR</div>
          ${c.quests.map((q,i)=>`<div class="campaign-quest">
            <span class="campaign-quest-icon">${q.icon}</span>
            <span class="campaign-quest-text">${lines.quests[i]}<span class="muted small block">${q.detail}</span></span>
          </div>`).join("")}
        </div>` : `<p class="muted small">No Side Quest in reach this run — more predictions or a bigger single hit would put one in play.</p>`}
        <p class="campaign-disclaimer">${c.disclaimer}</p>
      </div>`;
  },

  /* Modals were dismissable only by their own CANCEL button. Escape did nothing,
     tapping the backdrop did nothing, and a hideCancel:true modal (the two
     "SUBMITTED!" acknowledgements) had exactly one exit. Focus also stayed on
     whatever button opened the modal, so keyboard and screen-reader users were
     tabbing around behind the overlay. */
  _modalEsc: null,
  _modalReturnFocus: null,

  showModal({title, body, confirmLabel, cancelLabel, onConfirm, hideCancel}){
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-overlay" id="modalOverlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
        <h3>${title}</h3>
        <p class="mt12">${body}</p>
        <div class="actions">
          ${hideCancel?'':`<button class="btn btn-block" id="modalCancel">${cancelLabel||'CANCEL'}</button>`}
          <button class="btn btn-primary btn-block" id="modalConfirm">${confirmLabel||'CONFIRM'}</button>
        </div>
      </div>
    </div>`;
    const confirmBtn = $("#modalConfirm");
    confirmBtn.onclick = onConfirm;
    const cancelBtn = document.getElementById("modalCancel");
    if(cancelBtn) cancelBtn.onclick = ()=>UI.hideModal();

    // Backdrop click — only when the click landed on the overlay itself, not on
    // the card inside it (which is a descendant and would otherwise bubble).
    const overlay = document.getElementById("modalOverlay");
    if(overlay) overlay.onclick = (e)=>{ if(e.target === overlay) UI.hideModal(); };

    this._modalReturnFocus = document.activeElement;
    this._modalEsc = (e)=>{ if(e.key === "Escape") UI.hideModal(); };
    document.addEventListener("keydown", this._modalEsc);
    if(confirmBtn.focus) confirmBtn.focus();
  },

  hideModal(){
    if(this._modalEsc){
      document.removeEventListener("keydown", this._modalEsc);
      this._modalEsc = null;
    }
    $("#modalRoot").innerHTML = "";
    const back = this._modalReturnFocus;
    this._modalReturnFocus = null;
    if(back && back.focus && document.contains(back)) back.focus();
  }
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
  // Arena pre-start art (above the READY FOR MADNESS? card). Same asset and the
  // same emoji fallback as the home hero — drop a file at AssetManager.paths.hero
  // and both slots pick it up.
  const arenaArtSlot = document.getElementById("arenaArtSlot");
  if(arenaArtSlot) arenaArtSlot.innerHTML = AssetManager.slot("arenaHero", AssetManager.paths.hero, "🐸💥🚀", "");

  /* State the session length from CONFIG rather than in the markup, so the copy
     and the clock that enforces it cannot disagree. */
  const arenaSessionNote = document.getElementById("arenaSessionNote");
  if(arenaSessionNote){
    const mins = Math.round(CONFIG.SESSION_SECONDS/60);
    arenaSessionNote.textContent = "⏱ " + mins + "-MINUTE SESSION · " + CONFIG.ROUND_SECONDS +
      "s PER ROUND · RESULTS & AWARDS AT THE BUZZER";
  }

  /* A run whose 10 minutes elapsed while the tab was closed is archived now
     rather than resumed. Must run after Game/SessionClock are defined, which is
     why it's here and not in loadState(). */
  Game.closeExpiredSession();

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
