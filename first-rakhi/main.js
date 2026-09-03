/**
 * The First Rakhi — tear a strip from the cloth, the way the story says it
 * started.
 *
 * Krishna cut his finger on the Sudarshana chakra. Draupadi tore a strip from
 * her sari and bound it, and he owed her a debt he never forgot. That strip is
 * the first rakhi anybody tells you about — so this bit is that tear, done
 * properly.
 *
 * The cloth is woven rather than drawn. Thirty-six warp threads and forty-eight
 * weft threads, each one an actual ribbon in the scene, each crossing riding in
 * front of or behind its neighbour so the weave is visible if you look. The
 * pattern is not a texture: warp threads carry one colour sequence and weft
 * threads another, and the stripes, checks and zari border are what happens
 * where those two sequences meet — which is how real cloth gets its pattern.
 *
 * Underneath is a mass-spring net with breakable links. There is a nick in the
 * hem to start you off, because that is how cloth is torn: you notch it, then
 * pull, and the crack runs along the grain on its own. Stress concentrates at
 * the tip of a crack in a spring net exactly as it does in cloth, so the tear
 * propagates rather than being scripted — and it follows your hand, so pulling
 * straight gives a clean strip and pulling crooked gives a ragged one. Every
 * broken thread snaps with its own sound and recoils.
 *
 * When the tear reaches the far edge a flood fill decides which threads came
 * away, and those are the ones that wind themselves round the cut.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule). Every texture and
 * every sound is generated in-file — packaged assets are disabled.
 */
