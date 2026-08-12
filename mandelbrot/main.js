/**
 * Mandelbrot — pinch to fall into the set.
 *
 * Every pinch doubles the magnification, and the picture never runs out of
 * detail. Getting that to be true on a phone is the whole engineering problem:
 * a 64-bit double runs out of mantissa at about 10^13 magnification (level 44),
 * and a GPU's 32-bit float dies at 10^5. So the naive "map pixel to complex
 * number, iterate" renderer turns into flat blocks after a few seconds of
 * zooming.
 *
 * This bit uses perturbation theory instead, which is how the deep-zoom
 * renderers (Kalles Fraktaler et al.) do it:
 *
 *   1. The CPU iterates ONE orbit — the view centre C — in double-double
 *      arithmetic (two doubles carrying ~32 significant digits, Dekker/Knuth
 *      products). That is the reference orbit Z_n.
 *   2. Every pixel is written as c = C + dc where dc is tiny, and the orbit
 *      difference dz = z - Z obeys  dz' = 2*Z*dz + dz^2 + dc.  That recurrence
 *      is numerically *relatively* stable, so the GPU can run it in plain
 *      float32 even when dc is 1e-31: signal and rounding error are amplified
 *      by the same factor each step.
 *   3. Reference orbits normally "glitch" where a pixel's orbit strays far from
 *      the centre's. Instead of Pauldelbrot glitch detection plus secondary
 *      references, this uses rebasing (Zhuoran): whenever |Z_m + dz| < |dz|,
 *      reset m to 0 and fold the full value back into dz. One reference then
 *      covers the whole screen with no glitches.
 *
 * Measured against a double-double ground truth, the float32 GPU path differs
 * from exact by a mean of 3.3/255 per channel, and storing the reference orbit
 * as float32 rather than double costs nothing (3.33 vs 3.22) — the residue is
 * float32 delta arithmetic on chaotic filaments, not the storage.
 *
 * Everything else follows from that: the derivative is carried in units of
 * pixels (dz/dpixel rather than dz/dc) so it can never overflow, which gives a
 * distance estimate, which gives antialiased filaments and the glow.
 *
 * Sound is the other half. Hold a finger down and the point under it sings:
 * its orbit — the actual sequence z -> z^2 + c — is loaded into a wavetable, so
 * a period-3 bulb sounds like a 3-lobed wave and the chaotic boundary sounds
 * gritty. Pitch is quantised to a scale by finger position, timbre is whatever
 * the fractal says. Slide around and you play it.
 */
