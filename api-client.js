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
  let deviceId = localStorage.getItem("cade_mm_device_id");
  if(!deviceId){
    deviceId = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("cade_mm_device_id", deviceId);
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

  async function probe(){
    if(serverAvailable !== null) return serverAvailable;
    try{
      await request("/health", { method: "GET" });
      serverAvailable = true;
    }catch(e){
      serverAvailable = false;
    }
    return serverAvailable;
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

    /** #9 — server-authoritative round outcome generation */
    async getRoundOutcome(localGenerateFn){
      return withFallback(
        ()=> request("/round/outcome", { method: "POST" }),
        localGenerateFn
      );
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
