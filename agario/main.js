/*
 * Petri Bloom — a cell-eating arena for one player and a dish full of bots.
 *
 * You are a blob in a petri dish. Everything smaller than you is food,
 * everything bigger is looking at you the same way, and the bigger you get
 * the slower you move. Split to lunge at prey and you are briefly two
 * fragile halves instead of one safe whole. The spiked viruses will burst
 * anything larger than they are, so late on the dish stops being empty
 * space and starts being a minefield.
 *
 * Packaged assets are disabled (maxAssets: 0), so the dish, the cells, the
 * membranes, the viruses and every sound are generated here: Canvas2D for
 * the world, a DOM overlay for the HUD, and WebAudio for the noise.
 */

window.plethoraBit = {
  meta: {
    title: "Petri Bloom",
    runtime: "plethora-bit@2",
    tags: ["arcade", "action", "io-game", "eat", "grow", "bots", "arena", "one-hand", "leaderboard", "survival"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    /* ================================================================ *
     * CREATOR TUNING
     * ================================================================ */
    const tune = ctx.tune || {};
    const tInt = (id, fb) => (tune.integer ? tune.integer(id) : undefined) ?? fb;
    const tNum = (id, fb) => (tune.number ? tune.number(id) : undefined) ?? fb;
    const tBool = (id, fb) => (tune.boolean ? tune.boolean(id) : undefined) ?? fb;
    const tChoice = (id, fb) => (tune.choice ? tune.choice(id) : undefined) ?? fb;

    const BOTS = tInt("bot_count", 28);
    const WORLD = tInt("world_size", 3600);
    const PELLETS = tInt("pellet_count", 1800);
    const VIRUSES = tInt("virus_count", 20);
    const START_MASS = tInt("start_mass", 50);
    const SPEED_BASE = tNum("speed_base", 520);
    const MERGE_SECONDS = tNum("merge_seconds", 8);
    const DECAY_RATE = tNum("decay_rate", 0.0022);
    const BOT_SKILL = tNum("bot_skill", 0.72);
    const SOUND_DEFAULT = tBool("sound_default", true);
    const HAPTICS_DEFAULT = tBool("haptics_default", true);
    const DISH = tChoice("dish_style", "night");

    /* ================================================================ *
     * CONSTANTS
     * Mass is the only real currency: radius, speed, what you can eat and
     * how far the camera pulls back are all read off it.
     * ================================================================ */
    const R_OF_MASS = 4;            // radius = R_OF_MASS * sqrt(mass)
    const EAT_RATIO = 1.2;          // you must be this much heavier to eat
    const EAT_COVER = 0.35;         // and cover this much of them
    const MAX_CELLS = 16;
    const SPLIT_MIN = 36;           // a cell below this cannot usefully split
    const SPLIT_IMPULSE = 800;
    const EJECT_COST = 17;
    const EJECT_MASS = 12;
    const EJECT_SPEED = 640;
    const VIRUS_MASS = 110;
    const VIRUS_POP_MIN = VIRUS_MASS * 1.25;
    const VIRUS_FEED = 7;           // ejected blobs before a virus shoots
    const PELLET_MASS = 3.6;
    // Glowing jackpots scattered through the dish: worth a dozen pellets,
    // and visible from far enough away to steer for.
    const BLOOM_COUNT = 26;
    const BLOOM_MASS = 22;
    const DECAY_FLOOR = 180;        // mass below this never rots
    const MAX_CELL_MASS = 22500;   // one cell can never eat the whole dish
    const FRICTION = 3.4;           // how fast a launch impulse bleeds off
    // You are the one being played, so loose mass is worth more to you
    // than to the bots grazing beside you. Without it the dish's own
    // economy outgrows you: at full value the leading bot reaches ten
    // thousand inside three minutes.
    const BOT_FEED = 0.6;

    const rOf = m => R_OF_MASS * Math.sqrt(m);
    // Rot speeds up past a size, so nothing outgrows the dish for long --
    // and for the bots it speeds up faster, so the dish's leader settles
    // somewhere you can catch instead of running away to five figures.
    const decayOf = (m, bot) => {
      const over = Math.max(0, m - 1500);
      return DECAY_RATE * (1 + over / 2500 + (bot ? (over / 2200) * (over / 2200) : 0));
    };

    const TIERS = [
      { m: 0, name: "Spore" },        { m: 100, name: "Microbe" },
      { m: 220, name: "Amoeba" },     { m: 450, name: "Paramecium" },
      { m: 900, name: "Colony" },     { m: 1800, name: "Organism" },
      { m: 3600, name: "Leviathan" }, { m: 7000, name: "Apex Bloom" }
    ];
    const tierOf = m => { let t = 0; while (t + 1 < TIERS.length && m >= TIERS[t + 1].m) t++; return t; };

    // The membrane: each cell carries a ring of radial offsets on springs.
    const TAU = Math.PI * 2;
    const RING_N = 20;
    const RCOS = new Float32Array(RING_N), RSIN = new Float32Array(RING_N);
    for (let i = 0; i < RING_N; i++) { RCOS[i] = Math.cos(i / RING_N * TAU); RSIN[i] = Math.sin(i / RING_N * TAU); }
    const speedOf = m => SPEED_BASE * Math.pow(Math.max(m, 1), -0.28);

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

    /* ================================================================ *
     * LOOK
     * ================================================================ */
    const DISHES = {
      night: { dark: true, outside: "#020407", floor: "#0d1a29",
               grid: "rgba(110,190,255,0.075)", speck: "rgba(150,215,255,0.17)", speckFar: "rgba(120,180,255,0.08)",
               wall: "#4fd2ff", vignette: "rgba(2,5,10,0.8)", ink: "#e9eef5" },
      clean: { dark: false, outside: "#c3ccd6", floor: "#eef3f8",
               grid: "rgba(30,70,120,0.08)", speck: "rgba(30,80,140,0.1)", speckFar: "rgba(30,80,140,0.05)",
               wall: "#7fa6d1", vignette: "rgba(150,168,190,0.35)", ink: "#1b2129" },
      warm:  { dark: true, outside: "#040302", floor: "#1a110a",
               grid: "rgba(255,190,120,0.075)", speck: "rgba(255,205,150,0.15)", speckFar: "rgba(255,180,120,0.07)",
               wall: "#ffb15a", vignette: "rgba(6,3,1,0.8)", ink: "#f6ecdf" }
    };
    const SKIN = DISHES[DISH] || DISHES.night;

    // Vivid, well separated hues: two cells should never be mistaken for
    // each other in a scrum.
    const BUILD = "pb-b6";
    const HUES = [4, 18, 34, 48, 62, 96, 140, 165, 186, 200, 214, 232, 258, 280, 300, 320, 340];
    const randHue = () => Math.floor(Math.random() * HUES.length);

    const BOT_NAMES = [
      "Nibbler", "Gulp", "Blobby", "Voracious", "Tiny Tim", "The Maw", "Bubbles", "Chomp",
      "Mitosis", "Spore", "Cytoplasm", "Vacuole", "Flagella", "Amoeba", "Paramecium",
      "Big Phil", "Snack", "Morsel", "Orbit", "Yolk", "Custard", "Marble", "Pip",
      "Plankton", "Krill", "Bloater", "Hoover", "Gobble", "Sir Eats", "Puddle",
      "Wobble", "Jelly", "Tapioca", "Boba", "Dumpling", "Gnocchi", "Mochi", "Pearl",
      "Comet", "Nucleus", "Ribosome", "Golgi", "Lipid", "Enzyme", "Culture", "Petri"
    ];

    const CSS = `
.pb{position:absolute;inset:0;overflow:hidden;
  font-family:ui-rounded,"SF Pro Rounded",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:${SKIN.ink};
  pointer-events:none!important}
.pb *{box-sizing:border-box}
.pb [hidden]{display:none!important}

/* ---- read-only HUD: never takes a touch ---- */
.pb-view{position:absolute;inset:0;pointer-events:none;
  padding:calc(var(--sat) + 10px) calc(var(--sar) + 12px) calc(var(--sab) + 10px) calc(var(--sal) + 12px)}
.pb-stats{position:absolute;left:calc(var(--sal) + 12px);top:calc(var(--sat) + 10px);
  display:flex;flex-direction:column;gap:3px;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.pb-tier{font-size:11px;font-weight:900;letter-spacing:.2em;text-transform:uppercase;color:var(--me,#7fe3ff)}
.pb-mass{font-size:36px;font-weight:900;line-height:.95;font-variant-numeric:tabular-nums;letter-spacing:-.02em;transform-origin:0 60%}
.pb-bar{position:relative;width:138px;height:7px;margin-top:4px;border-radius:4px;overflow:hidden;
  background:rgba(255,255,255,.13);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.pb-bar i{position:absolute;inset:0;border-radius:4px;transform-origin:0 50%;transform:scaleX(0);
  background:linear-gradient(90deg,var(--me,#3ddc84),#ffffff);transition:transform .28s ease-out}
.pb-next{font-size:10.5px;font-weight:800;letter-spacing:.05em;opacity:.62;margin-top:1px}
.pb-sub{font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;opacity:.6;margin-top:3px}
.pb-banner{position:absolute;left:0;right:0;top:max(27%,calc(var(--sat) + 236px));display:flex;flex-direction:column;
  align-items:center;gap:8px;pointer-events:none;text-align:center}
.pb-pop{display:flex;flex-direction:column;align-items:center;gap:3px;animation:pbPop 2.4s cubic-bezier(.2,.9,.25,1) forwards}
.pb-pop small{font-size:11px;font-weight:900;letter-spacing:.34em;text-transform:uppercase;color:var(--me,#7fe3ff);
  text-shadow:0 1px 6px rgba(0,0,0,.6)}
.pb-pop b{font-size:40px;font-weight:900;line-height:1;letter-spacing:-.01em;color:${SKIN.dark ? "#fff" : SKIN.ink};
  text-shadow:${SKIN.dark ? "0 0 22px var(--me,#7fe3ff),0 2px 8px rgba(0,0,0,.55)" : "0 0 18px var(--me,#7fe3ff),0 1px 0 #fff"}}
.pb-pop em{font-style:normal;font-size:12px;font-weight:800;opacity:.75;
  text-shadow:${SKIN.dark ? "0 1px 4px rgba(0,0,0,.7)" : "0 1px 0 #fff"}}
.pb-combo{font-size:24px;font-weight:900;letter-spacing:.05em;color:#ffd84d;
  text-shadow:0 0 16px rgba(255,190,40,.55),0 2px 6px rgba(0,0,0,.6);animation:pbCombo 1.4s cubic-bezier(.2,.9,.25,1) forwards}
.pb-combo span{display:block;font-size:12px;letter-spacing:.12em;color:#fff;opacity:.85}
@keyframes pbPop{0%{opacity:0;transform:scale(.55)}10%{opacity:1;transform:scale(1.1)}20%{transform:scale(1)}
  80%{opacity:1;transform:scale(1)}100%{opacity:0;transform:translateY(-12px) scale(.98)}}
@keyframes pbCombo{0%{opacity:0;transform:scale(.4) rotate(-6deg)}14%{opacity:1;transform:scale(1.18) rotate(2deg)}
  28%{transform:scale(1) rotate(0)}72%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}
.pb-lead{position:absolute;right:calc(var(--sar) + 12px);top:calc(var(--sat) + 10px);
  min-width:124px;max-width:44vw;padding:8px 10px;border-radius:12px;
  background:rgba(0,0,0,.34);backdrop-filter:blur(6px);text-shadow:0 1px 2px rgba(0,0,0,.5)}
.pb-lead h4{margin:0 0 5px;font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;opacity:.62}
.pb-lead ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;
  font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.pb-lead li{display:flex;gap:7px;align-items:baseline;white-space:nowrap}
.pb-lead li i{font-style:normal;opacity:.5;width:14px;flex:none}
.pb-lead li b{font-weight:700;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.pb-lead li s{text-decoration:none;opacity:.62}
.pb-lead li.me b{color:#ffd84d}

/* ---- the two action buttons: the only interactive layer during play ---- */
.pb-pads{position:absolute;right:calc(var(--sar) + 12px);bottom:calc(var(--sab) + 12px);
  display:flex;flex-direction:column;gap:10px;z-index:3;pointer-events:auto}
.pb-pad{appearance:none;border:0;width:74px;height:60px;border-radius:18px;font:inherit;
  font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  background:rgba(255,255,255,.13);color:${SKIN.ink};backdrop-filter:blur(8px);
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.16);cursor:pointer;touch-action:manipulation;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;line-height:1}
.pb-pad:active{background:rgba(255,255,255,.28);transform:scale(.95)}
.pb-pad[disabled]{opacity:.3}
.pb-pad em{font-style:normal;font-size:17px;opacity:.9}

/* ---- menus ---- */
.pb-modal{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;
  padding:calc(var(--sat) + 16px) calc(var(--sar) + 16px) calc(var(--sab) + 16px) calc(var(--sal) + 16px);
  background:rgba(4,6,9,.62);backdrop-filter:blur(9px);pointer-events:auto}
.pb-card{width:100%;max-width:380px;max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:13px;
  padding:20px;border-radius:24px;background:rgba(18,22,28,.95);
  box-shadow:0 20px 60px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.07);color:#eef3f9}
.pb-title{margin:0;font-size:33px;font-weight:800;line-height:.96;letter-spacing:-.01em}
.pb-kicker{margin:0;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;opacity:.5}
.pb-copy{margin:0;font-size:14px;line-height:1.45;opacity:.78}
.pb-name{appearance:none;width:100%;border:0;border-radius:14px;padding:13px 15px;min-height:52px;
  font:inherit;font-size:17px;font-weight:800;background:rgba(255,255,255,.08);color:#eef3f9}
.pb-name:focus{outline:2px solid #6fd3ff;outline-offset:1px}
.pb-btn{appearance:none;border:0;width:100%;min-height:56px;border-radius:16px;font:inherit;
  font-size:16px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;
  touch-action:manipulation;background:#3ddc84;color:#04240f}
.pb-btn:active{transform:scale(.98)}
.pb-btn.ghost{background:transparent;box-shadow:inset 0 0 0 2px rgba(255,255,255,.16);color:#cfd8e3;min-height:46px;font-size:13px}
.pb-rows{display:flex;flex-direction:column;gap:9px;margin:0;padding:0;list-style:none}
.pb-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:14px}
.pb-row span{opacity:.62}
.pb-row b{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}
.pb-tip{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.4;opacity:.8}
.pb-tip i{font-style:normal;font-size:16px;flex:none;width:22px;text-align:center}
`;

    /* ================================================================ *
     * THE DISH
     * ================================================================ */
    const W = { pellets: [], viruses: [], players: [], me: null, t: 0, ejecta: [], blooms: 0 };

    // A uniform bucket grid over the pellets. Rebuilt each frame -- eight
    // hundred inserts is nothing, and it turns the naive fifty-thousand
    // distance checks a frame into a few dozen.
    const GRID = { size: 260, cols: 0, rows: 0, cells: [] };
    function gridReset() {
      GRID.cols = Math.ceil(WORLD / GRID.size);
      GRID.rows = GRID.cols;
      GRID.cells = new Array(GRID.cols * GRID.rows);
      for (let i = 0; i < GRID.cells.length; i++) GRID.cells[i] = [];
    }
    function gridFill(items) {
      for (let i = 0; i < GRID.cells.length; i++) GRID.cells[i].length = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const cx = clamp(Math.floor(it.x / GRID.size), 0, GRID.cols - 1);
        const cy = clamp(Math.floor(it.y / GRID.size), 0, GRID.rows - 1);
        GRID.cells[cy * GRID.cols + cx].push(it);
      }
    }
    function gridNear(x, y, r, visit) {
      const x0 = clamp(Math.floor((x - r) / GRID.size), 0, GRID.cols - 1);
      const x1 = clamp(Math.floor((x + r) / GRID.size), 0, GRID.cols - 1);
      const y0 = clamp(Math.floor((y - r) / GRID.size), 0, GRID.rows - 1);
      const y1 = clamp(Math.floor((y + r) / GRID.size), 0, GRID.rows - 1);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const bucket = GRID.cells[cy * GRID.cols + cx];
          for (let i = bucket.length - 1; i >= 0; i--) visit(bucket[i], bucket, i);
        }
      }
    }

    /* ---------------------------------------------------------------- *
     * SPAWNING
     * ---------------------------------------------------------------- */
    function newPellet() {
      return { x: rand(20, WORLD - 20), y: rand(20, WORLD - 20), m: PELLET_MASS,
               hue: randHue(), vx: 0, vy: 0, born: W.t };
    }

    function fillPellets() {
      while (W.blooms < BLOOM_COUNT) {
        const b = newPellet();
        b.bloom = true; b.m = BLOOM_MASS; b.phase = Math.random() * TAU;
        W.pellets.push(b); W.blooms++;
      }
      while (W.pellets.length < PELLETS + BLOOM_COUNT) W.pellets.push(newPellet());
    }

    function newVirus(x, y) {
      return { x: x !== undefined ? x : rand(220, WORLD - 220),
               y: y !== undefined ? y : rand(220, WORLD - 220),
               m: VIRUS_MASS, fed: 0, vx: 0, vy: 0, seed: Math.random() * 1000 };
    }

    // Somewhere that is not inside something that would eat you the instant
    // you appeared.
    function safeSpot(mass, margin) {
      const edge = clamp(margin || 140, 140, WORLD / 3);
      let best = null, bestScore = -1;
      for (let attempt = 0; attempt < 24; attempt++) {
        const x = rand(edge, WORLD - edge), y = rand(edge, WORLD - edge);
        let score = 1e9;
        for (const p of W.players) {
          if (p.dead) continue;
          for (const c of p.cells) {
            const gap = Math.sqrt(dist2(x, y, c.x, c.y)) - c.r - rOf(mass);
            // Give predators a wide berth and everything else an elbow's worth.
            score = Math.min(score, c.m > mass * EAT_RATIO ? gap : gap * 3 + 200);
          }
        }
        for (const v of W.viruses) score = Math.min(score, Math.sqrt(dist2(x, y, v.x, v.y)) - 110);
        if (score > bestScore) { bestScore = score; best = { x, y }; }
        if (score > 620) break;
      }
      return best;
    }

    function makeOrganelles() {
      const o = [{ a: Math.random() * TAU, d: 0.17, s: 0.29, spin: rand(-0.12, 0.12), nucleus: true }];
      const n = randInt(3, 5);
      for (let i = 0; i < n; i++) {
        o.push({ a: Math.random() * TAU, d: rand(0.34, 0.6), s: rand(0.055, 0.12), spin: rand(-0.45, 0.45) });
      }
      return o;
    }

    function makeCell(owner, x, y, m) {
      const r = rOf(m);
      return {
        owner, x, y, m, r, vx: 0, vy: 0, mergeAt: 0,
        // What is drawn lags what is simulated: the visual radius springs
        // toward the true one and overshoots, so a gulp visibly swells.
        vr: r, vrv: 0,
        // Smoothed real motion, for the teardrop stretch.
        px: x, py: y, mvx: 0, mvy: 0,
        ring: new Float32Array(RING_N), ringV: new Float32Array(RING_N),
        seed: Math.random() * 1000, org: makeOrganelles()
      };
    }

    // Push the membrane outward around one angle, as when something is
    // swallowed there. Spreads to the neighbours on its own.
    function kickBody(c, ang, amt, width) {
      for (let i = 0; i < RING_N; i++) {
        let d = i / RING_N * TAU - ang;
        d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
        c.ringV[i] += amt * Math.exp(-(d * d) / (width * width));
      }
    }

    function stepBody(c, dt) {
      const h = Math.min(dt, 1 / 30);
      const ivx = (c.x - c.px) / Math.max(dt, 1e-4), ivy = (c.y - c.py) / Math.max(dt, 1e-4);
      c.px = c.x; c.py = c.y;
      const sm = 1 - Math.exp(-9 * dt);
      c.mvx += (clamp(ivx, -2000, 2000) - c.mvx) * sm;
      c.mvy += (clamp(ivy, -2000, 2000) - c.mvy) * sm;

      c.vrv += ((c.r - c.vr) * 150 - c.vrv * 12) * h;
      c.vr += c.vrv * h;
      if (!(c.vr > 1)) { c.vr = c.r; c.vrv = 0; }

      const sp = Math.sqrt(c.mvx * c.mvx + c.mvy * c.mvy);
      const st = clamp(sp / (speedOf(c.m) + 1), 0, 1.4) * 0.2;
      const head = Math.atan2(c.mvy, c.mvx);
      const ch = Math.cos(head), sh = Math.sin(head);
      const t = W.t;
      for (let i = 0; i < RING_N; i++) {
        const al = RCOS[i] * ch + RSIN[i] * sh;
        // A moving drop is blunt in front and draws out into a tail, and
        // a resting one never quite stops trembling.
        const back = al < 0 ? al * al * al * al : 0;
        let target = -0.32 * st * al + 1.05 * st * back - 0.2 * st * (1 - al * al);
        target += 0.022 * Math.sin(i * 0.94 + t * 1.8 + c.seed) + 0.014 * Math.sin(i * 1.57 - t * 2.4 + c.seed * 1.7);
        const j = (i + 1) % RING_N, k = (i + RING_N - 1) % RING_N;
        const lap = c.ring[j] + c.ring[k] - 2 * c.ring[i];
        c.ringV[i] += ((target - c.ring[i]) * 150 + lap * 200 - c.ringV[i] * 11) * h;
      }
      for (let i = 0; i < RING_N; i++) {
        c.ring[i] = clamp(c.ring[i] + c.ringV[i] * h, -0.35, 0.45);
      }
    }

    function makePlayer(name, isBot) {
      const p = {
        id: W.players.length, name, isBot,
        hue: randHue(), cells: [], dead: false, peak: 0,
        aimX: 0, aimY: 0,
        // Bots re-think on a stagger so forty of them never all plan on
        // the same frame.
        think: rand(0, 0.25), mood: "feed", targetX: 0, targetY: 0,
        skill: isBot ? clamp(BOT_SKILL + rand(-0.18, 0.18), 0.15, 1) : 1
      };
      W.players.push(p);
      return p;
    }

    function spawnPlayer(p, mass) {
      const spot = safeSpot(mass, p.isBot ? 140 : 560);
      p.cells.length = 0;
      p.cells.push(makeCell(p, spot.x, spot.y, mass));
      p.dead = false;
      p.safeUntil = p.isBot ? 0 : W.t + 3;
      p.aimX = spot.x; p.aimY = spot.y;
      p.targetX = spot.x; p.targetY = spot.y;
      if (!p.isBot) { p.peak = Math.max(p.peak, mass); }
    }

    const massOf = p => { let m = 0; for (const c of p.cells) m += c.m; return m; };
    const centerOf = p => {
      let x = 0, y = 0, m = 0;
      for (const c of p.cells) { x += c.x * c.m; y += c.y * c.m; m += c.m; }
      return m > 0 ? { x: x / m, y: y / m, m } : { x: WORLD / 2, y: WORLD / 2, m: 0 };
    };

    function resetWorld() {
      W.pellets.length = 0; W.viruses.length = 0; W.players.length = 0; W.ejecta.length = 0;
      W.t = 0; W.blooms = 0;
      parts.length = 0; rings.length = 0; floats.length = 0; sucks.length = 0; fx.length = 0;
      gridReset();
      fillPellets();
      for (let i = 0; i < VIRUSES; i++) W.viruses.push(newVirus());

      const pool = BOT_NAMES.slice();
      for (let i = 0; i < BOTS; i++) {
        const bot = makePlayer(pool.length ? pool.splice(randInt(0, pool.length - 1), 1)[0] : "Blob " + i, true);
        // A dish already in progress: a couple of big fish, a lot of small.
        const m = i < 2 ? rand(200, 380) : i < 8 ? rand(90, 180) : rand(16, 60);
        spawnPlayer(bot, m);
      }

      // The player goes in last, so safeSpot picks a gap on a populated
      // board rather than a random point on an empty one.
      W.me = makePlayer((state.name || "You").trim() || "You", false);
      spawnPlayer(W.me, START_MASS);
      W.me.peak = START_MASS;
    }

    /* ================================================================ *
     * SIMULATION
     * ================================================================ */
    function steerCell(c, ax, ay, dt) {
      const dx = ax - c.x, dy = ay - c.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      let sp = 0, ux = 0, uy = 0;
      if (d > 0.5) {
        ux = dx / d; uy = dy / d;
        // Ease off as the aim point comes inside the cell, or a blob the
        // size of a dinner plate jitters around your finger.
        sp = speedOf(c.m) * clamp(d / (c.r * 1.1 + 22), 0, 1);
      }
      c.x += (ux * sp + c.vx) * dt;
      c.y += (uy * sp + c.vy) * dt;
      const f = Math.exp(-FRICTION * dt);
      c.vx *= f; c.vy *= f;
      c.r = rOf(c.m);
      c.x = clamp(c.x, c.r, WORLD - c.r);
      c.y = clamp(c.y, c.r, WORLD - c.r);
    }

    // Your own pieces shove each other apart until their timers are up,
    // then the moment they touch they become one cell again.
    function resolveOwn(p) {
      const cs = p.cells;
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          const a = cs[i], b = cs[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (d > a.r + b.r) continue;
          const ready = W.t >= a.mergeAt && W.t >= b.mergeAt;
          if (ready && d < Math.max(a.r, b.r)) {
            a.m += b.m; a.r = rOf(a.m);
            a.mergeAt = Math.max(a.mergeAt, b.mergeAt);
            kickBody(a, Math.atan2(dy, dx), 1.8, 0.9);
            a.vrv += a.r * 1.2;
            if (p === W.me) fx.push({ kind: "merge" });
            cs.splice(j, 1); j--;
            continue;
          }
          if (ready) continue;
          if (d < 0.01) { d = 0.01; }
          const push = (a.r + b.r - d) * 0.5;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }

    function splitPlayer(p) {
      const cs = p.cells;
      if (!cs.length || cs.length >= MAX_CELLS) return false;
      const order = cs.slice().sort((x, y) => y.m - x.m);
      let did = false;
      for (const c of order) {
        if (cs.length >= MAX_CELLS) break;
        if (c.m < SPLIT_MIN) continue;
        const half = c.m / 2;
        c.m = half; c.r = rOf(half);
        const dx = p.aimX - c.x, dy = p.aimY - c.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const piece = makeCell(p, c.x + (dx / d) * (c.r * 0.6), c.y + (dy / d) * (c.r * 0.6), half);
        piece.vx = (dx / d) * SPLIT_IMPULSE;
        piece.vy = (dy / d) * SPLIT_IMPULSE;
        const wait = W.t + MERGE_SECONDS + half * 0.02;
        piece.mergeAt = wait; c.mergeAt = wait;
        cs.push(piece);
        did = true;
      }
      return did;
    }

    function ejectFrom(p) {
      let did = false;
      for (const c of p.cells) {
        if (c.m < EJECT_COST + 24) continue;
        const dx = p.aimX - c.x, dy = p.aimY - c.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / d, uy = dy / d;
        c.m -= EJECT_COST; c.r = rOf(c.m);
        W.pellets.push({
          x: c.x + ux * (c.r + 6), y: c.y + uy * (c.r + 6),
          m: EJECT_MASS, hue: p.hue, vx: ux * EJECT_SPEED, vy: uy * EJECT_SPEED, ej: true
        });
        did = true;
      }
      return did;
    }

    // A cell bigger than a virus that touches one bursts into as many
    // pieces as it can afford. This is what stops a runaway leader.
    function popOn(cell, virus) {
      const p = cell.owner;
      const room = MAX_CELLS - p.cells.length;
      if (room <= 0) { cell.m += virus.m * 0.5; return; }
      const want = clamp(Math.floor(cell.m / 26), 2, room + 1);
      const share = cell.m / want;
      const base = Math.atan2(cell.y - virus.y, cell.x - virus.x);
      cell.m = share; cell.r = rOf(share);
      cell.mergeAt = W.t + MERGE_SECONDS + share * 0.02;
      for (let i = 1; i < want; i++) {
        const a = base + (i / want) * Math.PI * 2;
        const piece = makeCell(p, cell.x + Math.cos(a) * cell.r, cell.y + Math.sin(a) * cell.r, share);
        piece.vx = Math.cos(a) * SPLIT_IMPULSE * 0.82;
        piece.vy = Math.sin(a) * SPLIT_IMPULSE * 0.82;
        piece.mergeAt = cell.mergeAt;
        p.cells.push(piece);
      }
    }

    function killPlayer(p) {
      p.dead = true;
      p.cells.length = 0;
    }

    function stepWorld(dt) {
      W.t += dt;

      /* ---- aim and movement ---- */
      for (const p of W.players) {
        if (p.dead) continue;
        for (const c of p.cells) steerCell(c, p.aimX, p.aimY, dt);
        resolveOwn(p);
        if (DECAY_RATE > 0) {
          // A bot rots at the rate its whole colony earns: a leader split
          // into sixteen modest pieces would otherwise hardly rot at all.
          const botRate = p.isBot ? decayOf(massOf(p), true) : 0;
          for (const c of p.cells) {
            if (c.m > DECAY_FLOOR) { c.m -= c.m * (p.isBot ? botRate : decayOf(c.m, false)) * dt; c.r = rOf(c.m); }
          }
        }
        for (const c of p.cells) stepBody(c, dt);
      }

      /* ---- loose mass drifts and settles ---- */
      for (const f of W.pellets) {
        if (!f.vx && !f.vy) continue;
        f.x = clamp(f.x + f.vx * dt, 4, WORLD - 4);
        f.y = clamp(f.y + f.vy * dt, 4, WORLD - 4);
        const k = Math.exp(-4.2 * dt);
        f.vx *= k; f.vy *= k;
        if (Math.abs(f.vx) < 6 && Math.abs(f.vy) < 6) { f.vx = 0; f.vy = 0; }
      }
      for (const v of W.viruses) {
        if (!v.vx && !v.vy) continue;
        v.x = clamp(v.x + v.vx * dt, 60, WORLD - 60);
        v.y = clamp(v.y + v.vy * dt, 60, WORLD - 60);
        const k = Math.exp(-3.0 * dt);
        v.vx *= k; v.vy *= k;
        if (Math.abs(v.vx) < 8 && Math.abs(v.vy) < 8) { v.vx = 0; v.vy = 0; }
      }

      /* ---- feeding ---- */
      gridFill(W.pellets);
      for (const p of W.players) {
        if (p.dead) continue;
        const me = p === W.me;
        for (const c of p.cells) {
          gridNear(c.x, c.y, c.r + 8, (f, bucket, idx) => {
            if (f.gone) return;
            if (dist2(c.x, c.y, f.x, f.y) > c.r * c.r) return;
            f.gone = true;
            c.m += me ? f.m : f.m * BOT_FEED; c.r = rOf(c.m);
            bucket.splice(idx, 1);
            kickBody(c, Math.atan2(f.y - c.y, f.x - c.x), f.bloom ? 2.4 : 0.6, 0.5);
            if (f.bloom) {
              W.blooms--;
              c.vrv += c.r * 1.4;
              if (me) fx.push({ kind: "bloom", x: f.x, y: f.y, m: f.m });
              else if (inView(f.x, f.y)) burst(f.x, f.y, -3, 8, 170, 4, 0.5);
            }
            if (me && sucks.length < 90) {
              sucks.push({ x: f.x, y: f.y, c, hue: f.hue, bloom: !!f.bloom, t: 0, life: f.bloom ? 0.36 : 0.24 });
            }
          });
        }
      }
      for (let i = W.pellets.length - 1; i >= 0; i--) {
        if (W.pellets[i].gone) W.pellets.splice(i, 1);
      }
      fillPellets();

      /* ---- ejected mass feeding viruses ---- */
      const shots = [];
      for (const v of W.viruses) {
        const vr = rOf(v.m);
        gridNear(v.x, v.y, vr, (f, bucket, idx) => {
          if (!f.ej || f.gone) return;
          if (dist2(f.x, f.y, v.x, v.y) > vr * vr) return;
          f.gone = true;
          bucket.splice(idx, 1);
          v.fed += 1;
          if (v.fed >= VIRUS_FEED) {
            v.fed = 0;
            const d = Math.sqrt(f.vx * f.vx + f.vy * f.vy) || 1;
            const shot = newVirus(v.x + (f.vx / d) * 12, v.y + (f.vy / d) * 12);
            shot.vx = (f.vx / d) * 460; shot.vy = (f.vy / d) * 460;
            shots.push(shot);
          }
        });
      }
      if (shots.length) {
        for (const shot of shots) W.viruses.push(shot);
        for (let i = W.pellets.length - 1; i >= 0; i--) if (W.pellets[i].gone) W.pellets.splice(i, 1);
      } else {
        for (let i = W.pellets.length - 1; i >= 0; i--) if (W.pellets[i].gone) W.pellets.splice(i, 1);
      }

      /* ---- cell eats cell ---- */
      const all = [];
      for (const p of W.players) { if (!p.dead) for (const c of p.cells) all.push(c); }
      all.sort((a, b) => b.m - a.m);
      for (let i = 0; i < all.length; i++) {
        const a = all[i];
        if (a.gone) continue;
        for (let j = i + 1; j < all.length; j++) {
          const b = all[j];
          if (b.gone || b.owner === a.owner) continue;
          if (b.owner.safeUntil > W.t) continue;
          if (a.m < b.m * EAT_RATIO) continue;
          const d = Math.sqrt(dist2(a.x, a.y, b.x, b.y));
          if (d > a.r - b.r * EAT_COVER) continue;
          a.m = Math.min(a.m + b.m, MAX_CELL_MASS); a.r = rOf(a.m);
          b.gone = true;
          const share = Math.min(b.m / a.m, 1);
          kickBody(a, Math.atan2(b.y - a.y, b.x - a.x), 2.6 + share * 3, 0.8);
          a.vrv += a.r * (1.5 + share * 4);
          if (inView(b.x, b.y)) {
            burst(b.x, b.y, b.owner.hue, 10 + Math.min(18, Math.floor(b.m / 8)), 280, rOf(b.m) * 0.2 + 3, 0.65);
          }
          if (b.owner === W.me) {
            W.killerName = a.owner.name;
            fx.push({ kind: "loss", x: b.x, y: b.y });
          }
          else if (a.owner === W.me) fx.push({ kind: "gulp", x: b.x, y: b.y, m: b.m, cell: a, name: b.owner.name });
        }
      }
      for (const p of W.players) {
        if (p.dead) continue;
        for (let i = p.cells.length - 1; i >= 0; i--) if (p.cells[i].gone) p.cells.splice(i, 1);
        if (!p.cells.length) killPlayer(p);
      }

      /* ---- viruses ---- */
      for (let vi = W.viruses.length - 1; vi >= 0; vi--) {
        const v = W.viruses[vi];
        const vr = rOf(v.m);
        let hit = null;
        for (const p of W.players) {
          if (p.dead) continue;
          for (const c of p.cells) {
            if (c.m < VIRUS_POP_MIN) continue;
            if (dist2(c.x, c.y, v.x, v.y) < (c.r - vr * 0.5) * (c.r - vr * 0.5)) { hit = c; break; }
          }
          if (hit) break;
        }
        if (!hit) continue;
        popOn(hit, v);
        W.viruses.splice(vi, 1);
        W.viruses.push(newVirus());
        if (inView(v.x, v.y)) {
          burst(v.x, v.y, -2, 22, 360, 5, 0.7);
          rings.push({ x: v.x, y: v.y, r0: rOf(v.m), r1: rOf(v.m) * 4, t: 0, life: 0.6, a: 0.9, w: 9, color: "#5dffa4" });
        }
        if (hit.owner === W.me) fx.push({ kind: "pop", x: v.x, y: v.y });
      }

      /* ---- brains, scores, respawns ---- */
      for (const p of W.players) {
        if (p.dead) {
          if (p.isBot) { p.respawnAt = p.respawnAt || W.t + rand(1.5, 4); if (W.t >= p.respawnAt) { p.respawnAt = 0; spawnPlayer(p, rand(16, Math.max(40, START_MASS * 1.1))); } }
          continue;
        }
        const m = massOf(p);
        if (m > p.peak) p.peak = m;
        if (p.isBot) botThink(p, dt);
      }
    }

    /* ================================================================ *
     * BOT BRAINS
     * Flee anything that can swallow you, chase anything you can swallow,
     * otherwise graze. Skill decides how far they see and how willing they
     * are to commit to a split.
     * ================================================================ */
    function nearestPellet(x, y, reach) {
      let best = null, bestD = reach * reach;
      gridNear(x, y, reach, f => {
        const d = dist2(x, y, f.x, f.y);
        if (d < bestD) { bestD = d; best = f; }
      });
      return best;
    }

    function botThink(p, dt) {
      p.think -= dt;
      if (p.think > 0) { p.aimX = p.targetX; p.aimY = p.targetY; return; }
      p.think = rand(0.15, 0.32);

      let head = p.cells[0];
      for (const c of p.cells) if (c.m > head.m) head = c;
      const view = head.r * 8 + 280 * (0.5 + p.skill);

      let threat = null, threatGap = Infinity;
      let prey = null, preyGap = Infinity;
      for (const q of W.players) {
        if (q === p || q.dead) continue;
        for (const c of q.cells) {
          const d = Math.sqrt(dist2(head.x, head.y, c.x, c.y));
          if (d > view) continue;
          if (c.m > head.m * EAT_RATIO) {
            const gap = d - c.r;
            if (gap < threatGap) { threatGap = gap; threat = c; }
          } else if (head.m > c.m * EAT_RATIO * 1.06 && c.owner.safeUntil <= W.t) {
            // Worth crossing the dish for, or close enough to be free.
            if (c.m < head.m * 0.08 && d > head.r * 2.5) continue;
            const gap = d - c.r;
            if (gap < preyGap) { preyGap = gap; prey = c; }
          }
        }
      }

      let tx, ty;
      if (threat && threatGap < head.r + 220 * (0.4 + p.skill)) {
        p.mood = "flee";
        const dx = head.x - threat.x, dy = head.y - threat.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        tx = head.x + (dx / d) * 700;
        ty = head.y + (dy / d) * 700;
        // A cornered bot runs along the wall rather than into it.
        if (tx < 120 || tx > WORLD - 120) tx = head.x + (dy / d) * 700;
        if (ty < 120 || ty > WORLD - 120) ty = head.y - (dx / d) * 700;
      } else if (prey) {
        p.mood = "hunt";
        tx = prey.x; ty = prey.y;
        const canSplit = p.cells.length < MAX_CELLS && head.m >= SPLIT_MIN * 2 &&
          head.m / 2 > prey.m * EAT_RATIO * 1.2;
        // Nobody lunges at you while you are still a spore: dying in the
        // first ten seconds teaches nothing.
        const mercy = prey.owner === W.me && massOf(W.me) < TIERS[1].m;
        if (canSplit && !mercy && preyGap > head.r * 0.4 && preyGap < head.r * 2.4 && Math.random() < p.skill * 0.5) {
          p.aimX = prey.x; p.aimY = prey.y;
          splitPlayer(p);
        }
      } else {
        p.mood = "feed";
        const food = nearestPellet(head.x, head.y, 620);
        if (food) { tx = food.x; ty = food.y; }
        else {
          const far = Math.sqrt(dist2(head.x, head.y, p.targetX, p.targetY));
          if (far < 180 || !p.targetX) { tx = rand(180, WORLD - 180); ty = rand(180, WORLD - 180); }
          else { tx = p.targetX; ty = p.targetY; }
        }
      }

      // Anything big enough to burst gives the spikes a wide berth.
      if (head.m >= VIRUS_POP_MIN) {
        for (const v of W.viruses) {
          const d = Math.sqrt(dist2(head.x, head.y, v.x, v.y));
          if (d > head.r + 150) continue;
          const dx = head.x - v.x, dy = head.y - v.y;
          const k = (head.r + 150 - d) / (head.r + 150) * p.skill * (head.m > 2500 ? 0.5 : 1);
          tx += (dx / (d || 1)) * 420 * k;
          ty += (dy / (d || 1)) * 420 * k;
        }
      }

      p.targetX = clamp(tx, 60, WORLD - 60);
      p.targetY = clamp(ty, 60, WORLD - 60);
      p.aimX = p.targetX; p.aimY = p.targetY;
    }

    /* ================================================================ *
     * CAMERA AND RENDER
     * ================================================================ */
    const cam = { x: WORLD / 2, y: WORLD / 2, z: 1, zWant: 1, zr: 1, kick: 0, shake: 0 };

    function updateCamera(dt) {
      cam.kick *= Math.exp(-6 * dt);
      cam.shake *= Math.exp(-8 * dt);
      // A death holds the shot for a beat, so you see what happened to you.
      if (state.screen === "play" && W.me.dead) { cam.zr = cam.z * (1 + cam.kick); return; }

      const vw = ctx.width, vh = ctx.height;
      const short = Math.min(vw, vh);
      let subject = W.me;
      if (subject.dead) {
        const ranked = leaderboard();
        if (ranked.length) subject = ranked[0];
      }
      const c = subject.dead ? { x: WORLD / 2, y: WORLD / 2, m: 4000 } : centerOf(subject);
      const totalR = rOf(Math.max(c.m, 1));
      // The view widens as you grow, but slower than you do, so every meal
      // shows: your size on screen goes as about radius^0.6. A view that
      // kept exact pace with you would make growing invisible.
      const viewHalf = clamp(285 * Math.pow(Math.max(totalR, 20) / 28, 0.4), 260, 1600);
      let z = (short * 0.5) / viewHalf;

      // Never let your own split pieces fall outside the view.
      let span = totalR;
      for (const cell of subject.cells) {
        span = Math.max(span, Math.sqrt(dist2(c.x, c.y, cell.x, cell.y)) + cell.r);
      }
      z = Math.min(z, (short * 0.44) / Math.max(span, 6));
      cam.zWant = clamp(z, 0.05, 2.2);

      const k = 1 - Math.exp(-7 * dt);
      cam.x = lerp(cam.x, c.x, k);
      cam.y = lerp(cam.y, c.y, k);
      cam.z = lerp(cam.z, cam.zWant, 1 - Math.exp(-3.4 * dt));
      cam.zr = cam.z * (1 + cam.kick);

      // Mostly keep the glass full -- a player in a corner should not spend
      // half the display looking at the bench the dish stands on -- but let
      // the view lean a little past the lit wall, so you are not shoved off
      // the middle of the screen and under the buttons.
      const halfW = vw / 2 / cam.zr, halfH = vh / 2 / cam.zr;
      cam.x = WORLD > halfW * 1.4 ? clamp(cam.x, halfW * 0.7, WORLD - halfW * 0.7) : WORLD / 2;
      cam.y = WORLD > halfH * 1.4 ? clamp(cam.y, halfH * 0.7, WORLD - halfH * 0.7) : WORLD / 2;
    }

    function inView(x, y) {
      const z = cam.zr || cam.z;
      return Math.abs(x - cam.x) < ctx.width / 2 / z + 80 && Math.abs(y - cam.y) < ctx.height / 2 / z + 80;
    }

    let g = null, canvas = null;
    // Sheds the extras -- plankton, organelles, your halo -- if the frames
    // run long for a couple of seconds, and earns them back if they run
    // short for a good while. 0 is everything.
    const quality = { level: 0, ema: 16.7, slow: 0, fast: 0, last: 0 };
    function governQuality() {
      const t = performance.now();
      const dtMs = quality.last ? t - quality.last : 16.7;
      quality.last = t;
      const d = clamp(dtMs || 16.7, 4, 50);
      quality.ema += (d - quality.ema) * 0.05;
      if (quality.ema > 21) { quality.slow += d; quality.fast = 0; }
      else if (quality.ema < 17.5) { quality.fast += d; quality.slow = 0; }
      else { quality.slow = 0; quality.fast = 0; }
      if (quality.slow > 1500 && quality.level < 2) { quality.level++; quality.slow = 0; quality.ema = 16.7; }
      if (quality.fast > 12000 && quality.level > 0) { quality.level--; quality.fast = 0; }
    }
    const fx = [];        // moments for the sound, haptic and HUD side to answer
    const parts = [];     // droplets and sparks, in world space
    const rings = [];     // shock rings, in world space
    const floats = [];    // rising numbers and words, pinned to the world
    const sucks = [];     // nutrients on their way into you
    // Reused every frame so batching the loose mass allocates nothing.
    const hueBuckets = HUES.map(() => []);
    const bloomList = [];

    /* ---------------------------------------------------------------- *
     * PALETTE
     * Every hue gets its own lightness: yellow at the lightness that suits
     * blue reads as mustard. Gradients are built once, in a unit circle,
     * and drawn through a transform, so a hundred cells cost no more
     * gradient objects than one.
     * ---------------------------------------------------------------- */
    const LIGHT = HUES.map(h => (h >= 40 && h <= 110 ? 50 : h >= 130 && h <= 200 ? 46 : h > 200 && h <= 290 ? 60 : 56));
    const PAL = HUES.map((h, i) => {
      const L = LIGHT[i];
      const c = (dl, a) => `hsla(${h},88%,${clamp(L + dl, 4, 96)}%,${a})`;
      return {
        flat: c(0, 1), edge: c(-11, 1), rim: c(24, 0.92), core: c(12, 1), halo: c(14, 1),
        nucleus: c(-30, 0.38), nucleolus: c(-38, 0.5), vac: c(34, 0.34), spark: c(24, 1),
        body: null
      };
    });
    const GOLD = "#ffd860", GREEN = "#5dffa4";
    const sparkColor = hue => (hue === -3 ? GOLD : hue === -2 ? GREEN : hue < 0 ? "#ffffff" : PAL[hue].spark);

    function bodyGrad(hi) {
      const P = PAL[hi];
      if (!P.body) {
        const h = HUES[hi], L = LIGHT[hi];
        const gr = g.createRadialGradient(-0.32, -0.38, 0.03, 0, 0, 1.02);
        gr.addColorStop(0, `hsl(${h},92%,${Math.min(L + 27, 92)}%)`);
        gr.addColorStop(0.42, `hsl(${h},86%,${L + 5}%)`);
        gr.addColorStop(0.84, `hsl(${h},84%,${L - 7}%)`);
        gr.addColorStop(1, `hsl(${h},88%,${L - 15}%)`);
        P.body = gr;
      }
      return P.body;
    }
    function haloGrad(hi) {
      const P = PAL[hi];
      if (!P.halo2) {
        const h = HUES[hi], gr = g.createRadialGradient(0, 0, 0.43, 0, 0, 1);
        gr.addColorStop(0, `hsla(${h},95%,62%,0.42)`);
        gr.addColorStop(0.3, `hsla(${h},95%,62%,0.13)`);
        gr.addColorStop(1, `hsla(${h},95%,62%,0)`);
        P.halo2 = gr;
      }
      return P.halo2;
    }
    const GR = { ready: false };
    function sharedGrads() {
      if (GR.ready) return GR;
      GR.bloom = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      GR.bloom.addColorStop(0, "rgba(255,248,210,0.95)");
      GR.bloom.addColorStop(0.2, "rgba(255,214,90,0.5)");
      GR.bloom.addColorStop(0.55, "rgba(255,170,40,0.15)");
      GR.bloom.addColorStop(1, "rgba(255,150,30,0)");
      GR.virus = g.createRadialGradient(0, 0, 0.1, 0, 0, 1);
      GR.virus.addColorStop(0, "rgba(40,255,140,0.05)");
      GR.virus.addColorStop(0.7, "rgba(50,235,135,0.2)");
      GR.virus.addColorStop(1, "rgba(80,255,160,0.45)");
      GR.ready = true;
      return GR;
    }

    // The floor is one flat colour with the top and bottom of the screen
    // shaded down, which keeps the HUD legible. A full-screen radial
    // gradient looked much the same and cost several times as much on a
    // canvas drawn by the CPU.
    let bands = null, bandsKey = "";
    function vignette(vw, vh) {
      const key = vw + "x" + vh;
      if (key !== bandsKey) {
        bandsKey = key;
        const top = g.createLinearGradient(0, 0, 0, vh * 0.24);
        top.addColorStop(0, SKIN.vignette); top.addColorStop(1, "rgba(0,0,0,0)");
        const bot = g.createLinearGradient(0, vh, 0, vh * 0.76);
        bot.addColorStop(0, SKIN.vignette); bot.addColorStop(1, "rgba(0,0,0,0)");
        bands = { top, bot };
      }
      return bands;
    }

    // Plankton suspended under the agar, tiled. Two depths that drift
    // slower than the dish does when you swim: depth for almost nothing.
    const SPECKS = [];
    for (let i = 0; i < 64; i++) {
      SPECKS.push({ x: Math.random() * 512, y: Math.random() * 512, r: rand(0.7, 2.1), far: i % 2 === 0 });
    }
    const WALL_PASSES = [[28, 0.05], [13, 0.09], [6, 0.2], [2, 0.8]];

    // Small images painted once and stamped many times. A phone often draws
    // this canvas on the CPU, where copying a prepared image costs a
    // fraction of shading a gradient -- or a path with five hundred holes in
    // it -- every frame. They are made through the SDK's sprite helper, so
    // the Bit never creates a canvas of its own; where the helper is missing
    // everything below falls back to drawing paths.
    const canStamp = !!(ctx.visual && ctx.visual.sprite && typeof ctx.visual.sprite.custom === "function");
    function makeStamp(size, paint) {
      if (!canStamp) return null;
      try {
        const handle = ctx.visual.sprite.custom({ width: size, height: size, frames: 1, draw: x => paint(x, size / 2) });
        const img = handle && typeof handle.canvas === "function" ? handle.canvas(0) : null;
        if (!img || !img.width) return null;
        // A helper that paints later, or not at all, must not fill the dish
        // with invisible specks: every stamp here is opaque in the middle.
        const x2 = typeof img.getContext === "function" ? img.getContext("2d") : null;
        if (x2 && !x2.getImageData(img.width >> 1, img.height >> 1, 1, 1).data[3]) { dropStamp({ handle }); return null; }
        return { img, size, handle };
      } catch (e) { return null; }
    }
    function dropStamp(st) {
      if (st && st.handle && typeof st.handle.dispose === "function") { try { st.handle.dispose(); } catch (e) { /* gone */ } }
    }
    const stampCache = new Map();
    function sprite(key, size, paint) {
      if (!stampCache.has(key)) stampCache.set(key, makeStamp(size, paint));
      return stampCache.get(key);
    }
    // A nutrient -- glow, bead and glint -- in one stamp. The bead is
    // PELLET_CORE of the stamp's half-width.
    const PELLET_CORE = 0.27;
    function paintPellet(x, m, hi) {
      const h = HUES[hi], cr = m * PELLET_CORE;
      const gr = x.createRadialGradient(m, m, cr * 0.6, m, m, m);
      gr.addColorStop(0, `hsla(${h},100%,66%,${SKIN.dark ? 0.6 : 0.35})`);
      gr.addColorStop(0.3, `hsla(${h},96%,60%,${SKIN.dark ? 0.2 : 0.12})`);
      gr.addColorStop(1, `hsla(${h},95%,55%,0)`);
      x.fillStyle = gr; x.fillRect(0, 0, m * 2, m * 2);
      x.beginPath(); x.arc(m, m, cr, 0, TAU);
      x.fillStyle = PAL[hi].core; x.fill();
      x.beginPath(); x.arc(m - cr * 0.3, m - cr * 0.32, cr * 0.34, 0, TAU);
      x.fillStyle = "rgba(255,255,255,0.65)"; x.fill();
    }
    function pelletSprite(hi) { return sprite("p" + hi, 96, (x, m) => paintPellet(x, m, hi)); }

    function paintVirus(x, m, R, rot) {
      x.translate(m, m); x.rotate(rot); x.scale(R, R);
      x.beginPath();
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU, rr = i % 2 === 0 ? 1.04 : 0.88;
        if (i === 0) x.moveTo(rr, 0); else x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      x.closePath();
      const gr = x.createRadialGradient(0, 0, 0.1, 0, 0, 1);
      gr.addColorStop(0, "rgba(40,255,140,0.05)");
      gr.addColorStop(0.7, "rgba(50,235,135,0.2)");
      gr.addColorStop(1, "rgba(80,255,160,0.45)");
      x.fillStyle = gr; x.fill();
      x.lineJoin = "round";
      x.lineWidth = Math.max(3, R * 0.06) / R;
      x.strokeStyle = "#57f59a"; x.stroke();
      x.beginPath(); x.arc(0, 0, 0.5, 0, TAU);
      x.lineWidth = 0.05; x.strokeStyle = "rgba(120,255,175,0.2)"; x.stroke();
    }

    // Stamps cut at the exact device-pixel size they are drawn at, so the
    // frame is straight copies with no resampling. They are recut only when
    // the zoom moves far enough to change that size -- every few seconds
    // while you grow, not every frame.
    const exact = { pelletPx: 0, pellets: [], virusPx: 0, viruses: [] };
    const VIRUS_PHASES = 12;
    function exactPellets(px) {
      if (exact.pelletPx !== px) {
        exact.pelletPx = px;
        exact.pellets.forEach(dropStamp);
        const half = Math.ceil(px / PELLET_CORE);
        exact.pellets = HUES.map((h, hi) => makeStamp(half * 2, (x, m) => paintPellet(x, m, hi)));
      }
      return exact.pellets;
    }
    function exactViruses(px) {
      if (exact.virusPx !== px) {
        exact.virusPx = px;
        exact.viruses.forEach(dropStamp);
        const half = Math.ceil(px * 1.04 + 4);
        exact.viruses = [];
        for (let i = 0; i < VIRUS_PHASES; i++) {
          exact.viruses.push(makeStamp(half * 2, (x, m) => paintVirus(x, m, px, (i / VIRUS_PHASES) * (TAU / 20))));
        }
      }
      return exact.viruses;
    }
    // Copy a stamp so its pixels land exactly on the screen's.
    function blit(st, x, y, k) {
      const d = st.size;
      g.drawImage(st.img, Math.round(x * k - d / 2) / k, Math.round(y * k - d / 2) / k, d / k, d / k);
    }
    // Soft round light, for the golden blooms.
    function glowSprite(key) {
      return sprite("g" + key, 64, (x, m) => {
        const h = key === "gold" ? 44 : HUES[key];
        const gr = x.createRadialGradient(m, m, 0, m, m, m);
        gr.addColorStop(0, `hsla(${h},100%,70%,0.9)`);
        gr.addColorStop(0.22, `hsla(${h},96%,62%,0.45)`);
        gr.addColorStop(0.55, `hsla(${h},95%,58%,0.13)`);
        gr.addColorStop(1, `hsla(${h},95%,55%,0)`);
        x.fillStyle = gr; x.fillRect(0, 0, m * 2, m * 2);
      });
    }
    // Your halo: hollow in the middle, where the body will cover it.
    // Drawn at 1.85 of the cell's radius.
    function haloSprite(hi) {
      return sprite("h" + hi, 128, (x, m) => {
        const h = HUES[hi];
        const gr = x.createRadialGradient(m, m, m * 0.43, m, m, m);
        gr.addColorStop(0, `hsla(${h},95%,62%,0.42)`);
        gr.addColorStop(0.3, `hsla(${h},95%,62%,0.13)`);
        gr.addColorStop(1, `hsla(${h},95%,62%,0)`);
        x.fillStyle = gr; x.fillRect(0, 0, m * 2, m * 2);
      });
    }
    // A soft shadow on the agar, drawn at 1.25 of the cell's radius.
    function shadowSprite() {
      return sprite("shadow", 64, (x, m) => {
        const gr = x.createRadialGradient(m, m, m * 0.5, m, m, m);
        gr.addColorStop(0, SKIN.dark ? "rgba(0,0,0,0.45)" : "rgba(20,40,70,0.22)");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = gr; x.fillRect(0, 0, m * 2, m * 2);
      });
    }
    /* ---------------------------------------------------------------- *
     * EFFECTS
     * ---------------------------------------------------------------- */
    function burst(x, y, hue, n, speed, size, life) {
      const color = sparkColor(hue);
      for (let i = 0; i < n && parts.length < 360; i++) {
        const a = Math.random() * TAU, sp = speed * (0.3 + Math.random() * 0.7);
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: size * (0.5 + Math.random() * 0.7),
                     t: 0, life: life * (0.6 + Math.random() * 0.5), color, spark: hue < 0 });
      }
    }
    function floatText(x, y, text, size, color, life) {
      if (floats.length > 14) floats.shift();
      floats.push({ x, y, text, size, color, t: 0, life: life || 1.1 });
    }
    function stepEffects(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.t += dt;
        if (q.t >= q.life) { parts.splice(i, 1); continue; }
        q.x += q.vx * dt; q.y += q.vy * dt;
        const f = Math.exp(-3.2 * dt);
        q.vx *= f; q.vy *= f;
      }
      for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t >= rings[i].life) rings.splice(i, 1); }
      for (let i = floats.length - 1; i >= 0; i--) { floats[i].t += dt; if (floats[i].t >= floats[i].life) floats.splice(i, 1); }
      for (let i = sucks.length - 1; i >= 0; i--) {
        const s = sucks[i];
        s.t += dt;
        if (s.t >= s.life || !s.c || s.c.gone) sucks.splice(i, 1);
      }
    }

    /* ---------------------------------------------------------------- *
     * CELL BODIES
     * ---------------------------------------------------------------- */
    // The membrane's radius, as a share of the cell's, in one direction.
    function ringAt(c, ang) {
      let u = (ang / TAU) * RING_N;
      u = ((u % RING_N) + RING_N) % RING_N;
      const i = Math.floor(u) % RING_N, f = u - Math.floor(u), j = (i + 1) % RING_N;
      return 1 + c.ring[i] * (1 - f) + c.ring[j] * f;
    }

    // A closed curve through the midpoints of the ring with the ring points
    // as control points: smooth all the way round, in a unit circle. The
    // small overscale makes up for the curve running inside its controls.
    function cellPath(c) {
      const ring = c.ring, K = 1.008;
      const last = RING_N - 1;
      let qx = RCOS[0] * (1 + ring[0]) * K, qy = RSIN[0] * (1 + ring[0]) * K;
      const lx = RCOS[last] * (1 + ring[last]) * K, ly = RSIN[last] * (1 + ring[last]) * K;
      g.moveTo((lx + qx) / 2, (ly + qy) / 2);
      for (let i = 0; i < RING_N; i++) {
        const j = i === last ? 0 : i + 1;
        const nx = RCOS[j] * (1 + ring[j]) * K, ny = RSIN[j] * (1 + ring[j]) * K;
        g.quadraticCurveTo(qx, qy, (qx + nx) / 2, (qy + ny) / 2);
        qx = nx; qy = ny;
      }
      g.closePath();
    }

    // A liquid bridge from a cell to a smaller piece of the same colony,
    // in screen space: the metaball construction with two concave flanks.
    // Its flanks are stroked in the rim colour and its fill covers both
    // rims where they meet it, so the outline runs round the whole colony.
    function drawNeck(big, small, z, ox, oy, rimPx, rimColor, P) {
      const ax = big.x * z + ox, ay = big.y * z + oy;
      const bx = small.x * z + ox, by = small.y * z + oy;
      const dx = bx - ax, dy = by - ay;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.5) return;
      const ang = Math.atan2(dy, dx);
      const r1 = big.vr * z * ringAt(big, ang);
      const r2 = small.vr * z * ringAt(small, ang + Math.PI);
      if (r2 < 3) return;
      const reach = Math.min(r1, r2) * 0.72;
      const gap = d - (r1 + r2);
      if (gap >= reach || d <= Math.abs(r1 - r2) + 0.5) return;
      const v = 0.5 * Math.pow(clamp(1 - gap / reach, 0, 1), 1.5);
      let u1 = 0, u2 = 0;
      if (d < r1 + r2) {
        u1 = Math.acos(clamp((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d), -1, 1));
        u2 = Math.acos(clamp((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d), -1, 1));
      }
      const spread = Math.acos(clamp((r1 - r2) / d, -1, 1));
      const a1 = ang + u1 + (spread - u1) * v, a2 = ang - u1 - (spread - u1) * v;
      const a3 = ang + Math.PI - u2 - (Math.PI - u2 - spread) * v;
      const a4 = ang - Math.PI + u2 + (Math.PI - u2 - spread) * v;
      const p1x = ax + r1 * Math.cos(a1), p1y = ay + r1 * Math.sin(a1);
      const p2x = ax + r1 * Math.cos(a2), p2y = ay + r1 * Math.sin(a2);
      const p3x = bx + r2 * Math.cos(a3), p3y = by + r2 * Math.sin(a3);
      const p4x = bx + r2 * Math.cos(a4), p4y = by + r2 * Math.sin(a4);
      const tot = r1 + r2;
      const hk = Math.min(v * 2.4, Math.hypot(p1x - p3x, p1y - p3y) / tot) * Math.min(1, (d * 2) / tot);
      const h1 = r1 * hk, h2 = r2 * hk, HP = Math.PI / 2;
      const c1x = p1x + h1 * Math.cos(a1 - HP), c1y = p1y + h1 * Math.sin(a1 - HP);
      const c3x = p3x + h2 * Math.cos(a3 + HP), c3y = p3y + h2 * Math.sin(a3 + HP);
      const c4x = p4x + h2 * Math.cos(a4 - HP), c4y = p4y + h2 * Math.sin(a4 - HP);
      const c2x = p2x + h1 * Math.cos(a2 + HP), c2y = p2y + h1 * Math.sin(a2 + HP);
      g.beginPath();
      g.moveTo(p1x, p1y); g.bezierCurveTo(c1x, c1y, c3x, c3y, p3x, p3y);
      g.moveTo(p4x, p4y); g.bezierCurveTo(c4x, c4y, c2x, c2y, p2x, p2y);
      g.lineWidth = rimPx * 2;
      g.strokeStyle = rimColor;
      g.stroke();
      g.beginPath();
      g.moveTo(p1x, p1y); g.bezierCurveTo(c1x, c1y, c3x, c3y, p3x, p3y);
      g.lineTo(p4x, p4y); g.bezierCurveTo(c4x, c4y, c2x, c2y, p2x, p2y);
      g.closePath();
      g.fillStyle = P.edge;
      g.fill();
    }

    function drawCell(c, z, ox, oy, now, glowOp) {
      const sr = c.vr * z;
      const sx = c.x * z + ox, sy = c.y * z + oy;
      const vw = ctx.width, vh = ctx.height;
      if (sx + sr * 1.9 < 0 || sx - sr * 1.9 > vw || sy + sr * 1.9 < 0 || sy - sr * 1.9 > vh) return;
      const mine = c.owner === W.me;
      const hi = c.owner.hue, P = PAL[hi];

      // Specks get a dot and nothing else; zoomed out there are dozens.
      if (sr < 2.4) {
        g.beginPath(); g.arc(sx, sy, Math.max(sr, 1), 0, TAU);
        g.fillStyle = P.flat; g.fill();
        return;
      }
      const rimPx = clamp(sr * 0.045, 1.1, 5.5);
      const rimColor = mine ? "rgba(255,255,255,0.94)" : P.rim;
      const soft = sr >= 9;

      // A soft shadow on the agar under everyone, and a halo round you.
      if (!SKIN.dark && sr >= 10) {
        const sh = shadowSprite(), d = sr * 1.25;
        if (sh) g.drawImage(sh.img, sx + sr * 0.05 - d, sy + sr * 0.1 - d, d * 2, d * 2);
      }
      if (mine && quality.level < 2) {
        const ha = haloSprite(hi), d = sr * 1.85;
        g.globalCompositeOperation = glowOp;
        if (ha) g.drawImage(ha.img, sx - d, sy - d, d * 2, d * 2);
        else {
          g.save();
          g.translate(sx, sy); g.scale(d, d);
          g.beginPath(); g.arc(0, 0, 1, 0, TAU);
          g.fillStyle = haloGrad(hi); g.fill();
          g.restore();
        }
        g.globalCompositeOperation = "source-over";
      }
      g.save();
      g.translate(sx, sy); g.scale(sr, sr);
      // The rim first, then the body over its inner half: what is left
      // showing is a clean membrane line outside the jelly.
      g.beginPath();
      if (soft) cellPath(c); else g.arc(0, 0, 1, 0, TAU);
      g.lineWidth = (rimPx * 2) / sr;
      g.lineJoin = "round";
      g.strokeStyle = rimColor;
      g.stroke();
      g.restore();

      if (soft && c.owner.cells.length > 1) {
        for (const o of c.owner.cells) {
          if (o !== c && o.ord < c.ord) drawNeck(c, o, z, ox, oy, rimPx, rimColor, P);
        }
      }

      g.save();
      g.translate(sx, sy); g.scale(sr, sr);
      g.beginPath();
      if (soft) cellPath(c); else g.arc(0, 0, 1, 0, TAU);
      g.fillStyle = bodyGrad(hi);
      g.fill();

      if (sr >= (quality.level ? 30 : 12) && quality.level < 2) {
        // The insides slosh against the way the cell is swimming.
        const sp = speedOf(c.m) + 1;
        const lx = clamp(-c.mvx / sp, -1.4, 1.4) * 0.09, ly = clamp(-c.mvy / sp, -1.4, 1.4) * 0.09;
        const n = c.org[0];
        const na = n.a + n.spin * now;
        const nx = Math.cos(na) * n.d + lx * 0.6, ny = Math.sin(na) * n.d + ly * 0.6;
        g.beginPath(); g.arc(nx, ny, n.s, 0, TAU);
        g.fillStyle = P.nucleus; g.fill();
        g.beginPath(); g.arc(nx + n.s * 0.22, ny - n.s * 0.18, n.s * 0.36, 0, TAU);
        g.fillStyle = P.nucleolus; g.fill();
        if (sr >= 22 && !quality.level) {
          g.beginPath();
          for (let i = 1; i < c.org.length; i++) {
            const o = c.org[i];
            const a = o.a + o.spin * now;
            const x = Math.cos(a) * o.d + lx, y = Math.sin(a) * o.d + ly;
            g.moveTo(x + o.s, y); g.arc(x, y, o.s, 0, TAU);
          }
          g.fillStyle = P.vac; g.fill();
          // Light coming back through the far side of the membrane.
          g.beginPath(); g.arc(0, 0, 0.84, 0.12 * Math.PI, 0.6 * Math.PI);
          g.lineWidth = 0.07; g.lineCap = "round";
          g.strokeStyle = "rgba(255,255,255,0.17)"; g.stroke();
        }
      }
      // Gloss: a broad sheen and a hard little glint.
      g.beginPath(); g.ellipse(-0.33, -0.41, 0.4, 0.22, -0.62, 0, TAU);
      g.fillStyle = "rgba(255,255,255,0.16)"; g.fill();
      if (sr >= 6) {
        g.beginPath(); g.ellipse(-0.45, -0.5, 0.14, 0.07, -0.62, 0, TAU);
        g.fillStyle = "rgba(255,255,255,0.6)"; g.fill();
      }
      g.restore();

      if (c.owner.safeUntil > W.t) {
        g.save();
        g.beginPath(); g.arc(sx, sy, sr * 1.24 + 3, 0, TAU);
        g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = 2.5;
        g.setLineDash([7, 7]); g.lineDashOffset = -now * 24;
        g.stroke();
        g.restore();
      }

      if (sr > (quality.level > 1 ? 30 : 20) || (mine && sr > 9)) {
        const size = clamp(sr * 0.36, 10, 30);
        const big = sr > 44;
        g.font = `800 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.lineJoin = "round";
        g.lineWidth = Math.max(2.4, size * 0.2);
        g.strokeStyle = "rgba(0,0,0,0.42)";
        g.fillStyle = "#fff";
        const ly = sy - (big ? size * 0.42 : 0);
        g.strokeText(c.owner.name, sx, ly);
        g.fillText(c.owner.name, sx, ly);
        if (big) {
          const ms = Math.round(size * 0.68);
          g.font = `800 ${ms}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
          g.lineWidth = Math.max(2, ms * 0.2);
          g.globalAlpha = 0.85;
          g.strokeText(Math.round(c.m), sx, sy + size * 0.6);
          g.fillText(Math.round(c.m), sx, sy + size * 0.6);
          g.globalAlpha = 1;
        }
      }
    }

    function drawThreats(vw, vh, z, sxOf, syOf, now) {
      let smallest = Infinity;
      for (const c of W.me.cells) smallest = Math.min(smallest, c.m);
      const cx = vw / 2, cy = vh / 2, edge = 22, reach = Math.max(vw, vh) * 1.2;
      for (const p of W.players) {
        if (p === W.me || p.dead) continue;
        let best = null, bestD = Infinity;
        for (const c of p.cells) {
          if (c.m < smallest * EAT_RATIO) continue;
          const sx = sxOf(c.x), sy = syOf(c.y), sr = c.r * z;
          if (sx + sr > 0 && sx - sr < vw && sy + sr > 0 && sy - sr < vh) { best = null; bestD = -1; break; }
          const d = Math.hypot(sx - cx, sy - cy) - sr;
          if (d < bestD) { bestD = d; best = { sx, sy, m: c.m }; }
        }
        if (!best || bestD > reach) continue;
        const dx = best.sx - cx, dy = best.sy - cy;
        const t = Math.min((cx - edge) / Math.max(Math.abs(dx), 1e-6), (cy - edge) / Math.max(Math.abs(dy), 1e-6));
        const near = clamp(1 - (bestD - Math.min(vw, vh) * 0.5) / reach, 0, 1);
        const size = clamp(9 + Math.sqrt(best.m / smallest) * 3, 11, 19) * (1 + 0.12 * near * Math.sin(now * 9));
        g.save();
        g.translate(cx + dx * t, cy + dy * t);
        g.rotate(Math.atan2(dy, dx));
        g.globalAlpha = 0.35 + 0.6 * near;
        g.beginPath();
        g.moveTo(size, 0); g.lineTo(-size * 0.6, -size * 0.8); g.lineTo(-size * 0.2, 0); g.lineTo(-size * 0.6, size * 0.8);
        g.closePath();
        g.lineJoin = "round"; g.lineWidth = 3;
        g.strokeStyle = "rgba(0,0,0,0.55)"; g.stroke();
        g.fillStyle = "#ff5a4f"; g.fill();
        g.restore();
      }
    }

    function drawViruses(z, ox, oy, now, k) {
      const vw = ctx.width, vh = ctx.height;
      for (const v of W.viruses) {
        const sr = rOf(v.m) * z;
        const sx = v.x * z + ox, sy = v.y * z + oy;
        if (sx + sr < -20 || sx - sr > vw + 20 || sy + sr < -20 || sy - sr > vh + 20) continue;
        const stamps = sr >= 9 && v.m === VIRUS_MASS ? exactViruses(2 * Math.round(rOf(v.m) * cam.z * k / 2)) : null;
        const phase = Math.floor((((v.seed + now * 0.16) % (TAU / 20)) / (TAU / 20)) * VIRUS_PHASES) % VIRUS_PHASES;
        const st = stamps && stamps[phase];
        if (st) {
          blit(st, sx, sy, k);
        } else {
          g.save();
          g.translate(sx, sy); g.scale(sr, sr);
          g.beginPath();
          if (sr < 9) g.arc(0, 0, 1, 0, TAU);
          else {
            g.rotate(v.seed + now * 0.16);
            for (let i = 0; i <= 40; i++) {
              const a = (i / 40) * TAU, rr = i % 2 === 0 ? 1.04 : 0.88;
              if (i === 0) g.moveTo(rr, 0); else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
            }
            g.closePath();
          }
          g.fillStyle = GR.virus; g.fill();
          g.lineJoin = "round";
          g.lineWidth = Math.max(1.6, sr * 0.06) / sr;
          g.strokeStyle = "#57f59a";
          g.stroke();
          g.restore();
        }
        if (sr >= 9 && v.fed > 0) {
          // How close it is to firing: a ring that fills as it is fed.
          g.beginPath(); g.arc(sx, sy, sr * 0.5, -Math.PI / 2, -Math.PI / 2 + (v.fed / VIRUS_FEED) * TAU);
          g.lineWidth = Math.max(2, sr * 0.09); g.lineCap = "round"; g.strokeStyle = "rgba(170,255,205,0.85)"; g.stroke();
        }
      }
    }

    /* ---------------------------------------------------------------- *
     * THE FRAME
     * ---------------------------------------------------------------- */
    function render() {
      const vw = ctx.width, vh = ctx.height;
      if (!vw || !vh || !canvas.width) return;
      // The backing store may be finer than CSS pixels; everything below
      // is drawn in CSS pixels either way.
      const k = canvas.width / vw;
      governQuality();
      sharedGrads();
      const z = cam.zr || cam.z, now = W.t;
      const halfW = vw / 2 / z, halfH = vh / 2 / z;
      const left = cam.x - halfW, right = cam.x + halfW;
      const top = cam.y - halfH, bottom = cam.y + halfH;
      const shx = cam.shake > 0.3 ? Math.sin(now * 71) * cam.shake : 0;
      const shy = cam.shake > 0.3 ? Math.cos(now * 63) * cam.shake : 0;
      const ox = vw / 2 - cam.x * z + shx, oy = vh / 2 - cam.y * z + shy;
      const sxOf = wx => wx * z + ox;
      const syOf = wy => wy * z + oy;
      const glowOp = SKIN.dark ? "lighter" : "source-over";

      g.setTransform(k, 0, 0, k, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";

      /* ---- the bench, then the agar ---- */
      g.fillStyle = SKIN.outside;
      g.fillRect(0, 0, vw, vh);
      const dishX = sxOf(0), dishY = syOf(0), dishS = WORLD * z;
      const fx0 = Math.max(0, dishX), fy0 = Math.max(0, dishY);
      const fx1 = Math.min(vw, dishX + dishS), fy1 = Math.min(vh, dishY + dishS);
      if (fx1 > fx0 && fy1 > fy0) {
        g.fillStyle = SKIN.floor;
        g.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);

        g.save();
        g.beginPath();
        g.rect(fx0, fy0, fx1 - fx0, fy1 - fy0);
        g.clip();
        for (let layer = quality.level ? 2 : 0; layer < 2; layer++) {
          const far = layer === 0, f = far ? 0.22 : 0.5;
          let tx0 = -((cam.x * z * f) % 512), ty0 = -((cam.y * z * f) % 512);
          if (tx0 > 0) tx0 -= 512;
          if (ty0 > 0) ty0 -= 512;
          g.fillStyle = far ? SKIN.speckFar : SKIN.speck;
          for (let ty = ty0; ty < vh; ty += 512) {
            for (let tx = tx0; tx < vw; tx += 512) {
              for (const s of SPECKS) {
                if (s.far !== far) continue;
                const x = tx + s.x, y = ty + s.y;
                if (x < -3 || x > vw + 3 || y < -3 || y > vh + 3) continue;
                const d = far ? s.r * 1.1 : s.r * 1.6;
                g.fillRect(x - d / 2, y - d / 2, d, d);
              }
            }
          }
        }
        // The grid fades before it gets dense enough to shimmer.
        const step = 100, gap = step * z;
        if (gap > 10) {
          g.globalAlpha = clamp((gap - 10) / 34, 0, 1);
          g.strokeStyle = SKIN.grid;
          g.lineWidth = 1;
          g.beginPath();
          for (let x = Math.max(0, Math.ceil(left / step) * step); x <= Math.min(right, WORLD); x += step) {
            const sx = Math.round(sxOf(x)) + 0.5;
            g.moveTo(sx, fy0); g.lineTo(sx, fy1);
          }
          for (let y = Math.max(0, Math.ceil(top / step) * step); y <= Math.min(bottom, WORLD); y += step) {
            const sy = Math.round(syOf(y)) + 0.5;
            g.moveTo(fx0, sy); g.lineTo(fx1, sy);
          }
          g.stroke();
          g.globalAlpha = 1;
        }
        const vg = vignette(vw, vh);
        g.fillStyle = vg.top; g.fillRect(0, 0, vw, vh * 0.24);
        g.fillStyle = vg.bot; g.fillRect(0, vh * 0.76, vw, vh * 0.24);
        g.restore();
      }

      /* ---- the glass wall, lit ---- */
      if (dishX > -40 || dishY > -40 || dishX + dishS < vw + 40 || dishY + dishS < vh + 40) {
        g.save();
        g.globalCompositeOperation = glowOp;
        g.strokeStyle = SKIN.wall;
        for (const pass of WALL_PASSES) {
          g.globalAlpha = pass[1];
          g.lineWidth = pass[0];
          g.strokeRect(dishX, dishY, dishS, dishS);
        }
        g.restore();
      }

      /* ---- nutrients: a breathing halo, a bead, a glint ---- */
      const pad = 40;
      for (let i = 0; i < hueBuckets.length; i++) hueBuckets[i].length = 0;
      bloomList.length = 0;
      for (const f of W.pellets) {
        if (f.x < left - pad || f.x > right + pad || f.y < top - pad || f.y > bottom + pad) continue;
        if (f.bloom) { bloomList.push(f); continue; }
        const grow = clamp((now - (f.born || 0)) / 0.4, 0, 1);
        f.sx = sxOf(f.x + Math.sin(now * 1.1 + f.y * 0.031) * 1.6);
        f.sy = syOf(f.y + Math.cos(now * 0.9 + f.x * 0.027) * 1.6);
        f.sr = (f.ej ? rOf(f.m) * 0.9 : 5.2) * z * grow;
        hueBuckets[f.hue].push(f);
      }
      // Stamps are sized off the settled zoom, not the momentary punch, or
      // every gulp would recut them twice.
      const corePx = Math.max(1, Math.round(5.2 * cam.z * k));
      const stamps = exactPellets(corePx);
      for (let hi = 0; hi < hueBuckets.length; hi++) {
        const list = hueBuckets[hi];
        if (!list.length) continue;
        const spr = pelletSprite(hi), st = stamps[hi];
        if (spr && st) {
          // Each colour breathes on its own beat.
          g.globalAlpha = 0.8 + 0.2 * Math.sin(now * 2.2 + hi * 0.8);
          for (const f of list) {
            if (f.ej || (now - (f.born || 0)) < 0.4) {
              const R = Math.max(1.3, f.sr) / PELLET_CORE;
              g.drawImage(spr.img, f.sx - R, f.sy - R, R * 2, R * 2);
            } else {
              blit(st, f.sx, f.sy, k);
            }
          }
          g.globalAlpha = 1;
        } else {
          g.beginPath();
          for (const f of list) {
            const r = Math.max(1.3, f.sr);
            g.moveTo(f.sx + r, f.sy); g.arc(f.sx, f.sy, r, 0, TAU);
          }
          g.fillStyle = PAL[hi].core;
          g.fill();
        }
      }

      /* ---- golden blooms ---- */
      for (const b of bloomList) {
        const grow = clamp((now - (b.born || 0)) / 0.5, 0, 1);
        const sx = sxOf(b.x), sy = syOf(b.y);
        const pulse = 1 + 0.16 * Math.sin(now * 3.2 + b.phase);
        const hr = 36 * pulse * z * grow;
        if (hr < 0.5) continue;
        g.save();
        g.globalCompositeOperation = glowOp;
        const spr = glowSprite("gold");
        if (spr) {
          g.globalAlpha = SKIN.dark ? 0.95 : 0.6;
          g.drawImage(spr.img, sx - hr, sy - hr, hr * 2, hr * 2);
        } else {
          g.translate(sx, sy); g.scale(hr, hr);
          g.beginPath(); g.arc(0, 0, 1, 0, TAU);
          g.fillStyle = GR.bloom; g.fill();
        }
        g.restore();
        const cr = Math.max(2.4, 9 * z * grow);
        g.beginPath(); g.arc(sx, sy, cr, 0, TAU);
        g.fillStyle = "#ffc93c"; g.fill();
        g.beginPath(); g.arc(sx - cr * 0.18, sy - cr * 0.2, cr * 0.55, 0, TAU);
        g.fillStyle = "#fff6d2"; g.fill();
        if (cr > 3.4) {
          g.save();
          g.translate(sx, sy); g.rotate(now * 0.8 + b.phase);
          const st = cr * 2.4 * pulse;
          g.scale(st, st);
          g.beginPath();
          g.moveTo(0, -1); g.quadraticCurveTo(0, 0, 1, 0); g.quadraticCurveTo(0, 0, 0, 1);
          g.quadraticCurveTo(0, 0, -1, 0); g.quadraticCurveTo(0, 0, 0, -1);
          g.fillStyle = "rgba(255,236,170,0.9)"; g.fill();
          g.restore();
        }
      }

      /* ---- cells, smallest first; viruses slot in by weight, so small
       *      cells hide under the spikes and big ones loom over them ---- */
      const all = [];
      for (const p of W.players) { if (!p.dead) for (const c of p.cells) all.push(c); }
      all.sort((a, b) => a.m - b.m);
      for (let i = 0; i < all.length; i++) all[i].ord = i;
      let virusesDrawn = false;
      for (const c of all) {
        if (!virusesDrawn && c.m >= VIRUS_MASS) { drawViruses(z, ox, oy, now, k); virusesDrawn = true; }
        drawCell(c, z, ox, oy, now, glowOp);
      }
      if (!virusesDrawn) drawViruses(z, ox, oy, now, k);

      /* ---- anything that can eat you, just off the screen, gets a
       *      chevron on the edge: a lunge from outside the view should
       *      never come as a complete surprise ---- */
      if (state.screen === "play" && !W.me.dead) drawThreats(vw, vh, z, sxOf, syOf, now);

      /* ---- nutrients being drawn into you ---- */
      for (const s of sucks) {
        const kk = clamp(s.t / s.life, 0, 1), e = kk * kk;
        const x = lerp(s.x, s.c.x, e), y = lerp(s.y, s.c.y, e);
        const r = Math.max(0.8, (s.bloom ? 9 : 5.2) * z * (1 - kk * 0.8));
        g.globalAlpha = 1 - kk * 0.6;
        g.beginPath(); g.arc(sxOf(x), syOf(y), r, 0, TAU);
        g.fillStyle = s.bloom ? "#fff4c8" : PAL[s.hue].core;
        g.fill();
      }
      g.globalAlpha = 1;

      /* ---- droplets, rings, words ---- */
      if (parts.length) {
        g.save();
        for (const q of parts) {
          const a = 1 - q.t / q.life;
          g.globalCompositeOperation = q.spark ? glowOp : "source-over";
          g.globalAlpha = q.spark ? a : a * 0.9;
          g.beginPath(); g.arc(sxOf(q.x), syOf(q.y), Math.max(0.8, q.r * z * (0.4 + 0.6 * a)), 0, TAU);
          g.fillStyle = q.color;
          g.fill();
        }
        g.restore();
      }
      for (const r of rings) {
        const kk = r.t / r.life, e = 1 - (1 - kk) * (1 - kk);
        g.globalAlpha = (1 - kk) * r.a;
        g.beginPath(); g.arc(sxOf(r.x), syOf(r.y), lerp(r.r0, r.r1, e) * z, 0, TAU);
        g.lineWidth = Math.max(1.5, r.w * (1 - kk) * Math.max(z, 0.4));
        g.strokeStyle = r.color;
        g.stroke();
      }
      g.globalAlpha = 1;
      for (const f of floats) {
        const kk = f.t / f.life;
        const pop = kk < 0.12 ? 0.55 + (kk / 0.12) * 0.6 : kk < 0.22 ? 1.15 - ((kk - 0.12) / 0.1) * 0.15 : 1;
        const size = f.size * pop;
        g.globalAlpha = kk > 0.65 ? (1 - kk) / 0.35 : 1;
        g.font = `900 ${size.toFixed(1)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
        g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
        const sx = sxOf(f.x), sy = syOf(f.y) - 46 * (1 - (1 - kk) * (1 - kk));
        g.lineWidth = Math.max(3, size * 0.22);
        g.strokeStyle = "rgba(0,0,0,0.5)"; g.strokeText(f.text, sx, sy);
        g.fillStyle = f.color; g.fillText(f.text, sx, sy);
      }
      g.globalAlpha = 1;

      g.setTransform(k, 0, 0, k, 0, 0);
      drawMinimap(vw, vh);
    }

    function drawMinimap(vw, vh) {
      const sa = ctx.safeArea || {};
      const size = clamp(Math.min(vw, vh) * 0.21, 62, 104);
      const x0 = (sa.left || 0) + 12;
      const y0 = vh - size - (sa.bottom || 0) - 12;
      g.globalAlpha = 0.4;
      g.fillStyle = "#000";
      g.fillRect(x0, y0, size, size);
      g.globalAlpha = 1;
      g.strokeStyle = SKIN.dark ? "rgba(120,210,255,0.35)" : "rgba(40,80,130,0.35)";
      g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
      const k = size / WORLD;
      // The golden blooms are worth knowing about from across the dish.
      g.beginPath();
      for (const f of W.pellets) {
        if (!f.bloom) continue;
        g.moveTo(x0 + f.x * k + 1.3, y0 + f.y * k); g.arc(x0 + f.x * k, y0 + f.y * k, 1.3, 0, TAU);
      }
      g.fillStyle = "rgba(255,216,96,0.75)";
      g.fill();
      const ranked = leaderboard();
      for (let i = 0; i < Math.min(5, ranked.length); i++) {
        const p = ranked[i];
        if (p === W.me) continue;
        const c = centerOf(p);
        g.beginPath();
        g.arc(x0 + c.x * k, y0 + c.y * k, 2.6, 0, TAU);
        g.fillStyle = PAL[p.hue].spark;
        g.fill();
      }
      if (!W.me.dead) {
        const c = centerOf(W.me);
        g.beginPath();
        g.arc(x0 + c.x * k, y0 + c.y * k, 3.4, 0, TAU);
        g.fillStyle = "#fff";
        g.fill();
      }
    }

    function leaderboard() {
      const live = W.players.filter(p => !p.dead);
      live.sort((a, b) => massOf(b) - massOf(a));
      return live;
    }

    /* ================================================================ *
     * SOUND
     * ================================================================ */
    const sfx = (() => {
      const AC = window.AudioContext || window.webkitAudioContext;
      const mute = { unlock() {}, blip() {}, gulp() {}, split() {}, pop() {}, die() {}, evolve() {}, bloom() {}, combo() {}, merge() {} };
      if (!AC || !ctx.capabilities.audio) return mute;
      let ac = null, lastBlip = 0;
      function ready() {
        if (!ac) {
          try { ac = new AC(); } catch (e) { return null; }
          ctx.onDestroy(() => { try { ac.close(); } catch (e) {} });
        }
        if (ac.state === "suspended") ac.resume().catch(() => {});
        return ac;
      }
      function tone(freq, at, dur, type, peak, endFreq) {
        const a = ready();
        if (!a || !state.sound) return;
        const t0 = a.currentTime + at;
        const o = a.createOscillator(), gn = a.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0);
        if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
        gn.gain.setValueAtTime(0.0001, t0);
        gn.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.01, dur * 0.3));
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(gn).connect(a.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
      }
      return {
        unlock() { ready(); },
        // Pellets are constant, so the blip is tiny and rate limited or it
        // turns into a swarm of bees.
        blip(mass) {
          const now = Date.now();
          if (now - lastBlip < 55) return;
          lastBlip = now;
          tone(520 + clamp(mass, 0, 900) * 0.45, 0, 0.035, "sine", 0.045);
        },
        gulp(m) { tone(180 + clamp(m, 0, 400) * 0.4, 0, 0.16, "triangle", 0.2, 90); },
        split() { tone(300, 0, 0.11, "sawtooth", 0.1, 620); },
        pop() { tone(140, 0, 0.3, "square", 0.14, 70); tone(420, 0.02, 0.26, "sawtooth", 0.08, 120); },
        die() { [520, 392, 294, 196].forEach((f, i) => tone(f, i * 0.12, 0.3, "triangle", 0.16)); },
        // A major arpeggio that climbs a step with every tier.
        evolve(t) { [0, 4, 7, 12, 16].forEach((st, i) => tone(262 * Math.pow(2, (st + t * 2) / 12), i * 0.07, 0.42, "triangle", 0.12)); },
        bloom() { tone(880, 0, 0.14, "sine", 0.1, 1320); tone(1320, 0.06, 0.2, "sine", 0.07, 1980); },
        combo(n) { tone(392 * Math.pow(2, Math.min(n, 9) * 2 / 12), 0, 0.16, "square", 0.06); tone(784 * Math.pow(2, Math.min(n, 9) * 2 / 12), 0.05, 0.14, "sine", 0.06); },
        merge() { tone(150, 0, 0.2, "sine", 0.13, 260); }
      };
    })();

    function haptic(kind) {
      if (state.haptics && ctx.capabilities.haptics && typeof ctx.platform.haptic === "function") ctx.platform.haptic(kind);
    }

    /* ================================================================ *
     * SESSION STATE
     * ================================================================ */
    const state = {
      screen: "menu",
      name: "You",
      sound: SOUND_DEFAULT,
      haptics: HAPTICS_DEFAULT,
      best: 0,
      startedAt: 0,
      killer: null,
      rank: 0,
      submitted: false,
      tierBest: 0,
      kills: 0,
      blooms: 0,
      bestCombo: 0,
      deadAt: -1
    };
    const combo = { n: 0, until: 0 };

    const track = ctx.game && ctx.game.score ? ctx.game.score({ initial: 0, min: 0 }) : null;

    /* ---------------------------------------------------------------- *
     * STORAGE IS A CONVENIENCE, NEVER A DEPENDENCY
     * The capability flag can read true while ctx.storage itself is not
     * there -- a draft preview does exactly that -- so every call checks
     * the object it is about to use rather than the flag beside it, and
     * set() is not assumed to hand back a promise.
     * ---------------------------------------------------------------- */
    const canRead = () => !!(ctx.storage && typeof ctx.storage.get === "function");
    const canWrite = () => !!(ctx.storage && typeof ctx.storage.set === "function");
    function writeSaved(value) {
      if (!canWrite()) return;
      try {
        const r = ctx.storage.set(SAVE_KEY, value);
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (e) { /* nothing here is worth losing a game over */ }
    }

    const SAVE_KEY = "petri-bloom/v1";
    async function loadSaved() {
      if (!canRead()) return;
      let s = null;
      try { s = await ctx.storage.get(SAVE_KEY); } catch (e) { return; }
      if (!s || typeof s !== "object") return;
      if (typeof s.name === "string" && s.name.trim()) state.name = s.name.slice(0, 14);
      if (typeof s.sound === "boolean") state.sound = s.sound;
      if (typeof s.haptics === "boolean") state.haptics = s.haptics;
      if (Number.isFinite(s.best)) state.best = s.best;
    }
    function save() {
      writeSaved({
        name: state.name, sound: state.sound, haptics: state.haptics, best: state.best
      });
    }

    /* ================================================================ *
     * SURFACES
     * The dish is a canvas underneath; everything readable is DOM on top.
     * The read-only HUD never takes a touch, so a finger dragged across
     * the score still steers the cell.
     * ================================================================ */
    // Plain defaults, which is what the contract says to start with and
    // what the one bit of mine that renders on a real device uses. The
    // advanced placement opt-ins went on untested and between them put
    // this canvas somewhere nothing was ever visible. Default stacking is
    // source order, so the canvas made first sits under the HUD made
    // after it, and the HUD stays click-through from its own stylesheet.
    //
    // maxDpr on its own only raises the backing store; the drawing space
    // stays raw canvas pixels, and render() scales to CSS pixels itself
    // every frame. A runtime that ignores the option leaves a 1:1 store,
    // and the same code draws exactly as it did before.
    canvas = ctx.createCanvas2D({ touchAction: "none", maxDpr: 2 });
    g = canvas.getContext("2d");

    const root = ctx.createRoot({ className: "pb" });
    root.innerHTML = `<style>${CSS}</style>
<div class="pb-view">
  <div class="pb-stats">
    <div class="pb-tier" data-tier>Spore</div>
    <div class="pb-mass" data-mass>0</div>
    <div class="pb-bar"><i data-bar></i></div>
    <div class="pb-next" data-next></div>
    <div class="pb-sub" data-rank>rank &mdash;</div>
  </div>
  <div class="pb-lead"><h4>Biggest in the dish</h4><ol data-board></ol></div>
  <div class="pb-banner"><div data-evolve></div><div data-combo></div></div>
</div>
<div class="pb-pads" hidden data-pads>
  <button class="pb-pad" data-split><em>&#9679;&#9679;</em>Split</button>
  <button class="pb-pad" data-eject><em>&#8226;</em>Feed</button>
</div>
<div class="pb-modal" data-modal></div>`;

    const view = root.querySelector(".pb-view");
    const massNode = root.querySelector("[data-mass]");
    const tierNode = root.querySelector("[data-tier]");
    const barNode = root.querySelector("[data-bar]");
    const nextNode = root.querySelector("[data-next]");
    const evolveSlot = root.querySelector("[data-evolve]");
    const comboSlot = root.querySelector("[data-combo]");
    const rankNode = root.querySelector("[data-rank]");
    const boardNode = root.querySelector("[data-board]");
    const pads = root.querySelector("[data-pads]");
    const modal = root.querySelector("[data-modal]");

    function applySafeArea() {
      const sa = ctx.safeArea || {};
      root.style.setProperty("--sat", (sa.top || 0) + "px");
      root.style.setProperty("--sar", (sa.right || 0) + "px");
      root.style.setProperty("--sab", (sa.bottom || 0) + "px");
      root.style.setProperty("--sal", (sa.left || 0) + "px");
    }
    applySafeArea();
    ctx.listen(window, "resize", applySafeArea);

    const esc = s => String(s).replace(/[&<>"']/g, ch =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

    /* ================================================================ *
     * MENUS
     * ================================================================ */
    function menuScreen() {
      return `<div class="pb-card">
  <div>
    <p class="pb-kicker">Eat. Grow. Do not get eaten.</p>
    <h1 class="pb-title">Petri Bloom</h1>
  </div>
  <input class="pb-name" data-nick value="${esc(state.name)}" maxlength="14"
         autocomplete="off" spellcheck="false" aria-label="Your name">
  <div class="pb-tip"><i>&#9679;</i><span>Drag anywhere to steer. Everything smaller than you is food.</span></div>
  <div class="pb-tip"><i style="color:#ffd860">&#10022;</i><span><b>Golden blooms</b> are worth a dozen specks. Eat your way up through eight stages of life.</span></div>
  <div class="pb-tip"><i>&#9679;&#9679;</i><span><b>Split</b> throws half of you forward &mdash; fast, but you are two fragile halves until the timer is up.</span></div>
  <div class="pb-tip"><i>&#8226;</i><span><b>Feed</b> spits out a blob of your own mass. Seven into a spiked virus and it fires a new one.</span></div>
  <div class="pb-tip"><i>&#9670;</i><span>Viruses burst anything bigger than they are. Small cells can hide inside them.</span></div>
  ${state.best ? `<p class="pb-copy">Your best bloom: <b>${Math.round(state.best)}</b></p>` : ""}
  <p class="pb-copy" style="font-size:11px;opacity:.4;letter-spacing:.12em">${BUILD}</p>
  <button class="pb-btn" data-play>Drop in</button>
  <div style="display:flex;gap:9px">
    <button class="pb-btn ghost" data-sound>Sound ${state.sound ? "on" : "off"}</button>
    <button class="pb-btn ghost" data-haptics>Buzz ${state.haptics ? "on" : "off"}</button>
  </div>
</div>`;
    }

    function deadScreen() {
      const secs = Math.max(0, Math.round(W.t - state.startedAt));
      const mm = Math.floor(secs / 60), ss = secs % 60;
      const pb = state.newBest ? `<p class="pb-copy" style="color:#ffd84d">A new personal best.</p>` : "";
      return `<div class="pb-card">
  <div>
    <p class="pb-kicker">${state.killer ? "Swallowed by " + esc(state.killer) : "Dissolved"}</p>
    <h1 class="pb-title">Eaten</h1>
  </div>
  <ul class="pb-rows">
    <li class="pb-row"><span>Biggest you got</span><b>${Math.round(W.me.peak)}</b></li>
    <li class="pb-row"><span>Evolved to</span><b>${esc(TIERS[state.tierBest].name)}</b></li>
    <li class="pb-row"><span>Cells swallowed</span><b>${state.kills}</b></li>
    <li class="pb-row"><span>Best rank</span><b>#${state.rank || "&mdash;"}</b></li>
    <li class="pb-row"><span>Survived</span><b>${mm}:${String(ss).padStart(2, "0")}</b></li>
    <li class="pb-row"><span>Personal best</span><b>${Math.round(state.best)}</b></li>
  </ul>
  ${pb}
  <button class="pb-btn" data-play>Drop in again</button>
  <button class="pb-btn ghost" data-menu>Back to the top</button>
</div>`;
    }

    function showModal(html) {
      modal.innerHTML = html;
      modal.hidden = false;
      pads.hidden = true;
      view.style.opacity = "0.25";
    }
    function hideModal() {
      modal.innerHTML = "";
      modal.hidden = true;
      pads.hidden = false;
      view.style.opacity = "1";
    }
    function gotoMenu() { state.screen = "menu"; showModal(menuScreen()); }

    /* ================================================================ *
     * INPUT
     * One tracker on the canvas for steering, and one delegated listener
     * per interactive container. Both are registered once and survive
     * every repaint, so nothing is ever rebound mid-tap.
     * ================================================================ */
    const pointer = ctx.input && ctx.input.track
      ? ctx.input.track(canvas, { preventDefault: true, touchAction: "none" })
      : null;

    function aimAtScreen(sx, sy) {
      const z = cam.zr || cam.z;
      W.me.aimX = clamp(cam.x + (sx - ctx.width / 2) / z, 0, WORLD);
      W.me.aimY = clamp(cam.y + (sy - ctx.height / 2) / z, 0, WORLD);
    }

    function readAim() {
      if (!pointer || W.me.dead) return;
      const mouse = pointer.primary && pointer.primary.pointerType === "mouse";
      // A finger only steers while it is down; a mouse steers always, the
      // way the desktop original does.
      if (pointer.down || (mouse && Number.isFinite(pointer.x))) aimAtScreen(pointer.x, pointer.y);
    }

    function doSplit() {
      if (state.screen !== "play" || W.me.dead) return;
      if (splitPlayer(W.me)) { sfx.split(); haptic("medium"); ctx.platform.interact({ type: "split" }); }
    }
    function doEject() {
      if (state.screen !== "play" || W.me.dead) return;
      if (ejectFrom(W.me)) { sfx.blip(40); haptic("light"); ctx.platform.interact({ type: "eject" }); }
    }

    ctx.listen(pads, "click", event => {
      const el = event.target && event.target.closest ? event.target.closest("[data-split],[data-eject]") : null;
      if (!el || el.disabled) return;
      if (el.hasAttribute("data-split")) doSplit(); else doEject();
    });

    ctx.listen(modal, "click", event => {
      const el = event.target && event.target.closest
        ? event.target.closest("[data-play],[data-menu],[data-sound],[data-haptics]") : null;
      if (!el) return;
      if (el.hasAttribute("data-play")) { startRun(); return; }
      if (el.hasAttribute("data-menu")) { gotoMenu(); return; }
      if (el.hasAttribute("data-sound")) { state.sound = !state.sound; save(); showModal(menuScreen()); return; }
      state.haptics = !state.haptics; save(); haptic("light"); showModal(menuScreen());
    });

    ctx.listen(modal, "input", event => {
      const el = event.target;
      if (!el || !el.hasAttribute || !el.hasAttribute("data-nick")) return;
      // Renaming must not repaint the card: that would drop the keyboard.
      state.name = el.value.slice(0, 14);
      if (W.me) W.me.name = state.name.trim() || "You";
      save();
    });

    ctx.listen(window, "keydown", event => {
      if (event.repeat) return;
      const k = event.key;
      if (state.screen !== "play") {
        if (k === "Enter" && !modal.hidden) { event.preventDefault(); startRun(); }
        return;
      }
      if (k === " ") { event.preventDefault(); doSplit(); }
      else if (k === "w" || k === "W") { event.preventDefault(); doEject(); }
    });

    /* ================================================================ *
     * RUN LIFECYCLE
     * ================================================================ */
    function startRun() {
      state.name = (state.name || "").trim().slice(0, 14) || "You";
      resetWorld();
      state.screen = "play";
      state.killer = null;
      state.rank = 0;
      state.newBest = false;
      state.submitted = false;
      state.startedAt = 0;
      W.killerName = null;
      state.tierBest = tierOf(START_MASS);
      state.kills = 0; state.blooms = 0; state.bestCombo = 0;
      state.deadAt = -1; state.lostAt = null;
      combo.n = 0; combo.until = 0;
      shownMass = 0; shownTier = -1;
      evolveSlot.innerHTML = ""; comboSlot.innerHTML = "";
      root.style.setProperty("--me", PAL[W.me.hue].spark);
      const c = W.me.cells[0];
      cam.x = c.x; cam.y = c.y; cam.z = 1; cam.zr = 1; cam.kick = 0; cam.shake = 0;
      W.me.aimX = c.x; W.me.aimY = c.y;
      if (track) track.reset();
      hideModal();
      sfx.unlock();
      save();
      ctx.platform.start({ bots: BOTS, world: WORLD });
      ctx.platform.emit("run_start", { bots: BOTS });
    }

    async function finishRun() {
      state.screen = "dead";
      const peak = Math.round(W.me.peak);
      state.killer = W.killerName;
      state.newBest = peak > state.best;
      if (state.newBest) { state.best = peak; }
      save();
      showModal(deadScreen());
      ctx.platform.fail({
        peak, rank: state.rank, seconds: Math.round(W.t - state.startedAt), killer: state.killer,
        tier: TIERS[state.tierBest].name, swallowed: state.kills
      });

      if (track && peak > 0 && !state.submitted) {
        state.submitted = true;
        track.set(peak);
        try {
          await track.submit("best_mass", { label: peak + " mass" });
        } catch (e) { /* a refused write must never break the result card */ }
      }
      if (ctx.pulse && ctx.pulse.complete) {
        ctx.pulse.complete({ score: peak, result: "eaten", text: `Grew to ${peak} and evolved into ${TIERS[state.tierBest].name} in Petri Bloom` });
      }
    }

    /* ================================================================ *
     * HUD
     * ================================================================ */
    let hudT = 0, boardT = 0, shownMass = 0, shownTier = -1;
    function hudTick(dt) {
      hudT += dt; boardT += dt;
      if (hudT >= 0.05) {
        hudT = 0;
        const alive = !W.me.dead;
        const m = alive ? massOf(W.me) : 0;
        // Count up rather than jump: watching the number climb is the point.
        shownMass = Math.abs(m - shownMass) < 1 ? m : shownMass + (m - shownMass) * 0.3;
        massNode.textContent = Math.round(shownMass);
        // Hovering on a threshold while you rot should not flicker the name
        // back and forth: once evolved, you keep the name until you have
        // lost a real share of it.
        let t = tierOf(m);
        if (alive && state.tierBest > t && m >= TIERS[state.tierBest].m * 0.85) t = state.tierBest;
        if (t !== shownTier) {
          shownTier = t;
          tierNode.textContent = TIERS[t].name;
          const next = TIERS[t + 1];
          nextNode.textContent = next ? `${next.name} at ${next.m}` : "Nothing left to become";
        }
        const lo = t === 0 ? Math.min(START_MASS, TIERS[1].m - 1) : TIERS[t].m;
        const hiM = TIERS[t + 1] ? TIERS[t + 1].m : lo;
        const frac = hiM > lo ? clamp((m - lo) / (hiM - lo), 0, 1) : 1;
        barNode.style.transform = `scaleX(${frac.toFixed(3)})`;
        if (state.screen === "play" && alive) {
          const big = W.me.cells.reduce((mm, c) => Math.max(mm, c.m), 0);
          const splitEl = pads.querySelector("[data-split]");
          const ejectEl = pads.querySelector("[data-eject]");
          if (splitEl) splitEl.disabled = !(big >= SPLIT_MIN && W.me.cells.length < MAX_CELLS);
          if (ejectEl) ejectEl.disabled = !(big >= EJECT_COST + 24);
          if (track) track.set(Math.round(W.me.peak));
        }
      }
      if (boardT >= 0.4) {
        boardT = 0;
        const ranked = leaderboard();
        const idx = ranked.indexOf(W.me);
        if (idx >= 0) {
          const r = idx + 1;
          if (!state.rank || r < state.rank) state.rank = r;
          rankNode.textContent = "rank " + r + " of " + ranked.length;
        } else {
          rankNode.textContent = state.screen === "play" ? "gone" : "spectating";
        }
        boardNode.innerHTML = ranked.slice(0, 10).map((p, i) =>
          `<li class="${p === W.me ? "me" : ""}"><i>${i + 1}</i><b>${esc(p.name)}</b><s>${Math.round(massOf(p))}</s></li>`
        ).join("");
      }
    }

    /* ================================================================ *
     * FEEDBACK
     * Something should answer every meal: a sound, a buzz, a number that
     * rises off the spot, a nudge of the camera. Bigger meals answer louder.
     * ================================================================ */
    function showPop(slot, html) { slot.innerHTML = html; }

    function bump(gain) {
      if (typeof massNode.animate !== "function") return;
      const s = 1 + clamp(gain / 120, 0.06, 0.28);
      try {
        massNode.animate([{ transform: `scale(${s})` }, { transform: "scale(1)" }],
          { duration: 320, easing: "cubic-bezier(.2,.9,.3,1.2)" });
      } catch (e) { /* purely decorative */ }
    }

    const COMBO_WORDS = ["", "", "DOUBLE GULP", "TRIPLE GULP"];
    function showCombo(n, bonus) {
      state.bestCombo = Math.max(state.bestCombo, n);
      const word = COMBO_WORDS[n] || "FRENZY \u00d7" + n;
      showPop(comboSlot, `<div class="pb-combo">${word}<span>+${bonus} bonus</span></div>`);
      sfx.combo(n);
      if (typeof ctx.platform.milestone === "function") ctx.platform.milestone("combo", { n });
    }

    function evolve(t) {
      const tier = TIERS[t], next = TIERS[t + 1];
      showPop(evolveSlot, `<div class="pb-pop"><small>Evolved</small><b>${esc(tier.name)}</b><em>${
        next ? "next: " + esc(next.name) + " at " + next.m : "the top of the food chain"}</em></div>`);
      sfx.evolve(t);
      haptic("success");
      const c = centerOf(W.me);
      const r = rOf(c.m);
      rings.push({ x: c.x, y: c.y, r0: r, r1: r * 2.8, t: 0, life: 0.9, a: 0.9, w: 12, color: "#ffffff" });
      rings.push({ x: c.x, y: c.y, r0: r * 0.8, r1: r * 2.1, t: 0, life: 0.7, a: 0.7, w: 8, color: PAL[W.me.hue].spark });
      burst(c.x, c.y, W.me.hue, 28, 360, 6, 1.0);
      for (const cell of W.me.cells) {
        cell.vrv += cell.r * 3;
        for (let i = 0; i < RING_N; i++) cell.ringV[i] += 1.1;
      }
      cam.kick = Math.min(cam.kick + 0.07, 0.16);
      if (typeof ctx.platform.milestone === "function") ctx.platform.milestone("evolved", { tier: tier.name, mass: Math.round(c.m) });
    }

    function moment(e) {
      if (e.kind === "gulp") {
        state.kills++;
        combo.n = W.t < combo.until ? combo.n + 1 : 1;
        combo.until = W.t + 2.6;
        let bonus = 0;
        if (combo.n >= 2) {
          bonus = Math.round(e.m * 0.15 * Math.min(combo.n - 1, 3));
          if (e.cell && !e.cell.gone && bonus > 0) {
            e.cell.m = Math.min(e.cell.m + bonus, MAX_CELL_MASS); e.cell.r = rOf(e.cell.m);
          }
          showCombo(combo.n, bonus);
        }
        const gain = Math.round(e.m + bonus);
        floatText(e.x, e.y, "+" + gain, clamp(16 + Math.log2(1 + gain) * 3, 18, 40), "#b6ffcf", 1.2);
        sfx.gulp(e.m);
        haptic(e.m > 60 ? "medium" : "light");
        const share = clamp(e.m / Math.max(massOf(W.me), 1), 0, 0.6);
        cam.kick = Math.min(cam.kick + 0.025 + share * 0.12, 0.14);
        bump(gain);
        ctx.platform.interact({ type: "swallow", mass: Math.round(e.m) });
      } else if (e.kind === "bloom") {
        state.blooms++;
        floatText(e.x, e.y, "+" + Math.round(e.m), 22, GOLD, 1.0);
        burst(e.x, e.y, -3, 14, 220, 4.5, 0.6);
        sfx.bloom();
        haptic("light");
        cam.kick = Math.min(cam.kick + 0.02, 0.14);
        bump(e.m);
      } else if (e.kind === "pop") {
        sfx.pop();
        haptic("heavy");
        cam.shake = Math.max(cam.shake, 7);
        floatText(e.x, e.y, "BURST", 26, GREEN, 1.1);
      } else if (e.kind === "loss") {
        state.lostAt = { x: e.x, y: e.y };
        if (!W.me.dead) { haptic("warning"); cam.shake = Math.max(cam.shake, 4); }
      } else if (e.kind === "merge") {
        sfx.merge();
      }
    }

    // Swallowed: a burst of you, a jolt, then a beat to take it in before
    // the card comes up.
    function dissolve() {
      state.deadAt = W.t;
      sfx.die();
      haptic("error");
      cam.shake = Math.max(cam.shake, 9);
      const at = state.lostAt || { x: cam.x, y: cam.y };
      burst(at.x, at.y, W.me.hue, 30, 420, 7, 0.9);
      rings.push({ x: at.x, y: at.y, r0: 20, r1: 260, t: 0, life: 0.8, a: 0.8, w: 10, color: PAL[W.me.hue].spark });
    }

    /* ================================================================ *
     * LOOP
     * ================================================================ */
    let lastMass = 0;
    function update(dtMs) {
      const dt = Math.min(dtMs || 16, 50) / 1000;
      const playing = state.screen === "play";
      if (playing) readAim();
      stepWorld(dt);
      stepEffects(dt);

      // Eating anything at all should be audible, but only for you.
      if (!W.me.dead) {
        const m = massOf(W.me);
        if (m > lastMass + 0.5) sfx.blip(m);
        lastMass = m;
      }
      if (playing) for (const e of fx) moment(e);
      fx.length = 0;

      if (playing) {
        if (!W.me.dead) {
          const t = tierOf(massOf(W.me));
          if (t > state.tierBest) { state.tierBest = t; evolve(t); }
        } else if (state.deadAt < 0) {
          dissolve();
        } else if (W.t - state.deadAt > 1.1) {
          finishRun();
        }
      }
      updateCamera(dt);
      hudTick(dt);
    }

    if (ctx.game && ctx.game.loop) {
      ctx.game.loop({ update, render, resetOnResume: true, input: pointer || undefined });
    } else {
      ctx.onFrame(dt => { update(dt); render(); });
    }

    /* ================================================================ *
     * BOOT
     * ================================================================ */
    await loadSaved();
    resetWorld();
    // The menu sits over a dish that is already alive: you are watching,
    // not waiting.
    killPlayer(W.me);
    cam.x = WORLD / 2; cam.y = WORLD / 2; cam.z = 0.24;
    updateCamera(0.016);
    render();
    ctx.markVisualReady("menu");
    gotoMenu();
    ctx.platform.ready({ title: "Petri Bloom" });
  }
};
