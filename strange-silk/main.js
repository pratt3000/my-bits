// Strange Silk — a mobile-first Plethora Bit.
//
// Tens of thousands of particles are dropped into a chaotic 3D flow (a strange
// attractor) and integrated live. The screen is a *map of that flow's two
// parameters*: wherever your finger lands sets them, so dragging bends the
// equation itself and the cloud reorganises into a different shape in front of
// you. Two fingers orbit, pinch and roll the camera instead.
//
// The look comes from accumulation, not from geometry: points are additively
// splatted into a framebuffer that only fades a couple of percent per frame, so
// every particle drags a long silky trail and ~2 million samples are lit at
// once. Hold still and the picture keeps developing like a long exposure; while
// you drag, the fade speeds up so the shape stays legible.
//
// Everything is procedural — no assets, no dependencies. WebGL is used when the
// WebView offers it, with a plain 2D canvas fallback that runs the same
// simulation so the bit is never blank.

window.plethoraBit = {
  meta: {
    title: "Strange Silk",
    runtime: "plethora-bit@2",
    tags: ["art", "generative", "math", "chaos", "fidget", "sensory", "3d", "touch"],
    permissions: ["backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // =====================================================================
    // 1. The maths.
    //
    // Eight classic 3D attractors. Each exposes two live parameters mapped to
    // the finger's x and y. The ranges below are swept offline: across the
    // whole finger-reachable rectangle none of these blow up to infinity, and
    // all but one corner of Lorenz stay chaotic rather than collapsing onto a
    // fixed point. `nominal` is the attractor's typical RMS radius, used to
    // clamp the auto-framing and to rescale the cloud when shapes change.
    //
    // Each `step` integrates every particle in place with one midpoint (RK2)
    // step. They are written as flat loops rather than a shared derivative
    // callback because this runs ~120k times per frame on a phone.
    // =====================================================================
    const SHAPES = [
      {
        id: "aizawa", name: "Aizawa",
        pa: { label: "a", min: 0.70, max: 1.05 },
        pb: { label: "d", min: 2.40, max: 4.20 },
        dt: 0.005, sub: 2, seed: [0.1, 0.0, 0.0], spread: 0.9,
        nominal: 1.2, burnT: 72, view: [0.62, -1.12],
        music: { preset: "ambient", scale: "lydian", tempo: 60 },
        step(p, n, a, d) {
          const b = 0.7, c = 0.6, e = 0.25, f = 0.1, dt = this.dt, h = dt * 0.5;
          for (let i = 0, m = n * 3; i < m; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const zb = z - b, r2 = x * x + y * y;
            const k0 = zb * x - d * y;
            const k1 = d * x + zb * y;
            const k2 = c + a * z - z * z * z / 3 - r2 * (1 + e * z) + f * z * x * x * x;
            const mx = x + k0 * h, my = y + k1 * h, mz = z + k2 * h;
            const mzb = mz - b, mr2 = mx * mx + my * my;
            p[i] = x + dt * (mzb * mx - d * my);
            p[i + 1] = y + dt * (d * mx + mzb * my);
            p[i + 2] = z + dt * (c + a * mz - mz * mz * mz / 3 - mr2 * (1 + e * mz) + f * mz * mx * mx * mx);
          }
        }
      },
      {
        id: "lorenz", name: "Lorenz",
        pa: { label: "σ", min: 7, max: 16 },
        pb: { label: "ρ", min: 23, max: 52 },
        dt: 0.0018, sub: 2, seed: [0.6, 0.4, 24], spread: 6,
        nominal: 22, burnT: 6.5, view: [0.0, -1.57],
        music: { preset: "drift", scale: "minorPentatonic", tempo: 68 },
        step(p, n, s, r) {
          const beta = 8 / 3, dt = this.dt, h = dt * 0.5;
          for (let i = 0, m = n * 3; i < m; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const mx = x + (s * (y - x)) * h;
            const my = y + (x * (r - z) - y) * h;
            const mz = z + (x * y - beta * z) * h;
            p[i] = x + dt * (s * (my - mx));
            p[i + 1] = y + dt * (mx * (r - mz) - my);
            p[i + 2] = z + dt * (mx * my - beta * mz);
          }
        }
      },
      {
        id: "thomas", name: "Thomas",
        pa: { label: "b", min: 0.08, max: 0.21 },
        pb: { label: "k", min: 0.75, max: 1.45 },
        dt: 0.062, sub: 1, seed: [1.1, 1.1, -0.6], spread: 3,
        nominal: 4.5, burnT: 60, view: [0.65, 0.42],
        music: { preset: "drone", scale: "wholeTone", tempo: 52 },
        step(p, n, b, k) {
          const dt = this.dt, h = dt * 0.5, sin = Math.sin;
          for (let i = 0, m = n * 3; i < m; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const mx = x + (sin(k * y) - b * x) * h;
            const my = y + (sin(k * z) - b * y) * h;
            const mz = z + (sin(k * x) - b * z) * h;
            p[i] = x + dt * (sin(k * my) - b * mx);
            p[i + 1] = y + dt * (sin(k * mz) - b * my);
            p[i + 2] = z + dt * (sin(k * mx) - b * mz);
          }
        }
      },
      {
        id: "halvorsen", name: "Halvorsen",
        pa: { label: "a", min: 1.45, max: 2.20 },
        pb: { label: "c", min: 3.20, max: 4.60 },
        dt: 0.0026, sub: 2, seed: [-4.5, 0.5, 0.2], spread: 3,
        nominal: 8.5, burnT: 10, view: [0.7, 0.4],
        music: { preset: "cozy", scale: "dorian", tempo: 72 },
        step(p, n, a, c) {
          const dt = this.dt, h = dt * 0.5;
          for (let i = 0, m = n * 3; i < m; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const mx = x + (-a * x - c * y - c * z - y * y) * h;
            const my = y + (-a * y - c * z - c * x - z * z) * h;
            const mz = z + (-a * z - c * x - c * y - x * x) * h;
            p[i] = x + dt * (-a * mx - c * my - c * mz - my * my);
            p[i + 1] = y + dt * (-a * my - c * mz - c * mx - mz * mz);
            p[i + 2] = z + dt * (-a * mz - c * mx - c * my - mx * mx);
          }
        }
      },
      {
        id: "rossler", name: "Rössler",
        pa: { label: "a", min: 0.10, max: 0.32 },
        pb: { label: "c", min: 3.50, max: 14.0 },
        dt: 0.011, sub: 2, seed: [1, 1, 1], spread: 4,
        nominal: 12, burnT: 15, view: [0.35, -0.95],
        music: { preset: "lofi", scale: "minor", tempo: 74 },
        step(p, n, a, c) {
          const b = 0.2, dt = this.dt, h = dt * 0.5;
          for (let i = 0, m = n * 3; i < m; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const mx = x + (-y - z) * h;
            const my = y + (x + a * y) * h;
            const mz = z + (b + z * (x - c)) * h;
            p[i] = x + dt * (-my - mz);
            p[i + 1] = y + dt * (mx + a * my);
            p[i + 2] = z + dt * (b + mz * (mx - c));
          }
        }
      },
      {
        id: "burkeshaw", name: "Burke–Shaw",
        pa: { label: "s", min: 6.0, max: 14.0 },
        pb: { label: "v", min: 2.50, max: 6.50 },
        dt: 0.0017, sub: 2, seed: [0.6, 0.1, 0.4], spread: 1.2,
        nominal: 1.6, burnT: 8, view: [0.3, -1.45],
        music: { preset: "synthwave", scale: "hirajoshi", tempo: 80 },
        step(p, n, s, v) {
          const dt = this.dt, h = dt * 0.5;
          for (let i = 0, m = n * 3; i < m; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const mx = x + (-s * (x + y)) * h;
            const my = y + (-y - s * x * z) * h;
            const mz = z + (s * x * y + v) * h;
            p[i] = x + dt * (-s * (mx + my));
            p[i + 1] = y + dt * (-my - s * mx * mz);
            p[i + 2] = z + dt * (s * mx * my + v);
          }
        }
      },
      {
        id: "dadras", name: "Dadras",
        pa: { label: "a", min: 2.20, max: 3.60 },
        pb: { label: "c", min: 1.45, max: 2.30 },
        dt: 0.0045, sub: 2, seed: [1.1, 2.1, -2], spread: 2,
        nominal: 5, burnT: 10, view: [0.25, 0.0],
        music: { preset: "sparkle", scale: "pentatonic", tempo: 88 },
        step(p, n, a, c) {
          const b = 2.7, d = 2, e = 9, dt = this.dt, h = dt * 0.5;
          for (let i = 0, m = n * 3; i < m; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const mx = x + (y - a * x + b * y * z) * h;
            const my = y + (c * y - x * z + z) * h;
            const mz = z + (d * x * y - e * z) * h;
            p[i] = x + dt * (my - a * mx + b * my * mz);
            p[i + 1] = y + dt * (c * my - mx * mz + mz);
            p[i + 2] = z + dt * (d * mx * my - e * mz);
          }
        }
      },
      {
        id: "fourwing", name: "Four-Wing",
        pa: { label: "a", min: 0.10, max: 0.35 },
        pb: { label: "c", min: -0.70, max: -0.25 },
        dt: 0.03, sub: 2, seed: [1, -1, 1], spread: 1.2,
        nominal: 1.4, burnT: 34, view: [0.55, 0.3],
        music: { preset: "bubble", scale: "blues", tempo: 84 },
        step(p, n, a, c) {
          const b = 0.01, dt = this.dt, h = dt * 0.5;
          for (let i = 0, m = n * 3; i < m; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const mx = x + (a * x + y * z) * h;
            const my = y + (b * x + c * y - x * z) * h;
            const mz = z + (-z - x * y) * h;
            p[i] = x + dt * (a * mx + my * mz);
            p[i + 1] = y + dt * (b * mx + c * my - mx * mz);
            p[i + 2] = z + dt * (-mz - mx * my);
          }
        }
      }
    ];

    // Four-stop gradients, walked by view depth so colour flows across the
    // shape as it turns. Dense regions blow past the top stop and tone-map
    // toward white, which is where the pearly cores come from.
    const PALETTES = [
      {
        name: "Silk",
        stops: [[0.40, 0.22, 1.00], [0.16, 0.86, 0.78], [0.74, 0.92, 0.28], [1.00, 0.38, 0.74]]
      },
      {
        name: "Ember",
        stops: [[0.55, 0.05, 0.20], [1.00, 0.30, 0.05], [1.00, 0.76, 0.22], [1.00, 0.96, 0.82]]
      },
      {
        name: "Ice",
        stops: [[0.06, 0.16, 0.80], [0.16, 0.72, 1.00], [0.72, 0.96, 1.00], [1.00, 0.78, 0.95]]
      },
      {
        name: "Bloom",
        stops: [[0.92, 0.08, 0.58], [1.00, 0.42, 0.28], [1.00, 0.86, 0.34], [0.50, 1.00, 0.72]]
      }
    ];

    const BG = [0.012, 0.010, 0.026]; // the near-black everything fades toward

    // The look, in one place. Density is a balance between how hard each
    // particle splats and how fast the accumulation buffer forgets: too much
    // alpha for the fade and every sheet saturates into a white blob, too
    // little and the picture never develops.
    const POINT_SIZE = 1.55;     // sprite diameter in device pixels
    // Trails are specified as a *length* — a fraction of the cloud's own width
    // — rather than as a decay rate, and the decay is solved for each frame
    // from how fast particles are actually travelling. A fixed decay cannot
    // work across these shapes: Lorenz crosses its own attractor about three
    // times faster per frame than Aizawa, so the same fade that draws silk for
    // one wraps the other in featureless haze.
    const TRAIL = 0.42;          // trail length in cloud-widths
    const FADE_MIN = 0.012;
    const FADE_MAX = 0.17;
    const ALPHA_K = 2.5;         // splat weight per unit of fade — sets brightness
    const DEPTH_GAIN = 1.55;     // how far the palette spans across the depth
    const EXPOSURE = 0.95;       // tone-map shoulder
    const BLOOM_AMT = 0.55;

    // =====================================================================
    // 2. State.
    // =====================================================================
    const MAX = 60000;
    const pos = new Float32Array(MAX * 3);
    const seedAttr = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) seedAttr[i] = Math.random();

    let count = 22000;          // live particles, auto-tuned to the device
    let shapeIdx = 0;
    let paletteIdx = 0;
    let shape = SHAPES[0];

    let pa = 0, pb = 0;         // smoothed parameters actually integrated
    let paT = 0, pbT = 0;       // targets set by the finger
    let started = false;        // first real gesture seen
    let drifting = true;        // attract-mode parameter wander
    let driftPhase = Math.random() * 100;
    let lastTouchMs = 0;
    let morphMs = 0;            // >0 briefly after a shape change

    // camera. Each attractor has an angle that shows its silhouette best —
    // Lorenz wants its z axis upright or the butterfly reads as two flat
    // spirals — so a shape change eases the view across as the cloud morphs.
    let yaw = 0.6, pitch = 0.38, roll = 0;
    let yawT = yaw, pitchT = pitch;
    let zoom = 1;
    let fitScale = 0.02;        // model units -> view units, auto-framed
    const center = [0, 0, 0];

    // measured each frame from a sample of particles
    let energy = 0.35;          // scale-free swirl rate, drives the music
    let dFrac = 0.02;           // per-frame travel as a fraction of cloud size
    let soundOn = true;

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function lerp(a, b, t) { return a + (b - a) * t; }

    // =====================================================================
    // 3. Simulation.
    // =====================================================================

    // Seed every particle in a loose ball around the attractor's start point.
    function seedCloud() {
      const s = shape.seed, r = shape.spread;
      for (let i = 0; i < MAX; i++) {
        const k = i * 3;
        pos[k] = s[0] + (Math.random() * 2 - 1) * r;
        pos[k + 1] = s[1] + (Math.random() * 2 - 1) * r;
        pos[k + 2] = s[2] + (Math.random() * 2 - 1) * r;
      }
    }

    // A ball of particles takes a *long* time to fall onto an attractor —
    // measured offline, Aizawa needs around ten thousand integration steps,
    // which at two per frame would be a minute and a half of watching a blob.
    // So a shape's first appearance is bootstrapped: run a handful of walkers
    // until they are provably on the attractor, then snapshot them repeatedly
    // to harvest a pool of points that already lie on it. Seeding the whole
    // cloud from that pool is instant and correct. Pools are built at the
    // shape's mid parameters and cached, and the walkers cost ~1M particle
    // steps once per shape.
    const POOL_PTS = 6000;
    const poolCache = new Map();

    function buildPool(sh) {
      const cached = poolCache.get(sh.id);
      if (cached) return cached;
      const K = 64;
      const work = new Float32Array(K * 3);
      // Generous radius, measured from the seed: this only has to catch a
      // walker that has genuinely escaped, and some attractors settle well
      // away from where their walkers start.
      const s = sh.seed, r = sh.spread * 0.6, bound = sh.nominal * 8;
      for (let i = 0; i < K; i++) {
        work[i * 3] = s[0] + (Math.random() * 2 - 1) * r;
        work[i * 3 + 1] = s[1] + (Math.random() * 2 - 1) * r;
        work[i * 3 + 2] = s[2] + (Math.random() * 2 - 1) * r;
      }
      const a = (sh.pa.min + sh.pa.max) * 0.5;
      const b = (sh.pb.min + sh.pb.max) * 0.5;
      const rescue = () => {
        for (let i = 0; i < K; i++) {
          const k = i * 3;
          if (!(Math.abs(work[k]) < bound && Math.abs(work[k + 1]) < bound &&
                Math.abs(work[k + 2]) < bound)) {
            const j = ((Math.random() * K) | 0) * 3;
            work[k] = work[j] * 0.99 + s[0] * 0.01;
            work[k + 1] = work[j + 1] * 0.99 + s[1] * 0.01;
            work[k + 2] = work[j + 2] * 0.99 + s[2] * 0.01;
          }
        }
      };
      const burnSteps = Math.round(sh.burnT / sh.dt);
      for (let i = 0; i < burnSteps; i++) {
        sh.step(work, K, a, b);
        if ((i & 255) === 0) rescue();
      }
      rescue();
      // Snapshots have to be spread over thousands of steps, not consecutive
      // ones: 96 walkers sampled back-to-back only cover a sliver of arc, and
      // seeding from that gives a cloud that moves as one dense clump instead
      // of a whole attractor. The gap below spans roughly the burn-in again,
      // which is many orbits for every shape here.
      const pool = new Float32Array(POOL_PTS * 3);
      const rounds = Math.ceil(POOL_PTS / K);
      const gap = Math.max(6, Math.round(burnSteps / rounds));
      let w = 0;
      for (let r = 0; r < rounds && w < POOL_PTS; r++) {
        for (let g = 0; g < gap; g++) sh.step(work, K, a, b);
        rescue();
        for (let i = 0; i < K && w < POOL_PTS; i++, w++) {
          pool[w * 3] = work[i * 3];
          pool[w * 3 + 1] = work[i * 3 + 1];
          pool[w * 3 + 2] = work[i * 3 + 2];
        }
      }
      poolCache.set(sh.id, pool);
      return pool;
    }

    function sampleFromPool(pool, out, n, jitter) {
      const pts = (pool.length / 3) | 0;
      for (let i = 0; i < n; i++) {
        const j = ((Math.random() * pts) | 0) * 3;
        const k = i * 3;
        out[k] = pool[j] + (Math.random() - 0.5) * jitter;
        out[k + 1] = pool[j + 1] + (Math.random() - 0.5) * jitter;
        out[k + 2] = pool[j + 2] + (Math.random() - 0.5) * jitter;
      }
    }

    // The transformation itself: every particle glides from where it is to a
    // point on the new attractor. This is the bit's signature move — one
    // mathematical shape visibly becoming another — and it doubles as the
    // opening, where the starting cloud is a formless ball.
    const morphFrom = new Float32Array(MAX * 3);
    const morphTo = new Float32Array(MAX * 3);
    let morphT = 1, morphDur = 1;

    function beginMorph(durMs) {
      morphFrom.set(pos);
      sampleFromPool(buildPool(shape), morphTo, MAX, shape.nominal * 0.014);
      morphT = 0;
      morphDur = durMs;
      morphMs = durMs;
    }

    // Put a lost particle back on the attractor by copying a living one. That
    // beats re-seeding: a fresh particle would otherwise streak in from the
    // seed point and draw a visible comet across the picture.
    function respawn(i) {
      const j = ((Math.random() * count) | 0) * 3;
      const k = i * 3;
      const lim = shape.nominal * 4.5;
      const dx = pos[j] - center[0], dy = pos[j + 1] - center[1], dz = pos[j + 2] - center[2];
      if (dx * dx + dy * dy + dz * dz < lim * lim) {
        const jit = shape.nominal * 0.02;
        pos[k] = pos[j] + (Math.random() - 0.5) * jit;
        pos[k + 1] = pos[j + 1] + (Math.random() - 0.5) * jit;
        pos[k + 2] = pos[j + 2] + (Math.random() - 0.5) * jit;
      } else {
        const s = shape.seed, r = shape.spread * 0.25;
        pos[k] = s[0] + (Math.random() * 2 - 1) * r;
        pos[k + 1] = s[1] + (Math.random() * 2 - 1) * r;
        pos[k + 2] = s[2] + (Math.random() * 2 - 1) * r;
      }
    }

    // Direct manipulation. The finger is a physical disturbance: particles
    // near it are shouldered aside and dragged along with the motion, and the
    // attractor then pulls them back over the next second. This is what makes
    // the silk feel like a thing you are touching rather than a picture of
    // one — parameter control alone changes the shape, but gives no local
    // response under the fingertip, which read as nothing happening at all.
    let fingerPrev = null;
    const fingerAt = [0, 0, 0];

    // Screen point -> world point on the plane through the cloud centre facing
    // the camera. R is orthonormal so its inverse is its transpose, and rotM
    // is stored column-major for the shader: R[r][c] is rotM[c * 3 + r], so
    // (R^T q)_r reads across row r as rotM[r * 3 + c].
    function fingerWorld(x, y, out) {
      const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
      const nx = (x / w * 2 - 1) * (w / h);
      const ny = -(y / h * 2 - 1);
      const s = Math.max(1e-6, fitScale * zoom);
      out[0] = center[0] + (rotM[0] * nx + rotM[1] * ny) / s;
      out[1] = center[1] + (rotM[3] * nx + rotM[4] * ny) / s;
      out[2] = center[2] + (rotM[6] * nx + rotM[7] * ny) / s;
    }

    function applyFinger(x, y, stepScale) {
      buildRot();
      fingerWorld(x, y, fingerAt);
      const s = Math.max(1e-6, fitScale * zoom);
      const radius = 0.30 / s;                 // a fingertip's worth of screen
      const r2 = radius * radius;
      const size = 0.78 / (2.3 * Math.max(fitScale, 1e-6));
      const push = size * 0.030 * stepScale;   // shoulder particles aside
      const drag = 0.85;                       // ...and carry them with the finger

      let mx = 0, my = 0, mz = 0;
      if (fingerPrev) {
        mx = fingerAt[0] - fingerPrev[0];
        my = fingerAt[1] - fingerPrev[1];
        mz = fingerAt[2] - fingerPrev[2];
      } else {
        fingerPrev = [0, 0, 0];
      }
      fingerPrev[0] = fingerAt[0];
      fingerPrev[1] = fingerAt[1];
      fingerPrev[2] = fingerAt[2];

      const fx = fingerAt[0], fy = fingerAt[1], fz = fingerAt[2];
      let touched = 0;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        const dx = pos[k] - fx, dy = pos[k + 1] - fy, dz = pos[k + 2] - fz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;
        const d = Math.sqrt(d2);
        const f = 1 - d / radius;
        const ff = f * f;
        const inv = d > 1e-6 ? 1 / d : 0;
        pos[k] += dx * inv * push * ff + mx * drag * ff;
        pos[k + 1] += dy * inv * push * ff + my * drag * ff;
        pos[k + 2] += dz * inv * push * ff + mz * drag * ff;
        touched++;
      }
      return touched;
    }

    // One sweep that does two jobs: recycle particles that have wandered off
    // the attractor, and accumulate the mean and variance that auto-framing
    // needs. Sampling every 8th particle for the statistics keeps it cheap.
    //
    // The recycling test is measured from the *tracked centre*, not the
    // origin, and at a tight multiple of the attractor's own size. A loose
    // origin-relative bound lets strays orbit far outside the shape forever —
    // they never quite escape, so they never get recycled, and they drag the
    // auto-framing outward until the attractor itself renders as a speck
    // inside a haze. Lorenz and Rössler, whose attractors sit well away from
    // the origin, showed this plainly.
    let sumX = 0, sumY = 0, sumZ = 0, sumSq = 0, samples = 0;
    function guard(recycle) {
      const lim = shape.nominal * 4.5, lim2 = lim * lim;
      const cx = center[0], cy = center[1], cz = center[2];
      sumX = sumY = sumZ = sumSq = 0; samples = 0;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        let x = pos[k], y = pos[k + 1], z = pos[k + 2];
        if (recycle) {
          const dx = x - cx, dy = y - cy, dz = z - cz;
          if (!(dx * dx + dy * dy + dz * dz < lim2)) {
            respawn(i);
            x = pos[k]; y = pos[k + 1]; z = pos[k + 2];
          }
        }
        if ((i & 7) === 0) {
          sumX += x; sumY += y; sumZ += z;
          sumSq += x * x + y * y + z * z;
          samples++;
        }
      }
      if (samples > 0) {
        const mx = sumX / samples, my = sumY / samples, mz = sumZ / samples;
        const variance = Math.max(sumSq / samples - (mx * mx + my * my + mz * mz), 0);
        // Clamp the radius so a collapsing attractor (Lorenz below its Hopf
        // point, say) can't drive the auto-zoom to infinity.
        const rms = Math.max(Math.sqrt(variance), shape.nominal * 0.22);
        const target = 0.78 / (2.3 * rms);
        const rate = morphMs > 0 ? 0.10 : 0.035;
        fitScale = lerp(fitScale, target, rate);
        center[0] = lerp(center[0], mx, rate);
        center[1] = lerp(center[1], my, rate);
        center[2] = lerp(center[2], mz, rate);
      }
    }

    // Mean displacement of a fixed sample, normalised by the cloud's size, so
    // "how fast is this swirling" is comparable across attractors of wildly
    // different scale. Feeds the music's intensity.
    const SAMPLE_N = 192;
    const prevSample = new Float32Array(SAMPLE_N * 3);
    let sampleStride = 1, sampleValid = false;
    function measureEnergy() {
      const stride = Math.max(1, (count / SAMPLE_N) | 0);
      if (stride !== sampleStride) { sampleStride = stride; sampleValid = false; }
      let moved = 0, n = 0;
      for (let s = 0; s < SAMPLE_N; s++) {
        const i = s * stride;
        if (i >= count) break;
        const k = i * 3, q = s * 3;
        if (sampleValid) {
          const dx = pos[k] - prevSample[q];
          const dy = pos[k + 1] - prevSample[q + 1];
          const dz = pos[k + 2] - prevSample[q + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (isFinite(d)) { moved += d; n++; }
        }
        prevSample[q] = pos[k];
        prevSample[q + 1] = pos[k + 1];
        prevSample[q + 2] = pos[k + 2];
      }
      sampleValid = true;
      if (n > 0) {
        const size = Math.max(1e-4, 0.78 / (2.3 * Math.max(fitScale, 1e-6)));
        const rate = clamp((moved / n) / size, 0, 1);
        // dFrac: how far a particle travels in one frame as a fraction of the
        // whole cloud. It is what sets trail length, so it needs to respond
        // quickly; energy is the same signal smoothed hard for the music.
        dFrac = lerp(dFrac, rate, 0.25);
        energy = lerp(energy, clamp(rate * 26, 0, 1), 0.06);
      }
    }

    // =====================================================================
    // 4. Renderer — WebGL.
    //
    // Two blend passes into an offscreen accumulation target (fade, then
    // additive points), a quarter-res two-tap-pass blur for the bloom, and a
    // composite that tone-maps the sum. Nothing here needs an extension, so it
    // runs on WebGL1 as happily as WebGL2.
    // =====================================================================
    const QUAD_VS =
      "attribute vec2 aQuad;varying vec2 vUV;" +
      "void main(){vUV=aQuad*0.5+0.5;gl_Position=vec4(aQuad,0.0,1.0);}";

    const POINT_VS =
      "precision highp float;" +
      "attribute vec3 aPos;attribute float aSeed;" +
      "uniform mat3 uRot;uniform vec3 uCenter;uniform float uScale,uAspect,uCam,uSize,uJitter,uDepth;" +
      "varying float vT;varying float vShade;" +
      "void main(){" +
      "vec3 q=uRot*((aPos-uCenter)*uScale);" +
      "float persp=uCam/max(uCam-q.z,0.35);" +
      "gl_Position=vec4(q.x*persp/uAspect,q.y*persp,0.0,1.0);" +
      "gl_PointSize=max(uSize*persp,0.65);" +
      "vT=clamp(q.z*uDepth+0.5+(aSeed-0.5)*uJitter,0.0,1.0);" +
      "vShade=persp*persp*(0.62+0.5*aSeed);}";

    const POINT_FS =
      "precision mediump float;" +
      "varying float vT;varying float vShade;" +
      "uniform vec3 uC0,uC1,uC2,uC3;uniform float uAlpha;" +
      "void main(){" +
      "vec3 c=mix(uC0,uC1,smoothstep(0.0,0.36,vT));" +
      "c=mix(c,uC2,smoothstep(0.30,0.70,vT));" +
      "c=mix(c,uC3,smoothstep(0.66,1.0,vT));" +
      "vec2 d=gl_PointCoord-0.5;" +
      "float fall=exp(-dot(d,d)*7.5);" +
      "gl_FragColor=vec4(c*vShade,uAlpha*fall);}";

    const FADE_FS =
      "precision mediump float;varying vec2 vUV;uniform vec3 uBg;uniform float uFade;" +
      "void main(){gl_FragColor=vec4(uBg,uFade);}";

    const BLUR_FS =
      "precision mediump float;varying vec2 vUV;" +
      "uniform sampler2D uTex;uniform vec2 uStep;" +
      "void main(){" +
      "vec3 s=texture2D(uTex,vUV).rgb*0.227;" +
      "s+=(texture2D(uTex,vUV+uStep*1.385).rgb+texture2D(uTex,vUV-uStep*1.385).rgb)*0.316;" +
      "s+=(texture2D(uTex,vUV+uStep*3.253).rgb+texture2D(uTex,vUV-uStep*3.253).rgb)*0.070;" +
      "gl_FragColor=vec4(s,1.0);}";

    const COMPOSITE_FS =
      "precision mediump float;varying vec2 vUV;" +
      "uniform sampler2D uAccum,uBloom;uniform float uBloomAmt,uExposure;" +
      "void main(){" +
      "vec3 c=texture2D(uAccum,vUV).rgb+texture2D(uBloom,vUV).rgb*uBloomAmt;" +
      "c=vec3(1.0)-exp(-c*uExposure);" +
      "vec2 p=vUV-0.5;" +
      "c*=1.0-0.62*dot(p,p);" +
      "gl_FragColor=vec4(c,1.0);}";

    let gl = null, canvas = null, gl2d = null, canvas2d = null;
    let progPoints, progFade, progBlur, progComposite;
    let bufQuad, bufPos, bufSeed;
    let accum = null, bloomA = null, bloomB = null;
    let renderW = 1, renderH = 1, bloomOn = true;

    function makeShader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error("shader: " + log);
      }
      return s;
    }

    // Programs carry their own uniform-location cache; `u(name)` is looked up
    // once and then reused every frame.
    function makeProgram(vsSrc, fsSrc) {
      const vs = makeShader(gl.VERTEX_SHADER, vsSrc);
      const fs = makeShader(gl.FRAGMENT_SHADER, fsSrc);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error("link: " + gl.getProgramInfoLog(p));
      }
      const cache = {};
      return {
        id: p,
        use() { gl.useProgram(p); return this; },
        u(name) {
          if (!(name in cache)) cache[name] = gl.getUniformLocation(p, name);
          return cache[name];
        },
        a(name) { return gl.getAttribLocation(p, name); }
      };
    }

    function makeTarget(w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb, tex, w, h };
    }

    function dropTarget(t) {
      if (!t) return;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }

    // Size the render targets to the container. Resolution is capped by total
    // pixels rather than DPR alone so a big high-density screen doesn't quietly
    // cost four times the fill rate of a small one.
    function sizeTargets() {
      const cssW = Math.max(1, ctx.width), cssH = Math.max(1, ctx.height);
      const dpr = Math.min(ctx.nativeDpr || 1, 2);
      let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
      const cap = 2600000;
      if (w * h > cap) {
        const k = Math.sqrt(cap / (w * h));
        w = Math.max(1, Math.round(w * k));
        h = Math.max(1, Math.round(h * k));
      }
      if (w === renderW && h === renderH && accum) return;
      renderW = w; renderH = h;
      canvas.width = w;
      canvas.height = h;
      dropTarget(accum); dropTarget(bloomA); dropTarget(bloomB);
      accum = makeTarget(w, h);
      const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
      bloomA = makeTarget(bw, bh);
      bloomB = makeTarget(bw, bh);
      // A fresh target starts as transparent black; paint it opaque so the
      // very first composite reads the background rather than garbage.
      gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fb);
      gl.clearColor(BG[0], BG[1], BG[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function initGL() {
      canvas = ctx.createCanvas({ touchAction: "none" });
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      const opts = {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false,
        powerPreference: "high-performance"
      };
      try {
        gl = canvas.getContext("webgl2", opts) ||
          canvas.getContext("webgl", opts) ||
          canvas.getContext("experimental-webgl", opts);
      } catch (_) { gl = null; }
      if (!gl) {
        // Don't leave the dead surface mounted: ctx.createCanvas already put it
        // in the container, where it would sit over the 2D fallback and swallow
        // every pointer event.
        try { canvas.remove(); } catch (_) {}
        canvas = null;
        return false;
      }

      progPoints = makeProgram(POINT_VS, POINT_FS);
      progFade = makeProgram(QUAD_VS, FADE_FS);
      progBlur = makeProgram(QUAD_VS, BLUR_FS);
      progComposite = makeProgram(QUAD_VS, COMPOSITE_FS);

      bufQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

      bufPos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
      gl.bufferData(gl.ARRAY_BUFFER, MAX * 3 * 4, gl.DYNAMIC_DRAW);

      bufSeed = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufSeed);
      gl.bufferData(gl.ARRAY_BUFFER, seedAttr, gl.STATIC_DRAW);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      sizeTargets();
      return true;
    }

    function drawQuad(prog) {
      const loc = prog.a("aQuad");
      gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Column-major 3x3 for uniformMatrix3fv: Rz(roll) · Rx(pitch) · Ry(yaw).
    const rotM = new Float32Array(9);
    function buildRot() {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      // Rx·Ry first (row-major)
      const a00 = cy, a01 = 0, a02 = sy;
      const a10 = sp * sy, a11 = cp, a12 = -sp * cy;
      const a20 = -cp * sy, a21 = sp, a22 = cp * cy;
      // then Rz·(that)
      const m00 = cr * a00 - sr * a10, m01 = cr * a01 - sr * a11, m02 = cr * a02 - sr * a12;
      const m10 = sr * a00 + cr * a10, m11 = sr * a01 + cr * a11, m12 = sr * a02 + cr * a12;
      const m20 = a20, m21 = a21, m22 = a22;
      rotM[0] = m00; rotM[1] = m10; rotM[2] = m20;
      rotM[3] = m01; rotM[4] = m11; rotM[5] = m21;
      rotM[6] = m02; rotM[7] = m12; rotM[8] = m22;
    }

    const CAM = 3.1;
    function renderGL(fade, alpha, pointSize) {
      const pal = PALETTES[paletteIdx].stops;
      buildRot();

      // --- accumulate ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fb);
      gl.viewport(0, 0, accum.w, accum.h);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      progFade.use();
      gl.uniform3f(progFade.u("uBg"), BG[0], BG[1], BG[2]);
      gl.uniform1f(progFade.u("uFade"), fade);
      drawQuad(progFade);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      progPoints.use();
      gl.uniformMatrix3fv(progPoints.u("uRot"), false, rotM);
      gl.uniform3f(progPoints.u("uCenter"), center[0], center[1], center[2]);
      gl.uniform1f(progPoints.u("uScale"), fitScale * zoom);
      gl.uniform1f(progPoints.u("uAspect"), renderW / renderH);
      gl.uniform1f(progPoints.u("uCam"), CAM);
      gl.uniform1f(progPoints.u("uSize"), pointSize);
      gl.uniform1f(progPoints.u("uJitter"), 0.10);
      gl.uniform1f(progPoints.u("uDepth"), DEPTH_GAIN);
      gl.uniform1f(progPoints.u("uAlpha"), alpha);
      gl.uniform3f(progPoints.u("uC0"), pal[0][0], pal[0][1], pal[0][2]);
      gl.uniform3f(progPoints.u("uC1"), pal[1][0], pal[1][1], pal[1][2]);
      gl.uniform3f(progPoints.u("uC2"), pal[2][0], pal[2][1], pal[2][2]);
      gl.uniform3f(progPoints.u("uC3"), pal[3][0], pal[3][1], pal[3][2]);

      const aPos = progPoints.a("aPos"), aSeed = progPoints.a("aSeed");
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos.subarray(0, count * 3));
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufSeed);
      gl.enableVertexAttribArray(aSeed);
      gl.vertexAttribPointer(aSeed, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, count);

      // --- bloom (quarter res, separable) ---
      gl.blendFunc(gl.ONE, gl.ZERO);
      if (bloomOn) {
        progBlur.use();
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
        gl.viewport(0, 0, bloomA.w, bloomA.h);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, accum.tex);
        gl.uniform1i(progBlur.u("uTex"), 0);
        gl.uniform2f(progBlur.u("uStep"), 1 / bloomA.w, 0);
        drawQuad(progBlur);

        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fb);
        gl.viewport(0, 0, bloomB.w, bloomB.h);
        gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
        gl.uniform2f(progBlur.u("uStep"), 0, 1 / bloomB.h);
        drawQuad(progBlur);
      }

      // --- composite ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, renderW, renderH);
      progComposite.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accum.tex);
      gl.uniform1i(progComposite.u("uAccum"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, (bloomOn ? bloomB : accum).tex);
      gl.uniform1i(progComposite.u("uBloom"), 1);
      gl.uniform1f(progComposite.u("uBloomAmt"), bloomOn ? BLOOM_AMT : 0);
      gl.uniform1f(progComposite.u("uExposure"), EXPOSURE);
      drawQuad(progComposite);
      gl.activeTexture(gl.TEXTURE0);
    }

    // =====================================================================
    // 5. Renderer — 2D fallback.
    //
    // Same simulation, same palette, no shaders: a translucent wash for the
    // trail decay and additive dots bucketed by colour so the whole cloud is a
    // few dozen fill calls. Plainer, but it never shows a blank screen.
    // =====================================================================
    const BUCKETS = 24;
    let bucketX = null, bucketY = null, bucketN = null, bucketCss = null;
    let last2dW = 0, last2dH = 0;

    function init2D() {
      canvas2d = ctx.createCanvas2D({ touchAction: "none" });
      gl2d = canvas2d.getContext("2d");
      bucketX = new Float32Array(BUCKETS * 4096);
      bucketY = new Float32Array(BUCKETS * 4096);
      bucketN = new Int32Array(BUCKETS);
      bucketCss = [];
      for (let b = 0; b < BUCKETS; b++) bucketCss.push("#000");
      refreshBucketColours();
      gl2d.fillStyle = "rgb(3,3,7)";
      gl2d.fillRect(0, 0, ctx.width, ctx.height);
      return true;
    }

    function refreshBucketColours() {
      if (!bucketCss) return;
      const stops = PALETTES[paletteIdx].stops;
      for (let b = 0; b < BUCKETS; b++) {
        const t = b / (BUCKETS - 1);
        const seg = t < 0.36 ? [0, 1, t / 0.36]
          : t < 0.70 ? [1, 2, (t - 0.36) / 0.34]
            : [2, 3, (t - 0.70) / 0.30];
        const c0 = stops[seg[0]], c1 = stops[seg[1]], k = seg[2];
        const r = Math.round(255 * lerp(c0[0], c1[0], k));
        const g = Math.round(255 * lerp(c0[1], c1[1], k));
        const bl = Math.round(255 * lerp(c0[2], c1[2], k));
        bucketCss[b] = "rgb(" + r + "," + g + "," + bl + ")";
      }
    }

    function render2D(fade, alpha) {
      const w = ctx.width, h = ctx.height;
      // Compare against the CSS size we last painted. Comparing against
      // canvas2d.width would compare a backing store measured in device pixels
      // with a CSS-pixel width, which differs on every retina screen — so this
      // repaint fired every frame at full opacity and erased the trails.
      if (last2dW !== w || last2dH !== h) {
        last2dW = w; last2dH = h;
        // Clear past the new CSS size: trails from the old layout are still
        // sitting in the backing store at their old coordinates, and a fade
        // this slow would leave a ghost of the previous shape on screen for
        // seconds after a rotation.
        gl2d.globalAlpha = 1;
        gl2d.globalCompositeOperation = "source-over";
        gl2d.fillStyle = "rgb(3,3,7)";
        gl2d.fillRect(0, 0, canvas2d.width, canvas2d.height);
      }
      buildRot();
      gl2d.globalCompositeOperation = "source-over";
      gl2d.globalAlpha = Math.min(1, fade);
      gl2d.fillStyle = "rgb(3,3,7)";
      gl2d.fillRect(0, 0, w, h);

      for (let b = 0; b < BUCKETS; b++) bucketN[b] = 0;
      const s = fitScale * zoom;
      // Match the GL projection exactly: there, NDC x is divided by the aspect
      // ratio, which works out to the same half-height scale on both axes.
      // Using min(w, h) here shrank the whole shape by the aspect ratio.
      const half = h * 0.5;
      const cx = w * 0.5, cy = h * 0.5;
      const step = Math.max(1, (count / 9000) | 0);
      const m = rotM;
      for (let i = 0; i < count; i += step) {
        const k = i * 3;
        const x = (pos[k] - center[0]) * s;
        const y = (pos[k + 1] - center[1]) * s;
        const z = (pos[k + 2] - center[2]) * s;
        const qx = m[0] * x + m[3] * y + m[6] * z;
        const qy = m[1] * x + m[4] * y + m[7] * z;
        const qz = m[2] * x + m[5] * y + m[8] * z;
        const persp = CAM / Math.max(CAM - qz, 0.35);
        const sx = cx + qx * persp * half;
        const sy = cy - qy * persp * half;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        let bi = (qz * DEPTH_GAIN + 0.5) * (BUCKETS - 1);
        bi = bi < 0 ? 0 : bi > BUCKETS - 1 ? BUCKETS - 1 : bi | 0;
        const n = bucketN[bi];
        if (n < 4096) {
          bucketX[bi * 4096 + n] = sx;
          bucketY[bi * 4096 + n] = sy;
          bucketN[bi] = n + 1;
        }
      }

      gl2d.globalCompositeOperation = "lighter";
      // A flat 1.3px square deposits far more energy than a GL point sprite of
      // the same nominal size, which has a gaussian falloff and is measured in
      // device rather than CSS pixels — hence the much smaller alpha here.
      gl2d.globalAlpha = Math.min(1, alpha * 0.25);
      for (let b = 0; b < BUCKETS; b++) {
        const n = bucketN[b];
        if (!n) continue;
        gl2d.fillStyle = bucketCss[b];
        const off = b * 4096;
        for (let j = 0; j < n; j++) gl2d.fillRect(bucketX[off + j], bucketY[off + j], 1.3, 1.3);
      }
      gl2d.globalAlpha = 1;
      gl2d.globalCompositeOperation = "source-over";
    }

    const useGL = (function () {
      try { return initGL(); } catch (err) {
        ctx.platform.error({ where: "webgl", message: String(err && err.message || err) });
        gl = null;
        return false;
      }
    })();
    if (!useGL) init2D();

    // =====================================================================
    // 6. UI.
    // =====================================================================
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";
    const FONT = "-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif";

    function chip(label, aria, wide) {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("aria-label", aria);
      b.style.cssText =
        "pointer-events:auto;height:38px;padding:0 " + (wide ? "15px" : "0") + ";" +
        (wide ? "" : "width:38px;") +
        "border-radius:19px;border:1px solid rgba(255,255,255,0.14);" +
        "font:600 " + (wide ? "14px" : "16px") + "/1 " + FONT + ";color:#eef0ff;" +
        "background:rgba(18,16,34,0.55);backdrop-filter:blur(10px);" +
        "-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;" +
        "justify-content:center;cursor:pointer;touch-action:manipulation;" +
        "letter-spacing:0.2px;box-shadow:0 2px 12px rgba(0,0,0,0.4);" +
        "-webkit-tap-highlight-color:transparent;";
      return b;
    }

    const bar = document.createElement("div");
    bar.style.cssText =
      "position:absolute;left:0;right:0;top:calc(" + ctx.safeArea.top + "px + 10px);" +
      "display:flex;gap:8px;justify-content:center;align-items:center;" +
      "pointer-events:none;padding:0 10px;";
    ui.appendChild(bar);

    const shapeBtn = chip(shape.name + "  ›", "Next attractor", true);
    const palBtn = chip("◈", "Change colours");
    const soundBtn = chip("♪", "Mute or unmute");
    const helpBtn = chip("?", "How it works");
    bar.append(shapeBtn, palBtn, soundBtn, helpBtn);

    // Live parameter readout, directly under the chips.
    const readout = document.createElement("div");
    readout.style.cssText =
      "position:absolute;left:0;right:0;top:calc(" + ctx.safeArea.top + "px + 56px);" +
      "text-align:center;pointer-events:none;color:rgba(226,230,255,0.62);" +
      "font:500 12.5px/1 " + FONT + ";letter-spacing:0.4px;" +
      "text-shadow:0 1px 6px rgba(0,0,0,0.7);";
    ui.appendChild(readout);

    // Axis hints, faded in only while a finger is bending the parameters.
    function axisLabel(css) {
      const d = document.createElement("div");
      d.style.cssText =
        "position:absolute;pointer-events:none;color:rgba(226,230,255,0.5);" +
        "font:600 11px/1 " + FONT + ";letter-spacing:1.2px;opacity:0;" +
        "transition:opacity 220ms ease;text-shadow:0 1px 6px rgba(0,0,0,0.8);" + css;
      ui.appendChild(d);
      return d;
    }
    const axisX = axisLabel("left:0;right:0;text-align:center;bottom:calc(" +
      (ctx.safeArea.bottom + 46) + "px);");
    const axisY = axisLabel("left:14px;top:50%;transform:translateY(-50%) rotate(-90deg);" +
      "transform-origin:center;");

    // Ring that tracks the finger, so parameter space feels like a place.
    const ring = document.createElement("div");
    ring.style.cssText =
      "position:absolute;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;" +
      "border:1.5px solid rgba(255,255,255,0.55);pointer-events:none;opacity:0;" +
      "transition:opacity 180ms ease;box-shadow:0 0 22px rgba(180,200,255,0.35);";
    ui.appendChild(ring);

    const hint = document.createElement("div");
    hint.style.cssText =
      "position:absolute;left:0;right:0;bottom:calc(" + (ctx.safeArea.bottom + 18) + "px);" +
      "text-align:center;pointer-events:none;color:rgba(226,230,255,0.72);" +
      "font:500 13px/1.5 " + FONT + ";transition:opacity 700ms ease;" +
      "text-shadow:0 1px 8px rgba(0,0,0,0.8);padding:0 26px;";
    hint.textContent = "Touch the silk · two fingers to turn it";
    ui.appendChild(hint);

    const panel = document.createElement("div");
    panel.style.cssText =
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "padding:26px;pointer-events:auto;background:rgba(5,4,12,0.82);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);";
    panel.innerHTML =
      '<div style="max-width:330px;color:#e8eaff;font:400 15px/1.6 ' + FONT + ';">' +
      '<h2 style="font-size:21px;margin-bottom:6px;letter-spacing:0.2px;">Strange Silk</h2>' +
      '<p style="opacity:0.62;margin-bottom:14px;font-size:13.5px;">' +
      'Thirty thousand particles falling through a chaotic flow. The screen is a map ' +
      'of that flow&rsquo;s two parameters.</p>' +
      '<ul style="list-style:none;display:grid;gap:9px;">' +
      '<li>• <b>Drag one finger</b> — push the silk around. Particles are shoved aside and dragged with you, then the flow pulls them back.</li>' +
      '<li>• The same drag bends the equation: left/right sets the first parameter, up/down the second.</li>' +
      '<li>• <b>Two fingers</b> — turn the shape, pinch to zoom, twist to roll it.</li>' +
      '<li>• <b>Tap the name</b> — eight attractors: Aizawa, Lorenz, Thomas, Halvorsen, Rössler, Burke–Shaw, Dadras, Four-Wing.</li>' +
      '<li>• <b>◈</b> changes the colours, <b>♪</b> mutes the sound.</li>' +
      '<li>• <b>Hold still</b> — the picture keeps developing, like a long exposure.</li>' +
      '</ul>' +
      '<p class="diag" style="margin-top:14px;opacity:0.38;font-size:11px;' +
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;"></p>' +
      '<p style="margin-top:10px;opacity:0.55;font-size:13px;">Tap anywhere to close.</p></div>';
    ui.appendChild(panel);
    ctx.listen(panel, "click", () => { panel.style.display = "none"; });
    const diag = panel.querySelector(".diag");

    // Shown in the help panel so a device that stays silent or unresponsive can
    // be diagnosed without a console.
    function updateDiag() {
      if (!diag) return;
      try {
        const live = ctx.music && ctx.music.state ? ctx.music.state() : "?";
        diag.textContent =
          (useGL ? "webgl" : "canvas2d") + " · " + count + "p · " +
          "input " + (inputMode || "none") + " · audio " + audioState + "/" + live;
      } catch (_) {
        diag.textContent = (useGL ? "webgl" : "canvas2d") + " · input " + (inputMode || "none");
      }
    }

    function fmt(v) {
      const a = Math.abs(v);
      return v.toFixed(a >= 10 ? 1 : 2);
    }
    function updateReadout() {
      readout.textContent =
        shape.pa.label + " " + fmt(pa) + "   ·   " + shape.pb.label + " " + fmt(pb);
    }

    // =====================================================================
    // 7. Sound.
    //
    // One bed per attractor — each shape carries its own preset, scale and
    // tempo, so switching shapes genuinely changes the music. Intensity is
    // wired to the measured swirl rate, so dragging into a violent corner of
    // parameter space is something you hear as well as see.
    // =====================================================================
    let music = null, musicBusy = false, lastIntensity = -1, lastIntensityMs = 0;
    let audioState = "idle";

    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic) { audioState = "no permission"; return; }
      if (music || musicBusy || !soundOn) return;
      musicBusy = true;
      audioState = "starting";
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({
          preset: shape.music.preset,
          scale: shape.music.scale,
          tempo: shape.music.tempo,
          volume: 0.55,
          intensity: 0.3,
          density: 0.42,
          fadeInMs: 2400
        });
        audioState = "playing";
      } catch (err) {
        audioState = "blocked: " + String(err && err.message || err).slice(0, 48);
        ctx.platform.error({ where: "music", message: String(err && err.message || err) });
      }
      musicBusy = false;
    }

    function stopMusic() {
      try { ctx.music.stop({ fadeOutMs: 700 }); } catch (_) {}
      music = null;
      audioState = "muted";
    }

    async function retuneMusic() {
      if (!music) return;
      try {
        await ctx.music.setPreset(shape.music.preset, { fadeMs: 700 });
        await ctx.music.setScale(shape.music.scale);
        await ctx.music.setTempo(shape.music.tempo, { fadeMs: 900 });
      } catch (_) { /* host may be backgrounded; not fatal */ }
    }

    function sting(name) {
      if (!soundOn || !ctx.capabilities.backgroundMusic) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    function haptic(kind) {
      if (!ctx.capabilities.haptics) return;
      try { ctx.platform.haptic(kind); } catch (_) {}
    }

    // =====================================================================
    // 8. Shape and palette changes.
    // =====================================================================

    // Normalise the old cloud into the new attractor's scale first, so the
    // transformation is a flow between two comparable shapes rather than a
    // collapse through the origin.
    function setShape(next, animate) {
      const prev = shape;
      shapeIdx = ((next % SHAPES.length) + SHAPES.length) % SHAPES.length;
      shape = SHAPES[shapeIdx];
      const k = shape.nominal / prev.nominal;
      const s = shape.seed;
      for (let i = 0; i < MAX; i++) {
        const j = i * 3;
        pos[j] = s[0] + (pos[j] - center[0]) * k;
        pos[j + 1] = s[1] + (pos[j + 1] - center[1]) * k;
        pos[j + 2] = s[2] + (pos[j + 2] - center[2]) * k;
      }
      center[0] = s[0]; center[1] = s[1]; center[2] = s[2];
      sampleValid = false;

      // Keep the finger's position in parameter space when hopping shapes, so
      // the pad reads the same way for every attractor.
      const fx = clamp((paT - prev.pa.min) / (prev.pa.max - prev.pa.min), 0, 1);
      const fy = clamp((pbT - prev.pb.min) / (prev.pb.max - prev.pb.min), 0, 1);
      paT = shape.pa.min + fx * (shape.pa.max - shape.pa.min);
      pbT = shape.pb.min + fy * (shape.pb.max - shape.pb.min);
      pa = paT; pb = pbT;

      // Aim at the new shape's hero angle without unwinding the slow drift.
      const turns = Math.round((yaw - shape.view[0]) / (Math.PI * 2));
      yawT = shape.view[0] + turns * Math.PI * 2;
      pitchT = shape.view[1];
      beginMorph(animate ? 900 : 500);
      shapeBtn.textContent = shape.name + "  ›";
      updateReadout();
      // The axes name the current shape's parameters, so they have to follow a
      // shape change that happens while a finger is still down.
      refreshPadLabels();
      save();
    }

    function cycleShape() {
      firstTouch();
      setShape(shapeIdx + 1, true);
      haptic("medium");
      sting("powerup");
      if (music) { try { ctx.music.duck(0.35, 500); } catch (_) {} }
      retuneMusic();
      ctx.platform.interact({ type: "shape", shape: shape.id });
      ctx.platform.milestone("shape_change", { shape: shape.id });
    }

    function cyclePalette() {
      firstTouch();
      paletteIdx = (paletteIdx + 1) % PALETTES.length;
      refreshBucketColours();
      haptic("light");
      sting("tap");
      ctx.platform.interact({ type: "palette", palette: PALETTES[paletteIdx].name });
      save();
    }

    function toggleSound() {
      soundOn = !soundOn;
      if (soundOn) firstTouch();
      soundBtn.textContent = soundOn ? "♪" : "⃠";
      soundBtn.style.color = soundOn ? "#eef0ff" : "rgba(238,240,255,0.45)";
      if (soundOn) startMusic(); else stopMusic();
      haptic("light");
      save();
    }

    async function save() {
      if (!ctx.capabilities.storage) return;
      try {
        await ctx.storage.set("silk", { shape: shape.id, palette: paletteIdx, sound: soundOn });
      } catch (_) {}
    }

    ctx.listen(shapeBtn, "click", cycleShape);
    ctx.listen(palBtn, "click", cyclePalette);
    ctx.listen(soundBtn, "click", toggleSound);
    ctx.listen(helpBtn, "click", () => {
      firstTouch();
      updateDiag();
      panel.style.display = panel.style.display === "none" ? "flex" : "none";
    });

    // =====================================================================
    // 9. Input.
    //
    // One finger owns the parameters; two fingers own the camera. Positions
    // come from event.offsetX/offsetY — already canvas-relative, and no layout
    // read per pointer move.
    // =====================================================================
    const pointers = new Map();
    let gesture = null;      // two-finger baseline
    let lastInteractMs = 0;

    let inputMode = "";      // whichever event family reports first wins

    // Listen on the container, not the canvas. Every touch inside the bit
    // bubbles to it, so it stops mattering which element the host stacks on
    // top or whether an overlay swallowed the hit — the control chips are
    // filtered out by target instead of by stacking order.
    function isControl(t) {
      for (let n = t; n && n !== ctx.container; n = n.parentNode) {
        if (n === panel) return true;
        if (n.tagName && n.tagName.toLowerCase() === "button") return true;
      }
      return false;
    }

    // offsetX is canvas-relative and costs no layout read, but it is not
    // reliably present on touch-derived events in every WebView. The surface
    // fills the container, so clientX is a safe stand-in when it is missing.
    function localX(e) {
      const v = e.offsetX;
      return (typeof v === "number" && isFinite(v)) ? v : (e.clientX || 0);
    }
    function localY(e) {
      const v = e.offsetY;
      return (typeof v === "number" && isFinite(v)) ? v : (e.clientY || 0);
    }

    function firstTouch() {
      if (!started) {
        started = true;
        drifting = false;
        ctx.platform.start();
        hint.style.opacity = "0";
      }
      // Retried on every gesture, not just the first: a host can refuse audio
      // on the opening attempt (still locked, or backgrounded), and the only
      // way back in is another user gesture.
      if (!music && soundOn) startMusic();
    }

    function setParamsFromPoint(x, y) {
      const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
      const fx = clamp(x / w, 0, 1);
      const fy = clamp(1 - y / h, 0, 1);   // up = more
      paT = shape.pa.min + fx * (shape.pa.max - shape.pa.min);
      pbT = shape.pb.min + fy * (shape.pb.max - shape.pb.min);
      ring.style.left = x + "px";
      ring.style.top = y + "px";
    }

    function refreshPadLabels() {
      // Verbatim, not uppercased: the Greek names would stop matching the
      // readout, and a capital rho just reads as a Latin P.
      axisX.textContent = shape.pa.label + "  \u27f6";
      axisY.textContent = shape.pb.label + "  \u27f6";
    }

    function showPad(on) {
      ring.style.opacity = on ? "1" : "0";
      axisX.style.opacity = on ? "1" : "0";
      axisY.style.opacity = on ? "1" : "0";
      if (on) refreshPadLabels();
    }

    function twoFingerBaseline() {
      const pts = [...pointers.values()];
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      return {
        dist: Math.max(1, Math.hypot(dx, dy)),
        angle: Math.atan2(dy, dx),
        mx: (pts[0].x + pts[1].x) * 0.5,
        my: (pts[0].y + pts[1].y) * 0.5,
        yaw, pitch, roll, zoom
      };
    }

    // ---- gesture handling, independent of which event family delivered it ----

    function beginAt(id, x, y) {
      firstTouch();
      pointers.set(id, { x, y });
      lastTouchMs = performance.now();
      if (pointers.size === 1) {
        setParamsFromPoint(x, y);
        showPad(true);
        haptic("light");
        if (soundOn) sting("tap");
      } else if (pointers.size === 2) {
        gesture = twoFingerBaseline();
        fingerPrev = null;
        showPad(false);
      }
    }

    function moveAt(id, x, y) {
      const p = pointers.get(id);
      if (!p) return;
      p.x = x; p.y = y;
      lastTouchMs = performance.now();

      if (pointers.size === 1) {
        setParamsFromPoint(x, y);
        const now = performance.now();
        if (now - lastInteractMs > 500) {
          lastInteractMs = now;
          ctx.platform.interact({ type: "sculpt", shape: shape.id });
        }
      } else if (pointers.size >= 2 && gesture) {
        const pts = [...pointers.values()];
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx);
        const mx = (pts[0].x + pts[1].x) * 0.5, my = (pts[0].y + pts[1].y) * 0.5;
        const span = Math.max(1, Math.min(ctx.width, ctx.height));
        yaw = gesture.yaw + (mx - gesture.mx) / span * 3.4;
        pitch = clamp(gesture.pitch + (my - gesture.my) / span * 3.0, -1.45, 1.45);
        let dAng = angle - gesture.angle;
        while (dAng > Math.PI) dAng -= Math.PI * 2;
        while (dAng < -Math.PI) dAng += Math.PI * 2;
        roll = gesture.roll + dAng;
        zoom = clamp(gesture.zoom * (dist / gesture.dist), 0.45, 3.6);
      }
    }

    function endAt(id) {
      pointers.delete(id);
      fingerPrev = null;
      if (pointers.size < 2) gesture = null;
      if (pointers.size === 1) {
        // Dropping back to one finger re-arms from wherever that finger now
        // is, instead of snapping to a stale point.
        const p = [...pointers.values()][0];
        setParamsFromPoint(p.x, p.y);
        showPad(true);
      }
      if (pointers.size === 0) showPad(false);
    }

    // ---- both event families, first one to fire wins ----

    function onPointerDown(e) {
      if (inputMode === "touch" || isControl(e.target)) return;
      inputMode = "pointer";
      e.preventDefault();
      beginAt(e.pointerId, localX(e), localY(e));
    }
    function onPointerMove(e) {
      if (inputMode !== "pointer" || !pointers.has(e.pointerId)) return;
      e.preventDefault();
      moveAt(e.pointerId, localX(e), localY(e));
    }
    function onPointerUp(e) {
      if (inputMode !== "pointer") return;
      endAt(e.pointerId);
    }

    function onTouchStart(e) {
      if (inputMode === "pointer" || isControl(e.target)) return;
      inputMode = "touch";
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        beginAt(t.identifier, t.clientX, t.clientY);
      }
    }
    function onTouchMove(e) {
      if (inputMode !== "touch") return;
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        moveAt(t.identifier, t.clientX, t.clientY);
      }
    }
    function onTouchEnd(e) {
      if (inputMode !== "touch") return;
      for (let i = 0; i < e.changedTouches.length; i++) endAt(e.changedTouches[i].identifier);
    }

    const target = ctx.container;
    ctx.listen(target, "pointerdown", onPointerDown, { passive: false });
    ctx.listen(target, "pointermove", onPointerMove, { passive: false });
    ctx.listen(target, "pointerup", onPointerUp);
    ctx.listen(target, "pointercancel", onPointerUp);
    ctx.listen(target, "touchstart", onTouchStart, { passive: false });
    ctx.listen(target, "touchmove", onTouchMove, { passive: false });
    ctx.listen(target, "touchend", onTouchEnd);
    ctx.listen(target, "touchcancel", onTouchEnd);

    // =====================================================================
    // 10. Restore, seed, first frame.
    // =====================================================================
    if (ctx.capabilities.storage) {
      try {
        const saved = await ctx.storage.get("silk");
        if (saved && typeof saved === "object") {
          const idx = SHAPES.findIndex(s => s.id === saved.shape);
          if (idx >= 0) { shapeIdx = idx; shape = SHAPES[idx]; }
          if (typeof saved.palette === "number") {
            paletteIdx = clamp(saved.palette | 0, 0, PALETTES.length - 1);
          }
          if (saved.sound === false) soundOn = false;
        }
      } catch (_) {}
    }
    refreshBucketColours();
    soundBtn.textContent = soundOn ? "♪" : "⃠";
    soundBtn.style.color = soundOn ? "#eef0ff" : "rgba(238,240,255,0.45)";
    shapeBtn.textContent = shape.name + "  ›";

    // Start in the middle of parameter space, then let the drift wander off.
    paT = pa = (shape.pa.min + shape.pa.max) * 0.5;
    pbT = pb = (shape.pb.min + shape.pb.max) * 0.55;
    updateReadout();

    // Open on a formless ball and let the first second resolve it into the
    // attractor — the bit explaining itself before any text is read.
    seedCloud();
    yaw = yawT = shape.view[0];
    pitch = pitchT = shape.view[1];
    fitScale = 0.78 / (2.3 * shape.nominal);
    center[0] = shape.seed[0]; center[1] = shape.seed[1]; center[2] = shape.seed[2];
    guard(false);
    beginMorph(1500);

    if (useGL) renderGL(0.06, 0.12, POINT_SIZE); else render2D(0.06, 0.12);

    // =====================================================================
    // 11. Frame loop.
    // =====================================================================
    let frameEma = 16.7, workEma = 8, tuneCounter = 0, strikes = 0, musicClock = 0;
    let paSpeed = 0;

    ctx.onFrame((dtMs, timeMs) => {
      const workStart = performance.now();
      const dt = Math.min(dtMs, 50);
      frameEma = frameEma * 0.92 + dt * 0.08;

      if (useGL) sizeTargets();

      // Attract mode: wander parameter space until the first touch, and pick it
      // back up after a long idle so the bit is never a still image.
      if (!started || (timeMs - lastTouchMs > 24000 && pointers.size === 0)) {
        drifting = true;
      }
      if (drifting && pointers.size === 0) {
        driftPhase += dt * 0.000042;
        const fx = 0.5 + 0.40 * Math.sin(driftPhase * 1.7);
        const fy = 0.5 + 0.40 * Math.sin(driftPhase * 1.13 + 1.9);
        paT = shape.pa.min + fx * (shape.pa.max - shape.pa.min);
        pbT = shape.pb.min + fy * (shape.pb.max - shape.pb.min);
      } else if (pointers.size > 0) {
        drifting = false;
      }

      // Glide the live parameters toward the finger so the shape flows instead
      // of snapping, and remember how fast they are moving.
      const prevA = pa, prevB = pb;
      pa += (paT - pa) * 0.085;
      pb += (pbT - pb) * 0.085;
      const spanA = shape.pa.max - shape.pa.min, spanB = shape.pb.max - shape.pb.min;
      const moved = Math.abs(pa - prevA) / spanA + Math.abs(pb - prevB) / spanB;
      paSpeed = paSpeed * 0.86 + moved * 0.14;

      if (morphMs > 0) morphMs = Math.max(0, morphMs - dt);

      if (morphT < 1 && pointers.size < 2) {
        yaw = lerp(yaw, yawT, 0.07);
        pitch = lerp(pitch, pitchT, 0.07);
        roll = lerp(roll, 0, 0.07);
      }

      if (morphT < 1) {
        // Mid-transformation: glide toward the new attractor on an ease curve,
        // then hand the cloud over to the integrator on the last step.
        morphT = Math.min(1, morphT + dt / morphDur);
        const e = morphT * morphT * (3 - 2 * morphT);
        const n = count * 3;
        for (let i = 0; i < n; i++) {
          pos[i] = morphFrom[i] + (morphTo[i] - morphFrom[i]) * e;
        }
        guard(false);
      } else {
        // Substeps track real elapsed time so a 30fps device runs the flow at
        // the same speed, just with chunkier trails.
        const sub = clamp(Math.round(shape.sub * dt / 16.7), 1, shape.sub * 3);
        for (let s = 0; s < sub; s++) shape.step(pos, count, pa, pb);
        if (pointers.size === 1) {
          const p = pointers.values().next().value;
          applyFinger(p.x, p.y, clamp(dt / 16.7, 0.5, 2));
        }
        guard(true);
      }
      measureEnergy();

      // The fade is the whole look: slow when still, so density piles up into
      // smooth sheets. Solve the decay from the measured travel, then let a
      // moving finger or a shape change shorten it further so the picture stays
      // readable while it is changing.
      const agitation = clamp(paSpeed * 26 + (morphMs > 0 ? 1 : 0), 0, 1);
      const fade = clamp(Math.max(dFrac / TRAIL, lerp(0, 0.13, agitation)),
        FADE_MIN, FADE_MAX);
      // Brightness is the ratio of splat to decay, so tying alpha to the fade
      // keeps every shape equally exposed. Fewer particles splat hotter.
      const alpha = clamp(ALPHA_K * fade * Math.sqrt(24000 / Math.max(count, 1)), 0.02, 0.5);

      yaw += dt * 0.00006 * (pointers.size >= 2 ? 0 : 1);

      if (useGL) renderGL(fade, alpha, POINT_SIZE); else render2D(fade, alpha);

      updateReadout();

      // Music follows the flow, retuned a few times a second at most.
      musicClock += dt;
      if (music && musicClock > 320) {
        musicClock = 0;
        const want = clamp(0.16 + energy * 0.8, 0, 1);
        if (Math.abs(want - lastIntensity) > 0.05 && timeMs - lastIntensityMs > 500) {
          lastIntensity = want;
          lastIntensityMs = timeMs;
          try { ctx.music.setIntensity(want); } catch (_) {}
        }
      }

      // Device tuning: spend the frame budget on particles when there is room,
      // and shed them (then the bloom) when there is not.
      //
      // The test has to be on work done per frame, not on the frame delta:
      // a device comfortably holding 60fps and one that is exactly saturated
      // both report ~16.7ms between frames, so tuning on the delta alone would
      // never grow the cloud on any healthy device.
      workEma = workEma * 0.9 + (performance.now() - workStart) * 0.1;
      if (++tuneCounter >= 48) {
        tuneCounter = 0;
        if (frameEma > 27 || workEma > 12) {
          // Two consecutive bad checks before shedding anything: a single
          // slow window is usually a hiccup, and reacting to it makes the
          // cloud visibly pump in and out.
          if (++strikes >= 2) {
            strikes = 0;
            if (count > 7000) {
              count = Math.max(7000, count - 5000);
              sampleValid = false;
            } else if (bloomOn) {
              bloomOn = false;
            }
          }
        } else if (workEma < 6.5 && frameEma < 19) {
          strikes = 0;
          // Recover particles first, then the bloom — and do let the bloom
          // come back, so one slow moment doesn't dim the bit for good.
          if (count < MAX) {
            const next = Math.min(MAX, count + 4000);
            for (let i = count; i < next; i++) respawn(i);
            count = next;
            sampleValid = false;
          } else if (!bloomOn) {
            bloomOn = true;
          }
        } else {
          strikes = 0;
        }
      }
    });

    ctx.platform.ready();
  }
};
