/**
 * Reshmi Dor — braid a rakhi out of silk, one crossing at a time.
 *
 * Rakhshabandhan starts with a thread. This is the thread: three strands of
 * silk that plait themselves under your finger, wind into a ring, and finish as
 * a rakhi you can spin in your hand.
 *
 * The braid is not an animation. It is the real three-strand plait, solved:
 *
 *   Put the three strands at phases 0, 2pi/3, 4pi/3 of one angle u, and let
 *     lateral(u) = A * cos(u)         (where the strand sits across the cord)
 *     depth(u)   = B * sin(2u)        (how far in front of the cord it rides)
 *
 *   Two strands meet when their cosines agree, which happens every pi/3 of u —
 *   so a crossing every pi/3, forty-odd of them around a ring. sin(2u) is
 *   positive exactly over the half-cycles where |cos u| is falling, i.e. while a
 *   strand is travelling inward — so the strand moving toward the middle always
 *   passes in front of the one leaving it. That is the over-under rule of a
 *   plait, and it falls out of the parametrisation rather than being drawn on.
 *
 * Your finger drives u. Distance moved becomes cord; speed sets the pitch, so a
 * slow rub packs the crossings tight and a fast one lets them run long. The
 * loose ends past the braid tip sway with your hand and get eaten as you go.
 * Nobody else's cord has your rhythm in it.
 *
 * Sound is the crossings: a plucked string per crossing, walking up Raga Desh
 * when you braid upward and back down it when you braid down — Desh being the
 * monsoon raga, and Rakshabandhan falling in Shravan. Strings are Karplus-
 * Strong (a burst of noise fed round a delay line), so they are genuinely
 * plucked rather than sampled, and a four-string tanpura cycles underneath.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule). Every texture and
 * every sound is generated in-file — packaged assets are disabled.
 */
