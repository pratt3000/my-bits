// Orrery — a generative Plethora Bit.
//
// A music box with no music in it. Bodies circle at whole-number ratios of one
// shared loop, and each rings a bell as it crosses the top. Because the ratios
// are whole numbers they all realign every loop, so the piece walks out of phase
// into dense polyrhythm and then falls back into a single unison chord — over
// and over, never quite the same on the way.
//
// The composition is not written down anywhere. The seed picks how many bodies,
// their orbital ratios, the scale and the key, and the mechanism plays itself.
//
// Tap for a new sky.

window.plethoraBit = {
  meta: {
    title: "Orrery",
    runtime: "plethora-bit@2",
    tags: ["generative", "music", "art", "ambient", "calm", "sensory", "space"],
    permissions: ["audio", "haptics"]
  },

  async init(ctx) {
    // ---- seeded randomness --------------------------------------------------
    function mulberry32(a) {
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const SEED_MAX = 0xffffff;
    const randomSeed = () => Math.floor(Math.random() * SEED_MAX);
    const seedLabel = (s) => s.toString(36).toUpperCase().padStart(5, "0");

    // ---- musical material ---------------------------------------------------
    // Scales without a leading tone, mostly: any two notes can sound together,
    // which is what lets an unsupervised machine play them in any order.
    const SCALES = [
      { name: "Pentatonic", steps: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26] },
      { name: "Minor Pentatonic", steps: [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27] },
      { name: "Hirajoshi", steps: [0, 2, 3, 7, 8, 12, 14, 15, 19, 20, 24, 26] },
      { name: "Kumoi", steps: [0, 2, 3, 7, 9, 12, 14, 15, 19, 21, 24, 26] },
      { name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19] },
      { name: "Lydian", steps: [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19] },
      { name: "In Sen", steps: [0, 1, 5, 7, 10, 12, 13, 17, 19, 22, 24, 25] },
      { name: "Whole Tone", steps: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22] }
    ];
    const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
    const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

    // ---- surfaces -----------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    // ---- audio --------------------------------------------------------------
    // Bespoke synthesis rather than ctx.music: this bit needs note-level control
    // over pitch and timing, which the preset music beds do not expose.
    let AC = null, master = null, dry = null, wetIn = null, muted = false;
    let drone = null;

    function makeImpulse(seconds, decay) {
      const len = Math.max(1, Math.floor(AC.sampleRate * seconds));
      const buf = AC.createBuffer(2, len, AC.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        }
      }
      return buf;
    }

    function initAudio() {
      if (AC || !ctx.capabilities.audio) return;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.85;

        // A limiter keeps a dense realignment chord from clipping.
        const comp = AC.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 8;
        comp.attack.value = 0.004;
        comp.release.value = 0.22;
        master.connect(comp);
        comp.connect(AC.destination);

        const convolver = AC.createConvolver();
        convolver.buffer = makeImpulse(3.2, 2.4);
        const wetGain = AC.createGain();
        wetGain.gain.value = 0.55;
        convolver.connect(wetGain);
        wetGain.connect(master);
        wetIn = convolver;

        dry = AC.createGain();
        dry.gain.value = 0.7;
        dry.connect(master);
      } catch (err) {
        AC = null;
        ctx.platform.error({ where: "audio", message: String(err) });
      }
    }

    // One struck bell. Inharmonic partials with separate decay rates are what
    // separate a bell from a beep: the upper partials die first.
    const PARTIALS = [
      [1.0, 1.0, 1.0],
      [2.0, 0.4, 0.62],
      [3.01, 0.19, 0.44],
      [4.31, 0.085, 0.3],
      [5.43, 0.04, 0.22]
    ];

    function chime(freq, level) {
      if (!AC || AC.state === "closed") return;
      const now = AC.currentTime;
      const dur = Math.min(4.6, Math.max(1.5, 900 / freq));

      const voice = AC.createGain();
      voice.gain.value = level;
      const lp = AC.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.min(7800, Math.max(1100, freq * 7));
      lp.Q.value = 0.4;
      voice.connect(lp);
      lp.connect(dry);
      lp.connect(wetIn);

      let longest = null;
      for (let i = 0; i < PARTIALS.length; i++) {
        const [mult, amp, decayScale] = PARTIALS[i];
        const osc = AC.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq * mult;
        const gn = AC.createGain();
        const d = dur * decayScale;
        gn.gain.setValueAtTime(0.0001, now);
        gn.gain.linearRampToValueAtTime(amp, now + 0.005);
        gn.gain.exponentialRampToValueAtTime(0.0001, now + d);
        osc.connect(gn);
        gn.connect(voice);
        osc.start(now);
        osc.stop(now + d + 0.06);
        if (i === 0) longest = osc;
      }
      // Release the little graph once the bell has rung out.
      if (longest) {
        longest.onended = () => {
          try { voice.disconnect(); lp.disconnect(); } catch (e) { /* already gone */ }
        };
      }
    }

    function startDrone(rootMidi) {
      stopDrone();
      if (!AC || AC.state === "closed") return;
      const now = AC.currentTime;
      const gain = AC.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.055, now + 4);
      const lp = AC.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 420;
      gain.connect(lp);
      lp.connect(dry);
      lp.connect(wetIn);

      const oscs = [];
      for (const semi of [-24, -12, -5]) {
        const osc = AC.createOscillator();
        osc.type = "sine";
        osc.frequency.value = midiToFreq(rootMidi + semi);
        // A few cents of detune per voice keeps the drone from sounding sampled.
        osc.detune.value = (semi === -5 ? 4 : semi === -12 ? -3 : 0);
        osc.connect(gain);
        osc.start(now);
        oscs.push(osc);
      }
      drone = { gain, lp, oscs };
    }

    function stopDrone() {
      if (!drone || !AC || AC.state === "closed") { drone = null; return; }
      const now = AC.currentTime;
      const d = drone;
      drone = null;
      try {
        d.gain.gain.cancelScheduledValues(now);
        d.gain.gain.setValueAtTime(d.gain.gain.value, now);
        d.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        for (const osc of d.oscs) osc.stop(now + 1);
        d.oscs[0].onended = () => {
          try { d.gain.disconnect(); d.lp.disconnect(); } catch (e) { /* already gone */ }
        };
      } catch (e) { /* context torn down under us */ }
    }

    ctx.onDestroy(() => {
      stopDrone();
      if (AC && AC.state !== "closed") { try { AC.close(); } catch (e) { /* ignore */ } }
      AC = null;
    });

    // ---- the mechanism ------------------------------------------------------
    let seed = randomSeed();
    let bodies = [];
    let scaleUsed = SCALES[0], rootMidi = 50, loopSeconds = 30, spin = 1;
    let hue0 = 200, hueSpan = 120;
    let stars = [];
    let bgGrad = null;
    let clock = 0;              // seconds since this sky started
    let pulses = [];
    let corePulse = 0;
    let started = false;
    let lastW = 0, lastH = 0;

    function layout() {
      const cx = ctx.width / 2;
      const cy = (ctx.safeArea.top + 74) + (ctx.height - ctx.safeArea.top - ctx.safeArea.bottom - 130) / 2;
      const maxR = Math.min(ctx.width * 0.44, (ctx.height - ctx.safeArea.top - ctx.safeArea.bottom) * 0.40);
      return { cx, cy, maxR };
    }

    function compose(fromSeed) {
      seed = fromSeed % (SEED_MAX + 1);
      const r = mulberry32((seed ^ 0xc2b2ae35) >>> 0);

      const n = 5 + Math.floor(r() * 6);          // 5..10 bodies
      loopSeconds = 22 + r() * 20;                // one full realignment
      const baseRevs = 11 + Math.floor(r() * 15); // laps the outermost body makes
      spin = r() < 0.5 ? 1 : -1;
      scaleUsed = SCALES[Math.floor(r() * SCALES.length)];
      rootMidi = 45 + Math.floor(r() * 13);
      hue0 = r() * 360;
      hueSpan = 50 + r() * 190;

      const { maxR } = layout();
      const rOuter = maxR;
      const rInner = maxR * (0.2 + r() * 0.12);

      bodies = [];
      for (let i = 0; i < n; i++) {
        const revs = baseRevs + i;                // inner bodies run faster
        const frac = n === 1 ? 0 : i / (n - 1);
        bodies.push({
          revs,
          period: loopSeconds / revs,
          radius: rOuter - (rOuter - rInner) * frac,
          note: rootMidi + scaleUsed.steps[Math.min(i, scaleUsed.steps.length - 1)],
          hue: (hue0 + hueSpan * frac) % 360,
          size: 4.6 - frac * 1.7,
          lap: 0,
          glow: 0,
          angle: -Math.PI / 2
        });
      }

      // A seeded star field, drawn live — cheap enough that it needs no bake.
      stars = [];
      const starCount = 90 + Math.floor(r() * 70);
      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: r(), y: r(),
          s: 0.4 + r() * 1.3,
          a: 0.12 + r() * 0.5,
          tw: r() * 6.283
        });
      }

      clock = 0;
      pulses = [];
      corePulse = 0;
      buildGradient();

      if (seedChip) seedChip.textContent = seedLabel(seed);
      if (nameChip) {
        nameChip.textContent =
          NOTE_NAMES[((rootMidi % 12) + 12) % 12] + " " + scaleUsed.name + " · " + bodies.length + " bodies";
      }
      if (AC) startDrone(rootMidi);
    }

    function buildGradient() {
      const { cx, cy } = layout();
      const outer = Math.max(ctx.width, ctx.height);
      bgGrad = g.createRadialGradient(cx, cy, 0, cx, cy, outer * 0.85);
      bgGrad.addColorStop(0, "hsl(" + hue0.toFixed(0) + ",42%,11%)");
      bgGrad.addColorStop(0.45, "hsl(" + ((hue0 + 24) % 360).toFixed(0) + ",44%,6%)");
      bgGrad.addColorStop(1, "#03040a");
    }

    function ring(body) {
      // Only the outermost body taps the phone. Buzzing on every chime in a
      // ten-body polyrhythm is a vibrating brick, not a downbeat.
      if (started && body === bodies[0] && ctx.capabilities.haptics) ctx.platform.haptic("light");
      corePulse = Math.min(1.4, corePulse + 0.45);
      body.glow = 1;
      const { cx, cy } = layout();
      pulses.push({
        x: cx + Math.cos(body.angle) * body.radius,
        y: cy + Math.sin(body.angle) * body.radius,
        age: 0,
        hue: body.hue
      });
      if (pulses.length > 40) pulses.shift();
      // Outer, slower bodies carry the low notes and get a little more weight.
      chime(midiToFreq(body.note), 0.15 + 0.1 * (1 - body.size / 4.6));
    }

    // ---- rendering ----------------------------------------------------------
    function draw(dtSeconds) {
      const { cx, cy } = layout();

      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.fillStyle = bgGrad;
      g.fillRect(0, 0, ctx.width, ctx.height);

      // Stars
      for (const s of stars) {
        const tw = 0.72 + 0.28 * Math.sin(clock * 1.4 + s.tw);
        g.globalAlpha = s.a * tw;
        g.fillStyle = "#dfe9ff";
        g.fillRect(s.x * ctx.width, s.y * ctx.height, s.s, s.s);
      }
      g.globalAlpha = 1;

      // The meridian every body rings as it passes.
      const topR = bodies.length ? bodies[0].radius : 0;
      const merGrad = g.createLinearGradient(cx, cy - topR - 26, cx, cy);
      merGrad.addColorStop(0, "rgba(255,255,255,0.24)");
      merGrad.addColorStop(1, "rgba(255,255,255,0.02)");
      g.strokeStyle = merGrad;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx, cy - topR - 26);
      g.lineTo(cx, cy);
      g.stroke();

      // Orbits, trails, bodies
      g.lineCap = "round";
      for (const b of bodies) {
        // Orbit ring, brightening for a moment after the body rings.
        g.strokeStyle = "hsla(" + b.hue.toFixed(0) + ",70%,70%," + (0.07 + b.glow * 0.3).toFixed(3) + ")";
        g.lineWidth = 1 + b.glow * 1.2;
        g.beginPath();
        g.arc(cx, cy, b.radius, 0, Math.PI * 2);
        g.stroke();

        // Comet trail: a short arc of the orbit behind the body.
        const span = Math.min(1.5, 0.5 + 2.4 / b.revs);
        const steps = 14;
        g.lineWidth = b.size * 0.7;
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps, t1 = (i + 1) / steps;
          const a0 = b.angle - spin * span * t1;
          const a1 = b.angle - spin * span * t0;
          g.globalAlpha = (1 - t1) * (1 - t1) * 0.5;
          g.strokeStyle = "hsl(" + b.hue.toFixed(0) + ",85%,68%)";
          g.beginPath();
          g.arc(cx, cy, b.radius, spin > 0 ? a0 : a1, spin > 0 ? a1 : a0);
          g.stroke();
        }
        g.globalAlpha = 1;

        // The body: a soft halo under a bright core.
        const bx = cx + Math.cos(b.angle) * b.radius;
        const by = cy + Math.sin(b.angle) * b.radius;
        const rad = b.size * (1 + b.glow * 0.55);
        const halo = g.createRadialGradient(bx, by, 0, bx, by, rad * 5.5);
        halo.addColorStop(0, "hsla(" + b.hue.toFixed(0) + ",95%,74%," + (0.5 + b.glow * 0.4).toFixed(3) + ")");
        halo.addColorStop(1, "hsla(" + b.hue.toFixed(0) + ",95%,60%,0)");
        g.fillStyle = halo;
        g.beginPath();
        g.arc(bx, by, rad * 5.5, 0, Math.PI * 2);
        g.fill();

        g.fillStyle = "hsl(" + b.hue.toFixed(0) + ",100%," + (82 + b.glow * 14).toFixed(0) + "%)";
        g.beginPath();
        g.arc(bx, by, rad, 0, Math.PI * 2);
        g.fill();

        b.glow = Math.max(0, b.glow - dtSeconds * 2.2);
      }

      // Expanding rings left by each chime.
      g.globalCompositeOperation = "lighter";
      for (const p of pulses) {
        const t = p.age / 1.1;
        if (t >= 1) continue;
        const rr = 6 + t * 78;
        g.globalAlpha = (1 - t) * (1 - t) * 0.5;
        g.strokeStyle = "hsl(" + p.hue.toFixed(0) + ",90%,72%)";
        g.lineWidth = 2 * (1 - t) + 0.4;
        g.beginPath();
        g.arc(p.x, p.y, rr, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;

      // The core the whole mechanism hangs from.
      const coreR = 5 + corePulse * 7;
      const coreGrad = g.createRadialGradient(cx, cy, 0, cx, cy, coreR * 6);
      coreGrad.addColorStop(0, "rgba(255,252,240," + (0.75 + corePulse * 0.2).toFixed(3) + ")");
      coreGrad.addColorStop(0.35, "hsla(" + hue0.toFixed(0) + ",90%,72%,0.32)");
      coreGrad.addColorStop(1, "hsla(" + hue0.toFixed(0) + ",90%,60%,0)");
      g.fillStyle = coreGrad;
      g.beginPath();
      g.arc(cx, cy, coreR * 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fffdf4";
      g.beginPath();
      g.arc(cx, cy, coreR * 0.5, 0, Math.PI * 2);
      g.fill();
    }

    // ---- overlay ------------------------------------------------------------
    const FONT = "-apple-system,system-ui,'Segoe UI',sans-serif";
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    const chipCss =
      "pointer-events:none;display:inline-flex;align-items:center;gap:6px;" +
      "padding:7px 12px;border-radius:999px;background:rgba(8,10,20,0.46);" +
      "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
      "color:rgba(255,255,255,0.88);font:600 12px/1 " + FONT + ";" +
      "letter-spacing:0.14em;text-transform:uppercase;white-space:nowrap;" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.45);";
    const btnCss =
      "pointer-events:auto;width:42px;height:42px;border-radius:14px;border:none;" +
      "cursor:pointer;background:rgba(8,10,20,0.46);color:rgba(255,255,255,0.9);" +
      "font:600 16px/1 " + FONT + ";backdrop-filter:blur(10px);" +
      "-webkit-backdrop-filter:blur(10px);touch-action:manipulation;" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.45);";

    ui.innerHTML =
      '<div style="position:absolute;left:14px;right:14px;top:' + (ctx.safeArea.top + 12) + 'px;' +
        'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">' +
          '<span style="' + chipCss + '">Seed <b data-el="seed" style="letter-spacing:0.2em;">—</b></span>' +
          '<span data-el="name" style="' + chipCss + 'opacity:0.64;font-size:10px;">—</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button data-el="help" aria-label="How it works" style="' + btnCss + '">?</button>' +
          '<button data-el="mute" aria-label="Mute" style="' + btnCss + '">🔊</button>' +
          '<button data-el="again" aria-label="New sky" style="' + btnCss + '">↻</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="hint" style="position:absolute;left:0;right:0;' +
        'bottom:calc(' + ctx.safeArea.bottom + 'px + 26px);text-align:center;' +
        'pointer-events:none;color:rgba(255,255,255,0.68);font:500 13px/1 ' + FONT + ';' +
        'letter-spacing:0.08em;transition:opacity 700ms ease;text-shadow:0 1px 8px rgba(0,0,0,0.8);">' +
        'tap to listen</div>' +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;' +
        'align-items:center;justify-content:center;padding:28px;pointer-events:auto;' +
        'background:rgba(4,5,12,0.86);backdrop-filter:blur(6px);' +
        '-webkit-backdrop-filter:blur(6px);">' +
        '<div style="max-width:330px;color:#eef;font:400 15px/1.6 ' + FONT + ';">' +
          '<h2 style="font-size:21px;margin-bottom:6px;letter-spacing:0.02em;">Orrery</h2>' +
          '<p style="opacity:0.62;font-size:13px;margin-bottom:16px;">Nothing here is composed. ' +
            'Each body rings a bell as it crosses the top line, and their orbits are whole-number ' +
            'ratios of one shared loop — so they drift apart into polyrhythm and fall back into ' +
            'a single chord, forever.</p>' +
          '<ul style="list-style:none;display:grid;gap:11px;">' +
            '<li>• <b>Tap anywhere</b> for a new sky — new orbits, new key, new colours.</li>' +
            '<li>• Outer bodies are slower and lower. Inner ones run fast and high.</li>' +
            '<li>• Wait for the loop to come around: every body meets at the top at once.</li>' +
          '</ul>' +
          '<p style="margin-top:18px;opacity:0.55;font-size:13px;">Tap to close.</p>' +
        '</div>' +
      '</div>';

    const seedChip = ui.querySelector('[data-el="seed"]');
    const nameChip = ui.querySelector('[data-el="name"]');
    const hint = ui.querySelector('[data-el="hint"]');
    const panel = ui.querySelector('[data-el="panel"]');
    const helpBtn = ui.querySelector('[data-el="help"]');
    const muteBtn = ui.querySelector('[data-el="mute"]');
    const againBtn = ui.querySelector('[data-el="again"]');

    function flashHint(text) {
      hint.textContent = text;
      hint.style.opacity = "1";
      ctx.timeout(() => { hint.style.opacity = "0"; }, 3000);
    }

    // ---- interaction --------------------------------------------------------
    function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      initAudio();
      if (AC) {
        if (AC.state === "suspended") {
          // resume() rejects rather than throws when the gesture is not accepted,
          // so the promise needs catching as well as the call.
          try {
            const resumed = AC.resume();
            if (resumed && resumed.catch) resumed.catch(() => { /* stays suspended */ });
          } catch (e) { /* ignore */ }
        }
        startDrone(rootMidi);
      } else {
        // No audio on this device or permission withheld: the mechanism is still
        // worth watching, so say so once instead of failing silently.
        muteBtn.textContent = "🔇";
        flashHint("sound unavailable — the orbits still run");
      }
    }

    function reseed(source) {
      compose(randomSeed());
      if (ctx.capabilities.haptics) ctx.platform.haptic("medium");
      ctx.platform.interact({
        type: "reseed", source,
        seed: seedLabel(seed), scale: scaleUsed.name, bodies: bodies.length
      });
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      const wasSilent = !started;
      firstGesture();
      if (wasSilent) {
        flashHint("tap again for a new sky");
        return; // let the first tap simply turn the sound on
      }
      reseed("canvas");
    }, { passive: false });

    ctx.listen(againBtn, "click", (e) => { e.stopPropagation(); firstGesture(); reseed("button"); });

    ctx.listen(muteBtn, "click", (e) => {
      e.stopPropagation();
      firstGesture();
      muted = !muted;
      muteBtn.textContent = muted ? "🔇" : "🔊";
      if (master && AC) {
        const now = AC.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(muted ? 0 : 0.85, now + 0.25);
      }
      ctx.platform.interact({ type: "mute", muted });
    });

    ctx.listen(helpBtn, "click", (e) => {
      e.stopPropagation();
      firstGesture();
      panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    });
    ctx.listen(panel, "click", () => { panel.style.display = "none"; });

    // ---- boot ---------------------------------------------------------------
    lastW = ctx.width;
    lastH = ctx.height;
    compose(seed);
    draw(0);
    ctx.markVisualReady("first-sky");

    ctx.onFrame((dtMs) => {
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        // Re-lay the orbits at the new size without restarting the piece.
        const { maxR } = layout();
        const n = bodies.length;
        const rOuter = maxR, rInner = maxR * 0.26;
        for (let i = 0; i < n; i++) {
          bodies[i].radius = rOuter - (rOuter - rInner) * (n === 1 ? 0 : i / (n - 1));
        }
        buildGradient();
      }

      const dt = Math.min(0.05, dtMs / 1000); // clamp so a stall cannot skip laps
      clock += dt;

      for (const b of bodies) {
        const progress = clock / b.period;
        b.angle = -Math.PI / 2 + spin * progress * Math.PI * 2;
        const lap = Math.floor(progress);
        if (lap > b.lap) {
          b.lap = lap;
          ring(b);
        }
      }

      corePulse = Math.max(0, corePulse - dt * 1.6);
      for (const p of pulses) p.age += dt;
      if (pulses.length && pulses[0].age > 1.2) pulses.shift();

      draw(dt);
    });

    flashHint("tap to listen");
    ctx.platform.ready();
  }
};
