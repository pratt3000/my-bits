/**
 * Loop Lab — a live looping station (a la Ed Sheeran's loop pedal), on-screen.
 *
 * Record a layer while it loops, then overdub more layers to build a full song.
 * 12 instruments, all procedurally synthesized with the Web Audio API (no
 * packaged assets): drum kit, bass, keys, a one-tap chord pad, strings, plucks,
 * lead, FM bells, marimba, organ, brass, and a "Vox" vowel synth. Key/scale,
 * loop length, swing, and per-track volume are adjustable; songs auto-save.
 */
window.plethoraBit = {
  meta: {
    title: "Loop Lab",
    runtime: "plethora-bit@2",
    tags: ["music", "creative", "loop-pedal", "beats", "sequencer"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    // ------------------------------------------------------------------ config
    const STEPS_PER_BAR = 16;                 // 16th-note grid
    const NOTE_NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
    const PADS = 8;                            // melodic pads per instrument
    const SCALES = {
      minPent: { name: "Minor Pent", iv: [0, 3, 5, 7, 10] },
      majPent: { name: "Major Pent", iv: [0, 2, 4, 7, 9] },
      minor:   { name: "Minor",      iv: [0, 2, 3, 5, 7, 8, 10] },
      major:   { name: "Major",      iv: [0, 2, 4, 5, 7, 9, 11] },
      dorian:  { name: "Dorian",     iv: [0, 2, 3, 5, 7, 9, 10] }
    };
    const SCALE_ORDER = ["minPent", "majPent", "minor", "major", "dorian"];

    const INSTRUMENTS = {
      kit:     { name: "Drums",   color: "#ff5470", type: "drum" },
      bass:    { name: "Bass",    color: "#37d67a", type: "melodic", octave: 0, gain: 0.9 },
      keys:    { name: "Keys",    color: "#5b8cff", type: "melodic", octave: 2, gain: 0.7 },
      chord:   { name: "Chord",   color: "#9d7bff", type: "melodic", octave: 2, gain: 0.4 },
      strings: { name: "Strings", color: "#c07cff", type: "melodic", octave: 2, gain: 0.55 },
      pluck:   { name: "Pluck",   color: "#ffb037", type: "melodic", octave: 3, gain: 0.7 },
      lead:    { name: "Lead",    color: "#ffd23f", type: "melodic", octave: 3, gain: 0.6 },
      bells:   { name: "Bells",   color: "#4cd7e0", type: "melodic", octave: 3, gain: 0.7 },
      marimba: { name: "Marimba", color: "#e08e45", type: "melodic", octave: 2, gain: 0.85 },
      organ:   { name: "Organ",   color: "#7bd88f", type: "melodic", octave: 2, gain: 0.5 },
      brass:   { name: "Brass",   color: "#ff7a45", type: "melodic", octave: 2, gain: 0.5 },
      vox:     { name: "Vox",     color: "#ff8fab", type: "melodic", octave: 2, gain: 0.6 }
    };
    const ORDER = ["kit", "bass", "keys", "chord", "strings", "pluck",
                   "lead", "bells", "marimba", "organ", "brass", "vox"];

    const DRUMS = [
      { id: "kick", label: "Kick" }, { id: "snare", label: "Snare" },
      { id: "hat", label: "Hat" },   { id: "ohat", label: "Open" },
      { id: "clap", label: "Clap" }, { id: "tom", label: "Tom" },
      { id: "rim", label: "Rim" },   { id: "perc", label: "Perc" }
    ];

    // ------------------------------------------------------------------- state
    const state = {
      bpm: 90,
      bars: 2,
      root: 0,             // 0 = A .. 11 = G#
      scale: "minPent",
      swing: 0,            // 0..0.6 delay on off-16ths
      instrument: "kit",
      playing: false,
      armed: false,        // REC pressed, waiting for count-in / loop boundary
      recording: false,    // actively capturing this loop
      recTrack: null,
      recStartLoop: 0,
      loop: 0,
      metronome: false,
      tracks: [],          // { id, inst, events:[{step,note}], vol }
      nextId: 1,
      lockInst: false
    };
    const VOLS = [1, 0.66, 0.33, 0];          // per-track volume cycle
    const SPL = () => state.bars * STEPS_PER_BAR;
    const stepDur = () => (60 / state.bpm) / 4;
    const noteLabel = (semi) => NOTE_NAMES[((semi % 12) + 12) % 12];
    // Build the 8 ascending pad notes for the current key + scale.
    function scalePads(inst) {
      const base = 55 * Math.pow(2, INSTRUMENTS[inst].octave);
      const iv = SCALES[state.scale].iv;
      const out = [];
      for (let i = 0; i < PADS; i++) {
        const semi = state.root + iv[i % iv.length] + 12 * Math.floor(i / iv.length);
        out.push({ semi, freq: base * Math.pow(2, semi / 12), label: noteLabel(semi) });
      }
      return out;
    }

    // ------------------------------------------------------------------- audio
    let ac = null, master = null, noiseBuf = null, audioBlocked = false, warnedAudio = false;

    function buildCtx() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioBlocked = true; showToast("Audio unavailable on this device"); return null; }
      try {
        ac = new AC();
      } catch (e) {
        audioBlocked = true; showToast("Audio is blocked here"); return null;
      }
      master = ac.createGain();
      master.gain.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.25;
      master.connect(comp); comp.connect(ac.destination);
      // one second of white noise, reused for percussive voices
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
    }

    // Mobile WebViews start the AudioContext suspended and only unlock it from a
    // real user gesture. Call this inside every gesture: resume + play a 1-frame
    // silent buffer (the iOS unlock), then verify we actually reached "running".
    function unlockAudio() {
      if (!ac && !buildCtx()) return null;
      try {
        const p = ac.resume && ac.resume();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
      try {
        const b = ac.createBuffer(1, 1, ac.sampleRate || 22050);
        const s = ac.createBufferSource();
        s.buffer = b; s.connect(ac.destination); s.start(0);
      } catch (_) {}
      if (ac.state !== "running" && !warnedAudio) {
        // one more nudge on the next frame, then warn if still stuck
        ctx.timeout(() => {
          if (ac && ac.state !== "running") {
            try { ac.resume(); } catch (_) {}
            if (ac.state !== "running" && !warnedAudio) {
              warnedAudio = true;
              showToast("Tap a pad to enable sound 🔊");
            }
          }
        }, 250);
      }
      return ac;
    }
    function ensureAudio() { return unlockAudio(); }

    function noiseSource() {
      const s = ac.createBufferSource();
      s.buffer = noiseBuf;
      return s;
    }
    function env(node, t, a, d, peak, dur, sustain) {
      const g = node.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.0001, t);
      g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
      if (sustain != null && dur > a + d) {
        g.exponentialRampToValueAtTime(Math.max(sustain, 0.0002), t + a + d);
        g.setValueAtTime(Math.max(sustain, 0.0002), t + dur - 0.05);
      }
      g.exponentialRampToValueAtTime(0.0001, t + dur);
    }

    // -- drum voices ----------------------------------------------------------
    function drum(id, t, vel) {
      const v = vel == null ? 1 : vel;
      if (id === "kick") {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.42);
      } else if (id === "snare") {
        const n = noiseSource(), nf = ac.createBiquadFilter(), ng = ac.createGain();
        nf.type = "highpass"; nf.frequency.value = 1400;
        ng.gain.setValueAtTime(v * 0.9, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        n.connect(nf); nf.connect(ng); ng.connect(master); n.start(t); n.stop(t + 0.22);
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "triangle"; o.frequency.setValueAtTime(190, t);
        g.gain.setValueAtTime(v * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
      } else if (id === "hat" || id === "ohat") {
        const dur = id === "hat" ? 0.05 : 0.32;
        const n = noiseSource(), nf = ac.createBiquadFilter(), ng = ac.createGain();
        nf.type = "highpass"; nf.frequency.value = 8000;
        ng.gain.setValueAtTime(v * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        n.connect(nf); nf.connect(ng); ng.connect(master); n.start(t); n.stop(t + dur + 0.02);
      } else if (id === "clap") {
        for (let i = 0; i < 3; i++) {
          const ct = t + i * 0.012;
          const n = noiseSource(), nf = ac.createBiquadFilter(), ng = ac.createGain();
          nf.type = "bandpass"; nf.frequency.value = 1600; nf.Q.value = 0.8;
          ng.gain.setValueAtTime(v * 0.6, ct); ng.gain.exponentialRampToValueAtTime(0.0001, ct + 0.09);
          n.connect(nf); nf.connect(ng); ng.connect(master); n.start(ct); n.stop(ct + 0.1);
        }
      } else if (id === "tom") {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(160, t);
        o.frequency.exponentialRampToValueAtTime(80, t + 0.18);
        g.gain.setValueAtTime(v * 0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.32);
      } else if (id === "rim") {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "square"; o.frequency.setValueAtTime(420, t);
        g.gain.setValueAtTime(v * 0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.06);
      } else { // perc
        const n = noiseSource(), nf = ac.createBiquadFilter(), ng = ac.createGain();
        nf.type = "bandpass"; nf.frequency.value = 3200; nf.Q.value = 4;
        ng.gain.setValueAtTime(v * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        n.connect(nf); nf.connect(ng); ng.connect(master); n.start(t); n.stop(t + 0.16);
      }
    }

    // -- melodic voices -------------------------------------------------------
    function melodic(inst, freq, t, vel) {
      const spec = INSTRUMENTS[inst];
      const v = (vel == null ? 1 : vel) * (spec.gain || 0.7);
      if (inst === "bass") {
        const o = ac.createOscillator(), sub = ac.createOscillator();
        const f = ac.createBiquadFilter(), g = ac.createGain();
        o.type = "sawtooth"; o.frequency.value = freq;
        sub.type = "sine"; sub.frequency.value = freq / 2;
        f.type = "lowpass"; f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(280, t + 0.25); f.Q.value = 6;
        env(g, t, 0.006, 0.1, v, 0.42);
        o.connect(f); sub.connect(f); f.connect(g); g.connect(master);
        o.start(t); sub.start(t); o.stop(t + 0.44); sub.stop(t + 0.44);
      } else if (inst === "keys") {
        const a = ac.createOscillator(), b = ac.createOscillator();
        const f = ac.createBiquadFilter(), g = ac.createGain();
        a.type = "sawtooth"; a.frequency.value = freq;
        b.type = "sawtooth"; b.frequency.value = freq * 1.005;
        f.type = "lowpass"; f.frequency.value = 2600; f.Q.value = 0.7;
        env(g, t, 0.008, 0.12, v, 0.6, v * 0.5);
        a.connect(f); b.connect(f); f.connect(g); g.connect(master);
        a.start(t); b.start(t); a.stop(t + 0.62); b.stop(t + 0.62);
      } else if (inst === "strings") {
        const g = ac.createGain(), f = ac.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 3000;
        env(g, t, 0.14, 0.2, v, 1.1, v * 0.7);
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.type = "sine"; lfo.frequency.value = 5.2; lg.gain.value = freq * 0.006;
        lfo.connect(lg);
        [0, 1.004, 0.996].forEach((mul) => {
          const o = ac.createOscillator();
          o.type = "sawtooth"; o.frequency.value = freq * mul;
          lg.connect(o.frequency);
          o.connect(f); o.start(t); o.stop(t + 1.15);
        });
        f.connect(g); g.connect(master); lfo.start(t); lfo.stop(t + 1.15);
      } else if (inst === "pluck") {
        const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        o.type = "triangle"; o.frequency.value = freq;
        f.type = "lowpass"; f.frequency.setValueAtTime(5000, t);
        f.frequency.exponentialRampToValueAtTime(700, t + 0.22); f.Q.value = 2;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 0.32);
      } else if (inst === "lead") {
        const f = ac.createBiquadFilter(), g = ac.createGain();
        f.type = "lowpass"; f.frequency.value = 3600; f.Q.value = 3;
        env(g, t, 0.005, 0.08, v, 0.5, v * 0.5);
        [1, 1.006].forEach((mul) => {
          const o = ac.createOscillator();
          o.type = "sawtooth"; o.frequency.value = freq * mul;
          o.connect(f); o.start(t); o.stop(t + 0.55);
        });
        f.connect(g); g.connect(master);
      } else if (inst === "bells") {
        const car = ac.createOscillator(), mod = ac.createOscillator();
        const mg = ac.createGain(), g = ac.createGain();
        car.type = "sine"; car.frequency.value = freq;
        mod.type = "sine"; mod.frequency.value = freq * 2;
        mg.gain.setValueAtTime(freq * 3, t); mg.gain.exponentialRampToValueAtTime(0.5, t + 0.6);
        mod.connect(mg); mg.connect(car.frequency);
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        car.connect(g); g.connect(master);
        car.start(t); mod.start(t); car.stop(t + 1.25); mod.stop(t + 1.25);
      } else if (inst === "marimba") {
        const o1 = ac.createOscillator(), o2 = ac.createOscillator();
        const g1 = ac.createGain(), g2 = ac.createGain();
        o1.type = "sine"; o1.frequency.value = freq;
        o2.type = "sine"; o2.frequency.value = freq * 4.01;
        g1.gain.setValueAtTime(v, t); g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        g2.gain.setValueAtTime(v * 0.28, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o1.connect(g1); o2.connect(g2); g1.connect(master); g2.connect(master);
        o1.start(t); o2.start(t); o1.stop(t + 0.42); o2.stop(t + 0.16);
      } else if (inst === "organ") {
        const g = ac.createGain();
        env(g, t, 0.01, 0.05, v, 0.8, v * 0.85);
        const vib = ac.createOscillator(), vg = ac.createGain();
        vib.type = "sine"; vib.frequency.value = 6; vg.gain.value = freq * 0.004;
        vib.connect(vg);
        [[1, 1], [2, 0.5], [3, 0.32], [4, 0.2]].forEach(([m, a]) => {
          const o = ac.createOscillator(), pg = ac.createGain();
          o.type = "sine"; o.frequency.value = freq * m; pg.gain.value = a;
          vg.connect(o.frequency); o.connect(pg); pg.connect(g);
          o.start(t); o.stop(t + 0.85);
        });
        g.connect(master); vib.start(t); vib.stop(t + 0.85);
      } else if (inst === "brass") {
        const f = ac.createBiquadFilter(), g = ac.createGain();
        f.type = "lowpass"; f.Q.value = 2;
        f.frequency.setValueAtTime(400, t);
        f.frequency.linearRampToValueAtTime(3000, t + 0.08);
        f.frequency.linearRampToValueAtTime(1500, t + 0.5);
        env(g, t, 0.03, 0.1, v, 0.6, v * 0.6);
        [1, 1.007, 0.993].forEach((mul) => {
          const o = ac.createOscillator();
          o.type = "sawtooth"; o.frequency.value = freq * mul;
          o.connect(f); o.start(t); o.stop(t + 0.65);
        });
        f.connect(g); g.connect(master);
      } else if (inst === "chord") {
        // one tap = a warm minor triad pad (root, minor 3rd, 5th)
        [0, 3, 7].forEach((semi) => {
          const nf = freq * Math.pow(2, semi / 12);
          const f = ac.createBiquadFilter(), g = ac.createGain();
          f.type = "lowpass"; f.frequency.value = 2200; f.Q.value = 0.6;
          env(g, t, 0.03, 0.16, v, 0.95, v * 0.7);
          [1, 1.005].forEach((mul) => {
            const o = ac.createOscillator();
            o.type = "sawtooth"; o.frequency.value = nf * mul;
            o.connect(f); o.start(t); o.stop(t + 1.0);
          });
          f.connect(g); g.connect(master);
        });
      } else { // vox — vowel-ish formant pad
        const src = ac.createOscillator(), g = ac.createGain();
        src.type = "sawtooth"; src.frequency.value = freq;
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.type = "sine"; lfo.frequency.value = 5.5; lg.gain.value = freq * 0.008;
        lfo.connect(lg); lg.connect(src.frequency);
        env(g, t, 0.06, 0.15, v, 0.7, v * 0.55);
        [[800, 8], [1150, 10], [2800, 12]].forEach(([fr, q]) => {
          const bp = ac.createBiquadFilter();
          bp.type = "bandpass"; bp.frequency.value = fr; bp.Q.value = q;
          src.connect(bp); bp.connect(g);
        });
        g.connect(master); src.start(t); src.stop(t + 0.74); lfo.start(t); lfo.stop(t + 0.74);
      }
    }

    function play(inst, note, t, vel) {
      if (!ac) return;
      if (INSTRUMENTS[inst].type === "drum") drum(note, t, vel);
      else melodic(inst, note, t, vel);
    }
    function click(t, accent) {
      if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.value = accent ? 1500 : 900;
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.04);
    }

    // ------------------------------------------------------------- scheduler
    let currentStep = 0, nextStepTime = 0, originTime = 0;

    function schedulerTick() {
      if (!ac || !state.playing) return;
      // Playback is driven by this timer, not a user gesture — mobile WebViews
      // suspend the context between touches, which would silence the loop. Keep
      // nudging it back to "running" while we're playing.
      if (ac.state !== "running") { try { ac.resume(); } catch (_) {} }
      const ahead = ac.currentTime + 0.12;
      const dur = stepDur();
      const spl = SPL();
      while (nextStepTime < ahead) {
        scheduleStep(currentStep, nextStepTime);
        currentStep += 1;
        nextStepTime += dur;
        if (currentStep >= spl) {
          currentStep = 0;
          state.loop += 1;
          onLoopBoundary(state.loop);
        }
      }
    }

    function scheduleStep(step, t) {
      // metronome / count-in clicks stay on the straight grid
      if ((state.metronome || state.armed || state.recording) && step % 4 === 0) {
        click(t, step === 0);
      }
      // swing: push the off-16ths a little late for groove
      const nt = step % 2 === 1 && state.swing > 0 ? t + state.swing * stepDur() : t;
      for (const tr of state.tracks) {
        const vol = tr.vol == null ? 1 : tr.vol;
        if (vol <= 0) continue;
        // during the capture loop, the record track is voiced by live taps only
        if (state.recording && tr === state.recTrack && state.loop === state.recStartLoop) continue;
        for (const ev of tr.events) {
          if (ev.step === step) play(tr.inst, ev.note, nt, 0.95 * vol);
        }
      }
    }

    function onLoopBoundary(loopIndex) {
      if (state.armed && !state.recording && loopIndex === state.recStartLoop) {
        state.recording = true;
        ctx.platform.haptic("medium");
        ctx.platform.milestone("record_start");
        renderTransport(); renderTracks();
      } else if (state.recording && loopIndex === state.recStartLoop + 1) {
        finalizeRecording();
      }
    }

    function quantStep() {
      const dur = stepDur();
      let s = Math.round((ac.currentTime - originTime) / dur);
      const spl = SPL();
      return ((s % spl) + spl) % spl;
    }

    // -------------------------------------------------------------- transport
    function startTransport() {
      if (!ensureAudio()) return;
      state.playing = true;
      state.loop = 0;
      currentStep = 0;
      originTime = ac.currentTime + 0.14;
      nextStepTime = originTime;
      renderTransport();
    }
    function stopTransport() {
      state.playing = false;
      if (state.armed || state.recording) cancelRecording(true);
      renderAll();   // full re-render: clears the record lock (dimmed instruments) and "· rec" label
    }

    function toggleRecord() {
      if (!ensureAudio()) return;
      ctx.platform.start();
      if (state.armed || state.recording) { cancelRecording(false); return; }
      const track = { id: state.nextId++, inst: state.instrument, events: [], vol: 1 };
      state.tracks.push(track);
      state.recTrack = track;
      state.armed = true;
      if (!state.playing) { startTransport(); state.recStartLoop = 1; }
      else { state.recStartLoop = state.loop + 1; }
      state.lockInst = true;
      ctx.platform.haptic("light");
      ctx.platform.interact({ type: "arm_record" });
      renderAll();
    }

    function cancelRecording(silent) {
      // drop an empty capture track
      if (state.recTrack && state.recTrack.events.length === 0) {
        state.tracks = state.tracks.filter((t) => t !== state.recTrack);
      }
      state.armed = false; state.recording = false; state.recTrack = null; state.lockInst = false;
      if (!silent) renderAll();
      save();
    }

    function finalizeRecording() {
      const tr = state.recTrack;
      state.recording = false; state.armed = false; state.recTrack = null; state.lockInst = false;
      if (tr && tr.events.length === 0) {
        state.tracks = state.tracks.filter((t) => t !== tr);
      } else {
        ctx.platform.haptic("success");
        ctx.platform.milestone("layer_added");
      }
      renderAll();
      save();
    }

    function tap(inst, note) {
      if (!ensureAudio()) return;
      ctx.platform.start();
      play(inst, note, ac.currentTime + 0.001, 1);
      ctx.platform.haptic("light");
      if (state.recording && state.recTrack && state.recTrack.inst === inst) {
        const step = quantStep();
        const evs = state.recTrack.events;
        if (!evs.some((e) => e.step === step && e.note === note)) {
          evs.push({ step, note });
          renderTracks();
        }
      }
      ctx.platform.interact({ type: "pad" });
    }

    // --------------------------------------------------------------- storage
    function save() {
      if (!ctx.capabilities.storage) return;
      try {
        ctx.storage.set("song", {
          bpm: state.bpm, bars: state.bars, root: state.root, scale: state.scale, swing: state.swing,
          tracks: state.tracks.map((t) => ({ inst: t.inst, events: t.events, vol: t.vol }))
        });
      } catch (_) {}
    }
    function load() {
      if (!ctx.capabilities.storage) return;
      try {
        const s = ctx.storage.get("song");
        if (!s || !Array.isArray(s.tracks)) return;
        if (s.bpm) state.bpm = Math.min(180, Math.max(50, s.bpm | 0));
        if (s.bars) state.bars = [1, 2, 4].includes(s.bars) ? s.bars : 2;
        if (Number.isFinite(s.root)) state.root = ((s.root % 12) + 12) % 12;
        if (SCALES[s.scale]) state.scale = s.scale;
        if (Number.isFinite(s.swing)) state.swing = Math.min(0.6, Math.max(0, s.swing));
        state.tracks = s.tracks.filter((t) => INSTRUMENTS[t.inst]).map((t) => ({
          id: state.nextId++, inst: t.inst,
          vol: Number.isFinite(t.vol) ? t.vol : (t.muted ? 0 : 1),
          events: (t.events || []).filter((e) => Number.isFinite(e.step))
        }));
      } catch (_) {}
    }

    // ------------------------------------------------------------------- view
    const root = ctx.createRoot({ touchAction: "manipulation" });
    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
    root.innerHTML = `
      <style>
        .ll { position:absolute; inset:0; display:flex; flex-direction:column;
          padding: ${8 + sa.top}px ${8 + sa.left}px ${10 + sa.bottom}px ${8 + sa.right}px;
          gap:8px; color:#eef; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          background:radial-gradient(120% 90% at 50% -10%,#20213a 0%,#0c0c16 55%,#07070d 100%);
          user-select:none; -webkit-user-select:none; overflow:hidden; }
        .ll * { box-sizing:border-box; }
        .hdr { display:flex; align-items:center; gap:8px; }
        .logo { font-weight:800; letter-spacing:.5px; font-size:clamp(15px,4.6vw,20px);
          background:linear-gradient(90deg,#ff5470,#ffb037,#37d67a,#5b8cff);
          -webkit-background-clip:text; background-clip:text; color:transparent; }
        .spacer { flex:1; }
        .chip { background:#1b1c2e; border:1px solid #2b2c46; color:#cdd; border-radius:999px;
          padding:6px 10px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }
        .chip:active { transform:scale(.95); }
        .bpm { display:flex; align-items:center; gap:6px; background:#14152400; }
        .rnd { width:30px; height:30px; border-radius:50%; border:1px solid #2b2c46; background:#181a2c;
          color:#cdd; font-size:17px; font-weight:700; display:flex; align-items:center; justify-content:center; }
        .rnd:active { transform:scale(.9); }
        .bpmv { min-width:74px; text-align:center; font-variant-numeric:tabular-nums; }
        .bpmv b { font-size:17px; } .bpmv small { color:#8a8ca6; }

        .timeline { position:relative; height:clamp(88px,17vh,150px); background:#0e0f1c;
          border:1px solid #23243c; border-radius:12px; overflow:hidden; }
        .lanes { position:absolute; inset:0; display:flex; flex-direction:column; }
        .lane { flex:1; position:relative; border-bottom:1px solid #171827; min-height:0; }
        .lane:last-child { border-bottom:none; }
        .lane .dot { position:absolute; top:50%; width:6px; height:6px; border-radius:50%;
          transform:translate(-50%,-50%); box-shadow:0 0 6px currentColor; }
        .grid { position:absolute; inset:0; pointer-events:none; }
        .playhead { position:absolute; top:0; bottom:0; width:2px; left:0;
          background:linear-gradient(#fff,#9fb0ff); box-shadow:0 0 8px #6f8bff; will-change:transform; }
        .tlempty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          color:#5b5d78; font-size:12.5px; text-align:center; padding:0 16px; }
        .recbadge { position:absolute; top:6px; left:8px; font-size:11px; font-weight:800;
          letter-spacing:.6px; color:#ff5470; display:none; align-items:center; gap:5px; }
        .recbadge i { width:8px; height:8px; border-radius:50%; background:#ff5470;
          box-shadow:0 0 8px #ff5470; animation:blink 1s steps(2) infinite; }
        @keyframes blink { 50% { opacity:.2; } }

        .tracks { display:flex; gap:6px; overflow-x:auto; min-height:34px; padding-bottom:2px; }
        .tracks::-webkit-scrollbar { display:none; }
        .trk { display:flex; align-items:center; gap:6px; padding:5px 8px; border-radius:9px;
          background:#15162700; border:1px solid #2b2c46; font-size:12px; font-weight:700; white-space:nowrap; }
        .trk .sw { width:9px; height:9px; border-radius:3px; }
        .trk.muted { opacity:.5; }
        .trk .lvl { display:flex; align-items:flex-end; gap:2px; height:12px; }
        .trk .lvl i { width:3px; background:currentColor; border-radius:1px; opacity:.3; }
        .trk .lvl i.on { opacity:1; }
        .trk .x { color:#8a8ca6; font-weight:800; padding:0 2px; }

        .insts { display:flex; gap:6px; overflow-x:auto; padding-bottom:2px; -webkit-overflow-scrolling:touch;
          scrollbar-width:none; }
        .insts::-webkit-scrollbar { display:none; }
        .inst { flex:0 0 auto; min-width:62px; padding:8px 12px; border-radius:10px; background:#15162a;
          border:1px solid #262845; font-size:12px; font-weight:700; text-align:center; cursor:pointer; color:#cdd; }
        .inst.on { color:#fff; }
        .inst.dim { opacity:.4; pointer-events:none; }

        .pads { flex:1; display:grid; grid-template-columns:repeat(4,1fr); grid-auto-rows:1fr;
          gap:8px; min-height:0; }
        .pad { border:none; border-radius:14px; color:#0c0c16; font-weight:800; font-size:13.5px;
          display:flex; align-items:center; justify-content:center; cursor:pointer; position:relative;
          box-shadow:0 3px 0 rgba(0,0,0,.35); touch-action:manipulation; }
        .pad small { position:absolute; bottom:6px; font-size:9.5px; opacity:.6; font-weight:700; }
        .pad.hit { filter:brightness(1.5); transform:translateY(2px); box-shadow:0 1px 0 rgba(0,0,0,.35); }

        .transport { display:flex; gap:8px; align-items:stretch; }
        .tbtn { flex:1; border:none; border-radius:14px; font-weight:800; font-size:15px; color:#fff;
          padding:14px 6px; cursor:pointer; background:#1b1c2e; border:1px solid #2b2c46; }
        .tbtn:active { transform:scale(.97); }
        .tbtn.play { background:linear-gradient(180deg,#37d67a,#25a85e); }
        .tbtn.rec  { background:linear-gradient(180deg,#ff5470,#d43757); flex:1.2; }
        .tbtn.rec.on { animation:blink 1s steps(2) infinite; }
        .tbtn.ghost { flex:.7; background:#15162a; color:#cdd; }

        .modal { position:absolute; inset:0; background:rgba(6,6,12,.86); display:none;
          align-items:center; justify-content:center; padding:22px; z-index:5; }
        .card { background:#14152a; border:1px solid #2b2c46; border-radius:16px; padding:18px 18px 16px;
          max-width:340px; width:100%; }
        .card h2 { font-size:17px; margin-bottom:8px; }
        .card ol { margin:0 0 12px 18px; padding:0; }
        .card li { font-size:13px; line-height:1.5; margin-bottom:5px; color:#cfd0e6; }
        .card .note { font-size:11.5px; color:#8a8ca6; line-height:1.45; margin-bottom:12px; }
        .card .ok { width:100%; padding:11px; border:none; border-radius:11px; font-weight:800;
          color:#0c0c16; background:linear-gradient(90deg,#ffb037,#ff5470); cursor:pointer; }
        .row { margin-bottom:14px; }
        .row .lbl { font-size:11px; font-weight:800; letter-spacing:.5px; color:#8a8ca6;
          text-transform:uppercase; margin-bottom:7px; }
        .seg { display:flex; flex-wrap:wrap; gap:6px; }
        .seg button { flex:0 0 auto; background:#1b1c2e; border:1px solid #2b2c46; color:#cdd;
          border-radius:9px; padding:8px 12px; font-size:13px; font-weight:700; cursor:pointer; }
        .seg button.on { background:#5b8cff22; border-color:#5b8cff; color:#fff; }
        .step { display:flex; align-items:center; gap:10px; }
        .step .val { min-width:82px; text-align:center; font-weight:800; font-size:15px;
          font-variant-numeric:tabular-nums; }
        .toast { position:absolute; left:50%; bottom:78px; transform:translateX(-50%);
          background:#14152a; border:1px solid #2b2c46; color:#eef; padding:8px 14px; border-radius:999px;
          font-size:12.5px; opacity:0; transition:opacity .2s; pointer-events:none; z-index:6; }
      </style>
      <div class="ll">
        <div class="hdr">
          <div class="logo">◉ LOOP LAB</div>
          <div class="spacer"></div>
          <div class="bpm">
            <button class="rnd" data-act="bpm-">–</button>
            <div class="bpmv"><b id="bpmVal">90</b> <small>bpm</small></div>
            <button class="rnd" data-act="bpm+">+</button>
          </div>
          <button class="chip" data-act="settings" id="keyBtn">A · Pent</button>
          <button class="chip" data-act="help">?</button>
        </div>

        <div class="timeline" id="timeline">
          <div class="grid" id="grid"></div>
          <div class="lanes" id="lanes"></div>
          <div class="playhead" id="playhead"></div>
          <div class="tlempty" id="tlempty">Pick an instrument, hit ● REC, and play. Your loop starts after a 1-bar count-in.</div>
          <div class="recbadge" id="recbadge"><i></i><span id="recTxt">REC</span></div>
        </div>

        <div class="tracks" id="tracks"></div>
        <div class="insts" id="insts"></div>
        <div class="pads" id="pads"></div>

        <div class="transport">
          <button class="tbtn ghost" data-act="metro" id="metroBtn">Metro</button>
          <button class="tbtn play" data-act="play" id="playBtn">▶ Play</button>
          <button class="tbtn rec" data-act="rec" id="recBtn">● REC</button>
          <button class="tbtn ghost" data-act="clear">Clear</button>
        </div>

        <div class="modal" id="modal">
          <div class="card">
            <h2>Loop Lab — live looper</h2>
            <ol>
              <li>Pick an instrument — swipe the row for more (Drums, Bass, Keys, Chord, Strings, Pluck, Lead, Bells, Marimba, Organ, Brass, Vox).</li>
              <li>Tap <b>● REC</b>. After a 1-bar count-in, play the pads for one loop.</li>
              <li>Your layer now loops. Tap <b>● REC</b> again to overdub another instrument on top.</li>
              <li>Stack layers to build a whole song. Tap a track to set its <b>volume</b> (or mute it), ✕ to delete.</li>
              <li><b>▶ Play / ■ Stop</b> runs everything. <b>Metro</b> toggles a click.</li>
              <li>Tap the <b>key chip</b> (top-right) for key, scale, loop length and swing.</li>
            </ol>
            <div class="note">All 12 instruments are synthesized live — no samples. Your song auto-saves on this device.</div>
            <button class="ok" data-act="close">Let's go</button>
          </div>
        </div>

        <div class="modal" id="setModal">
          <div class="card">
            <h2>Settings</h2>
            <div class="row">
              <div class="lbl">Loop length</div>
              <div class="seg" id="segBars">
                <button data-bars="1">1 bar</button>
                <button data-bars="2">2 bars</button>
                <button data-bars="4">4 bars</button>
              </div>
            </div>
            <div class="row">
              <div class="lbl">Key</div>
              <div class="step">
                <button class="rnd" data-act="root-">–</button>
                <div class="val" id="rootVal">A</div>
                <button class="rnd" data-act="root+">+</button>
              </div>
            </div>
            <div class="row">
              <div class="lbl">Scale</div>
              <div class="seg" id="segScale"></div>
            </div>
            <div class="row">
              <div class="lbl">Swing</div>
              <div class="step">
                <button class="rnd" data-act="swing-">–</button>
                <div class="val" id="swingVal">0%</div>
                <button class="rnd" data-act="swing+">+</button>
              </div>
            </div>
            <button class="ok" data-act="closeset">Done</button>
          </div>
        </div>
        <div class="toast" id="toast"></div>
      </div>`;

    const $ = (id) => root.querySelector("#" + id);
    const el = {
      bpmVal: $("bpmVal"), keyBtn: $("keyBtn"), grid: $("grid"), lanes: $("lanes"),
      playhead: $("playhead"), tlempty: $("tlempty"), recbadge: $("recbadge"), recTxt: $("recTxt"),
      tracks: $("tracks"), insts: $("insts"), pads: $("pads"), playBtn: $("playBtn"),
      recBtn: $("recBtn"), metroBtn: $("metroBtn"), modal: $("modal"), toast: $("toast"),
      setModal: $("setModal"), segBars: $("segBars"), segScale: $("segScale"),
      rootVal: $("rootVal"), swingVal: $("swingVal")
    };

    let toastTimer = null;
    function showToast(msg) {
      el.toast.textContent = msg; el.toast.style.opacity = "1";
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = ctx.timeout(() => { el.toast.style.opacity = "0"; }, 1600);
    }

    // -- renderers ------------------------------------------------------------
    function renderGrid() {
      const beats = state.bars * 4;
      let bg = "";
      for (let i = 0; i <= beats; i++) {
        const strong = i % 4 === 0;
        bg += `<div style="position:absolute;top:0;bottom:0;left:${(i / beats) * 100}%;width:1px;background:${strong ? "#2f3152" : "#1b1c2e"}"></div>`;
      }
      el.grid.innerHTML = bg;
    }

    function renderInsts() {
      el.insts.innerHTML = ORDER.map((k) => {
        const it = INSTRUMENTS[k];
        const on = state.instrument === k;
        const dim = state.lockInst && !on ? " dim" : "";
        const bg = on ? `background:${it.color}22;border-color:${it.color};` : "";
        const dotc = on ? `color:${it.color}` : "";
        return `<div class="inst${on ? " on" : ""}${dim}" data-inst="${k}" style="${bg}"><span style="${dotc}">${it.name}</span></div>`;
      }).join("");
    }

    function renderPads() {
      const inst = state.instrument;
      const spec = INSTRUMENTS[inst];
      if (spec.type === "drum") {
        el.pads.innerHTML = DRUMS.map((d) =>
          `<button class="pad" data-note="${d.id}" style="background:linear-gradient(180deg,${shade(spec.color, 18)},${spec.color})">${d.label}</button>`
        ).join("");
      } else {
        el.pads.innerHTML = scalePads(inst).map((p, i) =>
          `<button class="pad" data-note="${p.freq.toFixed(3)}" data-semi="${p.semi}" style="background:linear-gradient(180deg,${shade(spec.color, 18)},${shade(spec.color, -8 - i * 3)})">${p.label}<small>${i + 1}</small></button>`
        ).join("");
      }
    }

    function renderTracks() {
      const has = state.tracks.length > 0;
      el.tlempty.style.display = has ? "none" : "flex";
      // timeline lanes
      el.lanes.innerHTML = state.tracks.map((tr) => {
        const c = INSTRUMENTS[tr.inst].color;
        const spl = SPL();
        const vol = tr.vol == null ? 1 : tr.vol;
        const dots = vol <= 0 ? "" : tr.events.map((e) =>
          `<div class="dot" style="left:${((e.step + 0.5) / spl) * 100}%;color:${c};background:${c};opacity:${0.35 + 0.65 * vol}"></div>`
        ).join("");
        return `<div class="lane">${dots}</div>`;
      }).join("");
      // track chips (tap to change volume, ✕ to delete)
      el.tracks.innerHTML = state.tracks.map((tr, i) => {
        const it = INSTRUMENTS[tr.inst];
        const vol = tr.vol == null ? 1 : tr.vol;
        const rec = tr === state.recTrack ? " · rec" : "";
        const bars = [0.33, 0.66, 1].map((th, bi) =>
          `<i class="${vol >= th ? "on" : ""}" style="height:${5 + bi * 3}px"></i>`).join("");
        const lvl = vol <= 0
          ? `<span style="font-size:11px;color:#8a8ca6">muted</span>`
          : `<span class="lvl" style="color:${it.color}">${bars}</span>`;
        return `<div class="trk${vol <= 0 ? " muted" : ""}" data-tid="${tr.id}">
          <span class="sw" style="background:${it.color}"></span>${it.name} ${i + 1}${rec}
          ${lvl}<span class="x" data-del="${tr.id}">✕</span></div>`;
      }).join("");
    }

    function renderTransport() {
      el.playBtn.innerHTML = state.playing ? "■ Stop" : "▶ Play";
      el.playBtn.classList.toggle("play", true);
      el.recBtn.classList.toggle("on", state.armed || state.recording);
      el.recBtn.innerHTML = state.recording ? "● REC" : (state.armed ? "● …" : "● REC");
      el.metroBtn.style.color = state.metronome ? "#ffb037" : "";
      const showRec = state.armed || state.recording;
      el.recbadge.style.display = showRec ? "flex" : "none";
      el.recTxt.textContent = state.recording ? "RECORDING" : "COUNT-IN";
      // BPM is locked while playing (loop timing stays coherent)
      el.bpmVal.parentElement.style.opacity = state.playing ? ".4" : "1";
    }

    function renderSettings() {
      for (const b of el.segBars.querySelectorAll("button")) {
        b.classList.toggle("on", +b.dataset.bars === state.bars);
        b.style.opacity = state.playing ? ".4" : "1";
      }
      el.segScale.innerHTML = SCALE_ORDER.map((k) =>
        `<button data-scale="${k}" class="${state.scale === k ? "on" : ""}">${SCALES[k].name}</button>`
      ).join("");
      el.rootVal.textContent = NOTE_NAMES[state.root] + " " + (SCALES[state.scale].iv.includes(4) ? "maj" : "min");
      el.swingVal.textContent = Math.round(state.swing / 0.6 * 100) + "%";
    }

    function renderAll() {
      el.bpmVal.textContent = state.bpm;
      const scaleShort = { minPent: "Pent", majPent: "Pent+", minor: "min", major: "maj", dorian: "dor" };
      el.keyBtn.textContent = NOTE_NAMES[state.root] + " · " + (scaleShort[state.scale] || "");
      renderGrid(); renderInsts(); renderPads(); renderTracks(); renderTransport(); renderSettings();
    }

    // -- helpers --------------------------------------------------------------
    function shade(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
      r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    function flash(padEl) {
      if (!padEl) return;
      padEl.classList.add("hit");
      ctx.timeout(() => padEl.classList.remove("hit"), 90);
    }

    // -- input ----------------------------------------------------------------
    ctx.listen(el.pads, "pointerdown", (e) => {
      const pad = e.target.closest(".pad");
      if (!pad) return;
      e.preventDefault();
      const raw = pad.dataset.note;
      const inst = state.instrument;
      const note = INSTRUMENTS[inst].type === "drum" ? raw : parseFloat(raw);
      tap(inst, note);
      flash(pad);
    });

    ctx.listen(el.insts, "pointerdown", (e) => {
      const it = e.target.closest(".inst");
      if (!it || state.lockInst) return;
      state.instrument = it.dataset.inst;
      renderInsts(); renderPads();
    });

    ctx.listen(el.segBars, "click", (e) => {
      const b = e.target.closest("[data-bars]");
      if (!b || state.playing) return;                 // loop length is locked while playing
      state.bars = +b.dataset.bars;
      const spl = SPL();
      state.tracks.forEach((t) => { t.events = t.events.filter((ev) => ev.step < spl); });
      renderAll(); save(); ctx.platform.haptic("light");
    });

    ctx.listen(el.segScale, "click", (e) => {
      const b = e.target.closest("[data-scale]");
      if (!b) return;
      state.scale = b.dataset.scale;
      renderAll(); save(); ctx.platform.haptic("light");
    });

    ctx.listen(el.tracks, "click", (e) => {
      const del = e.target.closest(".x");
      if (del) {
        const id = +del.dataset.del;
        if (state.recTrack && state.recTrack.id === id) cancelRecording(false);
        state.tracks = state.tracks.filter((t) => t.id !== id);
        renderTracks(); save();
        ctx.platform.haptic("warning");
        return;
      }
      const chip = e.target.closest(".trk");
      if (!chip) return;
      const tr = state.tracks.find((t) => t.id === +chip.dataset.tid);
      if (tr) {
        // cycle volume: 100% -> 66% -> 33% -> mute -> 100%
        const cur = tr.vol == null ? 1 : tr.vol;
        let idx = VOLS.indexOf(cur);
        if (idx < 0) idx = 0;
        tr.vol = VOLS[(idx + 1) % VOLS.length];
        renderTracks(); save(); ctx.platform.haptic("light");
      }
    });

    ctx.listen(root, "click", (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "bpm-" && !state.playing) { state.bpm = Math.max(50, state.bpm - 5); el.bpmVal.textContent = state.bpm; save(); }
      else if (a === "bpm+" && !state.playing) { state.bpm = Math.min(180, state.bpm + 5); el.bpmVal.textContent = state.bpm; save(); }
      else if (a === "root-") { state.root = (state.root + 11) % 12; renderAll(); save(); ctx.platform.haptic("light"); }
      else if (a === "root+") { state.root = (state.root + 1) % 12; renderAll(); save(); ctx.platform.haptic("light"); }
      else if (a === "swing-") { state.swing = Math.max(0, +(state.swing - 0.1).toFixed(2)); renderSettings(); save(); }
      else if (a === "swing+") { state.swing = Math.min(0.6, +(state.swing + 0.1).toFixed(2)); renderSettings(); save(); }
      else if (a === "settings") el.setModal.style.display = "flex";
      else if (a === "closeset") el.setModal.style.display = "none";
      else if (a === "play") {
        if (state.playing) { stopTransport(); ctx.platform.milestone("stop"); }
        else { ensureAudio(); ctx.platform.start(); startTransport(); }
      }
      else if (a === "rec") toggleRecord();
      else if (a === "metro") { state.metronome = !state.metronome; renderTransport(); }
      else if (a === "clear") {
        if (state.tracks.length) {
          cancelRecording(true);
          state.tracks = []; renderAll(); save();
          ctx.platform.haptic("warning");
          showToast("Cleared");
        }
      }
      else if (a === "help") el.modal.style.display = "flex";
      else if (a === "close") {
        el.modal.style.display = "none";
        if (ctx.capabilities.storage) { try { ctx.storage.set("seen", 1); } catch (_) {} }
      }
    });

    // -- visual playhead loop -------------------------------------------------
    ctx.onFrame(() => {
      let frac = 0;
      if (ac && state.playing) {
        const loopLen = stepDur() * SPL();
        const rel = ac.currentTime - originTime;
        frac = ((rel % loopLen) + loopLen) % loopLen / loopLen;
        if (rel < 0) frac = 0;
      }
      el.playhead.style.transform = `translateX(${frac * (el.grid.clientWidth || ctx.width)}px)`;
      el.playhead.style.opacity = state.playing ? "1" : "0.25";
    });

    // Unlock audio on the very first touch anywhere (capture phase, before any
    // pad/transport handler), and re-resume whenever the bit returns to the
    // foreground — Plethora may suspend the context while backgrounded.
    ctx.listen(root, "pointerdown", () => unlockAudio(), { capture: true });
    ctx.listen(root, "touchstart", () => unlockAudio(), { capture: true, passive: true });
    try {
      ctx.listen(document, "visibilitychange", () => {
        if (!document.hidden && ac && ac.state !== "running") { try { ac.resume(); } catch (_) {} }
      });
    } catch (_) {}

    // -- boot -----------------------------------------------------------------
    // One persistent scheduler for the lifetime of the bit; it no-ops while
    // stopped and drives step playback + loop boundaries while playing.
    ctx.interval(schedulerTick, 25);

    load();
    renderAll();
    ctx.markVisualReady("ui-drawn");

    let firstRun = true;
    if (ctx.capabilities.storage) { try { firstRun = !ctx.storage.get("seen"); } catch (_) {} }
    if (firstRun) el.modal.style.display = "flex";

    if (audioBlocked || !(window.AudioContext || window.webkitAudioContext)) {
      showToast("Tip: turn up your volume to hear the loops");
    }

    ctx.platform.ready();
  }
};
