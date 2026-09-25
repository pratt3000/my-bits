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
    const PELLETS = tInt("pellet_count", 1500);
    const VIRUSES = tInt("virus_count", 20);
    const START_MASS = tInt("start_mass", 60);
    const SPEED_BASE = tNum("speed_base", 560);
    const MERGE_SECONDS = tNum("merge_seconds", 11);
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
    const PELLET_MASS = 2.2;
    const DECAY_FLOOR = 180;        // mass below this never rots
    const MAX_CELL_MASS = 22500;   // one cell can never eat the whole dish
    const FRICTION = 3.4;           // how fast a launch impulse bleeds off

    const rOf = m => R_OF_MASS * Math.sqrt(m);
    const speedOf = m => SPEED_BASE * Math.pow(Math.max(m, 1), -0.35);

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

    /* ================================================================ *
     * LOOK
     * ================================================================ */
    const DISHES = {
      night: { bg: "#0d1014", outside: "#05070a", grid: "#1a2029", edge: "#2b3542", ink: "#e9eef5" },
      clean: { bg: "#f2f4f7", outside: "#cfd6de", grid: "#dde3ea", edge: "#c2ccd8", ink: "#1b2129" },
      warm:  { bg: "#14100c", outside: "#080604", grid: "#241c14", edge: "#3a2c1e", ink: "#f6ecdf" }
    };
    const SKIN = DISHES[DISH] || DISHES.night;

    // Vivid, well separated hues: two cells should never be mistaken for
    // each other in a scrum.
    const HUES = [4, 18, 34, 48, 62, 96, 140, 165, 186, 200, 214, 232, 258, 280, 300, 320, 340];
    const cellColor = (hi, light) => `hsl(${HUES[hi]} 78% ${light}%)`;
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
  pointer-events:none}
.pb *{box-sizing:border-box}
.pb [hidden]{display:none!important}

/* ---- read-only HUD: never takes a touch ---- */
.pb-view{position:absolute;inset:0;pointer-events:none;
  padding:calc(var(--sat) + 10px) calc(var(--sar) + 12px) calc(var(--sab) + 10px) calc(var(--sal) + 12px)}
