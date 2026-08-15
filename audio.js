/* =====================================================
   CADE MEME MADNESS — Audio / Haptic Hooks
   -----------------------------------------------------
   Silent-by-default sound + vibration layer. Drop real
   audio files into /assets/sfx/ using the filenames below
   and they'll play automatically — no code changes needed.
   Respects a mute toggle (persisted) and browser autoplay
   policy: audio only unlocks after the first user gesture.
   ===================================================== */

const AudioHooks = (function(){

  // Stable event -> filename map. Add files at these paths.
  const SOUND_MAP = {
    countdownTick:  "assets/sfx/countdown-tick.mp3",
    roundWin:       "assets/sfx/round-win.mp3",
    roundLoss:      "assets/sfx/round-loss.mp3",
    awardReveal:    "assets/sfx/award-reveal.mp3",
    buttonTap:      "assets/sfx/button-tap.mp3",
    predictionLock: "assets/sfx/prediction-lock.mp3",
    sessionEnd:     "assets/sfx/session-end.mp3"
  };

  // Haptic patterns (ms), used with navigator.vibrate when available.
  const HAPTIC_MAP = {
    countdownTick:  [10],
    roundWin:       [20, 40, 20],
    roundLoss:      [60],
    awardReveal:    [15, 30, 15, 30, 15],
    buttonTap:      [8],
    predictionLock: [25, 25, 25],
    sessionEnd:     [30, 20, 30, 20, 60]
  };

  const MUTE_KEY = "cade_mm_muted";
  const cache = {}; // event -> HTMLAudioElement | "missing"
  let unlocked = false;
  let muted = true; // muted-by-default-on-load, per browser autoplay policy

  /* localStorage throws — not returns null — when storage is disabled: Safari
     private browsing, "block all cookies", sandboxed iframes without
     allow-same-origin. An unguarded getItem here threw during module evaluation,
     which aborted this script entirely, leaving `AudioHooks` undefined and every
     `AudioHooks.play(...)` call in app.js a hard ReferenceError. The mute
     preference simply not persisting is the correct degradation. */
  function readStore(key){
    try{ return localStorage.getItem(key); }catch(e){ return null; }
  }
  function writeStore(key, value){
    try{ localStorage.setItem(key, value); return true; }catch(e){ return false; }
  }

  function loadMutePref(){
    const stored = readStore(MUTE_KEY);
    // First-ever load: default muted. After that, respect the user's choice.
    muted = stored === null ? true : stored === "1";
  }

  function saveMutePref(){
    writeStore(MUTE_KEY, muted ? "1" : "0");
  }

  function getAudioEl(event){
    if(cache[event] === "missing") return null;
    if(cache[event]) return cache[event];
    const src = SOUND_MAP[event];
    if(!src) return null;
    const el = new Audio();
    el.src = src;
    el.preload = "none";
    // If the file 404s, mark this event as missing so we stop trying.
    el.addEventListener("error", ()=>{ cache[event] = "missing"; }, { once: true });
    cache[event] = el;
    return el;
  }

  function vibrate(event){
    if(muted) return; // treat haptics as part of the same mute toggle
    if(!("vibrate" in navigator)) return;
    const pattern = HAPTIC_MAP[event];
    if(pattern) { try{ navigator.vibrate(pattern); }catch(e){} }
  }

  /* The persisted preference is read here, at module evaluation, not in init().
     init() is bound to DOMContentLoaded, but app.js's init IIFE runs
     synchronously at the end of <body> — before that event — and calls
     syncMuteBtn() -> isMuted(). So a user who had unmuted saw the header icon
     render as 🔇 (from the hardcoded default) while `muted` flipped to false a
     moment later: the icon contradicted the actual state until the next toggle. */
  loadMutePref();

  return {
    init(){
      loadMutePref();
      // Any first tap/click anywhere unlocks audio playback per
      // browser autoplay policy, even while muted, so that toggling
      // "unmute" later doesn't get blocked.
      const unlock = ()=>{
        if(unlocked) return;
        unlocked = true;
        Object.keys(SOUND_MAP).forEach(evt=>{
          const el = getAudioEl(evt);
          if(el){
            el.muted = true;
            el.play().then(()=>{ el.pause(); el.currentTime = 0; el.muted = false; }).catch(()=>{});
          }
        });
        document.removeEventListener("pointerdown", unlock);
      };
      document.addEventListener("pointerdown", unlock, { once: true });
    },

    /** Play a named sound + trigger matching haptic. Silent no-op if muted or file missing. */
    play(event){
      vibrate(event);
      if(muted) return;
      const el = getAudioEl(event);
      if(!el) return;
      try{
        el.currentTime = 0;
        el.play().catch(()=>{ /* ignored — autoplay restrictions or missing file */ });
      }catch(e){ /* ignored */ }
    },

    isMuted(){ return muted; },

    setMuted(val){
      muted = !!val;
      saveMutePref();
      document.dispatchEvent(new CustomEvent("audiomutechange", { detail: { muted } }));
    },

    toggleMute(){
      this.setMuted(!muted);
      return muted;
    }
  };
})();

document.addEventListener("DOMContentLoaded", ()=> AudioHooks.init());
