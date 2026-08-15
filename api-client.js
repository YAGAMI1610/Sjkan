/* =====================================================
   CADE MEME MADNESS — API Client
   -----------------------------------------------------
   Talks to the reference backend in /server for:
     - server-authoritative round outcomes (#9)
     - accounts / multi-device persistence (#10)
     - polled leaderboard (#11)
     - rate-limited actions (#12)

   If the backend is unreachable (e.g. running the app as
   static files with no server), every call transparently
   falls back to the existing local/localStorage simulation
   so the game still works standalone. This makes the swap
   from prototype -> production a config flip, not a rewrite.
   ===================================================== */

const Api = (function(){

  const BASE = (window.CADE_API_BASE || "/api");
  let serverAvailable = null; // null = unknown, true/false once probed
  let probeInFlight = null;   // memoised probe promise, see probe()

  /* Same guard as audio.js and app.js: localStorage throws outright when storage
     is blocked, and this ran at module evaluation. The throw aborted the script,
     so `Api` was never defined and every Api.* call in app.js was a
     ReferenceError — the app died on load in Safari private browsing rather than
     falling back to the local simulation it was designed to fall back to.
     A non-persisted device id still works for the lifetime of the page. */
  function readStore(key){
    try{ return localStorage.getItem(key); }catch(e){ return null; }
  }
  function writeStore(key, value){
    try{ localStorage.setItem(key, value); }catch(e){ /* storage unavailable */ }
  }

  let deviceId = readStore("cade_mm_device_id");
  if(!deviceId){
    deviceId = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    writeStore("cade_mm_device_id", deviceId);
  }

  async function request(path, opts){
    const res = await fetch(BASE + path, Object.assign({
      headers: { "Content-Type": "application/json", "X-Device-Id": deviceId },
    }, opts));
    if(!res.ok){
      const body = await res.json().catch(()=>({}));
      const err = new Error(body.error || ("Request failed: " + res.status));
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /* `serverAvailable` is only assigned after the await, so every call that
     started before the first probe resolved saw null and fired its own
     /health request. On a static deploy (no /api at all) app boot triggers
     several calls at once — leaderboard, records, history — so the console
     filled with parallel failed requests and each one waited out its own
     network timeout before falling back. Memoising the in-flight promise means
     exactly one /health request per page load, and the concurrent callers all
     await the same answer. */
  function probe(){
    if(serverAvailable !== null) return Promise.resolve(serverAvailable);
    if(probeInFlight) return probeInFlight;
    probeInFlight = request("/health", { method: "GET" })
      .then(()=>{ serverAvailable = true; })
      .catch(()=>{ serverAvailable = false; })
      .then(()=>{ probeInFlight = null; return serverAvailable; });
    return probeInFlight;
  }

  // Wraps a server call with a local fallback fn. If the server call
  // throws for any reason (offline, 4xx from rate limiting, etc. where
  // rate-limit errors are re-thrown deliberately), falls back locally.
  async function withFallback(serverFn, localFn, opts){
    opts = opts || {};
    const up = await probe();
    if(!up) return localFn();
    try{
      return await serverFn();
    }catch(e){
      if(opts.rethrowOnRateLimit && e.status === 429) throw e;
      console.warn("[Api] server call failed, using local fallback:", e.message);
      return localFn();
    }
  }

  return {
    deviceId,

    /** #9 — server-authoritative round outcome generation.
     *  Normalises the two code paths onto ONE contract: a bare outcome object
     *  `{key, pctVal, dir, ...}`. The server wraps its payload as `{outcome:{...}}`
     *  while the local fallback returns the outcome directly, so without this
     *  unwrap `outcome.dir`/`outcome.pctVal` came back undefined whenever a
     *  backend was reachable — scoring every round a loss and rendering
     *  "TICKER went undefined (undefined%)".
     *  `dir` is also re-derived from the sign of pctVal rather than trusted, so a
     *  server that sends a mismatched or unsupported direction (e.g. "FLAT",
     *  which the client can never match against UP/DOWN) cannot silently turn
     *  every affected round into a loss. */
    async getRoundOutcome(localGenerateFn){
      const res = await withFallback(
        ()=> request("/round/outcome", { method: "POST" }),
        localGenerateFn
      );
      const outcome = (res && res.outcome) ? res.outcome : res;
      if(outcome && typeof outcome.pctVal === "number"){
        outcome.dir = outcome.pctVal >= 0 ? "UP" : "DOWN";
      }
      return outcome;
    },

    /** #12 — server enforces the 24h window; throws {status:429} if too early */
    async claimDaily(localClaimFn){
      return withFallback(
        ()=> request("/daily-claim", { method: "POST" }),
        localClaimFn,
        { rethrowOnRateLimit: true }
      );
    },

    /** #12 — server enforces one-time-per-account boosts */
    async doBoost(id, localBoostFn){
      return withFallback(
        ()=> request("/boost", { method: "POST", body: JSON.stringify({ id }) }),
        localBoostFn,
        { rethrowOnRateLimit: true }
      );
    },

    /** #10 — persist session lifecycle server-side */
    async startSession(session, localFn){
      return withFallback(
        ()=> request("/session/start", { method: "POST", body: JSON.stringify({ session }) }),
        localFn
      );
    },
    async submitRound(sessionId, round, localFn){
      return withFallback(
        ()=> request("/round/submit", { method: "POST", body: JSON.stringify({ sessionId, round }) }),
        localFn
      );
    },
    async endSession(sessionId, session, localFn){
      return withFallback(
        ()=> request("/session/end", { method: "POST", body: JSON.stringify({ sessionId, session }) }),
        localFn
      );
    },

    /** #11 — centrally generated / polled leaderboard */
    async getLeaderboard(localFn){
      return withFallback(
        ()=> request("/leaderboard", { method: "GET" }),
        localFn
      );
    },

    async getHistory(localFn){
      return withFallback(()=> request("/history", { method: "GET" }), localFn);
    },

    async getRecords(localFn){
      return withFallback(()=> request("/records", { method: "GET" }), localFn);
    },

    /** #12 — server enforces one-time submit boost + stores submission */
    async submitMeme(meme, localFn){
      return withFallback(
        ()=> request("/meme/submit", { method: "POST", body: JSON.stringify({ meme }) }),
        localFn,
        { rethrowOnRateLimit: true }
      );
    },

    /** #12 — server enforces one vote per round */
    async castVote(roundId, coinTicker, localFn){
      return withFallback(
        ()=> request("/vote", { method: "POST", body: JSON.stringify({ roundId, coinTicker }) }),
        localFn,
        { rethrowOnRateLimit: true }
      );
    },

    isServerAvailable: ()=> serverAvailable
  };
})();