window.plethoraBit = {
  meta: {
    title: "The First Rakhi",
    runtime: "plethora-bit@2",
    tags: ["3d", "physics", "art", "story", "tactile"],
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
    // 1. First frame                                                        //
    // ===================================================================== //
    const view = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "4";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);

    const INK = "#f7ecdc";
    const DIM = "rgba(247,236,220,0.58)";
    const GOLD = "#f0c96a";
    const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans Devanagari',sans-serif";

    ui.innerHTML =
      '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:' + FONT + ';' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:' + INK + ';">' +

      '<div data-el="top" style="position:absolute;left:0;right:0;top:' + (SAFE_T + 6) + 'px;padding:0 18px;' +
      'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;transition:opacity 400ms ease;">' +
        '<div>' +
          '<div style="font-size:19px;font-weight:700;letter-spacing:0.3px;line-height:1.05;">The First Rakhi</div>' +
          '<div style="font-size:11px;letter-spacing:1.6px;color:' + DIM + ';margin-top:3px;">पहली राखी</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:9px;">' +
          '<div data-el="torn" style="font-size:12px;letter-spacing:1.1px;color:' + INK + ';' +
          'padding:7px 11px;border-radius:13px;background:rgba(28,10,12,0.6);' +
          'border:1px solid rgba(240,201,106,0.25);transition:opacity 300ms ease;">0 threads</div>' +
          '<button data-el="help" style="pointer-events:auto;width:34px;height:34px;border-radius:17px;' +
          'border:1px solid rgba(240,201,106,0.45);background:rgba(28,10,12,0.55);color:' + GOLD + ';' +
          'font-size:15px;font-weight:600;font-family:inherit;padding:0;">?</button>' +
        '</div>' +
      '</div>' +

      '<div data-el="card" style="position:absolute;left:18px;right:18px;top:' + (SAFE_T + 58) + 'px;' +
      'text-align:center;opacity:0;transition:opacity 700ms ease;pointer-events:none;">' +
        '<div data-el="cardname" style="font-size:23px;font-weight:700;letter-spacing:0.4px;line-height:1.25;"></div>' +
        '<div data-el="cardsub" style="font-size:12.5px;letter-spacing:1.3px;text-transform:uppercase;' +
        'color:' + DIM + ';margin-top:9px;"></div>' +
      '</div>' +

      '<div data-el="bottom" style="position:absolute;left:0;right:0;bottom:' + (SAFE_B + 14) + 'px;' +
      'padding:0 16px;display:flex;flex-direction:column;align-items:center;gap:11px;">' +
        '<div data-el="hint" style="font-size:12.5px;letter-spacing:0.4px;color:' + DIM + ';text-align:center;' +
        'transition:opacity 300ms ease;">the hem is already nicked — pull it</div>' +
        '<button data-el="again" style="pointer-events:auto;display:none;width:100%;max-width:320px;height:50px;' +
        'border-radius:25px;border:0;background:' + GOLD + ';color:#2c1406;font-size:15.5px;font-weight:700;' +
        'font-family:inherit;box-shadow:0 8px 26px rgba(240,201,106,0.28);">Another sari</button>' +
      '</div>' +

      '<div data-el="sheet" style="position:absolute;inset:0;display:none;pointer-events:auto;' +
      'background:rgba(12,5,5,0.92);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);' +
      'align-items:center;justify-content:center;padding:26px;">' +
        '<div style="max-width:335px;">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:14px;">Tear a strip</div>' +
          '<div style="font-size:14px;line-height:1.75;color:rgba(247,236,220,0.86);">' +
            '• There is a nick in the hem. Grab the cloth beside it and pull.<br>' +
            '• The tear runs up the grain on its own — that is what cloth does.<br>' +
            '• Pull straight for a clean strip; pull crooked and it wanders.<br>' +
            '• Every thread you break is a real thread. You can hear them go.<br>' +
            '• When the strip comes away it binds the cut, which is where the ' +
            'story says the first rakhi came from.' +
          '</div>' +
          '<button data-el="close" style="pointer-events:auto;margin-top:22px;width:100%;height:48px;' +
          'border-radius:24px;border:0;background:' + GOLD + ';color:#2c1406;font-size:15px;font-weight:700;' +
          'font-family:inherit;">Begin</button>' +
        '</div>' +
      '</div>' +

      '<div data-el="curtain" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
      'align-items:center;justify-content:center;flex-direction:column;gap:16px;' +
      'background:radial-gradient(120% 90% at 50% 40%, #4a1420 0%, #23090f 55%, #0b0406 100%);">' +
        '<div style="font-size:29px;font-weight:700;letter-spacing:0.5px;">The First Rakhi</div>' +
        '<div style="font-size:12px;letter-spacing:2.4px;text-transform:uppercase;color:' + DIM + ';">' +
        'threading the loom</div>' +
      '</div>' +
      '</div>';

    const el = (n) => ui.querySelector('[data-el="' + n + '"]');
    const nodes = {
      top: el("top"), torn: el("torn"), help: el("help"),
      card: el("card"), cardname: el("cardname"), cardsub: el("cardsub"),
      hint: el("hint"), again: el("again"),
      sheet: el("sheet"), close: el("close"), curtain: el("curtain")
    };

    ctx.markVisualReady("title");
    ctx.platform.ready();

    // ===================================================================== //
    // 2. Sound — one thread at a time                                       //
    // ===================================================================== //
    const AC = (window.AudioContext || window.webkitAudioContext) || null;
    const canAudio = !!AC && ctx.capabilities.audio !== false;
    const canMusic = ctx.capabilities.backgroundMusic !== false;
    let ac = null, master = null, verb = null, bus = null;
    let rustleGain = null, rustleFilter = null, rustleSrc = null, droneGain = null;
    let muted = false;
    let snapBuf = null;

    function noiseBuffer(seconds, brown) {
      const sr = ac.sampleRate;
      const len = Math.ceil(sr * seconds);
      const buf = ac.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { lp += (w - lp) * 0.2; d[i] = lp * 2.4; } else d[i] = w;
      }
      return buf;
    }

    function startAudio() {
      if (ac || !canAudio) return;
      try { ac = new AC(); } catch (_) { ac = null; return; }

      master = ac.createGain();
      master.gain.value = 0;
      master.connect(ac.destination);
      master.gain.setTargetAtTime(0.88, ac.currentTime, 1.0);

      verb = ac.createGain();
      verb.gain.value = 0.3;
      const dl = ac.createDelay(0.8);
      dl.delayTime.value = 0.141;
      const fb = ac.createGain();
      fb.gain.value = 0.42;
      const damp = ac.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 3200;
      verb.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl);
      damp.connect(master);

      bus = ac.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      bus.connect(verb);

      snapBuf = noiseBuffer(0.06, false);

      // cloth moving against itself
      rustleSrc = ac.createBufferSource();
      rustleSrc.buffer = noiseBuffer(3, true);
      rustleSrc.loop = true;
      rustleFilter = ac.createBiquadFilter();
      rustleFilter.type = "bandpass";
      rustleFilter.frequency.value = 2400;
      rustleFilter.Q.value = 0.6;
      rustleGain = ac.createGain();
      rustleGain.gain.value = 0;
      rustleSrc.connect(rustleFilter); rustleFilter.connect(rustleGain); rustleGain.connect(master);
      try { rustleSrc.start(); } catch (_) {}

      droneGain = ac.createGain();
      droneGain.gain.value = 0;
      const df = ac.createBiquadFilter();
      df.type = "lowpass";
      df.frequency.value = 420;
      droneGain.connect(df); df.connect(master); df.connect(verb);
      for (const [f, a, d] of [[65.4, 0.5, 0], [98, 0.28, 5], [130.8, 0.16, -4]]) {
        const o = ac.createOscillator();
        o.type = "sine"; o.frequency.value = f; o.detune.value = d;
        const g = ac.createGain(); g.gain.value = a;
        o.connect(g); g.connect(droneGain);
        try { o.start(); } catch (_) {}
      }
      droneGain.gain.setTargetAtTime(0.06, ac.currentTime, 2.4);
    }

    function resumeAudio() {
      if (!ac) { startAudio(); return; }
      if (ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
    }

    // One thread going: a very short filtered burst. Dozens of these a second
    // is what a tear actually sounds like.
    let snapBudget = 0;
    function threadSnap(pitch) {
      if (!ac || muted || !snapBuf) return;
      if (snapBudget > 14) return;              // keep a cascade from clipping
      snapBudget++;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = snapBuf;
      src.playbackRate.value = 0.7 + pitch * 0.9;
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1400 + pitch * 3200;
      f.Q.value = 2.2;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.09 + Math.random() * 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(f); f.connect(g); g.connect(bus);
      src.start(t); src.stop(t + 0.08);
    }

    function setRustle(level) {
      if (!ac || muted || !rustleGain) return;
      rustleGain.gain.setTargetAtTime(0.05 * level, ac.currentTime, 0.08);
    }

    // the strip coming free
    function ripRelease() {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const n = ac.createBufferSource();
      n.buffer = noiseBuffer(0.9, false);
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(3600, t);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.55);
      f.Q.value = 0.9;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.26, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      n.connect(f); f.connect(g); g.connect(master); g.connect(verb);
      n.start(t); n.stop(t + 0.75);
    }

    const BELL = [[1, 1, 4.6], [2.04, 0.44, 3], [2.7, 0.33, 2.1], [3.4, 0.2, 1.4]];
    function bell(freq, gain) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const out = ac.createGain();
      out.gain.value = gain;
      out.connect(bus); out.connect(verb);
      for (const [mult, amp, life] of BELL) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = freq * mult * (1 + rnd(-0.004, 0.004));
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + life);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + life + 0.1);
      }
    }

    function sting(name) {
      if (ac || muted || !canMusic || !ctx.music || !ctx.music.sting) return;
      try { ctx.music.sting(name); } catch (_) {}
    }

    ctx.onDestroy(() => {
      try { if (rustleSrc) rustleSrc.stop(); } catch (_) {}
      try { if (ac) ac.close(); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 400 }); } catch (_) {}
    });

    // ===================================================================== //
    // 3. Three, and a loom                                                  //
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
        '<div style="font-size:19px;font-weight:700;margin-bottom:10px;">The First Rakhi</div>' +
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
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 120);
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

    function bakeRoom() {
      const w = 512, h = 256;
      const cv = surface(w, h);
      if (!cv) return null;
      const g2 = cv.getContext("2d");
      const grad = g2.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#241016");
      grad.addColorStop(0.45, "#3d1820");
      grad.addColorStop(0.78, "#170a0e");
      grad.addColorStop(1, "#070304");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, w, h);
      for (const [cx, cy, r, inner, mid] of [
        [w * 0.3, h * 0.28, w * 0.2, "#ffd9a8", "#7a4a2a"],
        [w * 0.75, h * 0.4, w * 0.13, "#c78a5a", "#4a2a1a"]
      ]) {
        for (const ox of [-w, 0, w]) {
          const rg = g2.createRadialGradient(cx + ox, cy, 1, cx + ox, cy, r);
          rg.addColorStop(0, inner);
          rg.addColorStop(0.45, mid);
          rg.addColorStop(1, "rgba(0,0,0,0)");
          g2.fillStyle = rg;
          g2.fillRect(0, 0, w, h);
        }
      }
      const t = new THREE.CanvasTexture(cv);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    }

    const texGlow = bakeGlow(64, 2.3, 255, 216, 168);
    const roomTex = bakeRoom();
    scene.background = new THREE.Color(0x0d0508);
    if (roomTex) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        scene.environment = pmrem.fromEquirectangular(roomTex).texture;
        scene.environmentIntensity = 1.0;
        pmrem.dispose();
      } catch (_) { scene.environment = roomTex; }
    }
    scene.add(new THREE.AmbientLight(0x6a4048, 1.1));
    const key = new THREE.DirectionalLight(0xffe4c0, 1.9);
    key.position.set(1.4, 2.4, 4);
    scene.add(key);
    const rim = new THREE.PointLight(0xff7a6a, 7, 20, 2);
    rim.position.set(-3, -1.6, 2.4);
    scene.add(rim);

    if (texGlow) {
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(15, 15),
        new THREE.MeshBasicMaterial({
          map: texGlow, color: 0x6e2634, transparent: true, opacity: 0.45,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      pool.position.set(0, 0.4, -3.6);
      scene.add(pool);
    }

    // ===================================================================== //
    // 4. The cloth                                                          //
    // ===================================================================== //
    const GW = 32;                 // warp threads, across
    const GH = 42;                 // weft threads, down
    const CX = 2.25;               // half width
    const CY0 = 2.95, CY1 = -2.15; // top and bottom
    const SX = (CX * 2) / (GW - 1);
    const SY = (CY0 - CY1) / (GH - 1);
    const TH = 0.021;              // how far a thread rides in front or behind
    const THREAD_W = 0.055;

    const NN = GW * GH;
    const cx = new Float32Array(NN), cy = new Float32Array(NN), cz = new Float32Array(NN);
    const oxa = new Float32Array(NN), oya = new Float32Array(NN), oza = new Float32Array(NN);
    const pinned = new Uint8Array(NN);
    const shade = new Float32Array(NN);
    // hBroken[j*(GW-1)+i]: the weft thread between warp i and i+1 on row j
    const hBroken = new Uint8Array((GW - 1) * GH);
    // vBroken[j*GW+i]: the warp thread between row j and j+1 on column i
    const vBroken = new Uint8Array(GW * (GH - 1));

    // ---- the pattern ---------------------------------------------------------
    // Warp threads carry one colour sequence, weft threads another, and what
    // you see is where the two meet. That is a loom, not a texture.
    const PALETTES = [
      { base: [0.62, 0.06, 0.10], alt: [0.86, 0.18, 0.14], zari: [0.95, 0.74, 0.30], name: "crimson" },
      { base: [0.09, 0.14, 0.46], alt: [0.20, 0.36, 0.74], zari: [0.90, 0.78, 0.42], name: "indigo" },
      { base: [0.05, 0.32, 0.24], alt: [0.16, 0.55, 0.34], zari: [0.94, 0.80, 0.36], name: "emerald" },
      { base: [0.72, 0.34, 0.03], alt: [0.92, 0.56, 0.10], zari: [1.00, 0.86, 0.46], name: "saffron" },
      { base: [0.48, 0.06, 0.34], alt: [0.78, 0.16, 0.50], zari: [0.96, 0.76, 0.38], name: "magenta" },
      { base: [0.20, 0.06, 0.28], alt: [0.42, 0.16, 0.52], zari: [0.92, 0.80, 0.50], name: "aubergine" }
    ];

    let warpCol = new Float32Array(GW * 3);
    let weftCol = new Float32Array(GH * 3);
    let warpGold = new Uint8Array(GW);
    let weftGold = new Uint8Array(GH);
    let sariName = "";

    function weave(seed) {
      const r = mulberry(seed);
      const pal = PALETTES[Math.floor(r() * PALETTES.length)];
      sariName = pal.name;
      const stripeEvery = 3 + Math.floor(r() * 6);
      const stripeWidth = 1 + Math.floor(r() * 2);
      const checked = r() < 0.45;
      const borderW = 2 + Math.floor(r() * 3);

      for (let i = 0; i < GW; i++) {
        let c = pal.base, gold = 0;
        const fromEdge = Math.min(i, GW - 1 - i);
        if (fromEdge < borderW) { c = pal.zari; gold = 1; }               // selvedge
        else if (i % stripeEvery < stripeWidth) c = pal.alt;
        else if (i % (stripeEvery * 3) === stripeEvery + 1) { c = pal.zari; gold = 1; }
        warpCol[i * 3] = c[0]; warpCol[i * 3 + 1] = c[1]; warpCol[i * 3 + 2] = c[2];
        warpGold[i] = gold;
      }
      for (let j = 0; j < GH; j++) {
        let c = pal.base, gold = 0;
        const fromEnd = Math.min(j, GH - 1 - j);
        if (fromEnd < borderW + 1) { c = pal.zari; gold = 1; }            // the pallu
        else if (checked && j % stripeEvery < stripeWidth) c = pal.alt;
        else if (j % (stripeEvery * 4) === 2) { c = pal.zari; gold = 1; }
        weftCol[j * 3] = c[0]; weftCol[j * 3 + 1] = c[1]; weftCol[j * 3 + 2] = c[2];
        weftGold[j] = gold;
      }
    }

    // ---- geometry: one ribbon per thread, one span per crossing --------------
    // Each span owns its six vertices rather than sharing them, so a thread
    // that snaps can simply collapse the span that broke.
    const VPS = 6;                      // verts per span (3 across, twice)
    const WARP_SPANS = GW * (GH - 1);
    const WEFT_SPANS = GH * (GW - 1);

    function makeCloth(spans) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(spans * VPS * 3);
      const col = new Float32Array(spans * VPS * 3);
      const idx = new Uint16Array(spans * 12);
      let k = 0;
      for (let s = 0; s < spans; s++) {
        const b = s * VPS;
        // a0 a1 a2 (first ring)  b0 b1 b2 (second ring)
        idx[k++] = b; idx[k++] = b + 1; idx[k++] = b + 4;
        idx[k++] = b; idx[k++] = b + 4; idx[k++] = b + 3;
        idx[k++] = b + 1; idx[k++] = b + 2; idx[k++] = b + 5;
        idx[k++] = b + 1; idx[k++] = b + 5; idx[k++] = b + 4;
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide
      }));
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { geo: geo, pos: pos, col: col, mesh: mesh };
    }

    const warpMesh = makeCloth(WARP_SPANS);
    const weftMesh = makeCloth(WEFT_SPANS);

    // ---- the arm, and the cut ------------------------------------------------
    const WRIST_Y = -3.0, WRIST_Z = 0.35, WRIST_R = 0.34;
    const arm = new THREE.Group();
    arm.position.set(0, WRIST_Y, WRIST_Z);
    scene.add(arm);
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3e, roughness: 0.86, metalness: 0 });
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(WRIST_R, WRIST_R * 1.16, 2.6, 20), skin);
    forearm.rotation.z = Math.PI / 2;
    arm.add(forearm);
    const heel = new THREE.Mesh(new THREE.SphereGeometry(WRIST_R * 1.02, 16, 12), skin);
    heel.position.x = 1.3;
    heel.scale.set(1.15, 0.92, 0.95);
    arm.add(heel);
    const cut = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.07, 0.09),
      new THREE.MeshStandardMaterial({ color: 0x7d0a10, roughness: 0.35, emissive: new THREE.Color(0xb01018), emissiveIntensity: 0.5 })
    );
    cut.position.set(0.55, WRIST_R * 0.8, 0.2);
    cut.rotation.z = 0.22;
    arm.add(cut);

    const DRIPS = 5;
    const dripGeo = new THREE.SphereGeometry(0.05, 8, 6);
    const dripMat = new THREE.MeshStandardMaterial({ color: 0x9c0f16, roughness: 0.25, metalness: 0 });
    const drips = [];
    for (let i = 0; i < DRIPS; i++) {
      const m = new THREE.Mesh(dripGeo, dripMat);
      m.visible = false;
      arm.add(m);
      drips.push({ mesh: m, t: rnd(0, 2.4), x: rnd(0.36, 0.74) });
    }

    // ===================================================================== //
    // 5. The cloth, simulated                                               //
    // ===================================================================== //
    const NICK_I = 6;                   // the strip is everything left of this
    let broken = 0;
    let grabbed = -1;
    let grabX = 0, grabY = 0;
    let torn = false;

    function resetCloth(seed) {
      weave(seed);
      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          const n = j * GW + i;
          const x = -CX + i * SX;
          const y = CY0 - j * SY;
          cx[n] = x; cy[n] = y; cz[n] = Math.sin(i * 0.4) * 0.02 + Math.sin(j * 0.3) * 0.02;
          oxa[n] = x; oya[n] = y; oza[n] = cz[n];
          pinned[n] = j === 0 ? 1 : 0;
          shade[n] = 1;
        }
      }
      hBroken.fill(0);
      vBroken.fill(0);
      // the nick: three weft threads already parted at the hem
      for (let j = GH - 3; j < GH; j++) hBroken[j * (GW - 1) + NICK_I] = 1;
      broken = 3;
      torn = false;
      grabbed = -1;
    }

    const GRAV = -3.6;
    const H_BREAK = 1.55;               // a weft thread parts sooner...
    const V_BREAK = 2.15;               // ...than a warp thread, so tears run down the grain
    const TIP = 0.70;                   // and a thread beside a tear parts sooner still

    // A crack tip concentrates stress — that is why a tear runs instead of
    // stopping. Weakening the weft threads that already have a break beside
    // them, including diagonally, is enough to get both behaviours: the tear
    // follows itself up the grain, and it wanders toward wherever you are
    // pulling rather than running dead straight.
    function hTipWeak(i, j) {
      const w = GW - 1;
      for (let dj = -1; dj <= 1; dj += 2) {
        const jj = j + dj;
        if (jj < 0 || jj >= GH) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= w) continue;
          if (hBroken[jj * w + ii]) return true;
        }
      }
      return false;
    }

    function simulate(dt) {
      const damp = 0.972;
      for (let n = 0; n < NN; n++) {
        if (pinned[n] || n === grabbed) continue;
        const vx = (cx[n] - oxa[n]) * damp;
        const vy = (cy[n] - oya[n]) * damp;
        const vz = (cz[n] - oza[n]) * damp;
        oxa[n] = cx[n]; oya[n] = cy[n]; oza[n] = cz[n];
        cx[n] += vx;
        cy[n] += vy + GRAV * dt * dt;
        cz[n] += vz;
        cz[n] += (0 - cz[n]) * 0.02;     // the cloth hangs roughly flat
      }
      if (grabbed >= 0) { cx[grabbed] = grabX; cy[grabbed] = grabY; }

      const canBreak = grabbed >= 0;
      const ITER = 8;
      for (let it = 0; it < ITER; it++) {
        // Gauss-Seidel only carries information as far as it sweeps, so a pull
        // at the hem never reached a crack tip twenty rows up. Alternating the
        // sweep direction each iteration walks it the whole way in one pass.
        const down = (it & 1) === 0;
        const last = it === ITER - 1;

        // weft: what holds one warp thread to the next
        for (let jj = 0; jj < GH; jj++) {
          const j = down ? jj : GH - 1 - jj;
          const row = j * (GW - 1);
          for (let ii = 0; ii < GW - 1; ii++) {
            const i = down ? ii : GW - 2 - ii;
            if (hBroken[row + i]) continue;
            const a = j * GW + i, b = a + 1;
            const strain = solve(a, b, SX);
            if (canBreak && last && strain > H_BREAK * (hTipWeak(i, j) ? TIP : 1)) {
              hBroken[row + i] = 1;
              broken++;
              onBreak(a, b, j / GH);
            }
          }
        }
        // warp: the thread running down the cloth
        for (let jj = 0; jj < GH - 1; jj++) {
          const j = down ? jj : GH - 2 - jj;
          const row = j * GW;
          for (let ii = 0; ii < GW; ii++) {
            const i = down ? ii : GW - 1 - ii;
            if (vBroken[row + i]) continue;
            const a = j * GW + i, b = a + GW;
            const strain = solve(a, b, SY);
            if (canBreak && last && strain > V_BREAK) {
              vBroken[row + i] = 1;
              broken++;
              onBreak(a, b, 0.2 + i / GW * 0.4);
            }
          }
        }
        if (grabbed >= 0) { cx[grabbed] = grabX; cy[grabbed] = grabY; }
      }
    }

    function solve(a, b, rest) {
      const dx = cx[b] - cx[a], dy = cy[b] - cy[a], dz = cz[b] - cz[a];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const diff = (d - rest) / d * 0.5;
      const wa = pinned[a] || a === grabbed ? 0 : 1;
      const wb = pinned[b] || b === grabbed ? 0 : 1;
      const tw = wa + wb;
      if (tw > 0) {
        const ka = (2 * wa) / tw, kb = (2 * wb) / tw;
        cx[a] += dx * diff * ka; cy[a] += dy * diff * ka; cz[a] += dz * diff * ka;
        cx[b] -= dx * diff * kb; cy[b] -= dy * diff * kb; cz[b] -= dz * diff * kb;
      }
      return d / rest;
    }

    // a snapped thread recoils, which is most of why a tear looks like a tear
    function onBreak(a, b, pitch) {
      const kick = 0.012;
      const dx = cx[b] - cx[a], dy = cy[b] - cy[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (!pinned[a]) { oxa[a] += dx / d * kick; oya[a] += dy / d * kick; }
      if (!pinned[b]) { oxa[b] -= dx / d * kick; oya[b] -= dy / d * kick; }
      threadSnap(pitch);
    }

    // ---- is it in two pieces yet? -------------------------------------------
    const seen = new Uint8Array(NN);
    const stack = new Int32Array(NN);
    let floodMinJ = 0, floodMaxJ = 0;
    function floodFrom(start) {
      floodMinJ = GH; floodMaxJ = -1;
      seen.fill(0);
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let count = 0;
      while (sp > 0) {
        const n = stack[--sp];
        count++;
        const i = n % GW, j = (n / GW) | 0;
        if (j < floodMinJ) floodMinJ = j;
        if (j > floodMaxJ) floodMaxJ = j;
        if (i > 0 && !hBroken[j * (GW - 1) + (i - 1)] && !seen[n - 1]) { seen[n - 1] = 1; stack[sp++] = n - 1; }
        if (i < GW - 1 && !hBroken[j * (GW - 1) + i] && !seen[n + 1]) { seen[n + 1] = 1; stack[sp++] = n + 1; }
        if (j > 0 && !vBroken[(j - 1) * GW + i] && !seen[n - GW]) { seen[n - GW] = 1; stack[sp++] = n - GW; }
        if (j < GH - 1 && !vBroken[j * GW + i] && !seen[n + GW]) { seen[n + GW] = 1; stack[sp++] = n + GW; }
      }
      return count;
    }

    // ---- drawing the weave ---------------------------------------------------
    const LX = 0.36, LY = 0.48, LZ = 0.80;      // where the light comes from
    function shadeCloth() {
      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          const n = j * GW + i;
          const l = i > 0 ? n - 1 : n, r = i < GW - 1 ? n + 1 : n;
          const u = j > 0 ? n - GW : n, d = j < GH - 1 ? n + GW : n;
          const ax = cx[r] - cx[l], ay = cy[r] - cy[l], az = cz[r] - cz[l];
          const bx = cx[d] - cx[u], by = cy[d] - cy[u], bz = cz[d] - cz[u];
          let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= len; ny /= len; nz /= len;
          if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const dot = nx * LX + ny * LY + nz * LZ;
          shade[n] = 0.40 + 0.62 * Math.max(0, dot);
        }
      }
    }

    let clothFade = 1;
    function writeSpan(buf, s, ax, ay, az, bx, by, bz, bulge, cr, cg, cb) {
      // across = normalise(direction x view), so the ribbon always faces us
      let wx = by - ay, wy = -(bx - ax);
      const wl = Math.sqrt(wx * wx + wy * wy);
      if (wl < 1e-6) { wx = THREAD_W; wy = 0; } else { wx = wx / wl * THREAD_W; wy = wy / wl * THREAD_W; }
      const o = s * VPS * 3;
      const p = buf.pos, c = buf.col;
      p[o] = ax - wx; p[o + 1] = ay - wy; p[o + 2] = az;
      p[o + 3] = ax; p[o + 4] = ay; p[o + 5] = az + bulge;
      p[o + 6] = ax + wx; p[o + 7] = ay + wy; p[o + 8] = az;
      p[o + 9] = bx - wx; p[o + 10] = by - wy; p[o + 11] = bz;
      p[o + 12] = bx; p[o + 13] = by; p[o + 14] = bz + bulge;
      p[o + 15] = bx + wx; p[o + 16] = by + wy; p[o + 17] = bz;
      const e = 0.58;
      c[o] = cr * e; c[o + 1] = cg * e; c[o + 2] = cb * e;
      c[o + 3] = cr; c[o + 4] = cg; c[o + 5] = cb;
      c[o + 6] = cr * e; c[o + 7] = cg * e; c[o + 8] = cb * e;
      c[o + 9] = cr * e; c[o + 10] = cg * e; c[o + 11] = cb * e;
      c[o + 12] = cr; c[o + 13] = cg; c[o + 14] = cb;
      c[o + 15] = cr * e; c[o + 16] = cg * e; c[o + 17] = cb * e;
    }

    function collapse(buf, s) {
      const o = s * VPS * 3;
      for (let k = 0; k < VPS * 3; k++) buf.pos[o + k] = 0;
    }

    function writeCloth() {
      const bulge = 0.014;
      // warp threads run down the cloth
      for (let i = 0; i < GW; i++) {
        const gold = warpGold[i];
        const cr0 = warpCol[i * 3], cg0 = warpCol[i * 3 + 1], cb0 = warpCol[i * 3 + 2];
        for (let j = 0; j < GH - 1; j++) {
          const s = i * (GH - 1) + j;
          if (vBroken[j * GW + i]) { collapse(warpMesh, s); continue; }
          const a = j * GW + i, b = a + GW;
          const za = ((i + j) & 1) ? -TH : TH;
          const zb = ((i + j + 1) & 1) ? -TH : TH;
          const sh = (shade[a] + shade[b]) * 0.5 * clothFade * (gold ? 1.25 : 1);
          writeSpan(warpMesh, s,
            cx[a], cy[a], cz[a] + za, cx[b], cy[b], cz[b] + zb,
            bulge, cr0 * sh, cg0 * sh, cb0 * sh);
        }
      }
      // weft threads run across it
      for (let j = 0; j < GH; j++) {
        const gold = weftGold[j];
        const cr0 = weftCol[j * 3], cg0 = weftCol[j * 3 + 1], cb0 = weftCol[j * 3 + 2];
        for (let i = 0; i < GW - 1; i++) {
          const s = j * (GW - 1) + i;
          if (hBroken[j * (GW - 1) + i]) { collapse(weftMesh, s); continue; }
          const a = j * GW + i, b = a + 1;
          const za = ((i + j) & 1) ? TH : -TH;
          const zb = ((i + j + 1) & 1) ? TH : -TH;
          const sh = (shade[a] + shade[b]) * 0.5 * clothFade * (gold ? 1.25 : 1);
          writeSpan(weftMesh, s,
            cx[a], cy[a], cz[a] + za, cx[b], cy[b], cz[b] + zb,
            bulge, cr0 * sh, cg0 * sh, cb0 * sh);
        }
      }
      warpMesh.geo.attributes.position.needsUpdate = true;
      warpMesh.geo.attributes.color.needsUpdate = true;
      weftMesh.geo.attributes.position.needsUpdate = true;
      weftMesh.geo.attributes.color.needsUpdate = true;
    }

    // ===================================================================== //
    // 6. Binding it                                                         //
    // ===================================================================== //
    let phase = "tear";                 // tear -> wrap -> bound
    let phaseT = 0;
    let started = false;
    let time = 0;
    let stripCount = 0;
    const tgx = new Float32Array(NN), tgy = new Float32Array(NN), tgz = new Float32Array(NN);
    const isStrip = new Uint8Array(NN);
    let bleeding = 1;

    function beginWrap() {
      phase = "wrap";
      phaseT = 0;
      grabbed = -1;
      stripCount = 0;
      for (let n = 0; n < NN; n++) {
        isStrip[n] = seen[n];
        if (!seen[n]) continue;
        stripCount++;
        const i = n % GW, j = (n / GW) | 0;
        const u = j / (GH - 1);
        const v = NICK_I > 0 ? i / NICK_I : 0.5;
        const ang = -Math.PI * 0.5 + u * TAU * 1.8;
        const rad = WRIST_R + 0.06 + u * 0.035;
        tgx[n] = 0.55 + (v - 0.5) * 0.92;
        tgy[n] = WRIST_Y + Math.sin(ang) * rad;
        tgz[n] = WRIST_Z + Math.cos(ang) * rad;
        pinned[n] = 1;                  // the strip is carried, not simulated
      }
      // the sari is let go of; only the strip is carried on
      for (let i = 0; i < GW; i++) if (!isStrip[i]) pinned[i] = 0;
      ripRelease();
      releasePointer();
      ctx.platform.haptic("success");
      ctx.platform.milestone("strip_free");
      nodes.hint.textContent = "binding it";
      nodes.torn.style.opacity = "0";
    }

    function bound() {
      phase = "bound";
      phaseT = 0;
      bell(294, 0.2);
      ctx.timeout(() => bell(392, 0.14), 380);
      ctx.platform.haptic("success");
      nodes.card.style.opacity = "1";
      nodes.top.style.opacity = "0";
      nodes.cardname.textContent = "He owed her a debt he never forgot.";
      nodes.cardsub.textContent = broken + " threads · one " + sariName + " sari";
      nodes.hint.textContent = "the first rakhi";
      nodes.again.style.display = "block";
      ctx.platform.setProgress(1);
      ctx.platform.complete({ threads: broken, sari: sariName });
    }

    function restart() {
      phase = "tear";
      phaseT = 0;
      clothFade = 1;
      bleeding = 1;
      isStrip.fill(0);
      resetCloth((Math.random() * 1e9) | 0);
      nodes.card.style.opacity = "0";
      nodes.top.style.opacity = "1";
      nodes.again.style.display = "none";
      nodes.torn.style.opacity = "1";
      nodes.torn.textContent = "0 threads";
      nodes.hint.style.opacity = "1";
      nodes.hint.textContent = "the hem is already nicked — pull it";
      ctx.platform.setProgress(0);
    }

    function firstGesture() {
      if (started) return;
      started = true;
      resumeAudio();
      ctx.platform.start();
      if (canMusic && ctx.music && ctx.music.unlock) { try { ctx.music.unlock(); } catch (_) {} }
    }

    // ---- pointer -------------------------------------------------------------
    const ndc = new THREE.Vector3();
    const camDirV = new THREE.Vector3();
    function screenToPlane(sx, sy, out) {
      ndc.set((sx / Math.max(1, W)) * 2 - 1, -((sy / Math.max(1, H)) * 2 - 1), 0.5);
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
      if (phase !== "tear") return;
      if (!screenToPlane(e.offsetX, e.offsetY, planePt)) return;
      let bestN = -1, bestD = 0.9 * 0.9;
      for (let n = 0; n < NN; n++) {
        if (pinned[n]) continue;
        const dx = cx[n] - planePt.x, dy = cy[n] - planePt.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestN = n; }
      }
      if (bestN < 0) return;
      grabbed = bestN;
      grabX = planePt.x; grabY = planePt.y;
      nodes.hint.style.opacity = "0.4";
    });

    ctx.listen(view, "pointermove", (e) => {
      if (grabbed < 0) return;
      if (!screenToPlane(e.offsetX, e.offsetY, planePt)) return;
      grabX = planePt.x; grabY = planePt.y;
    });

    function releasePointer() { grabbed = -1; }
    ctx.listen(view, "pointerup", releasePointer);
    ctx.listen(view, "pointercancel", releasePointer);

    ctx.listen(nodes.again, "click", () => { firstGesture(); restart(); });
    ctx.listen(nodes.help, "click", () => { nodes.sheet.style.display = "flex"; });
    ctx.listen(nodes.close, "click", () => { nodes.sheet.style.display = "none"; firstGesture(); });

    // ===================================================================== //
    // 7. Layout and the frame loop                                          //
    // ===================================================================== //
    const TOP_RESERVE = SAFE_T + 58;
    const BOT_RESERVE = SAFE_B + 86;
    let bandFrac = 0.75;
    const camAim = new THREE.Vector3(0, 0.2, 0);
    let camDist = 13, camDistTarget = 13;
    let aimY = 0.2, aimYTarget = 0.2;

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      bandFrac = clamp((H - TOP_RESERVE - BOT_RESERVE) / H, 0.4, 0.95);
      camera.updateProjectionMatrix();
      frameScene();
    }

    function frameScene() {
      const half = Math.tan((camera.fov * Math.PI) / 360);
      if (phase === "tear") {
        const rx = CX + 0.25, ry = (CY0 - (WRIST_Y - WRIST_R * 1.3)) * 0.5;
        aimYTarget = (CY0 + WRIST_Y - WRIST_R * 1.3) * 0.5;
        camDistTarget = Math.max(ry / (half * bandFrac), rx / (half * camera.aspect));
      } else {
        const rx = 2.0, ry = 1.7;
        aimYTarget = WRIST_Y + 0.1;
        camDistTarget = Math.max(ry / (half * bandFrac), rx / (half * camera.aspect));
      }
    }
    layout();
    ctx.listen(window, "resize", () => ctx.timeout(layout, 60));
    if (window.visualViewport) ctx.listen(window.visualViewport, "resize", () => ctx.timeout(layout, 60));

    resetCloth((Math.random() * 1e9) | 0);
    shadeCloth();
    writeCloth();
    camDist = camDistTarget;
    aimY = aimYTarget;
    camera.position.set(0, aimY, camDist);
    camera.lookAt(0, aimY, 0);
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

    let frame = 0, lastBroken = 3, checkAt = 0;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(0.04, Math.max(0.001, dtMs / 1000));
      time += dt;
      frame++;
      snapBudget = Math.max(0, snapBudget - 3);

      if (phase === "tear") {
        simulate(dt);
        if (broken !== lastBroken) {
          lastBroken = broken;
          nodes.torn.textContent = broken + (broken === 1 ? " thread" : " threads");
          ctx.platform.setProgress(clamp((broken - 3) / 230, 0, 0.95));
          if (broken % 8 === 0) ctx.platform.haptic("light");
        }
        setRustle(grabbed >= 0 ? 0.8 : 0.12);
        // is the strip off yet?
        checkAt += dt;
        if (checkAt > 0.15) {
          checkAt = 0;
          // A strip is only a strip if it runs the whole height of the cloth
          // and the far side really is out of reach — otherwise an isolated
          // corner counts as one and the story ends on a scrap.
          // A strip is only a strip if what came away is long — most of the
          // height of the cloth — and the far side really is out of reach.
          // Otherwise a torn-off corner would end the story on a scrap.
          const count = floodFrom((GH - 1) * GW);
          const spanOk = floodMaxJ - floodMinJ > GH * 0.55;
          if (spanOk && count > GH * 2 &&
              !seen[GW - 1] && !seen[(GH - 1) * GW + (GW - 1)]) beginWrap();
        }
      } else if (phase === "wrap") {
        phaseT += dt;
        simulate(dt);          // the rest of the cloth is still falling
        const t = clamp(phaseT / 1.9, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        for (let n = 0; n < NN; n++) {
          if (!isStrip[n]) continue;
          cx[n] += (tgx[n] - cx[n]) * Math.min(1, dt * 4.5);
          cy[n] += (tgy[n] - cy[n]) * Math.min(1, dt * 4.5);
          cz[n] += (tgz[n] - cz[n]) * Math.min(1, dt * 4.5);
          oxa[n] = cx[n]; oya[n] = cy[n]; oza[n] = cz[n];
        }
        // the rest of the sari falls away
        clothFade = lerp(1, 0.3, e);
        bleeding = lerp(1, 0, clamp((phaseT - 1.1) / 0.8, 0, 1));
        setRustle(0.25 * (1 - e));
        if (phaseT > 2.3) bound();
      } else {
        setRustle(0);
        if (phaseT < 3) simulate(dt);
        phaseT += dt;
        for (let n = 0; n < NN; n++) {
          if (!isStrip[n]) continue;
          const w = Math.sin(time * 1.4 + n * 0.05) * 0.006;
          cx[n] = tgx[n] + w;
          cy[n] = tgy[n];
          cz[n] = tgz[n] + w * 0.5;
        }
      }

      if (frame % 2 === 0) shadeCloth();
      writeCloth();

      // the cut, and what runs out of it
      cut.material.emissiveIntensity = 0.35 + bleeding * 0.5;
      for (let k = 0; k < DRIPS; k++) {
        const d = drips[k];
        d.t += dt * 0.75;
        if (d.t > 1) { d.t -= 1; d.x = rnd(0.36, 0.76); }
        const vis = bleeding > 0.05;
        d.mesh.visible = vis;
        if (vis) {
          d.mesh.position.set(d.x, WRIST_R * 0.8 - d.t * 1.5, 0.14 + Math.sin(d.t * 3) * 0.05);
          const sc = clamp(bleeding, 0, 1) * clamp(1 - d.t, 0, 1) * 1.1;
          d.mesh.scale.setScalar(0.5 + sc);
        }
      }

      frameScene();
      camDist += (camDistTarget - camDist) * Math.min(1, dt * 1.8);
      aimY += (aimYTarget - aimY) * Math.min(1, dt * 1.8);
      camera.position.set(Math.sin(time * 0.16) * 0.1, aimY, camDist);
      camera.lookAt(0, aimY, 0);

      rim.intensity = 6 + Math.sin(time * 1.3) * 1.2 + (phase === "bound" ? 4 : 0);
      renderer.render(scene, camera);
    });
  }
};
