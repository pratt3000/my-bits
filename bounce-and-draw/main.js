/**
 * Bounce & Draw — draw the walls, let the balls pay you.
 *
 * A ball falls from the top. Draw a bar anywhere and it becomes something solid
 * to ricochet off, and every bounce earns. Spend what you make on a better ball
 * or on another ball entirely, until the board is full of light rattling around
 * whatever geometry you left lying about.
 *
 * One idea done honestly: a bounce is worth money, so you are really building a
 * machine that maximises bounces. A funnel. A staircase. A long shallow ramp
 * that keeps a ball skimming instead of dropping.
 *
 * Two things carry the rebuild:
 *
 *   Every bar is a note. Its pitch comes from its length — long bars are low —
 *   quantised to a major pentatonic, and its colour comes from that same pitch.
 *   So the board is legible as music before you hear it, and a machine that
 *   maximises bounces is also composing. That is the whole point of the thing.
 *
 *   Everything is rendered in three.js through a real bloom pass, so a bar is a
 *   solid slab with a lit edge rather than a stroke with a shadow behind it.
 *
 * Physics, economy and the drawing gesture are the original Sekai build's,
 * unchanged. The look, the sound and the leaderboard are new.
 *
 * Icon geometry is lucide (ISC licence), inlined as SVG.
 */
