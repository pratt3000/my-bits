/*
 * Still Water — a horror crawl through drowned baths.
 *
 * It cannot see you. It hears the water.
 *
 * You wake in a maze of night-time pool halls. Something long and pale
 * lives in the water, and it is blind: on dry tiles you make no sound it
 * can follow, but every step you wade sends ripples it can hear. Scavenge
 * spring coils for jump boots, then the parts of a bazooka and its
 * rockets, lure the thing with a rubber duck, and kill it when it
 * surfaces -- before it finds you first.
 *
 * Packaged assets are disabled, so everything here is generated: the
 * maze, every tile (in a shader), the water and its caustics, the
 * creature, the lights and every sound. Three.js comes from the
 * Plethora library registry.
 */

window.plethoraBit = {
  meta: {
    title: "Still Water",
    runtime: "plethora-bit@2",
    tags: ["horror", "3d", "stealth", "survival", "maze", "first-person", "atmospheric", "leaderboard", "backrooms", "creature"],
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
    const tChoice = (id, fb) => (tune.choice ? tune.choice(id) : undefined) ?? fb;

    const MOOD = tChoice("mood", "night");
    const MAP_SIZE = tChoice("map_size", "medium");
    const HUNT_SPEED = tNum("creature_speed", 4.3);
    const HEARING = tNum("hearing_range", 15);
    const ROCKETS = tInt("rockets", 5);
    const CREATURE_HP = tInt("creature_hp", 3);
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

    /* ================================================================ *
     * MOODS
     * The same baths under three lights. Night is the game; dawn and the
     * abyss are there for creators who want a different film.
     * ================================================================ */
    const MOODS = {
      night: {
        fog: "#071117", fogDensity: 0.052,
        ambHi: "#16242c", ambLo: "#040607",
        tileA: "#dfeceb", tileB: "#b5d6d6", grout: "#5c7a80",
        bandA: "#1f6c76", bandB: "#2a8790", bandLine: "#0c3a44",
        floorA: "#eadcc4", floorB: "#d6c3a4",
        poolA: "#2f93a1", poolB: "#3eabb3", lane: "#0f3550",
        ceilA: "#262d31", ceilB: "#1e2427",
        coping: "#e6ddcc",
        waterDeep: "#01161b", waterShallow: "#0b5d66", waterTint: "#06353c",
        sky0: "#0d2328", sky1: "#05090c",
        warm: "#ffa84f", warmI: 2.5, warmR: 3.6,
        pool: "#2ef0d2", poolI: 1.15, poolR: 2.3,
        moon: "#9fbcff", moonI: 2.2, moonR: 7.5,
        strip: "#cfe8ff", stripI: 1.4, stripR: 3.2,
        caustic: "#8ff8ec", causticI: 0.9,
        skyTop: "#02040b", skyHorizon: "#0f2036",
        exposure: 1.05
      },
      dawn: {
        fog: "#a2978b", fogDensity: 0.045,
        ambHi: "#9d9386", ambLo: "#3d3732",
        tileA: "#ebe3d6", tileB: "#ddcfbb", grout: "#a8977f",
        bandA: "#7fb8ae", bandB: "#94c7bc", bandLine: "#4f8a84",
        floorA: "#f3e3cc", floorB: "#e8cfae",
        poolA: "#7cc8bd", poolB: "#8fd3c6", lane: "#3f7f83",
        ceilA: "#e9dccb", ceilB: "#ded0bf",
        coping: "#fbf5ea",
        waterDeep: "#2f7f78", waterShallow: "#7fc9b0", waterTint: "#5fae9c",
        sky0: "#8a7d71", sky1: "#b49d89",
        warm: "#ffd2a8", warmI: 1.1, warmR: 3.8,
        pool: "#b9fff0", poolI: 0.5, poolR: 2.6,
        moon: "#fff1dc", moonI: 1.9, moonR: 8.0,
        strip: "#fff4e6", stripI: 1.0, stripR: 3.4,
        caustic: "#fffbe8", causticI: 0.55,
        skyTop: "#bcd7ee", skyHorizon: "#ffe4cc",
        exposure: 0.9, moonGlow: 0.12
      },
      abyss: {
        fog: "#020509", fogDensity: 0.06,
        ambHi: "#131b26", ambLo: "#030406",
        tileA: "#3c4656", tileB: "#2c3542", grout: "#10141b",
        bandA: "#1c2a3a", bandB: "#243649", bandLine: "#0b1119",
        floorA: "#4a4640", floorB: "#3a3631",
        poolA: "#0f2a3a", poolB: "#16364a", lane: "#05121c",
        ceilA: "#0e1217", ceilB: "#0a0d11",
        coping: "#6b6a66",
        waterDeep: "#000305", waterShallow: "#03141c", waterTint: "#020d13",
        sky0: "#010204", sky1: "#04101c",
        warm: "#ff8a3d", warmI: 2.6, warmR: 3.2,
        pool: "#1fc8ff", poolI: 1.25, poolR: 2.2,
        moon: "#6f8fff", moonI: 1.6, moonR: 7.0,
        strip: "#7fb6ff", stripI: 0.9, stripR: 2.8,
        caustic: "#3ff0ff", causticI: 1.1,
        skyTop: "#000104", skyHorizon: "#040b1a",
        exposure: 1.15
      }
    };
    const PAL = MOODS[MOOD] || MOODS.night;

    /* ================================================================ *
     * THE MAP
     * The baths are a grid of 2 m cells. Each cell is a wall, a flooded
     * floor or a dry tiled platform at some height. Rooms are rectangles
     * joined by corridors in a loose graph with loops, so there is never
     * a single path; each room is then dressed by a style that decides
     * where the dry footing is.
     * ================================================================ */
    const CELL = 2;
    const T_WALL = 0, T_WATER = 1, T_DRY = 2;
    const POOL_Y = -0.9;      // the floor under the water
    const WALK_Y = 0.2;       // ordinary dry footing, just proud of the water
    const DAIS_Y = 0.55;      // a court's raised centre
    const HIGH_Y = 2.2;       // a shelf only spring boots reach
    const SIZES = { small: { size: 34, rooms: 8 }, medium: { size: 40, rooms: 11 }, large: { size: 48, rooms: 15 } };

    function generateMap(seed) {
      const S = SIZES[MAP_SIZE] || SIZES.medium;
      const rng = mulberry32(seed);
      const rnd = (a, b) => a + rng() * (b - a);
      const rint = (a, b) => Math.floor(rnd(a, b + 1));
      const pick = arr => arr[Math.floor(rng() * arr.length)];
      const W = S.size, H = S.size;
      const type = new Uint8Array(W * H);
      const top = new Float32Array(W * H);
      const ceil = new Float32Array(W * H);
      const zone = new Int16Array(W * H).fill(-1);
      const idx = (x, z) => z * W + x;
      const inside = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
      const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

      /* ---- rooms ---- */
      const rooms = [];
      for (let tries = 0; rooms.length < S.rooms && tries < 6000; tries++) {
        const big = rooms.length < 3 || rng() < 0.3;
        const w = big ? rint(8, 12) : rint(5, 9), h = big ? rint(8, 12) : rint(5, 9);
        const x = rint(1, W - w - 2), z = rint(1, H - h - 2);
        let ok = true;
        for (const r of rooms) {
          if (x < r.x + r.w + 3 && x + w + 3 > r.x && z < r.z + r.h + 3 && z + h + 3 > r.z) { ok = false; break; }
        }
        if (ok) rooms.push({ id: rooms.length, x, z, w, h, cx: x + w / 2, cz: z + h / 2 });
      }

      /* ---- a spanning tree, then loops, so there is always another way round ---- */
      const edges = [];
      const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cz - b.cz);
      const tree = new Set([0]);
      while (tree.size < rooms.length) {
        let best = null;
        for (const a of tree) for (const b of rooms) {
          if (tree.has(b.id)) continue;
          const d = dist(rooms[a], b);
          if (!best || d < best.d) best = { a, b: b.id, d };
        }
        edges.push([best.a, best.b]);
        tree.add(best.b);
      }
      for (const a of rooms) {
        const near = rooms.filter(b => b !== a).sort((p, q) => dist(a, p) - dist(a, q));
        for (const b of near.slice(0, 3)) {
          if (edges.some(([p, q]) => (p === a.id && q === b.id) || (p === b.id && q === a.id))) continue;
          if (rng() < 0.42) edges.push([a.id, b.id]);
        }
      }

      /* ---- carve ---- */
      for (const r of rooms) {
        r.ceil = r.w >= 8 || r.h >= 8 ? rnd(6.2, 7.6) : rnd(4.8, 5.8);
        for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) {
          const i = idx(x, z);
          type[i] = T_WATER; top[i] = POOL_Y; ceil[i] = r.ceil; zone[i] = r.id;
        }
      }
      const corridors = [];
      for (const [ai, bi] of edges) {
        const a = rooms[ai], b = rooms[bi];
        const ax = Math.floor(a.cx), az = Math.floor(a.cz), bx = Math.floor(b.cx), bz = Math.floor(b.cz);
        const wide = rng() < 0.35 ? 2 : 1;
        const dry = rng() < 0.32;
        const horizFirst = rng() < 0.5;
        const path = [];
        if (horizFirst) {
          for (let x = ax; x !== bx; x += Math.sign(bx - ax)) path.push([x, az]);
          for (let z = az; z !== bz; z += Math.sign(bz - az)) path.push([bx, z]);
        } else {
          for (let z = az; z !== bz; z += Math.sign(bz - az)) path.push([ax, z]);
          for (let x = ax; x !== bx; x += Math.sign(bx - ax)) path.push([x, bz]);
        }
        path.push([bx, bz]);
        const cells = [];
        for (const [x, z] of path) {
          for (let k = 0; k < wide; k++) {
            const cx = x + (horizFirst ? 0 : k), cz = z + (horizFirst ? k : 0);
            if (cx < 1 || cz < 1 || cx >= W - 1 || cz >= H - 1) continue;
            const i = idx(cx, cz);
            if (zone[i] >= 0 || type[i] !== T_WALL) continue;
            type[i] = dry ? T_DRY : T_WATER;
            top[i] = dry ? WALK_Y : POOL_Y;
            ceil[i] = 3.4;
            zone[i] = -2;
            cells.push(i);
          }
        }
        corridors.push({ a: ai, b: bi, dry, cells });
      }

      /* ---- dress each room ---- */
      const set = (x, z, t, h) => {
        if (!inside(x, z)) return;
        const i = idx(x, z);
        if (type[i] === T_WALL) return;
        type[i] = t; top[i] = h;
      };
      const STYLES = ["pool", "pool", "hall", "stones", "court", "terrace", "pool", "stones", "hall"];
      // Every map gets the whole cast before chance fills the rest: two
      // terraces (their shelves hold parts only boots can reach), stones,
      // a court, pools, halls, and a second dry room to catch a breath in.
      const cast = ["terrace", "terrace", "stones", "pool", "hall", "court", "pool", "dry", "stones"];
      for (let k = cast.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [cast[k], cast[j]] = [cast[j], cast[k]]; }
      rooms.forEach((r, n) => {
        r.style = n === 0 ? "dry" : (n - 1 < cast.length ? cast[n - 1] : pick(STYLES));
        const x0 = r.x, z0 = r.z, x1 = r.x + r.w - 1, z1 = r.z + r.h - 1;
        const walkways = () => {
          const sides = [];
          for (const s of ["n", "s", "e", "w"]) if (rng() < 0.55) sides.push(s);
          if (!sides.length) sides.push(pick(["n", "s", "e", "w"]));
          for (const s of sides) {
            if (s === "n") for (let x = x0; x <= x1; x++) set(x, z0, T_DRY, WALK_Y);
            if (s === "s") for (let x = x0; x <= x1; x++) set(x, z1, T_DRY, WALK_Y);
            if (s === "w") for (let z = z0; z <= z1; z++) set(x0, z, T_DRY, WALK_Y);
            if (s === "e") for (let z = z0; z <= z1; z++) set(x1, z, T_DRY, WALK_Y);
          }
          return sides;
        };
        if (r.style === "dry") {
          for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, T_DRY, WALK_Y);
          if (r.w >= 6 && r.h >= 6) {
            const px = Math.floor(r.cx) - 1, pz = Math.floor(r.cz) - 1;
            for (let z = pz; z < pz + 2; z++) for (let x = px; x < px + 2; x++) set(x, z, T_WATER, POOL_Y);
          }
        } else if (r.style === "pool") {
          walkways();
          if (r.w >= 7 && r.h >= 7) {
            const iw = rint(2, 3), ih = rint(2, 3);
            const ix = Math.floor(r.cx - iw / 2), iz = Math.floor(r.cz - ih / 2);
            for (let z = iz; z < iz + ih; z++) for (let x = ix; x < ix + iw; x++) set(x, z, T_DRY, WALK_Y);
            r.island = { x: ix, z: iz, w: iw, h: ih };
            const dir = pick(N4);
            let sx = ix + (dir[0] > 0 ? iw - 1 : dir[0] < 0 ? 0 : Math.floor(iw / 2));
            let sz = iz + (dir[1] > 0 ? ih - 1 : dir[1] < 0 ? 0 : Math.floor(ih / 2));
            for (let k = 1; k < 9; k++) {
              sx += dir[0]; sz += dir[1];
              if (sx <= x0 || sz <= z0 || sx >= x1 || sz >= z1) break;
              if (k % 2 === 0) set(sx, sz, T_DRY, WALK_Y);
            }
          }
        } else if (r.style === "hall") {
          const alongX = r.w >= r.h;
          if (alongX) { for (let x = x0; x <= x1; x++) { set(x, z0, T_DRY, WALK_Y); set(x, z1, T_DRY, WALK_Y); } }
          else { for (let z = z0; z <= z1; z++) { set(x0, z, T_DRY, WALK_Y); set(x1, z, T_DRY, WALK_Y); } }
          const bridges = rint(1, 2);
          for (let b = 0; b < bridges; b++) {
            if (alongX) { const x = rint(x0 + 1, x1 - 1); for (let z = z0; z <= z1; z++) set(x, z, T_DRY, WALK_Y); }
            else { const z = rint(z0 + 1, z1 - 1); for (let x = x0; x <= x1; x++) set(x, z, T_DRY, WALK_Y); }
          }
          r.alongX = alongX;
        } else if (r.style === "stones") {
          for (let z = z0 + 1; z <= z1 - 1; z++) for (let x = x0 + 1; x <= x1 - 1; x++) {
            if ((x + z) % 2 === 0 && rng() < 0.45) set(x, z, T_DRY, WALK_Y);
          }
          if (rng() < 0.6) walkways();
        } else if (r.style === "court") {
          const dw = Math.max(2, Math.floor(r.w / 2) - 1), dh = Math.max(2, Math.floor(r.h / 2) - 1);
          const dx = Math.floor(r.cx - dw / 2), dz = Math.floor(r.cz - dh / 2);
          for (let z = dz - 1; z <= dz + dh; z++) for (let x = dx - 1; x <= dx + dw; x++) {
            const ring = x < dx || z < dz || x >= dx + dw || z >= dz + dh;
            if (ring && (x + z) % 2 === 0) set(x, z, T_DRY, WALK_Y);
            else if (!ring) set(x, z, T_DRY, DAIS_Y);
          }
          r.dais = { x: dx, z: dz, w: dw, h: dh };
          walkways();
        } else if (r.style === "terrace") {
          const sides = walkways();
          const back = pick(["n", "s", "e", "w"].filter(s => !sides.includes(s)).concat(["n"]));
          const line = (k, h) => {
            if (back === "n") for (let x = x0; x <= x1; x++) set(x, z0 + k, T_DRY, h);
            if (back === "s") for (let x = x0; x <= x1; x++) set(x, z1 - k, T_DRY, h);
            if (back === "w") for (let z = z0; z <= z1; z++) set(x0 + k, z, T_DRY, h);
            if (back === "e") for (let z = z0; z <= z1; z++) set(x1 - k, z, T_DRY, h);
          };
          line(0, HIGH_Y);
          line(1, WALK_Y);
          r.terrace = back;
        }
      });

      /* ---- a dry corridor meeting open water gets a landing ---- */
      for (const c of corridors) {
        if (!c.dry) continue;
        for (const i of c.cells) {
          const x = i % W, z = (i / W) | 0;
          for (const [dx, dz] of N4) {
            if (!inside(x + dx, z + dz)) continue;
            const j = idx(x + dx, z + dz);
            if (zone[j] >= 0 && type[j] === T_WATER && rng() < 0.6) { type[j] = T_DRY; top[j] = WALK_Y; }
          }
        }
      }

      /* ---- a corridor that meets a high shelf cuts a doorway through it ---- */
      for (const c of corridors) {
        for (const i of c.cells) {
          const x = i % W, z = (i / W) | 0;
          for (const [dx, dz] of N4) {
            if (!inside(x + dx, z + dz)) continue;
            const j = idx(x + dx, z + dz);
            if (zone[j] >= 0 && type[j] === T_DRY && top[j] > 1) top[j] = WALK_Y;
          }
        }
      }

      /* ---- bodies of water ---- */
      const body = new Int16Array(W * H).fill(-1);
      const bodies = [];
      for (let i = 0; i < W * H; i++) {
        if (type[i] !== T_WATER || body[i] >= 0) continue;
        const id = bodies.length, cells = [i];
        body[i] = id;
        for (let q = 0; q < cells.length; q++) {
          const c = cells[q], x = c % W, z = (c / W) | 0;
          for (const [dx, dz] of N4) {
            if (!inside(x + dx, z + dz)) continue;
            const j = idx(x + dx, z + dz);
            if (type[j] === T_WATER && body[j] < 0) { body[j] = id; cells.push(j); }
          }
        }
        bodies.push({ id, cells });
      }
      // Every body big enough to matter gets a drain. The thing travels
      // between them through the pipes.
      const drains = [];
      for (const b of bodies) {
        if (b.cells.length < 3) continue;
        const c = b.cells[Math.floor(rng() * b.cells.length)];
        drains.push({ body: b.id, cell: c, x: (c % W + 0.5) * CELL, z: (((c / W) | 0) + 0.5) * CELL });
        b.drain = drains[drains.length - 1];
      }

      return { W, H, type, top, ceil, zone, body, bodies, drains, rooms, corridors, idx, inside, rng, rnd, rint, pick };
    }

    /* ================================================================ *
     * THREE
     * ================================================================ */
    const THREE = await ctx.importModule("three", "0.164.1");

    const canvas = ctx.createCanvas({ touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = PAL.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const col = c => new THREE.Color(c);

    const world = { group: null, lamps: [], materials: [], propMats: [], colliders: [], glowMat: null };
    const followMats = [];       // materials outside the world that also want the nearest lamps
    const scene = new THREE.Scene();
    scene.background = col(PAL.fog);
    const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 140);
    scene.add(camera);

    // Resolution follows the frame rate: start sharp, give pixels back if
    // the phone cannot keep up.
    const gfx = { dpr: Math.min(ctx.dpr || 1, 2), min: 0.85, ema: 16.7, slow: 0, fast: 0, last: 0 };
    function resize() {
      const w = Math.max(1, ctx.width), h = Math.max(1, ctx.height);
      renderer.setPixelRatio(gfx.dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.75 ? 78 : 70;
      camera.updateProjectionMatrix();
      // A glow sprite's size is given in metres; this turns metres at one
      // metre's distance into pixels.
      if (world.glowMat) world.glowMat.uniforms.uScale.value = (h * gfx.dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
    resize();
    ctx.listen(window, "resize", resize);

    /* ================================================================ *
     * SHADERS
     * Every surface in the baths is one tile shader: the tile pattern is
     * computed from world position, so the geometry carries no UVs and
     * no textures are loaded. Lamps are passed per chunk with the room
     * they belong to, so light never leaks through a wall.
     * ================================================================ */
    const MAX_LAMPS = 8;
    const GLSL_COMMON = /* glsl */`
      uniform float uTime;
      uniform vec3 uFogC;
      uniform float uFogD;
      uniform vec4 uLampP[${MAX_LAMPS}];
      uniform vec3 uLampC[${MAX_LAMPS}];
      uniform vec4 uLampB[${MAX_LAMPS}];
      uniform int uLampN;
      uniform sampler2D uMap;
      uniform vec2 uMapSize;

      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      // The well-known tileable water caustic, three iterations.
      float caustic(vec2 p, float t) {
        vec2 i = p;
        float c = 1.0;
        for (int n = 0; n < 3; n++) {
          float tt = t * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
        }
        c /= 3.0;
        c = 1.17 - pow(c, 1.4);
        return clamp(pow(abs(c), 8.0), 0.0, 1.6);
      }
      vec4 cellAt(vec2 xz) { return texture2D(uMap, xz / (2.0 * uMapSize)); }
      // A lamp only lights the room it hangs in, softened at the doors.
      float roomMask(vec4 B, vec3 P) {
        return smoothstep(B.x - 1.1, B.x - 0.2, P.x) * smoothstep(B.y - 1.1, B.y - 0.2, P.z)
             * (1.0 - smoothstep(B.z + 0.2, B.z + 1.1, P.x)) * (1.0 - smoothstep(B.w + 0.2, B.w + 1.1, P.z));
      }
      vec3 fogged(vec3 c, vec3 P) {
        float d = length(cameraPosition - P);
        float f = 1.0 - exp(-uFogD * uFogD * d * d);
        // A low mist hangs on the water.
        float mist = (1.0 - smoothstep(-0.2, 1.4, P.y)) * (1.0 - exp(-d * 0.035)) * 0.45;
        c = mix(c, uFogC, clamp(f + mist * (1.0 - f), 0.0, 1.0));
        // A fine moving film grain, which also dithers the dark gradients.
        float g = hash12(floor(gl_FragCoord.xy) + fract(uTime * 7.31) * 517.0) - 0.5;
        return max(c + g * (0.01 + 0.035 * dot(c, vec3(0.3, 0.55, 0.15))), 0.0);
      }
    `;

    const TILE_VS = /* glsl */`
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vAO;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vAO = color;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `;

    const TILE_FS = /* glsl */`
      ${GLSL_COMMON}
      uniform vec3 uAmbHi, uAmbLo;
      uniform vec3 uTileA, uTileB, uGrout, uBandA, uBandB, uBandLine, uFloorA, uFloorB, uPoolA, uPoolB, uLane, uCeilA, uCeilB;
      uniform vec3 uWaterTint, uCaustC;
      uniform float uCaustI;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vAO;

      void main() {
        vec3 N = normalize(vN);
        vec3 A = abs(N);
        vec3 P = vW;
        float isFloor = step(0.5, N.y), isCeil = step(0.5, -N.y);
        float isWall = 1.0 - isFloor - isCeil;
        vec2 uv = A.y > 0.5 ? P.xz : (A.x > 0.5 ? P.zy : P.xy);

        // ---- which tile, and what colour ----
        float under = step(P.y, -0.02);
        float band = isWall * step(P.y, 1.12) * (1.0 - under);
        float size = 0.3;
        if (band > 0.5) size = 0.15;
        if (under > 0.5) size = 0.25;
        if (isCeil > 0.5) size = 0.6;
        vec2 t = uv / size;
        vec2 id = floor(t), f = fract(t);
        vec2 e = min(f, 1.0 - f);
        float edge = min(e.x, e.y);
        float gw = isCeil > 0.5 ? 0.018 : (isFloor > 0.5 ? 0.032 : 0.042);
        float fw = max(fwidth(t.x), fwidth(t.y));
        float grout = 1.0 - smoothstep(gw - fw * 0.75, gw + fw * 0.75, edge);
        grout *= 1.0 - smoothstep(0.18, 0.45, fw);
        float h = hash12(id + N.xz * 31.7 + vec2(P.y > 0.0 ? 0.0 : 7.0));
        float h2 = hash12(id * 1.37 + 3.1);

        vec3 tile;
        if (isCeil > 0.5) tile = mix(uCeilA, uCeilB, h);
        else if (under > 0.5) {
          tile = mix(uPoolA, uPoolB, step(0.7, h)) * (0.92 + 0.12 * h2);
          // Lane lines on the pool floor.
          if (isFloor > 0.5) {
            float lane = abs(fract(P.x / 4.0) - 0.5);
            tile = mix(tile, uLane, 1.0 - smoothstep(0.05, 0.065, lane));
          }
        } else if (band > 0.5) {
          tile = mix(uBandA, uBandB, step(0.6, h)) * (0.9 + 0.15 * h2);
        } else if (isFloor > 0.5) {
          tile = mix(uFloorA, uFloorB, step(0.72, h)) * (0.93 + 0.1 * h2);
        } else {
          tile = mix(uTileA, uTileB, step(0.82, h)) * (0.94 + 0.08 * h2);
        }
        // A dark stripe where the mosaic band meets the white tiles.
        float stripe = isWall * (1.0 - under) * step(1.12, P.y) * step(P.y, 1.26);
        tile = mix(tile, uBandLine, stripe);
        // The odd stained or chipped tile.
        if (h2 > 0.982) tile *= 0.55;
        vec3 groutC = isCeil > 0.5 ? uCeilB * 0.55 : uGrout;
        vec3 albedo = mix(tile, groutC, grout * (1.0 - stripe));
        // Years of damp: broad blotches, streaks running down the walls,
        // and a tide mark of algae just above the water.
        float blot = vnoise(uv * 0.45) * 0.65 + vnoise(uv * 1.7) * 0.35;
        float streak = isWall * vnoise(vec2(uv.x * 2.3, P.y * 0.12)) * (1.0 - smoothstep(0.0, 5.0, P.y - 1.0));
        albedo *= mix(0.7, 1.06, blot) * (1.0 - streak * 0.22);
        float tide = isWall * (1.0 - under) * (1.0 - smoothstep(0.0, 0.55, P.y)) * (0.55 + 0.45 * vnoise(uv * 3.0));
        albedo = mix(albedo, albedo * vec3(0.55, 0.68, 0.55), tide);

        // ---- each tile is a slightly domed glaze: bend the normal at its rim ----
        vec2 dome = (f - 0.5) * 2.0;
        float rim = smoothstep(0.32, 0.5, max(abs(f.x - 0.5), abs(f.y - 0.5)));
        vec3 Nt = N;
        if (isCeil < 0.5) {
          vec3 tu = A.y > 0.5 ? vec3(1.0, 0.0, 0.0) : (A.x > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
          vec3 tv = A.y > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
          Nt = normalize(N + (tu * dome.x + tv * dome.y) * rim * 0.22);
        }

        // ---- light ----
        vec3 V = normalize(cameraPosition - P);
        vec3 light = mix(uAmbLo, uAmbHi, N.y * 0.5 + 0.5);
        vec3 spec = vec3(0.0);
        float gloss = (1.0 - grout) * (isCeil > 0.5 ? 0.15 : 1.0);
        for (int i = 0; i < ${MAX_LAMPS}; i++) {
          if (i >= uLampN) break;
          vec4 L4 = uLampP[i];
          float m = roomMask(uLampB[i], P);
          if (m <= 0.0) continue;
          vec3 Lv = L4.xyz - P;
          float d2 = dot(Lv, Lv);
          float d = sqrt(d2);
          vec3 L = Lv / d;
          float att = m / (1.0 + d2 / (L4.w * L4.w));
          att *= 1.0 - smoothstep(L4.w * 2.6, L4.w * 3.4, d);
          // Lamps under the water only light what is under the water.
          if (L4.y < 0.0) att *= 1.0 - smoothstep(-0.05, 0.6, P.y);
          float ndl = dot(Nt, L);
          light += uLampC[i] * att * (max(ndl, 0.0) * 0.85 + 0.15 * (ndl * 0.5 + 0.5));
          vec3 Hh = normalize(L + V);
          spec += uLampC[i] * att * pow(max(dot(Nt, Hh), 0.0), 70.0) * gloss * 0.9;
        }

        // ---- caustics: on everything under the water, and thrown up onto
        //      walls and ceilings that stand over it ----
        vec4 here = cellAt(P.xz + N.xz * 0.6);
        float overWater = step(0.3, here.r) * step(here.r, 0.7);
        float cz = 0.0;
        if (under > 0.5 || overWater > 0.5) {
          float k = under > 0.5 ? 1.0 : (isCeil > 0.5 ? 0.55 : 0.45 * (1.0 - smoothstep(0.0, 2.6, P.y)));
          vec2 cp = (isWall > 0.5 ? vec2(dot(P.xz, vec2(N.z, -N.x)), P.y * 0.6) : P.xz) * 0.55;
          cz = caustic(cp, uTime * 0.55) * k;
        }
        light += uCaustC * cz * uCaustI * (0.06 + 0.94 * clamp(length(light) - 0.08, 0.0, 1.5));

        vec3 c = albedo * light * vAO + spec * vAO.r;

        // ---- wet: a dark, shiny band just above the waterline ----
        float wet = (1.0 - under) * (1.0 - smoothstep(0.0, 0.16, P.y));
        c *= 1.0 - wet * 0.35;

        // ---- under the water: absorbed toward the water's own colour ----
        if (under > 0.5) {
          float depth = clamp(-P.y, 0.0, 2.0);
          c = mix(c, uWaterTint * (0.35 + 0.65 * light), clamp(0.28 + depth * 0.3, 0.0, 0.85));
        }

        gl_FragColor = vec4(fogged(c, P), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;

    const WATER_VS = /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `;

    const MAX_RIPPLES = 20;
    const WATER_FS = /* glsl */`
      ${GLSL_COMMON}
      uniform vec4 uRip[${MAX_RIPPLES}];
      uniform vec3 uDeep, uShallow, uSky0, uSky1, uCaustC;
      varying vec3 vW;

      float waves(vec2 p) {
        float t = uTime;
        float h = sin(dot(p, vec2(0.8, 0.6)) * 1.4 + t * 0.9) * 0.008
                + sin(dot(p, vec2(-0.6, 0.8)) * 1.9 + t * 1.1) * 0.006
                + (vnoise(p * 3.1 + vec2(t * 0.35, -t * 0.25)) - 0.5) * 0.0075
                + (vnoise(p * 7.3 - vec2(t * 0.55, t * 0.42)) - 0.5) * 0.0038
                + (vnoise(p * 15.7 + vec2(t * 0.9, t * 0.7)) - 0.5) * 0.0017;
        for (int i = 0; i < ${MAX_RIPPLES}; i++) {
          vec4 r = uRip[i];
          float age = t - r.z;
          if (r.w <= 0.0 || age < 0.0 || age > 5.0) continue;
          float d = distance(p, r.xy);
          float k = d - age * 1.7;
          h += r.w * sin(k * 10.0) * exp(-k * k * 2.6) * exp(-age * 0.95) / (1.0 + d * 1.3);
        }
        return h;
      }

      void main() {
        vec2 p = vW.xz;
        float e = 0.025;
        float h0 = waves(p);
        float hx = waves(p + vec2(e, 0.0));
        float hz = waves(p + vec2(0.0, e));
        vec3 N = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
        vec3 V = normalize(cameraPosition - vW);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);

        // No mirror pass on a phone: the reflection is the room itself in
        // broad strokes -- lit walls near the horizon, dark vault above.
        vec3 refl = mix(uSky0, uSky1, smoothstep(0.05, 0.55, R.y));
        vec3 body = uDeep;
        vec3 spec = vec3(0.0);
        for (int i = 0; i < ${MAX_LAMPS}; i++) {
          if (i >= uLampN) break;
          vec4 L4 = uLampP[i];
          float m = roomMask(uLampB[i], vW);
          if (m <= 0.0) continue;
          vec3 Lv = L4.xyz - vW;
          float d2 = dot(Lv, Lv);
          vec3 L = Lv * inversesqrt(d2);
          float att = m / (1.0 + d2 / (L4.w * L4.w));
          if (L4.y > 0.0) {
            float rl = max(dot(R, L), 0.0);
            spec += uLampC[i] * m * (pow(rl, 1400.0) * 40.0 + pow(rl, 90.0) * 0.9 + pow(rl, 12.0) * 0.05) / (1.0 + d2 * 0.015);
            body += uLampC[i] * att * 0.035;
          } else {
            // A lamp in the pool wall glows up through the water.
            float g = exp(-dot(Lv.xz, Lv.xz) / (L4.w * L4.w * 0.4));
            body += uLampC[i] * (g * 0.15 + att * 0.08);
          }
        }
        // Brighter, greener where the floor comes up to meet the edge.
        vec4 cx1 = cellAt(p + vec2(0.32, 0.0)), cx2 = cellAt(p - vec2(0.32, 0.0));
        vec4 cz1 = cellAt(p + vec2(0.0, 0.32)), cz2 = cellAt(p - vec2(0.0, 0.32));
        float shore = 0.0;
        shore += step(0.7, cx1.r) + step(cx1.r, 0.3);
        shore += step(0.7, cx2.r) + step(cx2.r, 0.3);
        shore += step(0.7, cz1.r) + step(cz1.r, 0.3);
        shore += step(0.7, cz2.r) + step(cz2.r, 0.3);
        shore = clamp(shore, 0.0, 1.0);
        body = mix(body, uShallow * (0.6 + 0.4 * length(body)), shore * 0.35);
        float caus = caustic(p * 0.55, uTime * 0.55);
        body += uCaustC * caus * 0.05;
        // Foam and broken light where the water slaps the tiles.
        float foam = shore * smoothstep(0.6, 0.95, vnoise(p * 11.0 + uTime * 0.6)) * 0.2;

        vec3 c = mix(body, refl, fres) + spec + foam * vec3(0.8, 0.95, 1.0) * 0.25;
        // See into it at your feet; across the pool it is a dark mirror.
        float alpha = clamp(mix(0.74, 0.985, fres) + foam, 0.0, 1.0);
        gl_FragColor = vec4(fogged(c, vW), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;

    /* ---- the map as a texture, so shaders know where the water is ---- */
    let mapTex = null;
    function makeMapTexture(map) {
      const data = new Uint8Array(map.W * map.H * 4);
      for (let i = 0; i < map.W * map.H; i++) {
        data[i * 4] = map.type[i] === T_WALL ? 0 : map.type[i] === T_WATER ? 128 : 255;
        data[i * 4 + 1] = clamp(Math.round((map.top[i] + 1) * 60), 0, 255);
        data[i * 4 + 2] = 0;
        data[i * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, map.W, map.H, THREE.RGBAFormat);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      return tex;
    }

    const shared = {
      uTime: { value: 0 },
      uFogC: { value: col(PAL.fog) },
      uFogD: { value: PAL.fogDensity },
      uMap: { value: null },
      uMapSize: { value: new THREE.Vector2(1, 1) }
    };
    const ripples = [];
    for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -99, 0));
    let rippleNext = 0;
    function addRipple(x, z, amp) {
      const r = ripples[rippleNext];
      r.set(x, z, shared.uTime.value, amp);
      rippleNext = (rippleNext + 1) % MAX_RIPPLES;
    }

    function lampUniforms(list) {
      const P = [], C = [], B = [];
      for (let i = 0; i < MAX_LAMPS; i++) {
        const l = list[i];
        P.push(l ? new THREE.Vector4(l.x, l.y, l.z, l.r) : new THREE.Vector4());
        C.push(l ? l.color.clone() : new THREE.Color(0, 0, 0));
        B.push(l ? new THREE.Vector4(l.b[0], l.b[1], l.b[2], l.b[3]) : new THREE.Vector4());
      }
      return { uLampP: { value: P }, uLampC: { value: C }, uLampB: { value: B }, uLampN: { value: Math.min(list.length, MAX_LAMPS) } };
    }

    function tileMaterial(lamps) {
      return new THREE.ShaderMaterial({
        vertexShader: TILE_VS,
        fragmentShader: TILE_FS,
        vertexColors: true,
        uniforms: Object.assign({}, shared, lampUniforms(lamps), {
          uAmbHi: { value: col(PAL.ambHi) }, uAmbLo: { value: col(PAL.ambLo) },
          uTileA: { value: col(PAL.tileA) }, uTileB: { value: col(PAL.tileB) }, uGrout: { value: col(PAL.grout) },
          uBandA: { value: col(PAL.bandA) }, uBandB: { value: col(PAL.bandB) }, uBandLine: { value: col(PAL.bandLine) },
          uFloorA: { value: col(PAL.floorA) }, uFloorB: { value: col(PAL.floorB) },
          uPoolA: { value: col(PAL.poolA) }, uPoolB: { value: col(PAL.poolB) }, uLane: { value: col(PAL.lane) },
          uCeilA: { value: col(PAL.ceilA) }, uCeilB: { value: col(PAL.ceilB) },
          uWaterTint: { value: col(PAL.waterTint) }, uCaustC: { value: col(PAL.caustic) }, uCaustI: { value: PAL.causticI }
        })
      });
    }

    function waterMaterial(lamps) {
      return new THREE.ShaderMaterial({
        vertexShader: WATER_VS,
        fragmentShader: WATER_FS,
        transparent: true,
        depthWrite: false,
        uniforms: Object.assign({}, shared, lampUniforms(lamps), {
          uRip: { value: ripples },
          uDeep: { value: col(PAL.waterDeep) }, uShallow: { value: col(PAL.waterShallow) },
          uSky0: { value: col(PAL.sky0) }, uSky1: { value: col(PAL.sky1) }, uCaustC: { value: col(PAL.caustic) }
        })
      });
    }

    /* ================================================================ *
     * BUILDING THE BATHS
     * Geometry is merged into 8x8-cell chunks, one tile mesh and one water
     * mesh each, so the GPU sees a few dozen draw calls and the camera
     * can cull what is behind you.
     * ================================================================ */
    const CHUNK = 8;
    function makeBuilder() {
      return { pos: [], nrm: [], col: [], minX: 1e9, minY: 1e9, minZ: 1e9, maxX: -1e9, maxY: -1e9, maxZ: -1e9 };
    }
    // A quad given four corners in order round the face; the normal comes
    // from the winding, which is counter-clockwise seen from the front.
    function quad(b, a, bb, c, d, ao) {
      const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L; ny /= L; nz /= L;
      const pts = [a, bb, c, a, c, d];
      const aos = ao ? [ao[0], ao[1], ao[2], ao[0], ao[2], ao[3]] : [1, 1, 1, 1, 1, 1];
      for (let k = 0; k < 6; k++) {
        const p = pts[k];
        b.pos.push(p[0], p[1], p[2]);
        b.nrm.push(nx, ny, nz);
        b.col.push(aos[k], aos[k], aos[k]);
        if (p[0] < b.minX) b.minX = p[0]; if (p[0] > b.maxX) b.maxX = p[0];
        if (p[1] < b.minY) b.minY = p[1]; if (p[1] > b.maxY) b.maxY = p[1];
        if (p[2] < b.minZ) b.minZ = p[2]; if (p[2] > b.maxZ) b.maxZ = p[2];
      }
    }
    function boxInto(b, x0, y0, z0, x1, y1, z1, ao) {
      const s = ao || 1;
      quad(b, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [s, s, s, s]);             // top
      quad(b, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [s, s, s, s]);             // bottom
      quad(b, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [s * 0.8, s * 0.8, s, s]);   // +z
      quad(b, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [s * 0.8, s * 0.8, s, s]);   // -z
      quad(b, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [s * 0.8, s * 0.8, s, s]);   // +x
      quad(b, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [s * 0.8, s * 0.8, s, s]);   // -x
    }
    function boxColored(b, x0, y0, z0, x1, y1, z1, rgb) {
      const start = b.col.length;
      boxInto(b, x0, y0, z0, x1, y1, z1, 1);
      for (let k = start; k < b.col.length; k += 3) { b.col[k] = rgb[0]; b.col[k + 1] = rgb[1]; b.col[k + 2] = rgb[2]; }
    }
    function toGeometry(b) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      return g;
    }

    /* ---- lamps, decided from the map ---- */
    function placeLamps(map) {
      const lamps = [];
      const { W, type, top, ceil, zone, idx, inside, rng } = map;
      const roomBox = r => [r.x * CELL, r.z * CELL, (r.x + r.w) * CELL, (r.z + r.h) * CELL];
      const add = (x, y, z, c, I, R, b, kind) => lamps.push({ x, y, z, color: col(c).multiplyScalar(I), r: R, b, kind });
      for (const r of map.rooms) {
        const box = roomBox(r);
        // Warm sconces on the walls above the walkways.
        let n = 0;
        for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) {
          const i = idx(x, z);
          if (top[i] > 1) continue;
          const base = type[i] === T_DRY ? top[i] : 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!inside(x + dx, z + dz) || type[idx(x + dx, z + dz)] !== T_WALL) continue;
            if ((x * 7 + z * 13 + dx * 3) % 5 !== 0 || n > 3) continue;
            const wx = (x + 0.5 + dx * 0.46) * CELL, wz = (z + 0.5 + dz * 0.46) * CELL;
            add(wx, base + 2.4, wz, PAL.warm, PAL.warmI, PAL.warmR, box, { type: "sconce", nx: -dx, nz: -dz });
            n++;
          }
        }
        // Lamps set in the pool walls, under the water.
        let m = 0;
        for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) {
          const i = idx(x, z);
          if (type[i] !== T_WATER) continue;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!inside(x + dx, z + dz)) continue;
            const j = idx(x + dx, z + dz);
            if (type[j] === T_WATER) continue;
            if ((x * 11 + z * 5 + dz * 7) % 4 !== 0 || m > 3) continue;
            const wx = (x + 0.5 + dx * 0.47) * CELL, wz = (z + 0.5 + dz * 0.47) * CELL;
            add(wx, -0.5, wz, PAL.pool, PAL.poolI, PAL.poolR, box, { type: "pool", nx: -dx, nz: -dz });
            m++;
          }
        }
        // Big rooms get a skylight and the moon through it.
        if ((r.w >= 8 && r.h >= 8) || (r.style === "stones" && r.w * r.h > 40)) {
          if (rng() < 0.75) {
            r.skylight = { x: Math.floor(r.cx) - 1, z: Math.floor(r.cz) - 1, w: 2, h: 2 };
            add(r.cx * CELL + 0.4, r.ceil - 0.6, r.cz * CELL - 0.3, PAL.moon, PAL.moonI, PAL.moonR, box, { type: "moon" });
          }
        }
        if (n + m === 0) add(r.cx * CELL, r.ceil - 1, r.cz * CELL, PAL.warm, PAL.warmI * 0.7, PAL.warmR * 1.4, box, { type: "hanging" });
      }
      // Corridors: a strip light every few cells, and some left dark.
      for (const c of map.corridors) {
        if (!c.cells.length || rng() < 0.25) continue;
        let k = 0;
        for (const i of c.cells) {
          if (k++ % 4 !== 1) continue;
          const x = i % W, z = (i / W) | 0;
          const box = [(x - 3) * CELL, (z - 3) * CELL, (x + 4) * CELL, (z + 4) * CELL];
          add((x + 0.5) * CELL, ceil[i] - 0.12, (z + 0.5) * CELL, PAL.strip, PAL.stripI, PAL.stripR, box, { type: "strip" });
        }
      }
      return lamps;
    }

    function buildWorld(map) {
      if (world.group) {
        scene.remove(world.group);
        world.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        for (const m of world.materials) m.dispose();
        world.materials.length = 0;
      }
      const group = new THREE.Group();
      world.group = group;
      if (mapTex) mapTex.dispose();
      mapTex = makeMapTexture(map);
      shared.uMap.value = mapTex;
      shared.uMapSize.value.set(map.W, map.H);
      const lamps = placeLamps(map);
      world.lamps = lamps;
      const { W, H, type, top, ceil, idx, inside } = map;
      const sky = (x, z) => {
        const zi = map.zone[idx(x, z)];
        if (zi < 0) return false;
        const s = map.rooms[zi].skylight;
        return s && x >= s.x && x < s.x + s.w && z >= s.z && z < s.z + s.h;
      };

      const builders = new Map();
      const waters = new Map();
      const keyOf = (x, z) => Math.floor(z / CHUNK) * 1000 + Math.floor(x / CHUNK);
      const B = (x, z) => { const k = keyOf(x, z); if (!builders.has(k)) builders.set(k, makeBuilder()); return builders.get(k); };
      const Wb = (x, z) => { const k = keyOf(x, z); if (!waters.has(k)) waters.set(k, makeBuilder()); return waters.get(k); };
      const solid = (x, z) => !inside(x, z) || type[idx(x, z)] === T_WALL;
      const floorOf = (x, z) => (solid(x, z) ? 99 : top[idx(x, z)]);

      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
        const i = idx(x, z);
        if (type[i] === T_WALL) continue;
        const b = B(x, z);
        const X0 = x * CELL, X1 = X0 + CELL, Z0 = z * CELL, Z1 = Z0 + CELL;
        const y = top[i], c = ceil[i];
        // Floor: darker in corners that meet a wall or a step up.
        const occ = (dx, dz) => (floorOf(x + dx, z + dz) > y + 0.3 ? 1 : 0);
        const aoAt = (sx, sz) => 1 - 0.32 * Math.min(1, occ(sx, 0) + occ(0, sz) + occ(sx, sz) * 0.6);
        quad(b, [X0, y, Z0], [X0, y, Z1], [X1, y, Z1], [X1, y, Z0], [aoAt(-1, -1), aoAt(-1, 1), aoAt(1, 1), aoAt(1, -1)]);
        // Ceiling, unless the moon is looking in.
        if (!sky(x, z)) quad(b, [X0, c, Z0], [X1, c, Z0], [X1, c, Z1], [X0, c, Z1], [0.85, 0.85, 0.85, 0.85]);
        if (type[i] === T_WATER) {
          const wb = Wb(x, z);
          quad(wb, [X0, 0, Z0], [X0, 0, Z1], [X1, 0, Z1], [X1, 0, Z0], null);
        }
        // Sides: walls, the faces of platforms, and steps in the ceiling.
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          // Corners of the shared edge, wound to face back into this cell.
          let e0, e1;
          if (dx === 1) { e0 = [X1, Z0]; e1 = [X1, Z1]; }
          else if (dx === -1) { e0 = [X0, Z1]; e1 = [X0, Z0]; }
          else if (dz === 1) { e0 = [X1, Z1]; e1 = [X0, Z1]; }
          else { e0 = [X0, Z0]; e1 = [X1, Z0]; }
          const face = (y0, y1, aoLo, aoHi) => {
            if (y1 - y0 < 0.001) return;
            quad(b, [e0[0], y0, e0[1]], [e1[0], y0, e1[1]], [e1[0], y1, e1[1]], [e0[0], y1, e0[1]], [aoLo, aoLo, aoHi, aoHi]);
          };
          if (solid(nx, nz)) {
            face(y, c, 0.62, 0.9);
          } else {
            const j = idx(nx, nz);
            // This cell's ceiling stands above the neighbour's: close the gap.
            if (ceil[j] < c) face(ceil[j], c, 0.8, 0.9);
            // The neighbour stands higher: its side faces into this cell,
            // and it is built from here so it lands in this cell's chunk.
            if (top[j] > y + 0.001) face(y, top[j], 0.6, 0.95);
          }
        }
      }

      /* ---- pool copings: a pale bullnose lip on every edge that meets the water ---- */
      const trim = makeBuilder();
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
        const i = idx(x, z);
        if (type[i] !== T_DRY) continue;
        const y = top[i];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (!inside(nx, nz) || type[idx(nx, nz)] !== T_WATER) continue;
          const X0 = x * CELL, Z0 = z * CELL;
          const t = 0.22, o = 0.05;
          if (dx === 1) boxInto(trim, X0 + CELL - t, y - 0.05, Z0, X0 + CELL + o, y + 0.05, Z0 + CELL, 1);
          if (dx === -1) boxInto(trim, X0 - o, y - 0.05, Z0, X0 + t, y + 0.05, Z0 + CELL, 1);
          if (dz === 1) boxInto(trim, X0, y - 0.05, Z0 + CELL - t, X0 + CELL, y + 0.05, Z0 + CELL + o, 1);
          if (dz === -1) boxInto(trim, X0, y - 0.05, Z0 - o, X0 + CELL, y + 0.05, Z0 + t, 1);
        }
      }

      /* ---- assemble chunks with their own lamps ---- */
      const overlap = (l, b) => !(l.b[2] < b.minX - 1 || l.b[0] > b.maxX + 1 || l.b[3] < b.minZ - 1 || l.b[1] > b.maxZ + 1);
      const lampsFor = b => {
        const near = lamps.filter(l => overlap(l, b) && l.x > b.minX - 9 && l.x < b.maxX + 9 && l.z > b.minZ - 9 && l.z < b.maxZ + 9);
        const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
        near.sort((p, q) => Math.hypot(p.x - cx, p.z - cz) / (p.r + 1) - Math.hypot(q.x - cx, q.z - cz) / (q.r + 1));
        return near.slice(0, MAX_LAMPS);
      };
      for (const [k, b] of builders) {
        const mat = tileMaterial(lampsFor(b));
        world.materials.push(mat);
        const mesh = new THREE.Mesh(toGeometry(b), mat);
        group.add(mesh);
      }
      for (const [k, b] of waters) {
        const mat = waterMaterial(lampsFor(b));
        world.materials.push(mat);
        const mesh = new THREE.Mesh(toGeometry(b), mat);
        mesh.renderOrder = 2;
        group.add(mesh);
      }
      // Trim and props share one plain material with every lamp in reach
      // of the camera chosen per frame -- they are small, so the nearest
      // eight are what matter.
      const trimMat = new THREE.ShaderMaterial({
        vertexShader: TILE_VS,
        fragmentShader: PROP_FS,
        vertexColors: true,
        uniforms: Object.assign({}, shared, lampUniforms([]), {
          uAmbHi: { value: col(PAL.ambHi) }, uAmbLo: { value: col(PAL.ambLo) },
          uBase: { value: col(PAL.coping) }, uWaterTint: { value: col(PAL.waterTint) }, uGloss: { value: 0.8 }
        })
      });
      world.materials.push(trimMat);
      world.propMats = [trimMat];
      group.add(new THREE.Mesh(toGeometry(trim), trimMat));

      buildProps(map, group);
      buildGlows(lamps, group);
      buildSky(map, group);
      scene.add(group);
      return world;
    }

    /* ---- the night sky, seen only through the skylights ---- */
    function buildSky(map, group) {
      const any = map.rooms.some(r => r.skylight);
      if (!any) return;
      const g = new THREE.SphereGeometry(110, 24, 12);
      const m = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uTop: { value: col(PAL.skyTop) }, uHor: { value: col(PAL.skyHorizon) }, uTime: shared.uTime },
        vertexShader: /* glsl */`
          varying vec3 vD;
          void main() {
            vD = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uTop, uHor;
          uniform float uTime;
          varying vec3 vD;
          float h(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          void main() {
            vec3 d = normalize(vD);
            vec3 c = mix(uHor, uTop, smoothstep(-0.1, 0.8, d.y));
            // Stars: a hashed lattice on the sphere, twinkling slowly.
            vec3 q = floor(d * 160.0);
            float s = h(q);
            float star = step(0.9965, s) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 90.0));
            c += vec3(0.85, 0.9, 1.0) * star * smoothstep(0.0, 0.3, d.y);
            // The moon's halo, high and a little to one side.
            vec3 md = normalize(vec3(0.35, 1.0, -0.25));
            float mm = max(dot(d, md), 0.0);
            c += vec3(0.75, 0.82, 1.0) * (pow(mm, 900.0) * 6.0 + pow(mm, 30.0) * 0.25);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      });
      world.materials.push(m);
      const sky = new THREE.Mesh(g, m);
      sky.renderOrder = -10;
      sky.frustumCulled = false;
      sky.onBeforeRender = () => sky.position.copy(camera.position);
      group.add(sky);

      // Shafts of moonlight under each skylight: crossed additive planes,
      // brightest at the top, breaking up as they fall.
      const pos = [], uv = [], nrm = [];
      const frame = makeBuilder();
      for (const r of map.rooms) {
        if (!r.skylight) continue;
        const sl = r.skylight;
        const cx = (sl.x + sl.w / 2) * CELL, cz = (sl.z + sl.h / 2) * CELL;
        const top = r.ceil, bot = 0.02;
        const ox = 0.9, oz = -0.6;          // the moon is not straight overhead
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI;
          const dx = Math.cos(a) * 1.9, dz = Math.sin(a) * 1.9;
          const P0 = [cx - dx, top, cz - dz], P1 = [cx + dx, top, cz + dz];
          const P2 = [cx + dx + ox, bot, cz + dz + oz], P3 = [cx - dx + ox, bot, cz - dz + oz];
          const nx = -dz, nz = dx, nl = Math.hypot(nx, nz) || 1;
          for (const [p, u, v] of [[P0, 0, 1], [P1, 1, 1], [P2, 1, 0], [P0, 0, 1], [P2, 1, 0], [P3, 0, 0]]) {
            pos.push(p[0], p[1], p[2]); uv.push(u, v); nrm.push(nx / nl, 0, nz / nl);
          }
        }
        // The skylight's iron frame: mullions across the opening.
        const X0 = sl.x * CELL, Z0 = sl.z * CELL, X1 = (sl.x + sl.w) * CELL, Z1 = (sl.z + sl.h) * CELL;
        for (let k = 0; k <= 4; k++) {
          const t = k / 4;
          boxInto(frame, X0 + (X1 - X0) * t - 0.05, top - 0.12, Z0, X0 + (X1 - X0) * t + 0.05, top + 0.02, Z1, 0.6);
          boxInto(frame, X0, top - 0.12, Z0 + (Z1 - Z0) * t - 0.05, X1, top + 0.02, Z0 + (Z1 - Z0) * t + 0.05, 0.6);
        }
      }
      if (frame.pos.length) {
        const fm = new THREE.ShaderMaterial({
          vertexShader: TILE_VS,
          fragmentShader: /* glsl */`
            uniform vec3 uFogC; uniform float uFogD;
            varying vec3 vW; varying vec3 vN; varying vec3 vAO;
            void main() { gl_FragColor = vec4(vec3(0.012, 0.016, 0.02) * vAO, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
          vertexColors: true,
          uniforms: { uFogC: shared.uFogC, uFogD: shared.uFogD }
        });
        world.materials.push(fm);
        group.add(new THREE.Mesh(toGeometry(frame), fm));
      }
      if (pos.length) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        sg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        sg.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
        const sm = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          uniforms: { uC: { value: col(PAL.moon).multiplyScalar(0.07) }, uTime: shared.uTime },
          vertexShader: /* glsl */`
            varying vec2 vUv; varying vec3 vW; varying vec3 vN;
            void main() { vUv = uv; vN = normal; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
          fragmentShader: /* glsl */`
            uniform vec3 uC;
            uniform float uTime;
            varying vec2 vUv; varying vec3 vW; varying vec3 vN;
            float hh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
            void main() {
              float side = 1.0 - abs(vUv.x - 0.5) * 2.0;
              float a = pow(side, 2.2) * (0.3 + 0.7 * vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
              a *= 0.35 + 0.65 * n2(vec2(vUv.x * 9.0, vUv.y * 2.5 - uTime * 0.05)) * n2(vec2(vUv.x * 3.0 + 7.0, vUv.y * 1.2));
              // Fade where it meets the camera, so walking through it is soft,
              // and as each plane turns edge-on, so no plane ever shows as a line.
              float d = length(cameraPosition - vW);
              a *= smoothstep(0.5, 3.0, d);
              a *= pow(abs(dot(normalize(cameraPosition - vW), normalize(vN))), 0.7);
              gl_FragColor = vec4(uC * a, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`
        });
        world.materials.push(sm);
        const shafts = new THREE.Mesh(sg, sm);
        shafts.renderOrder = 4;
        shafts.frustumCulled = false;
        group.add(shafts);
      }
    }

    /* ---- props: columns, lane ropes, lifeguard chairs ---- */
    const PROP_FS = /* glsl */`
      ${GLSL_COMMON}
      uniform vec3 uAmbHi, uAmbLo, uBase, uWaterTint;
      uniform float uGloss;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vAO;
      void main() {
        vec3 N = normalize(vN);
        vec3 P = vW;
        vec3 V = normalize(cameraPosition - P);
        vec3 light = mix(uAmbLo, uAmbHi, N.y * 0.5 + 0.5);
        vec3 spec = vec3(0.0);
        for (int i = 0; i < ${MAX_LAMPS}; i++) {
          if (i >= uLampN) break;
          vec4 L4 = uLampP[i];
          float m = roomMask(uLampB[i], P);
          if (m <= 0.0) continue;
          vec3 Lv = L4.xyz - P;
          float d2 = dot(Lv, Lv);
          vec3 L = Lv * inversesqrt(d2);
          float att = m / (1.0 + d2 / (L4.w * L4.w));
          if (L4.y < 0.0) att *= 1.0 - smoothstep(-0.05, 0.6, P.y);
          float ndl = dot(N, L);
          light += uLampC[i] * att * (max(ndl, 0.0) * 0.85 + 0.15 * (ndl * 0.5 + 0.5));
          spec += uLampC[i] * att * pow(max(dot(N, normalize(L + V)), 0.0), 60.0) * uGloss;
        }
        vec3 c = uBase * vAO * light + spec;
        if (P.y < 0.0) c = mix(c, uWaterTint * (0.35 + 0.65 * light), clamp(0.3 - P.y * 0.3, 0.0, 0.85));
        gl_FragColor = vec4(fogged(c, P), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;

    function buildProps(map, group) {
      const { W, type, top, idx, inside, rng } = map;
      const white = makeBuilder();
      const floats = makeBuilder();
      const FLOAT_RGB = [[0.62, 0.05, 0.04], [0.8, 0.8, 0.76], [0.03, 0.12, 0.5]];
      const cyl = (b, cx, cz, y0, y1, r, seg, ao) => {
        for (let k = 0; k < seg; k++) {
          const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
          const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
          const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
          quad(b, [x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [x1, y0, z1], [ao * 0.7, ao, ao, ao * 0.7]);
        }
      };
      world.colliders = [];
      for (const r of map.rooms) {
        // Columns down the long sides of the big rooms, standing in the water.
        if (r.w >= 8 && r.h >= 8 && r.style !== "dry") {
          const step = 3;
          for (let x = r.x + 2; x <= r.x + r.w - 3; x += step) {
            for (const z of [r.z + 2, r.z + r.h - 3]) {
              const i = idx(x, z);
              if (type[i] === T_WALL) continue;
              const cx = (x + 0.5) * CELL, cz = (z + 0.5) * CELL;
              cyl(white, cx, cz, top[i], r.ceil, 0.36, 14, 1);
              cyl(white, cx, cz, top[i], top[i] + 0.25, 0.46, 14, 0.9);
              boxInto(white, cx - 0.46, top[i] + 0.25, cz - 0.46, cx + 0.46, top[i] + 0.3, cz + 0.46, 0.95);
              cyl(white, cx, cz, r.ceil - 0.35, r.ceil, 0.48, 14, 0.9);
              world.colliders.push({ x: cx, z: cz, r: 0.42 });
            }
          }
        }
        // Lane ropes across the pools: strings of floats on the water.
        if (r.style === "pool" || r.style === "hall") {
          const alongX = r.alongX ?? r.w >= r.h;
          const lines = r.style === "hall" ? 1 : 2;
          for (let k = 0; k < lines; k++) {
            const t = (k + 1) / (lines + 1);
            if (alongX) {
              const z = (r.z + r.h * t) * CELL;
              let q = 0;
              for (let x = r.x * CELL + 0.6; x < (r.x + r.w) * CELL - 0.6; x += 0.32, q++) {
                const ci = idx(Math.floor(x / CELL), Math.floor(z / CELL));
                if (type[ci] !== T_WATER) continue;
                floatAt(floats, x, z, true, q);
              }
            } else {
              const x = (r.x + r.w * t) * CELL;
              let q = 0;
              for (let z = r.z * CELL + 0.6; z < (r.z + r.h) * CELL - 0.6; z += 0.32, q++) {
                const ci = idx(Math.floor(x / CELL), Math.floor(z / CELL));
                if (type[ci] !== T_WATER) continue;
                floatAt(floats, x, z, false, q);
              }
            }
          }
        }
        // A lifeguard chair on the island.
        if (r.island) {
          const cx = (r.island.x + r.island.w / 2) * CELL, cz = (r.island.z + r.island.h / 2) * CELL;
          const y = WALK_Y;
          for (const [ox, oz] of [[-0.35, -0.3], [0.35, -0.3], [-0.35, 0.3], [0.35, 0.3]]) {
            boxInto(white, cx + ox - 0.04, y, cz + oz - 0.04, cx + ox + 0.04, y + 1.9, cz + oz + 0.04, 0.95);
          }
          boxInto(white, cx - 0.42, y + 1.6, cz - 0.36, cx + 0.42, y + 1.68, cz + 0.36, 1);
          boxInto(white, cx - 0.42, y + 1.68, cz + 0.3, cx + 0.42, y + 2.35, cz + 0.36, 1);
          for (let s = 1; s <= 3; s++) boxInto(white, cx - 0.35, y + s * 0.42, cz - 0.36, cx + 0.35, y + s * 0.42 + 0.04, cz - 0.3, 0.9);
          world.colliders.push({ x: cx, z: cz, r: 0.5 });
        }
      }
      function floatAt(b, x, z, alongX, q) {
        // A float: a short barrel lying on the water.
        const rgb = FLOAT_RGB[Math.floor(q / 3) % 3];
        const L = 0.13, R = 0.07;
        if (alongX) boxColored(b, x - L, -R, z - R, x + L, R, z + R, rgb);
        else boxColored(b, x - R, -R, z - L, x + R, R, z + L, rgb);
      }
      const wm = new THREE.ShaderMaterial({
        vertexShader: TILE_VS, fragmentShader: PROP_FS, vertexColors: true,
        uniforms: Object.assign({}, shared, lampUniforms([]), {
          uAmbHi: { value: col(PAL.ambHi) }, uAmbLo: { value: col(PAL.ambLo) },
          uBase: { value: col(PAL.tileA) }, uWaterTint: { value: col(PAL.waterTint) }, uGloss: { value: 0.9 }
        })
      });
      world.materials.push(wm);
      world.propMats.push(wm);
      if (white.pos.length) group.add(new THREE.Mesh(toGeometry(white), wm));

      // Floats: red, white and blue, bobbing in the vertex shader.
      if (floats.pos.length) {
        const fg = toGeometry(floats);
        const fm = new THREE.ShaderMaterial({
          vertexShader: /* glsl */`
            uniform float uTime;
            varying vec3 vW; varying vec3 vN; varying vec3 vAO;
            void main() {
              vec4 w = modelMatrix * vec4(position, 1.0);
              w.y += sin(uTime * 1.6 + w.x * 1.3 + w.z * 0.9) * 0.022;
              vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vAO = color;
              gl_Position = projectionMatrix * viewMatrix * w;
            }`,
          fragmentShader: /* glsl */`
            ${GLSL_COMMON}
            uniform vec3 uAmbHi;
            varying vec3 vW; varying vec3 vN; varying vec3 vAO;
            void main() {
              vec3 base = vAO;
              vec3 N = normalize(vN);
              vec3 light = uAmbHi * 1.4 + vec3(0.25);
              for (int i = 0; i < ${MAX_LAMPS}; i++) {
                if (i >= uLampN) break;
                vec3 Lv = uLampP[i].xyz - vW;
                float d2 = dot(Lv, Lv);
                light += uLampC[i] * roomMask(uLampB[i], vW) / (1.0 + d2 / (uLampP[i].w * uLampP[i].w)) * max(dot(N, Lv * inversesqrt(d2)), 0.2);
              }
              vec3 c = base * light;
              if (vW.y < 0.0) c *= 0.5;
              gl_FragColor = vec4(fogged(c, vW), 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
          vertexColors: true,
          uniforms: Object.assign({}, shared, lampUniforms([]), { uAmbHi: { value: col(PAL.ambHi) } })
        });
        world.materials.push(fm);
        world.propMats.push(fm);
        group.add(new THREE.Mesh(fg, fm));
      }
    }

    /* ---- every lamp gets a soft glow sprite; all of them are one draw call ---- */
    function buildGlows(lamps, group) {
      const n = lamps.length;
      const pos = new Float32Array(n * 3), colA = new Float32Array(n * 3), size = new Float32Array(n);
      lamps.forEach((l, i) => {
        const out = l.kind.type === "sconce" ? 0.45 : l.kind.type === "pool" ? 0.25 : 0;
        pos[i * 3] = l.x + (l.kind.nx || 0) * out; pos[i * 3 + 1] = l.y; pos[i * 3 + 2] = l.z + (l.kind.nz || 0) * out;
        const k = l.kind.type === "pool" ? 0.32 : l.kind.type === "moon" ? 0.35 * (PAL.moonGlow ?? 1) : l.kind.type === "strip" ? 0.4 : 0.7;
        colA[i * 3] = l.color.r * k; colA[i * 3 + 1] = l.color.g * k; colA[i * 3 + 2] = l.color.b * k;
        size[i] = l.kind.type === "moon" ? 9 : l.kind.type === "pool" ? 1.6 : l.kind.type === "strip" ? 0.95 : 2.2;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(colA, 3));
      g.setAttribute("size", new THREE.BufferAttribute(size, 1));
      const m = new THREE.ShaderMaterial({
        vertexShader: /* glsl */`
          attribute float size;
          uniform float uScale;
          varying vec3 vC;
          varying float vUnder;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            // A glow right over your head would fill the screen: fade it.
            vC = color * smoothstep(0.7, 2.6, -mv.z);
            vUnder = position.y < 0.0 ? 1.0 : 0.0;
            gl_PointSize = size * uScale / max(-mv.z, 0.1);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uFogC;
          uniform float uFogD;
          varying vec3 vC;
          varying float vUnder;
          void main() {
            vec2 q = gl_PointCoord - 0.5;
            float d = length(q) * 2.0;
            float a = exp(-d * d * 4.0) * 0.9 + exp(-d * 9.0) * 0.6;
            a *= 1.0 - smoothstep(0.85, 1.0, d);
            gl_FragColor = vec4(vC * a, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 300 }, uFogC: shared.uFogC, uFogD: shared.uFogD }
      });
      world.materials.push(m);
      world.glowMat = m;
      m.uniforms.uScale.value = (Math.max(1, ctx.height) * gfx.dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = 3;
      group.add(pts);

      // The fixtures themselves: small emissive shapes at each lamp.
      const fx = makeBuilder();
      const rgbOf = (c, k) => { const q = col(c).multiplyScalar(k); return [q.r, q.g, q.b]; };
      const warmRGB = rgbOf(PAL.warm, 2.4), poolRGB = rgbOf(PAL.pool, 2.6), stripRGB = rgbOf(PAL.strip, 2.0);
      for (const l of lamps) {
        const t = l.kind.type;
        if (t === "sconce") {
          const nx = l.kind.nx, nz = l.kind.nz;
          const w = 0.22, hgt = 0.34, dpt = 0.12;
          const x0 = l.x - (nz !== 0 ? w : dpt) , x1 = l.x + (nz !== 0 ? w : dpt);
          const z0 = l.z - (nx !== 0 ? w : dpt), z1 = l.z + (nx !== 0 ? w : dpt);
          boxColored(fx, x0, l.y - hgt / 2, z0, x1, l.y + hgt / 2, z1, warmRGB);
        } else if (t === "pool") {
          const nx = l.kind.nx, nz = l.kind.nz;
          const w = 0.26, dpt = 0.04;
          boxColored(fx, l.x - (nz !== 0 ? w : dpt), l.y - 0.18, l.z - (nx !== 0 ? w : dpt), l.x + (nz !== 0 ? w : dpt), l.y + 0.18, l.z + (nx !== 0 ? w : dpt), poolRGB);
        } else if (t === "strip") {
          boxColored(fx, l.x - 0.6, l.y - 0.05, l.z - 0.08, l.x + 0.6, l.y + 0.04, l.z + 0.08, stripRGB);
        }
      }
      if (fx.pos.length) {
        const fm = new THREE.ShaderMaterial({
          vertexShader: TILE_VS,
          fragmentShader: /* glsl */`
            varying vec3 vW; varying vec3 vN; varying vec3 vAO;
            void main() {
              gl_FragColor = vec4(vAO, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
          vertexColors: true
        });
        world.materials.push(fm);
        group.add(new THREE.Mesh(toGeometry(fx), fm));
      }
    }

    /* ---- per frame: props take the eight lamps nearest the camera ---- */
    const _near = [];
    function updatePropLamps() {
      if (!world.propMats) return;
      _near.length = 0;
      for (const l of world.lamps) {
        const d = Math.hypot(l.x - camera.position.x, l.z - camera.position.z);
        if (d < 26) _near.push({ l, d: d / (l.r + 1) });
      }
      _near.sort((a, b) => a.d - b.d);
      for (const m of world.propMats.concat(followMats)) {
        const U = m.uniforms;
        const n = Math.min(_near.length, MAX_LAMPS);
        for (let i = 0; i < MAX_LAMPS; i++) {
          const l = i < n ? _near[i].l : null;
          if (l) {
            U.uLampP.value[i].set(l.x, l.y, l.z, l.r);
            U.uLampC.value[i].copy(l.color);
            U.uLampB.value[i].set(l.b[0], l.b[1], l.b[2], l.b[3]);
          }
        }
        U.uLampN.value = n;
      }
    }

    /* ================================================================ *
     * THE LISTENER: ITS BODY
     * One tube and six frills, placed entirely in the vertex shader from
     * a spine of twenty points that the AI drags through the water. No
     * skeleton and no animation: the body is wherever its spine has been.
     * ================================================================ */
    const SPINE = 20;
    const SPINE_GAP = 0.38;
    const PROFILE = [];
    for (let i = 0; i < SPINE; i++) {
      const t = i / (SPINE - 1);
      let r;
      if (i === 0) r = 0.04;
      else if (t < 0.12) r = 0.17 + (t / 0.12) * 0.13;
      else if (t < 0.2) r = 0.3 - (t - 0.12) * 0.45;
      else if (t < 0.58) r = 0.25 + Math.sin(((t - 0.2) / 0.38) * Math.PI) * 0.1;
      else r = 0.25 * Math.pow(1 - (t - 0.58) / 0.42, 1.25) + 0.012;
      PROFILE.push(i === SPINE - 1 ? 0.0 : r);
    }
    const creature = {
      spine: [], glow: { value: 0.15 }, open: { value: 0 }, mesh: null, frills: null, group: new THREE.Group()
    };
    for (let i = 0; i < SPINE; i++) creature.spine.push(new THREE.Vector4(0, -0.5, i * SPINE_GAP, PROFILE[i]));

    const CREATURE_FRAME = /* glsl */`
      uniform vec4 uSpine[${SPINE}];
      void frameAt(float fi, out vec3 p, out vec3 T, out vec3 B, out vec3 U, out float r) {
        int i = int(fi + 0.5);
        int i0 = i > 0 ? i - 1 : 0;
        int i1 = i < ${SPINE - 1} ? i + 1 : ${SPINE - 1};
        p = uSpine[i].xyz;
        r = uSpine[i].w;
        T = uSpine[i0].xyz - uSpine[i1].xyz;
        T = length(T) < 1e-4 ? vec3(0.0, 0.0, 1.0) : normalize(T);
        B = cross(vec3(0.0, 1.0, 0.0), T);
        B = length(B) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(B);
        U = normalize(cross(T, B));
      }
    `;
    const CREATURE_LIGHT = /* glsl */`
      vec3 lampsAt(vec3 P, vec3 N, vec3 V, out vec3 spec) {
        vec3 light = vec3(0.0);
        spec = vec3(0.0);
        for (int i = 0; i < ${MAX_LAMPS}; i++) {
          if (i >= uLampN) break;
          vec4 L4 = uLampP[i];
          float m = roomMask(uLampB[i], P);
          if (m <= 0.0) continue;
          vec3 Lv = L4.xyz - P;
          float d2 = dot(Lv, Lv);
          vec3 L = Lv * inversesqrt(d2);
          float att = m / (1.0 + d2 / (L4.w * L4.w));
          float ndl = dot(N, L);
          light += uLampC[i] * att * (max(ndl, 0.0) * 0.8 + 0.2 * (ndl * 0.5 + 0.5));
          spec += uLampC[i] * att * pow(max(dot(N, normalize(L + V)), 0.0), 50.0);
        }
        return light;
      }
    `;

    function buildCreature() {
      const SEG = 16;
      const aT = [], aA = [], pos = [], index = [];
      for (let i = 0; i < SPINE; i++) {
        for (let k = 0; k <= SEG; k++) { aT.push(i); aA.push((k / SEG) * Math.PI * 2); pos.push(0, 0, 0); }
      }
      for (let i = 0; i < SPINE - 1; i++) for (let k = 0; k < SEG; k++) {
        const a = i * (SEG + 1) + k, b = a + 1, c = a + SEG + 1, d = c + 1;
        index.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aT", new THREE.Float32BufferAttribute(aT, 1));
      g.setAttribute("aA", new THREE.Float32BufferAttribute(aA, 1));
      g.setIndex(index);
      const uniforms = Object.assign({}, shared, lampUniforms([]), {
        uSpine: { value: creature.spine }, uGlow: creature.glow, uOpen: creature.open,
        uSkin: { value: col("#64716a") }, uDark: { value: col("#141b18") }, uBelly: { value: col("#c4bcab") },
        uGlowC: { value: col("#5ffcff") }, uWaterTint: { value: col(PAL.waterTint) }, uAmb: { value: col(PAL.ambHi) }
      });
      const body = new THREE.ShaderMaterial({
        uniforms,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */`
          ${CREATURE_FRAME}
          uniform float uTime;
          uniform float uOpen;
          attribute float aT;
          attribute float aA;
          varying vec3 vW; varying vec3 vN; varying float vT; varying float vA; varying float vMouth;
          void main() {
            vec3 p, T, B, U; float r;
            frameAt(aT, p, T, B, U, r);
            float ca = cos(aA), sa = sin(aA);
            // Wider than tall, flatter underneath, breathing along its length;
            // the head is a broad flat wedge, like a salamander's.
            float breathe = 1.0 + 0.045 * sin(uTime * 1.7 - aT * 0.6);
            float head = 1.0 - smoothstep(1.0, 4.0, aT);
            float wide = 1.2 + head * 0.55;
            float tall = (sa > 0.0 ? 0.92 : 0.68) * (1.0 - head * 0.3);
            vec3 off = (B * ca * wide + U * sa * tall) * r * breathe;
            // The jaw: below the lip line the head drops open, the skull
            // tips back, and the stretched skin between is the mouth.
            float gape = uOpen * (1.0 - smoothstep(0.4, 2.8, aT));
            float below = max(-0.12 - sa, 0.0);
            off -= U * r * gape * 1.6 * below;
            off += U * r * gape * 0.3 * max(sa, 0.0);
            vMouth = gape * smoothstep(0.0, 0.25, below) * (1.0 - smoothstep(0.55, 0.88, below));
            vW = p + off;
            vN = normalize(B * ca / 1.2 + U * sa / 0.85);
            vT = aT / ${(SPINE - 1).toFixed(1)};
            vA = sa;
            gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
          }`,
        fragmentShader: /* glsl */`
          ${GLSL_COMMON}
          ${CREATURE_LIGHT}
          uniform vec3 uSkin, uDark, uBelly, uGlowC, uWaterTint, uAmb;
          uniform float uGlow;
          varying vec3 vW; varying vec3 vN; varying float vT; varying float vA; varying float vMouth;
          void main() {
            vec3 N = normalize(vN);
            if (!gl_FrontFacing) N = -N;
            vec3 V = normalize(cameraPosition - vW);
            float mott = vnoise(vec2(vT * 38.0, vA * 3.0)) * 0.6 + vnoise(vec2(vT * 95.0, vA * 9.0)) * 0.4;
            vec3 base = mix(uBelly, uSkin, smoothstep(-0.7, 0.15, vA));
            base = mix(base, uDark, clamp(smoothstep(0.45, 0.95, vA) * 0.75 + smoothstep(0.55, 0.85, mott) * 0.35, 0.0, 1.0));
            // A pale, blind face: the first stretch of the body is bone-white,
            // split by the dark line of a mouth.
            float face = 1.0 - smoothstep(0.03, 0.13, vT);
            base = mix(base, uBelly * 1.05, face * 0.85);
            base = mix(base, vec3(0.02, 0.015, 0.015), face * (1.0 - smoothstep(0.0, 0.07, abs(vA + 0.12))) * 0.9);
            // Blind eyes: two milky discs, set back on the flat of the head.
            float eye = (1.0 - smoothstep(0.012, 0.022, abs(vT - 0.062))) * (1.0 - smoothstep(0.08, 0.16, abs(vA - 0.42)));
            base = mix(base, vec3(0.78, 0.86, 0.86), eye);
            vec3 spec;
            vec3 light = uAmb * 2.6 + lampsAt(vW, N, V, spec) * 1.1;
            float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
            // Wet skin: a soft sheen rather than a glassy glint.
            vec3 c = base * light + spec * 0.14 + uSkin * rim * (0.05 + length(light) * 0.07);
            // The open mouth: dark and wet inside, ringed with needle teeth.
            if (vMouth > 0.01) {
              // Needle teeth along the lips, pointing into the dark.
              float lip = smoothstep(0.015, 0.04, vMouth) * (1.0 - smoothstep(0.12, 0.17, vMouth));
              float tri = abs(fract(vT * 95.0) - 0.5) * 2.0;
              float teeth = lip * step(tri, 1.0 - smoothstep(0.03, 0.15, vMouth));
              vec3 gullet = mix(vec3(0.2, 0.03, 0.04), vec3(0.04, 0.0, 0.01), smoothstep(0.2, 0.9, vMouth));
              c = mix(c, gullet * (0.4 + length(light)), smoothstep(0.02, 0.22, vMouth));
              c = mix(c, vec3(0.85, 0.82, 0.74) * (0.4 + length(light)), teeth);
            }
            // Photophores down its flanks, lit when it is listening.
            float spots = smoothstep(0.8, 0.95, vnoise(vec2(vT * 70.0, vA * 5.0))) * smoothstep(-0.3, 0.4, vA);
            c += uGlowC * spots * uGlow * 1.2 + uGlowC * eye * (0.08 + uGlow * 0.25);
            if (vW.y < 0.0) c = mix(c, uWaterTint * 0.22, clamp(0.25 - vW.y * 0.9, 0.0, 0.92));
            gl_FragColor = vec4(fogged(c, vW), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      });
      const mesh = new THREE.Mesh(g, body);
      mesh.frustumCulled = false;
      creature.mesh = mesh;
      followMats.push(body);

      // The frills: three pairs of fans behind the head that flare and
      // glow when it hears something. Its only expression.
      const fT = [], fF = [], fE = [], fpos = [], fidx = [];
      const FRILLS = [[2.4, 0.42, 0.62], [3.3, 0.55, 0.8], [4.2, 0.36, 0.6]];
      for (const side of [-1, 1]) {
        for (const [si, len, spread] of FRILLS) {
          const base = fT.length;
          fT.push(si); fF.push(side * 0.18, 0.08, 0); fE.push(0); fpos.push(0, 0, 0);
          const RAYS = 7;
          for (let k = 0; k <= RAYS; k++) {
            const a = -0.2 + (k / RAYS) * spread * 1.6;
            const L = len * (0.75 + 0.25 * Math.sin((k / RAYS) * Math.PI));
            fT.push(si);
            fF.push(side * (0.18 + Math.cos(a) * L), 0.08 + Math.sin(a) * L * 0.8, -L * 0.55);
            fE.push(1);
            fpos.push(0, 0, 0);
          }
          for (let k = 0; k < RAYS; k++) fidx.push(base, base + 1 + k, base + 2 + k);
        }
      }
      const fg = new THREE.BufferGeometry();
      const frill = new THREE.ShaderMaterial({
        uniforms,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */`
          ${CREATURE_FRAME}
          uniform float uTime;
          uniform float uGlow;
          attribute float aT;
          attribute vec3 aF;
          attribute float aE;
          varying vec3 vW; varying float vE; varying vec2 vF;
          void main() {
            vec3 p, T, B, U; float r;
            frameAt(aT, p, T, B, U, r);
            vec3 f = aF;
            // Flare when listening; flutter always.
            float flare = 1.0 + uGlow * 0.4;
            float isFrill = step(0.5, aE);
            f.xy *= mix(1.0, flare, aE * isFrill);
            f.z += sin(uTime * 7.0 + aT * 2.0 + f.x * 3.0) * 0.05 * aE * isFrill;
            vW = p + B * f.x + U * f.y + T * f.z;
            vE = aE;
            vF = f.xy;
            gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
          }`,
        fragmentShader: /* glsl */`
          ${GLSL_COMMON}
          uniform vec3 uSkin, uGlowC, uWaterTint;
          uniform float uGlow;
          varying vec3 vW; varying float vE; varying vec2 vF;
          void main() {
            // Translucent membrane with glowing veins and a lit rim.
            float ang = atan(vF.y, abs(vF.x));
            float veins = pow(abs(sin(ang * 14.0)), 18.0);
            float rimG = smoothstep(0.55, 1.0, vE);
            vec3 c = uSkin * 0.35 + uGlowC * (veins * 0.5 + rimG * 0.9) * (0.25 + uGlow * 1.8);
            float a = 0.5 + rimG * 0.35 + veins * 0.15;
            if (abs(vE - 0.2) < 0.01) { c = vec3(0.03, 0.04, 0.035); a = 0.95; }
            if (vW.y < 0.0) { c = mix(c, uWaterTint, clamp(0.25 - vW.y * 0.6, 0.0, 0.85)); }
            gl_FragColor = vec4(fogged(c, vW), a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      });
      // The crest: blades down the spine that cut the surface as it swims.
      for (let si = 4; si <= 15; si++) {
        const base = fT.length;
        const hgt = 0.26 * Math.sin(((si - 4) / 11) * Math.PI) + 0.08;
        fT.push(si, si, si);
        fF.push(0, 0.2, 0.14, 0, 0.2 + hgt, -0.16, 0, 0.2, -0.2);
        fE.push(0.2, 0.2, 0.2);
        fpos.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
        fidx.push(base, base + 1, base + 2);
      }
      fg.setAttribute("position", new THREE.Float32BufferAttribute(fpos, 3));
      fg.setAttribute("aT", new THREE.Float32BufferAttribute(fT, 1));
      fg.setAttribute("aF", new THREE.Float32BufferAttribute(fF, 3));
      fg.setAttribute("aE", new THREE.Float32BufferAttribute(fE, 1));
      fg.setIndex(fidx);
      const frills = new THREE.Mesh(fg, frill);
      frills.frustumCulled = false;
      frills.renderOrder = 1;
      creature.frills = frills;
      creature.group.add(mesh, frills);

      // Seen through the water: the dark shape of its body, and the
      // lights down its flanks. Both are drawn after the surface, so the
      // water cannot hide it completely -- only make it hard to read.
      const shade = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: body.vertexShader,
        fragmentShader: /* glsl */`
          varying vec3 vW;
          void main() {
            if (vW.y > -0.03) discard;
            float d = length(cameraPosition - vW);
            // Darkest just under the skin of the water, fading with depth
            // and distance.
            float a = 0.58 * (1.0 - smoothstep(4.0, 19.0, d)) * (1.0 - smoothstep(-0.12, -0.03, vW.y)) * (0.6 + 0.4 * smoothstep(-1.0, -0.2, vW.y));
            gl_FragColor = vec4(0.0, 0.012, 0.016, a);
          }`
      });
      const shadeMesh = new THREE.Mesh(g, shade);
      shadeMesh.frustumCulled = false;
      shadeMesh.renderOrder = 3;
      creature.group.add(shadeMesh);

      const NL = 13;
      const lp = new Float32Array(NL * 2 * 3);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(lp, 3));
      const lightsMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 600 }, uGlow: creature.glow, uC: { value: col("#5ffcff") } },
        vertexShader: /* glsl */`
          uniform float uScale;
          varying float vUnder;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vUnder = 1.0 - step(0.0, position.y);
            gl_PointSize = (0.07 + vUnder * 0.09) * uScale / max(-mv.z, 0.1);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform float uGlow;
          uniform vec3 uC;
          varying float vUnder;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.75, 1.0, d));
            gl_FragColor = vec4(uC * a * (0.08 + uGlow * 0.85) * (1.0 - vUnder * 0.35), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      });
      const lights = new THREE.Points(lg, lightsMat);
      lights.frustumCulled = false;
      lights.renderOrder = 4;
      creature.lights = { geom: lg, pos: lp, mat: lightsMat, n: NL };
      creature.group.add(lights);
      scene.add(creature.group);
    }
    buildCreature();

    // Two photophores per segment, either side of the spine, at the flank.
    function updateCreatureLights() {
      const L = creature.lights;
      let k = 0;
      for (let n = 0; n < L.n; n++) {
        const i = 2 + n;
        const a = creature.spine[i - 1], c = creature.spine[i + 1], sp = creature.spine[i];
        let tx = a.x - c.x, tz = a.z - c.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const bx = tz, bz = -tx, r = sp.w * 1.3;
        for (const side of [-1, 1]) {
          L.pos[k++] = sp.x + bx * r * side;
          L.pos[k++] = sp.y + sp.w * 0.2;
          L.pos[k++] = sp.z + bz * r * side;
        }
      }
      L.geom.attributes.position.needsUpdate = true;
    }

    // Lay the spine along a path of points from the head back.
    function poseCreature(points) {
      for (let i = 0; i < SPINE; i++) {
        const p = points[Math.min(i, points.length - 1)];
        creature.spine[i].set(p[0], p[1], p[2], PROFILE[i]);
      }
    }

    /* ================================================================ *
     * QUERIES ON THE GRID
     * ================================================================ */
    let map = null;
    function cellIndex(x, z) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (cx < 0 || cz < 0 || cx >= map.W || cz >= map.H) return -1;
      return cz * map.W + cx;
    }
    const typeAt = (x, z) => { const i = cellIndex(x, z); return i < 0 ? T_WALL : map.type[i]; };
    const topAt = (x, z) => { const i = cellIndex(x, z); return i < 0 || map.type[i] === T_WALL ? 99 : map.top[i]; };
    const ceilAt = (x, z) => { const i = cellIndex(x, z); return i < 0 ? 0 : map.ceil[i]; };
    const bodyAt = (x, z) => { const i = cellIndex(x, z); return i < 0 ? -1 : map.body[i]; };
    const centreOf = i => [((i % map.W) + 0.5) * CELL, (((i / map.W) | 0) + 0.5) * CELL];
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    /* ================================================================ *
     * SESSION
     * ================================================================ */
    const state = {
      screen: "menu", sound: SOUND_DEFAULT, haptics: HAPTICS_DEFAULT, look: 1,
      best: 0, bestTime: 0, seed: 0, t: 0, runStart: 0,
      coils: 0, parts: 0, rockets: 0, ducks: 2, boots: false, bazooka: false, hits: 0,
      rocketsFound: 0, rocketsTotal: 0, won: false, submitted: false, explored: null, deathCause: ""
    };
    const COILS_NEEDED = 4, PARTS_NEEDED = 5, MAX_DUCKS = 3;
    const RANKS = [
      { at: 0, name: "Drifter" }, { at: 250, name: "Scavenger" }, { at: 900, name: "Springheel" },
      { at: 2200, name: "Armed" }, { at: 3600, name: "Hunter" }, { at: 9000, name: "Slayer" }
    ];
    function progressScore() {
      let s = state.coils * 100 + state.parts * 150 + state.rocketsFound * 90;
      if (state.boots) s += 500;
      if (state.bazooka) s += 800;
      s += state.hits * 1000;
      if (state.won) s += 5000 + Math.max(0, 3000 - Math.floor((state.t - state.runStart) * 3));
      return s;
    }
    const rankOf = s => { let r = RANKS[0]; for (const k of RANKS) if (s >= k.at) r = k; return r.name; };

    /* ================================================================ *
     * THE PLAYER
     * Feet on the floor, eyes 1.62 m up. In the pool the floor is 0.9 m
     * under the surface, so you wade chest-deep and see the water's skin
     * right in front of you.
     * ================================================================ */
    const RADIUS = 0.3, EYE = 1.62, STEP_UP = 0.4, CLIMB_MAX = 1.3, GRAV = 21;
    const JUMP_BASE = Math.sqrt(2 * GRAV * 1.3);
    const JUMP_BOOTS = Math.sqrt(2 * GRAV * 2.45);
    const P = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -0.05,
      ground: true, coyote: 0, inWater: false, climb: null, stepDist: 0, phase: 0, bobAmt: 0,
      alive: true, sneak: false, moving: 0, shake: 0, roll: 0, fallVy: 0
    };

    // A cell stops you if it is wall, a ledge too high to step onto, or a
    // doorway too low for your head at the height you are at.
    function blocks(i, feet) { return map.type[i] === T_WALL || map.top[i] > feet + STEP_UP || map.ceil[i] < feet + EYE + 0.18; }

    function collideWalls() {
      for (let pass = 0; pass < 2; pass++) {
        const cx = Math.floor(P.x / CELL), cz = Math.floor(P.z / CELL);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, z = cz + dz;
          const out = x < 0 || z < 0 || x >= map.W || z >= map.H;
          if (!out && !blocks(z * map.W + x, P.y)) continue;
          const x0 = x * CELL, z0 = z * CELL;
          const qx = clamp(P.x, x0, x0 + CELL), qz = clamp(P.z, z0, z0 + CELL);
          let ddx = P.x - qx, ddz = P.z - qz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= RADIUS * RADIUS) continue;
          if (d2 < 1e-10) {
            const l = P.x - x0, r = x0 + CELL - P.x, t = P.z - z0, b = z0 + CELL - P.z;
            const m = Math.min(l, r, t, b);
            if (m === l) P.x = x0 - RADIUS; else if (m === r) P.x = x0 + CELL + RADIUS;
            else if (m === t) P.z = z0 - RADIUS; else P.z = z0 + CELL + RADIUS;
            continue;
          }
          const d = Math.sqrt(d2), push = RADIUS - d;
          ddx /= d; ddz /= d;
          P.x += ddx * push; P.z += ddz * push;
          const vn = P.vx * ddx + P.vz * ddz;
          if (vn < 0) { P.vx -= vn * ddx; P.vz -= vn * ddz; }
        }
      }
      for (const c of world.colliders) {
        if (Math.abs(P.y - (c.y ?? 0)) > 3) continue;
        const dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz), m = RADIUS + c.r;
        if (d < m && d > 1e-6) { P.x += (dx / d) * (m - d); P.z += (dz / d) * (m - d); }
      }
    }

    // In the pool and pressed against a ledge low enough to haul onto?
    function climbTarget(dirX, dirZ) {
      if (!P.inWater) return null;
      for (const [dx, dz] of N4) {
        if (dirX * dx + dirZ * dz < 0.45) continue;
        const ex = P.x + dx * (RADIUS + 0.12), ez = P.z + dz * (RADIUS + 0.12);
        const i = cellIndex(ex, ez);
        if (i < 0 || map.type[i] !== T_DRY) continue;
        const top = map.top[i];
        if (top - P.y > CLIMB_MAX) continue;
        // Land half a metre in from the edge.
        const cx = Math.floor(ex / CELL), cz = Math.floor(ez / CELL);
        let tx = P.x, tz = P.z;
        if (dx === 1) tx = cx * CELL + 0.45; if (dx === -1) tx = (cx + 1) * CELL - 0.45;
        if (dz === 1) tz = cz * CELL + 0.45; if (dz === -1) tz = (cz + 1) * CELL - 0.45;
        return { x: tx, z: tz, y: top };
      }
      return null;
    }
    function startClimb(t) {
      P.climb = { t: 0, dur: 0.62, x0: P.x, y0: P.y, z0: P.z, x1: t.x, y1: t.y, z1: t.z };
      P.vx = P.vz = P.vy = 0;
      makeNoise(P.x, P.z, 0.85, "climb");
      sfx.climb();
      haptic("light");
    }

    function stepPlayer(dt) {
      if (P.climb) {
        const c = P.climb;
        c.t += dt;
        const k = clamp(c.t / c.dur, 0, 1);
        const up = Math.min(1, k * 1.6), over = smooth(0.35, 1, k);
        P.x = lerp(c.x0, c.x1, over); P.z = lerp(c.z0, c.z1, over);
        P.y = lerp(c.y0, c.y1, up * up * (3 - 2 * up));
        if (k >= 1) { P.climb = null; P.ground = true; P.inWater = false; sfx.drip(); }
        return;
      }
      const mv = readMove();
      const mag = Math.hypot(mv.x, mv.y);
      const wantMove = mag > 0.12;
      P.sneak = wantMove && (mag < 0.62 || input.sneakKey);
      const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
      const fx = -sy, fz = -cy, rx = cy, rz = -sy;
      let dirX = 0, dirZ = 0;
      if (wantMove) {
        dirX = fx * mv.y + rx * mv.x; dirZ = fz * mv.y + rz * mv.x;
        const L = Math.hypot(dirX, dirZ) || 1;
        dirX /= L; dirZ /= L;
      }
      const water = P.inWater;
      let speed = water ? (P.sneak ? 0.95 : 2.1) : (P.sneak ? 1.7 : 3.7);
      if (!P.ground && state.boots) speed *= 1.25;
      const tx = dirX * (wantMove ? speed : 0), tz = dirZ * (wantMove ? speed : 0);
      const rate = !P.ground ? (water ? 4 : 2.5) : water ? 7 : 14;
      const k = 1 - Math.exp(-rate * dt);
      P.vx += (tx - P.vx) * k;
      P.vz += (tz - P.vz) * k;

      const ox = P.x, oz = P.z;
      P.x += P.vx * dt; P.z += P.vz * dt;
      collideWalls();
      const moved = Math.hypot(P.x - ox, P.z - oz);
      P.moving = moved / Math.max(dt, 1e-4);

      // Haul out of the pool by walking into a low ledge.
      if (water && wantMove) {
        const t = climbTarget(dirX, dirZ);
        if (t) {
          const ex = P.x + dirX * (RADIUS + 0.1), ez = P.z + dirZ * (RADIUS + 0.1);
          if (typeAt(ex, ez) === T_DRY) { P.pushT = (P.pushT || 0) + dt; if (P.pushT > 0.12) { P.pushT = 0; startClimb(t); return; } }
        } else P.pushT = 0;
      }

      // ---- vertical ----
      const g = topAt(P.x, P.z);
      const overWater = typeAt(P.x, P.z) === T_WATER;
      if (P.ground) {
        if (P.y > g + 0.06) { P.ground = false; P.coyote = 0.12; P.vy = 0; }
        else if (g > P.y) P.y = Math.min(g, P.y + dt * 6);        // up a small step
        else P.y = g;
      }
      if (!P.ground) {
        P.coyote -= dt;
        const prevY = P.y;
        P.vy -= GRAV * dt;
        // Water is thick: a fall slows hard once it is in.
        if (P.y < 0 && overWater && P.vy < 0) P.vy *= Math.exp(-7 * dt);
        P.y += P.vy * dt;
        // Mind your head: a spring-booted jump in a low corridor stops at the ceiling.
        const roof = ceilAt(P.x, P.z) - EYE - 0.18;
        if (P.y > roof && P.vy > 0) { P.y = roof; P.vy = 0; }
        if (overWater && prevY >= 0 && P.y < 0) enterWater(-P.vy);
        if (P.y <= g) {
          const impact = -P.vy;
          P.y = g; P.vy = 0; P.ground = true;
          if (!overWater) { sfx.land(impact); if (impact > 7) haptic("light"); }
        }
      }
      P.inWater = overWater && P.y < -0.1;

      // ---- footsteps ----
      if (P.ground && moved > 0.0005) {
        P.stepDist += moved;
        const stride = P.inWater ? 0.72 : P.sneak ? 0.58 : 0.8;
        if (P.stepDist > stride) {
          P.stepDist = 0;
          if (P.inWater) {
            const loud = P.sneak ? 0.26 : 1;
            makeNoise(P.x, P.z, loud, "wade");
            sfx.wade(loud);
            if (!P.sneak) haptic("light");
          } else sfx.step(P.sneak);
        }
        P.phase += moved * (P.inWater ? 4.6 : 5.6);
      }
      P.bobAmt = lerp(P.bobAmt, P.ground && moved > 0.001 ? (P.inWater ? 0.022 : 0.034) : 0, 1 - Math.exp(-8 * dt));
      // A slow wake behind you in the water, for looks; the noise is in the steps.
      if (P.inWater && moved > 0.01) { P.wakeT = (P.wakeT || 0) + dt; if (P.wakeT > 0.45) { P.wakeT = 0; addRipple(P.x, P.z, P.sneak ? 0.012 : 0.022); } }
    }

    function enterWater(vy) {
      // Lowering yourself in at a creep is quiet; dropping or jumping in is not.
      const loud = P.sneak ? 0.45 : clamp(vy / 4.5, 0.6, 2.8);
      makeNoise(P.x, P.z, loud, "splash");
      sfx.splash(loud);
      burstSplash(P.x, P.z, loud);
      haptic(loud > 1.6 ? "medium" : "light");
    }

    function jump() {
      if (state.screen !== "play" || !P.alive || P.climb) return;
      if (P.inWater) {
        // In the pool, JUMP hauls you out onto whatever ledge you face.
        const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
        const t = climbTarget(-sy, -cy);
        if (t) startClimb(t);
        return;
      }
      if (!P.ground && P.coyote <= 0) return;
      P.vy = state.boots ? JUMP_BOOTS : JUMP_BASE;
      P.ground = false; P.coyote = 0;
      sfx.jump(state.boots);
    }

    /* ================================================================ *
     * NOISE
     * Every sound you make in the water is a ripple, and every ripple is
     * something the Listener may hear.
     * ================================================================ */
    const noises = [];
    function makeNoise(x, z, loud, kind) {
      if (typeAt(x, z) === T_WATER || kind === "boom") addRipple(x, z, clamp(0.014 + loud * 0.022, 0.01, 0.09));
      noises.push({ x, z, loud, kind, t: state.t });
      if (C.alive) creatureHear(x, z, loud, kind);
      if (kind !== "duck" && kind !== "boom") lastPlayerNoise = { loud, t: state.t };
    }
    let lastPlayerNoise = { loud: 0, t: -9 };

    /* ================================================================ *
     * THE LISTENER: ITS MIND
     * It swims a path of water cells toward whatever it last heard. It
     * cannot leave the water, and it cannot hear you on dry tiles at all.
     * Between pools it travels through the drains.
     * ================================================================ */
    const C = {
      alive: true, hp: CREATURE_HP, x: 0, y: -0.45, z: 0, heading: 0, speed: 0, state: "wander", timer: 0,
      tx: 0, tz: 0, path: [], pi: 0, body: -1, trail: [], alert: 0.15, rage: 0,
      heardAt: -9, heardN: 0, lastX: 0, lastZ: 0, act: null, travel: null, voice: 0, wakeT: 0, phase: 0
    };
    const TRAIL_STEP = 0.1;

    function bfsPath(fromCell, toCell) {
      if (fromCell === toCell) return [toCell];
      const W = map.W, prev = bfsPath.prev || (bfsPath.prev = new Int32Array(W * map.H));
      prev.fill(-1);
      const q = [fromCell];
      prev[fromCell] = fromCell;
      for (let h = 0; h < q.length; h++) {
        const c = q[h];
        if (c === toCell) break;
        const x = c % W, z = (c / W) | 0;
        for (const [dx, dz] of N4) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= map.H) continue;
          const j = nz * W + nx;
          if (prev[j] !== -1 || map.type[j] !== T_WATER) continue;
          prev[j] = c;
          q.push(j);
        }
      }
      if (prev[toCell] === -1) return null;
      const path = [];
      for (let c = toCell; c !== fromCell; c = prev[c]) path.push(c);
      path.reverse();
      return path;
    }
    // The water cell of this body nearest a point.
    function nearestWater(body, x, z) {
      const b = map.bodies[body];
      if (!b) return -1;
      let best = -1, bd = 1e9;
      for (const c of b.cells) {
        const [cx, cz] = centreOf(c);
        const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    }
    function goTo(x, z) {
      const from = cellIndex(C.x, C.z);
      const to = nearestWater(C.body, x, z);
      C.tx = x; C.tz = z;
      if (from < 0 || to < 0) { C.path = []; return; }
      const p = bfsPath(from, to);
      C.path = p || [];
      C.pi = 0;
    }

    function creatureHear(x, z, loud, kind) {
      if (C.state === "dead" || C.state === "travel") return;
      const d = Math.hypot(x - C.x, z - C.z);
      const sameBody = bodyAt(x, z) === C.body;
      // Another pool hears you through the drains, muffled.
      const reach = HEARING * loud * (sameBody ? 1 : 0.6);
      if (d > reach) return;
      // It hears roughly where, worse with distance.
      // A blind ear: it knows the direction better than the distance.
      const err = (1.0 + d * 0.12) * (1 - Math.min(1, loud / 3));
      const ea = Math.random() * Math.PI * 2, er = Math.sqrt(Math.random()) * err;
      const hx = x + Math.cos(ea) * er, hz = z + Math.sin(ea) * er;
      C.heardN = state.t - C.heardAt < 6 ? C.heardN + 1 : 1;
      C.heardAt = state.t;
      C.lastX = hx; C.lastZ = hz;
      sfx.creatureClick();
      if (!sameBody) {
        // Something far off in another pool: go round through the drains.
        if (loud >= 0.9 && C.state !== "hunt" && C.state !== "todrain") startTravel(bodyAt(x, z), hx, hz);
        return;
      }
      if (C.act) return;   // mid-lunge or mid-bite
      const close = d < 9 || C.heardN >= 2 || kind === "splash" || kind === "boom";
      setState(close && kind !== "duck" ? "hunt" : "investigate");
      goTo(hx, hz);
      if (C.state === "hunt") showEar("It is coming", 2);
      else showEar("It heard something", 1.6);
    }

    function setState(s) {
      if (C.state === s) { C.timer = 0; return; }
      C.state = s; C.timer = 0;
      if (s === "hunt") { sfx.creatureGrowl(); haptic("warning"); }
    }

    function startTravel(toBody, x, z) {
      const from = map.bodies[C.body], to = map.bodies[toBody];
      if (!from || !to || !from.drain || !to.drain) return;
      C.state = "todrain"; C.timer = 0;
      C.travelTo = { body: toBody, x, z };
      goTo(from.drain.x, from.drain.z);
    }

    function wanderTarget() {
      const b = map.bodies[C.body];
      if (!b || !b.cells.length) return;
      // Behind the title it keeps to the room the camera is looking at.
      if (state.screen === "menu" && menuShot && menuShot.cells.length) {
        const [x, z] = centreOf(menuShot.cells[Math.floor(Math.random() * menuShot.cells.length)]);
        goTo(x, z);
        return;
      }
      // Now and then it leaves for another pool.
      if (Math.random() < 0.18) {
        const others = map.bodies.filter(o => o.id !== C.body && o.drain && o.cells.length > 6);
        if (others.length) { const o = others[Math.floor(Math.random() * others.length)]; const [x, z] = centreOf(o.cells[Math.floor(Math.random() * o.cells.length)]); startTravel(o.id, x, z); return; }
      }
      const c = b.cells[Math.floor(Math.random() * b.cells.length)];
      const [x, z] = centreOf(c);
      goTo(x, z);
    }

    function placeCreature() {
      // As far from you as the water allows, in a body big enough to hunt in.
      let best = null;
      for (const b of map.bodies) {
        if (b.cells.length < 8) continue;
        for (const c of b.cells) {
          const [x, z] = centreOf(c);
          const d = Math.hypot(x - P.x, z - P.z);
          if (!best || d > best.d) best = { d, x, z, body: b.id };
        }
      }
      if (!best) { C.alive = false; return; }
      Object.assign(C, { alive: true, hp: CREATURE_HP, x: best.x, z: best.z, y: -0.45, body: best.body, state: "wander", timer: 0, act: null,
        heading: Math.random() * Math.PI * 2, speed: 0, path: [], pi: 0, rage: 0, heardN: 0, heardAt: -9, alert: 0.15, travel: null });
      C.trail.length = 0;
      for (let k = 0; k < SPINE * 5; k++) C.trail.push({ x: best.x - Math.sin(C.heading) * k * TRAIL_STEP, z: best.z - Math.cos(C.heading) * k * TRAIL_STEP });
      wanderTarget();
    }

    function stepCreature(dt) {
      if (!C.alive) return;
      C.timer += dt;
      C.phase += dt;
      const pIn = P.inWater && P.alive && state.screen === "play";
      const dP = Math.hypot(P.x - C.x, P.z - C.z);

      // ---- acts: a lunge at you, a bite at a duck, recoil from a hit ----
      if (C.act) { stepAct(dt, dP, pIn); return; }

      if (C.state === "travel") {
        C.travel.t -= dt;
        // It is in the pipes. The drain it will come out of starts to breathe.
        C.bubbleT = (C.bubbleT || 0) + dt;
        const to = map.bodies[C.travel.body].drain;
        if (C.travel.t < 2.2 && C.bubbleT > 0.05) { C.bubbleT = 0; bubble(to.x, to.z, 0.35); }
        if (C.travel.t <= 0) {
          const to = map.bodies[C.travel.body];
          C.body = to.id;
          C.x = to.drain.x; C.z = to.drain.z; C.y = -1.4;
          C.trail.length = 0;
          for (let k = 0; k < SPINE * 5; k++) C.trail.push({ x: C.x, z: C.z + k * 0.02 });
          sfx.gurgle(C.x, C.z);
          C.travel = null;
          setState("investigate");
          goTo(C.travelTo.x, C.travelTo.z);
        }
        return;
      }

      // ---- choose where to go ----
      let speed = 1.3, depth = state.screen === "menu" ? -0.2 : -0.5, turn = 2.4;
      if (C.state === "wander") {
        if (!C.path.length || C.pi >= C.path.length || C.timer > 14) { C.timer = 0; wanderTarget(); }
      } else if (C.state === "investigate") {
        speed = 2.5; depth = -0.38; turn = 3.2;
        if (C.pi >= C.path.length) { setState("search"); C.searchA = 0; }
      } else if (C.state === "hunt") {
        speed = HUNT_SPEED * (1 + 0.14 * C.rage); depth = -0.24; turn = 4.6;
        if (C.pi >= C.path.length) { setState("search"); C.searchA = 0; }
        if (C.timer > 9) setState("search");
      } else if (C.state === "search") {
        // Circle where it last heard you, listening.
        speed = 1.7; depth = -0.36; turn = 3;
        if (C.pi >= C.path.length) {
          C.searchA = (C.searchA || 0) + 1.3;
          goTo(C.lastX + Math.cos(C.searchA) * 3, C.lastZ + Math.sin(C.searchA) * 3);
        }
        if (C.timer > 10 + C.rage * 2) setState("wander");
      } else if (C.state === "todrain") {
        speed = 2.4; depth = -0.5;
        const d = map.bodies[C.body] && map.bodies[C.body].drain;
        if (!d) setState("wander");
        else if (Math.hypot(d.x - C.x, d.z - C.z) < 1.0) {
          // Down the drain.
          C.state = "travel";
          const to = map.bodies[C.travelTo.body];
          C.travel = { body: to.id, t: 2 + Math.hypot(to.drain.x - d.x, to.drain.z - d.z) / 9 };
          sfx.gurgle(d.x, d.z);
          sfx.gurgle(to.drain.x, to.drain.z, C.travel.t);
          return;
        }
      }

      // ---- bumping into you in the dark ----
      if (pIn && C.state !== "hunt") {
        for (let k = 0; k < SPINE; k += 3) {
          const s = creature.spine[k];
          if (Math.hypot(s.x - P.x, s.z - P.z) < s.w + RADIUS + 0.12) { C.lastX = P.x; C.lastZ = P.z; C.heardAt = state.t; setState("hunt"); goTo(P.x, P.z); showEar("It touched you", 2); break; }
        }
      }
      // ---- the kill ----
      // Freeze, and it has only the place it last heard you. It strikes at
      // a fresh sound, or at something it is actually touching.
      if (C.state === "hunt" && pIn && dP < 2.5 && (state.t - C.heardAt < 1.0 || dP < 0.85)) { startLunge(); return; }
      // ---- ducks: anything squeaking nearby gets bitten ----
      for (const d of ducks) {
        if (d.state !== "float" || bodyAt(d.x, d.z) !== C.body) continue;
        if (Math.hypot(d.x - C.x, d.z - C.z) < 1.3) { startBite(d); return; }
      }

      // ---- swim ----
      let wx = C.tx, wz = C.tz;
      if (C.pi < C.path.length) {
        [wx, wz] = centreOf(C.path[C.pi]);
        if (Math.hypot(wx - C.x, wz - C.z) < 0.9) C.pi++;
      }
      const want = Math.atan2(wx - C.x, wz - C.z);
      let da = want - C.heading;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      C.heading += clamp(da, -turn * dt, turn * dt);
      const slow = 1 - Math.min(0.6, Math.abs(da) / Math.PI);
      // Ease in on the last leg, or it orbits its target forever.
      const arrive = C.pi >= C.path.length - 1 ? clamp(Math.hypot(wx - C.x, wz - C.z) / 2.2, 0.3, 1) : 1;
      C.speed = lerp(C.speed, speed * slow * arrive, 1 - Math.exp(-2.5 * dt));
      const nx = C.x + Math.sin(C.heading) * C.speed * dt, nz = C.z + Math.cos(C.heading) * C.speed * dt;
      if (typeAt(nx, nz) === T_WATER) { C.x = nx; C.z = nz; }
      else {
        // Nose against a ledge: slide along it rather than stop dead.
        if (typeAt(nx, C.z) === T_WATER) C.x = nx;
        else if (typeAt(C.x, nz) === T_WATER) C.z = nz;
        C.heading += 0.9 * dt * Math.sign(da || 1);
      }
      C.y = lerp(C.y, depth, 1 - Math.exp(-1.5 * dt));
      C.alert = lerp(C.alert, C.state === "hunt" ? 1 : C.state === "investigate" || C.state === "search" ? 0.6 : state.screen === "menu" ? 0.4 : 0.14, 1 - Math.exp(-3 * dt));
      // A wake when it moves fast near the surface.
      C.wakeT += dt;
      if (C.speed > 1.8 && C.wakeT > 0.32) { C.wakeT = 0; addRipple(C.x, C.z, 0.018 + C.speed * 0.006); }
    }

    function startLunge() {
      C.act = { kind: "lunge", t: 0, dur: 0.55, x0: C.x, z0: C.z };
      sfx.creatureRoar(C.x, C.z);
      haptic("heavy");
      showEar("RUN", 1);
    }
    function startBite(d) {
      d.state = "bitten";
      C.act = { kind: "bite", t: 0, dur: 1.5, duck: d };
      sfx.creatureBite(C.x, C.z);
      addRipple(d.x, d.z, 0.08);
      burstSplash(d.x, d.z, 1.6);
    }
    function stepAct(dt, dP, pIn) {
      const a = C.act;
      a.t += dt;
      const k = a.t / a.dur;
      if (a.kind === "lunge") {
        // Rear up and throw itself at you.
        const toward = Math.atan2(P.x - C.x, P.z - C.z);
        C.heading = toward;
        const sp = 7.5 * (k < 0.5 ? 0.4 : 1);
        const nx = C.x + Math.sin(toward) * sp * dt, nz = C.z + Math.cos(toward) * sp * dt;
        if (typeAt(nx, nz) === T_WATER) { C.x = nx; C.z = nz; }
        C.y = lerp(C.y, k < 0.6 ? 0.7 : 0.3, 1 - Math.exp(-8 * dt));
        creature.open.value = smooth(0, 0.5, k);
        C.alert = 1.4;
        if (a.t >= a.dur) {
          C.act = null;
          creature.open.value = 0;
          if (pIn && Math.hypot(P.x - C.x, P.z - C.z) < 2.2) { killPlayer(); return; }
          // Missed: thrash, then listen hard for you.
          burstSplash(C.x, C.z, 2);
          addRipple(C.x, C.z, 0.09);
          C.lastX = P.x; C.lastZ = P.z;
          setState("search");
          goTo(C.lastX, C.lastZ);
        }
      } else if (a.kind === "bite") {
        const d = a.duck;
        const toward = Math.atan2(d.x - C.x, d.z - C.z);
        C.heading = lerp(C.heading, toward, 0.2);
        // Head up out of the water over the duck: the moment to shoot.
        C.y = lerp(C.y, k < 0.7 ? 0.85 : -0.2, 1 - Math.exp(-6 * dt));
        creature.open.value = k < 0.45 ? smooth(0, 0.3, k) : 1 - smooth(0.45, 0.7, k);
        C.alert = 1.3;
        if (k > 0.45 && d.state === "bitten") { d.state = "gone"; sfx.squeak(d.x, d.z, true); burstSplash(d.x, d.z, 1.2); }
        if (a.t >= a.dur) { C.act = null; creature.open.value = 0; setState("search"); C.lastX = C.x; C.lastZ = C.z; goTo(C.x, C.z); }
      } else if (a.kind === "hurt") {
        C.y = lerp(C.y, -0.9, 1 - Math.exp(-4 * dt));
        C.alert = 1.5 * (1 - k);
        const away = Math.atan2(C.x - P.x, C.z - P.z);
        const nx = C.x + Math.sin(away) * 5 * dt, nz = C.z + Math.cos(away) * 5 * dt;
        if (typeAt(nx, nz) === T_WATER) { C.x = nx; C.z = nz; }
        if (a.t >= a.dur) { C.act = null; C.rage++; setState("search"); C.lastX = P.x; C.lastZ = P.z; goTo(P.x, P.z); }
      } else if (a.kind === "die") {
        C.y = lerp(C.y, k < 0.3 ? 1.2 : -1.2, 1 - Math.exp(-3 * dt));
        C.alert = Math.max(0, 1.6 * (1 - k));
        creature.open.value = k < 0.5 ? 1 : 1 - k;
        if (a.t >= a.dur) { C.act = null; C.alive = false; C.state = "dead"; }
      }
      pushTrail();
    }

    // Lay the body along where the head has been.
    function pushTrail() {
      const last = C.trail[0];
      if (!last || Math.hypot(C.x - last.x, C.z - last.z) >= TRAIL_STEP) {
        C.trail.unshift({ x: C.x, z: C.z });
        if (C.trail.length > SPINE * 6) C.trail.length = SPINE * 6;
      }
    }
    function poseFromTrail(dt) {
      pushTrail();
      const tr = C.trail;
      let need = 0, acc = 0, ti = 0;
      let px = C.x, pz = C.z;
      for (let i = 0; i < SPINE; i++) {
        need = i * SPINE_GAP;
        while (ti < tr.length - 1) {
          const a = ti === 0 ? { x: C.x, z: C.z } : tr[ti], b = tr[ti + 1];
          const seg = Math.hypot(b.x - a.x, b.z - a.z);
          if (acc + seg >= need) {
            const f = seg > 1e-6 ? (need - acc) / seg : 0;
            px = a.x + (b.x - a.x) * f; pz = a.z + (b.z - a.z) * f;
            break;
          }
          acc += seg; ti++;
        }
        // A sideways swim wave, growing toward the tail.
        const t = i / (SPINE - 1);
        const wave = Math.sin(C.phase * (2.4 + C.speed * 0.9) - i * 0.55) * 0.13 * t * Math.min(1, 0.4 + C.speed * 0.4);
        const a2 = i > 0 ? Math.atan2(px - creature.spine[i - 1].x, pz - creature.spine[i - 1].z) : C.heading;
        const ox = Math.cos(a2) * wave, oz = -Math.sin(a2) * wave;
        // The head rides higher than the tail; acts lift the front half.
        let y = C.y - t * 0.12;
        if (C.act && (C.act.kind === "lunge" || C.act.kind === "bite" || C.act.kind === "die")) {
          y = lerp(C.y, Math.min(C.y, -0.35), smooth(0, 0.45, t));
        }
        creature.spine[i].set(px + ox, y + Math.sin(C.phase * 1.3 - i * 0.4) * 0.03, pz + oz, PROFILE[i]);
      }
      creature.glow.value = lerp(creature.glow.value, C.alert, 1 - Math.exp(-4 * dt));
      creature.group.visible = C.alive && C.state !== "travel";
      updateCreatureLights();
    }

    function killPlayer() {
      if (!P.alive) return;
      P.alive = false;
      state.deathCause = "It heard you.";
      sfx.death();
      haptic("error");
      P.shake = 1.2;
      // The last thing you see: it, right in front of you.
      C.x = P.x + Math.sin(P.yaw) * -1.1; C.z = P.z + Math.cos(P.yaw) * -1.1;
      C.y = 0.6;
      P.deathT = 0;
      flash("#031317", 0.0, 1.2);
      after(1.4, () => finishRun(false));
    }

    /* ================================================================ *
     * ITEMS
     * Spring coils for the boots, five parts for the bazooka, rockets in
     * the worst places, and crates of rubber ducks to throw.
     * ================================================================ */
    const items = [];
    const itemGroup = new THREE.Group();
    scene.add(itemGroup);
    const ITEM_COLORS = { coil: "#7fffd4", part: "#ffcf6a", rocket: "#ff6a4f", crate: "#ffe14d" };

    // Every item of a kind shares its geometry and materials, so a new run
    // allocates nothing the GPU has to be told to forget.
    const KIT = (() => {
      const k = { mat: {}, beam: {}, disc: {} };
      const pts = [];
      for (let i = 0; i <= 60; i++) { const a = (i / 60) * Math.PI * 9; pts.push(new THREE.Vector3(Math.cos(a) * 0.13, (i / 60) * 0.42 - 0.21, Math.sin(a) * 0.13)); }
      k.coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.022, 6);
      k.part = new THREE.BoxGeometry(0.42, 0.12, 0.12);
      k.ring = new THREE.TorusGeometry(0.11, 0.03, 6, 12);
      k.grip = new THREE.BoxGeometry(0.07, 0.2, 0.08);
      k.rocket = new THREE.CylinderGeometry(0.06, 0.06, 0.42, 10);
      k.tip = new THREE.ConeGeometry(0.06, 0.16, 10);
      k.crate = new THREE.BoxGeometry(0.6, 0.38, 0.45);
      k.beamG = new THREE.CylinderGeometry(0.1, 0.34, 2.8, 20, 1, true);
      k.discG = new THREE.PlaneGeometry(1.9, 1.9);
      k.discG.rotateX(-Math.PI / 2);
      k.dark = new THREE.MeshBasicMaterial({ color: col("#1b1f22") });
      k.wood = new THREE.MeshLambertMaterial({ color: col("#6b4a2c"), emissive: col("#1a0f06") });
      k.duckBody = new THREE.SphereGeometry(0.12, 12, 8);
      k.duckHead = new THREE.SphereGeometry(0.075, 10, 8);
      k.duckBeak = new THREE.ConeGeometry(0.03, 0.07, 6);
      k.yellow = new THREE.MeshLambertMaterial({ color: col("#ffd21f"), emissive: col("#3a2a00") });
      k.orange = new THREE.MeshLambertMaterial({ color: col("#ff7a1a"), emissive: col("#301000") });
      k.flight = new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8);
      k.flame = new THREE.MeshBasicMaterial({ color: col("#ffb36a") });
      for (const kind of Object.keys(ITEM_COLORS)) {
        const c = col(ITEM_COLORS[kind]);
        k.mat[kind] = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.4) });
        // A shaft of light, bright at the core and soft at its edges.
        k.beam[kind] = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { uC: { value: c.clone().multiplyScalar(0.5) }, uTime: shared.uTime },
          vertexShader: /* glsl */`
            varying float vY; varying vec3 vN; varying vec3 vV;
            void main() {
              vY = position.y / 2.8 + 0.5;
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
              // Thin out as you walk into it.
              float near = smoothstep(0.9, 3.2, length(vV));
              float a = pow(f, 3.0) * pow(1.0 - vY, 1.7) * (0.75 + 0.25 * sin(uTime * 2.2 - vY * 7.0)) * near;
              gl_FragColor = vec4(uC * a, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`
        });
        // And a pool of it on the floor.
        k.disc[kind] = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
          uniforms: { uC: { value: c.clone().multiplyScalar(0.55) }, uTime: shared.uTime },
          vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv - 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */`
            uniform vec3 uC; uniform float uTime; varying vec2 vUv;
            void main() {
              float r = length(vUv) * 2.0;
              float a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r)) * (0.8 + 0.2 * sin(uTime * 2.2));
              gl_FragColor = vec4(uC * a, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`
        });
      }
      return k;
    })();

    function itemMesh(kind) {
      const g = new THREE.Group();
      const mat = KIT.mat[kind];
      if (kind === "coil") {
        g.add(new THREE.Mesh(KIT.coil, mat));
      } else if (kind === "part") {
        g.add(new THREE.Mesh(KIT.part, mat));
        const ring = new THREE.Mesh(KIT.ring, KIT.dark);
        ring.rotation.y = Math.PI / 2; ring.position.x = 0.12; g.add(ring);
        const grip = new THREE.Mesh(KIT.grip, KIT.dark);
        grip.position.set(-0.08, -0.12, 0); g.add(grip);
      } else if (kind === "rocket") {
        const body = new THREE.Mesh(KIT.rocket, mat);
        body.rotation.z = Math.PI / 2; g.add(body);
        const tip = new THREE.Mesh(KIT.tip, KIT.dark);
        tip.rotation.z = -Math.PI / 2; tip.position.x = 0.29; g.add(tip);
      } else if (kind === "crate") {
        const box = new THREE.Mesh(KIT.crate, KIT.wood);
        box.position.y = -0.1; g.add(box);
        for (let k = 0; k < 3; k++) { const d = duckModel(0.55); d.position.set(-0.15 + k * 0.15, 0.13, (k % 2) * 0.08 - 0.04); d.rotation.y = k; g.add(d); }
      }
      // A shaft of light so it can be found from across a hall.
      const beam = new THREE.Mesh(KIT.beamG, KIT.beam[kind]);
      beam.position.y = 1.15;
      g.add(beam);
      return g;
    }

    function duckModel(scale) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(KIT.duckBody, KIT.yellow);
      body.scale.set(1.25, 0.85, 1);
      g.add(body);
      const head = new THREE.Mesh(KIT.duckHead, KIT.yellow);
      head.position.set(0.09, 0.11, 0);
      g.add(head);
      const beak = new THREE.Mesh(KIT.duckBeak, KIT.orange);
      beak.rotation.z = -Math.PI / 2; beak.position.set(0.17, 0.1, 0);
      g.add(beak);
      g.scale.setScalar(scale || 1);
      return g;
    }
    const duckLight = new THREE.HemisphereLight("#ffffff", "#334455", 1.2);
    scene.add(duckLight);

    function placeItems() {
      for (const it of items) { itemGroup.remove(it.mesh); itemGroup.remove(it.disc); }
      items.length = 0;
      const rng = mulberry32(state.seed ^ 0x5eed);
      const pickFrom = arr => arr.splice(Math.floor(rng() * arr.length), 1)[0];
      // Walking distance from the spawn, through every non-wall cell.
      const dist = new Int32Array(map.W * map.H).fill(-1);
      const start = cellIndex(P.x, P.z);
      const q = [start]; dist[start] = 0;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], x = c % map.W, z = (c / map.W) | 0;
        for (const [dx, dz] of N4) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= map.W || nz >= map.H) continue;
          const j = nz * map.W + nx;
          if (dist[j] >= 0 || map.type[j] === T_WALL) continue;
          dist[j] = dist[c] + 1; q.push(j);
        }
      }
      const used = new Set();
      const wetAround = i => { let n = 0; const x = i % map.W, z = (i / map.W) | 0; for (const [dx, dz] of N4) { const j = (z + dz) * map.W + x + dx; if (map.type[j] === T_WATER) n++; } return n; };
      const roomOf = i => map.zone[i];
      const usedRooms = { coil: new Set(), part: new Set(), rocket: new Set() };
      // Everything but the shelf parts must be reachable on foot alone.
      const r0 = reachMap(map, start, false), r1 = reachMap(map, start, true);
      const candidates = (filter, need) => {
        const ok = need || r0, out = [];
        for (let i = 0; i < map.W * map.H; i++) {
          if (dist[i] < 0 || used.has(i) || !ok[i]) continue;
          if (filter(i)) out.push(i);
        }
        return out;
      };
      const put = (kind, i, y) => {
        used.add(i);
        const [x, z] = centreOf(i);
        const mesh = itemMesh(kind);
        mesh.position.set(x, y, z);
        itemGroup.add(mesh);
        const disc = new THREE.Mesh(KIT.discG, KIT.disc[kind]);
        disc.position.set(x, (map.type[i] === T_WATER ? POOL_Y : map.top[i]) + 0.02, z);
        itemGroup.add(disc);
        items.push({ kind, x, y, z, mesh, disc, cell: i, taken: false, seen: false, refill: 0 });
        if (roomOf(i) >= 0 && usedRooms[kind]) usedRooms[kind].add(roomOf(i));
      };
      const far = i => dist[i] > 6;
      const freshRoom = (kind, i) => !usedRooms[kind] || roomOf(i) < 0 || !usedRooms[kind].has(roomOf(i));
      // Coils: dry footing with water round it, never in the spawn room.
      for (let k = 0; k < COILS_NEEDED; k++) {
        let c = candidates(i => map.type[i] === T_DRY && map.top[i] < 1 && far(i) && wetAround(i) >= 2 && roomOf(i) !== 0 && freshRoom("coil", i));
        if (!c.length) c = candidates(i => map.type[i] === T_DRY && far(i) && roomOf(i) !== 0);
        if (!c.length) continue;
        // Spread them: the k-th coil comes from further along the walk.
        c.sort((a, b) => dist[a] - dist[b]);
        const lo = Math.floor(c.length * 0.15 * k);
        const i = c[clamp(lo + Math.floor(rng() * Math.max(1, c.length * 0.3)), 0, c.length - 1)];
        put("coil", i, map.top[i] + 0.55);
      }
      // Parts: the high shelves first, then the far, wet places.
      let high = candidates(i => map.type[i] === T_DRY && map.top[i] > 1.5, r1);
      for (let k = 0; k < Math.min(2, PARTS_NEEDED); k++) if (high.length) { const i = pickFrom(high); put("part", i, map.top[i] + 0.55); high = high.filter(j => roomOf(j) !== roomOf(i)); }
      while (items.filter(i => i.kind === "part").length < PARTS_NEEDED) {
        let c = candidates(i => map.type[i] === T_DRY && map.top[i] < 1.5 && dist[i] > 10 && wetAround(i) >= 2 && freshRoom("part", i));
        if (!c.length) c = candidates(i => map.type[i] === T_DRY && dist[i] > 4);
        if (!c.length) break;
        c.sort((a, b) => dist[b] - dist[a]);
        const i = c[Math.floor(rng() * Math.min(c.length, 12))];
        put("part", i, map.top[i] + 0.55);
      }
      // Rockets: on the floor of the pools, far out in the open water.
      for (let k = 0; k < ROCKETS; k++) {
        let c = candidates(i => map.type[i] === T_WATER && dist[i] > 8 && wetAround(i) >= 3 && freshRoom("rocket", i));
        if (!c.length) c = candidates(i => map.type[i] === T_WATER && dist[i] > 4);
        if (!c.length) break;
        const i = c[Math.floor(rng() * c.length)];
        put("rocket", i, -0.55);
      }
      // Duck crates: the spawn room, and the other dry rooms.
      const spawnCell = candidates(i => map.type[i] === T_DRY && roomOf(i) === 0 && dist[i] > 0 && dist[i] < 4);
      if (spawnCell.length) put("crate", spawnCell[0], map.top[spawnCell[0]] + 0.3);
      for (const r of map.rooms) {
        if (r.id === 0 || r.style !== "dry") continue;
        const c = candidates(i => roomOf(i) === r.id && map.type[i] === T_DRY);
        if (c.length) { const i = c[Math.floor(rng() * c.length)]; put("crate", i, map.top[i] + 0.3); }
      }
      state.rocketsTotal = items.filter(i => i.kind === "rocket").length;
    }

    function stepItems(dt) {
      const t = shared.uTime.value;
      for (const it of items) {
        if (it.taken) continue;
        const m = it.mesh;
        m.rotation.y += dt * (it.kind === "crate" ? 0 : 1.2);
        if (it.kind !== "crate") m.position.y = it.y + Math.sin(t * 2 + it.x) * 0.06;
        if (it.kind === "crate" && it.refill > 0) it.refill -= dt;
        const d = Math.hypot(P.x - it.x, P.z - it.z);
        if (!it.seen && d < 11) it.seen = true;
        if (!P.alive || state.screen !== "play") continue;
        const reachY = Math.abs((P.y + 0.9) - it.y) < 1.6;
        if (d < 0.95 && reachY) take(it);
      }
    }

    function take(it) {
      if (it.kind === "crate") {
        if (state.ducks >= MAX_DUCKS || it.refill > 0) return;
        state.ducks = MAX_DUCKS;
        it.refill = 1.5;
        toast("Rubber ducks", "Throw one to make a noise somewhere else");
        sfx.pickup(0);
        haptic("light");
        updateHud();
        return;
      }
      it.taken = true;
      itemGroup.remove(it.mesh);
      itemGroup.remove(it.disc);
      sfx.pickup(it.kind === "rocket" ? 2 : 1);
      haptic("success");
      if (it.kind === "coil") {
        state.coils++;
        if (state.coils >= COILS_NEEDED && !state.boots) {
          state.boots = true;
          after(0.6, () => { toast("Spring boots", "Jump higher and further. The high shelves are yours."); sfx.craft(); haptic("success"); });
        } else toast("Spring coil " + state.coils + " of " + COILS_NEEDED, state.coils === 1 ? "Four make a pair of spring boots" : "");
      } else if (it.kind === "part") {
        state.parts++;
        if (state.parts >= PARTS_NEEDED && !state.bazooka) {
          state.bazooka = true;
          after(0.6, () => { toast("Bazooka assembled", state.rockets ? "Lure it up with a duck. Shoot when it surfaces." : "Now find rockets for it"); sfx.craft(); haptic("success"); });
        } else toast("Bazooka part " + state.parts + " of " + PARTS_NEEDED, "");
      } else if (it.kind === "rocket") {
        state.rockets++;
        state.rocketsFound = (state.rocketsFound || 0) + 1;
        toast("Rocket", state.bazooka ? "Loaded" : "Useless without the bazooka -- for now");
      }
      ctx.platform.interact({ type: "pickup", item: it.kind });
      if (typeof ctx.platform.milestone === "function") ctx.platform.milestone("pickup", { item: it.kind, score: progressScore() });
      if (track) track.set(progressScore());
      updateHud();
    }

    /* ================================================================ *
     * DUCKS AND ROCKETS
     * ================================================================ */
    const ducks = [];
    function throwDuck() {
      if (state.screen !== "play" || !P.alive || state.ducks <= 0) return;
      state.ducks--;
      const m = duckModel(1);
      scene.add(m);
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
      const d = { mesh: m, x: P.x + dir.x * 0.5, y: P.y + EYE - 0.2, z: P.z + dir.z * 0.5,
        vx: dir.x * 9 + P.vx, vy: dir.y * 9 + 3.2, vz: dir.z * 9 + P.vz, state: "fly", t: 0, squeakT: 0 };
      ducks.push(d);
      sfx.throwWhoosh();
      updateHud();
    }
    function stepDucks(dt) {
      for (let i = ducks.length - 1; i >= 0; i--) {
        const d = ducks[i];
        d.t += dt;
        if (d.state === "fly") {
          d.vy -= GRAV * 0.75 * dt;
          let nx = d.x + d.vx * dt, nz = d.z + d.vz * dt, ny = d.y + d.vy * dt;
          const tt = typeAt(nx, nz), top = topAt(nx, nz);
          if (tt === T_WALL || ny < top) {
            if (tt === T_WALL || top > d.y) { d.vx *= -0.35; d.vz *= -0.35; nx = d.x; nz = d.z; }
            if (ny < top && tt !== T_WALL) {
              if (tt === T_WATER) {
                d.state = "float"; d.t = 0; ny = 0;
                makeNoise(nx, nz, 2.3, "duck");
                sfx.duckSplash(nx, nz);
                burstSplash(nx, nz, 1.3);
              } else { d.vy *= -0.3; d.vx *= 0.6; d.vz *= 0.6; ny = top; if (Math.abs(d.vy) < 1) { d.state = "rest"; } }
            }
          }
          if (ny > ceilAt(nx, nz) - 0.1) { d.vy = -Math.abs(d.vy) * 0.3; ny = d.y; }
          d.x = nx; d.y = ny; d.z = nz;
          d.mesh.rotation.x += dt * 6; d.mesh.rotation.z += dt * 4;
        } else if (d.state === "float") {
          d.y = Math.sin(d.t * 3) * 0.02 + 0.03;
          d.mesh.rotation.x = lerp(d.mesh.rotation.x, 0, 0.1); d.mesh.rotation.z = lerp(d.mesh.rotation.z, 0, 0.1);
          d.mesh.rotation.y += dt * 0.4;
          d.squeakT += dt;
          if (d.squeakT > 1.4 && d.t < 9) { d.squeakT = 0; makeNoise(d.x, d.z, 1.0, "duck"); sfx.squeak(d.x, d.z); }
          if (d.t > 16) d.state = "gone";
        } else if (d.state === "bitten") {
          d.y = lerp(d.y, 0.5, 0.1);
        } else if (d.state === "rest") {
          d.mesh.rotation.x = 0; d.mesh.rotation.z = 0;
          if (d.t > 20) d.state = "gone";
        }
        d.mesh.position.set(d.x, d.y, d.z);
        if (d.state === "gone") { scene.remove(d.mesh); ducks.splice(i, 1); }
      }
    }

    // The bazooka you carry, drawn in front of the camera.
    const GUN_REST = new THREE.Vector3(0.19, -0.23, -0.62);
    const gun = new THREE.Group();
    let gunLamp = null;
    {
      const metal = new THREE.MeshLambertMaterial({ color: col("#3b4a43"), emissive: col("#0a0f0d") });
      const dark = new THREE.MeshLambertMaterial({ color: col("#1c2320"), emissive: col("#050706") });
      const brass = new THREE.MeshLambertMaterial({ color: col("#c9a250"), emissive: col("#2a1d05") });
      const along = (m, z) => { m.rotation.x = Math.PI / 2; m.position.z = z; gun.add(m); return m; };
      along(new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.86, 18), metal), 0);
      along(new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.068, 0.11, 18), brass), -0.47);
      along(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 18), dark), -0.53);
      along(new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.09, 0.13, 18), metal), 0.47);
      for (const z of [-0.22, 0.16]) along(new THREE.Mesh(new THREE.CylinderGeometry(0.071, 0.071, 0.035, 18), brass), z);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.15, 0.06), dark);
      grip.position.set(0, -0.12, -0.02); grip.rotation.x = 0.25; gun.add(grip);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), dark);
      fore.position.set(0, -0.11, -0.27); fore.rotation.x = 0.15; gun.add(fore);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.07, 0.05), brass);
      sight.position.set(0, 0.095, -0.12); gun.add(sight);
      // A small lamp on the side: lit while there is a rocket in it.
      gunLamp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: col("#ff4b3e") }));
      gunLamp.position.set(-0.07, 0.03, -0.05); gun.add(gunLamp);
      gun.position.copy(GUN_REST);
      gun.rotation.set(0.02, 0.05, 0);
      gun.visible = false;
      camera.add(gun);
      const gunLight = new THREE.PointLight("#ffd9a8", 1.4, 2.5);
      gunLight.position.set(0, 0.25, -0.1);
      camera.add(gunLight);
    }
    const rockets = [];
    function fire() {
      if (state.screen !== "play" || !P.alive || !state.bazooka) return;
      if (state.rockets <= 0) { toast("No rockets", "They glow on the floor of the pools"); sfx.click(); return; }
      state.rockets--;
      camera.updateMatrixWorld();
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const start = new THREE.Vector3(0.24, -0.2, -0.9).applyMatrix4(camera.matrixWorld);
      const m = new THREE.Mesh(KIT.flight, KIT.flame);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      scene.add(m);
      rockets.push({ mesh: m, p: start, v: dir.multiplyScalar(30), t: 0, smokeT: 0 });
      gun.position.z = GUN_REST.z + 0.14;
      P.shake = 0.35;
      sfx.fire();
      haptic("heavy");
      updateHud();
    }
    function stepRockets(dt) {
      gun.position.z = lerp(gun.position.z, GUN_REST.z, 1 - Math.exp(-8 * dt));
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.t += dt;
        r.v.y -= 2.5 * dt;
        const steps = 4;
        let boom = null;
        for (let s = 0; s < steps && !boom; s++) {
          r.p.addScaledVector(r.v, dt / steps);
          const x = r.p.x, y = r.p.y, z = r.p.z;
          // The creature itself.
          if (C.alive) for (let k = 0; k < SPINE; k += 2) {
            const sp = creature.spine[k];
            if ((sp.x - x) ** 2 + (sp.y - y) ** 2 + (sp.z - z) ** 2 < (sp.w + 0.45) ** 2) { boom = { x, y, z, direct: true }; break; }
          }
          if (boom) break;
          const tt = typeAt(x, z);
          if (tt === T_WALL || y < topAt(x, z) || y > ceilAt(x, z) || (tt === T_WATER && y < 0) || r.t > 3) boom = { x, y: Math.max(y, tt === T_WATER ? 0 : y), z, direct: false };
        }
        r.mesh.position.copy(r.p);
        r.smokeT += dt;
        if (r.smokeT > 0.03) { r.smokeT = 0; spawnParticle(r.p.x, r.p.y, r.p.z, 0, 0.2, 0, 0.6, 0.12, [1, 0.6, 0.3]); }
        if (boom) { scene.remove(r.mesh); rockets.splice(i, 1); explode(boom); }
      }
    }
    function explode(b) {
      sfx.explode(b.x, b.z);
      // The fireball: a few big glows that swell and are gone.
      for (let k = 0; k < 7; k++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.35;
        const q = spawnParticle(b.x + Math.cos(a) * r, b.y + 0.25 + Math.random() * 0.4, b.z + Math.sin(a) * r,
          Math.cos(a) * 0.8, 0.6 + Math.random(), Math.sin(a) * 0.8, 0.26 + Math.random() * 0.22, 0.7 + Math.random() * 0.7, [1.9, 1.1, 0.5], 0);
        q.grow = 1.2;
      }
      // Sparks.
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2, u = Math.random();
        spawnParticle(b.x, b.y + 0.1, b.z, Math.cos(a) * 6 * u, 2 + Math.random() * 6, Math.sin(a) * 6 * u, 0.9, 0.1, [1, 0.75 - u * 0.4, 0.3]);
      }
      // On the water, a column of it thrown up into the dark.
      if (typeAt(b.x, b.z) === T_WATER) {
        burstSplash(b.x, b.z, 2.8);
        for (let k = 0; k < 46; k++) {
          const a = Math.random() * Math.PI * 2, u = Math.random();
          spawnParticle(b.x + Math.cos(a) * u * 0.5, 0.05, b.z + Math.sin(a) * u * 0.5, Math.cos(a) * 1.4 * u, 5 + Math.random() * 5, Math.sin(a) * 1.4 * u,
            1.1 + Math.random() * 0.5, 0.07 + Math.random() * 0.08, [0.55, 0.8, 0.85]);
        }
      }
      flash("#ffb36a", 0.6, 0.5);
      P.shake = Math.max(P.shake, 0.6 * clamp(1 - Math.hypot(b.x - P.x, b.z - P.z) / 18, 0.2, 1));
      // Did it catch the thing while its head was up?
      if (C.alive && !(C.act && C.act.kind === "die")) {
        let near = 1e9;
        for (let k = 0; k < 8; k++) { const sp = creature.spine[k]; near = Math.min(near, Math.hypot(sp.x - b.x, sp.y - b.y, sp.z - b.z)); }
        const exposed = creature.spine[2].y > -0.32;
        if ((b.direct || near < 2.1) && exposed) hurtCreature();
        else if (near < 3.5) { C.lastX = b.x; C.lastZ = b.z; setState("hunt"); goTo(b.x, b.z); }
      }
      makeNoise(b.x, b.z, 3, "boom");
      if (P.inWater && Math.hypot(b.x - P.x, b.z - P.z) < 2) { state.deathCause = "Caught in your own blast."; killPlayer(); }
    }
    function hurtCreature() {
      state.hits++;
      C.hp--;
      sfx.creatureHurt(C.x, C.z);
      haptic("heavy");
      if (track) track.set(progressScore());
      if (C.hp <= 0) {
        C.act = { kind: "die", t: 0, dur: 3.2 };
        state.won = true;
        sfx.creatureDeath(C.x, C.z);
        toast("The Listener is dead", "The water is still");
        after(3.6, () => finishRun(true));
      } else {
        C.act = { kind: "hurt", t: 0, dur: 3.5 };
        toast("Hit " + state.hits + " of " + CREATURE_HP, C.hp === 1 ? "One more" : "It will be angrier now");
      }
    }

    /* ================================================================ *
     * PARTICLES: spray, sparks, smoke -- one draw call
     * ================================================================ */
    const PART_MAX = 400;
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
      fragmentShader: /* glsl */`varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 3.2) * (1.0 - smoothstep(0.85, 1.0, d)); gl_FragColor = vec4(vC * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`
    });
    const pPoints = new THREE.Points(pGeom, pMat);
    pPoints.frustumCulled = false;
    pPoints.renderOrder = 5;
    scene.add(pPoints);
    function spawnParticle(x, y, z, vx, vy, vz, life, size, rgb, grav) {
      if (pBuf.live.length >= PART_MAX) pBuf.live.shift();
      const q = { x, y, z, vx, vy, vz, life, t: 0, size, r: rgb[0], g: rgb[1], b: rgb[2], grav: grav === undefined ? 9 : grav, grow: 0 };
      pBuf.live.push(q);
      return q;
    }
    // Bubbles: they rise, wobble, and break the surface in a tiny ring.
    function bubble(x, z, spread) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (spread || 0.3);
      spawnParticle(x + Math.cos(a) * r, POOL_Y + 0.05, z + Math.sin(a) * r, (Math.random() - 0.5) * 0.2, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2,
        3, 0.035 + Math.random() * 0.04, [0.35, 0.7, 0.75], -1.6);
    }
    function burstSplash(x, z, loud) {
      const n = Math.floor(10 + loud * 14);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * 1.6 * loud;
        spawnParticle(x + Math.cos(a) * 0.2, 0.05, z + Math.sin(a) * 0.2, Math.cos(a) * s, 1.5 + Math.random() * 2.5 * loud, Math.sin(a) * s, 0.7 + Math.random() * 0.4, 0.05 + Math.random() * 0.05, [0.45, 0.75, 0.8]);
      }
      addRipple(x, z, clamp(0.03 + loud * 0.025, 0.03, 0.1));
    }
    function stepParticles(dt) {
      const L = pBuf.live;
      for (let i = L.length - 1; i >= 0; i--) {
        const q = L[i];
        q.t += dt;
        if (q.t >= q.life) { L.splice(i, 1); continue; }
        q.vy -= q.grav * dt;
        if (q.grav < 0) { q.vy = Math.min(q.vy, 1.1); q.vx += Math.sin(q.t * 9 + q.size * 100) * dt * 0.6; }
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.grav > 0 && q.y < 0 && typeAt(q.x, q.z) === T_WATER) { q.t = q.life; }
        else if (q.grav < 0 && q.y > -0.03) { q.t = q.life; if (Math.random() < 0.35) addRipple(q.x, q.z, 0.008); }
      }
      const n = Math.min(L.length, PART_MAX);
      for (let i = 0; i < n; i++) {
        const q = L[i], a = 1 - q.t / q.life;
        pBuf.pos[i * 3] = q.x; pBuf.pos[i * 3 + 1] = q.y; pBuf.pos[i * 3 + 2] = q.z;
        pBuf.col[i * 3] = q.r * a; pBuf.col[i * 3 + 1] = q.g * a; pBuf.col[i * 3 + 2] = q.b * a;
        pBuf.size[i] = q.size * (1 + q.grow * (q.t / q.life));
      }
      for (let i = n; i < PART_MAX; i++) pBuf.size[i] = 0;
      pGeom.attributes.position.needsUpdate = true;
      pGeom.attributes.color.needsUpdate = true;
      pGeom.attributes.size.needsUpdate = true;
      pGeom.setDrawRange(0, Math.max(1, n));
    }

    /* ================================================================ *
     * SOUND
     * Everything is synthesised. The baths are one big tiled room, so
     * every sound gets a long generated reverb; the Listener is placed in
     * 3D so you can hear where it is.
     * ================================================================ */
    const sfx = (() => {
      const AC = window.AudioContext || window.webkitAudioContext;
      const noop = () => {};
      const api = {
        unlock: noop, update: noop, step: noop, wade: noop, splash: noop, climb: noop, drip: noop, land: noop, jump: noop,
        pickup: noop, craft: noop, click: noop, throwWhoosh: noop, duckSplash: noop, squeak: noop, fire: noop, explode: noop,
        creatureClick: noop, creatureGrowl: noop, creatureRoar: noop, creatureBite: noop, creatureHurt: noop, creatureDeath: noop,
        gurgle: noop, death: noop, stopAll: noop
      };
      if (!AC || !ctx.capabilities.audio) return api;
      let ac = null, master = null, wet = null, dry = null, noiseBuf = null, voice = null, amb = null, heart = null;
      function ready() {
        if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return ac; }
        try { ac = new AC(); } catch (e) { return null; }
        ctx.onDestroy(() => { try { ac.close(); } catch (e) {} });
        master = ac.createGain(); master.gain.value = state.sound ? 0.9 : 0;
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 4;
        master.connect(comp).connect(ac.destination);
        dry = ac.createGain(); dry.connect(master);
        // A long tiled-hall reverb, made of decaying noise.
        const rev = ac.createConvolver();
        const len = Math.floor(ac.sampleRate * 3.2), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
          const d = ir.getChannelData(ch);
          for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1); }
        }
        rev.buffer = ir;
        wet = ac.createGain(); wet.gain.value = 0.55;
        rev.connect(wet).connect(master);
        api._rev = rev;
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        startAmbience();
        startVoice();
        return ac;
      }
      const out = (node, send) => { node.connect(dry); const s = ac.createGain(); s.gain.value = send ?? 0.4; node.connect(s).connect(api._rev); };
      function panner(x, y, z) {
        const p = ac.createPanner();
        p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 2; p.rolloffFactor = 1.2; p.maxDistance = 60;
        if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
        return p;
      }
      function noise(at, dur, f0, f1, q, peak, type, dest) {
        const src = ac.createBufferSource(); src.buffer = noiseBuf;
        const f = ac.createBiquadFilter(); f.type = type || "bandpass"; f.Q.value = q || 1;
        f.frequency.setValueAtTime(f0, at); if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.012, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        src.connect(f).connect(g); dest ? g.connect(dest) : out(g);
        src.start(at, Math.random() * 1.5); src.stop(at + dur + 0.05);
      }
      function tone(at, dur, f0, f1, type, peak, dest, send) {
        const o = ac.createOscillator(); o.type = type || "sine";
        o.frequency.setValueAtTime(f0, at); if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.01, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g); dest ? g.connect(dest) : out(g, send);
        o.start(at); o.stop(at + dur + 0.05);
      }
      const atPos = (x, y, z) => { const p = panner(x, y, z); out(p, 0.5); return p; };
      function startAmbience() {
        // Room tone, and drips somewhere in the dark.
        const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 180;
        const g = ac.createGain(); g.gain.value = 0.05;
        src.connect(f).connect(g).connect(master); src.start();
        amb = { g };
        const drip = () => {
          if (!ac) return;
          const t = ac.currentTime + 0.05;
          const p = panner(P.x + (Math.random() - 0.5) * 24, 1, P.z + (Math.random() - 0.5) * 24);
          out(p, 0.8);
          tone(t, 0.09, 1400 + Math.random() * 1600, 500, "sine", 0.05, p);
          ctx.timeout(drip, 900 + Math.random() * 3200);
        };
        ctx.timeout(drip, 1500);
      }
      function startVoice() {
        // The Listener's drone: two detuned low saws through a low-pass,
        // placed where it is. Louder and harsher when it hunts.
        const p = panner(0, 0, 0);
        const g = ac.createGain(); g.gain.value = 0;
        const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 160; f.Q.value = 6;
        const o1 = ac.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 41;
        const o2 = ac.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = 43.5;
        const lfo = ac.createOscillator(); lfo.frequency.value = 0.35;
        const lg = ac.createGain(); lg.gain.value = 40; lfo.connect(lg).connect(f.frequency);
        o1.connect(f); o2.connect(f); f.connect(g).connect(p);
        out(p, 0.6);
        o1.start(); o2.start(); lfo.start();
        voice = { p, g, f, o1, o2 };
        // Heartbeat, for when it hunts you.
        const hg = ac.createGain(); hg.gain.value = 0; hg.connect(master);
        heart = { g: hg, next: 0 };
      }
      api.unlock = () => { ready(); };
      api.setEnabled = on => { if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.05); };
      api.update = (dt) => {
        if (!ac) return;
        const L = ac.listener, t = ac.currentTime;
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
        if (L.positionX) {
          L.positionX.value = P.x; L.positionY.value = P.y + EYE; L.positionZ.value = P.z;
          L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz;
          L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
        } else { L.setPosition(P.x, P.y + EYE, P.z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
        if (voice) {
          const vis = C.alive && C.state !== "travel" && state.screen === "play";
          const pr = voice.p;
          if (pr.positionX) { pr.positionX.value = C.x; pr.positionY.value = C.y; pr.positionZ.value = C.z; } else pr.setPosition(C.x, C.y, C.z);
          voice.g.gain.setTargetAtTime(vis ? 0.05 + C.alert * 0.16 : 0, t, 0.3);
          voice.f.frequency.setTargetAtTime(120 + C.alert * 260, t, 0.3);
          voice.o1.frequency.setTargetAtTime(40 + C.alert * 14, t, 0.4);
          voice.o2.frequency.setTargetAtTime(42.5 + C.alert * 17, t, 0.4);
        }
        if (heart && state.screen === "play") {
          const d = Math.hypot(C.x - P.x, C.z - P.z);
          const hunted = C.alive && C.state === "hunt" ? clamp(1 - d / 22, 0.15, 1) : 0;
          heart.next -= dt;
          if (hunted > 0 && heart.next <= 0) {
            heart.next = lerp(0.95, 0.42, hunted);
            tone(t, 0.12, 62, 40, "sine", 0.35 * hunted, heart.g);
            tone(t + 0.16, 0.1, 58, 38, "sine", 0.25 * hunted, heart.g);
            heart.g.gain.setTargetAtTime(0.9, t, 0.05);
            if (hunted > 0.6) haptic("light");
          }
        }
      };
      api.step = (sneak) => { if (!ready()) return; const t = ac.currentTime; noise(t, 0.05, 2400, 900, 1.2, sneak ? 0.05 : 0.11, "bandpass"); tone(t, 0.04, 140, 80, "sine", sneak ? 0.04 : 0.09); };
      api.wade = (loud) => { if (!ready()) return; const t = ac.currentTime; noise(t, 0.32, 380, 1300, 2.2, 0.12 * loud + 0.04); noise(t + 0.05, 0.22, 900, 300, 1.5, 0.06 * loud + 0.02); };
      api.splash = (loud) => { if (!ready()) return; const t = ac.currentTime; noise(t, 0.7 + loud * 0.2, 3200, 300, 0.9, 0.18 + loud * 0.1, "lowpass"); for (let k = 0; k < 5; k++) tone(t + 0.1 + k * 0.07 * Math.random(), 0.08, 900 + Math.random() * 1800, 400, "sine", 0.04); };
      api.climb = () => { if (!ready()) return; const t = ac.currentTime; noise(t, 0.45, 600, 2200, 1.5, 0.12); };
      api.drip = () => { if (!ready()) return; const t = ac.currentTime; for (let k = 0; k < 4; k++) tone(t + k * 0.11 + Math.random() * 0.05, 0.07, 1200 + Math.random() * 1500, 600, "sine", 0.05); };
      api.land = (v) => { if (!ready()) return; const t = ac.currentTime; tone(t, 0.12, 120, 50, "sine", clamp(v / 14, 0.05, 0.25)); noise(t, 0.08, 1800, 600, 1, clamp(v / 30, 0.03, 0.12)); };
      api.jump = (boots) => { if (!ready()) return; const t = ac.currentTime; if (boots) tone(t, 0.18, 300, 900, "triangle", 0.08); noise(t, 0.05, 2000, 900, 1, 0.06); };
      api.pickup = (k) => { if (!ready()) return; const t = ac.currentTime; [0, 4, 7].forEach((st, i) => tone(t + i * 0.06, 0.5, 660 * Math.pow(2, (st + k * 2) / 12), null, "triangle", 0.09, null, 0.7)); };
      api.craft = () => { if (!ready()) return; const t = ac.currentTime; [0, 4, 7, 12, 16].forEach((st, i) => tone(t + i * 0.09, 0.8, 330 * Math.pow(2, st / 12), null, "triangle", 0.1, null, 0.8)); };
      api.click = () => { if (!ready()) return; tone(ac.currentTime, 0.04, 900, 600, "square", 0.04); };
      api.throwWhoosh = () => { if (!ready()) return; noise(ac.currentTime, 0.25, 600, 2400, 2, 0.06); };
      api.duckSplash = (x, z) => { if (!ready()) return; const t = ac.currentTime; const p = atPos(x, 0, z); noise(t, 0.45, 2600, 400, 1, 0.3, "lowpass", p); };
      api.squeak = (x, z, crushed) => { if (!ready()) return; const t = ac.currentTime; const p = atPos(x, 0.1, z); tone(t, crushed ? 0.35 : 0.16, crushed ? 1400 : 1100, crushed ? 500 : 1700, "square", 0.05, p); };
      api.fire = () => { if (!ready()) return; const t = ac.currentTime; noise(t, 0.5, 1800, 200, 0.8, 0.35, "lowpass"); tone(t, 0.25, 160, 50, "sawtooth", 0.2); };
      api.explode = (x, z) => { if (!ready()) return; const t = ac.currentTime; const p = atPos(x, 0.5, z); noise(t, 1.4, 1600, 60, 0.7, 0.9, "lowpass", p); tone(t, 0.9, 70, 28, "sine", 0.7, p); };
      api.creatureClick = () => { if (!ready()) return; const t = ac.currentTime; const p = atPos(C.x, C.y, C.z); for (let k = 0; k < 6; k++) tone(t + k * 0.045, 0.012, 3200 + Math.random() * 1500, null, "square", 0.04, p); };
      api.creatureGrowl = () => { if (!ready()) return; const t = ac.currentTime; const p = atPos(C.x, C.y, C.z); noise(t, 1.4, 220, 140, 6, 0.35, "bandpass", p); tone(t, 1.3, 55, 38, "sawtooth", 0.25, p); };
      api.creatureRoar = (x, z) => { if (!ready()) return; const t = ac.currentTime; const p = atPos(x, 0.5, z); noise(t, 0.9, 600, 180, 3, 0.6, "bandpass", p); tone(t, 0.8, 140, 60, "sawtooth", 0.4, p); tone(t, 0.6, 2100, 900, "sawtooth", 0.08, p); };
      api.creatureBite = (x, z) => { if (!ready()) return; const t = ac.currentTime; const p = atPos(x, 0.5, z); noise(t, 0.7, 500, 200, 2.5, 0.5, "bandpass", p); tone(t + 0.4, 0.12, 200, 70, "square", 0.25, p); };
      api.creatureHurt = (x, z) => { if (!ready()) return; const t = ac.currentTime; const p = atPos(x, 0.5, z); tone(t, 1.2, 900, 200, "sawtooth", 0.3, p); noise(t, 1, 1400, 300, 2, 0.4, "bandpass", p); };
      api.creatureDeath = (x, z) => { if (!ready()) return; const t = ac.currentTime; const p = atPos(x, 0.5, z); tone(t, 3, 700, 60, "sawtooth", 0.35, p); tone(t + 0.3, 2.6, 300, 40, "square", 0.15, p); noise(t, 3, 900, 80, 1.5, 0.4, "bandpass", p); };
      api.gurgle = (x, z, delay) => { if (!ready()) return; const t = ac.currentTime + (delay || 0); const p = atPos(x, -0.6, z); for (let k = 0; k < 7; k++) tone(t + k * 0.13 + Math.random() * 0.05, 0.12, 180 + Math.random() * 220, 90, "sine", 0.18, p); noise(t, 1.1, 300, 120, 3, 0.15, "bandpass", p); };
      api.death = () => { if (!ready()) return; const t = ac.currentTime; noise(t, 1.8, 900, 80, 1.2, 0.7, "lowpass"); tone(t, 1.6, 90, 30, "sawtooth", 0.4); };
      return api;
    })();

    function haptic(kind) {
      if (state.haptics && ctx.capabilities.haptics && typeof ctx.platform.haptic === "function") ctx.platform.haptic(kind);
    }

    /* ================================================================ *
     * STORAGE: a convenience, never a dependency
     * ================================================================ */
    const SAVE_KEY = "still-water/v1";
    const canRead = () => !!(ctx.storage && typeof ctx.storage.get === "function");
    const canWrite = () => !!(ctx.storage && typeof ctx.storage.set === "function");
    function save() {
      if (!canWrite()) return;
      try {
        const r = ctx.storage.set(SAVE_KEY, { sound: state.sound, haptics: state.haptics, look: state.look, best: state.best, bestTime: state.bestTime });
        if (r && typeof r.catch === "function") r.catch(() => {});
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
     * THE OVERLAY: HUD, controls, menus
     * ================================================================ */
    const root = ctx.createRoot({ className: "sw" });
    root.innerHTML = `<style>${HUD_CSS()}</style>
<div class="sw-touch" data-touch></div>
<div class="sw-hud" data-hud hidden>
  <div class="sw-obj"><small data-chapter>Chapter one</small><b data-obj>Find the spring coils</b></div>
  <div class="sw-inv" data-inv></div>
  <div class="sw-ear" data-ear><i></i><span data-eartext></span></div>
  <div class="sw-map" data-mapwrap><svg data-map viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg></div>
  <div class="sw-cross" data-cross></div>
  <div class="sw-toast" data-toast></div>
</div>
<div class="sw-stick" data-stick hidden><i data-knob></i></div>
<div class="sw-btns" data-btns hidden>
  <button class="sw-btn sw-throw" data-btn="throw"><span data-duckcount>2</span><em>Duck</em></button>
  <button class="sw-btn sw-fire" data-btn="fire" hidden><span data-rocketcount>0</span><em>Fire</em></button>
  <button class="sw-btn sw-jump" data-btn="jump"><em>Jump</em></button>
</div>
<div class="sw-flash" data-flash></div>
<div class="sw-modal" data-modal></div>`;
    const $ = sel => root.querySelector(sel);
    const touch = $("[data-touch]"), hud = $("[data-hud]"), stickEl = $("[data-stick]"), knob = $("[data-knob]");
    const btns = $("[data-btns]"), modal = $("[data-modal]"), flashEl = $("[data-flash]");
    const objEl = $("[data-obj]"), chapterEl = $("[data-chapter]"), invEl = $("[data-inv]"), earEl = $("[data-ear]"), earText = $("[data-eartext]");
    const mapSvg = $("[data-map]"), toastEl = $("[data-toast]"), crossEl = $("[data-cross]");
    const fireBtn = $("[data-btn=fire]"), duckCount = $("[data-duckcount]"), rocketCount = $("[data-rocketcount]");

    function applySafeArea() {
      const sa = ctx.safeArea || {};
      for (const k of ["top", "right", "bottom", "left"]) root.style.setProperty("--sa" + k[0], (sa[k] || 0) + "px");
    }
    applySafeArea();
    ctx.listen(window, "resize", applySafeArea);

    function HUD_CSS() {
      return `
.sw{position:absolute;inset:0;overflow:hidden;pointer-events:none!important;color:#eef6f5;
  font-family:"SW Inter",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}
.sw *{box-sizing:border-box}
.sw [hidden]{display:none!important}
.sw-touch{position:absolute;inset:0;pointer-events:auto!important;touch-action:none}
.sw-hud{position:absolute;inset:0;pointer-events:none}
.sw-obj{position:absolute;left:calc(var(--sal) + 16px);top:calc(var(--sat) + 14px);max-width:58vw;
  display:flex;flex-direction:column;gap:3px;text-shadow:0 1px 8px rgba(0,0,0,.7)}
.sw-obj small{font-size:10px;letter-spacing:.24em;text-transform:uppercase;opacity:.6;font-weight:600}
.sw-obj b{font-family:"SW Serif","Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:400;font-size:21px;line-height:1.1}
.sw-inv{position:absolute;right:calc(var(--sar) + 14px);top:calc(var(--sat) + 14px);display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.sw-chip{display:flex;align-items:center;gap:7px;padding:5px 10px 5px 8px;border-radius:999px;background:rgba(4,12,14,.42);
  backdrop-filter:blur(6px);font-size:12px;font-weight:600;letter-spacing:.04em;font-variant-numeric:tabular-nums}
.sw-chip svg{width:15px;height:15px}
.sw-chip.done{background:rgba(70,200,170,.28)}
.sw-ear{position:absolute;left:50%;top:calc(var(--sat) + 16px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;opacity:.85}
.sw-ear i{width:12px;height:12px;border-radius:50%;background:#5ffcff;box-shadow:0 0 12px #5ffcff;opacity:.25;transition:opacity .4s,background .4s,box-shadow .4s}
.sw-ear.l1 i{opacity:.9;background:#ffd36a;box-shadow:0 0 16px #ffd36a}
.sw-ear.l2 i{opacity:1;background:#ff4b3e;box-shadow:0 0 22px #ff4b3e;animation:swPulse .5s infinite alternate}
.sw-ear span{font-family:"SW Serif",Georgia,serif;font-style:italic;font-size:16px;opacity:0;transition:opacity .4s;text-shadow:0 1px 10px #000;white-space:nowrap}
.sw-ear span.on{opacity:1}
@keyframes swPulse{from{transform:scale(.8)}to{transform:scale(1.25)}}
.sw-map{position:absolute;left:calc(var(--sal) + 14px);top:calc(var(--sat) + 72px);width:92px;height:92px;border-radius:16px;
  background:rgba(3,10,12,.6);backdrop-filter:blur(5px);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.13),0 6px 20px rgba(0,0,0,.35)}
.sw-map svg{width:100%;height:100%}
.sw-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;
  background:rgba(255,255,255,.75);box-shadow:0 0 0 1.5px rgba(0,0,0,.35);opacity:0;transition:opacity .2s}
.sw-cross.on{opacity:1}
.sw-toast{position:absolute;left:50%;top:32%;transform:translate(-50%,0);text-align:center;opacity:0;transition:opacity .5s, transform .5s;
  text-shadow:0 2px 14px rgba(0,0,0,.9);width:86vw}
.sw-toast.on{opacity:1;transform:translate(-50%,-6px)}
.sw-toast b{display:block;font-family:"SW Serif","Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:400;font-size:32px;line-height:1.05}
.sw-toast span{display:block;margin-top:6px;font-size:13px;opacity:.78;letter-spacing:.02em}
.sw-stick{position:absolute;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;
  border:1.5px solid rgba(255,255,255,.28);background:radial-gradient(circle,rgba(255,255,255,.06),rgba(255,255,255,.02) 60%,transparent 61%);pointer-events:none}
.sw-stick::before{content:"";position:absolute;inset:26%;border-radius:50%;border:1px dashed rgba(120,230,255,.35)}
.sw-stick i{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
  background:rgba(255,255,255,.28);box-shadow:0 0 0 1.5px rgba(255,255,255,.4)}
.sw-stick.quiet i{background:rgba(110,230,255,.35);box-shadow:0 0 14px rgba(110,230,255,.6)}
.sw-btns{position:absolute;right:calc(var(--sar) + 16px);bottom:calc(var(--sab) + 18px);display:grid;
  grid-template-columns:auto auto;grid-template-rows:auto auto;gap:12px;align-items:end;justify-items:end;pointer-events:none}
.sw-btn{pointer-events:auto!important;appearance:none;border:0;border-radius:50%;color:#f1fbfa;font:inherit;touch-action:none;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  background:rgba(8,22,26,.38);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.28);backdrop-filter:blur(6px);
  transition:transform .08s,background .08s}
.sw-btn em{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;opacity:.85}
.sw-btn span{font-size:18px;font-weight:700;line-height:1}
.sw-btn.on{transform:scale(.92);background:rgba(110,230,255,.3)}
.sw-jump{grid-column:2;grid-row:2;width:92px;height:92px}
.sw-throw{grid-column:1;grid-row:2;width:66px;height:66px;margin-bottom:6px}
.sw-fire{grid-column:2;grid-row:1;width:72px;height:72px;background:rgba(120,30,20,.45);box-shadow:inset 0 0 0 1.5px rgba(255,150,110,.55)}
.sw-throw.empty{opacity:.4}
.sw-flash{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}
.sw::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 48%,rgba(0,0,0,0) 52%,rgba(0,0,0,.55) 100%)}
.sw-modal{position:absolute;inset:0;z-index:20;pointer-events:auto!important;display:flex;flex-direction:column;justify-content:flex-end;
  padding:calc(var(--sat) + 24px) calc(var(--sar) + 22px) calc(var(--sab) + 28px) calc(var(--sal) + 22px);
  background:linear-gradient(180deg,rgba(2,6,8,.15) 0%,rgba(2,6,8,.35) 40%,rgba(2,6,8,.88) 100%)}
.sw-title{margin:0 0 4px;font-family:"SW Serif","Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;
  font-size:min(19vw,92px);line-height:.86;letter-spacing:-.01em;text-shadow:0 4px 40px rgba(60,230,210,.25)}
.sw-tag{margin:0 0 22px;font-size:14px;letter-spacing:.06em;opacity:.75}
.sw-tag b{color:#7ff3e0;font-weight:600}
.sw-go{appearance:none;border:0;width:100%;min-height:58px;border-radius:18px;font:inherit;font-size:15px;font-weight:700;letter-spacing:.2em;
  text-transform:uppercase;color:#031417;background:linear-gradient(180deg,#9ff7e8,#5fd9c6);box-shadow:0 10px 40px rgba(60,230,210,.25);touch-action:manipulation}
.sw-row{display:flex;gap:10px;margin-top:12px}
.sw-ghost{flex:1;appearance:none;border:0;min-height:46px;border-radius:14px;font:inherit;font-size:12px;font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:#d8eeeb;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);touch-action:manipulation}
.sw-tips{display:flex;flex-direction:column;gap:10px;margin:0 0 20px}
.sw-tip{display:flex;gap:12px;align-items:flex-start;font-size:13.5px;line-height:1.45;opacity:.86}
.sw-tip i{flex:none;width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-style:normal;
  background:rgba(127,243,224,.14);color:#7ff3e0;font-size:12px;font-weight:700}
.sw-stats{list-style:none;margin:0 0 22px;padding:0;display:flex;flex-direction:column;gap:9px}
.sw-stats li{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:8px}
.sw-stats li span{opacity:.65}
.sw-stats li b{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.sw-rank{display:inline-block;margin:0 0 16px;padding:6px 12px;border-radius:999px;background:rgba(127,243,224,.14);color:#9ff7e8;
  font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}
.sw-build{font-size:10px;letter-spacing:.2em;opacity:.35;margin-top:14px;text-align:center}
`;
    }

    const ICONS = {
      coil: '<svg viewBox="0 0 16 16" fill="none" stroke="#7fffd4" stroke-width="1.6"><path d="M3 4c0-1.5 10-1.5 10 0s-10 1.5-10 3 10 1.5 10 3-10 1.5-10 3"/></svg>',
      part: '<svg viewBox="0 0 16 16" fill="none" stroke="#ffcf6a" stroke-width="1.6"><rect x="2" y="6" width="10" height="4" rx="1"/><path d="M12 7h2v2h-2M6 10v3"/></svg>',
      rocket: '<svg viewBox="0 0 16 16" fill="none" stroke="#ff7a5c" stroke-width="1.6"><path d="M2 8h9l3-2v4l-3-2M4 8v-2M4 8v2"/></svg>',
      boots: '<svg viewBox="0 0 16 16" fill="none" stroke="#7fffd4" stroke-width="1.6"><path d="M4 2v8h7l2 2v1H3V2"/><path d="M5 13v2M10 13v2"/></svg>'
    };
    function updateHud() {
      const chips = [];
      if (state.boots) chips.push(`<div class="sw-chip done">${ICONS.boots}Boots</div>`);
      else chips.push(`<div class="sw-chip">${ICONS.coil}${state.coils}/${COILS_NEEDED}</div>`);
      if (state.bazooka) chips.push(`<div class="sw-chip done">${ICONS.part}Bazooka</div>`);
      else chips.push(`<div class="sw-chip">${ICONS.part}${state.parts}/${PARTS_NEEDED}</div>`);
      if (state.rockets || state.bazooka || (state.rocketsFound || 0) > 0) chips.push(`<div class="sw-chip">${ICONS.rocket}${state.rockets}</div>`);
      invEl.innerHTML = chips.join("");
      duckCount.textContent = state.ducks;
      $("[data-btn=throw]").classList.toggle("empty", state.ducks <= 0);
      fireBtn.hidden = !state.bazooka;
      rocketCount.textContent = state.rockets;
      gun.visible = state.bazooka && P.alive;
      gunLamp.material.color.set(state.rockets > 0 ? "#ff4b3e" : "#2a1513");
      crossEl.classList.toggle("on", state.bazooka);
      // The objective, as a chapter.
      let ch = "Chapter one", obj = "Find four spring coils";
      if (state.boots && !state.bazooka) { ch = "Chapter two"; obj = "Find the five bazooka parts"; }
      if (state.bazooka && state.rockets === 0 && state.hits < CREATURE_HP) {
        const left = items.some(it => it.kind === "rocket" && !it.taken);
        ch = "Chapter three"; obj = left ? (state.rocketsFound ? "Out of rockets. More lie in the pools" : "Find rockets on the pool floors") : "No rockets left. Survive";
      }
      if (state.bazooka && state.rockets > 0) { ch = "Chapter four"; obj = "Lure it up with a duck. Fire."; }
      if (!state.boots && state.coils >= COILS_NEEDED) obj = "Find four spring coils";
      chapterEl.textContent = ch; objEl.textContent = obj;
    }

    let toastT = 0;
    function toast(title, sub) {
      toastEl.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}`;
      toastEl.classList.add("on");
      toastT = 2.8;
    }
    let earT = 0;
    function showEar(text, secs) {
      earText.textContent = text;
      earText.classList.add("on");
      earT = secs || 2;
    }
    let flashA = 0, flashTarget = 0, flashSpeed = 1;
    function flash(color, a, secs) {
      flashEl.style.background = color;
      flashA = a; flashTarget = 0; flashSpeed = 1 / Math.max(0.05, secs);
      if (color === "#031317") { flashA = 0; flashTarget = 0.88; }
    }

    /* ---- the minimap: what you have seen, drawn as you see it ---- */
    let mapT = 0;
    function updateMap(dt) {
      mapT += dt;
      if (mapT < 0.4 || !state.explored) return;
      mapT = 0;
      const ex = state.explored;
      const R = 6;        // cells of view either side
      const pcx = Math.floor(P.x / CELL), pcz = Math.floor(P.z / CELL);
      for (let z = pcz - 4; z <= pcz + 4; z++) for (let x = pcx - 4; x <= pcx + 4; x++) {
        if (x >= 0 && z >= 0 && x < map.W && z < map.H && Math.hypot(x - pcx, z - pcz) < 4.6) ex[z * map.W + x] = 1;
      }
      let dryP = "", wetP = "";
      const s = 100 / (R * 2 + 1);
      for (let z = pcz - R; z <= pcz + R; z++) for (let x = pcx - R; x <= pcx + R; x++) {
        if (x < 0 || z < 0 || x >= map.W || z >= map.H) continue;
        const i = z * map.W + x;
        if (!ex[i] || map.type[i] === T_WALL) continue;
        const sx = (x - pcx + R) * s, sz = (z - pcz + R) * s;
        const r = `M${sx.toFixed(1)} ${sz.toFixed(1)}h${s.toFixed(1)}v${s.toFixed(1)}h${(-s).toFixed(1)}z`;
        if (map.type[i] === T_WATER) wetP += r; else dryP += r;
      }
      let marks = "";
      for (const it of items) {
        if (it.taken || !it.seen) continue;
        const cx = it.x / CELL - pcx - 0.5 + R, cz = it.z / CELL - pcz - 0.5 + R;
        if (cx < 0 || cz < 0 || cx > R * 2 || cz > R * 2) continue;
        marks += `<circle cx="${((cx + 0.5) * s).toFixed(1)}" cy="${((cz + 0.5) * s).toFixed(1)}" r="3.6" fill="${ITEM_COLORS[it.kind]}" stroke="rgba(0,0,0,.5)" stroke-width="1"/>`;
      }
      const ax = (P.x / CELL - pcx - 0.5 + R + 0.5) * s, az = (P.z / CELL - pcz - 0.5 + R + 0.5) * s;
      const ang = (-P.yaw * 180) / Math.PI;
      mapSvg.innerHTML = `<path d="${wetP}" fill="rgba(46,240,210,.32)"/><path d="${dryP}" fill="rgba(234,220,196,.62)"/>${marks}` +
        `<g transform="translate(${ax.toFixed(1)} ${az.toFixed(1)}) rotate(${ang.toFixed(0)})"><path d="M0 -7 L5 5.5 L0 3 L-5 5.5z" fill="#fff" stroke="rgba(0,0,0,.6)" stroke-width="1"/></g>`;
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
    ctx.listen(touch, "pointerdown", e => {
      if (state.screen !== "play") return;
      if (e.cancelable) e.preventDefault();
      const r = touch.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.pointerType !== "mouse" && x < r.width * 0.46 && stick.id === null) {
        Object.assign(stick, { id: e.pointerId, ox: x, oy: y, x, y });
        stickEl.style.left = x + "px"; stickEl.style.top = y + "px";
        knob.style.transform = "translate(0,0)";
        stickEl.hidden = false;
      } else if (lookPtr.id === null) {
        Object.assign(lookPtr, { id: e.pointerId, lx: e.clientX, ly: e.clientY });
      }
      try { touch.setPointerCapture(e.pointerId); } catch (err) { /* the window listener covers release */ }
      sfx.unlock();
    });
    ctx.listen(touch, "pointermove", e => {
      if (e.pointerId === stick.id) {
        const r = touch.getBoundingClientRect();
        stick.x = e.clientX - r.left; stick.y = e.clientY - r.top;
        // The base follows a thumb that runs past the rim.
        const dx = stick.x - stick.ox, dy = stick.y - stick.oy, L = Math.hypot(dx, dy);
        if (L > 70) { stick.ox += (dx / L) * (L - 70); stick.oy += (dy / L) * (L - 70); stickEl.style.left = stick.ox + "px"; stickEl.style.top = stick.oy + "px"; }
        const kx = clamp(stick.x - stick.ox, -56, 56), ky = clamp(stick.y - stick.oy, -56, 56);
        knob.style.transform = `translate(${kx}px,${ky}px)`;
        stickEl.classList.toggle("quiet", Math.hypot(kx, ky) / 56 < 0.62 && Math.hypot(kx, ky) > 7);
      } else if (e.pointerId === lookPtr.id) {
        input.lookDX += e.clientX - lookPtr.lx; input.lookDY += e.clientY - lookPtr.ly;
        lookPtr.lx = e.clientX; lookPtr.ly = e.clientY;
      }
    });
    const release = e => {
      if (e.pointerId === stick.id) { stick.id = null; stickEl.hidden = true; stickEl.classList.remove("quiet"); }
      if (e.pointerId === lookPtr.id) lookPtr.id = null;
    };
    ctx.listen(touch, "pointerup", release);
    ctx.listen(touch, "pointercancel", release);
    ctx.listen(window, "pointerup", release);
    ctx.listen(window, "pointercancel", release);
    ctx.listen(window, "blur", () => { stick.id = null; lookPtr.id = null; stickEl.hidden = true; input.keys = {}; });

    // Buttons fire on the press, each with its own finger.
    ctx.listen(btns, "pointerdown", e => {
      const b = e.target && e.target.closest ? e.target.closest("[data-btn]") : null;
      if (!b || state.screen !== "play") return;
      if (e.cancelable) e.preventDefault();
      b.classList.add("on");
      setTimeout2(() => b.classList.remove("on"), 140);
      const k = b.getAttribute("data-btn");
      if (k === "jump") jump(); else if (k === "throw") throwDuck(); else if (k === "fire") fire();
      sfx.unlock();
    });
    ctx.listen(window, "keydown", e => {
      if (e.repeat) return;
      input.keys[e.code] = true;
      if (state.screen === "play") {
        if (e.code === "Space") { e.preventDefault(); jump(); }
        else if (e.code === "KeyE" || e.code === "KeyQ") throwDuck();
        else if (e.code === "KeyF" || e.code === "Enter") fire();
        else if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sneakKey = true;
        else if (e.code === "ArrowLeft") input.turnL = true;
        else if (e.code === "ArrowRight") input.turnR = true;
      } else if (e.code === "Enter" && !modal.hidden) { const go = modal.querySelector("[data-go]"); if (go) go.click(); }
    });
    ctx.listen(window, "keyup", e => {
      input.keys[e.code] = false;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sneakKey = false;
      if (e.code === "ArrowLeft") input.turnL = false;
      if (e.code === "ArrowRight") input.turnR = false;
    });

    /* ---- timers that die with the bit ---- */
    function setTimeout2(fn, ms) { return ctx.timeout ? ctx.timeout(fn, ms) : setTimeout(fn, ms); }
    // Game beats run on the game's own clock, so they pause with it.
    const beats = [];
    function after(secs, fn) { beats.push({ at: state.t + secs, fn }); }
    function runBeats() {
      for (let i = beats.length - 1; i >= 0; i--) if (state.t >= beats[i].at) { const b = beats.splice(i, 1)[0]; b.fn(); }
    }

    /* ================================================================ *
     * MENUS
     * ================================================================ */
    const BUILD = "sw-b1";
    function menuHtml() {
      const best = state.best ? `<p class="sw-tag">Best: <b>${rankOf(state.best)}</b> &middot; ${state.best} pts${state.bestTime ? ` &middot; slain in ${fmtTime(state.bestTime)}` : ""}</p>` : "";
      return `<h1 class="sw-title">Still<br>Water</h1>
<p class="sw-tag">It cannot see you. <b>It hears the water.</b></p>
${best}
<div class="sw-tips">
  <div class="sw-tip"><i>1</i><span>Dry tiles are silent. Every step you wade, it hears. Push the stick gently to wade slowly and quietly; stand still and you are nothing.</span></div>
  <div class="sw-tip"><i>2</i><span>Four spring coils make jump boots. Five parts make a bazooka. Rockets lie on the pool floors.</span></div>
  <div class="sw-tip"><i>3</i><span>Throw a rubber duck to make it look elsewhere. When it rears up to bite, fire.</span></div>
</div>
<button class="sw-go" data-go>Enter the baths</button>
<div class="sw-row">
  <button class="sw-ghost" data-sound>Sound ${state.sound ? "on" : "off"}</button>
  <button class="sw-ghost" data-haptics>Buzz ${state.haptics ? "on" : "off"}</button>
  <button class="sw-ghost" data-look>Look ${state.look < 0.8 ? "slow" : state.look > 1.3 ? "fast" : "normal"}</button>
</div>
<p class="sw-build">${BUILD}</p>`;
    }
    const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    function resultHtml(won) {
      const secs = Math.max(0, state.t - state.runStart);
      const score = progressScore();
      return `<span class="sw-rank">${rankOf(score)}</span>
<h1 class="sw-title" style="font-size:min(15vw,72px)">${won ? "Still<br>water." : "It heard<br>you."}</h1>
<p class="sw-tag">${won ? "The Listener is dead." : state.deathCause === "It heard you." ? "The water carried every step." : state.deathCause}</p>
<ul class="sw-stats">
  <li><span>Progress</span><b>${score} pts</b></li>
  <li><span>Spring coils</span><b>${state.boots ? "Boots" : state.coils + " / " + COILS_NEEDED}</b></li>
  <li><span>Bazooka parts</span><b>${state.bazooka ? "Built" : state.parts + " / " + PARTS_NEEDED}</b></li>
  <li><span>Hits on it</span><b>${state.hits} / ${CREATURE_HP}</b></li>
  <li><span>Time in the baths</span><b>${fmtTime(secs)}</b></li>
</ul>
<button class="sw-go" data-go>Go back in</button>
<div class="sw-row"><button class="sw-ghost" data-menu>Title</button></div>`;
    }
    function showModal(html) {
      modal.innerHTML = html;
      modal.hidden = false;
      hud.hidden = true; btns.hidden = true; stickEl.hidden = true;
      stick.id = null; lookPtr.id = null;
    }
    function hideModal() { modal.innerHTML = ""; modal.hidden = true; hud.hidden = false; btns.hidden = false; }
    ctx.listen(modal, "click", e => {
      const el = e.target && e.target.closest ? e.target.closest("[data-go],[data-menu],[data-sound],[data-haptics],[data-look]") : null;
      if (!el) return;
      sfx.unlock();
      if (el.hasAttribute("data-go")) { startRun(); return; }
      if (el.hasAttribute("data-menu")) { gotoMenu(); return; }
      if (el.hasAttribute("data-sound")) { state.sound = !state.sound; sfx.setEnabled && sfx.setEnabled(state.sound); }
      else if (el.hasAttribute("data-haptics")) { state.haptics = !state.haptics; haptic("light"); }
      else if (el.hasAttribute("data-look")) { state.look = state.look < 0.8 ? 1 : state.look > 1.3 ? 0.6 : 1.6; }
      save();
      showModal(menuHtml());
    });
    function gotoMenu() { state.screen = "menu"; stageMenuCreature(); showModal(menuHtml()); }

    /* ================================================================ *
     * RUN LIFECYCLE
     * ================================================================ */
    // Who can get where: walking, dropping, hauling out of the water, and
    // jumping -- higher with the boots.
    function reachMap(m, start, boots) {
      const W = m.W, H = m.H, seen = new Uint8Array(W * H);
      const jump = boots ? 2.45 : 1.3;
      const q = [start];
      seen[start] = 1;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], x = c % W, z = (c / W) | 0, yc = m.top[c], wet = m.type[c] === T_WATER;
        for (const [dx, dz] of N4) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          const j = nz * W + nx;
          if (seen[j] || m.type[j] === T_WALL) continue;
          const yj = m.top[j];
          if (yj <= yc + STEP_UP || (wet ? yj - yc <= CLIMB_MAX : yj <= yc + jump)) { seen[j] = 1; q.push(j); }
        }
      }
      return seen;
    }
    function spawnCell(m) {
      const r = m.rooms[0];
      let best = -1, bd = 1e9;
      for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = m.idx(x, z);
        if (m.type[i] !== T_DRY) continue;
        const d = Math.hypot(x + 0.5 - r.cx, z + 0.5 - r.cz);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    // A map is whole if the boots can take you everywhere, and your own
    // feet everywhere but the high shelves.
    function mapIsWhole(m) {
      const s0 = spawnCell(m);
      if (s0 < 0) return false;
      const r0 = reachMap(m, s0, false), r1 = reachMap(m, s0, true);
      for (let i = 0; i < m.W * m.H; i++) {
        if (m.type[i] === T_WALL) continue;
        if (!r1[i]) return false;
        if (!r0[i] && m.top[i] < 1) return false;
      }
      return true;
    }

    function newWorld(seed) {
      state.seed = seed;
      for (let k = 0; k < 12; k++) {
        map = generateMap(seed + k * 7919);
        if (mapIsWhole(map)) break;
      }
      buildWorld(map);
      buildDrains();
      state.explored = new Uint8Array(map.W * map.H);
      menuShot = null;
    }

    // The drains: dark grates in the pool floors. The Listener moves
    // between the pools through them, and bubbles give it away.
    const drainGroup = new THREE.Group();
    scene.add(drainGroup);
    const DRAIN_G = new THREE.PlaneGeometry(1.15, 1.15);
    DRAIN_G.rotateX(-Math.PI / 2);
    const DRAIN_M = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: shared.uTime, uRim: { value: col(PAL.pool) } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv - 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uRim; varying vec2 vUv;
        void main() {
          float r = length(vUv) * 2.0;
          if (r > 1.0) discard;
          float ang = atan(vUv.y, vUv.x);
          // Radial slots between a hub and a rim.
          float slots = smoothstep(0.35, 0.55, abs(sin(ang * 6.0))) * step(0.22, r) * step(r, 0.82);
          vec3 c = mix(vec3(0.11, 0.13, 0.13), vec3(0.0), slots);
          float rim = smoothstep(0.8, 0.9, r) * (1.0 - smoothstep(0.93, 1.0, r));
          c += uRim * rim * (0.05 + 0.03 * sin(uTime * 1.3));
          gl_FragColor = vec4(c, 0.92 * (1.0 - smoothstep(0.96, 1.0, r)));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    });
    function buildDrains() {
      drainGroup.clear();
      for (const d of map.drains) {
        const m = new THREE.Mesh(DRAIN_G, DRAIN_M);
        m.position.set(d.x, POOL_Y + 0.012, d.z);
        drainGroup.add(m);
      }
    }
    function spawnPlayer() {
      const r = map.rooms[0];
      // The middle of the spawn room, facing its widest opening.
      let best = null;
      for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = map.idx(x, z);
        if (map.type[i] !== T_DRY) continue;
        const d = Math.hypot(x + 0.5 - r.cx, z + 0.5 - r.cz);
        if (!best || d < best.d) best = { x, z, d };
      }
      P.x = (best.x + 0.5) * CELL; P.z = (best.z + 0.5) * CELL; P.y = map.top[map.idx(best.x, best.z)];
      P.vx = P.vy = P.vz = 0; P.ground = true; P.inWater = false; P.climb = null; P.alive = true;
      P.deathT = undefined;
      // Face the first doorway.
      let door = null;
      for (let z = r.z - 1; z <= r.z + r.h; z++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
        if (x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.h) continue;
        if (!map.inside(x, z) || map.type[map.idx(x, z)] === T_WALL) continue;
        door = { x: (x + 0.5) * CELL, z: (z + 0.5) * CELL };
      }
      P.yaw = door ? Math.atan2(-(door.x - P.x), -(door.z - P.z)) : 0;
      P.pitch = -0.05;
    }
    function startRun(seed) {
      newWorld(Number.isFinite(seed) ? seed : (Math.random() * 1e9) | 0);
      beats.length = 0;
      spawnPlayer();
      Object.assign(state, { screen: "play", t: state.t, runStart: state.t, coils: 0, parts: 0, rockets: 0, rocketsFound: 0, ducks: 2, boots: false, bazooka: false, hits: 0, won: false, submitted: false, deathCause: "" });
      for (const d of ducks) scene.remove(d.mesh);
      ducks.length = 0;
      for (const r of rockets) scene.remove(r.mesh);
      rockets.length = 0;
      pBuf.live.length = 0;
      placeItems();
      placeCreature();
      flashA = 0; flashTarget = 0;
      flashEl.style.opacity = 0;
      hideModal();
      updateHud();
      toast("The baths", "Find four spring coils. Stay out of the water when you can.");
      if (track) track.reset();
      sfx.unlock();
      ctx.platform.start({ seed: state.seed });
      ctx.platform.emit && ctx.platform.emit("run_start", { seed: state.seed });
    }
    async function finishRun(won) {
      if (state.screen !== "play") return;
      state.screen = won ? "won" : "dead";
      const score = progressScore();
      // Read the clock once: the submits below wait on the network.
      const ms = Math.round((state.t - state.runStart) * 1000);
      const secs = Math.round(ms / 1000);
      if (score > state.best) state.best = score;
      if (won && (!state.bestTime || secs < state.bestTime)) state.bestTime = secs;
      save();
      showModal(resultHtml(won));
      flashA = 0; flashTarget = 0; flashEl.style.opacity = 0;
      ctx.platform[won ? "complete" : "fail"]({ score, rank: rankOf(score), seconds: secs, hits: state.hits });
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
          ctx.pulse.complete({ score, result: won ? "won" : "lost", text: won ? `Killed the Listener in ${fmtTime(secs)} in Still Water` : `Reached ${rankOf(score)} in Still Water` });
        }
      }
    }

    /* ================================================================ *
     * THE FRAME
     * ================================================================ */
    function update(dtMs) {
      const dt = Math.min(dtMs || 16, 50) / 1000;
      state.t += dt;
      runBeats();
      if (state.screen === "play") {
        // Look.
        const sens = 0.0064 * state.look;
        P.yaw -= input.lookDX * sens;
        P.pitch = clamp(P.pitch - input.lookDY * sens * 0.85, -1.35, 1.3);
        if (input.turnL) P.yaw += 2.4 * dt;
        if (input.turnR) P.yaw -= 2.4 * dt;
        input.lookDX = 0; input.lookDY = 0;
        if (P.alive) stepPlayer(dt);
      } else {
        input.lookDX = input.lookDY = 0;
      }
      stepCreature(dt);
      if (C.alive || (C.act && C.act.kind === "die")) poseFromTrail(dt);
      stepItems(dt);
      stepDucks(dt);
      stepRockets(dt);
      stepParticles(dt);
      sfx.update(dt);
      // Toast and ear.
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove("on"); }
      if (earT > 0) { earT -= dt; if (earT <= 0) earText.classList.remove("on"); }
      earEl.classList.toggle("l1", C.alive && (C.state === "investigate" || C.state === "search"));
      earEl.classList.toggle("l2", C.alive && C.state === "hunt");
      if (flashTarget > flashA) flashA = Math.min(flashTarget, flashA + dt * flashSpeed); else flashA = Math.max(flashTarget, flashA - dt * flashSpeed);
      flashEl.style.opacity = flashA.toFixed(3);
      if (state.screen === "play") updateMap(dt);
      placeCamera(dt);
    }

    function placeCamera(dt) {
      if (state.screen === "play" || state.screen === "dead" || state.screen === "won") {
        P.shake = Math.max(0, P.shake - dt * 1.6);
        const sh = P.shake * P.shake * 0.08;
        const bob = Math.sin(P.phase) * P.bobAmt;
        const sway = P.inWater ? Math.sin(state.t * 1.3) * 0.012 : 0;
        // Taken: pulled down and back, looking up at it as the water closes.
        let sink = 0, look = P.pitch, roll = 0;
        if (!P.alive && P.deathT !== undefined && state.screen !== "won") {
          P.deathT += dt;
          const k = smooth(0, 1.1, P.deathT);
          sink = k * (P.inWater ? 0.95 : 0.5);
          look = lerp(P.pitch, 0.55, k);
          roll = k * 0.35;
        }
        camera.position.set(P.x + (Math.random() - 0.5) * sh, P.y + EYE + bob - sink + (Math.random() - 0.5) * sh, P.z + (Math.random() - 0.5) * sh);
        camera.rotation.set(look, P.yaw, sway + roll + Math.cos(P.phase * 0.5) * P.bobAmt * 0.6, "YXZ");
      } else {
        // Behind the title: low over the water in the finest room, drifting
        // a little, as if someone were standing there holding their breath.
        if (!menuShot) chooseMenuShot();
        const m = menuShot, t = state.t;
        const drift = Math.sin(t * 0.11) * 0.7;
        camera.position.set(m.x + m.sx * drift, m.y + Math.sin(t * 0.23) * 0.04, m.z + m.sz * drift);
        camera.lookAt(m.tx + m.sx * drift * 0.4, m.ty, m.tz + m.sz * drift * 0.4);
      }
    }

    let menuShot = null;
    function chooseMenuShot() {
      const score = r => r.w * r.h + (r.skylight ? 45 : 0) + (r.style === "pool" ? 20 : r.style === "hall" ? 12 : 0);
      const rooms = map.rooms.filter(r => r.id !== 0 && r.style !== "dry").sort((a, b) => score(b) - score(a));
      const r = rooms[0] || map.rooms[0];
      const cx = r.cx * CELL, cz = r.cz * CELL;
      // Try spots round the rim; keep the one with the clearest, longest view.
      const spots = [];
      for (const inset of [0.7, 1.4]) {
        const xs = [inset, r.w / 2, r.w - inset], zs = [inset, r.h / 2, r.h - inset];
        for (const fx of xs) for (const fz of zs) if (fx !== r.w / 2 || fz !== r.h / 2) spots.push([(r.x + fx) * CELL, (r.z + fz) * CELL]);
      }
      let best = null;
      for (const [x, z] of spots) {
        const i = cellIndex(x, z);
        if (i < 0 || map.type[i] === T_WALL || map.top[i] > 1) continue;
        const ux = cx - x, uz = cz - z, L = Math.hypot(ux, uz);
        if (L < 3) continue;
        // A column close in front fills the frame: such a spot is out.
        let pen = 0;
        for (const c of world.colliders) {
          const dx = c.x - x, dz = c.z - z;
          const d = Math.hypot(dx, dz);
          const along = (dx * ux + dz * uz) / L, across = Math.abs(dx * uz - dz * ux) / L;
          const inView = along > 0 && Math.atan2(across, along) < 0.42;
          if (d < 1.6 || (inView && along < 9)) pen += 100;
          else if (inView) pen += 4 / along;
        }
        const val = L - pen * 3;
        if (!best || val > best.val) best = { x, z, val, L };
      }
      if (!best) best = { x: (r.x + 0.7) * CELL, z: (r.z + 0.7) * CELL, L: 1 };
      const i = cellIndex(best.x, best.z);
      const y = (map.type[i] === T_DRY ? map.top[i] : 0) + 1.05;
      const ux = cx - best.x, uz = cz - best.z, L = Math.hypot(ux, uz) || 1;
      // Water where the camera can see it, near enough to make out.
      const cells = [], all = [];
      for (let z = r.z; z < r.z + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) {
        const j = map.idx(x, z);
        if (map.type[j] !== T_WATER) continue;
        all.push(j);
        const [wx, wz] = centreOf(j);
        const dx = wx - best.x, dz = wz - best.z, d = Math.hypot(dx, dz);
        const along = (dx * ux + dz * uz) / L, across = Math.abs(dx * uz - dz * ux) / L;
        if (d > 3.5 && d < 10.5 && along > 0 && Math.atan2(across, along) < 0.33) cells.push(j);
      }
      menuShot = { x: best.x, y, z: best.z, tx: cx + (ux / L) * 2, ty: -0.35, tz: cz + (uz / L) * 2, sx: -uz / L, sz: ux / L, room: r,
        cells: cells.length >= 3 ? cells : all };
    }
    // The title wants the thing in view, swimming, faintly lit.
    function stageMenuCreature() {
      chooseMenuShot();
      if (!menuShot.cells.length) return;
      const c = menuShot.cells[Math.floor(menuShot.cells.length / 2)];
      const [x, z] = centreOf(c);
      Object.assign(C, { alive: true, hp: CREATURE_HP, x, z, y: -0.2, body: map.body[c], state: "wander", timer: 0, act: null,
        heading: Math.random() * Math.PI * 2, speed: 0, path: [], pi: 0, rage: 0, heardN: 0, heardAt: -9, alert: 0.35, travel: null });
      C.trail.length = 0;
      for (let k = 0; k < SPINE * 5; k++) C.trail.push({ x: x - Math.sin(C.heading) * k * TRAIL_STEP, z: z - Math.cos(C.heading) * k * TRAIL_STEP });
      wanderTarget();
    }

    function render() {
      if (TEST && TEST.noRender) return;
      shared.uTime.value = state.t;
      updatePropLamps();
      // Resolution follows the frame rate: give pixels back if the phone
      // cannot keep up, and take them back once it can.
      const now = performance.now();
      if (gfx.last) {
        const d = clamp(now - gfx.last, 4, 100);
        gfx.ema += (d - gfx.ema) * 0.05;
        if (gfx.ema > 24) { gfx.slow += d; gfx.fast = 0; } else if (gfx.ema < 17.5) { gfx.fast += d; gfx.slow = 0; } else { gfx.slow = gfx.fast = 0; }
        if (gfx.slow > 1500 && gfx.dpr > gfx.min) { gfx.dpr = Math.max(gfx.min, gfx.dpr - 0.25); gfx.slow = 0; gfx.ema = 16.7; resize(); }
        if (gfx.fast > 10000 && gfx.dpr < Math.min(ctx.dpr || 1, 2)) { gfx.dpr = Math.min(Math.min(ctx.dpr || 1, 2), gfx.dpr + 0.25); gfx.fast = 0; resize(); }
      }
      gfx.last = now;
      pMat.uniforms.uScale.value = world.glowMat ? world.glowMat.uniforms.uScale.value : 600;
      creature.lights.mat.uniforms.uScale.value = pMat.uniforms.uScale.value;
      renderer.render(scene, camera);
    }

    if (ctx.game && ctx.game.loop) ctx.game.loop({ update, render, resetOnResume: true });
    else ctx.onFrame(dt => { update(dt); render(); });

    /* ================================================================ *
     * BOOT
     * ================================================================ */
    // Fonts are a nicety: a refusal leaves the system serif in place.
    if (typeof ctx.loadFont === "function") {
      ctx.loadFont("SW Serif", "cormorant-garamond", "1.0.0", { weight: "300", style: "italic" }).catch(() => {});
      ctx.loadFont("SW Inter", "inter", "1.0.0", { weight: "600" }).catch(() => {});
    }
    await loadSaved();
    newWorld(TEST && TEST.seed !== undefined ? TEST.seed : (Math.random() * 1e9) | 0);
    spawnPlayer();
    placeItems();
    placeCreature();
    if (TEST) {
      TEST.api = { THREE, scene, camera, renderer, get map() { return map; }, world, render, update, addRipple, PAL, creature, C, P, state, items, ducks,
        poseCreature, SPINE, SPINE_GAP, startRun, jump, throwDuck, fire, input, stick, makeNoise, setState, goTo, finishRun,
        typeAt, topAt, cellIndex, centreOf, take, hurtCreature, explode, rockets, stepPlayer, placeCreature, gfx, startTravel, updateHud };
    }
    update(16);
    render();
    ctx.markVisualReady("menu");
    gotoMenu();
    ctx.platform.ready({ title: "Still Water" });
  }
};
