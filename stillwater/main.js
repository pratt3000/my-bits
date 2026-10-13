/*
 * Still Water — one night in a drowned cypress swamp, and the thing that
 * lives in it.
 *
 * It cannot see you. It hears the water.
 *
 * Most of the swamp is black water: channels deep enough to swim, flats
 * you can wade, and islands of mud and palmetto between. On land you make
 * no sound it can follow. Every step you wade carries; every stroke you
 * swim carries further. Search the old places -- the Fishing Camp, the
 * Stilt Village, the Drowned Chapel, the Watchtower, the Sunken Barge, the
 * Pumphouse, the Boathouse, the Hermit's Shack -- for spring coils and the
 * parts of a bazooka. Build them at the workbench. Then call it up with a
 * rubber duck, the chapel bell or the pumphouse generator, and shoot it
 * while its head is out of the water. It only has to find you once.
 *
 * Packaged assets are disabled, so everything here is generated: the
 * ground, the water and its mirror, the cypress, moss and reeds, every
 * building, the creature, the light and every sound. Three.js comes from
 * the Plethora library registry.
 */

window.plethoraBit = {
  meta: {
    title: "Still Water",
    runtime: "plethora-bit@2",
    tags: ["horror", "3d", "stealth", "survival", "swamp", "first-person", "atmospheric", "leaderboard", "creature", "exploration"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    /* ================================================================ *
     * CREATOR TUNING
     * ================================================================ */
    const tune = ctx.tune || {};
    const tNum = (id, fb) => (tune.number ? tune.number(id) : undefined) ?? fb;
    const tInt = (id, fb) => (tune.integer ? tune.integer(id) : undefined) ?? fb;
    const tBool = (id, fb) => (tune.boolean ? tune.boolean(id) : undefined) ?? fb;

    const HUNT_SPEED = tNum("creature_speed", 4.6);
    const HEARING = tNum("hearing_range", 22);
    const CREATURE_HP = tInt("creature_hp", 3);
    const DUCKS_START = tInt("ducks", 2);
    const STORMS = tBool("storms", true);
    const SOUND_DEFAULT = tBool("sound_default", true);
    const HAPTICS_DEFAULT = tBool("haptics_default", true);
    const TEST = ctx.__test || null;

    /* ================================================================ *
     * SMALL THINGS
     * ================================================================ */
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    // Value noise on a 256-lattice, optionally periodic, for terrain and textures.
    function latticeNoise(seed) {
      const rng = mulberry32(seed), N = 256, tbl = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) tbl[i] = rng();
      return (x, y, period) => {
        const p = period || N;
        const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
        const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
        const a = tbl[y0 * N + x0], b = tbl[y0 * N + x1], c = tbl[y1 * N + x0], d = tbl[y1 * N + x1];
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
      };
    }
    function fbmOf(noise, x, y, oct, period) {
      let amp = 0.5, f = 1, s = 0, t = 0;
      for (let k = 0; k < oct; k++) { s += amp * noise(x * f, y * f, period ? period * f : 0); t += amp; amp *= 0.5; f *= 2; }
      return s / t;
    }

    /* ================================================================ *
     * THREE
     * ================================================================ */
    const THREE = await ctx.importModule("three", "0.164.1");
    const col = c => new THREE.Color(c);
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

    const canvas = ctx.createCanvas({ touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false, stencil: false });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;

    /* ================================================================ *
     * TEXTURES, MADE HERE
     * Nothing is loaded: noise, the water's ripple normals, the cypress
     * fronds and the hanging moss are all drawn into pixel arrays.
     * ================================================================ */
    function dataTex(data, w, h, opts) {
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
      t.wrapS = t.wrapT = opts && opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      if (opts && opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
      return t;
    }
    // R, G: two tiling fbm fields; B: fine grain; A: very broad.
    const noiseTex = (() => {
      const S = 256, d = new Uint8Array(S * S * 4);
      const n1 = latticeNoise(11), n2 = latticeNoise(23), n3 = latticeNoise(37), n4 = latticeNoise(41);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        d[i] = fbmOf(n1, x / 32, y / 32, 4, 8) * 255;
        d[i + 1] = fbmOf(n2, x / 16, y / 16, 4, 16) * 255;
        d[i + 2] = fbmOf(n3, x / 4, y / 4, 3, 64) * 255;
        d[i + 3] = fbmOf(n4, x / 64, y / 64, 3, 4) * 255;
      }
      return dataTex(d, S, S);
    })();
    // Ripple normals: the gradient of a tiling height field.
    const waterNormTex = (() => {
      const S = 256, d = new Uint8Array(S * S * 4), h = new Float32Array(S * S);
      const n1 = latticeNoise(53), n2 = latticeNoise(59);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        h[y * S + x] = fbmOf(n1, x / 16, y / 16, 4, 16) * 0.7 + fbmOf(n2, x / 8, y / 8, 3, 32) * 0.3;
      }
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
        const hy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
        let nx = -hx * 6, ny = -hy * 6, nz = 1;
        const L = Math.hypot(nx, ny, nz);
        const i = (y * S + x) * 4;
        d[i] = (nx / L * 0.5 + 0.5) * 255; d[i + 1] = (ny / L * 0.5 + 0.5) * 255; d[i + 2] = (nz / L * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
      return dataTex(d, S, S);
    })();
    // Cypress foliage: soft feathery sprays radiating from a centre, the
    // way a bald cypress holds its needles in flat fans.
    const frondTex = (() => {
      const S = 128, a = new Float32Array(S * S), g = new Float32Array(S * S), d = new Uint8Array(S * S * 4);
      const rng = mulberry32(77);
      const stamp = (cx, cy, ang, len, wid, tone) => {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const r = Math.ceil(len + wid + 1);
        for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(S, cy + r); y++) for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(S, cx + r); x++) {
          const px = x - cx, py = y - cy;
          const u = px * ca + py * sa, v = -px * sa + py * ca;
          if (u < 0 || u > len) continue;
          const w = wid * (1 - u / len * 0.5);
          const k = 1 - smooth(w * 0.35, w, Math.abs(v));
          if (k <= 0) continue;
          const i = y * S + x;
          if (k > a[i]) { a[i] = k; g[i] = tone; }
        }
      };
      const fronds = 24;
      for (let f = 0; f < fronds; f++) {
        let ang = (f / fronds) * Math.PI * 2 + (rng() - 0.5) * 0.35;
        let x = S / 2 + Math.cos(ang) * 4, y = S / 2 + Math.sin(ang) * 4;
        const len = 18 + rng() * 9, bend = (rng() - 0.5) * 0.06;
        const tone = rng() * 0.35;
        for (let k = 0; k < len; k++) {
          x += Math.cos(ang) * 1.8; y += Math.sin(ang) * 1.8;
          ang += bend;
          if (x < 3 || y < 3 || x > S - 3 || y > S - 3) break;
          const t = k / len;
          stamp(x, y, ang, 2.4, 1.0, tone);
          // Fine needles either side, shorter toward the tip.
          const nl = 6.5 * (1 - t * 0.55) + rng() * 1.5;
          stamp(x, y, ang + 1.2, nl, 0.85, tone + 0.15 + t * 0.2);
          stamp(x, y, ang - 1.2, nl, 0.85, tone + 0.15 + t * 0.2);
        }
      }
      for (let i = 0; i < S * S; i++) {
        const t = g[i];
        d[i * 4] = (0.13 + t * 0.12) * 255; d[i * 4 + 1] = (0.2 + t * 0.17) * 255; d[i * 4 + 2] = (0.09 + t * 0.05) * 255;
        d[i * 4 + 3] = clamp(a[i] * 1.5, 0, 1) * 255;
      }
      return dataTex(d, S, S, { clamp: true, srgb: true });
    })();
    // Spanish moss: wispy grey-green strands, thinning toward the tips.
    const mossTex = (() => {
      const W = 64, H = 256, a = new Float32Array(W * H), d = new Uint8Array(W * H * 4);
      const rng = mulberry32(91), n = latticeNoise(97);
      for (let s = 0; s < 34; s++) {
        let x = 4 + rng() * (W - 8);
        const len = H * (0.35 + rng() * 0.65);
        for (let y = 0; y < len; y++) {
          x += (n(s * 7.1, y * 0.05) - 0.5) * 0.9;
          const t = y / len, w = 1.6 * (1 - t) + 0.4;
          for (let xx = Math.floor(x - 3); xx <= Math.ceil(x + 3); xx++) {
            if (xx < 0 || xx >= W) continue;
            const k = (1 - smooth(w * 0.3, w, Math.abs(xx - x))) * (1 - t * 0.5);
            const i = y * W + xx;
            a[i] = Math.max(a[i], k);
          }
          // Little side hairs.
          if (rng() < 0.12) {
            const dir = rng() < 0.5 ? -1 : 1;
            for (let k = 0; k < 6; k++) {
              const xx = Math.round(x + dir * k * 0.8), yy = y + k;
              if (xx >= 0 && xx < W && yy < H) a[yy * W + xx] = Math.max(a[yy * W + xx], 0.6 * (1 - k / 6));
            }
          }
        }
      }
      for (let i = 0; i < W * H; i++) {
        d[i * 4] = 0.55 * 255; d[i * 4 + 1] = 0.58 * 255; d[i * 4 + 2] = 0.47 * 255; d[i * 4 + 3] = clamp(a[i] * 1.5, 0, 1) * 255;
      }
      return dataTex(d, W, H, { clamp: true, srgb: true });
    })();

    // Saw palmetto: a pleated fan of narrow leaflets with ragged tips.
    const fanTex = (() => {
      const S = 128, a = new Float32Array(S * S), g = new Float32Array(S * S), d = new Uint8Array(S * S * 4);
      const rng = mulberry32(131);
      const leaves = 22;
      for (let l = 0; l < leaves; l++) {
        const ang = Math.PI * (0.08 + 0.84 * (l / (leaves - 1))) + (rng() - 0.5) * 0.05;
        const len = 52 + rng() * 10, tone = rng();
        for (let u = 6; u < len; u += 0.5) {
          const x = S / 2 + Math.cos(ang) * u, y = S - 4 - Math.sin(ang) * u;
          const w = 2.6 * Math.sin(Math.min(1, u / len) * Math.PI) + 0.4;
          for (let yy = Math.floor(y - w - 1); yy <= y + w + 1; yy++) for (let xx = Math.floor(x - w - 1); xx <= x + w + 1; xx++) {
            if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
            const dd = Math.hypot(xx - x, yy - y);
            const k = 1 - smooth(w * 0.5, w, dd);
            const i = yy * S + xx;
            if (k > a[i]) { a[i] = k; g[i] = tone * 0.6 + (u / len) * 0.4 + (dd < w * 0.3 ? 0.15 : 0); }
          }
        }
      }
      for (let i = 0; i < S * S; i++) {
        const t = g[i];
        d[i * 4] = (0.1 + t * 0.1) * 255; d[i * 4 + 1] = (0.17 + t * 0.12) * 255; d[i * 4 + 2] = (0.07 + t * 0.04) * 255;
        d[i * 4 + 3] = clamp(a[i] * 1.5, 0, 1) * 255;
      }
      return dataTex(d, S, S, { clamp: true, srgb: true });
    })();

    /* ================================================================ *
     * THE LIGHT
     * Night in the swamp: a low moon behind the trees, mist on the
     * water, and every warm thing a lantern.
     * ================================================================ */
    const LOOK = {
      moonDir: V3(-0.42, 0.26, -0.87).normalize(),
      moonColor: col("#c3d4ff"), moonI: 3.0,
      hemiSky: col("#4a6d8e"), hemiGround: col("#1f2118"), hemiI: 1.35,
      fogA: col("#162832"), fogB: col("#56707f"), fogDensity: 0.019,
      skyZenith: col("#02060f"), skyHorizon: col("#1d3240"), skyMoon: col("#8ca6c9"),
      waterDeep: col("#020708"), waterMurk: col("#0d1a12"), waterScum: col("#2d3d1c"),
      lantern: col("#ffb35a"),
      exposure: 1.3
    };

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(70, 1, 0.08, 420);
    camera.rotation.order = "YXZ";
    scene.add(camera);

    const moon = new THREE.DirectionalLight(LOOK.moonColor, LOOK.moonI);
    moon.position.copy(LOOK.moonDir).multiplyScalar(80);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -38; moon.shadow.camera.right = 38; moon.shadow.camera.top = 38; moon.shadow.camera.bottom = -38;
    moon.shadow.camera.near = 1; moon.shadow.camera.far = 200;
    moon.shadow.bias = -0.0015; moon.shadow.normalBias = 0.04;
    scene.add(moon, moon.target);
    const hemi = new THREE.HemisphereLight(LOOK.hemiSky, LOOK.hemiGround, LOOK.hemiI);
    scene.add(hemi);
    // A small pool of warm lights, moved to the lanterns nearest the camera.
    const LAMP_POOL = 3;
    const lampLights = [];
    for (let i = 0; i < LAMP_POOL; i++) {
      const l = new THREE.PointLight(LOOK.lantern, 0, 20, 1.6);
      scene.add(l);
      lampLights.push(l);
    }

    /* ================================================================ *
     * SHARED SHADER PIECES
     * Every lit material is a stock Three.js one with a few lines spliced
     * in: world position, wind, and the swamp's own mist in place of fog.
     * ================================================================ */
    const SHARED = {
      uTime: { value: 0 },
      uNoise: { value: noiseTex },
      uFogA: { value: LOOK.fogA.clone() },
      uFogB: { value: LOOK.fogB.clone() },
      uMoonDir: { value: LOOK.moonDir.clone() },
      uFogDensity: { value: LOOK.fogDensity },
      uWind: { value: 1 }
    };
    const GLSL_FOG = /* glsl */`
      uniform float uTime;
      uniform sampler2D uNoise;
      uniform vec3 uFogA, uFogB, uMoonDir;
      uniform float uFogDensity;
      vec3 swampFog(vec3 c, vec3 P) {
        vec3 V = P - cameraPosition;
        float d = length(V);
        vec3 dir = V / max(d, 1e-4);
        float f = 1.0 - exp(-d * uFogDensity);
        // Mist lying on the water: thick below a metre or two, in drifting banks.
        float bank = texture2D(uNoise, P.xz * 0.011 + vec2(uTime * 0.0035, uTime * 0.0021)).r;
        float low = exp(-max(P.y + 0.2, 0.0) * 0.75);
        float m = (1.0 - exp(-max(d - 4.0, 0.0) * 0.05)) * low * smoothstep(0.32, 0.72, bank);
        f = clamp(f + m * 0.9 * (1.0 - f), 0.0, 1.0);
        // The moon lights the haze it shines through.
        float toward = pow(max(dot(dir, uMoonDir), 0.0), 5.0);
        vec3 fc = mix(uFogA, uFogB, toward);
        return mix(c, fc, f);
      }
    `;
    const WORLD_POS_VS = /* glsl */`
      vec4 swW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        swW = instanceMatrix * swW;
      #endif
      vSWorld = (modelMatrix * swW).xyz;
    `;
    // Wind: things sway by height above their own base.
    const WIND_VS = /* glsl */`
      {
        vec4 wb = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          wb = instanceMatrix * wb;
        #endif
        float ph = dot(wb.xz, vec2(0.13, 0.17));
        float h = max(position.y, 0.0) * uSway;
        float g = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.25 + sin(uTime * 6.3 + position.x * 3.0) * 0.06;
        transformed.x += h * h * g * 0.035 * uWind;
        transformed.z += h * h * cos(uTime * 1.1 + ph) * 0.02 * uWind;
      }
    `;
    // A lamp is a flame in a glass, not a point: nothing right beside it
    // burns out to white.
    const LIGHTS_SOFT = THREE.ShaderChunk.lights_pars_begin.replace("max( pow( lightDistance, decayExponent ), 0.01 )", "max( pow( lightDistance, decayExponent ), 0.36 )");
    // Splice the swamp into a stock material.
    function swampify(mat, o) {
      o = o || {};
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, SHARED, o.uniforms || {});
        if (o.sway !== undefined) sh.uniforms.uSway = { value: o.sway };
        let vs = sh.vertexShader, fs = sh.fragmentShader;
        vs = "varying vec3 vSWorld;\nuniform float uTime;\nuniform float uWind;\n" + (o.sway !== undefined ? "uniform float uSway;\n" : "") + (o.vHead || "") + vs;
        if (o.sway !== undefined) vs = vs.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + WIND_VS);
        if (o.vBegin) vs = vs.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + o.vBegin);
        vs = vs.replace("#include <project_vertex>", "#include <project_vertex>\n" + WORLD_POS_VS);
        fs = "varying vec3 vSWorld;\n" + GLSL_FOG + (o.fHead || "") + fs.replace("#include <lights_pars_begin>", LIGHTS_SOFT);
        if (o.fMap) fs = fs.replace("#include <map_fragment>", o.fMap);
        if (o.fRough) fs = fs.replace("#include <roughnessmap_fragment>", o.fRough);
        if (o.fNormal) fs = fs.replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + o.fNormal);
        if (o.fEmit) fs = fs.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + o.fEmit);
        fs = fs.replace("#include <fog_fragment>", "gl_FragColor.rgb = swampFog(gl_FragColor.rgb, vSWorld);");
        sh.vertexShader = vs;
        sh.fragmentShader = fs;
        if (o.onShader) o.onShader(sh);
      };
      mat.customProgramCacheKey = () => "sw-" + (o.key || "base");
      return mat;
    }

    /* ================================================================ *
     * THE SWAMP
     * A 256 m square of mud and black water: deep channels, waist-deep
     * flats, islands of roots and grass, and a ring of dead forest
     * round the edge that nothing gets through.
     * ================================================================ */
    const SIZE = 256, RES = 1, NV = SIZE / RES + 1;
    const WATER_Y = 0;
    const H_MIN = -3, H_MAX = 6;
    function makeSwamp(seed) {
      const nA = latticeNoise(seed), nB = latticeNoise(seed + 1), nC = latticeNoise(seed + 2);
      const h = new Float32Array(NV * NV);
      for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
        const x = i * RES, z = j * RES;
        // Broad shapes: most of it is water.
        const base = fbmOf(nA, x / 70 + 3.1, z / 70 + 1.7, 5) * 2 - 1;
        const flats = fbmOf(nB, x / 28, z / 28, 4) * 2 - 1;
        const fine = fbmOf(nC, x / 6, z / 6, 3) * 2 - 1;
        let y = base * 2.2 + flats * 0.55 + fine * 0.12 - 0.55;
        // Shape the profile: land stays low and muddy, channels go deep.
        if (y > 0) y = Math.pow(y, 1.25) * 1.1 + 0.05;
        else y = -Math.pow(-y, 0.85) * 1.15;
        // The edge rises into a wall of dead forest.
        const edge = Math.min(x, z, SIZE - x, SIZE - z);
        y = lerp(y, Math.max(y, 1.4 + fine * 0.3), smooth(26, 8, edge));
        h[j * NV + i] = clamp(y, H_MIN + 0.1, H_MAX - 0.1);
      }
      return { h, seed };
    }
    function heightAt(sw, x, z) {
      const fx = clamp(x / RES, 0, NV - 1.001), fz = clamp(z / RES, 0, NV - 1.001);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const a = sw.h[j * NV + i], b = sw.h[j * NV + i + 1], c = sw.h[(j + 1) * NV + i], d = sw.h[(j + 1) * NV + i + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function heightTexture(sw) {
      const d = new Uint8Array(NV * NV * 4);
      for (let k = 0; k < NV * NV; k++) {
        const t = clamp((sw.h[k] - H_MIN) / (H_MAX - H_MIN), 0, 1) * 65535;
        d[k * 4] = t >> 8; d[k * 4 + 1] = t & 255; d[k * 4 + 2] = 0; d[k * 4 + 3] = 255;
      }
      const t = new THREE.DataTexture(d, NV, NV, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    }

    /* ---- ground ---- */
    const TERRAIN_FS_HEAD = /* glsl */`
      varying vec3 vSNormal;
      float swWet;
    `;
    const terrainMat = swampify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }), {
      key: "terrain",
      vHead: "varying vec3 vSNormal;\n",
      vBegin: "vSNormal = normal;",
      fHead: TERRAIN_FS_HEAD,
      fMap: /* glsl */`
        {
          vec3 P = vSWorld;
          vec3 Nw = normalize(vSNormal);
          float n1 = texture2D(uNoise, P.xz * 0.045).r;
          float n2 = texture2D(uNoise, P.xz * 0.21).g;
          float n3 = texture2D(uNoise, P.xz * 0.9).b;
          float slope = 1.0 - Nw.y;
          // Mud, moss and leaf litter by height above the water and by noise.
          vec3 mud = mix(vec3(0.05, 0.04, 0.03), vec3(0.08, 0.064, 0.045), n2);
          vec3 moss = mix(vec3(0.035, 0.05, 0.02), vec3(0.07, 0.085, 0.032), n1);
          vec3 litter = mix(vec3(0.075, 0.055, 0.035), vec3(0.055, 0.045, 0.03), n3);
          float up = smoothstep(0.05, 0.6, P.y + (n1 - 0.5) * 0.5);
          vec3 c = mix(mud, mix(moss, litter, smoothstep(0.55, 0.8, n2)), up);
          c = mix(c, mud * 0.9, smoothstep(0.35, 0.75, slope));
          // Wet: darker and glossier toward the waterline; drowned mud below it.
          swWet = 1.0 - smoothstep(-0.05, 0.35, P.y + (n3 - 0.5) * 0.15);
          c *= mix(1.0, 0.5, swWet);
          c = mix(c, vec3(0.03, 0.04, 0.03), smoothstep(0.0, -0.8, P.y) * 0.6);
          c *= 0.9 + n3 * 0.2;
          // Up close: leaf litter, dark flecks and pale twigs in the mud.
          float n4 = texture2D(uNoise, P.xz * 0.33 + 0.21).g;
          float n5 = texture2D(uNoise, P.xz * 0.55 + 0.37).r;
          float n6 = texture2D(uNoise, P.xz * 0.16 + 0.71).b;
          float dry = up * (1.0 - swWet);
          // Russet leaf drifts, dark wet hollows, green moss cushions, pale twigs.
          c = mix(c, vec3(0.1, 0.05, 0.024), smoothstep(0.55, 0.7, n5) * dry * 0.75);
          c = mix(c, vec3(0.025, 0.03, 0.018), smoothstep(0.62, 0.78, n4) * (1.0 - smoothstep(0.5, 0.7, n5)) * 0.6);
          c = mix(c, vec3(0.04, 0.07, 0.022), smoothstep(0.58, 0.7, n6) * smoothstep(0.4, 0.6, n4) * dry * 0.7);
          c *= 0.72 + 0.56 * n3;
          c = mix(c, vec3(0.2, 0.17, 0.12), smoothstep(0.82, 0.88, n3) * smoothstep(0.5, 0.65, n6) * dry * 0.8);
          diffuseColor.rgb = c;
        }
      `,
      fRough: /* glsl */`
        float roughnessFactor = mix(0.95, 0.28, swWet);
      `,
      fNormal: /* glsl */`
        {
          vec2 q = vSWorld.xz * 0.9;
          float e = 0.6;
          float hc = texture2D(uNoise, q * 0.25).b;
          float hx = texture2D(uNoise, (q + vec2(e, 0.0)) * 0.25).b;
          float hz = texture2D(uNoise, (q + vec2(0.0, e)) * 0.25).b;
          float fade = 1.0 - smoothstep(4.0, 22.0, length(vSWorld - cameraPosition));
          vec3 bump = vec3(hc - hx, 0.0, hc - hz) * 0.45 * fade * (1.0 - swWet * 0.6);
          // And a fine grain within a few metres.
          vec2 q2 = vSWorld.xz * 0.16;
          float e2 = 0.02;
          float fc = texture2D(uNoise, q2).b, fx2 = texture2D(uNoise, q2 + vec2(e2, 0.0)).b, fz2 = texture2D(uNoise, q2 + vec2(0.0, e2)).b;
          bump += vec3(fc - fx2, 0.0, fc - fz2) * 0.9 * (1.0 - smoothstep(2.0, 10.0, length(vSWorld - cameraPosition))) * (1.0 - swWet * 0.7);
          normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);
        }
      `
    });
    const world = { terrain: null, water: null, sky: null, trees: [], reeds: null, lilies: null, flowers: null, fireflies: null, mist: null, heightTex: null };

    function buildTerrain(sw) {
      const CH = 64;
      const group = new THREE.Group();
      for (let cz = 0; cz < SIZE / CH; cz++) for (let cx = 0; cx < SIZE / CH; cx++) {
        const n = CH / RES + 1;
        const g = new THREE.PlaneGeometry(CH, CH, n - 1, n - 1);
        g.rotateX(-Math.PI / 2);
        const pos = g.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          const x = pos.getX(k) + cx * CH + CH / 2, z = pos.getZ(k) + cz * CH + CH / 2;
          pos.setXYZ(k, x, heightAt(sw, x, z), z);
        }
        g.computeVertexNormals();
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, terrainMat);
        m.receiveShadow = true;
        group.add(m);
      }
      return group;
    }

    /* ---- water ---- */
    const reflRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
    const reflCam = new THREE.PerspectiveCamera();
    const reflTexMat = new THREE.Matrix4();
    const MAX_RIP = 24;
    const ripples = [];
    for (let i = 0; i < MAX_RIP; i++) ripples.push(new THREE.Vector4(0, 0, -99, 0));
    let ripNext = 0;
    // A ring on the water. `glow` lights it with the swamp's own
    // bioluminescence: 1 for the thing's slime and whatever is thrown in,
    // a little for your own steps, none for rain and bubbles.
    function addRipple(x, z, amp, glow) {
      ripples[ripNext].set(x, z, SHARED.uTime.value, Math.min(amp, 0.98) + (glow >= 1 ? 1 : glow > 0 ? 2 : 0));
      ripNext = (ripNext + 1) % MAX_RIP;
    }
    const MAX_GLINT = 6;
    const glints = { p: [], c: [] };
    for (let i = 0; i < MAX_GLINT; i++) { glints.p.push(new THREE.Vector4(0, -99, 0, 0)); glints.c.push(new THREE.Color(0, 0, 0)); }
    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: Object.assign({}, SHARED, {
        uRefl: { value: reflRT.texture }, uTexMat: { value: reflTexMat },
        uWaterN: { value: waterNormTex }, uHeight: { value: null },
        uDeep: { value: LOOK.waterDeep }, uMurk: { value: LOOK.waterMurk }, uScum: { value: LOOK.waterScum },
        uMoonC: { value: LOOK.moonColor.clone().multiplyScalar(LOOK.moonI) },
        uHemiSky: { value: LOOK.hemiSky.clone().multiplyScalar(LOOK.hemiI) },
        uRip: { value: ripples }, uGlintP: { value: glints.p }, uGlintC: { value: glints.c }, uRain: { value: 0 }
      }),
      vertexShader: /* glsl */`
        uniform mat4 uTexMat;
        varying vec3 vW;
        varying vec4 vR;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vR = uTexMat * w;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_FOG}
        uniform sampler2D uRefl, uWaterN, uHeight;
        uniform vec3 uDeep, uMurk, uScum, uMoonC, uHemiSky;
        uniform vec4 uRip[${MAX_RIP}];
        uniform vec4 uGlintP[${MAX_GLINT}];
        uniform vec3 uGlintC[${MAX_GLINT}];
        uniform float uRain;
        varying vec3 vW;
        varying vec4 vR;
        float floorAt(vec2 xz) {
          vec4 t = texture2D(uHeight, (xz / ${RES.toFixed(1)} + 0.5) / ${NV.toFixed(1)});
          return (t.r * 65280.0 + t.g * 255.0) / 65535.0 * ${(H_MAX - H_MIN).toFixed(1)} + ${H_MIN.toFixed(1)};
        }
        void main() {
          vec2 p = vW.xz;
          float depth = max(0.0, -floorAt(p));
          // Duckweed and scum lie in the still, shallow places.
          float scumN = texture2D(uNoise, p * 0.021).g * 0.7 + texture2D(uNoise, p * 0.11).b * 0.3;
          float scum = smoothstep(0.52, 0.66, scumN) * (1.0 - smoothstep(0.5, 2.0, depth));
          vec3 a = texture2D(uWaterN, p * 0.055 + vec2(uTime * 0.008, uTime * 0.005)).xyz * 2.0 - 1.0;
          vec3 b = texture2D(uWaterN, p * 0.17 - vec2(uTime * 0.011, -uTime * 0.009)).xyz * 2.0 - 1.0;
          // Still water: a faint swell, and now and then a cat's-paw of breeze.
          float breeze = smoothstep(0.55, 0.8, texture2D(uNoise, p * 0.008 + vec2(uTime * 0.006, uTime * 0.004)).r);
          vec2 g = (a.xy * (0.07 + breeze * 0.16) + b.xy * (0.04 + breeze * 0.1)) * (1.0 - scum * 0.85);
          // Rings from everything that touches the water.
          float biolum = 0.0;
          for (int i = 0; i < ${MAX_RIP}; i++) {
            vec4 r = uRip[i];
            float age = uTime - r.z;
            if (r.w <= 0.0 || age < 0.0 || age > 6.0) continue;
            float lev = floor(r.w);
            float amp = r.w - lev;
            vec2 dv = p - r.xy;
            float d = length(dv) + 1e-4;
            float k = d - age * 1.15;
            float w = amp * exp(-k * k * 6.0) * exp(-age * 0.7) / (1.0 + d * 0.8);
            g += (dv / d) * cos(k * 14.0) * w * 9.0;
            biolum += (lev > 1.5 ? 0.3 : lev) * w * (0.55 + 0.45 * cos(k * 14.0));
          }
          // Rain: small rings opening everywhere at once.
          if (uRain > 0.02) {
            for (int k = 0; k < 2; k++) {
              vec2 q = p * (1.7 + float(k) * 1.1) + float(k) * 17.3;
              vec2 cell = floor(q);
              vec2 f = fract(q) - 0.5;
              float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
              if (h > uRain) continue;
              vec2 dv = f - (vec2(fract(h * 37.7), fract(h * 91.3)) - 0.5) * 0.5;
              float t = fract(uTime * 0.85 + h * 7.0);
              float d = length(dv) + 1e-4;
              float kk = d - t * 0.42;
              g += dv / d * cos(kk * 70.0) * exp(-kk * kk * 600.0) * (1.0 - t) * 0.3;
            }
          }
          vec3 N = normalize(vec3(g.x, 1.0, g.y));
          vec3 V = normalize(cameraPosition - vW);
          float ndv = max(dot(N, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
          // The mirror: what stands above the water, wobbling with it.
          vec2 ruv = vR.xy / vR.w + N.xz * 0.03;
          vec3 refl = texture2D(uRefl, ruv).rgb;
          // The body: black where deep, peat-brown in the shallows.
          vec3 body = mix(uMurk, uDeep, smoothstep(0.0, 1.4, depth));
          body *= 0.35 + uHemiSky * 0.6;
          vec3 c = mix(body, refl, clamp(fres * 1.15 + 0.08, 0.0, 1.0) * (1.0 - scum * 0.8));
          // The scum itself, lit faintly by the sky.
          float scumTone = texture2D(uNoise, p * 0.6).b;
          c = mix(c, uScum * (0.55 + scumTone * 0.6) * (uHemiSky * 1.2 + 0.08), scum * 0.92);
          // The moon's glitter, and the lanterns' long streaks.
          vec3 R = reflect(-V, N);
          float sm = max(dot(R, uMoonDir), 0.0);
          float fine = texture2D(uWaterN, p * 0.9 + uTime * 0.03).x;
          c += uMoonC * (pow(sm, 1600.0) * 9.0 * smoothstep(0.55, 0.75, fine) + pow(sm, 160.0) * 0.25) * (1.0 - scum);
          for (int i = 0; i < ${MAX_GLINT}; i++) {
            vec4 L = uGlintP[i];
            if (L.w <= 0.0) continue;
            vec3 Lv = L.xyz - vW;
            float d2 = dot(Lv, Lv);
            vec3 Ld = Lv * inversesqrt(d2);
            float s = max(dot(R, Ld), 0.0);
            // Glitter where the ripples catch the lamp (the lamp itself is in the mirror).
            c += uGlintC[i] * pow(s, 400.0) * 5.0 * smoothstep(0.5, 0.7, fine) * L.w / (1.0 + d2 * 0.02) * (1.0 - scum * 0.7);
            c += uGlintC[i] * 0.025 * L.w / (1.0 + d2 * 0.5);
          }
          // The water is full of something that glows when it is stirred.
          c += vec3(0.12, 0.78, 0.66) * clamp(biolum, 0.0, 0.25) * 14.0 * (1.0 - scum * 0.5);
          float alpha = clamp(0.6 + depth * 0.55, 0.6, 0.97);
          alpha = max(alpha, fres);
          alpha = max(alpha, scum);
          gl_FragColor = vec4(swampFog(c, vW), alpha);
        }`
    });
    function buildWater() {
      const g = new THREE.PlaneGeometry(SIZE + 400, SIZE + 400, 8, 8);
      g.rotateX(-Math.PI / 2);
      g.translate(SIZE / 2, WATER_Y, SIZE / 2);
      const m = new THREE.Mesh(g, waterMat);
      m.renderOrder = 2;
      m.frustumCulled = false;
      return m;
    }

    /* ---- sky ---- */
    const skyMat = new THREE.ShaderMaterial({
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uTime: SHARED.uTime, uNoise: SHARED.uNoise, uMoonDir: SHARED.uMoonDir,
        uZen: { value: LOOK.skyZenith }, uHor: { value: LOOK.skyHorizon }, uMoonGlow: { value: LOOK.skyMoon },
        uFlash: { value: 0 }, uBoltDir: { value: V3(0, 0.3, -1).normalize() }
      },
      vertexShader: /* glsl */`
        varying vec3 vD;
        void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform sampler2D uNoise;
        uniform vec3 uMoonDir, uZen, uHor, uMoonGlow, uBoltDir;
        uniform float uFlash;
        varying vec3 vD;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vD);
          float up = clamp(d.y, -0.2, 1.0);
          vec3 c = mix(uHor, uZen, pow(clamp(up, 0.0, 1.0), 0.55));
          c = mix(c, uHor * 0.55, smoothstep(0.0, -0.2, d.y));
          float m = max(dot(d, uMoonDir), 0.0);
          // Halo, glow and the disc.
          c += uMoonGlow * (pow(m, 24.0) * 0.35 + pow(m, 260.0) * 1.2);
          float disc = smoothstep(0.99935, 0.99952, m);
          if (disc > 0.0) {
            vec3 t = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
            vec3 b = cross(t, uMoonDir);
            vec2 q = vec2(dot(d, t), dot(d, b)) * 34.0;
            float maria = texture2D(uNoise, q * 0.35 + 0.3).r;
            c = mix(c, vec3(1.0, 0.97, 0.9) * (3.6 - smoothstep(0.45, 0.7, maria) * 1.2), disc);
          }
          // Stars, thinning toward the horizon.
          vec2 sp = vec2(atan(d.z, d.x) * 120.0, d.y * 260.0);
          vec2 cell = floor(sp);
          float h = hash(cell);
          if (h > 0.985) {
            vec2 f = fract(sp) - 0.5;
            float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
            c += vec3(0.8, 0.85, 1.0) * smoothstep(0.22, 0.0, length(f)) * (h - 0.985) * 90.0 * tw * smoothstep(0.05, 0.35, d.y) * (1.0 - pow(m, 6.0));
          }
          // Thin cloud, silvered where the moon is behind it.
          vec2 cp = d.xz / (d.y + 0.12) * 0.32 + vec2(uTime * 0.0012, 0.0);
          float cl = smoothstep(0.5, 0.85, texture2D(uNoise, cp).r * 0.7 + texture2D(uNoise, cp * 2.7).g * 0.3) * smoothstep(0.02, 0.25, d.y);
          c = mix(c, uHor * 0.45 + uMoonGlow * pow(m, 6.0) * 0.5, cl * 0.6);
          // Lightning lights the cloud it is in, and a little of everything.
          c += vec3(0.5, 0.56, 0.78) * uFlash * (0.06 + 1.4 * pow(max(dot(d, uBoltDir), 0.0), 8.0)) * (0.35 + cl * 1.3);
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    function buildSky() {
      const m = new THREE.Mesh(new THREE.SphereGeometry(380, 48, 24), skyMat);
      m.frustumCulled = false;
      m.renderOrder = -10;
      return m;
    }

    /* ---- trees ---- */
    // A bald cypress: a fluted, buttressed foot with knees standing round
    // it in the water, a long bare trunk, and a flat, layered crown of
    // feathery fans hung with Spanish moss.
    function cypressGeometry(rng) {
      const trunk = [], fr = [], moss = [];
      const H = 12 + rng() * 7;
      const RS = 10, HS = 11;
      const lean = [(rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1];
      const flutes = 5 + Math.floor(rng() * 3), fph = rng() * 6.28;
      const radius = (t, a) => {
        const flare = Math.pow(1 - smooth(0, 0.18, t), 2.4);
        const lobes = 1 + flare * 0.6 * Math.max(0, Math.sin(a * flutes + fph));
        return (0.22 + flare * 1.25 + (1 - t) * 0.16) * lobes;
      };
      const center = t => [lean[0] * t * t * H, lean[1] * t * t * H];
      const tube = (pts, r0, r1, S) => {
        const P = [], N = [], C = [], I = [];
        for (let k = 0; k < pts.length; k++) {
          const [x, y, z] = pts[k];
          const nx = pts[Math.min(k + 1, pts.length - 1)], pv = pts[Math.max(k - 1, 0)];
          let tx = nx[0] - pv[0], ty = nx[1] - pv[1], tz = nx[2] - pv[2];
          const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
          let ux = -tz, uy = 0, uz = tx;
          let ul = Math.hypot(ux, uy, uz);
          if (ul < 1e-3) { ux = 1; uy = 0; uz = 0; ul = 1; }
          ux /= ul; uz /= ul;
          const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
          const r = lerp(r0, r1, k / (pts.length - 1));
          for (let i = 0; i <= S; i++) {
            const a = (i / S) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
            P.push(x + (ux * ca + vx * sa) * r, y + (uy * ca + vy * sa) * r, z + (uz * ca + vz * sa) * r);
            N.push(ux * ca + vx * sa, uy * ca + vy * sa, uz * ca + vz * sa);
            C.push(0.85, 0.85, 0.85);
          }
        }
        for (let k = 0; k < pts.length - 1; k++) for (let i = 0; i < S; i++) {
          const a = k * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1;
          I.push(a, c, b, b, c, d);
        }
        return { P, N, C, I };
      };
      // The trunk.
      {
        const P = [], N = [], C = [], I = [];
        for (let j = 0; j <= HS; j++) {
          const t = Math.pow(j / HS, 1.6);
          const [ox, oz] = center(t);
          for (let i = 0; i <= RS; i++) {
            const a = (i / RS) * Math.PI * 2;
            const r = radius(t, a);
            P.push(ox + Math.cos(a) * r, t * H - 0.8, oz + Math.sin(a) * r);
            N.push(Math.cos(a), 0.1, Math.sin(a));
            const ao = 0.5 + 0.5 * smooth(0, 0.2, t);
            C.push(ao, ao, ao);
          }
        }
        for (let j = 0; j < HS; j++) for (let i = 0; i < RS; i++) {
          const a = j * (RS + 1) + i, b = a + 1, c = a + RS + 1, d = c + 1;
          I.push(a, c, b, b, c, d);
        }
        trunk.push({ P, N, C, I });
      }
      // Knees: knobbly cones standing out of the water round the foot.
      const knees = 3 + Math.floor(rng() * 6);
      for (let k = 0; k < knees; k++) {
        const a = rng() * Math.PI * 2, d = 1.6 + rng() * 2.2, h = 0.35 + rng() * 0.7, r = 0.1 + rng() * 0.1;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        trunk.push(tube([[x, -0.9, z], [x + 0.03, -0.9 + h * 0.6, z], [x + 0.05, -0.9 + h + 0.4, z + 0.02]], r * 1.6, r * 0.5, 4));
      }
      // Limbs: long, near-level, mostly in the top half, each with fans
      // of foliage along it and moss hanging beneath.
      const limbs = 6 + Math.floor(rng() * 5);
      for (let k = 0; k < limbs; k++) {
        const t = 0.45 + (k / limbs) * 0.5 + rng() * 0.04;
        const [ox, oz] = center(t);
        const y = t * H - 0.8;
        const ang = rng() * Math.PI * 2, len = (2.2 + rng() * 3.2) * (1.15 - t * 0.6);
        const droop = (rng() - 0.3) * 0.5;
        const pts = [];
        for (let s = 0; s <= 4; s++) {
          const u = s / 4;
          pts.push([ox + Math.cos(ang) * len * u, y + u * len * 0.18 + u * u * droop, oz + Math.sin(ang) * len * u]);
        }
        trunk.push(tube([pts[0], pts[2], pts[4]], 0.11 + (1 - t) * 0.06, 0.03, 4));
        const fans = 2 + Math.floor(rng() * 3);
        for (let c = 0; c < fans; c++) {
          const u = 0.35 + (c / fans) * 0.7 + rng() * 0.08;
          const q = pts[Math.min(4, Math.round(u * 4))];
          const cx = q[0] + (rng() - 0.5) * 0.5, cy = q[1] + 0.15 + rng() * 0.3, cz = q[2] + (rng() - 0.5) * 0.5;
          const size = 2.5 + rng() * 1.7;
          // Mostly flat fans, one tilted card for body.
          for (let n = 0; n < 4; n++) {
            const qa = rng() * Math.PI, tilt = n === 3 ? 0.9 + rng() * 0.4 : 0.12 + rng() * 0.35;
            const ax = Math.cos(qa), az = Math.sin(qa);
            const bx = -az * Math.cos(tilt), by = Math.sin(tilt), bz = ax * Math.cos(tilt);
            const h = size * 0.5;
            fr.push([cx - ax * h - bx * h, cy - by * h, cz - az * h - bz * h, 0, 1], [cx + ax * h - bx * h, cy - by * h, cz + az * h - bz * h, 1, 1],
                    [cx + ax * h + bx * h, cy + by * h, cz + az * h + bz * h, 1, 0], [cx - ax * h + bx * h, cy + by * h, cz - az * h + bz * h, 0, 0]);
          }
          // Spanish moss: long grey curtains under most fans.
          const strands = rng() < 0.85 ? 1 + Math.floor(rng() * 3) : 0;
          for (let m = 0; m < strands; m++) {
            const mh = 1.8 + rng() * 3.4, mw = 0.45 + rng() * 0.55, ma = rng() * Math.PI;
            const mx = cx + (rng() - 0.5) * size * 0.6, mz = cz + (rng() - 0.5) * size * 0.6, my = cy - 0.05;
            const dx = Math.cos(ma) * mw * 0.5, dz = Math.sin(ma) * mw * 0.5;
            moss.push([mx - dx, my, mz - dz, 0, 0], [mx + dx, my, mz + dz, 1, 0], [mx + dx, my - mh, mz + dz, 1, 1], [mx - dx, my - mh, mz - dz, 0, 1]);
          }
        }
      }
      // The flat top.
      for (let c = 0; c < 4; c++) {
        const [ox, oz] = center(1);
        const cx = ox + (rng() - 0.5) * 2.4, cy = H - 1.2 + rng() * 0.8, cz = oz + (rng() - 0.5) * 2.4;
        const size = 2.6 + rng() * 1.2;
        for (let n = 0; n < 2; n++) {
          const qa = rng() * Math.PI, tilt = 0.1 + rng() * 0.3;
          const ax = Math.cos(qa), az = Math.sin(qa);
          const bx = -az * Math.cos(tilt), by = Math.sin(tilt), bz = ax * Math.cos(tilt);
          const h = size * 0.5;
          fr.push([cx - ax * h - bx * h, cy - by * h, cz - az * h - bz * h, 0, 1], [cx + ax * h - bx * h, cy - by * h, cz + az * h - bz * h, 1, 1],
                  [cx + ax * h + bx * h, cy + by * h, cz + az * h + bz * h, 1, 0], [cx - ax * h + bx * h, cy + by * h, cz - az * h + bz * h, 0, 0]);
        }
      }
      return { trunk, fr, moss, H };
    }
    function mergeParts(parts) {
      const P = [], N = [], C = [], I = [];
      for (const p of parts) {
        const base = P.length / 3;
        P.push(...p.P); N.push(...p.N); C.push(...p.C);
        for (const i of p.I) I.push(i + base);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      g.setIndex(I);
      g.computeVertexNormals();
      return g;
    }
    // Cards: quads with normals bent out from the clump, so they light as a mass.
    function cardsGeometry(quads, bendCenter) {
      const P = [], N = [], U = [], I = [];
      for (let q = 0; q < quads.length; q += 4) {
        const base = P.length / 3;
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 4; k++) { cx += quads[q + k][0] / 4; cy += quads[q + k][1] / 4; cz += quads[q + k][2] / 4; }
        for (let k = 0; k < 4; k++) {
          const v = quads[q + k];
          P.push(v[0], v[1], v[2]);
          U.push(v[3], v[4]);
          let nx = v[0] - cx, ny = v[1] - cy + (bendCenter ? 0.6 : 0.2), nz = v[2] - cz;
          const L = Math.hypot(nx, ny, nz) || 1;
          N.push(nx / L, ny / L, nz / L);
        }
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
      g.setIndex(I);
      return g;
    }
    const barkMat = swampify(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92 }), {
      key: "bark", sway: 0.15,
      fMap: /* glsl */`
        {
          vec3 P = vSWorld;
          float n = texture2D(uNoise, vec2(atan(P.x, P.z) * 0.5, P.y * 0.08)).g;
          float ridges = texture2D(uNoise, vec2(P.x * 0.9 + P.z * 0.9, P.y * 0.05)).b;
          vec3 c = mix(vec3(0.12, 0.1, 0.085), vec3(0.3, 0.25, 0.2), n * 0.55 + ridges * 0.45);
          c *= 0.8 + 0.4 * smoothstep(0.3, 0.7, texture2D(uNoise, vec2(atan(P.x, P.z) * 2.0, P.y * 0.6)).b);
          // Water stains and moss at the foot of the trunk.
          c = mix(c, vec3(0.05, 0.065, 0.03), (1.0 - smoothstep(0.2, 1.6, P.y)) * 0.7);
          diffuseColor.rgb = c;
        }
      `
    });
    const frondMat = swampify(new THREE.MeshLambertMaterial({ map: frondTex, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, color: 0xc4d2ad }), { key: "frond", sway: 0.22 });
    const mossMat = swampify(new THREE.MeshLambertMaterial({ map: mossTex, alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, color: 0x9aa58a }), {
      key: "moss",
      vBegin: /* glsl */`
        {
          vec4 wb = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            wb = instanceMatrix * wb;
          #endif
          transformed.x += sin(uTime * 1.7 + wb.x * 0.3 + position.y) * uv.y * uv.y * 0.18 * uWind;
          transformed.z += cos(uTime * 1.3 + wb.z * 0.3) * uv.y * uv.y * 0.12 * uWind;
        }
      `
    });

    function placeTrees(sw, rng) {
      const pts = [];
      const ok = (x, z, minD) => { for (const p of pts) if ((p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD) return false; return true; };
      for (let tries = 0; tries < 12000 && pts.length < 300; tries++) {
        const x = 6 + rng() * (SIZE - 12), z = 6 + rng() * (SIZE - 12);
        const y = heightAt(sw, x, z);
        const edge = Math.min(x, z, SIZE - x, SIZE - z);
        const grove = Math.hypot((x - POI.grove.x) / 1.4, z - POI.grove.z) < 30;
        // Cypress stand in the shallows as often as on land; the edge is a
        // wall, and the grove is a crowd. None grows through a building.
        const want = y > -0.9 && (edge < 22 ? rng() < 0.9 : grove ? rng() < 0.85 : rng() < (y > 0.1 ? 0.35 : 0.22));
        if (!want || !ok(x, z, edge < 22 ? 4.2 : grove ? 4.4 : 7) || siteBlocked(x, z, 2.4)) continue;
        pts.push({ x, z, y, s: 0.75 + rng() * 0.6, r: rng() * Math.PI * 2, dead: rng() < (edge < 22 ? 0.35 : 0.14) });
      }
      return pts;
    }
    // Instances are bucketed into tiles, so the camera skips the tiles it
    // cannot see, and small things beyond their distance are not drawn.
    const cullables = [];
    function scatter(geo, mat, pts, compose, o) {
      o = o || {};
      const T = o.tile || 64, n = Math.ceil(SIZE / T), buckets = new Map();
      for (const p of pts) {
        const k = clamp(Math.floor(p.x / T), 0, n - 1) + clamp(Math.floor(p.z / T), 0, n - 1) * n;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(p);
      }
      const out = [], m4 = new THREE.Matrix4();
      for (const list of buckets.values()) {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((p, k) => { compose(p, m4); im.setMatrixAt(k, m4); });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = !!o.cast;
        im.receiveShadow = o.receive !== false;
        if (o.order) im.renderOrder = o.order;
        if (o.far) cullables.push({ mesh: im, far: o.far });
        out.push(im);
      }
      return out;
    }
    const _q = new THREE.Quaternion(), _s = V3(), _p = V3(), _up = V3(0, 1, 0);
    function buildTrees(sw, seed) {
      const rng = mulberry32(seed ^ 0x7ee5);
      const pts = placeTrees(sw, rng);
      const VARIANTS = 4;
      const group = new THREE.Group();
      const colliders = [];
      for (let v = 0; v < VARIANTS; v++) {
        const geo = cypressGeometry(mulberry32(seed * 7 + v * 131));
        const mine = pts.filter((p, i) => i % VARIANTS === v);
        if (!mine.length) continue;
        const trunkG = mergeParts(geo.trunk), frondG = cardsGeometry(geo.fr, true), mossG = cardsGeometry(geo.moss, false);
        const compose = (p, m4) => {
          _q.setFromAxisAngle(_up, p.r);
          _s.set(p.s, p.s * p.sy, p.s);
          m4.compose(_p.set(p.x, p.y, p.z), _q, _s);
        };
        mine.forEach((p, k) => { p.sy = 0.9 + (k % 3) * 0.08; colliders.push({ x: p.x, z: p.z, r: 0.45 * p.s, y: p.y }); });
        for (const m of scatter(trunkG, barkMat, mine, compose, { tile: 128, cast: true })) group.add(m);
        for (const m of scatter(mossG, mossMat, mine, compose, { tile: 128, cast: true })) group.add(m);
        const live = mine.filter(p => !p.dead);
        if (live.length) for (const m of scatter(frondG, frondMat, live, compose, { tile: 128, cast: true, receive: false })) group.add(m);
      }
      return { group, colliders, pts };
    }

    /* ---- reeds, cattails, lily pads ---- */
    function reedGeometry(rng) {
      const P = [], C = [], I = [];
      const blades = 9 + Math.floor(rng() * 6);
      for (let b = 0; b < blades; b++) {
        const a = rng() * Math.PI * 2, r = rng() * 0.25;
        const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
        const h = 0.9 + rng() * 1.1, lean = 0.15 + rng() * 0.45, la = a + (rng() - 0.5);
        const w = 0.025 + rng() * 0.02;
        const segs = 4, base = P.length / 3;
        for (let s = 0; s <= segs; s++) {
          const t = s / segs;
          const x = bx + Math.cos(la) * lean * t * t, z = bz + Math.sin(la) * lean * t * t, y = h * t;
          const ww = w * (1 - t * 0.85);
          const px = -Math.sin(la) * ww, pz = Math.cos(la) * ww;
          P.push(x - px, y, z - pz, x + px, y, z + pz);
          const tone = 0.35 + t * 0.4 + rng() * 0.1;
          const green = [0.16 * tone + 0.03, 0.2 * tone + 0.05, 0.08 * tone + 0.02];
          C.push(...green, ...green);
        }
        for (let s = 0; s < segs; s++) {
          const k = base + s * 2;
          I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      // A couple of cattails: a stalk and a brown head.
      const tails = Math.floor(rng() * 3);
      for (let c = 0; c < tails; c++) {
        const bx = (rng() - 0.5) * 0.3, bz = (rng() - 0.5) * 0.3, h = 1.3 + rng() * 0.6;
        const base = P.length / 3;
        for (let s = 0; s < 4; s++) {
          const a = (s / 4) * Math.PI * 2, r = 0.035;
          P.push(bx + Math.cos(a) * r, h, bz + Math.sin(a) * r, bx + Math.cos(a) * r, h + 0.28, bz + Math.sin(a) * r);
          C.push(0.14, 0.08, 0.04, 0.16, 0.09, 0.05);
        }
        for (let s = 0; s < 4; s++) {
          const k = base + s * 2, n = base + ((s + 1) % 4) * 2;
          I.push(k, n, k + 1, k + 1, n, n + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      g.setIndex(I);
      g.computeVertexNormals();
      return g;
    }
    const reedMat = swampify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { key: "reed", sway: 1.0 });
    function lilyGeometry() {
      const P = [0, 0.012, 0], C = [0.06, 0.1, 0.035], I = [];
      const S = 18;
      for (let i = 0; i <= S; i++) {
        const a = 0.35 + (i / S) * (Math.PI * 2 - 0.7);
        P.push(Math.cos(a) * 0.32, 0.02, Math.sin(a) * 0.32);
        const k = 0.55 + (i % 3) * 0.06;
        C.push(0.07 * k, 0.13 * k, 0.04 * k);
      }
      for (let i = 1; i <= S; i++) I.push(0, i + 1, i);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      g.setIndex(I);
      g.computeVertexNormals();
      return g;
    }
    const lilyMat = swampify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), {
      key: "lily",
      vBegin: /* glsl */`
        {
          vec4 wb = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            wb = instanceMatrix * wb;
          #endif
          transformed.y += sin(uTime * 0.9 + wb.x * 0.7 + wb.z * 0.5) * 0.012;
        }
      `
    });
    const flowerMat = swampify(new THREE.MeshStandardMaterial({ color: 0xe9dfe4, emissive: 0x4a3044, emissiveIntensity: 0.22, roughness: 0.6 }), { key: "flower" });
    const fanMat = swampify(new THREE.MeshLambertMaterial({ map: fanTex, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide, color: 0xa8b894 }), { key: "fan", sway: 0.8 });
    function palmettoGeometry(rng) {
      const quads = [];
      const fans = 6 + Math.floor(rng() * 5);
      for (let f = 0; f < fans; f++) {
        const a = rng() * Math.PI * 2, out = 0.25 + rng() * 0.45, h = 0.45 + rng() * 0.55, size = 0.9 + rng() * 0.5;
        const cx = Math.cos(a) * out, cz = Math.sin(a) * out, cy = h;
        // The fan faces out and leans back.
        const tilt = 0.5 + rng() * 0.6;
        const ux = -Math.sin(a), uz = Math.cos(a);
        const vx = Math.cos(a) * Math.sin(tilt), vy = Math.cos(tilt), vz = Math.sin(a) * Math.sin(tilt);
        const hw = size * 0.5;
        quads.push([cx - ux * hw, cy, cz - uz * hw, 0, 1], [cx + ux * hw, cy, cz + uz * hw, 1, 1],
                   [cx + ux * hw + vx * size, cy + vy * size, cz + uz * hw + vz * size, 1, 0], [cx - ux * hw + vx * size, cy + vy * size, cz - uz * hw + vz * size, 0, 0]);
      }
      return cardsGeometry(quads, true);
    }
    function grassGeometry(rng) {
      const P = [], C = [], I = [];
      const blades = 14 + Math.floor(rng() * 10);
      for (let b = 0; b < blades; b++) {
        const a = rng() * Math.PI * 2, r = rng() * 0.3;
        const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
        const h = 0.25 + rng() * 0.45, lean = 0.1 + rng() * 0.25, la = a + (rng() - 0.5);
        const w = 0.018 + rng() * 0.012, base = P.length / 3;
        for (let s = 0; s <= 3; s++) {
          const t = s / 3;
          const x = bx + Math.cos(la) * lean * t * t, z = bz + Math.sin(la) * lean * t * t, y = h * t;
          const ww = w * (1 - t * 0.9), px = -Math.sin(la) * ww, pz = Math.cos(la) * ww;
          P.push(x - px, y, z - pz, x + px, y, z + pz);
          const tone = 0.3 + t * 0.5;
          const cc = [0.07 * tone + 0.02, 0.09 * tone + 0.025, 0.035 * tone + 0.01];
          C.push(...cc, ...cc);
        }
        for (let s = 0; s < 3; s++) { const k = base + s * 2; I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      g.setIndex(I);
      g.computeVertexNormals();
      return g;
    }
    function buildCover(sw, seed) {
      const rng = mulberry32(seed ^ 0xc0e7), n = latticeNoise(seed + 13);
      const palm = [], grass = [];
      for (let tries = 0; tries < 50000 && palm.length < 900; tries++) {
        const x = rng() * SIZE, z = rng() * SIZE, y = heightAt(sw, x, z);
        if (y < 0.15 || n(x / 11, z / 11) < 0.5 || insideBuilt(x, z, 0.6)) continue;
        palm.push({ x, z, y, s: 0.7 + rng() * 0.7, r: rng() * 6.283 });
      }
      for (let tries = 0; tries < 90000 && grass.length < 6000; tries++) {
        const x = rng() * SIZE, z = rng() * SIZE, y = heightAt(sw, x, z);
        if (y < 0.05 || n(x / 5 + 70, z / 5) < 0.4 || insideBuilt(x, z, 0.3)) continue;
        grass.push({ x, z, y, s: 0.7 + rng() * 0.8, r: rng() * 6.283 });
      }
      const group = new THREE.Group(), grassGroup = new THREE.Group();
      const compose = (p, m4) => { _q.setFromAxisAngle(_up, p.r); _s.set(p.s, p.s, p.s); m4.compose(_p.set(p.x, p.y - 0.05, p.z), _q, _s); };
      for (let v = 0; v < 2; v++) for (const m of scatter(palmettoGeometry(mulberry32(seed + 40 + v)), fanMat, palm.filter((p, i) => i % 2 === v), compose, { far: 90, cast: true })) group.add(m);
      for (let v = 0; v < 2; v++) for (const m of scatter(grassGeometry(mulberry32(seed + 50 + v)), reedMat, grass.filter((p, i) => i % 2 === v), compose, { far: 42, tile: 32 })) grassGroup.add(m);
      group.add(grassGroup);
      return { group, grassGroup, palm, grass };
    }
    function buildPlants(sw, seed) {
      const rng = mulberry32(seed ^ 0x51ed);
      const n = latticeNoise(seed + 9);
      const reedPts = [], lilyPts = [];
      for (let tries = 0; tries < 60000 && reedPts.length < 2600; tries++) {
        const x = rng() * SIZE, z = rng() * SIZE, y = heightAt(sw, x, z);
        if (y < -0.55 || y > 0.35) continue;
        if (n(x / 9, z / 9) < 0.42 || insideBuilt(x, z, 0.5)) continue;
        reedPts.push({ x, z, y: Math.max(y, -0.55), s: 0.7 + rng() * 0.6, r: rng() * 6.283 });
      }
      for (let tries = 0; tries < 60000 && lilyPts.length < 1400; tries++) {
        const x = rng() * SIZE, z = rng() * SIZE, y = heightAt(sw, x, z);
        if (y > -0.25 || y < -1.6) continue;
        if (n(x / 14 + 40, z / 14) < 0.55 || insideBuilt(x, z, 0.4)) continue;
        lilyPts.push({ x, z, s: 0.6 + rng() * 0.8, r: rng() * 6.283, flower: rng() < 0.07 });
      }
      const group = new THREE.Group();
      const reedVariants = [reedGeometry(mulberry32(seed + 1)), reedGeometry(mulberry32(seed + 2)), reedGeometry(mulberry32(seed + 3))];
      const at = (p, m4, y, sy) => { _q.setFromAxisAngle(_up, p.r); _s.set(p.s, sy === undefined ? p.s : sy, p.s); m4.compose(_p.set(p.x, y, p.z), _q, _s); };
      reedVariants.forEach((g, v) => {
        for (const m of scatter(g, reedMat, reedPts.filter((p, i) => i % 3 === v), (p, m4) => at(p, m4, p.y), { far: 75 })) group.add(m);
      });
      for (const m of scatter(lilyGeometry(), lilyMat, lilyPts, (p, m4) => at(p, m4, WATER_Y, 1), { far: 70, order: 3, receive: false })) group.add(m);
      const fl = lilyPts.filter(p => p.flower);
      if (fl.length) {
        const fg = new THREE.ConeGeometry(0.07, 0.09, 7, 1, true);
        fg.translate(0, 0.07, 0);
        const flip = new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), Math.PI);
        for (const m of scatter(fg, flowerMat, fl, (p, m4) => m4.compose(_p.set(p.x + 0.05, WATER_Y + 0.11, p.z), flip, _s.set(1, 1, 1)), { far: 60, receive: false })) group.add(m);
      }
      return { group, reedPts, lilyPts };
    }

    /* ---- fireflies ---- */
    const flyMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: SHARED.uTime, uScale: { value: 600 } },
      vertexShader: /* glsl */`
        uniform float uTime, uScale;
        attribute vec4 aSeed;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * (0.25 + aSeed.y * 0.3);
          p += vec3(sin(t + aSeed.x * 6.3) * 1.4, sin(t * 1.7 + aSeed.z * 6.3) * 0.5, cos(t * 0.8 + aSeed.w * 6.3) * 1.4);
          vA = pow(max(sin(uTime * (0.7 + aSeed.w) + aSeed.x * 40.0), 0.0), 8.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 0.11 * uScale / max(-mv.z, 0.2);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = exp(-d * d * 5.0) * vA;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.38) * a * 9.0, 1.0);
        }`
    });
    function buildFireflies(sw, seed) {
      const rng = mulberry32(seed ^ 0xf1ef);
      const pos = [], seeds = [];
      for (let tries = 0; tries < 20000 && pos.length < 700 * 3; tries++) {
        const x = rng() * SIZE, z = rng() * SIZE, y = heightAt(sw, x, z);
        if (y < -0.4 || y > 1.5) continue;
        pos.push(x, Math.max(y, 0) + 0.4 + rng() * 2.2, z);
        seeds.push(rng(), rng(), rng(), rng());
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 4));
      const pts = new THREE.Points(g, flyMat);
      pts.frustumCulled = false;
      pts.renderOrder = 6;
      return pts;
    }

    /* ================================================================ *
     * THE PICTURE
     * The scene is drawn into a high-range buffer, the bright parts are
     * blurred into bloom, and one last pass grades it: filmic curve, a
     * cold-shadow/warm-light split, vignette and grain.
     * ================================================================ */
    const sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    const BLOOM_LEVELS = 5;
    const bloomRT = [];
    for (let i = 0; i < BLOOM_LEVELS; i++) bloomRT.push(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
    const POST_VS = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    postScene.add(quad);
    const mBright = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThr: { value: 0.9 } },
      vertexShader: POST_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThr; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
                 + texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          c *= 0.25;
          float l = max(c.r, max(c.g, c.b));
          float knee = uThr * 0.5;
          float soft = clamp(l - uThr + knee, 0.0, 2.0 * knee);
          soft = soft * soft / (4.0 * knee + 1e-4);
          float w = max(soft, l - uThr) / max(l, 1e-4);
          gl_FragColor = vec4(min(c * w, vec3(30.0)), 1.0);
        }`
    });
    const mDown = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: POST_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uSrc; uniform vec2 uTexel; varying vec2 vUv;
        vec3 s(vec2 o) { return texture2D(uSrc, vUv + o * uTexel).rgb; }
        void main() {
          vec3 c = s(vec2(0.0)) * 0.125;
          c += (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.125;
          c += (s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0))) * 0.03125;
          c += (s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, -2.0)) + s(vec2(0.0, 2.0))) * 0.0625;
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const mUp = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
      uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uK: { value: 1 } },
      vertexShader: POST_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uK; varying vec2 vUv;
        vec3 s(vec2 o) { return texture2D(uSrc, vUv + o * uTexel).rgb; }
        void main() {
          vec3 c = s(vec2(0.0)) * 4.0;
          c += (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0;
          c += s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
          gl_FragColor = vec4(c / 16.0 * uK, 1.0);
        }`
    });
    // Shafts of moonlight: the bright sky round the moon, smeared toward it,
    // so every branch across it casts a ray.
    const godRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    const mGod = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { uSrc: { value: null }, uMoon: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 0.5 } },
      vertexShader: POST_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uSrc; uniform vec2 uMoon; uniform float uAspect; varying vec2 vUv;
        void main() {
          vec2 uv = vUv, dir = (uMoon - vUv) / 30.0;
          float decay = 1.0; vec3 acc = vec3(0.0);
          for (int i = 0; i < 30; i++) {
            uv += dir;
            vec2 q = (uv - uMoon) * vec2(uAspect, 1.0);
            acc += texture2D(uSrc, uv).rgb * (1.0 - smoothstep(0.0, 0.45, length(q))) * decay;
            decay *= 0.955;
          }
          gl_FragColor = vec4(acc / 30.0, 1.0);
        }`
    });
    const mFinal = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        uScene: { value: null }, uBloom: { value: null }, uTime: SHARED.uTime, uNoise: SHARED.uNoise,
        uExposure: { value: LOOK.exposure }, uBloomK: { value: 0.42 }, uRes: { value: new THREE.Vector2(1, 1) },
        uFlash: { value: new THREE.Vector4(0, 0, 0, 0) }, uFear: { value: 0 },
        uGod: { value: godRT.texture }, uGodK: { value: 0 }
      },
      vertexShader: POST_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D uScene, uBloom, uNoise, uGod;
        uniform float uTime, uExposure, uBloomK, uFear, uGodK;
        uniform vec2 uRes;
        uniform vec4 uFlash;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main() {
          vec2 q = vUv - 0.5;
          // A breath of lens: colour fringes toward the corners.
          float ca = dot(q, q) * 0.006 * (1.0 + uFear * 2.0);
          vec3 c;
          c.r = texture2D(uScene, vUv - q * ca).r;
          c.g = texture2D(uScene, vUv).g;
          c.b = texture2D(uScene, vUv + q * ca).b;
          c += texture2D(uBloom, vUv).rgb * uBloomK;
          c += texture2D(uGod, vUv).rgb * uGodK;
          c *= uExposure;
          c = mix(c, uFlash.rgb, uFlash.a);
          // Grade: shadows toward teal, highlights toward amber.
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, c * vec3(0.86, 1.02, 1.08), (1.0 - smoothstep(0.0, 0.35, l)) * 0.6);
          c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.4, 1.2, l) * 0.5);
          c = aces(c);
          // Vignette, deeper when it is close.
          float v = smoothstep(0.85, 0.2, length(q * vec2(1.0, uRes.y / uRes.x * 0.6 + 0.4)));
          c *= mix(0.55 - uFear * 0.2, 1.0, v);
          c = toSRGB(c);
          // Grain, finest in the dark.
          float gr = texture2D(uNoise, vUv * uRes / 256.0 + fract(uTime * vec2(7.31, 3.17))).b - 0.5;
          c += gr * (0.035 + 0.03 * (1.0 - l));
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    function pass(mat, target) {
      quad.material = mat;
      renderer.setRenderTarget(target);
      renderer.render(postScene, postCam);
    }

    // The mirror camera for the water, after three's own Reflector.
    const _rp = new THREE.Plane(), _rn = V3(0, 1, 0), _rw = V3(), _cw = V3(), _rot = new THREE.Matrix4(), _look = V3(), _view = V3(), _tgt = V3(), _q4 = new THREE.Vector4(), _clip = new THREE.Vector4();
    function updateReflection() {
      _rw.set(0, WATER_Y, 0);
      _cw.setFromMatrixPosition(camera.matrixWorld);
      _rot.extractRotation(camera.matrixWorld);
      _view.subVectors(_rw, _cw);
      if (_view.dot(_rn) > 0) return false;
      _view.reflect(_rn).negate().add(_rw);
      _look.set(0, 0, -1).applyMatrix4(_rot).add(_cw);
      _tgt.subVectors(_rw, _look).reflect(_rn).negate().add(_rw);
      reflCam.position.copy(_view);
      reflCam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_rn);
      reflCam.lookAt(_tgt);
      reflCam.far = camera.far;
      reflCam.updateMatrixWorld();
      reflCam.projectionMatrix.copy(camera.projectionMatrix);
      reflTexMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      reflTexMat.multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
      _rp.setFromNormalAndCoplanarPoint(_rn, _rw).applyMatrix4(reflCam.matrixWorldInverse);
      _clip.set(_rp.normal.x, _rp.normal.y, _rp.normal.z, _rp.constant);
      const e = reflCam.projectionMatrix.elements;
      _q4.x = (Math.sign(_clip.x) + e[8]) / e[0];
      _q4.y = (Math.sign(_clip.y) + e[9]) / e[5];
      _q4.z = -1;
      _q4.w = (1 + e[10]) / e[14];
      _clip.multiplyScalar(2 / _clip.dot(_q4));
      e[2] = _clip.x; e[6] = _clip.y; e[10] = _clip.z + 1 - 0.003; e[14] = _clip.w;
      return true;
    }

    // Resolution follows the frame rate; the reflection runs at half of it.
    const gfx = { dpr: Math.min(ctx.dpr || 1, 1.5), min: 0.6, ema: 16.7, slow: 0, fast: 0, last: 0, refl: 0.5, w: 1, h: 1, reflEvery: 1, frame: 0 };
    function resize() {
      const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
      renderer.setPixelRatio(1);
      renderer.setSize(Math.round(w * gfx.dpr), Math.round(h * gfx.dpr), false);
      const W = Math.round(w * gfx.dpr), H = Math.round(h * gfx.dpr);
      gfx.w = W; gfx.h = H;
      sceneRT.setSize(W, H);
      reflRT.setSize(Math.max(2, Math.round(W * gfx.refl)), Math.max(2, Math.round(H * gfx.refl)));
      let bw = W >> 1, bh = H >> 1;
      for (let i = 0; i < BLOOM_LEVELS; i++) { bloomRT[i].setSize(Math.max(2, bw), Math.max(2, bh)); bw >>= 1; bh >>= 1; }
      godRT.setSize(Math.max(2, W >> 2), Math.max(2, H >> 2));
      mGod.uniforms.uAspect.value = W / H;
      camera.aspect = w / h;
      camera.fov = w / h < 0.75 ? 74 : 66;
      camera.updateProjectionMatrix();
      mFinal.uniforms.uRes.value.set(W, H);
      const scale = H / (2 * Math.tan((camera.fov * Math.PI) / 360));
      flyMat.uniforms.uScale.value = scale;
    }

    const hideInReflection = [];
    const _mv = V3(), _fw = V3();
    function drawFrame() {
      SHARED.uMoonDir.value.copy(LOOK.moonDir);
      camera.updateMatrixWorld();
      if (world.sky) world.sky.position.copy(camera.position);
      // 1. The mirror.
      if (world.water) world.water.visible = false;
      for (const o of hideInReflection) o.visible = false;
      // On a struggling phone the mirror is redrawn every other frame.
      gfx.frame++;
      if (gfx.frame % gfx.reflEvery === 0 && updateReflection()) {
        renderer.setRenderTarget(reflRT);
        renderer.clear();
        renderer.render(scene, reflCam);
      }
      if (world.water) world.water.visible = true;
      for (const o of hideInReflection) o.visible = true;
      // 2. The scene.
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      // 3. Bloom: bright pass, down the chain, back up.
      mBright.uniforms.uSrc.value = sceneRT.texture;
      mBright.uniforms.uTexel.value.set(1 / gfx.w, 1 / gfx.h);
      pass(mBright, bloomRT[0]);
      for (let i = 1; i < BLOOM_LEVELS; i++) {
        mDown.uniforms.uSrc.value = bloomRT[i - 1].texture;
        mDown.uniforms.uTexel.value.set(1 / bloomRT[i - 1].width, 1 / bloomRT[i - 1].height);
        pass(mDown, bloomRT[i]);
      }
      // Moon shafts, from the pure bright pass before the up-chain adds into it.
      _mv.copy(LOOK.moonDir).multiplyScalar(500).add(camera.position).project(camera);
      _fw.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const facing = smooth(0.15, 0.55, _fw.dot(LOOK.moonDir)) * (1 - smooth(1.1, 1.6, Math.max(Math.abs(_mv.x), Math.abs(_mv.y))));
      mFinal.uniforms.uGodK.value = facing * 0.5 * (1 - weather.rain * 0.8);
      if (facing > 0.01) {
        mGod.uniforms.uSrc.value = bloomRT[1].texture;
        mGod.uniforms.uMoon.value.set(_mv.x * 0.5 + 0.5, _mv.y * 0.5 + 0.5);
        pass(mGod, godRT);
      }
      for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
        mUp.uniforms.uSrc.value = bloomRT[i].texture;
        mUp.uniforms.uTexel.value.set(1 / bloomRT[i].width, 1 / bloomRT[i].height);
        pass(mUp, bloomRT[i - 1]);
      }
      // 4. Grade to the screen.
      mFinal.uniforms.uScene.value = sceneRT.texture;
      mFinal.uniforms.uBloom.value = bloomRT[0].texture;
      pass(mFinal, null);
    }
    // Weathered planks, by world position, with per-part tone in the vertex colour.
    const woodMat = swampify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }), {
      key: "wood", vHead: "varying vec3 vSNormal;\n", vBegin: "vSNormal = normal;", fHead: "varying vec3 vSNormal;\n",
      fMap: /* glsl */`
        {
          vec3 P = vSWorld;
          vec3 An = abs(normalize(vSNormal));
          vec2 uv = An.y > 0.5 ? P.xz : (An.x > 0.5 ? P.zy : P.xy);
          float plank = floor(uv.y * 4.0);
          float grain = texture2D(uNoise, vec2(uv.x * 0.15 + plank * 0.37, uv.y * 3.5)).b;
          float n = texture2D(uNoise, uv * 0.12).r;
          vec3 c = mix(vec3(0.13, 0.095, 0.062), vec3(0.26, 0.19, 0.12), grain * 0.7 + n * 0.3);
          c *= 0.75 + 0.25 * fract(sin(plank * 12.9898) * 43758.5453);
          float gap = smoothstep(0.03, 0.0, abs(fract(uv.y * 4.0) - 0.5) - 0.47);
          c *= 1.0 - gap * 0.6;
          c *= vColor;
          c = mix(c, c * vec3(0.55, 0.65, 0.5), 1.0 - smoothstep(0.0, 1.2, P.y));
          diffuseColor.rgb = c;
        }
      `
    });
    function mergeGeoms(list) {
      let count = 0, icount = 0;
      for (const g of list) { count += g.attributes.position.count; icount += g.index.count; }
      const P = new Float32Array(count * 3), N = new Float32Array(count * 3), C = new Float32Array(count * 3), I = new Uint32Array(icount);
      let o = 0, oi = 0;
      for (const g of list) {
        P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3);
        for (let k = 0; k < g.index.count; k++) I[oi + k] = g.index.array[k] + o;
        o += g.attributes.position.count; oi += g.index.count;
      }
      const m = new THREE.BufferGeometry();
      m.setAttribute("position", new THREE.BufferAttribute(P, 3));
      m.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      m.setAttribute("color", new THREE.BufferAttribute(C, 3));
      m.setIndex(new THREE.BufferAttribute(I, 1));
      m.computeBoundingSphere();
      return m;
    }

    /* ================================================================ *
     * THE PLACES
     * The swamp is the same every night, so it can be learned. Its
     * landmarks sit on islands stamped into the noise; deep channels
     * run between them -- the Listener's roads.
     * ================================================================ */
    const POI = {
      landing: { x: 128, z: 216, name: "The Landing", icon: "camp" },
      camp: { x: 158, z: 184, name: "Fishing Camp", icon: "bench" },
      village: { x: 196, z: 92, name: "Stilt Village", icon: "hut" },
      chapel: { x: 60, z: 76, name: "Drowned Chapel", icon: "bell" },
      tower: { x: 122, z: 128, name: "Watchtower", icon: "tower" },
      barge: { x: 72, z: 152, name: "Sunken Barge", icon: "boat" },
      pump: { x: 214, z: 160, name: "Pumphouse", icon: "gear" },
      grove: { x: 128, z: 46, name: "Cypress Grove", icon: "tree" },
      hermit: { x: 42, z: 202, name: "Hermit's Shack", icon: "hut" },
      boathouse: { x: 206, z: 224, name: "Boathouse", icon: "boat" }
    };
    const CHANNELS = [
      { w: 7.5, d: -2.1, pts: [[8, 118], [44, 124], [70, 136], [96, 162], [128, 166], [150, 150], [176, 136], [210, 128], [250, 116]] },
      { w: 6.5, d: -1.9, pts: [[120, 70], [146, 92], [160, 120], [178, 150], [196, 176], [222, 196], [250, 206]] },
      { w: 5.5, d: -1.7, pts: [[36, 40], [52, 100], [40, 150], [30, 180]] },
      // Into the southern lagoon, and on to the boathouse: no water is out of its reach.
      { w: 5, d: -1.6, pts: [[112, 156], [110, 172], [104, 190], [96, 200]] },
      { w: 4.5, d: -1.5, pts: [[170, 226], [186, 229], [200, 228]] },
      // The old canal: the one way out by water, south through the dead trees.
      { w: 4.5, d: -1.7, pts: [[162, 229], [154, 238], [151, 248], [150, 262]] }
    ];
    function segDist(px, pz, ax, az, bx, bz) {
      const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
      const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
      return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
    }
    function stampWorld(sw) {
      const h = sw.h;
      const nz = latticeNoise(sw.seed + 77);
      const island = (cx, cz, r, top, rough) => {
        for (let j = Math.max(0, Math.floor((cz - r * 1.5) / RES)); j <= Math.min(NV - 1, Math.ceil((cz + r * 1.5) / RES)); j++)
          for (let i = Math.max(0, Math.floor((cx - r * 1.5) / RES)); i <= Math.min(NV - 1, Math.ceil((cx + r * 1.5) / RES)); i++) {
            const x = i * RES, z = j * RES, d = Math.hypot(x - cx, z - cz);
            const wob = (nz(x / 7, z / 7) - 0.5) * r * 0.35;
            const k = smooth(r * 1.35, r * 0.55, d + wob);
            if (k <= 0) continue;
            const target = top - (d / r) * (d / r) * top * 0.35 + (nz(x / 3, z / 3) - 0.5) * (rough || 0.12);
            const k2 = k * k * (3 - 2 * k);
            h[j * NV + i] = Math.max(h[j * NV + i] * (1 - k2), lerp(h[j * NV + i], target, k2));
          }
      };
      const pool = (cx, cz, r, depth) => {
        for (let j = Math.max(0, Math.floor((cz - r * 1.4) / RES)); j <= Math.min(NV - 1, Math.ceil((cz + r * 1.4) / RES)); j++)
          for (let i = Math.max(0, Math.floor((cx - r * 1.4) / RES)); i <= Math.min(NV - 1, Math.ceil((cx + r * 1.4) / RES)); i++) {
            const x = i * RES, z = j * RES, d = Math.hypot(x - cx, z - cz);
            const k = smooth(r * 1.3, r * 0.6, d + (nz(x / 6, z / 6) - 0.5) * r * 0.3);
            if (k > 0) h[j * NV + i] = Math.min(h[j * NV + i], lerp(h[j * NV + i], depth, k));
          }
      };
      // Channels first, so islands can sit on their banks.
      for (const c of CHANNELS) {
        for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
          const x = i * RES, z = j * RES;
          let d = 1e9;
          for (let k = 0; k < c.pts.length - 1; k++) d = Math.min(d, segDist(x, z, c.pts[k][0], c.pts[k][1], c.pts[k + 1][0], c.pts[k + 1][1]));
          const w = c.w * (0.8 + nz(x / 20, z / 20) * 0.5);
          const k = smooth(w * 1.4, w * 0.5, d);
          if (k > 0) h[j * NV + i] = Math.min(h[j * NV + i], lerp(h[j * NV + i], c.d, k));
        }
      }
      pool(POI.barge.x, POI.barge.z, 20, -2.4);
      pool(POI.village.x, POI.village.z, 22, -0.95);
      pool(POI.boathouse.x, POI.boathouse.z + 4, 12, -1.3);
      island(POI.landing.x, POI.landing.z, 10, 0.5);
      island(POI.camp.x, POI.camp.z, 13, 0.6);
      island(POI.village.x - 4, POI.village.z + 16, 5, 0.42);
      island(POI.chapel.x - 4, POI.chapel.z, 15, 0.8);
      island(POI.tower.x, POI.tower.z, 11, 1.7, 0.2);
      island(POI.pump.x, POI.pump.z, 9, 0.6);
      island(POI.hermit.x, POI.hermit.z, 11, 0.85);
      island(POI.boathouse.x, POI.boathouse.z - 13, 7, 0.45);
      // The grove: wide, low ground, half drowned.
      for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
        const x = i * RES, z = j * RES, d = Math.hypot((x - POI.grove.x) / 1.4, z - POI.grove.z);
        const k = smooth(34, 18, d);
        if (k > 0) h[j * NV + i] = lerp(h[j * NV + i], 0.12 + (nz(x / 5, z / 5) - 0.5) * 0.9, k);
      }
      // Stepping stones of land between the landing and the camp road.
      island(140, 202, 3.2, 0.35);
      island(112, 196, 4, 0.4);
    }

    /* ================================================================ *
     * BUILDING
     * Every structure is boxes and cylinders in a local frame, merged
     * into one mesh per material; each solid part also leaves behind a
     * collider, so what you see is what you stand on.
     * ================================================================ */
    const BUILD = { geoms: { wood: [], stone: [], tin: [], cloth: [], dark: [] }, colliders: [], ladders: [], lamps: [], windows: [], interact: [], anchors: {}, nogo: [] };
    function frameAt(x, z, rot, y) {
      const c = Math.cos(rot), s = Math.sin(rot);
      return { x, z, y: y || 0, rot, c, s, p: (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c] };
    }
    function toned(g, tone) {
      const n = g.attributes.position.count, c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const t = tone * (0.92 + ((i * 7) % 5) * 0.02); c[i * 3] = t; c[i * 3 + 1] = t; c[i * 3 + 2] = t; }
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      if (!g.index) g.setIndex([...Array(n).keys()]);
      return g;
    }
    // A box at local (lx, ly, lz) of size (sx, sy, sz); o.rot turns it on
    // the spot, o.rx / o.rz tip it (roofs, braces, a listing hull).
    function box(F, mat, lx, ly, lz, sx, sy, sz, o) {
      o = o || {};
      const g = toned(new THREE.BoxGeometry(sx, sy, sz), o.tone || 1);
      if (o.rx) g.rotateX(o.rx);
      if (o.rz) g.rotateZ(o.rz);
      g.rotateY(F.rot + (o.rot || 0));
      const [wx, wz] = F.p(lx, lz);
      const wy = F.y + ly;
      g.translate(wx, wy, wz);
      BUILD.geoms[mat].push(g);
      if (o.solid !== false && !o.rx && !o.rz) {
        BUILD.colliders.push({ x: wx, z: wz, hx: sx / 2, hz: sz / 2, rot: F.rot + (o.rot || 0), y0: wy - sy / 2, y1: wy + sy / 2, floor: !!o.floor });
      } else if (o.collide) {
        // Tipped parts can still leave a flat collider of their own.
        const c = o.collide;
        BUILD.colliders.push({ x: wx, z: wz, hx: c.hx, hz: c.hz, rot: F.rot + (o.rot || 0), y0: wy + c.y0, y1: wy + c.y1, floor: !!c.floor });
      }
      return [wx, wy, wz];
    }
    function cyl(F, mat, lx, ly, lz, r0, r1, len, o) {
      o = o || {};
      const g = toned(new THREE.CylinderGeometry(r1, r0, len, o.seg || 8, 1, !!o.open), o.tone || 1);
      if (o.rx) g.rotateX(o.rx);
      if (o.rz) g.rotateZ(o.rz);
      g.rotateY(F.rot + (o.rot || 0));
      const [wx, wz] = F.p(lx, lz);
      g.translate(wx, F.y + ly, wz);
      BUILD.geoms[mat].push(g);
      if (o.post) BUILD.colliders.push({ x: wx, z: wz, hx: Math.max(r0, r1), hz: Math.max(r0, r1), rot: 0, y0: F.y + ly - len / 2, y1: F.y + ly + len / 2, floor: false, round: true });
    }
    function lampAt(F, lx, ly, lz, o) {
      const [wx, wz] = F.p(lx, lz);
      BUILD.lamps.push({ x: wx, y: F.y + ly, z: wz, k: (o && o.k) || 1, flick: Math.random() * 10, gen: !!(o && o.gen), until: 0 });
    }
    function windowAt(F, lx, ly, lz, w, h, rot) {
      const [wx, wz] = F.p(lx, lz);
      BUILD.windows.push({ x: wx, y: F.y + ly, z: wz, w, h, rot: F.rot + (rot || 0) });
    }
    function anchor(name, F, lx, ly, lz, extra) {
      const [wx, wz] = F.p(lx, lz);
      (BUILD.anchors[name] = BUILD.anchors[name] || []).push(Object.assign({ x: wx, y: F.y + ly, z: wz }, extra || {}));
    }
    function ladder(F, lx, lz, y0, y1, face) {
      // Two rails and rungs. `face` is the side you climb from (0 = local +z).
      const rot = face;
      for (const side of [-0.24, 0.24]) {
        const [px, pz] = [lx + Math.cos(face) * side, lz - Math.sin(face) * side];
        box(F, "wood", px, (y0 + y1) / 2, pz, 0.07, y1 - y0, 0.07, { rot, tone: 0.8, solid: false });
      }
      for (let y = y0 + 0.3; y < y1; y += 0.32) box(F, "wood", lx, y, lz, 0.5, 0.05, 0.06, { rot, tone: 0.9, solid: false });
      const [wx, wz] = F.p(lx, lz);
      const fa = F.rot + face;
      BUILD.ladders.push({ x: wx, z: wz, y0: F.y + y0, y1: F.y + y1, nx: Math.sin(fa), nz: Math.cos(fa) });
    }
    // A plank walk from one local point to another at deck height y, with
    // posts down into the mud and, where `gaps` says, planks missing.
    function walk(F, x0, z0, x1, z1, y, o) {
      o = o || {};
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
      const width = o.width || 1.5;
      const n = Math.floor(len / 0.3);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        if (o.gaps && o.gaps.some(([a, b]) => t > a && t < b)) continue;
        const px = lerp(x0, x1, t), pz = lerp(z0, z1, t);
        const sag = (k % 9 === 4) ? 0.05 : 0;
        box(F, "wood", px, y - 0.03 - sag, pz, width, 0.06, 0.27, { rot: ang, tone: 0.72 + ((k * 7) % 5) * 0.07, floor: true });
      }
      // Stringers and posts.
      const posts = Math.max(1, Math.round(len / 2.4));
      for (let k = 0; k <= posts; k++) {
        const t = k / posts;
        if (o.gaps && o.gaps.some(([a, b]) => t > a + 0.02 && t < b - 0.02)) continue;
        for (const side of [-width / 2 + 0.08, width / 2 - 0.08]) {
          const px = lerp(x0, x1, t) + Math.cos(ang) * side, pz = lerp(z0, z1, t) - Math.sin(ang) * side;
          cyl(F, "wood", px, y - 1.4, pz, 0.08, 0.07, 2.8, { tone: 0.6, post: true });
        }
      }
      // Lanterns on posts, every so often, on alternate sides.
      if (o.lamps) {
        const m = Math.max(1, Math.floor(len / o.lamps));
        for (let k = 0; k < m; k++) {
          const t = (k + 0.5) / m;
          if (o.gaps && o.gaps.some(([a, b]) => t > a - 0.06 && t < b + 0.06)) continue;
          const side = (k % 2 ? 1 : -1) * (width / 2 + 0.08);
          const px = lerp(x0, x1, t) + Math.cos(ang) * side, pz = lerp(z0, z1, t) - Math.sin(ang) * side;
          cyl(F, "wood", px, y + 0.85, pz, 0.05, 0.045, 1.75, { tone: 0.6, post: true });
          box(F, "wood", px - Math.cos(ang) * side * 0.12, y + 1.66, pz + Math.sin(ang) * side * 0.12, 0.05, 0.05, 0.35, { rot: ang + Math.PI / 2, tone: 0.6, solid: false });
          lampAt(F, px - Math.cos(ang) * side * 0.2, y + 1.48, pz + Math.sin(ang) * side * 0.2, { k: 0.75 });
        }
      }
      if (o.rail) for (const side of [-width / 2, width / 2]) {
        const mx = (x0 + x1) / 2 + Math.cos(ang) * side, mz = (z0 + z1) / 2 - Math.sin(ang) * side;
        box(F, "wood", mx, y + 0.9, mz, 0.06, 0.06, len, { rot: ang, tone: 0.65, solid: false });
      }
    }
    // A shack: floor at y, door in the +z wall, a window in +x, tin roof.
    function shack(F, w, d, y, o) {
      o = o || {};
      const H = o.h || 2.4, t = 0.12;
      box(F, "wood", 0, y - 0.07, 0, w + 0.4, 0.14, d + 0.4, { floor: true, tone: 0.85 });
      box(F, "wood", 0, y + H / 2, -d / 2, w, H, t, { tone: 0.95 });
      box(F, "wood", -w / 2, y + H / 2, 0, t, H, d, { tone: 0.88 });
      // Right wall with a window hole.
      box(F, "wood", w / 2, y + 0.5, 0, t, 1.0, d, { tone: 0.88 });
      box(F, "wood", w / 2, y + H - 0.35, 0, t, 0.7, d, { tone: 0.88 });
      box(F, "wood", w / 2, y + 1.35, -d / 2 + (d / 2 - 0.55) / 2, t, 0.7, d / 2 - 0.55, { tone: 0.88 });
      box(F, "wood", w / 2, y + 1.35, d / 2 - (d / 2 - 0.55) / 2, t, 0.7, d / 2 - 0.55, { tone: 0.88 });
      if (!o.dark) windowAt(F, w / 2 + 0.07, y + 1.35, 0, 1.0, 0.6, Math.PI / 2);
      // Front wall with a doorway.
      const dw = 1.0;
      box(F, "wood", -(w / 2 + dw / 2) / 2 - dw / 4, y + H / 2, d / 2, w / 2 - dw / 2, H, t, { tone: 0.92 });
      box(F, "wood", (w / 2 + dw / 2) / 2 + dw / 4, y + H / 2, d / 2, w / 2 - dw / 2, H, t, { tone: 0.92 });
      box(F, "wood", 0, y + H - 0.25, d / 2, dw, 0.5, t, { tone: 0.92 });
      // A pitched tin roof, and a flat collider under it for heads.
      const slope = 0.32, half = w / 2 + 0.45;
      box(F, "tin", -half / 2, y + H + 0.18 + Math.tan(slope) * half / 2, 0, half / Math.cos(slope) + 0.05, 0.05, d + 0.9, { rz: slope, solid: false, collide: { hx: half / 2, hz: d / 2 + 0.4, y0: -0.2, y1: 0.0 } });
      box(F, "tin", half / 2, y + H + 0.18 + Math.tan(slope) * half / 2, 0, half / Math.cos(slope) + 0.05, 0.05, d + 0.9, { rz: -slope, solid: false, collide: { hx: half / 2, hz: d / 2 + 0.4, y0: -0.2, y1: 0.0 } });
      if (o.stilts) for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, -d / 2], [0, d / 2]]) cyl(F, "wood", px, (y - 2.5) / 2 - 0.1, pz, 0.12, 0.1, y + 2.6, { tone: 0.6, post: true });
      if (o.porch) {
        box(F, "wood", 0, y - 0.07, d / 2 + 0.9, w * 0.7, 0.12, 1.6, { floor: true, tone: 0.8 });
        lampAt(F, w * 0.3, y + 1.9, d / 2 + 1.55);
        cyl(F, "wood", w * 0.3, y + 0.9, d / 2 + 1.6, 0.05, 0.05, 1.8, { tone: 0.7 });
      }
    }

    /* ---- the places, one by one ---- */
    function buildPlaces(sw) {
      const H = (x, z) => heightAt(sw, x, z);
      // The Landing: where you wake. A lean-to, a canoe stove in, a crate of ducks.
      {
        const P = POI.landing, F = frameAt(P.x, P.z, 0.4, H(P.x, P.z));
        box(F, "cloth", 0, 1.3, -0.4, 3.2, 0.06, 2.4, { rx: 0.55, solid: false });
        cyl(F, "wood", -1.5, 0.75, 0.5, 0.05, 0.05, 1.6, { tone: 0.7 });
        cyl(F, "wood", 1.5, 0.75, 0.5, 0.05, 0.05, 1.6, { tone: 0.7 });
        box(F, "wood", 0.4, 0.25, -0.6, 0.9, 0.5, 0.6, { tone: 0.8 });
        lampAt(F, 1.5, 1.7, 0.5);
        anchor("ducks", F, -0.6, 0.35, -0.9);
        anchor("start", F, 0.6, 0, 2.2);
        // The canoe, half in the water.
        const Fc = frameAt(P.x - 5, P.z + 6, 1.1, H(P.x - 5, P.z + 6) - 0.1);
        box(Fc, "wood", 0, 0.12, 0, 0.8, 0.25, 4.2, { rz: 0.25, solid: false, tone: 0.6 });
        box(Fc, "wood", 0.35, 0.3, 0, 0.08, 0.35, 4, { rz: 0.25, solid: false, tone: 0.55 });
        box(Fc, "wood", -0.35, 0.3, 0, 0.08, 0.35, 4, { rz: 0.25, solid: false, tone: 0.55 });
        // The first page lies a few steps up the path, where you will see it.
        {
          const [sx, sz] = F.p(0.6, 2.2), dx = POI.camp.x - sx, dz = POI.camp.z - sz, L = Math.hypot(dx, dz);
          const nx = sx + dx / L * 3.2, nz = sz + dz / L * 3.2;
          anchor("note", frameAt(nx, nz, 0, H(nx, nz)), 0, 0.22, 0, { page: 1 });
        }
      }
      // The boardwalk from the Landing to the camp.
      walk(frameAt(0, 0, 0), 133, 208, 150, 192, 0.55, { rail: false, lamps: 12 });
      // The long walk west over the lagoon to the hermit, rotten in places.
      {
        const W0 = frameAt(0, 0, 0);
        walk(W0, 117, 214, 86, 209, 0.5, { gaps: [[0.55, 0.65]], lamps: 15 });
        box(W0, "wood", 86, 0.44, 209, 3.2, 0.12, 3.2, { floor: true, tone: 0.8 });
        for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) cyl(W0, "wood", 86 + dx, -0.9, 209 + dz, 0.1, 0.09, 2.8, { tone: 0.6, post: true });
        lampAt(W0, 86, 1.9, 209, { k: 0.9 });
        cyl(W0, "wood", 86, 1.15, 209, 0.06, 0.05, 1.5, { tone: 0.6, post: true });
        walk(W0, 86, 209, 55, 204, 0.5, { gaps: [[0.3, 0.385]], lamps: 15 });
      }
      // East from the camp to the pumphouse, over the deep channel -- the
      // middle of it long gone.
      walk(frameAt(0, 0, 0), 178, 175, 205, 163, 0.5, { gaps: [[0.45, 0.56]], lamps: 13 });
      // North from the watchtower's island to the stilt village.
      walk(frameAt(0, 0, 0), 144, 119, 186.05, 90.3, 0.5, { gaps: [[0.18, 0.245], [0.6, 0.66]], lamps: 15 });
      // Over the head of the channel to the cypress grove.
      walk(frameAt(0, 0, 0), 124, 87, 127, 64, 0.5, { gaps: [[0.43, 0.565]], lamps: 11 });
      // Fishing Camp: the workbench, racks, a jetty, a shack.
      {
        const P = POI.camp, F = frameAt(P.x, P.z, -0.5, H(P.x, P.z));
        shack(F, 4.4, 3.6, 0.5, { porch: true });
        // Workbench under an awning.
        const Fb = frameAt(...F.p(-4.6, 2.4), F.rot + 0.3, F.y);
        box(Fb, "wood", 0, 0.92, 0, 2.2, 0.08, 0.9, { tone: 0.9 });
        for (const [lx, lz] of [[-1, -0.38], [1, -0.38], [-1, 0.38], [1, 0.38]]) box(Fb, "wood", lx, 0.45, lz, 0.08, 0.9, 0.08, { tone: 0.7, solid: false });
        box(Fb, "dark", -0.6, 1.02, 0.1, 0.35, 0.12, 0.2, { solid: false });
        box(Fb, "dark", 0.5, 1.0, -0.15, 0.5, 0.06, 0.12, { solid: false });
        box(Fb, "cloth", 0, 2.3, 0.1, 3, 0.05, 2.2, { rx: -0.2, solid: false });
        for (const [lx, lz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 1.1], [1.4, 1.1]]) cyl(Fb, "wood", lx, 1.15, lz, 0.05, 0.05, 2.3, { tone: 0.7, post: true });
        lampAt(Fb, 1.3, 2.0, 1.1);
        const [bx, bz] = Fb.p(0, 0);
        BUILD.interact.push({ kind: "bench", x: bx, y: Fb.y + 1, z: bz, r: 2.4 });
        anchor("ducks", Fb, -1.8, 0.35, -0.2);
        anchor("note", Fb, 0.3, 1.0, 0.1, { page: 2 });
        // Drying racks with nets.
        const Fr = frameAt(...F.p(3.5, -4), F.rot - 0.2, F.y);
        for (const lx of [-1.4, 0, 1.4]) cyl(Fr, "wood", lx, 0.9, 0, 0.05, 0.05, 1.8, { tone: 0.7, post: true });
        box(Fr, "wood", 0, 1.7, 0, 3, 0.05, 0.05, { solid: false });
        box(Fr, "cloth", 0, 1.2, 0.02, 2.8, 1.0, 0.02, { solid: false, tone: 0.6 });
        // A jetty out into the channel.
        walk(F, 2, 6, 3, 14, 0.5, {});
        anchor("coil", F, 3.1, 0.75, 13.5);
      }
      // The camp road north to the watchtower: rotten, with gaps.
      walk(frameAt(0, 0, 0), 156, 170, 146, 152, 0.55, { gaps: [[0.44, 0.6]], lamps: 10 });
      walk(frameAt(0, 0, 0), 146, 152, 131, 136, 0.55, { gaps: [[0.2, 0.3], [0.7, 0.79]] });
      // Watchtower: four legs, braces, a ladder, a platform with a roof.
      {
        const P = POI.tower, F = frameAt(P.x, P.z, 0.15, H(P.x, P.z));
        const top = 8.6, half = 1.7;
        for (const [lx, lz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) cyl(F, "wood", lx, top / 2 - 0.4, lz, 0.14, 0.11, top + 0.8, { tone: 0.65, post: true });
        for (let y = 1.6; y < top; y += 2.4) {
          box(F, "wood", 0, y, -half, half * 2, 0.08, 0.08, { tone: 0.6, solid: false });
          box(F, "wood", 0, y, half, half * 2, 0.08, 0.08, { tone: 0.6, solid: false });
          box(F, "wood", -half, y, 0, 0.08, 0.08, half * 2, { tone: 0.6, solid: false });
          box(F, "wood", half, y, 0, 0.08, 0.08, half * 2, { tone: 0.6, solid: false });
        }
        box(F, "wood", 0, top, 0, half * 2 + 0.6, 0.14, half * 2 + 0.6, { floor: true, tone: 0.85 });
        for (const s of [-1, 1]) {
          box(F, "wood", 0, top + 0.55, s * (half + 0.3), half * 2 + 0.6, 0.06, 0.06, { tone: 0.7 });
          box(F, "wood", s * (half + 0.3), top + 0.55, 0.4, 0.06, 0.06, half * 2 - 0.2, { tone: 0.7 });
        }
        for (const [lx, lz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) cyl(F, "wood", lx, top + 1.2, lz, 0.06, 0.06, 2.4, { tone: 0.65 });
        box(F, "tin", 0, top + 2.45, 0, half * 2 + 1.2, 0.06, half * 2 + 1.2, { tone: 0.7, collide: { hx: half + 0.6, hz: half + 0.6, y0: -0.05, y1: 0.05 }, solid: false });
        ladder(F, 0, half + 0.3, 0, top + 0.1, 0);
        anchor("towertop", F, 0, top + 0.07, 0);
        anchor("note", F, 0.7, top + 0.12, 0.8, { page: 3 });
        lampAt(F, half - 0.2, top + 1.6, -half + 0.2);
        anchor("part", F, -0.6, top + 0.35, -0.6);
      }
      // The broken walk from the tower west toward the barge.
      walk(frameAt(0, 0, 0), 111, 132, 96, 140, 0.5, { gaps: [[0.3, 0.55]] });
      // Sunken Barge: a long hull listing in the lagoon, its stern cabin above water.
      {
        const P = POI.barge, F = frameAt(P.x, P.z, 1.15, -0.6);
        const L = 17, Wd = 5.4;
        box(F, "wood", 0, 0.1, 0, Wd, 0.3, L, { rx: -0.06, tone: 0.55, solid: false, collide: { hx: Wd / 2, hz: L / 2, y0: 0.1, y1: 0.3, floor: true } });
        for (const s of [-1, 1]) box(F, "wood", s * Wd / 2, 0.9, 0, 0.25, 1.9, L, { rx: -0.06, tone: 0.5, solid: false, collide: { hx: 0.15, hz: L / 2, y0: -0.8, y1: 1.0 } });
        box(F, "wood", 0, 0.9, -L / 2, Wd, 1.9, 0.25, { tone: 0.5 });
        // The stern cabin, tilted with the hull.
        box(F, "wood", 0, 1.6, L / 2 - 2.5, 3.6, 0.12, 3.4, { tone: 0.75, floor: true });
        box(F, "wood", 0, 2.8, L / 2 - 4.15, 3.6, 2.4, 0.12, { tone: 0.65 });
        box(F, "wood", -1.8, 2.8, L / 2 - 2.5, 0.12, 2.4, 3.4, { tone: 0.6 });
        box(F, "wood", 1.8, 2.8, L / 2 - 1.4, 0.12, 2.4, 1.2, { tone: 0.6 });
        box(F, "tin", 0, 4.05, L / 2 - 2.5, 4.2, 0.06, 4, { tone: 0.6, collide: { hx: 2.1, hz: 2, y0: -0.05, y1: 0.05 }, solid: false });
        ladder(F, Wd / 2 + 0.25, L / 2 - 3.6, -0.9, 1.65, Math.PI / 2);
        lampAt(F, 1.6, 3.4, L / 2 - 1.0, { k: 0.7 });
        anchor("rocket", F, -0.8, 1.9, L / 2 - 3.2);
        anchor("rocket", F, 0.6, 1.9, L / 2 - 3.4);
        anchor("note", F, 0.9, 1.75, L / 2 - 1.8, { page: 4 });
        anchor("part", F, 0, 0.55, -L / 2 + 3);
      }
      // Stilt Village: three huts over the water, walks between, ladders down.
      {
        const P = POI.village;
        const huts = [[P.x - 10, P.z - 6, 0.3], [P.x + 6, P.z - 12, -0.4], [P.x + 10, P.z + 6, 1.2]];
        const decks = [];
        huts.forEach(([x, z, r], k) => {
          const F = frameAt(x, z, r, 0);
          shack(F, 4, 3.4, 2.2, { stilts: true, porch: true, dark: k === 1 });
          ladder(F, -0.9, 3.4 + 0.25, -1.1, 2.15, 0);
          decks.push(F.p(0, 3.4));
          anchor(k === 0 ? "coil" : k === 1 ? "part" : "ducks", F, k === 2 ? -1.2 : 0.8, 2.2 + 0.4, -0.6);
        });
        walk(frameAt(0, 0, 0), decks[0][0], decks[0][1], decks[1][0], decks[1][1], 2.15, { rail: true, width: 1.2 });
        walk(frameAt(0, 0, 0), decks[1][0], decks[1][1], decks[2][0], decks[2][1], 2.15, { rail: true, width: 1.2, gaps: [[0.45, 0.6]] });
        anchor("rocket", frameAt(P.x - 4, P.z + 16, 0, heightAt(sw, P.x - 4, P.z + 16)), 0, 0.4, 0);
      }
      // The Drowned Chapel: a stone nave with its east end in the water, a bell tower.
      {
        const P = POI.chapel, F = frameAt(P.x, P.z, 0.2, Math.max(0.1, H(P.x - 4, P.z)) - 0.1);
        const L = 15, Wd = 8, Hh = 4.6, t = 0.6;
        for (let k = 0; k < 5; k++) {
          const z0 = -L / 2 + k * L / 5, z1 = z0 + L / 5;
          // Side walls with tall window gaps every other bay.
          for (const s of [-1, 1]) {
            if (k % 2 === 1) {
              box(F, "stone", s * Wd / 2, 0.8, (z0 + z1) / 2, t, 1.6, L / 5, { tone: 0.9 - k * 0.04 });
              box(F, "stone", s * Wd / 2, Hh - 0.5, (z0 + z1) / 2, t, 1.0, L / 5, { tone: 0.85 });
            } else box(F, "stone", s * Wd / 2, Hh / 2, (z0 + z1) / 2, t, Hh, L / 5, { tone: 0.9 - k * 0.04 });
          }
        }
        box(F, "stone", 0, Hh / 2, -L / 2, Wd, Hh, t, { tone: 0.95 });
        // West front with a doorway.
        box(F, "stone", -Wd / 2 + 1.6, Hh / 2, L / 2, 3.2, Hh, t, { tone: 0.9 });
        box(F, "stone", Wd / 2 - 1.6, Hh / 2, L / 2, 3.2, Hh, t, { tone: 0.9 });
        box(F, "stone", 0, Hh - 0.6, L / 2, 1.6, 1.2, t, { tone: 0.9 });
        // What is left of the roof: a few beams.
        for (let k = 0; k < 5; k++) box(F, "wood", 0, Hh + 0.2, -L / 2 + 1.5 + k * 3, Wd + 0.4, 0.2, 0.25, { tone: 0.5, solid: false });
        box(F, "stone", 0, 0.05, 0, Wd - 0.4, 0.2, L - 0.4, { floor: true, tone: 0.7 });
        // The bell tower at the west end, stairs as a ladder inside.
        const Ft = frameAt(...F.p(Wd / 2 + 1.6, L / 2 - 1.6), F.rot, F.y);
        const tw = 3.2, th = 10;
        box(Ft, "stone", 0, th / 2, -tw / 2, tw, th, 0.45, { tone: 0.85 });
        box(Ft, "stone", -tw / 2, th / 2, 0, 0.45, th, tw, { tone: 0.8 });
        box(Ft, "stone", tw / 2, th / 2, 0, 0.45, th, tw, { tone: 0.8 });
        box(Ft, "stone", -tw / 4 - 0.3, th / 2 + 1.1, tw / 2, tw / 2 - 0.6, th - 2.2, 0.45, { tone: 0.85 });
        box(Ft, "stone", tw / 4 + 0.3, th / 2 + 1.1, tw / 2, tw / 2 - 0.6, th - 2.2, 0.45, { tone: 0.85 });
        box(Ft, "wood", 0, th - 1.6, 0, tw - 0.5, 0.14, tw - 0.5, { floor: true, tone: 0.7 });
        box(Ft, "stone", 0, th + 0.6, 0, tw + 0.3, 0.4, tw + 0.3, { tone: 0.75 });
        ladder(Ft, 0, -tw / 2 + 0.5, 0, th - 1.55, 0);
        // The bell.
        cyl(Ft, "dark", 0, th - 0.4, 0, 0.55, 0.28, 0.75, { seg: 14 });
        const [bx, bz] = Ft.p(0, 0);
        BUILD.interact.push({ kind: "bell", x: bx, y: Ft.y + th - 1.4, z: bz, r: 2.2 });
        lampAt(F, -Wd / 2 + 0.6, 2.4, L / 2 - 1, { k: 0.6 });
        anchor("part", Ft, 0.6, th - 1.25, 0.6);
        // Graves in the wet ground.
        for (let k = 0; k < 9; k++) {
          const gx = -Wd / 2 - 3 - (k % 3) * 2, gz = -L / 2 + 2 + Math.floor(k / 3) * 3.5;
          box(F, "stone", gx, 0.35, gz, 0.6, 0.9, 0.14, { rot: (k % 5 - 2) * 0.08, rz: (k % 3 - 1) * 0.12, tone: 0.75, solid: false });
        }
        anchor("coil", F, -Wd / 2 - 5, 0.6, -L / 2 + 6);
        anchor("note", F, 0.5, 0.35, -L / 2 + 1.6, { page: 6 });
      }
      // Pumphouse: brick, a tin roof, pipes into the channel, a generator.
      {
        const P = POI.pump, F = frameAt(P.x, P.z, -0.9, H(P.x, P.z));
        const w = 5, d = 6, hh = 3.2;
        box(F, "stone", 0, hh / 2, -d / 2, w, hh, 0.35, { tone: 0.7 });
        box(F, "stone", -w / 2, hh / 2, 0, 0.35, hh, d, { tone: 0.65 });
        box(F, "stone", w / 2, hh / 2, -1.2, 0.35, hh, d - 2.4, { tone: 0.65 });
        box(F, "stone", w / 2, hh - 0.5, 1.8, 0.35, 1.0, 2.4, { tone: 0.65 });
        box(F, "stone", 0, hh / 2, d / 2, w, hh, 0.35, { tone: 0.7 });
        box(F, "tin", 0, hh + 0.1, 0, w + 0.6, 0.08, d + 0.6, { tone: 0.6, solid: false, collide: { hx: w / 2 + 0.3, hz: d / 2 + 0.3, y0: -0.05, y1: 0.05 } });
        box(F, "stone", 0, 0.05, 0, w - 0.4, 0.1, d - 0.4, { floor: true, tone: 0.6 });
        for (const lz of [-1.4, 0.2]) cyl(F, "tin", w / 2 + 3, 0.9, lz, 0.3, 0.3, 6.5, { rz: Math.PI / 2, tone: 0.55 });
        box(F, "dark", -1.2, 0.6, -1.6, 1.4, 1.1, 1.0, { tone: 0.8 });
        const [gx, gz] = F.p(-1.2, -1.6);
        BUILD.interact.push({ kind: "generator", x: gx, y: F.y + 0.9, z: gz, r: 2.0 });
        lampAt(F, w / 2 - 0.4, 2.6, 2.3, { k: 0.5 });
        lampAt(F, -1.2, 2.7, -1.6, { k: 2.4, gen: true });
        anchor("part", F, 1.2, 0.4, -1.8);
        anchor("note", F, -1.0, 1.25, -1.45, { page: 7 });
        anchor("fuel", F, 1.5, 0.3, 1.6);
      }
      // Hermit's Shack: lanterns, junk, a fence of sticks.
      {
        const P = POI.hermit, F = frameAt(P.x, P.z, 0.7, H(P.x, P.z));
        shack(F, 4.2, 3.6, 0.4, { porch: true });
        lampAt(F, -2.8, 1.8, 3);
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 1.6 + 0.8, r = 6.5;
          cyl(F, "wood", Math.cos(a) * r, 0.6, Math.sin(a) * r, 0.04, 0.03, 1.3 + (k % 3) * 0.2, { tone: 0.55, rz: (k % 4 - 1.5) * 0.08 });
        }
        for (let k = 0; k < 4; k++) cyl(F, "dark", -2.5 + k * 0.7, 0.4, -3, 0.28, 0.28, 0.8, { seg: 10, tone: 0.7 });
        anchor("part", F, -0.8, 0.85, -0.8);
        anchor("note", F, 0.9, 0.5, -0.9, { page: 5 });
        anchor("ducks", F, 2.6, 0.35, 2.6);
      }
      // Boathouse: a long shed on stilts over open water, a dock to the shore.
      {
        const P = POI.boathouse, F = frameAt(P.x, P.z, 0, 0);
        const w = 7, d = 12, y = 0.6;
        for (const s of [-1, 1]) {
          box(F, "wood", s * (w / 2 - 0.75), y - 0.06, 0, 1.5, 0.12, d, { floor: true, tone: 0.8 });
          box(F, "wood", s * w / 2, y + 1.3, 0, 0.12, 2.6, d, { tone: 0.85 });
        }
        // The water door faces the open bay to the south; a plain door north to the dock.
        box(F, "wood", 0, y + 2.2, d / 2, w, 0.8, 0.12, { tone: 0.85 });
        box(F, "wood", 0.75, y + 1.3, -d / 2, w - 1.5, 2.6, 0.12, { tone: 0.85 });
        box(F, "wood", -2.75, y + 2.2, -d / 2, 1.5, 0.8, 0.12, { tone: 0.85 });
        box(F, "tin", 0, y + 2.75, 0, w + 0.8, 0.06, d + 0.8, { tone: 0.6, solid: false, collide: { hx: w / 2 + 0.4, hz: d / 2 + 0.4, y0: -0.05, y1: 0.05 } });
        for (let k = 0; k <= 4; k++) for (const s of [-1, 1]) cyl(F, "wood", s * w / 2, -0.8, -d / 2 + k * d / 4, 0.12, 0.1, 2.8, { tone: 0.6, post: true });
        walk(frameAt(0, 0, 0), P.x + 2.2, P.z + d / 2, P.x + 2.2, P.z + d / 2 + 0.5, y, {});
        walk(frameAt(0, 0, 0), P.x - 2.75, P.z - d / 2 - 6.5, P.x - 2.75, P.z - d / 2 + 0.1, y, { width: 1.3 });
        lampAt(F, w / 2 - 0.4, y + 2.0, -d / 2 + 0.6);
        lampAt(F, -w / 2 + 0.4, y + 2.0, d / 2 - 0.6, { k: 0.7 });
        // The boat floats in the bay (it is built apart, so that it can leave).
        {
          const [px, pz] = F.p(w / 2 - 1.3, 1.6);
          BUILD.interact.push({ kind: "boat", x: px, y: y + 1, z: pz, r: 2.6 });
          anchor("boat", F, 0, 0.1, 1);
        }
        anchor("rocket", F, w / 2 - 0.75, y + 0.25, 3);
        anchor("rocket", F, -(w / 2 - 0.75), y + 0.25, -2);
        anchor("firecracker", F, w / 2 - 0.75, y + 0.25, -4);
        anchor("note", F, -(w / 2 - 0.75), y + 0.12, 1.5, { page: 8 });
      }
      // The grove: no buildings -- a coil in the roots, a part on a stump.
      {
        const P = POI.grove;
        anchor("coil", frameAt(P.x + 6, P.z - 4, 0, Math.max(0.05, H(P.x + 6, P.z - 4))), 0, 0.45, 0);
        anchor("coil", frameAt(P.x - 14, P.z + 8, 0, Math.max(0.05, H(P.x - 14, P.z + 8))), 0, 0.45, 0);
        // Where Eli stopped: his coat, his lantern still burning, his last page, the key.
        const Fe = frameAt(P.x + 2, P.z + 12, 0.6, Math.max(0.05, H(P.x + 2, P.z + 12)));
        box(Fe, "cloth", 0, 0.06, 0, 0.7, 0.1, 1.5, { solid: false, tone: 0.55 });
        box(Fe, "dark", 0.7, 0.12, 0.6, 0.18, 0.24, 0.18, { solid: false });
        lampAt(Fe, 0.7, 0.32, 0.6, { k: 0.45 });
        anchor("note", Fe, -0.3, 0.2, -0.5, { page: 9 });
        anchor("key", Fe, 0.35, 0.2, -0.2);
      }
      anchor("coil", frameAt(POI.pump.x - 18, POI.pump.z + 10, 0, Math.max(0.05, H(POI.pump.x - 18, POI.pump.z + 10))), 0, 0.45, 0);
      // Places where no tree may stand.
      for (const k in POI) BUILD.nogo.push({ x: POI[k].x, z: POI[k].z, r: k === "grove" ? 0 : k === "barge" ? 14 : k === "village" ? 18 : 10 });
    }
    // Nothing grows in a place, or through anything built.
    function siteBlocked(x, z, pad) {
      for (const n of BUILD.nogo) if (n.r > 0 && (x - n.x) ** 2 + (z - n.z) ** 2 < (n.r + pad) ** 2) return true;
      return insideBuilt(x, z, pad);
    }

    // Materials for what people built here.
    const stoneMat = swampify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, vertexColors: true }), {
      key: "stone", vHead: "varying vec3 vSNormal;\n", vBegin: "vSNormal = normal;", fHead: "varying vec3 vSNormal;\n",
      fMap: /* glsl */`
        {
          vec3 P = vSWorld;
          vec3 An = abs(normalize(vSNormal));
          vec2 uv = An.y > 0.5 ? P.xz : (An.x > 0.5 ? P.zy : P.xy);
          vec2 b = uv * vec2(1.6, 3.2);
          b.x += floor(b.y) * 0.5;
          vec2 f = fract(b);
          float mortar = 1.0 - smoothstep(0.02, 0.06, min(min(f.x, 1.0 - f.x) / 1.6, min(f.y, 1.0 - f.y) / 3.2) * 3.2);
          float n = texture2D(uNoise, floor(b) * 0.137).r;
          vec3 c = mix(vec3(0.2, 0.19, 0.17), vec3(0.32, 0.3, 0.27), n) * (0.85 + 0.3 * texture2D(uNoise, uv * 0.7).b);
          c = mix(c, vec3(0.08, 0.075, 0.07), mortar * 0.8);
          // Moss creeping up from the water, and old wet stains.
          float mossy = (1.0 - smoothstep(0.2, 2.2, P.y + texture2D(uNoise, uv * 0.3).g * 1.2)) ;
          c = mix(c, vec3(0.06, 0.09, 0.035), mossy * 0.75);
          c *= vColor;
          diffuseColor.rgb = c;
        }
      `
    });
    const tinMat = swampify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.5, vertexColors: true, side: THREE.DoubleSide }), {
      key: "tin", vHead: "varying vec3 vSNormal;\n", vBegin: "vSNormal = normal;", fHead: "varying vec3 vSNormal;\n",
      fMap: /* glsl */`
        {
          vec3 P = vSWorld;
          float rib = sin((P.x + P.z) * 9.0) * 0.5 + 0.5;
          float rust = smoothstep(0.35, 0.75, texture2D(uNoise, P.xz * 0.35 + P.y * 0.2).r + texture2D(uNoise, P.xz * 1.7).b * 0.3);
          vec3 c = mix(vec3(0.3, 0.31, 0.3), vec3(0.23, 0.11, 0.05), rust) * (0.8 + rib * 0.25);
          diffuseColor.rgb = c * vColor;
        }
      `
    });
    const clothMat = swampify(new THREE.MeshLambertMaterial({ color: 0x3b4029, side: THREE.DoubleSide, vertexColors: true }), { key: "cloth" });
    const darkMat = swampify(new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.5, metalness: 0.4, vertexColors: true }), { key: "darkmetal" });
    const MATS = { wood: null, stone: stoneMat, tin: tinMat, cloth: clothMat, dark: darkMat };
    function finishBuild() {
      MATS.wood = woodMat;
      const group = new THREE.Group();
      for (const k in BUILD.geoms) {
        const list = BUILD.geoms[k];
        if (!list.length) continue;
        const m = new THREE.Mesh(mergeGeoms(list), MATS[k]);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
      }
      return group;
    }
    /* ================================================================ *
     * WHERE YOU CAN STAND
     * Colliders live in an 8 m grid. Anything whose top is within a step
     * of your feet is floor; anything that starts above your waist is a
     * ceiling, which only ever stops you going up -- never pushes you
     * sideways through a wall.
     * ================================================================ */
    const GRID = 8, GN = SIZE / GRID;
    const cgrid = [];
    for (let i = 0; i < GN * GN; i++) cgrid.push([]);
    function indexColliders() {
      for (const list of cgrid) list.length = 0;
      BUILD.colliders.forEach((c, i) => {
        c.c = Math.cos(c.rot); c.s = Math.sin(c.rot);
        const R = Math.hypot(c.hx, c.hz) + 0.5;
        const gx0 = Math.max(0, Math.floor((c.x - R) / GRID)), gx1 = Math.min(GN - 1, Math.floor((c.x + R) / GRID));
        const gz0 = Math.max(0, Math.floor((c.z - R) / GRID)), gz1 = Math.min(GN - 1, Math.floor((c.z + R) / GRID));
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) cgrid[gz * GN + gx].push(i);
      });
    }
    const _near = [], _seen = new Set();
    function nearColliders(x, z, r) {
      _near.length = 0; _seen.clear();
      const gx0 = Math.max(0, Math.floor((x - r) / GRID)), gx1 = Math.min(GN - 1, Math.floor((x + r) / GRID));
      const gz0 = Math.max(0, Math.floor((z - r) / GRID)), gz1 = Math.min(GN - 1, Math.floor((z + r) / GRID));
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) for (const i of cgrid[gz * GN + gx]) {
        if (_seen.has(i)) continue;
        _seen.add(i);
        _near.push(BUILD.colliders[i]);
      }
      return _near;
    }
    function localOf(c, x, z) {
      const dx = x - c.x, dz = z - c.z;
      return [dx * c.c - dz * c.s, dx * c.s + dz * c.c];
    }
    // The highest thing under (x, z) you could be standing on.
    let swamp = null;
    function groundAt(x, z, feet) {
      let g = heightAt(swamp, x, z), floor = false;
      for (const c of nearColliders(x, z, 0.1)) {
        if (c.round) continue;
        const [lx, lz] = localOf(c, x, z);
        if (Math.abs(lx) > c.hx + 0.02 || Math.abs(lz) > c.hz + 0.02) continue;
        if (c.y1 > g && c.y1 <= feet + STEP_UP + 0.02) { g = c.y1; floor = true; }
      }
      return { g, floor };
    }
    function insideBuilt(x, z, pad) {
      for (const c of nearColliders(x, z, pad + 0.5)) {
        if (c.round) { if (Math.hypot(x - c.x, z - c.z) < c.hx + pad) return true; continue; }
        const [lx, lz] = localOf(c, x, z);
        if (Math.abs(lx) < c.hx + pad && Math.abs(lz) < c.hz + pad) return true;
      }
      return false;
    }

    /* ================================================================ *
     * THE PLAYER
     * Simulated at a fixed 60 Hz and drawn between steps, with the look
     * smoothed over a few hundredths of a second: steady on any phone.
     * ================================================================ */
    const RADIUS = 0.32, EYE = 1.62, BODY_H = 1.82, STEP_UP = 0.42, GRAV = 22, CLIMB_MAX = 1.35;
    const SWIM_DEPTH = 1.35;            // deeper than this and your feet leave the bottom
    const JUMP_BASE = Math.sqrt(2 * GRAV * 1.05), JUMP_BOOTS = Math.sqrt(2 * GRAV * 2.4);
    const P = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0,
      yaw: 0, pitch: 0, tYaw: 0, tPitch: 0,
      ground: true, onFloor: false, coyote: 0, medium: "dry", depth: 0, sneak: false, moving: 0,
      climb: null, vault: null, ladder: null, alive: true, stride: 0, phase: 0, bob: 0, eyeY: EYE, sway: 0,
      shake: 0, deathT: -1, airFrom: 0, wakeT: 0, pushT: 0
    };
    function collideBody(feet) {
      const head = feet + BODY_H;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const c of nearColliders(P.x, P.z, RADIUS + 0.6)) {
          // Floors you can step on, and ceilings over your head, are not walls.
          if (c.y1 <= feet + STEP_UP + 0.02) continue;
          if (c.y0 >= feet + 1.0 || c.y0 >= head) continue;
          if (c.round) {
            const dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz), m = RADIUS + c.hx;
            if (d < m && d > 1e-6) { P.x += dx / d * (m - d); P.z += dz / d * (m - d); moved = true; }
            continue;
          }
          const [lx, lz] = localOf(c, P.x, P.z);
          const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
          let ex = lx - qx, ez = lz - qz;
          let d2 = ex * ex + ez * ez;
          if (d2 >= RADIUS * RADIUS) continue;
          let nx, nz, push;
          if (d2 < 1e-10) {
            // Centre inside the box: out by the shortest way.
            const pxp = c.hx - lx, pxn = c.hx + lx, pzp = c.hz - lz, pzn = c.hz + lz;
            const m = Math.min(pxp, pxn, pzp, pzn);
            if (m === pxp) { nx = 1; nz = 0; } else if (m === pxn) { nx = -1; nz = 0; } else if (m === pzp) { nx = 0; nz = 1; } else { nx = 0; nz = -1; }
            push = m + RADIUS;
          } else {
            const d = Math.sqrt(d2);
            nx = ex / d; nz = ez / d; push = RADIUS - d;
          }
          // Back to world space.
          const wx = nx * c.c + nz * c.s, wz = -nx * c.s + nz * c.c;
          P.x += wx * push; P.z += wz * push;
          const vn = P.vx * wx + P.vz * wz;
          if (vn < 0) { P.vx -= vn * wx; P.vz -= vn * wz; }
          moved = true;
        }
        for (const t of nearTrees(P.x, P.z)) {
          if (t.y > feet + 1.2) continue;
          const dx = P.x - t.x, dz = P.z - t.z, d = Math.hypot(dx, dz), m = RADIUS + t.r;
          if (d < m && d > 1e-6) { P.x += dx / d * (m - d); P.z += dz / d * (m - d); moved = true; }
        }
        if (!moved) break;
      }
      // The edge of the world: the dead forest.
      P.x = clamp(P.x, 12, SIZE - 12); P.z = clamp(P.z, 12, SIZE - 12);
    }
    // Trees, bucketed like the colliders.
    const tgrid = [];
    for (let i = 0; i < GN * GN; i++) tgrid.push([]);
    function indexTrees(list) {
      for (const l of tgrid) l.length = 0;
      for (const t of list) {
        const gx = clamp(Math.floor(t.x / GRID), 0, GN - 1), gz = clamp(Math.floor(t.z / GRID), 0, GN - 1);
        tgrid[gz * GN + gx].push(t);
      }
    }
    const _nt = [];
    function nearTrees(x, z) {
      _nt.length = 0;
      const gx = Math.floor(x / GRID), gz = Math.floor(z / GRID);
      for (let j = gz - 1; j <= gz + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) {
        if (i < 0 || j < 0 || i >= GN || j >= GN) continue;
        for (const t of tgrid[j * GN + i]) _nt.push(t);
      }
      return _nt;
    }

    // What is under you: dry ground, wading water or swimming water.
    function mediumAt(x, z, feet) {
      const gr = groundAt(x, z, feet);
      const depth = WATER_Y - gr.g;
      if (gr.floor && gr.g > WATER_Y - 0.05) return { m: "dry", depth: 0, g: gr.g, floor: true };
      if (depth <= 0.06) return { m: "dry", depth: 0, g: gr.g, floor: gr.floor };
      if (depth > SWIM_DEPTH) return { m: "swim", depth, g: gr.g, floor: false };
      return { m: "wade", depth, g: gr.g, floor: gr.floor };
    }

    // A ledge ahead you could haul yourself onto from the water.
    function ledgeAhead(dirX, dirZ) {
      const ax = P.x + dirX * (RADIUS + 0.35), az = P.z + dirZ * (RADIUS + 0.35);
      // Out of deep water you can reach a deck that stands a little clear of it.
      const reach = P.y < WATER_Y - 0.6 ? Math.max(CLIMB_MAX, WATER_Y + 0.85 - P.y) : CLIMB_MAX;
      const top = groundAt(ax, az, P.y + reach).g;
      if (top <= P.y + STEP_UP || top > P.y + reach) return null;
      if (top < WATER_Y - 0.3) return null;
      // Room for a body up there.
      for (const c of nearColliders(ax, az, 0.3)) {
        if (c.round) continue;
        const [lx, lz] = localOf(c, ax, az);
        if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz && c.y0 > top + 0.05 && c.y0 < top + BODY_H) return null;
      }
      return { x: P.x + dirX * (RADIUS + 0.55), z: P.z + dirZ * (RADIUS + 0.55), y: top };
    }
    function startVault(t) {
      P.vault = { t: 0, dur: 0.55, x0: P.x, y0: P.y, z0: P.z, x1: t.x, y1: t.y, z1: t.z };
      P.vx = P.vz = P.vy = 0;
      makeNoise(P.x, P.z, P.medium === "swim" ? 1.1 : 0.75, "climb");
      sfx.climb();
      haptic("light");
    }
    function ladderNear() {
      for (const L of BUILD.ladders) {
        const dx = P.x - L.x, dz = P.z - L.z;
        const out = dx * L.nx + dz * L.nz;                     // how far out in front of it
        const side = Math.abs(dx * L.nz - dz * L.nx);
        if (out > -0.2 && out < 0.75 && side < 0.45 && P.y > L.y0 - 1.2 && P.y < L.y1 + 0.1) return L;
      }
      return null;
    }

    function stepPlayer(dt, mv) {
      P.px = P.x; P.py = P.y; P.pz = P.z;
      if (!P.alive) return;
      // ---- hauling out of the water ----
      if (P.vault) {
        const v = P.vault;
        v.t += dt;
        const k = clamp(v.t / v.dur, 0, 1), up = Math.min(1, k * 1.7), over = smooth(0.35, 1, k);
        P.x = lerp(v.x0, v.x1, over); P.z = lerp(v.z0, v.z1, over);
        P.y = lerp(v.y0, v.y1, up * up * (3 - 2 * up));
        if (k >= 1) { P.vault = null; P.ground = true; sfx.drip(); }
        return;
      }
      const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
      const fx = -sy, fz = -cy, rx = cy, rz = -sy;
      const mag = Math.min(1, Math.hypot(mv.x, mv.y));
      const want = mag > 0.12;
      P.sneak = want && (mag < 0.62 || input.sneakKey);
      let dx = 0, dz = 0;
      if (want) {
        dx = fx * mv.y + rx * mv.x; dz = fz * mv.y + rz * mv.x;
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      }
      // ---- ladders ----
      if (P.ladder) {
        const L = P.ladder;
        const toward = -(dx * L.nx + dz * L.nz);
        const climbV = want ? (mv.y >= 0 ? 1 : -1) * (Math.abs(mv.y) > 0.2 ? 2.2 : 0) : 0;
        P.y += climbV * dt;
        P.x = lerp(P.x, L.x + L.nx * 0.42, 0.25); P.z = lerp(P.z, L.z + L.nz * 0.42, 0.25);
        P.vx = P.vz = P.vy = 0;
        P.stride += Math.abs(climbV) * dt;
        if (P.stride > 0.32) { P.stride = 0; sfx.rung(); }
        if (P.y >= L.y1 - 0.02 && climbV > 0) {
          // Off the top, onto whichever side has a floor up there.
          P.ladder = null;
          const bx = L.x - L.nx * 0.6, bz = L.z - L.nz * 0.6, fx = L.x + L.nx * 0.45, fz = L.z + L.nz * 0.45;
          const back = groundAt(bx, bz, L.y1 + 0.1).g >= L.y1 - 0.35 && !insideBuilt(bx, bz, 0.05);
          const tx = back ? bx : fx, tz = back ? bz : fz;
          P.vault = { t: 0, dur: 0.35, x0: P.x, y0: P.y, z0: P.z, x1: tx, y1: Math.max(L.y1, groundAt(tx, tz, L.y1 + 0.1).g), z1: tz };
          return;
        }
        if (P.y <= L.y0 - 1.1 || (climbV < 0 && P.y <= groundAt(P.x, P.z, P.y).g + 0.02)) { P.ladder = null; }
        void toward;
        return;
      }
      const here = mediumAt(P.x, P.z, P.y);
      P.medium = P.ground ? here.m : P.medium;
      P.depth = here.depth;
      const water = P.ground && here.m !== "dry";
      let speed;
      if (!P.ground) speed = state.boots ? 4.9 : 3.7;
      else if (here.m === "swim") speed = P.sneak ? 0.8 : 1.45;
      else if (here.m === "wade") speed = here.depth > 0.6 ? (P.sneak ? 0.9 : 1.8) : (P.sneak ? 1.15 : 2.5);
      else speed = P.sneak ? 1.6 : 3.6;
      const tx = dx * (want ? speed : 0), tz = dz * (want ? speed : 0);
      const rate = !P.ground ? 2.2 : here.m === "swim" ? 3 : water ? 6 : 12;
      const k = 1 - Math.exp(-rate * dt);
      P.vx += (tx - P.vx) * k; P.vz += (tz - P.vz) * k;
      const ox = P.x, oz = P.z;
      P.x += P.vx * dt; P.z += P.vz * dt;
      collideBody(P.y);
      const moved = Math.hypot(P.x - ox, P.z - oz);
      P.moving = moved / dt;
      // Grab a ladder by walking into it.
      const L = want ? ladderNear() : null;
      if (L && -(dx * L.nx + dz * L.nz) > 0.4) { P.ladder = L; P.vx = P.vz = 0; return; }
      // Haul out by pushing into a low ledge from the water.
      if (water && want) {
        const t = ledgeAhead(dx, dz);
        if (t) { P.pushT += dt; if (P.pushT > 0.14) { P.pushT = 0; startVault(t); return; } } else P.pushT = 0;
      }
      // ---- up and down ----
      const g = groundAt(P.x, P.z, P.y);
      const swimFloor = WATER_Y - SWIM_DEPTH + 0.03;
      const floorY = Math.max(g.g, swimFloor);
      if (P.ground) {
        if (P.y > floorY + 0.08) { P.ground = false; P.coyote = 0.12; P.vy = 0; P.airFrom = P.y; }
        else if (floorY > P.y) P.y = Math.min(floorY, P.y + dt * 7);
        else P.y = floorY;
      }
      if (!P.ground) {
        P.coyote -= dt;
        const prevY = P.y, prevHead = P.y + BODY_H;
        P.vy -= GRAV * dt;
        if (P.y < WATER_Y && P.vy < 0) P.vy *= Math.exp(-6 * dt);
        P.y += P.vy * dt;
        // Heads stop at ceilings, and only ever go down from them.
        if (P.vy > 0) {
          for (const c of nearColliders(P.x, P.z, 0.3)) {
            if (c.round || c.y0 < prevHead - 0.02 || c.y0 > P.y + BODY_H) continue;
            const [lx, lz] = localOf(c, P.x, P.z);
            if (Math.abs(lx) > c.hx + 0.2 || Math.abs(lz) > c.hz + 0.2) continue;
            P.y = c.y0 - BODY_H - 0.01; P.vy = 0;
            sfx.bonk();
            break;
          }
        }
        const gNow = Math.max(groundAt(P.x, P.z, Math.max(P.y, prevY)).g, swimFloor);
        if (prevY >= WATER_Y && P.y < WATER_Y && WATER_Y > g.g + 0.08) enterWater(-P.vy);
        if (P.y <= gNow) {
          const impact = -P.vy;
          P.y = gNow; P.vy = 0; P.ground = true;
          const m = mediumAt(P.x, P.z, P.y);
          if (m.m === "dry") {
            sfx.land(impact, m.floor);
            if (impact > 8) haptic("light");
            // A landing on planks over the water thuds down the posts.
            if (m.floor && impact > 4 && overWater(P.x, P.z)) { sfx.thud(); makeNoise(P.x, P.z, clamp(impact / 7, 0.7, 1.6), "thud"); }
          }
        }
      }
      // ---- the sounds of moving ----
      if (P.ground && moved > 0.0005) {
        P.stride += moved;
        const m = mediumAt(P.x, P.z, P.y);
        const strideLen = m.m === "swim" ? 1.1 : m.m === "wade" ? 0.75 : P.sneak ? 0.62 : 0.82;
        if (P.stride > strideLen) {
          P.stride = 0;
          if (m.m === "dry") {
            sfx.step(P.sneak, m.floor);
            // Rotten planks over the water creak, and the posts carry it down.
            if (m.floor && !P.sneak && overWater(P.x, P.z) && Math.random() < 0.4) {
              sfx.creak(1);
              makeNoise(P.x, P.z, 0.8, "creak");
              hint("creak", "Rotten planks", "They creak, and the sound goes down the posts into the water. Walk gently.");
            }
          }
          else {
            const deep = m.m === "swim" ? 1.7 : m.depth > 0.6 ? 1.0 : 0.6;
            const loud = P.sneak ? deep * 0.3 : deep;
            makeNoise(P.x, P.z, loud, m.m === "swim" ? "swim" : "wade");
            sfx.wade(loud, m.m === "swim");
            addRipple(P.x, P.z, 0.012 + loud * 0.012, 0.35);
            if (!P.sneak && loud > 0.9) haptic("light");
          }
        }
        P.phase += moved * (P.medium === "dry" ? 5.4 : 3.8);
      }
      P.wakeT += dt;
      if (P.medium !== "dry" && moved > 0.006 && P.wakeT > 0.5) { P.wakeT = 0; addRipple(P.x - P.vx * 0.2, P.z - P.vz * 0.2, P.sneak ? 0.006 : 0.012); }
    }

    // Is there water worth the name under this point?
    function overWater(x, z) { return heightAt(swamp, x, z) < WATER_Y - 0.25; }
    function enterWater(vy) {
      const loud = P.sneak ? 0.5 : clamp(vy / 4.2, 0.65, 3.0);
      makeNoise(P.x, P.z, loud, "splash");
      sfx.splash(loud);
      burstSplash(P.x, P.z, loud);
      haptic(loud > 1.6 ? "medium" : "light");
    }

    function jump() {
      if (state.screen !== "play" || !P.alive || P.vault || escapeRun) return;
      if (P.ladder) {
        // Push off backwards.
        const L = P.ladder;
        P.ladder = null;
        P.vx = L.nx * 2.5; P.vz = L.nz * 2.5; P.vy = 3; P.ground = false;
        return;
      }
      if (P.ground && P.medium !== "dry") {
        const t = ledgeAhead(-Math.sin(P.yaw), -Math.cos(P.yaw));
        if (t) { startVault(t); return; }
        // Out of the shallows you can jump, loudly; deeper than the knee you cannot.
        if (P.medium === "swim" || P.depth > 0.5) return;
        makeNoise(P.x, P.z, 1.1, "wade");
        sfx.wade(1, false);
        addRipple(P.x, P.z, 0.04, 0.35);
      }
      if (!P.ground && P.coyote <= 0) return;
      P.vy = state.boots ? JUMP_BOOTS : JUMP_BASE;
      P.ground = false; P.coyote = 0; P.airFrom = P.y;
      sfx.jump(state.boots);
      if (state.boots) haptic("light");
    }

    // The camera: drawn between physics steps, the look eased, steps softened.
    const _camPos = V3();
    function placeCamera(alpha, dt) {
      const x = lerp(P.px, P.x, alpha), y = lerp(P.py, P.y, alpha), z = lerp(P.pz, P.z, alpha);
      const kl = 1 - Math.exp(-dt * 28);
      let dy = P.tYaw - P.yaw;
      P.yaw += dy * kl;
      P.pitch += (P.tPitch - P.pitch) * kl;
      // Eye height follows the body but takes steps up smoothly.
      const eyeT = y + EYE;
      P.eyeY = P.eyeY < eyeT ? lerp(P.eyeY, eyeT, 1 - Math.exp(-dt * 16)) : lerp(P.eyeY, eyeT, 1 - Math.exp(-dt * 30));
      if (Math.abs(P.eyeY - eyeT) > 1.2) P.eyeY = eyeT;
      const moving = P.ground && P.moving > 0.3;
      P.bob = lerp(P.bob, moving ? (P.medium === "dry" ? 0.035 : 0.022) : 0, 1 - Math.exp(-dt * 6));
      const bob = Math.sin(P.phase) * P.bob, roll = Math.cos(P.phase * 0.5) * P.bob * 0.5;
      const swim = P.medium === "swim" ? Math.sin(state.t * 1.4) * 0.05 : 0;
      P.shake = Math.max(0, P.shake - dt * 1.5);
      const sh = P.shake * P.shake * 0.06;
      let pitch = P.pitch, extraRoll = 0, sink = 0;
      if (!P.alive && P.deathT >= 0) {
        const k = smooth(0, 1.2, P.deathT);
        sink = k * 1.1; pitch = lerp(P.pitch, 0.6, k); extraRoll = k * 0.4;
      }
      _camPos.set(x + (Math.random() - 0.5) * sh, P.eyeY + bob + swim - sink + (Math.random() - 0.5) * sh, z + (Math.random() - 0.5) * sh);
      camera.position.copy(_camPos);
      camera.rotation.set(pitch, P.yaw, roll + extraRoll + (P.medium === "swim" ? Math.sin(state.t * 0.9) * 0.02 : 0), "YXZ");
    }
    /* ================================================================ *
     * THE LISTENER: ITS BODY
     * Ten metres of pale, blind eel. A broad flat head with barbels and
     * milky eyes, a crest down its back, photophores along its flanks,
     * and a lure on a stalk over its head that glows like the fireflies.
     * The body is a tube posed in the vertex shader from a spine laid
     * along the path its head has swum.
     * ================================================================ */
    const SPINE = 24, SPINE_GAP = 0.42;
    const PROFILE = [];
    for (let i = 0; i < SPINE; i++) {
      const t = i / (SPINE - 1);
      let r;
      if (t < 0.2) r = 0.05 + 0.4 * Math.sqrt(t / 0.2);
      else if (t < 0.55) r = 0.45 + Math.sin(((t - 0.2) / 0.35) * Math.PI) * 0.1;
      else r = 0.45 * Math.pow(1 - (t - 0.55) / 0.45, 1.3) + 0.02;
      PROFILE.push(i === SPINE - 1 ? 0.0 : r);
    }
    const beast = { spine: [], glow: { value: 0.2 }, open: { value: 0 }, group: new THREE.Group(), lurePos: V3(), lureLight: null };
    for (let i = 0; i < SPINE; i++) beast.spine.push(new THREE.Vector4(0, -1, i * SPINE_GAP, PROFILE[i]));
    const SPINE_GLSL = /* glsl */`
      uniform vec4 uSpine[${SPINE}];
      void spineFrame(float fi, out vec3 p, out vec3 T, out vec3 B, out vec3 U, out float r) {
        int i = int(fi + 0.5);
        int i0 = i > 0 ? i - 1 : 0;
        int i1 = i < ${SPINE - 1} ? i + 1 : ${SPINE - 1};
        p = uSpine[i].xyz; r = uSpine[i].w;
        T = uSpine[i0].xyz - uSpine[i1].xyz;
        T = length(T) < 1e-4 ? vec3(0.0, 0.0, 1.0) : normalize(T);
        B = cross(vec3(0.0, 1.0, 0.0), T);
        B = length(B) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(B);
        U = normalize(cross(T, B));
      }
    `;
    function buildBeast() {
      const SEG = 18;
      const pos = [], aT = [], aA = [], idx = [];
      for (let i = 0; i < SPINE; i++) for (let k = 0; k <= SEG; k++) { pos.push(0, 0, 0); aT.push(i); aA.push((k / SEG) * Math.PI * 2); }
      for (let i = 0; i < SPINE - 1; i++) for (let k = 0; k < SEG; k++) {
        const a = i * (SEG + 1) + k, b = a + 1, c = a + SEG + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aT", new THREE.Float32BufferAttribute(aT, 1));
      g.setAttribute("aA", new THREE.Float32BufferAttribute(aA, 1));
      g.setIndex(idx);
      const spineU = { uSpine: { value: beast.spine }, uGlow: beast.glow, uOpen: beast.open };
      // Skin: a stock lit material, posed from the spine.
      const skin = swampify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide }), {
        key: "beast",
        uniforms: spineU,
        vHead: SPINE_GLSL + /* glsl */`
          uniform float uOpen;
          attribute float aT;
          attribute float aA;
          varying float vT; varying float vA; varying float vMouth;
        `,
        onShader: sh => {
          sh.vertexShader = sh.vertexShader
            .replace("#include <beginnormal_vertex>", /* glsl */`
              vec3 sp, sT, sB, sU; float sr;
              spineFrame(aT, sp, sT, sB, sU, sr);
              float ca = cos(aA), sa = sin(aA);
              float headK = 1.0 - smoothstep(1.0, 4.5, aT);
              float wide = 1.1 + headK * 0.4;
              float tall = (sa > 0.0 ? 0.8 : 0.6) * (1.0 - headK * 0.25);
              vec3 objectNormal = normalize(sB * ca / wide + sU * sa / tall);
              #ifdef USE_TANGENT
                vec3 objectTangent = vec3(1.0, 0.0, 0.0);
              #endif
            `)
            .replace("#include <begin_vertex>", /* glsl */`
              float breathe = 1.0 + 0.04 * sin(uTime * 1.6 - aT * 0.5);
              vec3 off = (sB * ca * wide + sU * sa * tall) * sr * breathe;
              // The jaw drops open below the lip line.
              float gape = uOpen * (1.0 - smoothstep(0.4, 3.0, aT));
              float below = max(-0.15 - sa, 0.0);
              off -= sU * sr * gape * 1.7 * below;
              off += sU * sr * gape * 0.3 * max(sa, 0.0);
              vMouth = gape * smoothstep(0.0, 0.25, below) * (1.0 - smoothstep(0.55, 0.85, below));
              vec3 transformed = sp + off;
              vT = aT / ${(SPINE - 1).toFixed(1)};
              vA = sa;
            `);
        },
        fHead: /* glsl */`
          uniform float uGlow;
          varying float vT; varying float vA; varying float vMouth;
        `,
        fMap: /* glsl */`
          {
            float mott = texture2D(uNoise, vec2(vT * 3.1, vA * 0.4 + 0.3)).r * 0.6 + texture2D(uNoise, vec2(vT * 8.0, vA * 0.9)).b * 0.4;
            vec3 back = mix(vec3(0.07, 0.085, 0.07), vec3(0.16, 0.17, 0.14), mott);
            vec3 belly = vec3(0.34, 0.33, 0.29);
            vec3 c = mix(belly, back, smoothstep(-0.65, 0.2, vA));
            // Dark saddles across the back.
            c *= 1.0 - smoothstep(0.55, 0.8, sin(vT * 46.0 + mott * 3.0)) * smoothstep(0.1, 0.7, vA) * 0.55;
            // The pale, blind face, split by the dark line of the mouth.
            float face = 1.0 - smoothstep(0.02, 0.09, vT);
            c = mix(c, belly * 0.9, face * 0.6);
            float eye = (1.0 - smoothstep(0.012, 0.02, abs(vT - 0.075))) * (1.0 - smoothstep(0.1, 0.17, abs(vA - 0.42)));
            c = mix(c, vec3(0.75, 0.82, 0.82), eye);
            if (vMouth > 0.01) {
              float lip = smoothstep(0.015, 0.04, vMouth) * (1.0 - smoothstep(0.12, 0.17, vMouth));
              float tri = abs(fract(vT * 120.0) - 0.5) * 2.0;
              float teeth = lip * step(tri, 1.0 - smoothstep(0.03, 0.15, vMouth));
              c = mix(c, mix(vec3(0.16, 0.015, 0.02), vec3(0.008, 0.0, 0.002), smoothstep(0.12, 0.6, vMouth)), smoothstep(0.02, 0.16, vMouth));
              c = mix(c, vec3(0.92, 0.9, 0.82), teeth);
            }
            diffuseColor.rgb = c;
          }
        `,
        fEmit: /* glsl */`
          {
            // Photophores down the flanks, brighter the harder it listens.
            float spots = smoothstep(0.82, 0.95, texture2D(uNoise, vec2(vT * 4.0, vA * 0.35 + 0.5)).g) * smoothstep(-0.4, 0.3, vA) * (1.0 - smoothstep(0.85, 1.0, vT));
            totalEmissiveRadiance += vec3(0.25, 0.95, 0.85) * spots * (0.06 + uGlow * 0.8);
            // Blind eyes, milky, catching what light there is.
            float eye = (1.0 - smoothstep(0.012, 0.02, abs(vT - 0.075))) * (1.0 - smoothstep(0.1, 0.17, abs(vA - 0.42)));
            totalEmissiveRadiance += vec3(0.55, 0.85, 0.85) * eye * (0.3 + uGlow * 1.1);
          }
        `
      });
      const body = new THREE.Mesh(g, skin);
      body.frustumCulled = false;
      // Posed in the vertex shader: the stock shadow pass would draw it unposed.
      beast.group.add(body);
      // Crest: a row of dark fins along the back.
      const fp = [], ft = [], fo = [], fi = [];
      for (let i = 3; i < SPINE - 3; i++) {
        const h = 0.38 * Math.sin(((i - 3) / (SPINE - 6)) * Math.PI) + 0.06;
        const base = fp.length / 3;
        fp.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
        ft.push(i, i, i + 0.9);
        fo.push(0.25, 0.25 + h, 0.25);
        fi.push(base, base + 1, base + 2);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
      fg.setAttribute("aT", new THREE.Float32BufferAttribute(ft, 1));
      fg.setAttribute("aO", new THREE.Float32BufferAttribute(fo, 1));
      fg.setIndex(fi);
      const finMat = swampify(new THREE.MeshStandardMaterial({ color: 0x2a332c, roughness: 0.5, side: THREE.DoubleSide }), {
        key: "fin", uniforms: spineU,
        vHead: SPINE_GLSL + "attribute float aT;\nattribute float aO;\n",
        onShader: sh => {
          // A fin stands in the plane of the spine's tangent and up, so its
          // normal is the spine's side vector (the geometry carries none).
          sh.vertexShader = sh.vertexShader
            .replace("#include <beginnormal_vertex>", /* glsl */`
              vec3 sp, sT, sB, sU; float sr;
              spineFrame(aT, sp, sT, sB, sU, sr);
              vec3 objectNormal = sB;
              #ifdef USE_TANGENT
                vec3 objectTangent = sT;
              #endif
            `)
            .replace("#include <begin_vertex>", /* glsl */`
              vec3 transformed = sp + sU * (sr * 0.7 + aO - 0.25) + sT * (fract(aT) * 0.5);
            `);
        }
      });
      const fins = new THREE.Mesh(fg, finMat);
      fins.frustumCulled = false;
      beast.group.add(fins);
      // Barbels and the lure: lines and a glowing bulb, placed on the CPU.
      const lure = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.0, 0.85).multiplyScalar(6) }));
      beast.lure = lure;
      beast.group.add(lure);
      const stalkG = new THREE.BufferGeometry();
      stalkG.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12 * 3), 3));
      const stalk = new THREE.Line(stalkG, new THREE.LineBasicMaterial({ color: 0x23292a }));
      stalk.frustumCulled = false;
      beast.stalk = stalk;
      beast.group.add(stalk);
      // Seen through the murk: its dark shape and its lights, drawn after the surface.
      const shade = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uSpine: { value: beast.spine } },
        vertexShader: SPINE_GLSL + /* glsl */`
          attribute float aT; attribute float aA;
          varying vec3 vW;
          void main() {
            vec3 p, T, B, U; float r;
            spineFrame(aT, p, T, B, U, r);
            float headK = 1.0 - smoothstep(1.0, 4.5, aT);
            vec3 off = (B * cos(aA) * (1.1 + headK * 0.4) + U * sin(aA) * 0.7) * r;
            vW = p + off;
            gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
          }`,
        fragmentShader: /* glsl */`
          varying vec3 vW;
          void main() {
            if (vW.y > -0.03) discard;
            float d = length(cameraPosition - vW);
            float a = 0.5 * (1.0 - smoothstep(5.0, 26.0, d)) * (1.0 - smoothstep(-0.12, -0.03, vW.y)) * (0.55 + 0.45 * smoothstep(-1.6, -0.3, vW.y));
            gl_FragColor = vec4(0.0, 0.006, 0.008, a);
          }`
      });
      const shadeMesh = new THREE.Mesh(g, shade);
      shadeMesh.frustumCulled = false;
      shadeMesh.renderOrder = 4;
      beast.group.add(shadeMesh);
      beast.shadeMesh = shadeMesh;
      scene.add(beast.group);
    }
    function poseLure(dt) {
      // The stalk rises from the brow and nods over the snout.
      const h = beast.spine[0], n = beast.spine[2];
      let fx = h.x - n.x, fz = h.z - n.z;
      const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
      const t = SHARED.uTime.value;
      const base = V3(lerp(h.x, n.x, 0.6), h.y + 0.32, lerp(h.z, n.z, 0.6));
      const tip = V3(h.x + fx * 0.55 + Math.sin(t * 2.1) * 0.08, h.y + 1.05 + Math.sin(t * 1.7) * 0.07, h.z + fz * 0.55 + Math.cos(t * 1.9) * 0.08);
      const arr = beast.stalk.geometry.attributes.position.array;
      for (let k = 0; k < 12; k++) {
        const u = k / 11;
        const bow = Math.sin(u * Math.PI) * 0.35;
        arr[k * 3] = lerp(base.x, tip.x, u) - fx * bow * 0.3;
        arr[k * 3 + 1] = lerp(base.y, tip.y, u) + bow;
        arr[k * 3 + 2] = lerp(base.z, tip.z, u) - fz * bow * 0.3;
      }
      beast.stalk.geometry.attributes.position.needsUpdate = true;
      beast.lure.position.copy(tip);
      const pulse = 0.65 + 0.35 * Math.sin(t * 2.6);
      const g = beast.glow.value;
      beast.lure.material.color.setRGB(0.5, 1.0, 0.85).multiplyScalar((1.0 + g * 2.2) * pulse);
      beast.lurePos.copy(tip);
      void dt;
    }
    /* ================================================================ *
     * THE LISTENER: ITS MIND
     * It swims a 2 m grid of water deep enough to hide in, by the
     * shortest way, smoothed so it glides rather than zigzags. It hears
     * only what happens in the water: a step, a stroke, a splash.
     * ================================================================ */
    const NAV = 2, NN = SIZE / NAV;
    const navOk = new Uint8Array(NN * NN);
    const navDepth = new Float32Array(NN * NN);
    function buildNav() {
      for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
        const x = (i + 0.5) * NAV, z = (j + 0.5) * NAV;
        const depth = WATER_Y - heightAt(swamp, x, z);
        let ok = depth >= 0.45 && x > 14 && z > 14 && x < SIZE - 14 && z < SIZE - 14;
        if (ok) for (const c of nearColliders(x, z, 1.2)) {
          if (c.round || c.y0 > -0.15) continue;
          const [lx, lz] = localOf(c, x, z);
          if (Math.abs(lx) < c.hx + 0.6 && Math.abs(lz) < c.hz + 0.6) { ok = false; break; }
        }
        navOk[j * NN + i] = ok ? 1 : 0;
        navDepth[j * NN + i] = depth;
      }
      // Keep only the largest body of connected water, so that wherever a
      // lure lands, the way to it exists.
      const comp = new Int32Array(NN * NN).fill(-1);
      let best = -1, bestN = 0;
      for (let c0 = 0; c0 < NN * NN; c0++) {
        if (!navOk[c0] || comp[c0] >= 0) continue;
        let head = 0, tail = 0;
        queue[tail++] = c0; comp[c0] = c0;
        while (head < tail) {
          const c = queue[head++], ci = c % NN, cj = (c / NN) | 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= NN || nj >= NN) continue;
            const n = nj * NN + ni;
            if (!navOk[n] || comp[n] >= 0) continue;
            comp[n] = c0; queue[tail++] = n;
          }
        }
        if (tail > bestN) { bestN = tail; best = c0; }
      }
      for (let c = 0; c < NN * NN; c++) if (navOk[c] && comp[c] !== best) navOk[c] = 0;
      return bestN;
    }
    const cellOf = (x, z) => {
      const i = Math.floor(x / NAV), j = Math.floor(z / NAV);
      return i < 0 || j < 0 || i >= NN || j >= NN ? -1 : j * NN + i;
    };
    const centreOfCell = c => [((c % NN) + 0.5) * NAV, (((c / NN) | 0) + 0.5) * NAV];
    const swimmable = (x, z) => { const c = cellOf(x, z); return c >= 0 && navOk[c] === 1; };
    function nearestNav(x, z, maxR) {
      const c0 = cellOf(x, z);
      if (c0 >= 0 && navOk[c0]) return c0;
      const ci = Math.floor(x / NAV), cj = Math.floor(z / NAV);
      for (let r = 1; r <= (maxR || 20); r++) {
        let best = -1, bd = 1e9;
        for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || i < 0 || j < 0 || i >= NN || j >= NN) continue;
          const c = j * NN + i;
          if (!navOk[c]) continue;
          const [cx, cz] = centreOfCell(c), d = (cx - x) ** 2 + (cz - z) ** 2;
          if (d < bd) { bd = d; best = c; }
        }
        if (best >= 0) return best;
      }
      return -1;
    }
    const prevCell = new Int32Array(NN * NN);
    const queue = new Int32Array(NN * NN);
    function findPath(from, to) {
      if (from < 0 || to < 0) return null;
      if (from === to) return [centreOfCell(to)];
      prevCell.fill(-1);
      let head = 0, tail = 0;
      queue[tail++] = from; prevCell[from] = from;
      const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      while (head < tail) {
        const c = queue[head++];
        if (c === to) break;
        const ci = c % NN, cj = (c / NN) | 0;
        for (const [di, dj] of D8) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= NN || nj >= NN) continue;
          const n = nj * NN + ni;
          if (prevCell[n] !== -1 || !navOk[n]) continue;
          if (di && dj && (!navOk[cj * NN + ni] || !navOk[nj * NN + ci])) continue;
          prevCell[n] = c;
          queue[tail++] = n;
        }
      }
      if (prevCell[to] === -1) return null;
      const out = [];
      for (let c = to; c !== from; c = prevCell[c]) out.push(c);
      out.reverse();
      return out.map(centreOfCell);
    }
    // Water all the way, however shallow: the way it charges a lure.
    function wetLine(x0, z0, x1, z1) {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 0.8);
      for (let k = 1; k < n; k++) if (WATER_Y - heightAt(swamp, lerp(x0, x1, k / n), lerp(z0, z1, k / n)) < 0.15) return false;
      return true;
    }
    function clearLine(x0, z0, x1, z1) {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 0.9);
      for (let k = 1; k < n; k++) if (!swimmable(lerp(x0, x1, k / n), lerp(z0, z1, k / n))) return false;
      return true;
    }

    const C = {
      alive: true, hp: CREATURE_HP, x: 0, y: -1, z: 0, heading: 0, speed: 0, state: "roam", timer: 0,
      path: [], pi: 0, tx: 0, tz: 0, alert: 0.2, rage: 0, act: null, heardAt: -99, heardN: 0, lastX: 0, lastZ: 0,
      trail: [], phase: 0, lure: null, listenT: 20, wakeT: 0, bubbleT: 0, seenAt: -99
    };
    const TRAIL = 0.1;
    function goTo(x, z) {
      C.tx = x; C.tz = z;
      const to = nearestNav(x, z, 14);
      const from = nearestNav(C.x, C.z, 6);
      const p = findPath(from, to);
      C.path = p || [];
      C.pi = 0;
      // Glide: skip waypoints the straight line can reach.
      if (C.path.length > 2) {
        const out = [];
        let ax = C.x, az = C.z, k = 0;
        while (k < C.path.length) {
          let far = k;
          for (let m = k + 1; m < Math.min(C.path.length, k + 12); m++) if (clearLine(ax, az, C.path[m][0], C.path[m][1])) far = m;
          out.push(C.path[far]);
          [ax, az] = C.path[far];
          k = far + 1;
        }
        C.path = out;
      }
    }
    function setMind(s) {
      if (C.state === s) { C.timer = 0; return; }
      const was = C.state;
      C.state = s; C.timer = 0;
      if (s === "hunt" && was !== "hunt") { sfx.beastGrowl(); haptic("warning"); }
    }
    function hearMod() {
      let m = state.boots ? 1 : 0.85;
      if (state.bazooka) m += 0.15;
      m += C.rage * 0.1;
      m *= 1 - weather.rain * 0.55;
      return m;
    }
    const LURE_RANGE = { duck: 140, bell: 300, generator: 160, firecracker: 110, motor: 400 };
    function beastHear(x, z, loud, kind, src) {
      if (!C.alive || C.state === "dead") return;
      const d = Math.hypot(x - C.x, z - C.z);
      const lure = LURE_RANGE[kind];
      if (lure) {
        if (d > lure) return;
        if (C.act && C.act.kind !== "rise") return;
        // A lure always wins over a guess.
        C.lure = { kind, src, x, z };
        C.lastX = x; C.lastZ = z;
        setMind("lured");
        goTo(x, z);
        C.alert = Math.max(C.alert, 0.7);
        showEar(kind === "duck" ? "It heard the duck" : kind === "bell" ? "The bell carries across the water" : "Something is coming for the noise", 2.5);
        return;
      }
      const reach = HEARING * loud * hearMod() * (C.state === "listen" ? 1.4 : 1);
      if (d > reach) return;
      const err = (1.0 + d * 0.1) * (1 - Math.min(1, loud / 3));
      const ea = Math.random() * Math.PI * 2, er = Math.sqrt(Math.random()) * err;
      C.heardN = state.t - C.heardAt < 6 ? C.heardN + 1 : 1;
      C.heardAt = state.t;
      C.lastX = x + Math.cos(ea) * er; C.lastZ = z + Math.sin(ea) * er;
      sfx.beastClick();
      if (C.act) return;
      if (C.state === "lured" && C.lure) return;
      const close = d < 12 || C.heardN >= 2 || loud >= 1.5;
      setMind(close ? "hunt" : "investigate");
      goTo(C.lastX, C.lastZ);
      showEar(C.state === "hunt" ? "It is coming" : "It heard something", 2);
    }

    function placeBeast(nearX, nearZ, minD, maxD) {
      // Somewhere deep, at a fair distance -- or failing deep, anywhere it can swim.
      const ci = Math.floor(nearX / NAV), cj = Math.floor(nearZ / NAV), R = Math.ceil(maxD / NAV);
      const deep = [], any = [];
      for (let j = Math.max(0, cj - R); j <= Math.min(NN - 1, cj + R); j++) for (let i = Math.max(0, ci - R); i <= Math.min(NN - 1, ci + R); i++) {
        const c = j * NN + i;
        if (!navOk[c]) continue;
        const [x, z] = centreOfCell(c), d = Math.hypot(x - nearX, z - nearZ);
        if (d < minD || d > maxD) continue;
        (navDepth[c] >= 1.2 ? deep : any).push(c);
      }
      const pool = deep.length ? deep : any;
      let best;
      if (pool.length) { const [x, z] = centreOfCell(pool[(Math.random() * pool.length) | 0]); best = { x, z }; }
      else { const c = nearestNav(nearX, nearZ, 60); best = c >= 0 ? { x: centreOfCell(c)[0], z: centreOfCell(c)[1] } : { x: CHANNELS[0].pts[2][0], z: CHANNELS[0].pts[2][1] }; }
      Object.assign(C, { alive: true, hp: CREATURE_HP, x: best.x, z: best.z, y: -1.1, heading: Math.random() * 6.28, speed: 0, state: "roam", timer: 0, path: [], pi: 0,
        alert: 0.2, rage: 0, act: null, heardAt: -99, heardN: 0, lure: null, listenT: 18 + Math.random() * 12 });
      C.trail.length = 0;
      for (let k = 0; k < SPINE * 5; k++) C.trail.push({ x: best.x - Math.sin(C.heading) * k * TRAIL, z: best.z - Math.cos(C.heading) * k * TRAIL });
      roamTarget();
    }
    function roamTarget() {
      // Mostly the deep roads; now and then, closer to wherever you are.
      for (let k = 0; k < 200; k++) {
        let x, z;
        // The more you have taken from the swamp, the closer it keeps to you.
        const pressure = Math.min(1, (state.coils + state.parts) / 10 + (state.bazooka ? 0.2 : 0));
        if (state.screen === "menu" && menuShot) {
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 16;
          x = menuShot.fx + Math.cos(a) * r; z = menuShot.fz + Math.sin(a) * r;
        } else if (state.screen === "play") {
          // It keeps to your part of the swamp: often close, never far, and
          // into any water it can swim, however shallow.
          const near = Math.random() < 0.5 + pressure * 0.3 + C.rage * 0.15;
          const a = Math.random() * Math.PI * 2, r = near ? 10 + Math.random() * 26 : 36 + Math.random() * 44;
          x = P.x + Math.cos(a) * r; z = P.z + Math.sin(a) * r;
          const c = nearestNav(x, z, 8);
          if (c < 0) continue;
          [x, z] = centreOfCell(c);
          goTo(x, z);
          return;
        } else { const c = (Math.random() * NN * NN) | 0; [x, z] = centreOfCell(c); }
        const c = cellOf(x, z);
        if (c < 0 || !navOk[c] || navDepth[c] < 0.9) continue;
        goTo(x, z);
        return;
      }
    }

    function stepBeast(dt) {
      if (!C.alive) { poseBeast(dt); return; }
      C.timer += dt; C.phase += dt;
      const pIn = state.screen === "play" && P.alive && ((P.medium !== "dry" && P.ground && !P.vault) || !!escapeRun);
      // On a low deck or a jetty over the water it can still reach up and take you.
      const pDeck = state.screen === "play" && P.alive && P.ground && !P.vault && P.medium === "dry" && P.y < WATER_Y + 1.15 && heightAt(swamp, P.x, P.z) < WATER_Y - 0.4;
      const dP = Math.hypot(P.x - C.x, P.z - C.z);
      if (C.act) { stepAct(dt, dP, pIn || pDeck); poseBeast(dt); return; }
      let speed = 1.7, depth = -1.0, turn = 1.6;
      if (C.state === "roam") {
        if (C.pi >= C.path.length || C.timer > 30) { C.timer = 0; roamTarget(); }
        C.listenT -= dt;
        if (C.listenT <= 0) { C.listenT = (22 + Math.random() * 18) / (1 + C.rage * 0.4); C.act = { kind: "rise", t: 0, dur: 3.4, listen: true }; sfx.beastBreath(); }
      } else if (C.state === "investigate") {
        speed = 3.0; depth = -0.7; turn = 2.4;
        if (C.pi >= C.path.length) { setMind("search"); C.searchA = Math.random() * 6.28; }
      } else if (C.state === "hunt") {
        speed = HUNT_SPEED * (1 + 0.15 * C.rage); depth = -0.3; turn = 3.6;
        if (C.pi >= C.path.length) { setMind("search"); C.searchA = Math.random() * 6.28; }
        if (C.timer > 10) setMind("search");
      } else if (C.state === "search") {
        speed = 2.0; depth = -0.55; turn = 2.4;
        if (C.pi >= C.path.length) { C.searchA += 1.2; goTo(C.lastX + Math.cos(C.searchA) * 5, C.lastZ + Math.sin(C.searchA) * 5); }
        if (C.timer > 12 + C.rage * 3) setMind("roam");
      } else if (C.state === "lured") {
        speed = HUNT_SPEED * (C.lure && C.lure.kind === "motor" ? 1.15 : 0.92); depth = -0.35; turn = 3.2;
        const L = C.lure;
        if (!L) setMind("search");
        else {
          if (L.src && L.src.x !== undefined) { L.x = L.src.x; L.z = L.src.z; }
          const dl = Math.hypot(L.x - C.x, L.z - C.z);
          if (L.kind === "duck" && L.src && L.src.state !== "float") { C.lure = null; setMind("search"); }
          else if (L.kind === "duck" && dl < 2.4) { startBite(L.src); poseBeast(dt); return; }
          else if (L.kind === "motor" && dl < 3.2) { C.lure = null; startLunge(); poseBeast(dt); return; }
          else if (L.kind !== "duck" && dl < 4.5) { C.lure = null; C.act = { kind: "rise", t: 0, dur: 4.2 }; sfx.beastBreath(); poseBeast(dt); return; }
          else if (C.pi >= C.path.length) {
            // As close as the water goes: snatch it if it can, and otherwise
            // rear up there and listen -- head out, for anyone waiting.
            if (L.kind === "duck" && L.src && dl < 6) startBite(L.src);
            else if (L.kind === "duck" && L.src && dl < 22 && wetLine(C.x, C.z, L.x, L.z)) { C.act = { kind: "charge", t: 0, dur: 9, duck: L.src }; sfx.beastGrowl(); }
            else { C.act = { kind: "rise", t: 0, dur: 3.8 }; sfx.beastBreath(); }
            C.lure = null; poseBeast(dt); return;
          }
          if (C.timer > 45) { C.lure = null; setMind("search"); }
        }
      }
      // Touch: it finds you by bumping into you.
      if (pIn) {
        for (let k = 0; k < SPINE; k += 2) {
          const s = beast.spine[k];
          if (Math.hypot(s.x - P.x, s.z - P.z) < s.w + RADIUS + 0.15 && s.y > P.y - 0.3) {
            C.heardAt = state.t; C.lastX = P.x; C.lastZ = P.z;
            if (C.state !== "hunt") { setMind("hunt"); showEar("It touched you", 2); }
            goTo(P.x, P.z);
            break;
          }
        }
      }
      // The strike: at a fresh sound, or at what it is touching.
      if ((pIn || pDeck) && (C.state === "hunt" || C.state === "search") && dP < (pDeck ? 2.7 : 3.2) && (state.t - C.heardAt < 1.1 || dP < 1.0)) {
        startLunge(); poseBeast(dt); return;
      }
      // Swim.
      let wx = C.tx, wz = C.tz;
      if (C.pi < C.path.length) {
        [wx, wz] = C.path[C.pi];
        if (Math.hypot(wx - C.x, wz - C.z) < 1.4) C.pi++;
      }
      const want = Math.atan2(wx - C.x, wz - C.z);
      let da = want - C.heading;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      C.heading += clamp(da, -turn * dt, turn * dt);
      const lastLeg = C.pi >= C.path.length - 1;
      const arrive = lastLeg ? clamp(Math.hypot(wx - C.x, wz - C.z) / 3, 0.3, 1) : 1;
      const slow = 1 - Math.min(0.6, Math.abs(da) / Math.PI);
      C.speed = lerp(C.speed, speed * slow * arrive, 1 - Math.exp(-2 * dt));
      const nx = C.x + Math.sin(C.heading) * C.speed * dt, nz = C.z + Math.cos(C.heading) * C.speed * dt;
      // Stranded in the shallows after a charge or a strike, any water will do.
      const stranded = !swimmable(C.x, C.z);
      const wet = (x, z) => swimmable(x, z) || (stranded && WATER_Y - heightAt(swamp, x, z) > 0.12);
      if (wet(nx, nz)) { C.x = nx; C.z = nz; }
      else { if (wet(nx, C.z)) C.x = nx; else if (wet(C.x, nz)) C.z = nz; C.heading += Math.sign(da || 1) * dt; }
      const floor = heightAt(swamp, C.x, C.z) + 0.55;
      C.y = lerp(C.y, Math.max(depth, floor), 1 - Math.exp(-1.6 * dt));
      const alertT = C.state === "hunt" || C.state === "lured" ? 1 : C.state === "investigate" || C.state === "search" ? 0.6 : state.screen === "menu" ? 0.45 : 0.18;
      C.alert = lerp(C.alert, alertT, 1 - Math.exp(-2.5 * dt));
      C.wakeT += dt;
      // Its slime glows where it stirs the water: you can watch it come.
      if (C.speed > 1.2 && C.y > -1.15 && C.wakeT > 0.32 && Math.abs(C.x - P.x) + Math.abs(C.z - P.z) < 90) { C.wakeT = 0; addRipple(C.x, C.z, 0.012 + C.speed * 0.005, 1); }
      C.bubbleT += dt;
      if (C.bubbleT > 0.7 && C.y < -0.6) { C.bubbleT = 0; bubble(C.x, C.z, 0.4); }
      poseBeast(dt);
    }

    function startLunge() {
      C.act = { kind: "lunge", t: 0, dur: 0.62 };
      sfx.beastRoar(C.x, C.z);
      haptic("heavy");
      showEar("RUN", 1);
    }
    function startBite(duck) {
      if (duck) duck.state = "bitten";
      C.act = { kind: "bite", t: 0, dur: 2.3, duck };
      C.lure = null;
      sfx.beastBite(C.x, C.z);
      burstSplash(duck ? duck.x : C.x, duck ? duck.z : C.z, 1.8);
    }
    function stepAct(dt, dP, pIn) {
      const a = C.act;
      a.t += dt;
      const k = a.t / a.dur;
      if (a.kind === "lunge") {
        const toward = Math.atan2(P.x - C.x, P.z - C.z);
        C.heading = toward;
        const sp = 8 * (k < 0.4 ? 0.5 : 1);
        const nx = C.x + Math.sin(toward) * sp * dt, nz = C.z + Math.cos(toward) * sp * dt;
        if (swimmable(nx, nz) || WATER_Y - heightAt(swamp, nx, nz) > 0.25) { C.x = nx; C.z = nz; }
        C.y = lerp(C.y, k < 0.6 ? 0.9 : 0.4, 1 - Math.exp(-8 * dt));
        beast.open.value = smooth(0, 0.5, k);
        C.alert = 1.4;
        if (a.t >= a.dur) {
          C.act = null; beast.open.value = 0;
          if (pIn && Math.hypot(P.x - C.x, P.z - C.z) < 2.6) {
            state.deathCause = escapeRun ? "It took the boat out from under you." : P.medium === "dry" ? "It came up out of the water and took you off the planks." : "";
            killPlayer(); return;
          }
          burstSplash(C.x, C.z, 2.2);
          C.lastX = P.x; C.lastZ = P.z;
          setMind("search"); goTo(C.lastX, C.lastZ);
        }
      } else if (a.kind === "bite") {
        const d = a.duck;
        if (d) C.heading = lerp(C.heading, Math.atan2(d.x - C.x, d.z - C.z), 0.1);
        C.y = lerp(C.y, k < 0.75 ? 1.5 : -0.3, 1 - Math.exp(-4 * dt));
        beast.open.value = k < 0.4 ? smooth(0, 0.25, k) : 1 - smooth(0.45, 0.7, k);
        C.alert = 1.3;
        if (d && k > 0.45 && d.state === "bitten") { d.state = "gone"; sfx.squeak(d.x, d.z, true); burstSplash(d.x, d.z, 1.4); }
        if (a.t >= a.dur) { C.act = null; beast.open.value = 0; setMind("search"); C.lastX = C.x; C.lastZ = C.z; goTo(C.x + Math.sin(C.heading) * 4, C.z + Math.cos(C.heading) * 4); }
      } else if (a.kind === "charge") {
        // Through the shallows at the lure, its back out of the water.
        const d = a.duck;
        if (!d || d.state !== "float") { C.act = null; setMind("search"); goTo(C.x, C.z); return; }
        let da = Math.atan2(d.x - C.x, d.z - C.z) - C.heading;
        da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
        C.heading += clamp(da, -4 * dt, 4 * dt);
        const nx = C.x + Math.sin(C.heading) * 5.5 * dt, nz = C.z + Math.cos(C.heading) * 5.5 * dt;
        if (WATER_Y - heightAt(swamp, nx, nz) > 0.12) { C.x = nx; C.z = nz; }
        C.speed = 5.5;
        C.y = lerp(C.y, Math.max(heightAt(swamp, C.x, C.z) + 0.42, -0.3), 1 - Math.exp(-4 * dt));
        C.alert = 1.15;
        C.wakeT += dt;
        if (C.wakeT > 0.15) { C.wakeT = 0; addRipple(C.x, C.z, 0.05, 1); }
        if (pIn && dP < 1.8) { C.act = null; state.deathCause = "It came through the shallows for the duck, and found you."; killPlayer(); return; }
        if (Math.hypot(d.x - C.x, d.z - C.z) < 2.4) { C.act = null; startBite(d); return; }
        if (a.t >= a.dur) { C.act = null; setMind("search"); goTo(C.x, C.z); }
      } else if (a.kind === "rise") {
        // Head up out of the water, turning, listening hard.
        C.y = lerp(C.y, k < 0.8 ? 1.1 : -0.4, 1 - Math.exp(-2.5 * dt));
        C.heading += Math.sin(a.t * 1.3) * dt * 0.8;
        C.alert = 0.9;
        if (a.listen) C.state = "listen";
        if (a.t >= a.dur) { C.act = null; if (C.state === "listen") setMind("roam"); else { setMind("search"); goTo(C.x, C.z); } }
      } else if (a.kind === "hurt") {
        C.y = lerp(C.y, -1.4, 1 - Math.exp(-3 * dt));
        C.alert = 1.5 * (1 - k);
        const away = Math.atan2(C.x - P.x, C.z - P.z);
        const nx = C.x + Math.sin(away) * 5.5 * dt, nz = C.z + Math.cos(away) * 5.5 * dt;
        if (swimmable(nx, nz)) { C.x = nx; C.z = nz; C.heading = away; }
        if (a.t >= a.dur) { C.act = null; setMind("search"); goTo(C.x, C.z); }
      } else if (a.kind === "die") {
        C.y = lerp(C.y, k < 0.3 ? 1.6 : -1.6, 1 - Math.exp(-2.2 * dt));
        C.heading += Math.sin(a.t * 6) * dt * 2 * (1 - k);
        C.alert = Math.max(0, 1.8 * (1 - k));
        beast.open.value = k < 0.5 ? 1 : 1 - k;
        if (a.t >= a.dur) { C.act = null; C.alive = false; C.state = "dead"; }
      }
      void dP;
    }

    // Lay the body along where the head has been, with a swimming wave.
    function poseBeast(dt) {
      const last = C.trail[0];
      if (!last || Math.hypot(C.x - last.x, C.z - last.z) >= TRAIL) {
        C.trail.unshift({ x: C.x, z: C.z });
        if (C.trail.length > SPINE * 7) C.trail.length = SPINE * 7;
      }
      const tr = C.trail;
      let acc = 0, ti = 0, px = C.x, pz = C.z;
      for (let i = 0; i < SPINE; i++) {
        const need = i * SPINE_GAP;
        while (ti < tr.length - 1) {
          const a = ti === 0 ? { x: C.x, z: C.z } : tr[ti], b = tr[ti + 1];
          const seg = Math.hypot(b.x - a.x, b.z - a.z);
          if (acc + seg >= need) { const f = seg > 1e-6 ? (need - acc) / seg : 0; px = a.x + (b.x - a.x) * f; pz = a.z + (b.z - a.z) * f; break; }
          acc += seg; ti++;
        }
        const t = i / (SPINE - 1);
        const amp = 0.16 * t * Math.min(1, 0.35 + C.speed * 0.3);
        const wave = Math.sin(C.phase * (2.2 + C.speed * 0.8) - i * 0.5) * amp;
        const prev = i > 0 ? beast.spine[i - 1] : null;
        const a2 = prev ? Math.atan2(px - prev.x, pz - prev.z) : C.heading;
        // The front rises with the head; the rest stays down, above the mud.
        let y = C.y - t * 0.25;
        if (C.y > -0.3) y = lerp(C.y, Math.min(C.y, -0.45), smooth(0, 0.35, t));
        const floor = heightAt(swamp, px, pz) + PROFILE[i] * 0.9;
        y = Math.max(y, floor);
        beast.spine[i].set(px + Math.cos(a2) * wave, y + Math.sin(C.phase * 1.2 - i * 0.4) * 0.03, pz - Math.sin(a2) * wave, PROFILE[i]);
      }
      beast.glow.value = lerp(beast.glow.value, C.alert, 1 - Math.exp(-3 * dt));
      beast.group.visible = C.alive || (C.act && C.act.kind === "die") || C.state === "dead";
      poseLure(dt);
      if (beast.lureLight) {
        beast.lureLight.position.copy(beast.lurePos);
        beast.lureLight.intensity = C.alive ? (0.5 + beast.glow.value * 1.6) * (beast.lurePos.y > -0.2 ? 1 : 0.35) : 0;
      }
    }
    /* ================================================================ *
     * THE RUN
     * ================================================================ */
    const COILS_NEED = 5, PARTS_NEED = 5, MAX_DUCKS = 4;
    const state = {
      screen: "menu", t: 0, runStart: 0, seed: 0,
      coils: 0, parts: 0, rockets: 0, rocketsFound: 0, ducks: DUCKS_START, crackers: 0, boots: false, bazooka: false, hits: 0,
      won: false, submitted: false, deathCause: "", best: 0, bestTime: 0, sound: SOUND_DEFAULT, haptics: HAPTICS_DEFAULT, look: 1,
      seen: {}, hints: {}, aiming: false, bellT: -99, genT: -99, notes: 0, dawn: 0, towerSeen: false,
      pages: {}, fuel: false, key: false, escaped: false, deaths: 0
    };
    const RANKS = [
      { at: 0, name: "Drifter" }, { at: 300, name: "Scavenger" }, { at: 1000, name: "Springheel" },
      { at: 2400, name: "Armed" }, { at: 4000, name: "Hunter" }, { at: 10000, name: "Slayer" }
    ];
    function progressScore() {
      let s = state.coils * 100 + state.parts * 150 + state.rocketsFound * 80 + Object.keys(state.seen).length * 25 + state.notes * 40;
      if (state.boots) s += 400;
      if (state.bazooka) s += 700;
      if (state.towerSeen) s += 150;
      if (state.fuel) s += 150;
      if (state.key) s += 150;
      s += state.hits * 1200;
      if (state.won) s += 6000 + Math.max(0, 3000 - Math.floor((state.t - state.runStart) * 2));
      else if (state.escaped) s += 2500 + Math.max(0, 1500 - Math.floor(state.t - state.runStart));
      // Every time you wake at the camp, the swamp keeps a little.
      return Math.max(0, s - state.deaths * 400);
    }
    const rankOf = s => { let r = RANKS[0]; for (const k of RANKS) if (s >= k.at) r = k; return r.name; };

    /* ================================================================ *
     * THINGS TO FIND
     * ================================================================ */
    const ITEM_COL = { coil: "#7fffd4", part: "#ffcf6a", rocket: "#ff6a4f", ducks: "#ffe14d", firecracker: "#ff9a3d", note: "#e9e1cc", fuel: "#ff8a4c", key: "#e7cf72" };
    // Eli's journal: what he learned, and where he left things. Each page
    // that names a place marks it on your map.
    const PAGES = {
      1: { t: "Eli's journal, page one", x: "If you found the canoe, you found this. Stay out of the water. The thing in it is blind, but it hears every step you take in it. Follow the lanterns up the boardwalk to the Fishing Camp. I left the rest on the workbench.", reveal: [] },
      2: { t: "Page two: the boots", x: "Five spring coils, and that bench will make you a pair of jump boots. I hid them where I could: the end of the camp jetty, the stilt village, the chapel graves, the cypress grove, the island west of the pumphouse. Marked on your map.", reveal: ["coil"] },
      3: { t: "Page three: from the tower", x: "From up here you can see all of it. The bazooka came apart when the barge went down. Five pieces: one up here, the barge, the village, the chapel bell tower, the pumphouse. The hermit kept one. Marked.", reveal: ["part"] },
      4: { t: "Page four: rockets", x: "Two rockets in this cabin, two at the boathouse, one on the islet south of the village. A rocket only hurts it with its head out of the water.", reveal: ["rocket"] },
      5: { t: "The hermit's page", x: "It cannot leave a squeaking duck alone. Throw one into deep water from somewhere dry, and wait. When it rears up to bite, that is your shot. Crates of them about; firecrackers at the boathouse.", reveal: ["ducks", "firecracker"] },
      6: { t: "Page six: the bell", x: "They rang this bell for the drowned. It still comes to the ringing, from anywhere in the swamp. Ring it, then be somewhere else.", reveal: [] },
      7: { t: "Page seven: the generator", x: "Start the generator and it hammers the whole channel for thirty seconds, floodlight and all. It always comes to see. There is a can of fuel in here.", reveal: ["fuel"] },
      8: { t: "Page eight: the boat", x: "The boat still runs. It wants fuel -- there is a can in the pumphouse -- and the key, which I keep on me. If you cannot kill it, leave. Do not come looking for me.", reveal: ["fuel", "key"] },
      9: { t: "Eli's last page", x: "It found me in the grove. My lantern is still lit, so you will find this. Take the key. Go.", reveal: ["key"] }
    };
    const PAGE_COUNT = 9;
    const items = [];
    const itemGroup = new THREE.Group();
    scene.add(itemGroup);
    const KIT = (() => {
      const k = { mat: {}, beam: {} };
      const pts = [];
      for (let i = 0; i <= 60; i++) { const a = (i / 60) * Math.PI * 9; pts.push(V3(Math.cos(a) * 0.13, (i / 60) * 0.42 - 0.21, Math.sin(a) * 0.13)); }
      k.coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.022, 6);
      k.part = new THREE.BoxGeometry(0.46, 0.13, 0.13);
      k.ring = new THREE.TorusGeometry(0.11, 0.03, 6, 12);
      k.rocket = new THREE.CylinderGeometry(0.06, 0.06, 0.42, 10);
      k.tip = new THREE.ConeGeometry(0.06, 0.16, 10);
      k.crate = new THREE.BoxGeometry(0.62, 0.38, 0.46);
      k.stick = new THREE.CylinderGeometry(0.03, 0.03, 0.26, 6);
      k.paper = new THREE.PlaneGeometry(0.2, 0.27);
      k.can = new THREE.BoxGeometry(0.26, 0.34, 0.14);
      k.capG = new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8);
      k.keyRing = new THREE.TorusGeometry(0.05, 0.012, 6, 14);
      k.keyBar = new THREE.BoxGeometry(0.13, 0.022, 0.012);
      k.stone = new THREE.IcosahedronGeometry(0.045, 0);
      k.stoneM = new THREE.MeshLambertMaterial({ color: 0x6d6a62 });
      // A crate of ducks as one mesh, coloured by vertex.
      {
        const tint = (geo, c) => { const n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } geo.setAttribute("color", new THREE.BufferAttribute(a, 3)); return geo; };
        const parts = [tint(new THREE.BoxGeometry(0.62, 0.38, 0.46).translate(0, -0.12, 0), [0.42, 0.29, 0.17])];
        for (let d = 0; d < 3; d++) {
          const ox = -0.15 + d * 0.15, oz = (d % 2) * 0.08 - 0.04, s = 0.55, ry = d;
          const place = geo => geo.scale(s, s, s).rotateY(ry).translate(ox, 0.12, oz);
          parts.push(tint(place(new THREE.SphereGeometry(0.12, 10, 7).scale(1.25, 0.85, 1)), [1.0, 0.82, 0.12]));
          parts.push(tint(place(new THREE.SphereGeometry(0.075, 8, 6).translate(0.09, 0.11, 0)), [1.0, 0.82, 0.12]));
          parts.push(tint(place(new THREE.ConeGeometry(0.03, 0.07, 6).rotateZ(-Math.PI / 2).translate(0.17, 0.1, 0)), [1.0, 0.48, 0.1]));
        }
        k.crateFull = mergeGeoms(parts);
        k.crateMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x1c1404 });
      }
      k.paperM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.9, 0.78).multiplyScalar(1.4), side: THREE.DoubleSide });
      k.beamG = new THREE.CylinderGeometry(0.08, 0.3, 3.0, 16, 1, true);
      k.duckBody = new THREE.SphereGeometry(0.12, 12, 8);
      k.duckHead = new THREE.SphereGeometry(0.075, 10, 8);
      k.duckBeak = new THREE.ConeGeometry(0.03, 0.07, 6);
      k.yellow = new THREE.MeshLambertMaterial({ color: 0xffd21f, emissive: 0x3a2a00 });
      k.orange = new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0x301000 });
      k.wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2c, emissive: 0x150c05 });
      k.dark = new THREE.MeshLambertMaterial({ color: 0x1b1f22 });
      k.red = new THREE.MeshLambertMaterial({ color: 0xb3261e, emissive: 0x3a0705 });
      k.flight = new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8);
      k.flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.4).multiplyScalar(4) });
      for (const kind of Object.keys(ITEM_COL)) {
        const c = col(ITEM_COL[kind]);
        k.mat[kind] = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2) });
        k.beam[kind] = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { uC: { value: c.clone().multiplyScalar(0.35) }, uTime: SHARED.uTime },
          vertexShader: /* glsl */`
            varying float vY; varying vec3 vN; varying vec3 vV;
            void main() {
              vY = position.y / 3.0 + 0.5;
              vec4 w = modelMatrix * vec4(position, 1.0);
              vN = normalize(mat3(modelMatrix) * normal);
              vV = cameraPosition - w.xyz;
              gl_Position = projectionMatrix * viewMatrix * w;
            }`,
          fragmentShader: /* glsl */`
            uniform vec3 uC; uniform float uTime;
            varying float vY; varying vec3 vN; varying vec3 vV;
            void main() {
              float f = abs(dot(normalize(vN), normalize(vV)));
              float near = smoothstep(1.0, 4.0, length(vV));
              float a = pow(f, 3.0) * pow(1.0 - vY, 1.8) * (0.75 + 0.25 * sin(uTime * 2.2 - vY * 7.0)) * near;
              gl_FragColor = vec4(uC * a, 1.0);
            }`
        });
      }
      return k;
    })();
    function duckModel(scale) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(KIT.duckBody, KIT.yellow); body.scale.set(1.25, 0.85, 1); g.add(body);
      const head = new THREE.Mesh(KIT.duckHead, KIT.yellow); head.position.set(0.09, 0.11, 0); g.add(head);
      const beak = new THREE.Mesh(KIT.duckBeak, KIT.orange); beak.rotation.z = -Math.PI / 2; beak.position.set(0.17, 0.1, 0); g.add(beak);
      g.scale.setScalar(scale || 1);
      return g;
    }
    function itemMesh(kind) {
      const g = new THREE.Group();
      if (kind === "coil") g.add(new THREE.Mesh(KIT.coil, KIT.mat.coil));
      else if (kind === "part") {
        g.add(new THREE.Mesh(KIT.part, KIT.mat.part));
        const r = new THREE.Mesh(KIT.ring, KIT.dark); r.rotation.y = Math.PI / 2; r.position.x = 0.12; g.add(r);
      } else if (kind === "rocket") {
        const b = new THREE.Mesh(KIT.rocket, KIT.mat.rocket); b.rotation.z = Math.PI / 2; g.add(b);
        const t = new THREE.Mesh(KIT.tip, KIT.dark); t.rotation.z = -Math.PI / 2; t.position.x = 0.29; g.add(t);
      } else if (kind === "ducks") {
        g.add(new THREE.Mesh(KIT.crateFull, KIT.crateMat));
      } else if (kind === "firecracker") {
        for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(KIT.stick, KIT.red); s.position.set((k % 3) * 0.06 - 0.06, 0, Math.floor(k / 3) * 0.06); g.add(s); }
      } else if (kind === "note") {
        const s = new THREE.Mesh(KIT.paper, KIT.paperM); s.rotation.x = -1.2; g.add(s);
      } else if (kind === "fuel") {
        g.add(new THREE.Mesh(KIT.can, KIT.red));
        const c = new THREE.Mesh(KIT.capG, KIT.dark); c.position.set(0.07, 0.2, 0); g.add(c);
      } else if (kind === "key") {
        const r = new THREE.Mesh(KIT.keyRing, KIT.mat.key); g.add(r);
        const b = new THREE.Mesh(KIT.keyBar, KIT.mat.key); b.position.x = 0.11; g.add(b);
      }
      const beam = new THREE.Mesh(KIT.beamG, KIT.beam[kind]);
      beam.position.y = 1.3;
      g.add(beam);
      return g;
    }
    function placeItems() {
      for (const it of items) itemGroup.remove(it.mesh);
      items.length = 0;
      const put = (kind, a, idx) => {
        const mesh = itemMesh(kind);
        mesh.position.set(a.x, a.y, a.z);
        itemGroup.add(mesh);
        items.push({ kind, x: a.x, y: a.y, z: a.z, mesh, taken: false, refill: 0, idx, seen: false, known: false, page: a.page || 0 });
      };
      for (const kind of ["coil", "part", "rocket", "ducks", "firecracker", "note", "fuel", "key"]) (BUILD.anchors[kind] || []).forEach((a, i) => put(kind, a, i));
    }
    function stepItems(dt) {
      const t = SHARED.uTime.value;
      for (const it of items) {
        if (it.taken) continue;
        if (it.kind !== "ducks") { it.mesh.rotation.y += dt * 1.1; it.mesh.position.y = it.y + Math.sin(t * 2 + it.x) * 0.05; }
        if (it.refill > 0) it.refill -= dt;
        if (state.screen !== "play" || !P.alive) continue;
        const d = Math.hypot(P.x - it.x, P.z - it.z);
        if (d < 1.05 && Math.abs(P.y + 0.9 - it.y) < 1.6) take(it);
      }
    }
    function take(it) {
      if (it.kind === "ducks") {
        if (state.ducks >= MAX_DUCKS || it.refill > 0) return;
        state.ducks = MAX_DUCKS; it.refill = 2;
        toast("Rubber ducks", "Hold DUCK to aim. They must land in the water.");
        sfx.pickup(0); haptic("light"); updateHud();
        return;
      }
      it.taken = true;
      itemGroup.remove(it.mesh);
      sfx.pickup(it.kind === "rocket" ? 2 : 1);
      haptic("success");
      if (it.kind === "coil") {
        state.coils++;
        toast("Spring coil " + Math.min(state.coils, COILS_NEED) + " of " + COILS_NEED, state.coils >= COILS_NEED && !state.boots ? "Take them to the workbench at the Fishing Camp" : state.coils === 1 ? "Five make a pair of spring boots" : "");
      } else if (it.kind === "part") {
        state.parts++;
        toast("Bazooka part " + Math.min(state.parts, PARTS_NEED) + " of " + PARTS_NEED, state.parts >= PARTS_NEED && !state.bazooka ? "Take them to the workbench" : "");
      } else if (it.kind === "rocket") {
        state.rockets++; state.rocketsFound++;
        toast("Rocket", state.bazooka ? "Loaded" : "Useless without the bazooka -- for now");
      } else if (it.kind === "firecracker") {
        state.crackers += 3;
        toast("Firecrackers", "Three bangs. It will come to see. Throw with DUCK once the ducks are gone.");
      } else if (it.kind === "note") {
        state.notes++;
        const pg = PAGES[it.page] || PAGES[1];
        state.pages[it.page] = true;
        let marked = 0;
        for (const o of items) if (!o.taken && !o.known && pg.reveal.includes(o.kind)) { o.known = true; marked++; }
        showPage(pg, marked);
        sfx.page();
      } else if (it.kind === "fuel") {
        state.fuel = true;
        toast("A can of fuel", state.key ? "The boat at the boathouse can go now." : "The boat at the boathouse wants a key as well.");
      } else if (it.kind === "key") {
        state.key = true;
        toast("Eli's key", state.fuel ? "Fuel and key: the boat at the boathouse can go." : "The boat wants fuel as well: a can in the pumphouse.");
      }
      ctx.platform.interact({ type: "pickup", item: it.kind });
      if (track) track.set(progressScore());
      updateHud();
    }

    /* ---- the workbench, the bell, the generator ---- */
    function nearInteract() {
      if (state.screen !== "play" || !P.alive) return null;
      let best = null;
      for (const it of BUILD.interact) {
        const d = Math.hypot(P.x - it.x, P.z - it.z);
        if (d > it.r || Math.abs(P.y + 1 - it.y) > 2.2) continue;
        if (!best || d < best.d) best = { it, d };
      }
      if (!best) return null;
      const it = best.it;
      if (it.kind === "bench") {
        if (!state.boots && state.coils >= COILS_NEED) return { it, label: "Make boots" };
        if (!state.bazooka && state.parts >= PARTS_NEED) return { it, label: "Build bazooka" };
        return { it, label: "Workbench", idle: true };
      }
      if (it.kind === "bell") return state.t - state.bellT > 25 ? { it, label: "Ring bell" } : { it, label: "Bell", idle: true };
      if (it.kind === "generator") return state.t - state.genT > 40 ? { it, label: "Start it" } : { it, label: "Running", idle: true };
      if (it.kind === "boat") return state.fuel && state.key ? { it, label: "Start the boat" } : { it, label: "The boat", idle: true };
      return null;
    }
    function useThing() {
      const n = nearInteract();
      if (!n || n.idle) {
        if (n && n.it.kind === "bench") toast("The workbench", `Spring boots need ${COILS_NEED} coils (${state.coils}). The bazooka needs ${PARTS_NEED} parts (${state.parts}).`);
        if (n && n.it.kind === "boat") toast("The boat", `It needs ${state.fuel ? "" : "fuel (the pumphouse)"}${!state.fuel && !state.key ? " and " : ""}${state.key ? "" : "a key (Eli had it)"}.`);
        return;
      }
      const it = n.it;
      if (it.kind === "bench") {
        if (!state.boots && state.coils >= COILS_NEED) {
          state.boots = true;
          sfx.craft(); haptic("success");
          toast("Spring boots", "Jump higher and twice as far. Stay out of the water.");
          ctx.platform.milestone && ctx.platform.milestone("boots", { score: progressScore() });
        } else if (!state.bazooka && state.parts >= PARTS_NEED) {
          state.bazooka = true;
          sfx.craft(); haptic("success");
          toast("The bazooka", state.rockets ? "Lure it up. Shoot it while its head is out of the water." : "Now it needs rockets");
          ctx.platform.milestone && ctx.platform.milestone("bazooka", { score: progressScore() });
          // The swamp takes notice.
          weather.next = Math.min(weather.next, 40);
        }
      } else if (it.kind === "bell") {
        state.bellT = state.t;
        sfx.bell(it.x, it.z);
        haptic("medium");
        const c = nearestNav(it.x - 14, it.z, 20);
        const [lx, lz] = c >= 0 ? centreOfCell(c) : [it.x, it.z];
        beastHear(lx, lz, 3, "bell", { x: lx, z: lz });
        toast("The bell", "Every ear in the water heard that.");
      } else if (it.kind === "generator") {
        state.genT = state.t;
        sfx.generator(it.x, it.z, 30);
        const c = nearestNav(it.x + 6, it.z, 20);
        const [lx, lz] = c >= 0 ? centreOfCell(c) : [it.x, it.z];
        beastHear(lx, lz, 3, "generator", { x: lx, z: lz });
        for (const L of BUILD.lamps) if (L.gen) L.until = state.t + 30;
        toast("The generator", "It hammers into the water. Thirty seconds.");
      } else if (it.kind === "boat") {
        startEscape();
      }
      updateHud();
    }

    /* ================================================================ *
     * DUCKS, FIRECRACKERS, ROCKETS
     * ================================================================ */
    const ducks = [];
    const arc = (() => {
      const N = 40, g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
        uniforms: { uC: { value: new THREE.Color(0.6, 0.95, 1.0) }, uScale: { value: 600 } },
        vertexShader: `uniform float uScale; varying float vK; void main(){ vK = float(gl_VertexID) / 40.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 0.05 * uScale / max(-mv.z, 0.3); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.5, 1.0, d)) * (0.4 + 0.6 * (1.0 - vK)); gl_FragColor = vec4(uC * a * 1.6, 1.0); }`
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 7;
      scene.add(pts);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 7;
      scene.add(ring);
      return { pts, ring, N, mat: m, wet: false };
    })();
    function throwVelocity() {
      const dir = V3(0, 0, -1).applyQuaternion(camera.quaternion);
      return { x: dir.x * 10 + P.vx * 0.5, y: dir.y * 10 + 3.4, z: dir.z * 10 + P.vz * 0.5, ox: camera.position.x + dir.x * 0.4, oy: camera.position.y - 0.2, oz: camera.position.z + dir.z * 0.4 };
    }
    // Where a throw would go, for the dotted arc.
    function traceThrow(v, out) {
      let x = v.ox, y = v.oy, z = v.oz, vx = v.x, vy = v.y, vz = v.z;
      const dt = 1 / 30;
      let k = 0, landed = null;
      for (let s = 0; s < 90 && !landed; s++) {
        vy -= GRAV * 0.7 * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        const g = groundAt(x, z, y + 0.3).g;
        if (y <= Math.max(g, WATER_Y)) landed = { x, z, y: Math.max(g, WATER_Y), wet: WATER_Y > g + 0.05 };
        if (out && s % 2 === 0 && k < arc.N) { out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z; k++; }
      }
      if (out) for (; k < arc.N; k++) { out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z; }
      return landed;
    }
    function updateArc() {
      const show = !!state.aiming && state.screen === "play" && P.alive && (state.aiming === "stone" || state.ducks > 0 || state.crackers > 0);
      arc.pts.visible = show; arc.ring.visible = show;
      if (!show) return;
      camera.updateMatrixWorld();
      const arr = arc.pts.geometry.attributes.position.array;
      const land = traceThrow(throwVelocity(), arr);
      arc.pts.geometry.attributes.position.needsUpdate = true;
      if (land) {
        arc.ring.position.set(land.x, land.y + 0.03, land.z);
        arc.ring.material.color.set(land.wet ? 0x9fe8ff : 0xff7a6a);
        arc.mat.uniforms.uC.value.set(land.wet ? 0x9fe8ff : 0xff7a6a);
      }
    }
    function throwLure() {
      if (state.screen !== "play" || !P.alive) return;
      const cracker = state.ducks <= 0;
      if (cracker && state.crackers <= 0) { toast("Out of ducks", "There are crates at the camps"); return; }
      if (cracker) state.crackers--; else state.ducks--;
      camera.updateMatrixWorld();
      const v = throwVelocity();
      const m = cracker ? (() => { const g = new THREE.Group(); for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(KIT.stick, KIT.red); s.position.x = k * 0.05; g.add(s); } return g; })() : duckModel(1);
      scene.add(m);
      ducks.push({ mesh: m, x: v.ox, y: v.oy, z: v.oz, vx: v.x, vy: v.y, vz: v.z, state: "fly", t: 0, squeakT: 0, cracker, bangs: 0 });
      sfx.whoosh();
      updateHud();
    }
    // A stone: always to hand. A plop somewhere else draws it there.
    let stoneT = -9;
    function throwStone() {
      if (state.screen !== "play" || !P.alive || state.t - stoneT < 1.2) return;
      stoneT = state.t;
      camera.updateMatrixWorld();
      const v = throwVelocity();
      const m = new THREE.Mesh(KIT.stone, KIT.stoneM);
      scene.add(m);
      ducks.push({ mesh: m, x: v.ox, y: v.oy, z: v.oz, vx: v.x * 1.15, vy: v.y, vz: v.z * 1.15, state: "fly", t: 0, squeakT: 0, stone: true, bangs: 0 });
      sfx.whoosh();
      if (!state.hints.stone) state.hints.stone = true;
    }
    function stepDucks(dt) {
      for (let i = ducks.length - 1; i >= 0; i--) {
        const d = ducks[i];
        d.t += dt;
        if (d.state === "fly") {
          d.vy -= GRAV * 0.7 * dt;
          const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt, nz = d.z + d.vz * dt;
          const g = groundAt(nx, nz, d.y + 0.2).g;
          // Walls: bounce off anything built.
          let hit = false;
          for (const c of nearColliders(nx, nz, 0.2)) {
            if (c.round) continue;
            const [lx, lz] = localOf(c, nx, nz);
            if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz && ny > c.y0 && ny < c.y1 && c.y1 - c.y0 > 0.3) { hit = true; break; }
          }
          if (hit) { d.vx *= -0.3; d.vz *= -0.3; }
          else { d.x = nx; d.z = nz; }
          d.y = ny;
          const wet = WATER_Y > g + 0.05;
          if (d.stone && d.y <= (wet ? WATER_Y : g)) {
            // Plop: gone, and a ring of sound where it went in.
            sfx.plop(d.x, d.z, wet);
            if (wet) { addRipple(d.x, d.z, 0.05, 1); makeNoise(d.x, d.z, 1.4, "stone"); for (let k = 0; k < 8; k++) spawnParticle(d.x, 0.05, d.z, (Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2, 0.6, 0.04, [0.45, 0.7, 0.75]); }
            d.state = "gone";
          } else if (d.y <= (wet ? WATER_Y : g)) {
            if (wet) {
              d.state = "float"; d.t = 0; d.y = WATER_Y + 0.03;
              burstSplash(d.x, d.z, 1.1);
              sfx.duckSplash(d.x, d.z);
              if (!d.cracker) beastHear(d.x, d.z, 2, "duck", d);
              else d.fuse = 1.6;
            } else {
              d.y = g; d.vy *= -0.25; d.vx *= 0.5; d.vz *= 0.5;
              if (Math.abs(d.vy) < 1.2) {
                d.state = "rest"; d.t = 0;
                if (!d.cracker && !state.hints.landDuck) { state.hints.landDuck = true; toast("On dry ground", "It cannot hear a duck out of the water"); }
                if (d.cracker) d.fuse = 1.6;
              }
            }
          }
          d.mesh.rotation.x += dt * 6; d.mesh.rotation.z += dt * 4;
        } else if (d.state === "float") {
          d.y = WATER_Y + 0.03 + Math.sin(d.t * 3) * 0.02;
          d.mesh.rotation.x = lerp(d.mesh.rotation.x, 0, 0.1); d.mesh.rotation.z = lerp(d.mesh.rotation.z, 0, 0.1);
          d.mesh.rotation.y += dt * 0.4;
          if (!d.cracker) {
            d.squeakT += dt;
            if (d.squeakT > 1.6 && d.t < 40) { d.squeakT = 0; sfx.squeak(d.x, d.z); addRipple(d.x, d.z, 0.02, 1); beastHear(d.x, d.z, 1.4, "duck", d); }
            if (d.t > 60) d.state = "gone";
          }
        } else if (d.state === "bitten") {
          d.y = lerp(d.y, 1.0, 0.1);
        } else if (d.state === "rest") {
          if (!d.cracker && d.t > 30) d.state = "gone";
        }
        // Firecrackers: a fuse, then four bangs.
        if (d.cracker && d.fuse !== undefined && d.state !== "fly") {
          d.fuse -= dt;
          if (d.fuse <= 0 && d.bangs < 4) {
            d.bangs++; d.fuse = 0.35 + Math.random() * 0.3;
            sfx.bang(d.x, d.z);
            for (let k = 0; k < 10; k++) spawnParticle(d.x, d.y + 0.2, d.z, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, 0.4, 0.08, [1.6, 1.0, 0.4]);
            const wet = WATER_Y > groundAt(d.x, d.z, d.y + 0.5).g + 0.05;
            if (wet) { addRipple(d.x, d.z, 0.05, 1); beastHear(d.x, d.z, 2.5, "firecracker", { x: d.x, z: d.z }); }
            if (d.bangs >= 4) d.state = "gone";
          }
        }
        d.mesh.position.set(d.x, d.y, d.z);
        if (d.state === "gone") { scene.remove(d.mesh); ducks.splice(i, 1); }
      }
    }

    // The bazooka in your hand.
    const GUN_REST = V3(0.2, -0.24, -0.6);
    const gun = new THREE.Group();
    let gunLamp = null;
    {
      const metal = new THREE.MeshLambertMaterial({ color: 0x3b4a43, emissive: 0x0a0f0d });
      const dark = new THREE.MeshLambertMaterial({ color: 0x1c2320, emissive: 0x050706 });
      const brass = new THREE.MeshLambertMaterial({ color: 0xc9a250, emissive: 0x2a1d05 });
      const along = (m, z) => { m.rotation.x = Math.PI / 2; m.position.z = z; gun.add(m); return m; };
      along(new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.86, 18), metal), 0);
      along(new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.068, 0.11, 18), brass), -0.47);
      along(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 18), dark), -0.53);
      along(new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.09, 0.13, 18), metal), 0.47);
      for (const z of [-0.22, 0.16]) along(new THREE.Mesh(new THREE.CylinderGeometry(0.071, 0.071, 0.035, 18), brass), z);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.15, 0.06), dark); grip.position.set(0, -0.12, -0.02); grip.rotation.x = 0.25; gun.add(grip);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.07, 0.05), brass); sight.position.set(0, 0.095, -0.12); gun.add(sight);
      gunLamp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4b3e })); gunLamp.position.set(-0.07, 0.03, -0.05); gun.add(gunLamp);
      gun.position.copy(GUN_REST); gun.rotation.set(0.02, 0.05, 0); gun.visible = false;
      camera.add(gun);
    }
    // And the lantern in the other: the warm light you carry.
    const lantern = new THREE.Group();
    const handLight = new THREE.PointLight(col("#ffc78c"), 0, 13, 2);
    {
      const frameM = new THREE.MeshLambertMaterial({ color: 0x222018, emissive: 0x070604 });
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.28).multiplyScalar(5) }));
      lantern.add(glass);
      for (const y of [-0.07, 0.07]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 10), frameM); r.position.y = y; lantern.add(r); }
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 4, 10, Math.PI), frameM); handle.position.y = 0.08; lantern.add(handle);
      lantern.position.set(-0.26, -0.3, -0.5);
      camera.add(lantern);
      handLight.position.set(-0.2, -0.15, -0.3);
      camera.add(handLight);
    }

    const rockets = [];
    function fire() {
      if (state.screen !== "play" || !P.alive || !state.bazooka) return;
      if (P.medium === "swim") { toast("Not while swimming", "Find your feet first"); return; }
      if (state.rockets <= 0) { toast("No rockets", "Crates of them: the barge, the boathouse, the village"); sfx.click(); return; }
      state.rockets--;
      camera.updateMatrixWorld();
      const dir = V3(0, 0, -1).applyQuaternion(camera.quaternion);
      const start = V3(0.2, -0.2, -0.95).applyMatrix4(camera.matrixWorld);
      const m = new THREE.Mesh(KIT.flight, KIT.flame);
      m.quaternion.setFromUnitVectors(V3(0, 1, 0), dir);
      scene.add(m);
      rockets.push({ mesh: m, p: start, v: dir.multiplyScalar(32), t: 0, smoke: 0 });
      gun.position.z = GUN_REST.z + 0.14;
      P.shake = Math.max(P.shake, 0.35);
      sfx.fire(); haptic("heavy");
      updateHud();
    }
    function stepRockets(dt) {
      gun.position.z = lerp(gun.position.z, GUN_REST.z, 1 - Math.exp(-8 * dt));
      gunLamp.material.color.set(state.rockets > 0 ? 0xff4b3e : 0x2a1513);
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.t += dt;
        r.v.y -= 2.2 * dt;
        let boom = null;
        for (let s = 0; s < 4 && !boom; s++) {
          r.p.addScaledVector(r.v, dt / 4);
          const { x, y, z } = r.p;
          if (C.alive) for (let k = 0; k < SPINE; k += 2) {
            const sp = beast.spine[k];
            if ((sp.x - x) ** 2 + (sp.y - y) ** 2 + (sp.z - z) ** 2 < (sp.w + 0.5) ** 2) { boom = { x, y, z, direct: true }; break; }
          }
          if (boom) break;
          const g = groundAt(x, z, y + 0.3).g;
          if (y < Math.max(g, WATER_Y) || r.t > 3.5) { boom = { x, y: Math.max(y, WATER_Y), z, direct: false }; break; }
          for (const c of nearColliders(x, z, 0.1)) {
            if (c.round) continue;
            const [lx, lz] = localOf(c, x, z);
            if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz && y > c.y0 && y < c.y1) { boom = { x, y, z, direct: false }; break; }
          }
          if (!boom) for (const t of nearTrees(x, z)) if (Math.hypot(t.x - x, t.z - z) < t.r + 0.1 && y < t.y + 12) { boom = { x, y, z, direct: false }; break; }
        }
        r.mesh.position.copy(r.p);
        r.smoke += dt;
        if (r.smoke > 0.025) { r.smoke = 0; spawnParticle(r.p.x, r.p.y, r.p.z, 0, 0.2, 0, 0.5, 0.12, [1.2, 0.6, 0.3], 0); }
        if (boom) { scene.remove(r.mesh); rockets.splice(i, 1); explode(boom); }
      }
    }
    function explode(b) {
      sfx.explode(b.x, b.z);
      for (let k = 0; k < 7; k++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.35;
        const q = spawnParticle(b.x + Math.cos(a) * r, b.y + 0.25 + Math.random() * 0.4, b.z + Math.sin(a) * r, Math.cos(a) * 0.8, 0.6 + Math.random(), Math.sin(a) * 0.8, 0.26 + Math.random() * 0.22, 0.7 + Math.random() * 0.7, [2.2, 1.2, 0.5], 0);
        q.grow = 1.2;
      }
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2, u = Math.random();
        spawnParticle(b.x, b.y + 0.1, b.z, Math.cos(a) * 6 * u, 2 + Math.random() * 6, Math.sin(a) * 6 * u, 0.9, 0.1, [1.4, 0.8 - u * 0.4, 0.3]);
      }
      const wet = WATER_Y > groundAt(b.x, b.z, b.y + 0.5).g + 0.05;
      if (wet) {
        burstSplash(b.x, b.z, 2.8);
        for (let k = 0; k < 46; k++) {
          const a = Math.random() * Math.PI * 2, u = Math.random();
          spawnParticle(b.x + Math.cos(a) * u * 0.5, 0.05, b.z + Math.sin(a) * u * 0.5, Math.cos(a) * 1.4 * u, 5 + Math.random() * 5, Math.sin(a) * 1.4 * u, 1.1 + Math.random() * 0.5, 0.07 + Math.random() * 0.08, [0.55, 0.8, 0.85]);
        }
      }
      flashScreen(1.0, 0.65, 0.35, 0.5, 0.5);
      P.shake = Math.max(P.shake, 0.7 * clamp(1 - Math.hypot(b.x - P.x, b.z - P.z) / 20, 0.2, 1));
      if (C.alive && !(C.act && C.act.kind === "die")) {
        let near = 1e9, exposed = false;
        for (let k = 0; k < 8; k++) {
          const sp = beast.spine[k];
          near = Math.min(near, Math.hypot(sp.x - b.x, sp.y - b.y, sp.z - b.z));
          if (sp.y > -0.35) exposed = true;
        }
        if ((b.direct || near < 2.3) && exposed) hurtBeast();
        else if (near < 4) { C.lastX = b.x; C.lastZ = b.z; C.heardAt = state.t; setMind("hunt"); goTo(b.x, b.z); }
      }
      if (wet) beastHear(b.x, b.z, 3, "boom");
      if (P.medium !== "dry" && Math.hypot(b.x - P.x, b.z - P.z) < 2.2) { state.deathCause = "Caught in your own blast."; killPlayer(); }
    }
    function hurtBeast() {
      state.hits++; C.hp--; C.rage++;
      sfx.beastHurt(C.x, C.z);
      haptic("heavy");
      if (track) track.set(progressScore());
      if (C.hp <= 0) {
        C.act = { kind: "die", t: 0, dur: 4.2 };
        state.won = true;
        sfx.beastDeath(C.x, C.z);
        toast("It is dead", "The water is still");
        after(6.5, () => finishRun(true));
      } else {
        C.act = { kind: "hurt", t: 0, dur: 5.5 };
        toast("Hit " + state.hits + " of " + CREATURE_HP, C.hp === 1 ? "One more" : "It will be faster now, and angrier");
      }
    }

    /* ================================================================ *
     * PARTICLES: spray, sparks, fireballs, bubbles -- one draw call
     * ================================================================ */
    const PART_MAX = 500;
    const pBuf = { pos: new Float32Array(PART_MAX * 3), col: new Float32Array(PART_MAX * 3), size: new Float32Array(PART_MAX), live: [] };
    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute("position", new THREE.BufferAttribute(pBuf.pos, 3));
    pGeom.setAttribute("color", new THREE.BufferAttribute(pBuf.col, 3));
    pGeom.setAttribute("size", new THREE.BufferAttribute(pBuf.size, 1));
    const pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */`attribute float size; uniform float uScale; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = color; gl_PointSize = size * uScale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 3.2) * (1.0 - smoothstep(0.85, 1.0, d)); gl_FragColor = vec4(vC * a, 1.0); }`
    });
    const pPoints = new THREE.Points(pGeom, pMat);
    pPoints.frustumCulled = false; pPoints.renderOrder = 5;
    scene.add(pPoints);
    function spawnParticle(x, y, z, vx, vy, vz, life, size, rgb, grav) {
      if (pBuf.live.length >= PART_MAX) pBuf.live.shift();
      const q = { x, y, z, vx, vy, vz, life, t: 0, size, r: rgb[0], g: rgb[1], b: rgb[2], grav: grav === undefined ? 9 : grav, grow: 0 };
      pBuf.live.push(q);
      return q;
    }
    function bubble(x, z, spread) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (spread || 0.3);
      const fl = heightAt(swamp, x, z);
      spawnParticle(x + Math.cos(a) * r, Math.max(fl, -1.6) + 0.1, z + Math.sin(a) * r, 0, 0.4, 0, 4, 0.04 + Math.random() * 0.04, [0.3, 0.6, 0.62], -1.4);
    }
    function burstSplash(x, z, loud) {
      const n = Math.floor(10 + loud * 14);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * 1.6 * loud;
        spawnParticle(x + Math.cos(a) * 0.2, 0.05, z + Math.sin(a) * 0.2, Math.cos(a) * s, 1.5 + Math.random() * 2.5 * loud, Math.sin(a) * s, 0.7 + Math.random() * 0.4, 0.05 + Math.random() * 0.05, [0.45, 0.7, 0.75]);
      }
      addRipple(x, z, clamp(0.03 + loud * 0.025, 0.03, 0.1), 1);
    }
    function stepParticles(dt) {
      const L = pBuf.live;
      for (let i = L.length - 1; i >= 0; i--) {
        const q = L[i];
        q.t += dt;
        if (q.t >= q.life) { L.splice(i, 1); continue; }
        q.vy -= q.grav * dt;
        if (q.grav < 0) { q.vy = Math.min(q.vy, 1.0); q.vx += Math.sin(q.t * 9 + q.size * 100) * dt * 0.5; }
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.grav > 0 && q.y < WATER_Y && q.vy < 0 && WATER_Y > heightAt(swamp, q.x, q.z)) q.t = q.life;
        else if (q.grav < 0 && q.y > WATER_Y - 0.03) { q.t = q.life; if (Math.random() < 0.35) addRipple(q.x, q.z, 0.006); }
      }
      const n = Math.min(L.length, PART_MAX);
      for (let i = 0; i < n; i++) {
        const q = L[i], a = 1 - q.t / q.life;
        pBuf.pos[i * 3] = q.x; pBuf.pos[i * 3 + 1] = q.y; pBuf.pos[i * 3 + 2] = q.z;
        pBuf.col[i * 3] = q.r * a; pBuf.col[i * 3 + 1] = q.g * a; pBuf.col[i * 3 + 2] = q.b * a;
        pBuf.size[i] = q.size * (1 + q.grow * (q.t / q.life));
      }
      for (let i = n; i < PART_MAX; i++) pBuf.size[i] = 0;
      pGeom.attributes.position.needsUpdate = true; pGeom.attributes.color.needsUpdate = true; pGeom.attributes.size.needsUpdate = true;
      pGeom.setDrawRange(0, Math.max(1, n));
    }

    /* ================================================================ *
     * WEATHER
     * Now and then the rain comes. Under it the water is loud
     * everywhere and the thing hears you at half the distance -- and
     * the lightning shows it to you.
     * ================================================================ */
    const weather = { rain: 0, target: 0, next: 210, bolt: 8, flash: 0, boltT: -99, warned: false };
    const rain = (() => {
      const N = 2200, pos = new Float32Array(N * 3), seed = new Float32Array(N);
      for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 30; pos[i * 3 + 1] = Math.random() * 14; pos[i * 3 + 2] = (Math.random() - 0.5) * 30; seed[i] = Math.random(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: SHARED.uTime, uRain: { value: 0 }, uCam: { value: V3() }, uScale: { value: 600 }, uFlash: { value: 0 } },
        vertexShader: /* glsl */`
          uniform float uTime, uRain, uScale; uniform vec3 uCam; attribute float aSeed; varying float vA;
          void main() {
            vec3 p = position;
            p.y = mod(p.y - uTime * (10.0 + aSeed * 3.0), 14.0) - 3.0;
            p.xz = mod(p.xz - uCam.xz + 15.0, 30.0) - 15.0;
            vec3 w = vec3(uCam.x + p.x, uCam.y + p.y - 2.0, uCam.z + p.z);
            vA = step(aSeed, uRain) * smoothstep(-0.2, 1.0, w.y);
            vec4 mv = viewMatrix * vec4(w, 1.0);
            gl_PointSize = 0.12 * uScale / max(-mv.z, 0.4);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform float uFlash;
          varying float vA;
          void main() {
            vec2 q = gl_PointCoord - 0.5;
            float a = (1.0 - smoothstep(0.015, 0.05, abs(q.x))) * (1.0 - smoothstep(0.25, 0.5, abs(q.y))) * vA;
            gl_FragColor = vec4(vec3(0.55, 0.65, 0.78) * a * (0.6 + uFlash * 2.0), 1.0);
          }`
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false; pts.renderOrder = 8;
      scene.add(pts);
      return { pts, mat: m };
    })();
    // A bolt: a jagged ribbon from the cloud to the trees, far off, facing you.
    const bolt = (() => {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.8, 1).multiplyScalar(20), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = -5;
      scene.add(mesh);
      return { mesh, mat };
    })();
    function strike() {
      // Ahead of you, give or take, a long way off: it is meant to be seen.
      const yaw = P.yaw + (Math.random() - 0.5) * 1.3, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const d = 150 + Math.random() * 70, cx = camera.position.x + fx * d, cz = camera.position.z + fz * d;
      const sx = -fz, sz = fx, P3 = [], I = [];
      const ribbon = (x0, y0, segs, w, lean) => {
        let x = x0, y = y0;
        for (let k = 0; k < segs; k++) {
          const nx = x + (Math.random() - 0.5) * 11 + lean, ny = y - (y - 3) / (segs - k + 0.3) * (0.7 + Math.random() * 0.6);
          const b = P3.length / 3;
          for (const [px, py, ww] of [[x, y, w], [nx, ny, w * 0.9]]) {
            P3.push(cx + sx * (px - ww), py, cz + sz * (px - ww), cx + sx * (px + ww), py, cz + sz * (px + ww));
          }
          I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
          if (k > 1 && k < segs - 2 && Math.random() < 0.3 && w > 0.4) ribbon(nx, ny, 3 + Math.floor(Math.random() * 3), w * 0.45, (Math.random() - 0.5) * 6);
          x = nx; y = ny;
        }
      };
      ribbon(0, 105 + Math.random() * 25, 13, 0.75, 0);
      const g = bolt.mesh.geometry;
      g.setAttribute("position", new THREE.Float32BufferAttribute(P3, 3));
      g.setIndex(I);
      g.computeBoundingSphere();
      skyMat.uniforms.uBoltDir.value.set(cx - camera.position.x, 60, cz - camera.position.z).normalize();
      weather.boltT = state.t;
      const delay = d / 340 + 0.15;
      after(delay, () => sfx.thunder(clamp(1.3 - d / 260, 0.35, 1)));
      if (!state.hints.lightning && state.screen === "play") { state.hints.lightning = true; after(1.2, () => toast("Lightning", "For a moment you can see the whole swamp -- and anything in it.")); }
    }
    function stepWeather(dt) {
      if (state.screen === "play" && STORMS) {
        weather.next -= dt;
        // It announces itself: thunder a long way off, then the rain.
        if (weather.target === 0 && !weather.warned && weather.next < 14) {
          weather.warned = true;
          sfx.thunder(0.3);
          if (!state.hints.storm) { state.hints.storm = true; toast("Thunder", "A storm is coming. While it rains, it can barely hear you."); }
        }
        if (weather.next <= 0) {
          if (weather.target === 0) { weather.target = 1; weather.next = 60 + Math.random() * 30; weather.bolt = 6; }
          else { weather.target = 0; weather.next = 150 + Math.random() * 110; weather.warned = false; }
        }
      } else weather.target = state.screen === "menu" ? 0 : weather.target;
      weather.rain = lerp(weather.rain, weather.target, 1 - Math.exp(-dt / 5));
      if (weather.rain > 0.6 && state.screen !== "menu") {
        weather.bolt -= dt;
        if (weather.bolt <= 0) { weather.bolt = 11 + Math.random() * 16; strike(); }
      }
      // A flash is a flicker: bright, nearly gone, bright again, fading.
      const age = state.t - weather.boltT;
      let f = 0;
      if (age >= 0 && age < 1.5) f = age < 0.06 ? 1 : age < 0.13 ? 0.1 : age < 0.2 ? 0.85 : 0.85 * Math.exp(-(age - 0.2) * 5) + 0.06 * (1 - age / 1.5);
      weather.flash = f;
      bolt.mesh.visible = age >= 0 && age < 0.42 && (age < 0.06 || age > 0.13);
      bolt.mat.color.setRGB(0.75, 0.8, 1).multiplyScalar(20 * Math.max(f, 0.3));
      skyMat.uniforms.uFlash.value = f;
      rain.mat.uniforms.uFlash.value = f;
      SHARED.uWind.value = 1 + weather.rain * 1.6;
      rain.mat.uniforms.uRain.value = weather.rain;
      rain.mat.uniforms.uCam.value.copy(camera.position);
      waterMat.uniforms.uRain.value = weather.rain;
      sfx.rain(weather.rain);
    }
    /* ================================================================ *
     * SOUND
     * Everything is synthesised. The swamp sings -- frogs, crickets, an
     * owl far off -- and goes quiet when the thing is near. The Listener
     * is placed in 3D so you can hear where it is.
     * ================================================================ */
    const sfx = (() => {
      const AC = window.AudioContext || window.webkitAudioContext;
      const noop = () => {};
      const names = ["unlock", "setEnabled", "update", "step", "wade", "splash", "climb", "drip", "land", "jump", "rung", "bonk", "pickup", "craft", "click", "whoosh",
        "duckSplash", "squeak", "bang", "bell", "generator", "fire", "explode", "thunder", "rain", "beastClick", "beastGrowl", "beastRoar", "beastBite", "beastHurt",
        "beastDeath", "beastBreath", "death", "win", "creak", "plop", "chime", "page", "motor", "stopMotor", "thud"];
      const api = {};
      for (const n of names) api[n] = noop;
      if (!AC || !ctx.capabilities.audio) return api;
      let ac = null, master = null, dry = null, verb = null, noiseBuf = null, voice = null, heart = null, amb = null, rainN = null;
      function ready() {
        if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return ac; }
        try { ac = new AC(); } catch (e) { return null; }
        ctx.onDestroy(() => { try { ac.close(); } catch (e) { /* closed already */ } });
        master = ac.createGain(); master.gain.value = state.sound ? 0.9 : 0;
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        master.connect(comp).connect(ac.destination);
        dry = ac.createGain(); dry.connect(master);
        // Open air over water: a dark, middling tail.
        verb = ac.createConvolver();
        const len = Math.floor(ac.sampleRate * 2.4), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
          const d = ir.getChannelData(ch);
          let lp = 0;
          for (let i = 0; i < len; i++) { const t = i / len; lp = lp * 0.82 + (Math.random() * 2 - 1) * 0.18; d[i] = lp * Math.pow(1 - t, 2.6) * (i < 300 ? i / 300 : 1); }
        }
        verb.buffer = ir;
        const wet = ac.createGain(); wet.gain.value = 0.7;
        verb.connect(wet).connect(master);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        startAmbience();
        startVoice();
        return ac;
      }
      const out = (node, send) => { node.connect(dry); const s = ac.createGain(); s.gain.value = send === undefined ? 0.35 : send; node.connect(s).connect(verb); };
      function panner(x, y, z, hrtf) {
        const p = ac.createPanner();
        p.panningModel = hrtf ? "HRTF" : "equalpower"; p.distanceModel = "inverse"; p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 200;
        if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
        return p;
      }
      // A one-off placed sound; its node lets go when it is done.
      const atPos = (x, y, z, life, hrtf) => {
        const p = panner(x, y, z, hrtf);
        out(p, 0.5);
        ctx.timeout(() => { try { p.disconnect(); } catch (e) { /* gone */ } }, (life || 2) * 1000 + 600);
        return p;
      };
      function noise(at, dur, f0, f1, q, peak, type, dest, send) {
        const src = ac.createBufferSource(); src.buffer = noiseBuf;
        const f = ac.createBiquadFilter(); f.type = type || "bandpass"; f.Q.value = q || 1;
        f.frequency.setValueAtTime(f0, at); if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.012, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        src.connect(f).connect(g);
        if (dest) g.connect(dest); else out(g, send);
        src.start(at, Math.random() * 1.5); src.stop(at + dur + 0.05);
      }
      function tone(at, dur, f0, f1, type, peak, dest, send) {
        const o = ac.createOscillator(); o.type = type || "sine";
        o.frequency.setValueAtTime(f0, at); if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.01, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g);
        if (dest) g.connect(dest); else out(g, send);
        o.start(at); o.stop(at + dur + 0.05);
      }
      // A swell: noise that rises and ebbs, the shape of moving water.
      function swell(at, dur, f0, f1, peak, type, dest, send) {
        const src = ac.createBufferSource(); src.buffer = noiseBuf;
        const f = ac.createBiquadFilter(); f.type = type || "lowpass"; f.Q.value = 0.8;
        f.frequency.setValueAtTime(f0, at); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), at + dur);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        src.connect(f).connect(g);
        if (dest) g.connect(dest); else out(g, send === undefined ? 0.4 : send);
        src.start(at, Math.random() * 1.5); src.stop(at + dur + 0.05);
      }
      // A bubble: a sine that rises in pitch as it shrinks -- the sound
      // that makes water sound like water.
      function bub(at, f, dur, amp, dest) {
        const o = ac.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(f, at);
        o.frequency.exponentialRampToValueAtTime(f * (1.5 + Math.random() * 0.9), at + dur);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(amp, at + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g);
        if (dest) g.connect(dest); else out(g, 0.3);
        o.start(at); o.stop(at + dur + 0.02);
      }
      function bubbles(at, n, spread, fLo, fHi, amp, dest) {
        for (let i = 0; i < n; i++) {
          const t = at + Math.pow(Math.random(), 1.4) * spread;
          bub(t, fLo * Math.pow(fHi / fLo, Math.random()), 0.025 + Math.random() * 0.07, amp * (0.35 + Math.random() * 0.65), dest);
        }
      }
      function startAmbience() {
        // Wind in the trees.
        const w = ac.createBufferSource(); w.buffer = noiseBuf; w.loop = true;
        const wf = ac.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 400; wf.Q.value = 0.6;
        const wg = ac.createGain(); wg.gain.value = 0.03;
        const lfo = ac.createOscillator(); lfo.frequency.value = 0.07;
        const lg = ac.createGain(); lg.gain.value = 0.02; lfo.connect(lg).connect(wg.gain);
        w.connect(wf).connect(wg).connect(master); w.start(); lfo.start();
        // Rain: a hiss and a patter, both silent until it rains.
        const r = ac.createBufferSource(); r.buffer = noiseBuf; r.loop = true;
        const rf = ac.createBiquadFilter(); rf.type = "highpass"; rf.frequency.value = 900;
        const rg = ac.createGain(); rg.gain.value = 0;
        r.connect(rf).connect(rg).connect(master); r.start();
        rainN = { g: rg, wind: wg };
        // The chorus: frogs and crickets, each fading with the thing's nearness.
        const life = ac.createGain(); life.gain.value = 1; life.connect(dry);
        const lifeSend = ac.createGain(); lifeSend.gain.value = 0.4; life.connect(lifeSend).connect(verb);
        amb = { life };
        const frog = () => {
          if (!ac) return;
          const t = ac.currentTime + 0.02;
          const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 30;
          const p = panner(P.x + Math.cos(a) * d, 0.3, P.z + Math.sin(a) * d, false);
          p.connect(life);
          const base = 220 + Math.random() * 380, pulses = 2 + Math.floor(Math.random() * 3);
          for (let k = 0; k < pulses; k++) {
            const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(base, t + k * 0.09); o.frequency.exponentialRampToValueAtTime(base * 0.7, t + k * 0.09 + 0.07);
            const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = base * 2.2; f.Q.value = 4;
            const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t + k * 0.09); g.gain.exponentialRampToValueAtTime(0.09, t + k * 0.09 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.09 + 0.08);
            o.connect(f).connect(g).connect(p); o.start(t + k * 0.09); o.stop(t + k * 0.09 + 0.1);
          }
          ctx.timeout(() => { try { p.disconnect(); } catch (e) { /* gone */ } }, 1500);
          ctx.timeout(frog, 180 + Math.random() * 900);
        };
        const cricket = () => {
          if (!ac) return;
          const t = ac.currentTime + 0.02;
          const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 20;
          const p = panner(P.x + Math.cos(a) * d, 0.5, P.z + Math.sin(a) * d, false);
          p.connect(life);
          const f0 = 4200 + Math.random() * 900;
          for (let k = 0; k < 6; k++) tone(t + k * 0.045, 0.03, f0, null, "sine", 0.018, p);
          ctx.timeout(() => { try { p.disconnect(); } catch (e) { /* gone */ } }, 1200);
          ctx.timeout(cricket, 120 + Math.random() * 500);
        };
        const owl = () => {
          if (!ac) return;
          const t = ac.currentTime + 0.05;
          const a = Math.random() * Math.PI * 2;
          const p = panner(P.x + Math.cos(a) * 70, 12, P.z + Math.sin(a) * 70, false);
          p.connect(life);
          tone(t, 0.35, 390, 360, "sine", 0.05, p); tone(t + 0.5, 0.6, 400, 340, "sine", 0.045, p);
          ctx.timeout(() => { try { p.disconnect(); } catch (e) { /* gone */ } }, 2000);
          ctx.timeout(owl, 14000 + Math.random() * 26000);
        };
        ctx.timeout(frog, 400); ctx.timeout(frog, 900); ctx.timeout(cricket, 300); ctx.timeout(cricket, 700); ctx.timeout(owl, 9000);
      }
      function startVoice() {
        // The Listener: a drone of two low saws through a filter, where it is.
        const p = panner(0, 0, 0, true);
        const g = ac.createGain(); g.gain.value = 0;
        const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 140; f.Q.value = 7;
        const o1 = ac.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 36;
        const o2 = ac.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = 38.2;
        const l = ac.createOscillator(); l.frequency.value = 0.3;
        const lg = ac.createGain(); lg.gain.value = 35; l.connect(lg).connect(f.frequency);
        o1.connect(f); o2.connect(f); f.connect(g).connect(p); out(p, 0.6);
        o1.start(); o2.start(); l.start();
        voice = { p, g, f, o1, o2 };
        const hg = ac.createGain(); hg.gain.value = 0.9; hg.connect(master);
        heart = { g: hg, next: 0 };
      }
      const setPos = (node, x, y, z) => { if (node.positionX) { node.positionX.value = x; node.positionY.value = y; node.positionZ.value = z; } else node.setPosition(x, y, z); };
      let lapT = 1, wakeT = 0;
      api.unlock = () => { ready(); };
      api.setEnabled = on => { if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.05); };
      api.update = dt => {
        if (!ac) return;
        const L = ac.listener, t = ac.currentTime;
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
        if (L.positionX) {
          L.positionX.value = camera.position.x; L.positionY.value = camera.position.y; L.positionZ.value = camera.position.z;
          L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
        } else { L.setPosition(camera.position.x, camera.position.y, camera.position.z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
        const dC = Math.hypot(C.x - P.x, C.z - P.z);
        if (voice) {
          const on = C.alive && state.screen !== "menu" ? 1 : state.screen === "menu" ? 0.6 : 0;
          setPos(voice.p, C.x, C.y, C.z);
          voice.g.gain.setTargetAtTime(on * (0.05 + C.alert * 0.2) * (C.y > -0.8 ? 1 : 0.6), t, 0.3);
          voice.f.frequency.setTargetAtTime(110 + C.alert * 280, t, 0.3);
          voice.o1.frequency.setTargetAtTime(34 + C.alert * 14, t, 0.4);
          voice.o2.frequency.setTargetAtTime(36.5 + C.alert * 16, t, 0.4);
        }
        // Standing in the water, it laps at you; swimming near the top, it pushes a wake.
        lapT -= dt;
        if (lapT <= 0 && state.screen === "play" && P.alive && P.medium !== "dry") {
          lapT = 0.7 + Math.random() * 1.6;
          bubbles(t, 1 + Math.floor(Math.random() * 3), 0.6, 220, 800, P.medium === "swim" ? 0.014 : 0.009);
          if (Math.random() < 0.5) swell(t, 0.9, 240, 520, 0.012, "lowpass");
        }
        if (rainK > 0.15) {
          dropT -= dt;
          while (dropT <= 0) { dropT += 0.03 + Math.random() * 0.09 / rainK; bub(t + Math.random() * 0.05, 1300 + Math.random() * 2800, 0.018 + Math.random() * 0.02, 0.006 + rainK * 0.006); }
        }
        if (C.alive && C.speed > 2.2 && C.y > -0.7 && state.screen !== "menu") {
          wakeT -= dt;
          if (wakeT <= 0) { wakeT = 0.5 + Math.random() * 0.3; const p = atPos(C.x, 0, C.z, 1.2, true); swell(t, 0.8, 500, 200, 0.05 + clamp(C.speed / 8, 0, 0.6) * 0.1, "lowpass", p); bubbles(t + 0.1, 3, 0.5, 150, 500, 0.03, p); }
        }
        // The swamp holds its breath when it is close.
        if (amb) amb.life.gain.setTargetAtTime(C.alive && state.screen === "play" ? smooth(18, 45, dC) : 1, t, 0.8);
        if (heart && state.screen === "play" && P.alive) {
          const hunted = C.alive && (C.state === "hunt" || (C.act && C.act.kind === "lunge")) ? clamp(1 - dC / 30, 0.15, 1) : 0;
          heart.next -= dt;
          if (hunted > 0 && heart.next <= 0) {
            heart.next = lerp(0.95, 0.4, hunted);
            tone(t, 0.12, 62, 40, "sine", 0.35 * hunted, heart.g);
            tone(t + 0.16, 0.1, 58, 38, "sine", 0.25 * hunted, heart.g);
            if (hunted > 0.6) haptic("light");
          }
        }
      };
      let rainK = 0, dropT = 0;
      api.rain = k => { rainK = k; if (rainN) { rainN.g.gain.setTargetAtTime(k * 0.13, ac.currentTime, 0.5); rainN.wind.gain.setTargetAtTime(0.03 + k * 0.06, ac.currentTime, 0.8); } };
      api.step = (sneak, wood) => {
        if (!ready()) return; const t = ac.currentTime, k = sneak ? 0.45 : 1;
        if (wood) {
          // A hollow plank: a knock with a little ring under it.
          noise(t, 0.06, 900, 500, 3, 0.07 * k, "bandpass");
          tone(t, 0.09, 175 + Math.random() * 30, 115, "triangle", 0.1 * k);
        } else {
          // Mud: a soft suck, sometimes a bubble of marsh gas.
          swell(t, 0.16, 260, 520, 0.07 * k, "lowpass");
          tone(t, 0.07, 95, 60, "sine", 0.05 * k);
          if (Math.random() < 0.4) bubbles(t + 0.06, 1, 0.1, 160, 360, 0.02 * k);
        }
      };
      api.creak = loud => {
        if (!ready()) return; const t = ac.currentTime, d = 0.3 + Math.random() * 0.3, f0 = 150 + Math.random() * 90;
        // An old plank under weight: a slow, rough glide.
        const o = ac.createOscillator(); o.type = "sawtooth";
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1.25 + Math.random() * 0.3), t + d * 0.6); o.frequency.linearRampToValueAtTime(f0 * 1.05, t + d);
        const v = ac.createOscillator(); v.frequency.value = 22 + Math.random() * 14;
        const vg = ac.createGain(); vg.gain.value = 9; v.connect(vg).connect(o.frequency);
        const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 700 + Math.random() * 400; f.Q.value = 5;
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06 * loud, t + d * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(f).connect(g); out(g, 0.5);
        o.start(t); v.start(t); o.stop(t + d + 0.05); v.stop(t + d + 0.05);
      };
      api.wade = (loud, swimming) => {
        if (!ready()) return; const t = ac.currentTime, L = clamp(loud, 0.12, 1.8);
        if (swimming) {
          // A stroke: the arm going in, the pull through, the water closing behind.
          noise(t, 0.25, 2600, 1100, 0.8, 0.03 + L * 0.03, "bandpass");
          swell(t + 0.1, 0.7, 900, 240, 0.07 + L * 0.07, "lowpass");
          bubbles(t + 0.08, 7 + Math.round(L * 9), 0.6, 210, 1250, 0.03 + L * 0.025);
          tone(t + 0.12, 0.22, 130, 70, "sine", 0.04 + L * 0.03);
        } else {
          // A step: the leg shoves water aside, the water slops back, the boot sucks free and drips.
          swell(t, 0.24, 320, 1250, 0.05 + L * 0.08, "lowpass");
          swell(t + 0.17, 0.38, 1150, 360, 0.035 + L * 0.06, "lowpass");
          bubbles(t + 0.04, 2 + Math.round(L * 7), 0.42, 250, 1050, 0.022 + L * 0.03);
          tone(t + 0.05, 0.12, 165, 88, "sine", 0.025 + L * 0.03);
          bubbles(t + 0.38, 1 + Math.round(L * 2), 0.45, 1400, 2700, 0.01 + L * 0.01);
        }
      };
      api.splash = loud => {
        if (!ready()) return; const t = ac.currentTime, L = clamp(loud, 0.4, 3);
        noise(t, 0.45 + L * 0.2, 4200, 500, 0.6, 0.1 + L * 0.07, "lowpass");
        swell(t + 0.05, 0.9, 950, 220, 0.08 + L * 0.05, "lowpass");
        bubbles(t + 0.04, 12 + Math.round(L * 12), 0.9, 180, 1500, 0.035 + L * 0.018);
        tone(t, 0.32, 115, 42, "sine", 0.1 + L * 0.05);
        bubbles(t + 0.55, 3 + Math.round(L * 2), 1.2, 1500, 3000, 0.016);
      };
      api.climb = () => {
        if (!ready()) return; const t = ac.currentTime;
        // Hauling out: water pouring off you, then dripping.
        swell(t, 0.5, 1800, 500, 0.09, "lowpass");
        bubbles(t + 0.1, 6, 0.6, 600, 2000, 0.025);
      };
      api.drip = () => { if (!ready()) return; bubbles(ac.currentTime + 0.05, 5, 1.1, 1300, 2800, 0.022); };
      api.land = (v, wood) => { if (!ready()) return; const t = ac.currentTime; tone(t, 0.12, wood ? 160 : 100, 50, "sine", clamp(v / 14, 0.05, 0.25)); noise(t, 0.08, wood ? 1500 : 700, 400, 1.5, clamp(v / 30, 0.03, 0.12), "bandpass"); };
      api.thud = () => { if (!ready()) return; const t = ac.currentTime; tone(t, 0.2, 120, 55, "sine", 0.18); noise(t, 0.12, 700, 300, 2, 0.08, "bandpass"); };
      api.plop = (x, z, wet) => {
        if (!ready()) return; const t = ac.currentTime, p = atPos(x, 0, z, 1.2);
        if (wet) { bub(t, 260 + Math.random() * 80, 0.09, 0.18, p); bubbles(t + 0.03, 4, 0.25, 500, 1600, 0.05, p); noise(t, 0.18, 2400, 700, 0.8, 0.06, "lowpass", p); }
        else { noise(t, 0.05, 2600, 1800, 4, 0.12, "bandpass", p); tone(t, 0.05, 900, 600, "triangle", 0.04, p); }
      };
      // The outboard: a sputter, then a hammering drone that follows the boat.
      let motorN = null;
      api.motor = (x, z, k) => {
        if (!ready()) return;
        const t = ac.currentTime;
        if (!motorN) {
          const p = panner(x, 0.3, z, false);
          const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = 52;
          const am = ac.createOscillator(); am.frequency.value = 13;
          const amg = ac.createGain(); amg.gain.value = 0.4; am.connect(amg);
          const g = ac.createGain(); g.gain.value = 0.0001;
          amg.connect(g.gain);
          const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 520; f.Q.value = 2;
          const nz = ac.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true;
          const nf = ac.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 900; nf.Q.value = 0.7;
          const ng = ac.createGain(); ng.gain.value = 0.05;
          o.connect(f).connect(g); nz.connect(nf).connect(ng).connect(g);
          g.connect(p); out(p, 0.3);
          o.start(t); am.start(t); nz.start(t);
          motorN = { p, o, am, g, f, nz };
          noise(t, 0.5, 900, 300, 1, 0.15);
        }
        setPos(motorN.p, x, 0.3, z);
        motorN.g.gain.setTargetAtTime(0.12 + k * 0.22, t, 0.15);
        motorN.o.frequency.setTargetAtTime(48 + k * 46, t, 0.2);
        motorN.am.frequency.setTargetAtTime(10 + k * 16, t, 0.2);
        motorN.f.frequency.setTargetAtTime(400 + k * 900, t, 0.2);
      };
      api.stopMotor = () => {
        if (!motorN || !ac) return;
        const n = motorN, t = ac.currentTime;
        motorN = null;
        n.g.gain.setTargetAtTime(0.0001, t, 0.25);
        ctx.timeout(() => { try { n.o.stop(); n.am.stop(); n.nz.stop(); n.p.disconnect(); } catch (e) { /* gone */ } }, 1500);
      };
      api.chime = (up) => { if (!ready()) return; const t = ac.currentTime; (up ? [0, 5, 9, 14] : [0, 7, 12]).forEach((st, i) => tone(t + i * 0.12, 1.6, 392 * Math.pow(2, st / 12), null, "sine", 0.06, null, 0.9)); };
      api.page = () => { if (!ready()) return; const t = ac.currentTime; noise(t, 0.18, 3000, 5000, 1.2, 0.05, "highpass"); noise(t + 0.12, 0.14, 4000, 2500, 1.2, 0.04, "highpass"); };
      api.jump = boots => { if (!ready()) return; const t = ac.currentTime; if (boots) { tone(t, 0.2, 260, 820, "triangle", 0.07); tone(t + 0.02, 0.12, 1400, 2400, "sine", 0.02); } noise(t, 0.05, 1600, 800, 1, 0.05); };
      api.rung = () => { if (!ready()) return; tone(ac.currentTime, 0.05, 240, 160, "triangle", 0.08); };
      api.bonk = () => { if (!ready()) return; const t = ac.currentTime; tone(t, 0.15, 120, 60, "sine", 0.25); noise(t, 0.1, 800, 300, 1, 0.1); };
      api.pickup = k => { if (!ready()) return; const t = ac.currentTime; [0, 4, 7].forEach((st, i) => tone(t + i * 0.06, 0.5, 660 * Math.pow(2, (st + k * 2) / 12), null, "triangle", 0.08, null, 0.7)); };
      api.craft = () => { if (!ready()) return; const t = ac.currentTime; [0, 4, 7, 12, 16].forEach((st, i) => tone(t + i * 0.09, 0.9, 330 * Math.pow(2, st / 12), null, "triangle", 0.09, null, 0.8)); noise(t, 0.3, 3000, 900, 2, 0.05); };
      api.click = () => { if (!ready()) return; tone(ac.currentTime, 0.04, 900, 600, "square", 0.035); };
      api.whoosh = () => { if (!ready()) return; noise(ac.currentTime, 0.25, 600, 2400, 2, 0.06); };
      api.duckSplash = (x, z) => { if (!ready()) return; const t = ac.currentTime, p = atPos(x, 0, z, 1.5); noise(t, 0.4, 3000, 500, 0.8, 0.22, "lowpass", p); bubbles(t + 0.03, 8, 0.5, 300, 1400, 0.06, p); };
      api.squeak = (x, z, crushed) => { if (!ready()) return; tone(ac.currentTime, crushed ? 0.35 : 0.16, crushed ? 1400 : 1100, crushed ? 500 : 1700, "square", 0.05, atPos(x, 0.1, z, 1)); };
      api.bang = (x, z) => { if (!ready()) return; const t = ac.currentTime, p = atPos(x, 0.3, z, 1); noise(t, 0.25, 2600, 300, 0.7, 0.6, "lowpass", p); tone(t, 0.12, 180, 60, "square", 0.2, p); };
      api.bell = (x, z) => {
        if (!ready()) return; const t = ac.currentTime, p = atPos(x, 8, z, 9);
        const parts = [[0.5, 0.25, 7], [1, 0.3, 6], [1.19, 0.18, 4], [1.5, 0.14, 3.5], [2, 0.12, 3], [2.5, 0.08, 2.2], [3.01, 0.06, 1.6]];
        for (const [m, a, d] of parts) tone(t, d, 196 * m, null, "sine", a, p, 0.8);
        noise(t, 0.08, 3000, 1500, 1, 0.15, "bandpass", p);
      };
      api.generator = (x, z, secs) => {
        if (!ready()) return; const t = ac.currentTime, p = atPos(x, 1, z, secs + 1);
        const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = 46;
        const am = ac.createOscillator(); am.frequency.value = 7.5;
        const ag = ac.createGain(); ag.gain.value = 0.5; am.connect(ag);
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.8); g.gain.setValueAtTime(0.35, t + secs - 1); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
        ag.connect(g.gain);
        const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 600;
        o.connect(f).connect(g).connect(p); o.start(t); am.start(t); o.stop(t + secs + 0.1); am.stop(t + secs + 0.1);
      };
      api.fire = () => { if (!ready()) return; const t = ac.currentTime; noise(t, 0.5, 1800, 200, 0.8, 0.32, "lowpass"); tone(t, 0.25, 160, 50, "sawtooth", 0.18); };
      api.explode = (x, z) => { if (!ready()) return; const t = ac.currentTime, p = atPos(x, 0.5, z, 2); noise(t, 1.4, 1600, 60, 0.7, 0.9, "lowpass", p); tone(t, 0.9, 70, 28, "sine", 0.7, p); };
      api.thunder = k => {
        if (!ready()) return; const t = ac.currentTime, K = clamp(k, 0.25, 1);
        if (K > 0.6) noise(t, 0.35, 5000, 1200, 0.7, 0.25 * K, "lowpass", null, 0.9);
        noise(t + 0.05, 4.2, 420, 35, 0.5, 0.5 * K, "lowpass", null, 0.9);
        noise(t + 0.9 + Math.random() * 0.5, 2.6, 260, 40, 0.5, 0.28 * K, "lowpass", null, 0.9);
        tone(t, 3, 48, 26, "sine", 0.22 * K);
      };
      api.beastClick = () => { if (!ready()) return; const t = ac.currentTime, p = atPos(C.x, C.y, C.z, 1, true); for (let k = 0; k < 7; k++) tone(t + k * 0.04, 0.012, 2800 + Math.random() * 1500, null, "square", 0.04, p); };
      api.beastBreath = () => {
        if (!ready()) return; const t = ac.currentTime, p = atPos(C.x, 0.3, C.z, 3.5, true);
        // Water streaming off it as it rises, a long wet exhale, then it sinks gurgling.
        swell(t, 1.2, 1400, 300, 0.2, "lowpass", p);
        bubbles(t, 18, 1.1, 120, 700, 0.07, p);
        noise(t + 0.9, 1.6, 300, 900, 1.5, 0.14, "bandpass", p);
        bubbles(t + 2.6, 14, 1.0, 90, 420, 0.06, p);
      };
      api.beastGrowl = () => { if (!ready()) return; const t = ac.currentTime, p = atPos(C.x, C.y, C.z, 2, true); noise(t, 1.5, 200, 120, 6, 0.32, "bandpass", p); tone(t, 1.4, 48, 34, "sawtooth", 0.24, p); };
      api.beastRoar = (x, z) => { if (!ready()) return; const t = ac.currentTime, p = atPos(x, 0.6, z, 2, true); noise(t, 1.0, 600, 150, 3, 0.6, "bandpass", p); tone(t, 0.9, 130, 55, "sawtooth", 0.4, p); tone(t, 0.7, 1900, 800, "sawtooth", 0.07, p); };
      api.beastBite = (x, z) => { if (!ready()) return; const t = ac.currentTime, p = atPos(x, 0.6, z, 2, true); noise(t, 0.8, 500, 200, 2.5, 0.5, "bandpass", p); tone(t + 0.5, 0.14, 200, 70, "square", 0.25, p); };
      api.beastHurt = (x, z) => { if (!ready()) return; const t = ac.currentTime, p = atPos(x, 0.6, z, 2, true); tone(t, 1.3, 800, 180, "sawtooth", 0.32, p); noise(t, 1.1, 1300, 300, 2, 0.4, "bandpass", p); };
      api.beastDeath = (x, z) => { if (!ready()) return; const t = ac.currentTime, p = atPos(x, 0.6, z, 4, true); tone(t, 3.4, 650, 50, "sawtooth", 0.35, p); tone(t + 0.3, 3, 280, 35, "square", 0.14, p); noise(t, 3.2, 900, 70, 1.5, 0.4, "bandpass", p); };
      api.death = () => { if (!ready()) return; const t = ac.currentTime; noise(t, 1.8, 900, 80, 1.2, 0.7, "lowpass"); tone(t, 1.6, 90, 30, "sawtooth", 0.4); };
      api.win = () => { if (!ready()) return; const t = ac.currentTime; [0, 7, 12, 16, 19].forEach((st, i) => tone(t + i * 0.18, 2.5, 220 * Math.pow(2, st / 12), null, "triangle", 0.07, null, 0.9)); };
      return api;
    })();
    function haptic(kind) {
      if (state.haptics && ctx.capabilities.haptics && typeof ctx.platform.haptic === "function") ctx.platform.haptic(kind);
    }
    function makeNoise(x, z, loud, kind) {
      beastHear(x, z, loud, kind);
    }
    /* ================================================================ *
     * THE OVERLAY
     * ================================================================ */
    const HUD_CSS = `
.sw{position:absolute;inset:0;overflow:hidden;pointer-events:none!important;color:#eef3ee;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}
.sw *{box-sizing:border-box}
.sw [hidden]{display:none!important}
.sw-touch{position:absolute;inset:0;pointer-events:auto!important;touch-action:none}
.sw-hud{position:absolute;inset:0;pointer-events:none}
.sw-compass{position:absolute;left:50%;top:calc(var(--sat) + 10px);width:min(72vw,340px);height:30px;transform:translateX(-50%);
  overflow:hidden;border-radius:15px;background:linear-gradient(90deg,rgba(4,10,10,0),rgba(4,10,10,.5) 18%,rgba(4,10,10,.5) 82%,rgba(4,10,10,0))}
.sw-compass::after{content:"";position:absolute;left:50%;top:3px;bottom:3px;width:1px;background:rgba(255,255,255,.35)}
.sw-cm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:11px;font-weight:700;letter-spacing:.08em;opacity:.75;white-space:nowrap}
.sw-cm.poi{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;letter-spacing:.04em;opacity:.9}
.sw-cm.poi i{width:7px;height:7px;border-radius:50%;background:#ffcf6a;box-shadow:0 0 6px rgba(255,207,106,.7);flex:none}
.sw-cm.poi em{font-style:normal;display:none;white-space:nowrap}
.sw-cm.poi.near em{display:inline}
.sw-cm.goal{width:12px;height:12px;border-radius:2px;background:#ffcf6a;transform:translate(-50%,-50%) rotate(45deg);box-shadow:0 0 10px #ffcf6a;opacity:1}
.sw-obj{position:absolute;left:50%;top:calc(var(--sat) + 46px);transform:translateX(-50%);width:86vw;text-align:center;pointer-events:auto!important;
  font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:19px;line-height:1.15;text-shadow:0 1px 10px rgba(0,0,0,.85)}
.sw-obj small{font-family:Inter,system-ui,sans-serif;font-style:normal;font-size:12px;font-weight:600;color:#ffcf6a;letter-spacing:.04em}
.sw-obj::after{content:"Journal";display:block;margin:4px auto 0;font-family:Inter,system-ui,sans-serif;font-style:normal;font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;opacity:.4}
.sw-wp{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.sw-wp i{position:absolute;left:-7px;top:-7px;width:14px;height:14px;border:2px solid #ffcf6a;transform:rotate(45deg);box-shadow:0 0 12px rgba(255,207,106,.8);border-radius:2px}
.sw-wp span{position:absolute;left:50%;top:12px;transform:translateX(-50%);font-size:11px;font-weight:700;color:#ffe6a8;white-space:nowrap;text-shadow:0 1px 6px #000}
.sw-card{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%);text-align:center;width:88vw;opacity:0;transition:opacity 1s;pointer-events:none;text-shadow:0 2px 18px rgba(0,0,0,.95)}
.sw-card.on{opacity:1}
.sw-card em{display:block;font-style:normal;font-size:11px;font-weight:700;letter-spacing:.42em;color:#8ff0d8;margin-bottom:8px}
.sw-card b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:50px;line-height:1}
.sw-card span{display:block;margin-top:12px;font-size:14px;opacity:.85}
.sw-sheet{position:absolute;inset:0;z-index:16;pointer-events:auto!important;background:rgba(3,8,8,.9);overflow-y:auto;
  padding:calc(var(--sat) + 26px) calc(var(--sar) + 22px) calc(var(--sab) + 26px) calc(var(--sal) + 22px)}
.sw-sheet h2{margin:0 0 4px;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:34px}
.sw-sheet h3{margin:22px 0 8px;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#8ff0d8}
.sw-sheet p{margin:0 0 12px;font-size:14px;line-height:1.55;opacity:.86}
.sw-sheet .sw-close{position:sticky;top:0;float:right;appearance:none;border:0;border-radius:12px;padding:8px 14px;font:inherit;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#d9ece6;background:rgba(255,255,255,.1)}
.sw-goals{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.sw-goals li{display:flex;gap:10px;align-items:baseline;font-size:14px;line-height:1.4}
.sw-goals li i{flex:none;width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35);font-style:normal;font-size:11px;display:flex;align-items:center;justify-content:center}
.sw-goals li.done{opacity:.55}
.sw-goals li.done i{background:#62d6b8;box-shadow:none;color:#04140f}
.sw-goals li.now i{box-shadow:inset 0 0 0 2px #ffcf6a}
.sw-page{border-left:2px solid rgba(233,225,204,.4);padding-left:12px;margin:0 0 16px}
.sw-page b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:19px;font-weight:400;margin-bottom:4px}
.sw-reader{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(86vw,420px);z-index:14;pointer-events:auto!important;
  background:linear-gradient(180deg,#e9e1cc,#d6ccb2);color:#2a2418;border-radius:6px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.7);transform-origin:50% 50%}
.sw-reader b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:24px;font-weight:400;margin-bottom:8px}
.sw-reader p{margin:0;font-family:"Cormorant Garamond",Georgia,serif;font-size:19px;line-height:1.35}
.sw-reader small{display:block;margin-top:12px;font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:600;letter-spacing:.08em;color:#6b5a32}
.sw-stone{grid-column:1;grid-row:2;width:56px;height:56px;margin-bottom:6px}
.sw-ear{position:absolute;left:50%;top:calc(var(--sat) + 74px);transform:translateX(-50%);display:flex;align-items:center;gap:8px;opacity:.9}
.sw-ear i{width:9px;height:9px;border-radius:50%;background:#7fd8c8;opacity:.2;transition:opacity .4s,background .4s,box-shadow .4s}
.sw-ear.l1 i{opacity:.95;background:#ffcf6a;box-shadow:0 0 12px #ffcf6a}
.sw-ear.l2 i{opacity:1;background:#ff4b3e;box-shadow:0 0 18px #ff4b3e;animation:swPulse .45s infinite alternate}
.sw-ear span{font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:16px;opacity:0;transition:opacity .4s;text-shadow:0 1px 10px #000;white-space:nowrap}
.sw-ear span.on{opacity:1}
@keyframes swPulse{from{transform:scale(.8)}to{transform:scale(1.3)}}
.sw-inv{position:absolute;left:calc(var(--sal) + 12px);top:calc(var(--sat) + 104px);display:flex;flex-direction:column;gap:5px}
.sw-chip{display:flex;align-items:center;gap:7px;padding:4px 10px 4px 7px;border-radius:999px;background:rgba(4,12,12,.42);
  backdrop-filter:blur(6px);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;width:max-content}
.sw-chip b{width:9px;height:9px;border-radius:50%;display:block}
.sw-chip.done{background:rgba(70,200,170,.26)}
.sw .k-coil{background:#7fffd4;fill:#7fffd4}.sw .k-part{background:#ffcf6a;fill:#ffcf6a}.sw .k-rocket{background:#ff6a4f;fill:#ff6a4f}
.sw .k-ducks{background:#ffe14d;fill:#ffe14d}.sw .k-firecracker{background:#ff9a3d;fill:#ff9a3d}.sw .k-note{background:#e9e1cc;fill:#e9e1cc}
.sw-mapbtn{position:absolute;right:calc(var(--sar) + 12px);top:calc(var(--sat) + 8px);width:38px;height:38px;border-radius:12px;border:0;
  pointer-events:auto!important;background:rgba(4,12,12,.45);color:#eef3ee;font:inherit;font-size:16px;backdrop-filter:blur(6px)}
.sw-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.8);
  box-shadow:0 0 0 1.5px rgba(0,0,0,.35);opacity:0;transition:opacity .2s}
.sw-cross.on{opacity:1}
.sw-toast{position:absolute;left:50%;top:28%;transform:translate(-50%,0);text-align:center;opacity:0;transition:opacity .5s,transform .5s;
  text-shadow:0 2px 14px rgba(0,0,0,.95);width:86vw}
.sw-toast.on{opacity:1;transform:translate(-50%,-6px)}
.sw-toast b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:34px;line-height:1.05}
.sw-toast span{display:block;margin-top:6px;font-size:13px;opacity:.8}
.sw-stick{position:absolute;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;border:1.5px solid rgba(255,255,255,.26);
  background:radial-gradient(circle,rgba(255,255,255,.06),rgba(255,255,255,.02) 60%,transparent 61%);pointer-events:none}
.sw-stick::before{content:"";position:absolute;inset:26%;border-radius:50%;border:1px dashed rgba(127,216,200,.4)}
.sw-stick i{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.26);box-shadow:0 0 0 1.5px rgba(255,255,255,.4)}
.sw-stick.quiet i{background:rgba(127,216,200,.4);box-shadow:0 0 14px rgba(127,216,200,.6)}
.sw-btns{position:absolute;right:calc(var(--sar) + 14px);bottom:calc(var(--sab) + 16px);display:grid;grid-template-columns:auto auto;gap:12px;align-items:end;justify-items:end;pointer-events:none}
.sw-btn{pointer-events:auto!important;appearance:none;border:0;border-radius:50%;color:#f1f6f2;font:inherit;touch-action:none;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:2px;background:rgba(6,18,18,.4);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.26);backdrop-filter:blur(6px);transition:transform .08s,background .08s}
.sw-btn em{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.85}
.sw-btn span{font-size:17px;font-weight:700;line-height:1}
.sw-btn.on{transform:scale(.92);background:rgba(127,216,200,.3)}
.sw-jump{grid-column:2;grid-row:3;width:88px;height:88px}
.sw-duck{grid-column:1;grid-row:3;width:66px;height:66px;margin-bottom:4px}
.sw-fire{grid-column:2;grid-row:2;width:72px;height:72px;background:rgba(120,30,20,.45);box-shadow:inset 0 0 0 1.5px rgba(255,150,110,.55)}
.sw-use{grid-column:1 / span 2;grid-row:1;border-radius:18px;width:auto;height:44px;padding:0 16px;background:rgba(255,207,106,.2);box-shadow:inset 0 0 0 1.5px rgba(255,207,106,.6)}
.sw-use em{font-size:12px}
.sw-duck.empty{opacity:.4}
.sw-flash{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}
.sw-mapview{position:absolute;inset:0;z-index:15;pointer-events:auto!important;background:rgba(3,8,8,.86);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.sw-mapview h2{margin:0;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:30px}
.sw-mapview p{margin:0;font-size:12px;opacity:.6;letter-spacing:.06em}
.sw-mapview svg{width:min(94vw,66vh);height:min(94vw,66vh);display:block;border-radius:14px;background:#050b0b;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
.sw-mapview .ring{fill:none!important;stroke-width:.8;stroke:currentColor}
.sw-mapview .k-coil.ring{stroke:#7fffd4}.sw-mapview .k-part.ring{stroke:#ffcf6a}.sw-mapview .k-rocket.ring{stroke:#ff6a4f}.sw-mapview .k-ducks.ring{stroke:#ffe14d}
.sw-mapview .k-firecracker.ring{stroke:#ff9a3d}.sw-mapview .k-fuel.ring{stroke:#ff8a4c}.sw-mapview .k-key.ring{stroke:#e7cf72}.sw-mapview .k-note.ring{stroke:#e9e1cc}
.sw .k-fuel{background:#ff8a4c;fill:#ff8a4c}.sw .k-key{background:#e7cf72;fill:#e7cf72}
.sw-mapview text{font-family:Inter,system-ui,sans-serif;font-size:7px;font-weight:600;fill:#efe8d6;paint-order:stroke;stroke:#050b0b;stroke-width:2px}
.sw-modal{position:absolute;inset:0;z-index:20;pointer-events:auto!important;display:flex;flex-direction:column;justify-content:flex-end;
  padding:calc(var(--sat) + 24px) calc(var(--sar) + 22px) calc(var(--sab) + 28px) calc(var(--sal) + 22px);
  background:linear-gradient(180deg,rgba(2,6,6,0) 0%,rgba(2,6,6,0) 45%,rgba(2,6,6,.55) 70%,rgba(2,6,6,.92) 100%)}
.sw-title{margin:0 0 4px;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:min(19vw,92px);line-height:.86;
  letter-spacing:-.01em;text-shadow:0 4px 40px rgba(110,240,210,.22)}
.sw-title.sw-small{font-size:min(15vw,72px)}
.sw-tag{margin:0 0 20px;font-size:14px;letter-spacing:.05em;opacity:.78}
.sw-tag b{color:#8ff0d8;font-weight:600}
.sw-go{appearance:none;border:0;width:100%;min-height:56px;border-radius:18px;font:inherit;font-size:15px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
  color:#04140f;background:linear-gradient(180deg,#a8f5df,#62d6b8);box-shadow:0 10px 40px rgba(80,230,190,.22);touch-action:manipulation}
.sw-row{display:flex;gap:10px;margin-top:12px}
.sw-ghost{flex:1;appearance:none;border:0;min-height:44px;border-radius:14px;font:inherit;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;
  color:#d9ece6;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);touch-action:manipulation}
.sw-tips{display:flex;flex-direction:column;gap:9px;margin:0 0 18px}
.sw-how{margin:0 0 18px;font-size:13px;line-height:1.5;opacity:.72;max-width:34em}
.sw-tip{display:flex;gap:12px;align-items:flex-start;font-size:13.5px;line-height:1.45;opacity:.86}
.sw-tip i{flex:none;width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-style:normal;background:rgba(143,240,216,.14);color:#8ff0d8;font-size:12px;font-weight:700}
.sw-stats{list-style:none;margin:0 0 20px;padding:0;display:flex;flex-direction:column;gap:8px}
.sw-stats li{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:7px}
.sw-stats li span{opacity:.65}
.sw-stats li b{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.sw-rank{display:inline-block;margin:0 0 14px;padding:6px 12px;border-radius:999px;background:rgba(143,240,216,.14);color:#a8f5df;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;align-self:flex-start}
.sw-build{font-size:10px;letter-spacing:.2em;opacity:.35;margin-top:12px;text-align:center}
`;
    const root = ctx.createRoot({ className: "sw" });
    root.innerHTML = `<style>${HUD_CSS}</style>
<div class="sw-touch" data-touch></div>
<div class="sw-hud" data-hud hidden>
  <div class="sw-compass" data-compass></div>
  <div class="sw-obj" data-obj></div>
  <div class="sw-ear" data-ear><i></i><span data-eartext></span></div>
  <div class="sw-inv" data-inv></div>
  <div class="sw-cross" data-cross></div>
  <div class="sw-toast" data-toast></div>
  <div class="sw-card" data-card></div>
  <div class="sw-wp" data-wp hidden><i></i><span data-wpd></span></div>
  <button class="sw-mapbtn" data-mapbtn aria-label="Map">&#9638;</button>
</div>
<div class="sw-reader" data-reader hidden></div>
<div class="sw-sheet" data-sheet hidden></div>
<div class="sw-stick" data-stick hidden><i data-knob></i></div>
<div class="sw-btns" data-btns hidden>
  <button class="sw-btn sw-use" data-btn="use" hidden><em data-uselabel>Use</em></button>
  <button class="sw-btn sw-fire" data-btn="fire" hidden><span data-rocketcount>0</span><em>Fire</em></button>
  <button class="sw-btn sw-stone" data-btn="stone"><em>Stone</em></button>
  <button class="sw-btn sw-duck" data-btn="duck"><span data-duckcount>2</span><em>Duck</em></button>
  <button class="sw-btn sw-jump" data-btn="jump"><em>Jump</em></button>
</div>
<div class="sw-flash" data-flash></div>
<div class="sw-mapview" data-mapview hidden><h2>The swamp</h2><svg data-mapsvg viewBox="0 0 256 256" preserveAspectRatio="xMidYMid meet"></svg><p>Tap anywhere to close</p></div>
<div class="sw-modal" data-modal></div>`;
    const $ = sel => root.querySelector(sel);
    const touchEl = $("[data-touch]"), hudEl = $("[data-hud]"), stickEl = $("[data-stick]"), knobEl = $("[data-knob]");
    const btnsEl = $("[data-btns]"), modalEl = $("[data-modal]"), flashEl = $("[data-flash]"), mapView = $("[data-mapview]");
    const objEl = $("[data-obj]"), invEl = $("[data-inv]"), earEl = $("[data-ear]"), earText = $("[data-eartext]");
    const toastEl = $("[data-toast]"), crossEl = $("[data-cross]"), compassEl = $("[data-compass]"), mapSvg = $("[data-mapsvg]");
    const useBtn = $("[data-btn=use]"), useLabel = $("[data-uselabel]"), fireBtn = $("[data-btn=fire]"), duckBtn = $("[data-btn=duck]");
    const duckCount = $("[data-duckcount]"), rocketCount = $("[data-rocketcount]");
    const wpEl = $("[data-wp]"), wpDist = $("[data-wpd]"), cardEl = $("[data-card]"), sheetEl = $("[data-sheet]"), readerEl = $("[data-reader]");
    function applySafeArea() {
      const sa = ctx.safeArea || {};
      root.style.setProperty("--sat", (sa.top || 0) + "px");
      root.style.setProperty("--sar", (sa.right || 0) + "px");
      root.style.setProperty("--sab", (sa.bottom || 0) + "px");
      root.style.setProperty("--sal", (sa.left || 0) + "px");
    }
    applySafeArea();
    ctx.listen(window, "resize", applySafeArea);

    /* ---- the compass ---- */
    const compassMarks = [];
    // Marks are spans made from markup, one per bearing worth knowing.
    function addMark(cls, text) {
      compassEl.insertAdjacentHTML("beforeend", `<span class="${cls}">${text}</span>`);
      return compassEl.lastElementChild;
    }
    for (const [k, a] of [["N", 0], ["E", Math.PI / 2], ["S", Math.PI], ["W", -Math.PI / 2]]) compassMarks.push({ el: addMark("sw-cm", k), bearing: a, kind: "card" });
    for (const key in POI) compassMarks.push({ el: addMark("sw-cm poi", `<i></i><em>${POI[key].name}</em>`), key, kind: "poi" });
    compassMarks.push({ el: addMark("sw-cm goal", ""), kind: "goal" });
    let goalPos = null;
    function updateCompass() {
      const W = Math.min(ctx.width * 0.72, 340);
      const yaw = P.yaw;
      for (const m of compassMarks) {
        let bearing;
        if (m.kind === "card") bearing = m.bearing;
        else {
          const p = m.kind === "poi" ? POI[m.key] : goalPos;
          if (!p || (m.kind === "poi" && !state.seen[m.key])) { m.el.hidden = true; continue; }
          bearing = Math.atan2(p.x - P.x, -(p.z - P.z));
        }
        // World north is -z; facing yaw 0 looks toward -z.
        let rel = bearing - (-yaw);
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        const vis = Math.abs(rel) < 1.15;
        m.el.hidden = !vis;
        if (vis) m.el.style.left = (W / 2 + (rel / 1.15) * (W / 2 - 12)).toFixed(1) + "px";
        // The place you are facing says its name.
        if (m.kind === "poi") { const near = vis && Math.abs(rel) < 0.14; if (near !== m.near) { m.near = near; m.el.classList.toggle("near", near); } }
      }
    }
    // The night in chapters. There is always somewhere to go next.
    const CHAPTERS = ["The Landing", "Springheel", "High Ground", "Armed", "The Hunt", "Dawn"];
    const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
    function nearestItem(kind) {
      let best = null, bd = 1e9;
      for (const it of items) {
        if (it.kind !== kind || it.taken || !(it.known || it.seen)) continue;
        const d = Math.hypot(it.x - P.x, it.z - P.z);
        if (d < bd) { bd = d; best = it; }
      }
      return best;
    }
    function objective() {
      const bench = BUILD.interact.find(i => i.kind === "bench");
      const top = (BUILD.anchors.towertop || [{ x: POI.tower.x, y: 10, z: POI.tower.z }])[0];
      if (state.won) return { ch: 5, text: "It is dead. Dawn is coming." };
      if (state.escaped) return { ch: 5, text: "Out of the swamp. It is still in there." };
      if (!state.pages[1]) {
        const n1 = items.find(i => i.kind === "note" && i.page === 1 && !i.taken);
        if (n1) return { ch: 0, text: "Pick up the page on the path", at: n1 };
      }
      if (!state.pages[2]) return { ch: 0, text: "Follow the lanterns to the Fishing Camp", at: bench };
      if (!state.boots) {
        if (state.coils >= COILS_NEED) return { ch: 1, text: "Make the spring boots at the workbench", at: bench };
        return { ch: 1, text: `Find spring coils \u00b7 ${state.coils} of ${COILS_NEED}`, at: nearestItem("coil") };
      }
      if (!state.towerSeen) return { ch: 2, text: "Climb the Watchtower and look out", at: top };
      if (!state.bazooka) {
        if (state.parts >= PARTS_NEED) return { ch: 3, text: "Build the bazooka at the workbench", at: bench };
        return { ch: 3, text: `Find bazooka parts \u00b7 ${state.parts} of ${PARTS_NEED}`, at: nearestItem("part") };
      }
      if (state.rockets <= 0) {
        const it = nearestItem("rocket");
        if (it || items.some(i => i.kind === "rocket" && !i.taken)) return { ch: 3, text: "Find a rocket", at: it };
        const boat = BUILD.interact.find(i => i.kind === "boat");
        return { ch: 4, text: state.fuel && state.key ? "No rockets left. Take the boat and go" : "No rockets left. Find fuel and the key, and leave", at: state.fuel && state.key ? boat : nearestItem(state.fuel ? "key" : "fuel") };
      }
      if (state.ducks <= 0 && state.crackers <= 0) return { ch: 4, text: "Find a crate of ducks to lure it with", at: nearestItem("ducks") };
      return { ch: 4, text: `Lure it up and shoot it \u00b7 ${state.hits} of ${CREATURE_HP}` };
    }
    let shownChapter = -1, cardT = 0;
    function chapterCard(ch, sub) {
      toastEl.classList.remove("on"); toastT = 0;
      cardEl.innerHTML = `<em>CHAPTER ${ROMAN[ch]}</em><b>${CHAPTERS[ch]}</b>${sub ? `<span>${sub}</span>` : ""}`;
      cardEl.classList.add("on");
      cardT = 4.2;
      sfx.chime(true);
    }
    // Where the goal is: a diamond over it while it is in view, metres to it always.
    const _wp = V3(), _wv = V3();
    let distShown = null, wpShown = false;
    function updateGuide() {
      const g = goalPos;
      if (!g || state.screen !== "play") {
        if (wpShown) { wpShown = false; wpEl.hidden = true; }
        if (distShown !== "") { distShown = ""; distEl().textContent = ""; }
        return;
      }
      const d = Math.hypot(g.x - P.x, g.z - P.z);
      const ds = d < 4 ? "" : ` \u00b7 ${Math.round(d)} m`;
      if (ds !== distShown) { distShown = ds; distEl().textContent = ds; }
      _wv.set(g.x, (g.y || 0) + 1.1, g.z).applyMatrix4(camera.matrixWorldInverse);
      _wp.set(g.x, (g.y || 0) + 1.1, g.z).project(camera);
      const on = _wv.z < -1 && Math.abs(_wp.x) < 0.94 && Math.abs(_wp.y) < 0.9 && d > 4;
      if (on !== wpShown) { wpShown = on; wpEl.hidden = !on; }
      if (on) {
        wpEl.style.transform = `translate(${((_wp.x * 0.5 + 0.5) * ctx.width).toFixed(1)}px,${((0.5 - _wp.y * 0.5) * ctx.height).toFixed(1)}px)`;
        wpDist.textContent = `${Math.round(d)} m`;
      }
    }
    const distEl = () => objEl.querySelector("small") || objEl;
    function updateHud() {
      const o = objective();
      objEl.innerHTML = `${o.text}<small></small>`;
      distShown = null;
      goalPos = o.at || null;
      if (o.ch > shownChapter && state.screen === "play") {
        if (shownChapter >= 0 || o.ch > 0) chapterCard(o.ch, o.text);
        shownChapter = o.ch;
      }
      const chip = (kind, label, done) => `<div class="sw-chip${done ? " done" : ""}"><b class="k-${kind}"></b>${label}</div>`;
      invEl.innerHTML = [
        state.boots ? chip("coil", "Boots", true) : chip("coil", `${state.coils}/${COILS_NEED}`),
        state.bazooka ? chip("part", "Bazooka", true) : chip("part", `${state.parts}/${PARTS_NEED}`),
        state.rockets || state.bazooka ? chip("rocket", `${state.rockets}`) : "",
        state.crackers ? chip("firecracker", `${state.crackers}`) : ""
      ].join("");
      duckCount.textContent = state.ducks > 0 ? state.ducks : state.crackers;
      duckBtn.classList.toggle("empty", state.ducks <= 0 && state.crackers <= 0);
      fireBtn.hidden = !state.bazooka;
      rocketCount.textContent = state.rockets;
      gun.visible = state.bazooka && P.alive;
      crossEl.classList.toggle("on", state.bazooka || state.aiming);
    }
    let toastT = 0, earT = 0;
    const toastQ = [];
    function showToast(q) {
      toastEl.innerHTML = `<b>${q.title}</b>${q.sub ? `<span>${q.sub}</span>` : ""}`;
      toastEl.classList.add("on");
      toastT = q.secs;
    }
    function toast(title, sub, secs) {
      const q = { title, sub, secs: secs || 3.4 };
      if ((toastT <= 0.4 && cardT <= 0) || toastQ.length > 3) showToast(q); else toastQ.push(q);
    }
    function stepToasts(dt) {
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove("on"); }
      else if (toastQ.length && cardT <= 0) showToast(toastQ.shift());
      if (cardT > 0) { cardT -= dt; if (cardT <= 0) cardEl.classList.remove("on"); }
    }
    // A hint is said once a run, the first time it is true.
    function hint(key, title, sub, secs) {
      if (state.hints[key]) return;
      state.hints[key] = true;
      toast(title, sub, secs || 5.5);
    }
    // A page of the journal, held up to read until you tap it away.
    let readerT = 0;
    function showPage(pg, marked) {
      readerEl.innerHTML = `<b>${pg.t}</b><p>${pg.x}</p><small>${marked ? `${marked} ${marked === 1 ? "place" : "places"} marked on your map \u00b7 ` : ""}Tap to put it away</small>`;
      readerEl.hidden = false;
      readerT = 14;
    }
    function hidePage() { readerEl.hidden = true; readerT = 0; }
    function showEar(text, secs) {
      earText.textContent = text;
      earText.classList.add("on");
      earT = secs || 2;
    }
    const flashU = mFinal.uniforms.uFlash.value;
    function flashScreen(r, g, b, a, secs) { flashU.set(r, g, b, a); flashU.fade = a / Math.max(0.05, secs); }

    /* ---- the map: what you have seen, in 4 m squares ---- */
    const explored = new Uint8Array(64 * 64);
    const mapCell = new Uint8Array(64 * 64);
    let mapBuilt = "";
    function buildMapBase() {
      for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
        let h = 0;
        for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) h += heightAt(swamp, i * 4 + 1 + u * 2, j * 4 + 1 + v * 2) / 4;
        mapCell[j * 64 + i] = h < -0.6 ? 1 : h < 0.05 ? 2 : 3;
      }
      // What people built, as outlines of their footprints.
      let d = "";
      for (const c of BUILD.colliders) {
        if (c.round || c.hx * c.hz < 0.02) continue;
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const pt = (lx, lz) => `${(c.x + lx * cs + lz * sn).toFixed(1)} ${(c.z - lx * sn + lz * cs).toFixed(1)}`;
        d += `M${pt(-c.hx, -c.hz)}L${pt(c.hx, -c.hz)}L${pt(c.hx, c.hz)}L${pt(-c.hx, c.hz)}Z`;
      }
      mapBuilt = d;
    }
    function paintMap() {
      const paths = ["", "", "", ""];
      for (let j = 0; j < 64; j++) {
        let t0 = 0, i0 = 0;
        for (let i = 0; i <= 64; i++) {
          const t = i < 64 && explored[j * 64 + i] ? mapCell[j * 64 + i] : 0;
          if (t !== t0) {
            if (t0) paths[t0] += `M${i0 * 4} ${j * 4}h${(i - i0) * 4}v4h${-(i - i0) * 4}z`;
            t0 = t; i0 = i;
          }
        }
      }
      let marks = "";
      for (const key in POI) {
        if (!state.seen[key]) continue;
        const p = POI[key];
        marks += `<circle cx="${p.x}" cy="${p.z}" r="2.2" fill="#ffcf6a"/><text x="${p.x}" y="${p.z - 4.5}" text-anchor="middle">${p.name}</text>`;
      }
      for (const it of items) {
        if (it.taken || !(it.seen || it.known)) continue;
        if (it.seen) marks += `<circle class="k-${it.kind}" cx="${it.x.toFixed(1)}" cy="${it.z.toFixed(1)}" r="1.7" stroke="#050b0b" stroke-width=".6"/>`;
        else marks += `<circle class="k-${it.kind} ring" cx="${it.x.toFixed(1)}" cy="${it.z.toFixed(1)}" r="1.9"/>`;
      }
      if (goalPos) marks += `<rect x="${(goalPos.x - 2.4).toFixed(1)}" y="${(goalPos.z - 2.4).toFixed(1)}" width="4.8" height="4.8" transform="rotate(45 ${goalPos.x.toFixed(1)} ${goalPos.z.toFixed(1)})" fill="none" stroke="#ffcf6a" stroke-width="1"/>`;
      const ang = (-P.yaw * 180) / Math.PI;
      mapSvg.innerHTML = `<path d="${paths[1]}" fill="#0b1c1e"/><path d="${paths[2]}" fill="#1d3330"/><path d="${paths[3]}" fill="#3b4529"/>` +
        `<path d="${mapBuilt}" fill="rgba(220,190,140,.55)"/>${marks}` +
        `<g transform="translate(${P.x.toFixed(1)} ${P.z.toFixed(1)}) rotate(${ang.toFixed(0)})"><path d="M0 -5 L3.6 4 L0 2 L-3.6 4z" fill="#fff" stroke="#050b0b" stroke-width=".8"/></g>`;
    }
    function openMap() { paintMap(); mapView.hidden = false; }
    function closeMap() { mapView.hidden = true; }
    function exploreTick() {
      const ci = Math.floor(P.x / 4), cj = Math.floor(P.z / 4);
      const R = P.y > 5 ? 14 : 6;
      for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || j < 0 || i >= 64 || j >= 64) continue;
        if ((i - ci) ** 2 + (j - cj) ** 2 <= R * R) explored[j * 64 + i] = 1;
      }
      for (const key in POI) {
        if (state.seen[key]) continue;
        const p = POI[key];
        if (Math.hypot(p.x - P.x, p.z - P.z) < 26) {
          state.seen[key] = true;
          toast(p.name, "");
          if (track) track.set(progressScore());
        }
      }
      for (const it of items) if (!it.seen && Math.hypot(it.x - P.x, it.z - P.z) < 18) it.seen = true;
      // From the top of the watchtower, the whole swamp.
      if (!state.towerSeen && P.y > 7 && Math.hypot(P.x - POI.tower.x, P.z - POI.tower.z) < 4) {
        state.towerSeen = true;
        for (const key in POI) state.seen[key] = true;
        for (const key in POI) {
          const p = POI[key], pi = Math.floor(p.x / 4), pj = Math.floor(p.z / 4);
          for (let j = pj - 5; j <= pj + 5; j++) for (let i = pi - 5; i <= pi + 5; i++) if (i >= 0 && j >= 0 && i < 64 && j < 64 && (i - pi) ** 2 + (j - pj) ** 2 <= 25) explored[j * 64 + i] = 1;
        }
        toast("The whole swamp", "Every place you can reach is on your map now", 5);
        if (track) track.set(progressScore());
      }
    }

    /* ---- input ---- */
    const input = { lookDX: 0, lookDY: 0, keys: {}, sneakKey: false };
    const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    const lookPtr = { id: null, lx: 0, ly: 0 };
    function readMove() {
      let x = 0, y = 0;
      const k = input.keys;
      if (k.KeyW || k.ArrowUp) y += 1;
      if (k.KeyS || k.ArrowDown) y -= 1;
      if (k.KeyA) x -= 1;
      if (k.KeyD) x += 1;
      if (x || y) { const L = Math.hypot(x, y); return { x: x / L, y: y / L }; }
      if (stick.id === null) return { x: 0, y: 0 };
      let dx = (stick.x - stick.ox) / 56, dy = (stick.y - stick.oy) / 56;
      const L = Math.hypot(dx, dy);
      if (L > 1) { dx /= L; dy /= L; }
      return { x: dx, y: -dy };
    }
    ctx.listen(touchEl, "pointerdown", e => {
      if (state.screen !== "play") return;
      if (e.cancelable) e.preventDefault();
      const r = touchEl.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.pointerType !== "mouse" && x < r.width * 0.46 && stick.id === null) {
        Object.assign(stick, { id: e.pointerId, ox: x, oy: y, x, y });
        stickEl.style.left = x + "px"; stickEl.style.top = y + "px";
        knobEl.style.transform = "translate(0px,0px)";
        stickEl.hidden = false;
      } else if (lookPtr.id === null) Object.assign(lookPtr, { id: e.pointerId, lx: e.clientX, ly: e.clientY });
      try { touchEl.setPointerCapture(e.pointerId); } catch (err) { /* released by the window listeners */ }
      sfx.unlock();
    });
    ctx.listen(touchEl, "pointermove", e => {
      if (e.pointerId === stick.id) {
        const r = touchEl.getBoundingClientRect();
        stick.x = e.clientX - r.left; stick.y = e.clientY - r.top;
        const dx = stick.x - stick.ox, dy = stick.y - stick.oy, L = Math.hypot(dx, dy);
        if (L > 70) { stick.ox += dx / L * (L - 70); stick.oy += dy / L * (L - 70); stickEl.style.left = stick.ox + "px"; stickEl.style.top = stick.oy + "px"; }
        const kx = clamp(stick.x - stick.ox, -56, 56), ky = clamp(stick.y - stick.oy, -56, 56);
        knobEl.style.transform = `translate(${kx}px,${ky}px)`;
        const m = Math.hypot(kx, ky) / 56;
        stickEl.classList.toggle("quiet", m < 0.62 && m > 0.12);
      } else if (e.pointerId === lookPtr.id) {
        input.lookDX += e.clientX - lookPtr.lx; input.lookDY += e.clientY - lookPtr.ly;
        lookPtr.lx = e.clientX; lookPtr.ly = e.clientY;
      }
    });
    const release = e => {
      if (e.pointerId === stick.id) { stick.id = null; stickEl.hidden = true; stickEl.classList.remove("quiet"); }
      if (e.pointerId === lookPtr.id) lookPtr.id = null;
      if (e.pointerId === duckPtr) { duckPtr = null; if (state.aiming) { const what = state.aiming; state.aiming = false; if (what === "stone") throwStone(); else throwLure(); updateHud(); } }
    };
    let duckPtr = null;
    ctx.listen(touchEl, "pointerup", release);
    ctx.listen(touchEl, "pointercancel", release);
    ctx.listen(window, "pointerup", release);
    ctx.listen(window, "pointercancel", release);
    ctx.listen(window, "blur", () => { stick.id = null; lookPtr.id = null; duckPtr = null; state.aiming = false; stickEl.hidden = true; input.keys = {}; });
    ctx.listen(btnsEl, "pointerdown", e => {
      const b = e.target && e.target.closest ? e.target.closest("[data-btn]") : null;
      if (!b || state.screen !== "play") return;
      if (e.cancelable) e.preventDefault();
      b.classList.add("on");
      ctx.timeout(() => b.classList.remove("on"), 140);
      const k = b.getAttribute("data-btn");
      if (k === "jump") jump();
      else if (k === "fire") fire();
      else if (k === "use") useThing();
      else if (k === "duck" || k === "stone") {
        if (k === "duck" && state.ducks <= 0 && state.crackers <= 0) { toast("Out of ducks", "There are crates at the camps and the shacks"); return; }
        duckPtr = e.pointerId; state.aiming = k; updateHud();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* window listeners release it */ }
      }
      sfx.unlock();
    });
    ctx.listen(btnsEl, "pointerup", release);
    ctx.listen($("[data-mapbtn]"), "click", () => { if (state.screen === "play") openMap(); });
    // The journal: what the night asks of you, and Eli's pages.
    function journalHtml() {
      const o = objective();
      const nSeen = Object.keys(state.seen).length, nPOI = Object.keys(POI).length, nPages = Object.keys(state.pages).length;
      const goals = [
        { t: "Reach the Fishing Camp", done: !!state.pages[2] },
        { t: `Spring coils: ${Math.min(state.coils, COILS_NEED)} of ${COILS_NEED}`, done: state.coils >= COILS_NEED || state.boots },
        { t: "Make the spring boots", done: state.boots },
        { t: "Look out from the Watchtower", done: state.towerSeen },
        { t: `Bazooka parts: ${Math.min(state.parts, PARTS_NEED)} of ${PARTS_NEED}`, done: state.parts >= PARTS_NEED || state.bazooka },
        { t: "Build the bazooka", done: state.bazooka },
        { t: `Rockets: ${state.rockets} carried, ${state.rocketsFound} of 5 found`, done: state.rocketsFound >= 5 },
        { t: `Hit it while its head is up: ${state.hits} of ${CREATURE_HP}`, done: state.hits >= CREATURE_HP }
      ];
      const side = [
        { t: `Places found: ${nSeen} of ${nPOI}`, done: nSeen >= nPOI },
        { t: `Journal pages: ${nPages} of ${PAGE_COUNT}`, done: nPages >= PAGE_COUNT },
        { t: `Or leave: fuel${state.fuel ? " (have it)" : ""}, the key${state.key ? " (have it)" : ""}, the boat at the boathouse`, done: state.escaped }
      ];
      const now = goals.findIndex(g => !g.done);
      const li = (g, cur) => `<li class="${g.done ? "done" : cur ? "now" : ""}"><i>${g.done ? "\u2713" : ""}</i><span>${g.t}</span></li>`;
      const pages = Object.keys(state.pages).map(Number).sort((a, b) => a - b).map(n => `<div class="sw-page"><b>${PAGES[n].t}</b>${PAGES[n].x}</div>`).join("");
      return `<button class="sw-close" data-close>Close</button><h2>Journal</h2><p>${o.text}</p>
<h3>The night</h3><ul class="sw-goals">${goals.map((g, i) => li(g, i === now)).join("")}</ul>
<h3>Besides</h3><ul class="sw-goals">${side.map(g => li(g, false)).join("")}</ul>
<h3>Eli's pages</h3>${pages || "<p>None yet. He left his journal in pages across the swamp.</p>"}
<h3>How it hears</h3><p>On land, nothing. Wading, every step: further the deeper and faster you go. Swimming carries furthest of all. Rotten planks creak down into the water unless you walk gently, and a landing thuds. Rain hides you. A stone, a duck, the bell or the generator draws it away from you.</p>`;
    }
    function openJournal() { sheetEl.innerHTML = journalHtml(); sheetEl.hidden = false; }
    function closeJournal() { sheetEl.hidden = true; sheetEl.innerHTML = ""; }
    ctx.listen(objEl, "click", () => { if (state.screen === "play") openJournal(); });
    ctx.listen(sheetEl, "click", () => closeJournal());
    ctx.listen(readerEl, "click", () => hidePage());
    ctx.listen(mapView, "click", () => closeMap());
    ctx.listen(window, "keydown", e => {
      if (e.repeat) return;
      input.keys[e.code] = true;
      if (state.screen === "play") {
        if (e.code === "Space") { e.preventDefault(); jump(); }
        else if (e.code === "KeyQ") { if (state.ducks > 0 || state.crackers > 0) { state.aiming = "duck"; updateHud(); } }
        else if (e.code === "KeyR") { state.aiming = "stone"; updateHud(); }
        else if (e.code === "KeyJ") { if (sheetEl.hidden) openJournal(); else closeJournal(); }
        else if (e.code === "KeyE") useThing();
        else if (e.code === "KeyF" || e.code === "Enter") fire();
        else if (e.code === "KeyM") { if (mapView.hidden) openMap(); else closeMap(); }
        else if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sneakKey = true;
        else if (e.code === "ArrowLeft") input.turnL = true;
        else if (e.code === "ArrowRight") input.turnR = true;
      } else if (e.code === "Enter" && !modalEl.hidden) { const go = modalEl.querySelector("[data-go]"); if (go) go.click(); }
    });
    ctx.listen(window, "keyup", e => {
      input.keys[e.code] = false;
      if ((e.code === "KeyQ" || e.code === "KeyR") && state.aiming) { const what = state.aiming; state.aiming = false; if (what === "stone") throwStone(); else throwLure(); updateHud(); }
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sneakKey = false;
      if (e.code === "ArrowLeft") input.turnL = false;
      if (e.code === "ArrowRight") input.turnR = false;
    });

    /* ---- game beats on the game clock ---- */
    const beats = [];
    function after(secs, fn) { beats.push({ at: state.t + secs, fn }); }
    function runBeats() { for (let i = beats.length - 1; i >= 0; i--) if (state.t >= beats[i].at) { const b = beats.splice(i, 1)[0]; b.fn(); } }

    /* ---- menus ---- */
    const BUILD_TAG = "sw-b3";
    const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    function menuHtml() {
      const best = state.best ? `<p class="sw-tag">Best: <b>${rankOf(state.best)}</b> &middot; ${state.best} pts${state.bestTime ? ` &middot; killed it in ${fmtTime(state.bestTime)}` : ""}</p>` : "";
      return `<h1 class="sw-title">Still<br>Water</h1>
<p class="sw-tag">It cannot see you. <b>It only hears the water.</b></p>
${best}
<p class="sw-how">Wade slowly; never swim. Build spring boots and a bazooka at the camp. Call it up with a duck, and shoot the head.</p>
<button class="sw-go" data-go>Enter the swamp</button>
<div class="sw-row">
  <button class="sw-ghost" data-sound>Sound ${state.sound ? "on" : "off"}</button>
  <button class="sw-ghost" data-haptics>Buzz ${state.haptics ? "on" : "off"}</button>
  <button class="sw-ghost" data-look>Look ${state.look < 0.8 ? "slow" : state.look > 1.3 ? "fast" : "normal"}</button>
</div>
<p class="sw-build">${BUILD_TAG}</p>`;
    }
    function resultHtml(won) {
      const secs = Math.max(0, state.t - state.runStart), score = progressScore();
      return `<span class="sw-rank">${rankOf(score)}</span>
<h1 class="sw-title sw-small">${won ? "Still<br>water." : state.escaped ? "Out." : "It heard<br>you."}</h1>
<p class="sw-tag">${won ? "The swamp is quiet. Dawn is coming." : state.escaped ? "The motor carried you out. It is still in there." : state.deathCause || "The water carried every step."}</p>
<ul class="sw-stats">
  <li><span>Progress</span><b>${score} pts</b></li>
  <li><span>Spring coils</span><b>${state.boots ? "Boots" : state.coils + " / " + COILS_NEED}</b></li>
  <li><span>Bazooka parts</span><b>${state.bazooka ? "Built" : state.parts + " / " + PARTS_NEED}</b></li>
  <li><span>Places found</span><b>${Object.keys(state.seen).length} / ${Object.keys(POI).length}</b></li>
  <li><span>Hits on it</span><b>${state.hits} / ${CREATURE_HP}</b></li>
  <li><span>Time in the swamp</span><b>${fmtTime(secs)}</b></li>
</ul>
${won || state.escaped ? `<button class="sw-go" data-go>Go back in</button>
<div class="sw-row"><button class="sw-ghost" data-menu>Title</button></div>` : `<button class="sw-go" data-wake>Wake at the camp</button>
<div class="sw-row"><button class="sw-ghost" data-go>Start over</button><button class="sw-ghost" data-menu>Title</button></div>
<p class="sw-build">Waking keeps what you found and costs 400 points</p>`}`;
    }
    function showModal(html) {
      modalEl.innerHTML = html;
      modalEl.hidden = false;
      hudEl.hidden = true; btnsEl.hidden = true; stickEl.hidden = true;
      stick.id = null; lookPtr.id = null; state.aiming = false;
      closeMap(); closeJournal(); hidePage();
    }
    function hideModal() { modalEl.innerHTML = ""; modalEl.hidden = true; hudEl.hidden = false; btnsEl.hidden = false; }
    ctx.listen(modalEl, "click", e => {
      const el = e.target && e.target.closest ? e.target.closest("[data-go],[data-wake],[data-menu],[data-sound],[data-haptics],[data-look]") : null;
      if (!el) return;
      sfx.unlock();
      if (el.hasAttribute("data-wake")) { wakeAtCamp(); return; }
      if (el.hasAttribute("data-go")) { startRun(); return; }
      if (el.hasAttribute("data-menu")) { gotoMenu(); return; }
      if (el.hasAttribute("data-sound")) { state.sound = !state.sound; sfx.setEnabled(state.sound); }
      else if (el.hasAttribute("data-haptics")) { state.haptics = !state.haptics; haptic("light"); }
      else if (el.hasAttribute("data-look")) state.look = state.look < 0.8 ? 1 : state.look > 1.3 ? 0.6 : 1.6;
      save();
      showModal(menuHtml());
    });

    /* ================================================================ *
     * SET DRESSING
     * Mist lying on the water, logs and stumps and stones, fungi that
     * glow on the dead wood, moths round the lanterns.
     * ================================================================ */
    // A soft bank of mist: a noisy blob, densest low down, fading out at its edges.
    const mistTex = (() => {
      const W = 128, H = 64, d = new Uint8Array(W * H * 4), n = latticeNoise(301);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const u = x / (W - 1) * 2 - 1, v = y / (H - 1);
        const edge = (1 - smooth(0.55, 1.0, Math.abs(u))) * smooth(0.0, 0.25, v) * (1 - smooth(0.45, 1.0, v));
        const k = fbmOf(n, x / 22, y / 14, 4, 0) * 1.3 - 0.15;
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = clamp(edge * k, 0, 1) * 255;
      }
      return dataTex(d, W, H, { clamp: true });
    })();
    const mistMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTex: { value: mistTex }, uTime: SHARED.uTime, uFogA: SHARED.uFogA, uFogB: SHARED.uFogB, uMoonDir: SHARED.uMoonDir, uRain: { value: 0 } },
      vertexShader: /* glsl */`
        uniform float uTime;
        attribute vec4 aMist;   // x, z, width, seed
        varying vec2 vUv; varying float vA; varying vec3 vW;
        void main() {
          vUv = uv;
          float w = aMist.z, h = w * 0.22;
          vec3 c = vec3(aMist.x + sin(uTime * 0.02 + aMist.w * 6.3) * 4.0, 0.15 + aMist.w * 0.5, aMist.y + cos(uTime * 0.017 + aMist.w * 4.1) * 4.0);
          // Face the camera about the vertical only, so the bank lies on the water.
          vec3 toCam = cameraPosition - c; toCam.y = 0.0;
          vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
          vec3 p = c + side * (position.x * w) + vec3(0.0, (position.y + 0.5) * h, 0.0);
          vW = p;
          float d = length(cameraPosition.xz - c.xz);
          vA = smoothstep(4.0, 18.0, d) * (1.0 - smoothstep(110.0, 150.0, d));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; uniform vec3 uFogA, uFogB, uMoonDir; uniform float uRain;
        varying vec2 vUv; varying float vA; varying vec3 vW;
        void main() {
          float a = texture2D(uTex, vUv).a * vA * 0.3 * (1.0 - uRain * 0.6);
          if (a < 0.004) discard;
          vec3 dir = normalize(vW - cameraPosition);
          float toward = pow(max(dot(dir, uMoonDir), 0.0), 3.0);
          vec3 c = mix(uFogA * 1.35, uFogB * 0.9, 0.25 + toward * 0.45);
          gl_FragColor = vec4(c, a);
        }`
    });
    function buildMist(seed) {
      const rng = mulberry32(seed ^ 0x3157), banks = [];
      for (let k = 0; k < 6000 && banks.length < 150; k++) {
        const x = 16 + rng() * (SIZE - 32), z = 16 + rng() * (SIZE - 32);
        if (heightAt(swamp, x, z) > -0.3) continue;
        if (banks.some(b => (b[0] - x) ** 2 + (b[1] - z) ** 2 < 100)) continue;
        banks.push([x, z, 9 + rng() * 14, rng()]);
      }
      const base = new THREE.PlaneGeometry(1, 1);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      g.setAttribute("position", base.attributes.position);
      g.setAttribute("uv", base.attributes.uv);
      g.setAttribute("aMist", new THREE.InstancedBufferAttribute(new Float32Array(banks.flat()), 4));
      g.instanceCount = banks.length;
      const m = new THREE.Mesh(g, mistMat);
      m.frustumCulled = false;
      m.renderOrder = 5;
      return m;
    }

    // Fungi: little caps in clusters, glowing cyan and here and there violet.
    // At night they are lights, not shapes, so each is a single point.
    const fungusMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 }, uTime: SHARED.uTime },
      vertexShader: /* glsl */`
        uniform float uScale, uTime;
        attribute vec4 aF;   // size, rate, phase, violet
        varying vec3 vC; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vC = aF.w > 0.5 ? vec3(0.7, 0.45, 1.0) : vec3(0.35, 1.0, 0.82);
          vA = (0.72 + 0.28 * sin(uTime * (0.4 + aF.y) + aF.z * 30.0)) * (1.0 - smoothstep(35.0, 95.0, -mv.z));
          gl_PointSize = aF.x * 0.2 * uScale / max(-mv.z, 0.3);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = 1.0 - smoothstep(0.12, 0.38, d), halo = exp(-d * d * 3.5) * 0.3;
          gl_FragColor = vec4(vC * (core * 3.2 + halo) * vA, 1.0);
        }`
    });
    // Logs, stumps and stones on the islands and in the shallows.
    function logGeometry(rng) {
      const pts = [], len = 3 + rng() * 4, r = 0.22 + rng() * 0.2;
      for (let k = 0; k <= 5; k++) pts.push(V3((k / 5 - 0.5) * len, Math.sin(k * 1.3) * 0.04, (rng() - 0.5) * 0.25));
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, r, 9, false);
      const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(0.85);
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      return { g, len, r };
    }
    const rockMat = swampify(new THREE.MeshStandardMaterial({ color: 0x55534c, roughness: 0.92, flatShading: true }), {
      key: "rock",
      fMap: /* glsl */`
        {
          float n = texture2D(uNoise, vSWorld.xz * 0.7 + vSWorld.y * 0.3).r;
          vec3 c = mix(vec3(0.16, 0.155, 0.14), vec3(0.3, 0.29, 0.27), n);
          c = mix(c, vec3(0.05, 0.08, 0.035), (1.0 - smoothstep(0.0, 0.5, vSWorld.y + n * 0.4)) * 0.8);
          diffuseColor.rgb = c;
        }
      `
    });
    function buildDressing(seed) {
      const rng = mulberry32(seed ^ 0xd2e5);
      const group = new THREE.Group();
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V3(), e = new THREE.Euler();
      const fungi = [];
      // Fungi round the feet of the trees, on the shaded side.
      for (const t of trees.pts) {
        if (rng() > 0.8) continue;
        const clusters = 2 + Math.floor(rng() * 3);
        for (let c = 0; c < clusters; c++) {
          const a = rng() * Math.PI * 2, rr = 0.55 * t.s + rng() * 0.25, y = t.y + 0.15 + rng() * 0.9;
          const n = 3 + Math.floor(rng() * 5), violet = rng() < 0.18;
          for (let k = 0; k < n; k++) {
            const aa = a + (rng() - 0.5) * 0.5, yy = y + (rng() - 0.5) * 0.35;
            if (yy < WATER_Y + 0.05) continue;
            fungi.push({ x: t.x + Math.cos(aa) * (rr + 0.03), y: yy, z: t.z + Math.sin(aa) * (rr + 0.03), s: 0.6 + rng() * 0.9, ry: aa, tilt: 0.9, violet });
          }
        }
      }
      // Fallen logs: across the islands and half sunk at their edges.
      const logs = [], logG = [logGeometry(mulberry32(seed + 71)), logGeometry(mulberry32(seed + 72)), logGeometry(mulberry32(seed + 73))];
      for (let k = 0; k < 8000 && logs.length < 90; k++) {
        const x = 14 + rng() * (SIZE - 28), z = 14 + rng() * (SIZE - 28), y = heightAt(swamp, x, z);
        if (y < -0.7 || y > 1.2 || siteBlocked(x, z, 3.5)) continue;
        if (logs.some(l => (l.x - x) ** 2 + (l.z - z) ** 2 < 64)) continue;
        const v = logs.length % 3, ry = rng() * Math.PI;
        logs.push({ x, z, y: Math.max(y, -0.35) + logG[v].r * 0.35, ry, v });
        // Fungi along the top of the log.
        if (rng() < 0.6) {
          const n = 4 + Math.floor(rng() * 8), violet = rng() < 0.2;
          for (let f = 0; f < n; f++) {
            const u = (rng() - 0.5) * logG[v].len * 0.8;
            const side = rng() < 0.5 ? 1 : -1;
            const fx = x + Math.cos(ry) * u - Math.sin(ry) * side * logG[v].r * 0.6, fz = z - Math.sin(ry) * u - Math.cos(ry) * side * logG[v].r * 0.6;
            fungi.push({ x: fx, y: Math.max(y, -0.35) + logG[v].r * 1.15, z: fz, s: 0.5 + rng() * 0.8, ry: rng() * 6, tilt: 0, violet });
          }
        }
      }
      for (let v = 0; v < 3; v++) {
        const mine = logs.filter(l => l.v === v);
        if (!mine.length) continue;
        const im = new THREE.InstancedMesh(logG[v].g, barkMat, mine.length);
        mine.forEach((l, k) => { e.set((rng() - 0.5) * 0.12, l.ry, (rng() - 0.5) * 0.1); q.setFromEuler(e); m4.compose(V3(l.x, l.y, l.z), q, s.set(1, 1, 1)); im.setMatrixAt(k, m4); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true;
        group.add(im);
      }
      // Stumps: short, flared, broken off; and stones.
      const stumpG = new THREE.CylinderGeometry(0.32, 0.6, 1, 10, 2, false);
      { const n = stumpG.attributes.position.count, c = new Float32Array(n * 3).fill(0.8); stumpG.setAttribute("color", new THREE.BufferAttribute(c, 3)); stumpG.translate(0, 0.5, 0); }
      const stumps = [];
      for (let k = 0; k < 6000 && stumps.length < 70; k++) {
        const x = 14 + rng() * (SIZE - 28), z = 14 + rng() * (SIZE - 28), y = heightAt(swamp, x, z);
        if (y < -1.1 || y > 1.3 || siteBlocked(x, z, 2.5)) continue;
        stumps.push({ x, z, y: y - 0.2, h: 0.5 + rng() * 1.4, s: 0.6 + rng() * 0.6 });
        if (rng() < 0.55) { const n = 3 + Math.floor(rng() * 5), a0 = rng() * 6; for (let f = 0; f < n; f++) { const a = a0 + f * 0.5; fungi.push({ x: x + Math.cos(a) * 0.36 * (0.6 + rng() * 0.6) * (0.6 + rng() * 0.6), y: Math.max(y, 0) + 0.25 + rng() * 0.5, z: z + Math.sin(a) * 0.36 * (0.6 + rng() * 0.6), s: 0.5 + rng() * 0.7, ry: a, tilt: 0.9, violet: rng() < 0.15 }); } }
      }
      {
        const im = new THREE.InstancedMesh(stumpG, barkMat, stumps.length);
        stumps.forEach((t, k) => { q.setFromAxisAngle(V3(0, 1, 0), rng() * 6); m4.compose(V3(t.x, t.y, t.z), q, s.set(t.s, t.h, t.s)); im.setMatrixAt(k, m4); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true;
        group.add(im);
        for (const t of stumps) if (Math.max(heightAt(swamp, t.x, t.z), WATER_Y) + 0.4 < t.y + t.h) BUILD.colliders.push({ x: t.x, z: t.z, hx: 0.4 * t.s, hz: 0.4 * t.s, rot: 0, y0: t.y - 1, y1: t.y + t.h, floor: false, round: true });
      }
      const rocks = [];
      for (let k = 0; k < 6000 && rocks.length < 160; k++) {
        const x = 14 + rng() * (SIZE - 28), z = 14 + rng() * (SIZE - 28), y = heightAt(swamp, x, z);
        if (y < -0.5 || y > 1.5 || insideBuilt(x, z, 0.8)) continue;
        rocks.push({ x, z, y: y - 0.05, s: 0.15 + rng() * rng() * 0.6 });
      }
      {
        const rg = new THREE.IcosahedronGeometry(1, 1), p = rg.attributes.position, rn = mulberry32(seed + 77);
        for (let i = 0; i < p.count; i++) { const k = 0.75 + rn() * 0.4; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.6, p.getZ(i) * k); }
        rg.computeVertexNormals();
        const im = new THREE.InstancedMesh(rg, rockMat, rocks.length);
        rocks.forEach((r, k) => { e.set(rn() * 0.4, rn() * 6, rn() * 0.4); q.setFromEuler(e); m4.compose(V3(r.x, r.y, r.z), q, s.set(r.s * (1 + rn() * 0.6), r.s, r.s)); im.setMatrixAt(k, m4); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.receiveShadow = true; im.castShadow = true;
        group.add(im);
      }
      // All the fungi as one cloud of points.
      let glow = null;
      {
        const pos = new Float32Array(fungi.length * 3), aF = new Float32Array(fungi.length * 4);
        fungi.forEach((f, k) => {
          pos[k * 3] = f.x; pos[k * 3 + 1] = f.y + 0.03; pos[k * 3 + 2] = f.z;
          aF[k * 4] = f.s; aF[k * 4 + 1] = rng(); aF[k * 4 + 2] = rng(); aF[k * 4 + 3] = f.violet ? 1 : 0;
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("aF", new THREE.BufferAttribute(aF, 4));
        glow = new THREE.Points(g, fungusMat);
        glow.frustumCulled = false; glow.renderOrder = 6;
        group.add(glow);
      }
      return { group, glow, fungi: fungi.length, logs: logs.length, stumps: stumps.length, rocks: rocks.length };
    }

    // Moths round every lantern, and a soft halo where the light meets the mist.
    const mothMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: SHARED.uTime, uScale: { value: 600 } },
      vertexShader: /* glsl */`
        uniform float uTime, uScale;
        attribute vec4 aSeed;   // phase, radius, speed, kind (0 moth, 1 halo)
        varying float vK; varying float vA;
        void main() {
          vec3 p = position;
          vK = aSeed.w;
          if (aSeed.w < 0.5) {
            float t = uTime * aSeed.z + aSeed.x * 6.28;
            p += vec3(cos(t) * aSeed.y, sin(t * 1.7) * 0.25 + sin(t * 5.3) * 0.05, sin(t * 1.3) * aSeed.y);
            vA = 0.6 + 0.4 * sin(t * 17.0);
          } else vA = 1.0;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float size = aSeed.w < 0.5 ? 0.05 : 1.7;
          gl_PointSize = size * uScale / max(-mv.z, 0.3);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vK; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (vK < 0.5) { float a = (1.0 - smoothstep(0.3, 1.0, d)) * vA; gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * a * 2.6, 1.0); }
          else { float a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.7, 1.0, d)); gl_FragColor = vec4(vec3(1.0, 0.6, 0.26) * a * 0.12, 1.0); }
        }`
    });
    function buildMoths() {
      const pos = [], seeds = [];
      for (const L of BUILD.lamps) {
        if (L.gen) continue;
        pos.push(L.x, L.y, L.z); seeds.push(0, 0, 0, 1);
        const n = 4 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) { pos.push(L.x, L.y + 0.1, L.z); seeds.push(Math.random(), 0.25 + Math.random() * 0.45, 1.5 + Math.random() * 2.5, 0); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 4));
      const pts = new THREE.Points(g, mothMat);
      pts.frustumCulled = false; pts.renderOrder = 6;
      return pts;
    }

    /* ================================================================ *
     * THE OTHER WAY OUT
     * Fuel, Eli's key and the boat in the boathouse. The outboard is the
     * loudest thing in the swamp, so leaving is a race down the old canal.
     * ================================================================ */
    const boat = { g: null, home: null };
    function buildBoat() {
      const g = new THREE.Group();
      const wood = new THREE.MeshLambertMaterial({ color: 0x3d2f22, emissive: 0x070504 });
      const dark = new THREE.MeshLambertMaterial({ color: 0x24292b, emissive: 0x050606 });
      const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
      add(new THREE.BoxGeometry(1.4, 0.1, 4.0), wood, 0, -0.02, 0);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.42, 4.0), wood, s * 0.72, 0.18, 0);
      add(new THREE.BoxGeometry(1.4, 0.42, 0.08), wood, 0, 0.18, -2.0);
      add(new THREE.BoxGeometry(1.4, 0.42, 0.08), wood, 0, 0.18, 2.0);
      add(new THREE.BoxGeometry(1.36, 0.05, 0.3), wood, 0, 0.24, 0.6);
      add(new THREE.BoxGeometry(0.32, 0.5, 0.36), dark, 0, 0.45, 2.25);
      add(new THREE.BoxGeometry(0.1, 0.5, 0.12), dark, 0, 0.08, 2.3);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.6), dark, 0, 0.62, 1.9);
      const a = (BUILD.anchors.boat || [{ x: POI.boathouse.x, y: 0.1, z: POI.boathouse.z + 1 }])[0];
      g.position.set(a.x, WATER_Y + 0.02, a.z);
      scene.add(g);
      boat.g = g; boat.home = { x: a.x, z: a.z };
    }
    // Out of the boathouse's water door, west along its channel into the
    // lagoon, then south down the old canal and away.
    const ESCAPE_PTS = [[0, 0], [0, 7], [-6, 10], [-14, 5], [-20, 4], [-36, 1], [-44, 4], [-52, 13], [-55, 23], [-56, 37], [-56, 46]];
    function escapePath() {
      const h = boat.home, pts = ESCAPE_PTS.map(([dx, dz]) => V3(h.x + dx, WATER_Y, h.z + dz));
      const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      const len = curve.getLength();
      return { curve, len };
    }
    let escapeRun = null;
    const _ep = V3(), _et = V3();
    function startEscape() {
      if (escapeRun || !state.fuel || !state.key || state.screen !== "play") return;
      const { curve, len } = escapePath();
      escapeRun = { curve, len, s: 0, v: 0, t: 0, noiseT: 0, src: { x: boat.g.position.x, z: boat.g.position.z } };
      Object.assign(P, { vx: 0, vy: 0, vz: 0, ladder: null, vault: null, ground: true, medium: "swim" });
      state.aiming = false;
      toast("The motor catches", "Everything in the water heard that. Go.", 4);
      haptic("heavy");
      // It hears the motor from anywhere, and it comes.
      beastHear(boat.g.position.x, boat.g.position.z, 3, "motor", escapeRun.src);
      updateHud();
    }
    function stepEscape(dt) {
      const e = escapeRun;
      e.t += dt;
      P.px = P.x; P.py = P.y; P.pz = P.z;
      if (!P.alive) { e.v = Math.max(0, e.v - dt * 4); if (e.v <= 0) sfx.stopMotor(); }
      else e.v = Math.min(7.6, e.v + dt * (e.t < 1.2 ? 1.2 : 3.4));
      e.s = Math.min(e.len, e.s + e.v * dt);
      const u = e.s / e.len;
      e.curve.getPointAt(u, _ep);
      e.curve.getTangentAt(u, _et);
      const heading = Math.atan2(_et.x, _et.z);
      const bob = Math.sin(e.t * 9) * 0.02 * Math.min(1, e.v / 3);
      boat.g.position.set(_ep.x, WATER_Y + 0.02 + bob, _ep.z);
      boat.g.rotation.set(-0.05 * Math.min(1, e.v / 5), heading + Math.PI, Math.sin(e.t * 2.3) * 0.03);
      e.src.x = _ep.x; e.src.z = _ep.z;
      // You sit at the tiller, low over the water.
      if (P.alive) { P.x = _ep.x - _et.x * 1.55; P.z = _ep.z - _et.z * 1.55; P.y = WATER_Y - 0.5; }
      P.medium = "swim"; P.ground = true; P.moving = e.v;
      e.noiseT -= dt;
      if (e.noiseT <= 0 && P.alive) { e.noiseT = 0.4; beastHear(_ep.x, _ep.z, 3, "motor", e.src); addRipple(_ep.x - _et.x * 2.2, _ep.z - _et.z * 2.2, 0.03 + e.v * 0.005, 1); }
      if (Math.random() < e.v * dt * 3) spawnParticle(_ep.x + (Math.random() - 0.5) * 1.2, 0.08, _ep.z + (Math.random() - 0.5) * 1.2, -_et.x * 1.5 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, -_et.z * 1.5 + (Math.random() - 0.5) * 2, 0.7, 0.05, [0.45, 0.7, 0.75]);
      if (P.alive) sfx.motor(_ep.x, _ep.z, Math.min(1, e.v / 7.6));
      if (P.alive && e.s >= e.len - 0.5) {
        // Out under the dead trees, and the swamp is behind you.
        escapeRun = null;
        sfx.stopMotor();
        state.escaped = true;
        blackTarget = 0.85;
        haptic("success");
        after(1.6, () => finishRun(false));
      }
    }
    function resetBoat() {
      escapeRun = null;
      sfx.stopMotor();
      boat.g.position.set(boat.home.x, WATER_Y + 0.02, boat.home.z);
      boat.g.rotation.set(0, 0, 0);
    }

    /* ================================================================ *
     * STORAGE: a convenience, never a dependency
     * ================================================================ */
    const SAVE_KEY = "still-water/v2";
    const canRead = () => !!(ctx.storage && typeof ctx.storage.get === "function");
    const canWrite = () => !!(ctx.storage && typeof ctx.storage.set === "function");
    function save() {
      if (!canWrite()) return;
      try {
        const pending = ctx.storage.set(SAVE_KEY, { sound: state.sound, haptics: state.haptics, look: state.look, best: state.best, bestTime: state.bestTime });
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      } catch (e) { /* nothing here is worth a crash */ }
    }
    async function loadSaved() {
      if (!canRead()) return;
      let s = null;
      try { s = await ctx.storage.get(SAVE_KEY); } catch (e) { return; }
      if (!s || typeof s !== "object") return;
      if (typeof s.sound === "boolean") state.sound = s.sound;
      if (typeof s.haptics === "boolean") state.haptics = s.haptics;
      if (Number.isFinite(s.look)) state.look = clamp(s.look, 0.4, 2.2);
      if (Number.isFinite(s.best)) state.best = s.best;
      if (Number.isFinite(s.bestTime)) state.bestTime = s.bestTime;
    }
    const track = ctx.game && ctx.game.score ? ctx.game.score({ initial: 0, min: 0 }) : null;

    /* ================================================================ *
     * THE SWAMP, BUILT ONCE
     * It is the same swamp every night, so that it can be learned.
     * ================================================================ */
    const SEED = 4;
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.25).multiplyScalar(14) });
    const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.2).multiplyScalar(2.4), side: THREE.DoubleSide });
    let trees = null, plants = null, cover = null, dressing = null;
    function buildLights() {
      const g = new THREE.Group(), cage = [], wins = [], glows = [];
      for (const L of BUILD.lamps) {
        // Every flame in one mesh; the generator's floodlamp alone switches.
        const sg = toned(new THREE.SphereGeometry(L.gen ? 0.13 : 0.075, 10, 8).translate(L.x, L.y, L.z), 1);
        if (L.gen) { const m = new THREE.Mesh(sg, lampGlowMat); m.visible = false; g.add(m); L.mesh = m; }
        else glows.push(sg);
        // A tin hood over it and a ring under it.
        cage.push(toned(new THREE.CylinderGeometry(0.03, 0.12, 0.08, 10).translate(L.x, L.y + 0.12, L.z), 0.6));
        cage.push(toned(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10).translate(L.x, L.y - 0.1, L.z), 0.6));
      }
      for (const w of BUILD.windows) {
        const pg = new THREE.PlaneGeometry(w.w, w.h);
        pg.rotateY(w.rot);
        pg.translate(w.x, w.y, w.z);
        wins.push(toned(pg, 1));
      }
      if (glows.length) g.add(new THREE.Mesh(mergeGeoms(glows), lampGlowMat));
      if (cage.length) g.add(new THREE.Mesh(mergeGeoms(cage), darkMat));
      if (wins.length) g.add(new THREE.Mesh(mergeGeoms(wins), windowMat));
      return g;
    }
    function buildWorld() {
      swamp = makeSwamp(SEED);
      stampWorld(swamp);
      buildPlaces(swamp);
      indexColliders();
      world.heightTex = heightTexture(swamp);
      waterMat.uniforms.uHeight.value = world.heightTex;
      world.terrain = buildTerrain(swamp); scene.add(world.terrain);
      world.water = buildWater(); scene.add(world.water);
      world.sky = buildSky(); scene.add(world.sky);
      trees = buildTrees(swamp, SEED); scene.add(trees.group);
      indexTrees(trees.colliders);
      plants = buildPlants(swamp, SEED); scene.add(plants.group);
      cover = buildCover(swamp, SEED); scene.add(cover.group);
      world.fireflies = buildFireflies(swamp, SEED); scene.add(world.fireflies);
      dressing = buildDressing(SEED); scene.add(dressing.group);
      indexColliders();
      world.mist = buildMist(SEED); scene.add(world.mist);
      scene.add(finishBuild());
      scene.add(buildLights());
      world.moths = buildMoths(); scene.add(world.moths);
      // Small things stay out of the mirror: it costs a second drawing.
      hideInReflection.push(plants.group, cover.grassGroup, itemGroup, rain.pts, arc.pts, arc.ring, world.mist, world.moths, dressing.glow);
      buildNav();
      buildBeast();
      buildBoat();
      beast.lureLight = new THREE.PointLight(0x7fffe0, 0, 7, 2);
      scene.add(beast.lureLight);
      buildMapBase();
    }

    /* ---- the lamps: a few real lights, eased between the nearest ---- */
    // Each real light is lent to one lantern and fades up there. When
    // another lantern becomes clearly nearer, the light fades out first and
    // only then moves: nothing jumps, so nothing flashes as you walk.
    const slots = lampLights.map(light => ({ light, lamp: null, level: 0 }));
    const _lit = [], _hp = V3();
    const lampFlicker = (L, t) => 0.93 + 0.04 * Math.sin(t * 2.1 + L.flick) + 0.03 * Math.sin(t * 5.3 + L.flick * 1.7);
    function updateLamps(dt) {
      const cam = camera.position, t = SHARED.uTime.value;
      _lit.length = 0;
      for (const L of BUILD.lamps) {
        const on = !L.gen || state.t < L.until;
        if (L.mesh) L.mesh.visible = on;
        if (!on) continue;
        L.d = (L.x - cam.x) ** 2 + (L.y - cam.y) ** 2 + (L.z - cam.z) ** 2;
        L.held = false;
        _lit.push(L);
      }
      for (const s of slots) if (s.lamp) s.lamp.held = true;
      // A lantern that has a light keeps it until another is a good deal nearer.
      _lit.sort((a, b) => a.d * (a.held ? 0.55 : 1) - b.d * (b.held ? 0.55 : 1));
      const want = _lit.slice(0, slots.length);
      for (const s of slots) {
        const keep = s.lamp && want.includes(s.lamp) && (!s.lamp.gen || state.t < s.lamp.until);
        s.level = keep ? Math.min(1, s.level + dt * 2.2) : Math.max(0, s.level - dt * 3);
        if (!keep && s.level <= 0) s.lamp = null;
      }
      for (const L of want) {
        if (slots.some(s => s.lamp === L)) continue;
        const free = slots.find(s => !s.lamp);
        if (free) { free.lamp = L; free.level = 0; }
      }
      for (const s of slots) {
        const L = s.lamp;
        if (!L) { s.light.intensity = 0; continue; }
        const e = s.level * s.level * (3 - 2 * s.level);
        s.light.position.set(L.x, L.y - 0.05, L.z);
        s.light.intensity = 14 * L.k * lampFlicker(L, t) * e;
        s.light.distance = 18 + L.k * 5;
      }
      // Glints on the water: your own lantern, its lure, the nearest lamps,
      // fading with distance so that none of them pops in or out.
      let gi = 0;
      const carrying = state.screen === "play" && P.alive;
      handLight.intensity = carrying ? 2.6 * (0.95 + 0.05 * Math.sin(t * 3.1)) : state.screen === "won" ? 1.5 : 0;
      lantern.visible = carrying;
      if (carrying && P.eyeY > WATER_Y + 1.2) {
        handLight.getWorldPosition(_hp);
        glints.p[gi].set(_hp.x, _hp.y, _hp.z, 0.45); glints.c[gi].copy(LOOK.lantern).multiplyScalar(1.1); gi++;
      }
      if (C.alive && beast.lurePos.y > -0.3) {
        glints.p[gi].set(beast.lurePos.x, beast.lurePos.y, beast.lurePos.z, 0.5);
        glints.c[gi].setRGB(0.4, 1.0, 0.85).multiplyScalar(0.3 + beast.glow.value * 0.5); gi++;
      }
      _lit.sort((a, b) => a.d - b.d);
      for (let i = 0; gi < MAX_GLINT && i < _lit.length; i++, gi++) {
        const L = _lit[i], fade = clamp(1.4 - Math.sqrt(L.d) / 45, 0, 1);
        glints.p[gi].set(L.x, L.y, L.z, fade);
        glints.c[gi].copy(LOOK.lantern).multiplyScalar(2.2 * Math.min(L.k, 1.5));
      }
      for (; gi < MAX_GLINT; gi++) glints.p[gi].w = 0;
    }

    // The moon's shadows follow you in steps, redrawn only when you have moved.
    let shadowX = NaN, shadowZ = NaN;
    function updateShadow() {
      const c = camera.position;
      const sx = Math.round(c.x / 6) * 6, sz = Math.round(c.z / 6) * 6;
      if (sx === shadowX && sz === shadowZ) return;
      shadowX = sx; shadowZ = sz;
      moon.target.position.set(sx, 0, sz);
      moon.position.copy(moon.target.position).addScaledVector(LOOK.moonDir, 80);
      moon.target.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
    }

    /* ---- dawn, when it is dead ---- */
    const NIGHT = {
      zen: LOOK.skyZenith.clone(), hor: LOOK.skyHorizon.clone(), glow: LOOK.skyMoon.clone(), fogA: LOOK.fogA.clone(), fogB: LOOK.fogB.clone(),
      hemiSky: LOOK.hemiSky.clone(), hemiGround: LOOK.hemiGround.clone(), hemiI: LOOK.hemiI, sun: LOOK.moonColor.clone(), sunI: LOOK.moonI, fog: LOOK.fogDensity
    };
    const DAWN = {
      zen: col("#2f4c70"), hor: col("#c98b6c"), glow: col("#ffcf9e"), fogA: col("#4c5a63"), fogB: col("#d9a57f"),
      hemiSky: col("#93abc4"), hemiGround: col("#3a3426"), hemiI: 1.9, sun: col("#ffc98f"), sunI: 3.0, fog: 0.012
    };
    let dawnShown = -1;
    function setDawn(k) {
      state.dawn = k;
      if (Math.abs(k - dawnShown) < 0.003) return;
      dawnShown = k;
      const e = k * k * (3 - 2 * k);
      skyMat.uniforms.uZen.value.copy(NIGHT.zen).lerp(DAWN.zen, e);
      skyMat.uniforms.uHor.value.copy(NIGHT.hor).lerp(DAWN.hor, e);
      skyMat.uniforms.uMoonGlow.value.copy(NIGHT.glow).lerp(DAWN.glow, e);
      SHARED.uFogA.value.copy(NIGHT.fogA).lerp(DAWN.fogA, e);
      SHARED.uFogB.value.copy(NIGHT.fogB).lerp(DAWN.fogB, e);
      SHARED.uFogDensity.value = lerp(NIGHT.fog, DAWN.fog, e);
      hemi.color.copy(NIGHT.hemiSky).lerp(DAWN.hemiSky, e);
      hemi.groundColor.copy(NIGHT.hemiGround).lerp(DAWN.hemiGround, e);
      hemi.intensity = lerp(NIGHT.hemiI, DAWN.hemiI, e);
      moon.color.copy(NIGHT.sun).lerp(DAWN.sun, e);
      moon.intensity = lerp(NIGHT.sunI, DAWN.sunI, e);
      waterMat.uniforms.uMoonC.value.copy(moon.color).multiplyScalar(moon.intensity);
      waterMat.uniforms.uHemiSky.value.copy(hemi.color).multiplyScalar(hemi.intensity);
    }

    /* ================================================================ *
     * THE RUN
     * ================================================================ */
    function spawnPlayer() {
      const s = (BUILD.anchors.start || [{ x: POI.landing.x, z: POI.landing.z }])[0];
      const g = groundAt(s.x, s.z, 3).g;
      Object.assign(P, { x: s.x, y: g, z: s.z, px: s.x, py: g, pz: s.z, vx: 0, vy: 0, vz: 0, ground: true, coyote: 0, medium: "dry", depth: 0,
        climb: null, vault: null, ladder: null, alive: true, stride: 0, phase: 0, bob: 0, eyeY: g + EYE, shake: 0, deathT: -1, pushT: 0 });
      // Facing up the boardwalk toward the camp's lights.
      P.yaw = P.tYaw = Math.atan2(-(POI.camp.x - P.x), -(POI.camp.z - P.z));
      P.pitch = P.tPitch = -0.06;
    }
    // Turn to face a point by the short way round.
    function faceToward(x, z) {
      let want = Math.atan2(-(x - P.x), -(z - P.z)), d = want - P.tYaw;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      P.tYaw += d;
    }
    let blackA = 0, blackTarget = 0, blackShown = "";
    function killPlayer() {
      if (!P.alive) return;
      P.alive = false;
      P.deathT = 0;
      if (!state.deathCause) state.deathCause = "It heard you.";
      state.aiming = false;
      sfx.death();
      haptic("error");
      P.shake = 1.2;
      // The last thing you see: it, rearing over you.
      if (C.alive && Math.hypot(C.x - P.x, C.z - P.z) < 8) {
        faceToward(C.x, C.z);
        P.tPitch = 0.4;
        beast.open.value = 0.85;
        C.act = { kind: "rise", t: 0, dur: 2.6 };
        after(2.4, () => { beast.open.value = 0; });
      }
      blackTarget = 0.9;
      after(1.9, () => finishRun(false));
      updateHud();
    }
    function startRun() {
      beats.length = 0;
      Object.assign(state, {
        screen: "play", runStart: state.t, coils: 0, parts: 0, rockets: 0, rocketsFound: 0, ducks: DUCKS_START, crackers: 0, boots: false, bazooka: false,
        hits: 0, won: false, submitted: false, deathCause: "", seen: { landing: true }, hints: {}, aiming: false, bellT: -99, genT: -99, notes: 0, towerSeen: false,
        pages: {}, fuel: false, key: false, escaped: false, deaths: 0
      });
      shownChapter = -1;
      toastQ.length = 0; toastT = 0;
      hidePage();
      explored.fill(0);
      for (const d of ducks) scene.remove(d.mesh);
      ducks.length = 0;
      for (const r of rockets) scene.remove(r.mesh);
      rockets.length = 0;
      pBuf.live.length = 0;
      for (const L of BUILD.lamps) L.until = 0;
      Object.assign(weather, { rain: 0, target: 0, next: 140 + Math.random() * 80, bolt: 8, flash: 0, boltT: -99, warned: false });
      resetBoat();
      placeItems();
      spawnPlayer();
      placeBeast(P.x, P.z, 75, 150);
      beast.open.value = 0;
      setDawn(0);
      blackA = 0; blackTarget = 0;
      hideModal();
      updateHud();
      exploreTick();
      chapterCard(0, "Something lives in the water. It cannot see you. It only hears.");
      shownChapter = 0;
      if (track) track.reset();
      sfx.unlock();
      ctx.platform.start({ seed: SEED });
      if (ctx.platform.emit) ctx.platform.emit("run_start", { seed: SEED });
    }
    // Waking at the camp: everything found is kept; the swamp keeps a little score.
    function wakeAtCamp() {
      beats.length = 0;
      const bench = BUILD.interact.find(i => i.kind === "bench");
      state.deaths++;
      Object.assign(state, { screen: "play", submitted: false, deathCause: "", aiming: false });
      resetBoat();
      spawnPlayer();
      const sx = bench.x + 1.5, sz = bench.z + 1.5;
      const g = groundAt(sx, sz, 3).g;
      Object.assign(P, { x: sx, y: g, z: sz, px: sx, py: g, pz: sz, eyeY: g + EYE });
      for (const d of ducks) scene.remove(d.mesh);
      ducks.length = 0;
      placeBeast(P.x, P.z, 90, 160);
      beast.open.value = 0;
      blackA = 0.9; blackTarget = 0;
      hideModal();
      updateHud();
      toast("You wake at the camp", "Soaked, shaking, and missing an hour. It is still out there.", 5);
      ctx.platform.start({ seed: SEED });
    }
    async function finishRun(won) {
      if (state.screen !== "play") return;
      const out = won || state.escaped;
      state.screen = out ? "won" : "dead";
      const score = progressScore();
      // Read the clock once: the submits below wait on the network.
      const ms = Math.round((state.t - state.runStart) * 1000);
      const secs = Math.round(ms / 1000);
      if (score > state.best) state.best = score;
      if (won && (!state.bestTime || secs < state.bestTime)) state.bestTime = secs;
      save();
      showModal(resultHtml(won));
      if (out) sfx.win();
      ctx.platform[out ? "complete" : "fail"]({ score, rank: rankOf(score), seconds: secs, hits: state.hits, ending: won ? "slain" : state.escaped ? "escaped" : "taken" });
      if (!state.submitted) {
        state.submitted = true;
        if (track) {
          track.set(score);
          try { await track.submit("best_progress", { label: `${rankOf(score)} · ${score}` }); } catch (e) { /* never break the card */ }
        }
        if (won && ctx.memory && typeof ctx.memory.record === "function") {
          try { await ctx.memory.record("fastest_slay").submit(ms, { label: fmtTime(secs) }); } catch (e) { /* no matter */ }
        }
        if (ctx.pulse && ctx.pulse.complete) {
          ctx.pulse.complete({ score, result: out ? "won" : "lost", text: won ? `Killed the Listener in ${fmtTime(secs)} in Still Water` : state.escaped ? `Escaped the swamp by boat in ${fmtTime(secs)} in Still Water` : `Reached ${rankOf(score)} in Still Water` });
        }
      }
    }

    /* ---- the title: low over the water, the thing gliding past ---- */
    let menuShot = null;
    function chooseMenuShot() {
      // Low over the water, up the last of the walk to the stilt village's lanterns.
      const V = POI.village;
      const x = V.x - 27, z = V.z + 8, tx = V.x + 4, tz = V.z - 4;
      const L = Math.hypot(tx - x, tz - z), ux = (tx - x) / L, uz = (tz - z) / L;
      const c = nearestNav(V.x - 15, V.z + 5, 20);
      const [fx, fz] = c >= 0 ? centreOfCell(c) : [V.x - 15, V.z + 5];
      menuShot = { x, y: 1.6, z, tx, ty: -2, tz, fx, fz, sx: -uz, sz: ux };
      if (TEST && TEST.menu) Object.assign(menuShot, TEST.menu);
    }
    function placeMenuCamera() {
      const m = menuShot, t = state.t;
      const drift = Math.sin(t * 0.09) * 1.2;
      camera.position.set(m.x + m.sx * drift, m.y + Math.sin(t * 0.21) * 0.05, m.z + m.sz * drift);
      camera.lookAt(m.tx + m.sx * drift * 0.5, m.ty + Math.sin(t * 0.13) * 0.15, m.tz + m.sz * drift * 0.5);
    }
    function gotoMenu() {
      state.screen = "menu";
      if (!menuShot) chooseMenuShot();
      beats.length = 0;
      setDawn(0);
      blackA = 0; blackTarget = 0;
      resetBoat();
      Object.assign(weather, { rain: 0, target: 0, flash: 0, boltT: -99 });
      placeBeast(menuShot.fx, menuShot.fz, 0, 14);
      beast.open.value = 0;
      showModal(menuHtml());
    }

    /* ================================================================ *
     * THE FRAME
     * The world steps at a fixed 60 Hz; the picture is drawn between
     * steps, so it is smooth on any screen.
     * ================================================================ */
    const STEP = 1 / 60;
    let acc = 0, exploreT = 0, useShown = null, fear = 0;
    function simStep(dt) {
      state.t += dt;
      runBeats();
      if (state.screen === "play" || state.screen === "dead") {
        if (escapeRun) stepEscape(dt);
        if (!P.alive) { if (!escapeRun) { P.px = P.x; P.py = P.y; P.pz = P.z; } P.deathT += dt; }
        else if (!escapeRun) stepPlayer(dt, readMove());
      }
      stepBeast(dt);
      stepItems(dt);
      stepDucks(dt);
      stepRockets(dt);
      stepWeather(dt);
      if (state.won) setDawn(Math.min(1, state.dawn + dt / 9));
    }
    function update(dtMs) {
      const dt = clamp(Number.isFinite(dtMs) ? dtMs : 16.7, 0, 100) / 1000;
      frameDt = dt;
      if (state.screen === "play" && P.alive) {
        const sens = 0.0062 * state.look;
        P.tYaw -= input.lookDX * sens;
        P.tPitch = clamp(P.tPitch - input.lookDY * sens * 0.85, -1.3, 1.25);
        if (input.turnL) P.tYaw += 2.4 * dt;
        if (input.turnR) P.tYaw -= 2.4 * dt;
      }
      input.lookDX = 0; input.lookDY = 0;
      // The map and the journal stop the night while you read them.
      const paused = !mapView.hidden || !sheetEl.hidden;
      if (!paused) acc += dt;
      let n = 0;
      while (acc >= STEP && n < 6) { simStep(STEP); acc -= STEP; n++; }
      if (n === 6) acc = 0;
      if (readerT > 0) { readerT -= dt; if (readerT <= 0) hidePage(); }
      stepParticles(dt);
      sfx.update(dt);
      // The overlay.
      stepToasts(dt);
      if (earT > 0) { earT -= dt; if (earT <= 0) earText.classList.remove("on"); }
      const playing = state.screen === "play";
      const hunted = C.alive && (C.state === "hunt" || (C.act && C.act.kind === "lunge"));
      earEl.classList.toggle("l2", playing && hunted);
      earEl.classList.toggle("l1", playing && !hunted && C.alive && (C.state === "investigate" || C.state === "search" || C.state === "lured"));
      if (playing) {
        updateCompass();
        exploreT += dt;
        if (exploreT > 0.4) { exploreT = 0; exploreTick(); if (!mapView.hidden) paintMap(); }
        const near = nearInteract();
        const label = near ? near.label : "";
        if (label !== useShown) { useShown = label; useBtn.hidden = !label; useLabel.textContent = label; }
      }
      blackA += (blackTarget - blackA) * (1 - Math.exp(-dt * 2.4));
      const bs = blackA.toFixed(2);
      if (bs !== blackShown) { blackShown = bs; flashEl.style.opacity = bs; }
      // Lightning and blasts, in the picture.
      const fl = mFinal.uniforms.uFlash.value;
      if (fl.w > 0) fl.w = Math.max(0, fl.w - (fl.fade || 1) * dt);
      const dC = Math.hypot(C.x - P.x, C.z - P.z);
      const fearT = playing && C.alive ? (hunted ? clamp(1.2 - dC / 30, 0.25, 1) : C.state === "lured" || C.state === "search" ? clamp(0.6 - dC / 60, 0, 0.4) : 0) : 0;
      fear += (fearT - fear) * (1 - Math.exp(-dt * 2));
      mFinal.uniforms.uFear.value = fear;
      if (state.screen === "menu") placeMenuCamera();
      else placeCamera(acc / STEP, dt);
      camera.updateMatrixWorld();
      updateArc();
      if (playing) { updateGuide(); if (!paused) checkHints(dt); }
    }

    // First times: each said once a run, when it first matters.
    let gapT = 0, hintGate = 0;
    function gapAhead() {
      if (!P.ground || P.medium !== "dry" || !groundAt(P.x, P.z, P.y).floor) return false;
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
      let water = false;
      for (const r of [1.2, 2.2, 3.2, 4.4]) {
        const g = groundAt(P.x + fx * r, P.z + fz * r, P.y);
        if (!g.floor && g.g < WATER_Y - 0.15) water = true;
        else if (water && g.floor) return true;
      }
      return false;
    }
    function checkHints(dt) {
      if (!P.alive) return;
      hintGate += dt;
      if (hintGate < 0.25) return;
      hintGate = 0;
      const dC = Math.hypot(C.x - P.x, C.z - P.z), since = state.t - state.runStart;
      if (P.ground && !P.vault && P.medium !== "dry") hint("water", "In the water", "Every step here carries to it. Push the stick only a little to wade slowly, or get back on land.");
      if (C.alive && C.state === "investigate") hint("heard", "It heard something", "Stand still. It only knows roughly where the sound was.");
      if (C.alive && C.state === "hunt") hint("hunt", "It is coming", "Out of the water: land, or somewhere high. Now.");
      if (C.alive && C.state !== "hunt" && dC < 18 && since > 25) hint("near", "The frogs have stopped", "It is close. If you are in the water, do not move.");
      if (state.boots) hint("boots", "Spring boots", "The gaps in the boardwalks are nothing now. Landing still thuds.");
      if (state.bazooka) hint("bazooka", "Loaded", "From somewhere dry, throw a duck into deep water. When its head comes up, fire.", 7);
      if (since > 50) hint("stones", "Stones", "Hold STONE and let go to throw. A plop somewhere else draws it away from you.");
      if (!state.hints.gap && gapAhead()) hint("gap", "The planks are gone", state.boots ? "Run at it and jump." : "Spring boots would clear this. Without them, it is a swim.");
    }

    let frameDt = 1 / 60;
    function render() {
      if (TEST && TEST.noRender) return;
      SHARED.uTime.value = state.t + acc;
      updateLamps(frameDt);
      updateShadow();
      // Small things past their distance are not drawn at all.
      const cp = camera.position;
      for (const c of cullables) {
        const s = c.mesh.boundingSphere;
        c.mesh.visible = !s || s.center.distanceTo(cp) - s.radius < c.far;
      }
      hemi.intensity = lerp(NIGHT.hemiI, DAWN.hemiI, state.dawn * state.dawn * (3 - 2 * state.dawn)) + weather.flash * 2.2;
      mFinal.uniforms.uExposure.value = LOOK.exposure * (1 + weather.flash * 0.25);
      const sc = flyMat.uniforms.uScale.value;
      pMat.uniforms.uScale.value = sc; arc.mat.uniforms.uScale.value = sc; rain.mat.uniforms.uScale.value = sc; mothMat.uniforms.uScale.value = sc; fungusMat.uniforms.uScale.value = sc;
      mistMat.uniforms.uRain.value = weather.rain;
      // Resolution follows the frame rate: give pixels back if the phone
      // cannot keep up, and take them back once it can.
      const now = performance.now();
      if (gfx.last && !(TEST && TEST.fixedRes)) {
        const d = clamp(now - gfx.last, 4, 100);
        gfx.ema += (d - gfx.ema) * 0.05;
        if (gfx.ema > 24) { gfx.slow += d; gfx.fast = 0; } else if (gfx.ema < 17.5) { gfx.fast += d; gfx.slow = 0; } else { gfx.slow = gfx.fast = 0; }
        const top = Math.min(ctx.dpr || 1, 1.5);
        if (gfx.slow > 1500) {
          if (gfx.dpr > gfx.min) { gfx.dpr = Math.max(gfx.min, gfx.dpr - 0.15); resize(); } else gfx.reflEvery = 2;
          gfx.slow = 0; gfx.ema = 16.7;
        }
        if (gfx.fast > 8000) {
          if (gfx.reflEvery > 1) gfx.reflEvery = 1;
          else if (gfx.dpr < top) { gfx.dpr = Math.min(top, gfx.dpr + 0.15); resize(); }
          gfx.fast = 0;
        }
      }
      gfx.last = now;
      drawFrame();
    }

    /* ================================================================ *
     * BOOT
     * ================================================================ */
    // Fonts are a nicety: a refusal leaves the system faces in place.
    if (typeof ctx.loadFont === "function") {
      ctx.loadFont("Cormorant Garamond", "cormorant-garamond", "1.0.0", { weight: "300", style: "italic" }).catch(() => {});
      ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }).catch(() => {});
      ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" }).catch(() => {});
    }
    await loadSaved();
    gfx.dpr = Math.min(ctx.dpr || 1, 1.25);
    buildWorld();
    placeItems();
    spawnPlayer();
    chooseMenuShot();
    resize();
    ctx.listen(window, "resize", resize);
    if (TEST) {
      TEST.api = {
        THREE, scene, camera, renderer, P, C, state, items, ducks, rockets, BUILD, POI, beast, world, input, stick, weather, gfx, LOOK, cullables,
        get trees() { return trees; }, get plants() { return plants; }, get cover() { return cover; }, get menuShot() { return menuShot; },
        startRun, finishRun, gotoMenu, killPlayer, jump, throwLure, throwStone, fire, useThing, take, stepPlayer, update, render, resize, updateHud, openMap, paintMap,
        wakeAtCamp, objective, openJournal, closeJournal, showPage, hidePage, PAGES, startEscape, get escapeRun() { return escapeRun; },
        heightAt: (x, z) => heightAt(swamp, x, z), groundAt, mediumAt, navOk, NN, NAV, swimmable, nearestNav, centreOfCell, beastHear, placeBeast, setMind, goTo,
        hurtBeast, explode, setDawn, spawnPlayer, faceToward, explored, ladderNear, nearInteract, exploreTick, drawFrame
      };
    }
    gotoMenu();
    update(16);
    render();
    ctx.markVisualReady("menu");
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update, render, resetOnResume: true });
    else ctx.onFrame(dt => { update(dt); render(); });
    ctx.platform.ready({ title: "Still Water" });
  }
};
