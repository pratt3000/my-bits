/*
 * Plunder Tide
 * Command a pirate ship on an open sea. Sail out from your home port, hunt
 * ships whose level is below yours, dodge or fight the ones above, gather
 * the loot they drop into a limited hold and bring it home to bank it.
 * Coins and gems buy cannons, hull tiers, sails, hold space and carpenters.
 * The further from port you sail, the stronger the sea gets; forts guard
 * the deep water, sunken treasure waits under "?" markers, and a quest
 * chain keeps sending you further out.
 *
 * Runtime:  plethora-bit@2  (window.plethoraBit)
 * Renderer: three@0.164.1 (ES module via ctx.importModule)
 * Audio:    ctx.music beds + procedurally synthesized WebAudio SFX
 *           (packaged assets are disabled, so every sound, texture and
 *           model is generated in this file)
 */

window.plethoraBit = {
  meta: {
    title: "Plunder Tide",
    runtime: "plethora-bit@2",
    tags: ["3d", "pirates", "naval", "action", "upgrade", "open-world", "mobile"],
    permissions: ["haptics", "backgroundMusic", "audio", "storage"]
  },

  async init(ctx) {
    "use strict";

    // =====================================================================
    // 1. Surfaces + UI shell.
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
      .pt-ui { position:absolute; inset:0; overflow:hidden; color:#fff;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
        -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
      .pt-ui * { box-sizing:border-box; }
      .pt-hidden { display:none !important; }
      .pt-vign { position:absolute; inset:0; pointer-events:none;
        background:radial-gradient(120% 100% at 50% 45%, rgba(0,0,0,0) 55%, rgba(4,30,50,.38) 100%); }

      /* top bar: quest + wallet, shared by sea and port */
      .pt-top { position:absolute; left:0; right:0; top:calc(${sa.top}px + 8px); display:flex; align-items:flex-start;
        justify-content:space-between; padding:0 12px; pointer-events:none; z-index:30; gap:8px; }
      .pt-lvl { width:46px; height:52px; display:flex; flex-direction:column; align-items:center; justify-content:center;
        background:linear-gradient(180deg,#ffd35a,#e59a1c); clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
        color:#4a2a00; font-weight:900; font-size:19px; line-height:1; flex:none; }
      .pt-lvl small { font-size:8px; letter-spacing:1px; font-weight:800; margin-top:1px; }
      .pt-quest { flex:1; max-width:250px; margin:0 auto; padding:5px 10px 6px; border-radius:12px; text-align:center;
        background:rgba(6,32,52,.62); border:1px solid rgba(255,255,255,.22); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
      .pt-quest .t { font-size:12.5px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pt-quest .bar { height:6px; border-radius:3px; background:rgba(255,255,255,.2); margin-top:5px; overflow:hidden; }
      .pt-quest .bar i { display:block; height:100%; width:0; background:linear-gradient(90deg,#ffd35a,#ff9d1c); transition:width .3s ease; }
      .pt-quest .r { font-size:10px; opacity:.85; margin-top:3px; }
      .pt-wallet { display:flex; flex-direction:column; gap:4px; align-items:flex-end; flex:none; }
      .pt-wallet span { display:inline-flex; align-items:center; gap:5px; padding:3px 9px 3px 10px; border-radius:999px;
        background:rgba(6,32,52,.62); border:1px solid rgba(255,255,255,.22); font-size:13px; font-weight:900; font-variant-numeric:tabular-nums; }
      .pt-wallet span.hold { font-size:11px; font-weight:800; opacity:.95; }
      .pt-wallet span.hold.full { color:#ffd35a; }

      /* labels over ships */
      .pt-lbls { position:absolute; inset:0; pointer-events:none; z-index:15; }
      .pt-lbl { position:absolute; left:0; top:0; transform:translate(-50%,-100%); display:flex; flex-direction:column; align-items:center; gap:2px;
        will-change:transform; }
      .pt-lbl .row { display:flex; align-items:center; gap:4px; }
      .pt-lbl .hex { width:26px; height:28px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; color:#3a2000;
        clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%); background:#ffd35a; }
      .pt-lbl .hex.hard { background:#ff5a4a; color:#fff; }
      .pt-lbl .hex.easy { background:#7be07a; color:#123; }
      .pt-lbl .hex.fort { background:#b9c3cf; color:#123; }
      .pt-lbl .loot { display:flex; gap:5px; padding:2px 7px; border-radius:8px; background:rgba(6,32,52,.62); font-size:10.5px; font-weight:800; font-variant-numeric:tabular-nums; }
      .pt-lbl .hp { width:58px; height:5px; border-radius:3px; background:rgba(0,0,0,.45); overflow:hidden; }
      .pt-lbl .hp i { display:block; height:100%; background:#5ef07a; transform-origin:left; }
      .pt-lbl .hp i.low { background:#ff6a4a; }
      .pt-lbl .fire { font-size:11px; }
      .pt-lbl.me .hp { width:74px; height:6px; }
      .pt-lbl.me .hp i { background:#5ef07a; }
      .pt-lbl .name { font-size:9.5px; font-weight:800; letter-spacing:.5px; text-shadow:0 1px 4px rgba(0,0,0,.6); opacity:.9; }

      /* edge markers */
      .pt-edges { position:absolute; inset:0; pointer-events:none; z-index:16; }
      .pt-edge { position:absolute; left:0; top:0; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:1px; }
      .pt-edge .ic { width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900;
        background:rgba(6,32,52,.7); border:1.5px solid rgba(255,255,255,.7); }
      .pt-edge .ic.q { background:#ffd35a; color:#3a2000; border-color:#fff; }
      .pt-edge .ic.port { background:#2b90e8; }
      .pt-edge .ic.fort { background:#7a8798; }
      .pt-edge .ic.hunt { background:#e8453c; }
      .pt-edge .d { font-size:9.5px; font-weight:800; text-shadow:0 1px 4px rgba(0,0,0,.7); }

      /* joystick */
      .pt-stick { position:absolute; width:150px; height:150px; margin:-75px 0 0 -75px; border-radius:50%; pointer-events:none; z-index:20;
        border:2px solid rgba(255,255,255,.55); background:rgba(255,255,255,.08); opacity:0; transition:opacity .15s ease; }
      .pt-stick.on { opacity:1; }
      .pt-stick .knob { position:absolute; left:50%; top:50%; width:54px; height:54px; margin:-27px 0 0 -27px; border-radius:50%;
        background:rgba(255,255,255,.45); border:2px solid rgba(255,255,255,.85); box-shadow:0 4px 14px rgba(0,0,0,.3); }
      .pt-stick .arrow { position:absolute; left:50%; top:50%; width:0; height:0; margin:-8px 0 0 -6px; border-left:6px solid transparent;
        border-right:6px solid transparent; border-bottom:14px solid rgba(255,255,255,.9); transform-origin:50% 60%; }
      .pt-hinttouch { position:absolute; left:50%; bottom:calc(${sa.bottom}px + 26%); transform:translateX(-50%); z-index:21; pointer-events:none;
        padding:8px 16px; border-radius:999px; background:rgba(6,32,52,.62); border:1px solid rgba(255,255,255,.25); font-size:13px; font-weight:800;
        opacity:0; transition:opacity .4s ease; white-space:normal; max-width:82vw; text-align:center; }
      .pt-hinttouch.show { opacity:1; }

      /* side buttons */
      .pt-side { position:absolute; right:calc(${sa.right}px + 14px); bottom:calc(${sa.bottom}px + 110px); display:flex; flex-direction:column; gap:10px; z-index:30; }
      .pt-ico { pointer-events:auto; width:46px; height:46px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center;
        border:1.5px solid rgba(255,255,255,.55); background:rgba(6,32,52,.62); color:#fff; font-size:19px;
        backdrop-filter:blur(7px); -webkit-backdrop-filter:blur(7px); }
      .pt-ico:active { transform:scale(.92); }
      .pt-ico.anchor { width:54px; height:54px; font-size:22px; background:linear-gradient(180deg,#5cc2ff,#2a8fe6); border-color:#fff; box-shadow:0 4px 12px rgba(0,0,0,.3); }
      .pt-ico.anchor.busy { opacity:.45; }
      .pt-ico small { position:absolute; bottom:-6px; font-size:8px; font-weight:900; letter-spacing:.5px; background:#0b2740; padding:1px 5px; border-radius:6px; }
      .pt-corner { position:absolute; left:calc(${sa.left}px + 12px); top:calc(${sa.top}px + 68px); display:flex; flex-direction:column; gap:8px; z-index:30; }
      .pt-corner .pt-ico { width:40px; height:40px; font-size:16px; }

      .pt-toast { position:absolute; left:50%; top:24%; transform:translate(-50%,-50%) scale(.9); z-index:32;
        padding:9px 20px; border-radius:999px; font-size:15px; font-weight:900; white-space:nowrap; color:#fff;
        background:rgba(6,32,52,.72); border:1px solid rgba(255,255,255,.3); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        opacity:0; transition:opacity .22s ease, transform .22s ease; pointer-events:none; }
      .pt-toast.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
      .pt-big { position:absolute; left:50%; top:34%; transform:translate(-50%,-50%) scale(.6); z-index:33; text-align:center;
        font-size:30px; font-weight:900; font-style:italic; color:#ffd35a; white-space:nowrap; pointer-events:none; opacity:0;
        text-shadow:0 3px 0 #7a3c00, 0 8px 22px rgba(0,0,0,.5); transition:opacity .25s ease, transform .3s cubic-bezier(.2,1.6,.4,1); }
      .pt-big.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
      .pt-big small { display:block; font-size:13px; letter-spacing:3px; font-style:normal; color:#fff; margin-top:4px; }
      .pt-flash { position:absolute; inset:0; pointer-events:none; opacity:0; z-index:19; transition:opacity .45s ease; }
      .pt-flash.on { opacity:1; transition:opacity .05s ease; }
      .pt-flash.hurt { background:radial-gradient(110% 90% at 50% 50%, rgba(220,40,40,0) 45%, rgba(220,40,40,.55) 100%); }
      .pt-flash.good { background:radial-gradient(110% 90% at 50% 50%, rgba(255,220,120,0) 55%, rgba(255,220,120,.4) 100%); }
      .pt-fade { position:absolute; inset:0; background:#06202f; opacity:0; pointer-events:none; z-index:45; transition:opacity .5s ease; }
      .pt-fade.on { opacity:1; }
      .pt-dive { position:absolute; left:50%; top:58%; transform:translate(-50%,-50%); z-index:21; pointer-events:none; opacity:0; transition:opacity .2s ease; text-align:center; }
      .pt-dive.show { opacity:1; }
      .pt-dive svg { transform:rotate(-90deg); }
      .pt-dive .t { font-size:11px; font-weight:900; letter-spacing:1px; margin-top:2px; text-shadow:0 1px 4px rgba(0,0,0,.7); }

      /* port */
      .pt-port { position:absolute; inset:0; pointer-events:none; z-index:25; }
      .pt-title { position:absolute; left:50%; top:calc(${sa.top}px + 78px); transform:translateX(-50%); text-align:center; white-space:nowrap; }
      .pt-title .n { font-size:24px; font-weight:900; font-style:italic; text-shadow:0 2px 0 #7a3c00, 0 6px 18px rgba(0,0,0,.45); color:#ffd35a; }
      .pt-title .s { font-size:11px; font-weight:800; letter-spacing:3px; opacity:.85; margin-top:2px; }
      .pt-slots { position:absolute; inset:0; pointer-events:none; }
      .pt-slot { position:absolute; left:0; top:0; transform:translate(-50%,-50%); width:46px; height:46px; border-radius:12px; pointer-events:auto; cursor:pointer;
        background:rgba(6,32,52,.7); border:2px solid rgba(255,255,255,.55); display:flex; align-items:center; justify-content:center; font-size:22px;
        box-shadow:0 4px 12px rgba(0,0,0,.35); }
      .pt-slot.filled { border-color:#7be07a; background:rgba(20,80,40,.75); }
      .pt-slot.sel { border-color:#ffd35a; box-shadow:0 0 0 3px rgba(255,211,90,.45); }
      .pt-slot b { position:absolute; right:-5px; bottom:-6px; font-size:9px; background:#ffd35a; color:#3a2000; padding:1px 5px; border-radius:6px; }
      .pt-actions { position:absolute; left:50%; bottom:calc(${sa.bottom}px + 84px); transform:translateX(-50%); display:flex; gap:8px; pointer-events:auto; }
      .pt-act { width:78px; padding:11px 0 9px; border-radius:14px; border:none; cursor:pointer; color:#fff; font-size:12.5px; font-weight:900;
        display:flex; flex-direction:column; align-items:center; gap:3px; box-shadow:0 5px 0 rgba(0,0,0,.28), 0 10px 20px rgba(0,0,0,.3); }
      .pt-act:active { transform:translateY(3px); box-shadow:0 2px 0 rgba(0,0,0,.28); }
      .pt-act i { font-style:normal; font-size:22px; line-height:1; }
      .pt-act.shop { background:linear-gradient(180deg,#ffd35a,#e59a1c); color:#3a2000; }
      .pt-act.up { background:linear-gradient(180deg,#b57bff,#7a3ee6); }
      .pt-act.arm { background:linear-gradient(180deg,#5cc2ff,#2a6fd6); }
      .pt-act.go { background:linear-gradient(180deg,#8ef07a,#3cb44a); color:#0c2a10; width:92px; }
      .pt-hp { position:absolute; left:50%; bottom:calc(${sa.bottom}px + 156px); transform:translateX(-50%); width:220px; text-align:center; font-size:11.5px; font-weight:800; }
      .pt-hp .bar { height:8px; border-radius:4px; background:rgba(0,0,0,.4); overflow:hidden; margin-top:4px; border:1px solid rgba(255,255,255,.3); }
      .pt-hp .bar i { display:block; height:100%; background:linear-gradient(90deg,#5ef07a,#2fbf5c); }
      .pt-stats { display:flex; justify-content:center; gap:8px; margin-top:6px; }
      .pt-stats span { font-size:10.5px; padding:2px 8px; border-radius:999px; background:rgba(6,32,52,.62); border:1px solid rgba(255,255,255,.22); }

      /* overlays */
      .pt-ov { position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center;
        padding:16px; pointer-events:auto; text-align:center;
        background:radial-gradient(120% 90% at 50% 35%, rgba(20,80,120,.45), rgba(4,24,40,.86));
        backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); }
      .pt-panel { width:100%; max-width:400px; max-height:84vh; overflow-y:auto; padding:18px 14px 14px;
        border-radius:22px; background:linear-gradient(180deg, rgba(255,250,240,.97), rgba(240,232,214,.97));
        border:1px solid rgba(255,255,255,.9); box-shadow:0 20px 60px rgba(0,10,20,.55); color:#3a2a14; }
      .pt-panel h2 { margin:0 0 4px; font-size:23px; font-weight:900; color:#5a3000; }
      .pt-panel .sub { font-size:12px; opacity:.7; margin-bottom:10px; }
      .pt-panel .big { font-size:50px; line-height:1; margin-bottom:4px; }
      .pt-btn { pointer-events:auto; display:block; width:100%; margin:0 auto 9px; padding:13px 18px; border-radius:15px; border:none; cursor:pointer;
        font-size:16px; font-weight:900; color:#fff; background:linear-gradient(180deg,#5cc2ff,#2a8fe6);
        box-shadow:0 5px 0 #1a63a8, 0 10px 22px rgba(0,20,40,.3); transition:transform .08s ease, box-shadow .08s ease; }
      .pt-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #1a63a8; }
      .pt-btn.ghost { background:rgba(90,48,0,.08); color:#5a3000; box-shadow:0 4px 0 rgba(90,48,0,.15); border:1px solid rgba(90,48,0,.2); }
      .pt-btn.ghost:active { box-shadow:0 1px 0 rgba(90,48,0,.15); }
      .pt-btn.gold { background:linear-gradient(180deg,#ffd35a,#e59a1c); color:#3a2000; box-shadow:0 5px 0 #a86a10, 0 10px 22px rgba(0,20,40,.3); }
      .pt-btn.gold:active { box-shadow:0 1px 0 #a86a10; }
      .pt-btn.green { background:linear-gradient(180deg,#8ef07a,#3cb44a); color:#0c2a10; box-shadow:0 5px 0 #23782f, 0 10px 22px rgba(0,20,40,.3); }
      .pt-btn.green:active { box-shadow:0 1px 0 #23782f; }
      .pt-btn:disabled { opacity:.5; }
      .pt-tabs { display:flex; gap:6px; margin-bottom:10px; }
      .pt-tabs button { flex:1; padding:8px 0; border-radius:999px; cursor:pointer; font-size:12.5px; font-weight:800;
        border:1px solid rgba(90,48,0,.25); background:rgba(255,255,255,.55); color:#5a3000; }
      .pt-tabs button.on { background:linear-gradient(180deg,#ffd35a,#e59a1c); border-color:transparent; }
      .pt-row { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:14px; background:rgba(90,48,0,.07); margin-bottom:7px; text-align:left; }
      .pt-row.sel { background:rgba(92,194,255,.2); border:1px solid rgba(42,143,230,.5); }
      .pt-row.locked { opacity:.55; }
      .pt-row .ic { font-size:24px; width:34px; text-align:center; flex:none; }
      .pt-row .mid { flex:1; min-width:0; }
      .pt-row .nm { font-size:14px; font-weight:900; }
      .pt-row .nm em { font-style:normal; font-size:11px; opacity:.7; font-weight:800; margin-left:4px; }
      .pt-row .de { font-size:11px; opacity:.75; margin-top:1px; line-height:1.4; }
      .pt-pips { display:flex; gap:2px; margin-top:4px; }
      .pt-pips i { width:11px; height:4px; border-radius:2px; background:rgba(90,48,0,.18); }
      .pt-pips i.on { background:linear-gradient(90deg,#ffd35a,#e59a1c); }
      .pt-buy { flex:none; padding:8px 10px; border-radius:11px; border:none; cursor:pointer; font-size:12px; font-weight:900; color:#3a2000;
        background:linear-gradient(180deg,#ffd35a,#e59a1c); display:flex; flex-direction:column; align-items:center; gap:1px; min-width:64px; white-space:nowrap; }
      .pt-buy:disabled { opacity:.45; background:rgba(90,48,0,.18); }
      .pt-buy.blue { background:linear-gradient(180deg,#5cc2ff,#2a8fe6); color:#fff; }
      .pt-buy.max { background:rgba(90,48,0,.15); }
      .pt-stat { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 12px; border-radius:12px;
        background:rgba(90,48,0,.07); margin-bottom:6px; font-size:13.5px; font-weight:700; }
      .pt-stat b { font-size:17px; font-weight:900; color:#5a3000; font-variant-numeric:tabular-nums; }
      .pt-fatal { position:absolute; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
        padding:26px; text-align:center; background:#0b2740; color:#fff; pointer-events:auto; }
      .pt-conf { position:absolute; inset:0; pointer-events:none; z-index:34; overflow:hidden; }
      .pt-conf i { position:absolute; top:-12px; width:8px; height:12px; border-radius:2px; animation:ptFall 1.6s linear forwards; }
      @keyframes ptFall { 0% { transform:translateY(0) rotate(0); opacity:1; } 100% { transform:translateY(105vh) rotate(720deg); opacity:.2; } }
      .pt-menu { position:absolute; inset:0; z-index:35; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:auto;
        padding-top:calc(${sa.top}px + 20px); padding-bottom:calc(${sa.bottom}px + 20px);
        background:radial-gradient(90% 60% at 50% 20%, rgba(255,211,90,.25), rgba(4,24,40,0) 60%), linear-gradient(180deg, rgba(4,24,40,.25), rgba(4,24,40,.72)); }
      .pt-logo { font-size:44px; font-weight:900; font-style:italic; color:#ffd35a; line-height:1; text-shadow:0 3px 0 #7a3c00, 0 6px 0 #4a2400, 0 14px 30px rgba(0,0,0,.5); }
      .pt-logo-sub { font-size:11.5px; font-weight:800; letter-spacing:5px; margin-top:10px; opacity:.9; }
      .pt-hero { font-size:70px; line-height:1; margin-bottom:8px; filter:drop-shadow(0 10px 18px rgba(0,0,0,.4)); animation:ptBob 3s ease-in-out infinite; }
      @keyframes ptBob { 0%,100% { transform:translateY(0) rotate(-3deg); } 50% { transform:translateY(-7px) rotate(3deg); } }
      .pt-menu .pt-btn { width:min(280px,78vw); }
      .pt-bestline { font-size:12px; font-weight:800; letter-spacing:1.5px; opacity:.85; margin:14px 0 18px; }
      .pt-bestline b { color:#ffd35a; font-size:15px; }
    `;
    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "pt-ui";
    ui.innerHTML = `
      <div class="pt-vign"></div>
      <div class="pt-lbls" id="lbls"></div>
      <div class="pt-edges" id="edges"></div>

      <div class="pt-top pt-hidden" id="topBar">
        <div class="pt-lvl"><span id="tLvl">1</span><small>CAPT</small></div>
        <div class="pt-quest"><div class="t" id="qText">—</div><div class="bar"><i id="qBar"></i></div><div class="r" id="qReward"></div></div>
        <div class="pt-wallet"><span>🪙 <i id="wCoins">0</i></span><span>💎 <i id="wGems">0</i></span><span class="hold" id="wHold">⚓ hold 0 / 0</span></div>
      </div>

      <div class="pt-corner pt-hidden" id="seaCorner">
        <button class="pt-ico" id="btnPause" aria-label="Pause">⏸</button>
      </div>
      <div class="pt-side pt-hidden" id="seaSide">
        <button class="pt-ico anchor" id="btnPort" aria-label="Return to port">⚓<small>PORT</small></button>
      </div>

      <div class="pt-stick" id="stick"><div class="arrow" id="stickArrow"></div><div class="knob" id="knob"></div></div>
      <div class="pt-hinttouch" id="touchHint">👆 drag anywhere to sail · guns fire on their own</div>
      <div class="pt-dive" id="dive"><svg width="54" height="54"><circle cx="27" cy="27" r="22" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="5"/><circle id="diveArc" cx="27" cy="27" r="22" fill="none" stroke="#ffd35a" stroke-width="5" stroke-linecap="round" stroke-dasharray="138.2" stroke-dashoffset="138.2"/></svg><div class="t">DIVING</div></div>

      <div class="pt-toast" id="toast"></div>
      <div class="pt-big" id="bigText"></div>
      <div class="pt-conf" id="conf"></div>
      <div class="pt-flash hurt" id="flashHurt"></div>
      <div class="pt-flash good" id="flashGood"></div>
      <div class="pt-fade" id="fade"></div>

      <div class="pt-menu" id="menu">
        <div class="pt-hero">🏴‍☠️</div>
        <div class="pt-logo">PLUNDER TIDE</div>
        <div class="pt-logo-sub">HUNT · PLUNDER · UPGRADE</div>
        <div class="pt-bestline">PLUNDER <b id="mPlunder">0</b> · BOUNTY <b id="mBounty">0</b></div>
        <button class="pt-btn gold" id="btnMenuPlay">⚓  To the port</button>
        <button class="pt-btn ghost" id="btnMenuHow">?  How to play</button>
      </div>

      <div class="pt-port pt-hidden" id="port">
        <div class="pt-title"><div class="n" id="shipName">Sloop</div><div class="s" id="shipSub">HOME PORT</div></div>
        <div class="pt-slots" id="slots"></div>
        <div class="pt-hp"><div id="hpText">HULL 300 / 300</div><div class="bar"><i id="hpBar" style="width:100%"></i></div>
          <div class="pt-stats" id="shipStats"></div></div>
        <div class="pt-actions">
          <button class="pt-act shop" id="btnShop"><i>🏪</i>Shop</button>
          <button class="pt-act up" id="btnUp"><i>🔨</i>Upgrade</button>
          <button class="pt-act arm" id="btnArm"><i>💣</i>Armory</button>
          <button class="pt-act go" id="btnGo"><i>⚔️</i>SAIL!</button>
        </div>
        <div class="pt-corner"><button class="pt-ico" id="btnMute" aria-label="Sound">🔊</button><button class="pt-ico" id="btnHow2" aria-label="Help">?</button></div>
      </div>

      <div class="pt-ov pt-hidden" id="ovHow">
        <div class="pt-panel">
          <h2>How to plunder</h2>
          <div style="text-align:left;font-size:13.5px;line-height:1.8;margin:8px 0 14px;">
            👆 <b>Touch and drag</b> anywhere on the sea to sail. The joystick appears under your finger; direction is heading, distance is sail.<br>
            💣 <b>Cannons fire on their own</b> at anything in their arc and range. Show an enemy your broadside.<br>
            ⬡ Every ship wears its <b>level</b>. Green is prey, gold is a fair fight, red will sink you.<br>
            🪙 Sunk ships drop <b>loot</b>. Sail over it. Your <b>hold</b> has a limit — bank it at port with the ⚓ button.<br>
            💀 Sink and you lose <b>half</b> of the hold you carried.<br>
            🏰 <b>Forts</b> guard the deep sea. ❓ marks <b>sunken treasure</b>: stop over it to dive.<br>
            📜 Quests pay coins and gems. 💎 Gems buy bigger hulls and the best cannons.<br>
            🌊 The further from port, the stronger the sea.
          </div>
          <button class="pt-btn" id="btnHowOk" style="margin-bottom:0;">Got it</button>
        </div>
      </div>

      <div class="pt-ov pt-hidden" id="ovPause">
        <div class="pt-panel">
          <h2>Anchored</h2>
          <div style="height:8px;"></div>
          <button class="pt-btn" id="btnResume">Resume</button>
          <button class="pt-btn ghost" id="btnMute2">🔊 Sound</button>
          <button class="pt-btn ghost" id="btnQuit" style="margin-bottom:0;">Abandon voyage</button>
          <div style="font-size:11px;opacity:.65;margin-top:8px;">Abandoning keeps only half of your hold.</div>
        </div>
      </div>

      <div class="pt-ov pt-hidden" id="ovShop"><div class="pt-panel" id="shopPanel"></div></div>
      <div class="pt-ov pt-hidden" id="ovSunk"><div class="pt-panel" id="sunkPanel"></div></div>
    `;
    root.appendChild(ui);
    const $ = (id) => ui.querySelector("#" + id);
    const el = {
      lbls: $("lbls"), edges: $("edges"), top: $("topBar"), tLvl: $("tLvl"), qText: $("qText"), qBar: $("qBar"), qReward: $("qReward"),
      wCoins: $("wCoins"), wGems: $("wGems"), wHold: $("wHold"),
      seaCorner: $("seaCorner"), seaSide: $("seaSide"), btnPort: $("btnPort"), stick: $("stick"), knob: $("knob"), stickArrow: $("stickArrow"),
      touchHint: $("touchHint"), dive: $("dive"), diveArc: $("diveArc"),
      toast: $("toast"), big: $("bigText"), conf: $("conf"), flashHurt: $("flashHurt"), flashGood: $("flashGood"), fade: $("fade"),
      menu: $("menu"), mPlunder: $("mPlunder"), mBounty: $("mBounty"),
      port: $("port"), shipName: $("shipName"), shipSub: $("shipSub"), slots: $("slots"), hpText: $("hpText"), hpBar: $("hpBar"), shipStats: $("shipStats"),
      how: $("ovHow"), pause: $("ovPause"), shop: $("ovShop"), shopPanel: $("shopPanel"), sunk: $("ovSunk"), sunkPanel: $("sunkPanel"),
      btnMute: $("btnMute"), btnMute2: $("btnMute2")
    };

    // =====================================================================
    // 2. Utilities, data tables, persistent state.
    // =====================================================================
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const fmt = (n) => Math.floor(n).toLocaleString("en-US");
    const fmtK = (n) => n >= 1e6 ? (Math.round(n / 1e5) / 10) + "M" : n >= 1e4 ? (Math.round(n / 100) / 10) + "K" : fmt(n);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const TAU = Math.PI * 2;
    const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const memStore = {};
    const store = {
      get(k, d) { try { const v = canStore ? ctx.storage.get("pt_" + k) : memStore[k]; return v == null ? d : v; } catch (_) { return d; } },
      set(k, v) { try { if (canStore) ctx.storage.set("pt_" + k, v); else memStore[k] = v; } catch (_) {} }
    };

    // ---- cannons ------------------------------------------------------------
    // dmg per ball, range in metres, rate in shots per minute, ball speed.
    const CANNONS = {
      iron:   { name: "Iron Cannon",  icon: "💣", dmg: 28, range: 62, rate: 24, speed: 62, cost: 350,  gems: 0,  tier: 1, desc: "Reliable broadside iron." },
      swivel: { name: "Swivel Gun",   icon: "🔫", dmg: 9,  range: 48, rate: 60, speed: 80, cost: 700,  gems: 0,  tier: 1, desc: "Fast, light, wide arc." },
      chain:  { name: "Chain Shot",   icon: "⛓️", dmg: 15, range: 58, rate: 16, speed: 58, cost: 1400, gems: 0,  tier: 2, desc: "Tears sails: target slowed 45% for 5 s.", slow: 5 },
      long:   { name: "Long Nine",    icon: "🎯", dmg: 48, range: 96, rate: 10, speed: 92, cost: 3200, gems: 0,  tier: 2, desc: "Reach out and touch them." },
      fire:   { name: "Incendiary",   icon: "🔥", dmg: 18, range: 62, rate: 17, speed: 60, cost: 5500, gems: 12, tier: 3, desc: "Sets the target ablaze: 36 burn over 6 s.", burn: 36 },
      mortar: { name: "Mortar",       icon: "💥", dmg: 80, range: 115, rate: 6, speed: 46, cost: 12000, gems: 40, tier: 4, desc: "Lobbed shell, 9 m splash. Useless up close.", splash: 9, minRange: 28, lob: 1 }
    };
    const CANNON_ORDER = ["iron", "swivel", "chain", "long", "fire", "mortar"];
    const MAX_CANNON_LV = 10;
    function cannonUpCost(c) { const base = CANNONS[c.type].cost; return Math.round(base * 0.55 * Math.pow(1.45, c.lv)); }
    function cannonDmg(c) { return CANNONS[c.type].dmg * (1 + 0.14 * c.lv) * (1 + 0.05 * upLv("gunnery")); }

    // ---- hulls ----------------------------------------------------------------
    // slots: side + fraction along the hull (0 stern, 1 bow)
    const TIERS = [
      { id: "sloop", name: "Sloop", hp: 320, speed: 9.5, turn: 1.5, hold: 2500, cost: 0, gems: 0, len: 11, beam: 3.8, masts: 1,
        slots: [{ s: "P", t: 0.42 }, { s: "P", t: 0.62 }, { s: "S", t: 0.42 }, { s: "S", t: 0.62 }] },
      { id: "brig", name: "Brigantine", hp: 700, speed: 10.2, turn: 1.25, hold: 6000, cost: 7000, gems: 25, len: 15, beam: 4.6, masts: 2,
        slots: [{ s: "P", t: 0.32 }, { s: "P", t: 0.5 }, { s: "P", t: 0.68 }, { s: "S", t: 0.32 }, { s: "S", t: 0.5 }, { s: "S", t: 0.68 }] },
      { id: "frigate", name: "Frigate", hp: 1500, speed: 10.6, turn: 1.05, hold: 14000, cost: 28000, gems: 90, len: 19, beam: 5.4, masts: 2,
        slots: [{ s: "P", t: 0.3 }, { s: "P", t: 0.47 }, { s: "P", t: 0.64 }, { s: "S", t: 0.3 }, { s: "S", t: 0.47 }, { s: "S", t: 0.64 }, { s: "B", t: 0.9 }, { s: "T", t: 0.1 }] },
      { id: "galleon", name: "Galleon", hp: 3200, speed: 10.2, turn: 0.85, hold: 36000, cost: 95000, gems: 280, len: 25, beam: 7.2, masts: 3,
        slots: [{ s: "P", t: 0.24 }, { s: "P", t: 0.38 }, { s: "P", t: 0.52 }, { s: "P", t: 0.66 }, { s: "S", t: 0.24 }, { s: "S", t: 0.38 }, { s: "S", t: 0.52 }, { s: "S", t: 0.66 }, { s: "B", t: 0.9 }, { s: "T", t: 0.1 }] }
    ];
    const UPGRADES = [
      { id: "hull", icon: "🛡️", name: "Hull Plating", desc: "+9% hull per level", max: 10, base: 400, growth: 1.42 },
      { id: "sails", icon: "⛵", name: "Sails", desc: "+3% speed, +3% turn per level", max: 10, base: 350, growth: 1.42 },
      { id: "hold", icon: "📦", name: "Hold", desc: "+14% hold capacity per level", max: 10, base: 300, growth: 1.4 },
      { id: "carp", icon: "🔧", name: "Carpenters", desc: "Repair 1.2% hull/s out of combat per level", max: 6, base: 600, growth: 1.5 },
      { id: "gunnery", icon: "🎯", name: "Gunnery", desc: "+5% damage from every cannon per level", max: 10, base: 800, growth: 1.45 }
    ];
    function upCost(u, lv) { return Math.round(u.base * Math.pow(u.growth, lv)); }

    // ---- quests -----------------------------------------------------------------
    const QUESTS = [
      { kind: "sink", n: 2, text: "Plunder 2 ships", coins: 600, gems: 2 },
      { kind: "loot", n: 1500, text: "Bank 1,500 gold", coins: 800, gems: 3 },
      { kind: "treasure", n: 1, text: "Find 1 sunken treasure", coins: 900, gems: 4 },
      { kind: "sink", n: 4, text: "Plunder 4 ships", coins: 1200, gems: 4 },
      { kind: "level", n: 8, text: "Sink a level 8+ ship", coins: 1600, gems: 5 },
      { kind: "far", n: 300, text: "Sail 300 m from port", coins: 1000, gems: 4 },
      { kind: "sink", n: 6, text: "Plunder 6 ships", coins: 2200, gems: 6 },
      { kind: "treasure", n: 2, text: "Find 2 sunken treasures", coins: 2400, gems: 8 },
      { kind: "level", n: 15, text: "Sink a level 15+ ship", coins: 3000, gems: 8 },
      { kind: "fort", n: 1, text: "Destroy a fort", coins: 6000, gems: 20 },
      { kind: "loot", n: 12000, text: "Bank 12,000 gold", coins: 4000, gems: 10 },
      { kind: "sink", n: 10, text: "Plunder 10 ships", coins: 5000, gems: 12 },
      { kind: "level", n: 25, text: "Sink a level 25+ ship", coins: 7000, gems: 16 },
      { kind: "far", n: 650, text: "Sail 650 m from port", coins: 5000, gems: 14 },
      { kind: "treasure", n: 3, text: "Find 3 sunken treasures", coins: 7000, gems: 20 },
      { kind: "fort", n: 2, text: "Destroy 2 forts", coins: 15000, gems: 45 },
      { kind: "level", n: 40, text: "Sink a level 40+ ship", coins: 18000, gems: 40 },
      { kind: "sink", n: 20, text: "Plunder 20 ships", coins: 20000, gems: 40 },
      { kind: "loot", n: 80000, text: "Bank 80,000 gold", coins: 25000, gems: 50 },
      { kind: "fort", n: 3, text: "Destroy 3 forts", coins: 40000, gems: 90 }
    ];
    // After the list, quests repeat with growing targets.
    function questAt(i) {
      if (i < QUESTS.length) return QUESTS[i];
      const k = i - QUESTS.length, cycle = (k / 4 | 0) + 1;
      const q = [
        { kind: "sink", n: 20 + cycle * 8, text: "Plunder " + (20 + cycle * 8) + " ships", coins: 25000 * cycle, gems: 45 * cycle },
        { kind: "level", n: Math.min(60, 40 + cycle * 4), text: "Sink a level " + Math.min(60, 40 + cycle * 4) + "+ ship", coins: 20000 * cycle, gems: 40 * cycle },
        { kind: "treasure", n: 3 + cycle, text: "Find " + (3 + cycle) + " sunken treasures", coins: 12000 * cycle, gems: 30 * cycle },
        { kind: "fort", n: 3, text: "Destroy 3 forts", coins: 45000 * cycle, gems: 90 * cycle }
      ];
      return q[k % 4];
    }

    // ---- saved state ----------------------------------------------------------
    const DEFAULT_SAVE = () => ({
      v: 1, coins: 500, gems: 0, tier: 0, up: { hull: 0, sails: 0, hold: 0, carp: 0, gunnery: 0 },
      cannons: [{ id: 1, type: "iron", lv: 0 }, { id: 2, type: "iron", lv: 0 }], nextId: 3,
      slots: [1, null, 2, null],
      xp: 0, quest: 0, qp: 0,
      life: { plunder: 0, bounty: 0, sunk: 0, forts: 0, treasures: 0, best: 0 },
      hp: -1, seed: (Math.random() * 1e9) | 0, hint: 0, muted: false
    });
    let S = null;
    function loadSave() {
      const s = store.get("save", null);
      S = DEFAULT_SAVE();
      if (s && typeof s === "object") {
        for (const k in s) if (k in S) S[k] = s[k];
        S.up = Object.assign(DEFAULT_SAVE().up, s.up || {});
        S.life = Object.assign(DEFAULT_SAVE().life, s.life || {});
      }
      if (!Array.isArray(S.slots) || S.slots.length !== TIERS[S.tier].slots.length) {
        const n = TIERS[S.tier].slots.length, old = Array.isArray(S.slots) ? S.slots : [];
        S.slots = Array.from({ length: n }, (_, i) => old[i] == null ? null : old[i]);
      }
    }
    let saveTok = 0;
    function save() {
      saveTok += 1;
      const tok = saveTok;
      ctx.timeout(() => { if (tok === saveTok) store.set("save", S); }, 120);
    }
    loadSave();
    function upLv(id) { return S.up[id] || 0; }
    function tier() { return TIERS[S.tier]; }
    function cannonById(id) { for (const c of S.cannons) if (c.id === id) return c; return null; }
    function maxHp() { return Math.round(tier().hp * (1 + 0.09 * upLv("hull"))); }
    function holdCap() { return Math.round(tier().hold * (1 + 0.14 * upLv("hold"))); }
    function shipSpeed() { return tier().speed * (1 + 0.03 * upLv("sails")); }
    function shipTurn() { return tier().turn * (1 + 0.03 * upLv("sails")); }
    function captainLevel() { return 1 + Math.floor(Math.sqrt(S.xp / 60)); }
    function xpForNext() { const l = captainLevel(); return 60 * l * l; }
    // A rough power score, used to size the sea's challenge and to judge prey vs threat.
    function playerPower() {
      let dps = 0;
      for (const id of S.slots) { const c = id == null ? null : cannonById(id); if (c) dps += cannonDmg(c) * CANNONS[c.type].rate / 60; }
      return Math.max(1, Math.round((dps * 2.2 + maxHp() / 40) / 2.3));
    }

    // =====================================================================
    // 3. Audio — synthesized SFX plus a ctx.music bed.
    // =====================================================================
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!S.muted;
    let AC = null, master = null, seaGain = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      try {
        AC = new C();
        master = AC.createGain(); master.gain.value = muted ? 0 : 0.85; master.connect(AC.destination);
        const n = AC.sampleRate * 2, buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420; f.Q.value = 0.4;
        seaGain = AC.createGain(); seaGain.gain.value = 0;
        src.connect(f); f.connect(seaGain); seaGain.connect(master); src.start();
        const lfo = AC.createOscillator(); lfo.frequency.value = 0.13;
        const lg = AC.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(seaGain.gain); lfo.start();
      } catch (_) { AC = null; master = null; seaGain = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }
    function setSea(level) { if (seaGain) { try { seaGain.gain.setTargetAtTime(muted ? 0 : level, AC.currentTime, 0.3); } catch (_) {} } }
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
    function noise(dur, cutoff, peak, type, delay) {
      ensureAC(); resumeAC();
      if (!AC || muted) return;
      try {
        const n = Math.max(1, (AC.sampleRate * dur) | 0), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = AC.createBufferSource(); src.buffer = buf;
        const f = AC.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = cutoff || 1200; f.Q.value = 0.8;
        const g = AC.createGain(); g.gain.value = peak || 0.25;
        src.connect(f); f.connect(g); g.connect(master);
        const t = AC.currentTime + (delay || 0);
        src.start(t); src.stop(t + dur + 0.02);
      } catch (_) {}
    }
    function fbSting(name) { if (AC || muted || !canMusic || !ctx.music || !ctx.music.sting) return; try { ctx.music.sting(name); } catch (_) {} }
    let boomT = 0;
    const sfx = {
      ui() { tone(620, 0, 0.07, "sine", 0.1); if (!AC) fbSting("tap"); },
      boom(dist) {
        const v = clamp(1 - dist / 140, 0.15, 1);
        const now = performance.now(); if (now - boomT < 40) return; boomT = now;
        noise(0.35, 180, 0.42 * v, "lowpass"); tone(70, 0, 0.32, "sine", 0.28 * v, 32);
      },
      hit(dist) { const v = clamp(1 - dist / 140, 0.2, 1); noise(0.14, 900, 0.3 * v); tone(220, 0, 0.12, "square", 0.08 * v, 90); },
      splash(dist) { const v = clamp(1 - dist / 120, 0.1, 1); noise(0.22, 2400, 0.14 * v, "highpass"); },
      coin() { if (!AC) { fbSting("coin"); return; } tone(1174, 0, 0.09, "triangle", 0.1); tone(1568, 0.04, 0.12, "sine", 0.06); },
      gem() { if (!AC) { fbSting("powerup"); return; } [988, 1318, 1760, 2093].forEach((f, i) => tone(f, i * 0.05, 0.3, "triangle", 0.12)); },
      sink() { if (!AC) { fbSting("success"); return; } noise(0.9, 300, 0.32, "lowpass"); tone(160, 0.1, 0.9, "sawtooth", 0.08, 40); [523, 659, 784].forEach((f, i) => tone(f, 0.5 + i * 0.09, 0.3, "triangle", 0.12)); },
      mySink() { if (!AC) { fbSting("lose"); return; } noise(1.2, 220, 0.4, "lowpass"); [392, 349, 311, 262, 196].forEach((f, i) => tone(f, i * 0.16, 0.5, "triangle", 0.14)); },
      burn() { noise(0.4, 700, 0.12, "bandpass"); },
      quest() { if (!AC) { fbSting("win"); return; } [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.08, 0.5, "triangle", 0.14)); },
      buy() { if (!AC) { fbSting("coin"); return; } [660, 880, 1174].forEach((f, i) => tone(f, i * 0.06, 0.26, "triangle", 0.14)); },
      treasure() { if (!AC) { fbSting("success"); return; } [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, i * 0.07, 0.45, "sine", 0.13)); },
      bump() { noise(0.2, 300, 0.25, "lowpass"); tone(120, 0, 0.18, "square", 0.08, 60); },
      levelUp() { if (!AC) { fbSting("win"); return; } [523, 784, 1046, 1568].forEach((f, i) => tone(f, i * 0.1, 0.5, "triangle", 0.15)); },
      bell() { tone(1046, 0, 0.6, "sine", 0.12, 1040); tone(1568, 0.02, 0.5, "sine", 0.05); }
    };
    let musicOn = false;
    function bed(preset, volume) {
      if (!canMusic || !ctx.music) return;
      try {
        if (muted) { if (musicOn) { ctx.music.pause(); musicOn = false; } return; }
        const st = ctx.music.state && ctx.music.state();
        if (!musicOn && st === "paused") { ctx.music.resume(); ctx.music.setPreset(preset, { fadeMs: 700 }); ctx.music.setVolume(volume, { fadeMs: 700 }); musicOn = true; }
        else if (!musicOn || st === "stopped") { ctx.music.unlock(); ctx.music.play({ preset, volume, fadeInMs: 900 }); musicOn = true; }
        else { ctx.music.setPreset(preset, { fadeMs: 700 }); ctx.music.setVolume(volume, { fadeMs: 700 }); }
      } catch (_) {}
    }
    let musicIntensity = -1;
    function bedIntensity(v) {
      if (!canMusic || !ctx.music || !musicOn || muted) return;
      if (Math.abs(v - musicIntensity) < 0.15) return;
      musicIntensity = v;
      try { ctx.music.setIntensity(v, { fadeMs: 1200 }); } catch (_) {}
    }
    function applyMute() {
      el.btnMute.textContent = muted ? "🔇" : "🔊";
      el.btnMute2.textContent = muted ? "🔇 Sound off" : "🔊 Sound on";
      if (master) master.gain.value = muted ? 0 : 0.85;
      if (seaGain) setSea(state === "sea" ? 0.12 : 0.05);
      try {
        if (canMusic && ctx.music) {
          if (muted && musicOn) { ctx.music.pause(); musicOn = false; }
          else if (!muted && started) bed(state === "sea" ? "drift" : "cozy", state === "sea" ? 0.24 : 0.18);
        }
      } catch (_) {}
    }
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // =====================================================================
    // 4. Screen plumbing.
    // =====================================================================
    let state = "menu";       // menu | port | sea | paused | sinking | sunk
    let started = false;
    let toastTok = 0, bigTok = 0;
    function toast(msg, ms) {
      el.toast.textContent = msg; el.toast.classList.add("show");
      const tok = ++toastTok;
      ctx.timeout(() => { if (tok === toastTok) el.toast.classList.remove("show"); }, ms || 1400);
    }
    function bigText(title, sub, ms) {
      el.big.innerHTML = esc(title) + (sub ? "<small>" + esc(sub) + "</small>" : "");
      el.big.classList.add("show");
      const tok = ++bigTok;
      ctx.timeout(() => { if (tok === bigTok) el.big.classList.remove("show"); }, ms || 1700);
    }
    function confetti() {
      el.conf.innerHTML = "";
      const cols = ["#ffd35a", "#5cc2ff", "#ff6b9d", "#7ee8a2", "#ffffff", "#b39dff"];
      for (let i = 0; i < 40; i++) {
        const p = document.createElement("i");
        p.style.left = (Math.random() * 100) + "%"; p.style.background = cols[i % cols.length];
        p.style.animationDelay = (Math.random() * 0.5) + "s"; p.style.animationDuration = (1.3 + Math.random() * 0.9) + "s";
        el.conf.appendChild(p);
      }
      ctx.timeout(() => { el.conf.innerHTML = ""; }, 2600);
    }
    function flash(node) { node.classList.add("on"); ctx.timeout(() => node.classList.remove("on"), 80); }
    function firstGesture() {
      if (!started) {
        started = true;
        try { ctx.platform.start(); } catch (_) {}
        if (canMusic && ctx.music) { try { ctx.music.unlock(); } catch (_) {} }
      }
      ensureAC(); resumeAC();
    }
    function refreshWallet() {
      el.wCoins.textContent = fmtK(S.coins);
      el.wGems.textContent = fmt(S.gems);
      el.tLvl.textContent = String(captainLevel());
      el.mPlunder.textContent = fmtK(S.life.plunder);
      el.mBounty.textContent = fmtK(S.life.bounty);
    }
    function refreshQuest() {
      const q = questAt(S.quest);
      el.qText.textContent = "📜 " + q.text;
      el.qBar.style.width = clamp(S.qp / q.n, 0, 1) * 100 + "%";
      el.qReward.textContent = fmtK(q.coins) + " 🪙" + (q.gems ? " · " + q.gems + " 💎" : "") + "  ·  " + Math.min(S.qp, q.n) + "/" + q.n;
    }
    function questProgress(kind, amount, value) {
      const q = questAt(S.quest);
      if (q.kind !== kind) return;
      if (kind === "level" || kind === "far") { if (value >= q.n) S.qp = q.n; }
      else S.qp = Math.min(q.n, S.qp + amount);
      refreshQuest();
      if (S.qp >= q.n) {
        S.coins += q.coins; S.gems += q.gems; S.life.plunder += q.coins;
        S.quest += 1; S.qp = 0;
        save(); refreshWallet(); refreshQuest();
        sfx.quest(); haptic("success"); confetti(); flash(el.flashGood);
        bigText("QUEST COMPLETE", "+" + fmtK(q.coins) + " gold" + (q.gems ? " · +" + q.gems + " gems" : ""), 2200);
        try { ctx.platform.milestone("quest_complete", { quest: S.quest }); } catch (_) {}
      }
    }

    refreshWallet(); refreshQuest();
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
        try { const raw = await ctx.importModule("three", "0.164.1"); const mod = usable(raw); if (mod) return mod; noteErr("loaded, but no WebGLRenderer"); }
        catch (err) { noteErr(err); }
      }
      return null;
    }
    while (!THREE) {
      THREE = await importThree();
      if (THREE) break;
      try { ctx.platform.error({ reason: "three_import_failed", message: lastLoadErr }); } catch (_) {}
      await new Promise((resolve) => {
        const f = document.createElement("div");
        f.className = "pt-fatal";
        f.innerHTML = "<div><div style='font-size:44px;'>\u{1F3F4}‍☠️</div><div style='font-size:16px;font-weight:800;margin-top:10px;'>The sea didn't load.</div>" +
          "<div style='font-size:13px;opacity:.75;margin-top:6px;'>Check your connection, then try again.</div>" +
          "<button class='pt-btn' id='ptRetry' style='margin:18px auto 0;width:200px;'>Try again</button>" +
          "<div style='font-size:10px;opacity:.4;margin-top:14px;word-break:break-word;'>" + esc(lastLoadErr) + "</div></div>";
        ui.appendChild(f);
        ctx.listen(f.querySelector("#ptRetry"), "click", () => { sfx.ui(); f.remove(); resolve(); });
      });
    }
    let renderer = null;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); }
    catch (e1) {
      try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false }); }
      catch (e2) {
        const f = document.createElement("div"); f.className = "pt-fatal";
        f.innerHTML = "<div><div style='font-size:44px;'>\u{1F3F4}‍☠️</div><div style='font-size:15px;font-weight:800;margin-top:10px;'>This device couldn't start 3D graphics.<br>Close other apps and reopen.</div></div>";
        ui.appendChild(f); try { ctx.platform.error({ reason: "webgl_unavailable" }); } catch (_) {}
        return;
      }
    }
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x2f7f9a, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.listen(canvas, "webglcontextlost", (e) => { e.preventDefault(); });
    ctx.listen(canvas, "webglcontextrestored", () => { try { renderer.resetState(); } catch (_) {} });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2f7f9a);
    scene.fog = new THREE.Fog(0x3d93ad, 120, 330);
    const camera = new THREE.PerspectiveCamera(50, ctx.width / Math.max(1, ctx.height), 1, 700);
    scene.add(camera);
    const hemi = new THREE.HemisphereLight(0xdff4ff, 0x1d5a70, 0.95);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
    sun.position.set(-40, 90, -30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 260;
    sun.shadow.camera.left = -110; sun.shadow.camera.right = 110; sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
    sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    function resize() {
      const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 1.75));
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    let lastW = ctx.width, lastH = ctx.height;
    resize();

    // =====================================================================
    // 6. Textures, materials, mesh builders. Everything low-poly, flat shaded.
    // =====================================================================
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function paint(w, h, fn) {
      if (!CAN_BAKE) return null;
      let c = null; try { c = new OffscreenCanvas(w, h); } catch (_) { return null; }
      fn(c.getContext("2d"), w, h); return c;
    }
    function texture(c, srgb) {
      if (!c) return null;
      const t = new THREE.CanvasTexture(c);
      if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    }
    const softTex = texture(paint(32, 32, (g) => {
      for (let r = 16; r > 0; r -= 2) { g.fillStyle = "rgba(255,255,255," + (0.1 + (1 - r / 16) * 0.9).toFixed(2) + ")"; g.beginPath(); g.arc(16, 16, r, 0, 6.29); g.fill(); }
    }), false);
    const plankTex = texture(paint(64, 64, (g, w, h) => {
      g.fillStyle = "#8a5a34"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#7c4f2c" : "#94633a"; g.fillRect(0, i * 8, w, 8); g.fillStyle = "#5a3618"; g.fillRect(0, i * 8, w, 1); }
    }));
    const stoneTex = texture(paint(64, 64, (g, w, h) => {
      g.fillStyle = "#8d949c"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#5f666e"; g.lineWidth = 2;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) g.strokeRect(x * 32 + (y % 2) * 16 - 16, y * 16, 32, 16);
      g.fillStyle = "rgba(255,255,255,.08)"; for (let i = 0; i < 12; i++) g.fillRect(Math.random() * w, Math.random() * h, 6, 3);
    }));
    const sailTex = texture(paint(64, 64, (g, w, h) => {
      g.fillStyle = "#f4efe2"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(120,100,70,.28)"; g.lineWidth = 1;
      for (let x = 8; x < w; x += 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    }));

    const matCache = new Map();
    function mat(color, opts) {
      const key = color + "|" + JSON.stringify(opts || {});
      if (matCache.has(key)) return matCache.get(key);
      const o = Object.assign({ color, flatShading: true }, opts || {});
      const m = new THREE.MeshLambertMaterial(o);
      m.userData.shared = true;
      matCache.set(key, m);
      return m;
    }
    function mesh(geo, material, cast, recv) { const m = new THREE.Mesh(geo, material); m.castShadow = !!cast; m.receiveShadow = !!recv; return m; }
    const GEO = {
      box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
      cone: new THREE.ConeGeometry(1, 1, 8), sphere: new THREE.SphereGeometry(1, 10, 8), sphereLo: new THREE.IcosahedronGeometry(1, 1),
      dodeca: new THREE.DodecahedronGeometry(1, 0), ball: new THREE.SphereGeometry(0.28, 8, 6), disc: new THREE.CircleGeometry(1, 20),
      ring: new THREE.RingGeometry(0.8, 1, 24)
    };
    const MAT = {
      hull: new THREE.MeshLambertMaterial({ map: plankTex, flatShading: true }),
      sail: new THREE.MeshLambertMaterial({ map: sailTex, side: THREE.DoubleSide, flatShading: false }),
      stone: new THREE.MeshLambertMaterial({ map: stoneTex, flatShading: true })
    };
    for (const k in MAT) MAT[k].userData.shared = true;

    // ---- a lofted hull: stations along the length, a ring of points each ------
    function hullGeometry(len, beam, depth, sheer, color, stripeColor) {
      const N = 10, pts = [], idx = [], cols = [];
      const half = beam / 2;
      const c = new THREE.Color(color);
      const dark = c.clone().multiplyScalar(0.72);
      const stripe = new THREE.Color(stripeColor == null ? 0xf0d67a : stripeColor);
      const stationRing = (t) => {
        // width profile: fine bow, fuller stern
        const w = half * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * t)), 0.62) * (t < 0.1 ? 0.85 : 1);
        const z = (t - 0.5) * len;
        const deckY = depth * 0.55 + sheer * Math.pow(Math.abs(t - 0.45) * 2, 2.2);
        const keelY = -depth * 0.55 * (0.35 + 0.65 * Math.sin(Math.PI * (0.05 + 0.9 * t)));
        return [
          [w, deckY, z], [w * 1.02, deckY * 0.35, z], [w * 0.7, keelY * 0.6, z], [0, keelY, z],
          [-w * 0.7, keelY * 0.6, z], [-w * 1.02, deckY * 0.35, z], [-w, deckY, z]
        ];
      };
      const rings = [];
      for (let i = 0; i <= N; i++) rings.push(stationRing(i / N));
      const R = 7;
      for (let i = 0; i <= N; i++) for (let k = 0; k < R; k++) {
        const p = rings[i][k]; pts.push(p[0], p[1], p[2]);
        const cc = k === 0 || k === R - 1 ? c : (k === 1 || k === R - 2) ? stripe : dark;
        cols.push(cc.r, cc.g, cc.b);
      }
      const at = (i, k) => i * R + k;
      for (let i = 0; i < N; i++) for (let k = 0; k < R - 1; k++) {
        const a = at(i, k), b = at(i, k + 1), c2 = at(i + 1, k), d = at(i + 1, k + 1);
        idx.push(a, c2, b, b, c2, d);
      }
      // deck strip and stern transom
      const base = pts.length / 3;
      for (let i = 0; i <= N; i++) {
        const l = rings[i][0], r = rings[i][R - 1];
        pts.push(l[0] * 0.92, l[1] + 0.02, l[2], r[0] * 0.92, r[1] + 0.02, r[2]);
        const dc = new THREE.Color(0xb98a5a);
        cols.push(dc.r, dc.g, dc.b, dc.r, dc.g, dc.b);
      }
      for (let i = 0; i < N; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const sternBase = pts.length / 3;
      for (let k = 0; k < R; k++) { const p = rings[0][k]; pts.push(p[0], p[1], p[2]); cols.push(dark.r, dark.g, dark.b); }
      for (let k = 1; k < R - 1; k++) idx.push(sternBase, sternBase + k + 1, sternBase + k);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }
    const hullMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    hullMat.userData.shared = true;

    function sailMesh(w, h) {
      const g = new THREE.PlaneGeometry(w, h, 6, 4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2);
        p.setZ(i, (1 - x * x) * 0.22 * w * (0.6 + 0.4 * (1 - y * y)));
      }
      g.computeVertexNormals();
      return mesh(g, MAT.sail, true);
    }
    function cannonMesh(type) {
      const g = new THREE.Group();
      const col = { iron: 0x2b2f38, swivel: 0x4a4f5a, chain: 0x3a4658, long: 0x1f2a3a, fire: 0x5a2a1a, mortar: 0x3a3a3a }[type] || 0x2b2f38;
      const barrelLen = type === "long" ? 1.6 : type === "swivel" ? 0.8 : type === "mortar" ? 0.7 : 1.15;
      const barrelR = type === "mortar" ? 0.28 : type === "swivel" ? 0.1 : 0.16;
      const b = mesh(GEO.cyl, mat(col, { flatShading: false }), true);
      b.rotation.x = Math.PI / 2; b.scale.set(barrelR, barrelLen, barrelR); b.position.set(0, 0.32, barrelLen * 0.35);
      if (type === "mortar") b.rotation.x = Math.PI / 4;
      g.add(b);
      const car = mesh(GEO.box, mat(type === "fire" ? 0x7a3a1a : 0x6a4426), true); car.scale.set(0.5, 0.28, 0.7); car.position.y = 0.16; g.add(car);
      for (const s of [-1, 1]) { const w = mesh(GEO.cyl, mat(0x3a2a1a)); w.rotation.z = Math.PI / 2; w.scale.set(0.14, 0.08, 0.14); w.position.set(s * 0.3, 0.12, 0.1); g.add(w); }
      if (type === "fire") { const glow = mesh(GEO.sphere, mat(0xff7a2a, { emissive: 0xff4a00 })); glow.scale.setScalar(0.1); glow.position.set(0, 0.32, barrelLen * 0.9); g.add(glow); }
      g.userData.muzzle = new THREE.Vector3(0, 0.32, barrelLen * 0.9);
      return g;
    }
    // A slot's local position and facing on a hull of given size.
    function slotLocal(slot, len, beam, deckY) {
      const z = (slot.t - 0.5) * len;
      const w = beam / 2 * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * slot.t)), 0.62);
      if (slot.s === "P") return { x: w * 0.72, z, y: deckY, yaw: Math.PI / 2 };
      if (slot.s === "S") return { x: -w * 0.72, z, y: deckY, yaw: -Math.PI / 2 };
      if (slot.s === "B") return { x: 0, z, y: deckY, yaw: 0 };
      return { x: 0, z, y: deckY, yaw: Math.PI };
    }
    // Build a ship. spec: { len, beam, masts, color, flag, slots:[{s,t}], cannons:[type|null] }
    function buildShip(spec) {
      const g = new THREE.Group();
      const depth = spec.beam * 0.62, sheer = spec.beam * 0.12;
      const hull = mesh(hullGeometry(spec.len, spec.beam, depth, sheer, spec.color, spec.stripe), hullMat, true, true);
      g.add(hull);
      const deckY = depth * 0.55 + 0.02;
      // deck furniture: hatch, wheel, barrels
      const hatch = mesh(GEO.box, mat(0x5a3a1a)); hatch.scale.set(spec.beam * 0.3, 0.15, spec.len * 0.12); hatch.position.set(0, deckY + 0.07, spec.len * 0.05); g.add(hatch);
      const wheel = mesh(GEO.cyl, mat(0x6a4426)); wheel.rotation.x = Math.PI / 2; wheel.scale.set(0.35, 0.06, 0.35); wheel.position.set(0, deckY + 0.6, -spec.len * 0.3); g.add(wheel);
      for (let i = 0; i < 2; i++) { const b = mesh(GEO.cyl, MAT.hull, true); b.scale.set(0.28, 0.5, 0.28); b.position.set((i ? 1 : -1) * spec.beam * 0.22, deckY + 0.25, -spec.len * 0.18); g.add(b); }
      // masts and sails
      const mastH = spec.beam * 2.6;
      const mastZs = spec.masts === 1 ? [0.02] : spec.masts === 2 ? [-0.2, 0.22] : [-0.28, 0.02, 0.3];
      const sails = [];
      mastZs.forEach((mz, i) => {
        const m = mesh(GEO.cyl, mat(0x6a4426, { flatShading: false }), true); m.scale.set(0.11, mastH, 0.11); m.position.set(0, deckY + mastH / 2, mz * spec.len); g.add(m);
        const nS = i === 1 && spec.masts === 3 ? 2 : spec.masts >= 2 ? 2 : 1;
        for (let k = 0; k < nS; k++) {
          const sw = spec.beam * (1.5 - k * 0.35), sh = mastH * (nS === 1 ? 0.5 : 0.34);
          const yard = mesh(GEO.cyl, mat(0x6a4426, { flatShading: false })); yard.rotation.z = Math.PI / 2; yard.scale.set(0.07, sw, 0.07);
          const y = deckY + mastH * (nS === 1 ? 0.78 : 0.46 + k * 0.4);
          yard.position.set(0, y, mz * spec.len); g.add(yard);
          const s = sailMesh(sw * 0.96, sh); s.position.set(0, y - sh / 2 - 0.05, mz * spec.len - 0.1); g.add(s); sails.push(s);
        }
      });
      // flag on the tallest mast
      const flag = mesh(GEO.box, mat(spec.flag || 0xe8453c)); flag.scale.set(0.06, 0.6, 1.1); flag.position.set(0, deckY + mastH + 0.3, mastZs[mastZs.length > 1 ? 1 : 0] * spec.len - 0.55); g.add(flag);
      // bowsprit
      const bs = mesh(GEO.cyl, mat(0x6a4426, { flatShading: false })); bs.rotation.x = -Math.PI / 2 + 0.35; bs.scale.set(0.07, spec.len * 0.22, 0.07); bs.position.set(0, deckY + 0.3, spec.len * 0.55); g.add(bs);
      // stern castle for the big ones
      if (spec.masts === 3) { const castle = mesh(GEO.box, MAT.hull, true); castle.scale.set(spec.beam * 0.8, spec.beam * 0.35, spec.len * 0.18); castle.position.set(0, deckY + spec.beam * 0.17, -spec.len * 0.38); g.add(castle); }
      // lantern at the stern
      const lamp = mesh(GEO.sphere, mat(0xffe08a, { emissive: 0xffb040 })); lamp.scale.setScalar(0.16); lamp.position.set(0, deckY + 0.9, -spec.len * 0.48); g.add(lamp);
      // cannons
      const guns = [];
      spec.slots.forEach((slot, i) => {
        const type = spec.cannons[i];
        if (!type) return;
        const cm = cannonMesh(type);
        const p = slotLocal(slot, spec.len, spec.beam, deckY);
        cm.position.set(p.x, p.y, p.z); cm.rotation.y = p.yaw;
        g.add(cm);
        guns.push({ slot, type, mesh: cm, local: new THREE.Vector3(p.x, p.y + 0.3, p.z), yaw: p.yaw });
      });
      g.userData = { sails, guns, deckY, len: spec.len, beam: spec.beam, hull };
      return g;
    }

    // ---- islands, forts, port ----------------------------------------------------
    function islandMesh(r, h, seed) {
      const g = new THREE.Group();
      const geo = new THREE.ConeGeometry(r, h, 14, 4);
      const p = geo.attributes.position, cols = [];
      const sand = new THREE.Color(0xe8d5a3), grass = new THREE.Color(0x5fae5a), dark = new THREE.Color(0x3f8a48), rock = new THREE.Color(0x8a8f96);
      let s = seed || 1;
      const rr = () => { s = (s * 16807) % 2147483647; return (s & 0xffff) / 0xffff; };
      const bumps = [];
      for (let i = 0; i < 5; i++) bumps.push({ a: rr() * TAU, k: 0.7 + rr() * 0.6, f: 1 + (rr() * 4 | 0) });
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const a = Math.atan2(z, x), rad = Math.hypot(x, z);
        let n = 0; for (const b of bumps) n += Math.sin(a * b.f + b.a) * 0.06 * b.k;
        const k = rad > 0.01 ? 1 + n : 1;
        p.setX(i, x * k); p.setZ(i, z * k);
        const yy = y + h / 2;
        const c = yy < 0.9 ? sand : yy < h * 0.75 ? grass.clone().lerp(dark, yy / h) : rock;
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      const m = mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), true, true);
      m.position.y = h / 2 - 0.9;
      g.add(m);
      const beach = mesh(GEO.disc, mat(0xefe2b8, { flatShading: false }), false, true); beach.rotation.x = -Math.PI / 2; beach.scale.setScalar(r * 1.22); beach.position.y = 0.12; g.add(beach);
      // palms around the top rim
      const np = 3 + (rr() * 4 | 0);
      for (let i = 0; i < np; i++) {
        const a = rr() * TAU, d = r * (0.2 + rr() * 0.45);
        const pm = palm(1.6 + rr() * 1.6); pm.position.set(Math.cos(a) * d, h * (1 - d / r) * 0.75 - 0.6, Math.sin(a) * d); pm.rotation.y = rr() * TAU; g.add(pm);
      }
      for (let i = 0; i < 3; i++) {
        const a = rr() * TAU, d = r * (0.9 + rr() * 0.3);
        const rk = mesh(GEO.dodeca, mat(0x7c8794), true); rk.scale.set(0.8 + rr(), 0.6 + rr() * 0.6, 0.8 + rr()); rk.position.set(Math.cos(a) * d, 0.1, Math.sin(a) * d); rk.rotation.set(rr(), rr() * 6, rr()); g.add(rk);
      }
      return g;
    }
    function palm(h) {
      const g = new THREE.Group();
      const t = mesh(GEO.cyl, mat(0x8a6a3a, { flatShading: false }), true); t.scale.set(0.12, h, 0.1); t.position.y = h / 2; t.rotation.z = 0.12; g.add(t);
      for (let i = 0; i < 6; i++) {
        const leaf = mesh(GEO.box, mat(0x3fa04a), true); leaf.scale.set(0.35, 0.05, 1.5);
        leaf.position.set(0.06 * h, h, 0); leaf.rotation.y = i / 6 * TAU; leaf.rotation.x = 0.55;
        const piv = new THREE.Group(); piv.position.set(0.06 * h, h, 0); leaf.position.set(0, 0, 0.7); leaf.rotation.set(0.45, 0, 0);
        piv.rotation.y = i / 6 * TAU; piv.add(leaf); g.add(piv);
      }
      return g;
    }
    function rockMesh(size) {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const r = mesh(GEO.dodeca, mat(0x6f7a86), true, true); r.scale.set(size * rnd(0.6, 1), size * rnd(0.5, 1.1), size * rnd(0.6, 1));
        r.position.set(rnd(-size, size) * 0.5, size * 0.1, rnd(-size, size) * 0.5); r.rotation.set(rnd(0, 1), rnd(0, 6), rnd(0, 1)); g.add(r);
      }
      return g;
    }
    function fortMesh(r) {
      const g = new THREE.Group();
      const base = mesh(GEO.cyl6, MAT.stone, true, true); base.scale.set(r, 4, r); base.position.y = 2; g.add(base);
      const wall = mesh(GEO.cyl6, MAT.stone, true, true); wall.scale.set(r * 0.9, 2.5, r * 0.9); wall.position.y = 5; g.add(wall);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + Math.PI / 6;
        const tower = mesh(GEO.cyl, MAT.stone, true); tower.scale.set(1.6, 8, 1.6); tower.position.set(Math.cos(a) * r * 0.85, 4, Math.sin(a) * r * 0.85); g.add(tower);
        const roof = mesh(GEO.cone, mat(0x9a3a2a), true); roof.scale.set(2, 1.8, 2); roof.position.set(Math.cos(a) * r * 0.85, 8.9, Math.sin(a) * r * 0.85); g.add(roof);
        const gun = cannonMesh("mortar"); gun.scale.setScalar(1.6); gun.position.set(Math.cos(a) * r * 0.55, 6.3, Math.sin(a) * r * 0.55); gun.rotation.y = -a + Math.PI / 2; g.add(gun);
      }
      const keep = mesh(GEO.box, MAT.stone, true); keep.scale.set(r * 0.5, 5, r * 0.5); keep.position.y = 8.7; g.add(keep);
      const flag = mesh(GEO.box, mat(0x2a2a30)); flag.scale.set(0.06, 0.7, 1.2); flag.position.set(0, 13.5, -0.6); g.add(flag);
      const pole = mesh(GEO.cyl, mat(0x5a4a3a)); pole.scale.set(0.06, 3, 0.06); pole.position.set(0, 12.6, 0); g.add(pole);
      const sandRing = mesh(GEO.disc, mat(0xefe2b8, { flatShading: false }), false, true); sandRing.rotation.x = -Math.PI / 2; sandRing.scale.setScalar(r * 1.5); sandRing.position.y = 0.12; g.add(sandRing);
      return g;
    }
    function portMesh() {
      const g = new THREE.Group();
      const isle = islandMesh(30, 14, 77); g.add(isle);
      // dock: planks out over the water on the south side
      const dock = mesh(GEO.box, MAT.hull, true, true); dock.scale.set(7, 0.5, 30); dock.position.set(0, 0.55, -34); g.add(dock);
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { const p = mesh(GEO.cyl, mat(0x5a3a1a)); p.scale.set(0.25, 2.4, 0.25); p.position.set(s * 3.4, -0.2, -22 - i * 5); g.add(p); }
      const dock2 = mesh(GEO.box, MAT.hull, true, true); dock2.scale.set(22, 0.5, 6); dock2.position.set(0, 0.55, -20); g.add(dock2);
      // buildings
      const cols = [0xd9b27a, 0xc99a6a, 0xe0c090, 0xb88a5a];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.36, d = 24 - Math.abs(i - 2.5) * 1.5;
        const b = mesh(GEO.box, mat(cols[i % 4]), true); const w = rnd(3.5, 5), hh = rnd(3, 5);
        b.scale.set(w, hh, w); b.position.set(Math.cos(a) * d, 1.5 + hh / 2, Math.sin(a) * d); b.rotation.y = -a; g.add(b);
        const roof = mesh(GEO.cone, mat(0x9a3a2a), true); roof.scale.set(w * 0.85, 2, w * 0.85); roof.rotation.y = Math.PI / 4 - a; roof.position.set(Math.cos(a) * d, 1.5 + hh + 1, Math.sin(a) * d); g.add(roof);
      }
      const light = mesh(GEO.cyl, mat(0xffffff, { flatShading: false }), true); light.scale.set(1.1, 10, 1.1); light.position.set(16, 5, -30); g.add(light);
      const band = mesh(GEO.cyl, mat(0xe8453c)); band.scale.set(1.15, 1.4, 1.15); band.position.set(16, 6.5, -30); g.add(band);
      const lamp = mesh(GEO.sphere, mat(0xfff0a0, { emissive: 0xffd050 })); lamp.scale.setScalar(0.9); lamp.position.set(16, 10.6, -30); g.add(lamp);
      for (let i = 0; i < 5; i++) { const crate = mesh(GEO.box, MAT.hull, true); crate.scale.setScalar(rnd(0.9, 1.4)); crate.position.set(rnd(-8, 8), 1.4, -19 + rnd(-2, 2)); crate.rotation.y = rnd(0, 1); g.add(crate); }
      return g;
    }
    function lootMesh(kind) {
      const g = new THREE.Group();
      if (kind === "gems") { const c = mesh(GEO.dodeca, mat(0xd94fff, { emissive: 0x7a00aa, flatShading: true })); c.scale.setScalar(0.55); c.position.y = 0.4; g.add(c); }
      else { const b = mesh(GEO.cyl, MAT.hull, true); b.rotation.z = Math.PI / 2; b.scale.set(0.5, 1.0, 0.5); b.position.y = 0.3; g.add(b);
        const halo = mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.45, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; halo.scale.setScalar(1.6); halo.position.y = 0.05; g.add(halo);
        const coin = mesh(GEO.cyl, mat(0xffd35a, { emissive: 0x7a4a00, flatShading: false })); coin.scale.set(0.35, 0.08, 0.35); coin.position.set(0, 0.75, 0); g.add(coin); }
      return g;
    }
    function buoyMesh() {
      const g = new THREE.Group();
      const b = mesh(GEO.cone, mat(0xe8453c)); b.scale.set(0.9, 1.4, 0.9); b.position.y = 0.6; b.rotation.x = Math.PI; g.add(b);
      const top = mesh(GEO.sphere, mat(0xffd35a, { emissive: 0xaa6600 })); top.scale.setScalar(0.4); top.position.y = 1.6; g.add(top);
      const pole = mesh(GEO.cyl, mat(0x3a2a1a)); pole.scale.set(0.06, 1.2, 0.06); pole.position.y = 1.1; g.add(pole);
      const ring = mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.55, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(5); ring.position.y = 0.1; g.add(ring);
      g.userData.ring = ring;
      return g;
    }
    function wreckMesh() {
      const g = new THREE.Group();
      const h = mesh(hullGeometry(9, 3.2, 2, 0.3, 0x4a3a2a), hullMat, true); h.rotation.z = 0.9; h.rotation.y = rnd(0, 6); h.position.y = -0.5; g.add(h);
      const mast = mesh(GEO.cyl, mat(0x4a3a2a)); mast.scale.set(0.1, 5, 0.1); mast.rotation.z = 1.2; mast.position.set(1.5, 0.8, 0); g.add(mast);
      return g;
    }

    // =====================================================================
    // 7. Water. One big plane with a shader: deep-to-shallow colour near
    //    islands, animated foam rings, sun glints, and fog.
    // =====================================================================
    const SEA_R = 980;
    const MAX_ISL = 40;
    const islandUni = new Float32Array(MAX_ISL * 4);
    const waterUniforms = {
      time: { value: 0 },
      deep: { value: new THREE.Color(0x1f6f8f) },
      mid: { value: new THREE.Color(0x2f8faa) },
      shallow: { value: new THREE.Color(0x6fd0d6) },
      foam: { value: new THREE.Color(0xffffff) },
      isl: { value: islandUni },
      islN: { value: 0 },
      fogColor: { value: scene.fog.color },
      fogNear: { value: scene.fog.near },
      fogFar: { value: scene.fog.far }
    };
    const waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: `
        uniform float time;
        varying vec3 vW; varying float vFog;
        void main() {
          vec3 p = position;
          vec4 w = modelMatrix * vec4(p, 1.0);
          w.y += sin(w.x * 0.11 + time * 1.1) * 0.12 + sin(w.z * 0.13 - time * 0.9) * 0.12;
          vW = w.xyz;
          vec4 mv = viewMatrix * w;
          vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float time; uniform vec3 deep, mid, shallow, foam; uniform vec4 isl[${MAX_ISL}]; uniform int islN;
        uniform vec3 fogColor; uniform float fogNear, fogFar;
        varying vec3 vW; varying float vFog;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
        void main() {
          vec2 uv = vW.xz;
          float n1 = vnoise(uv * 0.09 + vec2(time * 0.05, -time * 0.03));
          float n2 = vnoise(uv * 0.23 - vec2(time * 0.07, time * 0.04));
          float wave = n1 * 0.6 + n2 * 0.4;
          vec3 col = mix(deep, mid, wave);
          // caustic-ish bright lines
          float c = pow(max(0.0, sin((uv.x + uv.y) * 0.9 + n2 * 6.0 + time * 1.6)), 22.0) * 0.045;
          col += c;
          // shallows and foam near land
          float sh = 0.0, fm = 0.0;
          for (int i = 0; i < ${MAX_ISL}; i++) {
            if (i >= islN) break;
            vec4 s = isl[i];
            float d = length(uv - s.xy) - s.z;
            sh = max(sh, 1.0 - smoothstep(0.0, 14.0, d));
            float ring = 1.0 - smoothstep(0.0, 5.5, d);
            fm = max(fm, ring * (0.45 + 0.55 * sin(d * 1.6 - time * 2.4 + n2 * 3.0)));
          }
          col = mix(col, shallow, sh * 0.85);
          col = mix(col, foam, clamp(fm, 0.0, 1.0) * 0.8);
          // sparkle
          float sp = step(0.985, vnoise(uv * 1.7 + time * 0.6)) * 0.35;
          col += sp;
          float f = smoothstep(fogNear, fogFar, vFog);
          col = mix(col, fogColor, f);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SEA_R * 2.6, SEA_R * 2.6, 96, 96), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.receiveShadow = false;
    water.frustumCulled = false;
    scene.add(water);
    // Shadows land on a transparent "shadow catcher" plane just above the water.
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.ShadowMaterial({ opacity: 0.22 }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.02; catcher.receiveShadow = true;
    scene.add(catcher);

    // ---- particles: smoke, splash, fire, sparks --------------------------------
    const PN = 420;
    const pPos = new Float32Array(PN * 3), pSize = new Float32Array(PN), pCol = new Float32Array(PN * 3), pAlpha = new Float32Array(PN);
    const parts = [];
    for (let i = 0; i < PN; i++) { parts.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 0, kind: 0 }); pPos[i * 3 + 1] = -50; }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("psize", new THREE.BufferAttribute(pSize, 1));
    pGeo.setAttribute("pcol", new THREE.BufferAttribute(pCol, 3));
    pGeo.setAttribute("palpha", new THREE.BufferAttribute(pAlpha, 1));
    const pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: softTex }, scale: { value: 600 } },
      vertexShader: `attribute float psize; attribute vec3 pcol; attribute float palpha; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = pcol; vA = palpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = psize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA);
#include <colorspace_fragment>
}`
    });
    const pPts = new THREE.Points(pGeo, pMat); pPts.frustumCulled = false; scene.add(pPts);
    let pNext = 0;
    const _v = new THREE.Vector3();
    // kind: 0 smoke, 1 splash, 2 fire, 3 spark, 4 foam
    function emit(kind, x, y, z, n, o) {
      o = o || {};
      for (let k = 0; k < n; k++) {
        const i = pNext; pNext = (pNext + 1) % PN;
        const p = parts[i];
        p.kind = kind;
        const sp = o.spread == null ? 1 : o.spread;
        p.vx = rnd(-sp, sp); p.vz = rnd(-sp, sp); p.vy = rnd(o.up == null ? 1 : o.up * 0.5, o.up == null ? 2.5 : o.up);
        if (o.dir) { p.vx += o.dir.x * (o.push || 4); p.vz += o.dir.z * (o.push || 4); }
        p.max = p.life = rnd(o.life == null ? 0.8 : o.life * 0.7, o.life == null ? 1.4 : o.life * 1.3);
        p.grow = o.grow == null ? 1.6 : o.grow;
        pPos[i * 3] = x + rnd(-0.4, 0.4); pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z + rnd(-0.4, 0.4);
        pSize[i] = o.size == null ? 1.2 : o.size;
        const c = kind === 0 ? [0.55, 0.55, 0.58] : kind === 1 ? [0.85, 0.95, 1.0] : kind === 2 ? [1.0, 0.45, 0.08] : kind === 3 ? [1.0, 0.85, 0.3] : [1, 1, 1];
        pCol[i * 3] = c[0]; pCol[i * 3 + 1] = c[1]; pCol[i * 3 + 2] = c[2];
        pAlpha[i] = 0.9;
      }
    }
    function updateParticles(dt) {
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { pPos[i * 3 + 1] = -50; pAlpha[i] = 0; continue; }
        const t = 1 - p.life / p.max;
        if (p.kind === 1 || p.kind === 3) p.vy -= 9 * dt;
        if (p.kind === 0) p.vy *= (1 - dt * 0.6);
        pPos[i * 3] += p.vx * dt; pPos[i * 3 + 1] += p.vy * dt; pPos[i * 3 + 2] += p.vz * dt;
        if (p.kind === 1 && pPos[i * 3 + 1] < 0) { pPos[i * 3 + 1] = 0; p.vy = 0; }
        pSize[i] += p.grow * dt;
        pAlpha[i] = p.kind === 2 ? 0.9 * (1 - t) : p.kind === 0 ? 0.55 * (1 - t * t) : 0.9 * (1 - t);
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.psize.needsUpdate = true; pGeo.attributes.palpha.needsUpdate = true;
    }

    // ---- wakes: a foam ribbon behind every moving ship --------------------------------
    const WAKE_N = 40;
    function makeWake() {
      const pos = new Float32Array(WAKE_N * 2 * 3), alpha = new Float32Array(WAKE_N * 2), idx = [];
      for (let i = 0; i < WAKE_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, wakeMat); m.frustumCulled = false;
      return { mesh: m, pts: [], pos, alpha, geo, lastX: 0, lastZ: 0 };
    }
    const wakeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: "attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "varying float vA; void main(){ gl_FragColor = vec4(0.92, 0.98, 1.0, vA * 0.55); }"
    });
    function wakePush(w, x, z, heading, width, moving) {
      if (Math.hypot(x - w.lastX, z - w.lastZ) < 0.9) return;
      w.lastX = x; w.lastZ = z;
      w.pts.push({ x, z, h: heading, w: width, on: moving, t: 0 });
      if (w.pts.length > WAKE_N) w.pts.shift();
    }
    function wakeUpdate(w, dt) {
      const n = w.pts.length;
      for (let i = 0; i < WAKE_N; i++) {
        const p = w.pts[n - WAKE_N + i];
        const a2 = i * 2;
        if (!p) { w.alpha[a2] = w.alpha[a2 + 1] = 0; continue; }
        p.t += dt;
        const spread = p.w * (0.5 + p.t * 0.5);
        const rx = Math.cos(p.h), rz = -Math.sin(p.h);
        w.pos[a2 * 3] = p.x - rx * spread; w.pos[a2 * 3 + 1] = 0.06; w.pos[a2 * 3 + 2] = p.z - rz * spread;
        w.pos[(a2 + 1) * 3] = p.x + rx * spread; w.pos[(a2 + 1) * 3 + 1] = 0.06; w.pos[(a2 + 1) * 3 + 2] = p.z + rz * spread;
        const fade = Math.max(0, 1 - p.t / 3.2);
        w.alpha[a2] = w.alpha[a2 + 1] = p.on ? fade : 0;
      }
      w.geo.attributes.position.needsUpdate = true; w.geo.attributes.alpha.needsUpdate = true;
    }

    // =====================================================================
    // 8. The world: port, islands, rocks, forts, treasure, wrecks.
    //    Seeded per save so the map is the same every voyage.
    // =====================================================================
    const world = { islands: [], forts: [], treasures: [], wrecks: [], group: new THREE.Group() };
    scene.add(world.group);
    function seeded(seed) { let s = (seed >>> 0) || 7; return () => { s = (s * 16807) % 2147483647; return (s & 0xffff) / 0xffff; }; }
    function nearestIslandGap(x, z, extra) {
      let best = Infinity;
      for (const i of world.islands) best = Math.min(best, Math.hypot(x - i.x, z - i.z) - i.r - (extra || 0));
      return best;
    }
    function buildWorld() {
      const rr = seeded(S.seed);
      // Home port at the centre.
      const port = portMesh(); world.group.add(port);
      world.port = { x: 0, z: 0, r: 30 };
      world.islands.push({ x: 0, z: 0, r: 32, port: true });
      // Islands in rings, leaving the lane south of the port clear.
      let tries = 0;
      while (world.islands.length < 38 && tries++ < 600) {
        const a = rr() * TAU, d = 110 + rr() * (SEA_R - 200);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const r = 14 + rr() * 30;
        if (nearestIslandGap(x, z, r) < 48) continue;
        const h = r * (0.35 + rr() * 0.4);
        const m = islandMesh(r, h, (rr() * 1e6) | 0); m.position.set(x, 0, z); world.group.add(m);
        world.islands.push({ x, z, r });
      }
      // Rocks: small, no beach, dangerous to hug.
      for (let i = 0; i < 44; i++) {
        const a = rr() * TAU, d = 80 + rr() * (SEA_R - 150);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (nearestIslandGap(x, z, 4) < 20) continue;
        const m = rockMesh(2 + rr() * 2.5); m.position.set(x, 0, z); world.group.add(m);
        world.islands.push({ x, z, r: 3.5, rock: true });
      }
      // Forts at three ranges.
      [[330, 15], [600, 32], [860, 50]].forEach(([d, lvl], i) => {
        let x = 0, z = 0, ok = false, t = 0;
        while (!ok && t++ < 60) { const a = rr() * TAU; x = Math.cos(a) * d; z = Math.sin(a) * d; ok = nearestIslandGap(x, z, 16) > 40; }
        const m = fortMesh(12); m.position.set(x, 0, z); world.group.add(m);
        world.islands.push({ x, z, r: 15, fort: true });
        world.forts.push({ x, z, lvl, hp: 0, maxHp: 0, mesh: m, alive: true, cd: 0, id: "fort" + i, respawn: 0 });
      });
      // Wrecks: scenery with a little loot.
      for (let i = 0; i < 8; i++) {
        const a = rr() * TAU, d = 120 + rr() * (SEA_R - 200);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (nearestIslandGap(x, z, 6) < 12) continue;
        const m = wreckMesh(); m.position.set(x, 0, z); world.group.add(m);
        world.wrecks.push({ x, z });
      }
      // Island uniforms for the water shader.
      let n = 0;
      for (const i of world.islands) { if (i.rock || n >= MAX_ISL) continue; islandUni[n * 4] = i.x; islandUni[n * 4 + 1] = i.z; islandUni[n * 4 + 2] = i.r * (i.fort ? 1.3 : 1.15); n++; }
      waterUniforms.islN.value = n;
      // Treasures
      for (let i = 0; i < 5; i++) spawnTreasure();
    }
    function spawnTreasure() {
      let x = 0, z = 0, t = 0;
      do { const a = rnd(0, TAU), d = rnd(110, SEA_R - 120); x = Math.cos(a) * d; z = Math.sin(a) * d; } while (nearestIslandGap(x, z, 8) < 14 && t++ < 40);
      const m = buoyMesh(); m.position.set(x, 0, z); world.group.add(m);
      world.treasures.push({ x, z, mesh: m, dive: 0 });
    }
    function fortStats(f) {
      f.maxHp = Math.round(600 + f.lvl * 110);
      f.hp = f.maxHp; f.alive = true; f.mesh.visible = true; f.burn = 0;
    }
    buildWorld();
    for (const f of world.forts) fortStats(f);

    // =====================================================================
    // 9. Ships: the player and the AI captains.
    // =====================================================================
    const ships = [];        // every ship incl. the player
    const projectiles = [];
    const loot = [];
    const enemyNames = ["Black Gull", "Sea Wasp", "Red Kestrel", "Tide Wraith", "Salt Fang", "Grey Widow", "Iron Heron", "Bloody Marlin", "Storm Crow", "Rusty Anchor", "Golden Eel", "Night Petrel", "Corsair's Whim", "Reaper's Sloop", "Brine Fox", "Old Lantern"];
    function levelToTier(l) { return l < 8 ? 0 : l < 18 ? 1 : l < 34 ? 2 : 3; }
    function enemySpec(lvl, ttier) {
      const T = TIERS[ttier];
      const cannonType = lvl < 5 ? "iron" : lvl < 12 ? pick(["iron", "swivel"]) : lvl < 22 ? pick(["iron", "chain", "long"]) : lvl < 40 ? pick(["long", "fire", "chain"]) : pick(["fire", "long", "mortar"]);
      const cannons = T.slots.map((s, i) => (i % 2 === 0 || lvl > 6) ? cannonType : null);
      return { len: T.len, beam: T.beam, masts: T.masts, color: pick([0x6b4a2e, 0x4a3a2a, 0x7a3a3a, 0x3a4a5a, 0x5a4a3a]), stripe: pick([0xe8453c, 0x2a2a30, 0xf0d67a, 0x4ec9a0]), flag: 0x1a1a22, slots: T.slots, cannons };
    }
    function makeShip(o) {
      const g = buildShip(o.spec);
      g.position.set(o.x, 0, o.z); g.rotation.y = o.heading;
      scene.add(g);
      const wake = makeWake(); scene.add(wake.mesh);
      const s = {
        id: o.id, player: !!o.player, x: o.x, z: o.z, heading: o.heading, speed: 0, vx: 0, vz: 0, turn: 0,
        maxSpeed: o.maxSpeed, turnRate: o.turnRate, hp: o.hp, maxHp: o.hp, lvl: o.lvl, name: o.name,
        mesh: g, wake, guns: g.userData.guns.map((gn) => ({ ref: gn, cd: rnd(0, 2), type: gn.type, dmg: 0, def: CANNONS[gn.type] })),
        burn: 0, burnT: 0, slow: 0, alive: true, sinkT: 0, len: o.spec.len, beam: o.spec.beam,
        ai: o.ai || null, target: null, throttle: 0, wantHeading: o.heading, lastHit: -99, lootCoins: o.lootCoins || 0, lootGems: o.lootGems || 0,
        roll: 0, pitch: 0, dmgMul: o.dmgMul || 1, rateMul: o.rateMul || 1, fireFrom: null
      };
      for (const gn of s.guns) gn.dmg = (o.gunDmg != null ? o.gunDmg : CANNONS[gn.type].dmg) * s.dmgMul;
      ships.push(s);
      return s;
    }
    function removeShip(s) {
      scene.remove(s.mesh); scene.remove(s.wake.mesh);
      s.mesh.traverse((o) => { if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); if (o.material && !(o.material.userData && o.material.userData.shared)) o.material.dispose(); });
      s.wake.geo.dispose();
      const i = ships.indexOf(s); if (i >= 0) ships.splice(i, 1);
      if (s.label) { s.label.remove(); s.label = null; }
    }

    // ---- the player --------------------------------------------------------------
    let me = null;
    function playerSpec() {
      const T = tier();
      return { len: T.len, beam: T.beam, masts: T.masts, color: 0x7a4a26, stripe: 0x2b90e8, flag: 0x2b90e8, slots: T.slots,
        cannons: S.slots.map((id) => { const c = id == null ? null : cannonById(id); return c ? c.type : null; }) };
    }
    function buildPlayer(x, z, heading) {
      if (me) removeShip(me);
      me = makeShip({ id: "me", player: true, x, z, heading, spec: playerSpec(), maxSpeed: shipSpeed(), turnRate: shipTurn(), hp: maxHp(), lvl: captainLevel(), name: "You" });
      if (S.hp > 0) me.hp = Math.min(me.maxHp, S.hp); else me.hp = me.maxHp;
      // player gun stats come from the armory
      me.guns.forEach((gn, i) => {
        const id = S.slots.filter((x2) => x2 != null)[i];
        const c = id == null ? null : cannonById(id);
        gn.dmg = c ? cannonDmg(c) : CANNONS[gn.type].dmg; gn.item = c;
      });
      return me;
    }

    // ---- enemies ---------------------------------------------------------------------
    let enemySeq = 0;
    function levelAt(x, z) {
      const d = Math.hypot(x, z);
      return Math.max(1, Math.round(1 + d / 36 + (captainLevel() - 1) * 0.3));
    }
    function spawnEnemy(x, z, lvl, ai) {
      const t = levelToTier(lvl);
      const spec = enemySpec(lvl, t);
      const hp = Math.round(70 * Math.pow(1 + lvl * 0.4, 1.1));
      const gunDmg = 7 + lvl * 1.35;
      const T = TIERS[t];
      const s = makeShip({ id: "e" + (enemySeq++), x, z, heading: rnd(0, TAU), spec, maxSpeed: T.speed * (0.72 + Math.min(0.28, lvl * 0.006)), turnRate: T.turn * 0.85,
        hp, lvl, name: pick(enemyNames), ai: ai || "patrol", gunDmg, rateMul: 0.8 + Math.min(0.5, lvl * 0.012),
        lootCoins: Math.round(55 * lvl * (1 + lvl * 0.06)), lootGems: lvl >= 10 && Math.random() < 0.15 + lvl * 0.012 ? 1 + (lvl / 15 | 0) : 0 });
      s.wp = { x: s.x + rnd(-80, 80), z: s.z + rnd(-80, 80) };
      s.state = "patrol"; s.stateT = 0;
      return s;
    }
    function ensureEnemies() {
      const alive = ships.filter((s) => !s.player && s.alive);
      const d0 = Math.hypot(me.x, me.z);
      const want = Math.min(11, 5 + (d0 / 220 | 0));
      if (alive.length >= want) return;
      // spawn in a ring beyond the camera view
      for (let t = 0; t < 12; t++) {
        const a = rnd(0, TAU), d = rnd(150, 240);
        const x = me.x + Math.cos(a) * d, z = me.z + Math.sin(a) * d;
        if (Math.hypot(x, z) > SEA_R - 40 || Math.hypot(x, z) < 70) continue;
        if (nearestIslandGap(x, z, 10) < 14) continue;
        const base = levelAt(x, z);
        const roll = Math.random();
        const lvl = Math.max(1, Math.round(base * (roll < 0.45 ? rnd(0.45, 0.85) : roll < 0.85 ? rnd(0.85, 1.2) : rnd(1.2, 1.7))));
        const hunter = captainLevel() >= 6 && Math.random() < 0.12;
        spawnEnemy(x, z, hunter ? Math.round(base * 1.5) : lvl, hunter ? "hunt" : "patrol");
        break;
      }
    }
    function cullEnemies() {
      for (const s of ships.slice()) {
        if (s.player || !s.alive) continue;
        if (Math.hypot(s.x - me.x, s.z - me.z) > 420) removeShip(s);
      }
    }

    // ---- steering / hull physics shared by everyone --------------------------------------
    function stepShip(s, dt) {
      const slowK = s.slow > 0 ? 0.55 : 1;
      const want = s.maxSpeed * clamp(s.throttle, 0, 1) * slowK;
      s.speed += (want - s.speed) * Math.min(1, dt * (want > s.speed ? 0.7 : 1.1));
      // turning is easier with way on
      const turnK = 0.35 + 0.65 * clamp(s.speed / Math.max(1, s.maxSpeed), 0, 1);
      const dh = angDiff(s.heading, s.wantHeading);
      const maxTurn = s.turnRate * turnK * dt;
      const step = clamp(dh, -maxTurn, maxTurn);
      s.heading += step;
      s.turn = step / Math.max(1e-4, dt);
      const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
      s.vx = fx * s.speed; s.vz = fz * s.speed;
      s.x += s.vx * dt; s.z += s.vz * dt;
      // land and rocks: push out, scrub speed
      for (const i of world.islands) {
        const r = (i.rock ? i.r + 0.5 : i.r * 1.25 + 1.5) + s.beam * 0.5;
        const dx = s.x - i.x, dz = s.z - i.z, d = Math.hypot(dx, dz);
        if (d < r && d > 0.01) {
          s.x = i.x + dx / d * r; s.z = i.z + dz / d * r;
          if (s.speed > 3 && s.player) { sfx.bump(); haptic("light"); emit(1, s.x, 0.2, s.z, 6, { spread: 2, up: 2, size: 1.2 }); if (i.rock) damage(s, 12 + s.speed * 2, null, "rock"); }
          s.speed *= 0.4;
        }
      }
      // ships shove each other
      for (const o of ships) {
        if (o === s || !o.alive) continue;
        const dx = s.x - o.x, dz = s.z - o.z, d = Math.hypot(dx, dz), r = (s.beam + o.beam) * 0.55 + 1.2;
        if (d < r && d > 0.01) {
          const push = (r - d) * 0.5;
          s.x += dx / d * push; s.z += dz / d * push; o.x -= dx / d * push; o.z -= dz / d * push;
          s.speed *= 0.9; o.speed *= 0.9;
          if (s.player && s.speed > 4) { sfx.bump(); }
        }
      }
      // the edge of the chart
      const dc = Math.hypot(s.x, s.z);
      if (dc > SEA_R) { s.x *= SEA_R / dc; s.z *= SEA_R / dc; s.speed *= 0.5; if (s.player) toast("🌫️ Uncharted waters — turn back"); }
      // visuals
      s.roll += ((-s.turn * 0.22) * Math.min(1, s.speed / 6) - s.roll) * Math.min(1, dt * 3);
      const bob = Math.sin(timeNow * 1.3 + s.x * 0.1) * 0.05;
      s.mesh.position.set(s.x, bob, s.z);
      s.mesh.rotation.set(Math.sin(timeNow * 0.9 + s.z * 0.1) * 0.02 - s.speed * 0.004, s.heading, s.roll, "YXZ");
      for (const sail of s.mesh.userData.sails) sail.scale.z = 0.4 + 0.6 * clamp(s.throttle, 0.1, 1);
      wakePush(s.wake, s.x - fx * s.len * 0.4, s.z - fz * s.len * 0.4, s.heading, s.beam * 0.5, s.speed > 1.5);
      wakeUpdate(s.wake, dt);
      if (s.speed > 3 && Math.random() < dt * s.speed * 1.2) emit(4, s.x + fx * s.len * 0.45, 0.15, s.z + fz * s.len * 0.45, 1, { spread: 0.6, up: 0.8, size: 0.7, life: 0.7, grow: 0.9 });
    }

    // ---- guns ---------------------------------------------------------------------
    const _m = new THREE.Vector3();
    function gunWorld(s, gn) { _m.copy(gn.ref.local).applyMatrix4(s.mesh.matrixWorld); return _m; }
    function inArc(s, gn, tx, tz) {
      // World-space facing of the slot, and the angle to the target from the gun.
      const facing = s.heading + gn.ref.yaw;
      const gw = gunWorld(s, gn);
      const a = Math.atan2(tx - gw.x, tz - gw.z);
      const arc = gn.type === "swivel" ? 1.35 : gn.type === "mortar" ? 2.4 : 1.05;
      return Math.abs(angDiff(facing, a)) < arc;
    }
    function fireGun(s, gn, target) {
      const gw = gunWorld(s, gn).clone();
      const def = gn.def;
      // Time of flight fixes the arc: mortars lob high and slow, guns shoot flat
      // and fast. Lead the target by that time, then refine once.
      const tof = (d) => def.lob ? clamp(d / 30, 1.6, 3.2) : Math.max(0.2, d / def.speed);
      let T = tof(Math.hypot(target.x - gw.x, target.z - gw.z));
      let tx = target.x + (target.vx || 0) * T, tz = target.z + (target.vz || 0) * T;
      T = tof(Math.hypot(tx - gw.x, tz - gw.z));
      tx = target.x + (target.vx || 0) * T; tz = target.z + (target.vz || 0) * T;
      const dx = tx - gw.x, dz = tz - gw.z, dist = Math.hypot(dx, dz);
      T = tof(dist);
      const speed = dist / T;
      const lob = 4.9 * T - (gw.y - 0.6) / T;
      const jitter = s.player ? 0.025 : 0.05 + Math.max(0, 0.08 - s.lvl * 0.002);
      const a = Math.atan2(dx, dz) + rnd(-jitter, jitter);
      const m = mesh(GEO.ball, mat(def.lob ? 0x333333 : 0x1a1a1e, { flatShading: false }), true);
      m.position.copy(gw);
      if (gn.type === "fire") { m.material = mat(0xff6a1a, { emissive: 0xff3a00, flatShading: false }); }
      scene.add(m);
      projectiles.push({ x: gw.x, y: gw.y, z: gw.z, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, vy: lob, mesh: m, owner: s, dmg: gn.dmg, def, life: 6, type: gn.type, tx, tz, T, t0: timeNow });
      if (s.player) dbgStats.fired++;
      // effects
      const fx = Math.sin(s.heading + gn.ref.yaw), fz = Math.cos(s.heading + gn.ref.yaw);
      emit(0, gw.x + fx * 0.8, gw.y, gw.z + fz * 0.8, 5, { spread: 0.6, up: 1.2, size: 1.4, life: 1.1, dir: { x: fx, z: fz }, push: 4 });
      emit(3, gw.x + fx * 0.8, gw.y, gw.z + fz * 0.8, 3, { spread: 1, up: 1, size: 0.6, life: 0.25, dir: { x: fx, z: fz }, push: 8, grow: 0 });
      const d = Math.hypot(gw.x - me.x, gw.z - me.z);
      sfx.boom(d);
      if (s.player) { haptic("light"); s.roll += (gn.ref.yaw > 0 ? 1 : -1) * 0.025; }
    }
    function updateGuns(s, dt) {
      const enemies = s.player ? ships.filter((o) => !o.player && o.alive) : [me];
      for (const gn of s.guns) {
        gn.cd -= dt * s.rateMul;
        if (gn.cd > 0) continue;
        const def = gn.def;
        let best = null, bestD = Infinity;
        const gw = gunWorld(s, gn);
        for (const o of enemies) {
          if (!o.alive) continue;
          const d = Math.hypot(o.x - gw.x, o.z - gw.z);
          if (d > def.range || d < (def.minRange || 0)) continue;
          if (!inArc(s, gn, o.x, o.z)) continue;
          if (d < bestD) { bestD = d; best = o; }
        }
        if (s.player) {
          for (const f of world.forts) {
            if (!f.alive) continue;
            const d = Math.hypot(f.x - gw.x, f.z - gw.z) - 10;
            if (d > def.range || d < (def.minRange || 0)) continue;
            if (!inArc(s, gn, f.x, f.z)) continue;
            if (d < bestD) { bestD = d; best = { x: f.x, z: f.z, vx: 0, vz: 0, fort: f }; }
          }
        }
        if (!best) { gn.cd = 0.15; continue; }
        fireGun(s, gn, best);
        gn.cd = 60 / def.rate * rnd(0.9, 1.1);
      }
    }
    const dbgStats = { fired: 0, ship: 0, water: 0, land: 0, last: null };
    function probeHit(p) {
      for (const s of ships) {
        if (s === p.owner || !s.alive) continue;
        if (p.owner.player === s.player) continue;   // no friendly fire among bots
        if (p.y > 4) continue;
        // hull as a capsule along heading
        const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
        const dx = p.x - s.x, dz = p.z - s.z;
        const along = clamp(dx * fx + dz * fz, -s.len * 0.5, s.len * 0.5);
        const cx = s.x + fx * along, cz = s.z + fz * along;
        if (Math.hypot(p.x - cx, p.z - cz) < s.beam * 0.6 + 0.5) return { ship: s };
      }
      if (p.owner.player && p.y < 10) {
        for (const f of world.forts) if (f.alive && Math.hypot(p.x - f.x, p.z - f.z) < 12) return { fort: f };
      }
      if (p.y <= 0) return { water: true };
      if (!p.def.splash) {
        for (const isl of world.islands) if (!isl.port && Math.hypot(p.x - isl.x, p.z - isl.z) < isl.r * 0.9 && p.y < isl.r * 0.5) return { land: true };
      }
      return null;
    }
    function updateProjectiles(dt) {
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.life -= dt;
        // sub-step so a fast ball cannot skip through a hull between frames
        const sp = Math.hypot(p.vx, p.vz);
        const steps = Math.max(1, Math.ceil(sp * dt / 1.5));
        const sdt = dt / steps;
        let hit = null;
        for (let k = 0; k < steps && !hit; k++) {
          p.vy -= 9.8 * sdt;
          p.x += p.vx * sdt; p.y += p.vy * sdt; p.z += p.vz * sdt;
          hit = probeHit(p);
        }
        p.mesh.position.set(p.x, p.y, p.z);
        if (hit || p.life <= 0) {
          scene.remove(p.mesh);
          projectiles.splice(i, 1);
          const dMe = Math.hypot(p.x - me.x, p.z - me.z);
          if (p.owner.player && hit) { if (hit.water) dbgStats.water++; else if (hit.ship || hit.fort) dbgStats.ship++; else dbgStats.land++;
            dbgStats.last = { kind: hit.water ? "water" : hit.ship ? "ship" : hit.fort ? "fort" : "land", x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10, tx: Math.round(p.tx * 10) / 10, tz: Math.round(p.tz * 10) / 10, T: Math.round(p.T * 100) / 100, flew: Math.round((timeNow - p.t0) * 100) / 100 }; }
          if (hit && hit.water) { emit(1, p.x, 0.1, p.z, 9, { spread: 1.4, up: 3.5, size: 1.1, life: 0.9 }); sfx.splash(dMe); if (p.def.splash) splashDamage(p); }
          else if (hit && (hit.ship || hit.fort)) {
            emit(3, p.x, p.y, p.z, 7, { spread: 2, up: 2.5, size: 0.7, life: 0.4, grow: 0 });
            emit(0, p.x, p.y, p.z, 4, { spread: 0.8, up: 1, size: 1.2, life: 0.9 });
            sfx.hit(dMe);
            if (p.def.splash) splashDamage(p);
            else if (hit.ship) damage(hit.ship, p.dmg, p.owner, p.type);
            else damageFort(hit.fort, p.dmg, p.type);
          } else if (hit && hit.land) { emit(0, p.x, p.y, p.z, 4, { spread: 0.8, up: 1, size: 1.0, life: 0.8 }); }
        }
      }
    }
    function splashDamage(p) {
      const r = p.def.splash;
      emit(1, p.x, 0.1, p.z, 14, { spread: 3, up: 5, size: 1.4, life: 1.1 });
      for (const s of ships) {
        if (!s.alive || s === p.owner || s.player === p.owner.player) continue;
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < r + s.beam * 0.5) damage(s, p.dmg * (1 - d / (r + s.beam)) , p.owner, p.type);
      }
      if (p.owner.player) for (const f of world.forts) if (f.alive && Math.hypot(p.x - f.x, p.z - f.z) < r + 10) damageFort(f, p.dmg * 0.8, p.type);
    }
    function damage(s, amount, from, type) {
      if (!s.alive) return;
      s.hp -= amount;
      s.lastHit = timeNow;
      if (from && !s.player) { s.target = from; if (s.state === "patrol") { s.state = "engage"; s.stateT = 0; } }
      if (type === "fire") { s.burn = Math.max(s.burn, (from && from.player && from.guns.length ? 36 : 24)); s.burnT = 6; }
      if (type === "chain") s.slow = 5;
      if (s.player) { flash(el.flashHurt); haptic("medium"); shake = Math.max(shake, Math.min(1, amount / 60)); }
      if (s.hp <= 0) sinkShip(s, from);
    }
    function damageFort(f, amount, type) {
      if (!f.alive) return;
      f.hp -= amount;
      if (type === "fire") { f.burn = 6; }
      if (f.hp <= 0) destroyFort(f);
    }
    function sinkShip(s, from) {
      s.alive = false; s.sinkT = 0; s.throttle = 0;
      emit(1, s.x, 0.2, s.z, 20, { spread: 4, up: 4, size: 1.6, life: 1.3 });
      emit(0, s.x, 1.5, s.z, 16, { spread: 2, up: 2.5, size: 2.2, life: 2 });
      emit(3, s.x, 1.5, s.z, 12, { spread: 3, up: 4, size: 0.8, life: 0.6, grow: 0 });
      if (s.player) { onPlayerSunk(); return; }
      sfx.sink(); haptic("success");
      // loot drop
      const n = 2 + Math.min(5, (s.lootCoins / 400) | 0);
      for (let i = 0; i < n; i++) dropLoot(s.x + rnd(-4, 4), s.z + rnd(-4, 4), "coins", Math.round(s.lootCoins / n));
      for (let i = 0; i < s.lootGems; i++) dropLoot(s.x + rnd(-5, 5), s.z + rnd(-5, 5), "gems", 1);
      const xp = s.lvl * 14;
      const lvBefore = captainLevel();
      S.xp += xp; S.life.sunk += 1; S.life.bounty += s.lvl * 10; S.life.best = Math.max(S.life.best, s.lvl);
      voyage.sunk += 1; voyage.bounty += s.lvl * 10;
      questProgress("sink", 1); questProgress("level", 0, s.lvl);
      toast("☠️ " + s.name + " sunk · +" + xp + " xp");
      if (captainLevel() > lvBefore) { ctx.timeout(() => { bigText("CAPTAIN LEVEL " + captainLevel(), "the sea takes notice", 2000); sfx.levelUp(); refreshWallet(); }, 900); }
      refreshWallet(); save();
      try { ctx.platform.interact({ type: "sink", level: s.lvl }); } catch (_) {}
    }
    function destroyFort(f) {
      f.alive = false; f.respawn = 240;
      emit(0, f.x, 6, f.z, 30, { spread: 6, up: 6, size: 3, life: 2.5 });
      emit(3, f.x, 6, f.z, 24, { spread: 8, up: 8, size: 1, life: 0.8, grow: 0 });
      emit(1, f.x, 0.2, f.z, 20, { spread: 12, up: 4, size: 1.6, life: 1.2 });
      f.mesh.visible = false;
      sfx.sink(); haptic("success"); shake = 1;
      const coins = 900 * f.lvl, gems = 4 + (f.lvl / 4 | 0);
      for (let i = 0; i < 7; i++) dropLoot(f.x + rnd(-16, 16), f.z + rnd(-16, 16), "coins", Math.round(coins / 7));
      for (let i = 0; i < gems; i++) dropLoot(f.x + rnd(-16, 16), f.z + rnd(-16, 16), "gems", 1);
      S.xp += f.lvl * 30; S.life.forts += 1; S.life.bounty += 500; voyage.bounty += 500; voyage.forts += 1;
      questProgress("fort", 1);
      bigText("FORT DESTROYED", "the sea is yours for a while", 2200); confetti();
      refreshWallet(); save();
      try { ctx.platform.milestone("fort_destroyed", { level: f.lvl }); } catch (_) {}
    }
    function dropLoot(x, z, kind, value) {
      if (nearestIslandGap(x, z, 2) < 2) { x = me.x + rnd(-3, 3); z = me.z + rnd(-3, 3); }
      const m = lootMesh(kind); m.scale.setScalar(1.6); m.position.set(x, 0, z); scene.add(m);
      loot.push({ x, z, kind, value, mesh: m, t: rnd(0, 6), life: 120 });
    }
    function updateLoot(dt) {
      const full = voyage.hold >= holdCap();
      for (let i = loot.length - 1; i >= 0; i--) {
        const l = loot[i];
        l.t += dt; l.life -= dt;
        const dx = me.x - l.x, dz = me.z - l.z, d = Math.hypot(dx, dz);
        if (d < 14 && me.alive && (l.kind === "gems" || !full)) { const k = Math.min(1, dt * (5 + (14 - d) * 0.6)); l.x += dx * k; l.z += dz * k; }
        l.mesh.position.set(l.x, Math.sin(l.t * 2.2) * 0.12, l.z);
        l.mesh.rotation.y += dt * 1.2;
        if (d < me.beam * 0.5 + 1.6 && me.alive) {
          if (l.kind === "gems") { voyage.gems += l.value; sfx.gem(); toast("💎 +" + l.value); }
          else {
            if (full) { if (Math.random() < dt * 2) toast("⚓ Hold full — return to port"); continue; }
            const take = Math.min(l.value, holdCap() - voyage.hold);
            voyage.hold += take; sfx.coin();
            if (take < l.value) toast("⚓ Hold full — return to port", 1800);
          }
          haptic("light");
          scene.remove(l.mesh); loot.splice(i, 1);
          refreshHold();
          continue;
        }
        if (l.life <= 0) { scene.remove(l.mesh); loot.splice(i, 1); }
      }
    }
    function refreshHold() {
      const cap = holdCap();
      el.wHold.textContent = "⚓ " + fmtK(voyage.hold) + " / " + fmtK(cap) + (voyage.gems ? " · 💎" + voyage.gems : "");
      el.wHold.classList.toggle("full", voyage.hold >= cap);
    }

    // ---- enemy AI --------------------------------------------------------------------
    function aiStep(s, dt) {
      if (s.ai === "hold") { s.throttle = 0; return; }
      s.stateT += dt;
      const dxm = me.x - s.x, dzm = me.z - s.z, dm = Math.hypot(dxm, dzm);
      const myPower = captainLevel() + playerPower() * 0.25;
      const brave = s.lvl >= myPower * 0.55 || s.ai === "hunt";
      const range = s.guns.length ? s.guns[0].def.range : 50;
      if (!me.alive) { s.state = "patrol"; }
      else if (s.state === "patrol") {
        if (dm < (s.ai === "hunt" ? 230 : 95) && brave) { s.state = "engage"; s.stateT = 0; }
      } else if (s.state === "engage") {
        if (s.hp < s.maxHp * (brave ? 0.22 : 0.45) && s.lvl < myPower * 0.8 && s.ai !== "hunt") { s.state = "flee"; s.stateT = 0; }
        else if (dm > 260) s.state = "patrol";
      } else if (s.state === "flee") {
        if (dm > 150) { s.state = "patrol"; s.wp = { x: s.x + rnd(-100, 100), z: s.z + rnd(-100, 100) }; }
      }
      if (s.state === "patrol") {
        const dx = s.wp.x - s.x, dz = s.wp.z - s.z, d = Math.hypot(dx, dz);
        if (d < 12 || s.stateT > 40) { s.wp = { x: clamp(s.x + rnd(-120, 120), -SEA_R + 60, SEA_R - 60), z: clamp(s.z + rnd(-120, 120), -SEA_R + 60, SEA_R - 60) }; s.stateT = 0; }
        s.wantHeading = Math.atan2(dx, dz); s.throttle = 0.55;
      } else if (s.state === "engage") {
        // Close to gun range, then hold a broadside: sail perpendicular to the player.
        const ideal = range * 0.62;
        const side = s.side || (s.side = Math.random() < 0.5 ? 1 : -1);
        if (dm > ideal + 12) {
          // Aim for a point off the player's beam, not the player: a stern
          // chase never lets anyone's guns bear.
          const rx = Math.cos(me.heading), rz = -Math.sin(me.heading);
          const fx = me.x + rx * side * ideal * 0.8 + me.vx * 1.5, fz = me.z + rz * side * ideal * 0.8 + me.vz * 1.5;
          s.wantHeading = Math.atan2(fx - s.x, fz - s.z); s.throttle = 1;
        } else {
          // Hold a broadside: sail parallel to the player, guns toward them.
          const a = Math.atan2(dxm, dzm);
          s.wantHeading = a + side * Math.PI / 2 + (dm < ideal - 10 ? side * 0.4 : dm > ideal + 4 ? -side * 0.3 : 0);
          s.throttle = 0.75;
        }
      } else if (s.state === "flee") {
        s.wantHeading = Math.atan2(-dxm, -dzm); s.throttle = 1;
      }
      // steer around land
      const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
      for (const i of world.islands) {
        const px = s.x + fx * 22, pz = s.z + fz * 22;
        if (Math.hypot(px - i.x, pz - i.z) < i.r * 1.25 + 9) {
          const cross = (i.x - s.x) * fz - (i.z - s.z) * fx;
          s.wantHeading = s.heading + (cross > 0 ? 1 : -1) * 1.1;
          s.throttle = Math.min(s.throttle, 0.6);
          break;
        }
      }
    }
    function updateForts(dt) {
      for (const f of world.forts) {
        if (!f.alive) { f.respawn -= dt; if (f.respawn <= 0 && Math.hypot(me.x - f.x, me.z - f.z) > 200) fortStats(f); continue; }
        if (f.burn > 0) { f.burn -= dt; f.hp -= 4 * dt; if (Math.random() < dt * 8) emit(2, f.x + rnd(-5, 5), 7, f.z + rnd(-5, 5), 1, { spread: 0.3, up: 2, size: 1.8, life: 0.7 }); if (f.hp <= 0) destroyFort(f); }
        const d = Math.hypot(me.x - f.x, me.z - f.z);
        if (!me.alive || d > 105) continue;
        f.cd -= dt;
        if (f.cd <= 0) {
          f.cd = 3.2 - Math.min(1.6, f.lvl * 0.03);
          // fire a mortar shell from a tower toward the player
          const a = Math.atan2(me.x - f.x, me.z - f.z);
          const gx = f.x + Math.sin(a) * 7, gz = f.z + Math.cos(a) * 7;
          const tx = me.x + me.vx * 1.4, tz = me.z + me.vz * 1.4;
          const dist = Math.hypot(tx - gx, tz - gz), flight = clamp(dist / 32, 1.4, 3), speed = dist / flight;
          const aa = Math.atan2(tx - gx, tz - gz) + rnd(-0.05, 0.05);
          const m = mesh(GEO.ball, mat(0x333333, { flatShading: false }), true); m.position.set(gx, 7, gz); scene.add(m);
          projectiles.push({ x: gx, y: 7, z: gz, vx: Math.sin(aa) * speed, vz: Math.cos(aa) * speed, vy: 4.9 * flight - 6.4 / flight, mesh: m, owner: { player: false, x: f.x, z: f.z, fortOwner: true }, dmg: 30 + f.lvl * 2.2, def: CANNONS.mortar, life: 8, type: "mortar" });
          emit(0, gx, 7.5, gz, 6, { spread: 0.8, up: 1.5, size: 1.6, life: 1.2 });
          sfx.boom(d);
        }
      }
    }

    // =====================================================================
    // 10. Voyage state, port, sailing, sinking, banking.
    // =====================================================================
    const voyage = { hold: 0, gems: 0, sunk: 0, bounty: 0, forts: 0, treasures: 0, far: 0, t: 0 };
    let timeNow = 0, shake = 0;
    function resetVoyage() { voyage.hold = 0; voyage.gems = 0; voyage.sunk = 0; voyage.bounty = 0; voyage.forts = 0; voyage.treasures = 0; voyage.far = 0; voyage.t = 0; }

    function fadeTo(fn, ms) {
      el.fade.classList.add("on");
      ctx.timeout(() => { fn(); ctx.timeout(() => el.fade.classList.remove("on"), 60); }, ms || 520);
    }
    function clearSea() {
      for (const s of ships.slice()) if (!s.player) removeShip(s);
      for (const p of projectiles) scene.remove(p.mesh);
      projectiles.length = 0;
      for (const l of loot) scene.remove(l.mesh);
      loot.length = 0;
      for (const k in labels) { labels[k].remove(); delete labels[k]; }
      el.edges.innerHTML = "";
    }

    // ---- port -----------------------------------------------------------------------
    let portOrbit = 0, portMount = 0;
    function showPort(fromSea) {
      state = "port";
      clearSea();
      el.menu.classList.add("pt-hidden");
      el.top.classList.remove("pt-hidden");
      el.seaCorner.classList.add("pt-hidden"); el.seaSide.classList.add("pt-hidden");
      el.port.classList.remove("pt-hidden");
      el.stick.classList.remove("on"); el.touchHint.classList.remove("show"); el.dive.classList.remove("show");
      el.wHold.classList.add("pt-hidden");
      buildPlayer(7, -36, 0);
      camInit = false;
      me.hp = me.maxHp; S.hp = me.maxHp; save();
      me.throttle = 0; me.speed = 0;
      portMount = 0;
      refreshPortUI();
      refreshWallet(); refreshQuest();
      setSea(0.05);
      bed("cozy", 0.18);
      bedIntensity(0.3);
    }
    function refreshPortUI() {
      const T = tier();
      el.shipName.textContent = T.name;
      el.shipSub.textContent = "HOME PORT · CAPTAIN LEVEL " + captainLevel();
      el.hpText.textContent = "HULL " + fmt(me.hp) + " / " + fmt(me.maxHp);
      el.hpBar.style.width = (me.hp / me.maxHp * 100) + "%";
      const power = playerPower();
      el.shipStats.innerHTML = `<span>⚡ power ${power}</span><span>⛵ ${shipSpeed().toFixed(1)} kn</span><span>📦 ${fmtK(holdCap())}</span><span>💣 ${S.slots.filter((x) => x != null).length}/${S.slots.length}</span>`;
      // slot chips: one per slot, positioned over the ship each frame
      el.slots.innerHTML = "";
      slotChips.length = 0;
      T.slots.forEach((slot, i) => {
        const id = S.slots[i]; const c = id == null ? null : cannonById(id);
        const chip = document.createElement("div");
        chip.className = "pt-slot" + (c ? " filled" : "") + (armSel === i ? " sel" : "");
        chip.innerHTML = c ? CANNONS[c.type].icon + "<b>" + (c.lv + 1) + "</b>" : "＋";
        ctx.listen(chip, "click", () => { sfx.ui(); armSel = i; openArmory(); });
        el.slots.appendChild(chip);
        slotChips.push({ el: chip, slot });
      });
    }
    const slotChips = [];
    let armSel = -1;
    const _sp = new THREE.Vector3();
    function project(x, y, z) {
      _sp.set(x, y, z).project(camera);
      return { x: (_sp.x + 1) / 2 * ctx.width, y: (1 - _sp.y) / 2 * ctx.height, behind: _sp.z > 1, ndc: _sp };
    }

    // ---- sail --------------------------------------------------------------------------
    function setSail() {
      fadeTo(() => {
        state = "sea";
        el.port.classList.add("pt-hidden");
        el.seaCorner.classList.remove("pt-hidden"); el.seaSide.classList.remove("pt-hidden");
        el.wHold.classList.remove("pt-hidden");
        resetVoyage();
        buildPlayer(0, -70, Math.PI);
        me.throttle = 0.6; me.speed = 4;
        camInit = false;
        refreshHold();
        for (let i = 0; i < 6; i++) ensureEnemies();
        if (!S.hint) { el.touchHint.classList.add("show"); ctx.timeout(() => el.touchHint.classList.remove("show"), 5000); }
        setSea(0.12);
        bed("drift", 0.24);
        try { ctx.platform.interact({ type: "sail", tier: tier().id }); } catch (_) {}
      });
    }
    function enemiesEngaged() {
      let n = 0;
      for (const s of ships) if (!s.player && s.alive && s.state === "engage" && Math.hypot(s.x - me.x, s.z - me.z) < 110) n++;
      return n;
    }
    function bank(keepFraction, cause) {
      const coins = Math.round(voyage.hold * keepFraction), gems = voyage.gems;
      S.coins += coins; S.gems += gems; S.life.plunder += coins;
      if (voyage.hold > 0 && keepFraction >= 1) questProgress("loot", coins);
      S.hp = me.alive ? me.hp : -1;
      save(); refreshWallet();
      // Leaderboards: lifetime plunder and lifetime bounty.
      try {
        ctx.platform.setScore(Math.floor(S.life.bounty));
        ctx.memory.record("plunder").submit(Math.floor(S.life.plunder), { label: fmtK(S.life.plunder) + " gold" }).catch(() => {});
        ctx.memory.record("bounty").submit(Math.floor(S.life.bounty), { label: fmtK(S.life.bounty) + " bounty" }).catch(() => {});
      } catch (_) {}
      try { ctx.platform.complete({ cause, banked: coins, gems, sunk: voyage.sunk }); } catch (_) {}
      return { coins, gems };
    }
    function returnToPort() {
      if (state !== "sea" || !me.alive) return;
      if (enemiesEngaged() > 0) { toast("⚔️ Can't anchor mid-fight — lose them first"); haptic("warning"); return; }
      sfx.bell(); haptic("success");
      const r = bank(1, "port");
      fadeTo(() => {
        showPort(true);
        if (r.coins > 0 || r.gems > 0) ctx.timeout(() => bigText("BANKED " + fmtK(r.coins) + " GOLD", r.gems ? "+" + r.gems + " gems" : "safe in the vault", 2000), 200);
      });
    }
    function onPlayerSunk() {
      state = "sinking";
      sfx.mySink(); haptic("error"); flash(el.flashHurt); shake = 1.2;
      el.stick.classList.remove("on");
      try { ctx.platform.fail({ cause: "sunk", hold: voyage.hold, sunk: voyage.sunk }); } catch (_) {}
      ctx.timeout(() => {
        state = "sunk";
        const lost = Math.round(voyage.hold * 0.5);
        const r = bank(0.5, "sunk");
        el.sunkPanel.innerHTML = `
          <div class="big">🌊</div>
          <h2>Sunk!</h2>
          <div class="sub">The sea keeps half of what you carried.</div>
          <div class="pt-stat"><span>Lost to the deep</span><b style="color:#b33">−${fmtK(lost)} 🪙</b></div>
          <div class="pt-stat"><span>Washed ashore</span><b>+${fmtK(r.coins)} 🪙 ${r.gems ? "· +" + r.gems + " 💎" : ""}</b></div>
          <div class="pt-stat"><span>Ships plundered</span><b>${voyage.sunk}</b></div>
          <div class="pt-stat"><span>Voyage time</span><b>${Math.floor(voyage.t / 60)}:${String(Math.floor(voyage.t % 60)).padStart(2, "0")}</b></div>
          <div style="height:6px;"></div>
          <button class="pt-btn" id="btnSunkPort">⚓ Back to port</button>
          <div style="font-size:11px;opacity:.65;margin-top:4px;">Tip: green badges are prey, red ones are not.</div>`;
        el.sunk.classList.remove("pt-hidden");
        ctx.listen(el.sunkPanel.querySelector("#btnSunkPort"), "click", () => { sfx.ui(); el.sunk.classList.add("pt-hidden"); fadeTo(() => showPort(true)); });
      }, 2400);
    }
    function abandon() {
      if (state !== "paused") return;
      el.pause.classList.add("pt-hidden");
      state = "sea";
      const r = bank(0.5, "abandon");
      fadeTo(() => { showPort(true); toast("Kept " + fmtK(r.coins) + " gold of the hold"); });
    }

    // ---- shop / upgrades / armory ----------------------------------------------------------
    let shopTab = "cannons";
    function openShop(tab) {
      shopTab = tab || shopTab;
      renderShop();
      el.shop.classList.remove("pt-hidden");
    }
    function closeShop() { el.shop.classList.add("pt-hidden"); armSel = -1; buildPlayer(7, -36, 0); me.hp = me.maxHp; refreshPortUI(); refreshWallet(); }
    function costLabel(coins, gems) { return "🪙 " + fmtK(coins) + (gems ? "<br>💎 " + gems : ""); }
    function canPay(coins, gems) { return S.coins >= coins && S.gems >= (gems || 0); }
    function pay(coins, gems) { S.coins -= coins; S.gems -= gems || 0; save(); refreshWallet(); }
    function renderShop() {
      const P = el.shopPanel;
      const tabs = `<div class="pt-tabs">
        <button id="tbC" class="${shopTab === "cannons" ? "on" : ""}">💣 Cannons</button>
        <button id="tbH" class="${shopTab === "hull" ? "on" : ""}">⛵ Hulls</button>
        <button id="tbU" class="${shopTab === "up" ? "on" : ""}">🔨 Upgrades</button>
        <button id="tbA" class="${shopTab === "arm" ? "on" : ""}">🎯 Armory</button></div>`;
      let body = "";
      if (shopTab === "cannons") {
        body = `<div class="sub">New guns go to the first empty slot. Manage them in the Armory.</div>`;
        for (const k of CANNON_ORDER) {
          const c = CANNONS[k];
          const locked = c.tier > S.tier + 1;
          body += `<div class="pt-row ${locked ? "locked" : ""}"><div class="ic">${c.icon}</div><div class="mid"><div class="nm">${c.name}<em>${c.dmg} dmg · ${c.range} m · ${c.rate}/min</em></div><div class="de">${c.desc}${locked ? "<br><b>Needs a " + TIERS[c.tier - 1].name + "</b>" : ""}</div></div>
            <button class="pt-buy" data-buy="${k}" ${locked || !canPay(c.cost, c.gems) ? "disabled" : ""}>${costLabel(c.cost, c.gems)}</button></div>`;
        }
      } else if (shopTab === "hull") {
        body = `<div class="sub">Bigger hulls carry more guns and more loot, and shrug off more iron.</div>`;
        TIERS.forEach((T, i) => {
          const owned = i <= S.tier, next = i === S.tier + 1;
          body += `<div class="pt-row ${i === S.tier ? "sel" : ""} ${!owned && !next ? "locked" : ""}"><div class="ic">${["⛵", "🚢", "🛳️", "🏴‍☠️"][i]}</div><div class="mid"><div class="nm">${T.name}<em>${T.slots.length} guns</em></div>
            <div class="de">${fmt(T.hp)} hull · ${T.speed} kn · hold ${fmtK(T.hold)}</div></div>
            ${owned ? `<button class="pt-buy blue" disabled>${i === S.tier ? "YOURS" : "OWNED"}</button>` : `<button class="pt-buy" data-hull="${i}" ${!next || !canPay(T.cost, T.gems) ? "disabled" : ""}>${costLabel(T.cost, T.gems)}</button>`}</div>`;
        });
      } else if (shopTab === "up") {
        body = `<div class="sub">Port repairs are free. Everything else costs gold.</div>`;
        for (const u of UPGRADES) {
          const lv = upLv(u.id), maxed = lv >= u.max, cost = maxed ? 0 : upCost(u, lv);
          body += `<div class="pt-row"><div class="ic">${u.icon}</div><div class="mid"><div class="nm">${u.name}<em>lv ${lv}/${u.max}</em></div><div class="de">${u.desc}</div>
            <div class="pt-pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? "on" : ""}"></i>`).join("")}</div></div>
            <button class="pt-buy ${maxed ? "max" : ""}" data-up="${u.id}" ${maxed || !canPay(cost, 0) ? "disabled" : ""}>${maxed ? "MAX" : costLabel(cost, 0)}</button></div>`;
        }
      } else {
        const T = tier();
        body = armSel >= 0
          ? `<div class="sub">Slot ${armSel + 1} (${{ P: "port", S: "starboard", B: "bow", T: "stern" }[T.slots[armSel].s]}) selected — tap a gun to mount it. <a id="armClear" style="color:#2a6fd6;font-weight:800;">Deselect</a></div>`
          : `<div class="sub">Tap a slot on your ship, or a gun here to upgrade it.</div>`;
        if (!S.cannons.length) body += `<div class="pt-row"><div class="mid"><div class="de">No guns. Visit the shop.</div></div></div>`;
        for (const c of S.cannons) {
          const def = CANNONS[c.type];
          const slotIdx = S.slots.indexOf(c.id);
          const cost = cannonUpCost(c), maxed = c.lv >= MAX_CANNON_LV;
          body += `<div class="pt-row ${slotIdx === armSel && armSel >= 0 ? "sel" : ""}"><div class="ic">${def.icon}</div><div class="mid"><div class="nm">${def.name}<em>lv ${c.lv + 1} · ${Math.round(cannonDmg(c))} dmg</em></div>
            <div class="de">${slotIdx >= 0 ? "Mounted in slot " + (slotIdx + 1) : "In the hold"}</div>
            <div class="pt-pips">${Array.from({ length: MAX_CANNON_LV }, (_, i) => `<i class="${i < c.lv ? "on" : ""}"></i>`).join("")}</div></div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              ${armSel >= 0 ? `<button class="pt-buy blue" data-mount="${c.id}">${slotIdx === armSel ? "UNMOUNT" : "MOUNT"}</button>` : (slotIdx >= 0 ? `<button class="pt-buy blue" data-unmount="${c.id}">UNMOUNT</button>` : `<button class="pt-buy blue" data-automount="${c.id}" ${S.slots.indexOf(null) < 0 ? "disabled" : ""}>MOUNT</button>`)}
              <button class="pt-buy ${maxed ? "max" : ""}" data-cup="${c.id}" ${maxed || !canPay(cost, 0) ? "disabled" : ""}>${maxed ? "MAX" : "⬆ " + fmtK(cost)}</button>
            </div></div>`;
        }
      }
      P.innerHTML = `<h2>${{ cannons: "Shop", hull: "Shipwright", up: "Upgrades", arm: "Armory" }[shopTab]}</h2>
        <div class="pt-stat" style="justify-content:center;gap:16px;"><span>🪙 <b>${fmt(S.coins)}</b></span><span>💎 <b>${fmt(S.gems)}</b></span></div>${tabs}${body}
        <button class="pt-btn ghost" id="shopClose" style="margin:10px 0 0;">Close</button>`;
      ctx.listen(P.querySelector("#tbC"), "click", () => { sfx.ui(); shopTab = "cannons"; renderShop(); });
      ctx.listen(P.querySelector("#tbH"), "click", () => { sfx.ui(); shopTab = "hull"; renderShop(); });
      ctx.listen(P.querySelector("#tbU"), "click", () => { sfx.ui(); shopTab = "up"; renderShop(); });
      ctx.listen(P.querySelector("#tbA"), "click", () => { sfx.ui(); shopTab = "arm"; renderShop(); });
      ctx.listen(P.querySelector("#shopClose"), "click", () => { sfx.ui(); closeShop(); });
      const ac = P.querySelector("#armClear"); if (ac) ctx.listen(ac, "click", () => { armSel = -1; renderShop(); });
      for (const b of P.querySelectorAll("[data-buy]")) ctx.listen(b, "click", () => {
        const k = b.dataset.buy, c = CANNONS[k];
        if (!canPay(c.cost, c.gems)) return;
        pay(c.cost, c.gems);
        const item = { id: S.nextId++, type: k, lv: 0 };
        S.cannons.push(item);
        const empty = S.slots.indexOf(null);
        if (empty >= 0) S.slots[empty] = item.id;
        save(); sfx.buy(); haptic("success"); renderShop();
        toast(empty >= 0 ? c.icon + " mounted in slot " + (empty + 1) : c.icon + " stored — mount it in the Armory");
        try { ctx.platform.interact({ type: "buy_cannon", cannon: k }); } catch (_) {}
      });
      for (const b of P.querySelectorAll("[data-hull]")) ctx.listen(b, "click", () => {
        const i = +b.dataset.hull, T = TIERS[i];
        if (i !== S.tier + 1 || !canPay(T.cost, T.gems)) return;
        pay(T.cost, T.gems);
        const old = S.slots.slice();
        S.tier = i;
        S.slots = Array.from({ length: T.slots.length }, (_, k) => old[k] == null ? null : old[k]);
        for (const id of old) if (id != null && S.slots.indexOf(id) < 0) { const e = S.slots.indexOf(null); if (e >= 0) S.slots[e] = id; }
        save(); sfx.quest(); haptic("success"); confetti(); renderShop();
        bigText(T.name.toUpperCase(), "a bigger ship, a bigger reputation", 2200);
        try { ctx.platform.milestone("hull_upgrade", { tier: T.id }); } catch (_) {}
      });
      for (const b of P.querySelectorAll("[data-up]")) ctx.listen(b, "click", () => {
        const u = UPGRADES.find((x) => x.id === b.dataset.up); const lv = upLv(u.id);
        if (lv >= u.max) return; const cost = upCost(u, lv);
        if (!canPay(cost, 0)) return;
        pay(cost, 0); S.up[u.id] = lv + 1; save(); sfx.buy(); haptic("success"); renderShop();
        try { ctx.platform.interact({ type: "upgrade", id: u.id, level: lv + 1 }); } catch (_) {}
      });
      for (const b of P.querySelectorAll("[data-cup]")) ctx.listen(b, "click", () => {
        const c = cannonById(+b.dataset.cup); if (!c || c.lv >= MAX_CANNON_LV) return;
        const cost = cannonUpCost(c); if (!canPay(cost, 0)) return;
        pay(cost, 0); c.lv += 1; save(); sfx.buy(); haptic("success"); renderShop();
      });
      for (const b of P.querySelectorAll("[data-mount]")) ctx.listen(b, "click", () => {
        const id = +b.dataset.mount;
        const cur = S.slots.indexOf(id);
        if (cur === armSel) { S.slots[armSel] = null; }
        else { if (cur >= 0) S.slots[cur] = S.slots[armSel]; S.slots[armSel] = id; }
        save(); sfx.ui(); haptic("light"); renderShop();
      });
      for (const b of P.querySelectorAll("[data-unmount]")) ctx.listen(b, "click", () => { const i = S.slots.indexOf(+b.dataset.unmount); if (i >= 0) S.slots[i] = null; save(); sfx.ui(); renderShop(); });
      for (const b of P.querySelectorAll("[data-automount]")) ctx.listen(b, "click", () => { const e = S.slots.indexOf(null); if (e >= 0) S.slots[e] = +b.dataset.automount; save(); sfx.ui(); renderShop(); });
    }
    function openArmory() { shopTab = "arm"; openShop(); }

    // ---- wiring -------------------------------------------------------------------------------
    ctx.listen($("btnMenuPlay"), "click", () => { firstGesture(); sfx.ui(); haptic("light"); fadeTo(() => showPort(false)); });
    ctx.listen($("btnMenuHow"), "click", () => { firstGesture(); sfx.ui(); el.how.classList.remove("pt-hidden"); });
    ctx.listen($("btnHow2"), "click", () => { sfx.ui(); el.how.classList.remove("pt-hidden"); });
    ctx.listen($("btnHowOk"), "click", () => { sfx.ui(); el.how.classList.add("pt-hidden"); });
    ctx.listen($("btnShop"), "click", () => { sfx.ui(); armSel = -1; openShop("cannons"); });
    ctx.listen($("btnUp"), "click", () => { sfx.ui(); armSel = -1; openShop("up"); });
    ctx.listen($("btnArm"), "click", () => { sfx.ui(); armSel = -1; openShop("arm"); });
    ctx.listen($("btnGo"), "click", () => { sfx.ui(); haptic("medium"); setSail(); });
    ctx.listen(el.btnPort, "click", () => { returnToPort(); });
    ctx.listen($("btnPause"), "click", () => { if (state === "sea") { state = "paused"; sfx.ui(); el.pause.classList.remove("pt-hidden"); stickEnd(); } });
    ctx.listen($("btnResume"), "click", () => { sfx.ui(); el.pause.classList.add("pt-hidden"); if (state === "paused") state = "sea"; });
    ctx.listen($("btnQuit"), "click", () => { sfx.ui(); abandon(); });
    const toggleMute = () => { firstGesture(); muted = !muted; S.muted = muted; save(); applyMute(); sfx.ui(); };
    ctx.listen(el.btnMute, "click", toggleMute);
    ctx.listen(el.btnMute2, "click", toggleMute);

    // ---- joystick ---------------------------------------------------------------------------
    let stick = null;
    function stickEnd() { stick = null; el.stick.classList.remove("on"); if (me) me.throttle = Math.max(0.25, me.throttle * 0.6); }
    ctx.listen(canvas, "pointerdown", (e) => {
      if (state !== "sea" || !me || !me.alive) return;
      firstGesture();
      if (!S.hint) { S.hint = 1; save(); el.touchHint.classList.remove("show"); }
      stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY, dx: 0, dy: 0 };
      el.stick.style.left = e.offsetX + "px"; el.stick.style.top = e.offsetY + "px";
      el.knob.style.transform = "translate(0px,0px)";
      el.stick.classList.add("on");
    });
    ctx.listen(canvas, "pointermove", (e) => {
      if (!stick || e.pointerId !== stick.id) return;
      let dx = e.clientX - stick.cx, dy = e.clientY - stick.cy;
      const d = Math.hypot(dx, dy), R = 62;
      if (d > R) { dx *= R / d; dy *= R / d; }
      stick.dx = dx; stick.dy = dy;
      el.knob.style.transform = "translate(" + dx + "px," + dy + "px)";
      if (d > 4) { el.stickArrow.style.transform = "rotate(" + (Math.atan2(dx, -dy) * 180 / Math.PI) + "deg) translateY(-58px)"; el.stickArrow.style.opacity = "1"; }
    });
    ctx.listen(canvas, "pointerup", (e) => { if (stick && e.pointerId === stick.id) stickEnd(); });
    ctx.listen(canvas, "pointercancel", (e) => { if (stick && e.pointerId === stick.id) stickEnd(); });
    function applyStick(dt) {
      if (!stick) return;
      const d = Math.hypot(stick.dx, stick.dy);
      if (d < 8) { me.throttle = Math.max(0.25, me.throttle - dt * 0.6); return; }
      // screen up is -z (the camera sits to the north looking south), screen right is +x
      me.wantHeading = Math.atan2(stick.dx, stick.dy);
      me.throttle = clamp(d / 62, 0.25, 1);
    }

    // ---- labels over ships and forts --------------------------------------------------------
    const labels = {};
    function labelFor(key, cls) {
      let l = labels[key];
      if (!l) {
        l = document.createElement("div"); l.className = "pt-lbl " + (cls || "");
        l.innerHTML = cls === "me" ? '<div class="hp"><i></i></div>' : '<div class="row"><div class="hex"></div><div class="loot"></div><span class="fire pt-hidden">🔥</span></div><div class="hp"><i></i></div><div class="name"></div>';
        el.lbls.appendChild(l); labels[key] = l;
        l._hex = l.querySelector(".hex"); l._loot = l.querySelector(".loot"); l._hp = l.querySelector(".hp i"); l._fire = l.querySelector(".fire"); l._name = l.querySelector(".name");
      }
      return l;
    }
    function updateLabels() {
      const seen = new Set();
      const myL = captainLevel(), myP = playerPower();
      for (const s of ships) {
        if (!s.alive && s.sinkT > 1.2) continue;
        const p = project(s.x, 4.5 + s.beam * 0.9, s.z);
        if (p.behind || p.x < -60 || p.x > ctx.width + 60 || p.y < -40 || p.y > ctx.height + 40) continue;
        const l = labelFor(s.id, s.player ? "me" : "");
        seen.add(s.id);
        l.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px) translate(-50%,-100%)";
        const hpF = clamp(s.hp / s.maxHp, 0, 1);
        l._hp.style.transform = "scaleX(" + hpF + ")";
        l._hp.className = hpF < 0.3 ? "low" : "";
        if (!s.player) {
          const rel = s.lvl / Math.max(1, myL * 0.6 + myP * 0.4);
          l._hex.textContent = String(s.lvl);
          l._hex.className = "hex " + (rel < 0.7 ? "easy" : rel > 1.35 ? "hard" : "");
          l._loot.innerHTML = "🪙" + fmtK(s.lootCoins) + (s.lootGems ? " 💎" + s.lootGems : "");
          l._fire.classList.toggle("pt-hidden", s.burn <= 0);
          l._name.textContent = s.ai === "hunt" ? "☠ " + s.name : s.name;
        }
      }
      for (const f of world.forts) {
        if (!f.alive) continue;
        const p = project(f.x, 16, f.z);
        if (p.behind || p.x < -60 || p.x > ctx.width + 60 || p.y < -40 || p.y > ctx.height + 40) continue;
        const l = labelFor(f.id, "");
        seen.add(f.id);
        l.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px) translate(-50%,-100%)";
        l._hp.style.transform = "scaleX(" + clamp(f.hp / f.maxHp, 0, 1) + ")";
        l._hex.textContent = String(f.lvl); l._hex.className = "hex fort";
        l._loot.innerHTML = "🪙" + fmtK(900 * f.lvl) + " 💎" + (4 + (f.lvl / 4 | 0));
        l._name.textContent = "FORT"; l._fire.classList.toggle("pt-hidden", !(f.burn > 0));
      }
      for (const k in labels) if (!seen.has(k)) { labels[k].remove(); delete labels[k]; }
    }
    // ---- edge markers for things off screen ------------------------------------------------------
    const edgePool = [];
    function updateEdges() {
      const items = [];
      items.push({ x: 0, z: -40, ic: "⚓", cls: "port", d: Math.hypot(me.x, me.z + 40) });
      const tq = world.treasures.map((t) => ({ x: t.x, z: t.z, ic: "?", cls: "q", d: Math.hypot(me.x - t.x, me.z - t.z) })).sort((a, b) => a.d - b.d).slice(0, 2);
      for (const t of tq) items.push(t);
      for (const f of world.forts) if (f.alive) items.push({ x: f.x, z: f.z, ic: "🏰", cls: "fort", d: Math.hypot(me.x - f.x, me.z - f.z) });
      for (const s of ships) if (!s.player && s.alive && s.ai === "hunt") items.push({ x: s.x, z: s.z, ic: "☠", cls: "hunt", d: Math.hypot(me.x - s.x, me.z - s.z) });
      items.sort((a, b) => a.d - b.d);
      let n = 0;
      const placed = [];
      const W = ctx.width, H = ctx.height, inset = 34, top = sa.top + 100, bottom = sa.bottom + 40;
      for (const it of items) {
        if (n >= 9) break;
        if (it.d > 700 && it.cls === "q") continue;
        const p = project(it.x, 0, it.z);
        const inside = !p.behind && p.x > 10 && p.x < W - 10 && p.y > top && p.y < H - bottom;
        if (inside && it.cls !== "port") continue;
        if (inside) continue;
        // direction from screen centre in map space (screen up = -z, right = +x)
        const dx = it.x - me.x, dz = it.z - me.z;
        let sx = dx, sy = dz;
        const len = Math.hypot(sx, sy) || 1; sx /= len; sy /= len;
        const cx = W / 2, cy = H / 2;
        const tx = sx > 0 ? (W - inset - cx) / sx : sx < 0 ? (inset - cx) / sx : Infinity;
        const ty = sy > 0 ? (H - bottom - inset - cy) / sy : sy < 0 ? (top + inset - cy) / sy : Infinity;
        const t = Math.min(tx, ty);
        let ex = cx + sx * t, ey = cy + sy * t;
        // nudge along the edge if another marker already sits here
        for (let k = 0; k < 4; k++) {
          const clash = placed.find((q) => Math.abs(q.x - ex) < 58 && Math.abs(q.y - ey) < 60);
          if (!clash) break;
          if (tx < ty) ey += ey > cy ? -64 : 64; else ex += ex > cx ? -62 : 62;
        }
        if (ex > W - 96 && ey > H - sa.bottom - 200) ey = H - sa.bottom - 210;
        placed.push({ x: ex, y: ey });
        let e = edgePool[n];
        if (!e) { e = document.createElement("div"); e.className = "pt-edge"; e.innerHTML = '<div class="ic"></div><div class="d"></div>'; el.edges.appendChild(e); edgePool[n] = e; e._ic = e.querySelector(".ic"); e._d = e.querySelector(".d"); }
        e.style.transform = "translate(" + Math.round(ex) + "px," + Math.round(ey) + "px) translate(-50%,-50%)";
        e._ic.textContent = it.ic; e._ic.className = "ic " + it.cls;
        e._d.textContent = Math.round(it.d) + " m";
        e.style.display = "";
        n++;
      }
      for (let i = n; i < edgePool.length; i++) edgePool[i].style.display = "none";
    }

    // =====================================================================
    // 11. Treasure diving, repair, camera, frame loop.
    // =====================================================================
    function updateTreasure(dt) {
      let diving = null;
      for (const t of world.treasures) {
        const d = Math.hypot(me.x - t.x, me.z - t.z);
        t.mesh.userData.ring.scale.setScalar(5 + Math.sin(timeNow * 2) * 0.5);
        t.mesh.position.y = Math.sin(timeNow * 1.5 + t.x) * 0.15;
        if (d < 7 && me.alive && me.speed < 2.5) { t.dive += dt / 2.6; diving = t; }
        else t.dive = Math.max(0, t.dive - dt * 0.8);
        if (t.dive >= 1) {
          const lvl = levelAt(t.x, t.z);
          const coins = Math.round(300 + lvl * 140 + rnd(0, 200)), gems = 1 + (lvl / 8 | 0) + (Math.random() < 0.3 ? 1 : 0);
          const take = Math.min(coins, holdCap() - voyage.hold);
          voyage.hold += Math.max(0, take); voyage.gems += gems; voyage.treasures += 1; S.life.treasures += 1;
          S.xp += 40 + lvl * 4; S.life.bounty += 50; voyage.bounty += 50;
          refreshHold(); refreshWallet();
          questProgress("treasure", 1);
          sfx.treasure(); haptic("success"); flash(el.flashGood); confetti();
          bigText("SUNKEN TREASURE", "+" + fmtK(take) + " gold · +" + gems + " gems", 2200);
          emit(1, t.x, 0.1, t.z, 24, { spread: 3, up: 5, size: 1.4, life: 1.1 });
          emit(3, t.x, 0.5, t.z, 16, { spread: 3, up: 5, size: 0.8, life: 0.7, grow: 0 });
          world.group.remove(t.mesh);
          world.treasures.splice(world.treasures.indexOf(t), 1);
          spawnTreasure();
          try { ctx.platform.interact({ type: "treasure" }); } catch (_) {}
          diving = null;
          break;
        }
      }
      if (diving) { el.dive.classList.add("show"); el.diveArc.style.strokeDashoffset = String(138.2 * (1 - diving.dive)); }
      else el.dive.classList.remove("show");
    }

    const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camWant = new THREE.Vector3(), lookWant = new THREE.Vector3();
    let camInit = false, spawnT = 0, hudT = 0, scoreT = 0;
    function update(dtMs) {
      const dt = Math.min(dtMs, 50) / 1000;
      timeNow += dt;
      if (lastW !== ctx.width || lastH !== ctx.height) { lastW = ctx.width; lastH = ctx.height; resize(); }
      waterUniforms.time.value = timeNow;

      if (state === "sea" || state === "sinking") {
        if (state === "sea") {
          voyage.t += dt;
          applyStick(dt);
          if (!stick && me.alive) me.throttle = Math.max(0.25, me.throttle - dt * 0.15);
        }
        // everyone sails
        for (const s of ships) {
          if (s.alive) {
            if (!s.player) aiStep(s, dt);
            stepShip(s, dt);
            updateGuns(s, dt);
            // burning
            if (s.burnT > 0) {
              s.burnT -= dt; s.hp -= (s.burn / 6) * dt;
              if (Math.random() < dt * 10) emit(2, s.x + rnd(-1, 1), 1.5, s.z + rnd(-1, 1), 1, { spread: 0.3, up: 2.2, size: 1.3, life: 0.6 });
              if (Math.random() < dt * 4) emit(0, s.x, 2.5, s.z, 1, { spread: 0.3, up: 1.5, size: 1.6, life: 1.4 });
              if (s.hp <= 0) sinkShip(s, s.target);
              if (s.player && Math.random() < dt * 1.5) sfx.burn();
            }
            if (s.slow > 0) s.slow -= dt;
            // carpenters
            if (s.player && timeNow - s.lastHit > 4 && upLv("carp") > 0 && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.012 * upLv("carp") * dt);
          } else {
            s.sinkT += dt;
            s.mesh.position.y -= dt * (0.7 + s.sinkT * 0.4);
            s.mesh.rotation.x += dt * 0.25; s.mesh.rotation.z += dt * 0.12;
            if (s.sinkT < 2 && Math.random() < dt * 6) emit(1, s.x + rnd(-2, 2), 0.1, s.z + rnd(-2, 2), 2, { spread: 1, up: 1.5, size: 1.1, life: 0.9 });
            wakeUpdate(s.wake, dt);
            if (!s.player && s.sinkT > 4.5) removeShip(s);
          }
        }
        updateProjectiles(dt);
        updateLoot(dt);
        updateForts(dt);
        if (state === "sea") {
          updateTreasure(dt);
          spawnT += dt;
          if (spawnT > 2.2) { spawnT = 0; ensureEnemies(); cullEnemies(); }
          const far = Math.hypot(me.x, me.z);
          if (far > voyage.far) { voyage.far = far; questProgress("far", 0, far); }
          hudT += dt;
          if (hudT > 0.1) {
            hudT = 0;
            updateLabels(); updateEdges();
            const eng = enemiesEngaged();
            el.btnPort.classList.toggle("busy", eng > 0);
            bedIntensity(clamp(0.35 + eng * 0.2, 0.3, 1));
          }
          scoreT += dt;
          if (scoreT > 1) { scoreT = 0; try { ctx.platform.setScore(Math.floor(S.life.bounty + voyage.bounty)); } catch (_) {} }
        }
        // camera: north of the ship, looking south and down; pulls back with speed
        const back = 54 + me.speed * 0.8, up = 116 + me.speed * 1.2;
        camWant.set(me.x, up, me.z + back);
        lookWant.set(me.x, 0, me.z - 8);
        if (!camInit) { camPos.copy(camWant); camLook.copy(lookWant); camInit = true; }
        camPos.lerp(camWant, Math.min(1, dt * 3.2)); camLook.lerp(lookWant, Math.min(1, dt * 4));
        camera.position.copy(camPos);
        if (shake > 0) { shake = Math.max(0, shake - dt * 2); camera.position.x += (Math.random() - 0.5) * shake * 1.2; camera.position.z += (Math.random() - 0.5) * shake * 1.2; }
        camera.lookAt(camLook);
        camera.fov += (58 - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
        sun.target.position.set(me.x, 0, me.z); sun.position.set(me.x - 40, 90, me.z - 30);
        catcher.position.set(me.x, 0.02, me.z);
        setSea(0.1 + me.speed * 0.006);
      } else if (state === "port") {
        // showcase: slow orbit around the docked ship
        portOrbit += dt * 0.18;
        portMount = Math.min(1, portMount + dt * 1.2);
        me.mesh.position.set(me.x, Math.sin(timeNow * 1.3) * 0.05, me.z);
        me.mesh.rotation.set(Math.sin(timeNow * 0.9) * 0.015, me.heading, Math.sin(timeNow * 0.7) * 0.02, "YXZ");
        for (const sail of me.mesh.userData.sails) sail.scale.z = 0.35;
        const r = 20 + tier().len * 0.9, a = Math.PI + Math.sin(portOrbit) * 0.9;
        camWant.set(me.x + Math.sin(a) * r, 13 + tier().len * 0.4, me.z + Math.cos(a) * r);
        lookWant.set(me.x, 2.5, me.z);
        if (!camInit) { camPos.copy(camWant); camLook.copy(lookWant); camInit = true; }
        camPos.lerp(camWant, Math.min(1, dt * 2.5)); camLook.lerp(lookWant, Math.min(1, dt * 3));
        camera.position.copy(camPos); camera.lookAt(camLook);
        camera.fov += (44 - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
        sun.target.position.set(me.x, 0, me.z); sun.position.set(me.x - 40, 90, me.z - 30);
        catcher.position.set(me.x, 0.02, me.z);
        // slot chips ride on the deck
        for (const c of slotChips) {
          const p = slotLocal(c.slot, tier().len, tier().beam, me.mesh.userData.deckY);
          _v.set(p.x, p.y + 1.6, p.z).applyMatrix4(me.mesh.matrixWorld);
          const sp = project(_v.x, _v.y, _v.z);
          c.el.style.transform = "translate(" + Math.round(sp.x) + "px," + Math.round(sp.y) + "px) translate(-50%,-50%) scale(" + portMount + ")";
        }
        if (!el.shop.classList.contains("pt-hidden") && shopTab === "arm") { /* armory open: chips still follow */ }
      } else if (state === "menu") {
        // a slow flyover of the port
        const a = timeNow * 0.08;
        camWant.set(Math.sin(a) * 70, 40, -30 + Math.cos(a) * 70);
        lookWant.set(0, 3, -20);
        if (!camInit) { camPos.copy(camWant); camLook.copy(lookWant); camInit = true; }
        camPos.lerp(camWant, Math.min(1, dt * 2)); camLook.lerp(lookWant, Math.min(1, dt * 2));
        camera.position.copy(camPos); camera.lookAt(camLook);
        sun.target.position.set(0, 0, -20); sun.position.set(-40, 90, -50);
        catcher.position.set(0, 0.02, -20);
      } else if (state === "paused" || state === "sunk") {
        // hold still, keep the water alive
      }
      // keep the water plane centred on the camera so its edge never shows
      water.position.set(camera.position.x, 0, camera.position.z);
      updateParticles(dt);
      renderer.render(scene, camera);
    }
    ctx.onFrame(update);

    // Test hooks (harness only; harmless in production).
    if (typeof window !== "undefined") {
      window.__ptDebug = () => ({ state, x: Math.round(me ? me.x : 0), z: Math.round(me ? me.z : 0), hp: me ? Math.round(me.hp) : 0, speed: me ? Math.round(me.speed * 10) / 10 : 0,
        enemies: ships.filter((s) => !s.player && s.alive).map((s) => ({ lvl: s.lvl, st: s.state, hp: Math.round(s.hp), d: Math.round(Math.hypot(s.x - me.x, s.z - me.z)) })),
        guns: me ? me.guns.map((g) => { const gw = gunWorld(me, g).clone(); const near = ships.filter((o) => !o.player && o.alive).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
          return { t: g.type, cd: Math.round(g.cd * 10) / 10, range: g.def.range, gw: [Math.round(gw.x), Math.round(gw.y), Math.round(gw.z)], near: near ? [Math.round(near.x), Math.round(near.z), Math.round(Math.hypot(near.x - gw.x, near.z - gw.z)), inArc(me, g, near.x, near.z), Math.round((me.heading + g.ref.yaw) * 100) / 100, Math.round(Math.atan2(near.x - gw.x, near.z - gw.z) * 100) / 100] : null }; }) : [],
        hold: voyage.hold, gems: voyage.gems, coins: S.coins, sgems: S.gems, xp: S.xp, quest: S.quest, qp: S.qp, loot: loot.length, proj: projectiles.length, labels: Object.keys(labels).length });
      window.__ptPort = () => { firstGesture(); showPort(false); };
      window.__ptSail = () => setSail();
      window.__ptSteer = (dx, dy) => { stick = { id: -1, cx: 0, cy: 0, dx, dy }; el.stick.classList.add("on"); };
      window.__ptSpawn = (lvl, d, engage) => { const a = rnd(0, TAU); const e = spawnEnemy(me.x + Math.cos(a) * (d || 40), me.z + Math.sin(a) * (d || 40), lvl || 3, "patrol"); if (engage) { e.state = "engage"; e.target = me; } return e.id; };
      window.__ptKill = () => { if (me) damage(me, 1e9, null, "test"); };
      window.__ptGive = (c, g) => { S.coins += c || 0; S.gems += g || 0; save(); refreshWallet(); };
      window.__ptWarp = (x, z) => { me.x = x; me.z = z; camInit = false; };
      window.__ptTreasure = () => { const t = world.treasures[0]; me.x = t.x + 2; me.z = t.z; me.speed = 0; me.throttle = 0; camInit = false; };
      window.__ptStats = () => dbgStats;
      window.__ptHurt = (amount) => { const e = ships.filter((o) => !o.player && o.alive).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0]; if (e) damage(e, amount || 1e6, me, "iron"); };
      window.__ptSpawnAt = (lvl, dx, dz) => { const e = spawnEnemy(me.x + dx, me.z + dz, lvl || 2, "hold"); e.heading = me.heading; return e.id; };
      window.__ptCollect = () => { for (const l of loot) { l.x = me.x; l.z = me.z; } };
      window.__ptFort = () => { const f = world.forts[0]; me.x = f.x + 40; me.z = f.z; camInit = false; };
    }

    // Menu backdrop: the port from the air.
    buildPlayer(7, -36, 0);
    applyMute();
    bed("cozy", 0.18);

    ctx.onDestroy(() => {
      try { if (canMusic && ctx.music && musicOn) ctx.music.stop({ fadeOutMs: 200 }); } catch (_) {}
      for (const s of ships.slice()) removeShip(s);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); } }
      });
      try { renderer.dispose(); } catch (_) {}
      if (AC) { try { AC.close(); } catch (_) {} }
    });
  }
};
