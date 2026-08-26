/**
 * Duskwing — two to four people, one phone, one burning cave.
 *
 * Everybody gets a horizontal band of the screen. Hold your band and your
 * creature beats its wings; let go and it falls. The world slides past from
 * right to left forever, saw blades and crushers and rotors come with it, and
 * the last wing still flying takes the round.
 *
 * Four decisions drive everything else.
 *
 * **A band per player, and the band is the button.** A side-scroller has a
 * direction of travel, so unlike a board game it cannot be rotated to face a
 * seat — instead the screen is sliced into N full-width horizontal strips and
 * each strip is simultaneously one player's tunnel *and* one player's control.
 * A finger anywhere inside your strip flies your creature, which is the only
 * control scheme that survives four hands arriving on a 390px phone at once.
 * Every pointer is bound to the band it landed in for its whole life, and a
 * band that already has a live finger ignores extra ones, so a hand that
 * strays across a divider can never start flying somebody else's creature.
 *
 * **The left edge of each band is both the wall and the pad.** In the game
 * this is descended from, falling behind the advancing edge kills you. Here
 * that edge is a black column down the left of every band, glowing in its
 * owner's colour — it is the lethal boundary *and* the place your thumb
 * naturally rests. Fingers therefore sit on the side the hazards have already
 * passed, and never on the right side of the screen where the next blade is
 * arriving. Flapping pushes you right, away from it; falling drifts you left,
 * into it. That single coupling is the whole risk curve of the game.
 *
 * **Everything in the play layer is #000 with no interior detail.** The
 * creatures, the rock, the blades, the rotors: pure black silhouettes read
 * against a lit sky, which is the entire art direction. All the colour lives
 * behind the silhouettes (an amber-to-teal gradient, three bloom centres, fog
 * bands, god-rays) or in the two eyes of each creature, which is how you tell
 * four identical black moths apart. Nothing in the foreground is ever tinted,
 * because tinting it would destroy the one thing that makes the picture work.
 *
 * **The record belongs to the flight, not to a person.** Four people share
 * this phone; "furthest flight" is how far this cave let *this group* get, so
 * that is what goes to the global board.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so the sky,
 * the three parallax forest layers, the film grain and the bloom sprite are
 * painted into OffscreenCanvases at boot and blitted — with a live-draw
 * fallback for WebViews that have no OffscreenCanvas. The canvas blur filter
 * is banned and not needed: stacked low-alpha radial gradients *are* the blur.
 * The overlay is one markup string on ctx.createRoot() rather than
 * document.createElement, and pointer maths uses offsetX/offsetY rather than
 * getBoundingClientRect — both of those are rejected at upload and neither is
 * documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Duskwing",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "arcade", "reflex", "silhouette"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {

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
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const now = () => performance.now();

    /** Escape anything that could ever be player-authored before it hits innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /** Integer hash — the whole course is generated from this, so it replays exactly. */
    function hash(n) {
      n = (n ^ 61) ^ (n >>> 16);
      n = (n + (n << 3)) | 0;
      n = n ^ (n >>> 4);
      n = Math.imul(n, 0x27d4eb2d);
      n = n ^ (n >>> 15);
      return n >>> 0;
    }
    /** hash-derived float in [0,1) for lane `salt`. */
    const hf = (n, salt) => (hash(n * 2654435761 + salt * 40503) % 100000) / 100000;

    /* ===============================================================
     * PLAYERS
     *
     * Four black moths are indistinguishable by shape — deliberately, the
     * silhouette rule forbids tinting a body — so identity is carried
     * entirely by eye colour, by the glow on that player's wall, and by
     * the huge ghosted distance numeral in their own band. Player 1 owns
     * the BOTTOM band, because that is the strip closest to the hand of
     * whoever is holding the phone.
     * ============================================================= */
    const CREW = [
      { name: "CYAN",    ink: "#3BDCF2", rgb: [59, 220, 242] },
      { name: "MAGENTA", ink: "#FF46A8", rgb: [255, 70, 168] },
      { name: "LIME",    ink: "#A6F03C", rgb: [166, 240, 60] },
      { name: "IRIS",    ink: "#AE8CFF", rgb: [174, 140, 255] },
    ];
    const rgba = (c, a) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";

    /* ===============================================================
     * THE HOURS
     *
     * Four skies, cycling as the flight gets longer. DAWN is the signature
     * one — a hot amber core cooling to teal at the corners — and it is
     * always the first, because a dark palette on a dim screen in a bright
     * room is where pure-black silhouettes stop reading at all.
     * ============================================================= */
    const HOURS = [
      {
        id: "DAWN",
        base: [[0.00, "#04222F"], [0.24, "#05485C"], [0.46, "#046763"], [0.66, "#2E7A44"], [0.84, "#C4700A"], [1.00, "#2A0C06"]],
        blooms: [
          { x: 0.70, y: 0.68, r: 0.86, stops: [[0, "rgba(253,254,231,0.98)"], [0.11, "rgba(252,214,58,0.48)"], [0.34, "rgba(206,86,6,0.24)"], [1, "rgba(180,50,4,0)"]] },
          { x: 0.24, y: 0.15, r: 0.62, stops: [[0, "rgba(180,250,246,0.34)"], [0.18, "rgba(30,196,196,0.20)"], [0.50, "rgba(12,130,148,0.09)"], [1, "rgba(12,130,148,0)"]] },
          { x: 0.36, y: 0.96, r: 0.56, stops: [[0, "rgba(255,150,40,0.44)"], [0.4, "rgba(190,50,10,0.16)"], [1, "rgba(190,50,10,0)"]] },
        ],
        ray: [255, 240, 170], mote: [255, 238, 198], ink: "#FFEFCD", fog: [230, 200, 130],
      },
      {
        id: "NOON",
        base: [[0.00, "#05280E"], [0.28, "#0D4A16"], [0.55, "#26761C"], [0.78, "#6BA412"], [1.00, "#08290E"]],
        blooms: [
          { x: 0.52, y: 0.30, r: 1.02, stops: [[0, "rgba(253,254,231,0.98)"], [0.14, "rgba(214,252,124,0.52)"], [0.44, "rgba(108,252,108,0.22)"], [1, "rgba(108,252,108,0)"]] },
          { x: 0.86, y: 0.74, r: 0.62, stops: [[0, "rgba(240,255,210,0.40)"], [0.34, "rgba(108,252,108,0.16)"], [1, "rgba(108,252,108,0)"]] },
        ],
        ray: [235, 255, 190], mote: [226, 255, 190], ink: "#F2FFDC", fog: [180, 240, 150],
      },
      {
        id: "DUSK",
        base: [[0.00, "#33081C"], [0.24, "#5E0F26"], [0.52, "#A32410"], [0.76, "#E05A08"], [1.00, "#240C0C"]],
        blooms: [
          { x: 0.30, y: 0.62, r: 1.04, stops: [[0, "rgba(255,244,214,0.92)"], [0.15, "rgba(250,110,30,0.55)"], [0.46, "rgba(190,50,10,0.26)"], [1, "rgba(190,50,10,0)"]] },
          { x: 0.82, y: 0.24, r: 0.66, stops: [[0, "rgba(255,170,190,0.40)"], [0.34, "rgba(140,32,90,0.20)"], [1, "rgba(140,32,90,0)"]] },
        ],
        ray: [255, 200, 150], mote: [255, 214, 180], ink: "#FFE3D2", fog: [230, 140, 110],
      },
      {
        id: "NIGHT",
        base: [[0.00, "#02060F"], [0.30, "#061A3E"], [0.60, "#0C3466"], [0.84, "#14508E"], [1.00, "#02060F"]],
        blooms: [
          { x: 0.72, y: 0.36, r: 0.96, stops: [[0, "rgba(234,246,255,0.90)"], [0.15, "rgba(110,232,216,0.42)"], [0.46, "rgba(50,110,250,0.22)"], [1, "rgba(50,110,250,0)"]] },
          { x: 0.22, y: 0.78, r: 0.66, stops: [[0, "rgba(180,220,255,0.34)"], [0.36, "rgba(50,110,250,0.16)"], [1, "rgba(50,110,250,0)"]] },
        ],
        ray: [190, 236, 255], mote: [190, 240, 255], ink: "#DDEEFF", fog: [120, 180, 240], stars: true,
      },
    ];

    /* ===============================================================
     * SETTINGS — remembered between sessions.
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("duskwing") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 2, 2, 4),
      diff: saved.diff === undefined ? 1 : clamp(saved.diff, 0, 2),
      mute: !!saved.mute,
      best: saved.best || 0,
    };
    function save() { try { ctx.storage.set("duskwing", settings); } catch (_) {} }

    // Gentle / Normal / Brutal: scroll speed, how fast it ramps, hazard density.
    const DIFF = [
      { name: "GENTLE", v0: 0.52, ramp: 0.0050, cap: 1.18, dens: 0.76 },
      { name: "NORMAL", v0: 0.62, ramp: 0.0080, cap: 1.50, dens: 1.00 },
      { name: "BRUTAL", v0: 0.78, ramp: 0.0125, cap: 1.92, dens: 1.28 },
    ];

    /* ===============================================================
     * SOUND — a drifting bed that tightens as the cave speeds up, stings
     * on the moments that matter, haptics so a death is felt. All of it
     * wrapped: audio is a nicety and must never break play.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "drift", volume: 0.34, tempo: 92, intensity: 0.25 });
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
        tempo(t) { if (!muted && bed) { try { bed.setTempo(t); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted;
          settings.mute = muted;
          save();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 220 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    // Display type. Bebas Neue is the register the reference art uses for every
    // numeral and label; Nunito Sans carries the few sentences of body copy.
    // The registry may not have them, so both stacks fall back to a condensed
    // system face and every canvas heading is drawn glyph-by-glyph with manual
    // tracking, which is what actually produces the airy look. Both registers
    // are Inter now; the weight and the manual tracking carry the difference.
    const DISP = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const BODY = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";

    /* ===============================================================
     * LAYOUT
     *
     * Chrome lives in a horizontal strip along the top, never in the side
     * margins: a 390px-wide screen has no side margins to spare, and a
     * button column there would sit directly on top of the tunnel.
     * ============================================================= */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    let W = 0, H = 0, U = 0, PLAY_TOP = 0, PLAY_BOT = 0, WALL = 0, HOME = 0, XMAX = 0;
    let STACK_BOT = 0;      // bottom of the stack of bands; below PLAY_BOT only when solo centres one
    let bands = [];
    const CHROME_H = 44;

    /**
     * Render scale, deliberately below the device ratio.
     *
     * This bit is fill-rate bound, not geometry bound: it paints the entire
     * display several times over every frame (backdrop, rock, tints, finish),
     * and every one of those passes costs the square of this number. Nothing
     * in the play layer has a hard edge that a phone-sized pixel grid would
     * flatter — it is soft glow and black silhouette — and the only crisp
     * type on screen is DOM, which stays at full device resolution. So the
     * canvas renders at 1.5x and looks the same for two-thirds of the cost.
     */
    const RSCALE = Math.min(ctx.dpr || 1, 1.5);

    function measure() {
      W = ctx.width; H = ctx.height;
      if (canvas.width !== Math.round(W * RSCALE) || canvas.height !== Math.round(H * RSCALE)) {
        canvas.width = Math.round(W * RSCALE);
        canvas.height = Math.round(H * RSCALE);
      }
      PLAY_TOP = ctx.safeArea.top + CHROME_H + 4;
      PLAY_BOT = H - ctx.safeArea.bottom - 6;
      const n = settings.players;
      // One band height is one world unit, and every distance in the cave —
      // hazard size, spacing, scroll speed — is expressed in those units. So a
      // solo band the full height of the screen does not just make the cave
      // taller, it makes the whole world twice as large: the scroll clamp
      // (a screen-pixel cap) stops tracking it, the pull toward the dark edge
      // doubles while the flap that fights it does not, and the creature is
      // reeled into the wall before it has covered ten metres.
      //
      // Solo keeps the two-player world and centres its single band, which
      // costs some screen and keeps the flight the one that was balanced.
      U = (PLAY_BOT - PLAY_TOP) / Math.max(n, 2);
      STACK_BOT = n === 1 ? PLAY_TOP + (PLAY_BOT - PLAY_TOP + U) / 2 : PLAY_BOT;
      bands = [];
      for (let i = 0; i < n; i++) {
        // Index 0 is the BOTTOM band, so player 1 is nearest the near hand.
        const top = STACK_BOT - (i + 1) * U;
        bands.push({ i, top, mid: top + U / 2, bot: top + U });
      }
      WALL = clamp(W * 0.132, 42, 60);               // the lethal edge, and the pad
      XMAX = W * 0.66;                               // furthest right flapping can carry you
      // Where a creature hatches: partway along the corridor between the wall
      // and the furthest a flap can carry it. Measured off U — the band height
      // — this lands beyond XMAX the moment one band is the whole screen, and
      // a solo creature hatches outside its own playfield and is taken by the
      // dark edge before it has flapped once.
      HOME = WALL + (XMAX - WALL) * 0.45;
    }
    measure();

    /** Which band owns a screen y. Chrome strip owns nothing. */
    function bandAt(y) {
      if (y < PLAY_TOP - 2) return -1;
      const i = Math.floor((STACK_BOT - y) / U);
      return clamp(i, 0, bands.length - 1);
    }

    /* ===============================================================
     * BAKED SURFACES
     *
     * There are no packaged assets, so the sky, the forest, the grain and
     * the bloom sprite are painted once into OffscreenCanvases. Every
     * bake site has a live-draw fallback, because some WebViews have no
     * OffscreenCanvas and a blank screen is worse than a slow one.
     * ============================================================= */
    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      try { return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))); }
      catch (_) { return null; }
    }

    /** The whole glow of the game: stacked low-alpha radial gradients. */
    function paintSky(t, hour, w, h) {
      // Strongly diagonal. A vertical gradient gives each horizontal band a
      // single flat colour — the picture only works if every band has light
      // running across it as well as down the screen.
      const base = t.createLinearGradient(w * 1.05, -h * 0.12, -w * 0.15, h * 1.10);
      for (const [p, c] of hour.base) base.addColorStop(p, c);
      t.fillStyle = base;
      t.fillRect(0, 0, w, h);

      t.globalCompositeOperation = "lighter";
      for (const b of hour.blooms) {
        const cx = w * b.x, cy = h * b.y, r = h * b.r;
        const grd = t.createRadialGradient(cx, cy, 0, cx, cy, r);
        for (const [p, c] of b.stops) grd.addColorStop(p, c);
        t.fillStyle = grd;
        t.fillRect(0, 0, w, h);
      }

      // God-rays: long thin wedges fanning out of the primary bloom. Faded
      // with their own gradient so they dissolve rather than end.
      const src = hour.blooms[0];
      const sx = w * src.x, sy = h * src.y;
      t.save();
      t.translate(sx, sy);
      for (let i = 0; i < 7; i++) {
        const a = -2.55 + i * 0.30 + (i % 3) * 0.055;
        const spread = 0.020 + (i % 4) * 0.013;
        const len = h * (1.35 + (i % 3) * 0.28);
        const grd = t.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
        grd.addColorStop(0, rgba(hour.ray, 0.16));
        grd.addColorStop(0.35, rgba(hour.ray, 0.075));
        grd.addColorStop(1, rgba(hour.ray, 0));
        t.fillStyle = grd;
        t.beginPath();
        t.moveTo(0, 0);
        t.lineTo(Math.cos(a - spread) * len, Math.sin(a - spread) * len);
        t.lineTo(Math.cos(a + spread) * len, Math.sin(a + spread) * len);
        t.closePath();
        t.fill();
      }
      t.restore();

      // Two static fog bands. Wide flat ellipses of the palette mid-tone let
      // distant shapes fade to smoke instead of reading as pure black.
      for (let i = 0; i < 2; i++) {
        const fy = h * (0.32 + i * 0.36);
        const grd = t.createLinearGradient(0, fy - h * 0.11, 0, fy + h * 0.11);
        grd.addColorStop(0, rgba(hour.fog, 0));
        grd.addColorStop(0.5, rgba(hour.fog, 0.07));
        grd.addColorStop(1, rgba(hour.fog, 0));
        t.fillStyle = grd;
        t.fillRect(0, fy - h * 0.11, w, h * 0.22);
      }

      if (hour.stars) {
        for (let i = 0; i < 130; i++) {
          const r = hf(i, 991);
          t.globalAlpha = 0.18 + hf(i, 17) * 0.55;
          t.fillStyle = rgba(hour.mote, 1);
          t.beginPath();
          t.arc(hf(i, 3) * w, hf(i, 5) * h, 0.5 + r * 1.2, 0, TAU);
          t.fill();
        }
        t.globalAlpha = 1;
      }
      t.globalCompositeOperation = "source-over";
    }

    const skyCache = {};
    function skyFor(idx) {
      const hour = HOURS[idx];
      const key = idx + ":" + W + "x" + H;
      if (skyCache[key] !== undefined) return skyCache[key];
      const c = surface(W, H);
      if (c) paintSky(c.getContext("2d"), hour, W, H);
      skyCache[key] = c;                                   // null → drawn live below
      return c;
    }

    /**
     * Parallax forest. Three layers of trunks and disc-cluster canopies,
     * baked in pure black and blitted at three different alphas — drawing
     * black over a lit sky at 0.3 alpha *is* the smoky mid-tone the far
     * layers need, so one bake serves all four palettes.
     */
    function paintForest(t, layer, w, h) {
      t.clearRect(0, 0, w, h);
      t.fillStyle = "#000";
      const salt = 700 + layer * 37;
      const count = [13, 18, 23][layer];
      const scale = [1.00, 0.72, 0.50][layer];
      const baseY = h * [1.02, 1.06, 1.10][layer];
      for (let k = 0; k < count; k++) {
        // Every tree is drawn twice, one screen apart, so the strip tiles.
        for (const off of [0, -w]) {
          const x = hf(k, salt) * w + off;
          const th = h * (0.26 + hf(k, salt + 1) * 0.44) * scale;
          const tw = w * (0.014 + hf(k, salt + 2) * 0.020) * scale;
          // Trunk: tapered segments with round caps.
          t.lineCap = "round";
          const lean = (hf(k, salt + 3) - 0.5) * w * 0.05;
          for (let s = 0; s < 9; s++) {
            const p0 = s / 9, p1 = (s + 1) / 9;
            t.beginPath();
            t.lineWidth = tw * (1 - p0 * 0.72);
            t.moveTo(x + lean * p0 * p0, baseY - th * p0);
            t.lineTo(x + lean * p1 * p1, baseY - th * p1);
            t.strokeStyle = "#000";
            t.stroke();
          }
          // Canopy: a chain of overlapping discs, never a polygon.
          const cx = x + lean, cy = baseY - th;
          const blobs = 14 + Math.floor(hf(k, salt + 4) * 10);
          t.beginPath();
          for (let b = 0; b < blobs; b++) {
            const a = hf(k * 40 + b, salt + 5) * TAU;
            const rr = hf(k * 40 + b, salt + 6);
            const spread = w * (0.042 + hf(k, salt + 7) * 0.036) * scale;
            t.moveTo(cx + Math.cos(a) * spread * rr + spread * 0.5, cy + Math.sin(a) * spread * rr * 0.62);
            t.arc(cx + Math.cos(a) * spread * rr, cy + Math.sin(a) * spread * rr * 0.62,
                  spread * (0.30 + rr * 0.34), 0, TAU);
          }
          t.fill();
        }
      }
    }

    let forest = [null, null, null];
    function bakeForest() {
      for (let i = 0; i < 3; i++) {
        const c = surface(W, H);
        if (c) paintForest(c.getContext("2d"), i, W, H);
        forest[i] = c;
      }
    }

    /**
     * Grain and vignette, baked together into one sheet.
     *
     * Both are full-screen passes and a full-screen pass is the single most
     * expensive thing this bit does — a live radial-gradient fill over the
     * whole display costs more than the entire cave. Composited once at boot
     * they cost one blit, and the per-frame jitter that keeps the grain from
     * looking like a fixed dirty lens moves the vignette by three pixels,
     * which nobody can see.
     */
    let finish = null;
    function bakeFinish() {
      const c = surface(W + 10, H + 10);
      if (!c) { finish = null; return; }
      const t = c.getContext("2d");
      t.fillStyle = "rgba(255,244,214,1)";
      for (let i = 0; i < 2200; i++) {
        t.globalAlpha = 0.05 + hf(i, 3301) * 0.09;
        t.fillRect(hf(i, 11) * (W + 10), hf(i, 13) * (H + 10), 1, 1);
      }
      t.globalAlpha = 1;
      const vg = t.createRadialGradient((W + 10) * 0.5, (H + 10) * 0.48, H * 0.26,
                                        (W + 10) * 0.5, (H + 10) * 0.50, H * 0.80);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(0.66, "rgba(0,0,0,0.22)");
      vg.addColorStop(1, "rgba(0,0,0,0.74)");
      t.fillStyle = vg;
      t.fillRect(0, 0, W + 10, H + 10);
      finish = c;
    }

    /**
     * One bloom sprite per colour, reused for every glow in the game: the halo
     * behind a hazard so its silhouette reads, the halo behind an eye, the
     * white flash on a death. Blitted with globalAlpha under 'lighter', which
     * is how you get soft light when ctx.filter = blur() is rejected at
     * upload. A white sprite cannot be recoloured at blit time under
     * 'lighter' — tinting has to happen in the bake — and there are only nine
     * colours in the whole game, so they are cached by colour.
     */
    const bloomCache = {};
    function bloomSprite(col) {
      const key = col[0] + "," + col[1] + "," + col[2];
      if (bloomCache[key] !== undefined) return bloomCache[key];
      const S = 128;
      const c = surface(S, S);
      if (c) {
        const t = c.getContext("2d");
        const grd = t.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        grd.addColorStop(0.00, rgba(col, 1));
        grd.addColorStop(0.14, rgba(col, 0.60));
        grd.addColorStop(0.40, rgba(col, 0.20));
        grd.addColorStop(0.70, rgba(col, 0.05));
        grd.addColorStop(1.00, rgba(col, 0));
        t.fillStyle = grd;
        t.fillRect(0, 0, S, S);
      }
      bloomCache[key] = c;                                 // null → live gradient
      return c;
    }

    /**
     * Draw a soft light disc, assuming the caller has already switched to
     * 'lighter'. Every switch of globalCompositeOperation flushes whatever
     * the renderer had batched, and this bit was switching twenty-five times
     * a frame — so glows are grouped into one pass per band instead.
     */
    function glow(x, y, r, col, alpha) {
      if (!(alpha > 0.004) || !(r > 0)) return;
      const sp = bloomSprite(col);
      g.globalAlpha = clamp(alpha, 0, 1);
      if (sp) { g.drawImage(sp, x - r, y - r, r * 2, r * 2); return; }
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rgba(col, 0.9));
      grd.addColorStop(0.4, rgba(col, 0.25));
      grd.addColorStop(1, rgba(col, 0));
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    /** The same, standalone, for the handful of one-off glows. */
    function bloom(x, y, r, col, alpha) {
      if (!(alpha > 0.004) || !(r > 0)) return;
      const sp = bloomSprite(col);
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = clamp(alpha, 0, 1);
      if (sp) {
        g.drawImage(sp, x - r, y - r, r * 2, r * 2);
      } else {
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, rgba(col, 0.9));
        grd.addColorStop(0.4, rgba(col, 0.25));
        grd.addColorStop(1, rgba(col, 0));
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.restore();
    }

    /**
     * The backdrop — sky, parallax forest, fog and motes — is composited into
     * its own surface at CSS resolution and then upscaled in a single blit.
     *
     * Those are five alpha-blended full-screen passes, and doing them at the
     * canvas's own resolution was most of a frame on its own. None of it has
     * an edge worth resolving: it is a glow, three layers of blurred forest
     * and some dust. Compositing at 1x costs a quarter as much and the
     * upscale is, if anything, flattering.
     */
    let backdrop = null, backdropG = null;
    function bakeBackdrop() {
      backdrop = surface(W, H);
      backdropG = backdrop ? backdrop.getContext("2d") : null;
    }

    function bakeAll() {
      bakeForest(); bakeFinish(); bakeBackdrop();
      for (const k in skyCache) delete skyCache[k];
    }
    bakeAll();

    /* ===============================================================
     * THE CAVE
     *
     * One course, shared by every band, so the round is a fair race: the
     * blade that kills you is the same blade your neighbour just cleared.
     * The profile is a function of world position measured in band units,
     * which makes the cave self-similar — two tall bands and four short
     * ones present exactly the same shapes at the same relative sizes.
     * ============================================================= */
    const MIN_ROCK = 0.075;                            // thinnest rock between tunnels
    const MIN_GAP  = 0.250;                            // tightest a tunnel is allowed to be

    /**
     * One independent course per band, all drawn from the same generator with
     * the same parameters.
     *
     * A single shared course is strictly fair, and it stacks four identical
     * saw blades in a vertical column down the screen — which reads instantly
     * as copy-paste and kills the picture. Four draws from one distribution
     * is fair the way a shuffled deck is fair, and it looks like four
     * different tunnels bored through the same rock. Each lane carries its own
     * hazards, its own closing gaps and a large phase offset into the terrain
     * waves, so no two are ever in step.
     */
    const lanes = [];
    function makeLane(i, seed) {
      return { i, ph: i * 137.53, hazards: [], pinches: [], spawnX: W * 1.55, seed: seed + i * 7919 };
    }

    /** Rolling lumps: a chain of soft bulges on a fixed lattice, hashed, so the
     *  rock outline is bulbous rather than a smooth sine and never repeats. */
    function lump(d, salt) {
      const cell = 0.62;
      const i0 = Math.floor(d / cell);
      let s = 0;
      for (let k = -1; k <= 1; k++) {
        const i = i0 + k;
        const cx = (i + 0.5 + (hf(i, salt) - 0.5) * 0.7) * cell;
        const amp = 0.010 + hf(i, salt + 1) * 0.032;
        const wid = 0.24 + hf(i, salt + 2) * 0.38;
        const t = (d - cx) / wid;
        if (t > -1 && t < 1) { const q = 1 - t * t; s += amp * q * q; }
      }
      return s;
    }

    /** Tunnel ceiling and floor at world position `d` in this lane, 0..1. */
    function profile(d, out, lane) {
      const q = d + lane.ph;
      let c = 0.5 + 0.064 * Math.sin(q * 0.78) + 0.032 * Math.sin(q * 1.93 + 1.9) + 0.015 * Math.sin(q * 4.10 + 0.4);
      let gp = 0.72 + 0.048 * Math.sin(q * 1.21 + 2.7);
      const ps = lane.pinches;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        const t = 1 - Math.abs(d - p.d) / p.w;
        if (t > 0) { const s = t * t * (3 - 2 * t); c += (p.c - c) * s; gp += (p.g - gp) * s; }
      }
      let ceil = c - gp / 2 + lump(q, 11 + lane.i * 13);
      let flr  = c + gp / 2 - lump(q, 77 + lane.i * 13);
      if (ceil < MIN_ROCK) ceil = MIN_ROCK;
      if (flr > 1 - MIN_ROCK) flr = 1 - MIN_ROCK;
      if (flr - ceil < MIN_GAP) { const m = (flr + ceil) / 2; ceil = m - MIN_GAP / 2; flr = m + MIN_GAP / 2; }
      out[0] = ceil; out[1] = flr;
      return out;
    }
    const _pf = [0, 0];

    /* --- hazards ------------------------------------------------------
     * All in band units: `x` is world px, everything else is a fraction of
     * a band height, so a hazard is the same shape whatever the band count.
     */
    function spawnOne(gate, lane) {
      const s = lane.seed++;
      const r = (k) => hf(s, k);
      const d = gate / U;                              // distance in band units
      const heat = clamp((d - 6) / 90, 0, 1);          // what is unlocked, and how mean
      const roll = r(1);
      let type;
      if (d < 7) type = "saw";
      else if (roll < 0.30) type = "saw";
      else if (roll < 0.46) type = "pinch";
      else if (roll < 0.62) type = "rotor";
      else if (roll < 0.78) type = "crusher";
      else if (roll < 0.90) type = "spikes";
      else type = "sawpair";

      if (type === "pinch") {
        profile(d, _pf, lane);
        lane.pinches.push({
          d, w: 1.5 + r(2) * 1.4,
          c: clamp((_pf[0] + _pf[1]) / 2 + (r(3) - 0.5) * 0.22, 0.30, 0.70),
          g: lerp(0.47, 0.31, heat * (0.4 + r(4) * 0.6)),
        });
        if (lane.pinches.length > 40) lane.pinches.shift();
        return;
      }
      if (type === "saw" || type === "sawpair") {
        const mount = r(5) < 0.5 ? "ceil" : "floor";
        lane.hazards.push({
          type: "saw", x: gate, mount,
          rr: 0.115 + r(6) * 0.085,
          spin: (r(7) < 0.5 ? -1 : 1) * (2.2 + r(8) * 3.4),
          bob: r(9) < 0.35 ? 0.07 + r(10) * 0.07 : 0,
          bobF: 0.9 + r(11) * 1.1, ph: r(12) * TAU,
        });
        if (type === "sawpair") {
          lane.hazards.push({
            type: "saw", x: gate + U * (0.55 + r(13) * 0.4),
            mount: mount === "ceil" ? "floor" : "ceil",
            rr: 0.10 + r(14) * 0.07,
            spin: (r(15) < 0.5 ? -1 : 1) * (2.4 + r(16) * 3.0),
            bob: 0, bobF: 1, ph: r(17) * TAU,
          });
        }
        return;
      }
      if (type === "rotor") {
        lane.hazards.push({
          type: "rotor", x: gate,
          n: 0.5 + (r(18) - 0.5) * 0.22,
          len: 0.13 + r(19) * 0.09 + heat * 0.03,
          wdt: 0.028 + r(20) * 0.016,
          blades: r(21) < 0.4 ? 3 : 2,
          spin: (r(22) < 0.5 ? -1 : 1) * (1.5 + r(23) * 2.6 + heat * 1.4),
          ph: r(24) * TAU,
        });
        return;
      }
      if (type === "crusher") {
        lane.hazards.push({
          type: "crusher", x: gate,
          from: r(25) < 0.5 ? "ceil" : "floor",
          wdt: 0.16 + r(26) * 0.16,
          reach: 0.24 + r(27) * 0.12 + heat * 0.05,
          period: 2.4 - heat * 0.9 + r(28) * 0.6,
          ph: r(29),
        });
        return;
      }
      lane.hazards.push({
        type: "spikes", x: gate,
        from: r(30) < 0.5 ? "ceil" : "floor",
        wdt: 0.55 + r(31) * 0.75,
        hgt: 0.10 + r(32) * 0.07,
      });
    }

    /** Keep every lane generated a screen and a half ahead of the camera. */
    function ensureCourse(rightEdge) {
      const dens = DIFF[settings.diff].dens;
      for (const lane of lanes) {
        let guard = 0;
        while (lane.spawnX < rightEdge + W && guard++ < 30) {
          spawnOne(lane.spawnX, lane);
          // The opening stretch is deliberately thin. A player who meets the
          // first blade before they have found the rhythm of the flap simply
          // dies, and reads it as the game's fault rather than their own.
          const warm = lane.spawnX / U < 7 ? 1.9 : 1;
          const gap = U * (1.05 + hf(lane.seed, 55) * 0.95) * warm / dens;
          lane.spawnX += gap;
        }
        while (lane.hazards.length && lane.hazards[0].x < camX - U * 1.2) lane.hazards.shift();
        while (lane.pinches.length && lane.pinches[0].d < camX / U - 4) lane.pinches.shift();
      }
    }

    /* ===============================================================
     * STATE
     * ============================================================= */
    let phase = "title";               // title | claim | countdown | play | over
    let camX = 0, originX = 0, scroll = 0, elapsed = 0, overAt = 0;
    let hourIdx = 0, hourPrev = 0, hourFade = 1;
    let shake = 0, flash = 0;
    let winner = -1, roundBest = 0;
    let particles = [];
    let motes = [];
    let birds = [];

    function makeBird(i) {
      return {
        i, alive: true, n: 0.5, vn: 0, sx: HOME, vx: 0,
        held: false, flapT: 0, wing: 0, wingV: 0,
        dist: 0, best: 0, graze: 0, hatch: 0, claimed: false,
        cause: "", trail: [], respawnAt: 0, milestone: 0,
      };
    }

    function seedMotes() {
      motes = [];
      for (let i = 0; i < 34; i++) {
        motes.push({
          x: hf(i, 401) * W, y: hf(i, 403) * H,
          r: 0.7 + hf(i, 405) * 1.9,
          sp: 0.10 + hf(i, 407) * 0.30,
          bob: hf(i, 409) * TAU, bobF: 0.4 + hf(i, 411) * 0.9,
          a: 0.16 + hf(i, 413) * 0.28,
        });
      }
    }
    seedMotes();

    const newSeed = () => ((Math.random() * 100000) | 0) + 1;

    function resetWorld(seed) {
      camX = 0; originX = 0; scroll = 0; elapsed = 0;
      particles = [];
      lanes.length = 0;
      for (let i = 0; i < settings.players; i++) lanes.push(makeLane(i, seed));
      hourIdx = 0; hourPrev = 0; hourFade = 1;
      winner = -1; roundBest = 0; shake = 0; flash = 0;
      birds = [];
      for (let i = 0; i < settings.players; i++) birds.push(makeBird(i));
    }
    resetWorld(newSeed());

    /* ===============================================================
     * SIMULATION
     *
     * Gravity, the flap impulse and the vertical clamps are all expressed
     * in band units per second, so the feel is identical whether the band
     * is 350px tall (two players) or 170px (four).
     *
     * The HORIZONTAL axis was not. The pull toward the dark edge is derived
     * from the scroll, which is `rel * U`, so it doubles when the band does —
     * but the forward beat of a wing and the speed clamps were written in
     * screen widths and did not. Two-player Duskwing was roughly twice as
     * hard as four-player for that reason alone, and a solo band would have
     * been harder still. They are in band units now, matched to the
     * four-player balance the game was tuned at.
     * ============================================================= */
    const METRE = 12;                                  // metres per band unit travelled
    const GRAV = 1.6, FLAP_DV = 0.30, FLAP_HZ = 9.5, VUP = 0.46, VDOWN = 0.72;
    const R_N = 0.066;                                 // creature radius, band units

    function flap(b, loud) {
      b.vn -= FLAP_DV;
      if (b.vn < -VUP) b.vn = -VUP;
      b.vx += U * 0.109;                 // was W * 0.0495, which is U * 0.109 at four players
      b.wingV = -13;
      if (phase === "play") {
        const band = bands[b.i];
        // A puff of dark motes shed downward, so the flap has weight.
        for (let k = 0; k < 2; k++) {
          particles.push({
            k: "puff", x: b.sx + (Math.random() - 0.5) * U * 0.1,
            y: band.top + b.n * U + U * 0.06,
            vx: -30 - Math.random() * 40, vy: 40 + Math.random() * 90,
            r: U * (0.012 + Math.random() * 0.016), life: 0.42, t: 0,
          });
        }
      }
      if (loud) { sound.sting("tap"); sound.haptic("light"); }
    }

    /** Autopilot for the attract loop on the title screen. */
    function autoHold(b) {
      const band = bands[b.i];
      const look = (camX + b.sx + W * 0.22) / U;
      profile(look, _pf, lanes[b.i]);
      const target = (_pf[0] + _pf[1]) / 2;
      return b.n > target + 0.03;
    }

    function kill(b, cause) {
      if (!b.alive) return;
      b.alive = false;
      b.cause = cause;
      const band = bands[b.i];
      const y = band.top + b.n * U;
      // Silhouette confetti: the body pops into shards of itself. Never red,
      // never gore — this world only has black shapes and light.
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU + Math.random() * 0.4;
        const sp = U * (0.9 + Math.random() * 2.1);
        particles.push({
          k: "shard", x: b.sx, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - U * 0.4,
          r: U * (0.018 + Math.random() * 0.030), rot: Math.random() * TAU,
          spin: (Math.random() - 0.5) * 16, life: 0.85 + Math.random() * 0.4, t: 0,
        });
      }
      particles.push({ k: "flash", x: b.sx, y, r: U * 0.5, life: 0.22, t: 0, col: CREW[b.i].rgb });
      if (phase !== "title") {
        shake = Math.min(shake + 7, 11);
        sound.sting("fail");
        sound.haptic("heavy");
        ctx.platform.interact({ type: "down", player: b.i + 1, cause, metres: Math.round(b.best) });
      } else {
        b.respawnAt = now() + 620;
      }
    }

    /** Circle-vs-capsule, for rotor blades. */
    function capsuleHit(px, py, x1, y1, x2, y2, r) {
      const dx = x2 - x1, dy = y2 - y1;
      const L2 = dx * dx + dy * dy || 1;
      let t = ((px - x1) * dx + (py - y1) * dy) / L2;
      t = clamp(t, 0, 1);
      const cx = x1 + dx * t, cy = y1 + dy * t;
      return (px - cx) * (px - cx) + (py - cy) * (py - cy) < r * r;
    }

    /**
     * Hazard geometry, resolved for the current instant.
     * Both the renderer and the collision test read from this, so what you
     * see really is what kills you.
     */
    function hazardAt(h, t, band, lane) {
      const sx = h.x - camX;
      const d = h.x / U;
      profile(d, _pf, lane);
      const ceilY = band.top + _pf[0] * U, floorY = band.top + _pf[1] * U;
      if (h.type === "saw") {
        const r = h.rr * U;
        const bobo = h.bob ? Math.sin(t * h.bobF + h.ph) * h.bob * U : 0;
        const cy = h.mount === "ceil" ? ceilY + r * 0.42 + bobo : floorY - r * 0.42 - bobo;
        return { kind: "saw", x: sx, y: cy, r, a: t * h.spin + h.ph };
      }
      if (h.type === "rotor") {
        const hub = { x: sx, y: lerp(ceilY, floorY, clamp((h.n - _pf[0]) / Math.max(0.001, _pf[1] - _pf[0]), 0.14, 0.86)) };
        return { kind: "rotor", x: hub.x, y: hub.y, len: h.len * U, w: h.wdt * U,
                 a: t * h.spin + h.ph, blades: h.blades, ceilY, floorY };
      }
      if (h.type === "crusher") {
        const u = ((t / h.period) + h.ph) % 1;
        let f;
        if (u < 0.55) f = 0.06;
        else if (u < 0.66) { const q = (u - 0.55) / 0.11; f = 0.06 + (1 - 0.06) * q * q; }
        else if (u < 0.80) f = 1;
        else f = 1 - (u - 0.80) / 0.20;
        const depth = f * h.reach * U;
        const w = h.wdt * U;
        const top = h.from === "ceil" ? ceilY : floorY - depth;
        return { kind: "crusher", x: sx - w / 2, y: top, w, h: depth, arming: u > 0.44 && u < 0.66, f };
      }
      const w = h.wdt * U, hg = h.hgt * U;
      const y = h.from === "ceil" ? ceilY : floorY;
      return { kind: "spikes", x: sx - w / 2, y, w, h: hg, up: h.from === "floor" };
    }

    function collide(b, t) {
      const band = bands[b.i];
      const by = band.top + b.n * U;
      const r = R_N * U;
      const lane = lanes[b.i];
      const wx = camX + b.sx;

      // Rock. Sampled at the creature's own world x, which is the only place
      // the tunnel actually has to be clear for it.
      profile(wx / U, _pf, lane);
      if (b.n - R_N < _pf[0] || b.n + R_N > _pf[1]) return "CRUSHED";

      // The wall on the left. Fall behind it and the dark takes you.
      if (b.sx - r < WALL * 0.88) return "LEFT BEHIND";

      let near = 0;
      const hz = lane.hazards;
      for (let i = 0; i < hz.length; i++) {
        const h = hz[i];
        const sx = h.x - camX;
        if (sx < -U * 1.2 || sx > W + U * 1.2) continue;
        const s = hazardAt(h, t, band, lane);
        if (s.kind === "saw") {
          const dd = Math.hypot(b.sx - s.x, by - s.y);
          if (dd < r + s.r * 0.90) return "SAWN";
          if (dd < r + s.r * 1.55) near = 1;
        } else if (s.kind === "rotor") {
          for (let k = 0; k < s.blades; k++) {
            const a = s.a + (k / s.blades) * TAU;
            const x2 = s.x + Math.cos(a) * s.len, y2 = s.y + Math.sin(a) * s.len;
            if (capsuleHit(b.sx, by, s.x, s.y, x2, y2, r + s.w * 0.8)) return "SAWN";
          }
          if (Math.hypot(b.sx - s.x, by - s.y) < s.len + r * 1.6) near = 1;
        } else if (s.kind === "crusher") {
          if (b.sx + r > s.x && b.sx - r < s.x + s.w && by + r > s.y && by - r < s.y + s.h) return "CRUSHED";
          if (b.sx + r > s.x - U * 0.1 && b.sx - r < s.x + s.w + U * 0.1) near = 1;
        } else {
          if (b.sx + r * 0.7 > s.x && b.sx - r * 0.7 < s.x + s.w) {
            if (s.up ? (by + r > s.y - s.h) : (by - r < s.y + s.h)) return "SPIKED";
            near = 1;
          }
        }
      }
      if (near) b.graze = Math.min(b.graze + 0.06, 0.5);
      return null;
    }

    function step(dt, t) {
      const attract = phase === "title";
      const pre = phase === "claim" || phase === "countdown";
      const running = phase === "play" || attract || pre || phase === "over";

      if (running) {
        const D = DIFF[settings.diff];
        if (phase === "play") elapsed += dt;
        const rel = attract ? 0.62 : clamp(D.v0 + D.ramp * elapsed, 0, D.cap);
        scroll = clamp(rel * U, 0, W * 0.62);
        const slow = phase === "countdown" ? 0.22 : phase === "claim" ? 0.09 : phase === "over" ? 0.22 : 1;
        camX += scroll * slow * dt;
        ensureCourse(camX + W);
      }

      // Before the round starts the creatures hover, unhurt, at the hatch
      // point. Real gravity from the moment the band is claimed would drop
      // every one of them into the floor before the countdown finished.
      if (pre) {
        for (const b of birds) {
          const band = bands[b.i];
          // Hovering at the middle of the BAND drops a creature into the rock
          // wherever its tunnel happens to be meandering; hover at the middle
          // of the tunnel instead.
          const lane = lanes[b.i];
          let mid = 0.5;
          if (lane) { profile((camX + HOME) / U, _pf, lane); mid = (_pf[0] + _pf[1]) / 2; }
          b.n = mid + 0.035 * Math.sin(t * 2.2 + b.i * 1.4);
          b.vn = 0; b.sx = HOME; b.vx = 0;
          if (b.held && b.wingV > -3) b.wingV = -7;
          b.wing += b.wingV * dt;
          b.wingV += (0 - b.wing) * 92 * dt;
          b.wingV *= Math.pow(0.02, dt);
          b.trail.unshift({ x: b.sx, y: band.top + b.n * U });
          if (b.trail.length > 7) b.trail.pop();
        }
      }

      for (const b of pre ? [] : birds) {
        const band = bands[b.i];
        if (!b.alive) {
          if (attract && now() > b.respawnAt) {
            b.alive = true; b.n = 0.5; b.vn = 0; b.sx = HOME; b.vx = 0; b.trail.length = 0;
          }
          continue;
        }

        const held = attract ? autoHold(b) : b.held;
        if (held) {
          b.flapT += dt;
          const per = 1 / FLAP_HZ;
          let guard = 0;
          while (b.flapT >= per && guard++ < 4) { b.flapT -= per; flap(b, false); }
        } else {
          b.flapT = per_reset(b);
        }

        // Vertical: strong gravity, discrete flaps, a terminal speed from drag.
        b.vn += GRAV * dt;
        b.vn *= Math.pow(0.992, dt * 60);
        b.vn = clamp(b.vn, -VUP, VDOWN);
        b.n += b.vn * dt;

        // Horizontal: flapping carries you forward, falling lets the cave
        // reel you back toward the wall. There is no left/right control and
        // there never will be — this is the whole tension of the game.
        //
        // The numbers are tuned around one number: 0.56, the fraction of the
        // time on the pad that exactly holds altitude. Holding POSITION has to
        // cost a little more than that, so that banking distance means working
        // for it — climbing hard and diving back through the gap you were
        // aiming for anyway. That is the rhythm the whole game is made of.
        //
        // It used to cost a lot more: 0.69, against the 0.40 that flying
        // neatly down the middle of the tunnel actually allows. A player who
        // threaded the cave perfectly lost 29px a second in a 206px corridor
        // and was dead in three, with nothing on screen explaining why — the
        // game punished good flying and rewarded a rhythm it never taught.
        //
        // Measured with a pilot holding the middle of the tunnel, the
        // multiplier below gives:
        //   0.64  -29px/s   dead against the wall in ~3s
        //   0.58  -20px/s   dead against the wall in ~7s
        //   0.52  -10px/s   dead against the wall in ~11s
        //   0.50   -7px/s   76m, and the cave kills it instead
        //   0.42  +11px/s   pinned against XMAX, no pressure at all
        // 0.52 puts holding POSITION at the same 0.56 on the pad as holding
        // ALTITUDE: hovering exactly breaks even, anything lazier is reeled
        // in, and the climb-and-dive rhythm — around 0.61 — buys ground. The
        // wall is a weight on every flight again without being the thing that
        // ends a good one, and it is three times more forgiving than the
        // number that made a perfectly flown creature dead in three seconds.
        //
        // No flight lasts forever, which is what a distance record wants, but
        // that now comes from the ramp rather than from the opening seconds:
        // the pull is the cave advancing, so it scales with the scroll, and by
        // the time the scroll reaches its cap no duty cycle holds station.
        const idle = -scroll * 0.52;
        b.vx += (idle - b.vx) * (1 - Math.pow(0.16, dt));
        b.vx = clamp(b.vx, -U * 0.35, U * 0.75);   // same values at four players, in band units
        b.sx += b.vx * dt;
        if (b.sx > XMAX) { b.sx = XMAX; if (b.vx > 0) b.vx *= 0.4; }

        b.wingV += (held ? -2 : 0);
        b.wing += b.wingV * dt;
        b.wingV += (0 - b.wing) * 92 * dt;
        b.wingV *= Math.pow(0.02, dt);
        b.graze = Math.max(0, b.graze - dt * 1.6);

        // Three-frame positional lag on the tendrils.
        b.trail.unshift({ x: b.sx, y: band.top + b.n * U });
        if (b.trail.length > 7) b.trail.pop();

        if (phase === "play") {
          b.dist = (camX - originX + b.sx - HOME) / U * METRE;
          if (b.dist > b.best) b.best = b.dist;
          if (b.best > b.milestone + 250) {
            b.milestone = Math.floor(b.best / 250) * 250;
            sound.sting("coin");
          }
        }

        if (b.n < -0.2 || b.n > 1.2) { kill(b, "CRUSHED"); continue; }
        const c = collide(b, t);
        if (c) kill(b, c);
      }

      // Particles.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.t += dt;
        if (p.t >= p.life) { particles.splice(i, 1); continue; }
        if (p.k === "shard" || p.k === "puff") {
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vy += U * 3.4 * dt;
          p.vx -= scroll * dt * 0.55;
          if (p.k === "shard") p.rot += p.spin * dt;
        }
      }

      // Dust motes drift with the cave and bob.
      for (const m of motes) {
        m.x -= scroll * m.sp * dt;
        if (m.x < -6) { m.x = W + 6; m.y = hf(Math.floor(now()) % 9973, 419) * H; }
        m.bob += m.bobF * dt;
      }

      if (shake > 0.01) shake *= Math.pow(0.0009, dt);
      if (flash > 0) flash = Math.max(0, flash - dt * 3.4);
      if (hourFade < 1) hourFade = Math.min(1, hourFade + dt * 0.7);

      if (phase === "play") {
        const alive = birds.filter((b) => b.alive);
        roundBest = Math.max(roundBest, ...birds.map((b) => b.best));
        const nextHour = Math.min(HOURS.length - 1, Math.floor(roundBest / 320)) % HOURS.length;
        if (nextHour !== hourIdx) { hourPrev = hourIdx; hourIdx = nextHour; hourFade = 0; sound.sting("powerup"); }
        const heat = clamp(elapsed / 70 + (alive.length === 1 ? 0.35 : 0), 0, 1);
        if (Math.abs(heat - lastHeat) > 0.06) { lastHeat = heat; sound.heat(heat); }
        if (alive.length === 0) endRound();
      }
    }
    // Holding resets the flap phase so the first flap of a press is instant.
    function per_reset() { return 1 / FLAP_HZ; }

    /* ===============================================================
     * ROUND FLOW
     * ============================================================= */
    let claimUntil = 0, countFrom = 0, lastHeat = -1;

    function beginFlight() {
      resetWorld(newSeed());
      phase = "claim";
      claimUntil = now() + 2600;
      shell.el("title").style.display = "none";
      shell.el("over").style.display = "none";
      paintHud();
    }

    function startCountdown() {
      phase = "countdown";
      countFrom = now();
      sound.sting("success");
    }

    function goLive() {
      phase = "play";
      elapsed = 0;
      originX = camX;
      for (const b of birds) b.hatch = 1;
      ctx.platform.start({ players: settings.players, difficulty: DIFF[settings.diff].name });
      sound.sting("powerup");
    }

    async function endRound() {
      phase = "over";
      overAt = now();
      // Last one flying: whoever got furthest. Ties go to the lower seat, which
      // only happens if two creatures die in the same frame at the same x.
      let w = 0;
      for (let i = 1; i < birds.length; i++) if (birds[i].best > birds[w].best) w = i;
      winner = w;
      const flight = Math.round(Math.max(...birds.map((b) => b.best)));
      roundBest = flight;
      // The counter in the chrome strip only advances while phase is "play",
      // so without this it freezes one metre short of the number the results
      // card is showing directly underneath it.
      lastDist = flight;
      shell.el("dist").textContent = fmt(flight);
      const fresh = flight > settings.best;
      if (fresh) { settings.best = flight; save(); }
      sound.duck(0.6, 500);
      sound.sting("win");
      sound.haptic("heavy");
      flash = 1;

      const solo = birds.length === 1;
      shell.el("over-who").textContent = solo
        ? (fresh ? "A NEW BEST FLIGHT" : "FLIGHT OVER")
        : CREW[w].name + " FLEW FURTHEST";
      shell.el("over-who").style.color = CREW[w].ink;
      shell.el("over-dist").textContent = fmt(flight);
      shell.el("over-note").textContent = (fresh && !solo)
        ? "A NEW BEST FLIGHT" : "BEST FLIGHT " + fmt(settings.best) + " M";
      shell.el("over-list").style.display = solo ? "none" : "";
      shell.el("over-list").innerHTML = birds
        .map((b, i) => ({ b, i }))
        .sort((a, c) => c.b.best - a.b.best)
        .map(({ b, i }) =>
          '<div style="display:flex;align-items:center;gap:9px;padding:7px 0;' +
            'border-bottom:1px solid rgba(255,255,255,0.06);">' +
            '<span style="width:9px;height:9px;border-radius:50%;background:' + CREW[i].ink +
              ';box-shadow:0 0 10px ' + CREW[i].ink + ';flex:none;"></span>' +
            '<span style="flex:1;text-align:left;font-family:' + DISP + ';font-size:17px;letter-spacing:0.13em;' +
              'color:' + CREW[i].ink + ';">' + esc(CREW[i].name) + '</span>' +
            // nowrap: LEFT BEHIND is two words, and left to wrap it makes one
            // row twice the height of the others and knocks the column out.
            '<span style="font-size:10.5px;letter-spacing:0.18em;opacity:0.64;flex:none;' +
              'white-space:nowrap;">' + esc(b.cause || "OUT") + '</span>' +
            '<span style="font-family:' + DISP + ';font-size:19px;letter-spacing:0.06em;width:62px;' +
              'text-align:right;">' + fmt(Math.round(b.best)) + '</span>' +
          '</div>').join("");
      shell.el("over").style.display = "flex";

      ctx.platform.setScore(flight);
      ctx.platform.complete({ winner: w + 1, metres: flight, players: settings.players });
      // The record is a property of the FLIGHT — how far this cave let this
      // group of people get — not of whichever of them happened to hold on
      // longest. That is the honest number for a game played on one phone.
      try { await ctx.memory.record("furthest_flight").submit(flight, { label: flight + " m" }); }
      catch (_) { /* offline is fine; the flight still happened */ }
    }

    const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    /* ===============================================================
     * RENDER
     * ============================================================= */
    const sampleC = [], sampleF = [], shapes = [];
    const SAMPLE_STEP = 7;

    function drawFrame(t) {
      g.setTransform(RSCALE, 0, 0, RSCALE, 0, 0);
      g.save();
      if (shake > 0.02) g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

      /* --- backdrop: sky, forest, fog and motes, all at 1x ----------- */
      const hour = HOURS[hourIdx];
      const br = hour.blooms[0];
      const bg = backdropG || g;                        // no OffscreenCanvas: straight to screen
      paintBackdrop(bg, hour, br, t);
      if (backdrop) g.drawImage(backdrop, 0, 0, W, H);

      const cols = Math.ceil(W / SAMPLE_STEP) + 2;

      /* --- per-band: ghost numeral, rock, hazards, creature ---------- */
      for (const band of bands) {
        const b = birds[band.i];
        const lane = lanes[band.i];
        const crew = CREW[band.i];
        if (!lane) continue;
        const dim = b && !b.alive && phase !== "title";

        // The player's own distance, huge and ghosted, sitting in their own
        // sky. Drawn before the rock so the cave silhouettes across it.
        g.save();
        g.globalAlpha = dim ? 0.11 : 0.19;
        g.fillStyle = crew.ink;
        g.textAlign = "right";
        g.textBaseline = "middle";
        if (phase === "countdown") {
          // The countdown owns the middle of every band for these three
          // seconds; a ghosted name under it is just two things in one place.
        } else if (phase !== "play" && phase !== "over") {
          // A seven-letter name set at numeral size runs clean off the screen.
          tracked(g, crew.name, W - U * 0.10, band.mid, Math.min(34, U * 0.20), 5);
        } else {
          /*
           * Ghosted at one alpha over four different skies, this number was
           * bold over the teal band and completely gone over the band where
           * a bloom happened to sit behind it — and it is the only running
           * feedback a player gets on their own flight. A black underlay
           * carries it: invisible against dark rock, an edge against a hot
           * bloom, which is the same trick the silhouettes themselves use.
           */
          const txt = fmt(b ? Math.round(b.best) : 0);
          const gx = W - U * 0.10, gy = band.mid + U * 0.02;
          g.font = "700 " + Math.round(U * 0.62) + "px " + DISP;
          g.globalAlpha = dim ? 0.10 : 0.17;
          g.fillStyle = "#000";
          g.fillText(txt, gx + U * 0.014, gy + U * 0.016);
          g.globalAlpha = dim ? 0.14 : 0.25;
          g.fillStyle = crew.ink;
          g.fillText(txt, gx, gy);
        }
        g.restore();

        // Every glow this band needs, in a single 'lighter' pass: the light
        // behind each hazard and the halo around the creature. Drawn before
        // the rock, so a glow never spills out of the tunnel it belongs to.
        shapes.length = 0;
        for (const h of lane.hazards) {
          const hx = h.x - camX;
          if (hx < -U * 1.6 || hx > W + U * 1.6) continue;
          shapes.push(hazardAt(h, t, band, lane));
        }
        g.save();
        g.globalCompositeOperation = "lighter";
        g.beginPath(); g.rect(0, band.top, W, U); g.clip();
        for (const sh of shapes) hazardGlow(sh, hour, dim);
        if (b && b.alive) {
          glow(b.sx, band.top + b.n * U, R_N * U * (3.1 + b.graze * 2.2),
               crew.rgb, (dim ? 0.10 : 0.34) + b.graze * 0.5);
        }
        g.restore();

        // Rock: everything above the ceiling and below the floor, pure #000.
        for (let i = 0; i < cols; i++) {
          profile((camX + i * SAMPLE_STEP) / U, _pf, lane);
          sampleC[i] = _pf[0]; sampleF[i] = _pf[1];
        }
        g.fillStyle = "#000";
        g.beginPath();
        g.moveTo(-4, band.top - 2);
        for (let i = 0; i < cols; i++) g.lineTo(i * SAMPLE_STEP, band.top + sampleC[i] * U);
        g.lineTo(W + 4, band.top - 2);
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(-4, band.bot + 2);
        for (let i = 0; i < cols; i++) g.lineTo(i * SAMPLE_STEP, band.top + sampleF[i] * U);
        g.lineTo(W + 4, band.bot + 2);
        g.closePath();
        g.fill();

        // Boulders: a chain of tangent discs on a fixed world lattice, which
        // is what makes the outline read as lumpy rock rather than a curve.
        const cell = U * 0.55;
        const i0 = Math.floor(camX / cell) - 1;
        g.beginPath();
        for (let k = 0; k <= Math.ceil(W / cell) + 2; k++) {
          const idx = i0 + k;
          const salt = 601 + band.i * 97;
          const wx = idx * cell + hf(idx, salt) * cell * 0.7;
          const sx = wx - camX;
          if (sx < -U || sx > W + U) continue;
          profile(wx / U, _pf, lane);
          const rr = U * (0.045 + hf(idx, salt + 1) * 0.075);
          const onCeil = hf(idx, salt + 2) < 0.5;
          const y = band.top + (onCeil ? _pf[0] * U - rr * 0.55 : _pf[1] * U + rr * 0.55);
          g.moveTo(sx + rr, y);
          g.arc(sx, y, rr, 0, TAU);
        }
        g.fill();

        // Hazards, clipped to their own band so a floor-mounted blade can
        // never poke into the neighbour's tunnel.
        g.save();
        g.beginPath();
        g.rect(0, band.top, W, U);
        g.clip();
        g.fillStyle = "#000";
        for (const sh of shapes) drawHazard(sh);
        g.restore();

        // The wall: black, wavy-edged, glowing in its owner's colour. It is
        // the lethal boundary and the place the thumb rests, both at once.
        drawWall(band, crew, b, t, dim);

        if (b) drawBird(b, band, crew, t, dim);

        if (dim) {
          // Plain source-over rather than 'multiply': over an already dark
          // palette the two are indistinguishable, and 'multiply' is one of
          // the few blend modes that costs a full extra pass.
          g.fillStyle = "rgba(0,0,0,0.66)";
          g.fillRect(0, band.top, W, U);
          // Not during the results card: every one of these causes is listed
          // there in full, and four of them ghosting up through the panel
          // collide with the rows that are actually being read.
          if (phase !== "over") {
            g.save();
            g.globalAlpha = 0.62;
            g.fillStyle = crew.ink;
            g.textAlign = "center";
            g.textBaseline = "middle";
            // Centred in the tunnel, not on the screen: the wall down the
            // left is a solid black column, so the visible strip is what
            // this label has to look centred in.
            tracked(g, "OUT · " + b.cause, (WALL + W) / 2, band.mid,
                    Math.min(15, U * 0.105), 3.2);
            g.restore();
          }
        }
      }

      /* --- particles -------------------------------------------------- */
      for (const p of particles) {
        const k = 1 - p.t / p.life;
        if (p.k === "flash") {
          bloom(p.x, p.y, p.r * (1 + (1 - k) * 2.4), [255, 255, 246], k * 0.85);
          bloom(p.x, p.y, p.r * (0.6 + (1 - k) * 1.6), p.col, k * 0.5);
        } else if (p.k === "shard") {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = "#000";
          g.globalAlpha = Math.min(1, k * 1.6);
          g.beginPath();
          g.moveTo(-p.r, -p.r * 0.5); g.lineTo(p.r * 1.2, 0); g.lineTo(-p.r * 0.7, p.r * 0.8);
          g.closePath(); g.fill();
          g.restore();
        } else {
          g.globalAlpha = k * 0.5;
          g.fillStyle = "#000";
          g.beginPath(); g.arc(p.x, p.y, p.r * k, 0, TAU); g.fill();
          g.globalAlpha = 1;
        }
      }

      /* --- cave mouth: an irregular organic band top and bottom ------- */
      caveFrame(t);

      /* --- claim / countdown prompts ---------------------------------- */
      if (phase === "claim") drawClaim(t);
      if (phase === "countdown") drawCount(t);

      /* The one thing a first-time player does not work out on their own:
       * a wing beat is forward as well as up, and letting the creature glide
       * a tidy line down the middle of the tunnel hands it to the dark edge.
       * Shown over the wall itself, for the first few seconds of the first
       * flight anybody has flown on this phone, and never again. */
      if (phase === "play" && settings.best < 30 && elapsed < 3.6) {
        g.save();
        g.globalAlpha = clamp(Math.min(elapsed / 0.5, (3.6 - elapsed) / 0.8), 0, 1) * 0.92;
        g.textAlign = "left"; g.textBaseline = "middle";
        // Fitted to the tunnel rather than set at a fixed size: at 11px with
        // 2.2 of tracking this line is 350px wide, which runs off the right
        // edge of the 306px card the app embeds the bit in and loses the two
        // words that carry the whole point.
        const HINT = "KEEP BEATING — THE DARK PULLS YOU BACK";
        let hs = Math.min(11, U * 0.085), ht = 2.2;
        const room = W - WALL - 20;
        const want = trackW(g, HINT, hs, ht);
        if (want > room) { const k = room / want; hs *= k; ht *= k; }
        for (const band of bands) {
          platedLine(g, HINT, WALL + 10, band.mid - U * 0.30, hs, ht, "#FFE9B8", 1);
        }
        g.restore();
        g.globalAlpha = 1;
      }
      if (phase === "play" && birds.filter((x) => x.alive).length === 1 && birds.length > 1) {
        const b = birds.find((x) => x.alive);
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        platedLine(g, "LAST WING", W / 2, PLAY_TOP + 12, 13, 5, CREW[b.i].ink,
                   0.68 + 0.28 * Math.sin(t * 5));
        g.restore();
      }

      /* --- grain and vignette, in one pass ------------------------------ */
      if (finish) {
        g.drawImage(finish, -5 + ((t * 37) % 9), -5 + ((t * 53) % 9));
      } else {
        const vg = g.createRadialGradient(W * 0.5, H * 0.48, H * 0.26, W * 0.5, H * 0.5, H * 0.80);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(0.66, "rgba(0,0,0,0.22)");
        vg.addColorStop(1, "rgba(0,0,0,0.74)");
        g.fillStyle = vg;
        g.fillRect(0, 0, W, H);
      }

      if (flash > 0) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = flash * 0.20;
        g.fillStyle = "#fff";
        g.fillRect(0, 0, W, H);
        g.restore();
      }
      g.restore();
    }

    /** Sky, three forest layers, one drifting fog band and the dust. */
    function paintBackdrop(bg, hour, br, t) {
      const sky = skyFor(hourIdx);
      if (sky) {
        if (hourFade < 1) {
          const prev = skyFor(hourPrev);
          if (prev) bg.drawImage(prev, 0, 0, W, H);
          bg.globalAlpha = hourFade;
          bg.drawImage(sky, 0, 0, W, H);
          bg.globalAlpha = 1;
        } else {
          bg.drawImage(sky, 0, 0, W, H);
        }
      } else {
        paintSky(bg, hour, W, H);                       // no OffscreenCanvas: live
      }

      // The sky breathes from its core only. Pulsing the whole bloom would
      // mean compositing a disc most of the screen wide on every frame.
      bg.save();
      bg.globalCompositeOperation = "lighter";
      bg.globalAlpha = 0.30 + 0.10 * Math.sin(t * 1.6);
      const bs = bloomSprite(hour.ray);
      const brr = H * (0.15 + 0.008 * Math.sin(t * 1.6));
      if (bs) bg.drawImage(bs, W * br.x - brr, H * br.y - brr, brr * 2, brr * 2);
      bg.restore();

      // Parallax forest, wrapped as two sub-rectangles rather than two
      // whole-screen blits — the naive version alpha-blends twice the
      // display for every layer.
      const alphas = [0.22, 0.44, 0.78];
      const rates = [0.05, 0.12, 0.24];
      for (let i = 0; i < 3; i++) {
        if (!forest[i]) continue;
        const cut = (camX * rates[i]) % W;
        bg.globalAlpha = alphas[i];
        if (W - cut > 0.5) bg.drawImage(forest[i], cut, 0, W - cut, H, 0, 0, W - cut, H);
        if (cut > 0.5) bg.drawImage(forest[i], 0, 0, cut, H, W - cut, 0, cut, H);
        bg.globalAlpha = 1;
      }

      bg.save();
      bg.globalCompositeOperation = "lighter";
      const fy = H * (0.5 + 0.16 * Math.sin(t * 0.22));
      const fg = bg.createLinearGradient(0, fy - H * 0.16, 0, fy + H * 0.16);
      fg.addColorStop(0, rgba(hour.fog, 0));
      fg.addColorStop(0.5, rgba(hour.fog, 0.05));
      fg.addColorStop(1, rgba(hour.fog, 0));
      bg.fillStyle = fg;
      bg.fillRect(0, fy - H * 0.16, W, H * 0.32);

      for (const m of motes) {
        bg.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(m.bob));
        bg.fillStyle = rgba(hour.mote, 1);
        bg.beginPath();
        bg.arc(m.x, m.y + Math.sin(m.bob) * 5, m.r, 0, TAU);
        bg.fill();
      }
      bg.restore();
    }

    /** Heading type with manual tracking — canvas has no letterSpacing. */
    // Set lowercase like the rest of the game. This helper draws one
    // character at a time for its own tracking, and single characters slip
    // past the case fold that every other canvas string goes through.
    function tracked(t, text, x, y, size, track, halo) {
      text = typeof text === "string" ? text.toLowerCase() : text;
      t.font = "700 " + size + "px " + DISP;
      const chars = String(text).split("");
      let total = 0;
      for (const c of chars) total += t.measureText(c).width + track;
      total -= track;
      let cx = t.textAlign === "center" ? x - total / 2 : t.textAlign === "right" ? x - total : x;
      const al = t.textAlign;
      t.textAlign = "left";
      // A halo before the fill. The plate under a label is an ellipse, so a
      // line long enough to reach its ends sits in the feathered part, and
      // one bloom in the cave mouth is enough to swallow the last two words —
      // which is exactly where "the dark pulls you back" ended up.
      if (halo) {
        t.save();
        t.strokeStyle = "rgba(0,0,0,0.82)";
        t.lineWidth = halo;
        t.lineJoin = "round";
        t.miterLimit = 2;
        let hx = cx;
        for (const c of chars) { t.strokeText(c, hx, y); hx += t.measureText(c).width + track; }
        t.restore();
      }
      for (const c of chars) { t.fillText(c, cx, y); cx += t.measureText(c).width + track; }
      t.textAlign = al;
      return total;
    }

    /** The width `tracked` would draw, without drawing it. */
    function trackW(t, text, size, track) {
      t.font = "700 " + size + "px " + DISP;
      let total = 0;
      for (const c of String(text)) total += t.measureText(c).width + track;
      return total - track;
    }

    /**
     * A soft dark plate under a line of type.
     *
     * Every one of these labels is drawn over a lit, moving sky: a magenta
     * word crossing a white bloom is unreadable, and so is a cyan one over
     * black rock. Feathered at both ends so it reads as smoke in the cave
     * rather than as a UI box — same trick as the glows, stacked alpha
     * instead of a blur.
     */
    function inkPlate(t, cx, cy, rx, ry, a) {
      t.save();
      t.translate(cx, cy);
      t.scale(1, ry / rx);
      const gd = t.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
      gd.addColorStop(0, "rgba(0,0,0," + a + ")");
      // The old falloff started at half the radius, which is fine under a
      // three-character label and useless under a sentence: the glyphs at
      // both ends of a long line sit past 0.8 of the radius and got almost
      // no plate at all. Hold it flat across the type, feather only the rim.
      gd.addColorStop(0.62, "rgba(0,0,0," + (a * 0.92).toFixed(3) + ")");
      gd.addColorStop(0.86, "rgba(0,0,0," + (a * 0.46).toFixed(3) + ")");
      gd.addColorStop(1, "rgba(0,0,0,0)");
      t.fillStyle = gd;
      t.fillRect(-rx, -rx, rx * 2, rx * 2);
      t.restore();
    }

    /** A tracked line with its own plate, right- or centre-aligned. */
    function platedLine(t, text, x, y, size, track, colour, alpha) {
      const w = trackW(t, text, size, track);
      const cx = t.textAlign === "right" ? x - w / 2 : x;
      t.save();
      t.globalAlpha = Math.min(1, alpha);
      inkPlate(t, cx, y, w / 2 + size * 2.4, size * 1.7, 0.86);
      t.fillStyle = colour;
      tracked(t, text, x, y, size, track, Math.max(2, size * 0.38));
      t.restore();
      return w;
    }

    /* --- hazards ---------------------------------------------------- */
    /**
     * The light behind a hazard. Pure black on a dark palette can vanish on a
     * dim screen in a bright room, and a blade you cannot see is not a hazard,
     * it is a bug — so every one of them gets a bloom placed behind it.
     */
    function hazardGlow(s, hour, dim) {
      const a = dim ? 0.05 : 0.14;
      if (s.kind === "saw") glow(s.x, s.y, s.r * 2.1, hour.ray, a);
      else if (s.kind === "rotor") glow(s.x, s.y, s.len * 1.5, hour.ray, a * 0.8);
      else if (s.kind === "crusher") glow(s.x + s.w / 2, s.y + s.h * 0.5, s.w * 1.5, hour.ray, a);
      else glow(s.x + s.w / 2, s.y, s.w * 0.8, hour.ray, a * 0.7);
    }

    function drawHazard(s) {
      if (s.kind === "saw") {
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.a);
        g.fillStyle = "#000";
        g.beginPath();
        const teeth = 20;
        for (let i = 0; i < teeth; i++) {
          const a0 = (i / teeth) * TAU;
          const a1 = ((i + 0.5) / teeth) * TAU;
          const a2 = ((i + 1) / teeth) * TAU;
          const rk = s.r * 1.30, rake = 0.13;
          if (i === 0) g.moveTo(Math.cos(a0) * s.r, Math.sin(a0) * s.r);
          else g.lineTo(Math.cos(a0) * s.r, Math.sin(a0) * s.r);
          g.lineTo(Math.cos(a1 - rake) * rk, Math.sin(a1 - rake) * rk);
          g.lineTo(Math.cos(a2) * s.r, Math.sin(a2) * s.r);
        }
        g.closePath();
        g.fill();
        // Three faint inner cutouts — the only interior detail anything gets.
        g.strokeStyle = "#141414";
        g.lineWidth = Math.max(1.2, s.r * 0.055);
        for (const f of [0.34, 0.54, 0.74]) {
          g.beginPath();
          g.arc(0, 0, s.r * f, 0.5, 0.5 + TAU * 0.72);
          g.stroke();
        }
        g.fillStyle = "#000";
        g.beginPath(); g.arc(0, 0, s.r * 0.20, 0, TAU); g.fill();
        g.restore();
        return;
      }
      if (s.kind === "rotor") {
        // Mast back to the rock, so the hub is bolted to something.
        g.strokeStyle = "#000";
        g.lineWidth = s.w * 0.85;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(s.x, Math.abs(s.y - s.ceilY) < Math.abs(s.y - s.floorY) ? s.ceilY - 2 : s.floorY + 2);
        g.stroke();
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.a);
        g.fillStyle = "#000";
        for (let k = 0; k < s.blades; k++) {
          g.save();
          g.rotate((k / s.blades) * TAU);
          g.beginPath();
          g.moveTo(0, -s.w * 1.05);
          g.quadraticCurveTo(s.len * 0.72, -s.w * 1.5, s.len, -s.w * 0.42);
          g.lineTo(s.len, s.w * 0.42);
          g.quadraticCurveTo(s.len * 0.72, s.w * 1.5, 0, s.w * 1.05);
          g.closePath();
          g.fill();
          g.restore();
        }
        g.beginPath(); g.arc(0, 0, s.w * 1.5, 0, TAU); g.fill();
        g.strokeStyle = "#141414";
        g.lineWidth = Math.max(1, s.w * 0.3);
        g.beginPath(); g.arc(0, 0, s.w * 0.85, 0, TAU); g.stroke();
        g.restore();
        return;
      }
      if (s.kind === "crusher") {
        g.fillStyle = "#000";
        // A slab with a lumpy leading face — machinery here is hard-edged but
        // the rock it is bolted into is not.
        const r = Math.min(s.w * 0.22, s.h * 0.4);
        const yTop = s.y, yBot = s.y + s.h;
        g.beginPath();
        g.moveTo(s.x, yTop);
        g.lineTo(s.x + s.w, yTop);
        g.lineTo(s.x + s.w, yBot - r);
        g.quadraticCurveTo(s.x + s.w, yBot, s.x + s.w - r, yBot);
        g.lineTo(s.x + r, yBot);
        g.quadraticCurveTo(s.x, yBot, s.x, yBot - r);
        g.closePath();
        g.fill();
        // Teeth on the crushing face.
        const tn = Math.max(3, Math.round(s.w / 10));
        g.beginPath();
        for (let i = 0; i < tn; i++) {
          const x0 = s.x + (i / tn) * s.w, x1 = s.x + ((i + 1) / tn) * s.w;
          const dir = s.h >= 0 ? 1 : -1;
          g.moveTo(x0, yBot);
          g.lineTo((x0 + x1) / 2, yBot + dir * s.w * 0.10);
          g.lineTo(x1, yBot);
        }
        g.fill();
        if (s.arming) {
          g.save();
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = 0.5;
          g.strokeStyle = "#FFFFF4";
          g.lineWidth = 1.2;
          g.setLineDash([5, 6]);
          g.beginPath();
          g.moveTo(s.x + s.w / 2, s.y + s.h);
          g.lineTo(s.x + s.w / 2, s.y + s.h + s.w * 1.5);
          g.stroke();
          g.setLineDash([]);
          g.restore();
        }
        return;
      }
      // Spikes: a row of needles growing out of the rock.
      g.fillStyle = "#000";
      const n = Math.max(3, Math.round(s.w / (s.h * 0.85)));
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x0 = s.x + (i / n) * s.w, x1 = s.x + ((i + 1) / n) * s.w;
        const dir = s.up ? -1 : 1;
        g.moveTo(x0, s.y);
        g.lineTo((x0 + x1) / 2, s.y + dir * s.h);
        g.lineTo(x1, s.y);
      }
      g.fill();
    }

    /* --- the wall --------------------------------------------------- */
    function drawWall(band, crew, b, t, dim) {
      const held = b && b.held && phase !== "title";
      const edge = WALL;
      g.save();
      g.beginPath();
      g.rect(0, band.top, edge + 34, U);
      g.clip();

      // Black column with a slow organic wobble on its inner face.
      g.fillStyle = "#000";
      g.beginPath();
      g.moveTo(0, band.top - 2);
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        const y = band.top + p * U;
        const x = edge + Math.sin(p * 5.1 + t * 0.55 + band.i * 2.1) * 7.5
                       + Math.sin(p * 11.3 + t * 0.31) * 3.6
                       + Math.sin(p * 2.3 + band.i) * 4.0;
        g.lineTo(x, y);
      }
      g.lineTo(0, band.bot + 2);
      g.closePath();
      g.fill();
      // Boulders on the inner face, so the column reads as the edge of the
      // cave rather than a rectangle of chrome.
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const p = (k + 0.5) / 7;
        const rr = U * (0.045 + hf(k + band.i * 9, 811) * 0.075);
        g.moveTo(edge + rr * 0.4, band.top + p * U);
        g.arc(edge - rr * 0.25, band.top + p * U + hf(k, 813) * 10, rr, 0, TAU);
      }
      g.fill();

      // Rim light in the owner's colour: the only way to find your own band
      // at a glance, and it flares the instant a finger lands on it.
      g.globalCompositeOperation = "lighter";
      // Wide and soft, so it reads as light bleeding off the edge of the
      // rock rather than a neon strip stuck to the side of the screen.
      const a = (dim ? 0.14 : held ? 0.90 : 0.38) * (0.86 + 0.14 * Math.sin(t * 2.2 + band.i));
      const grd = g.createLinearGradient(edge - 6, 0, edge + 42, 0);
      grd.addColorStop(0, rgba(crew.rgb, a * 0.55));
      grd.addColorStop(0.10, rgba(crew.rgb, a));
      grd.addColorStop(0.34, rgba(crew.rgb, a * 0.26));
      grd.addColorStop(1, rgba(crew.rgb, 0));
      g.fillStyle = grd;
      g.fillRect(edge - 8, band.top, 52, U);
      g.restore();

      // Faint tint over the whole band, so the zone reads as owned without
      // ever tinting a silhouette.
      g.save();
      g.globalCompositeOperation = "lighter";
      const bg = g.createLinearGradient(0, 0, W * 0.5, 0);
      bg.addColorStop(0, rgba(crew.rgb, dim ? 0.012 : held ? 0.070 : 0.034));
      bg.addColorStop(1, rgba(crew.rgb, 0));
      g.fillStyle = bg;
      g.fillRect(0, band.top, W * 0.5, U);
      g.restore();

      // Hold chevrons on the pad, fading once the round is under way.
      const hint = phase === "claim" || phase === "countdown" || (phase === "title");
      if (hint && !dim) {
        g.save();
        g.globalAlpha = 0.30 + (held ? 0.45 : 0.22 * (0.5 + 0.5 * Math.sin(t * 3 + band.i)));
        g.strokeStyle = crew.ink;
        g.lineWidth = 2;
        g.lineCap = "round";
        for (let k = 0; k < 3; k++) {
          const yy = band.mid + (k - 1) * 11;
          g.beginPath();
          g.moveTo(edge * 0.30, yy + 5);
          g.lineTo(edge * 0.50, yy - 3);
          g.lineTo(edge * 0.70, yy + 5);
          g.stroke();
        }
        g.restore();
      }
    }

    /* --- the creature ------------------------------------------------ */
    function drawBird(b, band, crew, t, dim) {
      if (!b.alive) return;
      const x = b.sx, y = band.top + b.n * U;
      const r = R_N * U;
      const sp = Math.hypot(b.vx, b.vn * U);
      const sq = 1 + clamp(sp / (U * 9), 0, 0.26);
      const ang = Math.atan2(b.vn * U, Math.max(40, b.vx + scroll)) * 0.5;

      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.scale(sq, 1 / sq);

      // Trailing tendrils, lagging three frames behind the body.
      g.strokeStyle = "#000";
      g.lineCap = "round";
      // Five of them, splayed outward and of different lengths. Hung
      // parallel they overlap into one black slab and the creature stops
      // reading as a creature.
      const tail = b.trail[Math.min(b.trail.length - 1, 4)] || { x, y };
      const lagX = (tail.x - x) * 0.5 - 5, lagY = (tail.y - y) * 0.5;
      for (let k = 0; k < 5; k++) {
        const u = (k - 2) / 2;
        const off = u * r * 0.44;
        const len = r * (1.60 - Math.abs(u) * 0.50);
        g.lineWidth = r * (0.27 - Math.abs(u) * 0.09);
        g.beginPath();
        g.moveTo(off * 0.6, r * 0.50);
        g.quadraticCurveTo(off * 1.7 + lagX * 0.4, r * 0.85 + len * 0.45,
                           off * 2.5 + lagX, r * 0.65 + len + lagY);
        g.stroke();
      }

      // Wings: two scalloped sheets that sweep on every flap.
      const beat = clamp(b.wing, -1.2, 0.5);
      for (const side of [-1, 1]) {
        g.save();
        g.scale(side, 1);
        g.rotate(beat * 0.75);
        g.fillStyle = "#000";
        g.beginPath();
        g.moveTo(r * 0.15, -r * 0.25);
        g.quadraticCurveTo(r * 1.5, -r * 1.55, r * 2.35, -r * 0.55);
        g.quadraticCurveTo(r * 2.05, -r * 0.10, r * 2.25, r * 0.30);
        g.quadraticCurveTo(r * 1.75, r * 0.24, r * 1.60, r * 0.62);
        g.quadraticCurveTo(r * 1.20, r * 0.30, r * 0.95, r * 0.66);
        g.quadraticCurveTo(r * 0.55, r * 0.34, r * 0.15, r * 0.55);
        g.closePath();
        g.fill();
        g.restore();
      }

      // Body: a fuzzy ball with a jagged fur fringe.
      g.fillStyle = "#000";
      g.beginPath();
      const fringe = 30;
      for (let i = 0; i <= fringe; i++) {
        const a = (i / fringe) * TAU;
        const rr = r * (i % 2 ? 1.16 : 0.97);
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();

      // Two antennae, curling forward.
      g.strokeStyle = "#000";
      g.lineWidth = r * 0.16;
      for (const s2 of [-1, 1]) {
        g.beginPath();
        g.moveTo(r * 0.25 * s2, -r * 0.75);
        g.quadraticCurveTo(r * 0.85 * s2, -r * 1.75, r * 1.45 * s2, -r * 1.35);
        g.stroke();
      }

      // Eyes.
      g.restore();
      g.save();
      g.translate(x, y);
      const look = clamp(b.vx / (W * 0.2), -1, 1);
      // The eyes are the only colour anywhere in the play layer, so they get
      // a real halo — an 8px eye still has to be findable at arm's length.
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const s2 of [-1, 1]) glow(r * 0.40 * s2 + r * 0.20, -r * 0.10, r * 1.5, crew.rgb, dim ? 0.2 : 0.85);
      g.restore();
      for (const s2 of [-1, 1]) {
        const ex = r * 0.40 * s2 + r * 0.20, ey = -r * 0.10;
        g.globalAlpha = dim ? 0.35 : 1;
        g.fillStyle = crew.ink;
        g.beginPath();
        g.ellipse(ex, ey, r * 0.29, r * 0.35, 0, 0, TAU);
        g.fill();
        g.fillStyle = "#FFFFF4";
        g.beginPath();
        g.arc(ex + look * r * 0.10, ey - r * 0.06, r * 0.10, 0, TAU);
        g.fill();
        g.globalAlpha = 1;
      }
      g.restore();
    }

    /* --- cave mouth -------------------------------------------------- */
    function caveFrame(t) {
      g.fillStyle = "#000";
      for (const side of [0, 1]) {
        const base = side ? PLAY_BOT + 5 : PLAY_TOP - 5;
        const dir = side ? 1 : -1;
        g.beginPath();
        g.moveTo(-4, side ? H + 8 : -8);
        for (let i = 0; i <= 46; i++) {
          const p = i / 46, x = p * (W + 8) - 4;
          const wob = 5.5 * Math.sin(i * 0.7 + side * 2.1) + 3 * Math.sin(i * 1.9 + 1.3)
                    + 1.6 * Math.sin(i * 4.3 + t * 0.12);
          g.lineTo(x, base + dir * (wob + 4));
        }
        g.lineTo(W + 4, side ? H + 8 : -8);
        g.closePath();
        g.fill();
      }
    }

    /* --- claim + countdown ------------------------------------------- */
    function drawClaim(t) {
      const left = Math.max(0, claimUntil - now()) / 1000;
      for (const band of bands) {
        const b = birds[band.i], crew = CREW[band.i];
        g.save();
        g.textAlign = "right";
        g.textBaseline = "middle";
        // Right-hand side: the creature hovers on the left, and a label
        // written across it is a label nobody can read. The plate is what
        // keeps it readable over a bloom in one band and black rock in the
        // next — the sky under this line is different in every strip.
        platedLine(g, b.claimed ? crew.name + " READY" : "HOLD YOUR BAND",
                   W - 18, band.mid + U * 0.24, Math.min(16, U * 0.12), 3.4, crew.ink,
                   b.claimed ? 1 : 0.78 + 0.22 * Math.sin(t * 5 + band.i * 1.3));
        g.restore();
      }
      g.save();
      g.textAlign = "center";
      g.textBaseline = "middle";
      platedLine(g, "TAKING OFF IN " + Math.ceil(left), W / 2, PLAY_TOP + 12, 12, 4,
                 HOURS[hourIdx].ink, 0.8);
      g.restore();
    }

    function drawCount(t) {
      const el = (now() - countFrom) / 1000;
      const n = 3 - Math.floor(el);
      if (n <= 0) { goLive(); return; }
      const f = el % 1;
      // easeOutBack, so the numeral lands with weight rather than fading in.
      const k = 1 - f;
      const s = 1.6 - 0.6 * (1 + 2.7 * Math.pow(k, 3) - 3.7 * Math.pow(k, 2));
      const sc = clamp(s, 0.2, 2);
      const size = Math.min(84, U * 0.44);
      /*
       * One numeral per band, in that band's colour, rather than one in the
       * middle of the screen.
       *
       * A single centred numeral lands exactly on a band divider for every
       * even crew size — the one place on this screen nothing may sit — and
       * it belongs to nobody. Per band it clears the dividers, and the three
       * seconds before take-off are also the moment each player learns which
       * colour is theirs.
       */
      for (const band of bands) {
        const crew = CREW[band.i];
        g.save();
        // The fade floor used to be 0.25, which is invisible over the bloom in
        // a lit band — a countdown nobody can read is not a countdown.
        g.globalAlpha = clamp(1 - f * 0.42, 0, 1);
        g.textAlign = "center";
        g.textBaseline = "middle";
        // Right of the creature, which hovers over the pad on the left: a
        // numeral landing on the moth hides the one thing its owner is
        // looking for in the three seconds before the cave starts moving.
        const nx = clamp(HOME + size * 0.95, W * 0.5, W - size * 0.7);
        // The plate scales with the numeral. It did not, and the easeOutBack
        // overshoots to 1.6x — so for the first third of every second the
        // digit was drawn outside its own plate, straight onto whatever the
        // sky happened to be doing.
        inkPlate(g, nx, band.mid, size * 1.5 * sc, size * 0.95 * sc, 0.82);
        g.translate(nx, band.mid);
        g.scale(sc, sc);
        g.font = "700 " + Math.round(size) + "px " + DISP;
        // Outlined as well as plated: a cyan numeral over the sunrise band is
        // two bright colours on top of each other whatever the plate does.
        g.strokeStyle = "rgba(0,0,0,0.6)";
        g.lineWidth = size * 0.1;
        g.lineJoin = "round";
        g.strokeText(String(n), 0, 0);
        g.fillStyle = crew.ink;
        g.fillText(String(n), 0, 0);
        g.restore();
      }
    }

    /* ===============================================================
     * OVERLAY
     *
     * One markup string on the runtime-owned root, handles queried back
     * by [data-el]. The root is pointer-events:none — it is created after
     * the canvas and therefore sits on top of it, so left solid it would
     * swallow every hold meant for a band and the bit would animate
     * beautifully while ignoring all four players.
     * ============================================================= */
    const SAFE_T = ctx.safeArea.top;
    const btn = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:none;" +
      "background:rgba(255,240,214,0.10);color:#FFEFCD;font-size:14px;line-height:1;" +
      "font-family:inherit;padding:0;-webkit-tap-highlight-color:transparent;";
    const bigBtn = (bg, fg) => "pointer-events:auto;width:100%;max-width:250px;padding:15px;border:none;" +
      "border-radius:15px;font-family:" + DISP + ";font-size:19px;font-weight:700;letter-spacing:0.16em;" +
      "background:" + bg + ";color:" + fg + ";margin-top:10px;-webkit-tap-highlight-color:transparent;";
    // 0.45 of #FFEFCD on the settings card is 4.1:1 — under the line, and it
    // reads as grey rather than as quiet cream. These captions are the only
    // thing naming what each row of buttons does.
    const capLine = "font-size:10px;letter-spacing:0.26em;text-transform:lowercase;opacity:0.62;";
    /*
     * The plate the title copy is read against.
     *
     * The old scrim sat at 30% through the middle, which was legible in the
     * one case it was checked in — two players, where the middle of the
     * screen happens to be black rock. At three and four players the same
     * copy lands on a lit sky and a moth flies straight through the
     * wordmark, and the caption lines vanish entirely over a bloom.
     * So: opaque where the words are, and two clear windows above and below
     * where the attract flight still shows through.
     */
    const TITLE_SCRIM =
      "linear-gradient(180deg,rgba(4,7,10,0.80) 0%,rgba(4,7,10,0.34) 15%," +
      "rgba(4,7,10,0.93) 27%,rgba(4,7,10,0.95) 52%,rgba(4,7,10,0.92) 72%," +
      "rgba(4,7,10,0.36) 87%,rgba(4,7,10,0.86) 100%)";
    // A modal, above the chrome strip rather than under it. At z-index 70 the
    // metre counter and the three chrome buttons were painted straight across
    // the first two lines of the rules on any screen short enough for the card
    // to reach the top of the viewport — which is every one the app embeds.
    //
    // box-sizing matters: a div defaults to content-box, so max-height:100% on
    // a padded card caps the CONTENT at the full height and the padding then
    // pushes the card past it. `align-items:safe center` keeps the top edge
    // reachable once the list is taller than the screen; plain `center`
    // overflows equally in both directions and the heading goes out of reach.
    const panel = "position:absolute;inset:0;pointer-events:auto;display:none;align-items:center;" +
      "align-items:safe center;justify-content:center;background:rgba(4,7,10,0.985);z-index:90;" +
      "padding:" + (SAFE_T + 14) + "px 22px 20px;";
    const card = "box-sizing:border-box;max-width:330px;width:100%;max-height:100%;" +
      "display:flex;flex-direction:column;background:#0E1214;border-radius:20px;" +
      "padding:22px;border:1px solid rgba(255,240,214,0.14);";
    // The body scrolls; the way out does not scroll with it. Seven rules are
    // taller than a short screen, and a dismiss button that starts below the
    // fold is a panel with no visible exit.
    const cardBody = "overflow-y:auto;min-height:0;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + BODY + ";color:#FFEFCD;pointer-events:none;" +
      "-webkit-font-smoothing:antialiased;text-transform:lowercase;";

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
      /* --- top chrome strip: distance, hour, buttons ------------------ */
      '<div style="position:absolute;left:0;right:0;top:' + SAFE_T + 'px;height:' + CHROME_H + 'px;' +
        'display:flex;align-items:center;justify-content:space-between;padding:0 12px;' +
        'pointer-events:none;z-index:80;">' +
        '<div style="display:flex;align-items:baseline;gap:6px;">' +
          '<div data-el="dist" style="font-family:' + DISP + ';font-size:29px;font-weight:700;' +
            'letter-spacing:0.05em;line-height:1;text-shadow:0 0 18px rgba(252,220,120,0.35);">0</div>' +
          '<div style="' + capLine + 'opacity:0.6;">m</div>' +
          '<div data-el="hour" style="' + capLine + 'margin-left:7px;">dawn</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;">' +
          '<button data-el="mute" aria-label="Sound" style="' + btn + 'font-size:16px;">&#9835;</button>' +
          '<button data-el="cog" aria-label="Settings" style="' + btn + '">&#9881;</button>' +
          '<button data-el="help" aria-label="How to play" style="' + btn + '">?</button>' +
        '</div>' +
      '</div>' +

      /* --- title ------------------------------------------------------ */
      '<div data-el="title" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;z-index:50;padding:26px;' +
        'text-align:center;background:' + TITLE_SCRIM + ';">' +
        '<div style="' + capLine + 'opacity:0.72;">Every wing beat is height and ground</div>' +
        // line-height has to clear the descender: the fill is clipped to the
        // text's own box, so at 1.0 the tail of the g was simply cut off and
        // the wordmark read as a typo rather than as a layout bug.
        '<div data-el="wordmark" style="font-family:' + DISP + ';font-size:46px;line-height:1.18;' +
          'font-weight:700;white-space:nowrap;letter-spacing:0.11em;margin:8px -0.11em 0 0;' +
          'background:linear-gradient(178deg,#FFF6DE 8%,#FCDC5A 46%,#FA6E1E 92%);' +
          '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;' +
          'color:#FCDC5A;">DUSKWING</div>' +
        '<div style="font-size:13.5px;line-height:1.6;opacity:0.8;max-width:264px;margin-top:8px;">' +
          'The cave never stops. Hold your band to beat your wings, let go to fall, ' +
          'and stay off the dark edge on your left.</div>' +
        '<div style="' + capLine + 'opacity:0.75;margin-top:20px;">How many of you?</div>' +
        '<div data-el="crew" style="display:flex;gap:9px;margin-top:9px;"></div>' +
        '<button data-el="fly" style="' + bigBtn("linear-gradient(96deg,#FCDC5A,#FA6E1E)", "#180800") + '">TAKE FLIGHT</button>' +
        '<div data-el="best" style="' + capLine + 'opacity:0.75;margin-top:14px;"></div>' +
      '</div>' +

      /* --- round over -------------------------------------------------- */
      // Clears the chrome strip rather than sliding under it: the result card
      // is centred, and on a short screen its first caption came up level with
      // the metre counter and the three buttons, which sit above it.
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'box-sizing:border-box;overflow-y:auto;' +
        'flex-direction:column;align-items:center;justify-content:center;z-index:55;' +
        'padding:' + (SAFE_T + CHROME_H + 10) + 'px 26px 26px;' +
        'text-align:center;background:linear-gradient(180deg,rgba(4,7,10,0.985) 0%,rgba(4,7,10,0.94) 22%,' +
        'rgba(4,7,10,0.90) 78%,rgba(4,7,10,0.97) 100%);">' +
        '<div style="' + capLine + '">Flight ends</div>' +
        '<div data-el="over-dist" style="font-family:' + DISP + ';font-size:78px;line-height:0.92;' +
          'font-weight:700;letter-spacing:0.04em;margin-top:2px;">0</div>' +
        '<div style="' + capLine + 'margin-top:-2px;">metres</div>' +
        '<div data-el="over-who" style="font-family:' + DISP + ';font-size:22px;letter-spacing:0.16em;' +
          'margin-top:14px;">—</div>' +
        '<div data-el="over-list" style="width:100%;max-width:280px;margin-top:12px;"></div>' +
        '<div data-el="over-note" style="' + capLine + 'margin-top:12px;"></div>' +
        '<button data-el="again" style="' + bigBtn("linear-gradient(96deg,#FCDC5A,#FA6E1E)", "#180800") + '">FLY AGAIN</button>' +
        '<button data-el="home" style="' + bigBtn("rgba(255,240,214,0.10)", "#FFEFCD") + 'margin-top:8px;">CHANGE CREW</button>' +
      '</div>' +

      /* --- settings ---------------------------------------------------- */
      '<div data-el="cogp" style="' + panel + '">' +
        '<div style="' + card + '">' +
          '<div style="' + cardBody + '">' +
          '<div style="font-family:' + DISP + ';font-size:24px;letter-spacing:0.16em;margin-bottom:16px;">SETTINGS</div>' +
          '<div style="' + capLine + '">Players</div>' +
          '<div data-el="setcrew" style="display:flex;gap:7px;margin:8px 0 16px;"></div>' +
          '<div style="' + capLine + '">The cave</div>' +
          '<div data-el="setdiff" style="display:flex;gap:7px;margin:8px 0 16px;"></div>' +
          '<div style="' + capLine + '">Sound</div>' +
          '<div data-el="setmute" style="display:flex;gap:7px;margin:8px 0 4px;"></div>' +
          '</div>' +
          '<button data-el="cogp-close" style="' + bigBtn("rgba(255,240,214,0.12)", "#FFEFCD") + 'max-width:none;flex:none;">DONE</button>' +
        '</div>' +
      '</div>' +

      /* --- how to play -------------------------------------------------- */
      '<div data-el="helpp" style="' + panel + '">' +
        '<div style="' + card + '">' +
          '<div style="' + cardBody + '">' +
          '<div style="font-family:' + DISP + ';font-size:24px;letter-spacing:0.16em;margin-bottom:10px;">HOW TO FLY</div>' +
          '<ul style="font-size:13.5px;line-height:1.7;opacity:0.86;padding-left:17px;margin:0;">' +
            '<li>Lay the phone flat. Each of you takes one horizontal band — ' +
              'player one has the bottom.</li>' +
            '<li><b>Hold anywhere in your own band</b> and your creature beats its wings. ' +
              'Let go and it falls. That is the only control.</li>' +
            '<li><b>A wing beat carries you forward as well as up</b>, and the cave is ' +
              'always reeling you back toward the dark edge on the left. ' +
              '<b>Touch it and you are gone.</b> Stop beating and it will have you — ' +
              'flying a tidy line down the middle is not enough.</li>' +
            '<li>Rest your thumb on the glowing edge at the left of your band. ' +
              'Everyone presses at once — there are no turns to wait for.</li>' +
            '<li>Saw blades, crushers, rotors and spikes kill on contact. So does the rock.</li>' +
            '<li>Every band gets its own tunnel, dealt from the same deck: ' +
              'the same blades at the same odds, in a different order.</li>' +
            '<li>Whoever flies furthest takes the round. The flight itself — the furthest ' +
              'any of you got — goes to the global board.</li>' +
          '</ul>' +
          '</div>' +
          '<button data-el="helpp-close" style="' + bigBtn("rgba(255,240,214,0.12)", "#FFEFCD") + 'max-width:none;flex:none;">GOT IT</button>' +
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

    /** Pill rows, used by both the title picker and the settings panel. */
    function pills(host, values, labels, get, set, colours) {
      if (!host) return;
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="pointer-events:auto;flex:1;min-width:52px;padding:11px 0;border:none;' +
        'border-radius:12px;font-family:' + DISP + ';font-size:17px;letter-spacing:0.12em;' +
        '-webkit-tap-highlight-color:transparent;">' + esc(labels[i]) + '</button>').join("");
      const paint = () => {
        const kids = host.querySelectorAll("button");
        for (let i = 0; i < kids.length; i++) {
          const on = String(get()) === kids[i].dataset.v;
          const c = colours ? colours[i] : "#FCDC5A";
          // The unselected pills were dim enough to read as disabled controls
          // rather than as the other two things you are allowed to pick.
          kids[i].style.background = on ? "rgba(255,240,214,0.20)" : "rgba(255,240,214,0.11)";
          kids[i].style.color = on ? c : "rgba(255,239,205,0.68)";
          kids[i].style.boxShadow = on ? "inset 0 0 0 2px " + c : "none";
        }
      };
      const kids = host.querySelectorAll("button");
      for (let i = 0; i < kids.length; i++) {
        shell.tap(kids[i], () => { set(values[i]); save(); paint(); sound.haptic("light"); });
      }
      paint();
      return paint;
    }

    function rebuildForCrew() {
      measure();
      seedMotes();
      bakeAll();
      resetWorld(newSeed());
    }

    /* Solo is a real way to play this one: the cave does not care how many
     * creatures are in it, and one band the full height of the screen is the
     * same game with the whole cave to yourself. Everything downstream — the
     * bands, the death test, the round end — is already written over n. */
    const paintCrew = pills(shell.el("crew"), [1, 2, 3, 4], ["solo", "2", "3", "4"],
      () => settings.players, (v) => { settings.players = v; rebuildForCrew(); paintSetCrew && paintSetCrew(); });
    const paintSetCrew = pills(shell.el("setcrew"), [1, 2, 3, 4], ["solo", "2", "3", "4"],
      () => settings.players, (v) => { settings.players = v; rebuildForCrew(); paintCrew && paintCrew(); });
    pills(shell.el("setdiff"), [0, 1, 2], ["GENTLE", "NORMAL", "BRUTAL"],
      () => settings.diff, (v) => { settings.diff = v; });
    const paintMute = pills(shell.el("setmute"), [0, 1], ["ON", "MUTED"],
      () => (settings.mute ? 1 : 0), (v) => {
        if (!!v !== settings.mute) {
          sound.toggle();
          const mb = shell.el("mute");
          mb.style.textDecoration = settings.mute ? "line-through" : "none";
          mb.style.opacity = settings.mute ? "0.5" : "1";
        }
      });

    shell.tap(shell.el("mute"), (e) => {
      const m = sound.toggle();
      const b = e.currentTarget || e.target;
      b.style.textDecoration = m ? "line-through" : "none";
      b.style.opacity = m ? "0.5" : "1";
      paintMute && paintMute();
    });
    if (settings.mute) { shell.el("mute").style.textDecoration = "line-through"; shell.el("mute").style.opacity = "0.5"; }
    shell.tap(shell.el("cog"), () => { shell.el("cogp").style.display = "flex"; });
    shell.tap(shell.el("cogp-close"), () => { shell.el("cogp").style.display = "none"; });
    shell.tap(shell.el("help"), () => { shell.el("helpp").style.display = "flex"; });
    shell.tap(shell.el("helpp-close"), () => { shell.el("helpp").style.display = "none"; });

    shell.tap(shell.el("fly"), async () => { await sound.unlock(); beginFlight(); });
    shell.tap(shell.el("again"), async () => {
      await sound.unlock();
      beginFlight();
      ctx.platform.interact({ type: "replay" });
    });
    shell.tap(shell.el("home"), () => {
      phase = "title";
      shell.el("over").style.display = "none";
      shell.el("title").style.display = "flex";
      resetWorld(newSeed());
      paintHud();
    });

    function paintHud() {
      shell.el("best").textContent = settings.best ? "BEST FLIGHT " + fmt(settings.best) + " M" : "NO FLIGHT LOGGED YET";
    }

    /*
     * The wordmark is one unbreakable word set in a condensed face, so it
     * cannot reflow — at 50px it ran the full width of a 390pt phone and was
     * clipped at both ends on a 320pt one. Sized off the real width instead
     * of a fixed number, and re-fitted on rotate.
     */
    function fitWordmark() {
      const el = shell.el("wordmark");
      if (!el) return;
      el.style.fontSize = Math.max(26, Math.min(50, (ctx.width - 62) / 7.05)) + "px";
    }
    fitWordmark();
    paintHud();

    /* ===============================================================
     * INPUT
     *
     * A pointer is bound to the band it landed in and keeps that band for
     * its whole life; a band that already has a live finger ignores any
     * further ones. Without both of those, a hand that drifts over a
     * divider starts flying somebody else's creature and a player with two
     * fingers down owns two bands — the pair of bugs that make a
     * shared-screen game unplayable.
     * ============================================================= */
    const owners = new Map();                        // pointerId -> band index

    ctx.listen(canvas, "pointerdown", (e) => {
      const i = bandAt(e.offsetY);
      if (i < 0) return;
      const b = birds[i];
      if (!b || b.held) return;                      // that band already has a hand on it
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
      owners.set(e.pointerId, i);
      b.held = true;
      b.claimed = true;
      if (phase === "play") { flap(b, true); b.flapT = 0; }
      else { sound.haptic("light"); }
      if (phase === "claim") {
        sound.sting("tap");
        if (birds.every((x) => x.claimed)) claimUntil = Math.min(claimUntil, now() + 450);
      }
      sound.unlock();
      ctx.platform.interact({ type: "hold", player: i + 1 });
      e.preventDefault();
    }, { passive: false });

    const release = (e) => {
      const i = owners.get(e.pointerId);
      if (i === undefined) return;
      owners.delete(e.pointerId);
      if (birds[i]) birds[i].held = false;
    };
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);
    // A finger that slides out of its band keeps its band: the binding is made
    // once, on the way down, and never revisited.
    ctx.listen(canvas, "pointermove", (e) => { if (owners.has(e.pointerId)) e.preventDefault(); }, { passive: false });

    /* ===============================================================
     * FRAME
     * ============================================================= */
    let lastHour = -1, lastDist = -1, fps = 0, frames = 0, simT = 0;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 46) / 1000;
      const t = now() / 1000;
      fps += (1000 / Math.max(dtMs, 1) - fps) * 0.08;
      frames++;
      simT += dt;

      if (phase === "claim" && now() >= claimUntil) startCountdown();
      step(dt, t);
      drawFrame(t);

      if (phase === "play") {
        const d = Math.round(roundBest);
        if (d !== lastDist) { lastDist = d; shell.el("dist").textContent = fmt(d); }
        if (hourIdx !== lastHour) { lastHour = hourIdx; shell.el("hour").textContent = HOURS[hourIdx].id.toLowerCase(); }
      } else if (phase === "title" && lastDist !== 0) {
        lastDist = 0;
        shell.el("dist").textContent = "0";
        shell.el("hour").textContent = HOURS[hourIdx].id.toLowerCase();
      }
    });

    /* --- resize ------------------------------------------------------ */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      seedMotes();
      bakeAll();
      fitWordmark();
    });

    /* ===============================================================
     * A read-only window onto the simulation, so the local harness can
     * fly a real four-finger round and assert on where the creatures
     * actually went. It exposes nothing the bit does not already draw.
     * ============================================================= */
    window.__DUSKWING__ = {
      get phase() { return phase; },
      // Transitions during which a hold is recorded but does not yet fly:
      // a play script must poll this rather than sleep.
      get busy() { return phase === "claim" || phase === "countdown" || (phase === "over" && now() - overAt < 400); },
      get metres() { return Math.round(roundBest); },
      get fps() { return Math.round(fps); },
      get frames() { return frames; },
      // Seconds of SIMULATED time. A play script that sleeps in wall clock is
      // really measuring the renderer, which on a software rasteriser can run
      // an order of magnitude behind; waiting on this instead makes a test
      // mean the same thing at 3fps as at 60.
      get simT() { return simT; },
      get travelled() { return Math.round((camX - originX) / U * METRE); },
      get winner() { return winner; },
      get players() { return settings.players; },
      get best() { return settings.best; },
      birds: () => birds.map((b) => {
        // ceil/floor are the tunnel a little way ahead of the creature —
        // exactly what its owner is looking at, and nothing more.
        const lane = lanes[b.i];
        let c = 0.2, f = 0.8;
        if (lane) { profile((camX + b.sx + W * 0.26) / U, _pf, lane); c = _pf[0]; f = _pf[1]; }
        return {
          i: b.i, alive: b.alive, n: b.n, vn: b.vn, sx: b.sx, held: b.held,
          best: Math.round(b.best), cause: b.cause, ceil: c, floor: f,
        };
      }),
      // Where a finger has to land to fly creature `i`.
      zone: (i) => ({ x: Math.round(WALL * 0.5), y: Math.round(bands[i] ? bands[i].mid : 0) }),
      layout: () => ({ W, H, U, PLAY_TOP, PLAY_BOT, WALL, bands: bands.map((b) => ({ top: b.top, bot: b.bot })) }),
    };
    ctx.onDestroy(() => { try { delete window.__DUSKWING__; } catch (_) {} });

    // The first frame is drawn before ready(), so the host never shows a blank
    // bit while the attract loop spins up.
    ensureCourse(camX + W);
    drawFrame(now() / 1000);
    ctx.markVisualReady("cave drawn");
    ctx.platform.ready();
  },
};
