/**
 * Cat's Cradle — the string game that only works if there are two of you.
 *
 * One loop of string, four hands, and a sequence of figures that gets handed
 * back and forth: Opening A, Soldier's Bed, Candles, Manger, Diamonds, Cat's
 * Eye. You do not make a figure so much as take one — you pinch the right
 * strand with the right finger and lift it out of somebody else's hands, and if
 * you pinch the wrong one the whole thing falls apart in front of you. Which is
 * exactly what it does here.
 *
 * The string is one closed Verlet loop, pinned wherever it crosses a finger and
 * simulated everywhere else, so it goes taut when it is pulled, sags when it is
 * not, and swings when a hand moves. The six figures are the real sequence,
 * authored as paths through the finger pegs, and each transition names the real
 * move: which strand, which finger, over or under.
 *
 * The whole game is one object passed between two people, which is the same
 * thing Rakshabandhan is about, and it is the oldest game in the world that
 * needs a sibling.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule). Every texture and
 * every sound is generated in-file — packaged assets are disabled.
 */
window.plethoraBit = {
  meta: {
    title: "Cat's Cradle",
    runtime: "plethora-bit@2",
    tags: ["3d", "game", "physics", "skill", "art"],
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

    // ===================================================================== //
    // 1. First frame                                                        //
    // ===================================================================== //
    const view = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "4";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);

    const INK = "#eef2f7";
    const DIM = "rgba(238,242,247,0.56)";
    const GOLD = "#ffd479";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Devanagari',sans-serif";

    ui.innerHTML =
      '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:' + FONT + ';' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:' + INK + ';">' +

      '<div data-el="top" style="position:absolute;left:0;right:0;top:' + (SAFE_T + 6) + 'px;padding:0 18px;' +
      'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;transition:opacity 400ms ease;">' +
        '<div>' +
          '<div style="font-size:19px;font-weight:700;letter-spacing:0.3px;line-height:1.05;">Cat\'s Cradle</div>' +
          '<div data-el="sub" style="font-size:11px;letter-spacing:1.5px;color:' + DIM + ';margin-top:3px;">' +
          'one loop, two people</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:9px;">' +
          '<div data-el="best" style="font-size:11.5px;letter-spacing:1.1px;color:' + DIM + ';' +
          'padding:7px 10px;border-radius:13px;background:rgba(10,14,24,0.6);"></div>' +
          '<button data-el="help" style="pointer-events:auto;width:34px;height:34px;border-radius:17px;' +
          'border:1px solid rgba(255,212,121,0.45);background:rgba(10,14,24,0.55);color:' + GOLD + ';' +
          'font-size:15px;font-weight:600;font-family:inherit;padding:0;">?</button>' +
        '</div>' +
      '</div>' +

      // which figure is up, and which move takes it
      '<div data-el="fig" style="position:absolute;left:18px;right:18px;top:' + (SAFE_T + 56) + 'px;' +
      'text-align:center;transition:opacity 320ms ease;">' +
        '<div data-el="figname" style="font-size:25px;font-weight:700;letter-spacing:0.4px;"></div>' +
        '<div data-el="figstep" style="font-size:12.5px;letter-spacing:0.3px;color:' + DIM + ';margin-top:7px;' +
        'line-height:1.45;max-width:300px;margin-left:auto;margin-right:auto;"></div>' +
      '</div>' +

      '<div data-el="pips" style="position:absolute;left:0;right:0;bottom:' + (SAFE_B + 74) + 'px;' +
      'display:flex;justify-content:center;gap:7px;"></div>' +

      '<div data-el="bottom" style="position:absolute;left:0;right:0;bottom:' + (SAFE_B + 14) + 'px;' +
      'padding:0 16px;display:flex;flex-direction:column;align-items:center;gap:10px;">' +
        '<div data-el="hint" style="font-size:12.5px;letter-spacing:0.4px;color:' + DIM + ';text-align:center;' +
        'transition:opacity 300ms ease;">pinch the glowing strand and take it across</div>' +
        '<button data-el="again" style="pointer-events:auto;display:none;width:100%;max-width:300px;height:48px;' +
        'border-radius:24px;border:0;background:' + GOLD + ';color:#1a1206;font-size:15px;font-weight:700;' +
        'font-family:inherit;box-shadow:0 8px 26px rgba(255,212,121,0.26);">Pick it up again</button>' +
      '</div>' +

      '<div data-el="sheet" style="position:absolute;inset:0;display:none;pointer-events:auto;' +
      'background:rgba(6,9,16,0.93);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);' +
      'align-items:center;justify-content:center;padding:26px;">' +
        '<div style="max-width:335px;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">How it is played</div>' +
          '<div style="font-size:14px;line-height:1.75;color:rgba(238,242,247,0.86);">' +
            '• One loop of string is held between two pairs of hands.<br>' +
            '• The <b>glowing strand</b> is the one to pinch. Drag it to the <b>ring</b> ' +
            'and let go, and the figure passes to the other hands.<br>' +
            '• Six figures in the sequence: Opening A, Soldier\'s Bed, Candles, ' +
            'Manger, Diamonds, Cat\'s Eye.<br>' +
            '• Take hold of the wrong strand and the whole thing collapses — that ' +
            'is the real game too.<br>' +
            '• Nobody has ever played this alone. You are playing both parts.' +
          '</div>' +
          '<button data-el="close" style="pointer-events:auto;margin-top:22px;width:100%;height:48px;' +
          'border-radius:24px;border:0;background:' + GOLD + ';color:#1a1206;font-size:15px;font-weight:700;' +
          'font-family:inherit;">Take the string</button>' +
        '</div>' +
      '</div>' +

      '<div data-el="curtain" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
      'align-items:center;justify-content:center;flex-direction:column;gap:16px;' +
      'background:radial-gradient(120% 90% at 50% 42%, #1b2740 0%, #0d1220 55%, #05070d 100%);">' +
        '<div style="font-size:30px;font-weight:700;letter-spacing:0.5px;">Cat\'s Cradle</div>' +
        '<div style="font-size:12px;letter-spacing:2.4px;text-transform:uppercase;color:' + DIM + ';">' +
        'measuring the string</div>' +
      '</div>' +
      '</div>';

    const el = (n) => ui.querySelector('[data-el="' + n + '"]');
    const nodes = {
      top: el("top"), sub: el("sub"), best: el("best"), help: el("help"),
      fig: el("fig"), figname: el("figname"), figstep: el("figstep"), pips: el("pips"),
      hint: el("hint"), again: el("again"),
      sheet: el("sheet"), close: el("close"), curtain: el("curtain")
    };

    ctx.markVisualReady("title");
    ctx.platform.ready();

    // ===================================================================== //
    // 2. Sound                                                              //
    // ===================================================================== //
    const AC = (window.AudioContext || window.webkitAudioContext) || null;
    const canAudio = !!AC && ctx.capabilities.audio !== false;
    const canMusic = ctx.capabilities.backgroundMusic !== false;
    let ac = null, master = null, verb = null, bus = null, padGain = null;
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
      master.gain.setTargetAtTime(0.85, ac.currentTime, 1.1);

      verb = ac.createGain();
      verb.gain.value = 0.36;
      const dl = ac.createDelay(1.0);
      dl.delayTime.value = 0.173;
      const fb = ac.createGain();
      fb.gain.value = 0.44;
      const damp = ac.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2600;
      verb.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl);
      damp.connect(master);

      bus = ac.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      bus.connect(verb);

      padGain = ac.createGain();
      padGain.gain.value = 0;
      const pf = ac.createBiquadFilter();
      pf.type = "lowpass"; pf.frequency.value = 700;
      padGain.connect(pf); pf.connect(master); pf.connect(verb);
      for (const [f, a, d] of [[98, 0.45, 0], [147, 0.26, 6], [196, 0.16, -5], [294, 0.08, 3]]) {
        const o = ac.createOscillator();
        o.type = "sine"; o.frequency.value = f; o.detune.value = d;
        const g = ac.createGain(); g.gain.value = a;
        o.connect(g); g.connect(padGain);
        try { o.start(); } catch (_) {}
      }
      padGain.gain.setTargetAtTime(0.06, ac.currentTime, 2.6);
    }

    function resumeAudio() {
      if (!ac) { startAudio(); return; }
      if (ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
    }

    // A plucked string: a burst of noise round a delay line one period long.
    function pluck(freq, gain, dur) {
      if (!ac || muted) return;
      const sr = ac.sampleRate;
      const n = Math.max(2, Math.round(sr / freq));
      const len = Math.ceil(sr * (dur || 1.1));
      const buf = ac.createBuffer(1, len, sr);
      const out = buf.getChannelData(0);
      const ring = new Float32Array(n);
      let lp = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; lp += (w - lp) * 0.5; ring[i] = lp; }
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const cur = ring[idx], nxt = ring[(idx + 1) % n];
        out[i] = cur;
        ring[idx] = (cur + nxt) * 0.5 * 0.995;
        idx = (idx + 1) % n;
      }
      const fade = Math.min(len, Math.floor(sr * 0.1));
      for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = gain;
      const t = ac.createBiquadFilter();
      t.type = "lowpass"; t.frequency.value = 4200;
      src.connect(t); t.connect(g); g.connect(bus);
      try { src.start(); src.stop(ac.currentTime + (dur || 1.1) + 0.05); } catch (_) {}
    }

    function chime(semi, gain) {
      if (!ac || muted) return;
      const f = 261.63 * Math.pow(2, semi / 12);
      const t = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      g.connect(bus); g.connect(verb);
      for (const [m, a] of [[1, 1], [2, 0.3], [3.02, 0.13], [4.9, 0.06]]) {
        const o = ac.createOscillator();
        o.type = "sine"; o.frequency.value = f * m;
        const og = ac.createGain(); og.gain.value = a;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + 1.8);
      }
    }

    // the sound of it all falling out of your hands
    function collapseSound() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(280, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.7);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      o.connect(g); g.connect(bus); g.connect(verb);
      o.start(t); o.stop(t + 0.9);
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(0.4);
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(2200, t);
      f.frequency.exponentialRampToValueAtTime(400, t + 0.35);
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.11, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      n.connect(f); f.connect(ng); ng.connect(master);
      n.start(t); n.stop(t + 0.45);
    }

    function sting(name) {
      if (ac || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    ctx.onDestroy(() => {
      try { if (ac) ac.close(); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 400 }); } catch (_) {}
    });

    // ===================================================================== //
    // 3. The figures                                                        //
    // ===================================================================== //
    // Twelve pegs: thumb, index and little finger of four hands. Two hands at
    // the bottom are yours; two at the top are the other pair.
    const BLT = 0, BLI = 1, BLP = 2, BRT = 3, BRI = 4, BRP = 5;
    const TLT = 6, TLI = 7, TLP = 8, TRT = 9, TRI = 10, TRP = 11;
    const PEGS = [
      { x: -1.24, y: -1.58 }, { x: -0.86, y: -1.34 }, { x: -1.70, y: -1.34 },
      { x: 1.24, y: -1.58 }, { x: 0.86, y: -1.34 }, { x: 1.70, y: -1.34 },
      { x: -1.24, y: 1.58 }, { x: -0.86, y: 1.34 }, { x: -1.70, y: 1.34 },
      { x: 1.24, y: 1.58 }, { x: 0.86, y: 1.34 }, { x: 1.70, y: 1.34 }
    ];
    const PEG_NAME = ["your left thumb", "your left index", "your left little finger",
      "your right thumb", "your right index", "your right little finger",
      "their left thumb", "their left index", "their left little finger",
      "their right thumb", "their right index", "their right little finger"];

    // Each figure is a closed path through the pegs. Each move names the strand
    // to pinch and the finger to take it to — which is how the game is taught.
    const FIGURES = [
      {
        name: "Opening A", loop: [BLP, BRP, BRT, BLT],
        grab: [BLP, BRP], target: TLI,
        step: "Pinch the far strand and lift it up to their left index finger."
      },
      {
        name: "Soldier's Bed", loop: [BLT, BRP, TLI, TRI, BRT, BLP],
        grab: [TLI, TRI], target: BRI,
        step: "Take the strand between their two index fingers and bring it down to your right index."
      },
      {
        name: "Candles", loop: [BLI, TLI, TRI, BRI],
        grab: [BLI, TLI], target: TRT,
        step: "Pick up the left candle and carry it across to their right thumb."
      },
      {
        name: "Manger", loop: [BLP, TRT, BRP, TLT],
        grab: [BLP, TRT], target: BLI,
        step: "Catch the long diagonal and draw it down to your left index."
      },
      {
        name: "Diamonds", loop: [BLT, TLI, TRT, BRI, BRT, TRI, TLT, BLI],
        grab: [BLT, TLI], target: BRP,
        step: "Hook the near diamond and pull it out to your right little finger."
      },
      {
        name: "Cat's Eye", loop: [BLI, TLT, TRT, BRI, TRI, TLI],
        grab: null, target: -1,
        step: "The last one. Nobody takes this from you."
      }
    ];

    // ===================================================================== //
    // 4. Three, four hands, one string                                      //
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
        '<div style="font-size:19px;font-weight:700;margin-bottom:10px;">Cat\'s Cradle</div>' +
        '<div style="font-size:13.5px;line-height:1.6;opacity:0.8;">This bit needs 3D, and it could not ' +
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
    renderer.toneMappingExposure = 1.06;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (_) {} });

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

    function bakeRing(size, inner, outer) {
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
          const a = clamp(Math.min((rad - inner) / 0.1, (outer - rad) / 0.1), 0, 1);
          const i = (y * size + x) * 4;
          d[i] = 255; d[i + 1] = 236; d[i + 2] = 190;
          d[i + 3] = Math.round(a * 255);
        }
      }
      g2.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    }

    const texGlow = bakeGlow(64, 2.2, 255, 226, 178);
    const texRing = bakeRing(64, 0.52, 0.94);

    scene.background = new THREE.Color(0x080b14);
    scene.add(new THREE.AmbientLight(0x3c4a6a, 1.1));
    const key = new THREE.DirectionalLight(0xdfe8ff, 1.5);
    key.position.set(1.2, 1.6, 4);
    scene.add(key);
    const warm = new THREE.PointLight(0xffb870, 9, 14, 2);
    warm.position.set(0, 0, 2.2);
    scene.add(warm);
    const rim = new THREE.DirectionalLight(0x6f8fd8, 0.9);
    rim.position.set(-2, -1.5, -3);
    scene.add(rim);

    if (texGlow) {
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 11),
        new THREE.MeshBasicMaterial({
          map: texGlow, color: 0x2a3a66, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      pool.position.set(0, 0, -2.6);
      scene.add(pool);
    }

    // ---- hands ---------------------------------------------------------------
    const handMat = new THREE.MeshStandardMaterial({ color: 0x9c6c4e, roughness: 0.8, metalness: 0 });
    const handMatB = new THREE.MeshStandardMaterial({ color: 0x7d5540, roughness: 0.82, metalness: 0 });
    function makeHand(a, b, c, away, mat) {
      const g = new THREE.Group();
      const px2 = (PEGS[a].x + PEGS[b].x + PEGS[c].x) / 3;
      const py2 = (PEGS[a].y + PEGS[b].y + PEGS[c].y) / 3;
      const cxp = px2, cyp = py2 + away * 0.62;
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), mat);
      palm.position.set(cxp, cyp, -0.16);
      palm.scale.set(1.3, 0.86, 0.44);
      g.add(palm);
      // a forearm running off the edge of the frame, so a palm with fingers on
      // it reads as somebody's hand rather than as a spider
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.5, 14), mat);
      arm.position.set(cxp, cyp + away * 0.92, -0.42);
      g.add(arm);
      const wristJoint = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat);
      wristJoint.position.set(cxp, cyp + away * 0.22, -0.2);
      g.add(wristJoint);
      for (const p of [a, b, c]) {
        const dx = PEGS[p].x - cxp, dy = PEGS[p].y - cyp;
        const len = Math.sqrt(dx * dx + dy * dy);
        const f = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.086, len, 10), mat);
        f.position.set(cxp + dx * 0.5, cyp + dy * 0.5, -0.02);
        f.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
        g.add(f);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.066, 10, 8), mat);
        tip.position.set(PEGS[p].x, PEGS[p].y, -0.02);
        g.add(tip);
      }
      scene.add(g);
      return g;
    }
    makeHand(BLT, BLI, BLP, -1, handMat);
    makeHand(BRT, BRI, BRP, -1, handMat);
    makeHand(TLT, TLI, TLP, 1, handMatB);
    makeHand(TRT, TRI, TRP, 1, handMatB);

    // ---- the string ----------------------------------------------------------
    const NS = 132;
    const RADS = 6, RADSV = RADS + 1;
    const STR_R = 0.045;
    const sx = new Float32Array(NS), sy = new Float32Array(NS), sz = new Float32Array(NS);
    const osx = new Float32Array(NS), osy = new Float32Array(NS), osz = new Float32Array(NS);
    const pinPeg = new Int16Array(NS);          // -1, or the peg this node sits on
    const strandOf = new Int16Array(NS);        // which run of the figure it is in
    const restLen = new Float32Array(NS);

    const stringGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(NS * RADSV * 3);
    const sNor = new Float32Array(NS * RADSV * 3);
    const sCol = new Float32Array(NS * RADSV * 3);
    {
      const idx = new Uint16Array(NS * RADS * 6);
      let k = 0;
      for (let s = 0; s < NS; s++) {
        const s2 = (s + 1) % NS;
        for (let j = 0; j < RADS; j++) {
          const a = s * RADSV + j, b = s * RADSV + j + 1;
          const c = s2 * RADSV + j + 1, d = s2 * RADSV + j;
          idx[k++] = a; idx[k++] = b; idx[k++] = c;
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
        }
      }
      stringGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
      stringGeo.setAttribute("normal", new THREE.BufferAttribute(sNor, 3));
      stringGeo.setAttribute("color", new THREE.BufferAttribute(sCol, 3));
      stringGeo.setIndex(new THREE.BufferAttribute(idx, 1));
      stringGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10);
    }
    const stringMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0,
      emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0.35
    });
    const stringMesh = new THREE.Mesh(stringGeo, stringMat);
    stringMesh.frustumCulled = false;
    scene.add(stringMesh);

    function writeStringRing(si, px2, py2, pz2, tx, ty, tz, r, cr, cg, cb) {
      let tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let ux = ty, uy = -tx, uz = 0;
      let l = Math.sqrt(ux * ux + uy * uy);
      if (l < 1e-5) { ux = 1; uy = 0; l = 1; }
      ux /= l; uy /= l;
      let nx = uy * tz - uz * ty, ny = uz * tx - ux * tz, nz = ux * ty - uy * tx;
      l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const base = si * RADSV;
      for (let j = 0; j <= RADS; j++) {
        const ang = (j / RADS) * TAU;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const dx = ux * ca + nx * sa, dy = uy * ca + ny * sa, dz = uz * ca + nz * sa;
        const o = (base + j) * 3;
        sPos[o] = px2 + dx * r; sPos[o + 1] = py2 + dy * r; sPos[o + 2] = pz2 + dz * r;
        sNor[o] = dx; sNor[o + 1] = dy; sNor[o + 2] = dz;
        sCol[o] = cr; sCol[o + 1] = cg; sCol[o + 2] = cb;
      }
    }

    // ---- markers -------------------------------------------------------------
    let grabMark = null, targetMark = null;
    if (texRing) {
      grabMark = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({
        map: texRing, color: 0xffe07a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
      }));
      grabMark.renderOrder = 6;
      scene.add(grabMark);
      targetMark = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({
        map: texRing, color: 0x9fe4ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
      }));
      targetMark.renderOrder = 6;
      scene.add(targetMark);
    }

    // ===================================================================== //
    // 5. Putting a figure on the string                                     //
    // ===================================================================== //
    const tgX = new Float32Array(NS), tgY = new Float32Array(NS), tgZ = new Float32Array(NS);
    let figIdx = 0;
    let curLoop = FIGURES[0].loop;
    let morphT = 1;
    let collapsed = false;
    let collapseT = 0;
    let grabbed = -1;
    let grabX = 0, grabY = 0;
    let best = 0, reached = 0;
    let started = false;
    let time = 0;

    function applyFigure(idx, morph) {
      const fig = FIGURES[idx];
      const loop = fig.loop;
      curLoop = loop;
      const K = loop.length;
      const lens = [];
      let total = 0;
      for (let k = 0; k < K; k++) {
        const a = PEGS[loop[k]], b = PEGS[loop[(k + 1) % K]];
        const d = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
        lens.push(d);
        total += d;
      }
      const pinAt = [];
      let cum = 0;
      for (let k = 0; k < K; k++) {
        pinAt.push(Math.round((cum / total) * NS) % NS);
        cum += lens[k];
      }
      pinPeg.fill(-1);
      for (let k = 0; k < K; k++) {
        const a = PEGS[loop[k]], b = PEGS[loop[(k + 1) % K]];
        const start = pinAt[k];
        const end = pinAt[(k + 1) % K];
        const count = ((end - start) + NS) % NS || NS;
        // a little depth per run, so strands cross rather than fight for pixels
        const zOff = (k % 2 ? 0.05 : -0.05);
        for (let m = 0; m < count; m++) {
          const n = (start + m) % NS;
          const t = m / count;
          tgX[n] = lerp(a.x, b.x, t);
          tgY[n] = lerp(a.y, b.y, t);
          tgZ[n] = Math.sin(t * Math.PI) * zOff;
          strandOf[n] = k;
          restLen[n] = (lens[k] / count) * 0.99;
        }
        pinPeg[start] = loop[k];
      }
      if (morph) {
        morphT = 0;
      } else {
        for (let n = 0; n < NS; n++) {
          sx[n] = tgX[n]; sy[n] = tgY[n]; sz[n] = tgZ[n];
          osx[n] = sx[n]; osy[n] = sy[n]; osz[n] = sz[n];
        }
        morphT = 1;
      }
      nodes.figname.textContent = fig.name;
      nodes.figstep.textContent = fig.step;
      paintPips();
    }

    function solveString(i, j, rest) {
      const dx = sx[j] - sx[i], dy = sy[j] - sy[i], dz = sz[j] - sz[i];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const diff = ((d - rest) / d) * 0.5;
      const wi = (pinPeg[i] >= 0 && !collapsed) || i === grabbed ? 0 : 1;
      const wj = (pinPeg[j] >= 0 && !collapsed) || j === grabbed ? 0 : 1;
      const tw = wi + wj;
      if (!tw) return;
      const ka = (2 * wi) / tw, kb = (2 * wj) / tw;
      sx[i] += dx * diff * ka; sy[i] += dy * diff * ka; sz[i] += dz * diff * ka;
      sx[j] -= dx * diff * kb; sy[j] -= dy * diff * kb; sz[j] -= dz * diff * kb;
    }

    function stepString(dt) {
      if (morphT < 1) {
        morphT = Math.min(1, morphT + dt / 0.5);
        const e = 1 - Math.pow(1 - morphT, 3);
        for (let n = 0; n < NS; n++) {
          sx[n] += (tgX[n] - sx[n]) * e * 0.35;
          sy[n] += (tgY[n] - sy[n]) * e * 0.35;
          sz[n] += (tgZ[n] - sz[n]) * e * 0.35;
          osx[n] = sx[n]; osy[n] = sy[n]; osz[n] = sz[n];
        }
      }
      const damp = collapsed ? 0.985 : 0.9;
      for (let n = 0; n < NS; n++) {
        if ((pinPeg[n] >= 0 && !collapsed) || n === grabbed) continue;
        const vx = (sx[n] - osx[n]) * damp;
        const vy = (sy[n] - osy[n]) * damp;
        const vz = (sz[n] - osz[n]) * damp;
        osx[n] = sx[n]; osy[n] = sy[n]; osz[n] = sz[n];
        sx[n] += vx;
        sy[n] += vy + (collapsed ? -9 : -0.5) * dt * dt;
        sz[n] += vz - sz[n] * 0.03;
      }
      for (let it = 0; it < 6; it++) {
        const down = (it & 1) === 0;
        for (let m = 0; m < NS; m++) {
          const i = down ? m : NS - 1 - m;
          solveString(i, (i + 1) % NS, restLen[i]);
        }
        if (!collapsed) {
          for (let n = 0; n < NS; n++) {
            if (pinPeg[n] < 0) continue;
            sx[n] = PEGS[pinPeg[n]].x; sy[n] = PEGS[pinPeg[n]].y; sz[n] = 0;
          }
        }
        if (grabbed >= 0) { sx[grabbed] = grabX; sy[grabbed] = grabY; sz[grabbed] = 0.25; }
      }
    }

    const strandCol = new THREE.Color();
    function writeString() {
      const fig = FIGURES[figIdx];
      for (let n = 0; n < NS; n++) {
        const a = (n - 1 + NS) % NS, b = (n + 1) % NS;
        const hot = !collapsed && fig.grab && isGrabStrand(strandOf[n]);
        const pulse = hot ? 0.55 + 0.45 * Math.sin(time * 5) : 0;
        strandCol.setRGB(1, 0.86 - pulse * 0.1, 0.62 + pulse * 0.25);
        const r = STR_R * (hot ? 1.22 : 1);
        writeStringRing(n, sx[n], sy[n], sz[n],
          sx[b] - sx[a], sy[b] - sy[a], sz[b] - sz[a], r,
          strandCol.r * (0.7 + pulse * 0.8), strandCol.g * (0.7 + pulse * 0.8), strandCol.b * (0.7 + pulse * 0.6));
      }
      stringGeo.attributes.position.needsUpdate = true;
      stringGeo.attributes.normal.needsUpdate = true;
      stringGeo.attributes.color.needsUpdate = true;
    }

    function isGrabStrand(k) {
      const fig = FIGURES[figIdx];
      if (!fig.grab) return false;
      const K = curLoop.length;
      const a = curLoop[k], b = curLoop[(k + 1) % K];
      return (a === fig.grab[0] && b === fig.grab[1]) || (a === fig.grab[1] && b === fig.grab[0]);
    }

    // ===================================================================== //
    // 6. Playing                                                            //
    // ===================================================================== //
    const pipEls = [];
    for (let i = 0; i < FIGURES.length; i++) {
      const d = document.createElement("div");
      d.style.cssText = "width:8px;height:8px;border-radius:4px;background:rgba(238,242,247,0.18);" +
        "transition:background 240ms ease,box-shadow 240ms ease,transform 240ms ease;";
      pipEls.push(d);
      nodes.pips.appendChild(d);
    }
    function paintPips() {
      for (let i = 0; i < pipEls.length; i++) {
        const on = i <= figIdx;
        pipEls[i].style.background = on ? GOLD : "rgba(238,242,247,0.18)";
        pipEls[i].style.boxShadow = on ? "0 0 10px rgba(255,212,121,0.7)" : "none";
        pipEls[i].style.transform = i === figIdx ? "scale(1.35)" : "scale(1)";
      }
    }

    function firstGesture() {
      if (started) return;
      started = true;
      resumeAudio();
      ctx.platform.start();
      if (canMusic && ctx.music && ctx.music.unlock) { try { ctx.music.unlock(); } catch (_) {} }
    }

    async function submit(n) {
      if (n <= 0) return;
      if (n > best) {
        best = n;
        nodes.best.textContent = "BEST " + best + "/" + FIGURES.length;
        if (ctx.capabilities.storage !== false) {
          try { await ctx.storage.set("best", best); } catch (_) {}
        }
      }
      try {
        await ctx.memory.record("figures").submit(n, { label: n + " of " + FIGURES.length });
      } catch (err) {
        ctx.platform.error({ where: "record_submit", message: String(err) });
      }
    }

    function advance() {
      figIdx++;
      reached = Math.max(reached, figIdx + 1);
      chime(4 + figIdx * 3, 0.13);
      pluck(220 * Math.pow(2, figIdx / 12), 0.2, 1.0);
      ctx.platform.haptic("medium");
      ctx.platform.milestone("figure_" + figIdx);
      ctx.platform.setProgress(figIdx / (FIGURES.length - 1));
      applyFigure(figIdx, true);
      if (figIdx >= FIGURES.length - 1) {
        nodes.hint.textContent = "the whole sequence, in one pair of hands";
        nodes.again.style.display = "block";
        ctx.timeout(() => { chime(16, 0.12); chime(23, 0.09); }, 420);
        submit(FIGURES.length);
        ctx.platform.complete({ figures: FIGURES.length });
      } else {
        nodes.hint.textContent = "pinch the glowing strand and take it across";
      }
    }

    function collapse() {
      if (collapsed) return;
      collapsed = true;
      collapseT = 0;
      grabbed = -1;
      collapseSound();
      sting("fail");
      ctx.platform.haptic("warning");
      ctx.platform.fail({ figures: figIdx });
      submit(figIdx);
      nodes.hint.textContent = figIdx > 0
        ? "wrong strand — it came apart at " + FIGURES[figIdx].name
        : "wrong strand — it came apart";
      nodes.figstep.textContent = "";
    }

    function restart() {
      collapsed = false;
      figIdx = 0;
      grabbed = -1;
      nodes.again.style.display = "none";
      nodes.hint.textContent = "pinch the glowing strand and take it across";
      applyFigure(0, false);
      ctx.platform.setProgress(0);
    }

    ctx.listen(nodes.again, "click", () => { firstGesture(); restart(); });
    ctx.listen(nodes.help, "click", () => { nodes.sheet.style.display = "flex"; });
    ctx.listen(nodes.close, "click", () => { nodes.sheet.style.display = "none"; firstGesture(); });

    // ---- pointer -------------------------------------------------------------
    const ndc = new THREE.Vector3();
    const camDirV = new THREE.Vector3();
    function screenToPlane(px2, py2, out) {
      ndc.set((px2 / Math.max(1, W)) * 2 - 1, -((py2 / Math.max(1, H)) * 2 - 1), 0.5);
      ndc.unproject(camera);
      camDirV.copy(ndc).sub(camera.position);
      if (Math.abs(camDirV.z) < 1e-6) return false;
      const t = (0 - camera.position.z) / camDirV.z;
      if (t <= 0) return false;
      out.x = camera.position.x + camDirV.x * t;
      out.y = camera.position.y + camDirV.y * t;
      return true;
    }
    const planePt = { x: 0, y: 0 };

    ctx.listen(view, "pointerdown", (e) => {
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      if (collapsed || !FIGURES[figIdx].grab) return;
      if (!screenToPlane(e.offsetX, e.offsetY, planePt)) return;
      let bestN = -1, bestD = 0.55 * 0.55;
      for (let n = 0; n < NS; n++) {
        const dx = sx[n] - planePt.x, dy = sy[n] - planePt.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestN = n; }
      }
      if (bestN < 0) return;
      if (!isGrabStrand(strandOf[bestN])) { collapse(); return; }
      grabbed = bestN;
      grabX = planePt.x; grabY = planePt.y;
      pluck(330, 0.16, 0.7);
      ctx.platform.haptic("light");
      nodes.hint.textContent = "now take it to the ring";
    });

    ctx.listen(view, "pointermove", (e) => {
      if (grabbed < 0) return;
      if (!screenToPlane(e.offsetX, e.offsetY, planePt)) return;
      grabX = planePt.x; grabY = planePt.y;
    });

    function releasePointer() {
      if (grabbed < 0) return;
      const fig = FIGURES[figIdx];
      const t = PEGS[fig.target];
      const dx = sx[grabbed] - t.x, dy = sy[grabbed] - t.y;
      grabbed = -1;
      if (fig.target >= 0 && dx * dx + dy * dy < 0.62 * 0.62) advance();
      else nodes.hint.textContent = "not quite — take it right onto the ring";
    }
    ctx.listen(view, "pointerup", releasePointer);
    ctx.listen(view, "pointercancel", releasePointer);

    // ===================================================================== //
    // 7. Layout and the frame loop                                          //
    // ===================================================================== //
    const TOP_RESERVE = SAFE_T + 118;
    const BOT_RESERVE = SAFE_B + 104;
    let camDist = 11;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      const half = Math.tan((camera.fov * Math.PI) / 360);
      const band = clamp((H - TOP_RESERVE - BOT_RESERVE) / H, 0.32, 0.95);
      const rx = 2.05, ry = 1.95;
      camDist = clamp(Math.max(ry / (half * band), rx / (half * camera.aspect)), 5, 22);
      camera.updateProjectionMatrix();
    }
    layout();
    ctx.listen(window, "resize", () => ctx.timeout(layout, 60));
    if (window.visualViewport) ctx.listen(window.visualViewport, "resize", () => ctx.timeout(layout, 60));

    if (ctx.capabilities.storage !== false) {
      try {
        const b = await ctx.storage.get("best");
        if (typeof b === "number" && isFinite(b)) best = b | 0;
      } catch (_) { /* storage is a nicety */ }
    }
    nodes.best.textContent = best > 0 ? "BEST " + best + "/" + FIGURES.length : "";
    nodes.best.style.display = best > 0 ? "block" : "none";

    applyFigure(0, false);
    writeString();
    camera.position.set(0, 0, camDist);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    nodes.curtain.style.transition = "opacity 520ms ease";
    nodes.curtain.style.opacity = "0";
    ctx.timeout(() => { nodes.curtain.style.display = "none"; }, 560);

    let seenHelp = false;
    if (ctx.capabilities.storage !== false) {
      try { seenHelp = !!(await ctx.storage.get("seen")); } catch (_) { seenHelp = false; }
    }
    if (!seenHelp) {
      ctx.timeout(() => { nodes.sheet.style.display = "flex"; }, 620);
      if (ctx.capabilities.storage !== false) {
        try { await ctx.storage.set("seen", true); } catch (_) {}
      }
    }

    ctx.onFrame((dtMs) => {
      const dt = Math.min(0.04, Math.max(0.001, dtMs / 1000));
      time += dt;

      stepString(dt);
      writeString();

      if (collapsed) {
        collapseT += dt;
        if (collapseT > 1.9) restart();
      }

      // where to pinch, and where to take it
      const fig = FIGURES[figIdx];
      if (grabMark && targetMark) {
        if (!collapsed && fig.grab && grabbed < 0) {
          // the middle of the strand we want
          let mx = 0, my = 0, cnt = 0;
          for (let n = 0; n < NS; n++) {
            if (!isGrabStrand(strandOf[n])) continue;
            mx += sx[n]; my += sy[n]; cnt++;
          }
          if (cnt) {
            grabMark.position.set(mx / cnt, my / cnt, 0.5);
            grabMark.material.opacity = 0.55 + Math.sin(time * 4.5) * 0.3;
            const s = 1 + Math.sin(time * 4.5) * 0.12;
            grabMark.scale.setScalar(s);
          } else grabMark.material.opacity = 0;
        } else {
          grabMark.material.opacity = Math.max(0, grabMark.material.opacity - dt * 4);
        }

        if (!collapsed && fig.target >= 0 && grabbed >= 0) {
          const t = PEGS[fig.target];
          targetMark.position.set(t.x, t.y, 0.5);
          targetMark.material.opacity = 0.6 + Math.sin(time * 6) * 0.28;
          targetMark.scale.setScalar(1 + Math.sin(time * 6) * 0.14);
        } else if (!collapsed && fig.target >= 0) {
          const t = PEGS[fig.target];
          targetMark.position.set(t.x, t.y, 0.5);
          targetMark.material.opacity = 0.22 + Math.sin(time * 3) * 0.1;
          targetMark.scale.setScalar(1);
        } else {
          targetMark.material.opacity = Math.max(0, targetMark.material.opacity - dt * 4);
        }
      }

      stringMat.emissiveIntensity = collapsed ? 0.12 : 0.3 + (grabbed >= 0 ? 0.2 : 0);
      warm.intensity = 8 + Math.sin(time * 1.6) * 1.2 + (grabbed >= 0 ? 3 : 0);

      camera.position.set(Math.sin(time * 0.18) * 0.12, Math.sin(time * 0.13) * 0.08, camDist);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    });
  }
};
