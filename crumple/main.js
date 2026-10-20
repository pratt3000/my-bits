/**
 * Crumple — paper toss, the office classic, rebuilt in 3D for one thumb.
 *
 * You sit at a desk with a crumpled sheet in front of you and a wastepaper bin
 * somewhere across the room. Flick up to throw. The speed of the flick is the
 * distance, the angle of the flick is the aim, and a desk fan blows across the
 * room — the number next to the yellow arrow is how hard. Three in the bin
 * clears a level and the bin moves further away. Endless mode counts a streak
 * until you miss.
 *
 * Everything on screen is generated here: the office, the basement, the bar,
 * every texture, the crumpled ball and every sound. Packaged assets are
 * disabled for bits, so nothing is loaded except three.js from the registry.
 *
 * The physics is written out rather than faked:
 *  - the ball is a sphere under gravity, air drag and a steady lateral wind,
 *    integrated in substeps small enough that it cannot pass through the bin
 *    wall at full throwing speed;
 *  - the bin is a cone frustum with a torus lip: inside the cone the wall
 *    pushes in, outside it pushes out, and the lip is a proper ring contact,
 *    which is what makes rim shots rattle in or spin out instead of either
 *    swallowing or rejecting every near miss;
 *  - the floor and the furniture are box colliders with low restitution and
 *    heavy friction, because a paper ball does not roll, it flops.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule).
 */
