/**
 * WaveFlow XY Synth — one finger, twenty-five voices.
 *
 * A performance pad rather than a keyboard. Put a finger down and it sounds;
 * where the finger sits decides what you hear. Up the screen is pitch, an
 * exponential sweep from A1 to A6 so the whole range is playable with one
 * thumb. Across is timbre, and what "timbre" means depends on the voice: on
 * Analog it opens a resonant lowpass, on Digital FM it drives the modulation
 * index, on Static Noise it sweeps a bandpass through the hiss. Twenty-five
 * voices, each a small hand-built Web Audio graph — oscillators, filters,
 * LFOs, a waveshaper for the distorted one — with its own mapping of the pad.
 *
 * Nothing is sampled. Every sound is synthesised live, so the oscilloscope
 * drawn across the pad is the real output: an analyser tapped off the master
 * bus, windowed at the edges so the trace sits inside the frame. When nothing
 * is playing it settles into a slow ripple instead of a flat line.
 *
 * The strip at the bottom shifts the whole instrument two octaves either way,
 * live, while a note is held.
 *
 * Ported from a standalone build of the same instrument. The synthesis, the
 * pad mapping and the scope are the original's; the shell around them was
 * rebuilt for plethora-bit@2 — no CDN, no packaged assets, Plethora-owned DOM
 * and frame loop. Icon geometry is lucide (ISC licence), inlined as SVG.
 */
