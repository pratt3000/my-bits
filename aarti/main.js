/**
 * Aarti — light the lamp, then circle it, and the flame paints the dark.
 *
 * Before the thread is tied on Rakshabandhan, the thali is circled: a brass
 * plate carrying a lit diya, kumkum, rice and the rakhi itself, turned slowly
 * clockwise. This is that, and the whole bit is in the word *slowly*.
 *
 * Press and hold to light the wick. Then drag: the thali follows your finger
 * on a spring, so it lags and overshoots and has weight. The flame is not
 * decoration — it leans away from the plate's acceleration, stretches with
 * speed, and if you drag it faster than a flame can survive it gutters, turns
 * blue at the base, and goes out. You relight and start again.
 *
 * Every frame the flame drops a segment into a trail of light that fades over
 * about five seconds, so a steady circle draws a ring of fire and a nervous
 * hand draws a scribble. The trail is the record of your hand. When the
 * eleventh revolution lands, the trail stops fading and is mirrored eight ways
 * around the centre — whatever you drew becomes a mandala, and no two hands
 * draw the same one.
 *
 * Revolutions are counted by unwrapping the plate's angle about the centre, so
 * only real circles count, and only while the flame is alive. The longest
 * unbroken aarti goes to the leaderboard.
 *
 * Sound is synthesised here, none of it sampled: the bell is additive with
 * inharmonic partials struck by a noise transient, the drone is three detuned
 * saws through a moving filter, the flame is bandpassed noise whose gain rides
 * the speed of your hand, and the conch at the end is a swept saw with breath
 * over it.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule). Every texture and
 * every sound is generated in-file — packaged assets are disabled.
 */
