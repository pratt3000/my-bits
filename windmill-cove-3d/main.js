/**
 * Windmill Cove 3D — mini golf you look around in.
 *
 * The 2D sibling (windmill-cove/) plays from a fixed overhead view. This one
 * puts the camera in the world: orbit around the ball, pinch out to survey the
 * whole hole, pinch back in, aim by looking, hit with a power meter. Elevation
 * is real — ramps, tiers, drops and jumps — so gravity does the work that
 * hand-placed "slope" zones did in the flat version.
 *
 * Everything above the `window.plethoraBit` assignment is pure: no DOM, no
 * WebGL, no Three. That is deliberate and load-bearing. The solver and the
 * hole data are pulled out by a headless harness that plays every hole to
 * prove it can be finished, which is only possible while physics knows
 * nothing about rendering.
 */

/* ------------------------------------------------------------------ maths */

var TAU = Math.PI * 2;
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var lerp = function (a, b, t) { return a + (b - a) * t; };

/** Tiny vec3 helpers over plain {x,y,z}. Three is a renderer here, not a lib. */
function v3(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }
function vlen(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
function vlen2(a) { return a.x * a.x + a.y * a.y + a.z * a.z; }
function vdot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function hlen(a) { return Math.sqrt(a.x * a.x + a.z * a.z); }

/** Deterministic hash-noise in [0,1) — scenery that never crawls. */
function hash01(a, b) {
  var h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/* ------------------------------------------------------------- constants */

var GREEN = 0, SAND = 1, ICE = 2, WOOD = 3, RUBBER = 4, METAL = 5;

/**
 * Per-material rolling resistance (u/s^2), viscous drag (1/s), how much bounce
 * a surface returns, and how much it grabs sideways on impact.
 */
var MAT = [
  { roll: 5.0, visc: 0.40, rest: 0.30, grip: 0.20 },   // GREEN
  { roll: 24.0, visc: 2.40, rest: 0.12, grip: 0.55 },  // SAND
  { roll: 2.40, visc: 0.25, rest: 0.30, grip: 0.03 },  // ICE
  { roll: 5.0, visc: 0.40, rest: 0.55, grip: 0.16 },   // WOOD  (rails)
  { roll: 5.0, visc: 0.40, rest: 0.92, grip: 0.10 },   // RUBBER (bumpers)
  { roll: 4.0, visc: 0.32, rest: 0.62, grip: 0.12 }    // METAL
];

var BALL_R = 0.36;
var CUP_R = 0.62;
var CUP_CATCH = 7.0;          // above this the ball rides the rim instead
var GRAVITY = -30;
var MAX_SHOT = 32;
var REST_SPEED = 0.40;
var GROUND_DOT = 0.55;        // normal.y above this counts as standing on it

/* ------------------------------------------------- oriented-box collision */

/**
 * Boxes carry a yaw (about Y) and a tilt (about local X). Two angles is all a
 * mini-golf course needs: yaw turns a rail, tilt makes a ramp. Storing the
 * basis on the box keeps the per-step test to a few dot products.
 */
function bakeBox(b) {
  var cy = Math.cos(b.yaw || 0), sy = Math.sin(b.yaw || 0);
  var ct = Math.cos(b.tilt || 0), st = Math.sin(b.tilt || 0);
  // columns of R = Ry(yaw) * Rx(tilt)
  b.ux = v3(cy, 0, -sy);
  b.uy = v3(sy * st, ct, cy * st);
  b.uz = v3(sy * ct, -st, cy * ct);
  if (b.m == null) b.m = GREEN;
  return b;
}

/**
 * Closest point on an oriented box to `p`, written into `out`. Returns the
 * squared distance so callers can reject without a sqrt.
 */
function closestOnBox(p, b, out) {
  var dx = p.x - b.p.x, dy = p.y - b.p.y, dz = p.z - b.p.z;
  var lx = dx * b.ux.x + dy * b.ux.y + dz * b.ux.z;
  var ly = dx * b.uy.x + dy * b.uy.y + dz * b.uy.z;
  var lz = dx * b.uz.x + dy * b.uz.y + dz * b.uz.z;
  var cx = clamp(lx, -b.s.x, b.s.x);
  var cy2 = clamp(ly, -b.s.y, b.s.y);
  var cz = clamp(lz, -b.s.z, b.s.z);
  var inside = (cx === lx && cy2 === ly && cz === lz);
  if (inside) {
    // Deep inside: leave by the nearest face, or the solver never lets go.
    var ox = b.s.x - Math.abs(lx), oy = b.s.y - Math.abs(ly), oz = b.s.z - Math.abs(lz);
    if (oy <= ox && oy <= oz) cy2 = ly >= 0 ? b.s.y : -b.s.y;
    else if (ox <= oz) cx = lx >= 0 ? b.s.x : -b.s.x;
    else cz = lz >= 0 ? b.s.z : -b.s.z;
  }
  out.x = b.p.x + b.ux.x * cx + b.uy.x * cy2 + b.uz.x * cz;
  out.y = b.p.y + b.ux.y * cx + b.uy.y * cy2 + b.uz.y * cz;
  out.z = b.p.z + b.ux.z * cx + b.uy.z * cy2 + b.uz.z * cz;
  var ex = p.x - out.x, ey = p.y - out.y, ez = p.z - out.z;
  return { d2: ex * ex + ey * ey + ez * ez, inside: inside };
}

function boxAABB(b) {
  var ex = Math.abs(b.ux.x) * b.s.x + Math.abs(b.uy.x) * b.s.y + Math.abs(b.uz.x) * b.s.z;
  var ey = Math.abs(b.ux.y) * b.s.x + Math.abs(b.uy.y) * b.s.y + Math.abs(b.uz.y) * b.s.z;
  var ez = Math.abs(b.ux.z) * b.s.x + Math.abs(b.uy.z) * b.s.y + Math.abs(b.uz.z) * b.s.z;
  return { min: v3(b.p.x - ex, b.p.y - ey, b.p.z - ez), max: v3(b.p.x + ex, b.p.y + ey, b.p.z + ez) };
}

/* ------------------------------------------------------------ the solver */

var _cp = { x: 0, y: 0, z: 0 };

/**
 * One contact response. `ov` is the collider's own velocity at the contact, so
 * a windmill blade or a sliding gate throws the ball instead of just stopping
 * it. Returns the impact speed for sound and haptics.
 */
function resolveSphere(ball, cx, cy, cz, mat, ov, st) {
  var dx = ball.p.x - cx, dy = ball.p.y - cy, dz = ball.p.z - cz;
  var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  var nx, ny, nz;
  if (d > 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d; }
  else {                                    // dead centre: back out the way we came
    var sp = vlen(ball.v);
    if (sp < 1e-6) { nx = 0; ny = 1; nz = 0; }
    else { nx = -ball.v.x / sp; ny = -ball.v.y / sp; nz = -ball.v.z / sp; }
  }
  ball.p.x = cx + nx * (BALL_R + 1e-4);
  ball.p.y = cy + ny * (BALL_R + 1e-4);
  ball.p.z = cz + nz * (BALL_R + 1e-4);

  var m = MAT[mat] || MAT[GREEN];
  var rvx = ball.v.x - ov.x, rvy = ball.v.y - ov.y, rvz = ball.v.z - ov.z;
  var vn = rvx * nx + rvy * ny + rvz * nz;
  if (vn >= 0) { return 0; }
  var impact = -vn;

  // Standing on something: stop bouncing once the drop is small, or the ball
  // chatters on every flat surface forever.
  var ground = ny > GROUND_DOT;
  var rest = m.rest;
  if (ground) {
    st.grounded = true;
    st.groundMat = mat;
    st.gnx = nx; st.gny = ny; st.gnz = nz;
    if (impact < 2.6) rest = 0;
  }

  rvx -= (1 + rest) * vn * nx;
  rvy -= (1 + rest) * vn * ny;
  rvz -= (1 + rest) * vn * nz;
  // Scrub sideways speed in proportion to how hard the contact was. A real
  // graze bleeds pace; a ball merely resting on the floor re-contacts every
  // substep and must not be scrubbed at all, or it stops in a metre.
  var tn = rvx * nx + rvy * ny + rvz * nz;
  var tx = rvx - tn * nx, ty = rvy - tn * ny, tz = rvz - tn * nz;
  var grip = (ground ? m.grip * 0.5 : m.grip) * clamp(impact / 7, 0, 1);
  rvx -= tx * grip; rvy -= ty * grip; rvz -= tz * grip;

  ball.v.x = rvx + ov.x; ball.v.y = rvy + ov.y; ball.v.z = rvz + ov.z;
  return impact;
}

/** Mover box at time t, with the velocity of its slide. */
function moverAt(mv, t) {
  var ph = t * TAU / mv.period + (mv.phase || 0);
  var off = Math.sin(ph), w = TAU / mv.period;
  var c = Math.cos(ph) * w;
  mv.box.p.x = mv.base.x + mv.axis.x * mv.amp * off;
  mv.box.p.y = mv.base.y + mv.axis.y * mv.amp * off;
  mv.box.p.z = mv.base.z + mv.axis.z * mv.amp * off;
  mv.vel.x = mv.axis.x * mv.amp * c;
  mv.vel.y = mv.axis.y * mv.amp * c;
  mv.vel.z = mv.axis.z * mv.amp * c;
  return mv;
}

var _zero = v3(0, 0, 0);

/**
 * Advances the ball by dt. Sub-steps by speed so a hard shot cannot pass
 * through a rail, and reports what happened so the game can react to it.
 */
function stepBall(hole, ball, dt, time, ev) {
  ev.impact = 0; ev.water = false; ev.out = false; ev.holed = false;
  ev.lip = false; ev.portal = false; ev.boost = false; ev.sunk = false;
  ev.mat = GREEN;

  var speed = vlen(ball.v);
  var steps = clamp(Math.ceil(speed * dt / (BALL_R * 0.5)), 1, 20);
  var sdt = dt / steps;
  var i, j;

  for (var step = 0; step < steps; step++) {
    var st = time + sdt * step;
    var state = { grounded: false, groundMat: GREEN, gnx: 0, gny: 1, gnz: 0 };

    ball.v.y += GRAVITY * sdt;

    for (i = 0; i < hole.boosts.length; i++) {
      var bo = hole.boosts[i];
      if (ball.p.x > bo.min.x && ball.p.x < bo.max.x && ball.p.z > bo.min.z &&
          ball.p.z < bo.max.z && ball.p.y > bo.min.y && ball.p.y < bo.max.y) {
        var along = ball.v.x * bo.dir.x + ball.v.z * bo.dir.z;
        if (along < bo.power) {
          ball.v.x += bo.dir.x * (bo.power - along);
          ball.v.z += bo.dir.z * (bo.power - along);
          if (bo.lift) ball.v.y = Math.max(ball.v.y, bo.lift);
          ev.boost = true;
        }
      }
    }
    for (i = 0; i < hole.wells.length; i++) {
      var wl = hole.wells[i];
      var wdx = wl.p.x - ball.p.x, wdz = wl.p.z - ball.p.z;
      var wd = Math.sqrt(wdx * wdx + wdz * wdz);
      if (wd < wl.r && wd > 1e-4 && Math.abs(ball.p.y - wl.p.y) < 3) {
        var pull = wl.force * (1 - wd / wl.r) * Math.min(1, wd / 1.4);
        ball.v.x += (wdx / wd) * pull * sdt;
        ball.v.z += (wdz / wd) * pull * sdt;
        if (wl.kills && wd < 0.9) { ev.sunk = true; return; }
      }
    }

    ball.p.x += ball.v.x * sdt;
    ball.p.y += ball.v.y * sdt;
    ball.p.z += ball.v.z * sdt;

    // ---- static geometry, via the XZ broadphase
    var near = boxesNear(hole, ball.p.x, ball.p.z);
    for (i = 0; i < near.length; i++) {
      var b = near[i];
      if (ball.p.y - BALL_R > b.aabb.max.y || ball.p.y + BALL_R < b.aabb.min.y) continue;
      var r = closestOnBox(ball.p, b, _cp);
      if (r.d2 < BALL_R * BALL_R) {
        var imp = resolveSphere(ball, _cp.x, _cp.y, _cp.z, b.m, _zero, state);
        if (imp > ev.impact) ev.impact = imp;
      }
    }

    // ---- round posts and bumpers
    for (i = 0; i < hole.cyls.length; i++) {
      var cy3 = hole.cyls[i];
      var rdx = ball.p.x - cy3.p.x, rdz = ball.p.z - cy3.p.z;
      var rd = Math.sqrt(rdx * rdx + rdz * rdz);
      var k = rd > 1e-6 ? Math.min(1, cy3.r / rd) : 0;
      var qx = cy3.p.x + rdx * k, qz = cy3.p.z + rdz * k;
      var qy = clamp(ball.p.y, cy3.p.y - cy3.h, cy3.p.y + cy3.h);
      var qdx = ball.p.x - qx, qdy = ball.p.y - qy, qdz = ball.p.z - qz;
      if (qdx * qdx + qdy * qdy + qdz * qdz < BALL_R * BALL_R) {
        var impc = resolveSphere(ball, qx, qy, qz, cy3.m, _zero, state);
        if (impc > ev.impact) ev.impact = impc;
        if (cy3.m === RUBBER && impc > 0.6) ev.boost = true;
      }
    }

    // ---- sliding gates and platforms
    for (i = 0; i < hole.movers.length; i++) {
      var mv = moverAt(hole.movers[i], st);
      var rm = closestOnBox(ball.p, mv.box, _cp);
      if (rm.d2 < BALL_R * BALL_R) {
        var imp2 = resolveSphere(ball, _cp.x, _cp.y, _cp.z, mv.box.m, mv.vel, state);
        if (imp2 > ev.impact) ev.impact = imp2;
      }
    }

    // ---- windmill blades: an oriented box whose yaw is a function of time
    for (i = 0; i < hole.spinners.length; i++) {
      var sn = hole.spinners[i];
      var base = sn.omega * st + (sn.phase || 0);
      for (j = 0; j < sn.blades; j++) {
        var a = base + j * TAU / sn.blades;
        var bl = sn.box;
        bl.yaw = a;
        bl.p.x = sn.p.x + Math.cos(a) * sn.reach * 0.5;
        bl.p.z = sn.p.z - Math.sin(a) * sn.reach * 0.5;
        bl.p.y = sn.p.y;
        bakeBox(bl);
        var rs = closestOnBox(ball.p, bl, _cp);
        if (rs.d2 < BALL_R * BALL_R) {
          // point velocity = omega cross r, about the hub
          var rx = _cp.x - sn.p.x, rz = _cp.z - sn.p.z;
          var ov = v3(-sn.omega * rz, 0, sn.omega * rx);
          var imp3 = resolveSphere(ball, _cp.x, _cp.y, _cp.z, bl.m, ov, state);
          if (imp3 > ev.impact) ev.impact = imp3;
        }
      }
    }

    // ---- portals
    if (ball.portalCd > 0) ball.portalCd -= sdt;
    else {
      for (i = 0; i < hole.portals.length; i++) {
        var pt = hole.portals[i];
        var da = Math.sqrt((ball.p.x - pt.a.x) * (ball.p.x - pt.a.x) +
                           (ball.p.z - pt.a.z) * (ball.p.z - pt.a.z));
        var db = Math.sqrt((ball.p.x - pt.b.x) * (ball.p.x - pt.b.x) +
                           (ball.p.z - pt.b.z) * (ball.p.z - pt.b.z));
        if (da < pt.r && Math.abs(ball.p.y - pt.a.y) < 1.6) {
          ball.p.x = pt.b.x; ball.p.y = pt.b.y; ball.p.z = pt.b.z;
          ball.portalCd = 0.4; ev.portal = true; break;
        }
        if (db < pt.r && Math.abs(ball.p.y - pt.b.y) < 1.6) {
          ball.p.x = pt.a.x; ball.p.y = pt.a.y; ball.p.z = pt.a.z;
          ball.portalCd = 0.4; ev.portal = true; break;
        }
      }
    }

    // ---- the cup
    var cdx = ball.p.x - hole.cup.x, cdz = ball.p.z - hole.cup.z;
    var cd = Math.sqrt(cdx * cdx + cdz * cdz);
    if (cd < CUP_R && Math.abs(ball.p.y - hole.cup.y) < 1.1) {
      var csp = vlen(ball.v);
      if (csp <= CUP_CATCH) { ev.holed = true; return; }
      var cn = cd > 1e-6 ? 1 / cd : 0;
      var lnx = cdx * cn, lnz = cdz * cn;
      ball.p.x = hole.cup.x + lnx * CUP_R;
      ball.p.z = hole.cup.z + lnz * CUP_R;
      var lvn = ball.v.x * lnx + ball.v.z * lnz;
      if (lvn < 0) { ball.v.x -= 1.5 * lvn * lnx; ball.v.z -= 1.5 * lvn * lnz; }
      ball.v.x *= 0.72; ball.v.z *= 0.72;
      ev.lip = true;
    }

    // ---- hazards
    for (i = 0; i < hole.water.length; i++) {
      var w = hole.water[i];
      if (ball.p.x > w.min.x && ball.p.x < w.max.x &&
          ball.p.z > w.min.z && ball.p.z < w.max.z &&
          ball.p.y < w.max.y) { ev.water = true; return; }
    }
    if (ball.p.y < hole.killY) { ev.out = true; return; }

    // ---- rolling resistance, only while actually on something
    ball.grounded = state.grounded;
    if (state.grounded) {
      ev.mat = state.groundMat;
      var m = MAT[state.groundMat] || MAT[GREEN];
      var damp = Math.exp(-m.visc * sdt);
      ball.v.x *= damp; ball.v.z *= damp;
      var hs = hlen(ball.v);
      if (hs > 1e-6) {
        var ns = hs - m.roll * sdt;
        if (ns <= 0) { ball.v.x = 0; ball.v.z = 0; }
        else { ball.v.x = ball.v.x / hs * ns; ball.v.z = ball.v.z / hs * ns; }
      }
      // settle: on flat ground, with nothing left to give
      if (vlen(ball.v) < REST_SPEED && state.gny > 0.985) {
        ball.v.x = 0; ball.v.y = 0; ball.v.z = 0;
      }
    }
  }
}

/* ------------------------------------------------------ hole construction */

var SLAB = 0.4, RAIL_H = 0.62, RAIL_T = 0.26;

/**
 * A flat platform with rails on the named sides. `rails` is any of "NSEW":
 * N is the -Z edge, S is +Z, W is -X, E is +X. Leaving a side out is how one
 * platform opens onto the next.
 */
function plat(x, z, w, d, y, m, rails) {
  var out = [{ p: v3(x + w / 2, y - SLAB / 2, z + d / 2), s: v3(w / 2, SLAB / 2, d / 2), m: m }];
  rails = rails || "";
  if (rails.indexOf("N") >= 0) {
    out.push({ p: v3(x + w / 2, y + RAIL_H / 2, z + RAIL_T / 2), s: v3(w / 2, RAIL_H / 2, RAIL_T / 2), m: WOOD });
  }
  if (rails.indexOf("S") >= 0) {
    out.push({ p: v3(x + w / 2, y + RAIL_H / 2, z + d - RAIL_T / 2), s: v3(w / 2, RAIL_H / 2, RAIL_T / 2), m: WOOD });
  }
  if (rails.indexOf("W") >= 0) {
    out.push({ p: v3(x + RAIL_T / 2, y + RAIL_H / 2, z + d / 2), s: v3(RAIL_T / 2, RAIL_H / 2, d / 2), m: WOOD });
  }
  if (rails.indexOf("E") >= 0) {
    out.push({ p: v3(x + w - RAIL_T / 2, y + RAIL_H / 2, z + d / 2), s: v3(RAIL_T / 2, RAIL_H / 2, d / 2), m: WOOD });
  }
  return out;
}

/** A ramp climbing along +Z from y0 to y1, with optional side rails. */
function rampZ(x, z, w, d, y0, y1, m, rails) {
  var rise = y1 - y0, len = Math.sqrt(d * d + rise * rise);
  var tilt = -Math.atan2(rise, d);
  var uy = v3(0, Math.cos(tilt), Math.sin(tilt));
  var out = [{
    p: v3(x + w / 2 - uy.x * SLAB / 2, (y0 + y1) / 2 - uy.y * SLAB / 2,
          z + d / 2 - uy.z * SLAB / 2),
    s: v3(w / 2, SLAB / 2, len / 2), yaw: 0, tilt: tilt, m: m
  }];
  rails = rails || "";
  if (rails.indexOf("W") >= 0) {
    out.push({ p: v3(x + RAIL_T / 2, (y0 + y1) / 2 + RAIL_H / 2, z + d / 2),
               s: v3(RAIL_T / 2, RAIL_H / 2 + Math.abs(rise) / 2, len / 2), yaw: 0, tilt: tilt, m: WOOD });
  }
  if (rails.indexOf("E") >= 0) {
    out.push({ p: v3(x + w - RAIL_T / 2, (y0 + y1) / 2 + RAIL_H / 2, z + d / 2),
               s: v3(RAIL_T / 2, RAIL_H / 2 + Math.abs(rise) / 2, len / 2), yaw: 0, tilt: tilt, m: WOOD });
  }
  return out;
}

/** A ramp climbing along +X from y0 to y1. */
function rampX(x, z, w, d, y0, y1, m, rails) {
  var rise = y1 - y0, len = Math.sqrt(w * w + rise * rise);
  var tilt = -Math.atan2(rise, w);
  var uy = v3(Math.sin(tilt), Math.cos(tilt), 0);
  var out = [{
    p: v3(x + w / 2 - uy.x * SLAB / 2, (y0 + y1) / 2 - uy.y * SLAB / 2, z + d / 2),
    s: v3(d / 2, SLAB / 2, len / 2), yaw: Math.PI / 2, tilt: tilt, m: m
  }];
  rails = rails || "";
  if (rails.indexOf("N") >= 0) {
    out.push({ p: v3(x + w / 2, (y0 + y1) / 2 + RAIL_H / 2, z + RAIL_T / 2),
               s: v3(RAIL_T / 2, RAIL_H / 2 + Math.abs(rise) / 2, len / 2), yaw: Math.PI / 2, tilt: tilt, m: WOOD });
  }
  if (rails.indexOf("S") >= 0) {
    out.push({ p: v3(x + w / 2, (y0 + y1) / 2 + RAIL_H / 2, z + d - RAIL_T / 2),
               s: v3(RAIL_T / 2, RAIL_H / 2 + Math.abs(rise) / 2, len / 2), yaw: Math.PI / 2, tilt: tilt, m: WOOD });
  }
  return out;
}

/** A free-standing block: a bollard, a crate, a bank to play off. */
function block(x, z, w, d, y, h, m, yaw) {
  return [{ p: v3(x + w / 2, y + h / 2, z + d / 2), s: v3(w / 2, h / 2, d / 2),
            yaw: yaw || 0, m: m == null ? WOOD : m }];
}

function cyl(x, z, y, r, h, m) { return { p: v3(x, y + h, z), r: r, h: h, m: m == null ? WOOD : m }; }

/** A speed pad. `lift` gives it vertical kick, which is how you jump a gap. */
function boostPad(x, z, w, d, y, dx, dz, power, lift) {
  return { min: v3(x, y - 0.6, z), max: v3(x + w, y + 1.8, z + d),
           dir: { x: dx, z: dz }, power: power, lift: lift || 0 };
}
function well(x, y, z, r, force, kills) {
  return { p: v3(x, y, z), r: r, force: force, kills: !!kills };
}
function portal(ax, ay, az, bx, by, bz, r) {
  return { a: v3(ax, ay, az), b: v3(bx, by, bz), r: r };
}
function mover(x, y, z, w, h, d, ax, ay, az, amp, period, phase, m) {
  return { p: [x, y, z], s: [w / 2, h / 2, d / 2], axis: [ax, ay, az],
           amp: amp, period: period, phase: phase || 0, m: m == null ? WOOD : m };
}

function waterBox(x, z, w, d, y) {
  return { min: v3(x, -50, z), max: v3(x + w, y, z + d) };
}

/**
 * Bakes a hole definition into runtime form: box bases, AABBs, and a coarse
 * XZ grid so a step tests a handful of boxes rather than all of them.
 */
function compileHole(def) {
  var boxes = [];
  for (var i = 0; i < def.boxes.length; i++) {
    var b = bakeBox(def.boxes[i]);
    b.aabb = boxAABB(b);
    boxes.push(b);
  }
  var lo = v3(1e9, 1e9, 1e9), hi = v3(-1e9, -1e9, -1e9);
  for (i = 0; i < boxes.length; i++) {
    var a = boxes[i].aabb;
    lo.x = Math.min(lo.x, a.min.x); lo.z = Math.min(lo.z, a.min.z);
    hi.x = Math.max(hi.x, a.max.x); hi.z = Math.max(hi.z, a.max.z);
    lo.y = Math.min(lo.y, a.min.y); hi.y = Math.max(hi.y, a.max.y);
  }
  var CELLW = 3;
  var gw = Math.max(1, Math.ceil((hi.x - lo.x) / CELLW) + 1);
  var gd = Math.max(1, Math.ceil((hi.z - lo.z) / CELLW) + 1);
  var grid = new Array(gw * gd);
  for (i = 0; i < boxes.length; i++) {
    var ab = boxes[i].aabb;
    var x0 = clamp(Math.floor((ab.min.x - lo.x) / CELLW), 0, gw - 1);
    var x1 = clamp(Math.floor((ab.max.x - lo.x) / CELLW), 0, gw - 1);
    var z0 = clamp(Math.floor((ab.min.z - lo.z) / CELLW), 0, gd - 1);
    var z1 = clamp(Math.floor((ab.max.z - lo.z) / CELLW), 0, gd - 1);
    for (var gz = z0; gz <= z1; gz++) {
      for (var gx = x0; gx <= x1; gx++) {
        var k = gz * gw + gx;
        (grid[k] || (grid[k] = [])).push(boxes[i]);
      }
    }
  }

  var movers = (def.movers || []).map(function (m) {
    var bx = bakeBox({ p: v3(m.p[0], m.p[1], m.p[2]), s: v3(m.s[0], m.s[1], m.s[2]),
                       yaw: m.yaw || 0, m: m.m == null ? WOOD : m.m });
    return { box: bx, base: v3(m.p[0], m.p[1], m.p[2]),
             axis: v3(m.axis[0], m.axis[1], m.axis[2]), amp: m.amp,
             period: m.period, phase: m.phase || 0, vel: v3(0, 0, 0) };
  });
  var spinners = (def.spinners || []).map(function (s) {
    return { p: v3(s.p[0], s.p[1], s.p[2]), reach: s.reach, omega: s.omega,
             phase: s.phase || 0, blades: s.blades,
             box: bakeBox({ p: v3(0, 0, 0), s: v3(s.thick || 0.18, s.tall || 0.42, s.reach / 2), m: WOOD }) };
  });

  return {
    def: def, name: def.name, par: def.par,
    boxes: boxes, grid: grid, gw: gw, gd: gd, cell: CELLW, lo: lo, hi: hi,
    cyls: (def.cyls || []), movers: movers, spinners: spinners,
    water: (def.water || []), boosts: (def.boosts || []),
    portals: (def.portals || []), wells: (def.wells || []),
    tee: v3(def.tee[0], def.tee[1], def.tee[2]),
    cup: v3(def.cup[0], def.cup[1], def.cup[2]),
    killY: def.killY == null ? -8 : def.killY
  };
}

var _empty = [];
function boxesNear(hole, x, z) {
  var gx = Math.floor((x - hole.lo.x) / hole.cell);
  var gz = Math.floor((z - hole.lo.z) / hole.cell);
  if (gx < 0 || gz < 0 || gx >= hole.gw || gz >= hole.gd) return _empty;
  return hole.grid[gz * hole.gw + gx] || _empty;
}

/* ============================================================== the courses

   Holes run along +Z: tee at low Z, cup at high Z. `plat` and the two ramp
   helpers do the work; a side letter left out of the rail string is where one
   platform opens onto the next. Elevation is the point — gravity turns every
   slope into a real slope, so nothing here needs a hand-placed push zone.   */

var TEE_Y = BALL_R;

var COURSES = [
  {
    id: "heights", name: "Fernwood Heights", theme: "forest", icon: "🌲",
    blurb: "Tiered greens cut into a pine hillside. Commit to the climb or roll back down.",
    holes: [
      {
        name: "First Tee", par: 2,
        boxes: [].concat(
          plat(0, 0, 8, 18, 0, GREEN, "NWE"),
          rampZ(0, 18, 8, 4, 0, 0.8, GREEN, "WE"),
          plat(0, 22, 8, 8, 0.8, GREEN, "SWE")),
        tee: [4, TEE_Y, 3], cup: [4, 0.8, 26]
      },
      {
        name: "The Rise", par: 3,
        boxes: [].concat(
          plat(0, 0, 9, 12, 0, GREEN, "NWE"),
          rampZ(0, 12, 9, 7, 0, 2.6, GREEN, "WE"),
          plat(0, 19, 9, 12, 2.6, GREEN, "SWE")),
        cyls: [cyl(4.5, 25, 2.6, 0.7, 0.5, WOOD)],
        tee: [4.5, TEE_Y, 3], cup: [4.5, 2.6, 29]
      },
      {
        name: "Windmill Hill", par: 3,
        boxes: [].concat(
          plat(0, 0, 10, 11, 0, GREEN, "NWE"),
          rampZ(0, 11, 10, 6, 0, 2, GREEN, "WE"),
          plat(0, 17, 10, 14, 2, GREEN, "SWE")),
        spinners: [{ p: [5, 2.5, 23], reach: 4.4, thick: 0.18, tall: 0.42, omega: 1.5, phase: 0, blades: 4 }],
        tee: [5, TEE_Y, 3], cup: [5, 2, 29]
      },
      {
        name: "Creek Crossing", par: 3,
        boxes: [].concat(
          plat(0, 0, 9, 12, 0, GREEN, "NWE"),
          plat(3, 12, 3, 7, 0, GREEN, ""),
          plat(0, 19, 9, 12, 0, GREEN, "SWE")),
        water: [waterBox(-6, 12, 21, 7, -0.6)],
        tee: [4.5, TEE_Y, 3], cup: [4.5, 0, 27], killY: -6
      },
      {
        name: "Split Deck", par: 3,
        boxes: [].concat(
          plat(0, 0, 12, 9, 0, GREEN, "NWE"),
          rampZ(0, 9, 5, 7, 0, 2.4, GREEN, "W"),
          plat(0, 16, 5, 13, 2.4, GREEN, "SW"),
          plat(6, 9, 6, 20, 0, GREEN, "E"),
          plat(5, 16, 1, 13, 2.4, WOOD, ""),
          plat(0, 29, 12, 5, 0, GREEN, "SWE"),
          rampZ(0, 29, 5, 0.1, 2.4, 2.4, GREEN, "")),
        cyls: [cyl(8, 20, 0, 0.8, 0.5, WOOD)],
        tee: [8.5, TEE_Y, 3], cup: [3, 0, 31.5]
      },
      {
        name: "The Drop", par: 3,
        boxes: [].concat(
          plat(0, 0, 9, 13, 3.2, GREEN, "NWE"),
          rampZ(0, 13, 9, 5, 3.2, 0, GREEN, "WE"),
          plat(0, 18, 9, 14, 0, GREEN, "SWE")),
        cyls: [cyl(2.5, 24, 0, 0.75, 0.5, WOOD), cyl(6.5, 27, 0, 0.75, 0.5, WOOD)],
        tee: [4.5, 3.2 + BALL_R, 3], cup: [4.5, 0, 30]
      },
      {
        name: "Switchback", par: 4,
        boxes: [].concat(
          plat(0, 0, 6, 12, 0, GREEN, "NWE"),
          plat(0, 12, 6, 7, 0, GREEN, "WS"),
          rampX(6, 12, 8, 7, 0, 2.8, GREEN, "NS"),
          plat(14, 12, 6, 7, 2.8, GREEN, "NE"),
          plat(14, 19, 6, 13, 2.8, GREEN, "SWE")),
        cyls: [cyl(17, 26, 2.8, 0.7, 0.5, WOOD)],
        tee: [3, TEE_Y, 3], cup: [17, 2.8, 30]
      },
      {
        name: "Mill Pond", par: 4,
        boxes: [].concat(
          plat(0, 0, 11, 11, 0, GREEN, "NWE"),
          plat(2.5, 11, 6, 9, 0, GREEN, ""),
          plat(0, 20, 11, 12, 0, GREEN, "SWE")),
        water: [waterBox(-8, 11, 27, 9, -0.6)],
        spinners: [{ p: [5.5, 0.5, 15.5], reach: 2.0, thick: 0.16, tall: 0.4, omega: -1.3, phase: 0, blades: 3 }],
        tee: [5.5, TEE_Y, 3], cup: [5.5, 0, 28], killY: -6
      },
      {
        name: "Fernwood Summit", par: 4,
        boxes: [].concat(
          plat(0, 0, 10, 10, 0, GREEN, "NWE"),
          rampZ(0, 10, 10, 7, 0, 3, GREEN, "WE"),
          plat(0, 17, 10, 10, 3, GREEN, "WE"),
          rampZ(0, 27, 10, 5, 3, 1, GREEN, "WE"),
          plat(0, 32, 10, 9, 1, GREEN, "SWE")),
        spinners: [{ p: [5, 3.5, 22], reach: 5.4, thick: 0.18, tall: 0.42, omega: 1.8, phase: 0.9, blades: 3 }],
        cyls: [cyl(2.4, 36, 1, 0.7, 0.5, WOOD), cyl(7.6, 36, 1, 0.7, 0.5, WOOD)],
        tee: [5, TEE_Y, 3], cup: [5, 1, 38]
      }
    ]
  }
  ,{
    id: "reef", name: "Buccaneer Reef", theme: "pirate", icon: "🏴‍☠️",
    blurb: "Causeways over open water, cannons that throw you across it, and gates that do not wait.",
    holes: [
      {
        name: "Low Tide", par: 2,
        boxes: [].concat(
          plat(0, 0, 6, 10, 0, GREEN, "NWE"),
          plat(1.5, 10, 3, 10, 0, GREEN, ""),
          plat(0, 20, 6, 10, 0, GREEN, "SWE")),
        water: [waterBox(-10, 10, 26, 10, -0.5)],
        tee: [3, TEE_Y, 3], cup: [3, 0, 26], killY: -6
      },
      {
        name: "Plank Bridge", par: 3,
        boxes: [].concat(
          plat(0, 0, 8, 11, 0, GREEN, "NWE"),
          plat(2, 11, 4, 10, 0, GREEN, ""),
          plat(0, 21, 8, 11, 0, GREEN, "SWE")),
        water: [waterBox(-10, 11, 28, 10, -0.5)],
        movers: [mover(4, 0.5, 16, 3.4, 1.0, 0.5, 1, 0, 0, 2.4, 3.6, 0, WOOD)],
        tee: [4, TEE_Y, 3], cup: [4, 0, 27], killY: -6
      },
      {
        name: "Cannon Jump", par: 3,
        boxes: [].concat(
          plat(0, 0, 8, 15, 0, GREEN, "NWE"),
          plat(0, 22, 8, 12, 0, GREEN, "SWE")),
        water: [waterBox(-10, 15, 28, 7, -0.5)],
        boosts: [boostPad(1.5, 11.5, 5, 3, 0, 0, 1, 19, 8)],
        tee: [4, TEE_Y, 3], cup: [4, 0, 29], killY: -6
      },
      {
        name: "Crow's Nest", par: 3,
        boxes: [].concat(
          plat(0, 0, 9, 12, 0, GREEN, "NWE"),
          rampZ(2, 12, 5, 7, 0, 2.8, GREEN, "WE"),
          plat(0.5, 19, 8, 9, 2.8, GREEN, "SWE")),
        water: [waterBox(-10, 12, 30, 18, -0.5)],
        tee: [4.5, TEE_Y, 3], cup: [4.5, 2.8, 24], killY: -6
      },
      {
        name: "The Reef", par: 4,
        boxes: [].concat(
          plat(0, 0, 8, 9, 3, GREEN, "NWE"),
          plat(0.5, 12, 7, 6, 2.1, GREEN, "WE"),
          plat(0.5, 21, 7, 6, 1.2, GREEN, "WE"),
          plat(0, 30, 8, 9, 0.3, GREEN, "SWE")),
        water: [waterBox(-12, 8, 32, 24, -0.4)],
        tee: [4, 3 + BALL_R, 3], cup: [4, 0.3, 35], killY: -6
      },
      {
        name: "Sliding Gates", par: 4,
        boxes: [].concat(
          plat(0, 0, 10, 10, 0, GREEN, "NWE"),
          plat(0, 10, 10, 14, 0, GREEN, "WE"),
          plat(0, 24, 10, 10, 0, GREEN, "SWE")),
        movers: [mover(3, 0.55, 14, 4.4, 1.1, 0.5, 1, 0, 0, 3.0, 3.4, 0, WOOD),
                 mover(7, 0.55, 20, 4.4, 1.1, 0.5, 1, 0, 0, 3.0, 3.4, 1.7, WOOD)],
        cyls: [cyl(5, 29, 0, 0.7, 0.5, RUBBER)],
        tee: [5, TEE_Y, 3], cup: [5, 0, 31]
      },
      {
        name: "Whirlpool", par: 4,
        boxes: [].concat(
          plat(0, 0, 12, 10, 0, GREEN, "NWE"),
          plat(0, 10, 5, 14, 0, GREEN, "W"),
          plat(0, 24, 12, 10, 0, GREEN, "SWE"),
          plat(7, 10, 5, 14, 0, GREEN, "E")),
        water: [waterBox(5, 10, 2, 14, -0.4)],
        wells: [well(6, 0, 17, 4.0, 9, false)],
        tee: [6, TEE_Y, 3], cup: [6, 0, 30], killY: -6
      },
      {
        name: "Broadside", par: 4,
        boxes: [].concat(
          plat(0, 0, 9, 12, 2.6, GREEN, "NWE"),
          rampZ(0, 12, 9, 4, 2.6, 0, GREEN, "WE"),
          plat(0, 16, 9, 8, 0, GREEN, "WE"),
          plat(0, 30, 9, 10, 0, GREEN, "SWE")),
        water: [waterBox(-10, 24, 30, 6, -0.5)],
        boosts: [boostPad(2, 20, 5, 3, 0, 0, 1, 20, 8.5)],
        tee: [4.5, 2.6 + BALL_R, 3], cup: [4.5, 0, 35], killY: -6
      },
      {
        name: "Davy Jones", par: 5,
        boxes: [].concat(
          plat(0, 0, 12, 10, 0, GREEN, "NWE"),
          plat(0.5, 10, 4, 12, 0, GREEN, "W"),
          plat(7.5, 10, 4, 12, 0, GREEN, "E"),
          plat(0, 22, 12, 8, 0, GREEN, "WE"),
          rampZ(3, 30, 6, 6, 0, 2.4, GREEN, "WE"),
          plat(1.5, 36, 9, 9, 2.4, GREEN, "SWE")),
        water: [waterBox(4.5, 10, 3, 12, -0.4), waterBox(-12, 30, 15, 15, -0.4),
                waterBox(9, 30, 15, 15, -0.4)],
        wells: [well(6, 0, 16, 3.2, 8, false)],
        movers: [mover(6, 0.55, 26, 5, 1.1, 0.5, 1, 0, 0, 3.2, 3.8, 0, WOOD)],
        tee: [6, TEE_Y, 3], cup: [6, 2.4, 41], killY: -6
      }
    ]
  },
  {
    id: "orbital", name: "Orbital Deck", theme: "space", icon: "🛰️",
    blurb: "Almost no friction, a long way down, and a hole that pulls harder than the cup.",
    holes: [
      {
        name: "Airlock", par: 2,
        boxes: [].concat(
          plat(0, 0, 7, 12, 0, GREEN, "NWE"),
          plat(0, 12, 7, 10, 0, ICE, "WE"),
          plat(0, 22, 7, 9, 0, GREEN, "SWE")),
        tee: [3.5, TEE_Y, 3], cup: [3.5, 0, 27]
      },
      {
        name: "Low Gravity", par: 3,
        boxes: [].concat(
          plat(0, 0, 8, 10, 0, GREEN, "NWE"),
          rampZ(0, 10, 8, 6, 0, 2.4, ICE, "WE"),
          plat(0, 16, 8, 14, 2.4, ICE, "SWE")),
        cyls: [cyl(2, 24, 2.4, 0.7, 0.5, RUBBER), cyl(6, 21, 2.4, 0.7, 0.5, RUBBER)],
        tee: [4, TEE_Y, 3], cup: [4, 2.4, 27]
      },
      {
        name: "Gravity Well", par: 3,
        boxes: [].concat(
          plat(0, 0, 11, 11, 0, GREEN, "NWE"),
          plat(0, 11, 11, 12, 0, ICE, "WE"),
          plat(0, 23, 11, 10, 0, GREEN, "SWE")),
        wells: [well(3, 0, 17, 4.2, 7, false)],
        tee: [5.5, TEE_Y, 3], cup: [8, 0, 29]
      },
      {
        name: "Wormhole", par: 3,
        boxes: [].concat(
          plat(0, 0, 9, 13, 0, GREEN, "NSWE"),
          plat(0, 22, 9, 13, 2.2, ICE, "NSWE")),
        portals: [portal(4.5, 0, 9.5, 4.5, 2.2, 25.5, 2.1)],
        tee: [4.5, TEE_Y, 3], cup: [4.5, 2.2, 32], killY: -6
      },
      {
        name: "Debris", par: 4,
        boxes: [].concat(
          plat(0, 0, 10, 10, 0, GREEN, "NWE"),
          plat(0, 10, 10, 16, 0, ICE, "WE"),
          plat(0, 26, 10, 9, 0, GREEN, "SWE")),
        cyls: [cyl(3, 15, 0, 0.8, 0.5, RUBBER), cyl(7, 19, 0, 0.8, 0.5, RUBBER),
               cyl(5, 24, 0, 0.8, 0.5, METAL), cyl(2, 22, 0, 0.7, 0.5, METAL)],
        tee: [5, TEE_Y, 3], cup: [5, 0, 31]
      },
      {
        name: "The Gantry", par: 4,
        boxes: [].concat(
          plat(0, 0, 9, 10, 0, GREEN, "NWE"),
          plat(3, 10, 3, 12, 0, METAL, ""),
          plat(0, 22, 9, 7, 0, METAL, "WE"),
          plat(3, 29, 3, 8, 0, METAL, ""),
          plat(0, 37, 9, 9, 0, GREEN, "SWE")),
        tee: [4.5, TEE_Y, 3], cup: [4.5, 0, 42], killY: -10
      },
      {
        name: "Event Horizon", par: 4,
        boxes: [].concat(
          plat(0, 0, 12, 11, 0, GREEN, "NWE"),
          plat(0, 11, 12, 14, 0, ICE, "WE"),
          plat(0, 25, 12, 10, 0, GREEN, "SWE")),
        wells: [well(6, 0, 18, 4.0, 11, true)],
        cyls: [cyl(1.6, 18, 0, 0.7, 0.5, METAL), cyl(10.4, 18, 0, 0.7, 0.5, METAL)],
        tee: [6, TEE_Y, 3], cup: [6, 0, 31]
      },
      {
        name: "Docking Bay", par: 4,
        boxes: [].concat(
          plat(0, 0, 10, 11, 0, GREEN, "NWE"),
          plat(0, 11, 10, 15, 0, ICE, "WE"),
          plat(0, 26, 10, 10, 0, GREEN, "SWE")),
        movers: [mover(3, 0.55, 15, 4.2, 1.1, 0.5, 1, 0, 0, 2.8, 3.4, 0, METAL),
                 mover(7, 0.55, 21, 4.2, 1.1, 0.5, 1, 0, 0, 2.8, 3.4, 1.6, METAL)],
        tee: [5, TEE_Y, 3], cup: [5, 0, 32]
      },
      {
        name: "Deep Orbit", par: 5,
        boxes: [].concat(
          plat(0, 0, 11, 10, 0, GREEN, "NWE"),
          plat(0, 10, 11, 12, 0, ICE, "WE"),
          rampZ(0, 22, 11, 6, 0, 2.6, ICE, "WE"),
          plat(0, 28, 11, 8, 2.6, ICE, "WE"),
          plat(0, 36, 11, 10, 2.6, GREEN, "SWE")),
        wells: [well(2.5, 0, 15, 3.4, 7, false), well(8.5, 0, 31, 3.4, 7, false)],
        spinners: [{ p: [5.5, 3.1, 33], reach: 3.6, thick: 0.18, tall: 0.42, omega: 1.6, phase: 0, blades: 3 }],
        portals: [portal(1.5, 0, 5, 9.5, 0, 19, 1.4)],
        tee: [5.5, TEE_Y, 3], cup: [5.5, 2.6, 41]
      }
    ]
  }
];

/* ------------------------------------------------------------- the themes */

var THEMES = {
  forest: {
    sky: 0x8fc3e8, fog: 0x9fd0ee, fogNear: 40, fogFar: 130,
    grass: [0x54b23f, 0x469a33], side: 0x6b4a2c, rail: 0x7a4f2c, railTop: 0x9b6a3c,
    water: 0x2f7fb5, sand: 0xd8c07a, ice: 0xbfe4ee, metal: 0x8a97a8,
    ground: 0x47823c, sun: 0xfff3d8, amb: 0x9ec7e8, scenery: "pine",
    ink: "#f4f8f0", music: "cozy"
  },
  pirate: {
    sky: 0x63c9dd, fog: 0x7fd6e6, fogNear: 45, fogFar: 150,
    grass: [0x4fb85c, 0x41a04c], side: 0x8a6640, rail: 0x8a6238, railTop: 0xae824c,
    water: 0x1f8fb2, sand: 0xe0cd93, ice: 0xcfe9f2, metal: 0x93a0ae,
    ground: 0x2196b0, sun: 0xfff0d0, amb: 0x8fd6e8, scenery: "sea",
    ink: "#f4f8f2", music: "jungle"
  },
  space: {
    sky: 0x070a16, fog: 0x0a0f20, fogNear: 50, fogFar: 170,
    grass: [0x3f9089, 0x347b75], side: 0x2f3a48, rail: 0x7d8a9c, railTop: 0xa6b4c6,
    water: 0x4a4bd0, sand: 0xc8b48f, ice: 0xcfe6f4, metal: 0x8e9cae,
    ground: 0x05060e, sun: 0xdfe9ff, amb: 0x2a3a6a, scenery: "stars",
    ink: "#eef4fb", music: "ambient"
  }
};

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

/** Bounds of a hole in XZ, used to frame the survey camera. */
function holeBounds(hole) {
  return {
    minX: hole.lo.x, maxX: hole.hi.x, minZ: hole.lo.z, maxZ: hole.hi.z,
    cx: (hole.lo.x + hole.hi.x) / 2, cz: (hole.lo.z + hole.hi.z) / 2,
    cy: (hole.lo.y + hole.hi.y) / 2,
    span: Math.max(hole.hi.x - hole.lo.x, hole.hi.z - hole.lo.z)
  };
}

/* ====================================================================== bit */

window.plethoraBit = {
  meta: {
    title: "Windmill Cove 3D",
    runtime: "plethora-bit@2",
    tags: ["golf", "3d", "game", "sports", "physics", "leaderboard"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    var THREE = null;
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e) {
      var warn = ctx.createRoot({ style: "display:flex;align-items:center;justify-content:center;padding:26px;" });
      warn.innerHTML = '<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
        'color:#eef;text-align:center;font-size:15px;line-height:1.5;">' +
        "Windmill Cove 3D needs the 3D library, which didn't load.<br>" +
        '<span style="opacity:0.7;font-size:13px;">Try reopening the bit.</span></div>';
      ctx.platform.error({ stage: "three-import" });
      ctx.platform.ready();
      return;
    }

    var canvas = ctx.createCanvas({ touchAction: "none" });
    var root = ctx.createRoot({ style: "pointer-events:none;" });

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || 1, 2));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(function () { try { renderer.dispose(); } catch (_) {} });

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(58, Math.max(0.2, ctx.width / ctx.height), 0.15, 500);
    var sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0016;
    scene.add(sun);
    scene.add(sun.target);
    var hemi = new THREE.HemisphereLight(0xffffff, 0x606060, 1.45);
    scene.add(hemi);

    /* -------------------------------------------------------- baked bits */

    var CAN_BAKE = typeof OffscreenCanvas === "function";
    function makeSurface(w, h) {
      if (!CAN_BAKE) return null;
      try { return new OffscreenCanvas(w | 0, h | 0); } catch (_) { return null; }
    }

    var texCache = {};
    /** The mown checkerboard, as a repeating texture. The 2D game's signature. */
    function grassTexture(th) {
      var key = "grass" + th.grass[0];
      if (texCache[key]) return texCache[key];
      var S = 128, cv = makeSurface(S, S);
      var tex;
      if (cv) {
        var c = cv.getContext("2d");
        var a = "#" + th.grass[0].toString(16).padStart(6, "0");
        var b = "#" + th.grass[1].toString(16).padStart(6, "0");
        c.fillStyle = a; c.fillRect(0, 0, S, S);
        c.fillStyle = b; c.fillRect(0, 0, S / 2, S / 2); c.fillRect(S / 2, S / 2, S / 2, S / 2);
        c.fillStyle = "rgba(0,0,0,0.05)";
        for (var i = 0; i < 900; i++) {
          c.fillRect(hash01(i, 3) * S, hash01(i, 4) * S, 1, 2);
        }
        tex = new THREE.CanvasTexture(cv);
      } else {
        tex = null;
      }
      if (tex) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
      }
      texCache[key] = tex;
      return tex;
    }

    /* ---------------------------------------------------- scene assembly */

    var holeGroup = null;
    var CHECK = 2;                          // world size of one mown square

    function matFor(kind, th, topSize) {
      var col, top = null;
      if (kind === GREEN) {
        var t = grassTexture(th);
        if (t) {
          top = t.clone();
          top.needsUpdate = true;
          top.wrapS = top.wrapT = THREE.RepeatWrapping;
          top.repeat.set(Math.max(0.5, topSize.x / CHECK / 2), Math.max(0.5, topSize.z / CHECK / 2));
        }
        col = th.grass[0];
      } else if (kind === SAND) col = th.sand;
      else if (kind === ICE) col = th.ice;
      else if (kind === RUBBER) col = 0xe8556d;
      else if (kind === METAL) col = th.metal;
      else col = th.rail;
      var sideCol = kind === GREEN ? th.side : col;
      var mTop = new THREE.MeshLambertMaterial(top ? { map: top } : { color: col });
      var mSide = new THREE.MeshLambertMaterial({ color: sideCol });
      // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z
      return [mSide, mSide, mTop, mSide, mSide, mSide];
    }

    function addBox(group, b, th) {
      var size = { x: b.s.x * 2, y: b.s.y * 2, z: b.s.z * 2 };
      var geo = new THREE.BoxGeometry(size.x, size.y, size.z);
      var mesh = new THREE.Mesh(geo, matFor(b.m, th, size));
      mesh.position.set(b.p.x, b.p.y, b.p.z);
      mesh.rotation.order = "YXZ";
      mesh.rotation.y = b.yaw || 0;
      mesh.rotation.x = b.tilt || 0;
      mesh.castShadow = b.s.y > 0.3;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    function addCyl(group, c, th) {
      var geo = new THREE.CylinderGeometry(c.r, c.r * 1.06, c.h * 2, 18);
      var col = c.m === RUBBER ? 0xe8556d : c.m === METAL ? th.metal : th.rail;
      var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col }));
      mesh.position.set(c.p.x, c.p.y, c.p.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      if (c.m !== RUBBER) {                 // a lighter cap so posts read as logs
        var cap = new THREE.Mesh(new THREE.CylinderGeometry(c.r * 0.98, c.r * 0.98, 0.06, 18),
          new THREE.MeshLambertMaterial({ color: th.railTop }));
        cap.position.set(c.p.x, c.p.y + c.h, c.p.z);
        group.add(cap);
      }
      return mesh;
    }

    var waterMats = [];
    function addWater(group, w, th) {
      var geo = new THREE.PlaneGeometry(w.max.x - w.min.x, w.max.z - w.min.z, 1, 1);
      var mat = new THREE.MeshLambertMaterial({
        color: th.water, transparent: true, opacity: 0.82
      });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((w.min.x + w.max.x) / 2, w.max.y, (w.min.z + w.max.z) / 2);
      mesh.receiveShadow = true;
      group.add(mesh);
      waterMats.push({ mesh: mesh, base: w.max.y });
      // a darker floor under it so the water reads as depth, not a sheet
      var bed = new THREE.Mesh(
        new THREE.PlaneGeometry(w.max.x - w.min.x, w.max.z - w.min.z),
        new THREE.MeshLambertMaterial({ color: 0x11313f }));
      bed.rotation.x = -Math.PI / 2;
      bed.position.set(mesh.position.x, w.max.y - 1.4, mesh.position.z);
      group.add(bed);
    }

    var flagPivot = null, cupMesh = null;
    function addCup(group, hole, th) {
      var lip = new THREE.Mesh(
        new THREE.CylinderGeometry(CUP_R + 0.16, CUP_R + 0.16, 0.05, 24),
        new THREE.MeshLambertMaterial({ color: 0xefe6cf }));
      lip.position.set(hole.cup.x, hole.cup.y + 0.012, hole.cup.z);
      group.add(lip);
      cupMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(CUP_R, CUP_R, 0.5, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.DoubleSide }));
      cupMesh.position.set(hole.cup.x, hole.cup.y - 0.24, hole.cup.z);
      group.add(cupMesh);
      var floor = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 24),
        new THREE.MeshBasicMaterial({ color: 0x060606 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(hole.cup.x, hole.cup.y - 0.48, hole.cup.z);
      group.add(floor);

      flagPivot = new THREE.Group();
      flagPivot.position.set(hole.cup.x, hole.cup.y, hole.cup.z);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8),
        new THREE.MeshLambertMaterial({ color: 0xffffff }));
      pole.position.y = 1.6; pole.castShadow = true;
      flagPivot.add(pole);
      for (var i = 0; i < 4; i++) {         // barber stripes
        var band = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.32, 8),
          new THREE.MeshLambertMaterial({ color: 0xe0413f }));
        band.position.y = 0.35 + i * 0.8;
        flagPivot.add(band);
      }
      var flag = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.72),
        new THREE.MeshLambertMaterial({ color: 0xe0413f, side: THREE.DoubleSide }));
      flag.position.set(0.63, 2.9, 0);
      flag.castShadow = true;
      flagPivot.add(flag);
      flagPivot.userData.flag = flag;
      group.add(flagPivot);
    }

    var spinMeshes = [], moverMeshes = [], portalMeshes = [], wellMeshes = [];
    function addProps(group, hole, th) {
      var i, j;
      spinMeshes.length = 0; moverMeshes.length = 0;
      portalMeshes.length = 0; wellMeshes.length = 0;

      for (i = 0; i < hole.spinners.length; i++) {
        var sn = hole.spinners[i];
        var hub = new THREE.Group();
        hub.position.set(sn.p.x, sn.p.y, sn.p.z);
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, sn.p.y * 2 + 1.2, 12),
          new THREE.MeshLambertMaterial({ color: th.rail }));
        post.position.y = -0.2; post.castShadow = true;
        hub.add(post);
        for (j = 0; j < sn.blades; j++) {
          var bg = new THREE.BoxGeometry((sn.def ? 1 : 1) * sn.reach, 0.84, 0.36);
          var blade = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ color: 0xf3ece0 }));
          blade.castShadow = true;
          var arm = new THREE.Group();
          blade.position.x = sn.reach / 2;
          arm.add(blade);
          arm.userData.offset = j * TAU / sn.blades;
          hub.add(arm);
        }
        group.add(hub);
        spinMeshes.push({ hub: hub, sn: sn });
      }

      for (i = 0; i < hole.movers.length; i++) {
        var mv = hole.movers[i];
        var mg = new THREE.BoxGeometry(mv.box.s.x * 2, mv.box.s.y * 2, mv.box.s.z * 2);
        var mm = new THREE.Mesh(mg, new THREE.MeshLambertMaterial({
          color: mv.box.m === METAL ? th.metal : th.rail }));
        mm.castShadow = true; mm.receiveShadow = true;
        group.add(mm);
        moverMeshes.push({ mesh: mm, mv: mv });
      }

      for (i = 0; i < hole.portals.length; i++) {
        var pt = hole.portals[i];
        for (j = 0; j < 2; j++) {
          var at = j ? pt.b : pt.a;
          var ring = new THREE.Mesh(new THREE.TorusGeometry(pt.r * 0.8, 0.12, 8, 28),
            new THREE.MeshBasicMaterial({ color: j ? 0xffb347 : 0x8ad8ff }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(at.x, at.y + 0.16, at.z);
          group.add(ring);
          var disc = new THREE.Mesh(new THREE.CircleGeometry(pt.r * 0.8, 24),
            new THREE.MeshBasicMaterial({ color: j ? 0xffdca8 : 0xcbeeff,
              transparent: true, opacity: 0.5 }));
          disc.rotation.x = -Math.PI / 2;
          disc.position.set(at.x, at.y + 0.05, at.z);
          group.add(disc);
          portalMeshes.push(ring);
        }
      }

      for (i = 0; i < hole.wells.length; i++) {
        var wl = hole.wells[i];
        var swirl = new THREE.Mesh(new THREE.RingGeometry(0.5, wl.r, 32, 3),
          new THREE.MeshBasicMaterial({
            color: wl.kills ? 0x9a6cff : 0x7fc4ff, transparent: true,
            opacity: wl.kills ? 0.5 : 0.32, side: THREE.DoubleSide }));
        swirl.rotation.x = -Math.PI / 2;
        swirl.position.set(wl.p.x, wl.p.y + 0.04, wl.p.z);
        group.add(swirl);
        wellMeshes.push(swirl);
        if (wl.kills) {
          var core = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0x08040f }));
          core.position.set(wl.p.x, wl.p.y + 0.3, wl.p.z);
          group.add(core);
        }
      }

      for (i = 0; i < hole.boosts.length; i++) {
        var bo = hole.boosts[i];
        var pad = new THREE.Mesh(
          new THREE.PlaneGeometry(bo.max.x - bo.min.x, bo.max.z - bo.min.z),
          new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.72 }));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set((bo.min.x + bo.max.x) / 2, bo.min.y + 0.63, (bo.min.z + bo.max.z) / 2);
        group.add(pad);
      }
    }

    /** The world beyond the course: what you see when you pull the camera out. */
    function addScenery(group, hole, th) {
      var bb = holeBounds(hole);
      var i, x, z, r;
      if (th.scenery === "stars") {
        var pts = [], N = 900;
        for (i = 0; i < N; i++) {
          var a = hash01(i, 1) * TAU, p2 = Math.acos(2 * hash01(i, 2) - 1), rr = 150 + hash01(i, 3) * 120;
          pts.push(bb.cx + rr * Math.sin(p2) * Math.cos(a),
                   Math.abs(rr * Math.cos(p2)) * 0.5 + 12,
                   bb.cz + rr * Math.sin(p2) * Math.sin(a));
        }
        var pg = new THREE.BufferGeometry();
        pg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        group.add(new THREE.Points(pg, new THREE.PointsMaterial({
          color: 0xffffff, size: 2.2, sizeAttenuation: false })));
        return;
      }
      var ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
        new THREE.MeshLambertMaterial({ color: th.ground }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(bb.cx, -2.2, bb.cz);
      ground.receiveShadow = true;
      group.add(ground);

      if (th.scenery === "pine") {
        var N = 120, dummy = new THREE.Object3D();
        var trunkI = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(0.24, 0.34, 1, 6),
          new THREE.MeshLambertMaterial({ color: 0x3b2417 }), N);
        var tiers = [];
        for (var k2 = 0; k2 < 3; k2++) {
          tiers.push(new THREE.InstancedMesh(
            new THREE.ConeGeometry(1.7 - k2 * 0.42, 1, 7),
            new THREE.MeshLambertMaterial({ color: k2 % 2 ? 0x1c471f : 0x235526 }), N));
        }
        for (i = 0; i < N; i++) {
          var ang = hash01(i, 11) * TAU;
          var rad = bb.span * 0.62 + hash01(i, 12) * bb.span * 1.5;
          x = bb.cx + Math.cos(ang) * rad;
          z = bb.cz + Math.sin(ang) * rad;
          var hgt = 4 + hash01(i, 13) * 6;
          dummy.position.set(x, -2.2 + hgt * 0.17, z);
          dummy.scale.set(1, hgt * 0.34, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          trunkI.setMatrixAt(i, dummy.matrix);
          for (var k3 = 0; k3 < 3; k3++) {
            dummy.position.set(x, -2.2 + hgt * (0.32 + k3 * 0.22), z);
            dummy.scale.set(1, hgt * 0.44, 1);
            dummy.updateMatrix();
            tiers[k3].setMatrixAt(i, dummy.matrix);
          }
        }
        trunkI.instanceMatrix.needsUpdate = true;
        trunkI.castShadow = true;
        group.add(trunkI);
        for (k2 = 0; k2 < 3; k2++) {
          tiers[k2].instanceMatrix.needsUpdate = true;
          tiers[k2].castShadow = true;
          group.add(tiers[k2]);
        }
      } else if (th.scenery === "sea") {
        var sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
          new THREE.MeshLambertMaterial({ color: th.ground }));
        sea.rotation.x = -Math.PI / 2;
        sea.position.set(bb.cx, -0.55, bb.cz);
        group.add(sea);
        var RN = 26, rd = new THREE.Object3D();
        var rockI = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
          new THREE.MeshLambertMaterial({ color: 0x7a6a56 }), RN);
        for (i = 0; i < RN; i++) {
          var a2 = hash01(i, 21) * TAU, r2 = bb.span * 0.8 + hash01(i, 22) * bb.span * 1.2;
          r = 1.2 + hash01(i, 23) * 3;
          rd.position.set(bb.cx + Math.cos(a2) * r2, -0.9 + r * 0.4, bb.cz + Math.sin(a2) * r2);
          rd.rotation.set(hash01(i, 24) * 3, hash01(i, 25) * 3, hash01(i, 26) * 3);
          rd.scale.setScalar(r);
          rd.updateMatrix();
          rockI.setMatrixAt(i, rd.matrix);
        }
        rockI.instanceMatrix.needsUpdate = true;
        rockI.castShadow = true;
        group.add(rockI);
      }
    }

    var ballMesh = null, shadowMesh = null, aimGroup = null, aimShaft = null, aimHead = null;

    function buildBallAndAim(th) {
      ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14),
        new THREE.MeshLambertMaterial({ color: 0xffffff }));
      ballMesh.castShadow = true;
      scene.add(ballMesh);

      shadowMesh = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.5, 18),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
      shadowMesh.rotation.x = -Math.PI / 2;
      scene.add(shadowMesh);

      aimGroup = new THREE.Group();
      aimShaft = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72,
          depthTest: false }));
      aimShaft.rotation.x = -Math.PI / 2;
      aimGroup.add(aimShaft);
      aimHead = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 3),
        new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9,
          depthTest: false }));
      aimHead.rotation.x = -Math.PI / 2;
      aimHead.rotation.z = Math.PI;
      aimGroup.add(aimHead);
      aimGroup.renderOrder = 999;
      scene.add(aimGroup);
    }

    function disposeGroup(g) {
      if (!g) return;
      g.traverse(function (o) {
        if (o.geometry) { try { o.geometry.dispose(); } catch (_) {} }
        if (o.material) {
          var ms = Array.isArray(o.material) ? o.material : [o.material];
          for (var i = 0; i < ms.length; i++) { try { ms[i].dispose(); } catch (_) {} }
        }
      });
      scene.remove(g);
    }

    function buildHoleScene(hole, th) {
      disposeGroup(holeGroup);
      waterMats.length = 0;
      holeGroup = new THREE.Group();
      var i;
      for (i = 0; i < hole.boxes.length; i++) addBox(holeGroup, hole.boxes[i], th);
      for (i = 0; i < hole.cyls.length; i++) addCyl(holeGroup, hole.cyls[i], th);
      for (i = 0; i < hole.water.length; i++) addWater(holeGroup, hole.water[i], th);
      addProps(holeGroup, hole, th);
      addCup(holeGroup, hole, th);
      addScenery(holeGroup, hole, th);
      scene.add(holeGroup);

      scene.background = new THREE.Color(th.sky);
      scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
      hemi.color.setHex(th.sky);
      hemi.groundColor.setHex(th.ground);
      sun.color.setHex(th.sun);
      var bb = holeBounds(hole);
      sun.position.set(bb.cx + 26, 42, bb.cz - 22);
      sun.target.position.set(bb.cx, 0, bb.cz);
      var sc = sun.shadow.camera;
      var ext = Math.max(18, bb.span * 0.75);
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.updateProjectionMatrix();
    }

    /* -------------------------------------------------------- game state */

    var S = {
      screen: "title", courseIx: 0, holeIx: 0, strokes: 0, capped: false,
      card: [], hole: null, th: null, holed: false, moving: false, rollT: 0,
      ball: { p: v3(0, 0, 0), v: v3(0, 0, 0), portalCd: 0, grounded: false },
      safe: v3(0, 0, 0), sinking: 0, sinkKind: "water", t: 0, banner: 0,
      power: 0, charging: false, survey: false
    };
    /** Camera: yaw is also the aim. Looking somewhere and aiming there are one act. */
    var cam = { yaw: 0, pitch: 0.40, dist: 9, tx: 0, ty: 0, tz: 0,
                wantDist: 9, panX: 0, panZ: 0 };
    var ev = {};
    var best = {}, roundSave = null, musicOn = true;

    try {
      if (ctx.capabilities.storage) {
        best = (await ctx.storage.get("best3d")) || {};
        roundSave = await ctx.storage.get("round3d");
        if ((await ctx.storage.get("music3d")) === false) musicOn = false;
      }
    } catch (_) { best = {}; }

    function course() { return COURSES[S.courseIx]; }
    function strokeCap(par) { return par + 5; }
    function saveBest() {
      if (!ctx.capabilities.storage) return;
      try { ctx.storage.set("best3d", best); } catch (_) {}
    }
    function saveRound() {
      var v = (S.screen === "play" || S.screen === "holeEnd")
        ? { c: S.courseIx, h: S.holeIx, card: S.card.slice() } : null;
      roundSave = v;
      if (!ctx.capabilities.storage) return;
      try { ctx.storage.set("round3d", v); } catch (_) {}
    }

    /* ------------------------------------------------------------- audio */

    var ac = null, master = null, noiseBuf = null, audioDead = false, music = null;
    function buildAudio() {
      if (ac || audioDead) return ac;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }
      master = ac.createGain(); master.gain.value = 0.8;
      var comp = ac.createDynamicsCompressor();
      comp.threshold.value = -15; comp.ratio.value = 3.2;
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
    function tone(freq, dur, type, gain, sweep) {
      var a = buildAudio(); if (!a) return;
      var o = a.createOscillator(), g2 = a.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (sweep) o.frequency.exponentialRampToValueAtTime(sweep, a.currentTime + dur);
      g2.gain.setValueAtTime(0.0001, a.currentTime);
      g2.gain.exponentialRampToValueAtTime(gain, a.currentTime + 0.006);
      g2.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g2); g2.connect(master);
      o.start(); o.stop(a.currentTime + dur + 0.02);
    }
    function noise(dur, gain, freq, q, type) {
      var a = buildAudio(); if (!a) return;
      var src = a.createBufferSource(); src.buffer = noiseBuf;
      var f = a.createBiquadFilter();
      f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q || 1;
      var g2 = a.createGain();
      g2.gain.setValueAtTime(gain, a.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      src.connect(f); f.connect(g2); g2.connect(master);
      src.start(); src.stop(a.currentTime + dur + 0.02);
    }
    function sfxPutt(p) {
      var k = clamp(p / MAX_SHOT, 0, 1);
      tone(150 + k * 130, 0.09, "triangle", 0.16 + k * 0.16, 70 + k * 40);
      noise(0.05 + k * 0.03, 0.1 + k * 0.14, 900 + k * 1500, 1.1);
    }
    function sfxHit(imp, mat) {
      var k = clamp(imp / 20, 0, 1);
      if (k < 0.05) return;
      if (mat === RUBBER) { tone(520, 0.13, "sine", 0.13, 900); return; }
      tone(190 + Math.random() * 60, 0.07, "square", 0.03 + k * 0.09, 110);
      noise(0.045, 0.05 + k * 0.11, 1400 + Math.random() * 700, 1.6);
    }
    function sfxSplash() { noise(0.42, 0.24, 700, 0.7, "lowpass"); tone(420, 0.3, "sine", 0.08, 130); }
    function sfxPortal() { tone(320, 0.22, "sine", 0.1, 1500); tone(640, 0.2, "triangle", 0.06, 2400); }
    function sfxBoost() { tone(240, 0.16, "sawtooth", 0.09, 900); }
    function sfxLip() { noise(0.1, 0.1, 1800, 3); tone(700, 0.1, "sine", 0.06, 520); }
    function sfxDrop() {
      noise(0.09, 0.13, 1100, 2.4); tone(300, 0.16, "sine", 0.16, 120);
      ctx.timeout(function () { tone(880, 0.1, "sine", 0.1); }, 70);
      ctx.timeout(function () { tone(1320, 0.16, "sine", 0.09); }, 150);
    }
    function sfxAce() {
      [523, 659, 784, 1046, 1318].forEach(function (n, i) {
        ctx.timeout(function () { tone(n, 0.3, "triangle", 0.13); }, i * 85);
      });
    }
    async function startMusic(theme) {
      if (!musicOn || !ctx.capabilities.backgroundMusic) return;
      var preset = (THEMES[theme] || THEMES.forest).music;
      try {
        await ctx.music.unlock();
        if (music) { await ctx.music.setPreset(preset, { fadeMs: 900 }); return; }
        music = await ctx.music.play({ preset: preset, volume: 0.38, fadeInMs: 1400, intensity: 0.42 });
      } catch (_) { music = null; }
    }
    function stopMusic() { try { ctx.music.stop({ fadeOutMs: 800 }); } catch (_) {} music = null; }
    function haptic(k) {
      if (!ctx.capabilities.haptics) return;
      try { ctx.platform.haptic(k); } catch (_) {}
    }

    /* --------------------------------------------------------- round flow */

    function loadHole(ix) {
      var co = course();
      S.holeIx = ix;
      S.hole = compileHole(co.holes[ix]);
      S.th = THEMES[co.theme] || THEMES.forest;
      S.strokes = 0; S.holed = false; S.moving = false; S.capped = false;
      S.sinking = 0; S.rollT = 0; S.power = 0; S.charging = false; S.survey = false;
      S.ball.p.x = S.hole.tee.x; S.ball.p.y = S.hole.tee.y; S.ball.p.z = S.hole.tee.z;
      S.ball.v.x = S.ball.v.y = S.ball.v.z = 0;
      S.ball.portalCd = 0; S.ball.grounded = false;
      S.safe.x = S.hole.tee.x; S.safe.y = S.hole.tee.y; S.safe.z = S.hole.tee.z;
      buildHoleScene(S.hole, S.th);
      // open looking from the tee toward the cup: aiming starts sensible
      cam.yaw = Math.atan2(S.hole.cup.x - S.hole.tee.x, S.hole.cup.z - S.hole.tee.z);
      cam.pitch = 0.52;
      cam.dist = cam.wantDist = 12.5;
      cam.panX = 0; cam.panZ = 0;
      cam.tx = S.ball.p.x; cam.ty = S.ball.p.y; cam.tz = S.ball.p.z;
      S.banner = 1.6;
      ctx.platform.setProgress(ix / co.holes.length);
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

    function aimDir() { return { x: Math.sin(cam.yaw), z: Math.cos(cam.yaw) }; }

    function strike(power) {
      var d = aimDir();
      S.strokes++;
      S.safe.x = S.ball.p.x; S.safe.y = S.ball.p.y; S.safe.z = S.ball.p.z;
      S.ball.v.x = d.x * power; S.ball.v.z = d.z * power; S.ball.v.y = 0;
      S.moving = true; S.rollT = 0;
      sfxPutt(power);
      haptic(power > MAX_SHOT * 0.66 ? "medium" : "light");
      ctx.platform.interact({ type: "putt", power: Math.round(power) });
      syncHud();
    }

    function afterSettle() {
      syncHud();
      if (S.holed || S.capped) return;
      if (S.strokes >= strokeCap(S.hole.par)) {
        S.capped = true;
        flash("Stroke limit — picked up");
        ctx.timeout(function () {
          if (!S.holed && S.screen === "play") finishHole(strokeCap(S.hole.par));
        }, 700);
      }
    }

    function penalty(kind) {
      S.strokes++;
      S.ball.p.x = S.safe.x; S.ball.p.y = S.safe.y; S.ball.p.z = S.safe.z;
      S.ball.v.x = S.ball.v.y = S.ball.v.z = 0;
      S.ball.portalCd = 0; S.moving = false; S.rollT = 0;
      haptic("warning");
      flash(kind === "water" ? "Water — +1 stroke"
        : kind === "sunk" ? "Swallowed — +1 stroke" : "Out of bounds — +1 stroke");
      afterSettle();
    }

    function finishHole(strokes) {
      S.holed = true; S.moving = false;
      S.card[S.holeIx] = strokes;
      var co = course(), hk = co.id + ":" + S.holeIx;
      if (best[hk] == null || strokes < best[hk]) best[hk] = strokes;
      saveBest(); saveRound();
      if (strokes === 1) { sfxAce(); haptic("success"); }
      else { sfxDrop(); haptic(strokes <= S.hole.par ? "success" : "light"); }
      try { ctx.music.sting(strokes <= S.hole.par ? "success" : "tap"); } catch (_) {}
      ctx.platform.milestone("hole_out", { hole: S.holeIx + 1, strokes: strokes, par: S.hole.par });
      ctx.timeout(function () {
        if (S.screen !== "play") return;
        S.screen = "holeEnd"; showScreen();
      }, 950);
    }

    function nextHole() {
      if (S.card[S.holeIx] == null) {
        S.card[S.holeIx] = Math.max(1, Math.min(S.strokes, strokeCap(S.hole.par)));
      }
      if (S.holeIx + 1 < course().holes.length) {
        S.screen = "play"; loadHole(S.holeIx + 1); saveRound(); showScreen();
      } else endRound();
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
      var co = course(), total = cardTotal(), par = coursePar(co);
      var key = co.id + ":round";
      if (best[key] == null || total < best[key]) { best[key] = total; saveBest(); }
      S.screen = "roundEnd"; saveRound(); showScreen();
      ctx.platform.setScore(total, { par: par, course: co.id });
      ctx.platform.complete({ course: co.id, strokes: total, par: par });
      try { ctx.music.sting(total <= par ? "win" : "success"); } catch (_) {}
      haptic("success");
      try {
        await ctx.memory.record(co.id + "_3d").submit(total, { label: total + " strokes" });
      } catch (_) {}
      loadBoard(co.id);
    }

    /* -------------------------------------------------- camera + controls */

    function applyCamera() {
      var cp = Math.cos(cam.pitch), sp2 = Math.sin(cam.pitch);
      camera.position.set(
        cam.tx - Math.sin(cam.yaw) * cam.dist * cp,
        cam.ty + cam.dist * sp2 + 0.6,
        cam.tz - Math.cos(cam.yaw) * cam.dist * cp
      );
      camera.lookAt(cam.tx, cam.ty + 0.55, cam.tz);
    }

    var pointers = {};
    var pinchStart = 0, pinchDist0 = 0, panStart = null;

    function pointerList() {
      var out = [];
      for (var k in pointers) if (pointers.hasOwnProperty(k)) out.push(pointers[k]);
      return out;
    }

    ctx.listen(canvas, "pointerdown", function (e) {
      resumeAudio();
      if (S.screen !== "play") return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY };
      var ps = pointerList();
      if (ps.length === 2) {
        pinchDist0 = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
        pinchStart = cam.dist;
        panStart = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2,
                     px: cam.panX, pz: cam.panZ };
      }
    }, { passive: false });

    ctx.listen(canvas, "pointermove", function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      e.preventDefault();
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      var ps = pointerList();
      if (ps.length === 1) {
        // one finger orbits — and orbiting is aiming
        cam.yaw -= dx * 0.006;
        cam.pitch = clamp(cam.pitch + dy * 0.005, 0.14, 1.40);
      } else if (ps.length >= 2 && panStart) {
        var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
        cam.wantDist = cam.dist = clamp(pinchStart * (pinchDist0 / d), 3.5, 90);
        var mx = (ps[0].x + ps[1].x) / 2, my = (ps[0].y + ps[1].y) / 2;
        var k = cam.dist * 0.0022;
        var fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
        cam.panX = panStart.px - (mx - panStart.x) * k * fz - (my - panStart.y) * k * fx;
        cam.panZ = panStart.pz + (mx - panStart.x) * k * fx - (my - panStart.y) * k * fz;
        S.survey = true;
      }
    }, { passive: false });

    function dropPointer(e) {
      delete pointers[e.pointerId];
      if (pointerList().length < 2) panStart = null;
    }
    ctx.listen(canvas, "pointerup", dropPointer);
    ctx.listen(canvas, "pointercancel", dropPointer);
    ctx.listen(canvas, "lostpointercapture", dropPointer);

    /* ------------------------------------------------------------- the UI */

    var FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
    var PANEL = "background:linear-gradient(180deg,rgba(18,22,20,0.95),rgba(10,13,11,0.97));" +
      "border:1px solid rgba(255,255,255,0.14);border-radius:20px;padding:18px;" +
      "box-shadow:0 18px 44px rgba(0,0,0,0.5);color:#f4f7ef;";
    var BTN = "pointer-events:auto;border:0;cursor:pointer;border-radius:13px;padding:12px 16px;" +
      FONT + "font-size:15px;font-weight:800;background:#5bbf4a;color:#08210a;";
    var BTN2 = "pointer-events:auto;border:1px solid rgba(255,255,255,0.2);cursor:pointer;" +
      "border-radius:13px;padding:11px 15px;" + FONT +
      "font-size:14px;font-weight:700;background:rgba(20,26,22,0.62);color:#eef3e9;";

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

    var hud = divEl("position:absolute;left:0;right:0;top:0;pointer-events:none;" +
      "padding:" + (6 + ctx.safeArea.top) + "px 10px 0;");
    root.appendChild(hud);
    var hudTop = divEl("display:flex;align-items:center;gap:8px;");
    hud.appendChild(hudTop);
    var btnBack = btnEl(BTN2 + "padding:7px 11px;font-size:13px;border-radius:11px;", "☰");
    var hudTitle = divEl("flex:1;min-width:0;font-size:14.5px;font-weight:800;color:#fff;" +
      "text-shadow:0 2px 6px rgba(0,0,0,0.8);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;");
    var btnHelp = btnEl(BTN2 + "padding:7px 11px;font-size:13px;border-radius:11px;", "?");
    var btnBoard = btnEl(BTN2 + "padding:7px 11px;font-size:13px;border-radius:11px;", "🏆");
    hudTop.appendChild(btnBack); hudTop.appendChild(hudTitle);
    hudTop.appendChild(btnHelp); hudTop.appendChild(btnBoard);

    var hudRow = divEl("display:flex;align-items:center;gap:8px;margin-top:7px;");
    hud.appendChild(hudRow);
    var chip = "font-size:12.5px;font-weight:800;letter-spacing:0.4px;background:rgba(0,0,0,0.5);" +
      "border-radius:9px;padding:4px 9px;text-shadow:0 1px 3px rgba(0,0,0,0.9);";
    var hudPar = divEl(chip);
    var hudPips = divEl("flex:1;display:flex;gap:3px;justify-content:center;");
    var hudStrokes = divEl(chip);
    hudRow.appendChild(hudPar); hudRow.appendChild(hudPips); hudRow.appendChild(hudStrokes);

    function syncHud() {
      if (!S.hole) return;
      var co = course();
      hudTitle.textContent = co.icon + "  " + co.name + " · " + (S.holeIx + 1) + "/" + co.holes.length;
      hudPar.textContent = "PAR " + S.hole.par;
      hudStrokes.textContent = "SHOTS " + S.strokes +
        (S.strokes > S.hole.par ? " (" + relPar(S.strokes - S.hole.par) + ")" : "");
      var pips = "";
      for (var i = 0; i < co.holes.length; i++) {
        var v = S.card[i];
        var bg = i === S.holeIx ? "#ffd23f" : v == null ? "rgba(255,255,255,0.25)"
          : v < co.holes[i].par ? "#5bbf4a" : v === co.holes[i].par ? "#cfd8c8" : "#d8734a";
        pips += '<div style="width:12px;height:5px;border-radius:3px;background:' + bg + ';"></div>';
      }
      hudPips.innerHTML = pips;
    }

    var toast = divEl("position:absolute;left:0;right:0;top:44%;text-align:center;" +
      "pointer-events:none;opacity:0;transition:opacity 0.25s;");
    root.appendChild(toast);
    var toastT = 0;
    function flash(msg) {
      toast.innerHTML = '<span style="display:inline-block;background:rgba(8,11,9,0.88);' +
        "border:1px solid rgba(255,255,255,0.18);border-radius:13px;padding:9px 15px;" +
        'font-size:14.5px;font-weight:800;color:#fff;">' + esc(msg) + "</span>";
      toast.style.opacity = "1"; toastT = 1.6;
    }

    /* ---- the shot control: press, slide up for power, release to strike ---- */

    var padWrap = divEl("position:absolute;right:14px;bottom:" + (18 + ctx.safeArea.bottom) +
      "px;display:flex;align-items:flex-end;gap:9px;pointer-events:none;");
    root.appendChild(padWrap);

    var meterOuter = divEl("width:16px;height:132px;border-radius:9px;overflow:hidden;" +
      "background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.22);" +
      "display:flex;align-items:flex-end;");
    var meterFill = divEl("width:100%;height:0%;background:#8ef07a;transition:height 0.04s linear;");
    meterOuter.appendChild(meterFill);
    padWrap.appendChild(meterOuter);

    var shotPad = btnEl("pointer-events:auto;border:0;cursor:pointer;width:96px;height:96px;" +
      "border-radius:50%;" + FONT + "font-size:14px;font-weight:900;color:#08210a;" +
      "background:radial-gradient(circle at 34% 30%,#8ef07a,#4fae3c);" +
      "box-shadow:0 8px 22px rgba(0,0,0,0.45);touch-action:none;", "SHOT");
    padWrap.appendChild(shotPad);

    var leftPad = divEl("position:absolute;left:14px;bottom:" + (18 + ctx.safeArea.bottom) +
      "px;display:flex;flex-direction:column;gap:8px;pointer-events:none;");
    root.appendChild(leftPad);
    var btnSurvey = btnEl(BTN2 + "padding:10px 12px;font-size:13px;", "🔭 Survey");
    var btnCenter = btnEl(BTN2 + "padding:10px 12px;font-size:13px;", "🎯 Ball");
    leftPad.appendChild(btnSurvey); leftPad.appendChild(btnCenter);

    var padStart = null;
    function canShoot() {
      return S.screen === "play" && !S.moving && !S.holed && S.sinking <= 0;
    }
    ctx.listen(shotPad, "pointerdown", function (e) {
      resumeAudio();
      if (!canShoot()) return;
      e.preventDefault(); e.stopPropagation();
      try { shotPad.setPointerCapture(e.pointerId); } catch (_) {}
      padStart = { x: e.clientX, y: e.clientY, yaw: cam.yaw };
      S.charging = true; S.power = 0;
      ctx.platform.start();
    }, { passive: false });
    ctx.listen(shotPad, "pointermove", function (e) {
      if (!S.charging || !padStart) return;
      e.preventDefault();
      S.power = clamp((padStart.y - e.clientY) / 150, 0, 1);
      cam.yaw = padStart.yaw - (e.clientX - padStart.x) * 0.0045;   // fine aim
      meterFill.style.height = (S.power * 100).toFixed(0) + "%";
      meterFill.style.background = S.power > 0.85 ? "#ff5a4d" : S.power > 0.6 ? "#ffc23f" : "#8ef07a";
    }, { passive: false });
    function releasePad(e) {
      if (!S.charging) return;
      S.charging = false;
      var p = S.power; S.power = 0;
      meterFill.style.height = "0%";
      if (!canShoot()) return;
      if (p < 0.04) { flash("Slide up from the pad to set power"); return; }
      strike(p * MAX_SHOT);
    }
    ctx.listen(shotPad, "pointerup", releasePad);
    ctx.listen(shotPad, "pointercancel", function () { S.charging = false; meterFill.style.height = "0%"; });

    ctx.listen(btnSurvey, "click", function () {
      if (!S.hole) return;
      haptic("light");
      S.survey = !S.survey;
      if (S.survey) {
        var bb = holeBounds(S.hole);
        cam.wantDist = clamp(bb.span * 1.5, 18, 90);
        cam.panX = bb.cx - S.ball.p.x; cam.panZ = bb.cz - S.ball.p.z;
        cam.pitch = 0.98;
      } else { cam.wantDist = 12.5; cam.panX = 0; cam.panZ = 0; cam.pitch = 0.52; }
    });
    ctx.listen(btnCenter, "click", function () {
      haptic("light");
      S.survey = false; cam.wantDist = 12.5; cam.panX = 0; cam.panZ = 0; cam.pitch = 0.52;
    });

    /* ---- panels ---------------------------------------------------------- */

    var titlePanel = divEl("position:absolute;inset:0;display:none;flex-direction:column;" +
      "align-items:center;justify-content:center;pointer-events:auto;color:#f4f7ef;" +
      "background:linear-gradient(180deg,rgba(6,12,8,0.30) 0%,rgba(6,12,8,0.62) 46%," +
      "rgba(5,9,6,0.88) 100%);" +
      "padding:" + (20 + ctx.safeArea.top) + "px 22px " + (24 + ctx.safeArea.bottom) + "px;");
    root.appendChild(titlePanel);

    var titleArt = divEl("text-align:center;margin-bottom:26px;text-shadow:0 3px 18px rgba(0,0,0,0.7);",
      '<div style="font-size:13px;font-weight:800;letter-spacing:3px;opacity:0.7;">MINI GOLF</div>' +
      '<div style="font-size:42px;font-weight:900;letter-spacing:-1.2px;line-height:1.02;' +
      'margin-top:6px;">Windmill<br>Cove <span style="color:#8ef07a;">3D</span></div>' +
      '<div style="opacity:0.78;font-size:13.5px;margin-top:12px;line-height:1.5;">' +
      "Look around the hole, line it up,<br>and hit it. Three courses, 27 holes.</div>");
    titlePanel.appendChild(titleArt);

    var titleBtns = divEl("display:flex;flex-direction:column;gap:10px;width:100%;max-width:260px;");
    titlePanel.appendChild(titleBtns);
    var btnPlay = btnEl(BTN + "width:100%;padding:16px;font-size:18px;border-radius:16px;" +
      "box-shadow:0 10px 26px rgba(0,0,0,0.4);", "Play");
    var btnResume = btnEl(BTN2 + "width:100%;padding:13px;font-size:14.5px;border-radius:14px;", "");
    var btnHowTitle = btnEl(BTN2 + "width:100%;padding:13px;font-size:14.5px;border-radius:14px;",
      "How to play");
    var btnMusicTitle = btnEl(BTN2 + "width:100%;padding:11px;font-size:13px;border-radius:14px;" +
      "opacity:0.85;", "Music: on");
    titleBtns.appendChild(btnPlay);
    titleBtns.appendChild(btnResume);
    titleBtns.appendChild(btnHowTitle);
    titleBtns.appendChild(btnMusicTitle);

    function syncTitle() {
      if (roundSave && COURSES[roundSave.c] && roundSave.h > 0) {
        btnResume.style.display = "block";
        btnResume.textContent = "Continue · " + COURSES[roundSave.c].name +
          " hole " + (roundSave.h + 1);
      } else btnResume.style.display = "none";
      btnMusicTitle.textContent = "Music: " + (musicOn ? "on" : "off");
    }
    ctx.listen(btnPlay, "click", function () {
      resumeAudio(); haptic("light"); ctx.platform.start();
      S.screen = "menu"; buildMenu(); showScreen();
    });
    ctx.listen(btnResume, "click", function () {
      resumeAudio(); haptic("light"); ctx.platform.start();
      var rs = roundSave; roundSave = null;
      if (rs) startRound(rs.c, rs.card, rs.h);
    });
    ctx.listen(btnHowTitle, "click", function () {
      haptic("light"); helpPanel.style.display = "flex";
    });

    var menuPanel = divEl("position:absolute;inset:0;display:none;flex-direction:column;" +
      "pointer-events:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;color:#f4f7ef;" +
      "background:linear-gradient(180deg,rgba(9,14,10,0.94),rgba(6,9,7,0.97));" +
      "padding:" + (16 + ctx.safeArea.top) + "px 14px " + (18 + ctx.safeArea.bottom) + "px;");
    root.appendChild(menuPanel);
    var menuHead = divEl("display:flex;align-items:center;gap:10px;margin-bottom:14px;");
    menuPanel.appendChild(menuHead);
    var btnMenuBack = btnEl(BTN2 + "padding:9px 13px;font-size:15px;border-radius:12px;", "‹");
    menuHead.appendChild(btnMenuBack);
    menuHead.appendChild(divEl("flex:1;text-align:center;padding-right:38px;",
      '<div style="font-size:21px;font-weight:900;letter-spacing:-0.4px;">Choose a course</div>' +
      '<div style="opacity:0.6;font-size:12px;margin-top:2px;">Nine holes each</div>'));
    ctx.listen(btnMenuBack, "click", function () {
      haptic("light"); S.screen = "title"; showScreen();
    });
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
        var par = coursePar(co), bst = best[co.id + ":round"];
        var th = THEMES[co.theme];
        var card = divEl("pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:12px;" +
          "padding:13px 14px;border-radius:16px;color:#f2f6ee;border:1px solid rgba(255,255,255,0.13);" +
          "background:linear-gradient(120deg,#" + th.sky.toString(16).padStart(6, "0") +
          "44,#" + th.ground.toString(16).padStart(6, "0") + "cc);",
          '<div style="font-size:27px;line-height:1;">' + co.icon + "</div>" +
          '<div style="flex:1;min-width:0;"><div style="font-size:16.5px;font-weight:850;">' +
          esc(co.name) + "</div>" +
          '<div style="opacity:0.78;font-size:12px;margin-top:2px;line-height:1.35;">' +
          esc(co.blurb) + "</div></div>" +
          '<div style="text-align:right;font-size:11.5px;"><div style="font-weight:800;">Par ' +
          par + '</div><div style="opacity:0.75;margin-top:2px;">' +
          (bst != null ? "Best " + bst : "—") + "</div></div>");
        ctx.listen(card, "click", function () {
          resumeAudio(); haptic("light"); ctx.platform.start(); startRound(i);
        });
        menuList.appendChild(card);
      });
    }

    var holeEnd = divEl("position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:20px;pointer-events:auto;" +
      "background:linear-gradient(180deg,rgba(6,10,7,0.3),rgba(6,10,7,0.74));");
    root.appendChild(holeEnd);
    var holeEndBox = divEl(PANEL + "width:100%;max-width:300px;text-align:center;");
    holeEnd.appendChild(holeEndBox);
    function showHoleEnd() {
      var strokes = S.card[S.holeIx], par = S.hole.par, d = strokes - par;
      var col = d < 0 ? "#7fe06a" : d === 0 ? "#eef3e9" : "#ff9a6a";
      var tot = cardTotal(), parSoFar = 0;
      for (var i = 0; i <= S.holeIx; i++) parSoFar += course().holes[i].par;
      holeEndBox.innerHTML =
        '<div style="font-size:12px;opacity:0.6;font-weight:800;letter-spacing:1px;">HOLE ' +
        (S.holeIx + 1) + "</div>" +
        '<div style="font-size:26px;font-weight:900;margin:5px 0 2px;color:' + col + ';">' +
        esc(scoreName(strokes, par)) + "</div>" +
        '<div style="font-size:14px;opacity:0.8;">' + strokes + " shot" + (strokes === 1 ? "" : "s") +
        " · par " + par + "</div>" +
        '<div style="margin:13px 0 3px;font-size:13px;opacity:0.85;">Round: <b>' + tot +
        "</b> (" + relPar(tot - parSoFar) + ")</div>";
      var row = divEl("display:flex;gap:8px;margin-top:14px;");
      var nx = btnEl(BTN + "flex:1;", S.holeIx + 1 < course().holes.length ? "Next hole" : "Finish round");
      ctx.listen(nx, "click", function () { haptic("light"); nextHole(); });
      var rp = btnEl(BTN2, "Replay");
      ctx.listen(rp, "click", function () {
        haptic("light"); S.screen = "play"; loadHole(S.holeIx); showScreen();
      });
      row.appendChild(rp); row.appendChild(nx);
      holeEndBox.appendChild(row);
    }

    var roundEnd = divEl("position:absolute;inset:0;display:none;flex-direction:column;" +
      "pointer-events:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;color:#f3f7ee;" +
      "background:linear-gradient(180deg,rgba(7,11,8,0.96),rgba(5,8,6,0.98));" +
      "padding:" + (16 + ctx.safeArea.top) + "px 14px " + (18 + ctx.safeArea.bottom) + "px;");
    root.appendChild(roundEnd);
    var roundBox = divEl(""); roundEnd.appendChild(roundBox);
    var boardBox = divEl("margin-top:12px;"); roundEnd.appendChild(boardBox);
    var roundBtns = divEl("display:flex;gap:8px;margin-top:14px;"); roundEnd.appendChild(roundBtns);

    function showRoundEnd() {
      var co = course(), par = coursePar(co), tot = cardTotal(), rows = "";
      for (var i = 0; i < co.holes.length; i++) {
        var v = S.card[i] || 0, p = co.holes[i].par, d = v - p;
        var c2 = d < 0 ? "#7fe06a" : d === 0 ? "#dfe6d8" : "#ff9a6a";
        rows += '<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:9px;' +
          "background:rgba(255,255,255," + (i % 2 ? "0.05" : "0.02") + ');">' +
          '<div style="width:22px;opacity:0.6;font-size:12px;font-weight:800;">' + (i + 1) + "</div>" +
          '<div style="flex:1;font-size:13px;opacity:0.9;">' + esc(co.holes[i].name) + "</div>" +
          '<div style="width:34px;text-align:right;font-size:12px;opacity:0.55;">par ' + p + "</div>" +
          '<div style="width:30px;text-align:right;font-size:14.5px;font-weight:850;color:' + c2 +
          ';">' + v + "</div></div>";
      }
      roundBox.innerHTML =
        '<div style="text-align:center;margin-bottom:12px;">' +
        '<div style="font-size:12px;opacity:0.6;font-weight:800;letter-spacing:1px;">ROUND COMPLETE</div>' +
        '<div style="font-size:26px;font-weight:900;margin-top:3px;">' + co.icon + " " + esc(co.name) + "</div>" +
        '<div style="font-size:38px;font-weight:900;margin-top:6px;line-height:1;">' + tot + "</div>" +
        '<div style="font-size:14px;opacity:0.8;margin-top:2px;">' + relPar(tot - par) + " · par " + par + "</div>" +
        (best[co.id + ":round"] === tot
          ? '<div style="margin-top:7px;font-size:12.5px;color:#ffd23f;font-weight:800;">★ New personal best</div>'
          : '<div style="margin-top:7px;font-size:12.5px;opacity:0.6;">Best ' + best[co.id + ":round"] + "</div>") +
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
        (e.user && (e.user.name || e.user.displayName || e.user.handle)) ||
        (bSelf(e) ? "You" : "Golfer");
    };
    var bVal = function (e) {
      return e.label || e.formatted || e.valueLabel || e.display ||
        (e.value != null ? String(e.value) : "—");
    };
    var bRank = function (e, i) { return e.rank != null ? e.rank : (e.position != null ? e.position : i + 1); };
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
      var html = top.map(function (e, i) { return boardRow(bRank(e, i), bName(e), bVal(e), bSelf(e)); }).join("");
      var me = (lb && (lb.you || lb.self || lb.viewer || lb.me)) || arr.filter(bSelf)[0];
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
        '<div style="opacity:0.55;font-size:11.5px;margin-bottom:10px;">' + esc(co.name) +
        " · global · all time</div>";
      boardBox.innerHTML = head + '<div style="opacity:0.6;font-size:13px;padding:12px 0;text-align:center;">Loading…</div>';
      var inner;
      try {
        inner = renderBoard(await ctx.memory.record(courseId + "_3d")
          .leaderboard({ scope: "global", period: "all_time" }));
      } catch (_) {
        inner = '<div style="opacity:0.7;text-align:center;padding:14px 0;font-size:13px;">' +
          "The board isn't reachable right now.</div>";
      }
      boardBox.innerHTML = head + inner;
    }

    var boardPanel = divEl("position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:20px;pointer-events:auto;background:rgba(5,8,6,0.7);");
    root.appendChild(boardPanel);
    var boardCard = divEl(PANEL + "width:100%;max-width:320px;max-height:80%;overflow-y:auto;");
    boardPanel.appendChild(boardCard);
    async function openBoard() {
      var co = course();
      boardPanel.style.display = "flex"; haptic("light");
      var head = '<div style="font-size:16px;font-weight:850;margin-bottom:2px;">🏆 ' + esc(co.name) + "</div>" +
        '<div style="opacity:0.55;font-size:11.5px;margin-bottom:11px;">Fewest strokes · global · all time</div>';
      boardCard.innerHTML = head + '<div style="opacity:0.6;font-size:13px;padding:12px 0;text-align:center;">Loading…</div>';
      var inner;
      try {
        inner = renderBoard(await ctx.memory.record(co.id + "_3d")
          .leaderboard({ scope: "global", period: "all_time" }));
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

    var helpPanel = divEl("position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:20px;pointer-events:auto;background:rgba(5,8,6,0.72);");
    root.appendChild(helpPanel);
    var helpCard = divEl(PANEL + "width:100%;max-width:330px;max-height:84%;overflow-y:auto;",
      '<div style="font-size:18px;font-weight:900;margin-bottom:9px;">How to play</div>' +
      '<div style="font-size:13.5px;line-height:1.62;opacity:0.92;">' +
      "• <b>Drag one finger</b> to swing the camera around the ball. Where you look is where you aim — the arrow on the ground is your line.<br>" +
      "• <b>Pinch</b> to zoom out and survey the hole, pinch back in to line up. <b>Two fingers</b> pan the view.<br>" +
      "• <b>🔭 Survey</b> jumps to a view of the whole hole; <b>🎯 Ball</b> snaps back.<br>" +
      "• <b>Press the SHOT pad and slide up</b> for power — the bar fills green → amber → red. Slide sideways to fine-tune the aim. Release to hit.<br>" +
      "• Ramps are real: too soft and you roll back down, hard enough and you fly off the lip.<br>" +
      "• <b>Water and falling off cost one stroke</b> and put you back where you played from.<br>" +
      "• Sand kills roll, ice barely slows you, gold pads fire you on, and windmill blades throw the ball.<br>" +
      "• Fewest strokes over nine holes. Your round goes to the course leaderboard." +
      "</div>");
    helpPanel.appendChild(helpCard);
    var helpClose = btnEl(BTN + "width:100%;margin-top:14px;", "Got it");
    helpCard.appendChild(helpClose);
    ctx.listen(helpClose, "click", function () { helpPanel.style.display = "none"; });
    ctx.listen(helpPanel, "click", function (e) {
      if (e.target === helpPanel) helpPanel.style.display = "none";
    });

    function showScreen() {
      var p = S.screen === "play";
      hud.style.display = (p || S.screen === "holeEnd") ? "block" : "none";
      padWrap.style.display = p ? "flex" : "none";
      leftPad.style.display = p ? "flex" : "none";
      titlePanel.style.display = S.screen === "title" ? "flex" : "none";
      menuPanel.style.display = S.screen === "menu" ? "flex" : "none";
      holeEnd.style.display = S.screen === "holeEnd" ? "flex" : "none";
      roundEnd.style.display = S.screen === "roundEnd" ? "flex" : "none";
      if (S.screen === "holeEnd") showHoleEnd();
      if (S.screen === "roundEnd") { showRoundEnd(); roundEnd.scrollTop = 0; }
      if (S.screen === "menu") { menuPanel.scrollTop = 0; stopMusic(); }
      if (S.screen === "title") { syncTitle(); stopMusic(); }
      syncHud();
    }

    ctx.listen(btnBack, "click", function () {
      haptic("light"); saveRound();
      S.screen = "menu"; buildMenu(); showScreen();
    });
    ctx.listen(btnHelp, "click", function () { haptic("light"); helpPanel.style.display = "flex"; });
    ctx.listen(btnHow2, "click", function () { haptic("light"); helpPanel.style.display = "flex"; });
    ctx.listen(btnBoard, "click", function () { openBoard(); });
    ctx.listen(btnMusic, "click", function () {
      musicOn = !musicOn;
      btnMusic.textContent = "Music: " + (musicOn ? "on" : "off");
      if (!musicOn) stopMusic(); else if (S.screen === "play") startMusic(course().theme);
      btnMusicTitle.textContent = "Music: " + (musicOn ? "on" : "off");
      if (ctx.capabilities.storage) { try { ctx.storage.set("music3d", musicOn); } catch (_) {} }
      haptic("light");
    });
    ctx.listen(btnMusicTitle, "click", function () {
      musicOn = !musicOn;
      btnMusicTitle.textContent = "Music: " + (musicOn ? "on" : "off");
      btnMusic.textContent = "Music: " + (musicOn ? "on" : "off");
      if (!musicOn) stopMusic();
      if (ctx.capabilities.storage) { try { ctx.storage.set("music3d", musicOn); } catch (_) {} }
      haptic("light");
    });

    var banner = divEl("position:absolute;left:0;right:0;top:38%;text-align:center;" +
      "pointer-events:none;opacity:0;transition:opacity 0.3s;");
    root.appendChild(banner);
    function showBanner() {
      if (!S.hole) return;
      banner.innerHTML = '<div style="display:inline-block;background:rgba(6,10,7,0.86);' +
        "border:1px solid rgba(255,255,255,0.2);border-radius:15px;padding:11px 20px;" +
        'box-shadow:0 10px 28px rgba(0,0,0,0.45);">' +
        '<div style="font-size:10.5px;font-weight:800;letter-spacing:1.2px;opacity:0.65;color:#fff;">HOLE ' +
        (S.holeIx + 1) + "  ·  PAR " + S.hole.par + "</div>" +
        '<div style="font-size:20px;font-weight:900;color:#fff;margin-top:3px;">' +
        esc(S.hole.name) + "</div></div>";
      banner.style.opacity = "1";
    }

    /* --------------------------------------------------------- the frame */

    var settle = 0, lastW = 0, lastH = 0, lastGroundY = 0;
    var _q = new THREE.Quaternion(), _ax = new THREE.Vector3();

    function update(dt) {
      S.t += dt;
      if (S.banner > 0) {
        if (S.banner === 1.6) showBanner();
        S.banner -= dt;
        if (S.banner <= 0) banner.style.opacity = "0";
      }
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toast.style.opacity = "0"; }

      if (S.sinking > 0) {
        S.sinking -= dt;
        if (S.sinking <= 0) penalty(S.sinkKind);
      } else if (S.screen === "play" && S.hole && !S.holed && S.moving) {
        S.rollT += dt;
        if (S.rollT > 14) { S.ball.v.x = S.ball.v.y = S.ball.v.z = 0; }
        stepBall(S.hole, S.ball, dt, S.t, ev);

        if (ev.impact > 1.0) sfxHit(ev.impact, ev.mat);
        if (ev.impact > 7) haptic("light");
        if (ev.boost) sfxBoost();
        if (ev.portal) sfxPortal();
        if (ev.lip) { sfxLip(); haptic("warning"); }

        if (ev.holed) { finishHole(S.strokes); }
        else if (ev.water || ev.out || ev.sunk) {
          S.moving = false;
          S.sinking = 0.45;
          S.sinkKind = ev.sunk ? "sunk" : ev.water ? "water" : "out";
          if (ev.water) sfxSplash();
          if (ev.sunk) sfxPortal();
        } else {
          if (S.ball.grounded) lastGroundY = S.ball.p.y - BALL_R;
          if (S.ball.grounded && vlen(S.ball.v) === 0) {
            settle += dt;
            if (settle > 0.12) { settle = 0; S.moving = false; afterSettle(); }
          } else settle = 0;
        }
      }

      if (S.screen === "title") {
        cam.yaw += dt * 0.075;
        cam.wantDist = 21;
        cam.pitch = 0.46;
        var tb = holeBounds(S.hole);
        cam.tx = lerp(cam.tx, tb.cx, 1 - Math.pow(0.2, dt));
        cam.ty = lerp(cam.ty, tb.cy + 1.2, 1 - Math.pow(0.2, dt));
        cam.tz = lerp(cam.tz, tb.cz, 1 - Math.pow(0.2, dt));
        cam.dist = lerp(cam.dist, cam.wantDist, 1 - Math.pow(0.15, dt));
        applyCamera();
        return;
      }

      // camera: follow the ball unless the player has panned away
      var tx = S.ball.p.x + cam.panX, ty = S.ball.p.y + (S.survey ? 1.5 : 0), tz = S.ball.p.z + cam.panZ;
      var k = S.moving ? 1 - Math.pow(0.001, dt) : 1 - Math.pow(0.02, dt);
      cam.tx = lerp(cam.tx, tx, k);
      cam.ty = lerp(cam.ty, ty, k);
      cam.tz = lerp(cam.tz, tz, k);
      cam.dist = lerp(cam.dist, cam.wantDist, 1 - Math.pow(0.02, dt));
      applyCamera();
    }

    function syncMeshes(dt) {
      if (!S.hole) return;
      var i, j;
      for (i = 0; i < spinMeshes.length; i++) {
        var sm = spinMeshes[i];
        var base = sm.sn.omega * S.t + sm.sn.phase;
        for (j = 1; j < sm.hub.children.length; j++) {
          var arm = sm.hub.children[j];
          if (arm.userData.offset == null) continue;
          arm.rotation.y = base + arm.userData.offset;
        }
      }
      for (i = 0; i < moverMeshes.length; i++) {
        var mm = moverMeshes[i];
        moverAt(mm.mv, S.t);
        mm.mesh.position.set(mm.mv.box.p.x, mm.mv.box.p.y, mm.mv.box.p.z);
      }
      for (i = 0; i < waterMats.length; i++) {
        waterMats[i].mesh.position.y = waterMats[i].base + Math.sin(S.t * 1.3 + i) * 0.035;
      }
      for (i = 0; i < portalMeshes.length; i++) portalMeshes[i].rotation.z += dt * 1.6;
      for (i = 0; i < wellMeshes.length; i++) wellMeshes[i].rotation.z -= dt * 1.1;
      if (flagPivot) {
        var fl = flagPivot.userData.flag;
        if (fl) { fl.rotation.y = Math.sin(S.t * 2.2) * 0.22; fl.position.x = 0.63; }
      }

      if (ballMesh) {
        ballMesh.visible = S.screen !== "title" && !S.holed && S.sinking <= 0;
        ballMesh.position.set(S.ball.p.x, S.ball.p.y, S.ball.p.z);
        var sp = hlen(S.ball.v);
        if (sp > 0.01) {                       // roll the ball as it travels
          _ax.set(S.ball.v.z, 0, -S.ball.v.x).normalize();
          _q.setFromAxisAngle(_ax, (sp * dt) / BALL_R);
          ballMesh.quaternion.premultiply(_q);
        }
        shadowMesh.visible = ballMesh.visible;
        shadowMesh.position.set(S.ball.p.x, lastGroundY + 0.02, S.ball.p.z);
        var drop = clamp((S.ball.p.y - BALL_R - lastGroundY) / 3, 0, 1);
        shadowMesh.material.opacity = 0.3 * (1 - drop * 0.75);
        shadowMesh.scale.setScalar(1 + drop * 0.9);
      }

      if (aimGroup) {
        var show = S.screen === "play" && !S.moving && !S.holed && S.sinking <= 0;
        if (S.screen === "title") show = false;
        aimGroup.visible = show;
        if (show) {
          var pw = S.charging ? S.power : 0.34;
          var len = 1.6 + pw * 9;
          aimGroup.position.set(S.ball.p.x, lastGroundY + 0.06, S.ball.p.z);
          aimGroup.rotation.y = cam.yaw;
          aimShaft.scale.set(1, len, 1);
          aimShaft.position.set(0, 0, len / 2);
          aimHead.position.set(0, 0, len + 0.42);
          var col = pw > 0.85 ? 0xff5a4d : pw > 0.6 ? 0xffc23f : 0x8ef07a;
          aimHead.material.color.setHex(col);
          aimShaft.material.opacity = S.charging ? 0.85 : 0.5;
        }
      }
    }

    ctx.onFrame(function (dtMs) {
      var dt = Math.min(dtMs, 34) / 1000;
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width; lastH = ctx.height;
        renderer.setSize(ctx.width, ctx.height, false);
        camera.aspect = Math.max(0.2, ctx.width / ctx.height);
        camera.updateProjectionMatrix();
      }
      update(dt);
      syncMeshes(dt);
      renderer.render(scene, camera);
    });

    /* -------------------------------------------------------------- boot */

    buildBallAndAim(THEMES.forest);
    S.hole = compileHole(COURSES[0].holes[0]);
    S.th = THEMES.forest;
    buildHoleScene(S.hole, S.th);
    S.ball.p.x = S.hole.tee.x; S.ball.p.y = S.hole.tee.y; S.ball.p.z = S.hole.tee.z;
    cam.yaw = Math.atan2(S.hole.cup.x - S.hole.tee.x, S.hole.cup.z - S.hole.tee.z);
    cam.tx = S.ball.p.x; cam.ty = S.ball.p.y; cam.tz = S.ball.p.z;
    cam.dist = cam.wantDist = 21; cam.pitch = 0.46;
    applyCamera();
    renderer.render(scene, camera);

    buildMenu();
    showScreen();
    ctx.markVisualReady("clubhouse");
    ctx.platform.ready();
  }
};
