// Boids — a murmuration you can scare or seduce with one finger.
//
// Thousands of birds run Reynolds' three rules (separation, alignment,
// cohesion) against a spatial hash, so neighbour lookups stay O(n) instead of
// O(n²) and a mid-range phone can carry a few thousand of them at 60fps.
//
// Two things turn a flocking demo into a murmuration. The first is panic
// contagion: fear is a value each bird holds, and every frame a bird inherits
// its most frightened neighbour's fear minus a little. Startle one bird and the
// alarm travels outward as a visible wave, long after the thing that caused it
// is gone. The second is the roost — a point that wanders on summed sines and
// pulls only when the flock strays too far, so the swarm stays a body that
// drifts rather than a gas that fills the screen.
//
// Colour is the flock's own heading, mapped through six luminous anchors. That
// makes alignment legible: birds flying together *are* the same colour, so you
// watch coherent domains form, shear apart and mix. Depth (a per-bird z) sets
// width, brightness and haze, and fear brightens toward white — so a scatter
// reads as a flash travelling through the body of the flock.
//
// Everything is procedural: no dependencies, no packaged assets, no images. The
// canvas never clears — it erases toward transparency each frame, so trails
// decay over a CSS sky and dense clusters bloom on their own under additive
// blending.

window.plethoraBit = {
  meta: {
    title: "Boids",
    runtime: "plethora-bit@2",
    tags: ["boids", "flocking", "murmuration", "generative", "art", "simulation", "sensory", "relaxing"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ---- helpers -----------------------------------------------------------
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const TAU = Math.PI * 2;
    const FONT = "-apple-system,system-ui,Segoe UI,Roboto,sans-serif";

    function el(kind, style, text) {
      // Literal tags only. A computed tag can't be statically shown not to be a
      // canvas or script, and the upload validator rejects it.
      const node = kind === "button" ? document.createElement("button") : document.createElement("div");
      if (style) Object.assign(node.style, style);
      if (text != null) node.textContent = text;
      return node;
    }

    // ---- surfaces ----------------------------------------------------------
    // Sky sits behind the canvas so trails can fade to *transparent* rather than
    // to a flat fill. Fading with destination-out avoids the residue floor you
    // get from repeatedly alpha-blending a dark colour over itself, and it means
    // the gradient below stays a true gradient instead of banding.
    //
    // Style both roots by mutating the returned elements. A `style` object
    // passed to createRoot does nothing, and that failure is vicious: the UI
    // root keeps pointer-events:auto, becomes a transparent sheet over the
    // canvas, and swallows every touch while the simulation carries on looking
    // perfectly healthy.
    const sky = ctx.createRoot();
    sky.style.background =
      "radial-gradient(90% 45% at 50% 106%, rgba(255,146,86,0.17), rgba(255,146,86,0) 68%)," +
      "radial-gradient(130% 95% at 50% 4%, #16204a 0%, #0b1029 40%, #05070f 76%, #02030a 100%)";

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    canvas.style.touchAction = "none"; // belt and braces; the option is enough on device
    const g = canvas.getContext("2d");
    g.lineCap = "round";
    g.lineJoin = "round";

    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none"; // let touches through to the canvas below

    // ---- world scale -------------------------------------------------------
    let W = ctx.width;
    let H = ctx.height;
    let S = clamp(Math.min(W, H) / 390, 0.78, 2.4); // 390 = reference phone width

    // Flocking constants, all in CSS pixels per second, scaled so the flock
    // feels the same on a small phone and a tablet.
    let PERCEPT = 30 * S;   // neighbour radius, also the spatial-hash cell size
    let SEP_R = 11 * S;     // personal space
    let MAX_SPEED = 122 * S;
    let MIN_SPEED = 54 * S; // birds must keep flying
    let MAX_FORCE = 300 * S;
    let TOUCH_R = 132 * S;   // predator influence radius
    let ATTRACT_R = 290 * S; // attractor reaches much further than it pushes
    let ORBIT = 66 * S;      // radius the vortex settles at

    // Separation is applied as raw acceleration rather than as a normalized
    // Reynolds steer. A normalized push has the same strength whether a bird
    // has one neighbour or forty, which is exactly how boids demos end up as a
    // single dense knot — cohesion wins the moment the flock tightens. Scaling
    // it with crowding gives the flock a resting density instead.
    const SEP_ACC = 1.15;   // × MAX_FORCE, per unit of accumulated crowding
    const SEP_CAP = 4;      // × MAX_FORCE, ceiling on the separation term
    const ALI_W = 1.05;
    const COH_W = 0.72;
    const MAX_NEIGH = 32;   // rarely reached at the flock's resting density

    function rescale() {
      S = clamp(Math.min(W, H) / 390, 0.78, 2.4);
      PERCEPT = 30 * S;
      SEP_R = 11 * S;
      MAX_SPEED = 122 * S;
      MIN_SPEED = 54 * S;
      MAX_FORCE = 300 * S;
      TOUCH_R = 132 * S;
      ATTRACT_R = 290 * S;
      ORBIT = 66 * S;
    }

    // Population scales with screen area and stays in the thousands.
    const MAX_N = Math.round(clamp((W * H) / 135, 1600, 4000));
    let activeN = MAX_N; // trimmed by the perf guard on weak devices

    // ---- bird state (structure of arrays; no per-bird objects, no GC) ------
    const px = new Float32Array(MAX_N);
    const py = new Float32Array(MAX_N);
    const vx = new Float32Array(MAX_N);
    const vy = new Float32Array(MAX_N);
    const pz = new Float32Array(MAX_N);   // depth 0..1
    let fear = new Float32Array(MAX_N);
    let fearNext = new Float32Array(MAX_N);

    for (let i = 0; i < MAX_N; i++) {
      px[i] = Math.random() * W;
      py[i] = Math.random() * H;
      const a = Math.random() * TAU;
      const sp = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
      vx[i] = Math.cos(a) * sp;
      vy[i] = Math.sin(a) * sp;
      pz[i] = Math.random();
    }

    // ---- spatial hash ------------------------------------------------------
    // Rebuilt every frame by counting sort: O(n), zero allocation, and the
    // 3×3 cell scan around each bird replaces the O(n²) all-pairs loop.
    let cols = 0;
    let rows = 0;
    let cellStart = new Int32Array(1);
    let cellCursor = new Int32Array(1);
    const cellItems = new Int32Array(MAX_N);
    const cellOf = new Int32Array(MAX_N);

    function sizeGrid() {
      cols = Math.max(1, Math.ceil(W / PERCEPT));
      rows = Math.max(1, Math.ceil(H / PERCEPT));
      const n = cols * rows;
      if (cellStart.length < n + 1) {
        cellStart = new Int32Array(n + 1);
        cellCursor = new Int32Array(n);
      }
    }
    sizeGrid();

    function buildGrid() {
      const n = cols * rows;
      cellStart.fill(0, 0, n + 1);
      for (let i = 0; i < activeN; i++) {
        let cx = (px[i] / PERCEPT) | 0;
        let cy = (py[i] / PERCEPT) | 0;
        if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
        if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
        const c = cy * cols + cx;
        cellOf[i] = c;
        cellStart[c + 1]++;
      }
      for (let c = 0; c < n; c++) cellStart[c + 1] += cellStart[c];
      for (let c = 0; c < n; c++) cellCursor[c] = cellStart[c];
      for (let i = 0; i < activeN; i++) cellItems[cellCursor[cellOf[i]]++] = i;
    }

    // ---- finger ------------------------------------------------------------
    // Multi-touch: every live pointer is its own predator or attractor.
    const MODE_PREDATOR = 0;
    const MODE_ATTRACTOR = 1;
    let mode = MODE_PREDATOR;

    const pointers = new Map(); // pointerId -> { x, y }
    const waves = [];           // expanding shockwave rings

    // ---- roost -------------------------------------------------------------
    // A wandering centre of gravity. It only pulls once the flock strays past
    // ROOST_R, which keeps a drifting body instead of a screen-filling gas.
    let roostT = Math.random() * 100;
    let roostX = W * 0.5;
    let roostY = H * 0.47;
    const ROOST_R = 0.72; // in screen-normalized units, so ~the whole frame

    // ---- palette -----------------------------------------------------------
    // Heading -> colour, cycled through six luminous anchors so the wrap is
    // smooth. Three brightness levels per hue: calm, fast, and frightened.
    const ANCHORS = [
      [92, 225, 255],   // cyan
      [123, 123, 255],  // indigo
      [200, 107, 255],  // violet
      [255, 111, 174],  // rose
      [255, 171, 92],   // amber
      [111, 227, 184]   // teal
    ];
    const HUES = 24;
    const LEVELS = 3;
    const TIERS = 3; // depth tiers, drawn as three passes
    const NB = TIERS * HUES * LEVELS;

    const colorCss = new Array(HUES * LEVELS);
    for (let h = 0; h < HUES; h++) {
      const t = (h / HUES) * ANCHORS.length;
      const i0 = Math.floor(t) % ANCHORS.length;
      const i1 = (i0 + 1) % ANCHORS.length;
      const f = t - Math.floor(t);
      const a = ANCHORS[i0];
      const b = ANCHORS[i1];
      const r = a[0] + (b[0] - a[0]) * f;
      const gg = a[1] + (b[1] - a[1]) * f;
      const bb = a[2] + (b[2] - a[2]) * f;
      for (let l = 0; l < LEVELS; l++) {
        let cr;
        let cg;
        let cb;
        if (l === 0) {          // calm: dimmer, lets dense areas bloom instead
          cr = r * 0.6; cg = gg * 0.6; cb = bb * 0.6;
        } else if (l === 1) {   // moving fast
          cr = r; cg = gg; cb = bb;
        } else {                // frightened: hot, but still its own hue —
          cr = r + (255 - r) * 0.42;   // going full white loses the flock's
          cg = gg + (255 - gg) * 0.42; // colour exactly when it is most alive
          cb = bb + (255 - bb) * 0.42;
        }
        colorCss[h * LEVELS + l] =
          "rgb(" + (cr | 0) + "," + (cg | 0) + "," + (cb | 0) + ")";
      }
    }

    // Additive blending clips wherever birds pile up, and the trail buildup
    // multiplies it — equilibrium brightness is roughly per-frame ink over the
    // fade rate, so both numbers have to stay modest or dense knots go white.
    const tierAlpha = [0.22, 0.39, 0.6];
    const tierWidth = [0.9, 1.5, 2.4];

    // Draw buckets, sorted the same way as the grid: counting sort, no arrays
    // per bucket, so the whole flock is ~150 stroke calls instead of ~3000.
    const bucketStart = new Int32Array(NB + 1);
    const bucketCursor = new Int32Array(NB);
    const bucketItems = new Int32Array(MAX_N);
    const bucketOf = new Int32Array(MAX_N);
    const tailX = new Float32Array(MAX_N);
    const tailY = new Float32Array(MAX_N);

    // ---- audio -------------------------------------------------------------
    // A wind bed whose loudness and brightness follow the flock's mean fear, so
    // a scatter is audible as a rising rush. Music comes from ctx.music.
    const Wind = (() => {
      let ac = null;
      let gain = null;
      let filter = null;
      let ready = false;
      let failed = false;

      function start() {
        if (ready || failed || !ctx.capabilities.audio) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { failed = true; return; }
        try {
          ac = new AC();
          const len = Math.floor(ac.sampleRate * 2);
          const buf = ac.createBuffer(1, len, ac.sampleRate);
          const d = buf.getChannelData(0);
          let last = 0;
          for (let i = 0; i < len; i++) { // brown noise: softer than white
            const w = Math.random() * 2 - 1;
            last = (last + 0.022 * w) / 1.022;
            d[i] = last * 3.4;
          }
          const src = ac.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          filter = ac.createBiquadFilter();
          filter.type = "bandpass";
          filter.frequency.value = 380;
          filter.Q.value = 0.62;
          gain = ac.createGain();
          gain.gain.value = 0;
          src.connect(filter);
          filter.connect(gain);
          gain.connect(ac.destination);
          src.start();
          ready = true;
        } catch (_) {
          failed = true;
        }
      }

      function resume() {
        if (!ac) return;
        try { if (ac.state === "suspended") ac.resume(); } catch (_) {}
      }

      function set(level) {
        if (!ready) return;
        try {
          const now = ac.currentTime;
          gain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.19, now, 0.22);
          filter.frequency.setTargetAtTime(340 + clamp(level, 0, 1) * 900, now, 0.3);
        } catch (_) {}
      }

      ctx.onDestroy(() => { try { if (ac) ac.close(); } catch (_) {} });
      return { start, resume, set };
    })();

    let musicHandle = null;
    let musicTried = false;
    async function startMusic() {
      if (musicTried || !ctx.capabilities.backgroundMusic) return;
      musicTried = true;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "drift",
          volume: 0.42,
          tempo: 68,
          intensity: 0.32,
          density: 0.34,
          scale: "hirajoshi",
          fadeInMs: 2600
        });
      } catch (_) {
        musicHandle = null;
      }
    }
    ctx.onDestroy(() => { try { ctx.music.stop({ fadeOutMs: 900 }); } catch (_) {} });

    // ---- persisted preference ---------------------------------------------
    (async () => {
      if (!ctx.capabilities.storage) return;
      try {
        const saved = await Promise.resolve(ctx.storage.get("boids:v1"));
        if (saved && saved.mode === MODE_ATTRACTOR) setMode(MODE_ATTRACTOR, true);
      } catch (_) {}
    })();

    function save() {
      if (!ctx.capabilities.storage) return;
      try { ctx.storage.set("boids:v1", { mode }); } catch (_) {}
    }

    // ---- simulation --------------------------------------------------------
    let startleIn = 5 + Math.random() * 8;
    let meanFear = 0;

    function startle(x, y, radius, power) {
      const r2 = radius * radius;
      for (let i = 0; i < activeN; i++) {
        const dx = px[i] - x;
        const dy = py[i] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2) || 0.001;
        const f = 1 - d / radius;
        if (f > fear[i]) fear[i] = f;
        const push = power * f * f;
        vx[i] += (dx / d) * push;
        vy[i] += (dy / d) * push;
      }
      waves.push({ x, y, r: radius * 0.18, max: radius * 2.5, life: 1 });
    }

    function step(dt) {
      buildGrid();

      roostT += dt;
      roostX = W * 0.5 + Math.sin(roostT * 0.108) * W * 0.12 + Math.sin(roostT * 0.041 + 1.3) * W * 0.06;
      roostY = H * 0.47 + Math.cos(roostT * 0.086) * H * 0.1 + Math.sin(roostT * 0.035 + 0.6) * H * 0.05;

      const sepR2 = SEP_R * SEP_R;
      const perc2 = PERCEPT * PERCEPT;
      // Wide, hard walls. A gentle edge steer loses to the predator's push and
      // the flock ends up smeared along the bottom of the screen in a bright
      // band — the least flock-like thing it can do.
      const margin = Math.min(W, H) * 0.16;
      const turn = MAX_FORCE * 3.5;

      let fearSum = 0;

      for (let i = 0; i < activeN; i++) {
        const x = px[i];
        const y = py[i];
        const ivx = vx[i];
        const ivy = vy[i];

        let sepX = 0, sepY = 0;
        let aliX = 0, aliY = 0;
        let cohX = 0, cohY = 0;
        let count = 0;
        let loudest = 0; // most frightened neighbour, for panic contagion

        const cx = cellOf[i] % cols;
        const cy = (cellOf[i] / cols) | 0;
        const gx0 = cx > 0 ? cx - 1 : 0;
        const gx1 = cx < cols - 1 ? cx + 1 : cols - 1;
        const gy0 = cy > 0 ? cy - 1 : 0;
        const gy1 = cy < rows - 1 ? cy + 1 : rows - 1;

        scan:
        for (let gy = gy0; gy <= gy1; gy++) {
          const rowBase = gy * cols;
          for (let gx = gx0; gx <= gx1; gx++) {
            const c = rowBase + gx;
            const end = cellStart[c + 1];
            for (let k = cellStart[c]; k < end; k++) {
              const j = cellItems[k];
              if (j === i) continue;
              const dx = px[j] - x;
              const dy = py[j] - y;
              const d2 = dx * dx + dy * dy;
              if (d2 > perc2) continue;

              if (d2 < sepR2 && d2 > 0.0001) {
                // Zero at the edge of personal space, unbounded as d → 0, so a
                // crowd pushes back proportionally to how crowded it is.
                const d = Math.sqrt(d2);
                const push = SEP_R / d - 1;
                sepX -= (dx / d) * push;
                sepY -= (dy / d) * push;
              }
              aliX += vx[j];
              aliY += vy[j];
              cohX += px[j];
              cohY += py[j];
              if (fear[j] > loudest) loudest = fear[j];
              count++;
              if (count >= MAX_NEIGH) break scan;
            }
          }
        }

        // Fear decays on its own but is re-inherited from the worst neighbour,
        // slightly damped — that damping is what makes it a travelling wave
        // rather than either an instant flash or a permanent panic.
        let f = fear[i] - dt * 0.85;
        const caught = loudest * 0.965;
        if (caught > f) f = caught;
        if (f < 0) f = 0; else if (f > 1) f = 1;
        fearNext[i] = f;

        let ax = 0;
        let ay = 0;
        const speedCap = MAX_SPEED * (1 + f * 0.55);

        if (count > 0) {
          const inv = 1 / count;
          // Separation — direct acceleration, capped rather than normalized
          let len = Math.hypot(sepX, sepY);
          if (len > 0) {
            let acc = len * SEP_ACC * MAX_FORCE;
            const ceiling = MAX_FORCE * SEP_CAP;
            if (acc > ceiling) acc = ceiling;
            ax += (sepX / len) * acc;
            ay += (sepY / len) * acc;
          }
          // Alignment
          aliX *= inv; aliY *= inv;
          len = Math.hypot(aliX, aliY);
          if (len > 0) {
            const dx = (aliX / len) * speedCap - ivx;
            const dy = (aliY / len) * speedCap - ivy;
            const dl = Math.hypot(dx, dy);
            const s = dl > MAX_FORCE ? MAX_FORCE / dl : 1;
            ax += dx * s * ALI_W;
            ay += dy * s * ALI_W;
          }
          // Cohesion — fear loosens the flock so it can actually break apart
          cohX = cohX * inv - x;
          cohY = cohY * inv - y;
          len = Math.hypot(cohX, cohY);
          if (len > 0) {
            const w = COH_W * (1 - f * 0.8);
            const dx = (cohX / len) * speedCap - ivx;
            const dy = (cohY / len) * speedCap - ivy;
            const dl = Math.hypot(dx, dy);
            const s = dl > MAX_FORCE ? MAX_FORCE / dl : 1;
            ax += dx * s * w;
            ay += dy * s * w;
          }
        }

        // Roost: silent until the bird strays outside a loose ellipse. Measuring
        // in screen-normalized space rather than pixels is what lets the flock
        // fill a tall phone instead of settling into a circle the width of the
        // short edge.
        const rdx = roostX - x;
        const rdy = roostY - y;
        const enx = rdx / (W * 0.5);
        const eny = rdy / (H * 0.5);
        const ern = Math.hypot(enx, eny);
        if (ern > ROOST_R) {
          const rd = Math.hypot(rdx, rdy) || 1;
          const pull = clamp((ern - ROOST_R) / 0.35, 0, 1) * MAX_FORCE * 1.1;
          ax += (rdx / rd) * pull;
          ay += (rdy / rd) * pull;
        }

        // Finger
        for (const p of pointers.values()) {
          const dx = x - p.x;
          const dy = y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 0.001) continue;

          if (mode === MODE_PREDATOR) {
            if (d > TOUCH_R) continue;
            const fall = 1 - d / TOUCH_R;
            const power = fall * fall * MAX_FORCE * 4.2;
            ax += (dx / d) * power;
            ay += (dy / d) * power;
            const scare = fall * 1.15;
            if (scare > fearNext[i]) fearNext[i] = clamp(scare, 0, 1);
          } else {
            // A well with a floor. The radial term flips sign at ORBIT, and —
            // this is the part that matters — the inward pull reaches far
            // beyond the outward push. Giving both the same radius makes the
            // attractor hollow out a cavity: anything near the centre is
            // expelled past the cutoff and nothing ever draws it back.
            if (d > ATTRACT_R) continue;
            const fall = 1 - d / ATTRACT_R;
            const nx = -dx / d; // toward the finger
            const ny = -dy / d;
            const radial = clamp((d - ORBIT) / ORBIT, -1, 1);
            const swirl = 1 - Math.abs(radial) * 0.45; // strongest on the ring
            const power = MAX_FORCE * (0.55 + fall * 1.5);
            ax += (nx * radial * 1.2 - ny * swirl * 1.25) * power;
            ay += (ny * radial * 1.2 + nx * swirl * 1.25) * power;
          }
        }

        fearSum += fearNext[i]; // after the finger, so the wind hears a scare at once

        // Soft walls: steer back before the edge rather than bounce off it.
        // Quadratic ramp: barely there at the margin, immovable at the glass.
        if (x < margin) { const t = 1 - x / margin; ax += turn * t * t; }
        else if (x > W - margin) { const t = 1 - (W - x) / margin; ax -= turn * t * t; }
        if (y < margin) { const t = 1 - y / margin; ay += turn * t * t; }
        else if (y > H - margin) { const t = 1 - (H - y) / margin; ay -= turn * t * t; }

        let nvx = ivx + ax * dt;
        let nvy = ivy + ay * dt;

        // Depth gives near birds a little more speed, which reads as parallax.
        const zScale = 0.86 + pz[i] * 0.3;
        const lo = MIN_SPEED * zScale;
        const hi = speedCap * zScale;
        const sp = Math.hypot(nvx, nvy);
        if (sp > hi) { const s = hi / sp; nvx *= s; nvy *= s; }
        else if (sp < lo && sp > 0.001) { const s = lo / sp; nvx *= s; nvy *= s; }

        vx[i] = nvx;
        vy[i] = nvy;

        let nx2 = x + nvx * dt;
        let ny2 = y + nvy * dt;
        // Hard clamp only as a backstop; the soft walls do the real work.
        if (nx2 < 0) { nx2 = 0; vx[i] = Math.abs(vx[i]); }
        else if (nx2 > W) { nx2 = W; vx[i] = -Math.abs(vx[i]); }
        if (ny2 < 0) { ny2 = 0; vy[i] = Math.abs(vy[i]); }
        else if (ny2 > H) { ny2 = H; vy[i] = -Math.abs(vy[i]); }
        px[i] = nx2;
        py[i] = ny2;
      }

      const swap = fear;
      fear = fearNext;
      fearNext = swap;
      meanFear = activeN > 0 ? fearSum / activeN : 0;

      // Spontaneous startles keep the flock alive when nobody is touching it.
      startleIn -= dt;
      if (startleIn <= 0 && pointers.size === 0) {
        startleIn = 9 + Math.random() * 13;
        startle(
          W * (0.15 + Math.random() * 0.7),
          H * (0.15 + Math.random() * 0.7),
          Math.min(W, H) * 0.24,
          MAX_SPEED * 0.55
        );
      }

      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.r += (w.max - w.r) * clamp(dt * 2.6, 0, 1);
        w.life -= dt * 0.85;
        if (w.life <= 0) waves.splice(i, 1);
      }
    }

    // ---- drawing -----------------------------------------------------------
    function draw() {
      // Erase toward transparency instead of clearing, so the sky shows through
      // and every bird leaves a decaying trail.
      g.globalCompositeOperation = "destination-out";
      g.globalAlpha = 1;
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(0, 0, W, H);

      g.globalCompositeOperation = "lighter";

      // Bucket by depth tier, hue and brightness so the flock draws in ~150
      // stroke calls. Same counting sort as the grid.
      bucketStart.fill(0);
      const invSpeed = 1 / MAX_SPEED;
      for (let i = 0; i < activeN; i++) {
        const bvx = vx[i];
        const bvy = vy[i];
        const sp = Math.hypot(bvx, bvy);
        const z = pz[i];
        const f = fear[i];

        let ang = Math.atan2(bvy, bvx) / TAU;
        ang -= Math.floor(ang);
        let hue = (ang * HUES) | 0;
        if (hue >= HUES) hue = HUES - 1;

        // Only the genuinely terrified go hot. A low threshold turns the whole
        // flock white the moment a finger touches it and the wave stops reading
        // as a wave.
        const lvl = f > 0.72 ? 2 : (f > 0.3 || sp * invSpeed > 0.9 ? 1 : 0);
        const tier = z < 0.34 ? 0 : (z < 0.7 ? 1 : 2);

        // Streak length tracks speed, so fast birds smear and slow ones dot.
        // Long streaks at this density read as fur rather than as birds.
        const len = clamp(sp * 0.042, 1.8, 7) * (0.7 + z * 0.5) * S;
        const inv = sp > 0.001 ? len / sp : 0;
        tailX[i] = px[i] - bvx * inv;
        tailY[i] = py[i] - bvy * inv;

        const b = (tier * HUES + hue) * LEVELS + lvl;
        bucketOf[i] = b;
        bucketStart[b + 1]++;
      }
      for (let b = 0; b < NB; b++) bucketStart[b + 1] += bucketStart[b];
      for (let b = 0; b < NB; b++) bucketCursor[b] = bucketStart[b];
      for (let i = 0; i < activeN; i++) bucketItems[bucketCursor[bucketOf[i]]++] = i;

      for (let tier = 0; tier < TIERS; tier++) {
        g.globalAlpha = tierAlpha[tier];
        g.lineWidth = tierWidth[tier] * S;
        const base = tier * HUES * LEVELS;
        for (let c = 0; c < HUES * LEVELS; c++) {
          const b = base + c;
          const from = bucketStart[b];
          const to = bucketStart[b + 1];
          if (from === to) continue;
          g.strokeStyle = colorCss[c];
          g.beginPath();
          for (let k = from; k < to; k++) {
            const i = bucketItems[k];
            g.moveTo(tailX[i], tailY[i]);
            g.lineTo(px[i], py[i]);
          }
          g.stroke();
        }
      }

      // Shockwaves
      g.globalAlpha = 1;
      for (const w of waves) {
        const a = clamp(w.life, 0, 1);
        g.strokeStyle = "rgba(150,200,255," + (a * 0.16).toFixed(3) + ")";
        g.lineWidth = 2 * S * a;
        g.beginPath();
        g.arc(w.x, w.y, w.r, 0, TAU);
        g.stroke();
      }

      // Finger. Kept deliberately faint — the birds are the picture, and a
      // bright fill here just becomes a lens flare sitting on top of them.
      for (const p of pointers.values()) {
        if (mode === MODE_PREDATOR) {
          // A halo peaking away from centre, so it reads as a ring of heat
          // rather than a solid red disc.
          const rim = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, TOUCH_R * 0.9);
          rim.addColorStop(0, "rgba(255,90,60,0)");
          rim.addColorStop(0.34, "rgba(255,116,72,0.13)");
          rim.addColorStop(0.55, "rgba(255,72,92,0.06)");
          rim.addColorStop(1, "rgba(255,60,110,0)");
          g.fillStyle = rim;
          g.beginPath();
          g.arc(p.x, p.y, TOUCH_R * 0.9, 0, TAU);
          g.fill();
        } else {
          const glow = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, TOUCH_R * 0.7);
          glow.addColorStop(0, "rgba(150,240,255,0.15)");
          glow.addColorStop(0.35, "rgba(120,170,255,0.06)");
          glow.addColorStop(1, "rgba(110,120,255,0)");
          g.fillStyle = glow;
          g.beginPath();
          g.arc(p.x, p.y, TOUCH_R * 0.7, 0, TAU);
          g.fill();
        }
      }

      // The predator's dark core goes on last, over everything — an eclipse
      // punched through the flock rather than a dot floating above it.
      if (mode === MODE_PREDATOR) {
        g.globalCompositeOperation = "source-over";
        for (const p of pointers.values()) {
          const core = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, TOUCH_R * 0.26);
          core.addColorStop(0, "rgba(2,2,8,0.82)");
          core.addColorStop(0.6, "rgba(4,3,12,0.44)");
          core.addColorStop(1, "rgba(6,4,14,0)");
          g.fillStyle = core;
          g.beginPath();
          g.arc(p.x, p.y, TOUCH_R * 0.26, 0, TAU);
          g.fill();
        }
      }

      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }

    // ---- input -------------------------------------------------------------
    // Pointer events give multi-touch and canvas-relative offsetX/offsetY.
    // Querying the canvas rect for coordinates is rejected by the upload
    // validator, and offset* skips a forced reflow per move anyway.
    let started = false;

    // offsetX/offsetY are already canvas-relative, but they are only meaningful
    // when the event actually landed on the canvas. Fall back to client
    // coordinates rather than silently steering the flock to the wrong place.
    function localX(event) {
      return typeof event.offsetX === "number" ? event.offsetX : event.clientX;
    }
    function localY(event) {
      return typeof event.offsetY === "number" ? event.offsetY : event.clientY;
    }

    function onDown(event) {
      event.preventDefault();
      if (!started) {
        started = true;
        ctx.platform.start();
        Wind.start();
        startMusic();
        hideHint();
      }
      Wind.resume();
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      const x = localX(event);
      const y = localY(event);
      pointers.set(event.pointerId, { x, y });
      if (mode === MODE_PREDATOR) {
        startle(x, y, TOUCH_R * 1.5, MAX_SPEED * 0.5);
        try { ctx.music.duck(0.32, 700); } catch (_) {}
      }
      ctx.platform.haptic("light");
      ctx.platform.interact({ type: mode === MODE_PREDATOR ? "scatter" : "gather" });
    }

    function onMove(event) {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      event.preventDefault();
      p.x = localX(event);
      p.y = localY(event);
    }

    function onUp(event) {
      pointers.delete(event.pointerId);
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
    }

    ctx.listen(canvas, "pointerdown", onDown, { passive: false });
    ctx.listen(canvas, "pointermove", onMove, { passive: false });
    ctx.listen(canvas, "pointerup", onUp);
    ctx.listen(canvas, "pointercancel", onUp);

    // ---- interface ---------------------------------------------------------
    const top = (ctx.safeArea && ctx.safeArea.top ? ctx.safeArea.top : 0) + 14;

    // Vignette goes in first so the controls sit above it, not under its
    // darkest corner.
    ui.appendChild(el("div", {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      background: "radial-gradient(118% 84% at 50% 44%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.62) 100%)"
    }));

    const bar = el("div", {
      position: "absolute",
      top: top + "px",
      right: "14px",
      display: "flex",
      gap: "10px",
      pointerEvents: "auto"
    });
    ui.appendChild(bar);

    const BTN = {
      width: "44px",
      height: "44px",
      borderRadius: "22px",
      border: "1px solid rgba(255,255,255,0.18)",
      // Opaque enough to stay legible when the flock streams behind it.
      background: "rgba(10,14,30,0.66)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      color: "rgba(233,240,255,0.92)",
      font: "600 17px " + FONT,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      padding: "0",
      WebkitBackdropFilter: "blur(8px)",
      backdropFilter: "blur(8px)",
      WebkitTapHighlightColor: "transparent"
    };

    const modeBtn = el("button", BTN, "🦅");
    modeBtn.setAttribute("aria-label", "Switch finger mode");
    const helpBtn = el("button", BTN, "?");
    helpBtn.setAttribute("aria-label", "How it works");
    bar.appendChild(modeBtn);
    bar.appendChild(helpBtn);

    const toast = el("div", {
      position: "absolute",
      top: (top + 58) + "px",
      right: "14px",
      padding: "7px 13px",
      borderRadius: "13px",
      background: "rgba(12,16,34,0.55)",
      border: "1px solid rgba(255,255,255,0.12)",
      color: "rgba(226,236,255,0.95)",
      font: "500 13px " + FONT,
      opacity: "0",
      transition: "opacity 260ms ease",
      WebkitBackdropFilter: "blur(8px)",
      backdropFilter: "blur(8px)"
    }, "");
    ui.appendChild(toast);

    // ctx.timeout owns its handle, so a stale timer is retired with a token
    // rather than cancelled — otherwise a fast double-tap would let the first
    // timer hide the second toast early.
    let toastToken = 0;
    function flash(text) {
      toast.textContent = text;
      toast.style.opacity = "1";
      const mine = ++toastToken;
      ctx.timeout(() => {
        if (mine === toastToken) toast.style.opacity = "0";
      }, 1400);
    }

    // Low on the frame: the flock now fills the middle, and a label across it
    // is unreadable over its own trails.
    const hint = el("div", {
      position: "absolute",
      left: "0",
      right: "0",
      bottom: ((ctx.safeArea && ctx.safeArea.bottom ? ctx.safeArea.bottom : 0) + 30) + "px",
      textAlign: "center",
      color: "rgba(214,230,255,0.62)",
      font: "500 15px " + FONT,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      transition: "opacity 900ms ease",
      textShadow: "0 0 22px rgba(90,140,255,0.5)"
    }, "drag through the flock");
    ui.appendChild(hint);

    function hideHint() {
      hint.style.opacity = "0";
    }

    function setMode(next, quiet) {
      mode = next;
      modeBtn.textContent = mode === MODE_PREDATOR ? "🦅" : "✨";
      if (!quiet) flash(mode === MODE_PREDATOR ? "Predator" : "Attractor");
    }

    ctx.listen(modeBtn, "click", () => {
      setMode(mode === MODE_PREDATOR ? MODE_ATTRACTOR : MODE_PREDATOR);
      ctx.platform.haptic("medium");
      ctx.platform.interact({ type: "mode", mode: mode === MODE_PREDATOR ? "predator" : "attractor" });
      try { ctx.music.sting("tap"); } catch (_) {}
      save();
    });

    // Help sheet
    const scrim = el("div", {
      position: "absolute",
      inset: "0",
      background: "rgba(3,5,14,0.72)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      padding: "26px",
      pointerEvents: "auto",
      WebkitBackdropFilter: "blur(6px)",
      backdropFilter: "blur(6px)"
    });
    const sheet = el("div", {
      maxWidth: "330px",
      width: "100%",
      borderRadius: "20px",
      border: "1px solid rgba(255,255,255,0.14)",
      background: "linear-gradient(160deg, rgba(24,31,64,0.96), rgba(10,13,30,0.96))",
      padding: "22px 22px 18px",
      color: "rgba(226,236,255,0.94)",
      font: "400 14.5px/1.62 " + FONT,
      boxShadow: "0 24px 70px rgba(0,0,0,0.6)"
    });
    sheet.appendChild(el("div", {
      font: "600 19px " + FONT,
      marginBottom: "12px",
      letterSpacing: "0.02em"
    }, "Boids"));

    const lines = [
      "Thousands of birds, each watching only its neighbours. Nothing choreographs the flock.",
      "🦅 Predator — they scatter and split around your finger.",
      "✨ Attractor — they fall into orbit and wind into a vortex.",
      "Tap the button above to switch. Use several fingers at once.",
      "Fear spreads bird to bird, so one scare travels outward as a wave. Watch for it after you let go."
    ];
    for (const line of lines) {
      const row = el("div", { margin: "9px 0", color: "rgba(212,225,255,0.86)" }, line);
      sheet.appendChild(row);
    }

    const close = el("button", {
      marginTop: "16px",
      width: "100%",
      padding: "12px",
      borderRadius: "13px",
      border: "1px solid rgba(255,255,255,0.16)",
      background: "rgba(122,150,255,0.18)",
      color: "rgba(233,240,255,0.95)",
      font: "600 15px " + FONT,
      cursor: "pointer",
      WebkitTapHighlightColor: "transparent"
    }, "Fly");
    sheet.appendChild(close);
    scrim.appendChild(sheet);
    ui.appendChild(scrim);

    function openHelp() {
      scrim.style.display = "flex";
    }
    function closeHelp() {
      scrim.style.display = "none";
    }
    ctx.listen(helpBtn, "click", openHelp);
    ctx.listen(close, "click", closeHelp);
    ctx.listen(scrim, "click", (event) => { if (event.target === scrim) closeHelp(); });

    // ---- resize ------------------------------------------------------------
    function onResize() {
      const nw = ctx.width;
      const nh = ctx.height;
      if (nw === W && nh === H) return;
      const sx = nw / W;
      const sy = nh / H;
      W = nw;
      H = nh;
      rescale();
      sizeGrid();
      for (let i = 0; i < MAX_N; i++) {
        px[i] = clamp(px[i] * sx, 0, W);
        py[i] = clamp(py[i] * sy, 0, H);
      }
    }
    ctx.listen(window, "resize", onResize);
    ctx.listen(window, "orientationchange", onResize);

    // ---- frame loop --------------------------------------------------------
    // A rolling frame-time average trims the flock on devices that can't hold
    // the full population, rather than letting the whole thing judder.
    let avgMs = 16;
    let slowFrames = 0;
    let trims = 0;

    ctx.onFrame((dtMs) => {
      if (ctx.width !== W || ctx.height !== H) onResize();

      const dt = clamp(dtMs, 8, 34) / 1000;
      const t0 = performance.now();

      step(dt);
      draw();
      Wind.set(clamp(meanFear * 2.4, 0, 1));

      avgMs += ((performance.now() - t0) - avgMs) * 0.05;
      if (trims < 3) {
        if (avgMs > 13.5) {
          slowFrames++;
          if (slowFrames > 110) {
            activeN = Math.max(900, Math.round(activeN * 0.82));
            slowFrames = 0;
            trims++;
          }
        } else if (slowFrames > 0) {
          slowFrames--;
        }
      }
    });

    // ---- first frame -------------------------------------------------------
    // Draw before announcing readiness so the bit never shows a blank frame.
    // A few warm-up steps let the flock organise instead of appearing as noise.
    for (let i = 0; i < 40; i++) step(1 / 60);
    draw();
    ctx.markVisualReady("flock");

    // No auto-opened help sheet. The flock is the pitch, and a wall of text
    // over it on first load buries the one thing worth showing — the hint line
    // and the "?" button are enough to find everything else.
    ctx.timeout(hideHint, 7000);

    ctx.platform.ready();
  }
};
