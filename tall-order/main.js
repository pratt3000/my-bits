/**
 * Tall Order — balance the tallest ice cream tower in town, by tilting.
 *
 * A scooper stands facing you in a little parlour, holding a waffle cone over
 * his head. Two machine arms, one on each side, swing in and lower scoop
 * after scoop onto the stack. The stack is an inverted pendulum in two axes:
 * it leans left, right, toward you and away, and you walk the cone under the
 * lean by tilting the phone — hold it upright, tilt the way the tower goes.
 * Where there are no motion sensors (the web player, a desktop) a drag does
 * the same job. Every scoop makes the tower taller, slower and less
 * forgiving. Big scoops land heavy, minis come in threes, and every so often
 * the machine warns INCOMING and both arms fire a burst for double points. A
 * scoop the tower is not under splats and costs a heart. The run ends when
 * the tower topples or the hearts run out; points (a clean, steady landing
 * builds a multiplier) and scoops both go to leaderboards.
 *
 * The physics, written out rather than faked, per axis:
 *  - the tower is one rigid body pivoting at the cone's rim. Its lean obeys
 *    th'' = (G / cy) (th + cx / cy) - K_CUP (1 - grown) th - (a / cy) grown - c th'
 *    with (cx, cy) the centre of mass in the tower's own frame, a the cone's
 *    horizontal acceleration, G an effective gravity that ice cream's
 *    stickiness reduces, and grown the fraction by which the stack has
 *    outgrown the cup of the cone, which springs a short stack back upright;
 *  - it topples when the centre of mass passes the edge of the cone's
 *    support, |th| > atan(SUP / cy): a tall tower leans slowly but has a tiny
 *    window, and a lopsided stack balances at a slight lean;
 *  - every scoop sits where it landed: an off-centre landing shifts the
 *    centre of mass for good and shoves the tower in proportion;
 *  - each scoop also carries a jelly wobble, a damped oscillator kicked by
 *    landings and by the cone's acceleration, so the stack whips like soft
 *    ice cream. It is cosmetic, and it is most of the feel.
 *
 * Everything on screen is built here: the parlour, the machine, the scooper,
 * every scoop, every texture and every sound. Packaged assets are disabled
 * for bits, so nothing is loaded except three.js from the registry.
 * Full screen (display "fullscreen"): the parlour runs edge to edge; the
 * banner, the hint, the cards and the framing of the scooper's feet are laid
 * out from ctx.contentSafeArea ?? ctx.safeArea, and the camera dollies back
 * as the tower grows so the top stays in view below the arms.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule).
 */
