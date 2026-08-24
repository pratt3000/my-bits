/*
 * Pocket Planet
 * ---------------------------------------------------------------------------
 * A tiny low-poly globe you live on. Walk a little character right around the
 * planet, and shape it one tile at a time: plant trees that keep growing in
 * real time (even while the bit is closed), lay paths, raise cottages, hang
 * lanterns that glow after dark. Spin the globe, swim the sea, watch clouds
 * drift over the hills. Everything is saved and resumed.
 *
 * Runtime : plethora-bit@2   (window.plethoraBit)
 * Renderer: three@0.164.1    (ES module via ctx.importModule)
 *
 * Art direction notes — the look is built on established cozy-diorama practice:
 *   - Value first, hue second (Dorfromantik): each terrain band is separated by
 *     luminance before colour, so the planet reads even in greyscale.
 *   - Soft warm key + cool sky fill (Tiny Glade): one gentle sun, a hemisphere
 *     bounce, and soft shadows doing most of the shaping work.
 *   - Chunky rounded forms, generous bevels, narrow dark grooves between tiles
 *     so every facet catches a different amount of light.
 *   - Real-time growth stages (Petit Planet / Little Planet) so the world keeps
 *     changing between visits.
 *
 * Contract notes:
 *   - No packaged assets (maxAssets: 0) — every mesh, colour and sound here is
 *     generated procedurally at runtime.
 *   - Permissions declared for every gated API used: haptics, backgroundMusic,
 *     audio, storage.
 *   - Persistence uses ctx.storage (device) + ctx.memory.local (durable), with
 *     a fixed-width 7-char-per-tile packing that stays well under the 8 KB
 *     local-state limit even with all 864 tiles built on.
 */

