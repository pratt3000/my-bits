/**
 * Blast Yard — a two-to-four player bomb brawl on one phone, in 3D.
 *
 * The phone lies flat on a table with a person at each edge. Everybody plays
 * at once: there are no turns, and four thumbs are on the glass at the same
 * instant. That is the whole design problem, and it is solved in one move.
 *
 * EVERY CONTROL LIVES OUTSIDE THE PLAY SURFACE. Each player owns a clay
 * control pad bolted to their own edge of the screen — an analog stick on the
 * left of the pad, one bomb button on the right — and the arena is fitted into
 * whatever rectangle is left in the middle. Four floating joysticks laid over
 * a shared playfield would collide with each other, occlude the figures they
 * are steering, and hand whoever touched first the ambiguity; fixed edge pads
 * cannot overlap by construction, so a finger is bound to its owner before it
 * has moved a pixel. Pads are DOM elements rotated to their seat, so
 * `offsetX`/`offsetY` arrive already in that player's own frame and their
 * "push away from me" is the same gesture whichever edge they sit at.
 *
 * The camera is tilted 14 degrees rather than pointing straight down. In a
 * head-to-head game across the table any tilt is unfair, but this is a
 * free-for-all: nobody owns a half of the arena, spawns are symmetric about
 * the centre, and at the distances used here the far rim renders about 6%
 * smaller than the near rim — small enough that it never decides a fall, and
 * enough to make the platform read as a slab of wood floating in the dark
 * rather than a circle painted on it.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so the wood,
 * the scorch blots and the void are painted into OffscreenCanvases at boot,
 * with a flat-colour fallback for WebViews that lack them. The overlay is one
 * markup string on ctx.createRoot(), and pointer maths uses offsetX/offsetY.
 * Reaching into the host DOM to build elements, and reading back a layout
 * rectangle, are both rejected at upload and neither is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Blast Yard",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "party", "arena", "brawler"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
    const THREE = await ctx.importModule("three", "0.164.1");

    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ===============================================================
     * PALETTE
     *
     * Warm pine lit from above over a near-black void, and four clay
     * figures whose identity is carried twice over: a hue, and a helmet
     * crest silhouette. Hue alone fails for a colour-blind player and
     * fails again when two figures are mid-tumble in the same corner.
     * ============================================================= */
    const WOOD_TOP = 0xC8913C, WOOD_SIDE = 0x8A5C26, WOOD_LIT = 0xE0B978;
    const VOID_INK = "#0E0B07";
    const OFFWHITE = "#EAF3E6";
    const HOT = "#FFF074";

    /* One warm family for every pixel of chrome. The yard is pine lit from
     * above, floating in warm soot; a control pad or a panel in a cool grey
     * reads as a different application sitting on top of the game rather
     * than part of it. So the pads are fired clay, the panels are the same
     * clay slabbed thicker, and every call to action is an ember. */
    const CLAY = "#3E2D1F";
    const CLAY_FACE = "linear-gradient(180deg,#5C4433 0%," + CLAY + " 46%,#241910 100%)";
    const PANEL_FACE = "linear-gradient(180deg,#4E3926 0%,#3A2A1B 44%,#241810 100%)";
    const WELL_FACE = "radial-gradient(circle at 38% 30%,#2A1D13,#120C07)";
    const TRACK = "#2C1E13";                     // unfilled part of a gauge
    const EMBER_BTN = "linear-gradient(180deg,#FFC24A,#D26A16)";
    const EMBER_INK = "#2A1305";
    const RIM = "rgba(255,205,130,0.26)";        // hairline on dark chrome

    const PL = [
      { name: "Ember",  crest: "fin",     body: 0xFF5230, helm: 0xFFC24A, dark: 0xB32410, ink: "#FF7047", lit: "#FFB392" },
      { name: "Mint",   crest: "horns",   body: 0x3FDE7C, helm: 0xD3F7B6, dark: 0x137A3E, ink: "#54E88C", lit: "#B8F8D0" },
      { name: "Cobalt", crest: "antenna", body: 0x4A8CFF, helm: 0xAFD5FF, dark: 0x1A47A8, ink: "#68A2FF", lit: "#BDDBFF" },
      { name: "Amber",  crest: "crown",   body: 0xFFC93A, helm: 0xFFF3B4, dark: 0xA97400, ink: "#FFD65E", lit: "#FFF0B6" },
    ];

    /* Seats, in the order they are filled. Each carries the CSS rotation
     * that turns its pad right-way-up for whoever sits there, and the map
     * that turns a stick push in that player's own frame into a world
     * direction. Getting this wrong is the classic shared-screen bug:
     * "away from me" has to mean away from *them*, at every edge. */
    const SEATS = [
      { id: "bottom", rot: 0,   toWorld: (dx, dy) => ({ x:  dx, z:  dy }), out: { x: 0, z: 1 } },
      { id: "top",    rot: 180, toWorld: (dx, dy) => ({ x: -dx, z: -dy }), out: { x: 0, z: -1 } },
      { id: "left",   rot: 90,  toWorld: (dx, dy) => ({ x: -dy, z:  dx }), out: { x: -1, z: 0 } },
      { id: "right",  rot: 270, toWorld: (dx, dy) => ({ x:  dy, z: -dx }), out: { x: 1, z: 0 } },
    ];

    /* ===============================================================
     * SETTINGS
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("blastyard") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      target: saved.target || 3,        // round wins needed to take the match
      pace: saved.pace === undefined ? 1 : saved.pace,
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("blastyard", settings); } catch (_) {} }

    // Pace controls when the rim starts falling away and how fast it goes.
    const PACE = [
      { label: "Chill",   start: 30, step: 1.15 },
      { label: "Normal",  start: 21, step: 0.85 },
      { label: "Frantic", start: 12, step: 0.55 },
    ];

    /* ===============================================================
     * SOUND — wrapped so a missing audio stack can never break play.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "arcade", volume: 0.30, tempo: 128, intensity: 0.32 });
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
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 200 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ===============================================================
     * TUNING — the physical constants of the yard, in world units where
     * the arena is 2.0 wide.
     * ============================================================= */
    const CHAR_R   = 0.118;   // figure radius on the floor
    const MOVE_ACC = 10.5;
    let   MAX_SPD  = 1.25;    // scaled to the arena's length at build time
    const FUSE     = 3.0;     // seconds, exactly as the original
    const RELOAD   = 1.05;    // before the next bomb is in hand
    const BLAST    = 0.54;    // blast radius
    const KB       = 2.45;    // knockback speed at the very centre of a blast
    const GRAV     = 5.4;
    const THROW_V  = 1.45;
    const THROW_UP = 1.42;
    const SECT     = 18;      // rim sectors, each of which can crumble away
    const DPHI     = TAU / SECT;
    const RINGS    = [[0.845, 1.0], [0.685, 0.845]];
    const SLAB     = 0.34;    // plank thickness
    const BEV      = 0.009;

    let ARENA_A = 1.0;        // half-width  (screen x)
    let ARENA_B = 1.6;        // half-depth  (screen z) — grows with player count

    /* ===============================================================
     * LAYOUT
     *
     * Chrome and controls live in bands at the screen edges; the arena is
     * fitted into the rectangle that is left. Nothing ever sits on top of
     * the play surface, so no control can occlude a figure and no tap can
     * be ambiguous about who it belongs to.
     * ============================================================= */
    let W = ctx.width, H = ctx.height;
    const L = { pads: [], arena: { x: 0, y: 0, w: 10, h: 10 } };
    let nPlayers = 4;

    function computeLayout() {
      W = ctx.width; H = ctx.height;
      const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
      const PH = Math.round(clamp(H * 0.175, 112, 150));      // top/bottom pad height
      const SW = 70;                                          // left/right pad width
      const SH = Math.round(clamp(H * 0.38, 234, 322));       // left/right pad length

      const bcy = H - SB - PH / 2 - 6;
      const tcy = ST + PH / 2 + 6;
      const aTop = ST + PH + 18;
      const aBot = H - SB - PH - 18;
      const acy = (aTop + aBot) / 2;

      L.pads = [
        { w: W - 14, h: PH, cx: W / 2, cy: bcy, rot: 0 },
        { w: W - 14, h: PH, cx: W / 2, cy: tcy, rot: 180 },
        { w: SH, h: SW, cx: SW / 2 + 2, cy: acy, rot: 90 },
        { w: SH, h: SW, cx: W - SW / 2 - 2, cy: acy, rot: 270 },
      ];
      const leftUsed = nPlayers >= 3, rightUsed = nPlayers >= 4;
      L.arena = {
        x: leftUsed ? SW + 8 : 8,
        y: aTop,
        w: W - (leftUsed ? SW + 8 : 8) - (rightUsed ? SW + 8 : 8),
        h: aBot - aTop,
      };
      // More players, bigger yard: the free rectangle gets narrower as pads
      // are added, so the platform grows the other way instead of shrinking.
      // Tuned so the platform's projection fills the free rectangle in each
      // layout rather than leaving a band of dead screen at top and bottom.
      ARENA_B = [1.15, 1.15, 1.15, 1.40, 1.80][nPlayers] || 1.4;
      MAX_SPD = 0.92 + ARENA_B * 0.19;
    }
    computeLayout();

    /** A point inside a pad's own (rotated) frame, in screen pixels. */
    function padToScreen(i, lx, ly) {
      const b = L.pads[i];
      const px = lx - b.w / 2, py = ly - b.h / 2;
      const th = b.rot * Math.PI / 180;
      const c = Math.cos(th), s = Math.sin(th);
      return { x: b.cx + px * c - py * s, y: b.cy + px * s + py * c };
    }
    /* Pad-local geometry, derived from the pad's short side so the same
     * layout works for a 378x126 end pad and a 330x80 side pad. */
    const padGeo = (i) => {
      const b = L.pads[i];
      return {
        stickCX: b.h * 0.51, stickCY: b.h * 0.50,
        wellR: b.h * 0.42, knobR: b.h * 0.175,
        // Two radii, deliberately different: the finger has to travel `inputR`
        // for full tilt, but the knob only slides `travelR`, so it always
        // stays inside its well however hard the stick is pushed.
        inputR: b.h * 0.42, travelR: b.h * 0.225,
        bombCX: b.w - b.h * 0.53, bombCY: b.h * 0.50,
        bombR: b.h * 0.315, ringR: b.h * 0.405,
        // The gauge is masked into a band outside the sphere. Drawn as a
        // plain conic pie it grew to very nearly the height of the pad and
        // crowded the pad's own rim, which is the opposite of what a
        // three-second countdown should be doing to your eye.
        gaugeMask: "radial-gradient(closest-side,transparent 0 78%,#000 80%)",
        zoneX: b.w * 0.46, zoneR: b.h * 0.52,
      };
    };

    /* ===============================================================
     * OFFSCREEN SURFACES
     * ============================================================= */
    function surf(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      return new OffscreenCanvas(w, h);
    }
    // Deterministic noise so the plank grain is the same every boot.
    let seed = 1337;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    /** Pine planks: grain, knots, seams, bright end-grain highlights. */
    function woodTexture() {
      const S = 512, c = surf(S, S);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#C8913C";
      g.fillRect(0, 0, S, S);

      // Broad tonal drift so no two square inches of the floor match.
      for (let i = 0; i < 26; i++) {
        const x = rnd() * S, y = rnd() * S, r = 60 + rnd() * 150;
        const rad = g.createRadialGradient(x, y, 0, x, y, r);
        const up = rnd() < 0.5;
        rad.addColorStop(0, up ? "rgba(224,185,120,0.20)" : "rgba(120,76,32,0.16)");
        rad.addColorStop(1, "rgba(200,145,60,0)");
        g.fillStyle = rad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }

      // Grain: long low-amplitude sines running down the plank.
      for (let i = 0; i < 110; i++) {
        const x0 = rnd() * S, amp = 2 + rnd() * 9, ph = rnd() * TAU;
        g.strokeStyle = rnd() < 0.35
          ? "rgba(230,196,140,0.16)" : "rgba(92,58,26,0.13)";
        g.lineWidth = 0.8 + rnd() * 2.4;
        g.beginPath();
        for (let y = -8; y <= S + 8; y += 12) {
          const x = x0 + Math.sin(y * 0.011 + ph) * amp;
          if (y < 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }

      // Knots.
      for (let i = 0; i < 7; i++) {
        const x = rnd() * S, y = rnd() * S, r = 5 + rnd() * 8;
        for (let k = 5; k >= 1; k--) {
          g.strokeStyle = "rgba(74,46,20," + (0.10 + k * 0.045) + ")";
          g.lineWidth = 1.4;
          g.beginPath();
          g.ellipse(x, y, r * k * 0.42, r * k * 0.30, rnd() * 0.6, 0, TAU);
          g.stroke();
        }
      }

      // Plank seams, with a lit upper lip so the boards read as separate.
      for (let k = 0; k < 5; k++) {
        const x = Math.round(S * (k / 5)) + 0.5;
        g.strokeStyle = "rgba(52,32,14,0.62)"; g.lineWidth = 4;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke();
        g.strokeStyle = "rgba(255,228,186,0.22)"; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x + 3.2, 0); g.lineTo(x + 3.2, S); g.stroke();
        g.strokeStyle = "rgba(30,18,8,0.30)"; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x - 2.4, 0); g.lineTo(x - 2.4, S); g.stroke();
      }
      return c;
    }

    /** A permanent scorch blot, stamped on the floor by every blast. */
    function scorchTexture() {
      const S = 128, c = surf(S, S);
      if (!c) return null;
      const g = c.getContext("2d");
      const rad = g.createRadialGradient(64, 64, 3, 64, 64, 62);
      rad.addColorStop(0.00, "rgba(16,10,5,0.95)");
      rad.addColorStop(0.45, "rgba(28,17,8,0.62)");
      rad.addColorStop(0.78, "rgba(40,26,12,0.22)");
      rad.addColorStop(1.00, "rgba(40,26,12,0)");
      g.fillStyle = rad;
      g.fillRect(0, 0, S, S);
      // Ragged licks, so the blot is never a clean circle.
      for (let i = 0; i < 7; i++) {
        const a = rnd() * TAU, r0 = 26 + rnd() * 22;
        g.strokeStyle = "rgba(18,11,6,0.42)";
        g.lineWidth = 2 + rnd() * 5;
        g.beginPath();
        g.arc(64, 64, r0, a, a + 0.5 + rnd() * 1.0);
        g.stroke();
      }
      return c;
    }

    /* ===============================================================
     * SCENE
     * ============================================================= */
    const canvas = ctx.createCanvas({ touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.dpr, 2));
    renderer.setSize(W, H, false);
    /* No shadow map.
     *
     * Four figures, thirty-seven platform blocks, bombs and rubble is far
     * more casters than a phone will render twice per frame, and the whole
     * scene is fill-rate bound before the depth pass is even counted. Every
     * shadow here is a painted one instead — a soft blot under each object
     * and one under the platform itself, offset toward the key light —
     * which is what a stop-motion diorama does anyway. */
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    ctx.onDestroy(() => renderer.dispose());

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VOID_INK);
    scene.fog = new THREE.Fog(0x0E0B07, 8, 20);

    const TILT = 18 * Math.PI / 180;
    const camera = new THREE.PerspectiveCamera(24, W / H, 0.4, 90);
    let camDist = 10;
    const shakeV = { x: 0, y: 0 };
    let shake = 0;

    function placeCamera() {
      camera.position.set(
        shakeV.x,
        camDist * Math.cos(TILT) + shakeV.y,
        camDist * Math.sin(TILT)
      );
      camera.lookAt(0, 0.10, 0);
    }

    /* Fit the platform into the free rectangle.
     *
     * The renderer always fills the screen, so the arena is placed by
     * projecting its own rim, measuring the pixel box that comes back, and
     * then (a) walking the camera distance until that box fits the free
     * rectangle and (b) shifting the frustum with setViewOffset so the box
     * lands centred on it. That is one routine for every player count —
     * two, three and four all describe a different rectangle and nothing
     * else in the scene has to know. */
    const fitPts = [];
    function buildFitPoints() {
      fitPts.length = 0;
      for (let k = 0; k < 28; k++) {
        const phi = (k / 28) * TAU;
        fitPts.push(new THREE.Vector3(ARENA_A * Math.cos(phi), 0, ARENA_B * Math.sin(phi)));
        // Heads reach up out of the floor plane; include them or the far
        // rank of figures clips into the pad above them.
        fitPts.push(new THREE.Vector3(ARENA_A * 0.92 * Math.cos(phi), 0.34, ARENA_B * 0.92 * Math.sin(phi)));
      }
    }

    function projectBox() {
      camera.updateMatrixWorld();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const v = new THREE.Vector3();
      for (const p of fitPts) {
        v.copy(p).project(camera);
        const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      return { x0, y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }

    function fitCamera() {
      buildFitPoints();
      camera.aspect = W / H;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      camDist = Math.max(4, ARENA_B * 7);
      for (let i = 0; i < 8; i++) {
        placeCamera();
        const b = projectBox();
        const s = Math.min(L.arena.w * 0.975 / b.w, L.arena.h * 0.975 / b.h);
        camDist = camDist / s;
      }
      placeCamera();
      const b = projectBox();
      camera.setViewOffset(W, H,
        b.cx - (L.arena.x + L.arena.w / 2),
        b.cy - (L.arena.y + L.arena.h / 2), W, H);
      camera.updateProjectionMatrix();
      scene.fog.near = camDist * 0.86;
      scene.fog.far = camDist * 2.1;
      key.position.set(-ARENA_A * 2.2, camDist * 0.55, -ARENA_B * 0.55);
    }

    /* --- lights ---
     * One warm key from the upper left, exactly the way a lamp over a
     * tabletop diorama sits, and a cool bounce so the shadowed sides never
     * go to black. The shadows themselves are painted, not cast. */
    scene.add(new THREE.AmbientLight(0x4a3d2c, 0.40));
    scene.add(new THREE.HemisphereLight(0xffd9a0, 0x140f08, 0.42));
    const key = new THREE.DirectionalLight(0xFFE7BC, 1.62);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88a6ff, 0.35);
    rim.position.set(2.4, 1.4, 2.6);
    scene.add(rim);

    /* --- wood materials --- */
    const woodCanvas = woodTexture();
    let woodTex = null;
    if (woodCanvas) {
      woodTex = new THREE.CanvasTexture(woodCanvas);
      woodTex.colorSpace = THREE.SRGBColorSpace;
      woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
      woodTex.repeat.set(0.55, 0.55);
      woodTex.anisotropy = 4;
      ctx.onDestroy(() => woodTex.dispose());
    }
    const matTop = new THREE.MeshLambertMaterial({ color: woodTex ? 0xffffff : WOOD_TOP, map: woodTex });
    const matSide = new THREE.MeshLambertMaterial({ color: 0x74491B });
    // The rim course is the same board, cut fresher: same grain, warmer light.
    // A flat pale ring here reads as a picture frame around the play area.
    const matLip = new THREE.MeshLambertMaterial({ color: woodTex ? 0xFFD9A6 : WOOD_LIT, map: woodTex });

    /* ===============================================================
     * THE PLATFORM
     *
     * A solid elliptical core ringed by two courses of wedge blocks. Each
     * wedge is a real extruded slab with a bevelled edge, so the rim casts
     * and receives shadow and the arena reads as a thing you could pick
     * up. When a wedge crumbles away it takes its sector's boundary with
     * it, which is what makes the yard get ragged and mean over a round
     * instead of merely smaller.
     * ============================================================= */
    const arenaGroup = new THREE.Group();
    scene.add(arenaGroup);
    const sectorFrac = new Float32Array(SECT);
    const wedges = [];
    let coreMesh = null;

    const ellipsePt = (phi, f) => ({ x: ARENA_A * f * Math.cos(phi), z: ARENA_B * f * Math.sin(phi) });

    const GAP = 0.006;                       // world units of daylight per seam
    function wedgeShape(i, f0, f1) {
      const dp = GAP / (ARENA_A * (f0 + f1) * 0.5);
      const phi0 = i * DPHI + dp, phi1 = (i + 1) * DPHI - dp;
      f0 += GAP / ARENA_A; f1 -= GAP / ARENA_A;
      const sh = new THREE.Shape();
      const N = 5;
      let cx = 0, cz = 0, n = 0;
      const add = (p, first) => {
        if (first) sh.moveTo(p.x, p.z); else sh.lineTo(p.x, p.z);
        cx += p.x; cz += p.z; n++;
      };
      for (let k = 0; k <= N; k++) add(ellipsePt(lerp(phi0, phi1, k / N), f1), k === 0);
      for (let k = N; k >= 0; k--) add(ellipsePt(lerp(phi0, phi1, k / N), f0), false);
      sh.closePath();
      return { sh, cx: cx / n, cz: cz / n };
    }

    function slabMesh(shape, depth, cx, cz, mats) {
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV,
        bevelSegments: 1, curveSegments: 2,
      });
      geo.translate(-cx, -cz, 0);
      const m = new THREE.Mesh(geo, mats);
      m.rotation.x = Math.PI / 2;      // shape (x,y) -> world (x,z), extruded downwards
      const g = new THREE.Group();
      g.position.set(cx, -BEV, cz);    // lift so the true top face sits at y = 0
      g.add(m);
      return g;
    }

    function buildArena() {
      for (const w of wedges) { arenaGroup.remove(w.group); w.group.traverse(o => o.geometry && o.geometry.dispose()); }
      wedges.length = 0;
      if (coreMesh) { arenaGroup.remove(coreMesh); coreMesh.traverse(o => o.geometry && o.geometry.dispose()); }
      sectorFrac.fill(1);

      // Core: one solid ellipse, thicker than the rim so the platform has a
      // visible spine when the outer courses have fallen away.
      const core = new THREE.Shape();
      let ccx = 0, ccz = 0;
      for (let k = 0; k <= 48; k++) {
        const p = ellipsePt((k / 48) * TAU, RINGS[1][0] - GAP / ARENA_A);
        if (k === 0) core.moveTo(p.x, p.z); else core.lineTo(p.x, p.z);
        ccx += p.x; ccz += p.z;
      }
      core.closePath();
      coreMesh = slabMesh(core, SLAB * 1.40, 0, 0, [matTop, matSide]);
      arenaGroup.add(coreMesh);

      for (let r = 0; r < RINGS.length; r++) {
        for (let i = 0; i < SECT; i++) {
          const { sh, cx, cz } = wedgeShape(i, RINGS[r][0], RINGS[r][1]);
          const g = slabMesh(sh, SLAB * (r === 0 ? 1.0 : 1.35), cx, cz,
            [r === 0 ? matLip : matTop, matSide]);
          g.position.y -= rnd() * 0.013;      // nothing here is machine-cut
          arenaGroup.add(g);
          wedges.push({ sector: i, ring: r, group: g, baseY: g.position.y,
                        falling: 0, vy: 0, rx: 0, rz: 0 });
        }
      }
    }

    /** Boundary test. `u` is the normalised elliptical radius. */
    function normRadius(x, z) { return Math.hypot(x / ARENA_A, z / ARENA_B); }
    function sectorOf(x, z) {
      const phi = Math.atan2(z / ARENA_B, x / ARENA_A);
      return ((Math.floor(((phi % TAU) + TAU) % TAU / DPHI)) % SECT + SECT) % SECT;
    }
    function onPlatform(x, z) { return normRadius(x, z) <= sectorFrac[sectorOf(x, z)]; }

    /* --- background rubble -------------------------------------------
     * Low-poly clay clumps ringing the void. They exist so the platform
     * has something to float above; fog swallows the far ones. */
    /* A pool of dim warm light on the ground far below, so the platform is
     * floating *over* something rather than punched out of a black rectangle.
     * Baked once; there are no packaged assets to load one from. */
    function poolTexture() {
      const S = 256, c = surf(S, S);
      if (!c) return null;
      const g = c.getContext("2d");
      const rad = g.createRadialGradient(128, 128, 8, 128, 128, 126);
      rad.addColorStop(0.00, "#4A3A28");
      rad.addColorStop(0.34, "#2E2418");
      rad.addColorStop(0.70, "#171208");
      rad.addColorStop(1.00, "#0E0B07");
      g.fillStyle = rad;
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 90; i++) {
        const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 26;
        g.fillStyle = rnd() < 0.5 ? "rgba(120,100,70,0.05)" : "rgba(0,0,0,0.09)";
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      return c;
    }
    const poolCanvas = poolTexture();
    const poolMat = new THREE.MeshBasicMaterial({ color: poolCanvas ? 0xffffff : 0x241C12, fog: true });
    if (poolCanvas) {
      const pt = new THREE.CanvasTexture(poolCanvas);
      pt.colorSpace = THREE.SRGBColorSpace;
      poolMat.map = pt;
      ctx.onDestroy(() => pt.dispose());
    }
    const poolMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat);
    poolMesh.rotation.x = -Math.PI / 2;
    scene.add(poolMesh);

    /* The platform's own shadow, thrown down and away from the key light
     * onto the rubble floor. One soft blot instead of a shadow pass. */
    function blotTexture() {
      const S = 128, c = surf(S, S);
      if (!c) return null;
      const g = c.getContext("2d");
      const rad = g.createRadialGradient(64, 64, 6, 64, 64, 63);
      rad.addColorStop(0.00, "rgba(0,0,0,0.86)");
      rad.addColorStop(0.52, "rgba(0,0,0,0.52)");
      rad.addColorStop(0.82, "rgba(0,0,0,0.16)");
      rad.addColorStop(1.00, "rgba(0,0,0,0)");
      g.fillStyle = rad;
      g.fillRect(0, 0, S, S);
      return c;
    }
    const blotCanvas = blotTexture();
    let blotTex = null;
    if (blotCanvas) {
      blotTex = new THREE.CanvasTexture(blotCanvas);
      ctx.onDestroy(() => blotTex.dispose());
    }
    const castMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: blotTex, color: blotTex ? 0xffffff : 0x000000,
        transparent: true, opacity: blotTex ? 0.62 : 0.35, depthWrite: false }));
    castMesh.rotation.x = -Math.PI / 2;
    scene.add(castMesh);

    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x655C41, flatShading: true });
    const rockMat2 = new THREE.MeshLambertMaterial({ color: 0x47412E, flatShading: true });
    const rocks = new THREE.Group();
    scene.add(rocks);
    function buildRocks() {
      rocks.clear();
      poolMesh.position.set(0, -1.92, 0);
      poolMesh.scale.set(ARENA_A * 10, ARENA_B * 7, 1);
      castMesh.position.set(ARENA_A * 0.42, -1.86, ARENA_B * 0.14);
      castMesh.scale.set(ARENA_A * 2.5, ARENA_B * 2.5, 1);
      // Two bands of clumps hugging the rim. The inner band is what you
      // actually see in the strip of screen either side of the platform, so
      // it has to be close enough to catch the key light.
      for (let band = 0; band < 2; band++) {
        const n = band === 0 ? 20 : 14;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rnd() * 0.25;
          const rr = band === 0 ? 1.42 + rnd() * 0.46 : 2.05 + rnd() * 0.95;
          const m = new THREE.Mesh(rockGeo, i % 3 === 0 ? rockMat2 : rockMat);
          m.position.set(
            Math.cos(a) * rr * ARENA_A,
            (band === 0 ? -0.62 : -0.95) - rnd() * (band === 0 ? 0.8 : 1.5),
            Math.sin(a) * rr * ARENA_B
          );
          const big = rnd() < 0.18;
          const sc = (band === 0 ? 0.22 + rnd() * 0.34 : 0.36 + rnd() * 0.66) * (big ? 1.6 : 1);
          m.scale.set(sc * (0.8 + rnd() * 0.7), sc * (0.5 + rnd() * 0.7), sc * (0.8 + rnd() * 0.7));
          m.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
          rocks.add(m);
        }
      }
    }

    /* ===============================================================
     * FIGURES
     *
     * One oversized sphere head, a squashed body, no neck, stubby boots —
     * and a helmet cap plus a crest silhouette that is unique per player,
     * so a figure is identifiable with the colour taken away.
     * ============================================================= */
    const geoSphere = new THREE.SphereGeometry(1, 18, 12);
    const geoCap = new THREE.SphereGeometry(1, 18, 10, 0, TAU, 0, Math.PI * 0.52);
    const geoCone = new THREE.ConeGeometry(1, 1, 7);
    const geoBox = new THREE.BoxGeometry(1, 1, 1);
    const geoCyl = new THREE.CylinderGeometry(1, 1, 1, 10);

    /* The camera looks down at about 18 degrees, so what a player actually
     * sees of their own figure is the top of the helmet. Identity therefore
     * has to live in the plan view: each crest is a different silhouette
     * looked at from directly above — a bar, a pair, a dot on a stalk, a
     * three-point star — and it survives colour blindness and a scramble in
     * the corner where two figures overlap. */
    function crestMesh(kind, mat) {
      const g = new THREE.Group();
      if (kind === "fin") {                                    // a bar, front to back
        const m = new THREE.Mesh(geoBox, mat);
        m.scale.set(0.036, 0.11, 0.205);
        m.position.set(0, 0.050, 0);
        g.add(m);
      } else if (kind === "horns") {                           // two lobes, side by side
        for (const q of [-1, 1]) {
          const m = new THREE.Mesh(geoCone, mat);
          m.scale.set(0.050, 0.125, 0.050);
          m.position.set(0.076 * q, 0.046, 0.008);
          m.rotation.z = -0.46 * q;
          g.add(m);
        }
      } else if (kind === "antenna") {                         // one offset dot
        const rod = new THREE.Mesh(geoCyl, mat);
        rod.scale.set(0.017, 0.15, 0.017);
        rod.position.set(0, 0.070, 0);
        rod.rotation.z = 0.30;
        const ball = new THREE.Mesh(geoSphere, mat);
        ball.scale.setScalar(0.046);
        ball.position.set(-0.045, 0.148, 0);
        g.add(rod, ball);
      } else {                                                 // crown: three points
        for (let i = -1; i <= 1; i++) {
          const m = new THREE.Mesh(geoCone, mat);
          m.scale.set(0.042, 0.100 - Math.abs(i) * 0.026, 0.042);
          m.position.set(i * 0.070, 0.048 + (i === 0 ? 0.016 : 0), 0);
          g.add(m);
        }
        const band = new THREE.Mesh(geoCyl, mat);
        band.scale.set(0.104, 0.024, 0.104);
        band.position.y = 0.010;
        g.add(band);
      }
      return g;
    }

    function buildFigure(pi) {
      const P = PL[pi];
      // The helmet, not the body, carries the player colour: it is the only
      // large surface the camera can actually see from up here.
      const bodyMat = new THREE.MeshLambertMaterial({ color: P.dark });
      const helmMat = new THREE.MeshLambertMaterial({ color: P.body });
      const darkMat = new THREE.MeshLambertMaterial({ color: P.helm });
      const skinMat = new THREE.MeshLambertMaterial({ color: 0xF0D4AD });
      const bootMat = new THREE.MeshLambertMaterial({ color: 0x241B15 });
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x140F0C });

      const root = new THREE.Group();          // world position + facing
      const rig = new THREE.Group();           // everything that tumbles
      root.add(rig);

      const torso = new THREE.Mesh(geoSphere, bodyMat);
      torso.scale.set(0.142, 0.100, 0.124);
      torso.position.y = 0.112;

      const head = new THREE.Mesh(geoSphere, skinMat);
      head.scale.setScalar(0.134);
      head.position.y = 0.292;

      const helm = new THREE.Mesh(geoCap, helmMat);
      helm.scale.setScalar(0.143);
      helm.position.y = 0.290;

      const crest = crestMesh(P.crest, darkMat);
      crest.position.y = 0.360;

      const eyes = new THREE.Group();
      for (const q of [-1, 1]) {
        const e = new THREE.Mesh(geoSphere, eyeMat);
        e.scale.set(0.036, 0.043, 0.030);
        e.position.set(0.048 * q, 0.276, 0.123);
        eyes.add(e);
      }

      const arms = [];
      for (const q of [-1, 1]) {
        const a = new THREE.Mesh(geoSphere, helmMat);
        a.scale.setScalar(0.043);
        a.position.set(0.139 * q, 0.131, 0.016);
        arms.push(a);
      }
      const boots = [];
      for (const q of [-1, 1]) {
        const b = new THREE.Mesh(geoSphere, bootMat);
        b.scale.set(0.052, 0.034, 0.070);
        b.position.set(0.061 * q, 0.034, 0.009);
        boots.push(b);
      }

      rig.add(torso, head, helm, crest, eyes, arms[0], arms[1], boots[0], boots[1]);

      // A hand-held bomb, shown while cooking.
      const hold = new THREE.Group();
      hold.position.set(0.145, 0.204, 0.102);
      hold.visible = false;
      const hb = new THREE.Mesh(geoSphere, new THREE.MeshLambertMaterial({ color: 0x2A2A36 }));
      hb.scale.setScalar(0.064);
      hold.add(hb);
      const spark = new THREE.Mesh(geoSphere, new THREE.MeshBasicMaterial({ color: 0xFFF6C0 }));
      spark.scale.setScalar(0.026);
      spark.position.set(0, 0.072, 0);
      hold.add(spark);
      rig.add(hold);

      // A ring on the floor under each figure in their own colour: with four
      // small clay people on a wooden slab, this is what lets you find
      // yourself instantly.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(CHAR_R * 1.02, CHAR_R * 1.42, 26),
        new THREE.MeshBasicMaterial({ color: P.body, transparent: true, opacity: 0.9,
          depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.006;
      // A soft contact shadow of its own. The shadow map alone loses the
      // figure against dark grain when the key light is behind it.
      const foot = new THREE.Mesh(
        new THREE.PlaneGeometry(CHAR_R * 4.2, CHAR_R * 4.2),
        new THREE.MeshBasicMaterial({ map: blotTex, color: 0x120C06, transparent: true,
          opacity: 0.42, depthWrite: false })
      );
      foot.rotation.x = -Math.PI / 2;
      foot.position.set(CHAR_R * 0.5, 0.004, CHAR_R * 0.22);
      root.add(foot, ring);

      root.visible = false;
      scene.add(root);
      return { root, rig, hold, spark, ring, foot, arms, torso, head };
    }
    const figures = PL.map((_, i) => buildFigure(i));

    /* ===============================================================
     * BOMBS, BLASTS, SPARKS, SCORCH
     * ============================================================= */
    const bombMatBase = new THREE.MeshLambertMaterial({ color: 0x2A2A36 });
    const bombMatHot = new THREE.MeshLambertMaterial({ color: 0x8A1B10, emissive: 0x6E1200 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xFFF6C0 });

    const BOMB_MAX = 8;
    const bombPool = [];
    for (let i = 0; i < BOMB_MAX; i++) {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(geoSphere, bombMatBase);
      ball.scale.setScalar(0.056);
      const wick = new THREE.Mesh(geoCyl, new THREE.MeshLambertMaterial({ color: 0x6B6B76 }));
      wick.scale.set(0.008, 0.05, 0.008);
      wick.position.set(0.012, 0.078, 0);
      wick.rotation.z = -0.4;
      const fl = new THREE.Mesh(geoSphere, flameMat);
      fl.scale.setScalar(0.026);
      fl.position.set(0.030, 0.104, 0);
      g.add(ball, wick, fl);
      g.visible = false;
      scene.add(g);
      bombPool.push({ group: g, ball, flame: fl, live: false });
    }
    // Four bomb lights, created once so the shader never recompiles mid-round.
    const bombLights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xFFA030, 0, 1.4, 2);
      l.position.set(0, -50, 0);
      scene.add(l);
      bombLights.push(l);
    }
    const flashLight = new THREE.PointLight(0xFFE08A, 0, 3.2, 2);
    scene.add(flashLight);

    /* --- explosion pool --- */
    function lobedGeo() {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      const s1 = rnd() * TAU, s2 = rnd() * TAU;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const th = Math.atan2(z, x), ph = Math.atan2(y, Math.hypot(x, z));
        const k = 1 + 0.16 * Math.sin(5 * th + s1) + 0.09 * Math.sin(9 * ph + s2);
        p.setXYZ(i, x * k, y * k, z * k);
      }
      g.computeVertexNormals();
      return g;
    }
    const boomGeos = [lobedGeo(), lobedGeo(), lobedGeo(), lobedGeo()];
    /* A fireball is three nested shells, not one ball.
     *
     * Looked at from almost overhead, a single unlit sphere is a flat disc of
     * one colour — a paper cutout, which is exactly what the first version
     * looked like. Three lobed shells at different radii, each on its own
     * colour ramp and its own fade, read as a white-hot heart blooming through
     * yellow into orange smoke, which is what the eye expects. */
    const SHELL_R = [1.00, 0.70, 0.42];
    const booms = [];
    for (let i = 0; i < 4; i++) {
      const shells = [];
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Mesh(boomGeos[(i + k) % 4], new THREE.MeshBasicMaterial({
          color: 0xFFF6C0, transparent: true, opacity: 0, depthWrite: false,
        }));
        m.renderOrder = 4 + k;             // innermost draws last, on top
        m.visible = false;
        scene.add(m);
        shells.push(m);
      }
      // The shockwave, flat on the boards: a thin bright ring racing outward.
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.0, 40), new THREE.MeshBasicMaterial({
        color: 0xFFE08A, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 3;
      scene.add(ring);
      booms.push({ shells, ring, t: 0, dur: 0.52, r: BLAST });
    }

    /* --- sparks --- */
    const sparkGeo = new THREE.SphereGeometry(0.024, 8, 6);
    const sparks = (function () {
      const N = 48, pool = [];
      for (let i = 0; i < N; i++) {
        const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xFFF074, transparent: true, opacity: 0 }));
        m.visible = false;
        scene.add(m);
        pool.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
      }
      let next = 0;
      return {
        burst(x, y, z, count, power, hex) {
          for (let i = 0; i < count; i++) {
            const p = pool[next = (next + 1) % N];
            const a = rnd() * TAU, e = rnd() * 1.1;
            const sp = power * (0.35 + rnd() * 1.0);
            p.m.position.set(x, y, z);
            p.m.material.color.setHex(hex === undefined ? (rnd() < 0.4 ? 0xFFF074 : 0xFD8B1E) : hex);
            p.vx = Math.cos(a) * Math.cos(e) * sp;
            p.vz = Math.sin(a) * Math.cos(e) * sp;
            p.vy = Math.sin(e) * sp * 1.1 + 0.4;
            p.max = p.life = 0.38 + rnd() * 0.55;
            p.m.visible = true;
          }
        },
        step(dt) {
          for (const p of pool) {
            if (p.life <= 0) continue;
            p.life -= dt;
            if (p.life <= 0) { p.m.visible = false; p.m.material.opacity = 0; continue; }
            p.m.position.x += p.vx * dt;
            p.m.position.y += p.vy * dt;
            p.m.position.z += p.vz * dt;
            p.vy -= 4.4 * dt;
            p.vx *= 0.965; p.vz *= 0.965;
            if (p.m.position.y < 0.02) { p.m.position.y = 0.02; p.vy = Math.abs(p.vy) * 0.32; }
            const t = p.life / p.max;
            p.m.material.opacity = Math.min(1, t * 1.6);
            p.m.scale.setScalar(0.5 + t * 0.9);
          }
        },
        clear() { for (const p of pool) { p.life = 0; p.m.visible = false; } },
      };
    })();

    /* --- scorch --- */
    const scorchCanvas = scorchTexture();
    const scorchPool = [];
    if (scorchCanvas) {
      const st = new THREE.CanvasTexture(scorchCanvas);
      st.colorSpace = THREE.SRGBColorSpace;
      ctx.onDestroy(() => st.dispose());
      const geo = new THREE.PlaneGeometry(1, 1);
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          map: st, transparent: true, opacity: 0.85, depthWrite: false,
        }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.008;
        m.visible = false;
        m.renderOrder = 2;
        scene.add(m);
        scorchPool.push(m);
      }
    }
    let scorchNext = 0;
    function stampScorch(x, z, r) {
      if (!scorchPool.length || !onPlatform(x, z)) return;
      const m = scorchPool[scorchNext = (scorchNext + 1) % scorchPool.length];
      m.position.set(x, 0.008, z);
      m.rotation.z = rnd() * TAU;
      m.scale.setScalar(r * (2.0 + rnd() * 0.5));
      m.visible = true;
    }

    /* --- aim preview: dots along the throw arc plus a landing ring --- */
    const aims = PL.map((p) => {
      const g = new THREE.Group();
      const dots = [];
      const mat = new THREE.MeshBasicMaterial({ color: p.body, transparent: true, opacity: 0.95, depthWrite: false });
      for (let i = 0; i < 9; i++) {
        const d = new THREE.Mesh(sparkGeo, mat);
        d.scale.setScalar(1.30 - i * 0.085);
        g.add(d);
        dots.push(d);
      }
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(BLAST * 0.87, BLAST, 34),
        new THREE.MeshBasicMaterial({ color: p.body, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      g.add(ring);
      g.visible = false;
      scene.add(g);
      return { group: g, dots, ring };
    });

    /* ===============================================================
     * GAME STATE
     * ============================================================= */
    const P = PL.map((info, i) => ({
      i, info, seat: SEATS[i],
      x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0,
      face: { x: 0, z: 1 },
      sx: 0, sy: 0,                 // stick, in this player's own frame
      alive: false, playing: false, ready: false,
      cooking: false, fuse: FUSE, hasBomb: true, reload: 0,
      tumble: 0, spinX: 0, spinZ: 0, bob: 0,
      wins: 0, falling: 0,
      stickPtr: null, bombPtr: null,
    }));

    const bombs = [];
    let phase = "title";     // title | seat | countdown | play | roundend | matchend
    let round = 0, roundT = 0, crumbleT = 0, crumbleLeft = [];
    let timeScale = 1, slowT = 0, hitstop = 0;
    let bestStreak = 0, curStreak = 0, lastWinner = -1;
    let matchWinner = -1, roundWinner = -1;
    let bannerT = 0;

    const busy = () => phase !== "play";

    /* ===============================================================
     * OVERLAY
     *
     * One markup string on the runtime-owned root, queried back out by
     * [data-el]. The root is transparent to pointers: it is created after
     * the canvas and fills the container, so without that it silently eats
     * every touch meant for a control. Only the pads and the panels opt
     * back in.
     * ============================================================= */
    const FONT = "ui-rounded,'SF Pro Rounded','Nunito Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
    const MONO = "'SF Mono',ui-monospace,'Space Mono',Menlo,monospace";

    function padMarkup(i) {
      const b = L.pads[i], G = padGeo(i), p = PL[i];
      const small = b.h < 100;
      const circle = (x, y, r, css) =>
        'position:absolute;left:' + (x - r) + 'px;top:' + (y - r) + 'px;width:' + (r * 2) +
        'px;height:' + (r * 2) + 'px;border-radius:50%;pointer-events:none;' + css;
      return '' +
        '<div data-el="pad' + i + '" style="position:absolute;left:' + (b.cx - b.w / 2) + 'px;top:' +
          (b.cy - b.h / 2) + 'px;width:' + b.w + 'px;height:' + b.h + 'px;' +
          'transform:rotate(' + b.rot + 'deg);pointer-events:auto;touch-action:none;display:none;' +
          'opacity:1;transition:opacity 180ms ease;">' +
          // clay tablet
          '<div style="position:absolute;inset:0;border-radius:' + (small ? 16 : 22) + 'px;pointer-events:none;' +
            'background:' + CLAY_FACE + ';' +
            'box-shadow:inset 0 2px 0 rgba(255,224,180,0.18),inset 0 -4px 0 rgba(0,0,0,0.42),' +
            'inset 0 0 26px ' + p.ink + '20,' +
            '0 5px 0 rgba(0,0,0,0.45),0 10px 22px rgba(0,0,0,0.5);' +
            'border:2px solid ' + p.ink + '99;"></div>' +
          // stick well
          '<div style="' + circle(G.stickCX, G.stickCY, G.wellR,
            'background:' + WELL_FACE + ';' +
            'box-shadow:inset 0 4px 8px rgba(0,0,0,0.70),inset 0 -2px 0 rgba(255,224,180,0.07);') + '"></div>' +
          '<div data-el="knob' + i + '" style="' + circle(G.stickCX, G.stickCY, G.knobR,
            'background:radial-gradient(circle at 35% 28%,' + p.lit + ',' + p.ink + ' 62%,' + p.ink + ');' +
            'box-shadow:0 3px 0 rgba(0,0,0,0.5),inset 0 -3px 0 rgba(0,0,0,0.22);' +
            'transform:translate(0px,0px);') + '"></div>' +
          // bomb button: fuse gauge behind, clay sphere in front
          '<div data-el="ring' + i + '" style="' + circle(G.bombCX, G.bombCY, G.ringR,
            'background:' + TRACK + ';opacity:0.34;' +
            '-webkit-mask-image:' + G.gaugeMask + ';mask-image:' + G.gaugeMask + ';') + '"></div>' +
          '<div data-el="halo' + i + '" style="' + circle(G.bombCX, G.bombCY, G.ringR * 0.94,
            'background:radial-gradient(circle,rgba(255,110,40,0.55),rgba(255,110,40,0) 70%);opacity:0;') + '"></div>' +
          // A fuse stub poking out past the rim, always lit enough to read as a
          // bomb: the stick well next to it is the same size and the same
          // charcoal, and at a glance the two must not be confusable.
          '<div data-el="bomb' + i + '" style="' + circle(G.bombCX, G.bombCY, G.bombR,
            'background:radial-gradient(circle at 33% 25%,#6E655C,#2A2420 46%,#0B0908);' +
            'box-shadow:0 5px 0 rgba(0,0,0,0.6),inset -3px -5px 10px rgba(0,0,0,0.55);' +
            'transition:transform 90ms ease;overflow:visible;') + '">' +
            '<div style="position:absolute;left:' + (G.bombR * 0.30) + 'px;top:' + (-G.bombR * 0.34) +
              'px;width:' + Math.max(4, G.bombR * 0.13) + 'px;height:' + (G.bombR * 0.72) +
              'px;background:linear-gradient(180deg,#9A9086,#4C453D);border-radius:4px;' +
              'transform:rotate(26deg);transform-origin:50% 100%;"></div>' +
            '<div data-el="wick' + i + '" style="position:absolute;left:' + (G.bombR * 0.44) +
              'px;top:' + (-G.bombR * 0.46) + 'px;width:' + (G.bombR * 0.24) + 'px;height:' +
              (G.bombR * 0.24) + 'px;margin-left:-' + (G.bombR * 0.10) + 'px;border-radius:50%;' +
              'background:radial-gradient(circle,#FFFDE8,' + HOT + ' 45%,rgba(253,139,30,0));' +
              'opacity:0.35;"></div>' +
            '<div style="position:absolute;left:22%;top:16%;width:26%;height:17%;border-radius:50%;' +
              'background:rgba(255,255,255,0.34);transform:rotate(-24deg);"></div>' +
          '</div>' +
          // name / pips / status
          '<div style="position:absolute;left:' + (G.stickCX + G.wellR + 8) + 'px;top:0;width:' +
            (G.bombCX - G.ringR - G.stickCX - G.wellR - 16) + 'px;height:100%;display:flex;' +
            'flex-direction:column;align-items:center;justify-content:center;gap:' + (small ? 2 : 4) + 'px;' +
            'pointer-events:none;">' +
            '<div style="font-size:' + (small ? 13 : 16) + 'px;font-weight:800;letter-spacing:0.02em;color:' +
              p.ink + ';text-shadow:0 2px 0 rgba(0,0,0,0.5);">' + esc(p.name) + '</div>' +
            '<div data-el="pips' + i + '" style="display:flex;gap:4px;"></div>' +
            '<div data-el="st' + i + '" style="font-size:' + (small ? 9 : 10.5) + 'px;font-weight:700;' +
              'letter-spacing:0.16em;text-transform:uppercase;color:rgba(234,243,230,0.5);' +
              'white-space:nowrap;">hold to arm</div>' +
          '</div>' +
        '</div>';
    }

    const btnIcon = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:1.5px solid " + RIM + ";" +
      "background:linear-gradient(180deg,#3B2C1E,#241A11);color:rgba(255,226,178,0.92);font-size:15px;" +
      "font-weight:800;line-height:1;font-family:inherit;padding:0;" +
      "box-shadow:0 2px 0 rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,224,180,0.15);";
    const bigBtn = (bg, fg) => "pointer-events:auto;display:block;width:100%;padding:15px;border:none;border-radius:18px;" +
      "font-family:inherit;font-size:16px;font-weight:800;letter-spacing:0.01em;background:" + bg +
      ";color:" + fg + ";box-shadow:0 5px 0 rgba(0,0,0,0.42);";
    const CTA = bigBtn(EMBER_BTN, EMBER_INK);

    const CARD_W = 306, CARD_H = 386, HELP_H = 600;
    const cardX = () => Math.round((W - CARD_W) / 2);
    const cardY = () => Math.round((H - CARD_H) / 2);
    const pillRow = (name, labels, y) => {
      const n = labels.length, pw = Math.floor((CARD_W - 28 - (n - 1) * 8) / n);
      return labels.map((lab, k) =>
        '<button data-el="' + name + k + '" data-k="' + k + '" style="pointer-events:auto;position:absolute;left:' +
        (14 + k * (pw + 8)) + 'px;top:' + y + 'px;width:' + pw + 'px;height:44px;border:none;border-radius:14px;' +
        'font-family:inherit;font-size:14.5px;font-weight:800;">' + esc(lab) + '</button>').join("");
    };

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:" + OFFWHITE + ";pointer-events:none;";
    root.innerHTML =
      // --- vignette: the void closing in on the lit slab ---
      '<div style="position:absolute;inset:0;pointer-events:none;z-index:1;background:' +
        'radial-gradient(ellipse 74% 46% at 50% 48%,rgba(0,0,0,0) 42%,rgba(0,0,0,0.30) 72%,rgba(0,0,0,0.68) 100%);"></div>' +

      // --- pads ---
      '<div data-el="pads" style="position:absolute;inset:0;z-index:20;pointer-events:none;">' +
        [0, 1, 2, 3].map(padMarkup).join("") +
      '</div>' +

      // --- chrome, tucked into the top-left of the free rectangle ---
      '<div data-el="chrome" style="position:absolute;left:' + (L.arena.x + 6) + 'px;top:' + (L.arena.y + 2) +
        'px;display:flex;gap:7px;z-index:45;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btnIcon + '">&#9834;</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btnIcon + '">&#8801;</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btnIcon + '">?</button>' +
      '</div>' +

      // --- round pill, top-right of the free rectangle ---
      '<div data-el="roundpill" style="position:absolute;right:' + (W - L.arena.x - L.arena.w + 6) + 'px;top:' +
        (L.arena.y + 4) + 'px;z-index:45;pointer-events:none;display:none;text-align:right;">' +
        '<div data-el="roundno" style="font-size:12px;font-weight:800;letter-spacing:0.18em;' +
          'text-transform:uppercase;color:rgba(234,243,230,0.62);">Round 1</div>' +
        '<div data-el="warn" style="font-size:11px;font-weight:800;letter-spacing:0.14em;' +
          'text-transform:uppercase;color:#FF7A3C;opacity:0;font-family:' + MONO + ';">rim falling</div>' +
      '</div>' +

      // --- centre banner ---
      '<div data-el="banner" style="position:absolute;left:0;right:0;top:50%;z-index:44;pointer-events:none;' +
        'text-align:center;transform:translateY(-50%);opacity:0;">' +
        '<div data-el="banner-echo" style="font-size:26px;font-weight:800;letter-spacing:-0.01em;' +
          'transform:rotate(180deg);opacity:0.85;margin-bottom:8px;' +
          'text-shadow:0 3px 0 rgba(0,0,0,0.55);"></div>' +
        '<div data-el="banner-big" style="font-size:44px;font-weight:800;letter-spacing:-0.02em;' +
          'text-shadow:0 5px 0 rgba(0,0,0,0.55),0 0 40px rgba(255,180,60,0.4);"></div>' +
        '<div data-el="banner-sub" style="font-size:14px;font-weight:700;letter-spacing:0.22em;' +
          'text-transform:uppercase;opacity:0.66;margin-top:4px;"></div>' +
      '</div>' +

      // --- title ---
      '<div data-el="title" style="position:absolute;inset:0;z-index:60;pointer-events:auto;' +
        'background:radial-gradient(ellipse at 50% 34%,#241A12 0%,#0C0906 70%);">' +
        '<div style="position:absolute;left:0;right:0;top:' + Math.round(H * 0.165) + 'px;text-align:center;">' +
          '<div style="font-size:12px;font-weight:800;letter-spacing:0.44em;text-transform:uppercase;' +
            'color:rgba(234,243,230,0.42);">Blow up your friends</div>' +
          '<div style="margin-top:8px;font-size:58px;line-height:1.02;font-weight:800;letter-spacing:-0.025em;' +
            'color:' + OFFWHITE + ';text-shadow:0 5px 0 #8A5C26,0 9px 0 rgba(0,0,0,0.5),0 0 46px rgba(255,196,77,0.35);">' +
            'Blast<br>Yard</div>' +
          '<div style="margin:16px auto 0;max-width:262px;font-size:14.5px;line-height:1.6;' +
            'color:rgba(234,243,230,0.68);">Phone flat on the table. Take an edge each. Everyone plays at once — ' +
            'the last one still on the wood takes the round.</div>' +
        '</div>' +
        '<div style="position:absolute;left:0;right:0;top:' + Math.round(H * 0.515) + 'px;text-align:center;' +
          'font-size:11.5px;font-weight:800;letter-spacing:0.30em;text-transform:uppercase;' +
          'color:rgba(234,243,230,0.42);">How many players?</div>' +
        [2, 3, 4].map((n, k) =>
          '<button data-el="count' + n + '" data-n="' + n + '" style="pointer-events:auto;position:absolute;' +
          'left:' + Math.round(W / 2 + (k - 1) * 88 - 34) + 'px;top:' + Math.round(H * 0.552) + 'px;' +
          'width:68px;height:68px;border-radius:24px;border:2px solid rgba(255,198,120,0.42);' +
          'background:linear-gradient(180deg,#805D3D,#3E2B1B);color:#FFE6B4;font-family:inherit;' +
          'font-size:26px;font-weight:800;text-shadow:0 2px 0 rgba(0,0,0,0.45);' +
          'box-shadow:0 5px 0 rgba(0,0,0,0.5),inset 0 2px 0 rgba(255,224,180,0.26);">' +
          n + '</button>').join("") +
        '<div style="position:absolute;left:0;right:0;top:' + Math.round(H * 0.672) + 'px;text-align:center;' +
          'font-size:12px;line-height:1.65;color:rgba(234,243,230,0.36);">Two &rarr; the short edges' +
          '<br>Three &rarr; add the left side &nbsp;·&nbsp; Four &rarr; one per edge</div>' +
        '<div style="position:absolute;left:0;right:0;top:' + Math.round(H * 0.772) + 'px;' +
          'display:flex;gap:10px;justify-content:center;">' +
          PL.map((q) =>
            '<div style="width:62px;text-align:center;">' +
              '<div style="height:34px;border-radius:14px;background:linear-gradient(180deg,' + q.lit + ',' +
                q.ink + ');box-shadow:0 3px 0 rgba(0,0,0,0.45);"></div>' +
              '<div style="margin-top:6px;font-size:10px;font-weight:800;letter-spacing:0.12em;' +
                'text-transform:uppercase;color:rgba(234,243,230,0.5);">' + esc(q.name) + '</div>' +
            '</div>').join("") +
        '</div>' +
        '<div style="position:absolute;left:34px;right:34px;bottom:' + (ctx.safeArea.bottom + 16) + 'px;' +
          'text-align:center;font-size:10.5px;line-height:1.5;letter-spacing:0.06em;' +
          'color:rgba(234,243,230,0.26);">' +
          'Longest run of rounds won back-to-back<br>goes to the global board</div>' +
      '</div>' +

      // --- seat check ---
      '<div data-el="seatp" style="position:absolute;inset:0;z-index:40;pointer-events:none;display:none;">' +
        '<div style="position:absolute;left:50%;top:50%;margin-top:-124px;width:214px;' +
          'box-sizing:border-box;padding:11px 14px 12px;border-radius:18px;opacity:0.82;' +
          'transform:translate(-50%,-50%) rotate(180deg);text-align:center;pointer-events:none;' +
          'background:linear-gradient(180deg,rgba(38,30,22,0.90),rgba(16,12,8,0.93));' +
          'box-shadow:inset 0 2px 0 rgba(255,224,180,0.09),0 6px 18px rgba(0,0,0,0.55);' +
          'border:1.5px solid rgba(255,205,130,0.14);">' +
          '<div style="font-size:14px;line-height:1.24;font-weight:800;' +
            'color:rgba(234,243,230,0.86);">Everyone press<br>your bomb button</div>' +
          '<div data-el="seatcount2" style="margin-top:5px;font-size:10.5px;font-weight:800;' +
            'letter-spacing:0.16em;color:' + HOT + ';font-family:' + MONO + ';">0 / 4 ready</div>' +
        '</div>' +
        '<div data-el="seatcard" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
          'width:214px;box-sizing:border-box;padding:16px 14px 18px;border-radius:22px;text-align:center;' +
          'background:linear-gradient(180deg,rgba(38,30,22,0.93),rgba(16,12,8,0.95));' +
          'box-shadow:inset 0 2px 0 rgba(255,255,255,0.10),0 8px 24px rgba(0,0,0,0.6);' +
          'border:1.5px solid rgba(234,243,230,0.12);">' +
          '<div style="font-size:11px;font-weight:800;letter-spacing:0.26em;text-transform:uppercase;' +
            'color:rgba(234,243,230,0.45);">Take your seat</div>' +
          '<div style="margin-top:8px;font-size:19px;line-height:1.25;font-weight:800;">Everyone press<br>your bomb button</div>' +
          '<div data-el="seatcount" style="margin-top:10px;font-size:13px;font-weight:800;letter-spacing:0.18em;' +
            'color:' + HOT + ';font-family:' + MONO + ';">0 / 4 ready</div>' +
        '</div>' +
        '<button data-el="skip" style="pointer-events:auto;position:absolute;left:50%;top:50%;' +
          'margin-left:-78px;margin-top:96px;width:156px;height:42px;border-radius:15px;' +
          'font-family:inherit;font-size:13.5px;font-weight:800;letter-spacing:0.04em;' +
          'background:rgba(20,14,8,0.74);color:' + OFFWHITE + ';' +
          'border:1.5px solid ' + RIM + ';' +
          'box-shadow:0 4px 0 rgba(0,0,0,0.45);">Start anyway</button>' +
      '</div>' +

      // --- match over ---
      '<div data-el="over" style="position:absolute;inset:0;z-index:62;pointer-events:auto;display:none;' +
        'background:radial-gradient(ellipse at 50% 40%,rgba(30,20,12,0.975),rgba(6,4,3,0.99));">' +
        '<div style="position:absolute;left:0;right:0;top:20%;text-align:center;' +
          'transform:rotate(180deg);">' +
          '<div style="font-size:10.5px;font-weight:800;letter-spacing:0.32em;text-transform:uppercase;' +
            'color:rgba(234,243,230,0.36);">Match over</div>' +
          '<div data-el="over-title2" style="margin-top:4px;font-size:26px;font-weight:800;' +
            'letter-spacing:-0.01em;opacity:0.85;text-shadow:0 3px 0 rgba(0,0,0,0.55);"></div>' +
        '</div>' +
        '<div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;padding:0 26px;">' +
          '<div style="font-size:12px;font-weight:800;letter-spacing:0.36em;text-transform:uppercase;' +
            'color:rgba(234,243,230,0.42);">Match over</div>' +
          '<div data-el="over-title" style="margin-top:6px;font-size:46px;font-weight:800;letter-spacing:-0.02em;' +
            'text-shadow:0 4px 0 rgba(0,0,0,0.55);"></div>' +
          '<div data-el="over-line" style="margin:22px auto 0;display:flex;gap:9px;justify-content:center;"></div>' +
          '<div data-el="over-streak" style="margin:22px auto 0;display:inline-block;padding:9px 16px;' +
            'border-radius:999px;background:rgba(255,240,116,0.12);border:1.5px solid rgba(255,240,116,0.35);' +
            'font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:' + HOT + ';"></div>' +
          '<div style="max-width:250px;margin:26px auto 0;">' +
            '<button data-el="again" style="' + CTA + '">Rematch</button>' +
            '<button data-el="newp" style="' + bigBtn("rgba(255,224,180,0.10)", OFFWHITE) +
              'border:1.5px solid ' + RIM + ';margin-top:10px;">Change players</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // --- settings ---
      '<div data-el="cogp" style="position:absolute;inset:0;z-index:70;pointer-events:auto;display:none;' +
        'background:rgba(8,6,4,0.9);">' +
        '<div style="position:absolute;left:' + cardX() + 'px;top:' + cardY() + 'px;width:' + CARD_W + 'px;' +
          'height:' + CARD_H + 'px;border-radius:28px;background:' + PANEL_FACE + ';' +
          'box-shadow:inset 0 3px 0 rgba(255,224,180,0.20),inset 0 -5px 0 rgba(0,0,0,0.38),' +
          '0 9px 0 rgba(0,0,0,0.45),0 18px 40px rgba(0,0,0,0.55);border:2px solid ' + RIM + ';">' +
          '<div style="position:absolute;left:0;right:0;top:18px;text-align:center;font-size:19px;font-weight:800;">Settings</div>' +
          '<div style="position:absolute;left:16px;top:62px;font-size:11px;font-weight:800;letter-spacing:0.2em;' +
            'text-transform:uppercase;opacity:0.5;">Rounds to win</div>' +
          pillRow("rounds", ["2", "3", "5"], 84) +
          '<div style="position:absolute;left:16px;top:146px;font-size:11px;font-weight:800;letter-spacing:0.2em;' +
            'text-transform:uppercase;opacity:0.5;">Pace</div>' +
          '<div style="position:absolute;left:16px;top:163px;font-size:10.5px;opacity:0.36;">' +
            'how soon the rim starts falling away</div>' +
          pillRow("pace", ["Chill", "Normal", "Frantic"], 182) +
          '<div style="position:absolute;left:16px;top:244px;font-size:11px;font-weight:800;letter-spacing:0.2em;' +
            'text-transform:uppercase;opacity:0.5;">Sound</div>' +
          '<button data-el="mute2" style="pointer-events:auto;position:absolute;left:14px;top:262px;width:' +
            (CARD_W - 28) + 'px;height:44px;border:1.5px solid ' + RIM + ';border-radius:14px;' +
            'font-family:inherit;font-size:14.5px;font-weight:800;background:rgba(255,224,180,0.07);' +
            'color:' + OFFWHITE + ';display:flex;align-items:center;justify-content:space-between;' +
            'padding:0 16px;box-sizing:border-box;">' +
            '<span style="pointer-events:none;">Music &amp; effects</span>' +
            '<span data-el="mute2v" style="pointer-events:none;font-size:12px;letter-spacing:0.14em;' +
              'text-transform:uppercase;color:' + HOT + ';">On</span>' +
          '</button>' +
          '<button data-el="cogp-close" style="pointer-events:auto;position:absolute;left:14px;top:320px;width:' +
            (CARD_W - 28) + 'px;height:46px;border:none;border-radius:15px;font-family:inherit;font-size:15px;' +
            'font-weight:800;background:' + EMBER_BTN + ';color:' + EMBER_INK + ';' +
            'box-shadow:0 4px 0 rgba(0,0,0,0.4);">Done</button>' +
        '</div>' +
      '</div>' +

      // --- how to play ---
      '<div data-el="helpp" style="position:absolute;inset:0;z-index:70;pointer-events:auto;display:none;' +
        'background:rgba(8,6,4,0.92);">' +
        '<div style="position:absolute;left:20px;right:20px;top:50%;margin-top:-' + (HELP_H / 2) + 'px;' +
          'height:' + HELP_H + 'px;border-radius:28px;padding:20px 18px 0;' +
          'background:' + PANEL_FACE + ';' +
          'box-shadow:inset 0 3px 0 rgba(255,224,180,0.20),inset 0 -5px 0 rgba(0,0,0,0.38),' +
          '0 9px 0 rgba(0,0,0,0.45),0 18px 40px rgba(0,0,0,0.55);border:2px solid ' + RIM + ';">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:10px;">How to play</div>' +
          '<ul style="font-size:13.5px;line-height:1.62;margin:0;padding-left:17px;color:rgba(234,243,230,0.9);">' +
            '<li>Lay the phone flat. <b>One player per screen edge</b> — your pad is the one facing you.</li>' +
            '<li><b>Left of your pad is the stick.</b> Push it in any direction &mdash; away from you is ' +
              'always away from you, whichever edge you are sitting at.</li>' +
            '<li><b>Right of your pad is the bomb.</b> Hold it down to cook the fuse, let go to throw.</li>' +
            '<li>The fuse burns while you hold. <b>Hold it past three seconds and it goes off in your hands.</b></li>' +
            '<li>Blasts do not kill — they <b>launch</b>. The only way out is over the edge.</li>' +
            '<li>The rim crumbles away as the round drags on, so somebody always falls.</li>' +
            '<li>Last figure standing takes the round. First to the target takes the match.</li>' +
            '<li>The longest run of rounds won back-to-back goes to the global board.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="pointer-events:auto;position:absolute;left:18px;right:18px;' +
            'bottom:18px;height:46px;border:none;border-radius:15px;font-family:inherit;font-size:15px;' +
            'font-weight:800;background:' + EMBER_BTN + ';color:' + EMBER_INK + ';' +
            'box-shadow:0 4px 0 rgba(0,0,0,0.4);">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const onTap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };

    const padEl = [0, 1, 2, 3].map(i => el("pad" + i));
    const knobEl = [0, 1, 2, 3].map(i => el("knob" + i));
    const bombEl = [0, 1, 2, 3].map(i => el("bomb" + i));
    const ringEl = [0, 1, 2, 3].map(i => el("ring" + i));
    const haloEl = [0, 1, 2, 3].map(i => el("halo" + i));
    const wickEl = [0, 1, 2, 3].map(i => el("wick" + i));
    const pipsEl = [0, 1, 2, 3].map(i => el("pips" + i));
    const statEl = [0, 1, 2, 3].map(i => el("st" + i));

    function applyLayout() {
      computeLayout();
      for (let i = 0; i < 4; i++) {
        const b = L.pads[i], G = padGeo(i), n = padEl[i];
        n.style.left = (b.cx - b.w / 2) + "px";
        n.style.top = (b.cy - b.h / 2) + "px";
        n.style.width = b.w + "px";
        n.style.height = b.h + "px";
        n.style.transform = "rotate(" + b.rot + "deg)";
        n.style.display = i < nPlayers && phase !== "title" ? "block" : "none";
        // Re-place the two controls, whose geometry follows the pad's short side.
        knobEl[i].style.left = (G.stickCX - G.knobR) + "px";
        knobEl[i].style.top = (G.stickCY - G.knobR) + "px";
        knobEl[i].style.width = knobEl[i].style.height = (G.knobR * 2) + "px";
      }
      placeChrome();
      const rp = el("roundpill");
      rp.style.right = (W - L.arena.x - L.arena.w + 6) + "px";
      rp.style.top = (L.arena.y + 4) + "px";
      const bn = el("banner");
      bn.style.top = (L.arena.y + L.arena.h / 2) + "px";
    }

    /* The title screen fills the container, so during it the chrome sits in
     * the top-left corner on a layer above it; once the yard is up it drops
     * into the strip between the top pad and the platform, which is the only
     * place on this layout that is never anybody's control and never covers
     * play. */
    const chromeBox = { x: 16, y: 0 };
    function placeChrome() {
      const titled = phase === "title";
      chromeBox.x = titled ? 14 : L.arena.x + 6;
      chromeBox.y = titled ? ctx.safeArea.top + 10 : L.arena.y + 2;
      const c = el("chrome");
      c.style.left = chromeBox.x + "px";
      c.style.top = chromeBox.y + "px";
      c.style.zIndex = titled ? "66" : "45";
    }

    function paintPips() {
      for (let i = 0; i < 4; i++) {
        const p = P[i];
        let h = "";
        for (let k = 0; k < settings.target; k++) {
          const on = k < p.wins;
          h += '<div style="width:9px;height:9px;border-radius:50%;background:' +
            (on ? PL[i].ink : "rgba(234,243,230,0.16)") +
            (on ? ";box-shadow:0 0 8px " + PL[i].ink : "") + ';"></div>';
        }
        pipsEl[i].innerHTML = h;
      }
    }

    /* The seat prompt is printed twice, once for each long edge. */
    function setSeatCount(n) {
      const t = n + " / " + nPlayers + " ready";
      el("seatcount").textContent = t;
      el("seatcount2").textContent = t;
    }

    function setStat(i, text, colour) {
      statEl[i].textContent = text;
      statEl[i].style.color = colour || "rgba(234,243,230,0.5)";
    }

    function banner(big, sub, colour, ms) {
      const b = el("banner");
      el("banner-big").textContent = big;
      el("banner-big").style.color = colour || OFFWHITE;
      el("banner-echo").textContent = big;
      el("banner-echo").style.color = colour || OFFWHITE;
      el("banner-sub").textContent = sub || "";
      b.style.transition = "none";
      b.style.opacity = "1";
      b.style.transform = "translateY(-50%) scale(1.18)";
      ctx.timeout(() => {
        b.style.transition = "transform 220ms cubic-bezier(.2,1.6,.4,1),opacity 300ms ease";
        b.style.transform = "translateY(-50%) scale(1)";
      }, 16);
      bannerT = (ms || 800) / 1000;
    }

    /* ===============================================================
     * SETTINGS PANEL WIRING
     * ============================================================= */
    function paintPills(name, count, get) {
      for (let k = 0; k < count; k++) {
        const b = el(name + k);
        const on = get() === k;
        b.style.background = on ? EMBER_BTN : "rgba(255,224,180,0.09)";
        b.style.color = on ? EMBER_INK : "rgba(234,243,230,0.62)";
        b.style.boxShadow = on ? "0 4px 0 rgba(0,0,0,0.4)" : "none";
      }
    }
    const ROUND_VALUES = [2, 3, 5];
    function paintSettings() {
      paintPills("rounds", 3, () => ROUND_VALUES.indexOf(settings.target));
      paintPills("pace", 3, () => settings.pace);
      el("mute2v").textContent = sound.muted ? "Off" : "On";
      el("mute2v").style.color = sound.muted ? "rgba(234,243,230,0.4)" : HOT;
      el("mute").style.opacity = sound.muted ? "0.45" : "1";
      paintPips();
    }
    for (let k = 0; k < 3; k++) {
      onTap(el("rounds" + k), () => {
        settings.target = ROUND_VALUES[k]; saveSettings(); paintSettings(); sound.haptic("light");
      });
      onTap(el("pace" + k), () => {
        settings.pace = k; saveSettings(); paintSettings(); sound.haptic("light");
      });
    }
    onTap(el("mute2"), () => { sound.toggle(); paintSettings(); });
    onTap(el("mute"), () => { sound.toggle(); paintSettings(); });
    onTap(el("cog"), () => { paintSettings(); el("cogp").style.display = "block"; });
    onTap(el("cogp-close"), () => { el("cogp").style.display = "none"; });
    onTap(el("help"), () => { el("helpp").style.display = "block"; });
    onTap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    for (const n of [2, 3, 4]) {
      onTap(el("count" + n), async () => {
        nPlayers = n;
        ctx.platform.start({ players: n });
        await sound.unlock();
        el("title").style.display = "none";
        startMatch();
        placeChrome();
      });
    }
    onTap(el("skip"), () => { if (phase === "seat") beginRound(); });
    onTap(el("again"), () => {
      el("over").style.display = "none";
      ctx.platform.interact({ type: "replay" });
      startMatch();
    });
    onTap(el("newp"), () => {
      el("over").style.display = "none";
      phase = "title";
      for (let i = 0; i < 4; i++) padEl[i].style.display = "none";
      el("roundpill").style.display = "none";
      el("title").style.display = "block";
      placeChrome();
    });

    /* ===============================================================
     * MATCH / ROUND FLOW
     * ============================================================= */
    function startMatch() {
      applyLayout();
      ARENA_A = 1.0;
      buildArena();
      buildRocks();
      fitCamera();
      for (const p of P) {
        p.wins = 0; p.ready = false;
        p.playing = p.i < nPlayers;
        p.alive = false;
        // A new match is the one place it is right to drop pointer bindings:
        // pads may have just been shown or hidden under somebody's finger.
        p.stickPtr = null; p.bombPtr = null; p.sx = 0; p.sy = 0;
        knobEl[p.i].style.transform = "translate(0px,0px)";
        bombEl[p.i].style.transform = "scale(1)";
      }
      round = 0; bestStreak = 0; curStreak = 0; lastWinner = -1; matchWinner = -1;
      paintPips();
      paintSettings();
      phase = "seat";
      el("seatp").style.display = "block";
      el("roundpill").style.display = "block";
      setSeatCount(0);
      for (let i = 0; i < 4; i++) {
        padEl[i].style.display = i < nPlayers ? "block" : "none";
        padEl[i].style.opacity = "1";
        setStat(i, "press to ready", "rgba(234,243,230,0.5)");
      }
      // Nobody should sit staring at a lobby: if a pad is unclaimed after a
      // few seconds the round starts regardless.
      ctx.timeout(() => { if (phase === "seat") beginRound(); }, 14000);
      renderFrame(0);
    }

    function beginRound() {
      el("seatp").style.display = "none";
      round++;
      roundT = 0; crumbleT = 0;
      crumbleLeft = [];
      // Fall order: the whole outer course in a shuffled order, then the middle
      // one. Outer-first is not cosmetic — dropping a middle block while its
      // outer neighbour still stands would leave a plank floating on nothing.
      for (const ring of [0, 1]) {
        const idx = [];
        for (let i = 0; i < SECT; i++) idx.push(i);
        for (let i = idx.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
        }
        for (const i of idx) crumbleLeft.push({ ring, sector: i });
      }
      sectorFrac.fill(1);
      for (const w of wedges) {
        w.falling = 0; w.vy = 0; w.rx = 0; w.rz = 0;
        w.group.visible = true;
        w.group.position.y = w.baseY;
        w.group.rotation.set(0, 0, 0);
      }
      for (const m of scorchPool) m.visible = false;
      bombs.length = 0;
      for (const b of bombPool) { b.live = false; b.group.visible = false; }
      sparks.clear();
      for (const a of aims) a.group.visible = false;

      // Spawn every figure directly in front of its own seat: symmetric, and
      // it means "my figure" needs no hunting at the start of a round.
      for (const p of P) {
        if (!p.playing) { figures[p.i].root.visible = false; continue; }
        const o = p.seat.out;
        p.x = o.x * ARENA_A * 0.60;
        p.z = o.z * ARENA_B * 0.60;
        p.y = 0; p.vx = p.vz = p.vy = 0;
        p.face = { x: -o.x, z: -o.z };
        p.alive = true; p.falling = 0; p.tumble = 0;
        p.cooking = false; p.fuse = FUSE; p.hasBomb = true; p.reload = 0;
        figures[p.i].root.visible = true;
        figures[p.i].rig.rotation.set(0, 0, 0);
        figures[p.i].hold.visible = false;
        padEl[p.i].style.opacity = "1";
        setStat(p.i, "ready", PL[p.i].ink);
      }
      el("roundno").textContent = "Round " + round;
      el("warn").style.opacity = "0";
      phase = "countdown";
      roundWinner = -1;
      countdown(3);
    }

    function countdown(n) {
      if (phase !== "countdown") return;
      if (n > 0) {
        banner(String(n), "", OFFWHITE, 620);
        sound.sting("tap");
        ctx.timeout(() => countdown(n - 1), 640);
      } else {
        banner("BLAST", "go", HOT, 620);
        sound.sting("coin");
        sound.haptic("medium");
        phase = "play";
        for (const p of P) if (p.playing) setStat(p.i, "hold to arm", "rgba(234,243,230,0.5)");
      }
    }

    function eliminate(p) {
      p.alive = false;
      figures[p.i].root.visible = false;
      aims[p.i].group.visible = false;
      padEl[p.i].style.opacity = "0.34";
      setStat(p.i, "out", "#FF7A3C");
      p.cooking = false;
      sound.sting("lose");
      sound.haptic("heavy");
      const left = P.filter(q => q.playing && q.alive);
      sound.heat(clamp(1 - left.length / Math.max(1, nPlayers - 1), 0.3, 1));
      if (left.length <= 1 && phase === "play") {
        // The moment the round is decided runs at a third speed. It is the
        // one thing everyone at the table is looking at.
        slowT = 1.05;
        ctx.timeout(() => endRound(), 1250);
        phase = "roundend";
      }
    }

    function endRound() {
      const left = P.filter(q => q.playing && q.alive);
      for (const a of aims) a.group.visible = false;
      if (left.length === 1) {
        const w = left[0];
        roundWinner = w.i;
        w.wins++;
        curStreak = lastWinner === w.i ? curStreak + 1 : 1;
        lastWinner = w.i;
        if (curStreak > bestStreak) bestStreak = curStreak;
        banner(PL[w.i].name, "takes the round", PL[w.i].ink, 1500);
        sparks.burst(w.x, 0.30, w.z, 16, 1.5, PL[w.i].body);
        sound.sting("win");
        sound.haptic("heavy");
        ctx.platform.setScore(Math.max.apply(null, P.map(q => q.wins)));
        ctx.platform.milestone("round", { round, winner: PL[w.i].name, streak: curStreak });
      } else {
        roundWinner = -1;
        lastWinner = -1; curStreak = 0;
        banner("Nobody", "everyone went over", "#FF7A3C", 1500);
        sound.sting("fail");
      }
      paintPips();
      const champ = P.find(q => q.playing && q.wins >= settings.target);
      ctx.timeout(() => {
        if (champ) endMatch(champ);
        else beginRound();
      }, 1700);
    }

    async function endMatch(w) {
      phase = "matchend";
      matchWinner = w.i;
      el("over-title").textContent = PL[w.i].name + " wins";
      el("over-title").style.color = PL[w.i].ink;
      el("over-title").style.textShadow = "0 4px 0 rgba(0,0,0,0.55),0 0 46px " + PL[w.i].ink + "70";
      el("over-title2").textContent = PL[w.i].name + " wins";
      el("over-title2").style.color = PL[w.i].ink;
      // A row of clay chips rather than a run-on scoreline: everybody at the
      // table should find their own colour before they read a word.
      el("over-line").innerHTML = P.filter(q => q.playing).map(q =>
        '<div style="width:64px;text-align:center;opacity:' + (q.i === w.i ? "1" : "0.78") + ';">' +
          '<div style="height:38px;border-radius:14px;background:linear-gradient(180deg,' + PL[q.i].lit +
            ',' + PL[q.i].ink + ');box-shadow:0 3px 0 rgba(0,0,0,0.5);display:flex;align-items:center;' +
            'justify-content:center;font-size:19px;font-weight:800;color:rgba(24,13,4,0.92);">' + q.wins + '</div>' +
          '<div style="margin-top:5px;font-size:10px;font-weight:800;letter-spacing:0.1em;' +
            'text-transform:uppercase;color:rgba(234,243,230,0.55);">' + esc(PL[q.i].name) + '</div>' +
        '</div>').join("");
      el("over-streak").textContent = "Longest streak · " + bestStreak +
        (bestStreak === 1 ? " round" : " rounds");
      el("over").style.display = "block";
      sound.sting("success");
      sound.duck(0.5, 500);
      ctx.platform.complete({
        winner: PL[w.i].name, rounds: round, bestStreak,
        scores: P.filter(q => q.playing).map(q => ({ name: PL[q.i].name, wins: q.wins })),
      });
      // The record belongs to the match, not to one of the people sharing the
      // phone: how long anybody managed to hold the yard back-to-back.
      try {
        await ctx.memory.record("longest_streak").submit(bestStreak, {
          label: bestStreak + (bestStreak === 1 ? " round" : " rounds"),
        });
      } catch (_) { /* offline is fine; the match still finished */ }
    }

    /* ===============================================================
     * BOMBS
     * ============================================================= */
    function takeBomb() {
      for (const b of bombPool) if (!b.live) return b;
      return null;
    }

    function spawnBomb(p, dir, fuse) {
      const slot = takeBomb();
      if (!slot) return;
      slot.live = true;
      slot.group.visible = true;
      const b = {
        slot, x: p.x + dir.x * 0.13, y: 0.17, z: p.z + dir.z * 0.13,
        vx: dir.x * THROW_V + p.vx * 0.45, vy: THROW_UP, vz: dir.z * THROW_V + p.vz * 0.45,
        fuse, owner: p.i, grounded: false, spin: rnd() * TAU,
      };
      bombs.push(b);
      return b;
    }

    function dropBombs(list) {
      for (const b of list) {
        b.slot.live = false;
        b.slot.group.visible = false;
        const k = bombs.indexOf(b);
        if (k >= 0) bombs.splice(k, 1);
      }
    }

    let boomNext = 0, blastCount = 0;
    function explode(x, y, z, power) {
      blastCount++;
      const R = BLAST * power;
      // launch every figure in range
      for (const p of P) {
        if (!p.playing || !p.alive) continue;
        const dx = p.x - x, dz = p.z - z;
        const d = Math.hypot(dx, dz, (p.y - y) * 0.7) || 0.0001;
        const t = clamp(1 - d / R, 0, 1);
        if (t <= 0) continue;
        const kb = KB * Math.pow(t, 0.8) * power;
        // A bomb that goes off in your own hands is at your own coordinates, so
        // the outward direction is undefined and the victim used to be popped
        // straight up and land exactly where they started — the least
        // punishing outcome in the game, for the worst mistake in the game.
        const hd = Math.hypot(dx, dz);
        let nx, nz;
        if (hd < 1e-3) { const a = rnd() * TAU; nx = Math.cos(a); nz = Math.sin(a); }
        else { nx = dx / hd; nz = dz / hd; }
        p.vx += nx * kb; p.vz += nz * kb;
        p.vy += 1.25 * t * power + 0.30;
        p.tumble = Math.max(p.tumble, 0.5 + kb * 0.32);
        p.spinX = (rnd() - 0.5) * (6 + kb * 5);
        p.spinZ = (rnd() - 0.5) * (6 + kb * 5);
        // Cooking through a blast throws the live bomb clear of your hands.
        if (p.cooking) { p.cooking = false; p.hasBomb = false; p.reload = RELOAD; }
      }
      // chain reaction
      const chain = [];
      for (const b of bombs) {
        if (Math.hypot(b.x - x, b.z - z, b.y - y) < R * 0.92) chain.push(b);
      }
      // visuals
      const bm = booms[boomNext = (boomNext + 1) % booms.length];
      bm.t = 0; bm.r = R;
      for (const m of bm.shells) {
        m.position.set(x, Math.max(y, 0.08), z);
        m.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
        m.visible = true;
      }
      bm.ring.position.set(x, 0.02, z);
      bm.ring.visible = true;
      flashLight.position.set(x, Math.max(y, 0.12) + 0.2, z);
      flashLight.intensity = 0.85 * power;
      sparks.burst(x, Math.max(y, 0.10), z, 24, 3.0 * power);
      stampScorch(x, z, R);
      shake = Math.min(shake + 0.030 * power, 0.075);
      hitstop = Math.max(hitstop, 0.055);
      sound.duck(0.45, 260);
      sound.sting("danger");
      sound.haptic("heavy");
      if (chain.length) ctx.timeout(() => {
        for (const b of chain) if (bombs.indexOf(b) >= 0) { dropBombs([b]); explode(b.x, b.y, b.z, power); }
      }, 70);
      checkFalls();
    }

    /** Anybody standing on air starts falling. Called after every blast. */
    function checkFalls() {
      for (const p of P) {
        if (!p.playing || !p.alive || p.falling) continue;
        if (p.y <= 0.02 && !onPlatform(p.x, p.z)) startFall(p);
      }
    }
    function startFall(p) {
      p.falling = 1;
      p.tumble = Math.max(p.tumble, 1.2);
      p.spinX = (rnd() - 0.5) * 7;
      p.spinZ = (rnd() - 0.5) * 7;
      p.cooking = false;
      figures[p.i].hold.visible = false;
      aims[p.i].group.visible = false;
      setStat(p.i, "falling", "#FF7A3C");
      sound.sting("fail");
    }

    /* ===============================================================
     * INPUT
     *
     * A pad owns its own pointers. A pointer is bound to a control the
     * instant it lands and keeps it for its whole life — deciding
     * per-move would let a finger sliding across a pad hop from the stick
     * to the bomb button mid-throw. One live pointer per control, so no
     * player can be driven by two hands.
     * ============================================================= */
    for (let i = 0; i < 4; i++) {
      const node = padEl[i];
      const p = P[i];

      ctx.listen(node, "pointerdown", (e) => {
        const G = padGeo(i);
        const lx = e.offsetX, ly = e.offsetY;
        const onBomb = Math.hypot(lx - G.bombCX, ly - G.bombCY) < G.zoneR;
        if (onBomb) {
          if (p.bombPtr !== null) return;
          p.bombPtr = e.pointerId;
          bombEl[i].style.transform = "scale(0.9)";
          if (phase === "seat") readyUp(i);
          else if (phase === "play") startCook(i);
        } else if (lx < G.zoneX) {
          if (p.stickPtr !== null) return;
          p.stickPtr = e.pointerId;
          p.stickOx = lx; p.stickOy = ly;
          p.sx = 0; p.sy = 0;
          knobEl[i].style.transition = "none";
        } else {
          return;
        }
        if (node.setPointerCapture) { try { node.setPointerCapture(e.pointerId); } catch (_) {} }
        e.preventDefault();
        sound.unlock();
      }, { passive: false });

      ctx.listen(node, "pointermove", (e) => {
        if (e.pointerId !== p.stickPtr) return;
        const G = padGeo(i);
        let dx = e.offsetX - p.stickOx, dy = e.offsetY - p.stickOy;
        const d = Math.hypot(dx, dy);
        if (d > G.inputR) { dx = dx / d * G.inputR; dy = dy / d * G.inputR; }
        p.sx = dx / G.inputR; p.sy = dy / G.inputR;
        const k = G.travelR / G.inputR;
        knobEl[i].style.transform =
          "translate(" + (dx * k).toFixed(1) + "px," + (dy * k).toFixed(1) + "px)";
        e.preventDefault();
      }, { passive: false });

      const release = (e) => {
        if (e.pointerId === p.stickPtr) {
          p.stickPtr = null;
          p.sx = 0; p.sy = 0;
          knobEl[i].style.transition = "transform 140ms cubic-bezier(.2,1.5,.4,1)";
          knobEl[i].style.transform = "translate(0px,0px)";
        }
        if (e.pointerId === p.bombPtr) {
          p.bombPtr = null;
          bombEl[i].style.transform = "scale(1)";
          if (phase === "play") releaseCook(i);
        }
      };
      ctx.listen(node, "pointerup", release);
      ctx.listen(node, "pointercancel", release);
    }

    function readyUp(i) {
      const p = P[i];
      if (!p.playing || p.ready) return;
      p.ready = true;
      setStat(i, "ready", PL[i].ink);
      sound.sting("tap");
      sound.haptic("light");
      const n = P.filter(q => q.playing && q.ready).length;
      setSeatCount(n);
      if (n >= nPlayers) ctx.timeout(() => { if (phase === "seat") beginRound(); }, 320);
    }

    function startCook(i) {
      const p = P[i];
      if (!p.alive || p.falling || p.cooking || !p.hasBomb) return;
      p.cooking = true;
      p.fuse = FUSE;
      figures[i].hold.visible = true;
      aims[i].group.visible = true;
      sound.sting("tap");
      sound.haptic("light");
    }

    function releaseCook(i) {
      const p = P[i];
      if (!p.cooking) return;
      p.cooking = false;
      p.hasBomb = false;
      p.reload = RELOAD;
      figures[i].hold.visible = false;
      aims[i].group.visible = false;
      const dir = throwDir(p);
      spawnBomb(p, dir, p.fuse);
      ringEl[i].style.opacity = "0";
      haloEl[i].style.opacity = "0";
      wickEl[i].style.opacity = "0.35";
      sound.sting("powerup");
      sound.haptic("light");
      ctx.platform.interact({ type: "throw", player: PL[i].name });
    }

    /** Aim with the stick if it is pushed, otherwise straight ahead. */
    function throwDir(p) {
      const m = Math.hypot(p.sx, p.sy);
      if (m > 0.22) {
        const w = p.seat.toWorld(p.sx / m, p.sy / m);
        return w;
      }
      return { x: p.face.x, z: p.face.z };
    }

    /* ===============================================================
     * SIMULATION
     * ============================================================= */
    function stepPlayers(dt) {
      for (const p of P) {
        if (!p.playing || !p.alive) continue;

        if (p.falling) {
          p.vy -= GRAV * dt;
          p.y += p.vy * dt;
          p.x += p.vx * dt; p.z += p.vz * dt;
          p.tumble = 1;
          if (p.y < -1.4) eliminate(p);
          continue;
        }

        const airborne = p.y > 0.012;
        const steer = !airborne && p.tumble <= 0 && phase === "play";

        if (steer) {
          const m = Math.hypot(p.sx, p.sy);
          if (m > 0.18) {
            const w = p.seat.toWorld(p.sx / m, p.sy / m);
            const push = MOVE_ACC * Math.min(1, (m - 0.18) / 0.62) * (p.cooking ? 0.72 : 1);
            p.vx += w.x * push * dt;
            p.vz += w.z * push * dt;
            p.face.x = w.x; p.face.z = w.z;
            p.bob += dt * 13;
          } else {
            p.bob *= 0.9;
          }
        }

        // Friction: grippy boots on wood, but a launched body slides like a
        // puck — that long helpless skid toward the edge is the joke.
        const fr = airborne ? 0.995 : (p.tumble > 0 ? 0.975 : 0.860);
        const f = Math.pow(fr, dt * 60);
        p.vx *= f; p.vz *= f;
        const sp = Math.hypot(p.vx, p.vz);
        const cap = p.tumble > 0 ? 5.0 : MAX_SPD;
        if (sp > cap) { p.vx = p.vx / sp * cap; p.vz = p.vz / sp * cap; }

        p.x += p.vx * dt; p.z += p.vz * dt;

        if (airborne || p.vy > 0) {
          p.vy -= GRAV * dt;
          p.y += p.vy * dt;
          if (p.y <= 0) {
            p.y = 0;
            if (Math.abs(p.vy) > 0.9) { p.vy = -p.vy * 0.30; sound.haptic("light"); }
            else p.vy = 0;
            if (!onPlatform(p.x, p.z)) startFall(p);
          }
        }
        if (p.tumble > 0) {
          p.tumble -= dt;
          if (p.tumble <= 0) { p.tumble = 0; p.spinX = p.spinZ = 0; }
        }
        if (!p.falling && p.y <= 0.012 && !onPlatform(p.x, p.z)) startFall(p);

        // bombs in hand keep burning
        if (p.cooking) {
          p.fuse -= dt;
          if (p.fuse <= 0) {
            p.cooking = false;
            p.hasBomb = false;
            p.reload = RELOAD * 1.6;
            figures[p.i].hold.visible = false;
            aims[p.i].group.visible = false;
            explode(p.x, p.y + 0.16, p.z, 1.25);
          }
        } else if (!p.hasBomb) {
          p.reload -= dt;
          if (p.reload <= 0) { p.hasBomb = true; sound.sting("coin"); }
        }
      }

      // figures shove each other around rather than overlapping
      for (let a = 0; a < P.length; a++) {
        const pa = P[a];
        if (!pa.playing || !pa.alive || pa.falling) continue;
        for (let b = a + 1; b < P.length; b++) {
          const pb = P[b];
          if (!pb.playing || !pb.alive || pb.falling) continue;
          const dx = pb.x - pa.x, dz = pb.z - pa.z;
          const d = Math.hypot(dx, dz);
          const min = CHAR_R * 2;
          if (d > min || d < 1e-5) continue;
          const nx = dx / d, nz = dz / d, push = (min - d) * 0.5;
          pa.x -= nx * push; pa.z -= nz * push;
          pb.x += nx * push; pb.z += nz * push;
          const rel = (pb.vx - pa.vx) * nx + (pb.vz - pa.vz) * nz;
          if (rel < 0) {
            pa.vx += nx * rel * 0.5; pa.vz += nz * rel * 0.5;
            pb.vx -= nx * rel * 0.5; pb.vz -= nz * rel * 0.5;
          }
        }
      }
    }

    function stepBombs(dt) {
      const gone = [];
      for (const b of bombs) {
        b.vy -= GRAV * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (b.y <= 0.056) {
          if (onPlatform(b.x, b.z)) {
            b.y = 0.056;
            if (b.vy < -0.35) { b.vy = -b.vy * 0.34; sound.sting("tap"); }
            else { b.vy = 0; b.grounded = true; }
            const f = Math.pow(b.grounded ? 0.90 : 0.97, dt * 60);
            b.vx *= f; b.vz *= f;
          } else if (b.y < -1.6) {
            gone.push(b);                   // fell into the void: no blast
            continue;
          }
        }
        b.fuse -= dt;
        b.spin += dt * 4;
        if (b.fuse <= 0) {
          gone.push(b);
          explode(b.x, b.y, b.z, 1);
        }
      }
      if (gone.length) dropBombs(gone);
    }

    function stepCrumble(dt) {
      if (phase !== "play") return;
      const pace = PACE[settings.pace];
      roundT += dt;
      if (roundT < pace.start) return;
      if (el("warn").style.opacity !== "1") {
        el("warn").style.opacity = "1";
        sound.sting("danger");
        sound.heat(0.8);
      }
      crumbleT += dt;
      while (crumbleT >= pace.step && crumbleLeft.length) {
        crumbleT -= pace.step;
        const next = crumbleLeft.shift();
        const w = wedges.find(q => q.ring === next.ring && q.sector === next.sector && !q.falling);
        if (!w) continue;
        w.falling = 1;
        w.vy = 0.15;
        w.rx = (rnd() - 0.5) * 2.4;
        w.rz = (rnd() - 0.5) * 2.4;
        sectorFrac[next.sector] = RINGS[next.ring][0];
        sparks.burst(
          ARENA_A * Math.cos((next.sector + 0.5) * DPHI) * RINGS[next.ring][0],
          0.02,
          ARENA_B * Math.sin((next.sector + 0.5) * DPHI) * RINGS[next.ring][0],
          5, 0.9, 0xC8913C
        );
        shake = Math.min(shake + 0.010, 0.05);
        sound.sting("tap");
        checkFalls();
        // Any scorch mark that was sitting on that wedge goes with it.
        for (const m of scorchPool) {
          if (m.visible && !onPlatform(m.position.x, m.position.z)) m.visible = false;
        }
      }
    }

    function stepWedges(dt) {
      for (const w of wedges) {
        if (!w.falling) continue;
        w.vy -= GRAV * 0.85 * dt;
        w.group.position.y += w.vy * dt;
        w.group.rotation.x += w.rx * dt;
        w.group.rotation.z += w.rz * dt;
        if (w.group.position.y < -3.2) { w.group.visible = false; w.falling = 2; }
      }
    }

    /* ===============================================================
     * VIEW UPDATE
     * ============================================================= */
    const tmpV = new THREE.Vector3();
    function updateFigures(now) {
      for (const p of P) {
        const F = figures[p.i];
        if (!p.playing || !p.alive) { F.root.visible = false; continue; }
        F.root.visible = true;
        F.root.position.set(p.x, p.y, p.z);
        const fa = Math.atan2(p.face.x, p.face.z);
        F.root.rotation.y = fa;

        if (p.tumble > 0 || p.falling) {
          F.rig.rotation.x += p.spinX * 0.016;
          F.rig.rotation.z += p.spinZ * 0.016;
          F.rig.position.y = 0;
        } else {
          F.rig.rotation.x *= 0.86;
          F.rig.rotation.z *= 0.86;
          const walk = Math.abs(Math.sin(p.bob)) * (Math.hypot(p.vx, p.vz) > 0.12 ? 1 : 0);
          F.rig.position.y = walk * 0.022;
          F.arms[0].position.y = 0.100 + Math.sin(p.bob) * 0.016;
          F.arms[1].position.y = 0.100 - Math.sin(p.bob) * 0.016;
        }
        // Squash on the way up, stretch on the way down — cheap weight.
        const sq = clamp(1 - p.vy * 0.06, 0.86, 1.16);
        F.rig.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
        const grounded = !p.falling && p.y < 0.30;
        F.ring.visible = F.foot.visible = grounded;
        if (grounded) {
          const lift = clamp(1 - p.y * 2.6, 0.25, 1);
          F.ring.material.opacity = (0.55 + Math.sin(now * 0.004 + p.i) * 0.12) * lift;
          F.foot.material.opacity = 0.34 * lift;
          F.ring.position.y = F.foot.position.y - 0.002;
          F.ring.scale.setScalar(1 + p.y * 0.5);
          F.foot.scale.setScalar(1 + p.y * 0.5);
          F.ring.position.y = 0.006 - p.y;
          F.foot.position.y = 0.004 - p.y;
          F.foot.position.x = CHAR_R * (0.5 + p.y * 1.6);
          F.foot.position.z = CHAR_R * (0.22 + p.y * 0.7);
        }

        F.hold.visible = p.cooking;
        if (p.cooking) {
          const t = clamp(p.fuse / FUSE, 0, 1);
          const pulse = 0.85 + Math.sin(now * 0.09) * 0.15;
          F.spark.scale.setScalar(0.022 * pulse * (0.6 + (1 - t) * 0.9));
          F.spark.material.color.setHex(t < 0.24 ? 0xFF4020 : 0xFFF6C0);
        }
      }
    }

    function updateBombs(now) {
      let li = 0;
      for (const b of bombs) {
        const g = b.slot.group;
        g.position.set(b.x, b.y, b.z);
        g.rotation.y = b.spin;
        const t = clamp(b.fuse / FUSE, 0, 1);
        const danger = t < 0.24;
        b.slot.ball.material = danger && (Math.floor(now / 90) % 2 === 0) ? bombMatHot : bombMatBase;
        const pulse = 0.8 + Math.sin(now * (danger ? 0.16 : 0.09)) * 0.2;
        b.slot.flame.scale.setScalar(0.026 * pulse * (0.7 + (1 - t) * 0.8));
        b.slot.flame.material = flameMat;
        if (li < bombLights.length) {
          bombLights[li].position.set(b.x, b.y + 0.09, b.z);
          bombLights[li].intensity = 0.055 + (1 - t) * 0.10;
          bombLights[li].color.setHex(danger ? 0xFF5020 : 0xFFA030);
          li++;
        }
        if (rnd() < 0.22) sparks.burst(b.x + 0.03, b.y + 0.10, b.z, 1, 0.35);
      }
      for (; li < bombLights.length; li++) bombLights[li].intensity = 0;
    }

    function updateAims() {
      for (const p of P) {
        const A = aims[p.i];
        if (!p.cooking || !p.alive) { A.group.visible = false; continue; }
        A.group.visible = true;
        const dir = throwDir(p);
        let x = p.x + dir.x * 0.13, y = 0.17, z = p.z + dir.z * 0.13;
        let vx = dir.x * THROW_V + p.vx * 0.45, vy = THROW_UP, vz = dir.z * THROW_V + p.vz * 0.45;
        const h = 0.045;
        let k = 0, land = null;
        for (let s = 0; s < 44 && k < A.dots.length; s++) {
          vy -= GRAV * h;
          x += vx * h; y += vy * h; z += vz * h;
          if (y <= 0.06) { land = { x, z }; break; }
          if (s % 3 === 0) { A.dots[k].position.set(x, y, z); A.dots[k].visible = true; k++; }
        }
        for (; k < A.dots.length; k++) A.dots[k].visible = false;
        if (land) {
          A.ring.position.set(land.x, 0.012, land.z);
          A.ring.visible = true;
          const safe = onPlatform(land.x, land.z);
          A.ring.material.color.setHex(safe ? PL[p.i].body : 0xFF3B20);
        } else A.ring.visible = false;
      }
    }

    function updatePads(now) {
      for (let i = 0; i < 4; i++) {
        const p = P[i];
        if (!p.playing) continue;
        if (p.cooking) {
          const t = clamp(1 - p.fuse / FUSE, 0, 1);
          ringEl[i].style.opacity = "1";
          ringEl[i].style.background = "conic-gradient(" +
            (p.fuse < 0.75 ? "#FF4020" : HOT) + " " + (t * 360).toFixed(0) + "deg," + TRACK + " 0deg)";
          wickEl[i].style.opacity = "1";
          haloEl[i].style.opacity = p.fuse < 0.9
            ? String(0.5 + Math.sin(now * 0.05) * 0.5) : "0";
          setStat(i, p.fuse.toFixed(1) + "s", p.fuse < 0.75 ? "#FF4020" : HOT);
          statEl[i].style.fontFamily = MONO;
        } else {
          // Back to a bare track ring rather than nothing, so the button
          // keeps a defined outer edge between throws instead of the gauge
          // blinking in and out of existence.
          if (ringEl[i].style.opacity !== "0.34") {
            ringEl[i].style.opacity = "0.34";
            ringEl[i].style.background = TRACK;
          }
          if (haloEl[i].style.opacity !== "0") haloEl[i].style.opacity = "0";
          if (wickEl[i].style.opacity !== "0.35") wickEl[i].style.opacity = "0.35";
          statEl[i].style.fontFamily = "inherit";
          if (phase === "play" && p.alive && !p.falling) {
            if (!p.hasBomb) setStat(i, "reloading", "rgba(234,243,230,0.35)");
            else setStat(i, "hold to arm", "rgba(234,243,230,0.5)");
          }
        }
        bombEl[i].style.filter = "";
        bombEl[i].style.opacity = p.hasBomb || p.cooking ? "1" : "0.42";
      }
    }

    /* ===============================================================
     * FRAME
     * ============================================================= */
    let frames = 0;
    function renderFrame(dtMs) {
      frames++;
      const now = performance.now();
      const raw = Math.min(dtMs, 50) / 1000;

      if (slowT > 0) { slowT -= raw; timeScale = 0.32; }
      else timeScale = 1;

      let dt = raw * timeScale;
      if (hitstop > 0) { hitstop -= raw; dt = 0; }

      if (phase === "play" || phase === "roundend" || phase === "countdown") {
        stepPlayers(dt);
        stepBombs(dt);
        stepCrumble(dt);
      }
      stepWedges(dt);
      sparks.step(dt);

      // explosions
      for (const bm of booms) {
        if (!bm.shells[0].visible) continue;
        bm.t += dt;
        const u = bm.t / bm.dur;
        if (u >= 1) {
          for (const m of bm.shells) m.visible = false;
          bm.ring.visible = false;
          continue;
        }
        const e = 1 - Math.pow(1 - u, 3);
        for (let k = 0; k < 3; k++) {
          const m = bm.shells[k];
          const uk = clamp(u * (1 + k * 0.7), 0, 1.2);       // inner shells burn out first
          m.scale.setScalar(bm.r * SHELL_R[k] * (0.22 + e * 0.72));
          m.material.opacity = uk >= 1 ? 0
            : (k === 0 ? 0.90 : 1) * (uk < 0.22 ? 1 : 1 - (uk - 0.22) / 0.78);
          m.visible = m.material.opacity > 0.01;
          // Orange outside, yellow through the middle, white at the heart —
          // the ramp that makes a still frame read as fire rather than as a
          // pale blob.
          m.material.color.setHex(
            k === 2 ? (uk < 0.50 ? 0xFFFFFF : 0xFFF6C0)
          : k === 1 ? (uk < 0.14 ? 0xFFFFFF : uk < 0.52 ? 0xFFF074 : 0xFEAD3D)
          :           (uk < 0.10 ? 0xFFF074 : uk < 0.42 ? 0xFD8B1E : 0x8C3A15));
          m.rotation.y += dt * (1.2 + k * 0.6);
        }
        bm.shells[0].visible = true;                          // drives the pool slot
        bm.ring.scale.setScalar(bm.r * (0.5 + e * 1.05));
        bm.ring.material.opacity = Math.max(0, 0.9 - u * 1.7);
      }
      flashLight.intensity *= Math.pow(0.0006, raw);

      if (bannerT > 0) {
        bannerT -= raw;
        if (bannerT <= 0) el("banner").style.opacity = "0";
      }

      updateFigures(now);
      updateBombs(now);
      updateAims();
      updatePads(now);

      // camera shake, decaying, applied to the camera rather than the world
      if (shake > 0.0004) {
        shake *= Math.pow(0.0022, raw);
        shakeV.x = (rnd() - 0.5) * shake * camDist;
        shakeV.y = (rnd() - 0.5) * shake * camDist;
        placeCamera();
      } else if (shakeV.x !== 0 || shakeV.y !== 0) {
        shakeV.x = shakeV.y = 0;
        placeCamera();
      }

      renderer.render(scene, camera);
    }

    ctx.onFrame(renderFrame);

    /* --- resize --- */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      applyLayout();
      renderer.setSize(ctx.width, ctx.height, false);
      fitCamera();
    });

    /* ===============================================================
     * BOOT
     * ============================================================= */
    applyLayout();
    buildArena();
    buildRocks();
    fitCamera();
    paintSettings();
    for (let i = 0; i < 4; i++) padEl[i].style.display = "none";

    /* A read-only window onto the simulation so the local harness can drive
     * four real fingers and assert where everybody ended up. It exposes
     * nothing the bit is not already drawing. */
    window.__BLAST__ = {
      get phase() { return phase; },
      get busy() { return busy(); },
      get round() { return round; },
      get n() { return nPlayers; },
      get bestStreak() { return bestStreak; },
      get frames() { return frames; },
      get camDist() { return camDist; },
      get blasts() { return blastCount; },
      get roundWinner() { return roundWinner; },
      get matchWinner() { return matchWinner; },
      get target() { return settings.target; },
      players: () => P.filter(p => p.playing).map(p => ({
        i: p.i, name: PL[p.i].name, x: +p.x.toFixed(3), z: +p.z.toFixed(3), y: +p.y.toFixed(3),
        alive: p.alive, falling: !!p.falling, wins: p.wins, cooking: p.cooking,
        fuse: +p.fuse.toFixed(2), ready: p.ready,
      })),
      bombs: () => bombs.length,
      arena: () => ({ a: ARENA_A, b: ARENA_B, rect: L.arena, frac: Array.from(sectorFrac) }),
      /** Screen coordinates of anything a finger needs to find. */
      hit: (what, i) => {
        if (what === "count") return { x: Math.round(W / 2 + (i - 3) * 88), y: Math.round(H * 0.552) + 34 };
        if (what === "stick") { const G = padGeo(i); return padToScreen(i, G.stickCX, G.stickCY); }
        if (what === "bomb") { const G = padGeo(i); return padToScreen(i, G.bombCX, G.bombCY); }
        if (what === "stickPush") {
          // full deflection straight "toward me" — the gesture that walks a
          // figure off its own edge
          const G = padGeo(i);
          return padToScreen(i, G.stickCX, G.stickCY + G.inputR * 1.3);
        }
        if (what === "stickAway") {
          const G = padGeo(i);
          return padToScreen(i, G.stickCX, G.stickCY - G.inputR * 1.3);
        }
        if (what === "rounds") return { x: cardX() + 14 + i * (Math.floor((CARD_W - 28 - 16) / 3) + 8) + 43, y: cardY() + 106 };
        if (what === "pace") return { x: cardX() + 14 + i * (Math.floor((CARD_W - 28 - 16) / 3) + 8) + 43, y: cardY() + 204 };
        if (what === "cog") return { x: chromeBox.x + 34 + 7 + 17, y: chromeBox.y + 17 };
        if (what === "help") return { x: chromeBox.x + (34 + 7) * 2 + 17, y: chromeBox.y + 17 };
        if (what === "mute") return { x: chromeBox.x + 17, y: chromeBox.y + 17 };
        if (what === "helpClose") return { x: W / 2, y: Math.round(H / 2 + HELP_H / 2 - 41) };
        if (what === "cogClose") return { x: W / 2, y: cardY() + 343 };
        if (what === "skip") return { x: W / 2, y: H / 2 + 117 };
        if (what === "again") return { x: W / 2, y: H / 2 + 96 };
        return { x: W / 2, y: H / 2 };
      },
    };
    ctx.onDestroy(() => { try { delete window.__BLAST__; } catch (_) {} });

    // Draw before telling the host we are up, so the bit never flashes blank.
    renderFrame(0);
    ctx.markVisualReady("yard drawn");
    ctx.platform.ready();
  },
};