window.plethoraBit = {
  meta: {
    title: "Mandelbrot",
    runtime: "plethora-bit@2",
    tags: ["fractal", "zoom", "math", "generative", "sensory", "art"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ====================================================================== //
    // Constants and small helpers                                            //
    // ====================================================================== //
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const TAU = Math.PI * 2;

    // Magnification is measured against the classic 4-unit-wide view, so
    // level = log2(magnification) and level 0 is "the whole set".
    const BASE_SPAN = 4.0;
    // Two different ceilings meet here. Arithmetic could go to level 93: float32
    // goes denormal below ~1.2e-38 and the double-double centre holds ~32
    // digits, so the per-pixel step stays clean to about 1e-28. Iterations run
    // out first. Escape times near the boundary grow like 220 * 2^(level/10) —
    // measured, not guessed — which passes 12000 around level 62, and 12000 is
    // already a couple of seconds of phone GPU for one settled frame. Past that
    // the picture would quietly turn to flat interior, so the dive stops at 68
    // while it still has something to show.
    const MAX_LEVEL = 68;
    const MAX_MAG_GPU = Math.pow(2, MAX_LEVEL);
    const MAX_MAG_CPU = 1e12;          // plain doubles, for the fallback path
    const BAILOUT = 256.0;             // large bailout => smooth iteration count
    const REF_W = 1024;                // reference-orbit texture width
    const ITER_CAP = 12000;

    const PALETTES = ["Ember", "Ultramarine", "Aurora", "Verdigris", "Bone"];

    // Places worth falling into. These were not recalled from memory — the
    // first attempt at that produced three duds, including one coordinate whose
    // whole neighbourhood is set interior (a black screen) and two that escape
    // within 60 iterations (a flat wash). These were found by a search that
    // descends level by level, each step recentring on the most escape-time-
    // varied part of the view, scored at the same 12000-iteration budget the
    // renderer actually has. Every one was then checked to contain 10-30%
    // interior at its target level, which is the mix that looks like something.
    //
    // Centres are exact (hi, lo) double pairs rather than decimal strings, so
    // no parsing step can quietly drop the digits that matter down here.
    const TOUR = [
      { name: "Seahorse Valley", cx: [-0.7709925841855163, 0], cy: [0.1003697762372055, 0], level: 24 },
      { name: "The North Bulb", cx: [-0.10117589925897774, 0], cy: [0.8354903294134595, 0], level: 36 },
      { name: "Western Spike", cx: [-1.74745249586047, 0], cy: [-0.004175409925323947, 0], level: 42 },
      { name: "Tendril", cx: [-0.7421277744445426, 0], cy: [0.10298477136849699, 0], level: 48 },
      { name: "East Valley", cx: [0.3617965029386454, 1.3877787807814457e-17], cy: [0.12624535650031313, -1.0408340855860843e-17], level: 54 }
    ];

    // ====================================================================== //
    // Double-double arithmetic                                               //
    // ====================================================================== //
    // A number is a (hi, lo) pair of doubles whose exact sum is the value, so
    // ~32 significant digits. Only the view centre and the reference orbit need
    // it — the per-pixel offsets are small and stay in single precision.
    //
    // Results come back in _h/_l rather than an allocated pair: the reference
    // orbit runs this a few thousand times per rebuild and rebuilds happen
    // several times a second, so allocating here would hand the GC a job.
    const SPLIT = 134217729; // 2^27 + 1, for Dekker splitting (no FMA in JS)
    let _h = 0, _l = 0;

    function ddAdd(ah, al, bh, bl) {
      const s = ah + bh;
      const bb = s - ah;
      let e = (ah - (s - bb)) + (bh - bb);   // exact two-sum error
      e += al + bl;
      const h = s + e;
      _h = h;
      _l = e - (h - s);
    }

    function ddMul(ah, al, bh, bl) {
      const p = ah * bh;
      const ac = SPLIT * ah, ahi = ac - (ac - ah), alo = ah - ahi;
      const bc = SPLIT * bh, bhi = bc - (bc - bh), blo = bh - bhi;
      let e = ((ahi * bhi - p) + ahi * blo + alo * bhi) + alo * blo;
      e += ah * bl + al * bh;
      const h = p + e;
      _h = h;
      _l = e - (h - p);
    }

    // ====================================================================== //
    // View state                                                             //
    // ====================================================================== //
    const view = {
      cx: { h: -0.6, l: 0 },   // centre, double-double
      cy: { h: 0.0, l: 0 },
      span: BASE_SPAN,         // complex units across the short screen axis
      rot: 0
    };

    let maxMag = MAX_MAG_GPU;
    const magnification = () => BASE_SPAN / view.span;
    const levelOf = (mag) => Math.log2(Math.max(mag, 1));

    function panPixels(dxPix, dyPix, W, H) {
      // dyPix arrives in GL space (y up), so no flip here.
      const s = view.span / Math.min(W, H);
      const co = Math.cos(view.rot), si = Math.sin(view.rot);
      const qx = co * dxPix - si * dyPix;
      const qy = si * dxPix + co * dyPix;
      ddAdd(view.cx.h, view.cx.l, -qx * s, 0); view.cx = { h: _h, l: _l };
      ddAdd(view.cy.h, view.cy.l, -qy * s, 0); view.cy = { h: _h, l: _l };
    }

    function zoomAbout(px, py, factor, W, H) {
      // Keep the complex point under (px, py) pinned while the span changes.
      const mag = magnification();
      let f = factor;
      if (mag * f > maxMag) f = maxMag / mag;
      if (view.span / f > BASE_SPAN * 1.6) f = view.span / (BASE_SPAN * 1.6);
      if (f === 1) return;
      const s = view.span / Math.min(W, H);
      const ox = px - W * 0.5, oy = py - H * 0.5;
      const co = Math.cos(view.rot), si = Math.sin(view.rot);
      const qx = (co * ox - si * oy) * s;
      const qy = (si * ox + co * oy) * s;
      const k = 1 - 1 / f;
      ddAdd(view.cx.h, view.cx.l, qx * k, 0); view.cx = { h: _h, l: _l };
      ddAdd(view.cy.h, view.cy.l, qy * k, 0); view.cy = { h: _h, l: _l };
      view.span /= f;
    }

    // A fixed iterations-per-level curve is wrong in both directions: it wastes
    // thousands of iterations on shallow views and starves deep ones, and a
    // starved view is not subtly worse, it is solid black — every pixel that
    // has not escaped by the cap is indistinguishable from set interior.
    //
    // So measure the view instead of predicting it. Before a settled render,
    // run the same perturbation loop over a sparse grid on the CPU (289 points,
    // a few ms) and take the 99th percentile escape time. That is exactly the
    // budget this particular spot needs, wherever the user happens to be.
    let probedIter = 320;
    let probedInterior = 0;
    let lastProbeLevel = 0;

    function probeIterations() {
      const N = 17;
      const span = view.span;
      const co = Math.cos(view.rot), si = Math.sin(view.rot);
      const escapes = [];
      let interior = 0;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const ox = (i / (N - 1) - 0.5) * span;
          const oy = (j / (N - 1) - 0.5) * span;
          const dcx = co * ox - si * oy;
          const dcy = si * ox + co * oy;
          let dx = 0, dy = 0, m = 0, n = 0;
          for (; n < ITER_CAP; n++) {
            const zx = refX[m] + dx, zy = refY[m] + dy;
            if (zx * zx + zy * zy > BAILOUT * BAILOUT) break;
            if (Math.max(Math.abs(zx), Math.abs(zy)) < Math.max(Math.abs(dx), Math.abs(dy)) ||
                m + 1 >= refLen) {
              dx = zx; dy = zy; m = 0;
            }
            const ux = 2 * refX[m] + dx, uy = 2 * refY[m] + dy;
            const ndx = ux * dx - uy * dy + dcx;
            const ndy = ux * dy + uy * dx + dcy;
            dx = ndx; dy = ndy; m++;
          }
          if (n >= ITER_CAP) interior++; else escapes.push(n);
        }
      }
      probedInterior = interior / (N * N);
      if (!escapes.length) {
        // Nothing escaped at all: a lake. More iterations cannot help here, and
        // the interior sheen is doing the drawing, so keep it cheap.
        probedIter = 900;
        return probedIter;
      }
      escapes.sort((a, b) => a - b);
      const p99 = escapes[Math.min(escapes.length - 1, Math.floor(escapes.length * 0.99))];
      probedIter = Math.round(clamp(p99 * 1.3 + 90, 220, ITER_CAP));
      return probedIter;
    }

    function iterBudget() {
      return probedIter;
    }

    // ====================================================================== //
    // Reference orbit                                                        //
    // ====================================================================== //
    // Iterate the centre in double-double, storing each Z_n as float32. Float32
    // storage is safe: the error it adds is an independent ~1e-7 nudge per
    // entry, which perturbation absorbs as a relative error, unlike computing
    // the orbit itself in low precision where chaos would compound it.
    const refX = new Float32Array(ITER_CAP);
    const refY = new Float32Array(ITER_CAP);
    let refLen = 0;      // where the centre's own orbit escaped, or the cap
    let uploadLen = 0;   // how much of it the GPU currently holds

    function buildReference(maxIter) {
      const cxh = view.cx.h, cxl = view.cx.l;
      const cyh = view.cy.h, cyl = view.cy.l;
      let xh = 0, xl = 0, yh = 0, yl = 0;
      let n = 0;
      for (; n < maxIter; n++) {
        refX[n] = xh;
        refY[n] = yh;
        if (xh * xh + yh * yh > BAILOUT * BAILOUT) { n++; break; }
        ddMul(xh, xl, xh, xl); const xxh = _h, xxl = _l;
        ddMul(yh, yl, yh, yl); const yyh = _h, yyl = _l;
        ddMul(xh, xl, yh, yl); const xyh = _h, xyl = _l;
        ddAdd(xxh, xxl, -yyh, -yyl);
        ddAdd(_h, _l, cxh, cxl); const nxh = _h, nxl = _l;
        // Doubling is exact in binary floating point, so 2*xy needs no care.
        ddAdd(2 * xyh, 2 * xyl, cyh, cyl);
        yh = _h; yl = _l;
        xh = nxh; xl = nxl;
      }
      refLen = n;
      return n;
    }

    // ====================================================================== //
    // Orbit tools (shared by audio and the minimap trace)                    //
    // ====================================================================== //
    // Plain doubles are fine here: this drives sound and a 72px trace, not
    // pixels, so being a hair off at extreme depth is inaudible and invisible.
    function orbitOf(cx, cy, count, warm) {
      const xs = new Float64Array(count);
      const ys = new Float64Array(count);
      let x = 0, y = 0, escaped = -1;
      for (let i = 0; i < warm; i++) {
        const nx = x * x - y * y + cx, ny = 2 * x * y + cy;
        x = nx; y = ny;
        if (x * x + y * y > 4) { escaped = i; break; }
      }
      if (escaped < 0) {
        for (let i = 0; i < count; i++) {
          const nx = x * x - y * y + cx, ny = 2 * x * y + cy;
          x = nx; y = ny;
          if (x * x + y * y > 4) { escaped = warm + i; break; }
          xs[i] = x; ys[i] = y;
        }
      }
      return { xs, ys, escaped };
    }

    // Smallest p where the orbit repeats — that is the period of the attracting
    // cycle, and it is what makes a bulb sound like a fixed pitch.
    function detectPeriod(xs, ys, maxP) {
      let best = 0, bestD = Infinity;
      for (let p = 1; p <= maxP; p++) {
        let d = 0;
        for (let k = 0; k < 8; k++) {
          const i = xs.length - 1 - k;
          const dx = xs[i] - xs[i - p], dy = ys[i] - ys[i - p];
          d += dx * dx + dy * dy;
        }
        if (d < bestD) { bestD = d; best = p; }
      }
      return bestD < 1e-14 ? best : 0;
    }

    // ====================================================================== //
    // Surfaces                                                               //
    // ====================================================================== //
    const glCanvas = ctx.createCanvas({ touchAction: "none" });
    // Belt and braces: without touch-action none the browser claims the gesture
    // for its own scrolling and cancels the pointer stream mid-pinch.
    glCanvas.style.touchAction = "none";
    glCanvas.style.width = "100%";
    glCanvas.style.height = "100%";
    glCanvas.style.display = "block";

    let gl = null;
    try {
      gl = glCanvas.getContext("webgl2", {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance"
      });
    } catch (err) {
      gl = null;
    }

    // Fallback surface: a plain 2D canvas driven by a JS escape-time renderer.
    // Plainer and shallower, but it draws rather than showing a blank frame.
    let cpuCanvas = null, cpu2d = null;
    if (!gl) {
      glCanvas.style.display = "none";
      cpuCanvas = ctx.createCanvas2D({ touchAction: "none" });
      cpuCanvas.style.touchAction = "none";
      cpuCanvas.style.width = "100%";
      cpuCanvas.style.height = "100%";
      cpu2d = cpuCanvas.getContext("2d");
      maxMag = MAX_MAG_CPU;
    }
    const inputSurface = gl ? glCanvas : cpuCanvas;

    const overlay = ctx.createCanvas2D();
    const ov = overlay.getContext("2d");
    overlay.style.pointerEvents = "none";

    // ====================================================================== //
    // GPU renderer                                                           //
    // ====================================================================== //
    const VERT = `#version 300 es
    void main() {
      // Full-screen triangle from gl_VertexID; no buffers needed.
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

    const FRAG = `#version 300 es
    precision highp float;
    precision highp int;

    uniform sampler2D uRef;
    uniform vec2  uRes;
    uniform vec2  uJitter;
    uniform float uPixel;      // complex units per pixel
    uniform vec4  uRot;        // rotation matrix, row major
    uniform int   uMaxIter;
    uniform int   uRefLen;
    uniform float uShift;      // palette phase
    uniform int   uPalette;
    uniform float uGlow;
    out vec4 fragColor;

    const float BAILOUT = ${BAILOUT.toFixed(1)};
    const float BAILOUT2 = ${(BAILOUT * BAILOUT).toFixed(1)};

    vec2 cmul(vec2 a, vec2 b) {
      return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
    }

    vec3 cosPal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
      return a + b * cos(6.28318530718 * (c * t + d));
    }

    // Cosine gradients. The phase offsets in d have to be spread across the
    // channels — bunch them together and all three move as one, which is a
    // brightness ramp with a tint, not a palette.
    vec3 palette(float t) {
      if (uPalette == 0) return cosPal(t, vec3(0.50, 0.34, 0.22), vec3(0.48, 0.34, 0.24),
                                          vec3(1.0, 1.0, 1.0), vec3(0.00, 0.18, 0.42));
      if (uPalette == 1) return cosPal(t, vec3(0.34, 0.40, 0.56), vec3(0.32, 0.34, 0.40),
                                          vec3(1.0, 1.0, 1.0), vec3(0.62, 0.78, 0.10));
      if (uPalette == 2) return cosPal(t, vec3(0.44, 0.46, 0.48), vec3(0.40, 0.38, 0.42),
                                          vec3(1.0, 1.0, 1.0), vec3(0.10, 0.42, 0.74));
      if (uPalette == 3) return cosPal(t, vec3(0.28, 0.44, 0.40), vec3(0.30, 0.36, 0.32),
                                          vec3(1.0, 1.0, 1.0), vec3(0.55, 0.05, 0.30));
      return cosPal(t, vec3(0.62, 0.58, 0.52), vec3(0.34, 0.34, 0.36),
                       vec3(1.0, 1.0, 1.0), vec3(0.02, 0.14, 0.30));
    }

    // Interior gets an orbit-trap sheen instead of flat black, so a lake still
    // shows the dynamics that produced it.
    vec3 interiorColor(float minR2) {
      float t = pow(clamp(minR2, 0.0, 1.0), 0.28);
      vec3 deep = palette(uShift + 0.5) * 0.10;
      return mix(vec3(0.008, 0.010, 0.020), deep + vec3(0.02, 0.03, 0.05), t);
    }

    void main() {
      vec2 pix = gl_FragCoord.xy + uJitter - 0.5 * uRes;
      vec2 q = vec2(uRot.x * pix.x + uRot.y * pix.y,
                    uRot.z * pix.x + uRot.w * pix.y);
      vec2 dc = q * uPixel;
      // dc/dpixel, so the derivative below is measured in pixels and cannot
      // overflow the way dz/dc would at 1e28 magnification.
      vec2 sc = vec2(uRot.x, uRot.z) * uPixel;

      vec2 dz = vec2(0.0);
      vec2 dp = vec2(0.0);
      int m = 0;
      int n = 0;
      float r2 = 0.0;
      float minR2 = 4.0;
      bool escaped = false;

      for (int i = 0; i < ${ITER_CAP}; i++) {
        if (i >= uMaxIter) { n = i; break; }
        vec2 Z = texelFetch(uRef, ivec2(m & ${REF_W - 1}, m >> 10), 0).rg;
        vec2 z = Z + dz;
        r2 = dot(z, z);
        if (r2 > BAILOUT2) { escaped = true; n = i; break; }
        minR2 = min(minR2, r2);
        dp = cmul(2.0 * z, dp) + sc;
        // Rebasing test in Chebyshev norm: |dz|^2 would underflow float32 to
        // zero once dz reaches 1e-20, and the comparison has to survive that.
        if (max(abs(z.x), abs(z.y)) < max(abs(dz.x), abs(dz.y)) || m + 1 >= uRefLen) {
          dz = z;
          m = 0;
          Z = vec2(0.0);           // Z_0 is exactly zero, so no refetch
        }
        dz = cmul(2.0 * Z + dz, dz) + dc;
        m++;
      }

      vec3 col;
      if (!escaped) {
        col = interiorColor(minR2);
      } else {
        float r = sqrt(r2);
        float sn = float(n) - log2(log(r) / log(BAILOUT));
        float t = uShift + log(1.0 + max(sn, 0.0)) * 0.85;
        vec3 ext = palette(t);

        // Distance estimate in pixels: |z|.log|z| / |dz/dpixel|.
        float dpl = max(length(dp), 1e-30);
        float de = r * log(r) / dpl;

        // Sub-pixel distance means the set partially covers this pixel, which
        // is exactly the antialiasing term the filaments need.
        // How close the orbit ever came to the origin. Costs nothing — it is
        // already in hand — and gives flat regions, where escape times barely
        // vary, a grain that reflects the actual dynamics.
        ext *= 0.86 + 0.14 * pow(clamp(minR2 * 1.6, 0.0, 1.0), 0.4);

        float cov = clamp(de, 0.0, 1.0);
        vec3 inr = interiorColor(minR2);
        col = mix(inr, ext, cov);
        col += ext * exp(-de * 0.65) * uGlow;
      }
      fragColor = vec4(col, 1.0);
    }`;

    const BLIT_VERT = `#version 300 es
    out vec2 vUV;
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      vUV = p;
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

    // The compositor. Every layer goes through this, and the affine term is
    // what lets the last sharp frame be re-shown under a live gesture: a pan,
    // zoom and twist of the view is a pan, zoom and twist of the old image.
    const BLIT_FRAG = `#version 300 es
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform vec4 uA;        // pixel-space rotate+scale
    uniform vec2 uT;        // pixel-space offset
    uniform vec2 uUVScale;  // sub-rectangle of the source actually in use
    uniform float uVignette;
    uniform int uClip;      // drop fragments that fall outside the source
    in vec2 vUV;
    out vec4 fragColor;
    void main() {
      vec2 pc = (vUV - 0.5) * uRes;
      vec2 ps = vec2(uA.x * pc.x + uA.y * pc.y, uA.z * pc.x + uA.w * pc.y) + uT;
      vec2 uvn = ps / uRes + 0.5;
      if (uClip == 1 && (uvn.x < 0.0 || uvn.y < 0.0 || uvn.x > 1.0 || uvn.y > 1.0)) discard;
      vec3 c = texture(uTex, uvn * uUVScale).rgb;
      vec2 d = vUV - 0.5;
      c *= 1.0 - uVignette * dot(d, d) * 1.35;
      // A whisper of grain keeps wide smooth gradients from banding on 8-bit.
      float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * 0.014;
      fragColor = vec4(c, 1.0);
    }`;

    let progMain = null, progBlit = null, refTex = null;
    let loFbo = null, loTex = null, hiFbo = null, hiTex = null;
    let snapFbo = null, snapTex = null;
    let loW = 0, loH = 0, hiW = 0, hiH = 0;
    // The preview renders into a sub-rectangle of loFbo rather than its own
    // texture, so its resolution can track the iteration budget every frame
    // without reallocating anything.
    let preW = 0, preH = 0;
    let snapValid = false;
    const snapView = { cx: { h: 0, l: 0 }, cy: { h: 0, l: 0 }, span: 1, rot: 0 };
    const uni = {};

    function compile(vsSrc, fsSrc) {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        throw new Error("vertex: " + gl.getShaderInfoLog(vs));
      }
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        throw new Error("fragment: " + gl.getShaderInfoLog(fs));
      }
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error("link: " + gl.getProgramInfoLog(p));
      }
      gl.deleteShader(vs); gl.deleteShader(fs);
      return p;
    }

    function makeTarget(w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbo };
    }

    let glReady = false;
    if (gl) {
      try {
        progMain = compile(VERT, FRAG);
        progBlit = compile(BLIT_VERT, BLIT_FRAG);
        for (const name of ["uRef", "uRes", "uJitter", "uPixel", "uRot", "uMaxIter",
                            "uRefLen", "uShift", "uPalette", "uGlow"]) {
          uni[name] = gl.getUniformLocation(progMain, name);
        }
        uni.bTex = gl.getUniformLocation(progBlit, "uTex");
        uni.bRes = gl.getUniformLocation(progBlit, "uRes");
        uni.bVig = gl.getUniformLocation(progBlit, "uVignette");
        uni.bA = gl.getUniformLocation(progBlit, "uA");
        uni.bT = gl.getUniformLocation(progBlit, "uT");
        uni.bUV = gl.getUniformLocation(progBlit, "uUVScale");
        uni.bClip = gl.getUniformLocation(progBlit, "uClip");

        refTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, refTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        glReady = true;
      } catch (err) {
        glReady = false;
        ctx.platform.error({ stage: "webgl_init", message: String(err && err.message || err) });
      }
    }
    if (gl && !glReady) {
      // Shaders refused to build: drop to the CPU path rather than show nothing.
      gl = null;
      glCanvas.style.display = "none";
      cpuCanvas = ctx.createCanvas2D({ touchAction: "none" });
      cpuCanvas.style.width = "100%";
      cpuCanvas.style.height = "100%";
      cpu2d = cpuCanvas.getContext("2d");
      maxMag = MAX_MAG_CPU;
    }

    const refPixels = new Float32Array(REF_W * Math.ceil(ITER_CAP / REF_W) * 2);

    function uploadReference(len) {
      const rows = Math.max(1, Math.ceil(len / REF_W));
      for (let i = 0; i < len; i++) {
        refPixels[i * 2] = refX[i];
        refPixels[i * 2 + 1] = refY[i];
      }
      gl.bindTexture(gl.TEXTURE_2D, refTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, REF_W, rows, 0, gl.RG, gl.FLOAT,
                    refPixels.subarray(0, REF_W * rows * 2));
    }

    // ====================================================================== //
    // Render scheduling                                                      //
    // ====================================================================== //
    // While a finger is down: one cheap low-resolution pass per frame. When the
    // view settles: the full-resolution image is rendered in horizontal bands
    // across successive frames, sweeping down the screen, so the phone never
    // has to finish a deep frame in one go.
    const render = {
      quality: 1.0,
      previewScale: 0.34,
      bands: 14,
      bandIndex: 0,
      pass: 0,
      refining: false,
      settled: false,
      dirty: true,
      idleFrames: 0,
      shift: 0.0,
      palette: 0,
      glow: 0.22
    };

    let W = 1, H = 1;

    function ensureTargets() {
      const cw = Math.max(1, Math.round(ctx.width));
      const chh = Math.max(1, Math.round(ctx.height));
      if (cw === W && chh === H && hiFbo) return;
      W = cw; H = chh;
      const q = clamp(ctx.dpr || 1, 1, 1.5) * render.quality;
      hiW = Math.max(2, Math.round(W * q));
      hiH = Math.max(2, Math.round(H * q));
      loW = Math.max(2, Math.round(hiW * render.previewScale));
      loH = Math.max(2, Math.round(hiH * render.previewScale));
      glCanvas.width = hiW;
      glCanvas.height = hiH;
      if (hiFbo) { gl.deleteFramebuffer(hiFbo); gl.deleteTexture(hiTex); }
      if (loFbo) { gl.deleteFramebuffer(loFbo); gl.deleteTexture(loTex); }
      if (snapFbo) { gl.deleteFramebuffer(snapFbo); gl.deleteTexture(snapTex); }
      let t = makeTarget(hiW, hiH); hiFbo = t.fbo; hiTex = t.tex;
      t = makeTarget(loW, loH); loFbo = t.fbo; loTex = t.tex;
      t = makeTarget(hiW, hiH); snapFbo = t.fbo; snapTex = t.tex;
      preW = loW; preH = loH;
      snapValid = false;
      render.dirty = true;
    }

    function setMainUniforms(resW, resH, maxIter, jx, jy) {
      const pixel = view.span / Math.min(resW, resH);
      const co = Math.cos(view.rot), si = Math.sin(view.rot);
      gl.uniform2f(uni.uRes, resW, resH);
      gl.uniform2f(uni.uJitter, jx, jy);
      gl.uniform1f(uni.uPixel, pixel);
      gl.uniform4f(uni.uRot, co, -si, si, co);
      gl.uniform1i(uni.uMaxIter, maxIter);
      gl.uniform1i(uni.uRefLen, uploadLen);
      gl.uniform1f(uni.uShift, render.shift);
      gl.uniform1i(uni.uPalette, render.palette);
      gl.uniform1f(uni.uGlow, render.glow);
      gl.uniform1i(uni.uRef, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, refTex);
    }

    function drawPreview() {
      // A preview starved of iterations is not a rough preview, it is a black
      // rectangle: every pixel that has not escaped by the cap is interior. So
      // the budget follows the depth, and the resolution drops to pay for it —
      // pixels x iterations is held roughly constant, which is what actually
      // costs time.
      // The cap has to be on resolution, not on iterations. Capping iterations
      // is what produced a black preview at depth; trading pixels away instead
      // gives a blocky preview, and blocky-but-true beats a black rectangle.
      const maxIter = Math.round(clamp(probedIter, 220, ITER_CAP));
      const scale = clamp(Math.sqrt(920 / maxIter), 0.16, 1.0);
      preW = Math.max(2, Math.round(loW * scale));
      preH = Math.max(2, Math.round(loH * scale));
      // The centre moves on every frame of a drag, so the reference is always
      // rebuilt here. At preview lengths that is a few thousand flops.
      buildReference(maxIter);
      uploadLen = refLen;
      uploadReference(uploadLen);
      gl.bindFramebuffer(gl.FRAMEBUFFER, loFbo);
      gl.viewport(0, 0, preW, preH);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(progMain);
      setMainUniforms(preW, preH, maxIter, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function startRefine() {
      // Full-length reference first: the probe iterates against it, so it has
      // to be able to see as far as the cap allows.
      buildReference(ITER_CAP);
      const maxIter = probeIterations();
      uploadLen = Math.min(refLen, maxIter);
      uploadReference(uploadLen);
      render.refineIter = maxIter;
      render.bandIndex = 0;
      render.pass = 0;
      render.refining = true;
      render.settled = false;
    }

    // One band of the sharp image. Pass 0 lays it down; pass 1 runs the same
    // bands again offset by half a pixel and averages, which is what takes the
    // speckle out of dense filament country where the set threads between
    // samples. The base image is already on screen by then, so the second pass
    // reads as the picture quietly cleaning itself up.
    function refineBand() {
      const bandH = Math.ceil(hiH / render.bands);
      const i = render.bandIndex;
      // Sweep top to bottom on screen; GL y counts up from the bottom.
      const y1 = hiH - i * bandH;
      const y0 = Math.max(0, y1 - bandH);
      const aa = render.pass === 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, hiFbo);
      gl.viewport(0, 0, hiW, hiH);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, y0, hiW, Math.max(1, y1 - y0));
      if (aa) {
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, 0.5);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      }
      gl.useProgram(progMain);
      setMainUniforms(hiW, hiH, render.refineIter, aa ? 0.5 : 0, aa ? 0.5 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (aa) gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      render.bandIndex++;
      if (render.bandIndex >= render.bands) {
        if (render.pass === 0) {
          // Show it now, then keep polishing.
          render.settled = true;
          render.pass = 1;
          render.bandIndex = 0;
          captureSnapshot();
        } else {
          render.refining = false;
          captureSnapshot();
        }
      }
    }

    // Keep the finished frame so the next gesture has something sharp to show.
    function captureSnapshot() {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hiFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, snapFbo);
      gl.blitFramebuffer(0, 0, hiW, hiH, 0, 0, hiW, hiH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      snapView.cx = view.cx;
      snapView.cy = view.cy;
      snapView.span = view.span;
      snapView.rot = view.rot;
      snapValid = true;
    }

    // Where does the current screen sit inside the snapshot? Pure affine: the
    // snapshot pixel for a current pixel p is  A*p + t, with A a rotate-scale
    // by the ratio of the two views and t the centre offset in snapshot pixels.
    function snapshotTransform() {
      const m = Math.min(hiW, hiH);
      const ss = snapView.span / m, sc = view.span / m;
      const k = sc / ss;
      const dr = view.rot - snapView.rot;
      const co = Math.cos(dr) * k, si = Math.sin(dr) * k;
      ddAdd(view.cx.h, view.cx.l, -snapView.cx.h, -snapView.cx.l);
      const dx = _h + _l;
      ddAdd(view.cy.h, view.cy.l, -snapView.cy.h, -snapView.cy.l);
      const dy = _h + _l;
      const cs = Math.cos(-snapView.rot), sn = Math.sin(-snapView.rot);
      const tx = (cs * dx - sn * dy) / ss;
      const ty = (sn * dx + cs * dy) / ss;
      return { a: [co, -si, si, co], t: [tx, ty] };
    }

    function blit(tex, a, t, uvx, uvy, clip) {
      gl.uniform4f(uni.bA, a[0], a[1], a[2], a[3]);
      gl.uniform2f(uni.bT, t[0], t[1]);
      gl.uniform2f(uni.bUV, uvx, uvy);
      gl.uniform1i(uni.bClip, clip ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const IDENT = [1, 0, 0, 1];
    const NO_OFF = [0, 0];

    function present() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, hiW, hiH);
      gl.useProgram(progBlit);
      gl.uniform1i(uni.bTex, 0);
      gl.uniform2f(uni.bRes, hiW, hiH);
      gl.uniform1f(uni.bVig, 0.5);
      gl.activeTexture(gl.TEXTURE0);
      gl.disable(gl.SCISSOR_TEST);

      if (render.settled) {
        blit(hiTex, IDENT, NO_OFF, 1, 1, false);
        return;
      }

      // Coarse live render everywhere...
      blit(loTex, IDENT, NO_OFF, preW / loW, preH / loH, false);
      // ...the last sharp frame dragged into place over it, which is what makes
      // a pinch feel like moving a picture rather than watching one rebuild...
      if (snapValid) {
        const s = snapshotTransform();
        blit(snapTex, s.a, s.t, 1, 1, true);
      }
      // ...and the freshly resolved bands last, since they are the truth.
      if (render.bandIndex > 0) {
        const bandH = Math.ceil(hiH / render.bands);
        const done = Math.min(hiH, render.bandIndex * bandH);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, Math.max(0, hiH - done), hiW, done);
        blit(hiTex, IDENT, NO_OFF, 1, 1, false);
        gl.disable(gl.SCISSOR_TEST);
      }
    }

    // ====================================================================== //
    // CPU fallback renderer                                                  //
    // ====================================================================== //
    const cpu = { img: null, w: 0, h: 0, row: 0, scale: 0.3, done: false };

    function cpuEnsure() {
      const w = Math.max(2, Math.round(ctx.width * cpu.scale));
      const h = Math.max(2, Math.round(ctx.height * cpu.scale));
      if (w !== cpu.w || h !== cpu.h) {
        cpu.w = w; cpu.h = h;
        cpu.img = cpu2d.createImageData(w, h);
        cpu.row = 0; cpu.done = false;
      }
    }

    function cpuPalette(sn, out) {
      const t = render.shift + Math.log(1 + Math.max(sn, 0)) * 0.85;
      const p = [[0.50, 0.34, 0.22, 0.48, 0.34, 0.24, 0.00, 0.18, 0.42],
                 [0.34, 0.40, 0.56, 0.32, 0.34, 0.40, 0.62, 0.78, 0.10],
                 [0.44, 0.46, 0.48, 0.40, 0.38, 0.42, 0.10, 0.42, 0.74],
                 [0.28, 0.44, 0.40, 0.30, 0.36, 0.32, 0.55, 0.05, 0.30],
                 [0.62, 0.58, 0.52, 0.34, 0.34, 0.36, 0.02, 0.14, 0.30]][render.palette];
      for (let k = 0; k < 3; k++) {
        out[k] = clamp(p[k] + p[3 + k] * Math.cos(TAU * (t + p[6 + k])), 0, 1) * 255;
      }
    }

    function cpuStep(budgetMs) {
      cpuEnsure();
      if (cpu.done) return;
      const t0 = Date.now();
      const maxIter = Math.min(iterBudget(), 900);
      const pixel = view.span / Math.min(cpu.w, cpu.h);
      const co = Math.cos(view.rot), si = Math.sin(view.rot);
      const cx = view.cx.h, cy = view.cy.h;
      const data = cpu.img.data;
      const rgb = [0, 0, 0];
      while (cpu.row < cpu.h) {
        const py = (cpu.h - 1 - cpu.row) - cpu.h * 0.5;
        for (let px = 0; px < cpu.w; px++) {
          const ox = px - cpu.w * 0.5;
          const qx = (co * ox - si * py) * pixel;
          const qy = (si * ox + co * py) * pixel;
          const c0 = cx + qx, c1 = cy + qy;
          let x = 0, y = 0, n = 0, r2 = 0;
          for (; n < maxIter; n++) {
            const xx = x * x, yy = y * y;
            r2 = xx + yy;
            if (r2 > BAILOUT * BAILOUT) break;
            y = 2 * x * y + c1;
            x = xx - yy + c0;
          }
          const o = (cpu.row * cpu.w + px) * 4;
          if (n >= maxIter) {
            data[o] = 2; data[o + 1] = 3; data[o + 2] = 6;
          } else {
            const sn = n - Math.log2(Math.log(Math.sqrt(r2)) / Math.log(BAILOUT));
            cpuPalette(sn, rgb);
            data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2];
          }
          data[o + 3] = 255;
        }
        cpu.row++;
        if (Date.now() - t0 > budgetMs) break;
      }
      if (cpu.row >= cpu.h) cpu.done = true;
    }

    function cpuPresent() {
      if (!cpu.img) return;
      cpu2d.save();
      cpu2d.imageSmoothingEnabled = true;
      // putImageData ignores transforms, so stage it through a scaled draw of
      // the bitmap the only way a 2D context allows: paint it small, then let
      // the browser scale it up on the next draw.
      cpu2d.putImageData(cpu.img, 0, 0);
      cpu2d.drawImage(cpuCanvas, 0, 0, cpu.w, cpu.h, 0, 0, ctx.width, ctx.height);
      cpu2d.restore();
    }

    // ====================================================================== //
    // Audio                                                                  //
    // ====================================================================== //
    // ctx.music carries the bed; the orbit voice needs real synthesis, so it
    // uses a WebAudio graph directly (declared via the audio permission).
    const audio = {
      on: true,
      actx: null,
      master: null,
      voice: null,
      voiceGain: null,
      voiceFilter: null,
      music: null,
      started: false,
      noise: null,
      noiseGain: null
    };

    function audioBoot() {
      if (audio.started || !audio.on) return;
      audio.started = true;
      if (ctx.capabilities && ctx.capabilities.audio) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            const actx = new AC();
            audio.actx = actx;
            const master = actx.createGain();
            master.gain.value = 0.9;
            // Gentle top-end roll-off: phone speakers make raw wavetables harsh.
            const shelf = actx.createBiquadFilter();
            shelf.type = "lowpass";
            shelf.frequency.value = 5200;
            shelf.Q.value = 0.4;
            master.connect(shelf);
            shelf.connect(actx.destination);
            audio.master = master;

            // A short feedback delay gives the voice somewhere to sit.
            const delay = actx.createDelay(1.0);
            delay.delayTime.value = 0.26;
            const fb = actx.createGain();
            fb.gain.value = 0.28;
            const wet = actx.createGain();
            wet.gain.value = 0.3;
            delay.connect(fb); fb.connect(delay);
            delay.connect(wet); wet.connect(master);
            audio.delay = delay;

            const vg = actx.createGain();
            vg.gain.value = 0;
            const vf = actx.createBiquadFilter();
            vf.type = "lowpass";
            vf.frequency.value = 2200;
            vf.Q.value = 1.1;
            vg.connect(vf);
            vf.connect(master);
            vf.connect(delay);
            audio.voiceGain = vg;
            audio.voiceFilter = vf;

            // Zoom texture: noise through a bandpass that tracks depth.
            const nb = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
            const nd = nb.getChannelData(0);
            for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
            const ns = actx.createBufferSource();
            ns.buffer = nb; ns.loop = true;
            const nf = actx.createBiquadFilter();
            nf.type = "bandpass"; nf.frequency.value = 600; nf.Q.value = 1.2;
            const ng = actx.createGain(); ng.gain.value = 0;
            ns.connect(nf); nf.connect(ng); ng.connect(master);
            ns.start();
            audio.noise = nf; audio.noiseGain = ng;
          }
        } catch (err) {
          audio.actx = null;
        }
      }
      if (ctx.capabilities && ctx.capabilities.backgroundMusic) {
        try {
          ctx.music.unlock();
          audio.music = ctx.music.play({
            preset: "drift",
            scale: "hirajoshi",
            volume: 0.3,
            intensity: 0.3,
            density: 0.4,
            tempo: 68,
            fadeInMs: 2400
          });
        } catch (err) {
          audio.music = null;
        }
      }
    }

    const SCALE = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19];  // a wide minor-ish run

    function playOrbitVoice(cx, cy, px, W2) {
      if (!audio.actx || !audio.on) return;
      const actx = audio.actx;
      const orb = orbitOf(cx, cy, 1024, 300);
      const now = actx.currentTime;

      if (audio.voice) {
        try { audio.voice.stop(now + 0.05); } catch (err) { /* already stopped */ }
        audio.voice = null;
      }

      // Pitch is musical and chosen by where the finger is; timbre is whatever
      // the orbit turns out to be.
      const step = SCALE[clamp(Math.floor((px / Math.max(W2, 1)) * SCALE.length), 0, SCALE.length - 1)];
      const freq = 110 * Math.pow(2, step / 12);

      let period = 0;
      if (orb.escaped < 0) period = detectPeriod(orb.xs, orb.ys, 32);

      const src = actx.createBufferSource();
      if (orb.escaped >= 0) {
        // Outside the set: no sustained tone, just a short bright ping whose
        // pitch reports how fast the point ran away.
        const osc = actx.createOscillator();
        const g = actx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq * 4 * Math.pow(0.985, Math.min(orb.escaped, 60));
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.16, now + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0008, now + 0.38);
        osc.connect(g); g.connect(audio.voiceFilter);
        osc.start(now); osc.stop(now + 0.42);
        audio.voiceGain.gain.cancelScheduledValues(now);
        audio.voiceGain.gain.setTargetAtTime(0, now, 0.05);
        return;
      }

      // One cycle of the attractor if it has one, otherwise a slice of the
      // chaotic wander, which is what makes the boundary sound gritty.
      const cycle = period > 0 ? period : 256;
      const OS = Math.max(2, Math.round(220 / cycle));
      const len = cycle * OS;
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      let lo = Infinity, hi = -Infinity;
      const base = orb.xs.length - cycle;
      for (let i = 0; i < cycle; i++) {
        const v = orb.xs[base + i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const mid = (hi + lo) * 0.5, half = Math.max((hi - lo) * 0.5, 1e-9);
      for (let i = 0; i < len; i++) {
        const f = i / OS;
        const i0 = Math.floor(f) % cycle;
        const i1 = (i0 + 1) % cycle;
        const fr = f - Math.floor(f);
        const a = (orb.xs[base + i0] - mid) / half;
        const b = (orb.xs[base + i1] - mid) / half;
        d[i] = clamp(lerp(a, b, fr), -1, 1) * 0.9;
      }
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = (freq * len) / actx.sampleRate;
      src.connect(audio.voiceGain);
      src.start(now);
      audio.voice = src;
      audio.voiceGain.gain.cancelScheduledValues(now);
      audio.voiceGain.gain.setTargetAtTime(period > 0 ? 0.22 : 0.13, now, 0.05);
      audio.voiceFilter.frequency.setTargetAtTime(period > 0 ? 2600 : 1500, now, 0.1);
    }

    function stopOrbitVoice() {
      if (!audio.actx) return;
      const now = audio.actx.currentTime;
      audio.voiceGain.gain.cancelScheduledValues(now);
      audio.voiceGain.gain.setTargetAtTime(0, now, 0.08);
      if (audio.voice) {
        const v = audio.voice;
        audio.voice = null;
        try { v.stop(now + 0.5); } catch (err) { /* already stopped */ }
      }
    }

    function levelBell(level) {
      if (!audio.actx || !audio.on) return;
      const actx = audio.actx;
      const now = actx.currentTime;
      const step = SCALE[level % SCALE.length];
      const f0 = 220 * Math.pow(2, step / 12 + Math.floor(level / SCALE.length) * 0.0);
      // Inharmonic partials: a struck bell, not an organ.
      const parts = [[1, 0.14], [2.76, 0.05], [5.4, 0.025]];
      for (const [ratio, amp] of parts) {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = "sine";
        o.frequency.value = f0 * ratio;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(amp, now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0005, now + 1.6 / ratio);
        o.connect(g);
        g.connect(audio.master);
        if (audio.delay) g.connect(audio.delay);
        o.start(now);
        o.stop(now + 1.8);
      }
    }

    function updateAudioDepth(level, zoomVel) {
      if (audio.music) {
        try {
          audio.music.setIntensity(clamp(0.2 + (level / MAX_LEVEL) * 0.65, 0, 1));
        } catch (err) { /* handle may be stopped */ }
      }
      if (audio.noiseGain && audio.actx) {
        const t = audio.actx.currentTime;
        audio.noiseGain.gain.setTargetAtTime(clamp(Math.abs(zoomVel) * 0.05, 0, 0.05), t, 0.08);
        audio.noise.frequency.setTargetAtTime(300 + level * 26, t, 0.2);
      }
    }

    // ====================================================================== //
    // Minimap                                                                //
    // ====================================================================== //
    // A 64x64 escape-time thumbnail baked once. OffscreenCanvas is the only
    // offscreen surface the runtime allows; without it the map falls back to a
    // drawn outline, which is plainer but still orients you.
    let mapBake = null;
    const MAP_N = 64;

    function bakeMinimap() {
      let surface = null;
      try {
        if (typeof OffscreenCanvas !== "undefined") surface = new OffscreenCanvas(MAP_N, MAP_N);
      } catch (err) {
        surface = null;
      }
      if (!surface) return null;
      const g = surface.getContext("2d");
      const img = g.createImageData(MAP_N, MAP_N);
      const d = img.data;
      for (let j = 0; j < MAP_N; j++) {
        for (let i = 0; i < MAP_N; i++) {
          const cx = -2.1 + (i / MAP_N) * 3.0;
          const cy = -1.3 + (j / MAP_N) * 2.6;
          let x = 0, y = 0, n = 0;
          for (; n < 48; n++) {
            const xx = x * x, yy = y * y;
            if (xx + yy > 4) break;
            y = 2 * x * y + cy;
            x = xx - yy + cx;
          }
          const o = (j * MAP_N + i) * 4;
          const inside = n >= 48;
          d[o] = inside ? 210 : 40 + n * 2;
          d[o + 1] = inside ? 220 : 46 + n * 2;
          d[o + 2] = inside ? 240 : 60 + n * 3;
          d[o + 3] = inside ? 235 : 120;
        }
      }
      g.putImageData(img, 0, 0);
      return surface;
    }

    // ====================================================================== //
    // UI                                                                     //
    // ====================================================================== //
    const ui = ctx.createRoot({
      style: {
        pointerEvents: "none",
        fontFamily: "ui-rounded, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        color: "#eef2ff",
        userSelect: "none",
        webkitUserSelect: "none"
      }
    });

    // Literal tag names only: the upload validator rejects a computed
    // document.createElement, since it cannot see what is being made.
    function el(tag, style, text) {
      const node = tag === "button" ? document.createElement("button")
                                    : document.createElement("div");
      if (style) Object.assign(node.style, style);
      if (text != null) node.textContent = text;
      return node;
    }

    const safeTop = (ctx.safeArea && ctx.safeArea.top) || 0;
    const safeBottom = (ctx.safeArea && ctx.safeArea.bottom) || 0;

    const hud = el("div", {
      position: "absolute",
      left: "16px",
      top: (safeTop + 14) + "px",
      pointerEvents: "none",
      textShadow: "0 1px 12px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.7)"
    });
    const levelLine = el("div", {
      fontSize: "26px",
      fontWeight: "700",
      letterSpacing: "0.06em",
      lineHeight: "1.05"
    }, "LEVEL 0");
    const magLine = el("div", {
      fontSize: "12px",
      opacity: "0.72",
      letterSpacing: "0.14em",
      marginTop: "3px",
      fontVariantNumeric: "tabular-nums"
    }, "×1.0");
    hud.appendChild(levelLine);
    hud.appendChild(magLine);
    ui.appendChild(hud);

    const progress = el("div", {
      position: "absolute",
      left: "0",
      top: "0",
      height: "2px",
      width: "0%",
      background: "linear-gradient(90deg, rgba(255,220,150,0.0), rgba(255,222,160,0.95))",
      transition: "opacity 240ms linear",
      opacity: "0",
      pointerEvents: "none"
    });
    ui.appendChild(progress);

    const buttonCol = el("div", {
      position: "absolute",
      right: "12px",
      top: "50%",
      transform: "translateY(-50%)",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      pointerEvents: "none"
    });
    ui.appendChild(buttonCol);

    function makeButton(label, title, onTap) {
      const b = el("button", {
        pointerEvents: "auto",
        width: "44px",
        height: "44px",
        borderRadius: "22px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(12,14,24,0.46)",
        backdropFilter: "blur(8px)",
        webkitBackdropFilter: "blur(8px)",
        color: "#eef2ff",
        fontSize: "17px",
        lineHeight: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: "0",
        touchAction: "manipulation"
      }, label);
      b.setAttribute("aria-label", title);
      ctx.listen(b, "click", (e) => {
        e.stopPropagation();
        audioBoot();
        ctx.platform.haptic("light");
        onTap(b);
      });
      buttonCol.appendChild(b);
      return b;
    }

    const paletteBtn = makeButton("◑", "Change colours", () => {
      render.palette = (render.palette + 1) % PALETTES.length;
      render.dirty = true;
      toast(PALETTES[render.palette]);
      saveSettings();
      ctx.platform.interact({ type: "palette", value: PALETTES[render.palette] });
    });
    const soundBtn = makeButton("♪", "Sound on or off", (b) => {
      audio.on = !audio.on;
      b.textContent = audio.on ? "♪" : "♪̸";
      b.style.opacity = audio.on ? "1" : "0.45";
      if (!audio.on) {
        stopOrbitVoice();
        if (audio.music) { try { audio.music.pause(); } catch (err) { /* gone */ } }
        if (audio.noiseGain) audio.noiseGain.gain.value = 0;
      } else if (audio.music) {
        try { audio.music.resume(); } catch (err) { /* gone */ }
      }
      toast(audio.on ? "Sound on" : "Sound off");
      saveSettings();
    });
    const tourBtn = makeButton("✧", "Fly somewhere interesting", () => {
      flyToTour();
    });
    const homeBtn = makeButton("⌂", "Back to the whole set", () => {
      cancelFlight();
      view.cx = { h: -0.6, l: 0 };
      view.cy = { h: 0, l: 0 };
      view.span = BASE_SPAN;
      view.rot = 0;
      render.dirty = true;
      toast("The whole set");
      ctx.platform.interact({ type: "home" });
    });
    const helpBtn = makeButton("?", "How to play", () => {
      showPanel(true);
    });

    // Toast
    const toastNode = el("div", {
      position: "absolute",
      left: "50%",
      top: (safeTop + 74) + "px",
      transform: "translateX(-50%)",
      padding: "7px 14px",
      borderRadius: "16px",
      background: "rgba(10,12,20,0.6)",
      border: "1px solid rgba(255,255,255,0.14)",
      fontSize: "13px",
      letterSpacing: "0.04em",
      opacity: "0",
      transition: "opacity 260ms ease",
      pointerEvents: "none",
      whiteSpace: "nowrap"
    }, "");
    ui.appendChild(toastNode);
    let toastTimer = 0;
    function toast(msg) {
      toastNode.textContent = msg;
      toastNode.style.opacity = "1";
      toastTimer = 1400;
    }

    // Instructions
    const panel = el("div", {
      position: "absolute",
      inset: "0",
      background: "rgba(4,6,12,0.72)",
      backdropFilter: "blur(6px)",
      webkitBackdropFilter: "blur(6px)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "auto",
      padding: "24px"
    });
    const card = el("div", {
      maxWidth: "330px",
      width: "100%",
      background: "rgba(14,17,28,0.9)",
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: "18px",
      padding: "20px 20px 16px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.55)"
    });
    card.appendChild(el("div", {
      fontSize: "19px", fontWeight: "700", marginBottom: "4px", letterSpacing: "0.02em"
    }, "Mandelbrot"));
    card.appendChild(el("div", {
      fontSize: "13px", opacity: "0.66", marginBottom: "14px", lineHeight: "1.45"
    }, "Every zoom reveals another level of complexity. There are 68 of them."));
    const list = el("div", { fontSize: "14px", lineHeight: "1.75", opacity: "0.92" });
    for (const line of [
      "👌  Pinch to zoom. Twist to rotate.",
      "👆  Drag to move around.",
      "⚡  Double-tap to dive in.",
      "🎧  Press and hold to hear a point sing — then slide to play it.",
      "✧  Not sure where to go? Tap ✧ for a guided dive.",
      "⌂  Tap ⌂ to come back up for air."
    ]) {
      list.appendChild(el("div", { marginBottom: "2px" }, line));
    }
    card.appendChild(list);
    const goBtn = el("button", {
      marginTop: "16px",
      width: "100%",
      padding: "12px",
      borderRadius: "12px",
      border: "none",
      background: "linear-gradient(180deg, #f4dfae, #d9b877)",
      color: "#20160a",
      fontSize: "15px",
      fontWeight: "700",
      cursor: "pointer",
      touchAction: "manipulation"
    }, "Dive in");
    card.appendChild(goBtn);
    panel.appendChild(card);
    ui.appendChild(panel);
    ctx.listen(goBtn, "click", (e) => { e.stopPropagation(); showPanel(false); audioBoot(); });
    ctx.listen(panel, "click", (e) => { e.stopPropagation(); showPanel(false); audioBoot(); });

    function showPanel(on) {
      panel.style.display = on ? "flex" : "none";
    }

    // ====================================================================== //
    // Settings and records                                                   //
    // ====================================================================== //
    let bestLevel = 0;
    let submittedLevel = 0;

    async function loadSettings() {
      if (!(ctx.capabilities && ctx.capabilities.storage)) return null;
      try {
        const s = await ctx.storage.get("settings");
        if (s && typeof s === "object") {
          if (typeof s.palette === "number") render.palette = clamp(s.palette | 0, 0, PALETTES.length - 1);
          if (typeof s.sound === "boolean") audio.on = s.sound;
          if (typeof s.best === "number") bestLevel = s.best;
        }
        return s;
      } catch (err) {
        return null;
      }
    }

    function saveSettings() {
      if (!(ctx.capabilities && ctx.capabilities.storage)) return;
      try {
        ctx.storage.set("settings", {
          palette: render.palette,
          sound: audio.on,
          best: bestLevel,
          seen: true
        });
      } catch (err) { /* storage is a convenience, never a requirement */ }
    }

    function submitDepth(level) {
      if (level <= submittedLevel || level < 4) return;
      submittedLevel = level;
      if (level > bestLevel) { bestLevel = level; saveSettings(); }
      const mag = Math.pow(2, level);
      try {
        ctx.memory.record("deepest_level").submit(level, {
          label: "×" + mag.toExponential(1).replace("e+", "e")
        });
      } catch (err) { /* leaderboard is optional */ }
    }

    // ====================================================================== //
    // Gestures                                                               //
    // ====================================================================== //
    const pointers = new Map();
    let lastPinch = null;
    let holdTimer = 0;
    let listening = false;
    let listenPoint = null;
    let lastTapTime = 0, lastTapX = 0, lastTapY = 0;
    let started = false;
    let zoomVel = 0;
    let flight = null;

    // Pointer coordinates are converted to GL space (y up) on the way in, so
    // every bit of view maths below matches the shader's frame.
    const evX = (e) => e.offsetX;
    const evY = (e) => ctx.height - e.offsetY;

    function onDown(e) {
      e.preventDefault();
      audioBoot();
      if (!started) { started = true; ctx.platform.start(); }
      cancelFlight();
      try { inputSurface.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }
      const x = evX(e), y = evY(e);
      pointers.set(e.pointerId, { x, y, x0: x, y0: y, t0: Date.now(), moved: false });
      if (pointers.size === 1) {
        holdTimer = 260;
      } else {
        holdTimer = 0;
        if (listening) endListen();
        lastPinch = pinchState();
      }
    }

    function pinchState() {
      const pts = [...pointers.values()];
      if (pts.length < 2) return null;
      const [a, b] = pts;
      return {
        cx: (a.x + b.x) * 0.5,
        cy: (a.y + b.y) * 0.5,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        ang: Math.atan2(b.y - a.y, b.x - a.x)
      };
    }

    function onMove(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const x = evX(e), y = evY(e);
      const dx = x - p.x, dy = y - p.y;
      p.x = x; p.y = y;
      if (Math.hypot(x - p.x0, y - p.y0) > 9) p.moved = true;

      if (listening && pointers.size === 1) {
        setListenPoint(x, y);
        return;
      }
      if (pointers.size === 1) {
        if (p.moved) {
          holdTimer = 0;
          panPixels(dx, dy, W, H);
          render.dirty = true;
        }
      } else if (pointers.size >= 2) {
        const now = pinchState();
        if (now && lastPinch) {
          if (lastPinch.dist > 8 && now.dist > 8) {
            const f = now.dist / lastPinch.dist;
            zoomVel = lerp(zoomVel, Math.log2(f) * 60, 0.4);
            zoomAbout(now.cx, now.cy, f, W, H);
          }
          panPixels(now.cx - lastPinch.cx, now.cy - lastPinch.cy, W, H);
          let dA = now.ang - lastPinch.ang;
          while (dA > Math.PI) dA -= TAU;
          while (dA < -Math.PI) dA += TAU;
          // Deadzone: a pinch is never perfectly parallel, and unrequested
          // rotation on every zoom feels broken rather than free.
          if (Math.abs(dA) > 0.012) view.rot += (dA > 0 ? dA - 0.012 : dA + 0.012);
          render.dirty = true;
        }
        lastPinch = now;
      }
    }

    function onUp(e) {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      try { inputSurface.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
      if (listening && pointers.size === 0) endListen();
      lastPinch = pinchState();
      if (pointers.size < 2) zoomVel = 0;
      if (!p) return;
      holdTimer = 0;
      const dt = Date.now() - p.t0;
      if (!p.moved && dt < 300 && !listening) {
        const now = Date.now();
        if (now - lastTapTime < 320 && Math.hypot(p.x - lastTapX, p.y - lastTapY) < 44) {
          lastTapTime = 0;
          startFlight(p.x, p.y, 4.5, 520);
          ctx.platform.haptic("medium");
          ctx.platform.interact({ type: "double_tap_zoom" });
        } else {
          lastTapTime = now;
          lastTapX = p.x; lastTapY = p.y;
        }
      }
    }

    function beginListen() {
      const p = [...pointers.values()][0];
      if (!p) return;
      listening = true;
      ctx.platform.haptic("medium");
      setListenPoint(p.x, p.y);
      ctx.platform.interact({ type: "listen" });
    }

    function endListen() {
      listening = false;
      listenPoint = null;
      stopOrbitVoice();
    }

    function setListenPoint(px, py) {
      const s = view.span / Math.min(W, H);
      const ox = px - W * 0.5, oy = py - H * 0.5;
      const co = Math.cos(view.rot), si = Math.sin(view.rot);
      const cx = view.cx.h + (co * ox - si * oy) * s;
      const cy = view.cy.h + (si * ox + co * oy) * s;
      listenPoint = { px, py, cx, cy };
      playOrbitVoice(cx, cy, px, W);
    }

    ctx.listen(inputSurface, "pointerdown", onDown, { passive: false });
    ctx.listen(inputSurface, "pointermove", onMove, { passive: false });
    ctx.listen(inputSurface, "pointerup", onUp);
    ctx.listen(inputSurface, "pointercancel", onUp);
    // Desktop courtesy; phones never see it.
    ctx.listen(inputSurface, "wheel", (e) => {
      e.preventDefault();
      audioBoot();
      cancelFlight();
      zoomAbout(evX(e), ctx.height - e.offsetY, Math.pow(2, -e.deltaY * 0.0022), W, H);
      render.dirty = true;
    }, { passive: false });

    // ====================================================================== //
    // Flights (double-tap dive and guided tour)                              //
    // ====================================================================== //
    function startFlight(px, py, factor, ms, target) {
      flight = {
        px, py, factor, ms, t: 0,
        target: target || null,
        fromSpan: view.span,
        fromCx: view.cx, fromCy: view.cy
      };
    }

    function cancelFlight() {
      flight = null;
    }

    let tourIndex = -1;
    function flyToTour() {
      tourIndex = (tourIndex + 1) % TOUR.length;
      const t = TOUR[tourIndex];
      const tx = { h: t.cx[0], l: t.cx[1] };
      const ty = { h: t.cy[0], l: t.cy[1] };
      const targetSpan = BASE_SPAN / Math.pow(2, t.level);
      flight = {
        t: 0,
        ms: 5200,
        tour: true,
        fromCx: view.cx, fromCy: view.cy, fromSpan: view.span,
        toCx: tx, toCy: ty, toSpan: targetSpan
      };
      toast(t.name);
      ctx.platform.interact({ type: "tour", value: t.name });
      ctx.platform.emit("tour_start", { name: t.name, level: t.level });
    }

    function stepFlight(dt) {
      if (!flight) return;
      flight.t += dt;
      const u = clamp(flight.t / flight.ms, 0, 1);
      if (flight.tour) {
        // Interpolate the centre linearly but the span geometrically: constant
        // apparent zoom speed is what makes a dive feel smooth rather than
        // slamming at the end.
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const lgFrom = Math.log(flight.fromSpan), lgTo = Math.log(flight.toSpan);
        view.span = Math.exp(lerp(lgFrom, lgTo, e));
        ddAdd(flight.toCx.h, flight.toCx.l, -flight.fromCx.h, -flight.fromCx.l);
        const dxh = _h, dxl = _l;
        ddMul(dxh, dxl, e, 0);
        ddAdd(flight.fromCx.h, flight.fromCx.l, _h, _l);
        view.cx = { h: _h, l: _l };
        ddAdd(flight.toCy.h, flight.toCy.l, -flight.fromCy.h, -flight.fromCy.l);
        const dyh = _h, dyl = _l;
        ddMul(dyh, dyl, e, 0);
        ddAdd(flight.fromCy.h, flight.fromCy.l, _h, _l);
        view.cy = { h: _h, l: _l };
        view.rot = lerp(view.rot, 0, dt / 900);
      } else {
        const prev = flight.applied || 1;
        const e = 1 - Math.pow(1 - u, 3);
        const want = Math.pow(flight.factor, e);
        zoomAbout(flight.px, flight.py, want / prev, W, H);
        flight.applied = want;
      }
      render.dirty = true;
      if (u >= 1) flight = null;
    }

    // ====================================================================== //
    // Overlay drawing                                                        //
    // ====================================================================== //
    function drawOverlay() {
      const w = ctx.width, h = ctx.height;
      ov.clearRect(0, 0, w, h);

      // Minimap
      const size = 76;
      const mx = w - size - 14, my = safeTop + 14;
      ov.save();
      ov.globalAlpha = 0.9;
      ov.fillStyle = "rgba(8,10,18,0.5)";
      ov.strokeStyle = "rgba(255,255,255,0.18)";
      ov.lineWidth = 1;
      ov.beginPath();
      if (ov.roundRect) ov.roundRect(mx, my, size, size, 10);
      else ov.rect(mx, my, size, size);
      ov.fill();
      ov.stroke();
      ov.save();
      ov.beginPath();
      if (ov.roundRect) ov.roundRect(mx, my, size, size, 10);
      else ov.rect(mx, my, size, size);
      ov.clip();
      if (mapBake) {
        ov.globalAlpha = 0.75;
        ov.drawImage(mapBake, mx, my, size, size);
      } else {
        // No OffscreenCanvas: a drawn silhouette still says where you are.
        ov.globalAlpha = 0.6;
        ov.fillStyle = "rgba(220,228,255,0.75)";
        ov.beginPath();
        ov.ellipse(mx + size * 0.46, my + size * 0.5, size * 0.2, size * 0.24, 0, 0, TAU);
        ov.fill();
        ov.beginPath();
        ov.arc(mx + size * 0.2, my + size * 0.5, size * 0.1, 0, TAU);
        ov.fill();
      }
      // Where the view sits inside the whole set
      const px = mx + ((view.cx.h + 2.1) / 3.0) * size;
      const py = my + ((view.cy.h + 1.3) / 2.6) * size;
      ov.globalAlpha = 1;
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.005);
      ov.strokeStyle = "rgba(255,226,160,0.95)";
      ov.lineWidth = 1.5;
      ov.beginPath();
      ov.arc(px, py, 3 + pulse * 2.5, 0, TAU);
      ov.stroke();
      ov.fillStyle = "rgba(255,236,190,0.95)";
      ov.beginPath();
      ov.arc(px, py, 1.6, 0, TAU);
      ov.fill();

      // The orbit of the point you are listening to, drawn where it actually
      // goes: over the whole set, not the current view.
      if (listening && listenPoint) {
        const orb = orbitOf(listenPoint.cx, listenPoint.cy, 220, 0);
        ov.strokeStyle = "rgba(150,220,255,0.85)";
        ov.lineWidth = 1;
        ov.beginPath();
        let drawn = 0;
        for (let i = 0; i < 220; i++) {
          if (orb.escaped >= 0 && i > orb.escaped) break;
          const ox = mx + ((orb.xs[i] + 2.1) / 3.0) * size;
          const oy = my + ((orb.ys[i] + 1.3) / 2.6) * size;
          if (drawn === 0) ov.moveTo(ox, oy); else ov.lineTo(ox, oy);
          drawn++;
        }
        ov.stroke();
      }
      ov.restore();
      ov.restore();

      // Listen ring under the finger
      if (listening && listenPoint) {
        const lx = listenPoint.px, ly = h - listenPoint.py;
        const t = Date.now() * 0.004;
        ov.save();
        for (let i = 0; i < 3; i++) {
          const r = 26 + i * 13 + Math.sin(t + i) * 4;
          ov.strokeStyle = "rgba(160,225,255," + (0.34 - i * 0.09) + ")";
          ov.lineWidth = 1.4;
          ov.beginPath();
          ov.arc(lx, ly, r, 0, TAU);
          ov.stroke();
        }
        ov.restore();
      }
    }

    // ====================================================================== //
    // Frame loop                                                             //
    // ====================================================================== //
    let firstFrameDone = false;
    let lastLevelBell = 0;
    let frameAvg = 16;

    function frame(dt) {
      dt = Math.min(dt || 16, 64);
      frameAvg = lerp(frameAvg, dt, 0.08);

      if (holdTimer > 0) {
        holdTimer -= dt;
        if (holdTimer <= 0 && pointers.size === 1) beginListen();
      }
      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) toastNode.style.opacity = "0";
      }

      stepFlight(dt);

      // Between settles there is no measurement, so ride the measured growth
      // law (escape times go like 2^(level/10)) to keep the preview budget from
      // falling behind a fast dive.
      const lvNow = levelOf(magnification());
      if (Math.abs(lvNow - lastProbeLevel) > 0.01) {
        probedIter = clamp(probedIter * Math.pow(2, (lvNow - lastProbeLevel) / 10), 220, ITER_CAP);
        lastProbeLevel = lvNow;
      }

      const interacting = pointers.size > 0 || !!flight;
      if (interacting) render.dirty = true;

      if (gl) {
        ensureTargets();
        if (render.dirty) {
          drawPreview();
          render.settled = false;
          render.refining = false;
          render.bandIndex = 0;
          render.pass = 0;
          render.idleFrames = 0;
          render.dirty = false;
        } else if (!interacting && (!render.settled || render.refining)) {
          render.idleFrames++;
          if (!render.refining && render.idleFrames > 3) {
            // Scale band count to what this device actually manages, so a slow
            // phone gets more, smaller bands instead of dropped frames.
            render.bands = clamp(Math.round(render.bands * (frameAvg / 22)), 6, 64);
            startRefine();
          } else if (render.refining) {
            refineBand();
          }
        }
        present();
      } else {
        if (render.dirty) { cpu.row = 0; cpu.done = false; render.dirty = false; }
        if (!cpu.done) { cpuStep(interacting ? 8 : 14); cpuPresent(); }
      }

      drawOverlay();

      // HUD
      const mag = magnification();
      const level = Math.max(0, Math.floor(levelOf(mag)));
      levelLine.textContent = "LEVEL " + level;
      magLine.textContent = "×" + (mag < 1000 ? mag.toFixed(1) : mag.toExponential(1).replace("e+", "e"));
      if (level !== lastLevelBell) {
        if (level > lastLevelBell) {
          levelBell(level);
          ctx.platform.haptic("light");
          if (level % 10 === 0) ctx.platform.milestone("level_" + level);
        }
        lastLevelBell = level;
        ctx.platform.setScore(level);
        ctx.platform.setProgress(clamp(level / MAX_LEVEL, 0, 1));
      }
      updateAudioDepth(level, zoomVel);
      if (!interacting) {
        zoomVel = lerp(zoomVel, 0, 0.12);
        if (render.settled) submitDepth(level);
      }

      if (gl && (render.refining || !render.settled)) {
        progress.style.opacity = "0.9";
        const doneBands = render.pass * render.bands + render.bandIndex;
        progress.style.width = Math.round((doneBands / (render.bands * 2)) * 100) + "%";
      } else {
        progress.style.opacity = "0";
      }

      if (!firstFrameDone) {
        firstFrameDone = true;
        ctx.markVisualReady("first_render");
        ctx.platform.ready();
      }
    }

    // ====================================================================== //
    // Boot                                                                   //
    // ====================================================================== //
    mapBake = bakeMinimap();
    const saved = await loadSettings();
    soundBtn.textContent = audio.on ? "♪" : "♪̸";
    soundBtn.style.opacity = audio.on ? "1" : "0.45";
    if (!saved || !saved.seen) {
      showPanel(true);
      saveSettings();
    }

    if (gl) {
      ensureTargets();
      drawPreview();
      present();
    } else {
      cpuEnsure();
      cpuStep(30);
      cpuPresent();
    }
    drawOverlay();

    ctx.onDestroy(() => {
      stopOrbitVoice();
      if (audio.music) { try { audio.music.stop({ fadeOutMs: 400 }); } catch (err) { /* gone */ } }
      if (audio.actx) { try { audio.actx.close(); } catch (err) { /* gone */ } }
    });

    ctx.onFrame(frame);
  }
};
