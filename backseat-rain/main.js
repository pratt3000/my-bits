/**
 * Backseat Rain
 *
 * You are in the back seat. The car is moving, it is raining, and the window
 * beside you is doing the thing it always does: condensation gathers into
 * beads, beads find each other and pool, they lean sideways because of the air
 * sliding over the glass, and then one gets heavy enough that surface tension
 * gives up and it *runs* — eating every bead in its path on the way down,
 * getting faster the fatter it gets, and tearing a clear channel through the
 * mist behind it.
 *
 * That release is the whole feeling this bit is built around. Everything else
 * is in service of it:
 *
 *  - Drops are simulated, never scripted. A bead holds until its weight beats
 *    the pin force of its own contact patch, so the moment it breaks loose is
 *    emergent and different every single run.
 *  - Runners cut a real channel through the condensation and shed mass as they
 *    go. The channel heals slowly and the shed beads re-pool, so a later runner
 *    can inherit a lane the first one cleared. That is where the rivalry
 *    between paths comes from.
 *  - Small drops slant more than big ones. Wind acts on frontal area (~r^2),
 *    gravity acts on mass (~r^3), so sideways push per unit mass falls off as
 *    1/r. Fat drops plummet; little ones drift off toward the back of the car.
 *  - Every drop above a size threshold is a real lens: the world outside is
 *    sampled, flipped through the focal point, and magnified inside its body.
 *    That inversion is what makes rain-on-glass read as *glass*.
 *
 * The game on top is the bet you already make without meaning to. Three drops
 * get rings; you back one; first to the sill wins. Drag the glass to sweep
 * loose beads into one heavy drop and drop it in your racer's path.
 *
 * ── Two views, one simulation ────────────────────────────────────────────
 *
 * The glass is simulated into its own offscreen surface in its own coordinate
 * space, which means it can be presented two ways from the same pixels:
 *
 *  - **Cabin** (the real thing): three@0.164.1 builds the back of the car
 *    around you — door card, seat, headrests, pillars, roof lining — and hangs
 *    the glass surface in the window aperture as a texture. Drag the interior
 *    to look around; drag the glass to touch it. Streetlights sliding past
 *    outside are the *same* lamps that light the cabin, so a lamp passing the
 *    window sweeps warm light across the seat beside you.
 *  - **Flat** (the fallback): the glass drawn straight to a 2D canvas with a
 *    painted frame around it. This is what renders on the very first frame,
 *    before three has finished loading, and it is where the bit stays for good
 *    if three fails, if there is no WebGL, or if there is no OffscreenCanvas.
 *    Fully playable either way — the cabin is presentation, not mechanics.
 *
 * Contract notes (plethora-bit@2):
 *  - One registry dependency, three@0.164.1, declared in the manifest and
 *    loaded through ctx.importModule. No packaged assets (maxAssets is 0):
 *    scenery, cabin geometry, drops and every sound are generated at runtime.
 *  - Offscreen bakes go to `OffscreenCanvas`. Minting a canvas element by hand
 *    is rejected by the upload validator, and `ctx.createCanvas()` is a display
 *    surface the runtime mounts, which is not what a bake wants. Without
 *    OffscreenCanvas `makeSurface()` returns null and every bake site falls
 *    back to drawing live.
 *  - `document.createElement` is only ever called with a literal tag. A
 *    computed tag cannot be statically shown not to be a canvas or a script,
 *    and the validator rejects it.
 *  - Pointer position comes from `event.offsetX/offsetY`. Querying layout
 *    rectangles is rejected by the validator, and offsets are already
 *    canvas-relative, which also skips a forced reflow per pointer event.
 *  - Those two rules are why this header describes the banned calls rather
 *    than spelling them out: the validator reads the source as text, and a
 *    comment quoting them verbatim is enough to trip it.
 *  - Timers go through `ctx.timeout`, listeners through `ctx.listen`, and no
 *    blur filter is used anywhere, canvas or CSS.
 */
