/**
 * N-Body — gravity you can throw.
 *
 * Touch to grow a world, drag to throw it, let go and watch the field take
 * over. Everything after release is direct-summation Newtonian gravity: every
 * body pulls on every other body, integrated with a symplectic leapfrog so
 * orbits close instead of spiralling from integrator drift. Contact merges
 * conserve momentum, so collisions build mass, and mass above the ignition
 * threshold lights a star that then shades every planet around it.
 *
 * There is no scoring and nothing to win. The interesting behaviour —
 * two-body captures, slingshots, resonances, a disc collapsing into rings —
 * is what the force law does on its own once you give it something to work
 * with, so the whole design is about making that legible: a live trajectory
 * preview while you aim, long exposure trails, and real phase shading so you
 * can see which side of a planet the star is on.
 *
 * Contract notes (learned the hard way in this repo, see README):
 * offscreen work goes to OffscreenCanvas, pointer coordinates come from
 * offsetX/offsetY, timers go through ctx.timeout, and the DOM overlay is
 * markup on ctx.createRoot() — the upload validator rejects the alternatives.
 */
window.plethoraBit = {
  meta: {
    title: "N-Body",
    runtime: "plethora-bit@2",
    tags: ["physics", "space", "sandbox", "toy", "generative", "relaxing"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ====================================================================== //
    // Helpers                                                                //
    // ====================================================================== //
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
    const pick = (a) => a[Math.floor(Math.random() * a.length)];

    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });

    // Declared up here because the pointer handlers read it, and those are
    // registered before the frame loop's own state is initialised.
    let lastFrameDt = 1 / 60;

    /**
     * Offscreen bake surface. Creating a canvas element directly is rejected by
     * the upload validator, and ctx.createCanvas() is not a substitute — that
     * mints a display surface the runtime mounts in the container, while these
     * are sprite atlases. Where a WebView has no OffscreenCanvas this returns
     * null and every bake site falls back to drawing live: flat discs, no
     * starfield, no glow. Plainer, still plays.
     */
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function makeSurface(w, h) {
      if (!CAN_BAKE) return null;
      try { return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0)); }
      catch (_) { return null; }
    }

    // ====================================================================== //
    // Surfaces                                                               //
    // ====================================================================== //
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    let W = ctx.width, H = ctx.height;
    const SS = 2; // sprite supersample

    // ====================================================================== //
    // Audio                                                                  //
    // ====================================================================== //
    // ctx.music carries the bed (it survives backgrounding correctly); the
    // event voices are bespoke synthesis, which is the documented reason to
    // reach for a raw AudioContext.
    let ac = null, master = null, dryBus = null, wetBus = null, verb = null;
    let noiseBuf = null, audioDead = false, muted = false;
    let musicHandle = null, musicTried = false;

    // A minor pentatonic, so every voice in the bit agrees with the bed.
    const SCALE_STEPS = [0, 3, 5, 7, 10];
    const NOTES = [];
    for (let oct = -2; oct <= 3; oct++) {
      for (const s of SCALE_STEPS) NOTES.push(440 * Math.pow(2, (57 + oct * 12 + s - 69) / 12));
    }
    NOTES.sort((a, b) => a - b);

    function makeIR(seconds, decay) {
      const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
      const buf = ac.createBuffer(2, len, ac.sampleRate);
      const pre = Math.floor(ac.sampleRate * 0.02);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / (len - pre);
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        }
      }
      return buf;
    }

    function buildAudio() {
      if (ac || audioDead) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }

      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3.2;
      comp.attack.value = 0.003; comp.release.value = 0.28;
      master.connect(comp); comp.connect(ac.destination);

      dryBus = ac.createGain(); dryBus.gain.value = 1; dryBus.connect(master);
      // Space should sound enormous. The tail is most of the character here.
      verb = ac.createConvolver();
      try { verb.buffer = makeIR(2.2, 2.8); } catch (_) {}
      const wetCut = ac.createBiquadFilter();
      wetCut.type = "lowpass"; wetCut.frequency.value = 4200;
      wetBus = ac.createGain(); wetBus.gain.value = 0.85;
      verb.connect(wetCut); wetCut.connect(wetBus); wetBus.connect(master);

      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 2), ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

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
      try {
        const s = ac.createBufferSource();
        s.buffer = ac.createBuffer(1, 1, ac.sampleRate || 22050);
        s.connect(ac.destination); s.start(0);
      } catch (_) {}
    }

    function sendTo(node, amount) {
      if (!verb || amount <= 0) return;
      const s = ac.createGain(); s.gain.value = amount;
      node.connect(s); s.connect(verb);
    }

    function env(gain, t, peak, attack, decay) {
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    function noteForMass(m) {
      // Heavier bodies speak lower, across the whole table.
      const t = clamp((Math.log(m) - Math.log(5)) / (Math.log(1800) - Math.log(5)), 0, 1);
      return NOTES[Math.round((1 - t) * (NOTES.length - 1))];
    }

    /** A world is born: soft struck pluck, pitched by mass. */
    function sfxSpawn(mass) {
      if (!ac || muted || ac.state !== "running") return;
      const t = ac.currentTime;
      const f = noteForMass(mass);
      const gn = ac.createGain();
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = f * 6 + 400;
      gn.connect(lp); lp.connect(dryBus); sendTo(lp, 0.5);
      for (let i = 0; i < 2; i++) {
        const o = ac.createOscillator();
        o.type = i ? "sine" : "triangle";
        o.frequency.value = f * (i ? 2.002 : 1);
        const og = ac.createGain(); og.gain.value = i ? 0.22 : 1;
        o.connect(og); og.connect(gn);
        o.start(t); o.stop(t + 1.6);
      }
      env(gn, t, 0.2, 0.006, 0.9);
    }

    /** Two worlds become one: thump plus a bright shatter, scaled by energy. */
    function sfxMerge(mass, energy) {
      if (!ac || muted || ac.state !== "running") return;
      const t = ac.currentTime;
      const hit = clamp(energy, 0, 1);
      const f = noteForMass(mass);

      const bodyGain = ac.createGain();
      bodyGain.connect(dryBus); sendTo(bodyGain, 0.45);
      const o = ac.createOscillator();
      o.type = "sine";
      const base = clamp(f * 0.5, 42, 190);
      o.frequency.setValueAtTime(base * 1.9, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 0.16);
      o.connect(bodyGain); o.start(t); o.stop(t + 1.2);
      env(bodyGain, t, 0.16 + 0.3 * hit, 0.004, 0.42 + 0.3 * hit);

      const n = ac.createBufferSource();
      n.buffer = noiseBuf;
      n.playbackRate.value = rnd(0.85, 1.2);
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(2600 + 2200 * hit, t);
      bp.frequency.exponentialRampToValueAtTime(600, t + 0.3);
      bp.Q.value = 0.9;
      const ng = ac.createGain();
      n.connect(bp); bp.connect(ng); ng.connect(dryBus); sendTo(ng, 0.9);
      env(ng, t, 0.1 + 0.2 * hit, 0.003, 0.32);
      n.start(t); n.stop(t + 0.8);

      // A struck bell on top so a big impact reads as an event, not a noise.
      if (hit > 0.25) {
        const bg = ac.createGain();
        bg.connect(dryBus); sendTo(bg, 1.1);
        for (const mult of [1, 2.76, 5.4]) {
          const b = ac.createOscillator();
          b.type = "sine"; b.frequency.value = f * mult;
          const bgi = ac.createGain(); bgi.gain.value = mult === 1 ? 1 : 0.3 / mult;
          b.connect(bgi); bgi.connect(bg);
          b.start(t); b.stop(t + 2.4);
        }
        env(bg, t, 0.075 * hit, 0.005, 1.9);
      }
    }

    /** Ignition: a slow swell that opens up. */
    function sfxIgnite() {
      if (!ac || muted || ac.state !== "running") return;
      const t = ac.currentTime;
      const gn = ac.createGain();
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(180, t);
      lp.frequency.exponentialRampToValueAtTime(2600, t + 1.0);
      lp.Q.value = 3;
      gn.connect(lp); lp.connect(dryBus); sendTo(lp, 1.3);
      const root = NOTES[Math.floor(NOTES.length * 0.32)];
      for (const mult of [0.5, 1, 1.5]) {
        const o = ac.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = root * mult;
        o.detune.value = rnd(-8, 8);
        const og = ac.createGain(); og.gain.value = mult === 1 ? 0.5 : 0.25;
        o.connect(og); og.connect(gn);
        o.start(t); o.stop(t + 2.6);
      }
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(0.16, t + 0.55);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    }

    let lastWhoosh = 0;
    /** A near miss at speed. Rate-limited — these happen in clusters. */
    function sfxFlyby(speed, timeMs) {
      if (!ac || muted || ac.state !== "running") return;
      if (timeMs - lastWhoosh < 260) return;
      lastWhoosh = timeMs;
      const t = ac.currentTime;
      const n = ac.createBufferSource();
      n.buffer = noiseBuf; n.playbackRate.value = rnd(0.6, 0.9);
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass"; bp.Q.value = 4.5;
      const f0 = clamp(300 + speed * 1.6, 320, 1800);
      bp.frequency.setValueAtTime(f0 * 0.55, t);
      bp.frequency.linearRampToValueAtTime(f0, t + 0.16);
      bp.frequency.linearRampToValueAtTime(f0 * 0.5, t + 0.42);
      const gn = ac.createGain();
      n.connect(bp); bp.connect(gn); gn.connect(dryBus); sendTo(gn, 1.2);
      env(gn, t, 0.05, 0.09, 0.34);
      n.start(t); n.stop(t + 0.7);
    }

    async function startMusic() {
      if (musicTried || muted || !ctx.capabilities.backgroundMusic) return;
      musicTried = true;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "drift",
          scale: "minorPentatonic",
          volume: 0.3,
          intensity: 0.3,
          density: 0.35,
          fadeInMs: 2600
        });
      } catch (_) { musicHandle = null; }
    }

    function setMuted(next) {
      muted = next;
      if (master) {
        try { master.gain.value = muted ? 0 : 0.9; } catch (_) {}
      }
      if (muted) {
        try { ctx.music.stop({ fadeOutMs: 600 }); } catch (_) {}
        musicHandle = null; musicTried = false;
      } else {
        startMusic();
      }
      if (ctx.capabilities.storage) {
        try { ctx.storage.set("muted", muted); } catch (_) {}
      }
    }

    function haptic(kind) {
      if (!ctx.capabilities.haptics || muted) return;
      try { ctx.platform.haptic(kind); } catch (_) {}
    }

    // ====================================================================== //
    // Physics                                                                //
    // ====================================================================== //
    // World units are CSS pixels at zoom 1, +y down (screen convention — the
    // force law does not care which way is up). G is tuned so a planet 180px
    // out from a 1600-mass star takes about ten seconds to come round, which
    // is roughly the slowest orbit that still reads as motion on a phone.
    const G = 2200;
    const DT = 1 / 150;            // fixed physics step
    const MAX_SUB = 5;             // substep ceiling, stops the death spiral
    const MIN_MASS = 5;
    const MAX_SPAWN_MASS = 300;
    const IGNITE_MASS = 850;       // above this a body lights up
    const MAX_BODIES = 170;
    const CULL_RADIUS = 2600;      // world units from the system's centre
    const MERGE_FACTOR = 0.72;     // fraction of touching radii that merges
    const MAX_LAUNCH = 1200;       // final safety clamp; aiming clamps well below

    const radiusFor = (m) => 2.95 * Math.cbrt(m);

    /** Body kind purely from mass — re-evaluated whenever mass changes. */
    function kindFor(m) {
      if (m >= IGNITE_MASS) return "star";
      if (m >= 300) return "dwarf";
      if (m >= 120) return "gas";
      if (m >= 40) return "rock";
      return "ice";
    }

    const PALETTES = {
      ice: [["#dff1ff", "#9dc6e8", "#5d86ab"], ["#eaf6f3", "#a8d2c8", "#5f8f88"], ["#e9eaf6", "#b0b3d4", "#6a6d96"]],
      rock: [["#e2b48c", "#a9713f", "#5d3a20"], ["#cfc6b4", "#8e8271", "#4d463c"], ["#d99a86", "#a35a48", "#5a2f26"],
             ["#bfe0c2", "#6da878", "#35603f"]],
      gas: [["#f6dcb0", "#d69a5c", "#8a5a2c"], ["#e7d3f2", "#a983c9", "#5f4382"], ["#cfe6f7", "#7fa9d4", "#3f5f8c"],
            ["#f7cfc0", "#d1836d", "#7d4034"]],
      dwarf: [["#c98a6a", "#8a4736", "#3d1c16"], ["#b57a92", "#733d55", "#331825"]],
      star: [["#fff6de", "#ffd27a", "#ff9d3c"], ["#ffffff", "#cfe4ff", "#8fb6ff"], ["#ffe9c9", "#ff9d5c", "#e2542a"]]
    };

    let nextId = 1;
    class Body {
      constructor(x, y, vx, vy, mass, seedPalette) {
        this.id = nextId++;
        this.x = x; this.y = y;
        this.vx = vx; this.vy = vy;
        this.ax = 0; this.ay = 0;
        this.mass = mass;
        this.r = radiusFor(mass);
        this.kind = kindFor(mass);
        this.palette = seedPalette || pick(PALETTES[this.kind]);
        this.seed = Math.random() * 1000;
        this.sprite = null;
        this.spriteR = 0;
        this.dead = false;
        this.fade = 1;            // 1 alive, ramps to 0 while being culled
        this.born = 0;            // seconds lived, drives the spawn pop-in
        this.flareUntil = 0;      // post-merge heat
        // Nearest-neighbour distance², this frame and the two before it. A
        // local minimum in that series is a closest approach — a real flyby,
        // as opposed to merely sitting near something.
        this.nearD = Infinity; this.near1 = Infinity; this.near2 = Infinity;
        this.trail = [];
        bakeBody(this);
      }

      retype() {
        const wasStar = this.kind === "star";
        this.r = radiusFor(this.mass);
        const k = kindFor(this.mass);
        if (k !== this.kind) {
          this.kind = k;
          this.palette = pick(PALETTES[k]);
          this.sprite = null;     // new kind, new surface — force the re-bake
        }
        bakeBody(this);
        return !wasStar && this.kind === "star";
      }
    }

    /** @type {Body[]} */
    let bodies = [];
    /** Effects live outside the simulation — they never pull on anything. */
    let flashes = [], sparks = [];

    /**
     * Accelerations by direct summation over unordered pairs. Softening keeps
     * a very close pass from launching a body to infinity between steps; it is
     * small relative to real separations, so ordinary orbits are unaffected.
     *
     * `collect` is set on the frame's last substep only, so merge and flyby
     * bookkeeping runs once per frame instead of once per substep.
     */
    let pendingMerges = [];
    function computeAccel(collect) {
      const n = bodies.length;
      for (let i = 0; i < n; i++) { bodies[i].ax = 0; bodies[i].ay = 0; }
      if (collect) {
        pendingMerges.length = 0;
        for (let i = 0; i < n; i++) bodies[i].nearD = Infinity;
      }

      for (let i = 0; i < n; i++) {
        const a = bodies[i];
        const ax = a.x, ay = a.y, am = a.mass, ar = a.r;
        for (let j = i + 1; j < n; j++) {
          const b = bodies[j];
          const dx = b.x - ax, dy = b.y - ay;
          const touch = ar + b.r;
          const d2 = dx * dx + dy * dy;
          const soft = d2 + touch * touch * 0.18 + 4;
          const invD = 1 / Math.sqrt(soft);
          const f = G * invD * invD * invD;
          const fx = dx * f, fy = dy * f;
          a.ax += fx * b.mass; a.ay += fy * b.mass;
          b.ax -= fx * am;     b.ay -= fy * am;

          if (collect) {
            const merge = touch * MERGE_FACTOR;
            if (d2 < merge * merge) {
              pendingMerges.push(i, j);
            } else {
              if (d2 < a.nearD) a.nearD = d2;
              if (d2 < b.nearD) b.nearD = d2;
            }
          }
        }
      }
    }

    /**
     * Perfectly inelastic contact merge. Momentum is conserved exactly; the
     * kinetic energy that goes missing is the energy the flash is showing.
     */
    function resolveMerges(timeMs) {
      if (!pendingMerges.length) return;
      const gone = new Set();
      for (let k = 0; k < pendingMerges.length; k += 2) {
        const a = bodies[pendingMerges[k]], b = bodies[pendingMerges[k + 1]];
        if (!a || !b || gone.has(a.id) || gone.has(b.id)) continue;

        const big = a.mass >= b.mass ? a : b;
        const small = big === a ? b : a;
        const M = a.mass + b.mass;

        const rvx = a.vx - b.vx, rvy = a.vy - b.vy;
        const relSpeed = Math.hypot(rvx, rvy);
        const reduced = (a.mass * b.mass) / M;
        // Normalised against a hard hit so the flash and the voice both scale.
        const energy = clamp((0.5 * reduced * relSpeed * relSpeed) / 260000, 0, 1);
        const hx = (a.x * a.mass + b.x * b.mass) / M;
        const hy = (a.y * a.mass + b.y * b.mass) / M;

        big.vx = (a.vx * a.mass + b.vx * b.mass) / M;
        big.vy = (a.vy * a.mass + b.vy * b.mass) / M;
        big.x = hx; big.y = hy;
        big.mass = M;
        const ignited = big.retype();
        big.flareUntil = timeMs + 520 + 700 * energy;
        small.dead = true;
        gone.add(small.id);

        addFlash(hx, hy, small.r + big.r * 0.6, energy, big.palette[0]);
        addSparks(hx, hy, small, big, energy);
        sfxMerge(M, energy);
        if (energy > 0.18) {
          haptic(energy > 0.55 ? "heavy" : "medium");
          try { ctx.music.duck(clamp(0.2 + energy * 0.5, 0, 0.8), 700); } catch (_) {}
        }
        if (ignited) {
          sfxIgnite();
          haptic("success");
          addFlash(hx, hy, big.r * 3.4, 1, "#fff3d0");
          try { ctx.platform.milestone("star_ignited", { mass: Math.round(M) }); } catch (_) {}
        }
      }
      pendingMerges.length = 0;
      if (gone.size) bodies = bodies.filter((b) => !b.dead);
    }

    function step(dt, collect, timeMs) {
      const n = bodies.length;
      // Leapfrog, kick-drift-kick. Symplectic, so orbits stay closed rather
      // than winding in or out from integrator error alone.
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        b.vx += b.ax * dt * 0.5; b.vy += b.ay * dt * 0.5;
        b.x += b.vx * dt;        b.y += b.vy * dt;
      }
      computeAccel(collect);
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        b.vx += b.ax * dt * 0.5; b.vy += b.ay * dt * 0.5;
      }
      if (collect) resolveMerges(timeMs);
    }

    /**
     * Fire a whoosh on closest approach — the frame where a body's distance to
     * its nearest neighbour stops falling and starts rising. Proximity alone
     * would drone continuously on any tight binary; this fires once per pass.
     */
    const FLYBY_D2 = 150 * 150;
    function detectFlybys(timeMs) {
      for (const b of bodies) {
        const d = b.nearD;
        if (b.near1 < b.near2 && b.near1 < d && b.near1 < FLYBY_D2) {
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > 160) sfxFlyby(sp, timeMs);
        }
        b.near2 = b.near1; b.near1 = d;
      }
    }

    /** Mass-weighted centre of the system, used for framing and for culling. */
    let sysX = 0, sysY = 0;
    function systemCentre() {
      let m = 0, x = 0, y = 0;
      for (const b of bodies) { m += b.mass; x += b.x * b.mass; y += b.y * b.mass; }
      if (m > 0) { sysX = x / m; sysY = y / m; }
      return m;
    }

    function cullEscapees(dt) {
      let removed = false;
      for (const b of bodies) {
        const d = Math.hypot(b.x - sysX, b.y - sysY);
        if (d > CULL_RADIUS) {
          b.fade -= dt * 1.6;
          if (b.fade <= 0) { b.dead = true; removed = true; }
        } else if (b.fade < 1) {
          b.fade = Math.min(1, b.fade + dt * 2);
        }
      }
      if (removed) bodies = bodies.filter((b) => !b.dead);
    }

    // ====================================================================== //
    // Baking                                                                 //
    // ====================================================================== //
    /**
     * Shading is a function of position on the unit disc, so one sprite serves
     * every body at every size: bake it once, then rotate it toward the light
     * when drawing. That rotation is what gives planets real phases as they
     * come round a star.
     */
    const SHADE_R = 96;
    let shadeSprite = null;
    function bakeShade() {
      const size = SHADE_R * 2;
      const surf = makeSurface(size, size);
      if (!surf) return null;
      const s = surf.getContext("2d");
      const img = s.createImageData(size, size);
      const d = img.data;
      // Light arrives from local -x, tilted a little toward the viewer.
      const lx = -0.94, ly = 0, lz = 0.34;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const nx = (x + 0.5 - SHADE_R) / SHADE_R;
          const ny = (y + 0.5 - SHADE_R) / SHADE_R;
          const q = nx * nx + ny * ny;
          const i = (y * size + x) * 4;
          if (q >= 1) { d[i + 3] = 0; continue; }
          const nz = Math.sqrt(1 - q);
          const lam = Math.max(0, nx * lx + ny * ly + nz * lz);
          const edge = clamp((1 - q) * 26, 0, 1);   // antialias the limb
          // Dark side: black with rising alpha. Ambient keeps it from going flat.
          const dark = Math.pow(1 - lam, 1.35) * 0.9;
          // Lit limb catches a thin bright rim.
          const rim = Math.pow(1 - nz, 3.2) * lam * 0.85;
          if (rim > dark) {
            d[i] = 255; d[i + 1] = 250; d[i + 2] = 235;
            d[i + 3] = Math.round(clamp(rim - dark, 0, 1) * 210 * edge);
          } else {
            d[i] = 4; d[i + 1] = 6; d[i + 2] = 14;
            d[i + 3] = Math.round(clamp(dark - rim, 0, 1) * 236 * edge);
          }
        }
      }
      s.putImageData(img, 0, 0);
      return surf;
    }

    /** Additive glow discs, one per colour, built on demand. */
    const glowCache = new Map();
    function glowSprite(color) {
      let s = glowCache.get(color);
      if (s !== undefined) return s;
      const R = 64, size = R * 2;
      const surf = makeSurface(size, size);
      if (!surf) { glowCache.set(color, null); return null; }
      const c = surf.getContext("2d");
      const grad = c.createRadialGradient(R, R, 0, R, R, R);
      grad.addColorStop(0, color);
      grad.addColorStop(0.18, color);
      grad.addColorStop(0.45, hexA(color, 0.28));
      grad.addColorStop(1, hexA(color, 0));
      c.fillStyle = grad;
      c.fillRect(0, 0, size, size);
      glowCache.set(color, surf);
      return surf;
    }

    /** #rrggbb -> rgba() at the given alpha. Palettes are all hex literals. */
    function hexA(hex, a) {
      const h = hex.replace("#", "");
      const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }

    /**
     * Surface texture for one body, baked once per size step. Rocky worlds get
     * craters, gas giants get banding, ice gets fractured plates, stars get
     * granulation. Everything is drawn flat here — the sphere arrives later
     * from the shade sprite.
     */
    function bakeBody(b) {
      const R = Math.max(6, Math.min(96, b.r * SS));
      if (b.sprite && Math.abs(b.spriteR - R) < R * 0.12) return;
      const size = Math.ceil(R * 2);
      const surf = makeSurface(size, size);
      b.spriteR = R;
      if (!surf) { b.sprite = null; return; }
      const c = surf.getContext("2d");
      const [c0, c1, c2] = b.palette;
      const cx = size / 2, cy = size / 2;

      c.save();
      c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip();

      const base = c.createLinearGradient(0, 0, 0, size);
      base.addColorStop(0, c0); base.addColorStop(0.55, c1); base.addColorStop(1, c2);
      c.fillStyle = base; c.fillRect(0, 0, size, size);

      let s = b.seed;
      const nrnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

      if (b.kind === "gas" || b.kind === "dwarf") {
        // Bands, wobbled along their length so they read as flow, not stripes.
        const bands = rndInt(6, 11);
        for (let i = 0; i < bands; i++) {
          const y = (i / bands) * size + nrnd() * 6;
          const h = size / bands * rnd(0.5, 1.2);
          c.globalAlpha = 0.16 + nrnd() * 0.24;
          c.fillStyle = nrnd() > 0.5 ? c0 : c2;
          c.beginPath();
          c.moveTo(0, y);
          for (let x = 0; x <= size; x += size / 7) {
            c.lineTo(x, y + Math.sin(x * 0.05 + nrnd() * 3) * h * 0.24);
          }
          c.lineTo(size, y + h); c.lineTo(0, y + h);
          c.closePath(); c.fill();
        }
        // One storm, because every gas giant deserves a spot.
        if (nrnd() > 0.45) {
          c.globalAlpha = 0.5;
          c.fillStyle = c0;
          c.beginPath();
          c.ellipse(cx + (nrnd() - 0.5) * R, cy + (nrnd() - 0.5) * R * 1.2,
            R * 0.26, R * 0.15, nrnd(), 0, TAU);
          c.fill();
        }
      } else if (b.kind === "star") {
        // Granulation plus a hot core wash.
        for (let i = 0; i < 90; i++) {
          const a = nrnd() * TAU, rr = Math.sqrt(nrnd()) * R;
          c.globalAlpha = 0.05 + nrnd() * 0.16;
          c.fillStyle = nrnd() > 0.4 ? c0 : c2;
          c.beginPath();
          c.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * rnd(0.06, 0.2), 0, TAU);
          c.fill();
        }
        c.globalAlpha = 1;
        const core = c.createRadialGradient(cx, cy, 0, cx, cy, R);
        core.addColorStop(0, "#ffffff");
        core.addColorStop(0.45, hexA(c0, 0.75));
        core.addColorStop(1, hexA(c1, 0));
        c.fillStyle = core; c.fillRect(0, 0, size, size);
      } else {
        // Rock and ice: mottling, then craters or plates.
        for (let i = 0; i < 26; i++) {
          const a = nrnd() * TAU, rr = Math.sqrt(nrnd()) * R;
          c.globalAlpha = 0.06 + nrnd() * 0.13;
          c.fillStyle = nrnd() > 0.5 ? c0 : c2;
          c.beginPath();
          c.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * rnd(0.12, 0.38), 0, TAU);
          c.fill();
        }
        if (b.kind === "rock") {
          const craters = rndInt(3, 8);
          for (let i = 0; i < craters; i++) {
            const a = nrnd() * TAU, rr = Math.sqrt(nrnd()) * R * 0.85;
            const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
            const cr = R * rnd(0.07, 0.19);
            c.globalAlpha = 0.3;
            c.fillStyle = c2;
            c.beginPath(); c.arc(x, y, cr, 0, TAU); c.fill();
            c.globalAlpha = 0.28;
            c.strokeStyle = c0; c.lineWidth = Math.max(1, cr * 0.28);
            c.beginPath(); c.arc(x, y - cr * 0.12, cr * 0.92, 0, TAU); c.stroke();
          }
        } else {
          c.globalAlpha = 0.3;
          c.strokeStyle = c0;
          c.lineWidth = Math.max(1, R * 0.045);
          for (let i = 0; i < 7; i++) {
            c.beginPath();
            c.moveTo(nrnd() * size, nrnd() * size);
            for (let k = 0; k < 3; k++) c.lineTo(nrnd() * size, nrnd() * size);
            c.stroke();
          }
        }
      }
      c.restore();
      b.sprite = surf;
    }

    /**
     * Deep field: nebula wash and a few thousand stars.
     *
     * Baked at exactly the device-pixel size it is drawn at, including the
     * parallax margin. Any other size makes the per-frame blit a resample —
     * a full-screen one, every frame, which profiled as the single most
     * expensive thing the bit did.
     */
    const BG_PAD = 30;
    let bg = null, bgW = 0, bgH = 0, bgCssW = 0, bgCssH = 0, bgDpr = 1;
    function bakeBackground() {
      // Must match the canvas DPR exactly. Baking smaller and letting drawImage
      // stretch turns the clear into a full-screen bilinear resample.
      const dpr = bgDpr = Math.max(1, ctx.dpr || 1);
      const w = Math.ceil((W + BG_PAD * 2) * dpr), h = Math.ceil((H + BG_PAD * 2) * dpr);
      const surf = makeSurface(w, h);
      bgW = W; bgH = H;
      bgCssW = w / dpr; bgCssH = h / dpr;
      if (!surf) { bg = null; return; }
      const c = surf.getContext("2d");

      c.fillStyle = "#04060f";
      c.fillRect(0, 0, w, h);

      // Two nebula blooms, kept dim so planets stay the brightest thing.
      const blooms = [
        { x: rnd(0.1, 0.5) * w, y: rnd(0.1, 0.45) * h, r: Math.max(w, h) * rnd(0.5, 0.8), col: "#3b2a6b" },
        { x: rnd(0.5, 0.95) * w, y: rnd(0.5, 0.95) * h, r: Math.max(w, h) * rnd(0.45, 0.75), col: "#123c52" }
      ];
      for (const b of blooms) {
        const grad = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        grad.addColorStop(0, hexA(b.col, 0.5));
        grad.addColorStop(0.5, hexA(b.col, 0.16));
        grad.addColorStop(1, hexA(b.col, 0));
        c.fillStyle = grad; c.fillRect(0, 0, w, h);
      }

      const count = Math.round((w * h) / 2600);
      for (let i = 0; i < count; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const m = Math.random();
        const r = m > 0.985 ? rnd(1.4, 2.3) * dpr : rnd(0.3, 0.95) * dpr;
        const a = m > 0.985 ? rnd(0.75, 1) : rnd(0.1, 0.6);
        c.globalAlpha = a;
        c.fillStyle = m > 0.93 ? "#cfe2ff" : m > 0.86 ? "#ffe6cc" : "#ffffff";
        c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        if (m > 0.985) {                       // a cross flare on the brightest
          c.globalAlpha = a * 0.45;
          c.fillRect(x - r * 4, y - dpr * 0.2, r * 8, dpr * 0.4);
          c.fillRect(x - dpr * 0.2, y - r * 4, dpr * 0.4, r * 8);
        }
      }
      c.globalAlpha = 1;
      bg = surf;
    }

    // ====================================================================== //
    // Effects                                                                //
    // ====================================================================== //
    function addFlash(x, y, r, energy, color) {
      flashes.push({ x, y, r0: r, r: r, t: 0, life: 0.34 + 0.4 * energy, energy, color });
      if (flashes.length > 16) flashes.shift();
    }

    function addSparks(x, y, small, big, energy) {
      const n = Math.round(6 + 22 * energy);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = rnd(30, 150) * (0.4 + energy);
        sparks.push({
          x, y,
          vx: big.vx * 0.3 + Math.cos(a) * sp,
          vy: big.vy * 0.3 + Math.sin(a) * sp,
          t: 0, life: rnd(0.4, 1.3),
          r: rnd(0.8, 2.4),
          color: Math.random() > 0.5 ? small.palette[0] : big.palette[0]
        });
      }
      while (sparks.length > 240) sparks.shift();
    }

    function stepEffects(dt) {
      for (const f of flashes) { f.t += dt; f.r = f.r0 * (1 + 3.2 * (f.t / f.life)); }
      flashes = flashes.filter((f) => f.t < f.life);
      for (const s of sparks) {
        s.t += dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.vx *= 1 - 1.1 * dt; s.vy *= 1 - 1.1 * dt;
      }
      sparks = sparks.filter((s) => s.t < s.life);
    }

    // ====================================================================== //
    // Camera                                                                 //
    // ====================================================================== //
    // Frames the system without ever chasing a single escapee: the target
    // extent covers most of the mass, and the lerp is slow enough that it
    // reads as a held shot rather than a zoom.
    const cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };

    function updateCamera(dt) {
      if (!bodies.length) {
        cam.tx = 0; cam.ty = 0; cam.tz = 1;
      } else {
        let mass = 0, ex = 0;
        for (const b of bodies) mass += b.mass;
        // Mass-weighted RMS radius: outliers move it, but cannot dominate it.
        for (const b of bodies) {
          const d = Math.hypot(b.x - sysX, b.y - sysY);
          ex += b.mass * d * d;
        }
        const rms = mass > 0 ? Math.sqrt(ex / mass) : 0;
        const extent = Math.max(160, rms * 2.1 + 90);
        cam.tx = sysX; cam.ty = sysY;
        cam.tz = clamp(Math.min(W, H) * 0.5 / extent, 0.62, 1);
      }
      const k = 1 - Math.pow(0.001, dt * 0.5);
      cam.x = lerp(cam.x, cam.tx, k);
      cam.y = lerp(cam.y, cam.ty, k);
      cam.zoom = lerp(cam.zoom, cam.tz, k);
    }

    const toWorld = (sx, sy) => ({
      x: (sx - W / 2) / cam.zoom + cam.x,
      y: (sy - H / 2) / cam.zoom + cam.y
    });

    // ====================================================================== //
    // Input                                                                  //
    // ====================================================================== //
    /**
     * Placing a world happens in two beats, and the finger never covers either.
     *
     *   press and hold   the world appears under your finger and gains mass
     *   drag outward     mass locks, the world stays put, and you aim
     *
     * The first version threw on the finger's own velocity, which was the
     * mistake: it made the trajectory preview useless. You could not study the
     * preview and then release, because holding still to look sets the velocity
     * to zero. Aiming has to be a *static* quantity you can sit and adjust.
     *
     * Speed is quoted as a multiple of the local circular-orbit speed rather
     * than in pixels per second, so a drag of AIM_REF puts the world into a
     * circular orbit wherever you happen to be standing. That is the whole fix
     * for "hard to spin planets around stuff": orbit is the default outcome of
     * an ordinary drag instead of a lucky one.
     *
     * Nurseries are kept in *screen* space and converted to world space when
     * read. The camera drifts while you hold, and a world-space nursery would
     * slide out from under a stationary finger.
     */
    const nurseries = new Map();
    let started = false;

    const AIM_REF = 96;          // drag in screen px that means "circular orbit"
    const AIM_MAX_MULT = 2.4;    // hardest throw, as a multiple of circular speed
    const AIM_LOCK = 13;         // drag in screen px that locks mass and starts aiming
    const FREE_SCALE = 1.7;      // world px/s per screen px, with nothing to orbit
    const SNAP_COS = 0.975;      // ~13 degrees of tangent
    const SNAP_SPEED = 0.13;     // and within 13% of circular

    /**
     * The body that sets the orbital scale where a world is being placed —
     * strongest pull, not simply the heaviest, so a binary or a cluster hands
     * back whichever star actually governs that spot. Anything not clearly
     * heavier than the world being placed is ignored; two comparable masses do
     * not have a "circular orbit" worth quoting.
     */
    function attractorFor(x, y, mass) {
      let best = null, bestPull = 0;
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.mass < mass * 4) continue;
        const dx = b.x - x, dy = b.y - y;
        const pull = b.mass / Math.max(1, dx * dx + dy * dy);
        if (pull > bestPull) { bestPull = pull; best = b; }
      }
      return best;
    }

    /**
     * Everything the aim needs: where the world will start, how fast, whether
     * that orbit is bound, and whether it has snapped to a clean circle.
     * Velocities are built in the attractor's frame, so aiming still works
     * around a star that is itself moving.
     */
    function nurseryState(n) {
      const p = toWorld(n.ox, n.oy);
      const a = attractorFor(p.x, p.y, n.mass);
      const out = {
        x: p.x, y: p.y,
        vx: a ? a.vx : 0, vy: a ? a.vy : 0,
        len: 0, vc: 0, bound: false, snapped: false, attractor: a
      };

      const dxs = n.fx - n.ox, dys = n.fy - n.oy;
      const len = Math.hypot(dxs, dys);
      out.len = len;
      if (len > 0.001) {
        const dirx = dxs / len, diry = dys / len;
        if (a) {
          const rx = p.x - a.x, ry = p.y - a.y;
          const r = Math.max(a.r * 1.5, Math.hypot(rx, ry));
          const vc = out.vc = Math.sqrt(G * a.mass / r);
          const sp = vc * clamp(len / AIM_REF, 0, AIM_MAX_MULT);
          // Tangent, turned to whichever way round the player is aiming.
          let tx = -ry / r, ty = rx / r;
          if (tx * dirx + ty * diry < 0) { tx = -tx; ty = -ty; }
          if (tx * dirx + ty * diry > SNAP_COS && Math.abs(sp - vc) / vc < SNAP_SPEED) {
            out.snapped = true;
            out.vx = a.vx + tx * vc; out.vy = a.vy + ty * vc;
          } else {
            out.vx = a.vx + dirx * sp; out.vy = a.vy + diry * sp;
          }
        } else {
          const sp = len * FREE_SCALE;
          out.vx = dirx * sp; out.vy = diry * sp;
        }
      }

      // Two-body specific orbital energy. Negative means it comes back, which
      // is the one thing worth telling the player before they let go.
      if (a) {
        const rx = p.x - a.x, ry = p.y - a.y;
        const r = Math.max(a.r * 1.5, Math.hypot(rx, ry));
        const vrx = out.vx - a.vx, vry = out.vy - a.vy;
        out.bound = 0.5 * (vrx * vrx + vry * vry) - G * a.mass / r < 0;
      }

      const sp = Math.hypot(out.vx, out.vy);
      if (sp > MAX_LAUNCH) { out.vx = out.vx / sp * MAX_LAUNCH; out.vy = out.vy / sp * MAX_LAUNCH; }
      return out;
    }

    function massAt(heldSec) {
      const t = 1 - Math.exp(-heldSec / 1.05);
      return MIN_MASS + (MAX_SPAWN_MASS - MIN_MASS) * Math.pow(t, 1.5);
    }

    // offsetX/offsetY are already canvas-relative, which keeps us off
    // getBoundingClientRect (rejected by the upload validator) and avoids a
    // forced reflow on every pointer event.
    function localPoint(e) {
      if (typeof e.offsetX === "number" && typeof e.offsetY === "number") {
        return { x: e.offsetX, y: e.offsetY };
      }
      return { x: e.clientX, y: e.clientY };
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      if (!started) {
        started = true;
        try { ctx.platform.start(); } catch (_) {}
      }
      unlockAudio();
      startMusic();
      if (bodies.length + nurseries.size >= MAX_BODIES) {
        toast("Space is full — clear or let some merge");
        return;
      }
      const p = localPoint(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      nurseries.set(e.pointerId, {
        ox: p.x, oy: p.y, fx: p.x, fy: p.y,
        held: 0, mass: MIN_MASS, locked: false,
        seed: Math.random() * 1000
      });
      haptic("light");
      hideHint();
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      const n = nurseries.get(e.pointerId);
      if (!n) return;
      e.preventDefault();
      const p = localPoint(e);
      n.fx = p.x; n.fy = p.y;
      if (!n.locked && Math.hypot(p.x - n.ox, p.y - n.oy) > AIM_LOCK) {
        // Mass stops growing the moment aiming starts. Otherwise a careful aim
        // silently buys you a heavier world than a careless one.
        n.locked = true;
        haptic("light");
      }
    }, { passive: false });

    let lastSnap = false;
    function release(e) {
      const n = nurseries.get(e.pointerId);
      if (!n) return;
      nurseries.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      const s = nurseryState(n);
      const b = new Body(s.x, s.y, s.vx, s.vy, n.mass);
      b.seed = n.seed;
      bodies.push(b);
      sfxSpawn(n.mass);
      haptic(s.snapped ? "success" : "light");
      try {
        ctx.platform.interact({
          type: "spawn", mass: Math.round(n.mass),
          orbit: s.snapped ? "circular" : s.bound ? "bound" : "open"
        });
      } catch (_) {}
    }

    ctx.listen(canvas, "pointerup", (e) => { e.preventDefault(); release(e); }, { passive: false });
    ctx.listen(canvas, "pointercancel", (e) => {
      nurseries.delete(e.pointerId);
    }, { passive: false });

    /**
     * Where the held world would go if released now. Integrated as a test
     * particle in the current field — it does not pull back, which is exactly
     * the approximation the player is making in their head anyway. Long enough
     * to show more than a full orbit at the default scale.
     */
    function predict(s) {
      const steps = clamp(Math.round(6000 / Math.max(1, bodies.length)), 90, 420);
      const dt = 1 / 40;
      let x = s.x, y = s.y, vx = s.vx, vy = s.vy;
      const pts = [x, y];
      for (let k = 0; k < steps; k++) {
        let axs = 0, ays = 0;
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];
          const dx = b.x - x, dy = b.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < b.r * b.r) return pts;      // it hits something; stop there
          const soft = d2 + b.r * b.r * 0.2 + 4;
          const f = G * b.mass / (soft * Math.sqrt(soft));
          axs += dx * f; ays += dy * f;
        }
        vx += axs * dt; vy += ays * dt;
        x += vx * dt;   y += vy * dt;
        pts.push(x, y);
        if (Math.hypot(x - sysX, y - sysY) > CULL_RADIUS) break;
      }
      return pts;
    }

    // ====================================================================== //
    // Scenarios                                                              //
    // ====================================================================== //
    /** Zero the net momentum so a seeded system holds still in frame. */
    function balance(list) {
      let m = 0, px = 0, py = 0, cx = 0, cy = 0;
      for (const b of list) { m += b.mass; px += b.vx * b.mass; py += b.vy * b.mass; cx += b.x * b.mass; cy += b.y * b.mass; }
      if (m <= 0) return;
      const vx = px / m, vy = py / m, mx = cx / m, my = cy / m;
      for (const b of list) {
        b.vx -= vx; b.vy -= vy;
        b.x += W / 2 - mx; b.y += H / 2 - my;
      }
    }

    /** Circular-orbit speed about an enclosed mass at radius r. */
    const vCirc = (M, r) => Math.sqrt(G * M / Math.max(1, r));

    function orbiter(cxp, cyp, cvx, cvy, M, r, mass, ecc, retro) {
      const a = Math.random() * TAU;
      const dir = retro ? -1 : 1;
      const v = vCirc(M, r) * (1 + (ecc || 0));
      return new Body(
        cxp + Math.cos(a) * r, cyp + Math.sin(a) * r,
        cvx - Math.sin(a) * v * dir, cvy + Math.cos(a) * v * dir,
        mass
      );
    }

    const SCENARIOS = [
      {
        name: "A star and its planets",
        build() {
          const list = [];
          const star = new Body(W / 2, H / 2, 0, 0, rnd(2500, 3200));
          list.push(star);
          const n = rndInt(4, 6);
          const span = Math.min(W, H);
          for (let i = 0; i < n; i++) {
            const r = span * (0.16 + 0.13 * i) + rnd(-8, 8);
            list.push(orbiter(star.x, star.y, 0, 0, star.mass, r, rnd(16, 85), rnd(-0.06, 0.1)));
          }
          return list;
        }
      },
      {
        name: "Binary stars",
        build() {
          const list = [];
          const m = rnd(1500, 2100), sep = Math.min(W, H) * 0.2;
          // Each star orbits the barycentre, so the pair is stable on its own.
          const v = Math.sqrt(G * m / (2 * sep));
          const a = new Body(W / 2 - sep, H / 2, 0, -v, m);
          const b = new Body(W / 2 + sep, H / 2, 0, v, m);
          list.push(a, b);
          for (let i = 0; i < rndInt(3, 5); i++) {
            const r = sep * rnd(3.2, 6);
            list.push(orbiter(W / 2, H / 2, 0, 0, m * 2, r, rnd(14, 52), rnd(-0.05, 0.05)));
          }
          return list;
        }
      },
      {
        name: "A collapsing disc",
        build() {
          const list = [];
          const star = new Body(W / 2, H / 2, 0, 0, rnd(2300, 2900));
          list.push(star);
          const n = 42;
          const span = Math.min(W, H);
          // A cold disc: near-circular, slightly perturbed. It finds its own
          // rings and shepherds within a minute or so.
          for (let i = 0; i < n; i++) {
            const r = span * rnd(0.14, 0.62);
            const b = orbiter(star.x, star.y, 0, 0, star.mass, r, rnd(5, 22), rnd(-0.04, 0.04));
            b.vx += rnd(-6, 6); b.vy += rnd(-6, 6);
            list.push(b);
          }
          return list;
        }
      },
      {
        name: "Two clusters, closing",
        build() {
          const list = [];
          const span = Math.min(W, H);
          for (const side of [-1, 1]) {
            const cxp = W / 2 + side * span * 0.36;
            const cyp = H / 2 - side * span * 0.22;
            const bulk = -side * rnd(24, 44);
            const core = new Body(cxp, cyp, bulk, side * 12, rnd(520, 900));
            list.push(core);
            for (let i = 0; i < 12; i++) {
              const r = span * rnd(0.04, 0.14);
              const b = orbiter(cxp, cyp, bulk, side * 12, core.mass, r, rnd(6, 34), rnd(-0.2, 0.2));
              list.push(b);
            }
          }
          return list;
        }
      }
    ];

    let scenarioIndex = 0;
    function seed(index) {
      bodies = SCENARIOS[index % SCENARIOS.length].build();
      balance(bodies);
      computeAccel(false);
      systemCentre();
      flashes.length = 0; sparks.length = 0;
      cam.x = sysX; cam.y = sysY;
      updateCamera(1);
      cam.zoom = cam.tz;
      toast(SCENARIOS[index % SCENARIOS.length].name);
    }

    // ====================================================================== //
    // Overlay                                                                //
    // ====================================================================== //
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    const BTN =
      "width:38px;height:38px;border-radius:19px;border:1px solid rgba(150,190,240,0.22);" +
      "background:rgba(12,20,38,0.62);color:#d8e8ff;font-size:16px;line-height:1;" +
      "display:flex;align-items:center;justify-content:center;pointer-events:auto;" +
      "font-family:" + FONT + ";padding:0;-webkit-tap-highlight-color:transparent;cursor:pointer;";

    ui.innerHTML =
      '<div data-el="count" style="position:absolute;left:16px;top:' + (ctx.safeArea.top + 16) +
        'px;pointer-events:none;font-family:' + FONT + ';color:rgba(206,228,255,0.72);' +
        'font-size:12.5px;letter-spacing:0.6px;text-shadow:0 1px 8px rgba(0,0,0,0.8);"></div>' +
      '<div style="position:absolute;right:12px;top:' + (ctx.safeArea.top + 10) +
        'px;display:flex;gap:8px;pointer-events:none;">' +
        '<button data-el="seed" aria-label="New system" style="' + BTN + '">✦</button>' +
        '<button data-el="clear" aria-label="Clear" style="' + BTN + '">✕</button>' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">🔊</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      '<div data-el="hint" style="position:absolute;left:0;right:0;top:66%;text-align:center;' +
        'padding:0 30px;pointer-events:none;font-family:' + FONT + ';font-size:14px;' +
        'color:rgba(214,232,255,0.86);letter-spacing:0.3px;line-height:1.7;' +
        'text-shadow:0 2px 12px rgba(0,0,0,0.9);transition:opacity 0.8s;">' +
        'Hold to grow a world<br>Drag out to set its orbit' +
      '</div>' +
      '<div data-el="toast" style="position:absolute;left:0;right:0;top:' + (ctx.safeArea.top + 62) +
        'px;text-align:center;pointer-events:none;font-family:' + FONT + ';font-size:12.5px;' +
        'color:rgba(206,228,255,0.8);letter-spacing:0.5px;opacity:0;transition:opacity 0.45s;' +
        'text-shadow:0 1px 8px rgba(0,0,0,0.8);"></div>' +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;align-items:center;' +
        'justify-content:center;padding:24px;pointer-events:auto;background:rgba(2,5,12,0.72);"></div>';

    const countEl = ui.querySelector('[data-el="count"]');
    const hintEl = ui.querySelector('[data-el="hint"]');
    const toastEl = ui.querySelector('[data-el="toast"]');
    const panelEl = ui.querySelector('[data-el="panel"]');
    const muteEl = ui.querySelector('[data-el="mute"]');

    let hintHidden = false;
    function hideHint() {
      if (hintHidden) return;
      hintHidden = true;
      hintEl.style.opacity = "0";
    }

    let toastTimer = 0;
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.style.opacity = "1";
      const mine = ++toastTimer;
      ctx.timeout(() => { if (mine === toastTimer) toastEl.style.opacity = "0"; }, 2200);
    }

    function showHelp() {
      panelEl.innerHTML =
        '<div style="width:100%;max-width:330px;max-height:76%;overflow:auto;padding:24px;' +
          'border-radius:20px;background:rgba(10,18,34,0.97);color:#e6f2ff;font-family:' + FONT + ';' +
          'font-size:14.5px;line-height:1.62;box-shadow:0 18px 50px rgba(0,0,0,0.7);' +
          'border:1px solid rgba(120,170,230,0.18);">' +
          '<div style="font-size:18px;font-weight:650;letter-spacing:0.3px;margin-bottom:14px;">N-Body</div>' +
          '<ul style="margin:0;padding-left:20px;">' +
            '<li><b>Press and hold</b> anywhere — a world appears and gains mass for as long as you hold.</li>' +
            '<li><b>Drag outward</b> to aim. Mass locks, and the line shows where it will go.</li>' +
            '<li>The <b>first tick</b> on the aim line is a circular orbit; snap to it and the path turns gold. Past the <b>second tick</b> it escapes for good.</li>' +
            '<li>A <b>solid</b> path comes back. A <b>dashed</b> one is leaving.</li>' +
            '<li>Every body pulls on every other one. Orbits, slingshots and captures all come out of that.</li>' +
            '<li>Bodies that touch <b>merge</b> and keep their combined momentum.</li>' +
            '<li>Enough mass in one place <b>ignites a star</b>, which then lights the planets around it.</li>' +
            '<li><b>✦</b> seeds a new system · <b>✕</b> empties space.</li>' +
          '</ul>' +
          '<div style="text-align:center;margin-top:18px;opacity:0.5;font-size:12.5px;">Tap anywhere to close</div>' +
        '</div>';
      panelEl.style.display = "flex";
    }

    ctx.listen(panelEl, "click", () => { panelEl.style.display = "none"; panelEl.innerHTML = ""; });

    ctx.listen(ui.querySelector('[data-el="help"]'), "click", (e) => {
      e.stopPropagation(); unlockAudio(); showHelp();
    });
    ctx.listen(ui.querySelector('[data-el="seed"]'), "click", (e) => {
      e.stopPropagation();
      unlockAudio(); startMusic();
      if (!started) { started = true; try { ctx.platform.start(); } catch (_) {} }
      scenarioIndex++;
      seed(scenarioIndex);
      hideHint();
      haptic("medium");
      try { ctx.platform.interact({ type: "seed" }); } catch (_) {}
    });
    ctx.listen(ui.querySelector('[data-el="clear"]'), "click", (e) => {
      e.stopPropagation();
      bodies = []; flashes.length = 0; sparks.length = 0;
      nurseries.clear();
      haptic("light");
      toast("Empty space");
      try { ctx.platform.interact({ type: "clear" }); } catch (_) {}
    });
    ctx.listen(muteEl, "click", (e) => {
      e.stopPropagation();
      unlockAudio();
      setMuted(!muted);
      muteEl.textContent = muted ? "🔇" : "🔊";
      muteEl.style.opacity = muted ? "0.5" : "1";
    });

    if (ctx.capabilities.storage) {
      try {
        const saved = await ctx.storage.get("muted");
        if (saved === true) {
          muted = true;
          muteEl.textContent = "🔇";
          muteEl.style.opacity = "0.5";
        }
      } catch (_) {}
    }

    // ====================================================================== //
    // Render                                                                 //
    // ====================================================================== //
    shadeSprite = bakeShade();

    /** The star that lights the scene, or null for flat key lighting. */
    function primaryLight() {
      let best = null;
      for (const b of bodies) {
        if (b.kind !== "star") continue;
        if (!best || b.mass > best.mass) best = b;
      }
      return best;
    }

    function drawTrail(b) {
      const t = b.trail;
      if (t.length < 6) return;
      const hx = t[t.length - 2], hy = t[t.length - 1];
      const grad = g.createLinearGradient(hx, hy, t[0], t[1]);
      grad.addColorStop(0, hexA(b.palette[0], 0.5 * b.fade));
      grad.addColorStop(0.55, hexA(b.palette[1], 0.12 * b.fade));
      grad.addColorStop(1, hexA(b.palette[1], 0));
      g.strokeStyle = grad;
      g.lineWidth = Math.max(0.6, b.r * 0.3);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(t[0], t[1]);
      for (let i = 2; i < t.length; i += 2) g.lineTo(t[i], t[i + 1]);
      g.stroke();
    }

    function drawBody(b, light, timeMs) {
      const R = b.r;
      const pop = clamp(b.born / 0.28, 0, 1);
      const scale = 0.55 + 0.45 * pop;      // a world eases into existence
      const alpha = b.fade * pop;
      const isStar = b.kind === "star";
      const flare = b.flareUntil > timeMs ? (b.flareUntil - timeMs) / 900 : 0;

      // Glow first, additively, so overlapping atmospheres bloom together.
      // A halo smaller than a pixel or two still costs a full additive blit.
      const gl = (isStar || R * cam.zoom > 1.8) ? glowSprite(b.palette[0]) : null;
      if (gl) {
        // Bounded on screen, not just in world units: a runaway merge makes a
        // star whose proportional halo covers most of the display, and a blit
        // that size in 'lighter' costs more than everything else combined.
        const gr = Math.min(R * (isStar ? 4.4 : 2.2) * scale * (1 + flare * 0.7), 170 / cam.zoom);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = clamp((isStar ? 0.42 : 0.2) + flare * 0.4, 0, 1) * alpha;
        g.drawImage(gl, b.x - gr, b.y - gr, gr * 2, gr * 2);
        g.globalCompositeOperation = "source-over";
      }

      g.globalAlpha = alpha;
      const dr = R * scale;
      if (b.sprite) {
        g.drawImage(b.sprite, b.x - dr, b.y - dr, dr * 2, dr * 2);
      } else {
        // No OffscreenCanvas: flat disc, still legible.
        g.fillStyle = b.palette[1];
        g.beginPath(); g.arc(b.x, b.y, dr, 0, TAU); g.fill();
      }

      // Phase shading, rotated so the lit limb faces the star.
      if (shadeSprite && !isStar) {
        // The sprite is lit from its own -x, so rotating by the angle *away*
        // from the star puts that lit side toward it. With no star in the
        // scene, 0.785 rad puts the key light in the upper left.
        const ang = light ? Math.atan2(b.y - light.y, b.x - light.x) : 0.785;
        g.save();
        g.translate(b.x, b.y);
        g.rotate(ang);
        g.globalAlpha = alpha * (light ? 1 : 0.72);
        g.drawImage(shadeSprite, -dr, -dr, dr * 2, dr * 2);
        g.restore();
      }

      if (isStar) {
        // Corona rays. Each one fades along its own length — a flat stroke
        // reads as a hard spoke stuck to the star rather than as light.
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = alpha * 0.5;
        g.lineCap = "round";
        const spin = timeMs * 0.00006 + b.seed;
        for (let i = 0; i < 6; i++) {
          const a = spin + (i / 6) * TAU;
          const len = R * (2.3 + Math.sin(timeMs * 0.0009 + i * 1.7 + b.seed) * 0.5);
          const ca = Math.cos(a), sa = Math.sin(a);
          const x0 = b.x + ca * R * 1.02, y0 = b.y + sa * R * 1.02;
          const x1 = b.x + ca * len, y1 = b.y + sa * len;
          const grad = g.createLinearGradient(x0, y0, x1, y1);
          grad.addColorStop(0, hexA(b.palette[0], 0.5));
          grad.addColorStop(1, hexA(b.palette[0], 0));
          g.strokeStyle = grad;
          g.lineWidth = R * 0.085;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
        }
        g.globalCompositeOperation = "source-over";
      }
      g.globalAlpha = 1;
    }

    function drawNursery(n, timeMs) {
      const r = radiusFor(n.mass);
      const s = nurseryState(n);
      const z = cam.zoom;

      // The predicted path is the whole point of aiming statically, so it says
      // outright whether this throw comes back: bright and solid when the orbit
      // is bound, dim and dashed when it is on its way out.
      const pts = predict(s);
      if (pts.length > 4) {
        g.save();
        if (!s.bound) {
          g.setLineDash([6 / z, 7 / z]);
          g.lineDashOffset = -timeMs * 0.02;
          g.strokeStyle = "rgba(180,205,238,0.46)";
          g.lineWidth = 1.3 / z;
        } else {
          g.strokeStyle = s.snapped ? "rgba(255,232,176,0.8)" : "rgba(188,226,255,0.62)";
          g.lineWidth = (s.snapped ? 2 : 1.6) / z;
        }
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.stroke();
        g.restore();
      }

      // Aim line, with the circular-orbit and escape speeds marked on it. Those
      // two ticks are the entire control scheme made visible: drag to the first
      // for a circle, past the second to leave for good.
      if (s.len > 2 && s.attractor) {
        const fw = toWorld(n.fx, n.fy);
        const dx = fw.x - s.x, dy = fw.y - s.y;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;

        g.strokeStyle = "rgba(170,200,238,0.3)";
        g.lineWidth = 1.2 / z;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(fw.x, fw.y); g.stroke();

        const tick = (screenLen, color, big) => {
          const d = screenLen / z;
          const tx = s.x + ux * d, ty = s.y + uy * d;
          const h = (big ? 9 : 6) / z;
          g.strokeStyle = color;
          g.lineWidth = (big ? 2.4 : 1.6) / z;
          g.beginPath();
          g.moveTo(tx + uy * h, ty - ux * h);
          g.lineTo(tx - uy * h, ty + ux * h);
          g.stroke();
        };
        const pulse = 0.65 + Math.sin(timeMs * 0.008) * 0.35;
        tick(AIM_REF, s.snapped ? "rgba(255,226,150," + pulse + ")" : "rgba(214,236,255,0.75)", s.snapped);
        tick(AIM_REF * Math.SQRT2, "rgba(255,178,150,0.5)", false);
      }

      const gl = glowSprite(s.snapped ? "#ffe6b0" : "#bcd8ff");
      if (gl) {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = s.snapped ? 0.45 : 0.32;
        const gr = r * 3;
        g.drawImage(gl, s.x - gr, s.y - gr, gr * 2, gr * 2);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
      }
      g.fillStyle = "rgba(226,240,255,0.92)";
      g.beginPath(); g.arc(s.x, s.y, r, 0, TAU); g.fill();

      // Mass ring: fills while you hold, and goes quiet once aiming locks it.
      const t = clamp((n.mass - MIN_MASS) / (MAX_SPAWN_MASS - MIN_MASS), 0, 1);
      const rr = r + 9 / z;
      g.strokeStyle = "rgba(150,195,255,0.26)";
      g.lineWidth = 2 / z;
      g.beginPath(); g.arc(s.x, s.y, rr, 0, TAU); g.stroke();
      g.strokeStyle = n.locked
        ? "rgba(190,214,240,0.5)"
        : t > 0.985
          ? "rgba(255,236,190," + (0.7 + Math.sin(timeMs * 0.012) * 0.3) + ")"
          : "rgba(214,236,255,0.95)";
      g.beginPath();
      g.arc(s.x, s.y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * t);
      g.stroke();
    }

    function render(timeMs) {
      // Background sits in screen space with a touch of parallax, so the field
      // feels distant instead of pinned to the action.
      if (bg) {
        // Snapped to whole device pixels: a fractional offset resamples even
        // when the scale is 1:1.
        const px = Math.round(clamp(-cam.x * 0.012, -BG_PAD, BG_PAD) * bgDpr) / bgDpr;
        const py = Math.round(clamp(-cam.y * 0.012, -BG_PAD, BG_PAD) * bgDpr) / bgDpr;
        g.drawImage(bg, px - BG_PAD, py - BG_PAD, bgCssW, bgCssH);
      } else {
        g.fillStyle = "#04060f";
        g.fillRect(0, 0, W, H);
      }

      g.save();
      g.translate(W / 2, H / 2);
      g.scale(cam.zoom, cam.zoom);
      g.translate(-cam.x, -cam.y);

      const light = primaryLight();

      g.globalCompositeOperation = "lighter";
      for (const b of bodies) drawTrail(b);
      g.globalCompositeOperation = "source-over";

      for (const b of bodies) drawBody(b, light, timeMs);

      // Merge flashes: a hot core and an expanding shell.
      g.globalCompositeOperation = "lighter";
      for (const f of flashes) {
        const k = 1 - f.t / f.life;
        const gl = f.energy > 0.12 ? glowSprite(f.color) : null;
        if (gl) {
          g.globalAlpha = k * k * (0.45 + 0.5 * f.energy);
          const gr = f.r * 1.1;
          g.drawImage(gl, f.x - gr, f.y - gr, gr * 2, gr * 2);
        }
        g.globalAlpha = k * k * 0.7;
        g.strokeStyle = "rgba(255,246,224,0.9)";
        g.lineWidth = Math.max(0.5, f.r0 * 0.22 * k);
        g.beginPath(); g.arc(f.x, f.y, f.r, 0, TAU); g.stroke();
      }
      for (const s of sparks) {
        const k = 1 - s.t / s.life;
        g.globalAlpha = k * 0.85;
        g.fillStyle = s.color;
        g.beginPath(); g.arc(s.x, s.y, s.r * k, 0, TAU); g.fill();
      }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;

      for (const n of nurseries.values()) drawNursery(n, timeMs);

      g.restore();
    }

    // ====================================================================== //
    // Frame                                                                  //
    // ====================================================================== //
    let acc = 0, lastCount = -1, trailClock = 0;

    bakeBackground();
    seed(0);
    render(0);
    ctx.markVisualReady("first_frame");

    ctx.onFrame((dtMs, timeMs) => {
      if (destroyed) return;

      if (ctx.width !== W || ctx.height !== H) {
        W = ctx.width; H = ctx.height;
        if (Math.abs(W - bgW) > 2 || Math.abs(H - bgH) > 2) bakeBackground();
      }

      const dt = clamp(dtMs / 1000, 0, 0.05);
      lastFrameDt = Math.max(dt, 1 / 240);

      // Grow whatever is being held.
      for (const n of nurseries.values()) {
        n.held += dt;
        const m = massAt(n.held);
        if (m > n.mass) n.mass = m;
      }

      if (bodies.length) {
        acc += dt;
        let subs = 0;
        while (acc >= DT && subs < MAX_SUB) {
          acc -= DT; subs++;
          step(DT, subs === MAX_SUB || acc < DT, timeMs);
        }
        if (acc > DT) acc = DT;           // fell behind; drop the backlog
        detectFlybys(timeMs);

        systemCentre();
        cullEscapees(dt);

        trailClock += dt;
        if (trailClock >= 0.022) {
          trailClock = 0;
          const maxPts = bodies.length > 110 ? 22 : 40;
          for (const b of bodies) {
            b.trail.push(b.x, b.y);
            while (b.trail.length > maxPts * 2) { b.trail.shift(); b.trail.shift(); }
          }
        }
        for (const b of bodies) b.born += dt;
      }

      stepEffects(dt);
      updateCamera(dt);
      render(timeMs);

      if (bodies.length !== lastCount) {
        lastCount = bodies.length;
        countEl.textContent = bodies.length === 1 ? "1 body" : bodies.length + " bodies";
      }
    });

    ctx.platform.ready();
  }
};
