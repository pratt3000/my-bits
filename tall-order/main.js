/**
 * Tall Order — balance the tallest ice cream tower in town.
 *
 * A scooper stands at the bottom of the screen holding a waffle cone. Two
 * mechanical arms slide in along a rail at the top and lower scoop after
 * scoop onto the stack. The stack is an inverted pendulum: it leans, and you
 * walk the cone under it — drag a finger, or tilt the phone — before the
 * centre of mass wanders past the cone. Every scoop makes the tower taller,
 * slower and less forgiving. Big scoops land heavy, mini scoops come in
 * threes, and every so often the machine warns INCOMING and fires a burst.
 * A scoop the tower is not under splats on the deck and costs a heart. The
 * run ends when the tower topples or the hearts run out; the score is
 * points (a clean, steady landing builds a multiplier), the tower is scoops,
 * and both go to leaderboards.
 *
 * The physics, written out rather than faked:
 *  - the tower is one rigid body pivoting at the cone top. Its lean obeys
 *    th'' = (G / cy) (sin th + (cx / cy) cos th) - (a / cy) cos th - c th'
 *    where (cx, cy) is the centre of mass in the tower's own frame, a is the
 *    cone's horizontal acceleration and G an effective gravity that ice
 *    cream's stickiness reduces (and that is zero for a scoop-short stack
 *    sitting in the cup of the cone). Moving the cone under the lean is what
 *    rights it, exactly like a broom balanced on a palm;
 *  - it topples when the centre of mass passes the edge of the cone's
 *    support, |th| > atan(SUP / cy): a tall tower leans slowly but has a tiny
 *    window;
 *  - every scoop sits where it landed. An off-centre landing shifts the
 *    centre of mass for good and gives the tower a shove proportional to the
 *    scoop's mass and offset;
 *  - on top of the rigid lean each scoop carries a jelly wobble, a damped
 *    oscillator kicked by landings and by the cone's acceleration, so the
 *    stack whips like soft ice cream. It is cosmetic, and it is most of the
 *    feel.
 *
 * Everything on screen is drawn here with Canvas2D: no dependencies, no
 * assets. Full screen (display "fullscreen"): the sky and the deck run edge
 * to edge; the banner, the hint, the cards and the scooper's feet are laid
 * out from ctx.contentSafeArea ?? ctx.safeArea, and the camera zooms out as
 * the tower grows so the top stays under the dispenser rail.
 */