window.plethoraBit = {
  meta: {
    title: "Bounce & Draw",
    runtime: "plethora-bit@2",
    tags: ["game", "physics", "idle", "drawing", "leaderboard"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Constants                                                          //
    // ===================================================================== //
    // Shipped tune values, kept exactly.
    const GRAVITY = 0.4;
    const RESTITUTION = 0.9;
    const MONEY_PER_BOUNCE = 1;
    const BALL_RADIUS = 15;
    const BAR_R = 6;              // bar half-width; the original's lineWidth was 12
    const MAX_LINES = 100;

    const INK = "#eceaf4";
    const DIM = "rgba(236,234,244,0.55)";
    const GOLD = "#ffd45c";

    const ICONS = {
      "circle-dollar-sign": '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
      "arrow-big-up-dash": '<path d="M14 16a1 1 0 0 0 1-1v-2a1 1 0 0 1 1-1h3.293a.707.707 0 0 0 .5-1.207l-6.939-6.939a1.207 1.207 0 0 0-1.708 0l-6.94 6.94a.707.707 0 0 0 .5 1.206H8a1 1 0 0 1 1 1v2a1 1 0 0 0 1 1z"/><path d="M9 20h6"/>',
      "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
      "circle-x": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
      "trophy": '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
      "music": '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'
    };
    const svg = (name, size, colour) =>
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' +
      colour + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[name] + "</svg>";

    // Plethora's own generative beds, standing in for the original's track list.
    const BEDS = [
      { id: "lofi", name: "Lo-fi" },
      { id: "ambient", name: "Ambient" },
      { id: "synthwave", name: "Synthwave" },
      { id: "none", name: "Silence" }
    ];

    const state = {
      money: 0,
      lifetime: 0,        // never spent down — this is what the board ranks
      peakSubmitted: 0,
      ballsCount: 1,
      ballLevel: 1,
      upgradeCost: 50,
      ballCost: 100,
      bed: "lofi"
    };

    let balls = [];
    let bars = [];              // {ax, ay, bx, by, note, hue, flash}
    let drawing = null;
    let barsDirty = true;

    // ===================================================================== //
    // 1. Surfaces                                                           //
    // ===================================================================== //
    let THREE = null;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (_) {
      try {
        THREE = await ctx.importModule("https://libs.plethora.studio/three/0.164.1/three.module.js");
      } catch (e2) { THREE = null; }
    }

    let FONT = "'Space Grotesk',-apple-system,BlinkMacSystemFont,sans-serif";
    try {
      await ctx.loadFont("Space Grotesk", "space-grotesk", "1.0.0", { weight: "300 700" });
    } catch (_) { FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"; }

    const view = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "4";
    ui.style.pointerEvents = "none";

    const SAFE_T = Math.max((ctx.safeArea && ctx.safeArea.top) || 0, 8);
    const SAFE_B = Math.max((ctx.safeArea && ctx.safeArea.bottom) || 0, 10);
    let W = Math.max(1, ctx.width), H = Math.max(1, ctx.height);

    if (!THREE) {
      ui.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'padding:30px;text-align:center;font-family:' + FONT + ';color:#e7e5f0;background:#07060d;">' +
        '<div><div style="font-size:19px;font-weight:700;margin-bottom:9px;">Bounce &amp; Draw</div>' +
        '<div style="font-size:13.5px;opacity:0.75;line-height:1.6;">This needs 3D, and it could not ' +
        "start here. Try opening it again in the Plethora app.</div></div></div>";
      ctx.platform.error({ where: "three_import" });
      ctx.platform.ready();
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(2, ctx.nativeDpr || 1));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x05050e, 1);

    const scene = new THREE.Scene();
    // Screen coordinates straight through: x right, y DOWN, so the physics and
    // the pointer events need no mapping at all. Building the camera with top
    // above bottom flips the projection's Y, which inverts triangle winding —
    // every material here must be DoubleSide or it is back-face culled into
    // invisibility. That cost an afternoon in symphony-sketchpad.
    const camera = new THREE.OrthographicCamera(0, W, 0, H, -1000, 1000);

    // ===================================================================== //
    // 2. Sound                                                              //
    // ===================================================================== //
    // A bar's pitch comes from its length. Longer is lower, quantised to a
    // major pentatonic across four octaves so a hundred bars rattling at once
    // still resolves into something you would keep listening to.
    const PENT = [0, 2, 4, 7, 9];
    function noteForLength(len) {
      const t = Math.max(0, Math.min(1, (len - 24) / 330));
      const step = Math.round((1 - t) * 19);            // 0..19, short bars high
      const oct = Math.floor(step / PENT.length);
      const semis = PENT[step % PENT.length] + oct * 12;
      return 36 + semis;                                 // MIDI, from C2
    }
    const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

    const Sound = {
      ac: null, ready: false, bus: null, wave: null,
      init() {
        if (this.ac) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ac = new AC(); } catch (_) { return; }
        const ac = this.ac;

        // One master chain for everything, which is where most of the quality
        // in a game that plays a hundred notes a second actually lives.
        const out = ac.createGain();
        out.gain.value = 0.9;
        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -9;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.18;
        const shelf = ac.createBiquadFilter();
        shelf.type = "highshelf";
        shelf.frequency.value = 5200;
        shelf.gain.value = 2.5;
        const bus = ac.createGain();
        bus.gain.value = 0.55;
        bus.connect(shelf); shelf.connect(limiter); limiter.connect(out);
        out.connect(ac.destination);
        this.bus = bus;

        // Reverb from a generated impulse: exponentially decaying noise with
        // the channels decorrelated, so the tail spreads instead of sitting in
        // the middle of your head.
        try {
          const dur = 1.9, len = Math.floor(ac.sampleRate * dur);
          const buf = ac.createBuffer(2, len, ac.sampleRate);
          for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < len; i++) {
              d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
            }
          }
          const conv = ac.createConvolver();
          conv.buffer = buf;
          const wet = ac.createGain();
          wet.gain.value = 0.30;
          conv.connect(wet); wet.connect(bus);
          this.reverb = conv;
        } catch (_) { this.reverb = null; }

        // True ping-pong: two lines cross-fed. Feedback stays well under 0.5
        // because a pair of cross-fed delays has a system gain of 2g and at 0.5
        // it simply never decays.
        try {
          const dL = ac.createDelay(1.0), dR = ac.createDelay(1.0);
          dL.delayTime.value = 0.26; dR.delayTime.value = 0.39;
          const fb = ac.createGain(); fb.gain.value = 0.26;
          const pL = ac.createStereoPanner ? ac.createStereoPanner() : null;
          const pR = ac.createStereoPanner ? ac.createStereoPanner() : null;
          if (pL) pL.pan.value = -0.75;
          if (pR) pR.pan.value = 0.75;
          dL.connect(fb); fb.connect(dR); dR.connect(dL);
          dL.connect(pL || bus); dR.connect(pR || bus);
          if (pL) pL.connect(bus);
          if (pR) pR.connect(bus);
          const send = ac.createGain(); send.gain.value = 0.20;
          send.connect(dL);
          this.delay = send;
        } catch (_) { this.delay = null; }

        // A marimba-ish spectrum. Scattered partial phases, because partials
        // that all start aligned are what makes an additive tone buzz.
        try {
          const n = 9;
          const re = new Float32Array(n), im = new Float32Array(n);
          const amps = [0, 1, 0.36, 0.15, 0.09, 0.05, 0.03, 0.02, 0.012];
          for (let i = 1; i < n; i++) {
            const ph = (i * 2.399963) % (Math.PI * 2);
            re[i] = amps[i] * Math.cos(ph);
            im[i] = amps[i] * Math.sin(ph);
          }
          this.wave = ac.createPeriodicWave(re, im, { disableNormalization: false });
        } catch (_) { this.wave = null; }

        this.ready = true;
      },
      resume() {
        if (this.ac && this.ac.state === "suspended") { try { this.ac.resume(); } catch (_) {} }
      },
      // A bar being struck. `vel` is 0..1 from impact speed, `pan` is -1..1.
      hit(midi, vel, pan) {
        if (!this.ready) return;
        const ac = this.ac, t = ac.currentTime;
        const f = midiHz(midi) * Math.pow(2, ((Math.random() - 0.5) * 8) / 1200);
        const osc = ac.createOscillator();
        if (this.wave) osc.setPeriodicWave(this.wave); else osc.type = "triangle";
        osc.frequency.value = f;

        const lp = ac.createBiquadFilter();
        lp.type = "lowpass";
        // Cutoff tracks pitch and how hard it was hit, so a fast ball is
        // brighter as well as louder. No extra control to learn.
        lp.frequency.value = Math.min(14000, f * (3.5 + vel * 7));
        lp.Q.value = 0.9;

        const g = ac.createGain();
        // Low notes ring longer, as a real bar would.
        const dec = 0.20 + (1 - Math.min(1, (midi - 36) / 40)) * 0.55;
        const peak = 0.16 + vel * 0.20;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);

        let node = g;
        if (ac.createStereoPanner) {
          const p = ac.createStereoPanner();
          p.pan.value = Math.max(-1, Math.min(1, pan));
          g.connect(p); node = p;
        }
        osc.connect(lp); lp.connect(g);
        node.connect(this.bus);
        if (this.reverb) node.connect(this.reverb);
        if (this.delay) node.connect(this.delay);
        try { osc.start(t); osc.stop(t + dec + 0.05); } catch (_) {}
      },
      coin() {
        if (!this.ready) return;
        const ac = this.ac, t = ac.currentTime;
        for (let i = 0; i < 2; i++) {
          const osc = ac.createOscillator();
          osc.type = "triangle";
          const f0 = i ? 1568 : 1046;
          osc.frequency.setValueAtTime(f0, t + i * 0.055);
          osc.frequency.exponentialRampToValueAtTime(f0 * 1.02, t + i * 0.055 + 0.12);
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, t + i * 0.055);
          g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.055 + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.055 + 0.16);
          osc.connect(g); g.connect(this.bus);
          if (this.reverb) g.connect(this.reverb);
          try { osc.start(t + i * 0.055); osc.stop(t + i * 0.055 + 0.2); } catch (_) {}
        }
      },
      fanfare(base) {
        if (!this.ready) return;
        [0, 4, 7, 12].forEach((s, i) => {
          ctx.timeout(() => this.hit(base + s, 0.85, 0), i * 85);
        });
      },
      close() {
        if (this.ac) { try { this.ac.close(); } catch (_) {} }
        this.ac = null; this.ready = false;
      }
    };

    // ===================================================================== //
    // 3. The board                                                          //
    // ===================================================================== //
    // Backdrop: a shader, so flat areas are never dead. The aura in the middle
    // grows with your ball level — the original's idea, kept.
    const backMat = new THREE.ShaderMaterial({
      uniforms: {
        uRes: { value: new THREE.Vector2(W, H) },
        uTime: { value: 0 },
        uAura: { value: 0 }
      },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "uniform vec2 uRes; uniform float uTime; uniform float uAura;",
        "float h(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}",
        "float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);",
        "  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}",
        "void main(){",
        // vUv.y runs bottom-up in GL and the layout is top-down, so flip it or
        // the gradient lands at the wrong end of the screen.
        "  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);",
        "  vec3 c = mix(vec3(0.028,0.028,0.062), vec3(0.062,0.050,0.105), uv.y);",
        "  vec2 p = uv * vec2(uRes.x/uRes.y, 1.0) * 2.4;",
        "  float n = vnoise(p + vec2(uTime*0.035, -uTime*0.021));",
        "  n = n * vnoise(p*1.9 - vec2(uTime*0.017, uTime*0.03));",
        "  c += vec3(0.20,0.09,0.34) * n * (0.20 + uAura*0.85);",
        // A faint dot grid, so the board reads as a surface with a scale.
        "  vec2 gp = uv*uRes/34.0;",
        "  float dots = smoothstep(0.16, 0.02, length(fract(gp)-0.5));",
        "  c += vec3(0.14,0.16,0.30) * dots * 0.16;",
        "  float aur = exp(-pow(length((uv-0.5)*vec2(uRes.x/uRes.y,1.0))/0.42, 2.0));",
        "  c += vec3(0.34,0.16,0.60) * aur * uAura * 0.30;",
        "  c *= 1.0 - length(uv-0.5)*0.42;",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n"),
      depthWrite: false, side: THREE.DoubleSide
    });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backMat);
    backdrop.position.z = -400;
    scene.add(backdrop);

    // ---- bars ------------------------------------------------------------
    // One geometry rebuilt when the set of bars changes. Each bar is a quad in
    // its own local frame and a capsule signed distance in the fragment shader,
    // which gives a solid slab with a lit rim — not a stroke with a blur.
    const barGeo = new THREE.BufferGeometry();
    const bPos = new Float32Array(MAX_LINES * 4 * 3);
    const bLocal = new Float32Array(MAX_LINES * 4 * 2);
    const bHalf = new Float32Array(MAX_LINES * 4);
    const bHue = new Float32Array(MAX_LINES * 4);
    const bFlash = new Float32Array(MAX_LINES * 4);
    const bIdx = new Uint16Array(MAX_LINES * 6);
    barGeo.setAttribute("position", new THREE.BufferAttribute(bPos, 3));
    barGeo.setAttribute("aLocal", new THREE.BufferAttribute(bLocal, 2));
    barGeo.setAttribute("aHalf", new THREE.BufferAttribute(bHalf, 1));
    barGeo.setAttribute("aHue", new THREE.BufferAttribute(bHue, 1));
    barGeo.setAttribute("aFlash", new THREE.BufferAttribute(bFlash, 1));
    barGeo.setIndex(new THREE.BufferAttribute(bIdx, 1));
    barGeo.setDrawRange(0, 0);

    const HUE = [
      "vec3 hue(float t){",
      // A warm-to-cool ramp: low notes deep magenta, high notes cyan-white.
      "  return mix(mix(vec3(0.95,0.15,0.55), vec3(0.55,0.30,1.00), smoothstep(0.0,0.5,t)),",
      "             vec3(0.25,0.92,1.00), smoothstep(0.45,1.0,t));",
      "}"
    ].join("\n");

    const barMat = new THREE.ShaderMaterial({
      uniforms: { uR: { value: BAR_R } },
      vertexShader: [
        "attribute vec2 aLocal; attribute float aHalf; attribute float aHue; attribute float aFlash;",
        "varying vec2 vL; varying float vHalf; varying float vHue; varying float vFlash;",
        "void main(){ vL=aLocal; vHalf=aHalf; vHue=aHue; vFlash=aFlash;",
        "  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float;",
        "varying vec2 vL; varying float vHalf; varying float vHue; varying float vFlash;",
        "uniform float uR;",
        HUE,
        "void main(){",
        // Capsule distance in the bar's own frame.
        "  float d = length(vec2(max(abs(vL.x)-vHalf, 0.0), vL.y));",
        "  float body = 1.0 - smoothstep(uR-1.0, uR+0.6, d);",
        "  float rim  = smoothstep(uR-3.2, uR-0.5, d) * body;",
        "  float halo = exp(-max(0.0, d-uR)*0.17);",
        "  vec3 tint = hue(vHue);",
        "  vec3 c = vec3(0.052,0.055,0.085) * body;",
        // A highlight along the upper edge, so the slab has a lit side.
        "  c += vec3(0.55,0.58,0.78) * body * smoothstep(0.15,-0.85, vL.y/uR) * 0.16;",
        "  c += tint * rim * (0.85 + vFlash*2.6);",
        "  c += tint * halo * (0.15 + vFlash*0.75);",
        "  float a = max(body, halo*0.85);",
        "  gl_FragColor = vec4(c, a);",
        "}"
      ].join("\n"),
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const barMesh = new THREE.Mesh(barGeo, barMat);
    barMesh.frustumCulled = false;
    barMesh.position.z = 0;
    scene.add(barMesh);

    function rebuildBars() {
      barsDirty = false;
      const pad = BAR_R + 22;      // room for the caps and the halo
      let v = 0, tri = 0;
      const all = drawing ? bars.concat([drawing]) : bars;
      for (let i = 0; i < all.length && i < MAX_LINES; i++) {
        const s = all[i];
        let dx = s.bx - s.ax, dy = s.by - s.ay;
        const len = Math.hypot(dx, dy);
        const half = len / 2;
        if (len < 0.001) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
        const nx = -dy, ny = dx;
        const cx = (s.ax + s.bx) / 2, cy = (s.ay + s.by) / 2;
        const ex = half + pad, ey = pad;
        const corners = [[-ex, -ey], [ex, -ey], [-ex, ey], [ex, ey]];
        for (let k = 0; k < 4; k++) {
          const lx = corners[k][0], ly = corners[k][1];
          const o = (v + k) * 3;
          bPos[o] = cx + dx * lx + nx * ly;
          bPos[o + 1] = cy + dy * lx + ny * ly;
          bPos[o + 2] = 0;
          bLocal[(v + k) * 2] = lx;
          bLocal[(v + k) * 2 + 1] = ly;
          bHalf[v + k] = half;
          bHue[v + k] = s.hue;
          bFlash[v + k] = s.flash;
        }
        bIdx[tri++] = v; bIdx[tri++] = v + 1; bIdx[tri++] = v + 2;
        bIdx[tri++] = v + 1; bIdx[tri++] = v + 3; bIdx[tri++] = v + 2;
        v += 4;
      }
      for (const a of ["position", "aLocal", "aHalf", "aHue", "aFlash"]) {
        barGeo.attributes[a].needsUpdate = true;
      }
      barGeo.index.needsUpdate = true;
      barGeo.setDrawRange(0, tri);
    }

    // ---- balls -----------------------------------------------------------
    const ballGeo = new THREE.SphereGeometry(1, 22, 16);
    const ballMats = [];
    function ballMaterial(colour) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Color(colour) }, uSquash: { value: 0 } },
        vertexShader: [
          "varying vec3 vN; varying vec3 vV;",
          "void main(){ vN = normalize(normalMatrix*normal);",
          "  vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz;",
          "  gl_Position = projectionMatrix*mv; }"
        ].join("\n"),
        fragmentShader: [
          "precision highp float; varying vec3 vN; varying vec3 vV; uniform vec3 uC;",
          "void main(){",
          "  vec3 n = normalize(vN);",
          "  float f = pow(1.0 - clamp(dot(n, normalize(vV)), 0.0, 1.0), 2.2);",
          // Light from the upper left, in screen space, since the camera never
          // moves. A ball with no shading reads as a flat disc.
          "  float lam = clamp(dot(n, normalize(vec3(-0.45,-0.6,0.65))), 0.0, 1.0);",
          "  vec3 c = uC * (0.34 + 0.66*lam);",
          "  c += vec3(1.0) * pow(lam, 22.0) * 0.85;",
          "  c += uC * f * 0.9;",
          "  gl_FragColor = vec4(c, 1.0);",
          "}"
        ].join("\n"),
        side: THREE.DoubleSide
      });
      ballMats.push(m);
      return m;
    }

    // A soft additive disc behind each ball, purely for the bloom to grab.
    const auraGeo = new THREE.PlaneGeometry(1, 1);
    function auraMaterial(colour) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Color(colour) } },
        vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: [
          "precision highp float; varying vec2 vUv; uniform vec3 uC;",
          "void main(){ float d=length((vUv-0.5)*2.0);",
          "  float a=smoothstep(1.0,0.0,d); a*=a;",
          "  gl_FragColor=vec4(uC, a*0.30); }"
        ].join("\n"),
        transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      });
      ballMats.push(m);
      return m;
    }

    // ---- trails ----------------------------------------------------------
    const TRAIL = 15;
    const MAXBALLS = 24;
    const trGeo = new THREE.BufferGeometry();
    const trPos = new Float32Array(MAXBALLS * TRAIL * 2 * 3);
    const trAttr = new Float32Array(MAXBALLS * TRAIL * 2 * 2);   // (t along, colour idx unused)
    const trCol = new Float32Array(MAXBALLS * TRAIL * 2 * 3);
    const trIdx = new Uint16Array(MAXBALLS * (TRAIL - 1) * 6);
    trGeo.setAttribute("position", new THREE.BufferAttribute(trPos, 3));
    trGeo.setAttribute("aT", new THREE.BufferAttribute(trAttr, 2));
    trGeo.setAttribute("aC", new THREE.BufferAttribute(trCol, 3));
    trGeo.setIndex(new THREE.BufferAttribute(trIdx, 1));
    trGeo.setDrawRange(0, 0);
    const trMat = new THREE.ShaderMaterial({
      vertexShader: [
        "attribute vec2 aT; attribute vec3 aC; varying vec2 vT; varying vec3 vC;",
        "void main(){ vT=aT; vC=aC;",
        "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec2 vT; varying vec3 vC;",
        "void main(){",
        "  float across = 1.0 - abs(vT.y);",
        "  float a = vT.x * vT.x * vT.x * smoothstep(0.0, 0.6, across);",
        "  gl_FragColor = vec4(vC, a*0.60);",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const trails = new THREE.Mesh(trGeo, trMat);
    trails.frustumCulled = false;
    trails.position.z = -6;
    scene.add(trails);

    // ---- impact rings ----------------------------------------------------
    const RINGS = 40;
    const ringGeo = new THREE.BufferGeometry();
    const rgPos = new Float32Array(RINGS * 4 * 3);
    const rgUv = new Float32Array(RINGS * 4 * 2);
    const rgLife = new Float32Array(RINGS * 4);
    const rgCol = new Float32Array(RINGS * 4 * 3);
    const rgIdx = new Uint16Array(RINGS * 6);
    ringGeo.setAttribute("position", new THREE.BufferAttribute(rgPos, 3));
    ringGeo.setAttribute("uv", new THREE.BufferAttribute(rgUv, 2));
    ringGeo.setAttribute("aLife", new THREE.BufferAttribute(rgLife, 1));
    ringGeo.setAttribute("aC", new THREE.BufferAttribute(rgCol, 3));
    ringGeo.setIndex(new THREE.BufferAttribute(rgIdx, 1));
    ringGeo.setDrawRange(0, 0);
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: [
        "attribute float aLife; attribute vec3 aC;",
        "varying vec2 vUv; varying float vLife; varying vec3 vC;",
        "void main(){ vUv=uv; vLife=aLife; vC=aC;",
        "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec2 vUv; varying float vLife; varying vec3 vC;",
        "void main(){",
        "  float d = length((vUv-0.5)*2.0);",
        "  float r = 1.0 - vLife;",              // ring radius grows as life falls
        "  float w = 0.10 + r*0.22;",
        "  float ring = exp(-pow((d-r)/w, 2.0));",
        "  gl_FragColor = vec4(vC, ring*vLife*0.85);",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.frustumCulled = false;
    ringMesh.position.z = 4;
    scene.add(ringMesh);
    const rings = [];

    // ---- sparks ----------------------------------------------------------
    const SP = 700;
    const spPos = new Float32Array(SP * 3);
    const spLife = new Float32Array(SP);
    const spCol = new Float32Array(SP * 3);
    const spVel = new Float32Array(SP * 2);
    let spHead = 0;
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    spGeo.setAttribute("aLife", new THREE.BufferAttribute(spLife, 1));
    spGeo.setAttribute("aC", new THREE.BufferAttribute(spCol, 3));
    const spMat = new THREE.ShaderMaterial({
      uniforms: { uDpr: { value: 1 } },
      vertexShader: [
        "attribute float aLife; attribute vec3 aC; varying float vL; varying vec3 vC;",
        "uniform float uDpr;",
        "void main(){ vL=aLife; vC=aC;",
        "  gl_PointSize = (3.0 + 9.0*aLife) * uDpr;",
        "  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying float vL; varying vec3 vC;",
        "void main(){ float d=length(gl_PointCoord-0.5)*2.0;",
        "  float a=smoothstep(1.0,0.0,d); gl_FragColor=vec4(vC, a*a*vL); }"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const sparks = new THREE.Points(spGeo, spMat);
    sparks.frustumCulled = false;
    sparks.position.z = 6;
    scene.add(sparks);

    // ---- coins -----------------------------------------------------------
    // Coins fly from the impact to the money pill. Nothing communicates "that
    // bounce paid" like the payment visibly arriving somewhere.
    const coinTex = (() => {
      const cv = ctx.createCanvas2D();
      cv.style.display = "none";
      cv.width = 64; cv.height = 64;
      const c = cv.getContext("2d");
      c.clearRect(0, 0, 64, 64);
      const gr = c.createRadialGradient(26, 24, 3, 32, 32, 30);
      gr.addColorStop(0, "#fff6d0");
      gr.addColorStop(0.55, "#ffd45c");
      gr.addColorStop(1, "#c98b12");
      c.beginPath(); c.arc(32, 32, 28, 0, Math.PI * 2);
      c.fillStyle = gr; c.fill();
      c.lineWidth = 3; c.strokeStyle = "rgba(255,248,214,0.9)"; c.stroke();
      c.fillStyle = "#8a5c05";
      c.font = "700 34px -apple-system,BlinkMacSystemFont,sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("$", 32, 34);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const COINS = 60;
    const coinGeo = new THREE.BufferGeometry();
    const cnPos = new Float32Array(COINS * 4 * 3);
    const cnUv = new Float32Array(COINS * 4 * 2);
    const cnA = new Float32Array(COINS * 4);
    const cnIdx = new Uint16Array(COINS * 6);
    coinGeo.setAttribute("position", new THREE.BufferAttribute(cnPos, 3));
    coinGeo.setAttribute("uv", new THREE.BufferAttribute(cnUv, 2));
    coinGeo.setAttribute("aA", new THREE.BufferAttribute(cnA, 1));
    coinGeo.setIndex(new THREE.BufferAttribute(cnIdx, 1));
    coinGeo.setDrawRange(0, 0);
    const coinMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: coinTex } },
      vertexShader: [
        "attribute float aA; varying vec2 vUv; varying float vA;",
        "void main(){ vUv=uv; vA=aA;",
        "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec2 vUv; varying float vA; uniform sampler2D tMap;",
        "void main(){ vec4 t = texture2D(tMap, vUv);",
        "  gl_FragColor = vec4(t.rgb, t.a*vA); }"
      ].join("\n"),
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const coinMesh = new THREE.Mesh(coinGeo, coinMat);
    coinMesh.frustumCulled = false;
    coinMesh.position.z = 8;
    scene.add(coinMesh);
    const coins = [];

    // ===================================================================== //
    // 4. Bloom                                                              //
    // ===================================================================== //
    const rtScene = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const rtA = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const rtB = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const passScene = new THREE.Scene();
    const passQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    passScene.add(passQuad);
    const VERT = "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}";

    const brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } }, vertexShader: VERT,
      fragmentShader: [
        "precision highp float; varying vec2 vUv; uniform sampler2D tDiffuse;",
        "void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb;",
        "  float l=dot(c,vec3(0.2126,0.7152,0.0722));",
        "  gl_FragColor=vec4(c*smoothstep(0.42,0.95,l),1.0); }"
      ].join("\n"), depthTest: false, depthWrite: false
    });
    const blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uTexel;",
        "void main(){ vec2 o=uDir*uTexel;",
        "  vec3 s=texture2D(tDiffuse,vUv).rgb*0.227027;",
        "  s+=texture2D(tDiffuse,vUv+o*1.3846).rgb*0.316216;",
        "  s+=texture2D(tDiffuse,vUv-o*1.3846).rgb*0.316216;",
        "  s+=texture2D(tDiffuse,vUv+o*3.2308).rgb*0.070270;",
        "  s+=texture2D(tDiffuse,vUv-o*3.2308).rgb*0.070270;",
        "  gl_FragColor=vec4(s,1.0); }"
      ].join("\n"), depthTest: false, depthWrite: false
    });
    const compMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tBloom: { value: null }, uAmount: { value: 0.85 }, uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uAmount; uniform float uTime;",
        "float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}",
        "void main(){ vec3 c=texture2D(tScene,vUv).rgb + texture2D(tBloom,vUv).rgb*uAmount;",
        // ACES-ish filmic curve, so highlights roll off instead of clipping flat.
        "  c=(c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);",
        "  c += (hash(vUv*1024.0+fract(uTime))-0.5)*0.016;",
        "  gl_FragColor=vec4(clamp(c,0.0,1.0),1.0); }"
      ].join("\n"), depthTest: false, depthWrite: false
    });
    function pass(mat, target) {
      passQuad.material = mat;
      renderer.setRenderTarget(target || null);
      renderer.render(passScene, quadCam);
    }

    // ===================================================================== //
    // 5. Layout                                                             //
    // ===================================================================== //
    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = H;
      camera.updateProjectionMatrix();

      backdrop.scale.set(W, H, 1);
      backdrop.position.set(W / 2, H / 2, -400);
      backMat.uniforms.uRes.value.set(W, H);

      const dpr = renderer.getPixelRatio();
      rtScene.setSize(Math.max(1, Math.floor(W * dpr)), Math.max(1, Math.floor(H * dpr)));
      const bw = Math.max(1, Math.floor(W * dpr * 0.25));
      const bh = Math.max(1, Math.floor(H * dpr * 0.25));
      rtA.setSize(bw, bh); rtB.setSize(bw, bh);
      blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
      spMat.uniforms.uDpr.value = dpr;

      topBar.style.top = SAFE_T + "px";
      shop.style.bottom = SAFE_B + "px";
      barsDirty = true;
    }

    // ===================================================================== //
    // 6. UI                                                                 //
    // ===================================================================== //
    const shopBtn = (el, icon, title, costEl) =>
      '<button data-el="' + el + '" style="pointer-events:auto;flex:1;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:3px;height:62px;border-radius:16px;' +
      'border:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.05);font-family:inherit;' +
      'padding:0 6px;transition:background 150ms, opacity 150ms, transform 120ms;">' +
      svg(icon, 17, INK) +
      '<span style="font-size:9.5px;font-weight:700;letter-spacing:0.6px;color:' + INK + ';' +
      'text-transform:uppercase;">' + title + "</span>" +
      '<span data-el="' + costEl + '" style="font-size:11.5px;font-weight:700;color:' + GOLD + ';">$0</span>' +
      "</button>";

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ";color:" + INK + ";" +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      '<div data-el="topBar" style="position:absolute;left:0;right:0;display:flex;align-items:center;' +
      'justify-content:space-between;padding:0 14px;">' +
        '<div data-el="badge" style="display:flex;align-items:center;gap:7px;background:rgba(6,6,14,0.55);' +
        'border:1px solid rgba(255,212,92,0.30);border-radius:21px;padding:8px 15px;' +
        '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
        'transition:transform 140ms cubic-bezier(.2,1.4,.4,1);">' +
          svg("circle-dollar-sign", 17, GOLD) +
          '<span data-el="money" style="font-size:19px;font-weight:700;color:' + GOLD + ';' +
          'letter-spacing:-0.3px;font-variant-numeric:tabular-nums;">0</span>' +
        "</div>" +
        '<div style="display:flex;gap:7px;">' +
          '<button data-el="board_btn" style="pointer-events:auto;width:38px;height:38px;border-radius:19px;' +
          'border:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.06);display:flex;' +
          'align-items:center;justify-content:center;padding:0;">' + svg("trophy", 16, INK) + "</button>" +
          '<button data-el="music_btn" style="pointer-events:auto;width:38px;height:38px;border-radius:19px;' +
          'border:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.06);display:flex;' +
          'align-items:center;justify-content:center;padding:0;">' + svg("music", 16, INK) + "</button>" +
        "</div>" +
      "</div>" +

      '<div data-el="hint" style="position:absolute;left:0;right:0;top:42%;text-align:center;' +
      'pointer-events:none;transition:opacity 500ms ease;padding:0 34px;">' +
        '<div style="font-size:18px;font-weight:600;letter-spacing:-0.2px;">Draw a bar</div>' +
        '<div style="font-size:13px;color:' + DIM + ';margin-top:7px;line-height:1.6;">' +
        "press and drag to set its length.<br>short bars ring high, long ones low.<br>" +
        "every bounce pays.</div>" +
      "</div>" +

      '<div data-el="shop" style="position:absolute;left:0;right:0;display:flex;gap:9px;padding:0 12px;' +
      'pointer-events:auto;">' +
        shopBtn("upgrade", "arrow-big-up-dash", "Upgrade", "cost_up") +
        shopBtn("buyball", "plus", "New ball", "cost_ball") +
        '<button data-el="clear" style="pointer-events:auto;flex:1;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:3px;height:62px;border-radius:16px;' +
        'border:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.05);font-family:inherit;">' +
        svg("circle-x", 17, INK) +
        '<span style="font-size:9.5px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">' +
        "Clear</span></button>" +
      "</div>" +

      '<div data-el="sheet" style="position:absolute;left:0;right:0;bottom:0;max-height:76%;display:none;' +
      'background:linear-gradient(to bottom,rgba(9,9,20,0.72),rgba(6,6,14,0.97) 20%);' +
      '-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);z-index:9;pointer-events:auto;' +
      'border-top:1px solid rgba(255,255,255,0.07);border-radius:26px 26px 0 0;' +
      'padding:22px 20px 28px;overflow-y:auto;touch-action:pan-y;opacity:0;transform:translateY(24px);' +
      'transition:opacity 280ms ease, transform 360ms cubic-bezier(.2,.9,.25,1);">' +
        '<div style="max-width:330px;margin:0 auto;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
            '<div data-el="sheet_title" style="font-size:18px;font-weight:600;">Leaderboard</div>' +
            '<button data-el="sheet_close" style="pointer-events:auto;width:34px;height:34px;' +
            'border-radius:17px;border:0;background:rgba(255,255,255,0.1);color:' + INK + ';' +
            'font-size:17px;padding:0;font-family:inherit;">×</button>' +
          "</div>" +
          '<div data-el="sheet_body"></div>' +
        "</div>" +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const topBar = nodes.topBar, shop = nodes.shop;

    // ===================================================================== //
    // 7. Balls and physics                                                  //
    // ===================================================================== //
    const BALL_COLOURS = ["#00f3ff", "#39ff14", "#ffe600", "#ff43e0", "#ff3b3b", "#ff9a1f", "#ffffff"];

    function spawnBall(delayMs) {
      ctx.timeout(() => {
        if (balls.length >= MAXBALLS) return;
        const colour = BALL_COLOURS[(state.ballLevel - 1) % BALL_COLOURS.length];
        const mesh = new THREE.Mesh(ballGeo, ballMaterial(colour));
        mesh.position.z = 2;
        scene.add(mesh);
        const aura = new THREE.Mesh(auraGeo, auraMaterial(colour));
        aura.position.z = -2;
        scene.add(aura);
        const c = new THREE.Color(colour);
        balls.push({
          x: Math.random() * (W - 100) + 50, y: -20,
          vx: (Math.random() - 0.5) * 4, vy: 0,
          radius: BALL_RADIUS, colour: colour, rgb: [c.r, c.g, c.b],
          mesh: mesh, aura: aura, squash: 0,
          trail: [], spin: Math.random() * 6
        });
      }, delayMs || 0);
    }

    function dropBall(b) {
      scene.remove(b.mesh); scene.remove(b.aura);
      try { b.mesh.material.dispose(); b.aura.material.dispose(); } catch (_) {}
    }

    function distanceToSegment(p, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = a.x + t * dx, cy = a.y + t * dy;
      const ex = p.x - cx, ey = p.y - cy;
      return { distSq: ex * ex + ey * ey, cx: cx, cy: cy };
    }

    function checkCollisions() {
      const level = state.ballLevel;
      const maxV = Math.min(BALL_RADIUS * 1.5, BALL_RADIUS * (0.9 + level * 0.05));

      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];

        if (b.x - b.radius < 0) { b.x = b.radius; b.vx *= -0.8; }
        else if (b.x + b.radius > W) { b.x = W - b.radius; b.vx *= -0.8; }

        if (b.y > H + 100) {
          dropBall(b);
          balls.splice(i, 1);
          i--;
          spawnBall(500);
          continue;
        }

        if (Math.abs(b.vx) > maxV) b.vx = Math.sign(b.vx) * maxV;
        if (Math.abs(b.vy) > maxV) b.vy = Math.sign(b.vy) * maxV;

        let struck = null, strikeSpeed = 0;
        const minDist = b.radius + BAR_R;
        for (const s of bars) {
          const d = distanceToSegment(b, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by });
          if (d.distSq >= minDist * minDist) continue;

          let dist = Math.sqrt(d.distSq);
          if (dist <= 0) dist = 0.001;
          const nx = (b.x - d.cx) / dist;
          const ny = (b.y - d.cy) / dist;

          const overlap = minDist - dist;
          b.x += nx * overlap;
          b.y += ny * overlap;

          const dot = b.vx * nx + b.vy * ny;
          if (dot < 0) {
            strikeSpeed = Math.max(strikeSpeed, -dot);
            b.vx = b.vx - (1 + RESTITUTION) * dot * nx;
            b.vy = b.vy - (1 + RESTITUTION) * dot * ny;
            // A nudge, so a ball cannot settle into a perfect repeating orbit.
            const speedMult = 1 + level * 0.1;
            b.vx += (Math.random() - 0.5) * 1.5 * speedMult;
            b.vy -= 1 * speedMult;
            struck = s;
            b.squash = 1;
          }
        }

        if (struck) {
          const vel = Math.max(0.1, Math.min(1, strikeSpeed / 14));
          struck.flash = 1;
          barsDirty = true;
          ctx.platform.haptic("light");
          Sound.hit(struck.note, vel, (b.x / W) * 2 - 1);
          spawnRing(b.x, b.y, b.rgb);
          spawnSparks(b.x, b.y, b.rgb, 5 + Math.round(vel * 7));
          const earning = MONEY_PER_BOUNCE * level;
          addMoney(earning);
          spawnCoin(b.x, b.y);
        }
      }
    }

    function spawnRing(x, y, rgb) {
      if (rings.length >= RINGS) rings.shift();
      rings.push({ x: x, y: y, life: 1, r: 46, rgb: rgb });
    }

    function spawnSparks(x, y, rgb, n) {
      for (let i = 0; i < n; i++) {
        const k = spHead; spHead = (spHead + 1) % SP;
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * 180 + 40;
        spPos[k * 3] = x; spPos[k * 3 + 1] = y; spPos[k * 3 + 2] = 0;
        spVel[k * 2] = Math.cos(a) * sp;
        spVel[k * 2 + 1] = Math.sin(a) * sp;
        spCol[k * 3] = rgb[0]; spCol[k * 3 + 1] = rgb[1]; spCol[k * 3 + 2] = rgb[2];
        spLife[k] = 1;
      }
    }

    function spawnCoin(x, y) {
      if (coins.length >= COINS) coins.shift();
      coins.push({
        x: x, y: y, vx: (Math.random() - 0.5) * 90, vy: -150 - Math.random() * 70,
        t: 0, phase: 0
      });
    }

    // ===================================================================== //
    // 8. Shop                                                               //
    // ===================================================================== //
    let badgePop = 0;
    function addMoney(n) {
      state.money += n;
      state.lifetime += n;
      paintShop();
      submitPeak();
      remember();
    }

    function paintShop() {
      nodes.money.textContent = state.money;
      nodes.cost_up.textContent = "$" + state.upgradeCost;
      nodes.cost_ball.textContent = "$" + state.ballCost;
      const affordUp = state.money >= state.upgradeCost;
      const affordBall = state.money >= state.ballCost;
      nodes.upgrade.style.background = affordUp ? "rgba(255,212,92,0.16)" : "rgba(255,255,255,0.05)";
      nodes.upgrade.style.opacity = affordUp ? "1" : "0.5";
      nodes.buyball.style.background = affordBall ? "rgba(255,212,92,0.16)" : "rgba(255,255,255,0.05)";
      nodes.buyball.style.opacity = affordBall ? "1" : "0.5";
    }

    function popBadge() {
      badgePop = 1;
      nodes.badge.style.transform = "scale(1.12)";
      ctx.timeout(() => { nodes.badge.style.transform = "scale(1)"; }, 130);
    }

    function recolourBalls() {
      const colour = BALL_COLOURS[(state.ballLevel - 1) % BALL_COLOURS.length];
      const c = new THREE.Color(colour);
      for (const b of balls) {
        b.colour = colour;
        b.rgb = [c.r, c.g, c.b];
        b.mesh.material.uniforms.uC.value.set(colour);
        b.aura.material.uniforms.uC.value.set(colour);
      }
    }

    function doUpgrade() {
      if (state.money < state.upgradeCost) return;
      state.money -= state.upgradeCost;
      state.ballLevel += 1;
      state.upgradeCost = Math.floor(state.upgradeCost * 2.2);
      recolourBalls();
      paintShop();
      remember();
      Sound.fanfare(60);
      ctx.platform.haptic("medium");
      ctx.platform.milestone("ball_level_" + state.ballLevel);
    }

    function doBuyBall() {
      if (state.money < state.ballCost) return;
      state.money -= state.ballCost;
      state.ballsCount += 1;
      state.ballCost = Math.floor(state.ballCost * 2.5);
      spawnBall(0);
      paintShop();
      remember();
      Sound.coin();
      ctx.platform.haptic("medium");
    }

    // ===================================================================== //
    // 9. Board and music                                                    //
    // ===================================================================== //
    const records = ctx.memory && ctx.memory.record ? ctx.memory.record("earnings") : null;

    // Lifetime earnings only ever climb, so the board is submitted as it grows
    // rather than at some end that never comes. Throttled to whole hundreds so
    // an idle game does not hammer the channel on every bounce.
    let submitting = false;
    function submitPeak() {
      if (!records || submitting) return;
      if (state.lifetime < state.peakSubmitted + 100) return;
      submitting = true;
      state.peakSubmitted = state.lifetime;
      Promise.resolve(records.submit(state.lifetime, { label: "$" + state.lifetime }))
        .catch(() => {})
        .then(() => { submitting = false; });
    }

    function openSheet(title, html) {
      nodes.sheet_title.textContent = title;
      nodes.sheet_body.innerHTML = html;
      nodes.sheet.style.display = "block";
      // One tick before raising the opacity, so the transition actually runs
      // rather than being collapsed into the same style recalculation.
      ctx.timeout(() => {
        nodes.sheet.style.opacity = "1";
        nodes.sheet.style.transform = "translateY(0)";
      }, 16);
    }
    function closeSheet() {
      nodes.sheet.style.display = "none";
      nodes.sheet.style.opacity = "0";
      nodes.sheet.style.transform = "translateY(24px)";
    }

    async function showBoard() {
      openSheet("Peak Earnings",
        '<div style="color:' + DIM + ';padding:18px 0;text-align:center;">Loading…</div>');
      if (!records) {
        nodes.sheet_body.innerHTML = '<div style="color:' + DIM +
          ';padding:18px 0;text-align:center;">No leaderboard here.</div>';
        return;
      }
      try {
        const data = await records.leaderboard();
        const entries = (data && data.entries) || [];
        if (!entries.length) {
          nodes.sheet_body.innerHTML = '<div style="color:' + DIM +
            ';padding:18px 0;text-align:center;">Nobody has earned anything yet.<br>' +
            "Go bounce something.</div>";
          return;
        }
        let html = "";
        for (const e of entries) {
          const rank = e.rank || 0;
          const medal = rank === 1 ? "#ffd45c" : rank === 2 ? "#d1d5db" : rank === 3 ? "#d97706"
            : "rgba(255,255,255,0.12)";
          const fg = rank <= 3 ? "#111827" : INK;
          html += '<div style="display:flex;align-items:center;gap:11px;padding:9px 0;' +
            'border-bottom:1px solid rgba(255,255,255,0.07);">' +
            '<div style="width:26px;height:26px;border-radius:13px;background:' + medal + ";color:" + fg +
            ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;' +
            'flex-shrink:0;">' + rank + "</div>" +
            '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            (e.self ? "font-weight:600;color:" + GOLD + ";" : "") + '">' +
            ((e.user && e.user.handle) || "someone") + (e.self ? " (you)" : "") + "</div>" +
            '<div style="font-weight:700;color:' + GOLD + ';">' + (e.label || ("$" + e.value)) + "</div>" +
            "</div>";
        }
        nodes.sheet_body.innerHTML = html;
      } catch (_) {
        nodes.sheet_body.innerHTML = '<div style="color:#fca5a5;padding:18px 0;text-align:center;">' +
          "Could not reach the leaderboard.</div>";
      }
    }

    let music = null;
    function setBed(id) {
      state.bed = id;
      if (!ctx.capabilities.backgroundMusic || !ctx.music) return;
      try {
        if (id === "none") { ctx.music.stop({ fadeOutMs: 400 }); music = null; return; }
        ctx.music.unlock();
        music = ctx.music.play({ preset: id, volume: 0.26, intensity: 0.4 });
      } catch (_) { music = null; }
    }

    function showMusic() {
      let html = '<div style="font-size:12px;color:' + DIM + ';margin-bottom:12px;line-height:1.55;">' +
        "The bars are the melody — this is what plays under them. " +
        "The original's twelve tracks could not come across, since a bit cannot package audio; " +
        "these are Plethora's own generative beds instead.</div>";
      for (const b of BEDS) {
        const on = b.id === state.bed;
        html += '<button data-bed="' + b.id + '" style="pointer-events:auto;width:100%;text-align:left;' +
          "height:46px;border-radius:13px;border:1px solid " +
          (on ? "rgba(255,212,92,0.5)" : "rgba(255,255,255,0.08)") + ";" +
          "background:" + (on ? "rgba(255,212,92,0.13)" : "rgba(255,255,255,0.04)") + ";" +
          "color:" + (on ? GOLD : INK) + ';font-family:inherit;font-size:14px;font-weight:500;' +
          'padding:0 15px;margin-bottom:7px;display:flex;align-items:center;justify-content:space-between;">' +
          "<span>" + b.name + "</span>" + (on ? "<span>playing</span>" : "") + "</button>";
      }
      openSheet("Music", html);
      for (const btn of nodes.sheet_body.querySelectorAll("[data-bed]")) {
        ctx.listen(btn, "pointerdown", (e) => {
          e.preventDefault();
          setBed(btn.getAttribute("data-bed"));
          remember();
          showMusic();
          ctx.platform.haptic("light");
        });
      }
    }

    // ===================================================================== //
    // 10. Hands on it                                                       //
    // ===================================================================== //
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      Sound.init();
      Sound.resume();
      ctx.platform.start();
      nodes.hint.style.opacity = "0";
      setBed(state.bed);
    }

    function makeBar(ax, ay, bx, by) {
      const len = Math.hypot(bx - ax, by - ay);
      const note = noteForLength(len);
      return {
        ax: ax, ay: ay, bx: bx, by: by, note: note,
        // The bar's colour and its pitch are the same number, so you can read
        // the tune off the board before you hear it.
        hue: Math.max(0, Math.min(1, (note - 36) / 40)),
        flash: 1
      };
    }

    ctx.listen(view, "pointerdown", (e) => {
      firstGesture();
      Sound.resume();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      // A stroke is a straight bar: both ends start together, the far end
      // follows the finger.
      drawing = makeBar(e.offsetX, e.offsetY, e.offsetX, e.offsetY);
      barsDirty = true;
    });

    ctx.listen(view, "pointermove", (e) => {
      if (!drawing) return;
      drawing.bx = e.offsetX;
      drawing.by = e.offsetY;
      const len = Math.hypot(drawing.bx - drawing.ax, drawing.by - drawing.ay);
      drawing.note = noteForLength(len);
      drawing.hue = Math.max(0, Math.min(1, (drawing.note - 36) / 40));
      barsDirty = true;
    });

    let lastPreview = 0;
    function endStroke() {
      if (!drawing) return;
      const len = Math.hypot(drawing.bx - drawing.ax, drawing.by - drawing.ay);
      if (len > 6) {
        bars.push(drawing);
        if (bars.length > MAX_LINES) bars.shift();
        // Audition it, the way picking an instrument should always audition it.
        Sound.hit(drawing.note, 0.55, (drawing.ax / W) * 2 - 1);
        ctx.platform.haptic("light");
        ctx.platform.interact({ kind: "bar", note: drawing.note, length: Math.round(len) });
      }
      drawing = null;
      barsDirty = true;
    }
    ctx.listen(view, "pointerup", endStroke);
    ctx.listen(view, "pointercancel", endStroke);
    ctx.listen(view, "lostpointercapture", endStroke);

    const tap = (el, fn) => ctx.listen(el, "pointerdown", (e) => { e.preventDefault(); firstGesture(); fn(); });
    tap(nodes.upgrade, doUpgrade);
    tap(nodes.buyball, doBuyBall);
    tap(nodes.clear, () => { bars.length = 0; barsDirty = true; ctx.platform.haptic("light"); });
    tap(nodes.board_btn, showBoard);
    tap(nodes.music_btn, showMusic);
    ctx.listen(nodes.sheet_close, "pointerdown", (e) => { e.preventDefault(); closeSheet(); });

    // ===================================================================== //
    // 11. Remembering                                                       //
    // ===================================================================== //
    // ctx.storage.set() returns nothing on device, so .catch() on it throws.
    // This wrapper is the fix, and it is why the harness mocks storage
    // synchronously.
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
        fireAndForget(() => ctx.storage.set("bounce", {
          money: state.money, lifetime: state.lifetime, ballsCount: state.ballsCount,
          ballLevel: state.ballLevel, upgradeCost: state.upgradeCost,
          ballCost: state.ballCost, bed: state.bed
        }));
      }, 700);
    }
    if (canStore) {
      try {
        const s = await ctx.storage.get("bounce");
        if (s && typeof s === "object") {
          if (typeof s.money === "number") state.money = s.money;
          if (typeof s.lifetime === "number") state.lifetime = s.lifetime;
          if (typeof s.ballsCount === "number") state.ballsCount = Math.max(1, s.ballsCount);
          if (typeof s.ballLevel === "number") state.ballLevel = Math.max(1, s.ballLevel);
          if (typeof s.upgradeCost === "number") state.upgradeCost = s.upgradeCost;
          if (typeof s.ballCost === "number") state.ballCost = s.ballCost;
          if (BEDS.some((b) => b.id === s.bed)) state.bed = s.bed;
          state.peakSubmitted = state.lifetime;
        }
      } catch (_) { /* first run */ }
    }

    // ===================================================================== //
    // 12. Frame                                                             //
    // ===================================================================== //
    ctx.onDestroy(() => {
      Sound.close();
      try { ctx.music.stop({ fadeOutMs: 300 }); } catch (_) {}
      for (const b of balls) dropBall(b);
      for (const t of [rtScene, rtA, rtB]) { try { t.dispose(); } catch (_) {} }
      try { renderer.dispose(); } catch (_) {}
    });

    layout();
    paintShop();
    for (let i = 0; i < state.ballsCount; i++) spawnBall(i * 420);

    let clock = 0;

    function updateTrails() {
      let v = 0, tri = 0;
      for (const b of balls) {
        const pts = b.trail;
        if (pts.length < 2) continue;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const q = pts[Math.min(pts.length - 1, i + 1)];
          const r = pts[Math.max(0, i - 1)];
          let dx = q.x - r.x, dy = q.y - r.y;
          const l = Math.hypot(dx, dy) || 1;
          dx /= l; dy /= l;
          const t = i / (pts.length - 1);            // 0 oldest, 1 newest
          // Taper to nothing at the oldest end, or the tail stops in mid-air
          // with a visible hard edge.
          const wdt = b.radius * 0.62 * t * t;
          for (const s of [-1, 1]) {
            const o = v * 3;
            trPos[o] = p.x - dy * wdt * s;
            trPos[o + 1] = p.y + dx * wdt * s;
            trPos[o + 2] = 0;
            trAttr[v * 2] = t;
            trAttr[v * 2 + 1] = s;
            trCol[v * 3] = b.rgb[0]; trCol[v * 3 + 1] = b.rgb[1]; trCol[v * 3 + 2] = b.rgb[2];
            v++;
          }
          if (i > 0) {
            const q0 = v - 4;
            trIdx[tri++] = q0; trIdx[tri++] = q0 + 1; trIdx[tri++] = q0 + 2;
            trIdx[tri++] = q0 + 1; trIdx[tri++] = q0 + 3; trIdx[tri++] = q0 + 2;
          }
        }
      }
      for (const a of ["position", "aT", "aC"]) trGeo.attributes[a].needsUpdate = true;
      trGeo.index.needsUpdate = true;
      trGeo.setDrawRange(0, tri);
    }

    function updateRings(dt) {
      let v = 0, tri = 0;
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.life -= dt * 1.9;
        if (r.life <= 0) { rings.splice(i, 1); continue; }
        const s = r.r;
        const corners = [[-s, -s], [s, -s], [-s, s], [s, s]];
        for (let k = 0; k < 4; k++) {
          const o = (v + k) * 3;
          rgPos[o] = r.x + corners[k][0];
          rgPos[o + 1] = r.y + corners[k][1];
          rgPos[o + 2] = 0;
          rgUv[(v + k) * 2] = corners[k][0] > 0 ? 1 : 0;
          rgUv[(v + k) * 2 + 1] = corners[k][1] > 0 ? 1 : 0;
          rgLife[v + k] = r.life;
          rgCol[(v + k) * 3] = r.rgb[0];
          rgCol[(v + k) * 3 + 1] = r.rgb[1];
          rgCol[(v + k) * 3 + 2] = r.rgb[2];
        }
        rgIdx[tri++] = v; rgIdx[tri++] = v + 1; rgIdx[tri++] = v + 2;
        rgIdx[tri++] = v + 1; rgIdx[tri++] = v + 3; rgIdx[tri++] = v + 2;
        v += 4;
      }
      for (const a of ["position", "uv", "aLife", "aC"]) ringGeo.attributes[a].needsUpdate = true;
      ringGeo.index.needsUpdate = true;
      ringGeo.setDrawRange(0, tri);
    }

    function updateSparks(dt) {
      for (let i = 0; i < SP; i++) {
        if (spLife[i] <= 0) continue;
        spLife[i] -= dt * 2.1;
        if (spLife[i] < 0) spLife[i] = 0;
        spPos[i * 3] += spVel[i * 2] * dt;
        spPos[i * 3 + 1] += spVel[i * 2 + 1] * dt;
        spVel[i * 2 + 1] += 320 * dt;
      }
      spGeo.attributes.position.needsUpdate = true;
      spGeo.attributes.aLife.needsUpdate = true;
      spGeo.attributes.aC.needsUpdate = true;
      spGeo.setDrawRange(0, SP);
    }

    function updateCoins(dt) {
      // The badge sits at the top left; that is where the money is going.
      const tx = 46, ty = SAFE_T + 19;
      let v = 0, tri = 0;
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.t += dt;
        let a = 1, size = 15;
        if (c.t < 0.34) {
          // The toss.
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.vy += 900 * dt;
        } else {
          // The flight home, easing so it arrives rather than snaps.
          const k = Math.min(1, (c.t - 0.34) / 0.42);
          const e = k * k * (3 - 2 * k);
          c.x += (tx - c.x) * e * 0.32;
          c.y += (ty - c.y) * e * 0.32;
          size = 15 * (1 - e * 0.55);
          a = 1 - e * e;
          if (k >= 1) {
            coins.splice(i, 1);
            popBadge();
            continue;
          }
        }
        const corners = [[-size, -size], [size, -size], [-size, size], [size, size]];
        for (let k2 = 0; k2 < 4; k2++) {
          const o = (v + k2) * 3;
          cnPos[o] = c.x + corners[k2][0];
          cnPos[o + 1] = c.y + corners[k2][1];
          cnPos[o + 2] = 0;
          cnUv[(v + k2) * 2] = corners[k2][0] > 0 ? 1 : 0;
          // The coin texture is drawn top-down in a 2D canvas; GL uv is
          // bottom-up, so v is flipped here or the $ arrives upside down.
          cnUv[(v + k2) * 2 + 1] = corners[k2][1] > 0 ? 0 : 1;
          cnA[v + k2] = a;
        }
        cnIdx[tri++] = v; cnIdx[tri++] = v + 1; cnIdx[tri++] = v + 2;
        cnIdx[tri++] = v + 1; cnIdx[tri++] = v + 3; cnIdx[tri++] = v + 2;
        v += 4;
        if (v + 4 > COINS * 4) break;
      }
      for (const a of ["position", "uv", "aA"]) coinGeo.attributes[a].needsUpdate = true;
      coinGeo.index.needsUpdate = true;
      coinGeo.setDrawRange(0, tri);
    }

    function draw() {
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
      renderer.setRenderTarget(null);
    }

    draw();
    ctx.markVisualReady("board drawn");
    ctx.platform.ready();

    ctx.onFrame((dtMs) => {
      if (ctx.width !== W || ctx.height !== H) layout();
      const dt = Math.min(0.05, (dtMs > 100 ? 16 : dtMs) / 1000);
      clock += dt;

      // The original stepped per frame and clamped a huge stutter to one frame.
      const k = Math.min(3, (dtMs > 100 ? 16 : dtMs) / (1000 / 60));
      for (const b of balls) {
        b.vy += GRAVITY * k;
        b.x += b.vx * k;
        b.y += b.vy * k;
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > TRAIL) b.trail.shift();
        b.squash = Math.max(0, b.squash - dt * 5);
      }
      checkCollisions();

      // Bar flashes decay, and a decaying flash is a changed vertex attribute.
      let anyFlash = false;
      for (const s of bars) {
        if (s.flash > 0) { s.flash = Math.max(0, s.flash - dt * 3.4); anyFlash = true; }
      }
      if (anyFlash || barsDirty) rebuildBars();

      for (const b of balls) {
        // Squash along the direction of travel, which is what a ball hitting
        // something actually does.
        const sp = Math.hypot(b.vx, b.vy);
        const sq = b.squash * 0.35;
        b.mesh.position.set(b.x, b.y, 2);
        b.mesh.scale.set(b.radius * (1 + sq), b.radius * (1 - sq), b.radius);
        if (sp > 0.01) b.mesh.rotation.z = Math.atan2(b.vy, b.vx);
        b.aura.position.set(b.x, b.y, -2);
        const auraR = b.radius * (2.3 + b.squash * 1.2);
        b.aura.scale.set(auraR, auraR, 1);
      }

      updateTrails();
      updateRings(dt);
      updateSparks(dt);
      updateCoins(dt);

      backMat.uniforms.uTime.value = clock;
      backMat.uniforms.uAura.value = Math.min(1, (state.ballLevel - 1) * 0.16);
      compMat.uniforms.uTime.value = clock;

      draw();
    });
  }
};
