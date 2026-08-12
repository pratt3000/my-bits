/*
 * Pour Decisions — a Plethora Bit about the one thing every bartender knows:
 * the beer you can see is not the beer you poured.
 *
 * Hold to pull the tap. Beer falls from the spout into the glass, and the fall
 * itself whips air into it — the further it drops, the bigger the head. That
 * head is mostly air, so it stands far above the beer that made it, and when
 * it collapses it drains back down and the beer line *rises* after you have
 * already stopped.
 *
 * Every level names a line — "fill to 59%" — and scores the settled beer, not
 * the froth. So the game is never "stop at the line". It is "stop short of the
 * line by exactly the amount the head is about to give back", which is a real
 * judgement about a real fluid, and it is why pouring a good beer takes a
 * couple of goes.
 *
 * The glass changes shape every level, so 59% of the volume is a different
 * height each time and the printed ticks stop being decoration. By the last
 * glass the only way to land it is the way a bartender would: pour, let it
 * settle, top it up.
 *
 * Sound is synthesised, not sampled (packaged assets are disabled). The pour
 * is modelled on what you actually hear: the air column left above the beer
 * resonates, and as the glass fills that column shortens and its pitch climbs.
 * That rising note is how you can hear a glass filling from the next room, so
 * it is the centre of the mix.
 */

