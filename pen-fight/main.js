/**
 * Pen Fight — the last-bench game, with real rigid-body physics.
 *
 * Two school pens on a wooden desk. You flick yours; the rival flicks back.
 * Knock theirs off the desk before they knock yours. A match is best of five,
 * first to three rounds, and the winner keeps the loser's pen.
 *
 * Eleven kids sit between you and the Trimax. Beat the bench, keep every pen
 * you win in the tin, and you are the pen fight champion of the class.
 *
 * Physics, in brief:
 *  - A pen is a capsule sliding on a plane: position, heading, and both
 *    velocities. Every pen has its own mass (from its real dimensions),
 *    desk friction and bounce, so a Parker drives like dead weight and an
 *    Octane skitters.
 *  - A flick is an impulse at the point you touched, so touching the tip spins
 *    it and touching the middle drives it straight. That falls out of the
 *    maths; nothing special-cases it.
 *  - Friction is integrated along the pen. Round pens roll when struck
 *    broadside and travel further; triangular and hexagonal ones do not.
 *  - Pen-on-pen contact is capsule/capsule with normal and Coulomb friction
 *    impulses, both with their angular terms, so glancing hits spin.
 *  - A rigid pen stays flat over the lip until its centre of mass crosses, then
 *    it tips and falls in full 3D.
 *
 * Renderer: three@0.164.1 via ctx.importModule. Every texture, every pen
 * livery and every sound is generated in this file; nothing is packaged.
 */