window.plethoraBit = {
  meta: {
    title: "Aarti",
    runtime: "plethora-bit@2",
    tags: ["3d", "art", "ritual", "skill", "sensory"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Helpers                                                            //
    // ===================================================================== //
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);

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

    const ROUNDS = 11;            // eleven turns completes the aarti

    // ===================================================================== //
    // 1. First frame                                                        //
    // ===================================================================== //
    const view = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "4";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);

    const INK = "#f7e6cd";
    const DIM = "rgba(247,230,205,0.55)";
    const GOLD = "#f6c65a";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Devanagari',sans-serif";

    ui.innerHTML =
      '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:' + FONT + ';' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:' + INK + ';">' +

      '<div data-el="top" style="position:absolute;left:0;right:0;top:' + (SAFE_T + 6) + 'px;padding:0 18px;' +
      'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;transition:opacity 420ms ease;">' +
        '<div>' +
          '<div style="font-size:19px;font-weight:700;letter-spacing:0.3px;line-height:1.05;">Aarti</div>' +
          '<div style="font-size:11px;letter-spacing:1.6px;color:' + DIM + ';margin-top:3px;">आरती</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:9px;">' +
          '<div data-el="best" style="font-size:11px;letter-spacing:1.2px;color:' + DIM + ';' +
          'padding:6px 10px;border-radius:12px;background:rgba(20,10,4,0.5);"></div>' +
          '<button data-el="help" style="pointer-events:auto;width:34px;height:34px;border-radius:17px;' +
          'border:1px solid rgba(246,198,90,0.45);background:rgba(20,10,4,0.5);color:' + GOLD + ';' +
          'font-size:15px;font-weight:600;font-family:inherit;padding:0;">?</button>' +
        '</div>' +
      '</div>' +

      // eleven pips, one per revolution
      '<div data-el="pips" style="position:absolute;left:0;right:0;top:' + (SAFE_T + 58) + 'px;' +
      'display:flex;justify-content:center;gap:7px;transition:opacity 420ms ease;"></div>' +

      '<div data-el="card" style="position:absolute;left:18px;right:18px;top:' + (SAFE_T + 46) + 'px;' +
      'text-align:center;opacity:0;transition:opacity 600ms ease;">' +
        '<div data-el="cardname" style="font-size:25px;font-weight:700;letter-spacing:0.4px;"></div>' +
        '<div data-el="cardsub" style="font-size:11.5px;letter-spacing:1.4px;text-transform:uppercase;' +
        'color:' + DIM + ';margin-top:6px;"></div>' +
      '</div>' +

      '<div data-el="bottom" style="position:absolute;left:0;right:0;bottom:' + (SAFE_B + 16) + 'px;' +
      'padding:0 18px;display:flex;flex-direction:column;align-items:center;gap:12px;">' +
        '<div data-el="hint" style="font-size:13px;letter-spacing:0.5px;color:' + DIM + ';text-align:center;' +
        'transition:opacity 300ms ease;">press and hold to light the wick</div>' +
        '<button data-el="relight" style="pointer-events:auto;display:none;width:100%;max-width:300px;height:48px;' +
        'border-radius:24px;border:0;background:' + GOLD + ';color:#2a1503;font-size:15px;font-weight:700;' +
        'font-family:inherit;box-shadow:0 6px 22px rgba(246,198,90,0.3);">Light it again</button>' +
        '<div data-el="endrow" style="display:none;gap:10px;width:100%;max-width:340px;">' +
          '<button data-el="again" style="pointer-events:auto;flex:1;height:48px;border-radius:24px;border:0;' +
          'background:' + GOLD + ';color:#2a1503;font-size:14.5px;font-weight:700;font-family:inherit;">Aarti again</button>' +
          '<button data-el="board" style="pointer-events:auto;flex:1;height:48px;border-radius:24px;' +
          'border:1px solid rgba(247,230,205,0.3);background:rgba(20,10,4,0.55);color:' + INK + ';' +
          'font-size:14.5px;font-weight:600;font-family:inherit;">Steadiest</button>' +
        '</div>' +
      '</div>' +

      '<div data-el="sheet" style="position:absolute;inset:0;display:none;pointer-events:auto;' +
      'background:rgba(8,4,2,0.9);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);' +
      'align-items:center;justify-content:center;padding:26px;">' +
        '<div data-el="sheetbody" style="max-width:330px;width:100%;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">The aarti</div>' +
          '<div style="font-size:14px;line-height:1.75;color:rgba(247,230,205,0.86);">' +
            '• Press and hold anywhere to light the diya.<br>' +
            '• Then drag to carry the thali in slow circles. Eleven turns completes it.<br>' +
            '• The plate has weight — it lags behind your finger and swings past it.<br>' +
            '• Move too fast and the flame gutters and blows out. Steady wins.<br>' +
            '• The flame leaves a trail of light. Whatever you draw is mirrored into a mandala at the end.' +
          '</div>' +
          '<button data-el="close" style="pointer-events:auto;margin-top:22px;width:100%;height:46px;' +
          'border-radius:23px;border:0;background:' + GOLD + ';color:#2a1503;font-size:15px;font-weight:700;' +
          'font-family:inherit;">Begin</button>' +
        '</div>' +
      '</div>' +

      '<div data-el="curtain" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
      'align-items:center;justify-content:center;flex-direction:column;gap:16px;' +
      'background:radial-gradient(120% 90% at 50% 45%, #2a1408 0%, #140902 55%, #050201 100%);">' +
        '<div style="font-size:30px;font-weight:700;letter-spacing:0.5px;">Aarti</div>' +
        '<div style="font-size:12px;letter-spacing:2.4px;text-transform:uppercase;color:' + DIM + ';">' +
        'polishing the brass</div>' +
      '</div>' +
      '</div>';

    const el = (n) => ui.querySelector('[data-el="' + n + '"]');
    const nodes = {
      top: el("top"), best: el("best"), help: el("help"), pips: el("pips"),
      card: el("card"), cardname: el("cardname"), cardsub: el("cardsub"),
      hint: el("hint"), relight: el("relight"), endrow: el("endrow"),
      again: el("again"), board: el("board"), sheet: el("sheet"), sheetbody: el("sheetbody"),
      curtain: el("curtain")
    };

    const pipEls = [];
    for (let i = 0; i < ROUNDS; i++) {
      const d = document.createElement("div");
      d.style.cssText = "width:8px;height:8px;border-radius:4px;background:rgba(247,230,205,0.18);" +
        "transition:background 260ms ease,box-shadow 260ms ease,transform 260ms ease;";
      pipEls.push(d);
      nodes.pips.appendChild(d);
    }

    ctx.markVisualReady("title");
    ctx.platform.ready();

    // ===================================================================== //
    // 2. Sound                                                              //
    // ===================================================================== //
    const AC = (window.AudioContext || window.webkitAudioContext) || null;
    const canAudio = !!AC && ctx.capabilities.audio !== false;
    const canMusic = ctx.capabilities.backgroundMusic !== false;
    let ac = null, master = null, verb = null, bus = null;
    let flameGain = null, flameFilter = null, flameSrc = null;
    let droneGain = null, droneFilter = null;
    let muted = false;

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
      master.gain.value = 0;
      master.connect(ac.destination);
      master.gain.setTargetAtTime(0.9, ac.currentTime, 1.1);

      // a small stone room for the bell to ring in
      verb = ac.createGain();
      verb.gain.value = 0.4;
      const d1 = ac.createDelay(0.9); d1.delayTime.value = 0.157;
      const d2 = ac.createDelay(0.9); d2.delayTime.value = 0.211;
      // two delays cross-fed from one sum: the loop gain is 2x this, so it
      // has to stay under 0.5 or the network diverges
      const fb = ac.createGain(); fb.gain.value = 0.32;
      const damp = ac.createBiquadFilter();
      damp.type = "lowpass"; damp.frequency.value = 2400;
      verb.connect(d1); verb.connect(d2);
      d1.connect(damp); d2.connect(damp);
      damp.connect(fb); fb.connect(d1); fb.connect(d2);
      damp.connect(master);

      bus = ac.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      bus.connect(verb);

      // the flame itself: noise the width of a candle
      flameSrc = ac.createBufferSource();
      flameSrc.buffer = noiseBuffer(2.5);
      flameSrc.loop = true;
      flameFilter = ac.createBiquadFilter();
      flameFilter.type = "bandpass";
      flameFilter.frequency.value = 520;
      flameFilter.Q.value = 0.7;
      flameGain = ac.createGain();
      flameGain.gain.value = 0;
      flameSrc.connect(flameFilter); flameFilter.connect(flameGain); flameGain.connect(master);
      try { flameSrc.start(); } catch (_) {}

      startDrone();
    }

    function resumeAudio() {
      if (!ac) { startAudio(); return; }
      if (ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
    }

    // A shruti box under everything: three saws a fifth apart, detuned, behind
    // a filter that breathes.
    function startDrone() {
      droneGain = ac.createGain();
      droneGain.gain.value = 0;
      droneFilter = ac.createBiquadFilter();
      droneFilter.type = "lowpass";
      droneFilter.frequency.value = 420;
      droneFilter.Q.value = 3;
      droneGain.connect(droneFilter);
      droneFilter.connect(master);
      droneFilter.connect(verb);

      const root = 110;
      for (const [mult, det, amp] of [[1, 0, 0.5], [1, 6, 0.34], [1.5, -5, 0.3], [2, 3, 0.18]]) {
        const o = ac.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = root * mult;
        o.detune.value = det;
        const g = ac.createGain();
        g.gain.value = amp;
        o.connect(g); g.connect(droneGain);
        try { o.start(); } catch (_) {}
      }
      const lfo = ac.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.07;
      const lg = ac.createGain();
      lg.gain.value = 170;
      lfo.connect(lg); lg.connect(droneFilter.frequency);
      try { lfo.start(); } catch (_) {}
    }

    function setDrone(level) {
      if (!ac || muted || !droneGain) return;
      droneGain.gain.setTargetAtTime(0.055 * level, ac.currentTime, 0.9);
    }

    // A temple bell: inharmonic partials, the high ones dying first, struck by
    // a very short burst of filtered noise.
    const BELL = [[1, 1, 4.2], [2.0, 0.5, 2.8], [2.65, 0.42, 2.0], [3.36, 0.3, 1.5],
                  [4.24, 0.2, 1.0], [5.63, 0.13, 0.7]];
    function bell(freq, gain, spread) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const out = ac.createGain();
      out.gain.value = gain;
      out.connect(bus);
      out.connect(verb);
      for (const [mult, amp, life] of BELL) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = freq * mult * (1 + rnd(-0.004, 0.004));
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + life * (spread || 1));
        o.connect(g); g.connect(out);
        o.start(t);
        o.stop(t + life * (spread || 1) + 0.1);
      }
      // the strike
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(0.08);
      const nf = ac.createBiquadFilter();
      nf.type = "bandpass"; nf.frequency.value = freq * 3.2; nf.Q.value = 1.4;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(gain * 0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      n.connect(nf); nf.connect(ng); ng.connect(bus);
      n.start(t); n.stop(t + 0.1);
    }

    // Ghungroo: a scatter of tiny high pings.
    function shimmer(count, gain) {
      if (!ac || muted) return;
      const t0 = ac.currentTime;
      for (let i = 0; i < count; i++) {
        const t = t0 + rnd(0, 0.22);
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = rnd(1900, 4200);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain * rnd(0.4, 1), t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + rnd(0.12, 0.3));
        o.connect(g); g.connect(bus); g.connect(verb);
        o.start(t); o.stop(t + 0.4);
      }
    }

    // The flame going out: a puff of air and a low knock.
    function puff() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(0.5);
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(2400, t);
      f.frequency.exponentialRampToValueAtTime(420, t + 0.5);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      n.connect(f); f.connect(g); g.connect(master);
      n.start(t); n.stop(t + 0.5);

      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(62, t + 0.3);
      const og = ac.createGain();
      og.gain.setValueAtTime(0.14, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(og); og.connect(master);
      o.start(t); o.stop(t + 0.4);
    }

    // The match catching.
    function spark() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(0.6);
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(1700, t);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.55);
      f.Q.value = 1.1;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.09);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      n.connect(f); f.connect(g); g.connect(master);
      n.start(t); n.stop(t + 0.65);
    }

    // Shankh: a swept saw with breath over it.
    function conch() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(196, t);
      o.frequency.linearRampToValueAtTime(262, t + 0.5);
      o.frequency.linearRampToValueAtTime(258, t + 2.4);
      const vib = ac.createOscillator();
      vib.type = "sine"; vib.frequency.value = 5.4;
      const vg = ac.createGain(); vg.gain.value = 3.2;
      vib.connect(vg); vg.connect(o.frequency);
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(560, t);
      f.frequency.linearRampToValueAtTime(1250, t + 1.2);
      f.Q.value = 0.9;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.35);
      g.gain.setValueAtTime(0.2, t + 1.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
      o.connect(f); f.connect(g); g.connect(bus); g.connect(verb);
      o.start(t); o.stop(t + 3.1);
      vib.start(t); vib.stop(t + 3.1);

      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(3.2);
      const nf = ac.createBiquadFilter();
      nf.type = "bandpass"; nf.frequency.value = 1400; nf.Q.value = 0.8;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.05, t + 0.4);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      n.connect(nf); nf.connect(ng); ng.connect(master);
      n.start(t); n.stop(t + 3.1);
    }

    let flameAudioAt = 0, flameFreqSm = 500;
    function setFlameSound(level, speed) {
      if (!ac || muted || !flameGain) return;
      const t = ac.currentTime;
      flameFreqSm += (420 + speed * 1300 - flameFreqSm) * 0.2;
      // Automating a biquad every frame stacks events and can make the filter
      // unstable, so this is smoothed here and sent about twelve times a second.
      if (t - flameAudioAt < 0.08) return;
      flameAudioAt = t;
      flameGain.gain.setTargetAtTime(0.05 * level * (0.35 + speed * 1.6), t, 0.09);
      flameFilter.frequency.value = flameFreqSm;
    }

    function sting(name) {
      if (ac || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    ctx.onDestroy(() => {
      try { if (flameSrc) flameSrc.stop(); } catch (_) {}
      try { if (ac) ac.close(); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 400 }); } catch (_) {}
    });

    // ===================================================================== //
    // 3. Three, the room, the thali                                         //
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
        '<div style="font-size:19px;font-weight:700;margin-bottom:10px;">Aarti</div>' +
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
    renderer.toneMappingExposure = 1.12;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (_) {} });

    // ---- textures ---------------------------------------------------------
    function bakeGlow(size, hardness, r, g, b) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const c = (size - 1) / 2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x - c) / c, dy = (y - c) / c;
          const rad = Math.sqrt(dx * dx + dy * dy);
          const a = Math.pow(Math.max(0, 1 - rad), hardness);
          const i = (y * size + x) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
          d[i + 3] = Math.round(a * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    // A flame: a teardrop with a white core, an orange mantle and a soft top.
    function bakeFlame(size) {
      const cv = surface(size, size * 2);
      if (!cv) return null;
      const h = size * 2;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < size; x++) {
          const nx = (x / (size - 1)) * 2 - 1;
          const ny = 1 - y / (h - 1);                 // 0 at the wick, 1 at the tip
          // the outline: fat near the base, pinched at the tip
          const w = Math.pow(Math.sin(Math.pow(ny, 0.55) * Math.PI), 0.72) * 0.96;
          const inside = w > 0 ? clamp((w - Math.abs(nx)) / Math.max(0.02, w), 0, 1) : 0;
          const core = Math.pow(inside, 2.4) * (1 - Math.pow(ny, 1.6));
          const body = Math.pow(inside, 0.9);
          const i = (y * size + x) * 4;
          d[i] = Math.min(255, 255 * (0.7 * body + 0.55 * core));
          d[i + 1] = Math.min(255, 255 * (0.3 * body + 0.62 * core) * (1 - ny * 0.35));
          d[i + 2] = Math.min(255, 255 * (0.04 * body + 0.55 * core) * (1 - ny * 0.7));
          d[i + 3] = Math.round(clamp(body * (1 - Math.pow(ny, 3) * 0.55), 0, 1) * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    // Hammered brass: a bump field of overlapping dents, differentiated.
    function bakeHammer(size) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const hf = new Float32Array(size * size);
      const dents = [];
      for (let i = 0; i < 90; i++) dents.push([rnd(0, size), rnd(0, size), rnd(size * 0.03, size * 0.07)]);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let v = 0;
          for (const [cx, cy, r] of dents) {
            let dx = x - cx, dy = y - cy;
            if (dx > size / 2) dx -= size; if (dx < -size / 2) dx += size;
            if (dy > size / 2) dy -= size; if (dy < -size / 2) dy += size;
            const dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < r) v += Math.cos((dd / r) * Math.PI * 0.5) * 0.5;
          }
          hf[y * size + x] = v;
        }
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const l = hf[y * size + ((x - 1 + size) % size)];
          const r = hf[y * size + ((x + 1) % size)];
          const u = hf[((y - 1 + size) % size) * size + x];
          const dn = hf[((y + 1) % size) * size + x];
          let nx = (l - r) * 2.2, ny = (u - dn) * 2.2, nz = 1;
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
      t.repeat.set(3, 3);
      t.needsUpdate = true;
      return t;
    }

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
          const w = Math.sin(Math.pow(ny, 0.72) * Math.PI) * 0.92;
          const inside = Math.abs(nx) < w ? Math.min(1, (w - Math.abs(nx)) * 7) : 0;
          const shade = 0.55 + 0.45 * (1 - ny) + 0.18 * (1 - Math.abs(nx) / Math.max(0.01, w));
          const i = (y * size + x) * 4;
          d[i] = Math.min(255, 255 * shade);
          d[i + 1] = Math.min(255, 168 * shade);
          d[i + 2] = Math.min(255, 52 * shade);
          d[i + 3] = Math.round(inside * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    // A rangoli on the wall behind, drawn in rings of dots and petals. It is
    // painted in pixels rather than gradients so no colour has to be resolved.
    function bakeRangoli(size) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const c = (size - 1) / 2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x - c) / c, dy = (y - c) / c;
          const rad = Math.sqrt(dx * dx + dy * dy);
          const ang = Math.atan2(dy, dx);
          let v = 0;
          if (rad < 1) {
            // petal rings at three radii, each with a different fold count
            v += Math.max(0, Math.cos(ang * 16) - 0.72) * Math.exp(-Math.pow((rad - 0.82) * 16, 2)) * 6;
            v += Math.max(0, Math.cos(ang * 12) - 0.55) * Math.exp(-Math.pow((rad - 0.58) * 15, 2)) * 5;
            v += Math.max(0, Math.cos(ang * 8) - 0.35) * Math.exp(-Math.pow((rad - 0.34) * 14, 2)) * 4;
            v += Math.exp(-Math.pow((rad - 0.94) * 60, 2)) * 0.9;
            v += Math.exp(-Math.pow((rad - 0.16) * 40, 2)) * 0.7;
            v *= 1 - Math.pow(rad, 6);
          }
          v = clamp(v, 0, 1);
          const i = (y * size + x) * 4;
          d[i] = 255; d[i + 1] = 170; d[i + 2] = 88;
          d[i + 3] = Math.round(v * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    function bakeRoom() {
      const w = 512, h = 256;
      const cv = surface(w, h);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const grad = g2.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#120904");
      grad.addColorStop(0.45, "#2a1608");
      grad.addColorStop(0.75, "#160b04");
      grad.addColorStop(1, "#060301");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, w, h);
      const lamp = (cx, cy, r, inner, mid) => {
        for (const ox of [-w, 0, w]) {
          const rg = g2.createRadialGradient(cx + ox, cy, 1, cx + ox, cy, r);
          rg.addColorStop(0, inner);
          rg.addColorStop(0.45, mid);
          rg.addColorStop(1, "rgba(0,0,0,0)");
          g2.fillStyle = rg;
          g2.fillRect(0, 0, w, h);
        }
      };
      lamp(w * 0.5, h * 0.52, w * 0.2, "#ffcf90", "#6d3d18");
      lamp(w * 0.12, h * 0.4, w * 0.12, "#c98a44", "#432411");
      lamp(w * 0.86, h * 0.62, w * 0.1, "#8a4a2a", "#2c1509");
      const t = new THREE.CanvasTexture(cv);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }

    const texGlow = bakeGlow(64, 2.6, 255, 214, 150);
    const texSmoke = bakeGlow(64, 1.5, 190, 180, 172);
    const texFlame = bakeFlame(64);
    const texHammer = bakeHammer(256);
    const texPetal = bakePetal(64);
    const texRangoli = bakeRangoli(384);
    const roomTex = bakeRoom();

    scene.background = new THREE.Color(0x0d0704);
    if (roomTex) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        scene.environment = pmrem.fromEquirectangular(roomTex).texture;
        scene.environmentIntensity = 1.5;
        pmrem.dispose();
      } catch (_) {
        scene.environment = roomTex;
      }
    }

    // ---- lights -----------------------------------------------------------
    const ambient = new THREE.AmbientLight(0x4a2f1c, 1.35);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffd9a6, 1.05);
    key.position.set(1.6, 3.2, 3.4);
    scene.add(key);

    // a cold kicker from behind so the brass has an edge in the dark
    const edge = new THREE.DirectionalLight(0x6f8fc8, 0.5);
    edge.position.set(-2.6, 1.4, -3.0);
    scene.add(edge);

    // The flame is the real light in the room; everything else is a whisper.
    const flameLight = new THREE.PointLight(0xffa04a, 6, 12, 2);
    scene.add(flameLight);

    // ---- the wall behind ---------------------------------------------------
    let rangoli = null;
    if (texRangoli) {
      rangoli = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 5.6),
        new THREE.MeshBasicMaterial({
          map: texRangoli, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      rangoli.position.set(0, 0.3, -3.4);
      scene.add(rangoli);
    }

    // ---- the thali ---------------------------------------------------------
    const brass = new THREE.MeshPhysicalMaterial({
      color: 0xd8a441, metalness: 0.9, roughness: 0.3,
      normalMap: texHammer || null, envMapIntensity: 1.25
    });
    const brassDark = new THREE.MeshPhysicalMaterial({
      color: 0xa9762a, metalness: 0.9, roughness: 0.42,
      normalMap: texHammer || null, envMapIntensity: 1.0
    });
    const clay = new THREE.MeshStandardMaterial({ color: 0x9c5a37, roughness: 0.88, metalness: 0.02 });
    const wickMat = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.9 });
    const oilMat = new THREE.MeshPhysicalMaterial({
      color: 0x6a4410, roughness: 0.12, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.2
    });

    const thali = new THREE.Group();
    scene.add(thali);

    const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.93, 0.055, 48), brass);
    thali.add(plate);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.055, 8, 48), brass);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.024;
    thali.add(rim);
    const groove = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.014, 6, 48), brassDark);
    groove.rotation.x = Math.PI / 2;
    groove.position.y = 0.029;
    thali.add(groove);
    const groove2 = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.01, 6, 48), brassDark);
    groove2.rotation.x = Math.PI / 2;
    groove2.position.y = 0.029;
    thali.add(groove2);

    // the diya, front and centre
    const WICK = new THREE.Vector3(0, 0.135, 0.30);
    const diya = new THREE.Group();
    diya.position.set(0, 0.028, 0.30);
    thali.add(diya);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.13, 0.1, 20), clay);
    bowl.position.y = 0.05;
    diya.add(bowl);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.022, 6, 20), clay);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.1;
    diya.add(lip);
    const oil = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.012, 20), oilMat);
    oil.position.y = 0.094;
    diya.add(oil);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.009, 0.1, 6), wickMat);
    wick.position.set(0, 0.13, 0.05);
    wick.rotation.x = -0.25;
    diya.add(wick);

    // offerings
    function heap(x, z, colour, r) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10),
        new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95, metalness: 0 }));
      m.scale.set(1, 0.45, 1);
      m.position.set(x, 0.028, z);
      thali.add(m);
      return m;
    }
    heap(-0.5, -0.16, 0xc4181c, 0.115);   // kumkum
    heap(0.5, -0.16, 0xf2e6c6, 0.115);    // akshat
    heap(0, -0.55, 0xe8b21c, 0.1);        // haldi

    // the rakhi itself, waiting on the plate
    const rakhi = new THREE.Group();
    rakhi.position.set(0.52, 0.032, 0.42);
    thali.add(rakhi);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.024, 6, 20),
      new THREE.MeshPhysicalMaterial({ color: 0xd8203c, roughness: 0.6, sheen: 0.5,
        sheenColor: new THREE.Color(0x8a6a50), metalness: 0 }));
    band.rotation.x = Math.PI / 2;
    rakhi.add(band);
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.062, 0.02, 14),
      new THREE.MeshPhysicalMaterial({ color: 0xffd066, metalness: 1, roughness: 0.2, envMapIntensity: 1.6 }));
    boss.position.y = 0.012;
    rakhi.add(boss);

    // petals lying on the brass
    if (texPetal) {
      const pm = new THREE.MeshBasicMaterial({ map: texPetal, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.17), pm);
        const a = rnd(0, TAU), r = rnd(0.3, 0.82);
        p.position.set(Math.cos(a) * r, 0.033, Math.sin(a) * r - 0.05);
        p.rotation.set(-Math.PI / 2, 0, rnd(0, TAU));
        thali.add(p);
      }
    }

    // ---- the flame ---------------------------------------------------------
    const flameGroup = new THREE.Group();
    flameGroup.visible = false;
    scene.add(flameGroup);

    const flameLayers = [];
    if (texFlame) {
      const specs = [[0.46, 0.8, 0.5, 0xff9b3c], [0.32, 0.58, 0.55, 0xffc064], [0.17, 0.34, 0.8, 0xffe8b4]];
      for (const [w, h, op, tint] of specs) {
        const g = new THREE.PlaneGeometry(w, h);
        g.translate(0, h * 0.5, 0);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          map: texFlame, color: tint, transparent: true, opacity: op,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        }));
        m.userData.phase = rnd(0, TAU);
        m.userData.h = h;
        flameGroup.add(m);
        flameLayers.push(m);
      }
      // the cold blue root, which only shows when the flame is in trouble
      const bg = new THREE.PlaneGeometry(0.2, 0.22);
      bg.translate(0, 0.11, 0);
      const blue = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({
        map: texFlame, color: 0x5aa8ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
      flameGroup.add(blue);
      flameGroup.userData.blue = blue;
    }
    let flameHalo = null;
    if (texGlow) {
      flameHalo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({
        map: texGlow, color: 0xffa54a, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      flameHalo.position.y = 0.22;
      flameGroup.add(flameHalo);
    }

    // ---- the trail of light -------------------------------------------------
    // A ribbon dropped behind the flame, widest and brightest where it was just
    // laid down and fading to nothing over five seconds. It is the drawing.
    // Two ribbons, actually: a wide dim one for the glow and a narrow hot one
    // for the core, which is what a bloom pass would have given us if the
    // runtime had one.
    const TRAIL_N = 230;
    const TRAIL_LIFE = 5.0;
    const trailPts = [];
    const ribbons = [];

    function makeRibbon(widthMul, alphaMul) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(TRAIL_N * 2 * 3);
      const col = new Float32Array(TRAIL_N * 2 * 4);
      const idx = new Uint16Array((TRAIL_N - 1) * 6);
      let k = 0;
      for (let i = 0; i < TRAIL_N - 1; i++) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 3, d = i * 2 + 2;
        idx[k++] = a; idx[k++] = b; idx[k++] = c;
        idx[k++] = a; idx[k++] = c; idx[k++] = d;
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.setDrawRange(0, 0);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12);
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const mirrorMeshes = [];
      for (let i = 1; i < 8; i++) {
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false;
        m.visible = false;
        m.rotation.z = (i / 8) * TAU;
        scene.add(m);
        mirrorMeshes.push(m);
      }
      const r = { geo: geo, pos: pos, col: col, mesh: mesh, mirrors: mirrorMeshes,
                  wm: widthMul, am: alphaMul };
      ribbons.push(r);
      return r;
    }

    makeRibbon(2.6, 0.13);      // the glow around it
    makeRibbon(0.8, 0.62);      // the hot core

    let trailFrozen = false;

    function pushTrail(x, y, z, width, heat) {
      const last = trailPts[trailPts.length - 1];
      if (last) {
        const dx = x - last.x, dy = y - last.y, dz = z - last.z;
        if (dx * dx + dy * dy + dz * dz < 0.0009) return;
      }
      trailPts.push({ x: x, y: y, z: z, age: 0, w: width, heat: heat });
      if (trailPts.length > TRAIL_N) trailPts.shift();
    }

    function updateTrail(dt) {
      if (!trailFrozen) {
        for (const p of trailPts) p.age += dt;
        while (trailPts.length && trailPts[0].age > TRAIL_LIFE) trailPts.shift();
      }
      const n = trailPts.length;
      if (n < 2) {
        for (const r of ribbons) r.geo.setDrawRange(0, 0);
        return;
      }
      for (let i = 0; i < n; i++) {
        const p = trailPts[i];
        const q = trailPts[Math.min(n - 1, i + 1)];
        const b = trailPts[Math.max(0, i - 1)];
        let tx = q.x - b.x, ty = q.y - b.y;
        const tl = Math.sqrt(tx * tx + ty * ty) || 1;
        tx /= tl; ty /= tl;
        const sx = -ty, sy = tx;                 // across the direction of travel
        const life = trailFrozen ? 0.55 : clamp(1 - p.age / TRAIL_LIFE, 0, 1);
        const hot = Math.pow(life, 0.55) * (0.45 + 0.55 * p.heat);
        const o = i * 6, c = i * 8;
        for (const r of ribbons) {
          const w = p.w * r.wm * (0.3 + 0.7 * Math.pow(life, 0.45));
          r.pos[o] = p.x + sx * w; r.pos[o + 1] = p.y + sy * w; r.pos[o + 2] = p.z;
          r.pos[o + 3] = p.x - sx * w; r.pos[o + 4] = p.y - sy * w; r.pos[o + 5] = p.z;
          const a = Math.pow(life, 1.35) * r.am;
          const cr = 1.0, cg = 0.035 + 0.2 * hot, cb = 0.004 + 0.055 * hot * hot * hot;
          r.col[c] = cr; r.col[c + 1] = cg; r.col[c + 2] = cb; r.col[c + 3] = a;
          r.col[c + 4] = cr; r.col[c + 5] = cg; r.col[c + 6] = cb; r.col[c + 7] = a;
        }
      }
      for (const r of ribbons) {
        r.geo.setDrawRange(0, (n - 1) * 6);
        r.geo.attributes.position.needsUpdate = true;
        r.geo.attributes.color.needsUpdate = true;
      }
    }

    // ---- smoke and petals ---------------------------------------------------
    const SMOKE = 16;
    let smokeMesh = null;
    const smokeState = [];
    if (texSmoke) {
      smokeMesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.5, 0.5),
        new THREE.MeshBasicMaterial({
          map: texSmoke, transparent: true, opacity: 0.3, depthWrite: false,
          blending: THREE.NormalBlending, color: 0x6a5f56
        }),
        SMOKE
      );
      smokeMesh.frustumCulled = false;
      smokeMesh.count = 0;
      scene.add(smokeMesh);
      for (let i = 0; i < SMOKE; i++) smokeState.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, life: 0, s: 1 });
    }

    const PETALS = 60;
    let petalMesh = null;
    const petalState = [];
    if (texPetal) {
      petalMesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.16, 0.25),
        new THREE.MeshBasicMaterial({ map: texPetal, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
        PETALS
      );
      petalMesh.frustumCulled = false;
      petalMesh.count = 0;
      scene.add(petalMesh);
      for (let i = 0; i < PETALS; i++) {
        petalState.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, rx: 0, ry: 0, rz: 0, spin: 0, life: 0 });
      }
    }

    const m4 = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const ee = new THREE.Euler();
    const vv = new THREE.Vector3();
    const ss = new THREE.Vector3(1, 1, 1);

    function dropPetals(count, x, y) {
      if (!petalMesh) return;
      let placed = 0;
      for (const p of petalState) {
        if (placed >= count) break;
        if (p.life > 0) continue;
        p.x = x + rnd(-0.4, 0.4); p.y = y + rnd(-0.1, 0.4); p.z = rnd(-0.4, 0.7);
        p.vx = rnd(-0.5, 0.5); p.vy = rnd(0.4, 1.5);
        p.rx = rnd(0, TAU); p.ry = rnd(0, TAU); p.rz = rnd(0, TAU);
        p.spin = rnd(-3, 3);
        p.life = rnd(2.6, 4.4);
        placed++;
      }
      petalMesh.visible = true;
      petalMesh.count = PETALS;
    }

    function rainPetals() {
      if (!petalMesh) return;
      for (const p of petalState) {
        p.x = rnd(-3, 3); p.y = rnd(3.4, 7.5); p.z = rnd(-1.6, 1.6);
        p.vx = rnd(-0.3, 0.3); p.vy = rnd(-1.4, -0.6);
        p.rx = rnd(0, TAU); p.ry = rnd(0, TAU); p.rz = rnd(0, TAU);
        p.spin = rnd(-2.6, 2.6);
        p.life = rnd(4, 7);
      }
      petalMesh.visible = true;
      petalMesh.count = PETALS;
    }

    function stepPetals(dt) {
      if (!petalMesh || !petalMesh.visible) return;
      let alive = 0;
      for (let i = 0; i < PETALS; i++) {
        const p = petalState[i];
        if (p.life <= 0) { m4.makeScale(0, 0, 0); petalMesh.setMatrixAt(i, m4); continue; }
        p.life -= dt;
        p.vy -= 1.5 * dt;
        p.vy = Math.max(p.vy, -1.7);
        p.x += (p.vx + Math.sin(p.rz + p.y * 0.8) * 0.35) * dt;
        p.y += p.vy * dt;
        p.rx += p.spin * dt; p.ry += p.spin * 0.6 * dt;
        ee.set(p.rx, p.ry, p.rz);
        qq.setFromEuler(ee);
        vv.set(p.x, p.y, p.z);
        const sc = clamp(p.life, 0, 1);
        ss.set(sc, sc, sc);
        m4.compose(vv, qq, ss);
        petalMesh.setMatrixAt(i, m4);
        alive++;
      }
      petalMesh.instanceMatrix.needsUpdate = true;
      if (!alive) { petalMesh.visible = false; petalMesh.count = 0; }
    }

    function blowSmoke(x, y, z) {
      if (!smokeMesh) return;
      smokeMesh.visible = true;
      smokeMesh.count = SMOKE;
      for (const s of smokeState) {
        s.x = x + rnd(-0.05, 0.05); s.y = y; s.z = z;
        s.vx = rnd(-0.25, 0.25); s.vy = rnd(0.35, 0.8);
        s.life = rnd(1.4, 2.6); s.s = rnd(0.4, 0.9);
      }
    }

    function stepSmoke(dt) {
      if (!smokeMesh || !smokeMesh.visible) return;
      let alive = 0;
      for (let i = 0; i < SMOKE; i++) {
        const s = smokeState[i];
        if (s.life <= 0) { m4.makeScale(0, 0, 0); smokeMesh.setMatrixAt(i, m4); continue; }
        s.life -= dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.vy *= 1 - dt * 0.4;
        s.s += dt * 0.5;
        qq.copy(camera.quaternion);
        vv.set(s.x, s.y, s.z);
        const sc = s.s * clamp(s.life, 0, 1);
        ss.set(sc, sc, sc);
        m4.compose(vv, qq, ss);
        smokeMesh.setMatrixAt(i, m4);
        alive++;
      }
      smokeMesh.instanceMatrix.needsUpdate = true;
      if (!alive) { smokeMesh.visible = false; smokeMesh.count = 0; }
    }

    // an ember on the wick while the match is held
    let ember = null;
    if (texGlow) {
      ember = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshBasicMaterial({
        map: texGlow, color: 0xff6a1e, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      scene.add(ember);
    }

    // ===================================================================== //
    // 4. State                                                              //
    // ===================================================================== //
    let phase = "unlit";           // unlit -> lighting -> lit -> done
    let rounds = 0;
    let best = 0;
    let flameHealth = 0;
    let pressT = 0;
    let dragging = false;
    let started = false;
    let time = 0;
    let endT = 0;

    const CENTRE = new THREE.Vector2(0, 0.1);
    const SAFE_SPEED = 3.8;
    let speedSm = 0;
    const pos = new THREE.Vector2(0, 0.1);
    const vel = new THREE.Vector2(0, 0);
    const target = new THREE.Vector2(0, 0.1);
    const grab = new THREE.Vector2(0, 0);
    let lastAng = 0, accum = 0, hasAng = false;
    let speed = 0, lean = 0, leanV = 0;
    let shake = 0;

    const wickWorld = new THREE.Vector3();
    const ndc = new THREE.Vector3();
    const camDir = new THREE.Vector3();

    function screenToPlane(x, y, out) {
      ndc.set((x / Math.max(1, W)) * 2 - 1, -((y / Math.max(1, H)) * 2 - 1), 0.5);
      ndc.unproject(camera);
      camDir.copy(ndc).sub(camera.position);
      if (Math.abs(camDir.z) < 1e-6) return false;
      const t = -camera.position.z / camDir.z;
      if (t <= 0) return false;
      out.set(camera.position.x + camDir.x * t, camera.position.y + camDir.y * t);
      return true;
    }

    function paintPips() {
      for (let i = 0; i < ROUNDS; i++) {
        const on = i < rounds;
        pipEls[i].style.background = on ? GOLD : "rgba(247,230,205,0.18)";
        pipEls[i].style.boxShadow = on ? "0 0 10px rgba(246,198,90,0.75)" : "none";
        pipEls[i].style.transform = on ? "scale(1.25)" : "scale(1)";
      }
    }
    paintPips();

    function paintBest() {
      nodes.best.textContent = best > 0 ? "BEST " + best : "";
      nodes.best.style.display = best > 0 ? "block" : "none";
    }

    if (ctx.capabilities.storage !== false) {
      try {
        const saved = await ctx.storage.get("best");
        if (typeof saved === "number" && isFinite(saved)) best = saved | 0;
      } catch (_) { /* storage is a nicety */ }
    }
    paintBest();

    function firstGesture() {
      if (started) return;
      started = true;
      resumeAudio();
      ctx.platform.start();
      if (canMusic && ctx.music && ctx.music.unlock) { try { ctx.music.unlock(); } catch (_) {} }
    }

    // ---- pointer ------------------------------------------------------------
    ctx.listen(view, "pointerdown", (e) => {
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      if (phase === "unlit") {
        phase = "lighting";
        pressT = 0;
        spark();
        return;
      }
      if (phase === "lit") {
        dragging = true;
        if (screenToPlane(e.offsetX, e.offsetY, target)) {
          // grab where you touched, so the plate does not snap to the finger
          grab.set(pos.x - target.x, pos.y - target.y);
        }
      }
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!dragging || phase !== "lit") return;
      screenToPlane(e.offsetX, e.offsetY, target);
    });

    const endPointer = () => {
      dragging = false;
      if (phase === "lighting") { phase = "unlit"; pressT = 0; }
    };
    ctx.listen(view, "pointerup", endPointer);
    ctx.listen(view, "pointercancel", endPointer);
    ctx.listen(view, "pointerleave", endPointer);

    // ---- lighting, blowing out, finishing -----------------------------------
    function light() {
      phase = "lit";
      flameHealth = 1;
      flameGroup.visible = true;
      dragging = true;                 // the finger that lit it can carry it
      grab.set(0, 0);
      target.copy(pos);
      hasAng = false;
      accum = 0;
      nodes.relight.style.display = "none";
      nodes.hint.textContent = "carry it in slow circles";
      setDrone(1);
      bell(392, 0.16, 0.7);
      ctx.platform.haptic("light");
      ctx.platform.interact({ type: "light" });
    }

    async function submitRun(n) {
      if (n <= 0) return;
      if (n > best) {
        best = n;
        paintBest();
        if (ctx.capabilities.storage !== false) {
          try { await ctx.storage.set("best", best); } catch (_) {}
        }
      }
      try {
        await ctx.memory.record("steady").submit(n, { label: n + (n === 1 ? " turn" : " turns") });
      } catch (err) {
        ctx.platform.error({ where: "record_submit", message: String(err) });
      }
    }

    function blowOut() {
      if (phase !== "lit") return;
      phase = "unlit";
      dragging = false;
      flameHealth = 0;
      flameGroup.visible = false;
      puff();
      sting("fail");
      shake = 1;
      setDrone(0.25);
      blowSmoke(wickWorld.x, wickWorld.y + 0.1, wickWorld.z);
      ctx.platform.haptic("warning");
      ctx.platform.fail({ rounds: rounds });
      submitRun(rounds);
      nodes.hint.textContent = rounds >= 1
        ? "the flame went out at " + rounds + (rounds === 1 ? " turn" : " turns")
        : "too quick — the flame went out";
      nodes.relight.style.display = "block";
      rounds = 0;
      accum = 0;
      hasAng = false;
      paintPips();
      ctx.platform.setProgress(0);
    }

    function finish() {
      phase = "done";
      dragging = false;
      endT = 0;
      trailFrozen = true;   // the mirrors are revealed one fold at a time
      conch();
      bell(262, 0.22, 1.6);
      ctx.timeout(() => bell(392, 0.16, 1.4), 420);
      shimmer(18, 0.05);
      rainPetals();
      setDrone(1.4);
      ctx.platform.haptic("success");
      ctx.platform.setProgress(1);
      ctx.platform.milestone("aarti_complete");
      ctx.platform.complete({ rounds: ROUNDS });
      submitRun(ROUNDS);
      nodes.hint.style.opacity = "0";
      nodes.top.style.opacity = "0";
      nodes.pips.style.opacity = "0";
      nodes.card.style.opacity = "1";
      nodes.cardname.textContent = "आरती संपूर्ण";
      nodes.cardsub.textContent = "eleven turns, steady";
      nodes.endrow.style.display = "flex";
    }

    function restart() {
      phase = "unlit";
      rounds = 0;
      accum = 0;
      hasAng = false;
      flameHealth = 0;
      flameGroup.visible = false;
      trailFrozen = false;
      trailPts.length = 0;
      for (const r of ribbons) for (const m of r.mirrors) m.visible = false;
      pos.set(0, 0.1); vel.set(0, 0); target.set(0, 0.1); grab.set(0, 0);
      nodes.card.style.opacity = "0";
      nodes.endrow.style.display = "none";
      nodes.relight.style.display = "none";
      nodes.hint.style.opacity = "1";
      nodes.hint.textContent = "press and hold to light the wick";
      nodes.top.style.opacity = "1";
      nodes.pips.style.opacity = "1";
      paintPips();
      setDrone(0.25);
      ctx.platform.setProgress(0);
    }

    ctx.listen(nodes.relight, "click", () => { firstGesture(); phase = "lighting"; pressT = 0; spark(); });
    ctx.listen(nodes.again, "click", () => { firstGesture(); restart(); });
    ctx.listen(nodes.help, "click", () => { showHelp(); nodes.sheet.style.display = "flex"; });

    // ---- the leaderboard ----------------------------------------------------
    // Reachable from the help sheet as well as from the end of a run, so it is
    // not locked behind finishing eleven turns.
    const HELP_HTML = nodes.sheetbody.innerHTML;

    function closeSheet() { nodes.sheet.style.display = "none"; }

    function wireSheet() {
      const c = nodes.sheetbody.querySelector('[data-el="close"]');
      if (c) ctx.listen(c, "click", () => { closeSheet(); firstGesture(); });
      const b = nodes.sheetbody.querySelector('[data-el="toboard"]');
      if (b) ctx.listen(b, "click", showBoard);
    }

    function showHelp() {
      nodes.sheetbody.innerHTML = HELP_HTML +
        '<button data-el="toboard" style="pointer-events:auto;margin-top:10px;width:100%;height:44px;' +
        'border-radius:22px;border:1px solid rgba(247,230,205,0.3);background:transparent;color:' + INK + ';' +
        'font-size:14px;font-weight:600;font-family:inherit;">Steadiest hands</button>';
      wireSheet();
    }
    showHelp();

    function readBoard(res) {
      if (!res) return [];
      let raw = Array.isArray(res) ? res
        : res.entries || res.items || res.records || res.rows ||
          (res.data && (res.data.entries || res.data.items)) || [];
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (const e of raw) {
        if (!e || typeof e !== "object") continue;
        const user = e.user || e.author || e.by || null;
        const who = typeof user === "string" ? user
          : (user && (user.handle || user.username || user.displayName || user.name)) || e.handle || "someone";
        const value = e.label || e.formatted || e.value || e.score;
        out.push({
          rank: e.rank || out.length + 1,
          who: String(who).slice(0, 18),
          value: String(value == null ? "" : value).slice(0, 14),
          self: !!(e.self || e.mine || e.isSelf || (user && user.self))
        });
        if (out.length >= 10) break;
      }
      return out;
    }

    function esc(t) {
      return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    async function showBoard() {
      nodes.sheet.style.display = "flex";
      nodes.sheetbody.innerHTML =
        '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">Steadiest hands</div>' +
        '<div style="font-size:13.5px;color:' + DIM + ';">looking…</div>';
      let rows = [];
      try {
        rows = readBoard(await ctx.memory.record("steady").leaderboard({ scope: "global", period: "all_time" }));
      } catch (err) {
        ctx.platform.error({ where: "leaderboard", message: String(err) });
      }
      let html = '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">Steadiest hands</div>';
      if (!rows.length) {
        html += '<div style="font-size:13.5px;line-height:1.7;color:' + DIM + ';">' +
          'No turns recorded yet. Finish an aarti and yours goes up first.</div>';
      } else {
        html += '<div style="font-size:14px;line-height:2.0;">';
        for (const r of rows) {
          html += '<div style="display:flex;justify-content:space-between;gap:12px;' +
            (r.self ? "color:" + GOLD + ";font-weight:700;" : "") + '">' +
            '<span>' + r.rank + ". " + esc(r.who) + '</span><span>' + esc(r.value) + '</span></div>';
        }
        html += '</div>';
      }
      html += '<button data-el="close" style="pointer-events:auto;margin-top:22px;width:100%;height:46px;' +
        'border-radius:23px;border:0;background:' + GOLD + ';color:#2a1503;font-size:15px;font-weight:700;' +
        'font-family:inherit;">Close</button>';
      nodes.sheetbody.innerHTML = html;
      const c = nodes.sheetbody.querySelector('[data-el="close"]');
      if (c) ctx.listen(c, "click", () => { closeSheet(); showHelp(); });
    }

    ctx.listen(nodes.board, "click", showBoard);

    // ===================================================================== //
    // 5. Layout and the frame loop                                          //
    // ===================================================================== //
    const TOP_RESERVE = SAFE_T + 84;
    const BOT_RESERVE = SAFE_B + 92;
    const camTarget = new THREE.Vector3(0, 0.1, 0);
    let camDist = 9;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;

      const half = Math.tan((camera.fov * Math.PI) / 360);
      const need = 2.12;                        // circle radius plus the plate
      const dW = need / (half * camera.aspect);
      const band = Math.max(140, H - TOP_RESERVE - BOT_RESERVE);
      const dH = (need * 2 * H) / (2 * half * band);
      camDist = Math.max(dW, dH);

      const visH = 2 * camDist * half;
      const bandCentre = TOP_RESERVE + band / 2;
      camTarget.set(0, 0.1 - ((bandCentre - H / 2) / H) * visH, 0);
      camera.updateProjectionMatrix();
    }
    layout();
    ctx.listen(window, "resize", () => ctx.timeout(layout, 60));
    if (window.visualViewport) ctx.listen(window.visualViewport, "resize", () => ctx.timeout(layout, 60));

    thali.scale.setScalar(0.86);
    setDrone(0.25);

    // Draw one frame before the curtain lifts, so nothing is ever blank.
    camera.position.set(0, camTarget.y + camDist * 0.34, camDist * 0.94);
    camera.lookAt(camTarget);
    renderer.render(scene, camera);
    nodes.curtain.style.transition = "opacity 520ms ease";
    nodes.curtain.style.opacity = "0";
    ctx.timeout(() => { nodes.curtain.style.display = "none"; }, 560);

    let lowHint = false;
    let progressSent = 0;

    ctx.onFrame((dtMs) => {
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      time += dt;

      // ---- lighting the wick ---------------------------------------------
      if (phase === "lighting") {
        pressT += dt;
        if (ember) ember.material.opacity = clamp(pressT / 0.8, 0, 1) * (0.55 + Math.sin(time * 40) * 0.25);
        if (pressT >= 0.8) light();
      } else if (ember) {
        ember.material.opacity = Math.max(0, ember.material.opacity - dt * 3);
      }

      // ---- the plate on its spring ----------------------------------------
      const prevVX = vel.x, prevVY = vel.y;
      if (phase === "lit" && dragging) {
        grab.multiplyScalar(Math.pow(0.02, dt));       // the grab offset melts away
        const tx = target.x + grab.x, ty = target.y + grab.y;
        vel.x += ((tx - pos.x) * 42 - vel.x * 5.4) * dt;
        vel.y += ((ty - pos.y) * 42 - vel.y * 5.4) * dt;
      } else {
        // let go and it drifts back to rest
        vel.x += ((CENTRE.x - pos.x) * 9 - vel.x * 4.2) * dt;
        vel.y += ((CENTRE.y - pos.y) * 9 - vel.y * 4.2) * dt;
      }
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      const rad = Math.sqrt((pos.x - CENTRE.x) * (pos.x - CENTRE.x) + (pos.y - CENTRE.y) * (pos.y - CENTRE.y));
      if (rad > 1.55) {
        const k = 1.55 / rad;
        pos.x = CENTRE.x + (pos.x - CENTRE.x) * k;
        pos.y = CENTRE.y + (pos.y - CENTRE.y) * k;
        vel.multiplyScalar(0.6);
      }
      speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      speedSm += (speed - speedSm) * Math.min(1, dt * 3.2);
      const accX = (vel.x - prevVX) / dt, accY = (vel.y - prevVY) / dt;

      // ---- can the flame survive this? -------------------------------------
      if (phase === "lit") {
        // Stress comes off a smoothed speed, so a single jolt does not kill a
        // flame that a sustained gallop should.
        const over = Math.max(0, speedSm - SAFE_SPEED) / SAFE_SPEED;
        flameHealth -= over * 1.9 * dt;
        flameHealth += dt * 0.34;
        flameHealth = clamp(flameHealth, 0, 1);
        if (flameHealth <= 0.001) blowOut();

        const low = flameHealth < 0.55;
        if (low !== lowHint) {
          lowHint = low;
          if (low) { nodes.hint.textContent = "steady — you are losing it"; ctx.platform.haptic("light"); }
          else nodes.hint.textContent = "carry it in slow circles";
        }
      }

      // ---- turns -----------------------------------------------------------
      if (phase === "lit" && rad > 0.5) {
        const ang = Math.atan2(pos.y - CENTRE.y, pos.x - CENTRE.x);
        if (!hasAng) { lastAng = ang; hasAng = true; }
        let d = ang - lastAng;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        lastAng = ang;
        accum += d;
        if (Math.abs(accum) >= TAU) {
          accum -= Math.sign(accum) * TAU;
          rounds++;
          paintPips();
          bell(294 * Math.pow(2, ((rounds - 1) % 7) / 12), 0.17, 0.85);
          shimmer(5, 0.028);
          dropPetals(5, pos.x, pos.y);
          ctx.platform.haptic("medium");
          ctx.platform.milestone("turn_" + rounds);
          const pr = clamp(rounds / ROUNDS, 0, 1);
          if (Math.abs(pr - progressSent) > 0.01) { progressSent = pr; ctx.platform.setProgress(pr); }
          if (rounds >= ROUNDS) finish();
        }
      } else if (rad <= 0.5) {
        hasAng = false;
      }

      // ---- place the thali --------------------------------------------------
      thali.position.set(pos.x, pos.y, 0);
      thali.rotation.z = clamp(-accX * 0.0022, -0.14, 0.14);
      thali.rotation.x = clamp(accY * 0.0022, -0.14, 0.14) + Math.sin(time * 0.7) * 0.006;

      thali.updateMatrixWorld();
      wickWorld.copy(WICK).applyMatrix4(thali.matrixWorld);

      // ---- the flame --------------------------------------------------------
      if (ember) ember.position.set(wickWorld.x, wickWorld.y + 0.04, wickWorld.z + 0.02);

      if (flameGroup.visible) {
        flameGroup.position.copy(wickWorld);
        flameGroup.quaternion.copy(camera.quaternion);
        // apparent wind: the flame bends away from where the plate is going
        const leanTarget = clamp(vel.x * 0.13, -0.95, 0.95);
        leanV += (leanTarget - lean) * dt * 16 - leanV * dt * 5;
        lean += leanV * dt;
        flameGroup.rotateZ(lean);

        const h = flameHealth;
        const wobble = 1 + Math.sin(time * 17 + Math.cos(time * 6.3) * 2) * 0.07 * (1 + (1 - h) * 3);
        const stretch = 1 + Math.min(0.6, speed * 0.1);
        for (let i = 0; i < flameLayers.length; i++) {
          const m = flameLayers[i];
          const ph = m.userData.phase;
          const f = 1 + Math.sin(time * (13 + i * 4) + ph) * 0.09;
          m.scale.set((0.55 + 0.45 * h) * f * (1 - 0.1 * (stretch - 1)),
                      (0.45 + 0.55 * h) * wobble * stretch, 1);
          m.position.x = Math.sin(time * (9 + i * 3) + ph) * 0.012 * (1 + (1 - h) * 4);
        }
        if (flameGroup.userData.blue) {
          flameGroup.userData.blue.material.opacity = (1 - h) * 0.85;
          flameGroup.userData.blue.scale.set(1, 0.8 + Math.sin(time * 21) * 0.2, 1);
        }
        if (flameHalo) flameHalo.material.opacity = (0.1 + 0.2 * h) * (0.85 + Math.sin(time * 11) * 0.15);

        flameLight.position.set(wickWorld.x, wickWorld.y + 0.28, wickWorld.z + 0.1);
        flameLight.intensity = (1.6 + 5.4 * h) * (0.85 + Math.sin(time * 14.7) * 0.15);
        flameLight.color.setRGB(1, 0.5 + 0.14 * h, 0.16 + 0.12 * h);

        pushTrail(wickWorld.x, wickWorld.y + 0.3, wickWorld.z + 0.02, 0.038 + 0.03 * h, h);
        setFlameSound(h, Math.min(1, speed / 5));
      } else {
        flameLight.intensity *= Math.pow(0.02, dt);
        setFlameSound(0, 0);
      }

      updateTrail(dt);
      stepPetals(dt);
      stepSmoke(dt);

      // ---- the room warms as the aarti goes on -----------------------------
      const glowT = clamp(rounds / ROUNDS, 0, 1) * (phase === "done" ? 1 : 0.85);
      ambient.intensity = 1.15 + glowT * 0.85 + flameHealth * 0.2;
      key.intensity = 0.9 + glowT * 0.55;
      if (rangoli) rangoli.material.opacity = 0.03 + glowT * 0.2 + (phase === "done" ? 0.1 : 0);

      // ---- the mandala assembles fold by fold ------------------------------
      if (phase === "done") {
        endT += dt;
        for (let i = 0; i < 7; i++) {
          if (!ribbons[0].mirrors[i].visible && endT > 0.28 + i * 0.19) {
            for (const r of ribbons) r.mirrors[i].visible = true;
            shimmer(3, 0.02);
          }
        }
      }

      // ---- camera ----------------------------------------------------------
      shake = Math.max(0, shake - dt * 2.4);
      const drift = Math.sin(time * 0.19) * 0.1;
      camera.position.set(
        drift + (Math.random() - 0.5) * shake * 0.1,
        camTarget.y + camDist * 0.34 + Math.sin(time * 0.24) * 0.08,
        camDist * 0.94
      );
      camera.lookAt(camTarget);

      renderer.render(scene, camera);
    });
  }
};
