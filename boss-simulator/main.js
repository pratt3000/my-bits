/**
 * Boss Simulator — you are the boss, and the computer is dodging.
 *
 * The usual arrangement, inverted. A target moves inside an arena and tries very
 * hard to stay alive; you have nine attacks along the bottom and sixty seconds
 * to take a thousand hit points off it. No cooldowns. Press whatever you like as
 * fast as you like.
 *
 * What makes it a game rather than a button-masher is that the target is
 * genuinely good. Every frame it scores sixteen directions for danger — walls,
 * every projectile in flight and where that projectile will be fifteen frames
 * from now, the footprint of any telegraphed zone, plus a slight pull toward the
 * middle so it does not hug a wall forever — and walks down the steepest
 * gradient it can find. Fire one bone at it and it simply steps aside. You have
 * to close the exits: a wave to herd it, a void to take half the arena away, a
 * freeze to pin it, and then something heavy while it cannot move.
 *
 * The rebuild is a real arena. The simulation still runs in flat arena
 * coordinates — the dodging AI is line for line the original's — but it is drawn
 * through a tilted orthographic camera onto a lit floor with walls that have
 * height, a target that hovers and casts a shadow, and projectiles that fly
 * above the plate rather than being drawn on it. Sixty seconds of that reads as
 * a machine you are operating instead of shapes on a black rectangle.
 *
 * Ported from a standalone Sekai build. The dodging AI, all nine attacks, the
 * damage numbers and the sixty-second limit are the original's, unchanged. The
 * art is not — see "Divergence" in the README.
 */
