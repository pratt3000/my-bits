/**
 * Bandhan Tree — one tree at dusk, carrying everybody's threads.
 *
 * Rakshabandhan is a promise made with a thread, so this is a tree you tie one
 * to. Every thread on it was tied by somebody, with their name on it and one
 * blessing they chose. They are all still there when you come back, and yours
 * is there for everyone else.
 *
 * The tree itself is generated, not modelled: a seeded recursive growth run
 * from the same seed on every device, so branch 47 is the same branch for
 * everyone. That is what makes the shared world cheap and exact — a thread is
 * stored as a slot index, a colour and a blessing, three small numbers, and it
 * lands on the same twig for you as it did for whoever tied it.
 *
 * Two hundred and forty slots are spread along the outer branches. Tying takes
 * a free one, and the thread grows into place with its knot and starts moving
 * in the same wind as all the others — one merged ribbon buffer for the lot of
 * them, so a hundred and forty threads cost one draw call.
 *
 * Picking a thread is done by projecting anchors to the screen rather than
 * raycasting a merged mesh: the nearest anchor within a thumb's reach wins,
 * which is both cheaper and much kinder to fingers.
 *
 * The world can be offline or refuse a write. When it does, the tree still
 * works, your own thread still appears, and the bit says so instead of
 * pretending.
 *
 * Sound: wind is bandpassed noise with a slow-moving filter, distant temple
 * bells ring on their own schedule, and each thread has a chime pitched by its
 * colour, so tapping along a branch plays a scale.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule). Every texture and
 * every sound is generated in-file — packaged assets are disabled.
 */
