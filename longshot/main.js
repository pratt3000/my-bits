/*
 * Longshot — a first-person marksman hunt across three open 3D reserves.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule). Packaged assets are
 * disabled (maxAssets: 0), so there is no model, texture or sound file anywhere
 * in this bit: the terrain, every plant, every animal, the sky and every sound
 * are built in code at boot.
 *
 * Built to the discipline in thrixel/build-world's three.js kit — one owner per
 * subsystem talking over an event bus, a seeded RNG with nothing on
 * Math.random, animation off the engine clock only, no per-frame allocation,
 * a capped pixel ratio, a constant visible light count, and everything it
 * creates disposed on teardown.
 */

window.plethoraBit = {
  meta: {
    title: "Longshot",
    runtime: "plethora-bit@2",
    tags: [
      "3d", "game", "shooter", "sniper", "fps",
      "safari", "wildlife", "exploration", "leaderboard", "mobile"
    ],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    /* ================================================================ *
     * 0. CONTRACT
     *
     * Subsystems below own disjoint state and never reach into each
     * other's internals; they talk through `bus` with this vocabulary:
     *
     *   weapon:fire     { rifle, origin, dir }
     *   bullet:impact   { x, y, z, nx, ny, nz, surface }
     *   target:hit      { species, zone, distance, points, x, y, z }
     *   target:flee     { species }
     *   run:start       { map }
     *   run:end         { score, hits, shots }
     *
     * Hard rules for every subsystem in this file:
     *   - no Math.random; all randomness through rng()
     *   - no wall-clock reads; all animation off `clock.t`
     *   - no allocation inside a per-frame path; use the scratch vectors
     *   - dispose every geometry, material and texture it creates
     * ================================================================ */

    /* ---------------------------------------------------------------- *
     * Math and deterministic noise.
     * ---------------------------------------------------------------- */
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (t) => t * t * (3 - 2 * t);
    const TAU = Math.PI * 2;
    const DEG = Math.PI / 180;

    // xoshiro128** — same family build-world's lib/rng.js uses, so a run is
    // reproducible and a capture can be compared against another capture.
    function makeRng(seed) {
      let a = seed >>> 0 || 1, b = 0x9e3779b9, c = 0x243f6a88, d = 0xb7e15162;
      return function rng() {
        const t = b << 9;
        let r = b * 5;
        r = ((r << 7) | (r >>> 25)) * 9;
        c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
        d = (d << 11) | (d >>> 21);
        return (r >>> 0) / 4294967296;
      };
    }

    // Value noise + fbm, for terrain height and every scatter decision.
    function makeNoise(rng) {
      const perm = new Uint8Array(512);
      const src = new Uint8Array(256);
      for (let i = 0; i < 256; i++) src[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = src[i]; src[i] = src[j]; src[j] = t;
      }
      for (let i = 0; i < 512; i++) perm[i] = src[i & 255];
      function grad(ix, iz) { return (perm[(ix + perm[iz & 255]) & 255] / 255) * 2 - 1; }
      function noise2(x, z) {
        const ix = Math.floor(x), iz = Math.floor(z);
        const fx = x - ix, fz = z - iz;
        const u = smoothstep(fx), v = smoothstep(fz);
        const a = grad(ix, iz), b = grad(ix + 1, iz);
        const c = grad(ix, iz + 1), d = grad(ix + 1, iz + 1);
        return lerp(lerp(a, b, u), lerp(c, d, u), v);
      }
      function fbm(x, z, octaves, lac, gain) {
        let sum = 0, amp = 1, freq = 1, norm = 0;
        for (let i = 0; i < octaves; i++) {
          sum += noise2(x * freq, z * freq) * amp;
          norm += amp;
          amp *= gain; freq *= lac;
        }
        return sum / norm;
      }
      return { noise2, fbm };
    }

    /* ---------------------------------------------------------------- *
     * Event bus. Deliberately tiny: subsystems publish facts, they do not
     * call each other.
     * ---------------------------------------------------------------- */
    function makeBus() {
      const map = new Map();
      return {
        on(name, fn) {
          if (!map.has(name)) map.set(name, []);
          map.get(name).push(fn);
        },
        emit(name, payload) {
          const list = map.get(name);
          if (!list) return;
          for (let i = 0; i < list.length; i++) list[i](payload);
        },
        clear() { map.clear(); }
      };
    }
    const bus = makeBus();

    /* ---------------------------------------------------------------- *
     * Quality budgets. Phones get the low preset: build-world measured a
     * phone asking its GPU for ~3.5x a laptop's pixels purely because
     * devicePixelRatio reports 3, so maxPixelRatio is a budget, not a
     * suggestion, and every scatter count is one too.
     * ---------------------------------------------------------------- */
    const coarsePointer = (() => {
      try { return window.matchMedia && window.matchMedia("(pointer: coarse)").matches; }
      catch (err) { return false; }
    })();

    const PRESETS = {
      low: {
        maxPixelRatio: 1.6, renderScale: 0.85, terrainSeg: 128, viewDistance: 620,
        grass: 3200, bush: 440, tree: 210, rock: 230, cloud: 26, mountainSeg: 40,
        maxTargets: 18, fxParticles: 90, groundShadows: true
      },
      mid: {
        maxPixelRatio: 2, renderScale: 1, terrainSeg: 168, viewDistance: 760,
        grass: 5200, bush: 620, tree: 300, rock: 320, cloud: 34, mountainSeg: 56,
        maxTargets: 24, fxParticles: 140, groundShadows: true
      },
      high: {
        maxPixelRatio: 2, renderScale: 1, terrainSeg: 208, viewDistance: 900,
        grass: 7000, bush: 780, tree: 380, rock: 400, cloud: 44, mountainSeg: 72,
        maxTargets: 30, fxParticles: 200, groundShadows: true
      }
    };
    let qname = coarsePointer ? "low" : "mid";
    let q = PRESETS[qname];

    /* ---------------------------------------------------------------- *
     * Engine clock. Everything visual reads clock.t / clock.dt; nothing
     * reads performance.now(). That is what keeps two captures of the
     * same frame identical.
     * ---------------------------------------------------------------- */
    const clock = { t: 0, dt: 0, frame: 0 };

    // Scratch vectors, allocated once. A `new THREE.Vector3()` inside a
    // per-frame path is a bug in this file.
    let S = null;

    /* ================================================================ *
     * 1. THE RESERVES
     * Three maps, differing in palette, terrain shape, cover density and
     * which animals live there. Everything downstream reads this table.
     * ================================================================ */
    const MAPS = [
      {
        id: "savanna",
        name: "Amber Savanna",
        blurb: "Dawn on the flats. Long sightlines, thin cover.",
        sun: { az: 118, el: 26, color: 0xffdcaa, intensity: 3.3 },
        sky: { zenith: 0x2f6ea8, mid: 0x8fb8d8, horizon: 0xf6c88a, haze: 0xe8bd8c },
        ground: { grass: 0xb59a52, dry: 0xd8bd76, dirt: 0x8f7040, rock: 0x8a8378 },
        foliage: { leafA: 0x6f7f3e, leafB: 0x94a052, bark: 0x584634, scrub: 0x8d8a4b },
        fogDensity: 0.0016,
        relief: { amp: 22, freq: 0.0031, ridge: 0.35, flat: 0.55 },
        water: null,
        species: ["warthog", "zebra", "gazelle", "ostrich", "leopard", "cheetah"],
        density: 1
      },
      {
        id: "delta",
        name: "Green Delta",
        blurb: "Midday wetland. Thick cover, animals gather at water.",
        sun: { az: 62, el: 55, color: 0xfff4dc, intensity: 3.4 },
        sky: { zenith: 0x2a6fc4, mid: 0x7fb0e2, horizon: 0xcfe4f2, haze: 0xbcd8e8 },
        ground: { grass: 0x5d8a3c, dry: 0x8fa74c, dirt: 0x6b5838, rock: 0x7d8378 },
        foliage: { leafA: 0x3f6f2e, leafB: 0x5c8f3c, bark: 0x4a3d2c, scrub: 0x4f7734 },
        fogDensity: 0.0011,
        relief: { amp: 12, freq: 0.0042, ridge: 0.2, flat: 0.72 },
        water: { level: -1.6, color: 0x2b6b78, deep: 0x123c48 },
        species: ["warthog", "zebra", "gazelle", "buffalo", "leopard", "cheetah"],
        density: 1.35
      },
      {
        id: "highlands",
        name: "Cold Highlands",
        blurb: "Dusk in the hills. Steep ground, long range, low light.",
        sun: { az: 250, el: 19, color: 0xd9b8f0, intensity: 2.6 },
        sky: { zenith: 0x1b2a52, mid: 0x4a5b8c, horizon: 0xc98fa0, haze: 0x8f8ab0 },
        ground: { grass: 0x5d6a55, dry: 0x7a7a62, dirt: 0x54503f, rock: 0x77787c },
        foliage: { leafA: 0x3c5142, leafB: 0x4f6650, bark: 0x3d3630, scrub: 0x55604c },
        fogDensity: 0.0024,
        relief: { amp: 46, freq: 0.0026, ridge: 0.62, flat: 0.34 },
        water: null,
        species: ["warthog", "ibex", "gazelle", "ostrich", "leopard", "cheetah"],
        density: 0.85
      }
    ];

    /* ---------------------------------------------------------------- *
     * The quarry. `value` is the base score, and the rest is why a
     * cheetah is worth sixteen warthogs: small, fast, skittish, and it
     * spends most of its time behind something.
     * ---------------------------------------------------------------- */
    const SPECIES = {
      warthog: {
        name: "Warthog", value: 25, tier: "low",
        body: 0x6b5344, belly: 0x4c3a2f, mark: 0x2f2620,
        size: 0.95, height: 0.72, len: 1.5, speed: 3.2, sprint: 7.5,
        wary: 0.55, herd: [1, 3], cover: 0.25, hp: 1
      },
      zebra: {
        name: "Zebra", value: 50, tier: "low",
        body: 0xe8e4dc, belly: 0xf2efe8, mark: 0x231f1c,
        size: 1.25, height: 1.35, len: 2.2, speed: 4.2, sprint: 12,
        wary: 0.8, herd: [3, 6], cover: 0.15, hp: 1
      },
      buffalo: {
        name: "Buffalo", value: 60, tier: "low",
        body: 0x3c342e, belly: 0x2a241f, mark: 0x151210,
        size: 1.5, height: 1.6, len: 2.7, speed: 3, sprint: 9,
        wary: 0.5, herd: [2, 5], cover: 0.1, hp: 2
      },
      ibex: {
        name: "Ibex", value: 90, tier: "mid",
        body: 0x9c8460, belly: 0xc8b48c, mark: 0x3a2f22,
        size: 0.9, height: 1.05, len: 1.5, speed: 4.5, sprint: 11,
        wary: 1.15, herd: [1, 3], cover: 0.45, hp: 1
      },
      gazelle: {
        name: "Gazelle", value: 120, tier: "mid",
        body: 0xc79a5c, belly: 0xf0e4d0, mark: 0x2e241a,
        size: 0.8, height: 1.0, len: 1.4, speed: 5.5, sprint: 16,
        wary: 1.35, herd: [2, 5], cover: 0.3, hp: 1
      },
      ostrich: {
        name: "Ostrich", value: 150, tier: "mid",
        body: 0x2c2a28, belly: 0xd8d2c4, mark: 0xd8817a,
        size: 0.85, height: 1.85, len: 1.2, speed: 5, sprint: 19,
        wary: 1.5, herd: [1, 2], cover: 0.2, hp: 1
      },
      leopard: {
        name: "Leopard", value: 400, tier: "high",
        body: 0xd8b264, belly: 0xf0e2c0, mark: 0x2a2018,
        size: 0.72, height: 0.78, len: 1.9, speed: 3.4, sprint: 14,
        wary: 1.9, herd: [1, 1], cover: 0.92, hp: 1
      },
      cheetah: {
        name: "Cheetah", value: 800, tier: "high",
        body: 0xd8bc78, belly: 0xf2e8cc, mark: 0x2b2118,
        size: 0.68, height: 0.92, len: 2.0, speed: 4, sprint: 27,
        wary: 2.2, herd: [1, 1], cover: 0.6, hp: 1
      }
    };

    /* ---------------------------------------------------------------- *
     * The rifles. Every number is a trade: the .50 sees furthest and
     * hits hardest, and it sways like a gate in the wind and takes two
     * seconds to cycle.
     * ---------------------------------------------------------------- */
    const RIFLES = [
      {
        id: "ranger", name: "Ranger .308", short: "RNG",
        zoom: 6, muzzle: 810, cycle: 0.95, mag: 5, reload: 2.4,
        sway: 0.62, steady: 1.25, spread: 0.0009, unlockAt: 0,
        note: "Light bolt gun. Quick to settle, quick to cycle."
      },
      {
        id: "marksman", name: "Vector Semi", short: "VEC",
        zoom: 4, muzzle: 760, cycle: 0.28, mag: 10, reload: 2.1,
        sway: 0.78, steady: 1.0, spread: 0.0021, unlockAt: 0,
        note: "Semi-auto. Fast follow-ups, loose groups."
      },
      {
        id: "longbow", name: "Longbow .338", short: "LNG",
        zoom: 12, muzzle: 900, cycle: 1.45, mag: 5, reload: 3,
        sway: 0.95, steady: 0.85, spread: 0.0005, unlockAt: 2500,
        note: "Flat and far. Punishing between shots."
      },
      {
        id: "anvil", name: "Anvil .50", short: "ANV",
        zoom: 20, muzzle: 860, cycle: 2.1, mag: 3, reload: 3.8,
        sway: 1.45, steady: 0.6, spread: 0.0004, unlockAt: 9000,
        note: "Anti-materiel. Enormous reach, enormous wobble."
      }
    ];

    const ZERO_RANGE = 200;      // rifles are zeroed here; past it you hold over
    const GRAVITY = 9.81;
    const RUN_SECONDS = 300;

    /* ================================================================ *
     * 2. RENDER
     * Owns the renderer, the two cameras and the light rig, and nothing
     * else. The light count is fixed for the life of the bit: three bakes
     * the number of visible lights into every program it compiles, so a
     * light appearing mid-game recompiles the world and drops a frame on
     * the floor.
     * ================================================================ */
    const canvas = ctx.createCanvas({ touchAction: "none" });

    let THREE = null;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (err) {
      showFatal("This bit needs WebGL and the three.js runtime, which did not load.");
      return;
    }
    if (THREE && THREE.default && !THREE.Scene) THREE = THREE.default;

    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: qname !== "low", alpha: false, powerPreference: "high-performance" });
    } catch (err) {
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
      } catch (err2) {
        showFatal("This device could not open a WebGL context.");
        return;
      }
    }

    function showFatal(msg) {
      const root = ctx.createRoot();
      root.style.cssText = "display:flex;align-items:center;justify-content:center;padding:24px;"
        + "background:#0d1117;color:#c9d5e4;font:14px/1.5 system-ui,-apple-system,sans-serif;text-align:center";
      root.textContent = msg;
      try { ctx.markVisualReady("fatal"); ctx.platform.ready(); } catch (e) { /* host gone */ }
    }

    // Budget, not preference. A phone reports devicePixelRatio 3.
    function applyPixelRatio() {
      const dpr = Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, q.maxPixelRatio);
      renderer.setPixelRatio(dpr * q.renderScale);
    }
    applyPixelRatio();
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = false;   // ground decals do the grounding instead
    renderer.autoClear = true;

    const scene = new THREE.Scene();
    // The viewmodel lives in its own scene so the rifle can never clip
    // into a rock, and so its near plane can be centimetres.
    const overlayScene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(62, ctx.width / Math.max(1, ctx.height), 0.25, 4000);
    const overlayCamera = new THREE.PerspectiveCamera(52, camera.aspect, 0.01, 12);
    // The camera must be in the scene graph for its children to be rendered.
    overlayScene.add(overlayCamera);

    S = {
      v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
      v4: new THREE.Vector3(), v5: new THREE.Vector3(),
      q1: new THREE.Quaternion(), q2: new THREE.Quaternion(),
      m1: new THREE.Matrix4(), m2: new THREE.Matrix4(),
      e1: new THREE.Euler(), c1: new THREE.Color(), c2: new THREE.Color(),
      up: new THREE.Vector3(0, 1, 0)
    };

    // Fixed light rig: one sun, one sky/ground bounce, one warm rim. Never
    // added to or removed from, only recoloured per map.
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404030, 1.35);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    scene.add(sun, hemi, rim);
    const overlaySun = new THREE.DirectionalLight(0xffffff, 2.2);
    const overlayHemi = new THREE.HemisphereLight(0xffffff, 0x30302c, 1.0);
    overlayScene.add(overlaySun, overlayHemi);

    // Everything the bit allocates on the GPU is tracked here and freed
    // on teardown; three frees none of it for you.
    const owned = { geometries: [], materials: [], textures: [] };
    function own(obj) {
      if (!obj) return obj;
      if (obj.isBufferGeometry) owned.geometries.push(obj);
      else if (obj.isMaterial) owned.materials.push(obj);
      else if (obj.isTexture) owned.textures.push(obj);
      return obj;
    }
    ctx.onDestroy(() => {
      for (const g of owned.geometries) { try { g.dispose(); } catch (e) { /* gone */ } }
      for (const m of owned.materials) { try { m.dispose(); } catch (e) { /* gone */ } }
      for (const t of owned.textures) { try { t.dispose(); } catch (e) { /* gone */ } }
      try { renderer.dispose(); } catch (e) { /* gone */ }
    });

    /* ================================================================ *
     * 3. WORLD
     * Terrain, sky, water, and every plant and rock on it. The height
     * field is one function shared by the mesh builder, the scatterer,
     * the player's feet and the bullets, so nothing can disagree about
     * where the ground is.
     * ================================================================ */
    const WORLD = 1000;          // metres across
    const PLAY_RADIUS = 330;     // the player is fenced well inside the fog

    const worldGroup = new THREE.Group();
    scene.add(worldGroup);

    let map = MAPS[0];
    let rng = makeRng(1);
    let noise = makeNoise(rng);
    let terrainMesh = null;
    let waterMesh = null;
    let skyMesh = null;
    let mountainMesh = null;
    let cloudMesh = null;

    // Height field. Cheap enough to call per bullet step.
    function heightAt(x, z) {
      const R = map.relief;
      const base = noise.fbm(x * R.freq, z * R.freq, 5, 2.07, 0.5);
      const ridge = 1 - Math.abs(noise.fbm(x * R.freq * 2.3 + 91, z * R.freq * 2.3 - 47, 3, 2.2, 0.55));
      let h = base * R.amp + (ridge - 0.5) * R.amp * R.ridge;
      // A shallow basin at the centre: somewhere to stand that can see out.
      const d = Math.sqrt(x * x + z * z);
      const bowl = smoothstep(clamp(d / (PLAY_RADIUS * 1.6), 0, 1));
      h = lerp(h * R.flat - 3.5, h, bowl);
      // Lift the far ring so the horizon is land, not a cut edge.
      const far = smoothstep(clamp((d - PLAY_RADIUS * 1.3) / (WORLD * 0.42), 0, 1));
      h += far * R.amp * 2.4;
      return h;
    }

    function normalAt(x, z, out) {
      const e = 1.6;
      const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
      const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
      out.set(hL - hR, 2 * e, hD - hU).normalize();
      return out;
    }

    function slopeAt(x, z) {
      normalAt(x, z, S.v5);
      return 1 - clamp(S.v5.y, 0, 1);
    }

    /* ---------------------------------------------------------------- *
     * Terrain mesh. Tessellated, not two triangles: a large flat
     * receiver cannot take a light gradient, which is what makes cheap
     * ground look like paper. Colour is per-vertex, so there is no
     * texture to package.
     * ---------------------------------------------------------------- */
    function buildTerrain() {
      const seg = q.terrainSeg;
      const geo = own(new THREE.PlaneGeometry(WORLD, WORLD, seg, seg));
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const cGrass = new THREE.Color(map.ground.grass);
      const cDry = new THREE.Color(map.ground.dry);
      const cDirt = new THREE.Color(map.ground.dirt);
      const cRock = new THREE.Color(map.ground.rock);
      const col = S.c1;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = heightAt(x, z);
        pos.setY(i, h);
        // Patchiness first, then slope, then altitude — in that order the
        // rock reads as exposed stone rather than a colour ramp.
        const damp = clamp(1 - (h + 8) / (map.relief.amp * 2.4), 0, 1);
        const patch = noise.fbm(x * 0.014, z * 0.014, 4, 2.1, 0.55) * 0.5 + 0.5;
        col.copy(cDry).lerp(cGrass, clamp(damp * 0.85 + patch * 0.5 - 0.18, 0, 1));
        const bare = noise.fbm(x * 0.031 + 210, z * 0.031 - 88, 3, 2.2, 0.5) * 0.5 + 0.5;
        col.lerp(cDirt, clamp((bare - 0.62) * 2.6, 0, 1) * 0.7);
        const mottle = noise.fbm(x * 0.0055, z * 0.0055, 2, 2.1, 0.5);
        col.multiplyScalar(1 + mottle * 0.16);
        const s = slopeAt(x, z);
        if (s > 0.22) col.lerp(cDirt, clamp((s - 0.22) / 0.3, 0, 1));
        if (s > 0.46) col.lerp(cRock, clamp((s - 0.46) / 0.34, 0, 1));
        const alt = clamp((h + 8) / (map.relief.amp * 2.2), 0, 1);
        col.lerp(cRock, clamp((alt - 0.72) * 2.2, 0, 1) * 0.55);
        // A little value noise so flat ground is never one solid colour.
        const g = 0.90 + noise.noise2(x * 0.09, z * 0.09) * 0.14;
        colors[i * 3] = col.r * g;
        colors[i * 3 + 1] = col.g * g;
        colors[i * 3 + 2] = col.b * g;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mat = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
      terrainMesh = new THREE.Mesh(geo, mat);
      terrainMesh.matrixAutoUpdate = false;
      terrainMesh.updateMatrix();
      worldGroup.add(terrainMesh);
    }

    /* ---------------------------------------------------------------- *
     * Sky. A vertex-coloured dome rather than a shader: one fewer
     * program to compile, and the gradient is authored per map.
     * ---------------------------------------------------------------- */
    function buildSky() {
      const geo = own(new THREE.SphereGeometry(1800, 32, 20));
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const cz = new THREE.Color(map.sky.zenith);
      const cm = new THREE.Color(map.sky.mid);
      const ch = new THREE.Color(map.sky.horizon);
      const col = S.c1;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 1800;               // -1 .. 1
        const t = clamp((y + 0.12) / 1.12, 0, 1);
        if (t < 0.42) col.copy(ch).lerp(cm, smoothstep(t / 0.42));
        else col.copy(cm).lerp(cz, smoothstep((t - 0.42) / 0.58));
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      skyMesh = new THREE.Mesh(geo, mat);
      skyMesh.frustumCulled = false;
      scene.add(skyMesh);
    }

    /* ---------------------------------------------------------------- *
     * The sun disc, the far mountains and the cloud deck. All three are
     * unlit and fog-exempt or fog-soaked on purpose: together they are
     * what gives a 1 km view something to be 1 km away from.
     * ---------------------------------------------------------------- */
    let sunDisc = null, sunGlow = null;
    const sunDir = new THREE.Vector3();

    function sunDirection(out) {
      const az = map.sun.az * DEG, el = map.sun.el * DEG;
      out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
      return out;
    }

    function buildSun() {
      const g1 = own(new THREE.SphereGeometry(26, 16, 12));
      const m1 = own(new THREE.MeshBasicMaterial({ color: 0xfffdf0, fog: false, depthWrite: false }));
      sunDisc = new THREE.Mesh(g1, m1);
      const g2 = own(new THREE.SphereGeometry(96, 16, 12));
      const m2 = own(new THREE.MeshBasicMaterial({
        color: map.sun.color, fog: false, transparent: true,
        opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      sunGlow = new THREE.Mesh(g2, m2);
      sunDisc.frustumCulled = false;
      sunGlow.frustumCulled = false;
      scene.add(sunDisc, sunGlow);
    }

    function buildMountains() {
      // A continuous ridgeline, not a ring of cones: peaks share shoulders,
      // which is the whole difference between a mountain range and traffic
      // furniture. Two layers, the near one occluding the far one, because
      // that overlap is what reads as depth.
      const SEG = 220;
      const cRock = new THREE.Color(map.ground.rock).lerp(new THREE.Color(0x5d6472), 0.55);
      const cFar = new THREE.Color(map.sky.mid).lerp(new THREE.Color(map.sky.haze), 0.5);
      const tint = new THREE.Color();
      const verts = [], cols = [];
      for (let layer = 0; layer < 2; layer++) {
        const radius = layer === 0 ? WORLD * 0.86 : WORLD * 0.78;
        const hazeMix = layer === 0 ? 0.62 : 0.36;
        const scale = layer === 0 ? 1 : 0.7;
        const phase = layer * 3.7 + game.mapIndex * 1.9;
        const ridge = new Float32Array(SEG + 1);
        for (let i = 0; i <= SEG; i++) {
          const a = (i / SEG) * TAU;
          // Three incommensurate sines: a skyline that never visibly repeats,
          // and no noise lookup per vertex.
          // Abs() on the higher terms turns rolling swells into ridges with
          // real crests, which is what separates a mountain from a dune.
          const h = 0.42 + 0.26 * Math.sin(a * 3 + phase)
                         + 0.30 * Math.abs(Math.sin(a * 6.3 + phase * 2.1))
                         + 0.20 * Math.abs(Math.sin(a * 11.7 + phase * 0.6))
                         + 0.10 * Math.abs(Math.sin(a * 21.1 + phase * 3.3));
          ridge[i] = Math.max(26, h * (map.relief.amp * 7 + 120) * scale);
        }
        ridge[SEG] = ridge[0];
        for (let i = 0; i < SEG; i++) {
          const a0 = (i / SEG) * TAU, a1 = ((i + 1) / SEG) * TAU;
          const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
          const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
          verts.push(x0, -50, z0, x1, -50, z1, x1, ridge[i + 1], z1);
          verts.push(x0, -50, z0, x1, ridge[i + 1], z1, x0, ridge[i], z0);
          for (let k = 0; k < 6; k++) {
            const isTop = (k === 2 || k === 4 || k === 5);
            tint.copy(cRock).lerp(cFar, isTop ? Math.min(0.95, hazeMix + 0.09) : hazeMix);
            cols.push(tint.r, tint.g, tint.b);
          }
        }
      }
      const geo = own(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      const mat = own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide }));
      mountainMesh = new THREE.Mesh(geo, mat);
      mountainMesh.frustumCulled = false;
      worldGroup.add(mountainMesh);
    }

    function buildClouds() {
      const geo = own(new THREE.IcosahedronGeometry(1, 1));
      geo.scale(1, 0.42, 1);
      const mat = own(new THREE.MeshBasicMaterial({
        color: 0xffffff, fog: false, transparent: true, opacity: 0.72, depthWrite: false
      }));
      cloudMesh = new THREE.InstancedMesh(geo, mat, q.cloud * 4);
      cloudMesh.frustumCulled = false;
      cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const m = S.m1, cCloud = S.c1, tint = new THREE.Color(map.sky.horizon);
      let n = 0;
      for (let i = 0; i < q.cloud; i++) {
        const a = rng() * TAU;
        const r = 260 + rng() * 900;
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        const cy = 190 + rng() * 130;
        const puffs = 3 + Math.floor(rng() * 2);
        const scale = 26 + rng() * 46;
        for (let p = 0; p < puffs && n < cloudMesh.count; p++) {
          m.makeScale(scale * (0.6 + rng() * 0.7), scale * (0.5 + rng() * 0.5), scale * (0.6 + rng() * 0.7));
          m.setPosition(cx + (rng() - 0.5) * scale * 2.4, cy + (rng() - 0.5) * scale * 0.5, cz + (rng() - 0.5) * scale * 2.4);
          cloudMesh.setMatrixAt(n, m);
          cCloud.setRGB(1, 1, 1).lerp(tint, rng() * 0.45);
          cloudMesh.setColorAt(n, cCloud);
          n++;
        }
      }
      // Any unused slot is scaled to nothing rather than left at the origin.
      for (; n < cloudMesh.count; n++) { m.makeScale(0, 0, 0); cloudMesh.setMatrixAt(n, m); }
      cloudMesh.instanceMatrix.needsUpdate = true;
      if (cloudMesh.instanceColor) cloudMesh.instanceColor.needsUpdate = true;
      scene.add(cloudMesh);
    }

    function buildWater() {
      if (!map.water) return;
      const geo = own(new THREE.PlaneGeometry(WORLD * 0.9, WORLD * 0.9, 48, 48));
      geo.rotateX(-Math.PI / 2);
      // A static ripple, baked in. Animating it per frame would cost a
      // vertex upload every frame for something nobody looks at twice.
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, noise.fbm(x * 0.06, z * 0.06, 2, 2.2, 0.5) * 0.16);
      }
      geo.computeVertexNormals();
      const mat = own(new THREE.MeshStandardMaterial({
        color: map.water.color, roughness: 0.16, metalness: 0.05,
        transparent: true, opacity: 0.86
      }));
      waterMesh = new THREE.Mesh(geo, mat);
      waterMesh.position.y = map.water.level;
      waterMesh.matrixAutoUpdate = false;
      waterMesh.updateMatrix();
      worldGroup.add(waterMesh);
    }

    /* ---------------------------------------------------------------- *
     * Scatter. Every prop is an InstancedMesh with frustumCulled off —
     * three culls an instanced mesh against its geometry's bounding
     * sphere at the mesh origin, so a field of grass vanishes the moment
     * the origin leaves the frustum.
     *
     * `covers` is the list the concealment query reads: standing inside
     * one is what stops a cheetah noticing you.
     * ---------------------------------------------------------------- */
    const covers = [];            // { x, z, r, strength }
    const blockers = [];          // { x, y, z, r } — trees and rocks stop bullets
    const props = [];             // InstancedMeshes, for teardown

    function groundIsPlaceable(x, z) {
      const h = heightAt(x, z);
      if (map.water && h < map.water.level + 0.4) return false;
      return slopeAt(x, z) < 0.42;
    }

    function tuftGeometry() {
      // Five tapered blades fanning from a point: no texture, no alpha
      // test, five triangles.
      const v = [], c = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.4;
        const lean = 0.22 + (i % 3) * 0.09;
        const h = 0.75 + (i % 2) * 0.35;
        const w = 0.07;
        const dx = Math.cos(a), dz = Math.sin(a);
        v.push(-dz * w, 0, dx * w);
        v.push(dz * w, 0, -dx * w);
        v.push(dx * lean, h, dz * lean);
        c.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1, 1, 1);
      }
      const g = own(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
      g.computeVertexNormals();
      return g;
    }

    function blobGeometry(detail, squash, seed) {
      const g = own(new THREE.IcosahedronGeometry(1, detail));
      const pos = g.attributes.position;
      const r = makeRng(seed);
      for (let i = 0; i < pos.count; i++) {
        const k = 0.74 + r() * 0.5;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * squash, pos.getZ(i) * k);
      }
      g.computeVertexNormals();
      return g;
    }

    function makeInstanced(geo, mat, count) {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      mesh.frustumCulled = false;
      mesh.count = 0;
      props.push(mesh);
      worldGroup.add(mesh);
      return mesh;
    }

    // Ground decals: a soft dark disc under everything that stands up.
    // Cheaper than a shadow map by an order of magnitude, and it cannot
    // acne, crawl or peter.
    let staticShade = null;
    function shadeGeometry() {
      const g = own(new THREE.CircleGeometry(1, 12));
      g.rotateX(-Math.PI / 2);
      return g;
    }
    function shadeMaterial() {
      return own(new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, fog: true
      }));
    }

    function placeShade(mesh, idx, x, z, radius, lift) {
      const y = heightAt(x, z) + (lift === undefined ? 0.06 : lift);
      normalAt(x, z, S.v1);
      S.q1.setFromUnitVectors(S.up, S.v1);
      S.v2.set(radius, 1, radius);
      S.m1.compose(S.v3.set(x, y, z), S.q1, S.v2);
      mesh.setMatrixAt(idx, S.m1);
    }

    function buildScatter() {
      const d = map.density;
      const nGrass = Math.round(q.grass * d);
      const nBush = Math.round(q.bush * d);
      const nTree = Math.round(q.tree * d);
      const nRock = Math.round(q.rock);
      const totalShade = nBush + nTree + nRock;

      const shadeMesh = makeInstanced(shadeGeometry(), shadeMaterial(), totalShade);
      staticShade = shadeMesh;
      let shadeN = 0;

      /* grass */
      const grassMat = own(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      const grass = makeInstanced(tuftGeometry(), grassMat, nGrass);
      const cA = new THREE.Color(map.ground.grass);
      const cB = new THREE.Color(map.foliage.scrub);
      let gi = 0;
      for (let i = 0; i < nGrass * 3 && gi < nGrass; i++) {
        const a = rng() * TAU, r = Math.sqrt(rng()) * PLAY_RADIUS * 1.5;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!groundIsPlaceable(x, z)) continue;
        const s = 0.7 + rng() * 1.1;
        S.q1.setFromAxisAngle(S.up, rng() * TAU);
        S.m1.compose(S.v3.set(x, heightAt(x, z) - 0.05, z), S.q1, S.v2.set(s * 0.9, s * (0.42 + rng() * 0.4), s * 0.9));
        grass.setMatrixAt(gi, S.m1);
        grass.setColorAt(gi, S.c1.copy(cA).lerp(cB, rng()).multiplyScalar(0.82 + rng() * 0.36));
        gi++;
      }
      grass.count = gi;

      /* bushes — the cover that matters */
      const bushMat = own(new THREE.MeshLambertMaterial({ flatShading: true }));
      const bush = makeInstanced(blobGeometry(1, 0.78, 0x51ee7), bushMat, nBush);
      const lA = new THREE.Color(map.foliage.leafA);
      const lB = new THREE.Color(map.foliage.leafB);
      let bi = 0;
      for (let i = 0; i < nBush * 4 && bi < nBush; i++) {
        const a = rng() * TAU, r = Math.sqrt(rng()) * PLAY_RADIUS * 1.35;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!groundIsPlaceable(x, z)) continue;
        const s = 1.15 + rng() * 1.5;
        S.q1.setFromAxisAngle(S.up, rng() * TAU);
        S.m1.compose(S.v3.set(x, heightAt(x, z) + s * 0.42, z), S.q1, S.v2.set(s, s * (0.7 + rng() * 0.4), s));
        bush.setMatrixAt(bi, S.m1);
        bush.setColorAt(bi, S.c1.copy(lA).lerp(lB, rng()).multiplyScalar(0.84 + rng() * 0.3));
        covers.push({ x, z, r: s * 1.25, strength: clamp(s / 2.4, 0.35, 0.95) });
        placeShade(shadeMesh, shadeN++, x, z, s * 1.15);
        bi++;
      }
      bush.count = bi;

      /* trees — trunk and canopy share a transform list */
      const barkMat = own(new THREE.MeshLambertMaterial({ color: map.foliage.bark }));
      const canopyMat = own(new THREE.MeshLambertMaterial({ flatShading: true }));
      const trunkGeo = own(new THREE.CylinderGeometry(0.16, 0.34, 1, 6, 1));
      trunkGeo.translate(0, 0.5, 0);
      const trunk = makeInstanced(trunkGeo, barkMat, nTree);
      const canopy = makeInstanced(blobGeometry(1, 0.4, 0x9a13), canopyMat, nTree);
      let ti = 0;
      for (let i = 0; i < nTree * 5 && ti < nTree; i++) {
        const a = rng() * TAU, r = Math.sqrt(rng()) * PLAY_RADIUS * 1.6;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!groundIsPlaceable(x, z)) continue;
        const h = 3.4 + rng() * 4.2;
        const spread = h * (0.52 + rng() * 0.3);
        const y = heightAt(x, z);
        S.q1.setFromAxisAngle(S.up, rng() * TAU);
        S.m1.compose(S.v3.set(x, y, z), S.q1, S.v2.set(1, h, 1));
        trunk.setMatrixAt(ti, S.m1);
        S.m1.compose(S.v3.set(x, y + h * 0.94, z), S.q1, S.v2.set(spread, spread * 0.55, spread));
        canopy.setMatrixAt(ti, S.m1);
        canopy.setColorAt(ti, S.c1.copy(lA).lerp(lB, rng() * 0.8).multiplyScalar(0.78 + rng() * 0.34));
        covers.push({ x, z, r: spread * 0.55, strength: 0.5 });
        blockers.push({ x, y: y + h * 0.9, z, r: spread * 0.5 });
        placeShade(shadeMesh, shadeN++, x, z, spread * 0.9);
        ti++;
      }
      trunk.count = ti;
      canopy.count = ti;

      /* rocks */
      const rockMat = own(new THREE.MeshLambertMaterial({ flatShading: true }));
      const rock = makeInstanced(blobGeometry(0, 0.72, 0x1234), rockMat, nRock);
      const cRock = new THREE.Color(map.ground.rock);
      let ri = 0;
      for (let i = 0; i < nRock * 4 && ri < nRock; i++) {
        const a = rng() * TAU, r = Math.sqrt(rng()) * PLAY_RADIUS * 1.7;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = heightAt(x, z);
        if (map.water && h < map.water.level) continue;
        const s = 0.7 + rng() * 2.6;
        S.q1.setFromEuler(S.e1.set(rng() * 0.5, rng() * TAU, rng() * 0.5));
        S.m1.compose(S.v3.set(x, h + s * 0.32, z), S.q1, S.v2.set(s, s * 0.8, s));
        rock.setMatrixAt(ri, S.m1);
        rock.setColorAt(ri, S.c1.copy(cRock).multiplyScalar(0.72 + rng() * 0.5));
        if (s > 1.5) {
          blockers.push({ x, y: h + s * 0.4, z, r: s * 0.72 });
          covers.push({ x, z, r: s, strength: 0.4 });
        }
        placeShade(shadeMesh, shadeN++, x, z, s * 0.95);
        ri++;
      }
      rock.count = ri;
      shadeMesh.count = shadeN;

      for (const m of props) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }

    // How hidden is a point? 0 in the open, 1 deep in a thicket.
    function concealmentAt(x, z) {
      let best = 0;
      for (let i = 0; i < covers.length; i++) {
        const c = covers[i];
        const dx = x - c.x, dz = z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > c.r * c.r) continue;
        const t = 1 - Math.sqrt(d2) / c.r;
        const v = c.strength * smoothstep(clamp(t * 1.3, 0, 1));
        if (v > best) best = v;
      }
      return best;
    }

    /* ================================================================ *
     * 4. THE ANIMALS
     * Each species is a handful of boxes welded into three meshes: body,
     * head and two leg pairs. Welding matters — a hundred separate box
     * meshes per herd is a hundred draw calls per herd, and this budget
     * has room for about a hundred in total.
     * ================================================================ */

    // Concatenate transformed box parts into one non-indexed geometry with
    // baked vertex colours. three's merge helper lives in addons, which the
    // registry pin does not carry, so it is done here.
    function weld(parts) {
      let total = 0;
      const baked = [];
      for (const p of parts) {
        const g = p.geo.clone().toNonIndexed();
        if (p.scale) g.scale(p.scale[0], p.scale[1], p.scale[2]);
        if (p.rot) g.rotateX(p.rot[0]), g.rotateY(p.rot[1]), g.rotateZ(p.rot[2]);
        if (p.pos) g.translate(p.pos[0], p.pos[1], p.pos[2]);
        baked.push({ g, color: p.color });
        total += g.attributes.position.count;
      }
      const position = new Float32Array(total * 3);
      const normal = new Float32Array(total * 3);
      const color = new Float32Array(total * 3);
      let o = 0;
      const c = S.c1;
      for (const b of baked) {
        const gp = b.g.attributes.position, gn = b.g.attributes.normal;
        c.setHex(b.color);
        for (let i = 0; i < gp.count; i++) {
          position[(o + i) * 3] = gp.getX(i);
          position[(o + i) * 3 + 1] = gp.getY(i);
          position[(o + i) * 3 + 2] = gp.getZ(i);
          normal[(o + i) * 3] = gn.getX(i);
          normal[(o + i) * 3 + 1] = gn.getY(i);
          normal[(o + i) * 3 + 2] = gn.getZ(i);
          color[(o + i) * 3] = c.r;
          color[(o + i) * 3 + 1] = c.g;
          color[(o + i) * 3 + 2] = c.b;
        }
        o += gp.count;
        b.g.dispose();
      }
      const geo = own(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(color, 3));
      return geo;
    }

    const BOX = own(new THREE.BoxGeometry(1, 1, 1));
    const CYL = own(new THREE.CylinderGeometry(1, 1, 1, 6, 1));

    // Built once per species and shared by every individual of it.
    const speciesRig = {};

    function buildSpeciesRig(key) {
      if (speciesRig[key]) return speciesRig[key];
      const s = SPECIES[key];
      const L = s.len, W = s.size, H = s.height;
      const biped = key === "ostrich";
      const body = [];
      const head = [];

      if (biped) {
        body.push({ geo: BOX, scale: [W * 0.72, W * 0.78, L * 0.9], pos: [0, 0, 0], color: s.body });
        body.push({ geo: BOX, scale: [W * 0.5, W * 0.42, L * 0.4], pos: [0, -W * 0.3, -L * 0.32], color: s.belly });
        // Tail plume.
        body.push({ geo: BOX, scale: [W * 0.42, W * 0.34, L * 0.3], pos: [0, W * 0.1, -L * 0.62], color: s.belly });
        head.push({ geo: CYL, scale: [W * 0.09, H * 0.62, W * 0.09], pos: [0, H * 0.3, L * 0.18], color: s.body });
        head.push({ geo: BOX, scale: [W * 0.17, W * 0.17, W * 0.34], pos: [0, H * 0.6, L * 0.26], color: s.mark });
      } else {
        // Torso, tapering to a narrower chest so the silhouette reads.
        body.push({ geo: BOX, scale: [W * 0.78, H * 0.52, L], pos: [0, 0, 0], color: s.body });
        body.push({ geo: BOX, scale: [W * 0.72, H * 0.3, L * 0.44], pos: [0, -H * 0.16, L * 0.06], color: s.belly });
        body.push({ geo: BOX, scale: [W * 0.66, H * 0.42, L * 0.34], pos: [0, H * 0.06, L * 0.42], color: s.body });
        // Tail.
        const tailLong = key === "leopard" || key === "cheetah";
        body.push({
          geo: BOX,
          scale: [W * 0.13, W * 0.13, tailLong ? L * 0.72 : L * 0.3],
          pos: [0, H * 0.1, -L * (tailLong ? 0.82 : 0.62)],
          rot: [tailLong ? 0.25 : -0.5, 0, 0],
          color: tailLong ? s.body : s.mark
        });
        // Neck and head.
        const neckUp = key === "zebra" || key === "ibex" || key === "gazelle" ? 0.55 : 0.2;
        head.push({ geo: BOX, scale: [W * 0.3, W * 0.3, L * 0.42], pos: [0, H * neckUp * 0.5, L * 0.18], rot: [-neckUp, 0, 0], color: s.body });
        head.push({ geo: BOX, scale: [W * 0.34, W * 0.34, L * 0.3], pos: [0, H * neckUp * 0.86, L * 0.42], color: s.body });
        head.push({ geo: BOX, scale: [W * 0.22, W * 0.2, L * 0.2], pos: [0, H * neckUp * 0.8, L * 0.58], color: s.mark });
        // Ears, horns and the one marking that names the animal.
        if (key === "ibex") {
          head.push({ geo: BOX, scale: [W * 0.07, W * 0.6, W * 0.07], pos: [W * 0.12, H * neckUp * 1.24, L * 0.36], rot: [-0.6, 0, 0], color: s.mark });
          head.push({ geo: BOX, scale: [W * 0.07, W * 0.6, W * 0.07], pos: [-W * 0.12, H * neckUp * 1.24, L * 0.36], rot: [-0.6, 0, 0], color: s.mark });
        } else if (key === "gazelle") {
          head.push({ geo: BOX, scale: [W * 0.05, W * 0.44, W * 0.05], pos: [W * 0.1, H * neckUp * 1.2, L * 0.4], rot: [-0.35, 0, 0], color: s.mark });
          head.push({ geo: BOX, scale: [W * 0.05, W * 0.44, W * 0.05], pos: [-W * 0.1, H * neckUp * 1.2, L * 0.4], rot: [-0.35, 0, 0], color: s.mark });
        } else if (key === "buffalo") {
          head.push({ geo: BOX, scale: [W * 0.62, W * 0.11, W * 0.11], pos: [0, H * neckUp * 1.06, L * 0.42], color: s.mark });
        } else if (key === "warthog") {
          head.push({ geo: BOX, scale: [W * 0.4, W * 0.1, W * 0.1], pos: [0, H * neckUp * 1.0, L * 0.5], color: s.belly });
        } else {
          head.push({ geo: BOX, scale: [W * 0.1, W * 0.14, W * 0.08], pos: [W * 0.14, H * neckUp * 1.1, L * 0.4], color: s.mark });
          head.push({ geo: BOX, scale: [W * 0.1, W * 0.14, W * 0.08], pos: [-W * 0.14, H * neckUp * 1.1, L * 0.4], color: s.mark });
        }
        // Zebra stripes and cat spots, as a few blocks of the mark colour.
        if (key === "zebra") {
          for (let i = 0; i < 5; i++) {
            body.push({ geo: BOX, scale: [W * 0.8, H * 0.53, L * 0.075], pos: [0, 0, -L * 0.34 + i * L * 0.17], color: s.mark });
          }
        } else if (key === "leopard" || key === "cheetah") {
          const r = makeRng(key === "leopard" ? 0x1eaf : 0xc4ee7);
          for (let i = 0; i < 9; i++) {
            body.push({
              geo: BOX,
              scale: [W * 0.8, H * 0.1, L * 0.09],
              pos: [(r() - 0.5) * W * 0.2, (r() - 0.5) * H * 0.34, (r() - 0.5) * L * 0.86],
              color: s.mark
            });
          }
        }
      }

      const legLen = biped ? H * 0.55 : H * 0.62;
      const legW = W * (biped ? 0.11 : 0.15);
      const legPair = (front) => {
        const parts = [];
        const zz = biped ? 0 : (front ? L * 0.32 : -L * 0.3);
        const xs = biped ? [W * 0.16, -W * 0.16] : [W * 0.28, -W * 0.28];
        for (const x of xs) {
          parts.push({ geo: BOX, scale: [legW, legLen, legW], pos: [x, -legLen * 0.5, zz], color: s.body });
          parts.push({ geo: BOX, scale: [legW * 1.2, legW * 0.9, legW * 1.6], pos: [x, -legLen, zz + legW * 0.2], color: s.mark });
        }
        return weld(parts);
      };

      const mat = own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      const rigOut = {
        bodyGeo: weld(body),
        headGeo: weld(head),
        legFrontGeo: legPair(true),
        legBackGeo: biped ? null : legPair(false),
        mat,
        biped,
        legLen,
        standY: legLen + (biped ? W * 0.4 : H * 0.26)
      };
      speciesRig[key] = rigOut;
      return rigOut;
    }

    /* ---------------------------------------------------------------- *
     * A live animal. Pooled: the maximum is allocated at map load and
     * reused for the whole run, so nothing is created mid-game.
     * ---------------------------------------------------------------- */
    const targets = [];
    let animalShade = null;

    function makeTarget(key) {
      const rig = buildSpeciesRig(key);
      const g = new THREE.Group();
      const body = new THREE.Mesh(rig.bodyGeo, rig.mat);
      const head = new THREE.Mesh(rig.headGeo, rig.mat);
      const legF = new THREE.Mesh(rig.legFrontGeo, rig.mat);
      g.add(body, head, legF);
      let legB = null;
      if (rig.legBackGeo) { legB = new THREE.Mesh(rig.legBackGeo, rig.mat); g.add(legB); }
      g.visible = false;
      worldGroup.add(g);
      return {
        key, spec: SPECIES[key], rig, group: g, body, head, legF, legB,
        alive: false, x: 0, y: 0, z: 0, heading: 0, speed: 0,
        state: "graze",        // graze | walk | alert | flee
        alertness: 0, gait: 0, wantHeading: 0, restT: 0, fleeT: 0,
        headTurn: 0, herdId: 0, spawnT: 0
      };
    }

    function targetHeight(t) { return t.rig.standY * 1.0; }

    // The capsule a bullet is tested against, plus the head sphere that
    // pays triple. Both are in world space, updated as the animal moves.
    function targetAim(t, out) {
      out.set(t.x, t.y + targetHeight(t) * 0.55, t.z);
      return out;
    }

    /* ---------------------------------------------------------------- *
     * Herd behaviour. An animal grazes, wanders, notices you, and runs.
     * Whether it notices you is the whole game: it is a race between how
     * close you are and how well the scrub is hiding you.
     * ---------------------------------------------------------------- */
    const SPAWN_WEIGHT = {
      warthog: 26, zebra: 22, buffalo: 18, ibex: 15,
      gazelle: 14, ostrich: 10, leopard: 3.2, cheetah: 1.7
    };

    let herdSeq = 1;

    function pickSpecies() {
      let total = 0;
      for (const k of map.species) total += SPAWN_WEIGHT[k] || 1;
      let r = rng() * total;
      for (const k of map.species) {
        r -= SPAWN_WEIGHT[k] || 1;
        if (r <= 0) return k;
      }
      return map.species[0];
    }

    function freeTarget() {
      for (let i = 0; i < targets.length; i++) if (!targets[i].alive) return targets[i];
      return null;
    }

    // Somewhere on the ground, a sensible distance out, not in the lake.
    function spawnSpot(minR, maxR, wantCover) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const a = rng() * TAU;
        const r = minR + rng() * (maxR - minR);
        const x = player.x + Math.cos(a) * r;
        const z = player.z + Math.sin(a) * r;
        if (x * x + z * z > PLAY_RADIUS * PLAY_RADIUS * 1.85) continue;
        const h = heightAt(x, z);
        if (map.water && h < map.water.level + 0.5) continue;
        if (slopeAt(x, z) > 0.5) continue;
        if (wantCover && concealmentAt(x, z) < 0.3) continue;
        return { x, z, y: h };
      }
      return null;
    }

    function spawnHerd() {
      const key = pickSpecies();
      const spec = SPECIES[key];
      const wantCover = spec.cover > 0.55;
      const anchor = spawnSpot(90, 330, wantCover);
      if (!anchor) return 0;
      const n = spec.herd[0] + Math.floor(rng() * (spec.herd[1] - spec.herd[0] + 1));
      const hid = herdSeq++;
      let placed = 0;
      for (let i = 0; i < n; i++) {
        const t = freeTarget();
        if (!t || t.key !== key) {
          // The pool is typed: find a free slot already built for this species.
          let slot = null;
          for (let j = 0; j < targets.length; j++) {
            if (!targets[j].alive && targets[j].key === key) { slot = targets[j]; break; }
          }
          if (!slot) continue;
          placeTarget(slot, anchor, hid, i);
          placed++;
          continue;
        }
        placeTarget(t, anchor, hid, i);
        placed++;
      }
      return placed;
    }

    function placeTarget(t, anchor, hid, idx) {
      const spread = 3 + idx * 2.6;
      const a = rng() * TAU;
      const x = anchor.x + Math.cos(a) * spread * rng();
      const z = anchor.z + Math.sin(a) * spread * rng();
      t.alive = true;
      t.x = x; t.z = z; t.y = heightAt(x, z);
      t.heading = rng() * TAU;
      t.wantHeading = t.heading;
      t.speed = 0;
      t.state = "graze";
      t.alertness = 0;
      t.gait = rng() * TAU;
      t.restT = 1 + rng() * 4;
      t.fleeT = 0;
      t.headTurn = 0;
      t.herdId = hid;
      t.spawnT = clock.t;
      t.group.visible = true;
    }

    function despawn(t) {
      t.alive = false;
      t.group.visible = false;
    }

    function buildTargetPool() {
      for (const t of targets) { worldGroup.remove(t.group); }
      targets.length = 0;
      // Enough of every species that a herd can always be placed, capped
      // at the preset's budget.
      const per = Math.max(2, Math.ceil(q.maxTargets / map.species.length));
      for (const key of map.species) {
        const s = SPECIES[key];
        const want = s.herd[1] > 3 ? per + 2 : per;
        for (let i = 0; i < want; i++) targets.push(makeTarget(key));
      }
      const shadeGeo = shadeGeometry();
      const shadeMat = own(new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false
      }));
      animalShade = new THREE.InstancedMesh(shadeGeo, shadeMat, targets.length);
      animalShade.frustumCulled = false;
      animalShade.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      animalShade.count = 0;
      worldGroup.add(animalShade);
    }

    // Rough line of sight: does the straight line from eye to animal pass
    // through a tree or a boulder?
    function blockedLOS(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1) return false;
      const ix = dx / len, iy = dy / len, iz = dz / len;
      for (let i = 0; i < blockers.length; i++) {
        const b = blockers[i];
        const ox = b.x - ax, oy = b.y - ay, oz = b.z - az;
        const proj = ox * ix + oy * iy + oz * iz;
        if (proj <= 0 || proj >= len) continue;
        const px = ox - ix * proj, py = oy - iy * proj, pz = oz - iz * proj;
        if (px * px + py * py + pz * pz < b.r * b.r) return true;
      }
      return false;
    }

    let spookWave = 0;           // decays after a shot; every animal feels it

    function updateTargets(dt) {
      const px = player.x, pz = player.z;
      const conceal = playerConcealment();
      const moving = clamp(player.moveMag, 0, 1);
      let shadeN = 0;

      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (!t.alive) continue;
        const spec = t.spec;
        const dx = px - t.x, dz = pz - t.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Too far to matter, or fled off the map: recycle the slot.
        if (dist > 460 || (t.x * t.x + t.z * t.z) > PLAY_RADIUS * PLAY_RADIUS * 2.6) {
          despawn(t);
          continue;
        }

        /* --- detection ------------------------------------------------ */
        const range = 120 * spec.wary;
        let detect = 0;
        if (dist < range) {
          const near = 1 - dist / range;
          // Concealment is the player's half of this; movement is the
          // other half. Standing still in a bush at 200 m is invisible.
          detect = near * near * spec.wary * (1 - conceal * 0.92) * (0.28 + moving * 1.5);
          if (player.scoped) detect *= 0.72;         // lying still behind glass
          if (blockedLOS(px, player.y + player.eye, pz, t.x, t.y + targetHeight(t) * 0.6, t.z)) detect *= 0.15;
        }
        t.alertness += (detect * 1.35 - 0.42) * dt + spookWave * spec.wary * dt * 2.4;
        t.alertness = clamp(t.alertness, 0, 1.6);

        /* --- state ---------------------------------------------------- */
        if (t.alertness >= 1) {
          if (t.state !== "flee") {
            t.state = "flee";
            t.fleeT = 4 + rng() * 5;
            t.wantHeading = Math.atan2(t.x - px, t.z - pz) + (rng() - 0.5) * 0.8;
            bus.emit("target:flee", { species: t.key });
          }
        } else if (t.alertness > 0.4) {
          if (t.state !== "flee") t.state = "alert";
        } else if (t.state === "alert") {
          t.state = "graze";
        }

        let targetSpeed = 0;
        if (t.state === "flee") {
          t.fleeT -= dt;
          targetSpeed = spec.sprint;
          if (t.fleeT <= 0) {
            t.state = "walk";
            t.alertness = 0.55;
            t.restT = 2 + rng() * 3;
          }
        } else if (t.state === "alert") {
          targetSpeed = 0;
        } else {
          t.restT -= dt;
          if (t.restT <= 0) {
            t.restT = 2.5 + rng() * 6;
            if (t.state === "graze") {
              t.state = "walk";
              t.wantHeading = t.heading + (rng() - 0.5) * 2.6;
            } else {
              t.state = "graze";
            }
          }
          targetSpeed = t.state === "walk" ? spec.speed * 0.4 : 0;
        }

        // Turn toward the wanted heading, then move.
        let dh = t.wantHeading - t.heading;
        while (dh > Math.PI) dh -= TAU;
        while (dh < -Math.PI) dh += TAU;
        const turnRate = t.state === "flee" ? 2.6 : 1.4;
        t.heading += clamp(dh, -turnRate * dt, turnRate * dt);
        t.speed += clamp(targetSpeed - t.speed, -14 * dt, 9 * dt);

        if (t.speed > 0.01) {
          const nx = t.x + Math.sin(t.heading) * t.speed * dt;
          const nz = t.z + Math.cos(t.heading) * t.speed * dt;
          // Turn away from the lake and from ground too steep to run on.
          const nh = heightAt(nx, nz);
          const wet = map.water && nh < map.water.level + 0.3;
          if (wet || slopeAt(nx, nz) > 0.62) {
            t.wantHeading = t.heading + 1.6;
          } else {
            t.x = nx; t.z = nz;
          }
        }
        t.y = heightAt(t.x, t.z);

        /* --- pose ------------------------------------------------------ */
        const g = t.group;
        g.position.set(t.x, t.y + t.rig.standY, t.z);
        g.rotation.y = t.heading;
        const runv = t.speed / Math.max(1, spec.sprint);
        t.gait += dt * (2.6 + runv * 16);
        const swing = Math.sin(t.gait) * (0.25 + runv * 0.7);
        t.legF.rotation.x = swing;
        if (t.legB) t.legB.rotation.x = -swing;
        // Body bob and a nose-down lean at speed.
        g.position.y += Math.abs(Math.sin(t.gait)) * runv * 0.16;
        t.body.rotation.x = -runv * 0.12;
        // Head: down to graze, up and toward you the moment it suspects.
        const wantHead = t.state === "graze" ? -0.75
          : t.state === "alert" ? 0.16
            : t.state === "flee" ? 0.1 : -0.2;
        t.headTurn += (wantHead - t.headTurn) * clamp(dt * 5, 0, 1);
        t.head.rotation.x = t.headTurn;
        if (t.state === "alert") {
          // Look at the noise.
          const look = Math.atan2(px - t.x, pz - t.z) - t.heading;
          t.head.rotation.y = clamp(((look + Math.PI) % TAU) - Math.PI, -0.9, 0.9);
        } else {
          t.head.rotation.y *= 1 - clamp(dt * 3, 0, 1);
        }

        if (animalShade && shadeN < animalShade.count + targets.length) {
          placeShade(animalShade, shadeN++, t.x, t.z, t.spec.size * 1.1, 0.05);
        }
      }

      if (animalShade) {
        animalShade.count = shadeN;
        animalShade.instanceMatrix.needsUpdate = true;
      }
      spookWave = Math.max(0, spookWave - dt * 1.6);

      // Keep the reserve stocked.
      let aliveN = 0;
      for (let i = 0; i < targets.length; i++) if (targets[i].alive) aliveN++;
      if (aliveN < q.maxTargets && clock.t - lastSpawnAt > 1.2) {
        lastSpawnAt = clock.t;
        spawnHerd();
      }
    }
    let lastSpawnAt = -99;

    /* ================================================================ *
     * 5. INPUT
     * Everything downstream reads actions, never key codes. That is what
     * lets the touch layer feed the same game the keyboard feeds, with
     * no branch anywhere in the gameplay code.
     * ================================================================ */
    const input = {
      moveX: 0, moveZ: 0,
      lookX: 0, lookY: 0,
      fire: false, scope: false, crouch: false, breath: false,
      firePressed: false, touchActive: false
    };
    const keys = Object.create(null);
    const stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, active: false };
    const looker = { id: -1, lx: 0, ly: 0, active: false, moved: 0 };

    function keyAxis() {
      let x = 0, z = 0;
      if (keys.KeyW || keys.ArrowUp) z += 1;
      if (keys.KeyS || keys.ArrowDown) z -= 1;
      if (keys.KeyA || keys.ArrowLeft) x -= 1;
      if (keys.KeyD || keys.ArrowRight) x += 1;
      const m = Math.hypot(x, z);
      return m > 1 ? { x: x / m, z: z / m } : { x, z };
    }

    ctx.listen(window, "keydown", (e) => {
      if (e.repeat) return;
      keys[e.code] = true;
      if (e.code === "Space") { input.firePressed = true; e.preventDefault(); }
      if (e.code === "KeyR") reload();
      if (e.code === "KeyC") player.wantCrouch = !player.wantCrouch;
      if (e.code === "KeyQ") cycleRifle(-1);
      if (e.code === "KeyE") cycleRifle(1);
      if (e.code === "Digit1") selectRifle(0);
      if (e.code === "Digit2") selectRifle(1);
      if (e.code === "Digit3") selectRifle(2);
      if (e.code === "Digit4") selectRifle(3);
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) >= 0) e.preventDefault();
    }, { passive: false });

    ctx.listen(window, "keyup", (e) => { keys[e.code] = false; }, { passive: true });

    function localPoint(e) {
      return { x: e.offsetX, y: e.offsetY };
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      if (e.pointerType === "touch") input.touchActive = true;
      const p = localPoint(e);
      if (game.screen !== "play") return;
      // Left third of the screen drives movement, the rest looks. A
      // scoped player gets the whole screen for looking: you do not walk
      // through the glass.
      const stickZone = player.scoped ? 0 : ctx.width * 0.42;
      if (p.x < stickZone && !stick.active) {
        stick.active = true; stick.id = e.pointerId;
        stick.ox = p.x; stick.oy = p.y; stick.x = 0; stick.y = 0;
        showStick(p.x, p.y);
      } else if (!looker.active) {
        looker.active = true; looker.id = e.pointerId;
        looker.lx = p.x; looker.ly = p.y; looker.moved = 0;
      }
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      const p = localPoint(e);
      if (e.pointerId === stick.id && stick.active) {
        e.preventDefault();
        const max = 52;
        let dx = p.x - stick.ox, dy = p.y - stick.oy;
        const m = Math.hypot(dx, dy);
        if (m > max) { dx = dx / m * max; dy = dy / m * max; }
        stick.x = dx / max; stick.y = dy / max;
        moveStick(dx, dy);
      } else if (e.pointerId === looker.id && looker.active) {
        e.preventDefault();
        const dx = p.x - looker.lx, dy = p.y - looker.ly;
        looker.lx = p.x; looker.ly = p.y;
        looker.moved += Math.abs(dx) + Math.abs(dy);
        // Looking is slowed by the scope's magnification, exactly as a
        // real one does — it is what makes a 20x scope feel heavy.
        const zoomEase = player.scoped ? 1 / Math.sqrt(currentRifle().zoom) : 1;
        input.lookX += dx * 0.0032 * lookSens * zoomEase;
        input.lookY += dy * 0.0032 * lookSens * zoomEase;
      }
    }, { passive: false });

    function endPointer(e) {
      if (e.pointerId === stick.id) {
        stick.active = false; stick.id = -1; stick.x = 0; stick.y = 0;
        hideStick();
      } else if (e.pointerId === looker.id) {
        looker.active = false; looker.id = -1;
        // A tap that never travelled is a shot, so a one-thumbed player
        // can aim and fire without hunting for the button.
        if (looker.moved < 9 && game.screen === "play" && player.scoped) input.firePressed = true;
      }
    }
    ctx.listen(canvas, "pointerup", (e) => { e.preventDefault(); endPointer(e); }, { passive: false });
    ctx.listen(canvas, "pointercancel", endPointer, { passive: true });
    ctx.listen(canvas, "contextmenu", (e) => e.preventDefault(), { passive: false });

    let lookSens = 1;

    /* ================================================================ *
     * 6. PLAYER
     * ================================================================ */
    const player = {
      x: 0, y: 0, z: 0, eye: 1.62,
      yaw: 0, pitch: 0,
      crouch: 0, wantCrouch: false,
      moveMag: 0, bob: 0,
      scoped: false, scopeT: 0,
      breath: 1, holdingBreath: false,
      rifleIdx: 0, ammo: 5, reloadT: 0, cycleT: 0,
      recoil: 0, recoilPitch: 0, swayT: 0,
      shots: 0, hits: 0
    };

    function currentRifle() { return RIFLES[player.rifleIdx]; }

    function playerConcealment() {
      const base = concealmentAt(player.x, player.z);
      // Crouching in a bush is what actually hides you; crouching in the
      // open barely helps.
      return clamp(base * (0.6 + player.crouch * 0.55) + player.crouch * 0.12, 0, 1);
    }

    const STAND_EYE = 1.62, CROUCH_EYE = 0.98;

    function updatePlayer(dt) {
      /* look */
      let lx = input.lookX, ly = input.lookY;
      input.lookX = 0; input.lookY = 0;
      player.yaw -= lx;
      player.pitch = clamp(player.pitch - ly, -1.35, 1.35);

      /* move */
      const k = keyAxis();
      let mx = k.x + (stick.active ? stick.x : 0);
      let mz = k.z + (stick.active ? -stick.y : 0);
      const m = Math.hypot(mx, mz);
      if (m > 1) { mx /= m; mz /= m; }
      player.moveMag = Math.min(1, m);

      const crouchWanted = player.wantCrouch || keys.ShiftLeft === true;
      player.crouch += ((crouchWanted ? 1 : 0) - player.crouch) * clamp(dt * 5, 0, 1);
      player.crouch = clamp(player.crouch, 0, 1);

      const scopedSlow = player.scoped ? 0.35 : 1;
      const speed = lerp(4.4, 1.9, player.crouch) * scopedSlow;
      if (player.moveMag > 0.01) {
        const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
        // Forward is where the camera looks; strafe is perpendicular.
        const fx = -sinY, fz = -cosY;
        const rx = cosY, rz = -sinY;
        let nx = player.x + (fx * mz + rx * mx) * speed * dt;
        let nz = player.z + (fz * mz + rz * mx) * speed * dt;
        const rr = Math.sqrt(nx * nx + nz * nz);
        if (rr > PLAY_RADIUS) { nx = nx / rr * PLAY_RADIUS; nz = nz / rr * PLAY_RADIUS; }
        const nh = heightAt(nx, nz);
        const wet = map.water && nh < map.water.level + 0.2;
        if (!wet && slopeAt(nx, nz) < 0.66) { player.x = nx; player.z = nz; }
        player.bob += dt * speed * 1.5;
      } else {
        player.bob += dt * 0.6;
      }
      player.y = heightAt(player.x, player.z);
      player.eye = lerp(STAND_EYE, CROUCH_EYE, player.crouch);

      /* breath */
      if (player.holdingBreath && player.breath > 0) {
        player.breath = Math.max(0, player.breath - dt * 0.34);
        if (player.breath === 0) player.holdingBreath = false;
      } else {
        player.breath = Math.min(1, player.breath + dt * 0.22);
      }

      /* weapon timers */
      if (player.cycleT > 0) player.cycleT = Math.max(0, player.cycleT - dt);
      if (player.reloadT > 0) {
        player.reloadT = Math.max(0, player.reloadT - dt);
        if (player.reloadT === 0) { player.ammo = currentRifle().mag; }
      }
      player.recoil += (0 - player.recoil) * clamp(dt * 7, 0, 1);
      player.recoilPitch += (0 - player.recoilPitch) * clamp(dt * 5.5, 0, 1);

      /* scope transition */
      const wantScope = player.scoped ? 1 : 0;
      player.scopeT += (wantScope - player.scopeT) * clamp(dt * 9, 0, 1);

      /* fire */
      if (input.firePressed || (input.fire && currentRifle().cycle < 0.4)) {
        input.firePressed = false;
        fire();
      }

      applyCamera(dt);
    }

    /* ---------------------------------------------------------------- *
     * Sway. Two out-of-phase Lissajous figures, so the reticle never
     * repeats a loop the eye can learn. Crouching and holding your
     * breath shrink it; the .50 multiplies it by one and a half.
     * ---------------------------------------------------------------- */
    function swayAmount() {
      const r = currentRifle();
      const steady = r.steady * (1 + player.crouch * 0.5) * (player.holdingBreath ? 5.2 : 1);
      const move = 1 + player.moveMag * 2.4;
      return (r.sway / steady) * move * 0.0055;
    }

    function aimDirection(out, withSway) {
      const amt = withSway ? swayAmount() * player.scopeT : 0;
      const t = player.swayT;
      const sx = (Math.sin(t * 0.83) * 0.62 + Math.sin(t * 2.17 + 1.1) * 0.26) * amt;
      const sy = (Math.cos(t * 1.09) * 0.55 + Math.sin(t * 1.73 + 0.4) * 0.21) * amt;
      const yaw = player.yaw + sx;
      const pitch = clamp(player.pitch + sy + player.recoilPitch, -1.4, 1.4);
      out.set(
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch)
      ).normalize();
      return out;
    }

    function applyCamera(dt) {
      player.swayT += dt;
      const bobAmt = (1 - player.scopeT * 0.85) * player.moveMag * 0.045;
      const bx = Math.sin(player.bob * 2) * bobAmt;
      const by = Math.abs(Math.cos(player.bob * 2)) * bobAmt * 0.8;
      camera.position.set(player.x + bx, player.y + player.eye + by, player.z);
      aimDirection(S.v1, true);
      S.v2.copy(camera.position).add(S.v1);
      camera.lookAt(S.v2);
      const r = currentRifle();
      const fov = lerp(62, 62 / r.zoom, player.scopeT);
      if (Math.abs(camera.fov - fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
      if (skyMesh) skyMesh.position.copy(camera.position);
      if (sunDisc) {
        sunDirection(sunDir);
        sunDisc.position.copy(camera.position).addScaledVector(sunDir, 1500);
        sunGlow.position.copy(sunDisc.position);
      }
    }

    /* ================================================================ *
     * 7. BALLISTICS
     * A bullet is a real object with a real flight time. At 500 m a .308
     * round takes six tenths of a second to arrive and falls about two
     * metres on the way, so you hold over and you lead — which is the
     * entire reason a running cheetah is worth eight hundred points and
     * a grazing warthog is worth twenty-five.
     * ================================================================ */
    const bullets = [];
    const MAX_BULLETS = 8;
    for (let i = 0; i < MAX_BULLETS; i++) {
      bullets.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        px: 0, py: 0, pz: 0, t: 0, dist: 0, ox: 0, oy: 0, oz: 0,
        candidates: [], rifle: null
      });
    }

    let tracer = null, tracerPos = null;
    function buildTracers() {
      const geo = own(new THREE.BufferGeometry());
      const arr = new Float32Array(MAX_BULLETS * 6);
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const mat = own(new THREE.LineBasicMaterial({
        color: 0xffe8b0, transparent: true, opacity: 0.5, fog: false, depthWrite: false
      }));
      tracer = new THREE.LineSegments(geo, mat);
      tracer.frustumCulled = false;
      tracerPos = arr;
      scene.add(tracer);
    }

    function freeBullet() {
      for (let i = 0; i < bullets.length; i++) if (!bullets[i].alive) return bullets[i];
      return null;
    }

    function reload() {
      const r = currentRifle();
      if (player.reloadT > 0 || player.ammo >= r.mag || game.screen !== "play") return;
      player.reloadT = r.reload;
      sfx.reload();
    }

    function selectRifle(i) {
      if (i < 0 || i >= RIFLES.length) return;
      if (!rifleUnlocked(i)) { flash("Locked — " + RIFLES[i].unlockAt + " career points"); return; }
      if (i === player.rifleIdx) return;
      player.rifleIdx = i;
      player.ammo = RIFLES[i].mag;
      player.reloadT = 0;
      player.cycleT = 0.4;
      buildViewmodel();
      sfx.swap();
      syncHud();
    }
    function cycleRifle(dir) {
      for (let n = 1; n <= RIFLES.length; n++) {
        const i = (player.rifleIdx + dir * n + RIFLES.length * 4) % RIFLES.length;
        if (rifleUnlocked(i)) { selectRifle(i); return; }
      }
    }
    function rifleUnlocked(i) { return career.points >= RIFLES[i].unlockAt; }

    function fire() {
      if (game.screen !== "play") return;
      const r = currentRifle();
      if (player.cycleT > 0 || player.reloadT > 0) return;
      if (player.ammo <= 0) { sfx.dryFire(); reload(); return; }
      const b = freeBullet();
      if (!b) return;

      player.ammo--;
      player.cycleT = r.cycle;
      player.shots++;
      run.shots++;

      aimDirection(S.v1, true);
      // Zeroed at 200 m: the barrel points slightly above the sight line
      // so a close shot lands where the crosshair is.
      const tof = ZERO_RANGE / r.muzzle;
      const rise = 0.5 * GRAVITY * tof * tof / ZERO_RANGE;
      S.v1.y += rise;
      // Cone of fire, tightened by the scope.
      const spread = r.spread * (player.scoped ? 1 : 7) * (1 + player.moveMag * 2);
      S.v1.x += (rng() - 0.5) * spread;
      S.v1.y += (rng() - 0.5) * spread;
      S.v1.z += (rng() - 0.5) * spread;
      S.v1.normalize();

      b.alive = true;
      b.x = b.px = b.ox = camera.position.x;
      b.y = b.py = b.oy = camera.position.y;
      b.z = b.pz = b.oz = camera.position.z;
      b.vx = S.v1.x * r.muzzle;
      b.vy = S.v1.y * r.muzzle;
      b.vz = S.v1.z * r.muzzle;
      b.t = 0; b.dist = 0; b.rifle = r;

      // Only animals roughly along the line can ever be hit; the flight
      // loop then tests a handful rather than the whole reserve.
      b.candidates.length = 0;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (!t.alive) continue;
        const dx = t.x - b.x, dy = (t.y + targetHeight(t) * 0.5) - b.y, dz = t.z - b.z;
        const proj = dx * S.v1.x + dy * S.v1.y + dz * S.v1.z;
        if (proj <= 0) continue;
        const ex = dx - S.v1.x * proj, ey = dy - S.v1.y * proj, ez = dz - S.v1.z * proj;
        // A 26 m corridor: wide enough to still contain the round after
        // it has dropped for a kilometre.
        if (ex * ex + ey * ey + ez * ez < 676) b.candidates.push(t);
      }

      player.recoil = 1;
      player.recoilPitch = 0.006 + r.sway * 0.012;
      spookWave += 0.55;
      sfx.shot(r);
      haptic("heavy");
      muzzleFlash();
      bus.emit("weapon:fire", { rifle: r.id });
      ctx.platform.interact({ type: "shot", rifle: r.id });
      syncHud();
    }

    // Sphere test against a moving segment.
    function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 < 1e-9) return false;
      let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
      t = clamp(t, 0, 1);
      const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
      return px * px + py * py + pz * pz <= r * r;
    }

    function updateBullets(dt) {
      let live = 0;
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        if (!b.alive) continue;
        // Sub-step so a 900 m/s round cannot skip through a gazelle.
        const steps = Math.min(48, Math.max(1, Math.ceil(dt / 0.0035)));
        const h = dt / steps;
        for (let s = 0; s < steps && b.alive; s++) {
          b.px = b.x; b.py = b.y; b.pz = b.z;
          b.vy -= GRAVITY * h;
          b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
          b.t += h;
          b.dist = Math.hypot(b.x - b.ox, b.y - b.oy, b.z - b.oz);

          /* animals */
          for (let c = 0; c < b.candidates.length; c++) {
            const t = b.candidates[c];
            if (!t.alive) continue;
            const H = targetHeight(t);
            const size = t.spec.size;
            const hx = t.x + Math.sin(t.heading) * t.spec.len * 0.42;
            const hz = t.z + Math.cos(t.heading) * t.spec.len * 0.42;
            const hy = t.y + H * (t.rig.biped ? 1.02 : 0.86);
            if (segSphere(b.px, b.py, b.pz, b.x, b.y, b.z, hx, hy, hz, size * 0.3)) {
              hitTarget(t, b, "head"); b.alive = false; break;
            }
            if (segSphere(b.px, b.py, b.pz, b.x, b.y, b.z, t.x, t.y + H * 0.58, t.z, size * 0.52)) {
              hitTarget(t, b, "body"); b.alive = false; break;
            }
            if (segSphere(b.px, b.py, b.pz, b.x, b.y, b.z, t.x, t.y + H * 0.22, t.z, size * 0.4)) {
              hitTarget(t, b, "leg"); b.alive = false; break;
            }
          }
          if (!b.alive) break;

          /* trees and boulders */
          for (let k = 0; k < blockers.length; k++) {
            const bl = blockers[k];
            const dx = b.x - bl.x, dy = b.y - bl.y, dz = b.z - bl.z;
            if (dx * dx + dy * dy + dz * dz < bl.r * bl.r) {
              impact(b.x, b.y, b.z, "wood"); b.alive = false; break;
            }
          }
          if (!b.alive) break;

          /* ground and water */
          if (map.water && b.y < map.water.level) { impact(b.x, map.water.level, b.z, "water"); b.alive = false; break; }
          if (b.y < heightAt(b.x, b.z)) { impact(b.x, heightAt(b.x, b.z), b.z, "dirt"); b.alive = false; break; }
          if (b.dist > 1600 || b.y > 400) { b.alive = false; break; }
        }
        if (b.alive) live++;
      }

      // Tracers: a short streak behind each round in flight.
      let n = 0;
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        if (!b.alive) continue;
        const back = 14;
        const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
        tracerPos[n * 6] = b.x; tracerPos[n * 6 + 1] = b.y; tracerPos[n * 6 + 2] = b.z;
        tracerPos[n * 6 + 3] = b.x - b.vx / sp * back;
        tracerPos[n * 6 + 4] = b.y - b.vy / sp * back;
        tracerPos[n * 6 + 5] = b.z - b.vz / sp * back;
        n++;
      }
      for (let i = n; i < MAX_BULLETS; i++) {
        for (let k = 0; k < 6; k++) tracerPos[i * 6 + k] = 0;
      }
      tracer.geometry.attributes.position.needsUpdate = true;
      tracer.visible = n > 0;
      return live;
    }

    /* ---------------------------------------------------------------- *
     * Scoring. Value by species, tripled for a head shot, halved for a
     * limb, and multiplied by how far away it was — the distance term is
     * what makes the long shot the point of the game.
     * ---------------------------------------------------------------- */
    const ZONE_MULT = { head: 3, body: 1, leg: 0.4 };

    function hitTarget(t, b, zone) {
      const dist = Math.hypot(t.x - b.ox, (t.y - b.oy), t.z - b.oz);
      const distMult = 1 + clamp((dist - 90) / 380, 0, 2.4);
      const points = Math.round(t.spec.value * ZONE_MULT[zone] * distMult);
      player.hits++;
      run.hits++;
      run.score += points;
      if (zone === "head") run.headshots++;
      if (dist > run.longest) run.longest = dist;
      run.taken[t.key] = (run.taken[t.key] || 0) + 1;
      if (t.spec.tier === "high") run.trophies++;

      impact(b.x, b.y, b.z, "hit");
      popScore(t.x, t.y + targetHeight(t) * 0.9, t.z, points, zone, t.spec.name, dist);
      sfx.hit(zone, dist);
      haptic(zone === "head" ? "success" : "medium");
      ctx.platform.setScore(run.score);
      bus.emit("target:hit", { species: t.key, zone, distance: dist, points });

      if (zone === "leg" && t.spec.hp > 1) {
        // Wounded, not taken: it bolts and is worth nothing after that.
        t.alertness = 1.6;
        return;
      }
      despawn(t);
      spookWave += 0.8;
      syncHud();
    }

    /* ================================================================ *
     * 8. RUN STATE
     * ================================================================ */
    const game = {
      screen: "title",       // title | brief | play | over | help
      mapIndex: 0,
      timer: 0,
      started: false
    };
    const run = {
      score: 0, shots: 0, hits: 0, headshots: 0, longest: 0,
      trophies: 0, taken: {}, timeLeft: RUN_SECONDS
    };
    const career = { points: 0, best: 0, runs: 0 };

    function resetRun() {
      run.score = 0; run.shots = 0; run.hits = 0; run.headshots = 0;
      run.longest = 0; run.trophies = 0; run.taken = {}; run.timeLeft = RUN_SECONDS;
      player.shots = 0; player.hits = 0;
    }

    /* ================================================================ *
     * 9. SOUND
     * All synthesized: packaged assets are disabled, and a rifle is one
     * of the few things a bit can make convincingly from an envelope —
     * a crack, a body thump, and a tail that arrives late enough to sell
     * the distance.
     * ================================================================ */
    let AC = null, master = null, noiseBuf = null;
    let sfxOn = true, hapticsOn = true;

    function audioReady() {
      if (!ctx.capabilities || !ctx.capabilities.audio) return null;
      if (AC) return AC;
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = 0.55;
        master.connect(AC.destination);
        const len = Math.floor(AC.sampleRate * 1.5);
        noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        ctx.onDestroy(() => { try { AC && AC.close(); } catch (e) { /* gone */ } });
      } catch (err) { AC = null; }
      return AC;
    }

    function env(node, t0, peak, attack, decay) {
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      node.connect(g);
      g.connect(master);
      return g;
    }

    function tone(type, f0, f1, dur, peak, delay) {
      if (!AC || !sfxOn) return;
      const t0 = AC.currentTime + (delay || 0);
      const o = AC.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, f0), t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      env(o, t0, peak, Math.min(0.008, dur * 0.2), dur);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }

    function noiseBurst(dur, peak, type, f0, f1, q, delay) {
      if (!AC || !sfxOn || !noiseBuf) return;
      const t0 = AC.currentTime + (delay || 0);
      const src = AC.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const filt = AC.createBiquadFilter();
      filt.type = type || "bandpass";
      filt.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
      filt.Q.value = q || 1;
      src.connect(filt);
      env(filt, t0, peak, 0.003, dur);
      src.start(t0); src.stop(t0 + dur + 0.05);
    }

    const sfx = {
      // Crack, then body, then a tail that returns off the far ground. The
      // tail is what makes a rifle sound like it is outdoors.
      shot(r) {
        if (!AC || !sfxOn) return;
        const heft = clamp(r.muzzle / 800, 0.85, 1.15) * (r.id === "anvil" ? 1.5 : 1);
        noiseBurst(0.055, 0.55 * heft, "highpass", 3800, 1400, 0.7);
        noiseBurst(0.3 * heft, 0.34, "lowpass", 700, 110, 1.1, 0.008);
        tone("sawtooth", 150 * heft, 44, 0.28, 0.2, 0.006);
        noiseBurst(0.9, 0.075, "lowpass", 420, 150, 0.8, 0.13);
      },
      dryFire() { noiseBurst(0.04, 0.14, "bandpass", 2600, 1500, 3); },
      reload() {
        noiseBurst(0.05, 0.13, "bandpass", 1700, 900, 4, 0.02);
        noiseBurst(0.06, 0.16, "bandpass", 900, 500, 3, 0.42);
        tone("square", 320, 200, 0.05, 0.06, 0.44);
      },
      swap() { noiseBurst(0.07, 0.11, "bandpass", 1200, 600, 3); },
      // A hit heard from 400 m arrives after the crack. That delay is most of
      // what tells you the shot connected.
      hit(zone, dist) {
        const delay = Math.min(1.3, dist / 340);
        if (zone === "head") {
          tone("triangle", 880, 420, 0.1, 0.16, delay);
          noiseBurst(0.14, 0.2, "bandpass", 1500, 400, 1.4, delay);
        } else {
          noiseBurst(0.16, 0.16, "lowpass", 620, 150, 1.1, delay);
        }
      },
      impactDirt(dist) { noiseBurst(0.12, 0.09, "lowpass", 900, 200, 1, Math.min(1.3, dist / 340)); },
      spook() { noiseBurst(0.28, 0.07, "bandpass", 700, 1500, 2.2); },
      start() { tone("triangle", 392, 587, 0.5, 0.12); tone("triangle", 587, 784, 0.4, 0.09, 0.2); },
      end() { tone("triangle", 523, 392, 0.35, 0.11); tone("triangle", 392, 262, 0.6, 0.1, 0.28); },
      tick() { tone("square", 1200, 1200, 0.04, 0.05); }
    };

    function haptic(kind) {
      if (!hapticsOn) return;
      try { ctx.platform.haptic(kind); } catch (err) { /* host without haptics */ }
    }

    /* ================================================================ *
     * 10. FX
     * Pooled and preallocated. A particle system that grows on demand is
     * how you get an unattributable hitch every forty seconds.
     * ================================================================ */
    const MAX_PUFFS = 200;
    let puffMesh = null, puffPool = null, puffNext = 0;
    const pops = [];

    function buildFx() {
      const geo = own(new THREE.PlaneGeometry(1, 1));
      const mat = own(new THREE.MeshBasicMaterial({
        color: 0xd8c49a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide
      }));
      puffMesh = new THREE.InstancedMesh(geo, mat, MAX_PUFFS);
      puffMesh.frustumCulled = false;
      puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(puffMesh);
      puffPool = new Array(MAX_PUFFS);
      for (let i = 0; i < MAX_PUFFS; i++) puffPool[i] = { t: 1e9, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 };
      S.m1.makeScale(0, 0, 0);
      for (let i = 0; i < MAX_PUFFS; i++) puffMesh.setMatrixAt(i, S.m1);
      puffMesh.instanceMatrix.needsUpdate = true;
    }

    function impact(x, y, z, kind) {
      const n = kind === "hit" ? 15 : 10;
      const spd = kind === "hit" ? 5 : 3.2;
      for (let i = 0; i < n; i++) {
        const p = puffPool[puffNext];
        puffNext = (puffNext + 1) % MAX_PUFFS;
        p.t = 0;
        p.life = kind === "hit" ? 0.5 : 0.9;
        p.x = x; p.y = y; p.z = z;
        p.vx = (rng() - 0.5) * spd;
        p.vy = rng() * spd * 0.9 + 0.6;
        p.vz = (rng() - 0.5) * spd;
        p.s = (kind === "hit" ? 0.15 : 0.24) * (0.6 + rng());
      }
      if (kind !== "hit") {
        const d = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
        sfx.impactDirt(d);
      }
      bus.emit("bullet:impact", { x, y, z, surface: kind });
    }

    function popScore(x, y, z, points, zone, name, dist) {
      pops.push({ x, y, z, points, zone, name, dist, t: 0 });
      if (pops.length > 6) pops.shift();
    }

    function updateFx(dt) {
      let any = false;
      for (let i = 0; i < MAX_PUFFS; i++) {
        const p = puffPool[i];
        if (p.t > p.life) continue;
        p.t += dt;
        p.vy -= 6 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const k = 1 - p.t / p.life;
        if (k <= 0) {
          S.m1.makeScale(0, 0, 0);
        } else {
          // Billboard, so a flat quad never shows its edge.
          const s = p.s * (1.6 - k * 0.6);
          S.m1.compose(S.v1.set(p.x, p.y, p.z), camera.quaternion, S.v2.set(s, s, s));
          any = true;
        }
        puffMesh.setMatrixAt(i, S.m1);
      }
      puffMesh.instanceMatrix.needsUpdate = true;
      puffMesh.visible = any;
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += dt;
        if (pops[i].t > 1.9) pops.splice(i, 1);
      }
    }

    /* ================================================================ *
     * 11. THE RIFLE IN YOUR HANDS
     * Welded from boxes in the overlay scene, which has its own near
     * plane so it can never clip into a rock.
     * ================================================================ */
    let vmGroup = null, vmFlash = null, vmBolt = null;

    function buildViewmodel() {
      if (vmGroup) { vmGroup.parent && vmGroup.parent.remove(vmGroup); vmGroup = null; }
      const r = currentRifle();
      const STOCK = 0x6a6a44, METAL = 0x2a2c30, DARK = 0x16181b;
      const long = r.id === "anvil" ? 1.35 : r.id === "longbow" ? 1.2 : 1.0;
      const parts = [
        // Stock: butt, comb, thumbhole grip, fore-end.
        { geo: BOX, scale: [0.075, 0.135, 0.30], pos: [0, -0.012, 0.28], color: STOCK },
        { geo: BOX, scale: [0.07, 0.055, 0.22], pos: [0, 0.045, 0.12], color: STOCK },
        { geo: BOX, scale: [0.065, 0.115, 0.075], pos: [0, -0.07, 0.13], color: STOCK },
        { geo: BOX, scale: [0.072, 0.085, 0.34], pos: [0, -0.005, -0.16], color: STOCK },
        // Receiver and barrel.
        { geo: BOX, scale: [0.062, 0.07, 0.24], pos: [0, 0.028, 0.0], color: METAL },
        { geo: CYL, scale: [0.019, 0.62 * long, 0.019], rot: [Math.PI / 2, 0, 0], pos: [0, 0.03, -0.30 - 0.31 * long], color: METAL },
        { geo: CYL, scale: [0.026, 0.06, 0.026], rot: [Math.PI / 2, 0, 0], pos: [0, 0.03, -0.60 - 0.62 * long], color: DARK },
        // Scope: tube, objective bell, ocular, two rings, turret.
        { geo: CYL, scale: [0.021, 0.30, 0.021], rot: [Math.PI / 2, 0, 0], pos: [0, 0.105, -0.05], color: DARK },
        { geo: CYL, scale: [0.030, 0.07, 0.030], rot: [Math.PI / 2, 0, 0], pos: [0, 0.105, -0.21], color: DARK },
        { geo: CYL, scale: [0.026, 0.06, 0.026], rot: [Math.PI / 2, 0, 0], pos: [0, 0.105, 0.11], color: DARK },
        { geo: BOX, scale: [0.03, 0.045, 0.022], pos: [0, 0.075, -0.11], color: METAL },
        { geo: BOX, scale: [0.03, 0.045, 0.022], pos: [0, 0.075, 0.03], color: METAL },
        { geo: CYL, scale: [0.016, 0.026, 0.016], pos: [0, 0.135, -0.04], color: METAL },
        // Magazine and trigger guard.
        { geo: BOX, scale: [0.038, 0.10, 0.075], pos: [0, -0.075, -0.01], color: DARK },
        { geo: BOX, scale: [0.05, 0.012, 0.075], pos: [0, -0.038, 0.055], color: METAL },
        // Bipod, folded down under the fore-end.
        { geo: CYL, scale: [0.007, 0.18, 0.007], rot: [0.25, 0, 0.42], pos: [0.05, -0.12, -0.28], color: DARK },
        { geo: CYL, scale: [0.007, 0.18, 0.007], rot: [0.25, 0, -0.42], pos: [-0.05, -0.12, -0.28], color: DARK }
      ];
      const geo = weld(parts);
      const mat = own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      vmGroup = new THREE.Group();
      vmGroup.add(new THREE.Mesh(geo, mat));
      // Bolt handle, so cycling has something to move.
      const boltGeo = weld([
        { geo: CYL, scale: [0.008, 0.075, 0.008], rot: [0, 0, Math.PI / 2], pos: [0.045, 0.03, 0.05], color: METAL },
        { geo: BOX, scale: [0.022, 0.022, 0.022], pos: [0.082, 0.03, 0.05], color: METAL }
      ]);
      vmBolt = new THREE.Mesh(boltGeo, mat);
      vmGroup.add(vmBolt);
      // Muzzle flash: additive, hidden until a shot.
      const fg = own(new THREE.PlaneGeometry(0.22, 0.22));
      const fm = own(new THREE.MeshBasicMaterial({
        color: 0xffd88a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      vmFlash = new THREE.Mesh(fg, fm);
      vmFlash.position.set(0, 0.03, -0.62 - 0.62 * long);
      vmFlash.visible = false;
      vmGroup.add(vmFlash);

      vmGroup.scale.setScalar(0.135);
      vmGroup.position.set(0.052, -0.052, -0.30);
      vmGroup.rotation.set(0.02, 0.07, 0.02);
      // Child of the camera, so it is fixed in view space.
      overlayCamera.add(vmGroup);
      vmRest = vmGroup.position.clone();
    }
    let vmRest = null;
    let flashT = 0;

    function muzzleFlash() { flashT = 0.055; }

    function updateViewmodel(dt) {
      if (!vmGroup) return;
      const p = player;
      flashT = Math.max(0, flashT - dt);
      if (vmFlash) {
        vmFlash.visible = flashT > 0;
        if (flashT > 0) {
          const k = flashT / 0.055;
          vmFlash.scale.setScalar(0.7 + k * 0.9);
          vmFlash.quaternion.copy(overlayCamera.quaternion);
        }
      }
      // Scoping pulls the rifle back and centres it; recoil kicks it.
      vmGroup.position.set(
        lerp(vmRest.x, 0.0, p.scopeT),
        lerp(vmRest.y, -0.0165, p.scopeT) - p.recoil * 0.006,
        lerp(vmRest.z, -0.235, p.scopeT) + p.recoil * 0.016
      );
      vmGroup.rotation.z = lerp(0.012, 0, p.scopeT);
      // The bolt runs back and returns over the cycle time.
      if (vmBolt) {
        const r = currentRifle();
        const k = r.cycle > 0.4 ? clamp(p.cycleT / r.cycle, 0, 1) : 0;
        vmBolt.position.z = Math.sin(k * Math.PI) * 0.075;
      }
      vmGroup.visible = p.scopeT < 0.9;
    }

    /* ================================================================ *
     * 12. HUD
     * A DOM overlay, because a HUD wants real text at real sizes and a
     * canvas one never quite gets there on a phone. Everything pressable
     * is at least 44 CSS px, which is the floor for a thumb.
     * ================================================================ */
    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText = "position:absolute;inset:0;pointer-events:none;"
      + "font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#eef3f9;"
      + "text-shadow:0 1px 3px rgba(0,0,0,.85);-webkit-user-select:none;user-select:none";

    const sa = () => ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    root.innerHTML = `
      <style>
        .ls-pad{position:absolute;inset:0}
        .ls-btn{pointer-events:auto;min-width:44px;min-height:44px;display:flex;
          align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.42);
          border-radius:10px;background:rgba(10,14,20,.42);color:#eef3f9;font:600 12px/1 ui-monospace,monospace;
          letter-spacing:.5px;padding:0 12px;backdrop-filter:blur(2px)}
        .ls-btn:active{background:rgba(255,255,255,.24)}
        .ls-btn.on{background:rgba(120,200,255,.30);border-color:#9fdcff}
        .ls-big{font-size:23px;font-weight:600;letter-spacing:.4px}
        .ls-dim{opacity:.62}
        .ls-warn{color:#ffb457}
        .ls-panel{pointer-events:auto;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
          width:min(430px,92%);max-height:88%;overflow:auto;background:rgba(9,13,19,.93);
          border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:20px 22px}
        .ls-h1{font-size:26px;font-weight:700;letter-spacing:2px;margin-bottom:2px}
        .ls-row{display:flex;justify-content:space-between;gap:10px;margin:5px 0}
        .ls-sep{height:1px;background:rgba(255,255,255,.15);margin:13px 0}
        .ls-mapbtn{flex:1;text-align:center}
        .ls-stick{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;
          border:1px solid rgba(255,255,255,.30);border-radius:50%;display:none;pointer-events:none}
        .ls-nub{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;
          border-radius:50%;background:rgba(255,255,255,.24)}
        .ls-pop{position:absolute;transform:translate(-50%,-50%);font-weight:600;white-space:nowrap;text-align:center}
        .ls-scope{position:absolute;left:0;top:0;width:100%;height:100%;opacity:0}
        .ls-flash{position:absolute;left:50%;top:22%;transform:translateX(-50%);
          background:rgba(9,13,19,.8);border-radius:8px;padding:7px 13px;opacity:0;transition:opacity .2s}
      </style>
      <div class="ls-pad">
        <svg class="ls-scope" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs><radialGradient id="lsv"><stop offset="66%" stop-color="rgba(0,0,0,0)"/>
          <stop offset="79%" stop-color="rgba(0,0,0,.9)"/><stop offset="100%" stop-color="#000"/></radialGradient></defs>
          <rect width="100" height="100" fill="url(#lsv)"/>
        </svg>
        <svg id="lsret" width="220" height="220" viewBox="-110 -110 220 220"
             style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)"></svg>
        <div id="lsstick" class="ls-stick"><div class="ls-nub"></div></div>
        <div id="lspops" class="ls-pad" style="overflow:hidden"></div>
        <div id="lsflash" class="ls-flash"></div>
        <div id="lshud" style="position:absolute;inset:0"></div>
        <div id="lsscreen"></div>
      </div>`;

    const H = {
      scope: root.querySelector(".ls-scope"),
      ret: root.querySelector("#lsret"),
      stick: root.querySelector("#lsstick"),
      nub: root.querySelector("#lsstick .ls-nub"),
      pops: root.querySelector("#lspops"),
      flash: root.querySelector("#lsflash"),
      hud: root.querySelector("#lshud"),
      screen: root.querySelector("#lsscreen")
    };

    function showStick(x, y) {
      H.stick.style.display = "block";
      H.stick.style.left = x + "px";
      H.stick.style.top = y + "px";
      H.nub.style.transform = "translate(0,0)";
    }
    function moveStick(dx, dy) { H.nub.style.transform = `translate(${dx}px,${dy}px)`; }
    function hideStick() { H.stick.style.display = "none"; }

    let flashTimer = 0;
    function flash(msg) {
      H.flash.textContent = msg;
      H.flash.style.opacity = "1";
      flashTimer = 2.2;
    }

    let retScoped = null;
    function drawReticle(scoped) {
      if (retScoped === scoped) return;
      retScoped = scoped;
      if (scoped) {
        // Mil-dots are the holdover marks you actually use past the zero.
        let d = "";
        for (let i = 1; i <= 5; i++) d += `<circle cx="0" cy="${i * 14}" r="1.6" fill="#111"/>`;
        for (let i = 1; i <= 4; i++) d += `<circle cx="${i * 14}" cy="0" r="1.6" fill="#111"/><circle cx="${-i * 14}" cy="0" r="1.6" fill="#111"/>`;
        H.ret.innerHTML = `<g stroke="#111" stroke-width="1.7" fill="none">
          <line x1="-104" y1="0" x2="-9" y2="0"/><line x1="9" y1="0" x2="104" y2="0"/>
          <line x1="0" y1="-104" x2="0" y2="-9"/><line x1="0" y1="9" x2="0" y2="104"/></g>
          ${d}<circle cx="0" cy="0" r="1.2" fill="#c8332a"/>`;
      } else {
        H.ret.innerHTML = `<g stroke="rgba(255,255,255,.85)" stroke-width="1.7" fill="none">
          <line x1="-15" y1="0" x2="-6" y2="0"/><line x1="6" y1="0" x2="15" y2="0"/>
          <line x1="0" y1="-15" x2="0" y2="-6"/><line x1="0" y1="6" x2="0" y2="15"/></g>
          <circle cx="0" cy="0" r="1" fill="rgba(255,255,255,.9)"/>`;
      }
    }

    /** Range to whatever is under the crosshair — the number a marksman reads. */
    function rangeUnderCrosshair() {
      aimDirection(S.v4, true);
      let t = 0;
      for (let i = 0; i < 110; i++) {
        t += 11;
        const x = camera.position.x + S.v4.x * t;
        const y = camera.position.y + S.v4.y * t;
        const z = camera.position.z + S.v4.z * t;
        if (y < heightAt(x, z)) return t;
        if (t > 1200) break;
      }
      return null;
    }

    function fmtTime(s) {
      const m = Math.floor(Math.max(0, s) / 60);
      const ss = Math.floor(Math.max(0, s) % 60);
      return m + ":" + (ss < 10 ? "0" : "") + ss;
    }

    let hudBuilt = false;
    function buildHud() {
      const i = sa();
      H.hud.innerHTML = `
        <div style="position:absolute;top:${i.top + 12}px;left:${i.left + 14}px">
          <div class="ls-big" id="h_score">0</div>
          <div class="ls-dim" id="h_acc">0 shots</div>
        </div>
        <div style="position:absolute;top:${i.top + 12}px;left:50%;transform:translateX(-50%);text-align:center">
          <div class="ls-big" id="h_time">5:00</div>
        </div>
        <div style="position:absolute;top:${i.top + 12}px;right:${i.right + 14}px;text-align:right">
          <div class="ls-big ls-dim" id="h_rng">—</div>
          <div class="ls-dim" id="h_rifle"></div>
        </div>
        <div style="position:absolute;bottom:${i.bottom + 150}px;left:${i.left + 14}px">
          <div class="ls-big" id="h_ammo">5 / 5</div>
          <div class="ls-dim" style="font-size:11px">breath</div>
          <div style="width:118px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;overflow:hidden;margin-top:4px">
            <div id="h_breath" style="height:100%;width:100%;background:#7fd2ff"></div>
          </div>
        </div>
        <div style="position:absolute;bottom:${i.bottom + 14}px;right:${i.right + 12}px;display:flex;gap:8px;align-items:flex-end">
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            <div style="display:flex;gap:8px">
              <div class="ls-btn" id="b_gun" style="font-size:11px">GUN</div>
              <div class="ls-btn" id="b_reload" style="font-size:11px">RELOAD</div>
            </div>
            <div style="display:flex;gap:8px">
              <div class="ls-btn" id="b_crouch" style="font-size:11px">CROUCH</div>
              <div class="ls-btn" id="b_breath" style="font-size:11px">HOLD</div>
              <div class="ls-btn" id="b_scope" style="font-size:11px">SCOPE</div>
            </div>
          </div>
          <div class="ls-btn" id="b_fire" style="min-width:80px;min-height:80px;border-radius:50%">FIRE</div>
        </div>`;
      const on = (id, fn, hold) => {
        const el = root.querySelector(id);
        if (!el) return;
        ctx.listen(el, "pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); firstGesture(); fn(true); }, { passive: false });
        if (hold) {
          ctx.listen(el, "pointerup", (e) => { e.preventDefault(); e.stopPropagation(); fn(false); }, { passive: false });
          ctx.listen(el, "pointercancel", () => fn(false), { passive: true });
          ctx.listen(el, "pointerleave", () => fn(false), { passive: true });
        }
      };
      on("#b_fire", (d) => { if (d) { input.firePressed = true; input.fire = true; } else input.fire = false; }, true);
      on("#b_scope", (d) => { if (d) { player.scoped = !player.scoped; root.querySelector("#b_scope").classList.toggle("on", player.scoped); } });
      on("#b_crouch", (d) => { if (d) { player.wantCrouch = !player.wantCrouch; root.querySelector("#b_crouch").classList.toggle("on", player.wantCrouch); } });
      on("#b_reload", (d) => { if (d) reload(); });
      on("#b_gun", (d) => { if (d) cycleRifle(1); });
      on("#b_breath", (d) => { player.holdingBreath = d; root.querySelector("#b_breath").classList.toggle("on", d); }, true);
      hudBuilt = true;
    }

    function syncHud() {
      if (!hudBuilt) return;
      const r = currentRifle();
      const q = (id) => root.querySelector(id);
      const score = q("#h_score"), ammo = q("#h_ammo"), rifle = q("#h_rifle"), acc = q("#h_acc");
      if (score) score.textContent = run.score.toLocaleString();
      if (acc) {
        const a = run.shots ? Math.round((run.hits / run.shots) * 100) : 0;
        acc.textContent = `${run.shots} shots · ${a}% · best ${Math.round(run.longest)} m`;
      }
      if (ammo) {
        ammo.textContent = player.reloadT > 0 ? "reloading" : `${player.ammo} / ${r.mag}`;
        ammo.className = "ls-big" + (player.ammo === 0 && player.reloadT <= 0 ? " ls-warn" : "");
      }
      if (rifle) rifle.textContent = `${r.name} · ${r.zoom}x`;
    }

    /* ================================================================ *
     * 13. SCREENS
     * ================================================================ */
    function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

    function bindScreen() {
      for (const el of H.screen.querySelectorAll("[data-act]")) {
        ctx.listen(el, "pointerdown", (e) => {
          e.preventDefault(); e.stopPropagation();
          firstGesture();
          const a = el.getAttribute("data-act");
          if (a === "start") startRun();
          else if (a === "help") showHelp();
          else if (a === "title") showTitle();
          else if (a === "again") startRun();
          else if (a.indexOf("map:") === 0) { game.mapIndex = +a.slice(4); showTitle(); }
          else if (a === "sfx") { sfxOn = !sfxOn; saveSettings(); showTitle(); }
          else if (a === "hap") { hapticsOn = !hapticsOn; saveSettings(); showTitle(); }
        }, { passive: false });
      }
    }

    function showTitle() {
      game.screen = "title";
      const m = MAPS[game.mapIndex];
      H.screen.innerHTML = `
        <div class="ls-panel">
          <div class="ls-h1">LONGSHOT</div>
          <div class="ls-dim" style="margin-bottom:14px">A marksman hunt. Range is the whole game.</div>
          <div style="display:flex;gap:7px;margin-bottom:10px">
            ${MAPS.map((mm, i) => `<div class="ls-btn ls-mapbtn ${i === game.mapIndex ? "on" : ""}" data-act="map:${i}" style="font-size:11px">${esc(mm.name.split(" ")[0].toUpperCase())}</div>`).join("")}
          </div>
          <div class="ls-dim" style="margin-bottom:12px">${esc(m.blurb)}</div>
          <div class="ls-sep"></div>
          <div class="ls-row"><span class="ls-dim">best</span><span>${career.best.toLocaleString()}</span></div>
          <div class="ls-row"><span class="ls-dim">career</span><span>${career.points.toLocaleString()} pts · ${career.runs} hunts</span></div>
          <div class="ls-row"><span class="ls-dim">rifles</span><span>${RIFLES.filter((r, i) => rifleUnlocked(i)).length} of ${RIFLES.length}</span></div>
          <div class="ls-sep"></div>
          <div style="display:flex;gap:8px">
            <div class="ls-btn" data-act="start" style="flex:2;min-height:48px">START HUNT</div>
            <div class="ls-btn" data-act="help" style="flex:1">HOW</div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <div class="ls-btn ${sfxOn ? "on" : ""}" data-act="sfx" style="flex:1;font-size:11px">SOUND ${sfxOn ? "ON" : "OFF"}</div>
            <div class="ls-btn ${hapticsOn ? "on" : ""}" data-act="hap" style="flex:1;font-size:11px">HAPTICS ${hapticsOn ? "ON" : "OFF"}</div>
          </div>
        </div>`;
      bindScreen();
      H.hud.style.display = "none";
    }

    function showHelp() {
      game.screen = "help";
      H.screen.innerHTML = `
        <div class="ls-panel">
          <div class="ls-h1" style="font-size:20px">HOW TO PLAY</div>
          <div class="ls-sep"></div>
          <div class="ls-row"><span class="ls-dim">move</span><span>drag the left of the screen</span></div>
          <div class="ls-row"><span class="ls-dim">look</span><span>drag anywhere else</span></div>
          <div class="ls-row"><span class="ls-dim">shoot</span><span>FIRE, or tap while scoped</span></div>
          <div class="ls-sep"></div>
          <div style="margin-bottom:8px">Your round takes time to arrive and falls on the way.
          Rifles are zeroed at 200 m — past that, hold over using the mil-dots below the crosshair,
          and lead anything that is running.</div>
          <div style="margin-bottom:8px">Animals notice you by how close you are, how fast you are
          moving, and how badly the scrub is hiding you. <b>Crouch in a bush and stop</b> and a cheetah
          at 200 m will never know.</div>
          <div style="margin-bottom:8px">HOLD steadies the sight for a few seconds. Score is species
          value × hit zone × range, so a head shot at 500 m is worth more than ten easy ones.</div>
          <div class="ls-sep"></div>
          <div class="ls-row"><span class="ls-dim">warthog / zebra</span><span>25 · 50</span></div>
          <div class="ls-row"><span class="ls-dim">gazelle / ostrich</span><span>120 · 150</span></div>
          <div class="ls-row"><span class="ls-dim">leopard / cheetah</span><span>400 · 800</span></div>
          <div class="ls-sep"></div>
          <div class="ls-btn" data-act="title" style="min-height:46px">BACK</div>
        </div>`;
      bindScreen();
    }

    function showOver() {
      game.screen = "over";
      const acc = run.shots ? Math.round((run.hits / run.shots) * 100) : 0;
      const taken = Object.keys(run.taken).map((k) => `${SPECIES[k].name} ×${run.taken[k]}`).join(", ") || "nothing";
      H.screen.innerHTML = `
        <div class="ls-panel">
          <div class="ls-h1" style="font-size:22px">HUNT OVER</div>
          <div class="ls-sep"></div>
          <div class="ls-row"><span class="ls-dim">score</span><span class="ls-big">${run.score.toLocaleString()}</span></div>
          <div class="ls-row"><span class="ls-dim">best</span><span>${career.best.toLocaleString()}</span></div>
          <div class="ls-row"><span class="ls-dim">accuracy</span><span>${run.hits}/${run.shots} · ${acc}%</span></div>
          <div class="ls-row"><span class="ls-dim">longest shot</span><span>${Math.round(run.longest)} m</span></div>
          <div class="ls-row"><span class="ls-dim">head shots</span><span>${run.headshots}</span></div>
          <div class="ls-row"><span class="ls-dim">trophies</span><span>${run.trophies}</span></div>
          <div class="ls-sep"></div>
          <div class="ls-dim" style="margin-bottom:12px">${esc(taken)}</div>
          <div style="display:flex;gap:8px">
            <div class="ls-btn" data-act="again" style="flex:2;min-height:48px">HUNT AGAIN</div>
            <div class="ls-btn" data-act="title" style="flex:1">MENU</div>
          </div>
          ${run.score > 0 ? '<div class="ls-dim" style="margin-top:10px;font-size:11px">score sent to the leaderboard</div>' : ""}
        </div>`;
      bindScreen();
      H.hud.style.display = "none";
    }

    /* ================================================================ *
     * 14. STORAGE AND LEADERBOARD
     * ================================================================ */
    const canStore = () => !!(ctx.capabilities && ctx.capabilities.storage);

    async function loadSaved() {
      if (!canStore()) return;
      try {
        const c = await ctx.storage.get("career");
        if (c && typeof c === "object") {
          career.points = Math.max(0, Math.floor(c.points || 0));
          career.best = Math.max(0, Math.floor(c.best || 0));
          career.runs = Math.max(0, Math.floor(c.runs || 0));
        }
      } catch (err) { /* denied */ }
      try {
        const s = await ctx.storage.get("settings");
        if (s && typeof s === "object") {
          if (typeof s.sfxOn === "boolean") sfxOn = s.sfxOn;
          if (typeof s.hapticsOn === "boolean") hapticsOn = s.hapticsOn;
          if (typeof s.lookSens === "number") lookSens = clamp(s.lookSens, 0.4, 2.5);
          if (typeof s.mapIndex === "number") game.mapIndex = clamp(s.mapIndex | 0, 0, MAPS.length - 1);
        }
      } catch (err) { /* denied */ }
    }
    async function saveCareer() {
      if (!canStore()) return;
      try { await ctx.storage.set("career", { points: career.points, best: career.best, runs: career.runs }); }
      catch (err) { /* denied */ }
    }
    async function saveSettings() {
      if (!canStore()) return;
      try { await ctx.storage.set("settings", { sfxOn, hapticsOn, lookSens, mapIndex: game.mapIndex }); }
      catch (err) { /* denied */ }
    }
    async function submitScore() {
      if (run.score <= 0) return;
      try { await ctx.memory.record("score").submit(run.score, { label: run.score.toLocaleString() + " pts" }); }
      catch (err) { ctx.platform.error({ where: "record_submit" }); }
    }

    /* ================================================================ *
     * 15. RUN CONTROL
     * ================================================================ */
    let started = false;
    function firstGesture() {
      resumeAudioCtx();
      if (!started) { started = true; ctx.platform.start(); }
    }
    function resumeAudioCtx() {
      const ac = audioReady();
      if (ac && ac.state === "suspended") ac.resume().catch(() => {});
    }

    function startRun() {
      if (game.mapIndex !== builtMapIndex) buildWorld(game.mapIndex);
      resetRun();
      game.screen = "play";
      player.rifleIdx = 0;
      player.ammo = RIFLES[0].mag;
      player.reloadT = 0; player.cycleT = 0;
      player.scoped = false; player.scopeT = 0;
      player.breath = 1; player.holdingBreath = false;
      player.wantCrouch = false; player.crouch = 0;
      buildViewmodel();
      // Drop the player on the highest ground within reach, so the first thing
      // they see is a view worth having a rifle for.
      // A vantage, not the summit. The highest point on the map looks down at
      // its own bare slope; a shoulder two thirds up sees across the flats.
      const cand = [];
      for (let i = 0; i < 420; i++) {
        const a = (i / 420) * TAU * 9, r = 40 + (i / 420) * (PLAY_RADIUS - 80);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (slopeAt(x, z) > 0.26) continue;
        cand.push({ x, z, h: heightAt(x, z) });
      }
      cand.sort((p, q) => q.h - p.h);
      const best = cand.length ? cand[Math.min(cand.length - 1, Math.floor(cand.length * 0.18))] : null;
      player.x = best ? best.x : 0;
      player.z = best ? best.z : 0;
      player.y = heightAt(player.x, player.z);
      player.yaw = Math.atan2(-player.x, -player.z);
      player.pitch = -0.06;
      for (const t of targets) despawn(t);
      for (let i = 0; i < 7; i++) spawnHerd();
      bullets.forEach((b) => { b.alive = false; });
      pops.length = 0;
      H.screen.innerHTML = "";
      H.hud.style.display = "";
      if (!hudBuilt) buildHud();
      syncHud();
      sfx.start();
      ctx.platform.setScore(0);
      ctx.platform.emit("run_start", { map: MAPS[game.mapIndex].id });
      bus.emit("run:start", { map: MAPS[game.mapIndex].id });
    }

    function endRun() {
      game.screen = "over";
      player.scoped = false;
      player.scopeT = 0;
      player.holdingBreath = false;
      career.runs++;
      career.points += run.score;
      if (run.score > career.best) career.best = run.score;
      saveCareer();
      saveSettings();
      sfx.end();
      ctx.platform.setScore(run.score);
      ctx.platform.complete({ score: run.score, hits: run.hits, shots: run.shots, map: MAPS[game.mapIndex].id });
      submitScore();
      bus.emit("run:end", { score: run.score, hits: run.hits, shots: run.shots });
      showOver();
    }

    /* ================================================================ *
     * 16. WORLD ASSEMBLY
     * Building a reserve is a few hundred milliseconds, so it happens on
     * map change rather than every run. Everything it allocates is tracked
     * and freed before the next one is built.
     * ================================================================ */
    let builtMapIndex = -1;
    let worldOwned = [];

    function disposeWorld() {
      for (const o of worldOwned) { try { o.dispose(); } catch (e) { /* gone */ } }
      worldOwned = [];
      const kill = (m) => { if (m) { m.parent && m.parent.remove(m); } };
      while (worldGroup.children.length) worldGroup.remove(worldGroup.children[0]);
      kill(skyMesh); kill(sunDisc); kill(sunGlow);
      skyMesh = sunDisc = sunGlow = null;
      terrainMesh = waterMesh = mountainMesh = null;
      if (cloudMesh) { scene.remove(cloudMesh); cloudMesh = null; }
      props.length = 0;
      covers.length = 0;
      blockers.length = 0;
      for (const t of targets) { t.group.parent && t.group.parent.remove(t.group); }
      targets.length = 0;
      if (animalShade) { animalShade.parent && animalShade.parent.remove(animalShade); animalShade = null; }
      for (const k in speciesRig) delete speciesRig[k];
    }

    function buildWorld(index) {
      if (builtMapIndex >= 0) disposeWorld();
      game.mapIndex = clamp(index | 0, 0, MAPS.length - 1);
      map = MAPS[game.mapIndex];
      // One seed per reserve, so a map is the same reserve every time.
      rng = makeRng(0x51f7 + game.mapIndex * 7919);
      noise = makeNoise(rng);
      const s = map.sun;
      sunDirection(sunDir);
      sun.position.copy(sunDir).multiplyScalar(300);
      sun.color.setHex(s.color);
      sun.intensity = s.intensity;
      rim.position.set(-sunDir.x * 200, 80, -sunDir.z * 200);
      rim.color.setHex(map.sky.mid);
      hemi.color.setHex(map.sky.mid);
      hemi.groundColor.setHex(map.ground.dirt);
      overlaySun.color.setHex(s.color);
      overlaySun.position.set(1.4, 2.2, 1.8);
      overlayHemi.color.setHex(map.sky.mid);
      scene.fog = new THREE.FogExp2(map.sky.haze, map.fogDensity);
      scene.background = new THREE.Color(map.sky.horizon);

      buildTerrain();
      buildSky();
      buildSun();
      buildMountains();
      buildClouds();
      buildWater();
      buildScatter();
      buildTargetPool();
      builtMapIndex = game.mapIndex;
    }

    /* ================================================================ *
     * 17. FRAME
     * ================================================================ */
    let lastW = 0, lastH = 0;

    function resize() {
      lastW = ctx.width; lastH = ctx.height;
      applyPixelRatio();
      renderer.setSize(ctx.width, ctx.height, false);
      camera.aspect = ctx.width / Math.max(1, ctx.height);
      camera.updateProjectionMatrix();
      overlayCamera.aspect = camera.aspect;
      overlayCamera.updateProjectionMatrix();
      if (hudBuilt) { buildHud(); syncHud(); }
    }

    function render() {
      // autoClear must be OFF for the second pass, or render() clears the
      // COLOUR buffer too and the world vanishes behind the rifle.
      renderer.autoClear = true;
      renderer.render(scene, camera);
      if (game.screen === "play" && vmGroup && vmGroup.visible) {
        renderer.autoClear = false;
        renderer.clearDepth();
        overlayCamera.quaternion.copy(camera.quaternion);
        renderer.render(overlayScene, overlayCamera);
        renderer.autoClear = true;
      }
    }

    let hudTick = 0, lastWholeSecond = -1;

    function updateHudLive(dt) {
      if (flashTimer > 0) {
        flashTimer -= dt;
        if (flashTimer <= 0) H.flash.style.opacity = "0";
      }
      const playing = game.screen === "play";
      H.scope.style.opacity = playing ? player.scopeT.toFixed(3) : "0";
      H.ret.style.display = playing ? "" : "none";
      if (playing) drawReticle(player.scopeT > 0.5);
      if (!playing) { H.pops.innerHTML = ""; return; }

      hudTick -= dt;
      if (hudTick <= 0) {
        hudTick = 0.1;
        const q = (id) => root.querySelector(id);
        const br = q("#h_breath"); if (br) br.style.width = (player.breath * 100).toFixed(0) + "%";
        const rg = q("#h_rng");
        if (rg) {
          const d = rangeUnderCrosshair();
          rg.textContent = d ? `${Math.round(d / 5) * 5} m` : "—";
        }
        const tm = q("#h_time");
        if (tm) {
          tm.textContent = fmtTime(run.timeLeft);
          tm.className = "ls-big" + (run.timeLeft < 30 ? " ls-warn" : "");
        }
      }
      const whole = Math.ceil(run.timeLeft);
      if (whole <= 5 && whole !== lastWholeSecond && whole > 0) { lastWholeSecond = whole; sfx.tick(); }

      // Score pops, projected from world space each frame.
      const host = H.pops;
      while (host.childElementCount > pops.length) host.lastChild.remove();
      while (host.childElementCount < pops.length) {
        const d = document.createElement("div");
        d.className = "ls-pop";
        host.appendChild(d);
      }
      for (let i = 0; i < pops.length; i++) {
        const o = pops[i], el = host.children[i];
        S.v1.set(o.x, o.y + 0.4 + o.t * 0.8, o.z).project(camera);
        if (S.v1.z > 1) { el.style.display = "none"; continue; }
        el.style.display = "";
        el.style.left = ((S.v1.x * 0.5 + 0.5) * 100) + "%";
        el.style.top = ((-S.v1.y * 0.5 + 0.5) * 100) + "%";
        el.style.opacity = String(Math.max(0, 1 - o.t / 1.9));
        el.style.color = o.zone === "head" ? "#ffd86b" : "#eaf2fb";
        el.innerHTML = `+${o.points}<br><span style="font-size:11px;opacity:.75">${esc(o.name)} · ${Math.round(o.dist)} m${o.zone === "head" ? " · HEAD" : ""}</span>`;
      }
    }

    function frame(dtMs, timeMs) {
      const dt = Math.min((dtMs || 16) / 1000, 0.05);
      clock.dt = dt;
      clock.t += dt;
      clock.frame++;
      if (ctx.width !== lastW || ctx.height !== lastH) resize();

      if (game.screen === "play") {
        updatePlayer(dt);
        updateTargets(dt);
        updateBullets(dt);
        run.timeLeft -= dt;
        if (run.timeLeft <= 0) { run.timeLeft = 0; endRun(); }
      } else {
        // Menus get a slow drift over the reserve rather than a frozen frame.
        player.yaw += dt * 0.045;
        updateTargets(dt);
        applyCamera(dt);
      }
      updateFx(dt);
      updateViewmodel(dt);
      updateHudLive(dt);
      render();
    }

    /* ================================================================ *
     * 18. BOOT
     * ================================================================ */
    await loadSaved();
    buildFx();
    buildTracers();
    buildWorld(game.mapIndex);

    // Park the camera somewhere photogenic for the title screen.
    player.x = 0; player.z = 0;
    player.y = heightAt(0, 0);
    player.yaw = 0.6;
    player.pitch = -0.05;
    for (let i = 0; i < 5; i++) spawnHerd();
    resize();
    buildViewmodel();
    if (vmGroup) vmGroup.visible = false;
    showTitle();
    applyCamera(0);
    render();

    ctx.markVisualReady("title");
    ctx.onFrame(frame);
    ctx.platform.ready({ title: "Longshot" });
  }
};