window.plethoraBit = {
  meta: {
    title: "Pour Decisions",
    runtime: "plethora-bit@2",
    tags: ["game", "skill", "precision", "beer", "physics", "sound", "satisfying"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    const FONT = '"Avenir Next","Helvetica Neue",Helvetica,Arial,sans-serif';
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const now = () => performance.now();

    let destroyed = false;
    ctx.onDestroy(() => { destroyed = true; });

    // ======================================================================
    // Glass profiles
    //
    // A glass is a radius profile sampled from bottom (t=0) to rim (t=1).
    // Volume is the solid of revolution, so for anything that is not a plain
    // cylinder the height of "59% full" is emphatically not 59% of the way up.
    // Both mappings get precomputed once per shape: height -> volume for the
    // simulation, volume -> height for drawing the ticks and the target line.
    // ======================================================================
    const SHAPES = {
      // Straight-sided tankard. Volume tracks height almost exactly — this is
      // the shape you learn the mechanic on.
      mug:     { handle: false, r: [0.93, 0.94, 0.95, 0.955, 0.96, 0.965, 0.97, 0.975, 0.98] },
      // Classic taper: wide rim, narrow foot. Fills quickly low, crawls high.
      pint:    { handle: false, r: [0.70, 0.745, 0.79, 0.835, 0.86, 0.895, 0.93, 0.965, 1.0] },
      // Bulb, then a waist, then a flare — three different fill rates.
      tulip:   { handle: false, r: [0.60, 0.80, 0.92, 0.97, 0.95, 0.86, 0.80, 0.86, 0.98] },
      // Wheat vase: slim foot swelling to a broad shoulder near the top.
      weizen:  { handle: false, r: [0.55, 0.62, 0.66, 0.70, 0.76, 0.86, 0.96, 1.0, 0.97] },
      // Narrow cone. Small volume, so every millimetre is a lot of percent.
      flute:   { handle: false, r: [0.40, 0.47, 0.55, 0.62, 0.70, 0.77, 0.85, 0.92, 1.0] },
      // Wide bowl that holds most of its volume in the first third.
      chalice: { handle: false, r: [0.52, 0.78, 0.92, 1.0, 1.0, 0.96, 0.90, 0.88, 0.92] },
      // Pinched middle: the beer line races through the waist and stalls above.
      waisted: { handle: false, r: [0.86, 0.95, 0.99, 0.88, 0.72, 0.78, 0.90, 0.97, 1.0] },
      // Bulb foot under a tall chimney. Slow, slow, then suddenly very fast.
      pokal:   { handle: false, r: [0.95, 1.0, 0.92, 0.66, 0.58, 0.58, 0.62, 0.68, 0.74] }
    };

    const PSTEPS = 320;

    // Catmull-Rom through evenly spaced control radii, so the silhouette is a
    // smooth curve rather than a run of visible facets.
    function sampleProfile(pts, t) {
      const n = pts.length - 1;
      const x = clamp(t, 0, 1) * n;
      const i = Math.min(n - 1, Math.floor(x));
      const f = x - i;
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(n, i + 2)];
      return 0.5 * ((2 * p1) + (-p0 + p2) * f +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
        (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    }

    function buildGlass(key) {
      const spec = SHAPES[key];
      const rs = new Float64Array(PSTEPS + 1);
      for (let i = 0; i <= PSTEPS; i++) rs[i] = Math.max(0.04, sampleProfile(spec.r, i / PSTEPS));
      // Frustum volume between slices: (rA² + rA·rB + rB²)/3. Absolute scale
      // cancels out — everything downstream is a fraction of capacity.
      const cum = new Float64Array(PSTEPS + 1);
      let acc = 0;
      for (let i = 1; i <= PSTEPS; i++) {
        const a = rs[i - 1], b = rs[i];
        acc += (a * a + a * b + b * b) / 3 / PSTEPS;
        cum[i] = acc;
      }
      for (let i = 0; i <= PSTEPS; i++) cum[i] /= acc;
      return {
        key,
        handle: spec.handle,
        radiusAtHeight(h) {
          const x = clamp(h, 0, 1) * PSTEPS;
          const i = Math.min(PSTEPS - 1, Math.floor(x));
          return lerp(rs[i], rs[i + 1], x - i);
        },
        volumeAtHeight(h) {
          const x = clamp(h, 0, 1) * PSTEPS;
          const i = Math.min(PSTEPS - 1, Math.floor(x));
          return lerp(cum[i], cum[i + 1], x - i);
        },
        heightAtVolume(v) {
          const target = clamp(v, 0, 1);
          let lo = 0, hi = PSTEPS;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] < target) lo = mid + 1; else hi = mid;
          }
          if (lo === 0) return 0;
          const a = cum[lo - 1], b = cum[lo];
          const f = b > a ? (target - a) / (b - a) : 0;
          return (lo - 1 + f) / PSTEPS;
        }
      };
    }

    const GLASSES = {};
    for (const key of Object.keys(SHAPES)) GLASSES[key] = buildGlass(key);

    // ======================================================================
    // Levels
    //
    // Difficulty is not one dial. It ramps on five at once: how tight the
    // scoring window is, how fast the tap runs, how hard the beer foams, how
    // awkward the glass makes the height/volume mapping, and how close the
    // target sits to the rim. The last two levels are where those combine into
    // something you cannot brute force in a single pull.
    // ======================================================================
    // foam/decay are tuned as a pair: foam sets how hard the pour whips up a
    // head, decay how fast that head falls back. Together they fix the size of
    // the head you see and, more importantly, how many points of beer it hands
    // back when it collapses — 3.4pp on the first glass, 9.1pp on the sixth.
    const LEVELS = [
      { glass: "mug",     target: 59, perfect: 2.0, window: 14, flow: 0.22, foam: 0.285, decay: 0.135,
        single: false, name: "Tankard",   note: "Light head. Stop a touch short and let it come back to you." },
      { glass: "pint",    target: 35, perfect: 1.8, window: 12, flow: 0.26, foam: 0.405, decay: 0.205,
        single: false, name: "Nonic",     note: "Tapered — the foot fills faster than the rim." },
      { glass: "tulip",   target: 72, perfect: 1.6, window: 11, flow: 0.27, foam: 0.415, decay: 0.195,
        single: false, name: "Tulip",     note: "A bulb, a waist and a flare. Read the ticks, not the height." },
      { glass: "weizen",  target: 45, perfect: 1.4, window: 10, flow: 0.30, foam: 0.660, decay: 0.265,
        single: false, name: "Weizen",    note: "Wheat beer. It foams like it means it." },
      { glass: "flute",   target: 88, perfect: 1.2, window: 9,  flow: 0.28, foam: 0.375, decay: 0.185,
        single: false, name: "Flute",     note: "High line, narrow glass. The rim is closer than it looks." },
      { glass: "chalice", target: 26, perfect: 1.1, window: 8,  flow: 0.40, foam: 0.585, decay: 0.145,
        single: false, name: "Chalice",   note: "Fast tap, foamy beer, and barely any of it wanted." },
      { glass: "waisted", target: 64, perfect: 0.9, window: 7,  flow: 0.32, foam: 0.480, decay: 0.210,
        single: true,  name: "Waisted",   note: "ONE PULL. No topping up — commit to the settle." },
      { glass: "pokal",   target: 93, perfect: 0.7, window: 6,  flow: 0.30, foam: 0.220, decay: 0.125,
        single: false, name: "Pokal",     note: "Pour, let it fall, top it up. The only way this lands." }
    ];

    // Foam is mostly air, so a given volume of beer whipped into a head stands
    // this many times taller. It is also why the head can overflow a glass that
    // is not close to full of beer.
    const FOAM_EXPAND = 2.6;
    // Collapsing foam drains back to beer — minus what stays on the glass as
    // lacing. That missing sliver is why you cannot just do the arithmetic.
    const DRAIN_BACK = 0.92;
    const SERVE_WAIT = 2.0;

    // ======================================================================
    // Audio — a pour synth built around the resonating air column
    // ======================================================================
    let ac = null, master = null, noiseBuf = null;
    let audioBlocked = false, muted = false;
    let pourSrc = null, pourGain = null, pourBP = null, splashHP = null, splashGain = null;
    let crackleSrc = null, crackleGain = null;
    let music = null, musicOn = false;

    function makeNoise() {
      const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 2), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function buildAudio() {
      if (ac || audioBlocked) return ac;
      if (!ctx.capabilities.audio) { audioBlocked = true; return null; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioBlocked = true; return null; }
      try { ac = new AC(); } catch (_) { audioBlocked = true; return null; }

      master = ac.createGain();
      master.gain.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 2.4;
      comp.attack.value = 0.005; comp.release.value = 0.28;
      master.connect(comp); comp.connect(ac.destination);

      noiseBuf = makeNoise();

      // The pour: one noise bed through a resonant bandpass whose centre is
      // driven by how full the glass is, plus a brighter splash layer that
      // only speaks while the beer still has a long way to fall.
      pourGain = ac.createGain(); pourGain.gain.value = 0;
      pourBP = ac.createBiquadFilter();
      pourBP.type = "bandpass"; pourBP.frequency.value = 220; pourBP.Q.value = 3.6;
      pourSrc = ac.createBufferSource();
      pourSrc.buffer = noiseBuf; pourSrc.loop = true;
      pourSrc.connect(pourBP); pourBP.connect(pourGain); pourGain.connect(master);

      splashGain = ac.createGain(); splashGain.gain.value = 0;
      splashHP = ac.createBiquadFilter();
      splashHP.type = "highpass"; splashHP.frequency.value = 2200;
      const splashSrc = ac.createBufferSource();
      splashSrc.buffer = noiseBuf; splashSrc.loop = true;
      splashSrc.connect(splashHP); splashHP.connect(splashGain); splashGain.connect(master);

      // Foam settling: a fine dry fizz, high and quiet.
      crackleGain = ac.createGain(); crackleGain.gain.value = 0;
      const crackleHP = ac.createBiquadFilter();
      crackleHP.type = "bandpass"; crackleHP.frequency.value = 5200; crackleHP.Q.value = 0.8;
      crackleSrc = ac.createBufferSource();
      crackleSrc.buffer = noiseBuf; crackleSrc.loop = true;
      crackleSrc.connect(crackleHP); crackleHP.connect(crackleGain); crackleGain.connect(master);

      try { pourSrc.start(); splashSrc.start(); crackleSrc.start(); } catch (_) {}
      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
    }

    function resumeAudio() {
      if (!ac) buildAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
    }

    // A single rising bubble — the same trick that makes a drip say "plink".
    function bubble(freq, vol) {
      if (!ac || muted) return;
      const o = ac.createOscillator();
      const gn = ac.createGain();
      o.type = "sine";
      const t = ac.currentTime;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * rand(1.5, 2.2), t + 0.045);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      o.connect(gn); gn.connect(master);
      o.start(t); o.stop(t + 0.09);
    }

    // Glass being set down: a couple of inharmonic partials over a soft tick.
    function clink(base, vol) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const partials = [1, 2.76, 5.4];
      for (let i = 0; i < partials.length; i++) {
        const o = ac.createOscillator();
        const gn = ac.createGain();
        o.type = i === 0 ? "triangle" : "sine";
        o.frequency.value = base * partials[i];
        const v = vol / (i + 1.6);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(v, t + 0.003);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.55 / (i + 1));
        o.connect(gn); gn.connect(master);
        o.start(t); o.stop(t + 0.7);
      }
    }

    function noiseBurst(freq, q, vol, dur, type) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(gn); gn.connect(master);
      src.start(t); src.stop(t + dur + 0.02);
    }

    function tone(freq, vol, dur, type, delay) {
      if (!ac || muted) return;
      const t = ac.currentTime + (delay || 0);
      const o = ac.createOscillator();
      const gn = ac.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }

    // Major pentatonic up for a good pour, a flat minor drop for a bad one.
    function fanfare(tier) {
      const up = [523.25, 659.25, 783.99, 1046.5];
      const mid = [523.25, 659.25, 783.99];
      const down = [349.23, 293.66];
      const set = tier >= 3 ? up : tier >= 1 ? mid : down;
      for (let i = 0; i < set.length; i++) {
        tone(set[i], tier >= 1 ? 0.16 : 0.13, tier >= 1 ? 0.5 : 0.34, tier >= 1 ? "triangle" : "sawtooth", i * 0.085);
      }
    }

    function spillSound() {
      noiseBurst(600, 0.7, 0.22, 0.5, "lowpass");
      noiseBurst(1800, 1.2, 0.1, 0.35);
    }

    function setMuted(v) {
      muted = v;
      if (master) master.gain.setTargetAtTime(v ? 0 : 0.9, ac.currentTime, 0.03);
      if (music) { try { music.setVolume(v ? 0 : 0.2, { fadeMs: 200 }); } catch (_) {} }
      if (ctx.capabilities.storage) { try { ctx.storage.set("muted", v); } catch (_) {} }
      syncButtons();
    }

    async function startMusic() {
      if (musicOn || !ctx.capabilities.backgroundMusic) return;
      musicOn = true;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({ preset: "cozy", volume: muted ? 0 : 0.2, fadeInMs: 1400, intensity: 0.35 });
      } catch (_) { music = null; }
    }

    // ======================================================================
    // Run state
    // ======================================================================
    let screen = "title";           // title | play | result | done
    let levelIndex = 0;
    let level = LEVELS[0];
    let glass = GLASSES[level.glass];

    let liquid = 0;                 // settled beer, as a fraction of capacity
    let foam = 0;                   // head volume, same units
    let laceTop = 0;                // highest the head has reached this pour
    let pouring = false;
    let pulled = false;             // has this level seen a pull at all
    let spentPull = false;          // single-pull levels: pull is used up
    let spilled = false;
    let sinceRelease = 0;
    let serveTimer = 0;
    let served = false;
    let poured = 0;                 // total beer through the tap this level

    let totalScore = 0;
    let bestScore = 0;
    let streak = 0;
    let lastResult = null;
    let results = [];
    let started = false;
    let crossedTarget = false;

    const bubbles = [];
    const drops = [];
    const spills = [];
    let foamPhase = 0;
    let handleAngle = 0;
    let flash = 0;
    let shake = 0;
    let titleFill = 0;
    let toastText = "";
    let toastUntil = 0;

    function resetLevel(i) {
      levelIndex = i;
      level = LEVELS[i];
      glass = GLASSES[level.glass];
      liquid = 0; foam = 0; laceTop = 0; poured = 0;
      pouring = false; pulled = false; spentPull = false; spilled = false;
      served = false; sinceRelease = 0; serveTimer = 0; crossedTarget = false;
      bubbles.length = 0; drops.length = 0; spills.length = 0;
      clink(rand(760, 900), 0.16);
      ctx.platform.setProgress(i / LEVELS.length);
    }

    // ======================================================================
    // Simulation
    // ======================================================================
    function update(dt) {
      foamPhase += dt;
      flash = Math.max(0, flash - dt * 2.2);
      shake = Math.max(0, shake - dt * 4);
      handleAngle = lerp(handleAngle, pouring ? 1 : 0, 1 - Math.pow(0.001, dt));

      if (screen === "title") {
        // Attract loop: the glass fills, holds, and empties, so the first frame
        // is never a still life and the sound has something to introduce.
        titleFill += dt * 0.22;
        if (titleFill > 2.4) titleFill = 0;
        updateBubbles(dt, Math.min(1, titleFill) * 0.6);
        return;
      }

      if (screen === "play") {
        const total = liquid + foam;

        if (pouring) {
          const add = level.flow * dt;
          poured += add;
          // The longer the beer falls before it lands, the more air it takes
          // with it. A nearly full glass barely foams at all — which is the
          // whole reason topping up works.
          const headroom = clamp(1 - total, 0, 1);
          const agitation = 0.30 + 0.70 * headroom;
          const conv = clamp(level.foam * agitation, 0, 0.5);
          liquid += add * (1 - conv);
          foam += add * conv * FOAM_EXPAND;

          if (Math.random() < dt * 26) {
            const fill = clamp(liquid + foam, 0, 1);
            bubble(rand(320, 620) * (0.8 + fill * 0.8), 0.035);
          }
          spawnDrops(dt);
        }

        // The head collapses whether or not the tap is open, and a thick head
        // collapses faster than a thin one.
        if (foam > 0) {
          const rate = level.decay * (0.5 + 2.0 * foam);
          const gone = Math.min(foam, rate * dt);
          foam -= gone;
          liquid += (gone / FOAM_EXPAND) * DRAIN_BACK;
          if (foam < 0.0008) foam = 0;
        }

        laceTop = Math.max(laceTop, liquid + foam);

        // Over the rim: the head goes first, which is exactly how it happens.
        if (liquid + foam > 1) {
          const over = liquid + foam - 1;
          const fromFoam = Math.min(foam, over);
          foam -= fromFoam;
          liquid -= (over - fromFoam);
          if (!spilled) {
            spilled = true;
            flash = 1;
            shake = 1;
            spillSound();
            if (ctx.capabilities.haptics) ctx.platform.haptic("warning");
            toast("Over the rim!");
          }
          for (let i = 0; i < 3; i++) spawnSpill();
        }

        // A tick under the thumb the moment the beer line crosses the mark.
        if (!crossedTarget && liquid * 100 >= level.target) {
          crossedTarget = true;
          if (ctx.capabilities.haptics) ctx.platform.haptic("light");
        }

        if (!pouring && pulled) {
          sinceRelease += dt;
          const settled = foam <= 0.004;
          const canPourAgain = !level.single || !spentPull;
          const wait = canPourAgain ? SERVE_WAIT : 0.9;
          if (settled && sinceRelease > 0.6) {
            serveTimer += dt;
            if (serveTimer >= wait) serve();
          }
        }

        updateBubbles(dt, liquid);
        updateDrops(dt);
        updateSpills(dt);
        updateAudio(dt);
        return;
      }

      updateBubbles(dt, liquid);
      updateSpills(dt);
      updateAudio(dt);
    }

    function updateAudio(dt) {
      if (!ac || audioBlocked) return;
      const t = ac.currentTime;
      const fill = clamp(liquid + foam, 0, 1);
      const active = pouring && screen === "play";

      // The signature move: the air column above the beer shortens as the
      // glass fills, so its resonance climbs. You can hear how full it is.
      const freq = 190 + 940 * Math.pow(fill, 1.35);
      pourBP.frequency.setTargetAtTime(freq, t, 0.05);
      pourGain.gain.setTargetAtTime(active ? 0.16 : 0, t, active ? 0.02 : 0.08);

      // Splash only while there is still a drop to fall.
      const headroom = clamp(1 - fill, 0, 1);
      splashHP.frequency.setTargetAtTime(1600 + 2200 * headroom, t, 0.08);
      splashGain.gain.setTargetAtTime(active ? 0.020 + 0.045 * headroom : 0, t, active ? 0.03 : 0.1);

      const fizz = screen === "play" ? clamp(foam * 2.4, 0, 1) : 0;
      crackleGain.gain.setTargetAtTime(fizz * 0.022, t, 0.12);

      // Random pops as the head breaks down.
      if (foam > 0.01 && !pouring && Math.random() < dt * 30 * clamp(foam * 3, 0, 1)) {
        bubble(rand(1400, 3400), 0.008);
      }
    }

    function updateBubbles(dt, level01) {
      if (level01 > 0.02 && bubbles.length < 90 && Math.random() < dt * 60) {
        bubbles.push({ x: rand(-0.85, 0.85), h: 0, v: rand(0.18, 0.42), r: rand(0.6, 2.1), wob: rand(0, 6.3) });
      }
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.h += b.v * dt;
        b.wob += dt * 3;
        if (b.h >= level01) bubbles.splice(i, 1);
      }
    }

    function spawnDrops(dt) {
      if (Math.random() < dt * 90) {
        drops.push({ x: rand(-0.12, 0.12), y: 0, v: rand(0.9, 1.4), life: 1 });
      }
    }

    function updateDrops(dt) {
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.y += d.v * dt;
        d.life -= dt * 1.6;
        if (d.life <= 0) drops.splice(i, 1);
      }
    }

    function spawnSpill() {
      spills.push({
        x: rand(-1, 1), y: 0, vx: rand(-0.25, 0.25), vy: rand(-0.1, 0.15),
        r: rand(1.4, 3.6), life: 1, foamy: Math.random() < 0.7
      });
    }

    function updateSpills(dt) {
      for (let i = spills.length - 1; i >= 0; i--) {
        const s = spills[i];
        s.vy += dt * 2.2;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt * 0.8;
        if (s.life <= 0) spills.splice(i, 1);
      }
    }

    // ======================================================================
    // Scoring
    // ======================================================================
    function serve() {
      if (served) return;
      served = true;
      screen = "result";

      const pct = liquid * 100;
      const err = Math.abs(pct - level.target);
      let points = 0;
      let tier = 0;
      let label = "Missed it";

      if (err <= level.perfect) {
        points = 1000;
        tier = 4;
        label = "PERFECT POUR";
      } else if (err <= level.window) {
        const span = level.window - level.perfect;
        const k = 1 - (err - level.perfect) / span;
        points = Math.round(950 * Math.pow(clamp(k, 0, 1), 1.6));
        if (err <= level.perfect * 2.5) { tier = 3; label = "Great pour"; }
        else if (err <= level.window * 0.5) { tier = 2; label = "Good pour"; }
        else { tier = 1; label = "Close"; }
      }

      if (spilled) points = Math.round(points * 0.4);

      // A run of clean pours is worth more than the same pours scattered.
      if (tier >= 3) { streak++; points += (streak - 1) * 100; }
      else streak = 0;

      totalScore += points;
      lastResult = { pct, err, points, tier, label, spilled, target: level.target, streak };
      results.push(lastResult);

      ctx.platform.setScore(totalScore, { level: levelIndex + 1 });
      ctx.platform.milestone("level_clear", { level: levelIndex + 1, points, error: Math.round(err * 10) / 10 });
      ctx.platform.interact({ type: "pour", level: levelIndex + 1, points });

      flash = tier >= 3 ? 1 : 0.4;
      clink(rand(700, 820), 0.2);
      ctx.timeout(() => fanfare(tier), 140);
      if (ctx.capabilities.haptics) {
        ctx.platform.haptic(tier >= 4 ? "success" : tier >= 2 ? "light" : "warning");
      }
    }

    function nextLevel() {
      if (levelIndex + 1 >= LEVELS.length) {
        screen = "done";
        ctx.platform.setProgress(1);
        ctx.platform.complete({ score: totalScore, levels: LEVELS.length });
        saveAndSubmit();
        return;
      }
      screen = "play";
      resetLevel(levelIndex + 1);
    }

    async function saveAndSubmit() {
      if (totalScore > bestScore) {
        bestScore = totalScore;
        if (ctx.capabilities.storage) {
          try { await ctx.storage.set("best", bestScore); } catch (_) {}
        }
      }
      try { await ctx.memory.record("score").submit(totalScore, { label: totalScore + " pts" }); }
      catch (_) {}
    }

    function startRun() {
      totalScore = 0; streak = 0; results = []; lastResult = null;
      screen = "play";
      resetLevel(0);
    }

    // ======================================================================
    // Input — hold anywhere to pull the tap
    // ======================================================================
    function press(e) {
      if (e && e.cancelable) e.preventDefault();
      if (!started) {
        started = true;
        ctx.platform.start();
        resumeAudio();
        startMusic();
      }
      resumeAudio();

      if (screen === "title") { startRun(); return; }
      if (screen === "result") { nextLevel(); return; }
      if (screen === "done") { startRun(); return; }

      if (level.single && spentPull) { toast("One pull only — let it settle."); return; }
      if (served) return;

      pouring = true;
      pulled = true;
      sinceRelease = 0;
      serveTimer = 0;
      if (music) { try { music.duck(0.35, 220); } catch (_) {} }
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
    }

    function lift() {
      if (!pouring) return;
      pouring = false;
      sinceRelease = 0;
      serveTimer = 0;
      if (level.single) spentPull = true;
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
    }

    ctx.listen(canvas, "pointerdown", press, { passive: false });
    ctx.listen(window, "pointerup", lift, { passive: false });
    ctx.listen(window, "pointercancel", lift, { passive: false });
    if (!("PointerEvent" in window)) {
      ctx.listen(canvas, "touchstart", press, { passive: false });
      ctx.listen(window, "touchend", lift, { passive: false });
      ctx.listen(window, "touchcancel", lift, { passive: false });
      ctx.listen(canvas, "mousedown", press, { passive: false });
      ctx.listen(window, "mouseup", lift, { passive: false });
    }
    // Keyboard fallback so the bit is playable on a desktop preview.
    ctx.listen(window, "keydown", (e) => {
      if (e.code === "Space" && !e.repeat) { e.preventDefault(); press(null); }
    });
    ctx.listen(window, "keyup", (e) => {
      if (e.code === "Space") { e.preventDefault(); lift(); }
    });

    // ======================================================================
    // Layout
    // ======================================================================
    const ELL = 0.20;   // how squashed the surface ellipses are

    function layout() {
      const top = ctx.safeArea.top + 10;
      const bottom = ctx.height - ctx.safeArea.bottom - 10;
      const avail = bottom - top;
      const hudH = 86;
      const tapH = clamp(avail * 0.13, 46, 84);
      const readH = 84;
      const gap = clamp(avail * 0.020, 6, 14);
      const glassH = clamp(avail - hudH - tapH - readH - gap * 3, 140, avail);
      const glassW = Math.min(ctx.width * 0.60, glassH * 0.66);
      const glassTop = top + hudH + gap + tapH + gap;
      return {
        top, bottom, hudH, tapH, readH, gap,
        cx: ctx.width / 2,
        tapTop: top + hudH + gap,
        glassTop,
        glassBottom: glassTop + glassH,
        glassH, glassW,
        readTop: glassTop + glassH + gap
      };
    }

    function halfWidth(L, h) { return (L.glassW / 2) * glass.radiusAtHeight(h); }
    function yAt(L, h) { return L.glassBottom - clamp(h, 0, 1) * L.glassH; }

    function glassPath(L, inset) {
      const p = new Path2D();
      const n = 60;
      const k = inset || 0;
      p.moveTo(L.cx - halfWidth(L, 0) + k, L.glassBottom);
      for (let i = 0; i <= n; i++) {
        const h = i / n;
        p.lineTo(L.cx - halfWidth(L, h) + k, yAt(L, h));
      }
      for (let i = n; i >= 0; i--) {
        const h = i / n;
        p.lineTo(L.cx + halfWidth(L, h) - k, yAt(L, h));
      }
      p.closePath();
      return p;
    }

    // ======================================================================
    // Render
    // ======================================================================
    function draw() {
      const L = layout();
      const w = ctx.width, h = ctx.height;

      g.save();
      if (shake > 0) g.translate(rand(-1, 1) * shake * 3, rand(-1, 1) * shake * 2);

      drawBackground(w, h);

      const showGlass = true;
      const fillLiquid = screen === "title" ? Math.min(1, titleFill) * 0.52 : liquid;
      const fillFoam = screen === "title" ? Math.min(1, titleFill) * 0.14 : foam;

      drawTap(L);
      if (pouring || (screen === "title" && titleFill < 1)) drawStream(L, fillLiquid + fillFoam);
      if (showGlass) drawGlass(L, fillLiquid, fillFoam);
      drawSpills(L);

      if (screen === "title") drawTitle(L);
      else {
        drawHud(L);
        // Only while playing: the result panel restates the number, and drawing
        // both let the readout ghost through the panel.
        if (screen === "play") drawReadout(L);
        if (screen === "result") drawResult(L);
        if (screen === "done") drawDone(L);
      }

      if (flash > 0) {
        g.fillStyle = "rgba(255,236,190," + (flash * 0.16) + ")";
        g.fillRect(0, 0, w, h);
      }
      g.restore();

      drawToast(w, h);
    }

    function drawBackground(w, h) {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, "#20160f");
      grd.addColorStop(0.55, "#150e09");
      grd.addColorStop(1, "#0b0705");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);

      // A warm pool of light behind the glass, like a lamp over the bar.
      const glow = g.createRadialGradient(w / 2, h * 0.44, 10, w / 2, h * 0.44, Math.max(w, h) * 0.62);
      glow.addColorStop(0, "rgba(255,182,80,0.14)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);
    }

    // Everything the tap draws stays inside [tapTop, tapTop + tapH]: the handle
    // used to swing up out of its band and collide with the HUD.
    function drawTap(L) {
      const cx = L.cx;
      const top = L.tapTop;
      const H = L.tapH;
      const bodyW = clamp(L.glassW * 0.20, 16, 30);
      const pivotY = top + H * 0.46;
      const bodyTop = top + H * 0.38;
      const bodyH = H * 0.40;
      const nozzleTop = bodyTop + bodyH;

      const brass = g.createLinearGradient(cx - bodyW, 0, cx + bodyW, 0);
      brass.addColorStop(0, "#7a5a20");
      brass.addColorStop(0.35, "#e6bf6a");
      brass.addColorStop(0.55, "#ffe6ab");
      brass.addColorStop(1, "#8a6626");

      // Handle first, so the brass body covers its root.
      g.save();
      g.translate(cx, pivotY);
      g.rotate(handleAngle * 0.42);
      const armLen = pivotY - top - 7;
      g.fillStyle = "#2b1d12";
      g.beginPath();
      g.roundRect(-3.5, -armLen, 7, armLen, 3);
      g.fill();
      g.fillStyle = "#c8993f";
      g.beginPath();
      g.arc(0, -armLen, 6.5, 0, Math.PI * 2);
      g.fill();
      g.restore();

      g.fillStyle = brass;
      g.beginPath();
      g.roundRect(cx - bodyW / 2, bodyTop, bodyW, bodyH, 4);
      g.fill();
      g.beginPath();
      g.roundRect(cx - bodyW * 0.34, nozzleTop, bodyW * 0.68, top + H - nozzleTop, 3);
      g.fill();

      // A bead at the lip between pulls.
      if (!pouring && screen === "play") {
        g.fillStyle = "rgba(240,180,70,0.75)";
        g.beginPath();
        g.ellipse(cx, top + H + 2, 2.4, 3.2, 0, 0, Math.PI * 2);
        g.fill();
      }
    }

    function spoutY(L) { return L.tapTop + L.tapH + 2; }

    function drawStream(L, fill) {
      const topY = spoutY(L);
      const surfaceY = yAt(L, glass.heightAtVolume(clamp(fill, 0, 1)));
      if (surfaceY <= topY) return;
      const wob = Math.sin(foamPhase * 22) * 1.1;

      const grd = g.createLinearGradient(0, topY, 0, surfaceY);
      grd.addColorStop(0, "rgba(255,214,120,0.95)");
      grd.addColorStop(0.4, "rgba(243,178,52,0.9)");
      grd.addColorStop(1, "rgba(232,150,26,0.85)");
      g.fillStyle = grd;
      g.beginPath();
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = lerp(topY, surfaceY, t);
        const wdt = lerp(3.4, 2.2, t) + Math.sin(foamPhase * 18 + t * 7) * 0.55;
        g.lineTo(L.cx - wdt + wob * t, y);
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps;
        const y = lerp(topY, surfaceY, t);
        const wdt = lerp(3.4, 2.2, t) + Math.sin(foamPhase * 18 + t * 7) * 0.55;
        g.lineTo(L.cx + wdt + wob * t, y);
      }
      g.closePath();
      g.fill();

      g.strokeStyle = "rgba(255,240,200,0.5)";
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(L.cx - 1, topY);
      g.lineTo(L.cx - 1 + wob, surfaceY);
      g.stroke();

      for (const d of drops) {
        const y = lerp(topY, surfaceY, clamp(d.y, 0, 1));
        g.fillStyle = "rgba(255,214,130," + (d.life * 0.7) + ")";
        g.beginPath();
        g.arc(L.cx + d.x * 14, y, 1.3, 0, Math.PI * 2);
        g.fill();
      }
    }

    function drawGlass(L, fillLiquid, fillFoam) {
      const body = glassPath(L, 0);
      const rimW = halfWidth(L, 1);

      // The far wall, dimmed, so the glass has an inside.
      g.save();
      g.clip(body);
      g.fillStyle = "rgba(255,255,255,0.045)";
      g.fillRect(0, 0, ctx.width, ctx.height);

      const liqH = glass.heightAtVolume(clamp(fillLiquid, 0, 1));
      const totH = glass.heightAtVolume(clamp(fillLiquid + fillFoam, 0, 1));
      const liqY = yAt(L, liqH);
      const totY = yAt(L, totH);
      const liqRx = halfWidth(L, liqH);
      const totRx = halfWidth(L, totH);

      // Lacing: the film the collapsing head leaves behind on the glass.
      if (laceTop > fillLiquid + fillFoam + 0.005 && screen !== "title") {
        const laceY = yAt(L, glass.heightAtVolume(clamp(laceTop, 0, 1)));
        g.fillStyle = "rgba(255,250,238,0.10)";
        g.fillRect(0, laceY, ctx.width, Math.max(0, totY - laceY));
      }

      // Beer body.
      if (fillLiquid > 0.001) {
        const beer = g.createLinearGradient(0, liqY, 0, L.glassBottom);
        beer.addColorStop(0, "#ffbe3d");
        beer.addColorStop(0.45, "#f0a01c");
        beer.addColorStop(1, "#c96f05");
        g.fillStyle = beer;
        // Rect starts at the ellipse *centre*, not its front edge — starting
        // lower leaves dark wedges where the ellipse thins out at the walls.
        g.fillRect(0, liqY, ctx.width, L.glassBottom - liqY);
        g.beginPath();
        g.ellipse(L.cx, liqY, liqRx, liqRx * ELL, 0, 0, Math.PI * 2);
        g.fill();

        // Rising bubbles, drawn only under the beer line.
        for (const b of bubbles) {
          if (b.h > fillLiquid) continue;
          const bh = glass.heightAtVolume(clamp(b.h, 0, 1));
          const by = yAt(L, bh);
          const bx = L.cx + b.x * halfWidth(L, bh) * 0.8 + Math.sin(b.wob) * 1.6;
          g.fillStyle = "rgba(255,244,210,0.5)";
          g.beginPath();
          g.arc(bx, by, b.r, 0, Math.PI * 2);
          g.fill();
        }

        // A brighter meniscus so the beer line is legible against the target.
        g.strokeStyle = "rgba(255,236,170,0.75)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(L.cx, liqY, liqRx, liqRx * ELL, 0, 0, Math.PI * 2);
        g.stroke();
      }

      // The head.
      if (fillFoam > 0.0005) {
        g.fillStyle = "#fff5e0";
        g.fillRect(0, totY, ctx.width, Math.max(0, liqY - totY));
        g.beginPath();
        g.ellipse(L.cx, totY, totRx, totRx * ELL, 0, 0, Math.PI * 2);
        g.fill();

        // Bumpy crown, so the head is never a flat disc.
        g.fillStyle = "#fffaf0";
        g.beginPath();
        for (let i = 0; i <= 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const bump = Math.sin(a * 3 + foamPhase * 1.6) * 1.2 + Math.sin(a * 7 - foamPhase) * 0.8;
          g.lineTo(L.cx + Math.cos(a) * totRx, totY + Math.sin(a) * totRx * ELL - bump);
        }
        g.closePath();
        g.fill();

        // Bubble texture through the head.
        g.fillStyle = "rgba(228,206,168,0.55)";
        for (let i = 0; i < 26; i++) {
          const fx = Math.sin(i * 12.9898 + levelIndex) * 43758.5453;
          const fy = Math.sin(i * 78.233 + levelIndex) * 43758.5453;
          const rx = (fx - Math.floor(fx)) * 2 - 1;
          const ry = fy - Math.floor(fy);
          const py = lerp(totY, liqY, ry);
          g.beginPath();
          g.arc(L.cx + rx * totRx * 0.82, py, 0.9 + ry * 1.1, 0, Math.PI * 2);
          g.fill();
        }
      }

      g.restore();

      // Guidance ticks — the whole reason this is a game and not a guess.
      if (screen !== "title") drawTicks(L);

      // Glass in front: rim, highlights, edge.
      g.save();
      g.clip(body);
      const sheen = g.createLinearGradient(L.cx - rimW, 0, L.cx + rimW, 0);
      sheen.addColorStop(0, "rgba(255,255,255,0.16)");
      sheen.addColorStop(0.14, "rgba(255,255,255,0.04)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0)");
      sheen.addColorStop(0.86, "rgba(255,255,255,0.05)");
      sheen.addColorStop(1, "rgba(255,255,255,0.18)");
      g.fillStyle = sheen;
      g.fillRect(0, 0, ctx.width, ctx.height);
      g.restore();

      g.strokeStyle = "rgba(255,245,225,0.35)";
      g.lineWidth = 1.6;
      g.stroke(body);

      // Rim ellipse.
      g.strokeStyle = "rgba(255,250,235,0.6)";
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(L.cx, L.glassTop, rimW, rimW * ELL, 0, 0, Math.PI * 2);
      g.stroke();

      // Thick glass floor.
      g.strokeStyle = "rgba(255,245,225,0.22)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(L.cx, L.glassBottom, halfWidth(L, 0), halfWidth(L, 0) * ELL, 0, 0, Math.PI * 2);
      g.stroke();

      if (screen === "play" || screen === "result") drawTarget(L);
    }

    function drawTicks(L) {
      const majors = [25, 50, 75, 100];
      g.textBaseline = "middle";

      // Minor ticks every 10%, unlabelled, for finer reading.
      g.strokeStyle = "rgba(255,246,226,0.22)";
      g.lineWidth = 1;
      for (let p = 10; p < 100; p += 10) {
        if (majors.indexOf(p) !== -1) continue;
        const hh = glass.heightAtVolume(p / 100);
        const y = yAt(L, hh);
        const hw = halfWidth(L, hh);
        g.beginPath();
        g.moveTo(L.cx + hw - 7, y);
        g.lineTo(L.cx + hw - 1, y);
        g.stroke();
      }

      // Major ticks at the quarters, labelled with percent and millilitres.
      for (const p of majors) {
        const hh = glass.heightAtVolume(p / 100);
        const y = yAt(L, hh);
        const hw = halfWidth(L, hh);
        g.strokeStyle = "rgba(255,246,226,0.55)";
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(L.cx + hw - 14, y);
        g.lineTo(L.cx + hw - 1, y);
        g.stroke();

        g.textAlign = "left";
        g.font = "600 11px " + FONT;
        g.fillStyle = "rgba(255,244,220,0.8)";
        g.fillText(p + "%", L.cx + hw + 6, y);
        g.font = "500 9px " + FONT;
        g.fillStyle = "rgba(255,244,220,0.42)";
        g.fillText(Math.round(p * 5) + " ml", L.cx + hw + 6, y + 11);
      }
    }

    function drawTarget(L) {
      const hh = glass.heightAtVolume(level.target / 100);
      const y = yAt(L, hh);
      const hw = halfWidth(L, hh);
      const hit = lastResult && lastResult.tier >= 3;
      const col = screen === "result" ? (hit ? "#7fe08a" : "#ff9d6b") : "#ff6b4a";

      g.save();
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.setLineDash([6, 5]);
      g.beginPath();
      // Stops at the glass wall on the right so it never runs through the
      // graduation labels sitting just outside it.
      g.moveTo(L.cx - hw - 16, y);
      g.lineTo(L.cx + hw - 2, y);
      g.stroke();
      g.restore();

      // Flag on the left so it never collides with the tick labels.
      const label = level.target + "%";
      g.font = "700 12px " + FONT;
      const tw = g.measureText(label).width;
      const bw = tw + 14, bh = 20;
      const bx = L.cx - hw - 20 - bw;
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(bx, y - bh / 2, bw, bh, 5);
      g.fill();
      g.beginPath();
      g.moveTo(bx + bw, y - 5);
      g.lineTo(bx + bw + 6, y);
      g.lineTo(bx + bw, y + 5);
      g.closePath();
      g.fill();
      g.fillStyle = "#1a0f08";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, bx + bw / 2, y);
    }

    function drawSpills(L) {
      if (!spills.length) return;
      const rimW = halfWidth(L, 1);
      for (const s of spills) {
        const a = clamp(s.life, 0, 1);
        // Foam goes over the rim first, with a little beer carried with it.
        g.fillStyle = s.foamy
          ? "rgba(255,250,238," + (a * 0.95) + ")"
          : "rgba(244,176,52," + (a * 0.92) + ")";
        g.beginPath();
        g.arc(L.cx + s.x * rimW, L.glassTop + s.y * L.glassH * 0.5, s.r, 0, Math.PI * 2);
        g.fill();
      }
    }

    function drawHud(L) {
      const y = ctx.safeArea.top + 10;
      g.textBaseline = "top";
      g.textAlign = "left";

      g.font = "700 12px " + FONT;
      g.fillStyle = "rgba(255,226,168,0.9)";
      g.fillText("LEVEL " + (levelIndex + 1) + " / " + LEVELS.length, 16, y);

      g.font = "500 11px " + FONT;
      g.fillStyle = "rgba(255,240,214,0.55)";
      g.fillText(level.name + (level.single ? " · one pull" : ""), 16, y + 17);

      if (streak > 1) {
        g.font = "600 11px " + FONT;
        g.fillStyle = "#8fe6a0";
        g.fillText("streak ×" + streak, 16, y + 34);
      }

      // The score sits *below* the button row — the two used to collide.
      g.textAlign = "right";
      g.font = "700 13px " + FONT;
      g.fillStyle = "rgba(255,226,168,0.9)";
      g.fillText(totalScore + " pts", ctx.width - 16, y + 40);

      g.textAlign = "center";
      g.font = "800 22px " + FONT;
      g.fillStyle = "#ffd98a";
      g.fillText("FILL TO " + level.target + "%", ctx.width / 2, y + 58);
    }

    function drawReadout(L) {
      const y = L.readTop;
      g.textAlign = "center";
      g.textBaseline = "top";

      const pct = liquid * 100;
      g.font = "800 30px " + FONT;
      g.fillStyle = crossedTarget && screen === "play" ? "#ff9d6b" : "#fff3dc";
      g.fillText(pct.toFixed(1) + "%", ctx.width / 2, y);

      g.font = "500 11px " + FONT;
      g.fillStyle = "rgba(255,240,214,0.5)";
      const ml = Math.round(pct * 5);
      g.fillText("beer in the glass · " + ml + " ml" + (foam > 0.004 ? "   +head" : ""), ctx.width / 2, y + 34);

      if (screen !== "play") return;

      // The settle clock: pouring again cancels it, so it doubles as the
      // "you have a moment to think" signal.
      if (!pouring && pulled && serveTimer > 0) {
        const wait = (!level.single || !spentPull) ? SERVE_WAIT : 0.9;
        const t = clamp(serveTimer / wait, 0, 1);
        const cy = y + 56;
        g.strokeStyle = "rgba(255,240,214,0.2)";
        g.lineWidth = 3;
        g.beginPath();
        g.arc(ctx.width / 2, cy, 11, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = "#ffd98a";
        g.beginPath();
        g.arc(ctx.width / 2, cy, 11, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
        g.stroke();
      } else if (!pulled) {
        g.font = "600 12px " + FONT;
        g.fillStyle = "rgba(255,226,168,0.75)";
        g.fillText("hold anywhere to pour", ctx.width / 2, y + 50);
      } else if (foam > 0.004 && !pouring) {
        g.font = "600 12px " + FONT;
        g.fillStyle = "rgba(255,226,168,0.7)";
        g.fillText("settling…", ctx.width / 2, y + 50);
      }
    }

    function drawTitle(L) {
      // Sits below the button row and shrinks to fit narrow phones, so the
      // wordmark never runs under the controls.
      const cy = ctx.safeArea.top + 54;
      g.textAlign = "center";
      g.textBaseline = "top";
      let size = 30;
      g.font = "800 " + size + "px " + FONT;
      const maxW = ctx.width - 40;
      const tw = g.measureText("POUR DECISIONS").width;
      if (tw > maxW) {
        size = Math.max(17, Math.floor(size * maxW / tw));
        g.font = "800 " + size + "px " + FONT;
      }
      g.fillStyle = "#ffd98a";
      g.fillText("POUR DECISIONS", ctx.width / 2, cy);
      g.font = "500 13px " + FONT;
      g.fillStyle = "rgba(255,240,214,0.7)";
      g.fillText("Hit the line. The head does not count.", ctx.width / 2, cy + size + 8);

      const by = ctx.height - ctx.safeArea.bottom - 64;
      const pulse = 0.65 + Math.sin(foamPhase * 3) * 0.25;
      g.font = "700 15px " + FONT;
      g.fillStyle = "rgba(255,226,168," + pulse + ")";
      g.fillText("tap to start", ctx.width / 2, by);
      if (bestScore > 0) {
        g.font = "600 12px " + FONT;
        g.fillStyle = "rgba(255,240,214,0.5)";
        g.fillText("your best: " + bestScore + " pts", ctx.width / 2, by + 24);
      }
    }

    function panelBox(x, y, w, h) {
      g.fillStyle = "#120b06";
      g.beginPath();
      g.roundRect(x, y, w, h, 14);
      g.fill();
      g.strokeStyle = "rgba(255,214,140,0.28)";
      g.lineWidth = 1;
      g.stroke();
    }

    function drawResult(L) {
      const r = lastResult;
      if (!r) return;
      const w = Math.min(ctx.width - 40, 320);
      const h = 168;
      const x = (ctx.width - w) / 2;
      const y = clamp(L.readTop - 6, ctx.safeArea.top + 80, ctx.height - ctx.safeArea.bottom - h - 10);

      panelBox(x, y, w, h);
      g.textAlign = "center";
      g.textBaseline = "top";

      g.font = "800 20px " + FONT;
      g.fillStyle = r.tier >= 4 ? "#8fe6a0" : r.tier >= 2 ? "#ffd98a" : "#ff9d6b";
      g.fillText(r.label, x + w / 2, y + 16);

      g.font = "500 12px " + FONT;
      g.fillStyle = "rgba(255,240,214,0.7)";
      g.fillText(r.pct.toFixed(1) + "%  ·  target " + r.target + "%  ·  off by " + r.err.toFixed(1), x + w / 2, y + 46);

      if (r.spilled) {
        g.fillStyle = "#ff9d6b";
        g.font = "600 11px " + FONT;
        g.fillText("spilled — 60% docked", x + w / 2, y + 66);
      }

      g.font = "800 30px " + FONT;
      g.fillStyle = "#fff3dc";
      g.fillText("+" + r.points, x + w / 2, y + 86);

      g.font = "600 12px " + FONT;
      g.fillStyle = "rgba(255,226,168,0.8)";
      g.fillText(levelIndex + 1 >= LEVELS.length ? "tap for your total" : "tap for the next glass", x + w / 2, y + 128);

      if (levelIndex + 1 < LEVELS.length) {
        g.font = "500 11px " + FONT;
        g.fillStyle = "rgba(255,240,214,0.45)";
        g.fillText(LEVELS[levelIndex + 1].note, x + w / 2, y + 148);
      }
    }

    function drawDone(L) {
      const w = Math.min(ctx.width - 40, 320);
      const h = 190;
      const x = (ctx.width - w) / 2;
      const y = clamp(ctx.height / 2 - h / 2, ctx.safeArea.top + 70, ctx.height - ctx.safeArea.bottom - h - 10);
      panelBox(x, y, w, h);

      g.textAlign = "center";
      g.textBaseline = "top";
      g.font = "700 13px " + FONT;
      g.fillStyle = "rgba(255,226,168,0.85)";
      g.fillText("LAST ORDERS", x + w / 2, y + 16);

      g.font = "800 40px " + FONT;
      g.fillStyle = "#ffd98a";
      g.fillText(String(totalScore), x + w / 2, y + 38);

      g.font = "500 12px " + FONT;
      g.fillStyle = "rgba(255,240,214,0.6)";
      const perfect = results.filter((r) => r.tier >= 4).length;
      g.fillText(perfect + " perfect · best " + Math.max(bestScore, totalScore) + " pts", x + w / 2, y + 88);

      // Per-level strip so a run reads at a glance.
      const bw = (w - 40) / LEVELS.length;
      for (let i = 0; i < results.length; i++) {
        const t = results[i].tier;
        g.fillStyle = t >= 4 ? "#8fe6a0" : t >= 2 ? "#ffd98a" : t >= 1 ? "#c98a4a" : "#5a3a28";
        g.beginPath();
        g.roundRect(x + 20 + i * bw + 1, y + 116, bw - 2, 8, 3);
        g.fill();
      }

      g.font = "600 13px " + FONT;
      g.fillStyle = "rgba(255,226,168,0.9)";
      g.fillText("tap to pull another round", x + w / 2, y + 140);
      g.font = "500 11px " + FONT;
      g.fillStyle = "rgba(255,240,214,0.45)";
      g.fillText("leaderboard button, top right", x + w / 2, y + 162);
    }

    function toast(text) {
      toastText = text;
      toastUntil = now() + 1700;
    }

    function drawToast(w, h) {
      if (now() > toastUntil || !toastText) return;
      const a = clamp((toastUntil - now()) / 400, 0, 1);
      g.font = "600 12px " + FONT;
      const tw = g.measureText(toastText).width;
      const bw = tw + 22;
      const y = h - ctx.safeArea.bottom - 34;
      g.fillStyle = "rgba(20,12,7," + (0.9 * a) + ")";
      g.beginPath();
      g.roundRect((w - bw) / 2, y, bw, 26, 13);
      g.fill();
      g.fillStyle = "rgba(255,226,168," + a + ")";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(toastText, w / 2, y + 13);
    }

    // ======================================================================
    // Overlay buttons and panels
    // ======================================================================
    const BTN = "pointer-events:auto;width:34px;height:34px;border-radius:17px;border:1px solid rgba(255,214,140,0.3);" +
      "background:rgba(22,14,8,0.75);color:#ffd98a;font-family:" + FONT + ";font-size:14px;line-height:32px;" +
      "text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;padding:0;";

    ui.innerHTML =
      '<div data-el="btns" style="position:absolute;right:12px;top:' + (ctx.safeArea.top + 10) +
      'px;display:flex;gap:8px;pointer-events:none;">' +
      '<button data-el="help" style="' + BTN + '">?</button>' +
      '<button data-el="board" style="' + BTN + '">☰</button>' +
      '<button data-el="mute" style="' + BTN + '">♪</button>' +
      "</div>" +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;pointer-events:auto;' +
      "background:rgba(8,5,3,0.82);align-items:center;justify-content:center;padding:22px;\"></div>";

    const helpBtn = ui.querySelector('[data-el="help"]');
    const boardBtn = ui.querySelector('[data-el="board"]');
    const muteBtn = ui.querySelector('[data-el="mute"]');
    const panel = ui.querySelector('[data-el="panel"]');

    function syncButtons() {
      muteBtn.textContent = muted ? "✕" : "♪";
      muteBtn.style.color = muted ? "rgba(255,217,138,0.45)" : "#ffd98a";
    }

    function wire(node, fn) {
      ctx.listen(node, "pointerdown", (e) => { e.stopPropagation(); });
      ctx.listen(node, "click", (e) => { e.stopPropagation(); fn(); });
    }

    const CLOSE = '<div style="margin-top:16px;font-size:11px;opacity:0.5;">tap anywhere to close</div>';
    const BOX = "max-width:330px;width:100%;max-height:100%;overflow:auto;background:#140d07;border:1px solid rgba(255,214,140,0.25);" +
      "border-radius:16px;padding:20px;color:#ffeccd;font-family:" + FONT + ";font-size:13px;line-height:1.55;";

    function openPanel(html) {
      panel.innerHTML = '<div data-el="box" style="' + BOX + '">' + html + CLOSE + "</div>";
      panel.style.display = "flex";
    }
    function closePanel() { panel.style.display = "none"; panel.innerHTML = ""; }
    ctx.listen(panel, "pointerdown", (e) => { e.stopPropagation(); });
    ctx.listen(panel, "click", (e) => { closePanel(); });

    wire(helpBtn, () => {
      resumeAudio();
      openPanel(
        '<div style="font-weight:800;font-size:16px;color:#ffd98a;margin-bottom:10px;">How to pour</div>' +
        "<ul style=\"margin:0;padding-left:18px;\">" +
        "<li><b>Hold anywhere</b> to pull the tap. Let go to stop.</li>" +
        "<li>Every level names a line — fill to <b>59%</b>, say. The ticks on the glass mark 25 / 50 / 75 / 100%.</li>" +
        "<li><b>Only the beer counts.</b> The white head is mostly air and it is not scored.</li>" +
        "<li>When the head collapses it drains back into the beer, so the level <b>keeps rising after you stop</b>. Stop short.</li>" +
        "<li>The further the beer falls, the more head you make. A nearly full glass hardly foams — which is why <b>topping up works</b>.</li>" +
        "<li>Once the head has settled, the glass is served automatically. Pour again before then to top it up.</li>" +
        "<li>Go over the rim and you spill: 60% docked.</li>" +
        "<li>Later glasses change shape, so 59% sits at a different height each time. Two levels are <b>one pull only</b>.</li>" +
        "</ul>"
      );
    });

    wire(muteBtn, () => { resumeAudio(); setMuted(!muted); });

    wire(boardBtn, async () => {
      resumeAudio();
      openPanel('<div style="font-weight:800;font-size:16px;color:#ffd98a;margin-bottom:10px;">Best pours</div><div>loading…</div>');
      let html = '<div style="font-weight:800;font-size:16px;color:#ffd98a;margin-bottom:10px;">Best pours</div>';
      try {
        const lb = await ctx.memory.record("score").leaderboard({ scope: "global", period: "all_time" });
        const rows = (lb && (lb.entries || lb.rows || lb.items)) || [];
        if (!rows.length) html += "<div style=\"opacity:0.6;\">No rounds in yet. Pour the first one.</div>";
        else {
          html += '<div style="display:flex;flex-direction:column;gap:6px;">';
          rows.slice(0, 10).forEach((row, i) => {
            const who = row.displayName || row.username || row.name || "someone";
            const val = row.label || row.value || row.score || "";
            html += '<div style="display:flex;justify-content:space-between;gap:10px;">' +
              "<span>" + (i + 1) + ". " + String(who).slice(0, 22) + "</span><b>" + val + "</b></div>";
          });
          html += "</div>";
        }
      } catch (_) {
        html += '<div style="opacity:0.6;">Leaderboard is not available right now.</div>';
      }
      if (bestScore > 0) html += '<div style="margin-top:12px;opacity:0.6;">your best: ' + bestScore + " pts</div>";
      if (panel.style.display !== "none") openPanel(html);
    });

    syncButtons();

    // ======================================================================
    // Boot
    // ======================================================================
    if (ctx.capabilities.storage) {
      try {
        const savedBest = await ctx.storage.get("best");
        if (typeof savedBest === "number" && isFinite(savedBest)) bestScore = savedBest;
        const savedMute = await ctx.storage.get("muted");
        if (savedMute === true) { muted = true; syncButtons(); }
      } catch (_) {}
    }

    ctx.onFrame((dtMs) => {
      if (destroyed) return;
      update(Math.min(dtMs, 50) / 1000);
      draw();
    });

    draw();
    ctx.markVisualReady("title");
    ctx.platform.ready();
  }
};