window.plethoraBit = {
  meta: {
    title: "Bandhan Tree",
    runtime: "plethora-bit@2",
    tags: ["3d", "shared", "co-creation", "art", "relaxing"],
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

    // The tree has to grow the same way on every device, so it gets its own
    // deterministic generator rather than Math.random.
    function mulberry(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

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
    // 1. What a thread can be                                               //
    // ===================================================================== //
    const SILKS = [
      { name: "kesari", hex: 0xff8a2a, note: 0 },
      { name: "laal", hex: 0xe23048, note: 3 },
      { name: "gulaabi", hex: 0xff5f9e, note: 5 },
      { name: "haldi", hex: 0xffcf3a, note: 7 },
      { name: "mor", hex: 0x1fb6a8, note: 10 },
      { name: "neel", hex: 0x5a6cf0, note: 12 },
      { name: "chandan", hex: 0xf6e2c4, note: 15 },
      { name: "vann", hex: 0x64c25a, note: 17 }
    ];

    const BLESSINGS = [
      "Keep well, keep laughing",
      "Come home safe",
      "I have got you",
      "Long life and light",
      "Nothing between us breaks",
      "May this year be kind",
      "Wherever you go, I am there",
      "You first, always",
      "Grow, and do not be afraid",
      "Be looked after"
    ];

    const SLOTS = 240;             // places on the tree a thread can be tied
    const MAX_DRAWN = 150;         // how many a phone should carry at once

    // ===================================================================== //
    // 2. First frame                                                        //
    // ===================================================================== //
    const view = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "4";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);

    const INK = "#f4e9dc";
    const DIM = "rgba(244,233,220,0.58)";
    const GOLD = "#f2c777";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Devanagari',sans-serif";

    ui.innerHTML =
      '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:' + FONT + ';' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:' + INK + ';">' +

      '<div data-el="top" style="position:absolute;left:0;right:0;top:' + (SAFE_T + 6) + 'px;padding:0 18px;' +
      'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;transition:opacity 400ms ease;">' +
        '<div>' +
          '<div style="font-size:19px;font-weight:700;letter-spacing:0.3px;line-height:1.05;">Bandhan Tree</div>' +
          '<div data-el="count" style="font-size:11px;letter-spacing:1.5px;color:' + DIM + ';margin-top:3px;">बंधन</div>' +
        '</div>' +
        '<button data-el="help" style="pointer-events:auto;width:34px;height:34px;border-radius:17px;' +
        'border:1px solid rgba(242,199,119,0.45);background:rgba(10,12,22,0.5);color:' + GOLD + ';' +
        'font-size:15px;font-weight:600;font-family:inherit;padding:0;">?</button>' +
      '</div>' +

      // the card that appears when you tap somebody else's thread
      '<div data-el="read" style="position:absolute;left:16px;right:16px;bottom:' + (SAFE_B + 92) + 'px;' +
      'opacity:0;transform:translateY(10px);transition:opacity 300ms ease,transform 300ms ease;' +
      'background:rgba(10,11,20,0.9);border:1px solid rgba(242,199,119,0.28);border-radius:18px;' +
      'padding:14px 16px;">' +
        '<div data-el="readsay" style="font-size:15.5px;line-height:1.45;font-weight:600;"></div>' +
        '<div data-el="readby" style="font-size:11.5px;letter-spacing:1.3px;text-transform:uppercase;' +
        'color:' + DIM + ';margin-top:7px;"></div>' +
      '</div>' +

      '<div data-el="bottom" style="position:absolute;left:0;right:0;bottom:' + (SAFE_B + 14) + 'px;' +
      'padding:0 16px;display:flex;flex-direction:column;align-items:center;gap:10px;">' +
        '<div data-el="hint" style="font-size:12.5px;letter-spacing:0.4px;color:' + DIM + ';text-align:center;' +
        'transition:opacity 300ms ease;">drag to walk around · tap a thread to read it</div>' +
        '<button data-el="tie" style="pointer-events:auto;width:100%;max-width:320px;height:50px;' +
        'border-radius:25px;border:0;background:' + GOLD + ';color:#20180a;font-size:15.5px;font-weight:700;' +
        'font-family:inherit;box-shadow:0 8px 26px rgba(242,199,119,0.28);">Tie a thread</button>' +
      '</div>' +

      // the composer
      '<div data-el="compose" style="position:absolute;left:0;right:0;bottom:0;display:none;pointer-events:auto;' +
      'background:linear-gradient(180deg, rgba(8,9,16,0) 0%, rgba(8,9,16,0.94) 22%, rgba(8,9,16,0.98) 100%);' +
      'padding:34px 18px ' + (SAFE_B + 18) + 'px;">' +
        '<div style="max-width:360px;margin:0 auto;">' +
          '<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:' + DIM + ';">' +
          'choose a silk</div>' +
          '<div data-el="silks" style="display:flex;gap:9px;margin-top:10px;flex-wrap:wrap;"></div>' +
          '<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:' + DIM + ';' +
          'margin-top:18px;">and a blessing</div>' +
          '<button data-el="say" style="pointer-events:auto;width:100%;margin-top:10px;min-height:56px;' +
          'border-radius:16px;border:1px solid rgba(244,233,220,0.22);background:rgba(255,255,255,0.05);' +
          'color:' + INK + ';font-size:15px;font-weight:600;font-family:inherit;padding:12px 14px;' +
          'text-align:left;line-height:1.35;"></button>' +
          '<div style="font-size:11px;color:' + DIM + ';margin-top:7px;">tap to change</div>' +
          '<div style="display:flex;gap:10px;margin-top:16px;">' +
            '<button data-el="cancel" style="pointer-events:auto;flex:1;height:48px;border-radius:24px;' +
            'border:1px solid rgba(244,233,220,0.28);background:transparent;color:' + INK + ';' +
            'font-size:14.5px;font-weight:600;font-family:inherit;">Not now</button>' +
            '<button data-el="confirm" style="pointer-events:auto;flex:1.4;height:48px;border-radius:24px;' +
            'border:0;background:' + GOLD + ';color:#20180a;font-size:15px;font-weight:700;' +
            'font-family:inherit;">Tie it on</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div data-el="sheet" style="position:absolute;inset:0;display:none;pointer-events:auto;' +
      'background:rgba(6,7,13,0.9);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);' +
      'align-items:center;justify-content:center;padding:26px;">' +
        '<div style="max-width:330px;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">The tree</div>' +
          '<div style="font-size:14px;line-height:1.75;color:rgba(244,233,220,0.86);">' +
            '• Drag to walk around the tree. Pinch is not needed — it comes to you.<br>' +
            '• Every thread on it was tied by a real person. Tap one to read who, and what they wished.<br>' +
            '• Tie your own: pick a silk and a blessing, and it goes up for everyone.<br>' +
            '• Yours keeps a small light on it so you can find it again.<br>' +
            '• Come back whenever. The tree keeps them.' +
          '</div>' +
          '<button data-el="close" style="pointer-events:auto;margin-top:22px;width:100%;height:46px;' +
          'border-radius:23px;border:0;background:' + GOLD + ';color:#20180a;font-size:15px;font-weight:700;' +
          'font-family:inherit;">Back to the tree</button>' +
        '</div>' +
      '</div>' +

      '<div data-el="curtain" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
      'align-items:center;justify-content:center;flex-direction:column;gap:16px;' +
      'background:linear-gradient(180deg, #131a34 0%, #2c2340 42%, #6b3a30 78%, #a1533a 100%);">' +
        '<div style="font-size:30px;font-weight:700;letter-spacing:0.5px;">Bandhan Tree</div>' +
        '<div style="font-size:12px;letter-spacing:2.4px;text-transform:uppercase;color:rgba(255,255,255,0.6);">' +
        'growing the branches</div>' +
      '</div>' +
      '</div>';

    const el = (n) => ui.querySelector('[data-el="' + n + '"]');
    const nodes = {
      top: el("top"), count: el("count"), help: el("help"),
      read: el("read"), readsay: el("readsay"), readby: el("readby"),
      hint: el("hint"), tie: el("tie"), compose: el("compose"), silks: el("silks"),
      say: el("say"), cancel: el("cancel"), confirm: el("confirm"),
      sheet: el("sheet"), close: el("close"), curtain: el("curtain")
    };

    ctx.markVisualReady("title");
    ctx.platform.ready();

    // ===================================================================== //
    // 3. Sound — wind, distant bells, and one chime per silk                //
    // ===================================================================== //
    const AC = (window.AudioContext || window.webkitAudioContext) || null;
    const canAudio = !!AC && ctx.capabilities.audio !== false;
    const canMusic = ctx.capabilities.backgroundMusic !== false;
    let ac = null, master = null, verb = null, bus = null;
    let windGain = null, windFilter = null, windSrc = null, padGain = null;
    let muted = false;

    function noiseBuffer(seconds) {
      const sr = ac.sampleRate;
      const len = Math.ceil(sr * seconds);
      const buf = ac.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        lp += (w - lp) * 0.22;                 // a little brown in the white
        d[i] = lp * 2.2;
      }
      return buf;
    }

    function startAudio() {
      if (ac || !canAudio) return;
      try { ac = new AC(); } catch (_) { ac = null; return; }

      master = ac.createGain();
      master.gain.value = 0;
      master.connect(ac.destination);
      master.gain.setTargetAtTime(0.85, ac.currentTime, 1.4);

      verb = ac.createGain();
      verb.gain.value = 0.44;
      const d1 = ac.createDelay(1.2); d1.delayTime.value = 0.223;
      const d2 = ac.createDelay(1.2); d2.delayTime.value = 0.331;
      // two delays cross-fed from one sum: the loop gain is 2x this, so it
      // has to stay under 0.5 or the network diverges
      const fb = ac.createGain(); fb.gain.value = 0.34;
      const damp = ac.createBiquadFilter();
      damp.type = "lowpass"; damp.frequency.value = 2100;
      verb.connect(d1); verb.connect(d2);
      d1.connect(damp); d2.connect(damp);
      damp.connect(fb); fb.connect(d1); fb.connect(d2);
      damp.connect(master);

      bus = ac.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      bus.connect(verb);

      // wind through the leaves
      windSrc = ac.createBufferSource();
      windSrc.buffer = noiseBuffer(4);
      windSrc.loop = true;
      windFilter = ac.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.6;
      windGain = ac.createGain();
      windGain.gain.value = 0;
      windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
      try { windSrc.start(); } catch (_) {}
      windGain.gain.setTargetAtTime(0.06, ac.currentTime, 2.5);

      // a low pad, barely there
      padGain = ac.createGain();
      padGain.gain.value = 0;
      const padFilter = ac.createBiquadFilter();
      padFilter.type = "lowpass";
      padFilter.frequency.value = 620;
      padGain.connect(padFilter);
      padFilter.connect(master);
      padFilter.connect(verb);
      for (const [f, amp, det] of [[73.4, 0.5, 0], [110, 0.34, 5], [146.8, 0.22, -6], [220, 0.12, 3]]) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        o.detune.value = det;
        const g = ac.createGain();
        g.gain.value = amp;
        o.connect(g); g.connect(padGain);
        try { o.start(); } catch (_) {}
      }
      padGain.gain.setTargetAtTime(0.075, ac.currentTime, 3);

      scheduleDistantBell();
    }

    function resumeAudio() {
      if (!ac) { startAudio(); return; }
      if (ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
    }

    const BELL = [[1, 1, 5.2], [2.02, 0.46, 3.4], [2.68, 0.36, 2.4], [3.4, 0.24, 1.7], [4.3, 0.15, 1.1]];
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
        o.frequency.value = freq * mult * (1 + rnd(-0.003, 0.003));
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + life * (spread || 1));
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + life * (spread || 1) + 0.1);
      }
    }

    // A soft struck chime — this is what a thread sounds like.
    function chime(semi, gain) {
      if (!ac || muted) return;
      const f = 261.63 * Math.pow(2, semi / 12);
      const t = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      g.connect(bus); g.connect(verb);
      for (const [mult, amp] of [[1, 1], [2, 0.32], [3.01, 0.14], [4.7, 0.07]]) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = f * mult;
        const og = ac.createGain();
        og.gain.value = amp;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + 2);
      }
    }

    function shimmer(count, gain) {
      if (!ac || muted) return;
      const t0 = ac.currentTime;
      for (let i = 0; i < count; i++) {
        const t = t0 + rnd(0, 0.3);
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = rnd(1500, 3800);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain * rnd(0.4, 1), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + rnd(0.15, 0.4));
        o.connect(g); g.connect(bus); g.connect(verb);
        o.start(t); o.stop(t + 0.5);
      }
    }

    // A temple somewhere over the fields, ringing on its own time.
    function scheduleDistantBell() {
      ctx.timeout(() => {
        if (ac && !muted && ac.state === "running") bell(196 * (Math.random() < 0.4 ? 1.5 : 1), 0.035, 1.5);
        scheduleDistantBell();
      }, rnd(14000, 30000));
    }

    let windAt = 0, windFreqSm = 480;
    function setWind(level) {
      if (!ac || muted || !windGain) return;
      const t = ac.currentTime;
      windFreqSm += (380 + level * 900 - windFreqSm) * 0.15;
      // per-frame automation stacks events on the param; a dozen a second is plenty
      if (t - windAt < 0.09) return;
      windAt = t;
      windGain.gain.setTargetAtTime(0.045 + level * 0.05, t, 0.4);
      windFilter.frequency.value = windFreqSm;
    }

    function sting(name) {
      if (ac || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    ctx.onDestroy(() => {
      try { if (windSrc) windSrc.stop(); } catch (_) {}
      try { if (ac) ac.close(); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 400 }); } catch (_) {}
    });

    // ===================================================================== //
    // 4. Three, dusk, and a tree grown from a fixed seed                    //
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
        '<div style="font-size:19px;font-weight:700;margin-bottom:10px;">Bandhan Tree</div>' +
        '<div style="font-size:13.5px;line-height:1.6;opacity:0.85;">This bit needs 3D, and it could not ' +
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
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 220);
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (_) {} });

    // ---- textures -----------------------------------------------------------
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
          const i = (y * size + x) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
          d[i + 3] = Math.round(Math.pow(Math.max(0, 1 - rad), hardness) * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    // A clump of leaves rather than one leaf: cheaper by two orders of
    // magnitude, and at dusk it is the silhouette that reads anyway.
    function bakeLeafClump(size) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const r2 = mulberry(9137);
      const leaves = [];
      for (let i = 0; i < 26; i++) {
        leaves.push({
          x: 0.5 + (r2() - 0.5) * 0.86, y: 0.5 + (r2() - 0.5) * 0.86,
          a: r2() * Math.PI, w: 0.055 + r2() * 0.05, l: 0.11 + r2() * 0.09,
          sh: 0.55 + r2() * 0.45
        });
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const px = x / (size - 1), py = y / (size - 1);
          let alpha = 0, shade = 0;
          for (const lf of leaves) {
            const dx = px - lf.x, dy = py - lf.y;
            const ca = Math.cos(lf.a), sa = Math.sin(lf.a);
            const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
            const ny = clamp((v / lf.l) * 0.5 + 0.5, 0, 1);
            const w = Math.sin(Math.pow(ny, 0.7) * Math.PI) * lf.w;
            if (w > 0.002 && Math.abs(u) < w) {
              const e = Math.min(1, (w - Math.abs(u)) / (w * 0.55));
              if (e > alpha) { alpha = e; shade = lf.sh; }
            }
          }
          const i = (y * size + x) * 4;
          d[i] = Math.round(64 * shade + 18);
          d[i + 1] = Math.round(96 * shade + 26);
          d[i + 2] = Math.round(52 * shade + 20);
          d[i + 3] = Math.round(alpha * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    function bakeBark(size) {
      const cv = surface(size, size);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const img = g2.createImageData(size, size);
      const d = img.data;
      const hf = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = Math.sin(x * 0.6 + Math.sin(y * 0.09) * 5) * 0.5 +
                    Math.sin(x * 1.7 + Math.sin(y * 0.21) * 3) * 0.25 +
                    Math.sin(y * 0.5) * 0.08;
          hf[y * size + x] = v;
        }
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const l = hf[y * size + ((x - 1 + size) % size)];
          const r = hf[y * size + ((x + 1) % size)];
          const u = hf[((y - 1 + size) % size) * size + x];
          const dn = hf[((y + 1) % size) * size + x];
          let nx = (l - r) * 1.6, ny = (u - dn) * 1.6, nz = 1;
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

    // Dusk: indigo overhead, a warm band where the sun went, a few early stars.
    function bakeSky() {
      const w = 512, h = 256;
      const cv = surface(w, h);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const grad = g2.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#0a0f24");
      grad.addColorStop(0.34, "#1b1c3e");
      grad.addColorStop(0.55, "#4b2f4a");
      grad.addColorStop(0.7, "#8a4436");
      grad.addColorStop(0.8, "#c9713a");
      grad.addColorStop(0.88, "#5d3524");
      grad.addColorStop(1, "#140c0a");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, w, h);
      // the glow where the sun set
      for (const ox of [-w, 0, w]) {
        const rg = g2.createRadialGradient(w * 0.32 + ox, h * 0.78, 2, w * 0.32 + ox, h * 0.78, w * 0.3);
        rg.addColorStop(0, "rgba(255,196,120,0.85)");
        rg.addColorStop(0.4, "rgba(206,116,60,0.4)");
        rg.addColorStop(1, "rgba(0,0,0,0)");
        g2.fillStyle = rg;
        g2.fillRect(0, 0, w, h);
      }
      const sr = mulberry(4242);
      for (let i = 0; i < 90; i++) {
        const x = sr() * w, y = sr() * h * 0.42;
        const a = 0.25 + sr() * 0.6;
        g2.fillStyle = "rgba(255,248,230," + a.toFixed(2) + ")";
        g2.fillRect(x, y, 1, 1);
      }
      const t = new THREE.CanvasTexture(cv);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }

    const texGlow = bakeGlow(64, 2.4, 255, 214, 150);
    const texSpark = bakeGlow(32, 1.8, 255, 236, 180);
    const texLeaf = bakeLeafClump(128);
    const texBark = bakeBark(128);
    const skyTex = bakeSky();

    if (skyTex) {
      scene.background = skyTex;
      scene.backgroundIntensity = 1;
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        scene.environment = pmrem.fromEquirectangular(skyTex).texture;
        scene.environmentIntensity = 0.9;
        pmrem.dispose();
      } catch (_) {
        scene.environment = skyTex;
      }
    } else {
      scene.background = new THREE.Color(0x1b1c3e);
    }
    scene.fog = new THREE.FogExp2(0x33253a, 0.026);

    scene.add(new THREE.AmbientLight(0x5a5a8c, 1.15));
    const sun = new THREE.DirectionalLight(0xffb066, 1.15);
    sun.position.set(-6, 2.2, -4);
    scene.add(sun);
    const skyFill = new THREE.DirectionalLight(0x6f86d8, 0.85);
    skyFill.position.set(4, 6, 3);
    scene.add(skyFill);

    // ---- the tree ------------------------------------------------------------
    const treeRng = mulberry(20260828);
    const segs = [];
    const tips = [];
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    function grow(pos, dir, len, rad, depth) {
      const end = pos.clone().addScaledVector(dir, len);
      segs.push({ a: pos.clone(), b: end, r0: rad, r1: rad * 0.7, depth: depth, dir: dir.clone() });
      if (depth >= 5 || len < 0.2) { tips.push({ p: end, d: dir.clone(), depth: depth }); return; }
      const n = depth === 0 ? 3 : (treeRng() < 0.32 ? 3 : 2);
      const perpA = Math.abs(dir.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(dir, perpA).normalize();
      for (let i = 0; i < n; i++) {
        const az = (i / n) * TAU + treeRng() * 1.1 + depth * 1.7;
        const axis = side.clone().applyAxisAngle(dir, az).normalize();
        const spread = 0.36 + treeRng() * 0.46;
        const nd = dir.clone().applyAxisAngle(axis, spread);
        nd.y += 0.12 - depth * 0.012;
        nd.normalize();
        grow(end, nd, len * (0.66 + treeRng() * 0.14), rad * 0.66, depth + 1);
      }
    }
    grow(V(0, -2.35, 0), V(0, 1, 0), 1.95, 0.33, 0);

    // Build one merged geometry for every branch: tapered tubes, six sides.
    const BRAD = 6;
    {
      const vcount = segs.length * (BRAD + 1) * 2;
      const pos = new Float32Array(vcount * 3);
      const nor = new Float32Array(vcount * 3);
      const uv = new Float32Array(vcount * 2);
      const idx = new Uint16Array(segs.length * BRAD * 6);
      let vi = 0, ii = 0;
      const ax = new THREE.Vector3(), sd = new THREE.Vector3(), up = new THREE.Vector3(), tmp = new THREE.Vector3();
      for (const s of segs) {
        ax.copy(s.b).sub(s.a).normalize();
        tmp.set(Math.abs(ax.y) > 0.9 ? 1 : 0, Math.abs(ax.y) > 0.9 ? 0 : 1, 0);
        sd.crossVectors(ax, tmp).normalize();
        up.crossVectors(sd, ax).normalize();
        const base = vi;
        for (let e = 0; e < 2; e++) {
          const c = e === 0 ? s.a : s.b;
          const r = e === 0 ? s.r0 : s.r1;
          for (let j = 0; j <= BRAD; j++) {
            const a = (j / BRAD) * TAU;
            const ca = Math.cos(a), sa = Math.sin(a);
            const nx = sd.x * ca + up.x * sa, ny = sd.y * ca + up.y * sa, nz = sd.z * ca + up.z * sa;
            const o = vi * 3;
            pos[o] = c.x + nx * r; pos[o + 1] = c.y + ny * r; pos[o + 2] = c.z + nz * r;
            nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
            uv[vi * 2] = (j / BRAD) * 2;
            uv[vi * 2 + 1] = e * s.a.distanceTo(s.b) * 1.6;
            vi++;
          }
        }
        for (let j = 0; j < BRAD; j++) {
          const a = base + j, b = base + j + 1;
          const c = base + (BRAD + 1) + j + 1, d = base + (BRAD + 1) + j;
          idx[ii++] = a; idx[ii++] = b; idx[ii++] = c;
          idx[ii++] = a; idx[ii++] = c; idx[ii++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3a2c24, roughness: 0.95, metalness: 0,
        normalMap: texBark || null, envMapIntensity: 0.6,
        normalScale: texBark ? new THREE.Vector2(0.45, 0.45) : undefined
      });
      if (texBark) texBark.repeat.set(2, 2);
      scene.add(new THREE.Mesh(geo, mat));
    }

    // ---- leaves --------------------------------------------------------------
    const leafRng = mulberry(77321);
    let leaves = null;
    const leafState = [];
    if (texLeaf) {
      const cand = tips.filter((t) => t.depth >= 3);
      const count = Math.min(230, cand.length);
      leaves = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: texLeaf, transparent: true, side: THREE.DoubleSide,
          depthWrite: true, alphaTest: 0.42, color: 0xffffff
        }),
        count
      );
      leaves.frustumCulled = false;
      scene.add(leaves);
      const lc = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const t = cand[(i * 7 + 3) % cand.length];
        leafState.push({
          x: t.p.x + (leafRng() - 0.5) * 0.5,
          y: t.p.y + (leafRng() - 0.5) * 0.4,
          z: t.p.z + (leafRng() - 0.5) * 0.5,
          s: 0.42 + leafRng() * 0.5,
          ph: leafRng() * TAU,
          tilt: (leafRng() - 0.5) * 0.9
        });
        lc.setHSL(0.24 + leafRng() * 0.07, 0.3 + leafRng() * 0.22, 0.16 + leafRng() * 0.2);
        leaves.setColorAt(i, lc);
      }
      if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    }

    // ---- ground, fireflies, lanterns ----------------------------------------
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(34, 40),
      new THREE.MeshStandardMaterial({ color: 0x241d22, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.42;
    scene.add(ground);

    if (texGlow) {
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 14),
        new THREE.MeshBasicMaterial({
          map: texGlow, color: 0x8a5a30, transparent: true, opacity: 0.3,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = -2.4;
      scene.add(pool);
    }

    const FIRE = 80;
    const fireGeo = new THREE.BufferGeometry();
    const firePos = new Float32Array(FIRE * 3);
    const fireCol = new Float32Array(FIRE * 3);
    const fireSeed = [];
    {
      const fr = mulberry(551);
      for (let i = 0; i < FIRE; i++) {
        const a = fr() * TAU, rad = 2.2 + fr() * 5.4;
        const hx = Math.cos(a) * rad, hy = -2.1 + fr() * 5.6, hz = Math.sin(a) * rad;
        firePos[i * 3] = hx; firePos[i * 3 + 1] = hy; firePos[i * 3 + 2] = hz;
        fireSeed.push({ hx: hx, hy: hy, hz: hz, ph: fr() * TAU, sp: 0.2 + fr() * 0.5, r: 0.25 + fr() * 0.7 });
      }
      fireGeo.setAttribute("position", new THREE.BufferAttribute(firePos, 3));
      fireGeo.setAttribute("color", new THREE.BufferAttribute(fireCol, 3));
    }
    const fireflies = new THREE.Points(fireGeo, new THREE.PointsMaterial({
      size: 0.1, map: texSpark, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    fireflies.frustumCulled = false;
    scene.add(fireflies);

    const lanterns = [];
    const lampLight = new THREE.PointLight(0xffa348, 2.6, 7, 2);
    lampLight.position.set(0, -0.4, 0);
    scene.add(lampLight);

    if (texGlow) {
      const lr = mulberry(8181);
      const lm = new THREE.MeshBasicMaterial({
        map: texGlow, color: 0xffb15a, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      for (let i = 0; i < 7; i++) {
        const t = tips[Math.floor(lr() * tips.length)];
        const q = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), lm);
        q.position.set(t.p.x, t.p.y - 0.3, t.p.z);
        q.userData.billboard = true;
        scene.add(q);
        lanterns.push(q);
      }
    }

    // ---- the slots a thread can be tied to -----------------------------------
    // Derived from the same deterministic tree, so slot 137 is the same twig on
    // every device. That is what lets a thread be three small numbers.
    const slotRng = mulberry(31337);
    const slots = [];
    {
      const cand = segs.filter((s) => s.depth >= 4);
      for (let i = 0; i < SLOTS; i++) {
        const s = cand[Math.floor(slotRng() * cand.length)];
        const t = 0.25 + slotRng() * 0.7;
        const p = s.a.clone().lerp(s.b, t);
        const drift = new THREE.Vector3(
          (slotRng() - 0.5) * 0.42, 0, (slotRng() - 0.5) * 0.42
        );
        slots.push({
          p: p, drift: drift, phase: slotRng() * TAU,
          len: 0.55 + slotRng() * 0.4, taken: false
        });
      }
    }

    // ---- every thread in one ribbon buffer ------------------------------------
    // Three vertices across rather than two: the middle one is lit and the
    // edges are not, which is enough to make a flat strip read as a round cord.
    const SEGN = 9;
    const VW = 3;
    const threads = [];
    const threadGeo = new THREE.BufferGeometry();
    const tPos = new Float32Array(MAX_DRAWN * SEGN * VW * 3);
    const tCol = new Float32Array(MAX_DRAWN * SEGN * VW * 3);
    {
      const idx = new Uint16Array(MAX_DRAWN * (SEGN - 1) * 12);
      let k = 0;
      for (let m = 0; m < MAX_DRAWN; m++) {
        const base = m * SEGN * VW;
        for (let i = 0; i < SEGN - 1; i++) {
          const r0 = base + i * VW, r1 = base + (i + 1) * VW;
          for (let j = 0; j < VW - 1; j++) {
            idx[k++] = r0 + j; idx[k++] = r0 + j + 1; idx[k++] = r1 + j + 1;
            idx[k++] = r0 + j; idx[k++] = r1 + j + 1; idx[k++] = r1 + j;
          }
        }
      }
      threadGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3));
      threadGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
      threadGeo.setIndex(new THREE.BufferAttribute(idx, 1));
      threadGeo.setDrawRange(0, 0);
      threadGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 9);
    }
    const threadMesh = new THREE.Mesh(threadGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide
    }));
    threadMesh.frustumCulled = false;
    scene.add(threadMesh);

    // knots, one instanced bead each
    const knots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.042, 8, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0 }),
      MAX_DRAWN
    );
    knots.frustumCulled = false;
    knots.count = 0;
    scene.add(knots);

    // a light on the one you tied, and one on the one you are reading
    let mineGlow = null, pickGlow = null;
    if (texGlow) {
      mineGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({
        map: texGlow, color: 0xfff0c0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      scene.add(mineGlow);
      pickGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({
        map: texGlow, color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      scene.add(pickGlow);
    }

    const tmpC = new THREE.Color();
    const km = new THREE.Matrix4();
    const kv = new THREE.Vector3();
    const kq = new THREE.Quaternion();
    const ks = new THREE.Vector3(1, 1, 1);

    function writeThreads(t, camPos) {
      const n = Math.min(threads.length, MAX_DRAWN);
      let written = 0;
      for (let m = 0; m < n; m++) {
        const th = threads[m];
        const sl = slots[th.slot % SLOTS];
        const grown = th.grow;
        if (grown <= 0.001) continue;
        const len = sl.len * grown;
        const base = written * SEGN * VW;
        tmpC.setHex(SILKS[th.silk % SILKS.length].hex);
        const bright = th.mine ? 1.3 : 0.86;
        for (let i = 0; i < SEGN; i++) {
          const f = i / (SEGN - 1);
          const sway = Math.sin(t * 1.35 + sl.phase + f * 2.6) * 0.055 * f * f +
                       Math.sin(t * 0.51 + sl.phase * 1.7) * 0.03 * f;
          const x = sl.p.x + sl.drift.x * f * f + sway;
          const y = sl.p.y - len * f - 0.03;
          const z = sl.p.z + sl.drift.z * f * f + sway * 0.6;
          // the ribbon lies across both the hang direction and the view:
          // cross((0,-1,0), view) = (-vz, 0, vx)
          let vx = x - camPos.x, vz = z - camPos.z;
          const vl = Math.sqrt(vx * vx + vz * vz) || 1;
          vx /= vl; vz /= vl;
          const sx = -vz, sz = vx;
          const w = 0.017 * (1 - 0.3 * f) + (i === 0 ? 0.004 : 0);
          const o = (base + i * VW) * 3;
          tPos[o] = x + sx * w; tPos[o + 1] = y; tPos[o + 2] = z + sz * w;
          tPos[o + 3] = x;      tPos[o + 4] = y; tPos[o + 5] = z;
          tPos[o + 6] = x - sx * w; tPos[o + 7] = y; tPos[o + 8] = z - sz * w;
          const along = 0.62 + 0.38 * (1 - f * 0.6);
          const edge = along * 0.42 * bright, mid = along * bright;
          tCol[o] = tmpC.r * edge; tCol[o + 1] = tmpC.g * edge; tCol[o + 2] = tmpC.b * edge;
          tCol[o + 3] = tmpC.r * mid; tCol[o + 4] = tmpC.g * mid; tCol[o + 5] = tmpC.b * mid;
          tCol[o + 6] = tmpC.r * edge; tCol[o + 7] = tmpC.g * edge; tCol[o + 8] = tmpC.b * edge;
        }
        kv.set(sl.p.x, sl.p.y, sl.p.z);
        ks.setScalar(grown);
        km.compose(kv, kq, ks);
        knots.setMatrixAt(written, km);
        knots.setColorAt(written, tmpC);
        written++;
      }
      threadGeo.setDrawRange(0, written * (SEGN - 1) * 12);
      threadGeo.attributes.position.needsUpdate = true;
      threadGeo.attributes.color.needsUpdate = true;
      knots.count = written;
      knots.instanceMatrix.needsUpdate = true;
      if (knots.instanceColor) knots.instanceColor.needsUpdate = true;
    }

    // ===================================================================== //
    // 5. The shared world                                                   //
    // ===================================================================== //
    const CH = "threads";
    let worldOnline = true;
    let totalKnown = 0;
    let mine = null;               // { id, slot, silk, say }
    let myId = null;

    function newId() {
      return "t" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    }

    function encode(t) { return { s: t.slot | 0, c: t.silk | 0, w: t.say | 0 }; }

    function decode(o) {
      if (!o || typeof o !== "object") return null;
      const s = Number(o.s), c = Number(o.c), w = Number(o.w);
      if (!isFinite(s) || s < 0 || s >= SLOTS) return null;
      return {
        slot: s | 0,
        silk: isFinite(c) ? clamp(c | 0, 0, SILKS.length - 1) : 0,
        say: isFinite(w) ? clamp(w | 0, 0, BLESSINGS.length - 1) : 0
      };
    }

    // The snapshot shape is not pinned by the contract, so read it defensively.
    function readSnapshot(snap) {
      if (!snap) return [];
      let raw = Array.isArray(snap) ? snap
        : snap.objects || snap.items || snap.entries || snap.records ||
          (snap.state && (snap.state.objects || snap.state.items)) ||
          (snap.data && (snap.data.objects || snap.data.items || snap.data.entries)) || [];
      if (!Array.isArray(raw) && raw && typeof raw === "object") {
        raw = Object.keys(raw).map((k) => ({ id: k, object: raw[k] }));
      }
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (const e of raw) {
        if (!e || typeof e !== "object") continue;
        const payload = e.object || e.data || e.value || e.state || e.payload || e;
        const t = decode(payload);
        if (!t) continue;
        const id = String(e.id || e.objectId || e.key || payload.id || "");
        if (!id) continue;
        const user = e.user || e.author || e.by || e.creator || null;
        let by = typeof user === "string" ? user
          : (user && (user.handle || user.username || user.displayName || user.name)) || null;
        by = by ? String(by).slice(0, 18) : null;
        const isMine = !!(e.self || e.mine || e.isSelf || e.isViewer || e.you ||
          (user && typeof user === "object" && (user.self || user.isViewer)) ||
          (myId && id === myId));
        out.push({ id: id, slot: t.slot, silk: t.silk, say: t.say, by: by, mine: isMine });
        if (out.length >= 900) break;
      }
      return out;
    }

    function paintCount() {
      const n = Math.max(totalKnown, threads.length);
      nodes.count.textContent = worldOnline
        ? (n === 1 ? "1 thread tied" : n + " threads tied")
        : "बंधन · offline";
    }

    // Keep this viewer's own thread, then a stable window of everyone else's,
    // so a big tree still runs on a phone.
    const windowOffset = Math.random();
    function pickVisible(list) {
      if (list.length <= MAX_DRAWN) return list.slice(0);
      const own = list.filter((t) => t.mine);
      const rest = list.filter((t) => !t.mine);
      const start = Math.floor(windowOffset * rest.length);
      const out = own.slice(0, MAX_DRAWN);
      for (let i = 0; out.length < MAX_DRAWN && i < rest.length; i++) {
        out.push(rest[(start + i) % rest.length]);
      }
      return out;
    }

    function adopt(list) {
      for (const s of slots) s.taken = false;
      threads.length = 0;
      for (const t of list) {
        const prev = threads.find((x) => x.slot === t.slot);
        if (prev) continue;                       // one thread to a twig
        slots[t.slot].taken = true;
        threads.push({
          id: t.id, slot: t.slot, silk: t.silk, say: t.say,
          by: t.by, mine: t.mine, grow: 1
        });
      }
      if (mine && !threads.some((t) => t.mine)) {
        // the world has not caught up with us yet; keep ours on the tree
        if (!slots[mine.slot].taken) {
          slots[mine.slot].taken = true;
          threads.push({ id: mine.id, slot: mine.slot, silk: mine.silk, say: mine.say,
            by: null, mine: true, grow: 1 });
        }
      }
      paintCount();
    }

    async function sync() {
      try {
        const snap = await ctx.memory.world(CH).get();
        const list = readSnapshot(snap);
        totalKnown = list.length;
        worldOnline = true;
        adopt(pickVisible(list));
      } catch (err) {
        worldOnline = false;
        ctx.platform.error({ where: "world_get", message: String(err) });
        adopt([]);
      }
    }

    // A write can be refused for rate limits or moderation; assume it landed
    // only when nothing in the reply says otherwise.
    function accepted(res) {
      if (!res) return true;
      if (res.ok === false || res.accepted === false || res.rejected === true) return false;
      const status = res.status || res.state || (res.data && res.data.status);
      if (typeof status === "string" && /reject|denied|limit|refus|fail|error/i.test(status)) return false;
      return true;
    }

    // ===================================================================== //
    // 6. Composing and tying                                                //
    // ===================================================================== //
    let silkPick = Math.floor(Math.random() * SILKS.length);
    let sayPick = Math.floor(Math.random() * BLESSINGS.length);
    let composing = false;
    let started = false;

    const silkEls = [];
    SILKS.forEach((s, i) => {
      const b = document.createElement("button");
      b.style.cssText =
        "pointer-events:auto;width:36px;height:36px;border-radius:18px;padding:0;border:2px solid transparent;" +
        "transition:transform 140ms ease,border-color 140ms ease;font-family:inherit;";
      b.style.backgroundColor = "#" + ("000000" + s.hex.toString(16)).slice(-6);
      silkEls.push(b);
      nodes.silks.appendChild(b);
      ctx.listen(b, "click", () => {
        silkPick = i;
        paintCompose();
        chime(SILKS[i].note + 12, 0.07);
        ctx.platform.haptic("light");
      });
    });

    function paintCompose() {
      silkEls.forEach((b, i) => {
        const on = i === silkPick;
        b.style.borderColor = on ? GOLD : "transparent";
        b.style.transform = on ? "scale(1.18)" : "scale(1)";
      });
      nodes.say.textContent = "“" + BLESSINGS[sayPick] + "”";
    }

    ctx.listen(nodes.say, "click", () => {
      sayPick = (sayPick + 1) % BLESSINGS.length;
      paintCompose();
      ctx.platform.haptic("light");
    });

    function firstGesture() {
      if (started) return;
      started = true;
      resumeAudio();
      ctx.platform.start();
      if (canMusic && ctx.music && ctx.music.unlock) { try { ctx.music.unlock(); } catch (_) {} }
    }

    function openCompose() {
      firstGesture();
      composing = true;
      paintCompose();
      nodes.compose.style.display = "block";
      nodes.tie.style.display = "none";
      nodes.hint.style.opacity = "0";
      hideRead();
      ctx.platform.interact({ type: "compose_open" });
    }

    function closeCompose() {
      composing = false;
      nodes.compose.style.display = "none";
      nodes.tie.style.display = "block";
      nodes.hint.style.opacity = "1";
    }

    // Pick a free twig, preferring one on the side you are looking at.
    function freeSlot() {
      const camA = Math.atan2(camera.position.z, camera.position.x);
      let bestI = -1, bestScore = 1e9;
      for (let i = 0; i < SLOTS; i++) {
        if (slots[i].taken) continue;
        const a = Math.atan2(slots[i].p.z, slots[i].p.x);
        let d = Math.abs(a - camA);
        while (d > Math.PI) d = Math.abs(d - TAU);
        const score = d + Math.abs(slots[i].p.y - 0.8) * 0.35 + Math.random() * 0.25;
        if (score < bestScore) { bestScore = score; bestI = i; }
      }
      if (bestI < 0) bestI = Math.floor(Math.random() * SLOTS);
      return bestI;
    }

    async function tieIt() {
      // Everyone gets one thread. Tying again writes under the same id, so it
      // moves rather than multiplying.
      const moving = !!mine;
      if (mine) {
        slots[mine.slot].taken = false;
        const old = threads.findIndex((x) => x.mine);
        if (old >= 0) threads.splice(old, 1);
      }
      const slot = freeSlot();
      const id = myId || newId();
      const t = { id: id, slot: slot, silk: silkPick, say: sayPick, by: null, mine: true, grow: 0 };
      slots[slot].taken = true;
      // drop the oldest borrowed thread if we are at the cap
      if (threads.length >= MAX_DRAWN) {
        const i = threads.findIndex((x) => !x.mine);
        if (i >= 0) { slots[threads[i].slot].taken = false; threads.splice(i, 1); }
      }
      threads.push(t);
      closeCompose();

      bell(392, 0.15, 1.1);
      shimmer(9, 0.035);
      ctx.platform.haptic("success");
      focusOn(slot);
      showRead(BLESSINGS[sayPick], "your thread");

      let res = null, threw = false;
      try {
        res = await ctx.memory.world(CH).mutate({ id: id, object: encode(t) });
      } catch (err) {
        threw = true;
        ctx.platform.error({ where: "world_mutate", message: String(err) });
      }
      if (threw || !accepted(res)) {
        worldOnline = !threw;
        nodes.hint.textContent = threw
          ? "the tree is out of reach — yours is here for now"
          : "the tree would not take another one today";
        nodes.hint.style.opacity = "1";
      } else {
        myId = id;
        mine = { id: id, slot: slot, silk: silkPick, say: sayPick };
        worldOnline = true;
        totalKnown = Math.max(moving ? totalKnown : totalKnown + 1, threads.length);
        nodes.hint.textContent = "your thread is on the tree";
        nodes.hint.style.opacity = "1";
        nodes.tie.textContent = "Move your thread";
        if (ctx.capabilities.storage !== false) {
          try { await ctx.storage.set("mine", mine); } catch (_) {}
        }
        ctx.platform.milestone("thread_tied");
        ctx.platform.interact({ type: "world_mutation" });
        ctx.platform.complete({ slot: slot, silk: SILKS[silkPick].name });
      }
      paintCount();
    }

    ctx.listen(nodes.tie, "click", openCompose);
    ctx.listen(nodes.cancel, "click", () => { closeCompose(); });
    ctx.listen(nodes.confirm, "click", () => { firstGesture(); tieIt(); });
    ctx.listen(nodes.help, "click", () => { nodes.sheet.style.display = "flex"; });
    ctx.listen(nodes.close, "click", () => { nodes.sheet.style.display = "none"; firstGesture(); });

    // ---- reading a thread ----------------------------------------------------
    let readingSlot = -1;
    function showRead(say, by) {
      nodes.readsay.textContent = "“" + say + "”";
      nodes.readby.textContent = by || "tied by someone";
      nodes.read.style.opacity = "1";
      nodes.read.style.transform = "translateY(0)";
    }
    function hideRead() {
      nodes.read.style.opacity = "0";
      nodes.read.style.transform = "translateY(10px)";
      readingSlot = -1;
      if (pickGlow) pickGlow.material.opacity = 0;
    }

    // ===================================================================== //
    // 7. Walking around the tree                                            //
    // ===================================================================== //
    let orbitA = 0.7, orbitAV = 0, orbitH = 1.5, orbitHT = 1.5, orbitR = 11;
    let dragging = false, downX = 0, downY = 0, moved = 0, lastDX = 0;
    let focusA = null, focusMix = 0;
    let time = 0;
    let windLevel = 0.3;

    const camAim = new THREE.Vector3(0, 1.05, 0);
    const proj = new THREE.Vector3();

    function focusOn(slot) {
      const sl = slots[slot];
      focusA = Math.atan2(sl.p.x, sl.p.z);
      focusMix = 1;
      orbitHT = clamp(sl.p.y - 0.2, 0.2, 4.4);
    }

    function pickAt(x, y) {
      let best = null, bestD = 64 * 64;
      for (const th of threads) {
        if (th.grow < 0.4) continue;
        const sl = slots[th.slot];
        proj.set(sl.p.x, sl.p.y - sl.len * 0.55, sl.p.z).project(camera);
        if (proj.z > 1) continue;
        const sx = (proj.x * 0.5 + 0.5) * W, sy = (-proj.y * 0.5 + 0.5) * H;
        const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
        if (d < bestD) { bestD = d; best = th; }
      }
      return best;
    }

    ctx.listen(view, "pointerdown", (e) => {
      firstGesture();
      dragging = true;
      moved = 0;
      downX = e.offsetX; downY = e.offsetY;
      lastDX = 0;
      orbitAV = 0;
      focusA = null;
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!dragging) return;
      const dx = e.offsetX - downX, dy = e.offsetY - downY;
      moved += Math.abs(dx) + Math.abs(dy);
      orbitA -= dx * 0.0072;
      orbitHT = clamp(orbitHT + dy * 0.0125, 0.15, 4.6);
      lastDX = dx;
      downX = e.offsetX; downY = e.offsetY;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      orbitAV = -lastDX * 0.05;
      if (moved < 10 && !composing) {
        const hit = pickAt(e && e.offsetX != null ? e.offsetX : downX,
                           e && e.offsetY != null ? e.offsetY : downY);
        if (hit) {
          readingSlot = hit.slot;
          showRead(BLESSINGS[hit.say % BLESSINGS.length],
            hit.mine ? "your thread" : (hit.by ? "tied by " + hit.by : "tied by someone"));
          chime(SILKS[hit.silk % SILKS.length].note, 0.1);
          ctx.platform.haptic("light");
          ctx.platform.interact({ type: "read_thread" });
        } else {
          hideRead();
        }
      }
    };
    ctx.listen(view, "pointerup", endDrag);
    ctx.listen(view, "pointercancel", endDrag);

    // ===================================================================== //
    // 8. Layout, first sync, frame loop                                     //
    // ===================================================================== //
    const TOP_RESERVE = SAFE_T + 74;
    const BOT_RESERVE = SAFE_B + 112;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      const half = Math.tan((camera.fov * Math.PI) / 360);
      const band = Math.max(160, H - TOP_RESERVE - BOT_RESERVE);
      orbitR = clamp((4.35 * H) / (half * band), 8.5, 17);
      camera.updateProjectionMatrix();
    }
    layout();
    ctx.listen(window, "resize", () => ctx.timeout(layout, 60));
    if (window.visualViewport) ctx.listen(window.visualViewport, "resize", () => ctx.timeout(layout, 60));

    if (ctx.capabilities.storage !== false) {
      try {
        const saved = await ctx.storage.get("mine");
        if (saved && typeof saved === "object" && typeof saved.slot === "number") {
          mine = {
            id: String(saved.id || newId()),
            slot: clamp(saved.slot | 0, 0, SLOTS - 1),
            silk: clamp((saved.silk | 0), 0, SILKS.length - 1),
            say: clamp((saved.say | 0), 0, BLESSINGS.length - 1)
          };
          myId = mine.id;
          silkPick = mine.silk;
          sayPick = mine.say;
        }
      } catch (_) { /* storage is a nicety */ }
    }

    // Paint one frame before the curtain lifts.
    camera.position.set(Math.sin(orbitA) * orbitR, orbitH, Math.cos(orbitA) * orbitR);
    camera.lookAt(camAim);
    renderer.render(scene, camera);
    nodes.curtain.style.transition = "opacity 600ms ease";
    nodes.curtain.style.opacity = "0";
    ctx.timeout(() => { nodes.curtain.style.display = "none"; }, 640);

    paintCount();
    await sync();
    // Threads already on the tree are there; ours, if we have one, gets its light.
    for (const t of threads) t.grow = 1;
    if (mine) {
      nodes.tie.textContent = "Move your thread";
      nodes.hint.textContent = "your thread is on the tree — tap any thread to read it";
      focusOn(mine.slot);
    } else if (!threads.length) {
      nodes.hint.textContent = worldOnline
        ? "nothing on it yet — tie the first thread"
        : "the tree is out of reach, but you can still tie one";
    }
    // The world does not push, so look again now and then for other people's.
    ctx.interval(() => { if (!composing) sync(); }, 45000);

    const lm4 = new THREE.Matrix4();
    const lq = new THREE.Quaternion();
    const lv = new THREE.Vector3();
    const ls = new THREE.Vector3(1, 1, 1);
    const le = new THREE.Euler();

    ctx.onFrame((dtMs) => {
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      time += dt;

      // ---- camera --------------------------------------------------------
      if (!dragging) {
        orbitA += orbitAV * dt;
        orbitAV *= Math.pow(0.12, dt);
        if (Math.abs(orbitAV) < 0.02) orbitA += 0.035 * dt;      // the tree turns slowly on its own
      }
      if (focusA !== null && focusMix > 0) {
        let d = focusA - orbitA;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        orbitA += d * Math.min(1, dt * 2.2);
        focusMix -= dt * 0.4;
        if (Math.abs(d) < 0.02) { focusA = null; }
      }
      orbitH += (orbitHT - orbitH) * Math.min(1, dt * 4);
      camera.position.set(Math.sin(orbitA) * orbitR, orbitH, Math.cos(orbitA) * orbitR);
      camAim.set(0, 1.05 + orbitH * 0.12, 0);
      camera.lookAt(camAim);

      // ---- wind ------------------------------------------------------------
      windLevel = 0.34 + Math.sin(time * 0.21) * 0.24 + Math.sin(time * 0.07 + 1.3) * 0.2;
      windLevel = clamp(windLevel, 0.06, 1);
      setWind(windLevel);

      // ---- threads ---------------------------------------------------------
      for (const th of threads) if (th.grow < 1) th.grow = Math.min(1, th.grow + dt * 1.6);
      writeThreads(time * (0.6 + windLevel), camera.position);

      // ---- leaves ----------------------------------------------------------
      if (leaves) {
        for (let i = 0; i < leafState.length; i++) {
          const l = leafState[i];
          const sway = Math.sin(time * 1.1 + l.ph) * 0.09 * windLevel;
          lv.set(l.x + sway, l.y + Math.sin(time * 0.9 + l.ph * 1.7) * 0.03, l.z + sway * 0.6);
          le.set(0, Math.atan2(camera.position.x - l.x, camera.position.z - l.z), l.tilt + sway * 0.7);
          lq.setFromEuler(le);
          ls.setScalar(l.s);
          lm4.compose(lv, lq, ls);
          leaves.setMatrixAt(i, lm4);
        }
        leaves.instanceMatrix.needsUpdate = true;
      }

      // ---- fireflies --------------------------------------------------------
      for (let i = 0; i < FIRE; i++) {
        const f = fireSeed[i];
        firePos[i * 3] = f.hx + Math.sin(time * f.sp + f.ph) * f.r;
        firePos[i * 3 + 1] = f.hy + Math.sin(time * f.sp * 0.63 + f.ph * 1.7) * f.r * 0.5;
        firePos[i * 3 + 2] = f.hz + Math.cos(time * f.sp * 0.81 + f.ph * 1.3) * f.r;
        const blink = Math.max(0, Math.sin(time * (1.1 + f.sp) + f.ph * 3));
        fireCol[i * 3] = 1 * blink;
        fireCol[i * 3 + 1] = 0.82 * blink;
        fireCol[i * 3 + 2] = 0.36 * blink;
      }
      fireGeo.attributes.position.needsUpdate = true;
      fireGeo.attributes.color.needsUpdate = true;

      // ---- lanterns and glows ------------------------------------------------
      for (const q of lanterns) q.quaternion.copy(camera.quaternion);
      lampLight.intensity = 2.4 + Math.sin(time * 2.3) * 0.5;

      if (mineGlow) {
        mineGlow.visible = !!mine;
        if (mine) {
          const sl = slots[mine.slot];
          mineGlow.position.set(sl.p.x, sl.p.y - 0.06, sl.p.z);
          mineGlow.quaternion.copy(camera.quaternion);
          mineGlow.material.opacity = 0.32 + Math.sin(time * 1.7) * 0.12;
        } else {
          mineGlow.material.opacity = 0;
        }
      }
      if (pickGlow) {
        pickGlow.visible = readingSlot >= 0 || pickGlow.material.opacity > 0.001;
        if (readingSlot >= 0) {
          const sl = slots[readingSlot];
          pickGlow.position.set(sl.p.x, sl.p.y - sl.len * 0.4, sl.p.z);
          pickGlow.quaternion.copy(camera.quaternion);
          pickGlow.material.opacity = 0.3 + Math.sin(time * 5) * 0.1;
        } else if (pickGlow.material.opacity > 0) {
          pickGlow.material.opacity = Math.max(0, pickGlow.material.opacity - dt * 2);
        }
      }

      renderer.render(scene, camera);
    });
  }
};
