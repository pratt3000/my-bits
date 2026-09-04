/**
 * Govinda Ala Re — a dahi handi in your hand.
 *
 * The pyramid is not a stack, it is a structure holding itself up. Every
 * govinda's weight is solved down through the shoulders below him by the lever
 * rule, so leaning the tower is the same act as redistributing its load. That
 * one coupling is the whole game:
 *
 *   - the centre of the base carries the most and barely moves when you lean,
 *     so he is a clock you cannot stop;
 *   - the flanks swing hugely, so rocking the pyramid rests them in turn.
 *
 * Both failure modes are physical. A man buckles when his stamina is spent
 * under load, or the tower goes over when the lean puts someone's feet past
 * the edge of the shoulders holding him — which is a geometric limit, not a
 * tuned one: sin(theta) > SPACING/(2*TIER) = 0.239.
 */
window.plethoraBit = {
  meta: {
    title: "Govinda Ala Re",
    runtime: "plethora-bit@2",
    tags: ["game", "physics", "balance", "festival", "janmashtami"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ---------------------------------------------------------------- world
    // Feet, because that is the unit the real competition is scored in: a nine
    // thar pyramid stands about forty-three feet.
    const TIER_FT = 4.6;        // shoulder height — one storey of pyramid
    const SPACING_FT = 2.2;     // gap between neighbours in a tier
    // The top boy's raised hand, above his own feet. With TIER_FT this puts a
    // nine thar handi at 42 feet, which is where the real records sit.
    const REACH_FT = 5.2;
    // A man's feet leave the shoulders under him past this lean. Geometry, not taste.
    const LEAN_LIMIT = SPACING_FT / (2 * TIER_FT);

    const MAX_THAR = 9;
    const FIRST_THAR = 4;

    // Stamina, tuned against the solver: the centre man of a seven thar sits at
    // ratio ~1.25 and lasts about twenty seconds. A rested flank recovers in
    // eighteen, so rocking buys time without ever solving the problem.
    // A cube made everything under his limit almost free, so the first three
    // rounds could not be lost at all. 2.4 still rewards resting a man but
    // makes a five thar cost something inside one round.
    const DRAIN = 0.055;
    const DRAIN_POW = 2.4;
    const IDLE_DRAIN = 0.006;
    const RECOVER = 0.14;
    const RECOVER_BELOW = 0.55;
    const REACH_STRAIN = 1.4;   // holding a boy at full stretch costs the tower

    // Lean dynamics. Untouched the tower diverges with an e-fold near four
    // seconds; under your thumb it is a responsive, slightly underdamped pull.
    const TOPPLE = 2.2;
    const BRACE_K = 9.0;
    const DAMP = 3.6;
    // Adding a thar costs you your finger, so an untouched tower has to be
    // survivable. The crowd braces it loosely; whether that is enough depends
    // on how tall it is, which is the honest answer anyway — a three thar
    // settles itself and a nine thar is going over unless you are on it.
    const LOOSE_AUTHORITY = 0.1;

    const TAP_MS = 260;
    const TAP_SLOP = 12;

    // --------------------------------------------------------------- palette
    const SKIN = ["#8d5a3b", "#a9704a", "#6f452c", "#c08a5e", "#95603e"];
    const CLOTH = ["#f08a24", "#f2ece0", "#2f9e5f", "#2f6fbf", "#d94f7a", "#ffd23f"];
    const CURD = "#fdfbf3";

    // ----------------------------------------------------------------- utils
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    let seed = 0x9e3779b9;
    function rnd() {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    }
    const rrange = (a, b) => a + (b - a) * rnd();
    const pick = (arr) => arr[(rnd() * arr.length) | 0];

    // storage.set returns nothing on device, so never chain onto it
    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* storage unsupported here */ }
    }

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    // ===================================================================
    // Sound. Everything below the music bed is synthesised — there are no
    // packaged assets — and the dhol is the reason it is worth doing by hand:
    // it is two drums, a deep dagga that bends downward and a slapped treble
    // head, and a general-purpose "drum" preset gets neither.
    // ===================================================================
    let AC = null, ac = null, master = null, noiseBuf = null;
    let audioOn = false;

    function initAudio() {
      if (ac || !ctx.capabilities.audio) return;
      AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.9;
        master.connect(ac.destination);
        const n = ac.sampleRate * 0.7;
        noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        audioOn = true;
      } catch (err) { audioOn = false; }
    }
    ctx.onDestroy(() => {
      try { if (ac) ac.close(); } catch (err) { /* already gone */ }
    });

    function env(node, at, peak, attack, decay) {
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
      node.connect(gn);
      gn.connect(master);
      return gn;
    }

    function noise(at, dur, type, freq, q, peak) {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = type;
      bp.frequency.value = freq;
      bp.Q.value = q;
      src.connect(bp);
      env(bp, at, peak, 0.004, dur);
      src.start(at);
      src.stop(at + dur + 0.05);
    }

    // The dagga head: a pitch that falls away, which is what makes it read as
    // skin over a shell rather than as a synth kick.
    function dholBass(at, gain) {
      if (!audioOn) return;
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(112, at);
      o.frequency.exponentialRampToValueAtTime(52, at + 0.16);
      env(o, at, 0.5 * gain, 0.006, 0.24);
      o.start(at);
      o.stop(at + 0.34);
      noise(at, 0.05, "lowpass", 220, 1, 0.22 * gain);
    }

    function dholTreble(at, gain) {
      if (!audioOn) return;
      const o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(340, at);
      o.frequency.exponentialRampToValueAtTime(240, at + 0.05);
      env(o, at, 0.16 * gain, 0.003, 0.06);
      o.start(at);
      o.stop(at + 0.14);
      noise(at, 0.07, "bandpass", 1900, 1.4, 0.3 * gain);
    }

    function tasha(at, gain) {           // the small high drum over the top
      if (!audioOn) return;
      noise(at, 0.045, "bandpass", 3400, 2.2, 0.2 * gain);
    }

    function cymbal(at, gain) {
      if (!audioOn) return;
      noise(at, 0.5, "highpass", 5200, 0.7, 0.14 * gain);
    }

    // Keherwa, the eight-beat cycle every dhol-tasha pathak plays.
    const GROOVE = ["B", "t", "T", "t", "T", "t", "B", "T"];
    let grooveStep = 0, nextNoteAt = 0, grooveOn = false, grooveBpm = 96;

    function scheduleGroove() {
      if (!audioOn || !grooveOn) return;
      const spb = 60 / grooveBpm / 2;          // one eighth note
      while (nextNoteAt < ac.currentTime + 0.25) {
        const at = Math.max(nextNoteAt, ac.currentTime + 0.02);
        const hit = GROOVE[grooveStep % GROOVE.length];
        const accent = grooveStep % 8 === 0;
        if (hit === "B") dholBass(at, accent ? 1 : 0.72);
        else if (hit === "T") dholTreble(at, 0.85);
        else dholTreble(at, 0.4);
        if (accent) cymbal(at, 1);
        if (grooveStep % 2 === 1) tasha(at, 0.6);
        grooveStep++;
        nextNoteAt = at + spb;
      }
    }

    function startGroove() {
      if (!audioOn) return;
      grooveOn = true;
      nextNoteAt = ac.currentTime + 0.05;
      grooveStep = 0;
    }
    function stopGroove() { grooveOn = false; }
    ctx.interval(scheduleGroove, 60);

    function sfxSmash() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.01;
      noise(at, 0.16, "bandpass", 900, 0.6, 0.55);       // the pot giving way
      for (let i = 0; i < 9; i++) {                       // clay shards
        noise(at + rrange(0.01, 0.22), 0.05, "bandpass", rrange(1600, 5200), 5, 0.2);
      }
      noise(at + 0.06, 0.9, "lowpass", 700, 0.7, 0.3);    // curd hitting the street
    }

    function sfxCheer(len, gain) {
      if (!audioOn) return;
      const at = ac.currentTime + 0.01;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(700, at);
      bp.frequency.linearRampToValueAtTime(1500, at + len * 0.3);
      bp.frequency.linearRampToValueAtTime(600, at + len);
      bp.Q.value = 0.8;
      src.connect(bp);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.linearRampToValueAtTime(gain, at + len * 0.25);
      gn.gain.linearRampToValueAtTime(0.0001, at + len);
      bp.connect(gn);
      gn.connect(master);
      src.start(at);
      src.stop(at + len + 0.05);
    }

    function sfxWhistle() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.01;
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(1750, at);
      o.frequency.linearRampToValueAtTime(2350, at + 0.09);
      o.frequency.linearRampToValueAtTime(1900, at + 0.3);
      env(o, at, 0.1, 0.02, 0.3);
      o.start(at);
      o.stop(at + 0.42);
    }

    function sfxStep() {
      if (!audioOn) return;
      noise(ac.currentTime + 0.01, 0.07, "lowpass", 400, 1, 0.16);
    }

    function sfxCreak(amount) {
      if (!audioOn) return;
      noise(ac.currentTime + 0.01, 0.3, "bandpass", rrange(180, 320), 7, 0.09 * amount);
    }

    function sfxCollapse() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.01;
      noise(at, 1.2, "lowpass", 320, 0.8, 0.5);
      for (let i = 0; i < 14; i++) {
        noise(at + rrange(0, 0.7), 0.09, "lowpass", rrange(200, 800), 1.5, 0.18);
      }
    }

    function sfxSplash() {
      if (!audioOn) return;
      noise(ac.currentTime + 0.01, 0.45, "bandpass", 1300, 0.9, 0.24);
    }

    // Background bed. Dorian is Kafi thaat, which is the mode this music
    // actually lives in, and it is the closest scale the runtime offers.
    let musicHandle = null;
    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        if (musicHandle) return;
        musicHandle = await ctx.music.play({
          preset: "pulse",
          scale: "dorian",
          root: "D",
          volume: 0.34,
          tempo: 104,
          intensity: 0.5,
          fadeInMs: 1200
        });
      } catch (err) { musicHandle = null; }
    }
    function musicIntensity(v, tempo) {
      try {
        ctx.music.setIntensity(clamp(v, 0, 1));
        ctx.music.setTempo(tempo);
      } catch (err) { /* bed not running */ }
    }
    function duck(a, ms) { try { ctx.music.duck(a, ms); } catch (err) { /* no bed */ } }
    function sting(name) { try { ctx.music.sting(name); } catch (err) { /* no bed */ } }
    function haptic(kind) { try { ctx.platform.haptic(kind); } catch (err) { /* none */ } }

    // ===================================================================
    // The pyramid
    // ===================================================================
    function makeGovinda(k, i, n, N) {
      const f = N > 1 ? k / (N - 1) : 0;
      return {
        k, i,
        x0: (i - (n - 1) / 2) * SPACING_FT,
        y: k * TIER_FT,
        weight: 82 - 52 * f,
        strength: 205 - 130 * f,
        load: 0,
        down: 0,
        ratio: 0,
        stamina: 1,
        skin: pick(SKIN),
        cloth: pick(CLOTH),
        gamcha: rnd() < 0.45 ? pick(CLOTH) : null,
        // Everyone is the same height so shoulders line up with the tier above.
        // Only the boy on top, who carries nobody, is drawn small.
        scale: (n === 1 && k === N - 1) ? 0.8 : 1,
        phase: rrange(0, Math.PI * 2),
        climb: k === 0 ? 1 : 0,     // 0..1 as he arrives into place
        fallen: false,
        fx: 0, fy: 0, fvx: 0, fvy: 0, frot: 0, fvrot: 0
      };
    }

    /**
     * Solve the load, top down. Each man hands his own weight plus everything
     * resting on him to the two shoulders under him, split by where he stands
     * between them — the lever rule, and the only place the lean enters the
     * simulation. Leaning is load redistribution; they are the same act.
     */
    function solveLoads(tiers, theta) {
      const s = Math.sin(theta);
      for (const row of tiers) for (const m of row) m.down = 0;
      for (let k = tiers.length - 1; k >= 0; k--) {
        const row = tiers[k];
        for (let i = 0; i < row.length; i++) {
          const m = row[i];
          m.load = m.down;
          m.ratio = m.load / m.strength;
          if (k === 0 || m.fallen) continue;
          const below = tiers[k - 1];
          const L = below[i], R = below[i + 1];
          if (!L || !R) continue;
          const total = (m.load + m.weight) * m.climb;
          const mx = m.x0 + s * m.y;
          const lx = L.x0 + s * L.y;
          const rx = R.x0 + s * R.y;
          let share = (mx - lx) / (rx - lx);
          share = clamp(share, 0, 1);
          if (L.fallen && !R.fallen) { R.down += total; continue; }
          if (R.fallen && !L.fallen) { L.down += total; continue; }
          L.down += total * (1 - share);
          R.down += total * share;
        }
      }
    }

    function comHeight(tiers) {
      let m = 0, my = 0;
      for (const row of tiers) for (const p of row) { m += p.weight; my += p.weight * p.y; }
      return m > 0 ? my / m : 0;
    }

    // ===================================================================
    // Run state
    // ===================================================================
    const S = {
      phase: "title",       // title | holding | forming | reaching | smashed | collapsed
      round: 0,
      needThar: FIRST_THAR,
      tiers: [],
      theta: 0,
      omega: 0,
      braceTarget: 0,
      touching: false,
      handiFt: 0,
      handiSway: 0,
      reach: 0,
      phaseT: 0,
      formT: 0,
      best: 0,
      lastFeet: 0,
      broke: 0,
      failWho: "",
      shards: [],
      curd: [],
      splats: [],
      confetti: [],
      sprays: [],
      spray: null,
      sprayNext: 6,
      camPxPerFt: 20,
      camTarget: 20,
      shake: 0,
      flash: 0,
      banner: null,
      bannerT: 0,
      creakT: 0,
      queued: false,
      time: 0,
      gustA: 0,
      gustB: 0
    };

    function thisRoundThar() {
      return Math.min(MAX_THAR, FIRST_THAR + S.round);
    }
    function handiFeetFor(n) {
      return (n - 1) * TIER_FT + REACH_FT;
    }
    // Past nine thar the pyramid cannot grow, so the crowd does the work instead.
    function overtime() {
      return Math.max(0, FIRST_THAR + S.round - MAX_THAR);
    }

    function startRound() {
      S.needThar = thisRoundThar();
      S.handiFt = handiFeetFor(S.needThar);
      S.tiers = [];
      addTier();
      S.theta = 0;
      S.omega = 0;
      S.braceTarget = 0;
      S.reach = 0;
      S.phase = "holding";
      S.phaseT = 0;
      S.queued = false;
      S.sprayNext = S.round < 2 ? 999 : rrange(4, 7);
      S.gustA = rrange(0, 6.3);
      S.gustB = rrange(0, 6.3);
      S.spray = null;
      S.failWho = "";
      const ot = overtime();
      const fatigue = clamp(ot * 0.07, 0, 0.35);
      for (const row of S.tiers) for (const m of row) m.stamina = 1 - fatigue;
      fitCamera();
      S.camPxPerFt = S.camTarget;
    }

    function addTier() {
      const N = S.needThar;
      const k = S.tiers.length;
      if (k >= N) return false;
      const n = N - k;
      const row = [];
      for (let i = 0; i < n; i++) row.push(makeGovinda(k, i, n, N));
      const ot = overtime();
      const fatigue = clamp(ot * 0.07, 0, 0.35);
      for (const m of row) m.stamina = 1 - fatigue;
      S.tiers.push(row);
      return true;
    }

    function allMen() {
      const out = [];
      for (const row of S.tiers) for (const m of row) out.push(m);
      return out;
    }

    function collapse(why) {
      if (S.phase === "collapsed") return;
      S.phase = "collapsed";
      S.phaseT = 0;
      S.failWho = why;
      S.shake = 1;
      const dir = Math.sin(S.theta) >= 0 ? 1 : -1;
      for (const m of allMen()) {
        m.fallen = true;
        m.fx = m.x0 + Math.sin(S.theta) * m.y;
        m.fy = m.y;
        m.fvx = dir * rrange(0.4, 3.2) * (0.4 + m.y / 24);
        m.fvy = rrange(-1.2, 2.4);
        m.fvrot = rrange(-4, 4) * (0.4 + m.y / 30);
      }
      stopGroove();
      sfxCollapse();
      sfxCheer(1.4, 0.1);
      haptic("error");
      duck(0.7, 1600);
      sting("fail");
      submitBest();
      ctx.platform.fail({ reason: why, feet: Math.round(S.lastFeet), handis: S.broke });
    }

    function smash() {
      S.phase = "smashed";
      S.phaseT = 0;
      S.broke++;
      S.lastFeet = S.handiFt;
      S.best = Math.max(S.best, S.handiFt);
      S.flash = 1;
      S.shake = 0.8;
      const hx = handiX();
      for (let i = 0; i < 26; i++) {
        S.shards.push({
          x: hx + rrange(-0.5, 0.5), y: S.handiFt + rrange(-0.4, 0.4),
          vx: rrange(-5, 5), vy: rrange(-1, 6),
          rot: rrange(0, 6.3), vrot: rrange(-8, 8),
          size: rrange(0.14, 0.4), life: 1
        });
      }
      for (let i = 0; i < 150; i++) {
        S.curd.push({
          x: hx + rrange(-0.7, 0.7), y: S.handiFt + rrange(-0.5, 0.2),
          vx: rrange(-3.4, 3.4), vy: rrange(-1.5, 3.4),
          r: rrange(0.07, 0.26), life: 1
        });
      }
      for (let i = 0; i < 60; i++) {
        S.confetti.push({
          x: rrange(-9, 9), y: S.handiFt + rrange(-1, 5),
          vx: rrange(-2, 2), vy: rrange(-1, 2.4),
          rot: rrange(0, 6.3), vrot: rrange(-6, 6),
          c: pick(CLOTH), life: 1
        });
      }
      sfxSmash();
      sfxCheer(2.4, 0.24);
      sfxWhistle();
      haptic("success");
      duck(0.6, 1200);
      sting("win");
      ctx.platform.milestone("handi_broken", { thar: S.needThar, feet: Math.round(S.handiFt) });
      if (S.needThar >= MAX_THAR) {
        ctx.platform.complete({ thar: S.needThar, feet: Math.round(S.handiFt), handis: S.broke });
      }
      ctx.platform.setScore(Math.round(S.best));
      submitBest();
    }

    let bestStored = 0;
    async function submitBest() {
      const feet = Math.round(S.best);
      if (feet <= 0) return;
      if (feet > bestStored) {
        bestStored = feet;
        fireAndForget(() => ctx.storage.set("bestFeet", feet));
      }
      try { await ctx.memory.record("handi_height").submit(feet, { label: feet + " ft" }); }
      catch (err) { /* offline; the run still counts locally */ }
    }

    function banner(text, sub) {
      S.banner = { text, sub };
      S.bannerT = 0;
    }

    // ------------------------------------------------------------------ step
    function step(dt) {
      S.time += dt;
      S.phaseT += dt;
      S.bannerT += dt;
      S.handiSway += dt * 1.1;
      S.shake = Math.max(0, S.shake - dt * 1.6);
      S.flash = Math.max(0, S.flash - dt * 2.2);
      S.camPxPerFt += (S.camTarget - S.camPxPerFt) * Math.min(1, dt * 4);

      const live = S.phase === "holding" || S.phase === "forming" || S.phase === "reaching";

      // ---- climbing in
      if (S.phase === "forming") {
        let done = true;
        for (const row of S.tiers) {
          for (const m of row) {
            if (m.climb < 1) {
              m.climb = Math.min(1, m.climb + dt / 1.05);
              done = false;
            }
          }
        }
        if (done) {
          S.phase = "holding";
          S.phaseT = 0;
          if (S.queued) { S.queued = false; sendThar(); }
        }
      }

      if (live) {
        // ---- hazards: the crowd throws water to make the base slip
        if (S.round >= 1) {
          S.sprayNext -= dt;
          if (S.sprayNext <= 0 && !S.spray) {
            S.spray = { side: rnd() < 0.5 ? -1 : 1, t: 0, dur: rrange(1.6, 2.8) };
            S.sprayNext = rrange(5.5, 9) - Math.min(3, S.round * 0.4);
          }
        }
        if (S.spray) {
          S.spray.t += dt;
          const s = S.spray;
          if (s.t < s.dur) {
            S.omega += s.side * dt * 0.42;
            if (rnd() < 0.7) {
              S.sprays.push({
                x: s.side * 11, y: rrange(1, S.handiFt * 0.6),
                vx: -s.side * rrange(7, 13), vy: rrange(1.5, 4.5),
                life: 1
              });
            }
          } else if (s.t > s.dur + 0.4) S.spray = null;
        }

        // ---- lean. The tower falls away on its own; your thumb is the only
        // thing bracing it, and where you hold it decides who carries the load.
        const authority = S.touching ? 1 : LOOSE_AUTHORITY;
        const gustAmp = 0.12 + S.tiers.length * 0.04 + (S.phase === "forming" ? 0.2 : 0);
        const gust = (Math.sin(S.time * 0.85 + S.gustA) * 0.62
                    + Math.sin(S.time * 1.9 + S.gustB) * 0.38) * gustAmp;
        // More of the mass sits high on a tall pyramid, so it wants to go over
        // harder. At three thar the loose brace beats this term outright.
        const topHeavy = 0.5 + S.tiers.length / MAX_THAR;
        const alpha =
          TOPPLE * topHeavy * Math.sin(S.theta)
          + (S.braceTarget - S.theta) * BRACE_K * authority
          - DAMP * S.omega
          + gust;
        S.omega += alpha * dt;
        S.theta += S.omega * dt;

        solveLoads(S.tiers, S.theta);

        // ---- stamina
        const wet = (S.spray && S.spray.t < S.spray.dur ? 1.55 : 1)
                  * (S.phase === "reaching" ? REACH_STRAIN : 1);
        let worst = 0;
        for (const m of allMen()) {
          if (m.climb < 1) continue;
          const r = m.ratio;
          if (r > worst) worst = r;
          if (r < RECOVER_BELOW) {
            m.stamina = Math.min(1, m.stamina + RECOVER * (RECOVER_BELOW - r) * dt);
            m.stamina -= IDLE_DRAIN * dt;
          } else {
            m.stamina -= (DRAIN * Math.pow(r, DRAIN_POW) * wet + IDLE_DRAIN) * dt;
          }
          if (m.stamina <= 0) {
            m.stamina = 0;
            collapse("buckled");
            return;
          }
        }

        S.creakT -= dt;
        if (worst > 1.05 && S.creakT <= 0) {
          sfxCreak(clamp((worst - 1) * 1.6, 0.2, 1));
          S.creakT = rrange(0.5, 1.2) / worst;
        }
        grooveBpm = 92 + S.tiers.length * 6 + clamp(worst, 0, 2) * 12;
        musicIntensity(0.35 + S.tiers.length * 0.07, 100 + S.tiers.length * 5);

        // ---- feet leaving the shoulders under them
        if (Math.abs(Math.sin(S.theta)) > LEAN_LIMIT) { collapse("toppled"); return; }
      }

      // ---- the boy going for the pot
      if (S.phase === "reaching") {
        S.reach = Math.min(1, S.reach + dt / 1.15);
        if (S.reach >= 1 && Math.abs(boyHandX() - handiX()) < 2.6) smash();
      }

      if (S.phase === "smashed") {
        if (S.phaseT > 2.7) {
          S.round++;
          banner(thisRoundThar() + " THAR", Math.round(handiFeetFor(thisRoundThar())) + " feet up");
          startRound();
          startGroove();
        }
      }

      stepParticles(dt);
    }

    function stepParticles(dt) {
      const G = 22;                       // feet per second squared, near enough
      for (let i = S.shards.length - 1; i >= 0; i--) {
        const p = S.shards[i];
        p.vy -= G * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vrot * dt;
        if (p.y < 0) { S.shards.splice(i, 1); continue; }
      }
      for (let i = S.curd.length - 1; i >= 0; i--) {
        const p = S.curd[i];
        p.vy -= G * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y < 0) {
          S.splats.push({ x: p.x, r: p.r * rrange(1.4, 2.6), life: 1 });
          if (rnd() < 0.06) sfxSplash();
          S.curd.splice(i, 1);
        }
      }
      for (let i = S.splats.length - 1; i >= 0; i--) {
        S.splats[i].life -= dt * 0.14;
        if (S.splats[i].life <= 0) S.splats.splice(i, 1);
      }
      for (let i = S.confetti.length - 1; i >= 0; i--) {
        const p = S.confetti[i];
        p.vy -= G * 0.16 * dt;
        p.vx += (rnd() - 0.5) * dt * 2;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vrot * dt;
        p.life -= dt * 0.22;
        if (p.life <= 0 || p.y < -1) S.confetti.splice(i, 1);
      }
      for (let i = S.sprays.length - 1; i >= 0; i--) {
        const p = S.sprays[i];
        p.vy -= G * 0.6 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        p.life -= dt * 0.9;
        if (p.life <= 0 || p.y < 0) S.sprays.splice(i, 1);
      }
      if (S.phase === "collapsed") {
        for (const m of allMen()) {
          m.fvy -= G * dt;
          m.fx += m.fvx * dt;
          m.fy += m.fvy * dt;
          m.frot += m.fvrot * dt;
          if (m.fy < 0) {
            m.fy = 0;
            m.fvy *= -0.18;
            m.fvx *= 0.52;
            m.fvrot *= 0.44;
            if (Math.abs(m.fvy) < 0.4) m.fvy = 0;
            if (Math.abs(m.fvx) < 0.3) m.fvx = 0;
          }
          const edge = (W / 2 - 10) / S.camPxPerFt;
          if (m.fx < -edge) { m.fx = -edge; m.fvx = Math.abs(m.fvx) * 0.3; }
          if (m.fx > edge) { m.fx = edge; m.fvx = -Math.abs(m.fvx) * 0.3; }
        }
      }
    }

    // ===================================================================
    // Paint
    // ===================================================================
    const rgbCache = {};
    function toRgb(hex) {
      let v = rgbCache[hex];
      if (!v) {
        const n = parseInt(hex.slice(1), 16);
        v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        rgbCache[hex] = v;
      }
      return v;
    }
    function mix(a, b, t) {
      const A = toRgb(a), B = toRgb(b);
      const r = Math.round(lerp(A[0], B[0], t));
      const gg = Math.round(lerp(A[1], B[1], t));
      const bl = Math.round(lerp(A[2], B[2], t));
      return "rgb(" + r + "," + gg + "," + bl + ")";
    }
    function shade(hex, t) { return mix(hex, "#000000", t); }

    let W = ctx.width, H = ctx.height;
    function groundY() { return H - ctx.safeArea.bottom - 52; }
    function hudTop() { return ctx.safeArea.top + 12; }

    function fitCamera() {
      const avail = groundY() - (ctx.safeArea.top + 104);
      const vfit = avail / (S.handiFt + 3.2);
      const halfWidthFt = (S.needThar - 1) / 2 * SPACING_FT + 2.2;
      const hfit = (W * 0.44) / halfWidthFt;
      S.camTarget = Math.max(5, Math.min(vfit, hfit));
    }

    const X = (ft) => W / 2 + ft * S.camPxPerFt;
    const Y = (ft) => groundY() - ft * S.camPxPerFt;

    // ---- scenery, generated once and kept still
    const stars = [];
    for (let i = 0; i < 70; i++) stars.push({ x: rnd(), y: rnd() * 0.55, r: rrange(0.5, 1.6), a: rrange(0.2, 0.9) });
    const buildings = [];
    for (const side of [-1, 1]) {
      const floors = [];
      for (let f = 0; f < 9; f++) {
        const win = [];
        for (let c = 0; c < 3; c++) win.push(rnd() < 0.55 ? pick(["#ffcf6b", "#ffb347", "#9fd8ff", "#ffe9b0"]) : null);
        floors.push(win);
      }
      buildings.push({ side, floors });
    }
    const crowd = [];
    for (let i = 0; i < 46; i++) {
      crowd.push({
        x: rrange(-1.1, 1.1), z: rnd(),
        h: rrange(0.7, 1.15), cloth: pick(CLOTH),
        phase: rrange(0, 6.3), wave: rnd() < 0.55
      });
    }

    function drawSky() {
      const sky = g.createLinearGradient(0, 0, 0, groundY());
      sky.addColorStop(0, "#150c29");
      sky.addColorStop(0.42, "#3a1a4a");
      sky.addColorStop(0.78, "#7d3350");
      sky.addColorStop(1, "#c05a3c");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, groundY() + 1);

      g.fillStyle = "#fff6dc";
      g.globalAlpha = 0.72;
      g.beginPath();
      g.arc(W * 0.79, H * 0.37, Math.min(W, H) * 0.055, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      for (const s of stars) {
        g.globalAlpha = s.a * 0.7;
        g.fillStyle = "#ffffff";
        g.fillRect(s.x * W, s.y * H, s.r, s.r);
      }
      g.globalAlpha = 1;
    }

    function drawBuildings() {
      const gy = groundY();
      const bw = Math.max(38, W * 0.15);
      for (const b of buildings) {
        const x = b.side < 0 ? 0 : W - bw;
        g.fillStyle = "#150c22";
        g.fillRect(x, 0, bw, gy);
        g.fillStyle = "#241535";
        g.fillRect(b.side < 0 ? bw - 5 : x, 0, 5, gy);
        const fh = gy / 9;
        for (let f = 0; f < 9; f++) {
          const wy = f * fh + fh * 0.22;
          for (let c = 0; c < 3; c++) {
            const col = b.floors[f][c];
            if (!col) continue;
            const ww = bw * 0.19;
            const wx = x + bw * (0.14 + c * 0.28);
            g.fillStyle = col;
            g.globalAlpha = 0.75;
            g.fillRect(wx, wy, ww, fh * 0.4);
            g.globalAlpha = 1;
          }
        }
      }
      // torans strung across the gap
      const bwR = W - bw;
      for (let row = 0; row < 2; row++) {
        const yy = H * (0.155 + row * 0.062);
        const sag = 26 + row * 8;
        g.strokeStyle = "#4a2f1e";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(bw, yy);
        g.quadraticCurveTo(W / 2, yy + sag, bwR, yy);
        g.stroke();
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          const fx = lerp(bw, bwR, t);
          const fy = yy + sag * 2 * t * (1 - t) * 1.0;
          g.fillStyle = CLOTH[(i + row) % CLOTH.length];
          g.globalAlpha = 0.9;
          g.beginPath();
          g.moveTo(fx - 6, fy);
          g.lineTo(fx + 6, fy);
          g.lineTo(fx, fy + 13);
          g.closePath();
          g.fill();
          g.globalAlpha = 1;
        }
      }
    }

    function drawStreet() {
      const gy = groundY();
      g.fillStyle = "#241a24";
      g.fillRect(0, gy, W, H - gy);
      g.fillStyle = "#2e2130";
      g.fillRect(0, gy, W, 3);
      for (const sp of S.splats) {
        g.globalAlpha = clamp(sp.life, 0, 1) * 0.8;
        g.fillStyle = CURD;
        g.beginPath();
        g.ellipse(X(sp.x), gy + 3, sp.r * S.camPxPerFt, sp.r * S.camPxPerFt * 0.34, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function drawCrowd(t) {
      const gy = groundY();
      const base = Math.min(W, H) * 0.052;
      for (const p of crowd) {
        const scale = 0.7 + p.z * 0.55;
        const hh = base * p.h * scale;
        const px = W / 2 + p.x * W * 0.55;
        const py = gy + 12 + (1 - p.z) * 22;
        const bob = p.wave ? Math.sin(t * 3 + p.phase) * hh * 0.06 : 0;
        g.fillStyle = shade(p.cloth, 0.62);
        g.beginPath();
        g.ellipse(px, py - hh * 0.4 + bob, hh * 0.19, hh * 0.42, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#1a1020";
        g.beginPath();
        g.arc(px, py - hh * 0.86 + bob, hh * 0.16, 0, Math.PI * 2);
        g.fill();
        if (p.wave) {
          g.strokeStyle = "#1a1020";
          g.lineWidth = Math.max(1.6, hh * 0.09);
          g.lineCap = "round";
          const sw = Math.sin(t * 4 + p.phase) * 0.34;
          g.beginPath();
          g.moveTo(px, py - hh * 0.55 + bob);
          g.lineTo(px + Math.sin(sw + 0.5) * hh * 0.4, py - hh * 1.12 + bob);
          g.moveTo(px, py - hh * 0.55 + bob);
          g.lineTo(px - Math.sin(-sw + 0.5) * hh * 0.4, py - hh * 1.12 + bob);
          g.stroke();
        }
      }
    }

    function drawRopeAndHandi(t) {
      const bw = Math.max(38, W * 0.15);
      const ry = Y(S.handiFt + 1.5);
      g.strokeStyle = "#c8a86a";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(bw * 0.5, ry - 16);
      g.quadraticCurveTo(W / 2, ry, W - bw * 0.5, ry - 16);
      g.stroke();
      if (S.phase === "smashed") return;      // it is in pieces on the street
      const sway = handiX();
      const hx = X(sway), hy = Y(S.handiFt);
      const u = S.camPxPerFt;
      g.strokeStyle = "#c8a86a";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(X(sway * 0.35), ry + 1);
      g.lineTo(hx, hy - u * 0.95);
      g.stroke();

      const r = Math.max(11, u * 0.78);
      g.save();
      g.translate(hx, hy);
      g.rotate(Math.sin(S.handiSway) * 0.09);
      // pot
      g.fillStyle = "#a8542c";
      g.beginPath();
      g.ellipse(0, -r * 0.05, r, r * 0.92, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#8a4222";
      g.beginPath();
      g.ellipse(r * 0.3, -r * 0.05, r * 0.62, r * 0.86, 0, 0, Math.PI * 2);
      g.fill();
      // neck and rim
      g.fillStyle = "#93471f";
      g.fillRect(-r * 0.46, -r * 1.16, r * 0.92, r * 0.42);
      g.fillStyle = "#c2683a";
      g.beginPath();
      g.ellipse(0, -r * 1.16, r * 0.56, r * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = CURD;
      g.beginPath();
      g.ellipse(0, -r * 1.17, r * 0.4, r * 0.13, 0, 0, Math.PI * 2);
      g.fill();
      // marigold garland and a band of cloth
      g.fillStyle = "#e8402f";
      g.fillRect(-r, -r * 0.34, r * 2, r * 0.3);
      for (let i = 0; i < 11; i++) {
        const a = -Math.PI * 0.94 + (i / 10) * Math.PI * 0.88;
        g.fillStyle = i % 2 ? "#ffb01f" : "#ff7a1a";
        g.beginPath();
        g.arc(Math.cos(a) * r * 1.02, -r * 0.05 + Math.sin(a) * r * 0.94, r * 0.16, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    function handiX() { return Math.sin(S.handiSway) * 0.8; }
    function boyHandX() {
      const row = S.tiers[S.tiers.length - 1];
      if (!row || row.length !== 1) return 0;
      const top = row[0];
      return top.x0 + Math.sin(S.theta) * (top.y + REACH_FT);
    }

    /**
     * One govinda. Feet straddle the two shoulders under him, arms brace the
     * legs of the two standing on his own — which is what the solver already
     * says about him, drawn.
     */
    function drawMan(m, t, isTop) {
      const u = S.camPxPerFt * m.scale;
      const danger0 = m.fallen ? 0
        : clamp(Math.max((m.ratio - 0.75) / 0.8, (0.55 - m.stamina) / 0.55), 0, 1);
      let fx, fy, rot;
      if (m.fallen) {
        fx = m.fx; fy = m.fy; rot = m.frot;
      } else {
        const jitter = Math.sin(t * 27 + m.phase) * danger0 * 0.075;
        fx = m.x0 + Math.sin(S.theta) * m.y + jitter;
        fy = m.y;
        rot = S.theta;
      }
      const danger = danger0;
      const skin = danger > 0.02 ? mix(m.skin, "#ff5330", danger * 0.62) : m.skin;
      const arrive = m.climb;

      g.save();
      g.translate(X(fx), Y(fy) + (1 - arrive) * 26);
      g.rotate(rot);
      g.globalAlpha = arrive < 1 ? clamp(arrive * 1.6, 0.15, 1) : 1;
      g.scale(u, -u);

      const HIP = 2.45, CHEST = 4.5, HEADY = 5.08, HEADR = 0.4, SH = 0.6;
      const footHalf = (m.k === 0 ? 0.52 : SPACING_FT / 2) / m.scale;
      const reach = isTop ? S.reach : 0;
      const handY = lerp(5.85, REACH_FT / m.scale, reach);
      // He stretches toward the pot, so you can see how far off you are.
      const handLean = reach > 0.02
        ? clamp((handiX() - boyHandX()) / (2 * m.scale), -1.1, 1.1) * reach
        : 0;
      const rise = reach * 0.22;

      g.lineCap = "round";
      g.lineJoin = "round";

      // legs
      g.strokeStyle = skin;
      g.lineWidth = 0.34;
      g.beginPath();
      g.moveTo(-0.22, HIP + rise); g.lineTo(-footHalf, 0);
      g.moveTo(0.22, HIP + rise); g.lineTo(footHalf, 0);
      g.stroke();

      // shorts
      g.fillStyle = m.cloth;
      g.beginPath();
      g.moveTo(-0.5, HIP + 0.62 + rise);
      g.lineTo(0.5, HIP + 0.62 + rise);
      g.lineTo(0.42, HIP - 0.34 + rise);
      g.lineTo(-0.42, HIP - 0.34 + rise);
      g.closePath();
      g.fill();

      // torso and shoulders
      g.strokeStyle = skin;
      g.lineWidth = 0.66;
      g.beginPath();
      g.moveTo(0, HIP + 0.3 + rise); g.lineTo(0, CHEST + rise);
      g.stroke();
      g.lineWidth = 0.32;
      g.beginPath();
      g.moveTo(-SH, CHEST + rise); g.lineTo(SH, CHEST + rise);
      g.stroke();

      // arms
      g.lineWidth = 0.26;
      g.beginPath();
      if (m.k === 0) {
        // the base ring links arms with its neighbours
        g.moveTo(-SH, CHEST); g.lineTo(-1.02, CHEST - 0.12); g.lineTo(-1.5, CHEST + 0.04);
        g.moveTo(SH, CHEST); g.lineTo(1.02, CHEST - 0.12); g.lineTo(1.5, CHEST + 0.04);
      } else if (isTop && reach > 0.02) {
        g.moveTo(-SH, CHEST + rise); g.lineTo(-0.82, CHEST + 0.5 + rise);
        g.lineTo(-0.3 + handLean, handY);
        g.moveTo(SH, CHEST + rise); g.lineTo(0.7, CHEST + 0.7 + rise);
        g.lineTo(0.16 + handLean, handY + 0.34);
      } else {
        g.moveTo(-SH, CHEST); g.lineTo(-0.88, CHEST + 0.6); g.lineTo(-0.42, 5.85);
        g.moveTo(SH, CHEST); g.lineTo(0.88, CHEST + 0.6); g.lineTo(0.42, 5.85);
      }
      g.stroke();

      // head
      g.fillStyle = skin;
      g.beginPath();
      g.arc(0, HEADY + rise, HEADR, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#1a1018";
      g.beginPath();
      g.arc(0, HEADY + 0.1 + rise, HEADR * 0.96, Math.PI * 0.08, Math.PI * 0.92);
      g.fill();
      if (m.gamcha) {
        g.strokeStyle = m.gamcha;
        g.lineWidth = 0.17;
        g.beginPath();
        g.moveTo(-HEADR, HEADY + 0.2 + rise);
        g.lineTo(HEADR, HEADY + 0.2 + rise);
        g.stroke();
      }
      g.restore();
      g.globalAlpha = 1;

      // a man at his limit burns; it is the only readout the tower needs
      if (danger > 0.45 && !m.fallen) {
        g.globalAlpha = (danger - 0.45) * 0.5;
        g.fillStyle = "#ff5330";
        g.beginPath();
        g.arc(X(fx), Y(fy + 2.4), S.camPxPerFt * 1.5, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
    }

    function drawPyramid(t) {
      for (let k = 0; k < S.tiers.length; k++) {
        const row = S.tiers[k];
        const isTopRow = k === S.tiers.length - 1 && row.length === 1 && S.tiers.length === S.needThar;
        for (const m of row) drawMan(m, t, isTopRow);
      }
    }

    function drawEffects() {
      const u = S.camPxPerFt;
      g.fillStyle = "#bfe6ff";
      for (const p of S.sprays) {
        g.globalAlpha = clamp(p.life, 0, 1) * 0.55;
        g.fillRect(X(p.x), Y(p.y), Math.max(1.5, u * 0.09), Math.max(1.5, u * 0.09));
      }
      g.globalAlpha = 1;
      for (const p of S.shards) {
        g.save();
        g.translate(X(p.x), Y(p.y));
        g.rotate(p.rot);
        g.fillStyle = "#a8542c";
        g.fillRect(-p.size * u * 0.5, -p.size * u * 0.5, p.size * u, p.size * u * 0.7);
        g.restore();
      }
      g.fillStyle = CURD;
      for (const p of S.curd) {
        g.beginPath();
        g.arc(X(p.x), Y(p.y), Math.max(1, p.r * u), 0, Math.PI * 2);
        g.fill();
      }
      for (const p of S.confetti) {
        g.globalAlpha = clamp(p.life, 0, 1);
        g.save();
        g.translate(X(p.x), Y(p.y));
        g.rotate(p.rot);
        g.fillStyle = p.c;
        g.fillRect(-3, -1.5, 6, 3);
        g.restore();
      }
      g.globalAlpha = 1;
    }

    // ------------------------------------------------------------------ HUD
    const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    function text(str, x, y, size, colour, align, weight) {
      g.font = (weight || 700) + " " + size + "px " + FONT;
      g.fillStyle = colour;
      g.textAlign = align || "left";
      g.textBaseline = "alphabetic";
      g.fillText(str, x, y);
    }
    function pill(x, y, w, h, r, fill) {
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
      g.fill();
    }

    let infoOpen = false;
    function infoRect() {
      const s = 34;
      return { x: W - s - 12, y: hudTop() + 34, w: s, h: s };
    }

    function weakest() {
      let w = 1, m = null;
      for (const row of S.tiers) {
        for (const p of row) {
          if (p.climb < 1) continue;
          if (p.stamina < w) { w = p.stamina; m = p; }
        }
      }
      return { v: w, m };
    }

    function topScrim(h) {
      const sc = g.createLinearGradient(0, 0, 0, h);
      sc.addColorStop(0, "rgba(8,4,16,0.94)");
      sc.addColorStop(0.55, "rgba(8,4,16,0.82)");
      sc.addColorStop(0.84, "rgba(8,4,16,0.42)");
      sc.addColorStop(1, "rgba(8,4,16,0)");
      g.fillStyle = sc;
      g.fillRect(0, 0, W, h);
    }

    function panel(cx, cy, w, h) {
      pill(cx - w / 2, cy, w, h, 14, "rgba(8,4,16,0.78)");
    }

    function drawHud(t) {
      const top = hudTop();
      if (S.phase === "title") return;
      topScrim(top + 108);

      text(S.tiers.length + " / " + S.needThar + " THAR", 14, top + 22, 20, "#ffffff");
      text(Math.round(S.handiFt) + " FT UP", 14, top + 40, 12, "rgba(255,255,255,0.62)", "left", 600);
      const bestTxt = S.best > 0 ? "BEST " + Math.round(S.best) + " FT" : "";
      if (bestTxt) text(bestTxt, W - 14, top + 22, 12, "rgba(255,255,255,0.62)", "right", 600);
      if (S.broke > 0) text(S.broke + " HANDI" + (S.broke > 1 ? "S" : ""), W - 14, top + 38, 12, "#ffd23f", "right", 700);

      // lean, against the angle at which feet leave the shoulders below
      const bw = Math.min(190, W * 0.5), bx = (W - bw) / 2, by = top + 54;
      pill(bx, by, bw, 7, 3.5, "rgba(255,255,255,0.14)");
      const lean = clamp(Math.sin(S.theta) / LEAN_LIMIT, -1, 1);
      const mag = Math.abs(lean);
      const col = mag > 0.78 ? "#ff4d3a" : mag > 0.5 ? "#ffb01f" : "#7fe3a0";
      const cxm = bx + bw / 2;
      g.fillStyle = col;
      g.fillRect(Math.min(cxm, cxm + lean * bw / 2), by, Math.abs(lean) * bw / 2, 7);
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.fillRect(cxm - 1, by - 3, 2, 13);

      // the man closest to giving out — the clock you are actually racing
      const wk = weakest();
      if (wk.m && S.phase !== "smashed") {
        const sw = bw, sx = bx, sy = by + 14;
        pill(sx, sy, sw, 5, 2.5, "rgba(255,255,255,0.12)");
        const c2 = wk.v < 0.25 ? "#ff4d3a" : wk.v < 0.55 ? "#ffb01f" : "#7fe3a0";
        pill(sx, sy, Math.max(2, sw * wk.v), 5, 2.5, c2);
        text("WEAKEST", sx - 6, sy + 5, 9, "rgba(255,255,255,0.5)", "right", 700);
      }

      // info button
      const ir = infoRect();
      pill(ir.x, ir.y, ir.w, ir.h, 10, "rgba(0,0,0,0.35)");
      text(infoOpen ? "×" : "i", ir.x + ir.w / 2, ir.y + ir.h / 2 + 6, 17, "#ffffff", "center");
    }

    function drawBanner() {
      if (!S.banner || S.bannerT > 2.6) return;
      const a = S.bannerT < 0.3 ? S.bannerT / 0.3 : clamp((2.6 - S.bannerT) / 0.6, 0, 1);
      const cy = H * 0.54;
      g.globalAlpha = a;
      panel(W / 2, cy - 34, Math.min(268, W * 0.78), 74);
      text(S.banner.text, W / 2, cy, 38, "#ffd23f", "center", 800);
      text(S.banner.sub, W / 2, cy + 22, 13, "rgba(255,255,255,0.82)", "center", 600);
      g.globalAlpha = 1;
    }

    function drawHint() {
      const y = H - ctx.safeArea.bottom - 28;
      let msg = "";
      if (S.phase === "holding") {
        msg = S.tiers.length < S.needThar
          ? "TAP to send up a thar   ·   DRAG to hold it"
          : "TAP to send him for the handi";
      } else if (S.phase === "forming") {
        msg = S.queued ? "next thar queued — hold it steady"
                       : "hold it steady — they are climbing";
      }
      else if (S.phase === "reaching") msg = "get him under the pot";
      if (!msg) return;
      g.font = "600 11.5px " + FONT;
      const tw = g.measureText(msg).width;
      pill(W / 2 - tw / 2 - 12, y - 13, tw + 24, 20, 10, "rgba(8,4,16,0.6)");
      text(msg, W / 2, y, 11.5, "rgba(255,255,255,0.82)", "center", 600);
    }

    function drawTitle(t) {
      g.fillStyle = "rgba(8,4,16,0.62)";
      g.fillRect(0, 0, W, H);
      const cy = H * 0.3;
      panel(W / 2, cy - 46, Math.min(316, W * 0.9), 132);
      text("GOVINDA", W / 2, cy, 42, "#ffd23f", "center", 800);
      text("ALA RE", W / 2, cy + 38, 42, "#ffffff", "center", 800);
      text("build the thar · break the handi", W / 2, cy + 66, 12.5, "rgba(255,255,255,0.78)", "center", 600);

      const by = H * 0.76;
      panel(W / 2, by - 22, Math.min(230, W * 0.66), S.best > 0 ? 56 : 38);
      const pulse = 0.62 + 0.38 * Math.sin(t * 3);
      g.globalAlpha = pulse;
      text("TAP TO BEGIN", W / 2, by, 17, "#ffffff", "center", 800);
      g.globalAlpha = 1;
      if (S.best > 0) {
        text("BEST  " + Math.round(S.best) + " FT", W / 2, by + 20, 11.5,
             "rgba(255,255,255,0.62)", "center", 600);
      }
    }

    function drawGameOver(t) {
      g.fillStyle = "rgba(8,4,16,0.68)";
      g.fillRect(0, 0, W, H);
      const cy = H * 0.3;
      const tall = S.best > 0;
      panel(W / 2, cy - 34, Math.min(300, W * 0.88), tall ? 150 : 74);
      const why = S.failWho === "toppled" ? "IT WENT OVER" : "THE BASE GAVE OUT";
      text(why, W / 2, cy, 25, "#ff6a52", "center", 800);
      text(S.broke > 0
        ? S.broke + " handi" + (S.broke > 1 ? "s" : "") + " broken"
        : "no handi this time", W / 2, cy + 24, 13.5, "rgba(255,255,255,0.84)", "center", 600);
      if (tall) {
        text(Math.round(S.best) + " FT", W / 2, cy + 72, 38, "#ffd23f", "center", 800);
        text("highest handi", W / 2, cy + 90, 10.5, "rgba(255,255,255,0.55)", "center", 600);
      }
      if (S.phaseT > 0.9) {
        const by = H * 0.76;
        panel(W / 2, by - 21, Math.min(232, W * 0.68), 36);
        const pulse = 0.6 + 0.4 * Math.sin(t * 3);
        g.globalAlpha = pulse;
        text("TAP TO GO AGAIN", W / 2, by, 16, "#ffffff", "center", 800);
        g.globalAlpha = 1;
      }
    }

    const INFO = [
      ["TAP", "sends up the next thar. When the pyramid is tall enough, it sends your Govinda for the pot."],
      ["DRAG", "leans the whole tower. This is the only control, and it does two things at once."],
      ["THE CATCH", "leaning moves the load. Lean right and the man on the left is resting; the man on the right is carrying almost everything."],
      ["SO", "rock the pyramid to rest each flank in turn. Red men are close to going."],
      ["BUT", "the man in the middle of the base barely feels your lean. He is your clock. Hurry."],
      ["DON'T", "lean so far that a man's feet leave the shoulders under him. The meter turns red first."]
    ];

    function drawInfo() {
      g.fillStyle = "rgba(6,3,12,0.88)";
      g.fillRect(0, 0, W, H);
      let y = Math.max(hudTop() + 86, H * 0.17);
      text("DAHI HANDI", W / 2, y, 24, "#ffd23f", "center", 800);
      y += 30;
      const pad = 22, wrapW = W - pad * 2;
      for (const row of INFO) {
        text(row[0], pad, y, 12, "#ffd23f", "left", 800);
        y += 15;
        g.font = "600 12.5px " + FONT;
        g.fillStyle = "rgba(255,255,255,0.82)";
        g.textAlign = "left";
        const words = row[1].split(" ");
        let line = "";
        for (const wd of words) {
          const test = line ? line + " " + wd : wd;
          if (g.measureText(test).width > wrapW && line) {
            g.fillText(line, pad, y); y += 15; line = wd;
          } else line = test;
        }
        if (line) { g.fillText(line, pad, y); y += 15; }
        y += 8;
      }
      text("TAP ANYWHERE TO CLOSE", W / 2, Math.min(H - ctx.safeArea.bottom - 18, y + 14), 11, "rgba(255,255,255,0.5)", "center", 700);
    }

    // ================================================================== input
    // Pointer x is taken canvas-relative at press (offsetX is already that) and
    // the page origin is remembered, so later moves anywhere on the window
    // convert without ever asking the layout engine where the canvas is.
    const ptr = { down: false, id: null, originX: 0, originY: 0, x: 0, y: 0,
                  sx: 0, sy: 0, t0: 0, drag: false };

    function pressX(e) { return e.clientX - ptr.originX; }
    function pressY(e) { return e.clientY - ptr.originY; }

    function beginGame() {
      S.round = 0;
      S.broke = 0;
      S.lastFeet = 0;
      S.shards.length = 0; S.curd.length = 0; S.splats.length = 0;
      S.confetti.length = 0; S.sprays.length = 0;
      S.banner = null;
      startRound();
      banner(S.needThar + " THAR", Math.round(S.handiFt) + " feet up");
      initAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (err) { /* blocked */ } }
      startGroove();
      startMusic();
      sfxWhistle();
      ctx.platform.start();
    }

    function sendThar() {
      if (S.tiers.length >= S.needThar || !addTier()) return false;
      S.phase = "forming";
      S.phaseT = 0;
      S.omega += (rnd() - 0.5) * 0.5;      // the climb shakes it
      sfxStep();
      if (ac) dholBass(ac.currentTime + 0.01, 1);
      haptic("medium");
      ctx.platform.interact({ type: "thar", tiers: S.tiers.length });
      ctx.platform.setProgress(clamp(S.tiers.length / S.needThar, 0, 1));
      return true;
    }

    function onTap(x, y) {
      if (infoOpen) { infoOpen = false; return; }
      const ir = infoRect();
      if (x >= ir.x - 6 && x <= ir.x + ir.w + 6 && y >= ir.y - 6 && y <= ir.y + ir.h + 6) {
        infoOpen = true;
        haptic("light");
        return;
      }
      if (S.phase === "title") { beginGame(); haptic("medium"); return; }
      if (S.phase === "collapsed") {
        if (S.phaseT > 0.9) { beginGame(); haptic("medium"); }
        return;
      }
      // A tap while the last lot is still climbing used to vanish, which reads
      // as a dead button when you are building as fast as you can. Hold it.
      if (S.phase === "forming" && S.tiers.length < S.needThar) {
        S.queued = true;
        haptic("light");
        return;
      }
      if (S.phase === "holding") {
        if (S.tiers.length < S.needThar) {
          sendThar();
        } else {
          S.phase = "reaching";
          S.phaseT = 0;
          S.reach = 0;
          sfxWhistle();
          haptic("light");
          ctx.platform.interact({ type: "reach" });
        }
      }
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      if (ptr.down) return;
      ptr.down = true;
      ptr.id = e.pointerId;
      ptr.originX = e.clientX - (typeof e.offsetX === "number" ? e.offsetX : 0);
      ptr.originY = e.clientY - (typeof e.offsetY === "number" ? e.offsetY : 0);
      ptr.x = pressX(e);
      ptr.y = pressY(e);
      ptr.sx = ptr.x;
      ptr.sy = ptr.y;
      ptr.t0 = performance.now();
      ptr.drag = false;
      initAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (err) { /* blocked */ } }
    }, { passive: false });

    ctx.listen(window, "pointermove", (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      ptr.x = pressX(e);
      ptr.y = pressY(e);
      if (!ptr.drag) {
        const moved = Math.abs(ptr.x - ptr.sx) + Math.abs(ptr.y - ptr.sy);
        if (moved > TAP_SLOP) ptr.drag = true;
      }
    }, { passive: false });

    function endPointer(e) {
      if (!ptr.down || (e && e.pointerId !== ptr.id)) return;
      const held = performance.now() - ptr.t0;
      const wasTap = !ptr.drag && held < TAP_MS;
      ptr.down = false;
      ptr.drag = false;
      S.touching = false;
      if (wasTap) onTap(ptr.x, ptr.y);
    }
    ctx.listen(window, "pointerup", endPointer);
    ctx.listen(window, "pointercancel", endPointer);

    // ================================================================== frame
    function render(t) {
      W = ctx.width; H = ctx.height;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.save();
      if (S.shake > 0) {
        g.translate((rnd() - 0.5) * S.shake * 14, (rnd() - 0.5) * S.shake * 10);
      }
      drawSky();
      drawBuildings();
      drawRopeAndHandi(t);
      drawStreet();
      drawCrowd(t);
      drawPyramid(t);
      drawEffects();
      g.restore();
      if (S.flash > 0) {
        g.globalAlpha = S.flash * 0.55;
        g.fillStyle = "#fff4d8";
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
      drawHud(t);
      drawBanner();
      if (S.phase !== "title" && S.phase !== "collapsed" && !infoOpen) drawHint();
      if (S.phase === "title") drawTitle(t);
      if (S.phase === "collapsed") drawGameOver(t);
      if (infoOpen) drawInfo();
    }

    let lastW = 0, lastH = 0;
    ctx.onFrame((dtMs, timeMs) => {
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      const t = timeMs / 1000;
      if (ctx.width !== lastW || ctx.height !== lastH) {
        W = ctx.width; H = ctx.height;
        lastW = W; lastH = H;
        fitCamera();
      }
      // Hand-off from tap to steer: authority arrives once the press is clearly
      // not a tap, and eases in so a slow tap never yanks the tower over.
      if (ptr.down && !ptr.drag && performance.now() - ptr.t0 > TAP_MS) ptr.drag = true;
      S.touching = ptr.down && ptr.drag && !infoOpen;
      if (S.touching) {
        const want = clamp((ptr.x - W / 2) / (W * 0.34), -1, 1) * LEAN_LIMIT * 0.62;
        S.braceTarget += (want - S.braceTarget) * Math.min(1, dt * 7);
      } else {
        S.braceTarget += (0 - S.braceTarget) * Math.min(1, dt * 1.6);
      }
      if (!infoOpen) step(dt);
      render(t);
    });

    // ---------------------------------------------------------------- attract
    function setupTitle() {
      S.round = 1;
      S.needThar = 4;
      S.handiFt = handiFeetFor(4);
      S.tiers = [];
      while (S.tiers.length < 4) addTier();
      for (const row of S.tiers) for (const m of row) m.climb = 1;
      S.phase = "title";
      S.theta = 0.03;
      fitCamera();
      S.camPxPerFt = S.camTarget;
      S.round = 0;
    }

    try {
      const saved = await ctx.storage.get("bestFeet");
      if (typeof saved === "number" && isFinite(saved) && saved > 0) {
        bestStored = saved;
        S.best = saved;
      }
    } catch (err) { /* no storage here */ }

    W = ctx.width; H = ctx.height;
    lastW = W; lastH = H;
    setupTitle();
    render(0);
    ctx.platform.ready();
  }
};
