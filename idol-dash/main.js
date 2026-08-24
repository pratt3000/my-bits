/*
 * Idol Dash
 * An endless temple runner: you took the cursed idol, the guardians want it
 * back. Three lanes, sharp corners, roots to vault, gates to slide, gaps to
 * clear — plus shields, magnets, boosts and multipliers, an upgrade shop
 * bought with gems, and a global leaderboard.
 *
 * Runtime:  plethora-bit@2  (window.plethoraBit)
 * Renderer: three@0.164.1 (ES module via ctx.importModule)
 * Audio:    ctx.music beds + procedurally synthesized WebAudio SFX
 *           (the runtime blocks remote audio, so every sound is generated)
 */

window.plethoraBit = {
  meta: {
    title: "Idol Dash",
    runtime: "plethora-bit@2",
    tags: ["3d", "endless-runner", "arcade", "temple", "action", "mobile"],
    permissions: ["haptics", "backgroundMusic", "audio", "storage"]
  },

  async init(ctx) {
    "use strict";

    // =====================================================================
    // 1. Surfaces + UI shell. The menu is DOM so the first frame is instant.
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
      .id-ui { position:absolute; inset:0; overflow:hidden; color:#fff5e0;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
      .id-ui * { box-sizing:border-box; }
      .id-hidden { display:none !important; }

      .id-bg { position:absolute; inset:0;
        background:
          radial-gradient(120% 80% at 50% 12%, rgba(255,214,130,.35), rgba(255,150,60,0) 60%),
          linear-gradient(180deg,#2a1c10 0%, #1a1209 45%, #0d0906 100%); }
      .id-vign { position:absolute; inset:0; pointer-events:none;
        background:radial-gradient(120% 100% at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,.55) 100%); }

      .id-screen { position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; padding:22px; text-align:center; pointer-events:auto; }

      .id-logo { font-size:44px; font-weight:900; letter-spacing:2px; line-height:1;
        background:linear-gradient(180deg,#ffe9a8,#e8a33c 55%,#b7671b);
        -webkit-background-clip:text; background-clip:text; color:transparent;
        text-shadow:0 4px 22px rgba(255,170,60,.35); }
      .id-logo-sub { font-size:12px; font-weight:800; letter-spacing:5px; opacity:.7; margin-top:6px; }
      .id-idol { font-size:70px; line-height:1; filter:drop-shadow(0 8px 26px rgba(255,180,60,.45)); }

      .id-btn { pointer-events:auto; display:block; width:min(300px,80vw); margin:0 auto 11px;
        padding:15px 20px; border-radius:16px; border:none; cursor:pointer;
        font-size:17px; font-weight:900; letter-spacing:.5px; color:#3a1e05;
        background:linear-gradient(180deg,#ffd979,#e8a33c);
        box-shadow:0 6px 0 #a86a1c, 0 10px 24px rgba(0,0,0,.4);
        transition:transform .08s ease, box-shadow .08s ease; }
      .id-btn:active { transform:translateY(4px); box-shadow:0 2px 0 #a86a1c, 0 5px 14px rgba(0,0,0,.4); }
      .id-btn.ghost { background:rgba(255,255,255,.08); color:#ffe9c0; font-weight:800;
        border:1px solid rgba(255,220,160,.28); box-shadow:none; }
      .id-btn.ghost:active { transform:scale(.96); box-shadow:none; }
      .id-btn.gem { background:linear-gradient(180deg,#8ff0c8,#2fbf8c); color:#04301f; box-shadow:0 6px 0 #1d7d5b, 0 10px 24px rgba(0,0,0,.4); }
      .id-btn.gem:active { box-shadow:0 2px 0 #1d7d5b, 0 5px 14px rgba(0,0,0,.4); }
      .id-btn:disabled { opacity:.45; }

      .id-wallet { display:flex; gap:14px; justify-content:center; margin:12px 0 16px;
        font-size:15px; font-weight:900; }
      .id-wallet span { display:inline-flex; align-items:center; gap:5px;
        background:rgba(0,0,0,.35); border:1px solid rgba(255,220,160,.2);
        padding:6px 13px; border-radius:999px; }

      /* ---- HUD ---- */
      .id-hud { position:absolute; inset:0; pointer-events:none; z-index:20; }
      .id-score { position:absolute; top:calc(${sa.top}px + 10px); left:50%; transform:translateX(-50%);
        font-size:36px; font-weight:900; letter-spacing:1px; text-shadow:0 2px 10px rgba(0,0,0,.7);
        font-variant-numeric:tabular-nums; }
      .id-dist { position:absolute; top:calc(${sa.top}px + 50px); left:50%; transform:translateX(-50%);
        font-size:13px; font-weight:800; opacity:.8; letter-spacing:1px; }
      .id-mult { position:absolute; top:calc(${sa.top}px + 10px); right:calc(${sa.right}px + 14px);
        font-size:19px; font-weight:900; color:#ffd979; text-shadow:0 2px 8px rgba(0,0,0,.6); }
      .id-mult.pop { animation:idPop .45s ease; }
      @keyframes idPop { 0%{transform:scale(1);} 40%{transform:scale(1.4);} 100%{transform:scale(1);} }
      .id-coins { position:absolute; top:calc(${sa.top}px + 12px); left:calc(${sa.left}px + 14px);
        font-size:16px; font-weight:900; display:flex; flex-direction:column; gap:4px; align-items:flex-start; }
      .id-coins span { display:inline-flex; align-items:center; gap:5px;
        background:rgba(0,0,0,.32); padding:4px 10px; border-radius:999px; }

      .id-pw { position:absolute; left:calc(${sa.left}px + 14px); top:calc(${sa.top}px + 88px);
        display:flex; flex-direction:column; gap:7px; }
      .id-pwchip { display:flex; align-items:center; gap:7px; padding:5px 11px 5px 8px; border-radius:999px;
        background:rgba(0,0,0,.42); border:1px solid rgba(255,255,255,.18); font-size:12px; font-weight:800; }
      .id-pwbar { width:44px; height:5px; border-radius:3px; background:rgba(255,255,255,.2); overflow:hidden; }
      .id-pwbar i { display:block; height:100%; width:100%; background:#ffd979; transform-origin:left; }

      .id-turn { position:absolute; left:50%; top:38%; transform:translate(-50%,-50%); z-index:21;
        font-size:80px; font-weight:900; color:#ffe14a; opacity:0; pointer-events:none;
        text-shadow:0 0 26px rgba(255,190,40,.9), 0 4px 14px rgba(0,0,0,.6);
        transition:opacity .12s ease; }
      .id-turn.show { opacity:.95; animation:idTurnPulse .5s ease infinite; }
      @keyframes idTurnPulse { 0%,100% { transform:translate(-50%,-50%) scale(1); } 50% { transform:translate(-50%,-50%) scale(1.18); } }
      .id-toast { position:absolute; left:50%; top:26%; transform:translate(-50%,-50%) scale(.9); z-index:22;
        padding:9px 18px; border-radius:999px; font-size:15px; font-weight:900; white-space:nowrap;
        background:rgba(20,12,4,.8); border:1px solid rgba(255,220,160,.3);
        opacity:0; transition:opacity .22s ease, transform .22s ease; pointer-events:none; }
      .id-toast.show { opacity:1; transform:translate(-50%,-50%) scale(1); }

      .id-flash { position:absolute; inset:0; pointer-events:none; opacity:0; z-index:19;
        transition:opacity .45s ease; }
      .id-flash.on { opacity:1; transition:opacity .05s ease; }
      .id-flash.hurt { background:radial-gradient(110% 90% at 50% 50%, rgba(190,30,20,0) 50%, rgba(190,30,20,.55) 100%); }
      .id-flash.good { background:radial-gradient(110% 90% at 50% 50%, rgba(255,220,120,0) 55%, rgba(255,220,120,.4) 100%); }

      .id-corner { position:absolute; top:calc(${sa.top}px + 12px); right:calc(${sa.right}px + 14px);
        display:flex; gap:9px; pointer-events:none; z-index:50; }
      .id-ico { pointer-events:auto; width:42px; height:42px; border-radius:50%; cursor:pointer;
        border:1px solid rgba(255,220,160,.28); background:rgba(20,12,4,.55); color:#ffe9c0;
        font-size:17px; display:flex; align-items:center; justify-content:center;
        backdrop-filter:blur(7px); -webkit-backdrop-filter:blur(7px); }
      .id-ico:active { transform:scale(.9); }

      /* swipe hint arrows on first run */
      .id-hint { position:absolute; inset:0; pointer-events:none; z-index:21; opacity:0;
        transition:opacity .4s ease; display:flex; align-items:center; justify-content:center; }
      .id-hint.show { opacity:.92; }
      .id-hint-card { background:rgba(14,9,4,.82); border:1px solid rgba(255,220,160,.25);
        border-radius:18px; padding:16px 20px; font-size:14px; font-weight:700; line-height:1.9; text-align:left; }
      .id-hint-card b { color:#ffd979; }

      /* ---- overlays ---- */
      .id-ov { position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center;
        padding:20px; pointer-events:auto; text-align:center;
        background:radial-gradient(120% 90% at 50% 35%, rgba(26,17,8,.62), rgba(8,5,3,.9));
        backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
      .id-panel { width:100%; max-width:390px; max-height:86vh; overflow-y:auto; padding:22px 18px 16px;
        border-radius:22px; background:linear-gradient(180deg, rgba(48,32,16,.92), rgba(26,17,9,.95));
        border:1px solid rgba(255,220,160,.22); box-shadow:0 20px 60px rgba(0,0,0,.55); }
      .id-panel h2 { margin:0 0 6px; font-size:26px; font-weight:900; letter-spacing:.5px; }
      .id-panel .big { font-size:52px; line-height:1; margin-bottom:4px; }

      .id-stat { display:flex; justify-content:space-between; align-items:center; gap:10px;
        padding:9px 13px; border-radius:12px; background:rgba(0,0,0,.28); margin-bottom:7px; font-size:14.5px; font-weight:700; }
      .id-stat b { font-size:19px; font-weight:900; color:#ffd979; font-variant-numeric:tabular-nums; }
      .id-best { display:inline-block; margin:4px 0 10px; padding:5px 14px; border-radius:999px;
        font-size:11.5px; font-weight:900; letter-spacing:1.4px; color:#3a1e05;
        background:linear-gradient(90deg,#ffe9a8,#e8a33c); }

      .id-save { margin:6px 0 12px; padding:14px; border-radius:16px;
        background:rgba(47,191,140,.12); border:1px solid rgba(143,240,200,.35); }
      .id-save p { margin:0 0 10px; font-size:13.5px; font-weight:700; opacity:.9; }
      .id-ring { width:66px; height:66px; margin:0 auto 8px; position:relative; }
      .id-ring svg { transform:rotate(-90deg); }
      .id-ring .t { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        font-size:24px; font-weight:900; }

      /* shop */
      .id-shop-row { display:flex; align-items:center; gap:11px; padding:11px 12px; border-radius:14px;
        background:rgba(0,0,0,.28); margin-bottom:8px; text-align:left; }
      .id-shop-row .ic { font-size:26px; width:34px; text-align:center; flex:none; }
      .id-shop-row .mid { flex:1; min-width:0; }
      .id-shop-row .nm { font-size:14.5px; font-weight:900; }
      .id-shop-row .de { font-size:11.5px; opacity:.72; margin-top:2px; }
      .id-pips { display:flex; gap:3px; margin-top:5px; }
      .id-pips i { width:16px; height:5px; border-radius:3px; background:rgba(255,255,255,.18); }
      .id-pips i.on { background:linear-gradient(90deg,#ffe9a8,#e8a33c); }
      .id-buy { flex:none; padding:9px 12px; border-radius:11px; border:none; cursor:pointer;
        font-size:12.5px; font-weight:900; color:#04301f; background:linear-gradient(180deg,#8ff0c8,#2fbf8c);
        display:flex; align-items:center; gap:4px; }
      .id-buy:disabled { opacity:.4; background:rgba(255,255,255,.15); color:#fff; }
      .id-buy.max { background:rgba(255,255,255,.12); color:#ffe9c0; }

      /* leaderboard */
      .id-tabs { display:flex; gap:7px; margin-bottom:12px; }
      .id-tabs button { flex:1; padding:9px 0; border-radius:999px; cursor:pointer; font-size:13px; font-weight:800;
        border:1px solid rgba(255,220,160,.22); background:rgba(255,255,255,.05); color:#ffe9c0; }
      .id-tabs button.on { background:linear-gradient(180deg,#ffd979,#e8a33c); color:#3a1e05; border-color:transparent; }
      .id-lb { display:flex; flex-direction:column; gap:5px; min-height:130px; max-height:44vh; overflow-y:auto; }
      .id-row { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:11px;
        background:rgba(0,0,0,.28); font-size:14.5px; }
      .id-row .r { min-width:28px; font-weight:900; text-align:center; }
      .id-row .nm { flex:1; text-align:left; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .id-row .sc { font-weight:900; color:#ffd979; font-variant-numeric:tabular-nums; }
      .id-row.you { background:rgba(255,217,121,.16); border:1px solid rgba(255,217,121,.4); }
      .id-empty { font-size:13.5px; opacity:.7; padding:20px 6px; }

      .id-fatal { position:absolute; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
        padding:26px; text-align:center; background:#160e06; pointer-events:auto; }
    `;
    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "id-ui";
    ui.innerHTML = `
      <div class="id-bg" id="idBg"></div>
      <div class="id-vign"></div>

      <div class="id-corner">
        <button class="id-ico id-hidden" id="idPause" aria-label="Pause">⏸</button>
        <button class="id-ico" id="idMute" aria-label="Sound">🔊</button>
      </div>

      <div class="id-screen" id="scrMenu">
        <div class="id-idol">🗿</div>
        <div class="id-logo">IDOL DASH</div>
        <div class="id-logo-sub">ENDLESS TEMPLE RUN</div>
        <div class="id-wallet"><span>🪙 <i id="wCoins">0</i></span><span>💎 <i id="wGems">0</i></span></div>
        <button class="id-btn" id="btnPlay">▶  RUN</button>
        <button class="id-btn ghost" id="btnShop">⚡  Upgrades</button>
        <button class="id-btn ghost" id="btnBoards">🏆  Leaderboard</button>
        <button class="id-btn ghost" id="btnHow">?  How to play</button>
      </div>

      <div class="id-hud id-hidden" id="idHud">
        <div class="id-coins">
          <span>🪙 <i id="hCoins">0</i></span>
          <span id="hGemWrap" class="id-hidden">💎 <i id="hGems">0</i></span>
        </div>
        <div class="id-score" id="hScore">0</div>
        <div class="id-dist" id="hDist">0 m</div>
        <div class="id-mult" id="hMult">×1</div>
        <div class="id-pw" id="hPw"></div>
      </div>

      <div class="id-hint" id="idHint">
        <div class="id-hint-card">
          ⬆️ swipe up — <b>jump</b><br>
          ⬇️ swipe down — <b>slide</b><br>
          ⬅️➡️ swipe — <b>turn &amp; change lane</b><br>
          <span style="opacity:.7">tap anywhere to begin</span>
        </div>
      </div>

      <div class="id-turn" id="idTurn"><span id="idTurnArrow">➡</span></div>
      <div class="id-toast" id="idToast"></div>
      <div class="id-flash hurt" id="idFlashHurt"></div>
      <div class="id-flash good" id="idFlashGood"></div>

      <div class="id-ov id-hidden" id="ovHow">
        <div class="id-panel">
          <h2>How to run</h2>
          <div style="text-align:left;font-size:14.5px;line-height:1.95;margin:8px 0 16px;">
            ⬆️ <b>Swipe up</b> to vault roots and gaps.<br>
            ⬇️ <b>Swipe down</b> to slide under gates.<br>
            ⬅️➡️ <b>Swipe sideways</b> to switch lanes — and to
            <b>turn</b> when the path bends. Miss a turn and you're over the edge.<br>
            🛡️ <b>Shield</b> eats one hit. 🧲 <b>Magnet</b> pulls coins.<br>
            🚀 <b>Boost</b> makes you invincible and fast.<br>
            ✨ <b>×2</b> doubles your score for a while.<br>
            💎 Gems buy upgrades — and a second chance.<br>
            🐒 Clip an obstacle and you stumble; the guardians close in.
          </div>
          <button class="id-btn" id="btnHowOk" style="margin-bottom:0;">Got it</button>
        </div>
      </div>

      <div class="id-ov id-hidden" id="ovPause">
        <div class="id-panel">
          <h2>Paused</h2>
          <div style="height:8px;"></div>
          <button class="id-btn" id="btnResume">Resume</button>
          <button class="id-btn ghost" id="btnRestart">Restart</button>
          <button class="id-btn ghost" id="btnQuit" style="margin-bottom:0;">Quit to menu</button>
        </div>
      </div>

      <div class="id-ov id-hidden" id="ovShop">
        <div class="id-panel">
          <h2>Upgrades</h2>
          <div class="id-wallet"><span>🪙 <i id="sCoins">0</i></span><span>💎 <i id="sGems">0</i></span></div>
          <div id="shopList"></div>
          <button class="id-btn ghost" id="btnShopClose" style="margin:12px 0 0;">Close</button>
        </div>
      </div>

      <div class="id-ov id-hidden" id="ovBoards">
        <div class="id-panel">
          <h2>🏆 Leaderboard</h2>
          <div class="id-tabs" id="lbTabs"></div>
          <div class="id-lb" id="lbList"></div>
          <button class="id-btn ghost" id="btnLbClose" style="margin:14px 0 0;">Close</button>
        </div>
      </div>

      <div class="id-ov id-hidden" id="ovDead">
        <div class="id-panel" id="deadPanel"></div>
      </div>
    `;
    root.appendChild(ui);

    const $ = (id) => ui.querySelector("#" + id);
    const el = {
      bg: $("idBg"), menu: $("scrMenu"), hud: $("idHud"), hint: $("idHint"),
      score: $("hScore"), dist: $("hDist"), mult: $("hMult"),
      coins: $("hCoins"), gems: $("hGems"), gemWrap: $("hGemWrap"), pw: $("hPw"),
      toast: $("idToast"), turn: $("idTurn"), turnArrow: $("idTurnArrow"),
      flashHurt: $("idFlashHurt"), flashGood: $("idFlashGood"),
      how: $("ovHow"), pause: $("ovPause"), shop: $("ovShop"), boards: $("ovBoards"),
      dead: $("ovDead"), deadPanel: $("deadPanel"),
      shopList: $("shopList"), lbTabs: $("lbTabs"), lbList: $("lbList"),
      pauseBtn: $("idPause"), muteBtn: $("idMute"),
      wCoins: $("wCoins"), wGems: $("wGems"), sCoins: $("sCoins"), sGems: $("sGems")
    };

    // =====================================================================
    // 2. Utilities, persistence, economy.
    // =====================================================================
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const fmt = (n) => Math.floor(n).toLocaleString("en-US");
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const mem = {};
    const store = {
      get(k, d) {
        try { const v = canStore ? ctx.storage.get("id_" + k) : mem[k]; return v == null ? d : v; }
        catch (_) { return d; }
      },
      set(k, v) { try { if (canStore) ctx.storage.set("id_" + k, v); else mem[k] = v; } catch (_) {} }
    };

    // Upgrade tracks, bought with gems (Temple Run 2's shape: each level
    // costs more and extends the powerup it governs).
    const UPGRADES = [
      { id: "shield", icon: "🛡️", name: "Shield", desc: "Survive one hit — longer each level",
        costs: [15, 40, 90, 180, 320], base: 6, step: 1.6, unit: "s" },
      { id: "magnet", icon: "🧲", name: "Coin Magnet", desc: "Pull coins toward you",
        costs: [12, 32, 75, 150, 280], base: 7, step: 1.8, unit: "s" },
      { id: "boost", icon: "🚀", name: "Boost", desc: "Invincible sprint distance",
        costs: [20, 50, 110, 210, 380], base: 250, step: 90, unit: "m" },
      { id: "mult", icon: "✨", name: "Score ×2", desc: "How long the doubler lasts",
        costs: [18, 45, 100, 190, 340], base: 8, step: 2, unit: "s" },
      { id: "value", icon: "🪙", name: "Coin Value", desc: "Each coin is worth more",
        costs: [25, 60, 130, 240, 420], base: 1, step: 1, unit: "×" },
      { id: "revive", icon: "💎", name: "Second Chance", desc: "Cheaper revive after a fall",
        costs: [30, 70, 150, 260], base: 8, step: -1.5, unit: " gems" }
    ];
    function upLevel(id) { return clamp(store.get("up_" + id, 0), 0, 5); }
    function upValue(u) { return u.base + u.step * upLevel(u.id); }
    function upById(id) { for (const u of UPGRADES) if (u.id === id) return u; return null; }
    function upVal(id) { const u = upById(id); return u ? upValue(u) : 0; }

    const wallet = {
      get coins() { return store.get("coins", 0); },
      get gems() { return store.get("gems", 0); },
      addCoins(n) { store.set("coins", Math.max(0, this.coins + n)); },
      addGems(n) { store.set("gems", Math.max(0, this.gems + n)); }
    };
    function refreshWallet() {
      el.wCoins.textContent = fmt(wallet.coins);
      el.wGems.textContent = fmt(wallet.gems);
      el.sCoins.textContent = fmt(wallet.coins);
      el.sGems.textContent = fmt(wallet.gems);
    }

    // =====================================================================
    // 3. Audio — synthesized SFX plus a ctx.music bed.
    // =====================================================================
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!store.get("muted", false);

    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      try {
        AC = new C();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.85;
        master.connect(AC.destination);
      } catch (_) { AC = null; master = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }

    function tone(freq, delay, dur, type, peak, glide) {
      ensureAC(); resumeAC();
      if (!AC || muted) return;
      try {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = type || "sine";
        const t = AC.currentTime + (delay || 0);
        o.frequency.setValueAtTime(freq, t);
        if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur * 0.9);
        o.connect(g); g.connect(master);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak || 0.2, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
        o.start(t); o.stop(t + dur + 0.04);
      } catch (_) {}
    }
    function noise(dur, cutoff, peak, type) {
      ensureAC(); resumeAC();
      if (!AC || muted) return;
      try {
        const n = Math.max(1, (AC.sampleRate * dur) | 0);
        const buf = AC.createBuffer(1, n, AC.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = AC.createBufferSource(); src.buffer = buf;
        const f = AC.createBiquadFilter(); f.type = type || "bandpass";
        f.frequency.value = cutoff || 1200; f.Q.value = 0.9;
        const g = AC.createGain(); g.gain.value = peak || 0.25;
        src.connect(f); f.connect(g); g.connect(master);
        src.start(); src.stop(AC.currentTime + dur + 0.02);
      } catch (_) {}
    }
    function fbSting(name) {
      if (AC || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    let coinPitch = 0;
    const sfx = {
      ui() { tone(620, 0, 0.07, "sine", 0.11); if (!AC) fbSting("tap"); },
      coin() {
        if (!AC) { fbSting("coin"); return; }
        coinPitch = Math.min(coinPitch + 1, 12);
        const f = 1046 + coinPitch * 42;
        tone(f, 0, 0.09, "triangle", 0.13);
        tone(f * 1.5, 0.035, 0.1, "sine", 0.07);
      },
      gem() { if (!AC) { fbSting("powerup"); return; } [880, 1318, 1760].forEach((f, i) => tone(f, i * 0.05, 0.3, "triangle", 0.16)); },
      jump() { noise(0.1, 900, 0.12, "lowpass"); tone(300, 0, 0.13, "sine", 0.1, 620); },
      land() { noise(0.11, 420, 0.2, "lowpass"); },
      slide() { noise(0.34, 1700, 0.2); },
      turn() { tone(520, 0, 0.1, "sine", 0.12, 760); },
      stumble() {
        if (!AC) { fbSting("fail"); return; }
        noise(0.26, 300, 0.3, "lowpass"); tone(150, 0, 0.24, "square", 0.14, 80);
      },
      powerup(kind) {
        if (!AC) { fbSting("powerup"); return; }
        const base = kind === "boost" ? 440 : kind === "shield" ? 392 : kind === "magnet" ? 523 : 587;
        [0, 4, 7, 12].forEach((s, i) => tone(base * Math.pow(2, s / 12), i * 0.05, 0.34, "triangle", 0.16));
      },
      boostLoop() { if (!AC) return; noise(0.5, 260, 0.09, "lowpass"); },
      death() {
        if (!AC) { fbSting("lose"); return; }
        [523, 466, 392, 311, 233].forEach((f, i) => tone(f, i * 0.11, 0.4, "triangle", 0.16));
        noise(0.6, 200, 0.22, "lowpass");
      },
      revive() { if (!AC) { fbSting("win"); return; } [392, 523, 659, 880, 1174].forEach((f, i) => tone(f, i * 0.07, 0.5, "triangle", 0.16)); },
      buy() { if (!AC) { fbSting("coin"); return; } [660, 880, 1174].forEach((f, i) => tone(f, i * 0.06, 0.26, "triangle", 0.15)); },
      milestone() { if (!AC) { fbSting("success"); return; } [784, 988, 1318].forEach((f, i) => tone(f, i * 0.07, 0.35, "triangle", 0.14)); }
    };
    // Footsteps are rhythmic, driven by the run loop.
    function footstep(hard) { noise(hard ? 0.07 : 0.05, hard ? 380 : 620, hard ? 0.14 : 0.08, "lowpass"); }

    let musicOn = false;
    function bed(preset, volume) {
      if (!canMusic || !ctx.music) return;
      try {
        if (muted) { if (musicOn) { ctx.music.pause(); musicOn = false; } return; }
        const st = ctx.music.state && ctx.music.state();
        if (!musicOn && st === "paused") {
          ctx.music.resume();
          ctx.music.setPreset(preset, { fadeMs: 600 });
          ctx.music.setVolume(volume, { fadeMs: 600 });
          musicOn = true;
        } else if (!musicOn || st === "stopped") {
          ctx.music.unlock();
          ctx.music.play({ preset, volume, fadeInMs: 700 });
          musicOn = true;
        } else {
          ctx.music.setPreset(preset, { fadeMs: 600 });
          ctx.music.setVolume(volume, { fadeMs: 600 });
        }
      } catch (_) {}
    }
    function applyMute() {
      el.muteBtn.textContent = muted ? "🔇" : "🔊";
      if (master) master.gain.value = muted ? 0 : 0.85;
      try {
        if (canMusic && ctx.music) {
          if (muted && musicOn) { ctx.music.pause(); musicOn = false; }
          else if (!muted && started) bed(state === "run" ? "jungle" : "ambient", state === "run" ? 0.26 : 0.18);
        }
      } catch (_) {}
    }
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // =====================================================================
    // 4. Screen plumbing.
    // =====================================================================
    let state = "menu";     // menu | run | paused | dying | dead
    let started = false;
    let toastTok = 0;
    function toast(msg, ms) {
      el.toast.textContent = msg;
      el.toast.classList.add("show");
      const tok = ++toastTok;   // a newer toast supersedes this one
      ctx.timeout(() => { if (tok === toastTok) el.toast.classList.remove("show"); }, ms || 1300);
    }
    function flash(node) {
      node.classList.add("on");
      ctx.timeout(() => node.classList.remove("on"), 80);
    }
    function firstGesture() {
      if (!started) {
        started = true;
        try { ctx.platform.start(); } catch (_) {}
        if (canMusic && ctx.music) { try { ctx.music.unlock(); } catch (_) {} }
      }
      ensureAC(); resumeAC();
    }
    function showMenu() {
      state = "menu";
      el.menu.classList.remove("id-hidden");
      el.hud.classList.add("id-hidden");
      el.pauseBtn.classList.add("id-hidden");
      el.bg.style.opacity = "1";
      refreshWallet();
      bed("ambient", 0.18);
    }

    // ---- Upgrade shop -----------------------------------------------------
    function renderShop() {
      refreshWallet();
      el.shopList.innerHTML = "";
      for (const u of UPGRADES) {
        const lv = upLevel(u.id);
        const maxLv = u.costs.length;
        const maxed = lv >= maxLv;
        const cost = maxed ? 0 : u.costs[lv];
        const val = upValue(u);
        const shown = u.id === "revive" ? Math.max(2, Math.round(val)) + u.unit
          : u.id === "value" ? "×" + (1 + lv)
          : (Math.round(val * 10) / 10) + u.unit;
        const row = document.createElement("div");
        row.className = "id-shop-row";
        row.innerHTML = `
          <div class="ic">${u.icon}</div>
          <div class="mid">
            <div class="nm">${u.name} <span style="opacity:.65;font-weight:700;">${shown}</span></div>
            <div class="de">${u.desc}</div>
            <div class="id-pips">${Array.from({ length: maxLv }, (_, i) =>
              `<i class="${i < lv ? "on" : ""}"></i>`).join("")}</div>
          </div>
          <button class="id-buy ${maxed ? "max" : ""}" ${maxed || wallet.gems < cost ? "disabled" : ""}>
            ${maxed ? "MAX" : "💎 " + cost}
          </button>`;
        if (!maxed) {
          ctx.listen(row.querySelector(".id-buy"), "click", () => {
            if (wallet.gems < cost) return;
            wallet.addGems(-cost);
            store.set("up_" + u.id, lv + 1);
            sfx.buy(); haptic("success");
            renderShop();
            try { ctx.platform.interact({ type: "upgrade", id: u.id, level: lv + 1 }); } catch (_) {}
          });
        }
        el.shopList.appendChild(row);
      }
    }

    // ---- Leaderboard (platform records) -----------------------------------
    const BOARDS = [
      { id: "score", label: "Score", fmt: (v) => fmt(v) },
      { id: "distance", label: "Distance", fmt: (v) => fmt(v) + " m" }
    ];
    let lbTab = 0, lbReq = 0;
    function renderBoards() {
      el.lbTabs.innerHTML = "";
      BOARDS.forEach((b, i) => {
        const btn = document.createElement("button");
        btn.textContent = b.label;
        btn.className = i === lbTab ? "on" : "";
        ctx.listen(btn, "click", () => { sfx.ui(); lbTab = i; renderBoards(); });
        el.lbTabs.appendChild(btn);
      });
      const board = BOARDS[lbTab];
      const req = ++lbReq;
      const mine = store.get("best_" + board.id, 0);
      el.lbList.innerHTML = '<div class="id-empty">Loading…</div>';
      const fill = (entries) => {
        if (req !== lbReq) return;
        el.lbList.innerHTML = "";
        if (!entries || !entries.length) {
          el.lbList.innerHTML = '<div class="id-empty">' +
            (mine ? "No global times yet — your best is " + board.fmt(mine) + "."
                  : "No runs yet. Be the first!") + "</div>";
          return;
        }
        entries.slice(0, 12).forEach((e, i) => {
          const you = !!(e.isViewer || e.viewer || e.you || e.self || e.isSelf || e.is_viewer);
          const nm = e.displayName || e.display_name || e.username || e.name ||
            (e.user && (e.user.displayName || e.user.username)) || "Runner";
          const val = e.value != null ? e.value : (e.score != null ? e.score : 0);
          const row = document.createElement("div");
          row.className = "id-row" + (you ? " you" : "");
          row.innerHTML = `<div class="r">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</div>
            <div class="nm">${you ? "⭐ " : ""}${esc(nm)}</div>
            <div class="sc">${e.label ? esc(e.label) : board.fmt(val)}</div>`;
          el.lbList.appendChild(row);
        });
      };
      try {
        ctx.memory.record(board.id).leaderboard({ scope: "global", period: "all_time" })
          .then((lb) => fill((lb && (lb.entries || lb.rows || lb.items || (Array.isArray(lb) ? lb : null))) || []))
          .catch(() => fill(null));
      } catch (_) { fill(null); }
    }

    // ---- Menu wiring ------------------------------------------------------
    ctx.listen($("btnPlay"), "click", () => { firstGesture(); sfx.ui(); haptic("light"); startRun(); });
    ctx.listen($("btnShop"), "click", () => { firstGesture(); sfx.ui(); renderShop(); el.shop.classList.remove("id-hidden"); });
    ctx.listen($("btnShopClose"), "click", () => { sfx.ui(); el.shop.classList.add("id-hidden"); refreshWallet(); });
    ctx.listen($("btnBoards"), "click", () => { firstGesture(); sfx.ui(); renderBoards(); el.boards.classList.remove("id-hidden"); });
    ctx.listen($("btnLbClose"), "click", () => { sfx.ui(); el.boards.classList.add("id-hidden"); });
    ctx.listen($("btnHow"), "click", () => { firstGesture(); sfx.ui(); el.how.classList.remove("id-hidden"); });
    ctx.listen($("btnHowOk"), "click", () => { sfx.ui(); el.how.classList.add("id-hidden"); });
    ctx.listen(el.muteBtn, "click", () => { firstGesture(); muted = !muted; store.set("muted", muted); applyMute(); sfx.ui(); });
    ctx.listen(el.pauseBtn, "click", () => { if (state === "run") pauseRun(); });
    ctx.listen($("btnResume"), "click", () => { sfx.ui(); resumeRun(); });
    ctx.listen($("btnRestart"), "click", () => { sfx.ui(); el.pause.classList.add("id-hidden"); startRun(); });
    ctx.listen($("btnQuit"), "click", () => { sfx.ui(); el.pause.classList.add("id-hidden"); quitToMenu(); });

    refreshWallet();
    applyMute();

    // First visible frame is the DOM menu — declare readiness now.
    try { ctx.markVisualReady("menu"); } catch (_) {}
    ctx.platform.ready();

    // =====================================================================
    // 5. Engine bootstrap. One declared registry pin, retried; the failure
    //    screen reports the real error and can retry rather than dead-end.
    // =====================================================================
    let THREE = null;
    let lastLoadErr = "";
    const loadErrs = [];
    function noteErr(err) {
      const m = String((err && err.message) || err || "load failed").slice(0, 150);
      if (loadErrs.indexOf(m) === -1) loadErrs.push(m);
      lastLoadErr = loadErrs.join(" | ");
    }
    function usable(mod) {
      if (mod && !mod.WebGLRenderer && mod.default) mod = mod.default;
      return mod && mod.WebGLRenderer ? mod : null;
    }
    async function importThree() {
      for (let i = 0; i < 4; i++) {
        if (i) await new Promise((r) => ctx.timeout(r, 500 * i));
        try {
          const raw = await ctx.importModule("three", "0.164.1");
          const mod = usable(raw);
          if (mod) return mod;
          noteErr("loaded, but no WebGLRenderer (keys: " + Object.keys(raw || {}).slice(0, 5).join(",") + ")");
        } catch (err) { noteErr(err); }
      }
      return null;
    }
    while (!THREE) {
      THREE = await importThree();
      if (THREE) break;
      try { ctx.platform.error({ reason: "three_import_failed", message: lastLoadErr }); } catch (_) {}
      await new Promise((resolve) => {
        const f = document.createElement("div");
        f.className = "id-fatal";
        f.innerHTML = "<div><div style='font-size:44px;'>\u{1F5FF}</div>" +
          "<div style='font-size:16px;font-weight:800;margin-top:10px;'>The temple didn't load.</div>" +
          "<div style='font-size:13px;opacity:.75;margin-top:6px;'>Check your connection, then try again.</div>" +
          "<button class='id-btn' id='idRetry' style='margin:18px auto 0;width:200px;'>Try again</button>" +
          "<div style='font-size:10px;opacity:.4;margin-top:14px;word-break:break-word;'>" + esc(lastLoadErr) + "</div></div>";
        ui.appendChild(f);
        ctx.listen(f.querySelector("#idRetry"), "click", () => { sfx.ui(); f.remove(); resolve(); });
      });
    }

    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (e1) {
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false }); }
      catch (e2) {
        const f = document.createElement("div");
        f.className = "id-fatal";
        f.innerHTML = "<div><div style='font-size:44px;'>\u{1F5FF}</div><div style='font-size:15px;font-weight:800;margin-top:10px;'>This device couldn't start 3D graphics.<br>Close other apps and reopen.</div></div>";
        ui.appendChild(f);
        try { ctx.platform.error({ reason: "webgl_unavailable" }); } catch (_) {}
        return;
      }
    }
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x140d06, 1);
    ctx.listen(canvas, "webglcontextlost", (e) => { e.preventDefault(); });
    ctx.listen(canvas, "webglcontextrestored", () => { try { renderer.resetState(); } catch (_) {} });

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x8a6a3a, 62, 210);
    const camera = new THREE.PerspectiveCamera(68, ctx.width / Math.max(1, ctx.height), 0.1, 320);
    camera.rotation.order = "YXZ";
    scene.add(camera);

    const hemi = new THREE.HemisphereLight(0xfff0d0, 0x40301c, 1.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe6b8, 1.5);
    sun.position.set(-8, 18, 6);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

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
    // 6. Procedural texture painting. Offscreen only — the runtime rejects
    //    document-created canvases; without OffscreenCanvas we fall back to
    //    flat colours (plainer, never blank).
    // =====================================================================
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function paint(size, fn) {
      if (!CAN_BAKE) return null;
      let c = null;
      try { c = new OffscreenCanvas(size, size); } catch (_) { return null; }
      fn(c.getContext("2d"), size);
      return c;
    }
    function rng(seed) {
      let r = seed || 7;
      return () => { r = (r * 16807) % 2147483647; return (r & 0xffff) / 0xffff; };
    }
    const TEX = {
      // Weathered temple flagstones with moss in the joints.
      stone: (base, joint, moss) => paint(128, (g, s) => {
        g.fillStyle = base; g.fillRect(0, 0, s, s);
        const rand = rng(11);
        const img = g.getImageData(0, 0, s, s), d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() - 0.5) * 26;
          d[i] += v; d[i + 1] += v; d[i + 2] += v;
        }
        g.putImageData(img, 0, 0);
        g.strokeStyle = joint; g.lineWidth = 4;
        for (let r = 0; r < 4; r++) {
          const y = r * 32;
          g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
          const off = (r % 2) * 32;
          for (let c2 = 0; c2 < 2; c2++) {
            const x = off + c2 * 64;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke();
          }
        }
        g.fillStyle = moss; g.globalAlpha = 0.5;
        for (let i = 0; i < 40; i++) {
          g.beginPath(); g.arc(rand() * s, rand() * s, 2 + rand() * 7, 0, 6.28); g.fill();
        }
        g.globalAlpha = 1;
      }),
      // Dense canopy leaves for the side walls of foliage.
      leaves: (dark, mid, light) => paint(128, (g, s) => {
        g.fillStyle = dark; g.fillRect(0, 0, s, s);
        const rand = rng(29);
        for (let i = 0; i < 130; i++) {
          g.fillStyle = rand() < 0.5 ? mid : light;
          g.save();
          g.translate(rand() * s, rand() * s);
          g.rotate(rand() * 6.28);
          g.beginPath();
          g.ellipse(0, 0, 4 + rand() * 9, 2 + rand() * 4, 0, 0, 6.28);
          g.fill();
          g.restore();
        }
      }),
      // Carved relief band for temple walls and pillars.
      carving: (base, cut, gold) => paint(128, (g, s) => {
        g.fillStyle = base; g.fillRect(0, 0, s, s);
        g.strokeStyle = cut; g.lineWidth = 5;
        for (let i = 0; i < 4; i++) {
          const y = 16 + i * 32;
          g.beginPath();
          for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.18 + i) * 6);
          g.stroke();
        }
        g.fillStyle = gold;
        for (let i = 0; i < 8; i++) {
          const x = 8 + (i % 4) * 32, y = 8 + ((i / 4) | 0) * 64;
          g.fillRect(x, y, 10, 10);
        }
      }),
      wood: (c1, c2) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        g.strokeStyle = c2; g.lineWidth = 3; g.globalAlpha = 0.6;
        for (let i = 0; i < 10; i++) {
          const y = (i + 0.5) * s / 10;
          g.beginPath(); g.moveTo(0, y);
          for (let x = 0; x <= s; x += 12) g.lineTo(x, y + Math.sin(x * 0.06 + i * 1.7) * 3);
          g.stroke();
        }
        g.globalAlpha = 1;
      }),
      sky: (top, bot) => paint(64, (g, s) => {
        const grad = g.createLinearGradient(0, 0, 0, s);
        grad.addColorStop(0, top); grad.addColorStop(0.62, bot); grad.addColorStop(1, bot);
        g.fillStyle = grad; g.fillRect(0, 0, s, s);
      }),
      water: (c1, c2) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        g.strokeStyle = c2; g.lineWidth = 3; g.globalAlpha = 0.55;
        for (let i = 0; i < 12; i++) {
          const y = i * 11;
          g.beginPath();
          for (let x = 0; x <= s; x += 6) g.lineTo(x, y + Math.sin(x * 0.14 + i) * 3);
          g.stroke();
        }
        g.globalAlpha = 1;
      }),
      sand: (c1, c2) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        const img = g.getImageData(0, 0, s, s), d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() - 0.5) * 30;
          d[i] += v; d[i + 1] += v; d[i + 2] += v;
        }
        g.putImageData(img, 0, 0);
        g.strokeStyle = c2; g.globalAlpha = 0.35; g.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const y = i * 16;
          g.beginPath();
          for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.09 + i) * 5);
          g.stroke();
        }
        g.globalAlpha = 1;
      }),
      ice: (c1, c2) => paint(128, (g, s) => {
        g.fillStyle = c1; g.fillRect(0, 0, s, s);
        const rand = rng(53);
        g.strokeStyle = c2; g.lineWidth = 2; g.globalAlpha = 0.7;
        for (let i = 0; i < 22; i++) {
          g.beginPath();
          let x = rand() * s, y = rand() * s;
          g.moveTo(x, y);
          for (let k = 0; k < 3; k++) { x += (rand() - 0.5) * 44; y += (rand() - 0.5) * 44; g.lineTo(x, y); }
          g.stroke();
        }
        g.globalAlpha = 1;
      })
    };

    const texCache = new Map();
    function tex(canvasEl, repX, repY, key) {
      if (!canvasEl) return null;
      const ck = key + "|" + repX.toFixed(2) + "|" + repY.toFixed(2);
      if (texCache.has(ck)) return texCache.get(ck);
      const t = new THREE.CanvasTexture(canvasEl);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.repeat.set(repX, repY);
      texCache.set(ck, t);
      return t;
    }

    // =====================================================================
    // 7. Biomes — the run cycles through them as distance climbs, the way
    //    Temple Run 2 swaps its map dressing.
    // =====================================================================
    const BIOMES = [
      {
        id: "jungle", skyTop: "#7fc0e8", skyBot: "#cfe8b0", name: "Lost Jungle", music: "jungle",
        fog: 0x9ab06a, sky: 0x7fa04a, sun: 0xfff0c8, hemi: 0xdff0b0, ground: 0x2c3a18,
        path: () => TEX.stone("#7d7566", "#514a3d", "#5c7a34"),
        pathColor: 0x8a8272, wallTex: () => TEX.leaves("#1e3312", "#2f5a1c", "#4a8226"),
        wallColor: 0x2f5a1c, prop: "tree", accent: 0xd9b25a
      },
      {
        id: "temple", skyTop: "#4a5a78", skyBot: "#a08a68", name: "Sunken Temple", music: "spooky",
        fog: 0x6a5a44, sky: 0x4a3d2c, sun: 0xffd9a0, hemi: 0xbfa88a, ground: 0x201a12,
        path: () => TEX.stone("#8d8270", "#4a4236", "#3f6b2c"),
        pathColor: 0x92876f, wallTex: () => TEX.carving("#6d6252", "#453d31", "#c9a33c"),
        wallColor: 0x6d6252, prop: "pillar", accent: 0xc9a33c
      },
      {
        id: "cliff", skyTop: "#8fd0f0", skyBot: "#dcefff", name: "Cliffside Falls", music: "drift",
        fog: 0x9ec6d8, sky: 0x8fc0dc, sun: 0xffffff, hemi: 0xd8ecf6, ground: 0x2a3c46,
        path: () => TEX.wood("#7a5a34", "#5c4126"),
        pathColor: 0x7a5a34, wallTex: () => TEX.stone("#6f7a80", "#4b5358", "#3f6b4a"),
        wallColor: 0x6f7a80, prop: "falls", accent: 0x8fd8f0
      },
      {
        id: "sands", skyTop: "#f0c878", skyBot: "#f8e6b8", name: "Blazing Sands", music: "arcade",
        fog: 0xe8c98a, sky: 0xf0d49a, sun: 0xfff3d0, hemi: 0xffe9c0, ground: 0x8a6a3a,
        path: () => TEX.sand("#d8b478", "#b08a4e"),
        pathColor: 0xd8b478, wallTex: () => TEX.sand("#c49a5e", "#9a7440"),
        wallColor: 0xc49a5e, prop: "obelisk", accent: 0xffd979
      },
      {
        id: "frost", skyTop: "#7f9fc8", skyBot: "#dceaf6", name: "Frozen Shadows", music: "drone",
        fog: 0xa8c4d8, sky: 0x8fa8c0, sun: 0xe8f4ff, hemi: 0xcfe4f4, ground: 0x38485a,
        path: () => TEX.ice("#b8d0e0", "#e8f4ff"),
        pathColor: 0xb8d0e0, wallTex: () => TEX.ice("#8fa8bc", "#cfe4f4"),
        wallColor: 0x8fa8bc, prop: "spire", accent: 0x9fe0ff
      }
    ];

    // =====================================================================
    // 8. Track model.
    //
    //  The runner always moves forward along the CURRENT segment. Segments
    //  are axis-aligned straights joined by 90-degree corners; each segment
    //  records its world origin and heading so meshes can be placed in world
    //  space while gameplay stays 1-D (distance along the segment + lane).
    //
    //  headings: 0 = +Z, 1 = +X, 2 = -Z, 3 = -X
    // =====================================================================
    const LANE_W = 2.2;              // metres between lane centres
    const PATH_W = LANE_W * 3 + 1.0; // walkable width
    const SEG_MIN = 46, SEG_MAX = 82;
    const HEAD_DIR = [
      { x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }
    ];
    function headYaw(h) { return [0, Math.PI / 2, Math.PI, -Math.PI / 2][h]; }
    // A three.js camera looks down its local -Z, so it needs the opposite yaw
    // to face the direction of travel.
    function camYawFor(h) { return headYaw(h) + Math.PI; }

    const track = [];        // active segments
    let segCounter = 0;
    const OB = { ROOT: "root", GATE: "gate", GAP: "gap", FIRE: "fire", BLADE: "blade", WALL: "wall" };

    const group = new THREE.Group();
    scene.add(group);

    // --- material helpers (cached; each biome gets its own set) -----------
    const matCache = new Map();
    function mat(key, color, canvasEl, repX, repY) {
      const ck = key + "|" + color + "|" + repX + "|" + repY;
      if (matCache.has(ck)) return matCache.get(ck);
      const m = new THREE.MeshLambertMaterial({ color: canvasEl ? 0xffffff : color });
      const t = tex(canvasEl, repX, repY, key);
      if (t) m.map = t;
      matCache.set(ck, m);
      return m;
    }
    function basicMat(key, color) {
      const ck = "b|" + key + "|" + color;
      if (matCache.has(ck)) return matCache.get(ck);
      const m = new THREE.MeshBasicMaterial({ color });
      matCache.set(ck, m);
      return m;
    }

    const GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
      cone: new THREE.ConeGeometry(1, 1, 10),
      sphere: new THREE.SphereGeometry(1, 12, 10),
      torus: new THREE.TorusGeometry(1, 0.28, 8, 18),
      plane: new THREE.PlaneGeometry(1, 1)
    };
    function meshOf(geo, material, sx, sy, sz) {
      const m = new THREE.Mesh(geo, material);
      m.scale.set(sx, sy, sz);
      return m;
    }

    // Place a mesh into world space from (segment, forward distance, lateral)
    function place(mesh, seg, fwd, lat, y) {
      const d = HEAD_DIR[seg.head];
      const rx = -d.z, rz = d.x;                  // right vector
      mesh.position.set(
        seg.ox + d.x * fwd + rx * lat,
        y,
        seg.oz + d.z * fwd + rz * lat
      );
      mesh.rotation.y = headYaw(seg.head);
      return mesh;
    }

    let biomeIndex = 0;
    function biome() { return BIOMES[biomeIndex]; }

    // --- segment construction ---------------------------------------------
    function buildSegment(prev, forceStraight, lenOverride) {
      const b = biome();
      const seg = {
        id: segCounter++,
        head: prev ? prev.nextHead : 0,
        ox: 0, oz: 0,
        len: lenOverride || Math.round(rnd(SEG_MIN, SEG_MAX)),
        turn: 0,            // -1 left, +1 right, 0 straight-on (only at the very start)
        obstacles: [],
        pickups: [],
        meshes: [],
        biome: biomeIndex
      };
      if (prev) {
        const d = HEAD_DIR[prev.head];
        seg.ox = prev.ox + d.x * prev.len;
        seg.oz = prev.oz + d.z * prev.len;
      }
      // Every segment except the first ends in a corner; the corner direction
      // is chosen now so the *previous* segment can signpost it.
      seg.turn = forceStraight ? 0 : (Math.random() < 0.5 ? -1 : 1);
      seg.nextHead = seg.turn === 0
        ? seg.head
        : ((seg.head + (seg.turn === 1 ? 1 : 3)) % 4 + 4) % 4;
      populateSegment(seg);
      buildSegmentMeshes(seg, b);
      track.push(seg);
      return seg;
    }

    // --- what goes ON a segment -------------------------------------------
    function difficultyAt(dist) {
      // 0 at the start, 1 by ~3km — governs obstacle density and variety.
      return clamp(dist / 1800, 0, 1);
    }
    function populateSegment(seg) {
      const D = difficultyAt(runDistance + seg.id * 10);
      const startPad = seg.id === 0 ? 48 : 12;   // long clear runway to open
      const endPad = 13;                          // clear run-up to the corner
      const usable = seg.len - startPad - endPad;
      if (usable < 12) return;

      const gapMin = lerp(14, 6.5, D);
      let z = startPad + rnd(2, 7);
      const kinds = [OB.ROOT, OB.GATE, OB.WALL];
      if (D > 0.1) kinds.push(OB.GAP);
      if (D > 0.22) kinds.push(OB.FIRE);
      if (D > 0.38) kinds.push(OB.BLADE);

      while (z < startPad + usable) {
        const kind = pick(kinds);
        // How many lanes this hazard eats. Later runs block more.
        let lanes;
        if (kind === OB.GAP) {
          lanes = Math.random() < lerp(0.25, 0.62, D) ? [-1, 0, 1] : pick([[-1, 0], [0, 1], [-1], [0], [1]]);
        } else if (kind === OB.GATE) {
          lanes = Math.random() < lerp(0.3, 0.7, D) ? [-1, 0, 1] : pick([[-1, 0], [0, 1], [0]]);
        } else if (kind === OB.WALL || kind === OB.BLADE) {
          lanes = pick([[-1], [0], [1], [-1, 0], [0, 1], [-1, 1]]);
        } else if (kind === OB.FIRE) {
          lanes = pick([[-1], [0], [1], [-1, 1]]);
        } else {
          lanes = Math.random() < lerp(0.35, 0.75, D) ? [-1, 0, 1] : pick([[-1, 0], [0, 1], [-1], [0], [1]]);
        }
        seg.obstacles.push({ kind, z, lanes, phase: rnd(0, 6.28) });

        // Coins: a run of them in a free lane just after the hazard.
        const freeLanes = [-1, 0, 1].filter((L) => lanes.indexOf(L) === -1);
        if (freeLanes.length && Math.random() < 0.8) {
          const lane = pick(freeLanes);
          const n = 4 + ((Math.random() * 5) | 0);
          const arc = kind === OB.ROOT || kind === OB.GAP;   // coins arc over jumps
          for (let i = 0; i < n; i++) {
            seg.pickups.push({
              type: "coin", z: z + 2.5 + i * 1.7, lane,
              y: arc ? 0.9 + Math.sin((i / (n - 1)) * Math.PI) * 1.7 : 1.0,
              taken: false
            });
          }
        }
        z += gapMin + rnd(2, 9 - D * 4);
      }

      // Occasional gem — the currency that buys upgrades.
      if (Math.random() < 0.34) {
        seg.pickups.push({
          type: "gem", z: startPad + rnd(6, Math.max(8, usable - 4)),
          lane: pick([-1, 0, 1]), y: 1.15, taken: false
        });
      }
      // Powerup crate.
      if (Math.random() < 0.42) {
        seg.pickups.push({
          type: "power", kind: pick(["shield", "magnet", "boost", "mult"]),
          z: startPad + rnd(8, Math.max(10, usable - 6)),
          lane: pick([-1, 0, 1]), y: 1.15, taken: false
        });
      }
    }

    // --- meshes for a segment ---------------------------------------------
    function buildSegmentMeshes(seg, b) {
      const L = seg.len;
      const add = (m) => { group.add(m); seg.meshes.push(m); return m; };

      // Walkway. Gaps are rendered by omitting floor tiles, so the floor is
      // built as spans between the gap hazards.
      const gaps = seg.obstacles.filter((o) => o.kind === OB.GAP);
      const spans = [];
      // Segments after the first begin past the corner deck they turn out of,
      // so their floor neither overlaps nor gaps.
      let cursor = seg.id === 0 ? -6 : PATH_W / 2 - 0.4;
      for (const g of gaps) {
        const gs = g.z - 1.6, ge = g.z + 1.6;
        // full-width gaps split the floor; partial gaps punch single lanes
        if (g.lanes.length === 3) {
          if (gs > cursor) spans.push([cursor, gs]);
          cursor = ge;
        }
      }
      if (cursor < L + 6) spans.push([cursor, L + 6]);

      const TILE = 8;
      const pathMat = mat("path" + b.id, b.pathColor, b.path(), PATH_W / 3.2, TILE / 3.2);
      for (const [s0, s1] of spans) {
        const len = s1 - s0;
        if (len <= 0.2) continue;
        const n = Math.max(1, Math.ceil(len / TILE));
        const step = len / n;
        for (let i = 0; i < n; i++) {
          const floor = meshOf(GEO.box, pathMat, PATH_W, 0.5, step + 0.03);
          place(floor, seg, s0 + step * (i + 0.5), 0, -0.25);
          add(floor);
        }
      }
      // Lane-sized holes for partial gaps: cut by drawing floor only in the
      // remaining lanes across that short stretch.
      for (const g of gaps) {
        if (g.lanes.length === 3) continue;
        const keep = [-1, 0, 1].filter((L2) => g.lanes.indexOf(L2) === -1);
        // remove the full-width strip we just drew by overlaying a dark pit,
        // then re-lay floor for the surviving lanes
        const pit = meshOf(GEO.box, basicMat("pit", 0x05040300 | 0x0a0806), PATH_W, 0.6, 3.2);
        place(pit, seg, g.z, 0, -0.32);
        add(pit);
        for (const kl of keep) {
          const strip = meshOf(GEO.box, pathMat, LANE_W - 0.05, 0.5, 3.2);
          place(strip, seg, g.z, kl * LANE_W, -0.25);
          add(strip);
        }
      }

      // Lane dividers: faint inlaid strips so the three lanes are legible.
      const trimMat = mat("trim" + b.id, b.pathColor, null, 1, 1);
      for (const lx of [-LANE_W / 2, LANE_W / 2]) {
        const nTrim = Math.max(1, Math.ceil(L / 6));
        for (let i = 0; i < nTrim; i++) {
          const t = meshOf(GEO.box, trimMat, 0.07, 0.055, 2.4);
          place(t, seg, i * 6 + 2, lx, 0.03);
          add(t);
        }
      }

      // Side rails / kerbs so the path edge reads clearly.
      const kerbMat = mat("kerb" + b.id, b.wallColor, b.wallTex(), 6, 1);
      const kStart = seg.id === 0 ? -6 : PATH_W / 2 - 0.4;
      const kEnd = L + (seg.turn !== 0 ? PATH_W / 2 : 6);
      for (const side of [-1, 1]) {
        const kerb = meshOf(GEO.box, kerbMat, 0.5, 0.55, kEnd - kStart);
        place(kerb, seg, (kStart + kEnd) / 2, side * (PATH_W / 2 + 0.2), 0.1);
        add(kerb);
      }

      // Scenery walls beyond the kerbs, tiled so the pattern keeps its scale
      // and kept low enough that sky stays visible above the run.
      const WT = 12;
      const wallMat = mat("wall" + b.id, b.wallColor, b.wallTex(), WT / 4, 6 / 4);
      const wStart = seg.id === 0 ? -8 : PATH_W / 2 + 0.2;
      const wEnd = L + (seg.turn !== 0 ? PATH_W / 2 + 0.2 : 6);
      const wallSpan = wEnd - wStart, wn = Math.max(1, Math.ceil(wallSpan / WT));
      const wstep = wallSpan / wn;
      for (const side of [-1, 1]) {
        for (let i = 0; i < wn; i++) {
          const wall = meshOf(GEO.box, wallMat, 3.2, 6, wstep + 0.05);
          place(wall, seg, wStart + wstep * (i + 0.5), side * (PATH_W / 2 + 2.4), 2.4);
          add(wall);
        }
      }

      // Ground plane beyond the walls, so the corridor sits in a world.
      const groundMat = mat("gnd" + b.id, b.ground, null, 1, 1);
      for (const side of [-1, 1]) {
        const gp = meshOf(GEO.box, groundMat, 60, 0.4, L + 20);
        place(gp, seg, L / 2, side * 36, -1.9);
        add(gp);
      }
      // Far silhouettes: canopy / ridgeline receding into the fog.
      const farMat = mat("far" + b.id, b.wallColor, null, 1, 1);
      for (let i = 0; i < Math.floor(L / 16); i++) {
        for (const side of [-1, 1]) {
          const z2 = 8 + i * 16 + rnd(-4, 4);
          const h2 = rnd(9, 22);
          const far = meshOf(b.prop === "spire" || b.prop === "obelisk" ? GEO.cone : GEO.sphere,
            farMat, rnd(5, 11), h2, rnd(5, 11));
          place(far, seg, z2, side * rnd(20, 42), h2 * 0.4);
          add(far);
        }
      }

      // Props along the sides — silhouette variety per biome.
      const propMat = mat("prop" + b.id, b.wallColor, b.wallTex(), 2, 3);
      const accentMat = mat("acc" + b.id, b.accent, null, 1, 1);
      for (let i = 0; i < Math.floor(L / 5.5); i++) {
        const z = 6 + i * 5.5 + rnd(-1.6, 1.6);
        const side = Math.random() < 0.5 ? -1 : 1;
        const lat = side * (PATH_W / 2 + rnd(3.4, 6.2));
        if (b.prop === "tree") {
          const trunk = meshOf(GEO.cyl, propMat, 0.5, 11, 0.5);
          place(trunk, seg, z, lat, 5.5); add(trunk);
          const crown = meshOf(GEO.sphere, wallMat, 3.4, 2.4, 3.4);
          place(crown, seg, z, lat, 11.5); add(crown);
        } else if (b.prop === "pillar") {
          const col = meshOf(GEO.cyl, propMat, 0.85, 10, 0.85);
          place(col, seg, z, lat, 5); add(col);
          const cap = meshOf(GEO.box, accentMat, 2.2, 0.6, 2.2);
          place(cap, seg, z, lat, 10.2); add(cap);
        } else if (b.prop === "falls") {
          const fall = meshOf(GEO.box, mat("fall", 0x8fd8f0, TEX.water("#6fc8e8", "#cfeeff"), 1, 4), 4, 14, 0.4);
          place(fall, seg, z, lat * 1.5, 7); add(fall);
          fall.userData.scroll = true;
        } else if (b.prop === "obelisk") {
          const ob = meshOf(GEO.box, propMat, 1.3, 9, 1.3);
          place(ob, seg, z, lat, 4.5); add(ob);
          const tip = meshOf(GEO.cone, accentMat, 1.0, 1.6, 1.0);
          place(tip, seg, z, lat, 9.8); add(tip);
        } else {
          const sp = meshOf(GEO.cone, propMat, 1.6, 8, 1.6);
          place(sp, seg, z, lat, 4); add(sp);
        }
        // Small dressing right at the path edge: urns, rubble, vines, glyphs.
        if (Math.random() < 0.7) {
          const eside = Math.random() < 0.5 ? -1 : 1;
          const elat = eside * (PATH_W / 2 + rnd(0.7, 1.5));
          const roll = Math.random();
          if (roll < 0.3) {
            const urn = meshOf(GEO.cyl, accentMat, 0.34, 0.8, 0.34);
            place(urn, seg, z + rnd(-2, 2), elat, 0.4); add(urn);
          } else if (roll < 0.55) {
            const rub = meshOf(GEO.box, propMat, rnd(0.4, 0.9), rnd(0.3, 0.6), rnd(0.4, 0.9));
            place(rub, seg, z + rnd(-2, 2), elat, 0.2);
            rub.rotation.y += rnd(0, 3); add(rub);
          } else if (roll < 0.8) {
            const vine = meshOf(GEO.box, wallMat, 0.3, rnd(2, 4.5), 0.3);
            place(vine, seg, z + rnd(-2, 2), eside * (PATH_W / 2 + 2.2), 4.4); add(vine);
          } else {
            const glyph = meshOf(GEO.box, accentMat, 0.7, 0.7, 0.12);
            place(glyph, seg, z + rnd(-2, 2), eside * (PATH_W / 2 + 2.3), rnd(1.4, 3.4));
            add(glyph);
          }
        }
      }
      // Occasional arch spanning the path — depth cue and drama.
      for (let i = 0; i < Math.floor(L / 52); i++) {
        const z = 26 + i * 52 + rnd(-5, 5);
        if (z > L - 16) continue;
        for (const side of [-1, 1]) {
          const col = meshOf(GEO.cyl, propMat, 0.45, 8.4, 0.45);
          place(col, seg, z, side * (PATH_W / 2 + 0.5), 4.2); add(col);
        }
        const lintel = meshOf(GEO.box, propMat, PATH_W + 2.2, 0.7, 0.8);
        place(lintel, seg, z, 0, 8.7); add(lintel);
        const frieze = meshOf(GEO.box, accentMat, PATH_W + 1.0, 0.3, 0.5);
        place(frieze, seg, z, 0, 9.3); add(frieze);
      }

      // Corner signposting: a wall straight ahead plus banners on the turn
      // side, so the player can read the corner before they reach it.
      if (seg.turn !== 0) {
        // The corner deck, so the turn has floor under it.
        const corner = meshOf(GEO.box, pathMat, PATH_W, 0.5, PATH_W);
        place(corner, seg, L + PATH_W / 2 - 0.5, 0, -0.25);
        add(corner);

        // Dead-end wall well beyond the deck, so it never crowds the turn.
        const endWall = meshOf(GEO.box, wallMat, PATH_W + 7, 9, 2.4);
        place(endWall, seg, L + PATH_W + 2.6, 0, 4.5);
        add(endWall);

        // A big glowing arrow painted on the deck, unmistakable from range.
        const arrowMat = basicMat("arrow", 0xffe14a);
        const shaft = meshOf(GEO.box, arrowMat, 4.6, 0.08, 1.15);
        place(shaft, seg, L + 1.0, seg.turn * 0.9, 0.06);
        add(shaft);
        for (let i = 0; i < 2; i++) {
          const barb = meshOf(GEO.box, arrowMat, 2.0, 0.08, 1.0);
          place(barb, seg, L + 1.0 + (i ? 1.5 : -1.5), seg.turn * 2.7, 0.06);
          barb.rotation.y += (i ? -1 : 1) * seg.turn * 0.85;
          add(barb);
        }
        // Approach chevrons stepping toward the turn side.
        for (let i = 0; i < 3; i++) {
          const chev = meshOf(GEO.box, arrowMat, 1.5, 0.07, 0.38);
          place(chev, seg, L - 17 + i * 5, seg.turn * (0.6 + i * 0.55), 0.05);
          chev.rotation.y += seg.turn * 0.5;
          add(chev);
          chev.userData.pulse = i * 0.35;
        }
        // Torches marking the exit, on the side you must turn toward.
        for (let i = 0; i < 3; i++) {
          const post = meshOf(GEO.cyl, mat("torchpost", 0x3a2a1a, null, 1, 1), 0.16, 2.6, 0.16);
          place(post, seg, L - 6 + i * 4.2, seg.turn * (PATH_W / 2 + 0.8), 1.3);
          add(post);
          const fire = meshOf(GEO.sphere, basicMat("torchfire", 0xffa63a), 0.42, 0.62, 0.42);
          place(fire, seg, L - 6 + i * 4.2, seg.turn * (PATH_W / 2 + 0.8), 2.8);
          add(fire);
          fire.userData.torch = i * 1.1;
        }
        seg.arrowMeshes = seg.meshes.filter((m) => m.userData.pulse !== undefined || m.userData.torch !== undefined);
      }

      // Obstacle meshes.
      for (const o of seg.obstacles) {
        if (o.kind === OB.GAP) continue;               // holes are floor-absence
        for (const lane of o.lanes) {
          const lat = lane * LANE_W;
          let m = null;
          if (o.kind === OB.ROOT) {
            m = meshOf(GEO.cyl, mat("root", 0x6a4a24, TEX.wood("#6a4a24", "#4a3218"), 1, 2), 0.45, LANE_W, 0.45);
            place(m, seg, o.z, lat, 0.42);
            m.rotation.x = Math.PI / 2;
            m.rotation.z = headYaw(seg.head);
          } else if (o.kind === OB.GATE) {
            m = meshOf(GEO.box, mat("gate", 0x8a6a3a, TEX.carving("#8a6a3a", "#5c4526", "#d9b25a"), 2, 1), LANE_W - 0.1, 1.25, 0.45);
            place(m, seg, o.z, lat, 2.35);
            const post = meshOf(GEO.box, mat("gate", 0x8a6a3a, null, 1, 1), 0.22, 1.7, 0.3);
            place(post, seg, o.z, lat, 0.85); add(post);
          } else if (o.kind === OB.WALL) {
            m = meshOf(GEO.box, mat("wallob", 0x7a6a54, TEX.stone("#7a6a54", "#4e4436", "#4a6b2c"), 1, 1), LANE_W - 0.1, 2.2, 0.7);
            place(m, seg, o.z, lat, 1.1);
          } else if (o.kind === OB.FIRE) {
            m = meshOf(GEO.box, mat("brazier", 0x5a4a38, null, 1, 1), 1.1, 0.9, 1.1);
            place(m, seg, o.z, lat, 0.45);
            const flame = meshOf(GEO.cone, basicMat("flame", 0xff8a2a), 0.85, 2.4, 0.85);
            place(flame, seg, o.z, lat, 2.1);
            flame.userData.flame = o;
            add(flame);
            o.flameMesh = o.flameMesh || [];
            o.flameMesh.push(flame);
          } else if (o.kind === OB.BLADE) {
            m = meshOf(GEO.torus, basicMat("blade", 0xc0c8d0), 1.15, 1.15, 1.15);
            place(m, seg, o.z, lat, 1.5);
            m.rotation.x = Math.PI / 2;
            m.userData.spin = o;
            o.bladeMesh = o.bladeMesh || [];
            o.bladeMesh.push(m);
          }
          if (m) add(m);
        }
      }

      // Pickup meshes.
      for (const p of seg.pickups) {
        let m;
        if (p.type === "coin") {
          m = meshOf(GEO.cyl, basicMat("coin", 0xffd150), 0.42, 0.09, 0.42);
          m.rotation.x = Math.PI / 2;
        } else if (p.type === "gem") {
          m = meshOf(GEO.cone, basicMat("gem", 0x4ce8a8), 0.42, 0.85, 0.42);
        } else {
          const col = p.kind === "shield" ? 0x6fc8ff : p.kind === "magnet" ? 0xff7a5a
            : p.kind === "boost" ? 0xffd150 : 0xd08aff;
          m = meshOf(GEO.box, basicMat("pw" + p.kind, col), 0.95, 0.95, 0.95);
        }
        place(m, seg, p.z, p.lane * LANE_W, p.y);
        p.mesh = m;
        add(m);
      }
    }

    function disposeSegment(seg) {
      for (const m of seg.meshes) group.remove(m);
      seg.meshes.length = 0;
    }

    // =====================================================================
    // 9. The runner.
    // =====================================================================
    const runner = new THREE.Group();
    scene.add(runner);
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xd8a070 });
    const shirtMat = new THREE.MeshLambertMaterial({ color: 0xc8503c });
    const pantMat = new THREE.MeshLambertMaterial({ color: 0x4a6a8c });
    const hatMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
    const body = {
      torso: meshOf(GEO.box, shirtMat, 0.62, 0.72, 0.38),
      head: meshOf(GEO.sphere, skinMat, 0.27, 0.29, 0.27),
      hat: meshOf(GEO.cyl, hatMat, 0.36, 0.1, 0.36),
      armL: meshOf(GEO.box, skinMat, 0.17, 0.6, 0.18),
      armR: meshOf(GEO.box, skinMat, 0.17, 0.6, 0.18),
      legL: meshOf(GEO.box, pantMat, 0.2, 0.68, 0.22),
      legR: meshOf(GEO.box, pantMat, 0.2, 0.68, 0.22),
      idol: meshOf(GEO.box, new THREE.MeshBasicMaterial({ color: 0x6ce8b0 }), 0.3, 0.36, 0.3)
    };
    body.torso.position.set(0, 1.06, 0);
    body.head.position.set(0, 1.58, 0);
    body.hat.position.set(0, 1.74, 0);
    body.armL.position.set(-0.4, 1.1, 0);
    body.armR.position.set(0.4, 1.1, 0);
    body.legL.position.set(-0.17, 0.36, 0);
    body.legR.position.set(0.17, 0.36, 0);
    body.idol.position.set(0.42, 1.0, 0.2);
    for (const k in body) runner.add(body[k]);

    // Contact shadow — makes jump height and lane position readable.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.36, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);

    // Shield bubble.
    const shieldMesh = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({
      color: 0x6fc8ff, transparent: true, opacity: 0.3
    }));
    shieldMesh.scale.set(1.15, 1.35, 1.15);
    shieldMesh.position.y = 1.05;
    shieldMesh.visible = false;
    runner.add(shieldMesh);

    // Guardian monkeys that close in after stumbles.
    const monkeys = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const fur = new THREE.MeshLambertMaterial({ color: i === 0 ? 0x4a2a18 : 0x3a2214 });
      const b1 = meshOf(GEO.sphere, fur, 0.42, 0.38, 0.44);
      b1.position.y = 0.62;
      const h1 = meshOf(GEO.sphere, fur, 0.28, 0.27, 0.28);
      h1.position.set(0, 1.05, 0.06);
      const e1 = meshOf(GEO.sphere, basicMat("eye", 0xffd84a), 0.07, 0.07, 0.07);
      e1.position.set(-0.1, 1.09, 0.24);
      const e2 = meshOf(GEO.sphere, basicMat("eye", 0xffd84a), 0.07, 0.07, 0.07);
      e2.position.set(0.1, 1.09, 0.24);
      g.add(b1, h1, e1, e2);
      g.visible = false;
      scene.add(g);
      monkeys.push({ group: g, off: (i - 1) * 0.85, ph: i * 1.3 });
    }

    // =====================================================================
    // 10. Run state.
    // =====================================================================
    const P = {
      seg: 0, z: 0, lane: 0, laneX: 0, targetLane: 0, armedTurn: 0,
      y: 0, vy: 0, jumping: false, sliding: 0,
      speed: 0, baseSpeed: 0,
      dead: false, stumbleCd: 0, turnBank: 0
    };
    let runDistance = 0, runScore = 0, runCoins = 0, runGems = 0;
    let multiplier = 1, nextMultAt = 500;
    let camYaw = 0, camYawTarget = 0, camShake = 0;
    let stepPhase = 0, revived = false, hintShown = false;
    let biomeChangeAt = 900;
    const pw = { shield: 0, magnet: 0, boost: 0, mult: 0 };

    const SPEED_START = 16.5, SPEED_MAX = 41;

    function resetRunState() {
      for (const s of track) disposeSegment(s);
      track.length = 0;
      segCounter = 0;
      biomeIndex = 0;
      matCache.clear();
      P.seg = 0; P.z = 0; P.lane = 0; P.laneX = 0; P.targetLane = 0;
      P.y = 0; P.vy = 0; P.jumping = false; P.sliding = 0;
      P.dead = false; P.stumbleCd = 0; P.turnBank = 0; P.armedTurn = 0;
      P.baseSpeed = SPEED_START; P.speed = SPEED_START;
      runDistance = 0; runScore = 0; runCoins = 0; runGems = 0;
      multiplier = 1; nextMultAt = 500;
      pw.shield = pw.magnet = pw.boost = pw.mult = 0;
      camShake = 0; stepPhase = 0; revived = false;
      biomeChangeAt = 900;
      monkeyHeat = 0;
      for (const m of monkeys) m.group.visible = false;
      shieldMesh.visible = false;
      coinPitch = 0;

      const first = buildSegment(null, true, 105);   // straight runway to start
      buildSegment(first, false);
      buildSegment(track[1], false);
      buildSegment(track[2], false);
      applyBiomeLook(biome(), true);
      camYaw = camYawTarget = camYawFor(first.head);
    }

    const skyCache = new Map();
    function applyBiomeLook(b, instant) {
      scene.fog.color.setHex(b.fog);
      renderer.setClearColor(b.fog, 1);
      if (!skyCache.has(b.id)) {
        const c = TEX.sky(b.skyTop, b.skyBot);
        skyCache.set(b.id, c ? new THREE.CanvasTexture(c) : null);
      }
      const skyT = skyCache.get(b.id);
      if (skyT) { skyT.colorSpace = THREE.SRGBColorSpace; scene.background = skyT; }
      else scene.background = null;
      sun.color.setHex(b.sun);
      hemi.color.setHex(b.hemi);
      hemi.groundColor.setHex(b.ground);
    }

    // =====================================================================
    // 11. Controls — swipes over the whole surface (nothing bottom-heavy).
    // =====================================================================
    let touch = null;
    function onDown(e) {
      if (state !== "run") return;
      firstGesture();
      const r = canvas.getBoundingClientRect();
      touch = { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, done: false };
      if (!hintShown) { hintShown = true; store.set("hint", 1); el.hint.classList.remove("show"); }
    }
    function onMove(e) {
      if (!touch || touch.done || state !== "run") return;
      const r = canvas.getBoundingClientRect();
      const dx = (e.clientX - r.left) - touch.x;
      const dy = (e.clientY - r.top) - touch.y;
      const TH = 26;
      if (Math.abs(dx) < TH && Math.abs(dy) < TH) return;
      touch.done = true;
      if (Math.abs(dx) > Math.abs(dy)) swipeSide(dx > 0 ? 1 : -1);
      else if (dy < 0) doJump();
      else doSlide();
    }
    function onUp() { touch = null; }
    ctx.listen(canvas, "pointerdown", onDown);
    ctx.listen(canvas, "pointermove", onMove);
    ctx.listen(canvas, "pointerup", onUp);
    ctx.listen(canvas, "pointercancel", onUp);

    function swipeSide(dir) {
      const seg = track[P.seg];
      if (!seg) return;
      // Inside the corner window a sideways swipe is a TURN, not a lane move.
      const toEnd = seg.len - P.z;
      // Roughly a second and a half of warning, whatever the speed.
      const window = Math.max(20, P.speed * 1.5);
      if (seg.turn !== 0 && toEnd < window) {
        // Inside the corner window a sideways swipe is a TURN, buffered until
        // the bend is actually reached.
        P.armedTurn = dir;
        P.turnBank = dir * 0.7;
        return;
      }
      P.targetLane = clamp(P.targetLane + dir, -1, 1);
      P.turnBank = dir * 0.9;
    }
    function takeTurn(seg) {
      sfx.turn(); haptic("light");
      const carry = Math.max(0, P.z - seg.len);
      P.seg += 1;
      P.z = carry;
      P.armedTurn = 0;
      P.targetLane = clamp(P.targetLane, -1, 1);
      P.lane = P.targetLane;
      P.laneX = P.lane * LANE_W;
      camYawTarget = camYawFor(track[P.seg].head);
    }
    function doJump() {
      if (P.jumping || P.sliding > 0) {
        if (P.sliding > 0) P.sliding = 0;   // cancel a slide early
        if (P.jumping) return;
      }
      P.jumping = true;
      P.vy = 9.2;
      sfx.jump(); haptic("light");
    }
    function doSlide() {
      if (P.sliding > 0) return;
      if (P.jumping) { P.vy = Math.min(P.vy, -6); }  // slam down into a slide
      P.sliding = 0.62;
      sfx.slide(); haptic("light");
    }

    // =====================================================================
    // 12. Powerups.
    // =====================================================================
    function grantPower(kind) {
      if (kind === "shield") pw.shield = upVal("shield");
      else if (kind === "magnet") pw.magnet = upVal("magnet");
      else if (kind === "mult") pw.mult = upVal("mult");
      else if (kind === "boost") {
        pw.boost = upVal("boost") / Math.max(1, P.speed) + 1.2;  // metres → seconds
        P.y = 0; P.jumping = false; P.sliding = 0;
      }
      sfx.powerup(kind); haptic("success");
      flash(el.flashGood);
      toast(kind === "shield" ? "🛡️ Shield up" : kind === "magnet" ? "🧲 Coin magnet"
        : kind === "boost" ? "🚀 Boost!" : "✨ Double score");
      try { ctx.platform.interact({ type: "powerup", kind }); } catch (_) {}
    }
    const PW_META = {
      shield: { icon: "🛡️", color: "#6fc8ff" },
      magnet: { icon: "🧲", color: "#ff7a5a" },
      boost: { icon: "🚀", color: "#ffd150" },
      mult: { icon: "✨", color: "#d08aff" }
    };
    const pwMax = { shield: 1, magnet: 1, boost: 1, mult: 1 };
    function renderPowerHud() {
      let html = "";
      for (const k of ["boost", "shield", "magnet", "mult"]) {
        if (pw[k] <= 0) continue;
        const frac = clamp(pw[k] / Math.max(0.01, pwMax[k]), 0, 1);
        html += `<div class="id-pwchip"><span>${PW_META[k].icon}</span>
          <span class="id-pwbar"><i style="transform:scaleX(${frac.toFixed(3)});background:${PW_META[k].color}"></i></span></div>`;
      }
      el.pw.innerHTML = html;
    }

    // =====================================================================
    // 13. Collision + scoring.
    // =====================================================================
    let monkeyHeat = 0;   // 0 = far behind, 1 = on your heels

    function hitObstacle(o) {
      if (pw.boost > 0) return;                 // boost bulldozes everything
      if (pw.shield > 0) {
        pw.shield = 0;
        shieldMesh.visible = false;
        sfx.stumble(); haptic("warning");
        flash(el.flashGood);
        toast("🛡️ Shield took it");
        o.spent = true;
        return;
      }
      if (P.stumbleCd > 0) return;
      P.stumbleCd = 1.1;
      o.spent = true;
      monkeyHeat = clamp(monkeyHeat + 0.36, 0, 1.2);
      camShake = 0.55;
      P.speed = Math.max(SPEED_START * 0.72, P.speed * 0.62);
      sfx.stumble(); haptic("error");
      flash(el.flashHurt);
      if (monkeyHeat >= 1.02) die("caught");
      else toast("😰 Stumble!");
    }

    function collide(dt) {
      const seg = track[P.seg];
      if (!seg) return;
      const laneOf = (x) => Math.round(x / LANE_W);

      for (const o of seg.obstacles) {
        if (o.spent) continue;
        const dz = o.z - P.z;
        if (dz > 1.6 || dz < -1.6) continue;
        const inLane = o.lanes.indexOf(laneOf(P.laneX)) !== -1
          || o.lanes.some((L) => Math.abs(L * LANE_W - P.laneX) < LANE_W * 0.55);
        if (!inLane) continue;

        if (o.kind === OB.GAP) {
          if (P.y < 0.85 && pw.boost <= 0) die("fell");
        } else if (o.kind === OB.GATE) {
          if (P.sliding <= 0 && P.y < 1.4) hitObstacle(o);
        } else if (o.kind === OB.ROOT) {
          if (P.y < 0.7) hitObstacle(o);
        } else if (o.kind === OB.WALL) {
          if (P.y < 1.9) hitObstacle(o);
        } else if (o.kind === OB.FIRE) {
          const on = (Math.sin(runTime * 2.2 + o.phase) > -0.15);
          if (on && P.y < 1.7 && P.sliding <= 0) hitObstacle(o);
        } else if (o.kind === OB.BLADE) {
          if (P.y < 2.4 && P.sliding <= 0) hitObstacle(o);
        }
      }

      // Pickups (current + next segment so nothing is missed at a boundary).
      for (let si = P.seg; si <= P.seg + 1 && si < track.length; si++) {
        const s2 = track[si];
        const zOff = si === P.seg ? 0 : -(seg.len);
        for (const p of s2.pickups) {
          if (p.taken) continue;
          const pz = p.z + zOff;
          const dz = pz - P.z;
          if (dz > 3.5 || dz < -2) continue;
          const lx = p.lane * LANE_W;
          let reach = 1.1;
          if (p.type === "coin" && pw.magnet > 0) reach = 5.2;
          const dx = Math.abs(lx - P.laneX);
          const dy = Math.abs(p.y - (P.y + 0.9));
          if (dx < reach && Math.abs(dz) < 1.5 && (dy < 1.6 || pw.magnet > 0)) {
            p.taken = true;
            if (p.mesh) p.mesh.visible = false;
            if (p.type === "coin") {
              const v = 1 + upLevel("value");
              runCoins += v;
              runScore += 10 * v * (pw.mult > 0 ? 2 : 1) * multiplier;
              sfx.coin();
            } else if (p.type === "gem") {
              runGems += 1;
              runScore += 100 * multiplier;
              sfx.gem(); haptic("success");
              flash(el.flashGood);
            } else {
              grantPower(p.kind);
            }
          } else if (p.type === "coin" && pw.magnet > 0 && p.mesh && Math.abs(dz) < 9) {
            // fly toward the runner
            const t = clamp(1 - Math.abs(dz) / 9, 0, 1);
            p.mesh.position.lerp(runner.position.clone().setY(P.y + 1), 0.12 + t * 0.2);
          }
        }
      }
    }

    // =====================================================================
    // 14. Run lifecycle.
    // =====================================================================
    let runTime = 0;

    function startRun() {
      el.dead.classList.add("id-hidden");
      el.shop.classList.add("id-hidden");
      el.boards.classList.add("id-hidden");
      el.menu.classList.add("id-hidden");
      el.hud.classList.remove("id-hidden");
      el.pauseBtn.classList.remove("id-hidden");
      el.bg.style.opacity = "0";
      el.gemWrap.classList.add("id-hidden");
      el.turn.classList.remove("show");
      resetRunState();
      runTime = 0;
      state = "run";
      updateHud();
      renderPowerHud();
      bed(biome().music, 0.26);
      if (!store.get("hint", 0)) {
        hintShown = false;
        el.hint.classList.add("show");
        ctx.timeout(() => el.hint.classList.remove("show"), 4200);
      }
      try {
        ctx.platform.setProgress(0);
        ctx.platform.interact({ type: "run_start" });
      } catch (_) {}
    }
    function pauseRun() {
      if (state !== "run") return;
      state = "paused";
      touch = null;
      sfx.ui();
      el.pause.classList.remove("id-hidden");
      try { if (canMusic && ctx.music && musicOn && !muted) ctx.music.setVolume(0.08, { fadeMs: 250 }); } catch (_) {}
    }
    function resumeRun() {
      el.pause.classList.add("id-hidden");
      if (state === "paused") state = "run";
      try { if (canMusic && ctx.music && musicOn && !muted) ctx.music.setVolume(0.26, { fadeMs: 250 }); } catch (_) {}
    }
    function quitToMenu() {
      for (const s of track) disposeSegment(s);
      track.length = 0;
      showMenu();
    }

    function updateHud() {
      el.score.textContent = fmt(runScore);
      el.dist.textContent = fmt(runDistance) + " m";
      el.coins.textContent = fmt(runCoins);
      el.gems.textContent = fmt(runGems);
      if (runGems > 0) el.gemWrap.classList.remove("id-hidden");
      el.mult.textContent = "×" + (multiplier * (pw.mult > 0 ? 2 : 1));
    }

    // --- death, revive, results -------------------------------------------
    // A single runtime-owned ticker drives the revive countdown; creating a
    // fresh interval per death would leak one ticker per run.
    const saveState = { left: 0, arc: null, num: null, btn: null };
    ctx.interval(() => {
      if (saveState.left <= 0) return;
      saveState.left -= 1;
      if (saveState.num) saveState.num.textContent = String(Math.max(0, saveState.left));
      if (saveState.arc) saveState.arc.style.strokeDashoffset = String(175.9 * (1 - saveState.left / 5));
      if (saveState.left <= 0 && saveState.btn) {
        saveState.btn.disabled = true;
        saveState.btn.textContent = "Too slow…";
      }
    }, 1000);

    function die(cause) {
      if (P.dead) return;
      P.dead = true;
      state = "dying";
      touch = null;
      sfx.death(); haptic("error");
      flash(el.flashHurt);
      camShake = 0.8;
      el.pauseBtn.classList.add("id-hidden");
      try { ctx.platform.emit("run_end", { cause, distance: Math.floor(runDistance), score: Math.floor(runScore) }); } catch (_) {}
      ctx.timeout(() => showDeath(cause), 900);
    }

    function showDeath(cause) {
      state = "dead";
      el.hud.classList.add("id-hidden");
      el.turn.classList.remove("show");
      const reviveCost = Math.max(2, Math.round(upVal("revive")));
      const canRevive = !revived && wallet.gems + runGems >= reviveCost;
      const score = Math.floor(runScore);
      const dist = Math.floor(runDistance);
      const bestScore = store.get("best_score", 0);
      const bestDist = store.get("best_distance", 0);
      const isBest = score > bestScore;

      el.deadPanel.innerHTML = `
        <div class="big">${cause === "missed" ? "↪️" : cause === "fell" ? "🕳️" : cause === "caught" ? "🐒" : "💥"}</div>
        <h2>${cause === "missed" ? "Missed the turn" : cause === "fell" ? "Over the edge"
          : cause === "caught" ? "Caught!" : "Wiped out"}</h2>
        ${cause === "missed" ? '<div style="font-size:12.5px;opacity:.7;margin:-2px 0 8px;">Swipe the way the arrow points before you reach the bend.</div>' : ""}
        ${isBest ? '<div class="id-best">NEW BEST</div>' : ""}
        <div class="id-stat"><span>Score</span><b>${fmt(score)}</b></div>
        <div class="id-stat"><span>Distance</span><b>${fmt(dist)} m</b></div>
        <div class="id-stat"><span>Collected</span><b>🪙 ${fmt(runCoins)}${runGems ? "  💎 " + runGems : ""}</b></div>
        ${canRevive ? `
          <div class="id-save">
            <div class="id-ring">
              <svg width="66" height="66"><circle cx="33" cy="33" r="28" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="6"/>
              <circle id="ringArc" cx="33" cy="33" r="28" fill="none" stroke="#8ff0c8" stroke-width="6"
                stroke-linecap="round" stroke-dasharray="175.9" stroke-dashoffset="0"/></svg>
              <div class="t" id="ringNum">5</div>
            </div>
            <p>Keep this run going?</p>
            <button class="id-btn gem" id="btnSave" style="margin-bottom:0;">💎 ${reviveCost}  Second chance</button>
          </div>` : ""}
        <div style="height:6px;"></div>
        <button class="id-btn" id="btnAgain">Run again</button>
        <button class="id-btn ghost" id="btnBoards2">🏆 Leaderboard</button>
        <button class="id-btn ghost" id="btnMenu2" style="margin-bottom:0;">Menu</button>
        <div id="subNote" style="font-size:11.5px;opacity:.6;margin-top:10px;">Saving your score…</div>`;
      el.dead.classList.remove("id-hidden");

      // Bank the run.
      wallet.addCoins(runCoins);
      wallet.addGems(runGems);
      if (isBest) store.set("best_score", score);
      if (dist > bestDist) store.set("best_distance", dist);
      refreshWallet();

      const note = el.deadPanel.querySelector("#subNote");
      let pending = 2, failed = false;
      const done = () => {
        if (--pending > 0) return;
        if (note) note.textContent = failed ? "Couldn't reach the leaderboard." : "✓ Score saved to the leaderboard";
      };
      try {
        ctx.platform.setScore(score);
        ctx.memory.record("score").submit(score, { label: fmt(score) }).then(done).catch(() => { failed = true; done(); });
        ctx.memory.record("distance").submit(dist, { label: fmt(dist) + " m" }).then(done).catch(() => { failed = true; done(); });
      } catch (_) { if (note) note.textContent = ""; }
      try { ctx.platform.fail({ cause, score, distance: dist }); } catch (_) {}

      ctx.listen(el.deadPanel.querySelector("#btnAgain"), "click", () => { sfx.ui(); startRun(); });
      ctx.listen(el.deadPanel.querySelector("#btnBoards2"), "click", () => { sfx.ui(); renderBoards(); el.boards.classList.remove("id-hidden"); });
      ctx.listen(el.deadPanel.querySelector("#btnMenu2"), "click", () => { sfx.ui(); el.dead.classList.add("id-hidden"); quitToMenu(); });

      const saveBtn = el.deadPanel.querySelector("#btnSave");
      saveState.left = 0;
      if (saveBtn) {
        saveState.arc = el.deadPanel.querySelector("#ringArc");
        saveState.num = el.deadPanel.querySelector("#ringNum");
        saveState.btn = saveBtn;
        saveState.left = 5;
        ctx.listen(saveBtn, "click", () => {
          saveState.left = 0;
          const cost = reviveCost;
          if (wallet.gems < cost) return;
          wallet.addGems(-cost);
          refreshWallet();
          revived = true;
          sfx.revive(); haptic("success");
          el.dead.classList.add("id-hidden");
          el.hud.classList.remove("id-hidden");
          el.pauseBtn.classList.remove("id-hidden");
          // Clear the way: wipe hazards nearby and give a shield.
          const seg = track[P.seg];
          if (seg) for (const o of seg.obstacles) if (Math.abs(o.z - P.z) < 34) o.spent = true;
          P.dead = false;
          P.y = 0; P.vy = 0; P.jumping = false; P.sliding = 0;
          P.stumbleCd = 1.6;
          P.speed = SPEED_START;
          P.baseSpeed = Math.max(SPEED_START, P.baseSpeed * 0.82);
          monkeyHeat = 0;
          for (const m of monkeys) m.group.visible = false;
          pw.shield = Math.max(pw.shield, upVal("shield"));
          pwMax.shield = pw.shield;
          runCoins = 0; runGems = 0;   // already banked
          state = "run";
          toast("💎 Second chance!");
        });
      }
    }

    // =====================================================================
    // 15. Frame loop.
    // =====================================================================
    function update(dtMs, timeMs) {
      const dt = Math.min(dtMs, 50) / 1000;
      if (lastW !== ctx.width || lastH !== ctx.height) {
        lastW = ctx.width; lastH = ctx.height; resize();
      }
      const running = state === "run";
      if (running) runTime += dt;

      if (running && !P.dead) {
        // --- speed ramp -------------------------------------------------
        P.baseSpeed = Math.min(SPEED_MAX, SPEED_START + runDistance * 0.0052);
        const want = pw.boost > 0 ? P.baseSpeed * 1.7 : P.baseSpeed;
        P.speed += (want - P.speed) * Math.min(1, dt * (pw.boost > 0 ? 4 : 1.4));

        // --- forward ----------------------------------------------------
        const seg = track[P.seg];
        P.z += P.speed * dt;
        runDistance += P.speed * dt;
        runScore += P.speed * dt * multiplier * (pw.mult > 0 ? 2 : 1);

        // multiplier milestones
        if (runDistance >= nextMultAt) {
          multiplier += 1;
          nextMultAt += 500 + multiplier * 120;
          el.mult.classList.remove("pop"); void el.mult.offsetWidth; el.mult.classList.add("pop");
          sfx.milestone();
          toast("×" + multiplier + " multiplier!");
        }
        // biome rotation
        if (runDistance >= biomeChangeAt) {
          biomeChangeAt += 900;
          biomeIndex = (biomeIndex + 1) % BIOMES.length;
          applyBiomeLook(biome(), false);
          bed(biome().music, 0.26);
          toast("⛩️ " + biome().name);
        }

        // --- corner enforcement -----------------------------------------
        if (seg) {
          if (seg.turn !== 0 && P.z >= seg.len) {
            if (P.armedTurn === seg.turn || pw.boost > 0) {
              takeTurn(seg);                        // boost turns for you
              while (track.length < P.seg + 4) buildSegment(track[track.length - 1], false);
              while (P.seg > 2) { disposeSegment(track.shift()); P.seg -= 1; }
            } else if (P.z > seg.len + 1.4) {
              die("missed");                        // straight past the bend
            }
          } else if (seg.turn === 0 && P.z > seg.len) {
            P.seg += 1; P.z -= seg.len;
            while (track.length < P.seg + 4) buildSegment(track[track.length - 1], false);
            while (P.seg > 2) { disposeSegment(track.shift()); P.seg -= 1; }
          }
          // The arm expires if you drift far from the corner.
          if (seg.turn !== 0 && seg.len - P.z > Math.max(22, P.speed * 1.6)) P.armedTurn = 0;
        }

        // --- lateral ----------------------------------------------------
        const wantX = P.targetLane * LANE_W;
        P.laneX += (wantX - P.laneX) * Math.min(1, dt * 13);
        P.lane = Math.round(P.laneX / LANE_W);
        P.turnBank *= Math.max(0, 1 - dt * 5);

        // --- vertical ---------------------------------------------------
        if (P.jumping) {
          P.vy -= 26 * dt;
          P.y += P.vy * dt;
          if (P.y <= 0) { P.y = 0; P.vy = 0; P.jumping = false; sfx.land(); }
        }
        if (P.sliding > 0) P.sliding = Math.max(0, P.sliding - dt);
        if (P.stumbleCd > 0) P.stumbleCd -= dt;

        // --- powerup timers ---------------------------------------------
        for (const k of ["shield", "magnet", "mult", "boost"]) {
          if (pw[k] > 0) {
            pwMax[k] = Math.max(pwMax[k], pw[k]);
            pw[k] = Math.max(0, pw[k] - dt);
            if (pw[k] === 0) pwMax[k] = 1;
          }
        }
        shieldMesh.visible = pw.shield > 0;
        if (pw.boost > 0 && Math.random() < dt * 6) sfx.boostLoop();

        // Corner prompt: show which way to swipe while the window is open.
        if (seg && seg.turn !== 0 && !P.armedTurn) {
          const toEnd2 = seg.len - P.z;
          const win2 = Math.max(20, P.speed * 1.5);
          if (toEnd2 > 0 && toEnd2 < win2) {
            el.turnArrow.textContent = seg.turn > 0 ? "➡" : "⬅";
            el.turn.classList.add("show");
          } else el.turn.classList.remove("show");
        } else el.turn.classList.remove("show");

        collide(dt);

        // --- guardians --------------------------------------------------
        monkeyHeat = Math.max(0, monkeyHeat - dt * 0.075);

        // --- footsteps ---------------------------------------------------
        stepPhase += dt * (P.speed / 3.1);
        if (stepPhase >= 1) { stepPhase -= 1; if (P.y <= 0.05 && P.sliding <= 0) footstep(P.speed > 26); }

        updateHud();
        renderPowerHud();
        try { ctx.platform.setScore(Math.floor(runScore)); } catch (_) {}
      }

      // ---- place the runner in world space ------------------------------
      const seg = track[P.seg];
      if (seg) {
        const d = HEAD_DIR[seg.head];
        const rx = -d.z, rz = d.x;
        const wx = seg.ox + d.x * P.z + rx * P.laneX;
        const wz = seg.oz + d.z * P.z + rz * P.laneX;
        runner.position.set(wx, P.y, wz);
        runner.rotation.y = headYaw(seg.head) + P.turnBank * 0.28;

        // pose
        const slide = P.sliding > 0;
        body.torso.scale.set(0.62, slide ? 0.38 : 0.72, slide ? 0.7 : 0.38);
        body.torso.position.y = slide ? 0.42 : 1.06;
        body.head.position.y = slide ? 0.62 : 1.58;
        body.hat.position.y = slide ? 0.74 : 1.74;
        body.hat.visible = !slide;
        body.idol.position.set(0.42, slide ? 0.42 : 1.0, 0.2);
        const gait = runTime * (P.speed / 2.3);
        const sw = P.jumping ? 0.5 : Math.sin(gait) * 0.75;
        body.legL.rotation.x = slide ? -1.2 : sw;
        body.legR.rotation.x = slide ? -1.0 : -sw;
        body.armL.rotation.x = slide ? -2.2 : -sw * 0.9;
        body.armR.rotation.x = slide ? -2.0 : sw * 0.9;
        body.legL.position.y = slide ? 0.22 : 0.36;
        body.legR.position.y = slide ? 0.22 : 0.36;
        shieldMesh.position.y = slide ? 0.5 : 1.05;

        // Shadow sits on the deck under the runner, shrinking with height.
        const hs = clamp(1 - P.y / 4.2, 0.35, 1);
        shadow.position.set(wx, 0.03, wz);
        shadow.scale.set(hs, hs, hs);
        shadow.material.opacity = 0.38 * hs;
        shadow.visible = state === "run" || state === "paused" || state === "dying";

        // ---- camera --------------------------------------------------
        let dy = camYawTarget - camYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        camYaw += dy * Math.min(1, dt * 7);
        const back = 9.6 + (pw.boost > 0 ? 2.2 : 0);
        const cd = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
        camShake = Math.max(0, camShake - dt * 2.2);
        const sh = camShake * 0.25;
        camera.position.set(
          wx + cd.x * back + rnd(-sh, sh),
          P.y * 0.5 + 5.9 + rnd(-sh, sh),
          wz + cd.z * back + rnd(-sh, sh)
        );
        camera.rotation.set(-0.315, camYaw, P.turnBank * 0.05);

        // ---- guardians follow ----------------------------------------
        const showMonkeys = monkeyHeat > 0.02;
        for (let i = 0; i < monkeys.length; i++) {
          const mk = monkeys[i];
          mk.group.visible = showMonkeys;
          if (!showMonkeys) continue;
          const lag = lerp(16, 3.4, clamp(monkeyHeat, 0, 1));
          const bob = Math.abs(Math.sin(runTime * 9 + mk.ph)) * 0.32;
          mk.group.position.set(
            wx + cd.x * lag + (-cd.z) * mk.off,
            bob,
            wz + cd.z * lag + cd.x * mk.off
          );
          mk.group.rotation.y = camYaw + Math.PI;
        }
      }

      // ---- animated scenery -------------------------------------------
      const tsec = timeMs * 0.001;
      for (let si = 0; si < track.length; si++) {
        const s2 = track[si];
        if (s2.arrowMeshes) {
          for (const am of s2.arrowMeshes) {
            if (am.userData.pulse !== undefined) {
              const k = 0.55 + 0.45 * Math.sin(tsec * 5 - am.userData.pulse * 2);
              am.material = k > 0.75 ? basicMat("arrow", 0xffe14a) : basicMat("arrowdim", 0xb8892a);
            } else if (am.userData.torch !== undefined) {
              const f = 0.85 + Math.sin(tsec * 12 + am.userData.torch) * 0.16;
              am.scale.set(0.42 * f, 0.62 * f, 0.42 * f);
            }
          }
        }
        for (const o of s2.obstacles) {
          if (o.bladeMesh) for (const bm of o.bladeMesh) bm.rotation.z += dt * 4.5;
          if (o.flameMesh) {
            const on = Math.sin(tsec * 2.2 + o.phase) > -0.15;
            for (const fm of o.flameMesh) {
              fm.visible = on;
              const s3 = 0.8 + Math.sin(tsec * 15 + o.phase) * 0.18;
              fm.scale.set(0.85, 2.4 * s3, 0.85);
            }
          }
        }
        for (const p of s2.pickups) {
          if (p.taken || !p.mesh) continue;
          if (p.type === "coin") p.mesh.rotation.y += dt * 4;
          else p.mesh.rotation.y += dt * 2.2;
        }
      }

      renderer.render(scene, camera);
    }

    ctx.onFrame(update);

    // Test hooks (harness only; harmless in production).
    if (typeof window !== "undefined") {
      window.__idolDebug = () => {
        const seg = track[P.seg];
        return seg ? {
          seg: P.seg, z: Math.round(P.z), toEnd: Math.round(seg.len - P.z),
          turn: seg.turn, armed: P.armedTurn, lane: P.lane, speed: Math.round(P.speed),
          dist: Math.round(runDistance), score: Math.round(runScore),
          heat: Math.round(monkeyHeat * 100) / 100, state
        } : null;
      };
      window.__idolKill = () => { if (state === "run") die("test"); };
      window.__idolNext = () => {
        const seg = track[P.seg];
        if (!seg) return null;
        let best = null;
        for (const o of seg.obstacles) {
          if (o.spent) continue;
          const dz = o.z - P.z;
          if (dz < 1 || dz > 26) continue;
          if (!best || dz < best.dz) best = { kind: o.kind, dz, lanes: o.lanes.slice() };
        }
        return best;
      };
    }

    showMenu();

    ctx.onDestroy(() => {
      saveState.left = 0;
      for (const s of track) disposeSegment(s);
      try { if (canMusic && ctx.music && musicOn) ctx.music.stop({ fadeOutMs: 200 }); } catch (_) {}
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
      try { renderer.dispose(); } catch (_) {}
      if (AC) { try { AC.close(); } catch (_) {} }
    });
  }
};
