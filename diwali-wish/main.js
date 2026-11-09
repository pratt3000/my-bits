// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
/**
 * Happy Diwali from Plethora — a Diwali greeting to open with the sound on.
 *
 * A courtyard at night. Tap the diya to light it; the flame spreads from lamp
 * to lamp across the courtyard, a rangoli draws itself on the stone, a sky
 * lantern lifts off, fireworks climb over the rooftops and burst into the
 * words of the wish. Everything is built at runtime: the house, the lamps, the
 * rangoli, the lanterns, the fireworks and every sound.
 */
window.plethoraBit = {
  meta: {
    title: "Happy Diwali from Plethora",
    runtime: "plethora-bit@2",
    tags: ["diwali", "festival", "greeting", "fireworks", "3d", "art"],
    permissions: ["audio", "haptics"]
  },
  async init(ctx) {
    // ====================================================================== //
    // 1. Surfaces, the library, the phase clock                              //
    // ====================================================================== //
    const SENDER = "Plethora";
    const WISH_LINE = "Happy Diwali";
    const FONT_UI = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', sans-serif";
    const DISPLAY_FAMILY = "DiyaDisplay";
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const hash2 = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    const TAU = Math.PI * 2;

    // The night sits under everything while the library and the font load.
    const canvas = ctx.createCanvas({ touchAction: "none", layer: "content" });
    const ui = ctx.createRoot({ touchAction: "none", layer: "overlay", input: "passthrough", style: "pointer-events:none;font-family:" + FONT_UI + ";color:#f3eee6;background:#070b14;" });

    let THREE = null, fontReady = false;
    try {
      const [mod, font] = await Promise.all([
        ctx.importModule("three", "0.164.1"),
        ctx.loadFont(DISPLAY_FAMILY, "dm-serif-display", "1.0.0", { weight: "400", style: "normal" }).then(() => true, () => false)
      ]);
      THREE = mod; fontReady = font;
    } catch (err) {
      ui.style.background = "#070b14";
      ui.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font-size:15px;line-height:1.5;color:#f3eee6;">The lamps would not light: ${String(err && err.message || err).replace(/[<>&]/g, "")}</div>`;
      try { ctx.platform.error({ stage: "dependency", message: String(err && err.message || err) }); } catch (_) {}
      ctx.platform.ready();
      return;
    }
    const DISPLAY_FONT = fontReady ? "'" + DISPLAY_FAMILY + "', Georgia, serif" : "Georgia, 'Times New Roman', serif";
    ui.style.background = "transparent";

    // ---- The phase clock. Each phase remembers when it began, so every
    // effect reads "seconds since <phase> started" (negative before it has).
    const PHASES = ["loading", "approach", "lit", "spread", "rangoli", "lantern", "fireworks", "wish"];
    const story = { phase: "loading", at: {}, run: 0, muted: false, lowPower: false, autoTimer: null };
    const now = () => performance.now() / 1000;
    const since = (phase) => { const t = story.at[phase]; return t === undefined ? -1 : now() - t; };
    const phaseListeners = [];
    function setPhase(p) {
      if (story.phase === p) return;
      story.phase = p;
      story.at[p] = now();
      for (const fn of phaseListeners) fn(p);
    }

    // ---- Renderer
    const DPR = Math.min(Number(ctx.dpr) || 1, 1.6);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, alpha: false, depth: true });
    } catch (err) {
      ui.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font-size:15px;line-height:1.5;color:#f3eee6;">This device could not open a 3D view.</div>`;
      try { ctx.platform.error({ stage: "renderer", message: String(err && err.message || err) }); } catch (_) {}
      ctx.platform.ready();
      return;
    }
    renderer.setPixelRatio(DPR);
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    renderer.setClearColor(new THREE.Color("#070b14"), 1);
    const gl = renderer.getContext();
    const floatOk = !!(renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, Math.max(0.2, ctx.width / Math.max(1, ctx.height)), 0.08, 800);

    // ====================================================================== //
    // 2. Light: warm practicals, a hemisphere of night, haze                 //
    // ====================================================================== //
    // Every lit surface uses the same little lighting model: up to twelve
    // warm point lights (the lamp groups, the lantern), a sky/ground
    // hemisphere for the dark, a faint cool rim from the sky glow, and a
    // height and distance fog toward the horizon.
    const LIGHTS = 12;
    const L_LANTERN = 8, L_WINDOWS = 9, L_FIRE = 10;
    const lightUniforms = {
      uTime: { value: 0 },
      uLightPos: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector4(0, -100, 0, 1)) },
      uLightCol: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector4(1.0, 0.56, 0.24, 0)) },
      uSky: { value: new THREE.Color(0x3a4568) },
      uGround: { value: new THREE.Color(0x1a1512) },
      uAmbient: { value: 0.34 },
      uMoon: { value: new THREE.Color(0x7a86b4) },
      uMoonDir: { value: new THREE.Vector3(-0.5, 0.55, -0.65).normalize() },
      uRimAmount: { value: 0.07 },
      uFogColor: { value: new THREE.Color(0x1c1826) },
      uFogDensity: { value: 0.03 },
      uFlash: { value: new THREE.Color(0, 0, 0) }
    };
    const GLSL_LIGHT = `
      uniform float uTime;
      uniform vec4 uLightPos[${LIGHTS}];
      uniform vec4 uLightCol[${LIGHTS}];
      uniform vec3 uSky;
      uniform vec3 uGround;
      uniform float uAmbient;
      uniform vec3 uMoon;
      uniform vec3 uMoonDir;
      uniform float uRimAmount;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uFlash;
      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
      }
      // lime-wash mottling so big walls never read flat
      float paperGrain(vec2 p) {
        float fine = vnoise(p * 160.0);
        float mott = vnoise(p * 3.0) * 0.6 + vnoise(p * 9.0) * 0.4;
        return 0.95 + fine * 0.05 + (mott - 0.5) * 0.12;
      }
      // warm practicals, half-Lambert so the light wraps softly round forms
      vec3 warmLight(vec3 wp, vec3 n) {
        vec3 L = vec3(0.0);
        for (int i = 0; i < ${LIGHTS}; i++) {
          vec3 d = uLightPos[i].xyz - wp;
          float dist = length(d);
          float k = clamp(1.0 - dist / uLightPos[i].w, 0.0, 1.0);
          float wrap = dot(n, d / max(dist, 1e-3)) * 0.5 + 0.5;
          L += uLightCol[i].rgb * uLightCol[i].a * k * k * wrap * wrap;
        }
        return L;
      }
      vec3 hemi(vec3 n) { return mix(uGround, uSky, n.y * 0.5 + 0.5) * uAmbient; }
    `;
    const VS_SURFACE = `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vView;
      varying vec2 vUv;
      varying vec3 vColor;
      #ifdef USE_VCOLOR
        attribute vec3 color;
      #endif
      void main() {
        vUv = uv;
        #ifdef USE_VCOLOR
          vColor = color;
        #else
          vColor = vec3(1.0);
        #endif
        #ifdef USE_INSTANCING
          mat4 m = modelMatrix * instanceMatrix;
        #else
          mat4 m = modelMatrix;
        #endif
        vec4 w = m * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(m) * normal);
        vView = cameraPosition - w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `;
    const FS_SURFACE = `
      ${GLSL_LIGHT}
      uniform vec3 uColor;
      uniform float uLightGain;
      uniform float uFog;
      uniform float uLeaf;
      uniform float uSpec;
      uniform float uGrain;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vView;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(vView);
        if (dot(n, v) < 0.0) n = -n;
        vec3 base = uColor * vColor;
        if (uGrain > 0.5) base *= paperGrain(vWorld.xz * 0.6 + vWorld.yy * 0.37);
        float ao = mix(0.55, 1.0, smoothstep(0.0, 0.55, vWorld.y));
        vec3 L = warmLight(vWorld, n) * uLightGain;
        vec3 col = base * hemi(n) * ao + base * L * 2.2 * mix(ao, 1.0, 0.5);
        col += base * warmLight(vWorld, -n) * uLeaf * 0.9;
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        col += uMoon * rim * uRimAmount * (0.35 + 0.65 * max(dot(n, uMoonDir), 0.0)) * (1.0 + uLeaf * 1.5);
        if (uSpec > 0.0) {
          vec3 h = normalize(v + vec3(0.0, 1.0, 0.0));
          col += L * pow(max(dot(n, h), 0.0), 40.0) * uSpec;
        }
        col += base * uFlash;
        float dist = length(vView);
        float fog = (1.0 - exp(-max(dist - 6.0, 0.0) * uFogDensity * uFog)) * mix(1.0, 0.6, smoothstep(0.0, 14.0, vWorld.y));
        gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
      }
    `;
    // A lit matte surface in one colour.
    function surfaceMat(color, o) {
      o = o || {};
      return new THREE.ShaderMaterial({
        uniforms: Object.assign({}, lightUniforms, {
          uColor: { value: new THREE.Color(color) },
          uLightGain: { value: o.lightGain == null ? 1 : o.lightGain },
          uFog: { value: o.fog == null ? 1 : o.fog },
          uLeaf: { value: o.leaf ? 1 : 0 },
          uSpec: { value: o.spec || 0 },
          uGrain: { value: o.grain === false ? 0 : 1 }
        }),
        defines: o.vertexColors ? { USE_VCOLOR: "" } : {},
        vertexShader: VS_SURFACE,
        fragmentShader: FS_SURFACE,
        side: o.side || THREE.FrontSide
      });
    }
    // A self-lit surface (window panes, bulbs, lantern paper): colour times
    // intensity, flickering a little, fading into the haze with distance.
    const VS_GLOW = `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 w = modelMatrix * vec4(position, 1.0);
        #endif
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `;
    const FS_GLOW = `
      ${GLSL_LIGHT}
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uPattern;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        float flick = 0.94 + 0.06 * sin(uTime * 9.0 + vWorld.x * 3.0) * sin(uTime * 5.3 + vWorld.y);
        float hot = mix(1.0, mix(1.4, 0.65, smoothstep(0.0, 1.0, vUv.y)), uPattern);
        float ribs = 1.0 - uPattern * 0.5 * smoothstep(0.42, 0.5, abs(fract(vUv.x * 8.0) - 0.5));
        vec3 col = uColor * uIntensity * hot * ribs * flick;
        float fog = 1.0 - exp(-max(vDepth - 8.0, 0.0) * uFogDensity * 0.55);
        gl_FragColor = vec4(mix(col, uFogColor + col * 0.4, fog), 1.0);
      }
    `;
    function glowMat(color, intensity, pattern) {
      return new THREE.ShaderMaterial({
        uniforms: Object.assign({}, lightUniforms, { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity == null ? 2.5 : intensity }, uPattern: { value: pattern == null ? 1 : pattern } }),
        vertexShader: VS_GLOW, fragmentShader: FS_GLOW, side: THREE.DoubleSide, toneMapped: false
      });
    }
    // Soft additive sprites (glow discs, halos): a plane that always faces
    // the camera, scaled in world units.
    const VS_SPRITE = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING
          vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sc = length(instanceMatrix[0].xyz);
        #else
          vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sc = length(modelMatrix[0].xyz);
        #endif
        c.xy += position.xy * sc;
        gl_Position = projectionMatrix * c;
      }
    `;
    function haloMat(color, intensity, tight) {
      return new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: intensity == null ? 1 : intensity }, uTight: { value: tight == null ? 3.2 : tight } },
        vertexShader: VS_SPRITE,
        fragmentShader: `
          uniform vec3 uColor; uniform float uI; uniform float uTight;
          varying vec2 vUv;
          void main() {
            float r = length(vUv - 0.5) * 2.0;
            float g = exp(-r * r * uTight) * (1.0 - smoothstep(0.7, 1.0, r));
            gl_FragColor = vec4(uColor * g * uI, 1.0);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
      });
    }
    const flashUniform = lightUniforms.uFlash;
    let flashLevel = 0;
    const flash = (amount) => { flashLevel = Math.max(flashLevel, amount); };

    // Lamp groups: a point light stands for each cluster of diyas, its
    // brightness following how many of them are lit.
    const LIGHT_GROUPS = [
      { groups: ["hero"], pos: [0.15, 0.3, 1.75], radius: 1.9, gain: 0.42 },
      { groups: ["ring"], pos: [0, 0.45, 0], radius: 4, gain: 1 },
      { groups: ["pathL"], pos: [-2.4, 0.4, 0], radius: 4.8, gain: 0.85 },
      { groups: ["pathR"], pos: [2.4, 0.4, 0], radius: 4.8, gain: 0.85 },
      { groups: ["steps"], pos: [0, 0.7, -4.2], radius: 5.6, gain: 1 },
      { groups: ["door"], pos: [0, 1.6, -4.4], radius: 5.2, gain: 0.9 },
      { groups: ["wallL"], pos: [-5.9, 0.9, 0.4], radius: 6, gain: 0.8 },
      { groups: ["wallR"], pos: [5.9, 0.9, 0.4], radius: 6, gain: 0.8 }
    ];
    // the windows glow all night: a steady warm light at the door
    lightUniforms.uLightPos.value[L_WINDOWS].set(0, 2.2, -4.6, 7);
    lightUniforms.uLightCol.value[L_WINDOWS].set(1.0, 0.72, 0.42, 0.22);

    // ====================================================================== //
    // 3. The courtyard, the house, the town behind it, the sky               //
    // ====================================================================== //
    const world = new THREE.Group();
    scene.add(world);
    const HOUSE_Z = -5;            // the front wall of the house
    const YARD = { x: 6.44, zNear: 5.45, zFar: -4.95 };

    // ---- Ground: kota stone slabs inside the walls, grass and worn earth outside.
    {
      const geo = new THREE.PlaneGeometry(420, 420, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, lightUniforms, {
          uFloor: { value: new THREE.Color(0x857e72) },
          uGrass: { value: new THREE.Color(0x3e4a2c) },
          uEarth: { value: new THREE.Color(0x4a3c30) }
        }),
        vertexShader: `
          varying vec3 vWorld; varying vec3 vView;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vView = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `
          ${GLSL_LIGHT}
          uniform vec3 uFloor; uniform vec3 uGrass; uniform vec3 uEarth;
          varying vec3 vWorld; varying vec3 vView;
          void main() {
            vec2 p = vWorld.xz;
            vec3 n = vec3(0.0, 1.0, 0.0);
            bool inside = abs(p.x) < ${YARD.x.toFixed(2)} && p.y < ${YARD.zNear.toFixed(2)} && p.y > ${YARD.zFar.toFixed(2)};
            vec3 base;
            if (inside) {
              vec2 cell = floor(p / 0.6);
              vec2 f = fract(p / 0.6);
              float joint = smoothstep(0.0, 0.025, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
              base = uFloor * mix(0.82, 1.04, hash12(cell));
              base *= 0.9 + 0.1 * vnoise(p * 7.0);
              base *= mix(0.55, 1.0, joint);
            } else {
              float patches = vnoise(p * 0.12) * 0.6 + vnoise(p * 0.5) * 0.3 + vnoise(p * 2.3) * 0.1;
              float worn = smoothstep(0.55, 0.3, patches);
              worn += smoothstep(2.6, 1.4, abs(p.x)) * step(5.5, p.y) * step(p.y, 40.0);
              base = mix(uGrass * (0.75 + 0.5 * vnoise(p * 3.1)), uEarth * (0.85 + 0.3 * vnoise(p * 1.7)), clamp(worn, 0.0, 1.0));
            }
            vec3 L = warmLight(vWorld + vec3(0.0, 0.02, 0.0), n);
            vec3 col = base * hemi(n) * (inside ? 1.0 : 1.35) + base * L * 2.4;
            if (inside) col += L * 0.08;
            col += base * uMoon * max(dot(n, uMoonDir), 0.0) * uRimAmount * 0.6;
            col += base * uFlash;
            float dist = length(vView);
            float fog = 1.0 - exp(-max(dist - 6.0, 0.0) * uFogDensity);
            gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
          }`
      });
      world.add(new THREE.Mesh(geo, mat));
    }

    // ---- Building blocks
    const MAT = {
      wall: surfaceMat(0xd9cfbf),
      wallDark: surfaceMat(0xc5b9a6),
      dado: surfaceMat(0x6b3a2c),
      wood: surfaceMat(0x4a2c1c, { grain: false }),
      woodLight: surfaceMat(0x6b4330, { grain: false }),
      stone: surfaceMat(0x9a9080),
      tile: surfaceMat(0x7a3b2c, { grain: false }),
      iron: surfaceMat(0x1f1a18, { grain: false }),
      marigold: surfaceMat(0xe8761e, { grain: false, leaf: true, lightGain: 1.1 }),
      marigoldY: surfaceMat(0xf2a33a, { grain: false, leaf: true, lightGain: 1.1 }),
      leaf: surfaceMat(0x3f7a3a, { grain: false, leaf: true }),
      inner: surfaceMat(0x3a2a24, { grain: false })
    };
    const PANE = glowMat(0xffb45c, 0.5, 0);
    const PANE_DIM = glowMat(0xffa64a, 0.3, 0);
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    function box(parent, mat, w, h, d, x, y, z, ry) {
      const m = new THREE.Mesh(unitBox, mat);
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      if (ry) m.rotation.y = ry;
      parent.add(m);
      return m;
    }
    const house = new THREE.Group();
    world.add(house);

    // plinth, steps, the wall and its dado
    box(house, MAT.stone, 14.8, 0.46, 2.2, 0, 0.23, HOUSE_Z - 1.05);        // front face at -4.95
    box(house, MAT.stone, 3.8, 0.14, 0.45, 0, 0.07, -4.525);
    box(house, MAT.stone, 3.8, 0.28, 0.25, 0, 0.14, -4.825);
    box(house, MAT.wall, 14.8, 6.2, 4, 0, 0.46 + 3.1, HOUSE_Z - 2);          // front face at -5.0
    box(house, MAT.dado, 14.84, 0.7, 0.06, 0, 0.46 + 0.35, HOUSE_Z + 0.02);
    // a thin ledge where the dado ends
    box(house, MAT.wallDark, 14.84, 0.06, 0.1, 0, 1.17, HOUSE_Z + 0.04);

    // Windows: a warm pane on the wall, a stone frame of four strips around
    // it with a shadow line under the head, iron bars in front, a sill.
    function frame_(g, mat, w, h, y0, z, t, d) {
      box(g, mat, w + 2 * t, t, d, 0, y0 + h + t / 2, z);
      box(g, mat, w + 2 * t, t, d, 0, y0 - t / 2, z);
      box(g, mat, t, h, d, -w / 2 - t / 2, y0 + h / 2, z);
      box(g, mat, t, h, d, w / 2 + t / 2, y0 + h / 2, z);
    }
    function window_(x, y0, w, h, upper) {
      const g = new THREE.Group();
      g.position.set(x, 0, HOUSE_Z);
      house.add(g);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), upper ? PANE_DIM : PANE);
      pane.position.set(0, y0 + h / 2, 0.012);
      g.add(pane);
      box(g, MAT.inner, w, 0.12, 0.02, 0, y0 + h - 0.06, 0.02);              // the shadow of the head
      box(g, MAT.inner, 0.08, h, 0.02, -w / 2 + 0.04, y0 + h / 2, 0.02);
      frame_(g, MAT.wallDark, w, h, y0, 0.05, 0.11, 0.1);
      const bars = 3 + Math.round(w * 1.6);
      for (let k = 0; k < bars; k++) box(g, MAT.iron, 0.022, h, 0.022, -w / 2 + (k + 0.5) * (w / bars), y0 + h / 2, 0.03);
      box(g, MAT.iron, w, 0.022, 0.022, 0, y0 + h * 0.5, 0.03);
      box(g, MAT.wallDark, w + 0.4, 0.07, 0.18, 0, y0 - 0.035, 0.09);      // sill
      box(g, MAT.wallDark, w + 0.4, 0.07, 0.12, 0, y0 + h + 0.035, 0.06);  // lintel
    }
    window_(-2.9, 1.3, 1.3, 1.5, false); window_(2.9, 1.3, 1.3, 1.5, false);
    window_(-4.95, 1.3, 0.9, 1.25, false); window_(4.95, 1.3, 0.9, 1.25, false);
    window_(-2.9, 4.0, 1.2, 1.3, true); window_(2.9, 4.0, 1.2, 1.3, true);
    window_(-4.95, 4.0, 0.9, 1.1, true); window_(4.95, 4.0, 0.9, 1.1, true);

    // The door: a warm opening with dark reveals that fake its depth, two
    // leaves standing open, a jamb and a lintel, and the toran of marigolds
    // and mango leaves above it.
    function doorway(parent, y0, w, h, glow, leafOpen) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow);
      pane.position.set(0, y0 + h / 2, 0.012);
      parent.add(pane);
      box(parent, MAT.inner, w, 0.22, 0.02, 0, y0 + h - 0.11, 0.02);
      box(parent, MAT.inner, 0.16, h, 0.02, -w / 2 + 0.08, y0 + h / 2, 0.02);
      box(parent, MAT.inner, 0.1, h, 0.02, w / 2 - 0.05, y0 + h / 2, 0.02);
      box(parent, MAT.wood, 0.14, h + 0.16, 0.22, -w / 2 - 0.07, y0 + h / 2 + 0.04, 0.06);
      box(parent, MAT.wood, 0.14, h + 0.16, 0.22, w / 2 + 0.07, y0 + h / 2 + 0.04, 0.06);
      box(parent, MAT.wood, w + 0.42, 0.16, 0.24, 0, y0 + h + 0.12, 0.06);
      for (const s of [-1, 1]) {
        const leaf = new THREE.Group();
        leaf.position.set(s * (w / 2 - 0.02), y0, 0.04);
        leaf.rotation.y = s * -leafOpen;
        parent.add(leaf);
        box(leaf, MAT.woodLight, w / 2 - 0.02, h, 0.06, -s * (w / 4 - 0.01), h / 2, 0);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) box(leaf, MAT.wood, Math.min(0.26, w / 4 - 0.06), 0.42, 0.03, -s * ((w / 8) + c * (w / 4)), 0.36 + r * (h / 4.4), 0.04);
      }
    }
    {
      const g = new THREE.Group();
      g.position.set(0, 0, HOUSE_Z);
      house.add(g);
      const y0 = 0.46, h = 2.5, w = 1.7;
      doorway(g, y0, w, h, glowMat(0xffc27a, 0.72, 0), 1.25);
      // toran
      const tg = new THREE.Group();
      tg.position.set(0, y0 + h + 0.26, 0.16);
      g.add(tg);
      const bead = new THREE.SphereGeometry(0.045, 8, 6);
      const leafGeo = new THREE.ConeGeometry(0.05, 0.16, 5);
      for (let k = 0; k <= 22; k++) {
        const t = k / 22, x = (t - 0.5) * (w + 0.5), sag = 0.22 * 4 * t * (1 - t);
        const m = new THREE.Mesh(bead, k % 2 ? MAT.marigold : MAT.marigoldY);
        m.position.set(x, -sag, 0);
        tg.add(m);
        if (k % 3 === 1) { const l = new THREE.Mesh(leafGeo, MAT.leaf); l.position.set(x, -sag - 0.14, 0.02); l.rotation.x = Math.PI; tg.add(l); }
      }
      for (const s of [-1, 1]) {
        for (let k = 0; k < 7; k++) {
          const m = new THREE.Mesh(bead, k % 2 ? MAT.marigold : MAT.marigoldY);
          m.position.set(s * (w / 2 + 0.3), -0.1 - k * 0.1 - 0.02, 0.0);
          tg.add(m);
        }
      }
    }

    // The chhajja: a tiled awning over the ground floor with brackets below.
    {
      const aw = new THREE.Group();
      aw.position.set(0, 3.05, HOUSE_Z);
      house.add(aw);
      const slab = box(aw, MAT.tile, 15.2, 0.1, 0.9, 0, 0.1, 0.45);
      slab.rotation.x = 0.18;
      box(aw, MAT.woodLight, 15.2, 0.08, 0.05, 0, 0.02, 0.86);
      for (let k = 0; k < 9; k++) {
        const x = -7.0 + k * 1.75;
        box(aw, MAT.wood, 0.1, 0.5, 0.1, x, -0.3, 0.1);
        const b = box(aw, MAT.wood, 0.1, 0.1, 0.7, x, -0.05, 0.38);
        b.rotation.x = 0.18;
      }
    }

    // Upstairs: the balcony with its railing and the open balcony door.
    {
      const bg = new THREE.Group();
      bg.position.set(0, 3.55, HOUSE_Z);
      house.add(bg);
      box(bg, MAT.stone, 4.0, 0.16, 1.0, 0, 0.08, 0.5);
      box(bg, MAT.wood, 4.0, 0.06, 0.06, 0, 0.98, 0.98);
      box(bg, MAT.wood, 0.06, 0.06, 1.0, -2.0, 0.98, 0.5);
      box(bg, MAT.wood, 0.06, 0.06, 1.0, 2.0, 0.98, 0.5);
      for (let k = 0; k <= 24; k++) box(bg, MAT.wood, 0.035, 0.82, 0.035, -2.0 + k * (4.0 / 24), 0.57, 0.98);
      for (let k = 1; k < 6; k++) for (const s of [-1, 1]) box(bg, MAT.wood, 0.035, 0.82, 0.035, s * 2.0, 0.57, k * (1.0 / 6));
      // the balcony door
      doorway(bg, 0.16, 1.3, 2.1, glowMat(0xffc27a, 0.5, 0), 1.1);
    }

    // The roofline: a parapet with small arched openings, a raised block in
    // the middle and a second storey stepping back behind it.
    {
      const y = 6.66;
      box(house, MAT.wall, 14.8, 0.12, 0.3, 0, y, HOUSE_Z + 0.05);
      for (let k = 0; k < 29; k++) {
        const x = -7.0 + k * 0.5;
        box(house, MAT.wall, 0.16, 0.5, 0.26, x, y + 0.31, HOUSE_Z + 0.03);
      }
      box(house, MAT.wall, 14.8, 0.12, 0.3, 0, y + 0.62, HOUSE_Z + 0.05);
      box(house, MAT.wall, 4.8, 1.3, 2.4, 0, y + 0.65, HOUSE_Z - 1.2);
      box(house, MAT.wallDark, 5.0, 0.12, 2.6, 0, y + 1.36, HOUSE_Z - 1.2);
      box(house, MAT.wall, 3.2, 0.5, 1.6, 0, y + 1.65, HOUSE_Z - 1.2);
      box(house, MAT.wall, 3.4, 2.4, 3.0, 5.2, y + 1.2, HOUSE_Z - 2.6);
      box(house, MAT.wall, 15.0, 7.0, 6.0, 0, 3.5, HOUSE_Z - 7.0);
    }

    // Compound walls down both sides with a ledge for the lamps, niches
    // higher up, and a pillar at each end.
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      world.add(g);
      const xc = s * (YARD.x + 0.23);
      box(g, MAT.wall, 0.46, 1.62, 10.4, xc, 0.81, 0.25);
      box(g, MAT.wallDark, 0.52, 0.08, 10.5, xc, 1.66, 0.25);
      box(g, MAT.stone, 0.2, 0.06, 10.4, s * (YARD.x - 0.08), 0.47, 0.25);
      box(g, MAT.dado, 0.04, 0.4, 10.4, s * (YARD.x - 0.01), 0.2, 0.25);
      for (let k = 0; k < 5; k++) {
        const z = 3.5 - 1.6 * k;
        box(g, MAT.inner, 0.3, 0.44, 0.5, s * (YARD.x + 0.14), 1.42, z);
        box(g, MAT.stone, 0.3, 0.05, 0.5, s * (YARD.x + 0.14), 1.3, z);
      }
      for (const z of [YARD.zNear, YARD.zFar]) {
        box(g, MAT.wall, 0.6, 1.95, 0.6, xc, 0.975, z);
        box(g, MAT.wallDark, 0.72, 0.1, 0.72, xc, 1.98, z);
      }
    }

    // String lights: catenary runs of small bulbs that come on as the lamps
    // spread; mostly warm white with a pastel one every so often.
    const bulbs = { meshes: [], on: 0 };
    {
      const runs = [
        { a: [-7.4, 3.28, HOUSE_Z + 0.72], b: [7.4, 3.28, HOUSE_Z + 0.72], scallops: 4, sag: 0.38 },
        { a: [-7.4, 7.3, HOUSE_Z + 0.08], b: [7.4, 7.3, HOUSE_Z + 0.08], scallops: 4, sag: 0.32 },
        { a: [-2.4, 8.3, HOUSE_Z - 0.02], b: [2.4, 8.3, HOUSE_Z - 0.02], scallops: 1, sag: 0.26 },
        { a: [-2.0, 4.52, HOUSE_Z + 0.98], b: [2.0, 4.52, HOUSE_Z + 0.98], scallops: 1, sag: 0.16 },
        { a: [-6.6, 1.72, 5.2], b: [-6.6, 1.72, -4.7], scallops: 3, sag: 0.3 },
        { a: [6.6, 1.72, 5.2], b: [6.6, 1.72, -4.7], scallops: 3, sag: 0.3 }
      ];
      const pts = [], tones = [];
      const PASTEL = [0xffb3c6, 0xb8f0d8, 0xa8c8ff, 0xffe08a];
      const wire = [];
      let bulbIndex = 0;
      for (const r of runs) {
        const A = new THREE.Vector3(...r.a), B = new THREE.Vector3(...r.b);
        const len = A.distanceTo(B), steps = Math.max(2, Math.round(len / 0.22));
        let prev = null;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, u = (t * r.scallops) % 1;
          const p = A.clone().lerp(B, t);
          p.y -= r.sag * 4 * u * (1 - u);
          if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
          prev = p;
          if (i % 1 === 0) { pts.push(p); tones.push(bulbIndex % 4 === 3 ? PASTEL[Math.floor(hash1(bulbIndex) * 4)] : 0xffd59a); bulbIndex++; }
        }
      }
      const byTone = new Map();
      pts.forEach((p, i) => { const k = tones[i]; if (!byTone.has(k)) byTone.set(k, []); byTone.get(k).push(p); });
      const bulbGeo = new THREE.SphereGeometry(0.034, 7, 5);
      const m4 = new THREE.Matrix4();
      for (const [tone, list] of byTone) {
        const mat = glowMat(tone, 0, 0);
        const im = new THREE.InstancedMesh(bulbGeo, mat, list.length);
        list.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
        im.instanceMatrix.needsUpdate = true;
        im.frustumCulled = false;
        world.add(im);
        bulbs.meshes.push({ mesh: im, mat, peak: tone === 0xffd59a ? 1.9 : 1.5 });
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3));
      world.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1410 })));
    }

    // ---- The town behind: three skylines stepping back into the haze,
    // each with a few temple spires and a scatter of lit windows.
    function skyline(seed, z, sx, sy, color, fog, temples, windowAmount, width) {
      const pts = [], windows = [];
      let x = -width / 2 / sx, i = 0;
      const xEnd = width / 2 / sx;
      pts.push([x, -1]);
      while (x < xEnd) {
        const tall = hash2(seed + i * 2.3, 3.1) < 0.25;
        const w = tall ? 3 + 2 * hash2(seed + i, 7.7) : 1.6 + 2.2 * hash2(seed + i * 3.1, 1.3);
        const h = tall ? 6.5 + 3 * hash2(seed + 5 * i, 2.2) : 2.2 + hash2(seed + 7.7 * i, 4.4) * 4.3;
        const kind = hash2(seed + 1.9 * i, 9.1);
        pts.push([x, h]);
        const temple = temples.find((tx) => tx >= x && tx < x + w);
        if (temple !== undefined) {
          const tx = temple;
          pts.push([tx - 1.5, h]);
          for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([tx - 1.5 * (1 - t) * (1 - 0.3 * t), h + 4.4 * Math.sin(t * Math.PI / 2)]); }
          pts.push([tx - 0.14, h + 4.55], [tx - 0.04, h + 5], [tx - 0.015, h + 6], [tx + 0.75, h + 5.75], [tx + 0.015, h + 5.5], [tx + 0.04, h + 5], [tx + 0.14, h + 4.55]);
          for (let k = 12; k >= 0; k--) { const t = k / 12; pts.push([tx + 1.5 * (1 - t) * (1 - 0.3 * t), h + 4.4 * Math.sin(t * Math.PI / 2)]); }
          pts.push([tx + 1.5, h]);
        } else if (kind < 0.3 && w > 2) {
          const t = x + w * (0.3 + 0.4 * hash2(seed + i, 5.5));
          pts.push([t - 0.35, h], [t - 0.35, h + 0.35], [t - 0.4, h + 0.35], [t - 0.4, h + 0.85], [t + 0.4, h + 0.85], [t + 0.4, h + 0.35], [t + 0.35, h + 0.35], [t + 0.35, h]);
        } else if (kind < 0.55 && w > 1.8) {
          const t = x + 0.4 + hash2(seed + 4 * i, 8.8) * (w - 1.4);
          pts.push([t, h], [t, h + 1], [t + 0.9, h + 1], [t + 0.9, h]);
        }
        pts.push([x + w, h]);
        for (let yy = 0.7; yy < h - 0.5; yy += 1.1) for (let xx = x + 0.45; xx < x + w - 0.3; xx += 0.8) if (hash2(seed + 13.1 * xx, 7.7 * yy) < 0.42 && hash2(seed + xx, yy + 2.2) < windowAmount) windows.push([xx, yy]);
        x += w; i++;
      }
      pts.push([x, -1]);
      const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
      const g = new THREE.Group();
      g.position.set(0, -0.6, z);
      g.scale.set(sx, sy, 1);
      g.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), surfaceMat(color, { fog, leaf: true, grain: false, side: THREE.DoubleSide })));
      if (windows.length) {
        const wm = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.32, 0.42), glowMat(0xffd59a, 1.3, 0), windows.length);
        const m4 = new THREE.Matrix4();
        windows.forEach((w, k) => wm.setMatrixAt(k, m4.makeTranslation(w[0], w[1], 0.05)));
        wm.instanceMatrix.needsUpdate = true;
        wm.frustumCulled = false;
        g.add(wm);
      }
      world.add(g);
    }
    skyline(41, -70, 1.9, 1.5, 0x2c2b38, 0.75, [-14, 22], 0.5, 240);
    skyline(57, -115, 2.6, 2.1, 0x383a4c, 0.5, [-30, 4, 33], 0.32, 320);
    skyline(73, -170, 3.4, 2.8, 0x45465c, 0.34, [-20, 18], 0.18, 420);

    // ---- Trees and bushes outside the walls: dark low-poly cones and balls
    // in two rings, kept off the house and the lane.
    {
      const blocked = (x, z) => (Math.abs(x) < 9.5 && z > -14 && z < 7) || (Math.abs(x) < 2.6 && z > 5 && z < 40);
      const scatter = (seed, count, box_, minD, s0, s1) => {
        const out = [];
        for (let i = 0; out.length < count && i < count * 30; i++) {
          const x = box_[0] + hash2(seed + 1.7 * i, 3.1) * (box_[1] - box_[0]);
          const z = box_[2] + hash2(seed + 3.1 * i, 9.7) * (box_[3] - box_[2]);
          if (blocked(x, z)) continue;
          if (out.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < minD * minD)) continue;
          out.push({ x, z, r: hash2(seed + i, 5.5) * TAU, s: s0 + hash2(seed + 5.3 * i, 1.1) * (s1 - s0) });
        }
        return out;
      };
      const place = (geo, mat, spots) => {
        const im = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
        spots.forEach((s, i) => { q.setFromAxisAngle(up, s.r); p.set(s.x, -0.05, s.z); sc.set(s.s, s.s, s.s); im.setMatrixAt(i, m4.compose(p, q, sc)); });
        im.count = spots.length; im.instanceMatrix.needsUpdate = true;
        world.add(im);
      };
      const treeGeo = new THREE.ConeGeometry(1.1, 3.2, 7);
      treeGeo.translate(0, 1.6, 0);
      const crown = new THREE.SphereGeometry(1.2, 7, 5);
      crown.translate(0, 1.6, 0);
      crown.scale(1, 1.2, 1);
      const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1.2, 5);
      trunk.translate(0, 0.6, 0);
      const bush = new THREE.SphereGeometry(0.8, 6, 4);
      bush.scale(1, 0.7, 1);
      const leafMat = surfaceMat(0x2a3a22, { leaf: true, grain: false, lightGain: 1.1 });
      const leafMat2 = surfaceMat(0x33402a, { leaf: true, grain: false, lightGain: 1.1 });
      const barkMat = surfaceMat(0x4a3a2e, { grain: false });
      const near = scatter(101, 46, [-60, 60, -70, 50], 3.6, 1.1, 1.7);
      const far = scatter(102, 18, [-110, 110, -120, -60], 6, 1.5, 2.2);
      const round = scatter(201, 30, [-60, 60, -70, 50], 3.6, 1.0, 1.5);
      place(treeGeo, leafMat, near.concat(far));
      place(trunk, barkMat, near.concat(far, round));
      place(crown, leafMat2, round);
      place(bush, leafMat2, scatter(401, 160, [-60, 60, -70, 50], 1.8, 0.9, 1.7));
      place(bush, leafMat, scatter(402, 60, [-40, 40, -40, 30], 2, 0.8, 1.4));
      // a hedge along the inside of each wall, and trees looking over them
      const hedge = [];
      for (const s of [-1, 1]) for (let z = 4.6; z > -4.2; z -= 1.15) hedge.push({ x: s * 5.98, z: z + 0.25 * hash2(z, s), r: hash2(z, 3) * TAU, s: 0.32 + 0.1 * hash2(z, 7) });
      place(bush, leafMat2, hedge);
      const overhang = [{ x: -8.4, z: 1.6, r: 0.4, s: 1.5 }, { x: 8.6, z: 2.4, r: 1.9, s: 1.6 }, { x: -8.8, z: -2.4, r: 2.6, s: 1.3 }, { x: 8.3, z: -1.6, r: 3.6, s: 1.45 }, { x: -9.2, z: 6.5, r: 1.1, s: 1.3 }, { x: 9.1, z: 6.2, r: 0.2, s: 1.35 }];
      place(crown, leafMat2, overhang);
      place(trunk, barkMat, overhang);
    }

    // ---- The sky: a dome shading from the dusty afterglow at the horizon to
    // deep night overhead, and a field of stars that twinkle.
    {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color(0x070b14) }, uMid: { value: new THREE.Color(0x1a1726) }, uHorizon: { value: new THREE.Color(0x4a3340) }, uGlow: { value: new THREE.Color(0x5a3a2a) }, uWish: { value: 0 } },
        vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGlow; uniform float uWish;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -0.05, 1.0);
            vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
            c = mix(c, uTop, smoothstep(0.12, 0.6, h));
            // the town's glow sits low in the sky behind the house
            float town = exp(-h * 9.0) * smoothstep(-0.3, 0.6, -vDir.z) * 0.5;
            c += uGlow * town;
            c += vec3(0.05, 0.035, 0.03) * uWish * exp(-h * 3.0);
            gl_FragColor = vec4(c, 1.0);
          }`,
        side: THREE.BackSide, depthWrite: false
      }));
      dome.renderOrder = -10;
      world.add(dome);
      world.userData.sky = dome.material;
      const N = 1100, pos = new Float32Array(N * 3), seed = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = hash1(i * 1.3) * TAU, y = 0.04 + Math.pow(hash1(i * 2.7 + 9), 0.8) * 0.96, r = Math.sqrt(1 - y * y);
        pos[i * 3] = Math.cos(a) * r * 560; pos[i * 3 + 1] = y * 560; pos[i * 3 + 2] = Math.sin(a) * r * 560;
        seed[i] = hash1(i * 4.1 + 2);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      sg.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
      const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
        uniforms: { uTime: lightUniforms.uTime, uPx: { value: 800 } },
        vertexShader: `
          attribute float aSeed; uniform float uTime; uniform float uPx; varying float vA;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float tw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 2.0) + aSeed * 40.0);
            vA = tw * (0.35 + 0.65 * step(0.6, aSeed)) * smoothstep(0.02, 0.1, normalize(position).y);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uPx * (0.0019 + 0.0022 * aSeed);
          }`,
        fragmentShader: `
          varying float vA;
          void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float g = exp(-d * d * 5.0) * (1.0 - smoothstep(0.7, 1.0, d)); gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * g * vA * 0.9, 1.0); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
      }));
      stars.frustumCulled = false;
      stars.renderOrder = -9;
      world.add(stars);
      world.userData.stars = stars.material;
    }

    // ====================================================================== //
    // 4. The lamps: clay diyas, their flames, and the spread of the light    //
    // ====================================================================== //
    // The hero diya stands near the camera; a ring surrounds the rangoli,
    // rows run down both paths, more sit on the steps, the sills and the
    // walls. Each one is lit a little after its neighbours, by its distance
    // from the hero lamp, so the light rolls out across the courtyard.
    const HERO = new THREE.Vector3(0, 0, 1.75);
    const DIYAS = (() => {
      const list = [];
      const add = (x, y, z, group, yaw, scale) => list.push({ pos: new THREE.Vector3(x, y, z), yaw: yaw == null ? hash1(list.length + 1) * TAU : yaw, group, scale: scale == null ? 1 : scale });
      add(HERO.x, HERO.y, HERO.z, "hero", 0.85 * Math.PI, 1.25);
      for (let e = 1; e < 14; e++) { const t = Math.PI / 2 + e / 14 * TAU; add(1.7 * Math.cos(t), 0, 1.7 * Math.sin(t), "ring", -t); }
      for (let z = 3.4; z >= -3.4; z -= 1.1) { add(-2.1, 0, z, "pathL"); add(2.1, 0, z, "pathR"); }
      for (let x = -1.6; x <= 1.61; x += 0.53) add(x, 0.14, -4.53, "steps", null, 0.8);
      for (const s of [-1, 1]) for (let x = 2.3; x <= 5.5; x += 0.8) add(s * x, 0.46, -4.9, "steps", null, 0.75);
      for (const x of [-0.6, 0.6]) add(x, 0.28, -4.8, "door", null, 0.8);
      for (const x of [-4.95, -2.9, 2.9, 4.95]) add(x, 1.3, -4.93, "door", Math.PI / 2, 0.55);
      for (let e = 0; e < 6; e++) { const z = 4.3 - 1.6 * e; add(-6.38, 0.5, z, "wallL", 0, 0.6); add(6.38, 0.5, z, "wallR", Math.PI, 0.6); }
      for (let e = 0; e < 5; e++) { const z = 3.5 - 1.6 * e; add(-6.6, 1.33, z, "wallL", Math.PI / 2, 0.7); add(6.6, 1.33, z, "wallR", -Math.PI / 2, 0.7); }
      add(4.6, 0.62, -1.62, "wallR", Math.PI / 2, 0.5);
      for (const [dx, dz] of [[-0.2, 0.1], [0.18, 0.12], [0.02, -0.2]]) add(-3.6 + dx, 0.2, -0.4 + dz, "pathL", null, 0.42);
      return list.map((d, i) => Object.assign(d, { delay: i === 0 ? 0 : d.pos.distanceTo(HERO) / 3 + 0.25 * hash1(7.3 * i) }));
    })();
    const SPREAD_TOTAL = Math.max(...DIYAS.map((d) => d.delay)) + 0.6;
    const litOf = (d, spreadT, litT) => d.group === "hero" ? (litT < 0 ? 0 : smooth(litT, 0.9, 1.6)) : (spreadT < 0 ? 0 : smooth(spreadT - d.delay, 0, 0.45));

    // The bowl: a lathe with a pinched spout where the wick lies.
    function diyaGeometry(spoutPinch) {
      const prof = [[0, 0], [0.045, 0], [0.07, 0.008], [0.09, 0.024], [0.103, 0.044], [0.11, 0.06], [0.108, 0.068], [0.1, 0.07], [0.092, 0.06], [0.072, 0.044], [0.04, 0.036], [0, 0.034]].map((p) => new THREE.Vector2(p[0], p[1]));
      const geo = new THREE.LatheGeometry(prof, 40);
      const pos = geo.getAttribute("position");
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const ang = Math.atan2(v.x, v.z);
        const n = Math.exp(-((Math.atan2(Math.sin(ang - Math.PI / 2), Math.cos(ang - Math.PI / 2)) / 0.42) ** 2));
        const s = Math.min(1, v.y / 0.068);
        const o = n * Math.pow(s, 1.5);
        const l = spoutPinch ? 1 + 0.07 * s ** 3 * Math.max(0, Math.cos(ang * spoutPinch)) ** 2 * (1 - n) : 1;
        v.x *= (1 + 0.62 * o) * l; v.z *= (1 - 0.5 * o) * l; v.y += 0.016 * o * s;
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      return geo;
    }
    const WICK_AT = new THREE.Vector3(0.152, 0.088, 0);
    const DIYA_FS = `
      ${GLSL_LIGHT}
      varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vUv; varying vec3 vView; varying vec3 vColor;
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 vdir = normalize(vView);
        float v = vUv.y;
        vec3 clay = vec3(0.4, 0.19, 0.09) * paperGrain(vUv * vec2(9.0, 3.0));
        vec3 col = clay;
        float band = smoothstep(0.17, 0.18, v) * (1.0 - smoothstep(0.37, 0.38, v));
        col = mix(col, vec3(0.42, 0.07, 0.07), band);
        float line = smoothstep(0.012, 0.0, abs(v - 0.165)) + smoothstep(0.012, 0.0, abs(v - 0.385));
        vec2 dp = vec2(fract(vUv.x * 30.0) - 0.5, (v - 0.275) * 30.0 * 0.55);
        float dot_ = smoothstep(0.24, 0.18, length(dp)) * band;
        col = mix(col, vec3(1.0, 0.93, 0.8), dot_);
        float gold = clamp(line + smoothstep(0.44, 0.47, v) * (1.0 - smoothstep(0.6, 0.64, v)), 0.0, 1.0);
        col = mix(col, vec3(0.95, 0.66, 0.2), gold);
        float inner = smoothstep(0.64, 0.68, v);
        col = mix(col, clay * 0.38, inner);
        float oil = smoothstep(0.84, 0.88, v);
        col = mix(col, vec3(0.09, 0.035, 0.01), oil);
        vec3 L = warmLight(vWorld, n);
        vec3 c = col * hemi(n) + col * L * 2.2;
        float fres = pow(1.0 - max(dot(n, vdir), 0.0), 3.0);
        c += L * fres * 0.6;
        float spec = pow(max(dot(reflect(-vdir, n), normalize(vec3(0.0, 1.0, 0.2))), 0.0), 24.0);
        c += L * spec * (gold * 1.4 + oil * 3.0);
        c += col * uFlash;
        float fog = 1.0 - exp(-max(length(vView) - 6.0, 0.0) * uFogDensity);
        gl_FragColor = vec4(mix(c, uFogColor, fog), 1.0);
      }
    `;
    const diyaMat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, lightUniforms), vertexShader: VS_SURFACE, fragmentShader: DIYA_FS });
    const wickMat = surfaceMat(0x6a5040, { lightGain: 0.8, grain: false });
    // the flame: a paper-cut tongue that leans and flickers; the glow: a
    // soft disc of light under each lit lamp
    const FLAME_VS = `
      attribute float aLit; attribute float aSeed;
      uniform float uTime;
      varying vec2 vUv; varying float vLit; varying float vSeed;
      void main() {
        vUv = uv; vLit = aLit; vSeed = aSeed;
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = aLit * (0.9 + 0.1 * sin(uTime * 17.0 + aSeed * 40.0) + 0.06 * sin(uTime * 31.0 + aSeed * 13.0));
        float sc = length(instanceMatrix[0].xyz);
        vec2 q = position.xy * vec2(0.05, 0.15) * s * sc;
        q.x += position.y * 0.018 * sc * sin(uTime * 3.1 + aSeed * 9.0) * s;
        center.xy += q;
        gl_Position = projectionMatrix * center;
      }`;
    const FLAME_FS = `
      uniform float uTime;
      varying vec2 vUv; varying float vLit; varying float vSeed;
      void main() {
        if (vLit < 0.01) discard;
        vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
        float w = (1.0 - p.y) * sqrt(max(p.y, 0.0)) * 1.9;
        float wob = 0.08 * sin(p.y * 7.0 - uTime * 9.0 + vSeed * 20.0) * p.y;
        float d = abs(p.x - wob) / max(w, 1e-3);
        float body = smoothstep(1.0, 0.86, d) * smoothstep(0.0, 0.06, p.y);
        float core = smoothstep(0.6, 0.0, d) * smoothstep(0.85, 0.15, p.y);
        vec3 col = vec3(1.0, 0.42, 0.08) * body * 2.6 + vec3(1.0, 0.86, 0.5) * core * 5.0;
        gl_FragColor = vec4(col * vLit, body * vLit);
      }`;
    const GLOW_VS = `
      attribute float aLit; attribute float aSeed;
      uniform float uTime;
      varying vec2 vUv; varying float vI;
      void main() {
        vUv = uv;
        vI = aLit * (0.85 + 0.15 * sin(uTime * 11.0 + aSeed * 30.0));
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sc = length(instanceMatrix[0].xyz);
        center.xy += position.xy * 0.55 * sc;
        gl_Position = projectionMatrix * center;
      }`;
    const GLOW_FS = `
      varying vec2 vUv; varying float vI;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float g = exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r));
        gl_FragColor = vec4(vec3(1.0, 0.5, 0.16) * g * vI * 0.32, 1.0);
      }`;
    const lamps = (() => {
      const n = DIYAS.length;
      const bowlGeo = diyaGeometry(0), heroGeo = diyaGeometry(12);
      const wickGeo = new THREE.CylinderGeometry(0.0025, 0.0035, 0.04, 6);
      wickGeo.rotateZ(-Math.PI / 2 + 0.55);
      wickGeo.translate(0.138, 0.08, 0);
      const seeds = Float32Array.from(DIYAS, (d, i) => 1.618 * i + 0.3);
      const quad = (y) => {
        const g = new THREE.PlaneGeometry(1, 1, 1, 4);
        g.translate(0, y, 0);
        g.setAttribute("aLit", new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
        g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
        return g;
      };
      const flameGeo = quad(0.5), glowGeo = quad(0);
      const flameMat = new THREE.ShaderMaterial({ vertexShader: FLAME_VS, fragmentShader: FLAME_FS, uniforms: { uTime: lightUniforms.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const glowMatI = new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: { uTime: lightUniforms.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const bowls = new THREE.InstancedMesh(bowlGeo, diyaMat, n);
      const wicks = new THREE.InstancedMesh(wickGeo, wickMat, n);
      const flames = new THREE.InstancedMesh(flameGeo, flameMat, n);
      const glows = new THREE.InstancedMesh(glowGeo, glowMatI, n);
      flames.frustumCulled = glows.frustumCulled = false;
      flames.renderOrder = 3; glows.renderOrder = 2;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
      DIYAS.forEach((d, i) => {
        const u = 1.25 * d.scale;
        q.setFromAxisAngle(up, d.yaw);
        sc.set(i === 0 ? 0 : u, i === 0 ? 0 : u, i === 0 ? 0 : u);
        bowls.setMatrixAt(i, m4.compose(d.pos, q, sc));
        sc.set(u, u, u);
        wicks.setMatrixAt(i, m4.compose(d.pos, q, sc));
        const f = WICK_AT.clone().multiplyScalar(u).applyQuaternion(q).add(d.pos);
        const fm = new THREE.Matrix4().compose(f, new THREE.Quaternion(), sc);
        flames.setMatrixAt(i, fm); glows.setMatrixAt(i, fm);
      });
      for (const im of [bowls, wicks, flames, glows]) im.instanceMatrix.needsUpdate = true;
      const hero = new THREE.Mesh(heroGeo, diyaMat);
      hero.position.copy(DIYAS[0].pos); hero.rotation.y = DIYAS[0].yaw; hero.scale.setScalar(1.25 * DIYAS[0].scale);
      scene.add(bowls, wicks, hero, glows, flames);
      return { flameGeo, glowGeo, lit: new Float32Array(n), ignited: new Set() };
    })();
    // Called every frame: how lit each lamp is, and the group lights.
    function updateLamps(onIgnite) {
      const litT = since("lit"), spreadT = since("spread");
      const fl = lamps.flameGeo.getAttribute("aLit"), gl_ = lamps.glowGeo.getAttribute("aLit");
      const sum = new Map(), cnt = new Map();
      DIYAS.forEach((d, i) => {
        const c = litOf(d, spreadT, litT);
        if (c > 0.05 && i > 0 && spreadT >= 0 && spreadT < 30 && !lamps.ignited.has(i)) { lamps.ignited.add(i); onIgnite(d); }
        if (spreadT < 0) lamps.ignited.clear();
        lamps.lit[i] = c;
        fl.setX(i, c); gl_.setX(i, c);
        sum.set(d.group, (sum.get(d.group) || 0) + c);
        cnt.set(d.group, (cnt.get(d.group) || 0) + 1);
      });
      fl.needsUpdate = gl_.needsUpdate = true;
      const t = lightUniforms.uTime.value;
      LIGHT_GROUPS.forEach((g, e) => {
        let r = 0, n = 0;
        for (const k of g.groups) { r += sum.get(k) || 0; n += cnt.get(k) || 0; }
        const flick = 0.92 + 0.06 * Math.sin(13 * t + 3 * e) + 0.03 * Math.sin(29 * t + e);
        lightUniforms.uLightPos.value[e].set(g.pos[0], g.pos[1], g.pos[2], g.radius);
        lightUniforms.uLightCol.value[e].w = (n ? r / n : 0) * g.gain * flick;
      });
    }

    // ====================================================================== //
    // 5. The rangoli: powder colours drawn on the stone in a spiralling sweep //
    // ====================================================================== //
    const RANGOLI_R = 1.35;         // half the size of the drawn square
    const RANGOLI_SECONDS = 6.5;
    const POWDER = { magenta: "#c23a64", pink: "#d9486e", saffron: "#e8761e", yellow: "#f2a33a", green: "#3f8a4a", teal: "#2fb3a8", white: "#f2eee6", blue: "#3858a8", red: "#a8261e" };
    // A square of pixels drawn on a 2D context; OffscreenCanvas when the
    // browser has it, else the runtime's own canvas factory.
    function bakeCanvas(size) {
      if (typeof OffscreenCanvas === "function") {
        const c = new OffscreenCanvas(size, size);
        return { ctx2d: c.getContext("2d", { willReadFrequently: true }), done() {} };
      }
      const c = ctx.createCanvas2D({ layer: "background", input: "passthrough" });
      c.style.display = "none";
      c.width = size; c.height = size;
      const g2 = c.getContext("2d", { willReadFrequently: true });
      g2.setTransform(1, 0, 0, 1, 0, 0);
      return { ctx2d: g2, done() { c.remove(); } };
    }
    function drawRangoli(initial, size) {
      const bake = bakeCanvas(size);
      const n = bake.ctx2d;
      const half = size / 2, a = half / 100;
      n.translate(half, half);
      const petals = (count, r0, r1, hw, fill, stroke, rot) => {
        rot = rot || 0;
        for (let d = 0; d < count; d++) {
          const u = r0 * a, c = r1 * a, h = hw * a, f = d / count * TAU + rot;
          n.save(); n.rotate(f);
          n.beginPath();
          n.moveTo(0, -u);
          n.bezierCurveTo(h, -u - (c - u) * 0.3, 0.7 * h, -c + (c - u) * 0.15, 0, -c);
          n.bezierCurveTo(-(0.7 * h), -c + (c - u) * 0.15, -h, -u - (c - u) * 0.3, 0, -u);
          n.closePath();
          n.restore();
          n.fillStyle = fill; n.fill();
          n.lineWidth = 0.7 * a; n.strokeStyle = stroke; n.stroke();
        }
      };
      const ring = (r, lw, color) => { n.beginPath(); n.arc(0, 0, r, 0, TAU); n.lineWidth = lw; n.strokeStyle = color; n.stroke(); };
      const dots = (r, count, dr, color, rot) => {
        n.fillStyle = color;
        for (let i = 0; i < count; i++) { const o = i / count * TAU + (rot || 0); n.beginPath(); n.arc(Math.cos(o) * r, Math.sin(o) * r, dr, 0, TAU); n.fill(); }
      };
      const P = POWDER;
      for (let t = 0; t < 8; t++) {
        const e = t / 8 * TAU + Math.PI / 8;
        n.save(); n.rotate(e); n.translate(0, -84 * a);
        for (const [rr, col] of [[13, P.teal], [10, P.blue], [7, P.green], [4, P.yellow], [2, P.magenta]]) { n.beginPath(); n.ellipse(0, 0, 0.75 * rr * a, rr * a, 0, 0, TAU); n.fillStyle = col; n.fill(); }
        n.restore();
      }
      petals(8, 62, 92, 15, P.saffron, P.white);
      petals(8, 60, 84, 9, P.yellow, P.saffron);
      ring(62 * a, 6 * a, P.red);
      dots(62 * a, 48, 1.3 * a, P.white);
      petals(16, 40, 60, 7.5, P.magenta, P.white, Math.PI / 16);
      petals(16, 40, 55, 4, P.pink, P.magenta, Math.PI / 16);
      petals(16, 40, 58, 6, P.green, P.white);
      ring(40 * a, 5 * a, P.yellow);
      dots(40 * a, 32, 1.1 * a, P.red);
      petals(8, 16, 38, 11, P.saffron, P.yellow);
      petals(8, 16, 34, 6, P.red, P.saffron);
      petals(8, 18, 33, 8, P.yellow, P.white, Math.PI / 8);
      ring(16 * a, 2 * a, P.white);
      n.beginPath(); n.arc(0, 0, 15 * a, 0, TAU); n.fillStyle = P.magenta; n.fill();
      dots(12.5 * a, 16, 0.9 * a, P.yellow);
      dots(96 * a, 72, 1.1 * a, P.white);
      if (initial) {
        n.fillStyle = P.yellow; n.textAlign = "center"; n.textBaseline = "middle";
        n.font = `${22 * a}px ${DISPLAY_FONT}`;
        n.fillText(initial, 0, 1.2 * a);
      }
      const img = n.getImageData(0, 0, size, size), f = img.data;
      for (let t = 0; t < f.length; t += 4) {
        if (f[t + 3] === 0) continue;
        const e = hash1(t * 0.37), r = 0.78 + 0.32 * e;
        f[t] = Math.min(255, f[t] * r); f[t + 1] = Math.min(255, f[t + 1] * r); f[t + 2] = Math.min(255, f[t + 2] * r);
        if (e < 0.06) f[t + 3] *= 0.3;
      }
      n.putImageData(img, 0, 0);
      n.globalAlpha = 0.5;
      const tones = Object.values(P);
      for (let t = 0; t < 6000; t++) {
        const e = hash1(t * 1.7) * TAU, r = (96 + 4 * hash1(t * 3.1)) * a * Math.sqrt(hash1(t * 5.3 + 1));
        n.fillStyle = tones[t % 9];
        n.fillRect(Math.cos(e) * r, Math.sin(e) * r, 1.5, 1.5);
      }
      const out = n.getImageData(0, 0, size, size);
      bake.done();
      return out;
    }
    const rangoli = (() => {
      const size = story.lowPower ? 768 : 1024;
      const img = drawRangoli(SENDER.charAt(0).toUpperCase(), size);
      const tex = new THREE.DataTexture(img.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.flipY = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); tex.needsUpdate = true;
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, lightUniforms, { uMap: { value: tex }, uProgress: { value: 0 } }),
        vertexShader: `
          varying vec2 vUv; varying vec3 vWorld;
          void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `
          ${GLSL_LIGHT}
          uniform sampler2D uMap; uniform float uProgress;
          varying vec2 vUv; varying vec3 vWorld;
          void main() {
            vec4 tex = texture2D(uMap, vUv);
            vec3 rgb = pow(tex.rgb, vec3(2.2));
            vec2 rp = vUv - 0.5;
            float rr = length(rp) * 2.0;
            float ang = atan(rp.y, rp.x);
            float front = uProgress * 1.25 - rr - 0.05 * sin(ang * 8.0 + rr * 10.0);
            float reveal = smoothstep(0.0, 0.025, front);
            float a = tex.a * reveal;
            if (a < 0.01) discard;
            vec3 L = warmLight(vWorld, vec3(0.0, 1.0, 0.0));
            vec3 col = rgb * (hemi(vec3(0.0, 1.0, 0.0)) * 0.9 + L * 2.4) + rgb * uFlash;
            float band = smoothstep(0.06, 0.0, abs(front - 0.02)) * step(0.001, uProgress) * step(uProgress, 0.999);
            col += vec3(1.0, 0.65, 0.3) * band * 2.5;
            gl_FragColor = vec4(col, a);
          }`,
        transparent: true, depthWrite: false
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * RANGOLI_R, 2 * RANGOLI_R), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0.004, 0);
      mesh.renderOrder = 1;
      scene.add(mesh);
      return { mat, mesh };
    })();
    function updateRangoli() {
      const t = since("rangoli");
      rangoli.mat.uniforms.uProgress.value = t < 0 ? 0 : clamp(t / RANGOLI_SECONDS, 0, 1);
    }

    // ====================================================================== //
    // 6. The sky lantern, and the fifty that follow it into the night        //
    // ====================================================================== //
    const LANTERN_AT = new THREE.Vector3(0, 0.02, 0);
    // where the released lantern is after t seconds: a small bob, then a
    // climb that eases toward a steady drift
    function lanternPath(t, out) {
      const bob = t < 0.7 ? 0.08 * Math.sin(t / 0.7 * Math.PI) : 0;
      const n = Math.max(0, t - 0.7);
      const y = LANTERN_AT.y + bob + 1.3 * (n - 1.5 * (1 - Math.exp(-n / 1.5)));
      return out.set(0.35 * Math.sin(0.5 * n) + 0.12 * n, y, 0.1 * n);
    }
    const lantern = (() => {
      const prof = [[0.17, 0], [0.19, 0.08], [0.215, 0.2], [0.235, 0.32], [0.242, 0.42], [0.232, 0.5], [0.2, 0.56], [0.14, 0.6], [0.06, 0.62], [0, 0.625]].map((p) => new THREE.Vector2(p[0], p[1]));
      const paperGeo = new THREE.LatheGeometry(prof, 28);
      const paperMat = glowMat(0xffa04a, 0, 1);
      const farMat = glowMat(0xff9640, 2.4, 1);
      const ringGeo = new THREE.TorusGeometry(0.17, 0.006, 6, 32);
      const flameGeo = new THREE.SphereGeometry(0.035, 12, 8);
      const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 1.2), toneMapped: false });
      const halo = haloMat(0xff8c33, 0, 3.2);
      const g = new THREE.Group();
      g.position.copy(LANTERN_AT);
      g.scale.setScalar(1.7);
      const paperWrap = new THREE.Group();
      const paper = new THREE.Mesh(paperGeo, paperMat);
      paperWrap.add(paper);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x2a1c12 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.005;
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.y = 0.03;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), halo);
      glow.position.y = 0.3; glow.renderOrder = 5;
      g.add(paperWrap, ring, flame, glow);
      g.visible = false;
      scene.add(g);
      // the flock: slow risers scattered over the town, each on its own clock
      const N = 50;
      const flock = Array.from({ length: N }, (_, e) => {
        const r = hash1(e) * TAU, n = 10 + 34 * hash1(e + 50);
        return { x: Math.cos(r) * n, z: -Math.abs(Math.sin(r)) * n - 6, y0: -1 + 5 * hash1(e + 100), speed: 0.7 + 0.7 * hash1(e + 150), sway: 10 * hash1(e + 200), delay: 6 * hash1(e + 250), scale: 1.5 + 0.9 * hash1(e + 300) };
      });
      const far = new THREE.InstancedMesh(paperGeo, farMat, N);
      far.frustumCulled = false;
      far.count = N;
      scene.add(far);
      return { g, paper, paperWrap, flameMat, halo, paperMat, far, flock, rise: 0, held: 0.25, m4: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
    })();
    const LANTERN_WARM = new THREE.Color("#f2dcb8").multiplyScalar(2.2), LANTERN_HOT = new THREE.Color("#ffa04a");
    function updateLantern(dt) {
      const L = lantern, t = lightUniforms.uTime.value;
      const a = since("lantern");
      const flick = 0.92 + 0.08 * Math.sin(11 * t) * Math.sin(7.3 * t);
      let n;
      if (a < 0) {
        // waiting at the centre of the rangoli, swelling into view as the last petals are drawn
        L.g.position.copy(LANTERN_AT); L.g.rotation.set(0, 0, 0);
        const k = smooth(since("rangoli"), 5.4, 6.6);
        L.g.visible = k > 0.001;
        L.g.scale.setScalar(1.7 * (0.15 + 0.85 * (1 - Math.pow(1 - k, 3))));
        L.rise += (0 - L.rise) * (1 - Math.exp(-10 * dt));
        L.held = n = (0.25 + 1.6 * L.rise) * k;
        L.paperWrap.scale.set(1, 0.86 + 0.14 * L.rise, 1);
      } else {
        const k = 1 - smooth(a, 20, 30);
        L.g.visible = k > 0.001;
        lanternPath(a, L.g.position);
        L.g.rotation.y = 0.25 * a;
        L.g.rotation.z = 0.05 * Math.sin(1.1 * a);
        L.g.scale.setScalar(1.7 * k);
        L.paperWrap.scale.set(1, lerp(0.86 + 0.14 * L.rise, 1, smooth(a, 0, 0.5)), 1);
        n = lerp(Math.max(L.held, 0.25), 2.3, smooth(a, 0, 0.9));
      }
      L.paperMat.uniforms.uIntensity.value = n * flick;
      L.paperMat.uniforms.uColor.value.copy(LANTERN_WARM).lerp(LANTERN_HOT, smooth(n, 0.25, 1.6));
      const m = Math.min(1, n / 2);
      L.flameMat.color.setRGB(6 * m, 3.2 * m, 1.2 * m);
      L.halo.uniforms.uI.value = 0.18 * Math.max(0, n - 0.4) * flick;
      lightUniforms.uLightCol.value[L_LANTERN].w = 0.6 * Math.max(0, n - 0.25) * flick;
      lightUniforms.uLightPos.value[L_LANTERN].set(L.g.position.x, L.g.position.y + 0.4, L.g.position.z, 5);
      // the flock
      const y = since("lantern"), x = since("wish");
      const w = y >= 0 ? y : x >= 0 ? 60 + x : -1;
      L.flock.forEach((f, e) => {
        const r = w < 0 ? -1 : w - f.delay;
        const dist = Math.max(0, r) * f.speed;
        const lap = Math.floor(dist / 45), o = (dist % 45) / 45;
        const s = lap === 0 ? smooth(r, 0, 2.8) : smooth(o, 0, 0.06);
        const u = r < 0 ? 0 : s * (1 - smooth(o, 0.8, 1));
        L.p.set(f.x + Math.sin(0.25 * t + f.sway), f.y0 + 45 * o, f.z);
        L.s.setScalar(f.scale * u);
        L.q.setFromAxisAngle(L.up, f.sway);
        L.far.setMatrixAt(e, L.m4.compose(L.p, L.q, L.s));
      });
      L.far.instanceMatrix.needsUpdate = true;
    }

    // ====================================================================== //
    // 7. Fireworks: shells climbing over the roofs and bursting over the town //
    // ====================================================================== //
    // One big point cloud, fourteen slots of 1600 particles. A launch fills
    // a slot with a rocket trail, the burst's stars (with their trails), a
    // flash and some smoke; after that the vertex shader does all the
    // motion from the time alone, so a burst costs nothing per frame.
    const SHELLS = {
      peony: { stars: 300, trail: 2, speed: 21.6, drag: 2.7, grav: 2.4, life: 2.1, glitter: 0.4 },
      chrysanthemum: { stars: 200, trail: 7, speed: 23, drag: 2.9, grav: 2.2, life: 2.4, glitter: 0.3 },
      willow: { stars: 90, trail: 14, speed: 16.2, drag: 3.6, grav: 3.4, life: 5, glitter: 1 },
      ring: { stars: 180, trail: 4, speed: 21.6, drag: 2.8, grav: 2, life: 2.1, glitter: 0 },
      crackle: { stars: 150, trail: 3, speed: 20.2, drag: 2.7, grav: 2.4, life: 1.5, glitter: 0 },
      crossette: { stars: 22, trail: 6, speed: 18.9, drag: 2.2, grav: 2, life: 0.8, glitter: 0 }
    };
    const SHELL_COLORS = [[6, 3.2, 0.9], [5, 0.8, 2.5], [1.2, 5, 1.6], [1.4, 2.6, 6], [6, 1.6, 0.6], [7, 6.5, 5.5]];
    const FW_SCHEDULE = [
      { at: 0.2, x: -5, z: -22, h: 20, kind: "peony", color: 0 }, { at: 1, x: 6, z: -24, h: 22, kind: "chrysanthemum", color: 1 },
      { at: 1.8, x: 0, z: -26, h: 24, kind: "crossette", color: 0, color2: 5 }, { at: 2.4, x: -10, z: -28, h: 21, kind: "peony", color: 4, color2: 5 },
      { at: 2.9, x: 10, z: -26, h: 23, kind: "chrysanthemum", color: 3 }, { at: 3.6, x: -2, z: -22, h: 19, kind: "crackle", color: 5 },
      { at: 4.1, x: 4, z: -28, h: 26, kind: "ring", color: 5 }, { at: 4.6, x: -7, z: -26, h: 24, kind: "crossette", color: 2, color2: 0 },
      { at: 5.2, x: 8, z: -22, h: 21, kind: "peony", color: 0, color2: 1 }, { at: 5.9, x: -12, z: -30, h: 25, kind: "willow", color: 0 },
      { at: 6, x: 0, z: -28, h: 27, kind: "willow", color: 0 }, { at: 6.1, x: 12, z: -30, h: 25, kind: "willow", color: 0 },
      { at: 6.6, x: -5, z: -24, h: 23, kind: "crackle", color: 0 }, { at: 6.7, x: 5, z: -24, h: 23, kind: "crackle", color: 5 },
      { at: 7.3, x: -8, z: -26, h: 22, kind: "peony", color: 3, color2: 0 }, { at: 7.9, x: 7, z: -24, h: 21, kind: "ring", color: 1 },
      { at: 8.6, x: -2, z: -28, h: 25, kind: "chrysanthemum", color: 4, color2: 5 }, { at: 9.2, x: 11, z: -27, h: 23, kind: "crossette", color: 2, color2: 5 },
      { at: 9.8, x: -11, z: -29, h: 24, kind: "willow", color: 0 }, { at: 10.3, x: 3, z: -23, h: 20, kind: "crackle", color: 5 },
      { at: 10.9, x: -5, z: -25, h: 22, kind: "peony", color: 1, color2: 3 }
    ];
    // The first shells go up while the lantern is still climbing: the
    // fireworks clock starts this many seconds into the lantern phase and
    // runs on through the pull-back and the wish.
    const FW_LEAD = 3.0;
    const FW_WIDE = [{ at: 2.4, x: -16, z: -29, h: 24, kind: "peony", color: 1, color2: 5 }, { at: 3.3, x: 16, z: -29, h: 25, kind: "crackle", color: 5 }];
    const SLOT = 1600, SLOTS = 14;
    const FW_VS = `
      attribute vec3 aVel; attribute vec3 aColor; attribute vec4 aTime; attribute vec3 aPhys;
      uniform float uTime; uniform float uPx;
      varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vHot;
      float h1(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float idx = aTime.w;
        float kind = aTime.z;
        float t = uTime - aTime.x - (kind < 0.5 ? idx * 0.035 : 0.0);
        float life = aTime.y;
        vKind = kind; vHot = 0.0;
        if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        float x = t / life;
        float seed = aPhys.z * 13.7 + position.x * 3.1 + aVel.y * 7.3 + aVel.x;
        vec3 p; float a; float size; vec3 col = aColor;
        if (kind > 3.5) {
          p = position; a = 1.0 - x; size = 0.55; vHot = 1.0;
        } else if (kind > 2.5) {
          float k = 1.8;
          p = position + aVel * (1.0 - exp(-k * t)) / k + vec3(0.0, 0.25, 0.0) * t;
          a = smoothstep(0.0, 0.15, x) * (1.0 - x) * 0.22;
          size = mix(2.5, 7.0, x);
        } else if (kind > 1.5) {
          p = position; a = exp(-t * 20.0) * 0.8; size = mix(2.6, 4.6, x); vHot = 1.0;
        } else if (kind > 0.5) {
          p = position + aVel * t;
          a = 1.0 - idx / 12.0;
          col *= mix(1.0, 0.45, idx / 12.0);
          size = 0.2 * (1.0 - idx * 0.05);
        } else {
          float k = aPhys.x;
          p = position + aVel * (1.0 - exp(-k * t)) / k + vec3(0.0, -aPhys.y, 0.0) * t * t * 0.5;
          float hot = exp(-t * 7.0);
          vHot = hot * (idx < 0.5 ? 1.0 : 0.0);
          col = mix(col, vec3(7.0, 6.4, 5.6), hot * 0.85);
          col *= mix(vec3(1.0), vec3(1.0, 0.5, 0.22), smoothstep(0.45, 1.0, x));
          col *= 0.8 + 0.2 * sin(uTime * 31.0 + seed * 53.0);
          if (idx > 0.5) col *= vec3(0.7, 0.45, 0.3) * (1.0 - idx / 12.0);
          a = (1.0 - x * x);
          float g = step(0.5, h1(seed + floor(uTime * 16.0)));
          a *= mix(1.0, g * 1.7, aPhys.z * smoothstep(0.55, 0.85, x));
          size = mix(0.42, 0.26, x) * (1.0 - idx * 0.07);
        }
        vColor = col; vAlpha = a;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPx * size / -mv.z, 1.0, (kind > 1.5 && kind < 3.5) ? 220.0 : 26.0);
      }`;
    const FW_FS = `
      varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vHot;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        float g;
        if (vKind > 3.5) g = exp(-d * 10.0) * 1.6 + exp(-d * 2.5) * 0.25;
        else if (vKind > 2.5) g = exp(-d * 2.2) * 0.9;
        else if (vKind > 1.5) g = exp(-d * 3.0) + exp(-d * 18.0) * 2.0;
        else {
          g = exp(-d * 14.0) * 1.2 + exp(-d * 3.0) * 0.28;
          float cross = max(exp(-abs(c.x) * 60.0), exp(-abs(c.y) * 60.0)) * exp(-d * 1.5);
          g += cross * vHot * 0.7;
        }
        g *= 1.0 - smoothstep(0.7, 1.0, d);
        gl_FragColor = vec4(vColor * g * vAlpha, 1.0);
      }`;
    const fireworks = (() => {
      const N = SLOT * SLOTS;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
      geo.setAttribute("aVel", new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
      geo.setAttribute("aColor", new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
      geo.setAttribute("aPhys", new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
      const tm = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) tm[i * 4] = -1e6;
      geo.setAttribute("aTime", new THREE.Float32BufferAttribute(tm, 4));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 15, -25), 90);
      const uniforms = { uTime: { value: 0 }, uPx: { value: 800 } };
      const mat = new THREE.ShaderMaterial({ vertexShader: FW_VS, fragmentShader: FW_FS, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.renderOrder = 8;
      scene.add(points);
      return { geo, uniforms, slot: 0, fired: new Set(), clock: 0, flashes: [], booms: [] };
    })();
    // where a star is after t seconds of drag and gravity
    const starAt = (c, v, drag, grav, t) => { const s = (1 - Math.exp(-drag * t)) / drag; return new THREE.Vector3(c.x + v.x * s, c.y + v.y * s - 0.5 * grav * t * t, c.z + v.z * s); };
    // Fill a slot with a shell launched at time t0 (on the fireworks clock).
    function launchShell(t0, spec) {
      const F = fireworks, g = F.geo;
      const base = (F.slot++ % SLOTS) * SLOT;
      const A = { pos: g.getAttribute("position"), vel: g.getAttribute("aVel"), col: g.getAttribute("aColor"), phys: g.getAttribute("aPhys"), time: g.getAttribute("aTime") };
      for (let e = 0; e < SLOT; e++) A.time.setX(base + e, -1e6);
      const flight = 1.3 + 0.4 * Math.random();
      const from = new THREE.Vector3(0.7 * spec.x, 2, spec.z + 4);
      const centre = new THREE.Vector3(spec.x, spec.h, spec.z);
      const v = centre.clone().sub(from).divideScalar(flight);
      let k = base;
      for (let e = 0; e < 12; e++, k++) { A.pos.setXYZ(k, from.x, from.y, from.z); A.vel.setXYZ(k, v.x, v.y, v.z); A.col.setXYZ(k, 3, 1.6, 0.6); A.phys.setXYZ(k, 1, 0, 0); A.time.setXYZW(k, t0, flight, 1, e); }
      const S = SHELLS[spec.kind], c1 = SHELL_COLORS[spec.color], c2 = SHELL_COLORS[spec.color2 == null ? spec.color : spec.color2];
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() - 0.5, 0, Math.random() - 0.5));
      const stars = [];
      const burst = t0 + flight;
      for (let e = 0; e < S.stars && k + S.trail <= base + SLOT; e++) {
        let d;
        if (spec.kind === "ring") { const t = e / S.stars * TAU; d = new THREE.Vector3(Math.cos(t), 0, Math.sin(t)).applyQuaternion(tilt); }
        else { const y = 1 - 2 * (e + 0.5) / S.stars, r = Math.sqrt(1 - y * y), ph = 2.39996 * e; d = new THREE.Vector3(Math.cos(ph) * r, y, Math.sin(ph) * r); }
        d.multiplyScalar(S.speed * (0.9 + 0.2 * Math.random()));
        const col = e % 3 === 0 ? c2 : c1, life = S.life * (0.85 + 0.3 * Math.random());
        stars.push({ v: d.clone(), life, c: col });
        for (let j = 0; j < S.trail; j++, k++) { A.pos.setXYZ(k, centre.x, centre.y, centre.z); A.vel.setXYZ(k, d.x, d.y, d.z); A.col.setXYZ(k, col[0], col[1], col[2]); A.phys.setXYZ(k, S.drag, S.grav, S.glitter); A.time.setXYZW(k, burst, life, 0, j); }
      }
      const pop = (p, at, i) => { if (k >= base + SLOT) return; A.pos.setXYZ(k, p.x, p.y, p.z); A.vel.setXYZ(k, 0, 0, 0); A.col.setXYZ(k, 9 * i, 8.4 * i, 7.2 * i); A.phys.setXYZ(k, 1, 0, 0); A.time.setXYZW(k++, at, 0.06 + 0.07 * Math.random(), 4, 0); };
      if (spec.kind === "crackle") {
        for (const s of stars) {
          const tt = 0.92 * s.life, p = starAt(centre, s.v, S.drag, S.grav, tt);
          for (let j = 0; j < 4; j++) { const o = new THREE.Vector3().randomDirection().multiplyScalar(0.15 + 0.45 * Math.random()); pop(p.clone().add(o), burst + tt + 0.45 * Math.random(), 1); }
        }
      } else if (spec.kind === "crossette") {
        for (const s of stars) {
          const tt = s.life, p = starAt(centre, s.v, S.drag, S.grav, tt);
          const vel = s.v.clone().multiplyScalar(Math.exp(-S.drag * tt)).add(new THREE.Vector3(0, -S.grav * tt, 0));
          pop(p, burst + tt, 0.8);
          const l = vel.clone().normalize();
          let u = new THREE.Vector3(0, 1, 0).cross(l).normalize();
          if (u.lengthSq() < 0.01) u.set(1, 0, 0);
          const h = l.clone().cross(u).normalize();
          for (const dir of [u, h, u.clone().negate(), h.clone().negate()]) {
            const a2 = vel.clone().add(dir.clone().multiplyScalar(9)), life2 = 1.3 + 0.4 * Math.random();
            for (let j = 0; j < 5 && k < base + SLOT; j++, k++) { A.pos.setXYZ(k, p.x, p.y, p.z); A.vel.setXYZ(k, a2.x, a2.y, a2.z); A.col.setXYZ(k, c2[0], c2[1], c2[2]); A.phys.setXYZ(k, 2.4, 2.4, 0.4); A.time.setXYZW(k, burst + tt, life2, 0, j); }
          }
        }
      }
      if (k < base + SLOT) { A.pos.setXYZ(k, centre.x, centre.y, centre.z); A.vel.setXYZ(k, 0, 0, 0); A.col.setXYZ(k, (c1[0] + 7) * 0.6, (c1[1] + 6) * 0.6, (c1[2] + 5) * 0.6); A.phys.setXYZ(k, 1, 0, 0); A.time.setXYZW(k++, burst, 0.3, 2, 0); }
      for (let e = 0; e < 9 && k < base + SLOT; e++, k++) {
        const o = new THREE.Vector3().randomDirection().multiplyScalar(1.5 + 2.5 * Math.random());
        A.pos.setXYZ(k, centre.x, centre.y, centre.z); A.vel.setXYZ(k, o.x, 0.6 * o.y, o.z); A.col.setXYZ(k, 0.25 + 0.04 * c1[0], 0.22 + 0.04 * c1[1], 0.24 + 0.04 * c1[2]); A.phys.setXYZ(k, 1.8, 0, 0); A.time.setXYZW(k, burst + 0.08, 2.2 + Math.random(), 3, 0);
      }
      for (const a of Object.values(A)) a.needsUpdate = true;
      F.flashes.push({ at: burst, k: spec.kind === "willow" ? 0.6 : 1 });
      F.booms.push({ at: burst, kind: spec.kind, dist: centre.distanceTo(camera.position) });
      return burst;
    }
    function fireworksClock() {
      const l = since("lantern");
      return l >= 0 ? l - FW_LEAD : -1;
    }
    function updateFireworks(onBoom) {
      const F = fireworks;
      const t = fireworksClock();
      F.uniforms.uTime.value = t < 0 ? -1e6 : t;
      F.uniforms.uPx.value = ctx.height * DPR;
      if (t < 0) { F.fired.clear(); F.flashes.length = 0; F.booms.length = 0; return; }
      const list = ctx.width / Math.max(1, ctx.height) > 1.2 ? FW_SCHEDULE.concat(FW_WIDE) : FW_SCHEDULE;
      list.forEach((s, i) => { if (!F.fired.has(i) && t >= s.at && t < s.at + 4) { F.fired.add(i); launchShell(t, s); } });
      for (let i = F.flashes.length - 1; i >= 0; i--) if (t >= F.flashes[i].at) { flash(0.045 * F.flashes[i].k); F.flashes.splice(i, 1); }
      for (let i = F.booms.length - 1; i >= 0; i--) if (t >= F.booms[i].at) { onBoom(F.booms[i]); F.booms.splice(i, 1); }
    }
    // A shell launched toward where the viewer tapped the sky.
    function launchToward(dir, origin) {
      const t = fireworksClock();
      if (t < 0) return;
      const far = origin.clone().addScaledVector(dir, 26);
      const kinds = Object.keys(SHELLS);
      launchShell(t, { x: clamp(far.x, -18, 18), z: clamp(far.z, -34, -18), h: clamp(far.y, 14, 30), kind: kinds[Math.floor(Math.random() * kinds.length)], color: Math.floor(Math.random() * 6), color2: Math.floor(Math.random() * 6) });
    }

    // ====================================================================== //
    // 8. The camera shots, and the wish written in the sky                   //
    // ====================================================================== //
    // Where the camera stands in each phase: position, what it looks at,
    // the lens, how long it takes to get there, and a slow drift once there.
    const SHOTS = {
      loading: { pos: [HERO.x + 0.62, 0.42, HERO.z + 1.4], look: [HERO.x, 0.1, HERO.z], fov: 30, dur: 0 },
      approach: { pos: [HERO.x + 0.3, 0.26, HERO.z + 0.82], look: [HERO.x + 0.05, 0.09, HERO.z], fov: 30, dur: 5.5, ease: "power2.out", drift: [-0.05, -0.02, -0.12] },
      lit: { pos: [HERO.x + 0.16, 0.2, HERO.z + 0.62], look: [HERO.x - 0.03, 0.13, HERO.z], fov: 28, dur: 3, ease: "sine.inOut" },
      spread: { pos: [0.3, 2.4, 5], look: [0, 2.6, -5], fov: 52, dur: 8.5, ease: "sine.inOut", drift: [-0.6, 0.5, 0.3] },
      rangoli: { pos: [0.7, 3.4, 3.5], look: [0, 0.2, -0.2], fov: 46, dur: 5.5, ease: "sine.inOut", drift: [-1.2, -1.2, 0.2] },
      // the lantern shot follows the lantern up: the look tracks it and the
      // camera climbs and backs away as it goes, so the roof and the first
      // shells over it stay in frame
      lantern: { pos: [1.9, 0.8, 3.3], look: [0, 0.9, 0], fov: 48, dur: 5, ease: "sine.inOut", drift: [0.3, 0.2, 0.4], track: true, follow: (a) => [0.1 * a, 0.22 * a, 0.36 * a] },
      fireworks: { pos: [0, 3.2, 12], look: [0, 10, -24], fov: 58, dur: 7, ease: "sine.inOut", drift: [0, 0.3, -0.8], axes: { x: [0, 1], y: [0, 0.6], z: [0.3, 0.7] } },
      wish: { pos: [0.2, 3, 11.4], look: [0, 9, -24], fov: 56, dur: 3, ease: "sine.inOut", drift: [0.5, 0.1, -0.5] }
    };
    const RAD = Math.PI / 180;
    // The shots are framed for a landscape lens; on a phone held upright the
    // vertical field widens so the same scene fits across the narrow screen.
    function shotFov(fov) {
      const aspect = ctx.width / Math.max(1, ctx.height);
      if (aspect >= 1.2) return fov;
      return Math.min(2 * Math.atan(Math.tan(0.75 * Math.atan(Math.tan(fov * RAD / 2) * (16 / 9))) / aspect) / RAD, 64);
    }

    const WISH_LINES = [
      { text: WISH_LINE, size: 1, launch: 0.2, color: [3, 1.4, 0.22] },
      { text: "from " + SENDER, size: 0.56, launch: 1.35, color: [3.4, 0.8, 0.08] }
    ];
    const wishBurstAt = (i) => WISH_LINES[i].launch + 1.8;
    const WISH_VS = `
      attribute vec3 aTarget;
      attribute vec4 aDir;
      attribute vec4 aInfo;
      attribute vec3 aColor;
      uniform float uTime; uniform float uBurst; uniform vec3 uCentre; uniform vec3 uOrigin; uniform vec3 uRight; uniform float uPx;
      varying vec3 vColor; varying float vAlpha; varying float vHot; varying float vKind;
      float h1(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float kind = aInfo.z;
        float seed = aInfo.y;
        vKind = kind; vHot = 0.0;
        vec3 p; float a = 1.0; float size; vec3 col = aColor;
        float t = uTime - uBurst;
        if (kind > 2.5) {
          p = uCentre;
          a = t < 0.0 ? 0.0 : exp(-t * 12.0) * 0.7;
          size = mix(2.6, 4.2, clamp(t * 4.0, 0.0, 1.0));
          vHot = 1.0;
        } else if (kind > 0.5 && kind < 1.5) {
          float tr = uTime - (uBurst - 1.80) - aInfo.w * 0.03;
          float tc = clamp(tr, 0.0, 1.80);
          vec3 d = uCentre - uOrigin;
          float T = 1.80;
          float g = 2.0 * d.y / (T * T);
          p = uOrigin + vec3(d.x * tc / T, (2.0 * d.y / T) * tc - 0.5 * g * tc * tc, d.z * tc / T);
          p.x += sin(tr * 23.0 + seed) * 0.03;
          a = (tr < 0.0 || tr > 1.80) ? 0.0 : 1.0 - aInfo.w / 16.0;
          col *= mix(1.0, 0.4, aInfo.w / 16.0);
          size = 0.26 * (1.0 - aInfo.w * 0.04);
          vHot = aInfo.w < 0.5 ? 1.0 : 0.0;
        } else {
          float ts = kind > 3.5 ? 1e3 : aInfo.x;
          float tf = clamp(t, 0.0, ts);
          float ek = exp(-2.20 * tf);
          p = uCentre + aDir.xyz * (1.0 - ek) / 2.20 - vec3(0.0, (9.81 / 2.20) * (tf - (1.0 - ek) / 2.20), 0.0);
          float stuck = step(ts, t);
          if (kind < 0.5 && stuck > 0.5) p = aTarget;
          float hot = exp(-max(t, 0.0) * 3.0);
          float flare = stuck * exp(-(t - ts) * 7.0);
          vHot = max(hot, flare);
          col = mix(col, vec3(7.0, 6.2, 5.0), max(hot * 0.9, flare * 0.8));
          float settled = smoothstep(ts, ts + 0.8, t);
          float tw = 0.78 + 0.22 * sin(uTime * (4.0 + seed * 5.0) + seed * 60.0);
          float glit = step(0.985, h1(seed * 91.0 + floor(uTime * 14.0)));
          size = mix(0.2, aDir.w, stuck) * (1.0 + flare * 0.8);
          if (kind < 0.5) {
            float sx = dot(aTarget - uCentre, uRight);
            float w0 = uBurst + 2.40 + (sx + 14.0) * 0.045;
            float whiten = smoothstep(w0, w0 + 0.7, uTime);
            float front = exp(-pow((uTime - w0 - 0.25) * 5.0, 2.0));
            col = mix(col, vec3(1.9, 1.8, 1.6), whiten) * (1.0 + front * 1.2);
            size *= 1.0 + front * 0.5;
          }
          col *= mix(1.0, tw, settled) * (1.0 + glit * 1.6 * settled);
          a = t < 0.0 ? 0.0 : 1.0;
          if (kind > 3.5) {
            float x = t / aInfo.x;
            a = (t < 0.0 || x > 1.0) ? 0.0 : 1.0 - x * x;
            col *= mix(vec3(1.0), vec3(1.0, 0.45, 0.2), x);
            size = 0.17;
          }
          if (kind > 1.5) {
            float period = 1.6 + seed * 1.4;
            float td = mod(uTime + seed * 7.0, period);
            float on = smoothstep(2.6, 3.2, t);
            const float KD = 1.6;
            float fall = (9.81 / KD) * (td - (1.0 - exp(-KD * td)) / KD);
            p = aTarget + vec3(sin(seed * 40.0) * 0.4 * (1.0 - exp(-KD * td)) / KD, -fall, 0.0);
            float life = 1.0;
            a = on * (td < life ? 1.0 - td / life : 0.0);
            col = vec3(3.0, 1.7, 0.6) * (0.6 + 0.4 * sin(td * 40.0 + seed * 9.0));
            size = 0.09;
          }
        }
        vColor = col; vAlpha = a;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = a <= 0.0 ? 0.0 : clamp(uPx * size / -mv.z, 1.0, kind > 2.5 ? 160.0 : 40.0);
      }`;
    const WISH_FS = `
      varying vec3 vColor; varying float vAlpha; varying float vHot; varying float vKind;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        float g;
        if (vKind > 2.5) g = exp(-d * 3.0) * 0.9 + exp(-d * 16.0) * 1.6;
        else {
          g = exp(-d * 9.0) * 1.15 + exp(-d * 2.4) * (vKind < 0.5 ? 0.1 : 0.3);
          float cross = max(exp(-abs(c.x) * 50.0), exp(-abs(c.y) * 50.0)) * exp(-d * 1.4);
          g += cross * vHot * 0.8;
        }
        g *= 1.0 - smoothstep(0.7, 1.0, d);
        gl_FragColor = vec4(vColor * g * vAlpha, 1.0);
      }`;
    // Sample the ink of a line of text into points, on a grid fine enough to
    // give about `target` of them.
    function sampleText(text, fontPx, target) {
      const font = `700 ${fontPx}px ${DISPLAY_FONT}`;
      const probe = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(8, 8).getContext("2d") : null;
      if (!probe) return null;
      probe.font = font;
      const inkWidth = probe.measureText(text).width;
      const w = Math.ceil(inkWidth + 0.4 * fontPx), h = Math.ceil(1.5 * fontPx);
      const c = new OffscreenCanvas(w, h);
      const g2 = c.getContext("2d", { willReadFrequently: true });
      g2.font = font; g2.fillStyle = "#fff"; g2.textAlign = "center"; g2.textBaseline = "middle";
      g2.fillText(text, w / 2, h / 2);
      const data = g2.getImageData(0, 0, w, h).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 128) count++;
      if (!count) return null;
      const step = Math.max(1.5, Math.sqrt(count / target));
      const pts = [];
      for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
        const rx = x + (Math.random() - 0.5) * step * 0.7, ry = y + (Math.random() - 0.5) * step * 0.7;
        const ix = Math.min(w - 1, Math.max(0, Math.round(rx))), iy = Math.min(h - 1, Math.max(0, Math.round(ry)));
        if (data[(iy * w + ix) * 4 + 3] > 128) pts.push([rx - w / 2, ry - h / 2]);
      }
      return { pts, step, inkWidth };
    }
    const wish = { group: new THREE.Group(), lines: [], built: false, fired: new Set(), layout: null };
    scene.add(wish.group);
    function wishLayout() {
      const s = SHOTS.wish;
      const pos = new THREE.Vector3(...s.pos), look = new THREE.Vector3(...s.look);
      const dir = look.clone().sub(pos).normalize();
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      const aspect = ctx.width / Math.max(1, ctx.height);
      const c = 30 * Math.tan(shotFov(s.fov) * RAD / 2);
      // high in a tall screen, a little lower in a wide one so it clears the top edge
      const lift = aspect < 1.2 ? 0.52 : 0.3;
      return { centre: pos.clone().addScaledVector(dir, 30).addScaledVector(up, lift * c), right, up, dir, width: Math.min(c * aspect * 1.4, 25), halfH: c };
    }
    function buildWish() {
      for (const l of wish.lines) { l.geo.dispose(); l.mat.dispose(); }
      wish.lines = []; wish.group.clear(); wish.built = false;
      const T = wishLayout();
      wish.layout = T;
      const scaleK = story.lowPower ? 0.55 : 1;
      const samples = WISH_LINES.map((l, i) => sampleText(l.text, 220 * l.size, (i === 0 ? 3600 : 2200) * scaleK));
      if (samples.some((s) => !s)) return;
      const fit = T.width / samples[0].inkWidth;
      const u = samples.map((s) => Math.min(fit, T.width / s.inkWidth));
      const c = 220 * WISH_LINES[0].size * u[0], h = 220 * WISH_LINES[1].size * u[1];
      const lineY = [0.4 * c, 0.4 * c - 0.5 * c - 0.75 * h - 0.12 * c];
      const burstY = [lineY[0] + 1.15 * c, (lineY[0] - 0.5 * c + lineY[1] + 0.5 * h) / 2 + 0.05 * c];
      samples.forEach((s, e) => {
        const line = WISH_LINES[e], k = u[e];
        const origin = T.centre.clone().addScaledVector(T.up, lineY[e]);
        const centre = T.centre.clone().addScaledVector(T.up, burstY[e]).addScaledVector(T.right, e ? 1 : -1.5);
        const launchFrom = new THREE.Vector3(e ? 1.6 : -1.4, 1, HOUSE_Z - 8);
        const n = s.pts.length, loose = Math.floor(0.25 * n), drips = Math.floor(n / 9);
        const total = n + loose + drips + 16 + 1;
        const pos = new Float32Array(total * 3), dir = new Float32Array(total * 4), info = new Float32Array(total * 4), col = new Float32Array(total * 3);
        const px = s.step * k * 1.5;
        let i = 0;
        const put = (p, d, w, stick, kind, trail, color) => { pos.set([p.x, p.y, p.z], i * 3); dir.set([d.x, d.y, d.z, w], i * 4); info.set([stick, Math.random(), kind, trail], i * 4); col.set(color, i * 3); i++; };
        const at = (x, y) => origin.clone().addScaledVector(T.right, x * k).addScaledVector(T.up, -y * k);
        for (const [x, y] of s.pts) {
          const target = at(x, y);
          const stick = 0.45 + 0.07 * target.distanceTo(centre) + 0.6 * Math.random();
          const ek = 1 - Math.exp(-2.2 * stick);
          const drop = 9.81 / 2.2 * (stick - ek / 2.2);
          const v = target.clone().sub(centre).add(new THREE.Vector3(0, drop, 0)).multiplyScalar(2.2 / ek);
          put(target, v, px * (0.8 + 0.4 * Math.random()), stick, 0, 0, line.color);
        }
        for (let q = 0; q < loose; q++) {
          const v = new THREE.Vector3().randomDirection().multiplyScalar((e ? 9 : 12) * (0.6 + 0.5 * Math.random()));
          v.addScaledVector(T.dir, -(0.5 * v.dot(T.dir)));
          put(centre, v, 0, 1.2 + Math.random(), 4, 0, line.color);
        }
        for (let q = 0; q < drips; q++) { const [x, y] = s.pts[Math.floor(Math.random() * n)]; put(at(x, y), new THREE.Vector3(), 0, 0, 2, 0, line.color); }
        for (let q = 0; q < 16; q++) put(centre, new THREE.Vector3(), 0, 0, 1, q, [6, 3.4, 1.4]);
        put(centre, new THREE.Vector3(), 0, 0, 3, 0, [line.color[0] + 3, line.color[1] + 2.6, line.color[2] + 2.2]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos.slice(), 3));
        geo.setAttribute("aTarget", new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 4));
        geo.setAttribute("aInfo", new THREE.Float32BufferAttribute(info, 4));
        geo.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
        geo.boundingSphere = new THREE.Sphere(centre.clone(), 40);
        const mat = new THREE.ShaderMaterial({
          vertexShader: WISH_VS, fragmentShader: WISH_FS,
          uniforms: { uTime: { value: -1 }, uBurst: { value: wishBurstAt(e) }, uCentre: { value: centre }, uOrigin: { value: launchFrom }, uRight: { value: T.right }, uPx: { value: 800 } },
          transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false
        });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.renderOrder = 20;
        wish.group.add(points);
        wish.lines.push({ geo, mat, centre, launchFrom });
      });
      wish.built = true;
    }
    function updateWish(onLineBurst) {
      const t = since("wish");
      if (t < 0) { wish.fired.clear(); for (const l of wish.lines) l.mat.uniforms.uTime.value = -1; world.userData.sky.uniforms.uWish.value = 0; return; }
      if (!wish.built) buildWish();
      for (const l of wish.lines) { l.mat.uniforms.uTime.value = t; l.mat.uniforms.uPx.value = ctx.height * DPR; }
      world.userData.sky.uniforms.uWish.value = 0.68 * smooth(t, wishBurstAt(0) - 0.3, wishBurstAt(0) + 2.5);
      WISH_LINES.forEach((l, i) => {
        if (wish.fired.has(i) || t < l.launch) return;
        wish.fired.add(i);
        onLineBurst(i, wishBurstAt(i) - t);
      });
    }

    // ====================================================================== //
    // 9. The glow: bloom over the bright parts, then a filmic curve         //
    // ====================================================================== //
    // The scene renders in linear light with values well above one for
    // flames, bulbs and sparks. The bright parts are pulled out, blurred at
    // three sizes and added back, and the sum goes through the AgX curve
    // to the screen, so a flame has a soft halo and nothing clips to flat.
    const post = (() => {
      const type = floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType;
      // the scene target asks for a stencil too: that is what gets it a
      // 24-bit depth buffer, and 16 bits strip the facade into bands
      const mk = (depth) => new THREE.WebGLRenderTarget(2, 2, { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: depth, stencilBuffer: depth, generateMipmaps: false });
      const sceneRT = mk(true);
      const levels = [0, 1, 2].map(() => ({ a: mk(false), b: mk(false), w: 1, h: 1 }));
      const quadScene = new THREE.Scene();
      const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
      quad.frustumCulled = false;
      quadScene.add(quad);
      const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
      const threshold = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, uLo: { value: floatOk ? 0.8 : 0.62 }, uHi: { value: floatOk ? 1.3 : 0.98 } },
        vertexShader: VS,
        fragmentShader: `
          uniform sampler2D tDiffuse; uniform float uLo; uniform float uHi; varying vec2 vUv;
          void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;
            float l = max(max(c.r, c.g), c.b);
            float k = smoothstep(uLo, uHi, l);
            gl_FragColor = vec4(c * k, 1.0);
          }`,
        depthTest: false, depthWrite: false
      });
      const blur = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
        vertexShader: VS,
        fragmentShader: `
          uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
          void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
            c += (texture2D(tDiffuse, vUv + uDir * 1.3846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846).rgb) * 0.3162162;
            c += (texture2D(tDiffuse, vUv + uDir * 3.2308).rgb + texture2D(tDiffuse, vUv - uDir * 3.2308).rgb) * 0.0702703;
            gl_FragColor = vec4(c, 1.0);
          }`,
        depthTest: false, depthWrite: false
      });
      const copy = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null } }, vertexShader: VS,
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
        depthTest: false, depthWrite: false
      });
      const composite = new THREE.ShaderMaterial({
        uniforms: { tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null }, uBloom: { value: floatOk ? 0.55 : 0.75 }, uExposure: { value: 1.0 }, uVignette: { value: 0.32 } },
        vertexShader: VS,
        fragmentShader: `
          uniform sampler2D tScene; uniform sampler2D tB0; uniform sampler2D tB1; uniform sampler2D tB2;
          uniform float uBloom; uniform float uExposure; uniform float uVignette;
          varying vec2 vUv;
          const mat3 LINEAR_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
          const mat3 REC2020_TO_LINEAR_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
          vec3 agxContrast(vec3 x) { vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
          vec3 agx(vec3 color) {
            const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
            const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
            const float minEv = -12.47393; const float maxEv = 4.026069;
            color = LINEAR_SRGB_TO_REC2020 * color;
            color = inset * color;
            color = max(color, 1e-10);
            color = log2(color);
            color = (color - minEv) / (maxEv - minEv);
            color = clamp(color, 0.0, 1.0);
            color = agxContrast(color);
            color = outset * color;
            color = pow(max(vec3(0.0), color), vec3(2.2));
            color = REC2020_TO_LINEAR_SRGB * color;
            return clamp(color, 0.0, 1.0);
          }
          void main() {
            vec3 c = texture2D(tScene, vUv).rgb;
            vec3 b = texture2D(tB0, vUv).rgb * 0.5 + texture2D(tB1, vUv).rgb * 0.8 + texture2D(tB2, vUv).rgb * 1.0;
            c = (c + b * uBloom) * uExposure;
            vec2 q = vUv - 0.5;
            c *= 1.0 - uVignette * smoothstep(0.25, 0.9, dot(q, q) * 2.2);
            c = agx(c);
            // a little lift in the toe so the night never crushes to black
            c = c * 0.985 + 0.015;
            vec3 s = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
            gl_FragColor = vec4(s, 1.0);
          }`,
        depthTest: false, depthWrite: false
      });
      const size = new THREE.Vector2();
      function resize() {
        renderer.getDrawingBufferSize(size);
        const w = Math.max(2, Math.round(size.x)), h = Math.max(2, Math.round(size.y));
        sceneRT.setSize(w, h);
        levels.forEach((l, i) => {
          const d = Math.pow(2, i + 1);
          l.w = Math.max(2, Math.round(w / d)); l.h = Math.max(2, Math.round(h / d));
          l.a.setSize(l.w, l.h); l.b.setSize(l.w, l.h);
        });
      }
      function pass(mat, target) {
        quad.material = mat;
        renderer.setRenderTarget(target);
        renderer.render(quadScene, quadCam);
      }
      function render() {
        renderer.setRenderTarget(sceneRT);
        renderer.render(scene, camera);
        threshold.uniforms.tDiffuse.value = sceneRT.texture;
        pass(threshold, levels[0].a);
        for (let i = 0; i < levels.length; i++) {
          const L = levels[i];
          if (i > 0) { copy.uniforms.tDiffuse.value = levels[i - 1].a.texture; pass(copy, L.a); }
          blur.uniforms.tDiffuse.value = L.a.texture; blur.uniforms.uDir.value.set(1 / L.w, 0); pass(blur, L.b);
          blur.uniforms.tDiffuse.value = L.b.texture; blur.uniforms.uDir.value.set(0, 1 / L.h); pass(blur, L.a);
        }
        composite.uniforms.tScene.value = sceneRT.texture;
        composite.uniforms.tB0.value = levels[0].a.texture;
        composite.uniforms.tB1.value = levels[1].a.texture;
        composite.uniforms.tB2.value = levels[2].a.texture;
        pass(composite, null);
      }
      function dispose() { sceneRT.dispose(); for (const l of levels) { l.a.dispose(); l.b.dispose(); } quad.geometry.dispose(); for (const m of [threshold, blur, copy, composite]) m.dispose(); }
      resize();
      return { resize, render, dispose, composite };
    })();

    // ====================================================================== //
    // 10. Sound: a night bed, a tanpura-ish drone, and every effect           //
    // ====================================================================== //
    // No recordings: everything is made with oscillators and filtered noise
    // the first time the viewer touches the screen (which also unlocks audio).
    const audio = (() => {
      const A = { ac: null, master: null, music: null, sfx: null, noise: null, pad: null, level: 0, muted: false, nextPluck: 0, bell: null };
      const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
      function noiseBuffer(ac) {
        const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
        let b = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 1.5; }
        return buf;
      }
      function env(g, t, peak, attack, hold, release, floor_) {
        const f = floor_ || 0.0001;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(f, t);
        g.gain.linearRampToValueAtTime(peak, t + attack);
        g.gain.setValueAtTime(peak, t + attack + hold);
        g.gain.exponentialRampToValueAtTime(f, t + attack + hold + release);
      }
      function noiseVoice(dest, t, dur, type, f0, f1, q, peak, attack, release, pan) {
        const ac = A.ac;
        const src = ac.createBufferSource(); src.buffer = A.noise; src.loop = true;
        const filt = ac.createBiquadFilter(); filt.type = type; filt.Q.value = q;
        filt.frequency.setValueAtTime(f0, t); filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        const g = ac.createGain();
        env(g, t, peak, attack, Math.max(0, dur - attack - release), release);
        let out = g;
        if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); out = p; }
        src.connect(filt); filt.connect(g); out.connect(dest);
        src.start(t); src.stop(t + dur + 0.05);
      }
      function tone(dest, t, type, f0, f1, dur, peak, attack, release) {
        const ac = A.ac;
        const o = ac.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const g = ac.createGain();
        env(g, t, peak, attack, Math.max(0, dur - attack - release), release);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + dur + 0.05);
        return o;
      }
      function pluck(t, freq, vol, dest) {
        const ac = A.ac;
        const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
        const o2 = ac.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 2.01;
        const g = ac.createGain(); env(g, t, vol, 0.004, 0.02, 1.4);
        const g2 = ac.createGain(); env(g2, t, vol * 0.25, 0.004, 0.01, 0.5);
        o.connect(g); o2.connect(g2); g.connect(dest || A.delayIn); g2.connect(dest || A.delayIn);
        o.start(t); o.stop(t + 1.6); o2.start(t); o2.stop(t + 0.7);
      }
      A.unlock = async function () {
        if (!canAudio || A.ac) { if (A.ac && A.ac.state === "suspended") { try { await A.ac.resume(); } catch (_) {} } return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
          const ac = new AC();
          A.ac = ac;
          try { await ac.resume(); } catch (_) {}
          A.noise = noiseBuffer(ac);
          A.master = ac.createGain(); A.master.gain.value = A.muted ? 0 : 1; A.master.connect(ac.destination);
          A.music = ac.createGain(); A.music.gain.value = 0; A.music.connect(A.master);
          A.sfx = ac.createGain(); A.sfx.gain.value = 1; A.sfx.connect(A.master);
          // a feedback delay gives the plucks and the bell their shimmer
          A.delayIn = ac.createGain(); A.delayIn.connect(A.music);
          const dl = ac.createDelay(1.0); dl.delayTime.value = 0.375;
          const fb = ac.createGain(); fb.gain.value = 0.36;
          const dlf = ac.createBiquadFilter(); dlf.type = "lowpass"; dlf.frequency.value = 2400;
          A.delayIn.connect(dl); dl.connect(dlf); dlf.connect(fb); fb.connect(dl); dlf.connect(A.music);
          // the night: wind under a low-pass, crickets in a narrow band
          const wind = ac.createBufferSource(); wind.buffer = A.noise; wind.loop = true;
          const wf = ac.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 380;
          const wg = ac.createGain(); wg.gain.value = 0.0; wg.gain.linearRampToValueAtTime(0.03, ac.currentTime + 4);
          wind.connect(wf); wf.connect(wg); wg.connect(A.master); wind.start();
          const cr = ac.createBufferSource(); cr.buffer = A.noise; cr.loop = true;
          const cf = ac.createBiquadFilter(); cf.type = "bandpass"; cf.frequency.value = 4300; cf.Q.value = 14;
          const cg = ac.createGain(); cg.gain.value = 0;
          const am = ac.createOscillator(); am.frequency.value = 17; const amg = ac.createGain(); amg.gain.value = 0.006;
          const slow = ac.createOscillator(); slow.frequency.value = 0.9; const slowg = ac.createGain(); slowg.gain.value = 0.006;
          am.connect(amg); amg.connect(cg.gain); slow.connect(slowg); slowg.connect(cg.gain);
          cr.connect(cf); cf.connect(cg); cg.connect(A.master); cr.start(); am.start(); slow.start();
          A.ambience = { wg, cg };
          // the drone: three detuned saws under a slow-breathing low-pass, and a sub
          const padG = ac.createGain(); padG.gain.value = 0.0; padG.connect(A.music);
          const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.8; lp.connect(padG);
          const lfo = ac.createOscillator(); lfo.frequency.value = 0.07; const lfg = ac.createGain(); lfg.gain.value = 160; lfo.connect(lfg); lfg.connect(lp.frequency); lfo.start();
          for (const [f, det] of [[110, -6], [164.81, 5], [220, 3]]) { const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det; const g = ac.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(lp); o.start(); }
          const sub = ac.createOscillator(); sub.type = "sine"; sub.frequency.value = 55; const sg = ac.createGain(); sg.gain.value = 0.06; sub.connect(sg); sg.connect(padG); sub.start();
          A.pad = padG;
          A.setLevel(A.level);
        } catch (_) { A.ac = null; }
      };
      // how much music plays: 0 silence, 1 the full bed
      A.setLevel = function (level, fadeS) {
        A.level = level;
        if (!A.ac) return;
        const t = A.ac.currentTime, f = fadeS == null ? 1.5 : fadeS;
        A.music.gain.cancelScheduledValues(t); A.music.gain.setValueAtTime(A.music.gain.value, t); A.music.gain.linearRampToValueAtTime(0.7 * level, t + f);
        A.pad.gain.cancelScheduledValues(t); A.pad.gain.setValueAtTime(A.pad.gain.value, t); A.pad.gain.linearRampToValueAtTime(0.55 + 0.45 * level, t + f);
      };
      A.setMuted = function (m) { A.muted = m; if (A.master) { const t = A.ac.currentTime; A.master.gain.cancelScheduledValues(t); A.master.gain.setValueAtTime(A.master.gain.value, t); A.master.gain.linearRampToValueAtTime(m ? 0 : 1, t + 0.25); } };
      A.duck = function (amount, s) { if (!A.ac) return; const t = A.ac.currentTime; A.music.gain.cancelScheduledValues(t); A.music.gain.setValueAtTime(A.music.gain.value, t); A.music.gain.linearRampToValueAtTime(0.7 * A.level * (1 - amount), t + 0.08); A.music.gain.linearRampToValueAtTime(0.7 * A.level, t + 0.08 + s); };
      // plucks on a pentatonic, denser as the story warms up; called every frame
      const SCALE = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      A.tick = function (phase) {
        if (!A.ac || A.level <= 0) return;
        const t = A.ac.currentTime;
        if (t < A.nextPluck) return;
        const dens = phase === "approach" || phase === "lit" ? 0.35 : phase === "wish" ? 0.3 : 0.7;
        A.nextPluck = t + 0.5 + (Math.random() < dens ? 0 : 0.5) + Math.random() * 0.25;
        if (Math.random() < dens) pluck(t + 0.02, SCALE[Math.floor(Math.random() * SCALE.length)] * (Math.random() < 0.2 ? 0.5 : 1), 0.05 + 0.04 * Math.random());
      };
      A.tap = function () { if (!A.ac) return; tone(A.sfx, A.ac.currentTime, "sine", 720, 440, 0.07, 0.16, 0.004, 0.05); };
      A.matchStrike = function () {
        if (!A.ac) return; const t = A.ac.currentTime;
        for (let k = 0; k < 3; k++) noiseVoice(A.sfx, t + k * 0.045, 0.09, "bandpass", 2600 + k * 300, 1800, 1.5, 0.35 - k * 0.08, 0.004, 0.06);
      };
      A.flameCatch = function () {
        if (!A.ac) return; const t = A.ac.currentTime;
        noiseVoice(A.sfx, t, 0.45, "lowpass", 300, 2600, 0.7, 0.3, 0.06, 0.3);
        tone(A.sfx, t, "sine", 160, 90, 0.25, 0.12, 0.01, 0.2);
      };
      A.ignite = function (pan, rate) { if (!A.ac) return; noiseVoice(A.sfx, A.ac.currentTime, 0.05, "bandpass", 1500 * rate, 2600 * rate, 3, 0.1, 0.003, 0.04, pan); };
      A.sweep = function (delay, rate, vol) {
        if (!A.ac) return; const t = A.ac.currentTime + (delay || 0);
        noiseVoice(A.sfx, t, 2.6, "bandpass", 500 * rate, 3600 * rate, 1.2, 0.16 * vol, 0.4, 1.2);
      };
      A.lanternRelease = function () {
        if (!A.ac) return; const t = A.ac.currentTime;
        tone(A.sfx, t, "sine", 280, 920, 1.5, 0.14, 0.2, 0.9);
        tone(A.sfx, t + 0.1, "triangle", 560, 1840, 1.4, 0.05, 0.3, 0.8);
        noiseVoice(A.sfx, t, 1.2, "lowpass", 400, 1800, 0.7, 0.12, 0.3, 0.7);
      };
      A.whoosh = function () { if (!A.ac) return; noiseVoice(A.sfx, A.ac.currentTime, 0.5, "highpass", 500, 2400, 0.8, 0.05, 0.05, 0.4); };
      A.boom = function (kind, dist, delay) {
        if (!A.ac) return;
        const t = A.ac.currentTime + Math.max(0, delay || 0), k = clamp(1.3 - dist / 90, 0.35, 1);
        tone(A.sfx, t, "sine", 95, 30, 0.6, 0.6 * k, 0.005, 0.5);
        noiseVoice(A.sfx, t, 0.45, "lowpass", 1200, 300, 0.7, 0.4 * k, 0.004, 0.4);
        if (kind === "crackle" || kind === "crossette") for (let i = 0; i < 24; i++) noiseVoice(A.sfx, t + 0.9 + Math.random() * 1.1, 0.03, "bandpass", 2000 + Math.random() * 2500, 2000, 4, 0.08 * k, 0.002, 0.025, Math.random() * 2 - 1);
        if (kind === "willow") noiseVoice(A.sfx, t + 0.3, 2.2, "bandpass", 1800, 600, 1.0, 0.06 * k, 0.4, 1.5);
      };
      A.bell = function (delay) {
        if (!A.ac) return; const t = A.ac.currentTime + (delay || 0);
        for (const [m, d, v] of [[1, 3.2, 0.22], [2.0, 2.2, 0.1], [2.76, 1.6, 0.07], [5.4, 0.9, 0.04]]) tone(A.delayIn, t, "sine", 523.25 * m, 0, d, v, 0.005, d - 0.1);
      };
      A.wishSwell = function () {
        if (!A.ac) return; const t = A.ac.currentTime;
        [[0.0, 659.25], [0.35, 880], [0.7, 1046.5], [1.2, 1318.5]].forEach(([d, f]) => pluck(t + d, f, 0.09));
        [[1.9, 523.25], [2.25, 659.25], [2.6, 783.99]].forEach(([d, f]) => pluck(t + d, f, 0.07));
      };
      A.close = function () { if (A.ac) { try { A.ac.close(); } catch (_) {} A.ac = null; } };
      return A;
    })();
    const haptic = (kind) => { if (ctx.capabilities && ctx.capabilities.haptics) { try { ctx.platform.haptic(kind); } catch (_) {} } };

    // ====================================================================== //
    // 11. Interface: the hint, the sound switch, the ending                  //
    // ====================================================================== //
    const area = () => ctx.contentSafeArea || ctx.safeArea || { top: 0, right: 0, bottom: 0, left: 0 };
    const ICON_HAND = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11.5V5.5a1.5 1.5 0 0 1 3 0v5"/><path d="M12 10.5v-1a1.5 1.5 0 0 1 3 0v1.5"/><path d="M15 11v-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.7-2.3L4.5 16a1.6 1.6 0 0 1 2.4-2.1L9 15.5"/></svg>`;
    const ICON_REPLAY = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`;
    const ICON_SOUND = (on) => on
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`
      : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>`;
    const sa0 = area();
    ui.innerHTML = `<style>
      .dw * { box-sizing: border-box; }
      .dw .topshade { position: absolute; left: 0; right: 0; top: 0; height: calc(${sa0.top}px + 104px); background: linear-gradient(to bottom, rgba(6,5,8,0.62) 0%, rgba(6,5,8,0.32) 45%, transparent 100%); transition: opacity 1s; }
      .dw .brand { position: absolute; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.01em; color: rgba(243,238,230,0.86); text-shadow: 0 1px 8px rgba(0,0,0,0.7); pointer-events: none; }
      .dw .brand .dot { width: 22px; height: 22px; border-radius: 7px; background: linear-gradient(135deg, #ffd28a, #e8641b); display: grid; place-items: center; box-shadow: 0 0 14px rgba(255,170,70,0.5); }
      .dw .brand .dot span { width: 6px; height: 9px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; background: #fff3c0; box-shadow: 0 0 6px #fff; }
      .dw .mute { position: absolute; width: 38px; height: 38px; border-radius: 50%; border: 0; background: rgba(10,12,20,0.4); color: rgba(243,238,230,0.78); display: grid; place-items: center; pointer-events: auto; cursor: pointer; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
      .dw .hint { position: absolute; left: 0; top: 0; width: 0; height: 0; display: none; pointer-events: none; }
      .dw .hint.show { display: block; }
      .dw .hint .glow { position: absolute; width: 80px; height: 80px; left: -40px; top: -40px; border-radius: 50%; background: radial-gradient(circle, rgba(255,181,71,0.45), transparent 68%); animation: hint-glow 2.4s ease-in-out infinite; }
      .dw .hint .ring { position: absolute; width: 56px; height: 56px; left: -28px; top: -28px; border-radius: 50%; border: 1.5px solid #ffd59a; animation: hint-ring 2.4s cubic-bezier(0.2,0.6,0.3,1) infinite; }
      .dw .hint .ring.r2 { border-width: 1px; border-color: rgba(255,213,154,0.7); animation-delay: 1.2s; }
      .dw .hint .burst { position: absolute; width: 56px; height: 56px; left: -28px; top: -28px; border-radius: 50%; border: 2px solid #ffe2b0; opacity: 0; }
      .dw .hint.pressing .burst { animation: hint-burst 0.5s ease-out both; }
      .dw .hint .stack { position: absolute; left: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; transform: translateX(-50%); animation: hint-in 0.7s cubic-bezier(0.2,0.8,0.2,1) both; }
      .dw .hint .pill { position: relative; isolation: isolate; display: flex; align-items: center; gap: 8px; overflow: hidden; border-radius: 999px; background: #b9772f; padding: 8px 16px 8px 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.01em; white-space: nowrap; color: #2a1600; box-shadow: 0 0 28px -2px rgba(255,170,70,0.65), 0 10px 24px -10px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.5); transition: transform 0.2s; animation: hint-bob 2.4s ease-in-out infinite; }
      .dw .hint.pressing .pill { transform: scale(0.9); animation: none; }
      .dw .hint .fill { position: absolute; inset: 0; z-index: -1; transform-origin: left; background: linear-gradient(to bottom, #ffd28a, #ffad4d); transform: scaleX(0); }
      .dw .hint.armed .fill { animation: hint-fill 6s linear both; }
      .dw .hint.pressing .fill { animation: none; transform: none; }
      .dw .hint .ico { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: rgba(42,22,0,0.12); }
      .dw .hint .ico svg { animation: hint-tap 2.4s ease-in-out infinite; }
      .dw .hint .thread { width: 2px; border-radius: 2px; background: linear-gradient(to bottom, rgba(255,190,100,0.9), rgba(255,190,100,0)); height: 28px; }
      .dw .hint .gap { height: 28px; }
      .dw .veil { position: absolute; inset: 0; opacity: 0; background: linear-gradient(to top, rgba(6,5,8,0.75) 0%, rgba(6,5,8,0.3) 20%, transparent 36%); transition: opacity 1s; pointer-events: none; }
      .dw .end { position: absolute; left: 0; right: 0; display: none; flex-direction: column; align-items: center; gap: 12px; padding: 0 24px; }
      .dw .end.show { display: flex; animation: hint-in 0.7s cubic-bezier(0.2,0.8,0.2,1) both; }
      .dw .end .share { position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; max-width: 420px; border: 0; border-radius: 999px; background: linear-gradient(to bottom, #ffd28a, #ffad4d); padding: 14px 22px 14px 14px; font-family: inherit; font-size: 17px; font-weight: 600; color: #2a1600; box-shadow: 0 0 28px -2px rgba(255,170,70,0.65), 0 10px 24px -10px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.5); pointer-events: auto; cursor: pointer; animation: hint-bob 2.4s ease-in-out infinite; }
      .dw .end .share .ripple { position: absolute; inset: 0; border-radius: 999px; border: 2px solid #ffc27a; box-shadow: 0 0 12px rgba(255,170,70,0.5); animation: hint-ripple 2.4s ease-out infinite; pointer-events: none; }
      .dw .end .share .ripple.b { animation-delay: 1.2s; }
      .dw .end .share .ico { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: rgba(42,22,0,0.12); }
      .dw .end .again { border: 0; background: transparent; padding: 6px 12px; font-family: inherit; font-size: 15px; color: rgba(243,238,230,0.78); text-shadow: 0 1px 8px rgba(0,0,0,0.8); pointer-events: auto; cursor: pointer; display: flex; align-items: center; gap: 8px; }
      .dw .end .again:active, .dw .end .share:active { filter: brightness(1.08); }
      .dw .note { position: absolute; left: 0; right: 0; text-align: center; font-size: 13px; color: rgba(243,238,230,0.7); text-shadow: 0 1px 8px rgba(0,0,0,0.8); opacity: 0; transition: opacity 0.8s; pointer-events: none; }
      @keyframes hint-in { 0% { opacity: 0; transform: translateX(-50%) translateY(6px); } 100% { opacity: 1; transform: translateX(-50%) translateY(0); } }
      @keyframes hint-glow { 0%, 100% { opacity: 0.55; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.08); } }
      @keyframes hint-ring { 0% { opacity: 0; transform: scale(0.5); } 25% { opacity: 0.9; } 100% { opacity: 0; transform: scale(1.6); } }
      @keyframes hint-burst { 0% { opacity: 1; transform: scale(0.6); } 100% { opacity: 0; transform: scale(2.2); } }
      @keyframes hint-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      @keyframes hint-tap { 0%, 100% { transform: translateY(0) scale(1); } 40% { transform: translateY(2px) scale(0.92); } }
      @keyframes hint-fill { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }
      @keyframes hint-ripple { 0% { opacity: 0.8; transform: scale(1); } 100% { opacity: 0; transform: scale(1.18, 1.5); } }
      .dw .end.show { animation-name: end-in; }
      @keyframes end-in { 0% { opacity: 0; transform: translateY(8px); } 100% { opacity: 1; transform: none; } }
    </style>
    <div class="dw" style="position:absolute;inset:0;">
      <div class="topshade" data-el="topshade"></div>
      <div class="brand" data-el="brand"><span class="dot"><span></span></span><span>Happy Diwali</span></div>
      <button class="mute" data-act="mute" data-el="mute" aria-label="Turn sound off">${ICON_SOUND(true)}</button>
      <div class="hint" data-el="hint"><span class="glow"></span><span class="ring r1"></span><span class="ring r2"></span><span class="burst"></span>
        <span class="stack"><span class="pill"><span class="fill" data-el="fill"></span><span class="ico">${ICON_HAND}</span>Tap here</span><span class="thread" data-el="thread"></span><span class="gap"></span></span></div>
      <div class="veil" data-el="veil"></div>
      <div class="note" data-el="note">Tap the sky for more fireworks</div>
      <div class="end" data-el="end">
        <button class="share" data-act="again"><span class="ripple a"></span><span class="ripple b"></span><span class="ico">${ICON_REPLAY}</span>Watch again</button>
      </div>
    </div>`;
    const el = (name) => ui.querySelector(`[data-el="${name}"]`);
    const hintEl = el("hint"), fillEl = el("fill"), threadEl = el("thread"), endEl = el("end"), veilEl = el("veil"), noteEl = el("note"), muteEl = el("mute"), brandEl = el("brand"), topshadeEl = el("topshade");
    function layoutUi() {
      const a = area();
      brandEl.style.top = (a.top + 14) + "px";
      muteEl.style.top = (a.top + 8) + "px"; muteEl.style.right = (a.right + 14) + "px";
      endEl.style.bottom = (a.bottom + 18) + "px";
      noteEl.style.bottom = (a.bottom + 18 + 74) + "px";
      topshadeEl.style.height = (a.top + 104) + "px";
    }
    layoutUi();

    // The hint: shown at a point in the world, with a six second fill that
    // moves the story on by itself when nobody taps.
    const HINTS = {
      approach: { at: () => HERO.clone().add(new THREE.Vector3(0, 0.07, 0)), thread: 28, next: "lit" },
      spread: { at: () => new THREE.Vector3(0, 0.02, 0), thread: 28, next: "rangoli" },
      rangoli: { at: () => lantern.g.position.clone().add(new THREE.Vector3(0, 0.25, 0)), thread: 64, next: "lantern" }
    };
    const HINT_AT = { approach: 3.4, spread: Math.max(7, SPREAD_TOTAL + 2.2), rangoli: RANGOLI_SECONDS + 1 };
    const AUTO = { lit: ["spread", 3], lantern: ["fireworks", 7.5], fireworks: ["wish", 7] };
    const hint = { shown: false, armedAt: 0, pressing: false };
    const projected = new THREE.Vector3();
    function showHint() {
      const h = HINTS[story.phase];
      if (!h || hint.shown) return;
      hint.shown = true; hint.pressing = false;
      threadEl.style.height = h.thread + "px";
      hintEl.classList.remove("pressing");
      hintEl.classList.add("show");
      armHint();
    }
    function armHint() {
      hint.armedAt = now();
      hintEl.classList.remove("armed");
      void hintEl.offsetWidth;
      hintEl.classList.add("armed");
    }
    function hideHint() { hint.shown = false; hint.pressing = false; hintEl.classList.remove("show", "armed", "pressing"); }
    function placeHint() {
      const h = HINTS[story.phase];
      if (!h || !hint.shown) return;
      projected.copy(h.at()).project(camera);
      if (projected.z > 1) { hintEl.style.opacity = "0"; return; }
      const a = area();
      const x = clamp((projected.x * 0.5 + 0.5) * ctx.width, a.left + 70, ctx.width - a.right - 70);
      const y = clamp((-projected.y * 0.5 + 0.5) * ctx.height, a.top + 120, ctx.height - a.bottom - 40);
      hintEl.style.opacity = "1";
      hintEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }

    // ====================================================================== //
    // 12. The story: phases, their cues and their timers                     //
    // ====================================================================== //
    const timers = [];
    const schedule = (phase, s, fn) => timers.push({ phase, run: story.run, at: now() + s, fn });
    function clearTimers() { timers.length = 0; }
    let completed = false;
    function advance(next) {
      if (!next) return;
      hideHint();
      setPhase(next);
    }
    function onPhase(p) {
      clearTimers();
      hideHint();
      if (HINT_AT[p] != null) schedule(p, HINT_AT[p], showHint);
      if (AUTO[p]) schedule(p, AUTO[p][1], () => advance(AUTO[p][0]));
      switch (p) {
        case "approach": audio.setLevel(0.35, 2); break;
        case "lit": audio.duck(0.5, 0.9); audio.matchStrike(); schedule(p, 0.85, () => { audio.flameCatch(); flash(0.08); haptic("medium"); }); break;
        case "spread": audio.setLevel(0.7, 2); break;
        case "rangoli": audio.setLevel(0.85, 1.5); audio.sweep(0, 1, 1); audio.sweep(3.4, 1.06, 0.7); break;
        case "lantern": audio.duck(0.4, 1.2); audio.lanternRelease(); haptic("light"); schedule(p, 0.3, () => haptic("light")); schedule(p, FW_LEAD, () => audio.setLevel(1, 1.5)); break;
        case "fireworks": break;
        case "wish": audio.setLevel(0.55, 3); schedule(p, 0.6, () => audio.bell()); schedule(p, wishBurstAt(0) + 0.2, () => audio.wishSwell()); break;
        default: break;
      }
      const wishing = p === "wish";
      veilEl.style.opacity = wishing ? "1" : "0";
      brandEl.style.opacity = wishing && ctx.width / Math.max(1, ctx.height) >= 1.2 ? "0" : "1";
      if (!wishing) { endEl.classList.remove("show"); noteEl.style.opacity = "0"; }
      else {
        schedule(p, wishBurstAt(1) + 2.4, () => {
          endEl.classList.add("show");
          noteEl.style.opacity = "1";
          if (!completed) { completed = true; try { ctx.platform.complete({ sender: SENDER }); } catch (_) {} }
          try { ctx.platform.setProgress(1); } catch (_) {}
        });
      }
    }
    phaseListeners.push(onPhase);
    function runTimers() {
      for (let i = timers.length - 1; i >= 0; i--) {
        const t = timers[i];
        if (t.phase !== story.phase || t.run !== story.run) { timers.splice(i, 1); continue; }
        if (now() >= t.at) { timers.splice(i, 1); t.fn(); }
      }
      if (hint.shown && !hint.pressing && now() - hint.armedAt > 6) {
        hint.pressing = true;
        hintEl.classList.add("pressing");
        schedule(story.phase, 0.38, () => advance(HINTS[story.phase] && HINTS[story.phase].next));
      }
    }
    function replay() {
      story.run++;
      clearTimers();
      story.at = {};
      lamps.ignited.clear();
      fireworks.fired.clear(); fireworks.flashes.length = 0; fireworks.booms.length = 0;
      const tm = fireworks.geo.getAttribute("aTime");
      for (let i = 0; i < tm.count; i++) tm.setX(i, -1e6);
      tm.needsUpdate = true;
      wish.fired.clear();
      endEl.classList.remove("show");
      story.phase = "loading";
      try { ctx.platform.start({ replay: true }); } catch (_) {}
      setPhase("approach");
    }

    // ====================================================================== //
    // 13. Camera: eased moves between the shots, a slow drift once there     //
    // ====================================================================== //
    // camState is the tweened shot; drift is the slow push a shot makes once
    // it has arrived. A new tween starts from where the camera actually is
    // (shot plus drift), so a phase change never snaps it back. The result
    // then goes through a short spring, as in the original, so even a
    // tween that begins mid-move stays smooth.
    const camState = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 30 };
    const camTween = { from: null, to: null, t0: 0, dur: 0, ease: "sine.inOut", axes: null, shot: null, drift: [0, 0, 0] };
    const camSmooth = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 30, set: false };
    const EASE = { "power2.out": (t) => 1 - (1 - t) * (1 - t), "sine.inOut": (t) => -(Math.cos(Math.PI * t) - 1) / 2 };
    function setCamShot(name, immediate) {
      const s = SHOTS[name];
      const to = { px: s.pos[0], py: s.pos[1], pz: s.pos[2], lx: s.look[0], ly: s.look[1], lz: s.look[2], fov: shotFov(s.fov) };
      const d = camTween.drift;
      if (immediate || !s.dur) { Object.assign(camState, to); camTween.to = null; camTween.shot = s; camTween.t0 = now(); camTween.drift = [0, 0, 0]; camSmooth.set = false; return; }
      camTween.from = Object.assign({}, camState, { px: camState.px + d[0], py: camState.py + d[1], pz: camState.pz + d[2] });
      camTween.to = to; camTween.t0 = now(); camTween.dur = s.dur; camTween.ease = s.ease || "sine.inOut"; camTween.axes = s.axes || null; camTween.shot = s;
      camTween.drift = [0, 0, 0];
    }
    phaseListeners.push((p) => { if (SHOTS[p]) setCamShot(p); });
    const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
    function updateCamera(dt) {
      const T = camTween;
      if (T.to) {
        const u = clamp((now() - T.t0) / T.dur, 0, 1);
        const ease = EASE[T.ease] || EASE["sine.inOut"];
        const along = (span) => { if (!span) return ease(u); return ease(clamp((u - span[0]) / Math.max(0.001, span[1]), 0, 1)); };
        const ax = T.axes || {};
        camState.px = lerp(T.from.px, T.to.px, along(ax.x));
        camState.py = lerp(T.from.py, T.to.py, along(ax.y));
        camState.pz = lerp(T.from.pz, T.to.pz, along(ax.z));
        const e = ease(u);
        camState.lx = lerp(T.from.lx, T.to.lx, e); camState.ly = lerp(T.from.ly, T.to.ly, e); camState.lz = lerp(T.from.lz, T.to.lz, e);
        camState.fov = lerp(T.from.fov, T.to.fov, e);
        if (u >= 1) T.to = null;
      }
      const s = T.shot, t = now() - T.t0;
      // the lantern shot looks up to follow the lantern as it climbs; the
      // blended look is written back so the next shot starts from it
      if (s && s.track) {
        const a = since("lantern");
        if (a >= 0) {
          const w = smooth(a, 1.0, 3.5), lp = lantern.g.position;
          camState.lx = lerp(camState.lx, lp.x, w); camState.ly = lerp(camState.ly, Math.min(0.3 + 0.78 * lp.y, 8), w); camState.lz = lerp(camState.lz, lp.z, w);
        }
      }
      const d = s && s.drift ? s.drift : [0, 0, 0];
      const k = smooth(t, s && s.dur ? s.dur * 0.6 : 0, (s && s.dur ? s.dur : 1) * 2.4 + 4);
      const f = s && s.follow ? s.follow(Math.max(0, since("lantern"))) : [0, 0, 0];
      T.drift = [d[0] * k + f[0], d[1] * k + f[1], d[2] * k + f[2]];
      const target = { px: camState.px + T.drift[0], py: camState.py + T.drift[1], pz: camState.pz + T.drift[2], lx: camState.lx, ly: camState.ly, lz: camState.lz, fov: camState.fov };
      if (!camSmooth.set) { Object.assign(camSmooth, target); camSmooth.set = true; }
      else {
        const a = 1 - Math.exp(-(dt || 0.016) / 0.18), b = 1 - Math.exp(-(dt || 0.016) / 0.24);
        camSmooth.px += (target.px - camSmooth.px) * a; camSmooth.py += (target.py - camSmooth.py) * a; camSmooth.pz += (target.pz - camSmooth.pz) * a;
        camSmooth.lx += (target.lx - camSmooth.lx) * b; camSmooth.ly += (target.ly - camSmooth.ly) * b; camSmooth.lz += (target.lz - camSmooth.lz) * b;
        camSmooth.fov += (target.fov - camSmooth.fov) * b;
      }
      const sway = 0.012;
      camPos.set(camSmooth.px + Math.sin(t * 0.7) * sway, camSmooth.py + Math.sin(t * 0.9 + 1) * sway * 0.6, camSmooth.pz);
      camLook.set(camSmooth.lx + Math.sin(t * 0.5) * sway * 0.5, camSmooth.ly + Math.cos(t * 0.6) * sway * 0.5, camSmooth.lz);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      camera.fov = camSmooth.fov;
      camera.updateProjectionMatrix();
    }
    setCamShot("loading", true);

    // ====================================================================== //
    // 14. Input                                                              //
    // ====================================================================== //
    let unlocked = false;
    const firstGesture = () => { if (unlocked) return; unlocked = true; audio.unlock(); };
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    // Taps through ctx.input where the host has it; a plain pointer pair otherwise.
    const onTap = (target, handler) => {
      if (ctx.input && typeof ctx.input.on === "function") { ctx.input.on(target, "tap", handler); return; }
      let down = null;
      ctx.listen(target, "pointerdown", (e) => { down = { x: e.offsetX, y: e.offsetY, t: performance.now() }; });
      ctx.listen(target, "pointerup", (e) => { if (down && performance.now() - down.t < 400 && Math.hypot(e.offsetX - down.x, e.offsetY - down.y) < 12) handler({ x: e.offsetX, y: e.offsetY }); down = null; });
    };
    const onActivate = (target, handler) => {
      if (ctx.input && typeof ctx.input.activate === "function") { ctx.input.activate(target, handler); return; }
      ctx.listen(target, "click", handler);
    };
    ctx.listen(canvas, "pointerdown", () => { firstGesture(); if (hint.shown && !hint.pressing) armHint(); });
    onTap(canvas, (p) => {
      firstGesture();
      try { ctx.platform.interact({ phase: story.phase }); } catch (_) {}
      if (story.phase === "loading") return;
      if (hint.shown && !hint.pressing) {
        audio.tap(); haptic("light");
        hint.pressing = true; hintEl.classList.add("pressing");
        if (!story.started) { story.started = true; try { ctx.platform.start(); } catch (_) {} }
        schedule(story.phase, 0.12, () => advance(HINTS[story.phase] && HINTS[story.phase].next));
        return;
      }
      if (story.phase === "wish") {
        ndc.set((p.x / ctx.width) * 2 - 1, -(p.y / ctx.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        if (raycaster.ray.direction.y > 0.1) { launchToward(raycaster.ray.direction.clone(), camera.position.clone()); audio.whoosh(); haptic("light"); }
      }
    });
    onActivate(muteEl, () => {
      firstGesture();
      story.muted = !story.muted;
      audio.setMuted(story.muted);
      muteEl.innerHTML = ICON_SOUND(!story.muted);
      muteEl.setAttribute("aria-label", story.muted ? "Turn sound on" : "Turn sound off");
    });
    onActivate(ui.querySelector('[data-act="again"]'), () => { firstGesture(); audio.tap(); haptic("light"); replay(); });

    // ====================================================================== //
    // 15. Frames                                                             //
    // ====================================================================== //
    let frameCost = 0, slowFrames = 0, degraded = false;
    const onResize = (fn, opts) => {
      if (typeof ctx.onResize === "function") return ctx.onResize(fn, opts);
      ctx.listen(window, "resize", fn);
      if (opts && opts.immediate) fn();
    };
    onResize(() => {
      renderer.setSize(ctx.width, ctx.height, false);
      camera.aspect = ctx.width / Math.max(1, ctx.height);
      post.resize();
      layoutUi();
      if (camTween.shot && !camTween.to) camState.fov = shotFov(camTween.shot.fov);
      if (camTween.to && camTween.shot) camTween.to.fov = shotFov(camTween.shot.fov);
      world.userData.stars.uniforms.uPx.value = ctx.height * DPR;
      if (wish.built && since("wish") < 0) wish.built = false;
    }, { immediate: true });
    const onIgnite = (d) => { if (story.muted) return; audio.ignite(d.pos.x / 7, 0.94 + 0.12 * Math.random()); };
    const onBoom = (b) => { audio.boom(b.kind, b.dist, 0); if (b.kind !== "willow") haptic("light"); };
    const onLineBurst = (i, inS) => { audio.whoosh(); schedule("wish", inS, () => { audio.boom("peony", 30, 0); flash(i ? 0.07 : 0.1); haptic("medium"); }); };
    let firstFrame = true;
    ctx.onFrame((dtMs) => {
      const dt = Math.min(0.05, (dtMs || 16) / 1000);
      lightUniforms.uTime.value += dt;
      runTimers();
      updateCamera(dt);
      updateLamps(onIgnite);
      updateRangoli();
      updateLantern(dt);
      updateFireworks(onBoom);
      updateWish(onLineBurst);
      // bulbs come on as the lamps spread
      const sp = since("spread");
      const bulbOn = sp < 0 ? 0 : smooth(sp, 1.6, 4.6);
      for (const b of bulbs.meshes) b.mat.uniforms.uIntensity.value = b.peak * bulbOn;
      flashLevel = Math.max(0, flashLevel - dt * 0.35);
      flashUniform.value.setRGB(flashLevel, flashLevel * 0.8, flashLevel * 0.5);
      placeHint();
      audio.tick(story.phase);
      const t0 = performance.now();
      post.render();
      const cost = performance.now() - t0;
      frameCost = frameCost * 0.9 + cost * 0.1;
      // a phone that cannot keep up gets a lighter render
      if (!degraded && frameCost > 34 && DPR > 1) { if (++slowFrames > 90) { degraded = true; story.lowPower = true; renderer.setPixelRatio(1); renderer.setSize(ctx.width, ctx.height, false); post.resize(); } } else slowFrames = Math.max(0, slowFrames - 1);
      if (firstFrame) { firstFrame = false; try { ctx.markVisualReady("first-frame"); } catch (_) {} }
    });
    ctx.onDestroy(() => {
      audio.close();
      post.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.dispose(); } });
      renderer.dispose();
    });

    // The first frame, then the story begins.
    updateCamera(0.016);
    updateLamps(() => {});
    updateLantern(0.016);
    post.render();
    ctx.platform.ready();
    setPhase("approach");
  }
};