window.plethoraBit = {
  meta: {
    title: "WaveFlow XY Synth",
    runtime: "plethora-bit@2",
    tags: ["music", "audio", "creative", "instrument", "toy"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Look                                                               //
    // ===================================================================== //
    const ACCENT = "#6366f1";
    const PAD_BG = "#000000";
    const RAIL_BG = "#09090b";
    const EDGE = "#1c1c20";
    const BTN_BG = "#18181b";
    const BTN_EDGE = "#27272a";
    const ICON = "#a1a1aa";
    const DIM = "#71717a";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

    const RAIL_W = 56;      // preset rail down the right
    const BAR_H = 46;       // octave strip along the bottom

    // lucide icon geometry, inlined — a bit cannot pull a 424 KB script off a CDN.
    const ICONS = {
      "activity": '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
      "radio": '<path d="M16.247 7.761a6 6 0 0 1 0 8.478"/><path d="M19.075 4.933a10 10 0 0 1 0 14.134"/><path d="M4.925 19.067a10 10 0 0 1 0-14.134"/><path d="M7.753 16.239a6 6 0 0 1 0-8.478"/><circle cx="12" cy="12" r="2"/>',
      "gamepad-2": '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
      "cpu": '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
      "audio-waveform": '<path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/>',
      "zap": '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>',
      "infinity": '<path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8"/>',
      "wind": '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
      "gem": '<path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/>',
      "music": '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
      "flame": '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
      "sparkles": '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
      "bell": '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
      "layers": '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
      "zap-off": '<path d="M10.768 5.111 13.44 2.44a1.5 1.5 0 012.474 1.561l-1.633 4.625"/><path d="m18.889 13.232.672-.672A1.5 1.5 0 0018.5 10h-2.844"/><path d="m2 2 20 20"/><path d="m7.94 7.94-3.5 3.499A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l5.5-5.5"/>',
      "waves": '<path d="M2 12q2.5 2 5 0t5 0 5 0 5 0"/><path d="M2 19q2.5 2 5 0t5 0 5 0 5 0"/><path d="M2 5q2.5 2 5 0t5 0 5 0 5 0"/>',
      "shield": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
      "mic": '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
      "timer": '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
      "orbit": '<path d="M20.341 6.484A10 10 0 0 1 10.266 21.85"/><path d="M3.659 17.516A10 10 0 0 1 13.74 2.152"/><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/>',
      "phone": '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
      "disc": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>',
      "skull": '<path d="m12.5 17-.5-1-.5 1h1z"/><path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="12" r="1"/>',
      "bird": '<path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/>',
      "shuffle": '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
      "move": '<path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/>'
    };

    function svg(name, size, colour) {
      return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
        'stroke="' + colour + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'style="display:block;pointer-events:none;">' + (ICONS[name] || "") + "</svg>";
    }

    // The instrument. Order is the order they appear in the rail.
    const MODES = [
      { id: "analog", name: "Analog", icon: "activity", short: "Analog" },
      { id: "fm", name: "Digital FM", icon: "radio", short: "FM" },
      { id: "chiptune", name: "Chiptune", icon: "gamepad-2", short: "Chip" },
      { id: "robotic", name: "Robotic", icon: "cpu", short: "Robot" },
      { id: "subbass", name: "Sub Bass", icon: "audio-waveform", short: "Sub Bass" },
      { id: "leadpulse", name: "Lead Pulse", icon: "zap", short: "Lead" },
      { id: "drone", name: "Drone", icon: "infinity", short: "Drone" },
      { id: "noise", name: "Static Noise", icon: "wind", short: "Noise" },
      { id: "glass", name: "Crystal Glass", icon: "gem", short: "Glass" },
      { id: "strings", name: "Orchestral Strings", icon: "music", short: "Strings" },
      { id: "acid", name: "Acid Squelch", icon: "flame", short: "Acid" },
      { id: "wind_eff", name: "Wind Breeze", icon: "sparkles", short: "Wind" },
      { id: "bell", name: "Metallic Bell", icon: "bell", short: "Bell" },
      { id: "organ", name: "Retro Organ", icon: "layers", short: "Organ" },
      { id: "laser", name: "Laser Beam", icon: "zap-off", short: "Laser" },
      { id: "theremin", name: "Theremin Wave", icon: "waves", short: "Theremin" },
      { id: "metal", name: "Metal Clang", icon: "shield", short: "Metal" },
      { id: "choir", name: "Vocal Choir", icon: "mic", short: "Choir" },
      { id: "pulsar", name: "Pulsar Synth", icon: "timer", short: "Pulsar" },
      { id: "space", name: "Space Pad", icon: "orbit", short: "Space" },
      { id: "phone", name: "Telephone", icon: "phone", short: "Phone" },
      { id: "vibra", name: "Vibraphone", icon: "disc", short: "Vibra" },
      { id: "heavy", name: "Heavy Dist", icon: "skull", short: "Heavy" },
      { id: "chirp", name: "Alien Chirp", icon: "bird", short: "Chirp" },
      { id: "glitch", name: "Glitch Stutter", icon: "shuffle", short: "Glitch" }
    ];

    const state = {
      volume: 0.8,
      mode: "analog",
      pitch: 50,                       // 0..100, 50 is unshifted
      touch: { active: false, x: 0.5, y: 0.5 }
    };

    // ===================================================================== //
    // 1. Surfaces                                                           //
    // ===================================================================== //
    const view = ctx.createCanvas2D({ touchAction: "none" });
    const g = view.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "3";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 6);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 6);

    let W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);
    // The pad is what is left once the rail and the octave strip are taken out.
    let padX = 0, padY = 0, padW = 1, padH = 1;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);

      const want = Math.round(W * ctx.dpr);
      const wantH = Math.round(H * ctx.dpr);
      if (view.width !== want || view.height !== wantH) {
        view.width = want;
        view.height = wantH;
      }
      // Resizing the backing store drops the context transform, so put it back.
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);

      padX = 0;
      padY = SAFE_T;
      padW = Math.max(1, W - RAIL_W);
      padH = Math.max(1, H - SAFE_T - BAR_H - SAFE_B);

      rail.style.width = RAIL_W + "px";
      rail.style.paddingTop = SAFE_T + "px";
      rail.style.paddingBottom = SAFE_B + "px";
      bar.style.height = BAR_H + "px";
      bar.style.right = RAIL_W + "px";
      bar.style.bottom = SAFE_B + "px";
      overlay.style.width = padW + "px";
      overlay.style.height = padH + "px";
      overlay.style.top = padY + "px";
      drawKnob();
    }

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ';color:#f8fafc;' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      // instructions over the pad, gone after the first touch
      '<div data-el="overlay" style="position:absolute;left:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;pointer-events:none;transition:opacity 500ms ease;">' +
        '<div style="opacity:0.5;margin-bottom:14px;">' + svg("move", 44, "#94a3b8") + "</div>" +
        '<div style="font-size:14px;font-weight:500;letter-spacing:0.4px;color:#94a3b8;' +
        'background:rgba(15,23,42,0.5);padding:8px 16px;border-radius:999px;">Drag to morph sound</div>' +
        '<div style="font-size:11px;color:' + DIM + ';margin-top:9px;letter-spacing:0.3px;">' +
        "X: Timbre &bull; Y: Pitch</div>" +
      "</div>" +

      // octave strip
      '<div data-el="bar" style="position:absolute;left:0;display:flex;align-items:center;gap:11px;' +
      'padding:0 13px;background:' + RAIL_BG + ";border-top:1px solid " + EDGE + ';pointer-events:auto;' +
      'touch-action:none;">' +
        '<span style="font-size:9px;color:' + DIM + ';font-weight:600;text-transform:uppercase;' +
        'letter-spacing:0.6px;line-height:1;pointer-events:none;">Low</span>' +
        '<div data-el="track" style="position:relative;flex:1;height:26px;display:flex;align-items:center;">' +
          '<div style="position:absolute;left:0;right:0;height:7px;border-radius:4px;background:#334155;"></div>' +
          '<div data-el="fill" style="position:absolute;left:0;height:7px;border-radius:4px;' +
          "background:" + ACCENT + ';opacity:0.55;pointer-events:none;"></div>' +
          '<div data-el="knob" style="position:absolute;width:23px;height:23px;border-radius:50%;' +
          "background:" + ACCENT + ';box-shadow:0 2px 6px rgba(0,0,0,0.45);pointer-events:none;"></div>' +
        "</div>" +
        '<span style="font-size:9px;color:' + DIM + ';font-weight:600;text-transform:uppercase;' +
        'letter-spacing:0.6px;line-height:1;pointer-events:none;">High</span>' +
      "</div>" +

      // preset rail
      '<div data-el="rail" style="position:absolute;right:0;top:0;bottom:0;background:' + RAIL_BG + ";" +
      "border-left:1px solid " + EDGE + ';display:flex;flex-direction:column;pointer-events:auto;">' +
        '<div style="padding:6px 2px 7px;text-align:center;border-bottom:1px solid ' + EDGE + ";" +
        'background:rgba(24,24,27,0.4);flex-shrink:0;">' +
          '<span style="font-size:8px;text-transform:uppercase;color:' + DIM + ';letter-spacing:0.9px;' +
          'display:block;line-height:1;margin-bottom:4px;">Preset</span>' +
          '<span data-el="label" style="font-size:9px;font-weight:700;color:' + ACCENT + ';' +
          'letter-spacing:0.4px;text-transform:uppercase;display:block;line-height:1.15;' +
          'padding:0 3px;overflow:hidden;word-break:break-word;">Analog</span>' +
        "</div>" +
        '<div data-el="scroller" style="flex:1;overflow-y:auto;overflow-x:hidden;padding:8px 0;' +
        'display:flex;flex-direction:column;align-items:center;gap:8px;touch-action:pan-y;' +
        '-webkit-overflow-scrolling:touch;"></div>' +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const overlay = nodes.overlay, rail = nodes.rail, bar = nodes.bar;
    const scroller = nodes.scroller, track = nodes.track, knob = nodes.knob, fill = nodes.fill;

    const buttons = [];
    for (const m of MODES) {
      const b = document.createElement("button");
      b.setAttribute("data-mode", m.id);
      b.setAttribute("aria-label", m.name);
      b.style.cssText =
        "width:40px;height:40px;flex-shrink:0;border-radius:9px;background:" + BTN_BG + ";" +
        "border:1px solid " + BTN_EDGE + ";display:flex;align-items:center;justify-content:center;" +
        "padding:0;cursor:pointer;transition:background 150ms ease,transform 150ms ease;" +
        "pointer-events:auto;touch-action:manipulation;";
      b.innerHTML = svg(m.icon, 17, ICON);
      scroller.appendChild(b);
      buttons.push(b);
    }

    function paintButtons() {
      for (let i = 0; i < buttons.length; i++) {
        const on = MODES[i].id === state.mode;
        buttons[i].style.background = on ? ACCENT : BTN_BG;
        buttons[i].style.borderColor = on ? ACCENT : BTN_EDGE;
        buttons[i].innerHTML = svg(MODES[i].icon, 17, on ? "#ffffff" : ICON);
      }
      const m = MODES.find((x) => x.id === state.mode);
      nodes.label.textContent = m ? m.short : "";
    }

    function drawKnob() {
      const w = track.clientWidth || 1;
      const t = state.pitch / 100;
      knob.style.left = (t * (w - 23)) + "px";
      fill.style.width = (t * w) + "px";
    }

    // ===================================================================== //
    // 2. The instrument                                                     //
    // ===================================================================== //
    // Twenty-five voices, each a small graph assembled on note-on and torn
    // down on note-off. osc1 is always the thing you hear; osc2 is a partner
    // (a modulator, a detuned twin, an octave); lfo modulates whatever that
    // voice wants modulated. Kept as the original wrote it.
    class SynthEngine {
      constructor() {
        this.ac = null;
        this.initialized = false;

        this.masterGain = null;
        this.osc1 = null;
        this.osc2 = null;      // FM modulator / detuned twin
        this.modGain = null;   // FM index
        this.filter = null;
        this.lfo = null;
        this.lfoGain = null;
        this.analyser = null;
        this.dataArray = null;
        this.bufferLength = 0;

        this.isPlaying = false;
        this.baseFreqMultipler = 1;   // the octave strip
        this._maxVolume = 0.8;
      }

      init() {
        if (this.initialized) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();

        this.analyser = this.ac.createAnalyser();
        this.analyser.fftSize = 1024;
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);

        this.masterGain = this.ac.createGain();
        this.masterGain.gain.value = 0;
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ac.destination);

        this.initialized = true;
      }

      setVolume(vol) {
        this._maxVolume = vol;
        if (this.masterGain && this.isPlaying) {
          this.masterGain.gain.setTargetAtTime(vol, this.ac.currentTime, 0.05);
        }
      }

      startSound(x, y, mode) {
        if (!this.initialized) this.init();
        if (!this.initialized) return;
        if (this.ac.state === "suspended") { try { this.ac.resume(); } catch (_) {} }

        this.stopSound(true);

        this._maxVolume = state.volume;
        this.isPlaying = true;

        this.osc1 = this.ac.createOscillator();
        this.filter = this.ac.createBiquadFilter();
        this.osc2 = null;
        this.modGain = null;
        this.lfo = null;
        this.lfoGain = null;

        const time = this.ac.currentTime;

        switch (mode) {
          case "analog":
            this.osc1.type = "sawtooth";
            this.filter.type = "lowpass";
            this.filter.Q.value = 5;
            this.osc1.connect(this.filter);
            this.filter.connect(this.masterGain);
            break;

          case "fm":
            this.osc1.type = "sine";                    // carrier
            this.osc2 = this.ac.createOscillator();     // modulator
            this.osc2.type = "sine";
            this.modGain = this.ac.createGain();
            this.osc2.connect(this.modGain);
            this.modGain.connect(this.osc1.frequency);
            this.osc1.connect(this.masterGain);
            this.osc2.start(time);
            break;

          case "chiptune":
            this.osc1.type = "square";
            this.filter.type = "lowpass";
            this.filter.Q.value = 0;
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "square";
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.osc1.frequency);
            this.osc1.connect(this.filter);
            this.filter.connect(this.masterGain);
            this.lfo.start(time);
            break;

          case "robotic":
            this.osc1.type = "sawtooth";
            this.filter.type = "bandpass";
            this.filter.Q.value = 15;                   // formant-ish
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.filter.detune);
            this.osc1.connect(this.filter);
            this.filter.connect(this.masterGain);
            this.lfo.start(time);
            break;

          case "subbass":
            this.osc1.type = "triangle";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "sine";
            this.filter.type = "lowpass";
            this.filter.Q.value = 1;
            this.osc1.connect(this.filter);
            this.osc2.connect(this.filter);
            this.filter.connect(this.masterGain);
            this.osc2.start(time);
            break;

          case "leadpulse":
            this.osc1.type = "sawtooth";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "sawtooth";
            this.osc2.detune.value = 12;
            this.filter.type = "peaking";
            this.filter.Q.value = 4;
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.filter.frequency);
            this.osc1.connect(this.filter);
            this.osc2.connect(this.filter);
            this.filter.connect(this.masterGain);
            this.lfo.start(time);
            this.osc2.start(time);
            break;

          case "drone":
            this.osc1.type = "sawtooth";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "triangle";
            this.osc2.detune.value = -1200;             // octave down
            this.filter.type = "lowpass";
            this.filter.Q.value = 8;
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.lfo.frequency.value = 0.4;             // slow wash
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.filter.frequency);
            this.osc1.connect(this.filter);
            this.osc2.connect(this.filter);
            this.filter.connect(this.masterGain);
            this.lfo.start(time);
            this.osc2.start(time);
            break;

          case "noise": {
            const bufferSize = this.ac.sampleRate * 2;
            const noiseBuffer = this.ac.createBuffer(1, bufferSize, this.ac.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
            this.osc1 = this.ac.createBufferSource();
            this.osc1.buffer = noiseBuffer;
            this.osc1.loop = true;
            this.filter.type = "bandpass";
            this.filter.Q.value = 4;
            this.osc1.connect(this.filter);
            this.filter.connect(this.masterGain);
            break;
          }

          case "glass":
            this.osc1.type = "sine";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "sine";
            this.osc2.detune.value = 2400;              // two octaves up
            this.filter.type = "highpass";
            this.filter.Q.value = 1;
            this.osc1.connect(this.filter);
            this.osc2.connect(this.filter);
            this.filter.connect(this.masterGain);
            this.osc2.start(time);
            break;

          case "strings":
            this.osc1.type = "sawtooth";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "sawtooth";
            this.osc2.detune.value = 15;                // chorus
            this.filter.type = "lowpass";
            this.filter.Q.value = 0.5;
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.lfo.frequency.value = 6;
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.osc2.detune);
            this.osc1.connect(this.filter);
            this.osc2.connect(this.filter);
            this.filter.connect(this.masterGain);
            this.lfo.start(time);
            this.osc2.start(time);
            break;

          case "acid":
            this.osc1.type = "sawtooth";
            this.filter.type = "lowpass";
            this.filter.Q.value = 15;
            this.osc1.connect(this.filter);
            this.filter.connect(this.masterGain);
            break;

          case "wind_eff": {
            const windBufferSize = this.ac.sampleRate * 2;
            const windNoiseBuffer = this.ac.createBuffer(1, windBufferSize, this.ac.sampleRate);
            const windOutput = windNoiseBuffer.getChannelData(0);
            for (let i = 0; i < windBufferSize; i++) windOutput[i] = Math.random() * 2 - 1;
            this.osc1 = this.ac.createBufferSource();
            this.osc1.buffer = windNoiseBuffer;
            this.osc1.loop = true;
            this.filter.type = "bandpass";
            this.filter.Q.value = 8;
            this.osc1.connect(this.filter);
            this.filter.connect(this.masterGain);
            break;
          }

          case "bell":
            this.osc1.type = "sine";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "sine";
            this.modGain = this.ac.createGain();
            this.osc2.connect(this.modGain);
            this.modGain.connect(this.osc1.frequency);
            this.osc1.connect(this.masterGain);
            this.osc2.start(time);
            break;

          case "organ":
            this.osc1.type = "sine";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "sine";
            this.osc2.detune.value = 1200;
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.osc1.connect(this.masterGain);
            this.osc2.connect(this.masterGain);
            this.lfo.connect(this.masterGain);
            this.osc2.start(time);
            this.lfo.start(time);
            break;

          case "laser":
            this.osc1.type = "sawtooth";
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sawtooth";
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.osc1.frequency);
            this.osc1.connect(this.masterGain);
            this.lfo.start(time);
            break;

          case "theremin":
            this.osc1.type = "sine";
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.lfo.frequency.value = 6;
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.osc1.frequency);
            this.osc1.connect(this.masterGain);
            this.lfo.start(time);
            break;

          case "metal":
            this.osc1.type = "triangle";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "sawtooth";
            this.modGain = this.ac.createGain();
            this.osc2.connect(this.modGain);
            this.modGain.connect(this.osc1.frequency);
            this.osc1.connect(this.masterGain);
            this.osc2.start(time);
            break;

          case "choir":
            this.osc1.type = "sawtooth";
            this.filter.type = "bandpass";
            this.filter.Q.value = 10;
            this.osc1.connect(this.filter);
            this.filter.connect(this.masterGain);
            break;

          case "pulsar":
            this.osc1.type = "sawtooth";
            this.filter.type = "lowpass";
            this.filter.Q.value = 2;
            this.modGain = this.ac.createGain();
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.osc1.connect(this.filter);
            this.filter.connect(this.modGain);
            this.modGain.connect(this.masterGain);
            this.lfoGain = this.ac.createGain();
            this.lfoGain.gain.value = 0.45;
            this.modGain.gain.value = 0.55;
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.modGain.gain);
            this.lfo.start(time);
            break;

          case "space":
            this.osc1.type = "sawtooth";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "triangle";
            this.osc2.detune.value = 7;
            this.filter.type = "bandpass";
            this.filter.Q.value = 2;
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.lfo.frequency.value = 0.2;
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.filter.frequency);
            this.osc1.connect(this.filter);
            this.osc2.connect(this.filter);
            this.filter.connect(this.masterGain);
            this.lfo.start(time);
            this.osc2.start(time);
            break;

          case "phone":
            this.osc1.type = "sine";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "sine";
            this.osc1.connect(this.masterGain);
            this.osc2.connect(this.masterGain);
            this.osc2.start(time);
            break;

          case "vibra":
            this.osc1.type = "sine";
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.lfo.frequency.value = 6;
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.osc1.frequency);
            this.osc1.connect(this.masterGain);
            this.lfo.start(time);
            break;

          case "heavy": {
            this.osc1.type = "sawtooth";
            const shaper = this.ac.createWaveShaper();
            shaper.curve = distortionCurve(100);
            shaper.oversample = "4x";
            this.filter.type = "lowpass";
            this.filter.Q.value = 1;
            this.osc1.connect(shaper);
            shaper.connect(this.filter);
            this.filter.connect(this.masterGain);
            break;
          }

          case "chirp":
            this.osc1.type = "sine";
            this.lfo = this.ac.createOscillator();
            this.lfo.type = "sine";
            this.lfoGain = this.ac.createGain();
            this.lfo.connect(this.lfoGain);
            this.lfoGain.connect(this.osc1.frequency);
            this.osc1.connect(this.masterGain);
            this.lfo.start(time);
            break;

          case "glitch":
            this.osc1.type = "square";
            this.osc2 = this.ac.createOscillator();
            this.osc2.type = "square";
            this.modGain = this.ac.createGain();
            this.osc2.connect(this.modGain);
            this.modGain.connect(this.osc1.frequency);
            this.osc1.connect(this.masterGain);
            this.osc2.start(time);
            break;
        }

        this.updateSound(x, y, mode);
        this.osc1.start(time);

        this.masterGain.gain.setValueAtTime(0, time);
        this.masterGain.gain.linearRampToValueAtTime(this._maxVolume, time + 0.05);
      }

      // Where the finger is, translated into whatever this voice cares about.
      updateSound(x, y, mode) {
        if (!this.isPlaying || !this.osc1) return;
        const time = this.ac.currentTime;

        // Y is pitch: an exponential sweep A1 -> A6, then the octave strip.
        const minFreq = 55;     // A1
        const maxFreq = 1760;   // A6
        const freq = minFreq * Math.pow(maxFreq / minFreq, y) * this.baseFreqMultipler;

        switch (mode) {
          case "analog": {
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            const cutoff = 100 * Math.pow(100, x);      // 100 Hz .. 10 kHz
            this.filter.frequency.setTargetAtTime(cutoff, time, 0.02);
            break;
          }

          case "fm":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.osc2.frequency.setTargetAtTime(freq * (1 + x * 3), time, 0.02);
            this.modGain.gain.setTargetAtTime(freq * x * 5, time, 0.02);
            break;

          case "chiptune": {
            const midiNote = 33 + Math.round(y * 48);   // ~4 octaves
            const quantFreq = 440 * Math.pow(2, (Math.round(midiNote / 2) * 2 - 69) / 12);
            this.osc1.frequency.setTargetAtTime(quantFreq * this.baseFreqMultipler, time, 0.05);
            this.lfo.frequency.setTargetAtTime(2 + x * 20, time, 0.05);
            this.lfoGain.gain.setTargetAtTime(quantFreq * 0.1 * x, time, 0.05);
            this.filter.frequency.setTargetAtTime(5000, time, 0.1);
            break;
          }

          case "robotic": {
            this.osc1.frequency.setTargetAtTime(freq * 0.5, time, 0.02);
            const formCutoff = 300 + x * 3000;
            this.filter.frequency.setTargetAtTime(formCutoff, time, 0.02);
            this.lfo.frequency.setTargetAtTime(5 + x * 30, time, 0.05);
            this.lfoGain.gain.setTargetAtTime(1000 + x * 2000, time, 0.05);
            break;
          }

          case "subbass": {
            const bassFreq = freq * 0.5;
            this.osc1.frequency.setTargetAtTime(bassFreq, time, 0.02);
            this.osc2.frequency.setTargetAtTime(bassFreq * 0.5, time, 0.02);
            this.filter.frequency.setTargetAtTime(40 + x * 460, time, 0.02);
            break;
          }

          case "leadpulse":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.osc2.frequency.setTargetAtTime(freq, time, 0.02);
            this.lfo.frequency.setTargetAtTime(1 + x * 15, time, 0.05);
            this.lfoGain.gain.setTargetAtTime(x * 300, time, 0.05);
            this.filter.frequency.setTargetAtTime(freq * (1.5 + y * 2), time, 0.02);
            break;

          case "drone": {
            const droneBase = freq * 0.25;
            this.osc1.frequency.setTargetAtTime(droneBase, time, 0.1);
            this.osc2.frequency.setTargetAtTime(droneBase * 1.5, time, 0.1);
            const droneCutoff = 100 + x * 700;
            this.filter.frequency.setTargetAtTime(droneCutoff, time, 0.1);
            this.lfoGain.gain.setTargetAtTime(droneCutoff * 0.4, time, 0.1);
            break;
          }

          case "noise":
            this.filter.frequency.setTargetAtTime(80 + x * 5000, time, 0.05);
            this.filter.Q.setTargetAtTime(1 + y * 15, time, 0.05);
            break;

          case "glass":
            this.osc1.frequency.setTargetAtTime(freq * 1.5, time, 0.02);
            this.osc2.frequency.setTargetAtTime(freq * 3, time, 0.02);
            this.filter.frequency.setTargetAtTime(700 + x * 6000, time, 0.02);
            break;

          case "strings":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.04);
            this.osc2.frequency.setTargetAtTime(freq * 1.008, time, 0.04);
            this.filter.frequency.setTargetAtTime(200 + x * 4000, time, 0.04);
            this.lfoGain.gain.setTargetAtTime(10 + y * 50, time, 0.04);
            break;

          case "acid":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.filter.frequency.setTargetAtTime(150 + Math.pow(x, 2) * 4000, time, 0.03);
            break;

          case "wind_eff":
            this.filter.frequency.setTargetAtTime(200 + y * 2500, time, 0.1);
            this.filter.Q.setTargetAtTime(4 + x * 20, time, 0.05);
            break;

          case "bell":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.01);
            this.osc2.frequency.setTargetAtTime(freq * 2.71, time, 0.01);
            this.modGain.gain.setTargetAtTime(freq * 4 * x, time, 0.02);
            break;

          case "organ":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.osc2.frequency.setTargetAtTime(freq * 2, time, 0.02);
            this.lfo.frequency.setTargetAtTime(freq * 3 * (1 + x * 0.05), time, 0.02);
            break;

          case "laser":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.lfo.frequency.setTargetAtTime(2 + x * 18, time, 0.02);
            this.lfoGain.gain.setTargetAtTime(freq * 0.8 * y, time, 0.02);
            break;

          case "theremin":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.05);
            this.lfoGain.gain.setTargetAtTime(freq * 0.08 * x, time, 0.05);
            break;

          case "metal":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.osc2.frequency.setTargetAtTime(freq * 1.414, time, 0.02);
            this.modGain.gain.setTargetAtTime(freq * 8 * x, time, 0.02);
            break;

          case "choir":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.filter.frequency.setTargetAtTime(400 + x * 1200, time, 0.05);
            break;

          case "pulsar":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.lfo.frequency.setTargetAtTime(1 + x * 19, time, 0.05);
            this.filter.frequency.setTargetAtTime(300 + y * 3000, time, 0.05);
            break;

          case "space": {
            this.osc1.frequency.setTargetAtTime(freq, time, 0.05);
            this.osc2.frequency.setTargetAtTime(freq, time, 0.05);
            const centerFreq = 400 + y * 2000;
            this.lfoGain.gain.setTargetAtTime(centerFreq * 0.7 * x, time, 0.05);
            this.filter.frequency.setTargetAtTime(centerFreq, time, 0.05);
            break;
          }

          case "phone":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.01);
            this.osc2.frequency.setTargetAtTime(freq * (1.5 + x * 0.5), time, 0.01);
            break;

          case "vibra":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.04);
            this.lfo.frequency.setTargetAtTime(3 + x * 10, time, 0.05);
            this.lfoGain.gain.setTargetAtTime(freq * 0.04 * y, time, 0.05);
            break;

          case "heavy":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.filter.frequency.setTargetAtTime(200 + x * 5000, time, 0.02);
            break;

          case "chirp":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.02);
            this.lfo.frequency.setTargetAtTime(15 + x * 80, time, 0.05);
            this.lfoGain.gain.setTargetAtTime(freq * 0.6 * y, time, 0.05);
            break;

          case "glitch":
            this.osc1.frequency.setTargetAtTime(freq, time, 0.05);
            this.osc2.frequency.setTargetAtTime(12 + x * 40, time, 0.05);
            this.modGain.gain.setTargetAtTime(freq * 0.9 * y, time, 0.05);
            break;
        }
      }

      stopSound(immediate) {
        if (!this.isPlaying) return;
        const time = this.ac.currentTime;
        const releaseTime = immediate ? 0.01 : 0.1;

        if (this.masterGain) {
          this.masterGain.gain.cancelScheduledValues(time);
          this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, time);
          this.masterGain.gain.linearRampToValueAtTime(0, time + releaseTime);
        }

        // let them ring through the release, then stop
        const stopTime = time + releaseTime + 0.05;
        if (this.osc1) { try { this.osc1.stop(stopTime); } catch (_) {} }
        if (this.osc2) { try { this.osc2.stop(stopTime); } catch (_) {} }
        if (this.lfo) { try { this.lfo.stop(stopTime); } catch (_) {} }

        this.isPlaying = false;
      }

      // 0..100, 50 unshifted, either end two octaves away.
      setBasePitch(sliderValue) {
        this.baseFreqMultipler = Math.pow(2, (sliderValue - 50) / 25);
        if (this.isPlaying) this.updateSound(state.touch.x, state.touch.y, state.mode);
      }

      close() {
        try { this.stopSound(true); } catch (_) {}
        if (this.ac) { try { this.ac.close(); } catch (_) {} }
        this.initialized = false;
      }
    }

    // Cached: the curve is 44 100 samples and never changes.
    let _curve = null;
    function distortionCurve(amount) {
      if (_curve) return _curve;
      const k = typeof amount === "number" ? amount : 50;
      const n = 44100;
      const curve = new Float32Array(n);
      const deg = Math.PI / 180;
      for (let i = 0; i < n; ++i) {
        const x = (i * 2) / n - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
      _curve = curve;
      return curve;
    }

    const synth = new SynthEngine();

    // ===================================================================== //
    // 3. The pad                                                            //
    // ===================================================================== //
    function drawPad(now) {
      g.clearRect(0, 0, W, H);

      g.fillStyle = PAD_BG;
      g.fillRect(padX, padY, padW, padH);

      // grid
      g.strokeStyle = "rgba(255,255,255,0.04)";
      g.lineWidth = 1;
      for (let i = 1; i < 10; i++) {
        const y = padY + padH * (i / 10);
        g.beginPath();
        g.moveTo(padX, y);
        g.lineTo(padX + padW, y);
        g.stroke();
        const x = padX + padW * (i / 10);
        g.beginPath();
        g.moveTo(x, padY);
        g.lineTo(x, padY + padH);
        g.stroke();
      }

      // the actual output, tapped off the master bus
      g.save();
      g.beginPath();
      g.strokeStyle = ACCENT;
      g.lineWidth = 2.5;
      g.globalAlpha = state.touch.active ? 0.9 : 0.35;
      g.shadowColor = ACCENT;
      g.shadowBlur = state.touch.active ? 15 : 6;

      const centerY = padY + padH / 2;

      if (synth.initialized && synth.isPlaying) {
        synth.analyser.getByteTimeDomainData(synth.dataArray);
        const sliceWidth = padW / synth.bufferLength;
        let x = padX;
        for (let i = 0; i < synth.bufferLength; i++) {
          const v = synth.dataArray[i] / 128.0;         // 0 .. 2
          // taper the ends so the trace stays inside the frame
          const edgeFade = Math.sin((i / (synth.bufferLength - 1)) * Math.PI);
          const y = centerY + (v - 1.0) * (padH * 0.35) * edgeFade;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          x += sliceWidth;
        }
      } else {
        // idle: a slow ripple, so it never looks dead
        g.moveTo(padX, centerY);
        const wavePoints = 100;
        const waveSlice = padW / wavePoints;
        for (let i = 0; i <= wavePoints; i++) {
          const ripple = Math.sin(i * 0.15 + now * 0.003) * 1.5;
          g.lineTo(padX + i * waveSlice, centerY + ripple);
        }
      }
      g.stroke();
      g.restore();

      if (state.touch.active) {
        const tx = padX + state.touch.x * padW;
        const ty = padY + (1 - state.touch.y) * padH;

        g.save();
        g.beginPath();
        g.strokeStyle = ACCENT;
        g.globalAlpha = 0.3;
        g.moveTo(tx, padY);
        g.lineTo(tx, padY + padH);
        g.moveTo(padX, ty);
        g.lineTo(padX + padW, ty);
        g.stroke();

        const pulseRadius = 30 + Math.sin(now / 80) * 6;
        g.beginPath();
        g.fillStyle = ACCENT;
        g.globalAlpha = 0.15;
        g.arc(tx, ty, pulseRadius, 0, Math.PI * 2);
        g.fill();

        g.beginPath();
        g.globalAlpha = 1;
        g.fillStyle = ACCENT;
        g.arc(tx, ty, 8, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }

    // ===================================================================== //
    // 4. Hands on it                                                        //
    // ===================================================================== //
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      overlay.style.opacity = "0";
    }

    function readTouch(e) {
      const x = clamp01((e.offsetX - padX) / padW);
      const y = clamp01((e.offsetY - padY) / padH);
      state.touch.x = x;
      state.touch.y = 1 - y;       // bottom of the pad is the low end
    }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function inPad(e) {
      return e.offsetX >= padX && e.offsetX <= padX + padW &&
             e.offsetY >= padY && e.offsetY <= padY + padH;
    }

    ctx.listen(view, "pointerdown", (e) => {
      if (!inPad(e)) return;
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      state.touch.active = true;
      readTouch(e);
      synth.startSound(state.touch.x, state.touch.y, state.mode);
      ctx.platform.haptic("light");
      ctx.platform.interact({ kind: "note_on", preset: state.mode });
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!state.touch.active) return;
      readTouch(e);
      synth.updateSound(state.touch.x, state.touch.y, state.mode);
    });

    const release = (e) => {
      if (!state.touch.active) return;
      state.touch.active = false;
      if (view.releasePointerCapture && e.pointerId != null) {
        try { view.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      synth.stopSound(false);
    };
    ctx.listen(view, "pointerup", release);
    ctx.listen(view, "pointercancel", release);
    ctx.listen(view, "lostpointercapture", release);

    // presets
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      const id = MODES[i].id;
      ctx.listen(b, "pointerdown", (e) => {
        e.preventDefault();
        firstGesture();
        state.mode = id;
        paintButtons();
        ctx.platform.haptic("light");
        ctx.platform.interact({ kind: "preset", preset: id });
        remember();
        // if a note is being held, swap the voice under the finger
        if (state.touch.active) synth.startSound(state.touch.x, state.touch.y, state.mode);
      });
    }

    // octave strip
    let draggingPitch = false;
    function pitchFromEvent(e) {
      const w = track.clientWidth || 1;
      // The knob, the fill and the two labels are all pointer-inert, so the
      // only things that can be hit here are the track and the bar itself.
      const px = e.target === track ? e.offsetX : e.offsetX - track.offsetLeft;
      state.pitch = Math.round(clamp01(px / w) * 100);
      drawKnob();
      synth.setBasePitch(state.pitch);
    }
    ctx.listen(bar, "pointerdown", (e) => {
      firstGesture();
      draggingPitch = true;
      if (bar.setPointerCapture) { try { bar.setPointerCapture(e.pointerId); } catch (_) {} }
      pitchFromEvent(e);
    });
    ctx.listen(bar, "pointermove", (e) => { if (draggingPitch) pitchFromEvent(e); });
    const endPitch = () => {
      if (!draggingPitch) return;
      draggingPitch = false;
      remember();
    };
    ctx.listen(bar, "pointerup", endPitch);
    ctx.listen(bar, "pointercancel", endPitch);

    // ===================================================================== //
    // 5. Remember where they left it                                        //
    // ===================================================================== //
    /**
     * Fire a side-effect call that may be absent, may throw, and may or may
     * not hand back a promise. On a real device ctx.storage.set() returns
     * nothing, so a bare .catch() on the result takes the whole bit down --
     * never assume a runtime call is thenable.
     */
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
        fireAndForget(() => ctx.storage.set("waveflow", { mode: state.mode, pitch: state.pitch }));
      }, 400);
    }

    if (canStore) {
      try {
        // await copes either way: a promise resolves, a plain value passes through
        const saved = await ctx.storage.get("waveflow");
        if (saved && typeof saved === "object") {
          if (MODES.some((m) => m.id === saved.mode)) state.mode = saved.mode;
          if (typeof saved.pitch === "number" && saved.pitch >= 0 && saved.pitch <= 100) {
            state.pitch = saved.pitch;
          }
        }
      } catch (_) { /* first run, or storage unavailable */ }
    }

    // ===================================================================== //
    // 6. Go                                                                 //
    // ===================================================================== //
    ctx.onDestroy(() => { synth.close(); });

    paintButtons();
    layout();
    synth.setBasePitch(state.pitch);
    drawPad(0);
    ctx.markVisualReady("pad drawn");
    ctx.platform.ready();

    ctx.onFrame((dt, now) => {
      if (ctx.width !== W || ctx.height !== H) layout();
      drawPad(now);
    });
  }
};
