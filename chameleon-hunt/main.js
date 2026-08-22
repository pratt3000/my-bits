/*
 * Chameleon Hunt
 * A 1-player mobile 3D hide-and-seek game inspired by "Meccha Chameleon".
 * You are always the Seeker ("Denner"): hidden humanoids are camouflaged
 * into the walls and furniture of five themed arenas. Move with the left
 * touch joystick, look with the right half of the screen, and tap a
 * suspicious shape to accuse it. Wrong accusations cost time.
 *
 * Runtime:  plethora-bit@2  (window.plethoraBit)
 * Renderer: three@0.164.1 (ES module via ctx.importModule)
 * Audio:    ctx.music preset beds + procedurally synthesized WebAudio SFX
 *           (the runtime denies arbitrary network audio, so everything is
 *           generated in code — no external files).
 * Storage:  ctx.storage for progression + local per-arena leaderboards,
 *           ctx.memory records for platform per-arena best-time boards.
 */

window.plethoraBit = {
  meta: {
    title: "Chameleon Hunt",
    runtime: "plethora-bit@2",
    tags: ["3d", "hide-and-seek", "camouflage", "seeker", "arcade", "mobile"],
    permissions: ["haptics", "backgroundMusic", "audio", "storage"]
  },

  async init(ctx) {
    "use strict";

    // =====================================================================
    // 1. Surfaces, CSS, DOM skeleton. The menu is DOM so the first frame is
    //    visible instantly while three.js streams in behind it.
    // =====================================================================
    const canvas = ctx.createCanvas({ touchAction: "none" });
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.pointerEvents = "none";

    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    const style = document.createElement("style");
    style.textContent = `
      .ch-ui { position:absolute; inset:0; overflow:hidden;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#f2f7f4;
        -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
      .ch-ui * { box-sizing:border-box; }
      .ch-bg { position:absolute; inset:0; background:
        radial-gradient(130% 100% at 50% 0%, #21503a 0%, #16352a 48%, #0b1d16 100%); }
      .ch-screen { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
        justify-content:center; padding:22px; text-align:center; pointer-events:auto; }
      .ch-hidden { display:none !important; }

      .ch-logo { font-size:64px; line-height:1; filter:drop-shadow(0 8px 22px rgba(0,0,0,.45)); }
      .ch-title { font-size:38px; font-weight:800; letter-spacing:.5px; margin:8px 0 4px;
        text-shadow:0 2px 18px rgba(0,40,20,.65); }
      .ch-tag { font-size:14px; opacity:.88; line-height:1.5; max-width:300px; margin-bottom:22px; }
      .ch-btn { pointer-events:auto; display:block; width:min(280px,78vw); margin:0 auto 12px; padding:14px 20px;
        border-radius:999px; border:none; font-size:17px; font-weight:800; letter-spacing:.3px; cursor:pointer;
        color:#0d2313; background:linear-gradient(180deg,#b7f2a8,#77d477); box-shadow:0 8px 24px rgba(90,200,120,.35);
        transition:transform .12s ease; }
      .ch-btn:active { transform:scale(.95); }
      .ch-btn.ghost { background:rgba(255,255,255,.09); color:#eafff0; border:1px solid rgba(255,255,255,.25);
        box-shadow:none; font-weight:700; }
      .ch-btn:disabled { opacity:.45; }

      .ch-corner { position:absolute; top:calc(${sa.top}px + 12px); right:calc(${sa.right}px + 14px);
        display:flex; gap:10px; pointer-events:none; z-index:50; }
      .ch-ico { pointer-events:auto; width:44px; height:44px; border-radius:50%; border:1px solid rgba(255,255,255,.28);
        background:rgba(14,30,22,.5); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); color:#eafff0;
        font-size:19px; display:flex; align-items:center; justify-content:center; cursor:pointer;
        transition:transform .12s ease; }
      .ch-ico:active { transform:scale(.9); }

      .ch-cards { width:100%; max-width:380px; display:flex; flex-direction:column; gap:10px; margin:14px 0 8px;
        max-height:58vh; overflow-y:auto; padding:2px; }
      .ch-card { pointer-events:auto; display:flex; align-items:center; gap:12px; text-align:left; padding:12px 14px;
        border-radius:16px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.07); cursor:pointer;
        transition:transform .12s ease; }
      .ch-card:active { transform:scale(.97); }
      .ch-card.locked { opacity:.55; }
      .ch-card .ic { font-size:32px; width:44px; text-align:center; flex:none; }
      .ch-card .mid { flex:1; min-width:0; }
      .ch-card .nm { font-size:16px; font-weight:800; }
      .ch-card .df { font-size:12px; font-weight:700; margin-top:2px; }
      .ch-card .meta { font-size:11.5px; opacity:.78; margin-top:2px; }
      .ch-card .bt { font-size:12px; font-weight:800; color:#ffe29a; text-align:right; flex:none; white-space:nowrap; }
      .df.d1 { color:#9fe89a; } .df.d2 { color:#c8e88a; } .df.d3 { color:#ffd25e; }
      .df.d4 { color:#ffab66; } .df.d5 { color:#ff8080; }

      .ch-hud { position:absolute; inset:0; pointer-events:none; z-index:20; }
      .ch-timer { position:absolute; top:calc(${sa.top}px + 10px); left:50%; transform:translateX(-50%);
        font-size:clamp(22px, 7.5vw, 30px); font-weight:800; letter-spacing:1px; padding:4px 16px; border-radius:999px;
        background:rgba(10,22,16,.55); border:1px solid rgba(255,255,255,.18);
        backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); text-shadow:0 1px 6px rgba(0,0,0,.5); }
      .ch-timer.low { color:#ff9090; animation:chPulse .8s ease infinite; }
      @keyframes chPulse { 0%,100% { transform:translateX(-50%) scale(1); } 50% { transform:translateX(-50%) scale(1.07); } }
      .ch-track { position:absolute; top:calc(${sa.top}px + 14px); left:calc(${sa.left}px + 14px);
        font-size:17px; font-weight:800; padding:8px 14px; border-radius:999px;
        background:rgba(10,22,16,.55); border:1px solid rgba(255,255,255,.18);
        backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
      .ch-track .found { color:#9fe89a; }
      .ch-track.pop { animation:chPop .4s ease; }
      @keyframes chPop { 0% { transform:scale(1); } 40% { transform:scale(1.25); } 100% { transform:scale(1); } }
      .ch-penfx { position:absolute; top:calc(${sa.top}px + 52px); left:50%; transform:translateX(-50%);
        font-size:20px; font-weight:800; color:#ff8080; opacity:0; transition:opacity .2s ease, transform .6s ease;
        text-shadow:0 1px 8px rgba(0,0,0,.6); }
      .ch-penfx.show { opacity:1; transform:translateX(-50%) translateY(14px); }

      .ch-toast { position:absolute; left:50%; top:24%; transform:translate(-50%,-50%) scale(.9); z-index:22;
        background:rgba(10,22,16,.78); border:1px solid rgba(255,255,255,.2); padding:10px 18px; border-radius:999px;
        font-size:15px; font-weight:700; opacity:0; transition:opacity .25s ease, transform .25s ease;
        pointer-events:none; white-space:nowrap; backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
      .ch-toast.show { opacity:1; transform:translate(-50%,-50%) scale(1); }

      .ch-flash { position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .5s ease; z-index:19; }
      .ch-flash.bad { background:radial-gradient(120% 100% at 50% 50%, rgba(200,30,30,0) 55%, rgba(200,30,30,.4) 100%); }
      .ch-flash.good { background:radial-gradient(120% 100% at 50% 50%, rgba(90,220,120,0) 55%, rgba(90,220,120,.35) 100%); }
      .ch-flash.on { opacity:1; transition:opacity .06s ease; }

      .ch-joy { position:absolute; width:118px; height:118px; margin:-59px 0 0 -59px; border-radius:50%; z-index:21;
        border:2px solid rgba(255,255,255,.4); background:rgba(255,255,255,.07); pointer-events:none;
        opacity:0; transition:opacity .15s ease; }
      .ch-joy.show { opacity:1; }
      .ch-knob { position:absolute; width:50px; height:50px; margin:-25px 0 0 -25px; left:50%; top:50%;
        border-radius:50%; background:rgba(255,255,255,.88); box-shadow:0 2px 10px rgba(0,0,0,.4); }

      .ch-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        padding:22px; pointer-events:auto; z-index:40; text-align:center;
        background:radial-gradient(130% 100% at 50% 40%, rgba(8,20,14,.55), rgba(4,10,7,.86));
        backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
      .ch-panel { width:100%; max-width:380px; background:rgba(16,30,22,.82); border:1px solid rgba(255,255,255,.16);
        border-radius:20px; padding:20px 18px 16px; max-height:82vh; overflow-y:auto; }
      .ch-panel h2 { font-size:24px; font-weight:800; margin:0 0 10px; }
      .ch-panel .big { font-size:44px; margin:2px 0 6px; }
      .ch-help { text-align:left; font-size:14.5px; line-height:1.75; margin:0 auto 16px; max-width:310px; }
      .ch-help b { color:#ffe29a; }
      .ch-stat { font-size:15px; margin:4px 0; }
      .ch-stat b { color:#ffe29a; font-size:20px; }
      .ch-newbest { display:inline-block; margin:6px 0 2px; padding:5px 14px; border-radius:999px; font-size:12px;
        font-weight:800; letter-spacing:1.2px; background:linear-gradient(90deg,#ffd76e,#ff9f68); color:#3a2205; }

      .ch-namebox { margin:12px 0 6px; }
      .ch-namebox label { display:block; font-size:13px; opacity:.85; margin-bottom:7px; font-weight:600; }
      .ch-namerow { display:flex; gap:8px; }
      .ch-input { flex:1; min-width:0; padding:11px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.3);
        background:rgba(255,255,255,.1); color:#fff; font-size:16px; font-weight:700; outline:none; }
      .ch-input::placeholder { color:rgba(255,255,255,.45); font-weight:500; }
      .ch-save { padding:11px 18px; border-radius:12px; border:none; font-weight:800; font-size:15px; cursor:pointer;
        color:#0d2313; background:linear-gradient(180deg,#b7f2a8,#77d477); }

      .ch-tabs { display:flex; gap:6px; margin-bottom:12px; overflow-x:auto; padding-bottom:2px; }
      .ch-tabs button { flex:none; pointer-events:auto; padding:8px 13px; border-radius:999px;
        border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.06); color:#dfeede; font-size:13px;
        font-weight:700; cursor:pointer; white-space:nowrap; }
      .ch-tabs button.on { background:linear-gradient(180deg,#b7f2a8,#77d477); color:#0d2313; border-color:transparent; }
      .ch-lblist { display:flex; flex-direction:column; gap:5px; min-height:120px; max-height:40vh; overflow-y:auto; }
      .ch-lbrow { display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:10px;
        background:rgba(255,255,255,.05); font-size:15px; }
      .ch-lbrow .r { min-width:30px; font-weight:800; text-align:center; }
      .ch-lbrow .nm { flex:1; font-weight:600; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ch-lbrow .sc { font-weight:800; color:#ffe29a; font-variant-numeric:tabular-nums; }
      .ch-lbrow.you { background:rgba(143,224,137,.18); border:1px solid rgba(143,224,137,.45); }
      .ch-lbempty { font-size:13.5px; opacity:.7; padding:18px 6px; }

      .ch-fatal { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:60;
        padding:26px; text-align:center; background:#122019; pointer-events:auto; }
    `;
    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "ch-ui";
    ui.innerHTML = `
      <div class="ch-bg" id="chBg"></div>

      <div class="ch-corner">
        <button class="ch-ico ch-hidden" id="chPause" aria-label="Pause">⏸</button>
        <button class="ch-ico" id="chMute" aria-label="Sound">🔊</button>
      </div>

      <div class="ch-screen" id="scrMenu">
        <div class="ch-logo">🦎</div>
        <div class="ch-title">Chameleon Hunt</div>
        <div class="ch-tag">They are camouflaged into the room.<br>You are the Seeker. Find them all.</div>
        <button class="ch-btn" id="btnPlay">Start Hunting</button>
        <button class="ch-btn ghost" id="btnHow">How to play</button>
        <button class="ch-btn ghost" id="btnBoards">Leaderboards</button>
      </div>

      <div class="ch-screen ch-hidden" id="scrSelect">
        <div class="ch-title" style="font-size:26px;">Choose an arena</div>
        <div class="ch-cards" id="chCards"></div>
        <button class="ch-btn ghost" id="btnSelBack" style="width:min(200px,60vw);">Back</button>
      </div>

      <div class="ch-hud ch-hidden" id="chHud">
        <div class="ch-track" id="chTrack">🎯 <span class="found">0</span>/<span class="tot">0</span></div>
        <div class="ch-timer" id="chTimer">0:00</div>
        <div class="ch-penfx" id="chPen">+6s</div>
      </div>

      <div class="ch-toast" id="chToast"></div>
      <div class="ch-flash bad" id="chFlashBad"></div>
      <div class="ch-flash good" id="chFlashGood"></div>
      <div class="ch-joy" id="chJoy"><div class="ch-knob" id="chKnob"></div></div>

      <div class="ch-overlay ch-hidden" id="ovHow">
        <div class="ch-panel">
          <h2>How to play</h2>
          <div class="ch-help">
            🕹 <b>Left side</b>: touch &amp; drag to walk.<br>
            👀 <b>Right side</b>: drag to look around.<br>
            👆 <b>Tap</b> a suspicious shape to accuse it.<br>
            ❌ Wrong accusations cost <b>time</b> — more on harder arenas.<br>
            🫥 Hiders match the surface they lean on —<br>
            &nbsp;&nbsp;&nbsp;&nbsp;watch for <b>blinking eyes</b> and odd bumps.<br>
            🧍 They <b>stand, sit, curl up, even lie flat</b> —<br>
            &nbsp;&nbsp;&nbsp;&nbsp;and some “statues” aren’t statues…<br>
            👀 Later arenas: check <b>above you</b>, too.<br>
            🤭 <b>Giggles get louder</b> when you're close.<br>
            ⏱ Find everyone before the clock runs out!
          </div>
          <button class="ch-btn" id="btnHowOk" style="margin-bottom:0;">Got it</button>
        </div>
      </div>

      <div class="ch-overlay ch-hidden" id="ovPause">
        <div class="ch-panel">
          <h2>Paused</h2>
          <button class="ch-btn" id="btnResume">Resume</button>
          <button class="ch-btn ghost" id="btnRestart">Restart arena</button>
          <button class="ch-btn ghost" id="btnQuit" style="margin-bottom:0;">Quit to menu</button>
        </div>
      </div>

      <div class="ch-overlay ch-hidden" id="ovResult">
        <div class="ch-panel" id="resPanel"></div>
      </div>

      <div class="ch-overlay ch-hidden" id="ovBoards">
        <div class="ch-panel">
          <h2 style="margin-bottom:12px;">🏆 Leaderboards</h2>
          <div class="ch-tabs" id="lbTabs"></div>
          <div class="ch-lblist" id="lbList"></div>
          <button class="ch-btn ghost" id="btnLbClose" style="margin:14px 0 0;">Close</button>
        </div>
      </div>
    `;
    root.appendChild(ui);

    const $ = (id) => ui.querySelector("#" + id);
    const el = {
      bg: $("chBg"), menu: $("scrMenu"), select: $("scrSelect"), cards: $("chCards"),
      hud: $("chHud"), track: $("chTrack"), timer: $("chTimer"), pen: $("chPen"),
      toast: $("chToast"), flashBad: $("chFlashBad"), flashGood: $("chFlashGood"),
      joy: $("chJoy"), knob: $("chKnob"),
      how: $("ovHow"), pause: $("ovPause"), result: $("ovResult"), resPanel: $("resPanel"),
      boards: $("ovBoards"), lbTabs: $("lbTabs"), lbList: $("lbList"),
      pauseBtn: $("chPause"), muteBtn: $("chMute")
    };

    // =====================================================================
    // 2. Utilities and persistent state.
    // =====================================================================
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);

    function fmtMs(ms) {
      // ceil: the countdown reads 0:01 until the run is truly over.
      const s = Math.max(0, Math.ceil(ms / 1000));
      return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }
    function esc(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }
    function fmtMsPrecise(ms) {
      ms = Math.max(0, ms);
      const t = Math.floor(ms / 100) / 10;
      const m = Math.floor(t / 60), s = t - m * 60;
      return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
    }

    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const memStore = {};
    const store = {
      get(k, d) {
        try { const v = canStore ? ctx.storage.get("ch_" + k) : memStore[k]; return v == null ? d : v; }
        catch (_) { return d; }
      },
      set(k, v) {
        try { if (canStore) ctx.storage.set("ch_" + k, v); else memStore[k] = v; } catch (_) {}
      }
    };

    // =====================================================================
    // 3. Arena roster (data only — geometry builders live in section 10).
    // =====================================================================
    // =====================================================================
    // 3. Arena roster (data only — geometry builders live in section 11).
    //    Camouflage mismatch is tiny: the challenge is silhouettes, poses
    //    and patience, not color spotting. Rooms grow with difficulty.
    // =====================================================================
    const ARENAS = [
      { id: "living_room", name: "Living Room", icon: "🛋️", diff: "Very Easy", dlv: 1,
        targets: 3, limit: 150, mismatch: 0.09, preset: "cozy",
        blurb: "Sofas, shelves, a lazy ceiling fan" },
      { id: "kitchen", name: "Kitchen & Dining", icon: "🍳", diff: "Easy", dlv: 2,
        targets: 4, limit: 195, mismatch: 0.03, preset: "lofi",
        blurb: "Counters, pot racks, pantry clutter" },
      { id: "bedroom", name: "Master Bedroom", icon: "🛏️", diff: "Medium", dlv: 3,
        targets: 5, limit: 240, mismatch: 0.014, preset: "drift",
        blurb: "Wardrobes, hanging clothes, soft light" },
      { id: "toy_store", name: "Toy Store", icon: "🧸", diff: "Hard", dlv: 4,
        targets: 6, limit: 300, mismatch: 0.006, preset: "bubble",
        blurb: "Two floors, plush mountains, display dolls" },
      { id: "museum", name: "Art Museum", icon: "🗿", diff: "Very Hard", dlv: 5,
        targets: 7, limit: 330, mismatch: 0.003, preset: "spooky",
        blurb: "Statue gardens where some statues breathe" }
    ];
    const HIDER_NAMES = ["Marco", "Polo", "Blinky", "Willow", "Dot", "Pixel", "Fern", "Ziggy", "Mo", "Luna",
      "Basil", "Coco", "Twig", "Sage", "Pepper", "Olive", "Rusty", "Ivy", "Nib", "Echo"];
    const PENALTY_MS = 6000;
    const CATCH_RANGE = 10;

    function unlockedCount() { return clamp(store.get("unlocked", 1), 1, ARENAS.length); }

    // Plethora already knows who is playing: completion times auto-submit to
    // the per-arena record channels and the boards overlay renders the real
    // platform leaderboard. Only personal bests are kept locally.
    function personalBest(a) { return store.get("best_" + a.id, null); }

    // =====================================================================
    // 4. Audio: synthesized SFX + ctx.music beds.
    // =====================================================================
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!store.get("muted", false);

    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.9;
        master.connect(AC.destination);
      } catch (_) { AC = null; master = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }

    function tone(freq, delay, dur, type, peak, glideTo) {
      ensureAC(); resumeAC();
      if (!AC) return;
      try {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = type || "sine";
        const t = AC.currentTime + (delay || 0);
        o.frequency.setValueAtTime(freq, t);
        if (glideTo) o.frequency.linearRampToValueAtTime(glideTo, t + dur * 0.85);
        o.connect(g); g.connect(master);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak || 0.2, t + 0.014);
        g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
        o.start(t); o.stop(t + dur + 0.04);
      } catch (_) {}
    }
    function buzz(dur, f0, peak) {
      ensureAC(); resumeAC();
      if (!AC) return;
      try {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = "sawtooth";
        const t = AC.currentTime;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.linearRampToValueAtTime(f0 * 0.55, t + dur);
        const lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
        o.connect(lp); lp.connect(g); g.connect(master);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak || 0.18, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
        o.start(t); o.stop(t + dur + 0.03);
      } catch (_) {}
    }
    function fbSting(name) {
      if (AC || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    const sfx = {
      ui() { if (muted) return; if (!AC) { fbSting("tap"); return; } tone(660, 0, 0.07, "sine", 0.1); },
      neutral() { if (muted) return; if (!AC) { fbSting("tap"); return; } tone(300, 0, 0.06, "sine", 0.08); },
      tooFar() { if (muted) return; if (!AC) { fbSting("tap"); return; } tone(430, 0, 0.1, "sine", 0.1); tone(360, 0.09, 0.12, "sine", 0.1); },
      catch() {
        if (muted) return;
        if (!AC) { fbSting("coin"); return; }
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.06, 0.3, "triangle", 0.2));
        tone(2093, 0.28, 0.45, "sine", 0.07);
      },
      penalty() {
        if (muted) return;
        if (!AC) { fbSting("fail"); return; }
        buzz(0.32, 190, 0.2); tone(140, 0.02, 0.28, "square", 0.06);
      },
      win() {
        if (muted) return;
        if (!AC) { fbSting("win"); return; }
        [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.09, 0.5, "triangle", 0.17));
        tone(1568, 0.56, 0.9, "sine", 0.08);
      },
      lose() {
        if (muted) return;
        if (!AC) { fbSting("lose"); return; }
        [523.25, 466.16, 392, 311.13].forEach((f, i) => tone(f, i * 0.16, 0.42, "triangle", 0.15));
        buzz(0.6, 160, 0.1);
      },
      tick() { if (muted || !AC) return; tone(1900, 0, 0.03, "square", 0.045); },
      // Proximity cue: alternates a two-note wolf whistle and a giggle.
      cue(vol, giggle) {
        if (muted) return;
        if (!AC) { fbSting("tap"); return; }
        if (giggle) {
          [1230, 1120, 990].forEach((f, i) => tone(f, i * 0.085, 0.09, "sine", vol * 0.9));
          tone(1480, 0.27, 0.1, "sine", vol * 0.6);
        } else {
          tone(880, 0, 0.22, "sine", vol, 1500);
          tone(1500, 0.26, 0.3, "sine", vol, 780);
        }
      },
      dance() {
        if (muted || !AC) return;
        [659.25, 783.99, 987.77, 783.99].forEach((f, i) => tone(f, 0.4 + i * 0.11, 0.14, "square", 0.05));
      }
    };

    // Background bed via ctx.music. One handle, preset swapped per screen.
    let musicOn = false;
    function bed(preset, volume) {
      if (!canMusic || !ctx.music) return;
      try {
        if (muted) { if (musicOn) { ctx.music.pause(); musicOn = false; } return; }
        const st = ctx.music.state && ctx.music.state();
        if (!musicOn && st === "paused") {
          // A bed we paused earlier (mute toggle): resume it, don't stack play().
          ctx.music.resume();
          ctx.music.setPreset(preset, { fadeMs: 700 });
          ctx.music.setVolume(volume, { fadeMs: 700 });
          musicOn = true;
        } else if (!musicOn || st === "stopped") {
          ctx.music.unlock();
          ctx.music.play({ preset, volume: volume, fadeInMs: 900 });
          musicOn = true;
        } else {
          if (st === "paused") ctx.music.resume();
          ctx.music.setPreset(preset, { fadeMs: 700 });
          ctx.music.setVolume(volume, { fadeMs: 700 });
        }
      } catch (_) {}
    }
    function applyMute() {
      el.muteBtn.textContent = muted ? "🔇" : "🔊";
      if (master) master.gain.value = muted ? 0 : 0.9;
      try {
        if (canMusic && ctx.music) {
          if (muted && musicOn) { ctx.music.pause(); musicOn = false; }
          else if (!muted && state === "play" && arena) bed(arena.preset, 0.3);
          else if (!muted && state !== "play" && everStarted) bed("ambient", 0.2);
        }
      } catch (_) {}
    }

    function haptic(kind) { if (canHaptic) { try { ctx.platform.haptic(kind); } catch (_) {} } }

    // =====================================================================
    // 5. Screen navigation + shared UI helpers.
    // =====================================================================
    let state = "menu";       // menu | select | play | paused | won | result | peek
    let everStarted = false;  // first user gesture happened
    let threeReady = false;   // three.js imported and renderer built
    let arena = null;         // active arena spec
    let toastTimer = null;

    function showToast(msg, ms) {
      el.toast.textContent = msg;
      el.toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms || 1600);
    }
    function flash(elm) {
      elm.classList.add("on");
      ctx.timeout(() => elm.classList.remove("on"), 90);
    }
    function firstGesture() {
      if (!everStarted) {
        everStarted = true;
        try { ctx.platform.start(); } catch (_) {}
        if (canMusic && ctx.music) { try { ctx.music.unlock(); } catch (_) {} }
      }
      ensureAC(); resumeAC();
    }

    function show(which) {
      el.menu.classList.toggle("ch-hidden", which !== "menu");
      el.select.classList.toggle("ch-hidden", which !== "select");
      el.hud.classList.toggle("ch-hidden", which !== "play");
      el.pauseBtn.classList.toggle("ch-hidden", which !== "play");
      el.bg.style.opacity = (which === "play") ? "0" : "1";
      el.bg.style.pointerEvents = (which === "play") ? "none" : "auto";
    }

    function renderCards() {
      const unlocked = unlockedCount();
      el.cards.innerHTML = "";
      ARENAS.forEach((a, i) => {
        const locked = i >= unlocked;
        const best = store.get("best_" + a.id, null);
        const card = document.createElement("button");
        card.className = "ch-card" + (locked ? " locked" : "");
        card.innerHTML = `
          <div class="ic">${locked ? "🔒" : a.icon}</div>
          <div class="mid">
            <div class="nm">${a.name}</div>
            <div class="df d${a.dlv}">${a.diff} · find ${a.targets}</div>
            <div class="meta">${locked ? "Clear the previous arena to unlock" : a.blurb + " · " + fmtMs(a.limit * 1000) + " limit"}</div>
          </div>
          <div class="bt">${best ? "★ " + fmtMsPrecise(best) : ""}</div>`;
        ctx.listen(card, "click", () => {
          firstGesture();
          if (locked) { sfx.neutral(); showToast("🔒 Clear " + ARENAS[i - 1].name + " first"); return; }
          sfx.ui(); haptic("light");
          startLevel(i);
        });
        el.cards.appendChild(card);
      });
    }

    // Leaderboard overlay: real platform boards via ctx.memory records.
    let lbTab = 0, lbReqId = 0;
    function renderBoards() {
      el.lbTabs.innerHTML = "";
      ARENAS.forEach((a, i) => {
        const b = document.createElement("button");
        b.textContent = a.icon + " " + a.name.split(" ")[0];
        b.className = i === lbTab ? "on" : "";
        ctx.listen(b, "click", () => { sfx.ui(); lbTab = i; renderBoards(); });
        el.lbTabs.appendChild(b);
      });
      const a = ARENAS[lbTab];
      const req = ++lbReqId;
      const best = personalBest(a);
      el.lbList.innerHTML = '<div class="ch-lbempty">Loading times…</div>';
      const fill = (entries) => {
        if (req !== lbReqId) return; // a newer tab click superseded this fetch
        el.lbList.innerHTML = "";
        if (entries && entries.length) {
          entries.slice(0, 10).forEach((e, i) => {
            const row = document.createElement("div");
            const you = !!(e.isViewer || e.viewer || e.you || e.self || e.isSelf || e.is_viewer);
            row.className = "ch-lbrow" + (you ? " you" : "");
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
            const nm = e.displayName || e.display_name || e.username || e.name ||
              (e.user && (e.user.displayName || e.user.username)) || "Player";
            const val = e.value != null ? e.value : (e.score != null ? e.score : e.ms);
            row.innerHTML = `<div class="r">${medal}</div><div class="nm">${you ? "⭐ " : ""}${esc(nm)}</div>
              <div class="sc">${val != null ? fmtMsPrecise(val) : (e.label ? esc(e.label) : "—")}</div>`;
            el.lbList.appendChild(row);
          });
        } else {
          el.lbList.innerHTML = '<div class="ch-lbempty">' +
            (best ? "No global times to show — your best is " + fmtMsPrecise(best) + "."
                  : "No times yet. Clear the arena to set one!") + "</div>";
        }
      };
      try {
        ctx.memory.record(a.id).leaderboard({ scope: "global", period: "all_time" })
          .then((lb) => fill((lb && (lb.entries || lb.rows || lb.items || (Array.isArray(lb) ? lb : null))) || []))
          .catch(() => fill(null));
      } catch (_) { fill(null); }
    }

    // =====================================================================
    // 6. Menu wiring.
    // =====================================================================
    ctx.listen($("btnPlay"), "click", () => { firstGesture(); sfx.ui(); haptic("light"); bed("ambient", 0.2); renderCards(); state = "select"; show("select"); });
    ctx.listen($("btnHow"), "click", () => { firstGesture(); sfx.ui(); el.how.classList.remove("ch-hidden"); });
    ctx.listen($("btnHowOk"), "click", () => { sfx.ui(); el.how.classList.add("ch-hidden"); });
    ctx.listen($("btnBoards"), "click", () => { firstGesture(); sfx.ui(); renderBoards(); el.boards.classList.remove("ch-hidden"); });
    ctx.listen($("btnLbClose"), "click", () => { sfx.ui(); el.boards.classList.add("ch-hidden"); });
    ctx.listen($("btnSelBack"), "click", () => { sfx.ui(); state = "menu"; show("menu"); });
    ctx.listen(el.muteBtn, "click", () => { firstGesture(); muted = !muted; store.set("muted", muted); applyMute(); sfx.ui(); });
    ctx.listen(el.pauseBtn, "click", () => {
      if (state === "play") { pauseGame(); return; }
      if (state === "peek") {
        sfx.ui();
        state = "result";
        el.pauseBtn.classList.add("ch-hidden");
        el.result.classList.remove("ch-hidden");
      }
    });

    ctx.listen($("btnResume"), "click", () => { sfx.ui(); resumeGame(); });
    ctx.listen($("btnRestart"), "click", () => { sfx.ui(); el.pause.classList.add("ch-hidden"); startLevel(arenaIdx); });
    ctx.listen($("btnQuit"), "click", () => { sfx.ui(); el.pause.classList.add("ch-hidden"); quitToMenu(); });

    applyMute();

    // First visible frame is the DOM menu — safe to declare readiness now.
    try { ctx.markVisualReady("menu"); } catch (_) {}
    ctx.platform.ready();

    // =====================================================================
    // 7. three.js bootstrap (after ready, so the menu is already visible).
    // =====================================================================
    let THREE = null;
    // The registry fetch can fail transiently (flaky network, CDN hiccup).
    // Retry with backoff, and never dead-end: the failure screen offers a
    // Try-again button that loops back into the import.
    async function importThree() {
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((res) => ctx.timeout(res, 800 * attempt));
        try {
          let mod = await ctx.importModule("three", "0.164.1");
          if (mod && !mod.WebGLRenderer && mod.default) mod = mod.default;
          if (mod && mod.WebGLRenderer) return mod;
          lastErr = new Error("three module missing WebGLRenderer");
        } catch (err) { lastErr = err; }
      }
      throw lastErr || new Error("three import failed");
    }
    while (!THREE) {
      try {
        THREE = await importThree();
      } catch (err) {
        try { ctx.platform.error({ reason: "three_import_failed", message: String(err && err.message).slice(0, 120) }); } catch (_) {}
        await new Promise((resolve) => {
          const fatal = document.createElement("div");
          fatal.className = "ch-fatal";
          fatal.innerHTML = "<div><div style='font-size:40px;'>\u{1F98E}\u{1F4A4}</div>" +
            "<div style='font-size:16px;font-weight:700;margin-top:8px;'>The chameleons couldn't load their 3D world.</div>" +
            "<div style='font-size:13px;opacity:.75;margin-top:6px;'>Usually a brief network hiccup \u2014 give it another go.</div>" +
            "<button class='ch-btn' id='chRetry' style='margin:18px auto 0;width:200px;'>Try again</button></div>";
          ui.appendChild(fatal);
          ctx.listen(fatal.querySelector("#chRetry"), "click", () => {
            sfx.ui();
            fatal.remove();
            resolve();
          });
        });
      }
    }

    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (err) {
      // Rare: WebGL unavailable. Retry once without antialias before giving up.
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false }); } catch (err2) {
        const fatal = document.createElement("div");
        fatal.className = "ch-fatal";
        fatal.innerHTML = "<div><div style='font-size:40px;'>\u{1F98E}</div><div style='font-size:15px;font-weight:700;margin-top:8px;'>This device couldn't start 3D graphics.<br>Close other apps and reopen this Bit.</div></div>";
        ui.appendChild(fatal);
        try { ctx.platform.error({ reason: "webgl_unavailable" }); } catch (_) {}
        return;
      }
    }
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0b1d16, 1);
    // If the OS reclaims the GPU (backgrounding, memory pressure), keep the
    // context restorable instead of freezing on a dead canvas.
    ctx.listen(canvas, "webglcontextlost", (e) => { e.preventDefault(); });
    ctx.listen(canvas, "webglcontextrestored", () => { try { renderer.resetState(); } catch (_) {} });

    const scene3 = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, ctx.width / Math.max(1, ctx.height), 0.08, 120);
    camera.rotation.order = "YXZ";
    scene3.add(camera);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x666055, 1.05);
    scene3.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff2dd, 1.5);
    dir.position.set(6, 12, 4);
    scene3.add(dir);
    const amb = new THREE.AmbientLight(0xffffff, 0.35);
    scene3.add(amb);

    function resize() {
      const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    let lastW = ctx.width, lastH = ctx.height;
    resize();

    // =====================================================================
    // 8. Procedural texture / surface-material factory. Camouflage works by
    //    giving hiders material clones of the exact surface they lean on.
    // =====================================================================
    // Offscreen pattern painting. The runtime owns every DOM canvas
    // (ctx.createCanvas* are display surfaces), so texture bakes use
    // OffscreenCanvas; without it we return null and surfaces fall back to
    // their flat base color — plainer camouflage, never a blank room.
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function paint(size, fn) {
      if (!CAN_BAKE) return null;
      let c = null;
      try { c = new OffscreenCanvas(size, size); } catch (_) { return null; }
      fn(c.getContext("2d"), size);
      return c;
    }
    const P = {
      stripes: (c1, c2, n, horiz) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        g.fillStyle = c2;
        const b = s / n;
        for (let i = 0; i < n; i += 2) {
          if (horiz) g.fillRect(0, i * b, s, b); else g.fillRect(i * b, 0, b, s);
        }
      }),
      rainbow: (cols) => paint(128, (g, s) => {
        const b = s / cols.length;
        cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * b, 0, b + 1, s); });
      }),
      checker: (c1, c2, n) => paint(128, (g, s) => {
        const b = s / n;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          g.fillStyle = (x + y) % 2 ? c2 : c1; g.fillRect(x * b, y * b, b + 1, b + 1);
        }
      }),
      dots: (bg, dot, n, r) => paint(128, (g, s) => {
        g.fillStyle = bg; g.fillRect(0, 0, s, s);
        g.fillStyle = dot;
        const b = s / n;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const ox = (y % 2) * b * 0.5;
          g.beginPath(); g.arc(x * b + ox + b / 2, y * b + b / 2, b * (r || 0.22), 0, Math.PI * 2); g.fill();
        }
      }),
      wood: (c1, c2) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        g.strokeStyle = c2; g.lineWidth = 3; g.globalAlpha = 0.65;
        for (let i = 0; i < 9; i++) {
          g.beginPath();
          const y = (i + 0.5) * s / 9;
          g.moveTo(0, y);
          for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i * 2.1) * 3.2);
          g.stroke();
        }
        g.globalAlpha = 1;
      }),
      noise: (base, amt) => paint(128, (g, s) => {
        g.fillStyle = base; g.fillRect(0, 0, s, s);
        const img = g.getImageData(0, 0, s, s), d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() - 0.5) * 255 * (amt || 0.08);
          d[i] += v; d[i + 1] += v; d[i + 2] += v;
        }
        g.putImageData(img, 0, 0);
      }),
      art: (cols, seed) => paint(128, (g, s) => {
        let r = seed || 7;
        const rand = () => { r = (r * 16807) % 2147483647; return (r & 0xffff) / 0xffff; };
        g.fillStyle = cols[0]; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 14; i++) {
          g.fillStyle = cols[1 + Math.floor(rand() * (cols.length - 1))];
          if (rand() < 0.5) {
            g.beginPath(); g.arc(rand() * s, rand() * s, 8 + rand() * 26, 0, Math.PI * 2); g.fill();
          } else {
            g.save(); g.translate(rand() * s, rand() * s); g.rotate(rand() * 3.1);
            g.fillRect(-20 * rand() - 6, -6, 40 * rand() + 12, 10 + rand() * 14); g.restore();
          }
        }
      }),
      herringbone: (c1, c2) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        g.strokeStyle = c2; g.lineWidth = 3;
        for (let r = 0; r < 8; r++) for (let cl = 0; cl < 8; cl++) {
          g.beginPath();
          const bx = cl * 16, by = r * 16;
          if ((r + cl) % 2) { g.moveTo(bx, by + 16); g.lineTo(bx + 16, by); }
          else { g.moveTo(bx, by); g.lineTo(bx + 16, by + 16); }
          g.stroke();
        }
      }),
      plaid: (c1, c2, c3) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        g.fillStyle = c2;
        for (let i = 0; i < 4; i++) { g.fillRect(i * 32, 0, 12, s); g.fillRect(0, i * 32, s, 12); }
        g.globalAlpha = 0.6; g.fillStyle = c3;
        for (let i = 0; i < 4; i++) { g.fillRect(i * 32 + 18, 0, 4, s); g.fillRect(0, i * 32 + 18, s, 4); }
        g.globalAlpha = 1;
      }),
      terrazzo: (bg, chips) => paint(128, (g, s) => {
        g.fillStyle = bg; g.fillRect(0, 0, s, s);
        let r = 13;
        const rand = () => { r = (r * 16807) % 2147483647; return (r & 0xffff) / 0xffff; };
        for (let i = 0; i < 90; i++) {
          g.fillStyle = chips[i % chips.length];
          g.save(); g.translate(rand() * s, rand() * s); g.rotate(rand() * 3.1);
          g.fillRect(-2 - rand() * 4, -1.5 - rand() * 3, 4 + rand() * 8, 3 + rand() * 6);
          g.restore();
        }
      }),
      clouds: (bg, cl) => paint(128, (g, s) => {
        g.fillStyle = bg; g.fillRect(0, 0, s, s);
        let r = 29;
        const rand = () => { r = (r * 16807) % 2147483647; return (r & 0xffff) / 0xffff; };
        g.fillStyle = cl; g.globalAlpha = 0.55;
        for (let i = 0; i < 8; i++) {
          const cx = rand() * s, cy = rand() * s;
          for (let b = 0; b < 5; b++) {
            g.beginPath();
            g.arc(cx + (rand() - 0.5) * 30, cy + (rand() - 0.5) * 12, 7 + rand() * 12, 0, Math.PI * 2);
            g.fill();
          }
        }
        g.globalAlpha = 1;
      }),
      moire: (c1, c2) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        g.strokeStyle = c2; g.lineWidth = 3;
        for (let i = 0; i < 16; i++) { g.beginPath(); g.moveTo(i * 8, 0); g.lineTo(i * 8, s); g.stroke(); }
      })
    };

    // world = everything belonging to the currently-built arena.
    let world = null;

    function surf(key, opts) { world.mats[key] = opts; }

    function texFrom(canvasEl, uRep, vRep) {
      const t = new THREE.CanvasTexture(canvasEl);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.repeat.set(Math.max(0.25, uRep), Math.max(0.25, vRep));
      return t;
    }
    // Shared furniture material (cached per surface+size bucket). When a
    // pattern canvas exists the material stays white and the map carries the
    // color; otherwise the surface's flat color is used.
    function matFor(key, w, h) {
      const s = world.mats[key];
      const ck = key + "|" + (w).toFixed(1) + "|" + (h).toFixed(1);
      if (world.matCache[ck]) return world.matCache[ck];
      const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
      if (s.canvas) {
        const t = texFrom(s.canvas, w * s.density, h * s.density);
        if (s.anim) world.animTex.push(t);
        m.map = t;
      } else {
        m.color.setHex(s.color != null ? s.color : 0xffffff);
      }
      world.matCache[ck] = m;
      return m;
    }
    // Unique hider material clone: same texture pattern & density as the
    // surface, tinted slightly "off" by the arena's mismatch factor.
    function hiderMatFor(key, mismatch, partW, partH) {
      const s = world.mats[key];
      const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
      if (s.canvas) {
        const t = texFrom(s.canvas, Math.max(0.5, partW * s.density), Math.max(0.5, partH * s.density));
        if (s.anim) world.animTex.push(t);
        m.map = t;
        m.color.setRGB(1, 1, 1).lerp(new THREE.Color(0xfff2b8), mismatch * 1.6);
      } else {
        const c = new THREE.Color(s.color != null ? s.color : 0xffffff);
        const hsl = { h: 0, s: 0, l: 0 };
        c.getHSL(hsl);
        c.setHSL(hsl.h, hsl.s, clamp(hsl.l + mismatch * 0.5, 0, 1));
        m.color.copy(c);
      }
      return m;
    }

    // =====================================================================
    // 9. Geometry helpers: meshes, colliders, accusable objects.
    // =====================================================================
    function collider(x, z, w, d, y0, y1) {
      world.colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y0 || 0, y1: y1 == null ? 2.6 : y1 });
    }
    function meshOpts(mesh, opts) {
      opts = opts || {};
      if (opts.pick) { mesh.userData.accuse = opts.name || "that"; world.pickables.push(mesh); }
      else if (opts.occlude !== false) { mesh.userData.neutral = true; world.occluders.push(mesh); }
      world.group.add(mesh);
      return mesh;
    }
    function B(key, w, h, d, x, y, z, ry, opts) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matFor(key, Math.max(w, d), h));
      mesh.position.set(x, y + h / 2, z);
      if (ry) mesh.rotation.y = ry;
      opts = opts || {};
      if (opts.solid) {
        const quarter = Math.abs(Math.sin(ry || 0)) > 0.7;
        collider(x, z, quarter ? d : w, quarter ? w : d, y, y + h + (opts.solidExtra || 0));
      }
      return meshOpts(mesh, opts);
    }
    function C(key, rT, rB, h, x, y, z, opts) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, 14), matFor(key, rT * 2, h));
      mesh.position.set(x, y + h / 2, z);
      opts = opts || {};
      if (opts.solid) collider(x, z, Math.max(rT, rB) * 2, Math.max(rT, rB) * 2, y, y + h);
      return meshOpts(mesh, opts);
    }
    function SP(key, r, x, y, z, opts) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), matFor(key, r * 2, r * 2));
      mesh.position.set(x, y, z);
      opts = opts || {};
      if (opts.solid) collider(x, z, r * 1.7, r * 1.7, Math.max(0, y - r), y + r);
      return meshOpts(mesh, opts);
    }
    function PL(key, w, h, x, y, z, rx, ry, opts) {
      const m = matFor(key, w, h);
      m.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx || 0; mesh.rotation.y = ry || 0;
      return meshOpts(mesh, opts);
    }
    // Room shell: floor, ceiling, four walls (all neutral occluders).
    function shell(W, D, H, floorKey, wallKeys, ceilColor) {
      PL(floorKey, W, D, 0, 0, 0, -Math.PI / 2, 0, {});
      const cm = new THREE.MeshLambertMaterial({ color: ceilColor });
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), cm);
      ceil.rotation.x = Math.PI / 2; ceil.position.y = H;
      meshOpts(ceil, {});
      // n, s, w, e
      B(wallKeys[0], W, H, 0.3, 0, 0, -D / 2 - 0.15, 0, { solid: true, solidExtra: 3 });
      B(wallKeys[1], W, H, 0.3, 0, 0, D / 2 + 0.15, 0, { solid: true, solidExtra: 3 });
      B(wallKeys[2], 0.3, H, D, -W / 2 - 0.15, 0, 0, 0, { solid: true, solidExtra: 3 });
      B(wallKeys[3], 0.3, H, D, W / 2 + 0.15, 0, 0, 0, { solid: true, solidExtra: 3 });
    }
    function glow(color, w, h, x, y, z, ry) {
      const m = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      mesh.position.set(x, y, z); mesh.rotation.y = ry || 0;
      meshOpts(mesh, {});
      return mesh;
    }

    // =====================================================================
    // 10. Hiders: low-poly humanoids camouflaged into their surface.
    // =====================================================================
    // Pose library — like the real game, hiders contort: they stand, crouch,
    // sit on furniture, curl into balls, lie flat, or pancake against walls.
    // parts: [w, h, d, x, y, z] boxes; eye: blink-tell anchor.
    const POSES = {
      stand: {
        parts: [
          [0.16, 0.6, 0.17, -0.11, 0.3, 0], [0.16, 0.6, 0.17, 0.11, 0.3, 0],
          [0.44, 0.58, 0.24, 0, 0.89, 0],
          [0.12, 0.5, 0.13, -0.29, 0.9, 0], [0.12, 0.5, 0.13, 0.29, 0.9, 0],
          [0.3, 0.3, 0.28, 0, 1.36, 0]
        ], eye: { y: 1.38, z: 0.15 }, height: 1.55
      },
      crouch: {
        parts: [
          [0.2, 0.34, 0.2, -0.13, 0.17, 0.05], [0.2, 0.34, 0.2, 0.13, 0.17, 0.05],
          [0.48, 0.5, 0.3, 0, 0.55, 0],
          [0.12, 0.4, 0.13, -0.31, 0.5, 0.02], [0.12, 0.4, 0.13, 0.31, 0.5, 0.02],
          [0.3, 0.28, 0.28, 0, 0.97, 0.02]
        ], eye: { y: 0.99, z: 0.15 }, height: 1.15
      },
      sit: {
        parts: [
          [0.4, 0.16, 0.42, 0, 0.08, 0.2],
          [0.14, 0.34, 0.14, -0.12, -0.14, 0.38], [0.14, 0.34, 0.14, 0.12, -0.14, 0.38],
          [0.44, 0.52, 0.24, 0, 0.34, 0],
          [0.11, 0.42, 0.12, -0.28, 0.3, 0.04], [0.11, 0.42, 0.12, 0.28, 0.3, 0.04],
          [0.29, 0.28, 0.27, 0, 0.76, 0.02]
        ], eye: { y: 0.78, z: 0.16 }, height: 0.95
      },
      lie: {
        parts: [
          [0.44, 0.15, 0.6, 0, 0.08, 0],
          [0.15, 0.12, 0.5, -0.12, 0.06, 0.52], [0.15, 0.12, 0.5, 0.12, 0.06, 0.52],
          [0.11, 0.1, 0.46, -0.28, 0.05, 0.05], [0.11, 0.1, 0.46, 0.28, 0.05, 0.05],
          [0.28, 0.13, 0.26, 0, 0.07, -0.42]
        ], eye: { y: 0.15, z: -0.42, up: true }, height: 0.26
      },
      flat: {
        parts: [
          [0.15, 0.56, 0.07, -0.11, 0.28, 0], [0.15, 0.56, 0.07, 0.11, 0.28, 0],
          [0.42, 0.56, 0.07, 0, 0.84, 0],
          [0.11, 0.48, 0.06, -0.27, 0.85, 0], [0.11, 0.48, 0.06, 0.27, 0.85, 0],
          [0.28, 0.28, 0.07, 0, 1.31, 0]
        ], eye: { y: 1.33, z: 0.045 }, height: 1.48
      },
      ball: {
        parts: [
          [0.5, 0.4, 0.44, 0, 0.2, 0],
          [0.1, 0.3, 0.1, -0.3, 0.22, 0.06], [0.1, 0.3, 0.1, 0.3, 0.22, 0.06],
          [0.26, 0.22, 0.24, 0, 0.46, 0.07]
        ], eye: { y: 0.48, z: 0.19 }, height: 0.62
      },
      // Pressed INTO a wall or painting: 5cm proud, splayed limbs, no gap
      // visible from the side — a figure "inside" the art.
      relief: {
        parts: [
          [0.16, 0.54, 0.05, -0.14, 0.27, 0], [0.16, 0.54, 0.05, 0.14, 0.27, 0],
          [0.44, 0.54, 0.05, 0, 0.82, 0],
          [0.12, 0.5, 0.045, -0.33, 0.88, 0], [0.12, 0.5, 0.045, 0.33, 0.88, 0],
          [0.3, 0.3, 0.05, 0, 1.3, 0]
        ], eye: { y: 1.32, z: 0.032 }, height: 1.46
      },
      // On all fours, back flat — reads as a low table or bench.
      plank: {
        parts: [
          [0.42, 0.18, 0.85, 0, 0.48, 0],
          [0.11, 0.42, 0.12, -0.16, 0.21, 0.34], [0.11, 0.42, 0.12, 0.16, 0.21, 0.34],
          [0.13, 0.46, 0.13, -0.15, 0.23, -0.34], [0.13, 0.46, 0.13, 0.15, 0.23, -0.34],
          [0.26, 0.24, 0.26, 0, 0.52, 0.56]
        ], eye: { y: 0.54, z: 0.7 }, height: 0.66
      },
      // Spread-eagle X pressed on a wall.
      star: {
        parts: [
          [0.15, 0.62, 0.06, -0.24, 0.34, 0, 0.38], [0.15, 0.62, 0.06, 0.24, 0.34, 0, -0.38],
          [0.4, 0.52, 0.06, 0, 0.82, 0],
          [0.11, 0.56, 0.05, -0.4, 1.18, 0, -0.7], [0.11, 0.56, 0.05, 0.4, 1.18, 0, 0.7],
          [0.28, 0.28, 0.06, 0, 1.44, 0]
        ], eye: { y: 1.46, z: 0.04 }, height: 1.62
      },
      // Upside down against a wall — the eyes are at the BOTTOM.
      headstand: {
        parts: [
          [0.28, 0.26, 0.24, 0, 0.14, 0],
          [0.42, 0.56, 0.2, 0, 0.6, 0],
          [0.11, 0.42, 0.1, -0.3, 0.26, 0.03], [0.11, 0.42, 0.1, 0.3, 0.26, 0.03],
          [0.14, 0.62, 0.12, -0.14, 1.2, 0, 0.16], [0.14, 0.62, 0.12, 0.14, 1.2, 0, -0.16]
        ], eye: { y: 0.13, z: 0.13 }, height: 1.52
      },
      // Casual diagonal lean, ankles crossed, head off-axis.
      lean: {
        parts: [
          [0.16, 0.62, 0.16, -0.3, 0.31, 0], [0.15, 0.6, 0.15, -0.12, 0.3, 0.05, 0.25],
          [0.44, 0.56, 0.22, -0.02, 0.87, 0, 0.22],
          [0.12, 0.46, 0.12, -0.32, 0.92, 0.03, 0.5], [0.12, 0.46, 0.12, 0.28, 0.86, 0.02, 0.1],
          [0.3, 0.3, 0.26, 0.2, 1.34, 0]
        ], eye: { x: 0.2, y: 1.36, z: 0.14 }, height: 1.55
      }
    };

    function makeHider(spot, mismatch, name) {
      const g = new THREE.Group();
      const parts = [];
      const pose = POSES[spot.pose] || POSES.stand;
      const H = {
        group: g, parts, name, found: false,
        x: spot.x, z: spot.z, y: spot.y || 0,
        blinkAt: rnd(4, 9), blinkOn: 0, swayPh: rnd(0, 6.28), danceT: 0,
        eyes: null, matKey: spot.mat, headY: pose.eye.y, height: pose.height
      };
      // Two body builds: boxy (hard edges) or soft (ellipsoid limbs) — like
      // the source game's different hider body types.
      const soft = Math.random() < 0.5;
      for (const [w, hgt, d, x, y, z, rz] of pose.parts) {
        const geo = soft ? new THREE.SphereGeometry(0.5, 10, 8) : new THREE.BoxGeometry(w, hgt, d);
        const m = new THREE.Mesh(geo, hiderMatFor(spot.mat, mismatch, Math.max(w, d), hgt));
        if (soft) m.scale.set(w * 1.15, hgt * 1.05, d * 1.15);
        m.position.set(x, y, z);
        if (rz) m.rotation.z = rz;
        m.userData.hider = H;
        parts.push(m); g.add(m);
      }
      // Blinking eyes: the fairness tell on heavily camouflaged hiders.
      const eyeG = new THREE.Group();
      const eyeMatW = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const eyeMatB = new THREE.MeshBasicMaterial({ color: 0x101014 });
      const exo = pose.eye.x || 0;
      for (const sx of [-0.07, 0.07]) {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 6), eyeMatW);
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 5), eyeMatB);
        w.position.set(exo + sx, pose.eye.y, pose.eye.z);
        if (pose.eye.up) p.position.set(exo + sx, pose.eye.y + 0.03, pose.eye.z);
        else p.position.set(exo + sx, pose.eye.y, pose.eye.z + 0.032);
        eyeG.add(w, p);
      }
      eyeG.visible = false;
      H.eyes = eyeG;
      g.add(eyeG);
      // Body-shape variety: no two hiders share an exact silhouette.
      if (spot.pose !== "lie") {
        // 15% tiny, 15% giant, the rest in a wide middle band.
        const roll = Math.random();
        const sx = roll < 0.15 ? rnd(0.55, 0.72) : roll > 0.85 ? rnd(1.28, 1.45) : rnd(0.8, 1.25);
        g.scale.set(sx, sx * rnd(0.85, 1.18), 1);
      }
      g.position.set(spot.x, H.y, spot.z);
      g.rotation.y = spot.ry || 0;
      if (spot.rx) g.rotation.x = spot.rx;   // ceiling clingers hang inverted
      H.dropTo = spot.dropTo;                // air hiders fall here on reveal
      world.group.add(g);
      world.hiders.push(H);
      for (const p of parts) world.hiderMeshes.push(p);
      return H;
    }

    function revealHider(h) {
      h.found = true;
      h.eyes.visible = true;
      h.danceT = 0.0001;
      if (h.dropTo != null) {
        h.y = h.dropTo;
        h.group.rotation.x = 0;
        h.group.position.y = h.y;
      }
      for (const p of h.parts) {
        if (p.material.map) { p.material.map.dispose(); p.material.map = null; }
        p.material.emissive = new THREE.Color(0x222222);
        p.material.needsUpdate = true;
      }
      confetti(h.x, h.y + h.height * 0.7, h.z);
    }

    // Confetti particle bursts for catches / wins.
    const bursts = [];
    function confetti(x, y, z) {
      const N = 42;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      const vel = [];
      const c = new THREE.Color();
      for (let i = 0; i < N; i++) {
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        c.setHSL(Math.random(), 0.85, 0.6);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        vel.push([rnd(-2.2, 2.2), rnd(1.5, 4.6), rnd(-2.2, 2.2)]);
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true }));
      world.group.add(pts);
      bursts.push({ pts, vel, life: 1.4 });
    }

    // =====================================================================
    // 11. The five arena builders. Each registers surfaces, builds the set,
    //     and returns a pool of >= 15 hide spots referencing surface keys.
    // =====================================================================
    function freshWorld(spec) {
      disposeWorld();
      world = {
        group: new THREE.Group(), colliders: [], pickables: [], occluders: [],
        hiders: [], hiderMeshes: [], mats: {}, matCache: {}, animTex: [],
        anims: [], dust: null, groundAt: null, spawn: { x: 0, z: 6, yaw: 0 }, spec
      };
      scene3.add(world.group);
    }
    function disposeWorld() {
      if (!world) return;
      scene3.remove(world.group);
      world.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
      for (let i = bursts.length - 1; i >= 0; i--) bursts.pop();
      world = null;
    }

    // ---- shared arena-dressing helpers ----------------------------------
    function dustCloud(W, D, H, n, color) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      const vel = [];
      for (let i = 0; i < n; i++) {
        pos[i * 3] = rnd(-W / 2, W / 2); pos[i * 3 + 1] = rnd(0.2, H - 0.4); pos[i * 3 + 2] = rnd(-D / 2, D / 2);
        vel.push([rnd(-0.12, 0.12), rnd(-0.05, 0.05), rnd(-0.12, 0.12)]);
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: color || 0xfff8e8, size: 0.035, transparent: true, opacity: 0.32 }));
      world.group.add(pts);
      world.dust = { pts, n, vel, w: W / 2, d: D / 2, h: H - 0.3 };
    }
    // A static humanoid built from the hider pose kit — the cruellest decoy.
    function figureDecoy(key, x, y, z, ry, name, poseName) {
      const p = POSES[poseName || "stand"];
      const g = new THREE.Group();
      for (const [w, hgt, d, px, py, pz] of p.parts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), matFor(key, Math.max(w, d), hgt));
        m.position.set(px, py, pz);
        m.userData.accuse = name;
        world.pickables.push(m);
        g.add(m);
      }
      g.position.set(x, y, z);
      g.rotation.y = ry;
      world.group.add(g);
      return g;
    }
    function fan(key, x, y, z) {
      const g = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10), matFor(key, 0.3, 0.2));
      hub.userData.neutral = true; world.occluders.push(hub); g.add(hub);
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.22), matFor(key, 1.3, 0.2));
        b.position.set(Math.cos(i * Math.PI / 2) * 0.75, 0, Math.sin(i * Math.PI / 2) * 0.75);
        b.rotation.y = -i * Math.PI / 2;
        b.userData.neutral = true; world.occluders.push(b); g.add(b);
      }
      g.position.set(x, y, z);
      world.group.add(g);
      world.anims.push({ mesh: g, ry: 2.6 });
    }
    function frameArt(key, w, h, x, y, z, ry) {
      return PL(key, w, h, x, y, z, 0, ry, { pick: true, name: "a picture frame" });
    }
    function baseboards(W, D, key) {
      B(key, W - 0.1, 0.14, 0.08, 0, 0, -D / 2 + 0.06, 0, {});
      B(key, W - 0.1, 0.14, 0.08, 0, 0, D / 2 - 0.06, 0, {});
      B(key, 0.08, 0.14, D - 0.1, -W / 2 + 0.06, 0, 0, 0, {});
      B(key, 0.08, 0.14, D - 0.1, W / 2 - 0.06, 0, 0, 0, {});
    }
    // Sprinkle small themed props on free floor — clutter is camouflage.
    function scatter(n, makers, W, D) {
      let placed = 0, guard = 0;
      while (placed < n && guard++ < n * 14) {
        const x = rnd(-W / 2 + 0.8, W / 2 - 0.8), z = rnd(-D / 2 + 0.8, D / 2 - 0.8);
        if (world.colliders.some((c) => x > c.x0 - 0.35 && x < c.x1 + 0.35 && z > c.z0 - 0.35 && z < c.z1 + 0.35 && c.y0 < 0.5)) continue;
        if (Math.hypot(x - world.spawn.x, z - world.spawn.z) < 1.7) continue;
        makers[placed % makers.length](x, z);
        placed++;
      }
    }

    function buildLivingRoom() {
      surf("wallCream", { canvas: P.noise("#e8dcc8", 0.025), density: 0.6, color: 0xe8dcc8 });
      surf("wallAccent", { canvas: P.stripes("#c96f4a", "#b45f3e", 8, false), density: 0.55, color: 0xc96f4a });
      surf("floorWood", { canvas: P.wood("#8a6642", "#6f5230"), density: 0.4, color: 0x8a6642 });
      surf("rug", { canvas: P.dots("#6d4380", "#8f5ba6", 6, 0.24), density: 0.7, color: 0x6d4380 });
      surf("rugTeal", { canvas: P.plaid("#2e6a6a", "#3f8a86", "#255858"), density: 0.8, color: 0x2e6a6a });
      surf("sofaBlue", { canvas: P.noise("#3f6ea8", 0.07), density: 0.9, color: 0x3f6ea8 });
      surf("sofaTan", { canvas: P.noise("#c9a06a", 0.07), density: 0.9, color: 0xc9a06a });
      surf("shelfWood", { canvas: P.wood("#6b4a2e", "#563a21"), density: 0.7, color: 0x6b4a2e });
      surf("tvBlack", { color: 0x1c1c22 });
      surf("plantGreen", { canvas: P.noise("#3e7d3a", 0.1), density: 1.1, color: 0x3e7d3a });
      surf("lampShade", { color: 0xe8d9a8 });
      surf("curtain", { canvas: P.stripes("#7d9ec4", "#6b8db4", 6, false), density: 0.8, color: 0x7d9ec4 });
      surf("coatDark", { canvas: P.noise("#4a4652", 0.06), density: 0.9, color: 0x4a4652 });
      surf("frameA", { canvas: P.art(["#2a3a55", "#e0b23c", "#c94f44", "#efe8da"], 5), density: 0.6, color: 0x2a3a55 });
      surf("frameB", { canvas: P.art(["#3a5540", "#8f5ba6", "#e8a23c", "#efe8da"], 17), density: 0.6, color: 0x3a5540 });

      shell(24, 18, 3.6, "floorWood", ["wallAccent", "wallCream", "wallCream", "wallCream"], 0xf2ece0);
      PL("rug", 7, 5, 0, 0.02, 0.8, -Math.PI / 2, 0, {});
      const rug2 = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), matFor("rugTeal", 3.2, 3.2));
      rug2.rotation.x = -Math.PI / 2; rug2.position.set(-7.5, 0.02, 5);
      meshOpts(rug2, {});

      // Sofa A (south wall, faces north)
      B("sofaBlue", 3.4, 0.55, 1.15, -3.6, 0, 6.1, 0, { pick: true, name: "the blue sofa", solid: true });
      B("sofaBlue", 3.4, 0.75, 0.3, -3.6, 0.55, 6.62, 0, { pick: true, name: "the blue sofa" });
      B("sofaBlue", 0.35, 0.62, 1.15, -5.4, 0.35, 6.1, 0, { pick: true, name: "the blue sofa" });
      B("sofaBlue", 0.35, 0.62, 1.15, -1.8, 0.35, 6.1, 0, { pick: true, name: "the blue sofa" });
      // Sofa B (east, faces west)
      B("sofaTan", 1.15, 0.55, 2.8, 6.2, 0, 2.6, 0, { pick: true, name: "the tan sofa", solid: true });
      B("sofaTan", 0.3, 0.75, 2.8, 6.72, 0.55, 2.6, 0, { pick: true, name: "the tan sofa" });
      // Armchairs, ottoman, coffee table, magazines
      B("sofaTan", 1.15, 0.5, 1.1, 7.2, 0, -3.4, 0, { pick: true, name: "the armchair", solid: true });
      B("sofaTan", 0.3, 0.68, 1.1, 7.72, 0.5, -3.4, 0, { pick: true, name: "the armchair" });
      B("sofaBlue", 1.15, 0.5, 1.1, -7.8, 0, -1.2, 0, { pick: true, name: "the armchair", solid: true });
      B("sofaBlue", 0.3, 0.68, 1.1, -8.32, 0.5, -1.2, 0, { pick: true, name: "the armchair" });
      B("sofaTan", 0.9, 0.38, 0.7, -3.6, 0, 4.0, 0, { pick: true, name: "the ottoman", solid: true });
      B("shelfWood", 1.7, 0.42, 0.95, -0.3, 0, 2.6, 0, { pick: true, name: "the coffee table", solid: true });
      B("frameA", 0.4, 0.12, 0.3, 0.2, 0.42, 2.5, 0.3, { pick: true, name: "the magazines" });
      B("frameB", 0.35, 0.09, 0.28, -0.8, 0.42, 2.8, -0.2, { pick: true, name: "the magazines" });
      // TV wall (north): unit, TV, flickering glow, sideboard, vase
      B("shelfWood", 3.6, 0.5, 0.55, 0, 0, -8.35, 0, { pick: true, name: "the TV unit", solid: true });
      B("tvBlack", 2.8, 1.55, 0.12, 0, 0.9, -8.62, 0, { pick: true, name: "the TV" });
      const tvGlow = glow(0x2a3f55, 2.6, 1.35, 0, 1.62, -8.54, 0);
      world.anims.push({ flickerMat: tvGlow.material });
      B("shelfWood", 2.4, 0.9, 0.55, 7.6, 0, -8.3, 0, { pick: true, name: "the sideboard", solid: true });
      C("rugTeal", 0.16, 0.22, 0.5, 7.1, 0.9, -8.3, { pick: true, name: "the vase" });
      // Bookshelves (west wall) with book rows
      for (const bz of [-4.6, -2.2, 2.6]) {
        B("shelfWood", 0.45, 2.4, 1.9, -11.55, 0, bz, 0, { pick: true, name: "the bookshelf", solid: true });
        for (let s = 0; s < 4; s++) {
          const cols = [0xc94f44, 0x3f6ea8, 0xe0b23c, 0x4f9a55, 0x8f5ba6];
          for (let b = 0; b < 5; b++) {
            const bm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.24),
              new THREE.MeshLambertMaterial({ color: cols[(s * 2 + b) % cols.length] }));
            bm.position.set(-11.45, 0.45 + s * 0.52, bz - 0.72 + b * 0.34);
            meshOpts(bm, { pick: true, name: "the books" });
          }
        }
      }
      // Plants, floor lamps
      C("shelfWood", 0.3, 0.38, 0.5, 11, 0, 7.8, { pick: true, name: "the plant pot", solid: true });
      SP("plantGreen", 0.72, 11, 1.35, 7.8, { pick: true, name: "the plant" });
      C("shelfWood", 0.26, 0.34, 0.45, -11.2, 0, -8.2, { pick: true, name: "the plant pot", solid: true });
      SP("plantGreen", 0.6, -11.2, 1.15, -8.2, { pick: true, name: "the plant" });
      C("tvBlack", 0.04, 0.16, 1.75, 8.7, 0, -6.2, { pick: true, name: "the lamp", solid: true });
      C("lampShade", 0.34, 0.44, 0.42, 8.7, 1.72, -6.2, { pick: true, name: "the lamp" });
      C("tvBlack", 0.04, 0.16, 1.75, -9.2, 0, 7.4, { pick: true, name: "the lamp", solid: true });
      C("lampShade", 0.34, 0.44, 0.42, -9.2, 1.72, 7.4, { pick: true, name: "the lamp" });
      // Coat rack decoy (humanoid-ish coat on a pole)
      C("shelfWood", 0.05, 0.3, 1.85, 11.2, 0, 5.2, { pick: true, name: "the coat rack", solid: true });
      B("coatDark", 0.52, 0.95, 0.28, 11.2, 0.85, 5.2, 0.3, { pick: true, name: "the coat rack" });
      B("coatDark", 0.26, 0.2, 0.24, 11.2, 1.62, 5.2, 0.3, { pick: true, name: "the coat rack" });
      // Wall frames + clock + fan + window/curtains
      frameArt("frameA", 1.5, 1.1, -6.5, 2, 8.82, Math.PI);
      frameArt("frameB", 1.2, 0.9, 3.2, 2.1, 8.82, Math.PI);
      frameArt("frameB", 1.3, 1, -11.82, 2, 6.8, Math.PI / 2);
      const clock = new THREE.Mesh(new THREE.CircleGeometry(0.4, 18), matFor("lampShade", 0.8, 0.8));
      clock.position.set(-5, 2.6, -8.82); meshOpts(clock, { pick: true, name: "the clock" });
      fan("shelfWood", 0, 3.25, 0);
      glow(0xbcd8ee, 2.6, 1.8, 11.82, 1.9, 1.6, -Math.PI / 2);
      const cur1 = PL("curtain", 1.1, 3, 11.7, 1.6, 0.2, 0, -Math.PI / 2, { pick: true, name: "the curtain" });
      const cur2 = PL("curtain", 1.1, 3, 11.7, 1.6, 3.0, 0, -Math.PI / 2, { pick: true, name: "the curtain" });
      world.anims.push({ mesh: cur1, sway: { axis: "z", amp: 0.02, freq: 0.7, ph: 0 } });
      world.anims.push({ mesh: cur2, sway: { axis: "z", amp: 0.02, freq: 0.6, ph: 2 } });
      // Small-detail pass: pillows, side table, floating shelf, dummy.
      B("rugTeal", 0.45, 0.16, 0.3, -4.4, 0.55, 6.25, 0.3, { pick: true, name: "a throw pillow" });
      B("rug", 0.4, 0.15, 0.28, -2.6, 0.55, 6.2, -0.4, { pick: true, name: "a throw pillow" });
      B("curtain", 0.42, 0.15, 0.3, 6.3, 0.55, 1.6, 0.5, { pick: true, name: "a throw pillow" });
      C("shelfWood", 0.26, 0.3, 0.5, 6.5, 0, -1.9, { pick: true, name: "the side table", solid: true });
      C("lampShade", 0.05, 0.06, 0.1, 6.5, 0.5, -1.9, { pick: true, name: "a mug" });
      B("shelfWood", 1.6, 0.05, 0.22, -6.5, 1.35, 8.85, 0, { pick: true, name: "the floating shelf" });
      for (let fb = 0; fb < 4; fb++) {
        const bm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.28, 0.19),
          new THREE.MeshLambertMaterial({ color: [0xc94f44, 0x3f6ea8, 0xe0b23c, 0x8f5ba6][fb] }));
        bm.position.set(-7.05 + fb * 0.32, 1.52, 8.85);
        meshOpts(bm, { pick: true, name: "the books" });
      }
      frameArt("frameB", 0.9, 0.7, -2.5, 2.3, -8.82, 0);
      frameArt("frameA", 0.8, 0.65, 10.2, 2.1, -8.82, 0);
      figureDecoy("sofaTan", -10.3, 0, 6.9, 0.7, "the tailor's dummy", "stand");
      dustCloud(24, 18, 3.6, 90);

      world.spawn = { x: 0.5, z: 8.2, yaw: 0 };
      baseboards(24, 18, "shelfWood");
      scatter(20, [
        (x, z) => B("frameA", 0.22, 0.05, 0.16, x, 0, z, rnd(0, 3), { pick: true, name: "a stray book" }),
        (x, z) => C("lampShade", 0.045, 0.05, 0.09, x, 0, z, { pick: true, name: "a mug" }),
        (x, z) => B("frameB", 0.2, 0.03, 0.28, x, 0, z, rnd(0, 3), { pick: true, name: "loose papers" })
      ], 24, 18);
      return [
        { x: -2.2, z: 8.55, ry: Math.PI, mat: "wallCream", pose: "stand" },
        { x: 8.4, z: 8.55, ry: Math.PI, mat: "wallCream", pose: "stand" },
        { x: -8.8, z: -8.5, ry: 0, mat: "wallAccent", pose: "stand" },
        { x: 3.4, z: -8.5, ry: 0, mat: "wallAccent", pose: "stand" },
        { x: -4.9, z: -8.955, ry: 0, mat: "wallAccent", pose: "relief" },
        { x: 11.45, z: -5.6, ry: -Math.PI / 2, mat: "wallCream", pose: "stand" },
        { x: -11.45, z: 6.8, ry: Math.PI / 2, mat: "wallCream", pose: "stand" },
        { x: -1.2, z: 0.9, ry: 0.4, mat: "rug", pose: "crouch" },
        { x: 1.9, z: 2.0, ry: 0.2, mat: "rug", pose: "lie" },
        { x: -7.5, z: 5.0, ry: 0.8, mat: "rugTeal", pose: "ball" },
        { x: -3.0, z: 5.3, ry: Math.PI, mat: "sofaBlue", pose: "stand" },
        { x: -4.2, z: 6.1, ry: Math.PI, mat: "sofaBlue", pose: "sit", y: 0.55 },
        { x: 6.1, z: 3.4, ry: -Math.PI / 2, mat: "sofaTan", pose: "sit", y: 0.55 },
        { x: 5.5, z: 1.0, ry: -Math.PI / 2, mat: "sofaTan", pose: "crouch" },
        { x: 6.9, z: -2.5, ry: 0, mat: "sofaTan", pose: "crouch" },
        { x: -11.3, z: -3.4, ry: Math.PI / 2, mat: "shelfWood", pose: "stand" },
        { x: -11.3, z: 4.0, ry: Math.PI / 2, mat: "shelfWood", pose: "stand" },
        { x: 1.95, z: -8.3, ry: 0, mat: "tvBlack", pose: "stand" },
        { x: 7.6, z: -7.7, ry: 0, mat: "shelfWood", pose: "crouch" },
        { x: 10.6, z: 7.2, ry: 0.5, mat: "plantGreen", pose: "crouch" },
        { x: 11.5, z: 3.0, ry: -Math.PI / 2, mat: "curtain", pose: "stand" },
        { x: 10.9, z: 4.5, ry: -Math.PI / 2, mat: "coatDark", pose: "stand" },
        { x: 8.75, z: -5.4, ry: 0, mat: "lampShade", pose: "stand" },
        { x: 11.45, z: -2.5, ry: -Math.PI / 2, mat: "wallCream", pose: "lean" },
        { x: 1.4, z: 1.3, ry: 0.3, mat: "floorWood", pose: "plank" },
        { x: -6.8, z: -8.93, ry: 0, mat: "wallAccent", pose: "star" }
      ];
    }

    function buildKitchen() {
      surf("wallTile", { canvas: P.checker("#dfe8ea", "#c6d3d8", 10), density: 1.1, color: 0xdfe8ea });
      surf("wallPaint", { canvas: P.stripes("#eef0e2", "#e5e7d6", 16, false), density: 1.3, color: 0xeef0e2 });
      surf("floorTile", { canvas: P.terrazzo("#c2b9ab", ["#a59b8c", "#8f8577", "#d8cfc0", "#6b6258"]), density: 0.45, color: 0xb9b0a2 });
      surf("counterTop", { color: 0xd8d8d2 });
      surf("cabinetBlue", { canvas: P.noise("#4a6f8a", 0.05), density: 0.8, color: 0x4a6f8a });
      surf("fridgeSteel", { canvas: P.noise("#b8bec4", 0.05), density: 0.9, color: 0xb8bec4 });
      surf("tableWood", { canvas: P.wood("#9a6b3f", "#82552b"), density: 0.6, color: 0x9a6b3f });
      surf("chairRed", { color: 0xa83c34 });
      surf("ovenBlack", { color: 0x26262a });
      surf("pantryWood", { canvas: P.wood("#6b4a2e", "#563a21"), density: 0.7, color: 0x6b4a2e });
      surf("rugRunner", { canvas: P.stripes("#8c5a4a", "#a5705c", 8, true), density: 0.9, color: 0x8c5a4a });
      surf("boxKraft", { canvas: P.noise("#b58a54", 0.07), density: 0.9, color: 0xb58a54 });
      surf("apronRed", { canvas: P.noise("#a83c34", 0.06), density: 0.9, color: 0xa83c34 });
      surf("chalkDark", { canvas: P.art(["#2a2e30", "#e8e2d0", "#8aa84a"], 41), density: 0.5, color: 0x2a2e30 });

      shell(26, 18, 3.6, "floorTile", ["wallTile", "wallPaint", "wallPaint", "wallPaint"], 0xf0f2e8);

      // North + west counter run
      B("cabinetBlue", 16, 0.95, 1.3, -4, 0, -8.25, 0, { pick: true, name: "the counter", solid: true });
      B("counterTop", 16.2, 0.08, 1.4, -4, 0.95, -8.25, 0, { pick: true, name: "the counter" });
      B("cabinetBlue", 1.3, 0.95, 7, -12.3, 0, -4, 0, { pick: true, name: "the counter", solid: true });
      B("counterTop", 1.4, 0.08, 7.2, -12.3, 0.95, -4, 0, { pick: true, name: "the counter" });
      B("ovenBlack", 1.5, 0.85, 0.1, -5, 0.05, -7.55, 0, { pick: true, name: "the oven" });
      B("ovenBlack", 1.5, 0.06, 1.2, -5, 1.03, -8.25, 0, { pick: true, name: "the stove" });
      B("cabinetBlue", 8, 0.8, 0.5, -7, 2.1, -8.65, 0, { pick: true, name: "the cabinets" });
      B("cabinetBlue", 4, 0.8, 0.5, 1, 2.1, -8.65, 0, { pick: true, name: "the cabinets" });
      // Fridge + trash bin
      B("fridgeSteel", 1.35, 2.25, 1.3, 6, 0, -8.2, 0, { pick: true, name: "the fridge", solid: true });
      B("ovenBlack", 0.08, 0.5, 0.06, 5.46, 1.2, -7.52, 0, { pick: true, name: "the fridge" });
      C("fridgeSteel", 0.32, 0.38, 0.55, 4.5, 0, -8.3, { pick: true, name: "the trash bin", solid: true });
      // Big island + stools + pot rack + fruit
      B("cabinetBlue", 4.2, 0.95, 1.6, 0, 0, -2.2, 0, { pick: true, name: "the island", solid: true });
      B("counterTop", 4.4, 0.08, 1.8, 0, 0.95, -2.2, 0, { pick: true, name: "the island" });
      C("tableWood", 0.24, 0.26, 0.1, -1.2, 1.03, -2.2, { pick: true, name: "the fruit bowl" });
      SP("chairRed", 0.09, -1.28, 1.14, -2.26, { pick: true, name: "the fruit bowl" });
      SP("boxKraft", 0.08, -1.1, 1.14, -2.14, { pick: true, name: "the fruit bowl" });
      for (const sx of [-1.4, 0, 1.4]) {
        C("ovenBlack", 0.05, 0.2, 0.6, sx, 0, -0.7, { pick: true, name: "a bar stool", solid: true });
        C("chairRed", 0.24, 0.24, 0.07, sx, 0.6, -0.7, { pick: true, name: "a bar stool" });
      }
      const rack = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 8), matFor("ovenBlack", 0.1, 3));
      bar.rotation.z = Math.PI / 2; bar.userData.neutral = true; world.occluders.push(bar); rack.add(bar);
      for (let i = 0; i < 5; i++) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.16, 10), matFor("fridgeSteel", 0.3, 0.2));
        pot.position.set(-1.4 + i * 0.7, -0.28, 0);
        pot.userData.accuse = "a hanging pot"; world.pickables.push(pot); rack.add(pot);
      }
      rack.position.set(0, 2.25, -2.2);
      world.group.add(rack);
      world.anims.push({ mesh: rack, sway: { axis: "x", amp: 0.03, freq: 0.5, ph: 1 } });
      // Dining set: table, chairs, bench
      B("tableWood", 2.8, 0.1, 1.8, 7.5, 0.72, 4, 0, { pick: true, name: "the dining table" });
      for (const [lx, lz] of [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]])
        B("tableWood", 0.12, 0.72, 0.12, 7.5 + lx, 0, 4 + lz, 0, { pick: true, name: "the dining table" });
      collider(7.5, 4, 3, 2, 0, 1.4);
      for (const [cx, cz, cry] of [[5.7, 4.3, Math.PI / 2], [9.3, 3.7, -Math.PI / 2], [7.1, 5.5, Math.PI]]) {
        B("chairRed", 0.5, 0.45, 0.5, cx, 0, cz, cry, { pick: true, name: "a chair", solid: true });
        B("chairRed", 0.5, 0.55, 0.1, cx - Math.sin(cry) * 0.2, 0.45, cz - Math.cos(cry) * 0.2, cry, { pick: true, name: "a chair" });
      }
      B("tableWood", 2.4, 0.45, 0.5, 7.5, 0, 2.6, 0, { pick: true, name: "the bench", solid: true });
      // Pantry cabinets (east) + SW shelf with jars + produce sacks
      B("pantryWood", 0.8, 2.6, 2, 12.55, 0, -4, 0, { pick: true, name: "the pantry", solid: true });
      B("pantryWood", 0.8, 2.6, 2, 12.55, 0, -1.8, 0, { pick: true, name: "the pantry", solid: true });
      B("pantryWood", 0.5, 2.2, 3, -12.6, 0, 4.5, 0, { pick: true, name: "the shelf", solid: true });
      for (let s = 0; s < 3; s++) for (let b = 0; b < 4; b++) {
        const jm = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 10),
          new THREE.MeshLambertMaterial({ color: [0xc98d3c, 0x8aa84a, 0xa85c78, 0xd8c05a][(s + b) % 4] }));
        jm.position.set(-12.45, 0.55 + s * 0.6, 3.3 + b * 0.8);
        meshOpts(jm, { pick: true, name: "the jars" });
      }
      SP("boxKraft", 0.42, -12.2, 0.36, 7.2, { pick: true, name: "a produce sack", solid: true });
      SP("boxKraft", 0.38, -11.4, 0.32, 7.9, { pick: true, name: "a produce sack" });
      SP("boxKraft", 0.45, -11.9, 0.4, 8.3, { pick: true, name: "a produce sack" });
      // Broom + apron decoys on the west wall
      C("tableWood", 0.025, 0.025, 1.5, -12.7, 0, 1.8, { pick: true, name: "the broom" });
      B("boxKraft", 0.26, 0.34, 0.08, -12.7, 1.45, 1.8, 0, { pick: true, name: "the broom" });
      B("apronRed", 0.45, 0.7, 0.1, -12.85, 1.1, 2.7, 0, { pick: true, name: "the apron" });
      // Runner rug, blackboard, window, clock, hanging lamps
      PL("rugRunner", 1.4, 4.5, -4, 0.02, 2.5, -Math.PI / 2, 0, {});
      B("chalkDark", 2.2, 2.2, 0.08, 2, 1.35, 8.8, 0, { pick: true, name: "the menu board" });
      glow(0xd8ecf6, 2.6, 1.7, -4, 2, 8.82, Math.PI);
      const clock2 = new THREE.Mesh(new THREE.CircleGeometry(0.38, 18), matFor("counterTop", 0.8, 0.8));
      clock2.position.set(8, 2.7, -8.82); meshOpts(clock2, { pick: true, name: "the clock" });
      for (const [hx, hz] of [[0, -2.2], [7.5, 4]]) {
        const lampG = new THREE.Group();
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), matFor("ovenBlack", 0.05, 1));
        cord.position.y = 0.45; cord.userData.neutral = true; world.occluders.push(cord); lampG.add(cord);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.3, 0.28, 12), matFor("chairRed", 0.6, 0.3));
        shade.userData.accuse = "the hanging lamp"; world.pickables.push(shade); lampG.add(shade);
        lampG.position.set(hx, 2.6, hz);
        world.group.add(lampG);
        world.anims.push({ mesh: lampG, sway: { axis: "z", amp: 0.04, freq: 0.45, ph: hx } });
      }
      // Detail pass 2: appliances, shelving, sill herbs, crates.
      B("fridgeSteel", 0.85, 0.5, 0.45, -1.5, 1.03, -8.4, 0, { pick: true, name: "the microwave" });
      C("ovenBlack", 0.12, 0.14, 0.22, 2.6, 1.03, -8.3, { pick: true, name: "the kettle" });
      B("tableWood", 3, 0.05, 0.1, -2, 1.72, -8.9, 0, { pick: true, name: "the utensil rail" });
      for (let u = 0; u < 5; u++) {
        const ut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.02), matFor("fridgeSteel", 0.1, 0.3));
        ut.position.set(-3.1 + u * 0.55, 1.52, -8.88);
        meshOpts(ut, { pick: true, name: "the utensils" });
      }
      B("tableWood", 2.4, 0.06, 0.3, -9, 1.6, 8.72, 0, { pick: true, name: "the plate shelf" });
      for (let pl = 0; pl < 4; pl++) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12), matFor("counterTop", 0.4, 0.1));
        plate.rotation.x = Math.PI / 2;
        plate.position.set(-9.8 + pl * 0.55, 1.82, 8.68);
        meshOpts(plate, { pick: true, name: "the plates" });
      }
      B("pantryWood", 0.9, 1.2, 0.45, 12.6, 0, 1.2, 0, { pick: true, name: "the wine rack", solid: true });
      for (let wri = 0; wri < 6; wri++) {
        const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.32, 8),
          new THREE.MeshLambertMaterial({ color: [0x3a5a2a, 0x5a2a35][wri % 2] }));
        bt.rotation.x = Math.PI / 2;
        bt.position.set(12.42 - Math.floor(wri / 2) * 0.001, 0.35 + Math.floor(wri / 2) * 0.34, 1.2 - 0.25 + (wri % 2) * 0.5);
        meshOpts(bt, { pick: true, name: "the wine bottles" });
      }
      for (let hp = 0; hp < 3; hp++) {
        C("chairRed", 0.09, 0.11, 0.16, -5 + hp, 1.1, 8.7, { pick: true, name: "the herb pots" });
        const herb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshLambertMaterial({ color: 0x4f9a55 }));
        herb.position.set(-5 + hp, 1.35, 8.7);
        meshOpts(herb, { pick: true, name: "the herb pots" });
      }
      B("boxKraft", 0.8, 0.5, 0.6, -10.3, 0, 8.4, 0.2, { pick: true, name: "a crate", solid: true });
      B("boxKraft", 0.7, 0.45, 0.55, -9.4, 0, 7.9, -0.15, { pick: true, name: "a crate" });
      PL("rugRunner", 1.2, 2.6, 8, 0.02, -0.5, -Math.PI / 2, 0, {});
      // Small-detail pass: pot stack, boards, spice row, fruit crate, dummy.
      for (let ps = 0; ps < 3; ps++)
        C("fridgeSteel", 0.16 - ps * 0.03, 0.18 - ps * 0.03, 0.12, -8.6, 1.03 + ps * 0.12, -8.35, { pick: true, name: "the pot stack" });
      B("tableWood", 0.45, 0.03, 0.3, -6.8, 1.03, -8.3, 0.4, { pick: true, name: "the chopping board" });
      C("tableWood", 0.03, 0.03, 0.42, -6.4, 1.05, -8.15, { pick: true, name: "the rolling pin" });
      for (let sp = 0; sp < 6; sp++) {
        const spj = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8),
          new THREE.MeshLambertMaterial({ color: [0xc98d3c, 0x8aa84a, 0xa85c78][sp % 3] }));
        spj.position.set(-3.05 + sp * 0.36, 1.79, -8.86);
        meshOpts(spj, { pick: true, name: "the spice jars" });
      }
      B("boxKraft", 0.7, 0.35, 0.5, 9.6, 0, 5.6, 0.3, { pick: true, name: "the fruit crate", solid: true });
      for (let fr = 0; fr < 4; fr++)
        SP(["chairRed", "boxKraft"][fr % 2], 0.09, 9.45 + (fr % 2) * 0.3, 0.42, 5.5 + Math.floor(fr / 2) * 0.25, { pick: true, name: "the fruit crate" });
      figureDecoy("apronRed", -7.9, 0, -6.9, 0.4, "the chef's dummy", "stand");
      dustCloud(26, 18, 3.6, 90);

      world.spawn = { x: -6, z: 7.8, yaw: 0.25 };
      baseboards(26, 18, "cabinetBlue");
      scatter(22, [
        (x, z) => SP("boxKraft", 0.1, x, 0.1, z, { pick: true, name: "a stray onion" }),
        (x, z) => C("counterTop", 0.05, 0.055, 0.09, x, 0, z, { pick: true, name: "a mug" }),
        (x, z) => B("counterTop", 0.2, 0.02, 0.28, x, 0, z, rnd(0, 3), { pick: true, name: "a recipe card" })
      ], 26, 18);
      return [
        { x: 5.2, z: -8.45, ry: 0, mat: "wallTile", pose: "stand" },
        { x: 6, z: -7.35, ry: 0, mat: "fridgeSteel", pose: "stand" },
        { x: -2.9, z: -2.2, ry: -Math.PI / 2, mat: "cabinetBlue", pose: "crouch" },
        { x: 2.9, z: -2.2, ry: Math.PI / 2, mat: "cabinetBlue", pose: "crouch" },
        { x: 0, z: -0.7, ry: 0, mat: "chairRed", pose: "sit", y: 0.64 },
        { x: 7.5, z: 3.35, ry: 0, mat: "tableWood", pose: "lie" },
        { x: 7.9, z: 2.6, ry: Math.PI, mat: "tableWood", pose: "sit", y: 0.45 },
        { x: 9.9, z: 4.9, ry: Math.PI / 2, mat: "chairRed", pose: "crouch" },
        { x: 11.9, z: -2.9, ry: -Math.PI / 2, mat: "pantryWood", pose: "stand" },
        { x: -12.15, z: 2.4, ry: Math.PI / 2, mat: "wallPaint", pose: "stand" },
        { x: -12.05, z: 5.6, ry: Math.PI / 2, mat: "pantryWood", pose: "crouch" },
        { x: -11.5, z: 7.6, ry: 0.5, mat: "boxKraft", pose: "ball" },
        { x: -4, z: 2.0, ry: 0.3, mat: "rugRunner", pose: "lie" },
        { x: -4.6, z: -7.35, ry: 0, mat: "cabinetBlue", pose: "crouch" },
        { x: 0.8, z: -7.35, ry: 0, mat: "cabinetBlue", pose: "crouch" },
        { x: -11.4, z: -4.0, ry: Math.PI / 2, mat: "cabinetBlue", pose: "crouch" },
        { x: -6.4, z: 8.55, ry: Math.PI, mat: "wallPaint", pose: "stand" },
        { x: 3.4, z: 8.955, ry: Math.PI, mat: "wallPaint", pose: "relief" },
        { x: 10.2, z: 8.55, ry: Math.PI, mat: "wallPaint", pose: "stand" },
        { x: 12.55, z: 3.8, ry: -Math.PI / 2, mat: "wallPaint", pose: "stand" },
        { x: -8.2, z: -0.8, ry: 0.2, mat: "floorTile", pose: "crouch" },
        { x: 2, z: 8.72, ry: Math.PI, mat: "chalkDark", pose: "relief" },
        { x: -3, z: -8.55, ry: 0, mat: "cabinetBlue", pose: "ball", y: 2.9 },
        { x: -8.5, z: -8.93, ry: 0, mat: "wallTile", pose: "star" },
        { x: 12.55, z: 6.8, ry: -Math.PI / 2, mat: "wallPaint", pose: "lean" },
        { x: 2.4, z: 0.9, ry: 0.5, mat: "floorTile", pose: "plank" }
      ];
    }

    function buildBedroom() {
      surf("wallRose", { canvas: P.dots("#d8b8b0", "#d0aca2", 8, 0.16), density: 1.3, color: 0xd8b8b0 });
      surf("wallPaper", { canvas: P.dots("#cfc3de", "#b3a2cc", 7, 0.2), density: 1.2, color: 0xcfc3de });
      surf("carpet", { canvas: P.herringbone("#9a8f9c", "#90858f"), density: 1.0, color: 0x9a8f9c });
      surf("duvet", { canvas: P.checker("#7d9ec4", "#6b8db4", 6), density: 0.9, color: 0x7d9ec4 });
      surf("bedWood", { canvas: P.wood("#7a5838", "#644728"), density: 0.6, color: 0x7a5838 });
      surf("pillow", { color: 0xf0ead8 });
      surf("wardrobe", { canvas: P.wood("#5f4630", "#4c3722"), density: 0.65, color: 0x5f4630 });
      surf("curtainB", { canvas: P.stripes("#c98ba0", "#b87890", 6, false), density: 0.85, color: 0xc98ba0 });
      surf("vanity", { canvas: P.wood("#b08a5c", "#997344"), density: 0.7, color: 0xb08a5c });
      surf("dresser", { color: 0x4a8a8c });
      surf("rugOval", { canvas: P.dots("#8c5a4a", "#a5705c", 6, 0.25), density: 0.8, color: 0x8c5a4a });
      surf("chairMauve", { canvas: P.noise("#8c6a88", 0.06), density: 0.9, color: 0x8c6a88 });
      surf("clothTeal", { canvas: P.noise("#3e8a80", 0.06), density: 0.9, color: 0x3e8a80 });
      surf("clothRose", { canvas: P.noise("#c88a96", 0.06), density: 0.9, color: 0xc88a96 });
      surf("basketWeave", { canvas: P.checker("#b39a6a", "#9c845a", 12), density: 1.6, color: 0xb39a6a });
      surf("frameC", { canvas: P.art(["#4a3a55", "#e0b23c", "#7d9ec4", "#efe8da"], 29), density: 0.6, color: 0x4a3a55 });

      shell(28, 20, 3.6, "carpet", ["wallPaper", "wallRose", "wallRose", "wallRose"], 0xefe6e2);

      // Bed against the north wall + nightstands + foot bench
      B("bedWood", 3.6, 0.42, 4.6, 0, 0, -7.2, 0, { pick: true, name: "the bed", solid: true });
      B("duvet", 3.4, 0.36, 3.4, 0, 0.42, -6.8, 0, { pick: true, name: "the duvet" });
      B("pillow", 1.25, 0.24, 0.7, -0.85, 0.46, -8.9, 0, { pick: true, name: "a pillow" });
      B("pillow", 1.25, 0.24, 0.7, 0.85, 0.46, -8.9, 0, { pick: true, name: "a pillow" });
      B("bedWood", 3.6, 1.3, 0.18, 0, 0, -9.55, 0, { pick: true, name: "the headboard" });
      for (const nx of [-2.5, 2.5]) {
        B("bedWood", 0.7, 0.55, 0.6, nx, 0, -9.1, 0, { pick: true, name: "the nightstand", solid: true });
        C("pillow", 0.16, 0.2, 0.3, nx, 0.55, -9.1, { pick: true, name: "the little lamp" });
      }
      B("bedWood", 2.6, 0.45, 0.6, 0, 0, -4.3, 0, { pick: true, name: "the bench", solid: true });
      // Wardrobe row (east wall) with thin gaps
      for (let i = 0; i < 4; i++)
        B("wardrobe", 0.75, 2.6, 1.9, 13.4, 0, -6.5 + i * 2.1, 0, { pick: true, name: "the wardrobe", solid: true });
      // Window + curtains (west)
      glow(0xe8d8ee, 2.8, 1.9, -13.82, 1.9, 1, Math.PI / 2);
      const bc1 = PL("curtainB", 1.15, 3.1, -13.68, 1.65, -0.8, 0, Math.PI / 2, { pick: true, name: "the curtain" });
      const bc2 = PL("curtainB", 1.15, 3.1, -13.68, 1.65, 2.8, 0, Math.PI / 2, { pick: true, name: "the curtain" });
      world.anims.push({ mesh: bc1, sway: { axis: "z", amp: 0.018, freq: 0.55, ph: 0 } });
      world.anims.push({ mesh: bc2, sway: { axis: "z", amp: 0.018, freq: 0.65, ph: 2.5 } });
      // Vanity + mirror + stool (SE), dresser (SW)
      B("vanity", 1.9, 0.75, 0.6, 7, 0, 9.35, 0, { pick: true, name: "the vanity", solid: true });
      glow(0xd8e8f0, 1.2, 1.3, 7, 1.9, 9.7, Math.PI);
      B("vanity", 0.45, 0.45, 0.45, 5.6, 0, 8.7, 0, { pick: true, name: "the stool", solid: true });
      B("dresser", 2.4, 1.15, 0.65, -7, 0, 9.35, 0, { pick: true, name: "the dresser", solid: true });
      C("clothRose", 0.14, 0.18, 0.4, -7.6, 1.15, 9.35, { pick: true, name: "the perfume bottles" });
      // Reading corner (NW): armchair, floor lamp, side table + bookcase
      B("chairMauve", 1.1, 0.5, 1.05, -11.8, 0, -8, 0, { pick: true, name: "the reading chair", solid: true });
      B("chairMauve", 0.3, 0.65, 1.05, -12.32, 0.5, -8, 0, { pick: true, name: "the reading chair" });
      C("bedWood", 0.04, 0.16, 1.75, -12.9, 0, -6.6, { pick: true, name: "the lamp", solid: true });
      C("pillow", 0.32, 0.42, 0.4, -12.9, 1.72, -6.6, { pick: true, name: "the lamp" });
      C("bedWood", 0.3, 0.34, 0.5, -10.4, 0, -8.6, { pick: true, name: "the side table", solid: true });
      B("wardrobe", 0.5, 2.2, 2.4, -13.6, 0, -4.2, 0, { pick: true, name: "the bookcase", solid: true });
      for (let s = 0; s < 3; s++) for (let b = 0; b < 6; b++) {
        const bm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.2),
          new THREE.MeshLambertMaterial({ color: [0xc94f44, 0x3f6ea8, 0xe0b23c, 0x4f9a55][(s + b) % 4] }));
        bm.position.set(-13.5, 0.5 + s * 0.62, -5.2 + b * 0.36);
        meshOpts(bm, { pick: true, name: "the books" });
      }
      // Desk + chair (NE)
      B("vanity", 2, 0.75, 0.6, 11.5, 0, -9.3, 0, { pick: true, name: "the desk", solid: true });
      B("dresser", 0.5, 0.45, 0.5, 11.5, 0, -8.3, 0, { pick: true, name: "the desk chair", solid: true });
      // Clothes rack with hanging garments (humanoid decoys)
      B("bedWood", 2.6, 0.06, 0.06, 9, 1.9, 7.5, 0, { pick: true, name: "the clothes rack" });
      for (const [gx, gk] of [[8.1, "clothTeal"], [8.7, "clothRose"], [9.3, "clothTeal"], [9.9, "clothRose"]])
        B(gk, 0.5, 0.95, 0.16, gx, 0.92, 7.5, 0.1, { pick: true, name: "hanging clothes" });
      collider(9, 7.5, 2.8, 0.5, 0, 2);
      for (const px of [7.8, 10.2])
        C("bedWood", 0.04, 0.1, 1.9, px, 0, 7.5, { pick: true, name: "the clothes rack" });
      // Laundry basket + mirror + plant + rug + runner + fan + frames
      C("basketWeave", 0.45, 0.4, 0.6, 13.2, 0, 4.2, { pick: true, name: "the laundry basket", solid: true });
      glow(0xd8e8f0, 0.9, 2.2, 13.8, 1.4, 2.0, -Math.PI / 2);
      C("bedWood", 0.28, 0.36, 0.48, -13, 0, 8.9, { pick: true, name: "the plant pot", solid: true });
      SP("clothTeal", 0.62, -13, 1.2, 8.9, { pick: true, name: "the plant" });
      const rugB = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), matFor("rugOval", 4.8, 4.8));
      rugB.rotation.x = -Math.PI / 2; rugB.position.set(0, 0.02, 0.5); rugB.scale.x = 1.3;
      meshOpts(rugB, {});
      PL("rugOval", 1.1, 3.6, -2.9, 0.02, -7, -Math.PI / 2, 0, {});
      fan("bedWood", 0, 3.25, -2);
      frameArt("frameC", 1.4, 1, -5, 2.1, -9.82, 0);
      frameArt("frameC", 1.1, 0.85, 10, 2.2, 9.82, Math.PI);
      frameArt("frameC", 1.2, 0.9, -13.82, 2.1, 5.8, Math.PI / 2);
      // Detail pass 2: dresser TV, string lights, shelf, suitcase, clutter.
      surf("tvDark", { color: 0x1c1c22 });
      B("tvDark", 1.3, 0.75, 0.08, -7, 1.15, 9.6, 0, { pick: true, name: "the TV" });
      const btv = glow(0x2a3f55, 1.15, 0.6, -7, 1.55, 9.54, Math.PI);
      world.anims.push({ flickerMat: btv.material });
      for (let sl = 0; sl < 8; sl++) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe0a8 }));
        bulb.position.set(-1.6 + sl * 0.46, 1.5 + Math.sin(sl * 1.4) * 0.08, -9.4);
        meshOpts(bulb, {});
      }
      B("vanity", 1.8, 0.06, 0.25, 0.5, 1.9, 9.8, 0, { pick: true, name: "the wall shelf" });
      for (let sb = 0; sb < 4; sb++) {
        const bk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, 0.18), new THREE.MeshLambertMaterial({ color: [0xc94f44, 0x3f6ea8, 0xe0b23c, 0x4f9a55][sb] }));
        bk.position.set(-0.1 + sb * 0.3, 2.06, 9.8);
        meshOpts(bk, { pick: true, name: "the books" });
      }
      const shpl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), matFor("clothTeal", 0.3, 0.3));
      shpl.position.set(1.15, 2.03, 9.8);
      meshOpts(shpl, { pick: true, name: "a tiny plant" });
      B("clothRose", 0.7, 0.55, 0.3, 12.6, 0, 1.9, 0.15, { pick: true, name: "the suitcase", solid: true });
      B("chairMauve", 0.8, 0.4, 0.6, 2.6, 0, -3.2, 0.2, { pick: true, name: "the ottoman", solid: true });
      SP("clothRose", 0.18, -1, 0.96, -6.1, { pick: true, name: "a teddy" });
      SP("clothRose", 0.12, -1, 1.2, -6.05, { pick: true, name: "a teddy" });
      B("pillow", 0.12, 0.06, 0.28, -1.95, 0, -4.72, 0.3, { pick: true, name: "the slippers" });
      B("pillow", 0.12, 0.06, 0.28, -1.62, 0, -4.68, -0.2, { pick: true, name: "the slippers" });
      const yoga = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 10), matFor("clothTeal", 0.4, 0.8));
      yoga.rotation.z = Math.PI / 2; yoga.position.set(-9.5, 0.12, 8.9);
      meshOpts(yoga, { pick: true, name: "the yoga mat" });
      // Small-detail pass: wardrobe-top boxes, robe hook, decoys.
      B("wardrobe", 0.55, 0.55, 0.55, 13.35, 2.6, -6.3, 0.2, { pick: true, name: "a storage box" });
      B("wardrobe", 0.45, 0.45, 0.45, 13.4, 2.6, 0.1, -0.3, { pick: true, name: "a storage box" });
      B("clothRose", 0.4, 0.85, 0.14, 13.75, 1.1, 6.2, 0, { pick: true, name: "the hanging robe" });
      figureDecoy("clothRose", 4.8, 0, 9.2, Math.PI, "the dress form", "stand");
      figureDecoy("clothTeal", 11.9, 0, 6.6, 0.5, "a pile of clothes", "ball");
      dustCloud(28, 20, 3.6, 100);

      world.spawn = { x: -4.5, z: 8.4, yaw: -0.35 };
      baseboards(28, 20, "bedWood");
      scatter(22, [
        (x, z) => B("pillow", 0.11, 0.05, 0.24, x, 0, z, rnd(0, 3), { pick: true, name: "a stray sock" }),
        (x, z) => B("frameC", 0.2, 0.05, 0.15, x, 0, z, rnd(0, 3), { pick: true, name: "a bedside book" }),
        (x, z) => B("clothRose", 0.3, 0.1, 0.3, x, 0, z, rnd(0, 3), { pick: true, name: "a floor cushion" })
      ], 28, 20);
      return [
        { x: -5, z: -9.55, ry: 0, mat: "wallPaper", pose: "stand" },
        { x: 6.2, z: -9.55, ry: 0, mat: "wallPaper", pose: "stand" },
        { x: 9, z: -9.955, ry: 0, mat: "wallPaper", pose: "relief" },
        { x: -13.45, z: 7, ry: Math.PI / 2, mat: "wallRose", pose: "stand" },
        { x: 3, z: 9.55, ry: Math.PI, mat: "wallRose", pose: "stand" },
        { x: -2.2, z: 9.955, ry: Math.PI, mat: "wallRose", pose: "relief" },
        { x: -2.15, z: -6.4, ry: -Math.PI / 2, mat: "duvet", pose: "crouch" },
        { x: 2.15, z: -7.6, ry: Math.PI / 2, mat: "duvet", pose: "crouch" },
        { x: 0.3, z: -6.9, ry: 0, mat: "duvet", pose: "lie", y: 0.78 },
        { x: 0.5, z: -4.3, ry: Math.PI, mat: "bedWood", pose: "sit", y: 0.45 },
        { x: 13, z: -5.45, ry: -Math.PI / 2, mat: "wardrobe", pose: "stand" },
        { x: 13, z: -1.25, ry: -Math.PI / 2, mat: "wardrobe", pose: "stand" },
        { x: 13.05, z: -3.35, ry: -Math.PI / 2, mat: "wardrobe", pose: "flat" },
        { x: -13.45, z: -0.8, ry: Math.PI / 2, mat: "curtainB", pose: "stand" },
        { x: -13.45, z: 2.8, ry: Math.PI / 2, mat: "curtainB", pose: "stand" },
        { x: 6.4, z: 8.7, ry: Math.PI, mat: "vanity", pose: "crouch" },
        { x: 5.6, z: 8.7, ry: Math.PI, mat: "vanity", pose: "sit", y: 0.45 },
        { x: -7, z: 8.6, ry: Math.PI, mat: "dresser", pose: "crouch" },
        { x: -11.75, z: -7.9, ry: 0.3, mat: "chairMauve", pose: "sit", y: 0.5 },
        { x: -13.3, z: -2.5, ry: Math.PI / 2, mat: "wardrobe", pose: "crouch" },
        { x: 11.5, z: -8.5, ry: 0, mat: "vanity", pose: "crouch" },
        { x: 8.6, z: 7.45, ry: -Math.PI / 2, mat: "clothTeal", pose: "stand" },
        { x: 13.2, z: 4.2, ry: 0, mat: "basketWeave", pose: "ball", y: 0.15 },
        { x: 1.2, z: 0.9, ry: 0.4, mat: "rugOval", pose: "lie" },
        { x: -6.5, z: 2.5, ry: 0, mat: "carpet", pose: "crouch" },
        { x: 13.35, z: -2.3, ry: 0, mat: "wardrobe", pose: "ball", y: 2.6 },
        { x: -1.4, z: -5.6, ry: -Math.PI / 2, mat: "duvet", pose: "sit", y: 0.78 },
        { x: 2.8, z: -9.93, ry: 0, mat: "wallPaper", pose: "star" },
        { x: -0.9, z: -3.5, ry: 0, mat: "bedWood", pose: "plank" },
        { x: 13.0, z: 0.7, ry: -Math.PI / 2, mat: "wardrobe", pose: "lean" }
      ];
    }

    function buildToyStore() {
      const MEZZ = 3.1;
      surf("wallSky", { canvas: P.clouds("#cfe8f4", "#e9f5fb"), density: 0.32, color: 0xcfe8f4 });
      surf("wallRainbow", { canvas: P.rainbow(["#e05252", "#e8a23c", "#e8d43c", "#52b05e", "#4a7fd0", "#8f5ba6"]), density: 0.4, color: 0xe8a23c });
      surf("floorCheck", { canvas: P.checker("#f2e6c8", "#e5d0a2", 8), density: 0.55, color: 0xf2e6c8 });
      surf("mezzPink", { color: 0xd8788c });
      surf("shelfRed", { canvas: P.noise("#c94f44", 0.045), density: 0.8, color: 0xc94f44 });
      surf("shelfBlue", { canvas: P.noise("#3f6ea8", 0.045), density: 0.8, color: 0x3f6ea8 });
      surf("shelfYellow", { canvas: P.noise("#e0b23c", 0.045), density: 0.8, color: 0xe0b23c });
      surf("shelfGreen", { canvas: P.noise("#4f9a55", 0.045), density: 0.8, color: 0x4f9a55 });
      surf("shelfOrange", { color: 0xd8813c });
      surf("boxKraft", { canvas: P.noise("#b58a54", 0.07), density: 0.9, color: 0xb58a54 });
      surf("teddyBrown", { canvas: P.noise("#8a5c38", 0.1), density: 1.3, color: 0x8a5c38 });
      surf("teddyPink", { canvas: P.noise("#d888a8", 0.1), density: 1.3, color: 0xd888a8 });
      surf("teddyBlue", { canvas: P.noise("#6888c8", 0.1), density: 1.3, color: 0x6888c8 });
      surf("dollPastel", { canvas: P.noise("#e8c8d8", 0.05), density: 1, color: 0xe8c8d8 });
      surf("ballPit", { canvas: P.dots("#3f6ea8", "#ffd25e", 5, 0.3), density: 1.4, color: 0x3f6ea8 });
      surf("counterPurple", { color: 0x7a4a8c });
      surf("stairWood", { canvas: P.wood("#9a6b3f", "#82552b"), density: 0.6, color: 0x9a6b3f });
      surf("blockRed", { color: 0xd85454 });
      surf("blockBlue", { color: 0x5474d8 });
      surf("horseWood", { canvas: P.wood("#b08a5c", "#997344"), density: 0.8, color: 0xb08a5c });

      shell(32, 22, 6.6, "floorCheck", ["wallSky", "wallRainbow", "wallSky", "wallSky"], 0xe8f2f8);

      // --- Mezzanine over the north strip (z in [-11,-4]) + long staircase ---
      B("mezzPink", 32, 0.25, 7, 0, MEZZ - 0.25, -7.5, 0, { pick: false, occlude: true });
      PL("floorCheck", 32, 7, 0, MEZZ + 0.01, -7.5, -Math.PI / 2, 0, {});
      const stairMat = matFor("stairWood", 2.8, 0.5);
      for (let s = 0; s < 12; s++) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.27, 0.7), stairMat);
        st.position.set(12.5, 0.135 + s * MEZZ / 12, 3.65 - s * 0.68);
        st.userData.neutral = true;
        world.occluders.push(st);
        world.group.add(st);
      }
      collider(10.85, 0, 0.3, 8.4, 0, 4.6);   // stair west rail
      collider(14.15, 0, 0.3, 8.4, 0, 4.6);   // stair east rail
      B("counterPurple", 0.12, 1.0, 8.2, 10.9, 0, 0, 0, { pick: false, occlude: true });
      // Mezzanine railing along z=-4.05 with the stair gap at x in [11,14]
      for (let rx = -15; rx < 10.6; rx += 1.3) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 0.09), matFor("counterPurple", 0.1, 1));
        post.position.set(rx, MEZZ + 0.45, -4.05);
        post.userData.neutral = true; world.occluders.push(post); world.group.add(post);
      }
      B("counterPurple", 26.5, 0.1, 0.1, -2.25, MEZZ + 0.9, -4.05, 0, { pick: false, occlude: true });
      collider(-2.5, -4.05, 27, 0.3, MEZZ, MEZZ + 1.6);
      B("counterPurple", 2, 0.1, 0.1, 15, MEZZ + 0.9, -4.05, 0, { pick: false, occlude: true });
      collider(15, -4.05, 2, 0.3, MEZZ, MEZZ + 1.6);

      world.groundAt = (x, z, cur) => {
        if (x > 11 && x < 14 && z > -4.2 && z < 4.2) {
          const h = MEZZ * clamp((4 - z) / 8, 0, 1);
          // Only when actually on the stairs — never teleport a ground-level
          // player walking beneath/behind the staircase.
          if (Math.abs(cur - h) < 1.0) return h;
        }
        if (z < -4.05) return cur > 1.55 ? MEZZ : 0;
        return 0;
      };

      // --- Ground floor: gondolas, plush mountain, dolls, pit, clutter ---
      function gondola(key, x, z, w, y) {
        B(key, w, 1.8, 0.9, x, y || 0, z, 0, { pick: true, name: "the " + key.replace("shelf", "").toLowerCase() + " shelf", solid: true });
        for (let i = 0; i < Math.floor(w / 0.8); i++) {
          const tm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8),
            new THREE.MeshLambertMaterial({ color: [0xff8080, 0x80c8ff, 0xffe080, 0xa0e8a0, 0xe0a0ff][i % 5] }));
          tm.position.set(x - w / 2 + 0.5 + i * 0.8, (y || 0) + 1.95, z);
          meshOpts(tm, { pick: true, name: "a toy" });
        }
      }
      gondola("shelfRed", -9, -0.5, 7);
      gondola("shelfBlue", -9, 3.5, 7);
      gondola("shelfYellow", 0, 1.5, 6);
      gondola("shelfGreen", 0, 6, 6);
      gondola("shelfOrange", 7, -1, 4);
      // Plush mountain under the mezzanine + giant teddy
      const plushKeys = ["teddyBrown", "teddyPink", "teddyBlue"];
      const plushSpots = [[-14.2, -8.6, 0.55], [-13.3, -7.6, 0.7], [-12.4, -8.8, 0.5], [-14.6, -7.2, 0.45],
        [-13.8, -6.4, 0.4], [-12.6, -6.8, 0.6], [-11.8, -7.9, 0.42], [-13, -9.4, 0.5]];
      plushSpots.forEach(([px, pz, pr], i) => {
        SP(plushKeys[i % 3], pr, px, pr * 0.9, pz, { pick: true, name: "a plushie", solid: i < 3 });
      });
      function teddy(key, x, z, s, y0, name) {
        SP(key, 0.85 * s, x, y0 + 0.85 * s, z, { pick: true, name, solid: true });
        SP(key, 0.55 * s, x, y0 + 1.95 * s, z, { pick: true, name });
        for (const ex of [-0.42, 0.42]) SP(key, 0.2 * s, x + ex * s, y0 + 2.35 * s, z, { pick: true, name });
        for (const ax of [-0.85, 0.85]) SP(key, 0.28 * s, x + ax * s, y0 + 1.0 * s, z + 0.1 * s, { pick: true, name });
        for (const lx of [-0.5, 0.5]) SP(key, 0.32 * s, x + lx * s, y0 + 0.3 * s, z + 0.55 * s, { pick: true, name });
      }
      teddy("teddyBrown", -10.5, -6.5, 1.05, 0, "the giant teddy");
      teddy("teddyPink", -12, -7, 0.85, MEZZ, "the pink teddy");
      // Display dolls: three humanoid decoys by the counter
      figureDecoy("dollPastel", -4.2, 0, 8, Math.PI, "a display doll", "stand");
      figureDecoy("dollPastel", -3.4, 0, 8.3, Math.PI + 0.2, "a display doll", "stand");
      figureDecoy("dollPastel", -2.6, 0, 8, Math.PI - 0.15, "a display doll", "crouch");
      collider(-3.4, 8.1, 2.4, 1, 0, 1.8);
      // Ball pit
      B("ballPit", 4, 0.55, 3, 12.5, 0, 8, 0, { pick: true, name: "the ball pit", solid: true });
      PL("ballPit", 3.7, 2.7, 12.5, 0.56, 8, -Math.PI / 2, 0, { pick: true, name: "the ball pit" });
      // Balloon bunches (bobbing)
      for (const [bx, bz, ph] of [[-7, 7, 0], [4, 3.8, 2], [9, -2, 4]]) {
        const bunch = new THREE.Group();
        const bcols = [0xff7080, 0x70c8ff, 0xffe070];
        for (let i = 0; i < 3; i++) {
          const bl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshLambertMaterial({ color: bcols[i] }));
          bl.position.set(Math.cos(i * 2.1) * 0.3, 2.6 + i * 0.15, Math.sin(i * 2.1) * 0.3);
          bl.userData.accuse = "a balloon"; world.pickables.push(bl); bunch.add(bl);
          const str = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.5, 4), matFor("counterPurple", 0.05, 2));
          str.position.set(bl.position.x, 1.3, bl.position.z);
          str.userData.neutral = true; world.occluders.push(str); bunch.add(str);
        }
        bunch.position.set(bx, 0, bz);
        world.group.add(bunch);
        world.anims.push({ mesh: bunch, bob: { amp: 0.12, freq: 0.5, ph, baseY: 0 } });
      }
      // Letter blocks, rocking horse, kiddie car, counter, box wall
      B("blockRed", 0.55, 0.55, 0.55, 4.5, 0, 8.5, 0.2, { pick: true, name: "a letter block", solid: true });
      B("blockBlue", 0.55, 0.55, 0.55, 5.15, 0, 8.35, -0.3, { pick: true, name: "a letter block" });
      B("blockBlue", 0.5, 0.5, 0.5, 4.7, 0.55, 8.45, 0.5, { pick: true, name: "a letter block" });
      B("horseWood", 0.9, 0.55, 0.3, -7.5, 0.35, 7.6, 0.2, { pick: true, name: "the rocking horse", solid: true });
      B("horseWood", 0.28, 0.4, 0.24, -7.15, 0.8, 7.68, 0.2, { pick: true, name: "the rocking horse" });
      B("horseWood", 1.1, 0.08, 0.5, -7.5, 0, 7.6, 0.2, { pick: true, name: "the rocking horse" });
      B("blockRed", 0.9, 0.4, 0.55, 2, 0.12, -2.5, -0.4, { pick: true, name: "the kiddie car", solid: true });
      for (const [wx, wz] of [[-0.35, -0.28], [0.35, -0.28], [-0.35, 0.28], [0.35, 0.28]]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10), matFor("counterPurple", 0.3, 0.3));
        wh.rotation.x = Math.PI / 2; wh.position.set(2 + wx, 0.14, -2.5 + wz);
        meshOpts(wh, { pick: true, name: "the kiddie car" });
      }
      B("counterPurple", 3, 1, 0.9, -1, 0, 9.5, 0, { pick: true, name: "the counter", solid: true });
      B("boxKraft", 1.1, 1.1, 1.1, -14.5, 0, 9, 0.3, { pick: true, name: "a box", solid: true });
      B("boxKraft", 0.9, 0.9, 0.9, -13.5, 0, 9.4, -0.2, { pick: true, name: "a box", solid: true });
      B("boxKraft", 0.85, 0.85, 0.85, -14.2, 1.1, 9.1, 0.15, { pick: true, name: "a box" });
      // Mezzanine stock
      gondola("shelfYellow", -6, -8.5, 6, MEZZ);
      gondola("shelfRed", 2, -9.5, 5, MEZZ);
      gondola("shelfBlue", 6, -6.5, 4, MEZZ);
      for (const [px, pz, pr, pk] of [[-2.6, -6, 0.45, "teddyBrown"], [-1.8, -5.6, 0.38, "teddyBlue"], [-2.2, -6.7, 0.4, "teddyPink"]])
        SP(pk, pr, px, MEZZ + pr * 0.9, pz, { pick: true, name: "a plushie" });
      B("boxKraft", 1, 1, 1, 9.3, MEZZ, -10.2, 0.2, { pick: true, name: "a box", solid: true });
      B("boxKraft", 0.8, 0.8, 0.8, 10.3, MEZZ, -9.8, -0.3, { pick: true, name: "a box" });
      glow(0xfff2c8, 3.4, 2, -4, 4.9, -10.82, 0);
      glow(0xffe0ec, 2.6, 1.6, 6, 4.9, -10.82, 0);
      // Detail pass 2: running toy train, arcade cabinets, kites, games.
      surf("balloonRed", { color: 0xff7080 });
      const track = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 8, 40), matFor("stairWood", 3, 0.2));
      track.rotation.x = -Math.PI / 2; track.position.set(6.5, 0.05, 4);
      track.userData.neutral = true; world.occluders.push(track); world.group.add(track);
      for (let tc = 0; tc < 3; tc++) {
        const car = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.24),
          matFor(["shelfRed", "shelfBlue", "shelfYellow"][tc], 0.4, 0.3));
        car.userData.accuse = "the toy train"; world.pickables.push(car); world.group.add(car);
        world.anims.push({ mesh: car, orbit: { cx: 6.5, cz: 4, r: 1.7, speed: 0.55, ph: tc * 0.28, y: 0.22 } });
      }
      B("counterPurple", 0.7, 1.6, 0.7, 15.3, 0, 2.5, 0, { pick: true, name: "the arcade machine", solid: true });
      B("counterPurple", 0.7, 1.6, 0.7, 15.3, 0, 4.2, 0, { pick: true, name: "the arcade machine", solid: true });
      glow(0x88f0d0, 0.5, 0.4, 15.3, 1.25, 2.14, Math.PI);
      glow(0xf0c888, 0.5, 0.4, 15.3, 1.25, 3.84, Math.PI);
      for (const [kx, ky, kz, kk, kp] of [[-4, 4.8, 3, "blockRed", 0], [2, 5.2, -1, "blockBlue", 2.4]]) {
        const kite = PL(kk, 0.9, 0.9, kx, ky, kz, 0, 0.4, { pick: true, name: "a kite" });
        kite.rotation.z = Math.PI / 4;
        world.anims.push({ mesh: kite, sway: { axis: "x", amp: 0.18, freq: 0.3, ph: kp } });
      }
      B("blockBlue", 0.5, 0.08, 0.4, -1.6, 1.0, 9.4, 0.2, { pick: true, name: "the board games" });
      B("blockRed", 0.45, 0.08, 0.36, -1.55, 1.08, 9.42, -0.1, { pick: true, name: "the board games" });
      for (let cp = 0; cp < 3; cp++)
        SP(["teddyBrown", "teddyPink", "teddyBlue"][cp], 0.16, -0.3 + cp * 0.5, 1.16, 9.5, { pick: true, name: "a plushie" });
      // Fourth balloon bunch in registered red — something can hide up there.
      const bunch4 = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const bl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), matFor("balloonRed", 0.6, 0.6));
        bl.position.set(Math.cos(i * 2.1) * 0.32, 2.5 + i * 0.18, Math.sin(i * 2.1) * 0.32);
        bl.userData.accuse = "a balloon"; world.pickables.push(bl); bunch4.add(bl);
        const str = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.4, 4), matFor("counterPurple", 0.05, 2));
        str.position.set(bl.position.x, 1.25, bl.position.z);
        str.userData.neutral = true; world.occluders.push(str); bunch4.add(str);
      }
      bunch4.position.set(-12, 0, 2);
      world.group.add(bunch4);
      world.anims.push({ mesh: bunch4, bob: { amp: 0.1, freq: 0.45, ph: 1.7, baseY: 0 } });
      // Small-detail pass: model planes, posters, play rug, hoops, dolls.
      for (const [px, py, pz, pc] of [[-2, 4.6, 4, 0xd85454], [1.5, 5.0, 6.5, 0x5474d8], [-5.5, 5.4, -1.5, 0xe0b23c]]) {
        const plane = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), new THREE.MeshLambertMaterial({ color: pc }));
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.5), new THREE.MeshLambertMaterial({ color: pc }));
        body.userData.accuse = "a model plane"; wing.userData.accuse = "a model plane";
        world.pickables.push(body, wing);
        plane.add(body, wing);
        plane.position.set(px, py, pz);
        world.group.add(plane);
        world.anims.push({ mesh: plane, ry: 0.9, bob: { amp: 0.14, freq: 0.35, ph: px, baseY: py } });
      }
      frameArt("wallRainbow", 1.4, 1, -10, 3.4, 10.93, Math.PI);
      frameArt("ballPit", 1.2, 0.9, 11, 3.2, 10.93, Math.PI);
      const playRug = new THREE.Mesh(new THREE.CircleGeometry(1.8, 22), matFor("ballPit", 3.6, 3.6));
      playRug.rotation.x = -Math.PI / 2; playRug.position.set(-2.5, 0.02, 3);
      meshOpts(playRug, {});
      for (let hp2 = 0; hp2 < 3; hp2++) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 8, 22),
          new THREE.MeshLambertMaterial({ color: [0xd85454, 0x5474d8, 0xe0b23c][hp2] }));
        hoop.rotation.x = -Math.PI / 2; hoop.position.set(7.8, 0.04 + hp2 * 0.07, 9.6);
        meshOpts(hoop, { pick: true, name: "the hula hoops" });
      }
      figureDecoy("dollPastel", -12.6, 0, -0.9, 0.9, "a display doll", "crouch");
      figureDecoy("dollPastel", -14, 0.5, -7.4, 2.6, "a display doll", "sit");
      figureDecoy("dollPastel", -4.5, 3.1, -9.6, 0.2, "a display doll", "stand");
      dustCloud(32, 22, 6.4, 130, 0xffe8f0);

      world.spawn = { x: -5.5, z: 10, yaw: -0.3 };
      baseboards(32, 22, "counterPurple");
      scatter(30, [
        (x, z) => SP(["shelfRed", "shelfBlue", "shelfYellow", "shelfGreen"][Math.floor(rnd(0, 4))], 0.12, x, 0.12, z, { pick: true, name: "a dropped toy" }),
        (x, z) => B(["blockRed", "blockBlue"][Math.floor(rnd(0, 2))], 0.22, 0.22, 0.22, x, 0, z, rnd(0, 3), { pick: true, name: "a toy block" }),
        (x, z) => C("boxKraft", 0.07, 0.08, 0.16, x, 0, z, { pick: true, name: "a toy soldier" })
      ], 32, 22);
      return [
        { x: -6, z: 10.55, ry: Math.PI, mat: "wallRainbow", pose: "stand" },
        { x: 7, z: 10.55, ry: Math.PI, mat: "wallRainbow", pose: "stand" },
        { x: 2.2, z: 10.955, ry: Math.PI, mat: "wallRainbow", pose: "relief" },
        { x: -15.45, z: 2, ry: Math.PI / 2, mat: "wallSky", pose: "stand" },
        { x: 15.45, z: 5.5, ry: -Math.PI / 2, mat: "wallSky", pose: "stand" },
        { x: -9, z: -1.4, ry: Math.PI, mat: "shelfRed", pose: "stand" },
        { x: -6.5, z: 4.4, ry: 0, mat: "shelfBlue", pose: "stand" },
        { x: -0.5, z: 2.4, ry: 0, mat: "shelfYellow", pose: "stand" },
        { x: 2.4, z: 5.51, ry: Math.PI, mat: "shelfGreen", pose: "relief" },
        { x: 7, z: -0.1, ry: 0, mat: "shelfOrange", pose: "stand" },
        { x: -13.2, z: -7.9, ry: 0.4, mat: "teddyBrown", pose: "sit", y: 0 },
        { x: -10.4, z: -5.4, ry: 0.2, mat: "teddyBrown", pose: "ball" },
        { x: -3.4, z: 7.6, ry: Math.PI, mat: "dollPastel", pose: "stand" },
        { x: 11.8, z: 7.2, ry: 0.6, mat: "ballPit", pose: "ball", y: 0.56 },
        { x: 4.8, z: 7.9, ry: 0.3, mat: "blockRed", pose: "ball" },
        { x: -0.2, z: 8.8, ry: Math.PI, mat: "counterPurple", pose: "crouch" },
        { x: -14, z: 8.3, ry: 0.3, mat: "boxKraft", pose: "ball" },
        { x: -7.4, z: 6.9, ry: 0.4, mat: "horseWood", pose: "crouch" },
        { x: 13.9, z: 10.5, ry: Math.PI, mat: "wallRainbow", pose: "stand" },
        { x: -6, z: -7.7, ry: 0, mat: "shelfYellow", pose: "stand", y: 3.1 },
        { x: 2, z: -8.7, ry: 0, mat: "shelfRed", pose: "stand", y: 3.1 },
        { x: 6, z: -5.99, ry: 0, mat: "shelfBlue", pose: "relief", y: 3.1 },
        { x: -11.3, z: -6.2, ry: 0.4, mat: "teddyPink", pose: "sit", y: 3.1 },
        { x: -2.4, z: -5.8, ry: 0.3, mat: "teddyBrown", pose: "ball", y: 3.1 },
        { x: -14.5, z: -10.5, ry: 0, mat: "wallSky", pose: "stand", y: 3.1 },
        { x: 9.8, z: -9.3, ry: 0.2, mat: "boxKraft", pose: "crouch", y: 3.1 },
        { x: -12, z: 2, ry: 0.4, mat: "balloonRed", pose: "ball", y: 2.35, dropTo: 0 },
        { x: -8, z: 3.5, ry: 0, mat: "shelfBlue", pose: "ball", y: 1.8 },
        { x: 2.6, z: 2.4, ry: 0, mat: "shelfYellow", pose: "headstand" },
        { x: -10.5, z: 10.93, ry: Math.PI, mat: "wallRainbow", pose: "star" },
        { x: -3.2, z: 9.6, ry: 0, mat: "counterPurple", pose: "plank" }
      ];
    }

    function buildMuseum() {
      surf("wallWhite", { canvas: P.noise("#eceff1", 0.018), density: 0.5, color: 0xeceff1 });
      surf("wallMoire", { canvas: P.moire("#20242c", "#e8e2d0"), density: 0.6, color: 0x20242c, anim: true });
      surf("floorMarble", { canvas: P.noise("#d8dade", 0.035), density: 0.35, color: 0xd8dade });
      surf("plinth", { color: 0xc8ccd4 });
      surf("stoneGray", { canvas: P.noise("#c4c6cc", 0.04), density: 1, color: 0xc4c6cc });
      surf("stoneDark", { canvas: P.noise("#30323a", 0.05), density: 1, color: 0x30323a });
      surf("statueGold", { canvas: P.noise("#c9a227", 0.06), density: 1.0, color: 0xc9a227 });
      surf("statueTeal", { canvas: P.noise("#2e8a8a", 0.04), density: 0.9, color: 0x2e8a8a });
      surf("statueRed", { canvas: P.noise("#b53d3d", 0.04), density: 0.9, color: 0xb53d3d });
      surf("benchGray", { canvas: P.noise("#6a7076", 0.035), density: 0.9, color: 0x6a7076 });
      surf("vaseTeal", { canvas: P.noise("#2e6a72", 0.05), density: 0.8, color: 0x2e6a72 });
      surf("vaseRust", { canvas: P.noise("#a05838", 0.05), density: 0.8, color: 0xa05838 });
      surf("artA", { canvas: P.art(["#1d2440", "#e05252", "#e8d43c", "#4a7fd0", "#efe8da"], 11), density: 0.55, color: 0x1d2440 });
      surf("artB", { canvas: P.art(["#3a2a1d", "#52b05e", "#e8a23c", "#8f5ba6", "#efe8da"], 23), density: 0.55, color: 0x3a2a1d });
      surf("artC", { canvas: P.art(["#10231e", "#e05294", "#3cc8e8", "#e8e2d0"], 37), density: 0.6, color: 0x10231e });

      shell(36, 24, 5.2, "floorMarble", ["wallMoire", "wallWhite", "wallWhite", "wallWhite"], 0xf2f4f6);

      // Wall canvases hang low so a standing hider overlaps the art.
      frameArt("artA", 3.4, 2.2, -9, 1.6, 11.82, Math.PI);
      frameArt("artB", 3.4, 2.2, 0, 1.6, 11.82, Math.PI);
      frameArt("artC", 3.4, 2.2, 9, 1.6, 11.82, Math.PI);
      frameArt("artC", 3, 2, -17.82, 1.6, -8, Math.PI / 2);
      frameArt("artB", 3, 2, -17.82, 1.6, 3, Math.PI / 2);
      frameArt("artA", 3, 2, 17.82, 1.6, -1, -Math.PI / 2);
      frameArt("artB", 3, 2, 17.82, 1.6, 6, -Math.PI / 2);

      // Free-standing gallery partitions (art on both faces).
      B("artA", 5, 3.2, 0.35, -8, 0, 2.5, 0, { pick: true, name: "the art wall", solid: true });
      B("artC", 5, 3.2, 0.35, 8, 0, 2.5, 0, { pick: true, name: "the art wall", solid: true });
      B("artB", 5, 3.2, 0.35, 0, 0, -4, Math.PI / 2, { pick: true, name: "the art wall", solid: true });

      // Statue garden (west): stone figures — and two EMPTY plinths a hider
      // can stand on, posing as a statue.
      figureDecoy("stoneGray", -13, 0, -5, 0.4, "a figure statue", "stand");
      figureDecoy("stoneGray", -11.6, 0, -5.4, -0.3, "a figure statue", "crouch");
      figureDecoy("stoneGray", -10.2, 0, -5, 0.9, "a figure statue", "stand");
      figureDecoy("stoneGray", -12.3, 0, -3.8, 2.6, "a figure statue", "sit");
      collider(-11.7, -4.7, 4.4, 2.6, 0, 2);
      B("plinth", 1.3, 0.55, 1.3, -14.5, 0, -4.2, 0, { pick: true, name: "the plinth", solid: true });
      B("plinth", 1.3, 0.55, 1.3, -9, 0, -3.6, 0, { pick: true, name: "the plinth", solid: true });

      // Centrepiece: rotating gold knot behind a rope barrier.
      B("plinth", 1.7, 0.7, 1.7, 0, 0, -8, 0, { pick: true, name: "the plinth", solid: true });
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.62, 0.2, 72, 10), matFor("statueGold", 1.4, 1.4));
      knot.position.set(0, 1.75, -8);
      meshOpts(knot, { pick: true, name: "the gold sculpture" });
      world.anims.push({ mesh: knot, ry: 0.35, rx: 0.12 });
      collider(0, -8, 2, 2, 0, 3);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.85, 8), matFor("statueGold", 0.1, 0.9));
        post.position.set(Math.cos(a) * 2.1, 0.42, -8 + Math.sin(a) * 2.1);
        meshOpts(post, { pick: true, name: "the rope barrier" });
        const rail = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.04, 0.04), matFor("statueRed", 2, 0.1));
        rail.position.set(Math.cos(a + Math.PI / 6) * 1.85, 0.78, -8 + Math.sin(a + Math.PI / 6) * 1.85);
        rail.rotation.y = -(a + Math.PI / 6) + Math.PI / 2;
        meshOpts(rail, { pick: true, name: "the rope barrier" });
      }

      // Other sculptures.
      let h = 0.6;
      B("plinth", 1.4, h, 1.4, 12, 0, -6, 0, { pick: true, name: "the plinth", solid: true });
      const cones = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const cn = new THREE.Mesh(new THREE.ConeGeometry(0.55 - i * 0.15, 0.7, 12), matFor("statueTeal", 1, 1));
        cn.position.y = h + 0.35 + i * 0.62;
        cn.userData.accuse = "the teal totem";
        world.pickables.push(cn);
        cones.add(cn);
      }
      cones.position.set(12, 0, -6);
      world.group.add(cones);
      collider(12, -6, 1.6, 1.6, 0, 3);
      B("plinth", 1.4, h, 1.4, 15, 0, 2, 0, { pick: true, name: "the plinth", solid: true });
      const spiral = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const bx = new THREE.Mesh(new THREE.BoxGeometry(1.15 - i * 0.16, 0.34, 1.15 - i * 0.16), matFor("statueRed", 1, 0.4));
        bx.position.y = h + 0.2 + i * 0.36;
        bx.rotation.y = i * 0.5;
        bx.userData.accuse = "the red spiral";
        world.pickables.push(bx);
        spiral.add(bx);
      }
      spiral.position.set(15, 0, 2);
      world.group.add(spiral);
      world.anims.push({ mesh: spiral, ry: 0.5 });
      collider(15, 2, 1.6, 1.6, 0, 3);
      B("plinth", 1.5, 0.55, 1.5, -15, 0, 5, 0, { pick: true, name: "the plinth", solid: true });
      SP("statueGold", 0.75, -15, 1.35, 5, { pick: true, name: "the gold orb" });
      collider(-15, 5, 1.7, 1.7, 0, 2.6);
      B("plinth", 1.4, 0.9, 1.4, 13, 0, 8, 0, { pick: true, name: "the plinth", solid: true });
      const tor = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.16, 12, 26), matFor("statueTeal", 1.2, 1.2));
      tor.position.set(13, 1.85, 8);
      meshOpts(tor, { pick: true, name: "the teal ring" });
      world.anims.push({ mesh: tor, rz: 0.4 });
      collider(13, 8, 1.6, 1.6, 0, 3);
      // Dark monolith
      B("stoneDark", 0.9, 3.4, 0.7, -4, 0, 8, 0, { pick: true, name: "the monolith", solid: true });
      // Hanging kinetic mobile above the atrium.
      const mobile = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2 - i * 0.5, 0.03, 0.03), matFor("stoneDark", 2, 0.1));
        arm.position.y = -i * 0.4;
        arm.rotation.y = i * 1.1;
        arm.userData.neutral = true; world.occluders.push(arm); mobile.add(arm);
        const shape = new THREE.Mesh(
          i === 0 ? new THREE.SphereGeometry(0.22, 10, 8) : i === 1 ? new THREE.ConeGeometry(0.2, 0.4, 10) : new THREE.BoxGeometry(0.3, 0.3, 0.3),
          matFor(["statueRed", "statueTeal", "statueGold"][i], 0.5, 0.5));
        shape.position.set(Math.cos(i * 1.1) * (1.1 - i * 0.25), -i * 0.4 - 0.25, Math.sin(i * 1.1) * (1.1 - i * 0.25));
        shape.userData.accuse = "the mobile"; world.pickables.push(shape); mobile.add(shape);
      }
      mobile.position.set(0, 4.4, 0);
      world.group.add(mobile);
      world.anims.push({ mesh: mobile, ry: 0.18 });
      // Benches, vases, lecterns.
      for (const [bx, bz] of [[-4, -0.8], [4, -0.8], [-11, 8.5], [11, 8.5]])
        B("benchGray", 2.6, 0.45, 0.75, bx, 0, bz, 0, { pick: true, name: "the bench", solid: true });
      C("vaseTeal", 0.32, 0.5, 1.25, 16.5, 0, -4, { pick: true, name: "the big vase", solid: true });
      C("vaseRust", 0.36, 0.55, 1.4, -16.5, 0, 8, { pick: true, name: "the big vase", solid: true });
      for (const [lx, lz] of [[-8, -8.5], [8, -8.5]]) {
        B("stoneDark", 0.5, 1.05, 0.4, lx, 0, lz, 0, { pick: true, name: "the info stand", solid: true });
        B("plinth", 0.55, 0.06, 0.45, lx, 1.05, lz - 0.05, 0, { pick: true, name: "the info stand" });
      }
      // Detail pass 2: suspended sculptures, ceiling surface, mosaic, banners.
      surf("ceilWhite", { color: 0xf2f4f6 });
      for (const [sx, sy, sz, kind] of [[-6, 3.4, -1, 0], [5, 2.2, -6.2, 1], [10, 3.0, 4, 0]]) {
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 5.2 - sy, 4), matFor("stoneDark", 0.05, 2));
        wire.position.set(sx, sy + (5.2 - sy) / 2, sz);
        wire.userData.neutral = true; world.occluders.push(wire); world.group.add(wire);
        const shape = kind === 0
          ? new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), matFor("statueGold", 0.7, 0.7))
          : new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), matFor("stoneDark", 0.5, 0.5));
        shape.position.set(sx, sy, sz);
        meshOpts(shape, { pick: true, name: "a suspended sculpture" });
        world.anims.push({ mesh: shape, ry: 0.3 });
      }
      const mosaic = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28), matFor("artB", 5.2, 5.2));
      mosaic.rotation.x = -Math.PI / 2; mosaic.position.set(6, 0.02, 7);
      meshOpts(mosaic, {});
      const ban1 = PL("artA", 1.6, 3.4, -12, 3.2, 0, 0, 0, { pick: true, name: "a banner" });
      const ban2 = PL("artC", 1.6, 3.4, 12, 3.2, -2, 0, 0, { pick: true, name: "a banner" });
      world.anims.push({ mesh: ban1, sway: { axis: "z", amp: 0.05, freq: 0.4, ph: 1 } });
      world.anims.push({ mesh: ban2, sway: { axis: "z", amp: 0.05, freq: 0.5, ph: 3 } });
      B("plinth", 1.1, 0.4, 1.1, -2, 0, 6.5, 0, { pick: true, name: "the plinth", solid: true });
      const cluster = new THREE.Group();
      for (let ci = 0; ci < 4; ci++) {
        const cb = new THREE.Mesh(new THREE.BoxGeometry(0.3 + ci * 0.06, 0.3 + ci * 0.06, 0.3 + ci * 0.06), matFor("statueTeal", 0.4, 0.4));
        cb.position.set(Math.cos(ci * 1.7) * 0.22, 0.55 + ci * 0.26, Math.sin(ci * 1.7) * 0.22);
        cb.rotation.y = ci * 0.7;
        cb.userData.accuse = "the cube stack"; world.pickables.push(cb); cluster.add(cb);
      }
      cluster.position.set(-2, 0, 6.5);
      world.group.add(cluster);
      B("stoneDark", 0.55, 1.1, 0.4, 15.5, 0, 10.5, 0.4, { pick: true, name: "the donation box", solid: true });
      // Ceiling detail: beams, spotlights, skylights — so looking up is
      // never conclusive, and the ceiling clingers stay honest nightmares.
      B("stoneDark", 36, 0.12, 0.3, 0, 5.02, -4, 0, { pick: true, name: "the ceiling beam" });
      B("stoneDark", 36, 0.12, 0.3, 0, 5.02, 4, 0, { pick: true, name: "the ceiling beam" });
      for (const [slx, slz] of [[-12, -8], [0, -8], [12, -8], [-12, 8], [0, 8], [12, 8]]) {
        const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.22, 10), matFor("stoneDark", 0.3, 0.3));
        spot.position.set(slx, 5.05, slz);
        meshOpts(spot, { pick: true, name: "a spotlight" });
      }
      glow(0xfdfdf6, 3, 2, 10, 5.18, -2, 0).rotation.x = Math.PI / 2;
      glow(0xfdfdf6, 3, 2, -12, 5.18, 0, 0).rotation.x = Math.PI / 2;
      // More statue-garden population + the living-statue performer.
      figureDecoy("stoneGray", -6.8, 0, -8.8, 0.5, "a figure statue", "stand");
      figureDecoy("stoneGray", 10, 0, -9.5, -0.6, "a figure statue", "crouch");
      B("plinth", 1.3, 0.55, 1.3, 16, 0, -9, 0, { pick: true, name: "the plinth", solid: true });
      figureDecoy("stoneGray", 16, 0.55, -9, -0.7, "a figure statue", "stand");
      figureDecoy("statueGold", 5.5, 0, 6.4, 0.8, "the living statue", "stand");
      frameArt("artA", 2.6, 1.8, -14, 1.6, 11.82, Math.PI);
      frameArt("artC", 2.6, 1.8, 14, 1.6, 11.82, Math.PI);
      dustCloud(36, 24, 5, 120, 0xe8ecf4);

      world.spawn = { x: 0, z: 10.8, yaw: 0 };
      baseboards(36, 24, "stoneDark");
      scatter(24, [
        (x, z) => B("wallWhite", 0.18, 0.02, 0.26, x, 0, z, rnd(0, 3), { pick: true, name: "a gallery leaflet" }),
        (x, z) => B("stoneDark", 0.14, 0.05, 0.2, x, 0, z, rnd(0, 3), { pick: true, name: "a visitor card" }),
        (x, z) => C("plinth", 0.06, 0.07, 0.1, x, 0, z, { pick: true, name: "a paint tin" })
      ], 36, 24);
      return [
        { x: -12, z: -11.5, ry: 0, mat: "wallMoire", pose: "stand" },
        { x: -3, z: -11.955, ry: 0, mat: "wallMoire", pose: "relief" },
        { x: 6, z: -11.955, ry: 0, mat: "wallMoire", pose: "relief" },
        { x: 14, z: -11.5, ry: 0, mat: "wallMoire", pose: "stand" },
        { x: -9, z: 11.78, ry: Math.PI, mat: "artA", pose: "relief" },
        { x: 0.6, z: 11.78, ry: Math.PI, mat: "artB", pose: "relief" },
        { x: 9.4, z: 11.78, ry: Math.PI, mat: "artC", pose: "relief" },
        { x: -17.78, z: -8, ry: Math.PI / 2, mat: "artC", pose: "relief" },
        { x: -17.78, z: 3, ry: Math.PI / 2, mat: "artB", pose: "relief" },
        { x: 17.78, z: -1, ry: -Math.PI / 2, mat: "artA", pose: "relief" },
        { x: -8, z: 2.72, ry: 0, mat: "artA", pose: "relief" },
        { x: -8.8, z: 2.285, ry: Math.PI, mat: "artA", pose: "relief" },
        { x: 8, z: 2.72, ry: 0, mat: "artC", pose: "relief" },
        { x: 0.22, z: -2.2, ry: Math.PI / 2, mat: "artB", pose: "relief" },
        { x: -14.5, z: -4.2, ry: 0.5, mat: "stoneGray", pose: "stand", y: 0.55 },
        { x: -9, z: -3.6, ry: -0.4, mat: "stoneGray", pose: "stand", y: 0.55 },
        { x: -12.7, z: -4.6, ry: 0.3, mat: "stoneGray", pose: "crouch" },
        { x: 2.3, z: -8.4, ry: 0.9, mat: "statueGold", pose: "crouch" },
        { x: 12, z: -5.1, ry: 0, mat: "statueTeal", pose: "crouch" },
        { x: 14.4, z: 2.6, ry: 0.4, mat: "statueRed", pose: "crouch" },
        { x: -4.2, z: 7.69, ry: 0, mat: "stoneDark", pose: "relief" },
        { x: -4, z: -0.8, ry: Math.PI, mat: "benchGray", pose: "sit", y: 0.45 },
        { x: 11, z: 8.5, ry: 0, mat: "benchGray", pose: "lie", y: 0.45 },
        { x: 16.4, z: -3.2, ry: 0, mat: "vaseTeal", pose: "ball" },
        { x: -16.4, z: 8.8, ry: 0.4, mat: "vaseRust", pose: "ball" },
        { x: -6.5, z: 4.6, ry: 0.2, mat: "floorMarble", pose: "lie" },
        { x: 17.45, z: 8.8, ry: -Math.PI / 2, mat: "wallWhite", pose: "stand" },
        { x: 2.5, z: 2, ry: 0.3, rx: Math.PI, mat: "ceilWhite", pose: "lie", y: 5.17, dropTo: 0 },
        { x: -5.9, z: -1.1, ry: 0.8, mat: "stoneDark", pose: "ball", y: 2.9, dropTo: 0 },
        { x: 6.4, z: 7.3, ry: 0.5, mat: "artB", pose: "lie" },
        { x: -8, z: 5, ry: 1.2, rx: Math.PI, mat: "ceilWhite", pose: "lie", y: 5.17, dropTo: 0 },
        { x: -11.2, z: 7.4, ry: 0, mat: "benchGray", pose: "plank" },
        { x: 10.5, z: -11.93, ry: 0, mat: "wallMoire", pose: "star" },
        { x: -3.1, z: 8.2, ry: 0.3, mat: "stoneDark", pose: "headstand" },
        { x: 4.6, z: 5.8, ry: 0.6, mat: "statueGold", pose: "lean" }
      ];
    }

    const BUILDERS = [buildLivingRoom, buildKitchen, buildBedroom, buildToyStore, buildMuseum];


    // =====================================================================
    // 12. Level lifecycle: spot selection with no back-to-back repeats.
    // =====================================================================
    let arenaIdx = 0;
    const game = {
      remainMs: 0, found: 0, target: 0, elapsedLimit: 0,
      accuseCooldown: 0, cueTimer: 2.5, cueFlip: false, lowTickAt: 0
    };
    const player = { x: 0, z: 0, y: 0, groundY: 0 };
    let camYaw = 0, camPitch = -0.04;
    const EYE = 1.62, RADIUS = 0.34, SPEED = 5.2;

    function pickSpots(pool, count, arenaId) {
      if (typeof window !== "undefined" && window.__chSpawnAll) return pool.slice();
      const idx = pool.map((_, i) => i);
      const lastKey = "last_" + arenaId;
      const last = store.get(lastKey, "");
      let chosen = null;
      for (let attempt = 0; attempt < 24; attempt++) {
        for (let i = idx.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [idx[i], idx[j]] = [idx[j], idx[i]];
        }
        const set = idx.slice(0, count).sort((a, b) => a - b);
        if (set.join(",") !== last) { chosen = set; break; }
      }
      if (!chosen) chosen = idx.slice(0, count).sort((a, b) => a - b);
      store.set(lastKey, chosen.join(","));
      return chosen.map((i) => pool[i]);
    }

    function startLevel(i) {
      if (!threeReady) { showToast("🦎 Still loading the 3D world…"); return; }
      arenaIdx = i;
      arena = ARENAS[i];
      el.result.classList.add("ch-hidden");
      el.boards.classList.add("ch-hidden");

      freshWorld(arena);
      const pool = BUILDERS[i]();
      const spots = pickSpots(pool, arena.targets, arena.id);
      const names = HIDER_NAMES.slice();
      for (const s of spots) {
        const ni = Math.floor(Math.random() * names.length);
        makeHider(s, arena.mismatch, names.splice(ni, 1)[0] || "Hider");
      }

      player.x = world.spawn.x; player.z = world.spawn.z;
      player.groundY = 0; player.y = 0;
      camYaw = world.spawn.yaw; camPitch = -0.04;

      game.remainMs = arena.limit * 1000;
      game.found = 0;
      game.target = arena.targets;
      game.accuseCooldown = 0;
      game.cueTimer = 3;
      game.lowTickAt = 0;

      el.track.querySelector(".found").textContent = "0";
      el.track.querySelector(".tot").textContent = String(arena.targets);
      el.timer.classList.remove("low");
      el.pauseBtn.textContent = "⏸";
      updateTimerUI();

      state = "play";
      show("play");
      bed(arena.preset, 0.3);
      try {
        ctx.platform.setProgress(0);
        ctx.platform.milestone("arena_start", { arena: arena.id });
        ctx.platform.interact({ type: "arena_start", arena: arena.id });
      } catch (_) {}
    }

    function updateTimerUI() {
      el.timer.textContent = fmtMs(game.remainMs);
      const low = game.remainMs <= 15000;
      el.timer.classList.toggle("low", low);
    }

    function pauseGame() {
      if (state !== "play") return;
      state = "paused";
      resetPointers();
      sfx.ui();
      el.pause.classList.remove("ch-hidden");
      try { if (canMusic && ctx.music && musicOn && !muted) ctx.music.setVolume(0.1, { fadeMs: 300 }); } catch (_) {}
    }
    function resumeGame() {
      el.pause.classList.add("ch-hidden");
      if (state === "paused") state = "play";
      try { if (canMusic && ctx.music && musicOn && !muted) ctx.music.setVolume(0.3, { fadeMs: 300 }); } catch (_) {}
    }
    function quitToMenu() {
      disposeWorld();
      arena = null;
      state = "menu";
      show("menu");
      bed("ambient", 0.2);
    }

    // =====================================================================
    // 13. Scoring, results, leaderboard entry.
    // =====================================================================
    function computeScore(completionMs) {
      const saved = Math.max(0, arena.limit * 1000 - completionMs);
      return game.found * 250 + Math.round(saved / 100);
    }

    function winLevel(completionMs) {
      state = "result";
      const score = computeScore(completionMs);
      const prevBest = store.get("best_" + arena.id, null);
      const isBest = prevBest == null || completionMs < prevBest;
      if (isBest) store.set("best_" + arena.id, completionMs);
      const unlockedBefore = unlockedCount();
      const unlocksNext = arenaIdx + 1 < ARENAS.length && unlockedBefore < arenaIdx + 2;
      if (unlocksNext) store.set("unlocked", arenaIdx + 2);

      sfx.win(); haptic("success");
      flash(el.flashGood);
      try {
        if (canMusic && ctx.music && musicOn) { ctx.music.duck(0.7, 1400); }
      } catch (_) {}
      try {
        ctx.platform.setScore(score);
        ctx.platform.setProgress(1);
        ctx.platform.milestone("level_clear", { arena: arena.id, ms: completionMs });
        ctx.platform.complete({ arena: arena.id, ms: completionMs, score });
      } catch (_) {}

      el.hud.classList.add("ch-hidden");
      el.pauseBtn.classList.add("ch-hidden");
      el.resPanel.innerHTML = `
        <div class="big">🎉</div>
        <h2>Arena cleared!</h2>
        ${isBest ? '<div class="ch-newbest">NEW PERSONAL BEST</div>' : ""}
        <div class="ch-stat">Time: <b>${fmtMsPrecise(completionMs)}</b></div>
        <div class="ch-stat">Score: <b>${score}</b></div>
        ${unlocksNext ? `<div class="ch-stat">🔓 Unlocked: <b>${ARENAS[arenaIdx + 1].name}</b></div>` : ""}
        <div class="ch-stat" id="chSubNote" style="font-size:12.5px;opacity:.75;">Saving your time…</div>
        <div style="height:10px;"></div>
        <button class="ch-btn" id="resReplay">Replay arena</button>
        ${arenaIdx + 1 < ARENAS.length ? `<button class="ch-btn" id="resNext">Next arena ▸</button>` : ""}
        <button class="ch-btn ghost" id="resBoards">Leaderboard</button>
        <button class="ch-btn ghost" id="resMenu" style="margin-bottom:0;">Menu</button>`;
      el.result.classList.remove("ch-hidden");

      // Auto-submit to the platform leaderboard — Plethora knows the player,
      // no name prompt needed.
      const setNote = (t) => { const n = el.resPanel.querySelector("#chSubNote"); if (n) n.textContent = t; };
      try {
        if (ctx.memory && ctx.memory.record) {
          ctx.memory.record(arena.id).submit(completionMs, { label: fmtMsPrecise(completionMs) })
            .then(() => setNote("✓ Time saved to the " + arena.name + " leaderboard"))
            .catch(() => setNote("Couldn't reach the leaderboard this time."));
        } else setNote("");
      } catch (_) { setNote(""); }

      ctx.listen(el.resPanel.querySelector("#resReplay"), "click", () => { sfx.ui(); startLevel(arenaIdx); });
      const nextBtn = el.resPanel.querySelector("#resNext");
      if (nextBtn) ctx.listen(nextBtn, "click", () => { sfx.ui(); startLevel(arenaIdx + 1); });
      ctx.listen(el.resPanel.querySelector("#resBoards"), "click", () => {
        sfx.ui(); lbTab = arenaIdx; renderBoards(); el.boards.classList.remove("ch-hidden");
      });
      ctx.listen(el.resPanel.querySelector("#resMenu"), "click", () => {
        sfx.ui(); el.result.classList.add("ch-hidden"); quitToMenu();
      });
    }

    function loseLevel() {
      state = "result";
      resetPointers();
      sfx.lose(); haptic("error");
      flash(el.flashBad);
      el.hud.classList.add("ch-hidden");
      el.pauseBtn.classList.add("ch-hidden");
      try {
        ctx.platform.fail({ arena: arena.id, found: game.found, target: game.target });
      } catch (_) {}
      // Reveal everyone who was hiding (so the player learns the spots).
      for (const h of world.hiders) if (!h.found) revealHider(h);
      el.resPanel.innerHTML = `
        <div class="big">⏰</div>
        <h2>Time's up!</h2>
        <div class="ch-stat">You found <b>${game.found}/${game.target}</b> hiders</div>
        <div class="ch-stat" style="opacity:.8;font-size:13px;">The rest are dancing where they hid — look around!</div>
        <div style="height:10px;"></div>
        <button class="ch-btn" id="resRetry">Try again</button>
        <button class="ch-btn ghost" id="resPeek">Look around</button>
        <button class="ch-btn ghost" id="resMenu2" style="margin-bottom:0;">Menu</button>`;
      el.result.classList.remove("ch-hidden");
      ctx.listen(el.resPanel.querySelector("#resRetry"), "click", () => { sfx.ui(); startLevel(arenaIdx); });
      ctx.listen(el.resPanel.querySelector("#resPeek"), "click", () => {
        sfx.ui();
        el.result.classList.add("ch-hidden");
        state = "peek"; // free-roam, no timer; the corner button returns here
        el.pauseBtn.textContent = "↩";
        el.pauseBtn.classList.remove("ch-hidden");
      });
      ctx.listen(el.resPanel.querySelector("#resMenu2"), "click", () => {
        sfx.ui(); el.result.classList.add("ch-hidden"); quitToMenu();
      });
    }

    // =====================================================================
    // 14. Touch controls: left joystick, right look, tap to accuse.
    // =====================================================================
    const move = { x: 0, y: 0 };
    const pointers = new Map();
    let movePid = null, lookPid = null;
    let moveOrigin = { x: 0, y: 0 };
    let lastLook = { x: 0, y: 0 };

    function resetPointers() {
      pointers.clear();
      movePid = null; lookPid = null;
      move.x = 0; move.y = 0;
      el.joy.classList.remove("show");
    }

    function canvasXY(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      if (state !== "play" && state !== "peek") return;
      firstGesture();
      const p = canvasXY(e);
      pointers.set(e.pointerId, { sx: p.x, sy: p.y, moved: 0, t: e.timeStamp });
      if (p.x < ctx.width * 0.5 && movePid === null) {
        movePid = e.pointerId;
        moveOrigin = { x: p.x, y: p.y };
        move.x = 0; move.y = 0;
        el.joy.style.left = p.x + "px";
        el.joy.style.top = p.y + "px";
        el.knob.style.left = "50%";
        el.knob.style.top = "50%";
        el.joy.classList.add("show");
      } else if (lookPid === null) {
        lookPid = e.pointerId;
        lastLook = { x: p.x, y: p.y };
      }
    });

    ctx.listen(canvas, "pointermove", (e) => {
      if (state !== "play" && state !== "peek") return;
      const rec = pointers.get(e.pointerId);
      if (!rec) return;
      const p = canvasXY(e);
      rec.moved += Math.hypot(p.x - (rec.lx == null ? rec.sx : rec.lx), p.y - (rec.ly == null ? rec.sy : rec.ly));
      rec.lx = p.x; rec.ly = p.y;
      if (e.pointerId === movePid) {
        const dx = p.x - moveOrigin.x, dy = p.y - moveOrigin.y;
        const max = 56;
        const len = Math.hypot(dx, dy);
        const k = len > max ? max / len : 1;
        move.x = (dx * k) / max;
        move.y = (dy * k) / max;
        el.knob.style.left = 50 + move.x * 50 + "%";
        el.knob.style.top = 50 + move.y * 50 + "%";
      } else if (e.pointerId === lookPid) {
        camYaw -= (p.x - lastLook.x) * 0.0044;
        camPitch -= (p.y - lastLook.y) * 0.0044;
        camPitch = clamp(camPitch, -1.25, 1.25);
        lastLook = { x: p.x, y: p.y };
      }
    });

    function endPointer(e, cancelled) {
      const rec = pointers.get(e.pointerId);
      if (rec) {
        const dur = e.timeStamp - rec.t;
        if (!cancelled && rec.moved < 12 && dur < 420 && (state === "play" || state === "peek")) handleTap(rec.sx, rec.sy);
        pointers.delete(e.pointerId);
      }
      if (e.pointerId === movePid) {
        movePid = null; move.x = 0; move.y = 0;
        el.joy.classList.remove("show");
      }
      if (e.pointerId === lookPid) lookPid = null;
    }
    ctx.listen(canvas, "pointerup", (e) => endPointer(e, false));
    ctx.listen(canvas, "pointercancel", (e) => endPointer(e, true));

    // =====================================================================
    // 15. Accusations (raycast) — the "Tap to Catch" mechanic.
    // =====================================================================
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    function handleTap(px, py) {
      if (!world) return;
      if (state === "play" && game.accuseCooldown > 0) return;
      ndc.x = (px / Math.max(1, ctx.width)) * 2 - 1;
      ndc.y = -(py / Math.max(1, ctx.height)) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const targets = world.hiderMeshes.concat(world.pickables, world.occluders);
      const hits = raycaster.intersectObjects(targets, false);
      if (!hits.length) { sfx.neutral(); return; }
      const hit = hits[0];
      const obj = hit.object;

      if (obj.userData.hider) {
        const h = obj.userData.hider;
        if (h.found) { sfx.neutral(); return; }
        if (hit.distance > CATCH_RANGE) {
          sfx.tooFar();
          showToast("👀 Something moved… get closer!");
          return;
        }
        catchHider(h);
        return;
      }
      if (state !== "play") { sfx.neutral(); return; }
      if (obj.userData.accuse) {
        // Misidentified a piece of furniture: time penalty.
        game.accuseCooldown = 0.5;
        const penMs = PENALTY_MS + (arena.dlv - 1) * 1500;   // 6s .. 12s
        game.remainMs -= penMs;
        sfx.penalty(); haptic("error");
        flash(el.flashBad);
        el.pen.textContent = "-" + penMs / 1000 + "s  (" + obj.userData.accuse + "?)";
        el.pen.classList.add("show");
        ctx.timeout(() => el.pen.classList.remove("show"), 900);
        updateTimerUI();
        try { ctx.platform.interact({ type: "wrong_accuse" }); } catch (_) {}
        if (game.remainMs <= 0) { game.remainMs = 0; updateTimerUI(); loseLevel(); }
        return;
      }
      sfx.neutral(); // walls / floor — no penalty, just a dull tick
    }

    function catchHider(h) {
      game.accuseCooldown = 0.4;
      revealHider(h);
      sfx.catch(); sfx.dance(); haptic("success");
      flash(el.flashGood);
      if (state !== "play") return; // peek mode: reveal is free
      game.found++;
      el.track.querySelector(".found").textContent = String(game.found);
      el.track.classList.remove("pop");
      void el.track.offsetWidth;
      el.track.classList.add("pop");
      showToast("🦎 You spotted " + h.name + "! " + (game.target - game.found) + " to go");
      try {
        ctx.platform.setProgress(game.found / game.target);
        ctx.platform.setScore(computeScore(arena.limit * 1000 - game.remainMs));
        ctx.platform.milestone("hider_found", { n: game.found });
        ctx.platform.interact({ type: "catch" });
      } catch (_) {}
      try { if (canMusic && ctx.music && musicOn) ctx.music.duck(0.5, 500); } catch (_) {}
      if (game.found >= game.target) {
        // Latch the win NOW: freeze the clock and capture the exact time so
        // the celebration delay, a queued penalty, or a pause can never turn
        // a completed hunt into a loss or inflate the recorded time.
        state = "won";
        resetPointers();
        const completionMs = arena.limit * 1000 - game.remainMs;
        ctx.timeout(() => { if (state === "won") winLevel(completionMs); }, 650);
      }
    }

    // =====================================================================
    // 16. Movement, collision, proximity cues, frame loop.
    // =====================================================================
    function collide() {
      for (const c of world.colliders) {
        if (player.groundY + 1.5 <= c.y0 || player.groundY + 0.2 >= c.y1) continue;
        const nx = clamp(player.x, c.x0, c.x1);
        const nz = clamp(player.z, c.z0, c.z1);
        const dx = player.x - nx, dz = player.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < RADIUS * RADIUS) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            player.x = nx + (dx / d) * RADIUS;
            player.z = nz + (dz / d) * RADIUS;
          } else {
            // Centre inside the box: push out along the smallest overlap.
            const pushL = player.x - c.x0 + RADIUS, pushR = c.x1 - player.x + RADIUS;
            const pushB = player.z - c.z0 + RADIUS, pushF = c.z1 - player.z + RADIUS;
            const m = Math.min(pushL, pushR, pushB, pushF);
            if (m === pushL) player.x = c.x0 - RADIUS;
            else if (m === pushR) player.x = c.x1 + RADIUS;
            else if (m === pushB) player.z = c.z0 - RADIUS;
            else player.z = c.z1 + RADIUS;
          }
        }
      }
    }

    let danceHue = 0;
    function update(dtMs, timeMs) {
      const dt = Math.min(dtMs, 50) / 1000;

      if (lastW !== ctx.width || lastH !== ctx.height) {
        lastW = ctx.width; lastH = ctx.height; resize();
      }
      if (!world) return;

      const playing = state === "play";
      const roaming = playing || state === "peek";

      // --- timers --- (same clamped delta as the simulation so slow
      // devices are not penalized and background gaps don't drain the clock)
      if (playing) {
        game.remainMs -= dt * 1000;
        if (game.accuseCooldown > 0) game.accuseCooldown -= dt;
        updateTimerUI();
        if (game.remainMs <= 15000 && game.remainMs > 0) {
          if ((game.lowTickAt -= dt) <= 0) { game.lowTickAt = 1; sfx.tick(); }
        }
        if (game.remainMs <= 0) {
          game.remainMs = 0; updateTimerUI(); loseLevel();
        }
      }

      // --- movement ---
      if (roaming && (move.x !== 0 || move.y !== 0)) {
        const hx = -Math.sin(camYaw), hz = -Math.cos(camYaw);
        const rx = -hz, rz = hx;
        let vx = hx * -move.y + rx * move.x;
        let vz = hz * -move.y + rz * move.x;
        const len = Math.hypot(vx, vz);
        if (len > 1) { vx /= len; vz /= len; }
        player.x += vx * SPEED * dt;
        player.z += vz * SPEED * dt;
        collide();
      }
      // Ground height (stairs / mezzanine in the toy store).
      const gy = world.groundAt ? world.groundAt(player.x, player.z, player.groundY) : 0;
      player.groundY += (gy - player.groundY) * Math.min(1, dt * 10);

      camera.position.set(player.x, player.groundY + EYE, player.z);
      camera.rotation.set(camPitch, camYaw, 0);

      // --- hider idle life: sway, blink, dance (frozen while paused so the
      // pause overlay can't be used to scout blink tells for free) ---
      if (state !== "paused") for (const h of world.hiders) {
        if (!h.found) {
          h.swayPh += dt;
          h.group.rotation.z = Math.sin(h.swayPh * 0.8) * (0.006 - world.spec.dlv * 0.00105);
          h.blinkAt -= dt;
          if (h.blinkAt <= 0) {
            h.blinkOn = 0.26;
            h.blinkAt = rnd(6, 12) + world.spec.dlv * 3;
          }
          if (h.blinkOn > 0) { h.blinkOn -= dt; h.eyes.visible = h.blinkOn > 0; }
        } else {
          h.danceT += dt;
          const t = h.danceT;
          h.group.position.y = h.y + Math.abs(Math.sin(t * 6)) * 0.22;
          h.group.rotation.y += dt * 3.2;
          h.group.rotation.z = Math.sin(t * 9) * 0.1;
          danceHue = (danceHue + dt * 0.25) % 1;
          for (let i = 0; i < h.parts.length; i++) {
            h.parts[i].material.color.setHSL((danceHue + i * 0.13) % 1, 0.85, 0.6);
          }
        }
      }

      // --- proximity giggle/whistle ---
      if (playing) {
        let nearest = Infinity;
        for (const h of world.hiders) {
          if (h.found) continue;
          const d = Math.hypot(h.x - player.x, h.z - player.z) + Math.abs(h.y - player.groundY) * 0.8;
          if (d < nearest) nearest = d;
        }
        if (nearest < 14) {
          game.cueTimer -= dt;
          if (game.cueTimer <= 0) {
            const closeness = clamp(1 - nearest / 14, 0, 1);
            sfx.cue((0.03 + closeness * 0.12) * (1 - world.spec.dlv * 0.12), game.cueFlip);
            game.cueFlip = !game.cueFlip;
            game.cueTimer = lerp(4.2, 1.1, closeness) * (1 + world.spec.dlv * 0.09);
            if (nearest < 3.5) haptic("light");
          }
        }
      }

      // --- museum kinetic sculptures + moiré scroll ---
      const tSec = timeMs * 0.001;
      for (const a of world.anims) {
        if (a.ry) a.mesh.rotation.y += a.ry * dt;
        if (a.rx) a.mesh.rotation.x += a.rx * dt;
        if (a.rz) a.mesh.rotation.z += a.rz * dt;
        if (a.bob) a.mesh.position.y = a.bob.baseY + Math.sin(tSec * a.bob.freq * 6.28 + a.bob.ph) * a.bob.amp;
        if (a.sway) a.mesh.rotation[a.sway.axis] = Math.sin(tSec * a.sway.freq * 6.28 + a.sway.ph) * a.sway.amp;
        if (a.orbit) {
          const an = tSec * a.orbit.speed + a.orbit.ph;
          a.mesh.position.set(a.orbit.cx + Math.cos(an) * a.orbit.r, a.orbit.y, a.orbit.cz + Math.sin(an) * a.orbit.r);
          a.mesh.rotation.y = -an;
        }
        if (a.flickerMat) {
          const v = 0.72 + 0.2 * Math.sin(tSec * 13.7) * Math.sin(tSec * 3.1) + 0.08 * Math.sin(tSec * 27.3);
          a.flickerMat.color.setRGB(0.16 * v, 0.25 * v, 0.34 * v);
        }
      }
      for (const t of world.animTex) t.offset.x += dt * 0.02;
      if (world.dust) {
        const du = world.dust, dp = du.pts.geometry.attributes.position;
        for (let i = 0; i < du.n; i++) {
          const ix = i * 3;
          dp.array[ix] += du.vel[i][0] * dt;
          dp.array[ix + 1] += du.vel[i][1] * dt;
          dp.array[ix + 2] += du.vel[i][2] * dt;
          if (dp.array[ix + 1] < 0.15 || dp.array[ix + 1] > du.h) du.vel[i][1] *= -1;
          if (dp.array[ix] < -du.w) dp.array[ix] = du.w; else if (dp.array[ix] > du.w) dp.array[ix] = -du.w;
          if (dp.array[ix + 2] < -du.d) dp.array[ix + 2] = du.d; else if (dp.array[ix + 2] > du.d) dp.array[ix + 2] = -du.d;
        }
        dp.needsUpdate = true;
      }

      // --- confetti ---
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.life -= dt;
        const pos = b.pts.geometry.attributes.position;
        for (let j = 0; j < b.vel.length; j++) {
          b.vel[j][1] -= 7 * dt;
          pos.array[j * 3] += b.vel[j][0] * dt;
          pos.array[j * 3 + 1] += b.vel[j][1] * dt;
          pos.array[j * 3 + 2] += b.vel[j][2] * dt;
        }
        pos.needsUpdate = true;
        b.pts.material.opacity = clamp(b.life / 1.4, 0, 1);
        if (b.life <= 0) {
          world.group.remove(b.pts);
          b.pts.geometry.dispose();
          b.pts.material.dispose();
          bursts.splice(i, 1);
        }
      }

      renderer.render(scene3, camera);
    }

    threeReady = true;
    ctx.onFrame(update);

    ctx.onDestroy(() => {
      disposeWorld();
      try { if (canMusic && ctx.music && musicOn) ctx.music.stop({ fadeOutMs: 200 }); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
      if (AC) { try { AC.close(); } catch (_) {} }
    });
  }
};