window.plethoraBit = {
  meta: {
    title: "Pen Fight",
    runtime: "plethora-bit@2",
    tags: ["3d", "physics", "game", "duel", "flick", "school"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Helpers                                                            //
    // ===================================================================== //
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function surface(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (CAN_BAKE) { try { return new OffscreenCanvas(w, h); } catch (_) { /* fall through */ } }
      const c = ctx.createCanvas2D();
      c.style.display = "none";
      c.width = w; c.height = h;
      return c;
    }

    // ===================================================================== //
    // 1. Paper, ink and chalk: the UI shell                                 //
    // ===================================================================== //
    const canvas = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "5";
    ui.style.pointerEvents = "none";
    const SAFE_B = Math.max(ctx.safeArea && ctx.safeArea.bottom || 0, 0);
    const SAFE_T = Math.max(ctx.safeArea && ctx.safeArea.top || 0, 0);

    const HAND = "'Patrick Hand','Chalkboard SE','Marker Felt','Bradley Hand','Segoe Print','Comic Sans MS',cursive";
    const STAMP = "'Bebas Neue','Anton','Impact','Futura-CondensedExtraBold','AvenirNextCondensed-Heavy','Arial Narrow',sans-serif";
    const INK = "#24428f", RED = "#c8402f", PAPER = "#efe8d6", PAPER_HI = "#f6f1e3", TIN = "#c4691a", CHALK = "#f3ede0";
    try { await ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0"); } catch (_) { /* system condensed fallback */ }
    // a torn-edge polygon for the paper sheets
    const TORN = (function () { const pts = []; const n = 22; for (let i = 0; i <= n; i++) pts.push((i / n * 100).toFixed(1) + "% " + (i % 2 ? "0%" : "1.1%")); for (let i = n; i >= 0; i--) pts.push((i / n * 100).toFixed(1) + "% " + (i % 2 ? "100%" : "98.9%")); return "polygon(" + pts.join(",") + ")"; })();

    ui.innerHTML = `
<style>
  .pf * { box-sizing: border-box; }
  .pf { position:absolute; inset:0; overflow:hidden; pointer-events:none; font-family:${HAND}; color:${INK};
        -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
  .pf .board { display:none; }
  .pf .slip { position:absolute; left:50%; transform:translate(-50%,0) rotate(-1.2deg); top:40%; width:min(84vw,340px);
        background:${PAPER}; color:${INK}; padding:12px 16px 14px 24px; font-size:19px; line-height:1.35; text-align:center;
        border-left:2px solid rgba(200,64,47,.55);
        background-image:repeating-linear-gradient(180deg, transparent 0 25px, rgba(96,126,190,.22) 25px 26px);
        box-shadow:0 10px 26px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.6) inset; opacity:0; transition:opacity .25s, transform .25s; pointer-events:none; }
  .pf .slip.show { opacity:1; transform:translate(-50%,-8px) rotate(-1.2deg); }
  .pf .slip b { color:${RED}; font-weight:400; }
  .pf .hint { position:absolute; left:16px; right:16px; bottom:${SAFE_B + 14}px; text-align:center; font-size:17px; color:rgba(243,237,224,.9);
        text-shadow:0 1px 3px rgba(0,0,0,.7); pointer-events:none; opacity:0; transition:opacity .3s; }
  .pf .page { position:absolute; inset:0; overflow-y:auto; overflow-x:hidden; pointer-events:auto; padding:${SAFE_T + 10}px 8px ${SAFE_B + 18}px;
        background:rgba(18,22,16,.42); display:none; }
  .pf .page.show { display:block; }
  .pf .inner { position:relative; max-width:440px; margin:0 auto; }
  .pf .sheet { position:relative; background:${PAPER}; color:${INK}; padding:26px 18px 30px 38px; margin:0 0 10px;
        background-image:repeating-linear-gradient(180deg, transparent 0 27px, rgba(96,126,190,.2) 27px 28px);
        clip-path:${TORN}; box-shadow:0 12px 30px rgba(0,0,0,.4); }
  .pf .sheet::before { content:""; position:absolute; top:0; bottom:0; left:26px; width:2px; background:rgba(200,64,47,.5); pointer-events:none; }
  .pf .sheet.plain { padding-left:18px; } .pf .sheet.plain::before { display:none; }
  .pf h1 { font-family:${STAMP}; font-weight:400; font-size:clamp(40px,12vw,56px); line-height:1; letter-spacing:.03em; color:${INK};
        text-transform:uppercase; margin:8px 0 10px; text-align:center; }
  .pf h1.hand { font-family:${HAND}; letter-spacing:.06em; }
  .pf h2 { font-family:${HAND}; font-weight:400; font-size:26px; letter-spacing:.14em; text-transform:uppercase; color:${INK}; margin:14px 0 6px; text-align:center; }
  .pf p { margin:5px 0; font-size:19px; line-height:1.4; }
  .pf .ctr { text-align:center; }
  .pf .quiet { opacity:.72; font-size:16px; }
  .pf .label { font-family:${STAMP}; font-size:15px; letter-spacing:.16em; text-transform:uppercase; color:${RED}; }
  .pf .label.ink { color:${INK}; opacity:.85; }
  .pf .hdr { display:flex; align-items:center; justify-content:center; gap:10px; font-family:${STAMP}; font-size:30px; letter-spacing:.1em; color:${INK}; padding-bottom:8px; border-bottom:3px solid ${INK}; margin-bottom:10px; }
  .pf .btn { display:block; font-family:${STAMP}; font-size:27px; letter-spacing:.1em; text-transform:uppercase; color:#fff; background:${RED}; text-align:center;
        padding:15px 12px 13px; margin:14px 0 8px; box-shadow:0 7px 0 #952c1f, 0 10px 18px rgba(0,0,0,.25); cursor:pointer; pointer-events:auto; transform:rotate(-.6deg); }
  .pf .btn:active { transform:rotate(-.6deg) translateY(4px); box-shadow:0 3px 0 #952c1f; }
  .pf .btn.ghost { background:transparent; color:${INK}; border:3px double ${INK}; box-shadow:none; }
  .pf .btn.ghost:active { background:rgba(36,66,143,.08); }
  .pf .btn.dim { opacity:.4; pointer-events:none; }
  .pf .stampbtn { display:inline-block; font-family:${STAMP}; font-size:22px; letter-spacing:.1em; text-transform:uppercase; color:${RED};
        border:3px solid ${RED}; border-radius:6px; padding:8px 16px 6px; margin:10px 8px 6px 0; transform:rotate(-1.6deg); background:rgba(200,64,47,.06);
        box-shadow:0 2px 0 rgba(200,64,47,.25); cursor:pointer; pointer-events:auto; }
  .pf .stampbtn:active { transform:rotate(-1.6deg) scale(.97); background:rgba(200,64,47,.16); }
  .pf .stampbtn.tin { color:${TIN}; border-color:${TIN}; background:rgba(196,105,26,.08); box-shadow:0 2px 0 rgba(196,105,26,.25); }
  .pf .stampbtn.ink { color:${INK}; border-color:${INK}; background:rgba(36,66,143,.06); box-shadow:0 2px 0 rgba(36,66,143,.25); }
  .pf .stampbtn.dim { opacity:.4; pointer-events:none; }
  .pf .link { color:${INK}; text-decoration:underline; text-underline-offset:3px; cursor:pointer; pointer-events:auto; font-size:18px; }
  .pf .back { position:absolute; left:40px; top:22px; width:38px; height:38px; border:3px solid ${INK}; border-radius:4px; display:flex; align-items:center; justify-content:center;
        font-family:${STAMP}; font-size:26px; line-height:1; cursor:pointer; pointer-events:auto; }
  .pf .card { position:relative; background:${PAPER_HI}; border:1px solid rgba(36,66,143,.15); padding:16px 14px 14px; margin:22px 0 10px; box-shadow:0 8px 20px rgba(0,0,0,.18); transform:rotate(-.4deg); }
  .pf .tape { position:absolute; left:50%; top:-12px; width:110px; height:22px; margin-left:-55px; background:rgba(236,214,120,.7); transform:rotate(-1deg); }
  .pf .rowb { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
  .pf .counter { border:2px solid ${INK}; padding:6px 10px 4px; text-align:center; font-family:${STAMP}; letter-spacing:.06em; line-height:1; }
  .pf .counter b { font-size:28px; font-weight:400; color:${RED}; }
  .pf .counter small { font-size:12px; letter-spacing:.14em; display:block; margin-top:3px; }
  .pf .ttl { font-family:${HAND}; font-size:32px; letter-spacing:.06em; text-transform:uppercase; margin:8px 0 2px; line-height:1.05; }
  .pf .prize { display:flex; align-items:center; justify-content:space-between; gap:10px; border:1px solid rgba(36,66,143,.25); padding:10px 12px; margin:10px 0; background:rgba(255,255,255,.35); }
  .pf .prize .pr { text-align:right; font-family:${HAND}; font-size:19px; letter-spacing:.06em; text-transform:uppercase; }
  .pf .dots { display:flex; align-items:center; justify-content:space-between; margin:10px 2px 4px; }
  .pf .dot { width:14px; height:14px; border:2px solid rgba(36,66,143,.55); border-radius:50%; background:transparent; }
  .pf .dot.done { background:${INK}; border-color:${INK}; }
  .pf .dot.now { border-color:${RED}; border-width:3px; }
  .pf .dot.cup { width:auto; height:auto; border:0; color:${RED}; font-size:18px; line-height:1; }
  .pf .sec { display:flex; align-items:center; gap:12px; font-family:${HAND}; font-size:26px; letter-spacing:.12em; text-transform:uppercase; margin:22px 0 4px; }
  .pf .sec::after { content:""; flex:1; height:2px; background:rgba(36,66,143,.35); }
  .pf .mode { display:flex; align-items:center; gap:14px; padding:14px 4px; border-bottom:2px solid rgba(36,66,143,.25); cursor:pointer; pointer-events:auto; }
  .pf .mode:active { background:rgba(36,66,143,.06); }
  .pf .mode .ico { width:44px; text-align:center; font-size:30px; line-height:1; }
  .pf .mode .mt { font-family:${HAND}; font-size:26px; letter-spacing:.1em; text-transform:uppercase; line-height:1.1; }
  .pf .mode .ms { font-size:16px; opacity:.75; }
  .pf .mode .arr { margin-left:auto; color:${RED}; font-size:26px; }
  .pf .badge { display:inline-block; font-family:${STAMP}; font-size:13px; letter-spacing:.1em; background:#f3d23c; color:#1d1d1d; padding:3px 6px 1px; margin-left:6px; vertical-align:middle; transform:rotate(-2deg); }
  .pf .sq { display:flex; justify-content:center; gap:6px; margin:8px 0 14px; }
  .pf .sq span { width:26px; height:14px; background:rgba(36,66,143,.2); border-radius:2px; }
  .pf .sq span.done { background:${INK}; } .pf .sq span.now { background:${RED}; }
  .pf .vs { display:flex; align-items:center; justify-content:space-between; gap:6px; margin:6px 0 10px; }
  .pf .vs .side { flex:1; text-align:center; }
  .pf .vs .nm { font-family:${HAND}; font-size:20px; letter-spacing:.1em; text-transform:uppercase; }
  .pf .vs .pn { font-size:19px; margin-top:4px; }
  .pf .vs .v { font-family:${STAMP}; font-size:28px; color:${RED}; padding:0 4px; border-left:1px solid rgba(36,66,143,.25); align-self:stretch; display:flex; align-items:center; }
  .pf .pic { display:block; margin:6px auto; pointer-events:auto; }
  .pf .line { display:flex; justify-content:space-between; font-size:20px; padding:8px 4px 10px; border-bottom:2px dashed rgba(36,66,143,.35); margin-bottom:8px; }
  .pf .line b { font-family:${HAND}; font-weight:400; font-size:24px; }
  .pf .howto { position:relative; height:120px; background:linear-gradient(180deg,#c48b4b,#b27a3e); border:3px solid ${INK}; margin:8px 0 10px; overflow:hidden; }
  .pf .howto .hp { position:absolute; left:14%; width:72%; }
  .pf .howto .ring { position:absolute; width:26px; height:26px; border:4px solid ${RED}; border-radius:50%; background:rgba(255,255,255,.7); }
  .pf .howto .pull { position:absolute; border-top:3px dashed rgba(200,64,47,.9); width:60px; transform-origin:0 0; }
  .pf .chit { position:relative; background:${PAPER_HI}; border:1px solid rgba(36,66,143,.18); border-radius:3px; padding:10px 12px 10px 14px; margin:10px 0;
        box-shadow:0 3px 8px rgba(0,0,0,.12); transform:rotate(-.4deg); }
  .pf .chit:nth-child(even) { transform:rotate(.5deg); }
  .pf .chit .who { font-size:22px; }
  .pf .chit .who small { font-size:15px; opacity:.7; margin-left:6px; }
  .pf .chit .pen { font-size:17px; color:${RED}; }
  .pf .chit .intro { font-size:16px; opacity:.85; margin-top:2px; }
  .pf .chit .state { position:absolute; right:10px; top:8px; font-family:${STAMP}; font-size:14px; letter-spacing:.08em; text-transform:uppercase; padding:3px 6px 1px; border:2px solid; border-radius:4px; transform:rotate(6deg); }
  .pf .chit .state.beaten { color:#2f7a3a; border-color:#2f7a3a; }
  .pf .chit .state.next { color:${RED}; border-color:${RED}; }
  .pf .chit .state.locked { color:rgba(36,66,143,.45); border-color:rgba(36,66,143,.35); }
  .pf .chit.pick { cursor:pointer; pointer-events:auto; display:flex; align-items:center; gap:10px; }
  .pf .chit.pick.sel { outline:3px solid ${RED}; outline-offset:-3px; }
  .pf .topbar { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  .pf .tin { position:relative; margin:0 -2px 0; }
  .pf .lid { position:relative; height:176px; background:radial-gradient(ellipse at 50% 40%, #d8792f, #b95a22 70%, #8f4419); border:7px solid #8a4a1c; border-bottom-width:4px; border-radius:18px 18px 4px 4px;
        box-shadow:inset 0 0 40px rgba(60,20,0,.55), inset 0 0 6px rgba(255,200,150,.25), 0 6px 14px rgba(0,0,0,.4); overflow:hidden; }
  .pf .lid .stencil { position:absolute; left:0; right:0; top:22px; text-align:center; font-family:${STAMP}; font-size:min(78px,17vw); line-height:1; letter-spacing:.04em; color:#1e2a4a; opacity:.92; white-space:nowrap; }
  .pf .lid .lidpens { position:absolute; left:50%; top:108px; width:240px; margin-left:-120px; }
  .pf .lid .rust { position:absolute; border-radius:50%; background:rgba(70,30,10,.35); filter:blur(3px); }
  .pf .hinge { height:8px; background:linear-gradient(180deg,#5a2f12,#3d1f0b); margin:0 8px; }
  .pf .base { background:#262628; border:7px solid #8a4a1c; border-top-width:4px; border-radius:4px 4px 18px 18px; padding:12px 14px 16px; box-shadow:inset 0 0 40px rgba(0,0,0,.7), 0 8px 18px rgba(0,0,0,.45); }
  .pf .slot { background:#141416; border-radius:14px; height:30px; margin:8px 0; box-shadow:inset 0 3px 6px rgba(0,0,0,.9), inset 0 -1px 0 rgba(255,255,255,.05); display:flex; align-items:center; justify-content:center; }
  .pf .slot svg { width:96%; height:24px; }
  .pf .tag { display:inline-block; font-family:${STAMP}; font-size:16px; letter-spacing:.14em; color:#fff; background:${RED}; padding:6px 12px 4px; transform:rotate(-2deg); box-shadow:0 3px 0 #952c1f; }
  .pf .links { display:flex; justify-content:center; gap:22px; margin-top:12px; }
  .pf .mute { position:absolute; right:12px; top:${SAFE_T + 8}px; pointer-events:auto; font-size:18px; opacity:.7; z-index:9; }
</style>
<div class="pf">
  <div class="board" data-el="board"></div>
  <div class="slip" data-el="slip"></div>
  <div class="hint" data-el="hint"></div>
  <div class="page show" data-el="page"><div class="inner" data-el="inner"></div></div>
  <div class="mute" data-el="mute">🔊</div>
</div>`;

    const $ = (k) => ui.querySelector('[data-el="' + k + '"]');
    const elBoard = $("board"), elSlip = $("slip"), elHint = $("hint"), elPage = $("page"), elInner = $("inner"), elMute = $("mute");

    ctx.markVisualReady("title");
    ctx.platform.ready();

    function fatal(where, err) {
      elPage.classList.add("show");
      elInner.innerHTML = "<h1>OOPS</h1><p>Could not start (" + esc(where) + ").</p><p class='quiet'>" + esc(String(err && err.message || err || "")) + "</p>";
      try { ctx.platform.error({ where: where, message: String(err && err.message || err) }); } catch (_) {}
    }

    // ===================================================================== //
    // 2. Three.js                                                           //
    // ===================================================================== //
    let THREE;
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try { THREE = await ctx.importModule("three", "0.164.1"); }
    catch (e1) { try { THREE = await ctx.importModule(THREE_URL); } catch (e2) { fatal("load three", e2 || e1); return; } }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) { fatal("three exports", new Error("WebGLRenderer missing")); return; }

    try {

    // ===================================================================== //
    // 3. The pens, the bench, the world                                     //
    // ===================================================================== //
    // Real dimensions in metres. Mass comes from density * r^2 * L, which for
    // these numbers lands on the ten-or-so grams a school pen weighs. Friction
    // is pen-on-desk; restitution is how lively it is when struck.
    const PENS = {
      r045:       { name: "Reynolds 045",       short: "045",        flavour: "the one everybody had. writes, fights, gets lost.",              r: 0.0050, L: 0.148, dens: 1160, mu: 0.33, e: 0.36, shape: "round",
                    paint: { body: "#f2f0ea", cap: "#1b52c9", capLen: 0.4, text: "045 REYNOLDS FINE CARBURE", textColor: "#c8322a", grip: null } },
      v5:         { name: "Pilot V5",           short: "V5",         flavour: "light and quick, and it will not sit still for anybody.",       r: 0.00531, L: 0.140, dens: 1010, mu: 0.27, e: 0.48, shape: "round",
                    paint: { body: "#2b6ee0", clear: true, cap: "#2b6ee0", text: "V5 HI-TECPOINT", textColor: "#ffffff", clipMetal: true, grip: { from: 0.1, to: 0.3, color: "#1a1a1e" }, bands: [{ at: 0.52, w: 0.014, color: "#d9dde3" }] } },
      writometer: { name: "Flair Writometer",   short: "Writometer", flavour: "long and thin; it slides further than you meant it to.",        r: 0.0053, L: 0.152, dens: 825, mu: 0.20, e: 0.40, shape: "round",
                    paint: { body: "#f4f1e8", cap: "#2a6fd6", text: "FLAIR WRITOMETER", textColor: "#2a6fd6", bands: [{ at: 0.5, w: 0.02, color: "#2a6fd6" }] } },
      gripper:    { name: "Cello Gripper",      short: "Gripper",    flavour: "the rubber grip parks it exactly where you put it.",            r: 0.00487, L: 0.145, dens: 1409, mu: 0.55, e: 0.30, shape: "round",
                    paint: { body: "#f2efe6", clear: true, cap: "#111114", text: "CELLO GRIPPER", textColor: "#111114", grip: { from: 0.1, to: 0.36, color: "#2c8f3a" } } },
      ocean:      { name: "Linc Ocean",         short: "Ocean",      flavour: "a gel pen with a temper; hits bounce off it sideways.",         r: 0.00511, L: 0.145, dens: 1403, mu: 0.33, e: 0.58, shape: "round",
                    paint: { body: "#1e9bb4", cap: "#0d5c6e", text: "LINC OCEAN", textColor: "#ffffff", grip: { from: 0.12, to: 0.3, color: "#0d5c6e" } } },
      addgel:     { name: "Add Gel",            short: "Add Gel",    flavour: "the first gel pen in class. sits planted, hits solid.",         r: 0.00546, L: 0.145, dens: 1303, mu: 0.42, e: 0.30, shape: "round",
                    paint: { body: "#2b2b30", cap: "#7c7f86", text: "ADD GEL", textColor: "#d8d8dc", grip: { from: 0.12, to: 0.34, color: "#5a5c62" } } },
      butterflow: { name: "Cello Butterflow",   short: "Butterflow", flavour: "smooth as its name. hits sink into it and die.",               r: 0.00535, L: 0.146, dens: 1331, mu: 0.28, e: 0.18, shape: "round",
                    paint: { body: "#7fb7e8", clear: true, cap: "#1f3f8f", text: "BUTTERFLOW", textColor: "#1f3f8f", bands: [{ at: 0.42, w: 0.015, color: "#ffffff" }] } },
      racer:      { name: "Reynolds Racer Gel", short: "Racer",      flavour: "grips the desk and moves what it meets.",                      r: 0.00623, L: 0.147, dens: 1128, mu: 0.46, e: 0.26, shape: "round",
                    paint: { body: "#17171b", cap: "#c81d24", text: "REYNOLDS RACER", textColor: "#ffffff", grip: { from: 0.1, to: 0.3, color: "#c81d24" } } },
      megatop:    { name: "Montex Megatop",     short: "Megatop",    flavour: "that huge cap makes it wobble. it never slides straight.",       r: 0.00589, L: 0.150, dens: 983, mu: 0.30, e: 0.34, shape: "round", topHeavy: true,
                    paint: { body: "#efe9d8", cap: "#d8b34a", capLen: 0.34, capR: 1.35, text: "MONTEX MEGATOP", textColor: "#263c68" } },
      platinum:   { name: "Apsara Platinum",    short: "Platinum",   flavour: "a pencil. the one with the good handwriting on the side.",     r: 0.00404, L: 0.128, dens: 871, mu: 0.29, e: 0.16, shape: "hex", pencil: true,
                    paint: { body: "#141418", alt: "#e4d4a9", tip: "wood", text: "apsara Platinum", textColor: "#ffffff", dip: "#141418" } },
      parker:     { name: "Parker Vector",      short: "Vector",     flavour: "the teacher's steel pen; dead weight, clean executions.",      r: 0.00522, L: 0.140, dens: 1703, mu: 0.28, e: 0.16, shape: "round",
                    paint: { body: "#cfd8dc", metal: true, cap: "#b9c2c8", text: "PARKER", textColor: "#3a3a40", clipMetal: true, bands: [{ at: 0.5, w: 0.012, color: "#7a8288" }] } },
      trimax:     { name: "Reynolds Trimax",    short: "Trimax",     flavour: "triangular, so it does not roll. it stops where it wants.",    r: 0.00694, L: 0.146, dens: 1556, mu: 0.42, e: 0.20, shape: "tri",
                    paint: { body: "#f6f1e0", cap: "#2458b8", text: "REYNOLDS TRIMAX", textColor: "#2458b8", grip: { from: 0.1, to: 0.3, color: "#2458b8" } } }
    };
    for (const id in PENS) PENS[id].id = id;
    const STARTER = "r045";

    // The bench: eleven kids in the order you meet them, each with the pen at stake.
    const BENCH = [
      { name: "Bunty",   section: "9B",  pen: "v5",         intro: "back bench, same as you. flicks before he has finished looking." },
      { name: "Priya",   section: "9C",  pen: "writometer", intro: "keeps the Writometer in a geometry box. says it is lucky." },
      { name: "Rohan",   section: "8A",  pen: "gripper",    intro: "a year below, and already nobody in 8A will play him." },
      { name: "Meher",   section: "9D",  pen: "ocean",      intro: "aims at the corner of the desk, not at your pen. it works." },
      { name: "Aakash",  section: "10C", pen: "addgel",     intro: "took the Add Gel off his own brother. does not talk about it." },
      { name: "Zainab",  section: "9E",  pen: "butterflow", intro: "beat her whole section without losing a round." },
      { name: "Tarun",   section: "10B", pen: "racer",      intro: "plays for the section, he says. plays for the pen." },
      { name: "Nidhi",   section: "8B",  pen: "megatop",    intro: "small hands, huge cap. nobody in 8B has a pen left." },
      { name: "Farhan",  section: "10A", pen: "platinum",   intro: "brought a pencil to a pen fight, and is still unbeaten." },
      { name: "Ishita",  section: "10D", pen: "parker",     intro: "her father's pen. she has not lost with it. she cannot lose it." },
      { name: "Vikram",  section: "12A", pen: "trimax",     intro: "twelfth standard. holds the Trimax. does this for the walk over." }
    ];
    // Skill climbs the bench: aim spread in degrees, power misjudgement, and how
    // many candidate flicks the rival thinks through before choosing.
    const rivalTier = (i) => ({ skill: 0.38 + i * 0.052, aimDeg: 12 - i * 0.85, powerNoise: 0.16 - i * 0.01, breadth: 2 + Math.floor(i / 2), edgeSense: 0.3 + i * 0.06 });

    const G = 9.81;
    const MU_PEN = 0.22;            // pen on pen
    const TABLE_HX = 0.215, TABLE_HY = 0.36, TABLE_TOP = 0, TABLE_THICK = 0.026;
    const FLOOR_Y = -0.34;
    const V_MAX = 1.85;
    const REF_MASS = 0.0092;        // flick strength is tuned around a 9 g pen
    const J_MAX = REF_MASS * V_MAX;
    // a light pen still leaves faster than a heavy one, but by the square root, so a mid-power flick stays on the desk
    const flickJ = (pen, power) => J_MAX * power * Math.sqrt(pen.m / REF_MASS);
    const SPIN_TRANSFER = 0.55, SPIN_SOFT_CAP = 46;
    const toWorldX = (p) => p.x, toWorldZ = (p) => -p.y;

    // ===================================================================== //
    // 4. Rigid bodies                                                       //
    // ===================================================================== //
    class Pen {
      constructor(side) {
        this.side = side; this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.a = 0; this.w = 0;
        this.alive = true; this.fall = null; this.mesh = null; this.glow = null; this.slide = 0;
        this.setSpec(PENS[STARTER]);
      }
      setSpec(spec) {
        this.spec = spec; this.L = spec.L; this.rad = spec.r;
        this.m = spec.dens * spec.r * spec.r * spec.L;
        this.I = this.m * this.L * this.L / 12 * (spec.topHeavy ? 1.3 : 1);
        this.mu = spec.mu; this.e = spec.e; this.shape = spec.shape;
      }
      get ax() { return Math.cos(this.a); }
      get ay() { return Math.sin(this.a); }
      pointAt(s) { return { x: this.x + this.ax * s, y: this.y + this.ay * s }; }
      ends() { return [this.pointAt(-this.L / 2), this.pointAt(this.L / 2)]; }
      speed() { return Math.hypot(this.vx, this.vy); }
      moving() { return this.speed() > 0.006 || Math.abs(this.w) > 0.09; }
      velAt(rx, ry) { return { x: this.vx - this.w * ry, y: this.vy + this.w * rx }; }
      impulseAt(p, jx, jy) {
        const rx = p.x - this.x, ry = p.y - this.y;
        this.vx += jx / this.m; this.vy += jy / this.m;
        const torque = rx * jy - ry * jx;
        this.w += (torque / this.I) * SPIN_TRANSFER;
        const s = Math.abs(this.w);
        if (s > SPIN_SOFT_CAP) this.w = Math.sign(this.w) * (SPIN_SOFT_CAP + (s - SPIN_SOFT_CAP) * 0.25);
      }
      clone() { const c = Object.create(Pen.prototype); Object.assign(c, this); c.mesh = null; c.glow = null; c.fall = null; return c; }
    }
    const you = new Pen("you"), cpu = new Pen("cpu");
    const pens = [you, cpu];

    /**
     * Coulomb friction integrated along the pen. A round pen struck broadside
     * rolls rather than slides, so its friction drops with how much of its
     * motion is across the axis; a triangular or hexagonal one just scrapes.
     */
    const FRIC_N = 9;
    function tableFriction(p, dt) {
      const ax = p.ax, ay = p.ay, share = p.m / FRIC_N;
      let mu = p.mu;
      if (p.shape === "round") {
        const sp = p.speed();
        if (sp > 1e-4) { const perp = Math.abs(-ay * p.vx + ax * p.vy) / sp; mu *= 1 - 0.42 * perp * perp; }
      }
      const jCap = mu * share * G * dt;
      let Jx = 0, Jy = 0, T = 0;
      for (let i = 0; i < FRIC_N; i++) {
        const s = (-0.5 + (i + 0.5) / FRIC_N) * p.L, rx = ax * s, ry = ay * s;
        const vx = p.vx - p.w * ry, vy = p.vy + p.w * rx, sp = Math.hypot(vx, vy);
        if (sp < 1e-7) continue;
        const j = Math.min(jCap, share * sp), fx = -j * vx / sp, fy = -j * vy / sp;
        Jx += fx; Jy += fy; T += rx * fy - ry * fx;
      }
      p.vx += Jx / p.m; p.vy += Jy / p.m; p.w += T / p.I;
      if (Math.hypot(p.vx, p.vy) < 0.004) { p.vx = 0; p.vy = 0; }
      if (Math.abs(p.w) < 0.06) p.w = 0;
    }
    function segSeg(p1, q1, p2, q2) {
      const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d2x = q2.x - p2.x, d2y = q2.y - p2.y, rx = p1.x - p2.x, ry = p1.y - p2.y;
      const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
      let s, t; const EPS = 1e-12;
      if (a <= EPS && e <= EPS) { s = 0; t = 0; }
      else if (a <= EPS) { s = 0; t = clamp(f / e, 0, 1); }
      else if (e <= EPS) { t = 0; s = clamp(-(d1x * rx + d1y * ry) / a, 0, 1); }
      else {
        const c = d1x * rx + d1y * ry, b = d1x * d2x + d1y * d2y, denom = a * e - b * b;
        if (denom <= 1e-8 * a * e) {
          const u0 = -c / a, u1 = (b - c) / a, lo = Math.max(0, Math.min(u0, u1)), hi = Math.min(1, Math.max(u0, u1));
          s = hi >= lo ? (lo + hi) / 2 : (u0 < 0 ? 0 : 1); t = clamp((b * s + f) / e, 0, 1);
        } else {
          s = clamp((b * f - c * e) / denom, 0, 1); t = (b * s + f) / e;
          if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
        }
      }
      return { c1: { x: p1.x + d1x * s, y: p1.y + d1y * s }, c2: { x: p2.x + d2x * t, y: p2.y + d2y * t } };
    }
    let lastHit = 0, lastHitAt = null;
    function collide(A, B, quiet) {
      if (!A.alive || !B.alive) return 0;
      const [a0, a1] = A.ends(), [b0, b1] = B.ends();
      const cp = segSeg(a0, a1, b0, b1);
      let dx = cp.c2.x - cp.c1.x, dy = cp.c2.y - cp.c1.y, d = Math.hypot(dx, dy);
      const R = A.rad + B.rad;
      if (d >= R) return 0;
      let nx, ny;
      if (d > 1e-9) { nx = dx / d; ny = dy / d; } else { nx = -A.ay; ny = A.ax; d = 0; }
      const overlap = (R - d) * 0.8, invA = 1 / A.m, invB = 1 / B.m, invSum = invA + invB;
      A.x -= nx * overlap * (invA / invSum); A.y -= ny * overlap * (invA / invSum);
      B.x += nx * overlap * (invB / invSum); B.y += ny * overlap * (invB / invSum);
      const cx = (cp.c1.x + cp.c2.x) / 2, cy = (cp.c1.y + cp.c2.y) / 2;
      const rax = cx - A.x, ray = cy - A.y, rbx = cx - B.x, rby = cy - B.y;
      const va = A.velAt(rax, ray), vb = B.velAt(rbx, rby);
      const vn = (vb.x - va.x) * nx + (vb.y - va.y) * ny;
      if (vn > 0) return 0;
      const rcA = rax * ny - ray * nx, rcB = rbx * ny - rby * nx;
      const kN = invA + invB + rcA * rcA / A.I + rcB * rcB / B.I;
      const rest = (A.e + B.e) / 2;
      const j = -(1 + rest) * vn / kN;
      A.vx -= j * nx * invA; A.vy -= j * ny * invA; A.w -= j * rcA / A.I;
      B.vx += j * nx * invB; B.vy += j * ny * invB; B.w += j * rcB / B.I;
      const tx = -ny, ty = nx;
      const va2 = A.velAt(rax, ray), vb2 = B.velAt(rbx, rby);
      const vt = (vb2.x - va2.x) * tx + (vb2.y - va2.y) * ty;
      const rtA = rax * ty - ray * tx, rtB = rbx * ty - rby * tx;
      const kT = invA + invB + rtA * rtA / A.I + rtB * rtB / B.I;
      const cap = MU_PEN * Math.abs(j);
      const jt = clamp(-vt / kT, -cap, cap);
      A.vx -= jt * tx * invA; A.vy -= jt * ty * invA; A.w -= jt * rtA / A.I;
      B.vx += jt * tx * invB; B.vy += jt * ty * invB; B.w += jt * rtB / B.I;
      if (!quiet) lastHitAt = { x: cx, y: cy };
      return Math.abs(j);
    }
    function offTable(p) { return Math.abs(p.x) > TABLE_HX || Math.abs(p.y) > TABLE_HY; }
    function overhang(p) {
      let out = 0;
      for (let i = 0; i < 12; i++) { const q = p.pointAt((-0.5 + (i + 0.5) / 12) * p.L); if (Math.abs(q.x) > TABLE_HX || Math.abs(q.y) > TABLE_HY) out++; }
      return out / 12;
    }
    function edgeDist(p) { return Math.min(TABLE_HX - Math.abs(p.x), TABLE_HY - Math.abs(p.y)); }
    function startFall(p) {
      p.alive = false;
      const ox = Math.abs(p.x) > TABLE_HX ? Math.sign(p.x) : 0, oy = Math.abs(p.y) > TABLE_HY ? Math.sign(p.y) : 0;
      let nx = ox, ny = oy; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.a);
      const outSpeed = Math.max(0.12, p.vx * nx + p.vy * ny);
      const axis = new THREE.Vector3(-ny, 0, -nx).normalize();
      p.fall = { pos: new THREE.Vector3(toWorldX(p), TABLE_TOP + p.rad, toWorldZ(p)), vel: new THREE.Vector3(p.vx, 0.02, -p.vy), quat: q,
        spin: axis.multiplyScalar(4.5 + outSpeed * 7).add(new THREE.Vector3(0, p.w * 0.35, 0)), rest: 0, bounces: 0 };
      p.vx = p.vy = p.w = 0;
    }
    function stepFall(p, dt) {
      const f = p.fall;
      f.vel.y -= G * dt; f.pos.addScaledVector(f.vel, dt);
      const sp = f.spin.length();
      if (sp > 1e-5) f.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(f.spin.clone().normalize(), sp * dt));
      const rest = FLOOR_Y + p.rad;
      if (f.pos.y < rest) {
        f.pos.y = rest;
        if (f.vel.y < -0.25) { f.vel.y = -f.vel.y * 0.3; f.vel.x *= 0.62; f.vel.z *= 0.62; f.spin.multiplyScalar(0.5); f.bounces++; sfxClatter(clamp(Math.abs(f.vel.y) * 1.6, 0.12, 0.9)); }
        else { f.vel.set(f.vel.x * 0.85, 0, f.vel.z * 0.85); f.spin.multiplyScalar(0.85); if (f.vel.lengthSq() < 1e-4) { f.vel.set(0, 0, 0); f.spin.set(0, 0, 0); f.rest = 1; } }
      }
    }

    // ===================================================================== //
    // 5. Simulation driver, plus a silent copy the rival can think with     //
    // ===================================================================== //
    let fellThisTurn = null;
    function simulate(dt) {
      let vmax = 0;
      for (const p of pens) if (p.alive) vmax = Math.max(vmax, p.speed() + Math.abs(p.w) * p.L * 0.5);
      const steps = clamp(Math.ceil((vmax * dt) / 0.003), 1, 24), h = dt / steps;
      for (let k = 0; k < steps; k++) {
        for (const p of pens) { if (!p.alive) continue; tableFriction(p, h); p.x += p.vx * h; p.y += p.vy * h; p.a += p.w * h; }
        const j = collide(you, cpu, false);
        if (j > 0) onClack(j);
        for (const p of pens) if (p.alive && offTable(p)) { startFall(p); if (!fellThisTurn) fellThisTurn = p; onKnockOff(p); }
      }
      for (const p of pens) if (!p.alive && p.fall && !p.fall.rest) stepFall(p, dt);
    }
    function anyMoving() {
      for (const p of pens) { if (p.alive && p.moving()) return true; if (!p.alive && p.fall && !p.fall.rest) return true; }
      return false;
    }
    /** Runs a flick forward on copies and reports where everything ended up. */
    function rehearse(mover, other, at, dir, power, seconds) {
      const A = mover.clone(), B = other.clone();
      const jr = flickJ(A, power); A.impulseAt(at, dir.x * jr, dir.y * jr);
      const h = 1 / 240; let t = 0, aOff = false, bOff = false;
      while (t < seconds) {
        for (const p of [A, B]) { if (!p.alive) continue; tableFriction(p, h); p.x += p.vx * h; p.y += p.vy * h; p.a += p.w * h; }
        collide(A, B, true);
        if (A.alive && offTable(A)) { A.alive = false; aOff = true; }
        if (B.alive && offTable(B)) { B.alive = false; bOff = true; }
        t += h;
        if ((aOff || bOff) || (!A.moving() && !B.moving() && t > 0.3)) break;
      }
      return { A, B, aOff, bOff, t };
    }

    // ===================================================================== //
    // 6. Audio: everything synthesised                                      //
    // ===================================================================== //
    let ac = null, master = null, noiseBuf = null, audioDead = false, slideSrc = null, slideGain = null, slideFilt = null, musicHandle = null;
    let muted = false;
    function buildAudio() {
      if (ac || audioDead) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.9;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -15; comp.ratio.value = 3.6; comp.attack.value = 0.002; comp.release.value = 0.22;
      master.connect(comp); comp.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      slideFilt = ac.createBiquadFilter(); slideFilt.type = "bandpass"; slideFilt.frequency.value = 1750; slideFilt.Q.value = 0.85;
      slideGain = ac.createGain(); slideGain.gain.value = 0;
      slideSrc = ac.createBufferSource(); slideSrc.buffer = noiseBuf; slideSrc.loop = true;
      slideSrc.connect(slideFilt); slideFilt.connect(slideGain); slideGain.connect(master);
      try { slideSrc.start(0); } catch (_) {}
      return ac;
    }
    function env(g, t, peak, atk, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec); }
    const live = () => ac && ac.state === "running";
    function noiseHit(t, freq0, freq1, q, peak, atk, dec, type) {
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = type || "bandpass"; bp.frequency.setValueAtTime(freq0, t); bp.frequency.exponentialRampToValueAtTime(freq1, t + dec * 0.8); bp.Q.value = q;
      const g = ac.createGain(); env(g, t, peak, atk, dec); src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + atk + dec + 0.05);
    }
    function sfxClack(vol, pitch) {
      if (!live()) return; const t = ac.currentTime, v = clamp(vol, 0.05, 1);
      noiseHit(t, 2600 * pitch, 1100 * pitch, 1.1, v * 0.5, 0.0012, 0.035);
      for (const [mul, amp] of [[1, 1], [2.71, 0.42]]) {
        const o = ac.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(940 * pitch * mul, t); o.frequency.exponentialRampToValueAtTime(880 * pitch * mul, t + 0.05);
        const g = ac.createGain(); env(g, t, v * 0.3 * amp, 0.0018, 0.055 / mul); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
      }
    }
    function sfxFlick(power) { if (!live()) return; noiseHit(ac.currentTime, 420 + 900 * power, 160 + 300 * power, 0.6, 0.1 + 0.22 * power, 0.004, 0.13); }
    function sfxClatter(vol) {
      if (!live()) return; const t = ac.currentTime, v = clamp(vol, 0.05, 1);
      noiseHit(t, 2100, 420, 0.7, v * 0.42, 0.002, 0.19, "lowpass");
      const o = ac.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(96, t + 0.14);
      const og = ac.createGain(); env(og, t, v * 0.16, 0.003, 0.16); o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.3);
    }
    let lastCreak = 0;
    function sfxCreak() {
      if (!live()) return; const t = ac.currentTime; if (t - lastCreak < 0.22) return; lastCreak = t;
      const o = ac.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(rnd(340, 460), t);
      const g = ac.createGain(); env(g, t, 0.05, 0.004, 0.07); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12);
    }
    /** Chalk on a board: a short scratchy hiss per stroke. */
    function sfxChalk(n) { if (!live()) return; for (let i = 0; i < (n || 1); i++) noiseHit(ac.currentTime + i * 0.13, 3200, 2400, 2.2, 0.08, 0.01, 0.09); }
    /** A slip of paper being dropped on the desk. */
    function sfxPaper() { if (!live()) return; noiseHit(ac.currentTime, 900, 300, 0.5, 0.07, 0.03, 0.12); }
    /** The school bell: a bright ring with two partials, fading. */
    function sfxBell() {
      if (!live()) return; const t = ac.currentTime;
      for (const [f, a, d] of [[1760, 0.14, 1.4], [2637, 0.08, 1.0], [880, 0.06, 1.8]]) {
        const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = f; const g = ac.createGain(); env(g, t, a, 0.004, d); o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.1);
      }
    }
    /** A class cheering or groaning: filtered noise swells shaped by voice-like partials. */
    function sfxCrowd(happy) {
      if (!live()) return; const t = ac.currentTime;
      noiseHit(t, happy ? 1200 : 500, happy ? 1800 : 300, 0.8, 0.16, 0.25, happy ? 1.1 : 1.3, "bandpass");
      for (let i = 0; i < 5; i++) {
        const o = ac.createOscillator(); o.type = "sawtooth"; const f = happy ? rnd(300, 620) : rnd(140, 260);
        o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(happy ? f * 1.25 : f * 0.7, t + 0.9);
        const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
        const g = ac.createGain(); env(g, t + rnd(0, 0.12), 0.03, 0.2, 0.9); o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + 1.5);
      }
    }
    function updateSlideBed() {
      if (!slideGain || !live()) return;
      let s = 0; for (const p of pens) if (p.alive) s = Math.max(s, p.speed() + Math.abs(p.w) * 0.02);
      slideGain.gain.setTargetAtTime(clamp(s * 0.11, 0, 0.13), ac.currentTime, 0.04);
      if (slideFilt) slideFilt.frequency.setTargetAtTime(1200 + clamp(s, 0, 2) * 900, ac.currentTime, 0.06);
    }
    function onClack(j) {
      const vol = clamp(j / (REF_MASS * 1.2), 0.06, 1); lastHit = vol;
      sfxClack(vol, 1 + rnd(-0.09, 0.09));
      if (vol > 0.22 && ctx.capabilities.haptics) { try { ctx.platform.haptic(vol > 0.6 ? "medium" : "light"); } catch (_) {} }
      if (lastHitAt) sparkAt(lastHitAt, vol);
    }
    let ambOn = false;
    /** The classroom around you: a ceiling fan, and the rest of the school somewhere down the corridor. */
    function startAmbience() {
      if (ambOn || !buildAudio()) return; ambOn = true; const t = ac.currentTime;
      const fan = ac.createOscillator(); fan.type = "triangle"; fan.frequency.value = 47;
      const fl = ac.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 150;
      const fg = ac.createGain(); fg.gain.setValueAtTime(0, t); fg.gain.linearRampToValueAtTime(0.03, t + 3);
      const wob = ac.createOscillator(); wob.frequency.value = 0.85; const wg = ac.createGain(); wg.gain.value = 0.01; wob.connect(wg); wg.connect(fg.gain);
      fan.connect(fl); fl.connect(fg); fg.connect(master); fan.start(t); wob.start(t);
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 640; bp.Q.value = 1.2;
      const cg = ac.createGain(); cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(0.016, t + 4);
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.21; const lg = ac.createGain(); lg.gain.value = 0.01; lfo.connect(lg); lg.connect(cg.gain);
      const lfo2 = ac.createOscillator(); lfo2.frequency.value = 2.7; const lg2 = ac.createGain(); lg2.gain.value = 180; lfo2.connect(lg2); lg2.connect(bp.frequency);
      src.connect(bp); bp.connect(cg); cg.connect(master); src.start(t); lfo.start(t); lfo2.start(t);
    }
    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic || musicHandle) return;
      try { await ctx.music.unlock(); musicHandle = await ctx.music.play({ preset: "lofi", volume: 0.22, intensity: 0.3, density: 0.35, tempo: 74, fadeInMs: 1600 }); } catch (_) {}
    }
    function applyMute() { if (master) master.gain.value = muted ? 0 : 0.9; try { if (musicHandle) musicHandle.setVolume ? musicHandle.setVolume(muted ? 0 : 0.22) : null; } catch (_) {} elMute.textContent = muted ? "🔇" : "🔊"; }

    // ===================================================================== //
    // 7. Procedural textures                                                //
    // ===================================================================== //
    function tex2d(c, srgb) { const t = new THREE.CanvasTexture(c); if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
    /** A school desk top: plywood in a warm brown, varnish worn through in patches, ruled by years of compass points. */
    function deskTexture() {
      const W = 512, H = 800, c = surface(W, H), g = c.getContext("2d");
      const base = g.createLinearGradient(0, 0, W, H);
      base.addColorStop(0, "#b07a3c"); base.addColorStop(0.5, "#c08a46"); base.addColorStop(1, "#a97438");
      g.fillStyle = base; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 170; i++) {
        const y0 = Math.random() * H, amp = rnd(2, 9), freq = rnd(0.005, 0.02), ph = Math.random() * TAU;
        g.strokeStyle = Math.random() < 0.5 ? "rgba(90,50,18," + rnd(0.05, 0.13).toFixed(3) + ")" : "rgba(230,185,120," + rnd(0.04, 0.1).toFixed(3) + ")";
        g.lineWidth = rnd(0.6, 2.2); g.beginPath();
        for (let x = 0; x <= W; x += 6) { const y = y0 + Math.sin(x * freq + ph) * amp; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      for (let k = 0; k < 6; k++) {
        const px = rnd(40, W - 40), py = rnd(60, H - 60), r = rnd(50, 120);
        const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, "rgba(240,205,150,.2)"); gr.addColorStop(1, "rgba(240,205,150,0)");
        g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
      }
      // years of compass scratches, pale where the varnish came off
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = Math.random() < 0.7 ? "rgba(245,225,190," + rnd(0.18, 0.5).toFixed(2) + ")" : "rgba(70,38,12," + rnd(0.15, 0.35).toFixed(2) + ")";
        g.lineWidth = rnd(0.6, 1.6); const x = Math.random() * W, y = Math.random() * H, l = rnd(8, 90), a = rnd(0, TAU);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      g.fillStyle = "rgba(40,20,8,.5)"; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      // carvings and ink, the way a last-bench desk ends up
      const carve = (txt, x, y, rot, size) => { g.save(); g.translate(x, y); g.rotate(rot); g.font = size + "px " + HAND; g.lineWidth = 1.2; g.strokeStyle = "rgba(60,30,10,.55)"; g.strokeText(txt, 0, 0); g.fillStyle = "rgba(245,225,190,.35)"; g.fillText(txt, 1, 1); g.restore(); };
      carve("LAST BENCH", W - 40, 300, -Math.PI / 2, 26);
      carve("golu", 46, 380, Math.PI / 2, 22);
      carve("Raju", 72, 640, -Math.PI / 2, 24);
      carve("AJ", W - 110, H - 80, -0.2, 34);
      carve("9B", 150, 470, 0.15, 24);
      // a tally of wins
      g.strokeStyle = "rgba(60,30,10,.6)"; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(120 + i * 9, 60); g.lineTo(122 + i * 9, 92); g.stroke(); }
      g.beginPath(); g.moveTo(114, 86); g.lineTo(158, 64); g.stroke();
      // a cup ring, a heart, an arrow, an ink blot
      g.strokeStyle = "rgba(70,40,15,.28)"; g.lineWidth = 5; g.beginPath(); g.ellipse(300, 130, 34, 30, 0.2, 0, TAU); g.stroke();
      g.strokeStyle = "rgba(60,30,10,.5)"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(360, 700); g.bezierCurveTo(360, 690, 375, 686, 376, 698); g.bezierCurveTo(377, 686, 392, 690, 392, 700); g.bezierCurveTo(392, 712, 376, 720, 376, 724); g.bezierCurveTo(376, 720, 360, 712, 360, 700); g.stroke();
      g.beginPath(); g.moveTo(400, 300); g.lineTo(430, 270); g.moveTo(418, 270); g.lineTo(430, 270); g.lineTo(430, 282); g.stroke();
      g.beginPath(); g.moveTo(240, 560); g.lineTo(262, 548); g.lineTo(250, 570); g.closePath(); g.stroke();
      g.fillStyle = "rgba(30,50,120,.3)"; g.beginPath(); g.ellipse(390, 520, 12, 8, 0.6, 0, TAU); g.fill();
      for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(390 + rnd(-24, 24), 520 + rnd(-18, 18), rnd(1, 3.5), 0, TAU); g.fill(); }
      g.fillStyle = "rgba(20,12,6,.45)"; g.beginPath(); g.ellipse(160, 720, 9, 6, 0.3, 0, TAU); g.fill();
      for (let i = 0; i < 4000; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(240,205,165,.03)" : "rgba(14,7,3,.05)"; g.fillRect(Math.random() * W, Math.random() * H, 1, rnd(1, 2.5)); }
      return tex2d(c);
    }
    function deskRoughness() {
      const W = 256, H = 400, c = surface(W, H), g = c.getContext("2d");
      g.fillStyle = "#7a7a7a"; g.fillRect(0, 0, W, H);
      for (let k = 0; k < 6; k++) { const px = rnd(20, W - 20), py = rnd(30, H - 30), r = rnd(24, 50); const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, "rgba(72,72,72,.5)"); gr.addColorStop(1, "rgba(40,40,40,0)"); g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2); }
      for (let i = 0; i < 100; i++) { g.strokeStyle = "rgba(" + (Math.random() < 0.5 ? "20,20,20" : "150,150,150") + "," + rnd(0.05, 0.2).toFixed(3) + ")"; g.lineWidth = rnd(1, 3); const y0 = Math.random() * H, amp = rnd(2, 10), freq = rnd(0.006, 0.02), ph = Math.random() * TAU; g.beginPath(); for (let x = 0; x <= W; x += 8) { const y = y0 + Math.sin(x * freq + ph) * amp; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
      return tex2d(c, false);
    }
    function envTexture() {
      const W = 512, H = 256, c = surface(W, H), g = c.getContext("2d");
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#d9d2c0"); sky.addColorStop(0.45, "#8c8778"); sky.addColorStop(0.62, "#4a463d"); sky.addColorStop(1, "#1c1a16");
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      function panel(cx, cy, rx, ry, col, a) { const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry)); grad.addColorStop(0, col); grad.addColorStop(1, "rgba(0,0,0,0)"); g.globalAlpha = a; g.save(); g.translate(cx, cy); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.fillStyle = grad; g.beginPath(); g.arc(0, 0, Math.max(rx, ry), 0, TAU); g.fill(); g.restore(); g.globalAlpha = 1; }
      panel(150, 50, 140, 60, "#ffffff", 0.9); panel(384, 70, 110, 50, "#dfe9ff", 0.6); panel(268, 26, 160, 40, "#fff6dc", 0.5);
      const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    function glowTexture(inner, outer) { const S = 128, c = surface(S, S), g = c.getContext("2d"); const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); grad.addColorStop(0, inner); grad.addColorStop(0.35, outer); grad.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = grad; g.fillRect(0, 0, S, S); return tex2d(c); }
    function ringTexture(col) { const S = 256, c = surface(S, S), g = c.getContext("2d"); g.clearRect(0, 0, S, S); g.strokeStyle = col; g.lineWidth = 9; g.shadowColor = col; g.shadowBlur = 18; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 18, 0, TAU); g.stroke(); return tex2d(c); }
    function arrowTexture() {
      const W = 512, H = 128, c = surface(W, H), g = c.getContext("2d"); g.clearRect(0, 0, W, H); const midY = H / 2, headX = W - 118;
      const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, "rgba(255,255,255,0)"); grad.addColorStop(0.12, "rgba(255,255,255,.55)"); grad.addColorStop(1, "rgba(255,255,255,1)");
      g.fillStyle = grad; g.beginPath(); g.moveTo(0, midY - 9); g.lineTo(headX, midY - 17); g.lineTo(headX, midY + 17); g.lineTo(0, midY + 9); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(W - 4, midY); g.lineTo(headX - 6, midY - 46); g.lineTo(headX - 6, midY + 46); g.closePath(); g.fill();
      return tex2d(c);
    }
    function dashTexture() { const W = 64, H = 16, c = surface(W, H), g = c.getContext("2d"); g.clearRect(0, 0, W, H); g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(4, H / 2 - 2.5, 34, 5); const t = tex2d(c); t.wrapS = THREE.RepeatWrapping; return t; }
    function spinTexture() {
      const S = 256, c = surface(S, S), g = c.getContext("2d"); g.clearRect(0, 0, S, S); g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 13; g.lineCap = "round"; g.shadowColor = "rgba(255,255,255,.8)"; g.shadowBlur = 14;
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 34, -0.35, Math.PI * 1.25); g.stroke();
      const ax = S / 2 + Math.cos(-0.35) * (S / 2 - 34), ay = S / 2 + Math.sin(-0.35) * (S / 2 - 34);
      g.fillStyle = "#fff"; g.beginPath(); g.moveTo(ax + 20, ay - 6); g.lineTo(ax - 16, ay - 22); g.lineTo(ax - 10, ay + 18); g.closePath(); g.fill();
      return tex2d(c);
    }
    /**
     * A pen's livery baked to a strip: v runs along the barrel (nib at the top),
     * u runs around it. Bands, a grip, the printed name, and for pencils the
     * alternating flats of a hexagonal body.
     */
    function liveryTexture(spec) {
      const W = 128, H = 1024, c = surface(W, H), g = c.getContext("2d"), P = spec.paint;
      g.fillStyle = P.body; g.fillRect(0, 0, W, H);
      if (spec.pencil) {   // six flats, alternating
        for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? P.alt : P.body; g.fillRect(Math.round(i * W / 6), 0, Math.ceil(W / 6), H); }
        if (P.dip) { g.fillStyle = P.dip; g.fillRect(0, H * 0.92, W, H * 0.08); }
      }
      if (P.metal) { const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, "#9aa3a8"); gr.addColorStop(0.35, "#eef2f4"); gr.addColorStop(0.6, "#b5bec3"); gr.addColorStop(1, "#8a9399"); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
      if (P.clear) { g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(W * 0.25, 0, W * 0.18, H); }
      if (P.grip) { g.fillStyle = P.grip.color; g.fillRect(0, H * P.grip.from, W, H * (P.grip.to - P.grip.from)); g.fillStyle = "rgba(0,0,0,.25)"; for (let y = H * P.grip.from; y < H * P.grip.to; y += 9) g.fillRect(0, y, W, 2); }
      if (P.bands) for (const b of P.bands) { g.fillStyle = b.color; g.fillRect(0, H * (b.at - b.w / 2), W, H * b.w); }
      if (P.text) {
        g.save(); g.translate(W * 0.5, H * 0.62); g.rotate(-Math.PI / 2);
        g.font = "bold 44px " + (spec.pencil ? "Georgia,serif" : STAMP); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = P.textColor || "#fff";
        g.fillText(P.text, 0, 0); g.restore();
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
    }

    // ===================================================================== //
    // 8. Scene: a school desk in a classroom                                //
    // ===================================================================== //
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x4a5344);
    scene.fog = new THREE.Fog(0x4a5344, 2.4, 5.5);
    scene.environment = envTexture();
    const camera = new THREE.PerspectiveCamera(46, ctx.width / Math.max(1, ctx.height), 0.05, 12);
    const camTarget = new THREE.Vector3(0, 0, 0), camBase = new THREE.Vector3();
    const CAM_TILT = 0.8, FIT_X = 0.94, FIT_Y = 0.56;
    const fitPts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { fitPts.push(new THREE.Vector3(sx * TABLE_HX, TABLE_TOP, sz * TABLE_HY)); fitPts.push(new THREE.Vector3(sx * TABLE_HX, TABLE_TOP - TABLE_THICK, sz * TABLE_HY)); }
    function fitCamera() {
      const VW = Math.max(1, ctx.width), VH = Math.max(1, ctx.height);
      camera.aspect = VW / VH; camera.clearViewOffset(); camera.updateProjectionMatrix();
      const q = new THREE.Vector3(); let dist = 1.2, cy = 0;
      for (let it = 0; it < 10; it++) {
        camera.position.set(0, Math.sin(CAM_TILT) * dist, Math.cos(CAM_TILT) * dist); camera.lookAt(camTarget); camera.updateMatrixWorld(true);
        let xm = 0, ymin = Infinity, ymax = -Infinity;
        for (const p of fitPts) { q.copy(p).project(camera); xm = Math.max(xm, Math.abs(q.x)); if (q.y < ymin) ymin = q.y; if (q.y > ymax) ymax = q.y; }
        cy = (ymin + ymax) / 2;
        const need = Math.max(xm / FIT_X, ((ymax - ymin) / 2) / FIT_Y);
        if (Math.abs(need - 1) < 0.002) break;
        dist = clamp(dist * need, 0.4, 4);
      }
      camBase.set(0, Math.sin(CAM_TILT) * dist, Math.cos(CAM_TILT) * dist); camera.position.copy(camBase); camera.lookAt(camTarget);
      // the desk sits in the lower part of the frame; the wall and the blackboard fill the top
      camera.setViewOffset(VW, VH, 0, -(cy + 0.4) * VH / 2, VW, VH);
    }
    fitCamera();
    scene.add(new THREE.HemisphereLight(0xfff2dc, 0x3a2e22, 0.7));
    const key = new THREE.DirectionalLight(0xfff4e0, 1.85); key.position.set(0.3, 1.2, 0.3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1; key.shadow.camera.far = 2.4; key.shadow.camera.left = -0.52; key.shadow.camera.right = 0.52; key.shadow.camera.top = 0.56; key.shadow.camera.bottom = -0.56; key.shadow.bias = -0.0011; key.shadow.radius = 2.4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 0.6); rim.position.set(-0.6, 0.5, -0.75); scene.add(rim);
    const farFill = new THREE.PointLight(0xffe0b0, 0.6, 1.8, 2); farFill.position.set(0.25, 0.3, -0.34); scene.add(farFill);
    const fallLight = new THREE.PointLight(0xffe2b8, 0, 0.75, 2); fallLight.visible = false; scene.add(fallLight);

    const deskGroup = new THREE.Group(); scene.add(deskGroup);
    const topMat = new THREE.MeshStandardMaterial({ map: deskTexture(), roughnessMap: deskRoughness(), roughness: 0.68, metalness: 0.03, envMapIntensity: 0.12 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x6b3f1c, roughness: 0.7, metalness: 0.03 });
    const topMesh = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HX * 2, TABLE_THICK, TABLE_HY * 2), [edgeMat, edgeMat, topMat, edgeMat, edgeMat, edgeMat]);
    topMesh.position.y = TABLE_TOP - TABLE_THICK / 2; topMesh.receiveShadow = true; deskGroup.add(topMesh);
    // a pencil groove along the far edge, the way school desks have
    (function groove() {
      const gm = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HX * 2 - 0.06, 0.004, 0.012), new THREE.MeshStandardMaterial({ color: 0x5a3416, roughness: 0.8 }));
      gm.position.set(0, TABLE_TOP - 0.0015, -(TABLE_HY - 0.03)); deskGroup.add(gm);
    })();
    (function frame() {
      const steel = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.7 });
      const ap = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HX * 2 - 0.02, 0.02, 0.02), steel); ap.position.set(0, TABLE_TOP - TABLE_THICK - 0.012, TABLE_HY - 0.03); deskGroup.add(ap);
      const ap2 = ap.clone(); ap2.position.z = -(TABLE_HY - 0.03); deskGroup.add(ap2);
      const legTop = TABLE_TOP - TABLE_THICK, legLen = legTop - FLOOR_Y;
      const legGeo = new THREE.CylinderGeometry(0.011, 0.011, legLen, 12);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(legGeo, steel); leg.position.set(sx * (TABLE_HX - 0.03), legTop - legLen / 2, sz * (TABLE_HY - 0.03)); leg.castShadow = true; deskGroup.add(leg); }
    })();
    (function floor() {
      // the tiled classroom floor: two tones of speckled beige, dark grout
      const T = 128, c = surface(T * 2, T * 2), g = c.getContext("2d");
      for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
        g.fillStyle = (tx + ty) % 2 ? "#c9bea6" : "#b5a98f"; g.fillRect(tx * T, ty * T, T, T);
        for (let i = 0; i < 700; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(60,50,40,.16)" : "rgba(255,255,255,.14)"; g.fillRect(tx * T + Math.random() * T, ty * T + Math.random() * T, rnd(1, 2.5), rnd(1, 2.5)); }
        g.strokeStyle = "#6a6358"; g.lineWidth = 2.5; g.strokeRect(tx * T + 1, ty * T + 1, T - 2, T - 2);
      }
      const t = tex2d(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(15, 15);
      const gm = new THREE.PlaneGeometry(4.5, 4.5); gm.rotateX(-Math.PI / 2);
      const f = new THREE.Mesh(gm, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0.02 })); f.position.y = FLOOR_Y; f.receiveShadow = true; scene.add(f);
    })();
    // ---- the classroom behind the desk: a green wall, the blackboard, the teacher's table with a note pinned to it
    const WALL_Z = -0.72;
    (function wall() {
      const c = surface(256, 256), g = c.getContext("2d"); g.fillStyle = "#57624f"; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 3000; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.05)"; g.fillRect(Math.random() * 256, Math.random() * 256, rnd(1, 3), rnd(1, 3)); }
      const t = tex2d(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 3);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.6), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 })); w.position.set(0, FLOOR_Y + 1.3, WALL_Z); w.receiveShadow = true; scene.add(w);
      const dado = new THREE.Mesh(new THREE.BoxGeometry(5, 0.09, 0.012), new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.9 })); dado.position.set(0, FLOOR_Y + 0.045, WALL_Z + 0.006); scene.add(dado);
    })();
    const BOARD_W = 1024, BOARD_H = 480;
    const boardC = surface(BOARD_W, BOARD_H), boardG = boardC.getContext("2d"), boardTex = tex2d(boardC);
    const noteC = surface(512, 176), noteG = noteC.getContext("2d"), noteTex = tex2d(noteC); noteTex.premultiplyAlpha = true;
    (function blackboard() {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.36, 0.03), new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.8 })); frame.position.set(0, 0.245, WALL_Z + 0.015); scene.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.3), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.95 })); face.position.set(0, 0.245, WALL_Z + 0.031); scene.add(face);
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.016, 0.05), new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.8 })); ledge.position.set(0, 0.066, WALL_Z + 0.04); scene.add(ledge);
      const chalkM = new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.9 });
      for (const [x, rot] of [[-0.06, 0.3], [0.02, -0.15], [0.1, 0.5]]) { const ck = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.036, 8), chalkM); ck.rotation.z = Math.PI / 2; ck.rotation.y = rot; ck.position.set(x, 0.0775, WALL_Z + 0.048); scene.add(ck); }
      const duster = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.018, 0.026), new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 })); duster.position.set(0.24, 0.083, WALL_Z + 0.048); scene.add(duster);
      // the teacher's table, and the note pinned to its front
      const tbl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.36, 0.16), new THREE.MeshStandardMaterial({ color: 0x8a5a2c, roughness: 0.75 })); tbl.position.set(0, FLOOR_Y + 0.18, WALL_Z + 0.09); tbl.castShadow = true; tbl.receiveShadow = true; scene.add(tbl);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.018, 0.18), new THREE.MeshStandardMaterial({ color: 0xa06a34, roughness: 0.7 })); top.position.set(0, FLOOR_Y + 0.365, WALL_Z + 0.09); scene.add(top);
      const note = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.069), new THREE.MeshBasicMaterial({ map: noteTex, transparent: true })); note.position.set(0, -0.055, WALL_Z + 0.1715); scene.add(note);
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc8402f, roughness: 0.4 })); pin.position.set(0, -0.026, WALL_Z + 0.175); scene.add(pin);
    })();

    // ===================================================================== //
    // 9. Pen meshes, one per livery                                         //
    // ===================================================================== //
    const meshCache = {};
    function buildPenMesh(spec) {
      const grp = new THREE.Group(), half = spec.L / 2, R = spec.r, P = spec.paint;
      const segs = spec.shape === "tri" ? 3 : spec.shape === "hex" ? 6 : 26;
      const bodyMat = new THREE.MeshStandardMaterial({ map: liveryTexture(spec), metalness: P.metal ? 0.9 : 0.05, roughness: P.metal ? 0.25 : (P.clear ? 0.25 : 0.5), envMapIntensity: P.metal ? 1.4 : 0.8, flatShading: segs < 10 });
      const capMat = new THREE.MeshStandardMaterial({ color: P.cap || P.body, metalness: P.metal ? 0.9 : 0.1, roughness: 0.35, envMapIntensity: 1 });
      const nibMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa0, metalness: 0.85, roughness: 0.35 });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.9 });
      const leadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6 });
      function part(mesh, cx) { mesh.rotation.z = Math.PI / 2; mesh.position.x = cx; mesh.castShadow = true; mesh.receiveShadow = true; grp.add(mesh); return mesh; }
      let x = -half;
      if (spec.pencil) {
        part(new THREE.Mesh(new THREE.ConeGeometry(R * 0.35, 0.006, 8), leadMat), x + 0.003); x += 0.005;
        part(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.35, R, 0.016, segs), woodMat), x + 0.008); x += 0.016;
        const barrelLen = spec.L - (x + half);
        const body = part(new THREE.Mesh(new THREE.CylinderGeometry(R, R, barrelLen, segs, 1), bodyMat), x + barrelLen / 2);
        body.rotation.z = -Math.PI / 2;   // livery runs nib-to-end
        return grp;
      }
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0009, 0.004, 10), nibMat), x + 0.002); x += 0.004;
      part(new THREE.Mesh(new THREE.ConeGeometry(R * 0.8, 0.013, segs), capMat), x + 0.0065); x += 0.013;
      const capLen = spec.L * (P.capLen || 0.26), capR = R * (P.capR || 1.04);
      const barrelLen = spec.L - (x + half) - capLen;
      const body = part(new THREE.Mesh(new THREE.CylinderGeometry(R, R, barrelLen, segs, 1), bodyMat), x + barrelLen / 2);
      body.rotation.z = -Math.PI / 2;
      x += barrelLen;
      const cap = part(new THREE.Mesh(new THREE.CylinderGeometry(capR, capR * 0.96, capLen, segs), capMat), x + capLen / 2);
      x += capLen;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(capR * 0.96, 16, 10, 0, TAU, 0, Math.PI / 2), capMat); dome.rotation.z = -Math.PI / 2; dome.position.x = x; grp.add(dome);
      const clipMat = P.clipMetal ? nibMat : capMat;
      const clip = new THREE.Mesh(new THREE.BoxGeometry(capLen * 0.85, 0.0012, 0.0035), clipMat); clip.position.set(cap.position.x - 0.001, capR + 0.0004, 0); clip.castShadow = true; grp.add(clip);
      return grp;
    }
    function penMesh(spec) { if (!meshCache[spec.id]) meshCache[spec.id] = buildPenMesh(spec); return meshCache[spec.id]; }
    function equip(pen, spec) {
      pen.setSpec(spec);
      if (pen.mesh) scene.remove(pen.mesh);
      pen.mesh = penMesh(spec); scene.add(pen.mesh);
      // two rivals with the same pen cannot share a mesh; give the second a copy
      if (pens.some((o) => o !== pen && o.mesh === pen.mesh)) { pen.mesh = buildPenMesh(spec); scene.add(pen.mesh); }
    }
    function makeRing(col) {
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: ringTexture(col), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
      m.scale.set(0.072, 1, 0.072); m.renderOrder = 2; scene.add(m); return m;
    }
    you.glow = makeRing("rgba(255,214,120,1)"); cpu.glow = makeRing("rgba(170,196,240,1)"); cpu.glow.material.opacity = 0.42;
    equip(you, PENS[STARTER]); equip(cpu, PENS.v5);

    // ===================================================================== //
    // 10. Aim guide, sparks, edge warning                                   //
    // ===================================================================== //
    const aim = new THREE.Group(); aim.visible = false; scene.add(aim);
    const AIM_Y = TABLE_TOP + 0.0016;
    function flatPlane(mat) { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(0.5, 0, 0); const m = new THREE.Mesh(g, mat); m.renderOrder = 5; return m; }
    const arrowMesh = flatPlane(new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })); aim.add(arrowMesh);
    const dashMat = new THREE.MeshBasicMaterial({ map: dashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0.5 });
    const dashMesh = flatPlane(dashMat); aim.add(dashMesh);
    const flatQuad = () => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; };
    const grabDot = new THREE.Mesh(flatQuad(), new THREE.MeshBasicMaterial({ map: glowTexture("rgba(255,255,240,1)", "rgba(255,220,120,.75)"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    grabDot.scale.set(0.03, 1, 0.03); grabDot.renderOrder = 6; aim.add(grabDot);
    const spinMesh = new THREE.Mesh(flatQuad(), new THREE.MeshBasicMaterial({ map: spinTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 }));
    spinMesh.scale.set(0.05, 1, 0.05); spinMesh.renderOrder = 6; aim.add(spinMesh);
    const sparkTex = glowTexture("rgba(255,246,214,1)", "rgba(255,200,120,.6)"), sparks = [];
    for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(flatQuad(), new THREE.MeshBasicMaterial({ map: sparkTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })); m.renderOrder = 7; m.visible = false; scene.add(m); sparks.push({ mesh: m, life: 0, vx: 0, vy: 0 }); }
    function sparkAt(p, power) {
      let n = Math.round(3 + power * 7);
      for (const s of sparks) { if (n <= 0) break; if (s.life > 0) continue; n--; s.life = 1; const ang = Math.random() * TAU, sp = rnd(0.12, 0.5) * (0.4 + power); s.vx = Math.cos(ang) * sp; s.vy = Math.sin(ang) * sp; s.mesh.position.set(p.x, TABLE_TOP + 0.002, -p.y); s.mesh.scale.set(0.016, 1, 0.016); s.mesh.visible = true; }
    }
    function stepSparks(dt) {
      for (const s of sparks) { if (s.life <= 0) continue; s.life -= dt * 2.6; if (s.life <= 0) { s.mesh.visible = false; s.mesh.material.opacity = 0; continue; } s.mesh.position.x += s.vx * dt; s.mesh.position.z -= s.vy * dt; s.vx *= 0.9; s.vy *= 0.9; s.mesh.material.opacity = s.life * 0.85; const sc = 0.014 + (1 - s.life) * 0.03; s.mesh.scale.set(sc, 1, sc); }
    }
    const edgeGlowMat = new THREE.MeshBasicMaterial({ map: glowTexture("rgba(255,120,80,.9)", "rgba(255,90,50,.35)"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    const edgeGlow = new THREE.Mesh(flatQuad(), edgeGlowMat); edgeGlow.renderOrder = 3; scene.add(edgeGlow);

    // ===================================================================== //
    // 11. Save data, the tin, the bench                                     //
    // ===================================================================== //
    const save = { tin: [STARTER], beaten: [], lost: {}, champion: false, matches: 0, wins: 0, bestStreak: 0, plays: 0 };
    async function loadSave() {
      if (!ctx.capabilities.storage) return;
      try { let s = ctx.storage.get("pf2"); if (s && typeof s.then === "function") s = await s; if (s && Array.isArray(s.tin)) Object.assign(save, s); if (!save.tin.length) save.tin = [STARTER]; } catch (_) {}
      try { let m = ctx.storage.get("pf2mute"); if (m && typeof m.then === "function") m = await m; muted = !!m; applyMute(); } catch (_) {}
    }
    function persist() { if (!ctx.capabilities.storage) return; try { ctx.storage.set("pf2", save); } catch (_) {} }
    const nextRival = () => { for (let i = 0; i < BENCH.length; i++) if (!save.beaten.includes(i)) return i; return -1; };
    const penHeld = (id) => save.tin.includes(id);
    let submittedTin = -1, submittedBench = -1, submittedStreak = -1;
    async function submitRecords() {
      try {
        if (save.tin.length > submittedTin) { submittedTin = save.tin.length; await ctx.memory.record("tin").submit(save.tin.length, { label: save.tin.length + (save.tin.length === 1 ? " pen" : " pens") }); }
        if (save.beaten.length > submittedBench) { submittedBench = save.beaten.length; await ctx.memory.record("bench").submit(save.beaten.length, { label: save.beaten.length + " of " + BENCH.length }); }
        if (save.bestStreak > submittedStreak) { submittedStreak = save.bestStreak; await ctx.memory.record("win_streak").submit(save.bestStreak, { label: save.bestStreak + (save.bestStreak === 1 ? " round" : " rounds") }); }
      } catch (_) {}
    }

    // ===================================================================== //
    // 12. Pages, the board and the slips                                    //
    // ===================================================================== //
    let screen = "home";
    function showPage(html, quiet) { elInner.innerHTML = html; elPage.classList.add("show"); elPage.scrollTop = 0; if (!quiet) sfxPaper(); }
    function hidePage() { elPage.classList.remove("show"); }
    function on(sel, fn) { elInner.querySelectorAll(sel).forEach((el) => ctx.listen(el, "pointerdown", (e) => { if (e.cancelable) e.preventDefault(); firstTouch(); fn(el, e); })); }
    const swatch = (spec) => '<span class="swatch" style="background:linear-gradient(90deg,' + (spec.paint.cap || spec.paint.body) + ' 0 26%,' + spec.paint.body + ' 26%)"></span>';
    const penLine = (id) => { const s = PENS[id]; return swatch(s) + esc(s.name); };
    let slipSeq = 0;
    function slip(html, ms) {
      const seq = ++slipSeq; elSlip.innerHTML = html; elSlip.classList.add("show"); sfxPaper();
      if (ms) ctx.timeout(() => { if (seq === slipSeq) elSlip.classList.remove("show"); }, ms);
    }
    function hideSlip() { slipSeq++; elSlip.classList.remove("show"); }
    function hint(text) { elHint.textContent = text || ""; elHint.style.opacity = text ? "1" : "0"; }
    const TARGET = 3;
    let scoreYou = 0, scoreCpu = 0, streak = 0;
    let names = { you: "you", cpu: "rival" };
    let roundLog = [];   // "w" / "l" per finished round, from your side
    let noteText = "";
    function chalk(txt, x, y, size, align, alpha) {
      const g = boardG; g.font = size + "px " + HAND; g.textAlign = align || "left"; g.textBaseline = "alphabetic";
      g.fillStyle = "rgba(243,237,224," + (alpha == null ? 0.9 : alpha) + ")"; g.shadowColor = "rgba(243,237,224,.35)"; g.shadowBlur = 2; g.fillText(txt, x, y); g.shadowBlur = 0;
    }
    function chalkLine(x0, y0, x1, y1, w, alpha) { const g = boardG; g.strokeStyle = "rgba(243,237,224," + (alpha == null ? 0.8 : alpha) + ")"; g.lineWidth = w || 2; g.lineCap = "round"; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    function drawBoard(turn) {
      const g = boardG, W = BOARD_W, H = BOARD_H;
      const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#2f3f36"); bg.addColorStop(1, "#243329"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // old chalk smears from the duster
      for (let k = 0; k < 14; k++) { const x = (k * 173) % W, y = (k * 97) % H, r = 60 + (k * 37) % 90; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(220,220,210,.07)"); gr.addColorStop(1, "rgba(220,220,210,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
      chalk("Std. 9 - A", 36, 62, 26); chalk("Sub : Maths", 36, 98, 24, "left", 0.8);
      chalk("Thought for the Day :", 500, 64, 26, "center"); chalk('" Practice makes a man perfect "', 500, 102, 26, "center", 0.85);
      chalk("PEN FIGHT", 36, 196, 44); chalkLine(36, 206, 268, 208, 3, 0.7); chalk("36", 292, 186, 20, "left", 0.45);
      chalk("best of 5", 36, 236, 20, "left", 0.65); chalk("3 = 120", 150, 236, 18, "left", 0.35); chalkLine(36, 244, 210, 246, 1.5, 0.35);
      const n1 = names.you, n2 = names.cpu;
      chalk(n1, 60, 296, 32); chalk(String(scoreYou), 400, 298, 40, "center");
      chalk(n2, 60, 352, 32); chalk(String(scoreCpu), 400, 354, 40, "center");
      if (turn === "you") chalk(">", 30, 294, 30, "left", 0.9); else if (turn === "cpu") chalk(">", 30, 350, 30, "left", 0.9);
      // a sun doodle by the bottom name
      const g2 = g; g2.strokeStyle = "rgba(243,237,224,.7)"; g2.lineWidth = 2; g2.beginPath(); g2.arc(22, 400, 9, 0, TAU); g2.stroke();
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; chalkLine(22 + Math.cos(a) * 13, 400 + Math.sin(a) * 13, 22 + Math.cos(a) * 18, 400 + Math.sin(a) * 18, 2, 0.7); }
      // the five round boxes: a tick for a round you won, a cross for one you dropped
      for (let i = 0; i < TARGET * 2 - 1; i++) {
        const x = 462 + i * 34, y = 318; g.strokeStyle = "rgba(243,237,224,.85)"; g.lineWidth = 2.5; g.strokeRect(x, y - 13, 26, 26);
        const r = roundLog[i];
        if (r === "w") { chalkLine(x + 5, y + 1, x + 11, y + 8, 3); chalkLine(x + 11, y + 8, x + 22, y - 8, 3); }
        else if (r === "l") { chalkLine(x + 5, y - 8, x + 21, y + 8, 3); chalkLine(x + 21, y - 8, x + 5, y + 8, 3); }
      }
      // geometry left over from the last period
      chalkLine(560, 268, 700, 268, 2, 0.55); chalkLine(560, 268, 630, 178, 2, 0.55); chalkLine(630, 178, 700, 268, 2, 0.55);
      g.setLineDash([6, 6]); chalkLine(630, 178, 630, 268, 1.5, 0.4); g.setLineDash([]);
      g.strokeStyle = "rgba(243,237,224,.6)"; g.lineWidth = 2; g.beginPath(); g.moveTo(640, 400); g.bezierCurveTo(640, 388, 656, 384, 658, 396); g.bezierCurveTo(660, 384, 676, 388, 676, 400); g.bezierCurveTo(676, 412, 658, 420, 658, 424); g.bezierCurveTo(658, 420, 640, 412, 640, 400); g.stroke();
      // the homework column
      chalkLine(742, 150, 744, 456, 2.5, 0.75);
      chalk("H.W.", 770, 196, 30); chalkLine(770, 206, 830, 207, 2.5, 0.7);
      chalk("Ch. 4  Q. 1 - 5", 770, 240, 24, "left", 0.85); chalk("Map of India", 770, 278, 24, "left", 0.85);
      chalk("Essay - rain", 770, 316, 24, "left", 0.7); chalkLine(766, 308, 910, 306, 2.5, 0.75);
      chalk("Monitor : Pinky", 770, 446, 19, "left", 0.55);
      boardTex.needsUpdate = true;
    }
    function drawNote(text) {
      const g = noteG, W = 512, H = 176; g.clearRect(0, 0, W, H);
      if (!text) { noteTex.needsUpdate = true; return; }
      // a torn strip of ruled paper
      g.fillStyle = "#f3eee0"; g.beginPath(); g.moveTo(0, 14);
      for (let x = 0; x <= W; x += 24) g.lineTo(x + 12, x % 48 ? 4 : 16);
      g.lineTo(W, H - 14); for (let x = W; x >= 0; x -= 24) g.lineTo(x - 12, x % 48 ? H - 4 : H - 16); g.closePath(); g.fill();
      g.strokeStyle = "rgba(96,126,190,.35)"; g.lineWidth = 2; for (let y = 52; y < H - 20; y += 40) { g.beginPath(); g.moveTo(12, y); g.lineTo(W - 12, y); g.stroke(); }
      const bang = text.startsWith("!");
      g.font = "62px " + HAND; g.textAlign = "center"; g.textBaseline = "middle";
      const body = bang ? text.slice(1).trim() : text;
      g.fillStyle = INK; g.fillText(body, W / 2 + (bang ? 22 : 0), H / 2 + 4);
      if (bang) { const tw = g.measureText(body).width; g.fillStyle = RED; g.font = "70px " + HAND; g.fillText("!", W / 2 + 22 - tw / 2 - 40, H / 2 + 2); }
      noteTex.needsUpdate = true;
    }
    function renderBoard(note, turn) {
      drawBoard(turn);
      const mp = screen === "match" && (scoreYou === TARGET - 1 || scoreCpu === TARGET - 1) && !(scoreYou >= TARGET || scoreCpu >= TARGET);
      noteText = note || (mp ? "! match point" : "");
      drawNote(mp && note ? "! match point" : noteText);
    }

    // A pen drawn flat, as inline SVG, from the same paint the 3D livery uses. Cap on the left, nib on the right.
    let svgSeq = 0;
    function penSVG(spec, w, h, opts) {
      opts = opts || {}; const P = spec.paint, dark = !!opts.dark, flat = opts.flat;
      const id = "pg" + (svgSeq++);
      const x0 = w * 0.03, nibL = w * 0.065, L = w * 0.86, cy = h / 2, r = Math.min(h * 0.27, w * 0.036), d = r * 2;
      const col = (c, dk) => flat ? flat : dark ? dk : c;
      const body = col(P.body, "#2c2c2f"), cap = col(P.cap || P.body, "#212124"), tc = col(P.textColor || "#333", "#3d3d41");
      let g = "";
      if (spec.pencil) {
        g += '<polygon points="' + (x0 + L) + ',' + (cy - r) + ' ' + (x0 + L + nibL * 1.7) + ',' + cy + ' ' + (x0 + L) + ',' + (cy + r) + '" fill="' + col("#dcbf8e", "#3a3a3d") + '"/>';
        g += '<polygon points="' + (x0 + L + nibL * 1.15) + ',' + (cy - r * 0.32) + ' ' + (x0 + L + nibL * 1.7) + ',' + cy + ' ' + (x0 + L + nibL * 1.15) + ',' + (cy + r * 0.32) + '" fill="' + col("#26262a", "#2a2a2d") + '"/>';
      } else {
        g += '<polygon points="' + (x0 + L) + ',' + (cy - r * 0.78) + ' ' + (x0 + L + nibL) + ',' + (cy - r * 0.2) + ' ' + (x0 + L + nibL + 1.5) + ',' + cy + ' ' + (x0 + L + nibL) + ',' + (cy + r * 0.2) + ' ' + (x0 + L) + ',' + (cy + r * 0.78) + '" fill="' + col("#b5b9bf", "#36363a") + '"/>';
      }
      g += '<rect x="' + x0 + '" y="' + (cy - r) + '" width="' + L + '" height="' + d + '" rx="' + (spec.pencil ? r * 0.3 : r) + '" fill="' + body + '"/>';
      if (spec.pencil && P.alt && !dark && !flat) g += '<rect x="' + x0 + '" y="' + (cy - r * 0.22) + '" width="' + L + '" height="' + (r * 0.44) + '" fill="' + P.alt + '"/>';
      if (P.grip && !flat) g += '<rect x="' + (x0 + L * (1 - P.grip.to)) + '" y="' + (cy - r * 1.04) + '" width="' + (L * (P.grip.to - P.grip.from)) + '" height="' + (d * 1.04) + '" rx="' + (r * 0.45) + '" fill="' + col(P.grip.color, "#242426") + '"/>';
      if (P.bands && !flat) for (const b of P.bands) g += '<rect x="' + (x0 + L * (1 - b.at) - L * b.w / 2) + '" y="' + (cy - r) + '" width="' + Math.max(2, L * b.w) + '" height="' + d + '" fill="' + col(b.color, "#3a3a3e") + '"/>';
      const capLen = L * (P.capLen ? Math.min(P.capLen, 0.5) : 0.28), capR = r * (P.capR || 1.08);
      if (!spec.pencil) {
        g += '<rect x="' + (x0 - 1) + '" y="' + (cy - capR) + '" width="' + capLen + '" height="' + (capR * 2) + '" rx="' + capR + '" fill="' + cap + '"/>';
        g += '<rect x="' + (x0 + capLen * 0.3) + '" y="' + (cy - capR - r * 0.5) + '" width="' + (capLen * 0.62) + '" height="' + (r * 0.55) + '" rx="' + (r * 0.25) + '" fill="' + col(P.clipMetal ? "#c9ced4" : (P.cap || P.body), "#2a2a2d") + '" stroke="rgba(0,0,0,.28)" stroke-width=".6"/>';
      } else if (P.dip) g += '<rect x="' + (x0 - 1) + '" y="' + (cy - r) + '" width="' + (L * 0.07) + '" height="' + d + '" rx="' + (r * 0.3) + '" fill="' + col(P.dip, "#212124") + '"/>';
      if (P.text && !flat) {
        const tx0 = x0 + (spec.pencil ? L * 0.1 : capLen) + L * 0.04, tx1 = x0 + L * (1 - (P.grip ? P.grip.to : 0.14));
        const fs = Math.min(h * 0.36, (tx1 - tx0) / Math.max(6, P.text.length) * 1.75);
        g += '<text x="' + ((tx0 + tx1) / 2) + '" y="' + (cy + fs * 0.34) + '" text-anchor="middle" font-family="' + STAMP.replace(/"/g, "'") + '" font-size="' + fs + '" letter-spacing="' + (fs * 0.05) + '" fill="' + tc + '" opacity=".92">' + esc(P.text) + '</text>';
      }
      if (!flat) g += '<rect x="' + (x0 - 1) + '" y="' + (cy - capR) + '" width="' + (L + nibL * 1.7 + 2) + '" height="' + (capR * 2) + '" rx="' + capR + '" fill="url(#' + id + ')"/>';
      const style = opts.fluid ? "width:100%;height:auto;display:block;overflow:visible" : "width:" + w + "px;height:" + h + "px;display:block;overflow:visible";
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" style="' + style + (opts.rot ? ";transform:rotate(" + opts.rot + "deg)" : "") + '"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient></defs>' + g + '</svg>';
    }
    const HOWTO = '<div class="howto">' +
      '<div class="hp" style="top:20px">' + penSVG(PENS.v5, 260, 32, { fluid: true, rot: 2 }) + '</div>' +
      '<div class="hp" style="top:64px">' + penSVG(PENS.r045, 260, 32, { fluid: true, rot: -3 }) + '</div>' +
      '<div class="pull" style="left:64%;top:80px;transform:rotate(38deg)"></div>' +
      '<div class="ring" style="left:59%;top:67px"></div></div>';
    const HDR = '<div class="hdr">' + penSVG(PENS.parker, 46, 12, { flat: INK }) + '<span>PEN FIGHT</span>' + penSVG(PENS.racer, 34, 10, { flat: RED, rot: 30 }) + '</div>';

    function homePage() {
      screen = "home"; hint(""); hideSlip();
      const n = nextRival(), done = save.beaten.length;
      let dots = ''; for (let k = 0; k < BENCH.length; k++) dots += '<span class="dot' + (save.beaten.includes(k) ? ' done' : k === n ? ' now' : '') + '"></span>';
      dots += '<span class="dot cup">&#127942;</span>';
      showPage('<div class="sheet plain">' + HDR +
        '<h1 class="hand">pick your fight</h1>' +
        '<div class="card"><div class="tape"></div>' +
          '<div class="rowb"><div class="label">solo</div><div class="counter"><b>' + done + '</b>/' + BENCH.length + '<small>beaten</small></div></div>' +
          '<div class="ttl">class championship</div><p>Beat ' + BENCH.length + ' rivals. Win the Trimax.</p>' +
          '<div class="prize">' + penSVG(PENS.trimax, 170, 36, { rot: -3 }) + '<div class="pr"><div class="label">the prize</div>' + esc(PENS.trimax.name) + '</div></div>' +
          '<div class="dots">' + dots + '</div>' +
          '<div class="btn" data-go="solo">' + (n < 0 ? 'play the bench again' : done ? 'continue solo' : 'start solo') + '</div>' +
        '</div>' +
        '<div class="sec">play with people</div>' +
        '<div class="mode" data-go="friends"><div class="ico">&#128101;</div><div><div class="mt">local <span class="badge">pass &amp; play</span></div><div class="ms">2 players &middot; one screen</div></div><div class="arr">&rarr;</div></div>' +
        '<div class="sec">your things</div>' +
        '<div class="mode" data-go="tin"><div class="ico">&#129520;</div><div><div class="mt">the tin</div><div class="ms">' + save.tin.length + (save.tin.length === 1 ? ' pen' : ' pens') + (save.champion ? ' &middot; champion of the class' : '') + '</div></div><div class="arr">&rarr;</div></div>' +
        '<div class="mode" data-go="bench"><div class="ico">&#127891;</div><div><div class="mt">the bench</div><div class="ms">' + done + ' of ' + BENCH.length + ' beaten</div></div><div class="arr">&rarr;</div></div>' +
        '<p class="quiet ctr" style="margin-top:14px">pull your pen back and let go. knock theirs off the desk. keep it.</p>' +
        '</div>');
      on("[data-go]", (el) => { const go = el.getAttribute("data-go"); if (go === "solo") { const k = nextRival(); if (k >= 0) stakePage(k); else benchPage(); } else if (go === "bench") benchPage(); else if (go === "friends") friendsPickPage(1); else tinPage(); });
    }
    function benchPage() {
      screen = "bench";
      const n = nextRival();
      let html = '<div class="sheet"><div class="back" data-go="home">&lsaquo;</div><h2 style="margin-top:6px">the bench</h2>';
      if (n < 0) html += '<p class="ctr">every pen on the bench is in your tin. play anyone again for the walk over.</p>';
      else html += '<p class="ctr">one at a time, in order. the winner keeps the pen.</p>';
      BENCH.forEach((r, i) => {
        const beaten = save.beaten.includes(i), isNext = i === n, locked = !beaten && !isNext;
        const held = save.lost[i] ? ' &middot; holds your ' + esc(PENS[save.lost[i]].short) : '';
        html += '<div class="chit"' + (locked ? ' style="opacity:.55"' : (locked ? '' : ' data-fight="' + i + '"')) + (locked ? '' : ' style="cursor:pointer;pointer-events:auto"') + '>' +
          '<div class="state ' + (beaten ? "beaten" : isNext ? "next" : "locked") + '">' + (beaten ? "beaten" : isNext ? "next" : "#" + (i + 1)) + '</div>' +
          '<div class="who">' + esc(r.name) + '<small>' + esc(r.section) + '</small></div>' +
          '<div class="pen">plays for the ' + esc(PENS[r.pen].name) + held + '</div>' +
          '<div class="intro">' + esc(r.intro) + '</div></div>';
      });
      html += '</div>';
      showPage(html);
      on("[data-go]", () => homePage());
      on("[data-fight]", (el) => stakePage(parseInt(el.getAttribute("data-fight"), 10)));
    }
    function stakePage(i) {
      screen = "pick"; const r = BENCH[i], beaten = save.beaten.includes(i);
      let chosen = (save.lastWon && penHeld(save.lastWon)) ? save.lastWon : save.tin[0];
      let first = true;
      const render = () => {
        const mine = PENS[chosen], theirs = PENS[r.pen];
        let sq = ''; for (let k = 0; k < BENCH.length; k++) sq += '<span class="' + (save.beaten.includes(k) ? 'done' : k === i ? 'now' : '') + '"></span>';
        showPage('<div class="sheet"><div class="back" data-go="bench">&lsaquo;</div>' +
          '<h2 style="margin-top:6px">best of 5</h2>' +
          '<div class="label ctr">classmate ' + (i + 1) + ' of ' + BENCH.length + '</div><div class="sq">' + sq + '</div>' +
          '<div class="vs"><div class="side"><div class="nm">you</div><div class="pic" data-go="cycle">' + penSVG(mine, 150, 38, { rot: -8 }) + '</div><div class="pn">' + esc(mine.name) + '</div>' + (save.tin.length > 1 ? '<div class="quiet" style="font-size:14px">tap the pen to change</div>' : '') + '</div>' +
          '<div class="v">VS</div>' +
          '<div class="side"><div class="nm">' + esc(r.name) + '</div><div class="pic">' + penSVG(theirs, 150, 38, { rot: 8 }) + '</div><div class="pn">' + esc(theirs.name) + '</div></div></div>' +
          '<p class="ctr">' + esc(r.intro) + '</p>' +
          (beaten ? '<div class="line"><span>a friendly</span><span>nothing at stake</span></div>' : '<div class="line"><span>take their pen</span><b>+20</b></div>') +
          '<h2>how to play</h2>' + HOWTO +
          '<p class="ctr">pull it back, then let go.</p><p class="ctr quiet">the further you pull, the further it goes.</p>' +
          '<div class="btn" data-go="fight">start</div></div>', !first);
        first = false;
        on("[data-go]", (el) => { const go = el.getAttribute("data-go"); if (go === "bench") benchPage(); else if (go === "cycle") { if (save.tin.length < 2) return; const k = save.tin.indexOf(chosen); chosen = save.tin[(k + 1) % save.tin.length]; sfxPaper(); render(); } else startBenchMatch(i, chosen); });
      };
      render();
    }
    const STENCIL_PENS = penSVG(PENS.parker, 150, 18, { flat: "#1e2a4a" }) + '<div style="height:6px"></div>' + penSVG(PENS.racer, 80, 12, { flat: "#8a2a1e", rot: -25 });
    function tinPage(justWon) {
      screen = "tin";
      let slots = '';
      for (const id in PENS) { const held = penHeld(id); slots += '<div class="slot">' + penSVG(PENS[id], 320, 24, { dark: !held, fluid: true }) + '</div>'; }
      const lid = '<div class="lid"><div class="rust" style="left:-20px;top:-14px;width:130px;height:70px"></div><div class="rust" style="right:-16px;bottom:8px;width:110px;height:56px"></div><div class="stencil">PEN FIGHT</div><div class="lidpens">' + STENCIL_PENS + '</div></div>';
      let paper;
      if (justWon) {
        const w = PENS[justWon.pen];
        paper = '<div class="sheet plain ctr"><div class="tag">just won</div><h2 style="font-size:30px;margin:14px 0 4px;letter-spacing:.1em">' + esc(w.name) + '</h2>' +
          '<p class="label ink">won from: ' + esc(justWon.from) + '</p><p class="label">playing this next match</p>' +
          '<div class="btn ghost" data-go="next">shut the box</div></div>';
      } else {
        const out = Object.keys(PENS).filter((id) => !penHeld(id));
        let list = '';
        for (const id of save.tin) { const s = PENS[id]; list += '<p style="margin:2px 0">' + esc(s.name) + ' <span class="quiet">&middot; ' + Math.round(s.dens * s.r * s.r * s.L * 1000 * 10) / 10 + ' g &middot; ' + esc(s.flavour) + '</span></p>'; }
        let outList = '';
        if (out.length) { outList = '<p class="label ink" style="margin-top:12px">still out there</p>'; for (const id of out) { const s = PENS[id]; const holder = BENCH.find((r) => r.pen === id); const lostTo = Object.keys(save.lost).find((k) => save.lost[k] === id); outList += '<p style="margin:2px 0" class="quiet">' + esc(s.name) + ' &middot; ' + (lostTo != null ? 'lost to ' + esc(BENCH[lostTo].name) : holder ? esc(holder.name) + ' has it' : 'lost and found') + '</p>'; } }
        paper = '<div class="sheet plain ctr"><div class="label ink">' + save.tin.length + ' in the tin</div>' + list + outList + '<div class="btn ghost" data-go="home">shut the box</div></div>';
      }
      showPage('<div class="tin">' + lid + '<div class="hinge"></div><div class="base">' + slots + '</div></div>' + paper);
      on("[data-go]", (el) => { const go = el.getAttribute("data-go"); if (go === "next") { const k = nextRival(); if (k >= 0) stakePage(k); else homePage(); } else homePage(); });
    }
    let friendPens = { you: STARTER, cpu: "v5" };
    function friendsPickPage(who) {
      screen = "pick";
      let html = '<div class="sheet"><div class="back" data-go="home">&lsaquo;</div><h2 style="margin-top:6px">' + (who === 1 ? "player one" : "player two") + '</h2>' +
        '<p class="ctr">' + (who === 1 ? "you flick from the near edge." : "you flick from the far edge. pass the phone after each flick.") + ' pick a pen.</p>';
      const ids = Object.keys(PENS);
      ids.forEach((id, k) => { const s = PENS[id]; html += '<div class="chit pick' + (k === 0 ? ' sel' : '') + '" data-pen="' + id + '">' + penSVG(s, 110, 26, {}) + '<div><div class="who" style="font-size:20px">' + esc(s.name) + '</div><div class="intro">' + esc(s.flavour) + '</div></div></div>'; });
      html += '<div class="btn" data-go="next">' + (who === 1 ? "next: player two" : "fight") + '</div></div>';
      showPage(html);
      let chosen = ids[0];
      on(".chit.pick", (el) => { elInner.querySelectorAll(".chit.pick").forEach((c) => c.classList.remove("sel")); el.classList.add("sel"); chosen = el.getAttribute("data-pen"); sfxPaper(); });
      on("[data-go]", (el) => { if (el.getAttribute("data-go") === "home") return homePage(); if (who === 1) { friendPens.you = chosen; friendsPickPage(2); } else { friendPens.cpu = chosen; startFriendsMatch(); } });
    }

    // ===================================================================== //
    // 13. Input                                                             //
    // ===================================================================== //
    const raycaster = new THREE.Raycaster(), planeMath = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_TOP), ndc = new THREE.Vector2(), hitPoint = new THREE.Vector3();
    function screenToPlane(clientX, clientY) {
      ndc.x = (clientX / Math.max(1, ctx.width)) * 2 - 1; ndc.y = -(clientY / Math.max(1, ctx.height)) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(planeMath, hitPoint)) return null;
      return { x: hitPoint.x, y: -hitPoint.z };
    }
    const MAX_DRAG = 0.135, GRAB_R = 0.05;
    let drag = null, current = you;   // whose flick it is
    function nearestOnPen(p, q) { const dx = q.x - p.x, dy = q.y - p.y, s = clamp(dx * p.ax + dy * p.ay, -p.L / 2, p.L / 2), pt = p.pointAt(s); return { s, pt, dist: Math.hypot(q.x - pt.x, q.y - pt.y) }; }
    let started = false;
    function firstTouch() {
      if (!started) { started = true; try { ctx.platform.start(); } catch (_) {} }
      buildAudio(); if (ac && ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
    }
    function onDown(e) {
      firstTouch();
      if (state !== "aim" || elPage.classList.contains("show")) return;
      const q = screenToPlane(e.clientX, e.clientY); if (!q) return;
      const near = nearestOnPen(current, q);
      if (near.dist > GRAB_R) { hint(current === you ? "touch your pen to flick it" : "touch the far pen to flick it"); return; }
      drag = { s: near.s, grab: near.pt, dir: { x: 0, y: 0 }, power: 0, lastQ: q, lastT: performance.now(), swipe: 0 };
      aim.visible = true; hint("pull back. the further you pull, the further it goes");
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic("light"); } catch (_) {} }
    }
    function onMove(e) {
      if (!drag) return; const q = screenToPlane(e.clientX, e.clientY); if (!q) return; if (e.cancelable) e.preventDefault();
      const dx = q.x - drag.grab.x, dy = q.y - drag.grab.y, len = Math.hypot(dx, dy);
      if (len > 1e-5) drag.dir = { x: -dx / len, y: -dy / len };   // a catapult: pull back, it goes the other way
      drag.power = clamp(len / MAX_DRAG, 0, 1);
      const now = performance.now(), dt = Math.max(1, now - drag.lastT) / 1000, sp = Math.hypot(q.x - drag.lastQ.x, q.y - drag.lastQ.y) / dt;
      drag.swipe = Math.max(drag.swipe * 0.86, clamp(sp / 3.2, 0, 1)); drag.lastQ = q; drag.lastT = now;
      updateAimVisual();
    }
    function onUp() {
      if (!drag) return;
      const power = clamp(Math.max(drag.power, drag.swipe * 0.92), 0, 1), d = drag; drag = null; aim.visible = false;
      if (power < 0.06 || (d.dir.x === 0 && d.dir.y === 0)) { hint(HINT_AIM); return; }
      flick(current, d.grab, d.dir, power);
      state = "sim"; settleT = 0; fellThisTurn = null; hint(""); renderBoard("", null);
    }
    function flick(pen, at, dir, power) {
      const j = flickJ(pen, power); pen.impulseAt(at, dir.x * j, dir.y * j); sfxFlick(power);
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic(power > 0.7 ? "heavy" : power > 0.35 ? "medium" : "light"); } catch (_) {} }
      try { ctx.platform.interact({ kind: "flick", side: pen.side, power: Math.round(power * 100) / 100 }); } catch (_) {}
    }
    function updateAimVisual() {
      if (!drag) return; const p = drag.power, gx = drag.grab.x, gz = -drag.grab.y, ang = Math.atan2(drag.dir.y, drag.dir.x);
      grabDot.position.set(gx, AIM_Y, gz); const dotS = 0.026 + p * 0.014; grabDot.scale.set(dotS, 1, dotS);
      arrowMesh.position.set(gx, AIM_Y, gz); arrowMesh.rotation.y = ang; arrowMesh.scale.set(0.045 + p * 0.115, 1, 0.026 + p * 0.016); arrowMesh.material.opacity = 0.55 + p * 0.45;
      const v = V_MAX * p * Math.sqrt(REF_MASS / current.m), travel = (v * v) / (2 * current.mu * G);
      dashMesh.position.set(gx, AIM_Y - 0.0002, gz); dashMesh.rotation.y = ang; dashMesh.scale.set(Math.min(travel, 0.75), 1, 0.012); dashMat.map.repeat.x = Math.max(1, Math.min(travel, 0.75) / 0.026); dashMat.opacity = 0.16 + p * 0.34;
      const torque = drag.s * (drag.dir.y * Math.cos(current.a) - drag.dir.x * Math.sin(current.a)), wPred = Math.abs(torque * flickJ(current, p) / current.I * SPIN_TRANSFER), spinAmt = clamp(wPred / 26, 0, 1);
      spinMesh.material.opacity = spinAmt * 0.85; spinMesh.position.set(gx, AIM_Y + 0.0004, gz); const ss = 0.03 + spinAmt * 0.03; spinMesh.scale.set(ss, 1, ss); spinMesh.rotation.y = torque > 0 ? 0 : Math.PI;
    }
    ctx.listen(canvas, "pointerdown", onDown);
    ctx.listen(window, "pointermove", onMove, { passive: false });
    ctx.listen(window, "pointerup", onUp); ctx.listen(window, "pointercancel", onUp);
    ctx.listen(elMute, "pointerdown", (e) => { if (e.cancelable) e.preventDefault(); muted = !muted; applyMute(); try { ctx.storage.set("pf2mute", muted); } catch (_) {} });

    // ===================================================================== //
    // 14. The rival: rehearses a handful of flicks, picks the best, then    //
    //     fumbles it in proportion to how good they are                     //
    // ===================================================================== //
    let tier = rivalTier(0);
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    function aiPlan() {
      const me = cpu, foe = you;
      const dx = foe.x - me.x, dy = foe.y - me.y, dist = Math.hypot(dx, dy) || 1, base = Math.atan2(dy, dx);
      const eFoe0 = edgeDist(foe), eMe0 = edgeDist(me);
      let best = null, bestScore = -Infinity;
      const n = Math.max(1, tier.breadth) * 3;
      for (let k = 0; k < n; k++) {
        const ang = base + (k === 0 ? 0 : gauss() * 0.55), dir = { x: Math.cos(ang), y: Math.sin(ang) };
        const vNeed = Math.sqrt(2 * me.mu * G * Math.max(0.05, dist)) * Math.sqrt(me.m / REF_MASS);
        const power = clamp((vNeed / V_MAX) * rnd(0.9, 1.6) + (k % 3 === 2 ? rnd(-0.2, 0.3) : 0), 0.2, 1);
        const s = (k % 3 === 0 ? 0 : gauss() * 0.3) * me.L;
        const at = me.pointAt(s), r = rehearse(me, foe, at, dir, power, 2.6);
        let score;
        if (r.bOff) score = 1000 - r.t * 50;
        else if (r.aOff) score = -1000;
        else score = (eFoe0 - edgeDist(r.B)) * 60 + (edgeDist(r.A) - eMe0) * 25 * tier.edgeSense - Math.hypot(r.A.x - r.B.x, r.A.y - r.B.y) * 6 + (edgeDist(r.A) < 0.05 ? -30 : 0);
        if (score > bestScore) { bestScore = score; best = { at, dir, power }; }
      }
      // execution error
      const err = gauss() * tier.aimDeg * Math.PI / 180, ca = Math.cos(err), sa = Math.sin(err);
      best.dir = { x: best.dir.x * ca - best.dir.y * sa, y: best.dir.x * sa + best.dir.y * ca };
      best.power = clamp(best.power * (1 + gauss() * tier.powerNoise), 0.15, 1);
      return best;
    }

    // ===================================================================== //
    // 15. Match flow                                                        //
    // ===================================================================== //
    let state = "idle", settleT = 0, thinkT = 0, cpuMove = null, slowmo = 0, mode = "bench", rivalIdx = 0, stakePen = STARTER, friendly = false;
    const HINT_AIM = "touch your pen, pull it back, let go";
    function layout() {
      you.x = rnd(-0.05, 0.05); you.y = -0.23; you.a = rnd(-0.22, 0.22);
      cpu.x = rnd(-0.05, 0.05); cpu.y = 0.23; cpu.a = Math.PI + rnd(-0.22, 0.22);
      for (const p of pens) { p.vx = p.vy = p.w = 0; p.alive = true; p.fall = null; p.mesh.visible = true; p.glow.visible = true; }
      fellThisTurn = null; slowmo = 0; edgeGlowMat.opacity = 0;
    }
    function turnNote(side) { return side === "you" ? (mode === "friends" ? esc(names.you) + ", your flick" : "your flick") : esc(names.cpu) + (mode === "friends" ? ", your flick. pass the phone" : " is thinking"); }
    function newRound(firstMover) {
      layout(); thinkT = 0; settleT = 0; cpuMove = null; aim.visible = false; drag = null;
      if (firstMover === "cpu" && mode === "bench") { state = "cpuThink"; current = cpu; }
      else { state = "aim"; current = firstMover === "cpu" ? cpu : you; }
      renderBoard(turnNote(firstMover), firstMover);
      hint(state === "aim" ? (mode === "friends" && current === cpu ? "far pen: touch it and drag" : HINT_AIM) : "");
    }
    function onKnockOff(p) { slowmo = 0.95; try { ctx.music.duck(0.55, 1100); } catch (_) {} if (ctx.capabilities.haptics) { try { ctx.platform.haptic(p === cpu ? "success" : "error"); } catch (_) {} } }
    function endRound() {
      const lost = fellThisTurn; if (!lost || state === "over" || state === "idle") return;
      const youWon = lost === cpu;
      if (youWon) { scoreYou++; streak++; if (mode === "bench") { save.bestStreak = Math.max(save.bestStreak, streak); } }
      else { scoreCpu++; streak = 0; }
      sfxChalk(2); roundLog.push(youWon ? "w" : "l");
      try { ctx.music.sting(youWon ? "success" : "fail"); } catch (_) {}
      renderBoard(youWon ? "round to " + names.you : "round to " + names.cpu, null);
      try { ctx.platform.setScore(save.beaten.length * 20 + scoreYou); } catch (_) {}
      state = "over";
      if (scoreYou >= TARGET || scoreCpu >= TARGET) ctx.timeout(() => matchOver(scoreYou >= TARGET), 1600);
      else ctx.timeout(() => newRound(youWon ? "cpu" : "you"), 1700);   // the loser of the round flicks first
    }
    function startBenchMatch(i, penId) {
      mode = "bench"; rivalIdx = i; stakePen = penId; friendly = save.beaten.includes(i);
      const r = BENCH[i]; tier = rivalTier(i);
      names = { you: "you", cpu: r.name };
      equip(you, PENS[penId]); equip(cpu, PENS[r.pen]);
      beginMatch('<b>' + esc(r.name) + ' &middot; ' + esc(r.section) + '</b><br>' + esc(r.intro) + '<br>' + (friendly ? 'a friendly.' : 'the ' + esc(PENS[r.pen].short) + ' against your ' + esc(PENS[penId].short) + '.'));
    }
    function startFriendsMatch() {
      mode = "friends"; friendly = true; names = { you: "player one", cpu: "player two" };
      equip(you, PENS[friendPens.you]); equip(cpu, PENS[friendPens.cpu]);
      beginMatch('<b>player one</b> at the near edge with the ' + esc(PENS[friendPens.you].short) + '.<br><b>player two</b> at the far edge with the ' + esc(PENS[friendPens.cpu].short) + '.');
    }
    function beginMatch(introHtml) {
      hidePage(); screen = "match"; scoreYou = 0; scoreCpu = 0; streak = 0; save.plays++; persist();
      firstTouch(); startMusic(); startAmbience(); sfxBell();
      layout(); state = "idle"; roundLog = []; renderBoard("best of 5 . you flick first", null);
      ctx.timeout(() => newRound("you"), 1500);
    }
    function matchOver(won) {
      state = "idle"; hint(""); aim.visible = false; drag = null; sfxCrowd(won);
      save.matches++;
      let html = '', after = null;
      const btns = (a, b) => '<div class="btn" data-go="' + a[0] + '">' + a[1] + '</div>' + (b ? '<div class="btn ghost" data-go="' + b[0] + '">' + b[1] + '</div>' : '');
      if (mode === "friends") {
        html = '<div class="sheet ctr"><h1>' + (won ? "player one" : "player two") + '<br>wins</h1><p>' + (won ? scoreYou + "&ndash;" + scoreCpu : scoreCpu + "&ndash;" + scoreYou) + '. the pen stays on the desk; you are friends.</p>' + btns(["again", "again"], ["home", "home"]) + '</div>';
        try { ctx.platform.complete({ mode: "friends", winner: won ? 1 : 2 }); } catch (_) {}
      } else {
        const r = BENCH[rivalIdx], their = PENS[r.pen], mine = PENS[stakePen];
        if (won) {
          save.wins++;
          if (!friendly) {
            if (!penHeld(r.pen)) save.tin.push(r.pen);
            save.lastWon = r.pen;
            if (save.lost[rivalIdx]) { if (!penHeld(save.lost[rivalIdx])) save.tin.push(save.lost[rivalIdx]); delete save.lost[rivalIdx]; }
            if (!save.beaten.includes(rivalIdx)) save.beaten.push(rivalIdx);
          }
          const champion = nextRival() < 0 && !save.champion;
          if (champion) save.champion = true;
          if (champion) html = '<div class="sheet ctr"><div class="tag">class champion</div><h1 style="margin-top:14px">the trimax<br>is yours</h1><p>' + scoreYou + '&ndash;' + scoreCpu + ' against ' + esc(r.name) + '. nobody left on the bench. ' + save.tin.length + ' pens in the tin.</p>' + btns(["tin", "open the tin"], ["home", "home"]) + '</div>';
          else if (friendly) html = '<div class="sheet ctr"><h1>you win</h1><p>' + scoreYou + '&ndash;' + scoreCpu + ' against ' + esc(r.name) + '. a friendly, so nothing changes hands.</p>' + btns(["bench", "the bench"], ["home", "home"]) + '</div>';
          else after = () => tinPage({ pen: r.pen, from: r.name });
          try { ctx.platform.milestone(champion ? "champion" : "rival_beaten", { rival: r.name, tin: save.tin.length }); ctx.platform.complete({ mode: "bench", rival: r.name, score: scoreYou + "-" + scoreCpu, tin: save.tin.length, champion: save.champion }); } catch (_) {}
        } else {
          let lossNote = '';
          if (!friendly) {
            save.tin = save.tin.filter((id) => id !== stakePen); save.lost[rivalIdx] = stakePen;
            lossNote = ' <b style="color:' + RED + ';font-weight:400">' + esc(r.name) + ' keeps your ' + esc(mine.name) + '.</b>';
            if (!save.tin.length) { save.tin = [STARTER]; lossNote += ' the tin is empty. the class monitor finds you a 045 from lost and found.'; }
          }
          html = '<div class="sheet ctr"><h1>you lose</h1><p>' + scoreCpu + '&ndash;' + scoreYou + ' to ' + esc(r.name) + '.' + lossNote + '</p>' + btns(["retry", "again"], ["home", "home"]) + '</div>';
          try { ctx.platform.fail({ mode: "bench", rival: r.name, score: scoreYou + "-" + scoreCpu }); } catch (_) {}
        }
        persist(); submitRecords();
      }
      hideSlip(); renderBoard(won ? (mode === "friends" ? "game to " + names.you : "you win") : "game to " + names.cpu, null);
      ctx.timeout(() => {
        if (after) return after();
        showPage(html);
        on("[data-go]", (el) => { const go = el.getAttribute("data-go"); if (go === "home") homePage(); else if (go === "tin") tinPage(); else if (go === "bench") benchPage(); else if (go === "retry") stakePage(rivalIdx); else if (go === "again") startFriendsMatch(); });
      }, 1400);
    }

    // ===================================================================== //
    // 16. Render + main loop                                                //
    // ===================================================================== //
    function syncPen(p) {
      if (p.alive) { p.mesh.position.set(toWorldX(p), TABLE_TOP + p.rad, toWorldZ(p)); p.mesh.quaternion.identity(); p.mesh.rotation.set(0, p.a, 0); p.glow.visible = true; p.glow.position.set(toWorldX(p), TABLE_TOP + 0.0009, toWorldZ(p)); }
      else if (p.fall) { p.mesh.position.copy(p.fall.pos); p.mesh.quaternion.copy(p.fall.quat); p.glow.visible = false; }
    }
    function updateFallLight(dt) {
      let f = null; for (const p of pens) if (!p.alive && p.fall && !p.fall.rest) { f = p.fall; break; }
      if (f) { fallLight.visible = true; fallLight.position.set(f.pos.x, f.pos.y + 0.06, f.pos.z); fallLight.intensity = Math.min(2.6, fallLight.intensity + dt * 9); }
      else if (fallLight.visible) { fallLight.intensity -= dt * 3.2; if (fallLight.intensity <= 0) { fallLight.intensity = 0; fallLight.visible = false; } }
    }
    function updateEdgeWarning() {
      let worst = 0, wp = null;
      for (const p of pens) { if (!p.alive) continue; const o = overhang(p); if (o > worst) { worst = o; wp = p; } }
      if (!wp || worst < 0.12) { edgeGlowMat.opacity = Math.max(0, edgeGlowMat.opacity - 0.05); return; }
      const nearX = TABLE_HX - Math.abs(wp.x) < TABLE_HY - Math.abs(wp.y), t = clamp((worst - 0.12) / 0.5, 0, 1);
      edgeGlowMat.opacity = lerp(edgeGlowMat.opacity, t * 0.75, 0.15);
      if (nearX) { edgeGlow.position.set(Math.sign(wp.x) * TABLE_HX, TABLE_TOP + 0.0012, -wp.y); edgeGlow.scale.set(0.05, 1, 0.16); }
      else { edgeGlow.position.set(wp.x, TABLE_TOP + 0.0012, -Math.sign(wp.y) * TABLE_HY); edgeGlow.scale.set(0.16, 1, 0.05); }
      if (t > 0.35 && wp.moving()) sfxCreak();
    }
    let lastW = ctx.width, lastH = ctx.height;
    function resize() { renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2)); renderer.setSize(ctx.width, ctx.height, false); fitCamera(); }
    ctx.listen(window, "resize", resize); resize();
    layout(); syncPen(you); syncPen(cpu); renderer.render(scene, camera);

    let camShake = 0;
    const frame = (dtMs, skipRender) => {
      if (ctx.width !== lastW || ctx.height !== lastH) { lastW = ctx.width; lastH = ctx.height; resize(); }
      let dt = Math.min(dtMs, 50) / 1000;
      if (slowmo > 0) { slowmo = Math.max(0, slowmo - dt); dt *= lerp(1, 0.32, clamp(slowmo / 0.95, 0, 1)); }
      if (state !== "idle") simulate(dt);
      if (fellThisTurn && (state === "aim" || state === "cpuThink")) { drag = null; aim.visible = false; state = "sim"; settleT = 0; }
      if (state === "sim" || state === "cpuSim") {
        if (fellThisTurn && !anyMoving()) endRound();
        else if (!anyMoving()) {
          settleT += dt;
          if (settleT > 0.22) {
            settleT = 0;
            if (fellThisTurn) endRound();
            else {
              const next = current === you ? cpu : you;
              if (next === cpu && mode === "bench") { state = "cpuThink"; current = cpu; thinkT = 0; cpuMove = null; renderBoard(turnNote("cpu"), "cpu"); }
              else { state = "aim"; current = next; renderBoard(turnNote(next === you ? "you" : "cpu"), next === you ? "you" : "cpu"); hint(next === you ? HINT_AIM : "far pen: touch it and drag"); }
            }
          }
        } else settleT = 0;
      }
      if (state === "cpuThink") {
        thinkT += dt;
        if (!cpuMove && thinkT > 0.4) {
          cpuMove = aiPlan(); aim.visible = true;
          const ang = Math.atan2(cpuMove.dir.y, cpuMove.dir.x), gx = cpuMove.at.x, gz = -cpuMove.at.y;
          arrowMesh.position.set(gx, AIM_Y, gz); arrowMesh.rotation.y = ang; arrowMesh.scale.set(0.045 + cpuMove.power * 0.115, 1, 0.024); arrowMesh.material.opacity = 0.4; arrowMesh.material.color.setHex(0x9fbbe8);
          grabDot.position.set(gx, AIM_Y, gz); grabDot.scale.set(0.022, 1, 0.022); grabDot.material.color.setHex(0x9fbbe8); dashMesh.visible = false; spinMesh.material.opacity = 0;
        }
        if (cpuMove && thinkT > 1.1) {
          aim.visible = false; arrowMesh.material.color.setHex(0xffffff); grabDot.material.color.setHex(0xffffff); dashMesh.visible = true;
          flick(cpu, cpuMove.at, cpuMove.dir, cpuMove.power); cpuMove = null; state = "cpuSim"; settleT = 0; fellThisTurn = null; renderBoard(esc(names.cpu) + " flicks", null);
        }
      }
      syncPen(you); syncPen(cpu); updateFallLight(dt);
      you.glow.material.opacity = state === "aim" && current === you ? 0.55 + Math.sin(performance.now() / 380) * 0.22 : 0.35;
      cpu.glow.material.opacity = state === "aim" && current === cpu ? 0.55 + Math.sin(performance.now() / 380) * 0.22 : 0.3;
      stepSparks(dt); updateEdgeWarning(); updateSlideBed();
      if (drag) updateAimVisual();
      if (lastHit > 0.3) { camShake = Math.max(camShake, lastHit * 0.5); lastHit = 0; }
      if (camShake > 0.001) { camShake *= 0.86; camera.position.set(camBase.x + rnd(-1, 1) * camShake * 0.006, camBase.y + rnd(-1, 1) * camShake * 0.004, camBase.z); camera.lookAt(camTarget); }
      else if (!camera.position.equals(camBase)) { camera.position.copy(camBase); camera.lookAt(camTarget); }
      if (!skipRender) renderer.render(scene, camera);
    };
    ctx.onFrame((dtMs) => frame(dtMs, false));

    await loadSave();
    homePage();

    // debug hooks for the headless harness
    window.__pfInfo = () => ({ screen, state, mode, scoreYou, scoreCpu, tin: save.tin.slice(), beaten: save.beaten.slice(), lost: save.lost, champion: save.champion, you: [Math.round(you.x * 1000) / 1000, Math.round(you.y * 1000) / 1000, you.alive, you.spec.id], cpu: [Math.round(cpu.x * 1000) / 1000, Math.round(cpu.y * 1000) / 1000, cpu.alive, cpu.spec.id], current: current.side, page: elPage.classList.contains("show"), pageText: elInner.textContent.slice(0, 120) });
    window.__pfGo = (fn, arg, arg2) => { ({ home: homePage, bench: benchPage, tin: tinPage, stake: stakePage, friends: friendsPickPage, startBench: startBenchMatch, startFriends: startFriendsMatch })[fn](arg, arg2); };
    window.__pfFlick = (dx, dy, power, s) => { if (state !== "aim") return false; const at = current.pointAt(s || 0); const l = Math.hypot(dx, dy) || 1; flick(current, at, { x: dx / l, y: dy / l }, power); state = "sim"; settleT = 0; fellThisTurn = null; return true; };
    window.__pfKnock = (side) => { const p = side === "cpu" ? cpu : you; if (p.alive) { p.x = TABLE_HX + 0.02; if (state === "aim" || state === "cpuThink") { state = "sim"; settleT = 0; fellThisTurn = null; } } };
    window.__pfSkipIntro = () => { if (state === "idle" && screen === "match") newRound("you"); };
    window.__pfStep = (n) => { for (let i = 0; i < (n || 1); i++) frame(16.7, true); };
    window.__pfReset = () => { save.tin = [STARTER]; save.beaten = []; save.lost = {}; save.champion = false; save.lastWon = null; persist(); };

    ctx.onDestroy(() => {
      try { if (musicHandle) musicHandle.stop({ fadeOutMs: 500 }); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 500 }); } catch (_) {}
      try { if (slideSrc) slideSrc.stop(); } catch (_) {}
      try { if (ac) ac.close(); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
    });

    } catch (err) { fatal("init", err); }
  }
};
