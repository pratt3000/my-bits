/**
 * Windmill Cove — a mini-golf bit in the shape of Golf With Your Friends.
 *
 * Top-down, single player, six themed courses of nine holes each. The ball is
 * a real circle stepped through a swept-collision solver; every hole is a
 * grid of surface cells whose boundary is turned into wall segments at load,
 * so authoring a hole is painting rectangles rather than listing edges.
 *
 * Everything below the `window.plethoraBit` assignment at the bottom is pure:
 * no DOM, no ctx. That is deliberate — the hole data and the solver are
 * loaded by a headless harness that plays every hole to prove it is finishable.
 */

/* ------------------------------------------------------------------ maths */

var TAU = Math.PI * 2;
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var lerp = function (a, b, t) { return a + (b - a) * t; };
var len2 = function (x, y) { return Math.sqrt(x * x + y * y); };

/** Shortest angle from a to b, in (-PI, PI]. */
function angDelta(a, b) {
  var d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Deterministic hash-noise in [0,1) — used for scenery so it never shimmers. */
function hash01(a, b) {
  var h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Closest point on segment (ax,ay)-(bx,by) to (px,py), written into `out`.
 * Returns the parametric t so callers can recover a point velocity on movers.
 */
function closestOnSeg(px, py, ax, ay, bx, by, out) {
  var dx = bx - ax, dy = by - ay;
  var dd = dx * dx + dy * dy;
  var t = dd > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / dd : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = ax + dx * t;
  out.y = ay + dy * t;
  return t;
}

/* ------------------------------------------------------- surface constants */

var VOID = 0, GREEN = 1, SAND = 2, ICE = 3, WATER = 4;

/** Authoring resolution. Holes are laid out on whole units; cells are half. */
var CELL = 0.5;

var BALL_R = 0.36;
var CUP_R = 0.62;
/** Above this the ball rattles out instead of dropping. Feels like a lip-out. */
var CUP_CATCH_SPEED = 8.2;
var MAX_SHOT = 34;
var REST_SPEED = 0.42;

/** Per-surface rolling resistance (units/s^2) and viscous damping (1/s). */
var SURFACE = {};
SURFACE[GREEN] = { roll: 5.4, visc: 0.52 };
SURFACE[SAND] = { roll: 27, visc: 2.6 };
SURFACE[ICE] = { roll: 2.4, visc: 0.30 };
SURFACE[WATER] = { roll: 15, visc: 3.0 };
SURFACE[VOID] = { roll: 5.4, visc: 0.52 };

/* ------------------------------------------------------- the hole compiler */

/**
 * Turns a hole's rectangle lists into a playable hole:
 *
 *   - a cell grid of surface types (the union of every rect that adds area),
 *   - wall segments along every boundary between "inside" and VOID,
 *   - a uniform-grid index over those segments for broadphase.
 *
 * Water, sand and ice are *inside* the course, so they add cells and never
 * grow a wall. Only `cuts` remove area, and that is what puts a wall in the
 * middle of a fairway. Painting a hole is therefore: lay down pads, drop in
 * hazards, carve the blockers.
 */
function compileHole(def) {
  var gw = Math.round(def.w / CELL), gh = Math.round(def.h / CELL);
  var surf = new Uint8Array(gw * gh);

  function paint(rects, type) {
    if (!rects) return;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var x0 = Math.round(r[0] / CELL), y0 = Math.round(r[1] / CELL);
      var x1 = Math.round((r[0] + r[2]) / CELL), y1 = Math.round((r[1] + r[3]) / CELL);
      for (var gy = Math.max(0, y0); gy < Math.min(gh, y1); gy++) {
        for (var gx = Math.max(0, x0); gx < Math.min(gw, x1); gx++) surf[gy * gw + gx] = type;
      }
    }
  }

  // Order matters: area first, then hazards over it, then bridges back to
  // green, then cuts punch holes through everything.
  paint(def.pads, GREEN);
  paint(def.water, WATER);
  paint(def.sand, SAND);
  paint(def.ice, ICE);
  paint(def.bridges, GREEN);
  paint(def.cuts, VOID);
  paint([[def.tee[0] - 1.5, def.tee[1] - 1.5, 3, 3]], GREEN);
  paint([[def.cup[0] - 1.5, def.cup[1] - 1.5, 3, 3]], GREEN);

  var inside = function (gx, gy) {
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return false;
    return surf[gy * gw + gx] !== VOID;
  };

  // Boundary extraction. Every cell edge with inside on exactly one side is a
  // wall; runs of collinear edges are merged so a long rail is one segment.
  var walls = [];
  var gx, gy, run;
  for (gx = 0; gx <= gw; gx++) {                      // vertical walls
    run = -1;
    for (gy = 0; gy <= gh; gy++) {
      var v = gy < gh && (inside(gx - 1, gy) !== inside(gx, gy));
      if (v && run < 0) run = gy;
      else if (!v && run >= 0) {
        walls.push({ ax: gx * CELL, ay: run * CELL, bx: gx * CELL, by: gy * CELL, e: 0 });
        run = -1;
      }
    }
  }
  for (gy = 0; gy <= gh; gy++) {                      // horizontal walls
    run = -1;
    for (gx = 0; gx <= gw; gx++) {
      var h = gx < gw && (inside(gx, gy - 1) !== inside(gx, gy));
      if (h && run < 0) run = gx;
      else if (!h && run >= 0) {
        walls.push({ ax: run * CELL, ay: gy * CELL, bx: gx * CELL, by: gy * CELL, e: 0 });
        run = -1;
      }
    }
  }

  // Broadphase: bucket every segment into a coarse grid so a step only tests
  // the handful of walls near the ball rather than all ~150 of them.
  var BUCKET = 3;
  var bw = Math.ceil(def.w / BUCKET), bh = Math.ceil(def.h / BUCKET);
  var buckets = new Array(bw * bh);
  for (var i = 0; i < walls.length; i++) {
    var s = walls[i];
    var bx0 = clamp(Math.floor(Math.min(s.ax, s.bx) / BUCKET) - 1, 0, bw - 1);
    var bx1 = clamp(Math.floor(Math.max(s.ax, s.bx) / BUCKET) + 1, 0, bw - 1);
    var by0 = clamp(Math.floor(Math.min(s.ay, s.by) / BUCKET) - 1, 0, bh - 1);
    var by1 = clamp(Math.floor(Math.max(s.ay, s.by) / BUCKET) + 1, 0, bh - 1);
    for (var by = by0; by <= by1; by++) {
      for (var bx = bx0; bx <= bx1; bx++) {
        var k = by * bw + bx;
        (buckets[k] || (buckets[k] = [])).push(s);
      }
    }
  }

  return {
    def: def, gw: gw, gh: gh, surf: surf, walls: walls,
    bw: bw, bh: bh, bucket: BUCKET, buckets: buckets,
    w: def.w, h: def.h,
    posts: def.posts || [], movers: def.movers || [], spinners: def.spinners || [],
    slopes: def.slopes || [], boosts: def.boosts || [], fans: def.fans || [],
    portals: def.portals || [], wells: def.wells || [],
    tee: def.tee, cup: def.cup, par: def.par, name: def.name
  };
}

/** Surface type under a world point. Off-grid reads as VOID (out of bounds). */
function surfAt(hole, x, y) {
  var gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
  if (gx < 0 || gy < 0 || gx >= hole.gw || gy >= hole.gh) return VOID;
  return hole.surf[gy * hole.gw + gx];
}

function wallsNear(hole, x, y) {
  var bx = clamp(Math.floor(x / hole.bucket), 0, hole.bw - 1);
  var by = clamp(Math.floor(y / hole.bucket), 0, hole.bh - 1);
  return hole.buckets[by * hole.bw + bx] || null;
}

function inRect(r, x, y) {
  return x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
}

/* ---------------------------------------------------- moving-part kinematics */

/** Mover rect at time t: a sine slide between two ends, plus its velocity. */
function moverAt(m, t) {
  var period = m[6], ph = t * TAU / period + m[7];
  var off = Math.sin(ph), w = TAU / period;
  return {
    x: m[0] + m[4] * off, y: m[1] + m[5] * off, w: m[2], h: m[3],
    vx: m[4] * Math.cos(ph) * w, vy: m[5] * Math.cos(ph) * w
  };
}

/** Spinner blade angles at time t. Blades are evenly spread around the hub. */
function spinnerAngle(s, t) { return s[4] * t + s[5]; }

/* --------------------------------------------------------- the ball solver */

/**
 * One collision response against a closest-point contact. `ox,oy` is the
 * collider's own velocity at the contact, so a windmill blade or a sliding
 * platform throws the ball instead of merely stopping it.
 */
function resolveContact(ball, cx, cy, restitution, mu, ox, oy) {
  var dx = ball.x - cx, dy = ball.y - cy;
  var d = len2(dx, dy);
  if (d >= BALL_R) return 0;
  var nx, ny;
  if (d > 1e-6) { nx = dx / d; ny = dy / d; }
  else {                                    // dead centre: back out the way we came
    var sp = len2(ball.vx, ball.vy);
    if (sp < 1e-6) return 0;
    nx = -ball.vx / sp; ny = -ball.vy / sp;
  }
  ball.x = cx + nx * (BALL_R + 1e-4);
  ball.y = cy + ny * (BALL_R + 1e-4);

  var rvx = ball.vx - ox, rvy = ball.vy - oy;
  var vn = rvx * nx + rvy * ny;
  if (vn >= 0) { ball.vx = rvx + ox; ball.vy = rvy + oy; return 0; }
  var impact = -vn;
  rvx -= (1 + restitution) * vn * nx;
  rvy -= (1 + restitution) * vn * ny;
  var tvx = rvx - (rvx * nx + rvy * ny) * nx;   // shave tangential speed a little
  var tvy = rvy - (rvx * nx + rvy * ny) * ny;
  rvx -= tvx * mu; rvy -= tvy * mu;
  ball.vx = rvx + ox; ball.vy = rvy + oy;
  return impact;
}

/** Closest point on an axis-aligned rect (clamped), for movers and blocks. */
function closestOnRect(px, py, rx, ry, rw, rh, out) {
  out.x = clamp(px, rx, rx + rw);
  out.y = clamp(py, ry, ry + rh);
}

var _p = { x: 0, y: 0 };

/**
 * Advances the ball by dt. Sub-steps so a hard shot cannot tunnel a rail,
 * and reports what happened so the game layer can make noise about it.
 */
function stepBall(hole, ball, dt, time, ev) {
  ev.impact = 0; ev.water = false; ev.out = false; ev.holed = false;
  ev.lip = false; ev.portal = false; ev.boost = false; ev.sunk = false;

  var speed = len2(ball.vx, ball.vy);
  var steps = clamp(Math.ceil(speed * dt / (BALL_R * 0.55)), 1, 16);
  var sdt = dt / steps;

  for (var step = 0; step < steps; step++) {
    var st = time + sdt * step;
    var surf = surfAt(hole, ball.x, ball.y);
    var mat = SURFACE[surf] || SURFACE[GREEN];
    var ax = 0, ay = 0, forced = false;
    var i, r;

    for (i = 0; i < hole.slopes.length; i++) {
      r = hole.slopes[i];
      if (inRect(r, ball.x, ball.y)) { ax += r[4] * r[6]; ay += r[5] * r[6]; forced = true; }
    }
    for (i = 0; i < hole.fans.length; i++) {
      r = hole.fans[i];
      if (inRect(r, ball.x, ball.y)) { ax += r[4] * r[6]; ay += r[5] * r[6]; forced = true; }
    }
    for (i = 0; i < hole.wells.length; i++) {
      var wl = hole.wells[i];
      var wdx = wl[0] - ball.x, wdy = wl[1] - ball.y, wd = len2(wdx, wdy);
      if (wd < wl[2] && wd > 1e-4) {
        var pull = wl[3] * (1 - wd / wl[2]) * Math.min(1, wd / 1.4);
        ax += (wdx / wd) * pull; ay += (wdy / wd) * pull; forced = true;
        if (wl[4] && wd < 0.9) { ev.sunk = true; return; }
      }
    }
    for (i = 0; i < hole.boosts.length; i++) {
      r = hole.boosts[i];
      if (inRect(r, ball.x, ball.y)) {
        var along = ball.vx * r[4] + ball.vy * r[5];
        if (along < r[6]) {                       // top up to the pad's speed
          ball.vx += r[4] * (r[6] - along); ball.vy += r[5] * (r[6] - along);
          ev.boost = true;
        }
      }
    }

    ball.vx += ax * sdt; ball.vy += ay * sdt;

    // viscous drag, then constant rolling resistance so the ball truly stops
    var damp = Math.exp(-mat.visc * sdt);
    ball.vx *= damp; ball.vy *= damp;
    var sp = len2(ball.vx, ball.vy);
    if (sp > 1e-6) {
      var drop = mat.roll * sdt;
      var ns = sp - drop;
      if (ns <= 0) { ball.vx = 0; ball.vy = 0; }
      else { ball.vx = ball.vx / sp * ns; ball.vy = ball.vy / sp * ns; }
    }

    ball.x += ball.vx * sdt;
    ball.y += ball.vy * sdt;

    // ---- static rails
    var near = wallsNear(hole, ball.x, ball.y);
    if (near) {
      for (i = 0; i < near.length; i++) {
        var s = near[i];
        closestOnSeg(ball.x, ball.y, s.ax, s.ay, s.bx, s.by, _p);
        var imp = resolveContact(ball, _p.x, _p.y, 0.55, 0.14, 0, 0);
        if (imp > ev.impact) ev.impact = imp;
      }
    }

    // ---- posts and bumpers
    for (i = 0; i < hole.posts.length; i++) {
      var po = hole.posts[i];
      var pdx = ball.x - po[0], pdy = ball.y - po[1], pd = len2(pdx, pdy);
      if (pd < po[2] + BALL_R) {
        var k = pd > 1e-6 ? po[2] / pd : 0;
        var e = po[3] === 1 ? 0.94 : 0.56;
        var imp2 = resolveContact(ball, po[0] + pdx * k, po[1] + pdy * k, e, 0.1, 0, 0);
        if (imp2 > ev.impact) ev.impact = imp2;
        if (po[3] === 1 && imp2 > 0.5) ev.boost = true;
      }
    }

    // ---- sliding platforms
    for (i = 0; i < hole.movers.length; i++) {
      var mv = moverAt(hole.movers[i], st);
      closestOnRect(ball.x, ball.y, mv.x, mv.y, mv.w, mv.h, _p);
      var imp3 = resolveContact(ball, _p.x, _p.y, 0.5, 0.2, mv.vx, mv.vy);
      if (imp3 > ev.impact) ev.impact = imp3;
    }

    // ---- windmill blades: a rotating capsule, thrown by its own tip speed
    for (i = 0; i < hole.spinners.length; i++) {
      var sn = hole.spinners[i];
      var base = spinnerAngle(sn, st), nb = sn[6];
      for (var b = 0; b < nb; b++) {
        var a = base + b * TAU / nb;
        var ex = sn[0] + Math.cos(a) * sn[2], ey = sn[1] + Math.sin(a) * sn[2];
        var tpar = closestOnSeg(ball.x, ball.y, sn[0], sn[1], ex, ey, _p);
        var rr = sn[2] * tpar;
        var ovx = -Math.sin(a) * sn[4] * rr, ovy = Math.cos(a) * sn[4] * rr;
        var bdx = ball.x - _p.x, bdy = ball.y - _p.y, bd = len2(bdx, bdy);
        if (bd < sn[3] + BALL_R) {
          var kk = bd > 1e-6 ? sn[3] / bd : 0;
          var imp4 = resolveContact(ball, _p.x + bdx * kk, _p.y + bdy * kk, 0.5, 0.16, ovx, ovy);
          if (imp4 > ev.impact) ev.impact = imp4;
        }
      }
    }

    // ---- portals
    if (ball.portalCd > 0) ball.portalCd -= sdt;
    else {
      for (i = 0; i < hole.portals.length; i++) {
        var pt = hole.portals[i];
        var d0 = len2(ball.x - pt[0], ball.y - pt[1]);
        var d1 = len2(ball.x - pt[2], ball.y - pt[3]);
        if (d0 < pt[4]) {
          ball.x = pt[2]; ball.y = pt[3]; ball.portalCd = 0.35; ev.portal = true; break;
        }
        if (d1 < pt[4]) {
          ball.x = pt[0]; ball.y = pt[1]; ball.portalCd = 0.35; ev.portal = true; break;
        }
      }
    }

    // ---- the cup
    var cdx = ball.x - hole.cup[0], cdy = ball.y - hole.cup[1];
    var cd = len2(cdx, cdy);
    if (cd < CUP_R) {
      var csp = len2(ball.vx, ball.vy);
      if (csp <= CUP_CATCH_SPEED) { ev.holed = true; return; }
      var cn = cd > 1e-6 ? 1 / cd : 0;             // too quick: ride the far lip
      var lnx = cdx * cn, lny = cdy * cn;
      ball.x = hole.cup[0] + lnx * CUP_R;
      ball.y = hole.cup[1] + lny * CUP_R;
      var lvn = ball.vx * lnx + ball.vy * lny;
      if (lvn < 0) { ball.vx -= 1.45 * lvn * lnx; ball.vy -= 1.45 * lvn * lny; }
      ball.vx *= 0.72; ball.vy *= 0.72;
      ev.lip = true;
    }

    // ---- hazards
    var now = surfAt(hole, ball.x, ball.y);
    if (now === WATER) { ev.water = true; return; }
    if (now === VOID) { ev.out = true; return; }

    // Resting: only where nothing is pushing the ball along.
    if (!forced && len2(ball.vx, ball.vy) < REST_SPEED) { ball.vx = 0; ball.vy = 0; }
  }
}

/* ============================================================== the courses

   A hole is painted, not drawn. `pads` lay down fairway, `water/sand/ice`
   drop hazards into it, `bridges` put green back on top, and `cuts` punch
   blockers whose edges the compiler turns into rails.

   Rect form is [x, y, w, h]. Directional zones append a unit vector and a
   strength: slopes/fans [.., dx, dy, accel], boosts [.., dx, dy, speed].
   posts    [x, y, r, kind]           kind 1 = springy bumper
   movers   [x, y, w, h, dx, dy, period, phase]   slides +/- (dx,dy)
   spinners [x, y, reach, thick, omega, phase, blades]
   portals  [ax, ay, bx, by, r]
   wells    [x, y, r, pull, kills]
                                                                            */

var COURSES = [
  {
    id: "fernwood", name: "Fernwood", theme: "forest", icon: "🌲",
    blurb: "Pines, millstreams and the oldest windmill in the game.",
    holes: [
      {
        name: "Opening Drive", par: 2, w: 24, h: 40,
        pads: [[4, 4, 16, 32]], tee: [12, 34], cup: [12, 8],
        posts: [[8.5, 20, 0.85, 0], [15.5, 25, 0.85, 0]]
      },
      {
        name: "Dogleg", par: 3, w: 28, h: 42,
        pads: [[4, 28, 20, 10], [4, 5, 10, 33]],
        tee: [20, 33], cup: [9, 9],
        posts: [[16.5, 31.5, 0.8, 0]]
      },
      {
        name: "The Windmill", par: 3, w: 26, h: 44,
        pads: [[5, 4, 16, 36]], tee: [13, 36], cup: [13, 8],
        spinners: [[13, 22, 5.6, 0.45, 1.5, 0, 4]]
      },
      {
        name: "Split Creek", par: 3, w: 26, h: 44,
        pads: [[4, 4, 18, 36]],
        water: [[4, 20, 18, 5]],
        bridges: [[11, 20, 4, 5]],
        tee: [13, 35], cup: [13, 9],
        posts: [[8, 12, 0.8, 0], [18, 12, 0.8, 0]]
      },
      {
        name: "Log Jam", par: 3, w: 28, h: 44,
        pads: [[4, 4, 20, 36]], tee: [14, 36], cup: [14, 8],
        posts: [
          [10, 27, 1.1, 0], [18, 27, 1.1, 0], [14, 21, 1.2, 0],
          [9, 15, 1.0, 0], [19, 15, 1.0, 0]
        ]
      },
      {
        name: "Switchback", par: 5, w: 30, h: 48,
        pads: [[4, 36, 22, 8], [4, 22, 22, 8], [4, 6, 22, 8],
               [4, 22, 7, 22], [19, 6, 7, 22]],
        tee: [22, 40], cup: [8, 10],
        slopes: [[4, 22, 22, 8, 1, 0, 5], [4, 30, 7, 14, 0, -1, 5],
                 [19, 6, 7, 16, 0, -1, 5]]
      },
      {
        name: "The Millpond", par: 4, w: 30, h: 46,
        pads: [[4, 4, 22, 38]],
        water: [[6, 10, 18, 20]],
        bridges: [[11, 10, 8, 20]],
        tee: [15, 37], cup: [15, 7],
        spinners: [[15, 20, 2.2, 0.4, -1.1, 0, 3]]
      },
      {
        name: "Twin Mills", par: 4, w: 28, h: 52,
        pads: [[4, 4, 20, 44]], tee: [14, 44], cup: [14, 8],
        spinners: [[14, 32, 5.2, 0.45, 1.7, 0, 3], [14, 17, 5.2, 0.45, -1.9, 1.1, 3]],
        posts: [[6.5, 24.5, 0.9, 0], [21.5, 24.5, 0.9, 0]]
      },
      {
        name: "Fernwood Falls", par: 4, w: 30, h: 54,
        pads: [[4, 4, 22, 46]],
        water: [[4, 32, 8, 6], [18, 32, 8, 6]],
        tee: [15, 45], cup: [15, 8],
        slopes: [[4, 14, 22, 10, 0, 1, 4.5]],
        posts: [[10, 19, 0.9, 0], [20, 19, 0.9, 0]]
      }
    ]
  },
  {
    id: "buccaneer", name: "Buccaneer Bay", theme: "pirate", icon: "🏴‍☠️",
    blurb: "Cannons, sliding planks and a whirlpool that eats good shots.",
    holes: [
      {
        name: "Shallows", par: 2, w: 24, h: 40,
        pads: [[8, 4, 8, 32]],
        water: [[3, 4, 5, 32], [16, 4, 5, 32]],
        tee: [12, 33], cup: [12, 8]
      },
      {
        name: "Plank Walk", par: 3, w: 26, h: 44,
        pads: [[5, 28, 16, 12], [5, 4, 16, 12]],
        water: [[5, 16, 16, 12]],
        bridges: [[11, 16, 4, 12]],
        tee: [13, 35], cup: [13, 8],
        movers: [[10.5, 20, 5, 1.6, 5, 0, 4.2, 0]]
      },
      {
        name: "Cannon Run", par: 3, w: 28, h: 48,
        pads: [[5, 34, 18, 10], [5, 4, 18, 12]],
        water: [[5, 16, 18, 18]],
        bridges: [[12.5, 16, 3, 18]],
        tee: [14, 39], cup: [14, 8],
        boosts: [[11, 30, 6, 4, 0, -1, 21]]
      },
      {
        name: "Whirlpool", par: 3, w: 28, h: 46,
        pads: [[4, 4, 20, 38]],
        water: [[4, 4, 20, 38]],
        bridges: [[4, 30, 20, 12], [4, 4, 20, 12], [10, 12, 8, 18]],
        tee: [14, 37], cup: [14, 8],
        wells: [[14, 21, 5.5, 9, 0]]
      },
      {
        name: "Crossfire", par: 4, w: 28, h: 50,
        pads: [[5, 4, 18, 42]],
        water: [[5, 4, 18, 42]],
        bridges: [[5, 36, 18, 10], [5, 4, 18, 10], [8, 14, 12, 22]],
        tee: [14, 41], cup: [14, 8],
        movers: [[9, 18, 5, 1.6, 5, 0, 3.6, 0], [9, 28, 5, 1.6, 5, 0, 3.6, 2.1]]
      },
      {
        name: "The Reef", par: 4, w: 30, h: 48,
        pads: [[4, 4, 22, 40]],
        water: [[8, 14, 6, 8], [17, 24, 6, 8]],
        tee: [15, 39], cup: [15, 8],
        posts: [[15, 32, 1.2, 0], [10, 26, 1.0, 0], [21, 17, 1.1, 0], [15, 12, 1.0, 0]]
      },
      {
        name: "Kraken's Maw", par: 4, w: 30, h: 50,
        pads: [[4, 4, 22, 42]],
        water: [[4, 18, 6, 12], [20, 18, 6, 12]],
        tee: [15, 41], cup: [15, 8],
        spinners: [[15, 24, 2.2, 0.5, 1.4, 0, 4]],
        posts: [[15, 34, 1.1, 0]]
      },
      {
        name: "Cannonade", par: 4, w: 26, h: 54,
        pads: [[4, 40, 18, 8], [16, 26, 6, 22], [4, 26, 18, 8],
               [4, 12, 6, 22], [4, 6, 18, 8]],
        tee: [8, 44], cup: [18, 10],
        boosts: [[16, 30, 6, 6, 0, -1, 15], [4, 16, 6, 6, 0, -1, 15]]
      },
      {
        name: "Davy Jones", par: 5, w: 32, h: 56,
        pads: [[4, 4, 24, 48]],
        water: [[4, 4, 24, 48]],
        bridges: [[4, 40, 24, 12], [4, 4, 24, 10], [6, 14, 7, 26], [19, 14, 7, 26]],
        tee: [16, 46], cup: [16, 8],
        wells: [[16, 27, 3.6, 8, 0]],
        movers: [[7, 20, 3, 1.6, 0, 6, 5, 0], [21, 28, 3, 1.6, 0, -6, 5, 1.6]]
      }
    ]
  }
  ,{
    id: "oasis", name: "Sunken Oasis", theme: "desert", icon: "🏜️",
    blurb: "Sand that swallows a putt, and tomb doors that move you.",
    holes: [
      {
        name: "Dune Start", par: 3, w: 24, h: 40,
        pads: [[4, 4, 16, 32]],
        sand: [[4, 16, 16, 6]],
        tee: [12, 34], cup: [12, 8]
      },
      {
        name: "Scarab Gate", par: 3, w: 26, h: 44,
        pads: [[5, 4, 16, 36]],
        sand: [[5, 26, 16, 5]],
        tee: [13, 36], cup: [13, 8],
        spinners: [[13, 18, 4.6, 0.45, 1.3, 0, 3]]
      },
      {
        name: "The Sphinx", par: 3, w: 28, h: 44,
        pads: [[4, 26, 20, 14], [4, 4, 20, 14]],
        tee: [18, 34], cup: [8, 9],
        portals: [[7, 33, 21, 10, 1.7]],
        sand: [[12, 30, 6, 6]]
      },
      {
        name: "Quicksand", par: 4, w: 28, h: 46,
        pads: [[4, 4, 20, 38]],
        sand: [[4, 12, 20, 20]],
        bridges: [[9, 12, 5, 20]],
        tee: [14, 37], cup: [14, 8],
        posts: [[19, 22, 1.2, 0]]
      },
      {
        name: "Obelisk Row", par: 4, w: 28, h: 48,
        pads: [[4, 4, 20, 40]],
        sand: [[4, 30, 20, 5]],
        tee: [14, 39], cup: [14, 8],
        posts: [
          [9, 26, 1.3, 0], [19, 26, 1.3, 0], [14, 20, 1.4, 0],
          [8, 14, 1.2, 0], [20, 14, 1.2, 0]
        ]
      },
      {
        name: "Tomb Portal", par: 4, w: 30, h: 48,
        pads: [[4, 30, 22, 14], [4, 4, 22, 14]],
        sand: [[4, 30, 22, 5]],
        tee: [22, 39], cup: [8, 9],
        portals: [[7, 37, 22, 10, 1.7], [22, 34, 8, 16, 1.7]]
      },
      {
        name: "Serpent Pass", par: 5, w: 30, h: 50,
        pads: [[4, 38, 22, 8], [4, 24, 22, 8], [4, 8, 22, 8],
               [4, 24, 7, 22], [19, 8, 7, 24]],
        sand: [[13, 40, 6, 5]],
        tee: [22, 42], cup: [9, 12],
        slopes: [[4, 30, 7, 16, 0, -1, 5], [4, 24, 22, 8, 1, 0, 5],
                 [19, 8, 7, 16, 0, -1, 5]]
      },
      {
        name: "The Pharaoh", par: 5, w: 32, h: 54,
        pads: [[4, 4, 24, 46]],
        sand: [[4, 32, 24, 8], [4, 14, 10, 8], [18, 14, 10, 8]],
        tee: [16, 45], cup: [16, 8],
        spinners: [[16, 26, 5.5, 0.5, -1.5, 0, 4]],
        portals: [[7, 36, 25, 18, 1.7]],
        posts: [[16, 12, 1.1, 0]]
      },
      {
        name: "Mirage", par: 4, w: 30, h: 48,
        pads: [[4, 4, 22, 40]],
        sand: [[10, 18, 10, 10]],
        tee: [15, 39], cup: [15, 8],
        portals: [[6, 30, 24, 16, 1.6], [24, 30, 6, 16, 1.6]],
        posts: [[15, 23, 1.6, 0]]
      }
    ]
  },
  {
    id: "manor", name: "Hollow Manor", theme: "haunted", icon: "👻",
    blurb: "Cold floors, sliding doors and something that keeps moving.",
    holes: [
      {
        name: "Creaking Gate", par: 2, w: 24, h: 40,
        pads: [[4, 4, 16, 32]],
        tee: [12, 34], cup: [12, 8],
        movers: [[6, 20, 5, 1.4, 5, 0, 3.4, 0]]
      },
      {
        name: "The Long Hall", par: 3, w: 24, h: 52,
        pads: [[4, 4, 16, 44]],
        tee: [12, 44], cup: [12, 8],
        movers: [[5, 32, 5, 1.4, 5, 0, 3.2, 0], [10, 20, 5, 1.4, -5, 0, 3.2, 1.4]]
      },
      {
        name: "Portrait Gallery", par: 3, w: 28, h: 44,
        pads: [[4, 4, 20, 36]],
        tee: [14, 35], cup: [14, 8],
        posts: [[7, 28, 1.1, 0], [21, 28, 1.1, 0], [7, 16, 1.1, 0], [21, 16, 1.1, 0]],
        movers: [[10, 22, 4, 1.4, 4, 0, 3.6, 0]]
      },
      {
        name: "Cold Spot", par: 3, w: 26, h: 44,
        pads: [[5, 4, 16, 36]],
        ice: [[5, 14, 16, 12]],
        tee: [13, 36], cup: [13, 8],
        posts: [[13, 20, 1.3, 0]]
      },
      {
        name: "The Seance", par: 4, w: 30, h: 46,
        pads: [[4, 28, 22, 14], [4, 4, 22, 14]],
        ice: [[4, 4, 22, 14]],
        tee: [21, 35], cup: [9, 9],
        portals: [[8, 35, 22, 10, 1.7], [21, 31, 9, 14, 1.7]]
      },
      {
        name: "Cellar Steps", par: 5, w: 28, h: 52,
        pads: [[4, 40, 20, 8], [4, 26, 20, 8], [4, 8, 20, 8],
               [4, 26, 7, 22], [17, 8, 7, 26]],
        tee: [20, 44], cup: [8, 12],
        slopes: [[4, 32, 7, 16, 0, -1, 5], [4, 26, 20, 8, 1, 0, 5],
                 [17, 8, 7, 18, 0, -1, 5]]
      },
      {
        name: "Poltergeist", par: 4, w: 30, h: 50,
        pads: [[4, 4, 22, 42]],
        ice: [[4, 22, 22, 10]],
        tee: [15, 41], cup: [15, 8],
        spinners: [[15, 27, 5.4, 0.5, -1.8, 0, 4]],
        movers: [[6, 14, 5, 1.4, 6, 0, 3.4, 0]]
      },
      {
        name: "The Crypt", par: 4, w: 30, h: 50,
        pads: [[4, 4, 22, 42]],
        cuts: [[9, 30, 5, 5], [18, 30, 5, 5], [13, 20, 5, 5], [9, 11, 5, 5], [18, 11, 5, 5]],
        tee: [15, 42], cup: [15, 7]
      },
      {
        name: "Manor Heart", par: 5, w: 32, h: 56,
        pads: [[4, 4, 24, 48]],
        ice: [[4, 30, 24, 10]],
        cuts: [[12, 16, 8, 6]],
        tee: [16, 47], cup: [16, 9],
        spinners: [[16, 35, 6, 0.5, 1.5, 0, 4]],
        movers: [[6, 25, 6, 1.4, 7, 0, 4, 0]],
        posts: [[9, 12, 1.2, 0], [23, 12, 1.2, 0]]
      }
    ]
  },
  {
    id: "sugar", name: "Sugar Rush", theme: "candy", icon: "🍭",
    blurb: "Gumdrops that fire you back, frosting you cannot stop on.",
    holes: [
      {
        name: "Gumdrop Lane", par: 2, w: 24, h: 40,
        pads: [[4, 4, 16, 32]],
        tee: [12, 34], cup: [12, 8],
        posts: [[9, 22, 1.2, 1], [15, 16, 1.2, 1]]
      },
      {
        name: "Licorice Bend", par: 3, w: 28, h: 44,
        pads: [[4, 30, 20, 10], [4, 5, 10, 35]],
        tee: [20, 35], cup: [9, 9],
        posts: [[17, 31, 1.3, 1], [9, 20, 1.1, 1]]
      },
      {
        name: "The Slide", par: 3, w: 26, h: 50,
        pads: [[5, 4, 16, 42]],
        tee: [13, 42], cup: [13, 8],
        boosts: [[6, 24, 14, 8, 0, -1, 17]],
        posts: [[8, 14, 1.1, 1], [18, 14, 1.1, 1]]
      },
      {
        name: "Frosting Rink", par: 3, w: 28, h: 44,
        pads: [[4, 4, 20, 36]],
        ice: [[6, 12, 16, 18]],
        tee: [14, 35], cup: [14, 8],
        posts: [[14, 21, 1.4, 1]]
      },
      {
        name: "Bumper Patch", par: 4, w: 28, h: 48,
        pads: [[4, 4, 20, 40]],
        tee: [14, 40], cup: [14, 8],
        posts: [
          [9, 31, 1.2, 1], [19, 31, 1.2, 1], [14, 25, 1.3, 1],
          [8, 18, 1.2, 1], [20, 18, 1.2, 1], [14, 13, 1.1, 1]
        ]
      },
      {
        name: "Peppermint Spin", par: 4, w: 28, h: 48,
        pads: [[4, 4, 20, 40]],
        ice: [[4, 26, 20, 8]],
        tee: [14, 40], cup: [14, 8],
        spinners: [[14, 18, 5, 0.5, 2.1, 0, 4]],
        posts: [[7, 30, 1.1, 1], [21, 30, 1.1, 1]]
      },
      {
        name: "Syrup Falls", par: 4, w: 28, h: 52,
        pads: [[4, 4, 20, 44]],
        ice: [[4, 14, 20, 12]],
        tee: [14, 44], cup: [14, 8],
        slopes: [[4, 28, 20, 12, 0, -1, 5]],
        posts: [[10, 20, 1.2, 1], [18, 20, 1.2, 1]]
      },
      {
        name: "Jawbreaker", par: 4, w: 30, h: 50,
        pads: [[4, 4, 22, 42]],
        tee: [15, 42], cup: [15, 8],
        posts: [[15, 26, 3.2, 1], [8, 16, 1.3, 1], [22, 16, 1.3, 1],
                [8, 34, 1.3, 1], [22, 34, 1.3, 1]]
      },
      {
        name: "Sugar Rush", par: 5, w: 32, h: 56,
        pads: [[4, 4, 24, 48]],
        ice: [[4, 18, 24, 10]],
        tee: [16, 47], cup: [16, 8],
        boosts: [[8, 34, 16, 6, 0, -1, 16]],
        spinners: [[16, 13, 5.2, 0.5, -2, 0, 4]],
        posts: [[9, 42, 1.3, 1], [23, 42, 1.3, 1], [16, 23, 1.6, 1]]
      }
    ]
  },
  {
    id: "orbital", name: "Orbital Nine", theme: "space", icon: "🛰️",
    blurb: "No friction worth the name, and a hole that pulls harder than the cup.",
    holes: [
      {
        name: "Airlock", par: 2, w: 24, h: 40,
        pads: [[4, 4, 16, 32]],
        ice: [[4, 14, 16, 10]],
        tee: [12, 34], cup: [12, 8]
      },
      {
        name: "Zero-G Drift", par: 3, w: 26, h: 44,
        pads: [[5, 4, 16, 36]],
        ice: [[5, 4, 16, 36]],
        tee: [13, 36], cup: [13, 8],
        posts: [[13, 22, 1.4, 0]]
      },
      {
        name: "Gravity Well", par: 3, w: 28, h: 44,
        pads: [[4, 4, 20, 36]],
        ice: [[4, 12, 20, 16]],
        tee: [14, 35], cup: [14, 8],
        wells: [[8, 20, 4.5, 7, 0]]
      },
      {
        name: "Wormhole", par: 3, w: 28, h: 46,
        pads: [[4, 30, 20, 12], [4, 4, 20, 12]],
        ice: [[4, 4, 20, 12]],
        tee: [19, 36], cup: [9, 9],
        portals: [[8, 36, 20, 10, 1.7]]
      },
      {
        name: "Debris Field", par: 4, w: 30, h: 48,
        pads: [[4, 4, 22, 40]],
        ice: [[4, 14, 22, 20]],
        tee: [15, 39], cup: [15, 8],
        posts: [[9, 30, 1.1, 0], [20, 30, 1.1, 0], [15, 24, 1.2, 1],
                [9, 18, 1.1, 0], [20, 18, 1.1, 0]]
      },
      {
        name: "Solar Sail", par: 4, w: 28, h: 50,
        pads: [[4, 4, 20, 42]],
        ice: [[4, 30, 20, 8]],
        tee: [14, 42], cup: [14, 8],
        fans: [[4, 22, 20, 7, 1, 0, 4], [4, 11, 20, 7, -1, 0, 4]],
        posts: [[14, 32, 1.2, 0], [8, 17, 1.1, 0], [20, 17, 1.1, 0]]
      },
      {
        name: "Event Horizon", par: 4, w: 30, h: 50,
        pads: [[4, 4, 22, 42]],
        ice: [[4, 4, 22, 42]],
        tee: [15, 42], cup: [15, 8],
        wells: [[15, 25, 4.2, 10, 1]],
        posts: [[7, 25, 1.2, 0], [23, 25, 1.2, 0]]
      },
      {
        name: "Docking Bay", par: 4, w: 30, h: 52,
        pads: [[4, 4, 22, 44]],
        ice: [[4, 20, 22, 14]],
        tee: [15, 44], cup: [15, 8],
        movers: [[6, 30, 5, 1.6, 6, 0, 3.6, 0], [15, 18, 5, 1.6, -6, 0, 3.6, 1.6]]
      },
      {
        name: "Deep Orbit", par: 5, w: 32, h: 58,
        pads: [[4, 4, 24, 50]],
        ice: [[4, 4, 24, 50]],
        cuts: [[13, 26, 6, 6]],
        tee: [16, 49], cup: [16, 8],
        wells: [[8, 38, 4, 7, 0], [24, 18, 4, 7, 0]],
        portals: [[7, 46, 25, 12, 1.7]],
        spinners: [[16, 15, 5.4, 0.5, 1.6, 0, 4]]
      }
    ]
  }
];

/* ------------------------------------------------------------- the palettes */

var THEMES = {
  forest: {
    sky: "#1d3320", sky2: "#12211a", grass: ["#4fae3c", "#43992f"],
    rail: "#6d4526", railTop: "#8f5f37", railDark: "#3a2312", cap: "#a8763f",
    water: ["#2f7fb5", "#1f5f92"], sand: "#d8c07a", ice: "#bfe4ee",
    ink: "#f2f7ef", music: "cozy", scenery: "pine"
  },
  pirate: {
    sky: "#0d3b4a", sky2: "#072633", grass: ["#4bb05a", "#3d9749"],
    rail: "#7a5637", railTop: "#9c7248", railDark: "#3f2a17", cap: "#b98c53",
    water: ["#1f88a8", "#0f5f7d"], sand: "#e0cd93", ice: "#cfe9f2",
    ink: "#f4f7f2", music: "jungle", scenery: "wave"
  },
  desert: {
    sky: "#c99a55", sky2: "#a97b3d", grass: ["#5aab3f", "#4b9433"],
    rail: "#c2934f", railTop: "#dbb271", railDark: "#7d5b2b", cap: "#e5c78c",
    water: ["#2f9fb5", "#1c7b92"], sand: "#e6cd8c", ice: "#cfe9f2",
    ink: "#3a2a12", music: "drone", scenery: "dune"
  },
  haunted: {
    sky: "#1a1424", sky2: "#0c0912", grass: ["#3b7148", "#31603c"],
    rail: "#463046", railTop: "#5f4362", railDark: "#221624", cap: "#6d4f70",
    water: ["#3b5f8a", "#25406a"], sand: "#b6a98c", ice: "#c9dbe8",
    ink: "#efe9f5", music: "spooky", scenery: "grave"
  },
  candy: {
    sky: "#f6a8c6", sky2: "#e4799f", grass: ["#5fd39a", "#4dbb87"],
    rail: "#ea5f7c", railTop: "#ff849b", railDark: "#a83a52", cap: "#fff0f4",
    water: ["#59c8e8", "#33a2c6"], sand: "#ffd9a3", ice: "#dff4ff",
    ink: "#4a1f2c", music: "bubble", scenery: "candy"
  },
  space: {
    sky: "#0a0d1c", sky2: "#05060e", grass: ["#3f8e86", "#357a73"],
    rail: "#7d8a9c", railTop: "#a2b0c2", railDark: "#3d4553", cap: "#c3ceda",
    water: ["#4a4bd0", "#2d2b96"], sand: "#c8b48f", ice: "#cfe6f4",
    ink: "#eaf1f8", music: "ambient", scenery: "star"
  }
};

/** Names golf gives a score, relative to par. */
function scoreName(strokes, par) {
  if (strokes === 1) return "Hole in One";
  var d = strokes - par;
  if (d <= -3) return "Albatross";
  if (d === -2) return "Eagle";
  if (d === -1) return "Birdie";
  if (d === 0) return "Par";
  if (d === 1) return "Bogey";
  if (d === 2) return "Double Bogey";
  if (d === 3) return "Triple Bogey";
  return "+" + d;
}

function relPar(n) { return n === 0 ? "E" : n > 0 ? "+" + n : String(n); }

/* ====================================================================== bit */

window.plethoraBit = {
  meta: {
    title: "Windmill Cove",
    runtime: "plethora-bit@2",
    tags: ["golf", "game", "sports", "arcade", "physics", "leaderboard"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    var canvas = ctx.createCanvas2D({ touchAction: "none" });
    var g = canvas.getContext("2d");
    var root = ctx.createRoot({ style: "pointer-events:none;" });

    /* ---------------------------------------------------------- baking */

    var CAN_BAKE = typeof OffscreenCanvas === "function";
    function makeSurface(w, h) {
      if (!CAN_BAKE) return null;
      try { return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0)); }
      catch (_) { return null; }
    }

    /** Path2D over every cell matching `test`, as merged horizontal runs. */
    function regionPath(hole, test) {
      var p = new Path2D(), gy, gx, run;
      for (gy = 0; gy < hole.gh; gy++) {
        run = -1;
        for (gx = 0; gx <= hole.gw; gx++) {
          var on = gx < hole.gw && test(hole.surf[gy * hole.gw + gx]);
          if (on && run < 0) run = gx;
          else if (!on && run >= 0) {
            p.rect(run * CELL - 0.004, gy * CELL - 0.004,
                   (gx - run) * CELL + 0.008, CELL + 0.008);
            run = -1;
          }
        }
      }
      return p;
    }

    /**
     * Merged boundary segments between cells matching `test` and cells that do
     * not — the same sweep the wall extractor uses. Stroke this, never the
     * region path, which is a stack of per-row rects with internal edges.
     */
    function regionEdges(hole, test) {
      var on = function (gx, gy) {
        if (gx < 0 || gy < 0 || gx >= hole.gw || gy >= hole.gh) return false;
        return test(hole.surf[gy * hole.gw + gx]);
      };
      var p = new Path2D(), gx, gy, run;
      for (gx = 0; gx <= hole.gw; gx++) {
        run = -1;
        for (gy = 0; gy <= hole.gh; gy++) {
          var v = gy < hole.gh && (on(gx - 1, gy) !== on(gx, gy));
          if (v && run < 0) run = gy;
          else if (!v && run >= 0) {
            p.moveTo(gx * CELL, run * CELL); p.lineTo(gx * CELL, gy * CELL); run = -1;
          }
        }
      }
      for (gy = 0; gy <= hole.gh; gy++) {
        run = -1;
        for (gx = 0; gx <= hole.gw; gx++) {
          var h = gx < hole.gw && (on(gx, gy - 1) !== on(gx, gy));
          if (h && run < 0) run = gx;
          else if (!h && run >= 0) {
            p.moveTo(run * CELL, gy * CELL); p.lineTo(gx * CELL, gy * CELL); run = -1;
          }
        }
      }
      return p;
    }

    /* --------------------------------------------------------- scenery */

    /** Everything outside the course. Hash-seeded so it never crawls. */
    function paintScenery(c, th, W, H, seed) {
      var sky = c.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, th.sky); sky.addColorStop(1, th.sky2);
      c.fillStyle = sky; c.fillRect(0, 0, W, H);
      var i, x, y, r, a;

      if (th.scenery === "pine") {
        for (i = 0; i < 150; i++) {
          x = hash01(seed + i, 1) * W; y = hash01(seed + i, 2) * H;
          r = 1.5 + hash01(seed + i, 3) * 2.2;
          c.fillStyle = "rgba(0,0,0,0.22)";
          c.beginPath();
          c.ellipse(x + r * 0.3, y + r * 0.75, r * 0.85, r * 0.34, 0, 0, TAU);
          c.fill();
          c.fillStyle = "#3b2417";
          c.fillRect(x - r * 0.1, y + r * 0.2, r * 0.2, r * 0.5);
          var tint = hash01(seed + i, 6);
          for (var k = 0; k < 3; k++) {
            c.fillStyle = tint > 0.62 ? ["#2f6b35", "#285c2d", "#224e26"][k]
              : ["#245529", "#1e4823", "#193c1e"][k];
            c.beginPath();
            c.moveTo(x, y - r * (1.45 - k * 0.34));
            c.quadraticCurveTo(x + r * (0.4 + k * 0.2), y + k * r * 0.4,
                               x + r * (0.52 + k * 0.24), y + k * r * 0.44);
            c.lineTo(x - r * (0.52 + k * 0.24), y + k * r * 0.44);
            c.quadraticCurveTo(x - r * (0.4 + k * 0.2), y + k * r * 0.4,
                               x, y - r * (1.45 - k * 0.34));
            c.closePath(); c.fill();
          }
        }
        for (i = 0; i < 90; i++) {
          c.fillStyle = "rgba(140,195,120,0.13)";
          c.beginPath();
          c.arc(hash01(seed + i, 7) * W, hash01(seed + i, 8) * H,
                0.2 + hash01(seed + i, 9) * 0.3, 0, TAU);
          c.fill();
        }
      } else if (th.scenery === "wave") {
        for (i = 0; i < 42; i++) {
          y = (i / 42) * H;
          c.strokeStyle = "rgba(255,255,255," + (0.05 + hash01(seed + i, 4) * 0.06) + ")";
          c.lineWidth = 0.45; c.beginPath();
          for (x = 0; x <= W; x += 2.5) {
            var yy = y + Math.sin((x * 0.22) + i * 1.7 + seed) * 0.9;
            if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
          }
          c.stroke();
        }
      } else if (th.scenery === "dune") {
        for (i = 0; i < 9; i++) {
          c.fillStyle = i % 2 ? "rgba(255,235,190,0.13)" : "rgba(120,80,30,0.10)";
          c.beginPath(); c.moveTo(0, H);
          for (x = 0; x <= W; x += 3) {
            c.lineTo(x, H * (0.1 + i * 0.1) + Math.sin(x * 0.09 + i * 2.2) * 3.2);
          }
          c.lineTo(W, H); c.closePath(); c.fill();
        }
      } else if (th.scenery === "grave") {
        for (i = 0; i < 26; i++) {
          x = hash01(seed + i, 1) * W; y = hash01(seed + i, 2) * H;
          r = 1.4 + hash01(seed + i, 3) * 1.1;
          c.fillStyle = "#2f2636";
          c.beginPath();
          c.moveTo(x - r, y + r * 1.5); c.lineTo(x - r, y);
          c.arc(x, y, r, Math.PI, 0); c.lineTo(x + r, y + r * 1.5);
          c.closePath(); c.fill();
        }
        for (i = 0; i < 22; i++) {
          c.fillStyle = "rgba(190,200,230,0.05)";
          c.beginPath();
          c.ellipse(hash01(seed + i, 5) * W, hash01(seed + i, 6) * H,
                    5 + hash01(seed + i, 7) * 9, 2 + hash01(seed + i, 8) * 3, 0, 0, TAU);
          c.fill();
        }
      } else if (th.scenery === "candy") {
        var cols = ["#ffd6e6", "#ffe9a8", "#c9f0e0", "#e2d4ff", "#ffc0cb"];
        for (i = 0; i < 90; i++) {
          x = hash01(seed + i, 1) * W; y = hash01(seed + i, 2) * H;
          r = 0.9 + hash01(seed + i, 3) * 2.1;
          c.fillStyle = cols[i % cols.length];
          c.globalAlpha = 0.5;
          c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
          c.globalAlpha = 1;
        }
      } else {
        for (i = 0; i < 260; i++) {
          x = hash01(seed + i, 1) * W; y = hash01(seed + i, 2) * H;
          a = 0.25 + hash01(seed + i, 3) * 0.75;
          c.fillStyle = "rgba(255,255,255," + a + ")";
          r = hash01(seed + i, 4) < 0.9 ? 0.28 : 0.55;
          c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        }
        for (i = 0; i < 3; i++) {
          var gx2 = hash01(seed + i, 9) * W, gy2 = hash01(seed + i, 10) * H;
          var neb = c.createRadialGradient(gx2, gy2, 0, gx2, gy2, 14 + i * 7);
          neb.addColorStop(0, i % 2 ? "rgba(90,60,160,0.22)" : "rgba(40,110,150,0.20)");
          neb.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = neb; c.beginPath(); c.arc(gx2, gy2, 14 + i * 7, 0, TAU); c.fill();
        }
      }
    }

    /* ------------------------------------------------------ course bake */

    var CHECK = 2;   // mown square size, in world units

    /**
     * Bakes everything that never moves: scenery, the mown checkerboard,
     * hazards, and the rails around every boundary. Drawn in world units —
     * the surface is pre-scaled — so a frame is one drawImage.
     */
    function bakeCourse(hole, th, bs) {
      var cv = makeSurface(Math.ceil(hole.w * bs), Math.ceil(hole.h * bs));
      if (!cv) return null;
      var c = cv.getContext("2d");
      if (!c) return null;
      c.scale(bs, bs);
      paintCourse(c, hole, th, true);
      return cv;
    }

    /** The same painter drives the bake and the no-OffscreenCanvas fallback. */
    function paintCourse(c, hole, th, withScenery) {
      var W = hole.w, H = hole.h;
      if (withScenery) paintScenery(c, th, W, H, (hole.name.charCodeAt(0) || 7) * 3.7);

      var inside = regionPath(hole, function (s) { return s !== VOID; });
      var waterP = regionPath(hole, function (s) { return s === WATER; });
      var sandP = regionPath(hole, function (s) { return s === SAND; });
      var iceP = regionPath(hole, function (s) { return s === ICE; });
      var waterE = regionEdges(hole, function (s) { return s === WATER; });
      var sandE = regionEdges(hole, function (s) { return s === SAND; });
      var iceE = regionEdges(hole, function (s) { return s === ICE; });

      // the course sits slightly proud of the scenery
      c.save();
      c.translate(0.55, 0.75);
      c.fillStyle = "rgba(0,0,0,0.34)";
      c.fill(inside);
      c.restore();

      // mown checkerboard
      c.save();
      c.clip(inside);
      c.fillStyle = th.grass[0];
      c.fillRect(0, 0, W, H);
      c.fillStyle = th.grass[1];
      for (var cy = 0; cy < H; cy += CHECK) {
        for (var cx = 0; cx < W; cx += CHECK) {
          if (((cx / CHECK) | 0) % 2 === ((cy / CHECK) | 0) % 2) c.fillRect(cx, cy, CHECK, CHECK);
        }
      }
      // a soft vignette so the middle of a big hole is not flat
      var vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2,
                                      W / 2, H / 2, Math.max(W, H) * 0.72);
      vg.addColorStop(0, "rgba(255,255,255,0.07)");
      vg.addColorStop(1, "rgba(0,0,0,0.20)");
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
      c.restore();

      // hazards
      c.save(); c.clip(sandP);
      c.fillStyle = th.sand; c.fillRect(0, 0, W, H);
      c.fillStyle = "rgba(120,90,40,0.20)";
      for (var i = 0; i < 900; i++) {
        c.fillRect(hash01(i, 21) * W, hash01(i, 22) * H, 0.16, 0.16);
      }
      c.strokeStyle = "rgba(120,92,44,0.40)"; c.lineWidth = 0.8; c.stroke(sandE);
      c.restore();

      c.save(); c.clip(iceP);
      c.fillStyle = th.ice; c.fillRect(0, 0, W, H);
      c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 0.13;
      for (i = 0; i < 34; i++) {
        var ix = hash01(i, 31) * W, iy = hash01(i, 32) * H;
        var ia = hash01(i, 33) * TAU, il = 1.4 + hash01(i, 34) * 3.4;
        c.beginPath(); c.moveTo(ix, iy);
        c.lineTo(ix + Math.cos(ia) * il, iy + Math.sin(ia) * il); c.stroke();
      }
      c.restore();
      c.save(); c.clip(iceP);
      c.strokeStyle = "rgba(140,190,215,0.55)"; c.lineWidth = 0.5; c.stroke(iceE);
      c.restore();

      c.save(); c.clip(waterP);
      var wg = c.createLinearGradient(0, 0, 0, H);
      wg.addColorStop(0, th.water[0]); wg.addColorStop(1, th.water[1]);
      c.fillStyle = wg; c.fillRect(0, 0, W, H);
      c.fillStyle = "rgba(0,0,0,0.18)";
      c.fillRect(0, 0, W, H);
      // a shoreline: shallows just inside the bank, damp grass just outside
      c.strokeStyle = "rgba(0,0,0,0.22)"; c.lineWidth = 1.1; c.stroke(waterE);
      c.strokeStyle = "rgba(190,235,255,0.30)"; c.lineWidth = 0.34; c.stroke(waterE);
      c.restore();
      c.save(); c.clip(inside);
      c.strokeStyle = "rgba(64,92,44,0.30)"; c.lineWidth = 0.7; c.stroke(waterE);
      c.restore();

      // The tee box and cup apron are square cells; draw them round so a
      // green patch on ice or sand does not read as a glitch.
      c.save();
      c.clip(inside);
      for (var ap = 0; ap < 2; ap++) {
        var apx = ap ? hole.cup[0] : hole.tee[0], apy = ap ? hole.cup[1] : hole.tee[1];
        var ag = c.createRadialGradient(apx, apy, 1.5, apx, apy, 2.45);
        ag.addColorStop(0, th.grass[0]);
        ag.addColorStop(0.72, th.grass[0]);
        ag.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = ag;
        c.beginPath(); c.arc(apx, apy, 2.45, 0, TAU); c.fill();
        c.fillStyle = th.grass[1];
        c.beginPath(); c.arc(apx, apy, 1.5, 0, TAU); c.fill();
      }
      // a mown ring around the tee so you can see where you are playing from
      c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = 0.16;
      c.beginPath(); c.arc(hole.tee[0], hole.tee[1], 1.15, 0, TAU); c.stroke();
      c.restore();

      // painted zones: ramps, speed pads, blowers
      function arrows(rects, col, alpha) {
        for (var n = 0; n < rects.length; n++) {
          var r = rects[n], dx = r[4], dy = r[5];
          c.save();
          var zp = new Path2D(); zp.rect(r[0], r[1], r[2], r[3]);
          c.clip(zp);
          c.fillStyle = col; c.globalAlpha = alpha; c.fillRect(r[0], r[1], r[2], r[3]);
          c.globalAlpha = Math.min(1, alpha + 0.34);
          c.strokeStyle = col; c.lineWidth = 0.34; c.lineCap = "round";
          var step = 2.6;
          for (var ay = r[1] + 1; ay < r[1] + r[3]; ay += step) {
            for (var ax = r[0] + 1; ax < r[0] + r[2]; ax += step) {
              var px = -dy, py = dx;                       // chevron across travel
              c.beginPath();
              c.moveTo(ax - px * 0.6 - dx * 0.5, ay - py * 0.6 - dy * 0.5);
              c.lineTo(ax + dx * 0.7, ay + dy * 0.7);
              c.lineTo(ax + px * 0.6 - dx * 0.5, ay + py * 0.6 - dy * 0.5);
              c.stroke();
            }
          }
          c.restore();
        }
      }
      c.globalAlpha = 1;
      arrows(hole.slopes, "#ffffff", 0.09);
      arrows(hole.fans, "#bfe8ff", 0.11);
      arrows(hole.boosts, "#ffd23f", 0.20);
      c.globalAlpha = 1;

      // rails: shadow, body, lit top edge, then a log cap at every corner
      var wl = hole.walls, s;
      c.lineCap = "round";
      c.strokeStyle = th.railDark; c.lineWidth = 1.24;
      c.beginPath();
      for (i = 0; i < wl.length; i++) { s = wl[i]; c.moveTo(s.ax, s.ay); c.lineTo(s.bx, s.by); }
      c.stroke();
      c.strokeStyle = th.rail; c.lineWidth = 0.94;
      c.beginPath();
      for (i = 0; i < wl.length; i++) { s = wl[i]; c.moveTo(s.ax, s.ay); c.lineTo(s.bx, s.by); }
      c.stroke();
      c.strokeStyle = th.railTop; c.lineWidth = 0.3;
      c.beginPath();
      for (i = 0; i < wl.length; i++) {
        s = wl[i]; c.moveTo(s.ax - 0.16, s.ay - 0.2); c.lineTo(s.bx - 0.16, s.by - 0.2);
      }
      c.stroke();
      for (i = 0; i < wl.length; i++) {
        s = wl[i];
        for (var end = 0; end < 2; end++) {
          var ex = end ? s.bx : s.ax, ey = end ? s.by : s.ay;
          c.fillStyle = th.railDark;
          c.beginPath(); c.arc(ex, ey, 0.66, 0, TAU); c.fill();
          c.fillStyle = th.cap;
          c.beginPath(); c.arc(ex, ey, 0.54, 0, TAU); c.fill();
          c.strokeStyle = "rgba(0,0,0,0.22)"; c.lineWidth = 0.09;
          c.beginPath(); c.arc(ex, ey, 0.31, 0, TAU); c.stroke();
          c.beginPath(); c.arc(ex, ey, 0.16, 0, TAU); c.stroke();
        }
      }
    }

    /* --------------------------------------------------- live-drawn parts */

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    /** A cylindrical prop: dark base, lit body, rim light. Posts and hubs. */
    function drawPuck(c, x, y, r, base, top, rim) {
      c.fillStyle = "rgba(0,0,0,0.32)";
      c.beginPath(); c.arc(x + r * 0.16, y + r * 0.22, r, 0, TAU); c.fill();
      var gr = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      gr.addColorStop(0, top); gr.addColorStop(1, base);
      c.fillStyle = gr;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      if (rim) {
        c.strokeStyle = rim; c.lineWidth = r * 0.16;
        c.beginPath(); c.arc(x, y, r * 0.9, 0, TAU); c.stroke();
      }
    }

    function drawPosts(c, hole, th, t) {
      for (var i = 0; i < hole.posts.length; i++) {
        var p = hole.posts[i];
        if (p[3] === 1) {
          var sq = 1 + Math.sin(t * 3 + i) * 0.03;
          drawPuck(c, p[0], p[1], p[2] * sq, "#d2325c", "#ff7fa2", "rgba(255,255,255,0.55)");
          c.fillStyle = "rgba(255,255,255,0.5)";
          c.beginPath();
          c.ellipse(p[0] - p[2] * 0.3, p[1] - p[2] * 0.35, p[2] * 0.26, p[2] * 0.17, -0.6, 0, TAU);
          c.fill();
        } else {
          drawPuck(c, p[0], p[1], p[2], th.railDark, th.cap, null);
          c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 0.1;
          c.beginPath(); c.arc(p[0], p[1], p[2] * 0.55, 0, TAU); c.stroke();
          c.beginPath(); c.arc(p[0], p[1], p[2] * 0.28, 0, TAU); c.stroke();
        }
      }
    }

    function drawMovers(c, hole, th, t) {
      for (var i = 0; i < hole.movers.length; i++) {
        var m = moverAt(hole.movers[i], t);
        c.fillStyle = "rgba(0,0,0,0.34)";
        c.fillRect(m.x + 0.25, m.y + 0.35, m.w, m.h);
        c.fillStyle = th.rail;
        c.fillRect(m.x, m.y, m.w, m.h);
        c.fillStyle = th.railTop;
        c.fillRect(m.x, m.y, m.w, m.h * 0.34);
        c.strokeStyle = th.railDark; c.lineWidth = 0.14;
        c.strokeRect(m.x, m.y, m.w, m.h);
        // grab-handle notches so the direction of travel reads
        c.fillStyle = "rgba(0,0,0,0.2)";
        for (var k = 1; k < 4; k++) {
          c.fillRect(m.x + m.w * (k / 4) - 0.07, m.y + m.h * 0.2, 0.14, m.h * 0.6);
        }
      }
    }

    function drawSpinners(c, hole, th, t) {
      for (var i = 0; i < hole.spinners.length; i++) {
        var s = hole.spinners[i];
        var base = spinnerAngle(s, t), nb = s[6];
        c.save();
        c.translate(s[0], s[1]);
        for (var b = 0; b < nb; b++) {
          var a = base + b * TAU / nb;
          c.save(); c.rotate(a);
          c.fillStyle = "rgba(0,0,0,0.3)";
          c.fillRect(0, -s[3] + 0.3, s[2] + 0.35, s[3] * 2);
          c.fillStyle = "#f3ece0";
          c.fillRect(0, -s[3], s[2], s[3] * 2);
          c.fillStyle = th.rail;
          c.fillRect(0, -s[3], s[2], s[3] * 0.7);
          c.strokeStyle = th.railDark; c.lineWidth = 0.1;
          c.strokeRect(0, -s[3], s[2], s[3] * 2);
          c.restore();
        }
        c.restore();
        drawPuck(c, s[0], s[1], Math.max(0.7, s[3] * 2.2), th.railDark, th.cap, null);
      }
    }

    function drawWells(c, hole, t) {
      for (var i = 0; i < hole.wells.length; i++) {
        var w = hole.wells[i], kill = w[4];
        var gr = c.createRadialGradient(w[0], w[1], 0, w[0], w[1], w[2]);
        gr.addColorStop(0, kill ? "rgba(8,4,20,0.96)" : "rgba(30,60,130,0.55)");
        gr.addColorStop(0.55, kill ? "rgba(60,25,110,0.45)" : "rgba(40,90,160,0.22)");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = gr;
        c.beginPath(); c.arc(w[0], w[1], w[2], 0, TAU); c.fill();
        c.strokeStyle = kill ? "rgba(190,150,255,0.5)" : "rgba(220,240,255,0.42)";
        for (var k = 0; k < 3; k++) {                      // drawn-in swirl arms
          c.lineWidth = 0.16 - k * 0.03;
          c.beginPath();
          for (var u = 0; u <= 1.001; u += 0.06) {
            var rr = w[2] * (1 - u * 0.92);
            var aa = t * (kill ? 3.1 : 1.9) + k * TAU / 3 + u * 5.2;
            var px = w[0] + Math.cos(aa) * rr, py = w[1] + Math.sin(aa) * rr;
            if (u === 0) c.moveTo(px, py); else c.lineTo(px, py);
          }
          c.stroke();
        }
        if (kill) {
          c.fillStyle = "#05030c";
          c.beginPath(); c.arc(w[0], w[1], 0.9, 0, TAU); c.fill();
        }
      }
    }

    function drawPortals(c, hole, t) {
      for (var i = 0; i < hole.portals.length; i++) {
        var p = hole.portals[i];
        for (var e = 0; e < 2; e++) {
          var x = e ? p[2] : p[0], y = e ? p[3] : p[1], r = p[4];
          var hue = e ? "#ffb347" : "#8ad8ff";
          var gr = c.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, "rgba(255,255,255,0.85)");
          gr.addColorStop(0.5, e ? "rgba(255,150,40,0.5)" : "rgba(60,180,255,0.5)");
          gr.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = gr;
          c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
          c.strokeStyle = hue;
          for (var k = 0; k < 2; k++) {
            var rr = r * (0.55 + k * 0.3) + Math.sin(t * 3 + k * 2 + e) * 0.06;
            c.lineWidth = 0.14;
            c.beginPath();
            c.arc(x, y, rr, t * (k ? -2.2 : 2.6) + e, t * (k ? -2.2 : 2.6) + e + 4.4);
            c.stroke();
          }
        }
      }
    }

    /** The cup, its apron and a flagstick that leans with the breeze. */
    function drawCup(c, hole, th, t, holed) {
      var x = hole.cup[0], y = hole.cup[1];
      c.fillStyle = "rgba(255,255,255,0.16)";
      c.beginPath(); c.arc(x, y, CUP_R + 0.34, 0, TAU); c.fill();
      c.fillStyle = "#efe6cf";
      c.beginPath(); c.arc(x, y, CUP_R + 0.12, 0, TAU); c.fill();
      var gr = c.createRadialGradient(x, y - CUP_R * 0.3, 0.05, x, y, CUP_R);
      gr.addColorStop(0, "#000000"); gr.addColorStop(1, "#241d12");
      c.fillStyle = gr;
      c.beginPath(); c.arc(x, y, CUP_R, 0, TAU); c.fill();

      if (holed) return;
      var sway = Math.sin(t * 1.5) * 0.16;
      var tipx = x + 2.1 + sway, tipy = y - 4.6;
      c.strokeStyle = "rgba(0,0,0,0.28)"; c.lineWidth = 0.42; c.lineCap = "round";
      c.beginPath(); c.moveTo(x + 0.25, y + 0.2); c.lineTo(tipx + 0.25, tipy + 0.2); c.stroke();
      c.lineWidth = 0.3;
      c.strokeStyle = "#ffffff";
      c.beginPath(); c.moveTo(x, y); c.lineTo(tipx, tipy); c.stroke();
      c.strokeStyle = "#e0413f";                            // barber stripes
      c.lineWidth = 0.3;
      for (var k = 0; k < 5; k++) {
        var t0 = k / 5 + 0.02, t1 = t0 + 0.09;
        c.beginPath();
        c.moveTo(lerp(x, tipx, t0), lerp(y, tipy, t0));
        c.lineTo(lerp(x, tipx, t1), lerp(y, tipy, t1));
        c.stroke();
      }
      var flap = Math.sin(t * 4.2) * 0.28;
      c.fillStyle = "#e0413f";
      c.beginPath();
      c.moveTo(tipx, tipy);
      c.quadraticCurveTo(tipx + 1.5, tipy + 0.3 + flap, tipx + 2.9, tipy + 0.75);
      c.quadraticCurveTo(tipx + 1.5, tipy + 1.2 - flap, tipx, tipy + 1.7);
      c.closePath(); c.fill();
      c.fillStyle = "rgba(0,0,0,0.16)";
      c.beginPath();
      c.moveTo(tipx, tipy + 1.7);
      c.quadraticCurveTo(tipx + 1.5, tipy + 1.2 - flap, tipx + 2.9, tipy + 0.75);
      c.lineTo(tipx + 2.9, tipy + 0.95); c.closePath(); c.fill();
    }

    /** Ripples over the baked water, clipped to the water cells. */
    function drawWater(c, waterPath, th, W, H, t) {
      c.save();
      c.clip(waterPath);
      c.strokeStyle = "rgba(255,255,255,0.22)";
      c.lineWidth = 0.16;
      for (var i = 0; i < 26; i++) {
        var y = ((i * 2.3 + t * 1.6) % (H + 6)) - 3;
        c.beginPath();
        for (var x = 0; x <= W; x += 2) {
          var yy = y + Math.sin(x * 0.5 + t * 1.7 + i) * 0.28;
          if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
        }
        c.stroke();
      }
      c.fillStyle = "rgba(255,255,255,0.13)";
      for (i = 0; i < 20; i++) {
        var sx = hash01(i, 41) * W, sy = hash01(i, 42) * H;
        var pu = 0.5 + 0.5 * Math.sin(t * 2.1 + i * 1.3);
        c.beginPath();
        c.ellipse(sx, sy, 0.7 + pu * 0.5, 0.22 + pu * 0.14, 0, 0, TAU);
        c.fill();
      }
      c.restore();
    }

    function drawBall(c, b, trail, t) {
      var i;
      for (i = 0; i < trail.length; i++) {
        var tp = trail[i], a = (i / trail.length) * 0.3;
        c.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
        c.beginPath(); c.arc(tp.x, tp.y, BALL_R * (0.35 + 0.5 * i / trail.length), 0, TAU); c.fill();
      }
      c.fillStyle = "rgba(0,0,0,0.34)";
      c.beginPath(); c.ellipse(b.x + 0.14, b.y + 0.2, BALL_R * 1.02, BALL_R * 0.9, 0, 0, TAU); c.fill();
      var gr = c.createRadialGradient(b.x - BALL_R * 0.4, b.y - BALL_R * 0.45, BALL_R * 0.08,
                                      b.x, b.y, BALL_R * 1.05);
      gr.addColorStop(0, "#ffffff");
      gr.addColorStop(0.62, "#f2f1ea");
      gr.addColorStop(1, "#b9b8ad");
      c.fillStyle = gr;
      c.beginPath(); c.arc(b.x, b.y, BALL_R, 0, TAU); c.fill();
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.beginPath();
      c.ellipse(b.x - BALL_R * 0.34, b.y - BALL_R * 0.38, BALL_R * 0.24, BALL_R * 0.16, -0.7, 0, TAU);
      c.fill();
    }

    /**
     * The aim guide: two reflections off the static rails, no further. Enough
     * to line up a bank shot, not enough to solve the hole for you.
     */
    function drawAim(c, hole, b, dirx, diry, power, t) {
      var reach = 3.2 + power * 0.62;
      var px = b.x, py = b.y, dx = dirx, dy = diry;
      var left = reach, bounces = 0, drawn = 0;
      c.lineCap = "round";
      while (left > 0.1 && bounces <= 2 && drawn < 220) {
        var stepLen = Math.min(0.42, left);
        var nx = px + dx * stepLen, ny = py + dy * stepLen;
        var near = wallsNear(hole, nx, ny), hit = null, hitP = null;
        if (near) {
          for (var i = 0; i < near.length; i++) {
            var s = near[i];
            closestOnSeg(nx, ny, s.ax, s.ay, s.bx, s.by, _p);
            var d = len2(nx - _p.x, ny - _p.y);
            if (d < BALL_R) { hit = s; hitP = { x: _p.x, y: _p.y }; break; }
          }
        }
        if (hit) {
          var hx = nx - hitP.x, hy = ny - hitP.y, hd = len2(hx, hy) || 1;
          var Nx = hx / hd, Ny = hy / hd;
          var vd = dx * Nx + dy * Ny;
          dx -= 2 * vd * Nx; dy -= 2 * vd * Ny;
          bounces++;
          continue;
        }
        px = nx; py = ny; left -= stepLen; drawn++;
        if (drawn % 2 === 0) {
          var fade = clamp(left / reach, 0, 1) * 0.75 + 0.12;
          c.fillStyle = "rgba(255,255,255," + (fade * (bounces ? 0.45 : 1)).toFixed(3) + ")";
          c.beginPath(); c.arc(px, py, 0.115, 0, TAU); c.fill();
        }
      }
      // power ring around the ball
      var frac = power / MAX_SHOT;
      c.lineWidth = 0.2;
      c.strokeStyle = "rgba(0,0,0,0.3)";
      c.beginPath(); c.arc(b.x, b.y, BALL_R + 0.55, 0, TAU); c.stroke();
      c.strokeStyle = frac > 0.85 ? "#ff5a4d" : frac > 0.6 ? "#ffc23f" : "#8ef07a";
      c.beginPath();
      c.arc(b.x, b.y, BALL_R + 0.55, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      c.stroke();
    }

    /* --------------------------------------------------------- particles */

    var parts = [];
    function spawn(x, y, n, col, spd, life, size) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, s = spd * (0.35 + Math.random() * 0.9);
        parts.push({
          x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          l: life * (0.6 + Math.random() * 0.7), m: life, c: col, r: size
        });
      }
      if (parts.length > 260) parts.splice(0, parts.length - 260);
    }
    function stepParts(dt) {
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.l -= dt;
        if (p.l <= 0) { parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.93; p.vy *= 0.93;
      }
    }
    function drawParts(c) {
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i], a = clamp(p.l / p.m, 0, 1);
        c.globalAlpha = a;
        c.fillStyle = p.c;
        c.beginPath(); c.arc(p.x, p.y, p.r * (0.4 + a * 0.8), 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
    }

    /* ------------------------------------------------------------- audio */

    var ac = null, master = null, noiseBuf = null, audioDead = false;

    function buildAudio() {
      if (ac || audioDead) return ac;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }
      master = ac.createGain();
      master.gain.value = 0.8;
      var comp = ac.createDynamicsCompressor();
      comp.threshold.value = -15; comp.ratio.value = 3.2;
      comp.attack.value = 0.003; comp.release.value = 0.22;
      master.connect(comp); comp.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      var nd = noiseBuf.getChannelData(0);
      for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      ctx.onDestroy(function () { try { ac.close(); } catch (_) {} });
      return ac;
    }
    function resumeAudio() {
      var a = buildAudio();
      if (a && a.state === "suspended") { try { a.resume(); } catch (_) {} }
    }

    function tone(freq, dur, type, gain, sweepTo) {
      var a = buildAudio(); if (!a) return;
      var o = a.createOscillator(), gn = a.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, a.currentTime + dur);
      gn.gain.setValueAtTime(0.0001, a.currentTime);
      gn.gain.exponentialRampToValueAtTime(gain, a.currentTime + 0.006);
      gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(gn); gn.connect(master);
      o.start(); o.stop(a.currentTime + dur + 0.02);
    }
    function noise(dur, gain, freq, q, type) {
      var a = buildAudio(); if (!a) return;
      var src = a.createBufferSource(); src.buffer = noiseBuf;
      var f = a.createBiquadFilter();
      f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q || 1;
      var gn = a.createGain();
      gn.gain.setValueAtTime(gain, a.currentTime);
      gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      src.connect(f); f.connect(gn); gn.connect(master);
      src.start(); src.stop(a.currentTime + dur + 0.02);
    }

    /** The club strike — pitch and body both track how hard you hit it. */
    function sfxPutt(power) {
      var p = clamp(power / MAX_SHOT, 0, 1);
      tone(150 + p * 130, 0.09, "triangle", 0.16 + p * 0.16, 70 + p * 40);
      noise(0.05 + p * 0.03, 0.1 + p * 0.14, 900 + p * 1500, 1.1);
    }
    function sfxRail(impact) {
      var p = clamp(impact / 22, 0, 1);
      if (p < 0.045) return;
      tone(190 + Math.random() * 60, 0.07, "square", 0.03 + p * 0.09, 110);
      noise(0.045, 0.05 + p * 0.11, 1400 + Math.random() * 700, 1.6);
    }
    function sfxBumper() {
      tone(520, 0.13, "sine", 0.13, 900);
      noise(0.05, 0.06, 2400, 2);
    }
    function sfxSplash() {
      noise(0.42, 0.24, 700, 0.7, "lowpass");
      tone(420, 0.3, "sine", 0.08, 130);
    }
    function sfxSand() { noise(0.16, 0.09, 2600, 0.8); }
    function sfxPortal() {
      tone(320, 0.22, "sine", 0.1, 1500);
      tone(640, 0.2, "triangle", 0.06, 2400);
    }
    function sfxBoost() { tone(240, 0.16, "sawtooth", 0.09, 900); }
    function sfxLip() {
      noise(0.1, 0.1, 1800, 3);
      tone(700, 0.1, "sine", 0.06, 520);
    }
    function sfxDrop() {
      noise(0.09, 0.13, 1100, 2.4);
      tone(300, 0.16, "sine", 0.16, 120);
      var a = buildAudio(); if (!a) return;
      ctx.timeout(function () { tone(880, 0.1, "sine", 0.1); }, 70);
      ctx.timeout(function () { tone(1320, 0.16, "sine", 0.09); }, 150);
    }
    function sfxAce() {
      var notes = [523, 659, 784, 1046, 1318];
      notes.forEach(function (n, i) {
        ctx.timeout(function () { tone(n, 0.3, "triangle", 0.13); }, i * 85);
      });
    }

    var music = null, musicOn = true;
    async function startMusic(theme) {
      if (!musicOn || !ctx.capabilities.backgroundMusic) return;
      var preset = (THEMES[theme] || THEMES.forest).music;
      try {
        await ctx.music.unlock();
        if (music) { await ctx.music.setPreset(preset, { fadeMs: 900 }); return; }
        music = await ctx.music.play({ preset: preset, volume: 0.4, fadeInMs: 1400, intensity: 0.45 });
      } catch (_) { music = null; }
    }
    function stopMusic() {
      try { ctx.music.stop({ fadeOutMs: 800 }); } catch (_) {}
      music = null;
    }
    function haptic(kind) {
      if (!ctx.capabilities.haptics) return;
      try { ctx.platform.haptic(kind); } catch (_) {}
    }

    /* -------------------------------------------------------- game state */

    var S = {
      screen: "menu", courseIx: 0, holeIx: 0, strokes: 0, penalties: 0,
      card: [], hole: null, th: null, bake: null, bakeScale: 0, waterPath: null,
      ball: { x: 0, y: 0, vx: 0, vy: 0, portalCd: 0 },
      safe: { x: 0, y: 0 }, trail: [], moving: false, holed: false,
      aiming: false, ax: 0, ay: 0, bx: 0, by: 0, t: 0, intro: 0, banner: 0,
      sinking: 0, cupPulse: 0
    };
    var view = { s: 1, ox: 0, oy: 0 };
    var lastW = 0, lastH = 0;
    var PULL_MAX = 140;
    var ev = {};

    var best = {}, roundSave = null;
    try {
      if (ctx.capabilities.storage) {
        best = (await ctx.storage.get("best")) || {};
        roundSave = await ctx.storage.get("round");
        var mp = await ctx.storage.get("music");
        if (mp === false) musicOn = false;
      }
    } catch (_) { best = {}; }

    function saveBest() {
      if (!ctx.capabilities.storage) return;
      try { ctx.storage.set("best", best); } catch (_) {}
    }
    function saveRound() {
      if (!ctx.capabilities.storage) return;
      try {
        ctx.storage.set("round", S.screen === "play" || S.screen === "holeEnd"
          ? { c: S.courseIx, h: S.holeIx, card: S.card } : null);
      } catch (_) {}
    }

    function course() { return COURSES[S.courseIx]; }
    function strokeCap(par) { return par + 5; }

    /* ------------------------------------------------------------ layout */

    function layout() {
      if (!S.hole) return;
      var top = 78 + ctx.safeArea.top;
      var bot = 16 + ctx.safeArea.bottom;
      var pw = Math.max(40, ctx.width - 16);
      var ph = Math.max(40, ctx.height - top - bot);
      var s = Math.min(pw / S.hole.w, ph / S.hole.h);
      view.s = s;
      view.ox = 8 + (pw - S.hole.w * s) / 2;
      view.oy = top + (ph - S.hole.h * s) / 2;
    }

    function rebake() {
      if (!S.hole) return;
      var bd = Math.min(2, ctx.dpr || 1);
      var bs = view.s * bd;
      if (S.bake && Math.abs(bs - S.bakeScale) < 0.6) return;
      S.bakeScale = bs;
      S.bake = bakeCourse(S.hole, S.th, bs);
    }

    function toWorldX(px) { return (px - view.ox) / view.s; }
    function toWorldY(py) { return (py - view.oy) / view.s; }

    /* ------------------------------------------------------- round flow */

    function loadHole(ix) {
      var co = course();
      S.holeIx = ix;
      S.hole = compileHole(co.holes[ix]);
      S.th = THEMES[co.theme] || THEMES.forest;
      S.strokes = 0; S.holed = false; S.moving = false; S.sinking = 0;
      S.capped = false; S.rollT = 0;
      S.trail.length = 0; parts.length = 0;
      S.ball.x = S.hole.tee[0]; S.ball.y = S.hole.tee[1];
      S.ball.vx = 0; S.ball.vy = 0; S.ball.portalCd = 0;
      S.safe.x = S.ball.x; S.safe.y = S.ball.y;
      S.waterPath = regionPath(S.hole, function (t) { return t === WATER; });
      S.bake = null; S.bakeScale = 0;
      layout(); rebake();
      S.intro = 0.9; S.banner = 1.5; S.cupPulse = 1;
      syncHud();
    }

    function startRound(ix, resumeCard, resumeHole) {
      S.courseIx = ix;
      S.card = resumeCard ? resumeCard.slice() : [];
      S.screen = "play";
      loadHole(resumeHole || 0);
      startMusic(course().theme);
      saveRound();
      showScreen();
    }

    function shoot(dirx, diry, power) {
      S.strokes++;
      S.safe.x = S.ball.x; S.safe.y = S.ball.y;
      S.ball.vx = dirx * power; S.ball.vy = diry * power;
      S.moving = true; S.rollT = 0;
      sfxPutt(power);
      haptic(power > MAX_SHOT * 0.66 ? "medium" : "light");
      spawn(S.ball.x - dirx * 0.5, S.ball.y - diry * 0.5, 5, "#ffffff", 3, 0.28, 0.1);
      ctx.platform.interact({ type: "putt", power: Math.round(power) });
      syncHud();
    }

    function penalty(kind) {
      S.strokes++;
      S.penalties++;
      S.ball.x = S.safe.x; S.ball.y = S.safe.y;
      S.ball.vx = 0; S.ball.vy = 0; S.ball.portalCd = 0;
      S.moving = false; S.rollT = 0; S.trail.length = 0;
      haptic("warning");
      flash(kind === "water" ? "Water — +1 stroke" : kind === "sunk"
        ? "Swallowed — +1 stroke" : "Out of bounds — +1 stroke");
      afterSettle();
    }

    /** Runs wherever a stroke ends — holed out, come to rest, or penalised. */
    function afterSettle() {
      syncHud();
      if (S.holed || S.capped) return;
      if (S.strokes >= strokeCap(S.hole.par)) {
        S.capped = true;
        flash("Stroke limit — picked up");
        ctx.timeout(function () {
          if (!S.holed) finishHole(strokeCap(S.hole.par));
        }, 700);
      }
    }

    function finishHole(strokes) {
      S.holed = true; S.moving = false;
      S.card[S.holeIx] = strokes;
      var par = S.hole.par;
      var co = course();
      var hk = co.id + ":" + S.holeIx;
      if (best[hk] == null || strokes < best[hk]) best[hk] = strokes;
      saveBest(); saveRound();
      spawn(S.hole.cup[0], S.hole.cup[1], 26, "#ffe27a", 6, 0.7, 0.16);
      if (strokes === 1) { sfxAce(); haptic("success"); }
      else { sfxDrop(); haptic(strokes <= par ? "success" : "light"); }
      try { ctx.music.sting(strokes <= par ? "success" : "tap"); } catch (_) {}
      ctx.platform.milestone("hole_out", { hole: S.holeIx + 1, strokes: strokes, par: par });
      ctx.timeout(function () {
        S.screen = "holeEnd";
        showScreen();
      }, 900);
    }

    function nextHole() {
      if (S.card[S.holeIx] == null) {
        S.card[S.holeIx] = Math.max(1, Math.min(S.strokes, strokeCap(S.hole.par)));
      }
      if (S.holeIx + 1 < course().holes.length) {
        S.screen = "play";
        loadHole(S.holeIx + 1);
        saveRound();
        showScreen();
      } else {
        endRound();
      }
    }

    function coursePar(co) {
      var n = 0;
      for (var i = 0; i < co.holes.length; i++) n += co.holes[i].par;
      return n;
    }
    function cardTotal() {
      var n = 0;
      for (var i = 0; i < S.card.length; i++) n += S.card[i] || 0;
      return n;
    }

    async function endRound() {
      var co = course();
      var total = cardTotal();
      var par = coursePar(co);
      var key = co.id + ":round";
      var isBest = best[key] == null || total < best[key];
      if (isBest) { best[key] = total; saveBest(); }
      S.screen = "roundEnd";
      saveRound();
      showScreen();
      ctx.platform.setScore(total, { par: par, course: co.id });
      ctx.platform.complete({ course: co.id, strokes: total, par: par });
      try { ctx.music.sting(total <= par ? "win" : "success"); } catch (_) {}
      haptic("success");
      try {
        await ctx.memory.record(co.id + "_round").submit(total, { label: total + " strokes" });
      } catch (_) {}
      loadBoard(co.id);
    }

    /* ------------------------------------------------------------- the UI */

    var PANEL = "background:linear-gradient(180deg,rgba(20,24,20,0.94),rgba(12,14,12,0.97));" +
      "border:1px solid rgba(255,255,255,0.14);border-radius:20px;padding:18px;" +
      "box-shadow:0 18px 44px rgba(0,0,0,0.5);color:#f4f7ef;";
    var FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
    var BTN = "pointer-events:auto;border:0;cursor:pointer;border-radius:13px;padding:12px 16px;" +
      FONT + "font-size:15px;font-weight:800;background:#5bbf4a;color:#08210a;";
    var BTN2 = "pointer-events:auto;border:1px solid rgba(255,255,255,0.2);cursor:pointer;" +
      "border-radius:13px;padding:11px 15px;" + FONT +
      "font-size:14px;font-weight:700;background:rgba(255,255,255,0.08);color:#eef3e9;";

    function divEl(style, html) {
      var d = document.createElement("div");
      d.style.cssText = FONT + (style || "");
      if (html != null) d.innerHTML = html;
      return d;
    }
    function btnEl(style, html) {
      var b = document.createElement("button");
      b.style.cssText = style || BTN;
      if (html != null) b.innerHTML = html;
      return b;
    }
    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    // ---- heads-up display -------------------------------------------------
    var hud = divEl("position:absolute;left:0;right:0;top:0;pointer-events:none;" +
      "padding:" + (6 + ctx.safeArea.top) + "px 10px 0;");
    root.appendChild(hud);

    var hudTop = divEl("display:flex;align-items:center;gap:8px;");
    hud.appendChild(hudTop);
    var btnBack = btnEl(BTN2 + "padding:7px 11px;font-size:13px;border-radius:11px;", "☰");
    var hudTitle = divEl("flex:1;min-width:0;font-size:14.5px;font-weight:800;" +
      "text-shadow:0 2px 6px rgba(0,0,0,0.7);color:#fff;overflow:hidden;" +
      "white-space:nowrap;text-overflow:ellipsis;");
    var btnHelp = btnEl(BTN2 + "padding:7px 11px;font-size:13px;border-radius:11px;", "?");
    var btnBoard = btnEl(BTN2 + "padding:7px 11px;font-size:13px;border-radius:11px;", "🏆");
    hudTop.appendChild(btnBack); hudTop.appendChild(hudTitle);
    hudTop.appendChild(btnHelp); hudTop.appendChild(btnBoard);

    var hudRow = divEl("display:flex;align-items:center;gap:8px;margin-top:7px;");
    hud.appendChild(hudRow);
    var hudPar = divEl("font-size:12.5px;font-weight:800;letter-spacing:0.4px;" +
      "background:rgba(0,0,0,0.42);border-radius:9px;padding:4px 9px;" +
      "text-shadow:0 1px 3px rgba(0,0,0,0.8);");
    var hudPips = divEl("flex:1;display:flex;gap:3px;justify-content:center;");
    var hudStrokes = divEl("font-size:12.5px;font-weight:800;letter-spacing:0.4px;" +
      "background:rgba(0,0,0,0.42);border-radius:9px;padding:4px 9px;" +
      "text-shadow:0 1px 3px rgba(0,0,0,0.8);");
    hudRow.appendChild(hudPar); hudRow.appendChild(hudPips); hudRow.appendChild(hudStrokes);

    function syncHud() {
      if (!S.hole) return;
      var co = course();
      hudTitle.textContent = co.icon + "  " + co.name + " · " + (S.holeIx + 1) + "/" + co.holes.length;
      hudPar.textContent = "PAR " + S.hole.par;
      var over = S.strokes - S.hole.par;
      hudStrokes.textContent = "SHOTS " + S.strokes + (S.strokes > S.hole.par ? " (" + relPar(over) + ")" : "");
      var pips = "";
      for (var i = 0; i < co.holes.length; i++) {
        var v = S.card[i];
        var bg = i === S.holeIx ? "#ffd23f" : v == null ? "rgba(255,255,255,0.22)"
          : v < co.holes[i].par ? "#5bbf4a" : v === co.holes[i].par ? "#cfd8c8" : "#d8734a";
        pips += '<div style="width:12px;height:5px;border-radius:3px;background:' + bg + ';"></div>';
      }
      hudPips.innerHTML = pips;
    }

    // ---- transient message ------------------------------------------------
    var toast = divEl("position:absolute;left:0;right:0;top:46%;text-align:center;" +
      "pointer-events:none;opacity:0;transition:opacity 0.25s;");
    root.appendChild(toast);
    var toastT = 0;
    function flash(msg) {
      toast.innerHTML = '<span style="display:inline-block;background:rgba(10,12,10,0.85);' +
        "border:1px solid rgba(255,255,255,0.16);border-radius:13px;padding:9px 15px;" +
        'font-size:14.5px;font-weight:800;color:#fff;">' + esc(msg) + "</span>";
      toast.style.opacity = "1";
      toastT = 1.5;
    }

    // ---- clubhouse (course select) ---------------------------------------
    var menuPanel = divEl("position:absolute;inset:0;display:none;flex-direction:column;" +
      "pointer-events:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;" +
      "background:linear-gradient(180deg,rgba(9,14,10,0.93),rgba(6,9,7,0.97));" +
      "padding:" + (16 + ctx.safeArea.top) + "px 14px " + (18 + ctx.safeArea.bottom) + "px;");
    root.appendChild(menuPanel);

    var menuHead = divEl("text-align:center;margin-bottom:14px;color:#f4f7ef;",
      '<div style="font-size:27px;font-weight:900;letter-spacing:-0.5px;">Windmill Cove</div>' +
      '<div style="opacity:0.62;font-size:13px;margin-top:3px;">Six courses · nine holes each</div>');
    menuPanel.appendChild(menuHead);
    var menuList = divEl("display:flex;flex-direction:column;gap:9px;");
    menuPanel.appendChild(menuList);
    var menuFoot = divEl("display:flex;gap:8px;margin-top:13px;justify-content:center;");
    menuPanel.appendChild(menuFoot);
    var btnHow2 = btnEl(BTN2, "How to play");
    var btnMusic = btnEl(BTN2, "Music: on");
    menuFoot.appendChild(btnHow2); menuFoot.appendChild(btnMusic);

    function buildMenu() {
      menuList.innerHTML = "";
      COURSES.forEach(function (co, i) {
        var par = coursePar(co);
        var bst = best[co.id + ":round"];
        var card = divEl("pointer-events:auto;cursor:pointer;display:flex;align-items:center;" +
          "gap:12px;padding:13px 14px;border-radius:16px;color:#f2f6ee;" +
          "border:1px solid rgba(255,255,255,0.13);" +
          "background:linear-gradient(120deg," + THEMES[co.theme].sky + "," + THEMES[co.theme].sky2 + ");",
          '<div style="font-size:27px;line-height:1;">' + co.icon + "</div>" +
          '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:16.5px;font-weight:850;">' + esc(co.name) + "</div>" +
          '<div style="opacity:0.72;font-size:12px;margin-top:2px;line-height:1.35;">' +
          esc(co.blurb) + "</div></div>" +
          '<div style="text-align:right;font-size:11.5px;opacity:0.9;">' +
          '<div style="font-weight:800;">Par ' + par + "</div>" +
          '<div style="opacity:0.75;margin-top:2px;">' +
          (bst != null ? "Best " + bst : "—") + "</div></div>");
        ctx.listen(card, "click", function () {
          resumeAudio(); haptic("light"); ctx.platform.start();
          startRound(i);
        });
        menuList.appendChild(card);
      });
      if (roundSave && COURSES[roundSave.c] && roundSave.h > 0) {
        var rc = COURSES[roundSave.c];
        var cont = btnEl(BTN + "width:100%;margin-bottom:9px;",
          "Continue " + rc.name + " · hole " + (roundSave.h + 1));
        ctx.listen(cont, "click", function () {
          resumeAudio(); haptic("light"); ctx.platform.start();
          var rs = roundSave; roundSave = null;
          startRound(rs.c, rs.card, rs.h);
        });
        menuList.insertBefore(cont, menuList.firstChild);
      }
    }

    // ---- hole result ------------------------------------------------------
    var holeEnd = divEl("position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:20px;pointer-events:auto;" +
      "background:linear-gradient(180deg,rgba(6,10,7,0.3),rgba(6,10,7,0.72));");
    root.appendChild(holeEnd);
    var holeEndBox = divEl(PANEL + "width:100%;max-width:300px;text-align:center;");
    holeEnd.appendChild(holeEndBox);

    function showHoleEnd() {
      var strokes = S.card[S.holeIx], par = S.hole.par, d = strokes - par;
      var nm = scoreName(strokes, par);
      var col = d < 0 ? "#7fe06a" : d === 0 ? "#eef3e9" : "#ff9a6a";
      var tot = cardTotal(), parSoFar = 0;
      for (var i = 0; i <= S.holeIx; i++) parSoFar += course().holes[i].par;
      holeEndBox.innerHTML =
        '<div style="font-size:12px;opacity:0.6;font-weight:800;letter-spacing:1px;">HOLE ' +
        (S.holeIx + 1) + "</div>" +
        '<div style="font-size:26px;font-weight:900;margin:5px 0 2px;color:' + col + ';">' +
        esc(nm) + "</div>" +
        '<div style="font-size:14px;opacity:0.8;">' + strokes + " shot" + (strokes === 1 ? "" : "s") +
        " · par " + par + "</div>" +
        '<div style="margin:13px 0 3px;font-size:13px;opacity:0.85;">Round: <b>' + tot +
        "</b> (" + relPar(tot - parSoFar) + ")</div>";
      var row = divEl("display:flex;gap:8px;margin-top:14px;");
      var nx = btnEl(BTN + "flex:1;",
        S.holeIx + 1 < course().holes.length ? "Next hole" : "Finish round");
      ctx.listen(nx, "click", function () { haptic("light"); nextHole(); });
      var rp = btnEl(BTN2, "Replay");
      ctx.listen(rp, "click", function () {
        haptic("light"); S.screen = "play"; loadHole(S.holeIx); showScreen();
      });
      row.appendChild(rp); row.appendChild(nx);
      holeEndBox.appendChild(row);
    }

    // ---- round result -----------------------------------------------------
    var roundEnd = divEl("position:absolute;inset:0;display:none;flex-direction:column;" +
      "pointer-events:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;" +
      "background:linear-gradient(180deg,rgba(7,11,8,0.95),rgba(5,8,6,0.98));color:#f3f7ee;" +
      "padding:" + (16 + ctx.safeArea.top) + "px 14px " + (18 + ctx.safeArea.bottom) + "px;");
    root.appendChild(roundEnd);
    var roundBox = divEl("color:#f3f7ee;");
    roundEnd.appendChild(roundBox);
    var boardBox = divEl("margin-top:12px;");
    roundEnd.appendChild(boardBox);
    var roundBtns = divEl("display:flex;gap:8px;margin-top:14px;");
    roundEnd.appendChild(roundBtns);

    function showRoundEnd() {
      var co = course(), par = coursePar(co), tot = cardTotal();
      var rows = "";
      for (var i = 0; i < co.holes.length; i++) {
        var v = S.card[i] || 0, p = co.holes[i].par, d = v - p;
        var c2 = d < 0 ? "#7fe06a" : d === 0 ? "#dfe6d8" : "#ff9a6a";
        rows += '<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;' +
          "border-radius:9px;background:rgba(255,255,255," + (i % 2 ? "0.05" : "0.02") + ');">' +
          '<div style="width:22px;opacity:0.6;font-size:12px;font-weight:800;">' + (i + 1) + "</div>" +
          '<div style="flex:1;font-size:13px;opacity:0.9;">' + esc(co.holes[i].name) + "</div>" +
          '<div style="width:34px;text-align:right;font-size:12px;opacity:0.55;">par ' + p + "</div>" +
          '<div style="width:30px;text-align:right;font-size:14.5px;font-weight:850;color:' +
          c2 + ';">' + v + "</div></div>";
      }
      roundBox.innerHTML =
        '<div style="text-align:center;margin-bottom:12px;">' +
        '<div style="font-size:12px;opacity:0.6;font-weight:800;letter-spacing:1px;">ROUND COMPLETE</div>' +
        '<div style="font-size:27px;font-weight:900;margin-top:3px;">' + co.icon + " " + esc(co.name) + "</div>" +
        '<div style="font-size:38px;font-weight:900;margin-top:6px;line-height:1;">' + tot + "</div>" +
        '<div style="font-size:14px;opacity:0.8;margin-top:2px;">' + relPar(tot - par) +
        " · par " + par + "</div>" +
        (best[co.id + ":round"] === tot
          ? '<div style="margin-top:7px;font-size:12.5px;color:#ffd23f;font-weight:800;">★ New personal best</div>'
          : '<div style="margin-top:7px;font-size:12.5px;opacity:0.6;">Best ' +
            best[co.id + ":round"] + "</div>") +
        "</div>" + rows;
      roundBtns.innerHTML = "";
      var again = btnEl(BTN + "flex:1;", "Play again");
      ctx.listen(again, "click", function () { haptic("light"); startRound(S.courseIx); });
      var toMenu = btnEl(BTN2, "Clubhouse");
      ctx.listen(toMenu, "click", function () {
        haptic("light"); S.screen = "menu"; buildMenu(); showScreen();
      });
      roundBtns.appendChild(toMenu); roundBtns.appendChild(again);
    }

    // ---- leaderboard ------------------------------------------------------
    var bArr = function (o) {
      return !o ? [] : Array.isArray(o) ? o
        : (o.entries || o.rows || o.items || o.leaderboard || o.results ||
           (o.data && (o.data.entries || o.data.rows)) || []);
    };
    var bSelf = function (e) {
      return !!(e && (e.self || e.isSelf || e.me || e.you || e.mine || e.isViewer || e.viewer));
    };
    var bName = function (e) {
      return e.name || e.displayName || e.handle || e.username ||
        (e.user && (e.user.name || e.user.displayName || e.user.handle || e.user.username)) ||
        (bSelf(e) ? "You" : "Golfer");
    };
    var bVal = function (e) {
      return e.label || e.formatted || e.valueLabel || e.display ||
        (e.value != null ? String(e.value) : "—");
    };
    var bRank = function (e, i) {
      return e.rank != null ? e.rank : (e.position != null ? e.position : i + 1);
    };
    function boardRow(rank, name, val, self) {
      return '<div style="display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:10px;' +
        "background:" + (self ? "rgba(255,210,63,0.16)" : "rgba(255,255,255,0.04)") + ';margin-bottom:4px;">' +
        '<div style="width:22px;font-size:12px;font-weight:800;opacity:0.65;">' + rank + "</div>" +
        '<div style="flex:1;font-size:13.5px;font-weight:' + (self ? "850" : "600") +
        ';overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">' + esc(name) + "</div>" +
        '<div style="font-size:13.5px;font-weight:850;">' + esc(val) + "</div></div>";
    }
    function renderBoard(lb) {
      var arr = bArr(lb);
      if (!arr.length) {
        return '<div style="opacity:0.7;text-align:center;padding:16px 0;font-size:13px;">' +
          "No cards posted here yet — put the first one up. ⛳</div>";
      }
      var top = arr.slice(0, 8);
      var html = top.map(function (e, i) {
        return boardRow(bRank(e, i), bName(e), bVal(e), bSelf(e));
      }).join("");
      var me = (lb && (lb.you || lb.self || lb.viewer || lb.me)) ||
        arr.filter(bSelf)[0];
      if (me && !top.some(bSelf)) {
        html += '<div style="height:1px;background:rgba(255,255,255,0.12);margin:6px 2px;"></div>' +
          boardRow(bRank(me, arr.indexOf(me)), bName(me), bVal(me), true);
      }
      return html;
    }
    async function loadBoard(courseId) {
      var co = null;
      for (var i = 0; i < COURSES.length; i++) if (COURSES[i].id === courseId) co = COURSES[i];
      if (!co) return;
      var head = '<div style="font-size:15.5px;font-weight:850;margin-bottom:2px;">🏆 Fewest strokes</div>' +
        '<div style="opacity:0.55;font-size:11.5px;margin-bottom:10px;">' +
        esc(co.name) + " · global · all time</div>";
      boardBox.innerHTML = head + '<div style="opacity:0.6;font-size:13px;padding:12px 0;' +
        'text-align:center;">Loading…</div>';
      var inner;
      try {
        var lb = await ctx.memory.record(courseId + "_round")
          .leaderboard({ scope: "global", period: "all_time" });
        inner = renderBoard(lb);
      } catch (_) {
        inner = '<div style="opacity:0.7;text-align:center;padding:14px 0;font-size:13px;">' +
          "The board isn't reachable right now.</div>";
      }
      boardBox.innerHTML = head + inner;
    }

    var boardPanel = divEl("position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:20px;pointer-events:auto;" +
      "background:rgba(5,8,6,0.68);");
    root.appendChild(boardPanel);
    var boardCard = divEl(PANEL + "width:100%;max-width:320px;max-height:80%;overflow-y:auto;");
    boardPanel.appendChild(boardCard);
    async function openBoard() {
      var co = course();
      boardPanel.style.display = "flex";
      haptic("light");
      var head = '<div style="font-size:16px;font-weight:850;margin-bottom:2px;">🏆 ' +
        esc(co.name) + "</div>" +
        '<div style="opacity:0.55;font-size:11.5px;margin-bottom:11px;">Fewest strokes · global · all time</div>';
      boardCard.innerHTML = head + '<div style="opacity:0.6;font-size:13px;padding:12px 0;' +
        'text-align:center;">Loading…</div>';
      var inner;
      try {
        var lb = await ctx.memory.record(co.id + "_round")
          .leaderboard({ scope: "global", period: "all_time" });
        inner = renderBoard(lb);
      } catch (_) {
        inner = '<div style="opacity:0.7;text-align:center;padding:14px 0;font-size:13px;">' +
          "The board isn't reachable right now.</div>";
      }
      if (boardPanel.style.display === "none") return;
      boardCard.innerHTML = head + inner +
        '<div style="text-align:center;margin-top:13px;opacity:0.5;font-size:12px;">Tap outside to close</div>';
    }
    ctx.listen(boardPanel, "click", function (e) {
      if (e.target === boardPanel) boardPanel.style.display = "none";
    });

    // ---- how to play ------------------------------------------------------
    var helpPanel = divEl("position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:20px;pointer-events:auto;background:rgba(5,8,6,0.7);");
    root.appendChild(helpPanel);
    var helpCard = divEl(PANEL + "width:100%;max-width:320px;max-height:82%;overflow-y:auto;",
      '<div style="font-size:18px;font-weight:900;margin-bottom:9px;">How to play</div>' +
      '<div style="font-size:13.5px;line-height:1.62;opacity:0.9;">' +
      "• <b>Drag anywhere</b> and pull back — the ball fires the way you pull, like a catapult.<br>" +
      "• Pull further for more power. The ring around the ball fills green → amber → red.<br>" +
      "• The dotted line previews your line and up to two rail bounces.<br>" +
      "• Release to putt. Drag back to almost nothing to cancel.<br>" +
      "• <b>Water and out-of-bounds cost one stroke</b> and put you back where you played from.<br>" +
      "• <b>Sand</b> kills roll, <b>ice</b> barely slows you, <b>arrows</b> push, <b>gold pads</b> fire you on.<br>" +
      "• Windmill blades, sliding gates and whirlpools all move — time them.<br>" +
      "• Fewest strokes over nine holes wins. Your round goes to the course leaderboard." +
      "</div>");
    helpPanel.appendChild(helpCard);
    var helpClose = btnEl(BTN + "width:100%;margin-top:14px;", "Got it");
    helpCard.appendChild(helpClose);
    ctx.listen(helpClose, "click", function () { helpPanel.style.display = "none"; });
    ctx.listen(helpPanel, "click", function (e) {
      if (e.target === helpPanel) helpPanel.style.display = "none";
    });

    /* ------------------------------------------------------ screen switch */

    function showScreen() {
      var p = S.screen === "play";
      hud.style.display = (p || S.screen === "holeEnd") ? "block" : "none";
      menuPanel.style.display = S.screen === "menu" ? "flex" : "none";
      holeEnd.style.display = S.screen === "holeEnd" ? "flex" : "none";
      roundEnd.style.display = S.screen === "roundEnd" ? "flex" : "none";
      if (S.screen === "holeEnd") showHoleEnd();
      if (S.screen === "roundEnd") showRoundEnd();
      if (S.screen === "menu") { menuPanel.scrollTop = 0; stopMusic(); }
      if (S.screen === "roundEnd") roundEnd.scrollTop = 0;
      syncHud();
    }

    ctx.listen(btnBack, "click", function () {
      haptic("light");
      S.screen = "menu"; buildMenu(); showScreen();
    });
    ctx.listen(btnHelp, "click", function () { haptic("light"); helpPanel.style.display = "flex"; });
    ctx.listen(btnHow2, "click", function () { haptic("light"); helpPanel.style.display = "flex"; });
    ctx.listen(btnBoard, "click", function () { openBoard(); });
    ctx.listen(btnMusic, "click", function () {
      musicOn = !musicOn;
      btnMusic.textContent = "Music: " + (musicOn ? "on" : "off");
      if (!musicOn) stopMusic(); else if (S.screen === "play") startMusic(course().theme);
      if (ctx.capabilities.storage) { try { ctx.storage.set("music", musicOn); } catch (_) {} }
      haptic("light");
    });

    /* ------------------------------------------------------------- input */

    function pointAt(e) {
      if (typeof e.offsetX === "number" && typeof e.offsetY === "number") {
        return { x: e.offsetX, y: e.offsetY };
      }
      return { x: e.clientX || 0, y: e.clientY || 0 };
    }
    function canAim() {
      return S.screen === "play" && !S.moving && !S.holed && S.intro <= 0 && S.sinking <= 0;
    }

    ctx.listen(canvas, "pointerdown", function (e) {
      resumeAudio();
      if (!canAim()) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      var pt = pointAt(e);
      S.aiming = true; S.ax = pt.x; S.ay = pt.y; S.bx = pt.x; S.by = pt.y;
    }, { passive: false });

    ctx.listen(canvas, "pointermove", function (e) {
      if (!S.aiming) return;
      e.preventDefault();
      var pt = pointAt(e);
      S.bx = pt.x; S.by = pt.y;
    }, { passive: false });

    function releaseAim(e) {
      if (!S.aiming) return;
      S.aiming = false;
      if (!canAim()) return;
      var px = S.ax - S.bx, py = S.ay - S.by;
      var mag = len2(px, py);
      if (mag < 9) return;                              // a tap, not a putt
      var power = clamp(mag / PULL_MAX, 0, 1) * MAX_SHOT;
      if (power < 2.2) return;
      shoot(px / mag, py / mag, power);
    }
    ctx.listen(canvas, "pointerup", releaseAim);
    ctx.listen(canvas, "pointercancel", function () { S.aiming = false; });
    ctx.listen(canvas, "lostpointercapture", function () { S.aiming = false; });

    /* -------------------------------------------------------- the frame */

    var settle = 0;

    function update(dt) {
      S.t += dt;
      if (S.intro > 0) S.intro = Math.max(0, S.intro - dt);
      if (S.banner > 0) S.banner = Math.max(0, S.banner - dt);
      if (S.cupPulse > 0) S.cupPulse = Math.max(0, S.cupPulse - dt * 1.4);
      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) toast.style.opacity = "0";
      }
      stepParts(dt);
      if (S.sinking > 0) {
        S.sinking -= dt;
        if (S.sinking <= 0) penalty(S.sinkKind);
        return;
      }
      if (S.screen !== "play" || !S.hole || S.holed) return;

      if (S.moving) {
        // Insurance against a ball that finds a way never to settle: the
        // stroke limit and the next shot both hang off coming to rest.
        S.rollT = (S.rollT || 0) + dt;
        if (S.rollT > 12) { S.ball.vx = 0; S.ball.vy = 0; }
        stepBall(S.hole, S.ball, dt, S.t, ev);

        if (ev.impact > 0.8) {
          sfxRail(ev.impact);
          if (ev.impact > 6) haptic("light");
          spawn(S.ball.x, S.ball.y, 2, "#ffffff", 2, 0.16, 0.07);
        }
        if (ev.boost) { sfxBoost(); }
        if (ev.portal) { sfxPortal(); spawn(S.ball.x, S.ball.y, 12, "#8ad8ff", 5, 0.4, 0.12); }
        if (ev.lip) { sfxLip(); haptic("warning"); }

        if (ev.holed) {
          finishHole(S.strokes);
          return;
        }
        if (ev.water || ev.out || ev.sunk) {
          S.moving = false;
          S.sinking = ev.sunk ? 0.5 : 0.42;
          S.sinkKind = ev.sunk ? "sunk" : ev.water ? "water" : "out";
          if (ev.water) {
            sfxSplash();
            spawn(S.ball.x, S.ball.y, 20, "#bfe6ff", 5, 0.55, 0.15);
          } else if (ev.sunk) {
            sfxPortal();
            spawn(S.ball.x, S.ball.y, 18, "#c79cff", 4, 0.5, 0.14);
          }
          return;
        }

        var sp = len2(S.ball.vx, S.ball.vy);
        if (sp > 2.5) {
          S.trail.push({ x: S.ball.x, y: S.ball.y });
          if (S.trail.length > 9) S.trail.shift();
          var sf = surfAt(S.hole, S.ball.x, S.ball.y);
          if (sf === SAND && Math.random() < 0.3) {
            spawn(S.ball.x, S.ball.y, 1, S.th.sand, 1.6, 0.3, 0.09);
          }
        } else if (S.trail.length) S.trail.shift();

        if (sp === 0) {
          settle += dt;
          if (settle > 0.1) {
            settle = 0; S.moving = false; S.rollT = 0; S.trail.length = 0;
            var sf2 = surfAt(S.hole, S.ball.x, S.ball.y);
            if (sf2 === SAND) sfxSand();
            afterSettle();
          }
        } else settle = 0;
      }
    }

    function render() {
      g.clearRect(0, 0, ctx.width, ctx.height);

      if (!S.hole) {
        var bg = g.createLinearGradient(0, 0, 0, ctx.height);
        bg.addColorStop(0, "#1d3320"); bg.addColorStop(1, "#0b140d");
        g.fillStyle = bg; g.fillRect(0, 0, ctx.width, ctx.height);
        return;
      }

      var th = S.th;
      g.fillStyle = th.sky2;
      g.fillRect(0, 0, ctx.width, ctx.height);

      var zoom = 1 + S.intro * 0.09;
      var cxs = view.ox + S.hole.w * view.s / 2;
      var cys = view.oy + S.hole.h * view.s / 2;

      g.save();
      g.translate(cxs, cys);
      g.scale(zoom, zoom);
      g.translate(-cxs, -cys);

      if (S.bake) {
        g.drawImage(S.bake, view.ox, view.oy, S.hole.w * view.s, S.hole.h * view.s);
      }
      g.save();
      g.translate(view.ox, view.oy);
      g.scale(view.s, view.s);
      if (!S.bake) paintCourse(g, S.hole, th, false);

      drawWater(g, S.waterPath, th, S.hole.w, S.hole.h, S.t);
      drawWells(g, S.hole, S.t);
      drawPortals(g, S.hole, S.t);
      drawCup(g, S.hole, th, S.t, S.holed);
      if (S.cupPulse > 0) {
        g.strokeStyle = "rgba(255,226,122," + (S.cupPulse * 0.8).toFixed(3) + ")";
        g.lineWidth = 0.22;
        g.beginPath();
        g.arc(S.hole.cup[0], S.hole.cup[1], CUP_R + (1 - S.cupPulse) * 4.5, 0, TAU);
        g.stroke();
      }
      drawMovers(g, S.hole, th, S.t);
      drawPosts(g, S.hole, th, S.t);
      drawSpinners(g, S.hole, th, S.t);

      if (!S.holed) {
        if (S.sinking > 0) {
          var k = clamp(S.sinking / 0.45, 0, 1);
          g.globalAlpha = k;
          drawBall(g, S.ball, [], S.t);
          g.globalAlpha = 1;
        } else {
          drawBall(g, S.ball, S.trail, S.t);
        }
      }
      drawParts(g);

      if (S.aiming && canAim()) {
        var px = S.ax - S.bx, py = S.ay - S.by, mag = len2(px, py);
        if (mag > 6) {
          var power = clamp(mag / PULL_MAX, 0, 1) * MAX_SHOT;
          drawAim(g, S.hole, S.ball, px / mag, py / mag, power, S.t);
        }
      }
      g.restore();
      g.restore();

      // pull feedback lives in screen space, right under the thumb
      if (S.aiming && canAim()) {
        var dx = S.bx - S.ax, dy = S.by - S.ay, m2 = len2(dx, dy);
        if (m2 > 6) {
          g.strokeStyle = "rgba(255,255,255,0.34)";
          g.lineWidth = 2; g.setLineDash([5, 5]);
          g.beginPath(); g.moveTo(S.ax, S.ay); g.lineTo(S.bx, S.by); g.stroke();
          g.setLineDash([]);
          g.fillStyle = "rgba(255,255,255,0.5)";
          g.beginPath(); g.arc(S.ax, S.ay, 5, 0, TAU); g.fill();
        }
      }

      if (S.banner > 0) {
        var a = clamp(S.banner / 0.55, 0, 1);
        var by2 = ctx.height * 0.5;
        g.globalAlpha = a;
        g.textAlign = "center";
        var bw = Math.min(ctx.width - 46, 270), bh = 54;
        var bx2 = (ctx.width - bw) / 2;
        g.fillStyle = "rgba(6,10,7,0.88)";
        roundRect(g, bx2, by2 - bh / 2, bw, bh, 15);
        g.fill();
        g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = 1.2; g.stroke();
        g.fillStyle = "rgba(255,255,255,0.62)";
        g.font = "800 10.5px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
        g.fillText("HOLE " + (S.holeIx + 1) + "  ·  PAR " + S.hole.par, ctx.width / 2, by2 - 8);
        g.fillStyle = "#ffffff";
        g.font = "900 20px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
        g.fillText(S.hole.name, ctx.width / 2, by2 + 15);
        g.globalAlpha = 1;
        g.textAlign = "start";
      }
    }

    ctx.onFrame(function (dtMs) {
      var dt = Math.min(dtMs, 34) / 1000;
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width; lastH = ctx.height;
        layout(); rebake();
      }
      update(dt);
      render();
    });

    /* -------------------------------------------------------------- boot */

    buildMenu();
    showScreen();
    render();
    ctx.markVisualReady("clubhouse");
    ctx.platform.ready();
  }
};