window.plethoraBit = {
  meta: {
    title: "Pocket Planet",
    runtime: "plethora-bit@2",
    tags: ["3d", "planet", "builder", "cozy", "sandbox", "garden", "relaxing", "creative", "world", "trees"],
    permissions: ["haptics", "backgroundMusic", "audio", "storage"]
  },

  async init(ctx) {
    // =====================================================================
    // 0. IMMEDIATE FIRST FRAME
    //    The host must never see a blank canvas, so the intro card is real
    //    DOM painted before three.js is even requested.
    // =====================================================================
    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
    const SAT = sa.top || 0, SAB = sa.bottom || 0, SAL = sa.left || 0, SAR = sa.right || 0;

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.overflow = "hidden";
    // The sky lives in CSS so day/night can cross-fade for free behind a
    // transparent WebGL canvas.
    root.style.background = "linear-gradient(180deg,#8fd3f4 0%,#bfe6f7 42%,#e8f6fb 100%)";
    root.style.transition = "background 1.2s linear";

    const style = document.createElement("style");
    style.textContent = `
      .pp * { box-sizing:border-box; margin:0; padding:0; }
      .pp { position:absolute; inset:0; color:#2c3f4d; -webkit-user-select:none; user-select:none;
        -webkit-tap-highlight-color:transparent; touch-action:none; pointer-events:none;
        font-family:'Nunito Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
      .pp-layer { position:absolute; inset:0; pointer-events:none; }

      /* ---------- intro / loading ---------- */
      .pp-intro { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        padding:26px; text-align:center; pointer-events:auto; z-index:40;
        background:radial-gradient(130% 100% at 50% 8%,rgba(255,255,255,.42),rgba(126,196,224,.34) 52%,rgba(52,110,146,.5) 100%);
        transition:opacity .5s ease; }
      .pp-intro.gone { opacity:0; pointer-events:none; }
      .pp-card { width:100%; max-width:360px; }
      .pp-planetmark { width:112px; height:112px; margin:0 auto 20px; border-radius:50%; position:relative;
        background:radial-gradient(circle at 32% 28%,#bfe89a 0%,#8ecf6d 26%,#57b0d8 27%,#3d8fbe 62%,#2b6d97 100%);
        box-shadow:0 14px 34px rgba(31,74,102,.32), inset -12px -14px 26px rgba(20,60,88,.4),
                   inset 8px 8px 20px rgba(255,255,255,.42);
        animation:pp-spin 16s linear infinite; }
      .pp-planetmark::after { content:""; position:absolute; inset:-9px; border-radius:50%;
        background:radial-gradient(circle,rgba(255,255,255,0) 58%,rgba(180,232,255,.5) 76%,rgba(180,232,255,0) 100%); }
      @keyframes pp-spin { to { transform:rotate(360deg); } }
      .pp-h1 { font-size:38px; font-weight:800; letter-spacing:-.5px; color:#12384f;
        text-shadow:0 2px 14px rgba(255,255,255,.55); }
      .pp-sub { font-size:15px; line-height:1.5; font-weight:600; color:#22536e; opacity:.92; margin:8px 0 22px; }
      .pp-cta { pointer-events:auto; border:none; cursor:pointer; display:inline-flex; align-items:center; gap:9px;
        padding:16px 34px; border-radius:999px; font-size:17px; font-weight:800; letter-spacing:.2px;
        font-family:inherit; color:#0f3a26;
        background:linear-gradient(180deg,#a8e77f,#6fc95a); box-shadow:0 8px 20px rgba(41,110,52,.34), inset 0 -3px 0 rgba(0,0,0,.13);
        transition:transform .14s ease, opacity .2s ease; }
      .pp-cta:active { transform:scale(.95); }
      .pp-cta[disabled] { opacity:.62; cursor:default; }
      .pp-loadbar { width:172px; height:5px; border-radius:99px; margin:18px auto 0; overflow:hidden;
        background:rgba(255,255,255,.42); }
      .pp-loadbar i { display:block; height:100%; width:26%; border-radius:99px; background:#3f8ab5;
        animation:pp-slide 1.15s ease-in-out infinite; }
      @keyframes pp-slide { 0%{transform:translateX(-115%);} 100%{transform:translateX(430%);} }

      /* ---------- HUD ---------- */
      .pp-hud { position:absolute; top:${SAT + 12}px; left:${SAL + 14}px; pointer-events:none; }
      .pp-chipline { display:flex; gap:7px; flex-wrap:wrap; max-width:62vw; }
      .pp-chip { display:inline-flex; align-items:center; gap:5px; padding:6px 11px; border-radius:999px;
        font-size:13px; font-weight:800; color:#14415a; background:rgba(255,255,255,.66);
        border:1px solid rgba(255,255,255,.72); box-shadow:0 3px 10px rgba(24,66,92,.16);
        backdrop-filter:blur(9px); -webkit-backdrop-filter:blur(9px); white-space:nowrap; }
      .pp-chip.pp-life { color:#7a4a12; background:rgba(255,246,224,.76); }

      .pp-topright { position:absolute; top:${SAT + 12}px; right:${SAR + 14}px; display:flex; gap:9px; }
      .pp-ico { pointer-events:auto; width:42px; height:42px; border-radius:50%; cursor:pointer;
        border:1px solid rgba(255,255,255,.7); background:rgba(255,255,255,.62); color:#14415a;
        font-size:18px; font-family:inherit; display:flex; align-items:center; justify-content:center;
        box-shadow:0 3px 10px rgba(24,66,92,.16); backdrop-filter:blur(9px); -webkit-backdrop-filter:blur(9px);
        transition:transform .13s ease, background .2s ease; }
      .pp-ico:active { transform:scale(.88); }
      .pp-ico.off { opacity:.5; }

      /* ---------- toast ---------- */
      .pp-toast { position:absolute; left:50%; top:${SAT + 74}px; transform:translate(-50%,-8px) scale(.94);
        padding:9px 16px; border-radius:999px; font-size:13.5px; font-weight:800; white-space:nowrap;
        color:#14415a; background:rgba(255,255,255,.86); border:1px solid rgba(255,255,255,.8);
        box-shadow:0 6px 18px rgba(24,66,92,.2); backdrop-filter:blur(9px); -webkit-backdrop-filter:blur(9px);
        opacity:0; transition:opacity .22s ease, transform .22s ease; pointer-events:none; z-index:20;
        max-width:min(300px,78vw); white-space:normal; text-align:center; line-height:1.35; }
      .pp-toast.show { opacity:1; transform:translate(-50%,0) scale(1); }

      /* ---------- joystick ---------- */
      .pp-joy { position:absolute; width:118px; height:118px; margin:-59px 0 0 -59px; border-radius:50%;
        border:2px solid rgba(255,255,255,.66); background:rgba(255,255,255,.2);
        box-shadow:0 4px 16px rgba(24,66,92,.16); opacity:0; transition:opacity .16s ease; }
      .pp-joy.show { opacity:1; }
      .pp-knob { position:absolute; left:50%; top:50%; width:52px; height:52px; margin:-26px 0 0 -26px;
        border-radius:50%; background:rgba(255,255,255,.9); box-shadow:0 3px 10px rgba(24,66,92,.3); }

      /* ---------- build button ---------- */
      .pp-build { position:absolute; right:${SAR + 18}px; bottom:${SAB + 104}px; width:72px; height:72px;
        border-radius:50%; border:none; cursor:pointer; pointer-events:auto; font-family:inherit;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;
        font-size:26px; line-height:1; color:#0f3a26;
        background:linear-gradient(180deg,#a8e77f,#6fc95a);
        box-shadow:0 8px 20px rgba(41,110,52,.36), inset 0 -3px 0 rgba(0,0,0,.13);
        transition:transform .12s ease, filter .2s ease; }
      .pp-build:active { transform:scale(.9); }
      .pp-build .lab { font-size:9.5px; font-weight:900; letter-spacing:.6px; opacity:.72; }
      .pp-build.bad { background:linear-gradient(180deg,#f0b9b0,#dd8e83); color:#63241c;
        box-shadow:0 8px 20px rgba(150,60,45,.3), inset 0 -3px 0 rgba(0,0,0,.13); }

      /* ---------- tool strip ---------- */
      .pp-tools { position:absolute; left:0; right:0; bottom:${SAB + 16}px; pointer-events:auto;
        display:flex; gap:9px; overflow-x:auto; overflow-y:hidden; scrollbar-width:none;
        padding:4px ${SAR + 16}px 4px ${SAL + 16}px; -webkit-overflow-scrolling:touch; }
      .pp-tools::-webkit-scrollbar { display:none; }
      .pp-tool { flex:0 0 auto; width:60px; height:66px; border-radius:19px; border:1.5px solid rgba(255,255,255,.6);
        background:rgba(255,255,255,.6); cursor:pointer; font-family:inherit;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
        box-shadow:0 4px 12px rgba(24,66,92,.16); backdrop-filter:blur(9px); -webkit-backdrop-filter:blur(9px);
        transition:transform .13s ease, background .2s ease, border-color .2s ease; }
      .pp-tool .gl { font-size:23px; line-height:1; }
      .pp-tool .nm { font-size:9.5px; font-weight:900; letter-spacing:.2px; color:#2b5670; opacity:.82; }
      .pp-tool:active { transform:scale(.92); }
      .pp-tool.sel { background:rgba(255,255,255,.95); border-color:#6fc95a; transform:translateY(-4px);
        box-shadow:0 8px 18px rgba(41,110,52,.26); }
      .pp-tool.sel .nm { color:#2c6b32; opacity:1; }

      /* ---------- sheet (instructions / stats) ---------- */
      .pp-sheet { position:absolute; inset:0; z-index:30; display:flex; align-items:center; justify-content:center;
        padding:22px; pointer-events:auto; opacity:0; transition:opacity .24s ease;
        background:radial-gradient(120% 90% at 50% 12%,rgba(20,64,90,.34),rgba(12,40,58,.66)); }
      .pp-sheet.hide { opacity:0; pointer-events:none; }
      .pp-sheet.show { opacity:1; }
      .pp-panel { width:100%; max-width:352px; max-height:78%; overflow-y:auto; -webkit-overflow-scrolling:touch;
        background:linear-gradient(180deg,#ffffff,#f2f9fd); border-radius:26px; padding:22px 20px 18px;
        box-shadow:0 22px 50px rgba(10,40,60,.4); }
      .pp-panel h2 { font-size:22px; font-weight:900; color:#12384f; margin-bottom:3px; }
      .pp-panel .lead { font-size:13.5px; font-weight:700; color:#3a7089; opacity:.9; margin-bottom:15px; line-height:1.45; }
      .pp-list { list-style:none; display:flex; flex-direction:column; gap:11px; margin-bottom:16px; }
      .pp-list li { display:flex; gap:10px; align-items:flex-start; font-size:13.5px; line-height:1.5;
        font-weight:600; color:#31536a; }
      .pp-list li b { color:#12384f; font-weight:900; }
      .pp-list .k { flex:0 0 26px; text-align:center; font-size:17px; }
      .pp-close { width:100%; border:none; cursor:pointer; font-family:inherit; padding:14px; border-radius:16px;
        font-size:15px; font-weight:900; color:#0f3a26; background:linear-gradient(180deg,#a8e77f,#6fc95a);
        box-shadow:inset 0 -3px 0 rgba(0,0,0,.13); transition:transform .12s ease; }
      .pp-close:active { transform:scale(.97); }
      .pp-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; margin-bottom:16px; }
      .pp-stat { background:#eaf4fa; border-radius:15px; padding:11px 6px; text-align:center; }
      .pp-stat .v { font-size:20px; font-weight:900; color:#12384f; }
      .pp-stat .l { font-size:10px; font-weight:800; color:#4d7f9b; letter-spacing:.3px; margin-top:1px; }
      .pp-lb { display:flex; flex-direction:column; gap:6px; margin-bottom:15px; }
      .pp-lbrow { display:flex; align-items:center; gap:9px; font-size:13px; font-weight:700; color:#31536a;
        background:#eef6fa; border-radius:12px; padding:8px 11px; }
      .pp-lbrow .r { flex:0 0 20px; font-weight:900; color:#7ba7bf; }
      .pp-lbrow .n { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pp-lbrow .s { font-weight:900; color:#12384f; }
      .pp-lbrow.me { background:#e2f5dc; }
      .pp-danger { width:100%; border:none; cursor:pointer; font-family:inherit; padding:12px; border-radius:14px;
        font-size:13px; font-weight:800; color:#8d3a2c; background:#fbe7e3; margin-bottom:10px; }

      /* ---------- fatal ---------- */
      .pp-fatal { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:30px;
        text-align:center; font-size:15px; font-weight:700; line-height:1.6; color:#12384f; pointer-events:auto; z-index:50; }
    `;
    root.appendChild(style);

    const ui = document.createElement("div");
    ui.className = "pp";
    ui.innerHTML = `
      <div class="pp-layer">
        <div class="pp-hud">
          <div class="pp-chipline">
            <span class="pp-chip pp-c-tree">🌳 0</span>
            <span class="pp-chip pp-c-home">🏠 0</span>
            <span class="pp-chip pp-life">✦ 0</span>
          </div>
        </div>
        <div class="pp-topright">
          <button class="pp-ico pp-b-sky" aria-label="Time of day">☀️</button>
          <button class="pp-ico pp-b-snd" aria-label="Sound">🔊</button>
          <button class="pp-ico pp-b-info" aria-label="How to play">?</button>
        </div>
        <div class="pp-toast"></div>
        <div class="pp-joy"><div class="pp-knob"></div></div>
      </div>
      <button class="pp-build">🌱<span class="lab">PLANT</span></button>
      <div class="pp-tools"></div>
      <div class="pp-sheet hide"><div class="pp-panel"></div></div>
      <div class="pp-intro">
        <div class="pp-card">
          <div class="pp-planetmark"></div>
          <h1 class="pp-h1">Pocket Planet</h1>
          <p class="pp-sub">A little world of your own.<br>Plant it, build it, come back and watch it grow.</p>
          <button class="pp-cta" disabled>Shaping your world…</button>
          <div class="pp-loadbar"><i></i></div>
        </div>
      </div>
    `;
    root.appendChild(ui);

    const el = {
      hud: ui.querySelector(".pp-hud"),
      cTree: ui.querySelector(".pp-c-tree"),
      cHome: ui.querySelector(".pp-c-home"),
      cLife: ui.querySelector(".pp-life"),
      bSky: ui.querySelector(".pp-b-sky"),
      bSnd: ui.querySelector(".pp-b-snd"),
      bInfo: ui.querySelector(".pp-b-info"),
      toast: ui.querySelector(".pp-toast"),
      joy: ui.querySelector(".pp-joy"),
      knob: ui.querySelector(".pp-knob"),
      build: ui.querySelector(".pp-build"),
      tools: ui.querySelector(".pp-tools"),
      sheet: ui.querySelector(".pp-sheet"),
      panel: ui.querySelector(".pp-panel"),
      intro: ui.querySelector(".pp-intro"),
      cta: ui.querySelector(".pp-cta"),
      bar: ui.querySelector(".pp-loadbar")
    };

    // Hide the play surface until the world exists.
    el.build.style.display = "none";
    el.tools.style.display = "none";
    el.hud.style.display = "none";
    ui.querySelector(".pp-topright").style.display = "none";

    // The intro card IS the first frame — tell the host straight away.
    let readyCalled = false;
    function safeReady() {
      if (readyCalled) return;
      readyCalled = true;
      try { ctx.markVisualReady("intro"); } catch (_) {}
      try { ctx.platform.ready(); } catch (_) {}
    }
    safeReady();

    let toastTimer = null;
    function toast(msg, ms) {
      el.toast.textContent = msg;
      el.toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms || 1500);
    }
    ctx.onDestroy(() => { if (toastTimer) clearTimeout(toastTimer); });

    function fatal(msg) {
      el.intro.innerHTML = '<div class="pp-fatal">' + msg + "</div>";
      el.intro.classList.remove("gone");
      el.intro.style.pointerEvents = "auto";
    }

    // A cute rounded face for the UI, if the registry has it. Purely cosmetic.
    try {
      if (ctx.loadFont) {
        ctx.loadFont("Nunito Sans", "nunito-sans", "1.0.0", { weight: "700" }).catch(() => {});
        ctx.loadFont("Nunito Sans", "nunito-sans", "1.0.0", { weight: "400" }).catch(() => {});
      }
    } catch (_) {}

    // =====================================================================
    // 1. WORLD CONSTANTS
    //    The globe is a quad-sphere: 6 cube faces x N x N tiles, each face
    //    cell projected out to the sphere. N = 12 gives 864 tiles — about 48
    //    tiles around the equator, so a full lap on foot takes ~25 seconds.
    // =====================================================================
    const N = 12;                       // tiles per cube-face edge
    const FACE = N * N;                 // 144 tiles per face
    const TILES = 6 * FACE;             // 864 tiles total
    const TILE_ANG = (Math.PI / 2) / N; // angular width of one tile (radians)

    const CORE_R = 8.86;                // solid inner sphere (nothing is ever below this)
    const SEA_R = 9.99;                 // water surface radius
    const INSET = 0.94;                 // tile shrink toward its centre -> dark grooves
    const GROOVE = 0.15;                // how deep the groove between tiles cuts

    // Terrain height bands. Index = level, value = radius of the tile's top face.
    // Every land band clears SEA_R by more than GROOVE, so the sea can never
    // show up through the gaps between two pieces of land.
    const LEVEL_R = [9.40, 9.74, 10.20, 10.38, 10.62, 10.92, 11.26, 11.60];

    // Percentile cut points for the elevation field. Because the bands are
    // assigned by rank rather than by absolute value, every seed produces a
    // planet with the same pleasing land/sea balance (~42% water) — no seed
    // ever comes out all ocean or all rock.
    const BANDS = [0.30, 0.42, 0.50, 0.71, 0.845, 0.935, 0.988];

    // Biome ids (colour), kept separate from level (height).
    const B_DEEP = 0, B_SHALLOW = 1, B_SAND = 2, B_GRASS = 3, B_MEADOW = 4,
          B_FOREST = 5, B_ROCK = 6, B_SNOW = 7, B_ICE = 8;

    // Placeable ids. These are the characters written into the save string, so
    // they must never be renumbered once a planet exists in the wild.
    const P_EMPTY = 0, P_TREE = 1, P_FLOWER = 2, P_PATH = 3, P_HOUSE = 4,
          P_LAMP = 5, P_MUSH = 6, P_MILL = 7, P_ROCK = 8;

    // Tools, in strip order. `cap` bounds how many of a thing can exist, which
    // keeps the instanced buffers from ever overflowing.
    const TOOLS = [
      { id: P_TREE,   gl: "🌱", nm: "TREE",   lab: "PLANT",  cap: 640, hint: "Plant a tree — it keeps growing while you are away" },
      { id: P_FLOWER, gl: "🌼", nm: "FLOWER", lab: "SOW",    cap: 400, hint: "Sow a patch of wildflowers" },
      { id: P_PATH,   gl: "🧱", nm: "PATH",   lab: "PAVE",   cap: 500, hint: "Lay a paving stone" },
      { id: P_HOUSE,  gl: "🏠", nm: "HOUSE",  lab: "BUILD",  cap: 260, hint: "Raise a cottage — its windows light up at night" },
      { id: P_LAMP,   gl: "🏮", nm: "LAMP",   lab: "HANG",   cap: 300, hint: "Hang a lantern — it glows after dark" },
      { id: P_MUSH,   gl: "🍄", nm: "SHROOM", lab: "GROW",   cap: 300, hint: "Grow glowing mushrooms" },
      { id: P_MILL,   gl: "🌀", nm: "MILL",   lab: "RAISE",  cap: 120, hint: "Raise a windmill — its sails turn in the breeze" },
      { id: P_ROCK,   gl: "🪨", nm: "STONES", lab: "STACK",  cap: 320, hint: "Stack a little cairn" },
      { id: P_EMPTY,  gl: "✕",  nm: "CLEAR",  lab: "CLEAR",  cap: Infinity, hint: "Clear this tile back to bare ground" }
    ];

    // Tree growth. Real wall-clock time, so a planet left overnight comes back
    // as a forest. Thresholds are ms since the tree was planted.
    const GROW_MS = [0, 45e3, 4 * 60e3, 20 * 60e3, 120 * 60e3];
    const STAGE_NAME = ["sprout", "sapling", "young tree", "tree", "ancient tree"];
    const LIFE_PTS = [1, 2, 4, 7, 12];   // Planet Life value of a tree per stage

    const DAY_MS = 300e3;               // one full day/night cycle
    const WALK_SPEED = 2.55;            // world units per second on land
    const SWIM_SPEED = 1.55;
    const BUILD_RANGE = 4.2;            // how many tiles away you may build

    // =====================================================================
    // 2. SAVE FORMAT
    //    Fixed-width packing, 7 chars per built tile:
    //      [2] tile index, base64      (0..4095, we need 0..863)
    //      [1] placeable id, one digit (0..8)
    //      [4] planting time, base64   (minutes since 2020-01-01, ~31y range)
    //    864 tiles fully built = 6048 chars, comfortably inside the 8 KB
    //    ctx.memory.local limit with room for the wrapper.
    // =====================================================================
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const B64I = {};
    for (let i = 0; i < 64; i++) B64I[B64[i]] = i;
    const EPOCH0 = Date.UTC(2020, 0, 1);
    const MAX_MIN = 64 * 64 * 64 * 64 - 1;

    function b64enc(n, len) {
      n = Math.max(0, Math.min(n | 0, Math.pow(64, len) - 1));
      let s = "";
      for (let i = len - 1; i >= 0; i--) s += B64[(n >> (6 * i)) & 63];
      return s;
    }
    function b64dec(s) {
      let n = 0;
      for (let i = 0; i < s.length; i++) {
        const d = B64I[s[i]];
        if (d === undefined) return -1;
        n = n * 64 + d;
      }
      return n;
    }

    // placed: tileIndex -> { type, t }   (t = plantedAt ms, 0 when not growing)
    const placed = new Map();
    let seed = 0;
    let outfit = 0;

    function packPlaced() {
      let out = "";
      placed.forEach((rec, idx) => {
        if (idx < 0 || idx >= TILES) return;
        const mins = rec.t > 0 ? Math.max(0, Math.min(MAX_MIN, Math.round((rec.t - EPOCH0) / 60000))) : 0;
        out += b64enc(idx, 2) + String(rec.type) + b64enc(mins, 4);
      });
      return out;
    }
    function unpackPlaced(str) {
      placed.clear();
      if (typeof str !== "string") return;
      for (let i = 0; i + 7 <= str.length; i += 7) {
        const idx = b64dec(str.slice(i, i + 2));
        const type = parseInt(str[i + 2], 10);
        const mins = b64dec(str.slice(i + 3, i + 7));
        if (idx < 0 || idx >= TILES || mins < 0) continue;
        if (!(type >= P_EMPTY && type <= P_ROCK)) continue;
        placed.set(idx, { type: type, t: mins > 0 ? EPOCH0 + mins * 60000 : 0 });
      }
    }

    const SAVE_KEY = "pocket-planet-v1";
    let charPos = null;   // THREE.Vector3, filled in once three is up

    function buildSave() {
      const save = { v: 1, s: seed, t: Date.now(), h: outfit, p: packPlaced() };
      if (charPos) {
        save.c = [
          Math.round(charPos.x * 1e4) / 1e4,
          Math.round(charPos.y * 1e4) / 1e4,
          Math.round(charPos.z * 1e4) / 1e4
        ];
      }
      return save;
    }

    let memoryLocalOk = true;
    async function persist() {
      const save = buildSave();
      try { if (ctx.capabilities && ctx.capabilities.storage) await ctx.storage.set(SAVE_KEY, save); } catch (_) {}
      // The durable copy is size-capped by the platform; only send it if we
      // know it fits, and stop trying after a rejection so we never spam.
      if (!memoryLocalOk || !ctx.memory || !ctx.memory.local) return;
      try {
        if (JSON.stringify(save).length > 7900) return;
        await ctx.memory.local("planet").set(save);
      } catch (_) { memoryLocalOk = false; }
    }

    let saveTimer = null;
    function queueSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 1200);
    }
    function flushSave() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      persist();
    }

    function validSave(s) {
      return s && s.v === 1 && typeof s.s === "number" && isFinite(s.s) && typeof s.p === "string";
    }

    async function loadSave() {
      let a = null, b = null;
      try { if (ctx.capabilities && ctx.capabilities.storage) a = await ctx.storage.get(SAVE_KEY); } catch (_) {}
      try { if (ctx.memory && ctx.memory.local) b = await ctx.memory.local("planet").get(); } catch (_) {}
      if (b && b.data && !b.v) b = b.data;              // tolerate an envelope
      const ca = validSave(a) ? a : null;
      const cb = validSave(b) ? b : null;
      let pick = null;
      if (ca && cb) pick = (cb.t || 0) > (ca.t || 0) ? cb : ca;
      else pick = ca || cb;
      if (!pick) return false;
      seed = pick.s >>> 0;
      outfit = (typeof pick.h === "number" && pick.h >= 0) ? pick.h | 0 : 0;
      unpackPlaced(pick.p);
      return pick;
    }

    // =====================================================================
    // 3. LOAD THREE
    // =====================================================================
    let THREE = null;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e) {
      try { THREE = await ctx.importModule("https://libs.plethora.studio/three/0.164.1/three.module.js"); }
      catch (e2) { THREE = null; }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) {
      fatal("Pocket Planet needs its 3D library, and it could not be loaded.<br><br>Please try opening the bit again.");
      return;
    }

    const loaded = await loadSave();
    if (!seed) seed = (Math.floor(Math.random() * 0xfffffff) ^ (Date.now() & 0xfffff)) >>> 0;
    const isReturning = !!loaded;

    // ---------------------------------------------------------------------
    // Renderer. The canvas is transparent so the animated CSS sky behind it
    // does the day/night gradient for free.
    // ---------------------------------------------------------------------
    const canvas = ctx.createCanvas({ touchAction: "none" });
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    root.insertBefore(canvas, ui);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) { renderer = null; }
    if (!renderer) {
      fatal("This device could not start 3D graphics.<br><br>Pocket Planet needs WebGL to draw your world.");
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (_) {} });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, Math.max(0.2, ctx.width / Math.max(1, ctx.height)), 0.5, 400);
    const planet = new THREE.Group();     // everything that belongs to the globe
    scene.add(planet);

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const tmpA = V(), tmpB = V(), tmpC = V(), tmpD = V();
    const tmpM = new THREE.Matrix4();
    const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    // Frame-rate independent smoothing factor.
    const damp = (dt, rate) => 1 - Math.exp(-rate * dt);

    // =====================================================================
    // 4. SEEDED RANDOMNESS + 3D VALUE NOISE
    // =====================================================================
    function rngFrom(s) {
      let x = (s >>> 0) || 1;
      return function () {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5;  x >>>= 0;
        return x / 4294967296;
      };
    }
    // Cheap stable hash: same tile always gets the same species, tint, rotation.
    function hash2(a, b) {
      let h = (a * 374761393 + b * 668265263 + seed * 2246822519) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0;
      h = (h * 1274126177) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    function makeNoise(s) {
      const rnd = rngFrom(s);
      const perm = new Uint8Array(256);
      for (let i = 0; i < 256; i++) perm[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
      }
      const p = new Uint8Array(512);
      for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
      const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
      function grad(h, x, y, z) {
        h &= 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
      }
      return function (x, y, z) {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        const u = fade(x), v = fade(y), w = fade(z);
        const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
        const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
        return lerp(
          lerp(lerp(grad(p[AA], x, y, z),         grad(p[BA], x - 1, y, z), u),
               lerp(grad(p[AB], x, y - 1, z),     grad(p[BB], x - 1, y - 1, z), u), v),
          lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
               lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
          w);
      };
    }
    function fbm(noise, x, y, z, oct, freq, gain) {
      let amp = 1, f = freq, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += amp * noise(x * f, y * f, z * f);
        norm += amp; amp *= gain; f *= 2;
      }
      return sum / norm;
    }

    // =====================================================================
    // 5. QUAD-SPHERE MAPPING
    //    Face layout follows the standard cube-map convention, and the cell
    //    coordinate is tangent-warped (tan(c * PI/4)) so tiles come out close
    //    to equal-area instead of bunching badly at the cube corners.
    // =====================================================================
    const warp = c => Math.tan(c * Math.PI * 0.25);
    const unwarp = a => Math.atan(a) * 4 / Math.PI;

    // Face (f) + warped cell coords (a,b) -> unit direction.
    function faceDir(f, a, b, out) {
      const o = out || V();
      switch (f) {
        case 0: o.set( 1,  b, -a); break;   // +X
        case 1: o.set(-1,  b,  a); break;   // -X
        case 2: o.set( a,  1, -b); break;   // +Y
        case 3: o.set( a, -1,  b); break;   // -Y
        case 4: o.set( a,  b,  1); break;   // +Z
        default: o.set(-a, b, -1); break;   // -Z
      }
      return o.normalize();
    }
    // Grid corner (u,v in 0..N) -> unit direction.
    function cornerDir(f, u, v, out) {
      return faceDir(f, warp((u / N) * 2 - 1), warp((v / N) * 2 - 1), out);
    }
    // Tile centre -> unit direction.
    function tileDir(i, out) {
      const f = (i / FACE) | 0, r = i - f * FACE, v = (r / N) | 0, u = r - v * N;
      return faceDir(f, warp(((u + 0.5) / N) * 2 - 1), warp(((v + 0.5) / N) * 2 - 1), out);
    }
    // Unit direction -> tile index. The exact inverse of the above, which is
    // what makes cross-face movement free: nothing ever needs an adjacency
    // table, because every query goes through the direction vector.
    function dirToTile(d) {
      const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
      let f, a, b;
      if (ax >= ay && ax >= az) {
        if (d.x > 0) { f = 0; a = -d.z / ax; b = d.y / ax; }
        else         { f = 1; a =  d.z / ax; b = d.y / ax; }
      } else if (ay >= az) {
        if (d.y > 0) { f = 2; a = d.x / ay; b = -d.z / ay; }
        else         { f = 3; a = d.x / ay; b =  d.z / ay; }
      } else {
        if (d.z > 0) { f = 4; a =  d.x / az; b = d.y / az; }
        else         { f = 5; a = -d.x / az; b = d.y / az; }
      }
      let u = Math.floor((unwarp(a) + 1) * 0.5 * N);
      let v = Math.floor((unwarp(b) + 1) * 0.5 * N);
      u = clamp(u, 0, N - 1); v = clamp(v, 0, N - 1);
      return f * FACE + v * N + u;
    }
    // The four edge-neighbours of a tile, found by stepping one tile-width in
    // each tangent direction and re-querying. Works across face seams.
    function neighbours(i, out) {
      const d = tileDir(i, tmpA);
      const up = Math.abs(d.y) < 0.92 ? tmpB.set(0, 1, 0) : tmpB.set(1, 0, 0);
      const e1 = tmpC.crossVectors(up, d).normalize();
      const e2 = tmpD.crossVectors(d, e1).normalize();
      const s = Math.tan(TILE_ANG);
      const res = out || [];
      const p = V();
      for (let k = 0; k < 4; k++) {
        const dx = k === 0 ? s : k === 1 ? -s : 0;
        const dy = k === 2 ? s : k === 3 ? -s : 0;
        p.copy(d).addScaledVector(e1, dx).addScaledVector(e2, dy).normalize();
        res[k] = dirToTile(p);
      }
      return res;
    }

    // =====================================================================
    // 6. TERRAIN GENERATION
    // =====================================================================
    let nElev, nDetail, nRidge, nMoist, nForest;
    function seedNoise() {
      nElev   = makeNoise(seed);
      nDetail = makeNoise(seed ^ 0x9e3779b9);
      nRidge  = makeNoise(seed ^ 0x51ed270b);
      nMoist  = makeNoise(seed ^ 0x2545f491);
      nForest = makeNoise(seed ^ 0x7feb352d);
    }
    seedNoise();

    const tLevel  = new Uint8Array(TILES);   // height band 0..7
    const tBiome  = new Uint8Array(TILES);   // colour band
    const tMoist  = new Float32Array(TILES);
    const tNatural= new Int8Array(TILES);    // seed-derived decoration, -1 = none
    const tDirs   = new Float32Array(TILES * 3);

    function generate() {
      const elev = new Float32Array(TILES);
      const d = V();
      for (let i = 0; i < TILES; i++) {
        tileDir(i, d);
        tDirs[i * 3] = d.x; tDirs[i * 3 + 1] = d.y; tDirs[i * 3 + 2] = d.z;

        // Continents from a big smooth field, detail on top, and ridged noise
        // biased to already-high ground so mountains form inland spines rather
        // than random spikes in the sea.
        const cont = fbm(nElev, d.x, d.y, d.z, 3, 0.92, 0.5);
        const det  = fbm(nDetail, d.x, d.y, d.z, 4, 2.7, 0.5);
        const ridgeRaw = fbm(nRidge, d.x, d.y, d.z, 3, 1.9, 0.5);
        const ridge = Math.pow(Math.max(0, 1 - Math.abs(ridgeRaw) * 1.9), 3);
        elev[i] = cont + det * 0.34 + ridge * 0.5 * Math.max(0, cont + 0.12);
        tMoist[i] = fbm(nMoist, d.x + 11.3, d.y - 7.1, d.z + 3.9, 3, 1.6, 0.5);
      }

      // Rank-based banding: sort a copy, read off the cut values. This is what
      // guarantees a good-looking land/sea split for every possible seed.
      const sorted = Float32Array.from(elev).sort();
      const cut = BANDS.map(p => sorted[clamp(Math.floor(p * (TILES - 1)), 0, TILES - 1)]);

      for (let i = 0; i < TILES; i++) {
        const e = elev[i];
        let lv = 7;
        for (let k = 0; k < cut.length; k++) { if (e < cut[k]) { lv = k; break; } }
        tLevel[i] = lv;

        // Polar caps: high |y| freezes whatever is there. Gives the globe two
        // bright poles, which also helps you read its spin at a glance.
        const dy = tDirs[i * 3 + 1];
        const cold = Math.pow(Math.abs(dy), 3.1) + fbm(nMoist, dy * 3, 1.7, 0.3, 2, 2.2, 0.5) * 0.09;

        let bi;
        if (lv === 0) bi = B_DEEP;
        else if (lv === 1) bi = B_SHALLOW;
        else if (lv === 2) bi = B_SAND;
        else if (lv === 3) bi = B_GRASS;
        else if (lv === 4) bi = B_MEADOW;
        else if (lv === 5) bi = B_FOREST;
        else if (lv === 6) bi = B_ROCK;
        else bi = B_SNOW;

        if (cold > 0.60) {
          if (lv <= 1) bi = B_ICE;
          else bi = B_SNOW;
        }
        tBiome[i] = bi;
      }

      // Seed-derived natural scatter, so a brand-new planet already looks
      // lived-in rather than like an empty grid waiting for chores.
      for (let i = 0; i < TILES; i++) {
        tNatural[i] = -1;
        const bi = tBiome[i];
        const d2 = V(tDirs[i * 3], tDirs[i * 3 + 1], tDirs[i * 3 + 2]);
        const forest = fbm(nForest, d2.x, d2.y, d2.z, 3, 2.4, 0.5);
        const h = hash2(i, 17);
        if (bi === B_GRASS || bi === B_MEADOW || bi === B_FOREST) {
          const dens = forest + (bi === B_FOREST ? 0.16 : bi === B_MEADOW ? 0.05 : 0);
          if (dens > 0.10 && h < 0.72) tNatural[i] = P_TREE;
          else if (h > 0.955) tNatural[i] = P_FLOWER;
          else if (h > 0.935) tNatural[i] = P_ROCK;
        } else if (bi === B_ROCK) {
          if (h > 0.66) tNatural[i] = P_ROCK;
        } else if (bi === B_SAND) {
          if (h > 0.955) tNatural[i] = P_ROCK;
        }
      }
    }
    generate();

    function isWater(i) { return tLevel[i] <= 1; }
    function dirOf(i, out) { return (out || V()).set(tDirs[i * 3], tDirs[i * 3 + 1], tDirs[i * 3 + 2]); }

    // Effective content of a tile: an explicit placement wins; otherwise the
    // seed-derived scatter shows through. A cleared tile stores P_EMPTY, which
    // is how "I chopped that natural tree down" survives a reload.
    function contentOf(i) {
      if (isWater(i)) return null;
      const rec = placed.get(i);
      if (rec) return rec;
      const nat = tNatural[i];
      if (nat >= 0) return { type: nat, t: 0, nat: true };
      return null;
    }

    // ---------------------------------------------------------------------
    // Palette. Ordered by luminance first (so the planet reads in greyscale),
    // with hue and saturation layered on afterwards for warmth.
    // ---------------------------------------------------------------------
    const COL = {
      deep:    new THREE.Color(0x24506b),
      shallow: new THREE.Color(0x3a7f9c),
      sand:    new THREE.Color(0xf5dfa4),
      sandWet: new THREE.Color(0xdfc088),
      grassDry:new THREE.Color(0xc3d072),
      grassWet:new THREE.Color(0x69b855),
      meadow:  new THREE.Color(0x6fb552),
      forest:  new THREE.Color(0x53994c),
      rock:    new THREE.Color(0xb4ab9c),
      snow:    new THREE.Color(0xf6fafd),
      ice:     new THREE.Color(0xd6edf5),
      path:    new THREE.Color(0xb9ae99),
      soil:    new THREE.Color(0x9a7a5b)
    };

    const _c = new THREE.Color();
    function tileColor(i, out) {
      const c = out || _c;
      const bi = tBiome[i];
      const m = clamp(tMoist[i] * 0.5 + 0.5, 0, 1);
      switch (bi) {
        case B_DEEP:    c.copy(COL.deep); break;
        case B_SHALLOW: c.copy(COL.shallow); break;
        case B_SAND:    c.copy(COL.sand); break;
        case B_GRASS:   c.copy(COL.grassDry).lerp(COL.grassWet, m); break;
        case B_MEADOW:  c.copy(COL.grassWet).lerp(COL.meadow, m * 0.8 + 0.1); break;
        case B_FOREST:  c.copy(COL.meadow).lerp(COL.forest, m * 0.7 + 0.3); break;
        case B_ROCK:    c.copy(COL.rock); break;
        case B_SNOW:    c.copy(COL.snow); break;
        default:        c.copy(COL.ice); break;
      }
      // Beaches darken where they meet the sea — a cheap stand-in for wet sand
      // that reads as a shoreline without needing a foam pass.
      if (bi === B_SAND) {
        const nb = neighbours(i, _nbuf);
        let wet = 0;
        for (let k = 0; k < 4; k++) if (isWater(nb[k])) wet++;
        if (wet) c.lerp(COL.sandWet, Math.min(1, wet * 0.34));
      }
      // Per-tile jitter keeps a big region of one biome from reading as a
      // single flat slab of colour.
      c.offsetHSL((hash2(i, 5) - 0.5) * 0.026, (hash2(i, 7) - 0.5) * 0.09,
                  (hash2(i, 3) - 0.5) * 0.085);
      const rec = placed.get(i);
      if (rec && rec.type === P_PATH) c.copy(COL.path).offsetHSL(0, 0, (hash2(i, 11) - 0.5) * 0.06);
      return c;
    }
    const _nbuf = [0, 0, 0, 0];

    // =====================================================================
    // 7. PLANET MESH
    //    One merged, non-indexed, flat-shaded buffer. Each tile is a little
    //    prism: an inset top cap plus four walls dropping to the core radius.
    //    The inset is what carves the dark groove between neighbours, and the
    //    walls are what turn a height change into a readable terrace.
    // =====================================================================
    const TRIS_PER_TILE = 20;                 // inset cap + groove + skirt cap + terrace
    const VERTS_PER_TILE = TRIS_PER_TILE * 3;
    const terrainGeo = new THREE.BufferGeometry();
    const tPos = new Float32Array(TILES * VERTS_PER_TILE * 3);
    const tNor = new Float32Array(TILES * VERTS_PER_TILE * 3);
    const tCol = new Float32Array(TILES * VERTS_PER_TILE * 3);

    function buildTerrain() {
      const c0 = V();
      const q = [V(), V(), V(), V()];     // inset corners  (the visible cap)
      const Q = [V(), V(), V(), V()];     // full corners   (the sealing skirt)
      const a1 = [V(), V(), V(), V()], a2 = [V(), V(), V(), V()];
      const b1 = [V(), V(), V(), V()], b2 = [V(), V(), V(), V()];
      const centre = V(), e1 = V(), e2 = V(), nrm = V();
      let w = 0;

      function tri(a, b, cc) {
        e1.subVectors(b, a); e2.subVectors(cc, a);
        nrm.crossVectors(e1, e2).normalize();
        const pts = [a, b, cc];
        for (let k = 0; k < 3; k++) {
          tPos[w] = pts[k].x; tPos[w + 1] = pts[k].y; tPos[w + 2] = pts[k].z;
          tNor[w] = nrm.x;    tNor[w + 1] = nrm.y;    tNor[w + 2] = nrm.z;
          w += 3;
        }
      }
      function ring(top, bot) {
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) & 3;
          tri(top[k], bot[k], bot[k2]);
          tri(top[k], bot[k2], top[k2]);
        }
      }

      for (let i = 0; i < TILES; i++) {
        const f = (i / FACE) | 0, r = i - f * FACE, v = (r / N) | 0, u = r - v * N;
        dirOf(i, centre);
        for (let k = 0; k < 4; k++) {
          const uu = u + (k === 1 || k === 2 ? 1 : 0);
          const vv = v + (k === 2 || k === 3 ? 1 : 0);
          cornerDir(f, uu, vv, c0);
          Q[k].copy(c0);
          q[k].copy(c0).lerp(centre, 1 - INSET).normalize();
        }
        // Cube faces do not all share a handedness, so take the winding from
        // the geometry itself rather than hard-coding it per face.
        e1.subVectors(q[1], q[0]); e2.subVectors(q[2], q[0]);
        if (nrm.crossVectors(e1, e2).dot(centre) < 0) {
          let t = q[1].clone(); q[1].copy(q[3]); q[3].copy(t);
          t = Q[1].clone(); Q[1].copy(Q[3]); Q[3].copy(t);
        }

        // Each tile is a narrow inset cap sitting on a full-width skirt. The
        // skirt is what seals the planet: neighbouring skirts meet edge to
        // edge, so a groove bottoms out on soil instead of opening a hole
        // through to the sea or to space.
        const rTop = LEVEL_R[tLevel[i]];
        let rSkirt = rTop - GROOVE;
        if (!isWater(i)) rSkirt = Math.max(rSkirt, SEA_R + 0.05);
        for (let k = 0; k < 4; k++) {
          a1[k].copy(q[k]).multiplyScalar(rTop);
          a2[k].copy(q[k]).multiplyScalar(rSkirt);
          b1[k].copy(Q[k]).multiplyScalar(rSkirt);
          b2[k].copy(Q[k]).multiplyScalar(CORE_R);
        }
        tri(a1[0], a1[1], a1[2]); tri(a1[0], a1[2], a1[3]);   // cap          0..5
        ring(a1, a2);                                        // groove       6..29
        tri(b1[0], b1[1], b1[2]); tri(b1[0], b1[2], b1[3]);   // groove floor 30..35
        ring(b1, b2);                                        // terrace     36..59
      }
      if (!terrainGeo.getAttribute("position")) {
        terrainGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3));
        terrainGeo.setAttribute("normal", new THREE.BufferAttribute(tNor, 3));
        terrainGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
      } else {
        terrainGeo.getAttribute("position").needsUpdate = true;
        terrainGeo.getAttribute("normal").needsUpdate = true;
      }
      terrainGeo.computeBoundingSphere();
    }
    buildTerrain();

    const colAttr = terrainGeo.getAttribute("color");
    // Vertex bands per tile: 0-5 cap, 6-29 groove, 30-35 groove floor, 36-59 terrace.
    function paintTile(i) {
      const c = tileColor(i, _c);
      const o0 = i * VERTS_PER_TILE * 3;
      function band(from, to, r, g, b) {
        let o = o0 + from * 3;
        for (let k = from; k < to; k++) { tCol[o] = r; tCol[o + 1] = g; tCol[o + 2] = b; o += 3; }
      }
      band(0, 6, c.r, c.g, c.b);
      band(6, 30, c.r * 0.42, c.g * 0.42, c.b * 0.44);                    // groove shadow
      band(30, 36, c.r * 0.30, c.g * 0.30, c.b * 0.33);                   // groove floor
      // Terraces read as cliff faces: the tile's own hue, pushed toward soil.
      band(36, VERTS_PER_TILE, c.r * 0.58 + 0.14, c.g * 0.56 + 0.11, c.b * 0.54 + 0.08);
    }
    function repaintAll() {
      for (let i = 0; i < TILES; i++) paintTile(i);
      colAttr.needsUpdate = true;
    }
    function repaintTile(i) {
      paintTile(i);
      colAttr.needsUpdate = true;
    }
    repaintAll();

    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    planet.add(terrain);

    // Solid core so the grooves read as deep shadow instead of holes.
    const coreMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2e });
    const core = new THREE.Mesh(new THREE.SphereGeometry(CORE_R, 32, 24), coreMat);
    planet.add(core);

    // ---------------------------------------------------------------------
    // Build-target highlight: a floating border band over one tile.
    // ---------------------------------------------------------------------
    const hlGeo = new THREE.BufferGeometry();
    const hlPos = new Float32Array(4 * 6 * 3);   // 4 border quads
    hlGeo.setAttribute("position", new THREE.BufferAttribute(hlPos, 3));
    const hlMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const highlight = new THREE.Mesh(hlGeo, hlMat);
    highlight.renderOrder = 6;
    highlight.frustumCulled = false;
    planet.add(highlight);

    const _hOut = [V(), V(), V(), V()], _hIn = [V(), V(), V(), V()];
    function setHighlight(i, lift) {
      const f = (i / FACE) | 0, r = i - f * FACE, v = (r / N) | 0, u = r - v * N;
      const centre = dirOf(i, tmpA);
      const rr = LEVEL_R[tLevel[i]] + (lift || 0.035);
      const tmp = tmpB;
      for (let k = 0; k < 4; k++) {
        const uu = u + (k === 1 || k === 2 ? 1 : 0);
        const vv = v + (k === 2 || k === 3 ? 1 : 0);
        cornerDir(f, uu, vv, tmp);
        _hOut[k].copy(tmp).lerp(centre, 1 - INSET).normalize().multiplyScalar(rr);
        _hIn[k].copy(tmp).lerp(centre, 1 - INSET * 0.74).normalize().multiplyScalar(rr);
      }
      let w = 0;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) & 3;
        const pts = [_hOut[k], _hOut[k2], _hIn[k2], _hOut[k], _hIn[k2], _hIn[k]];
        for (let p = 0; p < 6; p++) {
          hlPos[w] = pts[p].x; hlPos[w + 1] = pts[p].y; hlPos[w + 2] = pts[p].z; w += 3;
        }
      }
      hlGeo.getAttribute("position").needsUpdate = true;
    }

    // =====================================================================
    // 8. SEA, SKY AND AIR
    // =====================================================================
    const uTime = { value: 0 };

    // --- water -----------------------------------------------------------
    const waterMat = new THREE.MeshPhongMaterial({
      color: 0x56bcdb, specular: 0xd8f6ff, shininess: 84,
      transparent: true, opacity: 0.74, depthWrite: false
    });
    waterMat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = uTime;
      const waveFn = `
        uniform float uTime;
        float ppWave(vec3 p) {
          return sin(p.x * 1.7 + uTime * 1.15) * cos(p.z * 1.55 + uTime * 0.83) * 0.026
               + sin(p.y * 2.3 - uTime * 0.90) * 0.013;
        }
      `;
      shader.vertexShader = waveFn + shader.vertexShader;
      // Displace along the radius, then rebuild the normal from finite
      // differences so the sun actually glints across the moving surface.
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
         vec3 ppN = normalize(position);
         vec3 ppAxis = mix(vec3(0.0,1.0,0.0), vec3(1.0,0.0,0.0), step(0.9, abs(ppN.y)));
         vec3 ppTa = normalize(cross(ppN, ppAxis));
         vec3 ppTb = cross(ppN, ppTa);
         float ppE = 0.24;
         float ppH0 = ppWave(position);
         float ppHa = ppWave(position + ppTa * ppE);
         float ppHb = ppWave(position + ppTb * ppE);
         objectNormal = normalize(ppN - (ppTa * (ppHa - ppH0) + ppTb * (ppHb - ppH0)) * (2.4 / ppE));`
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         transformed += ppN * ppH0;`
      );
    };
    const water = new THREE.Mesh(new THREE.SphereGeometry(SEA_R, 72, 48), waterMat);
    water.renderOrder = 2;
    planet.add(water);

    // --- atmosphere rim ---------------------------------------------------
    const atmoUniforms = {
      uColor: { value: new THREE.Color(0x9fd8f6) },
      uStrength: { value: 0.9 },
      uPow: { value: 2.6 }
    };
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(13.2, 48, 32),
      new THREE.ShaderMaterial({
        uniforms: atmoUniforms,
        transparent: true, depthWrite: false, side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        vertexShader: `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uStrength; uniform float uPow;
          varying vec3 vN; varying vec3 vV;
          void main() {
            float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
            gl_FragColor = vec4(uColor * f * uStrength, f * uStrength);
          }`
      })
    );
    atmosphere.renderOrder = 1;
    planet.add(atmosphere);

    // --- stars ------------------------------------------------------------
    const starMat = new THREE.PointsMaterial({
      size: 2.7, sizeAttenuation: false, transparent: true, opacity: 0,
      depthWrite: false, vertexColors: true
    });
    (function makeStars() {
      const n = 620;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const rnd = rngFrom(seed ^ 0xabcdef);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - z * z));
        const r = 150;
        pos[i * 3] = Math.cos(a) * s * r;
        pos[i * 3 + 1] = z * r;
        pos[i * 3 + 2] = Math.sin(a) * s * r;
        c.setHSL(0.55 + rnd() * 0.12, 0.35, 0.72 + rnd() * 0.28);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const stars = new THREE.Points(g, starMat);
      stars.frustumCulled = false;
      scene.add(stars);
    })();

    // --- clouds -----------------------------------------------------------
    const cloudGroup = new THREE.Group();
    planet.add(cloudGroup);
    // Opaque on purpose: as a transparent object the cloud layer sorted behind
    // the sea sphere and the horizon sliced straight through every cloud.
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const CLOUD_PUFFS = 66;
    const cloudMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cloudMat, CLOUD_PUFFS);
    cloudMesh.castShadow = true;
    cloudMesh.frustumCulled = false;
    cloudMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    cloudGroup.add(cloudMesh);
    (function makeClouds() {
      const rnd = rngFrom(seed ^ 0x1357911);
      let n = 0;
      const up = V(), t1 = V(), t2 = V(), p = V(), q = new THREE.Quaternion(), s = V();
      for (let c = 0; c < 15 && n < CLOUD_PUFFS; c++) {
        const z = rnd() * 1.7 - 0.85, a = rnd() * Math.PI * 2, sn = Math.sqrt(Math.max(0, 1 - z * z));
        up.set(Math.cos(a) * sn, z, Math.sin(a) * sn).normalize();
        t1.crossVectors(up, Math.abs(up.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
        t2.crossVectors(up, t1).normalize();
        const rad = 14.1 + rnd() * 1.6;
        const puffs = 3 + Math.floor(rnd() * 2);
        for (let k = 0; k < puffs && n < CLOUD_PUFFS; k++, n++) {
          p.copy(up).multiplyScalar(rad)
            .addScaledVector(t1, (rnd() - 0.5) * 1.7)
            .addScaledVector(t2, (rnd() - 0.5) * 1.1);
          const sc = 0.30 + rnd() * 0.32;
          s.set(sc * 1.35, sc * 0.72, sc * 1.1);
          q.setFromAxisAngle(up, rnd() * Math.PI * 2);
          cloudMesh.setMatrixAt(n, tmpM.compose(p, q, s));
        }
      }
      cloudMesh.count = n;
      cloudMesh.instanceMatrix.needsUpdate = true;
    })();

    // --- birds ------------------------------------------------------------
    const birds = [];
    (function makeBirds() {
      const rnd = rngFrom(seed ^ 0x24680);
      const wingGeo = new THREE.BufferGeometry();
      wingGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        0, 0, 0.16, 0.46, 0.06, -0.14, 0, 0, -0.14
      ]), 3));
      wingGeo.computeVertexNormals();
      const wingMat = new THREE.MeshBasicMaterial({ color: 0x7d93a3, side: THREE.DoubleSide });
      for (let i = 0; i < 5; i++) {
        const g = new THREE.Group();
        const l = new THREE.Mesh(wingGeo, wingMat);
        const r = new THREE.Mesh(wingGeo, wingMat);
        r.scale.x = -1;
        g.add(l); g.add(r);
        const s = 0.28 + rnd() * 0.20;
        g.scale.setScalar(s);
        planet.add(g);
        birds.push({
          g: g, l: l, r: r,
          axis: V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
          phase: rnd() * Math.PI * 2,
          rad: 12.8 + rnd() * 1.6,
          speed: 0.10 + rnd() * 0.07,
          flap: 5 + rnd() * 3
        });
      }
    })();

    // =====================================================================
    // 9. THE CHARACTER
    //    Modelled facing +Z with +Y up, then re-based every frame onto the
    //    tangent frame of wherever it is standing on the globe.
    // =====================================================================
    // Hair stays mid-tone: near-black caps turned into a featureless blob from
    // behind, which is the angle you see almost all the time.
    const OUTFITS = [
      { body: 0xf07a68, hair: 0x8a5a3c, hat: 0xfff0d6 },
      { body: 0x66b6e8, hair: 0x4d4657, hat: 0xffe9a8 },
      { body: 0xffd166, hair: 0xa4593a, hat: 0xf28fb0 },
      { body: 0x9d7ce0, hair: 0x3f5464, hat: 0xd7f5ff },
      { body: 0x5fcf9a, hair: 0x8d5238, hat: 0xffd6ea },
      { body: 0xf6f2ea, hair: 0xd0673f, hat: 0x88d5f0 }
    ];

    const charGroup = new THREE.Group();
    planet.add(charGroup);
    const charTilt = new THREE.Group();          // lean + bob live here
    charGroup.add(charTilt);

    const matSkin = new THREE.MeshLambertMaterial({ color: 0xffd9b8 });
    const matBody = new THREE.MeshLambertMaterial({ color: OUTFITS[0].body });
    const matHair = new THREE.MeshLambertMaterial({ color: OUTFITS[0].hair });
    const matHat  = new THREE.MeshLambertMaterial({ color: OUTFITS[0].hat });
    const matDark = new THREE.MeshBasicMaterial({ color: 0x2a2530 });
    const matBlush= new THREE.MeshBasicMaterial({ color: 0xff9fb0, transparent: true, opacity: 0.55 });

    const chLeg = [], chArm = [];
    (function buildChar() {
      function add(geo, mat, x, y, z, parent) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        (parent || charTilt).add(m);
        return m;
      }
      const legGeo = new THREE.CapsuleGeometry(0.072, 0.13, 3, 8);
      for (let s = -1; s <= 1; s += 2) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.098, 0.20, 0);
        charTilt.add(pivot);
        add(legGeo, matHair, 0, -0.10, 0, pivot);
        chLeg.push(pivot);
      }
      add(new THREE.CapsuleGeometry(0.152, 0.17, 4, 12), matBody, 0, 0.40, 0);
      const armGeo = new THREE.CapsuleGeometry(0.062, 0.13, 3, 8);
      for (let s = -1; s <= 1; s += 2) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.178, 0.50, 0);
        charTilt.add(pivot);
        add(armGeo, matBody, 0, -0.09, 0, pivot);
        add(new THREE.SphereGeometry(0.056, 8, 6), matSkin, 0, -0.17, 0, pivot);
        chArm.push(pivot);
      }
      // scarf
      const sc = add(new THREE.TorusGeometry(0.135, 0.046, 6, 14), matHat, 0, 0.585, 0);
      sc.rotation.x = Math.PI / 2;
      // head, hair cap, face
      add(new THREE.SphereGeometry(0.285, 18, 14), matSkin, 0, 0.86, 0);
      const cap = add(new THREE.SphereGeometry(0.298, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.46), matHair, 0, 0.855, -0.016);
      cap.rotation.x = -0.20;
      for (let s = -1; s <= 1; s += 2) {
        add(new THREE.SphereGeometry(0.040, 8, 6), matDark, s * 0.098, 0.878, 0.248);
        const b = add(new THREE.SphereGeometry(0.056, 8, 6), matBlush, s * 0.192, 0.802, 0.196);
        b.castShadow = false;
      }
      // a small back-ribbon that lifts when running
      const rib = add(new THREE.BoxGeometry(0.12, 0.28, 0.02), matHat, 0, 0.50, -0.165);
      chArm.ribbon = rib;
    })();

    function applyOutfit(i) {
      outfit = ((i % OUTFITS.length) + OUTFITS.length) % OUTFITS.length;
      const o = OUTFITS[outfit];
      matBody.color.setHex(o.body);
      matHair.color.setHex(o.hair);
      matHat.color.setHex(o.hat);
    }
    applyOutfit(outfit);

    // Splash rings shown while swimming / when entering water.
    const ripples = [];
    (function makeRipples() {
      const g = new THREE.RingGeometry(0.22, 0.30, 20);
      const m = new THREE.MeshBasicMaterial({
        color: 0xdff6ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
      });
      for (let i = 0; i < 4; i++) {
        const mesh = new THREE.Mesh(g, m.clone());
        mesh.visible = false;
        mesh.renderOrder = 3;
        planet.add(mesh);
        ripples.push({ mesh: mesh, life: 0 });
      }
    })();
    let rippleCursor = 0, rippleTimer = 0;
    function spawnRipple() {
      const r = ripples[rippleCursor];
      rippleCursor = (rippleCursor + 1) % ripples.length;
      r.life = 1;
      r.mesh.visible = true;
      const up = charPos;
      r.mesh.position.copy(up).multiplyScalar(SEA_R + 0.02);
      r.mesh.quaternion.setFromUnitVectors(V(0, 0, 1), up);
    }

    // ---------------------------------------------------------------------
    // Placement / orientation state.
    // ---------------------------------------------------------------------
    charPos = V(0, 1, 0);
    const charHeading = V(0, 0, 1);
    let charR = LEVEL_R[3];
    let swimBlend = 0, walkPhase = 0, moveAmt = 0;

    function placeCharacter() {
      const saved = (loaded && loaded.c && loaded.c.length === 3) ? loaded.c : null;
      if (saved && isFinite(saved[0]) && isFinite(saved[1]) && isFinite(saved[2])) {
        const v = V(saved[0], saved[1], saved[2]);
        if (v.lengthSq() > 1e-6) { charPos.copy(v).normalize(); return; }
      }
      // Otherwise start somewhere pleasant: grassy, away from the ice caps.
      let best = -1, bestScore = -Infinity;
      const d = V();
      for (let i = 0; i < TILES; i++) {
        if (isWater(i)) continue;
        dirOf(i, d);
        const bi = tBiome[i];
        let s = 0;
        if (bi === B_GRASS) s = 3;
        else if (bi === B_MEADOW) s = 2.4;
        else if (bi === B_FOREST) s = 1.6;
        else if (bi === B_SAND) s = 1.2;
        else s = 0.2;
        s -= Math.abs(d.y) * 2.2;                 // prefer temperate latitudes
        s += hash2(i, 29) * 0.5;
        if (s > bestScore) { bestScore = s; best = i; }
      }
      if (best >= 0) dirOf(best, charPos);
      charPos.normalize();
    }
    placeCharacter();

    // Keep the heading exactly tangent to the surface at all times.
    function orthoHeading() {
      charHeading.addScaledVector(charPos, -charHeading.dot(charPos));
      if (charHeading.lengthSq() < 1e-8) {
        charHeading.crossVectors(charPos, Math.abs(charPos.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0));
      }
      charHeading.normalize();
    }
    orthoHeading();
    charR = LEVEL_R[tLevel[dirToTile(charPos)]];

    // Rotate `dir` toward `target` around `axis` by at most `maxStep` radians.
    function turnToward(dir, target, axis, maxStep) {
      const d = clamp(dir.dot(target), -1, 1);
      const ang = Math.acos(d);
      if (ang < 1e-4) { dir.copy(target); return; }
      const step = Math.min(ang, maxStep);
      const s = axis.dot(tmpC.crossVectors(dir, target)) >= 0 ? 1 : -1;
      dir.applyAxisAngle(axis, s * step).normalize();
    }

    // =====================================================================
    // 10. PROPS
    //     Everything standing on the planet is drawn from a handful of shared
    //     InstancedMeshes, so a fully built world is still only ~8 draw calls.
    //     Geometries are pre-translated so their origin sits at the base,
    //     which makes "grow upward from the ground" a plain Y scale.
    // =====================================================================
    const matBlob = new THREE.MeshLambertMaterial({ flatShading: true });
    const matGlowWarm = new THREE.MeshLambertMaterial({
      flatShading: true, emissive: 0xffb763, emissiveIntensity: 0
    });
    const matGlowCool = new THREE.MeshLambertMaterial({
      flatShading: true, emissive: 0x66f0d8, emissiveIntensity: 0
    });
    // A soft additive bloom around lanterns and mushrooms, faded in by night.
    const haloMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
    });

    function baseAt(geo) { geo.translate(0, 0.5, 0); return geo; }
    const PART_DEFS = [
      ["blob",  new THREE.IcosahedronGeometry(1, 0),                        matBlob,      4200],
      ["trunk", baseAt(new THREE.CylinderGeometry(0.62, 1, 1, 6, 1)),       matBlob,       800],
      ["pine",  baseAt(new THREE.ConeGeometry(1, 1, 7)),                    matBlob,      1600],
      ["stem",  baseAt(new THREE.CylinderGeometry(1, 1, 1, 5, 1)),          matBlob,      2700],
      ["box",   baseAt(new THREE.BoxGeometry(1, 1, 1)),                     matBlob,      1600],
      ["cone4", baseAt(new THREE.ConeGeometry(1, 1, 4)),                    matBlob,      1300],
      ["glowW", new THREE.IcosahedronGeometry(1, 0),                        matGlowWarm,  1200],
      ["glowC", new THREE.IcosahedronGeometry(1, 0),                        matGlowCool,  1600],
      ["blade", baseAt(new THREE.BoxGeometry(1, 1, 1)),                     matBlob,       600],
      ["halo",  new THREE.IcosahedronGeometry(1, 1),                        haloMat,       600]
    ];
    const parts = {};
    for (let i = 0; i < PART_DEFS.length; i++) {
      const d = PART_DEFS[i];
      const mesh = new THREE.InstancedMesh(d[1], d[2], d[3]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, COL.snow);       // force the colour buffer into being
      planet.add(mesh);
      parts[d[0]] = { mesh: mesh, n: 0, max: d[3] };
    }
    const haloMesh = parts.halo.mesh;
    haloMesh.castShadow = false;
    haloMesh.receiveShadow = false;
    haloMesh.renderOrder = 7;
    haloMesh.visible = false;

    const _lp = V(), _ls = V(), _lq = new THREE.Quaternion(), _le = new THREE.Euler();
    const _lm = new THREE.Matrix4(), _wm = new THREE.Matrix4();
    const _pc = new THREE.Color();

    function partPush(name, m, color) {
      const p = parts[name];
      if (!p || p.n >= p.max) return;      // silently degrade rather than throw
      p.mesh.setMatrixAt(p.n, m);
      p.mesh.setColorAt(p.n, color);
      p.n++;
    }
    // Place one part in a tile's local frame: position, scale, optional euler.
    function emit(name, base, px, py, pz, sx, sy, sz, color, rx, ry, rz) {
      _lp.set(px, py, pz);
      _ls.set(sx, sy, sz);
      if (rx || ry || rz) _lq.setFromEuler(_le.set(rx || 0, ry || 0, rz || 0));
      else _lq.identity();
      _lm.compose(_lp, _lq, _ls);
      _wm.multiplyMatrices(base, _lm);
      partPush(name, _wm, color);
    }

    // Dedicated temps — emitters must never clobber the shared tmp vectors.
    const _bu = V(), _bx = V(), _bz = V(), _bh = V();
    function tileBase(i, out, rLift) {
      const up = dirOf(i, _bu);
      const rr = LEVEL_R[tLevel[i]] + (rLift || 0);
      _bh.set(0, 1, 0);
      if (Math.abs(up.y) > 0.9) _bh.set(1, 0, 0);
      _bx.crossVectors(_bh, up).normalize();
      _bz.crossVectors(up, _bx).normalize();
      out.makeBasis(_bx, up, _bz);
      out.setPosition(up.x * rr, up.y * rr, up.z * rr);
      _lm.makeRotationY(hash2(i, 41) * Math.PI * 2);
      out.multiply(_lm);
      return out;
    }

    // ---------------------------------------------------------------------
    // Model tables.
    // ---------------------------------------------------------------------
    //  trunk height, trunk radius scale, then [yOffset, radius] per canopy tier
    const TREE_STAGE = [
      { h: 0.15, r: 0.45, tiers: [[0.18, 0.150]] },
      { h: 0.31, r: 0.62, tiers: [[0.39, 0.240]] },
      { h: 0.47, r: 0.80, tiers: [[0.57, 0.310], [0.77, 0.230]] },
      { h: 0.61, r: 0.96, tiers: [[0.72, 0.375], [0.95, 0.292], [1.14, 0.205]] },
      { h: 0.78, r: 1.14, tiers: [[0.91, 0.440], [1.20, 0.348], [1.45, 0.248]] }
    ];
    const TRUNK_C  = [new THREE.Color(0x7a5334), new THREE.Color(0x6a4a3c), new THREE.Color(0x8a6446)];
    const LEAF_C   = [new THREE.Color(0x5cae4f), new THREE.Color(0x82cc60), new THREE.Color(0x4c9a55)];
    const PINE_C   = [new THREE.Color(0x3f8a5c), new THREE.Color(0x51a066), new THREE.Color(0x67b775)];
    const BLOSSOM_C= [new THREE.Color(0xf9c2d6), new THREE.Color(0xffdcea), new THREE.Color(0xf7a9c6)];
    const FLOWER_C = [0xff8fa8, 0xffd166, 0xf6f4ef, 0xc8a2e8, 0xff9f5a, 0x8fd9ff];
    const ROCK_C   = [new THREE.Color(0xa39a8c), new THREE.Color(0x8d8578), new THREE.Color(0xb8b0a2)];
    const HOUSE_W  = [new THREE.Color(0xfbf3e4), new THREE.Color(0xf3e2cc), new THREE.Color(0xe9eef2)];
    const HOUSE_R  = [new THREE.Color(0xd0705a), new THREE.Color(0x6f97b0), new THREE.Color(0x8a6f9e), new THREE.Color(0xc98f4e)];

    function speciesOf(i) { return Math.floor(hash2(i, 53) * 3) % 3; }
    function stageOf(rec, now) {
      if (!rec || rec.t <= 0) return 3;                 // natural trees start grown
      const age = now - rec.t;
      let s = 0;
      for (let k = 1; k < GROW_MS.length; k++) if (age >= GROW_MS[k]) s = k;
      return s;
    }

    function emitTree(i, base, stage, pop) {
      const sp = speciesOf(i);
      const st = TREE_STAGE[clamp(stage, 0, 4)];
      const jitter = 0.86 + hash2(i, 59) * 0.30;
      const k = jitter * pop;
      _pc.copy(TRUNK_C[Math.floor(hash2(i, 61) * 3) % 3]).offsetHSL(0, 0, (hash2(i, 67) - 0.5) * 0.07);
      const tw = 0.055 * st.r * jitter;
      emit(sp === 1 ? "stem" : "trunk", base, 0, 0, 0, tw, st.h * k, tw, _pc);

      const leafSet = sp === 1 ? PINE_C : (sp === 2 ? BLOSSOM_C : LEAF_C);
      for (let t = 0; t < st.tiers.length; t++) {
        const ty = st.tiers[t][0] * k, tr = st.tiers[t][1] * jitter * pop;
        // Conifer tiers are keyed to their height so the steps stay legible
        // from overhead; broadleaf blobs can pick freely.
        _pc.copy(sp === 1 ? leafSet[Math.min(t, 2)]
                          : leafSet[(t + Math.floor(hash2(i, 71 + t) * 3)) % 3])
           .offsetHSL((hash2(i, 79 + t) - 0.5) * 0.02, 0, (hash2(i, 83 + t) - 0.5) * 0.06);
        if (sp === 1) {
          emit("pine", base, 0, ty - tr * 0.46, 0, tr * 1.48, tr * 1.72, tr * 1.48, _pc);
        } else {
          emit("blob", base, (hash2(i, 89 + t) - 0.5) * tr * 0.36, ty,
                             (hash2(i, 97 + t) - 0.5) * tr * 0.36,
                             tr * 1.12, tr * 0.94, tr * 1.12, _pc);
        }
      }
      // Ancient trees flower / fruit.
      if (stage >= 4 && sp !== 1) {
        const top = st.tiers[0];
        for (let b = 0; b < 3; b++) {
          const a = hash2(i, 101 + b) * Math.PI * 2, rr = top[1] * 1.05 * jitter;
          _pc.setHex(sp === 2 ? 0xff8fbd : 0xff7a5c);
          emit("blob", base, Math.cos(a) * rr, (top[0] + 0.1 + hash2(i, 103 + b) * 0.34) * k,
                             Math.sin(a) * rr, 0.052 * pop, 0.052 * pop, 0.052 * pop, _pc);
        }
      }
    }

    function emitFlowers(i, base, pop) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + hash2(i, 107) * 6.28;
        const rr = 0.14 + hash2(i, 109 + k) * 0.20;
        const hh = (0.13 + hash2(i, 113 + k) * 0.10) * pop;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        _pc.setHex(0x5fa64c).offsetHSL(0, 0, (hash2(i, 127 + k) - 0.5) * 0.08);
        emit("stem", base, x, 0, z, 0.012, hh, 0.012, _pc);
        _pc.setHex(FLOWER_C[Math.floor(hash2(i, 131 + k) * FLOWER_C.length) % FLOWER_C.length]);
        emit("blob", base, x, hh + 0.02, z, 0.055 * pop, 0.042 * pop, 0.055 * pop, _pc);
      }
    }

    function emitRocks(i, base, pop, natural) {
      const n = natural ? 1 + Math.floor(hash2(i, 157) * 2) : 3;
      let y = 0;
      for (let k = 0; k < n; k++) {
        const sc = (natural ? 0.16 + hash2(i, 163 + k) * 0.12 : 0.19 - k * 0.042) * pop;
        _pc.copy(ROCK_C[Math.floor(hash2(i, 167 + k) * 3) % 3]).offsetHSL(0, 0, (hash2(i, 173 + k) - 0.5) * 0.09);
        emit("blob", base,
             (hash2(i, 179 + k) - 0.5) * (natural ? 0.34 : 0.08), y + sc * 0.62,
             (hash2(i, 181 + k) - 0.5) * (natural ? 0.34 : 0.08),
             sc * 1.25, sc, sc * 1.1, _pc,
             hash2(i, 191 + k) * 0.6, hash2(i, 193 + k) * 3, hash2(i, 197 + k) * 0.6);
        y += sc * 1.25;
      }
    }

    function emitHouse(i, base, pop) {
      const v = Math.floor(hash2(i, 199) * HOUSE_R.length) % HOUSE_R.length;
      const w = 0.50 * pop, h = 0.38 * pop, d = 0.44 * pop;
      _pc.copy(HOUSE_W[Math.floor(hash2(i, 211) * 3) % 3]);
      emit("box", base, 0, 0, 0, w, h, d, _pc);
      _pc.copy(HOUSE_R[v]).offsetHSL(0, 0, (hash2(i, 223) - 0.5) * 0.06);
      emit("cone4", base, 0, h, 0, 0.47 * pop, 0.33 * pop, 0.47 * pop, _pc, 0, Math.PI / 4, 0);
      _pc.setHex(0x6b4a33);
      emit("box", base, 0, 0, d * 0.5, 0.15 * pop, 0.23 * pop, 0.03, _pc);   // door
      _pc.setHex(0xfff0cf);
      emit("glowW", base, -0.15 * pop, h * 0.60, d * 0.5, 0.055 * pop, 0.055 * pop, 0.02, _pc);
      emit("glowW", base,  0.15 * pop, h * 0.60, d * 0.5, 0.055 * pop, 0.055 * pop, 0.02, _pc);
      _pc.copy(HOUSE_R[v]).offsetHSL(0, 0, -0.12);
      emit("box", base, w * 0.28, h + 0.10 * pop, -d * 0.18, 0.08 * pop, 0.22 * pop, 0.08 * pop, _pc);  // chimney
    }

    function emitLamp(i, base, pop) {
      _pc.setHex(0x4a4038);
      emit("stem", base, 0, 0, 0, 0.032 * pop, 0.60 * pop, 0.032 * pop, _pc);
      emit("box", base, 0, 0, 0, 0.14 * pop, 0.045 * pop, 0.14 * pop, _pc);
      _pc.setHex(0xffe6b0);
      emit("glowW", base, 0, 0.66 * pop, 0, 0.085 * pop, 0.105 * pop, 0.085 * pop, _pc);
      _pc.setHex(0x3f362e);
      emit("cone4", base, 0, 0.76 * pop, 0, 0.10 * pop, 0.08 * pop, 0.10 * pop, _pc, 0, Math.PI / 4, 0);
      _pc.setHex(0xffc879);
      emit("halo", base, 0, 0.66 * pop, 0, 0.54, 0.54, 0.54, _pc);
    }

    function emitMushrooms(i, base, pop) {
      for (let k = 0; k < 3; k++) {
        const a = hash2(i, 227 + k) * Math.PI * 2, rr = hash2(i, 229 + k) * 0.26;
        const hh = (0.09 + hash2(i, 233 + k) * 0.09) * pop;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        _pc.setHex(0xf4ece0);
        emit("stem", base, x, 0, z, 0.026 * pop, hh, 0.026 * pop, _pc);
        _pc.setHex(k % 2 ? 0x8ce8dc : 0xa8e0ff);
        emit("glowC", base, x, hh + 0.015, z, 0.10 * pop, 0.062 * pop, 0.10 * pop, _pc);
      }
      _pc.setHex(0x64ded0);
      emit("halo", base, 0, 0.12 * pop, 0, 0.30, 0.20, 0.30, _pc);
    }

    const mills = [];          // windmills get their sails spun every frame
    function emitMill(i, base, pop) {
      _pc.setHex(0xf1e6d2);
      emit("box", base, 0, 0, 0, 0.30 * pop, 0.60 * pop, 0.30 * pop, _pc);
      _pc.setHex(0x8a5f4a);
      emit("cone4", base, 0, 0.60 * pop, 0, 0.30 * pop, 0.22 * pop, 0.30 * pop, _pc, 0, Math.PI / 4, 0);
      _pc.setHex(0x5c4436);
      emit("stem", base, 0, 0.46 * pop, 0.17 * pop, 0.035 * pop, 0.06 * pop, 0.035 * pop, _pc, Math.PI / 2, 0, 0);
      mills.push({ base: base.clone(), pop: pop, seedA: hash2(i, 239) * 6.28 });
    }
    function updateMills(t) {
      const p = parts.blade;
      p.n = 0;
      const white = _pc.setHex(0xfaf4e8);
      for (let m = 0; m < mills.length; m++) {
        const mm = mills[m];
        const ang = mm.seedA + t * 1.15;
        for (let k = 0; k < 4; k++) {
          _le.set(0, 0, ang + k * Math.PI * 0.5);
          _lq.setFromEuler(_le);
          _lp.set(0, 0.46 * mm.pop, 0.215 * mm.pop);
          _ls.set(1, 1, 1);
          _lm.compose(_lp, _lq, _ls);
          _wm.multiplyMatrices(mm.base, _lm);
          _lp.set(0, 0.03, 0);
          _lq.identity();
          _ls.set(0.05 * mm.pop, 0.40 * mm.pop, 0.018 * mm.pop);
          _lm.compose(_lp, _lq, _ls);
          _wm.multiply(_lm);
          partPush("blade", _wm, white);
        }
      }
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }

    function emitPathPebbles(i, base) {
      for (let k = 0; k < 3; k++) {
        const a = hash2(i, 241 + k) * Math.PI * 2, rr = hash2(i, 251 + k) * 0.36;
        _pc.copy(COL.path).offsetHSL(0, 0, -0.10 + (hash2(i, 257 + k) - 0.5) * 0.08);
        emit("blob", base, Math.cos(a) * rr, 0.012, Math.sin(a) * rr,
             0.07, 0.022, 0.07, _pc, 0, hash2(i, 263 + k) * 3, 0);
      }
    }

    // =====================================================================
    // 11. PROP ASSEMBLY
    // =====================================================================
    let propsDirty = true;
    const popStart = new Map();       // tile -> ms, drives the place-down pop
    let statTrees = 0, statHouses = 0, statLife = 0;
    const growthStage = new Map();    // tile -> last stage we drew, for chimes

    function popScale(i, now) {
      const t0 = popStart.get(i);
      if (t0 === undefined) return 1;
      const k = (now - t0) / 520;
      if (k >= 1) { popStart.delete(i); return 1; }
      const e = 1 - Math.pow(1 - k, 3);
      return 0.15 + e * 0.85 + Math.sin(k * Math.PI) * 0.16;
    }

    const _base = new THREE.Matrix4();
    function rebuildProps(now) {
      for (const k in parts) if (k !== "blade") parts[k].n = 0;
      mills.length = 0;
      statTrees = 0; statHouses = 0; statLife = 0;

      const wall = Date.now();
      for (let i = 0; i < TILES; i++) {
        const c = contentOf(i);
        if (!c || c.type === P_EMPTY) continue;
        const pop = popScale(i, now);
        tileBase(i, _base);
        switch (c.type) {
          case P_TREE: {
            const s = stageOf(c, wall);
            emitTree(i, _base, s, pop);
            statTrees++;
            if (!c.nat) statLife += LIFE_PTS[s];
            if (!c.nat) {
              const prev = growthStage.get(i);
              if (prev !== undefined && s > prev) onTreeGrew(i, s);
              growthStage.set(i, s);
            }
            break;
          }
          case P_FLOWER: emitFlowers(i, _base, pop); if (!c.nat) statLife += 1; break;
          case P_PATH:   emitPathPebbles(i, _base); statLife += 1; break;
          case P_HOUSE:  emitHouse(i, _base, pop); statHouses++; statLife += 8; break;
          case P_LAMP:   emitLamp(i, _base, pop); statLife += 3; break;
          case P_MUSH:   emitMushrooms(i, _base, pop); statLife += 2; break;
          case P_MILL:   emitMill(i, _base, pop); statLife += 10; break;
          case P_ROCK:   emitRocks(i, _base, pop, !!c.nat); if (!c.nat) statLife += 1; break;
        }
      }
      for (const k in parts) {
        if (k === "blade") continue;
        const p = parts[k];
        p.mesh.count = p.n;
        p.mesh.instanceMatrix.needsUpdate = true;
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
      propsDirty = false;
      updateHud();
    }

    // =====================================================================
    // 12. LIGHT AND TIME
    //     One warm key light on an orbit, a cool hemisphere bounce, and a
    //     sky gradient that cross-fades through dawn, day, dusk and night.
    // =====================================================================
    const sun = new THREE.DirectionalLight(0xfff3dd, 2.15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 12;
    sun.shadow.camera.far = 62;
    sun.shadow.camera.left = -16.5; sun.shadow.camera.right = 16.5;
    sun.shadow.camera.top = 16.5;   sun.shadow.camera.bottom = -16.5;
    sun.shadow.bias = -0.0016;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    scene.add(sun.target);

    const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x6b7a55, 1.05);
    scene.add(hemi);
    const amb = new THREE.AmbientLight(0xffffff, 0.24);
    scene.add(amb);

    // The moon is a second, much softer key so the night side still reads.
    const moon = new THREE.DirectionalLight(0xa9c8ff, 0.2);
    scene.add(moon);
    scene.add(moon.target);

    const moonDiscMat = new THREE.MeshBasicMaterial({
      color: 0xfff4d4, transparent: true, opacity: 0, depthWrite: false, fog: false
    });
    const moonDisc = new THREE.Mesh(new THREE.IcosahedronGeometry(4.6, 2), moonDiscMat);
    moonDisc.visible = false;
    moonDisc.frustumCulled = false;
    scene.add(moonDisc);

    // Sky stops: [top, middle, bottom] per phase.
    const SKY_KEYS = [
      { t: 0.00, c: ["#0b1130", "#17244d", "#2c3c68"], sun: 0.00, hemi: 0.26, amb: 0.12, atm: "#5f7fd8", glow: 1.0, moonI: 0.78, sky: 0x47699f, gnd: 0x303a58 },
      { t: 0.12, c: ["#2c2a52", "#7a5570", "#e0906b"], sun: 0.60, hemi: 0.50, amb: 0.15, atm: "#f0a37e", glow: 0.55, moonI: 0.34, sky: 0x9a8fc4, gnd: 0x5e5a58 },
      { t: 0.22, c: ["#5aa8de", "#9fd2ee", "#ffd9ad"], sun: 1.60, hemi: 0.86, amb: 0.22, atm: "#ffc79a", glow: 0.16, moonI: 0.22, sky: 0xcfe4ff, gnd: 0x7b7a58 },
      { t: 0.38, c: ["#5fb6e8", "#9fdcf5", "#e6f6fb"], sun: 2.10, hemi: 1.06, amb: 0.26, atm: "#9fd8f6", glow: 0.0, moonI: 0.20, sky: 0xbfe6ff, gnd: 0x84895c },
      { t: 0.62, c: ["#5fb6e8", "#9fdcf5", "#e6f6fb"], sun: 2.10, hemi: 1.06, amb: 0.26, atm: "#9fd8f6", glow: 0.0, moonI: 0.20, sky: 0xbfe6ff, gnd: 0x84895c },
      { t: 0.76, c: ["#4a7fc4", "#eaa079", "#ffd0a0"], sun: 1.50, hemi: 0.84, amb: 0.22, atm: "#ffb489", glow: 0.22, moonI: 0.20, sky: 0xffd9bb, gnd: 0x7d7355 },
      { t: 0.87, c: ["#25315e", "#6d4a75", "#d97a63"], sun: 0.46, hemi: 0.48, amb: 0.15, atm: "#c98ab0", glow: 0.62, moonI: 0.38, sky: 0x9d86ad, gnd: 0x554e5c },
      { t: 1.00, c: ["#0b1130", "#17244d", "#2c3c68"], sun: 0.00, hemi: 0.26, amb: 0.12, atm: "#5f7fd8", glow: 1.0, moonI: 0.78, sky: 0x47699f, gnd: 0x303a58 }
    ];
    const _skyA = new THREE.Color(), _skyB = new THREE.Color(), _skyC = new THREE.Color();
    const _atmA = new THREE.Color(), _atmB = new THREE.Color();
    let nightMix = 0;          // 0 = full day, 1 = deepest night
    let dayPhase = 0.34;       // start mid-morning
    let skyString = "";

    function applySky(p) {
      let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
      for (let i = 0; i < SKY_KEYS.length - 1; i++) {
        if (p >= SKY_KEYS[i].t && p <= SKY_KEYS[i + 1].t) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
      }
      const span = Math.max(1e-5, b.t - a.t);
      const k = clamp((p - a.t) / span, 0, 1);
      const s = k * k * (3 - 2 * k);      // smoothstep between key frames

      _skyA.set(a.c[0]).lerp(_c.set(b.c[0]), s);
      _skyB.set(a.c[1]).lerp(_c.set(b.c[1]), s);
      _skyC.set(a.c[2]).lerp(_c.set(b.c[2]), s);
      const css = "linear-gradient(180deg," + _skyA.getStyle() + " 0%," +
                  _skyB.getStyle() + " 46%," + _skyC.getStyle() + " 100%)";
      if (css !== skyString) { skyString = css; root.style.background = css; }

      sun.intensity = lerp(a.sun, b.sun, s);
      hemi.intensity = lerp(a.hemi, b.hemi, s);
      amb.intensity = lerp(a.amb, b.amb, s);
      moon.intensity = lerp(a.moonI, b.moonI, s);
      _atmA.set(a.atm).lerp(_atmB.set(b.atm), s);
      atmoUniforms.uColor.value.copy(_atmA);

      nightMix = lerp(a.glow, b.glow, s);
      matGlowWarm.emissiveIntensity = nightMix * 1.25;
      matGlowCool.emissiveIntensity = nightMix * 1.05;
      starMat.opacity = Math.max(0, nightMix * 0.95 - 0.05);
      cloudMat.color.setRGB(1 - nightMix * 0.44, 1 - nightMix * 0.38, 1 - nightMix * 0.18);
      waterMat.shininess = 84 - nightMix * 44;
      // Tint the whole bounce toward moonlight at night; leaving it warm made
      // midnight grass read as a bright daytime green.
      hemi.color.set(a.sky).lerp(_c.set(b.sky), s);
      hemi.groundColor.set(a.gnd).lerp(_c.set(b.gnd), s);
      haloMat.opacity = nightMix * 0.72;
      haloMesh.visible = nightMix > 0.03;
      moonDisc.visible = nightMix > 0.02;
      moonDiscMat.opacity = Math.min(1, nightMix * 1.3);
      el.bSky.textContent = nightMix > 0.55 ? "🌙" : (nightMix > 0.15 ? "🌅" : "☀️");
    }

    // Sun on a slightly tilted orbit so the poles keep their long shadows.
    const SUN_TILT = 0.36;
    function positionSun(p) {
      const a = p * Math.PI * 2 - Math.PI * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      sun.position.set(ca * 34, Math.sin(SUN_TILT) * 12, sa * 34);
      sun.target.position.set(0, 0, 0);
      sun.target.updateMatrixWorld();
      moon.position.set(-ca * 34, -Math.sin(SUN_TILT) * 10, -sa * 34);
      moon.target.position.set(0, 0, 0);
      moon.target.updateMatrixWorld();
      moonDisc.position.copy(moon.position).setLength(112);
    }
    applySky(dayPhase);
    positionSun(dayPhase);

    // =====================================================================
    // 13. SOUND
    //     A tiny WebAudio synth for tactile one-shots (softer and better
    //     timed than generic stings), with ctx.music.sting as the fallback
    //     when WebAudio is unavailable, plus a cosy ctx.music bed.
    // =====================================================================
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canMusic = !!(ctx.capabilities && ctx.capabilities.backgroundMusic);
    let AC = null, masterGain = null, muted = false, musicHandle = null;

    function initAudio() {
      if (AC || !canAudio) return;
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        AC = new Ctor();
        masterGain = AC.createGain();
        masterGain.gain.value = 0.5;
        masterGain.connect(AC.destination);
        ctx.onDestroy(() => { try { AC.close(); } catch (_) {} });
      } catch (_) { AC = null; }
    }
    function resumeAudio() {
      if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} }
    }
    function tone(freq, dur, type, vol, when, glideTo) {
      if (!AC || muted) return;
      const t0 = AC.currentTime + (when || 0);
      const o = AC.createOscillator();
      const g = AC.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(masterGain);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
    let noiseBuf = null;
    function noise(dur, vol, cutoff, when, sweepTo) {
      if (!AC || muted) return;
      if (!noiseBuf) {
        noiseBuf = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.5), AC.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = AC.currentTime + (when || 0);
      const s = AC.createBufferSource();
      s.buffer = noiseBuf;
      const f = AC.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(cutoff, t0);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(80, sweepTo), t0 + dur);
      const g = AC.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(masterGain);
      s.start(t0); s.stop(t0 + dur + 0.02);
    }
    function sting(name) {
      if (muted) return;
      if (!AC) {
        try { if (canMusic && ctx.music && ctx.music.sting) ctx.music.sting(name); } catch (_) {}
        return;
      }
      switch (name) {
        case "plant":
          tone(392, 0.20, "triangle", 0.16); tone(587.3, 0.16, "sine", 0.10, 0.04);
          noise(0.13, 0.05, 1600, 0, 500); break;
        case "place":
          tone(174.6, 0.16, "sine", 0.20, 0, 110); noise(0.09, 0.07, 900, 0, 320); break;
        case "clear":
          noise(0.26, 0.10, 2400, 0, 260); tone(280, 0.16, "sine", 0.07, 0, 150); break;
        case "grow":
          tone(659.3, 0.45, "sine", 0.11); tone(987.8, 0.42, "sine", 0.075, 0.06);
          tone(1318.5, 0.36, "sine", 0.045, 0.12); break;
        case "splash":
          noise(0.30, 0.11, 3200, 0, 420); break;
        case "nope":
          tone(146.8, 0.13, "sine", 0.10, 0, 104); break;
        case "pick":
          tone(880, 0.07, "triangle", 0.07); break;
        case "hello":
          tone(523.3, 0.30, "sine", 0.10); tone(784, 0.34, "sine", 0.08, 0.09);
          tone(1046.5, 0.40, "sine", 0.055, 0.18); break;
      }
    }
    function haptic(kind) { try { ctx.platform.haptic(kind); } catch (_) {} }

    async function startMusic() {
      if (!canMusic || muted || musicHandle || !ctx.music) return;
      try {
        if (ctx.music.unlock) await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "cozy", volume: 0.3, tempo: 74, intensity: 0.32,
          density: 0.36, scale: "pentatonic", fadeInMs: 2600
        });
      } catch (_) { musicHandle = null; }
    }
    ctx.onDestroy(() => { try { if (musicHandle && musicHandle.stop) musicHandle.stop({ fadeOutMs: 260 }); } catch (_) {} });

    // =====================================================================
    // 14. SPARKLES
    // =====================================================================
    const SPARKS = 150;
    const sparkPos = new Float32Array(SPARKS * 3);
    const sparkCol = new Float32Array(SPARKS * 3);
    const sparkVel = new Float32Array(SPARKS * 3);
    const sparkLife = new Float32Array(SPARKS);
    let sparkCursor = 0;
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
    sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
    const sparkMat = new THREE.PointsMaterial({
      size: 5.5, sizeAttenuation: false, transparent: true, opacity: 0.95,
      depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending
    });
    const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    sparkPoints.frustumCulled = false;
    sparkPoints.renderOrder = 8;
    planet.add(sparkPoints);
    for (let i = 0; i < SPARKS; i++) { sparkPos[i * 3 + 1] = 9999; }

    function burst(dir, radius, n, hex, spread) {
      const c = _c.setHex(hex);
      const up = tmpA.copy(dir).normalize();
      const t1 = tmpB.crossVectors(up, Math.abs(up.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
      const t2 = tmpD.crossVectors(up, t1).normalize();
      for (let k = 0; k < n; k++) {
        const i = sparkCursor; sparkCursor = (sparkCursor + 1) % SPARKS;
        const a = Math.random() * Math.PI * 2, r = Math.random() * (spread || 0.3);
        sparkPos[i * 3]     = up.x * radius + t1.x * Math.cos(a) * r + t2.x * Math.sin(a) * r;
        sparkPos[i * 3 + 1] = up.y * radius + t1.y * Math.cos(a) * r + t2.y * Math.sin(a) * r;
        sparkPos[i * 3 + 2] = up.z * radius + t1.z * Math.cos(a) * r + t2.z * Math.sin(a) * r;
        const sp = 0.6 + Math.random() * 1.1;
        sparkVel[i * 3]     = up.x * sp + (Math.random() - 0.5) * 0.7;
        sparkVel[i * 3 + 1] = up.y * sp + (Math.random() - 0.5) * 0.7;
        sparkVel[i * 3 + 2] = up.z * sp + (Math.random() - 0.5) * 0.7;
        sparkCol[i * 3] = c.r; sparkCol[i * 3 + 1] = c.g; sparkCol[i * 3 + 2] = c.b;
        sparkLife[i] = 1;
      }
      sparkGeo.getAttribute("position").needsUpdate = true;
      sparkGeo.getAttribute("color").needsUpdate = true;
    }
    function updateSparks(dt) {
      let any = false;
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) continue;
        any = true;
        sparkLife[i] -= dt * 1.15;
        const f = Math.max(0, sparkLife[i]);
        sparkPos[i * 3]     += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        sparkVel[i * 3]     *= 0.94; sparkVel[i * 3 + 1] *= 0.94; sparkVel[i * 3 + 2] *= 0.94;
        sparkCol[i * 3]     *= 0.965; sparkCol[i * 3 + 1] *= 0.965; sparkCol[i * 3 + 2] *= 0.965;
        if (f <= 0) { sparkPos[i * 3 + 1] = 9999; sparkLife[i] = 0; }
      }
      if (any) {
        sparkGeo.getAttribute("position").needsUpdate = true;
        sparkGeo.getAttribute("color").needsUpdate = true;
      }
    }

    // =====================================================================
    // 15. ACTIONS
    // =====================================================================
    let tool = P_TREE;
    let targetTile = dirToTile(charPos);
    let focusTile = -1;              // a tapped tile stays targeted until you move
    let started = false, worldReady = false;
    let lastGrowChime = 0;
    let nowMs = 0;

    function toolDef(id) {
      for (let i = 0; i < TOOLS.length; i++) if (TOOLS[i].id === id) return TOOLS[i];
      return TOOLS[0];
    }
    function countType(t) {
      let n = 0;
      placed.forEach(r => { if (r.type === t) n++; });
      return n;
    }

    function onTreeGrew(i, stage) {
      if (nowMs - lastGrowChime > 1400) {
        lastGrowChime = nowMs;
        sting("grow");
        haptic("light");
        toast("🌿 Now a " + STAGE_NAME[clamp(stage, 0, 4)], 1700);
      }
      burst(dirOf(i, tmpC), LEVEL_R[tLevel[i]] + 0.7, 8, stage >= 4 ? 0xffd0e6 : 0xd6ffb0, 0.30);
    }

    function updateHud() {
      el.cTree.textContent = "🌳 " + statTrees;
      el.cHome.textContent = "🏠 " + statHouses;
      el.cLife.textContent = "✦ " + statLife;
    }

    // What would happen if BUILD were pressed on `i` right now.
    function buildCheck(i, t) {
      if (i < 0 || i >= TILES) return { ok: false, why: "Nowhere to build" };
      if (isWater(i)) return { ok: false, why: "That is water 🌊" };
      const cur = contentOf(i);
      if (t === P_EMPTY) {
        if (!cur || cur.type === P_EMPTY) return { ok: false, why: "Already clear" };
        return { ok: true };
      }
      if (cur && cur.type === t && !cur.nat) return { ok: false, why: "Already here" };
      const def = toolDef(t);
      if (countType(t) >= def.cap) return { ok: false, why: "That is as many as the planet holds" };
      return { ok: true };
    }

    let scoreTimer = null;
    function queueScore() {
      if (scoreTimer) clearTimeout(scoreTimer);
      scoreTimer = setTimeout(async () => {
        scoreTimer = null;
        try { ctx.platform.setScore(statLife); } catch (_) {}
        try {
          if (ctx.memory && ctx.memory.record) await ctx.memory.record("life").submit(statLife);
        } catch (_) {}
      }, 2500);
    }
    ctx.onDestroy(() => { if (scoreTimer) clearTimeout(scoreTimer); });

    function doBuild() {
      const i = targetTile;
      const chk = buildCheck(i, tool);
      if (!chk.ok) {
        toast(chk.why, 1300);
        sting("nope");
        haptic("warning");
        return;
      }
      const wasTrees = statTrees, wasHouses = statHouses;
      if (tool === P_EMPTY) {
        placed.set(i, { type: P_EMPTY, t: 0 });
        growthStage.delete(i);
        sting("clear");
        haptic("light");
        burst(dirOf(i, tmpC), LEVEL_R[tLevel[i]] + 0.25, 9, 0xe8dcc4, 0.34);
      } else {
        placed.set(i, { type: tool, t: tool === P_TREE ? Date.now() : 0 });
        popStart.set(i, nowMs);
        if (tool === P_TREE) {
          growthStage.set(i, 0);
          sting("plant");
          burst(dirOf(i, tmpC), LEVEL_R[tLevel[i]] + 0.3, 10, 0xbdf0a0, 0.28);
        } else {
          sting("place");
          burst(dirOf(i, tmpC), LEVEL_R[tLevel[i]] + 0.25, 8, 0xfff0c8, 0.30);
        }
        haptic(tool === P_HOUSE || tool === P_MILL ? "medium" : "light");
      }
      repaintTile(i);
      propsDirty = true;
      rebuildProps(nowMs);
      queueSave();
      queueScore();
      try { ctx.platform.interact({ type: "build", tool: toolDef(tool).nm.toLowerCase(), tile: i }); } catch (_) {}
      if (statTrees >= 10 && wasTrees < 10) { milestone("ten_trees", "Ten trees 🌳"); }
      if (statTrees >= 50 && wasTrees < 50) { milestone("fifty_trees", "A whole forest 🌲"); }
      if (statHouses >= 1 && wasHouses < 1) { milestone("first_home", "Home sweet home 🏠"); }
      if (statHouses >= 5 && wasHouses < 5) { milestone("village", "A little village 🏘️"); }
    }
    function milestone(name, msg) {
      try { ctx.platform.milestone(name, { life: statLife }); } catch (_) {}
      toast(msg, 2000);
      haptic("success");
    }

    function selectTool(id) {
      tool = id;
      const def = toolDef(id);
      el.build.textContent = "";
      el.build.appendChild(document.createTextNode(def.gl));
      const lab = document.createElement("span");
      lab.className = "lab";
      lab.textContent = def.lab;
      el.build.appendChild(lab);
      const kids = el.tools.children;
      for (let k = 0; k < kids.length; k++) {
        kids[k].classList.toggle("sel", parseInt(kids[k].dataset.id, 10) === id);
      }
      toast(def.hint, 2100);
      sting("pick");
      haptic("light");
    }

    // =====================================================================
    // 16. CAMERA
    //     Orbits the character in its own local frame, so walking over the
    //     horizon keeps the camera behind you and dragging spins the globe.
    // =====================================================================
    let camYaw = 0, camPitch = 0.42, camDist = 17.5, camDistGoal = 17.5, camSnap = true;
    const CAM_TILT = 0.12;         // aim slightly below the character
    const CAM_MIN = 9, CAM_MAX = 40;
    const camGoal = V(), camFocus = V();

    function updateCamera(dt) {
      const up = charPos;
      const look = tmpA.copy(charHeading).applyAxisAngle(up, camYaw).normalize();
      const od = tmpB.copy(up).multiplyScalar(Math.sin(camPitch))
                              .addScaledVector(look, -Math.cos(camPitch)).normalize();
      const focus = tmpC.copy(up).multiplyScalar(charR + 0.62);
      camDist += (camDistGoal - camDist) * damp(dt, 8);
      camGoal.copy(focus).addScaledVector(od, camDist);
      if (camSnap) {
        camera.position.copy(camGoal);
        camFocus.copy(focus);
        camSnap = false;
      } else {
        camera.position.lerp(camGoal, damp(dt, 9.5));
        camFocus.lerp(focus, damp(dt, 13));
      }
      camera.up.copy(up);
      camera.lookAt(camFocus);
      // Nudge the aim downward: looking straight at the character wasted the
      // top third of a portrait screen on empty sky.
      camera.rotateX(-CAM_TILT);
    }

    // =====================================================================
    // 17. INPUT
    // =====================================================================
    const pointers = new Map();
    let joyId = null;
    const camIds = [];
    let pinchStart = 0, pinchDistStart = 0;
    const joyVec = { x: 0, y: 0 };
    let walkTarget = null, walkTile = -1;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    function localXY(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function inJoyZone(p) {
      return p.x < ctx.width * 0.52 && p.y > ctx.height * 0.44;
    }
    function firstGesture() {
      if (started) return;
      started = true;
      try { ctx.platform.start(); } catch (_) {}
      initAudio();
      resumeAudio();
      startMusic();
    }

    ctx.listen(canvas, "pointerdown", e => {
      if (!worldReady) return;
      resumeAudio();
      const p = localXY(e);
      const rec = { x: p.x, y: p.y, sx: p.x, sy: p.y, t: e.timeStamp, moved: 0, mode: "cam" };
      if (joyId === null && inJoyZone(p)) {
        rec.mode = "joy";
        joyId = e.pointerId;
        joyVec.x = 0; joyVec.y = 0;
        el.joy.style.left = p.x + "px";
        el.joy.style.top = p.y + "px";
        el.knob.style.left = "50%";
        el.knob.style.top = "50%";
        el.joy.classList.add("show");
        walkTarget = null;
        focusTile = -1;
      } else {
        camIds.push(e.pointerId);
        if (camIds.length === 2) {
          const a = pointers.get(camIds[0]);
          if (a) {
            pinchDistStart = Math.hypot(a.x - p.x, a.y - p.y);
            pinchStart = camDistGoal;
          }
        }
      }
      pointers.set(e.pointerId, rec);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });

    ctx.listen(canvas, "pointermove", e => {
      const rec = pointers.get(e.pointerId);
      if (!rec) return;
      const p = localXY(e);
      const dx = p.x - rec.x, dy = p.y - rec.y;
      rec.moved += Math.hypot(dx, dy);
      rec.x = p.x; rec.y = p.y;

      if (rec.mode === "joy") {
        const ox = p.x - rec.sx, oy = p.y - rec.sy;
        const max = 56, len = Math.hypot(ox, oy);
        const k = len > max ? max / len : 1;
        joyVec.x = (ox * k) / max;
        joyVec.y = (oy * k) / max;
        el.knob.style.left = (50 + joyVec.x * 46) + "%";
        el.knob.style.top = (50 + joyVec.y * 46) + "%";
        if (len > 6) firstGesture();
        return;
      }
      if (camIds.length >= 2) {
        const a = pointers.get(camIds[0]), b = pointers.get(camIds[1]);
        if (a && b && pinchDistStart > 4) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          camDistGoal = clamp(pinchStart * (pinchDistStart / Math.max(8, d)), CAM_MIN, CAM_MAX);
        }
        return;
      }
      // single-finger drag orbits
      camYaw -= dx * 0.0062;
      camPitch = clamp(camPitch - dy * 0.0052, 0.12, 1.32);
    });

    function endPointer(e) {
      const rec = pointers.get(e.pointerId);
      if (!rec) return;
      pointers.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (rec.mode === "joy") {
        joyId = null;
        joyVec.x = 0; joyVec.y = 0;
        el.joy.classList.remove("show");
        if (rec.moved < 13 && (e.timeStamp - rec.t) < 420) { firstGesture(); handleTap(rec.sx, rec.sy); }
        return;
      }
      const idx = camIds.indexOf(e.pointerId);
      if (idx >= 0) camIds.splice(idx, 1);
      if (camIds.length < 2) pinchDistStart = 0;
      // A short, still press is a tap on the world.
      if (rec.moved < 13 && (e.timeStamp - rec.t) < 420 && camIds.length === 0) {
        firstGesture();
        handleTap(rec.sx, rec.sy);
      }
    }
    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);
    ctx.listen(canvas, "wheel", e => {
      e.preventDefault();
      camDistGoal = clamp(camDistGoal + e.deltaY * 0.014, CAM_MIN, CAM_MAX);
    }, { passive: false });

    function handleTap(px, py) {
      ndc.x = (px / Math.max(1, ctx.width)) * 2 - 1;
      ndc.y = -(py / Math.max(1, ctx.height)) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      // Tapping yourself changes your outfit — a small hidden delight.
      const me = raycaster.intersectObject(charGroup, true);
      if (me.length) {
        applyOutfit(outfit + 1);
        sting("pick");
        haptic("light");
        burst(charPos, charR + 1.05, 10, 0xfff0b8, 0.22);
        toast("New look ✨", 1100);
        queueSave();
        return;
      }
      const hit = raycaster.intersectObjects([terrain, water], false);
      if (!hit.length) return;
      const dir = tmpA.copy(hit[0].point).normalize();
      const tile = dirToTile(dir);
      const ang = Math.acos(clamp(dir.dot(charPos), -1, 1)) / TILE_ANG;
      if (ang > BUILD_RANGE) {
        // Too far to reach — walk there instead.
        walkTarget = dir.clone();
        walkTile = tile;
        focusTile = -1;
        toast("On my way…", 900);
      } else {
        focusTile = tile;
        walkTarget = null; walkTile = -1;
        const chk = buildCheck(tile, tool);
        if (!chk.ok && tool !== P_EMPTY) toast(chk.why, 1200);
      }
    }

    // =====================================================================
    // 18. UI WIRING
    // =====================================================================
    (function buildToolStrip() {
      for (let i = 0; i < TOOLS.length; i++) {
        const t = TOOLS[i];
        const b = document.createElement("button");
        b.className = "pp-tool";
        b.dataset.id = String(t.id);
        b.innerHTML = '<span class="gl">' + t.gl + '</span><span class="nm">' + t.nm + "</span>";
        ctx.listen(b, "click", () => { resumeAudio(); firstGesture(); selectTool(t.id); });
        el.tools.appendChild(b);
      }
    })();

    ctx.listen(el.build, "click", () => { resumeAudio(); firstGesture(); doBuild(); });

    ctx.listen(el.bSnd, "click", () => {
      muted = !muted;
      el.bSnd.textContent = muted ? "🔇" : "🔊";
      el.bSnd.classList.toggle("off", muted);
      if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
      try {
        if (muted) { if (musicHandle && musicHandle.stop) { musicHandle.stop({ fadeOutMs: 400 }); musicHandle = null; } }
        else startMusic();
      } catch (_) {}
      haptic("light");
    });

    ctx.listen(el.bSky, "click", () => {
      // A quick way to see your lanterns come on without waiting out the day.
      dayPhase = (nightMix > 0.5) ? 0.34 : 0.985;
      applySky(dayPhase);
      positionSun(dayPhase);
      toast(nightMix > 0.5 ? "Nightfall 🌙" : "Sunrise ☀️", 1300);
      sting("pick");
      haptic("light");
    });

    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, m =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
    }
    function lbNorm(e, i) {
      e = e || {};
      const name = e.name || e.displayName || e.username || e.handle ||
                   (e.user && (e.user.name || e.user.displayName || e.user.username)) || "Someone";
      const value = Number(e.value != null ? e.value : (e.score != null ? e.score : e.count)) || 0;
      const rank = Number(e.rank != null ? e.rank : i + 1) || (i + 1);
      const you = !!(e.you || e.isSelf || e.isYou || e.self || e.mine);
      return { name: name, value: value, rank: rank, you: you };
    }

    let sheetOpen = false, confirmReset = false;
    function closeSheet() {
      sheetOpen = false;
      confirmReset = false;
      el.sheet.classList.remove("show");
      el.sheet.classList.add("hide");
    }
    function openSheet() {
      sheetOpen = true;
      renderSheet();
      el.sheet.classList.remove("hide");
      el.sheet.classList.add("show");
      loadLeaderboard();
    }
    function renderSheet(lbHtml) {
      el.panel.innerHTML =
        '<h2>Your Pocket Planet</h2>' +
        '<p class="lead">A little world that keeps living while you are away.</p>' +
        '<div class="pp-stats">' +
          '<div class="pp-stat"><div class="v">' + statTrees + '</div><div class="l">TREES</div></div>' +
          '<div class="pp-stat"><div class="v">' + statHouses + '</div><div class="l">HOMES</div></div>' +
          '<div class="pp-stat"><div class="v">' + statLife + '</div><div class="l">LIFE</div></div>' +
        '</div>' +
        '<ul class="pp-list">' +
          '<li><span class="k">🕹️</span><span>Drag the <b>lower left</b> to walk. Your character keeps to the surface, and swims when the ground runs out.</span></li>' +
          '<li><span class="k">🌍</span><span>Drag <b>anywhere else</b> to spin the globe, and pinch to zoom out until you can see the whole thing.</span></li>' +
          '<li><span class="k">👆</span><span><b>Tap a tile</b> to aim at it. Tap somewhere far off and you will walk there by yourself.</span></li>' +
          '<li><span class="k">🌱</span><span>Pick a tool below, then press the <b>big round button</b> to place it on the glowing tile.</span></li>' +
          '<li><span class="k">⏳</span><span>Trees grow in <b>real time</b> — sprout, sapling, tree, then ancient and blossoming. Close the bit and they keep going.</span></li>' +
          '<li><span class="k">🌙</span><span>Day turns to night on its own. Lanterns, windows and mushrooms light up. Tap <b>☀️</b> to skip ahead.</span></li>' +
          '<li><span class="k">✨</span><span>Tap <b>your character</b> for a new look. Everything is saved automatically.</span></li>' +
        '</ul>' +
        '<div class="pp-lb">' + (lbHtml || '<div class="pp-lbrow"><span class="n">Loading the board…</span></div>') + '</div>' +
        '<button class="pp-danger">' + (confirmReset ? "Tap again to start a brand-new planet" : "Start a new planet…") + '</button>' +
        '<button class="pp-close">Back to my planet</button>';
      ctx.listen(el.panel.querySelector(".pp-close"), "click", () => { sting("pick"); closeSheet(); });
      ctx.listen(el.panel.querySelector(".pp-danger"), "click", () => {
        if (!confirmReset) { confirmReset = true; renderSheet(lastLbHtml); sting("nope"); return; }
        resetPlanet();
      });
    }
    let lastLbHtml = null;
    async function loadLeaderboard() {
      if (!ctx.memory || !ctx.memory.record) { lastLbHtml = ""; if (sheetOpen) renderSheet(""); return; }
      let lb = null;
      try { lb = await ctx.memory.record("life").leaderboard({ scope: "global", period: "all_time" }); }
      catch (_) { lb = null; }
      if (!sheetOpen) return;
      const raw = (lb && (lb.entries || lb.rows || lb.leaderboard || lb.top || lb.results)) || [];
      const entries = raw.map(lbNorm);
      let html = "";
      if (!entries.length) {
        html = '<div class="pp-lbrow"><span class="n">No planets on the board yet — grow yours ✦</span></div>';
      } else {
        const medal = ["🥇", "🥈", "🥉"];
        html = entries.slice(0, 8).map(e =>
          '<div class="pp-lbrow' + (e.you ? " me" : "") + '"><span class="r">' +
          (medal[e.rank - 1] || ("#" + e.rank)) + '</span><span class="n">' + esc(e.name) +
          '</span><span class="s">✦ ' + e.value + "</span></div>").join("");
      }
      lastLbHtml = html;
      renderSheet(html);
    }
    ctx.listen(el.bInfo, "click", () => { resumeAudio(); sting("pick"); haptic("light"); openSheet(); });
    ctx.listen(el.sheet, "pointerup", e => { if (e.target === el.sheet) closeSheet(); });

    // Re-roll the world in place. Everything downstream of the seed is
    // regenerated; nothing outside the bit is touched.
    function resetPlanet() {
      closeSheet();
      placed.clear();
      growthStage.clear();
      popStart.clear();
      mills.length = 0;
      seed = (Math.floor(Math.random() * 0xfffffff) ^ (Date.now() & 0xfffff)) >>> 0;
      seedNoise();
      generate();
      buildTerrain();
      repaintAll();
      placeCharacter();
      orthoHeading();
      charR = LEVEL_R[tLevel[dirToTile(charPos)]];
      walkTarget = null;
      focusTile = -1;
      camSnap = true;
      propsDirty = true;
      rebuildProps(nowMs);
      flushSave();
      toast("A brand-new world ✨", 2000);
      sting("hello");
      haptic("success");
      burst(charPos, charR + 1.1, 16, 0xfff0b8, 0.5);
    }

    // =====================================================================
    // 19. FRAME LOOP
    // =====================================================================
    function resize() {
      const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    let lastW = ctx.width, lastH = ctx.height;
    resize();

    const _mR = V(), _mF = V(), _mDir = V(), _mAxis = V(), _mTmp = V();
    let wasSwimming = false, nextGrowCheck = 0, breathT = 0;
    let quality = 2, slowFrames = 0, fastFrames = 0;

    function downgrade() {
      if (quality === 2) {
        quality = 1;
        try {
          if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
          sun.shadow.mapSize.set(512, 512);
        } catch (_) {}
        renderer.setPixelRatio(Math.min(ctx.nativeDpr || 1, 1.5));
      } else if (quality === 1) {
        quality = 0;
        renderer.shadowMap.enabled = false;
        terrain.castShadow = false;
        cloudMesh.castShadow = false;
        for (const k in parts) parts[k].mesh.castShadow = false;
        // Shadows carried a lot of the shaping, so lift the fill to compensate.
        amb.intensity += 0.12;
      }
    }

    function step(dtMs, timeMs) {
      const dt = Math.min(dtMs, 64) / 1000;
      nowMs = timeMs;

      if (lastW !== ctx.width || lastH !== ctx.height) {
        lastW = ctx.width; lastH = ctx.height; resize();
      }

      // ---- adaptive quality: keep the frame budget on weaker devices ----
      if (dtMs > 30) { slowFrames++; fastFrames = 0; } else { fastFrames++; if (fastFrames > 40) slowFrames = 0; }
      if (slowFrames > 48 && quality > 0) { downgrade(); slowFrames = 0; }

      // ---- time of day ----
      dayPhase = (dayPhase + (dt * 1000) / DAY_MS) % 1;
      applySky(dayPhase);
      positionSun(dayPhase);
      uTime.value = timeMs * 0.001;

      // ---- movement input ----
      let amount = 0;
      let haveDir = false;
      const jlen = Math.hypot(joyVec.x, joyVec.y);
      if (jlen > 0.12) {
        const e = camera.matrixWorld.elements;
        _mR.set(e[0], e[1], e[2]).addScaledVector(charPos, -(e[0] * charPos.x + e[1] * charPos.y + e[2] * charPos.z));
        _mF.set(-e[8], -e[9], -e[10]);
        _mF.addScaledVector(charPos, -_mF.dot(charPos));
        if (_mR.lengthSq() > 1e-6 && _mF.lengthSq() > 1e-6) {
          _mR.normalize(); _mF.normalize();
          _mDir.set(0, 0, 0).addScaledVector(_mR, joyVec.x).addScaledVector(_mF, -joyVec.y);
          if (_mDir.lengthSq() > 1e-6) { _mDir.normalize(); haveDir = true; amount = Math.min(1, jlen); }
        }
      } else if (walkTarget) {
        _mDir.copy(walkTarget).addScaledVector(charPos, -walkTarget.dot(charPos));
        const ang = Math.acos(clamp(walkTarget.dot(charPos), -1, 1));
        if (ang < TILE_ANG * 1.15 || _mDir.lengthSq() < 1e-7) {
          if (walkTile >= 0) focusTile = walkTile;
          walkTarget = null; walkTile = -1;
        } else {
          _mDir.normalize(); haveDir = true; amount = 1;
        }
      }

      if (haveDir) {
        _mAxis.crossVectors(charPos, _mDir);
        if (_mAxis.lengthSq() > 1e-8) {
          _mAxis.normalize();
          const sp = (swimBlend > 0.5 ? SWIM_SPEED : WALK_SPEED) * amount;
          charPos.applyAxisAngle(_mAxis, (sp * dt) / 10).normalize();
          _mTmp.copy(_mDir).addScaledVector(charPos, -_mDir.dot(charPos));
          if (_mTmp.lengthSq() > 1e-8) {
            _mTmp.normalize();
            turnToward(charHeading, _mTmp, charPos, 10 * dt);
          }
          orthoHeading();
        }
        // Walking releases a tapped tile once you have wandered off it.
        if (focusTile >= 0) {
          const fa = Math.acos(clamp(dirOf(focusTile, _mTmp).dot(charPos), -1, 1)) / TILE_ANG;
          if (fa > BUILD_RANGE) focusTile = -1;
        }
      }
      moveAmt += (amount - moveAmt) * damp(dt, 12);

      // ---- ground / water ----
      const standTile = dirToTile(charPos);
      const inWater = isWater(standTile);
      const goalR = inWater ? SEA_R : LEVEL_R[tLevel[standTile]];
      charR += (goalR - charR) * damp(dt, 11);
      swimBlend += ((inWater ? 1 : 0) - swimBlend) * damp(dt, 5.5);
      if (inWater !== wasSwimming) {
        wasSwimming = inWater;
        if (inWater) { sting("splash"); spawnRipple(); haptic("light"); }
      }
      if (inWater) {
        rippleTimer -= dt;
        if (rippleTimer <= 0) { rippleTimer = 0.34; spawnRipple(); }
      }

      // ---- character transform + animation ----
      _mTmp.crossVectors(charPos, charHeading);
      if (_mTmp.lengthSq() > 1e-8) {
        _mTmp.normalize();
        tmpM.makeBasis(_mTmp, charPos, charHeading);
        charGroup.quaternion.setFromRotationMatrix(tmpM);
      }
      charGroup.position.copy(charPos).multiplyScalar(charR - swimBlend * 0.36);

      breathT += dt;
      walkPhase += dt * (7.4 + moveAmt * 3.4) * Math.max(moveAmt, swimBlend * 0.55);
      const swim = swimBlend;
      const legSwing = Math.sin(walkPhase) * 0.72 * moveAmt * (1 - swim * 0.6);
      chLeg[0].rotation.x = legSwing;
      chLeg[1].rotation.x = -legSwing;
      const armBase = swim * 1.15;
      chArm[0].rotation.x = -Math.sin(walkPhase) * (0.58 * moveAmt + swim * 0.8) - armBase;
      chArm[1].rotation.x = Math.sin(walkPhase) * (0.58 * moveAmt + swim * 0.8) - armBase;
      chArm[0].rotation.z = swim * 0.5;
      chArm[1].rotation.z = -swim * 0.5;
      charTilt.position.y = Math.abs(Math.sin(walkPhase)) * 0.05 * moveAmt
                          + Math.sin(breathT * 1.9) * 0.012 * (1 - moveAmt)
                          + Math.sin(breathT * 2.4) * 0.03 * swim;
      charTilt.rotation.x = moveAmt * 0.13 + swim * 0.42;
      if (chArm.ribbon) {
        chArm.ribbon.rotation.x = -0.16 - moveAmt * 0.75 - swim * 0.5
                                + Math.sin(breathT * 7.5) * 0.16 * (moveAmt + swim * 0.5);
      }

      // ---- ripples ----
      for (let i = 0; i < ripples.length; i++) {
        const r = ripples[i];
        if (r.life <= 0) { if (r.mesh.visible) r.mesh.visible = false; continue; }
        r.life -= dt * 0.85;
        const k = 1 - Math.max(0, r.life);
        r.mesh.scale.setScalar(0.5 + k * 2.4);
        r.mesh.material.opacity = Math.max(0, (1 - k) * 0.55);
        if (r.life <= 0) r.mesh.visible = false;
      }

      // ---- camera ----
      updateCamera(dt);
      if (camYaw > Math.PI) camYaw -= Math.PI * 2;
      else if (camYaw < -Math.PI) camYaw += Math.PI * 2;
      if (moveAmt > 0.08 && camIds.length === 0) camYaw -= camYaw * damp(dt, 0.85);

      // ---- build target ----
      if (focusTile >= 0) {
        targetTile = focusTile;
      } else {
        const ca = Math.cos(TILE_ANG * 1.05), sb = Math.sin(TILE_ANG * 1.05);
        _mTmp.copy(charPos).multiplyScalar(ca).addScaledVector(charHeading, sb).normalize();
        targetTile = dirToTile(_mTmp);
      }
      setHighlight(targetTile, 0.035 + Math.sin(timeMs * 0.005) * 0.012);
      const ok = buildCheck(targetTile, tool).ok;
      hlMat.color.setHex(ok ? 0x9dffb0 : 0xff9c8a);
      hlMat.opacity = 0.30 + Math.sin(timeMs * 0.005) * 0.10 + (ok ? 0.16 : 0);
      el.build.classList.toggle("bad", !ok);

      // ---- growth ----
      if (timeMs > nextGrowCheck) {
        nextGrowCheck = timeMs + 1800;
        const wall = Date.now();
        let changed = false;
        placed.forEach((rec, i) => {
          if (rec.type !== P_TREE || rec.t <= 0) return;
          if (growthStage.get(i) !== stageOf(rec, wall)) changed = true;
        });
        if (changed) propsDirty = true;
      }
      if (popStart.size) propsDirty = true;
      if (propsDirty) rebuildProps(timeMs);
      if (mills.length) updateMills(timeMs * 0.001);

      // ---- ambience ----
      cloudGroup.rotation.y += dt * 0.0115;
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        b.phase += dt * b.speed;
        const c = Math.cos(b.phase), s2 = Math.sin(b.phase);
        _mTmp.set(0, 1, 0);
        if (Math.abs(b.axis.y) > 0.9) _mTmp.set(1, 0, 0);
        _mR.crossVectors(b.axis, _mTmp).normalize();
        _mF.crossVectors(b.axis, _mR).normalize();
        b.g.position.copy(_mR).multiplyScalar(c * b.rad).addScaledVector(_mF, s2 * b.rad);
        _mDir.copy(_mR).multiplyScalar(-s2).addScaledVector(_mF, c);
        b.g.up.copy(b.g.position).normalize();
        b.g.lookAt(_mTmp.copy(b.g.position).add(_mDir));
        const flap = Math.sin(timeMs * 0.001 * b.flap + b.phase * 3) * 0.55;
        b.l.rotation.z = flap;
        b.r.rotation.z = -flap;
      }
      updateSparks(dt);

      renderer.render(scene, camera);
    }

    // =====================================================================
    // 20. START
    // =====================================================================
    rebuildProps(0);
    updateCamera(0.016);
    renderer.render(scene, camera);
    worldReady = true;

    selectTool(P_TREE);
    el.toast.classList.remove("show");     // selectTool's hint would fire too early

    el.cta.disabled = false;
    el.cta.textContent = isReturning ? "Back to my planet 🌍" : "Begin 🌱";
    el.bar.style.display = "none";

    ctx.listen(el.cta, "click", () => {
      el.intro.classList.add("gone");
      el.build.style.display = "";
      el.tools.style.display = "";
      el.hud.style.display = "";
      ui.querySelector(".pp-topright").style.display = "";
      firstGesture();
      sting("hello");
      haptic("success");
      const def = toolDef(tool);
      toast(isReturning ? "Welcome back ✨" : def.hint, 2400);
      if (!isReturning) burst(charPos, charR + 1.1, 14, 0xfff0b8, 0.4);
      setTimeout(() => { try { el.intro.style.display = "none"; } catch (_) {} }, 600);
    });

    ctx.onFrame(step);

    // Persist on every exit path the host might use.
    ctx.listen(document, "visibilitychange", () => { if (document.hidden) flushSave(); });
    ctx.listen(window, "pagehide", flushSave);
    ctx.onDestroy(() => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } persist(); });

    safeReady();
  }
};