window.plethoraBit = {
  meta: {
    title: "Crumple",
    runtime: "plethora-bit@2",
    tags: ["3d", "game", "arcade", "paper-toss", "office", "physics", "flick"],
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

    // Offscreen surfaces for texture bakes. The runtime owns every canvas in
    // the DOM, so bakes go to an OffscreenCanvas; if the WebView lacks it we
    // fall back to a hidden SDK canvas rather than losing the texture.
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function surface(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (CAN_BAKE) {
        try { return new OffscreenCanvas(w, h); } catch (_) { /* fall through */ }
      }
      const c = ctx.createCanvas2D();
      c.style.display = "none";
      c.width = w; c.height = h;
      return c;
    }

    // ctx.storage.set() returns nothing on device; never chain onto it.
    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (_) { /* not supported on this runtime */ }
    }

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 0);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 0);

    // ===================================================================== //
    // 1. Surfaces + an immediate first frame (the title card)                //
    // ===================================================================== //
    // The render surface is claimed first so the UI root lands above it.
    const canvas = ctx.createCanvas({ touchAction: "none", layer: "content" });
    const ui = ctx.createRoot({ touchAction: "none", layer: "overlay", input: "passthrough" });
    ui.style.zIndex = "5";
    // The overlay sits above the render surface, so it must be transparent to
    // touch or it eats every flick. Buttons re-enable hits for themselves.
    ui.style.pointerEvents = "none";

    /** A crumpled sheet as an icon: an irregular polygon with fold lines. */
    function ballIcon(size, extra) {
      const R = [1, 0.86, 0.95, 0.8, 0.98, 0.88, 0.93, 0.78, 0.9, 0.84, 0.96];
      const pts = [];
      for (let i = 0; i < R.length; i++) {
        const a = -Math.PI / 2 + (i / R.length) * TAU;
        pts.push((50 + Math.cos(a) * 46 * R[i]).toFixed(1) + " " + (50 + Math.sin(a) * 46 * R[i]).toFixed(1));
      }
      const d = "M" + pts.join("L") + "Z";
      const folds = "M24 42L46 30L68 42L54 62L30 70M46 30L54 62M54 62L76 74M46 30L58 12M24 42L12 62";
      return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" ' + (extra || "") + ">" +
        '<defs><radialGradient id="crg" cx="36%" cy="30%" r="72%">' +
        '<stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e2e6ea"/><stop offset="1" stop-color="#a7aeb8"/>' +
        "</radialGradient></defs>" +
        '<path d="' + d + '" fill="url(#crg)" stroke="#8c939d" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<path d="' + folds + '" fill="none" stroke="rgba(90,98,110,.42)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
        "</svg>";
    }
    const SVG_BILL = '<svg viewBox="0 0 30 18" width="28" height="17"><rect x="1" y="1" width="28" height="16" rx="2.5" fill="#4f9d5d" stroke="#2f6f3c" stroke-width="1.5"/>' +
      '<rect x="4.5" y="4.5" width="21" height="9" rx="1" fill="none" stroke="#dcecd8" stroke-width="1"/><circle cx="15" cy="9" r="4.2" fill="#dcecd8"/>' +
      '<text x="15" y="11.6" font-size="7.5" text-anchor="middle" fill="#2f6f3c" font-weight="700" font-family="sans-serif">$</text></svg>';
    const SVG_BIN = '<svg viewBox="0 0 18 20" width="15" height="17"><path d="M2.5 4h13l-1.8 15H4.3z" fill="#2a62b4"/><rect x="1" y="1" width="16" height="3.4" rx="1.2" fill="#1d4a8c"/></svg>';
    const SVG_WIND = '<svg viewBox="0 0 84 34" width="84" height="34"><path d="M5 11h9M3 17h11M5 23h9" stroke="#f4c53b" stroke-width="3.2" stroke-linecap="round"/>' +
      '<path d="M19 9h32V2.5L81 17 51 31.5V25H19z" fill="#f4c53b" stroke="#6e4f0d" stroke-width="2" stroke-linejoin="round"/></svg>';
    const SVG_UP = '<svg viewBox="0 0 24 34" width="22" height="30"><path d="M12 2l9.5 12.5H16V32H8V14.5H2.5z" fill="#fff" stroke="rgba(0,0,0,.4)" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const SVG_HAND = '<svg viewBox="0 0 64 80" width="64" height="80">' +
      '<rect x="13" y="58" width="38" height="22" rx="9" fill="#8b5cf6"/><rect x="13" y="58" width="38" height="7" rx="3" fill="#a78bfa"/>' +
      '<ellipse cx="32" cy="50" rx="19" ry="15" fill="#f6c89f" stroke="#d9a070" stroke-width="2"/>' +
      '<rect x="25" y="6" width="14" height="42" rx="7" fill="#f6c89f" stroke="#d9a070" stroke-width="2"/>' +
      '<path d="M18 44q6-4 12 0M20 54q5-3 10 0" fill="none" stroke="#d9a070" stroke-width="1.6" stroke-linecap="round"/></svg>';

    ui.innerHTML =
      "<style>" +
      ".cr{position:absolute;inset:0;overflow:hidden;font-family:'Nunito Sans',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:#fff;pointer-events:none;}" +
      ".cr *{box-sizing:border-box;}" +
      ".cr-vig{position:absolute;inset:0;background:radial-gradient(125% 95% at 50% 42%,rgba(0,0,0,0) 56%,rgba(0,0,0,.45) 100%);}" +
      ".cr-fade{position:absolute;inset:0;background:#06080e;opacity:0;transition:opacity .35s ease;}" +
      ".cr-hud{position:absolute;left:10px;right:10px;top:" + (SAFE_T + 8) + "px;opacity:0;transition:opacity .4s ease;}" +
      ".cr-ban{position:relative;height:64px;border-radius:15px;display:flex;align-items:center;gap:8px;padding:0 9px 0 7px;" +
      "background:repeating-linear-gradient(135deg,rgba(255,255,255,.07) 0 2px,rgba(255,255,255,0) 2px 6px),linear-gradient(180deg,#f3dcb0 0%,#e7c68f 55%,#d9b172 100%);" +
      "box-shadow:0 7px 18px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.6),inset 0 -3px 0 rgba(110,72,25,.22);}" +
      ".cr-pause{width:44px;height:44px;border-radius:11px;display:flex;align-items:center;justify-content:center;pointer-events:auto;flex:none;" +
      "background:linear-gradient(180deg,#dcb577,#c89d5c);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 2px 4px rgba(0,0,0,.2);}" +
      ".cr-pause i{display:block;width:6px;height:18px;border-radius:2px;background:#6b4a1e;margin:0 2.5px;}" +
      ".cr-stats{display:flex;align-items:center;gap:8px;min-width:0;}" +
      ".cr-stat{display:flex;flex-direction:column;align-items:center;min-width:50px;line-height:1;}" +
      ".cr-lab{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#7a5222;white-space:nowrap;}" +
      ".cr-val{margin-top:5px;font-size:22px;font-weight:800;color:#2a62b4;display:flex;align-items:center;gap:4px;white-space:nowrap;}" +
      ".cr-div{width:1px;height:38px;background:rgba(110,72,25,.28);flex:none;}" +
      ".cr-money{margin-left:auto;display:flex;align-items:center;gap:6px;padding:5px 11px 5px 7px;border-radius:12px;flex:none;" +
      "background:linear-gradient(180deg,#9ba6b2,#7e8996);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),inset 0 -1px 0 rgba(0,0,0,.2);" +
      "font-size:20px;font-weight:800;color:#1f3f6b;}" +
      ".cr-balls{display:flex;justify-content:center;gap:5px;margin-top:9px;}" +
      ".cr-balls svg{filter:drop-shadow(0 2px 2px rgba(0,0,0,.35));transition:opacity .3s,transform .3s;}" +
      ".cr-balls svg.used{opacity:.22;transform:scale(.8);}" +
      ".cr-wind{position:absolute;left:13%;top:66%;width:96px;text-align:center;opacity:0;transition:opacity .35s;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5));}" +
      ".cr-wind .n{margin-top:-5px;font-size:20px;font-weight:800;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,.6);}" +
      ".cr-wind .a{display:inline-block;transition:transform .3s;}" +
      ".cr-wind .a.l{transform:scaleX(-1);}" +
      ".cr-tag{position:absolute;left:0;top:52%;padding:7px 14px 7px 12px;border-radius:0 6px 6px 0;pointer-events:auto;opacity:0;transition:opacity .4s;" +
      "background:linear-gradient(180deg,#f0d7a9,#e0bd82);color:#6b4a1e;font-weight:800;font-size:14px;letter-spacing:.1em;" +
      "transform:rotate(-4deg);transform-origin:left center;box-shadow:0 4px 10px rgba(0,0,0,.35);}" +
      ".cr-tag::before{content:'';position:absolute;top:-7px;left:50%;width:34px;height:12px;background:rgba(255,255,255,.5);transform:translateX(-50%) rotate(-3deg);border-radius:2px;}" +
      ".cr-badge{position:absolute;right:0;top:44%;width:40px;height:34px;border-radius:9px 0 0 9px;pointer-events:auto;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .4s;" +
      "background:linear-gradient(180deg,#b79cff,#8b63f3);color:#fff;font-weight:800;font-size:22px;box-shadow:0 4px 10px rgba(0,0,0,.35);}" +
      ".cr-up{position:absolute;left:0;top:0;width:22px;height:30px;margin-left:-11px;margin-top:-15px;opacity:0;transition:opacity .3s;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));animation:crBob 1.1s ease-in-out infinite;}" +
      ".cr-hand{position:absolute;left:0;top:0;width:64px;height:80px;margin-left:-14px;margin-top:-4px;opacity:0;filter:drop-shadow(0 6px 8px rgba(0,0,0,.45));}" +
      ".cr-hand.on{animation:crHand 1.7s ease-in-out infinite;}" +
      ".cr-toast{position:absolute;left:0;right:0;top:33%;text-align:center;opacity:0;}" +
      ".cr-toast .b{font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-size:60px;letter-spacing:.06em;line-height:1;color:#fff;text-shadow:0 3px 0 rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.55);}" +
      ".cr-toast .s{margin-top:4px;font-size:18px;font-weight:800;color:#ffd54a;text-shadow:0 2px 6px rgba(0,0,0,.6);}" +
      ".cr-toast.on{animation:crPop 1s cubic-bezier(.2,1.4,.4,1) forwards;}" +
      ".cr-hint{position:absolute;left:16px;right:16px;bottom:" + (SAFE_B + 14) + "px;text-align:center;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.78);text-shadow:0 1px 3px rgba(0,0,0,.7);opacity:0;transition:opacity .35s;}" +
      ".cr-modal{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:" + (SAFE_T + 16) + "px 20px " + (SAFE_B + 16) + "px;background:rgba(8,12,22,.55);pointer-events:auto;}" +
      ".cr-modal.on{display:flex;}" +
      ".cr-card{width:100%;max-width:340px;max-height:100%;overflow:auto;border-radius:18px;padding:20px 18px 18px;text-align:center;color:#5c3f16;" +
      "background:repeating-linear-gradient(135deg,rgba(255,255,255,.07) 0 2px,rgba(255,255,255,0) 2px 6px),linear-gradient(180deg,#f6e3bf,#e9cb95);" +
      "box-shadow:0 20px 50px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.6);animation:crCard .35s cubic-bezier(.2,1.3,.4,1);}" +
      ".cr-card h2{margin:0 0 4px;font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:42px;letter-spacing:.05em;line-height:1;color:#6b4a1e;}" +
      ".cr-card p{margin:6px 0 0;font-size:14px;line-height:1.5;color:#7a5a2e;}" +
      ".cr-card h3{margin:14px 0 2px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7a5222;}" +
      ".cr-btn{display:block;width:100%;margin-top:10px;padding:13px 16px;border-radius:13px;font-size:15px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fff;pointer-events:auto;cursor:pointer;" +
      "background:linear-gradient(180deg,#ff8b3d,#e8601c);box-shadow:0 4px 0 #a9400f,0 8px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.35);}" +
      ".cr-btn:active{transform:translateY(2px);box-shadow:0 2px 0 #a9400f,0 4px 12px rgba(0,0,0,.3);}" +
      ".cr-btn.g{background:linear-gradient(180deg,#dcbb7e,#c39a58);color:#5c3f16;box-shadow:0 4px 0 #8f6a30,0 8px 18px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.4);}" +
      ".cr-btn.g:active{box-shadow:0 2px 0 #8f6a30,0 4px 12px rgba(0,0,0,.25);}" +
      ".cr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px;}" +
      ".cr-item{border-radius:12px;padding:8px 4px 7px;background:rgba(255,255,255,.35);border:2px solid rgba(110,72,25,.15);pointer-events:auto;font-size:11px;font-weight:800;line-height:1.25;cursor:pointer;}" +
      ".cr-item.sel{border-color:#e8601c;background:rgba(255,255,255,.62);}" +
      ".cr-item .sw{width:34px;height:34px;border-radius:50%;margin:0 auto 5px;box-shadow:inset 0 -6px 10px rgba(0,0,0,.18),0 2px 3px rgba(0,0,0,.2);}" +
      ".cr-item .sw.bin{border-radius:6px 6px 11px 11px;width:30px;height:34px;}" +
      ".cr-item .pr{color:#2a62b4;}" +
      ".cr-item .pr.own{color:#4f8a3b;}" +
      ".cr-item.no{opacity:.6;}" +
      ".cr-stat2{display:flex;justify-content:center;gap:22px;margin:12px 0 2px;}" +
      ".cr-stat2 div{display:flex;flex-direction:column;align-items:center;}" +
      ".cr-stat2 b{font-size:28px;color:#2a62b4;line-height:1;}" +
      ".cr-stat2 span{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7a5222;margin-top:4px;}" +
      ".cr-curtain{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:" + (SAFE_T + 20) + "px 28px " + (SAFE_B + 24) + "px;text-align:center;pointer-events:auto;" +
      "background:radial-gradient(120% 90% at 50% 20%,rgba(34,52,86,.82) 0%,rgba(13,20,36,.9) 55%,rgba(5,8,16,.96) 100%);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);transition:opacity .45s ease;}" +
      ".cr-title{font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-size:clamp(54px,18vw,92px);letter-spacing:.04em;line-height:.92;" +
      "background:linear-gradient(180deg,#fff7e6 0%,#ffd27a 45%,#f0742a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 18px rgba(240,116,42,.35));}" +
      ".cr-sub{font-size:15px;line-height:1.55;max-width:21em;color:rgba(255,255,255,.74);}" +
      ".cr-note{font-size:12px;letter-spacing:.06em;color:rgba(255,255,255,.42);margin-top:4px;min-height:15px;}" +
      ".cr-cbtn{width:min(100%,280px);margin-top:4px;}" +
      ".cr-cball{filter:drop-shadow(0 14px 22px rgba(0,0,0,.55));animation:crBob 2.4s ease-in-out infinite;}" +
      "@keyframes crBob{0%,100%{transform:translateY(0);}50%{transform:translateY(-9px);}}" +
      "@keyframes crHand{0%{transform:translate(0,0) rotate(-6deg);opacity:0;}8%{opacity:1;}62%{transform:translate(6px,-130px) rotate(2deg);opacity:1;}78%{opacity:0;}100%{transform:translate(6px,-130px);opacity:0;}}" +
      "@keyframes crPop{0%{opacity:0;transform:scale(.6);}18%{opacity:1;transform:scale(1.08);}30%{transform:scale(1);}78%{opacity:1;}100%{opacity:0;transform:translateY(-14px) scale(1);}}" +
      "@keyframes crCard{0%{opacity:0;transform:translateY(16px) scale(.96);}100%{opacity:1;transform:none;}}" +
      "</style>" +
      '<div class="cr" data-el="stage">' +
      '<div class="cr-vig"></div>' +
      '<div class="cr-wind" data-el="wind"><div class="a" data-el="winda">' + SVG_WIND + '</div><div class="n" data-el="windn">0.0</div></div>' +
      '<div class="cr-up" data-el="up">' + SVG_UP + "</div>" +
      '<div class="cr-hand" data-el="hand">' + SVG_HAND + "</div>" +
      '<div class="cr-tag" data-act="shop" data-el="shoptag">SHOP</div>' +
      '<div class="cr-badge" data-act="help" data-el="helpb">!</div>' +
      '<div class="cr-hud" data-el="hud"><div class="cr-ban">' +
      '<div class="cr-pause" data-act="pause"><i></i><i></i></div>' +
      '<div class="cr-stats" data-el="stats"></div>' +
      '<div class="cr-money">' + SVG_BILL + '<span data-el="money">0</span></div>' +
      '</div><div class="cr-balls" data-el="balls"></div></div>' +
      '<div class="cr-toast" data-el="toast"><div class="b" data-el="toastb"></div><div class="s" data-el="toasts"></div></div>' +
      '<div class="cr-hint" data-el="hint"></div>' +
      '<div class="cr-fade" data-el="fade"></div>' +
      '<div class="cr-modal" data-el="modal"><div class="cr-card" data-el="card"></div></div>' +
      '<div class="cr-curtain" data-el="curtain">' +
      '<div class="cr-cball">' + ballIcon(118) + "</div>" +
      '<div class="cr-title" data-el="ctitle">CRUMPLE</div>' +
      '<div class="cr-sub" data-el="csub">Flick the paper into the bin.<br>Mind the fan.</div>' +
      '<div class="cr-btn cr-cbtn" data-act="levels" data-el="cbtn1">Play levels</div>' +
      '<div class="cr-btn g cr-cbtn" data-act="endless" data-el="cbtn2">Endless</div>' +
      '<div class="cr-note" data-el="cnote">Loading the office&hellip;</div>' +
      "</div></div>";

    const el = {};
    for (const n of ui.querySelectorAll("[data-el]")) el[n.getAttribute("data-el")] = n;

    ctx.markVisualReady("title");
    ctx.platform.ready();

    // Display fonts, best-effort — the card already reads fine without them.
    (async () => {
      try { await ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0", { weight: "400" }); } catch (_) { /* system font is fine */ }
      try { await ctx.loadFont("Nunito Sans", "nunito-sans", "1.0.0", { weight: "700" }); } catch (_) { /* ditto */ }
      try { await ctx.loadFont("Nunito Sans", "nunito-sans", "1.0.0", { weight: "400" }); } catch (_) { /* ditto */ }
    })();

    function fatal(where, err) {
      el.ctitle.textContent = "OOPS";
      el.csub.textContent = "Could not start (" + where + ").";
      el.cnote.textContent = String((err && err.message) || err || "");
      el.cbtn1.style.display = "none";
      el.cbtn2.style.display = "none";
      try { ctx.platform.error({ where: where, message: String((err && err.message) || err) }); } catch (_) { /* ignore */ }
    }

    // ===================================================================== //
    // 2. Three.js                                                           //
    // ===================================================================== //
    let THREE;
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e1) {
      try { THREE = await ctx.importModule(THREE_URL); }
      catch (e2) { fatal("load three", e2 || e1); return; }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) { fatal("three exports", new Error("WebGLRenderer missing")); return; }

    try {

    // ===================================================================== //
    // 3. Procedural textures — nothing is loaded, everything is painted     //
    // ===================================================================== //
    function hashi(x, y, z) {
      let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1103515245);
      h = Math.imul(h ^ (h >>> 16), 2246822519);
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
    }
    const fade = (t) => t * t * (3 - 2 * t);
    /** Value noise on a lattice that repeats every px/py cells, so maps tile. */
    function vnoise2(x, y, px, py) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const u = fade(x - xi), v = fade(y - yi);
      const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
      const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
      return lerp(lerp(hashi(x0, y0, 7), hashi(x1, y0, 7), u), lerp(hashi(x0, y1, 7), hashi(x1, y1, 7), u), v);
    }
    function fbm2(x, y, oct, px, py) {
      let s = 0, a = 0.5, n = 0;
      for (let i = 0; i < oct; i++) {
        s += vnoise2(x, y, px, py) * a; n += a; a *= 0.5;
        x *= 2; y *= 2; px *= 2; py *= 2;
      }
      return s / n;
    }
    function vnoise3(x, y, z) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
      const c = (dx, dy, dz) => hashi(xi + dx, yi + dy, zi + dz);
      return lerp(
        lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
        lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
    }

    /** Per-pixel painter: fn(u, v, out) fills out[0..2] with 0..255. */
    function paint(w, h, fn) {
      const c = surface(w, h);
      const g = c.getContext("2d");
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      const o = [0, 0, 0];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          fn(x / w, y / h, o);
          const i = (y * w + x) * 4;
          d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      return c;
    }
    function texOf(c, opts) {
      opts = opts || {};
      const t = new THREE.CanvasTexture(c);
      if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
      t.anisotropy = opts.aniso || 4;
      return t;
    }
    const rgb = (r, g, b) => "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";

    function carpetTex(base, fleck) {
      const c = paint(384, 384, (u, v, o) => {
        const n = fbm2(u * 64, v * 64, 3, 64, 64);
        const f = fbm2(u * 5, v * 96, 2, 5, 96);
        const m = fbm2(u * 3, v * 3, 2, 3, 3);
        const k = 0.78 + n * 0.3 + (f - 0.5) * 0.14 + (m - 0.5) * 0.18;
        const t = vnoise2(u * 192, v * 192, 192, 192) > 0.82 ? 0.3 : 0;
        o[0] = clamp(base[0] * k + fleck[0] * t, 0, 255);
        o[1] = clamp(base[1] * k + fleck[1] * t, 0, 255);
        o[2] = clamp(base[2] * k + fleck[2] * t, 0, 255);
      });
      return texOf(c, { repeat: [7, 10] });
    }

    function concreteTex() {
      const c = paint(384, 384, (u, v, o) => {
        const n = fbm2(u * 48, v * 48, 3, 48, 48);
        const s = fbm2(u * 4, v * 4, 3, 4, 4);
        const g = 116 + (n - 0.5) * 48 + (s - 0.5) * 74;
        o[0] = clamp(g + 5, 0, 255); o[1] = clamp(g + 3, 0, 255); o[2] = clamp(g - 2, 0, 255);
      });
      const g = c.getContext("2d");
      g.strokeStyle = "rgba(38,36,34,.32)";
      g.lineCap = "round";
      for (let k = 0; k < 2; k++) {
        let x = rnd(40, 340), y = rnd(40, 340);
        g.lineWidth = rnd(0.5, 0.9);
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 9; s++) { x += rnd(-22, 22); y += rnd(-22, 22); g.lineTo(clamp(x, 30, 354), clamp(y, 30, 354)); }
        g.stroke();
      }
      g.fillStyle = "rgba(30,26,24,.18)";
      g.beginPath(); g.ellipse(250, 120, 70, 40, 0.4, 0, TAU); g.fill();
      return texOf(c, { repeat: [5, 7] });
    }

    function plankTex() {
      const W = 512, H = 512, n = 8;
      const c = surface(W, H);
      const g = c.getContext("2d");
      for (let i = 0; i < n; i++) {
        const x0 = i * W / n, tone = rnd(-16, 16);
        g.fillStyle = rgb(88 + tone, 54 + tone * 0.7, 30 + tone * 0.4);
        g.fillRect(x0, 0, W / n, H);
        for (let k = 0; k < 24; k++) {
          g.strokeStyle = Math.random() < 0.5
            ? "rgba(28,14,5," + rnd(0.08, 0.26).toFixed(2) + ")"
            : "rgba(176,124,72," + rnd(0.05, 0.14).toFixed(2) + ")";
          g.lineWidth = rnd(0.6, 2);
          const gx = x0 + rnd(2, W / n - 2), amp = rnd(1, 4), fr = rnd(0.01, 0.03), p0 = rnd(0, TAU);
          g.beginPath();
          for (let y = 0; y <= H; y += 8) {
            const xx = gx + Math.sin(y * fr + p0) * amp;
            if (y === 0) g.moveTo(xx, y); else g.lineTo(xx, y);
          }
          g.stroke();
        }
        g.fillStyle = "rgba(8,5,2,.45)";
        g.fillRect(x0, 0, 1.5, H);
        g.fillRect(x0, rnd(40, H - 40), W / n, 1.5);
      }
      return texOf(c, { repeat: [3, 6] });
    }

    /** Pale laminate / tan wood for desks: long grain, light, a little knotty. */
    function woodTex(r0, g0, b0) {
      const W = 512, H = 256;
      const c = surface(W, H);
      const g = c.getContext("2d");
      g.fillStyle = rgb(r0, g0, b0); g.fillRect(0, 0, W, H);
      for (let i = 0; i < 150; i++) {
        const dark = Math.random() < 0.55;
        g.strokeStyle = dark
          ? "rgba(90,58,24," + rnd(0.05, 0.16).toFixed(3) + ")"
          : "rgba(255,236,200," + rnd(0.05, 0.14).toFixed(3) + ")";
        g.lineWidth = rnd(0.6, 2.4);
        const y0 = Math.random() * H, amp = rnd(2, 10), freq = rnd(0.004, 0.014), p0 = Math.random() * TAU;
        g.beginPath();
        for (let x = 0; x <= W; x += 6) {
          const y = y0 + Math.sin(x * freq + p0) * amp + Math.sin(x * freq * 3.1 + p0 * 2) * amp * 0.2;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = Math.random() < 0.5 ? "rgba(255,245,220,.05)" : "rgba(60,36,12,.06)";
        g.fillRect(Math.random() * W, Math.random() * H, 1, rnd(1, 3));
      }
      return texOf(c, { repeat: [1, 1] });
    }

    function fabricTex() {
      const c = paint(256, 256, (u, v, o) => {
        const wv = (Math.sin(u * 256 * Math.PI) * 0.5 + 0.5) * (Math.sin(v * 256 * Math.PI) * 0.5 + 0.5);
        const n = fbm2(u * 32, v * 32, 2, 32, 32);
        const k = 0.84 + wv * 0.2 + (n - 0.5) * 0.16;
        o[0] = clamp(142 * k, 0, 255); o[1] = clamp(150 * k, 0, 255); o[2] = clamp(163 * k, 0, 255);
      });
      return texOf(c, { repeat: [4, 4] });
    }

    function cinderTex() {
      const W = 512, H = 256;
      const c = surface(W, H);
      const g = c.getContext("2d");
      g.fillStyle = "#6a665e"; g.fillRect(0, 0, W, H);
      const bw = W / 5, bh = H / 5;
      for (let r = 0; r < 5; r++) {
        const off = r % 2 ? bw / 2 : 0;
        for (let i = -1; i < 6; i++) {
          const x = i * bw + off + 3, y = r * bh + 3, t = rnd(-12, 12);
          g.fillStyle = rgb(148 + t, 142 + t, 130 + t);
          g.fillRect(x, y, bw - 6, bh - 6);
          for (let k = 0; k < 70; k++) {
            g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,.13)" : "rgba(255,255,255,.1)";
            g.fillRect(x + Math.random() * (bw - 6), y + Math.random() * (bh - 6), 1.5, 1.5);
          }
        }
      }
      g.fillStyle = "rgba(36,32,28,.28)"; g.fillRect(0, H * 0.82, W, H * 0.18);
      return texOf(c, { repeat: [3.5, 2.75] });
    }

    function ceilingTex() {
      const S = 256;
      const c = paint(S, S, (u, v, o) => {
        const n = fbm2(u * 24, v * 24, 2, 24, 24);
        const g = 214 + (n - 0.5) * 22;
        o[0] = g; o[1] = g; o[2] = g - 4;
      });
      const g = c.getContext("2d");
      g.fillStyle = "rgba(60,60,66,.55)";
      g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);
      g.fillRect(0, S / 2 - 1, S, 3); g.fillRect(S / 2 - 1, 0, 3, S);
      for (let i = 0; i < 400; i++) { g.fillStyle = "rgba(0,0,0,.08)"; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
      return texOf(c, { repeat: [13, 20] });
    }

    function paperTex(kind) {
      const S = 256;
      const c = surface(S, S);
      const g = c.getContext("2d");
      const base = { plain: "#f4f3ee", sticky: "#f6e46b", news: "#d9d6cc", memo: "#f7b8c9", foil: "#f6d27a" };
      g.fillStyle = base[kind] || base.plain; g.fillRect(0, 0, S, S);
      if (kind === "sticky") {
        g.strokeStyle = "rgba(60,90,160,.38)"; g.lineWidth = 1.5;
        for (let y = 28; y < S; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
        g.fillStyle = "rgba(230,70,80,.45)"; g.fillRect(34, 0, 2, S);
      }
      if (kind === "news") {
        g.fillStyle = "rgba(40,40,40,.85)"; g.fillRect(16, 14, 160, 12);
        g.fillStyle = "rgba(50,50,50,.55)";
        for (let y = 36; y < S - 8; y += 7) {
          for (let col = 0; col < 3; col++) {
            const x0 = 16 + col * 80; let x = x0;
            while (x < x0 + 68) { const w = rnd(4, 14); g.fillRect(x, y, w, 2.5); x += w + 3; }
          }
        }
        g.fillStyle = "rgba(90,90,90,.75)"; g.fillRect(100, 120, 70, 50);
      }
      if (kind === "memo") {
        g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 1;
        for (let k = 0; k < S; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.moveTo(0, k); g.lineTo(S, k); g.stroke(); }
        g.fillStyle = "rgba(180,40,90,.5)"; g.fillRect(20, 20, 90, 8); g.fillRect(20, 40, 140, 4); g.fillRect(20, 52, 120, 4);
      }
      g.strokeStyle = kind === "foil" ? "rgba(120,80,10,.4)" : "rgba(80,80,90,.24)";
      g.lineWidth = 1.2;
      for (let k = 0; k < 44; k++) {
        g.beginPath(); g.moveTo(Math.random() * S, Math.random() * S); g.lineTo(Math.random() * S, Math.random() * S); g.stroke();
      }
      for (let k = 0; k < 24; k++) {
        g.fillStyle = "rgba(0,0,0," + rnd(0.02, 0.06).toFixed(3) + ")";
        g.beginPath(); g.arc(Math.random() * S, Math.random() * S, rnd(6, 24), 0, TAU); g.fill();
      }
      return texOf(c);
    }

    function screenTex(on) {
      const W = 256, H = 160;
      const c = surface(W, H);
      const g = c.getContext("2d");
      if (!on) {
        g.fillStyle = "#0c0f14"; g.fillRect(0, 0, W, H);
        g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(0, 0, W, 40);
        return texOf(c);
      }
      const grd = g.createLinearGradient(0, 0, W, H);
      grd.addColorStop(0, "#1b4f9c"); grd.addColorStop(0.6, "#2b7bd1"); grd.addColorStop(1, "#5fb3ea");
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.arc(70, 50, 60, 0, TAU); g.fill();
      g.fillStyle = "rgba(245,247,250,.93)"; g.fillRect(30, 28, 150, 92);
      g.fillStyle = "#e3e6ea"; g.fillRect(30, 28, 150, 12);
      g.fillStyle = "#cfd4da";
      for (let y = 50; y < 112; y += 9) g.fillRect(40, y, rnd(60, 128), 3);
      g.fillStyle = "rgba(255,255,255,.88)"; g.fillRect(150, 70, 90, 60);
      g.fillStyle = "#1f2a3a"; g.fillRect(0, H - 12, W, 12);
      g.fillStyle = "#58c6ff"; g.fillRect(6, H - 9, 7, 6);
      g.fillStyle = "#ffcf4a"; g.fillRect(18, H - 9, 7, 6);
      return texOf(c);
    }

    function cardboardTex() {
      const S = 256;
      const c = paint(S, S, (u, v, o) => {
        const n = fbm2(u * 16, v * 16, 2, 16, 16);
        const k = 0.9 + (n - 0.5) * 0.28;
        o[0] = clamp(178 * k, 0, 255); o[1] = clamp(136 * k, 0, 255); o[2] = clamp(92 * k, 0, 255);
      });
      const g = c.getContext("2d");
      g.fillStyle = "rgba(224,204,164,.6)"; g.fillRect(S * 0.44, 0, S * 0.12, S);
      g.fillStyle = "rgba(255,255,255,.82)"; g.fillRect(28, 150, 70, 44);
      g.fillStyle = "rgba(40,40,40,.6)";
      for (let y = 158; y < 190; y += 8) g.fillRect(34, y, rnd(30, 56), 2.5);
      return texOf(c);
    }

    function posterTex(kind) {
      const W = 256, H = 352;
      const c = surface(W, H);
      const g = c.getContext("2d");
      if (kind === 0) {
        g.fillStyle = "#1d3a6b"; g.fillRect(0, 0, W, H);
        g.fillStyle = "#f6f1e4"; g.fillRect(0, H * 0.36, W, H * 0.26);
        g.fillStyle = "#1d3a6b"; g.fillRect(40, H * 0.44, W - 80, 14); g.fillRect(70, H * 0.52, W - 140, 10);
        g.fillStyle = "#f2b54a"; g.beginPath(); g.arc(W / 2, H * 0.2, 36, 0, TAU); g.fill();
        g.fillStyle = "rgba(255,255,255,.7)"; g.fillRect(60, H * 0.78, W - 120, 6); g.fillRect(90, H * 0.84, W - 180, 6);
      } else {
        const sky = g.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, "#f7b267"); sky.addColorStop(0.5, "#e2637a"); sky.addColorStop(1, "#3b2a6b");
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        g.fillStyle = "#ffd98a"; g.beginPath(); g.arc(W * 0.62, H * 0.42, 40, 0, TAU); g.fill();
        g.fillStyle = "#2a1f4e";
        g.beginPath(); g.moveTo(0, H * 0.7); g.lineTo(60, H * 0.52); g.lineTo(120, H * 0.66); g.lineTo(170, H * 0.5); g.lineTo(W, H * 0.68); g.lineTo(W, H); g.lineTo(0, H); g.fill();
        g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(40, H * 0.86, W - 80, 8);
      }
      g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 8; g.strokeRect(0, 0, W, H);
      return texOf(c);
    }

    function neonTex() {
      const W = 512, H = 192;
      const c = surface(W, H);
      const g = c.getContext("2d");
      g.fillStyle = "#07050a"; g.fillRect(0, 0, W, H);
      g.font = "bold 118px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.shadowColor = "#ff4fa3"; g.shadowBlur = 36;
      g.fillStyle = "#ffb3dc"; g.fillText("LANES", W / 2, H * 0.46);
      g.shadowBlur = 18; g.fillStyle = "#fff0f8"; g.fillText("LANES", W / 2, H * 0.46);
      g.shadowColor = "#39b6ff"; g.shadowBlur = 24; g.strokeStyle = "#bde9ff"; g.lineWidth = 7; g.lineCap = "round";
      g.beginPath(); g.moveTo(60, H * 0.84); g.lineTo(W - 60, H * 0.84); g.stroke();
      return texOf(c);
    }

    function meshBumpTex() {
      const S = 128;
      const c = surface(S, S);
      const g = c.getContext("2d");
      g.fillStyle = "#808080"; g.fillRect(0, 0, S, S);
      g.strokeStyle = "#ffffff"; g.lineWidth = 3;
      for (let k = 0; k < S; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.moveTo(0, k); g.lineTo(S, k); g.stroke(); }
      const t = texOf(c, { srgb: false, repeat: [10, 4] });
      return t;
    }

    /** Soft round falloff — used for the trail, the flies and the glows. */
    function glowTex(inner, outer) {
      const S = 64;
      const c = surface(S, S);
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      grad.addColorStop(0, inner);
      grad.addColorStop(0.4, outer);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad; g.fillRect(0, 0, S, S);
      return texOf(c);
    }

    /**
     * A small equirectangular room for reflections: bright ceiling, mid walls,
     * dark floor, painted as bands with literal colours. Chrome and gloss
     * are nothing without something to reflect.
     */
    function envTex(kind) {
      const W = 256, H = 128;
      const c = surface(W, H);
      const g = c.getContext("2d");
      const stops = kind === "office"
        ? [[244, 246, 250], [200, 206, 216], [138, 144, 160], [60, 63, 72]]
        : kind === "bar"
          ? [[96, 60, 34], [52, 32, 22], [30, 19, 13], [8, 5, 4]]
          : [[82, 78, 70], [48, 46, 42], [28, 27, 25], [9, 9, 8]];
      const bands = 40;
      for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1) * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
        const a = stops[k], b = stops[k + 1];
        g.fillStyle = rgb(lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f));
        g.fillRect(0, i * H / bands, W, H / bands + 1);
      }
      g.fillStyle = kind === "bar" ? "rgba(255,200,150,.9)" : "rgba(255,255,255,.95)";
      for (let i = 0; i < 4; i++) g.fillRect(20 + i * 62, 16, 36, 10);
      if (kind === "bar") {
        g.fillStyle = "rgba(255,90,170,.7)"; g.fillRect(100, 44, 60, 8);
        g.fillStyle = "rgba(80,170,255,.6)"; g.fillRect(190, 50, 40, 6);
      }
      const t = new THREE.CanvasTexture(c);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    // ===================================================================== //
    // 4. Renderer, camera, shared materials, builders                       //
    // ===================================================================== //
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8d94a2);

    // Seated at the desk, looking slightly down the room. World units are
    // metres: the floor is y = 0, the desk top is 0.74, the camera looks down
    // the -z axis.
    const camera = new THREE.PerspectiveCamera(70, ctx.width / Math.max(1, ctx.height), 0.05, 40);
    const CAM_POS = new THREE.Vector3(0, 1.38, 0);
    const CAM_PITCH = 19 * Math.PI / 180;
    camera.position.copy(CAM_POS);
    camera.rotation.set(-CAM_PITCH, 0, 0);

    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.5, metalness: 0.3 });

    function box(w, h, d, mat, x, y, z, o) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = !(o && o.noCast);
      m.receiveShadow = true;
      if (o && o.ry) m.rotation.y = o.ry;
      if (o && o.rx) m.rotation.x = o.rx;
      return m;
    }
    function cyl(rt, rb, h, mat, x, y, z, seg) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 24), mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    }
    function shadowSetup(light, size) {
      light.castShadow = true;
      light.shadow.mapSize.set(1536, 1536);
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 24;
      light.shadow.camera.left = -size; light.shadow.camera.right = size;
      light.shadow.camera.top = size; light.shadow.camera.bottom = -size;
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = 2.5;
    }

    const screenOn = screenTex(true), screenOff = screenTex(false);
    const cardboard = cardboardTex();

    // ===================================================================== //
    // 5. The three rooms                                                    //
    // ===================================================================== //
    function makeRoom() {
      const room = { group: new THREE.Group(), cols: [] };
      const g = room.group, cols = room.cols;

      room.plant = function (x, y, z, s) {
        const pot = cyl(0.07 * s, 0.055 * s, 0.11 * s, new THREE.MeshStandardMaterial({ color: 0xb5613a, roughness: 0.8 }), x, y + 0.055 * s, z);
        g.add(pot);
        const leafA = new THREE.MeshStandardMaterial({ color: 0x2f7d36, roughness: 0.7 });
        const leafB = new THREE.MeshStandardMaterial({ color: 0x4a9d4a, roughness: 0.7 });
        for (let i = 0; i < 7; i++) {
          const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 * s, 1), i % 2 ? leafA : leafB);
          const a = (i / 7) * TAU;
          b.position.set(x + Math.cos(a) * 0.05 * s, y + (0.16 + rnd(0, 0.06)) * s, z + Math.sin(a) * 0.05 * s);
          b.scale.set(1, 1.5, 1);
          b.castShadow = true;
          g.add(b);
        }
      };

      room.desk = function (x, z, w, d, mat, legMat) {
        g.add(box(w, 0.035, d, mat, x, 0.7225, z));
        g.add(box(0.03, 0.7, d - 0.06, legMat, x - w / 2 + 0.03, 0.35, z));
        g.add(box(0.03, 0.7, d - 0.06, legMat, x + w / 2 - 0.03, 0.35, z));
        g.add(box(w - 0.1, 0.4, 0.02, legMat, x, 0.45, z - d / 2 + 0.03));
        cols.push({ minx: x - w / 2, maxx: x + w / 2, miny: 0, maxy: 0.74, minz: z - d / 2, maxz: z + d / 2 });
      };

      room.monitor = function (x, z, ry, on) {
        const m = new THREE.Group();
        m.position.set(x, 0.74, z);
        m.rotation.y = ry || 0;
        m.add(box(0.22, 0.015, 0.16, blackMat, 0, 0.0075, 0));
        m.add(box(0.04, 0.12, 0.03, blackMat, 0, 0.07, -0.03));
        m.add(box(0.54, 0.34, 0.03, blackMat, 0, 0.3, -0.02));
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: 0xffffff, emissiveMap: on ? screenOn : screenOff,
          emissiveIntensity: on ? 1.15 : 0.25, roughness: 0.25, metalness: 0.1
        }));
        scr.position.set(0, 0.3, -0.004);
        m.add(scr);
        g.add(m);
      };

      room.chair = function (x, z, ry) {
        const c = new THREE.Group();
        c.position.set(x, 0, z);
        c.rotation.y = ry || 0;
        const blk = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.75 });
        const mesh = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.9 });
        c.add(box(0.46, 0.08, 0.46, blk, 0, 0.47, 0));
        c.add(box(0.44, 0.5, 0.06, mesh, 0, 0.78, -0.22));
        c.add(cyl(0.025, 0.025, 0.4, chromeMat, 0, 0.23, 0));
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU;
          c.add(box(0.3, 0.025, 0.04, blk, Math.cos(a) * 0.15, 0.03, Math.sin(a) * 0.15, { ry: -a }));
          const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), blk);
          wheel.position.set(Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3);
          c.add(wheel);
        }
        for (const sx of [-0.24, 0.24]) {
          c.add(box(0.05, 0.02, 0.3, blk, sx, 0.68, -0.02));
          c.add(box(0.05, 0.2, 0.04, blk, sx, 0.58, 0.05));
        }
        g.add(c);
        cols.push({ minx: x - 0.25, maxx: x + 0.25, miny: 0, maxy: 1.0, minz: z - 0.25, maxz: z + 0.25 });
      };

      room.boxStack = function (x, z) {
        const cb = new THREE.MeshStandardMaterial({ map: cardboard, roughness: 0.9 });
        g.add(box(0.5, 0.36, 0.42, cb, x, 0.18, z, { ry: 0.1 }));
        g.add(box(0.42, 0.3, 0.36, cb, x + 0.03, 0.51, z - 0.02, { ry: -0.15 }));
        g.add(box(0.3, 0.24, 0.3, cb, x - 0.05, 0.78, z + 0.03, { ry: 0.3 }));
        cols.push({ minx: x - 0.27, maxx: x + 0.27, miny: 0, maxy: 0.9, minz: z - 0.23, maxz: z + 0.23 });
      };

      room.flies = [];
      return room;
    }

    function buildOffice() {
      const room = makeRoom();
      const g = room.group, cols = room.cols;

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 24),
        new THREE.MeshStandardMaterial({ map: carpetTex([80, 94, 122], [150, 160, 178]), roughness: 0.96 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -6); floor.receiveShadow = true; g.add(floor);

      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshStandardMaterial({ map: ceilingTex(), roughness: 0.95 }));
      ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 2.75, -6); g.add(ceil);
      const panelMat = new THREE.MeshBasicMaterial({ color: 0xf6f8ff });
      for (const z of [-3.4, -6.2, -9.0]) for (const x of [-1.25, 1.25]) g.add(box(0.6, 0.02, 1.2, panelMat, x, 2.74, z, { noCast: true }));

      const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.92 });
      g.add(box(16, 2.75, 0.1, wallMat, 0, 1.375, -10.05));
      g.add(box(0.1, 2.75, 24, wallMat, -3.65, 1.375, -6));
      g.add(box(0.1, 2.75, 24, wallMat, 3.65, 1.375, -6));
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x55514b, roughness: 0.8 });
      g.add(box(16, 0.1, 0.04, baseMat, 0, 0.05, -9.98));
      g.add(box(0.04, 0.1, 24, baseMat, -3.58, 0.05, -6));
      g.add(box(0.04, 0.1, 24, baseMat, 3.58, 0.05, -6));

      // A window strip on the right wall: cool daylight against warm panels.
      const glass = new THREE.MeshBasicMaterial({ color: 0xe9f2ff });
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.6, metalness: 0.3 });
      const win = new THREE.Group();
      win.position.set(3.59, 1.65, -6.5);
      win.add(box(0.03, 1.3, 4.2, glass, 0, 0, 0, { noCast: true }));
      win.add(box(0.06, 0.06, 4.3, frameMat, -0.01, 0.68, 0));
      win.add(box(0.06, 0.06, 4.3, frameMat, -0.01, -0.68, 0));
      for (const zz of [-2.1, -1.05, 0, 1.05, 2.1]) win.add(box(0.06, 1.4, 0.06, frameMat, -0.01, 0, zz));
      win.add(box(0.14, 0.04, 4.4, frameMat, -0.05, -0.72, 0));
      g.add(win);

      // Cubicle partitions.
      const fabric = new THREE.MeshStandardMaterial({ map: fabricTex(), roughness: 0.95 });
      const alu = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.8, roughness: 0.35 });
      function partition(len, x, z, ry) {
        const p = new THREE.Group();
        p.position.set(x, 0, z); p.rotation.y = ry || 0;
        p.add(box(len, 1.5, 0.05, fabric, 0, 0.8, 0));
        p.add(box(len + 0.02, 0.035, 0.07, alu, 0, 1.567, 0));
        p.add(box(len + 0.02, 0.1, 0.07, alu, 0, 0.05, 0));
        p.add(box(0.05, 1.6, 0.07, alu, -len / 2, 0.8, 0));
        p.add(box(0.05, 1.6, 0.07, alu, len / 2, 0.8, 0));
        g.add(p);
        if (!ry) cols.push({ minx: x - len / 2, maxx: x + len / 2, miny: 0, maxy: 1.6, minz: z - 0.04, maxz: z + 0.04 });
        else cols.push({ minx: x - 0.04, maxx: x + 0.04, miny: 0, maxy: 1.6, minz: z - len / 2, maxz: z + len / 2 });
      }
      partition(2, -2, -8.2); partition(2, 0, -8.2); partition(2, 2, -8.2);
      partition(2.6, -1.55, -6.9, Math.PI / 2);
      partition(2.6, 1.55, -6.9, Math.PI / 2);
      partition(2, -3.6 + 1, -4.6, 0);
      partition(1.4, -2.6, -5.3, Math.PI / 2);

      // Posters pinned to the back partitions.
      const po1 = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.55), new THREE.MeshStandardMaterial({ map: posterTex(0), roughness: 0.85 }));
      po1.position.set(-0.6, 1.0, -8.17); g.add(po1);
      const po2 = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.55), new THREE.MeshStandardMaterial({ map: posterTex(1), roughness: 0.85 }));
      po2.position.set(1.9, 1.0, -8.17); po2.rotation.z = 0.03; g.add(po2);

      // Desks with their clutter.
      const lam = new THREE.MeshStandardMaterial({ map: woodTex(206, 182, 146), roughness: 0.55, metalness: 0.02 });
      const side = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.7, metalness: 0.2 });
      room.desk(-0.95, -7.6, 1.7, 0.75, lam, side);
      room.monitor(-0.95, -7.72, 0.08, true);
      const keyMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6 });
      g.add(box(0.44, 0.018, 0.15, keyMat, -0.95, 0.749, -7.38));
      g.add(box(0.4, 0.006, 0.11, new THREE.MeshStandardMaterial({ color: 0x3b3f47, roughness: 0.5 }), -0.95, 0.761, -7.38));
      g.add(box(0.06, 0.03, 0.1, keyMat, -0.6, 0.755, -7.4));
      const mugMat = new THREE.MeshStandardMaterial({ color: 0x2b5db5, roughness: 0.35 });
      g.add(cyl(0.042, 0.038, 0.1, mugMat, -1.52, 0.79, -7.5));
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.007, 8, 20), mugMat);
      handle.position.set(-1.475, 0.79, -7.5); g.add(handle);
      const paperMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ea, roughness: 0.9 });
      for (let i = 0; i < 3; i++) g.add(box(0.21, 0.003, 0.3, paperMat, -0.42 + i * 0.01, 0.742 + i * 0.003, -7.55, { ry: (i - 1) * 0.12 }));
      room.plant(-1.7, 0.74, -7.75, 0.6);

      room.desk(2.1, -7.6, 1.4, 0.75, lam, side);
      room.monitor(2.1, -7.72, -0.1, false);
      g.add(box(0.2, 0.05, 0.16, keyMat, 2.6, 0.765, -7.5));

      // Filing cabinet with three drawers.
      const cabMat = new THREE.MeshStandardMaterial({ color: 0x8f939a, roughness: 0.55, metalness: 0.35 });
      const frontMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.35 });
      g.add(box(0.47, 1.05, 0.6, cabMat, 0.75, 0.525, -7.6));
      for (let i = 0; i < 3; i++) {
        const y = 0.19 + i * 0.33;
        g.add(box(0.41, 0.29, 0.02, frontMat, 0.75, y, -7.3));
        g.add(box(0.12, 0.02, 0.025, chromeMat, 0.75, y + 0.08, -7.28));
      }
      cols.push({ minx: 0.515, maxx: 0.985, miny: 0, maxy: 1.05, minz: -7.9, maxz: -7.3 });

      room.chair(0.35, -6.5, 0.5);
      room.plant(-2.9, 0, -5.8, 2.6);
      room.boxStack(2.9, -5.6);

      // Mid-room: side returns, a water cooler, a printer on a stand.
      partition(1.8, -2.0, -5.7, Math.PI / 2);
      partition(1.8, 2.0, -5.7, Math.PI / 2);
      const po3 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.47), new THREE.MeshStandardMaterial({ map: posterTex(1), roughness: 0.85 }));
      po3.position.set(-1.97, 1.0, -5.5); po3.rotation.y = Math.PI / 2; g.add(po3);
      g.add(box(0.32, 0.95, 0.32, new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.5 }), -1.6, 0.475, -5.2));
      const bottleMat = new THREE.MeshStandardMaterial({ color: 0x6fb7ff, roughness: 0.15, transparent: true, opacity: 0.75, envMapIntensity: 1.2 });
      g.add(cyl(0.13, 0.13, 0.42, bottleMat, -1.6, 1.18, -5.2));
      g.add(cyl(0.05, 0.11, 0.1, bottleMat, -1.6, 1.44, -5.2));
      g.add(box(0.06, 0.05, 0.08, new THREE.MeshStandardMaterial({ color: 0x3a6fd8, roughness: 0.4 }), -1.6, 0.8, -5.03));
      cols.push({ minx: -1.76, maxx: -1.44, miny: 0, maxy: 1.5, minz: -5.36, maxz: -5.04 });
      g.add(box(0.6, 0.7, 0.5, side, 1.75, 0.35, -5.3));
      g.add(box(0.5, 0.22, 0.42, new THREE.MeshStandardMaterial({ color: 0xd8d9dc, roughness: 0.5 }), 1.75, 0.81, -5.3));
      g.add(box(0.3, 0.02, 0.2, paperMat, 1.75, 0.93, -5.3));
      cols.push({ minx: 1.45, maxx: 2.05, miny: 0, maxy: 0.95, minz: -5.55, maxz: -5.05 });

      // Lights: fluorescent panels overhead, daylight from the window.
      g.add(new THREE.HemisphereLight(0xe6edf8, 0x4a4f5c, 1.1));
      const key = new THREE.DirectionalLight(0xfff3df, 2.2);
      key.position.set(2.5, 5, -1.5); key.target.position.set(0, 0, -4.5);
      g.add(key); g.add(key.target);
      shadowSetup(key, 7);
      const day = new THREE.DirectionalLight(0xdfe9ff, 1.0);
      day.position.set(6, 3, -6.5); day.target.position.set(0, 0, -6.5);
      g.add(day); g.add(day.target);
      const p1 = new THREE.PointLight(0xeef3ff, 8, 9, 2); p1.position.set(-1.2, 2.55, -3.3); g.add(p1);
      const p2 = new THREE.PointLight(0xeef3ff, 8, 9, 2); p2.position.set(1.2, 2.55, -6.4); g.add(p2);

      room.fog = [0xc3c8d2, 7, 17];
      room.bg = 0xc3c8d2;
      room.env = "office";
      room.flies = [[0.6, 0.02, -3.0], [-0.55, 0.03, -4.3]];
      return room;
    }

    function buildBasement() {
      const room = makeRoom();
      const g = room.group, cols = room.cols;

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.85 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -6); floor.receiveShadow = true; g.add(floor);

      const cinder = new THREE.MeshStandardMaterial({ map: cinderTex(), roughness: 0.95 });
      g.add(box(16, 2.75, 0.1, cinder, 0, 1.375, -10.05));
      g.add(box(0.1, 2.75, 24, cinder, -3.65, 1.375, -6));
      g.add(box(0.1, 2.75, 24, cinder, 3.65, 1.375, -6));

      // Ceiling: dark boards, joists, two pipes and a duct.
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95 }));
      ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 2.75, -6); g.add(ceil);
      const joist = new THREE.MeshStandardMaterial({ color: 0x4a3f34, roughness: 0.9 });
      for (let z = -1.2; z > -11; z -= 1.2) g.add(box(7.3, 0.2, 0.06, joist, 0, 2.65, z));
      const pipeMat = new THREE.MeshStandardMaterial({ color: 0x5b5b5e, metalness: 0.7, roughness: 0.45 });
      for (const x of [-1.3, 1.05]) { const p = cyl(0.035, 0.035, 24, pipeMat, x, 2.5, -6, 12); p.rotation.x = Math.PI / 2; g.add(p); }
      g.add(box(0.42, 0.3, 24, new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.6, roughness: 0.5 }), 2.2, 2.45, -6));

      // One hanging bulb with a tin shade.
      const cord = cyl(0.006, 0.006, 0.45, blackMat, 0.3, 2.52, -3.4, 8); g.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.13, 24, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
      shade.position.set(0.3, 2.27, -3.4); g.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }));
      bulb.position.set(0.3, 2.2, -3.4); g.add(bulb);

      // Shelving, boxes, a workbench, a water heater, an old chair.
      function shelving(x, z, ry) {
        const s = new THREE.Group();
        s.position.set(x, 0, z); s.rotation.y = ry || 0;
        const met = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.55, metalness: 0.6 });
        for (const sx of [-0.45, 0.45]) for (const sz of [-0.2, 0.2]) s.add(box(0.035, 1.9, 0.035, met, sx, 0.95, sz));
        for (let i = 0; i < 4; i++) s.add(box(0.95, 0.025, 0.45, met, 0, 0.1 + i * 0.55, 0));
        const cb = new THREE.MeshStandardMaterial({ map: cardboard, roughness: 0.9 });
        s.add(box(0.36, 0.3, 0.32, cb, -0.25, 0.2625, 0));
        s.add(box(0.3, 0.25, 0.3, cb, 0.22, 0.2375, 0.02, { ry: 0.2 }));
        s.add(box(0.4, 0.28, 0.34, cb, 0.1, 0.8025, 0));
        s.add(box(0.26, 0.2, 0.26, cb, -0.3, 1.3125, 0.05));
        const can = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.35 });
        s.add(cyl(0.07, 0.07, 0.16, can, -0.3, 1.8425, 0));
        s.add(cyl(0.06, 0.06, 0.13, can, -0.12, 1.8275, 0.05));
        s.add(cyl(0.05, 0.05, 0.1, new THREE.MeshStandardMaterial({ color: 0xc43b2f, roughness: 0.5 }), 0.3, 1.8125, 0));
        g.add(s);
        cols.push({ minx: x - 0.5, maxx: x + 0.5, miny: 0, maxy: 1.9, minz: z - 0.25, maxz: z + 0.25 });
      }
      shelving(-2.3, -8.6);
      shelving(2.4, -7.2, 0.35);
      shelving(-3.1, -4.8, Math.PI / 2);

      const bench = new THREE.MeshStandardMaterial({ map: woodTex(150, 118, 80), roughness: 0.8 });
      const benchLeg = new THREE.MeshStandardMaterial({ color: 0x3b3430, roughness: 0.85 });
      room.desk(0.4, -8.9, 1.9, 0.7, bench, benchLeg);
      g.add(box(0.42, 0.2, 0.2, new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.45, metalness: 0.3 }), 0.8, 0.84, -8.95));
      g.add(box(0.3, 0.02, 0.3, benchLeg, -0.2, 0.75, -8.9));
      g.add(cyl(0.05, 0.05, 0.12, new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.3, transparent: true, opacity: 0.8 }), -0.2, 0.82, -8.9));

      const heater = cyl(0.28, 0.28, 1.45, new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.4, metalness: 0.2 }), 2.9, 0.725, -9.3);
      g.add(heater);
      g.add(cyl(0.025, 0.025, 1.3, pipeMat, 2.9, 2.1, -9.3, 10));
      cols.push({ minx: 2.6, maxx: 3.2, miny: 0, maxy: 1.5, minz: -9.6, maxz: -9.0 });

      room.boxStack(1.6, -5.2);
      room.boxStack(-1.9, -6.6);
      room.chair(-0.9, -6.1, -0.6);

      g.add(new THREE.HemisphereLight(0x5d6b80, 0x14120f, 0.5));
      const key = new THREE.DirectionalLight(0xffd9a0, 1.4);
      key.position.set(1.2, 5, -2); key.target.position.set(0, 0, -4.5);
      g.add(key); g.add(key.target);
      shadowSetup(key, 7);
      const b1 = new THREE.PointLight(0xffd08a, 14, 11, 2); b1.position.set(0.3, 2.2, -3.4); g.add(b1);
      const b2 = new THREE.PointLight(0xffc070, 5, 9, 2); b2.position.set(-1.5, 2.2, -7.6); g.add(b2);

      room.fog = [0x151412, 5.5, 15];
      room.bg = 0x151412;
      room.env = "basement";
      room.flies = [[0.5, 0.02, -2.8], [-0.7, 0.03, -4.0], [0.2, 0.05, -5.5]];
      return room;
    }

    function buildBar() {
      const room = makeRoom();
      const g = room.group, cols = room.cols;

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshStandardMaterial({ map: plankTex(), roughness: 0.5, metalness: 0.05 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -6); floor.receiveShadow = true; g.add(floor);

      const plaster = new THREE.MeshStandardMaterial({ color: 0x5a2a22, roughness: 0.9 });
      const darkWood = new THREE.MeshStandardMaterial({ map: woodTex(70, 42, 24), roughness: 0.55, metalness: 0.05 });
      const glossWood = new THREE.MeshStandardMaterial({ map: woodTex(110, 66, 34), roughness: 0.25, metalness: 0.1, envMapIntensity: 1.1 });
      g.add(box(16, 2.75, 0.1, plaster, 0, 1.375, -10.05));
      g.add(box(0.1, 2.75, 24, plaster, -3.65, 1.375, -6));
      g.add(box(0.1, 2.75, 24, plaster, 3.65, 1.375, -6));
      for (const x of [-3.6, 3.6]) { g.add(box(0.06, 0.9, 24, darkWood, x, 0.45, -6)); g.add(box(0.1, 0.05, 24, darkWood, x, 0.92, -6)); }
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.95 }));
      ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 2.75, -6); g.add(ceil);

      // The bar: counter, top, brass rail, stools.
      g.add(box(6, 1.05, 0.5, darkWood, 0, 0.525, -6.9));
      g.add(box(6.3, 0.05, 0.75, glossWood, 0, 1.075, -6.95));
      cols.push({ minx: -3.15, maxx: 3.15, miny: 0, maxy: 1.1, minz: -7.35, maxz: -6.55 });
      const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3, envMapIntensity: 1.3 });
      const rail = cyl(0.02, 0.02, 6, brass, 0, 0.22, -6.5, 12); rail.rotation.z = Math.PI / 2; g.add(rail);
      for (const x of [-2.6, -0.9, 0.9, 2.6]) g.add(box(0.03, 0.22, 0.03, brass, x, 0.11, -6.58));
      function stool(x, z) {
        const seat = new THREE.MeshStandardMaterial({ color: 0x7a2424, roughness: 0.5 });
        g.add(cyl(0.19, 0.19, 0.07, seat, x, 0.715, z));
        g.add(cyl(0.025, 0.025, 0.65, chromeMat, x, 0.355, z));
        g.add(cyl(0.2, 0.22, 0.03, chromeMat, x, 0.015, z));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 28), chromeMat);
        ring.rotation.x = Math.PI / 2; ring.position.set(x, 0.25, z); g.add(ring);
        cols.push({ minx: x - 0.2, maxx: x + 0.2, miny: 0, maxy: 0.75, minz: z - 0.2, maxz: z + 0.2 });
      }
      stool(-1.9, -6.1); stool(-0.65, -6.15); stool(0.65, -6.1); stool(1.9, -6.15);

      // Back bar: lit shelves, bottles, the neon sign, three pins.
      g.add(box(4.6, 1.5, 0.08, darkWood, 0, 1.55, -9.98));
      const backlight = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.2), new THREE.MeshStandardMaterial({ color: 0x1a0a14, emissive: 0xff5fa8, emissiveIntensity: 0.45, roughness: 1 }));
      backlight.position.set(0, 1.6, -9.93); g.add(backlight);
      for (const y of [1.25, 1.65]) g.add(box(4.4, 0.03, 0.26, glossWood, 0, y, -9.8));
      const tints = [0x2e8b57, 0xd98c1f, 0xcfe8ff, 0xa52a2a, 0x3a6fd8, 0x8bc34a];
      for (let i = 0; i < 22; i++) {
        const x = -2.05 + (i % 11) * 0.41 + rnd(-0.04, 0.04), y = i < 11 ? 1.265 : 1.665;
        const mat = new THREE.MeshStandardMaterial({ color: tints[i % tints.length], roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 1.3 });
        g.add(cyl(0.034, 0.036, 0.27, mat, x, y + 0.135, -9.8, 14));
        g.add(cyl(0.013, 0.02, 0.1, mat, x, y + 0.32, -9.8, 10));
      }
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: 0xffffff, emissiveMap: neonTex(), emissiveIntensity: 1.3, roughness: 1
      }));
      neon.position.set(0, 2.2, -9.96); g.add(neon);
      const pinMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.3 });
      const pinBand = new THREE.MeshStandardMaterial({ color: 0xc8302b, roughness: 0.35 });
      for (let i = 0; i < 3; i++) {
        const x = 1.5 + i * 0.16, y = 1.68, z = -9.78;
        g.add(cyl(0.025, 0.04, 0.13, pinMat, x, y + 0.065, z, 14));
        g.add(cyl(0.028, 0.025, 0.05, pinMat, x, y + 0.155, z, 14));
        g.add(cyl(0.03, 0.03, 0.012, pinBand, x, y + 0.14, z, 14));
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), pinMat); head.position.set(x, y + 0.2, z); g.add(head);
      }

      // Pendant lamps over the bar.
      const shadeMat = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
      for (const x of [-1.6, 0, 1.6]) {
        g.add(cyl(0.005, 0.005, 0.7, blackMat, x, 2.4, -6.9, 6));
        const sh = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.18, 24, 1, true), shadeMat);
        sh.position.set(x, 2.0, -6.9); g.add(sh);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a6 }));
        bulb.position.set(x, 1.94, -6.9); g.add(bulb);
        if (x === 0) { const pl = new THREE.PointLight(0xffb070, 16, 9, 2); pl.position.set(x, 1.9, -6.9); g.add(pl); }
      }

      // A dartboard on the left wall and a couple of tables far right.
      const dart = new THREE.Group(); dart.position.set(-3.58, 1.7, -5.2); dart.rotation.y = Math.PI / 2;
      dart.add(cyl(0.23, 0.23, 0.03, blackMat, 0, 0, 0, 28).rotateX(Math.PI / 2));
      const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 6, 32), pinBand); dart.add(r1);
      const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 32), new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.5 })); dart.add(r2);
      g.add(dart);
      for (const t of [[2.9, -4.6], [2.9, -3.2]]) {
        g.add(cyl(0.3, 0.3, 0.035, glossWood, t[0], 0.75, t[1], 24));
        g.add(cyl(0.03, 0.03, 0.72, chromeMat, t[0], 0.37, t[1], 12));
        g.add(cyl(0.22, 0.25, 0.02, chromeMat, t[0], 0.01, t[1], 24));
        cols.push({ minx: t[0] - 0.3, maxx: t[0] + 0.3, miny: 0, maxy: 0.77, minz: t[1] - 0.3, maxz: t[1] + 0.3 });
      }

      g.add(new THREE.HemisphereLight(0x5a464c, 0x160f0b, 0.85));
      const key = new THREE.DirectionalLight(0xffc896, 1.8);
      key.position.set(1.5, 5, -1); key.target.position.set(0, 0, -4.5);
      g.add(key); g.add(key.target);
      shadowSetup(key, 7);
      const pink = new THREE.PointLight(0xff6fb0, 9, 9, 2); pink.position.set(0, 2.0, -9.2); g.add(pink);
      const blue = new THREE.PointLight(0x4aa8ff, 5, 8, 2); blue.position.set(-3, 2.2, -4); g.add(blue);
      const warm = new THREE.PointLight(0xffb070, 6, 8, 2); warm.position.set(1.5, 2.3, -2.8); g.add(warm);

      room.fog = [0x160d09, 6, 15];
      room.bg = 0x160d09;
      room.env = "bar";
      room.flies = [[0.7, 0.03, -3.2], [-0.4, 0.02, -4.6]];
      return room;
    }

    const rooms = {};
    const envMaps = {};
    let room = null;
    let activeCols = [];
    function useRoom(kind) {
      if (room && room.kind === kind) return;
      if (room) scene.remove(room.group);
      if (!rooms[kind]) {
        rooms[kind] = kind === "basement" ? buildBasement() : kind === "bar" ? buildBar() : buildOffice();
        rooms[kind].kind = kind;
      }
      room = rooms[kind];
      scene.add(room.group);
      scene.fog = new THREE.Fog(room.fog[0], room.fog[1], room.fog[2]);
      scene.background = new THREE.Color(room.bg);
      if (!envMaps[room.env]) envMaps[room.env] = envTex(room.env);
      scene.environment = envMaps[room.env];
      activeCols = room.cols;
      placeFlies(room.flies);
    }

    // ===================================================================== //
    // 6. The things that are in every room                                  //
    // ===================================================================== //
    // The player's desk: a square top seen over its far corner, so the wedge
    // of wood at the bottom of the frame points up the room.
    const deskWood = new THREE.MeshStandardMaterial({ map: woodTex(196, 150, 92), roughness: 0.5, metalness: 0.03 });
    const deskGroup = new THREE.Group();
    deskGroup.add(box(0.9, 0.04, 0.9, deskWood, 0, 0.72, -0.33, { ry: Math.PI / 4 }));
    deskGroup.add(box(0.86, 0.09, 0.86, new THREE.MeshStandardMaterial({ color: 0x6e4a2a, roughness: 0.75 }), 0, 0.655, -0.33, { ry: Math.PI / 4 }));
    scene.add(deskGroup);
    const DESK = { cx: 0, cz: -0.33, hw: 0.45, hd: 0.45, miny: 0, maxy: 0.74, ry: Math.PI / 4 };

    // The fan.
    function buildFan() {
      const f = new THREE.Group();
      f.add(cyl(0.12, 0.14, 0.03, chromeMat, 0, 0.015, 0, 32));
      f.add(cyl(0.016, 0.016, 0.22, chromeMat, 0, 0.14, 0, 12));
      const head = new THREE.Group();
      head.position.set(0, 0.27, 0);
      f.add(head);
      const motor = cyl(0.05, 0.062, 0.12, blackMat, 0, 0, -0.065, 24);
      motor.rotation.x = Math.PI / 2;
      head.add(motor);
      const blades = new THREE.Group();
      blades.position.z = 0.02;
      head.add(blades);
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide, envMapIntensity: 1.2 });
      for (let i = 0; i < 3; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.z = (i / 3) * TAU;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.125, 0.004), bladeMat);
        b.position.set(0, 0.078, 0);
        b.rotation.y = 0.55;
        b.castShadow = true;
        pivot.add(b);
        blades.add(pivot);
      }
      const hub = cyl(0.022, 0.022, 0.025, chromeMat, 0, 0, 0, 16); hub.rotation.x = Math.PI / 2; blades.add(hub);
      const ringGeo = new THREE.TorusGeometry(0.155, 0.004, 8, 48);
      const rf = new THREE.Mesh(ringGeo, chromeMat); rf.position.z = 0.075; head.add(rf);
      const rb = new THREE.Mesh(ringGeo, chromeMat); rb.position.z = -0.02; head.add(rb);
      for (const rr of [0.05, 0.1]) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0025, 6, 32), chromeMat); r.position.z = 0.075; head.add(r);
      }
      const wireGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 0.155, 6);
      for (let i = 0; i < 16; i++) {
        const w = new THREE.Mesh(wireGeo, chromeMat);
        const a = (i / 16) * TAU;
        w.position.set(Math.cos(a) * 0.0775, Math.sin(a) * 0.0775, 0.075);
        w.rotation.z = a + Math.PI / 2;
        head.add(w);
        const w2 = w.clone(); w2.position.z = -0.02; head.add(w2);
      }
      const badge = cyl(0.03, 0.03, 0.006, blackMat, 0, 0, 0.08, 20); badge.rotation.x = Math.PI / 2; head.add(badge);
      f.userData = { head: head, blades: blades };
      return f;
    }
    const fan = buildFan();
    scene.add(fan);
    let fanSide = 1;
    function placeFan(side) {
      if (side) fanSide = side;
      fan.position.set(fanSide * 0.42, 0, -1.55);
      fan.rotation.y = fanSide > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    placeFan(1);

    // The bin: a cone frustum with a lip, lathed from its profile.
    const BIN_PROFILE = [[0, 0.004], [0.113, 0.004], [0.117, 0.02], [0.159, 0.30], [0.171, 0.31], [0.171, 0.325], [0.161, 0.33], [0.151, 0.30], [0.108, 0.015], [0, 0.015]];
    const binGeo = new THREE.LatheGeometry(BIN_PROFILE.map((p) => new THREE.Vector2(p[0], p[1])), 44);
    const BIN_SKINS = {
      orange: { color: 0xe2601c, name: "Orange", price: 0, css: "#e8702a" },
      blue: { color: 0x2f62c4, name: "Blue", price: 250, css: "#3a74d8" },
      green: { color: 0x3c8a3a, name: "Green", price: 250, css: "#4a9d48" },
      red: { color: 0xc42e2a, name: "Red", price: 400, css: "#d63a34" },
      steel: { color: 0x9aa0a6, name: "Steel mesh", price: 800, css: "#aab0b6", metal: true }
    };
    const PAPER_SKINS = {
      plain: { name: "Plain", price: 0, css: "#f1f0ea" },
      sticky: { name: "Sticky note", price: 200, css: "#f6e46b" },
      news: { name: "Newspaper", price: 350, css: "#d2cfc5" },
      memo: { name: "Pink memo", price: 350, css: "#f7b8c9" },
      foil: { name: "Gold foil", price: 900, css: "#f3cd62" }
    };
    const binGroup = new THREE.Group();
    const binMesh = new THREE.Mesh(binGeo, new THREE.MeshPhysicalMaterial({ color: 0xe2601c, roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.4, side: THREE.DoubleSide, envMapIntensity: 0.8 }));
    binMesh.castShadow = true; binMesh.receiveShadow = true;
    binGroup.add(binMesh);
    const lipMesh = new THREE.Mesh(new THREE.TorusGeometry(0.164, 0.012, 10, 52), new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.55, metalness: 0.1 }));
    lipMesh.rotation.x = Math.PI / 2; lipMesh.position.y = 0.322; lipMesh.castShadow = true;
    binGroup.add(lipMesh);
    const binFloor = new THREE.Mesh(new THREE.CircleGeometry(0.108, 32), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 1 }));
    binFloor.rotation.x = -Math.PI / 2; binFloor.position.y = 0.0165;
    binGroup.add(binFloor);
    scene.add(binGroup);
    let meshBump = null;
    function skinBin(id) {
      const s = BIN_SKINS[id] || BIN_SKINS.orange;
      const m = binMesh.material;
      m.color.setHex(s.color);
      if (s.metal) {
        if (!meshBump) meshBump = meshBumpTex();
        m.metalness = 0.85; m.roughness = 0.38; m.clearcoat = 0; m.bumpMap = meshBump; m.bumpScale = 0.0025; m.envMapIntensity = 1.3;
      } else {
        m.metalness = 0; m.roughness = 0.45; m.clearcoat = 0.35; m.bumpMap = null; m.envMapIntensity = 0.8;
      }
      m.needsUpdate = true;
    }

    // The crumpled sheet: an icosphere pushed around by three octaves of noise,
    // left non-indexed so every facet shades flat.
    function crumpledGeometry(r, seed) {
      const geo = new THREE.IcosahedronGeometry(r, 3);
      const pos = geo.attributes.position;
      const v = new THREE.Vector3();
      const k = seed * 13.7;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        const d1 = vnoise3(v.x * 2.2 + k, v.y * 2.2 + k, v.z * 2.2 + k) - 0.5;
        const d2 = vnoise3(v.x * 5 + k * 2, v.y * 5 + k * 2, v.z * 5 + k * 2) - 0.5;
        const d3 = vnoise3(v.x * 11 + k * 3, v.y * 11 + k * 3, v.z * 11 + k * 3) - 0.5;
        const rr = r * (1 + d1 * 0.3 + d2 * 0.17 + d3 * 0.08);
        pos.setXYZ(i, v.x * rr, v.y * rr, v.z * rr);
      }
      geo.computeVertexNormals();
      return geo;
    }
    const BALL_R = 0.042;
    const ballGeos = [crumpledGeometry(BALL_R, 1), crumpledGeometry(BALL_R, 2), crumpledGeometry(BALL_R, 3)];
    const paperMats = {};
    function paperMat(kind) {
      if (paperMats[kind]) return paperMats[kind];
      const m = kind === "foil"
        ? new THREE.MeshStandardMaterial({ map: paperTex(kind), color: 0xffe9a8, metalness: 0.85, roughness: 0.32, flatShading: true, envMapIntensity: 1.6 })
        : new THREE.MeshStandardMaterial({ map: paperTex(kind), roughness: 0.92, metalness: 0, flatShading: true });
      paperMats[kind] = m;
      return m;
    }
    const ballMesh = new THREE.Mesh(ballGeos[0], paperMat("plain"));
    ballMesh.castShadow = true; ballMesh.receiveShadow = true;
    scene.add(ballMesh);
    function skinBall(kind) { ballMesh.material = paperMat(kind); }

    // Missed sheets stay where they fell, up to a point.
    const litter = [];
    const LITTER_MAX = 12;
    function dropLitter(x, y, z, q, kind) {
      let m;
      if (litter.length >= LITTER_MAX) m = litter.shift();
      else { m = new THREE.Mesh(ballGeos[litter.length % 3], paperMat("plain")); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
      m.material = paperMat(kind);
      m.position.set(x, y, z);
      m.quaternion.copy(q);
      litter.push(m);
    }
    function clearLitter() { for (const m of litter) scene.remove(m); litter.length = 0; }

    // Flight trail: a short ribbon of fading sprites.
    const trailTex = glowTex("rgba(255,255,255,1)", "rgba(255,255,255,.45)");
    const trail = [];
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: trailTex, transparent: true, opacity: 0, depthWrite: false }));
      s.scale.set(0.06, 0.06, 1);
      s.visible = false;
      scene.add(s);
      trail.push({ s: s, life: 0 });
    }
    let trailNext = 0, trailClock = 0;
    function trailStamp(x, y, z) {
      const t = trail[trailNext];
      trailNext = (trailNext + 1) % trail.length;
      t.life = 1; t.s.visible = true;
      t.s.position.set(x, y, z);
    }
    function stepTrail(dt) {
      for (const t of trail) {
        if (t.life <= 0) continue;
        t.life -= dt / 0.75;
        if (t.life <= 0) { t.life = 0; t.s.visible = false; t.s.material.opacity = 0; continue; }
        t.s.material.opacity = t.life * 0.7;
        const sc = 0.05 + (1 - t.life) * 0.06;
        t.s.scale.set(sc, sc, 1);
      }
    }
    function clearTrail() { for (const t of trail) { t.life = 0; t.s.visible = false; } }

    // Flies. Every office has them.
    const flyTex = glowTex("rgba(20,18,16,1)", "rgba(20,18,16,.9)");
    const flies = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flyTex, transparent: true, depthWrite: false }));
      s.scale.set(0.016, 0.012, 1);
      s.visible = false;
      scene.add(s);
      flies.push({ s: s, home: [0, 0, 0], tx: 0, ty: 0, tz: 0, t: 0, phase: Math.random() * 10 });
    }
    function placeFlies(homes) {
      for (let i = 0; i < flies.length; i++) {
        const f = flies[i];
        if (i < homes.length) { f.home = homes[i]; f.s.visible = true; f.s.position.set(homes[i][0], homes[i][1], homes[i][2]); f.t = 0; }
        else f.s.visible = false;
      }
    }
    function stepFlies(dt, now) {
      for (const f of flies) {
        if (!f.s.visible) continue;
        f.t -= dt;
        if (f.t <= 0) {
          f.t = rnd(0.25, 1.4);
          f.tx = f.home[0] + rnd(-0.35, 0.35); f.ty = f.home[1] + rnd(0, 0.16); f.tz = f.home[2] + rnd(-0.3, 0.3);
        }
        const p = f.s.position;
        const k = 1 - Math.pow(0.02, dt);
        p.x += (f.tx - p.x) * k + Math.sin(now * 37 + f.phase) * 0.0015;
        p.y += (f.ty - p.y) * k + Math.cos(now * 41 + f.phase) * 0.0012;
        p.z += (f.tz - p.z) * k;
      }
    }

    useRoom("office");

    // ===================================================================== //
    // 7. Physics                                                            //
    // ===================================================================== //
    const G = 9.81;
    const DRAG = 0.2;                    // per second — paper is light and bleeds speed
    // The bin as the collider sees it: a cone frustum (radius rb at the floor,
    // rt at height h) with a torus lip of radius lipR, walls wallT thick.
    const bin = { x: 0, z: -2.9, rb: 0.113, rt: 0.159, h: 0.325, lipR: 0.013, wallT: 0.007 };
    const BALL_HOME = { x: 0, y: 0.74 + BALL_R, z: -0.82 };
    const ball = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
      q: new THREE.Quaternion(), flying: false, inside: false, rimHits: 0, bounces: 0,
      air: 0, restT: 0, insideT: 0, committed: false, supported: false, done: null
    };
    let wind = 0;                        // lateral acceleration in m/s^2, +x is to the right
    const WALL_X = 3.55, WALL_Z = -9.95, FRONT_Z = 0.3;
    const hits = [];                     // contact events for the sound layer, drained each frame
    const ASSIST = 4.5, ASSIST_R = 1.0;  // m/s^2 toward the bin, fading out at ASSIST_R metres

    function resetBall() {
      ball.x = BALL_HOME.x; ball.y = BALL_HOME.y; ball.z = BALL_HOME.z;
      ball.vx = ball.vy = ball.vz = 0;
      ball.wx = ball.wy = ball.wz = 0;
      ball.q.setFromEuler(new THREE.Euler(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU)));
      ball.flying = false; ball.inside = false; ball.rimHits = 0; ball.bounces = 0;
      ball.air = 0; ball.restT = 0; ball.insideT = 0; ball.committed = false; ball.supported = false; ball.done = null;
    }
    resetBall();

    /**
     * Reflect the velocity about the unit normal n with restitution e and
     * Coulomb friction mu. Returns the impact speed (0 if the ball was already
     * separating). Friction is proportional to the normal impulse, so a hard
     * landing kills most of the slide (paper flops) while a resting contact
     * only takes mu*g per second off it — scaling the tangential velocity by a
     * constant per contact instead glued a sheet to whatever it touched, ten
     * substeps a frame. A slide also puts tumble on the sheet.
     */
    function bounce(nx, ny, nz, e, mu) {
      const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
      if (ny > 0.7) ball.supported = true;
      if (vn >= 0) return 0;
      // A slow contact is a resting contact: paper does not bounce at 0.3 m/s,
      // and reflecting it would keep a settled ball jittering above the floor.
      const ee = -vn < 0.45 ? 0 : e;
      const jn = -(1 + ee) * vn;
      let tx = ball.vx - vn * nx, ty = ball.vy - vn * ny, tz = ball.vz - vn * nz;
      const vt = Math.hypot(tx, ty, tz);
      if (vt > 1e-6) {
        const keep = Math.max(0, vt - mu * jn) / vt;
        tx *= keep; ty *= keep; tz *= keep;
      }
      ball.vx = tx - vn * ee * nx;
      ball.vy = ty - vn * ee * ny;
      ball.vz = tz - vn * ee * nz;
      ball.wx = ball.wx * 0.45 + (ny * tz - nz * ty) * 4;
      ball.wy = ball.wy * 0.45 + (nz * tx - nx * tz) * 4;
      ball.wz = ball.wz * 0.45 + (nx * ty - ny * tx) * 4;
      return -vn;
    }

    function collideFloor() {
      if (ball.y >= BALL_R) return;
      ball.y = BALL_R;
      const sp = bounce(0, 1, 0, 0.3, 0.6);
      if (sp > 0.45) { ball.bounces++; hits.push({ k: "floor", v: sp }); }
    }

    function collideWalls() {
      let sp = 0;
      if (ball.x > WALL_X - BALL_R) { ball.x = WALL_X - BALL_R; sp = bounce(-1, 0, 0, 0.35, 0.5); }
      if (ball.x < -WALL_X + BALL_R) { ball.x = -WALL_X + BALL_R; sp = bounce(1, 0, 0, 0.35, 0.5); }
      if (ball.z < WALL_Z + BALL_R) { ball.z = WALL_Z + BALL_R; sp = bounce(0, 0, 1, 0.35, 0.5); }
      if (ball.z > FRONT_Z - BALL_R) { ball.z = FRONT_Z - BALL_R; sp = bounce(0, 0, -1, 0.35, 0.5); }
      if (sp > 0.6) hits.push({ k: "wall", v: sp });
    }

    /** Sphere against an axis-aligned box: closest point, push out, bounce. */
    function collideAABB(b) {
      const cx = clamp(ball.x, b.minx, b.maxx), cy = clamp(ball.y, b.miny, b.maxy), cz = clamp(ball.z, b.minz, b.maxz);
      const dx = ball.x - cx, dy = ball.y - cy, dz = ball.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= BALL_R * BALL_R) return;
      let nx, ny, nz;
      if (d2 < 1e-10) {
        // Centre inside the box: leave along the thinnest axis.
        const px = Math.min(ball.x - b.minx, b.maxx - ball.x);
        const py = Math.min(ball.y - b.miny, b.maxy - ball.y);
        const pz = Math.min(ball.z - b.minz, b.maxz - ball.z);
        nx = 0; ny = 0; nz = 0;
        if (px <= py && px <= pz) { nx = ball.x - b.minx < b.maxx - ball.x ? -1 : 1; ball.x = nx < 0 ? b.minx - BALL_R : b.maxx + BALL_R; }
        else if (py <= pz) { ny = ball.y - b.miny < b.maxy - ball.y ? -1 : 1; ball.y = ny < 0 ? b.miny - BALL_R : b.maxy + BALL_R; }
        else { nz = ball.z - b.minz < b.maxz - ball.z ? -1 : 1; ball.z = nz < 0 ? b.minz - BALL_R : b.maxz + BALL_R; }
      } else {
        const d = Math.sqrt(d2);
        nx = dx / d; ny = dy / d; nz = dz / d;
        const push = BALL_R - d;
        ball.x += nx * push; ball.y += ny * push; ball.z += nz * push;
      }
      const sp = bounce(nx, ny, nz, 0.32, 0.55);
      if (sp > 0.6) hits.push({ k: "wall", v: sp });
    }

    /** The same against a box rotated ry about the vertical axis (the desk). */
    function collideOBB(b) {
      const c = Math.cos(b.ry), s = Math.sin(b.ry);
      const dx = ball.x - b.cx, dz = ball.z - b.cz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const qx = clamp(lx, -b.hw, b.hw), qy = clamp(ball.y, b.miny, b.maxy), qz = clamp(lz, -b.hd, b.hd);
      const ex = lx - qx, ey = ball.y - qy, ez = lz - qz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 >= BALL_R * BALL_R || d2 < 1e-10) return;
      const d = Math.sqrt(d2);
      const nx = ex / d, ny = ey / d, nz = ez / d;
      const push = BALL_R - d;
      const wnx = nx * c + nz * s, wnz = -nx * s + nz * c;
      ball.x += wnx * push; ball.y += ny * push; ball.z += wnz * push;
      const sp = bounce(wnx, ny, wnz, 0.3, 0.55);
      if (sp > 0.5) hits.push({ k: "wall", v: sp });
    }

    /**
     * The bin. Lip first: a ring of radius rt at height h, contact with the
     * torus. Then, below the rim, which side of the cone the centre is on
     * decides whether the wall pushes in or out.
     */
    function collideBin() {
      const dx = ball.x - bin.x, dz = ball.z - bin.z;
      let rho = Math.hypot(dx, dz);
      let nx, nz;
      if (rho > 1e-6) { nx = dx / rho; nz = dz / rho; } else { nx = 1; nz = 0; rho = 0; }
      const slope = (bin.rt - bin.rb) / bin.h;

      if (Math.abs(ball.y - bin.h) < BALL_R + bin.lipR + 0.02) {
        const cx = bin.x + nx * bin.rt, cz = bin.z + nz * bin.rt;
        const ex = ball.x - cx, ey = ball.y - bin.h, ez = ball.z - cz;
        const d = Math.hypot(ex, ey, ez);
        const R = BALL_R + bin.lipR;
        if (d < R && d > 1e-6) {
          const px = ex / d, py = ey / d, pz = ez / d;
          const push = R - d;
          ball.x += px * push; ball.y += py * push; ball.z += pz * push;
          const sp = bounce(px, py, pz, 0.28, 0.5);
          if (sp > 0.25) { ball.rimHits++; hits.push({ k: "rim", v: sp }); }
          ball.wy += rnd(-6, 6);
          return;
        }
      }
      if (ball.y >= bin.h) { ball.inside = false; return; }

      const Ry = bin.rb + slope * clamp(ball.y, 0, bin.h);
      const inside = rho < Ry;
      ball.inside = inside;
      const nl = Math.hypot(1, slope);
      const onx = nx / nl, ony = -slope / nl, onz = nz / nl;
      if (inside) {
        const limit = Ry - bin.wallT - BALL_R;
        if (rho > limit) {
          const push = rho - limit;
          ball.x -= nx * push; ball.z -= nz * push;
          const sp = bounce(-onx, -ony, -onz, 0.22, 0.4);
          if (sp > 0.4) hits.push({ k: "binwall", v: sp });
        }
        const fl = 0.016 + BALL_R;
        if (ball.y < fl) {
          ball.y = fl;
          const sp = bounce(0, 1, 0, 0.18, 0.6);
          if (sp > 0.3) hits.push({ k: "binfloor", v: sp });
        }
      } else {
        const limit = Ry + BALL_R;
        if (rho < limit) {
          const push = limit - rho;
          ball.x += nx * push; ball.z += nz * push;
          const sp = bounce(onx, ony, onz, 0.3, 0.4);
          if (sp > 0.4) hits.push({ k: "wall", v: sp });
        }
      }
    }

    const tmpQ = new THREE.Quaternion();
    const tmpAxis = new THREE.Vector3();

    function stepBall(dt) {
      if (!ball.flying) return;
      const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
      // Substep so no step moves the ball more than ~8 mm, well under the
      // 7 mm wall it must never pass through plus its own radius.
      const n = clamp(Math.max(Math.ceil((speed * dt) / 0.008), Math.ceil(dt / 0.01)), 1, 48);
      const h = dt / n;
      ball.supported = false;
      for (let i = 0; i < n; i++) {
        ball.vy -= G * h;
        const k = 1 - DRAG * h;
        ball.vx *= k; ball.vy *= k; ball.vz *= k;
        if (!ball.inside && ball.y > 0.12) {
          const gust = wind * (1 + 0.18 * Math.sin(ball.air * 9.3) + 0.1 * Math.sin(ball.air * 23.1));
          ball.vx += gust * h;
        }
        // A small sideways pull toward the bin's line on the way down — a few
        // centimetres of forgiveness against the wind. Only across the line
        // of flight: range stays entirely the flick's job.
        if (!ball.inside && ball.vy < 0 && ball.y > bin.h) {
          const ax = bin.x - ball.x, az = bin.z - ball.z;
          const ad = Math.hypot(ax, az);
          const hs = Math.hypot(ball.vx, ball.vz);
          if (ad > 0.02 && ad < ASSIST_R && hs > 0.1) {
            const dx = ball.vx / hs, dz = ball.vz / hs;
            const along = ax * dx + az * dz;
            const lx = ax - along * dx, lz = az - along * dz;
            const ll = Math.hypot(lx, lz);
            if (ll > 0.005) {
              const k = (ASSIST * (1 - ad / ASSIST_R) * h) / ll;
              ball.vx += lx * k; ball.vz += lz * k;
            }
          }
        }
        ball.x += ball.vx * h; ball.y += ball.vy * h; ball.z += ball.vz * h;
        ball.air += h;
        collideBin();
        collideFloor();
        collideWalls();
        collideOBB(DESK);
        for (let c = 0; c < activeCols.length; c++) collideAABB(activeCols[c]);
      }

      // Tumble.
      const wmag = Math.hypot(ball.wx, ball.wy, ball.wz);
      if (wmag > 1e-4) {
        tmpAxis.set(ball.wx / wmag, ball.wy / wmag, ball.wz / wmag);
        tmpQ.setFromAxisAngle(tmpAxis, Math.min(wmag, 32) * dt);
        ball.q.premultiply(tmpQ);
        const damp = Math.pow(ball.supported ? 0.01 : 0.7, dt);
        ball.wx *= damp; ball.wy *= damp; ball.wz *= damp;
      }

      // Outcome.
      const sp = Math.hypot(ball.vx, ball.vy, ball.vz);
      if (ball.inside) {
        ball.insideT += dt;
        ball.restT = 0;
        if (!ball.committed && ball.y < bin.h - BALL_R * 1.6 && ball.vy < 0) ball.committed = true;
        if (ball.committed && (sp < 0.35 || ball.insideT > 1.6)) ball.done = "basket";
      } else {
        ball.insideT = 0;
        if ((ball.supported && sp < 0.08) || sp < 0.03) ball.restT += dt; else ball.restT = 0;
        if (ball.restT > 0.3 || ball.air > 9 || ball.y < -0.5) ball.done = "miss";
      }
    }

    function syncBall() {
      ballMesh.position.set(ball.x, ball.y, ball.z);
      ballMesh.quaternion.copy(ball.q);
    }

    // --- the throw ----------------------------------------------------------
    const THROW_EL = 52 * Math.PI / 180;   // launch elevation
    const S_REF = 1.3;                     // flick speed, in screen heights per second, that lands level 1
    /** Horizontal distance a throw of speed v travels before it comes back down to rim height. */
    function flightRange(v) {
      let x = 0, y = BALL_HOME.y, vx = v * Math.cos(THROW_EL), vy = v * Math.sin(THROW_EL);
      const h = 0.002;
      for (let t = 0; t < 6; t += h) {
        vy -= G * h;
        const k = 1 - DRAG * h;
        vx *= k; vy *= k;
        x += vx * h; y += vy * h;
        if (vy < 0 && y <= bin.h) return x;
      }
      return x;
    }
    function speedFor(dist) {
      let lo = 0.5, hi = 20;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (flightRange(m) < dist) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }
    const V_REF = speedFor(2.9 + BALL_HOME.z);   // level 1: the bin sits at z = -2.9

    function launch(v, phi) {
      const cv = v * Math.cos(THROW_EL);
      ball.vx = cv * Math.sin(phi);
      ball.vz = -cv * Math.cos(phi);
      ball.vy = v * Math.sin(THROW_EL);
      ball.wx = -v * (5 + Math.random() * 4);
      ball.wy = rnd(-4, 4);
      ball.wz = rnd(-3, 3);
      ball.flying = true;
      ball.air = 0;
      ball.done = null;
    }

    // Level shape: how far the bin sits, how hard the fan blows, which room.
    function distFor(n) { return Math.min(2.9 + (n - 1) * 0.3, 6.3); }
    function windMaxFor(n) { return n <= 1 ? 0 : Math.min(0.45 + (n - 2) * 0.28, 2.2); }
    function roomFor(n) { return ["office", "basement", "bar"][Math.floor((n - 1) / 4) % 3]; }
    function roomName(k) { return k === "basement" ? "basement" : k === "bar" ? "bowling bar" : "office"; }

    // ===================================================================== //
    // 8. Audio — everything synthesised, nothing packaged                   //
    // ===================================================================== //
    let ac = null, master = null, noiseBuf = null, audioDead = false, muted = false;
    let fanSrc = null, fanGain = null, fanFilt = null, fanOsc = null, fanOscGain = null;
    let musicHandle = null;

    function buildAudio() {
      if (ac || audioDead) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }

      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3.5;
      comp.attack.value = 0.002; comp.release.value = 0.2;
      master.connect(comp); comp.connect(ac.destination);

      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      // The fan: air through a cage plus a motor hum, both following the wind.
      fanFilt = ac.createBiquadFilter();
      fanFilt.type = "bandpass"; fanFilt.frequency.value = 900; fanFilt.Q.value = 0.7;
      fanGain = ac.createGain(); fanGain.gain.value = 0;
      fanSrc = ac.createBufferSource(); fanSrc.buffer = noiseBuf; fanSrc.loop = true;
      fanSrc.connect(fanFilt); fanFilt.connect(fanGain); fanGain.connect(master);
      fanOsc = ac.createOscillator(); fanOsc.type = "sawtooth"; fanOsc.frequency.value = 55;
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 180;
      fanOscGain = ac.createGain(); fanOscGain.gain.value = 0;
      fanOsc.connect(lp); lp.connect(fanOscGain); fanOscGain.connect(master);
      try { fanSrc.start(0); fanOsc.start(0); } catch (_) { /* already running */ }
      return ac;
    }

    const audioOk = () => !!ac && ac.state === "running" && !muted;

    function env(g, t, peak, atk, dec) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
    }
    function noiseBurst(t, dur, peak, type, f0, f1, q) {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = type;
      bp.frequency.setValueAtTime(f0, t);
      if (f1) bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
      bp.Q.value = q || 0.8;
      const g = ac.createGain();
      env(g, t, peak, 0.003, dur);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.06);
    }
    function tone(t, f0, f1, dur, peak, type) {
      const o = ac.createOscillator();
      o.type = type || "sine";
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain();
      env(g, t, peak, 0.004, dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.06);
    }

    /** Picking the sheet up: a few dry crackles. */
    function sfxCrinkle() {
      if (!audioOk()) return;
      const t = ac.currentTime;
      for (let i = 0; i < 4; i++) noiseBurst(t + i * 0.034 + rnd(0, 0.01), 0.028, rnd(0.06, 0.13), "highpass", 2600 + i * 400, 0, 0.5);
    }
    /** The throw: air past the sheet, brighter the harder it goes. */
    function sfxWhoosh(p) {
      if (!audioOk()) return;
      const t = ac.currentTime;
      noiseBurst(t, 0.24, 0.1 + 0.22 * p, "bandpass", 320 + 760 * p, 140 + 220 * p, 0.6);
    }
    /** Lip of the bin: a short bright tick. */
    function sfxRim(v) {
      if (!audioOk()) return;
      const t = ac.currentTime;
      tone(t, 2100, 1500, 0.05, 0.14 * v, "triangle");
      noiseBurst(t, 0.03, 0.09 * v, "highpass", 3200, 0, 0.6);
    }
    /** Inside the bin: hollow plastic. */
    function sfxBinHit(v) {
      if (!audioOk()) return;
      const t = ac.currentTime;
      tone(t, 170, 72, 0.16, 0.3 * v, "sine");
      tone(t + 0.008, 470, 360, 0.09, 0.11 * v, "triangle");
      noiseBurst(t, 0.11, 0.13 * v, "lowpass", 1500, 500, 0.7);
    }
    /** A sheet hitting the carpet: barely anything. */
    function sfxFloor(v) {
      if (!audioOk()) return;
      noiseBurst(ac.currentTime, 0.06, clamp(v * 0.07, 0.03, 0.16), "lowpass", 900, 320, 0.8);
    }
    function sfxWall(v) {
      if (!audioOk()) return;
      const t = ac.currentTime;
      tone(t, 180, 90, 0.1, 0.1 * v, "sine");
      noiseBurst(t, 0.08, 0.1 * v, "lowpass", 700, 300, 0.8);
    }
    /** A basket: a two-note ding, a third note for a swish. */
    function sfxScore(swish) {
      if (!audioOk()) return;
      const t = ac.currentTime;
      tone(t, 1047, 0, 0.16, 0.12, "sine");
      tone(t + 0.09, 1568, 0, 0.22, 0.12, "sine");
      if (swish) tone(t + 0.18, 2093, 0, 0.3, 0.1, "sine");
    }
    function sfxLevelUp() {
      if (!audioOk()) return;
      const t = ac.currentTime;
      const notes = [523, 659, 784, 1047, 1319];
      for (let i = 0; i < notes.length; i++) tone(t + i * 0.09, notes[i], 0, i === 4 ? 0.5 : 0.2, 0.13, "triangle");
    }
    function sfxFail() {
      if (!audioOk()) return;
      const t = ac.currentTime;
      tone(t, 330, 250, 0.25, 0.12, "triangle");
      tone(t + 0.26, 250, 170, 0.4, 0.12, "triangle");
    }
    function sfxCash() {
      if (!audioOk()) return;
      const t = ac.currentTime;
      tone(t, 1760, 0, 0.08, 0.1, "sine");
      tone(t + 0.07, 2637, 0, 0.16, 0.12, "sine");
      noiseBurst(t, 0.05, 0.05, "highpass", 5000, 0, 0.5);
    }
    function sfxTap() {
      if (!audioOk()) return;
      const t = ac.currentTime;
      noiseBurst(t, 0.025, 0.07, "bandpass", 1800, 0, 1);
      tone(t, 900, 600, 0.03, 0.05, "sine");
    }
    function sfxNope() {
      if (!audioOk()) return;
      tone(ac.currentTime, 200, 150, 0.14, 0.09, "square");
    }

    function updateFanBed(level) {
      if (!fanGain || !ac || ac.state !== "running") return;
      const a = Math.abs(level);
      const on = a > 0.02 && !muted;
      fanGain.gain.setTargetAtTime(on ? clamp(0.03 + a * 0.07, 0, 0.17) : 0, ac.currentTime, 0.12);
      fanOscGain.gain.setTargetAtTime(on ? 0.025 + a * 0.02 : 0, ac.currentTime, 0.12);
      fanFilt.frequency.setTargetAtTime(700 + a * 320, ac.currentTime, 0.2);
    }

    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic || musicHandle) return;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "lofi", volume: muted ? 0 : 0.26, intensity: 0.3, density: 0.45, tempo: 84, fadeInMs: 1500
        });
      } catch (_) { /* silence is acceptable */ }
    }
    function setMuted(m) {
      muted = !!m;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.05);
      try { if (musicHandle) musicHandle.setVolume(muted ? 0 : 0.26, { fadeMs: 300 }); } catch (_) { /* fine */ }
    }

    // ===================================================================== //
    // 9. Game state, HUD, overlays                                          //
    // ===================================================================== //
    let state = "title";       // title | aim | fly | result | modal | transition
    let mode = "levels";
    let level = 1, baskets = 0, ballsLeft = 5, score = 0, money = 0;
    let best = { level: 1, endless: 0 };
    let owned = { paper: ["plain"], bin: ["orange"] };
    let sel = { paper: "plain", bin: "orange" };
    let throwsTotal = 0;
    let started = false;
    let earnedThisLevel = 0;
    let prevState = "aim";     // what a modal returns to
    let pendingLevel = 0;
    let underModal = null;     // a results card hidden behind the shop
    const BALLS_PER_LEVEL = 5, TARGET = 3;

    function haptic(kind) {
      if (!ctx.capabilities.haptics) return;
      try { ctx.platform.haptic(kind); } catch (_) { /* ignore */ }
    }

    // --- HUD ----------------------------------------------------------------
    function statBlock(label, valueHtml) {
      return '<div class="cr-stat"><div class="cr-lab">' + label + '</div><div class="cr-val">' + valueHtml + "</div></div>";
    }
    function renderStats() {
      if (mode === "levels") {
        el.stats.innerHTML = statBlock("Level", String(level)) + '<div class="cr-div"></div>' +
          statBlock("target", SVG_BIN + baskets + "/" + TARGET);
      } else {
        el.stats.innerHTML = statBlock("High", String(best.endless)) + '<div class="cr-div"></div>' +
          statBlock("Score", String(score));
      }
    }
    function renderMoney() { el.money.textContent = String(money); }
    function renderBalls() {
      if (mode !== "levels") { el.balls.innerHTML = ""; return; }
      let h = "";
      const spent = BALLS_PER_LEVEL - ballsLeft;
      for (let i = 0; i < BALLS_PER_LEVEL; i++) h += ballIcon(26, i < spent ? 'class="used"' : "");
      el.balls.innerHTML = h;
    }
    function showWind(w) {
      const a = Math.abs(w);
      if (a < 0.05) { el.wind.style.opacity = "0"; return; }
      el.wind.style.opacity = "1";
      // Keep it on the side the fan is not.
      if (fanSide > 0) { el.wind.style.left = "13%"; el.wind.style.right = "auto"; }
      else { el.wind.style.left = "auto"; el.wind.style.right = "13%"; }
      el.winda.className = "a" + (w < 0 ? " l" : "");
      el.windn.textContent = (a * 2.4).toFixed(1);
    }
    function toast(big, small) {
      el.toastb.textContent = big;
      el.toasts.textContent = small || "";
      el.toast.classList.remove("on");
      ctx.timeout(() => { el.toast.classList.add("on"); }, 30);
    }
    function hint(text) {
      el.hint.textContent = text || "";
      el.hint.style.opacity = text ? "1" : "0";
    }
    function setChrome(on) {
      el.hud.style.opacity = on ? "1" : "0";
      el.shoptag.style.opacity = on ? "1" : "0";
      el.helpb.style.opacity = on ? "1" : "0";
      if (!on) { el.wind.style.opacity = "0"; el.up.style.opacity = "0"; el.hand.classList.remove("on"); hint(""); }
    }

    // --- modals --------------------------------------------------------------
    function openModal(html, from) {
      if (state !== "modal") prevState = from || state;
      state = "modal";
      el.card.innerHTML = html;
      el.card.scrollTop = 0;
      el.modal.classList.add("on");
    }
    function closeModal() {
      el.modal.classList.remove("on");
      el.card.innerHTML = "";
      state = prevState;
    }

    function pauseHtml() {
      return "<h2>Paused</h2>" +
        (mode === "levels"
          ? '<div class="cr-stat2"><div><b>' + level + "</b><span>level</span></div><div><b>" + baskets + "/" + TARGET + "</b><span>in the bin</span></div><div><b>$" + money + "</b><span>cash</span></div></div>"
          : '<div class="cr-stat2"><div><b>' + score + "</b><span>in a row</span></div><div><b>" + best.endless + "</b><span>best</span></div><div><b>$" + money + "</b><span>cash</span></div></div>") +
        '<div class="cr-btn" data-act="resume">Resume</div>' +
        (mode === "levels" ? '<div class="cr-btn g" data-act="restart">Restart level</div>' : "") +
        '<div class="cr-btn g" data-act="mute">Sound: ' + (muted ? "off" : "on") + "</div>" +
        '<div class="cr-btn g" data-act="menu">Main menu</div>';
    }
    function helpHtml() {
      return "<h2>How to play</h2>" +
        '<p style="text-align:left">' +
        "<b>Flick up</b> from the sheet to throw. A faster flick goes further; angle the flick to aim.<br><br>" +
        "The <b>yellow arrow</b> is the wind from the fan and the number is how hard it blows. Aim into it.<br><br>" +
        "<b>Levels:</b> five sheets, three in the bin to clear it. The bin moves back every level.<br><br>" +
        "<b>Endless:</b> keep sinking them. One miss ends the run.<br><br>" +
        "Baskets pay cash. Spend it in the shop on paper and bins." +
        "</p>" +
        '<div class="cr-btn" data-act="close">Got it</div>';
    }
    function shopHtml() {
      const item = (kind, id, s) => {
        const own = owned[kind].indexOf(id) >= 0, isSel = sel[kind] === id;
        return '<div class="cr-item' + (isSel ? " sel" : "") + (!own && money < s.price ? " no" : "") +
          '" data-act="item" data-kind="' + kind + '" data-id="' + id + '">' +
          '<div class="sw' + (kind === "bin" ? " bin" : "") + '" style="background:' + s.css + ';"></div>' + s.name +
          '<div class="pr' + (own ? " own" : "") + '">' + (isSel ? "Using" : own ? "Owned" : "$" + s.price) + "</div></div>";
      };
      let h = "<h2>Shop</h2><p>You have <b>$" + money + "</b>. A basket pays $25, a swish $35.</p><h3>Paper</h3><div class=\"cr-grid\">";
      for (const id in PAPER_SKINS) h += item("paper", id, PAPER_SKINS[id]);
      h += '</div><h3>Bins</h3><div class="cr-grid">';
      for (const id in BIN_SKINS) h += item("bin", id, BIN_SKINS[id]);
      h += '</div><div class="cr-btn g" data-act="close">Done</div>';
      return h;
    }
    function onItem(kind, id) {
      const s = (kind === "bin" ? BIN_SKINS : PAPER_SKINS)[id];
      if (!s) return;
      if (owned[kind].indexOf(id) < 0) {
        if (money < s.price) { sfxNope(); haptic("error"); return; }
        money -= s.price;
        owned[kind].push(id);
        sfxCash(); haptic("success");
        renderMoney();
        try { ctx.platform.interact({ type: "buy", kind: kind, id: id }); } catch (_) { /* ignore */ }
      } else sfxTap();
      sel[kind] = id;
      if (kind === "bin") skinBin(id); else skinBall(id);
      save();
      el.card.innerHTML = shopHtml();
    }

    // --- flow ----------------------------------------------------------------
    function placeBin(d, x) {
      bin.z = -d; bin.x = x;
      binGroup.position.set(bin.x, 0, bin.z);
    }
    function placeBinEndless() {
      const d = clamp(2.9 + Math.min(score, 12) * 0.22 + rnd(-0.25, 0.25), 2.7, 5.8);
      placeBin(d, rnd(-0.3, 0.3) * Math.min(1, score / 5));
    }
    function fadeThrough(fn) {
      state = "transition";
      el.fade.style.opacity = "1";
      ctx.timeout(() => { fn(); ctx.timeout(() => { el.fade.style.opacity = "0"; }, 60); }, 380);
    }

    function startMode(m) {
      mode = m;
      el.curtain.style.opacity = "0";
      ctx.timeout(() => { el.curtain.style.display = "none"; }, 450);
      setChrome(true);
      if (!started) {
        started = true;
        try { ctx.platform.start({ mode: m }); } catch (_) { /* ignore */ }
      }
      buildAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (_) { /* ignore */ } }
      startMusic();
      try { ctx.platform.interact({ type: "mode", mode: m }); } catch (_) { /* ignore */ }
      if (m === "levels") beginLevel(level);
      else {
        score = 0;
        const go = () => { useRoom("office"); clearLitter(); renderStats(); renderBalls(); renderMoney(); beginThrow(); };
        if (room && room.kind !== "office") fadeThrough(go); else go();
      }
    }

    function beginLevel(n) {
      level = n; baskets = 0; ballsLeft = BALLS_PER_LEVEL; earnedThisLevel = 0;
      const kind = roomFor(n);
      const go = () => {
        useRoom(kind);
        const off = n >= 3 ? rnd(-0.3, 0.3) * Math.min(1, (n - 2) / 4) : 0;
        placeBin(distFor(n), off);
        clearLitter();
        renderStats(); renderBalls(); renderMoney();
        beginThrow();
      };
      if (room && room.kind !== kind) fadeThrough(go); else go();
    }

    function beginThrow() {
      resetBall();
      clearTrail();
      ballMesh.visible = true;
      syncBall();
      if (mode === "endless") placeBinEndless();
      const wmax = mode === "levels" ? windMaxFor(level) : Math.min(0.3 + score * 0.14, 2.0);
      if (wmax <= 0 || Math.random() < 0.2) wind = 0;
      else wind = (Math.random() < 0.5 ? -1 : 1) * rnd(0.35, 1) * wmax;
      if (wind !== 0) placeFan(wind > 0 ? -1 : 1);   // the fan sits where the wind comes from
      showWind(wind);
      state = "aim";
      el.up.style.opacity = "1";
      if (throwsTotal < 3) el.hand.classList.add("on"); else el.hand.classList.remove("on");
      hint(throwsTotal < 1 ? "Flick up to throw" : (wind !== 0 ? "Aim into the wind" : ""));
    }

    function onRelease(sNorm, phi) {
      if (state !== "aim") return;
      el.up.style.opacity = "0";
      el.hand.classList.remove("on");
      hint("");
      throwsTotal++;
      const v = clamp(V_REF * (sNorm / S_REF), 1.4, 12);
      launch(v, phi);
      if (mode === "levels") { ballsLeft--; renderBalls(); }
      state = "fly";
      sfxWhoosh(clamp(v / 8, 0, 1));
      haptic("light");
      try {
        ctx.platform.interact({ type: "throw", mode: mode, level: level, power: Math.round(v * 100) / 100, wind: Math.round(wind * 100) / 100 });
      } catch (_) { /* ignore */ }
      if (throwsTotal <= 3) save();
    }

    let binHitPlayed = false;
    function drainHits() {
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (h.k === "rim") { sfxRim(clamp(h.v / 3, 0.3, 1)); haptic("light"); }
        else if (h.k === "floor") sfxFloor(h.v);
        else if (h.k === "wall") sfxWall(clamp(h.v / 4, 0.2, 1));
        else if (h.k === "binwall" || h.k === "binfloor") {
          if (!binHitPlayed) { binHitPlayed = true; sfxBinHit(clamp(h.v / 3, 0.35, 1)); haptic("medium"); }
          else if (h.v > 0.8) sfxBinHit(clamp(h.v / 6, 0.1, 0.4));
        }
      }
      hits.length = 0;
    }

    const NICE = ["NICE!", "IN!", "BUCKET!", "GOT IT!", "SUNK!"];
    function resolveOutcome() {
      const r = ball.done;
      ball.done = null;
      ball.flying = false;
      state = "result";
      if (r === "basket") {
        const swish = ball.rimHits === 0;
        const reward = (mode === "levels" ? 25 : 12) + (swish ? 10 : 0);
        money += reward; earnedThisLevel += reward;
        renderMoney();
        sfxScore(swish);
        haptic("success");
        dropLitter(ball.x, ball.y, ball.z, ball.q, sel.paper);
        ballMesh.visible = false;
        if (mode === "levels") {
          baskets++;
          renderStats();
          toast(swish ? "SWISH!" : NICE[Math.floor(Math.random() * NICE.length)], "+$" + reward);
          try { ctx.platform.milestone("basket", { level: level, baskets: baskets, swish: swish }); } catch (_) { /* ignore */ }
          if (baskets >= TARGET) { ctx.timeout(levelCleared, 1300); return; }
          if (ballsLeft <= 0) { ctx.timeout(levelFailed, 1300); return; }
        } else {
          score++;
          if (score > best.endless) best.endless = score;
          renderStats();
          toast(swish ? "SWISH!" : "+1", score + " in a row");
          try { ctx.platform.setScore(score); } catch (_) { /* ignore */ }
        }
        ctx.timeout(nextAfterResult, 1100);
      } else {
        if (ball.y > -0.4) dropLitter(ball.x, ball.y, ball.z, ball.q, sel.paper);
        ballMesh.visible = false;
        haptic("warning");
        if (mode === "levels") {
          toast(ball.rimHits ? "RIM!" : "MISS", ballsLeft > 0 ? ballsLeft + (ballsLeft === 1 ? " sheet left" : " sheets left") : "");
          if (ballsLeft <= 0) { ctx.timeout(levelFailed, 1200); return; }
          ctx.timeout(nextAfterResult, 1000);
        } else {
          toast(ball.rimHits ? "RIM!" : "MISS", score ? score + " in a row" : "");
          ctx.timeout(runOver, 1200);
        }
      }
    }
    function nextAfterResult() {
      if (state !== "result") return;
      beginThrow();
    }

    function levelCleared() {
      if (state !== "result") return;
      const bonus = 50 + level * 10;
      money += bonus; earnedThisLevel += bonus;
      renderMoney();
      pendingLevel = level + 1;
      if (pendingLevel > best.level) best.level = pendingLevel;
      sfxLevelUp();
      haptic("success");
      try { ctx.music.sting("success"); } catch (_) { /* ignore */ }
      try { ctx.platform.complete({ level: level, money: money }); } catch (_) { /* ignore */ }
      try { ctx.platform.milestone("level_clear", { level: level }); } catch (_) { /* ignore */ }
      submitRecord("level", level);
      const nextKind = roomFor(pendingLevel);
      const move = room && nextKind !== room.kind ? "<p>Next stop: the " + roomName(nextKind) + ".</p>" : "";
      openModal("<h2>Level " + level + " cleared</h2>" +
        '<div class="cr-stat2"><div><b>' + baskets + "/" + BALLS_PER_LEVEL + "</b><span>sheets in</span></div><div><b>$" + earnedThisLevel + "</b><span>earned</span></div></div>" + move +
        '<div class="cr-btn" data-act="next">Next level</div><div class="cr-btn g" data-act="shop">Shop</div>', "result");
      level = pendingLevel;
      save();
    }
    function levelFailed() {
      if (state !== "result") return;
      sfxFail();
      try { ctx.music.sting("fail"); } catch (_) { /* ignore */ }
      try { ctx.platform.fail({ level: level, baskets: baskets }); } catch (_) { /* ignore */ }
      openModal("<h2>Out of paper</h2><p>" + baskets + " of " + TARGET + " in the bin. Level " + level + " needs " + TARGET + ".</p>" +
        '<div class="cr-btn" data-act="retry">Try again</div><div class="cr-btn g" data-act="shop">Shop</div><div class="cr-btn g" data-act="menu">Main menu</div>', "result");
      save();
    }
    function runOver() {
      if (state !== "result") return;
      submitRecord("endless", score);
      sfxFail();
      try { ctx.music.sting("fail"); } catch (_) { /* ignore */ }
      try { ctx.platform.fail({ mode: "endless", score: score }); } catch (_) { /* ignore */ }
      openModal("<h2>Run over</h2>" +
        '<div class="cr-stat2"><div><b>' + score + "</b><span>in a row</span></div><div><b>" + best.endless + "</b><span>best</span></div></div>" +
        '<div class="cr-btn" data-act="again">Again</div><div class="cr-btn g" data-act="shop">Shop</div><div class="cr-btn g" data-act="menu">Main menu</div>', "result");
      save();
    }

    function titleNote() {
      el.cnote.textContent = (best.level > 1 ? "Best: level " + best.level : "") +
        (best.level > 1 && best.endless > 0 ? "  ·  " : "") +
        (best.endless > 0 ? "Endless: " + best.endless + " in a row" : "");
      el.cbtn1.textContent = level > 1 ? "Continue · Level " + level : "Play levels";
    }
    function toTitle() {
      state = "title";
      setChrome(false);
      ballMesh.visible = true;
      resetBall(); syncBall();
      clearTrail();
      titleNote();
      el.curtain.style.display = "flex";
      ctx.timeout(() => { el.curtain.style.opacity = "1"; }, 20);
    }

    // --- buttons -------------------------------------------------------------
    function onAct(e) {
      const t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (act === "levels" || act === "endless") { if (state === "title") { sfxTap(); startMode(act); } return; }
      if (act === "pause") {
        if (state !== "aim" && state !== "fly") return;
        sfxTap(); openModal(pauseHtml(), state); return;
      }
      if (act === "shop") {
        if (state === "modal") { underModal = el.card.innerHTML; openModal(shopHtml()); sfxTap(); return; }
        if (state !== "aim") return;
        sfxTap(); openModal(shopHtml(), "aim"); return;
      }
      if (act === "help") { if (state !== "aim") return; sfxTap(); openModal(helpHtml(), "aim"); return; }
      if (act === "item") { onItem(t.getAttribute("data-kind"), t.getAttribute("data-id")); return; }
      if (act === "close") {
        sfxTap();
        if (underModal) { const h = underModal; underModal = null; el.card.innerHTML = h; el.card.scrollTop = 0; return; }
        closeModal(); return;
      }
      if (act === "resume") { sfxTap(); closeModal(); return; }
      if (act === "mute") { setMuted(!muted); save(); el.card.innerHTML = pauseHtml(); sfxTap(); return; }
      if (act === "restart") { sfxTap(); closeModal(); clearLitter(); beginLevel(level); return; }
      if (act === "retry") { sfxTap(); closeModal(); beginLevel(level); return; }
      if (act === "next") { sfxTap(); closeModal(); beginLevel(level); return; }
      if (act === "again") { sfxTap(); closeModal(); score = 0; clearLitter(); renderStats(); beginThrow(); return; }
      if (act === "menu") { sfxTap(); closeModal(); toTitle(); return; }
    }
    ctx.listen(el.curtain, "click", onAct);
    ctx.listen(el.modal, "click", onAct);
    ctx.listen(el.shoptag, "click", onAct);
    ctx.listen(el.helpb, "click", onAct);
    ctx.listen(ui.querySelector(".cr-pause"), "click", onAct);

    // ===================================================================== //
    // 10. Input — flick up from the sheet                                   //
    // ===================================================================== //
    // Pointer positions come from offsetX/offsetY, already canvas-relative;
    // pointer capture keeps the move/up on the canvas once a flick starts.
    let gesture = null;
    // Event timestamps, not the handler's clock: moves get batched behind a
    // slow frame, and a handler-side clock would then read a wild flick.
    const stamp = (e) => (e && typeof e.timeStamp === "number" && e.timeStamp > 0 ? e.timeStamp : performance.now());
    function pointerPos(e) {
      if (typeof e.offsetX === "number") return { x: e.offsetX, y: e.offsetY };
      return { x: e.clientX, y: e.clientY };
    }
    ctx.listen(canvas, "pointerdown", (e) => {
      if (state !== "aim") return;
      if (e.cancelable) e.preventDefault();
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } }
      const p = pointerPos(e);
      gesture = { id: e.pointerId, samples: [{ x: p.x, y: p.y, t: stamp(e) }] };
      sfxCrinkle();
      haptic("light");
      el.hand.classList.remove("on");
    }, { passive: false });
    ctx.listen(canvas, "pointermove", (e) => {
      if (!gesture || e.pointerId !== gesture.id) return;
      if (e.cancelable) e.preventDefault();
      const s = gesture.samples;
      // Moves coalesced behind a slow frame arrive as one event; unpack them
      // so the release speed is measured from real samples, not frame pacing.
      let list = null;
      try { if (e.getCoalescedEvents) list = e.getCoalescedEvents(); } catch (_) { list = null; }
      if (!list || !list.length) list = [e];
      for (let k = 0; k < list.length; k++) {
        const p = pointerPos(list[k]);
        s.push({ x: p.x, y: p.y, t: stamp(list[k]) });
      }
      while (s.length > 32) s.shift();
    }, { passive: false });
    function release(e) {
      if (!gesture) return;
      if (e && typeof e.pointerId === "number" && e.pointerId !== gesture.id) return;
      const s = gesture.samples;
      gesture = null;
      const now = stamp(e);
      const last = s[s.length - 1];
      if (now - last.t > 220 || s.length < 2) return;      // the finger stopped before it let go
      // Velocity over the last ~90 ms of the flick, and never fewer than two
      // samples: that is the release speed.
      let i = s.length - 1;
      while (i > 0 && (i === s.length - 1 || last.t - s[i - 1].t < 90)) i--;
      const first = s[i];
      const dt = Math.max(16, last.t - first.t) / 1000;
      const dx = last.x - first.x, dy = last.y - first.y;
      const H = Math.max(1, ctx.height);
      const speed = Math.hypot(dx, dy) / dt / H;            // screen heights per second
      if (dy > -6 || speed < 0.35) return;                    // not an upward flick
      const phi = clamp(Math.atan2(dx, -dy), -0.6, 0.6);
      onRelease(speed, phi);
    }
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);
    ctx.listen(window, "pointerup", (e) => { if (gesture) release(e); });

    // ===================================================================== //
    // 11. Persistence + leaderboards                                        //
    // ===================================================================== //
    const SAVE_KEY = "crumple";
    function save() {
      if (!ctx.capabilities.storage) return;
      fireAndForget(() => ctx.storage.set(SAVE_KEY, {
        level: level, money: money, best: best, owned: owned, sel: sel, muted: muted, throws: throwsTotal
      }));
    }
    async function load() {
      if (!ctx.capabilities.storage) return;
      try {
        const s = await ctx.storage.get(SAVE_KEY);
        if (!s || typeof s !== "object") return;
        if (typeof s.level === "number" && s.level >= 1) level = Math.floor(s.level);
        if (typeof s.money === "number" && s.money >= 0) money = Math.floor(s.money);
        if (s.best && typeof s.best === "object") {
          best.level = Math.max(1, s.best.level | 0);
          best.endless = Math.max(0, s.best.endless | 0);
        }
        if (s.owned && Array.isArray(s.owned.paper) && Array.isArray(s.owned.bin)) {
          owned = { paper: s.owned.paper.filter((id) => !!PAPER_SKINS[id]), bin: s.owned.bin.filter((id) => !!BIN_SKINS[id]) };
        }
        if (owned.paper.indexOf("plain") < 0) owned.paper.unshift("plain");
        if (owned.bin.indexOf("orange") < 0) owned.bin.unshift("orange");
        if (s.sel && typeof s.sel === "object") {
          if (PAPER_SKINS[s.sel.paper] && owned.paper.indexOf(s.sel.paper) >= 0) sel.paper = s.sel.paper;
          if (BIN_SKINS[s.sel.bin] && owned.bin.indexOf(s.sel.bin) >= 0) sel.bin = s.sel.bin;
        }
        muted = !!s.muted;
        throwsTotal = Math.max(0, s.throws | 0);
      } catch (_) { /* start fresh */ }
    }
    await load();
    skinBall(sel.paper);
    skinBin(sel.bin);

    const submitted = { level: 0, endless: 0 };
    async function submitRecord(ch, value) {
      if (!(value > submitted[ch])) return;
      submitted[ch] = value;
      try {
        await ctx.memory.record(ch).submit(value, { label: ch === "level" ? "Level " + value : value + " in a row" });
      } catch (_) { /* offline is fine, the game does not depend on it */ }
    }

    // ===================================================================== //
    // 12. Frame loop                                                        //
    // ===================================================================== //
    let lastW = ctx.width, lastH = ctx.height;
    function resize() {
      lastW = ctx.width; lastH = ctx.height;
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
      renderer.setSize(lastW, lastH, false);
      camera.aspect = lastW / Math.max(1, lastH);
      camera.updateProjectionMatrix();
    }
    resize();

    const projV = new THREE.Vector3();
    function toScreen(x, y, z) {
      projV.set(x, y, z).project(camera);
      return { x: ((projV.x + 1) / 2) * ctx.width, y: ((1 - projV.y) / 2) * ctx.height };
    }

    let clock = 0, shake = 0;
    ctx.onFrame((dtMs) => {
      if (ctx.width !== lastW || ctx.height !== lastH) resize();
      // Up to 100 ms per frame: a slow frame costs a coarser step, not slow motion.
      const dt = Math.min(dtMs, 100) / 1000;
      clock += dt;

      if (state === "fly" || state === "result") {
        if (ball.flying) {
          stepBall(dt);
          trailClock += dt;
          if (trailClock > 0.018) { trailClock = 0; trailStamp(ball.x, ball.y, ball.z); }
          drainHits();
          if (ball.done && state === "fly") {
            if (ball.done === "basket") shake = 0.6;
            binHitPlayed = false;
            resolveOutcome();
          }
        }
      }
      stepTrail(dt);
      stepFlies(dt, clock);

      // The fan: blades follow the wind, the head sweeps slowly.
      const wabs = Math.abs(wind);
      const spin = state === "title" || wabs < 0.02 ? 0 : 9 + wabs * 16;
      fan.userData.blades.rotation.z += spin * dt;
      fan.userData.head.rotation.y = Math.sin(clock * 0.6) * 0.3;
      fan.userData.head.rotation.x = -0.12;

      // A seated, breathing camera; a small kick when a sheet drops in.
      shake = Math.max(0, shake - dt * 2.2);
      const sh = shake * shake * 0.012;
      camera.rotation.set(
        -CAM_PITCH + Math.sin(clock * 0.37) * 0.004 + rnd(-1, 1) * sh,
        Math.sin(clock * 0.23) * 0.003 + rnd(-1, 1) * sh,
        0
      );

      syncBall();
      if (state === "aim") {
        const p = toScreen(ball.x, ball.y + 0.075, ball.z);
        el.up.style.left = p.x + "px"; el.up.style.top = p.y + "px";
        const q = toScreen(ball.x, ball.y - 0.02, ball.z);
        el.hand.style.left = q.x + "px"; el.hand.style.top = q.y + "px";
      }
      updateFanBed(state === "title" || state === "modal" ? 0 : wind);
      renderer.render(scene, camera);
    });

    // The title card sits over a rendered room; nothing else to do until a tap.
    placeBin(distFor(level), 0);
    syncBall();
    renderer.render(scene, camera);
    titleNote();

    ctx.onDestroy(() => {
      try { if (musicHandle) musicHandle.stop({ fadeOutMs: 400 }); } catch (_) { /* ignore */ }
      try { ctx.music.stop({ fadeOutMs: 400 }); } catch (_) { /* ignore */ }
      try { if (fanSrc) fanSrc.stop(); } catch (_) { /* ignore */ }
      try { if (fanOsc) fanOsc.stop(); } catch (_) { /* ignore */ }
      try { if (ac) ac.close(); } catch (_) { /* ignore */ }
      try { renderer.dispose(); } catch (_) { /* ignore */ }
    });

    } catch (err) {
      fatal("init", err);
    }
  }
};
