/**
 * Othello — two players, one phone, real discs that physically turn over.
 *
 * The phone lies flat on the table between two people. Othello is a game of
 * perfect information, so there is nothing to hide and no pass-the-phone beat
 * to engineer: both players watch the same board for all sixty moves. What the
 * shared screen actually has to solve is *orientation* — the board itself
 * carries no text, so it never rotates, while the two HUD strips are mirror
 * copies of one draw so the player at the far edge reads their own score the
 * right way up.
 *
 * This one is 3D for exactly one reason: the cascade. Othello's whole pleasure
 * is a line of discs turning over one after another, and a colour swap does not
 * deliver it. Every disc here is a lathe-turned solid with a real ivory side
 * wall, and a capture rotates it a full half-turn about the axis perpendicular
 * to the line it was captured along — so it lifts, shows its cream edge as it
 * passes through vertical, and lands on the other face. Captures are staggered
 * by their Chebyshev ring from the placed disc, which makes a twelve-disc take
 * ripple outward as a wave instead of blinking.
 *
 * The camera is directly overhead. Two people are playing each other across
 * this board; any tilt hands one of them a larger, nearer half. Depth comes
 * from real geometry instead — a bevelled moulded rim, discs standing proud of
 * a recessed felt well, and genuine contact shadows from a fixed upper-left key.
 *
 * Placing is two-stage by default: tap a legal cell to arm a translucent ghost
 * and light up every disc that would flip, then confirm. A mis-tap therefore
 * costs nothing on a board where a mis-tap is otherwise unrecoverable, and the
 * preview teaches the bracketing rule to anyone who has not played before.
 * There is a confirm button at *each* end and either one commits, so nobody
 * ever has to reach across the table.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so the felt,
 * its fibres, the incised grid, the star dots and the engraved wordmark are all
 * painted into an OffscreenCanvas at boot and uploaded as textures — with a
 * flat-colour fallback for WebViews that have no OffscreenCanvas. The overlay
 * is one markup string on ctx.createRoot() rather than document.createElement,
 * and pointer maths uses offsetX/offsetY rather than getBoundingClientRect;
 * both of those are rejected at upload and neither is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Othello",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "board", "strategy", "two-player"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {

    /* A drawn speaker rather than the emoji. Colour-emoji glyphs land as a
     * blue-and-white blob beside otherwise monochrome chrome, they ignore the
     * button's own colour, and they are the one thing on screen that is not
     * set in the game's typeface. currentColor keeps this one in step. */
    const SPK = (on) =>
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
        'style="display:block;margin:0 auto;overflow:visible;" aria-hidden="true">' +
        '<path d="M4 9.4h3.5L12.2 5.4v13.2L7.5 14.6H4z" fill="currentColor" stroke="none"/>' +
        (on ? '<path d="M15.8 9.2a4 4 0 0 1 0 5.6"/><path d="M18.4 6.6a7.7 7.7 0 0 1 0 10.8"/>'
            : '<path d="M16.2 9.6l5 4.8M21.2 9.6l-5 4.8"/>') +
      '</svg>';

    /* Every game in this set is set in lowercase Inter. Canvas text comes from
     * a few hundred call sites, so the case change goes in at the one place
     * they all pass through rather than at each of them. Single characters are
     * left alone — card ranks and piece letters are symbols, not words, and
     * "k" on a king reads as a bug. measureText is patched to match, or
     * centred text would be measured at its uppercase width and drift off
     * its own anchor. */
    for (const Proto of [globalThis.CanvasRenderingContext2D,
                         globalThis.OffscreenCanvasRenderingContext2D]) {
      if (!Proto || Proto.prototype.__lcText) continue;
      Proto.prototype.__lcText = true;
      for (const method of ["fillText", "strokeText", "measureText"]) {
        const original = Proto.prototype[method];
        if (!original) continue;
        Proto.prototype[method] = function (text, ...rest) {
          const t = typeof text === "string" && text.length > 1 ? text.toLowerCase() : text;
          return original.call(this, t, ...rest);
        };
      }
    }
    // Inter, from the Plethora font registry, in the three weights it serves.
    // The calls are fire-and-forget with literal arguments: a font is a
    // nicety and the first frame must never wait on one, and the upload
    // validator only accepts loader arguments that are direct literals.
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }); } catch (_) {}
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" }); } catch (_) {}
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "700" }); } catch (_) {}
    const THREE = await ctx.importModule("three", "0.164.1");

    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* =================================================================
     * RULES — strict World Othello Federation play.
     *
     * The board is a flat 64-array, index = row * 8 + col, row 0 at the
     * top of the screen. That makes index 0 = a1 in Othello notation
     * (which, unlike chess, numbers downward from the top-left).
     * ============================================================= */
    const EMPTY = 0, BLACK = 1, WHITE = 2;
    const other = (p) => (p === BLACK ? WHITE : BLACK);
    const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    const CORNERS = [0, 7, 56, 63];
    const cellName = (i) => "abcdefgh"[i & 7] + ((i >> 3) + 1);

    let board = new Uint8Array(64);

    function freshBoard() {
      const b = new Uint8Array(64);
      // d4/e5 White, e4/d5 Black — the standard diagonal, Black to move.
      b[3 * 8 + 3] = WHITE; b[4 * 8 + 4] = WHITE;
      b[3 * 8 + 4] = BLACK; b[4 * 8 + 3] = BLACK;
      return b;
    }

    /**
     * Every disc this move would outflank, or null if the move is illegal.
     *
     * A direction captures when the adjacent cell starts an unbroken run of
     * opposing discs that is terminated by one of the mover's own. A run that
     * runs off the edge, or hits an empty cell, or is empty to begin with,
     * captures nothing. Runs are collected from the pre-move board, so all
     * eight directions resolve simultaneously and flips never chain.
     */
    function capturesAt(b, idx, me) {
      if (b[idx] !== EMPTY) return null;
      const r = idx >> 3, c = idx & 7, you = other(me);
      let out = null;
      for (const [dr, dc] of DIRS) {
        let i = r + dr, j = c + dc;
        let run = null;
        while (i >= 0 && i < 8 && j >= 0 && j < 8 && b[i * 8 + j] === you) {
          (run || (run = [])).push(i * 8 + j);
          i += dr; j += dc;
        }
        if (run && i >= 0 && i < 8 && j >= 0 && j < 8 && b[i * 8 + j] === me) {
          (out || (out = [])).push(...run);
        }
      }
      return out;
    }

    /** Map of index -> captured indices for every legal move. */
    function legalMoves(b, me) {
      const m = new Map();
      for (let i = 0; i < 64; i++) {
        const f = capturesAt(b, i, me);
        if (f) m.set(i, f);
      }
      return m;
    }

    function tally(b) {
      let black = 0, white = 0;
      for (let i = 0; i < 64; i++) {
        if (b[i] === BLACK) black++;
        else if (b[i] === WHITE) white++;
      }
      return { black, white, empty: 64 - black - white };
    }

    /* =================================================================
     * PLAYERS. Identity is carried by the literal disc colour; brass is
     * the single "it is your move" accent, because an onyx glow on a dark
     * panel is no glow at all.
     * ============================================================= */
    const BRASS = "#E3B23C";
    const RIMC = "#D8C9A0";                        // the discs' ivory side wall
    const P = {
      [BLACK]: {
        key: "b", name: "Black",
        // Legal-move markers are a ring in the mover's own colour with a
        // counter-coloured halo behind it, so onyx reads on green felt and
        // ivory reads on green felt without either needing a second hue.
        ring: 0x0e100e, halo: 0xf4f2ea, haloA: 0.30,
        swatch: "radial-gradient(circle at 34% 30%,#55564f,#171814 64%)",
      },
      [WHITE]: {
        key: "w", name: "White",
        ring: 0xfffdf6, halo: 0x0b0d0b, haloA: 0.34,
        swatch: "radial-gradient(circle at 34% 30%,#ffffff,#e4dfcd 72%)",
      },
    };

    /* =================================================================
     * SETTINGS, remembered between sessions.
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("othello") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      mute: !!saved.mute,
      confirm: saved.confirm === undefined ? true : !!saved.confirm,
      hints: saved.hints === undefined ? true : !!saved.hints,
    };
    function saveSettings() { try { ctx.storage.set("othello", settings); } catch (_) {} }

    /* =================================================================
     * SOUND. A low, unhurried bed whose intensity tracks how full the
     * board is, so the last ten moves feel tighter than the first ten.
     * Every call is wrapped: audio is a nicety and must never break play.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "cozy", volume: 0.20, tempo: 76, intensity: 0.14 });
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
          muted = !muted; settings.mute = muted; saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 260 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* =================================================================
     * LAYOUT.
     *
     * One cell is one world unit, so the felt spans -4..4 and the moulded
     * rim sits outside it. The screen size of a cell is solved from the
     * width the whole board object has to occupy, then the camera is
     * placed to match — which makes the felt plane project linearly and
     * removes any need to raycast a tap.
     * ============================================================= */
    const RIM = 0.46;          // rim width, world units
    const RIMH = 0.24;         // rim height above the felt
    const BASE = 0.30;         // board body below the felt
    const OUTER = 4 + RIM;
    const SPAN = 8 + 2 * RIM;
    const FOV = 58;

    const SAFE_T = ctx.safeArea.top, SAFE_B = ctx.safeArea.bottom;
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      L.unit = Math.min((W - 14) / SPAN, (H - SAFE_T - SAFE_B) * 0.54 / SPAN);
      L.board = L.unit * 8;
      L.bx = (W - L.board) / 2;
      L.by = (H - L.board) / 2;                 // board is centred: the camera is
      // The moulded rim stands outside the felt, so a strip measured from the
      // felt would sit on top of it. Both strips stop at the board's real edge.
      L.strip = Math.max(96, L.by - RIM * L.unit - 6);
    }
    measure();

    /** Screen pixels to a board index, or -1 outside the felt. */
    function pickCell(px, py) {
      const c = Math.floor((px - L.bx) / L.unit);
      const r = Math.floor((py - L.by) / L.unit);
      if (r < 0 || r > 7 || c < 0 || c > 7) return -1;
      return r * 8 + c;
    }
    /** Board index to its world centre on the felt. Row 0 is at the top (-z). */
    const worldX = (i) => ((i & 7) - 3.5);
    const worldZ = (i) => ((i >> 3) - 3.5);
    /** Board index to the screen point a finger should aim at. */
    const cellXY = (i) => ({
      x: L.bx + ((i & 7) + 0.5) * L.unit,
      y: L.by + ((i >> 3) + 0.5) * L.unit,
    });

    /* =================================================================
     * TEXTURES. There are no packaged assets, so every surface is painted
     * into an OffscreenCanvas once at boot. document.createElement is
     * rejected at upload; OffscreenCanvas is the accepted way to get a
     * drawing surface the runtime does not mount. A WebView without it
     * falls back to flat colour — plainer, fully playable, never blank.
     * ============================================================= */
    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      return new OffscreenCanvas(w, h);
    }
    /** Deterministic hash noise, so the felt is identical every boot. */
    function hash(n) {
      const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    }

    /**
     * The felt: a deep green radial lit from upper-left, a fine two-tone
     * speckle, short fibres, an incised grid with a highlight lip, and the
     * four star dots two squares in from each corner.
     */
    function makeFeltTexture() {
      const T = 1024;
      const c = surface(T, T);
      if (!c) return null;
      const g = c.getContext("2d");

      const rg = g.createRadialGradient(T * 0.42, T * 0.34, T * 0.05, T * 0.5, T * 0.5, T * 0.78);
      rg.addColorStop(0.00, "#35855F");
      rg.addColorStop(0.55, "#276F52");
      rg.addColorStop(1.00, "#163F30");
      g.fillStyle = rg;
      g.fillRect(0, 0, T, T);

      // Speckle. Two tones at very low alpha is what stops a flat green
      // plane from reading as a swatch under a directional light.
      for (let i = 0; i < 3400; i++) {
        g.fillStyle = (i & 1) ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
        g.fillRect(hash(i) * T, hash(i + 9000) * T, 1.8, 1.8);
      }
      g.lineWidth = 0.8;
      for (let i = 0; i < 950; i++) {
        const x = hash(i + 2e4) * T, y = hash(i + 3e4) * T;
        const a = hash(i + 4e4) * TAU, len = 2 + hash(i + 5e4) * 4;
        g.strokeStyle = (i & 1) ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.05)";
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }

      // Incised grid: a dark groove with a hairline highlight below and to
      // the right of it, which is what an engraved line looks like when the
      // key light is fixed at the upper left.
      const S = T / 8;
      for (let pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? "rgba(255,255,255,0.055)" : "#10382A";
        g.lineWidth = pass ? 1.6 : 2.6;
        const o = pass ? 1.6 : 0;
        for (let i = 0; i <= 8; i++) {
          const p = clamp(i * S, 1.6, T - 1.6);
          g.beginPath(); g.moveTo(p + o, 0); g.lineTo(p + o, T); g.stroke();
          g.beginPath(); g.moveTo(0, p + o); g.lineTo(T, p + o); g.stroke();
        }
      }

      // Star dots, two squares in from each corner.
      for (const [i, j] of [[2, 2], [2, 6], [6, 2], [6, 6]]) {
        const x = i * S, y = j * S, r = S * 0.09;
        g.fillStyle = "#0C2C20";
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.strokeStyle = "rgba(255,255,255,0.09)";
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(x, y, r * 0.86, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      }
      return c;
    }

    /** The engraved OTHELLO wordmark for the rim, drawn twice for intaglio. */
    function makeWordmarkTexture() {
      const TW = 512, TH = 96;
      const c = surface(TW, TH);
      if (!c) return null;
      const g = c.getContext("2d");
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "600 46px Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
      const draw = (dy, fill) => {
        g.fillStyle = fill;
        let x = TW / 2 - 128;
        for (const ch of "OTHELLO") { g.fillText(ch, x, TH / 2 + dy); x += 42; }
      };
      draw(2.5, "rgba(255,255,255,0.16)");
      draw(0, "rgba(0,0,0,0.72)");
      return c;
    }

    /** A soft pool of light on the table, so the board sits in something. */
    function makeTableTexture() {
      const T = 256;
      const c = surface(T, T);
      if (!c) return null;
      const g = c.getContext("2d");
      g.fillStyle = "#101516";
      g.fillRect(0, 0, T, T);
      const rg = g.createRadialGradient(T * 0.44, T * 0.40, T * 0.02, T * 0.5, T * 0.5, T * 0.52);
      rg.addColorStop(0.0, "#2E3937");
      rg.addColorStop(0.55, "#1D2426");
      rg.addColorStop(1.0, "#0A0D0E");
      g.fillStyle = rg;
      g.fillRect(0, 0, T, T);
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = (i & 1) ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.05)";
        g.fillRect(hash(i + 7e4) * T, hash(i + 8e4) * T, 1.4, 1.4);
      }
      return c;
    }

    /* =================================================================
     * SCENE
     * ============================================================= */
    const glCanvas = ctx.createCanvas({ touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.dpr, 2));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    ctx.onDestroy(() => renderer.dispose());

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d0e);

    const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.5, 120);
    camera.up.set(0, 0, -1);                    // screen-up is -z
    function placeCamera() {
      camera.aspect = W / H;
      // The fov is vertical and the screen is portrait, so the horizontal
      // extent is the binding one: solve the distance from the world width
      // the screen has to cover, or the board will not fill it.
      const halfWidthWorld = 4 * (W / L.board);
      const t = Math.tan((FOV / 2) * Math.PI / 180);
      camera.position.set(0, halfWidthWorld / (t * camera.aspect), 0);
      camera.lookAt(0, 0, 0);
      camera.up.set(0, 0, -1);
      camera.updateProjectionMatrix();
    }
    placeCamera();

    function tex(canvas, srgb) {
      if (!canvas) return null;
      const t = new THREE.CanvasTexture(canvas);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      ctx.onDestroy(() => t.dispose());
      return t;
    }

    /* --- table --- */
    const tableTex = tex(makeTableTexture(), true);
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({
        color: tableTex ? 0xffffff : 0x14181a, map: tableTex || null,
        roughness: 0.92, metalness: 0.05,
      })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -BASE - 0.02;
    table.receiveShadow = true;
    scene.add(table);

    /* --- board body and moulded rim ---
     * The rim is one extruded shape with a hole in it, bevelled on both
     * the outer and inner contours. That is the whole visual grammar the
     * reference sets use: injection-moulded plastic with a small fillet on
     * every edge, nothing razor-sharp.
     */
    function roundedRectShape(half, r) {
      const s = new THREE.Shape();
      s.moveTo(-half + r, -half);
      s.lineTo(half - r, -half);
      s.quadraticCurveTo(half, -half, half, -half + r);
      s.lineTo(half, half - r);
      s.quadraticCurveTo(half, half, half - r, half);
      s.lineTo(-half + r, half);
      s.quadraticCurveTo(-half, half, -half, half - r);
      s.lineTo(-half, -half + r);
      s.quadraticCurveTo(-half, -half, -half + r, -half);
      return s;
    }
    function roundedRectPath(half, r) {
      const p = new THREE.Path();
      p.moveTo(-half + r, -half);
      p.lineTo(half - r, -half);
      p.quadraticCurveTo(half, -half, half, -half + r);
      p.lineTo(half, half - r);
      p.quadraticCurveTo(half, half, half - r, half);
      p.lineTo(-half + r, half);
      p.quadraticCurveTo(-half, half, -half, half - r);
      p.lineTo(-half, -half + r);
      p.quadraticCurveTo(-half, -half, -half + r, -half);
      return p;
    }

    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0x1c2226, roughness: 0.30, metalness: 0.58,
      clearcoat: 0.65, clearcoatRoughness: 0.10,
    });

    const boardGroup = new THREE.Group();
    scene.add(boardGroup);

    const BEV = 0.045;
    const rimShape = roundedRectShape(OUTER, 0.34);
    rimShape.holes.push(roundedRectPath(3.97, 0.09));
    const rimMesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(rimShape, {
        depth: RIMH - 2 * BEV, bevelEnabled: true, bevelThickness: BEV,
        bevelSize: BEV, bevelSegments: 2, curveSegments: 6, steps: 1,
      }),
      shellMat
    );
    rimMesh.rotation.x = -Math.PI / 2;
    rimMesh.position.y = BEV;
    rimMesh.castShadow = true;
    rimMesh.receiveShadow = true;
    boardGroup.add(rimMesh);

    const bodyMesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(roundedRectShape(OUTER, 0.34), {
        depth: BASE, bevelEnabled: false, curveSegments: 6, steps: 1,
      }),
      shellMat
    );
    bodyMesh.rotation.x = -Math.PI / 2;
    bodyMesh.position.y = -BASE;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    boardGroup.add(bodyMesh);

    /* --- felt ---
     * A dark floor sits a hair under the felt: the rim's bevel opens the well
     * by a fraction of a unit more than the felt covers, and without this the
     * lit body slab shows through as a bright seam at the corners.
     */
    const wellFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(8.7, 8.7),
      new THREE.MeshStandardMaterial({ color: 0x10281e, roughness: 0.96, metalness: 0.0 })
    );
    wellFloor.rotation.x = -Math.PI / 2;
    wellFloor.position.y = 0.0015;
    wellFloor.receiveShadow = true;
    boardGroup.add(wellFloor);

    const feltTex = tex(makeFeltTexture(), true);
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({
        color: feltTex ? 0xffffff : 0x276f52, map: feltTex || null,
        roughness: 0.95, metalness: 0.0,
      })
    );
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = 0.004;
    felt.receiveShadow = true;
    boardGroup.add(felt);

    /* --- brass hinge plaques, on the side rails where a folding board
     *     carries them --- */
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xc9a227, roughness: 0.28, metalness: 0.92,
    });
    for (const sx of [-1, 1]) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(RIM * 0.5, 0.03, 0.78), brassMat);
      pl.position.set(sx * (4 + RIM / 2), RIMH - 0.005, 0);
      pl.castShadow = true;
      boardGroup.add(pl);
    }

    /* --- engraved wordmark, once at each end so both players read it the
     *     right way up --- */
    const wordTex = tex(makeWordmarkTexture(), true);
    if (wordTex) {
      const wordMat = new THREE.MeshBasicMaterial({
        map: wordTex, transparent: true, depthWrite: false, opacity: 0.95,
      });
      for (const sz of [-1, 1]) {
        const wm = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.45), wordMat);
        wm.position.set(0, RIMH + 0.002, sz * (4 + RIM / 2));
        wm.rotation.set(-Math.PI / 2, 0, sz > 0 ? 0 : Math.PI);
        boardGroup.add(wm);
      }
    }

    /* --- lights ---
     * Fixed key at the upper left, which is what every gradient in the
     * baked art assumes, plus a cool fill so the rim never goes to pure
     * black and a low bounce off the felt.
     */
    scene.add(new THREE.AmbientLight(0xd8e4e0, 0.34));
    scene.add(new THREE.HemisphereLight(0xcfe0e6, 0x0d1512, 0.34));
    const key = new THREE.DirectionalLight(0xfff6e6, 2.35);
    key.position.set(-6.2, 8.2, -7.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -5.4;
    key.shadow.camera.right = 5.4;
    key.shadow.camera.top = 5.4;
    key.shadow.camera.bottom = -5.4;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.010;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa8c8d6, 0.55);
    fill.position.set(7.0, 5.0, 7.5);
    scene.add(fill);

    /* =================================================================
     * THE DISC.
     *
     * A lathe-turned profile: flat face, a small chamfer, the cylindrical
     * ivory side wall, chamfer, flat face. Every disc on the board shares
     * this one geometry and its three materials, so a full board is
     * sixty-four meshes and three shaders.
     *
     * A disc showing Black sits at identity; a disc showing White is the
     * same mesh turned over. There is no colour state on a mesh at all, so
     * a capture is not a colour swap with an animation on top — it is
     * literally the disc rotating, and where it settles is wherever the
     * rotation left it.
     * ============================================================= */
    const D_R = 0.40, D_H = 0.20, D_C = 0.034, D_SEG = 32;
    const DISC_Y = D_H / 2 + 0.006;

    const discGeo = (function () {
      // The profile is built bottom-to-top on purpose. LatheGeometry winds its
      // faces assuming an ascending profile; a descending one turns the solid
      // inside out, and back-face culling then hides the face you are looking
      // at and shows you the other one straight through it — a disc that reads
      // as exactly the wrong colour with no error anywhere.
      const prof = [];
      const FLAT = 2;
      for (let i = 0; i <= FLAT; i++) prof.push(new THREE.Vector2((D_R - D_C) * (i / FLAT), -D_H / 2));
      for (let i = 1; i <= 3; i++) {                      // bottom chamfer, 90deg -> 0deg
        const a = (Math.PI / 2) * (1 - i / 3);
        prof.push(new THREE.Vector2(D_R - D_C + D_C * Math.cos(a), -(D_H / 2 - D_C) - D_C * Math.sin(a)));
      }
      const wallBand = prof.length - 1;                   // the one cylindrical band
      prof.push(new THREE.Vector2(D_R, D_H / 2 - D_C));
      for (let i = 1; i <= 3; i++) {                      // top chamfer, 0deg -> 90deg
        const a = (Math.PI / 2) * (i / 3);
        prof.push(new THREE.Vector2(D_R - D_C + D_C * Math.cos(a), D_H / 2 - D_C + D_C * Math.sin(a)));
      }
      for (let i = FLAT - 1; i >= 0; i--) prof.push(new THREE.Vector2((D_R - D_C) * (i / FLAT), D_H / 2));

      // LatheGeometry emits one group, so the index buffer is re-sorted into
      // three contiguous runs — bottom face, side wall, top face — and given
      // three materials. That buys the ivory rim as real geometry with its own
      // roughness, and the rim is the single detail that makes a half-turn
      // legible from directly overhead.
      const geo = new THREE.LatheGeometry(prof, D_SEG);
      const n = prof.length;
      const src = geo.getIndex().array;
      const bot = [], wall = [], top = [];
      for (let t = 0; t < src.length; t += 3) {
        const j = Math.min(src[t] % n, src[t + 1] % n, src[t + 2] % n);
        const dst = j < wallBand ? bot : (j === wallBand ? wall : top);
        dst.push(src[t], src[t + 1], src[t + 2]);
      }
      geo.setIndex(bot.concat(wall, top));
      geo.clearGroups();
      geo.addGroup(0, bot.length, 0);
      geo.addGroup(bot.length, wall.length, 1);
      geo.addGroup(bot.length + wall.length, top.length, 2);
      ctx.onDestroy(() => geo.dispose());
      return geo;
    })();

    const faceBlackMat = new THREE.MeshPhysicalMaterial({
      color: 0x25261f, roughness: 0.26, metalness: 0.0,
      clearcoat: 1.0, clearcoatRoughness: 0.07, emissive: 0x0d0f0c, emissiveIntensity: 1,
    });
    const faceWhiteMat = new THREE.MeshPhysicalMaterial({
      color: 0xfffdf4, roughness: 0.32, metalness: 0.0,
      clearcoat: 0.7, clearcoatRoughness: 0.14, emissive: 0x2b2a24, emissiveIntensity: 1,
    });
    // The side wall is what sells a flip, and from directly overhead it is only
    // ever a grazing sliver, so it carries its own light rather than waiting for
    // the key to reach a vertical surface.
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xEDDFBA, roughness: 0.50, metalness: 0.03, emissive: 0x5A5036, emissiveIntensity: 1,
    });
    // Group order is bottom, wall, top — so the top face is the onyx one and a
    // disc at identity is showing Black.
    const discMats = [faceWhiteMat, wallMat, faceBlackMat];

    // Sixty-four discs, made once and parked. Allocating meshes during a
    // twelve-disc cascade is the one thing that would stutter this scene.
    const discPool = [];
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(discGeo, discMats);
      m.castShadow = true;
      m.receiveShadow = true;
      m.visible = false;
      m.userData.base = new THREE.Quaternion();
      scene.add(m);
      discPool.push(m);
    }
    const discAt = new Array(64).fill(null);
    let poolNext = 0;
    function takeDisc() {
      for (let k = 0; k < 64; k++) {
        const m = discPool[(poolNext + k) % 64];
        if (!m.visible) { poolNext = (poolNext + k + 1) % 64; return m; }
      }
      return discPool[0];
    }
    const Q_BLACK = new THREE.Quaternion();
    const Q_WHITE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

    function seatDisc(idx, colour) {
      let m = discAt[idx];
      if (!m) { m = takeDisc(); discAt[idx] = m; }
      m.visible = true;
      m.position.set(worldX(idx), DISC_Y, worldZ(idx));
      m.scale.setScalar(1);
      m.userData.base.copy(colour === BLACK ? Q_BLACK : Q_WHITE);
      m.quaternion.copy(m.userData.base);
      return m;
    }
    function clearDiscs() {
      for (let i = 0; i < 64; i++) { if (discAt[i]) discAt[i].visible = false; discAt[i] = null; }
    }

    /* =================================================================
     * MARKERS — legal-move rings, the armed ghost, the capture preview,
     * the last-move ring and the corner pulse. All pooled; nothing is
     * allocated once play starts.
     * ============================================================= */
    const flatRot = -Math.PI / 2;
    const legalMat = new THREE.MeshBasicMaterial({ color: 0x0e100e, transparent: true, opacity: 0.5 });
    const legalHaloMat = new THREE.MeshBasicMaterial({ color: 0xf4f2ea, transparent: true, opacity: 0.2 });
    const previewMat = new THREE.MeshBasicMaterial({ color: 0xe3b23c, transparent: true, opacity: 0.75 });
    const lastMat = new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.85 });

    function ringPool(count, inner, outer, mat) {
      const geo = new THREE.RingGeometry(inner, outer, 40);
      ctx.onDestroy(() => geo.dispose());
      const arr = [];
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = flatRot;
        m.position.y = 0.010;
        m.visible = false;
        m.renderOrder = 2;
        scene.add(m);
        arr.push(m);
      }
      return arr;
    }
    const legalRings = ringPool(34, 0.225, 0.30, legalMat);
    const legalHalos = ringPool(34, 0.30, 0.345, legalHaloMat);
    const previewRings = ringPool(26, 0.425, 0.485, previewMat);
    const lastRing = ringPool(1, 0.10, 0.152, lastMat)[0];
    lastRing.position.y = D_H + 0.03;

    // Same group order as a real disc — bottom, wall, top — so the ghost
    // shows the face the mover is about to lay down.
    const ghostMats = [
      new THREE.MeshBasicMaterial({ color: 0xf4f2ea, transparent: true, opacity: 0.6, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xd8c9a0, transparent: true, opacity: 0.6, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0x191a18, transparent: true, opacity: 0.6, depthWrite: false }),
    ];
    const ghost = new THREE.Mesh(discGeo, ghostMats);
    ghost.visible = false;
    ghost.renderOrder = 3;
    scene.add(ghost);

    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0xf0c25a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const pulseGeo = new THREE.RingGeometry(0.16, 0.62, 44);
    ctx.onDestroy(() => pulseGeo.dispose());
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.rotation.x = flatRot;
    pulse.position.y = 0.012;
    pulse.visible = false;
    pulse.renderOrder = 4;
    scene.add(pulse);
    let pulseAt = -1, pulseT0 = 0;

    /* --- sparks: a small pool of lit beads reused forever --- */
    const sparks = (function () {
      const N = 54;
      const geo = new THREE.SphereGeometry(0.032, 8, 6);
      ctx.onDestroy(() => geo.dispose());
      const pool = [];
      for (let i = 0; i < N; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        }));
        m.visible = false;
        m.renderOrder = 5;
        scene.add(m);
        pool.push({ mesh: m, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
      }
      let next = 0;
      return {
        burst(x, z, hex, count, power) {
          for (let i = 0; i < count; i++) {
            const p = pool[next = (next + 1) % N];
            const a = Math.random() * TAU;
            const sp = power * (0.35 + Math.random() * 0.9);
            p.mesh.position.set(x, DISC_Y, z);
            p.mesh.material.color.setHex(hex);
            p.vx = Math.cos(a) * sp;
            p.vz = Math.sin(a) * sp;
            p.vy = 0.7 + Math.random() * power * 1.1;
            p.max = p.life = 0.42 + Math.random() * 0.35;
            p.mesh.visible = true;
          }
        },
        step(dt) {
          for (const p of pool) {
            if (p.life <= 0) continue;
            p.life -= dt;
            if (p.life <= 0) { p.mesh.visible = false; p.mesh.material.opacity = 0; continue; }
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.z += p.vz * dt;
            p.mesh.position.y += p.vy * dt;
            p.vy -= 4.6 * dt;
            if (p.mesh.position.y < DISC_Y * 0.5) { p.mesh.position.y = DISC_Y * 0.5; p.vy *= -0.35; }
            p.vx *= 0.96; p.vz *= 0.96;
            const t = p.life / p.max;
            p.mesh.material.opacity = t * 0.95;
            p.mesh.scale.setScalar(0.5 + t * 0.8);
          }
        },
      };
    })();

    /* =================================================================
     * GAME STATE
     * ============================================================= */
    let phase = "title";               // title | play | pass | over
    let turn = BLACK;
    let legal = new Map();
    let armed = null;                  // { idx, flips }
    let lastMove = -1;
    let lastMover = null;
    let moveNo = 0;
    let counts = { black: 2, white: 2, empty: 60 };
    const shown = { black: 2, white: 2 };
    let result = null;
    let passer = null;
    let boardDip = 0;

    // Animation is a flat list resolved against performance.now(), never a
    // frame counter, so a stalled frame cannot desynchronise a cascade.
    const FLIP_MS = 255, RING_MS = 58, DROP_MS = 180, DROP_LEAD = 110;
    let placing = null;                // { mesh, t0 }
    const flips = [];                  // { mesh, axis, q0, t0 }
    let resolveAt = 0, pendingResolve = false;

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOutSin = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

    /** True while the board is mid-move and must ignore input. */
    const busy = () => placing !== null || flips.length > 0 || pendingResolve;

    /* =================================================================
     * OVERLAY. One markup string on the runtime-owned root, queried back
     * out by [data-el]. Bits may not reach into the host DOM and
     * document.createElement is rejected at upload.
     *
     * The two strips are the same markup emitted twice; the far one is
     * rotated 180 degrees so its owner is not reading their own score
     * upside down. Because the rotation reverses visual order, the same
     * child order — bar, scores, controls — puts the bar against the board
     * and the controls under the player's own thumb at both ends.
     * ============================================================= */
    const DISP = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const BODY = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const PANEL_BG = "#121618";
    const HAIR = "1px solid rgba(233,240,234,0.09)";

    const iconBtn = "pointer-events:auto;width:36px;height:44px;border-radius:12px;" +
      "border:" + HAIR + ";background:#191E20;color:#CFE0D4;font-size:15px;line-height:1;" +
      "font-family:inherit;padding:0;-webkit-tap-highlight-color:transparent;";
    const bigBtn = (bg, fg) => "pointer-events:auto;border:none;border-radius:14px;font-family:" + BODY + ";" +
      "font-size:14px;font-weight:700;letter-spacing:0.16em;text-transform:lowercase;" +
      "padding:14px 18px;background:" + bg + ";color:" + fg + ";-webkit-tap-highlight-color:transparent;";

    function chip(who, side) {
      const p = P[who === "b" ? BLACK : WHITE];
      const own = side === "own";
      return '<div data-el="chip-' + side + '" data-who="' + p.key + '" style="flex:' + (own ? "1.25" : "1") + ';' +
        'display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:15px;' +
        'background:#171C1E;border:' + HAIR + ';box-sizing:border-box;">' +
        '<span style="width:18px;height:18px;border-radius:50%;background:' + p.swatch + ';' +
          'box-shadow:inset 0 0 0 1.5px ' + RIMC + ',0 1px 2px rgba(0,0,0,0.6);flex:none;"></span>' +
        '<span style="font-family:' + BODY + ';font-size:9.5px;font-weight:600;letter-spacing:0.2em;' +
          'text-transform:lowercase;color:rgba(207,224,212,0.55);">' + esc(p.name) + '</span>' +
        '<span data-el="count-' + side + '" style="margin-left:auto;font-family:' + DISP + ';' +
          'font-size:' + (own ? 30 : 24) + 'px;font-weight:700;line-height:1;letter-spacing:0.01em;' +
          'color:#EDF3EE;">2</span>' +
      '</div>';
    }

    const GRAD = {
      b: "linear-gradient(180deg,#3D3E39,#0F110B)",
      w: "linear-gradient(180deg,#FFFDF6,#C7C1AC)",
    };

    function strip(who) {
      const top = who === "b";
      const ownGrad = GRAD[who];
      const oppGrad = GRAD[who === "b" ? "w" : "b"];
      const box = top
        ? "top:0;height:" + L.strip + "px;transform:rotate(180deg);padding:8px 15px " + (SAFE_T + 6) + "px;"
        : "bottom:0;height:" + L.strip + "px;padding:8px 15px " + (SAFE_B + 6) + "px;";
      // The deck fades out toward the board so the table it sits on stays
      // visible. The rotation carries the gradient with it, so one
      // declaration reads correctly from both seats.
      return '<div data-el="strip" data-who="' + who + '" style="position:absolute;left:0;right:0;' + box +
        'display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;' +
        'pointer-events:none;transition:opacity 240ms ease;' +
        'background:linear-gradient(to top,#0C1011 46%,rgba(12,16,17,0) 100%);">' +

        // Territory. This strip's owner grows from the near edge, the
        // opponent from the far one, and the unclaimed felt shows between
        // them — so each player watches the board fill toward themselves.
        '<div>' +
          '<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:#0C2419;' +
            'border:' + HAIR + ';box-sizing:border-box;">' +
            '<div data-el="terr-a" style="width:3%;background:' + ownGrad + ';' +
              'transition:width 420ms cubic-bezier(.22,.8,.28,1);"></div>' +
            '<div style="flex:1;"></div>' +
            '<div data-el="terr-b" style="width:3%;background:' + oppGrad + ';' +
              'transition:width 420ms cubic-bezier(.22,.8,.28,1);"></div>' +
          '</div>' +
          '<div data-el="caption" style="margin-top:8px;text-align:center;font-family:' + BODY + ';' +
            'font-size:9.5px;font-weight:600;letter-spacing:0.22em;text-transform:lowercase;' +
            'color:rgba(207,224,212,0.38);">Opening position</div>' +
        '</div>' +

        '<div style="display:flex;gap:8px;align-items:stretch;">' +
          chip(who, "own") + chip(who === "b" ? "w" : "b", "opp") +
        '</div>' +

        '<div style="display:flex;gap:7px;align-items:stretch;">' +
          '<button data-el="mute" aria-label="Sound" style="' + iconBtn + '">' + SPK(true) + '</button>' +
          '<button data-el="cog" aria-label="Settings" style="' + iconBtn + '">&#9881;</button>' +
          '<button data-el="help" aria-label="How to play" style="' + iconBtn + '">?</button>' +
          '<button data-el="act" style="pointer-events:auto;flex:1;border-radius:12px;border:' + HAIR + ';' +
            'background:#191E20;color:#CFE0D4;font-family:' + BODY + ';font-size:11.5px;font-weight:700;' +
            'letter-spacing:0.16em;text-transform:lowercase;padding:0 6px;height:44px;' +
            '-webkit-tap-highlight-color:transparent;">Black to play</button>' +
        '</div>' +
      '</div>';
    }

    /**
     * A block of card content repeated at both ends, each facing its own
     * player, so a result or a forced pass never has to be read upside down.
     * The rotation carries the padding with it, which is why both copies
     * declare their safe-area clearance on the same edge.
     */
    function twin(name, inner) {
      const h = Math.max(150, L.strip + 16);
      return '<div style="position:absolute;left:0;right:0;top:0;height:' + h + 'px;box-sizing:border-box;' +
          'display:flex;align-items:center;justify-content:center;transform:rotate(180deg);' +
          'padding:6px 20px ' + SAFE_T + 'px;">' +
          '<div data-el="' + name + '-far" style="width:100%;max-width:318px;">' + inner + '</div>' +
        '</div>' +
        '<div style="position:absolute;left:0;right:0;bottom:0;height:' + h + 'px;box-sizing:border-box;' +
          'display:flex;align-items:center;justify-content:center;padding:6px 20px ' + SAFE_B + 'px;">' +
          '<div data-el="' + name + '-near" style="width:100%;max-width:318px;">' + inner + '</div>' +
        '</div>';
    }

    /** The little two-tone disc used wherever a colour needs naming in the UI. */
    function swatch(who, size) {
      return '<span style="display:inline-block;width:' + size + 'px;height:' + size + 'px;border-radius:50%;' +
        'background:' + P[who].swatch + ';box-shadow:inset 0 0 0 1.5px ' + RIMC + ',0 1px 3px rgba(0,0,0,0.6);' +
        'vertical-align:middle;flex:none;"></span>';
    }

    const overCard =
      '<div style="background:' + PANEL_BG + 'F5;border:' + HAIR + ';border-radius:19px;padding:15px 16px 14px;' +
        'text-align:center;box-shadow:0 14px 40px rgba(0,0,0,0.6);">' +
        '<div data-el="over-title" style="font-family:' + DISP + ';font-size:29px;font-weight:700;' +
          'line-height:1;letter-spacing:0.07em;text-transform:lowercase;color:' + BRASS + ';">Black wins</div>' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:11px;margin-top:11px;' +
          'font-family:' + DISP + ';font-size:26px;font-weight:700;line-height:1;color:#EDF3EE;">' +
          swatch(BLACK, 15) + '<span data-el="over-b">2</span>' +
          '<span style="opacity:0.28;font-size:17px;">&mdash;</span>' +
          '<span data-el="over-w">2</span>' + swatch(WHITE, 15) +
        '</div>' +
        '<div data-el="over-line" style="font-family:' + BODY + ';font-size:11px;line-height:1.5;margin-top:9px;' +
          'color:rgba(207,224,212,0.6);"></div>' +
        '<button data-el="again" style="' + bigBtn(BRASS, "#1A1508") + 'width:100%;margin-top:12px;padding:12px 14px;">Rematch</button>' +
      '</div>';

    const passCard =
      '<div style="background:' + PANEL_BG + 'F2;border:' + HAIR + ';border-radius:18px;padding:15px 16px;' +
        'text-align:center;box-shadow:0 12px 34px rgba(0,0,0,0.5);">' +
        '<div data-el="pass-who" style="font-family:' + DISP + ';font-size:27px;font-weight:700;line-height:1;' +
          'letter-spacing:0.05em;text-transform:lowercase;color:' + BRASS + ';">White passes</div>' +
        '<div style="font-family:' + BODY + ';font-size:11.5px;line-height:1.5;margin-top:7px;' +
          'color:rgba(207,224,212,0.62);">No legal move &mdash; the turn goes straight back.</div>' +
      '</div>';

    /**
     * The masthead, emitted once per seat and rotated to face its own player.
     * Identical at both ends by design: the only thing that differs is which
     * colour the line names, because that is the one fact that really is
     * different about the two ends of the table.
     */
    function titleBand(who) {
      const top = who === "b";
      const box = top
        ? "top:0;transform:rotate(180deg);padding:10px 20px " + (SAFE_T + 8) + "px;"
        : "bottom:0;padding:10px 20px " + (SAFE_B + 8) + "px;";
      const line = top ? "Black &middot; this end &middot; moves first"
                       : "White &middot; this end &middot; moves second";
      return '<div data-el="tstrip" style="position:absolute;left:0;right:0;' + box +
          'height:' + L.strip + 'px;box-sizing:border-box;display:flex;flex-direction:column;' +
          'align-items:center;justify-content:space-between;text-align:center;' +
          'background:linear-gradient(to top,#070B0C 52%,rgba(7,11,12,0));">' +
          '<div style="font-family:' + BODY + ';font-size:9px;letter-spacing:0.3em;' +
            'color:' + BRASS + ';opacity:0.9;">Reversi &middot; two players &middot; one phone</div>' +
          '<div style="font-family:' + DISP + ';font-size:44px;font-weight:700;line-height:1;' +
            'letter-spacing:0.14em;text-indent:0.14em;color:#F2F6F1;">OTHELLO</div>' +
          '<div style="display:flex;align-items:center;gap:9px;font-family:' + BODY + ';font-size:10px;' +
            'letter-spacing:0.24em;color:rgba(207,224,212,0.6);">' +
            swatch(top ? BLACK : WHITE, 13) + line + '</div>' +
          '<button data-el="start" style="' + bigBtn(BRASS, "#1A1508") + 'width:100%;max-width:300px;">Start game</button>' +
        '</div>';
    }

    const root = ctx.createRoot({ touchAction: "none" });
    // The overlay is created after the canvas, so it sits on top and would
    // swallow every tap meant for the board. It is transparent to pointers;
    // only the chrome that is meant to be pressed opts back in.
    root.style.cssText += ";font-family:" + BODY + ";color:#E4EDE6;pointer-events:none;" +
      "background:transparent;overflow:hidden;text-transform:lowercase;";

    /* Form controls do not inherit text-transform: the UA stylesheet pins
     * `text-transform:none` on button/input/select, so the lowercase set on
     * this root stops dead at every button. Stamp them as they are built,
     * rather than threading the declaration through 250 style strings. */
    const lowercaseControls = () => {
      for (const el of root.querySelectorAll("button,input,select,textarea")) {
        if (el.style.textTransform !== "lowercase") el.style.textTransform = "lowercase";
      }
    };
    lowercaseControls();
    new MutationObserver(lowercaseControls).observe(root, { childList: true, subtree: true });
    root.innerHTML =
      strip("b") + strip("w") +

      // --- title. The dressed board with its opening four is the best thing
      //     this bit has to show, so nothing covers it: the masthead lives in
      //     the two strips instead. Both ends get the same one — a seat that
      //     is handed the compressed version reads it as the broken half of
      //     the screen, and on a shared phone there is no "far" player. ---
      '<div data-el="title" style="position:absolute;inset:0;pointer-events:auto;z-index:50;">' +
        titleBand("b") + titleBand("w") +
      '</div>' +

      // --- forced pass, shown at both ends ---
      '<div data-el="pass" style="position:absolute;inset:0;display:none;z-index:45;pointer-events:none;' +
        'background:rgba(6,9,9,0.42);">' + twin("pass", passCard) + '</div>' +

      // --- result, shown at both ends with a rematch button each ---
      '<div data-el="over" style="position:absolute;inset:0;display:none;z-index:55;pointer-events:auto;' +
        'background:rgba(6,9,9,0.55);">' + twin("over", overCard) + '</div>' +

      // --- settings. Both ends have a cog, so the card turns to face
      //     whichever one opened it. ---
      '<div data-el="cogp" style="position:absolute;inset:0;display:none;z-index:70;pointer-events:auto;' +
        'align-items:center;justify-content:center;background:rgba(6,9,9,0.9);padding:24px;">' +
        '<div data-el="cogp-card" style="width:100%;max-width:318px;background:' + PANEL_BG + ';border:' + HAIR + ';' +
          'border-radius:22px;padding:21px;">' +
          '<div style="font-family:' + DISP + ';font-size:25px;font-weight:700;letter-spacing:0.07em;' +
            'text-transform:lowercase;">Settings</div>' +
          '<div style="width:44px;height:2px;background:' + BRASS + ';opacity:0.8;margin:11px 0 15px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.2em;text-transform:lowercase;opacity:0.5;">Sound</div>' +
          '<div data-el="set-mute" style="display:flex;gap:7px;margin:9px 0 17px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.2em;text-transform:lowercase;opacity:0.5;">Placing a disc</div>' +
          '<div data-el="set-confirm" style="display:flex;gap:7px;margin:9px 0 5px;"></div>' +
          '<div style="font-size:10.5px;line-height:1.5;opacity:0.45;margin-bottom:15px;">' +
            'Confirm arms a ghost disc first and shows what would flip. Either end&rsquo;s button commits it.</div>' +
          '<div style="font-size:10px;letter-spacing:0.2em;text-transform:lowercase;opacity:0.5;">Legal move rings</div>' +
          '<div data-el="set-hints" style="display:flex;gap:7px;margin:9px 0 5px;"></div>' +
          '<button data-el="cogp-close" style="' + bigBtn("#232A2C", "#E4EDE6") + 'width:100%;margin-top:18px;">Done</button>' +
        '</div>' +
      '</div>' +

      // --- how to play ---
      '<div data-el="helpp" style="position:absolute;inset:0;display:none;z-index:70;pointer-events:auto;' +
        'align-items:center;justify-content:center;background:rgba(6,9,9,0.9);padding:24px;">' +
        '<div data-el="helpp-card" style="width:100%;max-width:318px;background:' + PANEL_BG + ';border:' + HAIR + ';' +
          'border-radius:22px;padding:21px;">' +
          '<div style="font-family:' + DISP + ';font-size:25px;font-weight:700;letter-spacing:0.07em;' +
            'text-transform:lowercase;">How to play</div>' +
          '<div style="width:44px;height:2px;background:' + BRASS + ';opacity:0.8;margin:11px 0 14px;"></div>' +
          '<ul style="font-size:11.5px;line-height:1.62;opacity:0.84;padding-left:15px;margin:0;">' +
            '<li style="margin-bottom:7px;">Phone flat on the table. <b>Black</b> takes the top edge, ' +
              '<b>White</b> the bottom, and Black moves first.</li>' +
            '<li style="margin-bottom:7px;">A move must trap a line of your opponent&rsquo;s discs between ' +
              'the disc you place and one you already own.</li>' +
            '<li style="margin-bottom:7px;">Lines run in all eight directions, and <b>every</b> trapped ' +
              'line flips &mdash; even when it costs you.</li>' +
            '<li style="margin-bottom:7px;">Flips never chain. Only discs in a straight unbroken line ' +
              'from the disc you placed turn over.</li>' +
            '<li style="margin-bottom:7px;">Rings mark your legal moves. Tap one to arm it, then press ' +
              'the button at <b>either</b> end to commit.</li>' +
            '<li style="margin-bottom:7px;">No legal move means you pass, automatically. When neither ' +
              'player can move, the game ends.</li>' +
            '<li>Corners can never be flipped back, so chase them. Most discs showing wins, and the ' +
              'match&rsquo;s biggest margin goes to the global board.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + bigBtn("#232A2C", "#E4EDE6") + 'width:100%;margin-top:15px;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const all = (n) => Array.prototype.slice.call(root.querySelectorAll('[data-el="' + n + '"]'));
    const stripOf = (who) => root.querySelector('[data-el="strip"][data-who="' + who + '"]');

    /**
     * Bind a control to one finger for that finger's whole life.
     *
     * Two people are pressing this screen. Without the binding, a second
     * finger landing on a button that already has one — or the first finger
     * sliding off and a different one lifting — fires the wrong action, and
     * on a board where a commit is irreversible that is somebody's game.
     */
    function press(node, fn) {
      if (!node) return;
      let live = null;
      const paint = (down) => { node.style.opacity = down ? "0.72" : ""; };
      ctx.listen(node, "pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (live !== null) return;                   // this control is already held
        live = e.pointerId;
        if (node.setPointerCapture) { try { node.setPointerCapture(e.pointerId); } catch (_) {} }
        paint(true);
      }, { passive: false });
      ctx.listen(node, "pointerup", (e) => {
        e.stopPropagation();
        if (live !== e.pointerId) return;
        live = null;
        paint(false);
        fn(e);
      });
      ctx.listen(node, "pointercancel", (e) => {
        if (live !== e.pointerId) return;
        live = null;
        paint(false);
      });
    }
    const pressAll = (name, fn) => { for (const n of all(name)) press(n, () => fn(n)); };

    /* =================================================================
     * HUD PAINTING
     * ============================================================= */
    function paintChips() {
      for (const who of ["b", "w"]) {
        const s = stripOf(who);
        if (!s) continue;
        const mine = who === "b" ? BLACK : WHITE;
        const active = phase === "play" && turn === mine;
        // The title screen owns the whole surface; the strips would only
        // collide with its seat tags.
        s.style.display = phase === "title" ? "none" : "flex";
        for (const side of ["own", "opp"]) {
          const node = s.querySelector('[data-el="chip-' + side + '"]');
          const lit = phase === "play" &&
            ((side === "own" && turn === mine) || (side === "opp" && turn === other(mine)));
          node.style.borderColor = lit ? "rgba(227,178,60,0.75)" : "rgba(233,240,234,0.09)";
          node.style.background = lit ? "#1E2422" : "#171C1E";
          node.style.boxShadow = lit
            ? "0 0 0 1px rgba(227,178,60,0.18),0 0 16px rgba(227,178,60,0.14)" : "none";
          node.style.opacity = lit || phase !== "play" ? "1" : "0.62";
        }
        // A pass or result card is drawn inside the strip band but is
        // narrower than the deck, so at full brightness the score chips and
        // icon buttons stand out past its edges and read as a layering
        // fault. Both decks drop away while a card is up: the result card
        // already carries the score and the rematch, and the pass card wants
        // nothing but the board behind it.
        s.style.opacity = phase === "over" ? "0"
          : phase === "pass" ? "0.14"
          : phase === "play" && !active ? "0.72" : "1";
      }
    }

    function paintCounts() {
      for (const who of ["b", "w"]) {
        const s = stripOf(who);
        if (!s) continue;
        const own = who === "b" ? Math.round(shown.black) : Math.round(shown.white);
        const opp = who === "b" ? Math.round(shown.white) : Math.round(shown.black);
        s.querySelector('[data-el="count-own"]').textContent = String(own);
        s.querySelector('[data-el="count-opp"]').textContent = String(opp);
        // Territory: "a" is always this strip owner's share.
        s.querySelector('[data-el="terr-a"]').style.width = (own / 64 * 100).toFixed(2) + "%";
        s.querySelector('[data-el="terr-b"]').style.width = (opp / 64 * 100).toFixed(2) + "%";
      }
    }

    function paintAction() {
      for (const who of ["b", "w"]) {
        const s = stripOf(who);
        if (!s) continue;
        const btn = s.querySelector('[data-el="act"]');
        const mine = who === "b" ? BLACK : WHITE;
        let label, live = false, bright = false;
        if (phase === "over") { label = "Game over"; }
        else if (phase === "pass") { label = esc(P[passer || WHITE].name) + " passes"; }
        else if (armed) {
          label = "Place " + cellName(armed.idx) + " · flips " + armed.flips.length;
          live = true; bright = true;
        } else if (turn === mine) { label = "Your turn"; bright = true; }
        else { label = esc(P[turn].name) + " to play"; }
        btn.textContent = label;
        btn.style.background = bright ? (live ? BRASS : "#1E2422") : "#191E20";
        btn.style.color = live ? "#1A1508" : (bright ? BRASS : "rgba(207,224,212,0.6)");
        btn.style.borderColor = live ? BRASS : (bright ? "rgba(227,178,60,0.4)" : "rgba(233,240,234,0.09)");
        btn.style.pointerEvents = live ? "auto" : "none";
      }
    }

    function paintCaption() {
      let text;
      if (phase === "over") text = "Final position · " + moveNo + " moves";
      else if (lastMove < 0) text = "Opening position";
      else text = "Move " + moveNo + " · " + P[lastMover].name + " played " + cellName(lastMove);
      for (const n of all("caption")) n.textContent = text;
    }

    function paintHud() { paintChips(); paintCounts(); paintAction(); paintCaption(); }

    /* =================================================================
     * MARKERS
     * ============================================================= */
    function paintMarkers() {
      const p = P[turn];
      legalMat.color.setHex(p.ring);
      legalHaloMat.color.setHex(p.halo);
      legalHaloMat.opacity = p.haloA;

      const live = phase === "play" || phase === "title";
      const show = live && settings.hints && !busy() ? [...legal.keys()] : [];
      for (let i = 0; i < legalRings.length; i++) {
        const on = i < show.length && (!armed || show[i] !== armed.idx);
        legalRings[i].visible = on;
        legalHalos[i].visible = on;
        if (on) {
          const x = worldX(show[i]), z = worldZ(show[i]);
          legalRings[i].position.set(x, 0.010, z);
          legalHalos[i].position.set(x, 0.010, z);
        }
      }

      // The armed cell rings itself too, so the ghost never floats unmarked.
      const prev = armed ? [armed.idx].concat(armed.flips) : [];
      for (let i = 0; i < previewRings.length; i++) {
        const on = i < prev.length;
        previewRings[i].visible = on;
        if (on) previewRings[i].position.set(worldX(prev[i]), 0.013, worldZ(prev[i]));
      }

      if (armed) {
        ghost.visible = true;
        ghost.position.set(worldX(armed.idx), DISC_Y, worldZ(armed.idx));
        ghost.quaternion.copy(turn === BLACK ? Q_BLACK : Q_WHITE);
      } else {
        ghost.visible = false;
      }

      lastRing.visible = lastMove >= 0 && phase !== "title";
      if (lastRing.visible) lastRing.position.set(worldX(lastMove), D_H + 0.03, worldZ(lastMove));
    }

    /* =================================================================
     * PLAYING A MOVE
     * ============================================================= */
    function arm(idx) {
      const f = legal.get(idx);
      if (!f) {
        if (armed) { armed = null; paintMarkers(); paintAction(); }
        sound.haptic("warning");
        return;
      }
      if (armed && armed.idx === idx) return commit();
      armed = { idx, flips: f };
      paintMarkers();
      paintAction();
      sound.sting("tap");
      sound.haptic("light");
    }

    function commit() {
      if (!armed || busy() || phase !== "play") return;
      const { idx, flips: taken } = armed;
      const me = turn;
      armed = null;
      moveNo++;

      board[idx] = me;
      for (const i of taken) board[i] = me;

      const now = performance.now();
      const mesh = seatDisc(idx, me);
      mesh.scale.setScalar(1.15);
      mesh.position.y = DISC_Y + 0.5;
      placing = { mesh, t0: now };

      // The cascade. Discs are sorted by their Chebyshev ring from the
      // placed cell and started one ring at a time, so a big capture
      // ripples outward in every direction at once instead of blinking.
      const pr = idx >> 3, pc = idx & 7;
      let maxDelay = 0;
      for (const i of taken) {
        const r = i >> 3, c = i & 7;
        const dr = Math.sign(r - pr), dc = Math.sign(c - pc);
        const ring = Math.max(Math.abs(r - pr), Math.abs(c - pc));
        const d = Math.hypot(dc, dr) || 1;
        const dx = dc / d, dz = dr / d;
        const m = discAt[i];
        if (!m) continue;
        const delay = DROP_LEAD + (ring - 1) * RING_MS;
        maxDelay = Math.max(maxDelay, delay);
        flips.push({
          mesh: m,
          // Perpendicular to the captured line, so the disc rolls outward
          // along the direction it was taken in and you see its edge pass
          // through vertical on the way over.
          axis: new THREE.Vector3(dz, 0, -dx).normalize(),
          q0: m.userData.base.clone(),
          t0: now + delay,
          ring,
          done: false,
        });
      }

      counts = tally(board);
      lastMove = idx;
      lastMover = me;
      boardDip = 1;
      legal = new Map();
      paintMarkers();
      paintAction();
      paintCaption();

      sound.sting("coin");
      sound.haptic("medium");
      sound.heat(clamp((64 - counts.empty) / 64, 0, 1));
      sparks.burst(worldX(idx), worldZ(idx), me === BLACK ? 0x8fa39a : 0xfff2cf,
        Math.min(4 + taken.length, 11), 0.9 + Math.min(taken.length, 9) * 0.12);

      if (CORNERS.indexOf(idx) >= 0) {
        pulseAt = idx; pulseT0 = now;
        pulse.visible = true;
        pulse.position.set(worldX(idx), 0.012, worldZ(idx));
        sparks.burst(worldX(idx), worldZ(idx), 0xf0c25a, 12, 2.0);
        sound.sting("powerup");
        sound.haptic("heavy");
        ctx.platform.milestone("corner", { cell: cellName(idx), by: P[me].name });
      }
      if (taken.length >= 5) sound.duck(0.35, 320);

      ctx.platform.interact({ type: "place", cell: cellName(idx), flips: taken.length });
      ctx.platform.setScore(Math.max(counts.black, counts.white));

      resolveAt = now + Math.max(DROP_MS, maxDelay + FLIP_MS) + 40;
      pendingResolve = true;
    }

    /** Dismiss the forced-pass card, either on its timer or on a tap. */
    function endPass() {
      if (phase !== "pass") return;
      el("pass").style.display = "none";
      phase = "play";
      passer = null;
      legal = legalMoves(board, turn);
      paintMarkers();
      paintHud();
    }

    /** Called once the placement and every flip in the cascade have landed. */
    function afterMove() {
      counts = tally(board);
      const opp = other(turn);
      const oppMoves = legalMoves(board, opp);
      if (oppMoves.size) {
        turn = opp;
        legal = oppMoves;
        paintMarkers();
        paintHud();
        return;
      }
      const mine = legalMoves(board, turn);
      if (mine.size) {
        // A forced pass is the single biggest source of "this is broken" in
        // digital Othello, so it is spelled out rather than skipped past.
        phase = "pass";
        passer = opp;
        legal = new Map();
        for (const n of all("pass-far").concat(all("pass-near"))) {
          const w = n.querySelector('[data-el="pass-who"]');
          if (w) w.textContent = P[opp].name + " passes";
        }
        el("pass").style.display = "block";
        paintMarkers();
        paintHud();
        sound.sting("fail");
        sound.haptic("warning");
        ctx.platform.interact({ type: "pass", by: P[opp].name });
        ctx.timeout(endPass, 2400);
        return;
      }
      endGame();
    }

    async function endGame() {
      phase = "over";
      legal = new Map();
      armed = null;
      counts = tally(board);
      const { black, white, empty } = counts;

      // Tournament convention: a game that stops early credits every
      // remaining empty square to the winner, so a wipe-out scores 64-0.
      let fb = black, fw = white;
      if (black > white) fb += empty;
      else if (white > black) fw += empty;
      const margin = Math.abs(fb - fw);
      const winner = black > white ? BLACK : white > black ? WHITE : null;

      let reason;
      if (empty === 0) reason = "board full after " + moveNo + " moves";
      else if (black === 0 || white === 0) reason = P[black === 0 ? WHITE : BLACK].name +
        " wiped the board, so all " + empty + " empty squares count for them (" + fb + "–" + fw + ")";
      else reason = "neither player can move, so the " + empty +
        " empty squares go to the winner (" + fb + "–" + fw + ")";

      result = { winner, black, white, fb, fw, margin, moves: moveNo };

      for (const host of all("over-far").concat(all("over-near"))) {
        const t = host.querySelector('[data-el="over-title"]');
        t.textContent = winner ? P[winner].name + " wins" : "Drawn";
        t.style.color = winner ? BRASS : "#CFE0D4";
        host.querySelector('[data-el="over-b"]').textContent = String(black);
        host.querySelector('[data-el="over-w"]').textContent = String(white);
        host.querySelector('[data-el="over-line"]').textContent =
          (winner ? "Won by " + margin + " · " : "Dead level · ") + reason;
      }
      el("over").style.display = "block";
      paintMarkers();
      paintHud();

      sound.duck(0.55, 480);
      sound.sting(winner ? "win" : "fail");
      sound.haptic(winner ? "success" : "warning");
      ctx.platform.setScore(Math.max(fb, fw));
      ctx.platform.complete({
        winner: winner ? P[winner].name : "draw",
        black, white, margin, moves: moveNo,
      });

      // The record belongs to the match, not to one of the two people
      // sharing the phone: how decisively this board was taken.
      try {
        if (winner) await ctx.memory.record("win_margin").submit(margin, { label: margin + " discs" });
      } catch (_) { /* offline is fine; the game still finished */ }
    }

    function newGame() {
      board = freshBoard();
      clearDiscs();
      for (let i = 0; i < 64; i++) if (board[i]) seatDisc(i, board[i]);
      turn = BLACK;
      phase = "play";
      armed = null;
      lastMove = -1;
      lastMover = null;
      moveNo = 0;
      result = null;
      passer = null;
      placing = null;
      flips.length = 0;
      pendingResolve = false;
      pulse.visible = false;
      pulseAt = -1;
      counts = tally(board);
      shown.black = counts.black; shown.white = counts.white;
      legal = legalMoves(board, turn);
      el("over").style.display = "none";
      el("pass").style.display = "none";
      paintMarkers();
      paintHud();
      sound.heat(0.14);
    }

    /* =================================================================
     * INPUT.
     *
     * The board is one zone with one live finger. A pointer is bound to it
     * on pointerdown and released only on up or cancel, so a second hand
     * landing mid-tap cannot retarget somebody else's move — the failure
     * mode that matters when two people are leaning over the same screen.
     * ============================================================= */
    let boardPointer = null;

    ctx.listen(glCanvas, "pointerdown", (e) => {
      e.preventDefault();
      if (boardPointer !== null) return;              // a hand is already on the board
      boardPointer = e.pointerId;
      if (glCanvas.setPointerCapture) { try { glCanvas.setPointerCapture(e.pointerId); } catch (_) {} }
      // A pass card is an announcement, not a modal: touching the board
      // skips it rather than making both players wait it out.
      if (phase === "pass") return endPass();
      if (phase !== "play" || busy()) return;
      const i = pickCell(e.offsetX, e.offsetY);
      if (i < 0) {
        if (armed) { armed = null; paintMarkers(); paintAction(); }
        return;
      }
      sound.unlock();
      if (!settings.confirm) {
        if (legal.has(i)) { armed = { idx: i, flips: legal.get(i) }; commit(); }
        else sound.haptic("warning");
        return;
      }
      arm(i);
    }, { passive: false });

    const releaseBoard = (e) => { if (boardPointer === e.pointerId) boardPointer = null; };
    ctx.listen(glCanvas, "pointerup", releaseBoard);
    ctx.listen(glCanvas, "pointercancel", releaseBoard);

    /* --- chrome --- */
    pressAll("act", () => { if (armed) commit(); });
    pressAll("mute", () => {
      const m = sound.toggle();
      for (const n of all("mute")) n.innerHTML = SPK(!m);
    });
    if (settings.mute) for (const n of all("mute")) n.innerHTML = SPK(false);
    // A panel opened from the far end turns to face that end, the same way a
    // real player would spin a rulebook round rather than lean over the table.
    const farCog = () => stripOf("b") && stripOf("b").querySelector('[data-el="cog"]');
    const farHelp = () => stripOf("b") && stripOf("b").querySelector('[data-el="help"]');
    function openPanel(name, fromFar) {
      el(name + "-card").style.transform = fromFar ? "rotate(180deg)" : "none";
      el(name).style.display = "flex";
    }
    pressAll("cog", (node) => openPanel("cogp", node === farCog()));
    pressAll("help", (node) => openPanel("helpp", node === farHelp()));
    press(el("cogp-close"), () => { el("cogp").style.display = "none"; });
    press(el("helpp-close"), () => { el("helpp").style.display = "none"; });
    pressAll("again", () => { newGame(); ctx.platform.interact({ type: "rematch" }); });
    pressAll("start", async () => {
      ctx.platform.start();
      await sound.unlock();
      el("title").style.display = "none";
      newGame();
    });

    /* --- settings pills --- */
    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="pointer-events:auto;flex:1;padding:11px 0;border-radius:11px;' +
        'border:' + HAIR + ';font-family:' + BODY + ';font-size:12px;font-weight:700;letter-spacing:0.1em;' +
        'text-transform:lowercase;">' + labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "#2B3330" : "#171C1E";
          b.style.color = on ? BRASS : "rgba(207,224,212,0.5)";
          b.style.borderColor = on ? "rgba(227,178,60,0.45)" : "rgba(233,240,234,0.09)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        press(b, () => { set(b.dataset.v); saveSettings(); paint(); sound.haptic("light"); });
      }
      paint();
    }
    pills(el("set-mute"), ["false", "true"], ["On", "Muted"],
      () => String(settings.mute), (v) => {
        if (String(settings.mute) !== v) {
          const m = sound.toggle();
          for (const n of all("mute")) n.innerHTML = SPK(!m);
        }
      });
    pills(el("set-confirm"), ["true", "false"], ["Confirm", "Instant"],
      () => String(settings.confirm), (v) => {
        settings.confirm = v === "true";
        if (!settings.confirm && armed) { armed = null; paintMarkers(); paintAction(); }
      });
    pills(el("set-hints"), ["true", "false"], ["Shown", "Hidden"],
      () => String(settings.hints), (v) => { settings.hints = v === "true"; paintMarkers(); });

    /* =================================================================
     * FRAME. Everything is a pure function of performance.now(), so a
     * dropped frame shortens an animation rather than desynchronising it.
     * ============================================================= */
    let breathe = 0;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 60) / 1000;
      const now = performance.now();

      /* --- the disc landing: it comes down from a hand's height and
       *     settles from 1.15 to 1.00 on an ease-out. One small
       *     compression, no bounce — this is moulded plastic on felt. --- */
      if (placing) {
        const t = clamp((now - placing.t0) / DROP_MS, 0, 1);
        const e = easeOutCubic(t);
        placing.mesh.scale.setScalar(1.15 - 0.15 * e);
        placing.mesh.position.y = DISC_Y + (1 - e) * 0.5;
        if (t >= 1) {
          placing.mesh.scale.setScalar(1);
          placing.mesh.position.y = DISC_Y;
          placing = null;
        }
      }

      /* --- the cascade --- */
      if (flips.length) {
        for (let i = flips.length - 1; i >= 0; i--) {
          const f = flips[i];
          if (now < f.t0) continue;
          const t = clamp((now - f.t0) / FLIP_MS, 0, 1);
          const th = Math.PI * easeInOutSin(t);
          f.mesh.quaternion.setFromAxisAngle(f.axis, th).multiply(f.q0);
          f.mesh.position.y = DISC_Y + Math.sin(t * Math.PI) * 0.11;
          if (!f.done && t > 0.5) {
            f.done = true;
            // One tick per ring, not per disc: a twelve-disc take should be
            // felt as a wave, not as twelve identical buzzes.
            if (f.ring <= 4) sound.haptic("light");
          }
          if (t >= 1) {
            f.mesh.userData.base.setFromAxisAngle(f.axis, Math.PI).multiply(f.q0).normalize();
            f.mesh.quaternion.copy(f.mesh.userData.base);
            f.mesh.position.y = DISC_Y;
            flips.splice(i, 1);
          }
        }
      }

      if (pendingResolve && now >= resolveAt && !placing && flips.length === 0) {
        pendingResolve = false;
        afterMove();
      }

      /* --- score numerals and the territory bar run on one clock --- */
      const k = 1 - Math.pow(0.002, dt);
      let moved = false;
      for (const key of ["black", "white"]) {
        const before = Math.round(shown[key]);
        shown[key] += (counts[key] - shown[key]) * k;
        if (Math.abs(counts[key] - shown[key]) < 0.02) shown[key] = counts[key];
        if (Math.round(shown[key]) !== before) moved = true;
      }
      if (moved) paintCounts();

      /* --- breathing rings --- */
      breathe += dt;
      const b = 0.5 + 0.5 * Math.sin(breathe * (TAU / 1.4));
      const sc = 1 + b * 0.06;
      for (let i = 0; i < legalRings.length; i++) {
        if (!legalRings[i].visible) continue;
        legalRings[i].scale.setScalar(sc);
        legalHalos[i].scale.setScalar(sc);
      }
      legalMat.opacity = 0.34 + b * 0.30;
      legalHaloMat.opacity = P[turn].haloA * (0.55 + b * 0.45);
      previewMat.opacity = 0.45 + b * 0.42;
      lastMat.opacity = 0.55 + b * 0.22;

      /* --- corner pulse: corners are permanent, so they get a beat --- */
      if (pulseAt >= 0) {
        const t = clamp((now - pulseT0) / 460, 0, 1);
        pulse.scale.setScalar(0.5 + t * 1.9);
        pulseMat.opacity = (1 - t) * 0.7;
        if (t >= 1) { pulse.visible = false; pulseAt = -1; }
      }

      /* --- the board settles on every commit --- */
      if (boardDip > 0.001) {
        boardDip *= Math.pow(0.004, dt);
        boardGroup.position.y = -Math.sin(boardDip * Math.PI) * 0.045;
      } else if (boardGroup.position.y !== 0) {
        boardGroup.position.y = 0;
        boardDip = 0;
      }

      sparks.step(dt);
      renderer.render(scene, camera);
    });

    /* --- resize: the board is measured from the container, so a rotation
     *     or a keyboard opening has to remeasure rather than stretch --- */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      renderer.setSize(ctx.width, ctx.height, false);
      placeCamera();
      for (const who of ["b", "w"]) {
        const st = stripOf(who);
        if (st) st.style.height = L.strip + "px";
      }
      for (const n of all("tstrip")) n.style.height = L.strip + "px";
    });

    /* =================================================================
     * BOOT
     * ============================================================= */
    board = freshBoard();
    for (let i = 0; i < 64; i++) if (board[i]) seatDisc(i, board[i]);
    counts = tally(board);
    legal = legalMoves(board, turn);
    paintMarkers();
    paintHud();

    // A read-only window onto the game so the local harness can drive a real
    // match and assert on real positions. It exposes nothing the board is not
    // already showing.
    window.__OTHELLO__ = {
      get board() { return Array.prototype.join.call(board, ""); },
      get turn() { return turn === BLACK ? "black" : "white"; },
      get phase() { return phase; },
      get counts() { return { black: counts.black, white: counts.white, empty: counts.empty }; },
      get legal() { return [...legal.keys()].map(cellName); },
      get armed() { return armed ? cellName(armed.idx) : null; },
      get last() { return lastMove >= 0 ? cellName(lastMove) : null; },
      get moves() { return moveNo; },
      get result() { return result; },
      // True while a disc is dropping or a cascade is still turning: the
      // board rejects input until it lands, so a script must poll this
      // rather than waiting on the state, which changes immediately.
      get busy() { return busy(); },
      cellXY: (n) => cellXY(("abcdefgh".indexOf(n[0])) + (Number(n.slice(1)) - 1) * 8),
    };
    ctx.onDestroy(() => { try { delete window.__OTHELLO__; } catch (_) {} });

    // The board, its four opening discs and the title are all on screen
    // before ready() is called, so the host never shows a blank bit.
    renderer.render(scene, camera);
    ctx.markVisualReady("board set");
    ctx.platform.ready();

  },
};
