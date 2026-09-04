/**
 * Govinda Ala Re — a dahi handi in your hand.
 *
 * Rendered in three@0.164.1. The simulation stays exactly two-dimensional
 * because that is what the statics is — the lever rule only ever cares about x
 * — so each tier is merely bowed toward the camera in z to read as the ring it
 * really is. Depth is a drawing decision here, and it touches no physics.
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
    const LOOSE_AUTHORITY = 0.16;

    const TAP_MS = 260;
    const TAP_SLOP = 12;

    // --------------------------------------------------------------- palette
    const SKIN = ["#7a4a2e", "#9c6640", "#5d3820", "#b8815a", "#86532f", "#6a4126"];
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

    const canvas = ctx.createCanvas({ touchAction: "none" });

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
        fx: 0, fy: 0, fz: 0, fvx: 0, fvy: 0, fvz: 0, frot: 0, fvrot: 0
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
      camDist: 40,
      camTargetDist: 40,
      camLook: 10,
      camTargetLook: 10,
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
      S.camDist = S.camTargetDist;
      S.camLook = S.camTargetLook;
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
        m.fz = manZ(m);
        m.fvz = rrange(-1.6, 2.6);
        m.fvx = dir * rrange(0.4, 3.2) * (0.4 + m.y / 24);
        m.fvy = rrange(-1.2, 2.4);
        m.fvrot = rrange(-5.5, 5.5) * (0.5 + m.y / 22);
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
          x: hx + rrange(-0.5, 0.5), y: S.handiFt + rrange(-0.4, 0.4), z: rrange(-0.5, 0.5),
          vx: rrange(-5, 5), vy: rrange(-1, 6), vz: rrange(-4, 4),
          rot: rrange(0, 6.3), vrot: rrange(-8, 8),
          size: rrange(0.14, 0.4), life: 1
        });
      }
      for (let i = 0; i < 150; i++) {
        S.curd.push({
          x: hx + rrange(-0.7, 0.7), y: S.handiFt + rrange(-0.5, 0.2), z: rrange(-0.7, 0.7),
          vx: rrange(-3.4, 3.4), vy: rrange(-1.5, 3.4), vz: rrange(-2.8, 3.2),
          r: rrange(0.07, 0.26), life: 1
        });
      }
      for (let i = 0; i < 60; i++) {
        S.confetti.push({
          x: rrange(-9, 9), y: S.handiFt + rrange(-1, 5), z: rrange(-6, 6),
          vx: rrange(-2, 2), vy: rrange(-1, 2.4), vz: rrange(-1.4, 1.4),
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
      S.camDist += (S.camTargetDist - S.camDist) * Math.min(1, dt * 2.4);
      S.camLook += (S.camTargetLook - S.camLook) * Math.min(1, dt * 2.4);

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
          if (S.queued) {
            S.queued = false;
            if (S.tiers.length < S.needThar) sendThar();
            else startReach();
          }
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
                x: s.side * 12, y: rrange(1, S.handiFt * 0.6), z: rrange(-3, 5),
                vx: -s.side * rrange(7, 13), vy: rrange(1.5, 4.5), vz: rrange(-1, 1),
                life: 1
              });
            }
          } else if (s.t > s.dur + 0.4) S.spray = null;
        }

        // ---- lean. The tower falls away on its own; your thumb is the only
        // thing bracing it, and where you hold it decides who carries the load.
        const authority = S.touching ? 1 : LOOSE_AUTHORITY;
        const gustAmp = 0.12 + S.tiers.length * 0.04 + (S.phase === "forming" ? 0.14 : 0);
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
        p.vy -= G * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rot += p.vrot * dt;
        if (p.y < 0) { S.shards.splice(i, 1); continue; }
      }
      for (let i = S.curd.length - 1; i >= 0; i--) {
        const p = S.curd[i];
        p.vy -= G * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0) {
          S.splats.push({ x: p.x, z: p.z, r: p.r * rrange(1.4, 2.6), life: 1 });
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
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rot += p.vrot * dt;
        p.life -= dt * 0.22;
        if (p.life <= 0 || p.y < -1) S.confetti.splice(i, 1);
      }
      for (let i = S.sprays.length - 1; i >= 0; i--) {
        const p = S.sprays[i];
        p.vy -= G * 0.6 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.life -= dt * 0.9;
        if (p.life <= 0 || p.y < 0) S.sprays.splice(i, 1);
      }
      if (S.phase === "collapsed") {
        for (const m of allMen()) {
          m.fvy -= G * dt;
          m.fx += m.fvx * dt;
          m.fy += m.fvy * dt;
          m.fz += m.fvz * dt;
          m.frot += m.fvrot * dt;
          if (m.fy < 0) {
            m.fy = 0;
            m.fvy *= -0.18;
            m.fvx *= 0.52;
            m.fvrot *= 0.44;
            if (Math.abs(m.fvy) < 0.4) m.fvy = 0;
            if (Math.abs(m.fvx) < 0.3) m.fvx = 0;
            m.fvz *= 0.52;
          }
          const edge = STREET_HALF;
          if (m.fx < -edge) { m.fx = -edge; m.fvx = Math.abs(m.fvx) * 0.3; }
          if (m.fx > edge) { m.fx = edge; m.fvx = -Math.abs(m.fvx) * 0.3; }
        }
      }
    }

    // ===================================================================
    // Three
    // ===================================================================
    let THREE = null;
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e1) {
      try { THREE = await ctx.importModule(THREE_URL); } catch (e2) { THREE = null; }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) {
      ctx.platform.error({ where: "load three", message: "WebGLRenderer missing" });
      ctx.platform.ready();
      return;
    }

    // The inner faces of the buildings. Nine thar is 8.8 ft of base half-width
    // plus linked arms, so this is the street and everything stays inside it.
    const STREET_HALF = 11.2;
    const ARC = 1.7;            // how far the middle of a tier bows at you
    const MAX_MEN = (MAX_THAR * (MAX_THAR + 1)) / 2;

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (err) { /* gone */ } });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#150c29");
    scene.fog = new THREE.Fog("#2e1640", 46, 190);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 420);

    // ---- light. A festival street is lit warm from below and behind; the key
    // ---- is the strung bulbs, not a sun.
    scene.add(new THREE.HemisphereLight("#9a7ad0", "#4a3038", 1.7));
    const key = new THREE.DirectionalLight("#ffdcae", 3.4);
    key.position.set(-16, 40, 26);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 120;
    key.shadow.camera.left = -22;
    key.shadow.camera.right = 22;
    key.shadow.camera.top = 52;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0012;
    scene.add(key);
    const rim = new THREE.DirectionalLight("#ff8a44", 1.9);
    rim.position.set(18, 12, -22);
    scene.add(rim);
    // the strung bulbs over the street, which is what actually lights a handi
    const glow = new THREE.PointLight("#ffb057", 260, 80, 2);
    glow.position.set(0, 9, 15);
    scene.add(glow);
    const fill = new THREE.DirectionalLight("#a9c4ff", 0.9);
    fill.position.set(10, 8, 30);
    scene.add(fill);

    // ---- street
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ color: "#3d2e40", roughness: 0.92, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ---- sky, as vertex colours on one plane rather than a texture
    const bgGeo = new THREE.PlaneGeometry(460, 300, 1, 14);
    {
      const pos = bgGeo.attributes.position;
      // Stops by height. The lowest one is the fog colour, so the ground fades
      // into the sky instead of ending at a visible line.
      // World heights, not plane coordinates: the visible slice of sky is only
      // about y = 0..60, and keying to the plane put the warm band under it.
      const stops = [
        [-80, "#2e1640"], [0, "#2e1640"], [14, "#77384e"],
        [38, "#4b2450"], [80, "#2b1541"], [220, "#0f0818"]
      ];
      const cols = [];
      const ca = new THREE.Color(), cb = new THREE.Color(), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) + 78;          // plane sits at y = 78
        let j = 0;
        while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
        const span = stops[j + 1][0] - stops[j][0];
        const f = span > 0 ? clamp((t - stops[j][0]) / span, 0, 1) : 0;
        ca.set(stops[j][1]); cb.set(stops[j + 1][1]);
        c.copy(ca).lerp(cb, f);
        cols.push(c.r, c.g, c.b);
      }
      bgGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    }
    const backdrop = new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, fog: false, depthWrite: false
    }));
    backdrop.position.set(0, 78, -120);
    scene.add(backdrop);

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(6, 24, 16),
      new THREE.MeshBasicMaterial({ color: "#fff4d6", fog: false })
    );
    moon.position.set(30, 52, -88);
    scene.add(moon);

    // ---- the two buildings the handi is strung between
    const buildMat = new THREE.MeshStandardMaterial({ color: "#33203f", roughness: 0.88 });
    const winGeo = new THREE.PlaneGeometry(2.6, 3.1);
    const winCount = 2 * 13 * 4;
    const windows = new THREE.InstancedMesh(
      winGeo,
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      winCount
    );
    windows.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    {
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      const warm = ["#ffcf6b", "#ffb347", "#9fd8ff", "#ffe9b0", "#ff8f5a"];
      let w = 0;
      for (const side of [-1, 1]) {
        const bx = side * (STREET_HALF + 7);
        const b = new THREE.Mesh(new THREE.BoxGeometry(14, 96, 34), buildMat);
        b.position.set(bx, 48, -6);
        b.castShadow = false;
        b.receiveShadow = true;
        scene.add(b);
        const yaw = new THREE.Matrix4().makeRotationY(side < 0 ? Math.PI / 2 : -Math.PI / 2);
        for (let f = 0; f < 13; f++) {
          for (let cIdx = 0; cIdx < 4; cIdx++) {
            const lit = rnd() < 0.62;
            m4.makeTranslation(side * (STREET_HALF + 0.03), 4.5 + f * 6.9, -4 - cIdx * 6);
            m4.multiply(yaw);
            windows.setMatrixAt(w, m4);
            col.set(lit ? warm[(rnd() * warm.length) | 0] : "#0d0716");
            windows.setColorAt(w, col);
            w++;
          }
        }
      }
      windows.count = w;
    }
    scene.add(windows);

    // ---- bunting strung across the street. It rides on a group pinned above
    // ---- the handi, so it stays in a portrait frame at three thar and at nine.
    const buntGroup = new THREE.Group();
    {
      const flags = new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.62, 1.5, 3),
        new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), 2 * 17
      );
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      const sc = new THREE.Vector3(1, 1, 1);
      const pv = new THREE.Vector3();
      let f = 0;
      for (let row = 0; row < 2; row++) {
        const y0 = -row * 6.5;
        const z = 5 - row * 12;
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          pv.set(lerp(-STREET_HALF, STREET_HALF, t),
                 y0 - 4.2 * Math.sin(Math.PI * t) - 0.75, z);
          m4.compose(pv, q, sc);
          flags.setMatrixAt(f, m4);
          col.set(CLOTH[(i + row) % CLOTH.length]);
          flags.setColorAt(f, col);
          f++;
        }
        const cord = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.055, 4, 40, Math.PI),
          new THREE.MeshStandardMaterial({ color: "#7a5632", roughness: 1 })
        );
        cord.scale.set(STREET_HALF, 4.2, 1);
        cord.rotation.z = Math.PI;
        cord.position.set(0, y0, z);
        buntGroup.add(cord);
      }
      buntGroup.add(flags);
      scene.add(buntGroup);
    }

    // ---- the handi, and the rope it hangs from
    const handiGroup = new THREE.Group();
    {
      const prof = [];
      const pts = [[0, -0.92], [0.5, -0.82], [0.82, -0.44], [0.94, 0], [0.86, 0.3],
                   [0.6, 0.55], [0.42, 0.66], [0.41, 0.82], [0.54, 0.9], [0, 0.9]];
      for (const p of pts) prof.push(new THREE.Vector2(p[0], p[1]));
      const pot = new THREE.Mesh(
        new THREE.LatheGeometry(prof, 28),
        new THREE.MeshStandardMaterial({ color: "#a8542c", roughness: 0.82, metalness: 0.02 })
      );
      pot.castShadow = true;
      handiGroup.add(pot);

      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.13, 8, 26),
        new THREE.MeshStandardMaterial({ color: "#e8402f", roughness: 0.85 })
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.12;
      handiGroup.add(band);

      const marigold = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.17, 8, 6),
        new THREE.MeshStandardMaterial({ roughness: 0.75 }),
        22
      );
      {
        const m4 = new THREE.Matrix4();
        const col = new THREE.Color();
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          m4.makeTranslation(Math.cos(a) * 0.99, 0.34, Math.sin(a) * 0.99);
          marigold.setMatrixAt(i, m4);
          col.set(i % 2 ? "#ffb01f" : "#ff7a1a");
          marigold.setColorAt(i, col);
        }
      }
      handiGroup.add(marigold);

      const curdTop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16),
        new THREE.MeshStandardMaterial({ color: "#fdfbf3", roughness: 0.6 })
      );
      curdTop.position.y = 0.9;
      handiGroup.add(curdTop);
      scene.add(handiGroup);
    }

    const ropeMat = new THREE.MeshStandardMaterial({ color: "#c8a86a", roughness: 1 });
    const rope = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 4, 44, Math.PI), ropeMat);
    rope.scale.set(STREET_HALF, 2.6, 1);
    rope.rotation.z = Math.PI;
    scene.add(rope);
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), ropeMat);
    scene.add(drop);

    // ---- the crowd. Behind and to the sides, and mostly silhouette — a night
    // ---- street is dark, and a ring of bright capsules read as sweets.
    {
      const n = 78;
      const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.92 });
      const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.34, 1.5, 4, 7), bodyMat, n);
      const heads2 = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.3, 9, 7),
        new THREE.MeshStandardMaterial({ color: "#1d1220", roughness: 0.95 }), n);
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color(), dark = new THREE.Color("#150c1c");
      const pv = new THREE.Vector3();
      const qq = new THREE.Quaternion();
      const sc = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < n; i++) {
        let x, z;
        if (i < 10) {                     // a few in front, as framing
          x = rrange(-26, 26);
          z = rrange(30, 40);
        } else {
          const side = rnd() < 0.5 ? -1 : 1;
          x = side * rrange(9.5, 25);
          z = rrange(-17, 9);
        }
        const h = rrange(0.9, 1.16);
        col.set(pick(CLOTH)).lerp(dark, 0.62);
        pv.set(x, 1.42 * h, z);
        sc.set(h, h, h);
        m4.compose(pv, qq, sc);
        bodies.setMatrixAt(i, m4);
        bodies.setColorAt(i, col);
        pv.set(x, 2.5 * h, z);
        m4.compose(pv, qq, sc);
        heads2.setMatrixAt(i, m4);
      }
      scene.add(bodies);
      scene.add(heads2);
    }

    // ===================================================================
    // The govindas. Ten limbs, eleven joints and a head each, all written into
    // four instanced meshes — 45 men at nine thar is about a thousand matrices
    // a frame and four draw calls, which a phone will do all day.
    // ===================================================================
    // Capacity is not the same number as "how many to draw this frame", and
    // InstancedMesh.count is the latter. Keeping the caps separate matters:
    // testing against .count silently drops every man past last frame's total.
    const CAP_LIMB = MAX_MEN * 10, CAP_JOINT = MAX_MEN * 11, CAP_FIG = MAX_MEN;
    const skinMat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
    const limbs = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 7), skinMat, CAP_LIMB);
    const joints = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6), skinMat, CAP_JOINT);
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 14, 10), skinMat, CAP_FIG);
    const shorts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1.06, 1, 10),
      new THREE.MeshStandardMaterial({ roughness: 0.85 }), CAP_FIG);
    for (const im of [limbs, joints, heads, shorts]) {
      im.castShadow = true;
      im.frustumCulled = false;
      scene.add(im);
    }

    const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _D = new THREE.Vector3();
    const _P = new THREE.Vector3(), _S = new THREE.Vector3();
    const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion();
    const _UP = new THREE.Vector3(0, 1, 0);
    const _IDQ = new THREE.Quaternion();
    const _COL = new THREE.Color();
    const _COL2 = new THREE.Color();
    let nLimb = 0, nJoint = 0, nHead = 0, nShort = 0;

    function limb(ax, ay, az, bx, by, bz, thick) {
      _A.set(ax, ay, az); _B.set(bx, by, bz);
      _D.subVectors(_B, _A);
      const len = _D.length();
      if (len < 1e-5 || nLimb >= CAP_LIMB) return;
      _D.divideScalar(len);
      _Q.setFromUnitVectors(_UP, _D);
      _P.addVectors(_A, _B).multiplyScalar(0.5);
      _S.set(thick, len, thick);
      _M.compose(_P, _Q, _S);
      limbs.setMatrixAt(nLimb, _M);
      limbs.setColorAt(nLimb, _COL);
      nLimb++;
    }
    function joint(x, y, z, r) {
      if (nJoint >= CAP_JOINT) return;
      _P.set(x, y, z);
      _S.set(r, r, r);
      _M.compose(_P, _IDQ, _S);
      joints.setMatrixAt(nJoint, _M);
      joints.setColorAt(nJoint, _COL);
      nJoint++;
    }

    /** Where a tier bows toward the camera — a ring seen from outside. */
    function manZ(m) {
      const n = S.needThar - m.k;
      const halfW = (n - 1) / 2 * SPACING_FT;
      const baseHalf = (S.needThar - 1) / 2 * SPACING_FT;
      if (halfW < 0.01 || baseHalf < 0.01) return 0;
      const t = clamp(m.x0 / halfW, -1, 1);
      return ARC * (halfW / baseHalf) * (1 - t * t);
    }

    const HIP = 2.45, CHEST = 4.5, HEADY = 5.08, SH = 0.6;

    function poseMan(m, t, isTop) {
      const sx = Math.sin(S.theta);
      const sc = m.scale;
      const danger = m.fallen ? 0
        : clamp(Math.max((m.ratio - 0.75) / 0.8, (0.55 - m.stamina) / 0.55), 0, 1);
      const jitter = m.fallen ? 0 : Math.sin(t * 27 + m.phase) * danger * 0.075;
      _COL.copy(_COL2.set(m.skin));
      if (danger > 0.02) _COL.lerp(_COL2.set("#ff5330"), danger * 0.66);

      // Local height h above his own feet -> world. The shear is what leans him.
      const baseX = m.fallen ? m.fx : m.x0 + jitter;
      const baseY = m.fallen ? m.fy : m.y;
      const baseZ = m.fallen ? m.fz : manZ(m);
      const tip = m.fallen ? m.frot : 0;
      const hy = (h) => baseY + h * sc * Math.cos(tip);
      const hx = (h, lat) => baseX + (lat || 0) * sc
        + (m.fallen ? h * sc * Math.sin(tip) : sx * (baseY + h * sc));
      const hz = (h, dep) => baseZ + (dep || 0) * sc;

      const reach = isTop ? S.reach : 0;
      const handY = lerp(5.85, REACH_FT / sc, reach);
      const rise = reach * 0.22;
      const thick = 0.15 * sc;

      // feet: on the two shoulders below, or planted on the street
      let flx, flz, frx, frz, fy;
      if (m.fallen) {
        flx = hx(0, -0.5); frx = hx(0, 0.5);
        flz = hz(0, -0.3); frz = hz(0, 0.3);
        fy = baseY;
      } else if (m.k === 0) {
        flx = baseX - 0.52; frx = baseX + 0.52;
        flz = baseZ - 0.34; frz = baseZ + 0.34;
        fy = 0;
      } else {
        const below = S.tiers[m.k - 1];
        const L = below[m.i], R = below[m.i + 1];
        flx = (L ? L.x0 : baseX - 1.1) + sx * baseY;
        frx = (R ? R.x0 : baseX + 1.1) + sx * baseY;
        flz = L ? manZ(L) : baseZ;
        frz = R ? manZ(R) : baseZ;
        fy = baseY;
      }

      const hipX = hx(HIP + rise), hipY = hy(HIP + rise), hipZ = hz(HIP + rise);
      const chX = hx(CHEST + rise), chY = hy(CHEST + rise), chZ = hz(CHEST + rise);

      // legs, knees bent outward toward the shoulder each foot stands on
      const klx = (hipX - 0.22 * sc + flx) / 2 - 0.1 * sc;
      const krx = (hipX + 0.22 * sc + frx) / 2 + 0.1 * sc;
      const kly = (hipY + fy) / 2, kry = kly;
      const klz = (hipZ + flz) / 2, krz = (hipZ + frz) / 2;
      limb(hipX - 0.2 * sc, hipY, hipZ, klx, kly, klz, thick * 1.15);
      limb(klx, kly, klz, flx, fy, flz, thick);
      limb(hipX + 0.2 * sc, hipY, hipZ, krx, kry, krz, thick * 1.15);
      limb(krx, kry, krz, frx, fy, frz, thick);
      joint(klx, kly, klz, thick * 1.2);
      joint(krx, kry, krz, thick * 1.2);
      joint(flx, fy, flz, thick * 1.1);
      joint(frx, fy, frz, thick * 1.1);

      // torso
      limb(hipX, hipY, hipZ, chX, chY, chZ, thick * 2.05);
      joint(hipX, hipY, hipZ, thick * 1.9);

      // shoulders
      const slx = chX - SH * sc, srx = chX + SH * sc;
      limb(slx, chY, chZ, srx, chY, chZ, thick * 1.25);
      joint(slx, chY, chZ, thick * 1.4);
      joint(srx, chY, chZ, thick * 1.4);

      // arms
      let elx, ely, elz, erx, ery, erz, hlx, hly, hlz, hrx, hry, hrz;
      if (m.fallen) {
        // thrown out and down, not braced — otherwise a collapse reads as a cheer
        elx = hx(CHEST - 0.5, -1.0); ely = hy(CHEST - 0.5); elz = hz(CHEST - 0.5, -0.5);
        erx = hx(CHEST - 0.35, 1.0); ery = hy(CHEST - 0.35); erz = hz(CHEST - 0.35, 0.45);
        hlx = hx(CHEST - 1.5, -1.5); hly = hy(CHEST - 1.5); hlz = hz(CHEST - 1.5, -0.9);
        hrx = hx(CHEST - 1.3, 1.55); hry = hy(CHEST - 1.3); hrz = hz(CHEST - 1.3, 0.8);
      } else if (m.k === 0) {
        // the base ring links arms with its neighbours
        elx = hx(CHEST - 0.12, -1.02); ely = hy(CHEST - 0.12); elz = hz(CHEST - 0.12, -0.1);
        erx = hx(CHEST - 0.12, 1.02); ery = ely; erz = hz(CHEST - 0.12, 0.1);
        hlx = hx(CHEST + 0.04, -1.52); hly = hy(CHEST + 0.04); hlz = hz(CHEST + 0.04, -0.15);
        hrx = hx(CHEST + 0.04, 1.52); hry = hly; hrz = hz(CHEST + 0.04, 0.15);
      } else if (isTop && reach > 0.02) {
        elx = hx(CHEST + 0.5 + rise, -0.82); ely = hy(CHEST + 0.5 + rise); elz = hz(CHEST + 0.5 + rise, -0.2);
        erx = hx(CHEST + 0.7 + rise, 0.7); ery = hy(CHEST + 0.7 + rise); erz = hz(CHEST + 0.7 + rise, 0.2);
        const lean = clamp((handiX() - boyHandX()) / (2 * sc), -1.1, 1.1) * reach;
        hlx = hx(handY, -0.3 + lean); hly = hy(handY); hlz = hz(handY, -0.1);
        hrx = hx(handY + 0.34, 0.16 + lean); hry = hy(handY + 0.34); hrz = hz(handY + 0.34, 0.1);
      } else {
        // bracing the legs of the two men standing on his shoulders
        elx = hx(CHEST + 0.6, -0.88); ely = hy(CHEST + 0.6); elz = hz(CHEST + 0.6, -0.28);
        erx = hx(CHEST + 0.6, 0.88); ery = ely; erz = hz(CHEST + 0.6, 0.28);
        hlx = hx(5.85, -0.42); hly = hy(5.85); hlz = hz(5.85, -0.16);
        hrx = hx(5.85, 0.42); hry = hly; hrz = hz(5.85, 0.16);
      }
      limb(slx, chY, chZ, elx, ely, elz, thick * 0.92);
      limb(elx, ely, elz, hlx, hly, hlz, thick * 0.82);
      limb(srx, chY, chZ, erx, ery, erz, thick * 0.92);
      limb(erx, ery, erz, hrx, hry, hrz, thick * 0.82);
      joint(elx, ely, elz, thick);
      joint(erx, ery, erz, thick);
      joint(hlx, hly, hlz, thick * 0.95);
      joint(hrx, hry, hrz, thick * 0.95);

      // head
      if (nHead < CAP_FIG) {
        _P.set(hx(HEADY + rise), hy(HEADY + rise), hz(HEADY + rise));
        const hr = 0.4 * sc;
        _S.set(hr, hr * 1.06, hr);
        _M.compose(_P, _IDQ, _S);
        heads.setMatrixAt(nHead, _M);
        heads.setColorAt(nHead, _COL);
        nHead++;
      }

      // shorts
      if (nShort < CAP_FIG) {
        _P.set(hx(HIP + 0.1 + rise), hy(HIP + 0.1 + rise), hz(HIP + 0.1 + rise));
        _S.set(0.4 * sc, 0.8 * sc, 0.36 * sc);
        _M.compose(_P, _IDQ, _S);
        shorts.setMatrixAt(nShort, _M);
        shorts.setColorAt(nShort, _COL2.set(m.cloth));
        nShort++;
      }
    }

    // ===================================================================
    // Debris
    // ===================================================================
    function instanced(geo, mat, n) {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
      return im;
    }
    const mShard = instanced(new THREE.BoxGeometry(1, 0.7, 0.9),
      new THREE.MeshStandardMaterial({ color: "#a8542c", roughness: 0.85 }), 40);
    const mCurd = instanced(new THREE.SphereGeometry(1, 7, 5),
      new THREE.MeshStandardMaterial({ color: CURD, roughness: 0.55 }), 200);
    const mSplat = instanced(new THREE.CircleGeometry(1, 12),
      new THREE.MeshStandardMaterial({ color: CURD, roughness: 0.6, transparent: true, opacity: 0.9 }), 240);
    const mConf = instanced(new THREE.PlaneGeometry(0.42, 0.22),
      new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), 90);
    const mSpray = instanced(new THREE.SphereGeometry(0.09, 5, 4),
      new THREE.MeshStandardMaterial({ color: "#bfe6ff", roughness: 0.3,
        transparent: true, opacity: 0.7 }), 110);

    const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

    function syncDebris(t) {
      let n = 0;
      for (const p of S.shards) {
        if (n >= 40) break;
        _P.set(p.x, p.y, p.z);
        _Q.setFromAxisAngle(_UP, p.rot);
        _S.set(p.size, p.size, p.size);
        _M.compose(_P, _Q, _S);
        mShard.setMatrixAt(n++, _M);
      }
      mShard.count = n;
      mShard.instanceMatrix.needsUpdate = true;

      n = 0;
      for (const p of S.curd) {
        if (n >= 200) break;
        _P.set(p.x, p.y, p.z);
        _S.set(p.r, p.r, p.r);
        _M.compose(_P, _IDQ, _S);
        mCurd.setMatrixAt(n++, _M);
      }
      mCurd.count = n;
      mCurd.instanceMatrix.needsUpdate = true;

      n = 0;
      for (const p of S.splats) {
        if (n >= 240) break;
        _P.set(p.x, 0.03 + n * 0.0012, p.z);
        const r = p.r * clamp(p.life, 0, 1);
        _S.set(r, r, r);
        _M.compose(_P, FLAT, _S);
        mSplat.setMatrixAt(n++, _M);
      }
      mSplat.count = n;
      mSplat.instanceMatrix.needsUpdate = true;

      n = 0;
      for (const p of S.confetti) {
        if (n >= 90) break;
        _P.set(p.x, p.y, p.z);
        _Q.setFromAxisAngle(_UP, p.rot);
        _S.set(1, 1, 1);
        _M.compose(_P, _Q, _S);
        mConf.setMatrixAt(n, _M);
        mConf.setColorAt(n, _COL.set(p.c));
        n++;
      }
      mConf.count = n;
      mConf.instanceMatrix.needsUpdate = true;
      if (mConf.instanceColor) mConf.instanceColor.needsUpdate = true;

      n = 0;
      for (const p of S.sprays) {
        if (n >= 110) break;
        _P.set(p.x, p.y, p.z);
        _S.set(1, 1, 1);
        _M.compose(_P, _IDQ, _S);
        mSpray.setMatrixAt(n++, _M);
      }
      mSpray.count = n;
      mSpray.instanceMatrix.needsUpdate = true;
    }

    // ===================================================================
    // Camera
    // ===================================================================
    let W = ctx.width, H = ctx.height;

    function handiX() { return Math.sin(S.handiSway) * 0.8; }
    function boyHandX() {
      const row = S.tiers[S.tiers.length - 1];
      if (!row || row.length !== 1) return 0;
      const top = row[0];
      return top.x0 + Math.sin(S.theta) * (top.y + REACH_FT);
    }

    function fitCamera() {
      const topFt = S.handiFt + 4.5;
      const halfW = (S.needThar - 1) / 2 * SPACING_FT + 3.4;
      const vfov = (camera.fov * Math.PI) / 180;
      const aspect = Math.max(0.42, W / Math.max(1, H));
      const dv = (topFt / 2) / Math.tan(vfov / 2);
      const dh = halfW / (Math.tan(vfov / 2) * aspect);
      S.camTargetDist = Math.max(dv, dh) * 1.06 + 5;
      const vHalf = S.camTargetDist * Math.tan(vfov / 2);
      S.camTargetLook = Math.max(topFt * 0.4, vHalf - 4.2);
    }

    function placeCamera(t) {
      const shake = S.shake;
      const drift = Math.sin(t * 0.21) * 0.05;
      camera.position.set(
        Math.sin(S.theta) * S.camLook * 0.3 + Math.sin(drift) * S.camDist * 0.1
          + (rnd() - 0.5) * shake * 1.6,
        S.camLook + S.camDist * 0.05 + (rnd() - 0.5) * shake * 1.2,
        S.camDist * Math.cos(drift)
      );
      camera.lookAt(0, S.camLook * 0.97, 0);
      key.target.position.set(0, S.camLook * 0.7, 0);
      key.target.updateMatrixWorld();
      key.position.set(-16, S.camLook + 26, 26);
      key.shadow.camera.top = S.handiFt + 8;
      key.shadow.camera.updateProjectionMatrix();
    }

    // ===================================================================
    // Chrome. DOM rather than a second canvas, so the type stays crisp and the
    // GL surface is only ever the street.
    // ===================================================================
    const ui = ctx.createRoot({ touchAction: "none" });
    // The root sits above the GL canvas, so it has to be invisible to the
    // finger; only the info button opts back in.
    ui.style.pointerEvents = "none";
    ui.innerHTML = [
      '<style>',
      '.gr{position:absolute;inset:0;pointer-events:none;color:#fff;',
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
      '-webkit-user-select:none;user-select:none;overflow:hidden}',
      '.gr-scrim{position:absolute;left:0;right:0;top:0;height:150px;',
      'background:linear-gradient(180deg,rgba(8,4,16,.94),rgba(8,4,16,.72) 55%,rgba(8,4,16,0))}',
      '.gr-thar{position:absolute;left:14px;font-weight:800;font-size:20px;letter-spacing:.4px}',
      '.gr-ft{position:absolute;left:14px;font-weight:600;font-size:12px;opacity:.62}',
      '.gr-best{position:absolute;right:14px;font-weight:600;font-size:12px;opacity:.62;text-align:right}',
      '.gr-handis{position:absolute;right:14px;font-weight:700;font-size:12px;color:#ffd23f;text-align:right}',
      '.gr-track{position:absolute;height:7px;border-radius:4px;background:rgba(255,255,255,.14)}',
      '.gr-lean{position:absolute;height:7px;border-radius:4px;background:#7fe3a0;transition:background .12s}',
      '.gr-tick{position:absolute;width:2px;height:13px;background:rgba(255,255,255,.85);border-radius:1px}',
      '.gr-wtrack{position:absolute;height:5px;border-radius:3px;background:rgba(255,255,255,.12)}',
      '.gr-weak{position:absolute;height:5px;border-radius:3px;background:#7fe3a0}',
      '.gr-wlab{position:absolute;font-size:9px;font-weight:700;opacity:.5;text-align:right}',
      '.gr-info{position:absolute;width:34px;height:34px;border-radius:11px;pointer-events:auto;',
      'background:rgba(0,0,0,.42);border:0;color:#fff;font-size:17px;font-weight:700;',
      'font-family:inherit;display:flex;align-items:center;justify-content:center}',
      '.gr-hint{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;',
      'font-size:11.5px;font-weight:600;padding:5px 12px;border-radius:11px;',
      'background:rgba(8,4,16,.62);opacity:.9}',
      '.gr-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
      'text-align:center;padding:14px 20px;border-radius:15px;background:rgba(8,4,16,.82);',
      'width:max-content;max-width:90%}',
      '.gr-big{font-size:31px;font-weight:800;color:#ffd23f;line-height:1.08;white-space:nowrap}',
      '.gr-sub{font-size:13px;font-weight:600;opacity:.84;margin-top:5px}',
      '.gr-veil{position:absolute;inset:0;background:rgba(8,4,16,.66)}',
      '.gr-flash{position:absolute;inset:0;background:#fff4d8;opacity:0}',
      '.gr-pulse{animation:grp 1.5s ease-in-out infinite}',
      '@keyframes grp{0%,100%{opacity:.55}50%{opacity:1}}',
      '.gr-help{position:absolute;inset:0;background:rgba(6,3,12,.9);padding:0 22px;',
      'overflow-y:auto;-webkit-overflow-scrolling:touch}',
      '.gr-help h2{font-size:23px;color:#ffd23f;text-align:center;margin:0 0 14px;font-weight:800}',
      '.gr-help dt{font-size:12px;font-weight:800;color:#ffd23f;margin-top:11px}',
      '.gr-help dd{font-size:12.5px;font-weight:600;opacity:.84;margin:3px 0 0;line-height:1.42}',
      '.gr-help p{text-align:center;font-size:11px;font-weight:700;opacity:.5;margin:18px 0 0}',
      '</style>',
      '<div class="gr">',
      '<div class="gr-scrim"></div>',
      '<div class="gr-thar"></div><div class="gr-ft"></div>',
      '<div class="gr-best"></div><div class="gr-handis"></div>',
      '<div class="gr-track"></div><div class="gr-lean"></div><div class="gr-tick"></div>',
      '<div class="gr-wtrack"></div><div class="gr-weak"></div><div class="gr-wlab">WEAKEST</div>',
      '<button class="gr-info" type="button" aria-label="How to play">i</button>',
      '<div class="gr-hint"></div>',
      '<div class="gr-flash"></div>',
      '<div class="gr-veil" hidden></div>',
      '<div class="gr-card" hidden></div>',
      '<div class="gr-help" hidden></div>',
      '</div>'
    ].join("");

    const q = (sel) => ui.querySelector(sel);
    const elThar = q(".gr-thar"), elFt = q(".gr-ft"), elBest = q(".gr-best");
    const elHandis = q(".gr-handis"), elTrack = q(".gr-track"), elLean = q(".gr-lean");
    const elTick = q(".gr-tick"), elWTrack = q(".gr-wtrack"), elWeak = q(".gr-weak");
    const elWLab = q(".gr-wlab"), elInfo = q(".gr-info"), elHint = q(".gr-hint");
    const elFlash = q(".gr-flash"), elVeil = q(".gr-veil"), elCard = q(".gr-card");
    const elHelp = q(".gr-help"), elScrim = q(".gr-scrim");

    let infoOpen = false;
    const INFO = [
      ["TAP", "sends up the next thar. When the pyramid is tall enough, it sends your Govinda for the pot."],
      ["DRAG", "leans the whole tower. This is the only control, and it does two things at once."],
      ["THE CATCH", "leaning moves the load. Lean right and the man on the left is resting; the man on the right is carrying almost everything."],
      ["SO", "rock the pyramid to rest each flank in turn. Men glowing red are close to going."],
      ["BUT", "the man in the middle of the base barely feels your lean. He is your clock. Hurry."],
      ["DON'T", "lean so far that a man's feet leave the shoulders under him. The meter turns red first."]
    ];
    elHelp.innerHTML = "<h2>DAHI HANDI</h2><dl>"
      + INFO.map((r) => "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>").join("")
      + "</dl><p>TAP ANYWHERE TO CLOSE</p>";

    function layoutHud() {
      const top = ctx.safeArea.top + 12;
      const bw = Math.min(190, W * 0.5);
      const bx = (W - bw) / 2;
      elThar.style.top = (top + 6) + "px";
      elFt.style.top = (top + 30) + "px";
      elBest.style.top = (top + 8) + "px";
      elHandis.style.top = (top + 26) + "px";
      elTrack.style.cssText += ";left:" + bx + "px;width:" + bw + "px;top:" + (top + 54) + "px";
      elLean.style.top = (top + 54) + "px";
      elTick.style.left = (bx + bw / 2 - 1) + "px";
      elTick.style.top = (top + 51) + "px";
      elWTrack.style.cssText += ";left:" + bx + "px;width:" + bw + "px;top:" + (top + 68) + "px";
      elWeak.style.left = bx + "px";
      elWeak.style.top = (top + 68) + "px";
      elWLab.style.right = (W - bx + 6) + "px";
      elWLab.style.top = (top + 68) + "px";
      elInfo.style.right = "12px";
      elInfo.style.top = (top + 34) + "px";
      elHint.style.bottom = (ctx.safeArea.bottom + 22) + "px";
      elHelp.style.paddingTop = Math.max(top + 84, H * 0.15) + "px";
      elHelp.style.paddingBottom = (ctx.safeArea.bottom + 24) + "px";
    }

    let lastCard = "";
    function setCard(html) {
      if (html === lastCard) return;
      lastCard = html;
      if (!html) { elCard.hidden = true; elCard.innerHTML = ""; return; }
      elCard.hidden = false;
      elCard.innerHTML = html;
    }

    function syncHud(t) {
      const bw = Math.min(190, W * 0.5);
      const bx = (W - bw) / 2;
      const playing = S.phase !== "title";
      elThar.textContent = playing ? S.tiers.length + " / " + S.needThar + " THAR" : "";
      elFt.textContent = playing ? Math.round(S.handiFt) + " FT UP" : "";
      elBest.textContent = S.best > 0 && playing ? "BEST " + Math.round(S.best) + " FT" : "";
      elHandis.textContent = S.broke > 0 && playing ? S.broke + " HANDI" + (S.broke > 1 ? "S" : "") : "";
      const show = playing ? "block" : "none";
      elTrack.style.display = show; elLean.style.display = show; elTick.style.display = show;
      elWTrack.style.display = show; elWeak.style.display = show; elWLab.style.display = show;
      elScrim.style.opacity = playing ? "1" : "0";

      const lean = clamp(Math.sin(S.theta) / LEAN_LIMIT, -1, 1);
      const mag = Math.abs(lean);
      elLean.style.background = mag > 0.78 ? "#ff4d3a" : mag > 0.5 ? "#ffb01f" : "#7fe3a0";
      elLean.style.left = (bx + bw / 2 + Math.min(0, lean * bw / 2)) + "px";
      elLean.style.width = (mag * bw / 2) + "px";

      let wv = 1;
      for (const row of S.tiers) {
        for (const p of row) { if (p.climb >= 1 && p.stamina < wv) wv = p.stamina; }
      }
      elWeak.style.width = Math.max(2, bw * wv) + "px";
      elWeak.style.background = wv < 0.25 ? "#ff4d3a" : wv < 0.55 ? "#ffb01f" : "#7fe3a0";

      elFlash.style.opacity = String(S.flash * 0.55);
      elInfo.textContent = infoOpen ? "×" : "i";
      elHelp.hidden = !infoOpen;

      let hint = "";
      if (!infoOpen) {
        if (S.phase === "holding") {
          hint = S.tiers.length < S.needThar
            ? "TAP to send up a thar   ·   DRAG to hold it"
            : "TAP to send him for the handi";
        } else if (S.phase === "forming") {
          hint = S.queued
            ? (S.tiers.length < S.needThar ? "next thar queued — hold it steady"
                                           : "he goes as soon as they are set")
            : "hold it steady — they are climbing";
        } else if (S.phase === "reaching") hint = "get him under the pot";
      }
      elHint.textContent = hint;
      elHint.style.display = hint ? "block" : "none";

      if (infoOpen) { elVeil.hidden = true; setCard(""); return; }
      if (S.phase === "title") {
        elVeil.hidden = false;
        elCard.style.opacity = "1";
        setCard('<div class="gr-big">GOVINDA<br>ALA RE</div>'
          + '<div class="gr-sub">build the thar · break the handi</div>'
          + '<div class="gr-sub gr-pulse" style="margin-top:16px;font-size:16px;font-weight:800;opacity:1">TAP TO BEGIN</div>'
          + (S.best > 0 ? '<div class="gr-sub" style="opacity:.6">BEST ' + Math.round(S.best) + ' FT</div>' : ""));
      } else if (S.phase === "collapsed") {
        elVeil.hidden = false;
        elCard.style.opacity = "1";
        const why = S.failWho === "toppled" ? "IT WENT OVER" : "THE BASE GAVE OUT";
        setCard('<div class="gr-big" style="font-size:25px;color:#ff6a52">' + why + "</div>"
          + '<div class="gr-sub">' + (S.broke > 0
              ? S.broke + " handi" + (S.broke > 1 ? "s" : "") + " broken"
              : "no handi this time") + "</div>"
          + (S.best > 0 ? '<div class="gr-big" style="margin-top:14px">' + Math.round(S.best)
              + ' FT</div><div class="gr-sub" style="opacity:.55;font-size:11px">highest handi</div>' : "")
          + (S.phaseT > 0.9
              ? '<div class="gr-sub gr-pulse" style="margin-top:16px;font-size:15px;font-weight:800;opacity:1">TAP TO GO AGAIN</div>'
              : ""));
      } else if (S.banner && S.bannerT < 2.6) {
        elVeil.hidden = true;
        setCard('<div class="gr-big">' + S.banner.text + "</div>"
          + '<div class="gr-sub">' + S.banner.sub + "</div>");
        elCard.style.opacity = String(S.bannerT < 0.3 ? S.bannerT / 0.3
          : clamp((2.6 - S.bannerT) / 0.6, 0, 1));
      } else {
        elVeil.hidden = true;
        elCard.style.opacity = "1";
        setCard("");
      }
    }

    // ===================================================================
    // Frame
    // ===================================================================
    function segment(mesh, ax, ay, az, bx, by, bz, thick) {
      _A.set(ax, ay, az); _B.set(bx, by, bz);
      _D.subVectors(_B, _A);
      const len = _D.length() || 0.001;
      _D.divideScalar(len);
      mesh.quaternion.setFromUnitVectors(_UP, _D);
      mesh.position.addVectors(_A, _B).multiplyScalar(0.5);
      mesh.scale.set(thick, len, thick);
    }

    function render(t) {
      nLimb = 0; nJoint = 0; nHead = 0; nShort = 0;
      for (let k = 0; k < S.tiers.length; k++) {
        const row = S.tiers[k];
        const isTopRow = k === S.tiers.length - 1 && row.length === 1
          && S.tiers.length === S.needThar;
        for (const m of row) poseMan(m, t, isTopRow);
      }
      limbs.count = nLimb; joints.count = nJoint;
      heads.count = nHead; shorts.count = nShort;
      for (const im of [limbs, joints, heads, shorts]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }

      const gone = S.phase === "smashed";
      handiGroup.visible = !gone;
      drop.visible = !gone;
      if (!gone) {
        const hx = handiX();
        handiGroup.position.set(hx, S.handiFt, 0);
        handiGroup.rotation.z = Math.sin(S.handiSway) * 0.09;
        segment(drop, 0, S.handiFt + 2.2, 0, hx, S.handiFt + 0.86, 0, 1);
      }
      rope.position.set(0, S.handiFt + 4.8, 0);
      buntGroup.position.y = S.handiFt + 11;

      syncDebris(t);
      placeCamera(t);
      renderer.render(scene, camera);
    }

    // ===================================================================
    // Input
    // ===================================================================
    const ptr = { down: false, id: null, originX: 0, originY: 0, x: 0, y: 0,
                  sx: 0, sy: 0, t0: 0, drag: false };
    const pressX = (e) => e.clientX - ptr.originX;
    const pressY = (e) => e.clientY - ptr.originY;

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

    function startReach() {
      S.phase = "reaching";
      S.phaseT = 0;
      S.reach = 0;
      sfxWhistle();
      haptic("light");
      ctx.platform.interact({ type: "reach" });
    }

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

    function onTap() {
      if (infoOpen) { infoOpen = false; return; }
      if (S.phase === "title") { beginGame(); haptic("medium"); return; }
      if (S.phase === "collapsed") {
        if (S.phaseT > 0.9) { beginGame(); haptic("medium"); }
        return;
      }
      // A tap while anyone is still climbing used to vanish. Queue it — and
      // note the guard has to cover the *last* tier climbing too, or the tap
      // that sends the boy for the pot is the one that gets eaten.
      if (S.phase === "forming") {
        S.queued = true;
        haptic("light");
        return;
      }
      if (S.phase === "holding") {
        if (S.tiers.length < S.needThar) sendThar();
        else startReach();
      }
    }

    ctx.listen(elInfo, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      infoOpen = !infoOpen;
      haptic("light");
    });

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      if (ptr.down) return;
      ptr.down = true;
      ptr.id = e.pointerId;
      ptr.originX = e.clientX - (typeof e.offsetX === "number" ? e.offsetX : 0);
      ptr.originY = e.clientY - (typeof e.offsetY === "number" ? e.offsetY : 0);
      ptr.x = pressX(e); ptr.y = pressY(e);
      ptr.sx = ptr.x; ptr.sy = ptr.y;
      ptr.t0 = performance.now();
      ptr.drag = false;
      initAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (err) { /* blocked */ } }
    }, { passive: false });

    ctx.listen(window, "pointermove", (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      ptr.x = pressX(e);
      ptr.y = pressY(e);
      if (!ptr.drag && Math.abs(ptr.x - ptr.sx) + Math.abs(ptr.y - ptr.sy) > TAP_SLOP) {
        ptr.drag = true;
      }
    }, { passive: false });

    function endPointer(e) {
      if (!ptr.down || (e && e.pointerId !== ptr.id)) return;
      const wasTap = !ptr.drag && performance.now() - ptr.t0 < TAP_MS;
      ptr.down = false;
      ptr.drag = false;
      S.touching = false;
      if (wasTap) onTap();
    }
    ctx.listen(window, "pointerup", endPointer);
    ctx.listen(window, "pointercancel", endPointer);

    function resize() {
      W = ctx.width; H = ctx.height;
      camera.aspect = W / Math.max(1, H);
      camera.updateProjectionMatrix();
      renderer.setSize(W, H, false);
      layoutHud();
      fitCamera();
    }

    let lastW = 0, lastH = 0;
    ctx.onFrame((dtMs, timeMs) => {
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      const t = timeMs / 1000;
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width; lastH = ctx.height;
        resize();
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
      syncHud(t);
    });

    // ---------------------------------------------------------------- attract
    function setupTitle() {
      S.round = 1;
      S.needThar = 5;
      S.handiFt = handiFeetFor(5);
      S.tiers = [];
      while (S.tiers.length < 5) addTier();
      for (const row of S.tiers) for (const m of row) m.climb = 1;
      S.phase = "title";
      S.theta = 0.03;
      fitCamera();
      S.camDist = S.camTargetDist;
      S.camLook = S.camTargetLook;
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
    resize();
    setupTitle();
    render(0);
    syncHud(0);
    ctx.platform.ready();
  }
};
