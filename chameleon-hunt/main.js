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
        display:flex; gap:10px; pointer-events:none; z-index:30; }
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
        font-size:30px; font-weight:800; letter-spacing:1px; padding:4px 18px; border-radius:999px;
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
            ❌ Wrong accusations cost <b>+6 seconds</b>.<br>
            🫥 Hiders match the surface they lean on —<br>
            &nbsp;&nbsp;&nbsp;&nbsp;watch for <b>blinking eyes</b> and odd bumps.<br>
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
      const s = Math.max(0, Math.round(ms / 1000));
      return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
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
    const ARENAS = [
      { id: "living_room", name: "Living Room", icon: "🛋️", diff: "Very Easy", dlv: 1,
        targets: 3, limit: 120, mismatch: 0.22, preset: "cozy",
        blurb: "Low-poly sofas, TV unit, bookshelves",
        bots: [["SpeedySeeker", 41], ["EagleEye", 63], ["SofaSpotter", 88], ["NapMaster", 117]] },
      { id: "kitchen", name: "Kitchen & Dining", icon: "🍳", diff: "Easy", dlv: 2,
        targets: 4, limit: 160, mismatch: 0.15, preset: "lofi",
        blurb: "Counters, fridge, dining table",
        bots: [["PanScanner", 58], ["SousChef", 84], ["FridgeRaider", 116], ["Slowcooker", 149]] },
      { id: "bedroom", name: "Master Bedroom", icon: "🛏️", diff: "Medium", dlv: 3,
        targets: 5, limit: 200, mismatch: 0.10, preset: "drift",
        blurb: "Big bed, wardrobes, curtains, vanity",
        bots: [["DreamCatcher", 79], ["PillowHawk", 108], ["DustBunny", 141], ["Snoozer", 178]] },
      { id: "toy_store", name: "Toy Store", icon: "🧸", diff: "Hard", dlv: 4,
        targets: 6, limit: 260, mismatch: 0.06, preset: "bubble",
        blurb: "Two floors, wild shelves, giant teddies",
        bots: [["ToyHunter", 104], ["BrickByBrick", 139], ["TeddyTracker", 181], ["LostInAisles", 226]] },
      { id: "museum", name: "Art Museum", icon: "🗿", diff: "Very Hard", dlv: 5,
        targets: 7, limit: 320, mismatch: 0.035, preset: "spooky",
        blurb: "Abstract statues, shifting patterns",
        bots: [["ArtDetective", 132], ["CuratorX", 174], ["GalleryGhost", 221], ["StatueStarer", 272]] }
    ];
    const HIDER_NAMES = ["Marco", "Polo", "Blinky", "Willow", "Dot", "Pixel", "Fern", "Ziggy", "Mo", "Luna",
      "Basil", "Coco", "Twig", "Sage", "Pepper", "Olive", "Rusty", "Ivy", "Nib", "Echo"];
    const PENALTY_MS = 6000;
    const CATCH_RANGE = 9;

    function unlockedCount() { return clamp(store.get("unlocked", 1), 1, ARENAS.length); }

    // Local leaderboards: one array per arena, seeded with 4 bots, sorted
    // fastest-first. Entries: { name, ms, bot }.
    function loadBoard(a) {
      let b = store.get("lb_" + a.id, null);
      if (!Array.isArray(b) || !b.length) {
        b = a.bots.map(([name, sec]) => ({ name, ms: sec * 1000, bot: true }));
        b.sort((x, y) => x.ms - y.ms);
        store.set("lb_" + a.id, b);
      }
      return b;
    }
    function saveBoard(a, b) { store.set("lb_" + a.id, b.slice(0, 10)); }
    function qualifies(a, ms) {
      const b = loadBoard(a);
      return b.length < 10 || ms < b[b.length - 1].ms;
    }

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
        if (!musicOn) {
          ctx.music.unlock();
          ctx.music.play({ preset, volume: volume, fadeInMs: 900 });
          musicOn = true;
        } else {
          const st = ctx.music.state && ctx.music.state();
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
    let state = "menu";       // menu | select | play | paused | result
    let everStarted = false;  // first user gesture happened
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

    // Leaderboard overlay.
    let lbTab = 0;
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
      const board = loadBoard(a);
      const myName = store.get("pname", null);
      el.lbList.innerHTML = "";
      if (!board.length) {
        el.lbList.innerHTML = '<div class="ch-lbempty">No times yet — be the first!</div>';
        return;
      }
      board.forEach((e, i) => {
        const row = document.createElement("div");
        row.className = "ch-lbrow" + (!e.bot && myName && e.name === myName ? " you" : "");
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
        row.innerHTML = `<div class="r">${medal}</div><div class="nm">${e.bot ? "🤖 " : ""}${e.name}</div>
          <div class="sc">${fmtMsPrecise(e.ms)}</div>`;
        el.lbList.appendChild(row);
      });
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
    try {
      THREE = await ctx.importModule("three", "0.164.1");
      if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    } catch (err) {
      THREE = null;
    }
    if (!THREE || !THREE.WebGLRenderer) {
      const fatal = document.createElement("div");
      fatal.className = "ch-fatal";
      fatal.innerHTML = "<div><div style='font-size:40px;'>🦎💤</div><div style='font-size:16px;font-weight:700;margin-top:8px;'>The chameleons couldn't load their 3D world.</div><div style='font-size:13px;opacity:.75;margin-top:6px;'>Please close and reopen this Bit.</div></div>";
      ui.appendChild(fatal);
      try { ctx.platform.error({ reason: "three_import_failed" }); } catch (_) {}
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0b1d16, 1);

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
    function makeHider(spot, mismatch, name) {
      const g = new THREE.Group();
      const parts = [];
      const H = {
        group: g, parts, name, found: false,
        x: spot.x, z: spot.z, y: spot.y || 0,
        blinkAt: rnd(2, 7), blinkOn: 0, swayPh: rnd(0, 6.28), danceT: 0,
        eyes: null, matKey: spot.mat
      };
      const crouch = spot.pose === "crouch";
      function part(w, h, d, x, y, z) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hiderMatFor(spot.mat, mismatch, Math.max(w, d), h));
        m.position.set(x, y, z);
        m.userData.hider = H;
        parts.push(m); g.add(m);
        return m;
      }
      if (!crouch) {
        part(0.16, 0.6, 0.17, -0.11, 0.3, 0);   // legs
        part(0.16, 0.6, 0.17, 0.11, 0.3, 0);
        part(0.44, 0.58, 0.24, 0, 0.89, 0);     // torso
        part(0.12, 0.5, 0.13, -0.29, 0.9, 0);   // arms
        part(0.12, 0.5, 0.13, 0.29, 0.9, 0);
        part(0.3, 0.3, 0.28, 0, 1.36, 0);       // head
        H.headY = 1.36; H.height = 1.55;
      } else {
        part(0.2, 0.34, 0.2, -0.13, 0.17, 0.05);
        part(0.2, 0.34, 0.2, 0.13, 0.17, 0.05);
        part(0.48, 0.5, 0.3, 0, 0.55, 0);
        part(0.12, 0.4, 0.13, -0.31, 0.5, 0.02);
        part(0.12, 0.4, 0.13, 0.31, 0.5, 0.02);
        part(0.3, 0.28, 0.28, 0, 0.97, 0.02);
        H.headY = 0.97; H.height = 1.15;
      }
      // Blinking eyes: the fairness tell on heavily camouflaged hiders.
      const eyeG = new THREE.Group();
      const eyeMatW = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const eyeMatB = new THREE.MeshBasicMaterial({ color: 0x101014 });
      for (const sx of [-0.07, 0.07]) {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMatW);
        w.position.set(sx, H.headY + 0.02, 0.15);
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), eyeMatB);
        p.position.set(sx, H.headY + 0.02, 0.182);
        eyeG.add(w, p);
      }
      eyeG.visible = false;
      H.eyes = eyeG;
      g.add(eyeG);

      g.position.set(spot.x, H.y, spot.z);
      g.rotation.y = spot.ry || 0;
      world.group.add(g);
      world.hiders.push(H);
      for (const p of parts) world.hiderMeshes.push(p);
      return H;
    }

    function revealHider(h) {
      h.found = true;
      h.eyes.visible = true;
      h.danceT = 0.0001;
      for (const p of h.parts) {
        p.material.map = null;
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
        anims: [], groundAt: null, spawn: { x: 0, z: 6, yaw: 0 }, spec
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

    function buildLivingRoom() {
      surf("wallCream", { color: 0xe8dcc8 });
      surf("wallAccent", { canvas: P.stripes("#c96f4a", "#b45f3e", 8, false), density: 0.55, color: 0xc96f4a });
      surf("floorWood", { canvas: P.wood("#8a6642", "#6f5230"), density: 0.4, color: 0x8a6642 });
      surf("rug", { canvas: P.dots("#6d4380", "#8f5ba6", 6, 0.24), density: 0.7, color: 0x6d4380 });
      surf("sofaBlue", { canvas: P.noise("#3f6ea8", 0.07), density: 0.9, color: 0x3f6ea8 });
      surf("sofaTan", { canvas: P.noise("#c9a06a", 0.07), density: 0.9, color: 0xc9a06a });
      surf("shelfWood", { canvas: P.wood("#6b4a2e", "#563a21"), density: 0.7, color: 0x6b4a2e });
      surf("tvBlack", { color: 0x1c1c22 });
      surf("plantGreen", { canvas: P.noise("#3e7d3a", 0.1), density: 1.1, color: 0x3e7d3a });
      surf("lampShade", { color: 0xe8d9a8 });
      surf("curtain", { canvas: P.stripes("#7d9ec4", "#6b8db4", 6, false), density: 0.8, color: 0x7d9ec4 });

      shell(22, 16, 3.5, "floorWood", ["wallAccent", "wallCream", "wallCream", "wallCream"], 0xf2ece0);
      PL("rug", 6.5, 4.5, 0, 0.02, 1, -Math.PI / 2, 0, {});

      // Sofa A (south wall, faces north)
      B("sofaBlue", 3.2, 0.55, 1.15, -4, 0, 5.6, 0, { pick: true, name: "the blue sofa", solid: true });
      B("sofaBlue", 3.2, 0.75, 0.3, -4, 0.55, 6.1, 0, { pick: true, name: "the blue sofa" });
      B("sofaBlue", 0.35, 0.62, 1.15, -5.6, 0.35, 5.6, 0, { pick: true, name: "the blue sofa" });
      B("sofaBlue", 0.35, 0.62, 1.15, -2.4, 0.35, 5.6, 0, { pick: true, name: "the blue sofa" });
      // Sofa B (east side, faces west)
      B("sofaTan", 1.15, 0.55, 2.6, 5.2, 0, 4.2, 0, { pick: true, name: "the tan sofa", solid: true });
      B("sofaTan", 0.3, 0.75, 2.6, 5.72, 0.55, 4.2, 0, { pick: true, name: "the tan sofa" });
      // Coffee table
      B("shelfWood", 1.7, 0.42, 0.95, -0.4, 0, 2.3, 0, { pick: true, name: "the coffee table", solid: true });
      // TV unit + screen on north wall
      B("shelfWood", 3.4, 0.5, 0.55, 0, 0, -7.4, 0, { pick: true, name: "the TV unit", solid: true });
      B("tvBlack", 2.7, 1.5, 0.12, 0, 0.9, -7.68, 0, { pick: true, name: "the TV" });
      glow(0x2a3f55, 2.5, 1.3, 0, 1.65, -7.6, 0);
      // Bookshelves (west wall)
      for (const bz of [-2.2, 2.4]) {
        B("shelfWood", 0.45, 2.4, 1.9, -10.6, 0, bz, 0, { pick: true, name: "the bookshelf", solid: true });
        for (let s = 0; s < 4; s++) {
          const cols = [0xc94f44, 0x3f6ea8, 0xe0b23c, 0x4f9a55, 0x8f5ba6];
          for (let b = 0; b < 5; b++) {
            const bm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.24),
              new THREE.MeshLambertMaterial({ color: cols[(s * 2 + b) % cols.length] }));
            bm.position.set(-10.5, 0.45 + s * 0.52, bz - 0.72 + b * 0.34);
            meshOpts(bm, { pick: true, name: "the books" });
          }
        }
      }
      // Plant, floor lamp, armchair, curtains + window (east wall)
      C("shelfWood", 0.3, 0.38, 0.5, 9.6, 0, 6.6, { pick: true, name: "the plant pot", solid: true });
      SP("plantGreen", 0.72, 9.6, 1.35, 6.6, { pick: true, name: "the plant" });
      C("tvBlack", 0.04, 0.16, 1.75, 8.2, 0, -5.4, { pick: true, name: "the lamp", solid: true });
      C("lampShade", 0.34, 0.44, 0.42, 8.2, 1.72, -5.4, { pick: true, name: "the lamp" });
      B("sofaTan", 1.15, 0.5, 1.1, 6.6, 0, -3.2, 0, { pick: true, name: "the armchair", solid: true });
      B("sofaTan", 0.3, 0.7, 1.1, 7.12, 0.5, -3.2, 0, { pick: true, name: "the armchair" });
      glow(0xbcd8ee, 2.6, 1.7, 10.82, 1.9, 1.2, -Math.PI / 2);
      PL("curtain", 1.1, 2.9, 10.7, 1.55, -0.5, 0, -Math.PI / 2, { pick: true, name: "the curtain" });
      PL("curtain", 1.1, 2.9, 10.7, 1.55, 2.9, 0, -Math.PI / 2, { pick: true, name: "the curtain" });

      world.spawn = { x: 0, z: 6.8, yaw: 0 };
      return [
        { x: -1.8, z: 7.55, ry: Math.PI, mat: "wallCream", pose: "stand" },
        { x: 7.6, z: 7.55, ry: Math.PI, mat: "wallCream", pose: "stand" },
        { x: -8.4, z: -7.5, ry: 0, mat: "wallAccent", pose: "stand" },
        { x: 4.3, z: -7.5, ry: 0, mat: "wallAccent", pose: "stand" },
        { x: -10.45, z: 5.2, ry: Math.PI / 2, mat: "wallCream", pose: "stand" },
        { x: 10.45, z: -4.4, ry: -Math.PI / 2, mat: "wallCream", pose: "stand" },
        { x: -1.4, z: 0.2, ry: 0.4, mat: "rug", pose: "crouch" },
        { x: 1.4, z: 3.2, ry: -0.5, mat: "floorWood", pose: "crouch" },
        { x: -4.1, z: 4.85, ry: Math.PI, mat: "sofaBlue", pose: "stand" },
        { x: 4.35, z: 3.1, ry: -Math.PI / 2, mat: "sofaTan", pose: "crouch" },
        { x: -10.2, z: 0.1, ry: Math.PI / 2, mat: "shelfWood", pose: "stand" },
        { x: -10.2, z: 4.6, ry: Math.PI / 2, mat: "shelfWood", pose: "stand" },
        { x: 1.9, z: -7.3, ry: 0, mat: "tvBlack", pose: "stand" },
        { x: 8.9, z: 5.7, ry: 0.6, mat: "plantGreen", pose: "crouch" },
        { x: 10.4, z: 1.15, ry: -Math.PI / 2, mat: "curtain", pose: "stand" },
        { x: 8.15, z: -4.55, ry: 0, mat: "lampShade", pose: "stand" }
      ];
    }

    function buildKitchen() {
      surf("wallTile", { canvas: P.checker("#dfe8ea", "#c6d3d8", 10), density: 1.1, color: 0xdfe8ea });
      surf("wallPaint", { color: 0xeef0e2 });
      surf("floorTile", { canvas: P.checker("#b9b0a2", "#a59b8c", 8), density: 0.55, color: 0xb9b0a2 });
      surf("counterTop", { color: 0xd8d8d2 });
      surf("cabinetBlue", { canvas: P.noise("#4a6f8a", 0.05), density: 0.8, color: 0x4a6f8a });
      surf("fridgeSteel", { canvas: P.noise("#b8bec4", 0.05), density: 0.9, color: 0xb8bec4 });
      surf("tableWood", { canvas: P.wood("#9a6b3f", "#82552b"), density: 0.6, color: 0x9a6b3f });
      surf("chairRed", { color: 0xa83c34 });
      surf("ovenBlack", { color: 0x26262a });
      surf("pantryWood", { canvas: P.wood("#6b4a2e", "#563a21"), density: 0.7, color: 0x6b4a2e });

      shell(22, 16, 3.5, "floorTile", ["wallTile", "wallPaint", "wallPaint", "wallPaint"], 0xf0f2e8);

      // L-shaped counter along the north + west walls.
      B("cabinetBlue", 12, 0.95, 1.2, -4, 0, -7.3, 0, { pick: true, name: "the counter", solid: true });
      B("counterTop", 12.2, 0.08, 1.3, -4, 0.95, -7.3, 0, { pick: true, name: "the counter" });
      B("cabinetBlue", 1.2, 0.95, 6.5, -10.3, 0, -3.2, 0, { pick: true, name: "the counter", solid: true });
      B("counterTop", 1.3, 0.08, 6.7, -10.3, 0.95, -3.2, 0, { pick: true, name: "the counter" });
      // Stove + oven face
      B("ovenBlack", 1.5, 0.85, 0.1, -4.4, 0.05, -6.63, 0, { pick: true, name: "the oven" });
      B("ovenBlack", 1.5, 0.06, 1.1, -4.4, 1.03, -7.3, 0, { pick: true, name: "the stove" });
      // Fridge
      B("fridgeSteel", 1.3, 2.25, 1.2, 4.1, 0, -7.25, 0, { pick: true, name: "the fridge", solid: true });
      B("ovenBlack", 0.08, 0.5, 0.06, 3.62, 1.2, -6.62, 0, { pick: true, name: "the fridge" });
      // Upper cabinets on the north wall
      B("cabinetBlue", 7, 0.8, 0.5, -6, 2.1, -7.65, 0, { pick: true, name: "the cabinets" });
      // Island
      B("cabinetBlue", 3.1, 0.95, 1.5, 0, 0, -2.4, 0, { pick: true, name: "the island", solid: true });
      B("counterTop", 3.3, 0.08, 1.7, 0, 0.95, -2.4, 0, { pick: true, name: "the island" });
      C("chairRed", 0.14, 0.16, 0.24, 0.9, 1.03, -2.4, { pick: true, name: "the pot" });
      // Dining table + chairs
      B("tableWood", 2.7, 0.1, 1.7, 4.5, 0.72, 3.5, 0, { pick: true, name: "the dining table" });
      for (const [lx, lz] of [[-1.15, -0.65], [1.15, -0.65], [-1.15, 0.65], [1.15, 0.65]])
        B("tableWood", 0.12, 0.72, 0.12, 4.5 + lx, 0, 3.5 + lz, 0, { pick: true, name: "the dining table" });
      collider(4.5, 3.5, 2.9, 1.9, 0, 1.4);
      for (const [cx, cz, cry] of [[2.9, 3.1, Math.PI / 2], [6.1, 3.9, -Math.PI / 2], [4.1, 5.05, Math.PI], [4.9, 1.95, 0]]) {
        B("chairRed", 0.5, 0.45, 0.5, cx, 0, cz, cry, { pick: true, name: "a chair", solid: true });
        B("chairRed", 0.5, 0.55, 0.1, cx - Math.sin(cry) * 0.2, 0.45, cz - Math.cos(cry) * 0.2, cry, { pick: true, name: "a chair" });
      }
      // Pantry shelves (east wall)
      B("pantryWood", 0.5, 2.4, 3.4, 10.55, 0, -1.8, 0, { pick: true, name: "the pantry", solid: true });
      for (let s = 0; s < 3; s++) for (let b = 0; b < 4; b++) {
        const jm = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 10),
          new THREE.MeshLambertMaterial({ color: [0xc98d3c, 0x8aa84a, 0xa85c78, 0xd8c05a][(s + b) % 4] }));
        jm.position.set(10.4, 0.55 + s * 0.6, -3.1 + b * 0.85);
        meshOpts(jm, { pick: true, name: "the jars" });
      }
      glow(0xd8ecf6, 2.4, 1.6, 2, 2, 7.98, Math.PI);

      world.spawn = { x: -3, z: 6.5, yaw: 0.3 };
      return [
        { x: 2.7, z: -7.35, ry: 0, mat: "wallTile", pose: "stand" },
        { x: -10.4, z: 2.7, ry: Math.PI / 2, mat: "wallPaint", pose: "stand" },
        { x: 10.45, z: 4.2, ry: -Math.PI / 2, mat: "wallPaint", pose: "stand" },
        { x: -3.2, z: 7.55, ry: Math.PI, mat: "wallPaint", pose: "stand" },
        { x: 7.6, z: 7.55, ry: Math.PI, mat: "wallPaint", pose: "stand" },
        { x: -1.95, z: -2.4, ry: -Math.PI / 2, mat: "cabinetBlue", pose: "crouch" },
        { x: 1.95, z: -2.4, ry: Math.PI / 2, mat: "cabinetBlue", pose: "crouch" },
        { x: 5.1, z: -6.6, ry: 0, mat: "fridgeSteel", pose: "stand" },
        { x: -6.2, z: -6.35, ry: 0, mat: "cabinetBlue", pose: "crouch" },
        { x: 4.5, z: 2.5, ry: Math.PI, mat: "tableWood", pose: "crouch" },
        { x: 4.5, z: 4.55, ry: 0, mat: "tableWood", pose: "crouch" },
        { x: 6.75, z: 3.35, ry: Math.PI / 2, mat: "chairRed", pose: "crouch" },
        { x: 10.15, z: 0.4, ry: -Math.PI / 2, mat: "pantryWood", pose: "stand" },
        { x: -9.5, z: 0.6, ry: Math.PI / 2, mat: "cabinetBlue", pose: "crouch" },
        { x: -1.4, z: -6.35, ry: 0, mat: "cabinetBlue", pose: "crouch" },
        { x: -4.5, z: 1.6, ry: 0.5, mat: "floorTile", pose: "crouch" }
      ];
    }

    function buildBedroom() {
      surf("wallRose", { color: 0xd8b8b0 });
      surf("wallPaper", { canvas: P.dots("#cfc3de", "#b3a2cc", 7, 0.2), density: 1.2, color: 0xcfc3de });
      surf("carpet", { canvas: P.noise("#9a8f9c", 0.05), density: 0.8, color: 0x9a8f9c });
      surf("duvet", { canvas: P.checker("#7d9ec4", "#6b8db4", 6), density: 0.9, color: 0x7d9ec4 });
      surf("bedWood", { canvas: P.wood("#7a5838", "#644728"), density: 0.6, color: 0x7a5838 });
      surf("pillow", { color: 0xf0ead8 });
      surf("wardrobe", { canvas: P.wood("#5f4630", "#4c3722"), density: 0.65, color: 0x5f4630 });
      surf("curtainB", { canvas: P.stripes("#c98ba0", "#b87890", 6, false), density: 0.85, color: 0xc98ba0 });
      surf("vanity", { canvas: P.wood("#b08a5c", "#997344"), density: 0.7, color: 0xb08a5c });
      surf("dresser", { color: 0x4a8a8c });
      surf("rugOval", { canvas: P.dots("#8c5a4a", "#a5705c", 6, 0.25), density: 0.8, color: 0x8c5a4a });

      shell(22, 17, 3.6, "carpet", ["wallPaper", "wallRose", "wallRose", "wallRose"], 0xefe6e2);

      // Big bed against the north wall.
      B("bedWood", 3.4, 0.4, 4.4, 0, 0, -5.6, 0, { pick: true, name: "the bed", solid: true });
      B("duvet", 3.2, 0.36, 3.2, 0, 0.4, -5.1, 0, { pick: true, name: "the duvet" });
      B("pillow", 1.2, 0.24, 0.7, -0.8, 0.44, -7.1, 0, { pick: true, name: "a pillow" });
      B("pillow", 1.2, 0.24, 0.7, 0.8, 0.44, -7.1, 0, { pick: true, name: "a pillow" });
      B("bedWood", 3.4, 1.25, 0.18, 0, 0, -7.85, 0, { pick: true, name: "the headboard" });
      // Nightstands + lamps
      for (const nx of [-2.3, 2.3]) {
        B("bedWood", 0.7, 0.55, 0.6, nx, 0, -7.4, 0, { pick: true, name: "the nightstand", solid: true });
        C("pillow", 0.16, 0.2, 0.3, nx, 0.55, -7.4, { pick: true, name: "the little lamp" });
      }
      // Wardrobe row (east wall)
      for (let i = 0; i < 3; i++)
        B("wardrobe", 0.7, 2.6, 1.7, 10.4, 0, -3 + i * 2, 0, { pick: true, name: "the wardrobe", solid: true });
      // Curtains + window (west wall)
      glow(0xe8d8ee, 2.6, 1.9, -10.82, 1.9, 0.4, Math.PI / 2);
      PL("curtainB", 1.15, 3.1, -10.68, 1.65, -1.6, 0, Math.PI / 2, { pick: true, name: "the curtain" });
      PL("curtainB", 1.15, 3.1, -10.68, 1.65, 2.4, 0, Math.PI / 2, { pick: true, name: "the curtain" });
      // Vanity with mirror (south-east)
      B("vanity", 1.9, 0.75, 0.6, 6, 0, 7.7, 0, { pick: true, name: "the vanity", solid: true });
      glow(0xd8e8f0, 1.2, 1.3, 6, 1.9, 8.1, Math.PI);
      B("vanity", 0.45, 0.45, 0.45, 4.6, 0, 7.1, 0, { pick: true, name: "the stool", solid: true });
      // Dresser (south-west)
      B("dresser", 2.2, 1.15, 0.7, -6, 0, 7.6, 0, { pick: true, name: "the dresser", solid: true });
      // Oval rug
      const rugM = matFor("rugOval", 4, 3);
      const rug = new THREE.Mesh(new THREE.CircleGeometry(2.1, 22), rugM);
      rug.rotation.x = -Math.PI / 2; rug.position.set(0.4, 0.02, 1.6); rug.scale.x = 1.35;
      meshOpts(rug, {});

      world.spawn = { x: -4, z: 6.6, yaw: -0.4 };
      return [
        { x: -4.2, z: -8.05, ry: 0, mat: "wallPaper", pose: "stand" },
        { x: 5.2, z: -8.05, ry: 0, mat: "wallPaper", pose: "stand" },
        { x: -10.45, z: 5.2, ry: Math.PI / 2, mat: "wallRose", pose: "stand" },
        { x: 10.45, z: 6.4, ry: -Math.PI / 2, mat: "wallRose", pose: "stand" },
        { x: 1.8, z: 8.1, ry: Math.PI, mat: "wallRose", pose: "stand" },
        { x: -2.05, z: -4.6, ry: -Math.PI / 2, mat: "duvet", pose: "crouch" },
        { x: 2.05, z: -5.5, ry: Math.PI / 2, mat: "duvet", pose: "crouch" },
        { x: 0.3, z: -3, ry: 0, mat: "bedWood", pose: "crouch" },
        { x: 9.9, z: -3, ry: -Math.PI / 2, mat: "wardrobe", pose: "stand" },
        { x: 9.9, z: 1, ry: -Math.PI / 2, mat: "wardrobe", pose: "stand" },
        { x: -10.35, z: -1.6, ry: Math.PI / 2, mat: "curtainB", pose: "stand" },
        { x: -10.35, z: 2.4, ry: Math.PI / 2, mat: "curtainB", pose: "stand" },
        { x: 5.5, z: 7.1, ry: Math.PI, mat: "vanity", pose: "crouch" },
        { x: -6, z: 6.9, ry: Math.PI, mat: "dresser", pose: "crouch" },
        { x: 0.9, z: 1.7, ry: 0.7, mat: "rugOval", pose: "crouch" },
        { x: -5.4, z: 2.6, ry: 0, mat: "carpet", pose: "crouch" },
        { x: 10.45, z: -6.6, ry: -Math.PI / 2, mat: "wallRose", pose: "stand" }
      ];
    }

    function buildToyStore() {
      const MEZZ = 3.1;
      surf("wallSky", { color: 0xcfe8f4 });
      surf("wallRainbow", { canvas: P.rainbow(["#e05252", "#e8a23c", "#e8d43c", "#52b05e", "#4a7fd0", "#8f5ba6"]), density: 0.4, color: 0xe8a23c });
      surf("floorCheck", { canvas: P.checker("#f2e6c8", "#e5d0a2", 8), density: 0.55, color: 0xf2e6c8 });
      surf("mezzPink", { color: 0xd8788c });
      surf("shelfRed", { color: 0xc94f44 });
      surf("shelfBlue", { color: 0x3f6ea8 });
      surf("shelfYellow", { color: 0xe0b23c });
      surf("shelfGreen", { color: 0x4f9a55 });
      surf("boxKraft", { canvas: P.noise("#b58a54", 0.07), density: 0.9, color: 0xb58a54 });
      surf("teddyBrown", { canvas: P.noise("#8a5c38", 0.1), density: 1.3, color: 0x8a5c38 });
      surf("teddyPink", { canvas: P.noise("#d888a8", 0.1), density: 1.3, color: 0xd888a8 });
      surf("ballPit", { canvas: P.dots("#3f6ea8", "#ffd25e", 5, 0.3), density: 1.4, color: 0x3f6ea8 });
      surf("counterPurple", { color: 0x7a4a8c });
      surf("stairWood", { canvas: P.wood("#9a6b3f", "#82552b"), density: 0.6, color: 0x9a6b3f });

      shell(24, 18, 6.4, "floorCheck", ["wallSky", "wallRainbow", "wallSky", "wallSky"], 0xe8f2f8);

      // --- Mezzanine slab over the north strip (z in [-9,-3]) ---
      B("mezzPink", 24, 0.25, 6, 0, MEZZ - 0.25, -6, 0, { pick: false, occlude: true });
      PL("floorCheck", 24, 6, 0, MEZZ + 0.01, -6, -Math.PI / 2, 0, {});
      // Stairs up (x 8.2..10.8, climbing from z=3 down to z=-3)
      const stairMat = matFor("stairWood", 2.6, 0.5);
      for (let s = 0; s < 10; s++) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.31, 0.62), stairMat);
        st.position.set(9.5, 0.155 + s * MEZZ / 10, 2.7 - s * 0.6);
        st.userData.neutral = true;
        world.occluders.push(st);
        world.group.add(st);
      }
      // Stair side rails + mezzanine railing (gap where the stairs land)
      collider(8.0, 0, 0.25, 6.4, 0, 4.5);       // stair west rail
      collider(11.1, 0, 0.25, 6.4, 0, 4.5);      // stair east rail (wall side)
      B("counterPurple", 0.12, 1.0, 6.2, 8.06, 0, 0, 0, { pick: false, occlude: true });
      for (let rx = -11; rx < 8; rx += 1.2) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 0.09), matFor("counterPurple", 0.1, 1));
        post.position.set(rx, MEZZ + 0.45, -3.05);
        post.userData.neutral = true; world.occluders.push(post); world.group.add(post);
      }
      B("counterPurple", 19.2, 0.1, 0.1, -1.6, MEZZ + 0.9, -3.05, 0, { pick: false, occlude: true });
      collider(-2, -3.05, 20.4, 0.3, MEZZ, MEZZ + 1.6);   // mezz railing blocks walking off
      // Under-mezzanine headroom blocker for the slab isn't needed (slab y0 = MEZZ-0.25 > player head).

      world.groundAt = (x, z, cur) => {
        if (x > 8.2 && x < 10.8 && z > -3.2 && z < 3.2) return MEZZ * clamp((3 - z) / 6, 0, 1);
        if (z < -3.05) return cur > 1.55 ? MEZZ : 0;
        return 0;
      };

      // --- Ground-floor shelves (each a bright gondola with toy blobs) ---
      function gondola(key, x, z, w) {
        B(key, w, 1.8, 0.9, x, 0, z, 0, { pick: true, name: "the " + key.replace("shelf", "").toLowerCase() + " shelf", solid: true });
        for (let i = 0; i < Math.floor(w / 0.8); i++) {
          const tm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8),
            new THREE.MeshLambertMaterial({ color: [0xff8080, 0x80c8ff, 0xffe080, 0xa0e8a0, 0xe0a0ff][i % 5] }));
          tm.position.set(x - w / 2 + 0.5 + i * 0.8, 1.95, z);
          meshOpts(tm, { pick: true, name: "a toy" });
        }
      }
      gondola("shelfRed", -6.5, -0.6, 6);
      gondola("shelfBlue", -6.5, 3.6, 6);
      gondola("shelfYellow", 1.5, 1.4, 5);
      gondola("shelfGreen", 1.5, 5.8, 5);
      // Box stacks
      B("boxKraft", 1.1, 1.1, 1.1, 5.6, 0, -1.4, 0.3, { pick: true, name: "a box", solid: true });
      B("boxKraft", 0.85, 0.85, 0.85, 5.7, 1.1, -1.3, -0.2, { pick: true, name: "a box" });
      B("boxKraft", 1.1, 1.1, 1.1, -11, 0, 7.4, 0.2, { pick: true, name: "a box", solid: true });
      // Giant teddy under the mezzanine (ground floor)
      function teddy(key, x, z, s, y0, name) {
        SP(key, 0.85 * s, x, y0 + 0.85 * s, z, { pick: true, name, solid: true });
        SP(key, 0.55 * s, x, y0 + 1.95 * s, z, { pick: true, name });
        for (const ex of [-0.42, 0.42]) SP(key, 0.2 * s, x + ex * s, y0 + 2.35 * s, z, { pick: true, name });
        for (const ax of [-0.85, 0.85]) SP(key, 0.28 * s, x + ax * s, y0 + 1.0 * s, z + 0.1 * s, { pick: true, name });
        for (const lx of [-0.5, 0.5]) SP(key, 0.32 * s, x + lx * s, y0 + 0.3 * s, z + 0.55 * s, { pick: true, name });
      }
      teddy("teddyBrown", -9, -6.5, 1.05, 0, "the giant teddy");
      teddy("teddyPink", -6, -6.2, 0.85, MEZZ, "the pink teddy");
      // Ball pit (south-east)
      B("ballPit", 3.6, 0.55, 2.6, 9.2, 0, 6.8, 0, { pick: true, name: "the ball pit", solid: true });
      PL("ballPit", 3.3, 2.3, 9.2, 0.56, 6.8, -Math.PI / 2, 0, { pick: true, name: "the ball pit" });
      // Checkout counter
      B("counterPurple", 2.6, 1.0, 0.9, -2.5, 0, 7.6, 0, { pick: true, name: "the counter", solid: true });
      // Mezzanine shelves
      B("shelfYellow", 5, 1.6, 0.8, -1, MEZZ, -6.2, 0, { pick: true, name: "the yellow shelf", solid: true });
      B("shelfRed", 4, 1.6, 0.8, 4.5, MEZZ, -7.6, 0, { pick: true, name: "the red shelf", solid: true });
      glow(0xfff2c8, 3, 1.8, 0, 4.6, -8.82, 0);

      world.spawn = { x: -5.5, z: 7.5, yaw: -0.63 };
      return [
        { x: -4, z: 8.55, ry: Math.PI, mat: "wallRainbow", pose: "stand" },
        { x: 6.2, z: 8.55, ry: Math.PI, mat: "wallRainbow", pose: "stand" },
        { x: -11.5, z: 3.4, ry: Math.PI / 2, mat: "wallSky", pose: "stand" },
        { x: 11.5, z: 4.6, ry: -Math.PI / 2, mat: "wallSky", pose: "stand" },
        { x: -6.5, z: -1.5, ry: Math.PI, mat: "shelfRed", pose: "stand" },
        { x: -6.5, z: 4.5, ry: 0, mat: "shelfBlue", pose: "stand" },
        { x: 1.5, z: 2.3, ry: 0, mat: "shelfYellow", pose: "stand" },
        { x: 1.5, z: 6.7, ry: 0, mat: "shelfGreen", pose: "stand" },
        { x: 5.6, z: -0.4, ry: 0, mat: "boxKraft", pose: "crouch" },
        { x: -10.9, z: 6.4, ry: 0.4, mat: "boxKraft", pose: "crouch" },
        { x: -8.9, z: -5.2, ry: 0.2, mat: "teddyBrown", pose: "crouch" },
        { x: 8.3, z: 5.6, ry: 0.5, mat: "ballPit", pose: "crouch" },
        { x: -2.5, z: 6.9, ry: 0, mat: "counterPurple", pose: "crouch" },
        { x: -1, z: -5.3, ry: 0, mat: "shelfYellow", pose: "stand", y: MEZZ },
        { x: 4.5, z: -6.7, ry: 0, mat: "shelfRed", pose: "stand", y: MEZZ },
        { x: -5.9, z: -5.4, ry: 0.3, mat: "teddyPink", pose: "crouch", y: MEZZ },
        { x: -9.5, z: -8.5, ry: 0, mat: "wallSky", pose: "stand", y: MEZZ },
        { x: 9.8, z: -8.5, ry: 0, mat: "wallSky", pose: "stand", y: MEZZ }
      ];
    }

    function buildMuseum() {
      surf("wallWhite", { color: 0xeceff1 });
      surf("wallMoire", { canvas: P.moire("#20242c", "#e8e2d0"), density: 0.6, color: 0x20242c, anim: true });
      surf("floorMarble", { canvas: P.noise("#d8dade", 0.035), density: 0.35, color: 0xd8dade });
      surf("plinth", { color: 0xc8ccd4 });
      surf("statueGold", { canvas: P.noise("#c9a227", 0.06), density: 1.0, color: 0xc9a227 });
      surf("statueTeal", { color: 0x2e8a8a });
      surf("statueRed", { color: 0xb53d3d });
      surf("benchGray", { color: 0x6a7076 });
      surf("artA", { canvas: P.art(["#1d2440", "#e05252", "#e8d43c", "#4a7fd0", "#efe8da"], 11), density: 0.55, color: 0x1d2440 });
      surf("artB", { canvas: P.art(["#3a2a1d", "#52b05e", "#e8a23c", "#8f5ba6", "#efe8da"], 23), density: 0.55, color: 0x3a2a1d });
      surf("artC", { canvas: P.art(["#10231e", "#e05294", "#3cc8e8", "#e8e2d0"], 37), density: 0.6, color: 0x10231e });

      shell(28, 20, 5, "floorMarble", ["wallMoire", "wallWhite", "wallWhite", "wallWhite"], 0xf2f4f6);

      // Wall canvases hang low (bottom ~0.5m) so a standing hider overlaps
      // the art rather than the bare wall below it.
      PL("artA", 3.4, 2.2, -7, 1.6, -9.82, 0, 0, { pick: true, name: "a painting" });
      PL("artB", 3.4, 2.2, 7, 1.6, -9.82, 0, 0, { pick: true, name: "a painting" });
      PL("artC", 3, 2, -13.82, 1.6, -3, 0, Math.PI / 2, { pick: true, name: "a painting" });
      PL("artA", 3, 2, -13.82, 1.6, 4, 0, Math.PI / 2, { pick: true, name: "a painting" });
      PL("artB", 3, 2, 13.82, 1.6, -2, 0, -Math.PI / 2, { pick: true, name: "a painting" });
      PL("artC", 3, 2, 13.82, 1.6, 5, 0, -Math.PI / 2, { pick: true, name: "a painting" });
      PL("artB", 3.2, 2.1, -4, 1.6, 9.82, 0, Math.PI, { pick: true, name: "a painting" });
      PL("artC", 3.2, 2.1, 5.5, 1.6, 9.82, 0, Math.PI, { pick: true, name: "a painting" });

      // Free-standing partition walls (art on both faces).
      B("artA", 4.2, 3, 0.3, -5.5, 0, 3.6, 0, { pick: true, name: "the art wall", solid: true });
      B("artC", 4.2, 3, 0.3, 5.5, 0, 3.6, 0, { pick: true, name: "the art wall", solid: true });

      // Statues on plinths. The centrepiece + the red spiral slowly rotate
      // ("shifting geometry").
      function plinth(x, z, w, h) {
        B("plinth", w, h, w, x, 0, z, 0, { pick: true, name: "the plinth", solid: true });
        return h;
      }
      let h = plinth(0, -2, 1.7, 0.7);
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.62, 0.2, 72, 10), matFor("statueGold", 1.4, 1.4));
      knot.position.set(0, h + 1.05, -2);
      meshOpts(knot, { pick: true, name: "the gold sculpture" });
      world.anims.push({ mesh: knot, ry: 0.35, rx: 0.12 });
      collider(0, -2, 2, 2, 0, 3);

      h = plinth(-8, -4.5, 1.4, 0.6);
      const cones = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const cn = new THREE.Mesh(new THREE.ConeGeometry(0.55 - i * 0.15, 0.7, 12), matFor("statueTeal", 1, 1));
        cn.position.y = h + 0.35 + i * 0.62;
        cn.userData.accuse = "the teal totem";
        world.pickables.push(cn);
        cones.add(cn);
      }
      cones.position.set(-8, 0, -4.5);
      world.group.add(cones);
      collider(-8, -4.5, 1.6, 1.6, 0, 3);

      h = plinth(7, -5, 1.4, 0.6);
      const spiral = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const bx = new THREE.Mesh(new THREE.BoxGeometry(1.15 - i * 0.16, 0.34, 1.15 - i * 0.16), matFor("statueRed", 1, 0.4));
        bx.position.y = h + 0.2 + i * 0.36;
        bx.rotation.y = i * 0.5;
        bx.userData.accuse = "the red spiral";
        world.pickables.push(bx);
        spiral.add(bx);
      }
      spiral.position.set(7, 0, -5);
      world.group.add(spiral);
      world.anims.push({ mesh: spiral, ry: 0.5 });
      collider(7, -5, 1.6, 1.6, 0, 3);

      h = plinth(-9, 5.5, 1.5, 0.55);
      SP("statueGold", 0.75, -9, h + 0.8, 5.5, { pick: true, name: "the gold orb" });
      collider(-9, 5.5, 1.7, 1.7, 0, 2.6);
      h = plinth(9.5, 6, 1.4, 0.9);
      const tor = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.16, 12, 26), matFor("statueTeal", 1.2, 1.2));
      tor.position.set(9.5, h + 0.95, 6);
      meshOpts(tor, { pick: true, name: "the teal ring" });
      world.anims.push({ mesh: tor, rz: 0.4 });
      collider(9.5, 6, 1.6, 1.6, 0, 3);

      // Benches down the middle.
      for (const bz of [1.2, 6.5]) {
        B("benchGray", 2.6, 0.45, 0.75, 0, 0, bz, 0, { pick: true, name: "the bench", solid: true });
      }

      world.spawn = { x: 0, z: 8.6, yaw: 0 };
      return [
        { x: -8.4, z: -9.5, ry: 0, mat: "wallMoire", pose: "stand" },
        { x: 2.6, z: -9.5, ry: 0, mat: "wallMoire", pose: "stand" },
        { x: 11, z: -9.5, ry: 0, mat: "wallMoire", pose: "stand" },
        { x: -7, z: -9.55, ry: 0, mat: "artA", pose: "stand" },
        { x: 7, z: -9.55, ry: 0, mat: "artB", pose: "stand" },
        { x: -13.5, z: -3, ry: Math.PI / 2, mat: "artC", pose: "stand" },
        { x: 13.5, z: 5, ry: -Math.PI / 2, mat: "artC", pose: "stand" },
        { x: -4, z: 9.55, ry: Math.PI, mat: "artB", pose: "stand" },
        { x: -13.6, z: 6.5, ry: Math.PI / 2, mat: "wallWhite", pose: "stand" },
        { x: 13.6, z: -6.5, ry: -Math.PI / 2, mat: "wallWhite", pose: "stand" },
        { x: -5.5, z: 4, ry: 0, mat: "artA", pose: "stand" },
        { x: 5.5, z: 4, ry: 0, mat: "artC", pose: "stand" },
        { x: 0.9, z: -2.9, ry: 0.4, mat: "plinth", pose: "crouch" },
        { x: -8, z: -3.5, ry: 0, mat: "statueTeal", pose: "crouch" },
        { x: 7.9, z: -4.3, ry: 0.4, mat: "statueRed", pose: "crouch" },
        { x: 0.6, z: 1.9, ry: 0, mat: "benchGray", pose: "crouch" },
        { x: -3.4, z: 5.4, ry: 0.6, mat: "floorMarble", pose: "crouch" }
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
    const EYE = 1.62, RADIUS = 0.34, SPEED = 4.6;

    function pickSpots(pool, count, arenaId) {
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
      sfx.ui();
      el.pause.classList.remove("ch-hidden");
      try { if (canMusic && ctx.music && musicOn) ctx.music.duck(0.6, 400); } catch (_) {}
    }
    function resumeGame() {
      el.pause.classList.add("ch-hidden");
      if (state === "paused") state = "play";
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

    function winLevel() {
      state = "result";
      const completionMs = arena.limit * 1000 - game.remainMs;
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
      // Platform leaderboard (best time per arena).
      try {
        if (ctx.memory && ctx.memory.record) {
          ctx.memory.record(arena.id).submit(completionMs, { label: fmtMsPrecise(completionMs) });
        }
      } catch (_) {}

      const q = qualifies(arena, completionMs);
      const savedName = store.get("pname", "");
      el.hud.classList.add("ch-hidden");
      el.pauseBtn.classList.add("ch-hidden");
      el.resPanel.innerHTML = `
        <div class="big">🎉</div>
        <h2>Arena cleared!</h2>
        ${isBest ? '<div class="ch-newbest">NEW PERSONAL BEST</div>' : ""}
        <div class="ch-stat">Time: <b>${fmtMsPrecise(completionMs)}</b></div>
        <div class="ch-stat">Score: <b>${score}</b></div>
        ${unlocksNext ? `<div class="ch-stat">🔓 Unlocked: <b>${ARENAS[arenaIdx + 1].name}</b></div>` : ""}
        ${q ? `
          <div class="ch-namebox">
            <label>🏆 You made the ${arena.name} leaderboard! Enter your name:</label>
            <div class="ch-namerow">
              <input class="ch-input" id="chName" maxlength="14" placeholder="Your name"
                value="${savedName ? String(savedName).replace(/[&<>"]/g, "") : ""}">
              <button class="ch-save" id="chNameSave">Save</button>
            </div>
          </div>` : ""}
        <div style="height:10px;"></div>
        <button class="ch-btn" id="resReplay">Replay arena</button>
        ${arenaIdx + 1 < ARENAS.length ? `<button class="ch-btn" id="resNext">Next arena ▸</button>` : ""}
        <button class="ch-btn ghost" id="resBoards">Leaderboard</button>
        <button class="ch-btn ghost" id="resMenu" style="margin-bottom:0;">Menu</button>`;
      el.result.classList.remove("ch-hidden");

      const nameInput = el.resPanel.querySelector("#chName");
      const nameSave = el.resPanel.querySelector("#chNameSave");
      if (nameSave) {
        ctx.listen(nameSave, "click", () => {
          const nm = (nameInput.value || "Seeker").trim().slice(0, 14) || "Seeker";
          store.set("pname", nm);
          const board = loadBoard(arena);
          board.push({ name: nm, ms: completionMs, bot: false });
          board.sort((a, b) => a.ms - b.ms);
          saveBoard(arena, board);
          sfx.catch(); haptic("light");
          nameSave.textContent = "Saved ✓";
          nameSave.disabled = true;
          nameInput.disabled = true;
          try { ctx.platform.interact({ type: "leaderboard_entry", arena: arena.id }); } catch (_) {}
        });
      }
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

    function endPointer(e) {
      const rec = pointers.get(e.pointerId);
      if (rec) {
        const dur = e.timeStamp - rec.t;
        if (rec.moved < 12 && dur < 420 && (state === "play" || state === "peek")) handleTap(rec.sx, rec.sy);
        pointers.delete(e.pointerId);
      }
      if (e.pointerId === movePid) {
        movePid = null; move.x = 0; move.y = 0;
        el.joy.classList.remove("show");
      }
      if (e.pointerId === lookPid) lookPid = null;
    }
    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);

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
        game.remainMs -= PENALTY_MS;
        sfx.penalty(); haptic("error");
        flash(el.flashBad);
        el.pen.textContent = "-" + PENALTY_MS / 1000 + "s  (" + obj.userData.accuse + "?)";
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
        ctx.timeout(() => { if (state === "play") winLevel(); }, 650);
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
    function update(dtMs) {
      const dt = Math.min(dtMs, 50) / 1000;

      if (lastW !== ctx.width || lastH !== ctx.height) {
        lastW = ctx.width; lastH = ctx.height; resize();
      }
      if (!world) return;

      const playing = state === "play";
      const roaming = playing || state === "peek";

      // --- timers ---
      if (playing) {
        game.remainMs -= Math.min(dtMs, 250);
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

      // --- hider idle life: sway, blink, dance ---
      for (const h of world.hiders) {
        if (!h.found) {
          h.swayPh += dt;
          h.group.rotation.z = Math.sin(h.swayPh * 0.9) * 0.008;
          h.blinkAt -= dt;
          if (h.blinkAt <= 0) {
            h.blinkOn = 0.34;
            h.blinkAt = rnd(3.5, 8.5) + world.spec.dlv * 0.8;
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
            sfx.cue(0.03 + closeness * 0.12, game.cueFlip);
            game.cueFlip = !game.cueFlip;
            game.cueTimer = lerp(4.2, 1.1, closeness);
            if (nearest < 3.5) haptic("light");
          }
        }
      }

      // --- museum kinetic sculptures + moiré scroll ---
      for (const a of world.anims) {
        if (a.ry) a.mesh.rotation.y += a.ry * dt;
        if (a.rx) a.mesh.rotation.x += a.rx * dt;
        if (a.rz) a.mesh.rotation.z += a.rz * dt;
      }
      for (const t of world.animTex) t.offset.x += dt * 0.02;

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

    ctx.onFrame(update);

    ctx.onDestroy(() => {
      disposeWorld();
      try { if (canMusic && ctx.music && musicOn) ctx.music.stop({ fadeOutMs: 200 }); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
      if (AC) { try { AC.close(); } catch (_) {} }
    });
  }
};
