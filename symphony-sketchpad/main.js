/**
 * Symphony Sketchpad — draw a picture, then hear it.
 *
 * Twenty-one instruments, each one a colour. Pick one and draw: the stroke
 * sounds as you make it, pitched by how high up the canvas your finger is, on a
 * major pentatonic so there are no wrong notes. Then press play and a scanline
 * sweeps left to right across everything you have drawn, firing each point it
 * crosses. What you drew is the score.
 *
 * The instruments are not samples. Each is a small Web Audio graph built on the
 * spot — a lowpass-filtered sawtooth for the trumpet, filtered noise for the
 * cymbals, a sine swept 150 Hz to 40 Hz in a tenth of a second for the kick,
 * a detuned saw pair for the synth, noise plus a pitched thump for the snare.
 * Twenty-one of them, so a drawing can be an ensemble.
 *
 * Ported from a standalone Sekai build. The synthesis, the pentatonic mapping,
 * the scanline and the particles are the original's, unchanged. The shell was
 * rebuilt for plethora-bit@2: no CDN, no platform scaffolding, Plethora-owned
 * DOM and frame loop. Icon geometry is lucide (ISC licence), inlined as SVG.
 *
 * Nothing was substituted. The original declared two audio slots — background
 * music and a clear sound — and both were empty in the build, so there was no
 * asset to lose. Every sound here is the same synthesis the original shipped.
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
    // 0. Look                                                               //
    // ===================================================================== //
    const BG = "#0a0a0b";        // page
    const PANEL = "#18181b";     // header and palette
    const EDGE = "#27272a";
    const PAD_BG = "#000000";
    const INK = "#e4e4e7";
    const DIM = "#a1a1aa";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

    const HEAD_H = 50;
    const PAL_H = 214;           // instrument grid along the bottom

    const ICONS = {
      "music": '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
      "shopping-bag": '<path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>',
      "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
      "trash-2": '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
      "play": '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
      "square": '<rect width="18" height="18" x="3" y="3" rx="2"/>'
    };

    function svg(name, size, colour, fill) {
      return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" ' +
        'fill="' + (fill || "none") + '" stroke="' + colour + '" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" ' +
        'style="display:block;pointer-events:none;">' + (ICONS[name] || "") + "</svg>";
    }

    // The instrument list and its colours, exactly as the original had them.
    const INSTRUMENTS = [
      { id: "red", name: "Trumpet", colour: "#ef4444" },
      { id: "crystal", name: "Crystal Bell", colour: "#38bdf8" },
      { id: "spacesynth", name: "Space Synth", colour: "#c084fc" },
      { id: "deepbass", name: "Deep Bass", colour: "#0284c7" },
      { id: "orange", name: "Piano", colour: "#f97316" },
      { id: "yellow", name: "Cymbals", colour: "#eab308" },
      { id: "green", name: "Xylophone", colour: "#22c55e" },
      { id: "cyan", name: "Bass", colour: "#06b6d4" },
      { id: "blue", name: "Drum", colour: "#3b82f6" },
      { id: "purple", name: "Synthesizer", colour: "#a855f7" },
      { id: "pink", name: "Percussion", colour: "#ec4899" },
      { id: "white", name: "Fem Vocals", colour: "#f8fafc" },
      { id: "black", name: "Male Vocals", colour: "#111827" },
      { id: "brown", name: "Guitar", colour: "#92400e" },
      { id: "grey", name: "Violin", colour: "#9ca3af" },
      { id: "magenta", name: "Flute", colour: "#d946ef" },
      { id: "snare", name: "Snare", colour: "#f43f5e" },
      { id: "shaker", name: "Shaker", colour: "#f59e0b" },
      { id: "kick", name: "Kick Drum", colour: "#2563eb" },
      { id: "woodblock", name: "Woodblock", colour: "#a16207" },
      { id: "tambourine", name: "Tambourine", colour: "#facc15" }
    ];
    const colourOf = {};
    for (const i of INSTRUMENTS) colourOf[i.id] = i.colour;

    // The joke shop. Every tier is a volume multiplier, and the numbers get
    // silly on purpose — that is the gag, and it is the creator's.
    const TIERS = [
      { mult: 1.5, label: "Loud", pct: "150%" },
      { mult: 3.0, label: "Mega", pct: "300%" },
      { mult: 6.0, label: "Super Mega", pct: "600%" },
      { mult: 12.0, label: "Max", pct: "1200%" },
      { mult: 25.0, label: "Final", pct: "2500%" },
      { mult: 50.0, label: "Super Final", pct: "5000%" },
      { mult: 100.0, label: "Mega Final", pct: "10000%" },
      { mult: 500.0, label: "Overpowered", pct: "50000%" },
      { mult: 100000.0, label: "Infinite", pct: "??????%" },
      { mult: 9999999.0, label: "The End", pct: "ω%" }
    ];

    // Defaults are the values the original build actually shipped, not the
    // fallbacks in its source — its brushSize fell back to 1000, which would
    // paint the whole canvas in one stroke.
    const state = {
      brushSize: 9,
      playbackSpeed: 8,
      glow: false,
      rainbow: false,
      particleTrails: true,
      playbackBursts: true,
      volumeMultiplier: 1.0,
      instrument: "red",
      strokes: [],
      drawing: null,
      playing: false,
      scanX: 0,
      hue: 0
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
    let padX = 0, padY = 0, padW = 1, padH = 1;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      const bw = Math.round(W * ctx.dpr), bh = Math.round(H * ctx.dpr);
      if (view.width !== bw || view.height !== bh) { view.width = bw; view.height = bh; }
      g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);

      padX = 0;
      padY = SAFE_T + HEAD_H;
      padW = W;
      padH = Math.max(80, H - padY - PAL_H - SAFE_B);

      head.style.top = SAFE_T + "px";
      head.style.height = HEAD_H + "px";
      palette.style.height = PAL_H + "px";
      palette.style.bottom = SAFE_B + "px";
      playBtn.style.bottom = (PAL_H + SAFE_B + 14) + "px";
      hint.style.top = padY + "px";
      hint.style.height = padH + "px";
    }

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ";color:" + INK + ";" +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      // header
      '<div data-el="head" style="position:absolute;left:0;right:0;background:' + PANEL + ";" +
      "border-bottom:1px solid " + EDGE + ';display:flex;align-items:center;justify-content:space-between;' +
      'padding:0 12px;pointer-events:auto;">' +
        '<div style="display:flex;align-items:center;gap:9px;">' +
          '<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;' +
          'justify-content:center;background:linear-gradient(45deg,#a855f7,#3b82f6);">' +
          svg("music", 13, "#ffffff") + "</div>" +
          '<div><div style="font-size:12.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;' +
          'color:' + DIM + ';">Symphony</div>' +
          '<div data-el="inst" style="font-size:11px;color:#ef4444;font-weight:600;letter-spacing:0.4px;' +
          'line-height:1.2;">Trumpet</div></div>' +
        "</div>" +
        '<div style="display:flex;gap:7px;">' +
          '<button data-el="shop" style="width:36px;height:36px;border-radius:18px;border:0;' +
          'background:#b45309;display:flex;align-items:center;justify-content:center;padding:0;' +
          'pointer-events:auto;">' + svg("shopping-bag", 16, "#ffffff") + "</button>" +
          '<button data-el="undo" style="width:36px;height:36px;border-radius:18px;border:0;' +
          'background:#27272a;display:flex;align-items:center;justify-content:center;padding:0;' +
          'pointer-events:auto;">' + svg("rotate-ccw", 16, DIM) + "</button>" +
          '<button data-el="clear" style="width:36px;height:36px;border-radius:18px;border:0;' +
          'background:#27272a;display:flex;align-items:center;justify-content:center;padding:0;' +
          'pointer-events:auto;">' + svg("trash-2", 16, DIM) + "</button>" +
        "</div>" +
      "</div>" +

      // first-run hint over the canvas
      '<div data-el="hint" style="position:absolute;left:0;right:0;display:flex;align-items:center;' +
      'justify-content:center;pointer-events:none;transition:opacity 500ms ease;">' +
        '<div style="text-align:center;background:rgba(0,0,0,0.55);padding:13px 20px;border-radius:14px;">' +
        '<div style="font-size:15px;font-weight:600;">Tap and drag to compose</div>' +
        '<div style="font-size:11.5px;color:' + DIM + ';margin-top:5px;">higher is a higher note</div>' +
        "</div>" +
      "</div>" +

      // play / stop
      '<button data-el="play" style="position:absolute;right:16px;width:54px;height:54px;' +
      'border-radius:27px;border:0;background:#22c55e;display:flex;align-items:center;' +
      'justify-content:center;padding:0;box-shadow:0 6px 20px rgba(0,0,0,0.45);pointer-events:auto;">' +
      svg("play", 21, "#ffffff", "#ffffff") + "</button>" +

      // palette
      '<div data-el="palette" style="position:absolute;left:0;right:0;background:' + PANEL + ";" +
      "border-top:1px solid " + EDGE + ';overflow-y:auto;overflow-x:hidden;padding:9px;' +
      // grid-auto-rows rather than aspect-ratio on the items: inside a scroller
      // the implicit rows collapse and the tiles overlap each other.
      'display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:66px;gap:7px;align-content:start;' +
      'touch-action:pan-y;-webkit-overflow-scrolling:touch;pointer-events:auto;"></div>' +

      // shop
      '<div data-el="shop_modal" style="position:absolute;inset:0;display:none;background:rgba(6,6,8,0.94);' +
      'z-index:9;padding:22px;pointer-events:auto;overflow-y:auto;touch-action:pan-y;">' +
        '<div style="max-width:340px;margin:0 auto;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
            '<div style="font-size:18px;font-weight:700;">Volume Shop</div>' +
            '<button data-el="shop_close" style="width:34px;height:34px;border-radius:17px;border:0;' +
            'background:#27272a;color:' + INK + ';font-size:17px;padding:0;pointer-events:auto;">×</button>' +
          "</div>" +
          '<div data-el="tiers"></div>' +
        "</div>" +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const head = nodes.head, palette = nodes.palette, playBtn = nodes.play, hint = nodes.hint;

    // instrument buttons
    const instBtns = [];
    for (const inst of INSTRUMENTS) {
      const b = document.createElement("button");
      b.setAttribute("data-id", inst.id);
      b.style.cssText =
        "border-radius:11px;background:#27272a;border:1.5px solid transparent;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;" +
        "padding:3px 2px;cursor:pointer;pointer-events:auto;touch-action:manipulation;overflow:hidden;";
      b.innerHTML =
        '<div style="width:21px;height:21px;border-radius:50%;background:' + inst.colour + ";" +
        "box-shadow:0 0 8px " + inst.colour + '80;"></div>' +
        '<span style="font-size:8.5px;font-weight:500;color:' + DIM + ';text-transform:uppercase;' +
        'letter-spacing:0.3px;text-align:center;line-height:1.1;">' + inst.name + "</span>";
      palette.appendChild(b);
      instBtns.push(b);
    }

    function paintPalette() {
      for (let i = 0; i < instBtns.length; i++) {
        const on = INSTRUMENTS[i].id === state.instrument;
        instBtns[i].style.background = on ? "#3f3f46" : "#27272a";
        instBtns[i].style.borderColor = on ? INSTRUMENTS[i].colour : "transparent";
      }
      const inst = INSTRUMENTS.find((x) => x.id === state.instrument);
      if (inst) {
        nodes.inst.textContent = inst.name;
        nodes.inst.style.color = inst.colour;
      }
    }

    // shop tiers
    const tierBtns = [];
    for (const t of TIERS) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;" +
        "background:#18181b;border:1px solid " + EDGE + ";border-radius:11px;padding:11px 13px;margin-bottom:8px;";
      const btn = document.createElement("button");
      btn.style.cssText = "border:0;border-radius:9px;background:#b45309;color:#fff;font-size:12px;" +
        "font-weight:700;font-family:inherit;padding:8px 13px;pointer-events:auto;white-space:nowrap;";
      btn.textContent = "Activate";
      row.innerHTML = '<div><div style="font-size:14px;font-weight:600;">' + t.label + "</div>" +
        '<div style="font-size:11px;color:' + DIM + ';margin-top:2px;">' + t.pct + "</div></div>";
      row.appendChild(btn);
      nodes.tiers.appendChild(row);
      tierBtns.push({ btn: btn, tier: t });
    }

    function paintTiers() {
      for (const { btn, tier } of tierBtns) {
        const on = state.volumeMultiplier === tier.mult;
        btn.textContent = on ? "Active (" + tier.pct + ")" : "Activate";
        btn.style.background = on ? "#22c55e" : "#b45309";
      }
    }

    // ===================================================================== //
    // 2. The instruments                                                    //
    // ===================================================================== //
    // Twenty-one graphs, built on note-on and torn down on note-off. Carried
    // over from the original unchanged — same oscillator types, same filter
    // frequencies, same envelopes.
    class SoundEngine {
      constructor() {
        this.ac = null;
        this.masterGain = null;
        this.active = {};        // pointerId -> voice
      }

      init() {
        if (this.ac) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();
        this.masterGain = this.ac.createGain();
        this.masterGain.gain.value = 0.5 * (state.volumeMultiplier || 1);
        this.masterGain.connect(this.ac.destination);
      }

      setVolumeMultiplier(mult) {
        if (!this.ac) return;
        this.masterGain.gain.setValueAtTime(0.5 * mult, this.ac.currentTime);
      }

      // Y from 0 (bottom) to 1 (top), quantised to a major pentatonic so that
      // any drawing lands on notes that agree with each other.
      getFrequency(y) {
        const base = 261.63;   // middle C
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
        const idx = Math.max(0, Math.min(scale.length - 1, Math.floor(y * scale.length)));
        return base * Math.pow(2, scale[idx] / 12);
      }

      startTone(id, y, pointerId) {
        if (!this.ac) this.init();
        if (!this.ac) return;
        if (this.ac.state === "suspended") { try { this.ac.resume(); } catch (_) {} }
        if (this.active[pointerId]) this.active[pointerId].stop();

        const nodes = this.build(id, this.getFrequency(y), this.ac.currentTime);
        const self = this;
        this.active[pointerId] = {
          stop: function () {
            const release = 0.1;
            if (nodes.gain) nodes.gain.gain.setTargetAtTime(0, self.ac.currentTime, release);
            ctx.timeout(function () {
              for (const s of nodes.sources) { try { s.stop(); } catch (_) {} }
            }, release * 1000 + 100);
            delete self.active[pointerId];
          },
          setFreq: function (newY) {
            const f = self.getFrequency(newY);
            if (nodes.osc) nodes.osc.frequency.setTargetAtTime(f, self.ac.currentTime, 0.05);
            if (nodes.filter && id === "red") {
              nodes.filter.frequency.setTargetAtTime(f * 2, self.ac.currentTime, 0.05);
            }
          }
        };
      }

      updateTone(pointerId, y) {
        if (this.active[pointerId]) this.active[pointerId].setFreq(y);
      }

      stopTone(pointerId) {
        if (this.active[pointerId]) this.active[pointerId].stop();
      }

      stopAll() {
        for (const id of Object.keys(this.active)) this.stopTone(id);
      }

      // The scanline's one-shot: same graph, fixed length.
      playNoteOneShot(id, y, duration) {
        if (!this.ac) return;
        const now = this.ac.currentTime;
        const nodes = this.build(id, this.getFrequency(y), now);
        const releaseStart = now + (duration || 0.2);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, releaseStart);
        nodes.gain.gain.linearRampToValueAtTime(0, releaseStart + 0.1);
        for (const s of nodes.sources) { try { s.stop(releaseStart + 0.2); } catch (_) {} }
      }

      build(id, freq, now) {
        const gain = this.ac.createGain();
        gain.connect(this.masterGain);
        const sources = [];
        let osc = null, filter = null;

        switch (id) {
          case "red":            // Trumpet
            osc = this.ac.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = freq;
            filter = this.ac.createBiquadFilter();
            filter.type = "lowpass";
            filter.Q.value = 5;
            filter.frequency.value = freq * 2;
            osc.connect(filter);
            filter.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
            sources.push(osc);
            break;

          case "orange":         // Piano
            osc = this.ac.createOscillator();
            osc.type = "triangle";
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.4, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.1, now + 0.5);
            sources.push(osc);
            break;

          case "yellow": {       // Cymbals
            const buf = this.noise(2);
            const noise = this.ac.createBufferSource();
            noise.buffer = buf;
            noise.loop = true;
            filter = this.ac.createBiquadFilter();
            filter.type = "highpass";
            filter.frequency.value = 5000 + freq * 2;
            noise.connect(filter);
            filter.connect(gain);
            gain.gain.setValueAtTime(0.15, now);
            sources.push(noise);
            break;
          }

          case "green":          // Xylophone
            osc = this.ac.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq * 2;
            osc.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.4, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            sources.push(osc);
            break;

          case "cyan":           // Bass
            osc = this.ac.createOscillator();
            osc.type = "square";
            osc.frequency.value = freq / 2;
            filter = this.ac.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = 400;
            osc.connect(filter);
            filter.connect(gain);
            gain.gain.setValueAtTime(0.4, now);
            sources.push(osc);
            break;

          case "blue":           // Drum
            osc = this.ac.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
            osc.connect(gain);
            gain.gain.setValueAtTime(0.8, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            sources.push(osc);
            break;

          case "purple": {       // Synthesizer — two saws a hair apart
            osc = this.ac.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = freq;
            const osc2 = this.ac.createOscillator();
            osc2.type = "sawtooth";
            osc2.frequency.value = freq * 1.01;
            osc.connect(gain);
            osc2.connect(gain);
            gain.gain.setValueAtTime(0.15, now);
            sources.push(osc, osc2);
            break;
          }

          case "crystal":        // Crystal Bell
            osc = this.ac.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq * 3;
            osc.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
            sources.push(osc);
            break;

          case "spacesynth": {   // Space Synth — bandpass sweeping open
            osc = this.ac.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = freq;
            const bp = this.ac.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.setValueAtTime(freq, now);
            bp.frequency.linearRampToValueAtTime(freq * 4, now + 0.5);
            osc.connect(bp);
            bp.connect(gain);
            gain.gain.setValueAtTime(0.2, now);
            sources.push(osc);
            break;
          }

          case "deepbass":       // Deep Bass
            osc = this.ac.createOscillator();
            osc.type = "triangle";
            osc.frequency.value = freq * 0.25;
            osc.connect(gain);
            gain.gain.setValueAtTime(0.5, now);
            sources.push(osc);
            break;

          case "pink":           // Percussion: woodblock
            osc = this.ac.createOscillator();
            osc.type = "sine";
            osc.frequency.value = 800;
            osc.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            sources.push(osc);
            break;

          case "white":          // Fem Vocals — a formant-ish bandpass
            osc = this.ac.createOscillator();
            osc.type = "triangle";
            osc.frequency.value = freq * 1.5;
            filter = this.ac.createBiquadFilter();
            filter.type = "bandpass";
            filter.frequency.value = 900;
            filter.Q.value = 2;
            osc.connect(filter);
            filter.connect(gain);
            gain.gain.setValueAtTime(0.3, now);
            sources.push(osc);
            break;

          case "black":          // Male Vocals
            osc = this.ac.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = freq * 0.5;
            filter = this.ac.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = 600;
            osc.connect(filter);
            filter.connect(gain);
            gain.gain.setValueAtTime(0.3, now);
            sources.push(osc);
            break;

          case "brown":          // Guitar
            osc = this.ac.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = freq;
            filter = this.ac.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = 2000;
            osc.connect(filter);
            filter.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
            sources.push(osc);
            break;

          case "grey": {         // Violin — 6 Hz vibrato on the pitch
            osc = this.ac.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = freq;
            const lfo = this.ac.createOscillator();
            lfo.frequency.value = 6;
            const lfoGain = this.ac.createGain();
            lfoGain.gain.value = 5;
            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            lfo.start(now);
            filter = this.ac.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = 3000;
            osc.connect(filter);
            filter.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.4);
            sources.push(osc, lfo);
            break;
          }

          case "magenta": {      // Flute — 5 Hz tremolo on the gain
            osc = this.ac.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq;
            const tLfo = this.ac.createOscillator();
            tLfo.frequency.value = 5;
            const tGain = this.ac.createGain();
            tGain.gain.value = 0.1;
            tLfo.connect(tGain);
            tGain.connect(gain.gain);
            tLfo.start(now);
            osc.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
            sources.push(osc, tLfo);
            break;
          }

          case "snare": {        // Snare — noise plus a pitched thump
            const snareNoise = this.ac.createBufferSource();
            snareNoise.buffer = this.noise(0.2);
            const hp = this.ac.createBiquadFilter();
            hp.type = "highpass";
            hp.frequency.value = 1000;
            snareNoise.connect(hp);
            hp.connect(gain);
            osc = this.ac.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
            osc.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.8, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            sources.push(snareNoise, osc);
            break;
          }

          case "shaker": {       // Shaker
            const sh = this.ac.createBufferSource();
            sh.buffer = this.noise(0.1);
            const hp = this.ac.createBiquadFilter();
            hp.type = "highpass";
            hp.frequency.value = 4000 + freq * 0.5;
            sh.connect(hp);
            hp.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.4, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
            sources.push(sh);
            break;
          }

          case "kick":           // Kick
            osc = this.ac.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(45, now + 0.1);
            osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);
            osc.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(1.0, now + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.5, now + 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
            sources.push(osc);
            break;

          case "woodblock":      // Woodblock
            osc = this.ac.createOscillator();
            osc.type = "triangle";
            osc.frequency.value = 600 + freq * 0.5;
            osc.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.6, now + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            sources.push(osc);
            break;

          case "tambourine": {   // Tambourine
            const tam = this.ac.createBufferSource();
            tam.buffer = this.noise(0.15);
            const hp = this.ac.createBiquadFilter();
            hp.type = "highpass";
            hp.frequency.value = 6000;
            tam.connect(hp);
            hp.connect(gain);
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            sources.push(tam);
            break;
          }

          default:
            osc = this.ac.createOscillator();
            osc.connect(gain);
            sources.push(osc);
        }

        for (const s of sources) { try { s.start(now); } catch (_) {} }
        return { osc: osc, filter: filter, gain: gain, sources: sources };
      }

      noise(seconds) {
        const n = Math.max(1, Math.floor(this.ac.sampleRate * seconds));
        const buf = this.ac.createBuffer(1, n, this.ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        return buf;
      }

      close() {
        try { this.stopAll(); } catch (_) {}
        if (this.ac) { try { this.ac.close(); } catch (_) {} }
        this.ac = null;
      }
    }

    const synth = new SoundEngine();

    // ===================================================================== //
    // 3. The canvas                                                         //
    // ===================================================================== //
    const particles = [];

    function addParticle(x, y, colour, burst) {
      const count = burst ? 12 : 1;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = burst ? Math.random() * 6 + 2 : Math.random() * 1.5;
        particles.push({
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 1, decay: burst ? 0.02 : 0.05,
          colour: colour,
          size: burst ? Math.random() * 6 + 2 : Math.random() * 4 + 1
        });
      }
    }

    function strokePath(pts) {
      g.beginPath();
      g.moveTo(padX + pts[0].x, padY + pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(padX + pts[i].x, padY + pts[i].y);
    }

    function draw() {
      g.clearRect(0, 0, W, H);
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      g.save();
      g.beginPath();
      g.rect(padX, padY, padW, padH);
      g.clip();

      g.fillStyle = PAD_BG;
      g.fillRect(padX, padY, padW, padH);

      // grid
      g.strokeStyle = "rgba(255,255,255,0.05)";
      g.lineWidth = 1;
      for (let x = 0; x < padW; x += 40) {
        g.beginPath(); g.moveTo(padX + x, padY); g.lineTo(padX + x, padY + padH); g.stroke();
      }
      for (let y = 0; y < padH; y += 40) {
        g.beginPath(); g.moveTo(padX, padY + y); g.lineTo(padX + padW, padY + y); g.stroke();
      }

      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = state.brushSize;

      for (const s of state.strokes) {
        if (!s.points.length) continue;
        strokePath(s.points);
        g.strokeStyle = s.colour;
        if (state.glow) { g.shadowBlur = 15; g.shadowColor = s.colour; }
        g.stroke();
        g.shadowBlur = 0;
      }

      if (state.drawing && state.drawing.points.length > 1) {
        strokePath(state.drawing.points);
        g.strokeStyle = state.drawing.colour;
        if (state.glow) { g.shadowBlur = 15; g.shadowColor = state.drawing.colour; }
        g.stroke();
        g.shadowBlur = 0;
      }

      for (const p of particles) {
        g.globalAlpha = Math.max(0, p.life);
        g.fillStyle = p.colour;
        g.beginPath();
        g.arc(padX + p.x, padY + p.y, p.size, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;

      if (state.playing) {
        const x = padX + state.scanX;
        g.strokeStyle = "rgba(255,255,255,0.85)";
        g.lineWidth = 2;
        g.shadowBlur = 12;
        g.shadowColor = "#ffffff";
        g.beginPath();
        g.moveTo(x, padY);
        g.lineTo(x, padY + padH);
        g.stroke();
        g.shadowBlur = 0;
      }
      g.restore();
    }

    // ===================================================================== //
    // 4. Playing it back                                                    //
    // ===================================================================== //
    function setPlaying(on) {
      state.playing = on;
      playBtn.style.background = on ? "#ef4444" : "#22c55e";
      playBtn.innerHTML = on ? svg("square", 19, "#ffffff", "#ffffff") : svg("play", 21, "#ffffff", "#ffffff");
      if (!on) synth.stopAll();
    }

    function togglePlay() {
      if (state.playing) { setPlaying(false); return; }
      if (!state.strokes.length) return;
      state.scanX = 0;
      setPlaying(true);
      ctx.platform.interact({ kind: "play", strokes: state.strokes.length });
    }

    // The scanline sweeps and fires every point it crosses this frame. Speed is
    // per-frame in the original, so it is kept per-frame here.
    function advanceScan() {
      const prevX = state.scanX;
      state.scanX += state.playbackSpeed * 0.1 * 6;
      let wrapped = false;
      if (state.scanX >= padW) { state.scanX = state.scanX % padW; wrapped = true; }

      for (const s of state.strokes) {
        for (const p of s.points) {
          const hit = wrapped ? (p.x >= prevX || p.x < state.scanX)
                              : (p.x >= prevX && p.x < state.scanX);
          if (!hit) continue;
          synth.playNoteOneShot(s.instrument, p.ny, 0.2);
          if (state.playbackBursts) addParticle(p.x, p.y, s.colour, true);
        }
      }
    }

    // ===================================================================== //
    // 5. Hands on it                                                        //
    // ===================================================================== //
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      synth.init();
      ctx.platform.start();
      hint.style.opacity = "0";
    }

    function inPad(e) {
      return e.offsetX >= padX && e.offsetX <= padX + padW &&
             e.offsetY >= padY && e.offsetY <= padY + padH;
    }
    function point(e) {
      const x = Math.max(0, Math.min(padW, e.offsetX - padX));
      const y = Math.max(0, Math.min(padH, e.offsetY - padY));
      return { x: x, y: y, ny: 1 - y / padH };
    }

    ctx.listen(view, "pointerdown", (e) => {
      if (state.playing || !inPad(e)) return;
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      const p = point(e);
      const colour = state.rainbow ? "hsl(" + state.hue + ",100%,60%)" : colourOf[state.instrument];
      state.drawing = { instrument: state.instrument, colour: colour, points: [p], pointerId: e.pointerId };
      synth.startTone(state.instrument, p.ny, e.pointerId);
      if (state.particleTrails) addParticle(p.x, p.y, colour);
      ctx.platform.haptic("light");
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!state.drawing || state.playing) return;
      const p = point(e);
      if (state.rainbow) state.drawing.colour = "hsl(" + state.hue + ",100%,60%)";
      state.drawing.points.push(p);
      if (state.particleTrails) addParticle(p.x, p.y, state.drawing.colour);
      synth.updateTone(e.pointerId, p.ny);
    });

    const endStroke = (e) => {
      if (!state.drawing) return;
      synth.stopTone(e.pointerId);
      if (state.drawing.points.length) state.strokes.push(state.drawing);
      state.drawing = null;
      ctx.platform.interact({ kind: "stroke", instrument: state.instrument });
    };
    ctx.listen(view, "pointerup", endStroke);
    ctx.listen(view, "pointercancel", endStroke);
    ctx.listen(view, "lostpointercapture", endStroke);

    for (let i = 0; i < instBtns.length; i++) {
      const id = INSTRUMENTS[i].id;
      ctx.listen(instBtns[i], "pointerdown", (e) => {
        e.preventDefault();
        firstGesture();
        state.instrument = id;
        paintPalette();
        remember();
        ctx.platform.haptic("light");
      });
    }

    ctx.listen(nodes.undo, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      state.strokes.pop();
      ctx.platform.haptic("light");
    });
    ctx.listen(nodes.clear, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      state.strokes.length = 0;
      setPlaying(false);
      ctx.platform.haptic("medium");
    });
    ctx.listen(playBtn, "pointerdown", (e) => { e.preventDefault(); firstGesture(); togglePlay(); });
    ctx.listen(nodes.shop, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      nodes.shop_modal.style.display = "block";
      paintTiers();
    });
    ctx.listen(nodes.shop_close, "pointerdown", (e) => {
      e.preventDefault();
      nodes.shop_modal.style.display = "none";
    });
    for (const { btn, tier } of tierBtns) {
      ctx.listen(btn, "pointerdown", (e) => {
        e.preventDefault();
        firstGesture();
        // Tapping the active tier turns it back off, as in the original.
        state.volumeMultiplier = state.volumeMultiplier === tier.mult ? 1.0 : tier.mult;
        synth.setVolumeMultiplier(state.volumeMultiplier);
        paintTiers();
        remember();
        ctx.platform.haptic("medium");
      });
    }

    // ===================================================================== //
    // 6. Remember the instrument they picked                                //
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
        fireAndForget(() => ctx.storage.set("symphony", {
          instrument: state.instrument, volumeMultiplier: state.volumeMultiplier
        }));
      }, 400);
    }
    if (canStore) {
      try {
        const saved = await ctx.storage.get("symphony");
        if (saved && typeof saved === "object") {
          if (INSTRUMENTS.some((i) => i.id === saved.instrument)) state.instrument = saved.instrument;
          if (typeof saved.volumeMultiplier === "number" && saved.volumeMultiplier > 0) {
            state.volumeMultiplier = saved.volumeMultiplier;
          }
        }
      } catch (_) { /* first run */ }
    }

    // ===================================================================== //
    // 7. Go                                                                 //
    // ===================================================================== //
    ctx.onDestroy(() => { synth.close(); });

    paintPalette();
    paintTiers();
    layout();
    draw();
    ctx.markVisualReady("canvas drawn");
    ctx.platform.ready();

    ctx.onFrame((dt, now) => {
      if (ctx.width !== W || ctx.height !== H) layout();

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
      }
      if (state.rainbow) state.hue = (state.hue + 2) % 360;
      if (state.playing) advanceScan();

      draw();
    });
  }
};
