/**
 * Symphony Sketchpad — draw a picture, then hear it played back.
 *
 * Pick an instrument, draw, and the stroke sounds as you make it: height is
 * pitch, quantised to a major pentatonic so nothing you draw is wrong. Press
 * play and a plane of light sweeps across the canvas, firing every point it
 * passes through. What you drew is the score.
 *
 * ── Sound ────────────────────────────────────────────────────────────────
 * Twenty-one instruments, none of them sampled and none of them a bare
 * oscillator either. Each pitched voice is built from a PeriodicWave — a real
 * harmonic spectrum, with the partial amplitudes and phases that give a reed
 * its buzz or a bell its clang — rather than the raw sawtooth-into-a-filter
 * that makes synthesised instruments sound cheap.
 *
 * Every voice runs through the same master chain, which is where most of the
 * quality actually lives:
 *
 *     voice → pan → ┬─────────────────────────→ bus → shelf → limiter → out
 *                   ├─ reverb send → convolver ──┘
 *                   └─ delay send → ping-pong ───┘
 *
 * The reverb is a ConvolverNode fed an impulse response generated at load:
 * exponentially decaying noise, ~2.6 s, with the two channels decorrelated so
 * it opens up in stereo. The delay is a true ping-pong — two delay lines
 * cross-fed under unity gain so it decays instead of running away. The
 * limiter is a DynamicsCompressor with a fast attack and a hard ratio, so a
 * hundred simultaneous notes duck politely instead of clipping.
 *
 * Notes are placed in the stereo field by where they sit on the canvas, so a
 * wide drawing plays wide. Velocity comes from how fast you drew that point:
 * a quick stroke is louder and brighter, because the filter cutoff tracks it.
 * Every note is detuned a few cents at random, so a repeated figure never
 * sounds mechanically identical.
 *
 * ── Picture ──────────────────────────────────────────────────────────────
 * Rendered in three.js, with a real bloom pipeline rather than a canvas
 * shadowBlur: the scene is drawn to a float target, a bright-pass extracts the
 * highlights, two separable Gaussian passes blur them at quarter resolution,
 * and the result is composited back additively with a filmic tone curve and a
 * little grain. Strokes are camera-facing ribbons whose fragment shader falls
 * off to nothing at the edges, so they read as light rather than as geometry.
 *
 * The drawing plane stays flat and screen-aligned — depth is for looking at,
 * not for drawing into, and a tilted canvas would only make you miss.
 */
