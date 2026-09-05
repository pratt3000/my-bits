/*
 * Sled Surfers
 * A penguin on a sled, a snowy slope that never ends. Drag to steer, tap to
 * hop, hit the ramps for big air, grab rockets, magnets and shields, and
 * push through stage after stage — alpine pass, frozen forest, snowy city,
 * ice cave — as the run gets faster and the slope gets meaner. Coins buy
 * sleds, outfits and upgrades. Distance and score go to the leaderboard.
 *
 * Runtime:  plethora-bit@2  (window.plethoraBit)
 * Renderer: three@0.164.1 (ES module via ctx.importModule)
 * Audio:    ctx.music beds + procedurally synthesized WebAudio SFX
 *           (packaged assets are disabled, so every sound and texture is
 *           generated in this file)
 */

window.plethoraBit = {
  meta: {
    title: "Sled Surfers",
    runtime: "plethora-bit@2",
    tags: ["3d", "sledding", "endless-runner", "arcade", "winter", "penguin", "mobile"],
    permissions: ["haptics", "backgroundMusic", "audio", "storage"]
  },

  async init(ctx) {
    "use strict";

    // =====================================================================
    // 1. Surfaces + UI shell. Menu is DOM so the first frame is instant.
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
      .ss-ui { position:absolute; inset:0; overflow:hidden; color:#f4fbff;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
        -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
      .ss-ui * { box-sizing:border-box; }
      .ss-hidden { display:none !important; }

      .ss-bg { position:absolute; inset:0; transition:opacity .5s ease; opacity:.62;
        background:
          radial-gradient(90% 60% at 50% 0%, rgba(255,255,255,.55), rgba(255,255,255,0) 60%),
          linear-gradient(180deg,#8fd0f5 0%, #bfe6fb 40%, #eaf6ff 100%); }
      .ss-bg:before { content:""; position:absolute; left:-10%; right:-10%; bottom:-6%; height:46%;
        background:
          radial-gradient(60% 100% at 20% 100%, #ffffff 0 58%, rgba(255,255,255,0) 60%),
          radial-gradient(70% 100% at 65% 100%, #f2f9ff 0 60%, rgba(255,255,255,0) 62%),
          radial-gradient(50% 100% at 100% 100%, #ffffff 0 55%, rgba(255,255,255,0) 57%); }
      .ss-bg:after { content:""; position:absolute; left:0; right:0; bottom:0; height:22%;
        background:linear-gradient(180deg, rgba(255,255,255,0), #ffffff 70%); }
      .ss-vign { position:absolute; inset:0; pointer-events:none;
        background:radial-gradient(120% 100% at 50% 40%, rgba(0,0,0,0) 55%, rgba(20,40,70,.35) 100%); }

      .ss-screen { position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; padding:22px; text-align:center; pointer-events:auto;
        padding-top:calc(${sa.top}px + 22px); padding-bottom:calc(${sa.bottom}px + 22px); }

      .ss-logo { font-size:46px; font-weight:900; letter-spacing:1px; line-height:1; font-style:italic;
        color:#fff; -webkit-text-stroke:0; text-shadow:0 3px 0 #1f6fb3, 0 6px 0 #16558a, 0 12px 24px rgba(20,80,140,.35); }
      .ss-logo-sub { font-size:11.5px; font-weight:800; letter-spacing:5px; color:#1e5f9c; margin-top:10px; opacity:.85; }
      .ss-hero { font-size:76px; line-height:1; margin-bottom:6px;
        filter:drop-shadow(0 10px 18px rgba(30,80,140,.35)); animation:ssBob 2.6s ease-in-out infinite; }
      @keyframes ssBob { 0%,100% { transform:translateY(0) rotate(-4deg); } 50% { transform:translateY(-7px) rotate(3deg); } }

      .ss-btn { pointer-events:auto; display:block; width:min(300px,80vw); margin:0 auto 11px;
        padding:15px 20px; border-radius:18px; border:none; cursor:pointer;
        font-size:17px; font-weight:900; letter-spacing:.4px; color:#fff;
        background:linear-gradient(180deg,#5cc2ff,#2a8fe6);
        box-shadow:0 6px 0 #1a63a8, 0 12px 26px rgba(20,80,140,.35);
        transition:transform .08s ease, box-shadow .08s ease; }
      .ss-btn:active { transform:translateY(4px); box-shadow:0 2px 0 #1a63a8, 0 5px 14px rgba(20,80,140,.35); }
      .ss-btn.ghost { background:rgba(255,255,255,.72); color:#1c5c98; font-weight:800;
        border:1px solid rgba(40,120,200,.25); box-shadow:0 4px 0 rgba(40,120,200,.22); }
      .ss-btn.ghost:active { transform:translateY(3px); box-shadow:0 1px 0 rgba(40,120,200,.22); }
      .ss-btn.gold { background:linear-gradient(180deg,#ffe082,#f7b733); color:#5a3a00; box-shadow:0 6px 0 #c48a12, 0 12px 26px rgba(20,80,140,.3); }
      .ss-btn.gold:active { box-shadow:0 2px 0 #c48a12, 0 5px 14px rgba(20,80,140,.3); }
      .ss-btn:disabled { opacity:.5; }

      .ss-wallet { display:flex; gap:12px; justify-content:center; margin:10px 0 14px; font-size:15px; font-weight:900; }
      .ss-wallet span { display:inline-flex; align-items:center; gap:6px; color:#1c4f80;
        background:rgba(255,255,255,.8); border:1px solid rgba(40,120,200,.22); padding:6px 14px; border-radius:999px; }
      .ss-bestline { font-size:12px; font-weight:800; letter-spacing:1.5px; color:#1c4f80; opacity:.8; margin:-4px 0 16px; }
      .ss-bestline b { color:#0d5aa8; font-size:15px; }
      .ss-bestline i { font-style:normal; }

      /* ---- HUD ---- */
      .ss-hud { position:absolute; inset:0; pointer-events:none; z-index:20; }
      .ss-dist { position:absolute; top:calc(${sa.top}px + 14px); left:50%; transform:translateX(-50%);
        font-size:40px; font-weight:900; letter-spacing:.5px; color:#fff; line-height:1;
        text-shadow:0 2px 0 rgba(30,90,150,.55), 0 4px 16px rgba(20,60,110,.45); font-variant-numeric:tabular-nums; }
      .ss-score { position:absolute; top:calc(${sa.top}px + 58px); left:50%; transform:translateX(-50%);
        font-size:13px; font-weight:800; letter-spacing:1px; color:#fff; opacity:.92;
        text-shadow:0 1px 6px rgba(20,60,110,.6); font-variant-numeric:tabular-nums; }
      .ss-stage { position:absolute; top:calc(${sa.top}px + 78px); left:50%; transform:translateX(-50%);
        font-size:11px; font-weight:800; letter-spacing:2px; color:#dff3ff; opacity:.85; text-shadow:0 1px 6px rgba(20,60,110,.6); }
      .ss-coins { position:absolute; top:calc(${sa.top}px + 14px); left:calc(${sa.left}px + 14px);
        display:flex; flex-direction:column; gap:5px; align-items:flex-start; font-size:15px; font-weight:900; }
      .ss-coins span { display:inline-flex; align-items:center; gap:5px; color:#fff;
        background:rgba(20,60,110,.42); padding:5px 11px; border-radius:999px; backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        font-variant-numeric:tabular-nums; }
      .ss-mult { position:absolute; top:calc(${sa.top}px + 62px); right:calc(${sa.right}px + 14px);
        font-size:18px; font-weight:900; color:#ffe082; text-shadow:0 2px 8px rgba(20,60,110,.6); }
      .ss-mult.pop { animation:ssPop .45s ease; }
      @keyframes ssPop { 0%{transform:scale(1);} 40%{transform:scale(1.45);} 100%{transform:scale(1);} }

      .ss-pw { position:absolute; left:calc(${sa.left}px + 14px); top:calc(${sa.top}px + 62px);
        display:flex; flex-direction:column; gap:6px; }
      .ss-pwchip { display:flex; align-items:center; gap:7px; padding:5px 11px 5px 8px; border-radius:999px;
        background:rgba(20,60,110,.45); border:1px solid rgba(255,255,255,.28); font-size:12px; font-weight:800; color:#fff; }
      .ss-pwbar { width:44px; height:5px; border-radius:3px; background:rgba(255,255,255,.25); overflow:hidden; }
      .ss-pwbar i { display:block; height:100%; width:100%; background:#ffe082; transform-origin:left; }

      /* stage progress: vertical rail on the right, checkered flag on top, % bubble that climbs */
      .ss-prog { position:absolute; right:calc(${sa.right}px + 16px); top:38%; height:32%; width:18px;
        border-radius:12px; background:rgba(255,255,255,.55); border:2px solid rgba(255,255,255,.9);
        box-shadow:0 4px 14px rgba(20,60,110,.25); }
      .ss-prog .fill { position:absolute; left:2px; right:2px; bottom:2px; height:0%; border-radius:10px;
        background:linear-gradient(180deg,#6cc6ff,#2a8fe6); }
      .ss-prog .flag { position:absolute; left:50%; top:-16px; transform:translateX(-50%); width:22px; height:22px; border-radius:6px;
        background:
          linear-gradient(45deg,#1b2a3a 25%,transparent 25%,transparent 75%,#1b2a3a 75%),
          linear-gradient(45deg,#1b2a3a 25%,#fff 25%,#fff 75%,#1b2a3a 75%);
        background-size:8px 8px; background-position:0 0,4px 4px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.25); }
      .ss-prog .bub { position:absolute; left:50%; bottom:0%; transform:translate(-50%,50%); min-width:50px; padding:7px 6px;
        border-radius:999px; background:radial-gradient(circle at 35% 30%,#8fd6ff,#2b90e8 70%); color:#fff; font-size:12.5px; font-weight:900;
        text-align:center; border:2px solid #fff; box-shadow:0 4px 12px rgba(20,60,110,.35); font-variant-numeric:tabular-nums;
        transition:bottom .15s linear; }

      .ss-toast { position:absolute; left:50%; top:27%; transform:translate(-50%,-50%) scale(.9); z-index:22;
        padding:9px 20px; border-radius:999px; font-size:16px; font-weight:900; white-space:nowrap; color:#fff;
        background:rgba(20,60,110,.62); border:1px solid rgba(255,255,255,.35); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        opacity:0; transition:opacity .22s ease, transform .22s ease; pointer-events:none; }
      .ss-toast.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
      .ss-big { position:absolute; left:50%; top:36%; transform:translate(-50%,-50%) scale(.6); z-index:23; text-align:center;
        font-size:34px; font-weight:900; font-style:italic; color:#fff; white-space:nowrap; pointer-events:none; opacity:0;
        text-shadow:0 3px 0 #1f6fb3, 0 8px 22px rgba(20,60,110,.5); transition:opacity .25s ease, transform .3s cubic-bezier(.2,1.6,.4,1); }
      .ss-big.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
      .ss-big small { display:block; font-size:14px; letter-spacing:3px; font-style:normal; opacity:.9; margin-top:4px; }

      .ss-flash { position:absolute; inset:0; pointer-events:none; opacity:0; z-index:19; transition:opacity .45s ease; }
      .ss-flash.on { opacity:1; transition:opacity .05s ease; }
      .ss-flash.hurt { background:radial-gradient(110% 90% at 50% 50%, rgba(220,40,40,0) 45%, rgba(220,40,40,.55) 100%); }
      .ss-flash.good { background:radial-gradient(110% 90% at 50% 50%, rgba(255,240,160,0) 55%, rgba(255,240,160,.45) 100%); }

      .ss-corner { position:absolute; top:calc(${sa.top}px + 12px); right:calc(${sa.right}px + 14px);
        display:flex; gap:9px; pointer-events:none; z-index:50; }
      .ss-ico { pointer-events:auto; width:42px; height:42px; border-radius:50%; cursor:pointer;
        border:1px solid rgba(255,255,255,.55); background:rgba(20,60,110,.42); color:#fff;
        font-size:17px; display:flex; align-items:center; justify-content:center;
        backdrop-filter:blur(7px); -webkit-backdrop-filter:blur(7px); }
      .ss-ico:active { transform:scale(.9); }

      .ss-hint { position:absolute; inset:0; pointer-events:none; z-index:21; opacity:0;
        transition:opacity .4s ease; display:flex; align-items:center; justify-content:center; }
      .ss-hint.show { opacity:.95; }
      .ss-hint-card { background:rgba(20,60,110,.72); border:1px solid rgba(255,255,255,.3); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
        border-radius:18px; padding:16px 22px; font-size:14.5px; font-weight:700; line-height:1.9; text-align:left; color:#fff; }
      .ss-hint-card b { color:#ffe082; }

      /* ---- overlays ---- */
      .ss-ov { position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center;
        padding:20px; pointer-events:auto; text-align:center;
        background:radial-gradient(120% 90% at 50% 35%, rgba(120,190,240,.5), rgba(20,60,110,.82));
        backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); }
      .ss-panel { width:100%; max-width:390px; max-height:86vh; overflow-y:auto; padding:22px 18px 16px;
        border-radius:24px; background:linear-gradient(180deg, rgba(255,255,255,.96), rgba(232,245,255,.96));
        border:1px solid rgba(255,255,255,.9); box-shadow:0 20px 60px rgba(10,40,80,.45); color:#14406e; }
      .ss-panel h2 { margin:0 0 6px; font-size:26px; font-weight:900; letter-spacing:.3px; color:#0f4a86; }
      .ss-panel .big { font-size:54px; line-height:1; margin-bottom:4px; }

      .ss-stat { display:flex; justify-content:space-between; align-items:center; gap:10px;
        padding:9px 13px; border-radius:12px; background:rgba(40,120,200,.09); margin-bottom:7px; font-size:14.5px; font-weight:700; }
      .ss-stat b { font-size:19px; font-weight:900; color:#0d5aa8; font-variant-numeric:tabular-nums; }
      .ss-best { display:inline-block; margin:4px 0 10px; padding:5px 14px; border-radius:999px;
        font-size:11.5px; font-weight:900; letter-spacing:1.4px; color:#5a3a00;
        background:linear-gradient(90deg,#ffe082,#f7b733); }

      .ss-save { margin:6px 0 12px; padding:14px; border-radius:16px;
        background:rgba(247,183,51,.12); border:1px solid rgba(247,183,51,.5); }
      .ss-save p { margin:0 0 10px; font-size:13.5px; font-weight:700; }
      .ss-ring { width:66px; height:66px; margin:0 auto 8px; position:relative; }
      .ss-ring svg { transform:rotate(-90deg); }
      .ss-ring .t { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:900; }

      /* garage */
      .ss-tabs { display:flex; gap:7px; margin-bottom:12px; }
      .ss-tabs button { flex:1; padding:9px 0; border-radius:999px; cursor:pointer; font-size:13px; font-weight:800;
        border:1px solid rgba(40,120,200,.25); background:rgba(255,255,255,.6); color:#1c5c98; }
      .ss-tabs button.on { background:linear-gradient(180deg,#5cc2ff,#2a8fe6); color:#fff; border-color:transparent; }
      .ss-row { display:flex; align-items:center; gap:11px; padding:11px 12px; border-radius:14px;
        background:rgba(40,120,200,.09); margin-bottom:8px; text-align:left; }
      .ss-row.sel { background:rgba(92,194,255,.22); border:1px solid rgba(42,143,230,.5); }
      .ss-row .ic { font-size:26px; width:36px; text-align:center; flex:none; }
      .ss-row .sw { width:34px; height:34px; border-radius:10px; flex:none; border:2px solid rgba(255,255,255,.9); box-shadow:0 2px 6px rgba(20,60,110,.25); }
      .ss-row .mid { flex:1; min-width:0; }
      .ss-row .nm { font-size:14.5px; font-weight:900; }
      .ss-row .de { font-size:11.5px; opacity:.75; margin-top:2px; }
      .ss-pips { display:flex; gap:3px; margin-top:5px; }
      .ss-pips i { width:16px; height:5px; border-radius:3px; background:rgba(40,120,200,.2); }
      .ss-pips i.on { background:linear-gradient(90deg,#5cc2ff,#2a8fe6); }
      .ss-buy { flex:none; padding:9px 12px; border-radius:11px; border:none; cursor:pointer;
        font-size:12.5px; font-weight:900; color:#5a3a00; background:linear-gradient(180deg,#ffe082,#f7b733);
        display:flex; align-items:center; gap:4px; white-space:nowrap; }
      .ss-buy:disabled { opacity:.45; background:rgba(40,120,200,.18); color:#14406e; }
      .ss-buy.own { background:linear-gradient(180deg,#5cc2ff,#2a8fe6); color:#fff; }
      .ss-buy.max { background:rgba(40,120,200,.15); color:#14406e; }

      .ss-fatal { position:absolute; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
        padding:26px; text-align:center; background:#cfe8fa; color:#14406e; pointer-events:auto; }

      .ss-confetti { position:absolute; inset:0; pointer-events:none; z-index:24; overflow:hidden; }
      .ss-confetti i { position:absolute; top:-12px; width:8px; height:12px; border-radius:2px; animation:ssFall 1.6s linear forwards; }
      @keyframes ssFall { 0% { transform:translateY(0) rotate(0); opacity:1; } 100% { transform:translateY(105vh) rotate(720deg); opacity:.2; } }
    `;
    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "ss-ui";
    ui.innerHTML = `
      <div class="ss-bg" id="ssBg"></div>
      <div class="ss-vign"></div>

      <div class="ss-corner">
        <button class="ss-ico ss-hidden" id="ssPause" aria-label="Pause">⏸</button>
        <button class="ss-ico" id="ssMute" aria-label="Sound">🔊</button>
      </div>

      <div class="ss-screen" id="scrMenu">
        <div class="ss-hero">🐧</div>
        <div class="ss-logo">SLED SURFERS</div>
        <div class="ss-logo-sub">RIDE THE SNOW</div>
        <div class="ss-wallet"><span>🪙 <i id="wCoins">0</i></span><span>🏁 stage <i id="wStage">1</i></span></div>
        <div class="ss-bestline">BEST <b id="wBest">0</b> · <i id="wBestD">0</i> m</div>
        <button class="ss-btn" id="btnPlay">▶  SLIDE</button>
        <button class="ss-btn ghost" id="btnGarage">🛷  Garage</button>
        <button class="ss-btn ghost" id="btnHow">?  How to play</button>
      </div>

      <div class="ss-hud ss-hidden" id="ssHud">
        <div class="ss-coins"><span>🪙 <i id="hCoins">0</i></span></div>
        <div class="ss-dist" id="hDist">0m</div>
        <div class="ss-score" id="hScore">0 pts</div>
        <div class="ss-stage" id="hStage">STAGE 1 · ALPINE PASS</div>
        <div class="ss-mult" id="hMult">×1</div>
        <div class="ss-pw" id="hPw"></div>
        <div class="ss-prog"><div class="fill" id="pFill"></div><div class="flag"></div><div class="bub" id="pBub">0%</div></div>
      </div>

      <div class="ss-hint" id="ssHint">
        <div class="ss-hint-card">
          👆 hold &amp; drag — <b>steer</b><br>
          👆 tap — <b>hop</b> over logs &amp; gaps<br>
          ⛰️ ramps — <b>big air</b> = big points<br>
          <span style="opacity:.75">touch anywhere to begin</span>
        </div>
      </div>

      <div class="ss-toast" id="ssToast"></div>
      <div class="ss-big" id="ssBig"></div>
      <div class="ss-confetti" id="ssConf"></div>
      <div class="ss-flash hurt" id="ssFlashHurt"></div>
      <div class="ss-flash good" id="ssFlashGood"></div>

      <div class="ss-ov ss-hidden" id="ovHow">
        <div class="ss-panel">
          <h2>How to slide</h2>
          <div style="text-align:left;font-size:14.5px;line-height:1.95;margin:8px 0 16px;">
            👆 <b>Hold and drag</b> left or right to steer. The slope's banks push you back to the middle.<br>
            👆 <b>Tap</b> to hop over logs, fences and gaps. Ramps launch you — the longer you fly, the bigger the bonus.<br>
            🌲 Trees, rocks, cars and walls end the run. ⛄ Snowmen just slow you down.<br>
            🧊 Ice patches are fast but you can't steer on them.<br>
            🚀 <b>Rocket</b>: unstoppable sprint. 🧲 <b>Magnet</b>: pulls coins. 🛡️ <b>Shield</b>: eats one crash. ✨ <b>×2</b>: doubles points.<br>
            🏁 Reach the flag to clear a stage — every stage is faster and busier than the last.<br>
            🪙 Coins buy sleds, outfits, upgrades and a second chance.
          </div>
          <button class="ss-btn" id="btnHowOk" style="margin-bottom:0;">Got it</button>
        </div>
      </div>

      <div class="ss-ov ss-hidden" id="ovPause">
        <div class="ss-panel">
          <h2>Paused</h2>
          <div style="height:8px;"></div>
          <button class="ss-btn" id="btnResume">Resume</button>
          <button class="ss-btn ghost" id="btnRestart">Restart</button>
          <button class="ss-btn ghost" id="btnQuit" style="margin-bottom:0;">Quit to menu</button>
        </div>
      </div>

      <div class="ss-ov ss-hidden" id="ovGarage">
        <div class="ss-panel">
          <h2>Garage</h2>
          <div class="ss-wallet"><span>🪙 <i id="gCoins">0</i></span></div>
          <div class="ss-tabs">
            <button id="tabSleds" class="on">Sleds</button>
            <button id="tabSuits">Outfits</button>
            <button id="tabUps">Upgrades</button>
          </div>
          <div id="garageList"></div>
          <button class="ss-btn ghost" id="btnGarageClose" style="margin:12px 0 0;">Close</button>
        </div>
      </div>

      <div class="ss-ov ss-hidden" id="ovDead">
        <div class="ss-panel" id="deadPanel"></div>
      </div>
    `;
    root.appendChild(ui);

    const $ = (id) => ui.querySelector("#" + id);
    const el = {
      bg: $("ssBg"), menu: $("scrMenu"), hud: $("ssHud"), hint: $("ssHint"),
      dist: $("hDist"), score: $("hScore"), stage: $("hStage"), mult: $("hMult"),
      coins: $("hCoins"), pw: $("hPw"), pFill: $("pFill"), pBub: $("pBub"),
      toast: $("ssToast"), big: $("ssBig"), conf: $("ssConf"),
      flashHurt: $("ssFlashHurt"), flashGood: $("ssFlashGood"),
      how: $("ovHow"), pause: $("ovPause"), garage: $("ovGarage"),
      dead: $("ovDead"), deadPanel: $("deadPanel"), garageList: $("garageList"),
      pauseBtn: $("ssPause"), muteBtn: $("ssMute"),
      wCoins: $("wCoins"), wStage: $("wStage"), wBest: $("wBest"), wBestD: $("wBestD"), gCoins: $("gCoins"),
      tabSleds: $("tabSleds"), tabSuits: $("tabSuits"), tabUps: $("tabUps")
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
    const smooth = (t) => t * t * (3 - 2 * t);

    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const memStore = {};
    const store = {
      get(k, d) {
        try { const v = canStore ? ctx.storage.get("ss_" + k) : memStore[k]; return v == null ? d : v; }
        catch (_) { return d; }
      },
      set(k, v) { try { if (canStore) ctx.storage.set("ss_" + k, v); else memStore[k] = v; } catch (_) {} }
    };

    // Sleds change how the run feels: top speed, how hard you can steer, and
    // how high a tap hops. Every one is drawn procedurally in buildSled().
    const SLEDS = [
      { id: "tube", icon: "🛟", name: "Snow Tube", desc: "Bouncy, forgiving, classic.", cost: 0,
        speed: 1.0, handling: 1.0, jump: 1.0, color: 0x2f7fe0 },
      { id: "board", icon: "🏄", name: "Pink Board", desc: "Carves hard, hops high.", cost: 400,
        speed: 1.04, handling: 1.25, jump: 1.18, color: 0xf0479c },
      { id: "plane", icon: "✈️", name: "Prop Plane", desc: "Glides — long, floaty air.", cost: 1200,
        speed: 1.08, handling: 1.1, jump: 1.05, color: 0x4ec9a0, glide: 0.45 },
      { id: "rocket", icon: "🚀", name: "Rocket Sled", desc: "Fastest thing on the mountain.", cost: 3000,
        speed: 1.18, handling: 1.3, jump: 1.15, color: 0xff6b3d, boost: 1 }
    ];
    // Outfits recolour the penguin and add a hat. Cosmetic only.
    const SUITS = [
      { id: "classic", name: "Classic", desc: "Tux and a red beanie.", cost: 0, body: 0x1e2430, belly: 0xf6f8ff, hat: "beanie", hatColor: 0xe8453c },
      { id: "mint", name: "Mint Chip", desc: "Cool tones, striped scarf.", cost: 300, body: 0x1f4a4f, belly: 0xe8fff6, hat: "beanie", hatColor: 0x5fd6b0 },
      { id: "sunset", name: "Sunset", desc: "Warm feathers, sunglasses.", cost: 700, body: 0x4a2130, belly: 0xffe9d6, hat: "shades", hatColor: 0x201020 },
      { id: "royal", name: "Royal", desc: "Midnight blue and a crown.", cost: 1500, body: 0x1a2560, belly: 0xf1f3ff, hat: "crown", hatColor: 0xf7c53a }
    ];
    // Upgrade tracks, bought with coins. Each level extends what it governs.
    const UPGRADES = [
      { id: "rocket", icon: "🚀", name: "Rocket", desc: "How far the rocket takes you", costs: [150, 350, 700, 1200, 2000], base: 220, step: 70, unit: "m" },
      { id: "magnet", icon: "🧲", name: "Coin Magnet", desc: "How long coins fly to you", costs: [120, 300, 600, 1000, 1700], base: 7, step: 2, unit: "s" },
      { id: "shield", icon: "🛡️", name: "Shield", desc: "How long the shield lasts", costs: [150, 350, 700, 1200, 2000], base: 8, step: 2.5, unit: "s" },
      { id: "mult", icon: "✨", name: "Score ×2", desc: "How long the doubler lasts", costs: [150, 350, 700, 1200, 2000], base: 8, step: 2.5, unit: "s" },
      { id: "value", icon: "🪙", name: "Coin Value", desc: "Each coin is worth more", costs: [250, 550, 1000, 1800, 3000], base: 1, step: 1, unit: "×" },
      { id: "head", icon: "🏁", name: "Head Start", desc: "Begin each run with a rocket", costs: [300, 800, 1600], base: 0, step: 60, unit: "m" }
    ];
    function upLevel(id) { return clamp(store.get("up_" + id, 0), 0, 5); }
    function upValue(u) { return u.base + u.step * upLevel(u.id); }
    function upById(id) { for (const u of UPGRADES) if (u.id === id) return u; return null; }
    function upVal(id) { const u = upById(id); return u ? upValue(u) : 0; }
    function ownedSled(id) { return id === "tube" || !!store.get("sled_" + id, false); }
    function ownedSuit(id) { return id === "classic" || !!store.get("suit_" + id, false); }
    function currentSled() { const id = store.get("sled", "tube"); for (const s of SLEDS) if (s.id === id && ownedSled(id)) return s; return SLEDS[0]; }
    function currentSuit() { const id = store.get("suit", "classic"); for (const s of SUITS) if (s.id === id && ownedSuit(id)) return s; return SUITS[0]; }

    const wallet = {
      get coins() { return store.get("coins", 0); },
      addCoins(n) { store.set("coins", Math.max(0, this.coins + n)); }
    };
    function refreshWallet() {
      el.wCoins.textContent = fmt(wallet.coins);
      el.gCoins.textContent = fmt(wallet.coins);
      el.wBest.textContent = fmt(store.get("best_score", 0));
      el.wBestD.textContent = fmt(store.get("best_distance", 0));
      el.wStage.textContent = String(store.get("best_stage", 1));
    }

    // =====================================================================
    // 3. Audio — synthesized SFX plus a ctx.music bed.
    // =====================================================================
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!store.get("muted", false);

    let AC = null, master = null, windGain = null, windFilter = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      try {
        AC = new C();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.85;
        master.connect(AC.destination);
        // Continuous sled hiss: filtered noise whose level tracks speed.
        const n = AC.sampleRate * 2;
        const buf = AC.createBuffer(1, n, AC.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
        windFilter = AC.createBiquadFilter(); windFilter.type = "bandpass"; windFilter.frequency.value = 900; windFilter.Q.value = 0.6;
        windGain = AC.createGain(); windGain.gain.value = 0;
        src.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
        src.start();
      } catch (_) { AC = null; master = null; windGain = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }
    function setWind(level, freq) {
      if (!windGain) return;
      try {
        windGain.gain.setTargetAtTime(muted ? 0 : level, AC.currentTime, 0.08);
        windFilter.frequency.setTargetAtTime(freq, AC.currentTime, 0.1);
      } catch (_) {}
    }

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
      ui() { tone(660, 0, 0.07, "sine", 0.1); if (!AC) fbSting("tap"); },
      coin() {
        if (!AC) { fbSting("coin"); return; }
        coinPitch = Math.min(coinPitch + 1, 14);
        const f = 1046 + coinPitch * 48;
        tone(f, 0, 0.09, "triangle", 0.12);
        tone(f * 1.5, 0.03, 0.1, "sine", 0.06);
      },
      hop() { noise(0.09, 1100, 0.1, "lowpass"); tone(320, 0, 0.14, "sine", 0.09, 700); },
      land(hard) { noise(hard ? 0.18 : 0.11, hard ? 380 : 520, hard ? 0.3 : 0.18, "lowpass"); },
      launch() { noise(0.28, 1500, 0.18); tone(240, 0, 0.35, "sawtooth", 0.05, 900); },
      bump() { noise(0.2, 350, 0.28, "lowpass"); tone(180, 0, 0.18, "square", 0.1, 90); },
      ice() { tone(1400, 0, 0.25, "sine", 0.07, 2200); },
      powerup(kind) {
        if (!AC) { fbSting("powerup"); return; }
        const base = kind === "rocket" ? 440 : kind === "shield" ? 392 : kind === "magnet" ? 523 : 587;
        [0, 4, 7, 12].forEach((s, i) => tone(base * Math.pow(2, s / 12), i * 0.05, 0.34, "triangle", 0.15));
      },
      shieldPop() { noise(0.25, 2400, 0.22); tone(880, 0, 0.3, "triangle", 0.12, 220); },
      crash() {
        if (!AC) { fbSting("lose"); return; }
        noise(0.5, 260, 0.35, "lowpass");
        [523, 466, 392, 311, 233].forEach((f, i) => tone(f, 0.1 + i * 0.11, 0.4, "triangle", 0.14));
      },
      revive() { if (!AC) { fbSting("win"); return; } [392, 523, 659, 880, 1174].forEach((f, i) => tone(f, i * 0.07, 0.5, "triangle", 0.15)); },
      buy() { if (!AC) { fbSting("coin"); return; } [660, 880, 1174].forEach((f, i) => tone(f, i * 0.06, 0.26, "triangle", 0.14)); },
      stage() { if (!AC) { fbSting("success"); return; } [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.08, 0.5, "triangle", 0.15)); },
      air() { if (!AC) { fbSting("success"); return; } [784, 988, 1318].forEach((f, i) => tone(f, i * 0.06, 0.32, "triangle", 0.13)); }
    };

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
          else if (!muted && started) bed(state === "run" ? currentBiome().music : "cozy", state === "run" ? 0.26 : 0.18);
        }
      } catch (_) {}
    }
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // =====================================================================
    // 4. Screen plumbing.
    // =====================================================================
    let state = "menu";     // menu | run | paused | dying | dead
    let started = false;
    let toastTok = 0, bigTok = 0;
    function toast(msg, ms) {
      el.toast.textContent = msg;
      el.toast.classList.add("show");
      const tok = ++toastTok;
      ctx.timeout(() => { if (tok === toastTok) el.toast.classList.remove("show"); }, ms || 1300);
    }
    function bigText(title, sub, ms) {
      el.big.innerHTML = esc(title) + (sub ? "<small>" + esc(sub) + "</small>" : "");
      el.big.classList.add("show");
      const tok = ++bigTok;
      ctx.timeout(() => { if (tok === bigTok) el.big.classList.remove("show"); }, ms || 1500);
    }
    function confetti() {
      el.conf.innerHTML = "";
      const cols = ["#5cc2ff", "#ffe082", "#ff6b9d", "#7ee8a2", "#ffffff", "#b39dff"];
      for (let i = 0; i < 46; i++) {
        const p = document.createElement("i");
        p.style.left = (Math.random() * 100) + "%";
        p.style.background = cols[i % cols.length];
        p.style.animationDelay = (Math.random() * 0.5) + "s";
        p.style.animationDuration = (1.3 + Math.random() * 0.9) + "s";
        el.conf.appendChild(p);
      }
      ctx.timeout(() => { el.conf.innerHTML = ""; }, 2600);
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
      rider.visible = false; shadowBlob.visible = false;
      el.menu.classList.remove("ss-hidden");
      el.hud.classList.add("ss-hidden");
      el.pauseBtn.classList.add("ss-hidden");
      el.bg.style.opacity = "0.62";
      refreshWallet();
      setWind(0, 600);
      bed("cozy", 0.18);
    }

    // ---- Garage -----------------------------------------------------------
    let garageTab = "sleds";
    function renderGarage() {
      refreshWallet();
      el.tabSleds.classList.toggle("on", garageTab === "sleds");
      el.tabSuits.classList.toggle("on", garageTab === "suits");
      el.tabUps.classList.toggle("on", garageTab === "ups");
      el.garageList.innerHTML = "";
      const coins = wallet.coins;
      if (garageTab === "ups") {
        for (const u of UPGRADES) {
          const lv = upLevel(u.id);
          const maxLv = u.costs.length;
          const maxed = lv >= maxLv;
          const cost = maxed ? 0 : u.costs[lv];
          const val = upValue(u);
          const shown = u.id === "value" ? "×" + (1 + lv) : (Math.round(val * 10) / 10) + u.unit;
          const row = document.createElement("div");
          row.className = "ss-row";
          row.innerHTML = `
            <div class="ic">${u.icon}</div>
            <div class="mid">
              <div class="nm">${u.name} <span style="opacity:.65;font-weight:700;">${shown}</span></div>
              <div class="de">${u.desc}</div>
              <div class="ss-pips">${Array.from({ length: maxLv }, (_, i) => `<i class="${i < lv ? "on" : ""}"></i>`).join("")}</div>
            </div>
            <button class="ss-buy ${maxed ? "max" : ""}" ${maxed || coins < cost ? "disabled" : ""}>${maxed ? "MAX" : "🪙 " + fmt(cost)}</button>`;
          if (!maxed) {
            ctx.listen(row.querySelector(".ss-buy"), "click", () => {
              if (wallet.coins < cost) return;
              wallet.addCoins(-cost);
              store.set("up_" + u.id, lv + 1);
              sfx.buy(); haptic("success");
              renderGarage();
              try { ctx.platform.interact({ type: "upgrade", id: u.id, level: lv + 1 }); } catch (_) {}
            });
          }
          el.garageList.appendChild(row);
        }
        return;
      }
      const isSled = garageTab === "sleds";
      const list = isSled ? SLEDS : SUITS;
      const cur = isSled ? currentSled().id : currentSuit().id;
      for (const item of list) {
        const owned = isSled ? ownedSled(item.id) : ownedSuit(item.id);
        const sel = item.id === cur;
        const row = document.createElement("div");
        row.className = "ss-row" + (sel ? " sel" : "");
        const stats = isSled
          ? `speed ${Math.round(item.speed * 100)} · grip ${Math.round(item.handling * 100)} · hop ${Math.round(item.jump * 100)}`
          : item.desc;
        const swatch = "#" + (isSled ? item.color : item.body).toString(16).padStart(6, "0");
        row.innerHTML = `
          ${isSled ? `<div class="ic">${item.icon}</div>` : `<div class="sw" style="background:${swatch};"></div>`}
          <div class="mid">
            <div class="nm">${item.name}</div>
            <div class="de">${isSled ? item.desc + "<br>" + stats : stats}</div>
          </div>
          <button class="ss-buy ${owned ? "own" : ""}" ${(!owned && coins < item.cost) || sel ? "disabled" : ""}>
            ${sel ? "✓ ON" : owned ? "USE" : "🪙 " + fmt(item.cost)}</button>`;
        ctx.listen(row.querySelector(".ss-buy"), "click", () => {
          if (sel) return;
          if (!owned) {
            if (wallet.coins < item.cost) return;
            wallet.addCoins(-item.cost);
            store.set((isSled ? "sled_" : "suit_") + item.id, true);
            sfx.buy(); haptic("success");
            try { ctx.platform.interact({ type: "unlock", id: item.id }); } catch (_) {}
          } else { sfx.ui(); haptic("light"); }
          store.set(isSled ? "sled" : "suit", item.id);
          rebuildRider();
          renderGarage();
        });
        el.garageList.appendChild(row);
      }
    }

    // ---- Menu wiring ------------------------------------------------------
    ctx.listen($("btnPlay"), "click", () => { firstGesture(); sfx.ui(); haptic("light"); startRun(); });
    ctx.listen($("btnGarage"), "click", () => { firstGesture(); sfx.ui(); renderGarage(); el.garage.classList.remove("ss-hidden"); });
    ctx.listen($("btnGarageClose"), "click", () => { sfx.ui(); el.garage.classList.add("ss-hidden"); refreshWallet(); });
    ctx.listen(el.tabSleds, "click", () => { sfx.ui(); garageTab = "sleds"; renderGarage(); });
    ctx.listen(el.tabSuits, "click", () => { sfx.ui(); garageTab = "suits"; renderGarage(); });
    ctx.listen(el.tabUps, "click", () => { sfx.ui(); garageTab = "ups"; renderGarage(); });
    ctx.listen($("btnHow"), "click", () => { firstGesture(); sfx.ui(); el.how.classList.remove("ss-hidden"); });
    ctx.listen($("btnHowOk"), "click", () => { sfx.ui(); el.how.classList.add("ss-hidden"); });
    ctx.listen(el.muteBtn, "click", () => { firstGesture(); muted = !muted; store.set("muted", muted); applyMute(); sfx.ui(); });
    ctx.listen(el.pauseBtn, "click", () => { if (state === "run") pauseRun(); });
    ctx.listen($("btnResume"), "click", () => { sfx.ui(); resumeRun(); });
    ctx.listen($("btnRestart"), "click", () => { sfx.ui(); el.pause.classList.add("ss-hidden"); startRun(); });
    ctx.listen($("btnQuit"), "click", () => { sfx.ui(); el.pause.classList.add("ss-hidden"); quitToMenu(); });

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
        f.className = "ss-fatal";
        f.innerHTML = "<div><div style='font-size:44px;'>\u{1F427}</div>" +
          "<div style='font-size:16px;font-weight:800;margin-top:10px;'>The mountain didn't load.</div>" +
          "<div style='font-size:13px;opacity:.75;margin-top:6px;'>Check your connection, then try again.</div>" +
          "<button class='ss-btn' id='ssRetry' style='margin:18px auto 0;width:200px;'>Try again</button>" +
          "<div style='font-size:10px;opacity:.4;margin-top:14px;word-break:break-word;'>" + esc(lastLoadErr) + "</div></div>";
        ui.appendChild(f);
        ctx.listen(f.querySelector("#ssRetry"), "click", () => { sfx.ui(); f.remove(); resolve(); });
      });
    }

    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (e1) {
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false }); }
      catch (e2) {
        const f = document.createElement("div");
        f.className = "ss-fatal";
        f.innerHTML = "<div><div style='font-size:44px;'>\u{1F427}</div><div style='font-size:15px;font-weight:800;margin-top:10px;'>This device couldn't start 3D graphics.<br>Close other apps and reopen.</div></div>";
        ui.appendChild(f);
        try { ctx.platform.error({ reason: "webgl_unavailable" }); } catch (_) {}
        return;
      }
    }
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xbfe3f7, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.listen(canvas, "webglcontextlost", (e) => { e.preventDefault(); });
    ctx.listen(canvas, "webglcontextrestored", () => { try { renderer.resetState(); } catch (_) {} });

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xbfe3f7, 90, 240);
    const camera = new THREE.PerspectiveCamera(66, ctx.width / Math.max(1, ctx.height), 0.2, 420);
    scene.add(camera);

    const hemi = new THREE.HemisphereLight(0xdff3ff, 0x8fb0c8, 1.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
    sun.position.set(-30, 60, -20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
    sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -40;
    sun.shadow.bias = -0.0015;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    scene.add(sun.target);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

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
    // 6. Procedural textures. Offscreen only — the runtime rejects
    //    document-created canvases; without OffscreenCanvas we fall back to
    //    flat colour (plainer, never blank). Gradients are painted as bands
    //    so every colour the validator sees is a literal or a computed
    //    fillStyle, never a stop it cannot resolve.
    // =====================================================================
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function paint(w, h, fn) {
      if (!CAN_BAKE) return null;
      let c = null;
      try { c = new OffscreenCanvas(w, h); } catch (_) { return null; }
      fn(c.getContext("2d"), w, h);
      return c;
    }
    function rng(seed) {
      let r = seed || 7;
      return () => { r = (r * 16807) % 2147483647; return (r & 0xffff) / 0xffff; };
    }
    function hex(n) { return "#" + (n >>> 0).toString(16).padStart(6, "0"); }
    function mixHex(a, b, t) {
      const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255;
      const br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
      return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
    }
    function texture(c, srgb) {
      if (!c) return null;
      const t = new THREE.CanvasTexture(c);
      if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    }
    const TEX = {
      // Vertical sky: top colour to horizon colour, then a pale band near the ground.
      sky: (top, mid, bot) => paint(8, 128, (g, w, h) => {
        for (let y = 0; y < h; y++) {
          const t = y / (h - 1);
          const c = t < 0.62 ? mixHex(top, mid, smooth(t / 0.62)) : mixHex(mid, bot, smooth((t - 0.62) / 0.38));
          g.fillStyle = hex(c);
          g.fillRect(0, y, w, 1);
        }
      }),
      // Windows for city blocks: lit and unlit panes on a pastel wall.
      windows: (wall, lit, dark, seed) => paint(64, 128, (g, w, h) => {
        g.fillStyle = hex(wall); g.fillRect(0, 0, w, h);
        const rand = rng(seed);
        for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) {
          g.fillStyle = hex(rand() < 0.55 ? lit : dark);
          g.fillRect(6 + c * 15, 6 + r * 15, 9, 10);
          g.fillStyle = "rgba(255,255,255,0.35)";
          g.fillRect(6 + c * 15, 6 + r * 15, 9, 3);
        }
      }),
      checker: () => paint(64, 64, (g, w, h) => {
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          g.fillStyle = (x + y) % 2 ? "#1b2a3a" : "#ffffff";
          g.fillRect(x * 16, y * 16, 16, 16);
        }
      }),
      // Icy sheen: pale blue with brighter streaks.
      ice: () => paint(64, 64, (g, w, h) => {
        g.fillStyle = "#a9dcff"; g.fillRect(0, 0, w, h);
        const rand = rng(5);
        g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 2;
        for (let i = 0; i < 14; i++) {
          g.beginPath(); const x = rand() * w, y = rand() * h;
          g.moveTo(x, y); g.lineTo(x + rand() * 30 - 15, y + rand() * 40 - 20); g.stroke();
        }
      }),
      // Rough cave rock.
      rock: () => paint(64, 64, (g, w, h) => {
        g.fillStyle = "#3a3556"; g.fillRect(0, 0, w, h);
        const rand = rng(23);
        for (let i = 0; i < 60; i++) {
          g.fillStyle = rand() < 0.5 ? "#443f66" : "#302b4a";
          g.beginPath(); g.arc(rand() * w, rand() * h, 2 + rand() * 6, 0, 6.28); g.fill();
        }
      }),
      // Subway tiles for the tunnel biome walls.
      tiles: () => paint(64, 64, (g, w, h) => {
        g.fillStyle = "#c9d6de"; g.fillRect(0, 0, w, h);
        g.strokeStyle = "#8ea3b0"; g.lineWidth = 2;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
          const off = (y % 2) * 16;
          g.strokeRect(x * 32 + off - 16, y * 16, 32, 16);
          g.strokeRect(x * 32 + off + 16, y * 16, 32, 16);
        }
        g.fillStyle = "#4b7bd6"; g.fillRect(0, 28, w, 8);
      })
    };

    // =====================================================================
    // 7. Biomes. Each stage is one biome; they cycle, and the second time
    //    round the sun goes down.
    // =====================================================================
    const BIOMES = [
      { id: "alpine", name: "ALPINE PASS", profile: "bowl", music: "sparkle",
        day: { skyTop: 0x4fa3e8, skyMid: 0xa9d8f5, skyBot: 0xf0f8ff, fog: 0xcfe6f6, sun: 0xfff4e0, sunI: 1.9, hemi: 0xdff3ff, ground: 0x8fb0c8, snow: 0xf7fbff, snowLow: 0xd8ebfa },
        night: { skyTop: 0x0f1a3a, skyMid: 0x3a4f8a, skyBot: 0x8fa5cf, fog: 0x6f86b3, sun: 0xbcd0ff, sunI: 1.1, hemi: 0x8fa5d8, ground: 0x2c3a5a, snow: 0xc9d6ee, snowLow: 0x9fb2d6 } },
      { id: "forest", name: "FROZEN FOREST", profile: "bowl", music: "cozy",
        day: { skyTop: 0x5fb0e8, skyMid: 0xbfe1f4, skyBot: 0xf4fbff, fog: 0xd6ebf5, sun: 0xfff6e6, sunI: 1.8, hemi: 0xe4f4ff, ground: 0x7e9db0, snow: 0xf8fcff, snowLow: 0xdaeefb },
        night: { skyTop: 0x101a30, skyMid: 0x2f4470, skyBot: 0x7f96bf, fog: 0x5d7399, sun: 0xaac4ff, sunI: 1.0, hemi: 0x7d94c4, ground: 0x26334d, snow: 0xc4d3ea, snowLow: 0x97acd0 } },
      { id: "city", name: "SNOWY CITY", profile: "street", music: "house",
        day: { skyTop: 0x6f8fb8, skyMid: 0xa8bdd0, skyBot: 0xe6eef5, fog: 0xc4d3df, sun: 0xfff0dc, sunI: 1.6, hemi: 0xdbe8f2, ground: 0x7f8f9f, snow: 0xf3f8fc, snowLow: 0xd4e2ec },
        night: { skyTop: 0x0b1226, skyMid: 0x27345c, skyBot: 0x6b7ca6, fog: 0x4b5a80, sun: 0x9fb6ff, sunI: 0.9, hemi: 0x7186b8, ground: 0x2a3550, snow: 0xbfcbe2, snowLow: 0x93a6c8 } },
      { id: "cave", name: "ICE CAVE", profile: "cave", music: "synthwave",
        day: { skyTop: 0x141838, skyMid: 0x2a2f6a, skyBot: 0x4a4f9a, fog: 0x2b2f66, sun: 0xa8c8ff, sunI: 1.2, hemi: 0x8a90ff, ground: 0x2a2450, snow: 0xcfd8ff, snowLow: 0x9aa6f0 },
        night: { skyTop: 0x0a0c22, skyMid: 0x1e1f4a, skyBot: 0x3a3a7a, fog: 0x1e2050, sun: 0x8fb0ff, sunI: 1.0, hemi: 0x7a80f0, ground: 0x1c1a40, snow: 0xbcc6ff, snowLow: 0x8a96e8 } }
    ];

    // Stage n (1-based) → its length and the biome that plays it.
    function stageLen(n) { return Math.min(1400, 480 + 140 * (n - 1)); }
    function stageStartD(n) { let d = 0; for (let i = 1; i < n; i++) d += stageLen(i); return d; }
    function stageAt(d) { let n = 1, s = 0; while (d >= s + stageLen(n)) { s += stageLen(n); n++; } return n; }
    function biomeOfStage(n) { return BIOMES[(n - 1) % BIOMES.length]; }
    function paletteOfStage(n) { const b = biomeOfStage(n); return ((n - 1) / BIOMES.length | 0) % 2 === 1 ? b.night : b.day; }
    let stage = 1;
    function currentBiome() { return biomeOfStage(stage); }

    // =====================================================================
    // 8. Track maths. The slope is a parametric surface: d runs along it,
    //    u runs across it. The centre line snakes, the base descends with a
    //    few rolling hills, and the cross-section is a bowl (alpine, forest,
    //    cave) or a kerbed street (city). Everything on the slope is placed
    //    through these functions, so the ground and the physics always agree.
    // =====================================================================
    const CURVE = [{ a: 11, k: Math.PI * 2 / 230, p: 0.7 }, { a: 3.2, k: Math.PI * 2 / 71, p: 2.1 }];
    function centerX(d) { let x = 0; for (const c of CURVE) x += c.a * Math.sin(d * c.k + c.p); return x; }
    function centerDX(d) { let x = 0; for (const c of CURVE) x += c.a * c.k * Math.cos(d * c.k + c.p); return x; }
    const SLOPE = 0.085;
    function baseY(d) { return -SLOPE * d + 2.0 * Math.sin(d * Math.PI * 2 / 150) + 0.8 * Math.sin(d * Math.PI * 2 / 43 + 1.3); }
    function baseDY(d) {
      return -SLOPE + 2.0 * Math.PI * 2 / 150 * Math.cos(d * Math.PI * 2 / 150) + 0.8 * Math.PI * 2 / 43 * Math.cos(d * Math.PI * 2 / 43 + 1.3);
    }
    const FLAT = 7.5;          // half-width of the flat floor
    const PROFILES = {
      bowl: (u) => { const a = Math.abs(u); if (a <= FLAT) return 0; const r = a - FLAT; return r < 7 ? 0.2 * r * r : 9.8 + (r - 7) * 1.25; },
      street: (u) => { const a = Math.abs(u); if (a <= 9) return 0; if (a <= 9.5) return (a - 9) / 0.5 * 0.28; return 0.28 + (a - 9.5) * 0.015; },
      cave: (u) => { const a = Math.abs(u); if (a <= FLAT) return 0; const r = a - FLAT; return r < 6 ? 0.25 * r * r : 9 + (r - 6) * 1.6; }
    };
    // Profile blends across a stage boundary so the seam is a ramp, not a cliff.
    function profileMix(d) {
      const n = stageAt(d);
      const s = stageStartD(n);
      const cur = biomeOfStage(n).profile;
      if (d - s < 24 && n > 1) return { a: biomeOfStage(n - 1).profile, b: cur, t: smooth((d - s) / 24) };
      return { a: cur, b: cur, t: 0 };
    }
    function bankAt(d, u) {
      const m = profileMix(d);
      if (m.t === 0) return PROFILES[m.a](u);
      return lerp(PROFILES[m.a](u), PROFILES[m.b](u), m.t);
    }
    function groundY(d, u) { return baseY(d) + bankAt(d, u); }
    function uLimit(d) { const m = profileMix(d); const lim = (p) => p === "street" ? 8.6 : 12.5; return lerp(lim(m.a), lim(m.b), m.t); }
    // World placement of a slope coordinate.
    const _t = new THREE.Vector3(), _r = new THREE.Vector3();
    function tangentAt(d, out) { const dx = centerDX(d); out.set(dx, 0, 1).normalize(); return out; }
    function rightAt(d, out) { tangentAt(d, _t); out.set(-_t.z, 0, _t.x); return out; }
    function worldOf(d, u, y, out) {
      rightAt(d, _r);
      out.set(centerX(d) + _r.x * u, y, d + _r.z * u);
      return out;
    }
    function headingAt(d) { return Math.atan2(centerDX(d), 1); }
    // Put a mesh on the slope: position, yaw along the track, optional pitch to the local slope.
    function placeOn(obj, d, u, yOff, pitchToSlope) {
      worldOf(d, u, groundY(d, u) + (yOff || 0), obj.position);
      obj.rotation.set(0, headingAt(d), 0);
      if (pitchToSlope) obj.rotation.x = -Math.atan(baseDY(d));
    }

    // =====================================================================
    // 9. Materials and mesh builders. Everything is a few primitives with
    //    flat shading — the low-poly, pastel look of the original.
    // =====================================================================
    const matCache = new Map();
    function mat(color, opts) {
      const key = color + "|" + JSON.stringify(opts || {});
      if (matCache.has(key)) return matCache.get(key);
      const o = Object.assign({ color, flatShading: true }, opts || {});
      const standard = !!o.standard;
      delete o.standard;
      const m = standard ? new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, o)) : new THREE.MeshLambertMaterial(o);
      m.userData.shared = true;
      matCache.set(key, m);
      return m;
    }
    function mesh(geo, material, cast, recv) {
      const m = new THREE.Mesh(geo, material);
      m.castShadow = !!cast; m.receiveShadow = !!recv;
      return m;
    }
    const GEO = {
      sphere: new THREE.SphereGeometry(1, 12, 10),
      sphereLo: new THREE.IcosahedronGeometry(1, 1),
      box: new THREE.BoxGeometry(1, 1, 1),
      cone: new THREE.ConeGeometry(1, 1, 8),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
      cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
      dodeca: new THREE.DodecahedronGeometry(1, 0),
      coin: new THREE.CylinderGeometry(0.55, 0.55, 0.16, 14),
      torus: new THREE.TorusGeometry(0.95, 0.34, 10, 20),
      ring: new THREE.TorusGeometry(1, 0.06, 6, 24)
    };

    // ---- the penguin --------------------------------------------------------
    function buildPenguin(suit) {
      const g = new THREE.Group();
      const body = mesh(GEO.sphere, mat(suit.body, { flatShading: false }), true);
      body.scale.set(0.5, 0.62, 0.46); body.position.y = 0.62; g.add(body);
      const belly = mesh(GEO.sphere, mat(suit.belly, { flatShading: false }), false);
      belly.scale.set(0.36, 0.48, 0.3); belly.position.set(0, 0.56, 0.2); g.add(belly);
      const eyeMat = mat(0xffffff, { flatShading: false }), pupil = mat(0x101018, { flatShading: false });
      for (const s of [-1, 1]) {
        const e = mesh(GEO.sphere, eyeMat); e.scale.setScalar(0.085); e.position.set(s * 0.15, 0.95, 0.36); g.add(e);
        const p = mesh(GEO.sphere, pupil); p.scale.setScalar(0.045); p.position.set(s * 0.15, 0.95, 0.43); g.add(p);
      }
      const beak = mesh(GEO.cone, mat(0xff9a2e), true);
      beak.scale.set(0.11, 0.24, 0.11); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.86, 0.52); g.add(beak);
      const wings = [];
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group(); pivot.position.set(s * 0.46, 0.78, 0);
        const w = mesh(GEO.sphere, mat(suit.body, { flatShading: false }), true);
        w.scale.set(0.09, 0.34, 0.2); w.position.set(s * 0.04, -0.28, 0);
        pivot.add(w); g.add(pivot); wings.push(pivot);
      }
      const footMat = mat(0xff9a2e);
      for (const s of [-1, 1]) {
        const f = mesh(GEO.box, footMat); f.scale.set(0.2, 0.06, 0.3); f.position.set(s * 0.2, 0.03, 0.2); g.add(f);
      }
      // hats
      if (suit.hat === "beanie") {
        const h = mesh(GEO.sphere, mat(suit.hatColor, { flatShading: false })); h.scale.set(0.42, 0.3, 0.4); h.position.y = 1.12; g.add(h);
        const band = mesh(GEO.cyl, mat(0xffffff, { flatShading: false })); band.scale.set(0.43, 0.08, 0.41); band.position.y = 1.05; g.add(band);
        const pom = mesh(GEO.sphere, mat(0xffffff, { flatShading: false })); pom.scale.setScalar(0.11); pom.position.y = 1.4; g.add(pom);
      } else if (suit.hat === "shades") {
        const bar = mesh(GEO.box, mat(suit.hatColor)); bar.scale.set(0.5, 0.11, 0.06); bar.position.set(0, 0.96, 0.42); g.add(bar);
      } else if (suit.hat === "crown") {
        const c = mesh(GEO.cyl6, mat(suit.hatColor, { emissive: 0x6a4a00 })); c.scale.set(0.3, 0.18, 0.3); c.position.y = 1.2; g.add(c);
        for (let i = 0; i < 6; i++) {
          const sp = mesh(GEO.cone, mat(suit.hatColor, { emissive: 0x6a4a00 })); sp.scale.set(0.07, 0.14, 0.07);
          sp.position.set(Math.cos(i / 6 * Math.PI * 2) * 0.27, 1.34, Math.sin(i / 6 * Math.PI * 2) * 0.27); g.add(sp);
        }
      }
      g.userData.wings = wings;
      g.userData.body = body;
      return g;
    }

    // ---- sleds ----------------------------------------------------------------
    function buildSled(s) {
      const g = new THREE.Group();
      const anim = {};
      if (s.id === "tube") {
        const t = mesh(GEO.torus, mat(s.color, { flatShading: false }), true);
        t.rotation.x = Math.PI / 2; t.position.y = 0.34; g.add(t);
        const disc = mesh(GEO.cyl, mat(0x1c4f8f, { flatShading: false }), false);
        disc.scale.set(0.7, 0.06, 0.7); disc.position.y = 0.2; g.add(disc);
        for (let i = 0; i < 4; i++) {
          const stripe = mesh(GEO.box, mat(0xffffff, { flatShading: false }));
          stripe.scale.set(0.22, 0.2, 0.7); stripe.position.set(Math.cos(i * Math.PI / 2) * 0.95, 0.42, Math.sin(i * Math.PI / 2) * 0.95);
          stripe.rotation.y = -i * Math.PI / 2; g.add(stripe);
        }
        anim.seat = 0.36;
      } else if (s.id === "board") {
        const b = mesh(GEO.box, mat(s.color, { flatShading: false }), true);
        b.scale.set(1.35, 0.14, 2.2); b.position.y = 0.2; g.add(b);
        const top = mesh(GEO.box, mat(0xffd1e8, { flatShading: false }));
        top.scale.set(1.0, 0.04, 1.7); top.position.y = 0.29; g.add(top);
        const nose = mesh(GEO.box, mat(s.color, { flatShading: false }), true);
        nose.scale.set(1.3, 0.14, 0.5); nose.position.set(0, 0.32, 1.25); nose.rotation.x = -0.5; g.add(nose);
        anim.seat = 0.3;
      } else if (s.id === "plane") {
        const body = mesh(GEO.box, mat(s.color), true);
        body.scale.set(0.9, 0.55, 2.4); body.position.y = 0.5; g.add(body);
        const wing = mesh(GEO.box, mat(s.color), true);
        wing.scale.set(3.4, 0.1, 0.8); wing.position.set(0, 0.5, 0.3); g.add(wing);
        for (const side of [-1, 1]) {
          const pontoon = mesh(GEO.cyl, mat(0xff7a3d), true);
          pontoon.rotation.x = Math.PI / 2; pontoon.scale.set(0.22, 1.0, 0.22); pontoon.position.set(side * 1.55, 0.45, 0.3); g.add(pontoon);
        }
        const tail = mesh(GEO.box, mat(0xff7a3d), true);
        tail.scale.set(0.12, 0.6, 0.5); tail.position.set(0, 0.95, -1.1); g.add(tail);
        const hub = new THREE.Group(); hub.position.set(0, 0.5, 1.25);
        for (let i = 0; i < 3; i++) {
          const blade = mesh(GEO.box, mat(0xf7c53a));
          blade.scale.set(0.1, 0.9, 0.06); blade.rotation.z = i * Math.PI * 2 / 3; blade.position.set(Math.sin(i * Math.PI * 2 / 3) * 0.0, 0, 0);
          hub.add(blade);
        }
        g.add(hub); anim.prop = hub;
        anim.seat = 0.75;
      } else {
        const body = mesh(GEO.cyl, mat(s.color, { flatShading: false }), true);
        body.rotation.x = Math.PI / 2; body.scale.set(0.55, 1.2, 0.55); body.position.y = 0.55; g.add(body);
        const nose = mesh(GEO.cone, mat(0xffffff, { flatShading: false }), true);
        nose.rotation.x = Math.PI / 2; nose.scale.set(0.55, 0.7, 0.55); nose.position.set(0, 0.55, 1.55); g.add(nose);
        for (let i = 0; i < 3; i++) {
          const fin = mesh(GEO.box, mat(0xffd54a), true);
          const a = i * Math.PI * 2 / 3 + Math.PI / 2;
          fin.scale.set(0.08, 0.6, 0.7);
          fin.position.set(Math.cos(a) * 0.65, 0.55 + Math.sin(a) * 0.65, -1.0);
          fin.rotation.z = a - Math.PI / 2; g.add(fin);
        }
        const flame = mesh(GEO.cone, mat(0xffb347, { emissive: 0xff6a00, flatShading: false }), false);
        flame.rotation.x = -Math.PI / 2; flame.scale.set(0.35, 0.9, 0.35); flame.position.set(0, 0.55, -1.7);
        g.add(flame); anim.flame = flame;
        anim.seat = 0.95;
      }
      g.userData.anim = anim;
      return g;
    }

    // ---- scenery and obstacles -------------------------------------------------
    function pineTree(h, palette) {
      const g = new THREE.Group();
      const trunk = mesh(GEO.cyl, mat(0x6b4a2e), true); trunk.scale.set(0.22, h * 0.25, 0.22); trunk.position.y = h * 0.12; g.add(trunk);
      const green = mat(pick([0x2f7a4e, 0x357f52, 0x2a6b46]));
      const white = mat(palette.snow, { flatShading: false });
      for (let i = 0; i < 3; i++) {
        const r = (1.5 - i * 0.38) * h / 4, y = h * 0.22 + i * h * 0.24, hh = h * 0.36;
        const c = mesh(GEO.cone, green, true); c.scale.set(r, hh, r); c.position.y = y + hh / 2; g.add(c);
        const cap = mesh(GEO.cone, white, false); cap.scale.set(r * 0.72, hh * 0.45, r * 0.72); cap.position.y = y + hh * 0.66; g.add(cap);
      }
      return g;
    }
    function roundTree(h, palette) {
      const g = new THREE.Group();
      const trunk = mesh(GEO.cyl, mat(0x8a5a3a), true); trunk.scale.set(0.28, h * 0.5, 0.28); trunk.position.y = h * 0.25; g.add(trunk);
      const crown = mesh(GEO.sphereLo, mat(pick([0x5fbf5a, 0x4caf50, 0x74c96a])), true);
      crown.scale.setScalar(h * 0.42); crown.position.y = h * 0.72; g.add(crown);
      const cap = mesh(GEO.sphereLo, mat(palette.snow, { flatShading: false }), false);
      cap.scale.set(h * 0.4, h * 0.2, h * 0.4); cap.position.y = h * 0.92; g.add(cap);
      return g;
    }
    function rock(size, palette, tint) {
      const g = new THREE.Group();
      const r = mesh(GEO.dodeca, mat(tint || 0x7c8794), true, true); r.scale.set(size, size * 0.75, size * 0.9); r.position.y = size * 0.5;
      r.rotation.set(rnd(0, 1), rnd(0, 6), rnd(0, 0.6)); g.add(r);
      const cap = mesh(GEO.dodeca, mat(palette.snow, { flatShading: false }), false); cap.scale.set(size * 0.7, size * 0.3, size * 0.65); cap.position.y = size * 1.05; g.add(cap);
      return g;
    }
    function snowman() {
      const g = new THREE.Group();
      const w = mat(0xffffff, { flatShading: false });
      const b1 = mesh(GEO.sphere, w, true); b1.scale.setScalar(0.75); b1.position.y = 0.7; g.add(b1);
      const b2 = mesh(GEO.sphere, w, true); b2.scale.setScalar(0.55); b2.position.y = 1.6; g.add(b2);
      const b3 = mesh(GEO.sphere, w, true); b3.scale.setScalar(0.4); b3.position.y = 2.3; g.add(b3);
      const nose = mesh(GEO.cone, mat(0xff8a2a)); nose.rotation.x = Math.PI / 2; nose.scale.set(0.08, 0.4, 0.08); nose.position.set(0, 2.32, 0.55); g.add(nose);
      const hat = mesh(GEO.cyl, mat(0x202030)); hat.scale.set(0.3, 0.35, 0.3); hat.position.y = 2.75; g.add(hat);
      const brim = mesh(GEO.cyl, mat(0x202030)); brim.scale.set(0.48, 0.05, 0.48); brim.position.y = 2.6; g.add(brim);
      const pupil = mat(0x101018);
      for (const s of [-1, 1]) { const e = mesh(GEO.sphere, pupil); e.scale.setScalar(0.05); e.position.set(s * 0.13, 2.4, 0.36); g.add(e); }
      for (const s of [-1, 1]) {
        const arm = mesh(GEO.cyl, mat(0x6b4a2e)); arm.scale.set(0.05, 0.9, 0.05); arm.position.set(s * 0.8, 1.75, 0); arm.rotation.z = s * 1.1; g.add(arm);
      }
      return g;
    }
    function log(width) {
      const g = new THREE.Group();
      const l = mesh(GEO.cyl, mat(0x7a5236), true); l.rotation.z = Math.PI / 2; l.scale.set(0.42, width, 0.42); l.position.y = 0.42; g.add(l);
      const snow = mesh(GEO.box, mat(0xffffff, { flatShading: false })); snow.scale.set(width * 0.95, 0.12, 0.5); snow.position.y = 0.8; g.add(snow);
      for (const s of [-1, 1]) { const end = mesh(GEO.cyl, mat(0xc9a27a)); end.rotation.z = Math.PI / 2; end.scale.set(0.3, 0.06, 0.3); end.position.set(s * width / 2, 0.42, 0); g.add(end); }
      return g;
    }
    function fence(width) {
      const g = new THREE.Group();
      const wood = mat(0xe6e9ee);
      const n = Math.max(2, Math.round(width / 1.4));
      for (let i = 0; i <= n; i++) {
        const p = mesh(GEO.box, wood, true); p.scale.set(0.16, 1.1, 0.16); p.position.set(-width / 2 + i * width / n, 0.55, 0); g.add(p);
      }
      for (const y of [0.45, 0.9]) { const r = mesh(GEO.box, wood, true); r.scale.set(width, 0.1, 0.1); r.position.y = y; g.add(r); }
      return g;
    }
    function car(color, long) {
      const g = new THREE.Group();
      const L = long ? 7 : 3.8, H = long ? 2.4 : 1.1;
      const body = mesh(GEO.box, mat(color), true); body.scale.set(2.0, H, L); body.position.y = H / 2 + 0.35; g.add(body);
      if (!long) {
        const cab = mesh(GEO.box, mat(0xbfe6ff), true); cab.scale.set(1.7, 0.8, 1.9); cab.position.set(0, 1.85, -0.2); g.add(cab);
      } else {
        const band = mesh(GEO.box, mat(0xbfe6ff)); band.scale.set(2.06, 0.8, L * 0.9); band.position.set(0, 1.9, 0); g.add(band);
      }
      const roof = mesh(GEO.box, mat(0xffffff, { flatShading: false })); roof.scale.set(long ? 2.0 : 1.6, 0.16, long ? L * 0.95 : 1.8); roof.position.set(0, long ? H + 0.45 : 2.3, long ? 0 : -0.2); g.add(roof);
      const wheel = mat(0x202028);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const w = mesh(GEO.cyl, wheel); w.rotation.z = Math.PI / 2; w.scale.set(0.4, 0.3, 0.4); w.position.set(sx * 1.0, 0.4, sz * L * 0.33); g.add(w);
      }
      const lamp = mat(0xfff2b0, { emissive: 0xffe08a });
      for (const s of [-1, 1]) { const l = mesh(GEO.box, lamp); l.scale.set(0.35, 0.2, 0.1); l.position.set(s * 0.7, 0.9, L / 2 + 0.02); g.add(l); }
      return g;
    }
    const WINDOW_TEX = {}, WINDOW_MAT = {};
    function building(w, h, depth, color, seed, night) {
      const g = new THREE.Group();
      let m;
      const key = (color + "|" + (night ? 1 : 0));
      let t = WINDOW_TEX[key];
      if (t === undefined) {
        t = texture(TEX.windows(color, night ? 0xffe9a8 : 0xbfe3ff, night ? 0x1a2238 : 0x6a8aa8, seed));
        WINDOW_TEX[key] = t;
      }
      if (t) {
        m = WINDOW_MAT[key];
        if (!m) { m = new THREE.MeshLambertMaterial({ map: t }); m.userData.shared = true; WINDOW_MAT[key] = m; }
      } else m = mat(color);
      const box = mesh(GEO.box, m, true, true); box.scale.set(w, h, depth); box.position.y = h / 2; g.add(box);
      const roof = mesh(GEO.box, mat(0xffffff, { flatShading: false })); roof.scale.set(w + 0.3, 0.35, depth + 0.3); roof.position.y = h + 0.15; g.add(roof);
      if (Math.random() < 0.5) {
        const unit = mesh(GEO.box, mat(0x9aa8b5)); unit.scale.set(w * 0.3, 1.2, depth * 0.3); unit.position.set(w * 0.2, h + 0.9, 0); g.add(unit);
      }
      return g;
    }
    function lampPost(night) {
      const g = new THREE.Group();
      const pole = mesh(GEO.cyl, mat(0x3b4a5a), true); pole.scale.set(0.09, 5, 0.09); pole.position.y = 2.5; g.add(pole);
      const arm = mesh(GEO.box, mat(0x3b4a5a)); arm.scale.set(0.9, 0.08, 0.08); arm.position.set(0.4, 5, 0); g.add(arm);
      const lamp = mesh(GEO.sphere, mat(0xfff0c0, { emissive: night ? 0xffd27a : 0x554422, flatShading: false })); lamp.scale.setScalar(0.28); lamp.position.set(0.85, 4.9, 0); g.add(lamp);
      return g;
    }
    function busStop() {
      const g = new THREE.Group();
      const post = mat(0x3b4a5a);
      for (const s of [-1, 1]) { const p = mesh(GEO.box, post, true); p.scale.set(0.12, 2.6, 0.12); p.position.set(s * 1.6, 1.3, -0.8); g.add(p); }
      const roof = mesh(GEO.box, mat(0x2b90e8), true); roof.scale.set(3.8, 0.14, 2.0); roof.position.y = 2.7; g.add(roof);
      const glass = mesh(GEO.box, new THREE.MeshLambertMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.45 })); glass.scale.set(3.4, 2.4, 0.06); glass.position.set(0, 1.3, -0.8); g.add(glass);
      const bench = mesh(GEO.box, mat(0x8a5a3a)); bench.scale.set(2.6, 0.12, 0.5); bench.position.set(0, 0.55, -0.3); g.add(bench);
      return g;
    }
    function crystal(color) {
      const g = new THREE.Group();
      const n = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const c = mesh(GEO.cone, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.6, flatShading: true, transparent: true, opacity: 0.88 }), false);
        const h = rnd(1.4, 3.6);
        c.scale.set(rnd(0.3, 0.6), h, rnd(0.3, 0.6)); c.position.set(rnd(-0.8, 0.8), h / 2 - 0.2, rnd(-0.8, 0.8));
        c.rotation.set(rnd(-0.3, 0.3), 0, rnd(-0.3, 0.3)); g.add(c);
      }
      return g;
    }
    function stalactite(len, palette) {
      const s = mesh(GEO.cone, mat(mixHex(palette.snowLow, 0x6a72c0, 0.4)), false);
      s.scale.set(rnd(0.5, 1.4), len, rnd(0.5, 1.4)); s.rotation.x = Math.PI; s.position.y = -len / 2;
      return s;
    }
    function icicleWall(h) {
      const g = new THREE.Group();
      const m = new THREE.MeshLambertMaterial({ color: 0xbfe3ff, emissive: 0x3050a0, emissiveIntensity: 0.25, flatShading: true });
      for (let i = 0; i < 4; i++) {
        const c = mesh(GEO.cone, m, true); const hh = h * rnd(0.6, 1.0);
        c.scale.set(rnd(0.35, 0.7), hh, rnd(0.35, 0.7)); c.position.set((i - 1.5) * 0.7, hh / 2, rnd(-0.2, 0.2)); g.add(c);
      }
      return g;
    }
    function wedgeGeometry(w, l, h) {
      // Triangular prism: flat at the near end, rising to h at the far end.
      const geo = new THREE.BufferGeometry();
      const x = w / 2;
      const v = [
        // top surface (quad)
        -x, 0, 0,  x, 0, 0,  x, h, l,   -x, 0, 0,  x, h, l,  -x, h, l,
        // back face
        -x, 0, l,  -x, h, l,  x, h, l,   -x, 0, l,  x, h, l,  x, 0, l,
        // sides
        -x, 0, 0,  -x, h, l,  -x, 0, l,
         x, 0, 0,   x, 0, l,   x, h, l,
        // bottom
        -x, 0, 0,  -x, 0, l,  x, 0, l,   -x, 0, 0,  x, 0, l,  x, 0, 0
      ];
      geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      geo.computeVertexNormals();
      return geo;
    }
    function ramp(w, l, h) {
      const g = new THREE.Group();
      const body = mesh(wedgeGeometry(w, l, h), mat(0xdff2ff, { flatShading: true }), true, true); g.add(body);
      const rail = mat(0xff6b3d);
      for (const s of [-1, 1]) {
        const r = mesh(wedgeGeometry(0.25, l, h + 0.25), rail, true); r.position.set(s * (w / 2 + 0.12), 0, 0); g.add(r);
      }
      for (let i = 1; i < 4; i++) {
        const stripe = mesh(GEO.box, mat(0x2b90e8, { flatShading: false }));
        stripe.scale.set(w * 0.9, 0.05, 0.3); stripe.position.set(0, h * i / 4 + 0.04, l * i / 4); stripe.rotation.x = -Math.atan2(h, l); g.add(stripe);
      }
      return g;
    }
    function icePatch(w, l) {
      let t = TEX._ice; if (t === undefined) { t = texture(TEX.ice()); TEX._ice = t; }
      const m = t ? new THREE.MeshStandardMaterial({ map: t, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 })
                  : new THREE.MeshStandardMaterial({ color: 0xa9dcff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
      const p = mesh(new THREE.PlaneGeometry(w, l), m, false, true);
      p.rotation.x = -Math.PI / 2;
      const g = new THREE.Group(); g.add(p);
      return g;
    }
    function powerCrate(kind) {
      const colors = { rocket: 0xff6b3d, magnet: 0xf0479c, shield: 0x4fc3f7, mult: 0xffd54a };
      const g = new THREE.Group();
      const c = colors[kind] || 0xffffff;
      const box = mesh(GEO.box, new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, flatShading: true }), true);
      box.scale.setScalar(1.1); g.add(box);
      const ring = mesh(GEO.ring, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 }));
      ring.scale.setScalar(1.25); g.add(ring);
      g.userData.ring = ring;
      return g;
    }
    function finishArch(palette, name) {
      const g = new THREE.Group();
      const post = mat(0xffffff, { flatShading: false });
      for (const s of [-1, 1]) { const p = mesh(GEO.cyl, post, true); p.scale.set(0.35, 7.5, 0.35); p.position.set(s * 8.6, 3.75, 0); g.add(p); }
      let t = TEX._check; if (t === undefined) { t = texture(TEX.checker()); TEX._check = t; }
      const banner = mesh(GEO.box, t ? new THREE.MeshLambertMaterial({ map: t }) : mat(0x1b2a3a), true);
      if (t) t.repeat.set(6, 1);
      banner.scale.set(17.6, 1.6, 0.25); banner.position.y = 7.2; g.add(banner);
      const line = mesh(GEO.box, t ? new THREE.MeshLambertMaterial({ map: t }) : mat(0x1b2a3a), false, true);
      line.scale.set(17.2, 0.06, 1.6); line.position.y = 0.05; g.add(line);
      for (const s of [-1, 1]) {
        const flag = mesh(GEO.box, mat(0xe8453c)); flag.scale.set(1.2, 0.8, 0.06); flag.position.set(s * 8.0, 8.4, 0); g.add(flag);
      }
      return g;
    }
    function mountain(h, palette, dark) {
      const g = new THREE.Group();
      const base = mesh(GEO.cone, mat(dark ? 0x3a4a63 : 0x6e86a3), false); base.scale.set(h * 0.95, h, h * 0.95); base.position.y = h / 2; g.add(base);
      const cap = mesh(GEO.cone, mat(palette.snow, { flatShading: false }), false); cap.scale.set(h * 0.4, h * 0.42, h * 0.4); cap.position.y = h * 0.79; g.add(cap);
      return g;
    }
    function cabin() {
      const g = new THREE.Group();
      const walls = mesh(GEO.box, mat(0x8a5a3a), true); walls.scale.set(4, 2.6, 3.2); walls.position.y = 1.3; g.add(walls);
      const roof = mesh(GEO.cone, mat(0xffffff, { flatShading: false }), true); roof.scale.set(3.2, 1.8, 3.2); roof.rotation.y = Math.PI / 4; roof.position.y = 3.5; g.add(roof);
      const win = mesh(GEO.box, mat(0xffe9a8, { emissive: 0xffc860 })); win.scale.set(0.8, 0.8, 0.1); win.position.set(0.8, 1.4, 1.62); g.add(win);
      const door = mesh(GEO.box, mat(0x4a2e1a)); door.scale.set(0.8, 1.6, 0.1); door.position.set(-0.9, 0.8, 1.62); g.add(door);
      const chimney = mesh(GEO.box, mat(0x6a6a72), true); chimney.scale.set(0.5, 1.4, 0.5); chimney.position.set(-1.2, 3.6, -0.4); g.add(chimney);
      return g;
    }

    // =====================================================================
    // 10. The rider: penguin + sled, rebuilt when the garage changes them.
    // =====================================================================
    const rider = new THREE.Group();     // placed on the slope each frame
    const riderTilt = new THREE.Group(); // roll/pitch/yaw for steering and tumbles
    rider.add(riderTilt);
    scene.add(rider);
    let penguin = null, sled = null, sledDef = SLEDS[0], suitDef = SUITS[0];
    const shieldBubble = mesh(GEO.sphere, new THREE.MeshLambertMaterial({ color: 0x8fdcff, emissive: 0x3aa0ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.32, flatShading: false }), false);
    shieldBubble.scale.setScalar(1.9); shieldBubble.position.y = 1.0; shieldBubble.visible = false;
    riderTilt.add(shieldBubble);
    const shadowBlob = mesh(new THREE.CircleGeometry(1.1, 18), new THREE.MeshBasicMaterial({ color: 0x1a3a5a, transparent: true, opacity: 0.22, depthWrite: false }), false);
    shadowBlob.rotation.x = -Math.PI / 2;
    scene.add(shadowBlob);
    function disposeGroup(g) {
      g.traverse((o) => { if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); });
    }
    function rebuildRider() {
      if (penguin) { riderTilt.remove(penguin); disposeGroup(penguin); }
      if (sled) { riderTilt.remove(sled); disposeGroup(sled); }
      sledDef = currentSled(); suitDef = currentSuit();
      sled = buildSled(sledDef);
      penguin = buildPenguin(suitDef);
      penguin.position.y = sled.userData.anim.seat;
      penguin.scale.setScalar(1.15);
      riderTilt.add(sled); riderTilt.add(penguin);
    }
    rebuildRider();

    // =====================================================================
    // 11. Coins are one InstancedMesh; each coin owns an instance slot.
    // =====================================================================
    const COIN_CAP = 700;
    const coinMesh = new THREE.InstancedMesh(GEO.coin, new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xa06a00, emissiveIntensity: 0.55, flatShading: false }), COIN_CAP);
    coinMesh.castShadow = true;
    coinMesh.frustumCulled = false;
    coinMesh.count = COIN_CAP;
    scene.add(coinMesh);
    const coinFree = [];
    for (let i = COIN_CAP - 1; i >= 0; i--) coinFree.push(i);
    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
    const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < COIN_CAP; i++) coinMesh.setMatrixAt(i, HIDE);
    coinMesh.instanceMatrix.needsUpdate = true;
    function coinShow(c, spin) {
      if (c.slot < 0) return;
      worldOf(c.d, c.u, c.y, _p);
      _e.set(Math.PI / 2, spin, 0, "YXZ");
      _q.setFromEuler(_e); _s.set(1, 1, 1);
      _m4.compose(_p, _q, _s);
      coinMesh.setMatrixAt(c.slot, _m4);
    }
    function coinHide(c) { if (c.slot >= 0) { coinMesh.setMatrixAt(c.slot, HIDE); coinFree.push(c.slot); c.slot = -1; } }

    // =====================================================================
    // 12. Chunks: 40 m of slope at a time — ground mesh, scenery,
    //     obstacles, pickups. Built ahead, recycled behind.
    // =====================================================================
    const CH = 40;
    const U_SAMPLES = [-30, -25, -21, -18, -15.5, -13.5, -12, -10.5, -9.5, -8.5, -7.5, -6, -4, -2, 0, 2, 4, 6, 7.5, 8.5, 9.5, 10.5, 12, 13.5, 15.5, 18, 21, 25, 30];
    const chunks = [];     // sorted by d0
    let genD = 0;          // next chunk start
    const snowMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    snowMat.userData.shared = true;
    const _c = new THREE.Color();
    function buildGround(d0, palette, profile) {
      const rows = CH / 2 + 1, cols = U_SAMPLES.length;
      const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3);
      const idx = [];
      const snow = new THREE.Color(palette.snow), low = new THREE.Color(palette.snowLow);
      const kerb = new THREE.Color(mixHex(palette.snow, 0x9aa8b5, 0.35));
      for (let r = 0; r < rows; r++) {
        const d = d0 + r * 2;
        for (let c = 0; c < cols; c++) {
          const u = U_SAMPLES[c];
          const y = groundY(d, u);
          worldOf(d, u, y, _p);
          const i = (r * cols + c) * 3;
          pos[i] = _p.x; pos[i + 1] = _p.y; pos[i + 2] = _p.z;
          const bank = y - baseY(d);
          let t = clamp(1 - Math.abs(u) / 9, 0, 1) * 0.55 + clamp(bank / 6, 0, 1) * 0.3;
          // faint sparkle / drift noise
          t += (Math.sin(d * 0.9 + u * 1.7) * Math.sin(d * 0.31 - u * 0.8)) * 0.08;
          _c.copy(snow).lerp(low, clamp(t, 0, 1));
          if (profile === "street" && Math.abs(u) > 9.2 && Math.abs(u) < 16) _c.lerp(kerb, 0.5);
          col[i] = _c.r; col[i + 1] = _c.g; col[i + 2] = _c.b;
        }
      }
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, cc = a + cols, dd = cc + 1;
        idx.push(a, b, cc, b, dd, cc);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, snowMat);
      m.receiveShadow = true;
      m.frustumCulled = false;
      return m;
    }
    function buildCeiling(d0, palette) {
      // An inverted bowl above the cave floor, dark and rocky.
      const rows = CH / 4 + 1, cols = 11;
      const pos = new Float32Array(rows * cols * 3), idx = [];
      for (let r = 0; r < rows; r++) {
        const d = d0 + r * 4;
        for (let c = 0; c < cols; c++) {
          const u = -30 + c * 6;
          const y = baseY(d) + 17 - 0.03 * u * u + Math.sin(d * 0.35 + u) * 0.8;
          worldOf(d, u, y, _p);
          const i = (r * cols + c) * 3; pos[i] = _p.x; pos[i + 1] = _p.y; pos[i + 2] = _p.z;
        }
      }
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, cc = a + cols, dd = cc + 1;
        idx.push(a, b, cc, b, dd, cc);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      let t = TEX._rock; if (t === undefined) { t = texture(TEX.rock()); TEX._rock = t; }
      const m = new THREE.Mesh(geo, t ? new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }) : mat(0x3a3556, { side: THREE.DoubleSide }));
      m.frustumCulled = false;
      return m;
    }

    // ---- difficulty ---------------------------------------------------------
    // Everything the generator needs to know about how hard the slope should
    // be at distance d, in one place. Stage drives density and variety;
    // distance drives speed, and spacing is a reaction-time budget so the
    // window to react stays fair however fast the sled is going.
    function targetSpeed(d, n) {
      return Math.min(36, 16 + Math.min(d, 4000) * 0.0036 + (n - 1) * 0.9);
    }
    function difficulty(d) {
      const n = stageAt(d);
      const sp = targetSpeed(d, n);
      const react = clamp(1.7 - (n - 1) * 0.11, 0.9, 1.7);
      return {
        stage: n, speed: sp,
        rowGap: react * sp,                       // metres between hazard rows
        density: clamp(0.45 + (n - 1) * 0.11, 0.45, 1.0),   // chance a row slot is used
        maxPer: Math.min(4, 1 + ((n + 1) / 2 | 0)),         // hazards per row
        latReach: (6.5 + 1.5) * react                       // how far the safe corridor may shift
      };
    }

    // ---- chunk generation -----------------------------------------------------
    let corridor = 0;          // where the guaranteed-safe line currently is
    let nextRowD = 60;         // first hazard row
    let nextPowerD = 160;
    let nextCoinD = 30;
    let lastRampD = -100;
    let lastKind = "";
    const hazardKinds = {
      alpine: ["tree", "tree", "rock", "log", "fence", "ramp", "snowman", "ice", "icicle"],
      forest: ["rtree", "rtree", "rtree", "log", "log", "rock", "ramp", "snowman", "fence"],
      city: ["car", "car", "bus", "fence", "ramp", "snowman", "ice", "log", "fence"],
      cave: ["rock", "rock", "icicle", "icicle", "log", "ramp", "ice", "crystal", "snowman"]
    };
    function addHazard(ch, kind, d, u, palette, diff) {
      const o = { kind, d, u, w: 1, h: 0.8, height: 6, low: false, soft: false, spent: false, mesh: null };
      let m = null;
      switch (kind) {
        case "tree": m = pineTree(rnd(5, 7.5), palette); o.w = 0.9; o.h = 0.9; o.height = 7; break;
        case "rtree": m = roundTree(rnd(4.5, 6), palette); o.w = 1.0; o.h = 1.0; o.height = 6; break;
        case "rock": m = rock(rnd(1.1, 1.7), palette, palette === BIOMES[3].day || palette === BIOMES[3].night ? 0x5a5580 : 0x7c8794); o.w = 1.4; o.h = 1.2; o.height = 1.9; break;
        case "log": { const w = rnd(5, 8); m = log(w); o.w = w / 2; o.h = 0.5; o.height = 0.9; o.low = true; break; }
        case "fence": { const w = rnd(4, 6.5); m = fence(w); o.w = w / 2; o.h = 0.3; o.height = 1.1; o.low = true; break; }
        case "car": m = car(pick([0xe8453c, 0x2b90e8, 0xf7c53a, 0x4ec9a0, 0xffffff, 0x8e6bd6])); o.w = 1.1; o.h = 2.0; o.height = 2.5; break;
        case "bus": m = car(pick([0xe8453c, 0xf7b733]), true); o.w = 1.1; o.h = 3.6; o.height = 3.0; break;
        case "snowman": m = snowman(); o.w = 0.8; o.h = 0.8; o.height = 2.6; o.soft = true; break;
        case "lamp": m = lampPost(palette !== biomeOfStage(diff.stage).day); o.w = 0.35; o.h = 0.35; o.height = 5; break;
        case "icicle": m = icicleWall(rnd(2.2, 3.4)); o.w = 1.5; o.h = 0.5; o.height = 3; break;
        case "crystal": m = crystal(pick([0x7ad7ff, 0xb39dff, 0xff8fd8])); o.w = 1.0; o.h = 1.0; o.height = 2.4; o.soft = true; break;
        case "ramp": {
          const w = 5.5, l = 9, h = 2.4;
          m = ramp(w, l, h);
          o.w = w / 2; o.h = l / 2; o.height = 0; o.ramp = { l, h, d0: d - l / 2 };
          o.d = d; // centre; the wedge itself starts at d - l/2
          break;
        }
        case "ice": {
          const w = rnd(6, 9), l = rnd(12, 18);
          m = icePatch(w, l); o.w = w / 2; o.h = l / 2; o.height = 0; o.ice = true; break;
        }
      }
      if (!m) return null;
      if (kind === "ramp") placeOn(m, o.d - o.ramp.l / 2, u, 0.02, true);
      else if (kind === "ice") placeOn(m, d, u, 0.04, true);
      else placeOn(m, d, u, 0, false);
      if (kind !== "ramp" && kind !== "ice") m.rotation.y += rnd(-0.4, 0.4);
      if (kind === "car" || kind === "bus") m.rotation.y = headingAt(d) + (Math.random() < 0.5 ? 0 : Math.PI) + rnd(-0.12, 0.12);
      o.mesh = m;
      ch.group.add(m);
      ch.hazards.push(o);
      return o;
    }
    function addCoin(ch, d, u, y) {
      if (!coinFree.length) return;
      const c = { d, u, y: y, slot: coinFree.pop(), taken: false, spin: Math.random() * 6 };
      ch.coins.push(c);
      coinShow(c, c.spin);
    }
    function coinLine(ch, d0, u0, n, gap, curve, arc, base) {
      for (let i = 0; i < n; i++) {
        const d = d0 + i * gap;
        const u = clamp(u0 + Math.sin(i / (n - 1) * Math.PI) * curve, -uLimit(d) + 1, uLimit(d) - 1);
        const lift = arc ? Math.sin(i / (n - 1) * Math.PI) * arc : 0;
        addCoin(ch, d, u, groundY(d, u) + 0.9 + (base || 0) + lift);
      }
    }
    function addPower(ch, d, u, kind) {
      const m = powerCrate(kind);
      placeOn(m, d, u, 1.4, false);
      ch.group.add(m);
      ch.powers.push({ kind, d, u, mesh: m, taken: false, phase: Math.random() * 6 });
    }
    function scatter(ch, d0, palette, stageN, night) {
      // Side dressing outside the play area: never collides with the sled.
      const b = biomeOfStage(stageN);
      const g = ch.group;
      const side = (u, obj, d) => { placeOn(obj, d, u, 0, false); obj.rotation.y += rnd(-0.6, 0.6); g.add(obj); };
      if (b.id === "alpine") {
        for (let i = 0; i < 7; i++) {
          const d = d0 + rnd(0, CH), s = Math.random() < 0.5 ? -1 : 1, u = s * rnd(13.5, 24);
          side(u, Math.random() < 0.75 ? pineTree(rnd(5, 9), palette) : rock(rnd(1.2, 2.4), palette), d);
        }
        if (Math.random() < 0.3) side((Math.random() < 0.5 ? -1 : 1) * rnd(18, 23), cabin(), d0 + rnd(5, 35));
        for (let i = 0; i < 2; i++) {
          const d = d0 + rnd(0, CH), s = Math.random() < 0.5 ? -1 : 1;
          const mtn = mountain(rnd(28, 60), palette, night); worldOf(d, s * rnd(70, 120), baseY(d) - 4, mtn.position); g.add(mtn);
        }
      } else if (b.id === "forest") {
        for (let i = 0; i < 12; i++) {
          const d = d0 + rnd(0, CH), s = Math.random() < 0.5 ? -1 : 1, u = s * rnd(13, 26);
          side(u, Math.random() < 0.7 ? roundTree(rnd(4, 7), palette) : pineTree(rnd(5, 8), palette), d);
        }
        if (Math.random() < 0.4) side((Math.random() < 0.5 ? -1 : 1) * rnd(14, 18), snowman(), d0 + rnd(5, 35));
        const mtn = mountain(rnd(24, 44), palette, night); worldOf(d0 + rnd(0, CH), (Math.random() < 0.5 ? -1 : 1) * rnd(70, 110), baseY(d0) - 6, mtn.position); g.add(mtn);
      } else if (b.id === "city") {
        for (const s of [-1, 1]) {
          let d = d0 + rnd(-2, 4);
          while (d < d0 + CH - 4) {
            const w = rnd(7, 12), h = rnd(9, 26), depth = rnd(8, 11);
            const bld = building(w, h, depth, pick([0xf1a7a0, 0xa7c8f1, 0xf5d8a1, 0xbfe4c8, 0xd9c2f0, 0xe5e9ef, 0xf6c1cf]), (d * 7 | 0) % 1000, night);
            placeOn(bld, d + w / 2, s * (17 + depth / 2), -0.2, false); bld.rotation.y = headingAt(d);
            g.add(bld);
            d += w + rnd(1, 3);
          }
          for (let i = 0; i < 2; i++) side(s * 11.5, lampPost(night), d0 + 8 + i * 22 + rnd(-3, 3));
          if (Math.random() < 0.35) { const bs = busStop(); placeOn(bs, d0 + rnd(6, 34), s * 12.6, 0, false); bs.rotation.y = headingAt(d0) + (s < 0 ? Math.PI : 0); g.add(bs); }
          if (Math.random() < 0.5) side(s * rnd(11.5, 13.5), roundTree(rnd(3.5, 5), palette), d0 + rnd(0, CH));
        }
      } else if (b.id === "cave") {
        ch.group.add(buildCeiling(d0, palette));
        for (let i = 0; i < 6; i++) {
          const d = d0 + rnd(0, CH), u = rnd(-22, 22);
          const st = stalactite(rnd(2, 7), palette);
          const y = baseY(d) + 17 - 0.03 * u * u + Math.sin(d * 0.35 + u) * 0.8 - 0.3;
          worldOf(d, u, y, st.position); g.add(st);
        }
        for (let i = 0; i < 4; i++) {
          const d = d0 + rnd(0, CH), s = Math.random() < 0.5 ? -1 : 1;
          side(s * rnd(12.5, 22), Math.random() < 0.6 ? crystal(pick([0x7ad7ff, 0xb39dff, 0xff8fd8, 0x8fffc8])) : rock(rnd(1.4, 2.6), palette, 0x5a5580), d);
        }
      }
    }
    function buildChunk(d0) {
      const stageN = stageAt(d0 + CH / 2);
      const b = biomeOfStage(stageN);
      const palette = paletteOfStage(stageN);
      const night = palette === b.night;
      const ch = { d0, d1: d0 + CH, group: new THREE.Group(), hazards: [], coins: [], powers: [], finish: null, stage: stageN };
      ch.group.add(buildGround(d0, palette, b.profile));
      scatter(ch, d0, palette, stageN, night);

      // Finish arch where a stage ends inside this chunk.
      // The finish of whichever stage is running at the chunk's start. A
      // finish on the far edge belongs to this chunk, so a stage boundary
      // that coincides with a chunk boundary (the common case) is not lost.
      const stage0 = stageAt(d0);
      const endD = stageStartD(stage0) + stageLen(stage0);
      if (endD > d0 && endD <= d0 + CH) {
        const arch = finishArch(palette, b.name);
        placeOn(arch, endD, 0, 0, false);
        ch.group.add(arch);
        ch.finish = { d: endD, stage: stage0, done: false };
      }

      // Hazard rows. Keep a clear corridor that never jumps further than the
      // sled can steer between rows, so every layout is survivable.
      const diff = difficulty(d0);
      while (nextRowD < d0 + CH) {
        const d = nextRowD;
        if (d >= d0) {
          const nearFinish = Math.abs(d - endD) < 16 || (d - stageStartD(stageN)) < 30;
          if (!nearFinish) {
            const lim = uLimit(d) - 1.2;
            corridor = clamp(corridor + rnd(-diff.latReach, diff.latReach), -lim + 1.5, lim - 1.5);
            const kinds = hazardKinds[b.id];
            let kind = pick(kinds);
            if (kind === lastKind && Math.random() < 0.6) kind = pick(kinds);
            if (kind === "ramp" && d - lastRampD < 90) kind = pick(kinds.filter((k) => k !== "ramp"));
            lastKind = kind;
            if (kind === "ramp") {
              lastRampD = d;
              const u = clamp(corridor, -lim + 3, lim - 3);
              addHazard(ch, "ramp", d, u, palette, diff);
              coinLine(ch, d + 5, u, 8, 2.4, 0, 2.6, 2.2);
              nextRowD = d + diff.rowGap * 1.6 + 26;   // airtime
              continue;
            }
            if (kind === "ice") {
              addHazard(ch, "ice", d, clamp(corridor + rnd(-2, 2), -lim + 4, lim - 4), palette, diff);
              nextRowD = d + diff.rowGap * 0.9;
              continue;
            }
            if (kind === "log" || kind === "fence") {
              // Wide and low: goes across most of the slope, sometimes with a gap.
              const w = kind === "log" ? rnd(5, 8) : rnd(4, 6.5);
              const gapSide = Math.random() < 0.5 ? -1 : 1;
              const u = Math.random() < 0.45 ? clamp(corridor + gapSide * (w / 2 + 2.6), -lim, lim) : corridor;
              addHazard(ch, kind, d, u, palette, diff);
              if (Math.random() < 0.5) coinLine(ch, d - 4, corridor, 5, 2.2, 0, 1.6);
            } else {
              // Scatter a few hard hazards, never inside the corridor.
              const n = 1 + (Math.random() * diff.maxPer | 0);
              const used = [];
              for (let i = 0; i < n; i++) {
                if (Math.random() > diff.density && i > 0) continue;
                let u = rnd(-lim, lim), tries = 0;
                while (tries++ < 12 && (Math.abs(u - corridor) < 3.4 || used.some((x) => Math.abs(x - u) < 3.2))) u = rnd(-lim, lim);
                if (tries >= 12) continue;
                used.push(u);
                let k = kind;
                if (k === "snowman" && i > 0) k = pick(kinds.filter((x) => x !== "ramp" && x !== "ice" && x !== "log" && x !== "fence"));
                addHazard(ch, k, d + rnd(-2, 2), u, palette, diff);
              }
              if (kind === "snowman" && Math.random() < 0.5) addHazard(ch, "snowman", d + rnd(6, 10), corridor + rnd(-1, 1), palette, diff);
            }
          }
        }
        nextRowD += diff.rowGap * rnd(0.85, 1.2);
      }
      // Coin runs along the corridor between rows.
      while (nextCoinD < d0 + CH) {
        if (nextCoinD >= d0 && Math.abs(nextCoinD - endD) > 14) {
          const lim = uLimit(nextCoinD) - 2;
          coinLine(ch, nextCoinD, clamp(corridor + rnd(-3, 3), -lim, lim), 5 + (Math.random() * 4 | 0), 2.2, rnd(-3, 3), 0);
        }
        nextCoinD += rnd(28, 46);
      }
      // A powerup every so often, sitting in the corridor.
      while (nextPowerD < d0 + CH) {
        if (nextPowerD >= d0 && Math.abs(nextPowerD - endD) > 14) {
          const lim = uLimit(nextPowerD) - 2;
          addPower(ch, nextPowerD, clamp(corridor, -lim, lim), pick(["rocket", "magnet", "shield", "mult", "magnet", "shield"]));
        }
        nextPowerD += rnd(170, 260);
      }
      scene.add(ch.group);
      chunks.push(ch);
      return ch;
    }
    function disposeChunk(ch) {
      for (const c of ch.coins) coinHide(c);
      scene.remove(ch.group);
      ch.group.traverse((o) => {
        if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose();
        if (o.material && !(o.material.userData && o.material.userData.shared)) o.material.dispose();
      });
    }
    function ensureChunks(d) {
      while (genD < d + 250) { buildChunk(genD); genD += CH; }
      while (chunks.length && chunks[0].d1 < d - 45) disposeChunk(chunks.shift());
      coinMesh.instanceMatrix.needsUpdate = true;
    }
    function resetTrack() {
      for (const ch of chunks) disposeChunk(ch);
      chunks.length = 0;
      genD = -40; corridor = 0; nextRowD = 70; nextPowerD = 150; nextCoinD = 34; lastRampD = -100; lastKind = "";
      coinMesh.instanceMatrix.needsUpdate = true;
    }

    // =====================================================================
    // 13. Sky, snowfall, spray, and the trail the sled leaves.
    // =====================================================================
    const skyCache = new Map();
    let curPalette = null;
    function applyPalette(pal, instant) {
      curPalette = pal;
      scene.fog.color.setHex(pal.fog);
      renderer.setClearColor(pal.fog, 1);
      const key = pal.skyTop + ":" + pal.skyMid + ":" + pal.skyBot;
      if (!skyCache.has(key)) skyCache.set(key, texture(TEX.sky(pal.skyTop, pal.skyMid, pal.skyBot)));
      const t = skyCache.get(key);
      scene.background = t || new THREE.Color(pal.skyMid);
      sun.color.setHex(pal.sun); sun.intensity = pal.sunI;
      hemi.color.setHex(pal.hemi); hemi.groundColor.setHex(pal.ground);
      const cave = pal === BIOMES[3].day || pal === BIOMES[3].night;
      scene.fog.near = cave ? 30 : 80; scene.fog.far = cave ? 150 : 250;
    }

    // Snowfall: a box of points that rides along with the camera.
    const SNOW_N = 420;
    const snowPos = new Float32Array(SNOW_N * 3), snowVel = new Float32Array(SNOW_N);
    for (let i = 0; i < SNOW_N; i++) { snowPos[i * 3] = rnd(-30, 30); snowPos[i * 3 + 1] = rnd(-10, 30); snowPos[i * 3 + 2] = rnd(4, 70); snowVel[i] = rnd(2.5, 5); }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
    const flakeTex = texture(paint(32, 32, (g, w, h) => {
      for (let r = 16; r > 0; r -= 2) { g.fillStyle = "rgba(255,255,255," + (0.14 + (1 - r / 16) * 0.9).toFixed(2) + ")"; g.beginPath(); g.arc(16, 16, r, 0, 6.29); g.fill(); }
    }), false);
    const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.42, transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true, map: flakeTex || null, alphaTest: 0.05 }));
    snowPts.frustumCulled = false;
    scene.add(snowPts);

    // Spray: short-lived snow puffs kicked up by carving and landing.
    const SPRAY_N = 160;
    const sprayPos = new Float32Array(SPRAY_N * 3);
    const spray = [];
    for (let i = 0; i < SPRAY_N; i++) { spray.push({ life: 0, vx: 0, vy: 0, vz: 0 }); sprayPos[i * 3 + 1] = -999; }
    const sprayGeo = new THREE.BufferGeometry();
    sprayGeo.setAttribute("position", new THREE.BufferAttribute(sprayPos, 3));
    const sprayPts = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0.9, depthWrite: false, map: flakeTex || null, alphaTest: 0.05 }));
    sprayPts.frustumCulled = false;
    scene.add(sprayPts);
    let sprayNext = 0;
    const _w = new THREE.Vector3();
    function emitSpray(pos, n, spread, up, back) {
      for (let k = 0; k < n; k++) {
        const i = sprayNext; sprayNext = (sprayNext + 1) % SPRAY_N;
        const s = spray[i];
        s.life = rnd(0.35, 0.7);
        s.vx = rnd(-spread, spread); s.vy = rnd(up * 0.5, up); s.vz = rnd(-back, back * 0.2);
        sprayPos[i * 3] = pos.x + rnd(-0.4, 0.4); sprayPos[i * 3 + 1] = pos.y + 0.2; sprayPos[i * 3 + 2] = pos.z + rnd(-0.4, 0.4);
      }
    }

    // Trail: a ribbon of the last hundred ground contacts, blue on white.
    const TRAIL_N = 110;
    const trailPos = new Float32Array(TRAIL_N * 2 * 3), trailAlpha = new Float32Array(TRAIL_N * 2);
    const trailIdx = [];
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; trailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute("alpha", new THREE.BufferAttribute(trailAlpha, 1));
    trailGeo.setIndex(trailIdx);
    const trailMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { color: { value: new THREE.Color(0x6db9ff) } },
      vertexShader: "attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA * 0.34);\n#include <colorspace_fragment>\n}"
    });
    const trailMesh = new THREE.Mesh(trailGeo, trailMat);
    trailMesh.frustumCulled = false;
    scene.add(trailMesh);
    const trail = [];  // {d,u,ground:boolean}
    let trailLastD = -10;
    function trailReset() { trail.length = 0; trailLastD = -10; for (let i = 0; i < trailAlpha.length; i++) trailAlpha[i] = 0; trailGeo.attributes.alpha.needsUpdate = true; }
    function trailPush(d, u, grounded) {
      if (d - trailLastD < 0.6) return;
      trailLastD = d;
      trail.push({ d, u, g: grounded });
      if (trail.length > TRAIL_N) trail.shift();
      for (let i = 0; i < TRAIL_N; i++) {
        const p = trail[trail.length - TRAIL_N + i];
        const a2 = i * 2;
        if (!p) { trailAlpha[a2] = trailAlpha[a2 + 1] = 0; continue; }
        const y = groundY(p.d, p.u) + 0.06;
        worldOf(p.d, p.u - 0.55, y, _w); trailPos[a2 * 3] = _w.x; trailPos[a2 * 3 + 1] = _w.y; trailPos[a2 * 3 + 2] = _w.z;
        worldOf(p.d, p.u + 0.55, y, _w); trailPos[(a2 + 1) * 3] = _w.x; trailPos[(a2 + 1) * 3 + 1] = _w.y; trailPos[(a2 + 1) * 3 + 2] = _w.z;
        const fade = Math.pow(i / TRAIL_N, 1.6);
        trailAlpha[a2] = trailAlpha[a2 + 1] = p.g ? fade : 0;
      }
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.alpha.needsUpdate = true;
    }

    // =====================================================================
    // 14. Player state, powerups, controls.
    // =====================================================================
    const G = 24;
    const P = {
      d: 0, u: 0, y: 0, vy: 0, vu: 0, speed: 0, grounded: true, airTime: 0, onRamp: null,
      dead: false, invuln: 0, iceT: 0, bumpT: 0, tumble: 0, wallCd: 0, uTarget: 0, steering: false
    };
    const pw = { rocket: 0, magnet: 0, shield: 0, mult: 0 };
    const pwMax = { rocket: 1, magnet: 1, shield: 1, mult: 1 };
    let runScore = 0, runCoins = 0, runDist = 0, revives = 0, runTime = 0, bestAir = 0, stagesCleared = 0;
    let hintShown = true, scoreTick = 0, shake = 0;

    function stageMult() { return 1 + 0.25 * (stage - 1); }

    let touch = null;
    function onDown(e) {
      if (state !== "run") return;
      firstGesture();
      touch = { x: e.clientX, y: e.clientY, u0: P.u, t: e.timeStamp || performance.now(), moved: false };
      P.steering = true; P.uTarget = P.u;
      if (!hintShown) { hintShown = true; store.set("hint", 1); el.hint.classList.remove("show"); }
    }
    function onMove(e) {
      if (!touch || state !== "run") return;
      const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
      if (!touch.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (!touch.moved && dy < -34 && Math.abs(dy) > Math.abs(dx) * 1.4) { touch.moved = true; touch.swipedUp = true; doHop(); return; }
      touch.moved = true;
      // Finger travel across ~55% of the screen sweeps the whole slope.
      P.uTarget = touch.u0 + dx * (24 / Math.max(240, ctx.width * 0.7));
    }
    function onUp(e) {
      if (!touch) return;
      const held = (e.timeStamp || performance.now()) - touch.t;
      if (!touch.moved && held < 260 && state === "run") doHop();
      touch = null;
      P.steering = false;
    }
    ctx.listen(canvas, "pointerdown", onDown);
    ctx.listen(canvas, "pointermove", onMove);
    ctx.listen(canvas, "pointerup", onUp);
    ctx.listen(canvas, "pointercancel", onUp);

    function doHop() {
      if (state !== "run" || P.dead || !P.grounded) return;
      P.grounded = false; P.onRamp = null;
      P.vy = 8.2 * sledDef.jump;
      P.airTime = 0;
      sfx.hop(); haptic("light");
      emitSpray(rider.position, 6, 2.5, 3, 2);
      try { ctx.platform.interact({ type: "hop" }); } catch (_) {}
    }

    function givePower(kind) {
      sfx.powerup(kind); haptic("success"); flash(el.flashGood);
      if (kind === "rocket") { pw.rocket = upVal("rocket"); pwMax.rocket = pw.rocket; toast("🚀 ROCKET!"); }
      else if (kind === "magnet") { pw.magnet = upVal("magnet"); pwMax.magnet = pw.magnet; toast("🧲 Magnet!"); }
      else if (kind === "shield") { pw.shield = upVal("shield"); pwMax.shield = pw.shield; toast("🛡️ Shield!"); }
      else { pw.mult = upVal("mult"); pwMax.mult = pw.mult; toast("✨ Double points!"); }
      renderPowerHud();
      try { ctx.platform.interact({ type: "powerup", kind }); } catch (_) {}
    }
    const PW_META = { rocket: "🚀", magnet: "🧲", shield: "🛡️", mult: "✨" };
    const pwBars = {};
    function renderPowerHud() {
      el.pw.innerHTML = "";
      for (const k in pw) {
        if (pw[k] <= 0) continue;
        const chip = document.createElement("div");
        chip.className = "ss-pwchip";
        chip.innerHTML = PW_META[k] + '<div class="ss-pwbar"><i></i></div>';
        el.pw.appendChild(chip);
        pwBars[k] = chip.querySelector("i");
      }
    }
    function tickPowerHud() {
      for (const k in pw) {
        if (pw[k] > 0 && pwBars[k]) pwBars[k].style.transform = "scaleX(" + clamp(pw[k] / pwMax[k], 0, 1) + ")";
      }
    }

    // =====================================================================
    // 15. Run lifecycle.
    // =====================================================================
    function resetRunState() {
      resetTrack();
      P.d = 0; P.u = 0; P.vu = 0; P.vy = 0; P.grounded = true; P.airTime = 0; P.onRamp = null;
      P.dead = false; P.invuln = 0; P.iceT = 0; P.bumpT = 0; P.tumble = 0; P.wallCd = 0; P.uTarget = 0; P.steering = false;
      P.speed = 13 * sledDef.speed;
      P.y = groundY(0, 0);
      for (const k in pw) pw[k] = 0;
      const head = upVal("head");
      if (head > 0) { pw.rocket = head; pwMax.rocket = head; }
      stage = 1;
      runScore = 0; runCoins = 0; runDist = 0; revives = 0; runTime = 0; bestAir = 0; stagesCleared = 0; coinPitch = 0;
      banked = false;
      setStageLabel();
      touch = null;
      trailReset();
      ensureChunks(0);
      applyPalette(paletteOfStage(1), true);
      riderTilt.rotation.set(0, 0, 0);
      camInit = false;
    }
    function startRun() {
      el.dead.classList.add("ss-hidden");
      el.garage.classList.add("ss-hidden");
      el.menu.classList.add("ss-hidden");
      el.hud.classList.remove("ss-hidden");
      el.pauseBtn.classList.remove("ss-hidden");
      el.bg.style.opacity = "0";
      resetRunState();
      rider.visible = true; shadowBlob.visible = true;
      state = "run";
      updateHud(); renderPowerHud();
      bed(currentBiome().music, 0.26);
      if (!store.get("hint", 0)) {
        hintShown = false;
        el.hint.classList.add("show");
        ctx.timeout(() => el.hint.classList.remove("show"), 4500);
      }
      try { ctx.platform.setProgress(0); ctx.platform.interact({ type: "run_start", sled: sledDef.id }); } catch (_) {}
    }
    function pauseRun() {
      if (state !== "run") return;
      state = "paused";
      touch = null; P.steering = false;
      sfx.ui();
      setWind(0, 600);
      el.pause.classList.remove("ss-hidden");
      try { if (canMusic && ctx.music && musicOn && !muted) ctx.music.setVolume(0.08, { fadeMs: 250 }); } catch (_) {}
    }
    function resumeRun() {
      el.pause.classList.add("ss-hidden");
      if (state === "paused") state = "run";
      try { if (canMusic && ctx.music && musicOn && !muted) ctx.music.setVolume(0.26, { fadeMs: 250 }); } catch (_) {}
    }
    function quitToMenu() {
      if (runDist > 20) bankRun("quit");
      resetTrack();
      showMenu();
    }
    function updateHud() {
      el.dist.textContent = fmt(runDist) + "m";
      el.score.textContent = fmt(runScore) + " pts";
      el.coins.textContent = fmt(runCoins);
      const m = stageMult() * (pw.mult > 0 ? 2 : 1);
      el.mult.textContent = "×" + (Math.round(m * 100) / 100);
      const s0 = stageStartD(stage), len = stageLen(stage);
      const pct = clamp((P.d - s0) / len, 0, 1);
      el.pFill.style.height = (pct * 100) + "%";
      el.pBub.style.bottom = (pct * 100) + "%";
      el.pBub.textContent = Math.round(pct * 100) + "%";
    }
    function setStageLabel() { el.stage.textContent = "STAGE " + stage + " · " + currentBiome().name; }

    function stageClear(fin) {
      fin.done = true;
      stagesCleared += 1;
      const bonus = 300 * fin.stage;
      runScore += bonus;
      stage = fin.stage + 1;
      setStageLabel();
      bigText("STAGE " + fin.stage + " CLEAR", "+" + fmt(bonus) + " · " + currentBiome().name, 2000);
      confetti(); sfx.stage(); haptic("success"); flash(el.flashGood);
      applyPalette(paletteOfStage(stage), false);
      bed(currentBiome().music, 0.26);
      if (stage > store.get("best_stage", 1)) store.set("best_stage", stage);
      el.mult.classList.remove("pop"); void el.mult.offsetWidth; el.mult.classList.add("pop");
      try { ctx.platform.milestone("stage_clear", { stage: fin.stage, score: Math.floor(runScore) }); } catch (_) {}
    }

    // Bank coins and send scores. Called once per ended run (death or quit).
    let banked = false;
    function bankRun(cause) {
      if (banked) return null;
      banked = true;
      const score = Math.floor(runScore), dist = Math.floor(runDist);
      wallet.addCoins(runCoins);
      const isBest = score > store.get("best_score", 0);
      if (isBest) store.set("best_score", score);
      if (dist > store.get("best_distance", 0)) store.set("best_distance", dist);
      refreshWallet();
      let pending = 2, failed = false;
      const result = { isBest, note: null, done: () => {} };
      const done = () => {
        if (--pending > 0) return;
        result.done(failed);
      };
      try {
        ctx.platform.setScore(score);
        ctx.memory.record("score").submit(score, { label: fmt(score) + " pts" }).then(done).catch(() => { failed = true; done(); });
        ctx.memory.record("distance").submit(dist, { label: fmt(dist) + " m" }).then(done).catch(() => { failed = true; done(); });
      } catch (_) { failed = true; pending = 0; result.done(true); }
      if (cause === "quit") { try { ctx.platform.complete({ cause, score, distance: dist, stage }); } catch (_) {} }
      return result;
    }

    // A single runtime-owned ticker drives the revive countdown.
    const saveState = { left: 0, arc: null, num: null, btn: null };
    ctx.interval(() => {
      if (saveState.left <= 0) return;
      saveState.left -= 1;
      if (saveState.num) saveState.num.textContent = String(Math.max(0, saveState.left));
      if (saveState.arc) saveState.arc.style.strokeDashoffset = String(175.9 * (1 - saveState.left / 5));
      if (saveState.left <= 0 && saveState.btn) { saveState.btn.disabled = true; saveState.btn.textContent = "Too slow…"; }
    }, 1000);

    function die(cause) {
      if (P.dead) return;
      P.dead = true;
      state = "dying";
      touch = null; P.steering = false;
      P.tumble = 0;
      shake = 1;
      sfx.crash(); haptic("error");
      flash(el.flashHurt);
      emitSpray(rider.position, 40, 6, 7, 5);
      setWind(0, 600);
      try { if (canMusic && ctx.music && musicOn && !muted) ctx.music.duck(0.7, 1200); } catch (_) {}
      ctx.timeout(() => showResults(cause), 1300);
    }
    function showResults(cause) {
      state = "dead";
      el.hud.classList.add("ss-hidden");
      el.pauseBtn.classList.add("ss-hidden");
      const score = Math.floor(runScore), dist = Math.floor(runDist);
      const reviveCost = 120 * Math.pow(2, revives);
      const canRevive = revives < 2 && (wallet.coins + runCoins) >= reviveCost;
      const wasBest = score > store.get("best_score", 0);
      const causeText = { tree: "Wrapped around a tree", rtree: "Wrapped around a tree", rock: "Kissed a boulder", car: "Met a parked car", bus: "Met a bus", fence: "Splintered a fence",
        log: "Tripped on a log", icicle: "Speared by icicles", lamp: "Hugged a lamp post", crystal: "Cracked a crystal", test: "Wiped out" }[cause] || "Wiped out";
      el.deadPanel.innerHTML = `
        <div class="big">🐧💫</div>
        <h2>${wasBest ? "New best!" : "Wipeout!"}</h2>
        <div style="font-size:12.5px;opacity:.7;margin-bottom:10px;">${esc(causeText)} · stage ${stage}</div>
        ${wasBest ? '<div class="ss-best">★ PERSONAL BEST ★</div>' : ""}
        <div class="ss-stat"><span>Distance</span><b>${fmt(dist)} m</b></div>
        <div class="ss-stat"><span>Score</span><b>${fmt(score)}</b></div>
        <div class="ss-stat"><span>Coins</span><b>🪙 ${fmt(runCoins)}</b></div>
        ${bestAir > 0.7 ? `<div class="ss-stat"><span>Longest air</span><b>${(Math.round(bestAir * 10) / 10)} s</b></div>` : ""}
        ${canRevive ? `
          <div class="ss-save">
            <div class="ss-ring">
              <svg width="66" height="66"><circle cx="33" cy="33" r="28" fill="none" stroke="rgba(40,120,200,.15)" stroke-width="6"/>
              <circle id="ringArc" cx="33" cy="33" r="28" fill="none" stroke="#f7b733" stroke-width="6"
                stroke-linecap="round" stroke-dasharray="175.9" stroke-dashoffset="0"/></svg>
              <div class="t" id="ringNum">5</div>
            </div>
            <p>Keep sliding from here?</p>
            <button class="ss-btn gold" id="btnSave" style="margin-bottom:0;">🪙 ${fmt(reviveCost)}  Second chance</button>
          </div>` : ""}
        <div style="height:6px;"></div>
        <button class="ss-btn" id="btnAgain">Slide again</button>
        <button class="ss-btn ghost" id="btnMenu2" style="margin-bottom:0;">Menu</button>
        <div id="subNote" style="font-size:11.5px;opacity:.6;margin-top:10px;">Saving your score…</div>`;
      el.dead.classList.remove("ss-hidden");

      const note = el.deadPanel.querySelector("#subNote");
      const res = bankRun(cause);
      if (res) res.done = (failed) => { if (note) note.textContent = failed ? "Couldn't reach the leaderboard." : "✓ Saved to the leaderboard"; };
      else if (note) note.textContent = "";
      try { ctx.platform.fail({ cause, score, distance: dist, stage }); } catch (_) {}

      ctx.listen(el.deadPanel.querySelector("#btnAgain"), "click", () => { sfx.ui(); startRun(); });
      ctx.listen(el.deadPanel.querySelector("#btnMenu2"), "click", () => { sfx.ui(); el.dead.classList.add("ss-hidden"); resetTrack(); showMenu(); });

      const saveBtn = el.deadPanel.querySelector("#btnSave");
      saveState.left = 0;
      if (saveBtn) {
        saveState.arc = el.deadPanel.querySelector("#ringArc");
        saveState.num = el.deadPanel.querySelector("#ringNum");
        saveState.btn = saveBtn;
        saveState.left = 5;
        ctx.listen(saveBtn, "click", () => {
          saveState.left = 0;
          if (wallet.coins < reviveCost) return;
          wallet.addCoins(-reviveCost);
          refreshWallet();
          revives += 1;
          banked = false;           // the continued run banks again at its real end
          runCoins = 0;             // already banked
          sfx.revive(); haptic("success");
          el.dead.classList.add("ss-hidden");
          el.hud.classList.remove("ss-hidden");
          el.pauseBtn.classList.remove("ss-hidden");
          // Clear the way ahead and hand over a shield.
          for (const ch of chunks) for (const o of ch.hazards) {
            if (!o.spent && !o.ramp && !o.ice && o.d > P.d - 6 && o.d < P.d + 50) { o.spent = true; if (o.mesh) o.mesh.visible = false; }
          }
          P.dead = false; P.tumble = 0; P.vy = 0; P.grounded = true; P.onRamp = null;
          P.invuln = 2.5;
          P.speed = Math.max(10, P.speed * 0.6);
          riderTilt.rotation.set(0, 0, 0);
          pw.shield = Math.max(pw.shield, 4); pwMax.shield = Math.max(pwMax.shield, 4);
          renderPowerHud();
          state = "run";
          toast("🪙 Second chance!");
          try { ctx.platform.interact({ type: "revive" }); } catch (_) {}
        });
      }
    }

    // =====================================================================
    // 16. Frame loop.
    // =====================================================================
    const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camWant = new THREE.Vector3(), lookWant = new THREE.Vector3();
    let camInit = false;
    const _g = new THREE.Vector3();
    let hudTick = 0, wallSfx = 0;

    function rampHeightAt(d, u, hz) {
      // Height of a ramp surface under (d,u), or -1 when not on one.
      const r = hz.ramp;
      const ld = d - r.d0;
      if (ld < 0 || ld > r.l || Math.abs(u - hz.u) > hz.w) return -1;
      return r.h * (ld / r.l);
    }
    function nearChunks(d) {
      const out = [];
      for (const ch of chunks) if (ch.d1 > d - 12 && ch.d0 < d + 12) out.push(ch);
      return out;
    }

    function update(dtMs, timeMs) {
      const dt = Math.min(dtMs, 50) / 1000;
      const tsec = timeMs / 1000;
      if (lastW !== ctx.width || lastH !== ctx.height) { lastW = ctx.width; lastH = ctx.height; resize(); }
      const running = state === "run";
      if (running) runTime += dt;

      if (running && !P.dead) {
        // --- forward speed ------------------------------------------------
        const rocket = pw.rocket > 0;
        let want = targetSpeed(P.d, stage) * sledDef.speed;
        if (rocket) want *= 1.55;
        if (P.iceT > 0) want *= 1.18;
        if (P.bumpT > 0) want *= 0.55;
        P.speed += (want - P.speed) * Math.min(1, dt * (rocket ? 3 : P.bumpT > 0 ? 4 : 0.8));
        const prevD = P.d;
        P.d += P.speed * dt;
        runDist += P.speed * dt;
        runScore += P.speed * dt * stageMult() * (pw.mult > 0 ? 2 : 1) * 1.5;
        if (rocket) pw.rocket -= P.speed * dt;
        for (const k of ["magnet", "shield", "mult"]) if (pw[k] > 0) pw[k] -= dt;
        for (const k in pw) if (pw[k] < 0) { pw[k] = 0; renderPowerHud(); if (k === "rocket") toast("Rocket spent"); }
        P.invuln = Math.max(0, P.invuln - dt);
        P.iceT = Math.max(0, P.iceT - dt);
        P.bumpT = Math.max(0, P.bumpT - dt);
        P.wallCd = Math.max(0, P.wallCd - dt);

        // --- steering ---------------------------------------------------
        const lim = uLimit(P.d);
        const maxLat = 10.5 * sledDef.handling * (P.grounded ? 1 : (sledDef.glide ? 0.8 : 0.55)) * (P.iceT > 0 ? 0.25 : 1);
        if (P.steering) {
          const wantVu = clamp((P.uTarget - P.u) * 7, -maxLat, maxLat);
          P.vu += (wantVu - P.vu) * Math.min(1, dt * (P.iceT > 0 ? 3 : 14));
        } else {
          P.vu *= Math.max(0, 1 - dt * (P.iceT > 0 ? 0.6 : 5));
        }
        // The banks push the sled back toward the middle.
        if (P.grounded) {
          const slope = (bankAt(P.d, P.u + 0.3) - bankAt(P.d, P.u - 0.3)) / 0.6;
          P.vu -= slope * 9.8 * 0.55 * dt;
        }
        P.u += P.vu * dt;
        if (Math.abs(P.u) > lim) {
          P.u = Math.sign(P.u) * lim;
          if (Math.abs(P.vu) > 3 && P.wallCd <= 0) { P.wallCd = 0.4; sfx.bump(); haptic("light"); emitSpray(rider.position, 8, 3, 3, 3); P.speed *= 0.93; }
          P.vu *= -0.3;
        }
        // Carving spray.
        if (P.grounded && Math.abs(P.vu) > 4 && Math.random() < dt * 30) emitSpray(rider.position, 2, 1.6, 2.2, 2);

        // --- vertical ---------------------------------------------------
        let gy = groundY(P.d, P.u);
        let rampHz = null, rampH = -1;
        const near = nearChunks(P.d);
        for (const ch of near) for (const o of ch.hazards) {
          if (!o.ramp) continue;
          const h = rampHeightAt(P.d, P.u, o);
          if (h >= 0) { rampHz = o; rampH = h; }
        }
        if (rampHz) gy += rampH;
        if (P.grounded) {
          if (P.onRamp && !rampHz && P.d > P.onRamp.ramp.d0 + P.onRamp.ramp.l - 0.5) {
            // Left the lip: launch.
            const r = P.onRamp.ramp;
            P.grounded = false; P.airTime = 0;
            P.vy = P.speed * (r.h / r.l) * 1.15 + 2.5;
            P.y = groundY(P.d, P.u) + r.h;
            sfx.launch(); haptic("medium");
            emitSpray(rider.position, 10, 3, 3, 3);
            try { ctx.platform.interact({ type: "ramp" }); } catch (_) {}
          } else {
            P.y = gy;
          }
          P.onRamp = rampHz;
        }
        if (!P.grounded) {
          const g = (P.vy < 0 && sledDef.glide) ? G * (1 - sledDef.glide) : G;
          P.vy -= g * dt;
          P.y += P.vy * dt;
          P.airTime += dt;
          if (P.y <= gy) {
            P.grounded = true; P.y = gy; P.onRamp = rampHz;
            const big = P.airTime > 0.75;
            sfx.land(big); haptic(big ? "medium" : "light");
            emitSpray(rider.position, big ? 22 : 8, big ? 4 : 2.5, big ? 4 : 2.5, 3);
            if (big) {
              const pts = Math.round(P.airTime * P.airTime * 160) * (pw.mult > 0 ? 2 : 1);
              runScore += pts;
              bestAir = Math.max(bestAir, P.airTime);
              toast((P.airTime > 1.6 ? "🔥 HUGE AIR " : "✨ BIG AIR ") + "+" + fmt(pts));
              sfx.air();
              shake = Math.max(shake, 0.35);
              try { ctx.platform.milestone("big_air", { seconds: Math.round(P.airTime * 10) / 10 }); } catch (_) {}
            }
            P.vy = 0;
          }
        }

        // --- hazards, coins, powerups -------------------------------------
        const yRel = P.y - groundY(P.d, P.u);
        for (const ch of near) {
          for (const o of ch.hazards) {
            if (o.spent || o.ramp) continue;
            const inD = o.d + o.h + 0.9 > prevD && o.d - o.h - 0.9 < P.d;
            if (!inD || Math.abs(P.u - o.u) > o.w + 0.8) continue;
            if (o.ice) { if (P.grounded && P.iceT <= 0) sfx.ice(); if (P.grounded) P.iceT = 0.2; continue; }
            if (yRel > o.height - 0.25) continue;      // cleared it in the air
            if (o.soft) {
              o.spent = true; P.bumpT = 0.9;
              runScore += 25;
              sfx.bump(); haptic("medium"); shake = Math.max(shake, 0.3);
              emitSpray(rider.position, 16, 4, 4, 3);
              o.kick = { vx: rnd(-3, 3) + P.vu * 0.3, vy: 7, spin: rnd(-4, 4), t: 0 };
              toast(o.kind === "snowman" ? "⛄ Bonk!" : "💎 Crack!");
              continue;
            }
            if (pw.rocket > 0 || P.invuln > 0) {
              if (pw.rocket > 0) {
                o.spent = true; o.kick = { vx: rnd(-6, 6), vy: 9, spin: rnd(-6, 6), t: 0 };
                runScore += 50; sfx.bump(); haptic("light"); shake = Math.max(shake, 0.25);
                emitSpray(rider.position, 14, 5, 5, 4);
              }
              continue;
            }
            if (pw.shield > 0) {
              pw.shield = 0; renderPowerHud();
              o.spent = true; o.kick = { vx: rnd(-5, 5), vy: 8, spin: rnd(-5, 5), t: 0 };
              P.invuln = 1.2; sfx.shieldPop(); haptic("medium"); shake = Math.max(shake, 0.4);
              toast("🛡️ Shield saved you!");
              continue;
            }
            die(o.kind);
            break;
          }
          if (P.dead) break;
          const magnet = pw.magnet > 0;
          for (const c of ch.coins) {
            if (c.taken) continue;
            const dd = c.d - P.d, du = c.u - P.u;
            if (magnet && Math.abs(dd) < 16 && Math.abs(du) < 10) {
              const k = Math.min(1, dt * 9);
              c.d += -dd * k; c.u += -du * k; c.y += (P.y + 0.9 - c.y) * k;
              coinShow(c, c.spin);
            }
            if (Math.abs(c.d - P.d) < 1.4 && Math.abs(c.u - P.u) < 1.5 && Math.abs(c.y - (P.y + 0.9)) < 1.8) {
              c.taken = true; coinHide(c);
              const v = 1 + upLevel("value");
              runCoins += v;
              runScore += 10 * v * (pw.mult > 0 ? 2 : 1);
              sfx.coin();
            }
          }
          for (const p of ch.powers) {
            if (p.taken) continue;
            if (Math.abs(p.d - P.d) < 1.8 && Math.abs(p.u - P.u) < 1.8) {
              p.taken = true; p.mesh.visible = false;
              givePower(p.kind);
            }
          }
          if (ch.finish && !ch.finish.done && P.d >= ch.finish.d) stageClear(ch.finish);
        }

        // --- housekeeping ------------------------------------------------
        ensureChunks(P.d);
        trailPush(P.d, P.u, P.grounded);
        coinPitch = Math.max(0, coinPitch - dt * 2);
        scoreTick += dt;
        if (scoreTick > 0.5) { scoreTick = 0; try { ctx.platform.setScore(Math.floor(runScore)); } catch (_) {} }
        hudTick += dt;
        if (hudTick > 0.08) { hudTick = 0; updateHud(); tickPowerHud(); }
        setWind(0.05 + (P.speed / 36) * 0.16 * (P.grounded ? 1 : 0.4) + (pw.rocket > 0 ? 0.08 : 0), 500 + P.speed * 30);
      }

      // --- rider pose ------------------------------------------------------
      if (state !== "menu") {
        worldOf(P.d, P.u, P.y, rider.position);
        const head = headingAt(P.d);
        if (P.dead) {
          P.tumble += dt;
          P.speed *= Math.max(0, 1 - dt * 2.2);
          P.d += P.speed * dt;
          P.y = groundY(P.d, P.u) + Math.max(0, Math.sin(P.tumble * 5) * 1.2 * Math.max(0, 1 - P.tumble));
          rider.rotation.set(0, head, 0);
          riderTilt.rotation.x += dt * 8 * Math.max(0, 1.2 - P.tumble);
          riderTilt.rotation.z += dt * 5 * Math.max(0, 1.2 - P.tumble);
        } else {
          rider.rotation.set(0, head - P.vu * 0.045, 0);
          const pitchGround = P.onRamp ? -Math.atan2(P.onRamp.ramp.h, P.onRamp.ramp.l) - Math.atan(baseDY(P.d)) : -Math.atan(baseDY(P.d));
          const pitch = P.grounded ? pitchGround : clamp(-P.vy * 0.045, -0.55, 0.55);
          riderTilt.rotation.x += (pitch - riderTilt.rotation.x) * Math.min(1, dt * 10);
          riderTilt.rotation.z += (-P.vu * 0.032 - riderTilt.rotation.z) * Math.min(1, dt * 10);
        }
        if (penguin) {
          const wings = penguin.userData.wings;
          const flap = !P.grounded ? Math.sin(tsec * 26) * 0.9 : (pw.rocket > 0 ? Math.sin(tsec * 18) * 0.5 : Math.sin(tsec * 3) * 0.08);
          wings[0].rotation.z = -0.35 - flap; wings[1].rotation.z = 0.35 + flap;
          penguin.rotation.z = -P.vu * 0.022;
          penguin.rotation.x = P.grounded ? 0.12 : -0.25;
          penguin.userData.body.scale.y = 0.62 + Math.sin(tsec * 6) * 0.01;
        }
        if (sled) {
          const a = sled.userData.anim;
          if (a.prop) a.prop.rotation.z += dt * (P.grounded ? 14 : 30);
          if (a.flame) { a.flame.visible = pw.rocket > 0 || P.speed > 20; a.flame.scale.y = 0.6 + Math.sin(tsec * 40) * 0.2 + (pw.rocket > 0 ? 0.6 : 0); }
        }
        shieldBubble.visible = pw.shield > 0 || P.invuln > 0;
        if (shieldBubble.visible) { shieldBubble.material.opacity = 0.22 + Math.sin(tsec * 9) * 0.08; shieldBubble.rotation.y += dt; }
        worldOf(P.d, P.u, groundY(P.d, P.u) + 0.05, shadowBlob.position);
        shadowBlob.rotation.set(-Math.PI / 2 + Math.atan(baseDY(P.d)), headingAt(P.d), 0, "YXZ");
        const h = Math.max(0, P.y - groundY(P.d, P.u));
        shadowBlob.scale.setScalar(clamp(1 - h * 0.08, 0.35, 1));
        shadowBlob.material.opacity = clamp(0.24 - h * 0.02, 0.06, 0.24);
      }

      // --- animate hazards and pickups near the player ---------------------
      for (const ch of chunks) {
        if (ch.d0 > P.d + 110 || ch.d1 < P.d - 20) continue;
        for (const o of ch.hazards) {
          if (o.kick && o.mesh) {
            const k = o.kick; k.t += dt;
            o.mesh.position.y += k.vy * dt; k.vy -= 20 * dt;
            o.mesh.position.x += k.vx * dt; o.mesh.rotation.z += k.spin * dt; o.mesh.rotation.x += k.spin * 0.5 * dt;
            if (k.t > 1.4) { o.mesh.visible = false; o.kick = null; }
          }
        }
        for (const c of ch.coins) {
          if (c.taken) continue;
          c.spin += dt * 3.5;
          coinShow(c, c.spin);
        }
        for (const p of ch.powers) {
          if (p.taken) continue;
          p.mesh.rotation.y += dt * 1.8;
          p.mesh.position.y += Math.sin(tsec * 3 + p.phase) * dt * 0.5;
          p.mesh.userData.ring.rotation.x = tsec * 1.3 + p.phase; p.mesh.userData.ring.rotation.y = tsec * 0.9;
        }
      }
      coinMesh.instanceMatrix.needsUpdate = true;

      // --- camera --------------------------------------------------------------
      let camD = P.d, camU = P.u, camY = P.y;
      if (state === "menu") {
        // Slow drift down the slope behind an idle rider.
        camD = tsec * 3 % 200; camU = 0; camY = groundY(camD, 0);
      }
      const back = state === "menu" ? 12 : 8.8 + P.speed * 0.05 + (P.grounded ? 0 : 1.2);
      const up = state === "menu" ? 5.5 : 4.4 + (P.grounded ? 0 : Math.min(3, (P.y - groundY(P.d, P.u)) * 0.35));
      worldOf(camD - back, camU * 0.4, groundY(camD - back, camU * 0.4) + up + Math.max(0, camY - groundY(camD, camU)) * 0.5, camWant);
      worldOf(camD + 10, camU * 0.6, camY + 1.2, lookWant);
      if (!camInit) { camPos.copy(camWant); camLook.copy(lookWant); camInit = true; }
      const k = Math.min(1, dt * (state === "menu" ? 2 : 7));
      camPos.lerp(camWant, k); camLook.lerp(lookWant, Math.min(1, dt * 9));
      camera.position.copy(camPos);
      if (shake > 0) {
        shake = Math.max(0, shake - dt * 2.2);
        camera.position.x += (Math.random() - 0.5) * shake * 0.7;
        camera.position.y += (Math.random() - 0.5) * shake * 0.5;
      }
      camera.lookAt(camLook);
      camera.rotation.z += -P.vu * 0.012 * (state === "run" ? 1 : 0);
      const fovWant = 64 + (P.speed / 36) * 14 + (pw.rocket > 0 ? 5 : 0);
      camera.fov += (fovWant - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();

      // Sun follows the rider so the shadow frustum covers what is on screen.
      _g.copy(state === "menu" ? camLook : rider.position);
      sun.target.position.copy(_g);
      sun.position.set(_g.x - 30, _g.y + 60, _g.z - 20);

      // --- snow and spray ---------------------------------------------------------
      snowPts.position.set(camera.position.x, camera.position.y, camera.position.z);
      snowPts.rotation.y = headingAt(camD);
      const drift = (state === "run" ? P.speed : 3) * dt * 0.35;
      for (let i = 0; i < SNOW_N; i++) {
        let y = snowPos[i * 3 + 1] - snowVel[i] * dt;
        let z = snowPos[i * 3 + 2] - drift;
        snowPos[i * 3] += Math.sin(tsec * 1.3 + i) * dt * 0.6;
        if (y < -10) { y = 30; snowPos[i * 3] = rnd(-30, 30); }
        if (z < 4) z = 70;
        snowPos[i * 3 + 1] = y; snowPos[i * 3 + 2] = z;
      }
      snowGeo.attributes.position.needsUpdate = true;
      for (let i = 0; i < SPRAY_N; i++) {
        const s = spray[i];
        if (s.life <= 0) continue;
        s.life -= dt;
        if (s.life <= 0) { sprayPos[i * 3 + 1] = -999; continue; }
        s.vy -= 12 * dt;
        sprayPos[i * 3] += s.vx * dt; sprayPos[i * 3 + 1] += s.vy * dt; sprayPos[i * 3 + 2] += s.vz * dt;
      }
      sprayGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    }

    ctx.onFrame(update);

    // Test hooks (harness only; harmless in production).
    if (typeof window !== "undefined") {
      window.__ssDebug = () => ({
        state, stage, d: Math.round(P.d), u: Math.round(P.u * 10) / 10, y: Math.round(P.y * 10) / 10,
        speed: Math.round(P.speed * 10) / 10, grounded: P.grounded, air: Math.round(P.airTime * 100) / 100,
        score: Math.round(runScore), coins: runCoins, dist: Math.round(runDist), chunks: chunks.length,
        pw: Object.assign({}, pw), invuln: P.invuln, dead: P.dead
      });
      window.__ssKill = () => { if (state === "run") die("test"); };
      window.__ssNext = () => {
        let best = null;
        for (const ch of nearChunks(P.d + 20)) for (const o of ch.hazards) {
          if (o.spent) continue;
          const dz = o.d - P.d;
          if (dz < 1 || dz > 40) continue;
          if (!best || dz < best.dz) best = { kind: o.kind, dz: Math.round(dz), u: Math.round(o.u * 10) / 10, w: o.w };
        }
        return best;
      };
      window.__ssSteer = (u) => { P.steering = true; P.uTarget = u; };
      window.__ssGive = (k) => givePower(k);
      window.__ssWarp = (d) => { P.d = d; P.u = 0; P.y = groundY(d, 0); P.invuln = 2.5; ensureChunks(d); stage = stageAt(d); setStageLabel(); applyPalette(paletteOfStage(stage)); };
      window.__ssChunks = () => chunks.map((c) => ({ d0: c.d0, n: c.group.children.length, hz: c.hazards.length, coins: c.coins.length }));
    }

    // Menu backdrop: an idle slope behind the DOM menu.
    resetTrack();
    ensureChunks(0);
    applyPalette(paletteOfStage(1), true);
    worldOf(0, 0, groundY(0, 0), rider.position);
    P.y = groundY(0, 0);
    showMenu();

    ctx.onDestroy(() => {
      saveState.left = 0;
      for (const ch of chunks) disposeChunk(ch);
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
