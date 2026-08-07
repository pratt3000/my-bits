/**
 * Backseat Rain
 *
 * You are in the back seat. The car is moving, it is raining, and the window
 * beside you is doing the thing it always does: condensation gathers into
 * beads, beads find each other and pool, they lean sideways because of the air
 * sliding over the glass, and then one gets heavy enough that surface tension
 * gives up and it *runs* — eating every bead in its path on the way down,
 * getting faster the fatter it gets, and leaving a clear track through the mist
 * behind it.
 *
 * That release is the whole feeling this bit is built around. Everything else
 * is in service of it:
 *
 *  - Drops are simulated, never scripted. A bead holds until its weight beats
 *    the pin force of its own contact patch, so the moment it breaks loose is
 *    emergent and different every single run.
 *  - Runners cut a real channel through the condensation layer and shed mass
 *    as they go. The channel heals slowly, and the shed beads re-pool, so a
 *    later runner can inherit a lane the first one cleared. That is where the
 *    rivalry between paths comes from.
 *  - Small drops slant more than big ones. Wind acts on frontal area (~r^2),
 *    gravity acts on mass (~r^3), so sideways push per unit mass falls off as
 *    1/r. Fat drops plummet; little ones drift off toward the back of the car.
 *  - Every drop above a size threshold is a real lens: the world outside is
 *    sampled, flipped through the focal point, and magnified inside its body.
 *    That inversion is the detail that makes rain-on-glass read as *glass*.
 *
 * The game on top is the bet you already make without meaning to. Three drops
 * get rings; you back one; first to the sill wins. Drag the glass to sweep
 * loose beads into your drop and fatten it — pulling two drops into one and
 * shoving it downhill is both the toy and the strategy.
 *
 * Contract notes (plethora-bit@2):
 *  - No dependencies and no packaged assets (maxAssets is 0). Scenery, drops,
 *    sprites and every sound are generated at runtime.
 *  - Offscreen bakes go to `OffscreenCanvas`. Minting a canvas element by
 *    hand is rejected by the upload validator, and `ctx.createCanvas()` is a
 *    display surface the runtime mounts, which is not what a bake wants. No
 *    OffscreenCanvas in the WebView means `makeSurface()` returns null and
 *    every bake site falls back to drawing live.
 *  - `document.createElement` is only ever called with a literal tag. A
 *    computed tag cannot be statically shown not to be a canvas or a script,
 *    and the validator rejects it.
 *  - Pointer position comes from `event.offsetX/offsetY`. Querying layout
 *    rectangles is rejected by the validator, and offsets are canvas-relative
 *    already, so this also skips a forced reflow per pointer event.
 *  - Those two rules are why this header describes the banned calls rather
 *    than spelling them out: the validator reads the source as text, and a
 *    comment quoting them verbatim is enough to trip it.
 *  - Timers go through `ctx.timeout`, listeners through `ctx.listen`, and no
 *    blur filter is used anywhere — not the canvas `filter` property and not
 *    CSS. Softness comes from bouncing a bake through a tiny canvas and
 *    letting the smoothed upscale do the work.
 */
