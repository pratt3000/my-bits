/**
 * Sketch Racer — draw the longest road you dare, then drop into it and drive.
 *
 * Drag one finger and a road unrolls under it, metering its own length as you
 * go. Hit RACE and the camera falls out of the sky, swings in behind the car
 * and follows it along every curve you drew until it crosses the chequered
 * flag at the far end.
 *
 * That fall is the whole idea of the presentation. You draw looking straight
 * down, where a perspective camera pointed at a flat plane behaves like an
 * orthographic one, so what you draw is exactly what you get. The moment you
 * race, the same camera eases down to a chase position and the flat sketch
 * becomes a road with a horizon. Nothing about the drawing changes; only where
 * you are standing.
 *
 * There is no skill in the driving — the car always finishes. The game is in
 * the drawing, and how much road you can fit into one gesture before you run
 * out of screen or patience. Finish in the global top five and the car turns to
 * diamond, which is cosmetic and entirely the point.
 *
 * ── Sound ────────────────────────────────────────────────────────────────
 * The engine is three detuned sawtooths through a lowpass whose cutoff and
 * pitch both track speed, plus a bandpassed noise layer for tyre roar and an
 * amplitude LFO that gives it a rough idle. It runs into the same master chain
 * everything else does — a convolution reverb built from generated noise, and
 * a limiter — so it sits in a space instead of buzzing in your ear.
 *
 * ── Picture ──────────────────────────────────────────────────────────────
 * three.js with a real bloom pass: scene to a render target, a bright-pass,
 * two separable blurs at quarter resolution, then an additive composite with a
 * filmic curve and grain. The road is emissive and the grid falls away into
 * fog, so the bloom has something to bite on.
 */
