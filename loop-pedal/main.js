/**
 * Loop Pedal — a mobile-first live looper Plethora Bit.
 *
 * Build a song the way a loop pedal does: arm REC, play the on-screen pads in
 * time, lock the layer, then stack another instrument on top. Everything is
 * synthesised live with the Web Audio API and scheduled with a look-ahead clock
 * so the loops stay tight.
 *
 * Note on voice: the Plethora sandbox microphone exposes analysis data only and
 * cannot record/loop raw audio, so the "Vox" instrument is a synthesised vocal
 * pad you play like any other layer.
 */
window.plethoraBit = {
  meta: {
    title: "Loop Pedal",
    runtime: "plethora-bit@2",
    tags: ["music", "loop", "beats", "creative", "toy"],
    permissions: ["audio", "haptics"]
  },

  async init(ctx) {
    // ---- Config -----------------------------------------------------------
    const LOOP_BEATS = 8;                 // length of one loop, in beats
    const SUBDIV = 4;                     // 16th-note grid (steps per beat)
    const STEPS = LOOP_BEATS * SUBDIV;    // quantise grid resolution
    const LOOKAHEAD_MS = 25;              // scheduler tick
    const SCHEDULE_AHEAD = 0.14;          // seconds of audio scheduled in front
    const TRACK_COLORS = [
      "#ff5d73", "#ffd166", "#06d6a0", "#4cc9f0",
      "#c77dff", "#f9844a", "#43e97b", "#ff8fab"
    ];

    // A-minor pentatonic across a couple of octaves.
    const NOTES = {
      bass:   [{ n: "A",  f: 110.00 }, { n: "C",  f: 130.81 }, { n: "D",  f: 146.83 }, { n: "E",  f: 164.81 }, { n: "G",  f: 196.00 }, { n: "A", f: 220.00 }],
      key:    [{ n: "A",  f: 220.00 }, { n: "C",  f: 261.63 }, { n: "D",  f: 293.66 }, { n: "E",  f: 329.63 }, { n: "G",  f: 392.00 }, { n: "A", f: 440.00 }],
      string: [{ n: "A",  f: 220.00 }, { n: "C",  f: 261.63 }, { n: "D",  f: 293.66 }, { n: "E",  f: 329.63 }, { n: "G",  f: 392.00 }, { n: "A", f: 440.00 }],
      vox:    [{ n: "A",  f: 220.00 }, { n: "C",  f: 261.63 }, { n: "D",  f: 293.66 }, { n: "E",  f: 329.63 }, { n: "G",  f: 392.00 }, { n: "A", f: 440.00 }]
    };

    const INSTRUMENTS = [
      { id: "drums",  label: "Drums",   accent: "#ff5d73",
        pads: [{ label: "Kick", type: "kick" }, { label: "Snare", type: "snare" },
               { label: "Hat", type: "hat" }, { label: "Clap", type: "clap" }] },
      { id: "bass",   label: "Bass",    accent: "#4cc9f0", pads: NOTES.bass.map(x => ({ label: x.n, type: "bass", freq: x.f })) },
      { id: "key",    label: "Keys",    accent: "#ffd166", pads: NOTES.key.map(x => ({ label: x.n, type: "key", freq: x.f })) },
      { id: "string", label: "Strings", accent: "#c77dff", pads: NOTES.string.map(x => ({ label: x.n, type: "string", freq: x.f })) },
      { id: "vox",    label: "Vox",     accent: "#06d6a0", pads: NOTES.vox.map(x => ({ label: x.n, type: "vox", freq: x.f })) }
    ];

    // ---- State ------------------------------------------------------------
    let bpm = 96;
    let loopDur = () => (60 / bpm) * LOOP_BEATS;
    let playing = false;
    let armed = false;
    let metroOn = true;
    let quantOn = true;
    let selectedInst = "drums";
    let loopStart = 0;        // audio-time of the current loop iteration's start
    let nextLoopStart = 0;    // audio-time we've scheduled up to
    let colorIdx = 0;

    /** tracks: { id, inst, color, muted, live, events:[{phase,type,freq}] } */
    const tracks = [];
    let recTrack = null;
    let scheduled = [];       // future-scheduled source nodes we may cancel

    // ---- Audio engine -----------------------------------------------------
    let audio = null, master = null, noiseBuf = null, audioOk = true;

    function ensureAudio() {
      if (audio) { if (audio.state === "suspended") audio.resume(); return audioOk; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioOk = false; return false; }
      try {
        audio = new AC();
        master = audio.createGain();
        master.gain.value = 0.85;
        const comp = audio.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 3; comp.release.value = 0.25;
        master.connect(comp).connect(audio.destination);
        // one second of white noise for the percussion voices
        noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        if (audio.state === "suspended") audio.resume();
      } catch (e) { audioOk = false; }
      return audioOk;
    }

    function noiseSource() { const s = audio.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }
    function track(node, t) { scheduled.push({ node, t }); }
    function stopFuture() {
      const now = audio.currentTime + 0.02;
      scheduled = scheduled.filter(s => {
        if (s.t > now) { try { s.node.stop(); } catch (e) {} return false; }
        return s.t > now - 4; // drop stale refs
      });
    }

    // --- individual voices (schedule a one-shot at audio-time t) ---
    function vKick(t) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.0, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.42); track(o, t);
    }
    function vSnare(t) {
      const n = noiseSource(), bp = audio.createBiquadFilter(), g = audio.createGain();
      bp.type = "bandpass"; bp.frequency.value = 1750; bp.Q.value = 0.9;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.7, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      n.connect(bp).connect(g).connect(master); n.start(t); n.stop(t + 0.22); track(n, t);
      const o = audio.createOscillator(), g2 = audio.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(190, t);
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.4, t + 0.004);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g2).connect(master); o.start(t); o.stop(t + 0.14); track(o, t);
    }
    function vHat(t) {
      const n = noiseSource(), hp = audio.createBiquadFilter(), g = audio.createGain();
      hp.type = "highpass"; hp.frequency.value = 7200;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      n.connect(hp).connect(g).connect(master); n.start(t); n.stop(t + 0.06); track(n, t);
    }
    function vClap(t) {
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.012;
        const n = noiseSource(), bp = audio.createBiquadFilter(), g = audio.createGain();
        bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 1.2;
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(0.5, tt + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1);
        n.connect(bp).connect(g).connect(master); n.start(tt); n.stop(tt + 0.12); track(n, tt);
      }
    }
    function vBass(t, freq) {
      const o = audio.createOscillator(), sub = audio.createOscillator();
      const lp = audio.createBiquadFilter(), g = audio.createGain();
      o.type = "sawtooth"; o.frequency.value = freq;
      sub.type = "sine"; sub.frequency.value = freq / 2;
      lp.type = "lowpass"; lp.frequency.setValueAtTime(freq * 6, t);
      lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.25);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(lp); sub.connect(lp); lp.connect(g).connect(master);
      o.start(t); sub.start(t); o.stop(t + 0.44); sub.stop(t + 0.44); track(o, t); track(sub, t);
    }
    function vKey(t, freq) {
      const a = audio.createOscillator(), b = audio.createOscillator();
      const lp = audio.createBiquadFilter(), g = audio.createGain();
      a.type = "sawtooth"; a.frequency.value = freq;
      b.type = "square"; b.frequency.value = freq * 1.005;
      lp.type = "lowpass"; lp.frequency.value = 3200;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.34, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      a.connect(lp); b.connect(lp); lp.connect(g).connect(master);
      a.start(t); b.start(t); a.stop(t + 0.48); b.stop(t + 0.48); track(a, t); track(b, t);
    }
    function vString(t, freq) {
      const a = audio.createOscillator(), b = audio.createOscillator();
      const lp = audio.createBiquadFilter(), g = audio.createGain();
      a.type = "sawtooth"; a.frequency.value = freq * 0.997;
      b.type = "sawtooth"; b.frequency.value = freq * 1.003;
      lp.type = "lowpass"; lp.frequency.value = 2400;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.14);
      g.gain.setValueAtTime(0.28, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      a.connect(lp); b.connect(lp); lp.connect(g).connect(master);
      a.start(t); b.start(t); a.stop(t + 1.34); b.stop(t + 1.34); track(a, t); track(b, t);
    }
    function vVox(t, freq) {
      const o = audio.createOscillator(), g = audio.createGain();
      const f1 = audio.createBiquadFilter(), f2 = audio.createBiquadFilter();
      const lfo = audio.createOscillator(), lfoG = audio.createGain();
      o.type = "sawtooth"; o.frequency.value = freq;
      lfo.type = "sine"; lfo.frequency.value = 5.5; lfoG.gain.value = freq * 0.01;
      lfo.connect(lfoG).connect(o.frequency);
      f1.type = "bandpass"; f1.frequency.value = 720; f1.Q.value = 7;
      f2.type = "bandpass"; f2.frequency.value = 1150; f2.Q.value = 7;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.08);
      g.gain.setValueAtTime(0.5, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(master);
      o.start(t); lfo.start(t); o.stop(t + 0.94); lfo.stop(t + 0.94); track(o, t); track(lfo, t);
    }
    function vClick(t, accent) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "square"; o.frequency.value = accent ? 1600 : 1000;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.12, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.05); track(o, t);
    }

    function playVoice(type, freq, t) {
      switch (type) {
        case "kick": return vKick(t);
        case "snare": return vSnare(t);
        case "hat": return vHat(t);
        case "clap": return vClap(t);
        case "bass": return vBass(t, freq);
        case "key": return vKey(t, freq);
        case "string": return vString(t, freq);
        case "vox": return vVox(t, freq);
      }
    }

    // ---- Transport / scheduler -------------------------------------------
    function currentPhase() {
      if (!playing || !audio) return 0;
      let p = (audio.currentTime - loopStart) / loopDur();
      p -= Math.floor(p);
      return p;
    }

    function scheduleIteration(startT) {
      const dur = loopDur();
      const now = audio.currentTime;
      for (const tr of tracks) {
        if (tr.muted) continue;
        for (const ev of tr.events) {
          const t = startT + ev.phase * dur;
          if (t > now + 0.004) playVoice(ev.type, ev.freq, t);
        }
      }
      if (metroOn) {
        for (let b = 0; b < LOOP_BEATS; b++) {
          const t = startT + (b / LOOP_BEATS) * dur;
          if (t > now + 0.004) vClick(t, b % 4 === 0);
        }
      }
    }

    function schedulerTick() {
      if (!playing || !audio) return;
      const dur = loopDur();
      while (nextLoopStart < audio.currentTime + SCHEDULE_AHEAD) {
        scheduleIteration(nextLoopStart);
        nextLoopStart += dur;
      }
    }

    function startTransport() {
      if (!ensureAudio()) { showFatal(); return; }
      if (playing) return;
      loopStart = audio.currentTime + 0.06;
      nextLoopStart = loopStart;
      playing = true;
      setStatus();
    }
    function stopTransport() {
      playing = false;
      if (armed) toggleRec(false);
      stopFuture();
      setStatus();
    }

    // ---- Recording --------------------------------------------------------
    function toggleRec(force) {
      const next = force === undefined ? !armed : force;
      if (next === armed) return;
      armed = next;
      if (armed) {
        startTransport();
        recTrack = { id: "t" + colorIdx, inst: selectedInst, color: TRACK_COLORS[colorIdx % TRACK_COLORS.length], muted: false, live: true, events: [] };
        colorIdx++;
        tracks.push(recTrack);
        ctx.platform.haptic("warning");
        ctx.platform.emit("rec_arm");
      } else {
        if (recTrack && recTrack.events.length === 0) {
          const i = tracks.indexOf(recTrack); if (i >= 0) tracks.splice(i, 1);
        } else if (recTrack) {
          recTrack.live = false;
          ctx.platform.milestone("layer_locked", { layers: lockedCount() });
          ctx.platform.haptic("success");
        }
        recTrack = null;
      }
      renderTracks(); renderRing(); setStatus(); syncButtons();
    }

    function hit(type, freq) {
      if (!ensureAudio()) { showFatal(); return; }
      ctx.platform.start();
      playVoice(type, freq, audio.currentTime + 0.005);   // live monitor
      if (armed && playing && recTrack) {
        let p = currentPhase();
        if (quantOn) { p = Math.round(p * STEPS) / STEPS; if (p >= 1) p -= 1; }
        recTrack.events.push({ phase: p, type, freq });
        renderRing();
      }
      ctx.platform.interact({ type: "pad", inst: selectedInst });
    }

    function lockedCount() { return tracks.filter(t => !t.live).length; }

    function undoLast() {
      // remove the most recent locked (or the live rec) track
      for (let i = tracks.length - 1; i >= 0; i--) {
        if (tracks[i] === recTrack) continue;
        tracks.splice(i, 1);
        ctx.platform.haptic("light");
        renderTracks(); renderRing(); setStatus();
        return;
      }
      if (recTrack) toggleRec(false);
    }
    function clearAll() {
      tracks.length = 0; recTrack = null; armed = false;
      stopTransport();
      ctx.platform.haptic("heavy");
      renderTracks(); renderRing(); setStatus(); syncButtons();
    }

    // ---- UI ---------------------------------------------------------------
    const root = ctx.createRoot({ touchAction: "none" });
    const SB = ctx.safeArea;
    root.innerHTML = `
      <style>
        .lp { position:absolute; inset:0; display:flex; flex-direction:column;
              font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
              color:#eef1f7; background:radial-gradient(120% 90% at 50% 0%, #1b2340 0%, #0d1020 55%, #070811 100%);
              padding: ${8 + SB.top}px 12px ${12 + SB.bottom}px; box-sizing:border-box; overflow:hidden; user-select:none; -webkit-user-select:none; }
        .lp * { box-sizing:border-box; }
        .lp-head { display:flex; align-items:center; gap:10px; }
        .lp-logo { font-weight:800; letter-spacing:.14em; font-size:15px; color:#cdd6ff; text-transform:uppercase; }
        .lp-logo b { color:#ff5d73; }
        .lp-spacer { flex:1; }
        .lp-bpm { display:flex; align-items:center; gap:6px; background:#ffffff10; border:1px solid #ffffff18; border-radius:999px; padding:3px 4px; }
        .lp-bpm button { width:30px; height:30px; border-radius:50%; border:none; background:#ffffff16; color:#fff; font-size:18px; font-weight:700; line-height:1; }
        .lp-bpm .v { min-width:58px; text-align:center; font-variant-numeric:tabular-nums; font-weight:700; font-size:13px; }
        .lp-bpm .v small { display:block; font-size:8px; letter-spacing:.16em; color:#9aa4c8; font-weight:600; }
        .lp-help { width:32px; height:32px; border-radius:50%; border:1px solid #ffffff22; background:#ffffff10; color:#cdd6ff; font-weight:800; font-size:15px; }
        .lp-ring { flex:0 0 auto; display:flex; justify-content:center; align-items:center; margin:2px 0; }
        .lp-ring svg { width:min(46vw, 190px); height:min(46vw, 190px); }
        .lp-tracks { min-height:26px; display:flex; gap:6px; overflow-x:auto; padding:2px 0; scrollbar-width:none; }
        .lp-tracks::-webkit-scrollbar { display:none; }
        .lp-chip { flex:0 0 auto; display:flex; align-items:center; gap:5px; padding:5px 9px; border-radius:999px;
                   background:#ffffff12; border:1px solid #ffffff18; font-size:11px; font-weight:700; }
        .lp-chip .dot { width:9px; height:9px; border-radius:50%; }
        .lp-chip.muted { opacity:.4; }
        .lp-chip.live { animation:lp-pulse 1s infinite; }
        .lp-empty { color:#7a83a8; font-size:11px; align-self:center; padding:5px 2px; }
        .lp-tabs { display:flex; gap:6px; margin-top:6px; }
        .lp-tab { flex:1; padding:8px 2px; border-radius:12px; border:1px solid #ffffff14; background:#ffffff0d;
                  color:#c4cbe6; font-size:12px; font-weight:700; }
        .lp-tab.on { color:#0a0d18; }
        .lp-pads { flex:1; display:grid; gap:8px; margin-top:8px; min-height:120px; }
        .lp-pad { border:none; border-radius:16px; color:#0a0d18; font-weight:800; font-size:15px;
                  background:linear-gradient(180deg,#ffffff,#e7ecff); box-shadow:0 6px 0 #00000040, inset 0 1px 0 #ffffffaa;
                  transition:transform .04s, box-shadow .04s, filter .08s; touch-action:none; }
        .lp-pad small { display:block; font-size:9px; font-weight:700; opacity:.55; letter-spacing:.1em; }
        .lp-pad.down { transform:translateY(4px); box-shadow:0 2px 0 #00000040, inset 0 1px 0 #ffffffaa; filter:brightness(1.08); }
        .lp-transport { display:flex; gap:8px; margin-top:10px; align-items:stretch; }
        .lp-t { flex:1; border:none; border-radius:14px; padding:12px 4px; font-weight:800; font-size:13px;
                background:#ffffff12; border:1px solid #ffffff1a; color:#eef1f7; display:flex; flex-direction:column; align-items:center; gap:3px; }
        .lp-t .ico { font-size:17px; line-height:1; }
        .lp-t.rec { background:#ff5d7322; border-color:#ff5d7355; color:#ffb3bf; }
        .lp-t.rec.on { background:#ff2d4d; border-color:#ff2d4d; color:#fff; animation:lp-pulse 1s infinite; }
        .lp-t.play.on { background:#06d6a0; border-color:#06d6a0; color:#04201a; }
        .lp-toggles { display:flex; gap:8px; margin-top:8px; }
        .lp-tg { flex:1; border-radius:999px; border:1px solid #ffffff18; background:#ffffff0d; color:#9aa4c8;
                 font-size:11px; font-weight:700; padding:7px 4px; }
        .lp-tg.on { background:#4cc9f022; border-color:#4cc9f055; color:#bfe9ff; }
        .lp-overlay { position:absolute; inset:0; background:#070811ee; backdrop-filter:blur(4px); z-index:9;
                      display:none; flex-direction:column; padding:${24 + SB.top}px 22px ${24 + SB.bottom}px; overflow:auto; }
        .lp-overlay.show { display:flex; }
        .lp-overlay h2 { margin:0 0 12px; font-size:18px; }
        .lp-overlay ol { margin:0; padding-left:20px; line-height:1.55; font-size:13px; color:#d3d9f0; }
        .lp-overlay ol b { color:#ffd166; }
        .lp-overlay .note { margin-top:14px; font-size:11.5px; color:#8f98bd; line-height:1.5; }
        .lp-overlay .close { margin-top:auto; align-self:center; margin-top:18px; padding:11px 26px; border-radius:999px;
                             border:none; background:#4cc9f0; color:#04202b; font-weight:800; font-size:14px; }
        .lp-fatal { position:absolute; inset:0; display:none; align-items:center; justify-content:center; text-align:center;
                    padding:30px; color:#c4cbe6; font-size:14px; line-height:1.5; background:#0d1020; z-index:20; }
        @keyframes lp-pulse { 0%,100%{opacity:1;} 50%{opacity:.45;} }
      </style>
      <div class="lp">
        <div class="lp-head">
          <div class="lp-logo"><b>&#9679;</b> Loop&nbsp;Pedal</div>
          <div class="lp-spacer"></div>
          <div class="lp-bpm">
            <button data-act="bpm-" aria-label="slower">&minus;</button>
            <div class="v"><span id="lp-bpm">96</span><small>BPM</small></div>
            <button data-act="bpm+" aria-label="faster">+</button>
          </div>
          <button class="lp-help" data-act="help" aria-label="how to play">?</button>
        </div>

        <div class="lp-ring" id="lp-ring"></div>
        <div class="lp-tracks" id="lp-tracks"></div>
        <div class="lp-tabs" id="lp-tabs"></div>
        <div class="lp-pads" id="lp-pads"></div>

        <div class="lp-transport">
          <button class="lp-t rec" data-act="rec"><span class="ico">&#9679;</span><span>REC</span></button>
          <button class="lp-t play" data-act="play"><span class="ico">&#9654;</span><span id="lp-playlbl">PLAY</span></button>
          <button class="lp-t" data-act="undo"><span class="ico">&#8634;</span><span>UNDO</span></button>
        </div>
        <div class="lp-toggles">
          <button class="lp-tg on" data-act="metro">&#9834; Click</button>
          <button class="lp-tg on" data-act="quant">&#9636; Quantize</button>
          <button class="lp-tg" data-act="clear">&#128465; Clear all</button>
        </div>
      </div>

      <div class="lp-overlay" id="lp-overlay">
        <h2>How to loop</h2>
        <ol>
          <li>Pick an instrument tab, then tap <b>REC</b> and play the pads in time.</li>
          <li>Tap <b>REC</b> again to <b>lock the layer</b> &mdash; it now loops on its own.</li>
          <li>Switch instrument, hit <b>REC</b> again, and <b>stack another layer</b> on top.</li>
          <li>The sweeping line on the ring is your guide; the <b>Click</b> keeps you in time.</li>
          <li><b>Undo</b> removes the last layer. <b>Clear all</b> starts over. <b>&plusmn; BPM</b> sets the tempo.</li>
        </ol>
        <div class="note">Heads-up: the sandbox mic can&rsquo;t record raw audio, so <b>Vox</b> is a synthesised vocal pad you play like the other instruments &mdash; no microphone needed.</div>
        <button class="close" data-act="close">Got it</button>
      </div>
      <div class="lp-fatal" id="lp-fatal">Audio isn&rsquo;t available in this environment, so the loop pedal can&rsquo;t make sound here. Try opening this bit in the Plethora app.</div>
    `;

    const $ = sel => root.querySelector(sel);
    const bpmLabel = $("#lp-bpm");
    const playLbl = $("#lp-playlbl");
    const tabsEl = $("#lp-tabs");
    const padsEl = $("#lp-pads");
    const tracksEl = $("#lp-tracks");
    const overlay = $("#lp-overlay");

    // --- tabs ---
    function renderTabs() {
      tabsEl.innerHTML = "";
      for (const inst of INSTRUMENTS) {
        const b = document.createElement("button");
        b.className = "lp-tab" + (inst.id === selectedInst ? " on" : "");
        b.textContent = inst.label;
        if (inst.id === selectedInst) b.style.background = inst.accent;
        ctx.listen(b, "pointerdown", e => { e.preventDefault(); selectInst(inst.id); }, { passive: false });
        tabsEl.appendChild(b);
      }
    }
    function selectInst(id) {
      selectedInst = id;
      renderTabs(); renderPads();
      ctx.platform.haptic("light");
    }

    // --- pads ---
    function renderPads() {
      const inst = INSTRUMENTS.find(i => i.id === selectedInst);
      padsEl.innerHTML = "";
      const n = inst.pads.length;
      padsEl.style.gridTemplateColumns = n <= 4 ? "1fr 1fr" : "1fr 1fr 1fr";
      for (const p of inst.pads) {
        const b = document.createElement("button");
        b.className = "lp-pad";
        b.innerHTML = p.freq ? `${p.label}<small>${inst.label.toUpperCase()}</small>` : `${p.label}`;
        b.style.background = `linear-gradient(180deg, #ffffff, ${inst.accent})`;
        const press = e => {
          e.preventDefault();
          b.classList.add("down");
          hit(p.type, p.freq);
          ctx.platform.haptic("light");
        };
        const release = () => b.classList.remove("down");
        ctx.listen(b, "pointerdown", press, { passive: false });
        ctx.listen(b, "pointerup", release);
        ctx.listen(b, "pointercancel", release);
        ctx.listen(b, "pointerleave", release);
        padsEl.appendChild(b);
      }
    }

    // --- track chips ---
    function renderTracks() {
      tracksEl.innerHTML = "";
      if (tracks.length === 0) {
        const e = document.createElement("div");
        e.className = "lp-empty";
        e.textContent = "No layers yet — tap REC to start";
        tracksEl.appendChild(e);
        return;
      }
      tracks.forEach((tr, i) => {
        const inst = INSTRUMENTS.find(x => x.id === tr.inst);
        const c = document.createElement("div");
        c.className = "lp-chip" + (tr.muted ? " muted" : "") + (tr.live ? " live" : "");
        c.innerHTML = `<span class="dot" style="background:${tr.color}"></span>${inst.label}`;
        ctx.listen(c, "pointerdown", e => {
          e.preventDefault();
          if (tr.live) return;
          tr.muted = !tr.muted;
          renderTracks(); renderRing();
          ctx.platform.haptic("light");
        }, { passive: false });
        tracksEl.appendChild(c);
      });
    }

    // --- ring (SVG) ---
    const SVGNS = "http://www.w3.org/2000/svg";
    let playheadEl = null, centerCountEl = null, centerStatusEl = null;
    const CX = 60, CY = 60, R_OUT = 54;

    function polar(phase, r) {
      const a = phase * Math.PI * 2 - Math.PI / 2;
      return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
    }
    function renderRing() {
      const ringHost = $("#lp-ring");
      ringHost.innerHTML = "";
      const svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("viewBox", "0 0 120 120");

      // base circle
      const base = document.createElementNS(SVGNS, "circle");
      base.setAttribute("cx", CX); base.setAttribute("cy", CY); base.setAttribute("r", R_OUT);
      base.setAttribute("fill", "none"); base.setAttribute("stroke", "#ffffff14"); base.setAttribute("stroke-width", "2");
      svg.appendChild(base);

      // beat ticks
      for (let b = 0; b < LOOP_BEATS; b++) {
        const [x1, y1] = polar(b / LOOP_BEATS, R_OUT - 4);
        const [x2, y2] = polar(b / LOOP_BEATS, R_OUT + 3);
        const tick = document.createElementNS(SVGNS, "line");
        tick.setAttribute("x1", x1); tick.setAttribute("y1", y1);
        tick.setAttribute("x2", x2); tick.setAttribute("y2", y2);
        tick.setAttribute("stroke", b % 4 === 0 ? "#ffffff55" : "#ffffff22");
        tick.setAttribute("stroke-width", b % 4 === 0 ? "2" : "1");
        svg.appendChild(tick);
      }

      // per-track rings of event dots
      const shown = tracks.slice(-9);
      shown.forEach((tr, idx) => {
        const r = R_OUT - 8 - idx * 4.4;
        if (r < 12) return;
        const guide = document.createElementNS(SVGNS, "circle");
        guide.setAttribute("cx", CX); guide.setAttribute("cy", CY); guide.setAttribute("r", r);
        guide.setAttribute("fill", "none");
        guide.setAttribute("stroke", tr.muted ? "#ffffff0e" : tr.color + "33");
        guide.setAttribute("stroke-width", "1");
        svg.appendChild(guide);
        for (const ev of tr.events) {
          const [x, y] = polar(ev.phase, r);
          const dot = document.createElementNS(SVGNS, "circle");
          dot.setAttribute("cx", x); dot.setAttribute("cy", y);
          dot.setAttribute("r", tr.live ? "2.6" : "2.2");
          dot.setAttribute("fill", tr.muted ? "#ffffff2a" : tr.color);
          svg.appendChild(dot);
        }
      });

      // playhead
      playheadEl = document.createElementNS(SVGNS, "line");
      playheadEl.setAttribute("x1", CX); playheadEl.setAttribute("y1", CY);
      const [hx, hy] = polar(0, R_OUT + 2);
      playheadEl.setAttribute("x2", hx); playheadEl.setAttribute("y2", hy);
      playheadEl.setAttribute("stroke", "#ffffff"); playheadEl.setAttribute("stroke-width", "1.6");
      playheadEl.setAttribute("stroke-linecap", "round");
      svg.appendChild(playheadEl);

      // center readout
      centerCountEl = document.createElementNS(SVGNS, "text");
      centerCountEl.setAttribute("x", CX); centerCountEl.setAttribute("y", CY + 2);
      centerCountEl.setAttribute("text-anchor", "middle"); centerCountEl.setAttribute("fill", "#eef1f7");
      centerCountEl.setAttribute("font-size", "20"); centerCountEl.setAttribute("font-weight", "800");
      svg.appendChild(centerCountEl);
      centerStatusEl = document.createElementNS(SVGNS, "text");
      centerStatusEl.setAttribute("x", CX); centerStatusEl.setAttribute("y", CY + 14);
      centerStatusEl.setAttribute("text-anchor", "middle"); centerStatusEl.setAttribute("fill", "#9aa4c8");
      centerStatusEl.setAttribute("font-size", "6.5"); centerStatusEl.setAttribute("letter-spacing", "1.5");
      svg.appendChild(centerStatusEl);

      ringHost.appendChild(svg);
      setStatus();
    }

    function setStatus() {
      if (centerCountEl) {
        const n = lockedCount();
        centerCountEl.textContent = String(n);
        let s = "LAYERS";
        if (armed) s = "REC";
        else if (playing) s = "PLAYING";
        else if (n === 0) s = "TAP REC";
        if (centerStatusEl) {
          centerStatusEl.textContent = s;
          centerStatusEl.setAttribute("fill", armed ? "#ff5d73" : playing ? "#06d6a0" : "#9aa4c8");
        }
      }
    }

    // --- frame: rotate playhead ---
    ctx.onFrame(() => {
      if (!playheadEl) return;
      const p = currentPhase();
      playheadEl.setAttribute("transform", `rotate(${p * 360} ${CX} ${CY})`);
      playheadEl.setAttribute("opacity", playing ? "1" : "0.25");
    });

    // --- buttons ---
    function syncButtons() {
      const rec = $('[data-act="rec"]');
      const play = $('[data-act="play"]');
      rec.classList.toggle("on", armed);
      play.classList.toggle("on", playing);
      playLbl.textContent = playing ? "STOP" : "PLAY";
      $('[data-act="metro"]').classList.toggle("on", metroOn);
      $('[data-act="quant"]').classList.toggle("on", quantOn);
    }

    function showFatal() { $("#lp-fatal").style.display = "flex"; }

    // clear-all long-press support on the Clear button
    let clearTimer = null;

    ctx.listen(root, "pointerdown", e => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      const act = el.dataset.act;
      if (act === "rec" || act === "play" || act === "undo" || act === "bpm+" || act === "bpm-" ||
          act === "help" || act === "close" || act === "metro" || act === "quant" || act === "clear") {
        e.preventDefault();
      }
      switch (act) {
        case "rec": toggleRec(); break;
        case "play": playing ? stopTransport() : startTransport(); syncButtons(); break;
        case "undo": undoLast(); break;
        case "clear": clearAll(); break;
        case "bpm+": setBpm(bpm + 2); break;
        case "bpm-": setBpm(bpm - 2); break;
        case "metro": metroOn = !metroOn; syncButtons(); ctx.platform.haptic("light"); break;
        case "quant": quantOn = !quantOn; syncButtons(); ctx.platform.haptic("light"); break;
        case "help": overlay.classList.add("show"); break;
        case "close": overlay.classList.remove("show"); break;
      }
    }, { passive: false });

    function setBpm(v) {
      v = Math.max(60, Math.min(160, v));
      if (v === bpm) return;
      const phase = currentPhase();     // keep the playhead continuous
      bpm = v;
      bpmLabel.textContent = String(bpm);
      if (playing && audio) {
        stopFuture();
        loopStart = audio.currentTime - phase * loopDur();
        nextLoopStart = loopStart;
        while (nextLoopStart < audio.currentTime) nextLoopStart += loopDur();
      }
      ctx.platform.haptic("light");
    }

    // ---- boot -------------------------------------------------------------
    renderTabs();
    renderPads();
    renderTracks();
    renderRing();
    syncButtons();
    setStatus();

    // scheduler clock (cleanup-owned)
    ctx.interval(schedulerTick, LOOKAHEAD_MS);

    ctx.onDestroy(() => { try { if (audio) audio.close(); } catch (e) {} });

    ctx.markVisualReady("ui");
    ctx.platform.ready();
  }
};
