/*
 * Umbra — a climbing game played on shadows.
 *
 * Every platform in this game is the silhouette of a real solid. A rack of
 * blocks, rods, wedges and drums turns slowly in front of a lamp, and what
 * you stand on is the shadow they throw on the wall behind. Nothing is
 * drawn as a platform and then animated: the solids are modelled as convex
 * polyhedra, spun by a real rotation matrix, projected flat, and the convex
 * hull of that projection is both what you see and what you collide with.
 * A bar you are standing on narrows because the block casting it has turned
 * edge-on, and it tips you off because the shadow genuinely tipped.
 *
 * Packaged assets are disabled (maxAssets: 0), so the lamp, the wall, the
 * solids and every sound are generated here.
 */

window.plethoraBit = {
  meta: {
    title: "Umbra",
    runtime: "plethora-bit@2",
    tags: ["platformer", "arcade", "shadow", "climb", "endless", "physics", "one-hand", "leaderboard", "puzzle", "atmospheric"],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    /* ================================================================ *
     * CREATOR TUNING
     * ================================================================ */
    const tune = ctx.tune || {};
    const tInt = (id, fb) => (tune.integer ? tune.integer(id) : undefined) ?? fb;
    const tNum = (id, fb) => (tune.number ? tune.number(id) : undefined) ?? fb;
    const tBool = (id, fb) => (tune.boolean ? tune.boolean(id) : undefined) ?? fb;
    const tChoice = (id, fb) => (tune.choice ? tune.choice(id) : undefined) ?? fb;

    const GRAVITY = tNum("gravity", 1850);
    const JUMP_V = tNum("jump_speed", 690);
    const RUN_V = tNum("run_speed", 196);
    const SPIN_BASE = tNum("spin_base", 0.42);
    const RISE_BASE = tNum("light_rise", 26);
    const RISE_RAMP = tNum("light_ramp", 0.055);
    const GAP_BASE = tNum("gap_base", 96);
    const COYOTE_MS = tInt("coyote_ms", 110);
    const SOUND_DEFAULT = tBool("sound_default", true);
    const HAPTICS_DEFAULT = tBool("haptics_default", true);
    const LAMP = tChoice("lamp_colour", "warm");

    /* ================================================================ *
     * THE WALL
     * World units are wall units; +y is up. The camera maps them to CSS
     * pixels. Everything below is in wall units unless it says otherwise.
     * ================================================================ */
    const WALL_W = 360;             // how wide the lit wall is
    const PLAYER_R = 8.5;
    const MAX_FALL = 1150;
    // A median climb is around 110m, so acts have to turn over inside
    // that or nobody ever sees act two.
    const ACT_HEIGHT = 650;

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const pick = list => list[Math.floor(Math.random() * list.length)];

    const LAMPS = {
      warm:  { wall: "#efe3dc", wall2: "#dfcfc8", shade: "#2e2440", soft: "#4a3a63", ink: "#2a2235",
               glow: "#ffd9a8", glowSoft: "rgba(255,217,168,.44)" },
      cold:  { wall: "#e2e8ef", wall2: "#ccd6e0", shade: "#1f2a3d", soft: "#36465f", ink: "#1b2434",
               glow: "#bfe4ff", glowSoft: "rgba(191,228,255,.44)" },
      amber: { wall: "#f3e6c8", wall2: "#e3d2ab", shade: "#33271c", soft: "#51402e", ink: "#2b2118",
               glow: "#ffcf7a", glowSoft: "rgba(255,207,122,.44)" }
    };
    const SKIN = LAMPS[LAMP] || LAMPS.warm;

    // The solids are real objects on a rack, so they are painted like
    // objects: a few honest poster colours, not a gradient ramp.
    const STOCK = ["#d8453f", "#2f6fd0", "#e8b53a", "#f2efe9", "#3f9e6a", "#c8603f", "#7a5bd0"];

    const CSS = `
.um{position:absolute;inset:0;overflow:hidden;pointer-events:none!important;
  font-family:ui-rounded,"SF Pro Rounded",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:${SKIN.ink}}
.um *{box-sizing:border-box}
.um [hidden]{display:none!important}

.um-view{position:absolute;inset:0;pointer-events:none}
.um-hud{position:absolute;left:calc(var(--sal) + 14px);top:calc(var(--sat) + 12px);
  display:flex;flex-direction:column;gap:2px}
.um-h{font-size:30px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.um-sub{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.5}
.um-right{position:absolute;right:calc(var(--sar) + 14px);top:calc(var(--sat) + 12px);text-align:right;
  display:flex;flex-direction:column;gap:2px}

.um-pads{position:absolute;inset:auto 0 0 0;pointer-events:none;z-index:3;
  padding:0 calc(var(--sar) + 14px) calc(var(--sab) + 14px) calc(var(--sal) + 14px);
  display:flex;justify-content:flex-end}
.um-jump{pointer-events:auto;appearance:none;border:0;width:84px;height:84px;border-radius:50%;
  font:inherit;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  background:rgba(46,36,64,.14);color:${SKIN.ink};cursor:pointer;touch-action:manipulation;
  box-shadow:inset 0 0 0 2px rgba(46,36,64,.2);display:flex;align-items:center;justify-content:center}
.um-jump:active{background:rgba(46,36,64,.3)}

.um-modal{position:absolute;inset:0;z-index:5;pointer-events:auto;display:flex;align-items:center;
  justify-content:center;padding:calc(var(--sat) + 16px) calc(var(--sar) + 16px) calc(var(--sab) + 16px) calc(var(--sal) + 16px);
  background:rgba(22,17,30,.55);backdrop-filter:blur(10px)}
.um-card{width:100%;max-width:370px;max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:13px;
  padding:22px;border-radius:26px;background:${SKIN.wall};color:${SKIN.ink};
  box-shadow:0 24px 70px rgba(0,0,0,.45)}
.um-kick{margin:0;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;opacity:.45}
.um-title{margin:0;font-size:46px;font-weight:800;line-height:.9;letter-spacing:-.02em}
.um-copy{margin:0;font-size:14px;line-height:1.5;opacity:.72}
.um-btn{appearance:none;border:0;width:100%;min-height:56px;border-radius:17px;font:inherit;
  font-size:16px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;
  touch-action:manipulation;background:${SKIN.shade};color:${SKIN.wall}}
.um-btn:active{transform:scale(.985)}
.um-btn.ghost{background:transparent;box-shadow:inset 0 0 0 2px rgba(46,36,64,.22);color:${SKIN.ink};
  min-height:46px;font-size:13px}
.um-rows{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.um-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:14px}
.um-row span{opacity:.6}
.um-row b{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}
.um-tip{display:flex;gap:11px;align-items:flex-start;font-size:13.5px;line-height:1.45;opacity:.8}
.um-tip i{font-style:normal;flex:none;width:26px;height:26px;border-radius:8px;background:${SKIN.shade};
  opacity:.9;display:flex;align-items:center;justify-content:center;color:${SKIN.wall};font-size:13px;font-weight:800}
.um-best{color:#b2762a;font-weight:800}
`;

    /* ================================================================ *
     * SOLIDS
     * Convex polyhedra, stored once as vertices plus face index lists.
     * Nothing here knows anything about platforms.
     * ================================================================ */
    function boxGeo(w, h, d) {
      const X = w / 2, Y = h / 2, Z = d / 2;
      return {
        v: [-X, -Y, -Z, X, -Y, -Z, X, Y, -Z, -X, Y, -Z,
            -X, -Y, Z, X, -Y, Z, X, Y, Z, -X, Y, Z],
        f: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
      };
    }

    // An n-gon prism standing on its end: a drum, or a cylinder when n is
    // high enough that nobody can count the sides.
    function prismGeo(n, r, h) {
      const v = [], f = [], Y = h / 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        v.push(Math.cos(a) * r, -Y, Math.sin(a) * r);
      }
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        v.push(Math.cos(a) * r, Y, Math.sin(a) * r);
      }
      const bottom = [], top = [];
      for (let i = 0; i < n; i++) { bottom.push(n - 1 - i); top.push(n + i); }
      f.push(bottom, top);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        f.push([i, j, n + j, n + i]);
      }
      return { v, f };
    }

    function wedgeGeo(w, h, d) {
      const X = w / 2, Y = h / 2, Z = d / 2;
      return {
        v: [-X, -Y, -Z, X, -Y, -Z, -X, Y, -Z,
            -X, -Y, Z, X, -Y, Z, -X, Y, Z],
        f: [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [0, 3, 5, 2]]
      };
    }

    /* ---------------------------------------------------------------- *
     * ROTATION AND PROJECTION
     * The lamp shines straight down the z axis at a wall on z = 0, so a
     * shadow is simply the silhouette: drop z and take the convex hull.
     * That is exact, costs nothing, and means what you see really is what
     * the solid blocks.
     * ---------------------------------------------------------------- */
    function axisMat(ax, ay, az, t) {
      const c = Math.cos(t), s = Math.sin(t), k = 1 - c;
      return [
        c + ax * ax * k, ax * ay * k - az * s, ax * az * k + ay * s,
        ay * ax * k + az * s, c + ay * ay * k, ay * az * k - ax * s,
        az * ax * k - ay * s, az * ay * k + ax * s, c + az * az * k
      ];
    }
    function mulMat(a, b) {
      const o = new Array(9);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
        }
      }
      return o;
    }

    // Convex hull of 2D points, monotone chain. Comes back counter
    // clockwise with y up, which is what the collision normals assume.
    function hull(pts) {
      const n = pts.length / 2;
      const idx = [];
      for (let i = 0; i < n; i++) idx.push(i);
      idx.sort((a, b) => (pts[a * 2] - pts[b * 2]) || (pts[a * 2 + 1] - pts[b * 2 + 1]));
      const cross = (o, a, b) =>
        (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) -
        (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
      const lower = [], upper = [];
      for (const i of idx) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
        lower.push(i);
      }
      for (let k = idx.length - 1; k >= 0; k--) {
        const i = idx[k];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
        upper.push(i);
      }
      lower.pop(); upper.pop();
      const out = [];
      for (const i of lower.concat(upper)) out.push(pts[i * 2], pts[i * 2 + 1]);
      return out;
    }

    /* ================================================================ *
     * PIECES
     * A piece is one object on the rack: a few solids welded together,
     * turning as one about a single axis.
     * ================================================================ */
    const SOLID_CACHE = {};
    function geoOf(kind, a, b, c) {
      const key = kind + a + "_" + b + "_" + c;
      if (!SOLID_CACHE[key]) {
        SOLID_CACHE[key] = kind === "box" ? boxGeo(a, b, c)
          : kind === "prism" ? prismGeo(a, b, c)
          : wedgeGeo(a, b, c);
      }
      return SOLID_CACHE[key];
    }

    function makePiece(spec) {
      const p = {
        x: spec.x, y: spec.y,
        axis: spec.axis, spin: spec.spin, phase: spec.phase || 0,
        parts: spec.parts,          // [{ geo, color, ox, oy, oz, tilt }]
        hulls: [], faces: [],
        ang: spec.phase || 0, prevAng: spec.phase || 0,
        span: spec.span || 0
      };
      return p;
    }

    // Rebuild a piece's shadow for this instant: rotate every vertex, drop
    // z, hull it. The hull is the platform; the faces are only ever drawn.
    const _pt = [0, 0, 0];
    function updatePiece(p, t) {
      p.prevAng = p.ang;
      p.ang = p.phase + p.spin * t;
      const M = axisMat(p.axis[0], p.axis[1], p.axis[2], p.ang);
      p.hulls.length = 0;
      p.faces.length = 0;
      for (const part of p.parts) {
        const R = part.tilt ? mulMat(M, part.tilt) : M;
        const g = part.geo;
        const n = g.v.length / 3;
        const flat = new Float64Array(n * 2);
        const world = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) {
          const vx = g.v[i * 3] + part.ox, vy = g.v[i * 3 + 1] + part.oy, vz = g.v[i * 3 + 2] + part.oz;
          const X = R[0] * vx + R[1] * vy + R[2] * vz;
          const Y = R[3] * vx + R[4] * vy + R[5] * vz;
          const Z = R[6] * vx + R[7] * vy + R[8] * vz;
          world[i * 3] = X; world[i * 3 + 1] = Y; world[i * 3 + 2] = Z;
          flat[i * 2] = p.x + X;
          flat[i * 2 + 1] = p.y + Y;
        }
        p.hulls.push(hull(flat));
        p.faces.push({ world, geo: g, color: part.color });
      }
    }

    // Where a point of this piece's shadow was one tick ago, so a platform
    // that turns under your feet carries you with it instead of sliding
    // out from under you.
    function carryDelta(p, wx, wy, out) {
      const dx = wx - p.x, dy = wy - p.y;
      const back = -p.ang, fwd = p.prevAng;
      const A = axisMat(p.axis[0], p.axis[1], p.axis[2], back);
      const B = axisMat(p.axis[0], p.axis[1], p.axis[2], fwd);
      // Only the in-plane part of the rotation moves a point of the
      // silhouette, which is all the player can be standing on.
      const lx = A[0] * dx + A[1] * dy, ly = A[3] * dx + A[4] * dy;
      const px = B[0] * lx + B[1] * ly, py = B[3] * lx + B[4] * ly;
      out[0] = dx - px;
      out[1] = dy - py;
    }

    /* ================================================================ *
     * THE RACK
     * Six kinds of object, each a real solid turning about a real axis.
     * What each one does as a platform falls out of its geometry rather
     * than being authored: a flat slab turned about its upright axis has
     * a shadow that narrows to its own thickness and widens again, and a
     * bar turned in the plane of the wall sweeps like a clock hand.
     * ================================================================ */
    const AX_Y = [0, 1, 0], AX_Z = [0, 0, 1];

    const ARCHETYPES = [
      { // a wide flat slab: a generous ledge that thins to an edge
        id: "slab", weight: 30,
        build(d) {
          const w = rand(96, 150) * lerp(1, 0.74, d), t = rand(15, 24);
          return { axis: AX_Y, spin: SPIN_BASE * rand(0.5, 0.95) * lerp(1, 1.9, d) * (Math.random() < 0.5 ? -1 : 1),
                   span: w,
                   parts: [{ geo: geoOf("box", w, 15, t), color: pick(STOCK), ox: 0, oy: 0, oz: 0 }] };
        }
      },
      { // a drum: its shadow never changes width, so it is always safe
        id: "drum", weight: 16,
        build(d) {
          const r = rand(26, 40) * lerp(1, 0.82, d);
          return { axis: AX_Y, spin: SPIN_BASE * rand(0.4, 0.8), span: r * 2,
                   parts: [{ geo: geoOf("prism", 20, r, 16), color: pick(STOCK), ox: 0, oy: 0, oz: 0 }] };
        }
      },
      { // a bar turning in the plane of the wall: a clock hand to time
        id: "beam", weight: 22,
        build(d) {
          const len = rand(110, 165) * lerp(1, 0.8, d);
          return { axis: AX_Z, spin: SPIN_BASE * rand(0.45, 0.8) * lerp(1, 1.7, d) * (Math.random() < 0.5 ? -1 : 1),
                   phase: rand(0, Math.PI * 2), span: len,
                   parts: [{ geo: geoOf("box", len, 14, 14), color: pick(STOCK), ox: 0, oy: 0, oz: 0 }] };
        }
      },
      { // the T from the rack: a lid on a stem, so the ledge has a post
        id: "tee", weight: 14,
        build(d) {
          const w = rand(78, 110) * lerp(1, 0.8, d);
          const col = pick(STOCK);
          return { axis: AX_Y, spin: SPIN_BASE * rand(0.5, 0.9) * lerp(1, 1.7, d), span: w,
                   parts: [
                     { geo: geoOf("box", w, 14, 20), color: col, ox: 0, oy: 12, oz: 0 },
                     { geo: geoOf("box", 22, 34, 20), color: col, ox: 0, oy: -14, oz: 0 }
                   ] };
        }
      },
      { // a wedge: a ramp, then a point, then a ledge again
        id: "wedge", weight: 10,
        build(d) {
          const w = rand(78, 112) * lerp(1, 0.8, d);
          return { axis: AX_Z, spin: SPIN_BASE * rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1),
                   span: w,
                   parts: [{ geo: geoOf("wedge", w, 46, 18), color: pick(STOCK), ox: 0, oy: 0, oz: 0 }] };
        }
      },
      { // the dowel: tilted, so turning sweeps it from a long diagonal
        id: "rod", weight: 8,
        build(d) {
          const len = rand(150, 205) * lerp(1, 0.84, d);
          const tiltA = rand(0.2, 0.42) * (Math.random() < 0.5 ? -1 : 1);
          return { axis: AX_Y, spin: SPIN_BASE * rand(0.4, 0.7) * lerp(1, 1.6, d), span: len * 0.8,
                   parts: [{ geo: geoOf("box", len, 11, 11), color: pick(STOCK),
                             ox: 0, oy: 0, oz: 0, tilt: axisMat(0, 0, 1, tiltA) }] };
        }
      }
    ];

    const TOTAL_WEIGHT = ARCHETYPES.reduce((s, a) => s + a.weight, 0);
    function rollArchetype(d) {
      // Early on, keep the dependable shapes common; later let the mean
      // ones through.
      let r = Math.random() * TOTAL_WEIGHT;
      for (const a of ARCHETYPES) {
        let w = a.weight;
        if (d < 0.18 && (a.id === "beam" || a.id === "rod" || a.id === "wedge")) w *= 0.35;
        r -= w;
        if (r <= 0) return a;
      }
      return ARCHETYPES[0];
    }

    /* ================================================================ *
     * WORLD
     * ================================================================ */
    const W = { pieces: [], motes: [], topY: 0, spineY: 0, spineX: WALL_W / 2, lightY: 0, t: 0, act: 1 };

    const difficultyAt = y => clamp(y / (ACT_HEIGHT * 5), 0, 1);

    /* ---------------------------------------------------------------- *
     * WHAT A JUMP CAN ACTUALLY REACH
     * The generator asks these rather than carrying numbers of its own,
     * so the climb stays possible whatever the jump is tuned to. Raise
     * the jump and the footholds move apart to match.
     * ---------------------------------------------------------------- */
    const AIR_ACCEL = 1500;
    const APEX = (JUMP_V * JUMP_V) / (2 * GRAVITY);
    const RISE_MAX = APEX * 0.70;         // never ask for more than this
    function reachAt(rise) {
      // How long you are still above `rise`, and how far you can lean in
      // that time starting from a standstill.
      const disc = JUMP_V * JUMP_V - 2 * GRAVITY * rise;
      if (disc <= 0) return 0;
      const t = (JUMP_V + Math.sqrt(disc)) / GRAVITY;
      const tAcc = Math.min(t, RUN_V / AIR_ACCEL);
      const far = 0.5 * AIR_ACCEL * tAcc * tAcc + RUN_V * Math.max(0, t - tAcc);
      return far * 0.62;                  // and leave a human some margin
    }

    const BY_ID = {};
    for (const a of ARCHETYPES) BY_ID[a.id] = a;
    const SPINE_IDS = ["slab", "drum", "tee"];      // tops that do not move
    const SPICE_IDS = ["beam", "rod", "wedge"];     // tops that swing

    function place(archId, x, y, d) {
      const arch = BY_ID[archId];
      const spec = arch.build(d);
      const half = Math.min(spec.span * 0.5, WALL_W * 0.42);
      const px = clamp(x, half + 8, WALL_W - half - 8);
      const piece = makePiece(Object.assign({ x: px, y }, spec));
      piece.kind = archId;
      W.pieces.push(piece);
      return piece;
    }

    function addPiece() {
      const d = difficultyAt(W.spineY);
      // The rise between footholds stays inside a standing jump. The apex
      // of one is about 128 wall units, so this never asks for more than
      // three quarters of it.
      const rise = clamp(GAP_BASE * lerp(0.76, 1, Math.min(d * 1.6, 1)) * rand(0.86, 1.04), 36, RISE_MAX);
      const y = W.spineY + rise;
      const reach = reachAt(rise) * lerp(1, 0.86, d);
      let x = W.spineX + rand(-reach, reach);
      if (Math.abs(x - W.spineX) < 22) x += (x < WALL_W / 2 ? 1 : -1) * 30;
      const spine = place(pick(SPINE_IDS), x, y, d);
      spine.oneWay = true;
      W.spineX = spine.x;
      W.spineY = y;
      W.topY = y;

      // Something with a swinging top, off to one side so it never seals
      // the route: a shortcut if you dare, scenery if you do not.
      if (Math.random() < 0.34 + d * 0.3) {
        const side = spine.x < WALL_W / 2 ? 1 : -1;
        place(pick(SPICE_IDS), spine.x + side * rand(96, 150), y - rise * rand(0.3, 0.55), d);
      }
      if (Math.random() < 0.45) {
        W.motes.push({ x: clamp(spine.x + rand(-40, 40), 14, WALL_W - 14),
                       y: y + rand(26, 52), got: false, t: Math.random() * 6 });
      }
    }

    function resetWorld() {
      W.pieces.length = 0; W.motes.length = 0;
      W.t = 0; W.topY = 0; W.act = 1;
      W.spineY = 0; W.spineX = WALL_W / 2;
      // A dependable ledge to stand on while you work out the controls.
      const start = makePiece({
        x: WALL_W / 2, y: 0, axis: AX_Y, spin: 0.1, span: 190,
        parts: [{ geo: geoOf("box", 190, 18, 46), color: STOCK[3], ox: 0, oy: 0, oz: 0 }]
      });
      start.kind = "slab";
      start.oneWay = true;
      W.pieces.push(start);
      W.lightY = -320;
      while (W.topY < 1500) addPiece();
    }

    /* ================================================================ *
     * PLAYER AND COLLISION
     * ================================================================ */
    const P = { x: 0, y: 0, prevY: 0, vx: 0, vy: 0, grounded: false, lastGround: -9, face: 1,
                best: 0, alive: true, squash: 0, spin: 0 };

    // Circle against convex polygon. Returns the shallowest push that
    // separates them, plus the contact point so a turning platform can
    // carry whatever is standing on it.
    function circlePoly(cx, cy, r, poly) {
      const n = poly.length / 2;
      if (n < 3) return null;
      let inside = true, bestDepth = Infinity, bnx = 0, bny = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = poly[i * 2], ay = poly[i * 2 + 1];
        const ex = poly[j * 2] - ax, ey = poly[j * 2 + 1] - ay;
        const L = Math.sqrt(ex * ex + ey * ey) || 1;
        const nx = ey / L, ny = -ex / L;
        const d = (cx - ax) * nx + (cy - ay) * ny;
        if (d > r) return null;              // a separating edge: done
        if (d > 0) inside = false;
        const depth = r - d;
        if (depth < bestDepth) { bestDepth = depth; bnx = nx; bny = ny; }
      }
      if (inside) {
        return { nx: bnx, ny: bny, depth: bestDepth, px: cx - bnx * (bestDepth - r), py: cy - bny * (bestDepth - r) };
      }
      let cbx = 0, cby = 0, best = Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = poly[i * 2], ay = poly[i * 2 + 1];
        const ex = poly[j * 2] - ax, ey = poly[j * 2 + 1] - ay;
        const t = clamp(((cx - ax) * ex + (cy - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
        const px = ax + ex * t, py = ay + ey * t;
        const dd = (cx - px) * (cx - px) + (cy - py) * (cy - py);
        if (dd < best) { best = dd; cbx = px; cby = py; }
      }
      const dist = Math.sqrt(best);
      if (dist > r) return null;
      const nx = dist > 1e-6 ? (cx - cbx) / dist : bnx;
      const ny = dist > 1e-6 ? (cy - cby) / dist : bny;
      return { nx, ny, depth: r - dist, px: cbx, py: cby };
    }

    const _carry = [0, 0];
    function collide(dt) {
      P.grounded = false;
      for (const piece of W.pieces) {
        if (Math.abs(piece.y - P.y) > 220) continue;
        for (const poly of piece.hulls) {
          if (piece.oneWay) {
            if (P.vy > 30) continue;                       // on the way up
            let top = -1e9;
            for (let i = 1; i < poly.length; i += 2) if (poly[i] > top) top = poly[i];
            if (P.prevY - PLAYER_R < top - 5) continue;    // came from below
          }
          const hit = circlePoly(P.x, P.y, PLAYER_R, poly);
          if (!hit) continue;
          P.x += hit.nx * hit.depth;
          P.y += hit.ny * hit.depth;
          const vn = P.vx * hit.nx + P.vy * hit.ny;
          if (vn < 0) { P.vx -= vn * hit.nx; P.vy -= vn * hit.ny; }
          if (hit.ny > 0.42) {
            P.grounded = true;
            P.lastGround = W.t;
            carryDelta(piece, hit.px, hit.py, _carry);
            P.x += _carry[0];
            P.y += _carry[1];
          }
        }
      }
      P.x = clamp(P.x, PLAYER_R, WALL_W - PLAYER_R);
    }

    /* ================================================================ *
     * CAMERA AND RENDER
     * ================================================================ */
    let g = null, canvas = null;
    const cam = { y: 0, shake: 0 };
    const fx = [];
    const PENUMBRA = [[5.5, 0.11], [2.6, 0.17]];

    const scaleOf = () => ctx.width / WALL_W;

    function updateCamera(dt) {
      const s = scaleOf();
      const vh = ctx.height / s;                 // visible wall height
      const want = P.y - vh * 0.36;
      // Rise with the climb quickly, sink back slowly: falling should feel
      // like falling, not like the camera chasing you down.
      const k = 1 - Math.exp((want > cam.y ? -9 : -3.2) * dt);
      cam.y = lerp(cam.y, want, k);
      cam.y = Math.max(cam.y, W.lightY - vh * 0.18);
      if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 2.6);
    }

    function render() {
      const vw = ctx.width, vh = ctx.height, s = scaleOf();
      const shakeX = cam.shake > 0 ? Math.sin(W.t * 47) * cam.shake * 5 : 0;
      const shakeY = cam.shake > 0 ? Math.cos(W.t * 39) * cam.shake * 5 : 0;
      const sxOf = wx => wx * s + shakeX;
      const syOf = wy => vh - (wy - cam.y) * s + shakeY;
      const topWall = cam.y + vh / s;

      /* ---- the lit wall ---- */
      const grad = g.createLinearGradient(0, 0, 0, vh);
      grad.addColorStop(0, SKIN.wall2);
      grad.addColorStop(0.55, SKIN.wall);
      grad.addColorStop(1, SKIN.wall2);
      g.fillStyle = grad;
      g.fillRect(0, 0, vw, vh);

      /* ---- shadows, and the solid throwing each one ---- */
      for (const piece of W.pieces) {
        if (piece.y < cam.y - 150 || piece.y > topWall + 150) continue;

        // Penumbra: two swollen copies of the same hull at different
        // weights. Cheaper than a blur, and one ring alone read as a hard
        // grey outline rather than a soft edge.
        g.fillStyle = SKIN.shade;
        for (const [swell, alpha] of PENUMBRA) {
          g.globalAlpha = alpha;
          for (const poly of piece.hulls) {
            const n = poly.length / 2;
            if (n < 3) continue;
            let cx = 0, cy = 0;
            for (let i = 0; i < n; i++) { cx += poly[i * 2]; cy += poly[i * 2 + 1]; }
            cx /= n; cy /= n;
            g.beginPath();
            for (let i = 0; i < n; i++) {
              const dx = poly[i * 2] - cx, dy = poly[i * 2 + 1] - cy;
              const L = Math.sqrt(dx * dx + dy * dy) || 1;
              const px = sxOf(cx + dx + (dx / L) * swell), py = syOf(cy + dy + (dy / L) * swell);
              if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.closePath();
            g.fill();
          }
        }
        g.globalAlpha = 1;

        g.fillStyle = SKIN.shade;
        for (const poly of piece.hulls) {
          const n = poly.length / 2;
          if (n < 3) continue;
          g.beginPath();
          for (let i = 0; i < n; i++) {
            const px = sxOf(poly[i * 2]), py = syOf(poly[i * 2 + 1]);
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath();
          g.fill();
        }

        // The object itself, seen faintly through the wall. This is the
        // whole point of the game and it costs three dozen triangles.
        for (const f of piece.faces) {
          const wv = f.world, geo = f.geo;
          for (const face of geo.f) {
            const a = face[0] * 3, b = face[1] * 3, c = face[2] * 3;
            const ux = wv[b] - wv[a], uy = wv[b + 1] - wv[a + 1], uz = wv[b + 2] - wv[a + 2];
            const vx2 = wv[c] - wv[a], vy2 = wv[c + 1] - wv[a + 1], vz2 = wv[c + 2] - wv[a + 2];
            const nz = ux * vy2 - uy * vx2;
            if (nz <= 0) continue;                       // facing away
            const nx3 = uy * vz2 - uz * vy2, ny3 = uz * vx2 - ux * vz2;
            const L = Math.sqrt(nx3 * nx3 + ny3 * ny3 + nz * nz) || 1;
            g.globalAlpha = 0.045 + 0.105 * (nz / L);
            g.fillStyle = f.color;
            g.beginPath();
            for (let k = 0; k < face.length; k++) {
              const i3 = face[k] * 3;
              const px = sxOf(piece.x + wv[i3]), py = syOf(piece.y + wv[i3 + 1]);
              if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.closePath();
            g.fill();
          }
        }
        g.globalAlpha = 1;
      }

      /* ---- motes ---- */
      for (const m of W.motes) {
        if (m.got || m.y < cam.y - 40 || m.y > topWall + 40) continue;
        const px = sxOf(m.x), py = syOf(m.y + Math.sin(W.t * 2.2 + m.t) * 3);
        const r = 5.2 * s;
        g.globalAlpha = 0.3;
        g.fillStyle = SKIN.glow;
        g.beginPath(); g.arc(px, py, r * 2.3, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = SKIN.glow;
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(255,255,255,.85)";
        g.beginPath(); g.arc(px - r * 0.3, py - r * 0.3, r * 0.38, 0, Math.PI * 2); g.fill();
      }

      /* ---- you ---- */
      if (P.alive) {
        const px = sxOf(P.x), py = syOf(P.y);
        const r = PLAYER_R * s;
        const sq = 1 + P.squash * 0.35, st = 1 - P.squash * 0.28;
        g.save();
        g.translate(px, py);
        g.scale(st, sq);
        g.fillStyle = "#161020";
        g.beginPath();
        g.ellipse(0, r * 0.18, r * 0.82, r * 0.86, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(0, -r * 0.62, r * 0.56, 0, Math.PI * 2);
        g.fill();
        // A thread of lamplight down the edge that faces the lamp.
        g.strokeStyle = SKIN.glow;
        g.globalAlpha = 0.5;
        g.lineWidth = Math.max(1, r * 0.13);
        g.beginPath();
        g.arc(0, -r * 0.62, r * 0.56, -2.5, -0.9);
        g.stroke();
        g.globalAlpha = 1;
        g.restore();
      }

      /* ---- the light coming up the wall ---- */
      const ly = syOf(W.lightY);
      if (ly < vh + 10) {
        const lg = g.createLinearGradient(0, ly - 150 * s, 0, ly + 20);
        lg.addColorStop(0, "rgba(255,255,255,0)");
        lg.addColorStop(0.72, SKIN.glowSoft);
        lg.addColorStop(1, "rgba(255,255,255,.95)");
        g.fillStyle = lg;
        g.fillRect(0, ly - 150 * s, vw, 150 * s + 20);
        g.fillStyle = "#fffdf6";
        g.fillRect(0, ly, vw, vh - ly + 10);
      }

      /* ---- pops ---- */
      for (let i = fx.length - 1; i >= 0; i--) {
        const e = fx[i];
        const k = e.t / 0.5;
        if (k >= 1) { fx.splice(i, 1); continue; }
        g.globalAlpha = 1 - k;
        g.strokeStyle = SKIN.glow;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(sxOf(e.x), syOf(e.y), (6 + k * 26) * s, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }

      /* ---- the lamp's own vignette ---- */
      const vg = g.createRadialGradient(vw * 0.5, vh * 0.42, vh * 0.2, vw * 0.5, vh * 0.42, vh * 0.85);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(32,22,42,.34)");
      g.fillStyle = vg;
      g.fillRect(0, 0, vw, vh);
    }

    /* ================================================================ *
     * SOUND
     * ================================================================ */
    const sfx = (() => {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !ctx.capabilities.audio) {
        return { unlock() {}, jump() {}, land() {}, mote() {}, die() {}, act() {}, hum() {} };
      }
      let ac = null;
      function ready() {
        if (!ac) {
          try { ac = new AC(); } catch (e) { return null; }
          ctx.onDestroy(() => { try { ac.close(); } catch (e) {} });
        }
        if (ac.state === "suspended") ac.resume().catch(() => {});
        return ac;
      }
      function tone(freq, at, dur, type, peak, endFreq) {
        const a = ready();
        if (!a || !state.sound) return;
        const t0 = a.currentTime + at;
        const o = a.createOscillator(), gn = a.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0);
        if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
        gn.gain.setValueAtTime(0.0001, t0);
        gn.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.3));
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(gn).connect(a.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
      }
      return {
        unlock() { ready(); },
        jump() { tone(300, 0, 0.1, "sine", 0.11, 560); },
        land() { tone(150, 0, 0.07, "sine", 0.1, 95); },
        mote() { tone(880, 0, 0.07, "triangle", 0.13); tone(1320, 0.055, 0.1, "triangle", 0.1); },
        act() { [392, 523, 659].forEach((f, i) => tone(f, i * 0.09, 0.26, "triangle", 0.12)); },
        die() { tone(240, 0, 0.5, "sawtooth", 0.16, 70); tone(120, 0.05, 0.6, "sine", 0.12, 50); }
      };
    })();

    function haptic(kind) {
      if (state.haptics && ctx.capabilities.haptics && typeof ctx.platform.haptic === "function") ctx.platform.haptic(kind);
    }

    /* ================================================================ *
     * SESSION
     * ================================================================ */
    const state = {
      screen: "menu", sound: SOUND_DEFAULT, haptics: HAPTICS_DEFAULT,
      best: 0, bestMotes: 0, motes: 0, newBest: false, submitted: 0
    };
    const track = ctx.game && ctx.game.score ? ctx.game.score({ initial: 0, min: 0 }) : null;

    /* ---------------------------------------------------------------- *
     * STORAGE IS A CONVENIENCE, NEVER A DEPENDENCY
     * The capability flag can read true while ctx.storage itself is not
     * there -- a draft preview does exactly that -- so every call checks
     * the object it is about to use rather than the flag beside it, and
     * set() is not assumed to hand back a promise.
     * ---------------------------------------------------------------- */
    const canRead = () => !!(ctx.storage && typeof ctx.storage.get === "function");
    const canWrite = () => !!(ctx.storage && typeof ctx.storage.set === "function");
    function writeSaved(value) {
      if (!canWrite()) return;
      try {
        const r = ctx.storage.set(SAVE_KEY, value);
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (e) { /* nothing here is worth losing a game over */ }
    }

    const SAVE_KEY = "umbra/v1";
    async function loadSaved() {
      if (!canRead()) return;
      let s = null;
      try { s = await ctx.storage.get(SAVE_KEY); } catch (e) { return; }
      if (!s || typeof s !== "object") return;
      if (typeof s.sound === "boolean") state.sound = s.sound;
      if (typeof s.haptics === "boolean") state.haptics = s.haptics;
      if (Number.isFinite(s.best)) state.best = s.best;
      if (Number.isFinite(s.bestMotes)) state.bestMotes = s.bestMotes;
    }
    function save() {
      writeSaved({
        sound: state.sound, haptics: state.haptics, best: state.best, bestMotes: state.bestMotes
      });
    }

    /* ================================================================ *
     * SURFACES
     * ================================================================ */
    // Plain defaults, which is what the contract says to start with and
    // what the one bit of mine that renders on a real device uses. The
    // advanced placement opt-ins went on untested and between them put
    // this canvas somewhere nothing was ever visible. Default stacking is
    // source order, so the canvas made first sits under the HUD made
    // after it, and the HUD stays click-through from its own stylesheet.
    canvas = ctx.createCanvas2D({ touchAction: "none" });
    g = canvas.getContext("2d");

    const root = ctx.createRoot({ className: "um" });
    root.innerHTML = `<style>${CSS}</style>
<div class="um-view">
  <div class="um-hud"><div class="um-h" data-height>0</div><div class="um-sub">metres</div></div>
  <div class="um-right"><div class="um-h" data-motes>0</div><div class="um-sub" data-act>act one</div></div>
</div>
<div class="um-pads" hidden data-pads>
  <button class="um-jump" data-jump>Jump</button>
</div>
<div class="um-modal" data-modal></div>`;

    const view = root.querySelector(".um-view");
    const heightNode = root.querySelector("[data-height]");
    const motesNode = root.querySelector("[data-motes]");
    const actNode = root.querySelector("[data-act]");
    const pads = root.querySelector("[data-pads]");
    const modal = root.querySelector("[data-modal]");

    function applySafeArea() {
      const sa = ctx.safeArea || {};
      root.style.setProperty("--sat", (sa.top || 0) + "px");
      root.style.setProperty("--sar", (sa.right || 0) + "px");
      root.style.setProperty("--sab", (sa.bottom || 0) + "px");
      root.style.setProperty("--sal", (sa.left || 0) + "px");
    }
    applySafeArea();
    ctx.listen(window, "resize", applySafeArea);

    const ACTS = ["act one", "act two", "act three", "act four", "act five", "act six", "act seven"];
    const actName = n => ACTS[Math.min(n - 1, ACTS.length - 1)] || ("act " + n);

    /* ================================================================ *
     * MENUS
     * ================================================================ */
    function menuScreen() {
      return `<div class="um-card">
  <div>
    <p class="um-kick">A climb made of shadows</p>
    <h1 class="um-title">Umbra</h1>
  </div>
  <p class="um-copy">Every ledge here is the shadow of a real solid turning in front of a lamp. Stand on the dark. The light is coming up the wall behind you.</p>
  <div class="um-tip"><i>&#8597;</i><span>Drag anywhere to lean left and right.</span></div>
  <div class="um-tip"><i>&#8593;</i><span>Tap, or hit JUMP, to jump. You get a moment of grace after walking off an edge.</span></div>
  <div class="um-tip"><i>&#9681;</i><span>A slab turned edge-on is barely there. A bar sweeps like a clock hand. Watch what the solid is doing, not just the shadow.</span></div>
  ${state.best ? `<p class="um-copy">Your best climb: <b>${Math.floor(state.best / 10)}m</b></p>` : ""}
  <button class="um-btn" data-play>Climb</button>
  <div style="display:flex;gap:9px">
    <button class="um-btn ghost" data-sound>Sound ${state.sound ? "on" : "off"}</button>
    <button class="um-btn ghost" data-haptics>Buzz ${state.haptics ? "on" : "off"}</button>
  </div>
</div>`;
    }

    function deadScreen() {
      const m = Math.floor(P.best / 10);
      return `<div class="um-card">
  <div>
    <p class="um-kick">The light reached you</p>
    <h1 class="um-title">${m}m</h1>
  </div>
  <ul class="um-rows">
    <li class="um-row"><span>Motes gathered</span><b>${state.motes}</b></li>
    <li class="um-row"><span>Reached</span><b>${actName(W.act)}</b></li>
    <li class="um-row"><span>Best climb</span><b>${Math.floor(state.best / 10)}m</b></li>
  </ul>
  ${state.newBest ? `<p class="um-copy um-best">A new personal best.</p>` : ""}
  <button class="um-btn" data-play>Climb again</button>
  <button class="um-btn ghost" data-menu>Back</button>
</div>`;
    }

    function showModal(html) {
      modal.innerHTML = html;
      modal.hidden = false;
      pads.hidden = true;
      view.style.opacity = "0.2";
    }
    function hideModal() {
      modal.innerHTML = "";
      modal.hidden = true;
      pads.hidden = false;
      view.style.opacity = "1";
    }
    function gotoMenu() { state.screen = "menu"; showModal(menuScreen()); }

    /* ================================================================ *
     * INPUT
     * The whole wall is a thumb stick: wherever you put a finger down
     * becomes the centre, and sliding either way leans you. A quick tap
     * jumps, and so does the button, so it plays with one thumb or two.
     * ================================================================ */
    const pointer = ctx.input && ctx.input.track
      ? ctx.input.track(canvas, { preventDefault: true, touchAction: "none", tapMaxMs: 240, tapMaxDistance: 16 })
      : null;
    const keys = { left: false, right: false };
    let jumpQueued = 0;

    function queueJump() { jumpQueued = W.t; }

    function tryJump() {
      if (state.screen !== "play" || !P.alive) return;
      const coyote = (W.t - P.lastGround) * 1000 <= COYOTE_MS;
      if (!P.grounded && !coyote) return;
      P.vy = JUMP_V;
      P.grounded = false;
      P.lastGround = -9;
      P.squash = -0.5;
      jumpQueued = -9;
      sfx.jump();
      haptic("light");
      ctx.platform.interact({ type: "jump" });
    }

    function readMove() {
      let m = 0;
      if (keys.left) m -= 1;
      if (keys.right) m += 1;
      if (!m && pointer && pointer.down && Number.isFinite(pointer.startX)) {
        m = clamp((pointer.x - pointer.startX) / 42, -1, 1);
        if (Math.abs(m) < 0.14) m = 0;
      }
      return m;
    }

    ctx.listen(pads, "click", event => {
      const el = event.target && event.target.closest ? event.target.closest("[data-jump]") : null;
      if (el) queueJump();
    });

    ctx.listen(modal, "click", event => {
      const el = event.target && event.target.closest
        ? event.target.closest("[data-play],[data-menu],[data-sound],[data-haptics]") : null;
      if (!el) return;
      if (el.hasAttribute("data-play")) { startRun(); return; }
      if (el.hasAttribute("data-menu")) { gotoMenu(); return; }
      if (el.hasAttribute("data-sound")) { state.sound = !state.sound; save(); showModal(menuScreen()); return; }
      state.haptics = !state.haptics; save(); haptic("light"); showModal(menuScreen());
    });

    ctx.listen(window, "keydown", event => {
      const k = event.key;
      if (state.screen !== "play") {
        if (k === "Enter" && !modal.hidden) { event.preventDefault(); startRun(); }
        return;
      }
      if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = true;
      else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = true;
      else if (k === " " || k === "ArrowUp" || k === "w" || k === "W") { event.preventDefault(); queueJump(); }
    });
    ctx.listen(window, "keyup", event => {
      const k = event.key;
      if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
      else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
    });

    /* ================================================================ *
     * RUN LIFECYCLE
     * ================================================================ */
    function startRun() {
      resetWorld();
      P.x = WALL_W / 2; P.y = 40;
      P.vx = 0; P.vy = 0;
      P.grounded = false; P.lastGround = -9; P.alive = true;
      P.best = 0; P.squash = 0;
      state.screen = "play";
      state.motes = 0;
      state.newBest = false;
      state.submitted = 0;
      cam.y = -ctx.height / scaleOf() * 0.36 + 40;
      cam.shake = 0;
      fx.length = 0;
      jumpQueued = -9;
      for (const piece of W.pieces) { updatePiece(piece, 0); piece.prevAng = piece.ang; }
      if (track) track.reset();
      hideModal();
      sfx.unlock();
      ctx.platform.start({});
      ctx.platform.emit("run_start", {});
    }

    async function finishRun() {
      P.alive = false;
      state.screen = "dead";
      cam.shake = 1;
      sfx.die();
      haptic("error");
      const metres = Math.floor(P.best / 10);
      state.newBest = P.best > state.best;
      if (state.newBest) state.best = P.best;
      if (state.motes > state.bestMotes) state.bestMotes = state.motes;
      save();
      showModal(deadScreen());
      ctx.platform.fail({ metres, motes: state.motes, act: W.act });

      if (track && metres > state.submitted) {
        state.submitted = metres;
        track.set(metres);
        try { await track.submit("best_height", { label: metres + "m" }); } catch (e) { /* never break the card */ }
      }
      if (ctx.pulse && ctx.pulse.complete) {
        ctx.pulse.complete({ score: metres, result: "caught", text: `Climbed ${metres}m of shadows in Umbra` });
      }
    }

    /* ================================================================ *
     * STEP
     * ================================================================ */
    function spinRack(dt) {
      W.t += dt;
      const top = cam.y + ctx.height / scaleOf() + 240;
      for (const piece of W.pieces) {
        if (piece.y < cam.y - 300 || piece.y > top) continue;
        updatePiece(piece, W.t);
      }
    }

    function stepGame(dt) {
      spinRack(dt);

      const move = readMove();
      const accel = P.grounded ? 2400 : 1500;
      const want = move * RUN_V;
      const dv = clamp(want - P.vx, -accel * dt, accel * dt);
      P.vx += dv;
      if (!move && P.grounded) P.vx *= Math.exp(-11 * dt);

      P.vy -= GRAVITY * dt;
      if (P.vy < -MAX_FALL) P.vy = -MAX_FALL;
      P.prevY = P.y;
      P.x += P.vx * dt;
      P.y += P.vy * dt;

      const wasAir = !P.grounded;
      collide(dt);
      if (P.grounded && wasAir && P.vy < -180) { sfx.land(); haptic("light"); P.squash = 0.55; }
      P.squash *= Math.exp(-9 * dt);
      if (move) P.face = move > 0 ? 1 : -1;

      if (jumpQueued > -5 && (W.t - jumpQueued) < 0.18) tryJump();

      if (P.y > P.best) P.best = P.y;

      // Motes
      for (const m of W.motes) {
        if (m.got) continue;
        const dx = m.x - P.x, dy = m.y - P.y;
        if (dx * dx + dy * dy < 18 * 18) {
          m.got = true;
          state.motes += 1;
          fx.push({ x: m.x, y: m.y, t: 0 });
          sfx.mote(); haptic("light");
        }
      }

      // The light does not wait for you, and it gets impatient.
      const rise = RISE_BASE + RISE_RAMP * (P.best / 10) + W.t * 0.55;
      W.lightY += rise * dt;

      const act = 1 + Math.floor(P.best / ACT_HEIGHT);
      if (act > W.act) {
        W.act = act;
        sfx.act(); haptic("success");
        ctx.platform.milestone("act", { act, metres: Math.floor(P.best / 10) });
      }

      while (W.topY < P.y + 1400) addPiece();
      const floor = W.lightY - 500;
      while (W.pieces.length > 1 && W.pieces[0].y < floor) W.pieces.shift();
      while (W.motes.length && W.motes[0].y < floor) W.motes.shift();

      if (P.y + PLAYER_R < W.lightY) finishRun();
    }

    // Behind the menu the rack keeps turning, so the first thing you see
    // is the mechanism working rather than a still frame.
    function stepIdle(dt) {
      spinRack(dt);
      cam.y += 14 * dt;
      if (cam.y > W.topY - 400) { resetWorld(); cam.y = -200; }
    }

    /* ================================================================ *
     * HUD AND LOOP
     * ================================================================ */
    let hudT = 0;
    function hud(dt) {
      hudT += dt;
      if (hudT < 0.1) return;
      hudT = 0;
      if (state.screen === "play") {
        const m = Math.floor(P.best / 10);
        heightNode.textContent = m;
        motesNode.textContent = state.motes;
        actNode.textContent = actName(W.act);
        if (track) track.set(m);
      }
    }

    function update(dtMs) {
      const dt = Math.min(dtMs || 16, 40) / 1000;
      if (state.screen === "play") stepGame(dt);
      else stepIdle(dt);
      for (const e of fx) e.t += dt;
      updateCamera(dt);
      hud(dt);
    }

    if (ctx.game && ctx.game.loop) {
      ctx.game.loop({ update, render, resetOnResume: true, input: pointer || undefined });
    } else {
      ctx.onFrame(dt => { update(dt); render(); });
    }

    // A tap anywhere on the wall jumps, so the game plays with one thumb.
    if (pointer) {
      ctx.listen(canvas, "pointerup", () => {
        if (state.screen !== "play") return;
        if (pointer.distance !== undefined && pointer.distance > 16) return;
        if (pointer.durationMs !== undefined && pointer.durationMs > 260) return;
        queueJump();
      });
    }

    /* ================================================================ *
     * BOOT
     * ================================================================ */
    await loadSaved();
    resetWorld();
    cam.y = -200;
    for (const piece of W.pieces) updatePiece(piece, 0);
    updateCamera(0.016);
    render();
    ctx.markVisualReady("menu");
    gotoMenu();
    ctx.platform.ready({ title: "Umbra" });
  }
};