.pb-stats{position:absolute;left:calc(var(--sal) + 12px);top:calc(var(--sat) + 10px);
  display:flex;flex-direction:column;gap:3px;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.pb-mass{font-size:27px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.pb-sub{font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;opacity:.6}
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
    const W = { pellets: [], viruses: [], players: [], me: null, t: 0, ejecta: [] };

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
               hue: randHue(), vx: 0, vy: 0 };
    }

    function fillPellets() {
      while (W.pellets.length < PELLETS) W.pellets.push(newPellet());
    }

    function newVirus(x, y) {
      return { x: x !== undefined ? x : rand(220, WORLD - 220),
               y: y !== undefined ? y : rand(220, WORLD - 220),
               m: VIRUS_MASS, fed: 0, vx: 0, vy: 0, seed: Math.random() * 1000 };
    }

    // Somewhere that is not inside something that would eat you the instant
    // you appeared.
    function safeSpot(mass) {
      let best = null, bestScore = -1;
      for (let attempt = 0; attempt < 24; attempt++) {
        const x = rand(140, WORLD - 140), y = rand(140, WORLD - 140);
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

    function makeCell(owner, x, y, m) {
      return { owner, x, y, m, r: rOf(m), vx: 0, vy: 0, mergeAt: 0 };
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
      const spot = safeSpot(mass);
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
      W.t = 0;
      gridReset();
      fillPellets();
      for (let i = 0; i < VIRUSES; i++) W.viruses.push(newVirus());

      const pool = BOT_NAMES.slice();
      for (let i = 0; i < BOTS; i++) {
        const bot = makePlayer(pool.length ? pool.splice(randInt(0, pool.length - 1), 1)[0] : "Blob " + i, true);
        // A dish already in progress: a couple of big fish, a lot of small.
        const m = i < 2 ? rand(200, 380) : i < 8 ? rand(90, 180) : rand(20, 75);
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
          for (const c of p.cells) {
            if (c.m > DECAY_FLOOR) { c.m -= c.m * DECAY_RATE * dt; c.r = rOf(c.m); }
          }
        }
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
      const eaten = [];
      for (const p of W.players) {
        if (p.dead) continue;
        for (const c of p.cells) {
          gridNear(c.x, c.y, c.r + 8, (f, bucket, idx) => {
            if (f.gone) return;
            if (dist2(c.x, c.y, f.x, f.y) > c.r * c.r) return;
            f.gone = true;
            c.m += f.m; c.r = rOf(c.m);
            bucket.splice(idx, 1);
            if (p === W.me) eaten.push(f);
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
          if (b.owner === W.me) {
            W.killerName = a.owner.name;
            fx.push({ kind: "loss", x: b.x, y: b.y, t: 0 });
          }
          else if (a.owner === W.me) fx.push({ kind: "gulp", x: b.x, y: b.y, t: 0, m: b.m });
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
        if (hit.owner === W.me) fx.push({ kind: "pop", x: v.x, y: v.y, t: 0 });
      }

      /* ---- brains, scores, respawns ---- */
      for (const p of W.players) {
        if (p.dead) {
          if (p.isBot) { p.respawnAt = p.respawnAt || W.t + rand(1.5, 4); if (W.t >= p.respawnAt) { p.respawnAt = 0; spawnPlayer(p, rand(START_MASS, 70)); } }
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
        if (canSplit && preyGap > head.r * 0.4 && preyGap < head.r * 2.4 && Math.random() < p.skill * 0.5) {
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
          const k = (head.r + 150 - d) / (head.r + 150) * p.skill;
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
    const cam = { x: WORLD / 2, y: WORLD / 2, z: 1, zWant: 1 };

    function updateCamera(dt) {
      const vw = ctx.width, vh = ctx.height;
      const short = Math.min(vw, vh);
      let subject = W.me;
      if (subject.dead) {
        const ranked = leaderboard();
        if (ranked.length) subject = ranked[0];
      }
      const c = subject.dead ? { x: WORLD / 2, y: WORLD / 2, m: 4000 } : centerOf(subject);
      const totalR = rOf(Math.max(c.m, 1));
      // The blob keeps growing on screen as well as in the dish, but
      // slowly: a share of the short edge, from a twentieth to a fifth.
      const viewHalf = clamp(totalR * 13, 270, 1400);
      let z = (short * 0.5) / viewHalf;

      // Never let your own split pieces fall outside the view.
      let span = totalR;
      for (const cell of subject.cells) {
        span = Math.max(span, Math.sqrt(dist2(c.x, c.y, cell.x, cell.y)) + cell.r);
      }
      z = Math.min(z, (short * 0.44) / Math.max(span, 6));
      cam.zWant = clamp(z, 0.055, 2.2);

      const k = 1 - Math.exp(-7 * dt);
      cam.x = lerp(cam.x, c.x, k);
      cam.y = lerp(cam.y, c.y, k);
      cam.z = lerp(cam.z, cam.zWant, 1 - Math.exp(-3.4 * dt));

      // Keep the glass full. The dish is only a few screens wide, so a
      // player in a corner would otherwise spend half the display looking
      // at the bench the dish is standing on.
      const halfW = ctx.width / 2 / cam.z, halfH = ctx.height / 2 / cam.z;
      cam.x = WORLD > halfW * 2 ? clamp(cam.x, halfW, WORLD - halfW) : WORLD / 2;
      cam.y = WORLD > halfH * 2 ? clamp(cam.y, halfH, WORLD - halfH) : WORLD / 2;
    }

    let g = null, canvas = null;
    const fx = [];
    // Reused every frame so batching the loose mass allocates nothing.
    const hueBuckets = HUES.map(() => []);

    function membrane(cell, sx, sy, sr, now) {
      // A perfectly round blob looks dead. Sixteen points nudged by a pair
      // of sines, seeded off the cell, and it breathes.
      // A wobble nobody can see is nineteen path ops wasted. Zoomed out
      // there are eighty-odd cells on screen and most of them are specks.
      if (sr < 24) { g.moveTo(sx + sr, sy); g.arc(sx, sy, sr, 0, Math.PI * 2); return; }
      const seed = (cell.owner.id * 37 + Math.round(cell.m)) % 100;
      const N = sr < 60 ? 12 : 18;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const w = 1 + 0.018 * Math.sin(a * 5 + now * 2.1 + seed) + 0.014 * Math.sin(a * 8 - now * 1.4 + seed * 2);
        const px = sx + Math.cos(a) * sr * w;
        const py = sy + Math.sin(a) * sr * w;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
    }

    function drawVirus(v, sx, sy, sr) {
      const N = 22;
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2 + v.seed * 0.01;
        const rr = sr * (i % 2 === 0 ? 1 : 0.84);
        const px = sx + Math.cos(a) * rr, py = sy + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = "rgba(51,208,122,.22)";
      g.fill();
      g.strokeStyle = "#33d07a";
      g.lineWidth = Math.max(2, sr * 0.09);
      g.stroke();
    }

    function render() {
      const vw = ctx.width, vh = ctx.height;
      const z = cam.z, now = W.t;
      const halfW = vw / 2 / z, halfH = vh / 2 / z;
      const left = cam.x - halfW, right = cam.x + halfW;
      const top = cam.y - halfH, bottom = cam.y + halfH;
      const sxOf = wx => (wx - cam.x) * z + vw / 2;
      const syOf = wy => (wy - cam.y) * z + vh / 2;

      g.fillStyle = SKIN.outside;
      g.fillRect(0, 0, vw, vh);
      g.fillStyle = SKIN.bg;
      g.fillRect(sxOf(0), syOf(0), WORLD * z, WORLD * z);

      /* ---- dish floor ---- */
      const dishX = sxOf(0), dishY = syOf(0), dishS = WORLD * z;
      g.save();
      g.beginPath();
      g.rect(dishX, dishY, dishS, dishS);
      g.clip();
      const step = 100;
      g.strokeStyle = SKIN.grid;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = Math.max(0, Math.floor(left / step) * step); x < Math.min(right, WORLD); x += step) {
        const sx = Math.round(sxOf(x)) + 0.5;
        g.moveTo(sx, dishY); g.lineTo(sx, dishY + dishS);
      }
      for (let y = Math.max(0, Math.floor(top / step) * step); y < Math.min(bottom, WORLD); y += step) {
        const sy = Math.round(syOf(y)) + 0.5;
        g.moveTo(dishX, sy); g.lineTo(dishX + dishS, sy);
      }
      g.stroke();
      g.restore();

      /* ---- the rim of the dish ---- */
      g.strokeStyle = SKIN.edge;
      g.lineWidth = 6;
      g.strokeRect(dishX, dishY, dishS, dishS);

      /* ---- loose mass ---- */
      const pad = 40;
      for (let i = 0; i < hueBuckets.length; i++) hueBuckets[i].length = 0;
      for (const f of W.pellets) {
        if (f.x < left - pad || f.x > right + pad || f.y < top - pad || f.y > bottom + pad) continue;
        hueBuckets[f.hue].push(f);
      }
      const TAU = Math.PI * 2;
      for (let hi = 0; hi < hueBuckets.length; hi++) {
        const list = hueBuckets[hi];
        if (!list.length) continue;
        g.beginPath();
        for (const f of list) {
          const sr = Math.max(1.4, rOf(f.m) * z);
          const sx = sxOf(f.x), sy = syOf(f.y);
          g.moveTo(sx + sr, sy);
          g.arc(sx, sy, sr, 0, TAU);
        }
        g.fillStyle = cellColor(hi, 58);
        g.fill();
      }

      /* ---- cells, smallest first so the big ones sit on top ---- */
      const all = [];
      for (const p of W.players) { if (!p.dead) for (const c of p.cells) all.push(c); }
      all.sort((a, b) => a.m - b.m);

      for (const c of all) {
        const sr = c.r * z;
        const sx = sxOf(c.x), sy = syOf(c.y);
        if (sx + sr < -20 || sx - sr > vw + 20 || sy + sr < -20 || sy - sr > vh + 20) continue;
        const mine = c.owner === W.me;
        g.beginPath();
        membrane(c, sx, sy, sr, now);
        g.fillStyle = cellColor(c.owner.hue, mine ? 56 : 50);
        g.fill();
        // Below about ten pixels the rim is a sub-pixel smear nobody sees,
        // and at full zoom-out most of the hundred-odd cells on screen are
        // exactly that. Skipping it there halves the draw calls.
        if (mine || sr > 10) {
          g.strokeStyle = mine ? "rgba(255,255,255,.92)" : cellColor(c.owner.hue, 38);
          g.lineWidth = Math.max(mine ? 2.5 : 1.5, sr * (mine ? 0.1 : 0.075));
          g.stroke();
        }

        if (c.owner.safeUntil > W.t) {
          const pulse = 1 + 0.06 * Math.sin(now * 7);
          g.beginPath();
          g.arc(sx, sy, sr * 1.22 * pulse, 0, Math.PI * 2);
          g.strokeStyle = "rgba(255,255,255,.55)";
          g.lineWidth = 2.5;
          g.setLineDash([7, 7]);
          g.stroke();
          g.setLineDash([]);
        }

        if (sr > 17 || mine) {
          const size = clamp(sr * 0.42, 9, 34);
          g.font = `800 ${size}px ui-rounded, system-ui, sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.lineWidth = Math.max(2, size * 0.17);
          g.strokeStyle = "rgba(0,0,0,.45)";
          g.fillStyle = "#fff";
          const label = c.owner.name;
          g.strokeText(label, sx, sy - (sr > 40 ? size * 0.42 : 0));
          g.fillText(label, sx, sy - (sr > 40 ? size * 0.42 : 0));
          if (sr > 40) {
            const ms = Math.round(size * 0.72);
            g.font = `800 ${ms}px ui-rounded, system-ui, sans-serif`;
            g.lineWidth = Math.max(2, ms * 0.17);
            g.strokeText(Math.round(c.m), sx, sy + size * 0.6);
            g.fillText(Math.round(c.m), sx, sy + size * 0.6);
          }
        }
      }

      /* ---- viruses on top of everything but the HUD ---- */
      for (const v of W.viruses) {
        const sr = rOf(v.m) * z;
        const sx = sxOf(v.x), sy = syOf(v.y);
        if (sx + sr < -20 || sx - sr > vw + 20 || sy + sr < -20 || sy - sr > vh + 20) continue;
        drawVirus(v, sx, sy, sr);
      }

      /* ---- feedback ---- */
      for (let i = fx.length - 1; i >= 0; i--) {
        const e = fx[i];
        const k = e.t / 0.6;
        if (k >= 1) { fx.splice(i, 1); continue; }
        const sx = sxOf(e.x), sy = syOf(e.y);
        if (e.kind === "gulp") {
          g.globalAlpha = 1 - k;
          g.font = "800 17px ui-rounded, system-ui, sans-serif";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillStyle = "#9cff9c";
          g.fillText("+" + Math.round(e.m), sx, sy - k * 26);
          g.globalAlpha = 1;
        } else {
          g.globalAlpha = (1 - k) * 0.85;
          g.beginPath();
          g.arc(sx, sy, 20 + k * 70, 0, Math.PI * 2);
          g.strokeStyle = e.kind === "pop" ? "#33d07a" : "#ff5f52";
          g.lineWidth = 4;
          g.stroke();
          g.globalAlpha = 1;
        }
      }

      drawMinimap(vw, vh);
    }

    function drawMinimap(vw, vh) {
      const sa = ctx.safeArea || {};
      const size = clamp(Math.min(vw, vh) * 0.21, 62, 104);
      const x0 = (sa.left || 0) + 12;
      const y0 = vh - size - (sa.bottom || 0) - 12;
      g.globalAlpha = 0.34;
      g.fillStyle = "#000";
      g.fillRect(x0, y0, size, size);
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(255,255,255,.22)";
      g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
      const k = size / WORLD;
      const ranked = leaderboard();
      for (let i = 0; i < Math.min(5, ranked.length); i++) {
        const p = ranked[i];
        if (p === W.me) continue;
        const c = centerOf(p);
        g.beginPath();
        g.arc(x0 + c.x * k, y0 + c.y * k, 2.4, 0, Math.PI * 2);
        g.fillStyle = cellColor(p.hue, 60);
        g.fill();
      }
      if (!W.me.dead) {
        const c = centerOf(W.me);
        g.beginPath();
        g.arc(x0 + c.x * k, y0 + c.y * k, 3.4, 0, Math.PI * 2);
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
      if (!AC || !ctx.capabilities.audio) return { unlock() {}, blip() {}, gulp() {}, split() {}, pop() {}, die() {} };
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
        die() { [520, 392, 294, 196].forEach((f, i) => tone(f, i * 0.12, 0.3, "triangle", 0.16)); }
      };
    })();

    function haptic(kind) {
      if (state.haptics && ctx.capabilities.haptics) ctx.platform.haptic(kind);
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
      submitted: false
    };

    const track = ctx.game && ctx.game.score ? ctx.game.score({ initial: 0, min: 0 }) : null;

    const SAVE_KEY = "petri-bloom/v1";
    async function loadSaved() {
      if (!ctx.capabilities.storage) return;
      let s = null;
      try { s = await ctx.storage.get(SAVE_KEY); } catch (e) { return; }
      if (!s || typeof s !== "object") return;
      if (typeof s.name === "string" && s.name.trim()) state.name = s.name.slice(0, 14);
      if (typeof s.sound === "boolean") state.sound = s.sound;
      if (typeof s.haptics === "boolean") state.haptics = s.haptics;
      if (Number.isFinite(s.best)) state.best = s.best;
    }
    function save() {
      if (!ctx.capabilities.storage) return;
      ctx.storage.set(SAVE_KEY, {
        name: state.name, sound: state.sound, haptics: state.haptics, best: state.best
      }).catch(() => {});
    }

    /* ================================================================ *
     * SURFACES
     * The dish is a canvas underneath; everything readable is DOM on top.
     * The read-only HUD never takes a touch, so a finger dragged across
     * the score still steers the cell.
     * ================================================================ */
    canvas = ctx.createCanvas2D({
      maxDpr: 2, coordinateSpace: "css", alpha: false, layer: "background", touchAction: "none"
    });
    g = canvas.getContext("2d");

    const root = ctx.createRoot({ className: "pb", layer: "overlay", input: "passthrough" });
    root.innerHTML = `<style>${CSS}</style>
<div class="pb-view">
  <div class="pb-stats">
    <div class="pb-mass" data-mass>0</div>
    <div class="pb-sub" data-rank>rank &mdash;</div>
  </div>
  <div class="pb-lead"><h4>Biggest in the dish</h4><ol data-board></ol></div>
</div>
<div class="pb-pads" hidden data-pads>
  <button class="pb-pad" data-split><em>&#9679;&#9679;</em>Split</button>
  <button class="pb-pad" data-eject><em>&#8226;</em>Feed</button>
</div>
<div class="pb-modal" data-modal></div>`;

    const view = root.querySelector(".pb-view");
    const massNode = root.querySelector("[data-mass]");
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
  <div class="pb-tip"><i>&#9679;&#9679;</i><span><b>Split</b> throws half of you forward &mdash; fast, but you are two fragile halves until the timer is up.</span></div>
  <div class="pb-tip"><i>&#8226;</i><span><b>Feed</b> spits out a blob of your own mass. Seven into a spiked virus and it fires a new one.</span></div>
  <div class="pb-tip"><i>&#9670;</i><span>Viruses burst anything bigger than they are. Small cells can hide inside them.</span></div>
  ${state.best ? `<p class="pb-copy">Your best bloom: <b>${Math.round(state.best)}</b></p>` : ""}
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
      W.me.aimX = clamp(cam.x + (sx - ctx.width / 2) / cam.z, 0, WORLD);
      W.me.aimY = clamp(cam.y + (sy - ctx.height / 2) / cam.z, 0, WORLD);
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
      fx.length = 0;
      const c = W.me.cells[0];
      cam.x = c.x; cam.y = c.y; cam.z = 1;
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
      sfx.die();
      haptic("error");
      showModal(deadScreen());
      ctx.platform.fail({
        peak, rank: state.rank, seconds: Math.round(W.t - state.startedAt), killer: state.killer
      });

      if (track && peak > 0 && !state.submitted) {
        state.submitted = true;
        track.set(peak);
        try {
          await track.submit("best_mass", { label: peak + " mass" });
        } catch (e) { /* a refused write must never break the result card */ }
      }
      if (ctx.pulse && ctx.pulse.complete) {
        ctx.pulse.complete({ score: peak, result: "eaten", text: `Bloomed to ${peak} in Petri Bloom` });
      }
    }

    /* ================================================================ *
     * HUD
     * ================================================================ */
    let hudT = 0, boardT = 0;
    function hudTick(dt) {
      hudT += dt; boardT += dt;
      if (hudT >= 0.1) {
        hudT = 0;
        const alive = !W.me.dead;
        massNode.textContent = alive ? Math.round(massOf(W.me)) : "0";
        if (state.screen === "play" && alive) {
          const big = W.me.cells.reduce((m, c) => Math.max(m, c.m), 0);
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
     * LOOP
     * ================================================================ */
    let lastMass = 0;
    function update(dtMs) {
      const dt = Math.min(dtMs || 16, 50) / 1000;
      if (state.screen === "play") readAim();
      stepWorld(dt);

      // Eating anything at all should be audible, but only for you.
      if (!W.me.dead) {
        const m = massOf(W.me);
        if (m > lastMass + 0.5) sfx.blip(m);
        lastMass = m;
      }
      for (const e of fx) {
        e.t += dt;
        if (e.t < dt * 1.5) {
          if (e.kind === "gulp") { sfx.gulp(e.m); haptic("light"); }
          else if (e.kind === "pop") { sfx.pop(); haptic("heavy"); }
        }
      }

      if (state.screen === "play" && W.me.dead) finishRun();
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