window.plethoraBit = {
  meta: {
    title: "Tall Order",
    runtime: "plethora-bit@2",
    tags: ["3d", "game", "arcade", "balance", "ice-cream", "tilt", "motion", "leaderboard"],
    permissions: ["audio", "backgroundMusic", "haptics", "motion", "storage"]
  },
  debug: null,

  async init(ctx) {
    // ===================================================================== //
    // 0. Helpers                                                            //
    // ===================================================================== //
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const TAU = Math.PI * 2;
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const outCubic = (t) => 1 - Math.pow(1 - t, 3);
    const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    // ctx.storage.set() returns nothing on device; never chain onto it.
    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (_) { /* not supported on this runtime */ }
    }
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    function fatal(stage, err) {
      try { ctx.platform.error({ stage: stage, message: String((err && err.message) || err), stack: String((err && err.stack) || "") }); } catch (_) { /* nothing left to do */ }
      throw err;
    }

    try {
    // ===================================================================== //
    // 1. Creator tuning                                                     //
    // ===================================================================== //
    // Every knob has a default that matches the manifest, so the game plays
    // the same when ctx.tune has nothing to say.
    function knob(kind, id, fb) {
      try {
        const t = ctx.tune;
        if (!t || typeof t[kind] !== "function") return fb;
        const v = t[kind](id);
        if (v === undefined || v === null) return fb;
        if (typeof fb === "number" && !(typeof v === "number" && isFinite(v))) return fb;
        return v;
      } catch (_) { return fb; }
    }
    const RAMP_DEFAULT = [[0, 0.85], [10, 1.1], [25, 1.6], [50, 2.4]];
    function rampDefault(n) {
      const p = RAMP_DEFAULT;
      if (n <= p[0][0]) return p[0][1];
      for (let i = 1; i < p.length; i++) {
        if (n <= p[i][0]) return lerp(p[i - 1][1], p[i][1], smooth(p[i - 1][0], p[i][0], n));
      }
      return p[p.length - 1][1];
    }
    const tune = {
      topple: () => knob("number", "topple_speed", 1),
      sticky: () => knob("percent", "stickiness", 0.35),
      interval: () => knob("durationMs", "drop_interval_ms", 2000),
      error: () => knob("percent", "placement_error", 0.3),
      rushEvery: () => Math.max(3, knob("integer", "rush_every", 8) | 0),
      bigChance: () => knob("percent", "big_scoop_chance", 0.15),
      miniChance: () => knob("percent", "mini_scoop_chance", 0.12),
      sens: () => knob("number", "control_sensitivity", 1),
      forward: () => knob("choice", "tilt_forward", "away"),
      music: () => knob("percent", "music_intensity", 0.5),
      ramp: (n) => {
        try {
          const c = ctx.tune && ctx.tune.curve ? ctx.tune.curve("difficulty_ramp") : null;
          if (c && typeof c.at === "function") {
            const v = c.at(n);
            if (typeof v === "number" && isFinite(v) && v > 0) return v;
          }
        } catch (_) { /* fall through */ }
        return rampDefault(n);
      }
    };

    // ===================================================================== //
    // 2. Surfaces and the DOM overlay                                       //
    // ===================================================================== //
    // The scene is a WebGL canvas; the HUD, the cards and the title sit on a
    // DOM root above it that passes every touch through except on its
    // buttons.
    const canvas = ctx.createCanvas({ touchAction: "none", layer: "content" });
    const ui = ctx.createRoot({ layer: "overlay", input: "passthrough" });

    function coneIcon(size, cls) {
      return '<svg viewBox="0 0 32 40" width="' + size + '" height="' + Math.round(size * 1.25) + '"' + (cls ? ' class="' + cls + '"' : "") + '>' +
        '<path d="M8 18 L16 38 L24 18 Z" fill="#e3a062" stroke="#b36f35" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<circle cx="16" cy="14" r="9" fill="#ff8ea6"/><circle cx="12.5" cy="10.5" r="2.6" fill="rgba(255,255,255,.7)"/>' +
        '<circle cx="16" cy="6" r="2.2" fill="#e8293f"/></svg>';
    }
    const SVG_LOGO = '<svg viewBox="0 0 80 120" width="84" height="126">' +
      '<path d="M22 62 L40 116 L58 62 Z" fill="#e3a062" stroke="#b36f35" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M26 70 L52 94 M30 82 L46 104 M54 70 L28 94 M50 82 L34 104" stroke="#b36f35" stroke-width="1.5" opacity=".7"/>' +
      '<circle cx="40" cy="56" r="19" fill="#fff3d2"/><circle cx="40" cy="36" r="17" fill="#9fe6c7"/><circle cx="40" cy="18" r="15" fill="#ff8ea6"/>' +
      '<circle cx="33" cy="12" r="4" fill="rgba(255,255,255,.75)"/><circle cx="33" cy="31" r="3.6" fill="rgba(255,255,255,.6)"/><circle cx="33" cy="51" r="3.6" fill="rgba(255,255,255,.6)"/>' +
      '<path d="M40 4 q4 -4 7 -1" stroke="#4b7d2f" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="40" cy="6" r="4.5" fill="#e8293f"/></svg>';

    ui.innerHTML =
      "<style>" +
      ".to{position:absolute;inset:0;overflow:hidden;font-family:'Nunito Sans',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:#fff;pointer-events:none;}" +
      ".to *{box-sizing:border-box;}" +
      ".to-hud{position:absolute;left:calc(12px + var(--sl,0px));right:calc(12px + var(--sr,0px));top:calc(10px + var(--st,0px));display:flex;align-items:center;gap:8px;opacity:0;transition:opacity .4s;}" +
      ".to-hud.on{opacity:1;}" +
      ".to-hud:not(.on) .to-pause{pointer-events:none;}" +
      ".to-pill{display:flex;align-items:baseline;gap:5px;padding:7px 12px 6px;border-radius:16px;background:rgba(255,255,255,.88);color:#3b2a4a;box-shadow:0 6px 16px rgba(60,20,60,.22),inset 0 1px 0 #fff;}" +
      ".to-pill b{font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:30px;line-height:1;letter-spacing:.02em;}" +
      ".to-pill span{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8a6fa0;}" +
      ".to-score{margin-left:auto;}" +
      ".to-mult{color:#ff5a7a !important;font-size:13px !important;transition:transform .2s;}" +
      ".to-mult.hot{transform:scale(1.2);}" +
      ".to-hearts{display:flex;gap:3px;align-items:center;padding:0 2px;}" +
      ".to-hearts svg{filter:drop-shadow(0 2px 2px rgba(0,0,0,.3));transition:opacity .3s,transform .3s;}" +
      ".to-hearts svg.lost{opacity:.25;transform:scale(.75);}" +
      ".to-pause{width:40px;height:40px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;background:rgba(255,255,255,.88);box-shadow:0 6px 16px rgba(60,20,60,.22);}" +
      ".to-pause i{display:block;width:5px;height:15px;border-radius:2px;background:#5c4a73;margin:0 2px;}" +
      ".to-banner{position:absolute;left:0;right:0;top:34%;display:flex;justify-content:center;opacity:0;pointer-events:none;}" +
      ".to-banner.on{animation:toBanner 1.3s ease-out forwards;}" +
      ".to-banner-in{padding:10px 26px 12px;border-radius:12px;text-align:center;transform:rotate(-3deg);background:repeating-linear-gradient(135deg,#ffd23f 0 14px,#2b2233 14px 28px);box-shadow:0 10px 30px rgba(0,0,0,.35);}" +
      ".to-banner-in b{display:block;font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:54px;line-height:1;letter-spacing:.06em;color:#fff;text-shadow:0 3px 0 #2b2233,0 0 18px rgba(0,0,0,.4);-webkit-text-stroke:2px #2b2233;}" +
      ".to-banner-in span{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:8px;background:#2b2233;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#ffd23f;}" +
      ".to-toast{position:absolute;left:0;right:0;top:26%;text-align:center;opacity:0;pointer-events:none;}" +
      ".to-toast.on{animation:toPop 1.1s cubic-bezier(.2,1.4,.4,1) forwards;}" +
      ".to-toast b{display:block;font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:58px;line-height:1;letter-spacing:.05em;color:#fff;text-shadow:0 3px 0 rgba(90,40,90,.35),0 10px 26px rgba(0,0,0,.4);}" +
      ".to-toast span{display:block;margin-top:4px;font-size:16px;font-weight:800;color:#ffe07a;text-shadow:0 2px 6px rgba(0,0,0,.5);}" +
      ".to-hint{position:absolute;left:calc(16px + var(--sl,0px));right:calc(16px + var(--sr,0px));bottom:calc(16px + var(--sb,0px));display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.92);text-shadow:0 1px 3px rgba(0,0,0,.6);opacity:0;transition:opacity .35s;}" +
      ".to-finger{width:54px;height:30px;position:relative;display:none;}" +
      ".to-finger.on{display:block;}" +
      ".to-finger::before{content:'';position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,255,255,.95);box-shadow:0 0 0 6px rgba(255,255,255,.3);animation:toFinger 1.6s ease-in-out infinite;}" +
      ".to-finger::after{content:'';position:absolute;left:4px;right:4px;top:50%;height:2px;margin-top:-1px;border-radius:1px;background:rgba(255,255,255,.45);}" +
      ".to-phone{width:26px;height:44px;border-radius:6px;border:2.5px solid rgba(255,255,255,.95);display:none;position:relative;animation:toPhone 2.2s ease-in-out infinite;box-shadow:0 6px 14px rgba(0,0,0,.35);}" +
      ".to-phone.on{display:block;}" +
      ".to-phone::after{content:'';position:absolute;left:50%;bottom:3px;width:8px;height:2px;margin-left:-4px;border-radius:1px;background:rgba(255,255,255,.8);}" +
      "@keyframes toPhone{0%,100%{transform:rotate(-16deg);}50%{transform:rotate(16deg);}}" +
      ".to-fade{position:absolute;inset:0;background:#1a0f2a;opacity:0;transition:opacity .35s;}" +
      ".to-modal{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:calc(16px + var(--st,0px)) calc(20px + var(--sr,0px)) calc(16px + var(--sb,0px)) calc(20px + var(--sl,0px));background:rgba(30,14,46,.5);pointer-events:auto;}" +
      ".to-modal.on{display:flex;}" +
      ".to-card{width:100%;max-width:340px;max-height:100%;overflow:auto;border-radius:22px;padding:22px 18px 18px;text-align:center;color:#3b2a4a;background:linear-gradient(180deg,#fffaf3,#ffeef6);box-shadow:0 24px 60px rgba(30,10,40,.5),inset 0 1px 0 #fff;animation:toCard .35s cubic-bezier(.2,1.3,.4,1);}" +
      ".to-card h2{margin:0;font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:44px;letter-spacing:.04em;line-height:1;color:#4a2d6b;}" +
      ".to-card p{margin:6px 0 0;font-size:14px;line-height:1.5;color:#7a5f93;}" +
      ".to-big{display:flex;justify-content:center;gap:26px;margin:14px 0 4px;}" +
      ".to-big div{display:flex;flex-direction:column;align-items:center;}" +
      ".to-big b{font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:46px;line-height:1;color:#ff5a7a;}" +
      ".to-big span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8a6fa0;margin-top:3px;font-weight:800;}" +
      ".to-best{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8a6fa0;margin-top:4px;}" +
      ".to-best.new{color:#ff5a7a;}" +
      ".to-lb{margin:12px 0 4px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.6);text-align:left;}" +
      ".to-lb h3{margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a6fa0;}" +
      ".to-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:14px;font-weight:700;color:#4a2d6b;border-top:1px solid rgba(74,45,107,.08);}" +
      ".to-row:first-child{border-top:0;}" +
      ".to-row.me{color:#ff5a7a;}" +
      ".to-row .rk{width:26px;font-family:'Bebas Neue',Impact,sans-serif;font-size:20px;color:#b39cc8;}" +
      ".to-row.me .rk{color:#ff5a7a;}" +
      ".to-row .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".to-row .vl{font-variant-numeric:tabular-nums;}" +
      ".to-lbs{margin-top:6px;font-size:12px;color:#8a6fa0;}" +
      ".to-btn{display:block;width:100%;margin-top:10px;padding:14px 16px;border-radius:14px;font-size:15px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fff;pointer-events:auto;cursor:pointer;" +
      "background:linear-gradient(180deg,#ff7a9a,#ff4d79);box-shadow:0 4px 0 #c2305a,0 10px 20px rgba(255,77,121,.3),inset 0 1px 0 rgba(255,255,255,.35);}" +
      ".to-btn:active{transform:translateY(2px);box-shadow:0 2px 0 #c2305a,0 4px 12px rgba(255,77,121,.3);}" +
      ".to-btn.g{background:linear-gradient(180deg,#e9dcf5,#cdb7e3);color:#4a2d6b;box-shadow:0 4px 0 #9d82bb,0 10px 20px rgba(0,0,0,.15),inset 0 1px 0 rgba(255,255,255,.5);}" +
      ".to-btn.g:active{box-shadow:0 2px 0 #9d82bb,0 4px 12px rgba(0,0,0,.15);}" +
      ".to-chips{display:flex;gap:8px;justify-content:center;margin-top:10px;}" +
      ".to-chip{padding:9px 12px;border-radius:12px;white-space:nowrap;font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;pointer-events:auto;cursor:pointer;background:rgba(255,255,255,.16);color:#fff;border:1.5px solid rgba(255,255,255,.35);}" +
      ".to-card .to-chip{background:rgba(74,45,107,.08);color:#4a2d6b;border-color:rgba(74,45,107,.18);}" +
      ".to-curtain{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:calc(20px + var(--st,0px)) calc(28px + var(--sr,0px)) calc(24px + var(--sb,0px)) calc(28px + var(--sl,0px));text-align:center;pointer-events:auto;" +
      "background:radial-gradient(120% 90% at 50% 15%,rgba(90,40,120,.5) 0%,rgba(40,16,70,.76) 55%,rgba(18,8,36,.92) 100%);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:opacity .45s ease;}" +
      ".to-title{font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-size:clamp(64px,22vw,108px);letter-spacing:.04em;line-height:.88;" +
      "background:linear-gradient(180deg,#fff8ec 0%,#ffd3e6 45%,#ff5a7a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 8px 22px rgba(255,90,122,.35));}" +
      ".to-sub{font-size:15px;line-height:1.5;max-width:22em;color:rgba(255,255,255,.78);}" +
      ".to-cbest{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#ffd27a;min-height:15px;}" +
      ".to-cbtn{width:min(100%,280px);margin-top:6px;}" +
      ".to-note{font-size:12px;letter-spacing:.04em;color:rgba(255,255,255,.45);min-height:15px;max-width:24em;line-height:1.4;}" +
      ".to-logo{filter:drop-shadow(0 14px 24px rgba(0,0,0,.5));animation:toBob 2.6s ease-in-out infinite;}" +
      "@keyframes toBob{0%,100%{transform:translateY(0) rotate(-3deg);}50%{transform:translateY(-10px) rotate(3deg);}}" +
      "@keyframes toFinger{0%{transform:translateX(-16px);}50%{transform:translateX(16px);}100%{transform:translateX(-16px);}}" +
      "@keyframes toBanner{0%{opacity:0;transform:scale(.6);}12%{opacity:1;transform:scale(1.06);}22%{transform:scale(1);}80%{opacity:1;}100%{opacity:0;transform:scale(1.02);}}" +
      "@keyframes toPop{0%{opacity:0;transform:scale(.6);}18%{opacity:1;transform:scale(1.08);}30%{transform:scale(1);}78%{opacity:1;}100%{opacity:0;transform:translateY(-16px);}}" +
      "@keyframes toCard{0%{opacity:0;transform:translateY(18px) scale(.96);}100%{opacity:1;transform:none;}}" +
      ".to-level{width:40px;height:40px;border-radius:50%;flex:none;position:relative;background:rgba(255,255,255,.88);box-shadow:0 6px 16px rgba(60,20,60,.22),inset 0 0 0 2px rgba(74,45,107,.1);}" +
      ".to-level::before{content:'';position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px;border-radius:50%;border:1.5px dashed rgba(74,45,107,.3);}" +
      ".to-level::after{content:'';position:absolute;left:50%;top:7px;width:2px;height:5px;margin-left:-1px;border-radius:1px;background:rgba(74,45,107,.25);}" +
      ".to-level i{position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px;border-radius:50%;background:#5cc98b;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:background .2s;}" +
      ".to-level i.warn{background:#ffb347;}" +
      ".to-level i.hot{background:#ff5a7a;}" +
      ".to-floats{position:absolute;inset:0;overflow:hidden;pointer-events:none;}" +
      ".to-float{position:absolute;left:0;top:0;font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-size:26px;letter-spacing:.04em;color:#fff;text-shadow:0 2px 0 rgba(90,40,90,.35),0 6px 16px rgba(0,0,0,.4);white-space:nowrap;animation:toFloat 1.1s ease-out forwards;}" +
      "@keyframes toFloat{0%{opacity:0;transform:translate(-50%,-30%) scale(.7);}15%{opacity:1;transform:translate(-50%,-50%) scale(1.1);}30%{transform:translate(-50%,-50%) scale(1);}75%{opacity:1;}100%{opacity:0;transform:translate(-50%,-160%);}}" +
      "</style>" +
      '<div class="to" data-el="stage">' +
      '<div class="to-hud" data-el="hud">' +
      '<div class="to-pill"><b data-el="scoops">0</b><span>scoops</span></div>' +
      '<div class="to-hearts" data-el="hearts"></div>' +
      '<div class="to-level" data-el="level"><i data-el="bubble"></i></div>' +
      '<div class="to-pill to-score"><b data-el="score">0</b><span class="to-mult" data-el="mult">×1</span></div>' +
      '<div class="to-pause" data-act="pause"><i></i><i></i></div>' +
      "</div>" +
      '<div class="to-banner" data-el="banner"><div class="to-banner-in"><b data-el="bannerb">INCOMING!</b><span data-el="banners">hold on</span></div></div>' +
      '<div class="to-toast" data-el="toast"><b data-el="toastb"></b><span data-el="toasts"></span></div>' +
      '<div class="to-hint" data-el="hint"><div class="to-phone" data-el="phone"></div><div class="to-finger" data-el="finger"></div><span data-el="hintt"></span></div>' +
      '<div class="to-floats" data-el="floats"></div>' +
      '<div class="to-fade" data-el="fade"></div>' +
      '<div class="to-modal" data-el="modal"><div class="to-card" data-el="card"></div></div>' +
      '<div class="to-curtain" data-el="curtain">' +
      '<div class="to-logo">' + SVG_LOGO + "</div>" +
      '<div class="to-title">TALL<br>ORDER</div>' +
      '<div class="to-sub">Balance the tallest ice cream tower in town. Tilt the phone to walk the cone under the lean before it goes.</div>' +
      '<div class="to-cbest" data-el="cbest"></div>' +
      '<div class="to-btn to-cbtn" data-act="play">Play</div>' +
      '<div class="to-chips"><div class="to-chip" data-act="control" data-el="ctrlc">Tilt</div><div class="to-chip" data-act="mute" data-el="mutec">Sound on</div></div>' +
      '<div class="to-note" data-el="cnote"></div>' +
      "</div></div>";

    const el = {};
    for (const n of ui.querySelectorAll("[data-el]")) el[n.getAttribute("data-el")] = n;

    // ===================================================================== //
    // 3. Insets, layout and the camera                                      //
    // ===================================================================== //
    // The area a thumb can use. In a full-screen bit the container covers
    // the whole phone and Plethora's logo button floats over the bottom
    // centre; ctx.contentSafeArea is ctx.safeArea moved in past that button
    // (and, in the web player, past its back arrow). Text and controls stay
    // inside it; the sky and the deck run to every edge underneath. An older
    // app plays this same file in the legacy safe frame, where
    // contentSafeArea is undefined and safeArea.bottom is a fixed 120 under
    // the logo, so the fallback chain is the SDK's own: contentSafeArea ??
    // safeArea. Both are frozen live objects the host replaces when the
    // insets change — read every frame, never assigned.
    function readArea() {
      const a = ctx.contentSafeArea || ctx.safeArea || {};
      return {
        top: Math.max(a.top || 0, 0), bottom: Math.max(a.bottom || 0, 0),
        left: Math.max(a.left || 0, 0), right: Math.max(a.right || 0, 0)
      };
    }
    let insets = readArea();
    let insetKey = "";
    function applyInsets() {
      const a = readArea();
      const key = a.top + "," + a.bottom + "," + a.left + "," + a.right;
      if (key === insetKey) return false;
      insetKey = key;
      insets = a;
      el.stage.style.setProperty("--st", a.top + "px");
      el.stage.style.setProperty("--sb", a.bottom + "px");
      el.stage.style.setProperty("--sl", a.left + "px");
      el.stage.style.setProperty("--sr", a.right + "px");
      return true;
    }
    applyInsets();

    // The 3D camera frames the scene inside the content safe area, below
    // the banner and above the logo button (section 6).
    const HUD_H = 60;

    // ===================================================================== //
    // 4. Sound: a small synth for the effects, ctx.music for the bed        //
    // ===================================================================== //
    let ac = null, master = null, noiseBuf = null;
    let muted = false;
    function audioInit() {
      if (ac || !ctx.capabilities.audio) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.8;
        master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.5), ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        ctx.onDestroy(() => { try { ac.close(); } catch (_) { /* fine */ } });
      } catch (_) { ac = null; }
    }
    function resumeAudio() {
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (_) { /* fine */ } }
    }
    function tone(f0, f1, dur, peak, type, delay) {
      if (!ac || muted) return;
      try {
        const t0 = ac.currentTime + (delay || 0);
        const o = ac.createOscillator();
        o.type = type || "sine";
        o.frequency.setValueAtTime(Math.max(20, f0), t0);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
        const gn = ac.createGain();
        gn.gain.setValueAtTime(0.0001, t0);
        gn.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(gn); gn.connect(master);
        o.start(t0); o.stop(t0 + dur + 0.03);
      } catch (_) { /* a node failed; silence is fine */ }
    }
    function noise(dur, peak, freq, q, type, delay) {
      if (!ac || muted) return;
      try {
        const t0 = ac.currentTime + (delay || 0);
        const srcNode = ac.createBufferSource();
        srcNode.buffer = noiseBuf;
        const bq = ac.createBiquadFilter();
        bq.type = type || "lowpass"; bq.frequency.value = freq; bq.Q.value = q || 0.8;
        const gn = ac.createGain();
        gn.gain.setValueAtTime(0.0001, t0);
        gn.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        srcNode.connect(bq); bq.connect(gn); gn.connect(master);
        srcNode.start(t0); srcNode.stop(t0 + dur + 0.03);
      } catch (_) { /* fine */ }
    }
    const sfx = {
      plop(kind) {
        const f = kind === "big" ? 150 : kind === "mini" ? 440 : 260;
        tone(f * 1.7, f * 0.55, kind === "big" ? 0.22 : 0.15, kind === "big" ? 0.6 : 0.42, "sine");
        noise(0.07, 0.22, 900, 0.8, "lowpass");
      },
      squish() { noise(0.16, 0.14, 520, 1.2, "bandpass"); },
      clean(n) {
        tone(620 + n * 55, 930 + n * 55, 0.11, 0.22, "triangle");
        tone(930 + n * 55, 1240 + n * 55, 0.14, 0.18, "triangle", 0.07);
      },
      miss() { noise(0.26, 0.5, 340, 0.6, "lowpass"); tone(220, 80, 0.32, 0.3, "sawtooth"); },
      alarm() {
        for (let i = 0; i < 3; i++) {
          tone(880, 880, 0.09, 0.28, "square", i * 0.19);
          tone(1175, 1175, 0.09, 0.28, "square", i * 0.19 + 0.095);
        }
      },
      milestone() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.2, 0.26, "triangle", i * 0.085)); },
      topple() {
        noise(0.6, 0.55, 600, 0.5, "lowpass");
        tone(320, 50, 0.8, 0.4, "sawtooth");
        for (let i = 0; i < 5; i++) noise(0.12, 0.3, 260 + i * 90, 1, "lowpass", 0.18 + i * 0.12);
      },
      click() { tone(900, 700, 0.05, 0.14, "square"); },
      heart() { tone(440, 330, 0.18, 0.24, "triangle"); tone(330, 220, 0.26, 0.24, "triangle", 0.16); },
      whir(len) { noise(len, 0.05, 1600, 2, "bandpass"); tone(170, 230, len, 0.045, "sawtooth"); },
      release() { tone(1200, 420, 0.08, 0.1, "square"); },
      phew() { tone(520, 390, 0.3, 0.16, "sine"); }
    };
    function haptic(kind) {
      if (!ctx.capabilities.haptics) return;
      try { ctx.platform.haptic(kind); } catch (_) { /* fine */ }
    }

    let music = null, musicStarting = false;
    async function musicStart() {
      if (music || musicStarting || muted || !ctx.capabilities.backgroundMusic) return;
      musicStarting = true;
      try {
        await ctx.music.unlock();
        if (disposed || muted) return;
        music = ctx.music.play({ preset: "cozy", id: "bed", volume: 0.26, tempo: 96, intensity: tune.music(), fadeInMs: 900, scale: "major" });
      } catch (_) { music = null; }
      musicStarting = false;
    }
    function musicSet(o) {
      if (!music) return;
      try {
        if (o.tempo) music.setTempo(clamp(o.tempo, 60, 160));
        if (typeof o.intensity === "number") music.setIntensity(clamp(o.intensity, 0, 1), { fadeMs: 500 });
      } catch (_) { /* fine */ }
    }
    function musicSting(name) { if (music) fireAndForget(() => music.sting(name)); }
    function musicDuck(amount, ms) { if (music) { try { music.duck(amount, ms); } catch (_) { /* fine */ } } }
    function applyMute() {
      if (master) master.gain.value = muted ? 0 : 0.8;
      if (music) { try { music.setVolume(muted ? 0 : 0.26, { fadeMs: 200 }); } catch (_) { /* fine */ } }
      el.mutec.textContent = muted ? "Sound off" : "Sound on";
    }


    // ===================================================================== //
    // 5. three.js, procedural textures, renderer, lights                    //
    // ===================================================================== //
    let THREE;
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e1) {
      try { THREE = await ctx.importModule(THREE_URL); }
      catch (e2) { throw new Error("three.js did not load: " + ((e2 && e2.message) || (e1 && e1.message) || "unknown")); }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) throw new Error("three.js loaded without WebGLRenderer");
    if (disposed) return;

    // Offscreen surfaces for texture bakes go to an OffscreenCanvas or
    // nowhere: without one every texture function returns null and the
    // materials fall back to flat colours. Textures are painted with plain
    // drawing calls, never pixel loops.
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function surface(w, h) {
      if (!CAN_BAKE) return null;
      try {
        const c = new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
        return c.getContext("2d") ? c : null;
      } catch (_) { return null; }
    }
    function texOf(c, opts) {
      if (!c) return null;
      opts = opts || {};
      const t = new THREE.CanvasTexture(c);
      if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
      t.anisotropy = opts.aniso || 4;
      return t;
    }
    /** Material options with a map, or the flat colour when the bake was skipped. */
    function mapped(tex, color, extra) {
      const o = extra || {};
      o.map = tex;
      o.color = tex ? 0xffffff : color;
      return o;
    }
    function tileTex() {
      const W = 512, c = surface(W, W);
      if (!c) return null;
      const g = c.getContext("2d");
      const n = 4, s = W / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? "#f6efe4" : "#9fdcc9";
        g.fillRect(i * s, j * s, s, s);
        g.fillStyle = (i + j) % 2 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.22)";
        g.fillRect(i * s + 6, j * s + 6, s - 12, 10);
      }
      g.strokeStyle = "rgba(90,70,60,0.35)"; g.lineWidth = 4;
      for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, W); g.stroke(); g.beginPath(); g.moveTo(0, k * s); g.lineTo(W, k * s); g.stroke(); }
      return texOf(c, { repeat: [5, 5], aniso: 8 });
    }
    function stripeTex() {
      const W = 256, c = surface(W, W);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#fff3f6"; g.fillRect(0, 0, W, W);
      g.fillStyle = "#ffd2de";
      for (let x = 0; x < W; x += 64) g.fillRect(x, 0, 32, W);
      return texOf(c, { repeat: [10, 3] });
    }
    function woodTex() {
      const W = 512, H = 256, c = surface(W, H);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#b9834f"; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? "rgba(90,50,20,0.16)" : "rgba(255,230,190,0.14)";
        g.fillRect(0, i * H / 6, W, H / 6);
        g.strokeStyle = "rgba(70,40,15,0.45)"; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, i * H / 6); g.lineTo(W, i * H / 6); g.stroke();
      }
      g.strokeStyle = "rgba(70,40,15,0.18)"; g.lineWidth = 1.5;
      for (let k = 0; k < 40; k++) { const y = rnd(0, H), x0 = rnd(0, W); g.beginPath(); g.moveTo(x0, y); g.bezierCurveTo(x0 + 60, y + rnd(-6, 6), x0 + 120, y + rnd(-6, 6), x0 + 180, y); g.stroke(); }
      return texOf(c, { repeat: [2, 1] });
    }
    function boardTex() {
      const W = 512, H = 384, c = surface(W, H);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#1f3a33"; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,0.05)";
      for (let k = 0; k < 60; k++) g.fillRect(rnd(0, W), rnd(0, H), rnd(10, 60), rnd(2, 6));
      g.fillStyle = "#f6efe0"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "400 54px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
      g.fillText("TODAY'S SCOOPS", W / 2, 54);
      g.strokeStyle = "rgba(246,239,224,0.6)"; g.lineWidth = 3; g.beginPath(); g.moveTo(60, 90); g.lineTo(W - 60, 90); g.stroke();
      g.font = "700 26px 'Nunito Sans', sans-serif"; g.textAlign = "left";
      const rows = ["Strawberry  .  .  .  2", "Pistachio  .  .  .  2", "Mango  .  .  .  .  .  2", "Cookies  .  .  .  .  3", "Big scoop  .  .  .  5"];
      rows.forEach((r, i) => { g.fillStyle = ["#ff8ea6", "#c3dd7e", "#ffbe55", "#e6e0d6", "#9fe6c7"][i]; g.fillText(r, 70, 140 + i * 46); });
      return texOf(c);
    }
    function signTex() {
      const W = 768, H = 160, c = surface(W, H);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#1a1022"; g.fillRect(0, 0, W, H);
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "400 96px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
      g.shadowColor = "#ff5a7a"; g.shadowBlur = 28; g.fillStyle = "#ffd6e0";
      g.fillText("SCOOP·O·MATIC", W / 2, H / 2 + 4);
      g.shadowBlur = 0; g.fillStyle = "#fff4f7"; g.fillText("SCOOP·O·MATIC", W / 2, H / 2 + 4);
      return texOf(c);
    }
    function waffleTex() {
      const W = 256, c = surface(W, W);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#e4a463"; g.fillRect(0, 0, W, W);
      g.strokeStyle = "rgba(120,60,20,0.6)"; g.lineWidth = 6;
      for (let k = -W; k < 2 * W; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + W, W); g.stroke(); g.beginPath(); g.moveTo(k, W); g.lineTo(k + W, 0); g.stroke(); }
      g.fillStyle = "rgba(255,220,170,0.25)";
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) g.fillRect(i * 32 + 10, j * 32 + 10, 8, 8);
      return texOf(c, { repeat: [4, 2] });
    }
    function speckTex() {
      const W = 256, c = surface(W, W);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#e9e3d8"; g.fillRect(0, 0, W, W);
      g.fillStyle = "#3b2418";
      for (let k = 0; k < 90; k++) { g.beginPath(); g.ellipse(rnd(0, W), rnd(0, W), rnd(2, 7), rnd(2, 5), rnd(0, 3), 0, TAU); g.fill(); }
      return texOf(c, { repeat: [2, 1] });
    }
    function blobTex() {
      const W = 128, c = surface(W, W);
      if (!c) return null;
      const g = c.getContext("2d");
      const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
      gr.addColorStop(0, "rgba(40,20,50,0.55)");
      gr.addColorStop(0.55, "rgba(40,20,50,0.28)");
      gr.addColorStop(1, "rgba(40,20,50,0)");
      g.fillStyle = gr; g.fillRect(0, 0, W, W);
      return texOf(c);
    }
    // A parlour reflected in chrome and gloss: bright ceiling, pastel walls,
    // a warm floor, painted as bands with a few lamp bars.
    function envTex() {
      const W = 256, H = 128, c = surface(W, H);
      if (!c) return null;
      const g = c.getContext("2d");
      const stops = [[252, 248, 242], [255, 226, 232], [196, 236, 224], [150, 120, 100], [70, 55, 50]];
      const bands = 48;
      for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1) * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
        const a = stops[k], b = stops[k + 1];
        g.fillStyle = "rgb(" + Math.round(lerp(a[0], b[0], f)) + "," + Math.round(lerp(a[1], b[1], f)) + "," + Math.round(lerp(a[2], b[2], f)) + ")";
        g.fillRect(0, i * H / bands, W, H / bands + 1);
      }
      g.fillStyle = "rgba(255,255,255,0.95)";
      for (let i = 0; i < 5; i++) g.fillRect(10 + i * 50, 14, 30, 8);
      g.fillStyle = "rgba(255,120,160,0.6)"; g.fillRect(40, 44, 70, 7);
      g.fillStyle = "rgba(120,220,200,0.5)"; g.fillRect(160, 50, 50, 6);
      const t = new THREE.CanvasTexture(c);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (_) { /* fine */ } });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4e3ea);
    const envMap = envTex();
    if (envMap) { scene.environment = envMap; scene.environmentIntensity = 0.55; }

    // Metres. The floor is y = 0; the scooper faces +z, toward the camera.
    const camera = new THREE.PerspectiveCamera(50, ctx.width / Math.max(1, ctx.height), 0.05, 60);
    camera.position.set(0, 1.9, 4.4);
    camera.lookAt(0, 1.2, 0);

    scene.add(new THREE.HemisphereLight(0xfff4ea, 0x9a8f96, 0.7));
    const key = new THREE.DirectionalLight(0xfff0d6, 2.1);
    key.position.set(3.2, 5.2, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 20;
    key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 6; key.shadow.camera.bottom = -2;
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key); scene.add(key.target);
    const fill = new THREE.DirectionalLight(0xd8e8ff, 0.55);
    fill.position.set(-3.5, 3, 3);
    scene.add(fill);
    const lamp = new THREE.PointLight(0xffd9a8, 0.9, 7, 1.6);
    lamp.position.set(0, 3.6, -0.4);
    scene.add(lamp);

    // Shared materials and builders.
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e6ec, metalness: 1, roughness: 0.2, envMapIntensity: 1.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2233, roughness: 0.55, metalness: 0.35 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xff5a7a, roughness: 0.4, metalness: 0.1 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6c89f, roughness: 0.65 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfffaf2, roughness: 0.7 });
    function box(w, h, d, mat, x, y, z, o) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = !(o && o.noCast);
      m.receiveShadow = !(o && o.noReceive);
      if (o && o.ry) m.rotation.y = o.ry;
      if (o && o.rx) m.rotation.x = o.rx;
      if (o && o.rz) m.rotation.z = o.rz;
      return m;
    }
    function cyl(rt, rb, h, mat, x, y, z, seg) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 24), mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    }
    function sphere(r, mat, x, y, z, seg) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg || 24, seg ? Math.max(8, seg >> 1) : 16), mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    }
    function capsule(r, len, mat) {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 16), mat);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    }
    // Lay a unit-height mesh (built along +y, centred) between two points.
    const _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
    function placeSegment(mesh, a, b, radius) {
      _dir.subVectors(b, a);
      const len = Math.max(0.001, _dir.length());
      mesh.position.copy(a).addScaledVector(_dir, 0.5);
      _q.setFromUnitVectors(_up, _dir.multiplyScalar(1 / len));
      mesh.quaternion.copy(_q);
      mesh.scale.set(radius || 1, len, radius || 1);
    }

    // ===================================================================== //
    // 6. The parlour, the machine, the scooper, the cone, the scoops        //
    // ===================================================================== //
    function hashi(x, y, z) {
      let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1103515245);
      h = Math.imul(h ^ (h >>> 16), 2246822519);
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
    }
    const fade = (t) => t * t * (3 - 2 * t);
    function vnoise3(x, y, z) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
      const c = (dx, dy, dz) => hashi(xi + dx, yi + dy, zi + dz);
      return lerp(
        lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
        lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
    }

    const MAN_H = 1.98, HEAD_Y = 1.44, CONE_H = 0.26, CONE_R = 0.07, PIVOT_Y = MAN_H + CONE_H;
    const KINDS = {
      regular: { r: 0.085, m: 1, pts: 100 },
      big: { r: 0.125, m: 2.4, pts: 150 },
      mini: { r: 0.055, m: 0.45, pts: 60 }
    };
    const FLAVORS = [
      { n: "vanilla", c: 0xfff3d2 }, { n: "strawberry", c: 0xff8ea6 }, { n: "chocolate", c: 0x7a4631 },
      { n: "mint", c: 0x9fe6c7 }, { n: "blueberry", c: 0x8b93ff }, { n: "mango", c: 0xffbe55 },
      { n: "pistachio", c: 0xc3dd7e }, { n: "bubblegum", c: 0xffa3ea }, { n: "cookies", c: 0xe6e0d6, speck: true }, { n: "caramel", c: 0xdba05c }
    ];
    const SPRINKLE_COLORS = [0xff5a7a, 0xffd23f, 0x5ad1ff, 0x8bf0a1, 0xffffff, 0xc58bff];

    const tileT = tileTex(), stripeT = stripeTex(), woodT = woodTex(), boardT = boardTex(), signT = signTex(), waffleT = waffleTex(), speckT = speckTex();
    const world = new THREE.Group();
    scene.add(world);

    // --- the room ----------------------------------------------------------
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial(mapped(tileT, 0xcfe8df, { roughness: 0.3, metalness: 0.04, envMapIntensity: 0.8 })));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
    const wallMat = new THREE.MeshStandardMaterial(mapped(stripeT, 0xffe4ec, { roughness: 0.92 }));
    world.add(box(16, 7.6, 0.2, wallMat, 0, 3.8, -3.3, { noCast: true }));
    world.add(box(0.2, 7.6, 12, wallMat, -4.7, 3.8, 0, { noCast: true }));
    world.add(box(0.2, 7.6, 12, wallMat, 4.7, 3.8, 0, { noCast: true }));
    const wainMat = new THREE.MeshStandardMaterial({ color: 0xf7f0ea, roughness: 0.8 });
    world.add(box(16, 1.0, 0.06, wainMat, 0, 0.5, -3.18, { noCast: true }));
    world.add(box(16, 0.08, 0.1, darkMat, 0, 0.04, -3.16, { noCast: true }));
    world.add(box(16, 0.2, 12, new THREE.MeshStandardMaterial({ color: 0xfff8f0, roughness: 0.95 }), 0, 7.6, 0, { noCast: true, noReceive: true }));
    // a pendant lamp on a long cord, and a picture rail where the ceiling used to be
    for (const lx of [-2.4, 2.4]) {
      world.add(cyl(0.008, 0.008, 4.2, darkMat, lx, 5.4, -0.2, 6));
      world.add(cyl(0.26, 0.09, 0.24, accentMat, lx, 3.42, -0.2, 24));
      world.add(sphere(0.07, new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd27a, emissiveIntensity: 2.5 }), lx, 3.3, -0.2, 12));
    }
    world.add(box(16, 0.06, 0.08, darkMat, 0, 4.6, -3.16, { noCast: true }));
    // a window on the right, where the sun comes from
    const paneMat = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xfff0c0, emissiveIntensity: 1.5, roughness: 1 });
    world.add(box(0.06, 1.7, 2.3, paneMat, 4.62, 2.35, 0.7, { noCast: true }));
    for (const [y, z, w, h, d] of [[2.35, -0.5, 0.1, 1.84, 0.1], [2.35, 1.9, 0.1, 1.84, 0.1], [3.25, 0.7, 0.1, 0.1, 2.5], [1.45, 0.7, 0.1, 0.1, 2.5], [2.35, 0.7, 0.1, 1.84, 0.06]]) world.add(box(w, h, d, whiteMat, 4.6, y, z));
    // the counter and its display case
    const counterMat = new THREE.MeshStandardMaterial(mapped(woodT, 0xb9834f, { roughness: 0.6 }));
    const counterTop = new THREE.MeshStandardMaterial({ color: 0xf6efe4, roughness: 0.3, metalness: 0.05 });
    world.add(box(5.4, 0.95, 0.8, counterMat, 0, 0.475, -2.5));
    world.add(box(5.6, 0.08, 0.92, counterTop, 0, 0.99, -2.5));
    world.add(box(3.4, 0.06, 0.74, chromeMat, 0, 1.06, -2.5));
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 0.92, thickness: 0.03, transparent: true, opacity: 0.4 });
    const caseGlass = box(3.4, 0.5, 0.74, glassMat, 0, 1.34, -2.5, { noCast: true }); world.add(caseGlass);
    for (let i = 0; i < 8; i++) {
      const fl = FLAVORS[i % FLAVORS.length];
      const tub = cyl(0.15, 0.13, 0.22, new THREE.MeshStandardMaterial({ color: fl.c, roughness: 0.6 }), -1.4 + i * 0.4, 1.2, -2.5 + (i % 2 ? 0.16 : -0.16), 20);
      world.add(tub);
    }
    for (let i = 0; i < 4; i++) world.add(cyl(0.07, 0.07, 0.18, new THREE.MeshStandardMaterial({ color: SPRINKLE_COLORS[i], roughness: 0.5 }), 2.1 + i * 0.2, 1.12, -2.45, 16));
    // menu board and the neon sign
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), new THREE.MeshStandardMaterial(mapped(boardT, 0x1f3a33, { roughness: 0.9 })));
    board.position.set(-2.3, 2.6, -3.18); world.add(board);
    world.add(box(2.08, 1.58, 0.05, counterMat, -2.3, 2.6, -3.2, { noCast: true }));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.58), new THREE.MeshStandardMaterial(mapped(signT, 0xffd6e0, { emissive: 0xffffff, emissiveMap: signT, emissiveIntensity: signT ? 1.2 : 0.6, roughness: 0.9 })));
    sign.position.set(0.9, 3.45, -3.18); world.add(sign);
    // string lights across the ceiling
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd27a, emissiveIntensity: 2.2, roughness: 0.4 });
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, x = -4.4 + t * 8.8, sag = Math.sin(t * Math.PI) * 0.45;
        world.add(sphere(0.035, bulbMat, x, 4.15 - sag, -2.6 + row * 2.2, 10));
      }
    }
    // plants, stools, a table
    const potMat = new THREE.MeshStandardMaterial({ color: 0xd97a4a, roughness: 0.8 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9a5a, roughness: 0.7 });
    for (const px of [-3.9, 3.9]) {
      world.add(cyl(0.22, 0.17, 0.4, potMat, px, 0.2, -2.6, 16));
      for (let k = 0; k < 7; k++) { const an = k * 0.9, rr = 0.12 + (k % 3) * 0.08; world.add(sphere(0.14 + (k % 2) * 0.05, leafMat, px + Math.cos(an) * rr, 0.6 + (k % 3) * 0.14, -2.6 + Math.sin(an) * rr, 12)); }
    }
    for (const sx of [-3.1, 3.1]) {
      world.add(cyl(0.3, 0.3, 0.04, counterTop, sx, 0.74, 0.4, 24)); world.add(cyl(0.03, 0.03, 0.72, chromeMat, sx, 0.37, 0.4, 10)); world.add(cyl(0.2, 0.22, 0.03, darkMat, sx, 0.02, 0.4, 20));
      world.add(cyl(0.15, 0.15, 0.05, accentMat, sx + 0.5, 0.5, 0.9, 20)); world.add(cyl(0.025, 0.025, 0.48, chromeMat, sx + 0.5, 0.25, 0.9, 10));
    }

    // --- the machine: two pillars, two arms -------------------------------
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xf6eee6, roughness: 0.45, metalness: 0.15 });
    const ARM_X = 1.3, ARM_Z = 0.15, L1 = 1.0, L2 = 0.92;
    function makeArm(side) {
      const g = new THREE.Group(); world.add(g);
      world.add(box(0.2, 7.4, 0.2, pillarMat, side * ARM_X, 3.7, ARM_Z));
      world.add(box(0.5, 0.12, 0.5, darkMat, side * ARM_X, 0.06, ARM_Z));
      world.add(box(0.26, 0.06, 0.26, chromeMat, side * ARM_X, 0.15, ARM_Z));
      for (let k = 1; k < 7; k++) world.add(box(0.22, 0.03, 0.22, accentMat, side * ARM_X, k * 1.0, ARM_Z, { noCast: true }));
      world.add(cyl(0.035, 0.035, 7.2, chromeMat, side * (ARM_X - 0.16), 3.6, ARM_Z, 12));
      const carriage = box(0.34, 0.26, 0.3, chromeMat, 0, 0, 0); g.add(carriage);
      const lightA = sphere(0.035, new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffd27a, emissiveIntensity: 1.5 }), 0, 0.17, 0.1, 10); g.add(lightA);
      const shoulder = sphere(0.075, darkMat, 0, 0, 0, 16); g.add(shoulder);
      const upper = capsule(0.055, 1, chromeMat); world.add(upper);
      const elbow = sphere(0.065, darkMat, 0, 0, 0, 16); world.add(elbow);
      const fore = capsule(0.045, 1, chromeMat); world.add(fore);
      const hand = new THREE.Group(); world.add(hand);
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12, 0, TAU, 0, Math.PI * 0.55), darkMat);
      cup.position.y = -0.1; cup.castShadow = true; hand.add(cup);
      const wrist = cyl(0.04, 0.04, 0.12, chromeMat, 0, 0.12, 0, 10); hand.add(wrist);
      return {
        side: side, g: g, upper: upper, elbow: elbow, fore: fore, hand: hand, cup: cup, light: lightA, held: null,
        state: "home", t: 0, dur: 0.55, hover: 0.3, err: { x: 0, z: 0 }, spec: null, open: 0, pendingAt: 0,
        carriageY: 2.2, handPos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), drop: new THREE.Vector3()
      };
    }
    const arms = [makeArm(-1), makeArm(1)];
    const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3();
    // Two-bone IK in the vertical plane through shoulder and hand; the elbow
    // bends upward and outward, like a crane, never through the floor.
    function poseArm(a) {
      _s.set(a.side * (ARM_X - 0.3), a.carriageY, ARM_Z);
      a.g.position.copy(_s);
      const t = a.handPos;
      _u.subVectors(t, _s);
      let d = _u.length();
      const dMax = L1 + L2 - 0.02, dMin = Math.abs(L1 - L2) + 0.02;
      if (d > dMax) { _u.multiplyScalar(dMax / d); d = dMax; t.copy(_s).add(_u); }
      if (d < dMin) { _u.multiplyScalar(dMin / Math.max(1e-6, d)); d = dMin; t.copy(_s).add(_u); }
      _u.multiplyScalar(1 / d);
      const ax = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - ax * ax));
      _p.set(0, 1, 0).addScaledVector(_u, -_u.y).normalize();   // "up", made perpendicular to the reach
      if (_p.lengthSq() < 1e-6) _p.set(-a.side, 0, 0);
      _e.copy(_s).addScaledVector(_u, ax).addScaledVector(_p, h);
      placeSegment(a.upper, _s, _e, 1);
      a.elbow.position.copy(_e);
      placeSegment(a.fore, _e, t, 1);
      a.hand.position.copy(t);
      a.hand.rotation.set(0, 0, a.side * a.open * 1.1);
    }

    // --- the scooper -------------------------------------------------------
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffb3c6, roughness: 0.8 });
    const man = { g: new THREE.Group(), legL: null, legR: null, head: null, browL: null, browR: null, smile: null, mouthO: null, pupilL: null, pupilR: null, mood: "calm", moodT: 0, lean: { x: 0, z: 0 }, walk: 0, walkAmt: 0, look: { x: 0, y: 0 } };
    (function buildMan() {
      const g = man.g;
      const shoeMat = new THREE.MeshStandardMaterial({ color: 0x5b2d2a, roughness: 0.6 });
      const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3b2a4a, roughness: 0.8 });
      for (const side of [-1, 1]) {
        const leg = new THREE.Group(); leg.position.set(side * 0.11, 0.52, 0); g.add(leg);
        const shin = capsule(0.07, 0.36, pantsMat); shin.position.y = -0.26; leg.add(shin);
        const shoe = box(0.16, 0.08, 0.26, shoeMat, 0, -0.48, 0.05); leg.add(shoe);
        if (side < 0) man.legL = leg; else man.legR = leg;
      }
      const torso = capsule(0.22, 0.34, stripeMat); torso.position.y = 0.9; g.add(torso);
      const apron = box(0.36, 0.46, 0.05, whiteMat, 0, 0.82, 0.2); g.add(apron);
      const pocket = box(0.14, 0.1, 0.02, new THREE.MeshStandardMaterial({ color: 0xffd3e0, roughness: 0.8 }), 0, 0.72, 0.235); g.add(pocket);
      const tieMat = new THREE.MeshStandardMaterial({ color: 0xe8293f, roughness: 0.5 });
      g.add(box(0.07, 0.06, 0.04, tieMat, -0.05, 1.14, 0.2, { rz: 0.3 })); g.add(box(0.07, 0.06, 0.04, tieMat, 0.05, 1.14, 0.2, { rz: -0.3 }));
      // arms raised, holding the cone
      for (const side of [-1, 1]) {
        const upper = capsule(0.055, 1, stripeMat); placeSegment(upper, new THREE.Vector3(side * 0.25, 1.14, 0.02), new THREE.Vector3(side * 0.37, 1.56, 0.05), 1); g.add(upper);
        const fore = capsule(0.05, 1, skinMat); placeSegment(fore, new THREE.Vector3(side * 0.37, 1.56, 0.05), new THREE.Vector3(side * 0.075, MAN_H + 0.1, 0.03), 1); g.add(fore);
        g.add(sphere(0.06, skinMat, side * 0.37, 1.56, 0.05, 14));
        g.add(sphere(0.056, skinMat, side * 0.07, MAN_H + 0.12, 0.03, 14));
      }
      const head = new THREE.Group(); head.position.y = HEAD_Y; g.add(head); man.head = head;
      head.add(sphere(0.17, skinMat, 0, 0, 0, 32));
      head.add(sphere(0.045, skinMat, -0.165, 0, 0, 10)); head.add(sphere(0.045, skinMat, 0.165, 0, 0, 10));
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
      const pupilMat = new THREE.MeshStandardMaterial({ color: 0x2b1d3a, roughness: 0.4 });
      for (const side of [-1, 1]) {
        const eye = sphere(0.036, eyeMat, side * 0.062, 0.03, 0.15, 14); head.add(eye);
        const pupil = sphere(0.017, pupilMat, side * 0.062, 0.03, 0.182, 10); head.add(pupil);
        if (side < 0) man.pupilL = pupil; else man.pupilR = pupil;
        const brow = box(0.07, 0.014, 0.014, new THREE.MeshStandardMaterial({ color: 0x5a3a2a }), side * 0.062, 0.095, 0.155); head.add(brow);
        if (side < 0) man.browL = brow; else man.browR = brow;
        head.add(sphere(0.028, new THREE.MeshStandardMaterial({ color: 0xff9db0, roughness: 0.9 }), side * 0.1, -0.03, 0.14, 10));
      }
      const mouthMat = new THREE.MeshStandardMaterial({ color: 0x6b2a3a, roughness: 0.6 });
      const smile = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.008, 8, 20, Math.PI), mouthMat);
      smile.position.set(0, -0.06, 0.158); smile.rotation.z = Math.PI; head.add(smile); man.smile = smile;
      const mouthO = sphere(0.022, mouthMat, 0, -0.07, 0.16, 10); mouthO.scale.set(1, 1.3, 0.5); mouthO.visible = false; head.add(mouthO); man.mouthO = mouthO;
      const hat = cyl(0.15, 0.17, 0.2, whiteMat, 0, 0.23, 0, 24); head.add(hat);
      head.add(cyl(0.172, 0.172, 0.05, new THREE.MeshStandardMaterial({ color: 0xe8293f, roughness: 0.6 }), 0, 0.15, 0, 24));
      world.add(g);
    })();
    const blobT = blobTex();
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.46, 28), new THREE.MeshBasicMaterial({ map: blobT, transparent: true, opacity: blobT ? 1 : 0, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.006; blob.visible = !!blobT; world.add(blob);

    // --- the cone ------------------------------------------------------------
    const coneG = new THREE.Group(); world.add(coneG);
    const coneMesh = new THREE.Mesh(new THREE.CylinderGeometry(CONE_R, 0.006, CONE_H, 28, 1, true), new THREE.MeshStandardMaterial(mapped(waffleT, 0xe4a463, { roughness: 0.8, side: THREE.DoubleSide })));
    coneMesh.position.y = MAN_H + CONE_H / 2; coneMesh.castShadow = true; coneMesh.receiveShadow = true; coneG.add(coneMesh);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(CONE_R, 0.009, 8, 32), new THREE.MeshStandardMaterial({ color: 0xb36f35, roughness: 0.7 }));
    rim.position.y = PIVOT_Y; rim.rotation.x = Math.PI / 2; coneG.add(rim);
    const coneInner = new THREE.Mesh(new THREE.CircleGeometry(CONE_R * 0.98, 24), new THREE.MeshStandardMaterial({ color: 0xc98a4a, roughness: 0.9 }));
    coneInner.position.y = PIVOT_Y - 0.01; coneInner.rotation.x = -Math.PI / 2; coneG.add(coneInner);

    // --- scoops --------------------------------------------------------------
    const towerG = new THREE.Group(); world.add(towerG);
    const scoopGeos = {};
    function lumpyGeo(r, seed) {
      const geo = new THREE.SphereGeometry(r, 40, 26);
      const pos = geo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = vnoise3(v.x * 7 / r + seed, v.y * 7 / r + seed * 2, v.z * 7 / r);
        const m = vnoise3(v.x * 18 / r + seed * 3, v.y * 18 / r, v.z * 18 / r + seed);
        v.multiplyScalar(1 + (n - 0.5) * 0.17 + (m - 0.5) * 0.05);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      return geo;
    }
    function geoFor(kind) {
      if (!scoopGeos[kind]) scoopGeos[kind] = [0, 1, 2].map((k) => lumpyGeo(KINDS[kind].r, 11 + k * 7));
      return pick(scoopGeos[kind]);
    }
    const flavorMats = {};
    function flavorMat(fl) {
      if (!flavorMats[fl.n]) {
        const o = { color: fl.c, roughness: 0.46, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.5, sheen: 0.3, sheenColor: 0xffffff, sheenRoughness: 0.7, envMapIntensity: 0.7 };
        if (fl.speck && speckT) { o.map = speckT; o.color = 0xffffff; }
        flavorMats[fl.n] = new THREE.MeshPhysicalMaterial(o);
      }
      return flavorMats[fl.n];
    }
    const sprinkleGeo = new THREE.BoxGeometry(0.016, 0.005, 0.005);
    const sprinkleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const dripGeo = new THREE.CapsuleGeometry(0.012, 0.05, 4, 8);
    const _m4 = new THREE.Matrix4(), _c = new THREE.Color(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q2 = new THREE.Quaternion();
    // One scoop: a lumpy sphere in its flavour, maybe sprinkles, maybe drips.
    function makeScoopMesh(spec) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(geoFor(spec.kind), flavorMat(spec.fl));
      body.rotation.set(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU));
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      const r = spec.r;
      if (spec.sprinkles) {
        const n = 18, inst = new THREE.InstancedMesh(sprinkleGeo, sprinkleMat, n);
        for (let i = 0; i < n; i++) {
          _v.set(rnd(-1, 1), rnd(0.15, 1), rnd(-1, 1)).normalize();
          _v2.copy(_v).multiplyScalar(r * 1.01);
          _q2.setFromUnitVectors(_up, _v);
          _m4.compose(_v2, _q2.multiply(new THREE.Quaternion().setFromAxisAngle(_up, rnd(0, TAU))), new THREE.Vector3(1, 1, 1));
          inst.setMatrixAt(i, _m4);
          inst.setColorAt(i, _c.setHex(SPRINKLE_COLORS[i % SPRINKLE_COLORS.length]));
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.castShadow = false;
        g.add(inst);
      }
      if (spec.drip) {
        for (let k = 0; k < 2; k++) {
          const d = new THREE.Mesh(dripGeo, flavorMat(spec.fl));
          const an = rnd(0, TAU);
          d.position.set(Math.cos(an) * r * 0.55, -r * 0.78 - 0.02 - k * 0.01, Math.sin(an) * r * 0.55);
          d.scale.set(1, 1.2 + k * 0.6, 1);
          d.castShadow = true;
          g.add(d);
        }
      }
      g.userData.r = r;
      return g;
    }
    // The cherry rides on whichever scoop is on top.
    const cherry = new THREE.Group();
    (function () {
      const fruit = sphere(0.028, new THREE.MeshPhysicalMaterial({ color: 0xe8293f, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 }), 0, 0, 0, 18);
      cherry.add(fruit);
      const stem = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0.01, 0.07, 0), new THREE.Vector3(0.045, 0.085, 0.01)), 8, 0.004, 6, false), new THREE.MeshStandardMaterial({ color: 0x4b7d2f, roughness: 0.7 }));
      cherry.add(stem);
      cherry.visible = false;
      world.add(cherry);
    })();
    // The drop guide: a ring on the tower top the size of the catch zone,
    // and a thin beam from the hand down to it.
    const guideRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.014, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
    guideRing.rotation.x = Math.PI / 2; guideRing.visible = false; world.add(guideRing);
    const guideDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
    guideDisc.rotation.x = -Math.PI / 2; guideDisc.visible = false; world.add(guideDisc);
    const guideBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    guideBeam.visible = false; world.add(guideBeam);
    // Splat decals on the floor, a small pool reused in order.
    const decals = [];
    const decalGeo = new THREE.CircleGeometry(1, 28);
    let decalNext = 0;
    for (let i = 0; i < 12; i++) {
      const d = new THREE.Mesh(decalGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, transparent: true, opacity: 0.92 }));
      d.rotation.x = -Math.PI / 2; d.position.y = 0.004 + i * 0.0005; d.visible = false; d.receiveShadow = true;
      world.add(d); decals.push(d);
    }
    function splatDecal(x, z, fl, r) {
      const d = decals[decalNext++ % decals.length];
      d.material.color.setHex(fl.c);
      d.position.x = x; d.position.z = z;
      d.scale.set(r * 2.4 * rnd(0.85, 1.15), r * 2.4 * rnd(0.85, 1.15), 1);
      d.rotation.z = rnd(0, TAU);
      d.visible = true;
    }

    // --- particles: sparkles, droplets, confetti -----------------------------
    const SPARK_N = 90;
    const sparkPos = new Float32Array(SPARK_N * 3);
    const sparks = [];
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    const sparkPts = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xfff0b0, size: 0.05, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    sparkPts.frustumCulled = false; world.add(sparkPts);
    for (let i = 0; i < SPARK_N; i++) { sparks.push({ life: 0, x: 0, y: -9, z: 0, vx: 0, vy: 0, vz: 0 }); sparkPos[i * 3 + 1] = -9; }
    function sparkle(x, y, z, n) {
      let k = 0;
      for (let i = 0; i < SPARK_N && k < n; i++) {
        const s = sparks[i]; if (s.life > 0) continue;
        s.life = rnd(0.35, 0.7); s.x = x; s.y = y; s.z = z;
        s.vx = rnd(-0.6, 0.6); s.vy = rnd(0.3, 1.3); s.vz = rnd(-0.6, 0.6); k++;
      }
    }
    const DROP_N = 48;
    const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), DROP_N);
    drops.frustumCulled = false; world.add(drops);
    const dropList = [];
    for (let i = 0; i < DROP_N; i++) { dropList.push({ life: 0, x: 0, y: -9, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }); _m4.makeTranslation(0, -9, 0); drops.setMatrixAt(i, _m4); drops.setColorAt(i, _c.setHex(0xffffff)); }
    function droplets(x, y, z, fl, n) {
      let k = 0;
      for (let i = 0; i < DROP_N && k < n; i++) {
        const d = dropList[i]; if (d.life > 0) continue;
        d.life = rnd(0.5, 0.9); d.x = x; d.y = y + 0.02; d.z = z; d.s = rnd(0.6, 1.5);
        d.vx = rnd(-1.2, 1.2); d.vy = rnd(0.8, 2.4); d.vz = rnd(-1.2, 1.2);
        drops.setColorAt(i, _c.setHex(fl.c)); k++;
      }
      if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
    }
    const CONF_N = 70;
    const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.034), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), CONF_N);
    confetti.frustumCulled = false; world.add(confetti);
    const confList = [];
    for (let i = 0; i < CONF_N; i++) { confList.push({ life: 0, x: 0, y: -9, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0 }); _m4.makeTranslation(0, -9, 0); confetti.setMatrixAt(i, _m4); confetti.setColorAt(i, _c.setHex(SPRINKLE_COLORS[i % SPRINKLE_COLORS.length])); }
    function confettiBurst(cx, cy, cz) {
      for (let i = 0; i < CONF_N; i++) {
        const c = confList[i];
        c.life = rnd(1.8, 3); c.x = cx + rnd(-1.2, 1.2); c.y = cy + rnd(0, 0.6); c.z = cz + rnd(-0.6, 0.6);
        c.vx = rnd(-0.5, 0.5); c.vy = rnd(-0.2, 0.6); c.vz = rnd(-0.5, 0.5);
        c.rx = rnd(0, TAU); c.ry = rnd(0, TAU); c.rz = rnd(0, TAU); c.wx = rnd(-5, 5); c.wy = rnd(-5, 5); c.wz = rnd(-5, 5);
      }
    }
    const _eu = new THREE.Euler();
    function stepParticles(dt) {
      for (let i = 0; i < SPARK_N; i++) {
        const s = sparks[i];
        if (s.life > 0) { s.life -= dt; s.vy -= 1.5 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; sparkPos[i * 3] = s.x; sparkPos[i * 3 + 1] = s.life > 0 ? s.y : -9; sparkPos[i * 3 + 2] = s.z; }
      }
      sparkGeo.attributes.position.needsUpdate = true;
      for (let i = 0; i < DROP_N; i++) {
        const d = dropList[i];
        if (d.life <= 0) continue;
        d.life -= dt; d.vy -= 9 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.y < 0.012) { d.y = 0.012; d.vy = 0; d.vx *= 0.6; d.vz *= 0.6; }
        _m4.makeTranslation(d.x, d.life > 0 ? d.y : -9, d.z); if (d.life > 0) _m4.scale(new THREE.Vector3(d.s, d.s * 0.7, d.s));
        drops.setMatrixAt(i, _m4);
      }
      drops.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < CONF_N; i++) {
        const c = confList[i];
        if (c.life <= 0) continue;
        c.life -= dt; c.vy -= 0.6 * dt; c.vy = Math.max(c.vy, -0.9);
        c.vx += Math.sin(clock * 5 + i) * 0.4 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
        _eu.set(c.rx, c.ry, c.rz); _q2.setFromEuler(_eu);
        _m4.compose(_v.set(c.x, c.life > 0 && c.y > 0.02 ? c.y : -9, c.z), _q2, _v2.set(1, 1, 1));
        confetti.setMatrixAt(i, _m4);
      }
      confetti.instanceMatrix.needsUpdate = true;
    }

    // ===================================================================== //
    // 7. Physics: the cone, the tower, the arms' schedule, the fall        //
    // ===================================================================== //
    const OVERLAP = 0.82;                  // scoops sink into each other a little
    const SUP = 0.1;                       // how far the centre of mass may wander off the cone (m)
    const GRAV = 1.7;                      // effective gravity on the lean, m/s^2, before tuning
    const DAMP = 0.9;                      // viscous damping on the lean, 1/s
    const K_IMP = 3;                       // how hard an off-centre landing shoves the tower
    const K_CUP = 40;                      // the cone's cup springs a short stack back upright, 1/s^2
    const CUP_LO = 0.085, CUP_HI = 0.39;   // centre-of-mass heights (m) between which the cup lets go
    const CATCH = 0.8;                     // fraction of the summed radii that still counts as a catch
    const WOB_K = 170, WOB_C = 7;          // the jelly wobble spring
    const G_DROP = 3.2;                    // a scoop falls like a cartoon, m/s^2
    const X_MAX = 0.72, Z_MAX = 0.45;      // how far the cone may walk

    // The cone's position is what the player controls, through a stiff
    // critically damped spring toward a target that tilt or a drag moves, so
    // a finger jump or a jerk of the phone becomes a bounded acceleration —
    // and that acceleration is what the tower feels.
    const base = { x: 0, z: 0, vx: 0, vz: 0, tx: 0, tz: 0, ax: 0, az: 0 };
    const BASE_W = 22;
    function stepBase(dt) {
      base.tx = clamp(base.tx, -X_MAX, X_MAX); base.tz = clamp(base.tz, -Z_MAX, Z_MAX);
      const axx = BASE_W * BASE_W * (base.tx - base.x) - 2 * BASE_W * base.vx;
      const azz = BASE_W * BASE_W * (base.tz - base.z) - 2 * BASE_W * base.vz;
      base.vx += axx * dt; base.x += base.vx * dt;
      base.vz += azz * dt; base.z += base.vz * dt;
      base.ax = clamp(axx, -30, 30); base.az = clamp(azz, -30, 30);
    }
    function stepBody(dt) {
      const n = Math.min(8, Math.max(1, Math.ceil(dt / 0.016)));
      const h = dt / n;
      for (let i = 0; i < n; i++) { stepBase(h); stepTower(h); }
    }

    // The tower: lean (thx, thz) and its rate, centre of mass (cx, cy, cz)
    // in the tower's own frame, and the stack itself.
    const tower = { scoops: [], thx: 0, thz: 0, omx: 0, omz: 0, cx: 0, cz: 0, cy: 0, M: 0, h: 0, thMax: 1.2, q: new THREE.Quaternion() };
    const towerGrown = () => smooth(CUP_LO, CUP_HI, Math.max(0.1, tower.cy));
    function recompute() {
      let M = 0, mx = 0, mz = 0, my = 0, y = 0, prevR = 0, cumx = 0, cumz = 0;
      const list = tower.scoops;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        y = i === 0 ? s.r * 0.8 : y + (prevR + s.r) * OVERLAP;
        cumx += s.dx; cumz += s.dz;
        s.x = cumx; s.z = cumz; s.y = y;
        M += s.m; mx += s.m * s.x; mz += s.m * s.z; my += s.m * s.y;
        prevR = s.r;
      }
      tower.M = M;
      tower.cx = M ? mx / M : 0; tower.cz = M ? mz / M : 0; tower.cy = M ? my / M : 0;
      tower.h = list.length ? y + prevR : 0;
      tower.thMax = M ? Math.atan2(SUP, Math.max(0.1, tower.cy)) : 1.2;
    }
    // The lean as a rotation: by |th| about the horizontal axis that takes
    // "up" toward the lean direction.
    const _axis = new THREE.Vector3();
    function leanQuat(q, thx, thz) {
      const phi = Math.hypot(thx, thz);
      if (phi < 1e-6) return q.identity();
      _axis.set(thz / phi, 0, -thx / phi);
      return q.setFromAxisAngle(_axis, phi);
    }
    const _tp = new THREE.Vector3(), _tp2 = new THREE.Vector3();
    // World position of the point a new scoop lands on: the top scoop's
    // centre, or the cup of the cone.
    function topPoint() {
      const list = tower.scoops;
      if (!list.length) return { x: base.x, y: PIVOT_Y, z: base.z, r: CONE_R * 0.9, cup: true };
      const t = list[list.length - 1];
      _tp.set(t.x + t.wx, t.y, t.z + t.wz).applyQuaternion(tower.q);
      return { x: base.x + _tp.x, y: PIVOT_Y + _tp.y, z: base.z + _tp.z, r: t.r, cup: false };
    }
    function stepTower(dt) {
      if (!tower.M) { tower.thx *= Math.max(0, 1 - 6 * dt); tower.thz *= Math.max(0, 1 - 6 * dt); tower.omx = tower.omz = 0; leanQuat(tower.q, tower.thx, tower.thz); return; }
      const cy = Math.max(0.1, tower.cy);
      // A short stack sits in the cup of the cone: the cup springs it back
      // upright, gravity barely tips it and the cone's acceleration barely
      // reaches it. Over the first few scoops the spring fades out, the
      // instability and the coupling fade in, and the game begins.
      const grown = towerGrown();
      const G = GRAV * tune.topple() * (1 - 0.6 * tune.sticky()) * grown;
      const spring = K_CUP * (1 - grown);
      const accx = (G / cy) * (tower.thx + tower.cx / cy) - spring * tower.thx - (base.ax / cy) * grown - DAMP * tower.omx;
      const accz = (G / cy) * (tower.thz + tower.cz / cy) - spring * tower.thz - (base.az / cy) * grown - DAMP * tower.omz;
      tower.omx += accx * dt; tower.thx += tower.omx * dt;
      tower.omz += accz * dt; tower.thz += tower.omz * dt;
      leanQuat(tower.q, tower.thx, tower.thz);
      const h = Math.max(0.05, tower.h);
      for (const sc of tower.scoops) {
        const kx = -base.ax * (sc.y / h) * 0.25, kz = -base.az * (sc.y / h) * 0.25;
        sc.wvx += (-WOB_K * sc.wx - WOB_C * sc.wvx + kx) * dt; sc.wx = clamp(sc.wx + sc.wvx * dt, -0.03, 0.03);
        sc.wvz += (-WOB_K * sc.wz - WOB_C * sc.wvz + kz) * dt; sc.wz = clamp(sc.wz + sc.wvz * dt, -0.03, 0.03);
        sc.sq += (0 - sc.sq) * Math.min(1, dt * 9);
      }
    }
    // Put every scoop mesh where the physics says.
    function syncTower() {
      towerG.position.set(base.x, PIVOT_Y, base.z);
      towerG.quaternion.copy(tower.q);
      const list = tower.scoops;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        s.mesh.position.set(s.x + s.wx, s.y, s.z + s.wz);
        s.mesh.scale.set(1 + s.sq * 0.5, 1 - s.sq, 1 + s.sq * 0.5);
      }
      if (list.length) {
        const t = list[list.length - 1];
        cherry.visible = true;
        _tp.set(t.x + t.wx + 0.015, t.y + t.r * 0.95 * (1 - t.sq), t.z + t.wz).applyQuaternion(tower.q);
        cherry.position.set(base.x + _tp.x, PIVOT_Y + _tp.y, base.z + _tp.z);
        cherry.quaternion.copy(tower.q);
      } else cherry.visible = false;
      coneG.position.set(base.x, 0, base.z);
    }

    function newSpec(kind) {
      const k = KINDS[kind];
      return { kind: kind, r: k.r, m: k.m, pts: k.pts, fl: pick(FLAVORS), sprinkles: Math.random() < 0.3, drip: Math.random() < 0.55 };
    }

    // --- the arms' schedule ----------------------------------------------------
    const falling = [];
    const debris = [];
    let pendingDrops = 0;
    // Folded: the hand a little inboard of the pillar at carriage height, so
    // the long arm stands up beside the pillar like a raised elbow.
    function armHome(a, out) { return out.set(a.side * (ARM_X - 0.72), a.carriageY + 0.05, ARM_Z + 0.1); }
    function dispatch(a, spec, rush) {
      a.spec = spec; a.state = "in"; a.t = 0;
      a.dur = rush ? 0.36 : 0.55; a.hover = rush ? 0.18 : 0.3;
      armHome(a, a.from); a.handPos.copy(a.from); a.open = 0;
      const top = topPoint();
      // Where the arm aims, relative to the tower's top: inside the catch
      // zone at the default error, outside it in a rush or late in a run.
      const mag = rnd(0.12, 1) * tune.error() * tune.ramp(count) * (top.r + spec.r) * (rush ? 1.45 : 1);
      const an = rnd(0, TAU);
      a.err.x = Math.cos(an) * mag; a.err.z = Math.sin(an) * mag * 0.6;
      a.held = makeScoopMesh(spec);
      world.add(a.held);
      a.cup.scale.setScalar(spec.r / 0.085);
      pendingDrops++;
      sfx.whir(a.dur);
    }
    function heldPoint(a, out) { return out.set(a.handPos.x, a.handPos.y - 0.1, a.handPos.z); }
    const _hp = new THREE.Vector3();
    function releaseScoop(a) {
      heldPoint(a, _hp);
      const spec = a.spec;
      falling.push({ x: _hp.x, y: _hp.y, z: _hp.z, vx: 0, vy: 0, vz: 0, spin: rnd(-2, 2), r: spec.r, m: spec.m, spec: spec, mesh: a.held, missed: false, splatted: false });
      a.held = null; a.spec = null;
      sfx.release();
    }
    function stepArms(dt) {
      const top = topPoint();
      for (const a of arms) {
        // the carriage rides the pillar so the hand is always above the top
        const wantY = clamp(top.y + 0.7, 2.0, 7.2);
        a.carriageY += (wantY - a.carriageY) * Math.min(1, dt * 2.2);
        if (a.state === "home") { armHome(a, a.handPos); a.open = 0; poseArm(a); continue; }
        a.t += dt;
        if (a.state === "in") {
          a.to.set(top.x + a.err.x, top.y + top.r + (a.spec ? a.spec.r : 0.085) + 0.3, top.z + a.err.z);
          a.handPos.lerpVectors(a.from, a.to, outCubic(clamp(a.t / a.dur, 0, 1)));
          if (a.t >= a.dur) { a.state = "hover"; a.t = 0; a.drop.copy(a.to); }
        } else if (a.state === "hover") {
          a.handPos.copy(a.drop);
          if (a.t >= a.hover) { a.state = "release"; a.t = 0; releaseScoop(a); }
        } else if (a.state === "release") {
          a.open = Math.min(1, a.t / 0.15);
          if (a.t >= 0.2) { a.state = "out"; a.t = 0; a.from.copy(a.handPos); armHome(a, a.to); }
        } else if (a.state === "out") {
          const k = clamp(a.t / a.dur, 0, 1);
          a.handPos.lerpVectors(a.from, a.to, k * k);
          a.open = Math.max(0, 1 - a.t * 3);
          if (a.t >= a.dur) { a.state = "home"; }
        }
        poseArm(a);
        if (a.held) { heldPoint(a, _hp); a.held.position.copy(_hp); }
      }
    }
    function retractArms() {
      for (const a of arms) {
        if (a.state === "home") continue;
        if (a.spec) pendingDrops = Math.max(0, pendingDrops - 1);
        if (a.held) { world.remove(a.held); a.held = null; }
        a.spec = null; a.state = "out"; a.t = 0; a.from.copy(a.handPos); armHome(a, a.to);
      }
    }

    // --- falling scoops: a swept contact test against the tower's top ------
    const _inv = new THREE.Quaternion(), _rel = new THREE.Vector3();
    function stepFalling(dt) {
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i];
        const py = f.y;
        f.vy -= G_DROP * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        f.mesh.position.set(f.x, f.y, f.z);
        f.mesh.rotation.y += f.spin * dt;
        if (!f.missed && state === "play") {
          const top = topPoint();
          const reach = (top.r + f.r) * OVERLAP;
          const dyPrev = py - top.y, dy = f.y - top.y;
          if (dyPrev > reach && dy <= reach) {
            const dx = f.x - top.x, dz = f.z - top.z;
            if (Math.hypot(dx, dz) > top.r + f.r + 0.02) {
              f.missed = true;                                 // falls past the tower
            } else {
              // the lateral offset in the tower's own frame
              _inv.copy(tower.q).invert();
              _rel.set(dx, reach, dz).applyQuaternion(_inv);
              const ex = _rel.x, ez = _rel.z, e = Math.hypot(ex, ez);
              const catchR = top.cup ? CONE_R + f.r * 0.7 : (top.r + f.r) * CATCH;
              if (e <= catchR) { land(f, ex, ez, e, catchR); falling.splice(i, 1); continue; }
              const ux = e ? ex / e : 1, uz = e ? ez / e : 0;
              f.missed = true; f.y = top.y + reach;
              f.vx = ux * rnd(0.5, 0.9); f.vz = uz * rnd(0.5, 0.9); f.vy = Math.max(-f.vy * 0.25, 0.2); f.spin = rnd(-6, 6);
              tower.omx += ux * 0.3 * f.m / Math.max(0.5, tower.M + f.m);
              tower.omz += uz * 0.3 * f.m / Math.max(0.5, tower.M + f.m);
              sfx.squish();
            }
          }
        }
        if (f.y <= f.r * 0.8) { splat(f); falling.splice(i, 1); }
      }
    }

    // --- the topple ------------------------------------------------------------
    function toppleTower() {
      const phi = Math.hypot(tower.thx, tower.thz) || 1;
      const dx = tower.thx / phi, dz = tower.thz / phi;
      for (const sc of tower.scoops) {
        _tp.set(sc.x + sc.wx, sc.y, sc.z + sc.wz).applyQuaternion(tower.q);
        const wx = base.x + _tp.x, wy = PIVOT_Y + _tp.y, wz = base.z + _tp.z;
        towerG.remove(sc.mesh); world.add(sc.mesh); sc.mesh.position.set(wx, wy, wz); sc.mesh.quaternion.copy(tower.q);
        debris.push({
          x: wx, y: wy, z: wz,
          vx: dx * (0.4 + sc.y * 0.9) + rnd(-0.3, 0.3), vy: rnd(-0.1, 0.6) + sc.y * 0.3, vz: dz * (0.4 + sc.y * 0.9) + rnd(-0.3, 0.3),
          wx: rnd(-4, 4), wz: rnd(-4, 4), r: sc.r, spec: sc.spec, mesh: sc.mesh, bounces: 0, rest: false
        });
      }
      tower.scoops.length = 0;
      recompute();
      tower.thx = tower.thz = tower.omx = tower.omz = 0;
      leanQuat(tower.q, 0, 0);
    }
    function stepDebris(dt) {
      for (const d of debris) {
        if (d.rest) continue;
        d.vy -= 9.81 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.mesh.rotation.x += d.wx * dt; d.mesh.rotation.z += d.wz * dt;
        const lim = X_MAX + 0.9;
        if (d.x > lim) { d.x = lim; d.vx = -Math.abs(d.vx) * 0.5; }
        if (d.x < -lim) { d.x = -lim; d.vx = Math.abs(d.vx) * 0.5; }
        if (d.z > 1.6) { d.z = 1.6; d.vz = -Math.abs(d.vz) * 0.5; }
        if (d.z < -1.4) { d.z = -1.4; d.vz = Math.abs(d.vz) * 0.5; }
        if (d.y < d.r * 0.85) {
          d.y = d.r * 0.85;
          if (d.bounces < 2 && Math.abs(d.vy) > 0.9) {
            d.vy = -d.vy * 0.35; d.vx *= 0.55; d.vz *= 0.55; d.wx *= 0.5; d.wz *= 0.5; d.bounces++;
            droplets(d.x, 0, d.z, d.spec.fl, 6);
          } else {
            d.rest = true; d.vx = d.vz = d.vy = 0;
            droplets(d.x, 0, d.z, d.spec.fl, 10);
            splatDecal(d.x, d.z, d.spec.fl, d.r);
            d.mesh.scale.set(1.2, 0.72, 1.2);
            sfx.plop(d.spec.kind);
          }
        }
        d.mesh.position.set(d.x, d.y, d.z);
      }
    }
    function clearDebris() {
      for (const d of debris) world.remove(d.mesh);
      debris.length = 0;
      for (const d of decals) d.visible = false;
    }

    // --- the camera: frame feet to tower top inside the content safe area --
    // It follows the cone part of the way, so the scooper never walks out of
    // a narrow portrait frame, and dollies back as the tower grows so the top
    // stays in view below the arms. The image is shifted so the framed span
    // sits centred between the insets, not the screen edges.
    const camState = { d: 4.2, yc: 1.2, x: 0, pitch: 11 * Math.PI / 180, shake: 0 };
    function frameCamera(dt) {
      const W = ctx.width, H = Math.max(1, ctx.height);
      const areaH = Math.max(120, H - insets.top - insets.bottom);
      const bottom = -0.12, topY = PIVOT_Y + tower.h + 0.7;
      const span = topY - bottom;
      const tanHalf = Math.tan(camera.fov * Math.PI / 360);
      const dV = (span / 2) / tanHalf / (0.9 * areaH / H);
      const aspect = W / H;
      const dH = (0.3 * X_MAX + 0.6) / (tanHalf * aspect) / 0.96;
      const want = clamp(Math.max(dV, dH, 3.2), 3.2, 18);
      const k = Math.min(1, dt * 2.2);
      camState.d += (want - camState.d) * k;
      camState.yc += ((bottom + topY) / 2 - camState.yc) * k;
      camState.x += (0.7 * base.x - camState.x) * Math.min(1, dt * 3);
      const sway = state === "title" ? Math.sin(clock * 0.35) * 0.35 : 0;
      const pitch = camState.pitch;
      const sh = camState.shake * camState.shake;
      camera.position.set(
        camState.x + sway + (sh ? rnd(-1, 1) * sh * 0.05 : 0),
        camState.yc + camState.d * Math.sin(pitch) + (sh ? rnd(-1, 1) * sh * 0.03 : 0),
        camState.d * Math.cos(pitch));
      camera.lookAt(camState.x, camState.yc, 0);
      camera.aspect = aspect;
      camera.setViewOffset(W, H, 0, (insets.bottom - insets.top) / 2, W, H);
    }
    // Metres of world per screen pixel at the cone's depth, for drags.
    function metresPerPixel() {
      const dist = Math.max(0.5, camState.d * Math.cos(camState.pitch) - base.z);
      return 2 * dist * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, ctx.height);
    }

    // ===================================================================== //
    // 8. The game                                                           //
    // ===================================================================== //
    let state = "title";                   // title | play | spilled | topple | result | paused
    let stateT = 0, clock = 0;
    let runId = 0;
    let count = 0, points = 0, mult = 1, hearts = 3, cleanRun = 0;
    let rushState = "none", rushT = 0, rushLeft = 0, lastRushAt = 0, miniLeft = 0, lastArm = 1;
    let dropTimer = 0, nextDrop = 1.4;
    let endTimer = 0, warned = false;
    let control = ctx.capabilities.motion ? "tilt" : "touch";
    // Which way "forward" is on the tilt's y axis is a creator knob with a
    // player override: +1 means the raw y walks the cone toward the camera.
    let fwdSign = tune.forward() === "toward" ? 1 : -1;
    let hintTimer = 0, hintLandings = 0;
    const save = { best: 0, bestTower: 0, plays: 0 };

    // Live numeric state goes through ctx.game.score; the records are
    // submitted once, at the result.
    let scoreTrack = null, towerTrack = null;
    try {
      scoreTrack = ctx.game.score({ initial: 0, min: 0 });
      towerTrack = ctx.game.score("tower", { initial: 0, min: 0 });
    } catch (_) { scoreTrack = null; towerTrack = null; }

    function hudScore() {
      el.scoops.textContent = String(count);
      el.score.textContent = fmt(points);
      el.mult.textContent = "×" + mult;
      el.mult.classList.toggle("hot", mult > 1);
    }
    function hudHearts() {
      let h = "";
      for (let i = 0; i < 3; i++) h += coneIcon(15, i < hearts ? "" : "lost");
      el.hearts.innerHTML = h;
    }
    // The spirit level in the HUD: a bubble that drifts the way the tower
    // leans (right is right, down is toward you) and reddens near the limit.
    function hudLevel() {
      const q = tower.M ? Math.hypot(tower.thx, tower.thz) / tower.thMax : 0;
      const bx = tower.M ? clamp(tower.thx / tower.thMax, -1, 1) * 13 : 0;
      const by = tower.M ? clamp(tower.thz / tower.thMax, -1, 1) * 13 : 0;
      el.bubble.style.transform = "translate(" + bx.toFixed(1) + "px," + by.toFixed(1) + "px)";
      el.bubble.className = q > 0.7 ? "hot" : q > 0.4 ? "warn" : "";
    }
    // Restart a CSS animation: drop the class, re-add it a frame later.
    function replay(node) { node.classList.remove("on"); ctx.timeout(() => { if (!disposed) node.classList.add("on"); }, 20); }
    function toast(big, small) { el.toastb.textContent = big; el.toasts.textContent = small || ""; replay(el.toast); }
    function banner(big, small) { el.bannerb.textContent = big; el.banners.textContent = small || ""; replay(el.banner); }
    function showHint(text, secs) {
      el.hintt.textContent = text;
      el.phone.classList.toggle("on", control === "tilt");
      el.finger.classList.toggle("on", control !== "tilt");
      el.hint.style.opacity = "1";
      hintTimer = secs || 7;
    }
    function hideHint() { el.hint.style.opacity = "0"; hintTimer = 0; }
    function setMood(m, hold) { man.mood = m; man.moodT = hold; }
    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
    // Floating labels: overlay nodes placed where a world point projects.
    const _pr = new THREE.Vector3();
    function floatText(x, y, z, text, color, size) {
      _pr.set(x, y, z).project(camera);
      if (_pr.z > 1) return;
      const sx = (_pr.x + 1) / 2 * ctx.width, sy = (1 - _pr.y) / 2 * ctx.height;
      el.floats.insertAdjacentHTML("beforeend", '<div class="to-float" style="left:' + sx.toFixed(1) + "px;top:" + sy.toFixed(1) + "px;" +
        (color ? "color:" + color + ";" : "") + (size ? "font-size:" + size + "px;" : "") + '">' + escapeHtml(text) + "</div>");
      const n = el.floats.lastElementChild;
      while (el.floats.childElementCount > 14) el.floats.removeChild(el.floats.firstElementChild);
      ctx.timeout(() => { if (n && n.parentNode) n.parentNode.removeChild(n); }, 1150);
    }

    function showCard(html) { el.card.innerHTML = html; el.modal.classList.add("on"); wire(el.card); }
    function hideCard() { el.modal.classList.remove("on"); el.card.innerHTML = ""; }
    function wire(root) {
      for (const n of root.querySelectorAll("[data-act]")) {
        if (n.getAttribute("data-wired")) continue;
        n.setAttribute("data-wired", "1");
        const fn = () => act(n.getAttribute("data-act"));
        if (ctx.input && typeof ctx.input.activate === "function") ctx.input.activate(n, fn);
        else ctx.listen(n, "click", fn);
      }
    }
    function refreshChips() {
      for (const n of ui.querySelectorAll('[data-act="control"]')) n.textContent = control === "tilt" ? "Tilt" : "Touch";
      for (const n of ui.querySelectorAll('[data-act="mute"]')) n.textContent = muted ? "Sound off" : "Sound on";
      for (const n of ui.querySelectorAll('[data-act="forward"]')) n.textContent = "Forward: " + (fwdSign < 0 ? "away" : "toward");
      el.ctrlc.style.display = ctx.capabilities.motion ? "" : "none";
      el.cbest.textContent = save.best ? "Best " + fmt(save.best) + " pts · tallest " + save.bestTower : "";
      el.cnote.textContent = control === "tilt"
        ? "Hold the phone up like a tray. It levels itself when you press Play."
        : (ctx.capabilities.motion ? "Drag anywhere to walk the cone. Or switch to tilt." : "Drag anywhere to walk the cone: sideways, and up or down for depth.");
    }

    // ---- persistence --------------------------------------------------------
    const SAVE_KEY = "tall-order";
    function persist() {
      if (!ctx.capabilities.storage) return;
      fireAndForget(() => ctx.storage.set(SAVE_KEY, { best: save.best, bestTower: save.bestTower, plays: save.plays, control: control, muted: muted, fwd: fwdSign }));
    }
    function load() {
      if (!ctx.capabilities.storage) return;
      try {
        const s = ctx.storage.get(SAVE_KEY);
        if (!s || typeof s !== "object") return;
        if (typeof s.best === "number" && s.best >= 0) save.best = Math.floor(s.best);
        if (typeof s.bestTower === "number" && s.bestTower >= 0) save.bestTower = Math.floor(s.bestTower);
        if (typeof s.plays === "number" && s.plays >= 0) save.plays = Math.floor(s.plays);
        if (s.control === "touch") control = "touch";
        else if (s.control === "tilt" && ctx.capabilities.motion) control = "tilt";
        if (s.fwd === 1 || s.fwd === -1) fwdSign = s.fwd;
        muted = !!s.muted;
      } catch (_) { /* start fresh */ }
    }

    // ---- records ------------------------------------------------------------
    function submitRecords() {
      if (points > 0) {
        fireAndForget(() => scoreTrack ? scoreTrack.submit("score", { label: fmt(points) + " pts" }) : ctx.memory.record("score").submit(points, { label: fmt(points) + " pts" }));
      }
      if (count > 0) {
        fireAndForget(() => towerTrack ? towerTrack.submit("tower", { label: count + " scoops" }) : ctx.memory.record("tower").submit(count, { label: count + " scoops" }));
      }
    }
    function rowName(row) {
      return row.username || row.displayName || row.name || row.handle || (row.user && (row.user.username || row.user.handle || row.user.name)) || "Player";
    }
    async function refreshBoard(attempt, rowsNode, statusNode) {
      try {
        const opts = { scope: "global", period: "all_time", limit: 3 };
        const board = await (scoreTrack ? scoreTrack.leaderboard("score", opts) : ctx.memory.record("score").leaderboard(opts));
        if (disposed || attempt !== runId || !rowsNode.isConnected) return;
        const rows = Array.isArray(board && board.rows) ? board.rows : [];
        const vr = board && board.viewerRank;
        const meId = vr && vr.userId;
        if (!rows.length) {
          rowsNode.innerHTML = '<div class="to-row"><span class="nm">No scores yet — yours could be the first.</span></div>';
        } else {
          let h = "";
          for (const row of rows) {
            const me = !!(row.isViewer || row.viewer || row.self || (meId && row.userId === meId));
            h += '<div class="to-row' + (me ? " me" : "") + '"><span class="rk">#' + (row.rank != null ? row.rank : "–") + '</span><span class="nm">' + escapeHtml(rowName(row)) + '</span><span class="vl">' + escapeHtml(row.displayLabel || fmt(row.value || 0)) + "</span></div>";
          }
          rowsNode.innerHTML = h;
        }
        statusNode.textContent = vr && typeof vr.rank === "number"
          ? "You’re #" + vr.rank + (board.totalRanked ? " of " + board.totalRanked : "")
          : "Not ranked yet";
      } catch (_) {
        if (disposed || attempt !== runId || !rowsNode.isConnected) return;
        rowsNode.innerHTML = "";
        statusNode.textContent = "Leaderboard unavailable right now.";
      }
    }

    // ---- tilt ---------------------------------------------------------------
    // The phone is the controller. Motion starts from the Play press (a user
    // gesture, which iOS needs for the permission prompt), the control is
    // levelled right there, and again on Re-level or Resume, so however the
    // player holds the phone, "still" means "stand still".
    let tiltCtl = null, tiltOn = false;
    function relevel() { try { ctx.motion.calibrate(); } catch (_) { /* fine */ } }
    async function tiltBegin() {
      if (!ctx.capabilities.motion) { control = "touch"; refreshChips(); return; }
      try {
        await ctx.motion.start({ smoothing: 0.2 });
        if (disposed) return;
        if (!tiltCtl) tiltCtl = ctx.motion.tiltControl({ maxAngle: 22, deadzone: 0.05, smoothing: 0.25, calibrate: true });
        relevel();
        tiltOn = true;
      } catch (_) {
        tiltOn = false; control = "touch"; refreshChips();
        showHint("Tilt isn't available here — drag instead", 5);
      }
    }
    function tiltEnd() {
      if (!tiltOn) return;
      tiltOn = false;
      try { ctx.motion.stop(); } catch (_) { /* fine */ }
    }

    // ---- flow ---------------------------------------------------------------
    function killParticles() {
      for (let i = 0; i < SPARK_N; i++) { sparks[i].life = 0; sparkPos[i * 3 + 1] = -9; }
      sparkGeo.attributes.position.needsUpdate = true;
      _m4.makeTranslation(0, -9, 0);
      for (let i = 0; i < DROP_N; i++) { dropList[i].life = 0; drops.setMatrixAt(i, _m4); }
      for (let i = 0; i < CONF_N; i++) { confList[i].life = 0; confetti.setMatrixAt(i, _m4); }
      drops.instanceMatrix.needsUpdate = true; confetti.instanceMatrix.needsUpdate = true;
    }
    function clearWorld() {
      for (const s of tower.scoops) towerG.remove(s.mesh);
      tower.scoops.length = 0; recompute();
      tower.thx = tower.thz = tower.omx = tower.omz = 0; leanQuat(tower.q, 0, 0);
      for (const f of falling) world.remove(f.mesh);
      falling.length = 0;
      clearDebris();
      for (const a of arms) { if (a.held) { world.remove(a.held); a.held = null; } a.state = "home"; a.spec = null; a.open = 0; a.cup.scale.setScalar(1); }
      pendingDrops = 0;
      base.x = base.z = base.vx = base.vz = base.tx = base.tz = base.ax = base.az = 0;
      killParticles();
      el.floats.innerHTML = "";
      guideRing.visible = guideDisc.visible = guideBeam.visible = false;
    }
    function startRun() {
      runId++;
      clearWorld();
      state = "play"; stateT = 0;
      hearts = 3; count = 0; points = 0; mult = 1; cleanRun = 0;
      rushState = "none"; rushLeft = 0; lastRushAt = 0; miniLeft = 0; lastArm = 1;
      dropTimer = 0; nextDrop = 1.3; endTimer = 0; warned = false; hintLandings = 0;
      if (scoreTrack) { try { scoreTrack.reset(); towerTrack.reset(); } catch (_) { /* fine */ } }
      hudScore(); hudHearts(); hudLevel();
      el.hud.classList.add("on");
      el.curtain.style.opacity = "0"; el.curtain.style.pointerEvents = "none";
      hideCard();
      ctx.platform.start({ control: control });
      if (control === "tilt") fireAndForget(() => tiltBegin()); else tiltEnd();
      audioInit(); resumeAudio();
      fireAndForget(() => musicStart());
      musicSet({ intensity: tune.music(), tempo: 96 });
      setMood("calm", 0);
      if (save.plays === 0) showHint(control === "tilt" ? "Tilt the phone to walk the cone under the lean" : "Drag to walk the cone under the lean", 8);
      else if (control === "tilt") showHint("Levelled. Tilt to walk.", 2.5);
    }
    function toMenu() {
      runId++;
      hideCard(); tiltEnd(); hideHint();
      state = "title"; stateT = 0;
      clearWorld();
      el.hud.classList.remove("on");
      el.curtain.style.opacity = "1"; el.curtain.style.pointerEvents = "auto";
      musicSet({ intensity: 0.3, tempo: 96 });
      refreshChips();
    }
    function pauseGame() {
      if (state !== "play") return;
      state = "paused";
      try { if (tiltOn) ctx.motion.pause(); } catch (_) { /* fine */ }
      showCard('<h2>Paused</h2>' +
        '<div class="to-big"><div><b>' + count + '</b><span>scoops</span></div><div><b>' + fmt(points) + '</b><span>points</span></div></div>' +
        '<div class="to-btn" data-act="resume">Resume</div>' +
        '<div class="to-btn g" data-act="restart">Restart</div>' +
        '<div class="to-chips"><div class="to-chip" data-act="control">' + (control === "tilt" ? "Tilt" : "Touch") + '</div>' +
        '<div class="to-chip" data-act="forward">Forward: ' + (fwdSign < 0 ? "away" : "toward") + '</div>' +
        '<div class="to-chip" data-act="mute">' + (muted ? "Sound off" : "Sound on") + "</div></div>" +
        '<p>' + (control === "tilt" ? "Resuming levels the phone where you hold it." : "") + "</p>" +
        '<div class="to-btn g" data-act="menu">Menu</div>');
      if (!ctx.capabilities.motion) for (const n of el.card.querySelectorAll('[data-act="control"],[data-act="forward"]')) n.style.display = "none";
    }
    function resumeGame() {
      if (state !== "paused") return;
      hideCard();
      state = "play";
      try { if (tiltOn) { ctx.motion.resume(); relevel(); } } catch (_) { /* fine */ }
      if (control === "tilt" && !tiltOn) fireAndForget(() => tiltBegin());
    }
    function act(name) {
      audioInit(); resumeAudio(); sfx.click();
      if (name === "play" || name === "again") startRun();
      else if (name === "pause") pauseGame();
      else if (name === "resume") resumeGame();
      else if (name === "restart") startRun();
      else if (name === "menu") toMenu();
      else if (name === "mute") { muted = !muted; applyMute(); if (!muted) fireAndForget(() => musicStart()); refreshChips(); persist(); }
      else if (name === "forward") { fwdSign = -fwdSign; refreshChips(); persist(); ctx.platform.interact({ type: "forward", forward: fwdSign < 0 ? "away" : "toward" }); }
      else if (name === "control") {
        control = control === "tilt" ? "touch" : "tilt";
        if (control === "tilt" && !ctx.capabilities.motion) control = "touch";
        if (state === "play" || state === "paused") { if (control === "tilt") fireAndForget(() => tiltBegin()); else tiltEnd(); }
        refreshChips(); persist();
        ctx.platform.interact({ type: "control", control: control });
      }
    }

    // ---- the scoops arriving --------------------------------------------------
    function pickSpec() {
      if (miniLeft > 0) return newSpec("mini");
      const roll = Math.random();
      const big = tune.bigChance() * (rushState === "rush" ? 1.5 : 1);
      if (count >= 5 && roll < big) return newSpec("big");
      if (count >= 8 && roll < big + tune.miniChance()) { miniLeft = 2; return newSpec("mini"); }
      return newSpec("regular");
    }
    function stepSpawner(dt) {
      if (rushState === "warn") {
        rushT += dt;
        if (rushT >= 1.3) { rushState = "rush"; dropTimer = 0; nextDrop = 0.15; }
        return;
      }
      if (rushState === "cool") return;                // the last rush scoops are still in the air
      dropTimer += dt;
      if (dropTimer < nextDrop) return;
      let idx = miniLeft > 0 ? lastArm : 1 - lastArm;
      if (arms[idx].state !== "home") {
        if (miniLeft === 0 && arms[1 - idx].state === "home") idx = 1 - idx;
        else return;                                   // both arms busy: wait, keep the timer
      }
      const spec = pickSpec();
      const inRush = rushState === "rush";
      dispatch(arms[idx], spec, inRush);
      lastArm = idx;
      dropTimer = 0;
      if (inRush) {
        rushLeft--;
        nextDrop = 0.5;
        if (rushLeft <= 0) rushState = "cool";
      } else if (miniLeft > 0) {
        miniLeft--;
        nextDrop = 0.42;
      } else {
        nextDrop = (tune.interval() / 1000) / tune.ramp(count);
      }
    }
    function startRushWarning() {
      rushState = "warn"; rushT = 0; lastRushAt = count;
      rushLeft = 4 + Math.min(4, Math.floor(count / 12));
      banner("INCOMING!", rushLeft + " scoops, fast · double points");
      sfx.alarm(); musicDuck(0.6, 1500); haptic("warning");
    }
    function endRush() {
      rushState = "none";
      toast("PHEW", "breather");
      sfx.phew();
      dropTimer = 0; nextDrop = 2.4;
    }
    function milestone() {
      const bonus = 50 * count;
      points += bonus;
      if (scoreTrack) { try { scoreTrack.add(bonus); } catch (_) { /* fine */ } }
      toast(count + " SCOOPS!", "+" + fmt(bonus) + " bonus");
      confettiBurst(base.x, PIVOT_Y + tower.h + 0.4, base.z);
      sfx.milestone(); musicSting("success"); haptic("success"); setMood("joy", 1.5);
      camState.shake = Math.max(camState.shake, 0.35);
      try { ctx.platform.milestone("scoops_" + count, { score: points }); } catch (_) { /* fine */ }
      hudScore();
    }
    // A scoop has met the tower's top at offset (ex, ez) in the tower's frame.
    function land(f, ex, ez, e, catchR) {
      const spec = f.spec;
      pendingDrops = Math.max(0, pendingDrops - 1);
      const sc = { r: spec.r, m: spec.m, kind: spec.kind, pts: spec.pts, fl: spec.fl, spec: spec, dx: ex * 0.5, dz: ez * 0.5, x: 0, y: 0, z: 0, wx: 0, wz: 0, wvx: 0, wvz: 0, sq: 0, mesh: f.mesh };
      world.remove(f.mesh); towerG.add(f.mesh); f.mesh.rotation.set(0, 0, 0);
      tower.scoops.push(sc);
      recompute();
      const kick = sc.m / (Math.max(0.5, tower.M) * Math.max(0.1, tower.cy)) * K_IMP;
      tower.omx += clamp(ex * kick, -0.5, 0.5);
      tower.omz += clamp(ez * kick, -0.5, 0.5);
      const n = tower.scoops.length;
      for (let i = n - 1, d = 0; i >= 0 && d < 5; i--, d++) {
        const s = tower.scoops[i];
        s.wvx += ex * 6 * Math.pow(0.55, d); s.wvz += ez * 6 * Math.pow(0.55, d);
        s.sq = Math.max(s.sq, 0.17 * Math.pow(0.7, d));
      }
      count++;
      const phi = Math.hypot(tower.thx, tower.thz);
      const clean = e < catchR * 0.3 && phi < tower.thMax * 0.35;
      const tp = topPoint();
      const lx = tp.x, ly = tp.y + spec.r + 0.14, lz = tp.z;
      if (clean) { cleanRun++; mult = Math.min(8, 1 + Math.floor(cleanRun / 2)); }
      else { if (mult > 1) floatText(lx, ly + 0.16, lz, "WOBBLY", "#ffd3e0", 20); cleanRun = 0; mult = 1; }
      const pts = spec.pts * mult * (rushState === "rush" || rushState === "cool" ? 2 : 1);
      points += pts;
      if (scoreTrack) { try { scoreTrack.add(pts); towerTrack.set(count); } catch (_) { /* fine */ } }
      floatText(lx, ly, lz, "+" + fmt(pts), clean ? "#fff6c8" : "#ffffff", clean ? 26 : 22);
      if (clean && mult > 1) floatText(lx, ly + 0.16, lz, "CLEAN ×" + mult, "#ffe07a", 20);
      if (clean) sparkle(tp.x, tp.y + spec.r * 0.4, tp.z, 12);
      if (spec.kind === "big") { camState.shake = Math.max(camState.shake, 0.6); floatText(lx + 0.22, ly - 0.05, lz, "BIG!", "#ffb0c8", 24); haptic("medium"); }
      else haptic("light");
      sfx.plop(spec.kind);
      if (clean) sfx.clean(mult);
      hudScore();
      ctx.platform.interact({ type: "scoop", count: count, clean: clean });
      hintLandings++;
      if (hintLandings === 1 && save.plays === 0) showHint("Keep the tower under the next scoop", 6);
      if (hintLandings >= 3) hideHint();
      if (count % 10 === 0) milestone();
      if (rushState === "none" && count % tune.rushEvery() === 0 && count !== lastRushAt) startRushWarning();
      else if (rushState === "cool" && pendingDrops === 0) endRush();
      if (count % 5 === 0) musicSet({ intensity: clamp(tune.music() + count / 80, 0, 1), tempo: 96 + Math.min(44, count * 1.1) });
    }
    // A scoop has hit the floor.
    function splat(f) {
      droplets(f.x, 0, f.z, f.spec.fl, 14);
      splatDecal(f.x, f.z, f.spec.fl, f.r);
      f.mesh.position.set(f.x, f.r * 0.5, f.z); f.mesh.scale.set(1.25, 0.6, 1.25);
      debris.push({ x: f.x, y: f.r * 0.5, z: f.z, vx: 0, vy: 0, vz: 0, wx: 0, wz: 0, r: f.r, spec: f.spec, mesh: f.mesh, bounces: 2, rest: true });
      pendingDrops = Math.max(0, pendingDrops - 1);
      if (state !== "play") { sfx.plop(f.spec.kind); return; }
      sfx.miss(); sfx.heart(); haptic("error");
      hearts--; hudHearts();
      cleanRun = 0;
      if (mult > 1) { mult = 1; hudScore(); }
      floatText(f.x, 0.4, f.z, "SPILL", "#ffb0c8", 24);
      if (hearts <= 0) {
        state = "spilled"; endTimer = 1.0;
        retractArms(); hideHint(); setMood("dismay", 9);
        toast("OUT OF HEARTS", "the customer walked");
      } else if (hearts === 1) {
        toast("LAST HEART", "one more spill ends it");
      }
      if (rushState === "cool" && pendingDrops === 0) endRush();
    }
    function toppleNow() {
      toppleTower(); retractArms(); hideHint();
      state = "topple"; stateT = 0;
      sfx.topple(); haptic("heavy"); camState.shake = 1; setMood("dismay", 9); musicDuck(0.7, 1500);
    }
    function gameOver(reason) {
      if (state === "result") return;
      state = "result"; stateT = 0;
      retractArms(); tiltEnd(); hideHint();
      el.hud.classList.remove("on");
      const isBest = points > save.best && points > 0;
      const isTall = count > save.bestTower;
      save.plays++;
      if (isBest) save.best = points;
      if (isTall) save.bestTower = count;
      persist();
      submitRecords();
      try { ctx.platform.complete({ score: points, scoops: count, reason: reason, control: control }); } catch (_) { /* fine */ }
      musicSet({ intensity: 0.3, tempo: 90 });
      musicSting(isBest ? "win" : "lose");
      showResult(reason, isBest, isTall);
    }
    function showResult(reason, isBest, isTall) {
      const attempt = runId;
      const line = reason === "spills" ? "The customer gave up waiting." :
        count >= 25 ? "A tower for the ages. Gravity had the last word." :
        count >= 12 ? "Respectable. Gravity disagrees." :
        count >= 5 ? "Getting the hang of it." : "Gravity 1, scoops 0. Again?";
      showCard('<h2>' + (reason === "spills" ? "Too many spills" : "Tower down!") + "</h2>" +
        "<p>" + line + "</p>" +
        '<div class="to-big"><div><b>' + count + '</b><span>scoops</span></div><div><b>' + fmt(points) + '</b><span>points</span></div></div>' +
        '<div class="to-best' + (isBest || isTall ? " new" : "") + '">' + (isBest ? "New best score!" : isTall ? "New tallest tower!" : "Best " + fmt(save.best) + " · tallest " + save.bestTower) + "</div>" +
        '<div class="to-lb"><h3>Top scores</h3><div data-lb="rows"><div class="to-row"><span class="nm">Loading…</span></div></div><div class="to-lbs" data-lb="status">Updating…</div></div>' +
        '<div class="to-btn" data-act="again">Play again</div><div class="to-btn g" data-act="menu">Menu</div>');
      const rowsNode = el.card.querySelector('[data-lb="rows"]');
      const statusNode = el.card.querySelector('[data-lb="status"]');
      refreshBoard(attempt, rowsNode, statusNode);     // never awaited: replay stays immediate
      if ((isBest || isTall) && count >= 5) {
        ctx.timeout(() => {
          if (disposed || attempt !== runId || state !== "result") return;
          try { ctx.pulse.complete({ score: points, level: count, text: "Balanced a " + count + "-scoop tower in Tall Order" }); } catch (_) { /* fine */ }
        }, 500);
      }
    }

    // ---- the scooper's body language --------------------------------------
    // He leans into the cone's acceleration, pivoting at the hands so the
    // cone never leaves them; his legs scissor when he walks; his eyes follow
    // the tower's top or the arm that is coming; his face says how it's going.
    const face = { browY: 0.095, browA: 0, smileS: 1, frown: 0, mouthO: 0 };
    function stepMan(dt) {
      const k = Math.min(1, dt * 9);
      man.lean.x += (clamp(-base.ax * 0.012, -0.14, 0.14) - man.lean.x) * k;
      man.lean.z += (clamp(base.az * 0.012, -0.12, 0.12) - man.lean.z) * k;
      const sp = Math.hypot(base.vx, base.vz);
      man.walkAmt += (clamp(sp / 0.8, 0, 1) - man.walkAmt) * k;
      man.walk += sp * 9 * dt;
      let lx = 0, ly = 0.5, lz = 0.6;
      if (tower.M) { const tp = topPoint(); lx = tp.x - base.x; ly = tp.y - (HEAD_Y + 0.06); lz = tp.z - base.z; }
      for (const a of arms) if (a.state === "in" || a.state === "hover") { lx = a.handPos.x - base.x; ly = a.handPos.y - (HEAD_Y + 0.06); lz = a.handPos.z - base.z; }
      const yawT = clamp(lx * 0.9, -0.55, 0.55);
      const pitchT = clamp(-Math.atan2(ly, 0.9 + Math.max(0, lz)), -0.95, 0.3);
      man.look.x += (yawT - man.look.x) * Math.min(1, dt * 6);
      man.look.y += (pitchT - man.look.y) * Math.min(1, dt * 6);
      man.moodT = Math.max(0, man.moodT - dt);
      if (man.moodT <= 0) {
        const q = tower.M && state === "play" ? Math.hypot(tower.thx, tower.thz) / tower.thMax : 0;
        man.mood = q > 0.62 ? "panic" : q > 0.3 ? "focused" : "calm";
      }
      const m = man.mood;
      const tgt = m === "panic" ? [0.112, 0.35, 0, 0, 1] : m === "focused" ? [0.088, -0.3, 0.7, 0, 0] :
        m === "joy" ? [0.108, 0.1, 1.35, 0, 0] : m === "dismay" ? [0.084, 0.4, 1, 1, 0] : [0.095, 0, 1, 0, 0];
      const kf = Math.min(1, dt * 10);
      face.browY += (tgt[0] - face.browY) * kf; face.browA += (tgt[1] - face.browA) * kf;
      face.smileS += (tgt[2] - face.smileS) * kf; face.frown += (tgt[3] - face.frown) * kf; face.mouthO += (tgt[4] - face.mouthO) * kf;
    }
    function syncMan() {
      const g = man.g;
      g.rotation.set(man.lean.z, 0, man.lean.x);
      g.position.set(base.x + Math.sin(man.lean.x) * MAN_H, 0, base.z - Math.sin(man.lean.z) * MAN_H);
      blob.position.x = g.position.x; blob.position.z = g.position.z;
      const sw = Math.sin(man.walk) * 0.55 * man.walkAmt;
      man.legL.rotation.x = sw; man.legR.rotation.x = -sw;
      man.head.rotation.set(man.look.y, man.look.x, 0);
      man.pupilL.position.x = -0.062 + man.look.x * 0.012; man.pupilR.position.x = 0.062 + man.look.x * 0.012;
      man.pupilL.position.y = man.pupilR.position.y = 0.03 - man.look.y * 0.012;
      man.browL.position.y = man.browR.position.y = face.browY;
      man.browL.rotation.z = -face.browA; man.browR.rotation.z = face.browA;
      man.smile.visible = face.mouthO < 0.5;
      man.mouthO.visible = face.mouthO >= 0.5;
      man.smile.scale.set(face.smileS, face.smileS, 1);
      man.smile.rotation.z = Math.PI * (1 - face.frown);
      man.smile.position.y = -0.06 - face.frown * 0.025;
    }
    function leanCues() {
      const q = tower.M ? Math.hypot(tower.thx, tower.thz) / tower.thMax : 0;
      if (q > 0.7 && !warned) { warned = true; haptic("warning"); }
      if (q < 0.45) warned = false;
    }

    // ---- the drop guide and the machine's little lights -----------------------
    const _qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const _gp = new THREE.Vector3(), _gh = new THREE.Vector3();
    function syncGuide() {
      let a = null;
      for (const x of arms) if ((x.state === "in" || x.state === "hover") && x.spec) a = x;
      const show = !!a && (state === "play" || state === "spilled");
      guideRing.visible = guideDisc.visible = guideBeam.visible = show;
      if (!show) return;
      const top = topPoint();
      const catchR = top.cup ? CONE_R + a.spec.r * 0.7 : (top.r + a.spec.r) * CATCH;
      _gp.set(0, top.cup ? 0.005 : top.r * 0.92, 0).applyQuaternion(tower.q).add(_v.set(top.x, top.y, top.z));
      guideRing.position.copy(_gp); guideRing.scale.set(catchR, catchR, 1);
      guideRing.quaternion.copy(tower.q).multiply(_qx);
      guideDisc.position.copy(_gp); guideDisc.scale.set(catchR, catchR, 1);
      guideDisc.quaternion.copy(guideRing.quaternion);
      heldPoint(a, _gh);
      placeSegment(guideBeam, _gh, _gp, 1);
      const off = Math.hypot(a.handPos.x - top.x, a.handPos.z - top.z) / catchR;
      const hex = off < 0.5 ? 0x9dffb0 : off < 1 ? 0xffe07a : 0xff7a9a;
      guideRing.material.color.setHex(hex); guideBeam.material.color.setHex(hex); guideDisc.material.color.setHex(hex);
      guideDisc.material.opacity = 0.14 + 0.08 * Math.sin(clock * 9);
    }
    function animateMachine() {
      for (const a of arms) {
        const mat = a.light.material;
        if (rushState === "warn") { mat.emissive.setHex(0xff3355); mat.emissiveIntensity = 1 + Math.max(0, Math.sin(clock * 16)) * 2.5; }
        else if (a.state !== "home") { mat.emissive.setHex(0x9dffb0); mat.emissiveIntensity = 1.6 + Math.sin(clock * 10) * 0.5; }
        else { mat.emissive.setHex(0xffd27a); mat.emissiveIntensity = 0.8; }
      }
    }

    // ===================================================================== //
    // 9. Input: tilt first, then drag, then keys                            //
    // ===================================================================== //
    // The phone is a tray: the cone stands where the tilt says, the full
    // walking range at the control's max angle, so a steady hand is a
    // standing cone and a flick is a shove. A drag moves the cone by what
    // the finger moves (at the cone's depth), sideways and up or down for
    // depth; keys walk it at V_KEY.
    const V_KEY = 1.2;
    let gesture = null;
    const keys = { left: false, right: false, up: false, down: false };
    const controllable = () => state === "play" || state === "spilled";
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
    ctx.listen(canvas, "pointerdown", (e) => {
      if (!controllable()) return;
      if (e.cancelable) e.preventDefault();
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } }
      gesture = { id: e.pointerId, x: typeof e.offsetX === "number" ? e.offsetX : e.clientX, y: typeof e.offsetY === "number" ? e.offsetY : e.clientY };
      if (control !== "tilt" && save.plays === 0 && hintLandings < 3) el.finger.classList.remove("on");
    }, { passive: false });
    ctx.listen(canvas, "pointermove", (e) => {
      if (!gesture || e.pointerId !== gesture.id) return;
      if (e.cancelable) e.preventDefault();
      const x = typeof e.offsetX === "number" ? e.offsetX : e.clientX;
      const y = typeof e.offsetY === "number" ? e.offsetY : e.clientY;
      const dx = x - gesture.x, dy = y - gesture.y;
      gesture.x = x; gesture.y = y;
      if (controllable()) {
        const mpp = metresPerPixel() * tune.sens();
        base.tx += dx * mpp;
        base.tz += dy * mpp * 1.3;
      }
    }, { passive: false });
    const endGesture = (e) => { if (gesture && (!e || typeof e.pointerId !== "number" || e.pointerId === gesture.id)) gesture = null; };
    ctx.listen(canvas, "pointerup", endGesture);
    ctx.listen(canvas, "pointercancel", endGesture);
    ctx.listen(window, "pointerup", endGesture);
    const keyFor = (e) => {
      const k = e.key;
      return (k === "ArrowLeft" || k === "a" || k === "A") ? "left" : (k === "ArrowRight" || k === "d" || k === "D") ? "right" :
        (k === "ArrowUp" || k === "w" || k === "W") ? "up" : (k === "ArrowDown" || k === "s" || k === "S") ? "down" : null;
    };
    ctx.listen(window, "keydown", (e) => { const k = keyFor(e); if (k) keys[k] = true; });
    ctx.listen(window, "keyup", (e) => { const k = keyFor(e); if (k) keys[k] = false; });
    function stepControl(dt) {
      const sens = tune.sens();
      if (keys.left !== keys.right) base.tx += (keys.right ? 1 : -1) * V_KEY * sens * dt;
      if (keys.up !== keys.down) base.tz += (keys.down ? 1 : -1) * V_KEY * sens * dt;
      if (tiltOn && tiltCtl) {
        base.tx = num(tiltCtl.x) * X_MAX * sens;
        base.tz = num(tiltCtl.y) * fwdSign * Z_MAX * sens;
      }
    }

    // ===================================================================== //
    // 10. The frame, boot                                                   //
    // ===================================================================== //
    function step(dt) {
      clock += dt; stateT += dt;
      camState.shake = Math.max(0, camState.shake - dt * 2.4);
      if (state === "play" || state === "spilled") {
        stepControl(dt); stepBody(dt); stepArms(dt); stepFalling(dt);
        const phi = Math.hypot(tower.thx, tower.thz);
        if (state === "play") {
          stepSpawner(dt);
          if (tower.M && (phi > tower.thMax || phi > 0.6)) toppleNow();
          else leanCues();
        } else {
          if (tower.M && (phi > tower.thMax || phi > 0.6)) { toppleTower(); sfx.topple(); camState.shake = 1; }
          endTimer -= dt;
          if (endTimer <= 0) gameOver("spills");
        }
        stepDebris(dt);
      } else if (state === "topple") {
        stepBody(dt); stepArms(dt); stepFalling(dt); stepDebris(dt);
        if (stateT > 1.6) gameOver("topple");
      } else if (state === "result") {
        stepArms(dt); stepFalling(dt); stepDebris(dt);
      } else if (state === "title") {
        stepBody(dt); stepArms(dt);
      }
      stepMan(dt); stepParticles(dt);
      if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hideHint(); }
      applyInsets();
      frameCamera(dt);
      syncTower(); syncMan(); syncGuide(); animateMachine(); hudLevel();
    }
    function render() { renderer.render(scene, camera); }
    function resize() {
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
      renderer.setSize(ctx.width, ctx.height, false);
    }

    load();
    applyMute();
    refreshChips(); hudHearts(); hudScore(); hudLevel();
    wire(ui);

    // Fonts are best effort and bounded, so the title does not swap faces
    // mid-fade but a slow registry cannot hold the first frame hostage.
    const fontLoad = (family, name, version, o) => {
      try { return Promise.resolve(ctx.loadFont(family, name, version, o)).catch(() => null); }
      catch (_) { return Promise.resolve(null); }
    };
    await Promise.race([
      Promise.all([
        fontLoad("Bebas Neue", "bebas-neue", "1.0.0", { weight: "400" }),
        fontLoad("Nunito Sans", "nunito-sans", "1.0.0", { weight: "700" }),
        fontLoad("Nunito Sans", "nunito-sans", "1.0.0", { weight: "400" })
      ]),
      new Promise((res) => ctx.timeout(res, 1500))
    ]);
    if (disposed) return;
    // The chalk board and the neon sign are lettered in the title face, so
    // they are painted once the fonts are in (or the wait is up).
    { const bt = boardTex(); if (bt) { board.material.map = bt; board.material.needsUpdate = true; } }
    { const st = signTex(); if (st) { sign.material.map = st; sign.material.emissiveMap = st; sign.material.needsUpdate = true; } }

    // The SDK's cleanup-owned layout hook: resize, rotation and, in a
    // full-screen bit, inset changes. Insets are read from ctx, not the
    // payload, whose safeArea is all zeros in the safe frame.
    ctx.onResize(() => { resize(); applyInsets(); frameCamera(1); }, { immediate: true });
    try {
      if (ctx.tune && typeof ctx.tune.onChange === "function") {
        ctx.tune.onChange(["music_intensity", "tilt_forward"], () => {
          musicSet({ intensity: tune.music() });
          fwdSign = tune.forward() === "toward" ? 1 : -1;
          refreshChips();
        });
      }
    } catch (_) { /* tuning is optional */ }

    step(0); render();
    ctx.markVisualReady("title");
    ctx.platform.ready();

    const frame = (dtMs) => step(clamp(dtMs, 0, 100) / 1000);
    let loopErrors = 0;
    const loopError = (err, phase) => {
      loopErrors++;
      if (loopErrors > 3) return;                      // report a persistent fault a few times, not every frame
      try { ctx.platform.error({ stage: phase || "loop", message: String((err && err.message) || err), stack: String((err && err.stack) || "") }); } catch (_) { /* nothing left */ }
    };
    if (ctx.game && typeof ctx.game.loop === "function") {
      ctx.game.loop({ maxDeltaMs: 100, update: (dtMs) => frame(dtMs), render: render, onError: loopError });
    } else {
      ctx.onFrame((dtMs) => { frame(dtMs); render(); });
    }

    // Read-only state for the headless harness, which balances the tower
    // through the tilt control (window.__tilt in the mock) or a drag.
    // `drive2` is what a steady hand does, per axis: full state feedback on
    // the lean about the lopsided stack's own equilibrium, plus a slow,
    // regime-scaled position loop that walks the cone back to the centre.
    // Gains were picked offline from the closed-loop eigenvalues; the result
    // is an acceleration of the cone's target (m/s^2) and the reach a full
    // tilt gives on each axis, so the harness can integrate to a position
    // and set the tilt that puts the cone there. `t` is game time, so a
    // harness running the game slower than the wall clock integrates in the
    // game's seconds, not its own.
    function driveAxis(th, om, c, x, v) {
      const cy = Math.max(0.1, tower.cy), grown = towerGrown();
      const G = GRAV * tune.topple() * (1 - 0.6 * tune.sticky()) * grown;
      const om2 = G / cy - K_CUP * (1 - grown);
      const kp = 10, kd = 5, wx = 0.2, zx = 0.7;
      let alpha = om2 / (kp - om2);
      if (Math.abs(alpha) < 0.06) alpha = alpha < 0 ? -0.06 : 0.06;
      const k3 = wx * wx / alpha, k4 = 2 * zx * wx / alpha;
      return cy * (kp * (th + Math.atan2(c, cy)) + kd * om) + k3 * x + k4 * v;
    }
    window.plethoraBit.debug = {
      state: () => state, scoops: () => count, hearts: () => hearts, points: () => points,
      lean: () => Math.hypot(tower.thx, tower.thz), thMax: () => tower.thMax, pending: () => pendingDrops,
      control: () => control, tilt: () => tiltOn,
      drive2: () => {
        const s = tune.sens();
        if (!tower.M) return { ax: -4 * base.x - 3 * base.vx, az: -4 * base.z - 3 * base.vz, rx: X_MAX * s, rz: Z_MAX * s * fwdSign, mpp: metresPerPixel(), t: clock };
        return {
          ax: driveAxis(tower.thx, tower.omx, tower.cx, base.x, base.vx),
          az: driveAxis(tower.thz, tower.omz, tower.cz, base.z, base.vz),
          rx: X_MAX * s, rz: Z_MAX * s * fwdSign, mpp: metresPerPixel(), t: clock
        };
      },
      // the same, as finger accelerations in screen px/s^2 for a drag
      drivePx: () => {
        const d = window.plethoraBit.debug.drive2();
        const mpp = d.mpp * tune.sens();
        return { x: d.ax / mpp, y: d.az / (mpp * 1.3), t: d.t };
      },
      snapshot: () => ({
        state: state, scoops: count, hearts: hearts, points: points, control: control, tilt: tiltOn,
        base: [base.x, base.z, base.vx, base.vz, base.tx, base.tz, base.ax, base.az],
        cam: [camState.d, camState.yc, camState.x], tower: [tower.thx, tower.thz, tower.omx, tower.omz, tower.cx, tower.cz, tower.cy, tower.h, tower.M, tower.thMax],
        falling: falling.map((f) => [f.x, f.y, f.z, f.vy, f.missed]), arms: arms.map((a) => [a.state, a.handPos.x, a.handPos.y, a.handPos.z, a.err.x, a.err.z]),
        pending: pendingDrops, rush: rushState, scoopList: tower.scoops.map((s) => [s.kind, s.r, s.dx, s.dz, s.x, s.y, s.z])
      })
    };

    } catch (err) {
      fatal("init", err);
    }
  }
};