window.plethoraBit = {
  meta: {
    title: "Reshmi Dor",
    runtime: "plethora-bit@2",
    tags: ["3d", "art", "craft", "generative", "relaxing"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Small helpers                                                      //
    // ===================================================================== //
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);

    // Offscreen bakes: the runtime owns every canvas in the DOM, so textures go
    // to an OffscreenCanvas. If the WebView has none we borrow a hidden SDK
    // canvas rather than lose the texture.
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function surface(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (CAN_BAKE) {
        try { return new OffscreenCanvas(w, h); } catch (_) { /* fall through */ }
      }
      const c = ctx.createCanvas2D();
      c.style.display = "none";
      c.width = w; c.height = h;
      return c;
    }

    // ===================================================================== //
    // 1. Palettes — six silk sets, each three strands and a metal            //
    // ===================================================================== //
    const PALETTES = [
      { name: "Kesari",  silk: [0xf07b2a, 0xffcf5c, 0xb3231f], metal: 0xf3c85c, gem: 0xff8a3d },
      { name: "Mor",     silk: [0x14a5ad, 0x2a55c8, 0x46e0bd], metal: 0xd8c26a, gem: 0x24d3c6 },
      { name: "Chandan", silk: [0xf3e3cb, 0xd9a06b, 0xe4708f], metal: 0xe8c98d, gem: 0xffd7c2 },
      { name: "Gulaal",  silk: [0xd8207a, 0xff5fa2, 0xff9a3c], metal: 0xf6cf7a, gem: 0xff4fa0 },
      { name: "Neel",    silk: [0x3a45d8, 0x8b5cf0, 0xd8dcf6], metal: 0xc9d2e8, gem: 0x8f7bff },
      { name: "Haldi",   silk: [0xffd21e, 0x86cc45, 0xfff6dc], metal: 0xf0d27a, gem: 0xd8ff7a }
    ];

    const CHARMS = [
      { id: "bead",   label: "bead",   glyph: "●" },
      { id: "pearl",  label: "pearl",  glyph: "○" },
      { id: "mirror", label: "mirror", glyph: "◆" },
      { id: "bell",   label: "ghungroo", glyph: "❀" }
    ];

    const NAME_TAIL = ["Dor", "Dhaaga", "Bandhan", "Ganth", "Laher", "Rakhi"];

    // ===================================================================== //
    // 2. First frame — a painted card, before three streams in              //
    // ===================================================================== //
    // The render surface is claimed first so the interface root lands above it.
    const view = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "4";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);

    const INK = "#f6e8d2";
    const DIM = "rgba(246,232,210,0.55)";
    const GOLD = "#f0c453";

    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Devanagari',sans-serif";

    ui.innerHTML =
      '<div data-el="stage" style="position:absolute;inset:0;overflow:hidden;pointer-events:none;' +
      'font-family:' + FONT + ';-webkit-user-select:none;user-select:none;' +
      '-webkit-tap-highlight-color:transparent;color:' + INK + ';">' +

      // ---- top bar --------------------------------------------------------
      '<div data-el="top" style="position:absolute;left:0;right:0;top:' + (SAFE_T + 6) + 'px;' +
      'padding:0 18px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;' +
      'transition:opacity 420ms ease;">' +
        '<div>' +
          '<div style="font-size:19px;font-weight:700;letter-spacing:0.3px;line-height:1.05;">Reshmi Dor</div>' +
          '<div data-el="sub" style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;' +
          'color:' + DIM + ';margin-top:3px;">रेशमी डोर</div>' +
        '</div>' +
        '<button data-el="help" style="pointer-events:auto;width:34px;height:34px;border-radius:17px;' +
        'border:1px solid rgba(240,196,83,0.45);background:rgba(24,10,14,0.5);color:' + GOLD + ';' +
        'font-size:15px;font-weight:600;font-family:inherit;padding:0;">?</button>' +
      '</div>' +

      // ---- progress -------------------------------------------------------
      '<div data-el="prog" style="position:absolute;left:18px;right:18px;top:' + (SAFE_T + 52) + 'px;">' +
        '<div style="height:3px;border-radius:2px;background:rgba(246,232,210,0.14);overflow:hidden;">' +
          '<div data-el="bar" style="height:100%;width:0%;border-radius:2px;background:' + GOLD + ';' +
          'box-shadow:0 0 10px rgba(240,196,83,0.6);transition:width 90ms linear;"></div>' +
        '</div>' +
        '<div data-el="hint" style="margin-top:7px;font-size:11.5px;letter-spacing:0.4px;color:' + DIM + ';">' +
        'rub anywhere to braid</div>' +
      '</div>' +

      // ---- caption for the finished rakhi ---------------------------------
      '<div data-el="card" style="position:absolute;left:18px;right:18px;top:' + (SAFE_T + 44) + 'px;' +
      'text-align:center;opacity:0;transition:opacity 500ms ease;">' +
        '<div data-el="cardname" style="font-size:24px;font-weight:700;letter-spacing:0.4px;"></div>' +
        '<div data-el="cardsub" style="font-size:11.5px;letter-spacing:1.4px;text-transform:uppercase;' +
        'color:' + DIM + ';margin-top:5px;"></div>' +
      '</div>' +

      // ---- bottom panel ---------------------------------------------------
      '<div data-el="shelfwrap" style="position:absolute;left:0;right:0;bottom:' + (SAFE_B + 212) + 'px;' +
      'padding:0 16px;display:flex;justify-content:center;">' +
        '<div data-el="shelf" style="display:none;gap:8px;flex-wrap:wrap;justify-content:center;max-width:320px;' +
        'background:rgba(10,4,8,0.94);padding:11px 12px;border-radius:18px;' +
        'border:1px solid rgba(240,196,83,0.28);box-shadow:0 10px 30px rgba(0,0,0,0.5);"></div>' +
      '</div>' +

      '<div data-el="panel" style="position:absolute;left:0;right:0;bottom:' + (SAFE_B + 12) + 'px;' +
      'padding:0 16px;display:flex;flex-direction:column;align-items:center;gap:11px;">' +

        '<button data-el="tie" style="pointer-events:auto;display:none;width:100%;max-width:320px;height:50px;' +
        'border-radius:25px;border:0;background:' + GOLD + ';color:#2a1206;font-size:15.5px;font-weight:700;' +
        'letter-spacing:0.6px;font-family:inherit;box-shadow:0 6px 24px rgba(240,196,83,0.35);">Tie it</button>' +

        '<div data-el="again" style="display:none;gap:10px;width:100%;max-width:340px;">' +
          '<button data-el="new" style="pointer-events:auto;flex:1;height:48px;border-radius:24px;border:0;' +
          'background:' + GOLD + ';color:#2a1206;font-size:14.5px;font-weight:700;font-family:inherit;">Braid another</button>' +
          '<button data-el="box" style="pointer-events:auto;flex:1;height:48px;border-radius:24px;' +
          'border:1px solid rgba(246,232,210,0.3);background:rgba(24,10,14,0.55);color:' + INK + ';' +
          'font-size:14.5px;font-weight:600;font-family:inherit;">My box</button>' +
        '</div>' +

        '<div data-el="charms" style="display:flex;gap:9px;"></div>' +
        '<div data-el="swatches" style="display:flex;gap:9px;"></div>' +
      '</div>' +

      // ---- instructions ---------------------------------------------------
      '<div data-el="sheet" style="position:absolute;inset:0;display:none;pointer-events:auto;' +
      'background:rgba(12,5,8,0.86);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);' +
      'align-items:center;justify-content:center;padding:26px;">' +
        '<div style="max-width:330px;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">How to braid</div>' +
          '<div style="font-size:14px;line-height:1.75;color:rgba(246,232,210,0.86);">' +
            '• Rub anywhere on the silk to braid. The three strands weave as you move.<br>' +
            '• Rub slowly for a tight plait, quickly for a long, loose one.<br>' +
            '• Tap a colour to change the silk from that point on.<br>' +
            '• Tap a charm to thread it onto the next crossing.<br>' +
            '• Fill the ring, then tie it. Every rakhi keeps the rhythm of your hand.<br>' +
            '• Once it is tied, a colour tap re-dyes the pendant, and My box keeps the ones you made.' +
          '</div>' +
          '<button data-el="close" style="pointer-events:auto;margin-top:22px;width:100%;height:46px;' +
          'border-radius:23px;border:0;background:' + GOLD + ';color:#2a1206;font-size:15px;font-weight:700;' +
          'font-family:inherit;">Start braiding</button>' +
        '</div>' +
      '</div>' +

      // ---- loading curtain, up until the scene exists ----------------------
      '<div data-el="curtain" style="position:absolute;inset:0;pointer-events:auto;' +
      'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;' +
      'background:radial-gradient(120% 90% at 50% 38%, #3a1020 0%, #1b0710 55%, #0a0308 100%);">' +
        '<div style="font-size:30px;font-weight:700;letter-spacing:0.5px;">Reshmi Dor</div>' +
        '<div style="font-size:12px;letter-spacing:2.4px;text-transform:uppercase;color:' + DIM + ';">' +
        'spinning the silk</div>' +
      '</div>' +
      '</div>';

    const el = (n) => ui.querySelector('[data-el="' + n + '"]');
    const nodes = {
      stage: el("stage"), top: el("top"), prog: el("prog"), bar: el("bar"), hint: el("hint"),
      card: el("card"), cardname: el("cardname"), cardsub: el("cardsub"),
      panel: el("panel"), tie: el("tie"), again: el("again"), newBtn: el("new"), boxBtn: el("box"),
      charms: el("charms"), swatches: el("swatches"), shelf: el("shelf"),
      sheet: el("sheet"), close: el("close"), help: el("help"), curtain: el("curtain")
    };

    // The card is painted, so the host can drop its loader.
    ctx.markVisualReady("title");
    ctx.platform.ready();

    // ---- palette + charm buttons, built from the tables above -------------
    function hex(n) { return "#" + ("000000" + n.toString(16)).slice(-6); }

    let palette = 0;
    let armedCharm = null;
    const swatchEls = [];
    const charmEls = [];

    PALETTES.forEach((p, i) => {
      const b = document.createElement("button");
      b.style.cssText =
        "pointer-events:auto;width:38px;height:38px;border-radius:19px;padding:0;overflow:hidden;" +
        "display:flex;flex-direction:column;border:2px solid rgba(246,232,210,0.22);" +
        "background:#000;transition:transform 140ms ease,border-color 140ms ease;font-family:inherit;";
      for (const c of p.silk) {
        const s = document.createElement("div");
        s.style.cssText = "flex:1;width:100%;";
        s.style.backgroundColor = hex(c);
        b.appendChild(s);
      }
      b.setAttribute("aria-label", p.name);
      swatchEls.push(b);
      nodes.swatches.appendChild(b);
      ctx.listen(b, "click", () => choosePalette(i));
    });

    CHARMS.forEach((c) => {
      const b = document.createElement("button");
      b.style.cssText =
        "pointer-events:auto;min-width:56px;height:44px;border-radius:14px;padding:0 10px;" +
        "border:1px solid rgba(246,232,210,0.2);background:rgba(24,10,14,0.55);color:" + INK + ";" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;" +
        "font-family:inherit;transition:border-color 140ms ease,background 140ms ease;";
      b.innerHTML =
        '<span style="font-size:13px;line-height:1;color:' + GOLD + ';">' + c.glyph + '</span>' +
        '<span style="font-size:9px;letter-spacing:0.6px;opacity:0.7;">' + c.label + '</span>';
      charmEls.push(b);
      nodes.charms.appendChild(b);
      ctx.listen(b, "click", () => armCharm(c.id));
    });

    function paintButtons() {
      swatchEls.forEach((b, i) => {
        const on = i === palette;
        b.style.borderColor = on ? GOLD : "rgba(246,232,210,0.22)";
        b.style.transform = on ? "scale(1.14)" : "scale(1)";
      });
      charmEls.forEach((b, i) => {
        const on = CHARMS[i].id === armedCharm;
        b.style.borderColor = on ? GOLD : "rgba(246,232,210,0.2)";
        b.style.background = on ? "rgba(240,196,83,0.16)" : "rgba(24,10,14,0.55)";
      });
    }
    paintButtons();

    // ===================================================================== //
    // 3. Sound — plucked strings, a tanpura, chimes and the rub of silk      //
    // ===================================================================== //
    // Every voice is synthesised here. Karplus-Strong gives a genuinely
    // plucked string: a burst of filtered noise pushed round a delay line one
    // period long, low-passed a little on each lap so the highs die first.
    const AC = (window.AudioContext || window.webkitAudioContext) || null;
    const canAudio = !!AC && ctx.capabilities.audio !== false;
    const canMusic = ctx.capabilities.backgroundMusic !== false;
    let ac = null, master = null, rubGain = null, rubFilter = null, rubSrc = null;
    let voiceBus = null, verbBus = null;
    let muted = false;

    // Raga Desh, the monsoon raga — Shravan, the month Rakshabandhan falls in.
    // Ascending leans on S R M P N; descending fills in n D G.
    const AROH = [0, 2, 5, 7, 11, 12, 14, 17];
    const AVROH = [24, 22, 21, 19, 17, 16, 14, 12, 10, 9, 7, 5, 4, 2, 0];
    const SA = 146.83;   // D3, a comfortable tonic for a plucked cord

    function noteHz(semi) { return SA * Math.pow(2, semi / 12); }

    // Four base strings, a fourth apart; anything else is one of these shifted
    // by playbackRate. Four buffers instead of a dozen, and the timbre never
    // strays more than about a third from where it was rendered.
    const BASES = [146.83, 196.0, 261.63, 349.23];
    let baseBuf = null;

    function ksBuffer(freq, seconds, damp, bright) {
      const sr = ac.sampleRate;
      const n = Math.max(2, Math.round(sr / freq));
      const len = Math.max(1, Math.ceil(sr * seconds));
      const buf = ac.createBuffer(1, len, sr);
      const out = buf.getChannelData(0);
      const ring = new Float32Array(n);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const white = Math.random() * 2 - 1;
        lp += (white - lp) * bright;
        ring[i] = lp;
      }
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const cur = ring[idx];
        const nxt = ring[(idx + 1) % n];
        out[i] = cur;
        ring[idx] = (cur + nxt) * 0.5 * damp;
        idx = (idx + 1) % n;
      }
      // Fade the tail so a truncated buffer never clicks.
      const fade = Math.min(len, Math.floor(sr * 0.12));
      for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
      return buf;
    }

    function noiseBuffer(seconds) {
      const sr = ac.sampleRate;
      const len = Math.ceil(sr * seconds);
      const buf = ac.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function startAudio() {
      if (ac || !canAudio) return;
      try { ac = new AC(); } catch (_) { ac = null; return; }

      master = ac.createGain();
      master.gain.value = 0.0;
      master.connect(ac.destination);
      master.gain.setTargetAtTime(0.85, ac.currentTime, 1.2);

      // A short feedback-delay reverb — two taps and a lowpass is enough to put
      // the strings in a room without a convolution buffer.
      verbBus = ac.createGain();
      verbBus.gain.value = 0.34;
      const dl = ac.createDelay(0.6);
      dl.delayTime.value = 0.129;
      const fb = ac.createGain();
      fb.gain.value = 0.45;
      const damp = ac.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2600;
      verbBus.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl);
      damp.connect(master);

      voiceBus = ac.createGain();
      voiceBus.gain.value = 1;
      voiceBus.connect(master);
      voiceBus.connect(verbBus);

      baseBuf = BASES.map((f) => ksBuffer(f, 2.2, 0.9965, 0.55));

      // The rub: white noise through a bandpass whose gain and cutoff follow
      // how fast the finger is moving.
      rubSrc = ac.createBufferSource();
      rubSrc.buffer = noiseBuffer(2.0);
      rubSrc.loop = true;
      rubFilter = ac.createBiquadFilter();
      rubFilter.type = "bandpass";
      rubFilter.frequency.value = 900;
      rubFilter.Q.value = 0.9;
      rubGain = ac.createGain();
      rubGain.gain.value = 0;
      rubSrc.connect(rubFilter); rubFilter.connect(rubGain); rubGain.connect(master);
      try { rubSrc.start(); } catch (_) { /* already running */ }

      startTanpura();
    }

    function resumeAudio() {
      if (!ac) { startAudio(); return; }
      if (ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
    }

    // Pluck a string at a given semitone above Sa.
    function pluck(semi, gain, pan) {
      if (!ac || muted || !baseBuf) return;
      const f = noteHz(semi);
      let bi = 0, best = 1e9;
      for (let i = 0; i < BASES.length; i++) {
        const d = Math.abs(Math.log(f / BASES[i]));
        if (d < best) { best = d; bi = i; }
      }
      const src = ac.createBufferSource();
      src.buffer = baseBuf[bi];
      src.playbackRate.value = f / BASES[bi];
      const g = ac.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, ac.currentTime);
      g.gain.linearRampToValueAtTime(gain, ac.currentTime + 0.006);
      const tone = ac.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 3400;
      src.connect(tone); tone.connect(g);
      if (typeof ac.createStereoPanner === "function") {
        const p = ac.createStereoPanner();
        p.pan.value = clamp(pan || 0, -1, 1);
        g.connect(p); p.connect(voiceBus);
      } else {
        g.connect(voiceBus);
      }
      try { src.start(); } catch (_) {}
      const dur = (src.buffer.duration / src.playbackRate.value);
      try { src.stop(ac.currentTime + Math.min(dur, 2.6)); } catch (_) {}
    }

    // A bell: two sines an inharmonic ratio apart, both decaying fast.
    function chime(f, gain, dur) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 1.1));
      g.connect(voiceBus); g.connect(verbBus);
      for (const [mult, amp] of [[1, 1], [2.76, 0.42], [5.4, 0.16]]) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = f * mult;
        const og = ac.createGain();
        og.gain.value = amp;
        o.connect(og); og.connect(g);
        o.start(t);
        o.stop(t + (dur || 1.1) + 0.05);
      }
    }

    // The tanpura: Pa, Sa, Sa, Sa' round and round, quietly, forever.
    const TANPURA = [-5, 0, 0, 12];
    let tanIdx = 0, tanNext = 0;
    function startTanpura() {
      tanNext = ac.currentTime + 0.6;
      ctx.interval(() => {
        if (!ac || muted || ac.state !== "running") return;
        while (tanNext < ac.currentTime + 0.5) {
          const semi = TANPURA[tanIdx % TANPURA.length] - 12;
          scheduleTanpura(semi, tanNext);
          tanIdx++;
          tanNext += 1.05;
        }
      }, 240);
    }
    function scheduleTanpura(semi, when) {
      if (!baseBuf) return;
      const f = noteHz(semi);
      let bi = 0, best = 1e9;
      for (let i = 0; i < BASES.length; i++) {
        const d = Math.abs(Math.log(f / BASES[i]));
        if (d < best) { best = d; bi = i; }
      }
      const src = ac.createBufferSource();
      src.buffer = baseBuf[bi];
      src.playbackRate.value = f / BASES[bi];
      const g = ac.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.075, when + 0.02);
      g.gain.setTargetAtTime(0.0001, when + 0.5, 0.7);
      const tone = ac.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 1500;
      src.connect(tone); tone.connect(g); g.connect(voiceBus);
      try { src.start(when); src.stop(when + 2.4); } catch (_) {}
    }

    let rubAudioAt = 0, rubFreqSm = 900;
    function setRub(speed01) {
      if (!ac || muted || !rubGain) return;
      const t = ac.currentTime;
      rubFreqSm += (700 + 2100 * speed01 - rubFreqSm) * 0.2;
      // Sending new automation every frame stacks events on the param and can
      // destabilise the filter; twelve times a second is plenty for a rub.
      if (t - rubAudioAt < 0.08) return;
      rubAudioAt = t;
      rubGain.gain.setTargetAtTime(0.028 * speed01, t, 0.07);
      rubFilter.frequency.value = rubFreqSm;
    }

    // A fallback for WebViews with no AudioContext at all.
    function sting(name) {
      if (ac || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    ctx.onDestroy(() => {
      try { if (rubSrc) rubSrc.stop(); } catch (_) {}
      try { if (ac) ac.close(); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 400 }); } catch (_) {}
    });

    // ===================================================================== //
    // 4. Three, then the room the silk hangs in                             //
    // ===================================================================== //
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    let THREE = null;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (_) {
      try { THREE = await ctx.importModule(THREE_URL); } catch (e2) { THREE = null; }
    }

    if (!THREE) {
      nodes.curtain.innerHTML =
        '<div style="text-align:center;padding:30px;font-family:' + FONT + ';color:' + INK + ';">' +
        '<div style="font-size:19px;font-weight:700;margin-bottom:10px;">Reshmi Dor</div>' +
        '<div style="font-size:13.5px;line-height:1.6;opacity:0.75;">This bit needs 3D, and it could not ' +
        'start here. Try opening it again in the Plethora app.</div></div>';
      ctx.platform.error({ where: "three_import" });
      return;
    }

    let W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);

    const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 120);
    camera.position.set(0, 0, 5.6);

    ctx.onDestroy(() => { try { renderer.dispose(); } catch (_) {} });

    // ---- baked textures ---------------------------------------------------
    // A height field of fine diagonal ridges, differentiated into a normal map.
    // This is what makes the silk read as thread rather than plastic tubing.
    function bakeFibre(size) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const h = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const diag = (x * 0.82 + y * 0.30);
          let v = Math.sin(diag * 0.86) * 0.5 + Math.sin(diag * 2.13 + 1.7) * 0.22;
          v += Math.sin((x * 0.37 - y * 0.91) * 1.9) * 0.12;
          v += (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1) * 0.06;
          h[y * size + x] = v;
        }
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const l = h[y * size + ((x - 1 + size) % size)];
          const r = h[y * size + ((x + 1) % size)];
          const u = h[((y - 1 + size) % size) * size + x];
          const dn = h[((y + 1) % size) * size + x];
          let nx = (l - r) * 1.5, ny = (u - dn) * 1.5, nz = 1;
          const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
          const i = (y * size + x) * 4;
          d[i] = (nx * inv * 0.5 + 0.5) * 255;
          d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
          d[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
          d[i + 3] = 255;
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      return t;
    }

    // A soft round blob, used for dust motes and every glow in the scene.
    function bakeGlow(size, hardness) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const c = (size - 1) / 2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x - c) / c, dy = (y - c) / c;
          const r = Math.sqrt(dx * dx + dy * dy);
          const a = Math.pow(Math.max(0, 1 - r), hardness || 2.4);
          const i = (y * size + x) * 4;
          d[i] = 255; d[i + 1] = 244; d[i + 2] = 222;
          d[i + 3] = Math.round(a * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    // A marigold petal: an alpha teardrop with a warm gradient painted by hand
    // in pixels, so no gradient stop has to resolve a runtime colour.
    function bakePetal(size) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const nx = (x / (size - 1)) * 2 - 1;
          const ny = y / (size - 1);
          // teardrop: width tapers toward both ends, fattest at 0.62
          const w = Math.sin(Math.pow(ny, 0.72) * Math.PI) * 0.92;
          const inside = Math.abs(nx) < w ? 1 : 0;
          const edge = inside ? Math.min(1, (w - Math.abs(nx)) * 7) : 0;
          const shade = 0.55 + 0.45 * (1 - ny) + 0.18 * (1 - Math.abs(nx) / Math.max(0.01, w));
          const i = (y * size + x) * 4;
          d[i] = Math.min(255, 255 * shade);
          d[i + 1] = Math.min(255, 176 * shade);
          d[i + 2] = Math.min(255, 60 * shade);
          d[i + 3] = Math.round(edge * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    // The room: a warm equirect that lights the gold and sits behind everything.
    function bakeRoom() {
      const w = 512, h = 256;
      const cv = surface(w, h);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const grad = g2.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#3d0f22");
      grad.addColorStop(0.42, "#1e0714");
      grad.addColorStop(0.78, "#12040c");
      grad.addColorStop(1, "#050205");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, w, h);
      // Three warm lamps and one cool one, painted as discs so the gold has
      // something with shape to reflect.
      const lamp = (cx, cy, r, inner, mid) => {
        for (const ox of [-w, 0, w]) {
          const rg = g2.createRadialGradient(cx + ox, cy, 1, cx + ox, cy, r);
          rg.addColorStop(0, inner);
          rg.addColorStop(0.4, mid);
          rg.addColorStop(1, "rgba(0,0,0,0)");
          g2.fillStyle = rg;
          g2.fillRect(0, 0, w, h);
        }
      };
      lamp(w * 0.20, h * 0.30, w * 0.20, "#ffd9a0", "#7a4526");
      lamp(w * 0.62, h * 0.24, w * 0.14, "#ffb066", "#59301c");
      lamp(w * 0.86, h * 0.44, w * 0.12, "#ff6fa8", "#54203a");
      lamp(w * 0.42, h * 0.72, w * 0.16, "#3f5f8a", "#191f2e");
      const t = new THREE.CanvasTexture(cv);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }

    const texFibre = bakeFibre(256);
    const texGlow = bakeGlow(64, 2.6);
    const texPetal = bakePetal(64);

    // The room that *lights* the gold is far brighter than the room you should
    // *see*. Painting one texture and using it for both washed the backdrop out
    // to flat brown, so the backdrop is baked separately and much darker.
    function bakeBackdrop() {
      const w = 512, h = 256;
      const cv = surface(w, h);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const grad = g2.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#0a0208");
      grad.addColorStop(0.34, "#2a0716");
      grad.addColorStop(0.52, "#3a0c1e");
      grad.addColorStop(0.72, "#160410");
      grad.addColorStop(1, "#050104");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, w, h);
      const pool = (cx, cy, r, inner, mid) => {
        for (const ox of [-w, 0, w]) {
          const rg = g2.createRadialGradient(cx + ox, cy, 1, cx + ox, cy, r);
          rg.addColorStop(0, inner);
          rg.addColorStop(0.5, mid);
          rg.addColorStop(1, "rgba(0,0,0,0)");
          g2.fillStyle = rg;
          g2.fillRect(0, 0, w, h);
        }
      };
      pool(w * 0.5, h * 0.46, w * 0.30, "rgba(122,38,58,0.55)", "rgba(60,14,32,0.30)");
      pool(w * 0.14, h * 0.36, w * 0.13, "rgba(150,74,34,0.30)", "rgba(60,26,12,0.14)");
      pool(w * 0.82, h * 0.58, w * 0.15, "rgba(52,32,96,0.34)", "rgba(20,12,44,0.16)");
      const t = new THREE.CanvasTexture(cv);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }

    const roomTex = bakeRoom();
    const backTex = bakeBackdrop();
    if (roomTex) {
      scene.background = backTex || roomTex;
      scene.backgroundIntensity = backTex ? 1 : 0.4;
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        scene.environment = pmrem.fromEquirectangular(roomTex).texture;
        scene.environmentIntensity = 1.15;
        pmrem.dispose();
      } catch (_) {
        scene.environment = roomTex;
      }
    } else {
      scene.background = new THREE.Color(0x140510);
    }

    // ---- lights -----------------------------------------------------------
    scene.add(new THREE.AmbientLight(0x4a2a3c, 1.0));

    const key = new THREE.DirectionalLight(0xffeed4, 2.6);
    key.position.set(2.4, 3.4, 3.2);
    scene.add(key);

    const rim = new THREE.PointLight(0xff85ad, 9, 18, 2);
    rim.position.set(-3.2, -1.9, -1.2);
    scene.add(rim);

    // a warm kicker from behind, so the silk keeps a lit edge against the dark
    const back = new THREE.DirectionalLight(0xffcf9a, 1.15);
    back.position.set(-1.6, 1.1, -3.2);
    scene.add(back);

    const fill = new THREE.PointLight(0x9dc0ff, 2.6, 14, 2);
    fill.position.set(2.6, -2.2, 1.4);
    scene.add(fill);

    // The pendant faces the camera, so without a light on this side its gold
    // only ever reflects the dark half of the room.
    const front = new THREE.PointLight(0xfff0dc, 5.5, 12, 2);
    front.position.set(0.7, 0.5, 2.6);
    scene.add(front);

    // ---- dust -------------------------------------------------------------
    const DUST = 170;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(DUST * 3);
    const dustSeed = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = rnd(-4.2, 4.2);
      dustPos[i * 3 + 1] = rnd(-4.6, 4.6);
      dustPos[i * 3 + 2] = rnd(-3.4, 2.2);
      dustSeed[i * 3] = rnd(0, TAU);
      dustSeed[i * 3 + 1] = rnd(0.15, 0.5);
      dustSeed[i * 3 + 2] = rnd(0.3, 1);
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.075, map: texGlow, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffd9a0, opacity: 0.5, sizeAttenuation: true
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    // A soft pool of light behind the rakhi, so the silk has something to sit
    // against instead of floating in a flat wash.
    if (texGlow) {
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 9),
        new THREE.MeshBasicMaterial({
          map: texGlow, color: 0x8e2f4c, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      pool.position.set(0, 0, -3.2);
      scene.add(pool);
    }

    // Everything that belongs to the rakhi hangs off this, so the whole object
    // can be spun as one.
    const rig = new THREE.Group();
    scene.add(rig);

    // ===================================================================== //
    // 5. The cord — three tubes written into pre-allocated buffers           //
    // ===================================================================== //
    // Rebuilding tube geometry every frame would cost more than the whole
    // scene, so each strand owns fixed buffers and the braid simply extends
    // its draw range. Committed samples are never rewritten; only the loose
    // tip past the head is redrawn, and that is what sways with your hand.
    const RING_R = 1.5;
    const LAT = 0.095;                 // how far a strand swings across the cord
    const DEP = 0.080;                 // how far it rides in front of the cord
    const TUBE_R = 0.056;
    const SEG = 0.022;                 // arc length between rings of vertices
    const LIVE = 26;                   // loose samples past the braid head
    const SAMPLES = 500;
    const RAD = 7;                     // faces around a strand
    const RADV = RAD + 1;              // one duplicated vertex closes the UV seam
    const TOTAL = TAU * RING_R;
    const A0 = Math.PI / 2;            // the cord starts, and closes, at the top
    const PHASE = [0, TAU / 3, (TAU * 2) / 3];
    const CROSS = Math.PI / 3;         // one crossing per pi/3 of twist

    const strands = [];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(SAMPLES * RADV * 3);
      const nor = new Float32Array(SAMPLES * RADV * 3);
      const uv = new Float32Array(SAMPLES * RADV * 2);
      const col = new Float32Array(SAMPLES * RADV * 3);
      const idx = new Uint16Array((SAMPLES - 1) * RAD * 6);
      let k = 0;
      for (let s = 0; s < SAMPLES - 1; s++) {
        for (let j = 0; j < RAD; j++) {
          const a = s * RADV + j, b = s * RADV + j + 1;
          const c = (s + 1) * RADV + j + 1, d = (s + 1) * RADV + j;
          idx[k++] = a; idx[k++] = b; idx[k++] = c;
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
        }
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.setDrawRange(0, 0);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), RING_R + 1.4);

      const mat = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.55,
        metalness: 0.0,
        sheen: 0.55,
        sheenRoughness: 0.38,
        sheenColor: new THREE.Color(0x7a6450),
        clearcoat: 0.1,
        clearcoatRoughness: 0.5,
        envMapIntensity: 0.45,
        normalMap: texFibre || null,
        normalScale: texFibre ? new THREE.Vector2(0.62, 0.62) : undefined
      });
      if (texFibre) { texFibre.repeat.set(1, 1); }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      rig.add(mesh);
      strands.push({ geo: geo, mat: mat, pos: pos, nor: nor, uv: uv, col: col });
    }

    // Write one ring of vertices for strand `st` at sample index `si`.
    function writeRing(st, si, px, py, pz, tx, ty, tz, radius, cr, cg, cb, uCoord) {
      let tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // side = normalise(tangent x zAxis); the tangent never approaches z, so
      // this frame is stable the whole way round the ring.
      let sx = ty, sy = -tx, sz = 0;
      let l = Math.sqrt(sx * sx + sy * sy) || 1;
      sx /= l; sy /= l;
      let nx = sy * tz - sz * ty, ny = sz * tx - sx * tz, nz = sx * ty - sy * tx;
      l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const base = si * RADV;
      for (let j = 0; j <= RAD; j++) {
        const ang = (j / RAD) * TAU;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const dx = sx * ca + nx * sa, dy = sy * ca + ny * sa, dz = sz * ca + nz * sa;
        const o = (base + j) * 3;
        st.pos[o] = px + dx * radius;
        st.pos[o + 1] = py + dy * radius;
        st.pos[o + 2] = pz + dz * radius;
        st.nor[o] = dx; st.nor[o + 1] = dy; st.nor[o + 2] = dz;
        st.col[o] = cr; st.col[o + 1] = cg; st.col[o + 2] = cb;
        const o2 = (base + j) * 2;
        st.uv[o2] = uCoord;
        st.uv[o2 + 1] = j / RAD;
      }
    }

    // Where strand i sits at arc length s and twist u.
    function strandPos(out, i, s, u, splayAmt, swayAmt) {
      const a = A0 - s / RING_R;
      const ca = Math.cos(a), sa = Math.sin(a);
      const uu = u + PHASE[i];
      const lat = LAT * (1 + splayAmt * 2.6) * Math.cos(uu);
      const dep = DEP * (1 + splayAmt * 1.8) * Math.sin(2 * uu) + swayAmt;
      const r = RING_R + lat;
      out.x = r * ca; out.y = r * sa; out.z = dep;
    }

    // A mote of light at the head of the braid — where the silk is being made.
    let tipGlow = null;
    if (texGlow) {
      tipGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.9),
        new THREE.MeshBasicMaterial({
          map: texGlow, color: 0xffd9a0, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      rig.add(tipGlow);
    }

    // ---- braid state -------------------------------------------------------
    const cordCol = new THREE.Color();
    let arc = 0;            // committed arc length
    let twist = 0;          // committed twist phase
    let head = 0;           // committed samples written
    let crossCount = 0;     // crossings so far
    let lastCrossStep = 0;
    let pitch = 5.2;        // radians of twist per unit of cord
    let pitchTarget = 5.2;
    let ragaDir = 1;

    // What the finished object remembers, so a rakhi can be rebuilt exactly.
    let seed = {
      pal: 0,
      us: [],          // twist checkpoints, one per 16 samples
      cols: [[0, 0]],  // [arcFraction, paletteIndex]
      charms: []       // [arcFraction, charmId]
    };

    const pA = { x: 0, y: 0, z: 0 }, pB = { x: 0, y: 0, z: 0 };

    function shadeFor(i, si) {
      // A little per-sample variance keeps a long run of one colour alive.
      const n = Math.sin(si * 0.37 + i * 2.1) * 0.5 + Math.sin(si * 0.11 + i) * 0.5;
      return 0.88 + n * 0.14;
    }

    function commitSample(si, s, u, palIdx) {
      const pal = PALETTES[palIdx];
      for (let i = 0; i < 3; i++) {
        strandPos(pA, i, s, u, 0, 0);
        strandPos(pB, i, s + SEG * 0.5, u + SEG * 0.5 * pitch, 0, 0);
        cordCol.setHex(pal.silk[i]);
        const sh = shadeFor(i, si);
        writeRing(strands[i], si, pA.x, pA.y, pA.z,
          pB.x - pA.x, pB.y - pA.y, pB.z - pA.z,
          TUBE_R, cordCol.r * sh, cordCol.g * sh, cordCol.b * sh, s / 0.34);
      }
    }

    // The loose ends: the same curve continued past the head, splayed apart and
    // nudged by however hard the finger is moving.
    let swayPhase = 0;
    function writeLive(nowMs, energy) {
      const pal = PALETTES[palette];
      const n = Math.min(liveN, SAMPLES - head - 1);
      if (n <= 0) return head;
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const s = arc + k * SEG;
        const u = twist + k * SEG * pitch;
        const splay = f * f;
        for (let i = 0; i < 3; i++) {
          const sway = Math.sin(swayPhase * 3.1 + i * 2.0 + k * 0.32) * 0.055 * f * energy;
          strandPos(pA, i, s, u, splay, sway);
          strandPos(pB, i, s + SEG * 0.5, u + SEG * 0.5 * pitch, splay, sway);
          cordCol.setHex(pal.silk[i]);
          const sh = shadeFor(i, head + k);
          writeRing(strands[i], head + k, pA.x, pA.y, pA.z,
            pB.x - pA.x, pB.y - pA.y, pB.z - pA.z,
            TUBE_R * (1 - 0.5 * f * f), cordCol.r * sh, cordCol.g * sh, cordCol.b * sh, s / 0.34);
        }
      }
      return head + n;
    }

    function setDraw(lastSample) {
      const segs = Math.max(0, lastSample - 1);
      for (const st of strands) st.geo.setDrawRange(0, segs * RAD * 6);
    }

    // Uploading four whole attribute buffers every frame would push half a
    // megabyte a frame across the bus for the sake of the twenty-odd rings that
    // actually moved. Only the dirty span goes up.
    function flushRange(a, b) {
      a = Math.max(0, Math.min(SAMPLES - 1, a | 0));
      b = Math.max(a + 1, Math.min(SAMPLES, (b | 0) + 1));
      const s3 = a * RADV * 3, c3 = (b - a) * RADV * 3;
      const s2 = a * RADV * 2, c2 = (b - a) * RADV * 2;
      for (const st of strands) {
        const at = st.geo.attributes;
        if (at.position.addUpdateRange) {
          at.position.addUpdateRange(s3, c3);
          at.normal.addUpdateRange(s3, c3);
          at.color.addUpdateRange(s3, c3);
          at.uv.addUpdateRange(s2, c2);
        }
        at.position.needsUpdate = true;
        at.normal.needsUpdate = true;
        at.color.needsUpdate = true;
        at.uv.needsUpdate = true;
      }
    }

    // ---- charms ------------------------------------------------------------
    const charmMeshes = [];
    const goldMat = new THREE.MeshPhysicalMaterial({
      color: 0xffd066, metalness: 1, roughness: 0.21, envMapIntensity: 1.9
    });
    const pearlMat = new THREE.MeshPhysicalMaterial({
      color: 0xfff2e0, metalness: 0.1, roughness: 0.16,
      iridescence: 0.7, iridescenceIOR: 1.4, clearcoat: 1, clearcoatRoughness: 0.1,
      envMapIntensity: 1.1
    });
    const mirrorMat = new THREE.MeshPhysicalMaterial({
      color: 0xdfe8f2, metalness: 1, roughness: 0.045, envMapIntensity: 1.6
    });

    const geoBead = new THREE.SphereGeometry(0.092, 14, 10);
    const geoPearl = new THREE.SphereGeometry(0.082, 14, 10);
    const geoMirror = new THREE.CylinderGeometry(0.082, 0.082, 0.022, 8);
    const geoBell = new THREE.SphereGeometry(0.062, 12, 9);
    const geoBellRing = new THREE.TorusGeometry(0.03, 0.011, 6, 10);

    function charmAt(kind, s, u) {
      const g = new THREE.Group();
      let m;
      if (kind === "pearl") m = new THREE.Mesh(geoPearl, pearlMat);
      else if (kind === "mirror") m = new THREE.Mesh(geoMirror, mirrorMat);
      else if (kind === "bell") {
        m = new THREE.Mesh(geoBell, goldMat);
        const r = new THREE.Mesh(geoBellRing, goldMat);
        r.position.set(0, 0.072, 0);
        g.add(r);
      } else m = new THREE.Mesh(geoBead, goldMat);
      g.add(m);

      const a = A0 - s / RING_R;
      g.position.set(RING_R * Math.cos(a), RING_R * Math.sin(a), 0);
      g.rotation.z = a - Math.PI / 2;
      g.scale.setScalar(0.01);
      g.userData.grow = 0;
      rig.add(g);
      charmMeshes.push(g);
      return g;
    }

    // ===================================================================== //
    // 6. The pendant — medallion, tie-threads, tassels, petals               //
    // ===================================================================== //
    // A general dynamic tube, written with the same ring writer as the braid.
    function makeTube(nSamples, material) {
      const geo = new THREE.BufferGeometry();
      const t = {
        geo: geo, n: nSamples,
        pos: new Float32Array(nSamples * RADV * 3),
        nor: new Float32Array(nSamples * RADV * 3),
        uv: new Float32Array(nSamples * RADV * 2),
        col: new Float32Array(nSamples * RADV * 3)
      };
      const idx = new Uint16Array((nSamples - 1) * RAD * 6);
      let k = 0;
      for (let s = 0; s < nSamples - 1; s++) {
        for (let j = 0; j < RAD; j++) {
          const a = s * RADV + j, b = s * RADV + j + 1;
          const c = (s + 1) * RADV + j + 1, d = (s + 1) * RADV + j;
          idx[k++] = a; idx[k++] = b; idx[k++] = c;
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
        }
      }
      geo.setAttribute("position", new THREE.BufferAttribute(t.pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(t.nor, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(t.uv, 2));
      geo.setAttribute("color", new THREE.BufferAttribute(t.col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.setDrawRange(0, (nSamples - 1) * RAD * 6);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);
      t.mesh = new THREE.Mesh(geo, material);
      t.mesh.frustumCulled = false;
      t.flush = function () {
        geo.attributes.position.needsUpdate = true;
        geo.attributes.normal.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.attributes.uv.needsUpdate = true;
      };
      return t;
    }

    function silkMaterial(hexColour) {
      return new THREE.MeshPhysicalMaterial({
        color: hexColour,
        roughness: 0.6, metalness: 0,
        sheen: 0.55, sheenRoughness: 0.38, sheenColor: new THREE.Color(0x7a6450),
        clearcoat: 0.1, clearcoatRoughness: 0.5, envMapIntensity: 0.45,
        normalMap: texFibre || null
      });
    }

    const medallion = new THREE.Group();
    medallion.visible = false;
    const MEDAL = 1.3;                 // the pendant reads small at 1:1
    medallion.position.set(0, 0, 0.18);
    rig.add(medallion);

    let medalParts = [];
    const gemGeo = new THREE.IcosahedronGeometry(0.115, 0);
    const petalGeo = new THREE.SphereGeometry(0.5, 9, 6);
    const seedGeo = new THREE.SphereGeometry(0.026, 8, 6);

    function buildMedallion(palIdx) {
      for (const p of medalParts) {
        medallion.remove(p);
        if (p.geometry && p.geometry !== gemGeo && p.geometry !== petalGeo && p.geometry !== seedGeo) {
          try { p.geometry.dispose(); } catch (_) {}
        }
        if (p.material && p.material.dispose && p.userData.own) { try { p.material.dispose(); } catch (_) {} }
      }
      medalParts = [];
      const pal = PALETTES[palIdx];

      const add = (mesh, own) => { mesh.userData.own = !!own; medallion.add(mesh); medalParts.push(mesh); return mesh; };

      // a hammered gold plate behind everything
      const plate = add(new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, 0.05, 36), goldMat));
      plate.rotation.x = Math.PI / 2;

      // a raised rim
      const rimTorus = add(new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.026, 8, 40), goldMat));

      // two rings of silk petals, offset so the flower reads as layered
      const outerMat = silkMaterial(pal.silk[0]);
      const innerMat = silkMaterial(pal.silk[2]);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const p = add(new THREE.Mesh(petalGeo, outerMat), k === 0);
        p.scale.set(0.10, 0.22, 0.045);
        p.position.set(Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.03);
        p.rotation.z = a - Math.PI / 2;
        p.userData.bloom = 0.02 + (k % 3) * 0.012;
      }
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU + 0.35;
        const p = add(new THREE.Mesh(petalGeo, innerMat), k === 0);
        p.scale.set(0.085, 0.16, 0.04);
        p.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.075);
        p.rotation.z = a - Math.PI / 2;
        p.userData.bloom = 0.05 + (k % 2) * 0.02;
      }

      // seed beads round the rim
      const beads = new THREE.InstancedMesh(seedGeo, goldMat, 24);
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TAU;
        m4.makeTranslation(Math.cos(a) * 0.44, Math.sin(a) * 0.44, 0.045);
        beads.setMatrixAt(k, m4);
      }
      beads.instanceMatrix.needsUpdate = true;
      add(beads);

      // the stone in the middle
      const gemMat = new THREE.MeshPhysicalMaterial({
        color: pal.gem, metalness: 0.15, roughness: 0.06,
        iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [120, 520],
        clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.7,
        emissive: new THREE.Color(pal.gem), emissiveIntensity: 0.16
      });
      const gem = add(new THREE.Mesh(gemGeo, gemMat), true);
      gem.position.set(0, 0, 0.125);
      gem.userData.gem = true;

      // a soft halo so the stone reads as lit rather than painted
      if (texGlow) {
        const halo = add(new THREE.Mesh(
          new THREE.PlaneGeometry(1.5, 1.5),
          new THREE.MeshBasicMaterial({
            map: texGlow, color: pal.gem, transparent: true, opacity: 0.34,
            blending: THREE.AdditiveBlending, depthWrite: false
          })
        ), true);
        halo.position.set(0, 0, -0.06);
        halo.userData.halo = true;
      }
      return medallion;
    }

    // ---- the knot that closes the ring ------------------------------------
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.042, 8, 20), goldMat);
    knot.visible = false;
    rig.add(knot);

    // ---- two tie-threads with tassels --------------------------------------
    const TAIL_N = 30;
    const tails = [];
    for (let i = 0; i < 2; i++) {
      const dir = i === 0 ? -1 : 1;
      const mat = silkMaterial(0xffffff);   // vertex colours carry the hue
      mat.vertexColors = true;
      const tube = makeTube(TAIL_N, mat);
      tube.mesh.visible = false;
      rig.add(tube.mesh);

      // the tassel: a gold cap and a skirt of short silk threads
      const tas = new THREE.Group();
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.1, 0.13, 12), goldMat);
      cap.position.y = -0.062;
      tas.add(cap);
      const skirtGeo = new THREE.CylinderGeometry(0.015, 0.005, 0.34, 5);
      const skirtMat = silkMaterial(PALETTES[0].silk[2]);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU;
        const f = new THREE.Mesh(skirtGeo, skirtMat);
        f.position.set(Math.cos(a) * 0.052, -0.29, Math.sin(a) * 0.052);
        f.rotation.z = Math.cos(a) * 0.16;
        f.rotation.x = -Math.sin(a) * 0.16;
        tas.add(f);
      }
      tas.visible = false;
      rig.add(tas);

      tails.push({
        dir: dir, tube: tube, tassel: tas, skirtMat: skirtMat, mat: mat,
        swing: 0, swingV: 0, endX: 0, endY: 0, ang: 0
      });
    }

    const tailCol = new THREE.Color();
    function writeTail(t, grow, time) {
      const pal = PALETTES[palette];
      const N = t.tube.n;
      const startA = t.dir < 0 ? Math.PI * 0.86 : Math.PI * 0.14;
      const x0 = Math.cos(startA) * 0.42, y0 = Math.sin(startA) * 0.42;
      const reach = 0.66 * grow, drop = 1.16 * grow;
      const pts = [];
      for (let k = 0; k < N; k++) {
        const f = k / (N - 1);
        const swing = Math.sin(t.swing) * 0.13 * f * f;
        const x = x0 + t.dir * reach * Math.sqrt(f) + swing;
        const y = y0 - drop * f * f - 0.1 * f;
        const z = 0.16 + Math.sin(f * 2.2 + time * 0.6) * 0.05 * f;
        pts.push(x, y, z);
      }
      for (let k = 0; k < N; k++) {
        const f = k / (N - 1);
        const i0 = k * 3;
        const i1 = Math.min(N - 1, k + 1) * 3;
        const ax = pts[i0], ay = pts[i0 + 1], az = pts[i0 + 2];
        let tx = pts[i1] - ax, ty = pts[i1 + 1] - ay, tz = pts[i1 + 2] - az;
        if (k === N - 1) {
          const ip = (N - 2) * 3;
          tx = ax - pts[ip]; ty = ay - pts[ip + 1]; tz = az - pts[ip + 2];
        }
        const which = k % 3;
        tailCol.setHex(pal.silk[which]);
        writeRing(t.tube, k, ax, ay, az, tx, ty, tz, 0.055 * (1 - 0.22 * f),
          tailCol.r, tailCol.g, tailCol.b, f * 4);
        if (k === N - 1) { t.endX = ax; t.endY = ay; t.ang = Math.atan2(ty, tx); }
      }
      t.tube.flush();
      t.tassel.position.set(t.endX, t.endY - 0.03, 0.18);
      t.tassel.rotation.z = Math.sin(t.swing) * 0.2;
      t.skirtMat.color.setHex(pal.silk[2]);
      t.mat.needsUpdate = false;
    }

    // ---- marigold shower ----------------------------------------------------
    const PETALS = 54;
    let petalMesh = null;
    const petalState = [];
    if (texPetal) {
      const pg = new THREE.PlaneGeometry(0.13, 0.2);
      const pm = new THREE.MeshBasicMaterial({
        map: texPetal, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.95
      });
      petalMesh = new THREE.InstancedMesh(pg, pm, PETALS);
      petalMesh.frustumCulled = false;
      petalMesh.visible = false;
      petalMesh.count = 0;
      scene.add(petalMesh);
      for (let i = 0; i < PETALS; i++) {
        petalState.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, rx: 0, ry: 0, rz: 0, spin: 0, life: 0 });
      }
    }
    const petalM4 = new THREE.Matrix4();
    const petalQ = new THREE.Quaternion();
    const petalE = new THREE.Euler();
    const petalV = new THREE.Vector3();
    const petalS = new THREE.Vector3(1, 1, 1);

    function showerPetals() {
      if (!petalMesh) return;
      petalMesh.visible = true;
      petalMesh.count = PETALS;
      for (const p of petalState) {
        p.x = rnd(-2.6, 2.6); p.y = rnd(3.0, 6.0); p.z = rnd(-1.2, 1.6);
        p.vx = rnd(-0.25, 0.25); p.vy = rnd(-1.5, -0.8);
        p.rx = rnd(0, TAU); p.ry = rnd(0, TAU); p.rz = rnd(0, TAU);
        p.spin = rnd(-2.4, 2.4);
        p.life = rnd(3.6, 6.4);
      }
    }

    function stepPetals(dt) {
      if (!petalMesh || !petalMesh.visible) return;
      let alive = 0;
      for (let i = 0; i < PETALS; i++) {
        const p = petalState[i];
        if (p.life <= 0) { petalM4.makeScale(0, 0, 0); petalMesh.setMatrixAt(i, petalM4); continue; }
        p.life -= dt;
        p.vy += -0.35 * dt;
        p.vy = Math.max(p.vy, -1.9);
        p.x += (p.vx + Math.sin(p.rz + p.y * 0.7) * 0.4) * dt;
        p.y += p.vy * dt;
        p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
        petalE.set(p.rx, p.ry, p.rz);
        petalQ.setFromEuler(petalE);
        petalV.set(p.x, p.y, p.z);
        const sc = clamp(p.life, 0, 1);
        petalS.set(sc, sc, sc);
        petalM4.compose(petalV, petalQ, petalS);
        petalMesh.setMatrixAt(i, petalM4);
        if (p.y > -5) alive++;
      }
      petalMesh.instanceMatrix.needsUpdate = true;
      if (alive === 0) { petalMesh.visible = false; petalMesh.count = 0; }
    }

    // ===================================================================== //
    // 7. Raga Desh — which note a crossing gets                              //
    // ===================================================================== //
    // Aroh (going up) leaves out Ga and Dha; avroh (coming down) puts them
    // back. Braiding upward walks the ascending ladder, downward the
    // descending one, which is what makes the cord sound like a phrase rather
    // than a scale.
    const ASC = [0, 2, 5, 7, 11, 12, 14, 17, 19, 23, 24];
    const DESC = [24, 22, 21, 19, 17, 16, 14, 12, 10, 9, 7, 5, 4, 2, 0];
    let noteNow = 12;

    function nextNote(dir) {
      if (dir > 0) {
        for (let i = 0; i < ASC.length; i++) if (ASC[i] > noteNow) return (noteNow = ASC[i]);
        noteNow = ASC[ASC.length - 3];
        return noteNow;
      }
      for (let i = 0; i < DESC.length; i++) if (DESC[i] < noteNow) return (noteNow = DESC[i]);
      noteNow = DESC[2];
      return noteNow;
    }

    // ===================================================================== //
    // 8. Interaction                                                        //
    // ===================================================================== //
    let phase = "braid";      // braid -> tying -> done
    let tieT = 0;
    let time = 0;
    let energy = 0, energyTarget = 0;
    let pending = 0;
    let started = false;
    let dragging = false;
    let lastX = 0, lastY = 0, lastMoveT = 0;
    let spinV = 0;
    let progressSent = 0;
    const milestones = { 25: false, 50: false, 75: false };

    function firstGesture() {
      if (started) return;
      started = true;
      resumeAudio();
      ctx.platform.start();
      if (canMusic && ctx.music && ctx.music.unlock) { try { ctx.music.unlock(); } catch (_) {} }
    }

    function choosePalette(i) {
      firstGesture();
      palette = i;
      paintButtons();
      if (phase === "braid") {
        seed.cols.push([arc / TOTAL, i]);
        chime(noteHz(19), 0.09, 0.9);
      } else {
        // in the finished view a colour tap re-dyes the pendant
        buildMedallion(palette);
      }
      ctx.platform.haptic("light");
      ctx.platform.interact({ type: "palette", palette: PALETTES[i].name });
    }

    function armCharm(id) {
      firstGesture();
      armedCharm = armedCharm === id ? null : id;
      paintButtons();
      chime(noteHz(24), 0.07, 0.5);
      ctx.platform.haptic("light");
    }

    ctx.listen(nodes.help, "click", () => { nodes.sheet.style.display = "flex"; });
    ctx.listen(nodes.close, "click", () => { nodes.sheet.style.display = "none"; firstGesture(); });

    // ---- the braiding gesture ---------------------------------------------
    ctx.listen(view, "pointerdown", (e) => {
      firstGesture();
      dragging = true;
      lastX = e.offsetX; lastY = e.offsetY; lastMoveT = performance.now();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      if (phase === "braid" && nodes.hint) nodes.hint.style.opacity = "0.35";
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!dragging) return;
      const x = e.offsetX, y = e.offsetY;
      const dx = x - lastX, dy = y - lastY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const now = performance.now();
      const dt = Math.max(1, now - lastMoveT);
      lastX = x; lastY = y; lastMoveT = now;
      if (dist < 0.4) return;

      if (phase === "done") {
        spinV += dx * 0.00042 * 60;
        return;
      }
      if (phase !== "braid" || arc >= TOTAL) return;

      const speed = dist / dt;                       // pixels per millisecond
      energyTarget = clamp(speed * 0.9, 0.12, 1);
      // Slow hands pack the crossings tight; fast hands stretch them out.
      pitchTarget = lerp(7.6, 3.1, clamp((speed - 0.15) / 1.9, 0, 1));
      if (Math.abs(dy) > 1.2) ragaDir = dy < 0 ? 1 : -1;
      pending += Math.min(dist * 0.0022, SEG * 9);
    });

    const endDrag = () => { dragging = false; energyTarget = 0; };
    ctx.listen(view, "pointerup", endDrag);
    ctx.listen(view, "pointercancel", endDrag);
    ctx.listen(view, "pointerleave", endDrag);

    // ---- one crossing ------------------------------------------------------
    function onCrossing() {
      crossCount++;
      const semi = nextNote(ragaDir);
      pluck(semi, 0.15 + energy * 0.13, ((crossCount % 3) - 1) * 0.35);
      if (armedCharm) {
        const c = charmAt(armedCharm, arc, twist);
        seed.charms.push([arc / TOTAL, armedCharm]);
        chime(noteHz(semi + 24), 0.16, 1.3);
        ctx.platform.haptic("light");
        ctx.platform.interact({ type: "charm", charm: armedCharm });
        armedCharm = null;
        paintButtons();
      }
    }

    // ===================================================================== //
    // 9. Tying off, and the box of finished rakhis                          //
    // ===================================================================== //
    let box = [];
    let shelfOpen = false;

    function rakhiName(sd) {
      const p = PALETTES[sd.pal] || PALETTES[0];
      const n = (sd.charms.length * 7 + Math.round(sd.us.length * 3.1)) % NAME_TAIL.length;
      return p.name + " " + NAME_TAIL[n];
    }

    function snapshot() {
      return {
        pal: palette,
        n: head,
        us: seed.us.slice(0),
        cols: seed.cols.slice(0),
        charms: seed.charms.slice(0)
      };
    }

    async function saveToBox(sd) {
      if (ctx.capabilities.storage === false) return;
      try {
        box.unshift(sd);
        box = box.slice(0, 6);
        await ctx.storage.set("box", box);
        paintShelf();
      } catch (_) { /* storage is a nicety, not the bit */ }
    }

    function paintShelf() {
      nodes.shelf.innerHTML = "";
      box.forEach((sd, i) => {
        const p = PALETTES[sd.pal] || PALETTES[0];
        const b = document.createElement("button");
        b.style.cssText =
          "pointer-events:auto;width:44px;height:44px;border-radius:22px;padding:0;overflow:hidden;" +
          "display:flex;flex-direction:column;border:1px solid rgba(246,232,210,0.25);background:#000;";
        for (const c of p.silk) {
          const s = document.createElement("div");
          s.style.cssText = "flex:1;width:100%;";
          s.style.backgroundColor = hex(c);
          b.appendChild(s);
        }
        nodes.shelf.appendChild(b);
        ctx.listen(b, "click", () => { rebuild(sd); });
      });
      if (!box.length) {
        const t = document.createElement("div");
        t.style.cssText = "font-size:11.5px;color:" + DIM + ";padding:8px 0;";
        t.textContent = "Rakhis you tie are kept here.";
        nodes.shelf.appendChild(t);
      }
    }

    function clearCord() {
      for (const c of charmMeshes) rig.remove(c);
      charmMeshes.length = 0;
      head = 0; arc = 0; twist = 0; crossCount = 0; lastCrossStep = 0;
      noteNow = 12;
      seed = { pal: palette, us: [], cols: [[0, palette]], charms: [] };
      medallion.visible = false;
      knot.visible = false;
      for (const t of tails) { t.tube.mesh.visible = false; t.tassel.visible = false; }
      if (petalMesh) { petalMesh.visible = false; petalMesh.count = 0; }
      for (const k in milestones) milestones[k] = false;
      progressSent = 0;
    }

    function startOver() {
      clearCord();
      phase = "braid";
      tieT = 0;
      nodes.again.style.display = "none";
      nodes.shelf.style.display = "none";
      shelfOpen = false;
      nodes.charms.style.display = "flex";
      nodes.swatches.style.display = "flex";
      nodes.prog.style.opacity = "1";
      nodes.top.style.opacity = "1";
      nodes.card.style.opacity = "0";
      nodes.hint.style.opacity = "1";
      nodes.hint.textContent = "rub anywhere to braid";
      nodes.bar.style.width = "0%";
      nodes.tie.style.display = "none";
      ctx.platform.setProgress(0);
    }

    function finishInto(sd) {
      phase = "done";
      tieT = 1;
      nodes.tie.style.display = "none";
      nodes.charms.style.display = "none";
      nodes.swatches.style.display = "flex";
      nodes.again.style.display = "flex";
      nodes.prog.style.opacity = "0";
      nodes.top.style.opacity = "0";
      nodes.card.style.opacity = "1";
      nodes.cardname.textContent = rakhiName(sd);
      nodes.cardsub.textContent =
        crossCount + " crossings · " + sd.charms.length + " charms";
      buildMedallion(palette);
      medallion.visible = true;
      medallion.scale.setScalar(MEDAL);
      knot.visible = true;
      for (const t of tails) { t.tube.mesh.visible = true; t.tassel.visible = true; }
    }

    function doTie() {
      if (phase !== "braid" || arc < TOTAL - SEG) return;
      phase = "tying";
      tieT = 0;
      energyTarget = 0;
      buildMedallion(palette);
      medallion.visible = true;
      medallion.scale.setScalar(0.02 * MEDAL);
      knot.visible = true;
      knot.scale.setScalar(0.02);
      nodes.tie.style.display = "none";
      nodes.charms.style.display = "none";
      ctx.platform.haptic("success");

      // A short flourish up the raga, then the bell.
      if (ac) {
        const t0 = ac.currentTime;
        [0, 5, 7, 11, 12, 17].forEach((s, i) => {
          ctx.timeout(() => pluck(s + 12, 0.2, (i % 2 ? 0.4 : -0.4)), i * 105);
        });
        ctx.timeout(() => chime(noteHz(24), 0.24, 2.6), 520);
        ctx.timeout(() => chime(noteHz(31), 0.15, 2.2), 700);
      } else {
        sting("success");
      }

      const sd = snapshot();
      saveToBox(sd);
      ctx.platform.milestone("tied", { crossings: crossCount, charms: sd.charms.length });
      ctx.platform.complete({ crossings: crossCount, charms: sd.charms.length, palette: PALETTES[palette].name });
      ctx.timeout(() => {
        nodes.card.style.opacity = "1";
        nodes.cardname.textContent = rakhiName(sd);
        nodes.cardsub.textContent = crossCount + " crossings · " + sd.charms.length + " charms";
        nodes.prog.style.opacity = "0";
        nodes.top.style.opacity = "0";
        nodes.again.style.display = "flex";
      }, 1500);
    }

    // Rebuild a saved rakhi exactly: the twist checkpoints replay the pitch of
    // the hand that made it, so the crossings land where they landed.
    function rebuild(sd) {
      clearCord();
      const n = Math.min(sd.n || 0, SAMPLES - 2);
      if (!n) return;
      const cols = sd.cols && sd.cols.length ? sd.cols : [[0, sd.pal || 0]];
      const palAt = (f) => {
        let p = cols[0][1];
        for (const c of cols) if (f >= c[0]) p = c[1];
        return clamp(p | 0, 0, PALETTES.length - 1);
      };
      const uAt = (si) => {
        if (!sd.us.length) return si * SEG * 5.2;
        const g = si / 16;
        const i0 = Math.min(sd.us.length - 1, Math.floor(g));
        const i1 = Math.min(sd.us.length - 1, i0 + 1);
        return lerp(sd.us[i0], sd.us[i1], g - i0);
      };
      for (let si = 0; si < n; si++) {
        const s = si * SEG;
        const u = uAt(si);
        pitch = Math.max(0.5, (uAt(si + 1) - u) / SEG);
        commitSample(si, s, u, palAt(s / TOTAL));
      }
      head = n;
      arc = n * SEG;
      twist = uAt(n - 1);
      crossCount = Math.floor(twist / CROSS);
      palette = clamp((sd.pal | 0), 0, PALETTES.length - 1);
      paintButtons();
      for (const c of (sd.charms || [])) charmAt(c[1], c[0] * TOTAL, 0).scale.setScalar(1);
      for (const c of charmMeshes) c.userData.grow = 1;
      seed = { pal: palette, us: sd.us.slice(0), cols: cols.slice(0), charms: (sd.charms || []).slice(0) };
      setDraw(head);
      flushRange(0, head);
      finishInto(sd);
      ctx.platform.interact({ type: "recall" });
    }

    ctx.listen(nodes.tie, "click", doTie);
    ctx.listen(nodes.newBtn, "click", () => { firstGesture(); startOver(); });
    ctx.listen(nodes.boxBtn, "click", () => {
      shelfOpen = !shelfOpen;
      nodes.shelf.style.display = shelfOpen ? "flex" : "none";
      if (shelfOpen) paintShelf();
    });

    if (ctx.capabilities.storage !== false) {
      try {
        const saved = await ctx.storage.get("box");
        if (Array.isArray(saved)) box = saved.slice(0, 6);
      } catch (_) { box = []; }
    }

    // ===================================================================== //
    // 10. Layout and the frame loop                                         //
    // ===================================================================== //
    const TOP_RESERVE = SAFE_T + 88;      // title, progress bar
    const BOT_RESERVE = SAFE_B + 176;     // charm row, swatch row, action button
    let camDist = 8, camY = 0;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;

      const half = Math.tan((camera.fov * Math.PI) / 360);
      const need = RING_R + 0.18;
      // far enough that the ring fits the narrow axis with a margin
      const dW = (need / 0.93) / (half * camera.aspect);
      const band = Math.max(120, H - TOP_RESERVE - BOT_RESERVE);
      const dH = (need * 2 * H) / (2 * half * band);
      camDist = Math.max(dW, dH);

      // Slide the camera so the rakhi centres in the space the panels leave.
      const visH = 2 * camDist * half;
      const bandCentre = TOP_RESERVE + band / 2;
      camY = ((bandCentre - H / 2) / H) * visH;

      camera.updateProjectionMatrix();
    }
    layout();

    ctx.listen(window, "resize", () => ctx.timeout(layout, 60));
    if (window.visualViewport) ctx.listen(window.visualViewport, "resize", () => ctx.timeout(layout, 60));

    let liveN = LIVE;
    let lastProgressBar = -1;
    const camTarget = new THREE.Vector3();

    paintShelf();
    // Draw the loose ends immediately so the very first frame has silk in it.
    setDraw(writeLive(0, 0.5));
    flushRange(0, head + LIVE + 1);
    renderer.render(scene, camera);
    nodes.curtain.style.transition = "opacity 520ms ease";
    nodes.curtain.style.opacity = "0";
    ctx.timeout(() => { nodes.curtain.style.display = "none"; }, 560);

    ctx.onFrame((dtMs) => {
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      time += dt;
      swayPhase += dt * (1 + energy * 3.4);

      // ---- hand energy and braid pitch ----------------------------------
      if (!dragging) energyTarget *= Math.pow(0.015, dt);
      energy += (energyTarget - energy) * Math.min(1, dt * 9);
      pitch += (pitchTarget - pitch) * Math.min(1, dt * 4);
      setRub(phase === "braid" ? energy : 0);

      // ---- turn finger travel into cord ----------------------------------
      let dirtyFrom = head;
      if (phase === "braid" && pending > 0.0001) {
        let guard = 0;
        while (pending >= SEG && arc < TOTAL && head < SAMPLES - LIVE - 2 && guard++ < 60) {
          if (head % 16 === 0) seed.us.push(Math.round(twist * 100) / 100);
          commitSample(head, arc, twist, palette);
          head++;
          arc += SEG;
          twist += SEG * pitch;
          pending -= SEG;
          const step = Math.floor(twist / CROSS);
          if (step > lastCrossStep) { lastCrossStep = step; onCrossing(); }
        }
        if (arc >= TOTAL) { pending = 0; }

        const pct = clamp(arc / TOTAL, 0, 1);
        const shown = Math.round(pct * 100);
        if (shown !== lastProgressBar) {
          lastProgressBar = shown;
          nodes.bar.style.width = shown + "%";
          if (Math.abs(pct - progressSent) > 0.02) {
            progressSent = pct;
            ctx.platform.setProgress(pct);
          }
          for (const k of [25, 50, 75]) {
            if (!milestones[k] && shown >= k) {
              milestones[k] = true;
              ctx.platform.milestone("braid_" + k);
            }
          }
          if (pct >= 0.999 && nodes.tie.style.display === "none") {
            nodes.tie.style.display = "block";
            nodes.hint.textContent = "the ring is closed — tie it off";
            nodes.hint.style.opacity = "1";
            chime(noteHz(12), 0.16, 1.6);
            ctx.platform.haptic("medium");
          }
        }
      }

      // ---- the loose ends -------------------------------------------------
      if (phase !== "done") {
        liveN = phase === "braid"
          ? Math.round(LIVE * (arc >= TOTAL ? 0.35 : 1))
          : Math.max(0, Math.round(LIVE * (1 - tieT * 2.4)));
        const idle = phase === "braid" ? 0.16 : 0;
        const last = writeLive(time, Math.max(idle, energy));
        setDraw(last);
        flushRange(Math.min(dirtyFrom, head), last);
      }

      if (tipGlow) {
        const ta = A0 - arc / RING_R;
        tipGlow.position.set(Math.cos(ta) * RING_R, Math.sin(ta) * RING_R, 0.1);
        tipGlow.material.opacity = phase === "braid"
          ? clamp(0.10 + energy * 0.5, 0, 0.6) * (arc >= TOTAL ? 0 : 1)
          : Math.max(0, tipGlow.material.opacity - dt * 2);
      }

      // ---- charms pop into being -----------------------------------------
      for (const c of charmMeshes) {
        if (c.userData.grow < 1) {
          c.userData.grow = Math.min(1, c.userData.grow + dt * 3.4);
          const g = c.userData.grow;
          const e = 1 - Math.pow(1 - g, 3);
          c.scale.setScalar(e * (1 + Math.sin(g * Math.PI) * 0.28));
        }
      }

      // ---- the tie ---------------------------------------------------------
      if (phase === "tying") {
        tieT = Math.min(1, tieT + dt / 2.4);
        const kt = clamp((tieT - 0.08) / 0.34, 0, 1);
        const ke = 1 - Math.pow(1 - kt, 3);
        knot.position.set(0, RING_R, 0);
        knot.rotation.set(0, Math.PI / 2, 0);
        knot.scale.setScalar(ke * (1 + Math.sin(kt * Math.PI) * 0.3));
        const mt = clamp((tieT - 0.24) / 0.5, 0, 1);
        const me = 1 - Math.pow(1 - mt, 4);
        medallion.scale.setScalar(MEDAL * (0.02 + me * 0.98 + Math.sin(mt * Math.PI) * 0.09));
        medallion.rotation.z = (1 - me) * -0.9;
        if (tieT > 0.42 && petalMesh && !petalMesh.visible) showerPetals();
        if (tieT >= 1) {
          phase = "done";
          const sd = snapshot();
          finishInto(sd);
        }
      }

      // ---- tie-threads ------------------------------------------------------
      const grow = phase === "done" ? 1 : clamp((tieT - 0.42) / 0.5, 0, 1);
      if (grow > 0.02) {
        for (const t of tails) {
          if (!t.tube.mesh.visible) { t.tube.mesh.visible = true; t.tassel.visible = true; }
          // the pendant swinging drags the threads a beat behind it
          const drive = -spinV * 26 - Math.sin(time * 0.8) * 0.25;
          t.swingV += (drive - t.swing) * dt * 7 - t.swingV * dt * 2.6;
          t.swing += t.swingV * dt;
          writeTail(t, grow, time);
        }
      }

      // ---- how the whole thing hangs ---------------------------------------
      if (phase === "done") {
        spinV *= Math.pow(0.12, dt);
        rig.rotation.y += (spinV + 0.16) * dt;
        rig.rotation.x = -0.14 + Math.sin(time * 0.31) * 0.07;
      } else {
        rig.rotation.y = Math.sin(time * 0.33) * 0.17 + energy * 0.06;
        rig.rotation.x = -0.1 + Math.sin(time * 0.26) * 0.05;
      }

      // the stone catches the light on its own
      for (const p of medalParts) if (p.userData.gem) { p.rotation.y += dt * 0.6; p.rotation.x += dt * 0.25; }

      // ---- dust -------------------------------------------------------------
      const dp = dustGeo.attributes.position.array;
      for (let i = 0; i < DUST; i++) {
        const ph = dustSeed[i * 3], sp = dustSeed[i * 3 + 1];
        dp[i * 3] += Math.sin(time * sp + ph) * dt * 0.1;
        dp[i * 3 + 1] += (sp * 0.11 + 0.02) * dt;
        if (dp[i * 3 + 1] > 4.8) dp[i * 3 + 1] = -4.8;
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.opacity = 0.34 + energy * 0.3 + (phase === "done" ? 0.16 : 0);

      stepPetals(dt);

      // ---- camera -----------------------------------------------------------
      const pull = phase === "braid" ? 1 : lerp(1, 0.9, clamp(tieT, 0, 1));
      const bob = Math.sin(time * 0.4) * 0.05;
      camera.position.set(Math.sin(time * 0.16) * 0.12, camY + bob, camDist * pull);
      camTarget.set(0, camY, 0);
      camera.lookAt(camTarget);

      rim.intensity = 8 + Math.sin(time * 1.7) * 1.4 + energy * 4;
      renderer.render(scene, camera);
    });
  }
};
