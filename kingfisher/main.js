/**
 * Kingfisher — one tap to flap, a lake at dawn, and the day turning as you go.
 *
 * The game is a pure model with fixed-step physics and a seeded random
 * stream, so a run is deterministic and the rules can be tested in Node —
 * including an ideal player that has to clear two hundred pillars at every
 * difficulty, which is how "the difficulty scales appropriately" is proved
 * rather than asserted. Everything you see is three@0.164.1 and procedural.
 */
window.plethoraBit = {
  meta: {
    title: "Kingfisher",
    runtime: "plethora-bit@2",
    tags: ["game", "arcade", "3d", "bird", "flappy"],
    permissions: ["haptics", "audio", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const smooth = (t) => t * t * (3 - 2 * t);

    let seed = 0x1f2e3d4c;
    function rnd() {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    }
    const rrange = (a, b) => a + (b - a) * rnd();

    function fireAndForget(thunk) {
      try {
        const r = thunk();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (err) { /* storage unsupported here */ }
    }

    // === MODEL BEGIN
    // Pure: no ctx, DOM or three. Units are metres and seconds. The bird flies
    // along +x; y is up; the water is near y = 0 and the ceiling is soft.
    const MODEL = (function () {
      const G = 30;                 // gravity, m/s^2
      const FLAP_VY = 9.4;          // a flap sets the vertical speed to this
      const VMAX_DOWN = 15;
      const BIRD_R = 0.40;          // collision radius; the body draws at ~0.5
      const WATER_Y = 0.75;
      const CEIL_Y = 12.6;
      const PILLAR_W = 1.2;
      const INSET = 0.05;           // hitbox forgiveness on the pillar edges
      const FIRST_PILLAR_X = 10;
      const LOOKAHEAD = 15;

      function clampM(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
      function lerpM(a, b, t) { return a + (b - a) * t; }

      // The curve. Eases out over sixty pillars and then holds, except for a
      // gentle wind that arrives after forty. Gap starts at 5.4 bird
      // diameters and settles at 3.9; the pace settles at 0.9 s a pillar.
      function difficulty(score) {
        const t = clampM(score / 60, 0, 1);
        const e = 1 - Math.pow(1 - t, 2);
        return {
          speed: lerpM(4.1, 5.8, e),
          gap: lerpM(4.3, 3.1, e),
          spacing: lerpM(5.6, 5.2, e),
          drift: lerpM(1.8, 2.6, e),            // max change of gap centre, pillar to pillar
          wind: score > 40 ? lerpM(0, 1.1, clampM((score - 40) / 60, 0, 1)) : 0
        };
      }

      function newRun(seedValue) {
        return {
          x: 0, y: 6.6, vy: 0, t: 0, dist: 0, score: 0,
          started: false, alive: true, dead: 0, cause: null,
          hover: 0, rot: 0, windT: 0,
          pillars: [], nextX: FIRST_PILLAR_X, nextId: 1,
          rng: (seedValue >>> 0) || 0x9e3779b9
        };
      }
      function rand(run) {
        let s = run.rng;
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        run.rng = s;
        return s / 4294967296;
      }
      function gapBounds(gap) {
        return [WATER_Y + 1.3 + gap / 2, CEIL_Y - 0.9 - gap / 2];
      }
      // How far the gap centre may move between two pillars: the design's
      // drift, capped by what a bird can fly in the clear air between the
      // columns (a four-taps-a-second climb, or a fall from a hover, each with
      // slack), so the generator can never ask for the impossible.
      function reach(d) {
        const T = (d.spacing - PILLAR_W - 2 * BIRD_R) / d.speed;
        return { up: Math.min(d.drift, 5.0 * T), down: Math.min(d.drift, 0.35 * G * T * T) };
      }
      function spawnPillar(run) {
        const d = difficulty(run.score);
        const last = run.pillars.length ? run.pillars[run.pillars.length - 1].cy : 6.6;
        const b = gapBounds(d.gap);
        const r = reach(d);
        const u = rand(run) * 2 - 1;
        let cy = last + (u > 0 ? u * r.up : u * r.down);
        cy = clampM(cy, b[0], b[1]);
        run.pillars.push({ id: run.nextId++, x: run.nextX, cy: cy, gap: d.gap, w: PILLAR_W,
                           passed: false, kind: rand(run) < 0.25 ? 1 : 0 });
        run.nextX += d.spacing;
      }
      function flap(run) {
        if (!run.alive) return false;
        run.started = true;
        run.vy = FLAP_VY;
        return true;
      }
      // Circle against the two columns, each an axis-aligned box shrunk by
      // INSET so a graze that looks clear is clear.
      function hitsPillar(x, y, p) {
        const x0 = p.x - p.w / 2 + INSET, x1 = p.x + p.w / 2 - INSET;
        const topY = p.cy + p.gap / 2 + INSET, botY = p.cy - p.gap / 2 - INSET;
        const dx = x - clampM(x, x0, x1);
        const du = y - Math.max(y, topY);      // up to the upper column's underside
        const dl = y - Math.min(y, botY);      // down to the lower column's top
        const r2 = BIRD_R * BIRD_R;
        return dx * dx + du * du < r2 || dx * dx + dl * dl < r2;
      }
      function kill(run, cause) {
        run.alive = false; run.cause = cause; run.dead = 0;
        run.vy = Math.max(run.vy, 2.5);        // a little bounce, then the fall
        return "die:" + cause;
      }
      /** One fixed step. Returns an event string or null. */
      function step(run, dt) {
        run.t += dt;
        if (!run.started) {
          run.hover = Math.sin(run.t * 3.2) * 0.28;
          return null;
        }
        if (!run.alive) {
          run.dead += dt;
          run.vy = Math.max(-VMAX_DOWN, run.vy - G * dt);
          run.y += run.vy * dt;
          if (run.y < WATER_Y - 0.6) { run.y = WATER_Y - 0.6; run.vy = 0; }
          return null;
        }
        const d = difficulty(run.score);
        run.windT += dt;
        const wind = d.wind * Math.sin(run.windT * 1.7) * 0.5;
        run.vy = Math.max(-VMAX_DOWN, run.vy - G * dt);
        run.y += (run.vy + wind) * dt;
        run.x += d.speed * dt;
        run.dist += d.speed * dt;
        if (run.y > CEIL_Y) { run.y = CEIL_Y; run.vy = Math.min(run.vy, 0); }
        while (run.nextX < run.x + LOOKAHEAD) spawnPillar(run);
        while (run.pillars.length && run.pillars[0].x < run.x - 8) run.pillars.shift();
        if (run.y - BIRD_R < WATER_Y) return kill(run, "water");
        let ev = null;
        for (const p of run.pillars) {
          if (hitsPillar(run.x, run.y, p)) return kill(run, "pillar");
          if (!p.passed && p.x + p.w / 2 < run.x) { p.passed = true; run.score++; ev = "score"; }
        }
        return ev;
      }
      function medal(score) {
        return score >= 100 ? "platinum" : score >= 50 ? "gold" : score >= 25 ? "silver" : score >= 10 ? "bronze" : null;
      }
      return { G, FLAP_VY, BIRD_R, WATER_Y, CEIL_Y, PILLAR_W, FIRST_PILLAR_X,
               difficulty, newRun, rand, reach, spawnPillar, flap, hitsPillar, step, medal, gapBounds };
    })();
    // === MODEL END

    // ===================================================================
    // Sound. A wingbeat, a two-note chime that climbs a step every ten
    // pillars, a thud, a splash, a little fanfare. All synthesised.
    // ===================================================================
    let ac = null, master = null, noiseBuf = null, audioOn = false;
    function initAudio() {
      if (ac || !ctx.capabilities.audio) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.8;
        master.connect(ac.destination);
        const n = ac.sampleRate * 0.6;
        noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        audioOn = true;
      } catch (err) { audioOn = false; }
    }
    ctx.onDestroy(() => { try { if (ac) ac.close(); } catch (err) { /* gone */ } });
    function env(node, at, peak, attack, decay) {
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
      node.connect(gn); gn.connect(master);
    }
    function noise(at, dur, type, freq, q, peak, attack) {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      src.connect(f);
      env(f, at, peak, attack || 0.006, dur);
      src.start(at); src.stop(at + dur + (attack || 0) + 0.05);
    }
    function tone(at, type, f0, f1, dur, peak, attack) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, at);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      env(o, at, peak, attack || 0.005, dur);
      o.start(at); o.stop(at + dur + (attack || 0) + 0.05);
    }
    function sfxFlap() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.003;
      noise(at, 0.1, "bandpass", 700 + Math.random() * 300, 0.8, 0.14, 0.02);
      tone(at, "sine", 300, 480, 0.07, 0.04);
    }
    function sfxPoint(n) {
      if (!audioOn) return;
      const at = ac.currentTime + 0.003;
      const stepUp = Math.min(6, Math.floor(n / 10));
      const f0 = 660 * Math.pow(2, (stepUp * 2) / 12);
      tone(at, "triangle", f0, f0, 0.16, 0.16);
      tone(at + 0.075, "triangle", f0 * 1.5, f0 * 1.5, 0.26, 0.14);
      tone(at + 0.075, "sine", f0 * 3, f0 * 3, 0.12, 0.03);
    }
    function sfxHit() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.002;
      noise(at, 0.16, "lowpass", 420, 0.7, 0.55);
      tone(at, "sine", 150, 48, 0.28, 0.45);
      noise(at, 0.05, "highpass", 2500, 0.5, 0.18);
    }
    function sfxSplash() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.002;
      noise(at, 0.55, "bandpass", 1600, 0.4, 0.34, 0.03);
      noise(at, 0.3, "lowpass", 700, 0.6, 0.28);
      tone(at, "sine", 240, 90, 0.2, 0.18);
    }
    function sfxMedal() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.01;
      [659.3, 784, 987.8, 1318.5].forEach((f, i) => {
        tone(at + i * 0.09, "sine", f, f, 0.45, 0.14, 0.01);
        tone(at + i * 0.09, "triangle", f / 2, f / 2, 0.3, 0.05, 0.01);
      });
    }
    function sfxSwoosh() {
      if (!audioOn) return;
      const at = ac.currentTime + 0.003;
      noise(at, 0.35, "bandpass", 500, 0.6, 0.12, 0.12);
    }
    let musicHandle = null;
    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        if (musicHandle) return;
        musicHandle = await ctx.music.play({
          preset: "drift", scale: "major", root: "D", volume: 0.2, tempo: 92,
          intensity: 0.28, fadeInMs: 1800
        });
      } catch (err) { musicHandle = null; }
    }
    function musicIntensity(v) {
      try { if (musicHandle) musicHandle.setIntensity(v, { fadeMs: 900 }); } catch (err) { /* no bed */ }
    }
    function sting(name) { try { ctx.music.sting(name); } catch (err) { /* no bed */ } }
    function duck(amount, ms) { try { ctx.music.duck(amount, ms); } catch (err) { /* no bed */ } }
    function haptic(kind) { try { ctx.platform.haptic(kind); } catch (err) { /* none */ } }

    // ===================================================================
    // Fonts — approved registry faces, with the system stack underneath.
    // ===================================================================
    const fontsReady = Promise.all([
      ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0", { weight: "400" }),
      ctx.loadFont("DM Serif Display", "dm-serif-display", "1.0.0", { weight: "400", style: "italic" })
    ]).catch(() => null);

    // ===================================================================
    // Three
    // ===================================================================
    const canvas = ctx.createCanvas({ touchAction: "none" });
    let THREE = null;
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e1) {
      try { THREE = await ctx.importModule(THREE_URL); } catch (e2) { THREE = null; }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) {
      ctx.platform.error({ where: "load three", message: "WebGLRenderer missing" });
      ctx.platform.ready();
      return;
    }
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    ctx.onDestroy(() => { try { renderer.dispose(); } catch (err) { /* gone */ } });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 520);
    const _c1 = new THREE.Color(), _c2 = new THREE.Color();
    const _m4 = new THREE.Matrix4(), _pos = new THREE.Vector3(), _scl = new THREE.Vector3(), _q = new THREE.Quaternion();
    const _idq = new THREE.Quaternion();
    const _e = new THREE.Euler();

    // ---- the day. Four moods the world lerps between as the run gets long:
    // ---- dawn, day, dusk, night, and dawn again.
    const MOODS = [
      { top: "#2f4f9e", hor: "#ffb47c", sun: "#ffdcae", deep: "#0e3160", shallow: "#8fbdd9", far: "#7d8fc4", near: "#3a5786", sunI: 1.7, sunC: "#ffd6ae", skyL: "#a9c6ff", gndL: "#4b3a2b", star: 0.15, sunAlt: 0.16 },
      { top: "#2570d0", hor: "#cfe8ff", sun: "#fff7dc", deep: "#0d4a86", shallow: "#8fd1f2", far: "#8eb2e2", near: "#4c7b5b", sunI: 2.3, sunC: "#fff4de", skyL: "#c4e2ff", gndL: "#5c6b4a", star: 0.0, sunAlt: 0.62 },
      { top: "#3e2a6e", hor: "#ff8b5a", sun: "#ffb26e", deep: "#1b1d48", shallow: "#c58077", far: "#8a5b90", near: "#4a3059", sunI: 1.4, sunC: "#ffb284", skyL: "#a184c2", gndL: "#3f2b31", star: 0.25, sunAlt: 0.12 },
      { top: "#060a20", hor: "#1f3462", sun: "#e6efff", deep: "#04081a", shallow: "#243d66", far: "#1a2851", near: "#0f172d", sunI: 0.55, sunC: "#b3c9ff", skyL: "#36467a", gndL: "#0f0f1f", star: 1.0, sunAlt: 0.5 }
    ].map((m) => {
      const o = {};
      for (const k in m) o[k] = typeof m[k] === "string" ? new THREE.Color(m[k]) : m[k];
      return o;
    });
    const mood = {};
    for (const k in MOODS[0]) mood[k] = MOODS[0][k].isColor ? MOODS[0][k].clone() : MOODS[0][k];
    function setMood(t) {
      t = ((t % 1) + 1) % 1;
      const f = t * 4, i = Math.floor(f), j = (i + 1) % 4, u = smooth(f - i);
      for (const k in mood) {
        if (mood[k].isColor) mood[k].copy(MOODS[i][k]).lerp(MOODS[j][k], u);
        else mood[k] = lerp(MOODS[i][k], MOODS[j][k], u);
      }
    }
    const sunDir = new THREE.Vector3(0.35, 0.3, -0.88).normalize();

    // ---- light
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    // the key light comes from the camera's side of the world, so the faces
    // we look at are lit; the sun in the sky is a backdrop, not the lamp
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    scene.add(sun);
    scene.add(sun.target);
    const keyDir = new THREE.Vector3(0.45, 0.85, 0.75).normalize();

    // ---- sky: a dome around the camera with a gradient and the sun in it
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
        sunC: { value: new THREE.Color() }, sunD: { value: sunDir }, glow: { value: 1 }
      },
      vertexShader: [
        "varying vec3 vD;",
        "void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }"
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 top, hor, sunC, sunD; uniform float glow; varying vec3 vD;",
        "void main(){",
        "  vec3 d = normalize(vD);",
        "  float h = clamp(d.y, -0.3, 1.0);",
        "  vec3 col = mix(hor, top, pow(smoothstep(-0.04, 0.55, h), 0.8));",
        "  float s = max(0.0, dot(d, sunD));",
        "  col += sunC * (pow(s, 900.0) * 1.6 + pow(s, 14.0) * 0.32 * glow + pow(s, 3.0) * 0.06 * glow);",
        "  gl_FragColor = vec4(col, 1.0);",
        "}"
      ].join("\n")
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    // ---- stars, only at night
    const starGeo = new THREE.BufferGeometry();
    {
      const n = 500, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = rrange(0, Math.PI * 2), b = Math.acos(rrange(0.05, 1));
        arr[i * 3] = Math.cos(a) * Math.sin(b) * 380; arr[i * 3 + 1] = Math.cos(b) * 380; arr[i * 3 + 2] = Math.sin(a) * Math.sin(b) * 380;
      }
      starGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    }
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    scene.add(stars);

    // ---- a soft disc texture for clouds, the sun and particles
    function discTexture(size, inner, outer) {
      const oc = new OffscreenCanvas(size, size);
      const g = oc.getContext("2d");
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(inner, "rgba(255,255,255,0.85)");
      grad.addColorStop(outer, "rgba(255,255,255,0.18)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(oc);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    const softTex = discTexture(128, 0.25, 0.7);
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sunSprite.scale.setScalar(36);
    sunSprite.renderOrder = -8;
    scene.add(sunSprite);

    // ---- water: a plane with ripples, fresnel and the sun's glitter
    const waterMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        deep: { value: new THREE.Color() }, shallow: { value: new THREE.Color() }, sunC: { value: new THREE.Color() },
        sunD: { value: sunDir }, time: { value: 0 }, fogC: { value: new THREE.Color() }, fogN: { value: 60 }, fogF: { value: 300 }
      },
      vertexShader: [
        "varying vec3 vW;",
        "void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }"
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 deep, shallow, sunC, sunD, fogC; uniform float time, fogN, fogF; varying vec3 vW;",
        "float hash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }",
        "float vnoise(vec2 q){ vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);",
        "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }",
        "void main(){",
        "  vec3 V = normalize(cameraPosition - vW);",
        "  vec2 p = vW.xz;",
        "  // three small waves; the normal is the gradient of their sum",
        "  float a = dot(p, vec2(1.26, 0.98)) + time * 1.3;",
        "  float b = dot(p, vec2(-1.15, 2.53)) + time * 0.9;",
        "  float c = dot(p, vec2(5.3, -1.6)) - time * 2.1;",
        "  vec2 g = 0.02 * cos(a) * vec2(1.26, 0.98) + 0.012 * cos(b) * vec2(-1.15, 2.53) + 0.005 * cos(c) * vec2(5.3, -1.6);",
        "  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));",
        "  float fres = pow(1.0 - max(0.0, dot(N, V)), 2.4);",
        "  vec3 col = mix(deep, shallow, 0.08 + 0.92 * fres);",
        "  // a slow swell of brightness so the near water is not flat",
        "  col *= 0.94 + 0.06 * sin(dot(p, vec2(0.21, 0.13)) + time * 0.4);",
        "  // the sun's glitter: a specular lobe broken up by drifting noise",
        "  vec3 H = normalize(V + sunD);",
        "  float spec = pow(max(0.0, dot(N, H)), 320.0);",
        "  float glit = vnoise(p * 2.6 + vec2(time * 0.6, -time * 0.4)) * vnoise(p * 6.5 - vec2(time * 0.8, time * 0.5));",
        "  glit = smoothstep(0.28, 0.75, glit);",
        "  col += sunC * spec * (0.1 + 2.4 * glit);",
        "  float f = smoothstep(fogN, fogF, distance(cameraPosition, vW));",
        "  col = mix(col, fogC, f);",
        "  gl_FragColor = vec4(col, mix(0.84, 1.0, f));",
        "}"
      ].join("\n")
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = MODEL.WATER_Y;
    water.renderOrder = 2;
    water.frustumCulled = false;
    scene.add(water);
    // the lake bed under the water's edge, so the deep colour reads under the surface
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: 0x06142c }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = MODEL.WATER_Y - 6;
    bed.frustumCulled = false;
    scene.add(bed);

    // ---- ridges: three parallax layers of hills, periodic so they wrap
    const PERIOD = 600;
    function ridge(z, amp, base, seedA, colTop, colBot) {
      const segs = 240, xs = [], w = PERIOD * 2;
      const pos = [], col = [], idx = [];
      const cT = new THREE.Color(colTop), cB = new THREE.Color(colBot);
      for (let i = 0; i <= segs; i++) {
        const x = -w / 2 + (w * i) / segs;
        const k = (x / PERIOD) * Math.PI * 2;
        const h = base + amp * (0.55 * Math.sin(k * 3 + seedA) + 0.3 * Math.sin(k * 7 + seedA * 2.1) + 0.15 * Math.sin(k * 17 + seedA * 3.3) + 0.08 * Math.sin(k * 41 + seedA));
        pos.push(x, h, z, x, MODEL.WATER_Y - 0.2, z);
        col.push(cT.r, cT.g, cT.b, cB.r, cB.g, cB.b);
        xs.push(x);
      }
      for (let i = 0; i < segs; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
      m.frustumCulled = false;
      scene.add(m);
      return m;
    }
    const ridges = [
      { mesh: ridge(-150, 16, 9, 1.3, "#ffffff", "#8c8c8c"), key: "far", mul: 1.0 },
      { mesh: ridge(-95, 9, 5, 4.1, "#ffffff", "#7a7a7a"), key: "far", mul: 0.74 },
      { mesh: ridge(-52, 5, 2.4, 7.7, "#ffffff", "#6e6e6e"), key: "near", mul: 1.0 }
    ];
    scene.fog = new THREE.Fog(0xffffff, 60, 300);

    // ---- clouds: soft billboards at several depths, drifting
    const CLOUD_N = 22;
    const cloudMat = new THREE.MeshBasicMaterial({ map: softTex, transparent: true, depthWrite: false, opacity: 0.85, fog: true });
    const clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cloudMat, CLOUD_N * 2);
    clouds.frustumCulled = false;
    clouds.renderOrder = 1;
    scene.add(clouds);
    const cloudSeeds = [];
    for (let i = 0; i < CLOUD_N; i++) {
      cloudSeeds.push({ x: rrange(-140, 140), y: rrange(14, 34), z: rrange(-130, -40), w: rrange(14, 34), h: rrange(4, 9), sp: rrange(0.4, 1.2), ph: rrange(0, 6.28) });
    }
    const cloudCol = new THREE.Color();

    // ===================================================================
    // Pillars. Stone columns rising from the lake and hanging from the mist,
    // each with a wider cap at the gap so the edge reads. Instanced: one
    // draw for bodies, one for caps, one for their reflections.
    // ===================================================================
    function stoneTexture() {
      const S = 256, oc = new OffscreenCanvas(S, S), g = oc.getContext("2d");
      g.fillStyle = "#8d8779";
      g.fillRect(0, 0, S, S);
      // blocks
      const rows = 8, rh = S / rows;
      for (let r = 0; r < rows; r++) {
        let x = (r % 2) * 18;
        while (x < S) {
          const w = 40 + Math.floor(rnd() * 34);
          const l = 118 + Math.floor(rnd() * 40);
          const warm = rnd() < 0.5;
          g.fillStyle = "rgb(" + (l + (warm ? 10 : -4)) + "," + (l + (warm ? 4 : 0)) + "," + (l - (warm ? 10 : -2)) + ")";
          g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
          x += w;
        }
      }
      // grain
      for (let i = 0; i < 2600; i++) {
        const l = 90 + Math.floor(rnd() * 90);
        g.fillStyle = "rgba(" + l + "," + l + "," + (l - 8) + ",0.35)";
        g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      // moss streaks
      for (let i = 0; i < 26; i++) {
        g.fillStyle = "rgba(70,110,50," + (0.15 + rnd() * 0.25) + ")";
        g.fillRect(rnd() * S, rnd() * S, 4 + rnd() * 10, 30 + rnd() * 90);
      }
      const tex = new THREE.CanvasTexture(oc);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      return tex;
    }
    const stoneTex = stoneTexture();
    const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.92, metalness: 0.0, color: 0xffffff });
    const capMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.85, metalness: 0.0, color: 0xd9d2c4 });
    // The columns are one unit cylinder scaled to each height, so map the
    // stone by world height instead of by the stretched UV: a course of
    // blocks is the same size on a short column and a tall one.
    const worldStone = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n vec4 kfW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);\n vMapUv = vec2(vMapUv.x, kfW.y * 0.14);"
      );
    };
    stoneMat.onBeforeCompile = worldStone;
    capMat.onBeforeCompile = worldStone;
    const reflMat = new THREE.MeshBasicMaterial({ color: 0x0b1a33, transparent: true, opacity: 0.42, side: THREE.DoubleSide, fog: true });
    const POOL = 12;                                  // pillars kept warm; two columns each
    const R_COL = MODEL.PILLAR_W / 2;
    const bodyGeo = new THREE.CylinderGeometry(R_COL * 0.94, R_COL, 1, 22, 1);
    bodyGeo.translate(0, 0.5, 0);                     // unit column from y=0 up; scale.y = height
    const capGeo = new THREE.CylinderGeometry(R_COL * 1.16, R_COL * 1.06, 0.5, 22, 1);
    capGeo.translate(0, 0.25, 0);
    const bodies = new THREE.InstancedMesh(bodyGeo, stoneMat, POOL * 2);
    const caps = new THREE.InstancedMesh(capGeo, capMat, POOL * 2);
    const refl = new THREE.InstancedMesh(bodyGeo, reflMat, POOL);
    for (const m of [bodies, caps, refl]) { m.frustumCulled = false; scene.add(m); }
    refl.renderOrder = 1;
    const kindTint = [new THREE.Color(0xffffff), new THREE.Color(0xd9b8a0)];
    const capTint = [new THREE.Color(0xffffff), new THREE.Color(0xc99f84)];
    const _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    function placePillars(run) {
      let n = 0;
      const W = MODEL.WATER_Y, C = MODEL.CEIL_Y;
      for (let i = 0; i < run.pillars.length && n < POOL; i++) {
        const p = run.pillars[i];
        const topY = p.cy + p.gap / 2, botY = p.cy - p.gap / 2;
        // lower column: from under the water to botY, cap on top
        _pos.set(p.x, W - 6, 0); _scl.set(1, botY - 0.5 - (W - 6), 1);
        _m4.compose(_pos, _idq, _scl); bodies.setMatrixAt(n * 2, _m4);
        _pos.set(p.x, botY - 0.5, 0); _scl.set(1, 1, 1);
        _m4.compose(_pos, _idq, _scl); caps.setMatrixAt(n * 2, _m4);
        // upper column: from topY up into the mist, cap hanging at topY
        _pos.set(p.x, C + 30, 0); _scl.set(1, C + 30 - (topY + 0.5), 1);
        _m4.compose(_pos, _flip, _scl); bodies.setMatrixAt(n * 2 + 1, _m4);
        _pos.set(p.x, topY + 0.5, 0); _scl.set(1, 1, 1);
        _m4.compose(_pos, _flip, _scl); caps.setMatrixAt(n * 2 + 1, _m4);
        // reflection: the lower column mirrored in the water
        _pos.set(p.x, W, 0); _scl.set(1, -(botY - W), 1);
        _m4.compose(_pos, _idq, _scl); refl.setMatrixAt(n, _m4);
        bodies.setColorAt(n * 2, kindTint[p.kind]); bodies.setColorAt(n * 2 + 1, kindTint[p.kind]);
        caps.setColorAt(n * 2, capTint[p.kind]); caps.setColorAt(n * 2 + 1, capTint[p.kind]);
        n++;
      }
      _scl.set(0, 0, 0); _pos.set(0, -100, 0); _m4.compose(_pos, _idq, _scl);
      for (let i = n; i < POOL; i++) { bodies.setMatrixAt(i * 2, _m4); bodies.setMatrixAt(i * 2 + 1, _m4); caps.setMatrixAt(i * 2, _m4); caps.setMatrixAt(i * 2 + 1, _m4); refl.setMatrixAt(i, _m4); }
      bodies.instanceMatrix.needsUpdate = true; caps.instanceMatrix.needsUpdate = true; refl.instanceMatrix.needsUpdate = true;
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
      if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
    }

    // ===================================================================
    // The bird. A kingfisher out of spheres: cobalt back, orange breast,
    // white throat, a dagger of a beak. Wings hinge at the shoulder.
    // ===================================================================
    const bird = new THREE.Group();
    scene.add(bird);
    const blue = new THREE.MeshStandardMaterial({ color: 0x1590cf, roughness: 0.55, metalness: 0.05 });
    const deepBlue = new THREE.MeshStandardMaterial({ color: 0x0b5f95, roughness: 0.6 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xf0842a, roughness: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.8 });
    const black = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.4 });
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    function part(geo, mat, x, y, z, sx, sy, sz, parent) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx || 1, sy || 1, sz || 1);
      (parent || bird).add(m);
      return m;
    }
    const sphereGeo = new THREE.SphereGeometry(0.5, 22, 16);
    part(sphereGeo, blue, 0, 0, 0, 1.2, 0.86, 0.86);                       // body
    part(sphereGeo, orange, 0.02, -0.14, 0, 1.0, 0.7, 0.8);               // breast
    part(sphereGeo, blue, 0.5, 0.26, 0, 0.74, 0.7, 0.7);                   // head
    part(sphereGeo, white, 0.62, 0.04, 0, 0.36, 0.26, 0.5);                // throat
    part(sphereGeo, orange, 0.56, 0.2, 0.3, 0.2, 0.16, 0.1);              // cheek
    part(sphereGeo, orange, 0.56, 0.2, -0.3, 0.2, 0.16, 0.1);
    const beak = part(new THREE.ConeGeometry(0.09, 0.7, 12), black, 1.06, 0.2, 0, 1, 1, 1);
    beak.rotation.z = -Math.PI / 2;
    for (const s of [1, -1]) {
      part(sphereGeo, black, 0.7, 0.33, s * 0.22, 0.17, 0.17, 0.12);      // eye
      part(sphereGeo, shine, 0.74, 0.36, s * 0.26, 0.05, 0.05, 0.05);     // glint
    }
    const tail = part(new THREE.BoxGeometry(0.5, 0.06, 0.3), deepBlue, -0.66, 0.02, 0, 1, 1, 1);
    tail.rotation.z = 0.25;
    const wingGeo = new THREE.SphereGeometry(0.5, 16, 10);
    const wings = [];
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(-0.06, 0.22, s * 0.26);
      bird.add(pivot);
      const w = new THREE.Mesh(wingGeo, deepBlue);
      w.position.set(-0.08, 0, s * 0.48);
      w.scale.set(0.58, 0.07, 1.0);
      pivot.add(w);
      const tip = new THREE.Mesh(wingGeo, blue);
      tip.position.set(-0.16, 0.01, s * 0.86);
      tip.scale.set(0.34, 0.05, 0.36);
      pivot.add(tip);
      wings.push({ pivot, s });
    }
    // the bird's shadow on the water, a soft dark disc that tightens as it dives
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: softTex, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 3;
    scene.add(shadow);
    const look = { rot: 0, flapT: 9, spin: 0 };
    function placeBird(x, y, rot, alive, t) {
      bird.position.set(x, y, 0);
      bird.rotation.set(0, 0, rot);
      if (!alive) bird.rotation.x = look.spin;
      // wings: a quick downstroke on each flap, a lazy beat otherwise
      let ang;
      if (look.flapT < 0.28) ang = lerp(0.35, -1.05, Math.sin(Math.PI * (look.flapT / 0.28)));
      else ang = 0.35 + Math.sin(t * 5.2) * 0.12;
      if (!alive) ang = 0.9;
      for (const w of wings) w.pivot.rotation.x = -w.s * ang;
      const h = clamp((y - MODEL.WATER_Y) / 8, 0, 1);
      shadow.position.set(x, MODEL.WATER_Y + 0.02, 0);
      shadow.scale.set(lerp(1.4, 2.6, h), lerp(1.0, 1.8, h), 1);
      shadow.material.opacity = lerp(0.42, 0.06, h);
    }

    // ===================================================================
    // Particles: feathers, spray, sparks. One instanced quad pool.
    // ===================================================================
    const PN = 160;
    const partMat = new THREE.MeshBasicMaterial({ map: softTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const parts = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), partMat, PN);
    parts.frustumCulled = false;
    parts.renderOrder = 4;
    scene.add(parts);
    const P = [];
    for (let i = 0; i < PN; i++) P.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, s: 0.1, rot: 0, spin: 0, kind: 0, drag: 0, col: new THREE.Color() });
    let pNext = 0;
    function emit(kind, x, y, z, vx, vy, vz, life, size, col, g, drag) {
      const q = P[pNext]; pNext = (pNext + 1) % PN;
      q.kind = kind; q.x = x; q.y = y; q.z = z; q.vx = vx; q.vy = vy; q.vz = vz;
      q.life = life; q.max = life; q.s = size; q.col.set(col); q.g = g; q.drag = drag || 0;
      q.rot = rrange(0, 6.28); q.spin = rrange(-6, 6);
    }
    function emitFeathers(x, y) {
      for (let i = 0; i < 2; i++) emit(0, x - 0.2, y + 0.1, rrange(-0.4, 0.4), rrange(-2.5, -1), rrange(0.5, 2), rrange(-1, 1), rrange(0.7, 1.1), rrange(0.16, 0.24), i ? 0xbfe6ff : 0xffffff, 3.5, 2.2);
    }
    function emitSparks(x, y, col) {
      for (let i = 0; i < 14; i++) {
        const a = rrange(0, 6.28), sp = rrange(2, 6.5);
        emit(2, x, y, rrange(-0.3, 0.3), Math.cos(a) * sp, Math.sin(a) * sp + 1.5, rrange(-1, 1), rrange(0.35, 0.65), rrange(0.1, 0.2), col, 7, 1.5);
      }
    }
    function emitSplash(x) {
      const y = MODEL.WATER_Y;
      for (let i = 0; i < 34; i++) {
        const a = rrange(0, 6.28), sp = rrange(0.5, 3.2);
        emit(1, x, y + 0.05, rrange(-0.5, 0.5), Math.cos(a) * sp, rrange(5, 11), Math.sin(a) * sp, rrange(0.5, 0.9), rrange(0.12, 0.3), i % 3 ? 0xcfe9ff : 0xffffff, 26, 0.4);
      }
    }
    function stepParts(dt) {
      let any = false;
      for (let i = 0; i < PN; i++) {
        const q = P[i];
        if (q.life <= 0) { _scl.set(0, 0, 0); _pos.set(0, -50, 0); _m4.compose(_pos, _idq, _scl); parts.setMatrixAt(i, _m4); continue; }
        any = true;
        q.life -= dt;
        q.vy -= q.g * dt;
        const k = 1 - Math.min(1, q.drag * dt);
        q.vx *= k; q.vz *= k; if (q.kind !== 1) q.vy *= k;
        if (q.kind === 0) q.vx += Math.sin(q.life * 9 + q.rot) * 2.2 * dt * 3;   // feathers flutter
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        q.rot += q.spin * dt;
        if (q.kind === 1 && q.y < MODEL.WATER_Y - 0.05) q.life = 0;
        const u = q.life / q.max;
        const sz = q.s * (q.kind === 2 ? u : q.kind === 0 ? 1 : 0.6 + 0.4 * u);
        _pos.set(q.x, q.y, q.z); _scl.set(sz * (q.kind === 0 ? 1.8 : 1), sz, 1);
        _e.set(0, 0, q.rot); _q.setFromEuler(_e);
        _m4.compose(_pos, _q, _scl); parts.setMatrixAt(i, _m4);
        parts.setColorAt(i, q.col);
      }
      parts.instanceMatrix.needsUpdate = true;
      if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
      return any;
    }
    // splash rings on the water
    const rings = [];
    const ringGeo = new THREE.RingGeometry(0.8, 1, 40);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = MODEL.WATER_Y + 0.03;
      m.renderOrder = 3;
      scene.add(m);
      rings.push({ mesh: m, t: 9, x: 0 });
    }
    function splashRing(x) {
      const r = rings.reduce((a, b) => (a.t > b.t ? a : b));
      r.t = 0; r.x = x;
    }
    function stepRings(dt) {
      for (const r of rings) {
        r.t += dt;
        const u = r.t / 1.1;
        if (u >= 1) { r.mesh.material.opacity = 0; continue; }
        r.mesh.position.x = r.x;
        const s = 0.6 + easeOut(u) * 4.2;
        r.mesh.scale.set(s, s * 0.55, 1);
        r.mesh.material.opacity = 0.55 * (1 - u);
      }
    }

    // ===================================================================
    // Chrome. Title, HUD, medal toasts, the game-over card, a flash. None
    // of it takes the finger: the whole screen is the one button.
    // ===================================================================
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";
    const DISPLAY = '"Bebas Neue","Oswald","Impact",system-ui,sans-serif';
    const SERIF = '"DM Serif Display",Georgia,"Times New Roman",serif';
    const BODY = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    ui.innerHTML = [
      "<style>",
      ".kf{position:absolute;inset:0;pointer-events:none;color:#fff;font-family:" + BODY + ";",
      "-webkit-user-select:none;user-select:none;overflow:hidden}",
      ".kf *{box-sizing:border-box}",
      ".kf .vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 58%,rgba(0,0,0,.26) 100%)}",
      ".kf .hud{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 16px);text-align:center;opacity:0;transition:opacity .3s}",
      ".kf .hud.on{opacity:1}",
      ".kf .score{display:inline-block;font-family:" + DISPLAY + ";font-size:80px;line-height:1;letter-spacing:.02em;",
      "text-shadow:0 3px 0 rgba(0,0,0,.16),0 12px 30px rgba(0,0,0,.28)}",
      ".kf .score.pop{animation:kfpop .34s cubic-bezier(.2,1.6,.4,1)}",
      "@keyframes kfpop{0%{transform:scale(1)}35%{transform:scale(1.3)}100%{transform:scale(1)}}",
      ".kf .best{font-size:12px;letter-spacing:.3em;text-transform:uppercase;opacity:.85;margin-top:2px;text-shadow:0 1px 6px rgba(0,0,0,.45)}",
      ".kf .title{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 11vh);text-align:center;opacity:0;",
      "transform:translateY(10px);transition:opacity .45s,transform .45s}",
      ".kf .title.on{opacity:1;transform:translateY(0)}",
      ".kf .name{font-family:" + DISPLAY + ";font-size:min(19vw,104px);line-height:.92;letter-spacing:.06em;white-space:nowrap;",
      "text-shadow:0 4px 0 rgba(0,0,0,.14),0 20px 44px rgba(0,0,0,.3)}",
      ".kf .tag{font-family:" + SERIF + ";font-style:italic;font-size:min(6.2vw,26px);opacity:.94;margin-top:8px;text-shadow:0 1px 10px rgba(0,0,0,.4)}",
      ".kf .bestline{margin-top:16px;font-size:12px;letter-spacing:.26em;text-transform:uppercase;opacity:.82;text-shadow:0 1px 6px rgba(0,0,0,.45)}",
      ".kf .prompt{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 15vh);text-align:center;opacity:0;transition:opacity .3s}",
      ".kf .prompt.on{opacity:1}",
      ".kf .prompt span{display:inline-block;font-family:" + DISPLAY + ";font-size:28px;letter-spacing:.22em;",
      "text-shadow:0 2px 10px rgba(0,0,0,.4);animation:kfpulse 1.6s ease-in-out infinite}",
      "@keyframes kfpulse{0%,100%{opacity:.6;transform:translateY(0)}50%{opacity:1;transform:translateY(-5px)}}",
      ".kf .toast{position:absolute;left:0;right:0;top:33%;text-align:center;font-family:" + DISPLAY + ";font-size:min(17vw,86px);",
      "letter-spacing:.14em;opacity:0;text-shadow:0 4px 0 rgba(0,0,0,.15),0 16px 40px rgba(0,0,0,.3)}",
      ".kf .toast.on{animation:kftoast 1.6s cubic-bezier(.2,1.4,.4,1) forwards}",
      "@keyframes kftoast{0%{opacity:0;transform:scale(.6)}18%{opacity:1;transform:scale(1.1)}30%{transform:scale(1)}78%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.08) translateY(-24px)}}",
      ".kf .over{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .35s}",
      ".kf .over.on{opacity:1}",
      ".kf .card{width:min(78vw,340px);padding:22px 22px 18px;border-radius:24px;background:rgba(10,16,38,.58);",
      "border:1px solid rgba(255,255,255,.2);box-shadow:0 30px 80px rgba(0,0,0,.4);text-align:center;transform:translateY(28px);",
      "transition:transform .5s cubic-bezier(.2,1.2,.3,1)}",
      ".kf .over.on .card{transform:translateY(0)}",
      ".kf .card .h{font-family:" + SERIF + ";font-style:italic;font-size:22px;opacity:.9}",
      ".kf .card .n{font-family:" + DISPLAY + ";font-size:96px;line-height:1;margin-top:2px}",
      ".kf .card .m{display:inline-block;margin-top:8px;padding:6px 16px;border-radius:999px;font-family:" + DISPLAY + ";font-size:20px;letter-spacing:.2em}",
      ".kf .card .m.bronze{background:#8f5b2a}.kf .card .m.silver{background:#97a3b3;color:#0f1828}",
      ".kf .card .m.gold{background:#e6b53c;color:#3a2600}.kf .card .m.platinum{background:#e9f3ff;color:#1a2a44}",
      ".kf .card .b{margin-top:12px;font-size:12px;letter-spacing:.28em;text-transform:uppercase;opacity:.8}",
      ".kf .card .b.new{color:#ffd76a;opacity:1}",
      ".kf .card .p{margin-top:16px;font-family:" + DISPLAY + ";font-size:22px;letter-spacing:.22em;animation:kfpulse 1.6s ease-in-out infinite}",
      ".kf .flash{position:absolute;inset:0;background:#fff;opacity:0}",
      "</style>",
      '<div class="kf">',
      '<div class="vig"></div>',
      '<div class="hud" data-hud><div class="score" data-score>0</div><div class="best" data-best></div></div>',
      '<div class="title" data-title><div class="name">KINGFISHER</div><div class="tag">one tap to fly. the lake does the rest.</div><div class="bestline" data-bestline></div></div>',
      '<div class="prompt" data-prompt><span>TAP TO FLY</span></div>',
      '<div class="toast" data-toast></div>',
      '<div class="over" data-over><div class="card"><div class="h" data-cause></div><div class="n" data-final>0</div>',
      '<div class="m" data-medal></div><div class="b" data-bestover></div><div class="p">TAP TO FLY AGAIN</div></div></div>',
      '<div class="flash" data-flash></div>',
      "</div>"
    ].join("");
    const $ = (sel) => ui.querySelector(sel);
    const el = {
      hud: $("[data-hud]"), score: $("[data-score]"), best: $("[data-best]"), title: $("[data-title]"),
      bestline: $("[data-bestline]"), prompt: $("[data-prompt]"), toast: $("[data-toast]"), over: $("[data-over]"),
      cause: $("[data-cause]"), final: $("[data-final]"), medal: $("[data-medal]"), bestover: $("[data-bestover]"), flash: $("[data-flash]")
    };

    // ===================================================================
    // State
    // ===================================================================
    const UI = { state: "title", overT: 0, best: 0, newBest: false };
    const KEY_BEST = "kingfisher.best";
    let run = MODEL.newRun(1);
    const prev = { x: 0, y: 6.6 };
    const DT = 1 / 120;
    let acc = 0, hitStop = 0, shake = 0, flashA = 0, splashed = false, lastMedal = null, started = false;
    const input = { flaps: 0 };
    const world = { dayT: 0.02 };
    let dayBase = 0.02;
    const cam = { x: 0, y: 7.2, lead: 3 };

    function setState(s) {
      UI.state = s;
      el.title.classList.toggle("on", s === "title");
      el.prompt.classList.toggle("on", s === "title" || s === "ready");
      el.hud.classList.toggle("on", s === "play" || s === "ready");
      el.over.classList.toggle("on", s === "over");
      ui.setAttribute("data-state", s);
    }
    async function loadBest() {
      try {
        const v = await Promise.race([ctx.storage.get(KEY_BEST), new Promise((res) => ctx.timeout(() => res(null), 1500))]);
        if (typeof v === "number" && v > 0) UI.best = Math.floor(v);
      } catch (err) { /* no storage here */ }
    }
    function showBest() {
      el.best.textContent = UI.best > 0 ? "best " + UI.best : "";
      const m = MODEL.medal(UI.best);
      el.bestline.textContent = UI.best > 0 ? "best " + UI.best + (m ? " · " + m : "") : "";
    }
    function firstGesture() {
      if (started) return;
      started = true;
      initAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (err) { /* blocked */ } }
      startMusic();
      ctx.platform.start();
    }
    function newRun() {
      const seedValue = ((Date.now() & 0xffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
      run = MODEL.newRun(seedValue || 1);
      prev.x = run.x; prev.y = run.y;
      acc = 0; hitStop = 0; input.flaps = 0; splashed = false; lastMedal = null;
      UI.newBest = false; UI.overT = 0;
      look.rot = 0; look.spin = 0; look.flapT = 9;
      el.score.textContent = "0";
      placePillars(run);
    }
    function onTap() {
      if (UI.state === "title" || UI.state === "ready") {
        firstGesture();
        dayBase = world.dayT;
        setState("play");
        ctx.platform.interact({ kind: "start" });
        input.flaps++;
        return;
      }
      if (UI.state === "play") { input.flaps++; return; }
      if (UI.state === "over" && UI.overT > 0.7) {
        newRun();
        setState("ready");
        sfxSwoosh();
      }
    }
    function doFlap() {
      if (!MODEL.flap(run)) return;
      look.flapT = 0;
      sfxFlap();
      emitFeathers(run.x, run.y);
    }
    function medalToast(m) {
      el.toast.textContent = m.toUpperCase();
      el.toast.classList.remove("on");
      void el.toast.offsetWidth;
      el.toast.classList.add("on");
      sfxMedal(); sting("success"); haptic("success");
      ctx.platform.milestone("medal_" + m, { score: run.score });
      emitSparks(run.x, run.y + 0.8, m === "gold" ? 0xffd040 : m === "silver" ? 0xe8f0ff : m === "platinum" ? 0xc8f0ff : 0xe09a5a);
    }
    function splashNow() {
      splashed = true;
      emitSplash(run.x); splashRing(run.x);
      sfxSplash(); haptic("medium");
      shake = Math.max(shake, 0.3);
    }
    function onDeath(inWater) {
      hitStop = inWater ? 0.05 : 0.085;
      shake = inWater ? 0.4 : 0.7;
      flashA = inWater ? 0.4 : 0.85;
      sfxHit(); haptic("heavy"); duck(0.7, 1400);
      if (inWater) splashNow(); else emitSparks(run.x + 0.3, run.y, 0xd8d0c0);
      el.cause.textContent = inWater ? "into the lake" : "into the stone";
      el.final.textContent = String(run.score);
      const m = MODEL.medal(run.score);
      el.medal.textContent = m ? m.toUpperCase() : "";
      el.medal.className = "m " + (m || "");
      el.medal.style.display = m ? "" : "none";
      UI.newBest = run.score > UI.best;
      if (UI.newBest) {
        UI.best = run.score;
        fireAndForget(() => ctx.storage.set(KEY_BEST, UI.best));
        fireAndForget(() => ctx.memory.record("score").submit(UI.best, { label: UI.best + " pillars" }));
      }
      el.bestover.textContent = UI.newBest ? "new best" : (UI.best > 0 ? "best " + UI.best : "");
      el.bestover.classList.toggle("new", UI.newBest);
      showBest();
      musicIntensity(0.28);
      ctx.platform.fail({ score: run.score, cause: run.cause, best: UI.best });
      const dead = run;
      ctx.timeout(() => {
        if (run !== dead || run.alive) return;
        setState("over");
        sting(UI.newBest ? "win" : "lose");
      }, 900);
    }
    function onEvent(ev) {
      if (ev === "score") {
        sfxPoint(run.score); haptic("light");
        el.score.textContent = String(run.score);
        el.score.classList.remove("pop");
        void el.score.offsetWidth;
        el.score.classList.add("pop");
        let pp = null;
        for (const q of run.pillars) if (q.passed && (!pp || q.x > pp.x)) pp = q;
        if (pp) emitSparks(pp.x, pp.cy, 0xffd76a);
        ctx.platform.setScore(run.score, { score: run.score });
        const m = MODEL.medal(run.score);
        if (m && m !== lastMedal) { lastMedal = m; medalToast(m); }
        if (run.score % 10 === 0) musicIntensity(clamp(0.28 + run.score / 110, 0.28, 0.85));
      } else if (ev === "die:pillar") {
        onDeath(false);
      } else if (ev === "die:water") {
        onDeath(true);
      }
    }

    // ===================================================================
    // Input: anywhere on the screen, or space on a keyboard
    // ===================================================================
    ctx.listen(canvas, "pointerdown", (e) => {
      if (typeof e.button === "number" && e.button > 0) return;
      onTap();
    });
    ctx.listen(window, "keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); onTap(); }
    });

    // ===================================================================
    // Simulation: fixed 120 Hz steps, an accumulator that never spirals,
    // taps queued so none is lost between frames, a hit-stop on death.
    // ===================================================================
    function simulate(dt) {
      acc += dt;
      if (acc > 0.1) acc = 0.1;
      while (acc >= DT) {
        acc -= DT;
        if (hitStop > 0) { hitStop -= DT; continue; }
        prev.x = run.x; prev.y = run.y;
        if (input.flaps > 0) { input.flaps = 0; doFlap(); }
        const ev = MODEL.step(run, DT);
        if (ev) onEvent(ev);
      }
    }

    // ===================================================================
    // Camera and world
    // ===================================================================
    function updateCamera(bx, by, dt, t) {
      const targetY = 7.0 + (by - 6.6) * 0.32;
      cam.y += (targetY - cam.y) * Math.min(1, dt * 6);
      cam.x = bx;
      shake = Math.max(0, shake - dt * 1.7);
      const a = shake * shake * 1.1;
      const sx = a * Math.sin(t * 67.3), sy = a * Math.cos(t * 53.1);
      const sway = UI.state === "title" ? Math.sin(t * 0.35) * 0.6 : 0;
      camera.position.set(cam.x + cam.lead - 4.5 + sx + sway, cam.y + 2.4 + sy, 30);
      camera.lookAt(cam.x + cam.lead + 1.2 + sx, cam.y - 0.4 + sy, 0);
    }
    function updateWorld(t, dt) {
      if (UI.state === "title" || UI.state === "ready") world.dayT += dt * 0.01;
      else if (UI.state === "play") world.dayT = dayBase + run.dist / 620;
      setMood(world.dayT);
      sunDir.set(0.42, mood.sunAlt, -0.9).normalize();
      skyMat.uniforms.top.value.copy(mood.top);
      skyMat.uniforms.hor.value.copy(mood.hor);
      skyMat.uniforms.sunC.value.copy(mood.sun);
      skyMat.uniforms.glow.value = 1 - mood.star * 0.75;
      sky.position.copy(camera.position);
      stars.position.copy(camera.position);
      starMat.opacity = mood.star * 0.9;
      sunSprite.position.copy(camera.position).addScaledVector(sunDir, 380);
      sunSprite.material.color.copy(mood.sun);
      sunSprite.scale.setScalar(lerp(36, 20, mood.star));
      waterMat.uniforms.deep.value.copy(mood.deep);
      waterMat.uniforms.shallow.value.copy(mood.shallow);
      waterMat.uniforms.sunC.value.copy(mood.sunC);
      waterMat.uniforms.fogC.value.copy(mood.hor);
      waterMat.uniforms.time.value = t;
      water.position.x = cam.x; bed.position.x = cam.x;
      scene.fog.color.copy(mood.hor);
      hemi.color.copy(mood.skyL); hemi.groundColor.copy(mood.gndL);
      sun.color.copy(mood.sunC); sun.intensity = mood.sunI;
      sun.position.copy(bird.position).addScaledVector(keyDir, 40);
      sun.target.position.copy(bird.position);
      for (const r of ridges) {
        r.mesh.material.color.copy(mood[r.key]).multiplyScalar(r.mul);
        r.mesh.position.x = Math.round(cam.x / PERIOD) * PERIOD;
      }
      cloudCol.copy(mood.hor).lerp(_c1.set(0xffffff), 0.5).multiplyScalar(1 - mood.star * 0.55);
      cloudMat.color.copy(cloudCol);
      for (let i = 0; i < CLOUD_N; i++) {
        const c = cloudSeeds[i];
        let dx = c.x + t * c.sp * 0.5 - cam.x;
        dx = ((dx + 160) % 320 + 320) % 320 - 160;
        const y = c.y + Math.sin(t * 0.2 + c.ph) * 0.4;
        _pos.set(cam.x + dx, y, c.z);
        _scl.set(c.w, c.h, 1);
        _m4.compose(_pos, _idq, _scl);
        clouds.setMatrixAt(i * 2, _m4);
        _pos.set(cam.x + dx + c.w * 0.28, y + c.h * 0.3, c.z + 0.5);
        _scl.set(c.w * 0.55, c.h * 0.8, 1);
        _m4.compose(_pos, _idq, _scl);
        clouds.setMatrixAt(i * 2 + 1, _m4);
      }
      clouds.instanceMatrix.needsUpdate = true;
    }

    // ===================================================================
    // Frame
    // ===================================================================
    let W = 1, H = 1, lastW = 0, lastH = 0;
    function resize() {
      W = ctx.width; H = ctx.height;
      camera.aspect = W / Math.max(1, H);
      camera.fov = camera.aspect < 0.8 ? 50 : 38;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H, false);
      const visW = 2 * 30 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
      cam.lead = visW * 0.2;
      fitTitle();
    }
    // the title must fit whatever face the device fell back to
    const nameEl = ui.querySelector(".name");
    function fitTitle() {
      let px = Math.min(104, W * 0.19);
      nameEl.style.fontSize = px + "px";
      for (let i = 0; i < 8 && nameEl.scrollWidth > W - 28; i++) {
        px *= 0.92;
        nameEl.style.fontSize = px + "px";
      }
    }
    ctx.onFrame((dtMs, timeMs) => {
      const dt = clamp(dtMs / 1000, 0.001, 0.1);
      const t = timeMs / 1000;
      if (ctx.width !== lastW || ctx.height !== lastH) { lastW = ctx.width; lastH = ctx.height; resize(); }
      simulate(dt);
      if (UI.state === "over") UI.overT += dt;
      if (!run.alive && !splashed && run.y - MODEL.BIRD_R <= MODEL.WATER_Y + 0.05) splashNow();
      look.flapT += dt;
      const alpha = clamp(acc / DT, 0, 1);
      const bx = lerp(prev.x, run.x, alpha);
      const by = run.started ? lerp(prev.y, run.y, alpha) : run.y + run.hover;
      let targetRot;
      if (!run.started) targetRot = Math.sin(t * 3.2) * 0.06;
      else if (run.alive) targetRot = clamp(Math.atan2(run.vy, MODEL.difficulty(run.score).speed) * 0.8, -1.2, 0.45);
      else { targetRot = -1.5; look.spin += dt * 5.5; }
      look.rot += (targetRot - look.rot) * Math.min(1, dt * (run.alive ? 9 : 4));
      placeBird(bx, by, look.rot, run.alive, t);
      placePillars(run);
      updateCamera(bx, by, dt, t);
      updateWorld(t, dt);
      stepParts(dt);
      stepRings(dt);
      if (flashA > 0) { flashA = Math.max(0, flashA - dt * 3.2); el.flash.style.opacity = flashA.toFixed(3); }
      renderer.render(scene, camera);
    });

    // ===================================================================
    // Boot
    // ===================================================================
    await Promise.race([fontsReady, new Promise((res) => ctx.timeout(res, 2500))]);
    await loadBest();
    showBest();
    newRun();
    setState("title");
    W = ctx.width; H = ctx.height; lastW = W; lastH = H;
    resize();
    setMood(world.dayT);
    placeBird(0, 6.6, 0, true, 0);
    updateCamera(0, 6.6, 1, 0);
    updateWorld(0, 0.016);
    stepParts(0.016);
    renderer.render(scene, camera);
    ctx.markVisualReady("first frame");
    ctx.platform.ready();
  }
};