window.plethoraBit = {
  meta: {
    title: "Sketch Racer",
    runtime: "plethora-bit@2",
    tags: ["game", "drawing", "racing", "3d", "leaderboard"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Constants                                                          //
    // ===================================================================== //
    const ROAD_W = 22;             // half-width, world units, and world units are px
    // Every race is aimed at roughly the same watchable duration, whatever the
    // track length — a four-second sketch shouldn't give a one-second race that
    // is over before the camera has finished falling, and a screen-filling one
    // shouldn't drag. Speed is derived from length and clamped at both ends.
    const RACE_SECONDS = 6.5;
    const SPEED_MIN = 190, SPEED_MAX = 640;
    const MIN_LENGTH = 60;
    const ACCENT = "#ff6b5a";
    const DIAMOND_A = "#b2fefa", DIAMOND_B = "#0ed2f7";
    const INK = "#f4f2f8", DIM = "rgba(244,242,248,0.55)";

    const state = {
      mode: "draw",                // draw | racing | done
      path: [],                    // {x, y} in screen px
      length: 0,
      progress: 0,
      speed: 0,
      drawing: false,
      best: 0,
      diamondUnlocked: false,
      diamondEquipped: false,
      camBlend: 0,                 // 0 overhead, 1 chase
      targetSpeed: SPEED_MIN,
      orbit: 0,
      orbitMix: 0,
      shake: 0
    };

    // ===================================================================== //
    // 1. Sound                                                              //
    // ===================================================================== //
    const Sound = {
      ac: null, ready: false, bus: null, wet: null,
      engine: null,

      init() {
        if (this.ac) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = this.ac = new AC();

        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -9;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.2;

        const shelf = ac.createBiquadFilter();
        shelf.type = "highshelf";
        shelf.frequency.value = 6000;
        shelf.gain.value = -4;

        shelf.connect(limiter);
        limiter.connect(ac.destination);

        this.bus = ac.createGain();
        this.bus.gain.value = 0.9;
        this.bus.connect(shelf);

        const conv = ac.createConvolver();
        conv.buffer = this.impulse(2.2, 2.6);
        this.wet = ac.createGain();
        this.wet.gain.value = 0.3;
        this.wet.connect(conv);
        conv.connect(shelf);

        this.ready = true;
      },

      impulse(seconds, decay) {
        const rate = this.ac.sampleRate;
        const n = Math.floor(rate * seconds);
        const buf = this.ac.createBuffer(2, n, rate);
        for (let c = 0; c < 2; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < n; i++) {
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
          }
        }
        return buf;
      },

      noise(seconds) {
        const rate = this.ac.sampleRate;
        const n = Math.floor(rate * seconds);
        const buf = this.ac.createBuffer(1, n, rate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        return buf;
      },

      // A one-shot note, used for the pen and the finish chord.
      blip(freq, type, dur, vol, pan, when) {
        if (!this.ready) return;
        const ac = this.ac, t = (when || ac.currentTime);
        const osc = ac.createOscillator();
        osc.type = type || "triangle";
        osc.frequency.setValueAtTime(freq, t);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
        osc.connect(g);
        if (p) { p.pan.value = pan || 0; g.connect(p); p.connect(this.bus); p.connect(this.wet); }
        else { g.connect(this.bus); g.connect(this.wet); }
        try { osc.start(t); osc.stop(t + dur + 0.05); } catch (_) {}
      },

      /**
       * The engine. Three saws a few cents apart give it body; a lowpass that
       * opens with speed gives it effort; a noise bed gives it tyres; and a
       * slow amplitude LFO keeps it from sounding like a held chord.
       */
      startEngine() {
        if (!this.ready || this.engine) return;
        const ac = this.ac;
        const out = ac.createGain();
        out.gain.value = 0;

        const filt = ac.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = 320;
        filt.Q.value = 3.2;
        filt.connect(out);

        const oscs = [];
        for (let i = 0; i < 3; i++) {
          const o = ac.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = 52;
          o.detune.value = (i - 1) * 13;
          const g = ac.createGain();
          g.gain.value = 0.33;
          o.connect(g); g.connect(filt);
          try { o.start(); } catch (_) {}
          oscs.push(o);
        }

        // Tyre and wind: bandpassed noise that opens up with speed.
        const ns = ac.createBufferSource();
        ns.buffer = this.noise(2);
        ns.loop = true;
        const nf = ac.createBiquadFilter();
        nf.type = "bandpass";
        nf.frequency.value = 700;
        nf.Q.value = 0.7;
        const ng = ac.createGain();
        ng.gain.value = 0;
        ns.connect(nf); nf.connect(ng); ng.connect(out);
        try { ns.start(); } catch (_) {}

        // Roughness, so the idle is not a pure tone.
        const lfo = ac.createOscillator();
        lfo.frequency.value = 27;
        const lg = ac.createGain();
        lg.gain.value = 0.16;
        lfo.connect(lg); lg.connect(out.gain);
        try { lfo.start(); } catch (_) {}

        out.connect(this.bus);
        const wetTap = ac.createGain();
        wetTap.gain.value = 0.35;
        out.connect(wetTap); wetTap.connect(this.wet);

        this.engine = { out: out, filt: filt, oscs: oscs, ns: ns, ng: ng, lfo: lfo, nf: nf };
        out.gain.setValueAtTime(0.0001, ac.currentTime);
        out.gain.exponentialRampToValueAtTime(0.34, ac.currentTime + 0.35);
      },

      updateEngine(ratio) {
        if (!this.engine) return;
        const t = this.ac.currentTime;
        const r = Math.max(0, Math.min(1.4, ratio));
        for (const o of this.engine.oscs) {
          o.frequency.setTargetAtTime(48 + r * 96, t, 0.09);
        }
        this.engine.filt.frequency.setTargetAtTime(300 + r * 2100, t, 0.12);
        this.engine.ng.gain.setTargetAtTime(0.02 + r * 0.10, t, 0.15);
        this.engine.nf.frequency.setTargetAtTime(600 + r * 1900, t, 0.15);
      },

      stopEngine() {
        if (!this.engine) return;
        const e = this.engine, t = this.ac.currentTime;
        this.engine = null;
        e.out.gain.cancelScheduledValues(t);
        e.out.gain.setValueAtTime(Math.max(0.0001, e.out.gain.value), t);
        e.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        ctx.timeout(() => {
          for (const o of e.oscs) { try { o.stop(); } catch (_) {} }
          try { e.ns.stop(); } catch (_) {}
          try { e.lfo.stop(); } catch (_) {}
        }, 420);
      },

      finish() {
        if (!this.ready) return;
        const t = this.ac.currentTime;
        // A major triad arriving one note at a time.
        this.blip(523.25, "triangle", 0.5, 0.16, -0.3, t);
        this.blip(659.25, "triangle", 0.5, 0.15, 0.0, t + 0.09);
        this.blip(783.99, "triangle", 0.9, 0.16, 0.3, t + 0.18);
        this.blip(1046.5, "sine", 1.2, 0.10, 0.0, t + 0.28);
      },

      close() {
        this.stopEngine();
        if (this.ac) { try { this.ac.close(); } catch (_) {} }
        this.ac = null; this.ready = false;
      }
    };

    // ===================================================================== //
    // 2. Three                                                              //
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
        '<div><div style="font-size:19px;font-weight:700;margin-bottom:9px;">Sketch Racer</div>' +
        '<div style="font-size:13.5px;opacity:0.75;line-height:1.6;">This needs 3D, and it could not ' +
        "start here. Try opening it again in the Plethora app.</div></div></div>";
      ctx.platform.error({ where: "three_import" });
      ctx.platform.ready();
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(2, ctx.nativeDpr || 1));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x05050b, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05050b, 0.00085);

    const FOV = 52;
    const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 9000);

    // Looking straight down from this height, a perspective camera covers
    // exactly `padH` world units vertically — so drawing is one-to-one with
    // the screen and nothing you draw lands where you did not put it.
    let padTop = 0, padH = 1, camHeight = 1000;

    scene.add(new THREE.AmbientLight(0x404060, 1.4));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.5);
    key.position.set(0.4, 1, 0.25);
    scene.add(key);

    // ---- sky: a dome, because the chase camera spends most of its time
    // looking at the part of the screen that is above the horizon and a flat
    // clear colour leaves the top half of the phone dead ------------------
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { uAccent: { value: new THREE.Color(ACCENT) }, uTime: { value: 0 } },
      vertexShader: [
        "varying vec3 vD;",
        "void main(){ vD = normalize(position);",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec3 vD; uniform vec3 uAccent; uniform float uTime;",
        "float h(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}",
        "void main(){",
        "  float y = clamp(vD.y, -1.0, 1.0);",
        // Deep blue overhead falling to a thin warm band exactly at the horizon.
        "  vec3 c = mix(vec3(0.035,0.038,0.075), vec3(0.006,0.006,0.016), smoothstep(0.0,0.55,y));",
        "  float band = exp(-pow(y/0.055, 2.0));",
        "  c += uAccent * band * 0.14;",
        "  c += vec3(0.10,0.13,0.30) * exp(-pow((y-0.10)/0.22, 2.0)) * 0.5;",
        // Sparse stars, only well above the horizon so they never sit on the grid.
        "  vec2 sp = floor(vD.xz * 240.0 + vD.y * 40.0);",
        "  float st = step(0.9975, h(sp));",
        "  float tw = 0.6 + 0.4*sin(uTime*2.0 + h(sp+7.0)*30.0);",
        "  c += vec3(0.8,0.85,1.0) * st * tw * smoothstep(0.06, 0.4, y) * 0.55;",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n"),
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 20), skyMat);
    sky.frustumCulled = false;
    scene.add(sky);

    // ---- ground: a grid that dissolves into the fog ----------------------
    const groundMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 },
                  uAccent: { value: new THREE.Color(ACCENT) } },
      vertexShader: [
        "varying vec3 vW;",
        "void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;",
        "  gl_Position = projectionMatrix * viewMatrix * w; }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec3 vW;",
        "uniform float uTime; uniform float uFade; uniform vec3 uAccent;",
        "float grid(vec2 p, float s){",
        "  vec2 g = abs(fract(p/s - 0.5) - 0.5) / fwidth(p/s);",
        "  return 1.0 - min(min(g.x,g.y), 1.0);",
        "}",
        "void main(){",
        "  float fine = grid(vW.xz, 60.0) * 0.30;",
        "  float big  = grid(vW.xz, 300.0) * 0.55;",
        "  float dc = distance(vW, cameraPosition);",
        "  float fade = exp(-dc*0.00062);",
        "  vec3 c = vec3(0.16,0.20,0.42) * (fine + big) * fade;",
        "  c += vec3(0.02,0.022,0.05) * fade;",
        // The far grid has to arrive at the colour the sky has just above the
        // horizon, or the two meet as a hard line straight across the screen.
        "  vec3 haze = vec3(0.055,0.050,0.105) + uAccent*0.095;",
        "  c = mix(haze, c, fade);",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n"),
      extensions: { derivatives: true }
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    scene.add(ground);

    // ---- the road --------------------------------------------------------
    const MAXP = 4000;
    const roadGeo = new THREE.BufferGeometry();
    const rPos = new Float32Array(MAXP * 2 * 3);
    const rUv = new Float32Array(MAXP * 2 * 2);
    const rIdx = new Uint32Array(MAXP * 6);
    roadGeo.setAttribute("position", new THREE.BufferAttribute(rPos, 3));
    roadGeo.setAttribute("uv", new THREE.BufferAttribute(rUv, 2));
    roadGeo.setIndex(new THREE.BufferAttribute(rIdx, 1));
    roadGeo.setDrawRange(0, 0);

    const roadMat = new THREE.ShaderMaterial({
      uniforms: {
        uAccent: { value: new THREE.Color(ACCENT) },
        uHead: { value: 0 },        // how far the car has got, 0..1
        uLen: { value: 1 },         // total track length, world units
        uTime: { value: 0 }
      },
      vertexShader: [
        "varying vec2 vUv; varying vec3 vW;",
        "void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;",
        "  gl_Position = projectionMatrix * viewMatrix * w; }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec2 vUv; varying vec3 vW;",
        "uniform vec3 uAccent; uniform float uHead; uniform float uLen; uniform float uTime;",
        "void main(){",
        "  float edge = abs(vUv.x - 0.5) * 2.0;",
        // Bright rails down both edges, a dark surface between, and a dashed
        // centre line — the road reads as a road even in silhouette.
        "  float rail = smoothstep(0.86, 1.0, edge);",
        "  float shoulder = smoothstep(0.62, 0.88, edge);",
        "  float centre = smoothstep(0.10, 0.0, edge) * step(0.5, fract(vUv.y*46.0));",
        // Asphalt, not a flat fill: value noise at two scales so the surface
        // has grain when the camera is right down on it.
        "  vec2 gp = vec2(vUv.x*30.0, vUv.y*900.0);",
        "  float g = fract(sin(dot(floor(gp),vec2(12.9898,78.233)))*43758.5453);",
        "  float g2 = fract(sin(dot(floor(gp*0.25),vec2(39.3468,11.135)))*24634.6345);",
        "  vec3 surface = vec3(0.052,0.055,0.078) * (0.72 + 0.34*g + 0.22*g2);",
        "  vec3 c = surface * (1.0 - shoulder*0.45) + uAccent*rail*0.95",
        "        + vec3(0.72,0.76,0.92)*centre*0.42;",
        // A lead marker running ahead of the car. This has to be measured in
        // world units, not in fractions of the track: as a fraction it was a
        // tenth of the whole road, which from the chase camera is everything
        // you can see — the entire surface came out accent-red.
        "  float ahead = (vUv.y - uHead) * uLen;",
        "  float pulse = exp(-pow((ahead - 130.0)/70.0, 2.0));",
        "  c += uAccent * pulse * 0.30;",
        // Fade into the haze rather than stopping at a hard edge in mid-air.
        "  float dc = distance(vW, cameraPosition);",
        "  float rf = exp(-max(0.0, dc-420.0)*0.0016);",
        "  c = mix(vec3(0.055,0.050,0.105) + uAccent*0.095, c, rf);",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n"),
      side: THREE.DoubleSide
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.frustumCulled = false;
    scene.add(road);

    // A soft glow ribbon slightly above the road, purely for the bloom to grab.
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { uAccent: { value: new THREE.Color(ACCENT) } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: [
        "precision highp float; varying vec2 vUv; uniform vec3 uAccent;",
        "void main(){",
        "  float e = abs(vUv.x - 0.5)*2.0;",
        // Hug the rails. smoothstep(1.0, 0.55, e) is backwards — it peaks at the
        // centre of the road, which additively washed the whole surface red.
        "  float a = smoothstep(0.70, 1.0, e) * 0.30;",
        "  gl_FragColor = vec4(uAccent, a);",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const glow = new THREE.Mesh(roadGeo, glowMat);
    glow.frustumCulled = false;
    glow.position.y = 1.5;
    scene.add(glow);

    // ---- the car ---------------------------------------------------------
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ACCENT), roughness: 0.34, metalness: 0.25,
      emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.28
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(20, 9, 34), bodyMat);
    body.position.y = 7;
    car.add(body);
    // A nose that tapers, so the car has a front even at chase distance.
    const nose = new THREE.Mesh(new THREE.BoxGeometry(17, 5.5, 9), bodyMat);
    nose.position.set(0, 5.6, 20);
    car.add(nose);
    // Wheels. Four dark cylinders read as a car from behind far better than a
    // box floating a few units off the road does.
    const tyreMat = new THREE.MeshStandardMaterial({
      color: 0x0b0c14, roughness: 0.92, metalness: 0.0
    });
    const tyreGeo = new THREE.CylinderGeometry(5.2, 5.2, 4.2, 14);
    const wheels = [];
    for (const sx of [-11, 11]) {
      for (const sz of [-11, 12]) {
        const w = new THREE.Mesh(tyreGeo, tyreMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(sx, 5.2, sz);
        car.add(w);
        wheels.push(w);
      }
    }
    // Rear light bar.
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3324 });
    const tail = new THREE.Mesh(new THREE.BoxGeometry(16, 2.4, 1.5), tailMat);
    tail.position.set(0, 9.5, -17.3);
    car.add(tail);
    // Dark glass. A metallic MeshStandardMaterial with no environment map has
    // nothing to reflect and renders as a black hole, which is exactly what the
    // cabin looked like; a fresnel rim gives it an edge to catch instead.
    const cabinMat = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(0x8fb4ff) } },
      vertexShader: [
        "varying vec3 vN; varying vec3 vV;",
        "void main(){ vN = normalize(normalMatrix*normal);",
        "  vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz;",
        "  gl_Position = projectionMatrix*mv; }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec3 vN; varying vec3 vV; uniform vec3 uTint;",
        "void main(){",
        "  float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.6);",
        "  vec3 c = mix(vec3(0.028,0.034,0.072), uTint, f*0.85);",
        "  c += uTint * 0.08 * max(0.0, normalize(vN).y);",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n")
    });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(15, 8, 15), cabinMat);
    cabin.position.set(0, 14, -1);
    car.add(cabin);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    for (const sx of [-6.5, 6.5]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 2), lampMat);
      lamp.position.set(sx, 7, 17.5);
      car.add(lamp);
    }
    // A pool of light under the car. A flat plane shows its own rectangle, so
    // this falls off radially and never draws an edge.
    const glowUnder = new THREE.Mesh(
      new THREE.PlaneGeometry(58, 74),
      new THREE.ShaderMaterial({
        uniforms: { uAccent: { value: new THREE.Color(ACCENT) } },
        vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: [
          "precision highp float; varying vec2 vUv; uniform vec3 uAccent;",
          "void main(){ float d = length((vUv-0.5)*2.0);",
          "  float a = smoothstep(1.0, 0.05, d); a *= a;",
          "  gl_FragColor = vec4(uAccent, a*0.34); }"
        ].join("\n"),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    glowUnder.rotation.x = -Math.PI / 2;
    glowUnder.position.y = 1.2;
    car.add(glowUnder);
    scene.add(car);

    // ---- the flag --------------------------------------------------------
    const flag = new THREE.Group();
    const chequer = (() => {
      const c = new THREE.CanvasTexture(makeChequer());
      c.colorSpace = THREE.SRGBColorSpace;
      c.magFilter = THREE.NearestFilter;
      return c;
    })();
    function makeChequer() {
      const size = 64;
      const cv = ctx.createCanvas2D();
      cv.style.display = "none";
      cv.width = size; cv.height = size;
      const g2 = cv.getContext("2d");
      const n = 8, s = size / n;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          g2.fillStyle = (x + y) % 2 ? "#ffffff" : "#111111";
          g2.fillRect(x * s, y * s, s, s);
        }
      }
      return cv;
    }
    const flagPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W * 2.6, 15),
      // Pure white chequers sit above the bright-pass threshold and bloom into
      // a lamp. Knocked back, the banner stays a banner.
      new THREE.MeshBasicMaterial({ map: chequer, color: 0x9aa0b0, side: THREE.DoubleSide })
    );
    flagPanel.position.y = 48;
    flag.add(flagPanel);
    const postMat = new THREE.MeshBasicMaterial({ color: 0x1b1f30 });
    for (const sx of [-ROAD_W * 1.28, ROAD_W * 1.28]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(2.6, 56, 2.6), postMat);
      post.position.set(sx, 28, 0);
      flag.add(post);
    }
    scene.add(flag);

    // ---- sparks ----------------------------------------------------------
    const SP = 500;
    const spPos = new Float32Array(SP * 3);
    const spLife = new Float32Array(SP);
    const spVel = new Float32Array(SP * 3);
    let spHead = 0;
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    spGeo.setAttribute("aLife", new THREE.BufferAttribute(spLife, 1));
    const spMat = new THREE.ShaderMaterial({
      uniforms: { uDpr: { value: renderer.getPixelRatio() }, uColor: { value: new THREE.Color(ACCENT) } },
      vertexShader: [
        "attribute float aLife; varying float vLife; uniform float uDpr;",
        "void main(){ vLife=aLife; vec4 mv = modelViewMatrix*vec4(position,1.0);",
        "  gl_PointSize = (90.0*uDpr*aLife) / max(1.0, -mv.z);",
        "  gl_Position = projectionMatrix*mv; }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying float vLife; uniform vec3 uColor;",
        "void main(){ float d=length(gl_PointCoord-0.5)*2.0;",
        "  float a=smoothstep(1.0,0.0,d); gl_FragColor=vec4(uColor, a*a*vLife); }"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const sparks = new THREE.Points(spGeo, spMat);
    sparks.frustumCulled = false;
    scene.add(sparks);

    function spark(x, y, z, n, spread) {
      for (let i = 0; i < n; i++) {
        const k = spHead; spHead = (spHead + 1) % SP;
        spPos[k * 3] = x; spPos[k * 3 + 1] = y; spPos[k * 3 + 2] = z;
        spVel[k * 3] = (Math.random() - 0.5) * spread;
        spVel[k * 3 + 1] = Math.random() * spread * 0.8 + 20;
        spVel[k * 3 + 2] = (Math.random() - 0.5) * spread;
        spLife[k] = 1;
      }
    }

    // ===================================================================== //
    // 3. Bloom                                                              //
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
        "  gl_FragColor=vec4(c*smoothstep(0.55,1.05,l),1.0); }"
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
      uniforms: { tScene: { value: null }, tBloom: { value: null }, uAmount: { value: 0.72 }, uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uAmount; uniform float uTime;",
        "float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}",
        "void main(){ vec3 c=texture2D(tScene,vUv).rgb + texture2D(tBloom,vUv).rgb*uAmount;",
        "  c=(c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);",
        "  float v = 1.0 - length(vUv-0.5)*0.55; c *= v;",
        "  c += (hash(vUv*1024.0+fract(uTime))-0.5)*0.014;",
        "  gl_FragColor=vec4(clamp(c,0.0,1.0),1.0); }"
      ].join("\n"), depthTest: false, depthWrite: false
    });
    function pass(mat, target) {
      passQuad.material = mat;
      renderer.setRenderTarget(target || null);
      renderer.render(passScene, quadCam);
    }

    // ===================================================================== //
    // 4. Layout and the screen↔world map                                    //
    // ===================================================================== //
    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();

      padTop = SAFE_T + 96;
      padH = Math.max(140, H - padTop - 128 - SAFE_B);
      // Height at which the vertical field of view spans exactly the whole
      // screen in world units, so 1 world unit == 1 CSS pixel when overhead.
      camHeight = (H / 2) / Math.tan((FOV * Math.PI / 180) / 2);

      const dpr = renderer.getPixelRatio();
      rtScene.setSize(Math.max(1, Math.floor(W * dpr)), Math.max(1, Math.floor(H * dpr)));
      const bw = Math.max(1, Math.floor(W * dpr * 0.25));
      const bh = Math.max(1, Math.floor(H * dpr * 0.25));
      rtA.setSize(bw, bh); rtB.setSize(bw, bh);
      blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
      spMat.uniforms.uDpr.value = dpr;

      hud.style.top = SAFE_T + "px";
      dock.style.bottom = SAFE_B + "px";
    }

    // Screen px → world. The world origin sits under the screen centre.
    const toWorldX = (px) => px - W / 2;
    const toWorldZ = (py) => py - H / 2;

    // ===================================================================== //
    // 5. Road geometry                                                      //
    // ===================================================================== //
    let roadDirty = true;
    const cum = [];                 // cumulative length at each point

    function rebuildRoad() {
      const pts = state.drawing ? state.path : state.path;
      let v = 0, tri = 0;
      cum.length = 0;
      let total = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        cum.push(total);
      }
      state.length = total;

      for (let i = 0; i < pts.length && v + 2 <= MAXP * 2; i++) {
        const p = pts[i];
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.y - a.y;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        const nx = -dz * ROAD_W, nz = dx * ROAD_W;
        const t = total > 0 ? cum[i] / total : 0;
        for (const s of [-1, 1]) {
          const o = v * 3;
          rPos[o] = toWorldX(p.x) + nx * s;
          rPos[o + 1] = 0;
          rPos[o + 2] = toWorldZ(p.y) + nz * s;
          rUv[v * 2] = s < 0 ? 0 : 1;
          rUv[v * 2 + 1] = t;
          v++;
        }
        if (i > 0) {
          const q = v - 4;
          rIdx[tri++] = q; rIdx[tri++] = q + 1; rIdx[tri++] = q + 2;
          rIdx[tri++] = q + 1; rIdx[tri++] = q + 3; rIdx[tri++] = q + 2;
        }
      }
      roadGeo.attributes.position.needsUpdate = true;
      roadGeo.attributes.uv.needsUpdate = true;
      roadGeo.index.needsUpdate = true;
      roadGeo.setDrawRange(0, tri);

      if (pts.length > 1) {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        flag.position.set(toWorldX(last.x), 0, toWorldZ(last.y));
        flag.rotation.y = Math.atan2(last.x - prev.x, last.y - prev.y);
        flag.visible = true;
      } else {
        flag.visible = false;
      }
      roadDirty = false;
    }

    // Position and heading a given distance along the path, in world space.
    const pos = new THREE.Vector3();
    function sampleAt(dist, out) {
      const pts = state.path;
      if (pts.length < 2) { out.set(0, 0, 0); return 0; }
      let i = 1;
      while (i < cum.length - 1 && cum[i] < dist) i++;
      const c0 = cum[i - 1], c1 = cum[i];
      const t = c1 > c0 ? (dist - c0) / (c1 - c0) : 0;
      const a = pts[i - 1], b = pts[i];
      out.set(
        toWorldX(a.x + (b.x - a.x) * t), 0,
        toWorldZ(a.y + (b.y - a.y) * t)
      );
      return Math.atan2(b.x - a.x, b.y - a.y);
    }

    // ===================================================================== //
    // 6. Interface                                                          //
    // ===================================================================== //
    const svg = (d, size, colour, fill) =>
      '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="' + (fill || "none") +
      '" stroke="' + colour + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'style="display:block;pointer-events:none;">' + d + "</svg>";
    const I_FLAG = '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.3 2q2 0 3.1-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.5"/>';
    const I_TRASH = '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';
    const I_CUP = '<path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M4 22h16"/><path d="M10 14.7V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.7V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/>';

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ";color:" + INK + ";" +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      '<div data-el="hud" style="position:absolute;left:0;right:0;text-align:center;">' +
        '<div data-el="hudlabel" style="font-size:10px;letter-spacing:3.6px;' +
        'text-transform:uppercase;color:' + DIM + ';">Track length</div>' +
        '<div data-el="dist" style="font-size:46px;font-weight:300;letter-spacing:-2px;line-height:1.05;' +
        'font-variant-numeric:tabular-nums;">0.0<span style="font-size:20px;font-weight:500;' +
        'letter-spacing:0;">m</span></div>' +
        '<div data-el="best" style="font-size:11px;color:' + DIM + ';letter-spacing:0.6px;"></div>' +
      "</div>" +

      '<div data-el="hint" style="position:absolute;left:0;right:0;top:52%;text-align:center;' +
      'pointer-events:none;transition:opacity 600ms cubic-bezier(.2,.7,.3,1);">' +
        '<div style="font-size:15px;font-weight:500;">Draw a road</div>' +
        '<div style="font-size:12.5px;color:' + DIM + ';margin-top:6px;">one finger, as long as you dare</div>' +
      "</div>" +

      '<div data-el="dock" style="position:absolute;left:0;right:0;display:flex;align-items:center;' +
      'justify-content:center;gap:10px;padding:0 18px;">' +
        '<button data-el="race" style="pointer-events:auto;display:none;align-items:center;gap:9px;' +
        'height:56px;padding:0 30px;border-radius:28px;border:0;background:' + ACCENT + ';color:#20060a;' +
        'font-family:inherit;font-size:15px;font-weight:700;letter-spacing:1.4px;' +
        'box-shadow:0 10px 30px rgba(255,107,90,0.4);transition:transform 160ms cubic-bezier(.2,.7,.3,1);">' +
        svg(I_FLAG, 18, "#20060a") + "<span>RACE</span></button>" +
        '<button data-el="clear" style="pointer-events:auto;display:none;width:56px;height:56px;' +
        'border-radius:28px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);' +
        'align-items:center;justify-content:center;padding:0;">' + svg(I_TRASH, 18, INK) + "</button>" +
        '<button data-el="boardbtn" style="pointer-events:auto;display:flex;width:56px;height:56px;' +
        'border-radius:28px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);' +
        'align-items:center;justify-content:center;padding:0;">' + svg(I_CUP, 18, INK) + "</button>" +
      "</div>" +

      // A sheet that rises from the bottom rather than a full-screen scrim: the
      // car is parked at the flag behind it, and covering that up throws away
      // the only moment you get to see the thing you just unlocked.
      '<div data-el="sheet" style="position:absolute;left:0;right:0;bottom:0;max-height:78%;display:none;' +
      'background:linear-gradient(to bottom,rgba(9,9,17,0.72),rgba(7,7,14,0.97) 22%);' +
      '-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);z-index:9;pointer-events:auto;' +
      'border-top:1px solid rgba(255,255,255,0.07);border-radius:26px 26px 0 0;' +
      'padding:26px 22px 30px;overflow-y:auto;touch-action:pan-y;opacity:0;' +
      'transform:translateY(26px);transition:opacity 300ms ease, transform 380ms cubic-bezier(.2,.9,.25,1);">' +
        '<div style="max-width:330px;margin:0 auto;">' +
          '<div data-el="sheet_head" style="text-align:center;margin-bottom:22px;"></div>' +
          '<div data-el="sheet_body"></div>' +
          '<button data-el="sheet_close" style="pointer-events:auto;width:100%;height:52px;margin-top:20px;' +
          'border-radius:26px;border:0;background:rgba(255,255,255,0.1);color:' + INK + ';font-family:inherit;' +
          'font-size:14px;font-weight:600;letter-spacing:1px;">CLOSE</button>' +
        "</div>" +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const hud = nodes.hud, dock = nodes.dock;

    const metres = (u) => u / 10;
    function showDist(m) {
      nodes.dist.innerHTML = m.toFixed(1) +
        '<span style="font-size:20px;font-weight:500;letter-spacing:0;">m</span>';
    }
    function showBest() {
      nodes.best.textContent = state.best > 0 ? "best " + metres(state.best).toFixed(1) + "m" : "";
    }

    // ===================================================================== //
    // 7. Race                                                               //
    // ===================================================================== //
    const records = ctx.memory && ctx.memory.record ? ctx.memory.record("distance") : null;

    function resetGame() {
      state.mode = "draw";
      state.path.length = 0;
      state.length = 0;
      state.progress = 0;
      state.speed = 0;
      state.camBlend = 0;
      state.drawing = false;
      cum.length = 0;
      roadDirty = true;
      showDist(0);
      nodes.hudlabel.textContent = "Track length";
      nodes.hint.style.opacity = "1";
      nodes.race.style.display = "none";
      nodes.clear.style.display = "none";
      nodes.boardbtn.style.display = "flex";
      nodes.sheet.style.display = "none";
      nodes.sheet.style.transform = "translateY(26px)";
      Sound.stopEngine();
    }

    function startRace() {
      if (state.path.length < 2) return;
      state.mode = "racing";
      state.orbit = 0;
      state.orbitMix = 0;
      state.progress = 0;
      state.speed = 0;
      nodes.hudlabel.textContent = "Distance";
      state.targetSpeed = Math.max(SPEED_MIN,
        Math.min(SPEED_MAX, state.length / RACE_SECONDS));
      nodes.race.style.display = "none";
      nodes.clear.style.display = "none";
      nodes.boardbtn.style.display = "none";
      nodes.hint.style.opacity = "0";
      Sound.startEngine();
      ctx.platform.interact({ kind: "race", metres: +metres(state.length).toFixed(1) });
    }

    async function finishRace() {
      state.mode = "done";
      Sound.stopEngine();
      Sound.finish();
      ctx.platform.haptic("success");
      state.shake = 0.35;
      const m = metres(state.length);
      const best = m > metres(state.best);
      if (best) { state.best = state.length; remember(); }
      showBest();

      let head =
        '<div style="font-size:10px;letter-spacing:3.4px;text-transform:uppercase;color:' + DIM + ';">' +
        (best ? "New best" : "Finished") + "</div>" +
        '<div style="font-size:54px;font-weight:300;letter-spacing:-2.5px;line-height:1.1;margin-top:4px;' +
        'font-variant-numeric:tabular-nums;">' + m.toFixed(1) +
        '<span style="font-size:22px;font-weight:500;letter-spacing:0;">m</span></div>';
      nodes.sheet_head.innerHTML = head;
      nodes.sheet_body.innerHTML =
        '<div style="color:' + DIM + ';text-align:center;padding:14px 0;">Submitting…</div>';
      openSheet();
      ctx.platform.complete({ metres: +m.toFixed(1) });

      if (records) {
        try {
          await records.submit(+m.toFixed(1), { label: m.toFixed(1) + "m" });
          const data = await records.leaderboard();
          const entries = (data && data.entries) || [];
          const top5 = entries.slice(0, 5);
          const inTop5 = top5.length < 5 || top5.some((e) => e.self) ||
            (+m.toFixed(1)) >= ((top5[top5.length - 1] || {}).value || 0);
          if (inTop5 && !state.diamondUnlocked) {
            state.diamondUnlocked = true;
            state.diamondEquipped = true;
            applyDiamond();
            remember();
            ctx.platform.milestone("diamond_unlocked");
          }
          renderBoard(entries);
        } catch (_) {
          nodes.sheet_body.innerHTML =
            '<div style="color:#fca5a5;text-align:center;padding:14px 0;">Could not reach the leaderboard.</div>';
        }
      } else {
        nodes.sheet_body.innerHTML = "";
      }
      nodes.sheet_close.textContent = "DRAW ANOTHER";
    }

    function renderBoard(entries) {
      if (!entries.length) {
        nodes.sheet_body.innerHTML = '<div style="color:' + DIM + ';text-align:center;padding:14px 0;">' +
          "Nobody has drawn a road yet.<br>Yours goes up first.</div>";
        return;
      }
      let html = "";
      if (state.diamondUnlocked) {
        html += '<div style="text-align:center;font-size:12px;color:' + DIAMOND_A + ';margin-bottom:14px;' +
          'letter-spacing:0.8px;">◆ diamond car unlocked</div>';
      }
      for (const e of entries.slice(0, 10)) {
        const rank = e.rank || 0;
        const medal = rank === 1 ? "#ffd93d" : rank === 2 ? "#d4d4d8" : rank === 3 ? "#d97706" : "rgba(255,255,255,0.1)";
        const fg = rank <= 3 ? "#17151f" : DIM;
        html +=
          '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;' +
          'border-bottom:1px solid rgba(255,255,255,0.06);">' +
          '<div style="width:24px;height:24px;border-radius:12px;background:' + medal + ";color:" + fg + ";" +
          'display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;' +
          'flex-shrink:0;">' + rank + "</div>" +
          '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;' +
          (e.self ? "color:" + ACCENT + ";font-weight:600;" : "") + '">' +
          ((e.user && e.user.handle) || "Ghost Racer") + (e.self ? " (you)" : "") + "</div>" +
          '<div style="font-weight:600;font-variant-numeric:tabular-nums;">' +
          (e.label || (e.value + "m")) + "</div></div>";
      }
      nodes.sheet_body.innerHTML = html;
    }

    function openSheet() {
      nodes.sheet.style.display = "block";
      // One tick before raising the opacity, so the transition actually runs
      // rather than being collapsed into the same style recalculation.
      ctx.timeout(() => {
        nodes.sheet.style.opacity = "1";
        nodes.sheet.style.transform = "translateY(0)";
      }, 16);
    }

    async function showBoard() {
      nodes.sheet_head.innerHTML =
        '<div style="font-size:10px;letter-spacing:3.4px;text-transform:uppercase;color:' + DIM + ';">' +
        "Leaderboard</div><div style=\"font-size:26px;font-weight:500;margin-top:3px;\">Longest Track</div>";
      nodes.sheet_body.innerHTML = '<div style="color:' + DIM + ';text-align:center;padding:14px 0;">Loading…</div>';
      nodes.sheet_close.textContent = "CLOSE";
      openSheet();
      if (!records) {
        nodes.sheet_body.innerHTML = '<div style="color:' + DIM + ';text-align:center;padding:14px 0;">' +
          "No leaderboard here.</div>";
        return;
      }
      try { renderBoard(((await records.leaderboard()) || {}).entries || []); }
      catch (_) {
        nodes.sheet_body.innerHTML = '<div style="color:#fca5a5;text-align:center;padding:14px 0;">' +
          "Could not reach the leaderboard.</div>";
      }
    }

    function applyDiamond() {
      if (!state.diamondEquipped) return;
      bodyMat.color.set(DIAMOND_A);
      bodyMat.emissive.set(DIAMOND_B);
      bodyMat.emissiveIntensity = 0.6;
      // Not metalness: with no environment map there is nothing to reflect and
      // a metallic body renders black. Brightness has to come from emissive.
      bodyMat.roughness = 0.18;
      glowUnder.material.uniforms.uAccent.value.set(DIAMOND_B);
      glowMat.uniforms.uAccent.value.set(DIAMOND_B);
      cabinMat.uniforms.uTint.value.set(DIAMOND_A);
      tailMat.color.set(DIAMOND_A);
      spMat.uniforms.uColor.value.set(DIAMOND_B);
    }

    // ===================================================================== //
    // 8. Input                                                              //
    // ===================================================================== //
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      Sound.init();
      ctx.platform.start();
    }

    ctx.listen(view, "pointerdown", (e) => {
      if (state.mode !== "draw") return;
      firstGesture();
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (_) {} }
      state.drawing = true;
      state.path.length = 0;
      state.path.push({ x: e.offsetX, y: e.offsetY });
      nodes.hint.style.opacity = "0";
      nodes.race.style.display = "none";
      nodes.clear.style.display = "none";
      roadDirty = true;
    });

    let penAcc = 0;
    ctx.listen(view, "pointermove", (e) => {
      if (!state.drawing || state.mode !== "draw") return;
      const last = state.path[state.path.length - 1];
      const d = Math.hypot(e.offsetX - last.x, e.offsetY - last.y);
      if (d < 7) return;              // thin the samples; the road reads the same
      state.path.push({ x: e.offsetX, y: e.offsetY });
      roadDirty = true;
      rebuildRoad();
      showDist(metres(state.length));
      // A quiet tick every so often as the road unrolls — drawing should feel
      // like it is making something, not like moving a cursor.
      penAcc += d;
      if (penAcc > 90) {
        penAcc = 0;
        Sound.blip(1400 + Math.random() * 500, "sine", 0.05, 0.028,
                   (e.offsetX / W) * 1.6 - 0.8);
      }
    });

    const endDraw = () => {
      if (!state.drawing) return;
      state.drawing = false;
      rebuildRoad();
      if (state.path.length >= 2 && state.length >= MIN_LENGTH) {
        nodes.race.style.display = "flex";
        nodes.clear.style.display = "flex";
        ctx.platform.haptic("light");
      } else {
        state.path.length = 0;
        roadDirty = true;
        rebuildRoad();
        showDist(0);
        nodes.hint.style.opacity = "1";
      }
    };
    ctx.listen(view, "pointerup", endDraw);
    ctx.listen(view, "pointercancel", endDraw);
    ctx.listen(view, "lostpointercapture", endDraw);

    const tap = (el, fn) => ctx.listen(el, "pointerdown", (e) => { e.preventDefault(); firstGesture(); fn(); });
    tap(nodes.race, () => {
      nodes.race.style.transform = "scale(0.94)";
      ctx.timeout(() => { nodes.race.style.transform = ""; }, 150);
      startRace();
      ctx.platform.haptic("medium");
    });
    tap(nodes.clear, () => { resetGame(); ctx.platform.haptic("light"); });
    tap(nodes.boardbtn, showBoard);
    ctx.listen(nodes.sheet_close, "pointerdown", (e) => {
      e.preventDefault();
      nodes.sheet.style.opacity = "0";
      ctx.timeout(() => {
        nodes.sheet.style.display = "none";
      nodes.sheet.style.transform = "translateY(26px)";
        if (state.mode === "done") resetGame();
      }, 240);
    });

    // ===================================================================== //
    // 9. Remembering                                                        //
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
        fireAndForget(() => ctx.storage.set("sketchracer2", {
          best: state.best, diamondUnlocked: state.diamondUnlocked,
          diamondEquipped: state.diamondEquipped
        }));
      }, 450);
    }
    if (canStore) {
      try {
        const s = await ctx.storage.get("sketchracer2");
        if (s && typeof s === "object") {
          if (typeof s.best === "number") state.best = s.best;
          state.diamondUnlocked = !!s.diamondUnlocked;
          state.diamondEquipped = !!s.diamondEquipped;
        }
      } catch (_) { /* first run */ }
    }
    applyDiamond();

    // ===================================================================== //
    // 10. Frame                                                             //
    // ===================================================================== //
    ctx.onDestroy(() => {
      Sound.close();
      try { renderer.dispose(); } catch (_) {}
      for (const t of [rtScene, rtA, rtB]) { try { t.dispose(); } catch (_) {} }
    });

    const carPos = new THREE.Vector3();
    const camWant = new THREE.Vector3();
    const lookWant = new THREE.Vector3();
    const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    layout();
    resetGame();
    showBest();

    let clock = 0;
    function frame(dtMs) {
      const dt = Math.min(0.05, (dtMs || 16) / 1000);
      clock += dt;
      if (ctx.width !== W || ctx.height !== H) { layout(); roadDirty = true; }
      if (roadDirty) rebuildRoad();

      groundMat.uniforms.uTime.value = clock;
      skyMat.uniforms.uTime.value = clock;
      sky.position.copy(camera.position);
      compMat.uniforms.uTime.value = clock;
      roadMat.uniforms.uTime.value = clock;

      if (state.mode === "racing") {
        state.speed += (state.targetSpeed - state.speed) * Math.min(1, dt * 2.4);
        state.progress += state.speed * dt;
        Sound.updateEngine(state.speed / SPEED_MAX);
        showDist(metres(Math.min(state.progress, state.length)));
        if (Math.random() < 0.55) {
          spark(carPos.x + (Math.random() - 0.5) * 26, 3, carPos.z + (Math.random() - 0.5) * 26, 1, 60);
        }
        if (state.progress >= state.length) { state.progress = state.length; finishRace(); }
      }

      // Car placement.
      const heading = sampleAt(state.mode === "draw" ? 0 : state.progress, pos);
      carPos.copy(pos);
      car.position.copy(carPos);
      car.rotation.y = heading;
      if (state.mode === "racing") {
        const spin = (state.speed * dt) / 5.2;
        for (const w of wheels) w.rotation.x -= spin;
      }
      car.visible = state.path.length > 1;
      roadMat.uniforms.uHead.value = state.length > 0 ? state.progress / state.length : 0;
      roadMat.uniforms.uLen.value = Math.max(1, state.length);

      // Camera: overhead while drawing, chase while racing, eased between.
      const want = state.mode === "racing" || state.mode === "done" ? 1 : 0;
      state.camBlend += (want - state.camBlend) * Math.min(1, dt * 2.2);
      const k = easeInOut(Math.max(0, Math.min(1, state.camBlend)));

      // Chase from behind while racing; at the flag, ease into a slow orbit and
      // lift, so the result sheet has the car you just drove sitting above it.
      let behind = 150, above = 78, swing = 0;
      if (state.mode === "done") {
        state.orbit += dt * 0.42;
        state.orbitMix = Math.min(1, state.orbitMix + dt * 0.7);
        const om = easeInOut(state.orbitMix);
        behind = 150 + 145 * om;
        above = 78 + 34 * om;
        swing = Math.sin(state.orbit) * 0.85 * om;
      }
      camWant.set(
        carPos.x - Math.sin(heading + swing) * behind,
        above,
        carPos.z - Math.cos(heading + swing) * behind
      );
      camera.position.set(
        0 * (1 - k) + camWant.x * k,
        camHeight * (1 - k) + camWant.y * k,
        0.001 * (1 - k) + camWant.z * k
      );
      // Aim ahead of the car while racing, and at the car itself once stopped.
      const om2 = state.mode === "done" ? easeInOut(state.orbitMix) : 0;
      const aim = 90 * (1 - om2);
      // Aiming below the car pushes it up the frame, clear of the sheet that
      // covers the bottom half of the screen once the race is over.
      lookWant.set(
        carPos.x + Math.sin(heading) * aim,
        12 - 78 * om2,
        carPos.z + Math.cos(heading) * aim
      );
      const lx = 0 * (1 - k) + lookWant.x * k;
      const ly = 0 * (1 - k) + lookWant.y * k;
      const lz = 0 * (1 - k) + lookWant.z * k;
      if (state.shake > 0) {
        state.shake = Math.max(0, state.shake - dt);
        camera.position.x += (Math.random() - 0.5) * state.shake * 26;
        camera.position.y += (Math.random() - 0.5) * state.shake * 20;
      }
      camera.up.set(0, k, 1 - k);       // overhead needs +Z up, chase needs +Y
      camera.lookAt(lx, ly, lz);

      for (let i = 0; i < SP; i++) {
        if (spLife[i] <= 0) continue;
        spLife[i] = Math.max(0, spLife[i] - dt * 1.7);
        spPos[i * 3] += spVel[i * 3] * dt;
        spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt;
        spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
        spVel[i * 3 + 1] -= 130 * dt;
      }
      spGeo.attributes.position.needsUpdate = true;
      spGeo.attributes.aLife.needsUpdate = true;

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
    }

    frame(16);
    ctx.markVisualReady("first frame");
    ctx.platform.ready();
    ctx.onFrame(frame);
  }
};