window.plethoraBit = {
  meta: {
    title: "Tall Order",
    runtime: "plethora-bit@2",
    tags: ["game", "arcade", "balance", "ice-cream", "stacking", "tilt", "leaderboard", "physics"],
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
      sky: () => knob("choice", "sky", "sunset"),
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
    // The scene is one opaque Canvas2D in CSS pixels; the HUD, the cards and
    // the title sit on a DOM root above it that passes every touch through
    // except on its buttons.
    const canvas = ctx.createCanvas2D({ coordinateSpace: "css", maxDpr: 2, alpha: false, touchAction: "none", layer: "content" });
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Canvas2D is unavailable on this device");
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
      ".to-chip{padding:9px 14px;border-radius:12px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;pointer-events:auto;cursor:pointer;background:rgba(255,255,255,.16);color:#fff;border:1.5px solid rgba(255,255,255,.35);}" +
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
      "</style>" +
      '<div class="to" data-el="stage">' +
      '<div class="to-hud" data-el="hud">' +
      '<div class="to-pill"><b data-el="scoops">0</b><span>scoops</span></div>' +
      '<div class="to-hearts" data-el="hearts"></div>' +
      '<div class="to-pill to-score"><b data-el="score">0</b><span class="to-mult" data-el="mult">×1</span></div>' +
      '<div class="to-pause" data-act="pause"><i></i><i></i></div>' +
      "</div>" +
      '<div class="to-banner" data-el="banner"><div class="to-banner-in"><b data-el="bannerb">INCOMING!</b><span data-el="banners">hold on</span></div></div>' +
      '<div class="to-toast" data-el="toast"><b data-el="toastb"></b><span data-el="toasts"></span></div>' +
      '<div class="to-hint" data-el="hint"><div class="to-finger" data-el="finger"></div><span data-el="hintt"></span></div>' +
      '<div class="to-fade" data-el="fade"></div>' +
      '<div class="to-modal" data-el="modal"><div class="to-card" data-el="card"></div></div>' +
      '<div class="to-curtain" data-el="curtain">' +
      '<div class="to-logo">' + SVG_LOGO + "</div>" +
      '<div class="to-title">TALL<br>ORDER</div>' +
      '<div class="to-sub">Balance the tallest ice cream tower in town. Walk the cone under the lean before it goes.</div>' +
      '<div class="to-cbest" data-el="cbest"></div>' +
      '<div class="to-btn to-cbtn" data-act="play">Play</div>' +
      '<div class="to-chips"><div class="to-chip" data-act="control" data-el="ctrlc">Touch</div><div class="to-chip" data-act="mute" data-el="mutec">Sound on</div></div>' +
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

    // World units are CSS pixels at camera scale 1, y up from the deck.
    // cam.s shrinks as the tower grows so the top stays under the machine.
    const HUD_H = 60;
    const cam = { s: 1, target: 1, cx: 0, floorY: 0, railY: 0, clawY: 0 };
    function layout() {
      const W = ctx.width, H = ctx.height;
      cam.cx = W / 2;
      cam.floorY = H - insets.bottom - 16;        // the scooper's feet; the deck continues under the logo
      cam.railY = insets.top + 10 + HUD_H + 28;   // the dispenser rail hangs under the banner
      cam.clawY = cam.railY + 18 + 56;            // where a held scoop's centre hangs
    }
    layout();
    const wx = (x) => cam.cx + x * cam.s;         // world -> screen
    const wy = (y) => cam.floorY - y * cam.s;

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
    // 5. The world: the tower, the arms, the falling scoops, the debris     //
    // ===================================================================== //
    const MAN_H = 134;                     // deck to the hands, where the cone's tip sits
    const CONE_H = 70, CONE_R = 22;
    const PIVOT_Y = MAN_H + CONE_H;        // the tower pivots at the cone's rim
    const KINDS = {
      regular: { r: 26, m: 1, pts: 100 },
      big: { r: 38, m: 2.4, pts: 150 },
      mini: { r: 17, m: 0.45, pts: 60 }
    };
    const OVERLAP = 0.82;                  // scoops sink into each other a little
    const SUP = 30;                        // how far the centre of mass may wander off the cone (px)
    const GRAV = 520;                      // effective gravity on the lean, px/s^2, before tuning
    const DAMP = 0.9;                      // viscous damping on the lean, 1/s
    const K_IMP = 3;                       // how hard an off-centre landing shoves the tower
    const K_CUP = 40;                      // the cone's cup springs a short stack back upright, 1/s^2
    const CATCH = 0.8;                     // fraction of the summed radii that still counts as a catch
    const WOB_K = 170, WOB_C = 7;          // the jelly wobble spring
    const FLAVORS = [
      { n: "vanilla", c: "#fff3d2", d: "#e2c58f" },
      { n: "strawberry", c: "#ff8ea6", d: "#e0587a" },
      { n: "chocolate", c: "#7a4631", d: "#4a2718" },
      { n: "mint", c: "#9fe6c7", d: "#5bb98c" },
      { n: "blueberry", c: "#8b93ff", d: "#5a5fd0" },
      { n: "mango", c: "#ffbe55", d: "#e08a1a" },
      { n: "pistachio", c: "#c3dd7e", d: "#88a93f" },
      { n: "bubblegum", c: "#ffa3ea", d: "#dd62c0" },
      { n: "cookies", c: "#e6e0d6", d: "#b3aa9c", speck: true },
      { n: "caramel", c: "#dba05c", d: "#a66a2a" }
    ];
    const SPRINKLE_COLORS = ["#ff5a7a", "#ffd23f", "#5ad1ff", "#8bf0a1", "#ffffff", "#c58bff"];

    // The cone's position is what the player controls. It follows its target
    // through a stiff critically damped spring, so a finger jump becomes a
    // bounded acceleration — and that acceleration is what the tower feels.
    const base = { x: 0, v: 0, target: 0, a: 0 };
    const BASE_W = 22;
    function xMax() { return (ctx.width / 2 - 42) / cam.s; }
    function stepBase(dt) {
      base.target = clamp(base.target, -xMax(), xMax());
      const ax = BASE_W * BASE_W * (base.target - base.x) - 2 * BASE_W * base.v;
      base.v += ax * dt;
      base.x += base.v * dt;
      base.a = clamp(ax, -9000, 9000);
    }

    // The cone spring (22 rad/s) and the jelly wobble (13 rad/s) are stiff
    // enough that a slow frame — 100 ms on a stuttering phone, every frame
    // in the headless harness — would blow explicit integration up, so the
    // body physics always runs in substeps of 16 ms or less.
    function stepBody(dt) {
      const n = Math.min(8, Math.max(1, Math.ceil(dt / 0.016)));
      const h = dt / n;
      for (let i = 0; i < n; i++) { stepBase(h); stepTower(h); }
    }

    const tower = { scoops: [], th: 0, om: 0, cx: 0, cy: 0, M: 0, h: 0, thMax: 1.2 };
    function recompute() {
      let M = 0, mx = 0, my = 0, y = 0, prevR = 0, cum = 0;
      const list = tower.scoops;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        y = i === 0 ? s.r * 0.8 : y + (prevR + s.r) * OVERLAP;
        cum += s.d;
        s.x = cum; s.y = y;
        M += s.m; mx += s.m * s.x; my += s.m * s.y;
        prevR = s.r;
      }
      tower.M = M;
      tower.cx = M ? mx / M : 0;
      tower.cy = M ? my / M : 0;
      tower.h = list.length ? y + prevR : 0;
      tower.thMax = M ? Math.atan2(SUP, Math.max(30, tower.cy)) : 1.2;
    }
    // The point a new scoop lands on: the top scoop's centre, or the cup of
    // the cone, in world coordinates, with the tower's lean applied.
    function topPoint() {
      const list = tower.scoops;
      if (!list.length) return { x: base.x, y: PIVOT_Y, r: CONE_R * 0.9, cup: true };
      const t = list[list.length - 1];
      const lx = t.x + t.w, ly = t.y;
      const c = Math.cos(tower.th), s = Math.sin(tower.th);
      return { x: base.x + lx * c + ly * s, y: PIVOT_Y + ly * c - lx * s, r: t.r, cup: false };
    }
    function stepTower(dt) {
      if (!tower.M) { tower.th *= Math.max(0, 1 - 6 * dt); tower.om = 0; return; }
      const cy = Math.max(30, tower.cy);
      // A short stack sits in the cup of the cone: the cup springs it back
      // upright and gravity barely tips it. Over the first few scoops the
      // spring fades out and the instability fades in, and the game begins.
      const grown = smooth(26, 150, cy);
      const G = GRAV * tune.topple() * (1 - 0.6 * tune.sticky()) * grown;
      const koff = tower.cx / cy;
      const c = Math.cos(tower.th), s = Math.sin(tower.th);
      // The cone's acceleration only reaches a stack that stands proud of the
      // cup; a scoop sitting in it simply comes along for the ride.
      const acc = (G / cy) * (s + koff * c) - K_CUP * (1 - grown) * tower.th - (base.a / cy) * c * grown - DAMP * tower.om;
      tower.om += acc * dt;
      tower.th += tower.om * dt;
      const h = Math.max(1, tower.h);
      for (const sc of tower.scoops) {
        const kick = -base.a * (sc.y / h) * 0.25;
        const wa = -WOB_K * sc.w - WOB_C * sc.wv + kick;
        sc.wv += wa * dt;
        sc.w = clamp(sc.w + sc.wv * dt, -10, 10);
        sc.sq += (0 - sc.sq) * Math.min(1, dt * 9);
      }
    }

    function newSpec(kind) {
      const k = KINDS[kind];
      return { kind: kind, r: k.r, m: k.m, pts: k.pts, fl: pick(FLAVORS), sprinkles: Math.random() < 0.3, drip: Math.random() < 0.55, seed: Math.random() * 1000 };
    }

    // The two dispenser arms live in screen space on the rail; the scoop they
    // let go becomes a world-space body the moment it leaves the claw.
    const arms = [
      { side: -1, x: -80, y: 0, state: "home", t: 0, dur: 0.5, hover: 0.3, from: 0, to: 0, dropX: 0, err: 0, spec: null, open: 0, len: 56 },
      { side: 1, x: 0, y: 0, state: "home", t: 0, dur: 0.5, hover: 0.3, from: 0, to: 0, dropX: 0, err: 0, spec: null, open: 0, len: 56 }
    ];
    const armHome = (a) => (a.side < 0 ? -80 : ctx.width + 80);
    const falling = [];
    const debris = [];
    let pendingDrops = 0;                  // dispatched, not yet landed or splatted

    function dispatch(a, spec, rush) {
      a.spec = spec; a.state = "in"; a.t = 0;
      a.dur = rush ? 0.32 : 0.5; a.hover = rush ? 0.18 : 0.3;
      a.from = armHome(a); a.x = a.from; a.open = 0;
      const top = topPoint();
      // Where the arm aims, relative to the tower's top: inside the catch
      // zone at the default error, outside it in a rush or late in a run.
      a.err = (Math.random() < 0.5 ? -1 : 1) * rnd(0.12, 1) * tune.error() * tune.ramp(count) * (top.r + spec.r) * (rush ? 1.45 : 1);
      pendingDrops++;
      sfx.whir(a.dur);
    }
    function clawPoint(a) { return { x: a.x, y: a.y + 18 + a.len }; }
    function releaseScoop(a) {
      const p = clawPoint(a), spec = a.spec;
      falling.push({ x: (p.x - cam.cx) / cam.s, y: (cam.floorY - p.y) / cam.s, vx: 0, vy: 0, rot: 0, vr: 0, missed: false, spec: spec, r: spec.r, m: spec.m });
      a.spec = null;
      sfx.release();
    }
    function stepArms(dt) {
      for (const a of arms) {
        a.y = cam.railY;
        if (a.state === "home") { a.x = armHome(a); continue; }
        a.t += dt;
        if (a.state === "in") {
          const top = topPoint();
          a.to = wx(top.x + a.err);                      // tracks the top during the approach
          a.x = lerp(a.from, a.to, outCubic(clamp(a.t / a.dur, 0, 1)));
          if (a.t >= a.dur) { a.state = "hover"; a.t = 0; a.dropX = a.to; }
        } else if (a.state === "hover") {
          a.x = a.dropX;                                 // ...and freezes for the drop
          if (a.t >= a.hover) { a.state = "release"; a.t = 0; releaseScoop(a); }
        } else if (a.state === "release") {
          a.open = Math.min(1, a.t / 0.15);
          if (a.t >= 0.2) { a.state = "out"; a.t = 0; a.from = a.x; a.to = armHome(a); }
        } else if (a.state === "out") {
          const k = clamp(a.t / a.dur, 0, 1);
          a.x = lerp(a.from, a.to, k * k);
          a.open = Math.max(0, 1 - a.t * 3);
          if (a.t >= a.dur) { a.state = "home"; a.spec = null; }
        }
      }
    }
    function retractArms() {
      for (const a of arms) {
        if (a.state === "home") continue;
        if (a.spec) pendingDrops = Math.max(0, pendingDrops - 1);
        a.spec = null; a.state = "out"; a.t = 0; a.from = a.x; a.to = armHome(a);
      }
    }

    function stepFalling(dt) {
      const gDrop = 1700 / cam.s;          // a constant fall time on screen, whatever the zoom
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i];
        const prevX = f.x, prevY = f.y;
        f.vy -= gDrop * dt;
        f.y += f.vy * dt; f.x += f.vx * dt; f.rot += f.vr * dt;
        if (!f.missed && state === "play") {
          // Swept: did the scoop cross the contact height during this step?
          // A slow frame can move it further than the whole contact window,
          // and a scoop must never fall through the tower.
          const top = topPoint();
          const reach = (top.r + f.r) * OVERLAP;
          const dyPrev = prevY - top.y, dy = f.y - top.y;
          if (dyPrev > reach && dy <= reach) {
            const k = (dyPrev - reach) / Math.max(1e-6, dyPrev - dy);
            const xc = prevX + (f.x - prevX) * k;
            const dx = xc - top.x;
            if (Math.abs(dx) > top.r + f.r + 6) {
              f.missed = true;                                 // clean miss: falls past the tower
            } else {
              const c = Math.cos(tower.th), s = Math.sin(tower.th);
              const e = dx * c - reach * s;                    // lateral offset in the tower's frame
              const catchR = top.cup ? CONE_R + f.r * 0.7 : (top.r + f.r) * CATCH;
              if (Math.abs(e) <= catchR) { land(f, e, catchR); falling.splice(i, 1); continue; }
              const dir = e < 0 ? -1 : 1;
              f.missed = true; f.x = xc; f.y = top.y + reach;
              f.vx = dir * rnd(150, 260); f.vy = Math.max(-f.vy * 0.25, 60); f.vr = dir * rnd(3, 6);
              tower.om += dir * 0.3 * f.m / Math.max(0.5, tower.M + f.m);
              sfx.squish();
            }
          }
        }
        if (f.y <= f.r * 0.8) { splat(f); falling.splice(i, 1); }
      }
    }

    function toppleTower() {
      const c = Math.cos(tower.th), s = Math.sin(tower.th), dir = tower.th < 0 ? -1 : 1;
      for (const sc of tower.scoops) {
        const lx = sc.x + sc.w, ly = sc.y;
        debris.push({
          x: base.x + lx * c + ly * s, y: PIVOT_Y + ly * c - lx * s,
          vx: dir * (90 + ly * 0.8) + rnd(-50, 50), vy: rnd(-10, 110) + ly * 0.12,
          rot: tower.th, vr: dir * rnd(2, 7), r: sc.r, spec: sc, bounces: 0, rest: false
        });
      }
      tower.scoops.length = 0;
      recompute();
      tower.th = 0; tower.om = 0;
    }
    function stepDebris(dt) {
      for (const d of debris) {
        if (d.rest) continue;
        d.vy -= 1500 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
        if (d.y < d.r * 0.85) {
          d.y = d.r * 0.85;
          if (d.bounces < 2 && Math.abs(d.vy) > 90) {
            d.vy = -d.vy * 0.35; d.vx *= 0.55; d.vr *= 0.5; d.bounces++;
            splatBurst(wx(d.x), wy(0), d.spec.fl, 6);
          } else {
            d.rest = true; d.vy = 0; d.vx = 0; d.vr = 0;
            splatBurst(wx(d.x), wy(0), d.spec.fl, 10);
            sfx.plop(d.spec.kind);
          }
        }
      }
    }

    // Screen-space particles and floating texts.
    const parts = [];
    const texts = [];
    function burst(x, y, n, o) {
      for (let i = 0; i < n; i++) {
        const an = rnd(0, TAU), sp = rnd(o.speed * 0.3, o.speed);
        parts.push({
          x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0),
          life: rnd(o.life * 0.6, o.life), max: o.life, size: rnd(o.size * 0.5, o.size),
          color: Array.isArray(o.color) ? pick(o.color) : o.color, kind: o.kind || "dot", g: o.g == null ? 900 : o.g,
          rot: rnd(0, TAU), vr: rnd(-8, 8)
        });
      }
      if (parts.length > 400) parts.splice(0, parts.length - 400);
    }
    function splatBurst(x, y, fl, n) { burst(x, y - 4, n, { speed: 220, up: 160, life: 0.7, size: 6, color: fl.c, kind: "dot", g: 1100 }); }
    function sparkle(x, y, n) { burst(x, y, n, { speed: 140, up: 40, life: 0.6, size: 4, color: ["#fff6c8", "#ffe07a", "#ffffff"], kind: "spark", g: 200 }); }
    function confetti() {
      for (let i = 0; i < 46; i++) {
        parts.push({
          x: rnd(0, ctx.width), y: insets.top - rnd(10, 160), vx: rnd(-60, 60), vy: rnd(40, 160),
          life: rnd(1.8, 2.8), max: 2.8, size: rnd(5, 9), color: pick(SPRINKLE_COLORS), kind: "confetti", g: 160,
          rot: rnd(0, TAU), vr: rnd(-6, 6)
        });
      }
    }
    function stepParts(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy += p.g * dt;
        if (p.kind === "confetti") { p.vx += Math.sin(clock * 6 + p.rot) * 40 * dt; p.vy = Math.min(p.vy, 190); }
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      }
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.t += dt;
        if (t.t >= t.life) texts.splice(i, 1);
      }
    }
    function floatText(x, y, text, color, size) {
      texts.push({ x: x, y: y, text: text, color: color || "#fff", size: size || 22, t: 0, life: 1.1 });
    }

    // The camera: zoom out so the whole tower plus a scoop of air fits
    // between the claw and the deck.
    function stepCamera(dt) {
      const needed = PIVOT_Y + tower.h + 90;
      const room = cam.floorY - (cam.clawY + 60);
      cam.target = clamp(room / Math.max(1, needed), 0.24, 1);
      cam.s += (cam.target - cam.s) * Math.min(1, dt * 2.5);
    }

    // Scenery that drifts: clouds, each a cluster of discs.
    const clouds = [];
    for (let i = 0; i < 7; i++) {
      clouds.push({ u: Math.random(), v: 0.06 + Math.random() * 0.34, sc: rnd(0.6, 1.3), sp: rnd(4, 11), puffs: [[0, 0, 26], [-24, 6, 18], [24, 8, 20], [8, -10, 16], [-10, -8, 14]] });
    }
    function stepClouds(dt) { for (const c of clouds) { c.u += c.sp * dt / Math.max(1, ctx.width); if (c.u > 1.25) c.u -= 1.5; } }
    // Deterministic skyline, so it never shimmers between frames.
    const skyline = [];
    (function () {
      let x = 0, seed = 7;
      const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      while (x < 1.4) {
        const w = 0.05 + r() * 0.08, h = 0.08 + r() * 0.22;
        const wins = [];
        for (let k = 0; k < 14; k++) wins.push(r() < 0.55 ? 1 : 0);
        skyline.push({ x: x, w: w, h: h, far: r() < 0.45, cap: r() < 0.3, wins: wins });
        x += w + 0.005 + r() * 0.02;
      }
    })();
    const stars = [];
    (function () { let seed = 3; const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; for (let i = 0; i < 70; i++) stars.push([r(), r() * 0.55, 0.6 + r() * 1.4, r() * TAU]); })();

    // ===================================================================== //
    // 6. Drawing                                                            //
    // ===================================================================== //
    // Palette parts that are plain fills. The sky gradients live in skyFill(),
    // written out per palette with literal stops.
    const SKIES = {
      sunset: { sun: "#fff1b8", sil: "#3b2552", sil2: "#5c3d75", win: "#ffd27a", winA: 0.75, cloud: "rgba(255,226,236,0.82)", deck: "#7c4e36", deck2: "#5a3626", plank: "rgba(40,15,10,0.22)", night: false },
      mint: { sun: "#fff9d0", sil: "#0f4a52", sil2: "#20666e", win: "#dffcf0", winA: 0.3, cloud: "rgba(255,255,255,0.88)", deck: "#5b8a85", deck2: "#3f6a66", plank: "rgba(10,40,40,0.2)", night: false },
      midnight: { sun: "#f4f1d8", sil: "#070a22", sil2: "#131b42", win: "#ffe9a3", winA: 0.9, cloud: "rgba(120,130,190,0.4)", deck: "#2d2b4e", deck2: "#1c1a36", plank: "rgba(0,0,20,0.3)", night: true },
      candy: { sun: "#fffbe0", sil: "#b7488f", sil2: "#cf66aa", win: "#fff0f8", winA: 0.35, cloud: "rgba(255,255,255,0.92)", deck: "#c06aa0", deck2: "#9a4f80", plank: "rgba(80,20,60,0.2)", night: false }
    };
    let skyName = String(tune.sky());
    let pal = SKIES[skyName] || SKIES.sunset;
    let skyGrad = null, skyGradKey = "";
    function skyFill() {
      const key = skyName + ":" + ctx.height;
      if (skyGrad && skyGradKey === key) return skyGrad;
      const gr = g.createLinearGradient(0, 0, 0, ctx.height * 0.62);
      if (skyName === "mint") {
        gr.addColorStop(0, "#0b3a4a"); gr.addColorStop(0.5, "#2f8f93"); gr.addColorStop(0.85, "#8fd8c8"); gr.addColorStop(1, "#eafff6");
      } else if (skyName === "midnight") {
        gr.addColorStop(0, "#05081a"); gr.addColorStop(0.55, "#141f4d"); gr.addColorStop(0.88, "#2d3b7a"); gr.addColorStop(1, "#4c5aa8");
      } else if (skyName === "candy") {
        gr.addColorStop(0, "#ff7fc3"); gr.addColorStop(0.5, "#ffa9d9"); gr.addColorStop(0.85, "#ffd4ec"); gr.addColorStop(1, "#fff3c4");
      } else {
        gr.addColorStop(0, "#2a1a4e"); gr.addColorStop(0.45, "#b35b8e"); gr.addColorStop(0.82, "#ff9a6a"); gr.addColorStop(1, "#ffd79a");
      }
      skyGrad = gr; skyGradKey = key;
      return gr;
    }
    // Unit-space gradients, reused under a transform: the gloss and the shade
    // that turn a flat flavour colour into a sphere, a sun glow, chrome.
    let glossGrad = null, shadeGrad = null, sunGrad = null, chromeGrad = null, vigGrad = null, warnGrad = null;
    function unitGrads() {
      if (glossGrad) return;
      glossGrad = g.createRadialGradient(-0.38, -0.42, 0.02, -0.2, -0.2, 1.1);
      glossGrad.addColorStop(0, "rgba(255,255,255,0.78)"); glossGrad.addColorStop(0.35, "rgba(255,255,255,0.16)"); glossGrad.addColorStop(1, "rgba(255,255,255,0)");
      shadeGrad = g.createRadialGradient(0.12, 0.12, 0.3, 0, 0, 1.25);
      shadeGrad.addColorStop(0, "rgba(40,10,30,0)"); shadeGrad.addColorStop(0.7, "rgba(40,10,30,0.1)"); shadeGrad.addColorStop(1, "rgba(40,10,30,0.45)");
      sunGrad = g.createRadialGradient(0, 0, 0.2, 0, 0, 1);
      sunGrad.addColorStop(0, "rgba(255,245,200,0.55)"); sunGrad.addColorStop(0.5, "rgba(255,230,170,0.18)"); sunGrad.addColorStop(1, "rgba(255,230,170,0)");
      chromeGrad = g.createLinearGradient(0, 0, 0, 1);
      chromeGrad.addColorStop(0, "#f7f9fc"); chromeGrad.addColorStop(0.42, "#c7cfd9"); chromeGrad.addColorStop(0.5, "#8d98a7"); chromeGrad.addColorStop(1, "#dfe5ec");
      vigGrad = g.createRadialGradient(0, 0, 0.45, 0, 0, 1);
      vigGrad.addColorStop(0, "rgba(20,5,30,0)"); vigGrad.addColorStop(1, "rgba(20,5,30,0.5)");
      warnGrad = g.createRadialGradient(0, 0, 0.35, 0, 0, 1);
      warnGrad.addColorStop(0, "rgba(255,40,80,0)"); warnGrad.addColorStop(1, "rgba(255,40,80,0.75)");
    }
    function rrect(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
    }
    function disc(x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    // Fill the current clip/rect with a unit vertical gradient stretched over (x, y, w, h).
    function fillVertical(grad, x, y, w, h) {
      g.save(); g.translate(x, y); g.scale(1, Math.max(1e-3, h)); g.fillStyle = grad; g.fillRect(0, 0, w, 1); g.restore();
    }
    function seeded(seed) {
      let s = ((seed * 1000) | 0) % 233280;
      return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    }

    function drawBackground() {
      const W = ctx.width, H = ctx.height;
      unitGrads();
      g.fillStyle = skyFill();
      g.fillRect(0, 0, W, H);
      const horizon = H * 0.58;
      // sun or moon
      const sx = W * 0.74, sy = H * 0.24;
      g.save(); g.translate(sx, sy); g.scale(150, 150); g.fillStyle = sunGrad; g.fillRect(-1, -1, 2, 2); g.restore();
      g.fillStyle = pal.sun;
      disc(sx, sy, pal.night ? 30 : 38);
      if (pal.night) {
        g.fillStyle = "#0d1436"; disc(sx + 13, sy - 6, 26);
        for (const st of stars) {
          g.globalAlpha = 0.45 + 0.45 * Math.sin(clock * 1.7 + st[3]);
          g.fillStyle = "#fff8e0"; disc(st[0] * W, st[1] * H, st[2]);
        }
        g.globalAlpha = 1;
      }
      // clouds
      g.fillStyle = pal.cloud;
      for (const c of clouds) {
        const cx = c.u * W * 1.5 - W * 0.25, cy = c.v * H;
        for (const p of c.puffs) disc(cx + p[0] * c.sc, cy + p[1] * c.sc, p[2] * c.sc);
      }
      // skyline, two depths, standing on the horizon and hidden by the parapet
      const deckTop = cam.floorY - 6;
      for (let layer = 0; layer < 2; layer++) {
        g.fillStyle = layer === 0 ? pal.sil2 : pal.sil;
        for (const b of skyline) {
          if ((layer === 0) !== b.far) continue;
          const bx = (b.x - 0.1) * W, bw = b.w * W, bh = b.h * H * (layer === 0 ? 1.15 : 1);
          g.fillRect(bx, horizon - bh, bw, bh + (deckTop - horizon));
          if (b.cap) g.fillRect(bx + bw * 0.4, horizon - bh - 14, 3, 14);
        }
      }
      if (pal.winA > 0) {
        g.fillStyle = pal.win;
        for (const b of skyline) {
          if (b.far) continue;
          const bx = (b.x - 0.1) * W, bw = b.w * W, bh = b.h * H;
          const cols = Math.max(1, Math.floor(bw / 11)), rows = Math.max(1, Math.floor(bh / 16));
          let k = 0;
          for (let r = 0; r < rows && r < 6; r++) for (let c = 0; c < cols && c < 5; c++, k++) {
            if (!b.wins[k % b.wins.length]) continue;
            g.globalAlpha = pal.winA * (0.55 + 0.45 * ((k * 7 + r) % 3) / 2);
            g.fillRect(bx + 4 + c * 11, horizon - bh + 6 + r * 16, 5, 7);
          }
        }
        g.globalAlpha = 1;
      }
      // the rooftop: parapet, then the deck, both edge to edge and under the logo
      g.fillStyle = pal.deck2;
      g.fillRect(0, deckTop - 34, W, 34);
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.fillRect(0, deckTop - 34, W, 3);
      g.fillStyle = pal.plank;
      for (let x = -20; x < W; x += 46) g.fillRect(x, deckTop - 31, 2, 14);
      for (let x = 3; x < W; x += 46) g.fillRect(x, deckTop - 17, 2, 14);
      g.fillStyle = pal.deck;
      g.fillRect(0, deckTop, W, H - deckTop);
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.fillRect(0, deckTop, W, 2);
      g.fillStyle = pal.plank;
      for (let y = deckTop + 16; y < H; y += 15) g.fillRect(0, y, W, 2);
      for (let y = deckTop + 16, k = 0; y < H; y += 15, k++) {
        for (let x = (k % 2) * 70 - 30; x < W; x += 140) g.fillRect(x, y - 15, 2, 15);
      }
    }

    function drawRail() {
      const W = ctx.width, y = cam.railY;
      unitGrads();
      g.fillStyle = "#2b2233";
      g.fillRect(0, y - 6, W, 12);
      g.save(); g.beginPath(); g.rect(0, y - 6, W, 5); g.clip(); fillVertical(chromeGrad, 0, y - 6, W, 5); g.restore();
      g.fillStyle = "#15101c";
      for (let x = 14; x < W; x += 38) disc(x, y + 2, 2);
      // end brackets
      g.fillStyle = "#3a2e45";
      g.fillRect(0, y - 14, 14, 28); g.fillRect(W - 14, y - 14, 14, 28);
      // the maker's plate, hanging under the rail
      rrect(W / 2 - 66, y + 8, 132, 20, 6);
      g.fillStyle = "#3a2e45"; g.fill();
      g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1; g.stroke();
      g.fillStyle = "#ffd27a";
      g.font = "400 13px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("S C O O P · O · M A T I C", W / 2, y + 18.5);
    }

    function drawArm(a) {
      if (a.state === "home") return;
      unitGrads();
      const x = a.x, y = a.y;
      const cp = clawPoint(a);
      const rs = (a.spec ? a.spec.r : 26) * cam.s;
      // piston
      g.save(); rrect(x - 6, y + 10, 12, a.len + 8, 3); g.clip(); fillVertical(chromeGrad, x - 6, y + 10, 12, a.len + 8); g.restore();
      g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x - 1, y + 10, 2, a.len + 8);
      // carriage on the rail
      g.save(); rrect(x - 24, y - 9, 48, 28, 8); g.clip(); fillVertical(chromeGrad, x - 24, y - 9, 48, 28); g.restore();
      rrect(x - 24, y - 9, 48, 28, 8); g.strokeStyle = "rgba(20,10,30,0.45)"; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = "#2b2233"; disc(x - 13, y - 9, 5); disc(x + 13, y - 9, 5);
      g.fillStyle = "#ffd27a"; disc(x, y + 5, 4);
      // the held scoop, between the fingers
      if (a.spec && (a.state === "in" || a.state === "hover")) drawScoopAt(cp.x, cp.y, rs, a.spec, 0, 1, 1, false);
      // claw hub and two fingers that swing open on release
      g.fillStyle = "#3a2e45"; disc(x, cp.y - rs * 0.95 - 4, 9);
      for (let sd = -1; sd <= 1; sd += 2) {
        g.save();
        g.translate(x, cp.y - rs * 0.95 - 4);
        g.rotate(sd * a.open * 1.1);
        g.strokeStyle = "#cfd6df"; g.lineWidth = 6; g.lineCap = "round";
        g.beginPath();
        g.moveTo(sd * 6, 0);
        g.quadraticCurveTo(sd * (rs + 10), rs * 0.45, sd * (rs * 0.75), rs * 1.15);
        g.stroke();
        g.strokeStyle = "#3a2e45"; g.lineWidth = 2;
        g.beginPath();
        g.moveTo(sd * 6, 0);
        g.quadraticCurveTo(sd * (rs + 10), rs * 0.45, sd * (rs * 0.75), rs * 1.15);
        g.stroke();
        g.restore();
      }
    }

    function scoopPath() {
      g.beginPath();
      g.arc(0, 0, 1, 0, TAU);
      g.moveTo(-0.12, 0.5); g.arc(-0.52, 0.5, 0.4, 0, TAU);
      g.moveTo(0.54, 0.62); g.arc(0.12, 0.62, 0.42, 0, TAU);
      g.moveTo(1, 0.38); g.arc(0.62, 0.38, 0.38, 0, TAU);
    }
    function drawCherry() {
      g.strokeStyle = "#4b7d2f"; g.lineWidth = 0.07; g.lineCap = "round";
      g.beginPath(); g.moveTo(0.1, -0.98); g.quadraticCurveTo(0.08, -1.3, 0.34, -1.36); g.stroke();
      g.fillStyle = "#e8293f"; disc(0.12, -0.98, 0.27);
      g.fillStyle = "rgba(255,255,255,0.75)"; g.beginPath(); g.ellipse(0.03, -1.07, 0.09, 0.05, -0.6, 0, TAU); g.fill();
    }
    // One scoop, at screen (sx, sy) with on-screen radius rs. The body is a
    // flat flavour fill; the sphere comes from the two unit gradients.
    function drawScoopAt(sx, sy, rs, spec, rot, sqx, sqy, cherry) {
      unitGrads();
      const fl = spec.fl;
      g.save();
      g.translate(sx, sy);
      if (rot) g.rotate(rot);
      g.scale(rs * (sqx || 1), rs * (sqy || 1));
      if (spec.drip) {
        g.strokeStyle = fl.c; g.lineCap = "round";
        g.lineWidth = 0.24; g.beginPath(); g.moveTo(-0.34, 0.5); g.lineTo(-0.34, 1.02); g.stroke();
        g.lineWidth = 0.17; g.beginPath(); g.moveTo(0.4, 0.55); g.lineTo(0.4, 0.9); g.stroke();
        g.fillStyle = fl.d; g.globalAlpha = 0.35; disc(-0.34, 1.02, 0.12); g.globalAlpha = 1;
      }
      scoopPath(); g.fillStyle = fl.c; g.fill();
      g.save();
      scoopPath(); g.clip();
      g.fillStyle = shadeGrad; g.fillRect(-1.4, -1.4, 2.8, 2.8);
      g.fillStyle = glossGrad; g.fillRect(-1.4, -1.4, 2.8, 2.8);
      const r = seeded(spec.seed || 1);
      if (fl.speck) {
        g.fillStyle = "rgba(60,35,25,0.8)";
        for (let i = 0; i < 11; i++) { const an = r() * TAU, ro = r() * 0.85; disc(Math.cos(an) * ro, Math.sin(an) * ro, 0.045 + r() * 0.05); }
      }
      if (spec.sprinkles) {
        g.lineCap = "round"; g.lineWidth = 0.085;
        for (let i = 0; i < 9; i++) {
          const an = r() * TAU, ro = 0.2 + r() * 0.62, px = Math.cos(an) * ro, py = Math.sin(an) * ro - 0.12;
          if (py > 0.4) continue;
          const d = r() * Math.PI;
          g.strokeStyle = SPRINKLE_COLORS[i % SPRINKLE_COLORS.length];
          g.beginPath(); g.moveTo(px - Math.cos(d) * 0.12, py - Math.sin(d) * 0.12); g.lineTo(px + Math.cos(d) * 0.12, py + Math.sin(d) * 0.12); g.stroke();
        }
      }
      g.restore();
      scoopPath(); g.lineWidth = 0.05; g.strokeStyle = "rgba(60,20,40,0.2)"; g.stroke();
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath(); g.ellipse(-0.42, -0.5, 0.2, 0.11, -0.55, 0, TAU); g.fill();
      if (cherry) drawCherry();
      g.restore();
    }

    function drawMan() {
      g.save();
      g.translate(wx(base.x), cam.floorY);
      g.scale(cam.s, cam.s);
      g.fillStyle = "rgba(20,10,30,0.22)";
      g.beginPath(); g.ellipse(0, 4, 44, 8, 0, 0, TAU); g.fill();
      g.rotate(man.lean);
      const lo = Math.sin(man.walk) * 5 * man.walkAmt, ro = -lo;
      g.fillStyle = "#3b2a4a";
      rrect(-19 + lo, -48, 14, 46, 6); g.fill();
      rrect(5 + ro, -48, 14, 46, 6); g.fill();
      g.fillStyle = "#5b2d2a";
      rrect(-25 + lo, -10, 22, 11, 5); g.fill();
      rrect(3 + ro, -10, 22, 11, 5); g.fill();
      // shirt with stripes, apron over it
      rrect(-30, -104, 60, 62, 16); g.fillStyle = "#ffffff"; g.fill();
      g.save(); rrect(-30, -104, 60, 62, 16); g.clip();
      g.fillStyle = "#ff8ea6";
      for (let x = -30; x < 30; x += 12) g.fillRect(x, -104, 6, 62);
      g.restore();
      g.fillStyle = "#fff6ea";
      g.beginPath(); g.moveTo(-22, -96); g.lineTo(22, -96); g.lineTo(26, -44); g.lineTo(-26, -44); g.closePath(); g.fill();
      g.strokeStyle = "rgba(90,50,80,0.25)"; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = "#ffd3e0"; rrect(-9, -70, 18, 13, 3); g.fill();
      g.fillStyle = "#e8293f";
      g.beginPath(); g.moveTo(0, -100); g.lineTo(-10, -106); g.lineTo(-10, -94); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(0, -100); g.lineTo(10, -106); g.lineTo(10, -94); g.closePath(); g.fill();
      // arms up to the cone
      g.strokeStyle = "#f6c89f"; g.lineWidth = 11; g.lineCap = "round";
      g.beginPath(); g.moveTo(-26, -92); g.quadraticCurveTo(-42, -118, -13, -MAN_H + 2); g.stroke();
      g.beginPath(); g.moveTo(26, -92); g.quadraticCurveTo(42, -118, 13, -MAN_H + 2); g.stroke();
      g.fillStyle = "#ff8ea6"; disc(-27, -94, 9); disc(27, -94, 9);
      g.fillStyle = "#f6c89f"; disc(-12, -MAN_H + 3, 8); disc(12, -MAN_H + 3, 8);
      // head, lagging the body a touch
      g.save();
      g.translate(man.headX, 0);
      g.fillStyle = "#f6c89f"; disc(0, -126, 24); disc(-23, -126, 5); disc(23, -126, 5);
      g.fillStyle = "#ffffff";
      g.beginPath(); g.moveTo(-24, -142); g.lineTo(24, -142); g.lineTo(18, -167); g.lineTo(-18, -167); g.closePath(); g.fill();
      g.strokeStyle = "rgba(90,50,80,0.25)"; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = "#e8293f"; g.fillRect(-24, -147, 48, 5);
      g.fillStyle = "rgba(255,120,150,0.35)";
      g.beginPath(); g.ellipse(-14, -118, 5, 3, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(14, -118, 5, 3, 0, 0, TAU); g.fill();
      const wide = man.mood === "panic" || man.mood === "dismay" ? 1.3 : 1;
      const ex = clamp(man.lookX, -2.5, 2.5), ey = clamp(man.lookY, -2.2, 1.5);
      g.fillStyle = "#fff";
      g.beginPath(); g.ellipse(-8, -128, 5.5 * wide, 6.5 * wide, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(8, -128, 5.5 * wide, 6.5 * wide, 0, 0, TAU); g.fill();
      g.fillStyle = "#2b1d3a"; disc(-8 + ex, -128 + ey, 2.7); disc(8 + ex, -128 + ey, 2.7);
      const m = man.mood;
      const browUp = m === "panic" || m === "dismay" ? -5 : m === "focused" ? -1 : m === "joy" ? -3 : 0;
      const browTilt = m === "focused" ? 2.5 : m === "panic" || m === "dismay" ? -3 : 0;
      g.strokeStyle = "#5a3a2a"; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(-13, -137 + browUp + browTilt); g.lineTo(-4, -137 + browUp - browTilt); g.stroke();
      g.beginPath(); g.moveTo(4, -137 + browUp - browTilt); g.lineTo(13, -137 + browUp + browTilt); g.stroke();
      g.strokeStyle = "#6b2a3a"; g.fillStyle = "#6b2a3a"; g.lineWidth = 2.2;
      if (m === "panic" || m === "dismay") { g.beginPath(); g.ellipse(0, -113, 5, 6.5, 0, 0, TAU); g.fill(); }
      else if (m === "joy") { g.beginPath(); g.arc(0, -117, 7, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
      else if (m === "focused") { g.beginPath(); g.moveTo(-5, -114); g.lineTo(5, -114); g.stroke(); }
      else { g.beginPath(); g.arc(0, -117, 5, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); }
      g.restore();
      g.restore();
    }

    function drawCone() {
      g.save();
      g.translate(wx(base.x), cam.floorY);
      g.scale(cam.s, cam.s);
      g.beginPath(); g.moveTo(-CONE_R, -PIVOT_Y + 4); g.lineTo(0, -MAN_H + 2); g.lineTo(CONE_R, -PIVOT_Y + 4); g.closePath();
      g.fillStyle = "#e4a463"; g.fill();
      g.save(); g.clip();
      g.strokeStyle = "rgba(120,60,20,0.5)"; g.lineWidth = 2;
      for (let i = -4; i <= 4; i++) {
        g.beginPath(); g.moveTo(-CONE_R + i * 14, -PIVOT_Y); g.lineTo(-CONE_R + i * 14 + 44, -MAN_H); g.stroke();
        g.beginPath(); g.moveTo(CONE_R - i * 14, -PIVOT_Y); g.lineTo(CONE_R - i * 14 - 44, -MAN_H); g.stroke();
      }
      g.restore();
      // The current path is not part of the saved state, so rebuild the
      // cone before outlining it, or the outline is the last waffle line.
      g.beginPath(); g.moveTo(-CONE_R, -PIVOT_Y + 4); g.lineTo(0, -MAN_H + 2); g.lineTo(CONE_R, -PIVOT_Y + 4); g.closePath();
      g.strokeStyle = "#b36f35"; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
      g.beginPath(); g.ellipse(0, -PIVOT_Y + 4, CONE_R, 6, 0, 0, TAU);
      g.fillStyle = "#f0b872"; g.fill(); g.strokeStyle = "#b36f35"; g.stroke();
      g.restore();
    }

    function drawTower() {
      const list = tower.scoops;
      if (!list.length) return;
      g.save();
      g.translate(wx(base.x), wy(PIVOT_Y));
      g.rotate(tower.th);
      g.scale(cam.s, cam.s);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        drawScoopAt(s.x + s.w, -s.y, s.r, s, 0, 1 + s.sq * 0.6, 1 - s.sq, i === list.length - 1);
      }
      g.restore();
    }

    function drawGuide() {
      if (state !== "play") return;
      const top = topPoint();
      const tx = wx(top.x), ty = wy(top.y);
      let r = 0;
      for (const a of arms) {
        if (a.state !== "hover" && a.state !== "release") continue;
        const cp = clawPoint(a), rs = (a.spec ? a.spec.r : 26) * cam.s;
        r = Math.max(r, (top.r + (a.spec ? a.spec.r : 26)) * CATCH * cam.s);
        g.fillStyle = "rgba(255,255,255,0.6)";
        for (let y = cp.y + rs + 6; y < ty - 14; y += 11) g.fillRect(a.dropX - 1, y, 2, 5);
      }
      for (const f of falling) if (!f.missed) r = Math.max(r, (top.r + f.r) * CATCH * cam.s);
      if (r > 0) {
        g.beginPath(); g.ellipse(tx, ty - top.r * cam.s * 0.15, r, r * 0.34, 0, 0, TAU);
        g.fillStyle = "rgba(255,255,255,0.18)"; g.fill();
        g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 2; g.stroke();
      }
    }

    function drawParts() {
      for (const p of parts) {
        const a = clamp(p.life / (p.max * 0.5), 0, 1);
        g.globalAlpha = a;
        g.fillStyle = p.color;
        if (p.kind === "confetti") {
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66); g.restore();
        } else if (p.kind === "spark") {
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
          g.fillRect(-p.size, -p.size * 0.22, p.size * 2, p.size * 0.44); g.fillRect(-p.size * 0.22, -p.size, p.size * 0.44, p.size * 2);
          g.restore();
        } else {
          disc(p.x, p.y, p.size * (0.5 + 0.5 * a));
        }
      }
      g.globalAlpha = 1;
    }
    function drawTexts() {
      g.textAlign = "center"; g.textBaseline = "middle";
      for (const t of texts) {
        const k = t.t / t.life;
        g.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        const y = t.y - k * 44, sc = 1 + 0.25 * Math.max(0, 1 - t.t * 6);
        g.font = "400 " + Math.round(t.size * sc) + "px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
        g.lineWidth = 4; g.strokeStyle = "rgba(40,15,45,0.55)"; g.strokeText(t.text, t.x, y);
        g.fillStyle = t.color; g.fillText(t.text, t.x, y);
      }
      g.globalAlpha = 1;
    }
    function drawVignette() {
      const W = ctx.width, H = ctx.height;
      g.save();
      g.translate(W / 2, H / 2); g.scale(W * 0.72, H * 0.72);
      g.fillStyle = vigGrad; g.fillRect(-1, -1, 2, 2);
      const q = tower.M ? Math.abs(tower.th) / tower.thMax : 0;
      if (q > 0.5 && state === "play") {
        g.globalAlpha = smooth(0.5, 1, q) * (0.6 + 0.3 * Math.sin(clock * 16));
        g.fillStyle = warnGrad; g.fillRect(-1, -1, 2, 2);
      }
      g.restore();
    }

    function draw() {
      g.save();
      drawBackground();
      const sh = shake * shake;
      if (sh > 0) g.translate(rnd(-1, 1) * sh * 7, rnd(-1, 1) * sh * 5);
      drawRail();
      for (const a of arms) drawArm(a);
      drawMan();
      drawCone();
      drawTower();
      drawGuide();
      for (const f of falling) drawScoopAt(wx(f.x), wy(f.y), f.r * cam.s, f.spec, f.rot, 1, 1, false);
      for (const d of debris) drawScoopAt(wx(d.x), wy(d.y), d.r * cam.s, d.spec, d.rot, d.rest ? 1.22 : 1, d.rest ? 0.74 : 1, false);
      g.restore();
      drawParts();
      drawTexts();
      drawVignette();
    }

    // ===================================================================== //
    // 7. The game                                                           //
    // ===================================================================== //
    let state = "title";                   // title | play | spilled | topple | result | paused
    let stateT = 0, clock = 0, shake = 0;
    let runId = 0;
    let count = 0, points = 0, mult = 1, hearts = 3, cleanRun = 0;
    let rushState = "none", rushT = 0, rushLeft = 0, lastRushAt = 0, miniLeft = 0, lastArm = 1;
    let dropTimer = 0, nextDrop = 1.4;
    let endTimer = 0, warned = false;
    let control = "touch";
    let hintTimer = 0, hintLandings = 0;
    const man = { mood: "calm", moodT: 0, lean: 0, walk: 0, walkAmt: 0, headX: 0, lookX: 0, lookY: 0 };
    const save = { best: 0, bestTower: 0, plays: 0, control: "touch", muted: false };

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
    // Restart a CSS animation: drop the class, re-add it a frame later.
    function replay(node) { node.classList.remove("on"); ctx.timeout(() => { if (!disposed) node.classList.add("on"); }, 20); }
    function toast(big, small) { el.toastb.textContent = big; el.toasts.textContent = small || ""; replay(el.toast); }
    function banner(big, small) { el.bannerb.textContent = big; el.banners.textContent = small || ""; replay(el.banner); }
    function showHint(text, finger, secs) {
      el.hintt.textContent = text;
      el.finger.classList.toggle("on", !!finger);
      el.hint.style.opacity = "1";
      hintTimer = secs || 7;
    }
    function hideHint() { el.hint.style.opacity = "0"; hintTimer = 0; }
    function setMood(m, hold) { man.mood = m; man.moodT = hold; }

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
      el.ctrlc.style.display = ctx.capabilities.motion ? "" : "none";
      el.cbest.textContent = save.best ? "Best " + fmt(save.best) + " pts · tallest " + save.bestTower : "";
      el.cnote.textContent = control === "tilt" ? "Hold the phone upright. It levels itself when you press Play." : (ctx.capabilities.motion ? "Drag anywhere to walk. Or switch to tilt." : "Drag anywhere to walk the cone.");
    }

    // ---- persistence --------------------------------------------------------
    const SAVE_KEY = "tall-order";
    function persist() {
      if (!ctx.capabilities.storage) return;
      fireAndForget(() => ctx.storage.set(SAVE_KEY, { best: save.best, bestTower: save.bestTower, plays: save.plays, control: control, muted: muted }));
    }
    function load() {
      if (!ctx.capabilities.storage) return;
      try {
        const s = ctx.storage.get(SAVE_KEY);
        if (!s || typeof s !== "object") return;
        if (typeof s.best === "number" && s.best >= 0) save.best = Math.floor(s.best);
        if (typeof s.bestTower === "number" && s.bestTower >= 0) save.bestTower = Math.floor(s.bestTower);
        if (typeof s.plays === "number" && s.plays >= 0) save.plays = Math.floor(s.plays);
        if (s.control === "tilt" && ctx.capabilities.motion) control = "tilt";
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
    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

    // ---- tilt ---------------------------------------------------------------
    let tiltCtl = null, tiltOn = false;
    async function tiltBegin() {
      if (!ctx.capabilities.motion) { control = "touch"; refreshChips(); return; }
      try {
        await ctx.motion.start({ smoothing: 0.25 });
        if (disposed) return;
        if (!tiltCtl) tiltCtl = ctx.motion.tiltControl({ maxAngle: 24, deadzone: 0.06, smoothing: 0.3, calibrate: true });
        try { ctx.motion.calibrate(); } catch (_) { /* fine */ }
        tiltOn = true;
      } catch (_) {
        tiltOn = false; control = "touch"; refreshChips();
        showHint("Tilt isn't available here — drag instead", true, 5);
      }
    }
    function tiltEnd() {
      if (!tiltOn) return;
      tiltOn = false;
      try { ctx.motion.stop(); } catch (_) { /* fine */ }
    }

    // ---- flow ---------------------------------------------------------------
    function clearWorld() {
      tower.scoops.length = 0; recompute(); tower.th = 0; tower.om = 0;
      falling.length = 0; debris.length = 0; parts.length = 0; texts.length = 0;
      for (const a of arms) { a.state = "home"; a.spec = null; a.open = 0; }
      pendingDrops = 0;
      base.x = 0; base.v = 0; base.target = 0; base.a = 0;
    }
    function startRun() {
      runId++;
      clearWorld();
      state = "play"; stateT = 0;
      hearts = 3; count = 0; points = 0; mult = 1; cleanRun = 0;
      rushState = "none"; rushLeft = 0; lastRushAt = 0; miniLeft = 0; lastArm = 1;
      dropTimer = 0; nextDrop = 1.3; endTimer = 0; warned = false; hintLandings = 0;
      if (scoreTrack) { try { scoreTrack.reset(); towerTrack.reset(); } catch (_) { /* fine */ } }
      hudScore(); hudHearts();
      el.hud.classList.add("on");
      el.curtain.style.opacity = "0"; el.curtain.style.pointerEvents = "none";
      hideCard();
      ctx.platform.start({ control: control });
      if (control === "tilt") fireAndForget(() => tiltBegin()); else tiltEnd();
      audioInit(); resumeAudio();
      fireAndForget(() => musicStart());
      musicSet({ intensity: tune.music(), tempo: 96 });
      setMood("calm", 0);
      if (save.plays === 0) showHint(control === "tilt" ? "Tilt to keep the tower under the scoop" : "Drag left and right to balance the tower", control !== "tilt", 8);
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
        '<div class="to-chips"><div class="to-chip" data-act="control">' + (control === "tilt" ? "Tilt" : "Touch") + '</div><div class="to-chip" data-act="mute">' + (muted ? "Sound off" : "Sound on") + "</div></div>" +
        '<div class="to-btn g" data-act="menu">Menu</div>');
      if (!ctx.capabilities.motion) { const c = el.card.querySelector('[data-act="control"]'); if (c) c.style.display = "none"; }
    }
    function resumeGame() {
      if (state !== "paused") return;
      hideCard();
      state = "play";
      try { if (tiltOn) ctx.motion.resume(); } catch (_) { /* fine */ }
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
      confetti(); sfx.milestone(); musicSting("success"); haptic("success"); setMood("joy", 1.5);
      try { ctx.platform.milestone("scoops_" + count, { score: points }); } catch (_) { /* fine */ }
      hudScore();
    }
    function land(f, e, catchR) {
      const spec = f.spec;
      pendingDrops = Math.max(0, pendingDrops - 1);
      const sc = { r: spec.r, m: spec.m, kind: spec.kind, pts: spec.pts, fl: spec.fl, d: e * 0.5, x: 0, y: 0, w: 0, wv: 0, sq: 0, sprinkles: spec.sprinkles, drip: spec.drip, seed: spec.seed };
      tower.scoops.push(sc);
      recompute();
      tower.om += clamp(e * sc.m / (Math.max(0.5, tower.M) * Math.max(30, tower.cy)) * K_IMP, -0.5, 0.5);
      const n = tower.scoops.length;
      for (let i = n - 1, d = 0; i >= 0 && d < 5; i--, d++) {
        const s = tower.scoops[i];
        s.wv += e * 0.7 * Math.pow(0.55, d);
        s.sq = Math.max(s.sq, 0.17 * Math.pow(0.7, d));
      }
      count++;
      const clean = Math.abs(e) < catchR * 0.3 && Math.abs(tower.th) < tower.thMax * 0.35;
      const tp = topPoint();
      const sx = wx(tp.x), sy = wy(tp.y) - spec.r * cam.s - 12;
      if (clean) { cleanRun++; mult = Math.min(8, 1 + Math.floor(cleanRun / 2)); }
      else { if (mult > 1) floatText(sx, sy - 26, "WOBBLY", "#ffd3e0", 20); cleanRun = 0; mult = 1; }
      const pts = spec.pts * mult * (rushState === "rush" || rushState === "cool" ? 2 : 1);
      points += pts;
      if (scoreTrack) { try { scoreTrack.add(pts); towerTrack.set(count); } catch (_) { /* fine */ } }
      floatText(sx, sy, "+" + fmt(pts), clean ? "#fff6c8" : "#ffffff", clean ? 26 : 22);
      if (clean && mult > 1) floatText(sx, sy - 28, "CLEAN ×" + mult, "#ffe07a", 20);
      if (clean) sparkle(sx, sy + 14, 10);
      if (spec.kind === "big") { shake = Math.max(shake, 0.6); floatText(sx + 48, sy + 8, "BIG!", "#ffb0c8", 24); haptic("medium"); }
      else haptic("light");
      sfx.plop(spec.kind);
      if (clean) sfx.clean(mult);
      hudScore();
      ctx.platform.interact({ type: "scoop", count: count, clean: clean });
      hintLandings++;
      if (hintLandings === 1 && save.plays === 0) showHint("Keep the tower under the next scoop", false, 6);
      if (hintLandings >= 3) hideHint();
      if (count % 10 === 0) milestone();
      if (rushState === "none" && count % tune.rushEvery() === 0 && count !== lastRushAt) startRushWarning();
      else if (rushState === "cool" && pendingDrops === 0) endRush();
      if (count % 5 === 0) musicSet({ intensity: clamp(tune.music() + count / 80, 0, 1), tempo: 96 + Math.min(44, count * 1.1) });
    }
    function splat(f) {
      splatBurst(wx(f.x), wy(0), f.spec.fl, 14);
      pendingDrops = Math.max(0, pendingDrops - 1);
      if (state !== "play") return;
      sfx.miss(); sfx.heart(); haptic("error");
      hearts--; hudHearts();
      cleanRun = 0;
      if (mult > 1) { mult = 1; hudScore(); }
      floatText(wx(f.x), wy(0) - 34, "SPILL", "#ffb0c8", 24);
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
      sfx.topple(); haptic("heavy"); shake = 1; setMood("dismay", 9); musicDuck(0.7, 1500);
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
      try { ctx.platform.complete({ score: points, scoops: count, reason: reason }); } catch (_) { /* fine */ }
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
    function stepMan(dt) {
      const k = Math.min(1, dt * 9);
      man.lean += (clamp(-base.a * 0.000022, -0.11, 0.11) - man.lean) * k;
      man.headX += (clamp(-base.a * 0.0011, -6, 6) - man.headX) * k;
      const sp = Math.abs(base.v);
      man.walkAmt += (clamp(sp / 120, 0, 1) - man.walkAmt) * k;
      man.walk += sp * 0.05 * dt;
      let lx = 0, ly = 60;
      if (tower.M) { const tp = topPoint(); lx = tp.x - base.x; ly = tp.y - PIVOT_Y; }
      for (const a of arms) if (a.state === "in" || a.state === "hover") { lx = (a.x - wx(base.x)) / cam.s; ly = 220; }
      man.lookX += (clamp(lx * 0.03, -2.5, 2.5) - man.lookX) * Math.min(1, dt * 6);
      man.lookY += (clamp(-ly * 0.006, -2.2, 1.5) - man.lookY) * Math.min(1, dt * 6);
      man.moodT = Math.max(0, man.moodT - dt);
      if (man.moodT <= 0) {
        const q = tower.M && state === "play" ? Math.abs(tower.th) / tower.thMax : 0;
        man.mood = q > 0.62 ? "panic" : q > 0.3 ? "focused" : "calm";
      }
    }
    function leanCues() {
      const q = tower.M ? Math.abs(tower.th) / tower.thMax : 0;
      if (q > 0.7 && !warned) { warned = true; haptic("warning"); }
      if (q < 0.45) warned = false;
    }

    // ===================================================================== //
    // 8. Input: drag, tilt, keys                                             //
    // ===================================================================== //
    // A drag is relative: the cone moves by what the finger moves, scaled by
    // the zoom so a finger's pixel is always a screen pixel of cone, and the
    // thumb never has to cover the scooper. Positions come from offsetX, which
    // is already canvas-relative; pointer capture keeps the move/up events on
    // the canvas once a drag starts.
    let gesture = null;
    const keys = { left: false, right: false };
    const controllable = () => state === "play" || state === "spilled";
    ctx.listen(canvas, "pointerdown", (e) => {
      if (!controllable()) return;
      if (e.cancelable) e.preventDefault();
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } }
      gesture = { id: e.pointerId, x: typeof e.offsetX === "number" ? e.offsetX : e.clientX };
      if (save.plays === 0 && hintLandings < 3) el.finger.classList.remove("on");
    }, { passive: false });
    ctx.listen(canvas, "pointermove", (e) => {
      if (!gesture || e.pointerId !== gesture.id) return;
      if (e.cancelable) e.preventDefault();
      const x = typeof e.offsetX === "number" ? e.offsetX : e.clientX;
      const dx = x - gesture.x;
      gesture.x = x;
      if (controllable()) base.target += dx / cam.s * tune.sens();
    }, { passive: false });
    const endGesture = (e) => { if (gesture && (!e || typeof e.pointerId !== "number" || e.pointerId === gesture.id)) gesture = null; };
    ctx.listen(canvas, "pointerup", endGesture);
    ctx.listen(canvas, "pointercancel", endGesture);
    ctx.listen(window, "pointerup", endGesture);
    ctx.listen(window, "keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;
    });
    ctx.listen(window, "keyup", (e) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
    });
    function stepControl(dt) {
      const sens = tune.sens();
      if (keys.left !== keys.right) base.target += (keys.right ? 1 : -1) * 460 * sens * dt;
      if (tiltOn && tiltCtl) {
        const tx = typeof tiltCtl.x === "number" && isFinite(tiltCtl.x) ? tiltCtl.x : 0;
        base.target += tx * 600 * sens * dt;
      }
    }

    // ===================================================================== //
    // 9. The frame, boot                                                    //
    // ===================================================================== //
    function step(dt) {
      clock += dt; stateT += dt;
      shake = Math.max(0, shake - dt * 2.4);
      stepClouds(dt); stepParts(dt); stepCamera(dt);
      if (state === "play" || state === "spilled") {
        stepControl(dt); stepBody(dt); stepArms(dt); stepFalling(dt);
        if (state === "play") {
          stepSpawner(dt);
          if (tower.M && (Math.abs(tower.th) > tower.thMax || Math.abs(tower.th) > 0.6)) toppleNow();
          else leanCues();
        } else {
          if (tower.M && (Math.abs(tower.th) > tower.thMax || Math.abs(tower.th) > 0.6)) { toppleTower(); sfx.topple(); shake = 1; }
          endTimer -= dt;
          if (endTimer <= 0) gameOver("spills");
        }
      } else if (state === "topple") {
        stepBody(dt); stepArms(dt); stepFalling(dt); stepDebris(dt);
        if (stateT > 1.5) gameOver("topple");
      } else if (state === "result") {
        stepArms(dt); stepFalling(dt); stepDebris(dt);
      } else if (state === "title") {
        stepBody(dt); stepArms(dt);
      }
      stepMan(dt);
      if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hideHint(); }
      if (applyInsets()) layout();
    }

    load();
    applyMute();
    refreshChips(); hudHearts(); hudScore();
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

    // The SDK's cleanup-owned layout hook: resize, rotation and, in a
    // full-screen bit, inset changes. Insets are read from ctx, not the
    // payload, whose safeArea is all zeros in the safe frame.
    ctx.onResize(() => { applyInsets(); layout(); }, { immediate: true });
    try {
      if (ctx.tune && typeof ctx.tune.onChange === "function") {
        ctx.tune.onChange(["sky", "music_intensity"], () => {
          skyName = String(tune.sky()); pal = SKIES[skyName] || SKIES.sunset; skyGrad = null;
          musicSet({ intensity: tune.music() });
        });
      }
    } catch (_) { /* tuning is optional */ }

    draw();
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
      ctx.game.loop({
        maxDeltaMs: 100,
        update: (dtMs) => frame(dtMs),
        render: () => draw(),
        onError: loopError
      });
    } else {
      ctx.onFrame((dtMs) => { frame(dtMs); draw(); });
    }

    // Read-only state for the headless harness, which balances the tower
    // from `correction` (a finger offset in screen pixels).
    window.plethoraBit.debug = {
      state: () => state, scoops: () => count, hearts: () => hearts, points: () => points,
      lean: () => tower.th, thMax: () => tower.thMax, pending: () => pendingDrops, zoom: () => cam.s,
      correction: () => cam.s * Math.max(30, tower.cy) * (tower.th + 0.32 * tower.om) * 1.5,
      // What a steady hand does: accelerate the cone toward the lean, more
      // for a faster lean, scaled up while the cup still holds the stack.
      accel: () => {
        if (!tower.M) return 0;
        const cy = Math.max(30, tower.cy), grown = smooth(26, 150, cy);
        return cam.s * cy * (6 * tower.th + 3 * tower.om) / Math.max(0.25, grown);
      },
      snapshot: () => ({
        state: state, scoops: count, hearts: hearts, points: points, base: [base.x, base.v, base.target, base.a],
        cam: [cam.s, cam.target, cam.floorY, cam.railY], tower: [tower.th, tower.om, tower.cx, tower.cy, tower.h, tower.M, tower.thMax],
        falling: falling.map((f) => [f.x, f.y, f.vy, f.missed]), arms: arms.map((a) => [a.state, a.x, a.err, a.dropX]),
        pending: pendingDrops, rush: rushState, scoopList: tower.scoops.map((s) => [s.kind, s.r, s.d, s.x, s.y])
      })
    };

    } catch (err) {
      fatal("init", err);
    }
  }
};
