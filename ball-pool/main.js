/**
 * Ball Pool — eight-ball on a phone.
 *
 * A full rack of 8-ball against a bot, or pass-and-play for two. The table is
 * modelled in inches (44 x 88 playing surface, 2.25" balls) so every constant
 * below is a real quantity and the physics tunes itself in units that mean
 * something: rolling deceleration in in/s², cushion restitution, pocket mouths
 * that are actually 5" across.
 *
 * The simulation is written in-file. No 2D rigid-body library in the Plethora
 * registry helps here — billiards is equal-mass circle-on-circle with rolling
 * friction and segmented cushions, which is thirty lines of impulse maths and a
 * lot of tuning, and the tuning is the whole game. Substepping is adaptive:
 * each frame picks a step count so no ball moves more than a third of its
 * radius, which is what stops a 430 in/s break ball tunnelling through the rack.
 *
 * Cushions stop short of the pockets and each cushion end carries a small round
 * "jaw" bumper, so a ball running the rail near a pocket clips the jaw and
 * rattles the way it does on a real table instead of being swallowed or
 * bouncing off an imaginary wall across the mouth.
 *
 * Spin is the honest simplification: a scalar top/back component that only
 * starts pushing once the cue ball has touched an object ball (so a shot does
 * not accelerate on its way down the table), and a scalar side component that
 * kicks the tangent on cushion contact. That reproduces draw, follow, stun and
 * a widened cushion angle, which is all a player actually reads.
 *
 * Sound is synthesised per impact — the clack pitch and brightness ride the
 * closing speed, so the break sounds like a break and a soft safety sounds like
 * a nudge.
 *
 * Three bot difficulties, five global leaderboards.
 */