window.plethoraBit = {
  meta: {
    title: "Symphony Sketchpad",
    runtime: "plethora-bit@2",
    tags: ["music", "creative", "drawing", "toy", "audio"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Instruments                                                        //
    // ===================================================================== //
    // Each entry carries its colour, and how its sound is built. `partials`
    // is a harmonic series used to bake a PeriodicWave: index 0 is the
    // fundamental. `odd` spectra sound hollow and clarinet-like; steep
    // rolloffs sound soft; inharmonic ratios sound metallic.
    const INSTRUMENTS = [
      { id: "trumpet", name: "Trumpet", colour: "#ff5a4d",
        partials: [1, 0.72, 0.62, 0.48, 0.34, 0.22, 0.14, 0.09, 0.05],
        atk: 0.045, dec: 0.22, sus: 0.72, rel: 0.28, cut: 2.4, q: 3.5, gain: 0.30 },
      { id: "bell", name: "Crystal Bell", colour: "#4fc3f7",
        inharmonic: [1, 2.76, 5.4, 8.93, 13.3], amps: [1, 0.5, 0.28, 0.14, 0.07],
        atk: 0.004, dec: 1.6, sus: 0.0, rel: 1.4, cut: 8, q: 0.4, gain: 0.24 },
      { id: "spacesynth", name: "Space Synth", colour: "#b388ff",
        partials: [1, 0.5, 0.42, 0.28, 0.24, 0.16, 0.12, 0.08],
        atk: 0.28, dec: 0.5, sus: 0.65, rel: 0.9, cut: 1.6, q: 5, sweep: 3.6, gain: 0.22 },
      { id: "deepbass", name: "Deep Bass", colour: "#0288d1", octave: -2,
        partials: [1, 0.28, 0.1, 0.04],
        atk: 0.02, dec: 0.4, sus: 0.8, rel: 0.35, cut: 1.1, q: 1.2, gain: 0.42 },
      { id: "piano", name: "Piano", colour: "#ff9142",
        partials: [1, 0.42, 0.26, 0.14, 0.09, 0.05, 0.035, 0.02, 0.012],
        atk: 0.003, dec: 1.1, sus: 0.12, rel: 0.5, cut: 5, q: 0.6, gain: 0.34 },
      { id: "cymbal", name: "Cymbals", colour: "#ffd54f", noise: "bright",
        atk: 0.002, dec: 1.2, sus: 0.0, rel: 0.6, cut: 9, q: 0.7, gain: 0.16 },
      { id: "xylo", name: "Xylophone", colour: "#4ade80",
        inharmonic: [1, 3.0, 6.2, 9.8], amps: [1, 0.42, 0.16, 0.06], octave: 1,
        atk: 0.002, dec: 0.38, sus: 0.0, rel: 0.25, cut: 7, q: 0.5, gain: 0.28 },
      { id: "bass", name: "Bass", colour: "#22d3ee", octave: -1,
        partials: [1, 0.62, 0.2, 0.14, 0.06, 0.03],
        atk: 0.012, dec: 0.3, sus: 0.7, rel: 0.22, cut: 1.3, q: 4, gain: 0.38 },
      { id: "drum", name: "Drum", colour: "#3b82f6", drum: "kick",
        atk: 0.002, dec: 0.34, sus: 0.0, rel: 0.2, gain: 0.62 },
      { id: "synth", name: "Synthesizer", colour: "#a855f7", unison: 3, spread: 11,
        partials: [1, 0.6, 0.45, 0.34, 0.26, 0.2, 0.15, 0.11, 0.08, 0.06],
        atk: 0.02, dec: 0.35, sus: 0.7, rel: 0.4, cut: 2.2, q: 4.5, gain: 0.14 },
      { id: "woodblk", name: "Woodblock", colour: "#f472b6", fixed: 880,
        inharmonic: [1, 2.4, 4.1], amps: [1, 0.34, 0.12],
        atk: 0.001, dec: 0.11, sus: 0.0, rel: 0.08, cut: 6, q: 1, gain: 0.34 },
      { id: "voxhigh", name: "Fem Vocals", colour: "#f8fafc", formants: [700, 1220, 2600],
        partials: [1, 0.7, 0.5, 0.36, 0.24, 0.16, 0.1, 0.06],
        atk: 0.09, dec: 0.3, sus: 0.75, rel: 0.4, cut: 3.2, q: 1.4, gain: 0.22 },
      { id: "voxlow", name: "Male Vocals", colour: "#94a3b8", formants: [420, 900, 2400], octave: -1,
        partials: [1, 0.78, 0.56, 0.4, 0.26, 0.17, 0.1],
        atk: 0.1, dec: 0.3, sus: 0.75, rel: 0.45, cut: 2.2, q: 1.4, gain: 0.26 },
      { id: "guitar", name: "Guitar", colour: "#b45309", pluck: true,
        partials: [1, 0.55, 0.42, 0.24, 0.18, 0.1, 0.07, 0.04],
        atk: 0.004, dec: 0.9, sus: 0.1, rel: 0.6, cut: 3, q: 1.6, gain: 0.30 },
      { id: "violin", name: "Violin", colour: "#cbd5e1", vibrato: 5.6, vibDepth: 5,
        partials: [1, 0.86, 0.62, 0.5, 0.36, 0.28, 0.2, 0.15, 0.11, 0.08],
        atk: 0.16, dec: 0.3, sus: 0.82, rel: 0.35, cut: 2.6, q: 2.2, gain: 0.24 },
      { id: "flute", name: "Flute", colour: "#e879f9", vibrato: 4.8, vibDepth: 2.2, breath: 0.06,
        partials: [1, 0.14, 0.07, 0.03],
        atk: 0.11, dec: 0.2, sus: 0.85, rel: 0.28, cut: 4, q: 0.8, gain: 0.30 },
      { id: "snare", name: "Snare", colour: "#fb7185", drum: "snare",
        atk: 0.001, dec: 0.19, sus: 0.0, rel: 0.12, gain: 0.4 },
      { id: "shaker", name: "Shaker", colour: "#f59e0b", noise: "shaker",
        atk: 0.004, dec: 0.09, sus: 0.0, rel: 0.06, cut: 11, q: 1.6, gain: 0.2 },
      { id: "kick", name: "Kick Drum", colour: "#2563eb", drum: "deepkick",
        atk: 0.002, dec: 0.55, sus: 0.0, rel: 0.3, gain: 0.85 },
      { id: "organ", name: "Retro Organ", colour: "#a16207",
        partials: [1, 0, 0.86, 0.4, 0, 0.62, 0, 0.3, 0.24],
        atk: 0.02, dec: 0.05, sus: 0.95, rel: 0.16, cut: 3.4, q: 0.7, gain: 0.22 },
      { id: "tamb", name: "Tambourine", colour: "#facc15", noise: "jingle",
        atk: 0.002, dec: 0.22, sus: 0.0, rel: 0.14, cut: 12, q: 2.4, gain: 0.17 }
    ];
    const byId = {};
    for (const i of INSTRUMENTS) byId[i.id] = i;

    // Major pentatonic over four octaves — no wrong notes.
    const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
    const ROOT = 261.63;

    const state = {
      instrument: "piano",
      strokes: [],
      drawing: null,
      playing: false,
      scan: 0,
      glow: 1,
      showPalette: true
    };

    // ===================================================================== //
    // 1. Sound                                                              //
    // ===================================================================== //
    const Sound = {
      ac: null, ready: false,
      bus: null, wet: null, delaySend: null, limiter: null,
      waves: {},
      voices: 0,

      init() {
        if (this.ac) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = this.ac = new AC();

        // --- master chain -------------------------------------------------
        // A limiter first, so nothing downstream can ever clip however many
        // notes are ringing; then a gentle shelf to take the glassy top off.
        this.limiter = ac.createDynamicsCompressor();
        this.limiter.threshold.value = -8;
        this.limiter.knee.value = 6;
        this.limiter.ratio.value = 12;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.22;

        const shelf = ac.createBiquadFilter();
        shelf.type = "highshelf";
        shelf.frequency.value = 6200;
        shelf.gain.value = -4.5;

        const master = ac.createGain();
        master.gain.value = 0.85;

        shelf.connect(this.limiter);
        this.limiter.connect(master);
        master.connect(ac.destination);

        this.bus = ac.createGain();
        this.bus.gain.value = 1;
        this.bus.connect(shelf);

        // --- reverb -------------------------------------------------------
        // A generated impulse: decaying noise, decorrelated per channel so the
        // tail spreads rather than sitting in the middle of your head.
        const conv = ac.createConvolver();
        conv.buffer = this.impulse(2.6, 2.4);
        const wet = this.wet = ac.createGain();
        wet.gain.value = 0.42;
        const wetTrim = ac.createGain();
        wetTrim.gain.value = 0.9;
        wet.connect(conv);
        conv.connect(wetTrim);
        wetTrim.connect(shelf);

        // --- ping-pong delay ----------------------------------------------
        // Two lines cross-fed. Feedback is kept well under 0.5 because a pair
        // of cross-fed delays has a system gain of 2g — at 0.5 it never decays.
        const dl = ac.createDelay(1.2), dr = ac.createDelay(1.2);
        dl.delayTime.value = 0.28;
        dr.delayTime.value = 0.42;
        const fbL = ac.createGain(), fbR = ac.createGain();
        fbL.gain.value = 0.30;
        fbR.gain.value = 0.30;
        const damp = ac.createBiquadFilter();
        damp.type = "lowpass";
        damp.frequency.value = 2600;
        const panL = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
        const panR = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
        if (panL.pan) { panL.pan.value = -0.75; panR.pan.value = 0.75; }
        dl.connect(damp); damp.connect(fbL); fbL.connect(dr);
        dr.connect(fbR); fbR.connect(dl);
        dl.connect(panL); dr.connect(panR);
        const dlyTrim = ac.createGain();
        dlyTrim.gain.value = 0.5;
        panL.connect(dlyTrim); panR.connect(dlyTrim);
        dlyTrim.connect(shelf);
        const send = this.delaySend = ac.createGain();
        send.gain.value = 0.2;
        send.connect(dl);

        this.bake();
        this.ready = true;
      },

      // Exponentially decaying noise, shaped so the onset is dense and the
      // tail thins out — a plausible small hall rather than a burst of hiss.
      impulse(seconds, decay) {
        const rate = this.ac.sampleRate;
        const n = Math.floor(rate * seconds);
        const buf = this.ac.createBuffer(2, n, rate);
        for (let c = 0; c < 2; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < n; i++) {
            const t = i / n;
            // A short pre-delay of near-silence gives the space some size.
            const early = i < rate * 0.012 ? 0.25 : 1;
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * early;
          }
        }
        return buf;
      },

      // Bake a PeriodicWave per instrument once, rather than per note.
      bake() {
        for (const inst of INSTRUMENTS) {
          const amps = inst.partials || inst.amps;
          if (!amps) continue;
          if (inst.inharmonic) {
            // Inharmonic ratios cannot be expressed as a PeriodicWave (its
            // partials are integer multiples), so those voices stack real
            // oscillators instead. Nothing to bake.
            continue;
          }
          const n = amps.length + 1;
          const real = new Float32Array(n);
          const imag = new Float32Array(n);
          for (let i = 0; i < amps.length; i++) {
            // A little phase scatter stops every partial starting aligned,
            // which is what makes an additive tone sound like a buzzer.
            const phase = (i * 2.399963) % (Math.PI * 2);
            imag[i + 1] = amps[i] * Math.cos(phase);
            real[i + 1] = amps[i] * Math.sin(phase);
          }
          try {
            this.waves[inst.id] = this.ac.createPeriodicWave(real, imag, { disableNormalization: false });
          } catch (_) { /* fall back to a plain wave below */ }
        }
      },

      noiseBuffer(seconds, kind) {
        const rate = this.ac.sampleRate;
        const n = Math.max(1, Math.floor(rate * seconds));
        const buf = this.ac.createBuffer(1, n, rate);
        const d = buf.getChannelData(0);
        if (kind === "jingle" || kind === "shaker") {
          // Grainy rather than smooth: bursts of noise, so it rattles.
          for (let i = 0; i < n; i++) {
            d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.55 ? 1 : 0.25);
          }
        } else {
          for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        }
        return buf;
      },

      freqFor(inst, y) {
        if (inst.fixed) return inst.fixed;
        const idx = Math.max(0, Math.min(SCALE.length - 1, Math.floor(y * SCALE.length)));
        const oct = inst.octave || 0;
        return ROOT * Math.pow(2, SCALE[idx] / 12 + oct);
      },

      /**
       * Build one voice. Returns handles so a held note can be bent and
       * released, or null for the percussive voices that simply ring out.
       *
       * `vel` is 0..1 from draw speed, `pan` is -1..1 from canvas x.
       */
      voice(inst, freq, vel, pan, when, sustained) {
        const ac = this.ac;
        const t = when || ac.currentTime;
        if (this.voices > 48) return null;      // a mercy limit
        this.voices++;

        const amp = ac.createGain();
        amp.gain.value = 0;

        const panner = ac.createStereoPanner ? ac.createStereoPanner() : null;
        if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); amp.connect(panner); }
        const tail = panner || amp;
        tail.connect(this.bus);
        tail.connect(this.wet);
        tail.connect(this.delaySend);

        const sources = [];
        let filter = null;
        let pitchTargets = [];

        if (inst.drum) {
          // Drums are pitch envelopes, not notes.
          const osc = ac.createOscillator();
          osc.type = "sine";
          const top = inst.drum === "deepkick" ? 190 : inst.drum === "kick" ? 165 : 210;
          const bot = inst.drum === "deepkick" ? 32 : inst.drum === "kick" ? 44 : 90;
          osc.frequency.setValueAtTime(top, t);
          osc.frequency.exponentialRampToValueAtTime(bot, t + (inst.drum === "deepkick" ? 0.16 : 0.09));
          osc.connect(amp);
          sources.push(osc);
          if (inst.drum === "snare") {
            const ns = ac.createBufferSource();
            ns.buffer = this.noiseBuffer(0.3, "noise");
            const hp = ac.createBiquadFilter();
            hp.type = "highpass";
            hp.frequency.value = 1500;
            const ng = ac.createGain();
            ng.gain.value = 0.7;
            ns.connect(hp); hp.connect(ng); ng.connect(amp);
            sources.push(ns);
          }
        } else if (inst.noise) {
          const ns = ac.createBufferSource();
          ns.buffer = this.noiseBuffer(1.4, inst.noise);
          ns.loop = true;
          filter = ac.createBiquadFilter();
          filter.type = inst.noise === "bright" ? "highpass" : "bandpass";
          filter.frequency.value = (inst.cut || 8) * 1000 * (0.6 + vel * 0.6);
          filter.Q.value = inst.q || 1;
          ns.connect(filter); filter.connect(amp);
          sources.push(ns);
        } else if (inst.inharmonic) {
          // Stacked oscillators at non-integer ratios: the way a struck bar or
          // a bell actually rings.
          for (let i = 0; i < inst.inharmonic.length; i++) {
            const osc = ac.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq * inst.inharmonic[i];
            const g = ac.createGain();
            g.gain.value = (inst.amps[i] || 0.2) * 0.9;
            osc.connect(g); g.connect(amp);
            sources.push(osc);
            if (i === 0) pitchTargets.push(osc.frequency);
          }
        } else {
          const wave = this.waves[inst.id];
          const count = inst.unison || 1;
          filter = ac.createBiquadFilter();
          filter.type = "lowpass";
          // Cutoff tracks the note and the velocity: play harder, sound brighter.
          const base = Math.min(16000, freq * (inst.cut || 3) * (0.55 + vel * 0.9));
          filter.frequency.setValueAtTime(base, t);
          filter.Q.value = inst.q || 1;
          if (inst.sweep) {
            filter.frequency.linearRampToValueAtTime(
              Math.min(16000, base * inst.sweep), t + (inst.atk + inst.dec));
          }
          filter.connect(amp);

          for (let u = 0; u < count; u++) {
            const osc = ac.createOscillator();
            if (wave) osc.setPeriodicWave(wave); else osc.type = "sawtooth";
            osc.frequency.value = freq;
            // A few cents of drift per note, plus unison spread.
            const centre = (count - 1) / 2;
            osc.detune.value = (u - centre) * (inst.spread || 0) + (Math.random() - 0.5) * 7;
            const ug = ac.createGain();
            ug.gain.value = 1 / count;
            osc.connect(ug); ug.connect(filter);
            sources.push(osc);
            pitchTargets.push(osc.frequency);
          }

          if (inst.formants) {
            // Vocal-ish: park a couple of resonant peaks over the spectrum.
            for (const f of inst.formants) {
              const bp = ac.createBiquadFilter();
              bp.type = "peaking";
              bp.frequency.value = f;
              bp.Q.value = 6;
              bp.gain.value = 9;
              filter.connect(bp);
              bp.connect(amp);
            }
          }
          if (inst.breath) {
            const ns = ac.createBufferSource();
            ns.buffer = this.noiseBuffer(1.0, "noise");
            ns.loop = true;
            const bp = ac.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.value = freq * 2.4;
            bp.Q.value = 1.2;
            const bg = ac.createGain();
            bg.gain.value = inst.breath;
            ns.connect(bp); bp.connect(bg); bg.connect(amp);
            sources.push(ns);
          }
          if (inst.vibrato) {
            const lfo = ac.createOscillator();
            lfo.frequency.value = inst.vibrato;
            const lg = ac.createGain();
            lg.gain.value = inst.vibDepth || 4;
            lfo.connect(lg);
            for (const p of pitchTargets) lg.connect(p);
            // Vibrato eases in — nobody starts a note already wobbling.
            lg.gain.setValueAtTime(0, t);
            lg.gain.linearRampToValueAtTime(inst.vibDepth || 4, t + 0.35);
            sources.push(lfo);
          }
        }

        // --- envelope -------------------------------------------------------
        const peak = (inst.gain || 0.3) * (0.45 + vel * 0.75);
        const atk = inst.atk || 0.01;
        const dec = inst.dec || 0.2;
        const sus = inst.sus === undefined ? 0.6 : inst.sus;
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.exponentialRampToValueAtTime(peak, t + atk);
        // Exponential decay to the sustain floor sounds natural; a linear one
        // sounds like a fader being pulled.
        amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + atk + dec);

        for (const s of sources) { try { s.start(t); } catch (_) {} }

        const stopAll = (at) => {
          for (const s of sources) { try { s.stop(at); } catch (_) {} }
          ctx.timeout(() => {
            this.voices = Math.max(0, this.voices - 1);
            try { tail.disconnect(); } catch (_) {}
          }, Math.max(0, (at - ac.currentTime) * 1000) + 120);
        };

        if (!sustained || sus === 0) {
          const end = t + atk + dec + (inst.rel || 0.2);
          amp.gain.exponentialRampToValueAtTime(0.0001, end);
          stopAll(end + 0.05);
          return null;
        }

        return {
          bend: (f) => {
            const now = ac.currentTime;
            for (const p of pitchTargets) p.setTargetAtTime(f, now, 0.045);
            if (filter && !inst.sweep) {
              filter.frequency.setTargetAtTime(
                Math.min(16000, f * (inst.cut || 3) * (0.55 + vel * 0.9)), now, 0.06);
            }
          },
          release: () => {
            const now = ac.currentTime;
            const rel = inst.rel || 0.3;
            amp.gain.cancelScheduledValues(now);
            amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), now);
            amp.gain.exponentialRampToValueAtTime(0.0001, now + rel);
            stopAll(now + rel + 0.05);
          }
        };
      },

      close() {
        if (this.ac) { try { this.ac.close(); } catch (_) {} }
        this.ac = null;
        this.ready = false;
      }
    };

    // ===================================================================== //
    // 2. Three                                                              //
    // ===================================================================== //
    let THREE = null;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (_) {
      try {
        THREE = await ctx.importModule("https://libs.plethora.studio/three/0.164.1/three.module.js");
      } catch (e2) { THREE = null; }
    }

    // A registry typeface, so the UI is not set in whatever the phone defaults
    // to. Falls back gracefully if the font service is unavailable.
    let FONT = "'Space Grotesk',-apple-system,BlinkMacSystemFont,sans-serif";
    try {
      await ctx.loadFont("Space Grotesk", "space-grotesk", "1.0.0", { weight: "300 700" });
    } catch (_) {
      FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    }

    const view = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "4";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);
    const HEAD_H = 52;
    const PAL_H = 150;

    let W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);

    if (!THREE) {
      ui.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'padding:30px;text-align:center;font-family:' + FONT + ';color:#e7e5f0;background:#08070f;">' +
        '<div><div style="font-size:19px;font-weight:700;margin-bottom:9px;">Symphony Sketchpad</div>' +
        '<div style="font-size:13.5px;opacity:0.75;line-height:1.6;">This needs 3D, and it could not ' +
        "start here. Try opening it again in the Plethora app.</div></div></div>";
      ctx.platform.error({ where: "three_import" });
      ctx.platform.ready();
      return;
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: view, antialias: false, alpha: false, powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(2, ctx.nativeDpr || 1));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x07060e, 1);

    const scene = new THREE.Scene();
    // Orthographic with top above bottom, so a pixel on screen is a unit in
    // world and y runs downward like the DOM. That flips the projection's Y,
    // which inverts triangle winding — every material here must be DoubleSide
    // or it gets back-face culled into invisibility.
    const camera = new THREE.OrthographicCamera(0, W, 0, H, -1000, 1000);
    camera.position.z = 10;

    // ---- pad geometry ----------------------------------------------------
    let padX = 0, padY = 0, padW = 1, padH = 1;

    // ---- the backdrop: a slow drifting field, drawn in a shader ----------
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uRes: { value: new THREE.Vector2(W, H) },
        uTime: { value: 0 },
        uPad: { value: new THREE.Vector4(0, 0, 1, 1) },
        uEnergy: { value: 0 }
      },
      vertexShader:
        "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.999,1.0);}",
      fragmentShader: [
        "precision highp float;",
        "varying vec2 vUv;",
        "uniform vec2 uRes; uniform float uTime; uniform vec4 uPad; uniform float uEnergy;",
        "float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}",
        "void main(){",
        // vUv.y runs bottom-up in GL; the layout is top-down, so flip it or the
        // pad rectangle lands at the wrong end of the screen.
        "  vec2 frag = vec2(vUv.x, 1.0 - vUv.y) * uRes;",
        // Inside the drawing pad it is near-black so the strokes carry; outside
        // it lifts very slightly, which frames the canvas without a border.
        "  float inPad = step(uPad.x,frag.x)*step(frag.x,uPad.x+uPad.z)",
        "              * step(uPad.y,frag.y)*step(frag.y,uPad.y+uPad.w);",
        "  vec2 c = (frag - uPad.xy) / max(uPad.zw, vec2(1.0));",
        "  float r = length(c - 0.5);",
        // A very slow aurora, brightening as more is playing.
        "  float a = sin(c.x*3.1 + uTime*0.19) * cos(c.y*2.3 - uTime*0.13);",
        "  float aur = smoothstep(0.2, 1.0, a) * (0.035 + uEnergy*0.10);",
        "  vec3 col = mix(vec3(0.028,0.024,0.052), vec3(0.012,0.010,0.026), inPad);",
        "  col += vec3(0.30,0.16,0.62) * aur * inPad;",
        "  col *= 1.0 - r*0.34;",             // vignette
        "  float g = hash(frag + fract(uTime)) - 0.5;",
        "  col += g * 0.016;",                // grain, so flat areas are not dead
        "  gl_FragColor = vec4(col,1.0);",
        "}"
      ].join("\n"),
      depthWrite: false, depthTest: false
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
    bg.frustumCulled = false;
    bg.renderOrder = -10;
    scene.add(bg);

    // ---- strokes: camera-facing ribbons that read as light ---------------
    // Each stroke owns a buffer of quads. The fragment shader fades to zero at
    // the ribbon edge, so there is no hard silhouette anywhere.
    const strokeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGlow: { value: 1 } },
      vertexShader: [
        "attribute float aSide; attribute float aFlare; attribute vec3 aColor;",
        "varying float vSide; varying float vFlare; varying vec3 vColor;",
        "void main(){ vSide=aSide; vFlare=aFlare; vColor=aColor;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float;",
        "varying float vSide; varying float vFlare; varying vec3 vColor;",
        "uniform float uGlow;",
        "void main(){",
        "  float d = abs(vSide);",
        // A soft core plus a wide halo — two falloffs rather than one, which is
        // what stops it looking like a fat antialiased line.
        "  float core = smoothstep(1.0, 0.12, d);",
        "  float halo = smoothstep(1.0, 0.0, d) * 0.42;",
        "  float a = core + halo * uGlow;",
        "  vec3 c = mix(vColor, vec3(1.0), core*core*0.55 + vFlare*0.5);",
        "  gl_FragColor = vec4(c * (0.75 + vFlare*1.7), a);",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide
    });

    const MAX_POINTS = 9000;
    const strokeGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(MAX_POINTS * 2 * 3);
    const sSide = new Float32Array(MAX_POINTS * 2);
    const sFlare = new Float32Array(MAX_POINTS * 2);
    const sCol = new Float32Array(MAX_POINTS * 2 * 3);
    const sIdx = new Uint32Array(MAX_POINTS * 6);
    strokeGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    strokeGeo.setAttribute("aSide", new THREE.BufferAttribute(sSide, 1));
    strokeGeo.setAttribute("aFlare", new THREE.BufferAttribute(sFlare, 1));
    strokeGeo.setAttribute("aColor", new THREE.BufferAttribute(sCol, 3));
    strokeGeo.setIndex(new THREE.BufferAttribute(sIdx, 1));
    strokeGeo.setDrawRange(0, 0);
    const strokeMesh = new THREE.Mesh(strokeGeo, strokeMat);
    strokeMesh.frustumCulled = false;
    scene.add(strokeMesh);

    const tmpCol = new THREE.Color();

    // Rebuild the ribbon buffers. Only on change, not per frame.
    let ribbonDirty = true;
    function buildRibbons() {
      let v = 0, tri = 0;
      const all = state.drawing ? state.strokes.concat([state.drawing]) : state.strokes;
      for (const st of all) {
        const pts = st.points;
        if (pts.length < 2) continue;
        tmpCol.set(st.colour);
        const half = st.width * 0.5;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(pts.length - 1, i + 1)];
          let dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          dx /= len; dy /= len;
          const nx = -dy * half, ny = dx * half;
          if (v + 2 > MAX_POINTS * 2) break;

          for (const s of [-1, 1]) {
            const o = v * 3;
            sPos[o] = padX + p.x + nx * s;
            sPos[o + 1] = padY + p.y + ny * s;
            sPos[o + 2] = 0;
            sSide[v] = s;
            sFlare[v] = p.flare || 0;
            sCol[o] = tmpCol.r; sCol[o + 1] = tmpCol.g; sCol[o + 2] = tmpCol.b;
            v++;
          }
          if (i > 0) {
            const q = v - 4;
            sIdx[tri++] = q; sIdx[tri++] = q + 1; sIdx[tri++] = q + 2;
            sIdx[tri++] = q + 1; sIdx[tri++] = q + 3; sIdx[tri++] = q + 2;
          }
        }
      }
      strokeGeo.attributes.position.needsUpdate = true;
      strokeGeo.attributes.aSide.needsUpdate = true;
      strokeGeo.attributes.aFlare.needsUpdate = true;
      strokeGeo.attributes.aColor.needsUpdate = true;
      strokeGeo.index.needsUpdate = true;
      strokeGeo.setDrawRange(0, tri);
      ribbonDirty = false;
    }

    // ---- the sweeping plane of light -------------------------------------
    const scanMat = new THREE.ShaderMaterial({
      uniforms: { uOn: { value: 0 } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: [
        "precision highp float; varying vec2 vUv; uniform float uOn;",
        "void main(){",
        "  float d = abs(vUv.x - 0.5) * 2.0;",
        "  float a = smoothstep(1.0, 0.0, d);",
        "  vec3 c = mix(vec3(0.55,0.75,1.0), vec3(1.0), pow(1.0-d, 6.0));",
        "  gl_FragColor = vec4(c, a*a*0.85*uOn);",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide
    });
    const scanMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), scanMat);
    scanMesh.frustumCulled = false;
    scene.add(scanMesh);

    // ---- sparks ----------------------------------------------------------
    const SPARKS = 900;
    const spPos = new Float32Array(SPARKS * 3);
    const spCol = new Float32Array(SPARKS * 3);
    const spSize = new Float32Array(SPARKS);
    const spLife = new Float32Array(SPARKS);
    const spVel = new Float32Array(SPARKS * 2);
    let spHead = 0;
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    sparkGeo.setAttribute("aColor", new THREE.BufferAttribute(spCol, 3));
    sparkGeo.setAttribute("aSize", new THREE.BufferAttribute(spSize, 1));
    sparkGeo.setAttribute("aLife", new THREE.BufferAttribute(spLife, 1));
    const sparkMat = new THREE.ShaderMaterial({
      uniforms: { uDpr: { value: renderer.getPixelRatio() } },
      vertexShader: [
        "attribute vec3 aColor; attribute float aSize; attribute float aLife;",
        "varying vec3 vColor; varying float vLife; uniform float uDpr;",
        "void main(){ vColor=aColor; vLife=aLife;",
        "  vec4 mv = modelViewMatrix * vec4(position,1.0);",
        "  gl_PointSize = aSize * uDpr * (0.35 + aLife*0.85);",
        "  gl_Position = projectionMatrix * mv; }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec3 vColor; varying float vLife;",
        "void main(){",
        "  float d = length(gl_PointCoord - 0.5) * 2.0;",
        "  float a = smoothstep(1.0, 0.0, d);",
        "  gl_FragColor = vec4(vColor, a*a*vLife);",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.frustumCulled = false;
    scene.add(sparks);

    function spark(x, y, colour, count, spread) {
      tmpCol.set(colour);
      for (let i = 0; i < count; i++) {
        const k = spHead;
        spHead = (spHead + 1) % SPARKS;
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * spread;
        spPos[k * 3] = padX + x;
        spPos[k * 3 + 1] = padY + y;
        spPos[k * 3 + 2] = 1;
        spVel[k * 2] = Math.cos(a) * s;
        spVel[k * 2 + 1] = Math.sin(a) * s;
        spCol[k * 3] = tmpCol.r; spCol[k * 3 + 1] = tmpCol.g; spCol[k * 3 + 2] = tmpCol.b;
        spSize[k] = 5 + Math.random() * 12;
        spLife[k] = 1;
      }
    }

    // ===================================================================== //
    // 3. Bloom                                                              //
    // ===================================================================== //
    // Scene → bright pass → two separable blurs at quarter res → additive
    // composite with a filmic curve. This is the difference between "glowing"
    // and "a bright line with a blurry copy behind it".
    const rtScene = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat
    });
    const rtA = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const rtB = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    const passScene = new THREE.Scene();
    const passQuad = new THREE.Mesh(quadGeo, null);
    passScene.add(passQuad);

    const VERT = "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}";

    const brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThresh: { value: 0.28 } },
      vertexShader: VERT,
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "uniform sampler2D tDiffuse; uniform float uThresh;",
        "void main(){",
        "  vec3 c = texture2D(tDiffuse, vUv).rgb;",
        "  float l = dot(c, vec3(0.2126,0.7152,0.0722));",
        "  float k = smoothstep(uThresh, uThresh+0.45, l);",
        "  gl_FragColor = vec4(c*k, 1.0);",
        "}"
      ].join("\n"),
      depthTest: false, depthWrite: false
    });

    const blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uTexel;",
        // Nine-tap Gaussian, weights from a normalised kernel.
        "void main(){",
        "  vec2 o = uDir * uTexel;",
        "  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;",
        "  s += texture2D(tDiffuse, vUv + o*1.3846153846).rgb * 0.3162162162;",
        "  s += texture2D(tDiffuse, vUv - o*1.3846153846).rgb * 0.3162162162;",
        "  s += texture2D(tDiffuse, vUv + o*3.2307692308).rgb * 0.0702702703;",
        "  s += texture2D(tDiffuse, vUv - o*3.2307692308).rgb * 0.0702702703;",
        "  gl_FragColor = vec4(s, 1.0);",
        "}"
      ].join("\n"),
      depthTest: false, depthWrite: false
    });

    const compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null },
        uAmount: { value: 1.15 }, uTime: { value: 0 }
      },
      vertexShader: VERT,
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "uniform sampler2D tScene; uniform sampler2D tBloom;",
        "uniform float uAmount; uniform float uTime;",
        "float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}",
        "void main(){",
        "  vec3 c = texture2D(tScene, vUv).rgb;",
        "  vec3 b = texture2D(tBloom, vUv).rgb;",
        "  c += b * uAmount;",
        // ACES-ish filmic curve: highlights roll off instead of clipping to
        // flat white, which is most of why this reads as photographed light.
        "  c = (c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);",
        "  c += (hash(vUv*1024.0 + fract(uTime)) - 0.5) * 0.012;",
        "  gl_FragColor = vec4(clamp(c,0.0,1.0), 1.0);",
        "}"
      ].join("\n"),
      depthTest: false, depthWrite: false
    });

    function pass(material, target) {
      passQuad.material = material;
      renderer.setRenderTarget(target || null);
      renderer.render(passScene, quadCam);
    }

    // ===================================================================== //
    // 4. Layout                                                             //
    // ===================================================================== //
    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = H;
      camera.updateProjectionMatrix();

      padX = 0;
      padY = SAFE_T + HEAD_H;
      padW = W;
      padH = Math.max(120, H - padY - (state.showPalette ? PAL_H : 34) - SAFE_B);

      bgMat.uniforms.uRes.value.set(W, H);
      bgMat.uniforms.uPad.value.set(padX, padY, padW, padH);

      scanMesh.scale.set(54, padH, 1);
      scanMesh.position.y = padY + padH / 2;

      const dpr = renderer.getPixelRatio();
      rtScene.setSize(Math.max(1, Math.floor(W * dpr)), Math.max(1, Math.floor(H * dpr)));
      const bw = Math.max(1, Math.floor(W * dpr * 0.25));
      const bh = Math.max(1, Math.floor(H * dpr * 0.25));
      rtA.setSize(bw, bh);
      rtB.setSize(bw, bh);
      blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
      sparkMat.uniforms.uDpr.value = dpr;

      head.style.top = SAFE_T + "px";
      head.style.height = HEAD_H + "px";
      palette.style.height = PAL_H + "px";
      palette.style.bottom = SAFE_B + "px";
      transport.style.bottom = (SAFE_B + (state.showPalette ? PAL_H : 0) + 14) + "px";
      hint.style.top = padY + "px";
      hint.style.height = padH + "px";
      ribbonDirty = true;
    }

    // ===================================================================== //
    // 5. Interface                                                          //
    // ===================================================================== //
    const INK = "#f2f0f7", DIM = "rgba(242,240,247,0.5)";

    const icon = (d, size, colour, fill) =>
      '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="' + (fill || "none") +
      '" stroke="' + colour + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
      'style="display:block;pointer-events:none;">' + d + "</svg>";
    const I_PLAY = '<path d="M6 4.5v15l13-7.5z"/>';
    const I_STOP = '<rect x="6" y="6" width="12" height="12" rx="1.5"/>';
    const I_UNDO = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
    const I_CLEAR = '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';
    const I_CHEV = '<path d="m6 9 6 6 6-6"/>';

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ";color:" + INK + ";" +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      '<div data-el="head" style="position:absolute;left:0;right:0;display:flex;align-items:center;' +
      'justify-content:space-between;padding:0 20px;">' +
        "<div>" +
          '<div style="font-size:10px;letter-spacing:3.4px;text-transform:uppercase;color:' + DIM + ';' +
          'font-weight:500;">Symphony</div>' +
          '<div data-el="inst" style="font-size:17px;font-weight:600;letter-spacing:-0.2px;' +
          'line-height:1.25;margin-top:1px;">Piano</div>' +
        "</div>" +
        '<div style="display:flex;gap:8px;">' +
          '<button data-el="undo" style="pointer-events:auto;width:38px;height:38px;border-radius:12px;' +
          'border:1px solid rgba(255,255,255,0.10);background:rgba(255,255,255,0.05);display:flex;' +
          'align-items:center;justify-content:center;padding:0;">' + icon(I_UNDO, 16, INK) + "</button>" +
          '<button data-el="clear" style="pointer-events:auto;width:38px;height:38px;border-radius:12px;' +
          'border:1px solid rgba(255,255,255,0.10);background:rgba(255,255,255,0.05);display:flex;' +
          'align-items:center;justify-content:center;padding:0;">' + icon(I_CLEAR, 16, INK) + "</button>" +
        "</div>" +
      "</div>" +

      '<div data-el="hint" style="position:absolute;left:0;right:0;display:flex;align-items:center;' +
      'justify-content:center;pointer-events:none;transition:opacity 700ms cubic-bezier(.2,.7,.3,1);">' +
        '<div style="text-align:center;">' +
          '<div style="font-size:15.5px;font-weight:500;letter-spacing:0.2px;">Draw something</div>' +
          '<div style="font-size:12.5px;color:' + DIM + ';margin-top:7px;letter-spacing:0.2px;">' +
          "higher is a higher note</div>" +
        "</div>" +
      "</div>" +

      '<div data-el="transport" style="position:absolute;left:0;right:0;display:flex;align-items:center;' +
      'justify-content:center;gap:12px;pointer-events:none;">' +
        '<button data-el="play" style="pointer-events:auto;width:62px;height:62px;border-radius:31px;' +
        'border:0;background:linear-gradient(160deg,#fdfcff,#cfc9e6);display:flex;align-items:center;' +
        'justify-content:center;padding:0;box-shadow:0 10px 34px rgba(120,90,255,0.34),' +
        'inset 0 1px 0 rgba(255,255,255,0.9);transition:transform 160ms cubic-bezier(.2,.7,.3,1);">' +
        icon(I_PLAY, 23, "#0b0916", "#0b0916") + "</button>" +
      "</div>" +

      '<div data-el="palette" style="position:absolute;left:0;right:0;pointer-events:auto;' +
      'background:linear-gradient(180deg,rgba(10,9,20,0) 0%,rgba(10,9,20,0.82) 26%,rgba(10,9,20,0.95) 100%);' +
      'transition:transform 340ms cubic-bezier(.2,.7,.3,1);">' +
        '<button data-el="fold" style="pointer-events:auto;position:absolute;top:-2px;left:50%;' +
        'transform:translateX(-50%);width:54px;height:26px;border:0;background:transparent;padding:0;' +
        'display:flex;align-items:center;justify-content:center;">' +
        '<span data-el="chev" style="display:block;transition:transform 300ms;">' +
        icon(I_CHEV, 17, DIM) + "</span></button>" +
        '<div data-el="rail" style="position:absolute;left:0;right:0;top:24px;bottom:8px;' +
        'overflow-x:auto;overflow-y:hidden;display:flex;gap:9px;padding:4px 18px;align-items:center;' +
        'touch-action:pan-x;-webkit-overflow-scrolling:touch;"></div>' +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const head = nodes.head, palette = nodes.palette, hint = nodes.hint, transport = nodes.transport;

    const chips = [];
    for (const inst of INSTRUMENTS) {
      const b = document.createElement("button");
      b.setAttribute("data-id", inst.id);
      b.style.cssText =
        "flex:0 0 auto;height:88px;width:72px;border-radius:16px;padding:11px 6px 9px;" +
        "border:1px solid rgba(255,255,255,0.09);background:rgba(255,255,255,0.045);" +
        "display:flex;flex-direction:column;align-items:center;justify-content:space-between;" +
        "pointer-events:auto;touch-action:manipulation;font-family:inherit;" +
        "transition:transform 200ms cubic-bezier(.2,.7,.3,1),background 200ms,border-color 200ms;";
      b.innerHTML =
        '<span data-dot style="width:26px;height:26px;border-radius:50%;background:' + inst.colour + ";" +
        "box-shadow:0 0 16px " + inst.colour + '99,inset 0 -3px 6px rgba(0,0,0,0.32);display:block;' +
        'transition:box-shadow 220ms,transform 220ms;"></span>' +
        '<span style="font-size:9.5px;font-weight:500;letter-spacing:0.35px;color:' + DIM + ';' +
        'text-align:center;line-height:1.2;">' + inst.name + "</span>";
      nodes.rail.appendChild(b);
      chips.push(b);
    }

    function paintPalette() {
      for (let i = 0; i < chips.length; i++) {
        const inst = INSTRUMENTS[i];
        const on = inst.id === state.instrument;
        chips[i].style.background = on ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.045)";
        chips[i].style.borderColor = on ? inst.colour : "rgba(255,255,255,0.09)";
        chips[i].style.transform = on ? "translateY(-3px)" : "none";
        const dot = chips[i].querySelector("[data-dot]");
        dot.style.boxShadow = on
          ? "0 0 26px " + inst.colour + ", inset 0 -3px 6px rgba(0,0,0,0.32)"
          : "0 0 16px " + inst.colour + "99, inset 0 -3px 6px rgba(0,0,0,0.32)";
        dot.style.transform = on ? "scale(1.12)" : "scale(1)";
      }
      const inst = byId[state.instrument];
      if (inst) { nodes.inst.textContent = inst.name; nodes.inst.style.color = inst.colour; }
    }

    // Keep the chosen instrument in view. Without this a remembered choice can
    // sit off the end of the rail, so the bit opens looking like nothing is
    // selected. scrollIntoView would move the whole page, so scroll the rail.
    function revealChip(smooth) {
      const i = INSTRUMENTS.findIndex((x) => x.id === state.instrument);
      if (i < 0) return;
      const chip = chips[i];
      const target = chip.offsetLeft - (nodes.rail.clientWidth - chip.offsetWidth) / 2;
      const max = Math.max(0, nodes.rail.scrollWidth - nodes.rail.clientWidth);
      const left = Math.max(0, Math.min(max, target));
      if (smooth && nodes.rail.scrollTo) nodes.rail.scrollTo({ left: left, behavior: "smooth" });
      else nodes.rail.scrollLeft = left;
    }

    // ===================================================================== //
    // 6. Playing it                                                         //
    // ===================================================================== //
    function setPlaying(on) {
      state.playing = on;
      nodes.play.innerHTML = on ? icon(I_STOP, 20, "#0b0916", "#0b0916") : icon(I_PLAY, 23, "#0b0916", "#0b0916");
      scanMat.uniforms.uOn.value = on ? 1 : 0;
      if (!on) for (const st of state.strokes) for (const p of st.points) p.flare = 0;
      ribbonDirty = true;
    }

    function togglePlay() {
      if (state.playing) { setPlaying(false); return; }
      if (!state.strokes.length) return;
      state.scan = 0;
      setPlaying(true);
      ctx.platform.interact({ kind: "play", strokes: state.strokes.length });
    }

    let energy = 0;
    function advanceScan(dt) {
      const prev = state.scan;
      state.scan += 210 * dt;                 // px per second
      let wrapped = false;
      if (state.scan >= padW) { state.scan -= padW; wrapped = true; }

      const when = Sound.ac ? Sound.ac.currentTime : 0;
      for (const st of state.strokes) {
        const inst = byId[st.instrument];
        for (const p of st.points) {
          const hit = wrapped ? (p.x >= prev || p.x < state.scan) : (p.x >= prev && p.x < state.scan);
          p.flare = Math.max(0, (p.flare || 0) - dt * 3.4);
          if (!hit) continue;
          p.flare = 1;
          if (Sound.ready && inst) {
            Sound.voice(inst, Sound.freqFor(inst, p.ny), 0.35 + p.vel * 0.6,
                        (p.x / padW) * 1.7 - 0.85, when, false);
          }
          spark(p.x, p.y, st.colour, 3, 62);
          energy = Math.min(1, energy + 0.10);
        }
      }
      ribbonDirty = true;
    }

    // ===================================================================== //
    // 7. Drawing                                                            //
    // ===================================================================== //
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      Sound.init();
      ctx.platform.start();
      hint.style.opacity = "0";
    }

    function inPad(e) {
      return e.offsetX >= padX && e.offsetX <= padX + padW &&
             e.offsetY >= padY && e.offsetY <= padY + padH;
    }

    let held = null, lastPt = null, lastT = 0;

    function makePoint(e, now) {
      const x = Math.max(0, Math.min(padW, e.offsetX - padX));
      const y = Math.max(0, Math.min(padH, e.offsetY - padY));
      // Velocity from how fast the finger is moving: a flick is loud and
      // bright, a slow drag is soft. Free expression, no extra controls.
      let vel = 0.35;
      if (lastPt && now > lastT) {
        const d = Math.hypot(x - lastPt.x, y - lastPt.y);
        vel = Math.max(0, Math.min(1, (d / (now - lastT)) * 5.5));
      }
      lastPt = { x: x, y: y };
      lastT = now;
      return { x: x, y: y, ny: 1 - y / padH, vel: vel, flare: 0 };
    }

    ctx.listen(view, "pointerdown", (e) => {
      if (state.playing || !inPad(e)) return;
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      lastPt = null;
      const inst = byId[state.instrument];
      const p = makePoint(e, performance.now());
      state.drawing = {
        instrument: state.instrument, colour: inst.colour,
        width: 7 + p.vel * 9, points: [p]
      };
      if (Sound.ready) {
        held = Sound.voice(inst, Sound.freqFor(inst, p.ny), 0.35 + p.vel * 0.6,
                           (p.x / padW) * 1.7 - 0.85, 0, true);
      }
      spark(p.x, p.y, inst.colour, 5, 40);
      ctx.platform.haptic("light");
      ribbonDirty = true;
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!state.drawing || state.playing) return;
      const p = makePoint(e, performance.now());
      const pts = state.drawing.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 2.2) return;
      pts.push(p);
      const inst = byId[state.instrument];
      if (held) held.bend(Sound.freqFor(inst, p.ny));
      if (Math.random() < 0.5) spark(p.x, p.y, state.drawing.colour, 1, 26);
      ribbonDirty = true;
    });

    const endStroke = () => {
      if (!state.drawing) return;
      if (held) { held.release(); held = null; }
      if (state.drawing.points.length > 1) {
        state.strokes.push(state.drawing);
        ctx.platform.interact({ kind: "stroke", instrument: state.instrument });
      }
      state.drawing = null;
      lastPt = null;
      ribbonDirty = true;
    };
    ctx.listen(view, "pointerup", endStroke);
    ctx.listen(view, "pointercancel", endStroke);
    ctx.listen(view, "lostpointercapture", endStroke);

    for (let i = 0; i < chips.length; i++) {
      const id = INSTRUMENTS[i].id;
      ctx.listen(chips[i], "pointerdown", (e) => {
        e.preventDefault();
        firstGesture();
        state.instrument = id;
        paintPalette();
        revealChip(true);
        remember();
        ctx.platform.haptic("light");
        // Audition the instrument on selection — you should hear what you picked.
        if (Sound.ready) {
          const inst = byId[id];
          Sound.voice(inst, Sound.freqFor(inst, 0.55), 0.7, 0, 0, false);
        }
      });
    }

    const tap = (el, fn) => ctx.listen(el, "pointerdown", (e) => { e.preventDefault(); firstGesture(); fn(); });
    tap(nodes.undo, () => {
      state.strokes.pop();
      ribbonDirty = true;
      ctx.platform.haptic("light");
    });
    tap(nodes.clear, () => {
      state.strokes.length = 0;
      setPlaying(false);
      ribbonDirty = true;
      ctx.platform.haptic("medium");
    });
    tap(nodes.play, () => {
      nodes.play.style.transform = "scale(0.9)";
      ctx.timeout(() => { nodes.play.style.transform = ""; }, 150);
      togglePlay();
      ctx.platform.haptic("medium");
    });
    tap(nodes.fold, () => {
      state.showPalette = !state.showPalette;
      palette.style.transform = state.showPalette ? "none" : "translateY(" + (PAL_H - 26) + "px)";
      nodes.chev.style.transform = state.showPalette ? "none" : "rotate(180deg)";
      layout();
      remember();
    });

    // ===================================================================== //
    // 8. Remembering                                                        //
    // ===================================================================== //
    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* not supported on this runtime */ }
    }
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage && ctx.storage);
    let saveTimer = 0;
    function remember() {
      if (!canStore || saveTimer) return;
      saveTimer = ctx.timeout(() => {
        saveTimer = 0;
        fireAndForget(() => ctx.storage.set("symphony2", {
          instrument: state.instrument, showPalette: state.showPalette
        }));
      }, 500);
    }
    if (canStore) {
      try {
        const s = await ctx.storage.get("symphony2");
        if (s && typeof s === "object") {
          if (byId[s.instrument]) state.instrument = s.instrument;
          if (typeof s.showPalette === "boolean") state.showPalette = s.showPalette;
        }
      } catch (_) { /* first run */ }
    }

    // ===================================================================== //
    // 9. Go                                                                 //
    // ===================================================================== //
    ctx.onDestroy(() => {
      Sound.close();
      try { renderer.dispose(); } catch (_) {}
      for (const t of [rtScene, rtA, rtB]) { try { t.dispose(); } catch (_) {} }
    });

    paintPalette();
    revealChip(false);
    if (!state.showPalette) {
      palette.style.transform = "translateY(" + (PAL_H - 26) + "px)";
      nodes.chev.style.transform = "rotate(180deg)";
    }
    layout();

    let clock = 0;
    function frame(dtMs) {
      const dt = Math.min(0.05, (dtMs || 16) / 1000);
      clock += dt;

      if (ctx.width !== W || ctx.height !== H) layout();
      if (state.playing) advanceScan(dt);

      energy *= Math.pow(0.35, dt);
      bgMat.uniforms.uTime.value = clock;
      bgMat.uniforms.uEnergy.value = energy;
      compMat.uniforms.uTime.value = clock;
      strokeMat.uniforms.uTime.value = clock;
      // The whole picture breathes a little while a note is held.
      strokeMat.uniforms.uGlow.value = 1 + energy * 0.5 + (held ? 0.25 : 0);

      scanMesh.position.x = padX + state.scan;

      for (let i = 0; i < SPARKS; i++) {
        if (spLife[i] <= 0) continue;
        spLife[i] = Math.max(0, spLife[i] - dt * 1.55);
        spPos[i * 3] += spVel[i * 2] * dt;
        spPos[i * 3 + 1] += spVel[i * 2 + 1] * dt;
        spVel[i * 2] *= 0.94;
        spVel[i * 2 + 1] = spVel[i * 2 + 1] * 0.94 + 34 * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.aLife.needsUpdate = true;

      if (ribbonDirty) buildRibbons();

      // scene → bright → blur h → blur v → composite
      renderer.setRenderTarget(rtScene);
      renderer.clear();
      renderer.render(scene, camera);

      brightMat.uniforms.tDiffuse.value = rtScene.texture;
      pass(brightMat, rtA);
      blurMat.uniforms.tDiffuse.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(1, 0);
      pass(blurMat, rtB);
      blurMat.uniforms.tDiffuse.value = rtB.texture;
      blurMat.uniforms.uDir.value.set(0, 1);
      pass(blurMat, rtA);

      compMat.uniforms.tScene.value = rtScene.texture;
      compMat.uniforms.tBloom.value = rtA.texture;
      pass(compMat, null);
    }

    window.__scanDbg = () => ({
      on: scanMat.uniforms.uOn.value, x: scanMesh.position.x, y: scanMesh.position.y,
      sx: scanMesh.scale.x, sy: scanMesh.scale.y, vis: scanMesh.visible,
      playing: state.playing, scan: state.scan, padY: padY, padH: padH, W: W, H: H
    });

    frame(16);
    ctx.markVisualReady("first frame");
    ctx.platform.ready();
    ctx.onFrame(frame);
  }
};
