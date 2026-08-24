/*
 * Last Straw
 * ----------------------------------------------------------------------------
 * Ten thousand straws in a golden-hour haystack. One needle buried inside it.
 * Orbit the stack, tap a straw to pull it, or press and hold to burrow a shaft.
 * The hay runs warm when a pulled straw lands near the needle. Six pieces of
 * worthless junk glint exactly like the real thing. The dig saves itself.
 *
 * Runtime : plethora-bit@2  (window.plethoraBit)
 * Renderer: three@0.164.1 (ES module via ctx.importModule)
 * Assets  : none packaged (maxAssets is 0) — every texture, mesh and sound in
 *           here is generated procedurally at runtime.
 */

window.plethoraBit = {
  meta: {
    title: "Last Straw",
    runtime: "plethora-bit@2",
    tags: ["3d", "puzzle", "search", "haystack", "relaxing", "long-play"],
    permissions: ["haptics", "backgroundMusic", "audio", "storage"]
  },

  async init(ctx) {
    // =======================================================================
    // 0. TUNING
    // =======================================================================
    const STRAW_COUNT = 26000;   // the whole premise
    const STACK_R     = 6.8;     // haystack radius at the ground
    const STACK_H     = 8.2;     // haystack height
    const DECOY_COUNT = 6;       // shiny things that are not the needle

    // Burrow cadence. First pull is quick, then the rate ramps up the longer a
    // press is held and resets on release. Tuned so a full 10k clear is roughly
    // half an hour of solid digging and a typical hunt runs 30-60 minutes.
    const HOLD_FIRST_MS = 210;
    const HOLD_SLOW_MS  = 330;
    const HOLD_FAST_MS  = 205;
    const HOLD_RAMP_MS  = 3200;

    // Warmth thresholds, in world units from the needle. Deliberately tight:
    // a 1.6 sphere is ~3% of the pile, so the meter narrows the hunt without
    // handing it over. Widening these collapses the search dramatically.
    const W_BURNING = 0.40;
    const W_HOT     = 0.75;
    const W_WARM    = 1.15;
    const W_RANGE   = 1.55;      // meter reads zero beyond this

    const SAVE_KEY  = "laststraw.dig.v1";
    const SAVE_VER  = 1;

    // =======================================================================
    // 1. IMMEDIATE FIRST FRAME
    //    The host must never see a blank surface, so the DOM shell paints a
    //    themed loading card before three.js is even requested.
    // =======================================================================
    const canvas = ctx.createCanvas({ touchAction: "none" });
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.pointerEvents = "none";

    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
    const padT = (sa.top || 0) + 12;
    const padB = (sa.bottom || 0) + 14;
    const padL = (sa.left || 0) + 14;
    const padR = (sa.right || 0) + 14;

    const style = document.createElement("style");
    style.textContent = `
      .ls * { box-sizing: border-box; }
      .ls {
        position: absolute; inset: 0; overflow: hidden;
        font-family: ui-rounded, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #fff4dd; -webkit-user-select: none; user-select: none;
        -webkit-tap-highlight-color: transparent;
      }

      /* ---- ambience ---- */
      .ls-vig {
        position: absolute; inset: 0; pointer-events: none; z-index: 1;
        background: radial-gradient(128% 100% at 50% 34%,
          rgba(255,225,170,0) 40%, rgba(92,48,10,.20) 74%, rgba(28,14,4,.56) 100%);
      }

      /* ---- top-left counter ---- */
      .ls-hud {
        position: absolute; top: ${padT}px; left: ${padL}px; z-index: 4;
        pointer-events: none; text-shadow: 0 2px 10px rgba(48,22,0,.6);
      }
      .ls-count {
        font-size: 38px; font-weight: 800; line-height: 1; letter-spacing: -1.2px;
        font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 7px;
      }
      .ls-count .unit { font-size: 13px; font-weight: 700; opacity: .72; letter-spacing: .8px; text-transform: uppercase; }
      .ls-sub {
        margin-top: 5px; font-size: 12px; font-weight: 700; opacity: .78;
        letter-spacing: .5px; font-variant-numeric: tabular-nums;
        display: flex; align-items: center; gap: 9px;
      }
      .ls-sub .dot { opacity: .4; }
      .ls-junk { color: #ffd489; }

      /* ---- warmth meter ---- */
      .ls-warm {
        position: absolute; top: ${padT + 2}px; left: 50%; transform: translateX(-50%);
        width: min(210px, 44vw); z-index: 4; pointer-events: none;
        opacity: 0; transition: opacity .4s ease;
      }
      .ls-warm.on { opacity: 1; }
      .ls-warm-label {
        font-size: 10px; font-weight: 800; letter-spacing: 2.2px; text-align: center;
        opacity: .8; margin-bottom: 5px; text-transform: uppercase;
        text-shadow: 0 2px 8px rgba(48,22,0,.6);
      }
      .ls-warm-track {
        position: relative; height: 7px; border-radius: 99px; overflow: hidden;
        background: rgba(20,12,4,.5); border: 1px solid rgba(255,232,190,.22);
        box-shadow: inset 0 1px 3px rgba(0,0,0,.4);
      }
      .ls-warm-fill {
        position: absolute; inset: 0; transform-origin: left center; transform: scaleX(0);
        background: linear-gradient(90deg, #4aa3ff 0%, #8fd7ff 16%, #ffd166 52%, #ff8a3d 78%, #ff3d2e 100%);
        transition: transform .18s ease-out;
      }
      .ls-warm-best {
        position: absolute; top: -3px; width: 2px; height: 13px; border-radius: 2px;
        background: #fff6e2; box-shadow: 0 0 7px rgba(255,220,150,.9); left: 0;
        transition: left .3s ease; opacity: .9;
      }

      /* ---- buttons ---- */
      .ls-tr {
        position: absolute; top: ${padT}px; right: ${padR}px; z-index: 6;
        display: flex; gap: 9px;
      }
      .ls-btn {
        pointer-events: auto; width: 42px; height: 42px; border-radius: 50%;
        border: 1px solid rgba(255,236,200,.26); background: rgba(44,26,10,.44);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        color: #ffeccb; font-size: 17px; font-weight: 700;
        display: flex; align-items: center; justify-content: center; cursor: pointer;
        transition: transform .12s ease, background .2s ease; padding: 0;
      }
      .ls-btn:active { transform: scale(.88); background: rgba(72,44,14,.6); }
      .ls-btn.off { opacity: .45; }

      /* ---- bottom hint (kept light, above the unsafe area) ---- */
      .ls-hint {
        position: absolute; left: 50%; bottom: ${padB + 4}px; transform: translateX(-50%);
        z-index: 4; pointer-events: none; font-size: 12px; font-weight: 700;
        letter-spacing: .3px; padding: 8px 15px; border-radius: 99px;
        background: rgba(30,18,6,.44); border: 1px solid rgba(255,236,200,.16);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        opacity: 0; transition: opacity .5s ease; white-space: nowrap; max-width: 88vw;
      }
      .ls-hint.on { opacity: .92; }

      /* ---- toast ---- */
      .ls-toast {
        position: absolute; left: 50%; top: 30%; transform: translate(-50%,-50%) scale(.94);
        z-index: 7; pointer-events: none; max-width: 78vw; text-align: center;
        padding: 11px 18px; border-radius: 16px; font-size: 14px; font-weight: 700;
        line-height: 1.35; background: rgba(30,18,6,.8);
        border: 1px solid rgba(255,222,160,.28);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 14px 40px rgba(20,8,0,.5);
        opacity: 0; transition: opacity .28s ease, transform .28s ease;
      }
      .ls-toast.on { opacity: 1; transform: translate(-50%,-50%) scale(1); }
      .ls-toast .lead { display: block; font-size: 22px; margin-bottom: 5px; }

      /* ---- full-screen panels ---- */
      .ls-panel {
        position: absolute; inset: 0; z-index: 9; pointer-events: auto;
        display: flex; align-items: center; justify-content: center; padding: 26px;
        background: radial-gradient(120% 90% at 50% 24%, rgba(58,32,8,.72), rgba(14,7,2,.92));
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        opacity: 1; transition: opacity .5s ease;
      }
      .ls-panel.hide { opacity: 0; pointer-events: none; }
      .ls-card {
        width: 100%; max-width: 380px; max-height: 100%; overflow-y: auto;
        -webkit-overflow-scrolling: touch; text-align: center;
        padding: ${Math.max(padT, 18)}px 4px ${Math.max(padB, 18)}px;
      }
      .ls-title {
        font-size: 40px; font-weight: 900; letter-spacing: -1.6px; line-height: .96;
        background: linear-gradient(178deg, #fff6de 0%, #ffd98c 46%, #ffab34 100%);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        filter: drop-shadow(0 3px 14px rgba(255,160,40,.32));
      }
      .ls-tag {
        margin-top: 9px; font-size: 13.5px; font-weight: 700; opacity: .84; line-height: 1.5;
      }
      .ls-rule {
        width: 46px; height: 3px; border-radius: 3px; margin: 18px auto;
        background: linear-gradient(90deg, rgba(255,190,90,0), rgba(255,190,90,.85), rgba(255,190,90,0));
      }
      .ls-list { text-align: left; margin: 0 auto; max-width: 320px; }
      .ls-li {
        display: flex; gap: 11px; align-items: flex-start; font-size: 13px;
        line-height: 1.5; font-weight: 600; opacity: .9; margin-bottom: 11px;
      }
      .ls-li .ic { flex: 0 0 20px; text-align: center; font-size: 15px; opacity: .95; }
      .ls-cta {
        pointer-events: auto; margin-top: 22px; width: 100%; padding: 15px 20px;
        border-radius: 99px; border: none; cursor: pointer;
        font-size: 15.5px; font-weight: 800; letter-spacing: .3px; color: #33200a;
        background: linear-gradient(180deg, #ffe1a0, #ffb03e);
        box-shadow: 0 10px 26px rgba(255,150,40,.3), inset 0 1px 0 rgba(255,255,255,.55);
        transition: transform .12s ease, opacity .2s ease;
      }
      .ls-cta:active { transform: scale(.97); }
      .ls-cta.wait { opacity: .55; }
      .ls-link {
        pointer-events: auto; display: inline-block; margin-top: 14px; cursor: pointer;
        font-size: 12.5px; font-weight: 700; opacity: .62; text-decoration: underline;
        text-underline-offset: 3px; background: none; border: none; color: inherit;
        font-family: inherit; padding: 6px 10px;
      }
      .ls-link:active { opacity: 1; }

      /* ---- resume chip ---- */
      .ls-resume {
        margin-top: 16px; display: inline-flex; align-items: center; gap: 9px;
        padding: 9px 15px; border-radius: 99px; font-size: 12.5px; font-weight: 700;
        background: rgba(255,214,140,.12); border: 1px solid rgba(255,214,140,.3);
        font-variant-numeric: tabular-nums;
      }

      /* ---- win stats ---- */
      .ls-stats {
        display: flex; justify-content: center; gap: 10px; margin: 20px 0 4px; flex-wrap: wrap;
      }
      .ls-stat {
        flex: 1 1 84px; min-width: 84px; padding: 11px 8px; border-radius: 14px;
        background: rgba(255,224,160,.09); border: 1px solid rgba(255,224,160,.2);
      }
      .ls-stat .v { font-size: 20px; font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: -.5px; }
      .ls-stat .k { font-size: 9.5px; font-weight: 800; letter-spacing: 1.1px; opacity: .62; margin-top: 3px; text-transform: uppercase; }
      .ls-verdict {
        margin-top: 18px; font-size: 14px; font-weight: 700; line-height: 1.55;
        color: #ffe6b8;
      }
      .ls-kicker { margin-top: 12px; font-size: 12.5px; font-weight: 600; opacity: .6; line-height: 1.5; }

      /* ---- leaderboard ---- */
      .ls-lb-rows { text-align: left; margin-top: 6px; }
      .ls-row {
        display: flex; align-items: center; gap: 10px; padding: 9px 12px;
        border-radius: 11px; font-size: 13px; font-weight: 700; margin-bottom: 5px;
        background: rgba(255,232,190,.07);
      }
      .ls-row.me { background: rgba(255,196,88,.19); border: 1px solid rgba(255,196,88,.34); }
      .ls-row .rk { width: 22px; opacity: .6; font-variant-numeric: tabular-nums; }
      .ls-row .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
      .ls-row .vl { font-variant-numeric: tabular-nums; opacity: .95; }
      .ls-empty { font-size: 12.5px; opacity: .6; padding: 18px 0; font-weight: 600; }

      /* ---- loading straws ---- */
      .ls-load { display: flex; gap: 5px; justify-content: center; margin-top: 22px; height: 26px; align-items: flex-end; }
      .ls-load i {
        display: block; width: 3px; height: 22px; border-radius: 2px;
        background: linear-gradient(180deg, #ffdf9e, #c98b28);
        transform-origin: bottom center; animation: lsSway 1.5s ease-in-out infinite;
      }
      @keyframes lsSway {
        0%,100% { transform: rotate(-13deg) scaleY(.72); opacity: .5; }
        50%     { transform: rotate(13deg)  scaleY(1);   opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) { .ls-load i { animation: none; } }
    `;

    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "ls";
    ui.innerHTML = `
      <div class="ls-vig"></div>

      <div class="ls-hud">
        <div class="ls-count"><span class="val">26,000</span><span class="unit">straws left</span></div>
        <div class="ls-sub">
          <span class="clock">00:00</span>
          <span class="dot">•</span>
          <span class="ls-junk"><span class="jv">0</span>/${DECOY_COUNT} junk</span>
        </div>
      </div>

      <div class="ls-warm">
        <div class="ls-warm-label">cold</div>
        <div class="ls-warm-track">
          <div class="ls-warm-fill"></div>
          <div class="ls-warm-best"></div>
        </div>
      </div>

      <div class="ls-tr">
        <button class="ls-btn b-sound" aria-label="Sound">♪</button>
        <button class="ls-btn b-help" aria-label="How to play">?</button>
        <button class="ls-btn b-lb" aria-label="Leaderboard">🏆</button>
      </div>

      <div class="ls-hint"></div>
      <div class="ls-toast"></div>

      <div class="ls-panel p-intro">
        <div class="ls-card">
          <div class="ls-title">LAST<br>STRAW</div>
          <div class="ls-tag">Twenty-six thousand straws.<br>One needle. Somewhere in there.</div>
          <div class="ls-resume" style="display:none"></div>
          <div class="ls-rule"></div>
          <div class="ls-list">
            <div class="ls-li"><span class="ic">🖐️</span><span><b>Drag</b> to orbit the stack. <b>Pinch</b> to zoom. <b>Two fingers</b> up or down to change your height.</span></div>
            <div class="ls-li"><span class="ic">👆</span><span><b>Tap</b> a straw to pull it out. <b>Press and hold</b> to burrow — it speeds up the longer you hold.</span></div>
            <div class="ls-li"><span class="ic">🌡️</span><span>Hay holds heat. Pull a straw near the needle and the meter reacts. Far away it tells you nothing.</span></div>
            <div class="ls-li"><span class="ic">✨</span><span>Not everything that glints is a needle. There are ${DECOY_COUNT} pieces of junk in here purely to waste your time.</span></div>
            <div class="ls-li"><span class="ic">💾</span><span>Your dig saves itself. Leave whenever. The haystack will wait.</span></div>
          </div>
          <button class="ls-cta wait">Preparing the field…</button>
          <div class="ls-load"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <button class="ls-link l-fresh" style="display:none">Start a fresh haystack</button>
        </div>
      </div>

      <div class="ls-panel p-help hide">
        <div class="ls-card">
          <div class="ls-title" style="font-size:28px">HOW TO<br>SUFFER</div>
          <div class="ls-rule"></div>
          <div class="ls-list">
            <div class="ls-li"><span class="ic">🖐️</span><span>One finger drags to orbit. Two fingers pinch to zoom, or slide up and down to raise and lower your view.</span></div>
            <div class="ls-li"><span class="ic">👆</span><span>Tap the straw you want gone. Hold to keep pulling along the same line and dig a shaft.</span></div>
            <div class="ls-li"><span class="ic">🌡️</span><span>The meter only reads the straw you just pulled. The white tick marks the closest you have ever been.</span></div>
            <div class="ls-li"><span class="ic">🪡</span><span>The needle is buried deep — never near the surface. When hay stops blocking it, it catches the sun.</span></div>
            <div class="ls-li"><span class="ic">🔩</span><span>So does a bottle cap. And a bent nail. Sorry.</span></div>
            <div class="ls-li"><span class="ic">💾</span><span>Progress saves automatically every few seconds and whenever you leave.</span></div>
          </div>
          <button class="ls-cta c-back">Back to the hay</button>
          <button class="ls-link l-restart">Abandon this dig, start a fresh haystack</button>
        </div>
      </div>

      <div class="ls-panel p-lb hide">
        <div class="ls-card">
          <div class="ls-title" style="font-size:28px">FEWEST<br>STRAWS</div>
          <div class="ls-tag" style="font-size:12px">Lowest straw count wins. Luck counts.</div>
          <div class="ls-rule"></div>
          <div class="ls-lb-rows"></div>
          <button class="ls-cta c-back2">Back to the hay</button>
        </div>
      </div>

      <div class="ls-panel p-win hide">
        <div class="ls-card">
          <div class="ls-title" style="font-size:34px">YOU FOUND<br>THE NEEDLE</div>
          <div class="ls-stats">
            <div class="ls-stat"><div class="v s-straws">0</div><div class="k">straws</div></div>
            <div class="ls-stat"><div class="v s-time">0:00</div><div class="k">time</div></div>
            <div class="ls-stat"><div class="v s-junk">0</div><div class="k">junk</div></div>
          </div>
          <div class="ls-verdict"></div>
          <div class="ls-kicker"></div>
          <button class="ls-cta c-again">Bury a new needle</button>
          <button class="ls-link l-look">Let me just look at it</button>
        </div>
      </div>
    `;
    root.appendChild(ui);

    const $ = (s) => ui.querySelector(s);
    const el = {
      count:    $(".ls-count .val"),
      clock:    $(".ls-sub .clock"),
      junk:     $(".ls-sub .jv"),
      warm:     $(".ls-warm"),
      warmLbl:  $(".ls-warm-label"),
      warmFill: $(".ls-warm-fill"),
      warmBest: $(".ls-warm-best"),
      bSound:   $(".b-sound"),
      bHelp:    $(".b-help"),
      bLb:      $(".b-lb"),
      hint:     $(".ls-hint"),
      toast:    $(".ls-toast"),
      pIntro:   $(".p-intro"),
      pHelp:    $(".p-help"),
      pLb:      $(".p-lb"),
      pWin:     $(".p-win"),
      cta:      $(".p-intro .ls-cta"),
      load:     $(".ls-load"),
      resume:   $(".ls-resume"),
      lFresh:   $(".l-fresh"),
      lbRows:   $(".ls-lb-rows"),
      sStraws:  $(".s-straws"),
      sTime:    $(".s-time"),
      sJunk:    $(".s-junk"),
      verdict:  $(".ls-verdict"),
      kicker:   $(".ls-kicker")
    };

    // Visible content exists now — release the host loader.
    ctx.markVisualReady("intro");
    let readyCalled = false;
    function safeReady() {
      if (readyCalled) return;
      readyCalled = true;
      try { ctx.platform.ready(); } catch (_) {}
    }
    safeReady();

    let booted = false;
    function fatal(stage, err) {
      const msg = err && (err.message || err.reason) ? String(err.message || err.reason) : String(err);
      try { ctx.platform.error({ stage: stage, message: msg }); } catch (_) {}
      if (booted) return;
      el.load.style.display = "none";
      el.cta.classList.remove("wait");
      el.cta.textContent = "Could not start";
      const tag = $(".p-intro .ls-tag");
      if (tag) { tag.textContent = "⚠ " + stage + " — " + msg; tag.style.color = "#ffd0c4"; }
    }

    // =======================================================================
    // 2. SMALL UTILITIES
    // =======================================================================
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (e0, e1, x) => {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    };

    // Deterministic PRNG. The whole haystack — straw positions, the needle, the
    // junk — is a pure function of one 32-bit seed, which is what makes a
    // ~1.6 KB save file able to restore a 10,000 object scene exactly.
    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function fmtTime(ms) {
      const s = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      const pad = (n) => (n < 10 ? "0" + n : String(n));
      return h > 0 ? h + ":" + pad(m) + ":" + pad(ss) : pad(m) + ":" + pad(ss);
    }
    const fmtNum = (n) => n.toLocaleString("en-US");

    // ---- procedural sound ------------------------------------------------
    // maxAssets is 0, so every sound is synthesised into a data: URL at boot.
    // ctx.audio explicitly allows data URLs; nothing is fetched.
    function encodeWav(samples, rate) {
      const n = samples.length;
      const bytes = new Uint8Array(44 + n * 2);
      const dv = new DataView(bytes.buffer);
      const put = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
      put(0, "RIFF");  dv.setUint32(4, 36 + n * 2, true);
      put(8, "WAVE");  put(12, "fmt ");
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
      dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
      put(36, "data"); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, clamp(samples[i], -1, 1) * 32767, true);
      let bin = "";
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
      }
      return "data:audio/wav;base64," + btoa(bin);
    }

    // A dry "shk" — bandpassed noise with a fast decay. Straw leaving straw.
    function makeRustle(rng, rate) {
      const dur = 0.10 + rng() * 0.05;
      const n = Math.floor(dur * rate);
      const out = new Float32Array(n);
      const lpC = 0.30 + rng() * 0.26;
      let lp = 0, hp = 0, prev = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.pow(1 - t, 2.7) * Math.min(1, t * 45);
        const x = rng() * 2 - 1;
        lp += (x - lp) * lpC;
        hp = 0.88 * (hp + lp - prev);
        prev = lp;
        out[i] = hp * env * 0.85;
      }
      return encodeWav(out, rate);
    }

    // A struck-metal "ting" for glints and junk.
    function makeTing(rate, f0, dur, bright) {
      const n = Math.floor(dur * rate);
      const out = new Float32Array(n);
      const parts = [1, 2.76, 5.4, 8.93];
      const gains = [1, 0.5 * bright, 0.26 * bright, 0.12 * bright];
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const env = Math.exp(-t * (5.5 / dur));
        let v = 0;
        for (let p = 0; p < parts.length; p++) {
          v += Math.sin(TAU * f0 * parts[p] * t) * gains[p] * Math.exp(-t * (2 + p * 5));
        }
        out[i] = v * env * 0.22;
      }
      return encodeWav(out, rate);
    }

    const SND = { rustle: [], ting: null, chime: null, thud: null };
    try {
      const srng = mulberry32(0x51ee7);
      for (let i = 0; i < 6; i++) SND.rustle.push(makeRustle(srng, 11025));
      SND.ting  = makeTing(16000, 1180, 0.5, 1.0);
      SND.chime = makeTing(16000, 1720, 1.15, 1.25);
      SND.thud  = makeTing(11025, 150, 0.26, 0.25);
    } catch (_) { /* sound is a nicety, never a blocker */ }

    let soundOn = true;
    let lastRustleAt = -1e9;
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);

    function sfx(url, vol) {
      if (!soundOn || !canAudio || !url) return;
      try { ctx.audio.play(url, { volume: vol }); } catch (_) {}
    }
    function rustle(now, vol) {
      if (now - lastRustleAt < 70) return;   // never stack more than ~14/s
      lastRustleAt = now;
      const list = SND.rustle;
      if (!list.length) return;
      sfx(list[(Math.random() * list.length) | 0], vol);
    }

    function haptic(kind) {
      if (!(ctx.capabilities && ctx.capabilities.haptics)) return;
      try { ctx.platform.haptic(kind); } catch (_) {}
    }

    // =======================================================================
    // 3. LOAD THREE
    // =======================================================================
    let THREE;
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e1) {
      try { THREE = await ctx.importModule(THREE_URL); }
      catch (e2) { fatal("load three", e2 || e1); return; }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) {
      fatal("three exports", new Error("WebGLRenderer missing"));
      return;
    }

    try {

    // Offscreen surfaces for baking textures must come from the SDK factory —
    // raw document.createElement("canvas") is rejected by the platform.
    function bakeCanvas(w, h) {
      const c = ctx.createCanvas2D();
      c.style.display = "none";
      c.width = w;
      c.height = h || w;
      return c;
    }

    function softDot(inner) {
      const c = bakeCanvas(64);
      const g = c.getContext("2d");
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(inner, "rgba(255,255,255,.55)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    // A four-point star flare for the glint moment.
    function starFlare() {
      const c = bakeCanvas(128);
      const g = c.getContext("2d");
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 30);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.4, "rgba(255,245,220,.5)");
      gr.addColorStop(1, "rgba(255,235,190,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(255,255,255,.85)";
      g.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(64, 64);
        g.rotate((i * Math.PI) / 4);
        g.lineWidth = i % 2 === 0 ? 3.5 : 1.6;
        const len = i % 2 === 0 ? 60 : 34;
        const grd = g.createLinearGradient(-len, 0, len, 0);
        grd.addColorStop(0, "rgba(255,255,255,0)");
        grd.addColorStop(0.5, "rgba(255,255,255,.9)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.strokeStyle = grd;
        g.beginPath(); g.moveTo(-len, 0); g.lineTo(len, 0); g.stroke();
        g.restore();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    const texDot   = softDot(0.3);
    const texPuff  = softDot(0.55);
    const texFlare = starFlare();

    // =======================================================================
    // 4. RENDERER, CAMERA, SKY, LIGHT
    // =======================================================================
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    const HORIZON = new THREE.Color(0xf0b072);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xefb98a, 26, 190);

    const camera = new THREE.PerspectiveCamera(52, ctx.width / ctx.height, 0.05, 600);
    // A tall phone is narrow: a fixed vertical FOV would slice the sides off
    // the pile. Derive the vertical FOV from the horizontal field we want.
    function fitCamera(w, h) {
      const aspect = w / Math.max(1, h);
      camera.aspect = aspect;
      const wantHalfH = 17 * Math.PI / 180;
      const vFov = 2 * Math.atan(Math.tan(wantHalfH) / Math.max(0.4, aspect));
      camera.fov = Math.max(46, Math.min(78, vFov * 180 / Math.PI));
      camera.updateProjectionMatrix();
    }
    fitCamera(ctx.width, ctx.height);

    // Low golden sun, roughly south-west, sitting just above the hills.
    const SUN_DIR = new THREE.Vector3(-0.62, 0.24, -0.75).normalize();
    const SUN_POS = SUN_DIR.clone().multiplyScalar(240);

    scene.add(new THREE.HemisphereLight(0xffd9a3, 0x4a3a22, 0.85));
    const key = new THREE.DirectionalLight(0xffcf88, 2.15);
    key.position.copy(SUN_DIR).multiplyScalar(60);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc6ff, 0.42);
    rim.position.set(24, 26, 34);
    scene.add(rim);
    // Travels just in front of the camera so freshly dug shafts are not caves.
    const lamp = new THREE.PointLight(0xffdcae, 0.0, 16, 1.6);
    scene.add(lamp);

    // ---- sky dome --------------------------------------------------------
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop:   { value: new THREE.Color(0x1d2f63) },
        uMid:   { value: new THREE.Color(0x7d86b4) },
        uHaze:  { value: new THREE.Color(0xffc98d) },
        uGlow:  { value: new THREE.Color(0xffe6b0) },
        uSun:   { value: SUN_DIR.clone() }
      },
      vertexShader: [
        "varying vec3 vDir;",
        "void main() {",
        "  vDir = normalize(position);",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  gl_Position = projectionMatrix * mv;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHaze; uniform vec3 uGlow; uniform vec3 uSun;",
        "varying vec3 vDir;",
        "void main() {",
        "  vec3 d = normalize(vDir);",
        "  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);",
        "  vec3 col = mix(uHaze, uMid, smoothstep(0.48, 0.66, h));",
        "  col = mix(col, uTop, smoothstep(0.60, 0.98, h));",
        // warm bloom wrapped around the sun
        "  float sd = max(dot(d, normalize(uSun)), 0.0);",
        "  col += uGlow * pow(sd, 7.0) * 0.85;",
        "  col += uGlow * pow(sd, 60.0) * 1.5;",
        // thin band of light sitting on the horizon line
        "  col += uGlow * 0.16 * exp(-abs(d.y) * 13.0);",
        "  gl_FragColor = vec4(col, 1.0);",
        "}"
      ].join("\n")
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), skyMat);
    sky.frustumCulled = false;
    scene.add(sky);

    // The sun disc itself, plus a broad soft halo.
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texDot, color: 0xfff3d4, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    sunSprite.position.copy(SUN_POS);
    sunSprite.scale.setScalar(46);
    scene.add(sunSprite);

    const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texDot, color: 0xffbe72, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    sunHalo.position.copy(SUN_POS);
    sunHalo.scale.setScalar(190);
    scene.add(sunHalo);

    // =======================================================================
    // 5. SAVE SLOT — loaded before anything is generated, because the seed
    //    decides the entire world.
    // =======================================================================
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);

    async function readSave() {
      let raw = null;
      if (canStore) {
        try { raw = await Promise.resolve(ctx.storage.get(SAVE_KEY)); } catch (_) { raw = null; }
      }
      if (!raw) {
        // Cross-device fallback: the platform-side local channel.
        try { raw = await ctx.memory.local("dig").get(); } catch (_) { raw = null; }
      }
      if (!raw || typeof raw !== "object") return null;
      if (raw.v !== SAVE_VER || typeof raw.seed !== "number") return null;
      // A cleared slot, or a haystack already solved, both mean "start fresh".
      if (raw.cleared || raw.won || !raw.seed) return null;
      return raw;
    }

    let save = null;
    try { save = await readSave(); } catch (_) { save = null; }

    const rand32 = () => (Math.random() * 0xffffffff) >>> 0;
    // Three independent seeds: the field never changes once you have seen it,
    // while "start a fresh haystack" re-rolls the pile and where things hide.
    const fieldSeed = (save && save.fseed) || rand32();
    let layoutSeed  = (save && save.seed)  || rand32();
    let placeSeed   = (save && save.pseed) || rand32();
    const resuming = !!(save && save.pulled > 0 && !save.won);

    // =======================================================================
    // 6. THE FIELD
    // =======================================================================
    const world = mulberry32(fieldSeed ^ 0x9e3779b9);

    function fieldH(x, z) {
      return (
        2.9 * Math.sin(x * 0.0195) * Math.cos(z * 0.0163) +
        1.55 * Math.sin(x * 0.0442 + 1.7) * Math.cos(z * 0.0371 - 0.4) +
        0.72 * Math.sin(x * 0.0910 - 2.1) * Math.cos(z * 0.0755 + 1.2) +
        0.34 * Math.sin(x * 0.201 + 0.6) * Math.cos(z * 0.187 + 2.4)
      );
    }
    // The haystack stands in a flat trodden clearing; hills only start further out.
    function groundY(x, z) {
      const d = Math.sqrt(x * x + z * z);
      return fieldH(x, z) * smoothstep(11, 42, d);
    }

    const terrainGeo = new THREE.PlaneGeometry(560, 560, 132, 132);
    terrainGeo.rotateX(-Math.PI / 2);
    {
      const pos = terrainGeo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const y = groundY(x, z);
        pos.setY(i, y);
        const d = Math.sqrt(x * x + z * z);
        // Dry gold on the crowns, deeper green in the dips and near the stack.
        const dry = clamp(0.42 + y * 0.10 + Math.sin(x * 0.07) * Math.cos(z * 0.061) * 0.20, 0, 1);
        const trodden = smoothstep(13, 4, d);          // scuffed earth by the haystack
        c.setHSL(
          lerp(0.19, 0.115, dry) - trodden * 0.03,
          lerp(0.34, 0.46, dry) * (1 - trodden * 0.42),
          lerp(0.30, 0.455, dry) * (1 - trodden * 0.24)
        );
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      pos.needsUpdate = true;
      terrainGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      terrainGeo.computeVertexNormals();
    }
    const terrain = new THREE.Mesh(
      terrainGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true })
    );
    scene.add(terrain);

    // Soft contact shadow so the stack is planted rather than floating.
    {
      const c = bakeCanvas(128);
      const g = c.getContext("2d");
      const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
      gr.addColorStop(0, "rgba(48,26,6,.62)");
      gr.addColorStop(0.55, "rgba(48,26,6,.30)");
      gr.addColorStop(1, "rgba(48,26,6,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const blob = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(c), transparent: true,
          depthWrite: false, opacity: 0.95
        })
      );
      blob.rotation.x = -Math.PI / 2;
      // Stretched away from the sun, the way a long low-sun shadow falls.
      blob.scale.set(STACK_R * 3.1, STACK_R * 4.4, 1);
      blob.position.set(SUN_DIR.x * -2.6, 0.035, SUN_DIR.z * -2.6);
      blob.renderOrder = -1;
      scene.add(blob);
    }

    // ---- shared wind uniform --------------------------------------------
    const windU = { value: 0 };

    // ---- grass ring ------------------------------------------------------
    {
      const N = 2800;
      const blade = new THREE.BufferGeometry();
      // A tapered two-triangle blade standing on the origin.
      const w = 0.055;
      blade.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        -w, 0, 0,   w, 0, 0,   -w * 0.45, 0.62, 0,
         w, 0, 0,   w * 0.45, 0.62, 0,  -w * 0.45, 0.62, 0,
        -w * 0.45, 0.62, 0,  w * 0.45, 0.62, 0,  0, 1.0, 0
      ]), 3));
      blade.setAttribute("color", new THREE.BufferAttribute(new Float32Array(9 * 3).fill(1), 3));
      blade.computeVertexNormals();

      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = windU;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;")
          .replace("#include <begin_vertex>", [
            "#include <begin_vertex>",
            "float ph = instanceMatrix[3][0] * 0.42 + instanceMatrix[3][2] * 0.31;",
            "float bend = transformed.y * transformed.y;",
            "transformed.x += sin(uTime * 1.55 + ph) * 0.30 * bend;",
            "transformed.z += cos(uTime * 1.18 + ph * 1.3) * 0.19 * bend;"
          ].join("\n"));
      };

      const grass = new THREE.InstancedMesh(blade, mat, N);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const v = new THREE.Vector3(), s = new THREE.Vector3();
      const col = new THREE.Color();
      let placed = 0;
      for (let i = 0; i < N; i++) {
        // Denser close in, thinning outward; nothing inside the trodden ring.
        const r = 6.4 + Math.pow(world(), 0.55) * 40;
        const a = world() * TAU;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const hgt = 0.45 + world() * 0.62;
        v.set(x, groundY(x, z) - 0.04, z);
        q.setFromEuler(new THREE.Euler(world() * 0.16 - 0.08, world() * TAU, world() * 0.16 - 0.08));
        s.set(0.8 + world() * 0.7, hgt, 1);
        m.compose(v, q, s);
        grass.setMatrixAt(placed, m);
        col.setHSL(0.16 - world() * 0.045, 0.40 + world() * 0.22, 0.30 + world() * 0.22);
        grass.setColorAt(placed, col);
        placed++;
      }
      grass.count = placed;
      grass.instanceMatrix.needsUpdate = true;
      if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
      scene.add(grass);
    }

    // ---- trees, bales, fence, barn --------------------------------------
    {
      const TREES = 30;
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.30, 1, 5);
      trunkGeo.translate(0, 0.5, 0);
      trunkGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(trunkGeo.attributes.position.count * 3).fill(1), 3));
      const canopyGeo = new THREE.ConeGeometry(1, 1, 7);
      canopyGeo.translate(0, 0.5, 0);
      canopyGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(canopyGeo.attributes.position.count * 3).fill(1), 3));

      const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), TREES);
      const tops   = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), TREES * 2);

      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const v = new THREE.Vector3(), s = new THREE.Vector3();
      const col = new THREE.Color();
      let ti = 0;
      for (let i = 0; i < TREES; i++) {
        const a = (i / TREES) * TAU + world() * 0.35;
        const r = 30 + world() * 130;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const gy = groundY(x, z);
        const h = 3.4 + world() * 4.6;
        q.identity();
        v.set(x, gy, z); s.set(1, h * 0.42, 1);
        m.compose(v, q, s);
        trunks.setMatrixAt(i, m);
        col.setHSL(0.08, 0.34, 0.16 + world() * 0.07);
        trunks.setColorAt(i, col);

        for (let k = 0; k < 2; k++) {
          const cw = (2.0 + world() * 1.1) * (1 - k * 0.33);
          v.set(x, gy + h * 0.30 + k * h * 0.30, z);
          s.set(cw, h * (0.52 - k * 0.10), cw);
          m.compose(v, q, s);
          tops.setMatrixAt(ti, m);
          col.setHSL(0.20 - world() * 0.05, 0.40, 0.20 + world() * 0.11);
          tops.setColorAt(ti, col);
          ti++;
        }
      }
      tops.count = ti;
      trunks.instanceMatrix.needsUpdate = true;
      tops.instanceMatrix.needsUpdate = true;
      if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
      if (tops.instanceColor) tops.instanceColor.needsUpdate = true;
      scene.add(trunks, tops);

      // Round bales, lying on their sides like the real thing.
      const baleGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
      baleGeo.rotateZ(Math.PI / 2);
      baleGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(baleGeo.attributes.position.count * 3).fill(1), 3));
      const bales = new THREE.InstancedMesh(baleGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), 9);
      for (let i = 0; i < 9; i++) {
        const a = world() * TAU;
        const r = 16 + world() * 30;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const rad = 0.95 + world() * 0.4;
        q.setFromEuler(new THREE.Euler(0, world() * TAU, 0));
        v.set(x, groundY(x, z) + rad * 0.94, z);
        s.set(rad * 1.6, rad, rad);
        m.compose(v, q, s);
        bales.setMatrixAt(i, m);
        col.setHSL(0.125, 0.44, 0.40 + world() * 0.10);
        bales.setColorAt(i, col);
      }
      bales.instanceMatrix.needsUpdate = true;
      if (bales.instanceColor) bales.instanceColor.needsUpdate = true;
      scene.add(bales);

      // A post-and-rail fence running across the middle distance.
      const POSTS = 34;
      const postGeo = new THREE.BoxGeometry(0.16, 1, 0.16);
      postGeo.translate(0, 0.5, 0);
      const railGeo = new THREE.BoxGeometry(1, 0.10, 0.07);
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
      const posts = new THREE.InstancedMesh(postGeo, woodMat, POSTS);
      const rails = new THREE.InstancedMesh(railGeo, woodMat, POSTS * 2);
      const fenceA = 2.25, fx = Math.cos(fenceA), fz = Math.sin(fenceA);
      const startD = -POSTS * 0.5 * 3.0;
      const off = 27;
      let ri = 0;
      let prev = null;
      for (let i = 0; i < POSTS; i++) {
        const d = startD + i * 3.0;
        const x = fx * d - fz * off;
        const z = fz * d + fx * off;
        const gy = groundY(x, z);
        q.identity();
        v.set(x, gy - 0.1, z); s.set(1, 1.4, 1);
        m.compose(v, q, s);
        posts.setMatrixAt(i, m);
        if (prev) {
          for (let k = 0; k < 2; k++) {
            const mx = (x + prev.x) * 0.5, mz = (z + prev.z) * 0.5;
            const my = (gy + prev.y) * 0.5 + 0.62 + k * 0.42;
            const len = Math.hypot(x - prev.x, z - prev.z);
            q.setFromEuler(new THREE.Euler(0, -Math.atan2(z - prev.z, x - prev.x), 0));
            v.set(mx, my, mz); s.set(len, 1, 1);
            m.compose(v, q, s);
            rails.setMatrixAt(ri++, m);
          }
        }
        prev = { x: x, y: gy, z: z };
      }
      rails.count = ri;
      posts.instanceMatrix.needsUpdate = true;
      rails.instanceMatrix.needsUpdate = true;
      scene.add(posts, rails);

      // A barn on the far ridge — pure silhouette, no detail needed at that range.
      const barn = new THREE.Group();
      const barnMat = new THREE.MeshLambertMaterial({ color: 0x7d2f22 });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a2a22 });
      const BW = 13, BH = 7.5, BD = 9;
      const body = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, BD), barnMat);
      body.position.y = BH / 2;
      // Gable roof: two slabs leaning against each other along the ridge. Each
      // slab is `slope` deep, tilted so its outer edge lands exactly on an eave.
      const rise = 3.2, halfW = BD / 2;
      const slope = Math.hypot(rise, halfW), ang = Math.atan2(rise, halfW);
      const roofGeo = new THREE.BoxGeometry(BW + 0.8, 0.42, slope);
      const roofA = new THREE.Mesh(roofGeo, roofMat);
      roofA.position.set(0, BH + rise / 2, halfW / 2);
      roofA.rotation.x = ang;
      const roofB = new THREE.Mesh(roofGeo, roofMat);
      roofB.position.set(0, BH + rise / 2, -halfW / 2);
      roofB.rotation.x = -ang;
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 11, 12), new THREE.MeshLambertMaterial({ color: 0x8a8577 }));
      silo.position.set(9, 5.5, 1.5);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 7, 0, TAU, 0, Math.PI / 2), roofMat);
      cap.position.set(9, 11, 1.5);
      barn.add(body, roofA, roofB, silo, cap);
      const bx = 74, bz = -96;
      barn.position.set(bx, groundY(bx, bz) - 0.4, bz);
      barn.rotation.y = -0.7;
      scene.add(barn);
    }

    // =======================================================================
    // 7. THE HAYSTACK
    //    10,000 straws generated from the run seed. Nothing about the pile is
    //    stored in the save file except which straws are gone.
    // =======================================================================
    // Profile of the pile: radius as a function of normalised height.
    // A domed cone with a slightly flared base, the way a hand-built rick sits.
    const R_MAX = STACK_R * 1.08;
    function hullR(t) {
      if (t <= 0) return R_MAX;
      if (t >= 1) return 0;
      return STACK_R * Math.pow(1 - Math.pow(t, 2.3), 0.52) * (1 + 0.08 * Math.pow(1 - t, 5));
    }

    // Sampled profile, used to measure how far any straw sits below the surface.
    const PROF = 72;
    const profR = new Float32Array(PROF + 1);
    const profY = new Float32Array(PROF + 1);
    for (let k = 0; k <= PROF; k++) {
      const t = k / PROF;
      profR[k] = hullR(t);
      profY[k] = t * STACK_H;
    }
    function surfaceDist(r, y) {
      let best = 1e9;
      for (let k = 0; k <= PROF; k++) {
        const dr = r - profR[k], dy = y - profY[k];
        const d = dr * dr + dy * dy;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    }
    const DEPTH_NORM = 3.0;

    const sPos   = new Float32Array(STRAW_COUNT * 3);
    const sDir   = new Float32Array(STRAW_COUNT * 3);
    const sCol   = new Float32Array(STRAW_COUNT * 3);
    const sHalf  = new Float32Array(STRAW_COUNT);
    const sDepth = new Float32Array(STRAW_COUNT);
    const sSway  = new Float32Array(STRAW_COUNT);

    const STRAW_RAD = 0.052;   // used by the picker as the capsule radius

    // Rebuildable so "start a fresh haystack" can re-roll the pile in place
    // rather than reloading the host.
    function generateStraws(seed) {
      const rng = mulberry32(seed);
      const tmp = new THREE.Color();
      for (let i = 0; i < STRAW_COUNT; i++) {
        // Uniform-by-volume sampling: pick a height weighted by cross-section
        // area, then a point on that disc.
        let y = 0, R = 0;
        for (let guard = 0; guard < 64; guard++) {
          y = rng() * STACK_H;
          R = hullR(y / STACK_H);
          if (rng() * R_MAX * R_MAX <= R * R) break;
        }
        const a = rng() * TAU;
        let r = R * Math.sqrt(rng());
        const ca = Math.cos(a), sa2 = Math.sin(a);

        const d = surfaceDist(r, y);
        let depth01 = clamp(d / DEPTH_NORM, 0, 1);

        // Local slope of the pile, for orientation and for the fuzzy edge.
        const t = y / STACK_H;
        const e = 0.006;
        const tHi = Math.min(1, t + e), tLo = Math.max(0, t - e);
        const dR = (hullR(tHi) - hullR(tLo)) / Math.max(1e-6, (tHi - tLo) * STACK_H);

        let len = 0.74 + rng() * 0.34;
        let py = y;

        // A fraction of the outermost straws poke out past the hull so the
        // silhouette is bristly instead of a clean shell.
        if (depth01 < 0.10 && rng() < 0.17) {
          const nl = 1 / Math.hypot(1, dR);
          const nr = nl, ny = -dR * nl;
          const push = 0.06 + rng() * 0.30;
          r += nr * push;
          py += ny * push;
          len *= 1.22;
          depth01 = 0;
        }

        const px = ca * r, pz = sa2 * r;
        sPos[i * 3] = px; sPos[i * 3 + 1] = py; sPos[i * 3 + 2] = pz;

        // Orientation. Near the surface, straws lie in the tangent plane —
        // mostly along the slope, like thatch. Deeper in, it is a jumble.
        const sl = 1 / Math.hypot(dR, 1);
        const slx = ca * dR * sl, sly = sl, slz = sa2 * dR * sl;
        const azx = -sa2, azz = ca;
        const phi = (rng() + rng() + rng() - 1.5) * 0.95;
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const tx = slx * cp + azx * sp, ty = sly * cp, tz = slz * cp + azz * sp;

        const u = rng() * 2 - 1, th = rng() * TAU, sq = Math.sqrt(Math.max(0, 1 - u * u));
        const rx = sq * Math.cos(th), ry = u, rz = sq * Math.sin(th);

        const k = smoothstep(0.06, 0.50, depth01) * 0.92;
        let dx = lerp(tx, rx, k), dy2 = lerp(ty, ry, k), dz = lerp(tz, rz, k);
        let dl = Math.hypot(dx, dy2, dz);
        if (!(dl > 1e-5)) { dx = 0; dy2 = 1; dz = 0; dl = 1; }
        sDir[i * 3] = dx / dl; sDir[i * 3 + 1] = dy2 / dl; sDir[i * 3 + 2] = dz / dl;

        sHalf[i] = len * 0.5;
        sDepth[i] = depth01;
        sSway[i] = Math.pow(1 - depth01, 2.2) * 0.19;

        // Hay colour, then darkened by depth so the inside of the pile reads as
        // shadow. Digging a shaft therefore carves a visibly dark tunnel.
        tmp.setHSL(
          0.108 + rng() * 0.030,
          0.44 + rng() * 0.22,
          0.40 + rng() * 0.24,
          THREE.SRGBColorSpace
        );
        const ao = lerp(1.0, 0.16, Math.pow(depth01, 0.8)) * (0.90 + (py / STACK_H) * 0.16);
        sCol[i * 3] = tmp.r * ao; sCol[i * 3 + 1] = tmp.g * ao; sCol[i * 3 + 2] = tmp.b * ao;
      }
    }
    generateStraws(layoutSeed);

    // ---- meshes ----------------------------------------------------------
    function makeStrawGeo() {
      const g = new THREE.CylinderGeometry(0.030, STRAW_RAD, 1, 3, 1, false);
      // instanceColor only reaches the fragment shader when USE_COLOR is also
      // defined (three r164 declares vColor in the fragment under USE_COLOR
      // only), so the material needs vertexColors AND a unit colour attribute.
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      return g;
    }

    const strawGeo = makeStrawGeo();
    strawGeo.setAttribute("aSway", new THREE.InstancedBufferAttribute(new Float32Array(STRAW_COUNT), 1));

    function strawMaterial(withWind) {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      if (!withWind) return mat;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = windU;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aSway;")
          .replace("#include <begin_vertex>", [
            "#include <begin_vertex>",
            "float ph = instanceMatrix[3][0] * 0.9 + instanceMatrix[3][2] * 0.7 + instanceMatrix[3][1] * 0.45;",
            "transformed.x += sin(uTime * 1.9 + ph) * aSway * transformed.y;",
            "transformed.z += cos(uTime * 1.6 + ph * 1.21) * aSway * 0.7 * transformed.y;"
          ].join("\n"));
      };
      return mat;
    }

    const strawMesh = new THREE.InstancedMesh(strawGeo, strawMaterial(true), STRAW_COUNT);
    strawMesh.frustumCulled = false;
    strawMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(strawMesh);

    // Straws mid-flight live in their own small mesh so the main one can stay
    // tightly packed.
    const FLY_MAX = 72;
    const flyMesh = new THREE.InstancedMesh(makeStrawGeo(), strawMaterial(false), FLY_MAX);
    flyMesh.frustumCulled = false;
    flyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flyMesh.count = 0;
    scene.add(flyMesh);

    // ---- slot bookkeeping ------------------------------------------------
    // Live straws occupy slots [0, liveCount). Removing one swaps the last live
    // straw into the hole, so the GPU never draws a gap and picking only ever
    // walks the straws that still exist.
    const slotOf  = new Int32Array(STRAW_COUNT);
    const strawOf = new Int32Array(STRAW_COUNT);
    let liveCount = 0;

    const _v = new THREE.Vector3(), _d = new THREE.Vector3();
    const _q = new THREE.Quaternion(), _s = new THREE.Vector3();
    const _m = new THREE.Matrix4(), _c = new THREE.Color();
    const UP = new THREE.Vector3(0, 1, 0);
    const swayAttr = strawGeo.getAttribute("aSway");

    function writeSlot(slot, i) {
      _v.set(sPos[i * 3], sPos[i * 3 + 1], sPos[i * 3 + 2]);
      _d.set(sDir[i * 3], sDir[i * 3 + 1], sDir[i * 3 + 2]);
      _q.setFromUnitVectors(UP, _d);
      _s.set(1, sHalf[i] * 2, 1);
      _m.compose(_v, _q, _s);
      strawMesh.setMatrixAt(slot, _m);
      _c.setRGB(sCol[i * 3], sCol[i * 3 + 1], sCol[i * 3 + 2]);
      strawMesh.setColorAt(slot, _c);
      swayAttr.array[slot] = sSway[i];
    }

    function buildStack(removedBits) {
      liveCount = 0;
      for (let i = 0; i < STRAW_COUNT; i++) {
        if (removedBits && (removedBits[i >> 3] & (1 << (i & 7)))) {
          slotOf[i] = -1;
          continue;
        }
        const slot = liveCount++;
        strawOf[slot] = i;
        slotOf[i] = slot;
        writeSlot(slot, i);
      }
      strawMesh.count = liveCount;
      strawMesh.instanceMatrix.needsUpdate = true;
      if (strawMesh.instanceColor) strawMesh.instanceColor.needsUpdate = true;
      swayAttr.needsUpdate = true;
    }

    // =======================================================================
    // 8. THE NEEDLE AND THE JUNK
    // =======================================================================
    // A procedural environment map so polished metal actually looks polished.
    // Without one, a high-metalness PBR material renders almost black.
    let envTex = null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      // Same shader, small radius — it only ever reads the normalised direction.
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), skyMat));
      const rt = pmrem.fromScene(envScene, 0.02, 1, 200);
      envTex = rt.texture;
      pmrem.dispose();
      ctx.onDestroy(() => { try { rt.dispose(); } catch (_) {} });
    } catch (_) { envTex = null; }

    function metalMat(color, metalness, roughness) {
      const m = new THREE.MeshStandardMaterial({
        color: color,
        metalness: envTex ? metalness : Math.min(metalness, 0.35),
        roughness: roughness
      });
      if (envTex) { m.envMap = envTex; m.envMapIntensity = 1.35; }
      else m.emissive = new THREE.Color(color).multiplyScalar(0.16);
      return m;
    }

    const needlePos = new THREE.Vector3();
    let needleAz = 0;

    const needle = new THREE.Group();
    {
      const steel = metalMat(0xd7dde6, 0.96, 0.16);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.028, 0.80, 10), steel);
      body.position.y = 0.02;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.26, 10), steel);
      tip.position.y = -0.53;
      tip.rotation.x = Math.PI;
      const eyeRing = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.017, 6, 14), steel);
      eyeRing.position.y = 0.455;
      eyeRing.rotation.y = Math.PI / 2;
      needle.add(body, tip, eyeRing);
      scene.add(needle);
    }

    // The glint. Hidden until the needle actually has a clear line to the camera.
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texFlare, color: 0xfff6dd, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
    }));
    glint.scale.setScalar(1.1);
    scene.add(glint);

    // ---- six pieces of junk ---------------------------------------------
    const JUNK = [
      { name: "a bent nail",     msg: "A bent nail. Not a needle. Nobody is impressed.",                     color: 0x9aa0a8, metal: 0.9,  rough: 0.42 },
      { name: "a bottle cap",    msg: "A bottle cap. Someone stood here drinking something in 1997.",        color: 0xc0432f, metal: 0.75, rough: 0.34 },
      { name: "a brass ring",    msg: "A brass ring. Worthless, sentimental, and still not a needle.",       color: 0xc79a3a, metal: 0.95, rough: 0.22 },
      { name: "a shirt button",  msg: "A shirt button. Its shirt is long gone. So is your afternoon.",       color: 0xe8dfc9, metal: 0.12, rough: 0.62 },
      { name: "a small coin",    msg: "A coin. Wrong currency, wrong century, wrong shape entirely.",        color: 0xb2732f, metal: 0.92, rough: 0.28 },
      { name: "a paperclip",     msg: "A paperclip. So close. So very, very not it.",                        color: 0xbfc6cf, metal: 0.94, rough: 0.24 }
    ];

    // The props are built once; only where they hide changes between runs.
    const decoys = [];
    {
      for (let j = 0; j < DECOY_COUNT; j++) {
        const spec = JUNK[j % JUNK.length];
        const mat = metalMat(spec.color, spec.metal, spec.rough);
        const g = new THREE.Group();
        if (j % 6 === 0) {
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.44, 6), mat);
          const head = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.028, 8), mat);
          head.position.y = 0.23;
          shaft.rotation.z = 0.22;
          g.add(shaft, head);
        } else if (j % 6 === 1) {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.105, 0.055, 16), mat);
          g.add(cap);
        } else if (j % 6 === 2) {
          g.add(new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.026, 7, 16), mat));
        } else if (j % 6 === 3) {
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.024, 16), mat));
        } else if (j % 6 === 4) {
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.016, 18), mat));
        } else {
          const t1 = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 6, 16), mat);
          const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.013, 6, 14), mat);
          t2.position.z = 0.012;
          g.add(t1, t2);
        }
        scene.add(g);

        const spark = new THREE.Sprite(new THREE.SpriteMaterial({
          map: texFlare, color: 0xffeec9, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
        }));
        spark.scale.setScalar(0.75);
        scene.add(spark);

        decoys.push({
          pos: new THREE.Vector3(), mesh: g, spark: spark,
          name: spec.name, msg: spec.msg, found: false, vis: false, idx: j
        });
      }
    }

    // Choose where the needle and every piece of junk hide. Re-runnable.
    function placeAll(seed) {
      const rng = mulberry32(seed);

      // The needle sits genuinely deep — never within reach of the surface.
      let ok = false;
      for (let tries = 0; tries < 400 && !ok; tries++) {
        const t = 0.16 + rng() * 0.46;
        const y = t * STACK_H;
        const r = hullR(t) * (0.10 + rng() * 0.56);
        const a = rng() * TAU;
        if (surfaceDist(r, y) < 1.85) continue;
        needlePos.set(Math.cos(a) * r, y, Math.sin(a) * r);
        needleAz = a;
        ok = true;
      }
      if (!ok) { needlePos.set(0, STACK_H * 0.34, 0); needleAz = 0; }

      needle.position.copy(needlePos);
      needle.rotation.set(0.9 + rng() * 0.5, rng() * TAU, 0.35 + rng() * 0.4);
      glint.position.copy(needlePos);

      for (let j = 0; j < decoys.length; j++) {
        const dc = decoys[j];
        // Spread around the pile, deliberately off the needle's bearing, so
        // chasing a glint walks you the wrong way round the stack.
        const a = needleAz + Math.PI * 0.45 + (j / Math.max(1, decoys.length)) * Math.PI * 1.1 + (rng() - 0.5) * 0.5;
        let placed = false;
        for (let tries = 0; tries < 300 && !placed; tries++) {
          const t = 0.10 + rng() * 0.60;
          const y = t * STACK_H;
          const r = hullR(t) * (0.18 + rng() * 0.66);
          const dd = surfaceDist(r, y);
          if (dd < 0.60 || dd > 2.9) continue;
          const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
          const dx = cx - needlePos.x, dy = y - needlePos.y, dz = cz - needlePos.z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 1.9) continue;
          dc.pos.set(cx, y, cz);
          placed = true;
        }
        if (!placed) dc.pos.set(0, STACK_H * 0.5, 0);
        dc.mesh.position.copy(dc.pos);
        dc.mesh.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
        dc.spark.position.copy(dc.pos);
        dc.spark.material.opacity = 0;
        dc.vis = false;
        if (dc.found) {
          dc.found = false;
          scene.add(dc.mesh);
          scene.add(dc.spark);
        }
      }
    }
    placeAll(placeSeed);

    // =======================================================================
    // 9. AIR — drifting chaff and a few distant birds
    // =======================================================================
    function makePoints(max, size, opacity) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 3), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(max * 3), 3));
      geo.setDrawRange(0, 0);
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size: size, map: texPuff, vertexColors: true, transparent: true,
        opacity: opacity, depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending, fog: false
      }));
      pts.frustumCulled = false;
      scene.add(pts);
      return pts;
    }

    // Ambient chaff hanging in the light around the pile.
    const MOTE_N = 300;
    const motes = makePoints(MOTE_N, 0.075, 0.85);
    const motePos = motes.geometry.attributes.position.array;
    const moteCol = motes.geometry.attributes.color.array;
    const moteVel = new Float32Array(MOTE_N * 3);
    for (let i = 0; i < MOTE_N; i++) {
      const a = world() * TAU, r = 1.5 + world() * 13;
      motePos[i * 3] = Math.cos(a) * r;
      motePos[i * 3 + 1] = world() * 11;
      motePos[i * 3 + 2] = Math.sin(a) * r;
      moteVel[i * 3] = (world() - 0.35) * 0.13;
      moteVel[i * 3 + 1] = 0.05 + world() * 0.15;
      moteVel[i * 3 + 2] = (world() - 0.5) * 0.13;
      const g = 0.35 + world() * 0.5;
      moteCol[i * 3] = g; moteCol[i * 3 + 1] = g * 0.82; moteCol[i * 3 + 2] = g * 0.5;
    }
    motes.geometry.setDrawRange(0, MOTE_N);
    motes.geometry.attributes.position.needsUpdate = true;
    motes.geometry.attributes.color.needsUpdate = true;

    // Burst particles thrown out when a straw is pulled. Additive blending plus
    // per-particle colour is what lets each one fade out independently.
    const PUFF_N = 460;
    const puffs = makePoints(PUFF_N, 0.10, 0.95);
    const puffPos = puffs.geometry.attributes.position.array;
    const puffCol = puffs.geometry.attributes.color.array;
    const puffVel = new Float32Array(PUFF_N * 3);
    const puffLife = new Float32Array(PUFF_N);
    const puffMax = new Float32Array(PUFF_N);
    const puffTint = new Float32Array(PUFF_N * 3);
    let puffHead = 0;

    function spawnPuff(x, y, z, n, tintR, tintG, tintB, spread) {
      for (let k = 0; k < n; k++) {
        const i = puffHead;
        puffHead = (puffHead + 1) % PUFF_N;
        puffPos[i * 3] = x + (Math.random() - 0.5) * 0.14;
        puffPos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.14;
        puffPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.14;
        puffVel[i * 3] = (Math.random() - 0.5) * spread;
        puffVel[i * 3 + 1] = 0.25 + Math.random() * spread;
        puffVel[i * 3 + 2] = (Math.random() - 0.5) * spread;
        puffMax[i] = 0.75 + Math.random() * 0.85;
        puffLife[i] = puffMax[i];
        puffTint[i * 3] = tintR; puffTint[i * 3 + 1] = tintG; puffTint[i * 3 + 2] = tintB;
      }
      puffs.geometry.setDrawRange(0, PUFF_N);
    }

    // Distant birds, wheeling slowly. Pure silhouette.
    const birds = [];
    {
      const c = bakeCanvas(64, 32);
      const g = c.getContext("2d");
      g.strokeStyle = "rgba(30,20,14,1)";
      g.lineWidth = 4; g.lineCap = "round";
      g.beginPath();
      g.moveTo(6, 22); g.quadraticCurveTo(18, 6, 32, 18);
      g.quadraticCurveTo(46, 6, 58, 22);
      g.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, transparent: true, opacity: 0.5, depthWrite: false, fog: true
        }));
        s.scale.set(4.2, 2.1, 1);
        scene.add(s);
        birds.push({
          sprite: s,
          r: 46 + world() * 60,
          a: world() * TAU,
          sp: 0.055 + world() * 0.055,
          y: 26 + world() * 20,
          cx: -30 + world() * 60,
          cz: -50 + world() * 40
        });
      }
    }

    // =======================================================================
    // 10. PICKING
    //     A custom ray test rather than InstancedMesh.raycast: it lets the
    //     pick walk only live straws, treat each as a capsule, and bail early
    //     once a nearer hit is locked in.
    // =======================================================================
    const _ndc = new THREE.Vector3();
    const ray = { ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 1 };

    function rayFromScreen(cx, cy) {
      _ndc.set((cx / ctx.width) * 2 - 1, -(cy / ctx.height) * 2 + 1, 0.5);
      _ndc.unproject(camera);
      ray.ox = camera.position.x; ray.oy = camera.position.y; ray.oz = camera.position.z;
      let dx = _ndc.x - ray.ox, dy = _ndc.y - ray.oy, dz = _ndc.z - ray.oz;
      const l = Math.hypot(dx, dy, dz) || 1;
      ray.vx = dx / l; ray.vy = dy / l; ray.vz = dz / l;
    }

    function rayToPoints(ax, ay, az, bx, by, bz) {
      ray.ox = ax; ray.oy = ay; ray.oz = az;
      let dx = bx - ax, dy = by - ay, dz = bz - az;
      const l = Math.hypot(dx, dy, dz) || 1;
      ray.vx = dx / l; ray.vy = dy / l; ray.vz = dz / l;
      return l;
    }

    const PICK_PAD = 0.022;

    // Nearest live straw along the current ray, or -1. maxT bounds the search.
    function pickStraw(maxT) {
      const ox = ray.ox, oy = ray.oy, oz = ray.oz;
      const vx = ray.vx, vy = ray.vy, vz = ray.vz;
      const R = STRAW_RAD + PICK_PAD;
      const R2 = R * R;
      let bestT = maxT === undefined ? Infinity : maxT;
      let bestI = -1;

      for (let slot = 0; slot < liveCount; slot++) {
        const i = strawOf[slot];
        const i3 = i * 3;
        const ex = sPos[i3] - ox, ey = sPos[i3 + 1] - oy, ez = sPos[i3 + 2] - oz;
        const b = ex * vx + ey * vy + ez * vz;
        const h = sHalf[i];
        const hr = h + R;
        if (b <= 0) continue;
        if (b - hr >= bestT) continue;                    // cannot beat the best
        const perp = ex * ex + ey * ey + ez * ez - b * b; // squared distance to the ray line
        if (perp > hr * hr) continue;

        // Narrow phase: closest approach between the ray and the straw segment.
        const dxr = sDir[i3], dyr = sDir[i3 + 1], dzr = sDir[i3 + 2];
        const bb = vx * dxr + vy * dyr + vz * dzr;        // V·D
        const wx = ox - sPos[i3], wy = oy - sPos[i3 + 1], wz = oz - sPos[i3 + 2];
        const dd = vx * wx + vy * wy + vz * wz;           // V·w0
        const ee = dxr * wx + dyr * wy + dzr * wz;        // D·w0
        const den = 1 - bb * bb;
        let sSeg = den > 1e-6 ? (ee - bb * dd) / den : 0;
        if (sSeg > h) sSeg = h; else if (sSeg < -h) sSeg = -h;
        let t = -dd + sSeg * bb;
        if (t < 0) t = 0;
        if (t >= bestT) continue;

        const qx = sPos[i3] + dxr * sSeg - (ox + vx * t);
        const qy = sPos[i3 + 1] + dyr * sSeg - (oy + vy * t);
        const qz = sPos[i3 + 2] + dzr * sSeg - (oz + vz * t);
        if (qx * qx + qy * qy + qz * qz > R2) continue;

        bestT = t;
        bestI = i;
      }
      return { i: bestI, t: bestT };
    }

    // Ray vs sphere, returning the entry distance or -1.
    function pickSphere(p, radius) {
      const ex = p.x - ray.ox, ey = p.y - ray.oy, ez = p.z - ray.oz;
      const b = ex * ray.vx + ey * ray.vy + ez * ray.vz;
      if (b <= 0) return -1;
      const perp = ex * ex + ey * ey + ez * ez - b * b;
      const r2 = radius * radius;
      if (perp > r2) return -1;
      return Math.max(0, b - Math.sqrt(r2 - perp));
    }

    // Deliberate taps are forgiving; a blind burrow only snags the needle when
    // it is dead ahead, so nobody wins by accident.
    const NEEDLE_TAP  = 0.24;
    const NEEDLE_DIG  = 0.10;
    const DECOY_PICK  = 0.17;

    // What is actually in front of the player right now?
    function pickAny(needleRadius) {
      const straw = pickStraw();
      let best = { kind: straw.i >= 0 ? "straw" : "none", i: straw.i, t: straw.t };

      const tn = pickSphere(needlePos, needleRadius === undefined ? NEEDLE_TAP : needleRadius);
      if (tn >= 0 && tn < best.t) best = { kind: "needle", i: -1, t: tn };

      for (let k = 0; k < decoys.length; k++) {
        if (decoys[k].found) continue;
        const td = pickSphere(decoys[k].pos, DECOY_PICK);
        if (td >= 0 && td < best.t) best = { kind: "decoy", i: k, t: td };
      }
      return best;
    }

    // Is there clear air between a world point and the camera?
    function hasLineOfSight(p) {
      const dist = rayToPoints(camera.position.x, camera.position.y, camera.position.z, p.x, p.y, p.z);
      const hit = pickStraw(dist - 0.16);
      return hit.i < 0;
    }

    // =======================================================================
    // 11. GAME STATE
    // =======================================================================
    const removedBits = new Uint8Array(Math.ceil(STRAW_COUNT / 8));
    let pulled = 0;
    let elapsedMs = 0;
    let junkFound = 0;
    let won = false;
    let started = false;
    let dirty = false;

    let warmNow = 0, warmBest = 0, warmTier = 0;
    let sawWarm = false, sawHot = false;

    const flying = [];
    const jiggles = [];

    // ---- flying straws ---------------------------------------------------
    function launchStraw(i) {
      if (flying.length >= FLY_MAX) flying.shift();
      const px = sPos[i * 3], py = sPos[i * 3 + 1], pz = sPos[i * 3 + 2];
      // Thrown outward from the pile's axis, with a lift and a tumble.
      const rl = Math.hypot(px, pz) || 1;
      const out = 0.9 + Math.random() * 1.5;
      flying.push({
        px: px, py: py, pz: pz,
        dx: sDir[i * 3], dy: sDir[i * 3 + 1], dz: sDir[i * 3 + 2],
        half: sHalf[i],
        cr: sCol[i * 3], cg: sCol[i * 3 + 1], cb: sCol[i * 3 + 2],
        vx: (px / rl) * out + (Math.random() - 0.5) * 0.8,
        vy: 1.5 + Math.random() * 1.7,
        vz: (pz / rl) * out + (Math.random() - 0.5) * 0.8,
        rx: (Math.random() - 0.5) * 13,
        rz: (Math.random() - 0.5) * 13,
        t: 0, life: 0.78 + Math.random() * 0.3
      });
    }

    function writeSlotOffset(slot, i, ox, oy, oz) {
      _v.set(sPos[i * 3] + ox, sPos[i * 3 + 1] + oy, sPos[i * 3 + 2] + oz);
      _d.set(sDir[i * 3], sDir[i * 3 + 1], sDir[i * 3 + 2]);
      _q.setFromUnitVectors(UP, _d);
      _s.set(1, sHalf[i] * 2, 1);
      _m.compose(_v, _q, _s);
      strawMesh.setMatrixAt(slot, _m);
      strawMesh.instanceMatrix.addUpdateRange(slot * 16, 16);
      strawMesh.instanceMatrix.needsUpdate = true;
    }

    // Straws around the hole shiver — the pile reads as loose, not welded.
    function shakeNeighbours(x, y, z) {
      let added = 0;
      for (let slot = 0; slot < liveCount && added < 9; slot++) {
        const i = strawOf[slot];
        const dx = sPos[i * 3] - x, dy = sPos[i * 3 + 1] - y, dz = sPos[i * 3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 0.30) continue;
        if (Math.random() < 0.45) continue;
        const l = Math.sqrt(d2) || 1;
        jiggles.push({
          i: i, t: 0, life: 0.34,
          ax: dx / l * 0.035, ay: 0.02, az: dz / l * 0.035
        });
        added++;
      }
    }

    // ---- removing a straw ------------------------------------------------
    function removeStraw(i) {
      const slot = slotOf[i];
      if (slot < 0) return false;
      const last = liveCount - 1;
      if (slot !== last) {
        const moved = strawOf[last];
        strawOf[slot] = moved;
        slotOf[moved] = slot;
        writeSlot(slot, moved);
        strawMesh.instanceMatrix.addUpdateRange(slot * 16, 16);
        strawMesh.instanceMatrix.needsUpdate = true;
        if (strawMesh.instanceColor) {
          strawMesh.instanceColor.addUpdateRange(slot * 3, 3);
          strawMesh.instanceColor.needsUpdate = true;
        }
        swayAttr.addUpdateRange(slot, 1);
        swayAttr.needsUpdate = true;
      }
      slotOf[i] = -1;
      liveCount = last;
      strawMesh.count = liveCount;
      removedBits[i >> 3] |= 1 << (i & 7);
      pulled++;
      dirty = true;
      return true;
    }

    function warmthAt(x, y, z) {
      const d = Math.hypot(x - needlePos.x, y - needlePos.y, z - needlePos.z);
      return { d: d, w: clamp(1 - (d - 0.30) / (W_RANGE - 0.30), 0, 1) };
    }

    function pullStraw(i, now) {
      const px = sPos[i * 3], py = sPos[i * 3 + 1], pz = sPos[i * 3 + 2];
      launchStraw(i);
      if (!removeStraw(i)) return;
      shakeNeighbours(px, py, pz);

      const hot = warmthAt(px, py, pz);
      if (hot.w > warmNow) warmNow = hot.w;
      if (hot.w > warmBest) warmBest = hot.w;

      const tier = hot.d < W_BURNING ? 3 : hot.d < W_HOT ? 2 : hot.d < W_WARM ? 1 : 0;
      if (tier >= 1) {
        // Warm hay throws a brighter, redder puff — a second channel of the hint.
        spawnPuff(px, py, pz, 3 + tier, 1.0, 0.55 - tier * 0.10, 0.16, 0.8);
        if (tier >= 2 && now - lastTingAt > 420) {
          lastTingAt = now;
          sfx(SND.ting, tier === 3 ? 0.4 : 0.24);
        }
        if (tier >= 1 && !sawWarm) {
          sawWarm = true;
          toast("Something in the hay is warm.", "🌡️", 2400);
          haptic("medium");
          try { ctx.platform.milestone("first_warm", { pulled: pulled }); } catch (_) {}
        }
        if (tier >= 2 && !sawHot) {
          sawHot = true;
          toast("Very warm. It is right around here.", "🔥", 2400);
          haptic("warning");
          try { ctx.platform.milestone("first_hot", { pulled: pulled }); } catch (_) {}
        }
      } else {
        spawnPuff(px, py, pz, 3, 0.55, 0.42, 0.20, 0.6);
      }

      rustle(now, 0.20 + Math.random() * 0.14);
      if (pulled % 12 === 0) haptic("light");

      if (pulled % 25 === 0) {
        try { ctx.platform.interact({ type: "pull", pulled: pulled }); } catch (_) {}
      }
      if (pulled % 50 === 0) {
        try { ctx.platform.setProgress(clamp(pulled / STRAW_COUNT, 0, 1), { pulled: pulled }); } catch (_) {}
      }
      if (pulled % 1000 === 0) {
        try { ctx.platform.milestone("thousand", { pulled: pulled }); } catch (_) {}
        toast(fmtNum(pulled) + " straws gone. Still no needle.", "🌾", 2000);
      }
      updateHud();
    }
    let lastTingAt = -1e9;

    function findJunk(k, now) {
      const dc = decoys[k];
      if (dc.found) return;
      dc.found = true;
      junkFound++;
      dirty = true;
      scene.remove(dc.mesh);
      scene.remove(dc.spark);
      spawnPuff(dc.pos.x, dc.pos.y, dc.pos.z, 16, 1.0, 0.86, 0.5, 1.5);
      sfx(SND.thud, 0.5);
      haptic("warning");
      try { ctx.music.sting("fail"); } catch (_) {}
      try { ctx.platform.interact({ type: "junk", name: dc.name }); } catch (_) {}
      try { ctx.platform.milestone("junk", { found: junkFound }); } catch (_) {}
      toast(dc.msg, "🔩", 3400);
      updateHud();
    }

    // =======================================================================
    // 12. INPUT — orbit, pinch, and the dig
    // =======================================================================
    let camAz = 0.7, camEl = 0.40, camDist = 25.5, camTgtY = 3.6;
    let tAz = camAz, tEl = camEl, tDist = camDist, tTgtY = camTgtY;

    const pointers = new Map();
    let mode = "none";
    let pressId = -1, pressT0 = 0, pressX = 0, pressY = 0;
    let digX = 0, digY = 0, nextPullAt = 0;
    let pinchD0 = 0, pinchDist0 = 0, pinchMidY = 0, pinchTgtY0 = 0;
    const DRAG_PX = 12;

    let hoverStraw = -1;
    const marker = new THREE.Mesh(
      makeStrawGeo(),
      new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.55, depthTest: false })
    );
    marker.renderOrder = 5;
    marker.visible = false;
    marker.scale.set(1.8, 1, 1.8);
    scene.add(marker);

    function showMarker(i) {
      if (i < 0) { marker.visible = false; hoverStraw = -1; return; }
      hoverStraw = i;
      marker.position.set(sPos[i * 3], sPos[i * 3 + 1], sPos[i * 3 + 2]);
      _d.set(sDir[i * 3], sDir[i * 3 + 1], sDir[i * 3 + 2]);
      marker.quaternion.setFromUnitVectors(UP, _d);
      marker.scale.set(1.9, sHalf[i] * 2 * 1.08, 1.9);
      marker.visible = true;
    }

    function beginPlay() {
      if (started) return;
      started = true;
      try { ctx.platform.start(); } catch (_) {}
      startMusic();
    }

    // One place where a screen point becomes a consequence.
    // `deliberate` is true only for a real tap, never for the burrow's repeat.
    let blockedToldAt = -1e9;
    function actAt(cx, cy, now, deliberate) {
      if (won) return;
      rayFromScreen(cx, cy);
      const hit = pickAny(deliberate ? NEEDLE_TAP : NEEDLE_DIG);
      if (hit.kind === "needle") {
        if (deliberate) { winGame(now); return; }
        // Burrowing stalls on it: you cannot pull a needle out by the handful.
        // The glint does the talking; claiming it has to be a decision.
        needleStalled = true;
        if (now - blockedToldAt > 6000) {
          blockedToldAt = now;
          haptic("heavy");
          sfx(SND.ting, 0.55);
          toast("Your hand closes on something that is not hay.", "🪡", 2600);
        }
        return;
      }
      needleStalled = false;
      if (hit.kind === "decoy") { findJunk(hit.i, now); return; }
      if (hit.kind === "straw" && hit.i >= 0) pullStraw(hit.i, now);
    }
    let needleStalled = false;

    function localXY(ev) {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function onDown(ev) {
      if (!started) return;
      const p = localXY(ev);
      pointers.set(ev.pointerId, { x: p.x, y: p.y });

      if (pointers.size === 1) {
        pressId = ev.pointerId;
        pressT0 = performance.now();
        pressX = p.x; pressY = p.y;
        digX = p.x; digY = p.y;
        if (won) {
          // The hunt is over — a single finger only turns the camera now.
          mode = "orbit";
          return;
        }
        mode = "press";
        rayFromScreen(p.x, p.y);
        const hit = pickAny();
        showMarker(hit.kind === "straw" ? hit.i : -1);
      } else if (pointers.size === 2) {
        mode = "gesture";
        marker.visible = false;
        const it = Array.from(pointers.values());
        pinchD0 = Math.hypot(it[0].x - it[1].x, it[0].y - it[1].y) || 1;
        pinchDist0 = tDist;
        pinchMidY = (it[0].y + it[1].y) * 0.5;
        pinchTgtY0 = tTgtY;
      }
    }

    function onMove(ev) {
      const rec = pointers.get(ev.pointerId);
      if (!rec) return;
      const p = localXY(ev);
      const dx = p.x - rec.x, dy = p.y - rec.y;
      rec.x = p.x; rec.y = p.y;

      if (mode === "gesture" && pointers.size >= 2) {
        const it = Array.from(pointers.values());
        const d = Math.hypot(it[0].x - it[1].x, it[0].y - it[1].y) || 1;
        tDist = clamp(pinchDist0 * (pinchD0 / d), 3.6, 40);
        const midY = (it[0].y + it[1].y) * 0.5;
        tTgtY = clamp(pinchTgtY0 + (midY - pinchMidY) * 0.022, 0.25, STACK_H * 0.98);
        return;
      }
      if (ev.pointerId !== pressId) return;

      if (mode === "press") {
        if (Math.hypot(p.x - pressX, p.y - pressY) > DRAG_PX) {
          mode = "orbit";
          marker.visible = false;
        }
      }
      if (mode === "orbit") {
        tAz -= dx * 0.0072;
        tEl = clamp(tEl + dy * 0.0055, 0.06, 1.35);
      } else if (mode === "dig") {
        // Sliding while burrowing steers the shaft instead of orbiting.
        digX = p.x; digY = p.y;
      }
    }

    function endPointer(ev) {
      const had = pointers.has(ev.pointerId);
      pointers.delete(ev.pointerId);
      if (!had) return;

      if (ev.pointerId === pressId) {
        const now = performance.now();
        if (mode === "press" && now - pressT0 < 300) actAt(pressX, pressY, now, true);
        else if (won && mode === "orbit" && now - pressT0 < 300) {
          // A tap while admiring the needle brings the result back.
          const p = localXY(ev);
          if (Math.hypot(p.x - pressX, p.y - pressY) <= DRAG_PX) el.pWin.classList.remove("hide");
        }
        marker.visible = false;
        pressId = -1;
      }
      if (pointers.size === 0) mode = "none";
      else if (pointers.size === 1) {
        // Dropping to one finger after a pinch must not fire a stray pull.
        mode = "orbit";
        const only = Array.from(pointers.entries())[0];
        pressId = only[0];
        pressX = only[1].x; pressY = only[1].y;
      }
    }

    ctx.listen(canvas, "pointerdown", (ev) => { ev.preventDefault(); onDown(ev); }, { passive: false });
    ctx.listen(window, "pointermove", onMove, { passive: true });
    ctx.listen(window, "pointerup", endPointer, { passive: true });
    ctx.listen(window, "pointercancel", endPointer, { passive: true });
    ctx.listen(canvas, "contextmenu", (ev) => ev.preventDefault(), { passive: false });
    ctx.listen(canvas, "wheel", (ev) => {
      ev.preventDefault();
      tDist = clamp(tDist * (1 + Math.sign(ev.deltaY) * 0.10), 3.6, 40);
    }, { passive: false });

    function digInterval(heldMs) {
      const k = clamp((heldMs - HOLD_FIRST_MS) / HOLD_RAMP_MS, 0, 1);
      return lerp(HOLD_SLOW_MS, HOLD_FAST_MS, k);
    }

    // =======================================================================
    // 13. HUD
    // =======================================================================
    let toastTimer = null;
    function toast(text, lead, ms) {
      el.toast.innerHTML = (lead ? '<span class="lead">' + lead + "</span>" : "") + text;
      el.toast.classList.add("on");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.classList.remove("on"); }, ms || 2400);
    }

    let lastClock = -1, lastCount = -1, lastJunk = -1;
    function updateHud() {
      if (liveCount !== lastCount) {
        lastCount = liveCount;
        el.count.textContent = fmtNum(liveCount);
      }
      if (junkFound !== lastJunk) {
        lastJunk = junkFound;
        el.junk.textContent = String(junkFound);
      }
      const sec = Math.floor(elapsedMs / 1000);
      if (sec !== lastClock) {
        lastClock = sec;
        el.clock.textContent = fmtTime(elapsedMs);
      }
    }

    const TIER_NAMES = ["cold", "warm", "hot", "burning"];
    let lastTierShown = -1;
    function updateWarmUi() {
      const on = warmNow > 0.02;
      el.warm.classList.toggle("on", on);
      el.warmFill.style.transform = "scaleX(" + warmNow.toFixed(3) + ")";
      el.warmBest.style.left = (warmBest * 100).toFixed(1) + "%";
      const tier = warmNow > 0.86 ? 3 : warmNow > 0.62 ? 2 : warmNow > 0.18 ? 1 : 0;
      if (tier !== lastTierShown) {
        lastTierShown = tier;
        el.warmLbl.textContent = TIER_NAMES[tier];
      }
      warmTier = tier;
    }

    let hintTimer = null;
    function hint(text, ms) {
      el.hint.textContent = text;
      el.hint.classList.add("on");
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => el.hint.classList.remove("on"), ms || 4200);
    }

    // =======================================================================
    // 14. SAVE / RESUME
    // =======================================================================
    function b64FromBytes(bytes) {
      let bin = "";
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
      }
      return btoa(bin);
    }
    function bytesFromB64(str) {
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }

    function snapshot() {
      let junkMask = 0;
      for (let k = 0; k < decoys.length; k++) if (decoys[k].found) junkMask |= (1 << decoys[k].idx);
      return {
        v: SAVE_VER,
        fseed: fieldSeed,
        seed: layoutSeed,
        pseed: placeSeed,
        pulled: pulled,
        ms: Math.round(elapsedMs),
        junk: junkMask,
        wb: Math.round(warmBest * 1000) / 1000,
        won: won,
        cam: [
          Math.round(tAz * 1000) / 1000,
          Math.round(tEl * 1000) / 1000,
          Math.round(tDist * 100) / 100,
          Math.round(tTgtY * 100) / 100
        ],
        bits: b64FromBytes(removedBits)
      };
    }

    let lastRemoteSave = 0;
    async function persist(force) {
      const data = snapshot();
      if (canStore) {
        try { await Promise.resolve(ctx.storage.set(SAVE_KEY, data)); } catch (_) {}
      }
      const now = performance.now();
      // The platform channel is the cross-device copy; it does not need to see
      // every autosave tick — unless it is the only copy we have.
      if (force || !canStore || now - lastRemoteSave > 60000) {
        lastRemoteSave = now;
        try { await ctx.memory.local("dig").set(data); } catch (_) {}
      }
      dirty = false;
    }

    function applySave(s) {
      if (!s) return;
      let bytes = null;
      try { bytes = s.bits ? bytesFromB64(s.bits) : null; } catch (_) { bytes = null; }
      if (bytes && bytes.length === removedBits.length) removedBits.set(bytes);
      pulled = Math.max(0, s.pulled | 0);
      elapsedMs = Math.max(0, s.ms || 0);
      warmBest = clamp(s.wb || 0, 0, 1);
      const mask = s.junk | 0;
      for (let k = 0; k < decoys.length; k++) {
        if (mask & (1 << decoys[k].idx)) {
          decoys[k].found = true;
          junkFound++;
          scene.remove(decoys[k].mesh);
          scene.remove(decoys[k].spark);
        }
      }
      if (Array.isArray(s.cam) && s.cam.length === 4) {
        tAz = camAz = s.cam[0];
        tEl = camEl = clamp(s.cam[1], 0.06, 1.35);
        tDist = camDist = clamp(s.cam[2], 3.6, 40);
        tTgtY = camTgtY = clamp(s.cam[3], 0.25, STACK_H * 0.98);
      }
    }

    async function clearSave() {
      if (canStore) { try { await Promise.resolve(ctx.storage.remove(SAVE_KEY)); } catch (_) {} }
      try { await ctx.memory.local("dig").set({ v: SAVE_VER, seed: 0, cleared: true }); } catch (_) {}
    }

    // =======================================================================
    // 15. MUSIC
    // =======================================================================
    let musicHandle = null;
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);

    function startMusic() {
      if (!canMusic || !soundOn || musicHandle) return;
      try {
        ctx.music.unlock();
        musicHandle = ctx.music.play({
          preset: "cozy",
          scale: "pentatonic",
          volume: 0.30,
          tempo: 72,
          intensity: 0.30,
          density: 0.35,
          fadeInMs: 2600
        });
      } catch (_) { musicHandle = null; }
    }

    function setSound(on) {
      soundOn = on;
      el.bSound.textContent = on ? "♪" : "✕";
      el.bSound.classList.toggle("off", !on);
      if (!on) {
        try { ctx.music.stop({ fadeOutMs: 400 }); } catch (_) {}
        try { ctx.audio.stopAll(); } catch (_) {}
        musicHandle = null;
      } else if (started) {
        startMusic();
      }
    }

    // =======================================================================
    // 16. LEADERBOARD
    // =======================================================================
    function lbRowsFrom(res) {
      if (!res) return [];
      if (Array.isArray(res)) return res;
      return res.entries || res.rows || res.leaderboard || res.results || res.items || [];
    }
    function lbName(row) {
      return row.displayName || row.name || row.username || row.handle ||
             (row.user && (row.user.displayName || row.user.name || row.user.username)) || "someone";
    }
    function lbValue(row) {
      const v = row.value !== undefined ? row.value : (row.score !== undefined ? row.score : row.amount);
      return typeof v === "number" ? fmtNum(v) : (row.label || "—");
    }

    async function showLeaderboard() {
      el.pLb.classList.remove("hide");
      el.lbRows.innerHTML = '<div class="ls-empty">Counting other people’s straws…</div>';
      let rows = [];
      try {
        const res = await ctx.memory.record("fewest_straws").leaderboard({ scope: "global", period: "all_time" });
        rows = lbRowsFrom(res);
      } catch (_) { rows = []; }

      if (!rows.length) {
        el.lbRows.innerHTML =
          '<div class="ls-empty">Nobody has finished a haystack yet. Or the scores are still on their way. Either way: dig.</div>';
        return;
      }
      const html = rows.slice(0, 10).map((row, k) => {
        const me = !!(row.isMe || row.isSelf || row.self || row.me);
        return '<div class="ls-row' + (me ? " me" : "") + '">' +
               '<span class="rk">' + (row.rank || k + 1) + "</span>" +
               '<span class="nm"></span>' +
               '<span class="vl"></span></div>';
      }).join("");
      el.lbRows.innerHTML = html;
      // Names come from other users — write them as text, never as markup.
      const nodes = el.lbRows.querySelectorAll(".ls-row");
      rows.slice(0, 10).forEach((row, k) => {
        if (!nodes[k]) return;
        nodes[k].querySelector(".nm").textContent = String(lbName(row));
        nodes[k].querySelector(".vl").textContent = String(lbValue(row));
      });
    }

    // =======================================================================
    // 17. WINNING
    // =======================================================================
    const VERDICTS = [
      { under: 1200, text: "You found it in {n} straws. Statistically that is luck. Emotionally, that is now a personality trait." },
      { under: 3500, text: "{n} straws in {t}. A clean, respectable dig. Nobody is ever going to ask you about it." },
      { under: 7000, text: "{n} straws in {t}. Somewhere around the four thousandth one this stopped being a search and became a grudge." },
      { under: 1e9,  text: "{n} straws. You did not find a needle in a haystack — you deleted a haystack and the needle was the only thing left standing." }
    ];
    const KICKERS = [
      "It is a needle. It is thirty-four millimetres long. It does not do anything.",
      "The needle has been in there the whole time. It was fine. It was never worried.",
      "Somewhere a farmer is wondering what happened to their haystack.",
      "You may now put the needle down and rejoin your life, which continued without you."
    ];

    let winAnim = -1;
    const winCamFrom = new THREE.Vector3();

    function winGame(now) {
      if (won) return;
      // Snapshot the score before the celebration clears hay on the player's
      // behalf — those straws are not straws they pulled.
      const straws = pulled;
      won = true;
      winAnim = 0;
      winCamFrom.copy(camera.position);
      // Push in along the line we are already on, stopping just short of it.
      winCamTo.copy(winCamFrom).sub(needlePos);
      if (winCamTo.lengthSq() < 1e-6) winCamTo.set(0, 1, 1);
      winCamTo.normalize().multiplyScalar(2.5).add(needlePos);
      winCamTo.y += 0.35;
      // Hand the free-orbit the pose the fly-in ends on, otherwise the camera
      // snaps back out to the old dig distance the moment the animation stops.
      const offX = winCamTo.x - needlePos.x, offY = winCamTo.y - needlePos.y, offZ = winCamTo.z - needlePos.z;
      const offLen = Math.max(0.001, Math.hypot(offX, offY, offZ));
      tDist = camDist = offLen;
      tEl = camEl = Math.asin(clamp(offY / offLen, -1, 1));
      tAz = camAz = Math.atan2(offZ, offX);
      marker.visible = false;
      mode = "none";
      pointers.clear();

      // Blow the hay off the prize.
      const clearList = [];
      for (let slot = 0; slot < liveCount; slot++) {
        const i = strawOf[slot];
        const dx = sPos[i * 3] - needlePos.x;
        const dy = sPos[i * 3 + 1] - needlePos.y;
        const dz = sPos[i * 3 + 2] - needlePos.z;
        if (dx * dx + dy * dy + dz * dz < 2.6 * 2.6) clearList.push(i);
      }
      for (let k = 0; k < clearList.length; k++) {
        if (k < FLY_MAX) launchStraw(clearList[k]);
        removeStraw(clearList[k]);
      }
      spawnPuff(needlePos.x, needlePos.y, needlePos.z, 90, 1.0, 0.9, 0.62, 2.6);

      haptic("success");
      sfx(SND.chime, 0.7);
      try { ctx.music.sting("win"); } catch (_) {}
      try { ctx.music.setIntensity(0.7); } catch (_) {}

      const ms = Math.round(elapsedMs);
      try { ctx.platform.setProgress(1, { pulled: straws }); } catch (_) {}
      try { ctx.platform.complete({ straws: straws, ms: ms, junk: junkFound }); } catch (_) {}
      try { ctx.memory.record("fewest_straws").submit(straws, { label: fmtNum(straws) + " straws" }); } catch (_) {}
      try { ctx.memory.record("fastest_find").submit(ms, { label: fmtTime(ms) }); } catch (_) {}
      persist(true);

      const v = VERDICTS.find((x) => straws < x.under) || VERDICTS[VERDICTS.length - 1];
      el.sStraws.textContent = fmtNum(straws);
      el.sTime.textContent = fmtTime(ms);
      el.sJunk.textContent = junkFound + "/" + DECOY_COUNT;
      el.verdict.textContent = v.text.replace("{n}", fmtNum(straws)).replace("{t}", fmtTime(ms));
      let kick = KICKERS[straws % KICKERS.length];
      if (junkFound > 0) {
        kick += " You also recovered " + junkFound + " piece" + (junkFound === 1 ? "" : "s") +
                " of genuine rubbish, which you may keep.";
      }
      el.kicker.textContent = kick;

      setTimeout(() => { el.pWin.classList.remove("hide"); }, 1900);
    }

    // A fresh haystack is rebuilt in place — the bit never reloads its host.
    // The field keeps its seed, so it still reads as the same place.
    async function resetRun() {
      await clearSave();

      layoutSeed = rand32();
      placeSeed = rand32();
      generateStraws(layoutSeed);
      placeAll(placeSeed);

      won = false;
      winAnim = -1;
      needleStalled = false;
      pulled = 0;
      elapsedMs = 0;
      junkFound = 0;
      warmNow = 0; warmBest = 0; lastTierShown = -1; lastWarmDrawn = -1;
      lastCount = -1; lastJunk = -1; lastClock = -1;
      sawWarm = false; sawHot = false;
      removedBits.fill(0);
      flying.length = 0;
      jiggles.length = 0;
      flyMesh.count = 0;
      marker.visible = false;
      mode = "none";
      pointers.clear();

      buildStack(null);
      tAz = camAz = 0.7; tEl = camEl = 0.40;
      tDist = camDist = 25.5; tTgtY = camTgtY = 3.6;

      el.pWin.classList.add("hide");
      el.pHelp.classList.add("hide");
      updateHud();
      updateWarmUi();
      try { ctx.platform.setProgress(0, { pulled: 0 }); } catch (_) {}
      await persist(true);
      toast("A new needle is in there somewhere. Sorry.", "🪡", 2800);
    }

    // =======================================================================
    // 18. FRAME LOOP
    // =======================================================================
    let vw = ctx.width, vh = ctx.height;
    // 26,000 instanced straws is a lot of geometry for a weak GPU. Watch the
    // real frame cost and drop the pixel ratio once rather than shipping a
    // slideshow; never raise it back, to avoid oscillating.
    let dprHigh = Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2);
    let slowFrames = 0, dprDropped = false;
    let glintCheckAt = 0, decoyCheckIdx = 0, lastGlintChime = -1e9;
    let needleVisible = false, needleGlow = 0;
    let autoSaveAt = 0;
    let lastWarmDrawn = -1;
    const winCamTo = new THREE.Vector3();
    const _fwd = new THREE.Vector3();
    const _q2 = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const orbitC = new THREE.Vector3();

    function placeCamera() {
      if (won) orbitC.copy(needlePos);
      else orbitC.set(0, camTgtY, 0);
      const ce = Math.cos(camEl), se = Math.sin(camEl);
      camera.position.set(
        orbitC.x + Math.cos(camAz) * ce * camDist,
        Math.max(0.5, orbitC.y + se * camDist),
        orbitC.z + Math.sin(camAz) * ce * camDist
      );
      camera.lookAt(orbitC);
    }

    ctx.onFrame((dtMs, timeMs) => {
      const now = performance.now();
      const dt = Math.min(dtMs || 16, 60) / 1000;

      // ---- viewport ----
      if (ctx.width !== vw || ctx.height !== vh) {
        vw = ctx.width; vh = ctx.height;
        fitCamera(vw, vh);
        dprHigh = Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2);
        renderer.setPixelRatio(dprDropped ? 1 : dprHigh);
        renderer.setSize(vw, vh, false);
      }

      if (started && !won) elapsedMs += dtMs || 16;

      // ---- burrowing ----
      if (started && !won && pressId >= 0) {
        const held = now - pressT0;
        if (mode === "press" && held >= HOLD_FIRST_MS) {
          mode = "dig";
          actAt(digX, digY, now, false);
          nextPullAt = now + digInterval(held);
        } else if (mode === "dig" && now >= nextPullAt) {
          actAt(digX, digY, now, false);
          nextPullAt = now + digInterval(held);
        }
        if (mode === "dig" && !won) {
          rayFromScreen(digX, digY);
          const hit = pickAny(NEEDLE_DIG);
          showMarker(hit.kind === "straw" ? hit.i : -1);
        }
      }

      // ---- camera ----
      const k = 1 - Math.exp(-dt * 12);
      camAz += (tAz - camAz) * k;
      camEl += (tEl - camEl) * k;
      camDist += (tDist - camDist) * k;
      camTgtY += (tTgtY - camTgtY) * k;

      if (winAnim >= 0 && winAnim < 2.4) {
        winAnim += dt;
        const p = smoothstep(0, 1, clamp(winAnim / 2.2, 0, 1));
        camera.position.lerpVectors(winCamFrom, winCamTo, p);
        camera.lookAt(needlePos);
      } else {
        placeCamera();
      }

      // A soft lamp just ahead of the eye, so a fresh shaft is a tunnel and
      // not a black hole.
      camera.getWorldDirection(_fwd);
      lamp.position.copy(camera.position).addScaledVector(_fwd, 2.2);
      lamp.intensity = smoothstep(17, 8, camDist) * 1.7;

      windU.value = (timeMs || now) * 0.001;

      // ---- straws in flight ----
      if (flying.length) {
        let n = 0;
        for (let i = flying.length - 1; i >= 0; i--) {
          const f = flying[i];
          f.t += dt;
          if (f.t >= f.life) { flying.splice(i, 1); continue; }
          f.vy -= 9.4 * dt;
          f.px += f.vx * dt; f.py += f.vy * dt; f.pz += f.vz * dt;
        }
        for (let i = 0; i < flying.length && i < FLY_MAX; i++) {
          const f = flying[i];
          const fade = 1 - smoothstep(f.life * 0.55, f.life, f.t);
          _d.set(f.dx, f.dy, f.dz);
          _q.setFromUnitVectors(UP, _d);
          _e.set(f.rx * f.t, 0, f.rz * f.t);
          _q2.setFromEuler(_e);
          _q.premultiply(_q2);
          _v.set(f.px, f.py, f.pz);
          _s.set(fade, f.half * 2 * fade, fade);
          _m.compose(_v, _q, _s);
          flyMesh.setMatrixAt(n, _m);
          _c.setRGB(f.cr, f.cg, f.cb);
          flyMesh.setColorAt(n, _c);
          n++;
        }
        flyMesh.count = n;
        flyMesh.instanceMatrix.needsUpdate = true;
        if (flyMesh.instanceColor) flyMesh.instanceColor.needsUpdate = true;
      } else if (flyMesh.count !== 0) {
        flyMesh.count = 0;
      }

      // ---- settling neighbours ----
      for (let i = jiggles.length - 1; i >= 0; i--) {
        const j = jiggles[i];
        const slot = slotOf[j.i];
        if (slot < 0) { jiggles.splice(i, 1); continue; }
        j.t += dt;
        if (j.t >= j.life) {
          writeSlot(slot, j.i);
          strawMesh.instanceMatrix.addUpdateRange(slot * 16, 16);
          strawMesh.instanceMatrix.needsUpdate = true;
          jiggles.splice(i, 1);
          continue;
        }
        const p = j.t / j.life;
        const amp = (1 - p) * Math.sin(p * 32);
        writeSlotOffset(slot, j.i, j.ax * amp, j.ay * amp, j.az * amp);
      }

      // ---- chaff and puffs ----
      let anyPuff = false;
      for (let i = 0; i < PUFF_N; i++) {
        if (puffLife[i] <= 0) continue;
        anyPuff = true;
        puffLife[i] -= dt;
        const a = Math.max(0, puffLife[i] / puffMax[i]);
        puffVel[i * 3 + 1] -= 1.35 * dt;
        const drag = 1 - 1.7 * dt;
        puffVel[i * 3] *= drag; puffVel[i * 3 + 1] *= drag; puffVel[i * 3 + 2] *= drag;
        puffPos[i * 3] += puffVel[i * 3] * dt;
        puffPos[i * 3 + 1] += puffVel[i * 3 + 1] * dt;
        puffPos[i * 3 + 2] += puffVel[i * 3 + 2] * dt;
        // Additive blending means fading the colour to black fades the particle.
        const g = a * a;
        puffCol[i * 3] = puffTint[i * 3] * g;
        puffCol[i * 3 + 1] = puffTint[i * 3 + 1] * g;
        puffCol[i * 3 + 2] = puffTint[i * 3 + 2] * g;
        if (puffLife[i] <= 0) { puffCol[i * 3] = 0; puffCol[i * 3 + 1] = 0; puffCol[i * 3 + 2] = 0; }
      }
      if (anyPuff) {
        puffs.geometry.attributes.position.needsUpdate = true;
        puffs.geometry.attributes.color.needsUpdate = true;
      }

      for (let i = 0; i < MOTE_N; i++) {
        motePos[i * 3] += moteVel[i * 3] * dt;
        motePos[i * 3 + 1] += moteVel[i * 3 + 1] * dt;
        motePos[i * 3 + 2] += moteVel[i * 3 + 2] * dt;
        if (motePos[i * 3 + 1] > 13) {
          const a = Math.random() * TAU, r = 1.5 + Math.random() * 13;
          motePos[i * 3] = Math.cos(a) * r;
          motePos[i * 3 + 1] = -0.4;
          motePos[i * 3 + 2] = Math.sin(a) * r;
        }
      }
      motes.geometry.attributes.position.needsUpdate = true;

      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        b.a += b.sp * dt;
        b.sprite.position.set(b.cx + Math.cos(b.a) * b.r, b.y + Math.sin(b.a * 2.3) * 1.6, b.cz + Math.sin(b.a) * b.r);
      }

      // ---- glints ----
      if (now > glintCheckAt) {
        glintCheckAt = now + 240;
        needleVisible = !won && hasLineOfSight(needlePos);
        if (decoys.length) {
          decoyCheckIdx = (decoyCheckIdx + 1) % decoys.length;
          const dc = decoys[decoyCheckIdx];
          dc.vis = !dc.found && hasLineOfSight(dc.pos);
        }
        const anyVis = needleVisible || decoys.some((d) => d.vis && !d.found);
        if (anyVis && now - lastGlintChime > 9000) {
          lastGlintChime = now;
          sfx(SND.chime, 0.3);
        }
      }
      needleGlow += ((needleVisible || needleStalled || won ? 1 : 0) - needleGlow) * (1 - Math.exp(-dt * 5));
      const pulse = 0.55 + 0.45 * Math.sin((timeMs || now) * 0.005);
      glint.material.opacity = needleGlow * pulse * (won ? 1 : 0.9);
      glint.scale.setScalar(lerp(0.7, 1.5, pulse) * (won ? 2.1 : 1));
      for (let i = 0; i < decoys.length; i++) {
        const dc = decoys[i];
        const want = dc.vis && !dc.found ? 1 : 0;
        dc.spark.material.opacity += (want * pulse * 0.85 - dc.spark.material.opacity) * (1 - Math.exp(-dt * 5));
      }

      // ---- warmth ----
      if (warmNow > 0) warmNow = Math.max(0, warmNow - dt / 2.6);
      if (Math.abs(warmNow - lastWarmDrawn) > 0.004) {
        lastWarmDrawn = warmNow;
        updateWarmUi();
      }

      // ---- clock and autosave ----
      if (!dprDropped && dprHigh > 1) {
        if (dtMs > 27) { if (++slowFrames > 90) { dprDropped = true; renderer.setPixelRatio(1); renderer.setSize(vw, vh, false); } }
        else if (slowFrames > 0) slowFrames--;
      }

      if (started) updateHud();
      if (dirty && now > autoSaveAt) {
        autoSaveAt = now + 4000;
        persist(false);
      }

      renderer.render(scene, camera);
    });

    // =======================================================================
    // 19. BOOT
    // =======================================================================
    if (save) applySave(save);
    buildStack(removedBits);
    updateHud();
    updateWarmUi();
    placeCamera();               // frame the shot before the first pixel
    renderer.render(scene, camera);
    booted = true;
    ctx.markVisualReady("scene");

    if (resuming) {
      el.resume.style.display = "inline-flex";
      el.resume.textContent = "🌾 " + fmtNum(liveCount) + " straws left · " + fmtTime(elapsedMs) + " spent";
      el.cta.textContent = "Resume the dig";
      el.lFresh.style.display = "inline-block";
      try { ctx.platform.setProgress(clamp(pulled / STRAW_COUNT, 0, 1), { pulled: pulled }); } catch (_) {}
    } else {
      el.cta.textContent = "Start digging";
    }
    el.cta.classList.remove("wait");
    el.load.style.display = "none";
    safeReady();

    function closeIntro() {
      el.pIntro.classList.add("hide");
      beginPlay();
      hint(resuming ? "Welcome back. It is still in there." : "Tap a straw to pull it. Hold to burrow.", 5200);
    }

    ctx.listen(el.cta, "click", closeIntro);
    ctx.listen(el.lFresh, "click", async () => {
      el.lFresh.style.display = "none";
      el.resume.style.display = "none";
      await resetRun();
      closeIntro();
    });

    ctx.listen(el.bHelp, "click", () => { el.pHelp.classList.remove("hide"); });
    ctx.listen($(".c-back"), "click", () => { el.pHelp.classList.add("hide"); });
    ctx.listen($(".l-restart"), "click", async () => {
      el.pHelp.classList.add("hide");
      await resetRun();
    });
    ctx.listen(el.bLb, "click", () => { showLeaderboard(); });
    ctx.listen($(".c-back2"), "click", () => { el.pLb.classList.add("hide"); });
    ctx.listen($(".c-again"), "click", async () => { await resetRun(); });
    ctx.listen($(".l-look"), "click", () => {
      el.pWin.classList.add("hide");
      hint("There it is. A needle. Drag to admire it.", 5000);
    });
    ctx.listen(el.bSound, "click", () => { setSound(!soundOn); });

    // Persist whenever the bit is backgrounded or torn down.
    ctx.listen(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden" && (dirty || won)) persist(true);
    });
    ctx.listen(window, "pagehide", () => { if (dirty || won) persist(true); });

    ctx.onDestroy(() => {
      try { if (dirty) persist(true); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 200 }); } catch (_) {}
      try { ctx.audio.stopAll(); } catch (_) {}
      if (toastTimer) clearTimeout(toastTimer);
      if (hintTimer) clearTimeout(hintTimer);
      try { renderer.dispose(); } catch (_) {}
      try {
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
          else if (m && m.dispose) m.dispose();
        });
      } catch (_) {}
    });

    } catch (err) {
      fatal("boot", err);
    }
  }
};