window.plethoraBit = {
  meta: {
    title: "Boss Simulator",
    runtime: "plethora-bit@2",
    tags: ["game", "action", "arcade", "leaderboard", "boss"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Constants                                                          //
    // ===================================================================== //
    const TIME_LIMIT = 60;
    const BOT_SPEED = 8.0;
    const MAX_HP = 1000;
    const PAD_H = 150;             // the attack keypad along the bottom
    const WALL_H = 42;             // arena wall height, world units
    const TILT = 46;               // degrees above the floor plane
    const ELEV = 20;               // how high projectiles fly

    const INK = "#f2f1f7";
    const DIM = "rgba(242,241,247,0.52)";
    const TARGET_C = "#ff2f45";

    // Each ability has a colour, and its projectiles are that colour, so nine
    // things happening at once are still nine legible things.
    // Spamming used to win: every attack was free, and damage landed once per
    // frame per overlapping projectile, so a sustained wave did sixty ticks a
    // second. Three things fix that without touching the AI.
    //
    //  1. Attacks cost energy from one shared pool, so every press is a choice.
    //  2. An attack can only hurt the target once every DMG_TICK, so a wave is
    //     worth a lot without being worth everything.
    //  3. A target that is free to move is GUARDED and takes a quarter damage.
    //     Only while it is pinned — frozen, grabbed or crushed — does it take
    //     full damage, multiplied. So the intended play is the only play that
    //     works: close the exits, pin it, then spend everything.
    const ENERGY_MAX = 100;
    const ENERGY_REGEN = 30;       // per second
    const DMG_TICK = 0.16;         // seconds between hits from one attack
    const GUARD_MULT = 0.5;
    const EXPOSED_MULT = 3.0;
    const CRUSH_REACH = 0.86;      // fraction of the half-arena the walls cover

    const ABILITIES = [
      { id: "bone", name: "Bone", hint: "one fast shot", c: "#e8ecff", cost: 5 },
      { id: "wave", name: "Wave", hint: "wall, gap on it", c: "#7de2ff", cost: 15 },
      { id: "void", name: "Void", hint: "half the arena", c: "#a855f7", cost: 20 },
      { id: "swarm", name: "Swarm", hint: "16 outward", c: "#ffd166", cost: 16 },
      { id: "blaster", name: "Beam", hint: "vertical, aimed", c: "#dff3ff", cost: 18 },
      { id: "twowaves", name: "Pincer", hint: "both sides", c: "#5eead4", cost: 20 },
      { id: "freeze", name: "Freeze", hint: "pins it 1.5s", c: "#38bdf8", cost: 22 },
      { id: "grab", name: "Grab", hint: "drags to centre", c: "#f472b6", cost: 18 },
      { id: "crusher", name: "Crush", hint: "squeezes the arena", c: "#fb7185", cost: 30 }
    ];
    const ABILITY_COST = {};
    for (const a of ABILITIES) ABILITY_COST[a.id] = a.cost;
    const ABILITY_C = {};
    for (const a of ABILITIES) ABILITY_C[a.id] = a.c;

    const state = {
      status: "ready",              // ready | playing | won | lost
      timeRemaining: TIME_LIMIT,
      elapsed: 0,
      box: { x: 0, y: 0, w: 1, h: 1 },
      bot: { x: 0, y: 0, size: 16, hp: MAX_HP, frozenTimer: 0, grabbedTimer: 0, invulnTimer: 0 },
      attacks: [],
      best: 0,
      shake: 0,
      flinch: 0,
      hpGhost: MAX_HP,
      energy: ENERGY_MAX,
      exposed: false
    };

    const floaters = [];

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
        'padding:30px;text-align:center;font-family:' + FONT + ';color:#e7e5f0;background:#06060c;">' +
        '<div><div style="font-size:19px;font-weight:700;margin-bottom:9px;">Boss Simulator</div>' +
        '<div style="font-size:13.5px;opacity:0.75;line-height:1.6;">This needs 3D, and it could not ' +
        "start here. Try opening it again in the Plethora app.</div></div></div>";
      ctx.platform.error({ where: "three_import" });
      ctx.platform.ready();
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(2, ctx.nativeDpr || 1));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x04040a, 1);

    const scene = new THREE.Scene();
    // Orthographic and tilted. The simulation is flat and stays flat; the camera
    // is what makes it an arena. Orthographic because the fit is then exact —
    // the projected bounding box of the floor plus the walls is computed in
    // camera space and the frustum is set to contain it, so the arena never
    // creeps under the HUD on a screen shape I did not anticipate.
    // The depth range is deliberately tight. At -4000..4000 the floor decals,
    // which sit 1.6 units above the plate, fell below the depth buffer's
    // resolution and lost the comparison against the floor — the void's
    // telegraph simply never appeared, with nothing in the console to say so.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1600, 1600);
    const TILT_R = (TILT * Math.PI) / 180;
    camera.position.set(0, Math.sin(TILT_R) * 1200, Math.cos(TILT_R) * 1200);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x2a2f52, 1.15));
    const key = new THREE.DirectionalLight(0xfff2e2, 1.35);
    key.position.set(0.35, 1, 0.55);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x5b7cff, 0.7);
    rim.position.set(-0.6, 0.4, -0.8);
    scene.add(rim);

    // Arena coordinates (CSS pixels, y down) → world (x right, y up, z toward
    // the viewer). One arena unit is one world unit; only the camera differs.
    const _v = new THREE.Vector3();
    function wx(ax) { return ax - (state.box.x + state.box.w / 2); }
    function wz(ay) { return ay - (state.box.y + state.box.h / 2); }

    // ===================================================================== //
    // 2. Sound                                                              //
    // ===================================================================== //
    // The original had five sound files with a procedural fallback. None could
    // travel, so all of this is generated — but through one master chain rather
    // than nine oscillators wired straight to the speakers.
    const Sound = {
      ac: null, ready: false, bus: null, reverb: null, delay: null, noiseBuf: null,
      init() {
        if (this.ac) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ac = new AC(); } catch (_) { return; }
        const ac = this.ac;

        const out = ac.createGain(); out.gain.value = 0.9;
        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.2;
        const shelf = ac.createBiquadFilter();
        shelf.type = "highshelf"; shelf.frequency.value = 5000; shelf.gain.value = 2;
        const bus = ac.createGain(); bus.gain.value = 0.5;
        bus.connect(shelf); shelf.connect(limiter); limiter.connect(out);
        out.connect(ac.destination);
        this.bus = bus;

        // A room, from an impulse generated at load. Short and tight — this is
        // a fight, not a cathedral.
        try {
          const dur = 1.15, n = Math.floor(ac.sampleRate * dur);
          const buf = ac.createBuffer(2, n, ac.sampleRate);
          for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
          }
          const conv = ac.createConvolver(); conv.buffer = buf;
          const wet = ac.createGain(); wet.gain.value = 0.26;
          conv.connect(wet); wet.connect(bus);
          this.reverb = conv;
        } catch (_) { this.reverb = null; }

        // Cross-fed delay lines have a system gain of 2g, so the feedback stays
        // well under 0.5 or the tail never decays.
        try {
          const dL = ac.createDelay(1.0), dR = ac.createDelay(1.0);
          dL.delayTime.value = 0.17; dR.delayTime.value = 0.255;
          const fb = ac.createGain(); fb.gain.value = 0.22;
          dL.connect(fb); fb.connect(dR); dR.connect(dL);
          const pL = ac.createStereoPanner ? ac.createStereoPanner() : null;
          const pR = ac.createStereoPanner ? ac.createStereoPanner() : null;
          if (pL) { pL.pan.value = -0.7; dL.connect(pL); pL.connect(bus); } else dL.connect(bus);
          if (pR) { pR.pan.value = 0.7; dR.connect(pR); pR.connect(bus); } else dR.connect(bus);
          const send = ac.createGain(); send.gain.value = 0.16;
          send.connect(dL);
          this.delay = send;
        } catch (_) { this.delay = null; }

        // One second of noise, made once. Making a fresh buffer per shot is how
        // a game that fires forty times a second ends up allocating megabytes.
        try {
          const n = Math.floor(ac.sampleRate * 1.0);
          const buf = ac.createBuffer(1, n, ac.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
          this.noiseBuf = buf;
        } catch (_) { this.noiseBuf = null; }

        this.ready = true;
      },
      resume() {
        if (this.ac && this.ac.state === "suspended") { try { this.ac.resume(); } catch (_) {} }
      },
      _dest(node, pan, wet) {
        const ac = this.ac;
        let last = node;
        if (ac.createStereoPanner) {
          const p = ac.createStereoPanner();
          p.pan.value = Math.max(-1, Math.min(1, pan || 0));
          node.connect(p); last = p;
        }
        last.connect(this.bus);
        if (this.reverb && wet !== false) last.connect(this.reverb);
        if (this.delay && wet === "delay") last.connect(this.delay);
        return last;
      },
      noise(dur, type, freq, q, vol, pan, curve) {
        if (!this.ready || !this.noiseBuf) return;
        const ac = this.ac, t = ac.currentTime;
        const src = ac.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = ac.createBiquadFilter();
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        if (curve) {
          f.frequency.setValueAtTime(freq, t);
          f.frequency.exponentialRampToValueAtTime(Math.max(60, curve), t + dur);
        }
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g);
        this._dest(g, pan);
        try { src.start(t); src.stop(t + dur + 0.02); } catch (_) {}
      },
      tone(f0, f1, dur, type, vol, pan, wet) {
        if (!this.ready) return;
        const ac = this.ac, t = ac.currentTime;
        const osc = ac.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(f0, t);
        if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(8, f1), t + dur);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.15));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g);
        this._dest(g, pan, wet);
        try { osc.start(t); osc.stop(t + dur + 0.02); } catch (_) {}
      },
      // A struck metal cluster: partials at inharmonic ratios, which is what a
      // PeriodicWave cannot express and what makes ice sound like ice.
      bell(base, dur, vol, pan) {
        if (!this.ready) return;
        const ac = this.ac, t = ac.currentTime;
        const ratios = [1, 2.76, 5.4, 8.93];
        const amps = [1, 0.5, 0.28, 0.15];
        for (let i = 0; i < ratios.length; i++) {
          const osc = ac.createOscillator();
          osc.type = "sine";
          osc.frequency.value = base * ratios[i];
          const g = ac.createGain();
          const d = dur * (1 - i * 0.16);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(vol * amps[i], t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + d);
          osc.connect(g);
          this._dest(g, pan, "delay");
          try { osc.start(t); osc.stop(t + d + 0.02); } catch (_) {}
        }
      },
      pan(ax) {
        const b = state.box;
        return b.w > 0 ? Math.max(-1, Math.min(1, ((ax - b.x) / b.w) * 2 - 1)) : 0;
      },
      // One voice per ability, so you can hear which one landed.
      fire(id, ax) {
        const p = this.pan(ax);
        if (id === "bone") this.noise(0.10, "bandpass", 2600, 2.2, 0.16, p, 900);
        else if (id === "wave") { this.tone(180, 90, 0.34, "sawtooth", 0.13, p); this.noise(0.30, "highpass", 900, 1, 0.07, p); }
        else if (id === "twowaves") { this.tone(150, 74, 0.40, "sawtooth", 0.14, -0.7); this.tone(150, 74, 0.40, "sawtooth", 0.14, 0.7); }
        else if (id === "void") { this.tone(70, 34, 0.85, "sawtooth", 0.17, p); this.tone(105, 51, 0.85, "square", 0.07, p); }
        else if (id === "swarm") {
          for (let i = 0; i < 5; i++) {
            ctx.timeout(() => this.noise(0.07, "bandpass", 1600 + i * 620, 3.5, 0.10, (i - 2) * 0.4), i * 26);
          }
        } else if (id === "blaster") { this.tone(320, 1500, 0.22, "sine", 0.09, p); ctx.timeout(() => { this.noise(0.24, "lowpass", 5200, 0.8, 0.2, p, 700); this.tone(120, 46, 0.34, "square", 0.13, p); }, 230); }
        else if (id === "freeze") this.bell(1180, 0.9, 0.10, p);
        else if (id === "grab") this.tone(620, 150, 0.36, "triangle", 0.13, p, "delay");
        else if (id === "crusher") { this.tone(58, 26, 1.0, "sawtooth", 0.20, 0); this.noise(0.7, "lowpass", 400, 0.8, 0.14, 0, 90); }
      },
      hit(dmg, ax, pinned) {
        // Pitched by how much it hurt, so a big hit sounds like a big hit — and
        // a hit that only chipped a guarded target sounds like it bounced off.
        const p = this.pan(ax);
        if (!pinned) {
          this.noise(0.035, "bandpass", 3400, 6, 0.045, p, 2600);
          return;
        }
        this.noise(0.045, "bandpass", 2400 - Math.min(1600, dmg * 70), 4, 0.10, p, 500);
        this.tone(280 - Math.min(190, dmg * 8), 90, 0.09, "square", 0.055, p, false);
      },
      // Out of energy.
      denied() {
        if (!this.ready) return;
        this.tone(196, 146, 0.10, "square", 0.05, 0, false);
      },
      win() {
        [0, 4, 7, 12, 19].forEach((s, i) => {
          ctx.timeout(() => this.bell(261.6 * Math.pow(2, s / 12), 1.1, 0.10, (i - 2) * 0.25), i * 105);
        });
      },
      lose() {
        this.tone(196, 44, 1.3, "sawtooth", 0.16, 0);
        this.tone(146.8, 33, 1.3, "triangle", 0.10, 0);
      },
      close() {
        if (this.ac) { try { this.ac.close(); } catch (_) {} }
        this.ac = null; this.ready = false;
      }
    };

    // ===================================================================== //
    // 3. The arena                                                          //
    // ===================================================================== //
    const floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uHeat: { value: 0 },        // rises as the clock runs down
        uHit: { value: 0 }          // flashes when the target takes damage
      },
      vertexShader: [
        "varying vec2 vP;",
        // World XZ, not the plane's own local xy. The plane is a unit quad that
        // the model matrix scales up, so `position.xy` never leaves [-0.5,0.5]:
        // the grid collapsed to nothing, and the scan sweep — keyed on a uv
        // that was 0.5 everywhere — flashed the entire floor on and off.
        "void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz;",
        "  gl_Position = projectionMatrix*viewMatrix*w; }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec2 vP;",
        "uniform vec2 uSize; uniform float uTime; uniform float uHeat; uniform float uHit;",
        "float grid(vec2 p, float s){",
        "  vec2 g = abs(fract(p/s - 0.5) - 0.5) / fwidth(p/s);",
        "  return 1.0 - min(min(g.x,g.y), 1.0);",
        "}",
        "void main(){",
        "  vec2 uv = vP / uSize + 0.5;",
        "  vec3 c = vec3(0.040,0.044,0.082);",
        "  c += vec3(0.13,0.17,0.36) * grid(vP, 44.0) * 0.55;",
        "  c += vec3(0.22,0.28,0.58) * grid(vP, 176.0) * 0.70;",
        // A slow sweep, so a still frame is never the whole story.
        "  float sweep = exp(-pow((fract(uTime*0.11) - uv.y)*7.0, 2.0));",
        "  c += vec3(0.12,0.19,0.40) * sweep * 0.75;",
        "  c += vec3(0.55,0.09,0.14) * uHeat * (0.10 + 0.05*sin(uTime*5.0));",
        "  c += vec3(0.9,0.25,0.3) * uHit * 0.22;",
        "  float edge = max(abs(uv.x-0.5), abs(uv.y-0.5))*2.0;",
        "  c *= 1.0 - smoothstep(0.55, 1.0, edge)*0.45;",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n"),
      extensions: { derivatives: true },
      side: THREE.DoubleSide
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Walls: real slabs, so the arena has a lip the tilt can see.
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0b0e1e, roughness: 0.62, metalness: 0.08,
      emissive: 0x1b2450, emissiveIntensity: 0.5
    });
    const wallTopMat = new THREE.MeshBasicMaterial({ color: 0x35478f });
    const walls = [];
    const wallTops = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wallMat);
      scene.add(m); walls.push(m);
      const t = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wallTopMat);
      scene.add(t); wallTops.push(t);
    }

    // The crusher's two slabs, parked off the ends until it fires.
    const crushMat = new THREE.MeshStandardMaterial({
      color: 0x2a0d16, roughness: 0.5, metalness: 0.2,
      emissive: 0xfb7185, emissiveIntensity: 0.8
    });
    const crushL = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), crushMat);
    const crushR = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), crushMat);
    crushL.visible = crushR.visible = false;
    scene.add(crushL); scene.add(crushR);

    // ---- the target ------------------------------------------------------
    const target = new THREE.Group();
    const shellMat = new THREE.ShaderMaterial({
      uniforms: {
        uC: { value: new THREE.Color(TARGET_C) },
        uFlinch: { value: 0 },
        uFrozen: { value: 0 }
      },
      vertexShader: [
        "varying vec3 vN; varying vec3 vV;",
        "void main(){ vN = normalize(normalMatrix*normal);",
        "  vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz;",
        "  gl_Position = projectionMatrix*mv; }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec3 vN; varying vec3 vV;",
        "uniform vec3 uC; uniform float uFlinch; uniform float uFrozen;",
        "void main(){",
        "  vec3 n = normalize(vN);",
        "  float f = pow(1.0 - clamp(dot(n, normalize(vV)), 0.0, 1.0), 2.0);",
        "  float lam = clamp(dot(n, normalize(vec3(-0.4,0.75,0.5))), 0.0, 1.0);",
        "  vec3 base = mix(uC, vec3(0.35,0.75,1.0), uFrozen);",
        "  vec3 c = base * (0.22 + 0.55*lam) + base * f * 1.35;",
        "  c += vec3(1.0) * uFlinch * 0.85;",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n"),
      side: THREE.DoubleSide
    });
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), shellMat);
    target.add(shell);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffe9ec });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), coreMat);
    target.add(core);
    scene.add(target);

    // Its shadow on the floor, which is most of what says it is hovering.
    const shadowMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "void main(){ float d = length((vUv-0.5)*2.0);",
        "  gl_FragColor = vec4(0.0,0.0,0.0, smoothstep(1.0,0.1,d)*0.55); }"
      ].join("\n"),
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.6;
    scene.add(shadow);

    // A ring on the floor while it is pinned or dragged.
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(0x38bdf8) }, uT: { value: 0 } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: [
        "precision highp float; varying vec2 vUv; uniform vec3 uC; uniform float uT;",
        "void main(){ float d = length((vUv-0.5)*2.0);",
        "  float r = 0.55 + 0.30*sin(uT*6.0);",
        "  float ring = exp(-pow((d-r)/0.13, 2.0));",
        "  gl_FragColor = vec4(uC, ring*0.75); }"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const statusRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat);
    statusRing.rotation.x = -Math.PI / 2;
    statusRing.position.y = 1.2;
    statusRing.visible = false;
    scene.add(statusRing);

    // ---- projectiles -----------------------------------------------------
    // Flat glowing plates hovering above the plate, one quad each, one geometry
    // for all of them. Four hundred of these can be in flight; four hundred
    // Meshes would not survive the frame budget.
    const MAXP = 460;
    const pjGeo = new THREE.BufferGeometry();
    const pjPos = new Float32Array(MAXP * 4 * 3);
    const pjUv = new Float32Array(MAXP * 4 * 2);
    const pjHalf = new Float32Array(MAXP * 4 * 2);
    const pjCol = new Float32Array(MAXP * 4 * 3);
    const pjIdx = new Uint16Array(MAXP * 6);
    pjGeo.setAttribute("position", new THREE.BufferAttribute(pjPos, 3));
    pjGeo.setAttribute("uv", new THREE.BufferAttribute(pjUv, 2));
    pjGeo.setAttribute("aHalf", new THREE.BufferAttribute(pjHalf, 2));
    pjGeo.setAttribute("aC", new THREE.BufferAttribute(pjCol, 3));
    pjGeo.setIndex(new THREE.BufferAttribute(pjIdx, 1));
    pjGeo.setDrawRange(0, 0);
    const pjMat = new THREE.ShaderMaterial({
      vertexShader: [
        "attribute vec2 aHalf; attribute vec3 aC;",
        "varying vec2 vUv; varying vec2 vHalf; varying vec3 vC;",
        "void main(){ vUv=uv; vHalf=aHalf; vC=aC;",
        "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec2 vUv; varying vec2 vHalf; varying vec3 vC;",
        "void main(){",
        // Rounded-rectangle distance, in the projectile's own units.
        "  vec2 p = (vUv-0.5) * (vHalf + 7.0) * 2.0;",
        "  vec2 q = abs(p) - vHalf;",
        "  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);",
        "  float body = 1.0 - smoothstep(-1.0, 1.2, d);",
        "  float glow = exp(-max(0.0, d)*0.52);",
        "  vec3 c = vC * (0.42 + body*1.55);",
        "  float a = max(body, glow*0.75);",
        "  gl_FragColor = vec4(c, a);",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const projectiles = new THREE.Mesh(pjGeo, pjMat);
    projectiles.frustumCulled = false;
    scene.add(projectiles);

    // Floor zones: the void's footprint and the beam's telegraph, drawn on the
    // plate itself so they read as ground you must not stand on.
    const MAXZ = 24;
    const zGeo = new THREE.BufferGeometry();
    const zPos = new Float32Array(MAXZ * 4 * 3);
    const zUv = new Float32Array(MAXZ * 4 * 2);
    const zA = new Float32Array(MAXZ * 4 * 2);   // (armed 0..1, time)
    const zCol = new Float32Array(MAXZ * 4 * 3);
    const zIdx = new Uint16Array(MAXZ * 6);
    zGeo.setAttribute("position", new THREE.BufferAttribute(zPos, 3));
    zGeo.setAttribute("uv", new THREE.BufferAttribute(zUv, 2));
    zGeo.setAttribute("aA", new THREE.BufferAttribute(zA, 2));
    zGeo.setAttribute("aC", new THREE.BufferAttribute(zCol, 3));
    zGeo.setIndex(new THREE.BufferAttribute(zIdx, 1));
    zGeo.setDrawRange(0, 0);
    const zMat = new THREE.ShaderMaterial({
      vertexShader: [
        "attribute vec2 aA; attribute vec3 aC;",
        "varying vec2 vUv; varying vec2 vA; varying vec3 vC;",
        "void main(){ vUv=uv; vA=aA; vC=aC;",
        "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
      ].join("\n"),
      fragmentShader: [
        "precision highp float; varying vec2 vUv; varying vec2 vA; varying vec3 vC;",
        "float h(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}",
        "void main(){",
        "  float armed = vA.x, t = vA.y;",
        "  vec2 e = abs(vUv-0.5)*2.0;",
        "  float border = smoothstep(0.90, 1.0, max(e.x,e.y));",
        // Warning: hatched, marching. Armed: filled and churning.
        "  float hatch = step(0.5, fract((vUv.x+vUv.y)*13.0 - t*1.6));",
        "  float churn = h(floor(vUv*vec2(34.0,54.0)) + floor(t*13.0));",
        "  vec3 c = vC * (border*1.5 + hatch*0.18*(1.0-armed));",
        "  c += vC * armed * (0.55 + churn*0.5);",
        "  float a = max(border, mix(hatch*0.28, 0.72 + churn*0.2, armed));",
        "  gl_FragColor = vec4(c, a);",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const zones = new THREE.Mesh(zGeo, zMat);
    zones.frustumCulled = false;
    zones.renderOrder = 2;
    scene.add(zones);

    // The beam is a real column of light standing on the plate.
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uArmed: { value: 0 }, uTime: { value: 0 } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: [
        "precision highp float; varying vec2 vUv; uniform float uArmed; uniform float uTime;",
        "void main(){",
        "  float e = abs(vUv.x-0.5)*2.0;",
        "  float core = exp(-pow(e/0.34, 2.0));",
        "  float up = 1.0 - vUv.y*0.72;",
        "  float flick = 0.86 + 0.14*sin(uTime*47.0 + vUv.y*22.0);",
        "  vec3 c = vec3(0.86,0.95,1.0) * core * up * flick * (0.25 + uArmed*2.6);",
        "  gl_FragColor = vec4(c, (core*up)*(0.22 + uArmed*0.78));",
        "}"
      ].join("\n"),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const BEAMS = 6;
    const beams = [];
    for (let i = 0; i < BEAMS; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), beamMat);
      b.visible = false;
      scene.add(b);
      beams.push(b);
    }

    // ---- sparks ----------------------------------------------------------
    const SP = 600;
    const spPos = new Float32Array(SP * 3);
    const spLife = new Float32Array(SP);
    const spCol = new Float32Array(SP * 3);
    const spVel = new Float32Array(SP * 3);
    let spHead = 0;
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    spGeo.setAttribute("aLife", new THREE.BufferAttribute(spLife, 1));
    spGeo.setAttribute("aC", new THREE.BufferAttribute(spCol, 3));
    const spMat = new THREE.ShaderMaterial({
      uniforms: { uDpr: { value: 1 }, uScale: { value: 1 } },
      vertexShader: [
        "attribute float aLife; attribute vec3 aC; varying float vL; varying vec3 vC;",
        "uniform float uDpr; uniform float uScale;",
        "void main(){ vL=aLife; vC=aC;",
        "  gl_PointSize = (2.0 + 8.0*aLife) * uDpr * uScale;",
        "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }"
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
    scene.add(sparks);

    function spark(ax, ay, rgb, n, spread) {
      for (let i = 0; i < n; i++) {
        const k = spHead; spHead = (spHead + 1) % SP;
        spPos[k * 3] = wx(ax); spPos[k * 3 + 1] = ELEV; spPos[k * 3 + 2] = wz(ay);
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * spread + spread * 0.3;
        spVel[k * 3] = Math.cos(a) * s;
        spVel[k * 3 + 1] = Math.random() * spread * 0.9 + 20;
        spVel[k * 3 + 2] = Math.sin(a) * s;
        spCol[k * 3] = rgb[0]; spCol[k * 3 + 1] = rgb[1]; spCol[k * 3 + 2] = rgb[2];
        spLife[k] = 1;
      }
    }

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
        "  gl_FragColor=vec4(c*smoothstep(0.40,0.95,l),1.0); }"
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
      uniforms: {
        tScene: { value: null }, tBloom: { value: null },
        uAmount: { value: 0.8 }, uTime: { value: 0 }, uHurt: { value: 0 }
      },
      vertexShader: VERT,
      fragmentShader: [
        "precision highp float; varying vec2 vUv;",
        "uniform sampler2D tScene; uniform sampler2D tBloom;",
        "uniform float uAmount; uniform float uTime; uniform float uHurt;",
        "float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}",
        "void main(){ vec3 c=texture2D(tScene,vUv).rgb + texture2D(tBloom,vUv).rgb*uAmount;",
        "  c=(c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);",
        // A red pulse from the edges as the clock runs down.
        "  float v = length(vUv-0.5)*1.4;",
        "  c += vec3(0.9,0.10,0.16) * smoothstep(0.45,1.0,v) * uHurt * 0.5;",
        "  c *= 1.0 - v*0.22;",
        "  c += (hash(vUv*1024.0+fract(uTime))-0.5)*0.016;",
        "  gl_FragColor=vec4(clamp(c,0.0,1.0),1.0); }"
      ].join("\n"), depthTest: false, depthWrite: false
    });
    function pass(mat, tgt) {
      passQuad.material = mat;
      renderer.setRenderTarget(tgt || null);
      renderer.render(passScene, quadCam);
    }

    // ===================================================================== //
    // 5. Layout — including the exact orthographic fit                      //
    // ===================================================================== //
    const corners = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const ey of [0, WALL_H + ELEV]) corners.push(new THREE.Vector3(sx, ey, sz));
      }
    }
    const camInv = new THREE.Matrix4();

    function layout() {
      W = Math.max(1, ctx.width);
      H = Math.max(1, ctx.height);
      renderer.setSize(W, H, false);

      const topBand = SAFE_T + 78;
      const botBand = SAFE_B + PAD_H + 10;
      const avail = Math.max(120, H - topBand - botBand);

      // The arena is sized from the screen, as it always was — a phone-shaped
      // box with margins — and the camera is then fitted to it.
      state.box.x = 24;
      state.box.w = Math.max(80, W - 48);
      state.box.y = topBand;
      state.box.h = Math.max(120, avail);
      const AW = state.box.w, AH = state.box.h;

      floor.scale.set(AW, AH, 1);
      floor.position.set(0, 0, 0);
      floorMat.uniforms.uSize.value.set(AW, AH);

      const t = 10;   // wall thickness
      // The near wall is a low lip, not a wall. At full height it stands between
      // the camera and the bottom of the arena, and a target driven down there
      // by the crusher disappears behind it — which is exactly when you most
      // need to see it.
      const NEAR_H = 9;
      const spec = [
        [0, WALL_H / 2, -AH / 2 - t / 2, AW + t * 2, WALL_H, t],
        [0, NEAR_H / 2, AH / 2 + t / 2, AW + t * 2, NEAR_H, t],
        [-AW / 2 - t / 2, WALL_H / 2, 0, t, WALL_H, AH],
        [AW / 2 + t / 2, WALL_H / 2, 0, t, WALL_H, AH]
      ];
      for (let i = 0; i < 4; i++) {
        const s = spec[i];
        const h = s[4];
        walls[i].position.set(s[0], s[1], s[2]);
        walls[i].scale.set(s[3], h, s[5]);
        wallTops[i].position.set(s[0], h + 0.8, s[2]);
        wallTops[i].scale.set(s[3], 1.6, s[5]);
      }

      // Exact fit: project the arena's corner box into camera space and set the
      // frustum to contain it, then grow it so the whole thing sits inside the
      // band the HUD and the keypad leave free.
      camera.updateMatrixWorld();
      camInv.copy(camera.matrixWorld).invert();
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const c of corners) {
        _v.set(c.x * (AW / 2 + t * 2), c.y, c.z * (AH / 2 + t * 2)).applyMatrix4(camInv);
        if (_v.x < minX) minX = _v.x;
        if (_v.x > maxX) maxX = _v.x;
        if (_v.y < minY) minY = _v.y;
        if (_v.y > maxY) maxY = _v.y;
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      let halfW = (maxX - minX) / 2 + 8;
      let halfH = (maxY - minY) / 2 + 8;
      halfH *= H / avail;
      const aspect = W / H;
      if (halfW / halfH < aspect) halfW = halfH * aspect; else halfH = halfW / aspect;
      // Slide the frustum so the arena's centre lands in the middle of the free
      // band rather than the middle of the screen.
      const wantY = topBand + avail / 2;
      const shift = ((wantY - H / 2) / H) * (2 * halfH);
      camera.left = cx - halfW;
      camera.right = cx + halfW;
      camera.top = cy + halfH + shift;
      camera.bottom = cy - halfH + shift;
      camera.updateProjectionMatrix();

      // One world unit is this many CSS pixels, which is what the spark sizes
      // and the floater projection need.
      pxPerUnit = W / (halfW * 2);
      spMat.uniforms.uScale.value = Math.max(0.4, pxPerUnit);

      const dpr = renderer.getPixelRatio();
      rtScene.setSize(Math.max(1, Math.floor(W * dpr)), Math.max(1, Math.floor(H * dpr)));
      const bw = Math.max(1, Math.floor(W * dpr * 0.25));
      const bh = Math.max(1, Math.floor(H * dpr * 0.25));
      rtA.setSize(bw, bh); rtB.setSize(bw, bh);
      blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
      spMat.uniforms.uDpr.value = dpr;

      hud.style.top = SAFE_T + "px";
      pad.style.bottom = SAFE_B + "px";
      clampBot();
    }
    let pxPerUnit = 1;

    // ===================================================================== //
    // 6. UI                                                                 //
    // ===================================================================== //
    let padHtml = "";
    for (const a of ABILITIES) {
      padHtml +=
        '<button data-ab="' + a.id + '" style="pointer-events:auto;position:relative;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:2px;height:44px;' +
        'border-radius:12px;border:1px solid rgba(255,255,255,0.07);' +
        'background:linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.035));' +
        'font-family:inherit;padding:0 3px;overflow:hidden;touch-action:manipulation;' +
        'transition:transform 90ms ease, background 120ms ease;">' +
        '<span style="position:absolute;left:0;right:0;top:0;height:2px;background:' + a.c + ';' +
        'opacity:0.85;"></span>' +
        '<span style="position:absolute;top:3px;right:5px;font-size:8px;font-weight:600;' +
        'color:rgba(165,243,252,0.75);font-variant-numeric:tabular-nums;">' + a.cost + "</span>" +
        '<span style="font-size:11.5px;font-weight:600;color:' + INK + ';letter-spacing:0.2px;">' +
        a.name + "</span>" +
        '<span style="font-size:7.5px;color:' + DIM + ';white-space:nowrap;">' + a.hint + "</span>" +
        "</button>";
    }

    ui.innerHTML =
      '<div style="position:absolute;inset:0;font-family:' + FONT + ";color:" + INK + ";" +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;">' +

      '<div data-el="hud" style="position:absolute;left:0;right:0;padding:0 24px;">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px;">' +
          '<div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:' + DIM + ';">' +
          "Target</div>" +
          '<div data-el="timer" style="font-size:24px;font-weight:300;letter-spacing:-0.8px;' +
          'font-variant-numeric:tabular-nums;transition:color 200ms;">60.0</div>' +
        "</div>" +
        // Two bars: the real one, and a slower ghost behind it, so a big hit
        // reads as a chunk taken out rather than a number changing.
        '<div style="position:relative;height:11px;border-radius:6px;background:rgba(255,255,255,0.09);' +
        'overflow:hidden;border:1px solid rgba(255,255,255,0.06);">' +
          '<div data-el="hpghost" style="position:absolute;inset:0;width:100%;' +
          'background:rgba(255,190,190,0.4);transition:width 380ms cubic-bezier(.3,.9,.3,1) 130ms;"></div>' +
          '<div data-el="hpbar" style="position:absolute;inset:0;width:100%;' +
          'background:linear-gradient(90deg,#ff2f45,#ff6b5a);transition:width 90ms linear;"></div>' +
        "</div>" +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:5px;">' +
          '<div data-el="hptext" style="font-size:10.5px;color:' + DIM + ';' +
          'font-variant-numeric:tabular-nums;">1000 / 1000</div>' +
          '<div data-el="guard" style="font-size:9.5px;letter-spacing:1.6px;color:' + DIM + ';' +
          'transition:color 160ms;">GUARDED ×0.5</div>' +
        "</div>" +
        // Energy. Without it every button is free and the game is a mash.
        '<div data-el="energywrap" style="height:5px;border-radius:3px;margin-top:7px;' +
        'background:rgba(255,255,255,0.08);overflow:hidden;transform-origin:center;' +
        'transition:transform 120ms cubic-bezier(.2,1.5,.4,1);">' +
          '<div data-el="energy" style="height:100%;width:100%;' +
          'background:linear-gradient(90deg,#38bdf8,#a5f3fc);"></div>' +
        "</div>" +
      "</div>" +

      '<div data-el="floaters" style="position:absolute;inset:0;pointer-events:none;"></div>' +

      '<div data-el="pad" style="position:absolute;left:0;right:0;padding:0 12px;display:grid;' +
      'grid-template-columns:repeat(3,1fr);gap:8px;pointer-events:auto;">' + padHtml + "</div>" +

      '<div data-el="curtain" style="position:absolute;inset:0;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(4,4,10,0.78);' +
      '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);' +
      'z-index:9;pointer-events:auto;padding:26px;">' +
        '<div style="text-align:center;max-width:320px;width:100%;">' +
          '<div data-el="title" style="font-size:29px;font-weight:300;letter-spacing:-1px;">' +
          "Boss Simulator</div>" +
          '<div data-el="blurb" style="font-size:13.5px;color:' + DIM + ';line-height:1.65;' +
          'margin:12px 0 20px;">You are the boss. Sixty seconds to take a thousand points off a ' +
          "target that dodges properly.<br><br>Attacks cost energy, and a target that can still " +
          "move only takes a quarter damage. Close the exits, pin it, then spend everything.</div>" +
          '<div data-el="board" style="text-align:left;margin-bottom:18px;"></div>' +
          '<button data-el="go" style="pointer-events:auto;width:100%;height:54px;border-radius:27px;' +
          'border:0;background:' + TARGET_C + ';color:#fff;font-size:15px;font-weight:600;' +
          'font-family:inherit;letter-spacing:1.4px;">BEGIN</button>' +
          '<button data-el="showboard" style="pointer-events:auto;width:100%;height:44px;' +
          'border-radius:22px;border:0;background:rgba(255,255,255,0.08);color:' + INK + ';' +
          'font-size:13px;font-weight:500;font-family:inherit;margin-top:9px;">Leaderboard</button>' +
        "</div>" +
      "</div>" +
      "</div>";

    const nodes = {};
    for (const el of ui.querySelectorAll("[data-el]")) nodes[el.getAttribute("data-el")] = el;
    const hud = nodes.hud, pad = nodes.pad;

    // Damage numbers are DOM, not geometry: it is a handful of elements, the
    // type is the real font at the real weight, and the compositor animates
    // them for free.
    const FLOATERS = 22;
    const floaterEls = [];
    for (let i = 0; i < FLOATERS; i++) {
      const d = document.createElement("div");
      d.style.cssText = "position:absolute;left:0;top:0;font-size:15px;font-weight:600;" +
        "color:#fff;text-shadow:0 0 10px rgba(255,60,80,0.9);will-change:transform,opacity;" +
        "opacity:0;pointer-events:none;";
      nodes.floaters.appendChild(d);
      floaterEls.push(d);
    }

    // ===================================================================== //
    // 7. The nine attacks — patterns exactly as the original had them        //
    // ===================================================================== //
    function useAbility(type) {
      if (state.status !== "playing") return;
      // A hard cap, so a mashed button cannot bury the frame rate.
      if (state.attacks.length > 400) return;

      const cost = ABILITY_COST[type] || 0;
      if (state.energy < cost) {
        // Refused, and it says so — a button that does nothing silently is a
        // bug as far as the player is concerned.
        Sound.denied();
        flashEnergy();
        return;
      }
      state.energy -= cost;

      const b = state.box;
      const bot = state.bot;
      Sound.fire(type, bot.x);

      if (type === "bone") {
        const edge = Math.floor(Math.random() * 4);
        let sx, sy;
        if (edge === 0) { sx = b.x + Math.random() * b.w; sy = b.y - 20; }
        else if (edge === 1) { sx = b.x + b.w + 20; sy = b.y + Math.random() * b.h; }
        else if (edge === 2) { sx = b.x + Math.random() * b.w; sy = b.y + b.h + 20; }
        else { sx = b.x - 20; sy = b.y + Math.random() * b.h; }
        const angle = Math.atan2(bot.y - sy, bot.x - sx);
        state.attacks.push({
          type: "bone", src: "bone", x: sx, y: sy, w: 10, h: 10,
          vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8, dmg: 2, active: true
        });
      } else if (type === "wave") {
        // A wall with the gap left exactly where the target is standing — so it
        // only works if you make it move first.
        const gapY = bot.y;
        for (let yy = b.y; yy < b.y + b.h; yy += 25) {
          if (Math.abs(yy - gapY) > 35) {
            state.attacks.push({
              type: "bone", src: "wave", x: b.x + b.w + 20, y: yy, w: 10, h: 40,
              vx: -4, vy: 0, dmg: 3, active: true
            });
          }
        }
      } else if (type === "void") {
        const vertical = Math.random() > 0.5;
        const firstHalf = Math.random() > 0.5;
        const r = vertical
          ? { x: firstHalf ? b.x : b.x + b.w / 2, y: b.y, w: b.w / 2, h: b.h }
          : { x: b.x, y: firstHalf ? b.y : b.y + b.h / 2, w: b.w, h: b.h / 2 };
        state.attacks.push({
          type: "void", src: "void", x: r.x, y: r.y, w: r.w, h: r.h,
          dmg: 4, active: false, warning: 0.8, lifetime: 0.3
        });
      } else if (type === "swarm") {
        const count = 16;
        for (let i = 0; i < count; i++) {
          const angle = (Math.PI * 2 / count) * i;
          const speed = 4 + Math.random() * 4;
          state.attacks.push({
            type: "bone", src: "swarm", x: b.x + b.w / 2, y: b.y + b.h / 2, w: 12, h: 12,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, dmg: 2, active: true
          });
        }
      } else if (type === "blaster") {
        state.attacks.push({
          type: "blaster", src: "blaster", x: bot.x - 40, y: bot.y - 150, w: 80, h: 80,
          targetX: bot.x, targetY: bot.y,
          dmg: 8, active: false, warning: 0.3, lifetime: 0.4
        });
      } else if (type === "twowaves") {
        const gap1 = b.y + b.h * (Math.random() * 0.4 + 0.1);
        const gap2 = b.y + b.h * (Math.random() * 0.4 + 0.5);
        for (let yy = b.y; yy < b.y + b.h; yy += 25) {
          if (Math.abs(yy - gap1) > 40) {
            state.attacks.push({ type: "bone", src: "twowaves", x: b.x - 20, y: yy, w: 10, h: 40, vx: 6, vy: 0, dmg: 3, active: true });
          }
          if (Math.abs(yy - gap2) > 40) {
            state.attacks.push({ type: "bone", src: "twowaves", x: b.x + b.w + 20, y: yy, w: 10, h: 40, vx: -6, vy: 0, dmg: 3, active: true });
          }
        }
      } else if (type === "freeze") {
        const angle = Math.atan2(bot.y - (b.y - 50), bot.x - (b.x + b.w / 2));
        state.attacks.push({
          type: "freeze", src: "freeze", x: b.x + b.w / 2, y: b.y - 50, w: 30, h: 30,
          vx: Math.cos(angle) * 26, vy: Math.sin(angle) * 26, dmg: 2, active: true, effect: "freeze"
        });
      } else if (type === "grab") {
        const angle = Math.atan2(bot.y - (b.y + b.h + 50), bot.x - (b.x + b.w / 2));
        state.attacks.push({
          type: "grab", src: "grab", x: b.x + b.w / 2, y: b.y + b.h + 50, w: 30, h: 30,
          vx: Math.cos(angle) * 26, vy: Math.sin(angle) * 26, dmg: 2, active: true, effect: "grab"
        });
      } else if (type === "crusher") {
        state.attacks.push({
          type: "crusher", src: "crusher", dmg: 20, active: false,
          warning: 0.8, lifetime: 0.5, maxLifetime: 0.5, effect: "crush"
        });
      }
    }

    // ===================================================================== //
    // 8. The target's dodging — carried over line for line                   //
    // ===================================================================== //
    function clampBot() {
      const b = state.bot, box = state.box;
      b.x = Math.max(box.x + b.size / 2, Math.min(b.x, box.x + box.w - b.size / 2));
      b.y = Math.max(box.y + b.size / 2, Math.min(b.y, box.y + box.h - b.size / 2));
    }

    function evaluatePos(tx, ty) {
      const b = state.bot, box = state.box;
      let danger = 0;

      if (tx < box.x + b.size / 2) danger += 1000 * (box.x + b.size / 2 - tx);
      if (tx > box.x + box.w - b.size / 2) danger += 1000 * (tx - (box.x + box.w - b.size / 2));
      if (ty < box.y + b.size / 2) danger += 1000 * (box.y + b.size / 2 - ty);
      if (ty > box.y + box.h - b.size / 2) danger += 1000 * (ty - (box.y + box.h - b.size / 2));

      for (const att of state.attacks) {
        const ax = att.x + (att.w || 0) / 2;
        const ay = att.y + (att.h || 0) / 2;
        const dist = Math.hypot(tx - ax, ty - ay);

        if (att.type === "void" || att.type === "blaster" || att.type === "crusher") {
          let inZone = false;
          if (att.type === "void") {
            inZone = tx > att.x - 10 && tx < att.x + att.w + 10 && ty > att.y - 10 && ty < att.y + att.h + 10;
          } else if (att.type === "blaster") {
            inZone = Math.abs(tx - att.targetX) < 40;
          } else if (att.type === "crusher") {
            const progress = att.active ? Math.pow(1 - att.lifetime / att.maxLifetime, 2) * CRUSH_REACH : 0;
            const left = box.x + (box.w / 2 * progress) + 40;
            const right = (box.x + box.w) - (box.w / 2 * progress) - 40;
            inZone = tx < left || tx > right;
          }
          if ((att.warning > 0 || att.active) && inZone) {
            danger += 25000 / (Math.max(0, att.warning) + 0.05);
            // A gradient, so it can see its way out of a large zone rather than
            // sitting in the middle of one because every step looks equally bad.
            if (att.type === "void") {
              const distToEdge = Math.min(tx - att.x, att.x + att.w - tx, ty - att.y, att.y + att.h - ty);
              danger += distToEdge * 150;
            } else if (att.type === "blaster") {
              danger += (40 - Math.abs(tx - att.targetX)) * 300;
            } else if (att.type === "crusher") {
              danger += Math.abs(tx - (box.x + box.w / 2)) * 150;
            }
          }
        } else {
          if (dist < (b.size / 2 + Math.max(att.w || 10, att.h || 10))) danger += 1000;
          else danger += 100 / Math.max(1, dist - b.size);
          // Where will this be in fifteen frames?
          if (att.vx || att.vy) {
            const pDist = Math.hypot(tx - (ax + att.vx * 15), ty - (ay + att.vy * 15));
            if (pDist < b.size) danger += 1000;
          }
        }
      }

      danger += Math.hypot(tx - (box.x + box.w / 2), ty - (box.y + box.h / 2)) * 0.1;
      return danger;
    }

    function updateBot(dt) {
      const b = state.bot, box = state.box;
      if (b.invulnTimer > 0) b.invulnTimer -= dt;
      if (b.frozenTimer > 0) { b.frozenTimer -= dt; return; }

      if (b.grabbedTimer > 0) {
        b.grabbedTimer -= dt;
        b.x += (box.x + box.w / 2 - b.x) * 0.1;
        b.y += (box.y + box.h / 2 - b.y) * 0.1;
        return;
      }

      const speed = BOT_SPEED * 60 * dt;
      let lowest = evaluatePos(b.x, b.y);
      let moveX = 0, moveY = 0;
      for (let i = 0; i < 16; i++) {
        const ang = (Math.PI * 2 / 16) * i;
        const tx = b.x + Math.cos(ang) * speed;
        const ty = b.y + Math.sin(ang) * speed;
        const d = evaluatePos(tx, ty);
        if (d < lowest - 1) {          // the -1 keeps it from twitching
          lowest = d;
          moveX = Math.cos(ang) * speed;
          moveY = Math.sin(ang) * speed;
        }
      }
      b.x += moveX;
      b.y += moveY;
      clampBot();
    }

    // ===================================================================== //
    // 9. Update                                                             //
    // ===================================================================== //
    function update(dt) {
      if (state.status !== "playing") return;

      state.timeRemaining -= dt;
      state.elapsed += dt;
      if (state.timeRemaining <= 0) { state.timeRemaining = 0; endGame(false); return; }

      updateBot(dt);

      const b = state.bot;
      for (let i = state.attacks.length - 1; i >= 0; i--) {
        const att = state.attacks[i];
        let remove = false;

        if (att.type === "void" || att.type === "blaster" || att.type === "crusher") {
          if (att.warning > 0) {
            att.warning -= dt;
            if (att.warning <= 0) { att.active = true; state.shake = 0.22; }
          } else if (att.active) {
            att.lifetime -= dt;
            if (att.lifetime <= 0) remove = true;
          }
        } else {
          att.x += att.vx * 60 * dt;
          att.y += att.vy * 60 * dt;
          const box = state.box;
          if (att.x < box.x - 200 || att.x > box.x + box.w + 200 ||
              att.y < box.y - 200 || att.y > box.y + box.h + 200) remove = true;
        }

        if (att.active && (att.nextHit || 0) <= state.elapsed) {
          let hit = false;
          if (att.type === "void") {
            hit = (b.x + b.size / 2 > att.x && b.x - b.size / 2 < att.x + att.w &&
                   b.y + b.size / 2 > att.y && b.y - b.size / 2 < att.y + att.h);
          } else if (att.type === "blaster") {
            hit = Math.abs(b.x - att.targetX) < 30;
          } else if (att.type === "crusher") {
            const box = state.box;
            const progress = Math.pow(1 - att.lifetime / att.maxLifetime, 2) * CRUSH_REACH;
            hit = (b.x - b.size / 2 < box.x + (box.w / 2 * progress) ||
                   b.x + b.size / 2 > (box.x + box.w) - (box.w / 2 * progress));
          } else {
            const rx = b.x - b.size / 2, ry = b.y - b.size / 2;
            hit = (rx < att.x + att.w && rx + b.size > att.x &&
                   ry < att.y + att.h && ry + b.size > att.y);
          }

          if (hit) {
            // Projectiles still do not vanish on contact — a wave that engulfs
            // the target is still worth a great deal — but each attack lands on
            // its own clock rather than once per rendered frame.
            att.nextHit = state.elapsed + DMG_TICK;

            const pinned = b.frozenTimer > 0 || b.grabbedTimer > 0;
            const mult = pinned ? EXPOSED_MULT : GUARD_MULT;
            const dealt = Math.max(1, Math.round(att.dmg * mult));
            b.hp -= dealt;

            if (att.effect === "freeze") b.frozenTimer = 1.5;
            else if (att.effect === "grab") b.grabbedTimer = 1.0;
            else if (att.effect === "crush") {
              b.frozenTimer = 1.5;
              b.y = state.box.y + state.box.h - b.size / 2;
            }
            Sound.hit(dealt, b.x, pinned);
            state.shake = Math.max(state.shake, pinned ? 0.14 : 0.06);
            state.flinch = pinned ? 1 : 0.45;
            floorMat.uniforms.uHit.value = Math.min(0.5, floorMat.uniforms.uHit.value + dealt * 0.014);
            spark(b.x, b.y, ATT_RGB[att.src] || [1, 0.4, 0.4], 3 + Math.min(10, dealt), 120);
            floaters.push({
              x: b.x, y: b.y - 20, life: 1, text: "-" + dealt,
              big: pinned && dealt >= 8, guarded: !pinned
            });
            if (b.hp <= 0) { b.hp = 0; endGame(true); }
          }
        }

        if (remove) state.attacks.splice(i, 1);
      }

      state.energy = Math.min(ENERGY_MAX, state.energy + ENERGY_REGEN * dt);
      state.exposed = state.bot.frozenTimer > 0 || state.bot.grabbedTimer > 0;
      if (state.shake > 0) state.shake -= dt;
      state.flinch = Math.max(0, state.flinch - dt * 5);
      floorMat.uniforms.uHit.value = Math.max(0, floorMat.uniforms.uHit.value - dt * 3.2);
      paintHud();
    }

    const ATT_RGB = {};
    for (const a of ABILITIES) {
      const c = new THREE.Color(a.c);
      ATT_RGB[a.id] = [c.r, c.g, c.b];
    }

    let ghostTimer = 0;
    function paintHud() {
      nodes.timer.textContent = state.timeRemaining.toFixed(1);
      nodes.timer.style.color = state.timeRemaining < 10 ? "#ff5566" : INK;
      const pct = Math.max(0, state.bot.hp / MAX_HP * 100);
      nodes.hpbar.style.width = pct + "%";
      if (!ghostTimer) {
        ghostTimer = ctx.timeout(() => {
          ghostTimer = 0;
          nodes.hpghost.style.width = Math.max(0, state.bot.hp / MAX_HP * 100) + "%";
        }, 140);
      }
      nodes.hptext.textContent = Math.max(0, Math.ceil(state.bot.hp)) + " / " + MAX_HP;

      const ep = (state.energy / ENERGY_MAX) * 100;
      nodes.energy.style.width = ep + "%";
      if (state.exposed) {
        nodes.guard.textContent = "EXPOSED ×" + EXPOSED_MULT;
        nodes.guard.style.color = "#fde68a";
      } else {
        nodes.guard.textContent = "GUARDED ×" + GUARD_MULT;
        nodes.guard.style.color = DIM;
      }
      for (const btn of padButtons) {
        const afford = state.energy >= btn.cost;
        if (btn.afford !== afford) {
          btn.afford = afford;
          btn.el.style.opacity = afford ? "1" : "0.38";
        }
      }
    }

    function flashEnergy() {
      nodes.energywrap.style.transform = "scaleY(1.9)";
      ctx.timeout(() => { nodes.energywrap.style.transform = "scaleY(1)"; }, 130);
    }

    // ===================================================================== //
    // 10. Drawing it                                                        //
    // ===================================================================== //
    function pushQuad(pos, uv, idx, v, tri, cx, cy, cz, hx, hz) {
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (let k = 0; k < 4; k++) {
        const o = (v + k) * 3;
        pos[o] = cx + corners[k][0] * hx;
        pos[o + 1] = cy;
        pos[o + 2] = cz + corners[k][1] * hz;
        uv[(v + k) * 2] = corners[k][0] > 0 ? 1 : 0;
        uv[(v + k) * 2 + 1] = corners[k][1] > 0 ? 1 : 0;
      }
      idx[tri] = v; idx[tri + 1] = v + 1; idx[tri + 2] = v + 2;
      idx[tri + 3] = v + 1; idx[tri + 4] = v + 3; idx[tri + 5] = v + 2;
    }

    function syncScene(dt, clock) {
      const box = state.box, bot = state.bot;

      // --- target
      const frozen = bot.frozenTimer > 0 ? 1 : 0;
      const grabbed = bot.grabbedTimer > 0;
      const bob = Math.sin(clock * 2.4) * 2.6;
      const s = bot.size * (1.05 + state.flinch * 0.45);
      target.position.set(wx(bot.x), ELEV + 6 + bob, wz(bot.y));
      target.rotation.y = clock * (frozen ? 0.25 : 1.35);
      target.rotation.x = Math.sin(clock * 0.9) * 0.35;
      shell.scale.setScalar(s);
      core.scale.setScalar(s * 0.46 * (1 + state.flinch * 0.5));
      shellMat.uniforms.uFlinch.value = state.flinch;
      shellMat.uniforms.uFrozen.value = frozen;
      coreMat.color.setRGB(1, 0.91 - state.flinch * 0.3, 0.93 - state.flinch * 0.4);

      const shSize = bot.size * 2.6;
      shadow.position.set(wx(bot.x), 0.6, wz(bot.y));
      shadow.scale.set(shSize, shSize, 1);

      statusRing.visible = frozen > 0 || grabbed;
      if (statusRing.visible) {
        statusRing.position.set(wx(bot.x), 1.2, wz(bot.y));
        const rs = bot.size * 6;
        statusRing.scale.set(rs, rs, 1);
        ringMat.uniforms.uT.value = clock;
        ringMat.uniforms.uC.value.set(grabbed ? 0xf472b6 : 0x38bdf8);
      }

      // --- projectiles and zones
      let pv = 0, ptri = 0, zv = 0, ztri = 0, beamN = 0;
      let crushProgress = -1;
      for (const att of state.attacks) {
        if (att.type === "bone" || att.type === "freeze" || att.type === "grab") {
          if (pv + 4 > MAXP * 4) continue;
          // A bone lives for 200 units past the arena so the AI can still see
          // it coming; drawing it out there puts a light over the scoreboard.
          const px = att.x + (att.w || 0) / 2, py = att.y + (att.h || 0) / 2;
          if (px < box.x - 26 || px > box.x + box.w + 26 ||
              py < box.y - 26 || py > box.y + box.h + 26) continue;
          const hx = Math.max(3, (att.w || 10) / 2);
          const hz = Math.max(3, (att.h || 10) / 2);
          pushQuad(pjPos, pjUv, pjIdx, pv, ptri,
            wx(att.x + (att.w || 0) / 2), ELEV, wz(att.y + (att.h || 0) / 2),
            hx + 7, hz + 7);
          const rgb = ATT_RGB[att.src] || [1, 1, 1];
          for (let k = 0; k < 4; k++) {
            pjHalf[(pv + k) * 2] = hx;
            pjHalf[(pv + k) * 2 + 1] = hz;
            pjCol[(pv + k) * 3] = rgb[0];
            pjCol[(pv + k) * 3 + 1] = rgb[1];
            pjCol[(pv + k) * 3 + 2] = rgb[2];
          }
          pv += 4; ptri += 6;
        } else if (att.type === "void") {
          if (zv + 4 > MAXZ * 4) continue;
          pushQuad(zPos, zUv, zIdx, zv, ztri,
            wx(att.x + att.w / 2), 1.6, wz(att.y + att.h / 2), att.w / 2, att.h / 2);
          const rgb = ATT_RGB.void;
          for (let k = 0; k < 4; k++) {
            zA[(zv + k) * 2] = att.active ? 1 : 0;
            zA[(zv + k) * 2 + 1] = clock;
            zCol[(zv + k) * 3] = rgb[0]; zCol[(zv + k) * 3 + 1] = rgb[1]; zCol[(zv + k) * 3 + 2] = rgb[2];
          }
          zv += 4; ztri += 6;
        } else if (att.type === "blaster") {
          if (beamN < BEAMS) {
            const b = beams[beamN++];
            b.visible = true;
            b.position.set(wx(att.targetX), (WALL_H + 120) / 2, 0);
            b.scale.set(att.active ? 62 : 16, WALL_H + 120, box.h);
          }
          if (zv + 4 <= MAXZ * 4) {
            pushQuad(zPos, zUv, zIdx, zv, ztri, wx(att.targetX), 1.8, 0, 34, box.h / 2);
            const rgb = ATT_RGB.blaster;
            for (let k = 0; k < 4; k++) {
              zA[(zv + k) * 2] = att.active ? 1 : 0;
              zA[(zv + k) * 2 + 1] = clock;
              zCol[(zv + k) * 3] = rgb[0]; zCol[(zv + k) * 3 + 1] = rgb[1]; zCol[(zv + k) * 3 + 2] = rgb[2];
            }
            zv += 4; ztri += 6;
          }
        } else if (att.type === "crusher") {
          crushProgress = att.active
            ? Math.pow(1 - att.lifetime / att.maxLifetime, 2) * CRUSH_REACH
            : 0.06 + 0.06 * Math.sin(clock * 24);
        }
      }
      for (let i = beamN; i < BEAMS; i++) beams[i].visible = false;
      beamMat.uniforms.uTime.value = clock;
      beamMat.uniforms.uArmed.value = 0;
      for (const att of state.attacks) {
        if (att.type === "blaster" && att.active) { beamMat.uniforms.uArmed.value = 1; break; }
      }

      pjGeo.setDrawRange(0, ptri);
      for (const a of ["position", "uv", "aHalf", "aC"]) pjGeo.attributes[a].needsUpdate = true;
      pjGeo.index.needsUpdate = true;
      zGeo.setDrawRange(0, ztri);
      for (const a of ["position", "uv", "aA", "aC"]) zGeo.attributes[a].needsUpdate = true;
      zGeo.index.needsUpdate = true;

      if (crushProgress >= 0) {
        const reach = (box.w / 2) * crushProgress;
        crushL.visible = crushR.visible = true;
        crushL.position.set(-box.w / 2 + reach / 2, WALL_H * 0.75, 0);
        crushL.scale.set(Math.max(2, reach), WALL_H * 1.5, box.h);
        crushR.position.set(box.w / 2 - reach / 2, WALL_H * 0.75, 0);
        crushR.scale.set(Math.max(2, reach), WALL_H * 1.5, box.h);
      } else {
        crushL.visible = crushR.visible = false;
      }

      // --- sparks
      for (let i = 0; i < SP; i++) {
        if (spLife[i] <= 0) continue;
        spLife[i] -= dt * 1.9;
        if (spLife[i] < 0) spLife[i] = 0;
        spPos[i * 3] += spVel[i * 3] * dt;
        spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt;
        spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
        spVel[i * 3 + 1] -= 260 * dt;
      }
      spGeo.attributes.position.needsUpdate = true;
      spGeo.attributes.aLife.needsUpdate = true;
      spGeo.attributes.aC.needsUpdate = true;
      spGeo.setDrawRange(0, SP);

      // --- tension
      const heat = state.status === "playing"
        ? Math.max(0, 1 - state.timeRemaining / 12) : 0;
      floorMat.uniforms.uHeat.value = heat;
      floorMat.uniforms.uTime.value = clock;
      compMat.uniforms.uHurt.value = heat;
      const wallGlow = 0.55 + heat * 0.9;
      wallMat.emissiveIntensity = wallGlow;
      wallTopMat.color.setRGB(0.21 + heat * 0.75, 0.28 - heat * 0.12, 0.56 - heat * 0.28);

      // --- camera shake
      const sh = Math.max(0, state.shake);
      camera.position.set(
        (Math.random() - 0.5) * sh * 90,
        Math.sin(TILT_R) * 1200 + (Math.random() - 0.5) * sh * 60,
        Math.cos(TILT_R) * 1200
      );
      camera.lookAt(0, 0, 0);
    }

    // Damage numbers, projected from the arena to the screen.
    function syncFloaters(dt) {
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.life -= dt * 1.35;
        f.y -= 44 * dt;
        if (f.life <= 0) floaters.splice(i, 1);
      }
      for (let i = 0; i < FLOATERS; i++) {
        const el = floaterEls[i];
        const f = floaters[floaters.length - 1 - i];
        if (!f) { if (el.style.opacity !== "0") el.style.opacity = "0"; continue; }
        _v.set(wx(f.x), ELEV + 26, wz(f.y)).project(camera);
        const sx = (_v.x * 0.5 + 0.5) * W;
        const sy = (1 - (_v.y * 0.5 + 0.5)) * H;
        if (el.textContent !== f.text) el.textContent = f.text;
        const guarded = !!f.guarded;
        if (el.__guarded !== guarded) {
          el.__guarded = guarded;
          el.style.color = guarded ? "rgba(226,232,240,0.62)" : "#fff";
          el.style.textShadow = guarded ? "none" : "0 0 12px rgba(255,80,100,0.95)";
          el.style.fontWeight = guarded ? "500" : "700";
        }
        el.style.opacity = String(Math.max(0, Math.min(1, f.life)) * (guarded ? 0.8 : 1));
        el.style.transform = "translate(" + (sx - 14) + "px," + (sy - 9) + "px) scale(" +
          (f.big ? 1.5 : 1) * (0.8 + f.life * 0.3) + ")";
      }
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

    // ===================================================================== //
    // 11. Board and lifecycle                                               //
    // ===================================================================== //
    const records = ctx.memory && ctx.memory.record ? ctx.memory.record("clear_time") : null;

    function startGame() {
      state.status = "playing";
      state.timeRemaining = TIME_LIMIT;
      state.elapsed = 0;
      state.attacks.length = 0;
      floaters.length = 0;
      state.bot.hp = MAX_HP;
      state.bot.frozenTimer = 0;
      state.bot.grabbedTimer = 0;
      state.bot.invulnTimer = 0;
      state.energy = ENERGY_MAX;
      state.exposed = false;
      state.bot.x = state.box.x + state.box.w / 2;
      state.bot.y = state.box.y + state.box.h / 2;
      nodes.hpghost.style.width = "100%";
      nodes.curtain.style.display = "none";
      paintHud();
      ctx.platform.start();
    }

    async function endGame(won) {
      state.status = won ? "won" : "lost";
      const secs = state.elapsed;
      if (won) { Sound.win(); ctx.platform.haptic("success"); }
      else { Sound.lose(); ctx.platform.haptic("error"); }

      nodes.title.textContent = won ? "Down in " + secs.toFixed(1) + "s" : "It survived";
      nodes.blurb.innerHTML = won
        ? "A thousand points, gone. Faster next time?"
        : "Sixty seconds up with " + Math.ceil(state.bot.hp) + " points still on it. " +
          "Chip damage will never get there. Herd it with a wave, land a freeze, and put " +
          "everything you have into that second and a half.";
      nodes.go.textContent = "AGAIN";
      nodes.curtain.style.display = "flex";
      nodes.board.innerHTML = "";

      if (won) {
        ctx.platform.complete({ seconds: +secs.toFixed(1) });
        if (state.best === 0 || secs < state.best) { state.best = secs; remember(); }
        if (records) {
          try { await records.submit(Math.round(secs * 1000), { label: secs.toFixed(1) + "s" }); }
          catch (_) { /* board unavailable */ }
        }
      } else {
        ctx.platform.fail({ remainingHp: Math.ceil(state.bot.hp) });
      }
    }

    async function showBoard() {
      nodes.board.innerHTML = '<div style="color:' + DIM + ';padding:12px 0;text-align:center;">Loading…</div>';
      if (!records) {
        nodes.board.innerHTML = '<div style="color:' + DIM +
          ';padding:12px 0;text-align:center;">No leaderboard here.</div>';
        return;
      }
      try {
        const data = await records.leaderboard();
        const entries = (data && data.entries) || [];
        if (!entries.length) {
          nodes.board.innerHTML = '<div style="color:' + DIM + ';padding:12px 0;text-align:center;">' +
            "Nobody has put it down yet.</div>";
          return;
        }
        let html = "";
        for (const e of entries.slice(0, 8)) {
          html += '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;' +
            'border-bottom:1px solid rgba(255,255,255,0.07);font-size:13px;">' +
            '<div style="width:22px;color:' + DIM + ';font-weight:600;">' + (e.rank || "") + "</div>" +
            '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            (e.self ? "color:" + TARGET_C + ";font-weight:600;" : "") + '">' +
            ((e.user && e.user.handle) || "someone") + (e.self ? " (you)" : "") + "</div>" +
            '<div style="font-weight:600;font-variant-numeric:tabular-nums;">' +
            (e.label || ((e.value / 1000).toFixed(1) + "s")) + "</div>" +
            "</div>";
        }
        nodes.board.innerHTML = html;
      } catch (_) {
        nodes.board.innerHTML = '<div style="color:#fca5a5;padding:12px 0;text-align:center;">' +
          "Could not reach the leaderboard.</div>";
      }
    }

    // ===================================================================== //
    // 12. Hands on it                                                       //
    // ===================================================================== //
    const padButtons = [];
    for (const el of pad.querySelectorAll("[data-ab]")) {
      padButtons.push({ el: el, cost: ABILITY_COST[el.getAttribute("data-ab")], afford: true });
    }

    for (const btn of pad.querySelectorAll("[data-ab]")) {
      const id = btn.getAttribute("data-ab");
      ctx.listen(btn, "pointerdown", (e) => {
        e.preventDefault();
        Sound.init();
        Sound.resume();
        const afforded = state.status === "playing" && state.energy >= ABILITY_COST[id];
        useAbility(id);
        btn.style.transform = "scale(0.94)";
        if (afforded) btn.style.background = ABILITY_C[id] + "33";
        ctx.timeout(() => {
          btn.style.transform = "scale(1)";
          btn.style.background = "linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.035))";
        }, 110);
        ctx.platform.haptic(afforded ? "light" : "warning");
        if (afforded) ctx.platform.interact({ kind: "attack", ability: id });
      });
    }
    ctx.listen(nodes.go, "pointerdown", (e) => {
      e.preventDefault(); Sound.init(); Sound.resume(); startGame();
    });
    ctx.listen(nodes.showboard, "pointerdown", (e) => { e.preventDefault(); showBoard(); });

    // ===================================================================== //
    // 13. Remembering                                                       //
    // ===================================================================== //
    // ctx.storage.set() returns nothing on device, so .catch() on it throws.
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
        fireAndForget(() => ctx.storage.set("bosssim", { best: state.best }));
      }, 400);
    }
    if (canStore) {
      try {
        const s = await ctx.storage.get("bosssim");
        if (s && typeof s.best === "number") state.best = s.best;
      } catch (_) { /* first run */ }
    }

    // ===================================================================== //
    // 14. Go                                                                //
    // ===================================================================== //
    ctx.onDestroy(() => {
      Sound.close();
      for (const t of [rtScene, rtA, rtB]) { try { t.dispose(); } catch (_) {} }
      try { renderer.dispose(); } catch (_) {}
    });

    layout();
    state.bot.x = state.box.x + state.box.w / 2;
    state.bot.y = state.box.y + state.box.h / 2;
    paintHud();

    let clock = 0;
    syncScene(0.016, 0);
    draw();
    ctx.markVisualReady("arena drawn");
    ctx.platform.ready();

    ctx.onFrame((dtMs) => {
      if (ctx.width !== W || ctx.height !== H) layout();
      const dt = Math.min(0.05, dtMs / 1000);
      clock += dt;
      update(dt);
      syncScene(dt, clock);
      syncFloaters(dt);
      compMat.uniforms.uTime.value = clock;
      draw();
    });
  }
};
