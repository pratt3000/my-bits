/**
 * Maze Duel — two to four people race a hedge maze on one phone, all at once.
 *
 * The phone lies flat on the table and each player sits at one corner of it.
 * A formal garden maze fills the middle of the screen; everybody's peg starts
 * in the corner nearest their own hands and every peg runs at the same time.
 * There are no turns, so nobody waits.
 *
 * Four decisions drive everything else.
 *
 * **The maze is built symmetric, so fairness is a theorem rather than a
 * retry loop.** Passages are carved by a randomised depth-first walk over the
 * *orbits* of the maze's own symmetry group (mirror-x, mirror-y, and the
 * 180-degree rotation). Every carve opens all four mirror images of one edge
 * at once. Two things follow with no verification pass at all: the heart cell
 * is the single fixed point of that group, so every cell provably reaches it,
 * and the four corners are exchanged by the group, so their shortest paths to
 * the heart are exactly equal — not "close", equal. (The bit still measures
 * all four distances every round and publishes them on its test probe, because
 * a proof you never check is a proof you have already broken.)
 *
 * **Control is a floating thumb-stick in each player's own corner of the
 * screen, not a finger on the peg.** Direct dragging fails at exactly the
 * moment the game is decided: four pegs converge on one cell, four hands cover
 * the goal, and a pointer landing between two pegs has no honest owner. The
 * stick zones are disjoint rectangles that never touch the board, so a
 * pointer's owner is decided on pointerdown from geometry alone and held for
 * that pointer's whole life. Nothing ever covers the middle of the board.
 *
 * **The sticks are absolute, never mirrored per seat.** The phone is flat, so
 * a player at the far edge who pushes their thumb *away from their body* is
 * pushing toward the bottom of the screen, and their peg goes toward the
 * bottom of the screen too. Physical direction is shared by everyone around
 * the table; inverting the far seats would be the bug, not the fix.
 *
 * **The duel is the briar.** You start holding one and pick more up in the
 * corridors. Lift your thumb and tap your own corner and a hedge slams across
 * the gap you just walked through, sealed for nine seconds. It costs you your
 * momentum — you have to stop to plant — and it can never seal the last route
 * to the heart for anybody, which is checked with a breadth-first search
 * before the hedge is allowed to grow.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so the gravel,
 * the walnut table and the labyrinth engraved on the goal are painted into
 * OffscreenCanvases at boot and uploaded as textures, with flat-colour
 * fallbacks for WebViews that have no OffscreenCanvas. Every hedge in the maze
 * is one hand-merged BufferGeometry, so the shadow pass that throws the pegs'
 * shadows into the corridors costs one draw call rather than nine hundred. The
 * overlay is one markup string on ctx.createRoot() rather than
 * document.createElement, and pointer maths uses offsetX/offsetY rather than
 * getBoundingClientRect — both of those are rejected at upload and neither is
 * documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Maze Duel",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "maze", "race", "party"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
    const THREE = await ctx.importModule("three", "0.164.1");

    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ---------------------------------------------------------------
     * Palette — a formal hedge garden seen from directly above, laid in
     * a navy-and-gold board frame on an oiled walnut table. Green is
     * reserved entirely for the hedges so no peg can ever be mistaken
     * for terrain.
     * ------------------------------------------------------------- */
    const C = {
      table:   0x1a1712,
      frame:   0x2a4b83,
      gold:    0xffc100,
      gravel:  "#cfc3a6",
      stone:   0xe8dfc8,
      hedgeBase: 0x14300a,
      hedgeSide: 0x3d7a1a,
      hedgeTop:  0x6fae2e,
      hedgeSun:  0x91cd53,
    };

    /** Seats, in claim order. Two players get diagonally opposite corners. */
    const SEATS = [
      { id: "sw", cx: 0, cy: 1, band: "bottom", side: "left",  rot: 0,   hex: 0xc81e1e, name: "Crimson" },
      { id: "ne", cx: 1, cy: 0, band: "top",    side: "right", rot: 180, hex: 0x1e6fd9, name: "Azure"   },
      { id: "se", cx: 1, cy: 1, band: "bottom", side: "right", rot: 0,   hex: 0xf2a50c, name: "Amber"   },
      { id: "nw", cx: 0, cy: 0, band: "top",    side: "left",  rot: 180, hex: 0x8b44c7, name: "Violet"  },
    ];

    const hexStr = (n) => "#" + ("000000" + (n >>> 0).toString(16)).slice(-6);
    /** t > 0 lightens toward white, t < 0 darkens toward black. */
    function shade(n, t) {
      let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      if (t >= 0) { r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
      else { const k = 1 + t; r *= k; g *= k; b *= k; }
      return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
    }

    /** Deterministic rng, so a maze can be replayed exactly in a test. */
    function makeRng(seed) {
      let s = (seed >>> 0) || 1;
      return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296;
      };
    }

    /* ---------------------------------------------------------------
     * Settings, remembered between sessions.
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("mazeduel") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      size: saved.size || 11,                 // maze cells per side: 9 / 11 / 13
      briars: saved.briars === undefined ? 1 : saved.briars,
      mute: !!saved.mute,
    };
    // One record, so changing a setting can never quietly forget the player
    // count and vice versa.
    function saveSettings() {
      try { ctx.storage.set("mazeduel", Object.assign({}, settings, { players: playerCount })); }
      catch (_) {}
    }

    /* ---------------------------------------------------------------
     * Sound. A pulsing bed that tightens as the leader closes on the
     * heart, plus a short cue on every moment that matters. All of it
     * wrapped: audio is a nicety and must never break a race.
     * ------------------------------------------------------------- */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "pulse", volume: 0.30, tempo: 104, intensity: 0.22 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        heat(v) { if (!muted && bed) { try { bed.setIntensity(clamp(v, 0, 1)); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted;
          settings.mute = muted;
          saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 220 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    // Two faces: a geometric grotesque for everything functional (it survives
    // being rotated 180 degrees for the far seats, which is the deciding
    // factor) and a high-contrast old-style serif for the three ceremonial
    // moments. Fired and forgotten — the fallback stacks are real, and the
    // first frame must not wait on a font.
    if (typeof ctx.loadFont === "function") {
      try {
        ctx.loadFont("Space Grotesk").catch(() => {});
        ctx.loadFont("Cormorant Garamond").catch(() => {});
      } catch (_) {}
    }
    const FONT_UI = "'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
    const FONT_D = "'Cormorant Garamond',Georgia,'Times New Roman',serif";

    /* ---------------------------------------------------------------
     * Layout. One world unit is half the screen height, exactly as in a
     * straight-overhead 3D bit. Nothing here ever converts a pointer into
     * table coordinates — the sticks live entirely in screen space and the
     * board is never touched — so there is no raycast anywhere in the bit.
     * ------------------------------------------------------------- */
    const FOV = 24;
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      L.halfH = 1;
      L.halfW = W / H;
      L.dist = 1 / Math.tan((FOV / 2) * Math.PI / 180);
      L.u = 2 / H;                                    // world units per CSS pixel
      L.safeT = ctx.safeArea.top;
      L.safeB = ctx.safeArea.bottom;
      L.chromeB = L.safeT + 44;                       // chrome strip along the top
      // The board carries a physical frame, so the thing that has to fit — and
      // the thing that has to sit centred between the two seating bands — is
      // the framed board, not the gravel inside it.
      const n = settings.size;
      const outer = Math.min(W - 20, (H - L.chromeB - L.safeB) * 0.62);
      L.boardPx = outer / (1 + 0.84 / n);
      L.frameW = Math.max(L.boardPx / n * 0.42, 5);
      L.outer = L.boardPx + L.frameW * 2;
      L.outerTop = Math.round((L.chromeB + (H - L.safeB) - L.outer) / 2);
      L.outerBot = L.outerTop + L.outer;
      L.boardTop = L.outerTop + L.frameW;
      L.boardBot = L.boardTop + L.boardPx;
      L.B = L.boardPx * L.u;                          // board side, world units
      L.zc = (L.boardTop + L.boardPx / 2) / H * 2 - 1; // board centre, world z
      // The two seating bands. Their exact split between players is decided
      // per round in layoutSeats, because a band with one player in it belongs
      // wholly to that player.
      const topBand = L.outerTop - L.chromeB, botBand = (H - L.safeB) - L.outerBot;
      L.stickR = Math.min(46, Math.min(topBand, botBand) * 0.40);
    }
    measure();

    /* ---------------------------------------------------------------
     * Maze.
     *
     * G = { id, mirror-x, mirror-y, rot-180 } is the symmetry group of a
     * square grid of odd side. Carving orbit-wise under G gives two
     * guarantees by construction:
     *
     *   - the heart is G's only fixed cell, and every carve joins a whole
     *     orbit to a whole parent orbit, so induction from the heart
     *     outward proves every cell reaches the heart;
     *   - the four corners lie in one orbit, so their distances to the
     *     heart are identical, not merely similar.
     * ------------------------------------------------------------- */
    let N = settings.size;                    // cells per side (odd)
    let vOpen, hOpen;                         // open-edge lattices
    const vAt = (x, y) => y * (N - 1) + x;    // edge (x,y)|(x+1,y)
    const hAt = (x, y) => y * N + x;          // edge (x,y)|(x,y+1)

    /**
     * Carve one garden. The orbit walk is a spanning tree of the *quotient*,
     * not of the grid, so the union of an edge's four mirror images carries a
     * handful of genuine cycles on top of the tree — six of them at 9x9, ten
     * at 13x13. That is exactly the loopiness a race wants (a few real route
     * choices, no dead-end frustration) and it arrives for free, so there is
     * no knock-extra-walls-out pass: every one of those knocks four holes at
     * once and collapses the whole garden into an open plaza.
     */
    function carve(n, rng) {
      N = n;
      const M = N - 1, m = M / 2;
      vOpen = new Uint8Array((N - 1) * N);
      hOpen = new Uint8Array(N * (N - 1));
      const openV = (x, y) => {
        vOpen[vAt(x, y)] = 1; vOpen[vAt(M - x - 1, y)] = 1;
        vOpen[vAt(x, M - y)] = 1; vOpen[vAt(M - x - 1, M - y)] = 1;
      };
      const openH = (x, y) => {
        hOpen[hAt(x, y)] = 1; hOpen[hAt(M - x, y)] = 1;
        hOpen[hAt(x, M - y - 1)] = 1; hOpen[hAt(M - x, M - y - 1)] = 1;
      };

      // Depth-first walk over orbit representatives, which are exactly the
      // cells of the top-left quadrant including the two centre lines.
      const seen = new Uint8Array(N * N);
      const stack = [[m, m]];
      seen[m * N + m] = 1;
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      while (stack.length) {
        const cur = stack[stack.length - 1];
        const qx = cur[0], qy = cur[1];
        const order = DIRS.slice();
        for (let i = 3; i > 0; i--) {
          const j = (rng() * (i + 1)) | 0;
          const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        let moved = false;
        for (const d of order) {
          const nx = qx + d[0], ny = qy + d[1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const rx = Math.min(nx, M - nx), ry = Math.min(ny, M - ny);
          if (seen[ry * N + rx]) continue;
          if (d[0] === 1) openV(qx, qy);
          else if (d[0] === -1) openV(nx, qy);
          else if (d[1] === 1) openH(qx, qy);
          else openH(qx, ny);
          seen[ry * N + rx] = 1;
          stack.push([rx, ry]);
          moved = true;
          break;
        }
        if (!moved) stack.pop();
      }
    }

    /**
     * Carve until the garden is worth racing. Solvability and fairness are
     * already guaranteed by construction, so the only thing left to want is
     * *length*: a corner sits n-1 steps from the heart as the crow walks, and
     * a maze that lets you walk it straight is not a maze. Nearly twice that
     * floor is the bar, best-of-twelve if the bar is missed — which costs a
     * dozen breadth-first searches over at most 169 cells and, measured over
     * forty seeds, lifts the worst garden an 11x11 will hand you from 14 steps
     * to 20 while leaving the median around 24.
     */
    function buildMaze(n, rng) {
      const floorD = n - 1;
      const target = Math.round(floorD * 1.9);
      let best = null, bestD = -1;
      for (let attempt = 0; attempt < 12; attempt++) {
        carve(n, rng);
        const d = computeDist()[0];            // cell (0,0) — one of the four corners
        if (d > bestD) { bestD = d; best = [vOpen.slice(), hOpen.slice()]; }
        if (d >= target) return d;
      }
      vOpen = best[0]; hOpen = best[1];
      return bestD;
    }

    /* --- briars: temporary hedges grown across an edge --- */
    const briars = new Map();                 // "v:3,4" -> { until, hex, slot, grow }
    const ekey = (e) => e.k + ":" + e.x + "," + e.y;

    function passable(cx, cy, dx, dy) {
      if (dx === 1) {
        if (cx + 1 >= N || !vOpen[vAt(cx, cy)]) return false;
        return !briars.has("v:" + cx + "," + cy);
      }
      if (dx === -1) {
        if (cx - 1 < 0 || !vOpen[vAt(cx - 1, cy)]) return false;
        return !briars.has("v:" + (cx - 1) + "," + cy);
      }
      if (dy === 1) {
        if (cy + 1 >= N || !hOpen[hAt(cx, cy)]) return false;
        return !briars.has("h:" + cx + "," + cy);
      }
      if (cy - 1 < 0 || !hOpen[hAt(cx, cy - 1)]) return false;
      return !briars.has("h:" + cx + "," + (cy - 1));
    }

    /**
     * The cell a peg is committed to. Half way down a corridor you are already
     * spoken for: `cx,cy` is still the cell you left, so anything that asks
     * "where is this player" — the step counter, the briar legality check, the
     * test probe — has to mean the cell being entered, or it reads one step
     * stale and flickers on every edge.
     */
    function committed(p) {
      return p.t > 0 && p.dir
        ? { x: p.cx + p.dir.x, y: p.cy + p.dir.y }
        : { x: p.cx, y: p.cy };
    }

    function edgeBetween(cx, cy, d) {
      if (d.x === 1) return { k: "v", x: cx, y: cy };
      if (d.x === -1) return { k: "v", x: cx - 1, y: cy };
      if (d.y === 1) return { k: "h", x: cx, y: cy };
      return { k: "h", x: cx, y: cy - 1 };
    }

    /** Steps from every cell to the heart across currently open edges. */
    let dist = null;
    function computeDist() {
      const d = new Int16Array(N * N).fill(-1);
      const hx = (N - 1) / 2, hy = (N - 1) / 2;
      const q = [hy * N + hx];
      d[hy * N + hx] = 0;
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let head = 0; head < q.length; head++) {
        const i = q[head], x = i % N, y = (i / N) | 0;
        for (const dd of DIRS) {
          const nx = x + dd[0], ny = y + dd[1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          if (d[ny * N + nx] >= 0) continue;
          if (!passable(x, y, dd[0], dd[1])) continue;
          d[ny * N + nx] = d[i] + 1;
          q.push(ny * N + nx);
        }
      }
      return d;
    }
    function refreshDist() { dist = computeDist(); }

    /* ---------------------------------------------------------------
     * Textures. No packaged assets exist, so every surface is painted
     * into an OffscreenCanvas at boot. document.createElement("canvas")
     * is rejected at upload; this is the accepted way to get a drawing
     * surface the runtime does not mount.
     * ------------------------------------------------------------- */
    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      return new OffscreenCanvas(w, h);
    }

    /** Warm gravel with real grain, plus the slow vignette that keeps the
     *  corridors from reading as a flat diagram. */
    function makeGravel() {
      const S = 700;
      const c = surface(S, S);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = C.gravel;
      g.fillRect(0, 0, S, S);
      const grit = ["#a8997a", "#e4dac0", "#b5a585", "#8f8064"];
      for (let i = 0; i < 15000; i++) {
        g.globalAlpha = 0.05 + Math.random() * 0.13;
        g.fillStyle = grit[(Math.random() * 4) | 0];
        g.beginPath();
        g.arc(Math.random() * S, Math.random() * S, 0.5 + Math.random() * 1.5, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
      const vg = g.createRadialGradient(S / 2, S / 2, S * 0.15, S / 2, S / 2, S * 0.74);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(20,12,4,0.11)");
      g.fillStyle = vg;
      g.fillRect(0, 0, S, S);
      return c;
    }

    /** Dark oiled walnut for the tabletop the board sits on. */
    function makeWalnut() {
      const S = 512;
      const c = surface(S, S);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#2d2419";
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) {
        const y = Math.random() * S;
        g.strokeStyle = Math.random() < 0.55 ? "rgba(146,106,60,0.22)" : "rgba(12,9,5,0.42)";
        g.lineWidth = 0.6 + Math.random() * 2.6;
        g.beginPath();
        g.moveTo(-10, y);
        for (let x = 0; x <= S + 10; x += 46) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3.4);
        g.stroke();
      }
      for (let i = 0; i < 900; i++) {
        g.fillStyle = "rgba(150,112,66,0.06)";
        g.beginPath();
        g.arc(Math.random() * S, Math.random() * S, Math.random() * 1.5, 0, TAU);
        g.fill();
      }
      return c;
    }

    /** The heart: a limestone plaza with a labyrinth cut into it. At the
     *  size one cell gets on a phone a seven-circuit Cretan spiral is mush,
     *  so this is the same figure reduced to three circuits and a mouth. */
    function makeHeart() {
      const S = 256;
      const c = surface(S, S);
      if (!c) return null;
      const g = c.getContext("2d");
      g.clearRect(0, 0, S, S);
      const R = S * 0.5;
      const rad = g.createRadialGradient(S * 0.42, S * 0.40, R * 0.1, S / 2, S / 2, R);
      rad.addColorStop(0, "#f6f1e0");
      rad.addColorStop(0.62, "#e8dfc8");
      rad.addColorStop(1, "#cdbf9c");
      g.fillStyle = rad;
      g.beginPath(); g.arc(S / 2, S / 2, R * 0.99, 0, TAU); g.fill();

      g.strokeStyle = "#b9a87e";
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = S * 0.036;
      for (let i = 0; i < 3; i++) {
        const r = R * (0.34 + i * 0.20);
        const gap = 0.30 + i * 0.12;
        g.beginPath();
        g.arc(S / 2, S / 2, r, -Math.PI / 2 + gap, -Math.PI / 2 - gap + TAU);
        g.stroke();
      }
      g.lineWidth = S * 0.030;
      g.beginPath();
      g.moveTo(S / 2, S / 2 - R * 0.30);
      g.lineTo(S / 2, S / 2 - R * 0.80);
      g.stroke();
      g.fillStyle = "#b9a87e";
      g.beginPath(); g.arc(S / 2, S / 2, S * 0.032, 0, TAU); g.fill();
      return c;
    }

    /* ---------------------------------------------------------------
     * Scene
     * ------------------------------------------------------------- */
    const canvas = ctx.createCanvas({ touchAction: "none" });
    // At dpr 2 the maze is already supersampled by the device pixel ratio, and
    // MSAA on top of that costs a lot of fill rate for an edge you cannot see.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: ctx.dpr < 2, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.dpr, 2));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    ctx.onDestroy(() => renderer.dispose());

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(C.table);

    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.5, 40);
    camera.position.set(0, L.dist, 0);
    camera.up.set(0, 0, -1);                       // screen-up is -z
    camera.lookAt(0, 0, 0);

    const disposables = [];
    const track = (o) => { disposables.push(o); return o; };
    ctx.onDestroy(() => { for (const d of disposables) { try { d.dispose(); } catch (_) {} } });

    function canvasTexture(c, repeat) {
      if (!c) return null;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (repeat) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
      }
      track(t);
      return t;
    }

    /* --- the table the board sits on --- */
    const walnutTex = canvasTexture(makeWalnut(), 2.4);
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(L.halfW * 5, L.halfH * 5),
      new THREE.MeshStandardMaterial({
        color: walnutTex ? 0xffffff : C.table, map: walnutTex || null,
        roughness: 0.86, metalness: 0.04,
      })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.02;
    // Deliberately not a shadow receiver. It fills the whole screen and sits
    // outside the shadow frustum anyway, so every one of its fragments would
    // pay for a shadow lookup that can never darken it.
    scene.add(table);

    /* --- gravel floor of the maze --- */
    const gravelTex = canvasTexture(makeGravel());
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: gravelTex ? 0xffffff : 0xcfc3a6, map: gravelTex || null,
        roughness: 0.94, metalness: 0.0,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    /* --- board frame: the Ravensburger navy band with its gold keyline --- */
    const frameMat = track(new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.42, metalness: 0.30 }));
    const goldMat = track(new THREE.MeshStandardMaterial({
      color: C.gold, emissive: C.gold, emissiveIntensity: 0.55, roughness: 0.30, metalness: 0.70,
    }));
    const frameGroup = new THREE.Group();
    scene.add(frameGroup);
    const seatPosts = [];                          // one gold pyramid per corner

    /* --- the heart --- */
    const heartGroup = new THREE.Group();
    scene.add(heartGroup);
    const heartTex = canvasTexture(makeHeart());
    const heartMat = track(new THREE.MeshStandardMaterial({
      color: heartTex ? 0xffffff : C.stone, map: heartTex || null,
      roughness: 0.72, metalness: 0.05,
    }));
    const heartSideMat = track(new THREE.MeshStandardMaterial({ color: 0xcdbf9c, roughness: 0.8 }));
    let heartDisc = null, heartRing = null, heartBeam = null;
    const heartLight = new THREE.PointLight(C.gold, 0.9, 1, 2);
    heartGroup.add(heartLight);

    /* --- hedges: one hand-merged geometry for the entire maze --- */
    const hedgeMat = track(new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0.0,
    }));
    let hedgeMesh = null;

    /**
     * A box, written straight into flat arrays. Merging by hand avoids
     * BufferGeometryUtils (an addon file, not part of the registry module) and
     * collapses ~900 hedge boxes into a single draw call — which is what makes
     * a per-frame shadow pass over the whole maze affordable.
     */
    function pushBox(P, Nl, Cl, cx, cy, cz, hx, hy, hz, top, side, base) {
      const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
      const QUAD = [0, 1, 2, 0, 2, 3];
      const quad = (v, nx, ny, nz, cols) => {
        for (const i of QUAD) {
          P.push(v[i][0], v[i][1], v[i][2]);
          Nl.push(nx, ny, nz);
          Cl.push(cols[i][0], cols[i][1], cols[i][2]);
        }
      };
      // Vertex colours are consumed in the renderer's linear working space,
      // so they have to travel through THREE.Color rather than being written
      // straight out of an sRGB hex — otherwise every hedge comes out pale.
      const rgb = (n) => { const c = new THREE.Color(n); return [c.r, c.g, c.b]; };
      const cT = rgb(top), cS = rgb(side), cB = rgb(base);
      const sideCols = [cB, cB, cS, cS];
      quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 0, 1, 0, [cT, cT, cT, cT]);
      quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 1, 0, 0, sideCols);
      quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0, sideCols);
      quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1, sideCols);
      quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 0, 0, -1, sideCols);
    }

    /* --- pegs --- */
    const pegGroups = [];
    function makePeg(hex) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 0.90, 1, 26),
        track(new THREE.MeshStandardMaterial({
          color: shade(hex, -0.30), emissive: shade(hex, -0.6), emissiveIntensity: 0.4,
          roughness: 0.34, metalness: 0.16,
        }))
      );
      body.castShadow = true;
      // A glossy dome is what a top-down wooden peg actually is: the highlight
      // is real specular off real geometry rather than a painted ellipse.
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 12, 0, TAU, 0, Math.PI / 2),
        track(new THREE.MeshStandardMaterial({
          color: shade(hex, 0.16), emissive: hex, emissiveIntensity: 0.16,
          roughness: 0.20, metalness: 0.08,
        }))
      );
      cap.castShadow = true;
      // A lit collar wider than the dome, so the peg still reads as its own
      // colour from directly overhead where the dome is all you can see.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.15, 8, 28),
        track(new THREE.MeshStandardMaterial({
          color: shade(hex, 0.30), emissive: shade(hex, 0.10), emissiveIntensity: 0.75, roughness: 0.34,
        }))
      );
      ring.rotation.x = Math.PI / 2;
      g.add(body, cap, ring);
      g.userData = { body, cap, ring };
      g.visible = false;
      scene.add(g);
      return g;
    }
    for (const s of SEATS) pegGroups.push(makePeg(s.hex));

    /* --- seeds: amber pods that hand out briars --- */
    const seedMeshes = [];

    /* --- sparks: a fixed pool, never allocated mid-race --- */
    const sparks = (function () {
      const POOL = 70;
      const geo = track(new THREE.SphereGeometry(1, 8, 6));
      const pool = [];
      for (let i = 0; i < POOL; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0,
        }));
        track(m.material);
        m.visible = false;
        scene.add(m);
        pool.push({ mesh: m, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
      }
      let next = 0;
      return {
        burst(x, z, hex, count, power, size) {
          for (let i = 0; i < count; i++) {
            const p = pool[next = (next + 1) % POOL];
            const a = Math.random() * TAU;
            const sp = power * (0.35 + Math.random() * 0.95);
            p.mesh.position.set(x, size * 1.2, z);
            p.mesh.scale.setScalar(size);
            p.mesh.material.color.setHex(hex);
            p.vx = Math.cos(a) * sp;
            p.vz = Math.sin(a) * sp;
            p.vy = power * (0.5 + Math.random() * 0.8);
            p.max = p.life = 0.35 + Math.random() * 0.45;
            p.base = size;
            p.mesh.visible = true;
          }
        },
        step(dt) {
          for (const p of pool) {
            if (p.life <= 0) continue;
            p.life -= dt;
            if (p.life <= 0) { p.mesh.visible = false; continue; }
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            p.vy -= 2.6 * dt;
            if (p.mesh.position.y < p.base * 0.4) { p.mesh.position.y = p.base * 0.4; p.vy *= -0.35; }
            p.vx *= 0.955; p.vz *= 0.955;
            const t = p.life / p.max;
            p.mesh.material.opacity = t;
            p.mesh.scale.setScalar(p.base * (0.5 + t * 0.8));
          }
        },
      };
    })();

    /* --- lights: one key from the upper left so every hedge in the garden
     * is lit identically and throws its shadow down-right into the
     * corridors, which is the whole reason the maze reads as a place. --- */
    scene.add(new THREE.AmbientLight(0xbdb094, 0.60));
    scene.add(new THREE.HemisphereLight(0xbdd4f2, 0x35281a, 0.34));
    const key = new THREE.DirectionalLight(0xfff2d2, 1.45);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0015;
    key.shadow.normalBias = 0.006;
    scene.add(key);
    scene.add(key.target);

    /* ---------------------------------------------------------------
     * Board construction — rebuilt whenever the maze changes.
     * ------------------------------------------------------------- */
    let cell = 0, x0 = 0, z0 = 0, wallT = 0, wallH = 0;
    const cellX = (x) => x0 + (x + 0.5) * cell;
    const cellZ = (y) => z0 + (y + 0.5) * cell;

    function buildBoard() {
      const B = L.B;
      cell = B / N;
      x0 = -B / 2;
      z0 = L.zc - B / 2;
      wallT = cell * 0.24;
      wallH = cell * 0.70;

      floor.geometry.dispose();
      floor.geometry = new THREE.PlaneGeometry(B, B);
      floor.position.set(0, 0, L.zc);

      /* --- frame --- */
      while (frameGroup.children.length) {
        const c = frameGroup.children.pop();
        if (c.geometry) c.geometry.dispose();
      }
      seatPosts.length = 0;
      const fw = L.frameW * L.u;
      const fh = cell * 0.52;
      const half = B / 2 + fw / 2;
      const bandGeoH = new THREE.BoxGeometry(B + fw * 2, fh, fw);
      const bandGeoV = new THREE.BoxGeometry(fw, fh, B + fw * 2);
      for (const [gx, gz, geo] of [[0, -half, bandGeoH], [0, half, bandGeoH],
                                   [-half, 0, bandGeoV], [half, 0, bandGeoV]]) {
        const m = new THREE.Mesh(geo, frameMat);
        m.position.set(gx, fh / 2, L.zc + gz);
        m.castShadow = true;
        m.receiveShadow = true;
        frameGroup.add(m);
      }
      // Gold rail, running down the middle of the navy band rather than its
      // inner lip: hard against the board the outer hedge leans over it under
      // even a 24-degree lens and the rule shows up in patches.
      const klT = fw * 0.20, klR = B / 2 + fw * 0.5;
      const klH = new THREE.BoxGeometry(B + fw * 2, fh * 0.26, klT);
      const klV = new THREE.BoxGeometry(klT, fh * 0.26, B + fw * 2);
      for (const [gx, gz, geo] of [[0, -klR, klH], [0, klR, klH],
                                   [-klR, 0, klV], [klR, 0, klV]]) {
        const m = new THREE.Mesh(geo, goldMat);
        m.position.set(gx, fh + fh * 0.10, L.zc + gz);
        frameGroup.add(m);
      }
      // Corner posts: a small pyramid on each corner of the frame, taking the
      // colour of whoever starts in that corner, so a player can find their
      // own end of the garden without reading anything.
      const postGeo = new THREE.CylinderGeometry(0, fw * 0.88, fh * 2.3, 4);
      for (const s of SEATS) {
        const m = new THREE.Mesh(postGeo, track(new THREE.MeshStandardMaterial({
          color: C.gold, emissive: C.gold, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.6,
        })));
        m.position.set((s.cx ? 1 : -1) * half, fh * 1.15, L.zc + (s.cy ? 1 : -1) * half);
        m.rotation.y = Math.PI / 4;
        m.castShadow = true;
        frameGroup.add(m);
        seatPosts.push(m);
      }

      /* --- heart --- */
      while (heartGroup.children.length > 1) {
        const c = heartGroup.children.pop();
        if (c.geometry) c.geometry.dispose();
      }
      const hr = cell * 0.44;
      heartDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(hr, hr * 0.96, cell * 0.07, 42),
        [heartSideMat, heartMat, heartSideMat]
      );
      heartDisc.position.set(cellX((N - 1) / 2), cell * 0.035, cellZ((N - 1) / 2));
      heartDisc.receiveShadow = true;
      heartGroup.add(heartDisc);
      heartRing = new THREE.Mesh(
        new THREE.TorusGeometry(hr * 1.02, cell * 0.045, 10, 46),
        track(new THREE.MeshStandardMaterial({
          color: C.gold, emissive: C.gold, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.5,
        }))
      );
      heartRing.rotation.x = Math.PI / 2;
      heartRing.position.copy(heartDisc.position);
      heartRing.position.y = cell * 0.085;
      heartGroup.add(heartRing);
      // A soft column of light standing over the goal — narrow and faint on
      // purpose. Seen from directly overhead a wide column is not a beam, it is
      // a bloom the size of three cells sitting on top of the thing it is
      // supposed to be marking.
      heartBeam = new THREE.Mesh(
        new THREE.CylinderGeometry(hr * 0.44, hr * 0.14, cell * 2.0, 18, 1, true),
        track(new THREE.MeshBasicMaterial({
          color: 0xffdf82, transparent: true, opacity: 0.06,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }))
      );
      heartBeam.position.set(heartDisc.position.x, cell * 1.05, heartDisc.position.z);
      heartGroup.add(heartBeam);
      heartLight.position.set(heartDisc.position.x, cell * 0.55, heartDisc.position.z);
      heartLight.distance = cell * 1.5;

      /* --- hedges --- */
      buildHedges();

      /* --- key light and its shadow frustum, sized to the board.
       * Fifty-eight degrees of elevation from the upper left: high enough
       * that a corridor keeps most of its warm gravel, low enough that every
       * hedge lays a hard band of shade a little under half a cell wide down
       * its right side. That band is what makes the maze read as a place
       * rather than a line drawing. --- */
      key.position.set(-B * 0.55, B * 1.25, L.zc - B * 0.55);
      key.target.position.set(0, 0, L.zc);
      key.target.updateMatrixWorld();
      key.shadow.bias = -0.0006;
      key.shadow.normalBias = cell * 0.03;
      const sc = key.shadow.camera;
      sc.left = -B * 0.95; sc.right = B * 0.95;
      sc.top = B * 0.95; sc.bottom = -B * 0.95;
      sc.near = 0.05; sc.far = B * 4;
      sc.updateProjectionMatrix();

      /* --- pegs and seeds scaled to the new cell size --- */
      const pr = cell * 0.29;
      for (const g of pegGroups) {
        const u = g.userData;
        u.body.scale.set(pr, cell * 0.34, pr);
        u.body.position.y = cell * 0.17;
        u.cap.scale.set(pr * 0.94, cell * 0.22, pr * 0.94);
        u.cap.position.y = cell * 0.34;
        u.ring.scale.set(pr * 1.06, pr * 1.06, pr * 1.0);
        u.ring.position.y = cell * 0.33;
      }
      for (const m of seedMeshes) m.scale.setScalar(cell * 0.19);
    }

    function buildHedges() {
      const segV = [], segH = [], post = [];
      for (let bx = 0; bx <= N; bx++) { segV.push(new Uint8Array(N)); }
      for (let x = 0; x < N; x++) { segH.push(new Uint8Array(N + 1)); }
      for (let bx = 0; bx <= N; bx++) post.push(new Uint8Array(N + 1));

      for (let y = 0; y < N; y++) {
        segV[0][y] = 1; segV[N][y] = 1;
        for (let vx = 0; vx < N - 1; vx++) if (!vOpen[vAt(vx, y)]) segV[vx + 1][y] = 1;
      }
      for (let x = 0; x < N; x++) {
        segH[x][0] = 1; segH[x][N] = 1;
        for (let hy = 0; hy < N - 1; hy++) if (!hOpen[hAt(x, hy)]) segH[x][hy + 1] = 1;
      }
      for (let bx = 0; bx <= N; bx++) {
        for (let by = 0; by <= N; by++) {
          const a = by > 0 && segV[bx][by - 1], b = by < N && segV[bx][by];
          const c = bx > 0 && segH[bx - 1][by], d = bx < N && segH[bx][by];
          if (a || b || c || d) post[bx][by] = 1;
        }
      }

      const P = [], Nl = [], Cl = [];
      const rng = makeRng(0x9e37 ^ (N * 2654435761));
      const lineX = (bx) => x0 + bx * cell;
      const lineZ = (by) => z0 + by * cell;
      const t = wallT / 2;

      function slab(cx, cz, hx, hz) {
        const h = wallH * (0.88 + rng() * 0.22);
        const tone = shade(C.hedgeSide, (rng() - 0.5) * 0.36);
        const sideTone = shade(C.hedgeSide, (rng() - 0.5) * 0.20);
        pushBox(P, Nl, Cl, cx, h / 2, cz, hx, h / 2, hz, tone, sideTone, C.hedgeBase);
        // The clipped crown: a narrow sunlit ridge riding the top, leaving a
        // band of shaded foliage down each flank. Widen it past about half the
        // slab and the hedge stops being topiary and starts being lime plastic.
        pushBox(P, Nl, Cl, cx, h + cell * 0.030, cz,
                hx * (hx < hz ? 0.46 : 0.97), cell * 0.050, hz * (hz < hx ? 0.46 : 0.97),
                shade(C.hedgeSun, (rng() - 0.5) * 0.24), shade(C.hedgeTop, -0.1), sideTone);
      }

      for (let bx = 0; bx <= N; bx++) {
        for (let y = 0; y < N; y++) {
          if (segV[bx][y]) slab(lineX(bx), lineZ(y) + cell / 2, t, cell / 2);
        }
      }
      for (let x = 0; x < N; x++) {
        for (let by = 0; by <= N; by++) {
          if (segH[x][by]) slab(lineX(x) + cell / 2, lineZ(by), cell / 2, t);
        }
      }
      for (let bx = 0; bx <= N; bx++) {
        for (let by = 0; by <= N; by++) {
          if (post[bx][by]) slab(lineX(bx), lineZ(by), t, t);
        }
      }

      if (hedgeMesh) { scene.remove(hedgeMesh); hedgeMesh.geometry.dispose(); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(Nl, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(Cl, 3));
      hedgeMesh = new THREE.Mesh(geo, hedgeMat);
      hedgeMesh.castShadow = true;
      hedgeMesh.receiveShadow = true;
      scene.add(hedgeMesh);
    }

    /* ---------------------------------------------------------------
     * Game state
     * ------------------------------------------------------------- */
    const SPEED = 3.4;                        // cells per second
    const BRIAR_MS = 9000;
    const MAX_BRIARS = 3;
    let phase = "menu";                       // menu | count | play | over
    let playerCount = saved.players || 2;
    let players = [];
    let countdown = 0, winner = null, elapsed = 0;
    let startDist = 1, dangerFired = false;
    const seeds = [];                         // { x, y, mesh }
    let seedTimer = 0;

    function makePlayers(n) {
      players = [];
      for (let i = 0; i < n; i++) {
        const s = SEATS[i];
        const cx = s.cx ? N - 1 : 0, cy = s.cy ? N - 1 : 0;
        players.push({
          i, seat: s, hex: s.hex, cx, cy, t: 0, dir: null,
          want: null, want2: null, px: cx, py: cy,
          briars: settings.briars ? 1 : 0, lastEdge: null, done: false,
          bump: 0, hop: 0, pending: 0,
        });
      }
      for (let i = 0; i < pegGroups.length; i++) pegGroups[i].visible = i < n;
      layoutSeats();
    }

    /** Grow a fresh garden and refit everything to it. The garden size is a
     *  setting, so cell size, frame width and both seating bands move with it. */
    function growGarden() {
      measure();
      buildMaze(settings.size, makeRng((Math.random() * 4294967295) >>> 0));
      buildBoard();
      applyLayout();
      refreshDist();
      makePlayers(playerCount);
      syncPegs();
    }

    function newRound(freshMaze) {
      briars.clear();
      for (const b of briarPool) { b.busy = false; b.mesh.visible = false; }
      if (freshMaze) growGarden();
      for (const m of seedMeshes) m.visible = false;
      seeds.length = 0;
      makePlayers(playerCount);
      refreshDist();
      startDist = Math.max(1, dist[players[0].cy * N + players[0].cx]);
      winner = null;
      elapsed = 0;
      dangerFired = false;
      seedTimer = 2.5;
      phase = "count";
      countdown = 3.0;
      syncPegs();
      paintHud();
      sound.heat(0.2);
    }

    /* --- movement: lane-following, so a corridor exactly one cell wide is
     * never a collision problem and a turn is always crisp --- */
    function chooseDir(p) {
      if (p.want && passable(p.cx, p.cy, p.want.x, p.want.y)) return p.want;
      if (p.want2 && passable(p.cx, p.cy, p.want2.x, p.want2.y)) return p.want2;
      if (p.want && p.dir && passable(p.cx, p.cy, p.dir.x, p.dir.y)) return p.dir;
      return null;
    }

    function stepPlayer(p, dt) {
      if (p.done) return;
      // A reversal mid-corridor is instant: you never have to reach the far
      // cell before turning back, which is what makes a wrong guess cheap.
      if (p.t > 0 && p.dir && p.want && p.want.x === -p.dir.x && p.want.y === -p.dir.y) {
        p.cx += p.dir.x; p.cy += p.dir.y;
        p.t = 1 - p.t;
        p.dir = p.want;
      }
      let budget = SPEED * dt;
      let guard = 0;
      while (budget > 0 && guard++ < 8) {
        if (p.t === 0) {
          const d = chooseDir(p);
          if (!d) { p.dir = null; break; }
          p.dir = d;
        }
        const remain = 1 - p.t;
        if (budget < remain) { p.t += budget; budget = 0; }
        else {
          budget -= remain;
          p.lastEdge = edgeBetween(p.cx, p.cy, p.dir);
          p.cx += p.dir.x; p.cy += p.dir.y;
          p.t = 0;
          onArrive(p);
          if (p.done) return;
        }
      }
      p.px = p.cx + (p.dir ? p.dir.x * p.t : 0);
      p.py = p.cy + (p.dir ? p.dir.y * p.t : 0);
    }

    function onArrive(p) {
      p.hop = 1;
      if (p.pending > 0) { p.pending = 0; plant(p); }
      // seeds
      for (let i = seeds.length - 1; i >= 0; i--) {
        const s = seeds[i];
        if (s.x !== p.cx || s.y !== p.cy) continue;
        s.mesh.visible = false;
        seeds.splice(i, 1);
        if (p.briars < MAX_BRIARS) p.briars++;
        sparks.burst(cellX(p.cx), cellZ(p.cy), 0xffd166, 10, cell * 1.6, cell * 0.05);
        sound.sting("coin");
        sound.haptic("light");
        paintHud();
      }
      const h = (N - 1) / 2;
      if (p.cx === h && p.cy === h) { win(p); return; }
      refreshDist();
      paintHud();
    }

    /* --- briars --- */
    const briarPool = [];
    function initBriarPool() {
      const geo = track(new THREE.BoxGeometry(1, 1, 1));
      for (let i = 0; i < 14; i++) {
        const mat = track(new THREE.MeshStandardMaterial({
          color: 0x2f5c1c, emissive: 0x000000, roughness: 0.8, metalness: 0.0,
        }));
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.visible = false;
        scene.add(m);
        briarPool.push({ mesh: m, mat, busy: false });
      }
    }
    initBriarPool();

    function fizzle(p) {
      p.bump = 1;
      sound.sting("fail");
      sound.haptic("warning");
    }

    /**
     * A tap is a briar. Half way down a corridor there is nothing behind you
     * yet to seal, so rather than punishing a thumb that landed sixty
     * milliseconds off a cell boundary the tap is remembered and spent the
     * instant the peg clears the gap.
     */
    // Records the outcome of every tap, so a failing simultaneous-input test
    // can tell "the tap never reached this player" from "the tap reached them
    // and the rules refused it" — completely different bugs.
    const plantLog = [];
    function note(p, why) { plantLog.push({ seat: p && p.seat ? p.seat.id : "?", why }); if (plantLog.length > 40) plantLog.shift(); }

    function requestPlant(p) {
      if (!p || p.done || !settings.briars) { note(p, "off-or-done"); return; }
      if (p.briars <= 0) { note(p, "none-in-hand"); return fizzle(p); }
      if (p.t === 0) { note(p, "immediate"); return plant(p); }
      note(p, "deferred");
      p.pending = 0.6;
    }

    function plant(p) {
      if (!settings.briars || p.done) return;
      if (phase !== "play" || p.briars <= 0 || !p.lastEdge || p.t !== 0) {
        note(p, !p.lastEdge ? "no-edge-behind" : p.t !== 0 ? "mid-corridor" : "no-briar");
        return fizzle(p);
      }
      const k = ekey(p.lastEdge);
      if (briars.has(k)) { note(p, "edge-taken"); return fizzle(p); }
      for (const q of players) {
        if (q === p || q.t === 0 || !q.dir) continue;
        const e = edgeBetween(q.cx, q.cy, q.dir);
        if (e.k === p.lastEdge.k && e.x === p.lastEdge.x && e.y === p.lastEdge.y) return fizzle(p);
      }
      // A hedge may never seal the last route to the heart for anybody. This
      // is the one rule that keeps the goal from being walled off, and it is
      // cheap: four breadth-first searches over at most 169 cells.
      briars.set(k, { until: Infinity, hex: p.hex, slot: null });
      const probe = computeDist();
      let ok = true;
      for (const q of players) {
        const c = committed(q);
        if (probe[c.y * N + c.x] < 0) ok = false;
      }
      if (!ok) { briars.delete(k); note(p, "would-wall-someone-off"); return fizzle(p); }

      const slot = briarPool.find((b) => !b.busy);
      note(p, "planted");
      briars.set(k, { until: performance.now() + BRIAR_MS, hex: p.hex, slot, grow: 0 });
      p.briars--;
      const e = p.lastEdge;
      const vertical = e.k === "v";
      const mx = vertical ? x0 + (e.x + 1) * cell : cellX(e.x);
      const mz = vertical ? cellZ(e.y) : z0 + (e.y + 1) * cell;
      if (slot) {
        slot.busy = true;
        slot.mesh.position.set(mx, wallH * 0.44, mz);
        slot.mesh.scale.set(vertical ? wallT : cell * 0.94, 0.1, vertical ? cell * 0.94 : wallT);
        // Dark thorn with the owner's hue banked into it, deliberately not
        // hedge-green: a briar is temporary and belongs to somebody, and it
        // should never be mistaken for the permanent garden.
        slot.mat.color.setHex(shade(p.hex, -0.62));
        slot.mat.emissive.setHex(p.hex);
        slot.mat.emissiveIntensity = 0.22;
        slot.mesh.visible = true;
      }
      refreshDist();
      paintHud();
      sparks.burst(mx, mz, shade(C.hedgeSun, 0.05), 14, cell * 2.2, cell * 0.045);
      sound.duck(0.35, 260);
      sound.sting("powerup");
      sound.haptic("medium");
      ctx.platform.interact({ type: "briar", by: p.seat.id });
    }

    function expireBriars(now) {
      let changed = false;
      for (const [k, b] of briars) {
        if (b.until > now) continue;
        briars.delete(k);
        if (b.slot) { b.slot.busy = false; b.slot.mesh.visible = false; }
        changed = true;
      }
      if (changed) { refreshDist(); paintHud(); }
    }

    /* --- seeds spawn in symmetric orbits, so no corner is ever nearer to a
     * pickup than another --- */
    function spawnSeedOrbit() {
      if (seeds.length >= 4) return;
      const M = N - 1, m = M / 2;
      for (let tries = 0; tries < 40; tries++) {
        const qx = (Math.random() * (m + 1)) | 0, qy = (Math.random() * (m + 1)) | 0;
        const d = dist[qy * N + qx];
        if (d < 3 || d > startDist - 2) continue;
        const cells = [];
        for (const [ax, ay] of [[qx, qy], [M - qx, qy], [qx, M - qy], [M - qx, M - qy]]) {
          if (!cells.some((c) => c[0] === ax && c[1] === ay)) cells.push([ax, ay]);
        }
        if (seeds.some((s) => cells.some((c) => c[0] === s.x && c[1] === s.y))) continue;
        for (const [ax, ay] of cells) {
          const mesh = seedMeshes.find((x) => !x.visible);
          if (!mesh) break;
          mesh.visible = true;
          mesh.position.set(cellX(ax), cell * 0.30, cellZ(ay));
          seeds.push({ x: ax, y: ay, mesh });
        }
        return;
      }
    }

    /* ---------------------------------------------------------------
     * Overlay. One markup string on the runtime-owned root, queried back
     * with [data-el]. The root is transparent to pointers: it is created
     * after the canvas and would otherwise swallow every thumb-stick.
     * ------------------------------------------------------------- */
    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT_UI + ";color:#f3ede0;pointer-events:none;" +
      "-webkit-user-select:none;user-select:none;";

    const plate = "background:linear-gradient(180deg,#2b4a7d,#1d3660);border:1.5px solid rgba(255,193,0,0.55);" +
      "border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,0.45);";
    // display:block, not the default inline-block: a full-width button on a
    // line box carries the line's leading underneath it, which is exactly the
    // kind of few-pixel drift that stops the winner card's two faces sitting
    // the same distance from their own edge.
    const bigBtn = (bg, fg, edge) => "pointer-events:auto;display:block;width:100%;padding:15px;border-radius:23px;" +
      "font-family:inherit;font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;" +
      "border:" + (edge ? "1.5px solid " + edge : "none") + ";" +
      "background:" + bg + ";color:" + fg + ";margin-top:10px;";
    const quietBtn = bigBtn("rgba(36,64,110,0.92)", "#ffe9a8", "rgba(255,193,0,0.55)");
    const iconBtn = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:1px solid rgba(255,193,0,0.35);" +
      "background:rgba(36,64,110,0.85);color:#ffd166;font-size:15px;line-height:1;font-family:inherit;padding:0;";
    // Countdown numerals: two of them plus the gap between must clear the
    // heart, so they are smaller than a single centred numeral would be.
    const COUNT_SIZE = 58, COUNT_GAP = 54;
    const countNum = "font-family:" + FONT_D + ";font-size:" + COUNT_SIZE + "px;font-style:italic;" +
      "font-weight:600;color:#ffe9a8;text-shadow:0 6px 34px rgba(255,193,0,0.55);line-height:1;";
    const rule = (margin) => '<div style="height:1px;margin:' + margin + ';background:linear-gradient(90deg,' +
      'rgba(255,193,0,0),rgba(255,193,0,0.34),rgba(255,193,0,0));"></div>';
    /** One face of the winner card. `sfx` is "r" for the copy the far seats read. */
    const overFace = (sfx) =>
      '<div style="' + (sfx ? "transform:rotate(180deg);" : "") + '">' +
        '<div style="font-size:9.5px;letter-spacing:0.32em;text-transform:uppercase;opacity:0.5;">The heart is taken by</div>' +
        '<div data-el="over-name' + sfx + '" style="font-family:' + FONT_D + ';font-style:italic;font-weight:600;' +
          'font-size:50px;line-height:1.08;margin-top:3px;white-space:nowrap;"></div>' +
        '<div data-el="over-stats' + sfx + '" style="display:flex;margin-top:13px;"></div>' +
      '</div>';
    /** One cell of the winner card's stat strip. Split into three so the line
     *  never has to be squeezed to fit a 390px screen. */
    const statCell = (v, l, edge) =>
      '<div style="flex:1;min-width:0;' + (edge ? "border-left:1px solid rgba(255,193,0,0.18);" : "") + '">' +
        '<div style="font-size:15px;font-weight:700;color:#ffe9a8;">' + esc(v) + '</div>' +
        '<div style="font-size:8px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.46;margin-top:3px;">' +
          esc(l) + '</div>' +
      '</div>';

    function seatMarkup(s, idx) {
      const rot = "transform:rotate(" + s.rot + "deg);";
      return (
        // HUD plate, hugging the board on that player's side and rotated to
        // their seat so they are never reading their own name upside down.
        '<div data-el="hud-' + idx + '" style="position:absolute;display:none;width:164px;height:30px;' +
          plate + rot + 'align-items:center;gap:6px;padding:0 9px;box-sizing:border-box;overflow:hidden;">' +
          '<span data-el="sw-' + idx + '" style="width:11px;height:11px;border-radius:50%;flex:none;' +
            'box-shadow:0 0 0 1.5px rgba(0,0,0,0.35);"></span>' +
          '<span data-el="nm-' + idx + '" style="font-size:9px;font-weight:700;letter-spacing:0.11em;' +
            'flex:1;min-width:0;overflow:hidden;white-space:nowrap;"></span>' +
          '<span data-el="br-' + idx + '" style="font-size:9px;letter-spacing:0.06em;color:#ffc100;flex:none;"></span>' +
          '<span data-el="st-' + idx + '" style="font-size:14px;font-weight:700;min-width:20px;flex:none;' +
            'text-align:right;"></span>' +
        '</div>' +
        // Floating stick: a ring that appears where the thumb lands.
        '<div data-el="ring-' + idx + '" style="position:absolute;left:0;top:0;width:0;height:0;' +
          'box-sizing:border-box;border-radius:50%;border:2px solid rgba(255,255,255,0.16);display:none;"></div>' +
        '<div data-el="knob-' + idx + '" style="position:absolute;left:0;top:0;width:0;height:0;' +
          'border-radius:50%;display:none;"></div>' +
        // Idle hint sitting at the stick home, so a player knows where to press.
        '<div data-el="home-' + idx + '" style="position:absolute;left:0;top:0;width:0;height:0;' +
          'box-sizing:border-box;border-radius:50%;border:2px dashed;display:none;"></div>' +
        '<div data-el="hint-' + idx + '" style="position:absolute;display:none;' + rot +
          'font-size:8.5px;font-weight:600;letter-spacing:0.13em;text-transform:uppercase;white-space:nowrap;">' +
          'Drag to run &middot; tap to plant</div>'
      );
    }

    root.innerHTML =
      SEATS.map(seatMarkup).join("") +
      // --- chrome, centred on the top edge where it belongs to nobody's zone ---
      // The chrome sits above the title and win cards (z 50/55) and below the
      // two modal panels (z 70). Under the cards it would be unreachable —
      // which is exactly where a player goes looking for the rules.
      '<div data-el="chrome" style="position:absolute;left:0;right:0;top:' + (L.safeT + 5) + 'px;' +
        'display:flex;gap:8px;justify-content:center;z-index:60;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + iconBtn + '">&#9834;</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + iconBtn + '">&#9881;</button>' +
        '<button data-el="help" aria-label="How to play" style="' + iconBtn + '">?</button>' +
      '</div>' +
      // --- countdown ---
      // "3" and "RUN" are both nonsense read upside down, so the beat is
      // struck twice, back to back, with the heart glowing in the gap between
      // them. Positioned on the board's centre — not the screen's — in
      // applyLayout, so it lands on the heart rather than near it.
      '<div data-el="count" style="position:absolute;left:0;right:0;top:0;' +
        'text-align:center;display:none;pointer-events:none;z-index:30;">' +
        '<div data-el="count-r" style="' + countNum + 'transform:rotate(180deg);"></div>' +
        '<div style="height:' + COUNT_GAP + 'px;"></div>' +
        '<div data-el="count-n" style="' + countNum + '"></div>' +
      '</div>' +
      // --- title ---
      // The garden is already on screen and moving, so the card is a plate laid
      // on the board in the frame's own material rather than a curtain drawn
      // over it: narrow enough that the hedges, the compass posts and the
      // glowing heart still read all the way round it.
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'align-items:center;justify-content:center;z-index:50;padding:20px;box-sizing:border-box;' +
        'background:radial-gradient(122% 64% at 50% 46%,rgba(14,11,7,0.40),rgba(9,7,4,0.82));">' +
        '<div style="width:100%;max-width:282px;box-sizing:border-box;text-align:center;' +
          'background:linear-gradient(180deg,rgba(26,45,74,0.93),rgba(16,28,47,0.95));' +
          'border:1.5px solid rgba(255,193,0,0.45);border-radius:22px;padding:24px 20px;' +
          'box-shadow:0 26px 70px rgba(0,0,0,0.68);">' +
          '<div style="font-size:10px;letter-spacing:0.38em;text-transform:uppercase;opacity:0.5;">A garden race for 2-4</div>' +
          '<div style="font-family:' + FONT_D + ';font-style:italic;font-weight:600;font-size:54px;line-height:1.02;' +
            'margin-top:6px;background:linear-gradient(96deg,#91cd53,#ffc100 60%,#f2a50c);' +
            '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">Maze&nbsp;Duel</div>' +
          '<div style="font-size:13px;opacity:0.68;line-height:1.6;margin-top:10px;">' +
            'Lay the phone flat. Take a corner each. Everybody runs at once — first peg into the heart takes it.</div>' +
          '<div style="font-size:10px;letter-spacing:0.24em;text-transform:uppercase;opacity:0.45;margin-top:20px;">How many walk the maze?</div>' +
          '<div data-el="counts" style="display:flex;gap:11px;margin-top:11px;justify-content:center;"></div>' +
          '<button data-el="go" style="' + bigBtn("linear-gradient(96deg,#41761a,#7cb93a)", "#081a00") +
            'margin-top:20px;">Enter the garden</button>' +
        '</div>' +
      '</div>' +
      // --- winner ---
      // Two copies of the result, back to back like the indices on a playing
      // card: the far half of the table is reading this screen upside down,
      // and a result only one end of the table can read is not a result. The
      // buttons sit between the two so either end can reach them.
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;z-index:55;padding:20px;box-sizing:border-box;' +
        // Lighter than a modal on purpose: the frame flooding with the
        // winner's colour is the payoff, and blacking it out to make room for
        // a banner throws the payoff away. The card carries the text so the
        // hedges never have to double as its background.
        'background:radial-gradient(118% 60% at 50% 47%,rgba(14,11,7,0.34),rgba(9,7,4,0.80));">' +
        '<div style="width:100%;max-width:296px;box-sizing:border-box;text-align:center;' +
          'background:linear-gradient(180deg,rgba(26,45,74,0.95),rgba(16,28,47,0.97));' +
          'border:1.5px solid rgba(255,193,0,0.45);border-radius:22px;padding:20px 18px;' +
          'box-shadow:0 26px 70px rgba(0,0,0,0.7);">' +
          overFace("r") +
          rule("16px 2px") +
          '<button data-el="again" style="' + bigBtn("linear-gradient(96deg,#41761a,#7cb93a)", "#081a00") + '">New garden</button>' +
          '<button data-el="back" style="' + quietBtn + '">Change setup</button>' +
          rule("14px 16px") +
          overFace("") +
        '</div>' +
      '</div>' +
      // --- settings ---
      '<div data-el="cogp" style="position:absolute;inset:0;pointer-events:auto;display:none;align-items:center;' +
        'justify-content:center;background:rgba(12,10,7,0.88);z-index:70;padding:22px;">' +
        '<div style="max-width:322px;width:100%;max-height:100%;overflow:auto;background:#16283f;' +
          'border-radius:18px;padding:22px;box-sizing:border-box;' +
          'border:1.5px solid rgba(255,193,0,0.35);box-shadow:0 22px 60px rgba(0,0,0,0.6);">' +
          '<div style="font-size:15px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:18px;">Settings</div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.5;">Garden size</div>' +
          '<div data-el="sizes" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.5;">Briars</div>' +
          '<div data-el="briarset" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.5;">Sound</div>' +
          '<div data-el="muteset" style="display:flex;gap:8px;margin:9px 0 4px;"></div>' +
          '<button data-el="cogp-close" style="' + quietBtn + 'margin-top:20px;">Done</button>' +
        '</div>' +
      '</div>' +
      // --- how to play ---
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;align-items:center;' +
        'justify-content:center;background:rgba(12,10,7,0.88);z-index:70;padding:22px;">' +
        '<div style="max-width:322px;width:100%;max-height:100%;overflow:auto;background:#16283f;' +
          'border-radius:18px;padding:20px;box-sizing:border-box;' +
          'border:1.5px solid rgba(255,193,0,0.35);box-shadow:0 22px 60px rgba(0,0,0,0.6);">' +
          '<div style="font-size:15px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:12.5px;line-height:1.62;opacity:0.88;padding-left:17px;margin:0;">' +
            '<li>Phone flat on the table. Sit at the corner your colour starts in.</li>' +
            '<li>Press and drag anywhere in <b>your own corner of the screen</b> — a stick appears under your thumb.</li>' +
            '<li>Push the way you want to run. Everyone runs at the same time.</li>' +
            '<li>First peg to enter the glowing <b style="color:#ffc100">heart</b> wins the garden.</li>' +
            '<li>Every corner is exactly the same number of steps from the heart — the maze is built symmetric.</li>' +
            '<li>Amber pods give you a <b style="color:#91cd53">briar</b>. Lift your thumb and <b>tap your corner</b> to slam a hedge across the gap you just came through.</li>' +
            '<li>A briar lasts nine seconds and can never seal off the last route to the heart.</li>' +
            '<li>The number on your plate is how many steps you have left.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + quietBtn + 'margin-top:18px;">Got it</button>' +
        '</div>' +
      '</div>';

    const shell = {
      el: (n) => root.querySelector('[data-el="' + n + '"]'),
      tap: (node, fn) => {
        if (!node) return;
        ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
        ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
      },
    };

    /* --- position everything that depends on the measured layout --- */
    /**
     * Where each player's control zone is, and where their chrome sits inside
     * it. A band with only one player in it belongs entirely to that player:
     * in a two-player game the two seats face each other across the phone and
     * neither should have to remember that only half of their own end of the
     * table is live.
     */
    function layoutSeats() {
      const R = L.stickR;
      for (const p of players) {
        const s = p.seat;
        const alone = players.filter((q) => q.seat.band === s.band).length === 1;
        const y0 = s.band === "top" ? L.chromeB : L.outerBot;
        // The bottom band stops at the home bar, not part-way into it: the
        // two bands are then exact mirrors about the board's centre, which is
        // the one thing this game promises, and the bottom hint stops sitting
        // on the home indicator.
        const y1 = s.band === "top" ? L.outerTop : H - L.safeB;
        const x0 = alone ? 0 : (s.side === "left" ? 0 : W / 2);
        const x1 = alone ? W : (s.side === "left" ? W / 2 : W);
        p.zone = { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };

        const i = p.i;
        const hud = shell.el("hud-" + i);
        hud.style.left = Math.round(clamp(p.zone.cx - 82, 10, W - 174)) + "px";
        hud.style.top = (s.band === "top" ? L.outerTop - 40 : L.outerBot + 10) + "px";
        const sx = Math.round(p.zone.cx), sy = Math.round(p.zone.cy);
        const home = shell.el("home-" + i);
        home.style.transform = "translate(" + (sx - R * 0.75) + "px," + (sy - R * 0.75) + "px)";
        const hint = shell.el("hint-" + i);
        hint.style.left = (sx - 86) + "px";
        hint.style.top = (sy + (s.band === "top" ? -R * 1.35 - 10 : R * 1.35)) + "px";
      }
    }

    /** Static per-seat chrome: sizes and the knob's own colour. */
    function applyLayout() {
      const R = L.stickR;
      SEATS.forEach((s, i) => {
        shell.el("hud-" + i).style.top =
          (s.band === "top" ? L.outerTop - 40 : L.outerBot + 10) + "px";
        // Before anybody has touched the glass, the dashed home ring is the
        // only thing telling a player which patch of table is theirs, so it
        // wears the seat's colour rather than a neutral grey that vanishes
        // into the walnut.
        const home = shell.el("home-" + i);
        home.style.width = home.style.height = (R * 1.5) + "px";
        home.style.borderColor = hexStr(shade(s.hex, 0.42)) + "88";
        home.style.background = "radial-gradient(circle," + hexStr(s.hex) + "26,transparent 68%)";
        const hint = shell.el("hint-" + i);
        hint.style.width = "172px";
        hint.style.textAlign = "center";
        hint.style.color = hexStr(shade(s.hex, 0.5)) + "b0";
        const ring = shell.el("ring-" + i);
        ring.style.width = ring.style.height = (R * 2) + "px";
        const knob = shell.el("knob-" + i);
        knob.style.width = knob.style.height = (R * 0.82) + "px";
        knob.style.background = "radial-gradient(circle at 34% 30%," +
          hexStr(shade(s.hex, 0.45)) + "," + hexStr(s.hex) + " 62%," + hexStr(shade(s.hex, -0.4)) + ")";
        knob.style.boxShadow = "0 3px 10px rgba(0,0,0,0.5)";
      });
      const cnode = shell.el("count");
      cnode.style.top =
        Math.round(L.boardTop + L.boardPx / 2 - (COUNT_SIZE * 2 + COUNT_GAP) / 2) + "px";
      layoutSeats();
    }
    applyLayout();

    /* --- seed meshes need the scene, but their material wants the palette --- */
    (function buildSeedMeshes() {
      const geo = track(new THREE.IcosahedronGeometry(1, 0));
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({
          color: 0xf0a92c, emissive: 0xc26a06, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.15,
        })));
        m.castShadow = true;
        m.visible = false;
        scene.add(m);
        seedMeshes.push(m);
      }
    })();

    function paintHud() {
      // Settings and the rules would let somebody freeze the screen mid-race,
      // so during a race the only chrome is the mute toggle.
      const racing = phase === "play" || phase === "count";
      shell.el("cog").style.display = racing ? "none" : "block";
      shell.el("help").style.display = racing ? "none" : "block";
      SEATS.forEach((s, i) => {
        const hud = shell.el("hud-" + i);
        const p = players[i];
        const on = !!p && phase !== "menu";
        hud.style.display = on ? "flex" : "none";
        shell.el("hint-" + i).style.display = on && phase === "play" ? "block" : "none";
        shell.el("home-" + i).style.display = on && held[i] === null ? "block" : "none";
        if (!on) return;
        shell.el("sw-" + i).style.background = hexStr(s.hex);
        shell.el("nm-" + i).textContent = esc(s.name.toUpperCase());
        shell.el("nm-" + i).style.color = hexStr(shade(s.hex, 0.55));
        let pips = "";
        for (let k = 0; k < MAX_BRIARS; k++) pips += k < p.briars ? "●" : "○";
        shell.el("br-" + i).textContent = settings.briars ? pips : "";
        const c = committed(p);
        const d = p.done ? 0 : (dist ? dist[c.y * N + c.x] : 0);
        const st = shell.el("st-" + i);
        st.textContent = d < 0 ? "--" : String(d);
        st.style.color = d >= 0 && d <= 3 ? "#ffc100" : "#f3ede0";
      });
    }

    /* --- settings pills --- */
    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        // A three-up row on a 390px screen leaves ~87px a pill, and
        // "STANDARD" set at the two-up size fills every one of them edge to
        // edge, so the row steps down a size rather than going cramped.
        '<button data-v="' + v + '" style="pointer-events:auto;flex:1;padding:11px 2px;border:none;' +
        'border-radius:12px;font-family:inherit;font-weight:700;text-transform:uppercase;' +
        'font-size:' + (values.length > 2 ? "10px" : "11px") + ';' +
        'letter-spacing:' + (values.length > 2 ? "0.07em" : "0.12em") + ';">' +
        esc(labels[i]) + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "rgba(255,193,0,0.85)" : "rgba(243,237,224,0.09)";
          b.style.color = on ? "#1a1712" : "rgba(243,237,224,0.6)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        shell.tap(b, () => { set(Number(b.dataset.v)); saveSettings(); paint(); sound.haptic("light"); });
      }
      host.__paint = paint;
      paint();
    }
    pills(shell.el("sizes"), [9, 11, 13], ["Small", "Standard", "Grand"],
      () => settings.size, (v) => {
        settings.size = v;
        // The title card sits over a live garden, so a size change has to grow
        // a new one underneath the panel rather than waiting for the race.
        if (phase === "menu") growGarden();
      });
    pills(shell.el("briarset"), [1, 0], ["On", "Off"],
      () => settings.briars, (v) => { settings.briars = v; });
    pills(shell.el("muteset"), [0, 1], ["On", "Muted"],
      () => (settings.mute ? 1 : 0), (v) => { if ((v === 1) !== settings.mute) toggleMute(); });

    /* --- player-count chips --- */
    (function () {
      const host = shell.el("counts");
      host.innerHTML = [2, 3, 4].map((n) =>
        '<button data-n="' + n + '" style="pointer-events:auto;width:62px;height:62px;border:1.5px solid rgba(255,193,0,0.4);' +
        'border-radius:19px;font-family:inherit;font-size:23px;font-weight:700;">' + n + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = Number(b.dataset.n) === playerCount;
          b.style.background = on ? "rgba(255,193,0,0.9)" : "rgba(36,64,110,0.6)";
          b.style.color = on ? "#1a1712" : "rgba(243,237,224,0.72)";
          b.style.borderColor = on ? "#ffc100" : "rgba(255,193,0,0.28)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        shell.tap(b, () => {
          playerCount = Number(b.dataset.n);
          saveSettings();
          paint();
          // The title card sits over a live garden with the pegs already on
          // their corners, so a group can see who sits where before starting.
          makePlayers(playerCount);
          syncPegs();
          sound.haptic("light");
        });
      }
      paint();
      host.__paint = paint;
    })();

    function toggleMute() {
      const m = sound.toggle();
      shell.el("mute").style.textDecoration = m ? "line-through" : "none";
      shell.el("mute").style.opacity = m ? "0.45" : "1";
      const h = shell.el("muteset");
      if (h.__paint) h.__paint();
    }
    if (settings.mute) {
      shell.el("mute").style.textDecoration = "line-through";
      shell.el("mute").style.opacity = "0.45";
    }

    shell.tap(shell.el("mute"), toggleMute);
    shell.tap(shell.el("cog"), () => { shell.el("cogp").style.display = "flex"; });
    shell.tap(shell.el("cogp-close"), () => { shell.el("cogp").style.display = "none"; });
    shell.tap(shell.el("help"), () => { shell.el("helpp").style.display = "flex"; });
    shell.tap(shell.el("helpp-close"), () => { shell.el("helpp").style.display = "none"; });

    shell.tap(shell.el("go"), async () => {
      ctx.platform.start({ players: playerCount });
      await sound.unlock();
      shell.el("menu").style.display = "none";
      newRound(true);
    });
    shell.tap(shell.el("again"), () => {
      shell.el("over").style.display = "none";
      newRound(true);
      ctx.platform.interact({ type: "replay" });
    });
    shell.tap(shell.el("back"), () => {
      shell.el("over").style.display = "none";
      shell.el("menu").style.display = "flex";
      phase = "menu";
      for (const m of seedMeshes) m.visible = false;
      seeds.length = 0;
      for (const b of briarPool) { b.busy = false; b.mesh.visible = false; }
      briars.clear();
      // Back to the title over a live garden with the pegs on their corners,
      // exactly as the bit boots — not over an empty board.
      refreshDist();
      makePlayers(playerCount);
      syncPegs();
      paintHud();
    });

    /* ---------------------------------------------------------------
     * Input.
     *
     * A pointer belongs to the corner it landed in, for its whole life,
     * and a corner accepts exactly one live pointer. Deciding per-move
     * would let a hand that drifts across the middle start driving
     * somebody else's peg — the one bug that makes a shared-screen game
     * unplayable — and allowing two pointers per corner would let one
     * player quietly claim two sticks.
     * ------------------------------------------------------------- */
    const bound = new Map();                     // pointerId -> stick state
    const held = new Array(4).fill(null);        // seat index -> pointerId

    function seatAt(x, y) {
      // Zones are disjoint rectangles that never touch the board, so a
      // pointer's owner falls straight out of where it landed and nothing a
      // player does can ever put a finger over the maze.
      for (let i = 0; i < players.length; i++) {
        const z = players[i].zone;
        if (z && x >= z.x0 && x < z.x1 && y >= z.y0 && y < z.y1) return i;
      }
      return -1;
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      if (phase !== "play" && phase !== "count") return;
      const i = seatAt(e.offsetX, e.offsetY);
      if (i < 0 || held[i] !== null) return;
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
      held[i] = e.pointerId;
      bound.set(e.pointerId, { i, ax: e.offsetX, ay: e.offsetY, moved: 0 });
      showStick(i, e.offsetX, e.offsetY, 0, 0);
      e.preventDefault();
      sound.unlock();
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      const s = bound.get(e.pointerId);
      if (!s) return;
      const dx = e.offsetX - s.ax, dy = e.offsetY - s.ay;
      const d = Math.hypot(dx, dy);
      if (d > s.moved) s.moved = d;
      // The stick's anchor is dragged along once the thumb leaves its reach,
      // so a long push never runs out of travel mid-corridor.
      const R = L.stickR;
      if (d > R) {
        s.ax += dx * (1 - R / d);
        s.ay += dy * (1 - R / d);
      }
      const nx = clamp((e.offsetX - s.ax) / R, -1, 1);
      const ny = clamp((e.offsetY - s.ay) / R, -1, 1);
      aim(s.i, nx, ny);
      showStick(s.i, s.ax, s.ay, nx, ny);
      e.preventDefault();
    }, { passive: false });

    const release = (e) => {
      const s = bound.get(e.pointerId);
      if (!s) return;
      bound.delete(e.pointerId);
      held[s.i] = null;
      hideStick(s.i);
      const p = players[s.i];
      if (p) { p.want = null; p.want2 = null; }
      // A press is a briar if the thumb never pushed. Not "if it was quick":
      // duration is the wrong test, because on a device dropping frames the
      // down and the up arrive in the same busy task long after the finger
      // moved, and a real tap gets misread as a long press. Travel is exact
      // and frame-rate-independent — and a press that stays inside the dead
      // zone could never have been a steer, since the peg never moved for it.
      if (p && s.moved < L.stickR * 0.30 && phase === "play") requestPlant(p);
    };
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    function aim(i, nx, ny) {
      const p = players[i];
      if (!p) return;
      const mag = Math.hypot(nx, ny);
      if (mag < 0.22) { p.want = null; p.want2 = null; return; }
      // The stick is absolute for every seat. The phone is flat, so pushing a
      // thumb in a physical direction moves the peg that same physical way
      // whichever edge of the table you are sitting at; mirroring the far
      // seats would be the bug, not the fix.
      if (Math.abs(nx) >= Math.abs(ny)) {
        p.want = { x: nx > 0 ? 1 : -1, y: 0 };
        p.want2 = Math.abs(ny) > 0.34 ? { x: 0, y: ny > 0 ? 1 : -1 } : null;
      } else {
        p.want = { x: 0, y: ny > 0 ? 1 : -1 };
        p.want2 = Math.abs(nx) > 0.34 ? { x: nx > 0 ? 1 : -1, y: 0 } : null;
      }
    }

    function showStick(i, ax, ay, nx, ny) {
      const R = L.stickR;
      const ring = shell.el("ring-" + i), knob = shell.el("knob-" + i);
      ring.style.display = "block";
      ring.style.transform = "translate(" + (ax - R) + "px," + (ay - R) + "px)";
      ring.style.borderColor = hexStr(shade(players[i].hex, 0.25)) + "66";
      knob.style.display = "block";
      knob.style.transform = "translate(" + (ax + nx * R * 0.62 - R * 0.41) + "px," +
        (ay + ny * R * 0.62 - R * 0.41) + "px)";
      shell.el("home-" + i).style.display = "none";
    }
    function hideStick(i) {
      shell.el("ring-" + i).style.display = "none";
      shell.el("knob-" + i).style.display = "none";
      if (players[i]) shell.el("home-" + i).style.display = "block";
    }

    /* ---------------------------------------------------------------
     * Win
     * ------------------------------------------------------------- */
    async function win(p) {
      p.done = true;
      winner = p;
      phase = "over";
      // Measured in game time, accumulated from the same clamped dt the race
      // itself runs on, so a stuttering device cannot inflate the record.
      elapsed = Math.round(elapsed);
      for (const q of players) { q.want = null; q.want2 = null; }
      sparks.burst(cellX(p.cx), cellZ(p.cy), shade(p.hex, 0.3), 30, cell * 3.4, cell * 0.06);
      sparks.burst(cellX(p.cx), cellZ(p.cy), C.gold, 24, cell * 2.6, cell * 0.05);
      sound.duck(0.6, 500);
      sound.sting("win");
      sound.haptic("heavy");
      sound.heat(0.9);
      const secs = (elapsed / 1000).toFixed(1);
      const strip = statCell(secs + "s", "Time", false) +
        statCell(N + "×" + N, "Garden", true) +
        statCell(String(startDist), "Steps", true);
      for (const sfx of ["", "r"]) {
        const nm = shell.el("over-name" + sfx);
        nm.textContent = p.seat.name;
        nm.style.color = hexStr(shade(p.hex, 0.35));
        shell.el("over-stats" + sfx).innerHTML = strip;
      }
      // The panel waits. A win is the one moment the table is all looking at
      // the same cell, and dropping a card over it in the same frame throws
      // away the sparks, the frame taking the winner's colour, and the peg
      // actually arriving.
      ctx.timeout(() => { if (phase === "over") shell.el("over").style.display = "flex"; }, 950);
      paintHud();
      ctx.platform.milestone("solved", { seat: p.seat.id, ms: elapsed });
      ctx.platform.complete({ winner: p.seat.id, ms: elapsed, players: players.length, size: N });
      // The record belongs to the match, not to one of the people sharing the
      // phone: how fast this table cracked this garden.
      try { await ctx.memory.record("fastest_solve").submit(elapsed); } catch (_) {}
    }

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    function syncPegs() {
      for (let i = 0; i < pegGroups.length; i++) {
        const g = pegGroups[i], p = players[i];
        g.visible = !!p;
        if (!p) continue;
        g.position.set(cellX(p.px), 0, cellZ(p.py));
      }
    }

    let flood = 0, lastProg = -1, countPop = 0;
    ctx.onFrame((dtMs) => {
      // A generous stall cap. Lane movement is resolved cell by cell inside
      // stepPlayer, so a long frame can never tunnel a peg through a hedge or
      // skip the junction it was asked to turn at — it just covers more
      // ground, which is what a player who dropped a frame actually wants.
      const dt = Math.min(dtMs, 110) / 1000;
      const now = performance.now();

      if (phase === "count") {
        countdown -= dt;
        const node = shell.el("count");
        node.style.display = "block";
        const n = Math.ceil(countdown);
        const nn = shell.el("count-n");
        const label = countdown <= 0.35 ? "RUN" : String(Math.max(1, n));
        if (nn.textContent !== label) {
          nn.textContent = label;
          countPop = 1;
          sound.sting(label === "RUN" ? "coin" : "tap");
          sound.haptic(label === "RUN" ? "success" : "light");
        }
        // Each numeral lands large and settles, rather than being stamped at
        // one size — the beat is the only thing happening on screen.
        countPop = Math.max(0, countPop - dt * 3.6);
        const nr = shell.el("count-r");
        if (nr.textContent !== label) nr.textContent = label;
        const pop = 1 + countPop * countPop * 0.55;
        const fade = String(0.55 + (1 - countPop) * 0.45);
        nn.style.transform = "scale(" + pop + ")";
        nr.style.transform = "rotate(180deg) scale(" + pop + ")";
        nn.style.opacity = nr.style.opacity = fade;
        if (countdown <= -0.45) {
          node.style.display = "none";
          phase = "play";
          paintHud();
        }
      }

      if (phase === "play") {
        elapsed += dt * 1000;
        expireBriars(now);
        for (const p of players) {
          if (p.pending > 0) p.pending = Math.max(0, p.pending - dt);
          stepPlayer(p, dt);
        }
        seedTimer -= dt;
        if (seedTimer <= 0 && settings.briars) { spawnSeedOrbit(); seedTimer = 7; }
        // Tension tracks whoever is closest to the heart.
        let best = 9999;
        for (const p of players) {
          const c = committed(p);
          const d = dist[c.y * N + c.x];
          if (d >= 0 && d < best) best = d;
        }
        if (best < 9999) {
          sound.heat(clamp(1 - best / Math.max(4, startDist), 0.15, 1));
          if (best !== lastProg) {
            lastProg = best;
            ctx.platform.setProgress(clamp(1 - best / Math.max(1, startDist), 0, 1));
          }
          if (best <= 3 && !dangerFired) { dangerFired = true; sound.sting("danger"); }
          if (best > 4) dangerFired = false;
        }
      }

      /* --- pegs: position, a small hop as each cell is cleared, and a shove
       * when an action is refused --- */
      for (let i = 0; i < players.length; i++) {
        const p = players[i], g = pegGroups[i];
        g.position.x = cellX(p.px);
        g.position.z = cellZ(p.py);
        if (p.hop > 0) {
          p.hop = Math.max(0, p.hop - dt * 5.2);
          const k = Math.sin((1 - p.hop) * Math.PI);
          g.position.y = k * cell * 0.10;
          g.scale.setScalar(1 + k * 0.07);
        } else if (g.position.y !== 0) { g.position.y = 0; g.scale.setScalar(1); }
        if (p.bump > 0) {
          p.bump = Math.max(0, p.bump - dt * 6);
          g.position.x += Math.sin(p.bump * 62) * cell * 0.08 * p.bump;
        }
        g.userData.ring.material.emissiveIntensity =
          0.55 + (p === winner ? 1.8 : 0) + (p.briars > 0 && settings.briars ? Math.sin(now * 0.006 + i) * 0.22 + 0.28 : 0);
      }

      /* --- briars grow with a heavy overshoot, because a hedge is not a UI
       * element, then wither in their last half second --- */
      for (const [, b] of briars) {
        if (!b.slot) continue;
        const left = b.until - now;
        b.grow = Math.min(1, (b.grow || 0) + dt * 3.2);
        const overshoot = 1 + Math.sin(b.grow * Math.PI) * 0.16;
        const fade = left < 700 ? Math.max(0.06, left / 700) : 1;
        b.slot.mesh.scale.y = wallH * 0.95 * b.grow * overshoot * fade;
        b.slot.mesh.position.y = b.slot.mesh.scale.y / 2;
        b.slot.mat.emissiveIntensity = left < 1600 ? 0.16 + Math.abs(Math.sin(now * 0.011)) * 0.85 : 0.22;
      }

      /* --- seeds bob and turn --- */
      for (const s of seeds) {
        s.mesh.rotation.y += dt * 1.9;
        s.mesh.rotation.x += dt * 0.8;
        s.mesh.position.y = cell * (0.28 + Math.sin(now * 0.004 + s.x + s.y) * 0.05);
      }

      /* --- the heart breathes all game so it is unmistakable from any side --- */
      if (heartRing) {
        const pulse = 0.5 + Math.sin(now * 0.0038) * 0.5;
        heartRing.material.emissiveIntensity = 1.1 + pulse * 2.0;
        heartRing.scale.setScalar(1 + pulse * 0.035);
        heartBeam.material.opacity = 0.03 + pulse * 0.05;
        heartBeam.rotation.y += dt * 0.25;
        heartLight.intensity = 0.030 + pulse * 0.035;
        if (winner) {
          heartRing.material.emissive.setHex(shade(winner.hex, 0.3));
          heartLight.color.setHex(shade(winner.hex, 0.2));
        } else {
          heartRing.material.emissive.setHex(C.gold);
          heartLight.color.setHex(C.gold);
        }
      }

      /* --- the frame takes the winner's colour as the garden is claimed --- */
      const wantFlood = winner ? 1 : 0;
      if (flood !== wantFlood) {
        flood += (wantFlood - flood) * Math.min(1, dt * 3.4);
        if (Math.abs(flood - wantFlood) < 0.01) flood = wantFlood;
        const base = new THREE.Color(C.frame);
        if (winner) base.lerp(new THREE.Color(shade(winner.hex, -0.15)), flood);
        frameMat.color.copy(base);
      }
      for (let i = 0; i < seatPosts.length; i++) {
        const p = players[i];
        const hex = p ? p.hex : C.gold;
        seatPosts[i].material.color.setHex(hex);
        seatPosts[i].material.emissive.setHex(hex);
        seatPosts[i].material.emissiveIntensity = p ? (p === winner ? 1.6 : 0.35) : 0.12;
      }

      sparks.step(dt);
      renderer.render(scene, camera);
    });

    /* --- resize: the board is measured from the container, so a rotation or
     * a keyboard opening has to remeasure rather than stretch --- */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      renderer.setSize(ctx.width, ctx.height, false);
      camera.aspect = ctx.width / ctx.height;
      camera.position.y = L.dist;
      camera.updateProjectionMatrix();
      buildBoard();
      applyLayout();
      shell.el("chrome").style.top = (L.safeT + 5) + "px";
      syncPegs();
    });

    /* ---------------------------------------------------------------
     * First paint. A maze is generated and drawn before ready() so the
     * host never shows a blank bit, and the title card sits over a live
     * garden rather than a flat colour.
     * ------------------------------------------------------------- */
    growGarden();
    paintHud();

    // A read-only window onto the race so the local harness can drive four
    // real thumbs and assert on where the pegs actually went. It exposes
    // nothing the bit does not already draw on screen.
    window.__MAZE__ = {
      get phase() { return phase; },
      get n() { return N; },
      get cell() { return cell; },
      get winner() { return winner ? winner.seat.id : null; },
      get elapsed() { return Math.round(elapsed); },
      get startDist() { return startDist; },
      get briars() { return briars.size; },
      /** Why each seat's last tap did or did not become a hedge. */
      get plantLog() { return plantLog.slice(); },
      get seeds() { return seeds.length; },
      /** All four corner distances to the heart — equal by construction. */
      cornerDists() {
        const d = computeDist();
        return [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]].map(([x, y]) => d[y * N + x]);
      },
      players() {
        return players.map((p) => {
          const c = committed(p);
          return {
            seat: p.seat.id, cx: c.x, cy: c.y, t: +p.t.toFixed(3),
            dist: dist ? dist[c.y * N + c.x] : -1, briars: p.briars, done: p.done,
          };
        });
      },
      /** The next step along a shortest path — used only to drive tests. */
      hint(i) {
        const p = players[i];
        if (!p || !dist) return null;
        const c = committed(p);
        const here = dist[c.y * N + c.x];
        for (const dd of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!passable(c.x, c.y, dd[0], dd[1])) continue;
          const nx = c.x + dd[0], ny = c.y + dd[1];
          if (dist[ny * N + nx] >= 0 && dist[ny * N + nx] < here) return { x: dd[0], y: dd[1] };
        }
        return null;
      },
      zone(i) {
        const p = players[i];
        if (!p || !p.zone) return null;
        return { x: Math.round(p.zone.cx), y: Math.round(p.zone.cy), r: L.stickR };
      },
    };
    ctx.onDestroy(() => { try { delete window.__MAZE__; } catch (_) {} });

    renderer.render(scene, camera);
    ctx.markVisualReady("garden drawn");
    ctx.platform.ready();
  },
};