window.plethoraBit = {
  meta: {
    title: "Ball Pool",
    runtime: "plethora-bit@2",
    tags: ["pool", "billiards", "8-ball", "game", "sports", "physics"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ====================================================================== //
    // Small helpers                                                          //
    // ====================================================================== //
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;

    /** Box–Muller, so aim error is gaussian rather than uniformly wrong. */
    function gauss(sigma) {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v) * sigma;
    }

    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      ));
    }

    const haptic = (kind) => {
      if (!ctx.capabilities.haptics) return;
      try { ctx.platform.haptic(kind); } catch (_) {}
    };

    // ====================================================================== //
    // Table geometry (inches)                                                //
    // ====================================================================== //
    // World space is the playing surface: x across (0..44), y down the table
    // (0..88). y = 0 is the foot rail, where the rack sits; y = 88 is the head
    // rail, where the player breaks from. Everything else derives from these.

    const PLAY_W = 44;
    const PLAY_H = 88;
    const RAIL = 4.7;                   // wood + cushion width drawn outside the surface
    const TOT_W = PLAY_W + RAIL * 2;
    const TOT_H = PLAY_H + RAIL * 2;

    const BALL_R = 1.125;
    const BALL_D = BALL_R * 2;

    const FOOT_Y = PLAY_H * 0.25;       // apex of the rack
    const HEAD_Y = PLAY_H * 0.75;       // head string; the kitchen is below it

    const JAW_C = 2.9;                  // corner pocket mouth, measured along the rail
    const JAW_S = 2.45;                 // side pocket mouth

    const POCKETS = [
      { x: 0, y: 0, r: 3.15 },
      { x: PLAY_W, y: 0, r: 3.15 },
      { x: 0, y: PLAY_H, r: 3.15 },
      { x: PLAY_W, y: PLAY_H, r: 3.15 },
      { x: 0, y: PLAY_H / 2, r: 2.95 },
      { x: PLAY_W, y: PLAY_H / 2, r: 2.95 }
    ];

    // Cushion runs, broken at every pocket mouth. `axis` names the constant
    // coordinate, `dir` points into the table, `a`..`b` is the span.
    const CUSHIONS = [
      { axis: "x", at: 0, dir: 1, a: JAW_C, b: PLAY_H / 2 - JAW_S },
      { axis: "x", at: 0, dir: 1, a: PLAY_H / 2 + JAW_S, b: PLAY_H - JAW_C },
      { axis: "x", at: PLAY_W, dir: -1, a: JAW_C, b: PLAY_H / 2 - JAW_S },
      { axis: "x", at: PLAY_W, dir: -1, a: PLAY_H / 2 + JAW_S, b: PLAY_H - JAW_C },
      { axis: "y", at: 0, dir: 1, a: JAW_C, b: PLAY_W - JAW_C },
      { axis: "y", at: PLAY_H, dir: -1, a: JAW_C, b: PLAY_W - JAW_C }
    ];

    // The rounded tip at each end of every cushion run.
    const JAW_R = 0.44;
    const JAWS = [];
    for (const c of CUSHIONS) {
      if (c.axis === "x") {
        JAWS.push({ x: c.at, y: c.a });
        JAWS.push({ x: c.at, y: c.b });
      } else {
        JAWS.push({ x: c.a, y: c.at });
        JAWS.push({ x: c.b, y: c.at });
      }
    }

    // ====================================================================== //
    // Physics constants                                                      //
    // ====================================================================== //
    // A ball rolling on clean cloth loses about 45 in/s² — a firm shot at
    // 100 in/s runs roughly a table length and dies in two seconds, which is
    // what these numbers reproduce.

    const DECEL = 44;                   // in/s², constant rolling drag
    const DECEL_Q = 0.055;              // extra drag proportional to speed
    const STOP_EPS = 1.4;               // in/s below which a ball is parked
    const REST_BALL = 0.945;
    const REST_CUSH = 0.76;
    const REST_JAW = 0.58;
    const CUSH_TANG = 0.965;            // tangential loss on cushion contact
    const SPIN_ACCEL = 104;             // in/s² along the shot axis, post-contact
    const SPIN_DECAY = 2.5;             // per second
    const SIDE_KICK = 0.30;             // tangential kick per unit side spin
    const MIN_SPEED = 42;
    const MAX_SPEED = 430;
    const MAX_SHOT_MS = 9000;           // hard ceiling so a turn never drags
    const CALM_MS = 5800;               // start bleeding energy after this

    const BALL_COLORS = {
      1: "#f0bd28", 2: "#1c48b8", 3: "#cc3427", 4: "#66348f",
      5: "#e2712a", 6: "#1a7548", 7: "#84301f", 8: "#15171c"
    };
    const CUE_COLOR = "#f5f1e4";

    const DIFFS = {
      easy: {
        name: "Easy", icon: "🙂", channel: "easy_shots",
        blurb: "Loose aim, shaky pace. Good for learning the table.",
        sigma: 0.058, powerJit: 0.22, topN: 6, safety: false, think: 950
      },
      medium: {
        name: "Medium", icon: "😐", channel: "medium_shots",
        blurb: "Takes the shots it sees. Punishes a bad leave.",
        sigma: 0.023, powerJit: 0.12, topN: 3, safety: true, think: 800
      },
      hard: {
        name: "Hard", icon: "😤", channel: "hard_shots",
        blurb: "Picks the best angle every time and plays safe when stuck.",
        sigma: 0.0072, powerJit: 0.05, topN: 1, safety: true, think: 650
      }
    };
    const DIFF_ORDER = ["easy", "medium", "hard"];

    // ====================================================================== //
    // State                                                                  //
    // ====================================================================== //
    const state = {
      screen: "menu",                   // menu | play | over
      mode: "solo",                     // solo | pass
      diff: "medium",
      phase: "aim",                     // aim | shooting | ballinhand | botwait
      turn: 0,                          // 0 = you / P1, 1 = bot / P2
      open: true,
      group: [null, null],              // "solids" | "stripes"
      balls: [],
      cue: null,
      aim: -Math.PI / 2,
      power: 0,
      spinX: 0,
      spinY: 0,
      shots: [0, 0],
      run: 0,
      bestRun: 0,
      isBreak: true,
      winner: null,
      overWhy: "",
      shotMs: 0,
      msg: "",
      msgUntil: 0,
      streak: 0,
      lifetimeWins: 0,
      lastSubmit: ""
    };

    const shot = {
      firstHit: null,
      potted: [],
      railAfter: false,
      contacted: false,
      cueScratched: false,
      openBefore: true,
      groupBefore: null,
      clearedBefore: false,
      isBreak: false
    };

    const view = { ox: 0, oy: 0, s: 1, rot: 0, hudH: 58, ctlH: 104 };

    // ====================================================================== //
    // Audio — every impact is synthesised from the collision that caused it   //
    // ====================================================================== //
    let ac = null, master = null, noiseBuf = null, audioDead = false;
    let rollSrc = null, rollGain = null, rollFilter = null;
    let voices = 0;
    let musicHandle = null;
    let soundOn = true;

    function buildAudio() {
      if (ac || audioDead || !ctx.capabilities.audio) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }

      master = ac.createGain();
      master.gain.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.attack.value = 0.002;
      comp.release.value = 0.2;
      master.connect(comp);
      comp.connect(ac.destination);

      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.5), ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      // A permanent bed of filtered noise whose gain tracks total kinetic
      // energy — the sound of balls rolling on cloth.
      rollFilter = ac.createBiquadFilter();
      rollFilter.type = "bandpass";
      rollFilter.frequency.value = 380;
      rollFilter.Q.value = 0.8;
      rollGain = ac.createGain();
      rollGain.gain.value = 0;
      rollSrc = ac.createBufferSource();
      rollSrc.buffer = noiseBuf;
      rollSrc.loop = true;
      rollSrc.connect(rollFilter);
      rollFilter.connect(rollGain);
      rollGain.connect(master);
      try { rollSrc.start(0); } catch (_) {}

      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
    }

    let resuming = false;
    function unlockAudio() {
      if (!buildAudio()) return;
      if (ac.state !== "running" && !resuming) {
        resuming = true;
        let p;
        try { p = ac.resume(); } catch (_) { resuming = false; return; }
        if (p && p.then) p.then(() => { resuming = false; }, () => { resuming = false; });
        else resuming = false;
      }
    }

    const audioLive = () => soundOn && ac && ac.state === "running" && voices < 26;

    /** Stereo position from a world x, so the far rail sounds off to the side. */
    function panFor(x) {
      if (!ac.createStereoPanner) return null;
      const p = ac.createStereoPanner();
      p.pan.value = clamp((x / PLAY_W - 0.5) * 1.3, -1, 1);
      return p;
    }

    function sink(x) {
      const p = panFor(x);
      if (p) { p.connect(master); return p; }
      return master;
    }

    function env(g, t, peak, attack, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    function trackVoice(node, t, dur) {
      voices++;
      node.onended = () => { voices--; };
      try { node.stop(t + dur); } catch (_) {}
    }

    /**
     * Two phenolic spheres meeting. Real balls ring around 2–6 kHz with a
     * decay under 50 ms; the harder the hit the brighter and louder, and a
     * little pitch scatter keeps a fifteen-ball break from sounding like one
     * sample fired fifteen times.
     */
    function sndClack(speed, x) {
      if (!audioLive()) return;
      const v = clamp(speed / 190, 0.03, 1);
      const t = ac.currentTime;
      const out = sink(x);
      const jitter = rnd(0.9, 1.12);
      const parts = [2050, 3350, 5100];
      const amps = [1, 0.5, 0.24];
      for (let i = 0; i < parts.length; i++) {
        const o = ac.createOscillator();
        o.type = "triangle";
        o.frequency.value = parts[i] * jitter * (0.86 + v * 0.24);
        const g = ac.createGain();
        const dur = (0.028 + v * 0.022) * (1 - i * 0.22);
        env(g, t, 0.30 * v * amps[i], 0.0008, dur);
        o.connect(g); g.connect(out);
        o.start(t);
        trackVoice(o, t, dur + 0.02);
      }
      // contact transient
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 4200 * jitter;
      bp.Q.value = 1.1;
      const g2 = ac.createGain();
      env(g2, t, 0.22 * v, 0.0005, 0.012);
      src.connect(bp); bp.connect(g2); g2.connect(out);
      src.start(t);
      trackVoice(src, t, 0.03);
    }

    /** Cushion: rubber under cloth. Low, damped, no ring. */
    function sndCushion(speed, x) {
      if (!audioLive()) return;
      const v = clamp(speed / 170, 0.03, 1);
      const t = ac.currentTime;
      const out = sink(x);
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(1100, t);
      lp.frequency.exponentialRampToValueAtTime(280, t + 0.09);
      const g = ac.createGain();
      env(g, t, 0.20 * v, 0.001, 0.075);
      src.connect(lp); lp.connect(g); g.connect(out);
      src.start(t);
      trackVoice(src, t, 0.11);

      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(96, t + 0.07);
      const og = ac.createGain();
      env(og, t, 0.13 * v, 0.001, 0.07);
      o.connect(og); og.connect(out);
      o.start(t);
      trackVoice(o, t, 0.1);
    }

    /** Drop: the lip, then the fall, then the ball landing in the trough. */
    function sndPocket(x) {
      if (!audioLive()) return;
      const t = ac.currentTime;
      const out = sink(x);
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(260, t);
      o.frequency.exponentialRampToValueAtTime(72, t + 0.22);
      const g = ac.createGain();
      env(g, t, 0.3, 0.002, 0.24);
      o.connect(g); g.connect(out);
      o.start(t);
      trackVoice(o, t, 0.3);

      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 620;
      const g2 = ac.createGain();
      env(g2, t, 0.17, 0.003, 0.3);
      src.connect(lp); lp.connect(g2); g2.connect(out);
      src.start(t);
      trackVoice(src, t, 0.35);

      // two quick knocks as it settles against the other balls
      for (let i = 0; i < 2; i++) {
        const tk = t + 0.20 + i * 0.11 + rnd(0, 0.03);
        const k = ac.createOscillator();
        k.type = "triangle";
        k.frequency.value = rnd(1400, 2200);
        const kg = ac.createGain();
        env(kg, tk, 0.1, 0.001, 0.03);
        k.connect(kg); kg.connect(out);
        k.start(tk);
        trackVoice(k, tk, 0.05);
      }
    }

    /** Leather tip on phenolic — a tick with a soft body behind it. */
    function sndCue(power, x) {
      if (!audioLive()) return;
      const t = ac.currentTime;
      const out = sink(x);
      const v = clamp(0.3 + power * 0.7, 0.2, 1);
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1500 + power * 1400;
      bp.Q.value = 0.9;
      const g = ac.createGain();
      env(g, t, 0.3 * v, 0.0008, 0.035);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t);
      trackVoice(src, t, 0.06);

      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.05);
      const og = ac.createGain();
      env(og, t, 0.12 * v, 0.001, 0.05);
      o.connect(og); og.connect(out);
      o.start(t);
      trackVoice(o, t, 0.08);
    }

    /** A soft rack rumble to sell the break. */
    function sndRack() {
      if (!audioLive()) return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(180, t + 0.5);
      const g = ac.createGain();
      env(g, t, 0.2, 0.004, 0.5);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t);
      trackVoice(src, t, 0.6);
    }

    function updateRollBed(totalSpeed) {
      if (!ac || !rollGain) return;
      const target = soundOn ? clamp(totalSpeed / 900, 0, 1) * 0.07 : 0;
      try {
        rollGain.gain.setTargetAtTime(target, ac.currentTime, 0.06);
        rollFilter.frequency.setTargetAtTime(300 + clamp(totalSpeed, 0, 700) * 0.5,
          ac.currentTime, 0.08);
      } catch (_) {}
    }

    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic || !soundOn || musicHandle) return;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "lofi", volume: 0.26, fadeInMs: 1600, intensity: 0.32, density: 0.4
        });
      } catch (_) { musicHandle = null; }
    }
    function stopMusic() {
      if (!musicHandle) return;
      try { ctx.music.stop({ fadeOutMs: 700 }); } catch (_) {}
      musicHandle = null;
    }
    function sting(name) {
      if (!soundOn || !ctx.capabilities.backgroundMusic) return;
      try { const p = ctx.music.sting(name); if (p && p.catch) p.catch(() => {}); } catch (_) {}
    }

    // ====================================================================== //
    // Balls and the rack                                                     //
    // ====================================================================== //
    function makeBall(n) {
      const kind = n === 0 ? "cue" : n === 8 ? "eight" : n < 8 ? "solid" : "stripe";
      return {
        n, kind,
        color: n === 0 ? CUE_COLOR : BALL_COLORS[n <= 8 ? n : n - 8],
        x: 0, y: 0, vx: 0, vy: 0,
        potted: false,
        spinT: 0, spinS: 0, spinDirX: 0, spinDirY: 0, spinArmed: false,
        roll: 0, ang: -Math.PI / 2,
        drop: 0, dropX: 0, dropY: 0
      };
    }

    /**
     * A legal 8-ball rack: apex on the foot spot, the 8 dead centre of the
     * third row, and the two back corners split between a solid and a stripe.
     * Everything else is shuffled, and each ball gets a few thousandths of an
     * inch of slop so no two breaks are identical.
     */
    function rack() {
      const balls = [makeBall(0)];
      const rest = [];
      for (let n = 1; n <= 15; n++) if (n !== 8) rest.push(n);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
      }
      const solids = rest.filter((n) => n < 8);
      const stripes = rest.filter((n) => n > 8);
      const cornerA = solids.pop();
      const cornerB = stripes.pop();
      const pool = solids.concat(stripes);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }

      const gap = BALL_D * Math.sin(Math.PI / 3);
      const cx = PLAY_W / 2;
      const slots = [];
      for (let row = 0; row < 5; row++) {
        for (let i = 0; i <= row; i++) {
          slots.push({
            row, i,
            x: cx + (i - row / 2) * (BALL_D + 0.01),
            y: FOOT_Y - row * gap
          });
        }
      }

      let pi = 0;
      for (const s of slots) {
        let n;
        if (s.row === 2 && s.i === 1) n = 8;
        else if (s.row === 4 && s.i === 0) n = cornerA;
        else if (s.row === 4 && s.i === 4) n = cornerB;
        else n = pool[pi++];
        const b = makeBall(n);
        b.x = s.x + rnd(-0.005, 0.005);
        b.y = s.y + rnd(-0.005, 0.005);
        b.roll = rnd(0, TAU);
        b.ang = rnd(0, TAU);
        balls.push(b);
      }

      const cue = balls[0];
      cue.x = cx + rnd(-1.6, 1.6);
      cue.y = PLAY_H * 0.80;
      state.balls = balls;
      state.cue = cue;
    }

    const active = () => state.balls.filter((b) => !b.potted);
    const inGroup = (n, g) => (g === "solids" ? n >= 1 && n <= 7 : n >= 9 && n <= 15);

    function groupCleared(p) {
      const g = state.group[p];
      if (!g) return false;
      return !state.balls.some((b) => !b.potted && inGroup(b.n, g));
    }
    function groupLeft(p) {
      const g = state.group[p];
      if (!g) return state.balls.filter((b) => !b.potted && b.n !== 0 && b.n !== 8).length;
      return state.balls.filter((b) => !b.potted && inGroup(b.n, g)).length;
    }

    /** Balls this player may legally strike first, given the pre-shot table. */
    function legalTargets(p, pre) {
      const open = pre ? shot.openBefore : state.open;
      const g = pre ? shot.groupBefore : state.group[p];
      const cleared = pre ? shot.clearedBefore : groupCleared(p);
      const list = active().filter((b) => b.n !== 0);
      if (open) return list.filter((b) => b.n !== 8);
      if (cleared) return list.filter((b) => b.n === 8);
      return list.filter((b) => b.n !== 8 && inGroup(b.n, g));
    }

    // ====================================================================== //
    // Physics                                                                //
    // ====================================================================== //
    function pocketAt(b) {
      for (let i = 0; i < POCKETS.length; i++) {
        const p = POCKETS[i];
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) return p;
      }
      // Failsafe: the only way past a rail line is through a mouth, so anything
      // that gets out there belongs to the nearest pocket.
      if (b.x < -0.35 || b.x > PLAY_W + 0.35 || b.y < -0.35 || b.y > PLAY_H + 0.35) {
        let best = POCKETS[0], bd = Infinity;
        for (const p of POCKETS) {
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          if (d < bd) { bd = d; best = p; }
        }
        return best;
      }
      return null;
    }

    function pocketBall(b, p) {
      b.potted = true;
      b.vx = 0; b.vy = 0;
      b.spinT = 0; b.spinS = 0;
      b.drop = 1;
      b.dropX = p.x; b.dropY = p.y;
      sndPocket(p.x);
      if (b.n === 0) shot.cueScratched = true;
      else shot.potted.push(b);
      haptic(b.n === 0 ? "warning" : "medium");
    }

    function substep(h) {
      const balls = state.balls;

      for (const b of balls) {
        if (b.potted) continue;
        b.x += b.vx * h;
        b.y += b.vy * h;
      }

      // ball on ball
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.potted) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.potted) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= BALL_D * BALL_D || d2 < 1e-9) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const push = (BALL_D - d) * 0.5;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;

          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn >= 0) continue;
          const jimp = -(1 + REST_BALL) * vn * 0.5;
          a.vx -= jimp * nx; a.vy -= jimp * ny;
          b.vx += jimp * nx; b.vy += jimp * ny;

          sndClack(-vn, (a.x + b.x) * 0.5);

          // The cue ball's stored spin only starts acting once it has actually
          // hit something — before that a follow shot would accelerate down
          // the table, which is not a thing that happens.
          const cue = state.cue;
          if (a === cue || b === cue) {
            cue.spinArmed = true;
            if (!shot.firstHit) {
              shot.firstHit = a === cue ? b : a;
              shot.contacted = true;
            }
          }
        }
      }

      // cushions
      for (const b of balls) {
        if (b.potted) continue;
        for (const c of CUSHIONS) {
          const along = c.axis === "x" ? b.y : b.x;
          if (along < c.a || along > c.b) continue;
          const pos = c.axis === "x" ? b.x : b.y;
          const d = (pos - c.at) * c.dir;
          if (d >= BALL_R) continue;
          if (c.axis === "x") b.x = c.at + c.dir * BALL_R;
          else b.y = c.at + c.dir * BALL_R;

          const nx = c.axis === "x" ? c.dir : 0;
          const ny = c.axis === "y" ? c.dir : 0;
          const vn = b.vx * nx + b.vy * ny;
          if (vn >= 0) continue;

          const tx = -ny, ty = nx;
          let vt = b.vx * tx + b.vy * ty;
          const vnOut = -vn * REST_CUSH;
          vt = vt * CUSH_TANG + b.spinS * Math.abs(vn) * SIDE_KICK;
          b.vx = nx * vnOut + tx * vt;
          b.vy = ny * vnOut + ty * vt;
          b.spinS *= 0.5;
          b.spinT *= 0.35;

          sndCushion(-vn, b.x);
          if (shot.contacted) shot.railAfter = true;
        }

        // pocket jaws
        for (const jw of JAWS) {
          const dx = b.x - jw.x, dy = b.y - jw.y;
          const rr = BALL_R + JAW_R;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 < 1e-9) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          b.x = jw.x + nx * rr;
          b.y = jw.y + ny * rr;
          const vn = b.vx * nx + b.vy * ny;
          if (vn >= 0) continue;
          b.vx -= (1 + REST_JAW) * vn * nx;
          b.vy -= (1 + REST_JAW) * vn * ny;
          sndCushion(-vn * 0.7, b.x);
          if (shot.contacted) shot.railAfter = true;
        }
      }

      // pockets
      for (const b of balls) {
        if (b.potted) continue;
        const p = pocketAt(b);
        if (p) pocketBall(b, p);
      }

      // spin, friction, roll bookkeeping
      for (const b of balls) {
        if (b.potted) continue;

        if (b.spinArmed && Math.abs(b.spinT) > 0.004) {
          b.vx += b.spinDirX * b.spinT * SPIN_ACCEL * h;
          b.vy += b.spinDirY * b.spinT * SPIN_ACCEL * h;
        }
        if (b.spinT) b.spinT *= Math.exp(-SPIN_DECAY * h);
        if (b.spinS) b.spinS *= Math.exp(-SPIN_DECAY * 0.55 * h);

        const sp = Math.hypot(b.vx, b.vy);
        if (sp <= 0) continue;
        const ns = Math.max(0, sp - (DECEL + DECEL_Q * sp) * h);
        if (ns < STOP_EPS) {
          b.vx = 0; b.vy = 0;
          b.spinT = 0; b.spinS = 0;
        } else {
          const k = ns / sp;
          b.vx *= k; b.vy *= k;
          b.ang = Math.atan2(b.vy, b.vx);
          b.roll += (ns * h) / BALL_R;
        }
      }
    }

    /**
     * Adaptive substepping. The step count is chosen so the fastest ball moves
     * less than a third of its radius per step; below that, a break ball will
     * happily pass straight through the rack.
     */
    function stepPhysics(dtMs) {
      const dt = Math.min(dtMs, 34) / 1000;
      let maxV = 0;
      for (const b of state.balls) {
        if (b.potted) continue;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > maxV) maxV = sp;
      }
      if (maxV <= 0) return;
      const steps = clamp(Math.ceil((maxV * dt) / (BALL_R * 0.33)), 1, 48);
      const h = dt / steps;
      for (let i = 0; i < steps; i++) substep(h);
    }

    function ballsMoving() {
      for (const b of state.balls) {
        if (!b.potted && (b.vx !== 0 || b.vy !== 0)) return true;
      }
      return false;
    }
    function totalSpeed() {
      let s = 0;
      for (const b of state.balls) if (!b.potted) s += Math.hypot(b.vx, b.vy);
      return s;
    }

    // ====================================================================== //
    // Shot prediction (the aiming line)                                      //
    // ====================================================================== //
    /** Distance along a ray before the ball centre reaches the cushion box. */
    function rayToRail(x, y, dx, dy) {
      let t = Infinity;
      const lo = BALL_R, hiX = PLAY_W - BALL_R, hiY = PLAY_H - BALL_R;
      if (dx > 1e-9) t = Math.min(t, (hiX - x) / dx);
      else if (dx < -1e-9) t = Math.min(t, (lo - x) / dx);
      if (dy > 1e-9) t = Math.min(t, (hiY - y) / dy);
      else if (dy < -1e-9) t = Math.min(t, (lo - y) / dy);
      return Math.max(0, t === Infinity ? 200 : t);
    }

    function predict(x, y, ang, skip) {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let bestT = Infinity, hit = null;
      for (const b of state.balls) {
        if (b.potted || b === state.cue || b === skip) continue;
        const ex = b.x - x, ey = b.y - y;
        const proj = ex * dx + ey * dy;
        if (proj <= 0) continue;
        const perp2 = ex * ex + ey * ey - proj * proj;
        if (perp2 >= BALL_D * BALL_D) continue;
        const t = proj - Math.sqrt(BALL_D * BALL_D - perp2);
        if (t >= 0 && t < bestT) { bestT = t; hit = b; }
      }
      const tRail = rayToRail(x, y, dx, dy);
      if (!hit || tRail < bestT) {
        return { t: tRail, ball: null, x: x + dx * tRail, y: y + dy * tRail };
      }
      return { t: bestT, ball: hit, x: x + dx * bestT, y: y + dy * bestT };
    }

    /** True if any other ball blocks a straight path of clearance BALL_D. */
    function pathBlocked(ax, ay, bx, by, ignore) {
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return false;
      const ux = dx / len, uy = dy / len;
      for (const b of state.balls) {
        if (b.potted || ignore.indexOf(b) >= 0) continue;
        const ex = b.x - ax, ey = b.y - ay;
        const proj = ex * ux + ey * uy;
        if (proj < -BALL_R || proj > len + BALL_R) continue;
        const cp = clamp(proj, 0, len);
        const px = ax + ux * cp - b.x, py = ay + uy * cp - b.y;
        if (px * px + py * py < (BALL_D - 0.03) * (BALL_D - 0.03)) return true;
      }
      return false;
    }

    // ====================================================================== //
    // Taking a shot                                                          //
    // ====================================================================== //
    function beginShot() {
      shot.firstHit = null;
      shot.potted = [];
      shot.railAfter = false;
      shot.contacted = false;
      shot.cueScratched = false;
      shot.openBefore = state.open;
      shot.groupBefore = state.group[state.turn];
      shot.clearedBefore = groupCleared(state.turn);
      shot.isBreak = state.isBreak;
      state.shotMs = 0;
    }

    function fire(power, ang, spinX, spinY) {
      const cue = state.cue;
      if (!cue || cue.potted) return;
      beginShot();
      state.shots[state.turn]++;
      unlockAudio();

      const speed = MIN_SPEED + Math.pow(clamp(power, 0, 1), 1.35) * (MAX_SPEED - MIN_SPEED);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      cue.vx = dx * speed;
      cue.vy = dy * speed;
      cue.spinDirX = dx;
      cue.spinDirY = dy;
      cue.spinT = -spinY * 0.85;          // widget y is screen-down: up = follow
      cue.spinS = spinX * 0.9;
      cue.spinArmed = false;
      cue.ang = ang;

      sndCue(power, cue.x);
      if (shot.isBreak) {
        sndRack();
        try { ctx.music.duck(0.45, 1100); } catch (_) {}
      }
      haptic(power > 0.7 ? "heavy" : power > 0.35 ? "medium" : "light");
      state.phase = "shooting";
      ctx.platform.interact({ type: "shot", power: Math.round(power * 100) });
      hideCue();
    }

    function message(text, ms) {
      state.msg = text;
      state.msgUntil = performance.now() + (ms || 2200);
      toastEl.textContent = text;
      toastEl.style.opacity = "1";
    }

    // ====================================================================== //
    // Rules                                                                  //
    // ====================================================================== //
    function legalFirstHitPre(p, ball) {
      if (!ball) return false;
      if (shot.openBefore) return ball.n !== 8;
      if (shot.clearedBefore) return ball.n === 8;
      return ball.n !== 8 && inGroup(ball.n, shot.groupBefore);
    }

    function nameOf(p) {
      if (state.mode === "pass") return p === 0 ? "Player 1" : "Player 2";
      return p === 0 ? "You" : "Bot";
    }

    function resolveShot() {
      const p = state.turn;
      const opp = 1 - p;
      const potted = shot.potted;
      const eight = potted.some((b) => b.n === 8);

      let foul = false, why = "";
      if (shot.cueScratched) { foul = true; why = "Scratch"; }
      else if (!shot.firstHit) { foul = true; why = "No ball hit"; }
      else if (!legalFirstHitPre(p, shot.firstHit)) {
        foul = true;
        why = shot.firstHit.n === 8 ? "Hit the 8 first" : "Wrong ball first";
      } else if (!potted.length && !shot.railAfter) { foul = true; why = "No rail after contact"; }

      if (shot.isBreak) {
        if (eight) { message("8 on the break — re-rack", 2600); resetRack(p); return; }
        // A break is judged gently: only a scratch or a total miss is a foul.
        if (shot.firstHit && !shot.cueScratched) { foul = false; why = ""; }
        state.isBreak = false;
      }

      if (eight) {
        const won = shot.clearedBefore && !foul;
        endGame(won ? p : opp, won ? "Cleared the table" :
          (shot.cueScratched ? "Scratched on the 8" : "8-ball too early"));
        return;
      }

      // group assignment — the table stays open through the break itself
      if (state.open && !foul && !shot.isBreak) {
        const first = potted.find((b) => b.n !== 8);
        if (first) {
          const g = first.n < 8 ? "solids" : "stripes";
          state.group[p] = g;
          state.group[opp] = g === "solids" ? "stripes" : "solids";
          state.open = false;
          message(nameOf(p) + ": " + g, 2400);
        }
      }

      let madeOwn = false;
      if (!foul) {
        if (state.open) madeOwn = potted.some((b) => b.n !== 8);
        else madeOwn = potted.some((b) => b.n !== 8 && inGroup(b.n, state.group[p]));
      }

      if (shot.cueScratched) {
        // Lift it out of the pocket and park it somewhere legal, so the
        // incoming player sees a cue ball on the cloth rather than in the bag.
        state.cue.potted = false;
        state.cue.drop = 0;
        state.cue.vx = 0; state.cue.vy = 0;
        const home = snapCue(PLAY_W / 2, state.isBreak ? PLAY_H * 0.8 : PLAY_H * 0.62);
        state.cue.x = home ? home.x : PLAY_W / 2;
        state.cue.y = home ? home.y : PLAY_H * 0.8;
      }

      if (foul) {
        if (!state.msg || performance.now() > state.msgUntil - 400) {
          message(why + " — " + nameOf(opp) + " has ball in hand", 2600);
        }
        sting("fail");
        state.run = 0;
        state.turn = opp;
        startTurn(true);
      } else if (madeOwn) {
        const own = potted.filter((b) => b.n !== 8 &&
          (state.open ? true : inGroup(b.n, state.group[p]))).length;
        state.run += own;
        if (p === 0 && state.run > state.bestRun) state.bestRun = state.run;
        if (own > 0) sting("coin");
        if (state.run >= 3 && p === 0) ctx.platform.milestone("run_" + state.run);
        startTurn(false);
      } else {
        state.run = 0;
        state.turn = opp;
        startTurn(false);
      }
    }

    /** Set up whoever is at the table now, with or without ball in hand. */
    function startTurn(ballInHand) {
      if (state.screen !== "play") return;
      syncHud();
      const p = state.turn;
      const bot = state.mode === "solo" && p === 1;

      if (ballInHand) {
        if (bot) {
          botPlaceCue();
          state.phase = "botwait";
          ctx.timeout(() => botShoot(), DIFFS[state.diff].think);
          return;
        }
        state.phase = "ballinhand";
        message("Ball in hand — drag the cue ball", 2600);
        syncControls();
        return;
      }

      if (bot) {
        state.phase = "botwait";
        ctx.timeout(() => botShoot(), DIFFS[state.diff].think);
        return;
      }

      state.phase = "aim";
      aimAtSomething();
      syncControls();
    }

    /** Point the cue somewhere sensible so a new turn never starts aimed at felt. */
    function aimAtSomething() {
      const targets = legalTargets(state.turn, false);
      const cue = state.cue;
      if (!targets.length || !cue) return;
      let best = null, bd = Infinity;
      for (const b of targets) {
        const d = Math.hypot(b.x - cue.x, b.y - cue.y);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) state.aim = Math.atan2(best.y - cue.y, best.x - cue.x);
    }

    function resetRack(breaker) {
      rack();
      state.open = true;
      state.group = [null, null];
      state.isBreak = true;
      state.run = 0;
      state.turn = breaker == null ? 0 : breaker;
      state.phase = "ballinhand";
      if (state.mode === "solo" && state.turn === 1) {
        botPlaceCue();
        state.phase = "botwait";
        ctx.timeout(() => botShoot(), DIFFS[state.diff].think);
      } else {
        message("Place the cue ball and break", 2600);
      }
      syncHud();
      syncControls();
    }

    // ====================================================================== //
    // Bot                                                                    //
    // ====================================================================== //
    /**
     * Enumerate every ball-to-pocket pair, keep the ones that are geometrically
     * on and unobstructed, and score them by cut angle and distance. The
     * difficulty knobs then decide how well the bot executes what it found and
     * how often it settles for a worse option.
     */
    function findShots(fromX, fromY) {
      const out = [];
      const targets = legalTargets(state.turn, false);
      const cue = state.cue;
      for (const b of targets) {
        for (const p of POCKETS) {
          const pdx = p.x - b.x, pdy = p.y - b.y;
          const pd = Math.hypot(pdx, pdy);
          if (pd < 0.5) continue;
          const ux = pdx / pd, uy = pdy / pd;
          const gx = b.x - ux * BALL_D, gy = b.y - uy * BALL_D;
          if (gx < -1 || gx > PLAY_W + 1 || gy < -1 || gy > PLAY_H + 1) continue;

          const cdx = gx - fromX, cdy = gy - fromY;
          const cd = Math.hypot(cdx, cdy);
          if (cd < BALL_D * 0.6) continue;
          const cutCos = (cdx / cd) * ux + (cdy / cd) * uy;
          if (cutCos < 0.22) continue;                    // beyond about a 77° cut

          if (pathBlocked(fromX, fromY, gx, gy, [cue, b])) continue;
          if (pathBlocked(b.x, b.y, p.x, p.y, [b])) continue;

          const score = Math.pow(cutCos, 2.1) *
            (1 / (1 + cd / 70)) * (1 / (1 + pd / 55)) *
            (b.n === 8 ? 1.15 : 1);
          out.push({ ball: b, pocket: p, gx, gy, cd, pd, cutCos, score });
        }
      }
      out.sort((a, b) => b.score - a.score);
      return out;
    }

    function botPlaceCue() {
      const cue = state.cue;
      cue.potted = false;
      cue.drop = 0;
      cue.vx = 0; cue.vy = 0;

      const d = DIFFS[state.diff];
      const targets = legalTargets(state.turn, false);
      const cands = [];

      // Straight-on positions behind each ball, at a comfortable cueing distance.
      for (const b of targets) {
        for (const p of POCKETS) {
          const pdx = p.x - b.x, pdy = p.y - b.y;
          const pd = Math.hypot(pdx, pdy);
          if (pd < 0.5) continue;
          const ux = pdx / pd, uy = pdy / pd;
          for (const back of [16, 26, 38]) {
            const cx = b.x - ux * back, cy = b.y - uy * back;
            if (!cuePlaceable(cx, cy, true)) continue;
            cands.push({ x: cx, y: cy });
          }
        }
      }
      // a coarse grid as a fallback
      for (let gx = 1; gx < 6; gx++) {
        for (let gy = 1; gy < 10; gy++) {
          const cx = (gx / 6) * PLAY_W, cy = (gy / 10) * PLAY_H;
          if (cuePlaceable(cx, cy, true)) cands.push({ x: cx, y: cy });
        }
      }
      if (!cands.length) {
        cue.x = PLAY_W / 2; cue.y = HEAD_Y;
        return;
      }

      let best = cands[0], bestScore = -1;
      const sample = cands.slice();
      // Easy does not search hard; it grabs something that merely works.
      const limit = state.diff === "easy" ? 14 : sample.length;
      for (let i = sample.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = sample[i]; sample[i] = sample[j]; sample[j] = t;
      }
      for (let i = 0; i < Math.min(limit, sample.length); i++) {
        const c = sample[i];
        const shots = findShots(c.x, c.y);
        const sc = shots.length ? shots[0].score : 0;
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
      cue.x = best.x;
      cue.y = best.y;
      if (state.isBreak) {
        cue.x = PLAY_W / 2 + rnd(-2.2, 2.2);
        cue.y = PLAY_H * 0.8;
      }
      if (d.sigma > 0.04) {
        cue.x = clamp(cue.x + rnd(-3, 3), BALL_R + 0.2, PLAY_W - BALL_R - 0.2);
        cue.y = clamp(cue.y + rnd(-3, 3), BALL_R + 0.2, PLAY_H - BALL_R - 0.2);
      }
    }

    function botShoot() {
      if (state.screen !== "play" || state.phase !== "botwait") return;
      const d = DIFFS[state.diff];
      const cue = state.cue;

      if (state.isBreak) {
        const ang = Math.atan2(FOOT_Y - cue.y, PLAY_W / 2 - cue.x) + gauss(0.012);
        fire(clamp(rnd(0.88, 1), 0, 1), ang, rnd(-0.1, 0.1), 0);
        return;
      }

      const shots = findShots(cue.x, cue.y);
      if (shots.length) {
        const pickFrom = Math.min(d.topN, shots.length);
        const pick = shots[Math.floor(Math.pow(Math.random(), 1.7) * pickFrom)];
        const ideal = Math.atan2(pick.gy - cue.y, pick.gx - cue.x);
        const ang = ideal + gauss(d.sigma);
        let power = 0.26 + (pick.cd + pick.pd) / 250 + (1 - pick.cutCos) * 0.34;
        power = clamp(power + rnd(-d.powerJit, d.powerJit), 0.18, 0.96);
        fire(power, ang, clamp(gauss(0.18), -0.7, 0.7), clamp(gauss(0.2), -0.7, 0.7));
        return;
      }

      // Nothing on. Roll up to the nearest legal ball and leave it there.
      const targets = legalTargets(state.turn, false);
      if (!targets.length) { fire(0.3, state.aim, 0, 0); return; }
      let near = targets[0], nd = Infinity;
      for (const b of targets) {
        const dist = Math.hypot(b.x - cue.x, b.y - cue.y);
        if (dist < nd) { nd = dist; near = b; }
      }
      const ang = Math.atan2(near.y - cue.y, near.x - cue.x) + gauss(d.sigma * 1.5);
      const power = d.safety
        ? clamp(0.14 + nd / 320, 0.12, 0.4)
        : clamp(rnd(0.3, 0.75), 0.15, 0.9);
      fire(power, ang, 0, 0);
    }

    // ====================================================================== //
    // Cue ball placement rules                                               //
    // ====================================================================== //
    function cuePlaceable(x, y, strict) {
      if (x < BALL_R + 0.15 || x > PLAY_W - BALL_R - 0.15) return false;
      if (y < BALL_R + 0.15 || y > PLAY_H - BALL_R - 0.15) return false;
      if (state.isBreak && y < HEAD_Y) return false;
      for (const p of POCKETS) if (Math.hypot(x - p.x, y - p.y) < p.r + 0.3) return false;
      const gap = strict ? BALL_D + 0.4 : BALL_D + 0.02;
      for (const b of state.balls) {
        if (b.potted || b === state.cue) continue;
        if (Math.hypot(x - b.x, y - b.y) < gap) return false;
      }
      return true;
    }

    /** Nudge an illegal drop to the closest legal spot rather than refusing it. */
    function snapCue(x, y) {
      if (cuePlaceable(x, y, false)) return { x, y };
      for (let r = 0.6; r <= 12; r += 0.6) {
        for (let a = 0; a < 16; a++) {
          const t = (a / 16) * TAU;
          const nx = x + Math.cos(t) * r, ny = y + Math.sin(t) * r;
          if (cuePlaceable(nx, ny, false)) return { x: nx, y: ny };
        }
      }
      return null;
    }

    // ====================================================================== //
    // Game start / end                                                       //
    // ====================================================================== //
    function newGame(mode, diff) {
      state.mode = mode;
      if (diff) state.diff = diff;
      state.screen = "play";
      state.winner = null;
      state.overWhy = "";
      state.shots = [0, 0];
      state.run = 0;
      state.bestRun = 0;
      state.spinX = 0; state.spinY = 0;
      state.power = 0;
      state.lastSubmit = "";
      resetRack(0);
      showScreen("play");
      unlockAudio();
      startMusic();
      ctx.platform.start({ mode, diff: state.diff });
      ctx.platform.setProgress(0);
    }

    function endGame(winner, why) {
      state.winner = winner;
      state.overWhy = why;
      state.screen = "over";
      state.phase = "aim";
      const youWon = state.mode === "pass" ? false : winner === 0;

      if (state.mode === "solo") {
        if (winner === 0) {
          state.streak++;
          state.lifetimeWins++;
          sting("win");
          haptic("success");
          ctx.platform.complete({ result: "win", diff: state.diff, shots: state.shots[0] });
        } else {
          state.streak = 0;
          sting("lose");
          haptic("error");
          ctx.platform.fail({ result: "loss", diff: state.diff });
        }
        saveProgress();
        submitScores(winner === 0);
      } else {
        sting("win");
        haptic("success");
        ctx.platform.complete({ result: "pass_play", winner });
      }
      showOver(youWon);
    }

    // ====================================================================== //
    // Storage and leaderboards                                               //
    // ====================================================================== //
    async function loadProgress() {
      if (!ctx.capabilities.storage) return;
      try {
        const s = await ctx.storage.get("ballpool");
        if (s && typeof s === "object") {
          state.streak = s.streak || 0;
          state.lifetimeWins = s.wins || 0;
          if (s.diff && DIFFS[s.diff]) state.diff = s.diff;
          if (typeof s.sound === "boolean") soundOn = s.sound;
        }
      } catch (_) {}
    }
    async function saveProgress() {
      if (!ctx.capabilities.storage) return;
      try {
        await ctx.storage.set("ballpool", {
          streak: state.streak, wins: state.lifetimeWins,
          diff: state.diff, sound: soundOn
        });
      } catch (_) {}
    }

    async function submitScores(won) {
      const notes = [];
      const tasks = [];
      if (won) {
        tasks.push(
          ctx.memory.record(DIFFS[state.diff].channel)
            .submit(state.shots[0], { label: state.shots[0] + " shots" })
            .then(() => notes.push(DIFFS[state.diff].name + " board"), () => {})
        );
        tasks.push(
          ctx.memory.record("win_streak")
            .submit(state.streak, { label: state.streak + " in a row" })
            .then(() => notes.push("streak board"), () => {})
        );
      }
      if (state.bestRun > 0) {
        tasks.push(
          ctx.memory.record("best_run")
            .submit(state.bestRun, { label: state.bestRun + " in a visit" })
            .then(() => notes.push("run board"), () => {})
        );
      }
      try { await Promise.all(tasks); } catch (_) {}
      const node = overBox.querySelector("#subnote");
      if (!node) return;
      node.textContent = notes.length
        ? "Sent to the " + notes.join(", ") + " 🏆"
        : (won ? "Couldn't reach the leaderboards." : "");
    }

    // ====================================================================== //
    // Layout                                                                 //
    // ====================================================================== //
    function layout() {
      const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      const W = ctx.width, H = ctx.height;
      view.rot = W > H * 1.05 ? 1 : 0;
      view.hudH = view.rot ? 46 : 58;
      view.ctlH = view.rot ? 80 : 104;

      const padX = 8;
      const availW = Math.max(40, W - sa.left - sa.right - padX * 2);
      const availH = Math.max(40, H - sa.top - sa.bottom - view.hudH - view.ctlH - 8);
      const tw = view.rot ? TOT_H : TOT_W;
      const th = view.rot ? TOT_W : TOT_H;
      const s = Math.min(availW / tw, availH / th);
      view.s = s;
      const bx = sa.left + padX + (availW - tw * s) / 2;
      const by = sa.top + view.hudH + (availH - th * s) / 2;
      view.ox = bx + RAIL * s;
      view.oy = by + RAIL * s;

      hud.style.top = sa.top + "px";
      hud.style.left = sa.left + 8 + "px";
      hud.style.right = sa.right + 8 + "px";
      hud.style.height = view.hudH + "px";

      ctl.style.bottom = sa.bottom + 6 + "px";
      ctl.style.left = sa.left + 10 + "px";
      ctl.style.right = sa.right + 10 + "px";
      ctl.style.height = view.ctlH - 8 + "px";

      toastEl.style.top = sa.top + view.hudH + 6 + "px";
    }

    function w2s(x, y) {
      if (view.rot) return { x: view.ox + (PLAY_H - y) * view.s, y: view.oy + x * view.s };
      return { x: view.ox + x * view.s, y: view.oy + y * view.s };
    }
    function s2w(sx, sy) {
      if (view.rot) return { x: (sy - view.oy) / view.s, y: PLAY_H - (sx - view.ox) / view.s };
      return { x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s };
    }
    function applyWorld(g) {
      g.save();
      if (view.rot) {
        g.translate(view.ox + PLAY_H * view.s, view.oy);
        g.rotate(Math.PI / 2);
      } else {
        g.translate(view.ox, view.oy);
      }
      g.scale(view.s, view.s);
    }
    /** Draw at world position but in screen pixels, upright in both rotations. */
    function screenSpace(g, wx, wy, fn) {
      g.save();
      g.translate(wx, wy);
      g.scale(1 / view.s, 1 / view.s);
      if (view.rot) g.rotate(-Math.PI / 2);
      fn();
      g.restore();
    }

    // ====================================================================== //
    // Rendering                                                              //
    // ====================================================================== //
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    function drawTable() {
      // wood
      const woodGrad = g.createLinearGradient(-RAIL, -RAIL, PLAY_W + RAIL, PLAY_H + RAIL);
      woodGrad.addColorStop(0, "#5a3722");
      woodGrad.addColorStop(0.45, "#7a4c2e");
      woodGrad.addColorStop(1, "#4a2c1a");
      g.fillStyle = woodGrad;
      roundRect(g, -RAIL, -RAIL, PLAY_W + RAIL * 2, PLAY_H + RAIL * 2, 3.2);
      g.fill();

      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 0.35;
      roundRect(g, -RAIL, -RAIL, PLAY_W + RAIL * 2, PLAY_H + RAIL * 2, 3.2);
      g.stroke();

      // cushion faces, a shade darker than the bed
      g.fillStyle = "#125f38";
      for (const c of CUSHIONS) {
        const t = 2.0;
        if (c.axis === "x") {
          const x = c.dir > 0 ? c.at - t : c.at;
          g.fillRect(x, c.a, t, c.b - c.a);
        } else {
          const y = c.dir > 0 ? c.at - t : c.at;
          g.fillRect(c.a, y, c.b - c.a, t);
        }
      }

      // bed
      const felt = g.createRadialGradient(
        PLAY_W * 0.5, PLAY_H * 0.42, PLAY_W * 0.1,
        PLAY_W * 0.5, PLAY_H * 0.5, PLAY_H * 0.72
      );
      felt.addColorStop(0, "#1d8a52");
      felt.addColorStop(0.6, "#177045");
      felt.addColorStop(1, "#0e4f2f");
      g.fillStyle = felt;
      g.fillRect(0, 0, PLAY_W, PLAY_H);

      // faint cloth nap
      g.strokeStyle = "rgba(255,255,255,0.022)";
      g.lineWidth = 0.12;
      for (let y = 2; y < PLAY_H; y += 2.6) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(PLAY_W, y); g.stroke();
      }

      // foot spot
      g.fillStyle = "rgba(255,255,255,0.16)";
      g.beginPath(); g.arc(PLAY_W / 2, FOOT_Y, 0.28, 0, TAU); g.fill();

      // head string, only while it matters
      if (state.isBreak && state.screen === "play") {
        g.strokeStyle = "rgba(255,255,255,0.18)";
        g.lineWidth = 0.14;
        g.setLineDash([1.2, 1.2]);
        g.beginPath(); g.moveTo(0, HEAD_Y); g.lineTo(PLAY_W, HEAD_Y); g.stroke();
        g.setLineDash([]);
      }

      // pockets
      for (const p of POCKETS) {
        const grad = g.createRadialGradient(p.x, p.y, 0.4, p.x, p.y, p.r * 1.25);
        grad.addColorStop(0, "#000");
        grad.addColorStop(0.72, "#05070a");
        grad.addColorStop(1, "rgba(4,6,9,0)");
        g.fillStyle = grad;
        g.beginPath(); g.arc(p.x, p.y, p.r * 1.25, 0, TAU); g.fill();
        g.fillStyle = "#04060a";
        g.beginPath(); g.arc(p.x, p.y, p.r * 0.86, 0, TAU); g.fill();
      }

      // jaw tips
      g.fillStyle = "#0f5231";
      for (const jw of JAWS) {
        g.beginPath(); g.arc(jw.x, jw.y, JAW_R, 0, TAU); g.fill();
      }

      // sights
      g.fillStyle = "rgba(240,228,200,0.72)";
      const dm = RAIL * 0.5;
      for (let i = 1; i <= 7; i++) {
        if (i === 4) continue;
        const y = (PLAY_H / 8) * i;
        diamond(g, -dm, y, 0.5);
        diamond(g, PLAY_W + dm, y, 0.5);
      }
      for (let i = 1; i <= 3; i++) {
        const x = (PLAY_W / 4) * i;
        diamond(g, x, -dm, 0.5);
        diamond(g, x, PLAY_H + dm, 0.5);
      }
    }

    function diamond(g2, x, y, r) {
      g2.beginPath();
      g2.moveTo(x, y - r); g2.lineTo(x + r * 0.62, y);
      g2.lineTo(x, y + r); g2.lineTo(x - r * 0.62, y);
      g2.closePath(); g2.fill();
    }

    function roundRect(g2, x, y, w, h, r) {
      g2.beginPath();
      g2.moveTo(x + r, y);
      g2.arcTo(x + w, y, x + w, y + h, r);
      g2.arcTo(x + w, y + h, x, y + h, r);
      g2.arcTo(x, y + h, x, y, r);
      g2.arcTo(x, y, x + w, y, r);
      g2.closePath();
    }

    function drawBall(b) {
      const R = BALL_R;
      let x = b.x, y = b.y, scale = 1, alpha = 1;
      if (b.drop > 0) {
        const t = 1 - b.drop;
        x = lerp(b.x, b.dropX, t * 0.85);
        y = lerp(b.y, b.dropY, t * 0.85);
        scale = lerp(1, 0.35, t);
        alpha = lerp(1, 0, Math.max(0, t - 0.45) / 0.55);
      }
      if (alpha <= 0.02) return;

      g.save();
      g.globalAlpha = alpha;
      g.translate(x, y);
      g.scale(scale, scale);

      const base = g.createRadialGradient(-R * 0.36, -R * 0.4, R * 0.08, 0, 0, R * 1.08);
      if (b.kind === "cue" || b.kind === "stripe") {
        base.addColorStop(0, "#ffffff");
        base.addColorStop(0.55, "#f2eddd");
        base.addColorStop(1, "#b6ae9b");
      } else {
        base.addColorStop(0, shade(b.color, 0.5));
        base.addColorStop(0.5, b.color);
        base.addColorStop(1, shade(b.color, -0.45));
      }
      g.fillStyle = base;
      g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();

      if (b.kind === "stripe") {
        // the stripe sweeps across the face as the ball rolls
        g.save();
        g.beginPath(); g.arc(0, 0, R, 0, TAU); g.clip();
        g.rotate(b.ang);
        const off = Math.sin(b.roll) * R * 0.92;
        const band = g.createLinearGradient(off - R * 0.6, 0, off + R * 0.6, 0);
        band.addColorStop(0, shade(b.color, -0.3));
        band.addColorStop(0.4, b.color);
        band.addColorStop(1, shade(b.color, -0.35));
        g.fillStyle = band;
        g.fillRect(off - R * 0.58, -R * 1.1, R * 1.16, R * 2.2);
        g.restore();
      }

      // number patch, orbiting with the roll and squashing as it turns away
      if (b.n > 0) {
        const c = Math.cos(b.roll);
        if (c > 0.06) {
          const px = Math.sin(b.roll) * R * 0.5 * Math.cos(b.ang);
          const py = Math.sin(b.roll) * R * 0.5 * Math.sin(b.ang);
          g.save();
          g.translate(px, py);
          g.rotate(b.ang);
          g.scale(Math.max(0.12, c), 1);
          g.fillStyle = "#fbf7ec";
          g.beginPath(); g.arc(0, 0, R * 0.40, 0, TAU); g.fill();
          g.restore();

          if (c > 0.5 && view.s > 4.2) {
            screenSpace(g, px, py, () => {
              g.fillStyle = "#20222a";
              g.font = "700 " + Math.round(view.s * 0.62) + "px -apple-system,system-ui,sans-serif";
              g.textAlign = "center";
              g.textBaseline = "middle";
              g.fillText(String(b.n), 0, 0.5);
            });
          }
        }
      }

      // specular
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.beginPath();
      g.ellipse(-R * 0.34, -R * 0.4, R * 0.24, R * 0.16, -0.6, 0, TAU);
      g.fill();

      g.strokeStyle = "rgba(0,0,0,0.28)";
      g.lineWidth = 0.09;
      g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
      g.restore();
    }

    function shade(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
      if (amt > 0) {
        r = Math.round(lerp(r, 255, amt));
        gg = Math.round(lerp(gg, 255, amt));
        b = Math.round(lerp(b, 255, amt));
      } else {
        r = Math.round(r * (1 + amt));
        gg = Math.round(gg * (1 + amt));
        b = Math.round(b * (1 + amt));
      }
      return "rgb(" + r + "," + gg + "," + b + ")";
    }

    function drawShadows() {
      g.fillStyle = "rgba(0,0,0,0.30)";
      for (const b of state.balls) {
        if (b.potted && b.drop <= 0) continue;
        const a = b.drop > 0 ? b.drop : 1;
        g.globalAlpha = 0.3 * a;
        g.beginPath();
        g.ellipse(b.x + 0.34, b.y + 0.46, BALL_R * 0.98, BALL_R * 0.82, 0, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function drawAim() {
      const cue = state.cue;
      if (!cue || cue.potted) return;
      const human = state.mode === "pass" || state.turn === 0;
      if (!human || state.screen !== "play") return;
      if (state.phase !== "aim") return;

      const hit = predict(cue.x, cue.y, state.aim);
      const dx = Math.cos(state.aim), dy = Math.sin(state.aim);

      g.strokeStyle = "rgba(255,255,255,0.62)";
      g.lineWidth = 0.16;
      g.setLineDash([1.5, 1.1]);
      g.beginPath();
      g.moveTo(cue.x + dx * BALL_R, cue.y + dy * BALL_R);
      g.lineTo(hit.x, hit.y);
      g.stroke();
      g.setLineDash([]);

      // ghost ball
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.lineWidth = 0.13;
      g.beginPath(); g.arc(hit.x, hit.y, BALL_R, 0, TAU); g.stroke();

      if (hit.ball) {
        const ox = hit.ball.x - hit.x, oy = hit.ball.y - hit.y;
        const ol = Math.hypot(ox, oy) || 1;
        const ux = ox / ol, uy = oy / ol;
        // object ball line
        g.strokeStyle = "rgba(255,236,150,0.85)";
        g.lineWidth = 0.2;
        g.beginPath();
        g.moveTo(hit.ball.x, hit.ball.y);
        g.lineTo(hit.ball.x + ux * 11, hit.ball.y + uy * 11);
        g.stroke();
        arrowHead(hit.ball.x + ux * 11, hit.ball.y + uy * 11, Math.atan2(uy, ux),
          "rgba(255,236,150,0.85)");
        // cue ball tangent
        const sgn = (dx * -uy + dy * ux) > 0 ? 1 : -1;
        const tx = -uy * sgn, ty = ux * sgn;
        g.strokeStyle = "rgba(190,225,255,0.45)";
        g.lineWidth = 0.14;
        g.setLineDash([0.9, 0.9]);
        g.beginPath();
        g.moveTo(hit.x, hit.y);
        g.lineTo(hit.x + tx * 6.5, hit.y + ty * 6.5);
        g.stroke();
        g.setLineDash([]);
      }
    }

    function arrowHead(x, y, ang, color) {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(1.1, 0); g.lineTo(-0.7, 0.62); g.lineTo(-0.7, -0.62);
      g.closePath(); g.fill();
      g.restore();
    }

    function drawCueStick(timeMs) {
      const cue = state.cue;
      if (!cue || cue.potted || state.screen !== "play") return;
      const human = state.mode === "pass" || state.turn === 0;
      if (!human || state.phase !== "aim") return;

      const dx = Math.cos(state.aim), dy = Math.sin(state.aim);
      const idle = Math.sin(timeMs / 700) * 0.22;
      const pull = BALL_R + 1.4 + state.power * 17 + (state.power > 0 ? 0 : idle);
      const len = 52;
      const bx = cue.x - dx * pull, by = cue.y - dy * pull;
      const ex = bx - dx * len, ey = by - dy * len;

      g.save();
      g.lineCap = "round";

      g.strokeStyle = "rgba(0,0,0,0.28)";
      g.lineWidth = 0.95;
      g.beginPath();
      g.moveTo(bx + 0.5, by + 0.7); g.lineTo(ex + 0.5, ey + 0.7);
      g.stroke();

      const grad = g.createLinearGradient(bx, by, ex, ey);
      grad.addColorStop(0, "#f0dcae");
      grad.addColorStop(0.42, "#c99a5c");
      grad.addColorStop(0.62, "#2a1a12");
      grad.addColorStop(1, "#120c09");
      g.strokeStyle = grad;
      g.lineWidth = 0.86;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();

      // ferrule + tip
      g.strokeStyle = "#f7f3e6";
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx - dx * 1.5, by - dy * 1.5);
      g.stroke();
      g.strokeStyle = "#3f6ea8";
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx - dx * 0.42, by - dy * 0.42);
      g.stroke();
      g.restore();
    }

    function drawBallInHand(timeMs) {
      if (state.phase !== "ballinhand") return;
      const cue = state.cue;
      const ok = cuePlaceable(cue.x, cue.y, false);
      const pulse = 0.55 + Math.sin(timeMs / 260) * 0.25;
      g.strokeStyle = ok ? "rgba(150,255,190," + pulse + ")" : "rgba(255,120,120," + pulse + ")";
      g.lineWidth = 0.22;
      g.setLineDash([0.9, 0.8]);
      g.beginPath(); g.arc(cue.x, cue.y, BALL_R + 0.85, 0, TAU); g.stroke();
      g.setLineDash([]);
    }

    function render(timeMs) {
      g.clearRect(0, 0, ctx.width, ctx.height);

      // backdrop
      const bg = g.createLinearGradient(0, 0, 0, ctx.height);
      bg.addColorStop(0, "#171a21");
      bg.addColorStop(1, "#0c0e13");
      g.fillStyle = bg;
      g.fillRect(0, 0, ctx.width, ctx.height);

      applyWorld(g);
      // Everything lives inside the table outline — mainly so the cue stick,
      // which is a realistic 52 inches long, slides under the rail instead of
      // painting across the controls.
      roundRect(g, -RAIL, -RAIL, PLAY_W + RAIL * 2, PLAY_H + RAIL * 2, 3.2);
      g.clip();
      drawTable();
      drawShadows();
      drawAim();
      for (const b of state.balls) {
        if (b.potted && b.drop <= 0) continue;
        drawBall(b);
      }
      drawBallInHand(timeMs);
      drawCueStick(timeMs);
      g.restore();
    }

    // ====================================================================== //
    // DOM overlay                                                            //
    // ====================================================================== //
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    const root = ctx.createRoot({
      style: "font-family:" + FONT + ";color:#f2efe6;pointer-events:none;" +
        "-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;" +
        "overflow:hidden;"
    });

    // The tag is branched on literals rather than passed through, so the
    // element being created is statically obvious and never a script or frame.
    function el(tag, style, html) {
      const e = tag === "button"
        ? document.createElement("button")
        : document.createElement("div");
      if (style) e.style.cssText = style;
      if (html != null) e.innerHTML = html;
      return e;
    }

    const PANEL = "background:linear-gradient(180deg,rgba(30,34,44,0.97),rgba(18,21,28,0.97));" +
      "border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:20px;" +
      "box-shadow:0 24px 60px rgba(0,0,0,0.6);";
    const BTN = "pointer-events:auto;border:0;cursor:pointer;font-family:inherit;" +
      "border-radius:14px;padding:13px 16px;font-size:15px;font-weight:700;width:100%;" +
      "background:linear-gradient(180deg,#2fa564,#1d7a48);color:#fff;margin-top:9px;" +
      "box-shadow:0 4px 0 rgba(0,0,0,0.28);";
    const BTN2 = BTN.replace("linear-gradient(180deg,#2fa564,#1d7a48)",
      "rgba(255,255,255,0.09)").replace("color:#fff", "color:#e8e4d8");

    // ---- HUD ----------------------------------------------------------------
    const hud = el("div", "position:absolute;display:flex;align-items:center;gap:8px;");
    root.appendChild(hud);

    const chipA = el("div", "");
    const chipB = el("div", "");
    const soundBtn = el("button", "pointer-events:auto;border:0;cursor:pointer;flex:0 0 auto;" +
      "width:34px;height:34px;border-radius:11px;background:rgba(255,255,255,0.09);" +
      "color:#e8e4d8;font-size:15px;font-family:inherit;", "🔊");
    const menuBtn = el("button", "pointer-events:auto;border:0;cursor:pointer;flex:0 0 auto;" +
      "width:34px;height:34px;border-radius:11px;background:rgba(255,255,255,0.09);" +
      "color:#e8e4d8;font-size:15px;font-family:inherit;", "☰");
    hud.appendChild(chipA);
    hud.appendChild(chipB);
    hud.appendChild(soundBtn);
    hud.appendChild(menuBtn);

    function ballDot(n, size) {
      const col = n === 0 ? CUE_COLOR : BALL_COLORS[n <= 8 ? n : n - 8];
      const s = size || 11;
      if (n > 8) {
        return '<span style="display:inline-block;width:' + s + "px;height:" + s +
          "px;border-radius:50%;background:#f3efe2;position:relative;overflow:hidden;" +
          'border:1px solid rgba(0,0,0,0.35);vertical-align:middle;">' +
          '<span style="position:absolute;left:0;right:0;top:28%;height:44%;background:' +
          col + ';"></span></span>';
      }
      return '<span style="display:inline-block;width:' + s + "px;height:" + s +
        "px;border-radius:50%;background:" + col +
        ';border:1px solid rgba(0,0,0,0.35);vertical-align:middle;"></span>';
    }

    function chipHtml(p) {
      const on = state.turn === p && state.screen === "play";
      const g0 = state.group[p];
      const left = groupLeft(p);
      const label = state.open || !g0
        ? '<span style="opacity:0.6;">open table</span>'
        : (g0 === "solids" ? ballDot(3, 10) + " solids" : ballDot(11, 10) + " stripes");
      const cleared = g0 && left === 0;
      return '<div style="flex:1;min-width:0;border-radius:13px;padding:6px 9px;' +
        "background:" + (on ? "rgba(90,200,140,0.20)" : "rgba(255,255,255,0.055)") +
        ";border:1px solid " + (on ? "rgba(120,230,170,0.45)" : "rgba(255,255,255,0.07)") + ';">' +
        '<div style="display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:800;' +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" +
        (on ? "#bdf5d5" : "#ddd8cb") + ';">' +
        (on ? "▸ " : "") + esc(nameOf(p)) + "</div>" +
        '<div style="display:flex;align-items:center;gap:4px;font-size:11px;margin-top:2px;' +
        'opacity:0.9;white-space:nowrap;">' + label +
        (g0 ? '<span style="opacity:0.6;">· ' + (cleared ? "on the 8" : left + " left") + "</span>" : "") +
        "</div></div>";
    }

    function syncHud() {
      chipA.innerHTML = chipHtml(0);
      chipB.innerHTML = chipHtml(1);
      chipA.style.cssText = "flex:1;min-width:0;";
      chipB.style.cssText = "flex:1;min-width:0;";
      soundBtn.textContent = soundOn ? "🔊" : "🔇";
      if (state.screen === "play") {
        const potted = state.balls.filter((b) => b.potted && b.n !== 0 && b.n !== 8).length;
        ctx.platform.setScore(potted);
        const g0 = state.group[0];
        if (g0) ctx.platform.setProgress(clamp(1 - groupLeft(0) / 7, 0, 1));
      }
    }

    const toastEl = el("div", "position:absolute;left:50%;transform:translateX(-50%);" +
      "max-width:88%;text-align:center;font-size:12.5px;font-weight:700;opacity:0;" +
      "transition:opacity 0.3s;padding:6px 13px;border-radius:11px;white-space:nowrap;" +
      "overflow:hidden;text-overflow:ellipsis;background:rgba(10,13,18,0.82);" +
      "box-shadow:0 3px 14px rgba(0,0,0,0.5);");
    root.appendChild(toastEl);

    // ---- controls -----------------------------------------------------------
    const ctl = el("div", "position:absolute;display:flex;align-items:center;gap:9px;");
    root.appendChild(ctl);

    // spin widget
    const spinWrap = el("div", "pointer-events:auto;flex:0 0 auto;position:relative;" +
      "width:52px;height:52px;border-radius:50%;cursor:pointer;" +
      "background:radial-gradient(circle at 34% 30%,#ffffff,#e9e3d2 55%,#a8a091);" +
      "box-shadow:0 3px 10px rgba(0,0,0,0.5),inset 0 0 0 1px rgba(0,0,0,0.2);");
    const spinDot = el("div", "position:absolute;width:13px;height:13px;border-radius:50%;" +
      "background:#e0483c;box-shadow:0 0 0 1.5px rgba(255,255,255,0.85);" +
      "left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;");
    spinWrap.appendChild(spinDot);
    ctl.appendChild(spinWrap);

    const nudgeL = el("button", "pointer-events:auto;flex:0 0 auto;border:0;cursor:pointer;" +
      "width:36px;height:44px;border-radius:12px;background:rgba(255,255,255,0.09);" +
      "color:#e8e4d8;font-size:16px;font-family:inherit;", "◀");
    const nudgeR = el("button", nudgeL.style.cssText, "▶");

    const powerWrap = el("div", "pointer-events:auto;flex:1;min-width:0;position:relative;" +
      "height:46px;border-radius:14px;background:rgba(255,255,255,0.08);overflow:hidden;" +
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,0.09);cursor:pointer;");
    const powerFill = el("div", "position:absolute;left:0;top:0;bottom:0;width:0%;" +
      "background:linear-gradient(90deg,#3fbf72,#e8c53c 58%,#e2553a);transition:width 0.04s;");
    const powerLabel = el("div", "position:absolute;inset:0;display:flex;align-items:center;" +
      "justify-content:center;font-size:12.5px;font-weight:800;letter-spacing:0.04em;" +
      "text-shadow:0 1px 4px rgba(0,0,0,0.7);pointer-events:none;", "DRAG TO SHOOT");
    powerWrap.appendChild(powerFill);
    powerWrap.appendChild(powerLabel);

    ctl.appendChild(nudgeL);
    ctl.appendChild(powerWrap);
    ctl.appendChild(nudgeR);

    function syncControls() {
      const human = state.screen === "play" &&
        (state.mode === "pass" || state.turn === 0);
      const canShoot = human && state.phase === "aim";
      const dim = canShoot ? "1" : "0.34";
      powerWrap.style.opacity = dim;
      spinWrap.style.opacity = dim;
      nudgeL.style.opacity = dim;
      nudgeR.style.opacity = dim;
      powerWrap.style.pointerEvents = canShoot ? "auto" : "none";
      spinWrap.style.pointerEvents = canShoot ? "auto" : "none";
      nudgeL.style.pointerEvents = canShoot ? "auto" : "none";
      nudgeR.style.pointerEvents = canShoot ? "auto" : "none";
      ctl.style.display = state.screen === "play" ? "flex" : "none";
      hud.style.display = state.screen === "play" ? "flex" : "none";
      if (state.phase === "ballinhand") {
        powerLabel.textContent = "PLACE THE CUE BALL";
      } else if (state.phase === "botwait") {
        powerLabel.textContent = "BOT IS THINKING…";
      } else if (state.phase === "shooting") {
        powerLabel.textContent = "";
      } else {
        powerLabel.textContent = state.power > 0.01
          ? Math.round(state.power * 100) + "%"
          : "DRAG TO SHOOT";
      }
      spinDot.style.left = (50 + state.spinX * 32) + "%";
      spinDot.style.top = (50 + state.spinY * 32) + "%";
    }

    function hideCue() {
      state.power = 0;
      powerFill.style.width = "0%";
      syncControls();
    }

    // ---- panels -------------------------------------------------------------
    const veil = el("div", "position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:20px;pointer-events:auto;" +
      "background:rgba(9,11,16,0.72);backdrop-filter:blur(7px);" +
      "-webkit-backdrop-filter:blur(7px);overflow:auto;");
    root.appendChild(veil);
    const veilBox = el("div", PANEL + "width:100%;max-width:340px;max-height:100%;overflow:auto;");
    veil.appendChild(veilBox);

    const overWrap = el("div", "position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:20px;pointer-events:auto;" +
      "background:linear-gradient(180deg,rgba(9,11,16,0.35),rgba(9,11,16,0.8));");
    root.appendChild(overWrap);
    const overBox = el("div", PANEL + "width:100%;max-width:330px;text-align:center;");
    overWrap.appendChild(overBox);

    function showScreen(s) {
      state.screen = s;
      veil.style.display = s === "play" || s === "over" ? "none" : "flex";
      overWrap.style.display = s === "over" ? "flex" : "none";
      syncControls();
      syncHud();
    }

    // ---- menu ---------------------------------------------------------------
    function showMenu() {
      state.screen = "menu";
      veilBox.innerHTML =
        '<div style="text-align:center;margin-bottom:4px;">' +
        '<div style="font-size:30px;font-weight:900;letter-spacing:-0.02em;">Ball Pool</div>' +
        '<div style="opacity:0.62;font-size:13px;margin-top:4px;">' +
        "Eight-ball. Rack, run out, take the board.</div></div>" +
        '<div style="display:flex;justify-content:center;gap:5px;margin:14px 0 4px;">' +
        [1, 9, 3, 11, 8, 5, 13].map((n) => ballDot(n, 17)).join("") + "</div>" +
        '<button id="mSolo" style="' + BTN + '">Play the bot</button>' +
        '<button id="mPass" style="' + BTN2 + '">Two players · pass the phone</button>' +
        '<button id="mBoard" style="' + BTN2 + '">🏆 Leaderboards</button>' +
        '<button id="mHelp" style="' + BTN2 + '">How to play</button>' +
        (state.streak > 0
          ? '<div style="text-align:center;opacity:0.6;font-size:12px;margin-top:12px;">' +
            "Win streak: " + state.streak + "</div>"
          : "");
      veilBox.querySelector("#mSolo").onclick = () => { unlockAudio(); startMusic(); showDiff(); };
      veilBox.querySelector("#mPass").onclick = () => { unlockAudio(); newGame("pass"); };
      veilBox.querySelector("#mBoard").onclick = () => openBoard(state.diff + "_shots");
      veilBox.querySelector("#mHelp").onclick = showHelp;
      showScreen("menu");
    }

    function showDiff() {
      state.screen = "diff";
      veilBox.innerHTML =
        '<div style="font-size:20px;font-weight:900;margin-bottom:3px;">Pick your opponent</div>' +
        '<div style="opacity:0.6;font-size:12.5px;margin-bottom:14px;">' +
        "Each level has its own leaderboard.</div>" +
        DIFF_ORDER.map((id) => {
          const d = DIFFS[id];
          return '<button data-d="' + id + '" style="' + BTN2 +
            'text-align:left;padding:12px 14px;">' +
            '<div style="font-size:15px;font-weight:800;">' + d.icon + " " + d.name + "</div>" +
            '<div style="font-size:11.5px;opacity:0.62;font-weight:500;margin-top:2px;' +
            'white-space:normal;line-height:1.35;">' + d.blurb + "</div></button>";
        }).join("") +
        '<button id="dBack" style="' + BTN2 + 'margin-top:14px;opacity:0.7;">Back</button>';
      for (const b of veilBox.querySelectorAll("button[data-d]")) {
        b.onclick = () => newGame("solo", b.dataset.d);
      }
      veilBox.querySelector("#dBack").onclick = showMenu;
      showScreen("diff");
    }

    function showHelp() {
      state.screen = "help";
      veilBox.innerHTML =
        '<div style="font-size:20px;font-weight:900;margin-bottom:10px;">How to play</div>' +
        '<div style="font-size:13px;line-height:1.62;opacity:0.9;">' +
        "<div style='margin-bottom:7px;'>• <b>Aim</b> — drag anywhere on the felt. The line " +
        "runs from the cue ball to your finger, so hold further away for finer control. " +
        "The ◀ ▶ buttons nudge it a fraction of a degree.</div>" +
        "<div style='margin-bottom:7px;'>• <b>Shoot</b> — drag across the power bar and " +
        "let go. Release near the left end to cancel.</div>" +
        "<div style='margin-bottom:7px;'>• <b>Spin</b> — drag the small white ball to move " +
        "the contact point. High is follow, low is draw, sideways is english off the cushion." +
        "</div>" +
        "<div style='margin-bottom:7px;'>• <b>Groups</b> — the table is open until someone " +
        "pots a ball after the break. Whatever drops first is theirs.</div>" +
        "<div style='margin-bottom:7px;'>• <b>Fouls</b> — scratching, missing every ball, " +
        "hitting the wrong group first, or no cushion after contact. Foul gives your " +
        "opponent ball in hand.</div>" +
        "<div style='margin-bottom:7px;'>• <b>The 8</b> — clear your group first. Potting " +
        "the 8 early, or scratching on it, loses the rack.</div>" +
        "</div>" +
        '<button id="hBack" style="' + BTN + '">Got it</button>';
      veilBox.querySelector("#hBack").onclick = showMenu;
      showScreen("help");
    }

    // ---- leaderboard --------------------------------------------------------
    const BOARDS = [
      { id: "easy_shots", name: "Easy", note: "fewest shots to win" },
      { id: "medium_shots", name: "Medium", note: "fewest shots to win" },
      { id: "hard_shots", name: "Hard", note: "fewest shots to win" },
      { id: "best_run", name: "Runs", note: "most balls in one visit" },
      { id: "win_streak", name: "Streak", note: "longest run of wins" }
    ];

    // The entry shape is not pinned by the contract, so read every field
    // defensively and escape anything another player supplied.
    const bArr = (o) => !o ? [] : Array.isArray(o) ? o
      : (o.entries || o.rows || o.items || o.leaderboard || o.results ||
        (o.data && (o.data.entries || o.data.rows)) || []);
    const bSelf = (e) => !!(e && (e.self || e.isSelf || e.me || e.you || e.mine ||
      e.isViewer || e.viewer));
    const bName = (e) => e.name || e.displayName || e.handle || e.username ||
      (e.user && (e.user.name || e.user.displayName || e.user.handle || e.user.username)) ||
      (bSelf(e) ? "You" : "Player");
    const bVal = (e) => e.label || e.formatted || e.valueLabel || e.display ||
      (typeof e.value === "number" ? String(e.value) : (e.value != null ? String(e.value) : "—"));
    const bRank = (e, i) => e.rank != null ? e.rank : (e.position != null ? e.position : i + 1);

    function boardRow(rank, name, val, self) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 9px;' +
        "border-radius:10px;" + (self ? "background:rgba(120,230,170,0.15);" : "") + '">' +
        '<div style="width:22px;text-align:right;font-weight:800;opacity:0.55;font-size:13px;">' +
        esc(rank) + "</div>" +
        '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;' +
        "white-space:nowrap;font-weight:600;font-size:14px;color:" +
        (self ? "#a8f0c8" : "#f0ece1") + ';">' + esc(name) + "</div>" +
        '<div style="font-variant-numeric:tabular-nums;font-weight:700;font-size:14px;">' +
        esc(val) + "</div></div>";
    }

    let boardId = "medium_shots";
    let boardSeq = 0;

    async function openBoard(id) {
      boardId = id || boardId;
      state.screen = "board";
      const seq = ++boardSeq;
      haptic("light");

      const tabs = BOARDS.map((b) =>
        '<button data-b="' + b.id + '" style="pointer-events:auto;flex:1;border:0;' +
        "cursor:pointer;border-radius:10px;padding:7px 2px;font-family:inherit;" +
        "font-size:11px;font-weight:700;background:" +
        (b.id === boardId ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)") +
        ";color:" + (b.id === boardId ? "#fff" : "rgba(242,239,230,0.6)") + ';">' +
        esc(b.name) + "</button>").join("");
      const cur = BOARDS.find((b) => b.id === boardId) || BOARDS[0];
      const head =
        '<div style="font-size:19px;font-weight:900;margin-bottom:2px;">🏆 Leaderboards</div>' +
        '<div style="opacity:0.55;font-size:11.5px;margin-bottom:11px;">Global · all time · ' +
        esc(cur.note) + "</div>" +
        '<div style="display:flex;gap:4px;margin-bottom:12px;">' + tabs + "</div>";

      veilBox.innerHTML = head +
        '<div style="opacity:0.65;padding:18px 0;text-align:center;font-size:13px;">Loading…</div>' +
        '<button id="bBack" style="' + BTN2 + 'margin-top:12px;">Back</button>';
      wireBoard();
      showScreen("board");

      let inner;
      try {
        const lb = await ctx.memory.record(boardId)
          .leaderboard({ scope: "global", period: "all_time" });
        const arr = bArr(lb);
        if (!arr.length) {
          inner = '<div style="opacity:0.68;text-align:center;padding:18px 0;font-size:13px;">' +
            "Nobody on this board yet. Go and be first. 🎱</div>";
        } else {
          const top = arr.slice(0, 8);
          inner = top.map((e, i) => boardRow(bRank(e, i), bName(e), bVal(e), bSelf(e))).join("");
          const me = (lb && (lb.you || lb.self || lb.viewer || lb.me)) || arr.find(bSelf);
          if (me && !top.some(bSelf)) {
            inner += '<div style="height:1px;background:rgba(255,255,255,0.12);' +
              'margin:7px 2px;"></div>' +
              boardRow(bRank(me, arr.indexOf(me)), bName(me), bVal(me), true);
          }
        }
      } catch (_) {
        inner = '<div style="opacity:0.68;text-align:center;padding:18px 0;font-size:13px;">' +
          "The board isn't reachable right now.</div>";
      }
      if (seq !== boardSeq || state.screen !== "board") return;
      veilBox.innerHTML = head + inner +
        '<button id="bBack" style="' + BTN2 + 'margin-top:14px;">Back</button>';
      wireBoard();
    }

    function wireBoard() {
      for (const b of veilBox.querySelectorAll("button[data-b]")) {
        b.onclick = () => openBoard(b.dataset.b);
      }
      const back = veilBox.querySelector("#bBack");
      if (back) back.onclick = () => { if (state.winner != null) showOver(state.winner === 0); else showMenu(); };
    }

    // ---- game over ----------------------------------------------------------
    function showOver(youWon) {
      const w = state.winner;
      const title = state.mode === "pass"
        ? nameOf(w) + " wins"
        : (w === 0 ? "You win" : "Bot wins");
      const emoji = state.mode === "pass" ? "🎱" : (w === 0 ? "🏆" : "😖");

      // Each stat is flattened into its own named string first, so the markup
      // below only ever interpolates a plain identifier.
      const rowOpen = '<div style="display:flex;justify-content:space-between;padding:5px 2px;">';
      const rowKey = '<span style="opacity:0.6;">';
      const rowVal = '<span style="font-weight:700;">';
      const shotsTxt = esc(String(state.shots[0]));
      const runTxt = esc(state.bestRun + " ball" + (state.bestRun === 1 ? "" : "s"));
      const diffTxt = esc(DIFFS[state.diff].name);
      const streakTxt = esc(String(state.streak));
      const shotsRow = rowOpen + rowKey + "Shots taken</span>" + rowVal + shotsTxt + "</span></div>";
      const runRow = state.bestRun > 0
        ? rowOpen + rowKey + "Longest run</span>" + rowVal + runTxt + "</span></div>"
        : "";
      const soloRows = state.mode === "solo"
        ? rowOpen + rowKey + "Difficulty</span>" + rowVal + diffTxt + "</span></div>" +
          rowOpen + rowKey + "Win streak</span>" + rowVal + streakTxt + "</span></div>"
        : "";

      overBox.innerHTML =
        '<div style="font-size:38px;line-height:1;margin-bottom:6px;">' + emoji + "</div>" +
        '<div style="font-size:23px;font-weight:900;">' + esc(title) + "</div>" +
        '<div style="opacity:0.62;font-size:12.5px;margin-top:3px;">' +
        esc(state.overWhy) + "</div>" +
        '<div style="margin:14px 0 4px;text-align:left;font-size:13px;">' +
        shotsRow + runRow + soloRows + "</div>" +
        '<div id="subnote" style="font-size:11.5px;opacity:0.65;min-height:15px;' +
        'margin-bottom:6px;"></div>' +
        '<button id="oAgain" style="' + BTN + '">Rack again</button>' +
        '<button id="oBoard" style="' + BTN2 + '">🏆 Leaderboards</button>' +
        '<button id="oMenu" style="' + BTN2 + '">Menu</button>';
      overBox.querySelector("#oAgain").onclick = () => newGame(state.mode, state.diff);
      overBox.querySelector("#oBoard").onclick = () =>
        openBoard(state.mode === "solo" ? DIFFS[state.diff].channel : "best_run");
      overBox.querySelector("#oMenu").onclick = () => { state.winner = null; showMenu(); };
      showScreen("over");
    }

    // ====================================================================== //
    // Input                                                                  //
    // ====================================================================== //
    let aiming = false, movingCue = false, aimPointer = null;

    function localPoint(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      unlockAudio();
      if (state.screen !== "play") return;
      const human = state.mode === "pass" || state.turn === 0;
      if (!human) return;
      const p = localPoint(e);
      const w = s2w(p.x, p.y);

      // Capture, so a drag that wanders over the control strip keeps aiming.
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}

      if (state.phase === "ballinhand") {
        movingCue = true;
        aimPointer = e.pointerId;
        state.cue.x = clamp(w.x, BALL_R, PLAY_W - BALL_R);
        state.cue.y = clamp(w.y, BALL_R, PLAY_H - BALL_R);
        e.preventDefault();
        return;
      }
      if (state.phase !== "aim") return;

      aiming = true;
      aimPointer = e.pointerId;
      const cue = state.cue;
      const d = Math.hypot(w.x - cue.x, w.y - cue.y);
      if (d > BALL_R * 0.9) state.aim = Math.atan2(w.y - cue.y, w.x - cue.x);
      e.preventDefault();
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      if (e.pointerId !== aimPointer) return;
      const p = localPoint(e);
      const w = s2w(p.x, p.y);
      if (movingCue) {
        state.cue.x = clamp(w.x, BALL_R, PLAY_W - BALL_R);
        state.cue.y = clamp(w.y, BALL_R, PLAY_H - BALL_R);
        e.preventDefault();
        return;
      }
      if (!aiming) return;
      const cue = state.cue;
      const d = Math.hypot(w.x - cue.x, w.y - cue.y);
      if (d > BALL_R * 0.9) state.aim = Math.atan2(w.y - cue.y, w.x - cue.x);
      e.preventDefault();
    }, { passive: false });

    function endCanvasPointer() {
      if (movingCue) {
        movingCue = false;
        const snap = snapCue(state.cue.x, state.cue.y);
        if (snap) {
          state.cue.x = snap.x;
          state.cue.y = snap.y;
          state.phase = "aim";
          aimAtSomething();
          haptic("light");
          message(state.isBreak ? "Break them" : "Your shot", 1500);
          syncControls();
        }
      }
      aiming = false;
      aimPointer = null;
    }
    ctx.listen(canvas, "pointerup", endCanvasPointer);
    ctx.listen(canvas, "pointercancel", endCanvasPointer);

    // ---- power bar ----------------------------------------------------------
    let powerDrag = false, powerPointer = null;
    function powerFromEvent(e) {
      const r = powerWrap.getBoundingClientRect();
      return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    }
    ctx.listen(powerWrap, "pointerdown", (e) => {
      if (state.phase !== "aim") return;
      unlockAudio();
      powerDrag = true;
      powerPointer = e.pointerId;
      try { powerWrap.setPointerCapture(e.pointerId); } catch (_) {}
      state.power = powerFromEvent(e);
      powerFill.style.width = state.power * 100 + "%";
      syncControls();
      e.preventDefault();
    }, { passive: false });

    ctx.listen(powerWrap, "pointermove", (e) => {
      if (!powerDrag || e.pointerId !== powerPointer) return;
      state.power = powerFromEvent(e);
      powerFill.style.width = state.power * 100 + "%";
      syncControls();
      e.preventDefault();
    }, { passive: false });

    function releasePower(e) {
      if (!powerDrag || (e && e.pointerId !== powerPointer)) return;
      powerDrag = false;
      powerPointer = null;
      const p = state.power;
      if (p > 0.06 && state.phase === "aim") {
        fire(p, state.aim, state.spinX, state.spinY);
      } else {
        hideCue();
      }
    }
    ctx.listen(powerWrap, "pointerup", releasePower);
    ctx.listen(powerWrap, "pointercancel", releasePower);

    // ---- spin widget --------------------------------------------------------
    let spinDrag = false, spinPointer = null;
    function setSpinFrom(e) {
      const r = spinWrap.getBoundingClientRect();
      let dx = (e.clientX - r.left) / r.width * 2 - 1;
      let dy = (e.clientY - r.top) / r.height * 2 - 1;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      state.spinX = clamp(dx, -1, 1);
      state.spinY = clamp(dy, -1, 1);
      syncControls();
    }
    ctx.listen(spinWrap, "pointerdown", (e) => {
      if (state.phase !== "aim") return;
      spinDrag = true;
      spinPointer = e.pointerId;
      try { spinWrap.setPointerCapture(e.pointerId); } catch (_) {}
      setSpinFrom(e);
      e.preventDefault();
    }, { passive: false });
    ctx.listen(spinWrap, "pointermove", (e) => {
      if (!spinDrag || e.pointerId !== spinPointer) return;
      setSpinFrom(e);
      e.preventDefault();
    }, { passive: false });
    function endSpin(e) {
      if (!spinDrag || (e && e.pointerId !== spinPointer)) return;
      spinDrag = false;
      spinPointer = null;
      haptic("light");
    }
    ctx.listen(spinWrap, "pointerup", endSpin);
    ctx.listen(spinWrap, "pointercancel", endSpin);
    ctx.listen(spinWrap, "dblclick", () => {
      state.spinX = 0; state.spinY = 0; syncControls();
    });

    // ---- buttons ------------------------------------------------------------
    ctx.listen(nudgeL, "click", () => { state.aim -= 0.006; haptic("light"); });
    ctx.listen(nudgeR, "click", () => { state.aim += 0.006; haptic("light"); });
    ctx.listen(soundBtn, "click", () => {
      soundOn = !soundOn;
      if (soundOn) { unlockAudio(); startMusic(); } else { stopMusic(); }
      syncHud();
      saveProgress();
    });
    ctx.listen(menuBtn, "click", () => {
      state.winner = null;
      showMenu();
    });

    // ====================================================================== //
    // Frame loop                                                             //
    // ====================================================================== //
    let lastW = -1, lastH = -1;

    ctx.onFrame((dtMs, timeMs) => {
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        layout();
      }

      if (state.screen === "play" && state.phase === "shooting") {
        state.shotMs += dtMs;
        stepPhysics(dtMs);

        // Bleed energy if a rack refuses to settle, so a turn always ends.
        if (state.shotMs > CALM_MS) {
          const k = Math.pow(0.986, dtMs / 16.7);
          for (const b of state.balls) {
            if (b.potted) continue;
            b.vx *= k; b.vy *= k;
          }
        }
        if (state.shotMs > MAX_SHOT_MS) {
          for (const b of state.balls) { b.vx = 0; b.vy = 0; }
        }
        if (!ballsMoving()) {
          state.phase = "aim";
          resolveShot();
          syncHud();
          syncControls();
        }
      }

      // pocket drop animation and number settling
      for (const b of state.balls) {
        if (b.drop > 0) b.drop = Math.max(0, b.drop - dtMs / 620);
        if (!b.potted && b.vx === 0 && b.vy === 0) {
          // let a resting ball rotate its number face-up
          const target = Math.round(b.roll / TAU) * TAU;
          b.roll = lerp(b.roll, target, Math.min(1, dtMs / 260));
        }
      }

      updateRollBed(state.screen === "play" ? totalSpeed() : 0);

      if (state.msg && performance.now() > state.msgUntil) {
        state.msg = "";
        toastEl.style.opacity = "0";
      }

      render(timeMs);
    });

    // ====================================================================== //
    // Boot                                                                   //
    // ====================================================================== //
    rack();
    // A pre-broken table behind the menu, so the first frame is already a game.
    // Kept well clear of the pockets — a menu ball dropping in would be odd.
    for (const b of state.balls) {
      if (b.n === 0) continue;
      for (let tries = 0; tries < 30; tries++) {
        const nx = clamp(b.x + rnd(-9, 9), BALL_R + 4, PLAY_W - BALL_R - 4);
        const ny = clamp(b.y + rnd(-13, 24), BALL_R + 5, PLAY_H - BALL_R - 5);
        let clear = true;
        for (const p of POCKETS) {
          if (Math.hypot(nx - p.x, ny - p.y) < p.r + BALL_D) { clear = false; break; }
        }
        if (clear) { b.x = nx; b.y = ny; break; }
      }
      b.roll = rnd(0, TAU);
      b.ang = rnd(0, TAU);
    }
    // separate any overlaps the scatter created
    for (let pass = 0; pass < 40; pass++) substep(0.0001);
    for (const b of state.balls) { b.vx = 0; b.vy = 0; b.potted = false; b.drop = 0; }
    shot.potted = [];
    shot.cueScratched = false;

    await loadProgress();
    layout();
    render(0);
    ctx.markVisualReady("table drawn");
    showMenu();
    syncHud();
    ctx.platform.ready();
  }
};