window.plethoraBit = {
  meta: {
    title: "Backseat Rain",
    runtime: "plethora-bit@2",
    tags: [
      "rain",
      "relaxing",
      "asmr",
      "satisfying",
      "sensory",
      "ambient",
      "water",
      "racing",
      "cozy",
      "fidget"
    ],
    permissions: ["audio", "backgroundMusic", "haptics", "motion", "storage"]
  },

  async init(ctx) {
    "use strict";

    /* ---------------------------------------------------------------- *
     * Tuning
     *
     * Lengths here are in reference pixels on a 390-wide phone. `sizes()`
     * scales them so a drop is the same *apparent* size on a tablet.
     * ---------------------------------------------------------------- */

    const TUNE = {
      // "Just the perfect amount of rain": enough that a lane is always
      // forming somewhere, sparse enough that you can follow one drop.
      mistPerSec: 26,
      beadR: [2.0, 5.0],
      releaseR: 9.2,
      pinJitter: [0.8, 1.32],
      beadCoverage: 0.105,        // fraction of the glass held by resting mist
      accrete: 0.5,               // vapour picked up per unit bead area
      growJitter: [0.35, 1.5],

      gravity: 190,
      // Water on glass is held back by its contact line, not by air. Retarding
      // force goes with the wetted perimeter while weight goes with volume, so
      // terminal speed lands on gravity*r^2/friction — a fat drop is genuinely,
      // dramatically faster than a thin one, which is the whole race.
      friction: 230,
      // Sideways acceleration felt by a drop at exactly release size. Wind
      // pushes on frontal area and gravity pulls on mass, so anything smaller
      // gets shoved proportionally harder — see stepDrops.
      windBase: -34,
      windGust: 58,
      windRate: 0.45,

      shedEveryPx: 11,
      coalesceBudget: 150,

      maxLens: 44,
      raceTimeoutMs: 26000,
      betWindowMs: 13000,
      breathMs: 3200
    };

    const RACER_TINTS = [
      { key: "amber", name: "Amber", rgb: [255, 192, 116] },
      { key: "mint", name: "Mint", rgb: [127, 224, 204] },
      { key: "rose", name: "Rose", rgb: [255, 159, 184] }
    ];

    /* ---------------------------------------------------------------- *
     * Random. Reseeded per run so it is never the same window twice.
     * ---------------------------------------------------------------- */

    let seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    function rnd() {
      // xorshift32 — cheap, and good enough that drop lanes do not visibly
      // repeat over a session.
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    }
    const rr = (a, b) => a + (b - a) * rnd();
    const ri = (a, b) => Math.floor(rr(a, b + 1));
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;

    /* ---------------------------------------------------------------- *
     * Surfaces
     * ---------------------------------------------------------------- */

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function makeSurface(w, h) {
      if (!CAN_BAKE) return null;
      try {
        return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
      } catch (_) {
        return null;
      }
    }

    /* ---------------------------------------------------------------- *
     * Layout
     *
     * The glass is inset on every side and the car interior frames it. That
     * is both truer to a back-side window and the reason the finish line can
     * sit clear of the bottom unsafe area: the sill is where the race ends,
     * and everything below it is door card the player never has to reach.
     * ---------------------------------------------------------------- */

    const L = {};
    const SZ = {};

    function layout() {
      // Keep the raw measurement too: L.W/L.H are clamped to a usable
      // minimum, so comparing those against ctx.width to detect a resize
      // would re-fire forever inside a very small container.
      L.rawW = ctx.width;
      L.rawH = ctx.height;
      const W = (L.W = Math.max(240, ctx.width));
      const H = (L.H = Math.max(320, ctx.height));
      const sa = ctx.safeArea || {};
      const inset = Math.max(12, W * 0.035);

      L.glass = {
        x: (sa.left || 0) + inset,
        y: (sa.top || 0) + clamp(H * 0.08, 50, 96),
        w: Math.max(80, W - (sa.left || 0) - (sa.right || 0) - inset * 2),
        h: 0,
        r: 0
      };
      // The door card only has to be deep enough to read as a door and to
      // keep the finish line out of the bottom unsafe area. Letting it scale
      // without a ceiling is what squeezes the glass flat in landscape.
      L.glass.h = Math.max(
        120, H - (sa.bottom || 0) - clamp(H * 0.145, 54, 132) - L.glass.y
      );
      L.sillY = L.glass.y + L.glass.h;
      L.glass.r = Math.min(34, L.glass.w * 0.11, L.glass.h * 0.11);
      L.uiTop = (sa.top || 0) + 10;

      // On a short window there is no room for a caption over the glass
      // without burying the drops, and the door card below is dead space.
      L.short = L.glass.h < 330;
      L.bannerTop = L.short
        ? Math.min(H - 42, L.sillY + 5)
        : L.uiTop + 50;
      L.replayTop = L.short ? L.uiTop + 42 : L.uiTop + 126;
      sizes();
    }

    function sizes() {
      const s = clamp(Math.min(L.W, L.H) / 390, 0.82, 1.9);
      SZ.s = s;
      SZ.beadMin = TUNE.beadR[0] * s;
      SZ.beadMax = TUNE.beadR[1] * s;
      SZ.release = TUNE.releaseR * s;
      SZ.spriteMax = 9.5 * s;
      SZ.lensMin = 5.2 * s;
      SZ.cell = 34 * s;
      SZ.grab = 54 * s;
      SZ.gather = 42 * s;
      SZ.shedEvery = TUNE.shedEveryPx * s;
      SZ.gravity = TUNE.gravity * s;
      SZ.windBase = TUNE.windBase * s;
      SZ.windGust = TUNE.windGust * s;
      // Terminal speed is gravity*r^2/friction. Gravity carries one factor of
      // s and r^2 carries two, so friction needs s^2 for speeds to stay
      // screen-relative instead of exploding on a tablet.
      SZ.friction = TUNE.friction * s * s;
      // Vapour lands on beads in proportion to the area they present, so
      // dm/dt = k*r^2 with m = r^3 makes dr/dt constant: a bead takes
      // 3*(release - r0)/k seconds to break loose regardless of where it
      // started. Per-drop `grow` jitter spreads those releases out.
      SZ.accrete = TUNE.accrete * s;

      // Hold the resting mist at a roughly constant fraction of the glass so
      // a big screen looks as wet as a small one rather than emptier. The
      // spawn radius is cubic-biased toward the minimum (see mistR), whose
      // mean sits a quarter of the way up the range.
      const meanArea = Math.PI * Math.pow(SZ.beadMin + (SZ.beadMax - SZ.beadMin) * 0.25, 2);
      SZ.maxBeads = clamp(
        Math.round((L.glass.w * L.glass.h * TUNE.beadCoverage) / meanArea),
        120, 620
      );
    }
    layout();

    /* ---------------------------------------------------------------- *
     * The world outside
     *
     * Baked once as two horizontally tileable strips (far and near) whose
     * period is exactly the glass width, so scrolling is a pair of drawImage
     * calls with an offset and never a reseam. Every element is drawn at
     * ox = -w, 0 and +w so shapes straddling a period edge wrap cleanly.
     *
     * The content is deliberately shapeless: your eye is focused on the
     * glass, so everything past it is bokeh — soft masses and blown-out
     * points of light, no legible edges. The blurred copies are those bakes
     * bounced through a tiny canvas, since no blur filter is available here.
     *
     * The sharp strips are kept because a droplet lens needs something
     * *sharper* than the background to magnify. That contrast — soft world,
     * crisp inverted world inside each bead — is the whole optical trick.
     * ---------------------------------------------------------------- */

    const SKY = ["#060a13", "#0c1424", "#152036", "#241f31"];
    let stripFar = null, stripNear = null, blurFar = null, blurNear = null;
    let stripW = 0, stripH = 0;

    function bakeWorld() {
      stripFar = stripNear = blurFar = blurNear = null;
      stripW = Math.max(64, Math.round(L.glass.w * 0.62));
      stripH = Math.max(64, Math.round(L.glass.h * 0.62));

      const far = makeSurface(stripW * 2, stripH);
      const near = makeSurface(stripW * 2, stripH);
      if (!far || !near) return;

      paintFar(far.getContext("2d"), stripW, stripH);
      paintNear(near.getContext("2d"), stripW, stripH);

      const bf = blurOf(far, 0.12);
      const bn = blurOf(near, 0.14);
      if (!bf || !bn) return;

      stripFar = far; stripNear = near; blurFar = bf; blurNear = bn;
    }

    // Downscale hard, and let the smoothed upscale at draw time be the blur.
    function blurOf(src, scale) {
      const w = Math.max(8, Math.round(src.width * scale));
      const h = Math.max(8, Math.round(src.height * scale));
      const out = makeSurface(w, h);
      if (!out) return null;
      const c = out.getContext("2d");
      c.imageSmoothingEnabled = true;
      c.drawImage(src, 0, 0, w, h);
      return out;
    }

    const PERIODS = [-1, 0, 1];

    function lamp(c, x, y, r, rgb, a) {
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")");
      gr.addColorStop(0.28, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a * 0.44 + ")");
      gr.addColorStop(0.62, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a * 0.12 + ")");
      gr.addColorStop(1, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0)");
      c.fillStyle = gr;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }

    // A soft, low, undulating dark mass. Used for the far treeline and the
    // near verge — no hard silhouettes anywhere out there.
    function darkMass(c, w, h, topY, amp, fill, ox) {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(ox, h);
      c.lineTo(ox, topY);
      const steps = 7;
      for (let i = 1; i <= steps; i++) {
        const x0 = ox + (w * (i - 1)) / steps;
        const x1 = ox + (w * i) / steps;
        // Deterministic wobble so both stamped periods match exactly.
        const y1 = topY + Math.sin(i * 1.9) * amp + Math.sin(i * 4.3) * amp * 0.4;
        c.quadraticCurveTo((x0 + x1) / 2, y1 - amp * 0.8, x1, i === steps ? topY : y1);
      }
      c.lineTo(ox + w, h);
      c.closePath();
      c.fill();
    }

    function paintFar(c, w, h) {
      const sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, SKY[0]);
      sky.addColorStop(0.42, SKY[1]);
      sky.addColorStop(0.72, SKY[2]);
      sky.addColorStop(1, SKY[3]);
      c.fillStyle = sky;
      c.fillRect(0, 0, w * 2, h);

      // Sodium haze along the horizon — the town you are driving out of.
      const hy = h * 0.6;
      const glow = c.createLinearGradient(0, hy - h * 0.34, 0, hy + h * 0.2);
      glow.addColorStop(0, "rgba(255,150,84,0)");
      glow.addColorStop(0.62, "rgba(255,142,74,0.17)");
      glow.addColorStop(1, "rgba(255,110,66,0.04)");
      c.fillStyle = glow;
      c.fillRect(0, 0, w * 2, h);

      // Bokeh. Generated once and stamped at every period so the strip tiles.
      const lamps = [];
      const n = clamp(Math.round(w / 42), 5, 18);
      for (let i = 0; i < n; i++) {
        lamps.push({
          x: rr(0, w),
          y: hy + rr(-h * 0.3, h * 0.22),
          r: rr(h * 0.05, h * 0.15),
          warm: rnd() < 0.72,
          a: rr(0.34, 0.74)
        });
      }
      // A few pin-bright cores so it is not all mush.
      const cores = [];
      for (let i = 0; i < Math.round(n * 0.6); i++) {
        cores.push({ x: rr(0, w), y: hy + rr(-h * 0.26, h * 0.16), r: rr(1.5, 3.4), warm: rnd() < 0.8 });
      }

      for (let p = 0; p < PERIODS.length; p++) {
        const ox = PERIODS[p] * w;
        darkMass(c, w, h, h * 0.74, h * 0.028, "rgba(5,8,14,0.62)", ox);
        for (let i = 0; i < lamps.length; i++) {
          const lp = lamps[i];
          lamp(c, ox + lp.x, lp.y, lp.r,
               lp.warm ? [255, 184, 108] : [136, 196, 255], lp.a);
        }
        for (let i = 0; i < cores.length; i++) {
          const cr = cores[i];
          c.fillStyle = cr.warm ? "rgba(255,224,178,0.62)" : "rgba(198,228,255,0.5)";
          c.beginPath();
          c.arc(ox + cr.x, cr.y, cr.r, 0, Math.PI * 2);
          c.fill();
        }
      }

      // Wet tarmac throwing the streetlights back up at you.
      const road = c.createLinearGradient(0, h * 0.78, 0, h);
      road.addColorStop(0, "rgba(255,158,88,0.11)");
      road.addColorStop(1, "rgba(110,150,215,0.05)");
      c.fillStyle = road;
      c.fillRect(0, h * 0.78, w * 2, h * 0.22);
    }

    function paintNear(c, w, h) {
      c.clearRect(0, 0, w * 2, h);

      // Big soft lamps whipping past close to the car, and a low verge.
      const blobs = [];
      const n = clamp(Math.round(w / 150), 2, 6);
      for (let i = 0; i < n; i++) {
        blobs.push({
          x: (w * (i + rr(0.15, 0.85))) / n,
          y: rr(h * 0.14, h * 0.42),
          r: rr(h * 0.13, h * 0.26),
          a: rr(0.42, 0.78)
        });
      }

      for (let p = 0; p < PERIODS.length; p++) {
        const ox = PERIODS[p] * w;
        darkMass(c, w, h, h * 0.88, h * 0.032, "rgba(2,4,9,0.9)", ox);
        for (let i = 0; i < blobs.length; i++) {
          const b = blobs[i];
          lamp(c, ox + b.x, b.y, b.r, [255, 172, 96], b.a);
        }
      }
    }

    /* ---------------------------------------------------------------- *
     * Condensation
     *
     * A static layer of fine mist baked over the whole glass. Runners cut
     * through it with destination-out, which is what makes a trail read as a
     * cleared channel rather than a line drawn on top. It heals by fading the
     * pristine copy back in, slowly, so old lanes linger exactly as long as
     * they should.
     * ---------------------------------------------------------------- */

    let mistBase = null, mistTex = null, mistCtx = null, mistScale = 0.7;
    let healAcc = 0;

    function bakeMist() {
      mistBase = mistTex = mistCtx = null;
      const w = Math.max(32, Math.round(L.glass.w * mistScale));
      const h = Math.max(32, Math.round(L.glass.h * mistScale));
      const base = makeSurface(w, h);
      const tex = makeSurface(w, h);
      if (!base || !tex) return;

      const c = base.getContext("2d");

      // Smoky body first. Without it the layer is only specks, and a channel
      // cut through specks reads as missing dots rather than as clear glass.
      const blobs = Math.round((w * h) / 900);
      for (let i = 0; i < blobs; i++) {
        const x = rr(0, w), y = rr(0, h), r = rr(3, 11) * SZ.s * mistScale;
        const gr = c.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, "rgba(198,220,250," + rr(0.05, 0.13) + ")");
        gr.addColorStop(1, "rgba(198,220,250,0)");
        c.fillStyle = gr;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }

      // Then the grain on top. Fine and faint — any individual speck you can
      // pick out reads as dirt or as a starfield, not as breath on cold glass.
      const n = Math.round((w * h) / 20);
      for (let i = 0; i < n; i++) {
        const r = rr(0.28, 0.95) * SZ.s * mistScale;
        const a = rr(0.04, 0.16);
        c.fillStyle = "rgba(202,222,250," + a + ")";
        c.beginPath();
        c.arc(rr(0, w), rr(0, h), r, 0, Math.PI * 2);
        c.fill();
      }
      mistBase = base;
      mistTex = tex;
      mistCtx = tex.getContext("2d");
      mistCtx.drawImage(base, 0, 0);
    }

    function clearMist(x, y, r) {
      if (!mistCtx) return;
      const sx = (x - L.glass.x) * mistScale;
      const sy = (y - L.glass.y) * mistScale;
      mistCtx.globalCompositeOperation = "destination-out";
      mistCtx.beginPath();
      mistCtx.arc(sx, sy, r * mistScale, 0, Math.PI * 2);
      mistCtx.fill();
      mistCtx.globalCompositeOperation = "source-over";
    }

    function healMist(dt) {
      if (!mistCtx || !mistBase) return;
      healAcc += dt;
      if (healAcc < 0.25) return;
      healAcc = 0;
      mistCtx.globalAlpha = 0.05;
      mistCtx.drawImage(mistBase, 0, 0);
      mistCtx.globalAlpha = 1;
    }

    /* ---------------------------------------------------------------- *
     * Bead sprite atlas
     *
     * Small beads outnumber everything else and none of them deserves a live
     * gradient. They get baked once per step of radius and drawn as plain
     * images. Backing store is DPR-scaled; the draw is in CSS pixels.
     * ---------------------------------------------------------------- */

    const BEAD_STEPS = 16;
    let beadSprites = null;

    function bakeBeads() {
      beadSprites = null;
      if (!CAN_BAKE) return;
      const dpr = Math.min(3, Math.max(1, ctx.dpr || 1));
      const out = [];
      for (let i = 0; i < BEAD_STEPS; i++) {
        const r = SZ.beadMin + (SZ.spriteMax - SZ.beadMin) * (i / (BEAD_STEPS - 1));
        const half = r + 2;
        const s = makeSurface(Math.ceil(half * 2 * dpr), Math.ceil(half * 2 * dpr));
        if (!s) return;
        const c = s.getContext("2d");
        c.scale(dpr, dpr);

        // Body: faintly lit through the middle, darkening off-centre where
        // refraction carries the background away.
        const body = c.createRadialGradient(
          half - r * 0.3, half - r * 0.35, r * 0.08, half, half, r
        );
        body.addColorStop(0, "rgba(198,222,252,0.34)");
        body.addColorStop(0.55, "rgba(112,144,190,0.17)");
        body.addColorStop(0.88, "rgba(8,13,24,0.3)");
        body.addColorStop(1, "rgba(4,7,14,0.08)");
        c.fillStyle = body;
        c.beginPath();
        c.arc(half, half, r, 0, Math.PI * 2);
        c.fill();

        // Rim light all the way round rather than a bright arc across the
        // bottom, which at these sizes reads as a mouth.
        const rim = c.createRadialGradient(
          half - r * 0.24, half - r * 0.28, r * 0.12, half, half, r
        );
        rim.addColorStop(0, "rgba(210,232,255,0)");
        rim.addColorStop(0.68, "rgba(210,232,255,0.03)");
        rim.addColorStop(1, "rgba(222,240,255,0.46)");
        c.fillStyle = rim;
        c.beginPath();
        c.arc(half, half, r, 0, Math.PI * 2);
        c.fill();

        // Specular pin-prick. This is what actually makes a bead read as wet.
        c.fillStyle = "rgba(255,255,255,0.72)";
        c.beginPath();
        c.arc(half - r * 0.32, half - r * 0.36, Math.max(0.4, r * 0.16), 0, Math.PI * 2);
        c.fill();

        out.push({ cv: s, half });
      }
      beadSprites = out;
    }

    function beadSprite(r) {
      if (!beadSprites) return null;
      const t = (r - SZ.beadMin) / Math.max(0.001, SZ.spriteMax - SZ.beadMin);
      return beadSprites[clamp(Math.round(t * (BEAD_STEPS - 1)), 0, BEAD_STEPS - 1)];
    }

    /* ---------------------------------------------------------------- *
     * Drops
     * ---------------------------------------------------------------- */

    let drops = [];
    let held = null;                // the drop currently under the finger
    let scrollFar = 0, scrollNear = 0;
    let wind = 0;
    let windPhase = rr(0, 100);
    let tiltX = 0, tiltY = 0;       // smoothed parallax offset, px
    let worldOffX = 0, worldOffY = 0;
    let nowMs = 0;

    const massOf = (r) => r * r * r;
    const radOf = (m) => Math.cbrt(Math.max(0.0001, m));

    function makeDrop(x, y, r, opts) {
      const d = {
        x, y, r,
        m: massOf(r),
        vx: 0, vy: 0,
        run: false,
        pin: rr(TUNE.pinJitter[0], TUNE.pinJitter[1]),
        life: 1,
        shedAcc: 0,
        shedNext: SZ.shedEvery * rr(0.45, 1.9),
        racer: null,
        grow: rr(TUNE.growJitter[0], TUNE.growJitter[1]),
        wob: rr(0, 6.28)
      };
      if (opts) for (const k in opts) d[k] = opts[k];
      drops.push(d);
      return d;
    }

    // Condensation is mostly very fine with a few standouts, so bias the
    // spawn size hard toward the bottom of the range. A flat distribution
    // gives every bead the same apparent size and the glass looks printed.
    function mistR() {
      const t = rnd();
      return SZ.beadMin + (SZ.beadMax - SZ.beadMin) * t * t * t;
    }

    function seedGlass(n) {
      for (let i = 0; i < n; i++) {
        makeDrop(
          rr(L.glass.x, L.glass.x + L.glass.w),
          rr(L.glass.y, L.sillY),
          mistR()
        );
      }
    }

    // Spatial hash over the resting beads. Rebuilt each frame — a few hundred
    // inserts is nothing next to what it saves on merge queries.
    const grid = new Map();
    function rebuildGrid() {
      grid.clear();
      const cell = SZ.cell;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.run || d.life <= 0) continue;   // runners query, they are not queried
        const k = ((d.x / cell) | 0) + "," + ((d.y / cell) | 0);
        let bucket = grid.get(k);
        if (!bucket) grid.set(k, (bucket = []));
        bucket.push(d);
      }
    }
    function nearBeads(x, y, r, out) {
      out.length = 0;
      const cell = SZ.cell;
      const c0 = ((x - r) / cell) | 0, c1 = ((x + r) / cell) | 0;
      const r0 = ((y - r) / cell) | 0, r1 = ((y + r) / cell) | 0;
      for (let cx = c0; cx <= c1; cx++) {
        for (let cy = r0; cy <= r1; cy++) {
          const bucket = grid.get(cx + "," + cy);
          if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
        }
      }
      return out;
    }
    const scratch = [];

    function absorb(a, b) {
      // Conserve volume, not radius. This is why a merge feels like a jump:
      // two equal beads make one only 1.26x wider, but twice as heavy.
      const m = a.m + b.m;
      a.x = (a.x * a.m + b.x * b.m) / m;
      a.y = (a.y * a.m + b.y * b.m) / m;
      a.vx = (a.vx * a.m + b.vx * b.m) / m;
      a.vy = (a.vy * a.m + b.vy * b.m) / m;
      a.m = m;
      a.r = radOf(m);

      // A racer swallowed by a bigger drop does not simply die — the merged
      // drop carries its colours on, and inherits its start-line pin so a
      // pooling bead cannot flag it away early. Two racers meeting is a
      // knockout for the smaller one.
      if (b.racer !== null) {
        if (a.racer === null) {
          a.racer = b.racer;
          a.pin = Math.max(a.pin, b.pin);
          race.racers[b.racer] = a;
        } else if (race.racers[b.racer] === b) {
          race.racers[b.racer] = null;
        }
      }
      b.racer = null;
      b.life = 0;
      return b.m;
    }

    function stepDrops(dt) {
      const gl = L.glass;

      // Wind wanders. Gusts are what put two identical drops in different
      // lanes, so a race is never decided at the start line.
      windPhase += dt * TUNE.windRate;
      wind =
        SZ.windBase +
        Math.sin(windPhase) * SZ.windGust * 0.6 +
        Math.sin(windPhase * 2.37 + 1.1) * SZ.windGust * 0.4;

      rebuildGrid();
      coalesce();

      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.life <= 0 || d === held) continue;

        if (!d.run) {
          // Condensation keeps landing on whatever is already there. This,
          // not collisions, is what actually drives beads toward release —
          // random beads on a window rarely touch.
          d.m += SZ.accrete * d.grow * d.r * d.r * dt;
          d.r = radOf(d.m);

          if (d.r >= SZ.release * d.pin) {
            d.run = true;
            d.vy = rr(6, 18) * SZ.s;
            onRelease(d);
          } else {
            // Beads creep imperceptibly before they go. Barely visible, but
            // it stops the glass from looking like a still image.
            d.y += dt * d.r * 0.14;
            continue;
          }
        }

        // Wind acts on frontal area (~r^2) and gravity on mass (~r^3), so the
        // sideways acceleration goes as 1/r: little drops get blown right off
        // toward the back of the car, fat ones fall almost straight. A runner
        // that keeps eating therefore curves from slanted to vertical as it
        // grows, which is exactly what happens on a real window.
        //
        // Both axes relax toward their terminal speed exponentially, which is
        // exact rather than merely stable — a drop that sheds down to a
        // sliver would blow up an explicit step at this friction.
        const fr = Math.max(0.05, SZ.friction / (d.r * d.r));
        const k = Math.exp(-fr * dt);
        const tvy = SZ.gravity / fr;
        const tvx = (wind * (SZ.release / d.r)) / fr;
        d.vy = tvy + (d.vy - tvy) * k;
        d.vx = tvx + (d.vx - tvx) * k;

        const px = d.x, py = d.y;
        d.x += d.vx * dt;
        d.y += d.vy * dt;

        // Cut a channel through the condensation.
        clearMist(d.x, d.y, d.r * 1.15);

        // Eat everything on the way through.
        const list = nearBeads(d.x, d.y, d.r + 3 * SZ.s, scratch);
        for (let j = 0; j < list.length; j++) {
          const b = list[j];
          if (b === d || b.life <= 0 || b.run) continue;
          const dx = b.x - d.x, dy = b.y - d.y;
          const reach = d.r + b.r * 0.7;
          if (dx * dx + dy * dy < reach * reach) {
            onMerge(d, absorb(d, b));
          }
        }

        // Shed a wet track. It re-beads, and a later runner inherits the lane.
        // Spacing, size and lateral scatter are all jittered per drop: an
        // evenly spaced column of identical beads reads as a beaded curtain,
        // not as a trail something tore through.
        d.shedAcc += Math.hypot(d.x - px, d.y - py);
        if (d.shedAcc > d.shedNext && d.r > SZ.beadMin * 1.4) {
          d.shedAcc = 0;
          d.shedNext = SZ.shedEvery * rr(0.45, 1.9);
          const lose = Math.min(d.m * 0.1, massOf(SZ.beadMin * 1.2));
          d.m = Math.max(massOf(SZ.beadMin), d.m - lose);
          d.r = radOf(d.m);
          if (rnd() < 0.78 && drops.length < SZ.maxBeads + 200) {
            makeDrop(
              d.x + rr(-1, 1) * d.r * 0.9,
              d.y - d.r * rr(0.5, 1.6),
              clamp(radOf(lose * rr(0.28, 1)), SZ.beadMin * 0.5, SZ.beadMax * 0.9)
            );
          }
        }

        // A drop blown into the edge of the pane does not disappear — it
        // catches the seal and runs down it. Losing racers off the side would
        // also decide races by gust rather than by weight.
        if (d.x < gl.x + d.r) { d.x = gl.x + d.r; if (d.vx < 0) d.vx *= -0.15; }
        else if (d.x > gl.x + gl.w - d.r) {
          d.x = gl.x + gl.w - d.r;
          if (d.vx > 0) d.vx *= -0.15;
        }

        if (d.y - d.r > L.sillY) {
          d.life = 0;
          onArrive(d);
        }
      }

      // Runners catch each other too: a heavy drop overhauling a lighter one
      // takes it, and the survivor keeps whichever racer colours were in
      // play. Without this a drop you built could never reach your racer once
      // the racer was already moving, and "feed it" would be a lie. There are
      // only ever a handful of runners, so the pairwise sweep is free.
      const runners = [];
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.life > 0 && d.run && d !== held) runners.push(d);
      }
      for (let i = 0; i < runners.length; i++) {
        const a = runners[i];
        if (a.life <= 0) continue;
        for (let j = i + 1; j < runners.length; j++) {
          const b = runners[j];
          if (b.life <= 0) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const reach = (a.r + b.r) * 0.85;
          if (dx * dx + dy * dy < reach * reach) {
            const keep = a.m >= b.m ? a : b;
            onMerge(keep, absorb(keep, keep === a ? b : a));
            if (a.life <= 0) break;
          }
        }
      }

      // The very finest spray dries off rather than lingering forever.
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.life > 0 && !d.run && d.r < SZ.beadMin * 0.6) {
          d.m -= d.m * 0.05 * dt;
          d.r = radOf(d.m);
          if (d.r < SZ.beadMin * 0.34) d.life = 0;
        }
      }

      let w = 0;
      for (let i = 0; i < drops.length; i++) if (drops[i].life > 0) drops[w++] = drops[i];
      drops.length = w;
    }

    // Resting beads find each other and pool. This is the engine of the whole
    // thing: without it nothing ever grows heavy enough to break loose.
    let coalCursor = 0;
    function coalesce() {
      const n = drops.length;
      if (!n) return;
      const budget = Math.min(TUNE.coalesceBudget, n);
      for (let k = 0; k < budget; k++) {
        coalCursor = (coalCursor + 1) % drops.length;
        const a = drops[coalCursor];
        if (!a || a.life <= 0 || a.run || a === held) continue;
        const list = nearBeads(a.x, a.y, a.r + SZ.beadMax, scratch);
        for (let j = 0; j < list.length; j++) {
          const b = list[j];
          if (b === a || b.life <= 0 || b.run || b === held) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const reach = (a.r + b.r) * 0.84;
          if (dx * dx + dy * dy < reach * reach) {
            const keep = a.m >= b.m ? a : b;
            onMerge(keep, absorb(keep, keep === a ? b : a));
            break;
          }
        }
      }
    }

    function rain(dt) {
      // New mist. The rate eases off during a race so the lanes stay legible
      // exactly when the player is trying to follow one drop.
      const busy = race.state === "running" ? 0.62 : 1;
      let n = TUNE.mistPerSec * dt * busy;
      while (n > 0) {
        if (rnd() < n && drops.length < SZ.maxBeads) {
          makeDrop(
            rr(L.glass.x, L.glass.x + L.glass.w),
            rr(L.glass.y, L.sillY - 4),
            mistR()
          );
          if (rnd() < 0.34) tickImpact();
        }
        n -= 1;
      }
    }

    /* ---------------------------------------------------------------- *
     * Rendering
     * ---------------------------------------------------------------- */

    let lensBudget = TUNE.maxLens;
    let smears = [];
    let feedFlash = 0;

    function dropPath(c, d) {
      const sp = Math.hypot(d.vx, d.vy);
      if (!d.run || sp < 26 * SZ.s) {
        // Resting beads are wider than they are tall; gravity flattens them
        // against the glass a little.
        c.beginPath();
        c.ellipse(d.x, d.y, d.r * 1.05, d.r * 0.93, 0, 0, Math.PI * 2);
        return;
      }
      const a = Math.atan2(d.vy, d.vx);
      const tail = Math.min(d.r * 2.1, d.r * 0.5 + sp * 0.016);
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = -sa, py = ca;              // perpendicular to travel
      const tipX = d.x - ca * (d.r + tail), tipY = d.y - sa * (d.r + tail);
      // The arc must sweep the *leading* half, from -90 through the heading
      // to +90. Sweeping the other way puts the round end at the back and the
      // drop reads as a hood rather than a teardrop. The control points sit
      // level with the flanks so the body holds its width and then tapers,
      // instead of pinching straight out of the bulb.
      const sx = d.x + px * d.r, sy = d.y + py * d.r;
      const ex = d.x - px * d.r, ey = d.y - py * d.r;

      c.beginPath();
      c.arc(d.x, d.y, d.r, a - Math.PI / 2, a + Math.PI / 2);
      c.quadraticCurveTo(sx - ca * tail, sy - sa * tail, tipX, tipY);
      c.quadraticCurveTo(ex - ca * tail, ey - sa * tail, ex, ey);
      c.closePath();
    }

    // The world, inverted and magnified, seen through one drop. Assumes the
    // caller has already clipped to the drop's outline.
    function drawLensInto(c, d) {
      if (!stripFar) return false;
      const gl = L.glass;
      const qx = stripW / gl.w, qy = stripH / gl.h;
      const sw = Math.max(2, (d.r * 2) / 2.4);
      const swx = sw * qx, swy = sw * qy;

      const fx = (((d.x - gl.x - worldOffX + scrollFar) % gl.w) + gl.w) % gl.w;
      const nx = (((d.x - gl.x - worldOffX * 1.35 + scrollNear) % gl.w) + gl.w) % gl.w;
      const sy = clamp(
        (clamp(d.y - gl.y - worldOffY, 0, gl.h) * qy) - swy / 2,
        0, Math.max(0, stripH - swy)
      );

      c.save();
      c.translate(d.x, d.y);
      c.scale(-1, -1);                      // a lens flips the image
      c.globalAlpha = 0.95;
      c.drawImage(
        stripFar,
        clamp(fx * qx - swx / 2, 0, stripW * 2 - swx), sy, swx, swy,
        -d.r, -d.r, d.r * 2, d.r * 2
      );
      c.globalAlpha = 0.78;
      c.drawImage(
        stripNear,
        clamp(nx * qx - swx / 2, 0, stripW * 2 - swx), sy, swx, swy,
        -d.r, -d.r, d.r * 2, d.r * 2
      );
      c.restore();
      return true;
    }

    function drawDrop(c, d, lens) {
      // One clip carries both the refracted content and the rim light, which
      // keeps a drop to a single expensive operation instead of two.
      c.save();
      dropPath(c, d);
      c.clip();

      if (!lens || !drawLensInto(c, d)) {
        c.fillStyle = "rgba(132,164,208,0.15)";
        c.fill();
      }

      // The curve catches light right around its edge. Doing this as a
      // gradient inside the clip, rather than as a stroked arc, is the
      // difference between a wet bead and a smiley face.
      const rim = c.createRadialGradient(
        d.x - d.r * 0.24, d.y - d.r * 0.28, d.r * 0.12,
        d.x, d.y, d.r * 1.06
      );
      rim.addColorStop(0, "rgba(206,230,255,0)");
      rim.addColorStop(0.66, "rgba(206,230,255,0.03)");
      rim.addColorStop(1, "rgba(220,238,255,0.5)");
      c.fillStyle = rim;
      c.fill();
      c.restore();

      // A thin dark line just inside the edge, where refraction bends the
      // background away. Thin — a heavy outline turns water into a sticker.
      dropPath(c, d);
      c.strokeStyle = "rgba(6,10,20,0.32)";
      c.lineWidth = Math.max(0.5, d.r * 0.09);
      c.stroke();

      c.fillStyle = "rgba(255,255,255,0.72)";
      c.beginPath();
      c.arc(d.x - d.r * 0.32, d.y - d.r * 0.36, Math.max(0.4, d.r * 0.13), 0, Math.PI * 2);
      c.fill();

      if (d.racer !== null) drawRacerMark(c, d);
    }

    function drawRacerMark(c, d) {
      const t = RACER_TINTS[d.racer];
      const mine = race.pick === d.racer;
      const pulse = 0.5 + 0.5 * Math.sin(nowMs / 320 + d.wob);
      const ring = d.r + 11 * SZ.s + (race.state === "betting" ? pulse * 4 * SZ.s : 0);
      const a = race.state === "betting"
        ? 0.55 + pulse * 0.4
        : mine ? clamp(0.74 + feedFlash * 0.26, 0, 1) : 0.32;

      c.strokeStyle = "rgba(" + t.rgb[0] + "," + t.rgb[1] + "," + t.rgb[2] + "," + a + ")";
      c.lineWidth = (mine ? 2.3 + feedFlash : 1.5) * SZ.s;
      c.beginPath();
      c.arc(d.x, d.y, ring, 0, Math.PI * 2);
      c.stroke();

      if (mine) {
        // A caret above your drop so you never lose it in the traffic.
        const k = 5 * SZ.s;
        c.fillStyle = "rgba(" + t.rgb[0] + "," + t.rgb[1] + "," + t.rgb[2] + ",0.92)";
        c.beginPath();
        c.moveTo(d.x, d.y - ring - k * 0.9);
        c.lineTo(d.x - k, d.y - ring - k * 2.4);
        c.lineTo(d.x + k, d.y - ring - k * 2.4);
        c.closePath();
        c.fill();
      }
    }

    // The window frame stays put and the world behind it slides. That is what
    // parallax through a window actually looks like, and it keeps the glass
    // clip aligned with the drops sitting on it.
    function drawWorld(c) {
      const gl = L.glass;
      c.save();
      roundRect(c, gl.x, gl.y, gl.w, gl.h, gl.r);
      c.clip();

      const sky = c.createLinearGradient(0, gl.y, 0, gl.y + gl.h);
      sky.addColorStop(0, SKY[0]);
      sky.addColorStop(0.5, SKY[1]);
      sky.addColorStop(1, SKY[3]);
      c.fillStyle = sky;
      c.fillRect(gl.x, gl.y, gl.w, gl.h);

      if (blurFar && blurNear) {
        const over = gl.h * 0.05;
        c.imageSmoothingEnabled = true;
        c.drawImage(
          blurFar,
          gl.x - scrollFar + worldOffX, gl.y - over + worldOffY,
          gl.w * 2, gl.h + over * 2
        );
        c.globalAlpha = 0.95;
        c.drawImage(
          blurNear,
          gl.x - scrollNear + worldOffX * 1.35, gl.y - over + worldOffY,
          gl.w * 2, gl.h + over * 2
        );
        c.globalAlpha = 1;
      }

      // The glass itself: cold cast, so the drops sitting on it read as the
      // brightest thing on screen.
      c.fillStyle = "rgba(8,14,26,0.42)";
      c.fillRect(gl.x, gl.y, gl.w, gl.h);

      // Condensation, with whatever channels the runners have cut through it.
      if (mistTex) {
        c.globalAlpha = 0.8;
        c.drawImage(mistTex, gl.x, gl.y, gl.w, gl.h);
        c.globalAlpha = 1;
      }

      const fog = c.createRadialGradient(
        gl.x + gl.w * 0.5, gl.y + gl.h * 0.46, Math.min(gl.w, gl.h) * 0.15,
        gl.x + gl.w * 0.5, gl.y + gl.h * 0.46, Math.max(gl.w, gl.h) * 0.72
      );
      fog.addColorStop(0, "rgba(188,208,235,0)");
      fog.addColorStop(0.72, "rgba(188,208,235,0.05)");
      fog.addColorStop(1, "rgba(198,216,240,0.17)");
      c.fillStyle = fog;
      c.fillRect(gl.x, gl.y, gl.w, gl.h);

      c.restore();
    }

    function drawDrops(c) {
      const gl = L.glass;
      c.save();
      roundRect(c, gl.x, gl.y, gl.w, gl.h, gl.r);
      c.clip();

      // The warm patch your fingertip leaves on the cold glass, under the
      // drops so it reads as being on the far side of them.
      for (let i = 0; i < smears.length; i++) {
        const s = smears[i];
        const gr = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        gr.addColorStop(0, "rgba(224,240,255," + s.life * 0.16 + ")");
        gr.addColorStop(1, "rgba(224,240,255,0)");
        c.fillStyle = gr;
        c.beginPath();
        c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        c.fill();
      }

      // Biggest drops get the real lens; the rest get their baked sprite.
      const big = [];
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.life <= 0) continue;
        if (d.r >= SZ.lensMin || d.run || d.racer !== null || d === held) {
          big.push(d);
        } else {
          const sp = beadSprite(d.r);
          if (sp) c.drawImage(sp.cv, d.x - sp.half, d.y - sp.half, sp.half * 2, sp.half * 2);
          else drawDrop(c, d, false);
        }
      }
      big.sort((a, b) => b.r - a.r);
      for (let i = 0; i < big.length; i++) drawDrop(c, big[i], i < lensBudget);

      c.restore();
    }

    function drawInterior(c) {
      const gl = L.glass;
      const W = L.W, H = L.H;
      const sillTop = gl.y + gl.h;

      // Everything outside the glass is car. Punch the window out of one dark
      // fill rather than drawing four separate panels around it.
      const cabin = c.createLinearGradient(0, 0, 0, H);
      cabin.addColorStop(0, "#0a0d14");
      cabin.addColorStop(0.5, "#070a10");
      cabin.addColorStop(1, "#04060a");
      c.beginPath();
      c.rect(0, 0, W, H);
      roundRect(c, gl.x, gl.y, gl.w, gl.h, gl.r, true);
      c.fillStyle = cabin;
      c.fill("evenodd");

      // Roof lining overhead.
      const roof = c.createLinearGradient(0, 0, 0, gl.y);
      roof.addColorStop(0, "#10151e");
      roof.addColorStop(1, "#06080d");
      c.fillStyle = roof;
      c.fillRect(0, 0, W, gl.y);

      // Door card below the sill, with the armrest ridge catching the light.
      const door = c.createLinearGradient(0, sillTop, 0, H);
      door.addColorStop(0, "#131822");
      door.addColorStop(0.16, "#0c1017");
      door.addColorStop(1, "#05070b");
      c.fillStyle = door;
      c.fillRect(0, sillTop, W, H - sillTop);

      const armY = sillTop + (H - sillTop) * 0.42;
      const arm = c.createLinearGradient(0, armY - 10, 0, armY + 16);
      arm.addColorStop(0, "rgba(150,172,204,0.11)");
      arm.addColorStop(0.4, "rgba(120,140,175,0.05)");
      arm.addColorStop(1, "rgba(0,0,0,0.28)");
      c.fillStyle = arm;
      c.fillRect(0, armY - 10, W, 26);

      // Rubber seal catching a thin line of light all the way round, plus the
      // bright sill lip the drops arrive at.
      roundRect(c, gl.x - 1.5, gl.y - 1.5, gl.w + 3, gl.h + 3, gl.r + 1.5);
      c.strokeStyle = "rgba(150,172,204,0.16)";
      c.lineWidth = 2.4;
      c.stroke();
      roundRect(c, gl.x - 0.5, gl.y - 0.5, gl.w + 1, gl.h + 1, gl.r);
      c.strokeStyle = "rgba(8,11,18,0.9)";
      c.lineWidth = 1.4;
      c.stroke();

      c.strokeStyle = "rgba(168,190,220,0.24)";
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(gl.x + gl.r * 0.4, sillTop + 1.8);
      c.lineTo(gl.x + gl.w - gl.r * 0.4, sillTop + 1.8);
      c.stroke();

      // Seat belt running down past the edge of the frame. It sells the seat
      // you are sitting in far more cheaply than any geometry would, so it
      // stays thin and well out of the way of the glass.
      c.strokeStyle = "rgba(22,27,38,0.9)";
      c.lineWidth = Math.max(7, W * 0.023);
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(W + 8, gl.y - 26 - tiltX * 0.6);
      c.quadraticCurveTo(W * 0.965, H * 0.55, W * 0.9, H + 20);
      c.stroke();
      c.strokeStyle = "rgba(126,144,176,0.09)";
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(W + 8, gl.y - 30 - tiltX * 0.6);
      c.quadraticCurveTo(W * 0.958, H * 0.55, W * 0.893, H + 20);
      c.stroke();
    }

    function roundRect(c, x, y, w, h, r, keepPath) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      if (!keepPath) c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + w - r, y);
      c.arcTo(x + w, y, x + w, y + r, r);
      c.lineTo(x + w, y + h - r);
      c.arcTo(x + w, y + h, x + w - r, y + h, r);
      c.lineTo(x + r, y + h);
      c.arcTo(x, y + h, x, y + h - r, r);
      c.lineTo(x, y + r);
      c.arcTo(x, y, x + r, y, r);
      c.closePath();
    }

    function render() {
      g.clearRect(0, 0, L.W, L.H);
      drawWorld(g);
      drawDrops(g);
      drawInterior(g);
    }

    /* ---------------------------------------------------------------- *
     * Audio
     *
     * Rain on a car window is three things at once: a wide hiss, a lower body
     * of wind over the shell, and individual impacts on the pane right next
     * to your ear. The impacts are what make it read as *this* window rather
     * than generic rain, so they are synthesised one at a time.
     * ---------------------------------------------------------------- */

    let ac = null, master = null, noiseBuf = null, audioDead = false;
    let rainGain = null, windGain = null, windFilter = null;
    let musicHandle = null;
    let soundOn = true;
    let voices = 0;

    function buildAudio() {
      if (ac || audioDead) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }

      master = ac.createGain();
      master.gain.value = soundOn ? 0.9 : 0;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3;
      comp.attack.value = 0.004; comp.release.value = 0.28;
      master.connect(comp);
      comp.connect(ac.destination);

      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 2), ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      // Wide hiss: the sheet of rain out there in the dark.
      const hiss = ac.createBiquadFilter();
      hiss.type = "bandpass";
      hiss.frequency.value = 2600;
      hiss.Q.value = 0.55;
      rainGain = ac.createGain();
      rainGain.gain.value = 0.05;
      const rainSrc = ac.createBufferSource();
      rainSrc.buffer = noiseBuf; rainSrc.loop = true;
      rainSrc.connect(hiss); hiss.connect(rainGain); rainGain.connect(master);
      try { rainSrc.start(0); } catch (_) {}

      // Wind over the car shell: lower, slower, and it moves with the gusts
      // that are pushing the drops sideways on screen.
      windFilter = ac.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.value = 330;
      windFilter.Q.value = 0.85;
      windGain = ac.createGain();
      windGain.gain.value = 0.05;
      const windSrc = ac.createBufferSource();
      windSrc.buffer = noiseBuf; windSrc.loop = true;
      windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
      try { windSrc.start(0); } catch (_) {}

      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
    }

    let resuming = false;
    function unlockAudio() {
      if (!buildAudio()) return;
      if (ac.state !== "running" && !resuming) {
        resuming = true;
        let p;
        try { p = ac.resume(); } catch (_) { resuming = false; }
        if (p && p.then) p.then(() => { resuming = false; }, () => { resuming = false; });
        else resuming = false;
      }
    }

    function noiseVoice() {
      if (!ac || voices > 18) return null;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      voices++;
      src.onended = () => { voices--; };
      return { src, off: Math.random() * 1.6 };
    }

    // One raindrop striking the pane. Short, bright, and slightly different
    // every time so a steady shower never turns into a machine-gun loop.
    let lastImpact = 0;
    function tickImpact() {
      if (!ac || !soundOn || ac.state !== "running") return;
      const t = ac.currentTime;
      if (t - lastImpact < 0.022) return;
      lastImpact = t;
      const v = noiseVoice();
      if (!v) return;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1500 + Math.random() * 4200;
      bp.Q.value = 1.4 + Math.random() * 2.2;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.018 + Math.random() * 0.026, t + 0.002);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.04);
      v.src.connect(bp); bp.connect(gn); gn.connect(master);
      try { v.src.start(t, v.off); v.src.stop(t + 0.09); } catch (_) { voices--; }
    }

    // Two drops becoming one. A wet, pitched blip — bigger merge, lower note.
    let lastMerge = 0;
    function onMerge(d, gained) {
      if (race.state === "running" && d.racer !== null && d.racer === race.pick &&
          gained > massOf(SZ.beadMin * 1.3)) {
        feedFlash = 1;
      }
      if (!ac || !soundOn || ac.state !== "running") return;
      const t = ac.currentTime;
      if (t - lastMerge < 0.035 || gained < massOf(SZ.beadMin)) return;
      lastMerge = t;

      const osc = ac.createOscillator();
      osc.type = "sine";
      const f = lerp(880, 300, clamp(d.r / (SZ.release * 1.6), 0, 1)) * rr(0.94, 1.06);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.07);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(
        clamp(0.016 + (gained / massOf(SZ.beadMax)) * 0.04, 0.008, 0.07), t + 0.004
      );
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(gn); gn.connect(master);
      try { osc.start(t); osc.stop(t + 0.12); } catch (_) {}
    }

    // A drop breaking loose and starting to run.
    function onRelease(d) {
      if (d.r > SZ.release * 1.1) {
        try { ctx.platform.haptic("light"); } catch (_) {}
      }
      if (!ac || !soundOn || ac.state !== "running" || d.r < SZ.release * 0.7) return;
      const t = ac.currentTime;
      const v = noiseVoice();
      if (!v) return;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(700, t + 0.26);
      bp.Q.value = 1.1;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.03, t + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      v.src.connect(bp); bp.connect(gn); gn.connect(master);
      try { v.src.start(t, v.off); v.src.stop(t + 0.34); } catch (_) { voices--; }
    }

    function setSound(on) {
      soundOn = on;
      if (ac && master) {
        try { master.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.08); }
        catch (_) { master.gain.value = on ? 0.9 : 0; }
      }
      try {
        if (musicHandle) { if (on) musicHandle.resume(); else musicHandle.pause(); }
      } catch (_) {}
      try { ctx.storage.set("sound", on); } catch (_) {}
      btnSound.textContent = on ? "♪" : "✕";
      btnSound.setAttribute("aria-label", on ? "Mute" : "Unmute");
    }

    async function startMusic() {
      if (musicHandle || !ctx.capabilities || !ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "drift",
          scale: "pentatonic",
          volume: 0.22,
          intensity: 0.18,
          density: 0.24,
          tempo: 58,
          fadeInMs: 4200
        });
        if (!soundOn && musicHandle) musicHandle.pause();
      } catch (_) { musicHandle = null; }
    }

    /* ---------------------------------------------------------------- *
     * The race
     *
     * ambient -> betting -> running -> settled -> ambient
     * ---------------------------------------------------------------- */

    const race = {
      state: "ambient",
      until: null,
      pick: null,
      racers: [null, null, null]
    };
    const stats = { races: 0, wins: 0, streak: 0, best: 0, biggest: 0 };
    let finished = [];

    function formRace() {
      clearRacers();
      finished = [];
      const gl = L.glass;
      const lanes = [0.22, 0.5, 0.78];
      for (let i = 0; i < 3; i++) {
        // Lanes are nudged so the start line is never identical twice.
        race.racers[i] = makeDrop(
          gl.x + gl.w * (lanes[i] + rr(-0.06, 0.06)),
          gl.y + gl.h * rr(0.15, 0.23),
          SZ.release * rr(0.72, 0.82),
          { racer: i, pin: 2.4, grow: 0 }   // pinned hard until the flag drops
        );
      }
      race.state = "betting";
      race.until = nowMs + TUNE.betWindowMs;
      say("Back a drop", "Tap one of the three rings");
      showReplay(false);
    }

    function beginRunning() {
      race.state = "running";
      race.until = nowMs + TUNE.raceTimeoutMs;
      for (let i = 0; i < 3; i++) {
        const d = race.racers[i];
        if (d && d.life > 0 && !d.run) {
          d.pin = 0.85;
          d.run = true;
          d.vy = rr(5, 14) * SZ.s;
          onRelease(d);
        }
      }
      if (race.pick === null) say("Watching", "No bet this time — just the rain");
      else say(RACER_TINTS[race.pick].name + " is yours", "Sweep beads into its path");
    }

    function pickRacer(i) {
      if (race.state !== "betting") return;
      race.pick = i;
      ctx.platform.interact({ type: "bet", racer: RACER_TINTS[i].key });
      try { ctx.platform.haptic("light"); } catch (_) {}
      try { if (soundOn) ctx.music.sting("tap"); } catch (_) {}
      beginRunning();
    }

    function onArrive(d) {
      if (d.racer === null || race.state !== "running") return;
      if (race.racers[d.racer] !== d) return;
      if (finished.indexOf(d.racer) >= 0) return;
      finished.push(d.racer);
      if (finished.length === 1) settle(d.racer);
    }

    function settle(winner) {
      race.state = "settled";
      race.until = nowMs + TUNE.breathMs;
      stats.races++;
      const name = RACER_TINTS[winner].name;

      if (race.pick === null) {
        say(name + " got there first", "Tap New race to back one");
      } else if (winner === race.pick) {
        stats.wins++;
        stats.streak++;
        stats.best = Math.max(stats.best, stats.streak);
        say(name + " wins — yours", streakLine());
        try { ctx.platform.haptic("success"); } catch (_) {}
        try { if (soundOn) { ctx.music.duck(0.45, 900); ctx.music.sting("success"); } } catch (_) {}
        ctx.platform.setScore(stats.wins);
        ctx.platform.complete({ result: "win", streak: stats.streak });
        if (stats.streak === 3 || stats.streak === 5 || stats.streak === 10) {
          ctx.platform.milestone("streak_" + stats.streak, { streak: stats.streak });
        }
      } else {
        stats.streak = 0;
        say(name + " got there first", "So close. Go again?");
        try { ctx.platform.haptic("light"); } catch (_) {}
        ctx.platform.fail({ result: "lost", winner: RACER_TINTS[winner].key });
      }

      splash(winner);
      saveStats();
      showReplay(true);
    }

    function streakLine() {
      if (stats.streak > 1) return stats.streak + " in a row · best " + stats.best;
      return "Won " + stats.wins + " of " + stats.races;
    }

    // A little burst at the sill where the winning drop landed.
    function splash(winner) {
      const d = race.racers[winner];
      const x = d ? clamp(d.x, L.glass.x + 8, L.glass.x + L.glass.w - 8)
                  : L.glass.x + L.glass.w / 2;
      for (let i = 0; i < 14; i++) {
        makeDrop(
          x + rr(-18, 18) * SZ.s,
          L.sillY - rr(2, 18) * SZ.s,
          rr(SZ.beadMin * 0.7, SZ.beadMax * 0.8)
        );
      }
    }

    function clearRacers() {
      for (let i = 0; i < 3; i++) {
        const d = race.racers[i];
        if (d) d.racer = null;
        race.racers[i] = null;
      }
      race.pick = null;
    }

    function stepRace() {
      if (race.until === null) return;
      if (race.state === "betting") {
        if (nowMs > race.until) beginRunning();   // no bet placed; it still rains
      } else if (race.state === "running") {
        let anyAlive = false;
        for (let i = 0; i < 3; i++) {
          const d = race.racers[i];
          if (d && d.life > 0) anyAlive = true;
        }
        if (nowMs > race.until || !anyAlive) {
          // Timed out, or every racer blew off the glass. Lowest one takes it.
          let best = null, bestY = -Infinity;
          for (let i = 0; i < 3; i++) {
            const d = race.racers[i];
            if (d && d.life > 0 && d.y > bestY) { bestY = d.y; best = i; }
          }
          settle(best === null ? ri(0, 2) : best);
        }
      } else if (race.state === "settled") {
        if (nowMs > race.until) {
          clearRacers();
          race.state = "ambient";
          race.until = nowMs + 2600;
          say("", "");
        }
      } else if (race.state === "ambient") {
        if (nowMs > race.until) formRace();
      }
    }

    /* ---------------------------------------------------------------- *
     * Memory
     * ---------------------------------------------------------------- */

    async function loadStats() {
      try {
        const v = await ctx.memory.local("window_stats").get();
        const s = v && typeof v === "object" && v.value ? v.value : v;
        if (s && typeof s === "object") {
          stats.races = s.races | 0;
          stats.wins = s.wins | 0;
          stats.best = s.best | 0;
          stats.biggest = +s.biggest || 0;
        }
      } catch (_) {}
      paintStats();
    }

    let saving = false;
    async function saveStats() {
      if (saving) return;
      saving = true;
      try {
        await ctx.memory.local("window_stats").set({
          races: stats.races,
          wins: stats.wins,
          best: stats.best,
          biggest: Math.round(stats.biggest * 10) / 10
        });
      } catch (_) {}
      try {
        if (stats.wins > 0) {
          await ctx.memory.record("wins").submit(stats.wins, { label: stats.wins + " won" });
        }
      } catch (_) {}
      try {
        if (stats.best > 0) {
          await ctx.memory.record("streak").submit(stats.best, { label: stats.best + " in a row" });
        }
      } catch (_) {}
      saving = false;
      paintStats();
    }

    /* ---------------------------------------------------------------- *
     * UI
     *
     * `document.createElement` only ever sees a literal tag here — the upload
     * validator rejects a computed one.
     * ---------------------------------------------------------------- */

    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";
    ui.style.font =
      "500 14px/1.45 ui-rounded, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
    ui.style.color = "#e8eefa";
    ui.style.userSelect = "none";
    ui.style.webkitUserSelect = "none";

    function divEl(css, text) {
      const n = document.createElement("div");
      n.setAttribute("style", css);
      if (text != null) n.textContent = text;
      return n;
    }
    function btnEl(css, text) {
      const n = document.createElement("button");
      n.setAttribute("type", "button");
      n.setAttribute("style", css);
      n.textContent = text;
      return n;
    }

    const BTN =
      "pointer-events:auto;-webkit-appearance:none;appearance:none;" +
      "border:1px solid rgba(178,200,232,.22);background:rgba(11,17,28,.72);color:#dfe8f6;" +
      "border-radius:999px;font:inherit;font-size:13px;letter-spacing:.01em;padding:8px 14px;" +
      "cursor:pointer;touch-action:manipulation;";

    const topBar = divEl(
      "position:absolute;left:12px;right:12px;top:" + L.uiTop +
      "px;display:flex;align-items:center;gap:8px;pointer-events:none;"
    );
    const btnSound = btnEl(BTN + "width:36px;height:36px;padding:0;font-size:13px;", "♪");
    const statLine = divEl(
      "flex:1;text-align:center;font-size:12px;letter-spacing:.04em;" +
      "color:rgba(198,214,238,.62);text-shadow:0 1px 3px rgba(0,0,0,.6);"
    );
    const btnInfo = btnEl(BTN + "width:36px;height:36px;padding:0;font-size:14px;", "?");
    topBar.appendChild(btnSound);
    topBar.appendChild(statLine);
    topBar.appendChild(btnInfo);
    ui.appendChild(topBar);

    const banner = divEl(
      "position:absolute;left:0;right:0;top:" + L.bannerTop +
      "px;text-align:center;pointer-events:none;transition:opacity .45s ease;opacity:0;"
    );
    const bTitle = divEl(
      "font-size:18px;font-weight:600;letter-spacing:.01em;text-shadow:0 2px 12px rgba(0,0,0,.95);"
    );
    const bSub = divEl(
      "margin-top:3px;font-size:12.5px;color:rgba(202,218,242,.78);text-shadow:0 1px 6px rgba(0,0,0,.85);"
    );
    banner.appendChild(bTitle);
    banner.appendChild(bSub);
    ui.appendChild(banner);

    const replayWrap = divEl(
      "position:absolute;left:0;right:0;top:" + L.replayTop +
      "px;text-align:center;pointer-events:none;transition:opacity .3s ease;opacity:0;"
    );
    const btnReplay = btnEl(BTN + "padding:9px 18px;", "New race");
    btnReplay.style.pointerEvents = "none";
    replayWrap.appendChild(btnReplay);
    ui.appendChild(replayWrap);

    const sheet = divEl(
      "position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(4,7,13,.9);" +
      "display:none;align-items:center;justify-content:center;pointer-events:auto;" +
      "padding:26px;box-sizing:border-box;"
    );
    const card = divEl(
      "max-width:330px;width:100%;background:rgba(14,20,32,.96);" +
      "border:1px solid rgba(170,196,230,.18);border-radius:20px;padding:20px 20px 16px;" +
      "box-shadow:0 18px 50px rgba(0,0,0,.55);"
    );
    card.appendChild(
      divEl("font-size:17px;font-weight:600;margin-bottom:4px;letter-spacing:.01em;", "Backseat Rain")
    );
    card.appendChild(
      divEl("font-size:12.5px;color:rgba(190,208,234,.6);margin-bottom:12px;",
            "Rain on the window on the drive home.")
    );
    const list = document.createElement("ul");
    list.setAttribute(
      "style",
      "margin:0 0 14px;padding-left:17px;color:rgba(208,222,242,.85);font-size:13.5px;line-height:1.6;"
    );
    const STEPS = [
      "Mist gathers on the glass. When a bead gets heavy enough it breaks loose and runs.",
      "A running drop swallows every bead it touches — the fatter it gets, the faster it goes.",
      "Three drops get coloured rings. Tap one to back it.",
      "Drag anywhere to sweep loose beads into one heavy drop, then let go.",
      "Drop it in your racer's path and your racer swallows it and speeds up.",
      "First drop down to the sill wins. Win in a row to build a streak."
    ];
    for (let i = 0; i < STEPS.length; i++) {
      const li = document.createElement("li");
      li.setAttribute("style", "margin:0 0 6px;");
      li.textContent = STEPS[i];
      list.appendChild(li);
    }
    card.appendChild(list);
    const btnClose = btnEl(BTN + "width:100%;padding:11px;font-size:14px;", "Watch the rain");
    card.appendChild(btnClose);
    sheet.appendChild(card);
    ui.appendChild(sheet);

    function say(title, sub) {
      bTitle.textContent = title || "";
      bSub.textContent = sub || "";
      banner.style.opacity = title || sub ? "1" : "0";
    }
    function showReplay(on) {
      replayWrap.style.opacity = on ? "1" : "0";
      btnReplay.style.pointerEvents = on ? "auto" : "none";
    }
    function paintStats() {
      statLine.textContent = stats.races ? stats.wins + " won · best streak " + stats.best : "";
    }
    function openSheet(open) {
      sheet.style.display = open ? "flex" : "none";
    }
    function placeUI() {
      topBar.style.top = L.uiTop + "px";
      banner.style.top = L.bannerTop + "px";
      replayWrap.style.top = L.replayTop + "px";
    }
    placeUI();

    ctx.listen(btnInfo, "click", () => { unlockAudio(); openSheet(true); });
    ctx.listen(btnClose, "click", () => {
      openSheet(false);
      firstGesture();
      try { ctx.storage.set("seen", 1); } catch (_) {}
    });
    ctx.listen(btnSound, "click", () => { unlockAudio(); setSound(!soundOn); });
    ctx.listen(btnReplay, "click", () => {
      firstGesture();
      if (race.state === "settled" || race.state === "ambient") {
        formRace();
        ctx.platform.interact({ type: "replay" });
      }
    });

    /* ---------------------------------------------------------------- *
     * Input
     *
     * One gesture does everything. Press near a racer while betting and you
     * have backed it. Press anywhere else and your fingertip becomes a warm
     * patch that sweeps loose beads into a single drop; let go and whatever
     * you built is released to run.
     * ---------------------------------------------------------------- */

    let started = false;
    function firstGesture() {
      unlockAudio();
      if (started) return;
      started = true;
      ctx.platform.start();
      startMusic();
      startMotion();
    }

    function pos(e) {
      if (typeof e.offsetX === "number" && typeof e.offsetY === "number") {
        return { x: e.offsetX, y: e.offsetY };
      }
      return { x: L.W / 2, y: L.H / 2 };
    }

    let dragging = false;

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      const p = pos(e);

      if (race.state === "betting") {
        let hit = -1, bd = Infinity;
        for (let i = 0; i < 3; i++) {
          const d = race.racers[i];
          if (!d || d.life <= 0) continue;
          const dist = Math.hypot(d.x - p.x, d.y - p.y);
          if (dist < Math.max(48, d.r + 30 * SZ.s) && dist < bd) { bd = dist; hit = i; }
        }
        if (hit >= 0) { pickRacer(hit); return; }
      }

      if (p.y < L.glass.y - 6 || p.y > L.sillY + 6) return;

      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      dragging = true;

      // Grab the nearest real drop if there is one, otherwise start a fresh
      // bead under the finger and let it grow as you sweep. Drops in the race
      // are off limits — being able to carry your own runner down to the sill
      // would settle every race before it started. You feed it instead.
      let best = null, bestD = SZ.grab;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.life <= 0 || d.racer !== null || d.r < SZ.beadMin * 0.8) continue;
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (dist < bestD) { bestD = dist; best = d; }
      }
      held = best || makeDrop(p.x, p.y, SZ.beadMin);
      held.run = false;
      held.vx = held.vy = 0;
      ctx.platform.interact({ type: "grab" });
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      if (!dragging || !held || held.life <= 0) return;
      e.preventDefault();
      const p = pos(e);
      const px = held.x, py = held.y;
      held.x = clamp(p.x, L.glass.x + held.r, L.glass.x + L.glass.w - held.r);
      held.y = clamp(p.y, L.glass.y + held.r, L.sillY - held.r);
      held.vx = (held.x - px) * 12;
      held.vy = (held.y - py) * 12;

      smears.push({ x: held.x, y: held.y, r: SZ.gather * 0.9, life: 1 });
      if (smears.length > 40) smears.shift();

      const list = nearBeads(held.x, held.y, SZ.gather, scratch);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b === held || b.life <= 0) continue;
        const dx = held.x - b.x, dy = held.y - b.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < held.r + b.r + 2) {
          onMerge(held, absorb(held, b));
          held.x = clamp(held.x, L.glass.x + held.r, L.glass.x + L.glass.w - held.r);
          held.y = clamp(held.y, L.glass.y + held.r, L.sillY - held.r);
        } else if (dist < SZ.gather) {
          // Pulled along, not teleported — you can watch them come to you.
          const k = (1 - dist / SZ.gather) * 2.6 * SZ.s;
          b.x += (dx / dist) * k;
          b.y += (dy / dist) * k;
        }
      }
      if (held.r > stats.biggest) stats.biggest = held.r;
    }, { passive: false });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      if (held && held.life > 0) {
        // Released. If you built something heavy, it goes straight away.
        if (held.r >= SZ.release * 0.76) {
          held.pin = 0.8;
          held.run = true;
          held.vy = Math.max(held.vy, 24 * SZ.s);
          onRelease(held);
          ctx.platform.interact({ type: "release", size: Math.round(held.r) });
        }
      }
      held = null;
      if (e && e.pointerId != null) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }
    ctx.listen(canvas, "pointerup", endDrag);
    ctx.listen(canvas, "pointercancel", endDrag);

    /* ---------------------------------------------------------------- *
     * Tilt parallax
     *
     * Not a free-look camera — just enough that the world outside and the
     * cabin around it disagree slightly when you move the phone, which is
     * most of what sells sitting inside something. The frame stays put and
     * the view through it shifts, exactly as a real window behaves.
     * ---------------------------------------------------------------- */

    let motionOn = false;
    let swayPhase = rr(0, 100);
    async function startMotion() {
      if (motionOn || !ctx.capabilities || !ctx.capabilities.motion) return;
      try { motionOn = !!(await ctx.motion.start()); } catch (_) { motionOn = false; }
    }

    function stepTilt(dt) {
      let tx, ty;
      if (motionOn && ctx.motion && ctx.motion.active) {
        const t = ctx.motion.tilt || {};
        tx = clamp((t.y || 0) / 26, -1, 1);
        ty = clamp(((t.x || 0) - 42) / 34, -1, 1);
      } else {
        // No motion grant: the car sways on its own.
        swayPhase += dt * 0.28;
        tx = Math.sin(swayPhase) * 0.34 + Math.sin(swayPhase * 1.83) * 0.14;
        ty = Math.sin(swayPhase * 0.71 + 2) * 0.2;
      }
      const maxT = Math.min(26, L.W * 0.06);
      tiltX += (tx * maxT - tiltX) * Math.min(1, dt * 3.4);
      tiltY += (ty * maxT * 0.4 - tiltY) * Math.min(1, dt * 3.4);
      worldOffX = tiltX;
      worldOffY = clamp(tiltY, -L.glass.h * 0.045, L.glass.h * 0.045);
    }

    /* ---------------------------------------------------------------- *
     * Frame
     * ---------------------------------------------------------------- */

    let avgDt = 16;

    ctx.onFrame((dtMs, timeMs) => {
      nowMs = timeMs;
      if (ctx.width !== L.rawW || ctx.height !== L.rawH) queueRelayout();
      if (race.until === null) race.until = nowMs + 2400;
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      avgDt = avgDt * 0.94 + dtMs * 0.06;

      // Lensing is the expensive part, so it is the first thing to go on a
      // slow device and the first thing back when there is headroom again.
      if (avgDt > 27 && lensBudget > 5) lensBudget--;
      else if (avgDt < 19 && lensBudget < TUNE.maxLens) lensBudget++;

      // The car is moving. Near things slide past faster than far things.
      scrollFar = (scrollFar + dt * 17) % L.glass.w;
      scrollNear = (scrollNear + dt * 56) % L.glass.w;

      stepTilt(dt);
      healMist(dt);
      rain(dt);
      stepDrops(dt);
      stepRace();

      for (let i = smears.length - 1; i >= 0; i--) {
        smears[i].life -= dt * 1.5;
        smears[i].r += dt * 12;
        if (smears[i].life <= 0) smears.splice(i, 1);
      }
      if (feedFlash > 0) feedFlash = Math.max(0, feedFlash - dt * 2);

      // Rain and wind beds ride the same gusts that are slanting the drops.
      if (ac && rainGain && ac.state === "running") {
        const gust = 0.5 + 0.5 * Math.sin(windPhase * 0.8);
        try {
          rainGain.gain.setTargetAtTime(0.04 + gust * 0.028, ac.currentTime, 0.5);
          windGain.gain.setTargetAtTime(0.032 + gust * 0.042, ac.currentTime, 0.7);
          windFilter.frequency.setTargetAtTime(300 + gust * 190, ac.currentTime, 0.9);
        } catch (_) {}
      }

      render();
    });

    /* ---------------------------------------------------------------- *
     * Resize
     * ---------------------------------------------------------------- */

    // The runtime owns the canvas and keeps its backing store matched to the
    // container, so all a resize means here is re-deriving the layout and
    // re-baking anything sized to the glass. Driven off the measured size
    // rather than the window event, because the container can change without
    // the window doing anything (host chrome, split view, keyboard).
    let resizeQueued = false;
    function queueRelayout() {
      if (resizeQueued) return;
      resizeQueued = true;
      ctx.timeout(() => {
        resizeQueued = false;
        const o = { x: L.glass.x, y: L.glass.y, w: L.glass.w, h: L.glass.h };
        layout();
        // Carry the weather across rather than wiping the glass clean.
        const sx = L.glass.w / (o.w || 1), sy = L.glass.h / (o.h || 1);
        for (let i = 0; i < drops.length; i++) {
          const d = drops[i];
          d.x = L.glass.x + (d.x - o.x) * sx;
          d.y = L.glass.y + (d.y - o.y) * sy;
        }
        bakeWorld();
        bakeBeads();
        bakeMist();
        placeUI();
      }, 180);
    }
    ctx.listen(window, "resize", queueRelayout);
    ctx.listen(window, "orientationchange", queueRelayout);

    /* ---------------------------------------------------------------- *
     * Boot
     * ---------------------------------------------------------------- */

    bakeWorld();
    bakeBeads();
    bakeMist();
    seedGlass(Math.round(SZ.maxBeads * 0.8));

    try {
      const pref = await ctx.storage.get("sound");
      if (pref === false) soundOn = false;
    } catch (_) {}
    btnSound.textContent = soundOn ? "♪" : "✕";

    // Draw before anything else so the host never sees an empty frame.
    render();
    ctx.markVisualReady("first_glass");

    loadStats();

    let seen = null;
    try { seen = await ctx.storage.get("seen"); } catch (_) {}
    if (!seen) openSheet(true);

    ctx.platform.ready();
  }
};