window.plethoraBit = {
  meta: {
    title: "Window Seat",
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
      "3d"
    ],
    permissions: ["audio", "backgroundMusic", "haptics", "motion", "storage"]
  },

  async init(ctx) {
    "use strict";

    /* ---------------------------------------------------------------- *
     * Tuning
     *
     * Lengths are in reference pixels of glass at a 380-wide pane. `sizes()`
     * scales them so a drop keeps the same apparent size whether the pane is
     * a phone-width rectangle or a texture on a car window.
     * ---------------------------------------------------------------- */

    const TUNE = {
      mistPerSec: 260,
      // Reference sizes on a 920-wide pane. The sub-pixel haze a real window
      // is covered in lives in the condensation bake, not in the simulation —
      // simulating it would cost thousands of bodies to draw something the
      // texture already draws for free. These start where a drop is visible.
      beadR: [0.75, 2.5],
      releaseR: 4.2,
      maxRunMul: 1.75,
      pinJitter: [0.8, 1.32],
      beadCoverage: 0.021,
      accrete: 0.5,
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
      // How fast the car is going, in pane widths of near-verge per second.
      // Everything that should follow from road speed is derived from this:
      // how quickly the world slides past, and how hard the air coming over
      // the door is pushing the water sideways.
      // Weather, not road speed — the room is standing still. The wind is
      // what leans the drops; the drift is just the world outside not being
      // a photograph.
      carSpeed: 1,
      scrollNearAt1: 17,
      scrollFarAt1: 5,
      windAt1: -96,
      windGust: 62,
      windRate: 0.6,

      shedEveryPx: 5,
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

    // Pane size used when the glass is a texture in the cabin. Wider than tall
    // like a real rear side window, and sized so one texel lands near one
    // device pixel once it is on screen.
    const PANE_3D = { w: 920, h: 640 };

    /* ---------------------------------------------------------------- *
     * Random. Reseeded per run so it is never the same window twice.
     * ---------------------------------------------------------------- */

    let seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    function rnd() {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    }
    const rr = (a, b) => a + (b - a) * rnd();
    const ri = (a, b) => Math.floor(rr(a, b + 1));
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;

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
     * Surfaces
     *
     * Both display surfaces are minted up front, before the UI root, so the
     * UI always stacks on top of whichever one is showing. The WebGL one
     * starts hidden and is revealed only if the cabin actually builds.
     * ---------------------------------------------------------------- */

    const view2d = ctx.createCanvas2D({ touchAction: "none" });
    const g = view2d.getContext("2d");
    const view3d = ctx.createCanvas({ touchAction: "none" });
    view3d.style.display = "none";

    let mode = "flat";                    // "flat" | "cabin"

    /* ---------------------------------------------------------------- *
     * Layout
     *
     * In flat mode the glass is inset on every side and a painted interior
     * frames it. That is both truer to a back-side window and the reason the
     * finish line clears the bottom unsafe area: the sill is where the race
     * ends, and everything below it is door card nobody has to reach.
     * ---------------------------------------------------------------- */

    const L = {};
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
      // The door card only has to read as a door and keep the finish line out
      // of the bottom unsafe area. Letting it scale without a ceiling is what
      // squeezes the glass flat in landscape.
      L.glass.h = Math.max(
        120, H - (sa.bottom || 0) - clamp(H * 0.145, 54, 132) - L.glass.y
      );
      L.sillY = L.glass.y + L.glass.h;
      L.glass.r = Math.min(34, L.glass.w * 0.11, L.glass.h * 0.11);
      L.uiTop = (sa.top || 0) + 10;

      // On a short window there is no room for a caption over the glass
      // without burying the drops, and the door card below is dead space.
      L.short = L.glass.h < 330;
      L.bannerTop = L.short ? Math.min(H - 42, L.sillY + 5) : L.uiTop + 50;
      L.replayTop = L.short ? L.uiTop + 42 : L.uiTop + 126;
    }
    layout();

    /* ---------------------------------------------------------------- *
     * Glass space
     *
     * The simulation lives in its own coordinate space, origin at the top-left
     * of the pane, so nothing in it knows or cares whether it is being blitted
     * into a rounded rectangle or uploaded as a texture.
     * ---------------------------------------------------------------- */

    const G = { w: 0, h: 0, dpr: 1 };
    // Thousands of drops are only affordable as instanced geometry. The flat
    // fallback paints them one at a time, so it gets a population it can
    // actually draw — at that pane size the extra ones are sub-pixel anyway.
    let paneIsGL = false;
    const SZ = {};
    let glassCv = null, gg = null;

    function sizes() {
      // Sizes are quoted against the 920-wide reference pane, so a drop keeps
      // the same apparent size whichever surface it ends up on.
      const s = clamp(G.w / 920, 0.34, 2.2);
      SZ.s = s;
      SZ.beadMin = TUNE.beadR[0] * s;
      SZ.beadMax = TUNE.beadR[1] * s;
      SZ.release = TUNE.releaseR * s;
      // A drop on a vertical pane cannot grow without limit: past a critical
      // size the contact line stops holding the extra weight and it sheds the
      // excess behind it. Without a ceiling a runner that eats a whole lane
      // ends up the size of a coin.
      SZ.maxRun = TUNE.releaseR * TUNE.maxRunMul * s;
      SZ.spriteMax = 5 * s;
      SZ.lensMin = 2.4 * s;
      SZ.cell = 13 * s;
      SZ.grab = 34 * s;
      SZ.gather = 30 * s;
      SZ.shedEvery = TUNE.shedEveryPx * 1.9 * s;
      SZ.gravity = TUNE.gravity * 1.9 * s;
      // Air over the glass comes from the car moving, so the sideways push
      // is the road speed, not a separate dial.
      SZ.windBase = TUNE.windAt1 * TUNE.carSpeed * 1.9 * s;
      SZ.windGust = TUNE.windGust * (0.45 + 0.55 * TUNE.carSpeed) * 1.9 * s;
      // Terminal speed is gravity*r^2/friction. Gravity carries one factor of
      // s and r^2 carries two, so friction needs s^2 for speeds to stay
      // pane-relative instead of exploding on a bigger pane.
      SZ.friction = TUNE.friction * 1.9 * s * s;
      // Vapour lands on beads in proportion to the area they present, so
      // dm/dt = k*r^2 with m = r^3 makes dr/dt constant: a bead takes
      // 3*(release - r0)/k seconds to break loose regardless of where it
      // started. Per-drop `grow` jitter spreads those releases out.
      SZ.accrete = TUNE.accrete * 1.9 * s;

      // Hold the resting mist at a roughly constant fraction of the pane so a
      // big pane looks as wet as a small one rather than emptier. The spawn
      // radius is cubic-biased toward the minimum (see mistR), whose mean sits
      // a quarter of the way up the range.
      const meanArea = Math.PI * Math.pow(SZ.beadMin + (SZ.beadMax - SZ.beadMin) * 0.25, 2);
      SZ.maxBeads = clamp(Math.round((G.w * G.h * TUNE.beadCoverage) / meanArea),
        400, paneIsGL ? 4200 : 900
      );
    }

    // (Re)build the pane at a given size and repopulate it. Called once for
    // the flat view and again if and when the cabin takes over at its own
    // aspect ratio.
    //
    // `offscreen` is only ever true for the cabin, which needs the pane as a
    // texture. The flat view deliberately paints straight into the display
    // canvas: Chromium accelerates a canvas that is on screen but rasterises
    // an offscreen 2D context in software, and routing the flat view through
    // one costs an order of magnitude for nothing.
    function setupGlass(w, h, dpr, offscreen) {
      G.w = Math.max(80, Math.round(w));
      G.h = Math.max(80, Math.round(h));
      G.dpr = dpr;
      sizes();

      glassCv = offscreen ? makeSurface(G.w * G.dpr, G.h * G.dpr) : null;
      if (glassCv) {
        gg = glassCv.getContext("2d");
        gg.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
      } else {
        gg = null;
      }

      bakeWorld();
      bakeBeads();
      bakeMist();
      drops.length = 0;
      held = null;
      dragging = false;
      seedGlass(Math.round(SZ.maxBeads * 0.8));
    }

    /* ---------------------------------------------------------------- *
     * The world outside
     *
     * Baked once as two horizontally tileable strips (far and near) whose
     * period is exactly the pane width, so scrolling is a pair of drawImage
     * calls with an offset and never a reseam. Every element is drawn at
     * ox = -w, 0 and +w so shapes straddling a period edge wrap cleanly.
     *
     * The content is deliberately shapeless: your eye is focused on the glass,
     * so everything past it is bokeh — soft masses and blown-out points of
     * light, no legible edges. The blurred copies are those bakes bounced
     * through a tiny canvas, since no blur filter is available here.
     *
     * The sharp strips are kept because a droplet lens needs something
     * *sharper* than the background to magnify. That contrast — soft world,
     * crisp inverted world inside each bead — is the whole optical trick.
     * ---------------------------------------------------------------- */

    const SKY = ["#060a13", "#0c1424", "#152036", "#241f31"];
    let stripFar = null, stripNear = null, blurFar = null, blurNear = null;
    let stripW = 0, stripH = 0;
    // Where the near-strip lamps sit, kept so the cabin can be lit by the
    // same lamps that are sliding past the window.
    let nearLamps = [];

    function bakeWorld() {
      stripFar = stripNear = blurFar = blurNear = null;
      stripW = Math.max(64, Math.round(G.w * 0.62));
      stripH = Math.max(64, Math.round(G.h * 0.62));

      const far = makeSurface(stripW, stripH);
      const near = makeSurface(stripW, stripH);
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

    // A soft, low, undulating dark mass — the far treeline and the near verge.
    // No hard silhouettes anywhere out there.
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
      const hy = h * 0.44;                       // horizon

      const sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#0a1226");
      sky.addColorStop(0.34, "#152444");
      sky.addColorStop(0.58, "#1f2a48");
      sky.addColorStop(0.74, "#2a2440");
      sky.addColorStop(1, "#1a1626");
      c.fillStyle = sky;
      c.fillRect(0, 0, w, h);

      // Sodium haze sitting on the horizon — the town you are driving out of.
      const glow = c.createLinearGradient(0, hy - h * 0.4, 0, hy + h * 0.06);
      glow.addColorStop(0, "rgba(255,150,84,0)");
      glow.addColorStop(0.7, "rgba(255,146,78,0.14)");
      glow.addColorStop(1, "rgba(255,178,110,0.2)");
      c.fillStyle = glow;
      c.fillRect(0, 0, w, h);

      // Everything is generated once and stamped at every period so the strip
      // tiles, and drawn three times over so a shape crossing an edge wraps.
      const lamps = [];
      const n = clamp(Math.round(w / 13), 14, 70);
      for (let i = 0; i < n; i++) {
        const near = rnd();
        lamps.push({
          x: rr(0, w),
          y: hy + rr(-h * 0.22, h * 0.1) * (1 - near * 0.5),
          r: rr(h * 0.012, h * 0.075) * (0.5 + near),
          warm: rnd() < 0.7,
          a: rr(0.4, 1) * (0.45 + near * 0.55),
          streak: rnd() < 0.55
        });
      }
      // A handful of headlights and tail lights down at road level.
      const cars = [];
      for (let i = 0; i < clamp(Math.round(w / 90), 2, 8); i++) {
        cars.push({ x: rr(0, w), y: hy + rr(h * 0.02, h * 0.1), r: rr(h * 0.02, h * 0.05),
                    red: rnd() < 0.5, a: rr(0.5, 0.95) });
      }

      for (let p = 0; p < PERIODS.length; p++) {
        const ox = PERIODS[p] * w;
        // Wet tarmac takes every light and smears it downward.
        for (let i = 0; i < lamps.length; i++) {
          const lp = lamps[i];
          if (!lp.streak) continue;
          const rgb = lp.warm ? [255, 178, 104] : [150, 196, 255];
          const steps = 7;
          for (let k = 1; k <= steps; k++) {
            const t = k / steps;
            const y = lp.y + (h - lp.y) * t;
            lamp(c, ox + lp.x, y, lp.r * (1.6 + t * 2.6), rgb, lp.a * 0.09 * (1 - t));
          }
        }
        for (let i = 0; i < lamps.length; i++) {
          const lp = lamps[i];
          lamp(c, ox + lp.x, lp.y, lp.r * 3.4,
               lp.warm ? [255, 184, 108] : [142, 194, 255], lp.a * 0.3);
          lamp(c, ox + lp.x, lp.y, lp.r,
               lp.warm ? [255, 214, 158] : [190, 220, 255], lp.a);
        }
        for (let i = 0; i < cars.length; i++) {
          const cr = cars[i];
          lamp(c, ox + cr.x, cr.y, cr.r * 2.6,
               cr.red ? [255, 70, 50] : [255, 240, 220], cr.a * 0.5);
        }
      }

      const road = c.createLinearGradient(0, h * 0.72, 0, h);
      road.addColorStop(0, "rgba(255,168,96,0.04)");
      road.addColorStop(0.5, "rgba(140,146,190,0.05)");
      road.addColorStop(1, "rgba(10,12,22,0.72)");
      c.fillStyle = road;
      c.fillRect(0, h * 0.72, w, h * 0.28);
    }

    function paintNear(c, w, h) {
      c.clearRect(0, 0, w, h);

      // Big soft lamps whipping past close to the car, and a low verge.
      const blobs = [];
      const n = clamp(Math.round(w / 130), 3, 8);
      for (let i = 0; i < n; i++) {
        blobs.push({
          x: (w * (i + rr(0.15, 0.85))) / n,
          y: rr(h * 0.08, h * 0.4),
          r: rr(h * 0.1, h * 0.24),
          a: rr(0.5, 0.95)
        });
      }
      nearLamps = blobs.map((b) => ({ u: b.x / w, a: b.a }));

      for (let p = 0; p < PERIODS.length; p++) {
        const ox = PERIODS[p] * w;
        darkMass(c, w, h, h * 0.93, h * 0.02, "rgba(3,5,11,0.8)", ox);
        for (let i = 0; i < blobs.length; i++) {
          const b = blobs[i];
          lamp(c, ox + b.x, b.y, b.r * 2.2, [255, 176, 100], b.a * 0.34);
          lamp(c, ox + b.x, b.y, b.r * 0.55, [255, 226, 178], b.a);
        }
      }
    }

    /* ---------------------------------------------------------------- *
     * Condensation
     *
     * A static layer of fine mist over the whole pane. Runners cut through it
     * with destination-out, which is what makes a trail read as a cleared
     * channel rather than a line drawn on top. It heals by fading the pristine
     * copy back in slowly, so old lanes linger exactly as long as they should.
     * ---------------------------------------------------------------- */

    let mistBase = null, mistTex = null, mistCtx = null;
    const MIST_SCALE = 0.7;
    let healAcc = 0;

    function bakeMist() {
      mistBase = mistTex = mistCtx = null;
      const w = Math.max(32, Math.round(G.w * MIST_SCALE));
      const h = Math.max(32, Math.round(G.h * MIST_SCALE));
      const base = makeSurface(w, h);
      const tex = makeSurface(w, h);
      if (!base || !tex) return;

      const c = base.getContext("2d");

      // Smoky body first. Without it the layer is only specks, and a channel
      // cut through specks reads as missing dots rather than as clear glass.
      const blobs = Math.round((w * h) / 520);
      for (let i = 0; i < blobs; i++) {
        const x = rr(0, w), y = rr(0, h), r = rr(3, 12) * MIST_SCALE * clamp(SZ.s, 0.6, 1.6);
        const gr = c.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, "rgba(198,220,250," + rr(0.05, 0.13) + ")");
        gr.addColorStop(1, "rgba(198,220,250,0)");
        c.fillStyle = gr;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }

      // Then the grain on top. Fine and faint — any speck you can pick out
      // reads as dirt or a starfield, not as breath on cold glass.
      const n = Math.round((w * h) / 7);
      for (let i = 0; i < n; i++) {
        const r = rr(0.3, 1.15) * MIST_SCALE * clamp(SZ.s, 0.6, 1.6);
        c.fillStyle = "rgba(202,222,250," + rr(0.04, 0.16) + ")";
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
      mistCtx.globalCompositeOperation = "destination-out";
      mistCtx.beginPath();
      mistCtx.arc(x * MIST_SCALE, y * MIST_SCALE, r * MIST_SCALE, 0, Math.PI * 2);
      mistCtx.fill();
      mistCtx.globalCompositeOperation = "source-over";
      mistDirty = true;
    }

    function healMist(dt) {
      if (!mistCtx || !mistBase) return;
      healAcc += dt;
      if (healAcc < 0.25) return;
      healAcc = 0;
      mistCtx.globalAlpha = 0.05;
      mistCtx.drawImage(mistBase, 0, 0);
      mistCtx.globalAlpha = 1;
      mistDirty = true;
    }

    /* ---------------------------------------------------------------- *
     * Bead sprite atlas
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
        body.addColorStop(0, "rgba(150,180,220,0.26)");
        body.addColorStop(0.55, "rgba(70,96,140,0.2)");
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
        rim.addColorStop(1, "rgba(200,222,250,0.28)");
        c.fillStyle = rim;
        c.beginPath();
        c.arc(half, half, r, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = "rgba(255,255,255,0.58)";
        c.beginPath();
        c.arc(half - r * 0.32, half - r * 0.36, Math.max(0.35, r * 0.12), 0, Math.PI * 2);
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
     * Drops — all coordinates are pane-space, origin top-left of the glass
     * ---------------------------------------------------------------- */

    const drops = [];
    let held = null;
    let scrollFar = 0, scrollNear = 0;
    let wind = 0;
    let windPhase = rr(0, 100);
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
        vari: ri(0, 2),
        // Beads are never perfectly round; a little ellipticity per drop
        // does the job that a lobed outline only pretends to.
        aspect: rr(0.88, 1.14),
        wob: rr(0, 6.28)
      };
      if (opts) for (const k in opts) d[k] = opts[k];
      drops.push(d);
      return d;
    }

    // Condensation is mostly very fine with a few standouts, so bias the spawn
    // size hard toward the bottom of the range. A flat distribution gives every
    // bead the same apparent size and the glass looks printed.
    function mistR() {
      const t = rnd();
      return SZ.beadMin + (SZ.beadMax - SZ.beadMin) * t * t * t * t;
    }

    function seedGlass(n) {
      for (let i = 0; i < n; i++) makeDrop(rr(0, G.w), rr(0, G.h), mistR());
    }

    // Spatial hash over the resting beads, rebuilt each frame.
    const grid = new Map();
    function rebuildGrid() {
      grid.clear();
      const cell = SZ.cell;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.run || d.life <= 0) continue;   // runners query, are not queried
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
      // drop carries its colours on and inherits its start-line pin, so a
      // pooling bead cannot flag it away early. Two racers meeting is a
      // knockout for the smaller one.
      if (b.racer !== null) {
        if (a.racer === null) {
          a.racer = b.racer;
          a.pin = Math.max(a.pin, b.pin);
          race.racers[b.racer] = a;
          // If the drop that swallowed it was already running, the race would
          // start with one runner mid-flight. Pin it back to the line.
          if (race.state === "betting") { a.run = false; a.vx = 0; a.vy = 0; }
        } else if (race.racers[b.racer] === b) {
          race.racers[b.racer] = null;
        }
      }
      b.racer = null;
      b.life = 0;
      return b.m;
    }

    function stepDrops(dt) {
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
        // Both axes relax toward terminal exponentially, which is exact rather
        // than merely stable — a drop that sheds down to a sliver would blow
        // up an explicit step at this friction.
        const fr = Math.max(0.05, SZ.friction / (d.r * d.r));
        const k = Math.exp(-fr * dt);
        const tvy = SZ.gravity / fr;
        const tvx = (wind * (SZ.release / d.r)) / fr;
        d.vy = tvy + (d.vy - tvy) * k;
        d.vx = tvx + (d.vx - tvx) * k;

        const px = d.x, py = d.y;
        d.x += d.vx * dt;
        d.y += d.vy * dt;

        clearMist(d.x, d.y, d.r * 1.15);

        // Eat everything on the way through.
        const list = nearBeads(d.x, d.y, d.r + 3 * SZ.s, scratch);
        for (let j = 0; j < list.length; j++) {
          const b = list[j];
          if (b === d || b.life <= 0 || b.run) continue;
          const dx = b.x - d.x, dy = b.y - d.y;
          const reach = d.r + b.r * 0.7;
          if (dx * dx + dy * dy < reach * reach) onMerge(d, absorb(d, b));
        }

        // Past the critical size it cannot hold itself together; the excess
        // breaks off behind it rather than riding along.
        if (d.r > SZ.maxRun) {
          const excess = d.m - massOf(SZ.maxRun);
          d.m -= excess;
          d.r = radOf(d.m);
          if (rnd() < 0.7 && drops.length < SZ.maxBeads + 300) {
            makeDrop(
              d.x + rr(-1, 1) * d.r * 0.8,
              d.y - d.r * rr(1.1, 2.2),
              clamp(radOf(excess * rr(0.4, 0.8)), SZ.beadMin, SZ.maxRun * 0.75)
            );
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
        if (d.x < d.r) { d.x = d.r; if (d.vx < 0) d.vx *= -0.15; }
        else if (d.x > G.w - d.r) { d.x = G.w - d.r; if (d.vx > 0) d.vx *= -0.15; }

        if (d.y - d.r > G.h) {
          d.life = 0;
          onArrive(d);
        }
      }

      // Runners catch each other too: a heavy drop overhauling a lighter one
      // takes it, and the survivor keeps whichever racer colours were in play.
      // Without this a drop you built could never reach your racer once the
      // racer was already moving, and "feed it" would be a lie. There are only
      // ever a handful of runners, so the pairwise sweep is free.
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

    // Resting beads find each other and pool.
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
      // The rate eases off during a race so the lanes stay legible exactly
      // when the player is trying to follow one drop.
      const busy = race.state === "running" ? 0.62 : 1;
      let n = TUNE.mistPerSec * dt * busy;
      while (n > 0) {
        if (rnd() < n && drops.length < SZ.maxBeads) {
          makeDrop(rr(0, G.w), rr(0, G.h - 4), mistR());
        }
        n -= 1;
      }
    }

    /* ---------------------------------------------------------------- *
     * Painting the glass — pane space, origin (0,0), size G.w x G.h
     * ---------------------------------------------------------------- */

    let lensBudget = TUNE.maxLens;
    const smears = [];
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
      // The arc must sweep the *leading* half, from -90 through the heading to
      // +90. Sweeping the other way puts the round end at the back and the
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
      const qx = stripW / G.w, qy = stripH / G.h;
      const sw = Math.max(2, (d.r * 2) / 2.4);
      const swx = sw * qx, swy = sw * qy;

      const fx = (((d.x - worldOffX + scrollFar) % G.w) + G.w) % G.w;
      const nx = (((d.x - worldOffX * 1.35 + scrollNear) % G.w) + G.w) % G.w;
      const sy = clamp(
        clamp(d.y - worldOffY, 0, G.h) * qy - swy / 2, 0, Math.max(0, stripH - swy)
      );

      c.save();
      c.translate(d.x, d.y);
      c.scale(-1, -1);                      // a lens flips the image
      c.globalAlpha = 0.95;
      c.drawImage(
        stripFar, clamp(fx * qx - swx / 2, 0, stripW - swx), sy, swx, swy,
        -d.r, -d.r, d.r * 2, d.r * 2
      );
      c.globalAlpha = 0.78;
      c.drawImage(
        stripNear, clamp(nx * qx - swx / 2, 0, stripW - swx), sy, swx, swy,
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
        c.fillStyle = "rgba(70,92,126,0.3)";
        c.fill();
      }

      // The curve catches light right around its edge. Doing this as a
      // gradient inside the clip, rather than as a stroked arc, is the
      // difference between a wet bead and a smiley face.
      const rim = c.createRadialGradient(
        d.x - d.r * 0.24, d.y - d.r * 0.28, d.r * 0.12, d.x, d.y, d.r * 1.06
      );
      rim.addColorStop(0, "rgba(206,230,255,0)");
      rim.addColorStop(0.66, "rgba(206,230,255,0.03)");
      rim.addColorStop(1, "rgba(198,220,248,0.3)");
      c.fillStyle = rim;
      c.fill();
      c.restore();

      // A thin dark line just inside the edge, where refraction bends the
      // background away. Thin — a heavy outline turns water into a sticker.
      dropPath(c, d);
      c.strokeStyle = "rgba(4,7,14,0.45)";
      c.lineWidth = Math.max(0.5, d.r * 0.09);
      c.stroke();

      c.fillStyle = "rgba(255,255,255,0.6)";
      c.beginPath();
      c.arc(d.x - d.r * 0.32, d.y - d.r * 0.36, Math.max(0.35, d.r * 0.1), 0, Math.PI * 2);
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

    // Everything the pane contains: the world beyond it, the condensation on
    // it, and the drops sitting on top. No frame, no cabin — whoever is
    // presenting this decides how it is mounted.
    function renderGlass(c) {
      const sky = c.createLinearGradient(0, 0, 0, G.h);
      sky.addColorStop(0, SKY[0]);
      sky.addColorStop(0.5, SKY[1]);
      sky.addColorStop(1, SKY[3]);
      c.fillStyle = sky;
      c.fillRect(0, 0, G.w, G.h);

      if (blurFar && blurNear) {
        const over = G.h * 0.05;
        c.imageSmoothingEnabled = true;
        for (let k = 0; k < 2; k++) {
          c.drawImage(blurFar, -scrollFar + k * G.w + worldOffX, -over + worldOffY,
                      G.w, G.h + over * 2);
        }
        c.globalAlpha = 0.95;
        for (let k = 0; k < 2; k++) {
          c.drawImage(blurNear, -scrollNear + k * G.w + worldOffX * 1.35, -over + worldOffY,
                      G.w, G.h + over * 2);
        }
        c.globalAlpha = 1;
      }

      // The glass itself: cold cast, so the drops sitting on it read as the
      // brightest thing in the pane.
      c.fillStyle = "rgba(8,14,26,0.42)";
      c.fillRect(0, 0, G.w, G.h);

      if (mistTex) {
        c.globalAlpha = 0.8;
        c.drawImage(mistTex, 0, 0, G.w, G.h);
        c.globalAlpha = 1;
      }

      const fog = c.createRadialGradient(
        G.w * 0.5, G.h * 0.46, Math.min(G.w, G.h) * 0.15,
        G.w * 0.5, G.h * 0.46, Math.max(G.w, G.h) * 0.72
      );
      fog.addColorStop(0, "rgba(188,208,235,0)");
      fog.addColorStop(0.72, "rgba(188,208,235,0.05)");
      fog.addColorStop(1, "rgba(198,216,240,0.17)");
      c.fillStyle = fog;
      c.fillRect(0, 0, G.w, G.h);

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
    }

    /* ---------------------------------------------------------------- *
     * Flat view — the glass in a painted frame
     * ---------------------------------------------------------------- */

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

    function drawFlatInterior(c) {
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

      const roof = c.createLinearGradient(0, 0, 0, gl.y);
      roof.addColorStop(0, "#10151e");
      roof.addColorStop(1, "#06080d");
      c.fillStyle = roof;
      c.fillRect(0, 0, W, gl.y);

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
      c.moveTo(gl.x + gl.r * 0.4, sillTop + 1.6);
      c.lineTo(gl.x + gl.w - gl.r * 0.4, sillTop + 1.6);
      c.stroke();

      c.strokeStyle = "rgba(22,27,38,0.9)";
      c.lineWidth = Math.max(7, W * 0.023);
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(W + 8, gl.y - 26);
      c.quadraticCurveTo(W * 0.965, H * 0.55, W * 0.9, H + 20);
      c.stroke();
      c.strokeStyle = "rgba(126,144,176,0.09)";
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(W + 8, gl.y - 30);
      c.quadraticCurveTo(W * 0.958, H * 0.55, W * 0.893, H + 20);
      c.stroke();
    }

    function renderFlat() {
      g.clearRect(0, 0, L.W, L.H);
      const gl = L.glass;
      g.save();
      roundRect(g, gl.x, gl.y, gl.w, gl.h, gl.r);
      g.clip();
      g.translate(gl.x, gl.y);
      renderGlass(g);
      g.restore();
      drawFlatInterior(g);
    }

    /* ---------------------------------------------------------------- *
     * The pane, in GL
     *
     * A droplet is a lens, and a lens cannot be faked with gradients — that
     * is what made the first version read as grey bubbles rather than water.
     * So the pane is rendered properly: the world outside goes in as a
     * texture, the glass itself is a blurred sample of it, and every droplet
     * is an instanced quad carrying a baked surface normal that *refracts*
     * that world. Sampling opposite the normal is what inverts and magnifies
     * the image inside the drop, which is the single thing your eye uses to
     * decide it is looking at water.
     *
     * Instancing is also what makes the density believable. Painting each
     * drop by hand capped the glass at a few hundred; one quad each means
     * thousands, so the fine haze of condensation that a real window is
     * covered in can actually be there.
     * ---------------------------------------------------------------- */

    const DROP_CAP = 5000;
    const ATLAS_TILE = 96;          // per variant, 2x2 grid
    let dropAtlas = null;

    // Baked droplet surface normals. For a dome z = H·sqrt(1 - d²) the normal
    // works out as (k·u/s, k·v/s, 1) with s = sqrt(1 - d²) and k = H/R, so a
    // small k gives the flat, wide-contact-angle bead that sits on cold glass
    // and a large k gives a fat one about to run.
    function bakeDropAtlas() {
      const T = ATLAS_TILE, N = T * 2;
      const cv = makeSurface(N, N);
      if (!cv) return null;
      const c = cv.getContext("2d");
      const img = c.createImageData(N, N);
      const px = img.data;
      // k, and how much the outline wobbles away from a circle.
      const VAR = [
        { k: 0.55, wob: 0, tail: 0 },
        { k: 0.78, wob: 0, tail: 0 },
        { k: 1.05, wob: 0, tail: 0 },
        { k: 0.86, wob: 0, tail: 0.5 }
      ];
      for (let v = 0; v < 4; v++) {
        const ox = (v % 2) * T, oy = ((v / 2) | 0) * T;
        const cfg = VAR[v];
        const ph = rr(0, 6.28), ph2 = rr(0, 6.28);
        for (let y = 0; y < T; y++) {
          for (let x = 0; x < T; x++) {
            let u = (x + 0.5) / T * 2 - 1;
            let w = (y + 0.5) / T * 2 - 1;
            // Teardrop: squeeze the trailing half so it tapers to a point.
            let uu = u;
            if (cfg.tail > 0 && w < 0) uu = u / Math.max(0.18, 1 + cfg.tail * w * 1.6);
            const ang = Math.atan2(w, uu);
            const shape =
              1 - cfg.wob * (Math.sin(ang * 5 + ph) * 0.55 + Math.sin(ang * 9 + ph2) * 0.45);
            const d = Math.hypot(uu, w) / shape;
            const i = ((oy + y) * N + ox + x) * 4;
            if (d >= 1) { px[i + 3] = 0; continue; }
            const s = Math.max(0.16, Math.sqrt(1 - d * d));
            let nx = (cfg.k * uu) / s, ny = (cfg.k * w) / s, nz = 1;
            const len = Math.hypot(nx, ny, nz);
            nx /= len; ny /= len; nz /= len;
            px[i] = Math.round((nx * 0.5 + 0.5) * 255);
            px[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            px[i + 2] = Math.round(s * 255);
            // One pixel of coverage falloff, so edges are not stair-stepped.
            px[i + 3] = Math.round(255 * clamp((1 - d) * (T * 0.5), 0, 1));
          }
        }
      }
      c.putImageData(img, 0, 0);
      return cv;
    }

    // Shared by both pane shaders: the world outside, far and near layers
    // sliding past at their own rates, wrapped in a single tileable period.
    const GLSL_SCENE = [
      "uniform sampler2D uFar; uniform sampler2D uNear;",
      "uniform sampler2D uFarBlur; uniform sampler2D uNearBlur;",
      "uniform vec2 uScroll;",
      "vec3 sceneAt(vec2 uv) {",
      "  float y = clamp(uv.y, 0.002, 0.998);",
      "  vec3 f = texture2D(uFar, vec2(fract(uv.x + uScroll.x), y)).rgb;",
      "  vec4 n = texture2D(uNear, vec2(fract(uv.x + uScroll.y), y));",
      "  return mix(f, n.rgb, n.a);",
      "}",
      "vec3 sceneSoft(vec2 uv) {",
      "  float y = clamp(uv.y, 0.002, 0.998);",
      "  vec3 f = texture2D(uFarBlur, vec2(fract(uv.x + uScroll.x), y)).rgb;",
      "  vec4 n = texture2D(uNearBlur, vec2(fract(uv.x + uScroll.y), y));",
      "  return mix(f, n.rgb, n.a);",
      "}"
    ].join("\n");

    const PANE_VERT = [
      "precision highp float;",
      "uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;",
      "attribute vec2 aQuad;",
      "uniform vec2 uPane;",
      "varying vec2 vUv;",
      "void main() {",
      "  vUv = aQuad * 0.5 + 0.5;",
      "  vUv.y = 1.0 - vUv.y;",
      "  gl_Position = projectionMatrix * modelViewMatrix *",
      "                vec4(aQuad * uPane * 0.5, 0.0, 1.0);",
      "}"
    ].join("\n");

    // The glass itself. Never perfectly sharp — you are focused on the pane,
    // not on the street — and where condensation sits it is blurrier and
    // lighter still. A track a runner has cleared shows through noticeably
    // crisper, which is most of why a trail reads as *cleared glass*.
    const PANE_FRAG = [
      "precision highp float;",
      GLSL_SCENE,
      "uniform sampler2D uMist;",
      "uniform float uFog;",
      "varying vec2 vUv;",
      "void main() {",
      "  float m = texture2D(uMist, vUv).a * uFog;",
      "  vec3 col = mix(sceneAt(vUv), sceneSoft(vUv), clamp(0.56 + 0.44 * m, 0.0, 1.0));",
      "  col += vec3(0.055, 0.068, 0.086) * m;",
      "  col = col * 0.95 + vec3(0.018, 0.024, 0.038);",
"  gl_FragColor = vec4(col, 1.0);",
      "}"
    ].join("\n");

    const DROP_VERT = [
      "precision highp float;",
      "uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;",
      "attribute vec2 aQuad;",
      "attribute vec2 iPos;",     // centre, pane uv
      "attribute vec2 iSize;",    // half extent, pane-local units
      "attribute float iRot;",
      "attribute float iVar;",
      "attribute vec4 iTint;",
      "uniform vec2 uPane;",
      "varying vec2 vLocal; varying vec2 vUv; varying vec4 vTint;",
      "varying vec2 vAtlas; varying vec2 vRot; varying float vRad;",
      "void main() {",
      "  float ca = cos(iRot), sa = sin(iRot);",
      "  vec2 q = aQuad * iSize;",
      "  vec2 r = vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca);",
      "  vec2 centre = vec2((iPos.x - 0.5) * uPane.x, (0.5 - iPos.y) * uPane.y);",
      "  vec2 local = centre + r;",
      "  vLocal = aQuad;",
      "  vUv = vec2(local.x / uPane.x + 0.5, 0.5 - local.y / uPane.y);",
      "  vTint = iTint;",
      "  vAtlas = vec2(mod(iVar, 2.0), floor(iVar * 0.5));",
      "  vRot = vec2(ca, sa);",
      "  vRad = iSize.x / uPane.x;",
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.001, 1.0);",
      "}"
    ].join("\n");

    // One droplet. Everything here is doing one job: convince you that light
    // went through water on its way to your eye.
    const DROP_FRAG = [
      "precision highp float;",
      GLSL_SCENE,
      "uniform sampler2D uDrop;",
      "uniform float uRefract;",
      "varying vec2 vLocal; varying vec2 vUv; varying vec4 vTint;",
      "varying vec2 vAtlas; varying vec2 vRot; varying float vRad;",
      "void main() {",
      "  vec2 t = clamp(vLocal * 0.5 + 0.5, 0.006, 0.994) * 0.5 + vAtlas * 0.5;",
      "  vec4 nm = texture2D(uDrop, t);",
      "  if (nm.a < 0.02) discard;",
      "  vec3 N = normalize(vec3(nm.rg * 2.0 - 1.0, max(nm.b, 0.02)));",
      "  vec2 nr = vec2(N.x * vRot.x - N.y * vRot.y, N.x * vRot.y + N.y * vRot.x);",
      // Sampling *against* the surface normal is the whole trick: it pulls in
      // the far side of what is behind the drop, so the image inside arrives
      // inverted and magnified the way a real bead of water delivers it.
      "  vec2 off = -nr * uRefract * vRad;",
      "  vec3 col = sceneAt(vUv + off);",
      "  col *= 1.18;",
      // Light that hits the rim at a grazing angle never gets through.
      "  float d = length(vLocal);",
      "  col *= mix(1.0, 0.22, smoothstep(0.55, 1.0, d));",
      // A bright, tight caustic where the dome faces the sky, and a second
      // softer one low down where the road throws light back up.
      "  vec3 H1 = normalize(vec3(-0.34, 0.62, 0.71));",
      "  vec3 H2 = normalize(vec3(0.22, -0.55, 0.8));",
      "  col += vec3(1.0, 0.99, 0.96) * pow(max(dot(N, H1), 0.0), 68.0) * 1.15;",
      "  col += vec3(1.0, 0.86, 0.7) * pow(max(dot(N, H2), 0.0), 34.0) * 0.3;",
      // A backed drop is lit differently rather than ringed: the light coming
      // through it takes a colour, so you find it the way you would find a
      // drop with a streetlight behind it.
      "  float lum = dot(col, vec3(0.34));",
"  col = mix(col, vTint.rgb * (0.22 + lum * 2.0), vTint.a * 0.72);",
"  col += vTint.rgb * vTint.a * 0.3;",
      "  gl_FragColor = vec4(col, nm.a);",
      "}"
    ].join("\n");

    let paneMesh = null, dropMesh = null, dropGeo = null;
    let iPos = null, iSize = null, iRot = null, iVar = null, iTint = null;
    let mistGLTex = null, mistDirty = true;
    const sceneUniforms = {};

    function makeStripTexture(cv, wrap) {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }

    function buildPaneGL(paneW, paneH) {
      dropAtlas = bakeDropAtlas();
      if (!dropAtlas || !stripFar) return null;

      const atlasTex = new THREE.CanvasTexture(dropAtlas);
      atlasTex.colorSpace = THREE.NoColorSpace;   // it is geometry, not colour
      atlasTex.minFilter = THREE.LinearFilter;
      atlasTex.magFilter = THREE.LinearFilter;
      atlasTex.generateMipmaps = false;

      mistGLTex = new THREE.CanvasTexture(mistTex);
      mistGLTex.colorSpace = THREE.NoColorSpace;
      mistGLTex.minFilter = THREE.LinearFilter;
      mistGLTex.generateMipmaps = false;

      sceneUniforms.uFar = { value: makeStripTexture(stripFar) };
      sceneUniforms.uNear = { value: makeStripTexture(stripNear) };
      sceneUniforms.uFarBlur = { value: makeStripTexture(blurFar) };
      sceneUniforms.uNearBlur = { value: makeStripTexture(blurNear) };
      sceneUniforms.uScroll = { value: new THREE.Vector2(0, 0) };
      const uPane = { value: new THREE.Vector2(paneW, paneH) };

      const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
      const idx = [0, 1, 2, 0, 2, 3];

      const pg = new THREE.BufferGeometry();
      pg.setAttribute("aQuad", new THREE.BufferAttribute(quad, 2));
      pg.setIndex(idx);
      paneMesh = new THREE.Mesh(pg, new THREE.RawShaderMaterial({
        vertexShader: PANE_VERT,
        fragmentShader: PANE_FRAG,
        uniforms: Object.assign({}, sceneUniforms, {
          uPane: uPane, uMist: { value: mistGLTex }, uFog: { value: 2.1 }
        })
      }));

      dropGeo = new THREE.InstancedBufferGeometry();
      dropGeo.setAttribute("aQuad", new THREE.BufferAttribute(quad, 2));
      dropGeo.setIndex(idx);
      iPos = new THREE.InstancedBufferAttribute(new Float32Array(DROP_CAP * 2), 2);
      iSize = new THREE.InstancedBufferAttribute(new Float32Array(DROP_CAP * 2), 2);
      iRot = new THREE.InstancedBufferAttribute(new Float32Array(DROP_CAP), 1);
      iVar = new THREE.InstancedBufferAttribute(new Float32Array(DROP_CAP), 1);
      iTint = new THREE.InstancedBufferAttribute(new Float32Array(DROP_CAP * 4), 4);
      for (const a of [iPos, iSize, iRot, iVar, iTint]) a.setUsage(THREE.DynamicDrawUsage);
      dropGeo.setAttribute("iPos", iPos);
      dropGeo.setAttribute("iSize", iSize);
      dropGeo.setAttribute("iRot", iRot);
      dropGeo.setAttribute("iVar", iVar);
      dropGeo.setAttribute("iTint", iTint);
      dropGeo.instanceCount = 0;

      dropMesh = new THREE.Mesh(dropGeo, new THREE.RawShaderMaterial({
        vertexShader: DROP_VERT,
        fragmentShader: DROP_FRAG,
        uniforms: Object.assign({}, sceneUniforms, {
          uPane: uPane, uDrop: { value: atlasTex }, uRefract: { value: 1.35 }
        }),
        transparent: true,
        depthWrite: false
      }));
      dropMesh.renderOrder = 2;
      paneMesh.renderOrder = 1;
      // Geometry built from a custom attribute has no bounding sphere for
      // three to test, so both would be culled the moment they were added.
      dropMesh.frustumCulled = false;
      paneMesh.frustumCulled = false;

      const group = new THREE.Group();
      group.add(paneMesh);
      group.add(dropMesh);
      return group;
    }

    // Pack the live drops into the instance buffers. Sorted small-first so the
    // big ones land on top, which is also the order they overlap in reality.
    const packOrder = [];
    function updateDropInstances() {
      if (!dropGeo) return;
      const pw = G.w, ph = G.h;
      const toLocal = paneMeshW / pw;
      packOrder.length = 0;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.life > 0) packOrder.push(d);
      }
      packOrder.sort((a, b) => a.r - b.r);
      const n = Math.min(packOrder.length, DROP_CAP);
      const P = iPos.array, S = iSize.array, R = iRot.array, V = iVar.array, T = iTint.array;
      for (let i = 0; i < n; i++) {
        const d = packOrder[i];
        P[i * 2] = d.x / pw;
        P[i * 2 + 1] = d.y / ph;

        const sp = d.run ? Math.hypot(d.vx, d.vy) : 0;
        // A running drop stretches along its path and thins across it.
        const stretch = d.run ? 1 + Math.min(0.8, sp * 0.0032 / SZ.s) : 1;
        const rad = d.r * toLocal;
        S[i * 2] = rad * d.aspect * (1 - 0.16 * (stretch - 1));
        S[i * 2 + 1] = (rad / d.aspect) * stretch;
        R[i] = d.run && sp > 12 * SZ.s ? Math.atan2(d.vy, -d.vx) - Math.PI / 2 : 0;
        V[i] = d.run && sp > 26 * SZ.s ? 3 : d.vari;

        if (d.racer !== null) {
          const t = RACER_TINTS[d.racer];
          const mine = race.pick === d.racer;
          const pulse = race.state === "betting"
            ? 0.62 + 0.38 * Math.sin(nowMs / 300 + d.wob) : 1;
          T[i * 4] = t.rgb[0] / 255;
          T[i * 4 + 1] = t.rgb[1] / 255;
          T[i * 4 + 2] = t.rgb[2] / 255;
          T[i * 4 + 3] = (mine ? 0.92 : 0.55) * pulse + feedFlash * 0.15;
        } else {
          T[i * 4 + 3] = 0;
        }
      }
      dropGeo.instanceCount = n;
      iPos.needsUpdate = iSize.needsUpdate = iRot.needsUpdate = true;
      iVar.needsUpdate = iTint.needsUpdate = true;
    }

    /* ---------------------------------------------------------------- *
     * Cabin view
     *
     * The back of the car, built from boxes and lit almost entirely by what
     * is happening outside the window. Night interiors are forgiving: what
     * you read is silhouette and rim light, so plain geometry in the right
     * darkness sells it far better than detail would.
     *
     * Metres, eye at the origin. Car forward is -Z, the window is on -X.
     * ---------------------------------------------------------------- */

    // Real proportions matter more than they look like they should. Eye height
    // above the cushion is what tells you whether you are sitting in a car or
    // kneeling on the floor of one, and the sill has to sit about a forearm
    // above the seat or the whole cabin reads as a toy.
    // A room, not a car. The pane keeps its place and its aspect so none of
    // the glass code cares, and everything else is built around it.
    const CAB = {
      glassX: -0.75,                 // window plane
      winZ: 0.46, winTop: 0.40, winBot: -0.24,
      wallX: -0.8,                   // the wall the window is in
      backX: 2.7,                    // the far wall, behind you
      floorY: -1.12, roofY: 1.05,
      seatY: -0.62,                  // top of the window seat you are on
      frontZ: -2.0, backZ: 2.0,
      // Far enough back that the pane's full width fits the narrow horizontal
      // field a portrait screen gives you, and at the height of someone
      // sitting on the seat rather than a camera on a tripod.
      eye: [0.17, 0.05, 0.02]
    };

    let THREE = null, renderer = null, scene = null, camera = null;
    let glassMesh = null, raycaster = null, ndc = null;
    let paneMeshW = 1;
    let sweepLight = null;
    // Three's camera looks down -Z; the window is on -X. Turning +90 degrees
    // about Y maps forward onto -X, so that is where a head starts.
    const YAW0 = Math.PI / 2;
    const YAW_RANGE = 2.5;
    let yaw = YAW0, pitch = 0, yawTarget = YAW0, pitchTarget = 0;
    let texClock = 0;

    async function loadThree() {
      const NAME = "three", VER = "0.164.1";
      const URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
      let m = null;
      try {
        m = await ctx.importModule(NAME, VER);
      } catch (_) {
        try { m = await ctx.importModule(URL); } catch (_2) { return null; }
      }
      if (m && !m.WebGLRenderer && m.default) m = m.default;
      return m && m.WebGLRenderer ? m : null;
    }

    // Big untextured slabs are what make procedural interiors read as a
    // mockup. One tileable grain, reused at different repeats, is enough to
    // break that up — at this light level nobody is reading the pattern, only
    // noticing that the surface is not perfectly flat.
    let grainTex = null;
    function grainTexture() {
      if (grainTex) return grainTex;
      const n = 128;
      const cv = makeSurface(n, n);
      if (!cv) return null;
      const c = cv.getContext("2d");
      c.fillStyle = "#969696";
      c.fillRect(0, 0, n, n);
      for (let i = 0; i < 5200; i++) {
        const v = 150 + (rnd() * 2 - 1) * 30;
        c.fillStyle = "rgb(" + (v | 0) + "," + (v | 0) + "," + (v | 0) + ")";
        c.fillRect(rr(0, n), rr(0, n), rr(0.6, 2.2), rr(0.6, 2.2));
      }
      // A faint weave so fabric does not look like sandpaper.
      c.globalAlpha = 0.16;
      for (let y = 0; y < n; y += 3) {
        c.fillStyle = y % 6 ? "#7c7c7c" : "#b0b0b0";
        c.fillRect(0, y, n, 1.4);
      }
      c.globalAlpha = 1;
      grainTex = new THREE.CanvasTexture(cv);
      grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
      return grainTex;
    }

    function mat(color, rough, grain, rx, ry) {
      const o = {
        color: new THREE.Color(color),
        roughness: rough === undefined ? 0.92 : rough,
        metalness: 0
      };
      const m = new THREE.MeshStandardMaterial(o);
      if (grain) {
        // Clone so each surface can carry its own repeat without disturbing
        // the shared bake.
        const t = grain.clone();
        t.needsUpdate = true;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rx || 3, ry || 3);
        // As a colour map as well as a bump map: at this light level a bump
        // map alone is invisible, and the big door and seat panels read as
        // flat voids without something varying across them.
        m.map = t;
        m.bumpMap = t;
        m.bumpScale = 0.006;
      }
      return m;
    }

    // Nothing in a car is a sharp-edged box. Seats, armrests and headrests are
    // all soft forms, and a bevelled edge is what catches the light coming off
    // the window — which is most of what tells you the shape is upholstered
    // rather than folded out of cardboard. Extruded rounded rectangles are
    // cheap enough to use for every form you actually look at.
    function roundedShape(a, b, r) {
      const sh = new THREE.Shape();
      const x = -a / 2, y = -b / 2;
      sh.moveTo(x + r, y);
      sh.lineTo(x + a - r, y);
      sh.quadraticCurveTo(x + a, y, x + a, y + r);
      sh.lineTo(x + a, y + b - r);
      sh.quadraticCurveTo(x + a, y + b, x + a - r, y + b);
      sh.lineTo(x + r, y + b);
      sh.quadraticCurveTo(x, y + b, x, y + b - r);
      sh.lineTo(x, y + r);
      sh.quadraticCurveTo(x, y, x + r, y);
      return sh;
    }

    // `axis` is the one the form is extruded along — pick the shortest, so the
    // rounding lands on the faces you can actually see.
    function soft(x0, y0, z0, x1, y1, z1, r, material, axis) {
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
      axis = axis || "z";
      const a = axis === "x" ? d : w;
      const b = axis === "y" ? d : h;
      const D = axis === "x" ? w : axis === "y" ? h : d;
      const rad = Math.max(0.004, Math.min(r, a / 2 - 0.004, b / 2 - 0.004));
      const bev = Math.max(0.002, Math.min(rad * 0.7, D / 2 - 0.003));
      const geo = new THREE.ExtrudeGeometry(roundedShape(a, b, rad), {
        depth: Math.max(0.003, D - bev * 2),
        bevelEnabled: true, bevelThickness: bev, bevelSize: bev,
        bevelSegments: 2, curveSegments: 5
      });
      geo.translate(0, 0, -(D - bev * 2) / 2);
      if (axis === "y") geo.rotateX(-Math.PI / 2);
      else if (axis === "x") geo.rotateY(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      scene.add(mesh);
      return mesh;
    }

    // Axis-aligned slab from two corners. Everything flat in the cabin is one.
    function slab(x0, y0, z0, x1, y1, z1, material) {
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      scene.add(mesh);
      return mesh;
    }

    // Chasing individual point lights around a cabin is a losing game: put one
    // close enough to matter and it blows out whatever it is next to, put it
    // far enough not to and half the interior goes black. An environment map
    // solves it in one go — every surface gets a contribution based on which
    // way it faces, which is exactly the "dark cabin, bright window on one
    // side" situation this is. Three samples equirect as
    // u = atan2(z, x)/2pi + 0.5, so the window on -X lands at u = 0 and has to
    // be painted at both edges of the canvas.
    function buildEnvironment() {
      const w = 256, h = 128;
      const cv = makeSurface(w, h);
      if (!cv) return null;
      const c = cv.getContext("2d");
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#3a3129");        // warm ceiling bounce
      g.addColorStop(0.5, "#2a221c");
      g.addColorStop(1, "#171210");        // floorboards, underfoot
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);

      const band = (cx, r, inner, mid) => {
        for (const ox of [-w, 0, w]) {
          const gr = c.createRadialGradient(cx + ox, h * 0.46, 1, cx + ox, h * 0.46, r);
          gr.addColorStop(0, inner);
          gr.addColorStop(0.45, mid);
          gr.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = gr;
          c.fillRect(0, 0, w, h);
        }
      };
      band(0, w * 0.3, "#9fb8d8", "#41536b");         // the cold window
      band(w * 0.46, w * 0.26, "#c9955c", "#5c4330");  // the lamp, warm
      band(w * 0.8, w * 0.2, "#a9773f", "#453022");    // candle and string lights

      const t = new THREE.CanvasTexture(cv);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }

    function buildCabin() {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x03050a);
      // A raw equirect assigned straight to scene.environment is sampled at
      // mip 0 whatever the roughness, so matte cloth comes out wrong and dark.
      // PMREM pre-filters it per roughness, which is the whole point.
      const envSrc = buildEnvironment();
      if (envSrc) {
        try {
          const pmrem = new THREE.PMREMGenerator(renderer);
          pmrem.compileEquirectangularShader();
          scene.environment = pmrem.fromEquirectangular(envSrc).texture;
          scene.environmentIntensity = 1.25;
          pmrem.dispose();
          envSrc.dispose();
        } catch (_) {
          scene.environment = envSrc;
          scene.environmentIntensity = 1.25;
        }
      }

      const C = CAB;
      const grain = grainTexture();
      const wall = mat("#584f45", 1, grain, 6, 6);          // warm plaster
      const wood = mat("#6d4c33", 0.72, grain, 4, 4);       // sill, shelves
      const woodDark = mat("#4a3423", 0.7, grain, 3, 3);
      const cloth = mat("#8e7c67", 1, grain, 7, 5);         // cushions
      const cream = mat("#b0a08b", 1, grain, 6, 6);         // curtains
      const rugMat = mat("#7d5546", 1, grain, 9, 6);
      const metal = mat("#5c5349", 0.42, null, 1, 1);
      const ceramic = mat("#9c968a", 0.45, null, 1, 1);
      const leaf = mat("#3d5730", 0.9, null, 1, 1);
      const floorMat = mat("#54402d", 0.62, grain, 14, 10);

      function cyl(x, y, z, rt, rb, h, material, rx) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 14), material);
        m.position.set(x, y, z);
        if (rx) m.rotation.x = rx;
        scene.add(m);
        return m;
      }
      function ball(x, y, z, r, material) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), material);
        m.position.set(x, y, z);
        scene.add(m);
        return m;
      }
      function glow(color, intensity) {
        return new THREE.MeshStandardMaterial({
          color: new THREE.Color(color), emissive: new THREE.Color(color),
          emissiveIntensity: intensity, roughness: 0.5
        });
      }

      // ---- shell -------------------------------------------------------
      slab(C.wallX - 0.14, C.floorY, C.frontZ, C.wallX, C.roofY, C.backZ, wall);   // window wall
      slab(C.backX, C.floorY, C.frontZ, C.backX + 0.14, C.roofY, C.backZ, wall);
      slab(C.wallX, C.floorY, C.frontZ - 0.14, C.backX, C.roofY, C.frontZ, wall);
      slab(C.wallX, C.floorY, C.backZ, C.backX, C.roofY, C.backZ + 0.14, wall);
      slab(C.wallX, C.floorY - 0.12, C.frontZ, C.backX, C.floorY, C.backZ, floorMat);
      slab(C.wallX, C.roofY, C.frontZ, C.backX, C.roofY + 0.12, C.backZ,
           mat("#635a4e", 1, grain, 8, 8));

      // ---- the window: a recess in a thick wall, with a deep sill ------
      const rIn = C.wallX - 0.14, rOut = C.wallX + 0.05;
      slab(rIn, C.winTop, -C.winZ - 0.09, rOut, C.winTop + 0.09, C.winZ + 0.09, wood);
      slab(rIn, C.winBot - 0.05, -C.winZ - 0.09, rOut, C.winBot, C.winZ + 0.09, wood);
      slab(rIn, C.winBot, -C.winZ - 0.09, rOut, C.winTop, -C.winZ, wood);
      slab(rIn, C.winBot, C.winZ, rOut, C.winTop, C.winZ + 0.09, wood);
      // The sill you can put things on.
      soft(rOut - 0.02, C.winBot - 0.06, -C.winZ - 0.12, rOut + 0.22, C.winBot,
           C.winZ + 0.12, 0.018, wood, "y");

      // ---- the pane ----------------------------------------------------
      paneMeshW = C.winZ * 2;
      const paneGroup = buildPaneGL(paneMeshW, C.winTop - C.winBot);
      if (!paneGroup) return false;
      paneGroup.position.set(C.glassX, (C.winTop + C.winBot) / 2, 0);
      paneGroup.rotation.y = Math.PI / 2;
      scene.add(paneGroup);
      glassMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(paneMeshW, C.winTop - C.winBot),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      glassMesh.position.copy(paneGroup.position);
      glassMesh.rotation.y = Math.PI / 2;
      scene.add(glassMesh);

      // ---- curtains ----------------------------------------------------
      // Folds are the whole trick: one flat panel reads as card, six narrow
      // rounded ones side by side read as cloth hanging.
      cyl(C.wallX + 0.16, C.winTop + 0.2, 0, 0.014, 0.014, C.winZ * 2 + 0.5, metal,
          Math.PI / 2);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const z = side * (C.winZ + 0.04 + i * 0.062);
          const d = 0.05 + (i % 2) * 0.03;
          soft(C.wallX + 0.1, C.floorY + 0.12, z - 0.032, C.wallX + 0.1 + d,
               C.winTop + 0.17, z + 0.032, 0.028, i % 2 ? cream : cloth, "z");
        }
      }

      // ---- string lights along the top of the window -------------------
      const bulbMat = glow("#ffcf92", 1.5);
      for (let i = 0; i < 15; i++) {
        const t = i / 14;
        const z = (t - 0.5) * (C.winZ * 2 + 0.2);
        const sag = Math.sin(t * Math.PI) * 0.05;
        ball(C.wallX + 0.09, C.winTop + 0.11 - sag, z, 0.0055, bulbMat);
      }
      for (const z of [-0.34, 0, 0.34]) {
        const b = new THREE.PointLight(0xffbe78, 0.16, 1.1, 2);
        b.position.set(C.wallX + 0.16, C.winTop + 0.1, z);
        scene.add(b);
      }

      // ---- window seat you are sitting on ------------------------------
      soft(C.wallX + 0.06, C.seatY - 0.3, -0.78, 0.5, C.seatY, 0.78, 0.06, cloth, "y");
      for (const z of [-0.46, 0.02, 0.5]) {
        soft(C.wallX + 0.08, C.seatY, z - 0.2, C.wallX + 0.28, C.seatY + 0.2, z + 0.2,
             0.06, cloth, "z");
      }

      // ---- things on the sill ------------------------------------------
      cyl(rOut + 0.09, C.winBot + 0.045, -0.26, 0.042, 0.038, 0.09, ceramic);
      cyl(rOut + 0.09, C.winBot + 0.075, 0.22, 0.05, 0.04, 0.06, mat("#8a6a4a", 0.7));
      for (let i = 0; i < 9; i++) {
        ball(rOut + 0.09 + rr(-0.05, 0.05), C.winBot + 0.115 + rr(0, 0.075),
             0.22 + rr(-0.05, 0.05), rr(0.012, 0.024), leaf);
      }
      cyl(rOut + 0.1, C.winBot + 0.05, 0.44, 0.026, 0.026, 0.1, mat("#d8cbb4", 0.5));
      ball(rOut + 0.1, C.winBot + 0.105, 0.44, 0.011, glow("#ffb765", 1.8));
      const flame = new THREE.PointLight(0xffa356, 0.35, 0.9, 2);
      flame.position.set(rOut + 0.1, C.winBot + 0.13, 0.44);
      scene.add(flame);

      // ---- bookshelf on one side --------------------------------------
      const BZ = C.backZ - 0.2;
      const BOOK = ["#8c4a3a", "#3f5a6b", "#7a6a3c", "#5c4470", "#3f6b52",
                    "#96603a", "#4a4f6b", "#7d3f4c"];
      slab(0.25, C.floorY, BZ, 1.75, C.floorY + 1.15, BZ + 0.24, woodDark);
      for (let sh = 0; sh < 3; sh++) {
        const y = C.floorY + 0.1 + sh * 0.36;
        slab(0.27, y, BZ + 0.01, 1.73, y + 0.03, BZ + 0.23, wood);
        let bx = 0.32;
        while (bx < 1.66) {
          const bw = rr(0.022, 0.05), bh = rr(0.17, 0.29);
          slab(bx, y + 0.03, BZ + 0.04, bx + bw, y + 0.03 + bh, BZ + 0.2,
               mat(BOOK[ri(0, BOOK.length - 1)], 0.85, grain, 1, 2));
          bx += bw + rr(0.002, 0.012);
        }
      }

      // ---- desk and lamp on the other side ----------------------------
      const DZ = C.frontZ + 0.22;
      soft(0.3, C.floorY + 0.66, DZ, 1.6, C.floorY + 0.71, DZ + 0.5, 0.012, wood, "y");
      for (const lx of [0.36, 1.5]) {
        for (const lz of [DZ + 0.05, DZ + 0.44]) {
          slab(lx - 0.02, C.floorY, lz - 0.02, lx + 0.02, C.floorY + 0.66, lz + 0.02, woodDark);
        }
      }
      cyl(0.55, C.floorY + 0.74, DZ + 0.24, 0.05, 0.07, 0.06, metal);
      cyl(0.55, C.floorY + 0.87, DZ + 0.24, 0.012, 0.012, 0.22, metal);
      cyl(0.55, C.floorY + 1.02, DZ + 0.24, 0.07, 0.11, 0.13, glow("#e8bb84", 0.75));
      const lamp2 = new THREE.PointLight(0xffb06a, 1.5, 3.0, 2);
      lamp2.position.set(0.55, C.floorY + 0.99, DZ + 0.24);
      scene.add(lamp2);
      // A couple of books left open on the desk.
      slab(1.0, C.floorY + 0.71, DZ + 0.14, 1.24, C.floorY + 0.74, DZ + 0.34,
           mat("#8c4a3a", 0.85));
      slab(1.02, C.floorY + 0.74, DZ + 0.16, 1.22, C.floorY + 0.762, DZ + 0.32,
           mat("#cfc4ad", 0.9));

      // ---- rug and pictures -------------------------------------------
      soft(0.1, C.floorY, -0.9, 1.9, C.floorY + 0.012, 0.9, 0.06, rugMat, "y");
      for (const pz of [-0.55, 0.05, 0.62]) {
        const ph = rr(0.2, 0.34), pw = rr(0.16, 0.26);
        slab(C.backX - 0.03, 0.1, pz - pw / 2, C.backX - 0.01, 0.1 + ph, pz + pw / 2, wood);
        slab(C.backX - 0.035, 0.12, pz - pw / 2 + 0.02, C.backX - 0.031, 0.08 + ph,
             pz + pw / 2 - 0.02, mat("#9aa3ab", 0.8));
      }

      // The room is lit warm from inside and cold from the window, and the
      // env map carries most of it. These are the two sources you can point at.
      scene.add(new THREE.HemisphereLight(0x4a3c30, 0x140f0c, 0.35));
      for (const lz of [-0.32, 0.3]) {
        const wl = new THREE.PointLight(0xaac6ee, 1.5, 4.5, 2);
        wl.position.set(C.glassX - 1.5, C.winBot + 0.55, lz * 2.2);
        scene.add(wl);
      }
      // Headlights of something going past outside, thrown across the ceiling.
      sweepLight = new THREE.PointLight(0xffc48a, 0, 9, 2);
      sweepLight.position.set(C.glassX - 2.2, 0.55, 0);
      scene.add(sweepLight);
      // Bounce off the floorboards, so the room is not lit only from above.
      const bounce = new THREE.PointLight(0xc98a4e, 0.7, 3.4, 2);
      bounce.position.set(1.0, C.floorY + 0.35, 0.1);
      scene.add(bounce);

      camera = new THREE.PerspectiveCamera(68, ctx.width / ctx.height, 0.02, 40);
      camera.position.set(C.eye[0], C.eye[1], C.eye[2]);
      camera.rotation.order = "YXZ";
      camera.rotation.y = YAW0;

      raycaster = new THREE.Raycaster();
      ndc = new THREE.Vector2();
      return true;
    }

    async function tryCabin() {
      if (!CAN_BAKE) return false;        // the pane has to become a texture
      const T = await loadThree();
      if (!T) return false;
      THREE = T;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: view3d, antialias: true, alpha: false });
      } catch (_) {
        return false;
      }
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
      renderer.setSize(ctx.width, ctx.height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // The pane is a RawShaderMaterial, so it bypasses three's tone-mapping
      // and output-encoding includes entirely and writes straight to the
      // framebuffer. Leaving ACES on for everything else meant the cabin was
      // being crushed while the glass beside it was not, which is why the two
      // never looked like they belonged in the same scene.
      renderer.toneMapping = THREE.NoToneMapping;

      // Rebuild the pane at the window's aspect before anything references it.
      paneIsGL = true;
      setupGlass(PANE_3D.w, PANE_3D.h, 1, false);
      if (!buildCabin()) { paneIsGL = false; return false; }

      ctx.onDestroy(() => {
        try { renderer.dispose(); } catch (_) {}
      });
      return true;
    }

    // Where the visible lamps are, in cabin Z, so the interior light matches
    // what is sliding past the pane.
    function stepCabinLight() {
      if (!sweepLight) return;
      let best = 0, bestZ = 0;
      for (let i = 0; i < nearLamps.length; i++) {
        // Lamp u drifts with the near strip; 0..1 across the pane.
        let u = nearLamps[i].u - scrollNear / G.w;
        u = ((u % 1) + 1) % 1;
        // Brightest when the lamp is square-on to the window.
        const w = Math.max(0, 1 - Math.abs(u - 0.5) * 2.4) * nearLamps[i].a;
        if (w > best) { best = w; bestZ = (u - 0.5) * 5.5; }
      }
      sweepLight.intensity = best * 5;
      sweepLight.position.z = bestZ;
    }

    function renderCabin(dt) {
      // Drops go straight into instance buffers, so there is no canvas repaint
      // and no full-pane upload. The condensation layer is the only thing that
      // still has to be pushed to the GPU, and only when a runner has cut it.
      updateDropInstances();
      sceneUniforms.uScroll.value.set(
        (scrollFar - worldOffX) / G.w, (scrollNear - worldOffX * 1.35) / G.w
      );
      texClock += dt;
      if (mistGLTex && mistDirty && texClock > (avgDt > 26 ? 0.1 : 0.05)) {
        texClock = 0;
        mistDirty = false;
        mistGLTex.needsUpdate = true;
      }
      stepCabinLight();
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      renderer.render(scene, camera);
    }

    /* ---------------------------------------------------------------- *
     * Audio
     *
     * Three things have to be true at once or it is not rain.
     *
     * It is dark. Rain heard from inside is a wall, a shut window and a couple
     * of metres of air away, and every one of those takes the top off it. The
     * energy lives under about 1.5 kHz. Anything crisp enough to be described
     * as a click is already wrong, and a dense field of small bright ticks is
     * the sound of frying, not of weather.
     *
     * Water does not ring. It splats — the impact spreads and slows within a
     * millisecond or two, so the top end leaves first. Every impact here is
     * noise poured into a gentle lowpass whose cutoff falls as the sound dies,
     * and nothing has a Q high enough to hold a pitch. The one exception is the
     * drip, which is genuinely pitched, and is rare for that reason: a field of
     * pitched drips is a cave.
     *
     * It breathes. Rain does not fall at a constant rate and a bed that does
     * sounds like a machine, so the loops carry their own swells and lulls, and
     * the gusts on screen move the level, the roll-off and the rate of impacts
     * together.
     *
     * Thousands of live nodes a second is not possible, so the dense layers are
     * baked once into looping buffers: a palette of grains synthesised
     * properly, then stamped at random offsets, anything overhanging the end
     * wrapping to the front so the loop is seamless by construction rather than
     * by crossfade. The two loops are deliberately mismatched lengths so their
     * combination does not repeat on any period you could sit through. Only the
     * near taps and the drips are live, because they are the few a second you
     * can actually pick out individually.
     * ---------------------------------------------------------------- */

    // The mix, in one place. Every one of these was arrived at by recording the
    // output and measuring it, so they are worth keeping where they can be
    // compared against each other rather than scattered through the graph.
    const RAIN = {
      farRate: 900,                    // grains a second per channel, far wash
      farRms: 0.19, farGain: 0.68, farGust: 0.22,
      farLP: 1250, farLPGust: 700,
      midRate: 30, midRms: 0.1, midGain: 0.42, midGust: 0.2, midLP: 2600,
      tapBus: 0.3, tapLP: 2600,        // a pane in a frame is a damped thing
      tapRate: 4, tapRateGust: 7,
      hiss: 0.03, spray: 0.022, rumble: 0.028
    };

    let ac = null, master = null, noiseBuf = null, audioDead = false;
    let rainGain = null, windGain = null, windFilter = null;
    let musicHandle = null;
    let soundOn = true;
    let voices = 0;

    let rumbleGain = null, rainLP = null, midGain = null, tapBus = null;
    let tapBufs = null, dripBufs = null;

    // One droplet impact. `size` 0 is fine spray, 1 is a fat drop; `bright`
    // shifts the whole thing up or down the spectrum, which is how distance
    // gets spelled.
    //
    // The excitation is noise under an envelope rather than a burst followed by
    // silence: a burst into a filter is a click, and rain contains no clicks.
    function renderGrain(sr, size, bright, cut) {
      const f0 = lerp(2900, 760, size) * bright;   // cutoff at the moment of impact
      const f1 = lerp(560, 150, size) * bright;    // and where it has fallen to
      const tau = lerp(0.0045, 0.034, size);
      const len = Math.max(24, Math.min(Math.ceil(tau * (cut || 5) * sr), (sr * 0.4) | 0));
      const out = new Float32Array(len);
      const top = sr * 0.42;
      const q = 1.25;                              // damped. A ring is a marimba.
      const dec = Math.exp(-1 / (tau * sr));
      // A drop lands fast but not instantly: it has to flatten before it is
      // loud. Starting at full amplitude on sample zero makes the onset a step,
      // and a step is broadband no matter how gently the noise inside it is
      // filtered — which is how a bed of soft splats ends up ticking.
      const atk = Math.max(3, Math.ceil(sr * 0.0006 * (0.5 + size)));
      let low = 0, band = 0, e = 1, peak = 1e-6;
      for (let i = 0; i < len; i++) {
        const f = 2 * Math.sin(Math.PI * Math.min(f1 + (f0 - f1) * e, top) / sr);
        const x = (Math.random() * 2 - 1) * e * e;
        const h = x - low - q * band;
        band += f * h; low += f * band;
        const s = i < atk ? low * (0.5 - 0.5 * Math.cos(Math.PI * i / atk)) : low;
        out[i] = s;
        const a = s < 0 ? -s : s;
        if (a > peak) peak = a;
        e *= dec;
      }
      const k = 1 / peak;
      for (let i = 0; i < len; i++) out[i] *= k;
      return out;
    }

    // A drip, off the eaves or off the sill. This one *is* pitched: a drop
    // falling into standing water traps a bubble, and the bubble's note climbs
    // as it collapses. It is the most recognisable water sound there is, which
    // is exactly why there are only about one every two seconds.
    function renderDrip(sr, size) {
      const f0 = lerp(1500, 430, size);
      const bend = 0.45 + Math.random() * 0.65;
      const tau = lerp(0.011, 0.030, size);
      const len = Math.ceil(tau * 5 * sr);
      const out = new Float32Array(len);
      const tw = 2 * Math.PI / sr;
      const dec = Math.exp(-1 / (tau * sr));
      const nz = Math.ceil(sr * 0.0015);
      const atk = Math.ceil(sr * 0.0005);
      let ph = 0, e = 1, peak = 1e-6;
      for (let i = 0; i < len; i++) {
        ph += tw * f0 * (1 + bend * (1 - e));
        let s = Math.sin(ph) * e;
        if (i < nz) s += (Math.random() * 2 - 1) * 0.3 * (1 - i / nz);
        if (i < atk) s *= 0.5 - 0.5 * Math.cos(Math.PI * i / atk);
        out[i] = s;
        const a = s < 0 ? -s : s;
        if (a > peak) peak = a;
        e *= dec;
      }
      const k = 1 / peak;
      for (let i = 0; i < len; i++) out[i] *= k;
      return out;
    }

    // A spread of impacts to stamp from. Sizes are squared across the palette
    // so the small end — which is most of real rain — gets most of the entries.
    function buildPalette(sr, count, bright, cut) {
      const pal = [];
      for (let i = 0; i < count; i++) {
        const size = Math.pow(i / (count - 1), 2);
        pal.push({ w: renderGrain(sr, size, bright, cut), g: lerp(0.2, 1, size) });
      }
      return pal;
    }

    // Stamp `perSec` grains a second into a looping buffer. `bias` above 1
    // pulls the size distribution small, below 1 pushes it large. Channels are
    // stamped independently, so a stereo bed is decorrelated and sounds like
    // weather around you rather than a mono source in front of you.
    function bakeBed(sr, seconds, channels, perSec, pal, bias, lo, hi, rms) {
      const n = Math.floor(sr * seconds);
      const buf = ac.createBuffer(channels, n, sr);
      const count = Math.round(seconds * perSec);

      // Where the grains land is decided by a slow curve rather than by a flat
      // random, so the loop arrives with swells and lulls already in it. Whole
      // numbers of cycles per loop, or the seam would be a step in the weather.
      const cyc = [], phs = [];
      for (const hz of [0.11, 0.29, 0.53]) {
        cyc.push(Math.max(1, Math.round(hz * seconds)));
        phs.push(Math.random() * 6.2832);
      }
      const dens = (u) => {
        let v = 0;
        for (let i = 0; i < cyc.length; i++) v += Math.sin(u * 6.2832 * cyc[i] + phs[i]);
        return 0.42 + 0.58 * (v / cyc.length * 0.5 + 0.5);
      };

      for (let c = 0; c < channels; c++) {
        const out = buf.getChannelData(c);
        for (let k = 0; k < count; k++) {
          let u = Math.random();
          for (let t = 0; t < 5 && Math.random() > dens(u); t++) u = Math.random();
          const p = pal[Math.min(pal.length - 1,
            Math.floor(Math.pow(Math.random(), bias) * pal.length))];
          const w = p.w;
          const amp = p.g * (lo + Math.random() * (hi - lo)) *
                      (Math.random() < 0.5 ? -1 : 1);
          const at = Math.floor(u * n);
          const head = Math.min(w.length, n - at);
          for (let i = 0; i < head; i++) out[at + i] += w[i] * amp;
          for (let i = head; i < w.length; i++) out[i - head] += w[i] * amp;
        }
      }

      // Levelled on energy, not on the single loudest sample. Peak-normalising
      // lets one lucky pile-up of grains decide the level of the whole loop,
      // and what comes out is quiet static with occasional clicks — which is
      // exactly what the previous version of this sounded like. A soft ceiling
      // takes the pile-ups instead, and adds a little density on the way.
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        const o = buf.getChannelData(c);
        for (let i = 0; i < n; i++) sum += o[i] * o[i];
      }
      const k = rms / Math.sqrt(sum / (n * channels) || 1);
      for (let c = 0; c < channels; c++) {
        const o = buf.getChannelData(c);
        for (let i = 0; i < n; i++) o[i] = Math.tanh(o[i] * k * 1.7) / 1.7;
      }
      return buf;
    }

    function loopSource(buf) {
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      return src;
    }

    // The finest spray never resolves into separate impacts at any distance, so
    // a little pink noise sits under the grains as a floor. Support, not the
    // sound — it was the whole sound once and that is what was wrong with it.
    function fillPink(data) {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < data.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.16;
        b6 = w * 0.115926;
      }
    }

    function fillBrown(data) {
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.2;
      }
    }

    function buildAudio() {
      if (ac || audioDead) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }

      master = ac.createGain();
      master.gain.value = soundOn ? 0.9 : 0;
      // Gentle and slow. A fast compressor pumps on every impact, and a bed
      // made of impacts would pump continuously.
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 2;
      comp.attack.value = 0.02; comp.release.value = 0.45;
      // A closed window is a low-pass filter and this is where it goes.
      const air = ac.createBiquadFilter();
      air.type = "lowpass"; air.frequency.value = 5200; air.Q.value = 0.5;
      // Nothing down there is rain, and on a phone speaker it is not even
      // audible — it just eats the headroom the impacts need.
      const sub = ac.createBiquadFilter();
      sub.type = "highpass"; sub.frequency.value = 55; sub.Q.value = 0.6;
      master.connect(comp); comp.connect(air); air.connect(sub);
      sub.connect(ac.destination);

      const sr = ac.sampleRate;

      // The sheet of it, out past the glass. Dark, small, and dense enough that
      // the individual impacts stop being individual and become the wash.
      const farPal = buildPalette(sr, 48, 1, 3.4);
      const far = bakeBed(sr, 5.77, 2, RAIN.farRate, farPal, 1.8, 0.4, 1, RAIN.farRms);
      rainLP = ac.createBiquadFilter();
      rainLP.type = "lowpass"; rainLP.frequency.value = RAIN.farLP; rainLP.Q.value = 0.5;
      rainGain = ac.createGain();
      rainGain.gain.value = RAIN.farGain;
      const farSrc = loopSource(far);
      farSrc.connect(rainLP); rainLP.connect(rainGain); rainGain.connect(master);
      try { farSrc.start(0); } catch (_) {}

      // Nearer and fatter: rain off the sill and the ledge outside, close
      // enough that you can still hear them land one at a time. A different
      // loop length from the sheet, so the pair never lines up.
      const nearPal = buildPalette(sr, 40, 1.25, 4.5);
      const mid = bakeBed(sr, 4.13, 2, RAIN.midRate, nearPal, 0.55, 0.5, 1, RAIN.midRms);
      const midLP = ac.createBiquadFilter();
      midLP.type = "lowpass"; midLP.frequency.value = RAIN.midLP; midLP.Q.value = 0.5;
      midGain = ac.createGain();
      midGain.gain.value = RAIN.midGain;
      const midSrc = loopSource(mid);
      midSrc.connect(midLP); midLP.connect(midGain); midGain.connect(master);
      try { midSrc.start(0); } catch (_) {}

      noiseBuf = ac.createBuffer(1, Math.floor(sr * 3), sr);
      fillPink(noiseBuf.getChannelData(0));
      const brownBuf = ac.createBuffer(1, Math.floor(sr * 4), sr);
      fillBrown(brownBuf.getChannelData(0));

      const hissLP = ac.createBiquadFilter();
      hissLP.type = "lowpass"; hissLP.frequency.value = 780; hissLP.Q.value = 0.5;
      const hissGain = ac.createGain();
      hissGain.gain.value = RAIN.hiss;
      const hissSrc = loopSource(noiseBuf);
      hissSrc.connect(hissLP); hissLP.connect(hissGain); hissGain.connect(master);
      try { hissSrc.start(0); } catch (_) {}

      // Splash. Every impact throws a fine spray that never resolves into
      // anything, and it lives an octave or two above the impacts themselves —
      // so the top of real rain is quietly busy rather than empty.
      const sprayHP = ac.createBiquadFilter();
      sprayHP.type = "highpass"; sprayHP.frequency.value = 1800; sprayHP.Q.value = 0.5;
      const sprayGain = ac.createGain();
      sprayGain.gain.value = RAIN.spray;
      const spraySrc = loopSource(noiseBuf);
      spraySrc.connect(sprayHP); sprayHP.connect(sprayGain); sprayGain.connect(master);
      try { spraySrc.start(1.37); } catch (_) {}

      // The room you are sitting in. You only notice it if it stops.
      const rumbleLP = ac.createBiquadFilter();
      rumbleLP.type = "lowpass"; rumbleLP.frequency.value = 190;
      rumbleGain = ac.createGain();
      rumbleGain.gain.value = RAIN.rumble;
      const rumbleSrc = loopSource(brownBuf);
      rumbleSrc.connect(rumbleLP); rumbleLP.connect(rumbleGain);
      rumbleGain.connect(master);
      try { rumbleSrc.start(0); } catch (_) {}

      // Weather outside, breathing slowly. Kept well under the rain so it
      // reads as depth rather than as a gale.
      windFilter = ac.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.5;
      windGain = ac.createGain();
      windGain.gain.value = 0.014;
      const windSrc = loopSource(brownBuf);
      windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
      try { windSrc.start(0); } catch (_) {}

      // Taps on the pane itself get their own bus so they stay in front of the
      // beds instead of being averaged into them.
      // Rain on a pane is softer and duller than memory says: the glass is
      // stiff, the frame damps it, and you are on the wrong side of it. Left
      // bright, these were the loudest thing in the mix and read as something
      // tapping rather than as weather.
      tapBus = ac.createGain();
      tapBus.gain.value = RAIN.tapBus;
      const tapLP = ac.createBiquadFilter();
      tapLP.type = "lowpass"; tapLP.frequency.value = RAIN.tapLP; tapLP.Q.value = 0.5;
      tapBus.connect(tapLP); tapLP.connect(master);

      // The pane is glass, not pavement, so these are duller and fatter than
      // anything in the sheet — but they are the only unfiltered thing here,
      // and that contrast is what says the window is right beside you.
      tapBufs = [];
      for (let i = 0; i < 12; i++) tapBufs.push(bufOf(sr, renderGrain(sr, 0.36 + (i / 11) * 0.6, 0.95)));
      dripBufs = [];
      for (let i = 0; i < 6; i++) dripBufs.push(bufOf(sr, renderDrip(sr, i / 5)));

      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
    }

    function bufOf(sr, w) {
      const b = ac.createBuffer(1, w.length, sr);
      b.getChannelData(0).set(w);
      return b;
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

    // One thing landing, at time `t`. Played back off the baked grains rather
    // than resynthesised, so it costs a node: rate below 1 drops the pitch and
    // stretches the decay together, which is what a bigger drop does, so one
    // control covers the whole size range.
    function oneShot(bufs, t, gain, rate, spread) {
      const src = ac.createBufferSource();
      src.buffer = bufs[(Math.random() * bufs.length) | 0];
      src.playbackRate.value = rate;
      const gn = ac.createGain();
      gn.gain.value = gain;
      src.connect(gn);
      // Spread across the glass.
      if (ac.createStereoPanner) {
        const pan = ac.createStereoPanner();
        pan.pan.value = (Math.random() * 2 - 1) * spread;
        gn.connect(pan); pan.connect(tapBus);
      } else {
        gn.connect(tapBus);
      }
      try { src.start(t); } catch (_) {}
    }

    // Impacts arrive independently of one another, so the gaps between them are
    // exponential, not fixed. Scheduling a horizon ahead in audio time rather
    // than one per frame is what keeps a shower from inheriting the frame rate
    // as a rhythm.
    let nextTap = 0, nextDrip = 0, tapRate = RAIN.tapRate;
    function scheduleTaps() {
      if (!ac || !soundOn || !tapBufs || ac.state !== "running") return;
      const now = ac.currentTime, horizon = now + 0.3;
      if (nextTap < now) nextTap = now + 0.02;
      if (nextDrip < now) nextDrip = now + 0.4 + Math.random();
      let guard = 0;
      while (nextTap < horizon && guard++ < 30) {
        const big = Math.random() * Math.random();
        oneShot(tapBufs, nextTap, (0.05 + big * 0.16) * (0.6 + Math.random() * 0.8),
                lerp(1.35, 0.62, big) * (0.92 + Math.random() * 0.16), 0.62);
        nextTap += -Math.log(1 - Math.random()) / tapRate;
      }
      guard = 0;
      while (nextDrip < horizon && guard++ < 4) {
        oneShot(dripBufs, nextDrip, 0.02 + Math.random() * 0.045,
                0.75 + Math.random() * 0.6, 0.85);
        nextDrip += 1.1 + Math.random() * 3.4;
      }
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
      bp.frequency.setValueAtTime(1300, t);
      bp.frequency.exponentialRampToValueAtTime(420, t + 0.3);
      bp.Q.value = 0.9;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.02, t + 0.04);
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
          preset: "cozy",
          scale: "pentatonic",
          volume: 0.18,
          intensity: 0.18,
          density: 0.24,
          tempo: 52,
          fadeInMs: 4200
        });
        if (!soundOn && musicHandle) musicHandle.pause();
      } catch (_) { musicHandle = null; }
    }

    /* ---------------------------------------------------------------- *
     * The race: ambient -> betting -> running -> settled -> ambient
     * ---------------------------------------------------------------- */

    const race = { state: "ambient", until: null, pick: null, racers: [null, null, null] };
    let raceArmed = false;
    const stats = { races: 0, wins: 0, streak: 0, best: 0, biggest: 0 };
    let finished = [];

    function formRace() {
      clearRacers();
      finished = [];
      const lanes = [0.27, 0.5, 0.73];
      for (let i = 0; i < 3; i++) {
        // Lanes are nudged so the start line is never identical twice.
        race.racers[i] = makeDrop(
          G.w * (lanes[i] + rr(-0.05, 0.05)),
          G.h * rr(0.15, 0.23),
          SZ.release * rr(1.45, 1.7),
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

    function splash(winner) {
      const d = race.racers[winner];
      const x = d ? clamp(d.x, 8, G.w - 8) : G.w / 2;
      for (let i = 0; i < 14; i++) {
        makeDrop(
          x + rr(-18, 18) * SZ.s,
          G.h - rr(2, 18) * SZ.s,
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
        if (nowMs > race.until) beginRunning();
      } else if (race.state === "running") {
        let anyAlive = false;
        for (let i = 0; i < 3; i++) {
          const d = race.racers[i];
          if (d && d.life > 0) anyAlive = true;
        }
        if (nowMs > race.until || !anyAlive) {
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
          races: stats.races, wins: stats.wins, best: stats.best,
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
      "margin-top:3px;font-size:12.5px;color:rgba(202,218,242,.78);text-shadow:0 1px 6px rgba(0,0,0,.95);"
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
      divEl("font-size:17px;font-weight:600;margin-bottom:4px;letter-spacing:.01em;", "Window Seat")
    );
    card.appendChild(
      divEl("font-size:12.5px;color:rgba(190,208,234,.6);margin-bottom:12px;",
            "A room, a window seat, and weather outside.")
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
      "Drag the glass to sweep loose beads into one heavy drop, then let go.",
      "Drop it in your racer's path and your racer swallows it and speeds up.",
      "Drag the room to look around — the shelves, the lamp, the seat.",
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
     * One gesture does everything, and what it does depends on what is under
     * it. On the glass you touch the water; anywhere else in the cabin you
     * turn your head. In the flat view there is no cabin, so everything
     * outside the pane simply does nothing.
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

    // Screen point -> pane point, or null if the touch missed the glass.
    function toGlass(e) {
      const sx = typeof e.offsetX === "number" ? e.offsetX : L.W / 2;
      const sy = typeof e.offsetY === "number" ? e.offsetY : L.H / 2;
      if (mode === "cabin") {
        if (!raycaster || !glassMesh) return null;
        ndc.set((sx / L.W) * 2 - 1, -((sy / L.H) * 2 - 1));
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObject(glassMesh, false)[0];
        if (!hit || !hit.uv) return null;
        return { x: hit.uv.x * G.w, y: (1 - hit.uv.y) * G.h };
      }
      const gl = L.glass;
      if (sx < gl.x || sx > gl.x + gl.w || sy < gl.y || sy > gl.y + gl.h) return null;
      return { x: ((sx - gl.x) / gl.w) * G.w, y: ((sy - gl.y) / gl.h) * G.h };
    }

    let dragging = false;         // dragging water
    let looking = false;          // dragging the view
    let lookX = 0, lookY = 0;

    function onDown(e) {
      e.preventDefault();
      firstGesture();
      const p = toGlass(e);

      if (p && race.state === "betting") {
        let hit = -1, bd = Infinity;
        for (let i = 0; i < 3; i++) {
          const d = race.racers[i];
          if (!d || d.life <= 0) continue;
          const dist = Math.hypot(d.x - p.x, d.y - p.y);
          // The drops are life-sized now, so the tap target cannot be. This is
          // a generous radius in pane units, picking the nearest ring inside it.
          if (dist < Math.max(85 * SZ.s, d.r + 40 * SZ.s) && dist < bd) { bd = dist; hit = i; }
        }
        if (hit >= 0) { pickRacer(hit); return; }
      }

      const target = mode === "cabin" ? view3d : view2d;
      try { target.setPointerCapture(e.pointerId); } catch (_) {}

      if (!p) {
        // Not on the glass. In the cabin that means you are turning your head.
        if (mode === "cabin") {
          looking = true;
          lookX = typeof e.offsetX === "number" ? e.offsetX : 0;
          lookY = typeof e.offsetY === "number" ? e.offsetY : 0;
        }
        return;
      }

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
    }

    function onMove(e) {
      if (looking) {
        e.preventDefault();
        const sx = typeof e.offsetX === "number" ? e.offsetX : lookX;
        const sy = typeof e.offsetY === "number" ? e.offsetY : lookY;
        yawTarget = clamp(yawTarget - (sx - lookX) * 0.004, YAW0 - YAW_RANGE, YAW0 + YAW_RANGE);
        pitchTarget = clamp(pitchTarget - (sy - lookY) * 0.0035, -0.62, 0.5);
        lookX = sx; lookY = sy;
        return;
      }
      if (!dragging || !held || held.life <= 0) return;
      e.preventDefault();
      const p = toGlass(e);
      if (!p) return;                    // finger slid off the pane; hold still

      const px = held.x, py = held.y;
      held.x = clamp(p.x, held.r, G.w - held.r);
      held.y = clamp(p.y, held.r, G.h - held.r);
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
          held.x = clamp(held.x, held.r, G.w - held.r);
          held.y = clamp(held.y, held.r, G.h - held.r);
        } else if (dist < SZ.gather) {
          // Pulled along, not teleported — you can watch them come to you.
          const k = (1 - dist / SZ.gather) * 2.6 * SZ.s;
          b.x += (dx / dist) * k;
          b.y += (dy / dist) * k;
        }
      }
      if (held.r > stats.biggest) stats.biggest = held.r;
    }

    function onUp(e) {
      looking = false;
      if (dragging && held && held.life > 0) {
        // Released. If you built something heavy, it goes straight away.
        if (held.r >= SZ.release * 0.76) {
          held.pin = 0.8;
          held.run = true;
          held.vy = Math.max(held.vy, 24 * SZ.s);
          onRelease(held);
          ctx.platform.interact({ type: "release", size: Math.round(held.r) });
        }
      }
      dragging = false;
      held = null;
      if (e && e.pointerId != null) {
        try { view2d.releasePointerCapture(e.pointerId); } catch (_) {}
        try { view3d.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }

    // Only whichever surface is showing can receive events, so both are wired.
    for (const surface of [view2d, view3d]) {
      ctx.listen(surface, "pointerdown", onDown, { passive: false });
      ctx.listen(surface, "pointermove", onMove, { passive: false });
      ctx.listen(surface, "pointerup", onUp);
      ctx.listen(surface, "pointercancel", onUp);
    }

    /* ---------------------------------------------------------------- *
     * Head movement
     *
     * Device tilt leans your head. In the cabin that is a real look-around on
     * top of whatever you have dragged to; in the flat view it shifts the
     * world behind the pane, which is what parallax through a window actually
     * looks like. Without a motion grant the car sways on its own.
     * ---------------------------------------------------------------- */

    let motionOn = false;
    let swayPhase = rr(0, 100);
    let leanX = 0, leanY = 0;

    async function startMotion() {
      if (motionOn || !ctx.capabilities || !ctx.capabilities.motion) return;
      try { motionOn = !!(await ctx.motion.start()); } catch (_) { motionOn = false; }
    }

    function stepHead(dt) {
      let tx, ty;
      if (motionOn && ctx.motion && ctx.motion.active) {
        const t = ctx.motion.tilt || {};
        tx = clamp((t.y || 0) / 26, -1, 1);
        ty = clamp(((t.x || 0) - 42) / 34, -1, 1);
      } else {
        swayPhase += dt * 0.28;
        tx = Math.sin(swayPhase) * 0.34 + Math.sin(swayPhase * 1.83) * 0.14;
        ty = Math.sin(swayPhase * 0.71 + 2) * 0.2;
      }
      const ease = Math.min(1, dt * 3.4);
      leanX += (tx - leanX) * ease;
      leanY += (ty - leanY) * ease;

      if (mode === "cabin") {
        // Enough that the car feels alive under you, far too little to
        // walk the window off the middle of the screen.
        yaw += (yawTarget + leanX * 0.055 - yaw) * ease;
        pitch += (pitchTarget + leanY * 0.04 - pitch) * ease;
        // The pane is flat, so the view through it should not shift when the
        // head only rotates — only when it leans. Keep the offset small.
        worldOffX = leanX * G.w * 0.012;
        worldOffY = clamp(leanY * G.h * 0.01, -G.h * 0.045, G.h * 0.045);
      } else {
        const maxT = Math.min(26, L.W * 0.06);
        worldOffX = leanX * maxT;
        worldOffY = clamp(leanY * maxT * 0.4, -G.h * 0.045, G.h * 0.045);
      }
    }

    /* ---------------------------------------------------------------- *
     * Frame
     * ---------------------------------------------------------------- */

    let avgDt = 16;

    ctx.onFrame((dtMs, timeMs) => {
      nowMs = timeMs;
      if (ctx.width !== L.rawW || ctx.height !== L.rawH) queueRelayout();
      // Armed only once boot has settled on a view, so the cabin cannot
      // arrive in the middle of a race. nowMs is the frame clock, which is
      // why the first deadline is set here rather than during init.
      if (raceArmed && race.until === null) race.until = nowMs + 1800;
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      avgDt = avgDt * 0.94 + dtMs * 0.06;

      // Lensing is the expensive part, so it is the first thing to go on a
      // slow device and the first thing back when there is headroom again.
      if (avgDt > 27 && lensBudget > 5) lensBudget--;
      else if (avgDt < 19 && lensBudget < TUNE.maxLens) lensBudget++;

      // The car is moving. Near things slide past faster than far things.
      scrollFar = (scrollFar + dt * TUNE.scrollFarAt1 * TUNE.carSpeed * SZ.s) % G.w;
      scrollNear = (scrollNear + dt * TUNE.scrollNearAt1 * TUNE.carSpeed * SZ.s) % G.w;

      stepHead(dt);
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

      // The beds ride the same gusts that are slanting the drops, and so does
      // how fast the pane is being hit — a squall you can hear arrive is worth
      // more than any amount of detail in a steady one.
      if (ac && rainGain && ac.state === "running") {
        // Slow, shallow breathing. Anything faster stops being restful.
        // Two rates that do not divide into each other, so the weather never
        // repeats the same swell twice in a row.
        const gust = 0.5 + 0.29 * Math.sin(windPhase * 0.45) +
                           0.21 * Math.sin(windPhase * 0.163 + 1.7);
        tapRate = RAIN.tapRate + gust * RAIN.tapRateGust;
        try {
          rainGain.gain.setTargetAtTime(RAIN.farGain + gust * RAIN.farGust, ac.currentTime, 1.2);
          rainLP.frequency.setTargetAtTime(RAIN.farLP + gust * RAIN.farLPGust, ac.currentTime, 1.4);
          midGain.gain.setTargetAtTime(RAIN.midGain + gust * RAIN.midGust, ac.currentTime, 1.5);
          windGain.gain.setTargetAtTime(0.01 + gust * 0.018, ac.currentTime, 1.6);
          windFilter.frequency.setTargetAtTime(340 + gust * 200, ac.currentTime, 1.8);
        } catch (_) {}
        scheduleTaps();
      }

      if (mode === "cabin") renderCabin(dt);
      else renderFlat();
    });

    /* ---------------------------------------------------------------- *
     * Resize
     *
     * The runtime owns both canvases and keeps their backing stores matched to
     * the container, so a resize only means re-deriving the layout and
     * re-baking whatever was sized to it. Driven off the measured size rather
     * than the window event, because the container can change without the
     * window doing anything (host chrome, split view, keyboard).
     * ---------------------------------------------------------------- */

    let resizeQueued = false;
    function queueRelayout() {
      if (resizeQueued) return;
      resizeQueued = true;
      ctx.timeout(() => {
        resizeQueued = false;
        layout();
        placeUI();
        if (mode === "cabin") {
          renderer.setSize(ctx.width, ctx.height, false);
          camera.aspect = ctx.width / ctx.height;
          camera.updateProjectionMatrix();
        } else {
          // Carry the weather across rather than wiping the glass clean.
          const sx = L.glass.w / (G.w || 1), sy = L.glass.h / (G.h || 1);
          const keep = drops.map((d) => ({ d, x: d.x * sx, y: d.y * sy }));
          setupGlass(L.glass.w, L.glass.h, 1, false);
          drops.length = 0;
          for (const k of keep) {
            if (k.d.life > 0 && k.x > 0 && k.x < G.w && k.y > 0 && k.y < G.h) {
              k.d.x = k.x; k.d.y = k.y; drops.push(k.d);
            }
          }
          clearRacers();
          race.state = "ambient";
          race.until = nowMs + 1600;
        }
      }, 180);
    }
    ctx.listen(window, "resize", queueRelayout);
    ctx.listen(window, "orientationchange", queueRelayout);

    /* ---------------------------------------------------------------- *
     * Boot
     *
     * The flat view comes up immediately and is fully playable, so there is
     * never a blank frame and never a wait. The cabin loads behind it and
     * takes over when it is ready — or never, in which case nothing is
     * missing except the walls.
     * ---------------------------------------------------------------- */

    setupGlass(L.glass.w, L.glass.h, 1, false);

    try {
      const pref = await ctx.storage.get("sound");
      if (pref === false) soundOn = false;
    } catch (_) {}
    btnSound.textContent = soundOn ? "♪" : "✕";

    renderFlat();
    ctx.markVisualReady("first_glass");

    loadStats();

    let seen = null;
    try { seen = await ctx.storage.get("seen"); } catch (_) {}
    if (!seen) openSheet(true);

    ctx.platform.ready();

    // Hold the race until the view has settled, so the cabin does not arrive
    // in the middle of one.
    let builtCabin = false;
    try { builtCabin = await tryCabin(); } catch (_) { builtCabin = false; }
    if (builtCabin) {
      mode = "cabin";
      view2d.style.display = "none";
      view3d.style.display = "";
      ctx.platform.emit("view_mode", { mode: "cabin" });
    } else {
      ctx.platform.emit("view_mode", { mode: "flat" });
    }
    race.until = null;
    raceArmed = true;
  }
};
