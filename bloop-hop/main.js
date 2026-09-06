/*
 * Bloop's Big Hop
 * A chunky 3D side-scrolling platformer. Run, hop, stomp, bonk blocks from
 * below, ride moving platforms and reach the flag, through four worlds of
 * three levels each: Meadow, Dunes, Deep Cavern and Sky Keep. Every level
 * is built from hand-designed chunks tuned by a difficulty number, so the
 * gaps get wider, the enemies thicker and the platforms faster as you go.
 * Three stars per level, lives, checkpoints, power-ups, a boss at the end
 * of each world, and a leaderboard for score and stars.
 *
 * Runtime:  plethora-bit@2  (window.plethoraBit)
 * Renderer: three@0.164.1 (ES module via ctx.importModule)
 * Audio:    ctx.music beds + procedurally synthesized WebAudio SFX
 */

window.plethoraBit = {
  meta: {
    title: "Bloop's Big Hop",
    runtime: "plethora-bit@2",
    tags: ["3d", "platformer", "arcade", "levels", "retro", "mobile"],
    permissions: ["haptics", "backgroundMusic", "audio", "storage"]
  },

  async init(ctx) {
    "use strict";

    // =====================================================================
    // 1. Surfaces + UI shell.
    // =====================================================================
    const canvas = ctx.createCanvas({ touchAction: "none" });
    canvas.style.width = "100%"; canvas.style.height = "100%"; canvas.style.display = "block";
    const root = ctx.createRoot({ touchAction: "none" });
    root.style.pointerEvents = "none";
    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    const style = document.createElement("style");
    style.textContent = `
      .bh-ui { position:absolute; inset:0; overflow:hidden; color:#fff;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
        -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
      .bh-ui * { box-sizing:border-box; }
      .bh-hidden { display:none !important; }
      .bh-vign { position:absolute; inset:0; pointer-events:none; background:radial-gradient(120% 100% at 50% 45%, rgba(0,0,0,0) 60%, rgba(10,20,40,.3) 100%); }

      /* HUD */
      .bh-hud { position:absolute; inset:0; pointer-events:none; z-index:20; }
      .bh-top { position:absolute; left:0; right:0; top:calc(${sa.top}px + 8px); display:flex; justify-content:space-between; align-items:flex-start; padding:0 12px; gap:8px; }
      .bh-chip { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:999px; font-size:12.5px; font-weight:900; font-variant-numeric:tabular-nums; color:#fff;
        background:rgba(255,255,255,.22); border:1px solid rgba(255,255,255,.45); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); text-shadow:0 1px 3px rgba(20,40,80,.5); }
      .bh-chip em { font-style:normal; opacity:.75; font-size:11px; }
      .bh-chip small { font-size:8px; letter-spacing:1.5px; opacity:.8; margin-right:3px; }
      .bh-prog { position:relative; width:120px; height:5px; margin:8px auto 0; border-radius:3px; background:rgba(255,255,255,.4); }
      .bh-prog i { position:absolute; left:0; top:0; bottom:0; width:0; border-radius:3px; background:#fff; }
      .bh-prog b { position:absolute; right:-9px; top:-11px; font-size:12px; }
      .bh-col { display:flex; flex-direction:column; gap:5px; align-items:flex-start; }
      .bh-col.r { align-items:flex-end; }
      .bh-score { position:absolute; left:50%; top:calc(${sa.top}px + 6px); transform:translateX(-50%); text-align:center; }
      .bh-score > b { display:block; font-size:14px; font-weight:900; line-height:1; letter-spacing:2.5px; text-shadow:0 1px 4px rgba(20,40,80,.6); }
      .bh-score small { display:block; font-size:9px; font-weight:800; letter-spacing:2px; opacity:.85; margin-top:3px; text-shadow:0 1px 4px rgba(20,40,80,.6); }
      .bh-time.low { color:#ff6b6b; animation:bhBlink .5s steps(2) infinite; }
      @keyframes bhBlink { 50% { opacity:.4; } }
      .bh-pause { position:absolute; right:calc(${sa.right}px + 12px); top:calc(${sa.top}px + 96px); pointer-events:auto; width:40px; height:40px; border-radius:50%; cursor:pointer;
        border:1px solid rgba(255,255,255,.5); background:rgba(10,20,40,.55); color:#fff; font-size:15px; display:flex; align-items:center; justify-content:center; }

      /* controls */
      .bh-ctl { position:absolute; inset:0; pointer-events:none; z-index:18; }
      .bh-pad { position:absolute; left:calc(${sa.left}px + 18px); bottom:calc(${sa.bottom}px + 34px); width:150px; height:64px; border-radius:32px; display:flex; overflow:hidden;
        background:rgba(10,20,40,.35); border:1.5px solid rgba(255,255,255,.35); backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
      .bh-pad i { flex:1; display:flex; align-items:center; justify-content:center; font-size:22px; font-style:normal; color:rgba(255,255,255,.75); transition:background .08s; }
      .bh-pad i.on { background:rgba(255,255,255,.28); color:#fff; }
      .bh-jump { position:absolute; right:calc(${sa.right}px + 20px); bottom:calc(${sa.bottom}px + 30px); width:84px; height:84px; border-radius:50%; display:flex; align-items:center; justify-content:center;
        background:radial-gradient(circle at 35% 30%, rgba(255,255,255,.55), rgba(255,255,255,.15) 70%); border:2px solid rgba(255,255,255,.55); font-size:13px; font-weight:900; letter-spacing:1px; color:#fff;
        text-shadow:0 1px 4px rgba(0,0,0,.5); transition:transform .08s; }
      .bh-jump.on { transform:scale(.92); background:radial-gradient(circle at 35% 30%, rgba(255,230,120,.8), rgba(255,180,40,.35) 70%); }
      .bh-hint { position:absolute; left:50%; bottom:calc(${sa.bottom}px + 196px); transform:translateX(-50%); z-index:21; pointer-events:none; padding:8px 16px; border-radius:999px;
        background:rgba(10,20,40,.6); border:1px solid rgba(255,255,255,.3); font-size:13px; font-weight:800; opacity:0; transition:opacity .4s; white-space:nowrap; }
      .bh-hint.show { opacity:1; }
      .bh-coach { position:absolute; z-index:22; pointer-events:none; padding:7px 12px; border-radius:12px; background:#ffe066; color:#3a2000; font-size:13px; font-weight:900; white-space:nowrap;
        box-shadow:0 4px 12px rgba(0,0,0,.3); opacity:0; transition:opacity .3s; animation:bhCoach 1s ease-in-out infinite; }
      .bh-coach.show { opacity:1; }
      .bh-coach:after { content:""; position:absolute; left:50%; bottom:-7px; margin-left:-7px; border-left:7px solid transparent; border-right:7px solid transparent; border-top:8px solid #ffe066; }
      .bh-coach.run { left:calc(${sa.left}px + 93px); bottom:calc(${sa.bottom}px + 112px); transform:translateX(-50%); }
      .bh-coach.jump { right:calc(${sa.right}px + 20px); bottom:calc(${sa.bottom}px + 126px); }
      @keyframes bhCoach { 0%,100% { margin-bottom:0; } 50% { margin-bottom:6px; } }

      .bh-toast { position:absolute; left:50%; top:26%; transform:translate(-50%,-50%) scale(.9); z-index:32; padding:8px 18px; border-radius:999px; font-size:15px; font-weight:900; white-space:nowrap;
        background:rgba(10,20,40,.7); border:1px solid rgba(255,255,255,.3); opacity:0; transition:opacity .2s, transform .2s; pointer-events:none; }
      .bh-toast.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
      .bh-big { position:absolute; left:50%; top:34%; transform:translate(-50%,-50%) scale(.6); z-index:33; text-align:center; font-size:30px; font-weight:900; font-style:italic; color:#ffe066;
        white-space:normal; max-width:92vw; line-height:1.1; pointer-events:none; opacity:0; text-shadow:0 3px 0 #b8541a, 0 8px 22px rgba(0,0,0,.5); transition:opacity .25s, transform .3s cubic-bezier(.2,1.6,.4,1); }
      .bh-big.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
      .bh-big small { display:block; font-size:13px; letter-spacing:3px; font-style:normal; color:#fff; margin-top:4px; }
      .bh-flash { position:absolute; inset:0; pointer-events:none; opacity:0; z-index:19; transition:opacity .45s; }
      .bh-flash.on { opacity:1; transition:opacity .05s; }
      .bh-flash.hurt { background:radial-gradient(110% 90% at 50% 50%, rgba(220,40,40,0) 45%, rgba(220,40,40,.55) 100%); }
      .bh-flash.good { background:radial-gradient(110% 90% at 50% 50%, rgba(255,230,120,0) 55%, rgba(255,230,120,.45) 100%); }
      .bh-fade { position:absolute; inset:0; background:#0b1530; opacity:0; pointer-events:none; z-index:45; transition:opacity .45s; }
      .bh-fade.on { opacity:1; }
      .bh-conf { position:absolute; inset:0; pointer-events:none; z-index:34; overflow:hidden; }
      .bh-conf i { position:absolute; top:-12px; width:8px; height:12px; border-radius:2px; animation:bhFall 1.6s linear forwards; }
      @keyframes bhFall { 0% { transform:translateY(0) rotate(0); opacity:1; } 100% { transform:translateY(105vh) rotate(720deg); opacity:.2; } }

      /* menu + level select */
      .bh-menu { position:absolute; inset:0; z-index:35; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:auto; text-align:center;
        padding:calc(${sa.top}px + 20px) 20px calc(${sa.bottom}px + 20px);
        background:radial-gradient(90% 60% at 50% 15%, rgba(255,230,120,.28), rgba(10,20,40,0) 60%), linear-gradient(180deg, rgba(10,20,40,.15), rgba(10,20,40,.7)); }
      .bh-logo { font-size:42px; font-weight:900; font-style:italic; color:#ffe066; line-height:1; text-shadow:0 3px 0 #b8541a, 0 6px 0 #7a3410, 0 14px 30px rgba(0,0,0,.5); }
      .bh-logo-sub { font-size:11.5px; font-weight:800; letter-spacing:5px; margin-top:10px; opacity:.9; }
      .bh-hero { font-size:70px; line-height:1; margin-bottom:8px; filter:drop-shadow(0 10px 18px rgba(0,0,0,.4)); animation:bhBob 1.6s ease-in-out infinite; }
      @keyframes bhBob { 0%,100% { transform:translateY(0) scaleX(1); } 30% { transform:translateY(-16px) scaleY(1.08); } 60% { transform:translateY(0) scaleX(1.06) scaleY(.94); } }
      .bh-btn { pointer-events:auto; display:block; width:min(280px,78vw); margin:0 auto 10px; padding:13px 18px; border-radius:16px; border:none; cursor:pointer; font-size:16px; font-weight:900; color:#fff;
        background:linear-gradient(180deg,#ff9f43,#e8632a); box-shadow:0 5px 0 #9a3c12, 0 10px 22px rgba(0,0,0,.35); transition:transform .08s, box-shadow .08s; }
      .bh-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #9a3c12; }
      .bh-btn.ghost { background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.35); box-shadow:0 4px 0 rgba(0,0,0,.2); }
      .bh-btn.green { background:linear-gradient(180deg,#8ef07a,#3cb44a); color:#0c2a10; box-shadow:0 5px 0 #23782f, 0 10px 22px rgba(0,0,0,.35); }
      .bh-btn.blue { background:linear-gradient(180deg,#5cc2ff,#2a8fe6); box-shadow:0 5px 0 #1a63a8, 0 10px 22px rgba(0,0,0,.35); }
      .bh-btn:disabled { opacity:.5; }
      .bh-bestline { font-size:12px; font-weight:800; letter-spacing:1.5px; opacity:.9; margin:14px 0 18px; }
      .bh-bestline b { color:#ffe066; font-size:15px; }

      .bh-ov { position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center; padding:16px; pointer-events:auto; text-align:center;
        background:radial-gradient(120% 90% at 50% 35%, rgba(60,90,160,.45), rgba(10,20,40,.86)); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); }
      .bh-panel { width:100%; max-width:400px; max-height:86vh; overflow-y:auto; padding:18px 14px 14px; border-radius:22px; color:#22304a;
        background:linear-gradient(180deg, #fffdf5, #f1efe4); border:1px solid rgba(255,255,255,.9); box-shadow:0 20px 60px rgba(0,10,20,.55); }
      .bh-panel h2 { margin:0 0 4px; font-size:24px; font-weight:900; color:#1c3a7a; }
      .bh-panel .sub { font-size:12px; opacity:.7; margin-bottom:10px; }
      .bh-panel .big { font-size:52px; line-height:1; margin-bottom:6px; }
      .bh-stat { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 12px; border-radius:12px; background:rgba(28,58,122,.08); margin-bottom:6px; font-size:13.5px; font-weight:700; }
      .bh-stat b { font-size:17px; font-weight:900; color:#1c3a7a; font-variant-numeric:tabular-nums; }
      .bh-stars { font-size:34px; letter-spacing:4px; margin:6px 0 10px; }
      .bh-stars i { font-style:normal; opacity:.25; }
      .bh-stars i.on { opacity:1; filter:drop-shadow(0 2px 6px rgba(255,180,0,.6)); animation:bhPop .5s cubic-bezier(.2,1.6,.4,1) both; }
      @keyframes bhPop { 0% { transform:scale(0); } 100% { transform:scale(1); } }
      .bh-starline { font-size:11px; opacity:.75; margin-bottom:10px; line-height:1.6; }

      .bh-worlds { display:flex; flex-direction:column; gap:10px; margin:6px 0 12px; }
      .bh-world { border-radius:16px; padding:10px 10px 8px; text-align:left; color:#fff; }
      .bh-world h3 { margin:0 0 6px; font-size:14px; font-weight:900; letter-spacing:.5px; display:flex; justify-content:space-between; }
      .bh-world h3 span { font-weight:800; opacity:.85; font-size:12px; }
      .bh-lv { display:flex; gap:8px; }
      .bh-lvbtn { flex:1; border:none; border-radius:12px; padding:9px 4px 7px; cursor:pointer; color:#fff; background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.35); display:flex; flex-direction:column; align-items:center; gap:2px; }
      .bh-lvbtn b { font-size:15px; font-weight:900; }
      .bh-lvbtn small { font-size:10px; letter-spacing:1px; }
      .bh-lvbtn.lock { opacity:.45; }
      .bh-lvbtn.next { background:linear-gradient(180deg,#ffe066,#ffb020); color:#3a2000; border-color:transparent; box-shadow:0 3px 0 rgba(0,0,0,.25); }
      .bh-lvbtn:active { transform:translateY(2px); }

      .bh-fatal { position:absolute; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:26px; text-align:center; background:#0b1530; color:#fff; pointer-events:auto; }
      .bh-lives { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:44; text-align:center; pointer-events:none; }
      .bh-lives .n { font-size:26px; font-weight:900; letter-spacing:1px; text-shadow:0 3px 0 rgba(0,0,0,.4); }
      .bh-lives .l { font-size:44px; margin-top:6px; }
    `;
    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "bh-ui";
    ui.innerHTML = `
      <div class="bh-vign"></div>
      <div class="bh-hud bh-hidden" id="hud">
        <div class="bh-top">
          <div class="bh-col"><span class="bh-chip">🟢 × <i id="hLives">3</i></span><span class="bh-chip">🪙 <i id="hCoins">0</i><em>/<i id="hCoinsMax">0</i></em></span><span class="bh-chip" id="hStars">★☆☆</span></div>
          <div class="bh-score"><b id="hLevel">WORLD 1-1</b><small id="hLevelSub">MEADOW</small><div class="bh-prog"><i id="hProg"></i><b>🏁</b></div></div>
          <div class="bh-col r"><span class="bh-chip"><small>SCORE</small><i id="hScore">0</i></span><span class="bh-chip bh-time" id="hTime"><small>TIME</small><i id="hTimeV">300</i></span><span class="bh-chip" id="hPower">🔵 small</span></div>
        </div>
        <button class="bh-pause" id="btnPause" style="pointer-events:auto;">⏸</button>
      </div>
      <div class="bh-ctl bh-hidden" id="ctl">
        <div class="bh-pad" id="pad"><i id="padL">◀</i><i id="padR">▶</i></div>
        <div class="bh-jump" id="jumpBtn">JUMP</div>
        <div class="bh-hint" id="hint">◀ ▶ run · tap JUMP to hop · hold to jump higher</div>
        <div class="bh-coach run" id="coachRun">Touch ▶ to run</div>
        <div class="bh-coach jump" id="coachJump">Tap to hop · hold to jump high</div>
      </div>
      <div class="bh-toast" id="toast"></div>
      <div class="bh-big" id="bigText"></div>
      <div class="bh-conf" id="conf"></div>
      <div class="bh-flash hurt" id="flashHurt"></div>
      <div class="bh-flash good" id="flashGood"></div>
      <div class="bh-fade" id="fade"><div class="bh-lives bh-hidden" id="livesCard"><div class="n" id="livesText">WORLD 1-1</div><div class="l" id="livesIcon">🟢 × 3</div></div></div>

      <div class="bh-menu" id="menu">
        <div class="bh-hero">🟢</div>
        <div class="bh-logo">BLOOP'S BIG HOP</div>
        <div class="bh-logo-sub">RUN · HOP · STOMP</div>
        <div class="bh-bestline">BEST <b id="mBest">0</b> · STARS <b id="mStars">0</b>/36</div>
        <button class="bh-btn" id="btnPlay">▶  Play</button>
        <button class="bh-btn ghost" id="btnLevels">🗺️  Levels</button>
        <button class="bh-btn ghost" id="btnHow">?  How to play</button>
        <button class="bh-btn ghost" id="btnMute" style="width:auto;padding:9px 16px;font-size:13px;">🔊 Sound</button>
      </div>

      <div class="bh-ov bh-hidden" id="ovLevels"><div class="bh-panel"><h2>Levels</h2><div class="sub" id="lvSub"></div><div class="bh-worlds" id="worlds"></div><button class="bh-btn ghost" id="btnLevelsClose" style="margin:0;color:#1c3a7a;border-color:rgba(28,58,122,.3);">Close</button></div></div>
      <div class="bh-ov bh-hidden" id="ovHow"><div class="bh-panel">
        <h2>How to hop</h2>
        <div style="text-align:left;font-size:13.5px;line-height:1.85;margin:8px 0 14px;">
          ◀ ▶ <b>Run</b>: touch the left or right half of the pad. Slide across it to turn.<br>
          🟡 <b>JUMP</b> on the right. Tap for a hop of about one block; hold it to jump nearly four.<br>
          👟 <b>Stomp</b> enemies from above. Bounce off them to go higher.<br>
          🧱 <b>Bonk</b> ? blocks from below for coins and power-ups. Big Bloop breaks bricks.<br>
          🍓 <b>Berry</b> makes you big (one free hit). ⭐ <b>Star</b> makes you invincible. 💖 is an extra life.<br>
          🚩 A <b>checkpoint</b> flag saves your spot. 🏁 Reach the <b>goal</b> flag — higher on the pole is more points.<br>
          ⏱ Beat the clock. ⭐ Stars: clear the level, collect 70% of coins, beat par time.<br>
          🐢 Stomp a Roller to make a shell; kick it into others.
        </div>
        <button class="bh-btn" id="btnHowOk" style="margin:0;">Got it</button></div></div>
      <div class="bh-ov bh-hidden" id="ovPause"><div class="bh-panel"><h2>Paused</h2><div style="height:8px;"></div>
        <button class="bh-btn green" id="btnResume">Resume</button><button class="bh-btn ghost" id="btnRestart" style="color:#1c3a7a;border-color:rgba(28,58,122,.3);">Restart level</button>
        <button class="bh-btn ghost" id="btnMute2" style="color:#1c3a7a;border-color:rgba(28,58,122,.3);">🔊 Sound</button>
        <button class="bh-btn ghost" id="btnQuit" style="margin:0;color:#1c3a7a;border-color:rgba(28,58,122,.3);">Quit to menu</button></div></div>
      <div class="bh-ov bh-hidden" id="ovClear"><div class="bh-panel" id="clearPanel"></div></div>
      <div class="bh-ov bh-hidden" id="ovOver"><div class="bh-panel" id="overPanel"></div></div>
    `;
    root.appendChild(ui);
    const $ = (id) => ui.querySelector("#" + id);
    const el = {
      hud: $("hud"), hCoins: $("hCoins"), hCoinsMax: $("hCoinsMax"), hLives: $("hLives"), hScore: $("hScore"), hLevel: $("hLevel"), hLevelSub: $("hLevelSub"), hProg: $("hProg"), hStars: $("hStars"), hTime: $("hTime"), hTimeV: $("hTimeV"), hPower: $("hPower"),
      ctl: $("ctl"), pad: $("pad"), padL: $("padL"), padR: $("padR"), jumpBtn: $("jumpBtn"), hint: $("hint"), coachRun: $("coachRun"), coachJump: $("coachJump"),
      toast: $("toast"), big: $("bigText"), conf: $("conf"), flashHurt: $("flashHurt"), flashGood: $("flashGood"), fade: $("fade"), livesCard: $("livesCard"), livesText: $("livesText"), livesIcon: $("livesIcon"),
      menu: $("menu"), mBest: $("mBest"), mStars: $("mStars"), ovLevels: $("ovLevels"), worlds: $("worlds"), lvSub: $("lvSub"), how: $("ovHow"), pause: $("ovPause"),
      clear: $("ovClear"), clearPanel: $("clearPanel"), over: $("ovOver"), overPanel: $("overPanel"), btnMute: $("btnMute"), btnMute2: $("btnMute2")
    };

    // =====================================================================
    // 2. Utilities, save, worlds.
    // =====================================================================
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const fmt = (n) => Math.floor(n).toLocaleString("en-US");
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    function seeded(seed) { let s = (seed >>> 0) || 7; return () => { s = (s * 16807) % 2147483647; return (s & 0xffff) / 0xffff; }; }

    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const memStore = {};
    const store = {
      get(k, d) { try { const v = canStore ? ctx.storage.get("bh_" + k) : memStore[k]; return v == null ? d : v; } catch (_) { return d; } },
      set(k, v) { try { if (canStore) ctx.storage.set("bh_" + k, v); else memStore[k] = v; } catch (_) {} }
    };
    const WORLDS = [
      { id: 0, name: "Meadow", icon: "🌿", music: "chiptune", sky: [0x7fc8ff, 0xc4e6ff, 0xf6fbff], fog: 0xdcefff, ground: 0xd9a76a, dirtDark: 0xc48f52, grass: 0x6fd35f, grassDark: 0x4fae48, brick: 0xe07a4a, hills: 0xa9e39a, far: 0xc9efbf, accent: 0xff9f43, tree: 0x62c95a, card: "linear-gradient(135deg,#3cb44a,#1f8a3a)" },
      { id: 1, name: "Dunes", icon: "🏜️", music: "arcade", sky: [0xffc07a, 0xffe2b8, 0xfff6e8], fog: 0xf9e2c0, ground: 0xe0b070, dirtDark: 0xc99a58, grass: 0xf3d58a, grassDark: 0xd8b060, brick: 0xd08a52, hills: 0xf1cf94, far: 0xf6dcb0, accent: 0xff6b3d, tree: 0x8fd08a, card: "linear-gradient(135deg,#e8a33c,#b8641a)" },
      { id: 2, name: "Deep Cavern", icon: "🕯️", music: "spooky", sky: [0x1a2148, 0x2e3a6e, 0x4a5a8a], fog: 0x33406e, ground: 0x6a6a8a, dirtDark: 0x565676, grass: 0x8f8fb0, grassDark: 0x70709a, brick: 0x7a6f90, hills: 0x3d4a7a, far: 0x2a3560, accent: 0xb57bff, tree: 0x6aa0c0, card: "linear-gradient(135deg,#4a4a8a,#22224a)" },
      { id: 3, name: "Sky Keep", icon: "🏰", music: "synthwave", sky: [0x5a7fd8, 0xa9c4f5, 0xeef4ff], fog: 0xc9dbf8, ground: 0x9a9ab0, dirtDark: 0x80809a, grass: 0xc4c8dc, grassDark: 0xa0a6c0, brick: 0xc05a5a, hills: 0xffffff, far: 0xdfe8ff, accent: 0xff4a6a, tree: 0x8fd0a8, card: "linear-gradient(135deg,#5a6fd8,#2a3a8a)" }
    ];
    const LEVELS_PER_WORLD = 3, N_LEVELS = WORLDS.length * LEVELS_PER_WORLD;
    function levelWorld(i) { return WORLDS[(i / LEVELS_PER_WORLD) | 0]; }
    function levelName(i) { return "WORLD " + (((i / LEVELS_PER_WORLD) | 0) + 1) + "-" + ((i % LEVELS_PER_WORLD) + 1); }
    function isBossLevel(i) { return i % LEVELS_PER_WORLD === LEVELS_PER_WORLD - 1; }
    // difficulty 0..1 across the campaign, nudged so the first level of a world eases off a little
    function difficultyOf(i) { const base = i / (N_LEVELS - 1); const inWorld = i % LEVELS_PER_WORLD; return clamp(base - (inWorld === 0 ? 0.05 : 0) + (inWorld === LEVELS_PER_WORLD - 1 ? 0.04 : 0), 0, 1); }

    const DEFAULT_SAVE = () => ({ v: 1, unlocked: 0, stars: new Array(N_LEVELS).fill(0), best: new Array(N_LEVELS).fill(0), bestScore: 0, totalStars: 0, muted: false, hint: 0, seed: (Math.random() * 1e9) | 0 });
    let S = DEFAULT_SAVE();
    (function loadSave() {
      const s = store.get("save", null);
      if (s && typeof s === "object") { for (const k in s) if (k in S) S[k] = s[k]; }
      if (!Array.isArray(S.stars) || S.stars.length !== N_LEVELS) S.stars = new Array(N_LEVELS).fill(0);
      if (!Array.isArray(S.best) || S.best.length !== N_LEVELS) S.best = new Array(N_LEVELS).fill(0);
      S.totalStars = S.stars.reduce((a, b) => a + b, 0);
    })();
    let saveTok = 0;
    function save() { saveTok += 1; const tok = saveTok; ctx.timeout(() => { if (tok === saveTok) store.set("save", S); }, 100); }

    // =====================================================================
    // 3. Audio — chip-style synth SFX plus a ctx.music bed.
    // =====================================================================
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!S.muted;
    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      try { AC = new C(); master = AC.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(AC.destination); } catch (_) { AC = null; master = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }
    function tone(freq, delay, dur, type, peak, glide) {
      ensureAC(); resumeAC(); if (!AC || muted) return;
      try {
        const o = AC.createOscillator(), g = AC.createGain(); o.type = type || "square";
        const t = AC.currentTime + (delay || 0);
        o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur * 0.9);
        o.connect(g); g.connect(master);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak || 0.12, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
        o.start(t); o.stop(t + dur + 0.04);
      } catch (_) {}
    }
    function noise(dur, cutoff, peak, type, delay) {
      ensureAC(); resumeAC(); if (!AC || muted) return;
      try {
        const n = Math.max(1, (AC.sampleRate * dur) | 0), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = AC.createBufferSource(); src.buffer = buf;
        const f = AC.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = cutoff || 1200; f.Q.value = 0.8;
        const g = AC.createGain(); g.gain.value = peak || 0.2; src.connect(f); f.connect(g); g.connect(master);
        const t = AC.currentTime + (delay || 0); src.start(t); src.stop(t + dur + 0.02);
      } catch (_) {}
    }
    function fbSting(name) { if (AC || muted || !canMusic || !ctx.music || !ctx.music.sting) return; try { ctx.music.sting(name); } catch (_) {} }
    let coinPitch = 0;
    const sfx = {
      ui() { tone(660, 0, 0.06, "square", 0.08); if (!AC) fbSting("tap"); },
      jump(big) { tone(big ? 300 : 380, 0, 0.16, "square", 0.09, big ? 720 : 900); },
      land() { noise(0.06, 500, 0.08, "lowpass"); },
      coin() { if (!AC) { fbSting("coin"); return; } coinPitch = Math.min(coinPitch + 1, 10); tone(988 + coinPitch * 30, 0, 0.07, "square", 0.08); tone(1319 + coinPitch * 30, 0.06, 0.16, "square", 0.08); },
      stomp() { noise(0.09, 900, 0.16, "lowpass"); tone(220, 0, 0.1, "square", 0.08, 90); },
      bump() { tone(180, 0, 0.09, "square", 0.1, 120); noise(0.05, 600, 0.08, "lowpass"); },
      brick() { noise(0.18, 1400, 0.2); tone(150, 0, 0.12, "square", 0.08, 70); },
      powerup() { if (!AC) { fbSting("powerup"); return; } [523, 659, 784, 1046, 1319, 1568].forEach((f, i) => tone(f, i * 0.05, 0.14, "square", 0.08)); },
      grow() { [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.06, 0.12, "square", 0.09)); },
      star() { if (!AC) { fbSting("powerup"); return; } [784, 988, 1175, 1568, 1975].forEach((f, i) => tone(f, i * 0.05, 0.2, "triangle", 0.1)); },
      hurt() { if (!AC) { fbSting("fail"); return; } tone(440, 0, 0.18, "sawtooth", 0.1, 160); noise(0.15, 500, 0.12, "lowpass"); },
      die() { if (!AC) { fbSting("lose"); return; } [659, 587, 523, 440, 392, 330, 262].forEach((f, i) => tone(f, i * 0.11, 0.2, "square", 0.09)); },
      oneUp() { if (!AC) { fbSting("win"); return; } [659, 784, 1319, 1047, 1175, 1568].forEach((f, i) => tone(f, i * 0.08, 0.16, "square", 0.09)); },
      kick() { noise(0.08, 1200, 0.16); tone(300, 0, 0.08, "square", 0.08, 150); },
      spring() { tone(220, 0, 0.22, "square", 0.1, 880); },
      checkpoint() { [523, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.2, "square", 0.08)); },
      flag() { if (!AC) { fbSting("success"); return; } [523, 523, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09 + (i > 2 ? 0.1 : 0), 0.22, "square", 0.09)); },
      clear() { if (!AC) { fbSting("win"); return; } [392, 523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => tone(f, i * 0.09, 0.3, "square", 0.08)); },
      boss() { tone(110, 0, 0.35, "sawtooth", 0.12, 55); noise(0.3, 300, 0.2, "lowpass"); },
      tick() { tone(1200, 0, 0.04, "square", 0.05); }
    };
    let musicOn = false;
    function bed(preset, volume) {
      if (!canMusic || !ctx.music) return;
      try {
        if (muted) { if (musicOn) { ctx.music.pause(); musicOn = false; } return; }
        const st = ctx.music.state && ctx.music.state();
        if (!musicOn && st === "paused") { ctx.music.resume(); ctx.music.setPreset(preset, { fadeMs: 500 }); ctx.music.setVolume(volume, { fadeMs: 500 }); musicOn = true; }
        else if (!musicOn || st === "stopped") { ctx.music.unlock(); ctx.music.play({ preset, volume, fadeInMs: 600, tempo: 132 }); musicOn = true; }
        else { ctx.music.setPreset(preset, { fadeMs: 500 }); ctx.music.setVolume(volume, { fadeMs: 500 }); }
      } catch (_) {}
    }
    function applyMute() {
      el.btnMute.textContent = muted ? "🔇 Sound off" : "🔊 Sound on";
      el.btnMute2.textContent = muted ? "🔇 Sound off" : "🔊 Sound on";
      if (master) master.gain.value = muted ? 0 : 0.8;
      try {
        if (canMusic && ctx.music) {
          if (muted && musicOn) { ctx.music.pause(); musicOn = false; }
          else if (!muted && started) bed(state === "play" ? levelWorld(curLevel).music : "bubble", state === "play" ? 0.22 : 0.16);
        }
      } catch (_) {}
    }
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // =====================================================================
    // 4. Screen plumbing.
    // =====================================================================
    let state = "menu";      // menu | play | paused | dead | clear | over
    let started = false, curLevel = 0;
    let toastTok = 0, bigTok = 0;
    function toast(msg, ms) { el.toast.textContent = msg; el.toast.classList.add("show"); const tok = ++toastTok; ctx.timeout(() => { if (tok === toastTok) el.toast.classList.remove("show"); }, ms || 1300); }
    function bigText(title, sub, ms) { el.big.innerHTML = esc(title) + (sub ? "<small>" + esc(sub) + "</small>" : ""); el.big.classList.add("show"); const tok = ++bigTok; ctx.timeout(() => { if (tok === bigTok) el.big.classList.remove("show"); }, ms || 1600); }
    function confetti() {
      el.conf.innerHTML = "";
      const cols = ["#ffe066", "#5cc2ff", "#ff6b9d", "#7ee8a2", "#ffffff", "#ff9f43"];
      for (let i = 0; i < 44; i++) { const p = document.createElement("i"); p.style.left = (Math.random() * 100) + "%"; p.style.background = cols[i % cols.length]; p.style.animationDelay = (Math.random() * 0.5) + "s"; p.style.animationDuration = (1.3 + Math.random() * 0.9) + "s"; el.conf.appendChild(p); }
      ctx.timeout(() => { el.conf.innerHTML = ""; }, 2600);
    }
    function flash(node) { node.classList.add("on"); ctx.timeout(() => node.classList.remove("on"), 80); }
    function firstGesture() {
      if (!started) { started = true; try { ctx.platform.start(); } catch (_) {} if (canMusic && ctx.music) { try { ctx.music.unlock(); } catch (_) {} } }
      ensureAC(); resumeAC();
    }
    function fadeTo(fn, ms) { el.fade.classList.add("on"); ctx.timeout(() => { fn(); ctx.timeout(() => el.fade.classList.remove("on"), 60); }, ms || 480); }
    function refreshMenu() { el.mBest.textContent = fmt(S.bestScore); el.mStars.textContent = String(S.totalStars); }
    refreshMenu();
    try { ctx.markVisualReady("menu"); } catch (_) {}
    ctx.platform.ready();

    // =====================================================================
    // 5. Engine bootstrap.
    // =====================================================================
    let THREE = null, lastLoadErr = "";
    const loadErrs = [];
    function noteErr(err) { const m = String((err && err.message) || err || "load failed").slice(0, 150); if (loadErrs.indexOf(m) === -1) loadErrs.push(m); lastLoadErr = loadErrs.join(" | "); }
    function usable(mod) { if (mod && !mod.WebGLRenderer && mod.default) mod = mod.default; return mod && mod.WebGLRenderer ? mod : null; }
    async function importThree() {
      for (let i = 0; i < 4; i++) {
        if (i) await new Promise((r) => ctx.timeout(r, 500 * i));
        try { const raw = await ctx.importModule("three", "0.164.1"); const mod = usable(raw); if (mod) return mod; noteErr("loaded, but no WebGLRenderer"); } catch (err) { noteErr(err); }
      }
      return null;
    }
    while (!THREE) {
      THREE = await importThree();
      if (THREE) break;
      try { ctx.platform.error({ reason: "three_import_failed", message: lastLoadErr }); } catch (_) {}
      await new Promise((resolve) => {
        const f = document.createElement("div"); f.className = "bh-fatal";
        f.innerHTML = "<div><div style='font-size:44px;'>\u{1F7E2}</div><div style='font-size:16px;font-weight:800;margin-top:10px;'>The kingdom didn't load.</div><div style='font-size:13px;opacity:.75;margin-top:6px;'>Check your connection, then try again.</div>" +
          "<button class='bh-btn' id='bhRetry' style='margin:18px auto 0;width:200px;'>Try again</button><div style='font-size:10px;opacity:.4;margin-top:14px;word-break:break-word;'>" + esc(lastLoadErr) + "</div></div>";
        ui.appendChild(f); ctx.listen(f.querySelector("#bhRetry"), "click", () => { sfx.ui(); f.remove(); resolve(); });
      });
    }
    let renderer = null;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); }
    catch (e1) {
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false }); }
      catch (e2) { const f = document.createElement("div"); f.className = "bh-fatal"; f.innerHTML = "<div><div style='font-size:44px;'>\u{1F7E2}</div><div style='font-size:15px;font-weight:800;margin-top:10px;'>This device couldn't start 3D graphics.<br>Close other apps and reopen.</div></div>"; ui.appendChild(f); try { ctx.platform.error({ reason: "webgl_unavailable" }); } catch (_) {} return; }
    }
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xc4e6ff, 1);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    ctx.listen(canvas, "webglcontextlost", (e) => { e.preventDefault(); });
    ctx.listen(canvas, "webglcontextrestored", () => { try { renderer.resetState(); } catch (_) {} });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xc4e6ff);
    scene.fog = new THREE.Fog(0xdcefff, 40, 120);
    const camera = new THREE.PerspectiveCamera(58, ctx.width / Math.max(1, ctx.height), 0.5, 200);
    scene.add(camera);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xbfe0c0, 1.15); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.35); sun.position.set(-8, 20, 16); sun.castShadow = true; sun.shadow.radius = 6;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -20; sun.shadow.camera.right = 20; sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    function resize() { const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height); renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    let lastW = ctx.width, lastH = ctx.height;
    resize();

    // =====================================================================
    // 6. Textures, materials, builders.
    // =====================================================================
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function paint(w, h, fn) { if (!CAN_BAKE) return null; let c = null; try { c = new OffscreenCanvas(w, h); } catch (_) { return null; } fn(c.getContext("2d"), w, h); return c; }
    function texture(c, srgb) { if (!c) return null; const t = new THREE.CanvasTexture(c); if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
    function hex(n) { return "#" + (n >>> 0).toString(16).padStart(6, "0"); }
    function mixHex(a, b, t) { const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255, br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255; return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t)); }
    const matCache = new Map();
    function mat(color, opts) {
      const key = color + "|" + JSON.stringify(opts || {});
      if (matCache.has(key)) return matCache.get(key);
      const o = Object.assign({ color, roughness: 0.92, metalness: 0 }, opts || {});
      delete o.flatShading;
      const m = new THREE.MeshStandardMaterial(o);
      m.userData.shared = true; matCache.set(key, m); return m;
    }
    function mesh(geo, material, cast, recv) { const m = new THREE.Mesh(geo, material); m.castShadow = !!cast; m.receiveShadow = !!recv; return m; }
    function roundedBox(w, h, d, r, seg) {
      const sh = new THREE.Shape();
      const x = -w / 2, y = -h / 2;
      sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
      const g = new THREE.ExtrudeGeometry(sh, { depth: d - r * 2, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: seg || 3, curveSegments: 4 });
      g.translate(0, 0, -(d - r * 2) / 2); g.computeVertexNormals(); return g;
    }
    function boxUV(g) { const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i)); let u, v; if (nz >= nx && nz >= ny) { u = x; v = y; } else if (nx >= ny) { u = z; v = y; } else { u = x; v = z; } uv[i * 2] = u + 0.5; uv[i * 2 + 1] = v + 0.5; } g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); return g; }
    const GEO = { box: new THREE.BoxGeometry(1, 1, 1), rbox: roundedBox(1, 1, 1, 0.1), cap: roundedBox(1.08, 0.34, 1.18, 0.12), lip: roundedBox(1.1, 0.16, 1.2, 0.06), rblock: boxUV(roundedBox(1, 1, 1, 0.14)), sphere: new THREE.SphereGeometry(1, 14, 12), sphereLo: new THREE.IcosahedronGeometry(1, 2), cyl: new THREE.CylinderGeometry(1, 1, 1, 12), cone: new THREE.ConeGeometry(1, 1, 8), coin: new THREE.CylinderGeometry(0.34, 0.34, 0.12, 14), tile: new THREE.BoxGeometry(1, 1, 1), plat: roundedBox(1.02, 0.4, 1.24, 0.12), spike: new THREE.ConeGeometry(0.42, 0.9, 4), star: new THREE.OctahedronGeometry(0.45, 0) };
    const softTex = texture(paint(32, 32, (g) => { for (let r = 16; r > 0; r -= 2) { g.fillStyle = "rgba(255,255,255," + (0.1 + (1 - r / 16) * 0.9).toFixed(2) + ")"; g.beginPath(); g.arc(16, 16, r, 0, 6.29); g.fill(); } }), false);

    // Tile textures per world are painted fresh when a level loads.
    function tileTextures(w) {
      const ground = texture(paint(32, 32, (g) => {
        g.fillStyle = hex(w.ground); g.fillRect(0, 0, 32, 32);
        g.fillStyle = hex(mixHex(w.ground, 0x000000, 0.18)); for (let i = 0; i < 14; i++) g.fillRect((i * 7) % 32, (i * 11) % 32, 3, 2);
        g.fillStyle = hex(mixHex(w.ground, 0xffffff, 0.1)); for (let i = 0; i < 8; i++) g.fillRect((i * 13 + 5) % 32, (i * 5 + 3) % 32, 2, 2);
      }));
      const grass = texture(paint(32, 32, (g) => {
        g.fillStyle = hex(w.grass); g.fillRect(0, 0, 32, 32);
        g.fillStyle = hex(mixHex(w.grass, 0xffffff, 0.16)); for (let i = 0; i < 10; i++) g.fillRect((i * 9) % 32, (i * 7) % 32, 3, 2);
        g.fillStyle = hex(mixHex(w.grass, 0x000000, 0.2)); for (let i = 0; i < 8; i++) g.fillRect((i * 11 + 4) % 32, (i * 13 + 6) % 32, 2, 2);
      }));
      const brick = texture(paint(64, 64, (g) => {
        g.fillStyle = hex(mixHex(w.brick, 0xffffff, 0.25)); g.fillRect(0, 0, 64, 64);
        g.fillStyle = hex(w.brick);
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) { const x = c * 32 + (r % 2) * 16 - 16, y = r * 32; g.beginPath(); g.roundRect ? g.roundRect(x + 2, y + 2, 28, 28, 5) : g.rect(x + 2, y + 2, 28, 28); g.fill(); g.beginPath(); g.roundRect ? g.roundRect(x + 34, y + 2, 28, 28, 5) : g.rect(x + 34, y + 2, 28, 28); g.fill(); }
      }));
      const question = texture(paint(64, 64, (g) => {
        g.fillStyle = "#ffc93a"; g.fillRect(0, 0, 64, 64);
        g.fillStyle = "#f0a820"; g.fillRect(0, 0, 64, 5); g.fillRect(0, 59, 64, 5); g.fillRect(0, 0, 5, 64); g.fillRect(59, 0, 5, 64);
        g.fillStyle = "#e89a18"; for (const [x, y] of [[8, 8], [50, 8], [8, 50], [50, 50]]) { g.beginPath(); g.arc(x + 3, y + 3, 3, 0, 6.29); g.fill(); }
        g.fillStyle = "#fff8e0"; g.font = "900 44px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("?", 32, 35);
      }));
      const used = texture(paint(64, 64, (g) => { g.fillStyle = "#b08a6a"; g.fillRect(0, 0, 64, 64); g.fillStyle = "#9a765a"; g.fillRect(0, 0, 64, 5); g.fillRect(0, 59, 64, 5); g.fillRect(0, 0, 5, 64); g.fillRect(59, 0, 5, 64); for (const [x, y] of [[8, 8], [50, 8], [8, 50], [50, 50]]) { g.beginPath(); g.arc(x + 3, y + 3, 3, 0, 6.29); g.fill(); } }));
      const stone = texture(paint(32, 32, (g) => { g.fillStyle = hex(mixHex(w.ground, 0x8a8a9a, 0.5)); g.fillRect(0, 0, 32, 32); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, 0, 32, 2); g.fillRect(0, 0, 2, 32); g.fillStyle = "rgba(255,255,255,.15)"; g.fillRect(30, 0, 2, 32); g.fillRect(0, 30, 32, 2); }));
      return { ground, grass, brick, question, used, stone };
    }

    // ---- the hero: a round green blob with big eyes, feet and a cap ----------------
    function buildBloop() {
      const g = new THREE.Group();
      const body = mesh(GEO.sphere, mat(0x5fd35a, { flatShading: false }), true); body.scale.set(0.42, 0.42, 0.4); body.position.y = 0.45; g.add(body);
      const belly = mesh(GEO.sphere, mat(0xb9f0a8, { flatShading: false })); belly.scale.set(0.28, 0.25, 0.2); belly.position.set(0, 0.36, 0.26); g.add(belly);
      const eyeW = mat(0xffffff, { flatShading: false }), pupil = mat(0x101820, { flatShading: false });
      const eyes = [];
      for (const s of [-1, 1]) {
        const e = mesh(GEO.sphere, eyeW); e.scale.setScalar(0.12); e.position.set(s * 0.15, 0.56, 0.32); g.add(e); eyes.push(e);
        const p = mesh(GEO.sphere, pupil); p.scale.setScalar(0.06); p.position.set(s * 0.15, 0.56, 0.42); g.add(p); eyes.push(p);
      }
      const brow = mesh(GEO.box, mat(0x2a7a2a)); brow.scale.set(0.5, 0.05, 0.1); brow.position.set(0, 0.7, 0.3); brow.rotation.z = 0.05; g.add(brow);
      const cap = mesh(GEO.sphere, mat(0xff5a4a, { flatShading: false }), true); cap.scale.set(0.4, 0.22, 0.4); cap.position.y = 0.78; g.add(cap);
      const brim = mesh(GEO.box, mat(0xff5a4a, { flatShading: false })); brim.scale.set(0.5, 0.06, 0.32); brim.position.set(0, 0.74, 0.3); g.add(brim);
      const feet = [];
      for (const s of [-1, 1]) { const f = mesh(GEO.sphere, mat(0x8a4a1a, { flatShading: false }), true); f.scale.set(0.16, 0.1, 0.2); f.position.set(s * 0.18, 0.06, 0.04); g.add(f); feet.push(f); }
      const mouth = mesh(GEO.box, mat(0x2a1a1a)); mouth.scale.set(0.14, 0.04, 0.05); mouth.position.set(0, 0.36, 0.4); g.add(mouth);
      g.userData = { body, feet, eyes, cap, brim, mouth };
      return g;
    }
    // ---- enemies --------------------------------------------------------------------
    function buildGrump(color) {
      const g = new THREE.Group();
      const body = mesh(GEO.sphere, mat(color || 0xb8743a, { flatShading: false }), true); body.scale.set(0.42, 0.36, 0.4); body.position.y = 0.36; g.add(body);
      const eyeW = mat(0xffffff, { flatShading: false }), pupil = mat(0x101820, { flatShading: false });
      for (const s of [-1, 1]) { const e = mesh(GEO.sphere, eyeW); e.scale.setScalar(0.1); e.position.set(s * 0.15, 0.48, 0.3); g.add(e); const p = mesh(GEO.sphere, pupil); p.scale.setScalar(0.05); p.position.set(s * 0.13, 0.46, 0.38); g.add(p); }
      const brow = mesh(GEO.box, mat(0x3a1a08)); brow.scale.set(0.46, 0.06, 0.1); brow.position.set(0, 0.6, 0.28); brow.rotation.z = 0; g.add(brow);
      for (const s of [-1, 1]) { const b = mesh(GEO.box, mat(0x3a1a08)); b.scale.set(0.2, 0.05, 0.08); b.position.set(s * 0.14, 0.62, 0.3); b.rotation.z = s * 0.45; g.add(b); }
      const feet = [];
      for (const s of [-1, 1]) { const f = mesh(GEO.sphere, mat(0x3a2a1a, { flatShading: false }), true); f.scale.set(0.15, 0.09, 0.18); f.position.set(s * 0.17, 0.05, 0); g.add(f); feet.push(f); }
      g.userData = { body, feet };
      return g;
    }
    function buildRoller(color) {
      const g = new THREE.Group();
      const shell = mesh(GEO.sphere, mat(color || 0x3cb44a, { flatShading: false }), true); shell.scale.set(0.42, 0.34, 0.42); shell.position.y = 0.4; g.add(shell);
      const rim = mesh(GEO.cyl, mat(0xfff0c0, { flatShading: false })); rim.scale.set(0.44, 0.08, 0.44); rim.position.y = 0.22; g.add(rim);
      const spots = mat(mixHex(color || 0x3cb44a, 0x000000, 0.3), { flatShading: false });
      for (let i = 0; i < 5; i++) { const sp = mesh(GEO.sphere, spots); sp.scale.setScalar(0.09); const a = i / 5 * 6.28; sp.position.set(Math.cos(a) * 0.28, 0.55 + Math.sin(a * 2) * 0.05, Math.sin(a) * 0.28); g.add(sp); }
      const head = mesh(GEO.sphere, mat(0xffe08a, { flatShading: false }), true); head.scale.set(0.18, 0.16, 0.2); head.position.set(0, 0.34, 0.44); g.add(head);
      const pupil = mat(0x101820, { flatShading: false });
      for (const s of [-1, 1]) { const p = mesh(GEO.sphere, pupil); p.scale.setScalar(0.04); p.position.set(s * 0.07, 0.4, 0.6); g.add(p); }
      const feet = [];
      for (const s of [-1, 1]) { const f = mesh(GEO.sphere, mat(0xffe08a, { flatShading: false })); f.scale.set(0.14, 0.08, 0.16); f.position.set(s * 0.2, 0.05, 0.1); g.add(f); feet.push(f); }
      g.userData = { body: shell, feet, head };
      return g;
    }
    function buildFlap(color) {
      const g = new THREE.Group();
      const body = mesh(GEO.sphere, mat(color || 0xb57bff, { flatShading: false }), true); body.scale.set(0.3, 0.26, 0.3); body.position.y = 0.4; g.add(body);
      const wings = [];
      for (const s of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(s * 0.22, 0.5, 0); const w = mesh(GEO.box, mat(mixHex(color || 0xb57bff, 0xffffff, 0.3))); w.scale.set(0.5, 0.04, 0.3); w.position.set(s * 0.25, 0, 0); piv.add(w); g.add(piv); wings.push(piv); }
      const pupil = mat(0x101820, { flatShading: false });
      for (const s of [-1, 1]) { const p = mesh(GEO.sphere, pupil); p.scale.setScalar(0.05); p.position.set(s * 0.1, 0.44, 0.26); g.add(p); }
      const beak = mesh(GEO.cone, mat(0xffb020)); beak.rotation.x = Math.PI / 2; beak.scale.set(0.08, 0.16, 0.08); beak.position.set(0, 0.36, 0.34); g.add(beak);
      g.userData = { body, wings };
      return g;
    }
    function buildSnapper() {
      const g = new THREE.Group();
      const stem = mesh(GEO.cyl, mat(0x3a8a3a, { flatShading: false })); stem.scale.set(0.12, 1.0, 0.12); stem.position.y = 0.5; g.add(stem);
      const head = mesh(GEO.sphere, mat(0xff4a6a, { flatShading: false }), true); head.scale.set(0.34, 0.3, 0.34); head.position.y = 1.15; g.add(head);
      const spots = mat(0xffffff, { flatShading: false });
      for (let i = 0; i < 4; i++) { const s = mesh(GEO.sphere, spots); s.scale.setScalar(0.07); const a = i * 1.57 + 0.5; s.position.set(Math.cos(a) * 0.26, 1.2 + (i % 2) * 0.1, Math.sin(a) * 0.26); g.add(s); }
      const jaw = mesh(GEO.sphere, mat(0xd8304a, { flatShading: false })); jaw.scale.set(0.3, 0.14, 0.3); jaw.position.set(0, 0.98, 0.06); g.add(jaw);
      const teeth = mat(0xffffff);
      for (let i = 0; i < 4; i++) { const t = mesh(GEO.cone, teeth); t.scale.set(0.05, 0.1, 0.05); t.rotation.x = Math.PI; t.position.set(-0.18 + i * 0.12, 1.02, 0.3); g.add(t); }
      for (const s of [-1, 1]) { const l = mesh(GEO.box, mat(0x3a8a3a)); l.scale.set(0.34, 0.06, 0.16); l.position.set(s * 0.2, 0.45, 0); l.rotation.z = s * 0.5; g.add(l); }
      g.userData = { head, jaw };
      return g;
    }
    function buildBoss(color) {
      const g = buildGrump(color || 0x8a3a8a);
      g.scale.setScalar(2.2);
      const crown = mesh(GEO.cyl, mat(0xffd35a, { emissive: 0x6a4a00 })); crown.scale.set(0.22, 0.14, 0.22); crown.position.y = 0.72; g.add(crown);
      for (let i = 0; i < 5; i++) { const sp = mesh(GEO.cone, mat(0xffd35a, { emissive: 0x6a4a00 })); sp.scale.set(0.05, 0.12, 0.05); sp.position.set(Math.cos(i / 5 * 6.28) * 0.2, 0.84, Math.sin(i / 5 * 6.28) * 0.2); g.add(sp); }
      return g;
    }
    // ---- props ----------------------------------------------------------------------
    function buildPipe(h, color) {
      const g = new THREE.Group();
      const c = color || 0x3cb44a;
      const body = mesh(GEO.cyl, mat(c), true, true); body.scale.set(0.86, h, 0.86); body.position.y = h / 2; g.add(body);
      const lip = mesh(GEO.cyl, mat(mixHex(c, 0xffffff, 0.1)), true); lip.scale.set(1.0, 0.55, 1.0); lip.position.y = h - 0.27; g.add(lip);
      const rim = mesh(new THREE.TorusGeometry(0.86, 0.14, 10, 24), mat(mixHex(c, 0xffffff, 0.1))); rim.rotation.x = Math.PI / 2; rim.position.y = h; g.add(rim);
      const hole = mesh(GEO.cyl, mat(0x1a3a1a)); hole.scale.set(0.72, 0.1, 0.72); hole.position.y = h + 0.02; g.add(hole);
      return g;
    }
    function buildFlag(goal, color) {
      const g = new THREE.Group();
      const pole = mesh(GEO.cyl, mat(0xe8e8f0, { flatShading: false }), true); pole.scale.set(0.07, goal ? 9 : 4, 0.07); pole.position.y = (goal ? 9 : 4) / 2; g.add(pole);
      const ball = mesh(GEO.sphere, mat(goal ? 0xffd35a : 0x5cc2ff, { flatShading: false })); ball.scale.setScalar(0.18); ball.position.y = goal ? 9.1 : 4.1; g.add(ball);
      const flagTex = texture(paint(32, 32, (gg) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { gg.fillStyle = (x + y) % 2 ? "#1b2a3a" : "#ffffff"; gg.fillRect(x * 8, y * 8, 8, 8); } }));
      const flag = mesh(new THREE.PlaneGeometry(1.4, 1.0, 4, 1), goal && flagTex ? new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ color: color || 0x5cc2ff, side: THREE.DoubleSide }), true);
      flag.position.set(0.72, goal ? 8.4 : 3.5, 0); g.add(flag);
      const base = mesh(GEO.box, mat(0x8a8a9a), true, true); base.scale.set(0.9, 0.5, 0.9); base.position.y = 0.25; g.add(base);
      g.userData = { flag, ball };
      return g;
    }
    function buildSpring() {
      const g = new THREE.Group();
      const base = mesh(GEO.box, mat(0x6a6a7a), true); base.scale.set(0.8, 0.15, 0.8); base.position.y = 0.08; g.add(base);
      const coil = mesh(GEO.cyl, mat(0xffd35a, { flatShading: false }), true); coil.scale.set(0.28, 0.4, 0.28); coil.position.y = 0.35; g.add(coil);
      const top = mesh(GEO.box, mat(0xff5a4a), true); top.scale.set(0.8, 0.14, 0.8); top.position.y = 0.6; g.add(top);
      g.userData = { coil, top };
      return g;
    }
    function buildItem(kind) {
      const g = new THREE.Group();
      if (kind === "berry") {
        const b = mesh(GEO.sphere, mat(0xff4a6a, { flatShading: false }), true); b.scale.set(0.3, 0.32, 0.3); b.position.y = 0.34; g.add(b);
        const leaf = mesh(GEO.box, mat(0x3cb44a)); leaf.scale.set(0.3, 0.05, 0.14); leaf.position.set(0, 0.66, 0); leaf.rotation.z = 0.3; g.add(leaf);
        const seeds = mat(0xffe0a0, { flatShading: false }); for (let i = 0; i < 6; i++) { const s = mesh(GEO.sphere, seeds); s.scale.setScalar(0.035); const a = i * 1.05; s.position.set(Math.cos(a) * 0.24, 0.34 + Math.sin(a * 1.7) * 0.15, Math.sin(a) * 0.24); g.add(s); }
      } else if (kind === "star") {
        const s = mesh(GEO.star, mat(0xffe066, { emissive: 0xaa7a00, flatShading: true }), true); s.position.y = 0.45; g.add(s); g.userData.spin = s;
      } else if (kind === "heart") {
        const l = mesh(GEO.sphere, mat(0xff5a8a, { emissive: 0x5a1030, flatShading: false }), true); l.scale.setScalar(0.2); l.position.set(-0.13, 0.5, 0); g.add(l);
        const r = mesh(GEO.sphere, mat(0xff5a8a, { emissive: 0x5a1030, flatShading: false }), true); r.scale.setScalar(0.2); r.position.set(0.13, 0.5, 0); g.add(r);
        const b = mesh(GEO.cone, mat(0xff5a8a, { emissive: 0x5a1030, flatShading: false }), true); b.rotation.x = Math.PI; b.scale.set(0.3, 0.4, 0.2); b.position.set(0, 0.28, 0); g.add(b);
      }
      return g;
    }
    // ---- backgrounds ----------------------------------------------------------------------
    function blobTree(w, rr, h) {
      const g = new THREE.Group();
      const trunk = mesh(GEO.cyl, mat(0xc98a5a), true); trunk.scale.set(0.16, h, 0.16); trunk.position.y = h / 2; g.add(trunk);
      const leaf = mat(w.tree);
      const n = 4 + (rr() * 3 | 0);
      for (let i = 0; i < n; i++) { const b = mesh(GEO.sphere, leaf, true); const r = 0.5 + rr() * 0.4; b.scale.setScalar(r); b.position.set((rr() - 0.5) * 1.1, h + 0.5 + (rr() - 0.3) * 0.8, (rr() - 0.5) * 0.6); g.add(b); }
      const top = mesh(GEO.sphere, leaf, true); top.scale.setScalar(0.75); top.position.y = h + 0.9; g.add(top);
      return g;
    }
    function bush(w, rr) {
      const g = new THREE.Group(); const leaf = mat(mixHex(w.tree, 0x000000, 0.1));
      for (let i = 0; i < 3; i++) { const b = mesh(GEO.sphere, leaf, true); b.scale.set(0.35 + rr() * 0.2, 0.28 + rr() * 0.15, 0.3); b.position.set((i - 1) * 0.35, 0.22, 0); g.add(b); }
      return g;
    }
    function flower(rr) {
      const g = new THREE.Group();
      const stem = mesh(GEO.cyl, mat(0x6fbf5a)); stem.scale.set(0.03, 0.35, 0.03); stem.position.y = 0.17; g.add(stem);
      const head = mesh(GEO.sphere, mat(pick([0xff6b9d, 0xffd35a, 0xffffff, 0xb57bff]))); head.scale.setScalar(0.11); head.position.y = 0.38; g.add(head);
      return g;
    }
    function puffCloud(matC, rr) {
      const c = new THREE.Group();
      const n = 5 + (rr() * 3 | 0);
      for (let i = 0; i < n; i++) { const p = mesh(GEO.sphere, matC); const r = 0.6 + rr() * 0.7; p.scale.set(r, r * 0.85, r); p.position.set((i - n / 2) * 0.75, Math.sin(i / (n - 1) * Math.PI) * 0.5 + rr() * 0.2, rr() * 0.3); c.add(p); }
      return c;
    }
    function buildBackdrop(w, width, lv) {
      const g = new THREE.Group();
      const rr = seeded(S.seed + w.id * 101);
      // soft far hills
      for (let x = -30; x < width + 40; x += 12 + rr() * 10) {
        const h = 6 + rr() * 8;
        const m = mesh(GEO.sphere, mat(w.far)); m.scale.set(14 + rr() * 10, h, 6); m.position.set(x, -2, -30); g.add(m);
      }
      // mid hills / stalagmites
      for (let x = -20; x < width + 30; x += 8 + rr() * 8) {
        const h = 2.5 + rr() * 4;
        if (w.id === 2) { const m = mesh(GEO.cone, mat(w.hills)); m.scale.set(2 + rr() * 2, h * 1.6, 2); m.position.set(x, h * 0.8 - 3, -14); g.add(m); const st = mesh(GEO.cone, mat(w.hills)); st.scale.set(1.5 + rr(), h * 1.2, 1.5); st.rotation.x = Math.PI; st.position.set(x + 4, 18 - h * 0.6, -14); g.add(st); }
        else { const m = mesh(GEO.sphere, mat(w.hills)); m.scale.set(7 + rr() * 6, h, 4); m.position.set(x, -1.5, -13); g.add(m); }
      }
      // puffy clouds
      const cloudMat = new THREE.MeshStandardMaterial({ color: w.id === 2 ? 0x4a5a8a : 0xffffff, roughness: 1, transparent: true, opacity: w.id === 2 ? 0.6 : 1 }); cloudMat.userData.shared = true;
      const clouds = [];
      for (let x = -10; x < width + 20; x += 9 + rr() * 12) { const c = puffCloud(cloudMat, rr); c.position.set(x, 9 + rr() * 7, -6 - rr() * 8); c.scale.setScalar(0.9 + rr() * 0.8); g.add(c); clouds.push(c); }
      // foreground dressing along exposed ground: trees, bushes, flowers, just behind the play plane
      if (lv) for (let x = 2; x < lv.W - 4; x++) {
        const t = tileTop(x);
        if (t <= 0 || !SOLID.has(lv.grid[(t - 1) * lv.stride + x]) || lv.grid[(t - 1) * lv.stride + x] !== T.GROUND) continue;
        if (lv.grid[t * lv.stride + x]) continue;
        const r = rr();
        if (r < 0.08 && w.id !== 2) { const tr = blobTree(w, rr, 1.6 + rr() * 1.4); tr.position.set(x + 0.5, t, -1.9); tr.scale.setScalar(0.9 + rr() * 0.5); g.add(tr); }
        else if (r < 0.2) { const b = bush(w, rr); b.position.set(x + 0.5, t, -1.2); g.add(b); }
        else if (r < 0.36 && w.id !== 2) { const f = flower(rr); f.position.set(x + rr(), t, -0.9); g.add(f); if (rr() < 0.5) { const f2 = flower(rr); f2.position.set(x + rr(), t, -1.3); g.add(f2); } }
      }
      if (w.id === 2) {
        const ceil = mesh(GEO.box, mat(0x2a3460)); ceil.scale.set(width + 80, 6, 30); ceil.position.set(width / 2, 22, -8); g.add(ceil);
        for (let x = -10; x < width + 20; x += 6 + rr() * 8) {
          const c = mesh(GEO.cone, new THREE.MeshStandardMaterial({ color: 0x9ad7ff, emissive: [0x2a70a0, 0x5a3aa0, 0xa02a70][Math.abs(x / 7 | 0) % 3], emissiveIntensity: 0.9, roughness: 0.4 }));
          c.material.userData.shared = true; c.scale.set(0.6 + rr() * 0.6, 1.5 + rr() * 2.5, 0.6); c.position.set(x, -0.5 + rr() * 2, -6 - rr() * 6); c.rotation.z = (rr() - 0.5) * 0.6; g.add(c);
        }
      }
      const floor = mesh(GEO.box, mat(w.dirtDark), false, true); floor.scale.set(width + 80, 1, 30); floor.position.set(width / 2, -6.5, -4); g.add(floor);
      g.userData = { clouds };
      return g;
    }
    // ---- particles ------------------------------------------------------------------------
    const PN = 260;
    const pPos = new Float32Array(PN * 3), pSize = new Float32Array(PN), pCol = new Float32Array(PN * 3), pAlpha = new Float32Array(PN);
    const parts = []; for (let i = 0; i < PN; i++) { parts.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, g: 0, grow: 0 }); pPos[i * 3 + 1] = -50; }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute("psize", new THREE.BufferAttribute(pSize, 1)); pGeo.setAttribute("pcol", new THREE.BufferAttribute(pCol, 3)); pGeo.setAttribute("palpha", new THREE.BufferAttribute(pAlpha, 1));
    const pMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { map: { value: softTex }, scale: { value: 420 } },
      vertexShader: `attribute float psize; attribute vec3 pcol; attribute float palpha; varying vec3 vC; varying float vA; uniform float scale; void main(){ vC = pcol; vA = palpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = psize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA);\n#include <colorspace_fragment>\n}` });
    const pPts = new THREE.Points(pGeo, pMat); pPts.frustumCulled = false; scene.add(pPts);
    let pNext = 0;
    function emit(x, y, n, o) {
      o = o || {};
      const c = o.color || [1, 1, 1];
      for (let k = 0; k < n; k++) {
        const i = pNext; pNext = (pNext + 1) % PN; const p = parts[i];
        const sp = o.spread == null ? 2 : o.spread;
        p.vx = rnd(-sp, sp) + (o.vx || 0); p.vy = rnd(o.up == null ? 1 : o.up * 0.4, o.up == null ? 3 : o.up); p.vz = rnd(-0.5, 0.5);
        p.max = p.life = rnd(o.life == null ? 0.4 : o.life * 0.7, o.life == null ? 0.7 : o.life * 1.3); p.g = o.g == null ? 12 : o.g; p.grow = o.grow == null ? 0 : o.grow;
        pPos[i * 3] = x + rnd(-0.2, 0.2); pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = 0.3 + rnd(-0.2, 0.2);
        pSize[i] = o.size == null ? 0.5 : o.size; pCol[i * 3] = c[0]; pCol[i * 3 + 1] = c[1]; pCol[i * 3 + 2] = c[2]; pAlpha[i] = 1;
      }
    }
    function updateParticles(dt) {
      for (let i = 0; i < PN; i++) {
        const p = parts[i]; if (p.life <= 0) continue;
        p.life -= dt; if (p.life <= 0) { pPos[i * 3 + 1] = -50; pAlpha[i] = 0; continue; }
        p.vy -= p.g * dt; pPos[i * 3] += p.vx * dt; pPos[i * 3 + 1] += p.vy * dt; pPos[i * 3 + 2] += p.vz * dt; pSize[i] += p.grow * dt; pAlpha[i] = p.life / p.max;
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.psize.needsUpdate = true; pGeo.attributes.palpha.needsUpdate = true;
    }

    // =====================================================================
    // 7. Level generation. A level is a tile grid plus entity lists, built
    //    from hand-designed chunks picked and tuned by a difficulty number.
    // =====================================================================
    const H = 18;
    const T = { EMPTY: 0, GROUND: 1, BRICK: 2, QUESTION: 3, USED: 4, PIPE: 5, PLAT: 6, SPIKE: 7, LAVA: 8, STONE: 10, GATE: 11 };
    const SOLID = new Set([T.GROUND, T.BRICK, T.QUESTION, T.USED, T.PIPE, T.STONE, T.GATE]);
    let L = null;   // current level

    function genLevel(idx) {
      const w = levelWorld(idx), d = difficultyOf(idx), rr = seeded(S.seed * 7 + idx * 131 + 5);
      const W = 260;
      const grid = new Uint8Array(W * H);
      const lv = { idx, w, d, W, stride: W, H, grid, enemies: [], coins: [], items: [], movers: [], springs: [], snappers: [], pipes: [], qContent: {}, checkpoint: 0, flagX: 0, gate: null, boss: null, startX: 3.5, startY: 3, coinsTotal: 0, par: 0 };
      const set = (x, y, t) => { if (x >= 0 && x < W && y >= 0 && y < H) grid[y * W + x] = t; };
      const fillGround = (x0, x1, top) => { for (let x = x0; x < x1; x++) for (let y = 0; y < top; y++) set(x, y, T.GROUND); };
      const coin = (x, y) => { lv.coins.push({ x: x + 0.5, y: y + 0.5, taken: false, slot: -1 }); };
      const coinRow = (x0, n, y) => { for (let i = 0; i < n; i++) coin(x0 + i, y); };
      const coinArc = (x0, n, y0, h) => { for (let i = 0; i < n; i++) coin(x0 + i, y0 + Math.round(Math.sin(i / (n - 1) * Math.PI) * h)); };
      const enemy = (type, x, y, o) => lv.enemies.push(Object.assign({ type, x: x + 0.5, y, dir: -1 }, o || {}));
      const qblock = (x, y, content) => { set(x, y, T.QUESTION); lv.qContent[x + "," + y] = content || "coin"; };
      const pipe = (x, top, h, snap) => { for (let y = top - h; y < top; y++) { set(x, y, T.PIPE); set(x + 1, y, T.PIPE); } lv.pipes.push({ x: x + 1, y: top - h, h }); if (snap) lv.snappers.push({ x: x + 1, y: top, t: rr() * 3 }); };
      const ilerp = (a, b) => Math.round(lerp(a, b, d));
      const chance = (p) => rr() < p;
      const walker = () => (d > 0.25 && chance(0.35 + d * 0.3)) ? "roller" : "grump";

      let x = 0, gy = 3;
      const startW = 12;
      fillGround(0, startW, gy);
      lv.startX = 3.5; lv.startY = gy;
      coinRow(6, 3, gy + 2);
      x = startW;

      // ---- chunk templates ----------------------------------------------------
      const CH = {
        flat() { const wdt = 7 + (rr() * 4 | 0); fillGround(x, x + wdt, gy); const n = ilerp(0, 2) + (chance(0.5) ? 1 : 0); for (let i = 0; i < n; i++) enemy(walker(), x + 2 + (rr() * (wdt - 4) | 0), gy); if (chance(0.6)) coinRow(x + 1, 3 + (rr() * 3 | 0), gy + 2 + (rr() * 2 | 0)); return wdt; },
        gap() { const g = clamp(2 + Math.round(d * 2.6 + rr() * 0.8), 2, 5); const pre = 3, post = 4; fillGround(x, x + pre, gy); fillGround(x + pre + g, x + pre + g + post, gy); coinArc(x + pre - 1, g + 2, gy + 1, 2 + (g > 3 ? 1 : 0)); if (d > 0.5 && chance(0.4)) for (let i = 0; i < g; i++) set(x + pre + i, 0, T.SPIKE); return pre + g + post; },
        blocks() { const wdt = 8 + (rr() * 3 | 0); fillGround(x, x + wdt, gy); const by = gy + 4; const n = 3 + (rr() * 3 | 0); const bx = x + 2; for (let i = 0; i < n; i++) { const isQ = chance(0.35); if (isQ) qblock(bx + i, by, chance(0.18) ? (chance(0.3) && d > 0.3 ? "star" : "berry") : "coin"); else set(bx + i, by, T.BRICK); } if (chance(0.5)) qblock(bx + (rr() * n | 0), by + 4, chance(0.3) ? "berry" : "coin"); enemy(walker(), x + 3 + (rr() * 3 | 0), gy); if (d > 0.4 && chance(0.5)) enemy(walker(), x + wdt - 2, gy); return wdt; },
        stairsUp() { const n = 2 + (rr() * 3 | 0); let wdt = 0; for (let i = 0; i < n; i++) { fillGround(x + wdt, x + wdt + 2, gy + i + 1); for (let y = gy; y <= gy + i; y++) { set(x + wdt, y, T.STONE); set(x + wdt + 1, y, T.STONE); } wdt += 2; } gy += n; fillGround(x + wdt, x + wdt + 3, gy); coinRow(x + 1, n, gy + 1); wdt += 3; return wdt; },
        stairsDown() { const n = Math.min(3, gy - 2); if (n < 1) return CH.flat(); let wdt = 0; for (let i = 0; i < n; i++) { fillGround(x + wdt, x + wdt + 2, gy - i - 1); wdt += 2; } gy -= n; fillGround(x + wdt, x + wdt + 3, gy); if (chance(0.5)) enemy(walker(), x + wdt + 1, gy); wdt += 3; return wdt; },
        pipes() { const n = 2 + (chance(0.5) ? 1 : 0); let wdt = 0; fillGround(x, x + 2, gy); wdt = 2; for (let i = 0; i < n; i++) { const g = clamp(2 + Math.round(rr() * 1.5 + d), 2, 4); const h = 2 + (rr() * 2 | 0) + (d > 0.6 && chance(0.4) ? 1 : 0); if (i > 0) { fillGround(x + wdt, x + wdt + g, gy); coinArc(x + wdt - 1, g + 2, gy + 1, 2); wdt += g; } fillGround(x + wdt, x + wdt + 2, gy); pipe(x + wdt, gy + h, h, d > 0.3 && chance(0.35 + d * 0.4)); wdt += 2; } fillGround(x + wdt, x + wdt + 3, gy); wdt += 3; return wdt; },
        hop() { const g = 5 + Math.round(d * 4 + rr() * 2); fillGround(x, x + 3, gy); const n = Math.max(1, Math.round(g / (2.4 + d * 1.2))); const step = g / (n + 1); let py = gy + 1; for (let i = 1; i <= n; i++) { const px = x + 3 + Math.round(step * i) - 1; py = clamp(gy + 1 + Math.round((rr() - 0.4) * 3), gy - 1, gy + 5); const pw = d > 0.55 ? 2 : 3; for (let k = 0; k < pw; k++) set(px + k, py, T.PLAT); coinRow(px, pw, py + 2); if (d > 0.35 && chance(0.4)) enemy("flap", px + 1, py + 3, { base: py + 3, amp: 1.2 + d, phase: rr() * 6 }); } fillGround(x + 3 + g, x + 6 + g, gy); if (d > 0.6 && chance(0.5)) for (let i = 0; i < g; i++) set(x + 3 + i, 0, w.id === 3 ? T.LAVA : T.SPIKE); return g + 6; },
        mover() { const g = 7 + Math.round(d * 4 + rr() * 2); fillGround(x, x + 3, gy); lv.movers.push({ x: x + 3 + 1.5, y: gy + 0.5, ax: "x", range: (g - 4) / 2, speed: 1.6 + d * 1.6, phase: rr() * 6, w: 3 }); coinArc(x + 3, g, gy + 3, 1); fillGround(x + 3 + g, x + 6 + g, gy); if (d > 0.55 && chance(0.5)) enemy("flap", x + 3 + g / 2, gy + 5, { base: gy + 5, amp: 1.5, phase: rr() * 6 }); return g + 6; },
        lift() { const g = 5 + Math.round(d * 3); fillGround(x, x + 3, gy); const ny = clamp(gy + 3 + (rr() * 3 | 0), 4, 11); lv.movers.push({ x: x + 3 + g / 2, y: gy + 1, ax: "y", range: (ny - gy) / 2 + 0.5, speed: 1.2 + d * 1.2, phase: rr() * 6, w: 3 }); coinRow(x + 3 + Math.round(g / 2) - 1, 3, ny + 2); gy = ny; fillGround(x + 3 + g, x + 6 + g, gy); return g + 6; },
        spring() { fillGround(x, x + 4, gy); lv.springs.push({ x: x + 2.5, y: gy }); const wh = 4 + (rr() * 2 | 0); for (let y = gy; y < gy + wh; y++) { set(x + 5, y, T.STONE); set(x + 6, y, T.STONE); } fillGround(x + 5, x + 7, gy); coinArc(x + 3, 6, gy + wh + 1, 2); fillGround(x + 7, x + 11, gy); if (chance(0.5)) qblock(x + 9, gy + 4, "coin"); return 11; },
        gauntlet() { const wdt = 11 + (rr() * 3 | 0); fillGround(x, x + wdt, gy); const n = 2 + ilerp(1, 3); for (let i = 0; i < n; i++) enemy(walker(), x + 2 + Math.round(i * (wdt - 4) / n), gy); for (let i = 2; i < wdt - 2; i++) if (chance(0.7)) set(x + i, gy + 4, T.BRICK); qblock(x + 3, gy + 4, "berry"); coinRow(x + 3, wdt - 6, gy + 6); return wdt; },
        spikes() { const wdt = 10; fillGround(x, x + 2, gy); for (let i = 2; i < 8; i++) { fillGround(x + i, x + i + 1, gy - 1); set(x + i, gy - 1, T.SPIKE); } for (let k = 0; k < 2; k++) set(x + 4 + k, gy + 2, T.PLAT); coinRow(x + 3, 4, gy + 4); fillGround(x + 8, x + wdt, gy); return wdt; },
        heaven() { const wdt = 14; fillGround(x, x + wdt, gy); for (let i = 0; i < 4; i++) { const px = x + 2 + i * 3, py = gy + 3 + i; for (let k = 0; k < 2; k++) set(px + k, py, T.PLAT); coinArc(px - 1, 4, py + 2, 1); } qblock(x + 12, gy + 8, chance(0.5) ? "heart" : "star"); enemy(walker(), x + 6, gy); return wdt; },
        tunnel() { const wdt = 12; fillGround(x, x + wdt, gy); for (let i = 1; i < wdt - 1; i++) if (!(i === 5 || i === 6)) set(x + i, gy + 3, T.BRICK); for (let i = 1; i < wdt - 1; i++) set(x + i, gy + 4, T.STONE); enemy(walker(), x + 4, gy); enemy(walker(), x + 8, gy); coinRow(x + 2, 8, gy + 1); if (chance(0.5)) coinRow(x + 4, 4, gy + 6); return wdt; },
        lava() { const g = 6 + Math.round(d * 4); fillGround(x, x + 3, gy); for (let i = 0; i < g; i++) set(x + 3 + i, 0, T.LAVA); const n = Math.max(2, Math.round(g / 2.6)); for (let i = 1; i <= n; i++) { const px = x + 3 + Math.round(g * i / (n + 1)) - 1; const py = gy + (i % 2 ? 1 : 2); set(px, py, T.PLAT); set(px + 1, py, T.PLAT); coin(px, py + 2); } fillGround(x + 3 + g, x + 6 + g, gy); return g + 6; }
      };
      const weights = () => [
        ["flat", 3], ["gap", 3], ["blocks", 2.5], ["stairsUp", gy < 7 ? 1.5 : 0], ["stairsDown", gy > 3 ? 1.5 : 0],
        ["pipes", 1.5 + d], ["hop", 1.2 + d * 2], ["mover", d > 0.2 ? 0.8 + d * 1.5 : 0], ["lift", d > 0.35 && gy < 7 ? 0.8 : 0],
        ["spring", 0.8], ["gauntlet", d > 0.25 ? 0.8 + d : 0], ["spikes", d > 0.45 ? 0.7 + d : 0], ["heaven", 0.6],
        ["tunnel", w.id === 2 ? 1.6 : 0.4], ["lava", w.id === 3 && d > 0.5 ? 1.5 : 0]
      ];
      const nChunks = 9 + Math.round(d * 7) - (isBossLevel(idx) ? 2 : 0);
      let last = "";
      for (let i = 0; i < nChunks; i++) {
        const ws = weights().filter((e) => e[1] > 0 && e[0] !== last);
        let tot = 0; for (const e of ws) tot += e[1];
        let r = rr() * tot, name = ws[0][0];
        for (const e of ws) { r -= e[1]; if (r <= 0) { name = e[0]; break; } }
        last = name;
        if (i === Math.floor(nChunks / 2)) { fillGround(x, x + 4, gy); lv.checkpoint = x + 2; x += 4; }
        x += CH[name]();
      }
      // level end: a boss arena or a run-up to the flag
      if (isBossLevel(idx)) {
        fillGround(x, x + 4, gy); x += 4;
        const aw = 24;
        fillGround(x, x + aw + 2, gy);
        lv.boss = { x: x + aw - 6, y: gy, hp: 3 + ((idx / LEVELS_PER_WORLD) | 0), phase: 0 };
        lv.gate = { x: x + aw, y0: gy, h: 6 };
        for (let y = gy; y < gy + 6; y++) { set(x + aw, y, T.GATE); set(x + aw + 1, y, T.GATE); }
        coinRow(x + 3, 6, gy + 3);
        x += aw + 2;
      }
      fillGround(x, x + 6, gy);
      for (let i = 0; i < 4; i++) { for (let y = gy; y <= gy + i; y++) set(x + 6 + i, y, T.STONE); }
      fillGround(x + 6, x + 10, gy);
      fillGround(x + 10, x + 22, gy);
      lv.flagX = x + 16;
      lv.W = Math.min(W, x + 22);
      lv.coinsTotal = lv.coins.length;
      lv.par = Math.round(lv.W / 6.5 * 1.35 + 20 + d * 25);
      return lv;
    }

    // =====================================================================
    // 8. Building a level into meshes.
    // =====================================================================
    const world = { group: null, tiles: {}, coinMesh: null, coinFree: [], backdrop: null, movers: [], enemies: [], items: [], springs: [], snappers: [], flag: null, cpFlag: null, boss: null, gateTiles: [] };
    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _e = new THREE.Euler();
    const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
    function tileAt(x, y) { if (!L) return T.EMPTY; x = Math.floor(x); y = Math.floor(y); if (x < 0 || x >= L.W || y >= H || y < 0) return T.EMPTY; return L.grid[y * L.stride + x]; }
    function setTile(x, y, t) { L.grid[y * L.stride + x] = t; }
    function isSolid(x, y) { return SOLID.has(tileAt(x, y)); }

    function disposeLevel() {
      if (!world.group) return;
      scene.remove(world.group);
      world.group.traverse((o) => { if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); if (o.material && !(o.material.userData && o.material.userData.shared)) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); } } });
      world.group = null; world.tiles = {}; world.movers = []; world.enemies = []; world.items = []; world.springs = []; world.snappers = []; world.flag = null; world.cpFlag = null; world.boss = null; world.gateTiles = [];
    }
    function buildLevel(lv) {
      disposeLevel();
      L = lv;
      const w = lv.w, tex = tileTextures(w);
      const g = new THREE.Group(); world.group = g; scene.add(g);
      // sky, fog, light
      scene.fog.color.setHex(w.fog); scene.background = texture(paint(8, 128, (gg, ww, hh) => { for (let y = 0; y < hh; y++) { const t = y / (hh - 1); const c = t < 0.6 ? mixHex(w.sky[0], w.sky[1], t / 0.6) : mixHex(w.sky[1], w.sky[2], (t - 0.6) / 0.4); gg.fillStyle = hex(c); gg.fillRect(0, y, ww, 1); } })) || new THREE.Color(w.sky[1]);
      renderer.setClearColor(w.fog, 1);
      hemi.groundColor.setHex(mixHex(w.ground, 0xffffff, 0.3)); hemi.intensity = w.id === 2 ? 0.9 : 1.15; sun.intensity = w.id === 2 ? 1.1 : 1.35;
      // count tiles per type
      const counts = {}; for (let y = 0; y < H; y++) for (let x = 0; x < lv.W; x++) { const t = lv.grid[y * lv.stride + x]; if (t) counts[t] = (counts[t] || 0) + 1; }
      const mk = (t, geo, material, count, cast, recv) => { const im = new THREE.InstancedMesh(geo, material, Math.max(1, count)); im.castShadow = !!cast; im.receiveShadow = !!recv; im.count = Math.max(1, count); im.frustumCulled = false; for (let i = 0; i < im.count; i++) im.setMatrixAt(i, HIDE); g.add(im); world.tiles[t] = { im, n: 0, index: {} }; return im; };
      mk("ground", GEO.rbox, mat(w.ground), (counts[T.GROUND] || 0) + lv.W * 2, true, true);
      mk("cap", GEO.cap, mat(w.grass), counts[T.GROUND] || 0, true, true);
      mk("lip", GEO.lip, mat(w.grassDark), counts[T.GROUND] || 0, false, true);
      const soft = (t) => { const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0 }); m.userData.shared = true; return m; };
      mk(T.BRICK, GEO.rblock, tex.brick ? soft(tex.brick) : mat(w.brick), counts[T.BRICK] || 0, true, true);
      mk(T.QUESTION, GEO.rblock, tex.question ? soft(tex.question) : mat(0xffc93a), counts[T.QUESTION] || 0, true, true);
      mk(T.USED, GEO.rblock, tex.used ? soft(tex.used) : mat(0xb08a6a), (counts[T.QUESTION] || 0) + (counts[T.BRICK] || 0), true, true);
      mk(T.STONE, GEO.rbox, mat(mixHex(w.ground, 0x9aa0a8, 0.55)), (counts[T.STONE] || 0) + (counts[T.GATE] || 0), true, true);
      mk(T.PLAT, GEO.plat, mat(mixHex(w.accent, 0xffffff, 0.25)), counts[T.PLAT] || 0, true, true);
      mk(T.SPIKE, GEO.spike, mat(0xe8ecf4, { roughness: 0.6 }), counts[T.SPIKE] || 0, true, false);
      mk(T.LAVA, GEO.tile, mat(0xff7a2a, { emissive: 0xff3a00, emissiveIntensity: 0.8 }), counts[T.LAVA] || 0, false, false);
      const place = (key, x, y, yOff, rot) => { const tt = world.tiles[key]; if (!tt) return -1; const i = tt.n++; _p.set(x + 0.5, y + 0.5 + (yOff || 0), 0); _e.set(0, rot || 0, 0); _q.setFromEuler(_e); _m4.compose(_p, _q, _s); tt.im.setMatrixAt(i, _m4); tt.index[x + "," + y] = i; return i; };
      for (let y = 0; y < H; y++) for (let x = 0; x < lv.W; x++) {
        const t = lv.grid[y * lv.stride + x];
        if (!t) continue;
        if (t === T.GROUND) { const above = y + 1 < H ? lv.grid[(y + 1) * lv.stride + x] : 0; place("ground", x, y); if (y === 0) { place("ground", x, -1); place("ground", x, -2); } if (!SOLID.has(above)) { place("cap", x, y, 0.5); place("lip", x, y, 0.3); } }
        else if (t === T.PIPE) continue;
        else if (t === T.GATE) { const i = place(T.STONE, x, y); world.gateTiles.push({ x, y, i }); }
        else if (t === T.SPIKE) place(T.SPIKE, x, y, -0.05, Math.PI / 4);
        else if (t === T.PLAT) place(T.PLAT, x, y, 0.3);
        else place(t, x, y);
      }
      for (const k in world.tiles) world.tiles[k].im.instanceMatrix.needsUpdate = true;
      // pipes
      for (const p of lv.pipes) { const pm = buildPipe(p.h, w.id === 1 ? 0xd8b060 : w.id === 3 ? 0x6a6a8a : 0x3cb44a); pm.position.set(p.x, p.y, 0); g.add(pm); }
      // coins: one instanced mesh
      const coinMesh = new THREE.InstancedMesh(GEO.coin, new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xa06a00, emissiveIntensity: 0.5, flatShading: false }), Math.max(1, lv.coins.length));
      coinMesh.castShadow = true; coinMesh.frustumCulled = false; g.add(coinMesh); world.coinMesh = coinMesh;
      lv.coins.forEach((c, i) => { c.slot = i; c.spin = rnd(0, 6); });
      // entities
      for (const e of lv.enemies) {
        const m = e.type === "grump" ? buildGrump(w.id === 1 ? 0xc98a3a : w.id === 2 ? 0x6a5a8a : w.id === 3 ? 0x8a5a6a : 0xb8743a) : e.type === "roller" ? buildRoller(w.id === 2 ? 0x5a8aff : w.id === 3 ? 0xff5a4a : 0x3cb44a) : buildFlap(w.id === 2 ? 0x8a6aff : 0xb57bff);
        m.position.set(e.x, e.y, 0); g.add(m);
        world.enemies.push(Object.assign({ mesh: m, alive: true, vx: 0, vy: 0, w: e.type === "flap" ? 0.6 : 0.8, h: 0.7, shell: false, sliding: 0, t: rnd(0, 6), squish: 0, dir: e.dir, stunT: 0 }, e));
      }
      for (const sn of lv.snappers) { const m = buildSnapper(); m.position.set(sn.x, sn.y - 1.4, 0); g.add(m); world.snappers.push(Object.assign({ mesh: m, up: 0 }, sn)); }
      for (const mv of lv.movers) {
        const m = mesh(new THREE.BoxGeometry(mv.w, 0.45, 1.3), mat(mixHex(w.accent, 0xffffff, 0.1), { flatShading: false }), true, true);
        const rail = mesh(GEO.box, mat(0x5a5a6a)); rail.scale.set(0.1, 0.3, 0.1); rail.position.y = -0.3; m.add(rail);
        m.position.set(mv.x, mv.y, 0); g.add(m); world.movers.push(Object.assign({ mesh: m, px: mv.x, py: mv.y, dx: 0, dy: 0 }, mv));
      }
      for (const sp of lv.springs) { const m = buildSpring(); m.position.set(sp.x, sp.y, 0); g.add(m); world.springs.push(Object.assign({ mesh: m, t: 0 }, sp)); }
      const flag = buildFlag(true); flag.position.set(lv.flagX + 0.5, tileTop(lv.flagX), 0); g.add(flag); world.flag = flag;
      if (lv.checkpoint) { const cp = buildFlag(false, 0x5cc2ff); cp.position.set(lv.checkpoint + 0.5, tileTop(lv.checkpoint), 0); g.add(cp); world.cpFlag = cp; }
      if (lv.boss) { const bm = buildBoss(w.id === 0 ? 0x8a3a8a : w.id === 1 ? 0xb8541a : w.id === 2 ? 0x3a3a8a : 0x8a1a2a); bm.position.set(lv.boss.x, lv.boss.y, 0); g.add(bm); world.boss = Object.assign({ mesh: bm, alive: true, vx: 0, vy: 0, w: 1.7, h: 1.5, dir: -1, jumpT: 2, stunT: 0, hitT: 0, squish: 0 }, lv.boss); }
      world.backdrop = buildBackdrop(w, lv.W, lv); g.add(world.backdrop);
    }
    function tileTop(x) { for (let y = H - 1; y >= 0; y--) if (SOLID.has(L.grid[y * L.stride + x])) return y + 1; return 0; }
    function coinShow(c) { if (c.slot < 0) return; _p.set(c.x, c.y, 0); _e.set(Math.PI / 2, c.spin, 0, "YXZ"); _q.setFromEuler(_e); _m4.compose(_p, _q, _s); world.coinMesh.setMatrixAt(c.slot, _m4); }
    function coinHide(c) { if (c.slot >= 0) { world.coinMesh.setMatrixAt(c.slot, HIDE); } }
    function tileInstance(t, x, y) { const tt = world.tiles[t]; if (!tt) return null; const i = tt.index[x + "," + y]; return i == null ? null : { tt, i }; }
    function moveTileInstance(t, x, y, yOff) { const r = tileInstance(t, x, y); if (!r) return; _p.set(x + 0.5, y + 0.5 + yOff, 0); _q.identity(); _m4.compose(_p, _q, _s); r.tt.im.setMatrixAt(r.i, _m4); r.tt.im.instanceMatrix.needsUpdate = true; }
    function hideTileInstance(t, x, y) { const r = tileInstance(t, x, y); if (!r) return; r.tt.im.setMatrixAt(r.i, HIDE); r.tt.im.instanceMatrix.needsUpdate = true; }
    function showUsed(x, y) { const tt = world.tiles[T.USED]; const i = tt.n++; _p.set(x + 0.5, y + 0.5, 0); _q.identity(); _m4.compose(_p, _q, _s); tt.im.setMatrixAt(i, _m4); tt.index[x + "," + y] = i; tt.im.instanceMatrix.needsUpdate = true; }

    // =====================================================================
    // 9. The hero, input, physics.
    // =====================================================================
    const P = { x: 3.5, y: 3, vx: 0, vy: 0, w: 0.62, h: 0.9, face: 1, grounded: false, coyote: 0, jumpBuf: 0, jumpHeld: false, jumpT: 0, big: false, star: 0, invuln: 0, dead: false, deadT: 0, onMover: null, squash: 1, stretch: 1, runT: 0, flagT: -1, sliding: 0 };
    const RUN = 6.6, ACC = 42, AIR = 28, FRIC = 34, GRAV = 38, JUMP = 13, JUMP_HOLD = 0.26, JUMP_MIN = 6.5, STOMP = 9, COYOTE = 0.12, BUFFER = 0.16;
    let bloop = null;
    const input = { left: false, right: false, jump: false, jumpPressed: false };
    let coach = 0;   // 0 off · 1 waiting for a run · 2 waiting for a jump
    const pads = { move: null, jump: null };
    function padZone(e) { return e.offsetX < ctx.width * 0.5 ? "move" : "jump"; }
    ctx.listen(canvas, "pointerdown", (e) => {
      if (state !== "play") return;
      firstGesture();
      const z = padZone(e);
      if (coach === 1 && z === "move") { coach = 2; el.coachRun.classList.remove("show"); el.coachJump.classList.add("show"); }
      else if (coach === 2 && z === "jump") { coach = 0; el.coachJump.classList.remove("show"); S.hint = 1; save(); el.hint.classList.remove("show"); }
      if (z === "move" && !pads.move) { pads.move = { id: e.pointerId, x0: e.clientX, ox: e.offsetX }; setMove(padDir(e.offsetX)); }
      else if (z === "jump" && !pads.jump) { pads.jump = { id: e.pointerId }; input.jump = true; input.jumpPressed = true; el.jumpBtn.classList.add("on"); }
    });
    ctx.listen(canvas, "pointermove", (e) => {
      if (pads.move && e.pointerId === pads.move.id) { pads.move.ox += e.clientX - pads.move.x0; pads.move.x0 = e.clientX; setMove(padDir(pads.move.ox)); }
    });
    const up = (e) => {
      if (pads.move && e.pointerId === pads.move.id) { pads.move = null; setMove(0); }
      if (pads.jump && e.pointerId === pads.jump.id) { pads.jump = null; input.jump = false; el.jumpBtn.classList.remove("on"); }
    };
    ctx.listen(canvas, "pointerup", up); ctx.listen(canvas, "pointercancel", up);
    // The pad's centre is where left becomes right; touching either side runs that way, sliding across flips it.
    function padDir(ox) { const cx = sa.left + 18 + 75; return ox < cx - 6 ? -1 : ox > cx + 6 ? 1 : 0; }
    function setMove(d) { input.left = d < 0; input.right = d > 0; el.padL.classList.toggle("on", d < 0); el.padR.classList.toggle("on", d > 0); }
    function clearInput() { pads.move = null; pads.jump = null; setMove(0); input.jump = false; input.jumpPressed = false; el.jumpBtn.classList.remove("on"); }
    function hideCoach() { coach = 0; el.coachRun.classList.remove("show"); el.coachJump.classList.remove("show"); }
    // keyboard for desktop testing
    ctx.listen(window, "keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "a") setMove(-1); if (e.key === "ArrowRight" || e.key === "d") setMove(1); if (e.key === " " || e.key === "ArrowUp" || e.key === "w") { if (!input.jump) input.jumpPressed = true; input.jump = true; } });
    ctx.listen(window, "keyup", (e) => { if (e.key === "ArrowLeft" || e.key === "a" || e.key === "ArrowRight" || e.key === "d") setMove(0); if (e.key === " " || e.key === "ArrowUp" || e.key === "w") input.jump = false; });

    // ---- grid collision for an AABB (x centre, y feet) --------------------------
    function solidAtBox(x0, x1, y0, y1) {
      for (let cx = Math.floor(x0); cx <= Math.floor(x1 - 1e-4); cx++) for (let cy = Math.floor(y0); cy <= Math.floor(y1 - 1e-4); cy++) if (isSolid(cx, cy)) return true;
      return false;
    }
    function hazardAtBox(x0, x1, y0, y1) {
      for (let cx = Math.floor(x0); cx <= Math.floor(x1 - 1e-4); cx++) for (let cy = Math.floor(y0); cy <= Math.floor(y1 - 1e-4); cy++) { const t = tileAt(cx, cy); if (t === T.SPIKE || t === T.LAVA) return t; }
      return 0;
    }
    // Move an entity through the grid, resolving each axis separately. Returns hit flags.
    function moveBody(b, dt, opts) {
      const hw = b.w / 2;
      const res = { ground: false, ceil: false, wall: false, headTile: null };
      // horizontal
      let nx = b.x + b.vx * dt;
      if (solidAtBox(nx - hw, nx + hw, b.y + 0.05, b.y + b.h - 0.05)) {
        // step back to the wall
        if (b.vx > 0) nx = Math.floor(nx + hw) - hw - 1e-3; else nx = Math.ceil(nx - hw) + hw + 1e-3;
        res.wall = true; b.vx = opts && opts.bounce ? -b.vx : 0;
      }
      b.x = nx;
      // vertical
      let ny = b.y + b.vy * dt;
      if (b.vy <= 0) {
        // floor: solid tiles or one-way platforms crossed from above
        const feetY = ny, prevFeet = b.y;
        let landed = false;
        if (solidAtBox(b.x - hw + 0.05, b.x + hw - 0.05, feetY, feetY + 0.05)) { ny = Math.floor(feetY) + 1; landed = true; }
        else if (!(opts && opts.noPlat)) {
          for (let cx = Math.floor(b.x - hw + 0.05); cx <= Math.floor(b.x + hw - 0.05); cx++) {
            const cy = Math.floor(feetY);
            if (tileAt(cx, cy) === T.PLAT) { const top = cy + 0.8; if (prevFeet >= top - 0.02 && feetY <= top) { ny = top; landed = true; break; } }
          }
        }
        if (landed) { res.ground = true; b.vy = 0; }
      } else {
        const headY = ny + b.h;
        if (solidAtBox(b.x - hw + 0.08, b.x + hw - 0.08, headY - 0.05, headY)) {
          ny = Math.floor(headY) - b.h - 1e-3;
          res.ceil = true; b.vy = 0;
          // which tile did we bonk? the one nearest the centre
          const cy = Math.floor(headY); let best = null, bd = 9;
          for (let cx = Math.floor(b.x - hw + 0.08); cx <= Math.floor(b.x + hw - 0.08); cx++) if (isSolid(cx, cy)) { const dd = Math.abs(cx + 0.5 - b.x); if (dd < bd) { bd = dd; best = { x: cx, y: cy }; } }
          res.headTile = best;
        }
      }
      b.y = ny;
      return res;
    }

    // =====================================================================
    // 10. Gameplay state: run, score, timer, lives.
    // =====================================================================
    const run = { lives: 4, score: 0, coins: 0, time: 0, levelScore: 0, deaths: 0, fromCheckpoint: false, combo: 0, comboT: 0 };
    let timeNow = 0, shake = 0, hudT = 0, scoreT = 0, camX = 0, camY = 0, camInit = false, levelT = 0;
    const bumps = [];   // block bump animations
    function addScore(n, x, y) { run.score += n; run.levelScore += n; if (x != null) floatText("+" + n, x, y); }
    const floats = [];
    function floatText(text, x, y, color) {
      const d = document.createElement("div");
      d.style.cssText = "position:absolute;left:0;top:0;transform:translate(-50%,-50%);font-size:13px;font-weight:900;color:" + (color || "#ffe066") + ";text-shadow:0 1px 3px rgba(0,0,0,.6);pointer-events:none;z-index:22;";
      d.textContent = text; el.hud.appendChild(d);
      floats.push({ d, x, y, t: 0 });
    }
    const _sp = new THREE.Vector3();
    function project(x, y, z) { _sp.set(x, y, z || 0).project(camera); return { x: (_sp.x + 1) / 2 * ctx.width, y: (1 - _sp.y) / 2 * ctx.height }; }
    function updateFloats(dt) {
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i]; f.t += dt;
        if (f.t > 0.9) { f.d.remove(); floats.splice(i, 1); continue; }
        const p = project(f.x, f.y + f.t * 1.6, 0.5);
        f.d.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px) translate(-50%,-50%)"; f.d.style.opacity = String(1 - f.t / 0.9);
      }
    }
    function setPower(big) {
      P.big = big; P.h = big ? 1.5 : 0.9;
      if (bloop) { bloop.scale.setScalar(big ? 1.55 : 1); }
      el.hPower.textContent = P.star > 0 ? "⭐ star" : big ? "🍓 big" : "🔵 small";
    }
    function refreshHud() {
      el.hCoins.textContent = String(run.coins); el.hCoinsMax.textContent = String(L ? L.coinsTotal : 0);
      el.hLives.textContent = String(run.lives); el.hScore.textContent = fmt(run.score);
      el.hLevel.textContent = levelName(curLevel); el.hLevelSub.textContent = L.w.name.toUpperCase();
      el.hTimeV.textContent = String(Math.max(0, Math.ceil(run.time))); el.hTime.classList.toggle("low", run.time < 30 && run.time > 0);
      el.hProg.style.width = clamp((P.x - L.startX) / (L.flagX - L.startX), 0, 1) * 100 + "%";
      const coinsOk = L.coinsTotal === 0 || run.coins / L.coinsTotal >= 0.7, parOk = levelT <= L.par;
      el.hStars.textContent = "★" + (coinsOk ? "★" : "☆") + (parOk ? "★" : "☆");
      el.hPower.textContent = P.star > 0 ? "⭐ star" : P.big ? "🍓 big" : "🔵 small";
    }

    // ---- level flow -----------------------------------------------------------------
    function startLevel(idx, fromCheckpoint) {
      curLevel = idx;
      const lv = genLevel(idx);
      buildLevel(lv);
      if (!bloop) { bloop = buildBloop(); scene.add(bloop); }
      bloop.visible = true;
      const cpX = fromCheckpoint && lv.checkpoint ? lv.checkpoint + 0.5 : lv.startX;
      P.x = cpX; P.y = fromCheckpoint && lv.checkpoint ? tileTop(lv.checkpoint) : lv.startY; P.vx = 0; P.vy = 0; P.face = 1; P.grounded = true; P.dead = false; P.deadT = 0; P.star = 0; P.invuln = 0; P.flagT = -1; P.onMover = null;
      setPower(fromCheckpoint ? P.big : false);
      run.coins = 0; run.levelScore = 0; run.time = Math.round(lv.par * 1.8); run.fromCheckpoint = !!fromCheckpoint; run.combo = 0; levelT = 0;
      for (const c of lv.coins) coinShow(c); world.coinMesh.instanceMatrix.needsUpdate = true;
      camInit = false; clearInput();
      state = "play";
      refreshHud();
      el.hud.classList.remove("bh-hidden"); el.ctl.classList.remove("bh-hidden"); el.menu.classList.add("bh-hidden");
      if (!S.hint) { el.hint.classList.add("show"); ctx.timeout(() => el.hint.classList.remove("show"), 6000); el.coachRun.classList.add("show"); coach = 1; }
      bed(lv.w.music, 0.22);
      try { ctx.platform.setProgress(idx / N_LEVELS); ctx.platform.interact({ type: "level_start", level: idx }); } catch (_) {}
    }
    function showLivesCard(idx, then) {
      el.livesText.textContent = levelName(idx) + " · " + levelWorld(idx).name.toUpperCase();
      el.livesIcon.textContent = "🟢 × " + run.lives;
      el.livesCard.classList.remove("bh-hidden");
      el.fade.classList.add("on");
      ctx.timeout(() => { then(); ctx.timeout(() => { el.fade.classList.remove("on"); el.livesCard.classList.add("bh-hidden"); }, 500); }, 1100);
    }
    function beginCampaign(idx) { run.lives = 4; run.score = 0; run.deaths = 0; showLivesCard(idx, () => startLevel(idx, false)); }
    function die(cause) {
      if (P.dead) return;
      P.dead = true; P.deadT = 0; P.vy = 11; P.vx = 0; P.star = 0;
      run.deaths += 1; run.combo = 0;
      sfx.die(); haptic("error"); flash(el.flashHurt); shake = 0.6;
      clearInput();
      try { ctx.platform.fail({ cause, level: curLevel, score: run.score }); } catch (_) {}
      ctx.timeout(() => {
        run.lives -= 1;
        if (run.lives <= 0) { gameOver(); return; }
        const cp = P.x > (L.checkpoint || 0) + 1 && L.checkpoint > 0;
        showLivesCard(curLevel, () => startLevel(curLevel, cp));
      }, 1600);
    }
    function gameOver() {
      state = "over";
      el.hud.classList.add("bh-hidden"); el.ctl.classList.add("bh-hidden");
      const best = run.score > S.bestScore;
      if (best) S.bestScore = run.score;
      save(); submitRecords();
      el.overPanel.innerHTML = `<div class="big">💀</div><h2>Game over</h2><div class="sub">${levelName(curLevel)} · ${esc(L.w.name)}</div>
        ${best ? '<div class="bh-stars" style="font-size:14px;letter-spacing:1px;color:#b8541a;">★ NEW BEST SCORE ★</div>' : ""}
        <div class="bh-stat"><span>Score</span><b>${fmt(run.score)}</b></div><div class="bh-stat"><span>Best</span><b>${fmt(S.bestScore)}</b></div>
        <div style="height:6px;"></div><button class="bh-btn" id="btnOverRetry">Try again</button><button class="bh-btn ghost" id="btnOverMenu" style="margin:0;color:#1c3a7a;border-color:rgba(28,58,122,.3);">Menu</button>`;
      el.over.classList.remove("bh-hidden");
      ctx.listen(el.overPanel.querySelector("#btnOverRetry"), "click", () => { sfx.ui(); el.over.classList.add("bh-hidden"); beginCampaign(curLevel); });
      ctx.listen(el.overPanel.querySelector("#btnOverMenu"), "click", () => { sfx.ui(); el.over.classList.add("bh-hidden"); showMenu(); });
      try { ctx.platform.complete({ cause: "game_over", score: run.score, level: curLevel }); } catch (_) {}
    }
    function submitRecords() {
      try {
        ctx.platform.setScore(Math.floor(S.bestScore));
        ctx.memory.record("score").submit(Math.floor(S.bestScore), { label: fmt(S.bestScore) + " pts" }).catch(() => {});
        ctx.memory.record("stars").submit(S.totalStars, { label: S.totalStars + " ★" }).catch(() => {});
      } catch (_) {}
    }
    function levelClear(flagFrac) {
      state = "clear";
      const timeBonus = Math.max(0, Math.ceil(run.time)) * 10;
      const heightBonus = Math.round(flagFrac * 4) * 500 + 500;
      addScore(timeBonus + heightBonus);
      const coinsOk = L.coinsTotal === 0 || run.coins / L.coinsTotal >= 0.7;
      const parOk = levelT <= L.par;
      const stars = 1 + (coinsOk ? 1 : 0) + (parOk ? 1 : 0);
      const prevStars = S.stars[curLevel] || 0;
      S.stars[curLevel] = Math.max(prevStars, stars);
      S.totalStars = S.stars.reduce((a, b) => a + b, 0);
      S.best[curLevel] = Math.max(S.best[curLevel] || 0, run.levelScore);
      if (curLevel + 1 < N_LEVELS) S.unlocked = Math.max(S.unlocked, curLevel + 1);
      const best = run.score > S.bestScore; if (best) S.bestScore = run.score;
      save(); submitRecords(); refreshMenu();
      sfx.clear(); confetti(); haptic("success");
      el.hud.classList.add("bh-hidden"); el.ctl.classList.add("bh-hidden");
      const last = curLevel + 1 >= N_LEVELS;
      el.clearPanel.innerHTML = `<div class="big">🏁</div><h2>${last ? "Kingdom cleared!" : "Level clear!"}</h2><div class="sub">${levelName(curLevel)} · ${esc(L.w.name)}${isBossLevel(curLevel) ? " · boss beaten" : ""}</div>
        <div class="bh-stars"><i class="${stars >= 1 ? "on" : ""}" style="animation-delay:.1s">⭐</i><i class="${stars >= 2 ? "on" : ""}" style="animation-delay:.4s">⭐</i><i class="${stars >= 3 ? "on" : ""}" style="animation-delay:.7s">⭐</i></div>
        <div class="bh-starline">cleared ✓ · coins ${run.coins}/${L.coinsTotal} ${coinsOk ? "✓" : "✗ (need 70%)"} · time ${Math.round(levelT)}s / par ${L.par}s ${parOk ? "✓" : "✗"}</div>
        <div class="bh-stat"><span>Flag bonus</span><b>+${fmt(heightBonus)}</b></div><div class="bh-stat"><span>Time bonus</span><b>+${fmt(timeBonus)}</b></div><div class="bh-stat"><span>Score</span><b>${fmt(run.score)}</b></div>
        ${best ? '<div class="bh-starline" style="color:#b8541a;font-weight:900;">★ NEW BEST SCORE ★</div>' : ""}
        <div style="height:4px;"></div>
        ${last ? "" : '<button class="bh-btn green" id="btnNext">Next level ▶</button>'}
        <button class="bh-btn ghost" id="btnClearLevels" style="color:#1c3a7a;border-color:rgba(28,58,122,.3);">Levels</button>
        <button class="bh-btn ghost" id="btnClearMenu" style="margin:0;color:#1c3a7a;border-color:rgba(28,58,122,.3);">Menu</button>`;
      el.clear.classList.remove("bh-hidden");
      const nb = el.clearPanel.querySelector("#btnNext"); if (nb) ctx.listen(nb, "click", () => { sfx.ui(); el.clear.classList.add("bh-hidden"); showLivesCard(curLevel + 1, () => startLevel(curLevel + 1, false)); });
      ctx.listen(el.clearPanel.querySelector("#btnClearLevels"), "click", () => { sfx.ui(); el.clear.classList.add("bh-hidden"); showMenu(); openLevels(); });
      ctx.listen(el.clearPanel.querySelector("#btnClearMenu"), "click", () => { sfx.ui(); el.clear.classList.add("bh-hidden"); showMenu(); });
      try { ctx.platform.milestone("level_clear", { level: curLevel, stars }); if (last) ctx.platform.complete({ cause: "campaign", score: run.score }); } catch (_) {}
    }

    // ---- blocks --------------------------------------------------------------------------
    function bonk(tx, ty) {
      const t = tileAt(tx, ty);
      const cx = tx + 0.5, cy = ty + 1;
      if (t === T.QUESTION) {
        const content = L.qContent[tx + "," + ty] || "coin";
        setTile(tx, ty, T.USED); hideTileInstance(T.QUESTION, tx, ty); showUsed(tx, ty);
        bumps.push({ t: T.USED, x: tx, y: ty, time: 0 });
        sfx.bump(); haptic("light");
        if (content === "coin") { run.coins += 1; addScore(200, cx, cy + 0.5); sfx.coin(); emit(cx, cy + 0.6, 6, { color: [1, 0.85, 0.3], spread: 1.5, up: 5, size: 0.35, life: 0.5 }); L.coinsTotal = Math.max(L.coinsTotal, run.coins); }
        else spawnItem(content, cx, cy);
        // enemies standing on the block get launched
        for (const e of world.enemies) if (e.alive && Math.abs(e.x - cx) < 0.9 && Math.abs(e.y - cy) < 0.3) killEnemy(e, "bump");
      } else if (t === T.BRICK) {
        if (P.big) {
          setTile(tx, ty, T.EMPTY); hideTileInstance(T.BRICK, tx, ty);
          sfx.brick(); haptic("medium"); addScore(50, cx, cy + 0.5); shake = 0.2;
          emit(cx, cy - 0.5, 10, { color: [0.78, 0.4, 0.22], spread: 3, up: 7, size: 0.45, life: 0.8, g: 18 });
          for (const e of world.enemies) if (e.alive && Math.abs(e.x - cx) < 0.9 && Math.abs(e.y - cy) < 0.3) killEnemy(e, "bump");
        } else { bumps.push({ t: T.BRICK, x: tx, y: ty, time: 0 }); sfx.bump(); haptic("light"); for (const e of world.enemies) if (e.alive && Math.abs(e.x - cx) < 0.9 && Math.abs(e.y - cy) < 0.3) killEnemy(e, "bump"); for (const c of L.coins) if (!c.taken && Math.abs(c.x - cx) < 0.6 && Math.abs(c.y - cy - 0.5) < 0.6) collectCoin(c); }
      } else { sfx.bump(); }
    }
    function updateBumps(dt) {
      for (let i = bumps.length - 1; i >= 0; i--) {
        const b = bumps[i]; b.time += dt;
        const off = Math.sin(Math.min(1, b.time / 0.28) * Math.PI) * 0.4;
        moveTileInstance(b.t, b.x, b.y, off);
        if (b.time >= 0.28) { moveTileInstance(b.t, b.x, b.y, 0); bumps.splice(i, 1); }
      }
    }
    function spawnItem(kind, x, y) {
      const m = buildItem(kind); m.position.set(x, y, 0); world.group.add(m);
      world.items.push({ kind, x, y, vx: kind === "star" ? 3 : kind === "heart" ? 0 : 2.6, vy: 6, mesh: m, w: 0.6, h: 0.6, rise: 0.5, t: 0 });
      sfx.powerup();
      floatText(kind === "berry" ? "BERRY!" : kind === "star" ? "STAR!" : "1-UP!", x, y + 1.2, "#fff");
    }
    function collectCoin(c) {
      c.taken = true; coinHide(c); run.coins += 1; addScore(100); sfx.coin(); haptic("light");
      emit(c.x, c.y, 5, { color: [1, 0.85, 0.3], spread: 1.2, up: 3, size: 0.3, life: 0.4 });
    }
    function killEnemy(e, how) {
      if (!e.alive) return;
      e.alive = false; e.deadT = 0; e.vy = how === "stomp" ? 0 : 8; e.vx = how === "stomp" ? 0 : (P.x < e.x ? 4 : -4);
      run.combo = how === "stomp" ? run.combo + 1 : run.combo; run.comboT = 1.2;
      const pts = how === "stomp" ? [100, 200, 400, 800, 1000][Math.min(4, run.combo - 1)] : 200;
      addScore(pts, e.x, e.y + 1);
      if (run.combo >= 5 && how === "stomp") { run.lives += 1; sfx.oneUp(); floatText("1-UP!", e.x, e.y + 1.8, "#7ee8a2"); refreshHud(); }
      emit(e.x, e.y + 0.4, 8, { color: [1, 1, 1], spread: 2.5, up: 4, size: 0.35, life: 0.5 });
    }
    function hurt(cause) {
      if (P.invuln > 0 || P.star > 0 || P.dead) return;
      if (P.big) { setPower(false); P.invuln = 1.6; sfx.hurt(); haptic("medium"); flash(el.flashHurt); shake = 0.3; toast("Ouch! Small again"); return; }
      die(cause);
    }

    // =====================================================================
    // 11. Per-frame simulation.
    // =====================================================================
    function updatePlayer(dt) {
      if (P.dead) {
        P.deadT += dt; P.vy -= GRAV * dt; P.y += P.vy * dt;
        bloop.position.set(P.x, P.y, 0); bloop.rotation.z += dt * 6; bloop.scale.setScalar(P.big ? 1.55 : 1);
        return;
      }
      if (P.flagT >= 0) {
        // sliding down the pole, then walking off
        P.flagT += dt;
        const poleTop = tileTop(L.flagX) + 8.2, bottom = tileTop(L.flagX);
        if (P.flagT < 1.3) { P.y = Math.max(bottom, P.y - dt * 7); P.x = L.flagX + 0.5 - 0.45; }
        else { P.x += dt * 4; P.face = 1; P.y = tileTop(Math.floor(P.x)); P.runT += dt * 12; }
        bloop.position.set(P.x, P.y, 0); bloop.rotation.y = P.face > 0 ? 0.35 : -0.35;
        if (world.flag) world.flag.userData.flag.position.y = Math.max(0.8, world.flag.userData.flag.position.y - dt * 6);
        return;
      }
      // horizontal
      const want = input.left ? -1 : input.right ? 1 : 0;
      const acc = P.grounded ? ACC : AIR;
      if (want !== 0) { P.vx += want * acc * dt; P.face = want; }
      else if (P.grounded) { const f = FRIC * dt; if (Math.abs(P.vx) <= f) P.vx = 0; else P.vx -= Math.sign(P.vx) * f; }
      else P.vx *= Math.max(0, 1 - dt * 1.2);
      const maxRun = RUN * (P.star > 0 ? 1.25 : 1);
      P.vx = clamp(P.vx, -maxRun, maxRun);
      // jump: buffer + coyote + variable height
      if (input.jumpPressed) { P.jumpBuf = BUFFER; input.jumpPressed = false; }
      P.jumpBuf -= dt; P.coyote = P.grounded ? COYOTE : P.coyote - dt;
      if (P.jumpBuf > 0 && P.coyote > 0) {
        P.vy = JUMP; P.grounded = false; P.coyote = 0; P.jumpBuf = 0; P.jumpT = 0; P.onMover = null;
        sfx.jump(P.big); haptic("light"); P.stretch = 1.35; P.squash = 0.8;
        emit(P.x, P.y, 4, { color: [1, 1, 1], spread: 1.2, up: 1, size: 0.3, life: 0.3, g: 4 });
      }
      if (P.vy > 0 && input.jump && P.jumpT < JUMP_HOLD) { P.jumpT += dt; P.vy -= GRAV * 0.4 * dt; }
      else { P.vy -= GRAV * dt; if (!P.grounded) P.jumpT = JUMP_HOLD; }
      if (!input.jump && P.vy > JUMP_MIN && P.jumpT < JUMP_HOLD) P.vy = JUMP_MIN;   // let go early: a short hop, never a stub
      P.vy = Math.max(P.vy, -22);
      if (P._base != null) P._apex = Math.max(P._apex || 0, P.y - P._base);
      // scripted jumps for the harness: exact hold time in simulation seconds
      if (P._auto && P.grounded && P._auto.pending) { P._auto.pending = false; P._base = P.y; P._apex = 0; input.jumpPressed = true; input.jump = true; P._auto.left = P._auto.hold; }
      else if (P._auto && !P._auto.pending && P._auto.left != null) { P._auto.left -= dt; if (P._auto.left <= 0) { input.jump = false; P._auto.left = null; } }
      const wasGrounded = P.grounded, prevVy = P.vy;
      // ride movers
      if (P.onMover) { P.x += P.onMover.dx; P.y += P.onMover.dy; }
      const res = moveBody(P, dt);
      P.grounded = res.ground;
      if (res.headTile && prevVy > 2) bonk(res.headTile.x, res.headTile.y);
      // movers: land on them
      P.onMover = null;
      if (P.vy <= 0) for (const m of world.movers) {
        const top = m.py + 0.22;
        if (Math.abs(P.x - m.px) < m.w / 2 + P.w / 2 - 0.1 && P.y <= top + 0.05 && P.y - P.vy * dt >= top - 0.35 && P.y > top - 0.5) { P.y = top; P.vy = 0; P.grounded = true; P.onMover = m; }
      }
      if (P.grounded && !wasGrounded) { sfx.land(); P.squash = 0.7; P.stretch = 1.25; emit(P.x, P.y, 5, { color: [1, 1, 1], spread: 1.5, up: 1.2, size: 0.3, life: 0.35, g: 5 }); }
      // springs
      for (const sp of world.springs) {
        if (Math.abs(P.x - sp.x) < 0.6 && P.y <= sp.y + 0.7 && P.y > sp.y - 0.3 && P.vy <= 0) { P.vy = JUMP * 1.55; P.grounded = false; P.jumpT = JUMP_HOLD; sp.t = 0.3; sfx.spring(); haptic("medium"); P.stretch = 1.5; P.squash = 0.6; }
      }
      // hazards and falling
      const hz = hazardAtBox(P.x - P.w / 2 + 0.1, P.x + P.w / 2 - 0.1, P.y + 0.02, P.y + 0.4);
      if (hz === T.LAVA) { if (P.star <= 0) die("lava"); else P.vy = 8; }
      else if (hz === T.SPIKE) hurt("spikes");
      if (P.y < -3) die("fall");
      // coins
      for (const c of L.coins) if (!c.taken && Math.abs(c.x - P.x) < 0.6 && c.y > P.y - 0.2 && c.y < P.y + P.h + 0.2) collectCoin(c);
      // timers
      P.invuln = Math.max(0, P.invuln - dt);
      if (P.star > 0) { P.star -= dt; if (P.star <= 0) { P.star = 0; el.hPower.textContent = P.big ? "🍓 big" : "🔵 small"; toast("Star faded"); } }
      // checkpoint and flag
      if (L.checkpoint && !run.fromCheckpoint && P.x > L.checkpoint + 0.5) { run.fromCheckpoint = true; sfx.checkpoint(); haptic("light"); toast("🚩 Checkpoint"); if (world.cpFlag) world.cpFlag.userData.flag.material.color.setHex(0xffd35a); addScore(300, L.checkpoint + 0.5, tileTop(L.checkpoint) + 4); }
      if (P.x > L.flagX + 0.05 && P.x < L.flagX + 1.2 && P.flagT < 0) {
        const frac = clamp((P.y - tileTop(L.flagX)) / 8.2, 0, 1);
        P.flagT = 0; P.vx = 0; P.vy = 0; clearInput(); sfx.flag(); haptic("success"); flash(el.flashGood);
        if (frac > 0.9) { bigText("TOP OF THE POLE!", "+2,500", 1400); addScore(2500); } else addScore(Math.round(frac * 4) * 500 + 500, L.flagX + 0.5, P.y + 1);
        ctx.timeout(() => levelClear(frac), 2600);
      }
      // ---- pose ---------------------------------------------------------------
      bloop.position.set(P.x, P.y, 0);
      P.squash += (1 - P.squash) * Math.min(1, dt * 10); P.stretch += (1 - P.stretch) * Math.min(1, dt * 10);
      const s = P.big ? 1.55 : 1;
      bloop.scale.set(s * P.squash, s * P.stretch, s * P.squash);
      bloop.rotation.y += ((P.face > 0 ? 0.35 : -0.35) - bloop.rotation.y) * Math.min(1, dt * 12);
      bloop.rotation.z = -P.vx * 0.03;
      const u = bloop.userData;
      if (P.grounded && Math.abs(P.vx) > 0.5) { P.runT += dt * (6 + Math.abs(P.vx) * 1.5); u.feet[0].position.y = 0.06 + Math.max(0, Math.sin(P.runT)) * 0.14; u.feet[1].position.y = 0.06 + Math.max(0, Math.sin(P.runT + Math.PI)) * 0.14; }
      else { u.feet[0].position.y = u.feet[1].position.y = P.grounded ? 0.06 : 0.12; }
      u.body.position.y = 0.45 + (P.grounded ? Math.sin(timeNow * 6) * 0.01 : 0.03);
      bloop.visible = P.invuln <= 0 || Math.floor(timeNow * 14) % 2 === 0;
      if (P.star > 0) { u.body.material = mat([0xff5a4a, 0xffe066, 0x5cc2ff, 0x7ee8a2][Math.floor(timeNow * 10) % 4], { flatShading: false }); if (Math.random() < dt * 20) emit(P.x + rnd(-0.3, 0.3), P.y + rnd(0, 1), 1, { color: [1, 0.9, 0.4], spread: 0.5, up: 2, size: 0.35, life: 0.4, g: 0 }); }
      else if (u.body.material.color.getHex() !== 0x5fd35a) u.body.material = mat(0x5fd35a, { flatShading: false });
    }

    function updateEnemies(dt) {
      for (const e of world.enemies) {
        const m = e.mesh;
        if (!e.alive) {
          e.deadT += dt;
          if (e.how === "stomp" || e.vy === 0 && e.deadT < 0.01) { }
          e.vy -= GRAV * dt; e.y += e.vy * dt; e.x += e.vx * dt;
          m.position.set(e.x, e.y, 0); m.scale.y = Math.max(0.15, 1 - e.deadT * 3); m.rotation.z += dt * 5;
          if (e.deadT > 1.2) { m.visible = false; }
          continue;
        }
        if (Math.abs(e.x - P.x) > 22) { continue; }   // sleep off screen
        e.t += dt;
        if (e.type === "flap") {
          e.x += e.dir * (1.6 + L.d * 1.2) * dt;
          e.y = e.base + Math.sin(e.t * 2.2 + e.phase) * e.amp;
          if (e.x < 1 || e.x > L.W - 1 || Math.abs(e.x - (e.homeX || (e.homeX = e.x))) > 5) e.dir *= -1;
          m.position.set(e.x, e.y, 0); m.rotation.y = e.dir > 0 ? 0.4 : -0.4;
          for (const w of m.userData.wings) w.rotation.z = Math.sin(e.t * 18) * 0.7 * (w.position.x > 0 ? 1 : -1);
        } else {
          const speed = e.shell ? (e.sliding ? 9.5 : 0) : (e.type === "roller" ? 1.5 : 1.8) + L.d * 1.0;
          e.vx = e.dir * speed;
          e.vy -= GRAV * dt;
          // turn at walls and, when not a shell, at ledges
          const hw = e.w / 2;
          const ahead = e.x + e.dir * (hw + 0.1);
          if (!e.shell && !isSolid(ahead, e.y - 0.5) && tileAt(ahead, e.y - 0.5) !== T.PLAT && e.grounded) e.dir *= -1;
          const res = moveBody(e, dt, { bounce: false });
          if (res.wall) { e.dir *= -1; if (e.shell && e.sliding) { sfx.bump(); } }
          e.grounded = res.ground;
          if (e.y < -3) { e.alive = false; e.deadT = 2; m.visible = false; continue; }
          m.position.set(e.x, e.y, 0); m.rotation.y = e.dir > 0 ? 0.5 : -0.5;
          if (e.shell) { m.rotation.z += e.sliding ? dt * 14 * -e.dir : 0; if (m.userData.head) m.userData.head.visible = false; }
          else { const u = m.userData; if (u.feet) { u.feet[0].position.y = 0.05 + Math.max(0, Math.sin(e.t * 9)) * 0.1; u.feet[1].position.y = 0.05 + Math.max(0, Math.sin(e.t * 9 + Math.PI)) * 0.1; } }
          e.squish += (1 - e.squish) * Math.min(1, dt * 8); m.scale.y = e.squish;
          // shells kill other enemies
          if (e.shell && e.sliding) for (const o of world.enemies) if (o !== e && o.alive && Math.abs(o.x - e.x) < 0.8 && Math.abs(o.y - e.y) < 0.8) killEnemy(o, "shell");
        }
        // player contact
        if (P.dead || P.flagT >= 0) continue;
        const dx = Math.abs(e.x - P.x), dy = P.y - e.y;
        if (dx < (e.w + P.w) / 2 - 0.05 && P.y < e.y + e.h && P.y + P.h > e.y) {
          if (P.star > 0) { killEnemy(e, "star"); sfx.stomp(); continue; }
          const fromAbove = P.vy < 0 && dy > e.h * 0.45;
          if (fromAbove) {
            if (e.type === "roller" && !e.shell) { e.shell = true; e.sliding = 0; e.vx = 0; e.squish = 0.6; sfx.stomp(); haptic("medium"); addScore(100, e.x, e.y + 1); }
            else if (e.type === "roller" && e.shell) { if (e.sliding) { e.sliding = 0; sfx.stomp(); } else { e.sliding = 1; e.dir = P.x < e.x ? 1 : -1; sfx.kick(); } }
            else killEnemy(e, "stomp");
            if (!(e.type === "roller")) { sfx.stomp(); haptic("medium"); }
            P.vy = input.jump ? STOMP * 1.35 : STOMP; P.grounded = false; P.jumpT = JUMP_HOLD * 0.5; P.squash = 0.7; P.stretch = 1.3;
            emit(e.x, e.y + 0.5, 6, { color: [1, 1, 1], spread: 2, up: 3, size: 0.3, life: 0.4 });
          } else if (e.shell && !e.sliding) { e.sliding = 1; e.dir = P.x < e.x ? 1 : -1; sfx.kick(); haptic("light"); addScore(100, e.x, e.y + 1); }
          else hurt(e.type);
        }
      }
      if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) run.combo = 0; }
      // snappers
      for (const sn of world.snappers) {
        sn.t += dt;
        const cyc = sn.t % 4.2;
        const target = cyc < 1.6 ? 0 : cyc < 2.1 ? (cyc - 1.6) / 0.5 : cyc < 3.6 ? 1 : 1 - (cyc - 3.6) / 0.6;
        // stay down while the hero stands on the pipe
        const near = Math.abs(P.x - sn.x) < 1.4 && P.y < sn.y + 0.6 && P.y > sn.y - 1.5;
        sn.up += ((near && sn.up < 0.2 ? 0 : target) - sn.up) * Math.min(1, dt * 8);
        sn.mesh.position.set(sn.x, sn.y - 1.5 + sn.up * 1.5, 0);
        sn.mesh.userData.jaw.position.y = 0.98 - Math.abs(Math.sin(sn.t * 6)) * 0.08;
        if (!P.dead && sn.up > 0.4 && Math.abs(P.x - sn.x) < 0.55 && P.y < sn.y + sn.up * 1.5 + 0.2 && P.y + P.h > sn.y + 0.2) { if (P.star > 0) { sn.t = 0; sn.up = 0; addScore(200, sn.x, sn.y + 1); } else hurt("snapper"); }
      }
      // items
      for (let i = world.items.length - 1; i >= 0; i--) {
        const it = world.items[i]; it.t += dt;
        if (it.rise > 0) { it.rise -= dt; it.y += dt * 2; it.mesh.position.set(it.x, it.y, 0); continue; }
        it.vy -= GRAV * dt;
        const res = moveBody(it, dt, { bounce: true });
        if (res.wall) it.vx = -it.vx;
        if (res.ground && it.kind === "star") it.vy = 7;
        if (it.y < -3) { world.group.remove(it.mesh); world.items.splice(i, 1); continue; }
        it.mesh.position.set(it.x, it.y, 0); if (it.mesh.userData.spin) it.mesh.userData.spin.rotation.y += dt * 4;
        if (!P.dead && Math.abs(it.x - P.x) < 0.7 && it.y < P.y + P.h && it.y + it.h > P.y) {
          world.group.remove(it.mesh); world.items.splice(i, 1);
          if (it.kind === "berry") { if (P.big) addScore(1000, it.x, it.y + 1); else { setPower(true); sfx.grow(); haptic("success"); bigText("BIG BLOOP", "one free hit", 1200); addScore(500); } }
          else if (it.kind === "star") { P.star = 9; sfx.star(); haptic("success"); bigText("INVINCIBLE!", "run through everything", 1300); addScore(500); el.hPower.textContent = "⭐ star"; }
          else { run.lives += 1; sfx.oneUp(); haptic("success"); bigText("1-UP", "an extra life", 1200); refreshHud(); }
          flash(el.flashGood);
        }
      }
      // movers
      for (const mv of world.movers) {
        const ph = timeNow * mv.speed / Math.max(0.5, mv.range) + mv.phase;
        const nx = mv.ax === "x" ? mv.x + Math.sin(ph) * mv.range : mv.x, ny = mv.ax === "y" ? mv.y + Math.sin(ph) * mv.range : mv.y;
        mv.dx = nx - mv.px; mv.dy = ny - mv.py; mv.px = nx; mv.py = ny; mv.mesh.position.set(nx, ny, 0);
      }
      for (const sp of world.springs) { sp.t = Math.max(0, sp.t - dt); const k = 1 - Math.sin(Math.min(1, sp.t / 0.3) * Math.PI) * 0.5; sp.mesh.userData.coil.scale.y = 0.4 * k; sp.mesh.userData.top.position.y = 0.6 * k; }
      // boss
      const b = world.boss;
      if (b && b.alive) {
        b.t = (b.t || 0) + dt;
        const dx = P.x - b.x, near = Math.abs(dx) < 16 && P.x > b.x - 30;
        if (b.hitT > 0) b.hitT -= dt;
        if (b.stunT > 0) { b.stunT -= dt; b.vx = 0; }
        else if (near && !P.dead) {
          b.dir = dx > 0 ? 1 : -1;
          const spd = 2.2 + (3 - b.hp) * 0.7 + L.d * 1.2;
          b.vx = b.dir * spd;
          b.jumpT -= dt;
          if (b.jumpT <= 0 && b.grounded) { b.vy = 11 + Math.random() * 3; b.grounded = false; b.jumpT = 1.6 + Math.random() * 1.4; sfx.boss(); }
        } else b.vx = 0;
        b.vy -= GRAV * dt;
        const res = moveBody(b, dt); b.grounded = res.ground;
        if (res.wall) b.dir *= -1;
        if (res.ground && b.vy === 0 && b.landT !== true) { }
        b.mesh.position.set(b.x, b.y, 0); b.mesh.rotation.y = b.dir > 0 ? 0.5 : -0.5;
        b.squish += (1 - b.squish) * Math.min(1, dt * 8); b.mesh.scale.set(2.2, 2.2 * b.squish, 2.2);
        if (b.grounded && Math.abs(b.vx) > 0.1 && Math.random() < dt * 6) emit(b.x - b.dir * 0.8, b.y, 1, { color: [0.7, 0.6, 0.5], spread: 1, up: 1.5, size: 0.4, life: 0.4 });
        if (!P.dead && P.flagT < 0 && Math.abs(P.x - b.x) < (b.w + P.w) / 2 && P.y < b.y + b.h && P.y + P.h > b.y) {
          const fromAbove = P.vy < 0 && P.y - b.y > b.h * 0.55;
          if (fromAbove && b.hitT <= 0) {
            b.hp -= 1; b.hitT = 1.0; b.stunT = 1.3; b.squish = 0.5; P.vy = STOMP * 1.3; P.grounded = false; P.jumpT = JUMP_HOLD * 0.5;
            sfx.stomp(); haptic("heavy"); shake = 0.5; addScore(1000, b.x, b.y + 2.5);
            emit(b.x, b.y + 1, 14, { color: [1, 1, 1], spread: 3, up: 5, size: 0.4, life: 0.5 });
            if (b.hp <= 0) {
              b.alive = false; b.deadT = 0;
              addScore(5000, b.x, b.y + 3); sfx.clear(); confetti(); bigText("BOSS BEATEN!", "the gate opens", 2000); shake = 1;
              emit(b.x, b.y + 1, 30, { color: [1, 0.8, 0.3], spread: 5, up: 8, size: 0.5, life: 0.9 });
              for (const gt of world.gateTiles) { setTile(gt.x, gt.y, T.EMPTY); const tt = world.tiles[T.STONE]; tt.im.setMatrixAt(gt.i, HIDE); tt.im.instanceMatrix.needsUpdate = true; }
              emit(L.gate.x + 1, L.gate.y0 + 3, 20, { color: [0.6, 0.6, 0.7], spread: 3, up: 5, size: 0.5, life: 0.8 });
              try { ctx.platform.milestone("boss", { level: curLevel }); } catch (_) {}
            } else { toast("Boss hit! " + b.hp + " to go"); }
          } else if (P.star > 0) { /* star just bounces off */ P.vx = -b.dir * 6; }
          else if (b.hitT <= 0 && b.stunT <= 0) hurt("boss");
        }
      } else if (b && !b.alive) { b.deadT += dt; b.mesh.position.y -= dt * 2; b.mesh.rotation.z += dt * 3; if (b.deadT > 1.5) b.mesh.visible = false; }
    }

    // =====================================================================
    // 12. Camera, HUD, main loop.
    // =====================================================================
    function update(dtMs) {
      const dt = Math.min(dtMs, 50) / 1000;
      timeNow += dt;
      if (lastW !== ctx.width || lastH !== ctx.height) { lastW = ctx.width; lastH = ctx.height; resize(); }
      if (state === "play") {
        levelT += dt;
        if (P.flagT < 0 && !P.dead) { run.time -= dt; if (run.time <= 0) { run.time = 0; die("time"); } else if (run.time < 10 && Math.floor(run.time) !== Math.floor(run.time + dt)) sfx.tick(); }
        updatePlayer(dt);
        updateEnemies(dt);
        updateBumps(dt);
        // coins spin
        if (L) { for (const c of L.coins) { if (c.taken || Math.abs(c.x - P.x) > 16) continue; c.spin += dt * 3.5; coinShow(c); } world.coinMesh.instanceMatrix.needsUpdate = true; }
        if (world.flag) { world.flag.userData.flag.rotation.y = Math.sin(timeNow * 4) * 0.15; }
        if (world.backdrop) for (const c of world.backdrop.userData.clouds) c.position.x += dt * 0.25;
        hudT += dt; if (hudT > 0.15) { hudT = 0; refreshHud(); }
        scoreT += dt; if (scoreT > 1) { scoreT = 0; try { ctx.platform.setScore(Math.floor(run.score)); } catch (_) {} }
      } else if (state === "clear") {
        updatePlayer(dt); updateEnemies(dt);
        if (world.flag) world.flag.userData.flag.rotation.y = Math.sin(timeNow * 4) * 0.15;
      } else if (state === "dead") { updatePlayer(dt); }
      updateFloats(dt);
      // camera: ahead of the hero, clamped to the level, easing on y
      if (L && bloop) {
        const lookAhead = P.dead ? 0 : P.face * 2.2 + P.vx * 0.25;
        const tx = clamp(P.x + lookAhead, 5, L.W - 5), ty = clamp(P.y + 3.4, 6, 16);
        if (!camInit) { camX = tx; camY = ty; camInit = true; }
        camX += (tx - camX) * Math.min(1, dt * 5); camY += (ty - camY) * Math.min(1, dt * (P.y > camY - 4.2 ? 6 : 3));
        camera.position.set(camX, camY + 2.6, 20.5);
        if (shake > 0) { shake = Math.max(0, shake - dt * 2.5); camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; }
        camera.lookAt(camX, camY, 0);
        camera.fov += (58 - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
        sun.position.set(camX - 8, camY + 18, 16); sun.target.position.set(camX, camY - 4, 0);
      }
      updateParticles(dt);
      renderer.render(scene, camera);
    }
    ctx.onFrame(update);

    // =====================================================================
    // 13. Menus, level select, pause.
    // =====================================================================
    function showMenu() {
      state = "menu";
      el.hud.classList.add("bh-hidden"); el.ctl.classList.add("bh-hidden"); el.pause.classList.add("bh-hidden"); el.clear.classList.add("bh-hidden"); el.over.classList.add("bh-hidden");
      el.menu.classList.remove("bh-hidden"); hideCoach();
      clearInput(); refreshMenu();
      // a quiet showcase level behind the menu
      if (!L || curLevel !== 0) { const lv = genLevel(0); buildLevel(lv); if (!bloop) { bloop = buildBloop(); scene.add(bloop); } P.x = lv.startX; P.y = lv.startY; }
      P.dead = false; P.flagT = -1; bloop.visible = true; bloop.position.set(P.x, P.y, 0); camInit = false;
      bed("bubble", 0.16);
    }
    function openLevels() {
      el.lvSub.textContent = S.totalStars + " / " + (N_LEVELS * 3) + " stars · best " + fmt(S.bestScore);
      el.worlds.innerHTML = "";
      WORLDS.forEach((w) => {
        const div = document.createElement("div"); div.className = "bh-world"; div.style.background = w.card;
        let stars = 0; for (let i = 0; i < LEVELS_PER_WORLD; i++) stars += S.stars[w.id * LEVELS_PER_WORLD + i] || 0;
        div.innerHTML = `<h3>${w.icon} World ${w.id + 1} · ${esc(w.name)}<span>${stars}/${LEVELS_PER_WORLD * 3} ★</span></h3><div class="bh-lv"></div>`;
        const row = div.querySelector(".bh-lv");
        for (let i = 0; i < LEVELS_PER_WORLD; i++) {
          const idx = w.id * LEVELS_PER_WORLD + i, locked = idx > S.unlocked, st = S.stars[idx] || 0;
          const b = document.createElement("button"); b.className = "bh-lvbtn" + (locked ? " lock" : idx === S.unlocked ? " next" : "");
          b.innerHTML = `<b>${w.id + 1}-${i + 1}${isBossLevel(idx) ? " 👑" : ""}</b><small>${locked ? "🔒" : "★".repeat(st) + "☆".repeat(3 - st)}</small>`;
          if (!locked) ctx.listen(b, "click", () => { sfx.ui(); haptic("light"); el.ovLevels.classList.add("bh-hidden"); beginCampaign(idx); });
          row.appendChild(b);
        }
        el.worlds.appendChild(div);
      });
      el.ovLevels.classList.remove("bh-hidden");
    }
    ctx.listen($("btnPlay"), "click", () => { firstGesture(); sfx.ui(); haptic("light"); beginCampaign(Math.min(S.unlocked, N_LEVELS - 1)); });
    ctx.listen($("btnLevels"), "click", () => { firstGesture(); sfx.ui(); openLevels(); });
    ctx.listen($("btnLevelsClose"), "click", () => { sfx.ui(); el.ovLevels.classList.add("bh-hidden"); });
    ctx.listen($("btnHow"), "click", () => { firstGesture(); sfx.ui(); el.how.classList.remove("bh-hidden"); });
    ctx.listen($("btnHowOk"), "click", () => { sfx.ui(); el.how.classList.add("bh-hidden"); });
    ctx.listen($("btnPause"), "click", () => { if (state === "play") { state = "paused"; sfx.ui(); clearInput(); el.pause.classList.remove("bh-hidden"); } });
    ctx.listen($("btnResume"), "click", () => { sfx.ui(); el.pause.classList.add("bh-hidden"); if (state === "paused") state = "play"; });
    ctx.listen($("btnRestart"), "click", () => { sfx.ui(); el.pause.classList.add("bh-hidden"); showLivesCard(curLevel, () => startLevel(curLevel, false)); });
    ctx.listen($("btnQuit"), "click", () => { sfx.ui(); el.pause.classList.add("bh-hidden"); if (run.score > S.bestScore) { S.bestScore = run.score; save(); submitRecords(); } showMenu(); });
    const toggleMute = () => { firstGesture(); muted = !muted; S.muted = muted; save(); applyMute(); sfx.ui(); };
    ctx.listen(el.btnMute, "click", toggleMute); ctx.listen(el.btnMute2, "click", toggleMute);

    // Test hooks (harness only; harmless in production).
    if (typeof window !== "undefined") {
      window.__bhDebug = () => ({ state, level: curLevel, x: Math.round(P.x * 10) / 10, y: Math.round(P.y * 10) / 10, vx: Math.round(P.vx * 10) / 10, vy: Math.round(P.vy * 10) / 10, grounded: P.grounded, big: P.big, star: P.star, lives: run.lives, score: run.score, coins: run.coins, time: Math.round(run.time), W: L ? L.W : 0, flagX: L ? L.flagX : 0, cp: L ? L.checkpoint : 0, enemies: world.enemies.filter((e) => e.alive).length, boss: world.boss ? { hp: world.boss.hp, alive: world.boss.alive } : null, unlocked: S.unlocked, stars: S.stars.slice() });
      window.__bhStart = (i) => { firstGesture(); beginCampaign(i || 0); };
      window.__bhMove = (d) => setMove(d);
      window.__bhJump = (hold) => { input.jumpPressed = true; input.jump = true; if (!hold) ctx.timeout(() => { input.jump = false; }, 120); };
      window.__bhRelease = () => { input.jump = false; };
      window.__bhWarp = (x) => { P.x = x; P.y = tileTop(Math.floor(x)) + 0.1; P.vy = 0; camInit = false; };
      window.__bhGrid = (x0, x1) => { const rows = []; for (let y = H - 1; y >= 0; y--) { let s = ""; for (let x = x0; x < x1; x++) s += ".#BQUP=^~.S|"[tileAt(x, y)] || "?"; rows.push(s); } return rows.join("\n"); };
      window.__bhApex = () => { P._apex = Math.max(P._apex || 0, P.y - (P._base == null ? P.y : P._base)); return Math.round((P._apex || 0) * 100) / 100; };
      window.__bhAutoJump = (hold) => { P._auto = { hold, pending: true, left: null }; };
      window.__bhApexReset = () => { P._apex = 0; P._base = P.y; };
      window.__bhKill = () => die("test");
      window.__bhBossPos = () => world.boss ? { x: world.boss.x, y: world.boss.y } : null;
      window.__bhDrop = (x, y) => { P.x = x; P.y = y; P.vy = -1; P.vx = 0; camInit = false; };
      window.__bhFlag = () => { P.x = L.flagX + 0.5; P.y = tileTop(L.flagX) + 6; };
    }

    showMenu();
    applyMute();

    ctx.onDestroy(() => {
      try { if (canMusic && ctx.music && musicOn) ctx.music.stop({ fadeOutMs: 200 }); } catch (_) {}
      disposeLevel();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); } } });
      try { renderer.dispose(); } catch (_) {}
      if (AC) { try { AC.close(); } catch (_) {} }
    });
  }
};
