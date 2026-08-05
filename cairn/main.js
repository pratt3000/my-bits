/**
 * Cairn — zen rock balancing.
 *
 * Stack real stones on a plinth in shallow water. Each stone is a procedurally
 * generated convex polygon with its own silhouette, texture, density, friction
 * and voice, simulated by a small purpose-built 2D rigid-body engine (SAT +
 * reference-face clipping + warm-started sequential impulses, Box2D-Lite
 * architecture). No 2D rigid-body library exists in the Plethora registry —
 * ammo.js and oimo are 3D and Phaser 4's Arcade physics is AABB-only with no
 * rotation — and irregular polygon-on-polygon contact is the whole mechanic
 * here, so the solver is written in-file.
 *
 * The feel is the point. You hold a stone from wherever you touched it, so it
 * hangs from your finger like a real one. Press it down into the tower and the
 * force runs all the way to the plinth: the stack gives, settles, or shoves
 * over. Let go and it wobbles. A second finger steadies a stone lower down,
 * the way your other hand does in real life.
 *
 * Three modes (Zen / Tide / Storm), one global leaderboard each.
 */
window.plethoraBit = {
  meta: {
    title: "Cairn",
    runtime: "plethora-bit@2",
    tags: ["zen", "physics", "balance", "relaxing", "game", "sensory"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ====================================================================== //
    // Small helpers                                                          //
    // ====================================================================== //
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const TAU = Math.PI * 2;

    // shortest signed difference between two angles
    function angDiff(target, current) {
      let d = (target - current) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    }

    const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
    const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const vmul = (a, s) => ({ x: a.x * s, y: a.y * s });
    const vdot = (a, b) => a.x * b.x + a.y * b.y;
    const vcross = (a, b) => a.x * b.y - a.y * b.x;          // scalar z
    const vcrossSV = (s, v) => ({ x: -s * v.y, y: s * v.x }); // scalar × vector
    const vlen = (a) => Math.hypot(a.x, a.y);
    const vnorm = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };

    // ====================================================================== //
    // 2D rigid-body physics                                                  //
    // ====================================================================== //
    // World units are metres, +y is up. Gravity 9.8 m/s². Stones are 0.2–0.6 m
    // across, which puts every quantity in the well-conditioned range an
    // impulse solver likes.

    const GRAVITY = -9.8;
    const SUBSTEP = 1 / 140;        // fixed physics tick
    const MAX_SUBSTEPS = 5;
    const ITERATIONS = 16;          // solver relaxation passes
    const SLOP = 0.0016;            // allowed penetration before correction
    const BAUMGARTE = 0.22;         // positional drift correction factor

    let bodySeq = 1;

    /** A convex-polygon rigid body. `verts` is CCW and gets recentred on the centroid. */
    class Body {
      constructor(verts, opts) {
        opts = opts || {};
        this.id = bodySeq++;
        this.local = verts;
        this.n = verts.length;
        this.pos = { x: 0, y: 0 };
        this.angle = 0;
        this.cos = 1; this.sin = 0;
        this.vel = { x: 0, y: 0 };
        this.angVel = 0;
        this.force = { x: 0, y: 0 };
        this.torque = 0;
        this.friction = opts.friction != null ? opts.friction : 0.8;
        this.restitution = opts.restitution != null ? opts.restitution : 0.015;
        this.linDamp = opts.linDamp != null ? opts.linDamp : 0.22;
        this.angDamp = opts.angDamp != null ? opts.angDamp : 0.45;
        this.kinematic = !!opts.kinematic;
        this.steadied = false;      // a finger is resting on it
        this.world = new Array(this.n);
        this.wnormals = new Array(this.n);
        this.localNormals = new Array(this.n);

        if (this.kinematic) {
          this.mass = 0; this.invMass = 0; this.inertia = 0; this.invI = 0;
          this.computeLocalNormals();
        } else {
          this.computeMass(opts.density != null ? opts.density : 2.6);
        }
        // bounding radius, for broadphase and spawn placement
        this.radius = 0;
        for (const v of this.local) this.radius = Math.max(this.radius, Math.hypot(v.x, v.y));
        this.restAngles = restAnglesFor(this.local, this.localNormals);
        this.sync();
      }

      computeLocalNormals() {
        for (let i = 0; i < this.n; i++) {
          const a = this.local[i], b = this.local[(i + 1) % this.n];
          const e = vsub(b, a);
          // CCW winding ⇒ outward normal is (e.y, -e.x)
          this.localNormals[i] = vnorm({ x: e.y, y: -e.x });
        }
      }

      /** Polygon area, centroid and second moment; recentres verts on the centroid. */
      computeMass(density) {
        let area = 0, I = 0;
        const c = { x: 0, y: 0 };
        for (let i = 0; i < this.n; i++) {
          const p1 = this.local[i], p2 = this.local[(i + 1) % this.n];
          const d = vcross(p1, p2);
          const triArea = 0.5 * d;
          area += triArea;
          c.x += (p1.x + p2.x) * (triArea / 3);
          c.y += (p1.y + p2.y) * (triArea / 3);
          const ix2 = p1.x * p1.x + p2.x * p1.x + p2.x * p2.x;
          const iy2 = p1.y * p1.y + p2.y * p1.y + p2.y * p2.y;
          I += (0.25 / 3 * d) * (ix2 + iy2);
        }
        c.x /= area; c.y /= area;
        for (let i = 0; i < this.n; i++) this.local[i] = vsub(this.local[i], c);
        this.area = area;
        this.mass = density * area;
        this.invMass = this.mass > 0 ? 1 / this.mass : 0;
        this.inertia = density * I - this.mass * vdot(c, c);
        this.invI = this.inertia > 0 ? 1 / this.inertia : 0;
        this.computeLocalNormals();
      }

      /** Refresh world-space verts, normals and AABB from pos/angle. */
      sync() {
        const c = Math.cos(this.angle), s = Math.sin(this.angle);
        this.cos = c; this.sin = s;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (let i = 0; i < this.n; i++) {
          const v = this.local[i];
          const x = this.pos.x + v.x * c - v.y * s;
          const y = this.pos.y + v.x * s + v.y * c;
          this.world[i] = { x, y };
          if (x < minx) minx = x;
          if (y < miny) miny = y;
          if (x > maxx) maxx = x;
          if (y > maxy) maxy = y;
          const nl = this.localNormals[i];
          this.wnormals[i] = { x: nl.x * c - nl.y * s, y: nl.x * s + nl.y * c };
        }
        this.minx = minx; this.miny = miny; this.maxx = maxx; this.maxy = maxy;
      }

      toWorld(lp) {
        return {
          x: this.pos.x + lp.x * this.cos - lp.y * this.sin,
          y: this.pos.y + lp.x * this.sin + lp.y * this.cos
        };
      }

      toLocal(wp) {
        const d = vsub(wp, this.pos);
        return { x: d.x * this.cos + d.y * this.sin, y: -d.x * this.sin + d.y * this.cos };
      }

      /** Farthest world vertex along `dir`. */
      support(dir) {
        let best = -Infinity, bv = this.world[0];
        for (let i = 0; i < this.n; i++) {
          const d = this.world[i].x * dir.x + this.world[i].y * dir.y;
          if (d > best) { best = d; bv = this.world[i]; }
        }
        return bv;
      }

      containsPoint(p) {
        for (let i = 0; i < this.n; i++) {
          if (vdot(this.wnormals[i], vsub(p, this.world[i])) > 0) return false;
        }
        return true;
      }

      /** Distance from a world point to the polygon (0 when inside). */
      distanceTo(p) {
        if (this.containsPoint(p)) return 0;
        let best = Infinity;
        for (let i = 0; i < this.n; i++) {
          const a = this.world[i], b = this.world[(i + 1) % this.n];
          const ab = vsub(b, a);
          const t = clamp(vdot(vsub(p, a), ab) / (vdot(ab, ab) || 1), 0, 1);
          best = Math.min(best, vlen(vsub(p, vadd(a, vmul(ab, t)))));
        }
        return best;
      }
    }

    /**
     * Angles at which this shape would sit flat on one of its own faces, with a
     * weight for how broad that face is. Used by the placement assist.
     */
    function restAnglesFor(verts, normals) {
      const out = [];
      let longest = 0;
      const n = verts.length;
      for (let i = 0; i < n; i++) {
        const len = vlen(vsub(verts[(i + 1) % n], verts[i]));
        if (len > longest) longest = len;
      }
      for (let i = 0; i < n; i++) {
        const len = vlen(vsub(verts[(i + 1) % n], verts[i]));
        if (len < longest * 0.42) continue;      // ignore slivers
        const nl = normals[i];
        // rotate so this face's normal points straight down
        out.push({ angle: -Math.PI / 2 - Math.atan2(nl.y, nl.x), w: len / longest });
      }
      return out;
    }

    // ---- narrowphase: SAT + reference-face clipping -----------------------

    function leastPenetration(A, B) {
      let best = -Infinity, bestI = 0;
      for (let i = 0; i < A.n; i++) {
        const nrm = A.wnormals[i];
        const s = B.support({ x: -nrm.x, y: -nrm.y });
        const d = vdot(nrm, vsub(s, A.world[i]));
        if (d > best) { best = d; bestI = i; }
      }
      return { d: best, i: bestI };
    }

    function incidentFace(inc, refNormal) {
      let best = Infinity, bi = 0;
      for (let i = 0; i < inc.n; i++) {
        const d = vdot(refNormal, inc.wnormals[i]);
        if (d < best) { best = d; bi = i; }
      }
      return bi;
    }

    /** Clip a segment against the half-plane dot(n, x) <= c. */
    function clipSegment(n, c, p0, p1) {
      const out = [];
      const d0 = vdot(n, p0) - c;
      const d1 = vdot(n, p1) - c;
      if (d0 <= 0) out.push(p0);
      if (d1 <= 0) out.push(p1);
      if (d0 * d1 < 0 && out.length < 2) {
        const a = d0 / (d0 - d1);
        out.push(vadd(p0, vmul(vsub(p1, p0), a)));
      }
      return out;
    }

    /** Contact manifold between two convex polygons; normal points A → B. */
    function collide(A, B) {
      const fa = leastPenetration(A, B);
      if (fa.d >= 0) return null;
      const fb = leastPenetration(B, A);
      if (fb.d >= 0) return null;

      // pick the shallower axis as the reference face, with a small bias toward
      // A so the choice does not flip frame to frame (which would throw away
      // warm-start impulses and make stacks buzz)
      let ref, inc, refIdx, flip;
      if (fa.d >= fb.d * 0.98 + 1e-4) { ref = A; inc = B; refIdx = fa.i; flip = false; }
      else { ref = B; inc = A; refIdx = fb.i; flip = true; }

      const refNormal = ref.wnormals[refIdx];
      const v1 = ref.world[refIdx];
      const v2 = ref.world[(refIdx + 1) % ref.n];
      const side = vnorm(vsub(v2, v1));

      const incIdx = incidentFace(inc, refNormal);
      let p0 = inc.world[incIdx];
      let p1 = inc.world[(incIdx + 1) % inc.n];

      let cl = clipSegment({ x: -side.x, y: -side.y }, -vdot(side, v1), p0, p1);
      if (cl.length < 2) return null;
      cl = clipSegment(side, vdot(side, v2), cl[0], cl[1]);
      if (cl.length < 2) return null;

      const refC = vdot(refNormal, v1);
      const normal = flip ? { x: -refNormal.x, y: -refNormal.y } : refNormal;
      const points = [];
      for (let i = 0; i < 2; i++) {
        const sep = vdot(refNormal, cl[i]) - refC;
        if (sep <= 0) {
          points.push({
            p: cl[i],
            sep,
            // stable feature id so impulses survive across frames
            id: ((refIdx * 32 + incIdx) * 4 + i) * 2 + (flip ? 1 : 0),
            Pn: 0, Pt: 0
          });
        }
      }
      return points.length ? { normal, points } : null;
    }

    // ---- contact constraint (one per touching pair) -----------------------

    class Arbiter {
      constructor(a, b) {
        this.a = a; this.b = b;
        this.points = [];
        this.normal = { x: 0, y: 1 };
        this.friction = Math.sqrt(a.friction * b.friction);
        this.restitution = Math.min(a.restitution, b.restitution);
        this.fresh = true;         // pair only just started touching
        this.slide = 0;            // tangential speed, drives the grinding sound
      }

      /** Merge a new manifold in, carrying accumulated impulses across by feature id. */
      update(man) {
        this.normal = man.normal;
        for (const np of man.points) {
          for (const op of this.points) {
            if (op.id === np.id) { np.Pn = op.Pn; np.Pt = op.Pt; break; }
          }
        }
        this.points = man.points;
      }

      preStep(invDt) {
        const a = this.a, b = this.b, n = this.normal;
        const t = { x: n.y, y: -n.x };
        this.tangent = t;
        this.slide = 0;
        for (const c of this.points) {
          c.r1 = vsub(c.p, a.pos);
          c.r2 = vsub(c.p, b.pos);
          const rn1 = vcross(c.r1, n), rn2 = vcross(c.r2, n);
          c.massNormal = 1 / (a.invMass + b.invMass + a.invI * rn1 * rn1 + b.invI * rn2 * rn2);
          const rt1 = vcross(c.r1, t), rt2 = vcross(c.r2, t);
          c.massTangent = 1 / (a.invMass + b.invMass + a.invI * rt1 * rt1 + b.invI * rt2 * rt2);
          c.bias = -BAUMGARTE * invDt * Math.min(0, c.sep + SLOP);

          const dv = vsub(
            vadd(b.vel, vcrossSV(b.angVel, c.r2)),
            vadd(a.vel, vcrossSV(a.angVel, c.r1))
          );
          this.slide = Math.max(this.slide, Math.abs(vdot(dv, t)));
          // stones barely bounce; only give restitution to genuine impacts
          const vn = vdot(dv, n);
          c.bounce = vn < -0.6 ? -this.restitution * vn : 0;

          // warm start
          const P = { x: n.x * c.Pn + t.x * c.Pt, y: n.y * c.Pn + t.y * c.Pt };
          applyImpulse(a, c.r1, vmul(P, -1));
          applyImpulse(b, c.r2, P);
        }
      }

      solve() {
        const a = this.a, b = this.b, n = this.normal, t = this.tangent;
        for (const c of this.points) {
          // normal
          let dv = vsub(
            vadd(b.vel, vcrossSV(b.angVel, c.r2)),
            vadd(a.vel, vcrossSV(a.angVel, c.r1))
          );
          const vn = vdot(dv, n);
          let dPn = c.massNormal * (-vn + c.bias + c.bounce);
          const oldPn = c.Pn;
          c.Pn = Math.max(oldPn + dPn, 0);
          dPn = c.Pn - oldPn;
          let P = vmul(n, dPn);
          applyImpulse(a, c.r1, vmul(P, -1));
          applyImpulse(b, c.r2, P);

          // friction, clamped to the Coulomb cone of the current normal impulse
          dv = vsub(
            vadd(b.vel, vcrossSV(b.angVel, c.r2)),
            vadd(a.vel, vcrossSV(a.angVel, c.r1))
          );
          const vt = vdot(dv, t);
          let dPt = c.massTangent * -vt;
          const maxPt = this.friction * c.Pn;
          const oldPt = c.Pt;
          c.Pt = clamp(oldPt + dPt, -maxPt, maxPt);
          dPt = c.Pt - oldPt;
          P = vmul(t, dPt);
          applyImpulse(a, c.r1, vmul(P, -1));
          applyImpulse(b, c.r2, P);
        }
      }
    }

    function applyImpulse(body, r, P) {
      if (body.invMass === 0) return;
      body.vel.x += P.x * body.invMass;
      body.vel.y += P.y * body.invMass;
      body.angVel += body.invI * vcross(r, P);
    }

    // ---- soft grab constraint (the hand) ----------------------------------
    // A point on the stone is pulled toward the finger by a bounded force. The
    // bound is what makes pressing feel real: lean gently and the tower takes
    // it, lean too hard and you run out of hand before the tower gives.

    class Grab {
      constructor(body, localAnchor, maxForce) {
        this.body = body;
        this.local = localAnchor;
        this.maxForce = maxForce;
        this.target = body.toWorld(localAnchor);
        this.P = { x: 0, y: 0 };
        this.angTarget = null;      // set while two fingers are twisting
      }

      preStep(invDt) {
        const b = this.body;
        const r = { x: this.local.x * b.cos - this.local.y * b.sin,
                    y: this.local.x * b.sin + this.local.y * b.cos };
        this.r = r;
        const im = b.invMass, ii = b.invI;
        const k11 = im + ii * r.y * r.y;
        const k12 = -ii * r.x * r.y;
        const k22 = im + ii * r.x * r.x;
        const det = k11 * k22 - k12 * k12;
        const invDet = det !== 0 ? 1 / det : 0;
        this.m11 = k22 * invDet;
        this.m12 = -k12 * invDet;
        this.m22 = k11 * invDet;

        const p = vadd(b.pos, r);
        // soft positional bias — 0.22 keeps the stone lagging the finger just
        // enough to feel like weight rather than a cursor
        this.bias = vmul(vsub(p, this.target), 0.22 * invDt);

        applyImpulse(b, r, this.P);
      }

      solve(dt) {
        const b = this.body;
        const cdot = vadd(b.vel, vcrossSV(b.angVel, this.r));
        const rhs = vmul(vadd(cdot, this.bias), -1);
        let imp = { x: this.m11 * rhs.x + this.m12 * rhs.y,
                    y: this.m12 * rhs.x + this.m22 * rhs.y };
        const old = this.P;
        this.P = vadd(this.P, imp);
        const maxImp = this.maxForce * dt;
        const mag = vlen(this.P);
        if (mag > maxImp) this.P = vmul(this.P, maxImp / mag);
        imp = vsub(this.P, old);
        applyImpulse(b, this.r, imp);

        // direct angular control while two fingers are twisting
        if (this.angTarget != null) {
          const d = angDiff(this.angTarget, b.angle);
          b.angVel += clamp(d * 26 - b.angVel * 5.5, -34, 34) * dt;
        }
      }

      /**
       * How hard you are leaning on the stone, 0..1+. This is the gap the stone
       * cannot close between its grip point and your finger: while it hangs free
       * it catches up and the gap is ~0, but once it is resting on the cairn and
       * you keep pulling down, the gap opens in proportion to the press. That is
       * the same signal your hand reads in real life.
       */
      load() {
        const p = this.body.toWorld(this.local);
        return clamp((p.y - this.target.y) / 0.055, 0, 1.4);
      }
    }

    // ---- world ------------------------------------------------------------

    class World {
      constructor() {
        this.bodies = [];
        this.arbiters = new Map();
        this.grabs = [];
        this.gravity = { x: 0, y: GRAVITY };
        this.wind = 0;
        this.impacts = [];       // consumed by the audio layer each frame
        this.slide = 0;          // loudest ongoing scrape
      }

      add(b) { this.bodies.push(b); return b; }

      remove(b) {
        const i = this.bodies.indexOf(b);
        if (i >= 0) this.bodies.splice(i, 1);
        for (const [k, arb] of this.arbiters) {
          if (arb.a === b || arb.b === b) this.arbiters.delete(k);
        }
        this.grabs = this.grabs.filter((g) => g.body !== b);
      }

      broadphase() {
        const bs = this.bodies;
        const seen = new Set();
        for (let i = 0; i < bs.length; i++) {
          for (let j = i + 1; j < bs.length; j++) {
            const a = bs[i], b = bs[j];
            if (a.invMass === 0 && b.invMass === 0) continue;
            if (a.maxx < b.minx || b.maxx < a.minx || a.maxy < b.miny || b.maxy < a.miny) continue;
            const key = a.id * 100000 + b.id;
            const man = collide(a, b);
            if (!man) continue;
            seen.add(key);
            let arb = this.arbiters.get(key);
            if (!arb) {
              arb = new Arbiter(a, b);
              // record the impact speed before the solver eats it
              const p = man.points[0].p;
              const dv = vsub(
                vadd(b.vel, vcrossSV(b.angVel, vsub(p, b.pos))),
                vadd(a.vel, vcrossSV(a.angVel, vsub(p, a.pos)))
              );
              this.impacts.push({ a, b, speed: Math.abs(vdot(dv, man.normal)), p });
              this.arbiters.set(key, arb);
            } else {
              arb.fresh = false;
            }
            arb.update(man);
          }
        }
        for (const k of Array.from(this.arbiters.keys())) {
          if (!seen.has(k)) this.arbiters.delete(k);
        }
      }

      step(dt) {
        this.broadphase();

        // integrate forces
        for (const b of this.bodies) {
          if (b.invMass === 0) continue;
          b.vel.x += (this.gravity.x + (b.force.x + this.wind * b.area) * b.invMass) * dt;
          b.vel.y += (this.gravity.y + b.force.y * b.invMass) * dt;
          b.angVel += b.torque * b.invI * dt;
          const ld = b.steadied ? 9 : b.linDamp;
          const ad = b.steadied ? 12 : b.angDamp;
          const k = 1 / (1 + dt * ld);
          b.vel.x *= k; b.vel.y *= k;
          b.angVel *= 1 / (1 + dt * ad);
        }

        const invDt = 1 / dt;
        for (const [, arb] of this.arbiters) arb.preStep(invDt);
        for (const g of this.grabs) g.preStep(invDt);

        for (let it = 0; it < ITERATIONS; it++) {
          for (const [, arb] of this.arbiters) arb.solve();
          for (const g of this.grabs) g.solve(dt);
        }

        // integrate velocities (kinematic bodies move on their scripted velocity)
        for (const b of this.bodies) {
          b.pos.x += b.vel.x * dt;
          b.pos.y += b.vel.y * dt;
          b.angle += b.angVel * dt;
          b.force.x = 0; b.force.y = 0; b.torque = 0;
          b.sync();
        }

        this.slide = 0;
        for (const [, arb] of this.arbiters) this.slide = Math.max(this.slide, arb.slide);
      }

      /** Peak motion across dynamic bodies — used to decide when a tower is at rest. */
      energy() {
        let m = 0;
        for (const b of this.bodies) {
          if (b.invMass === 0) continue;
          m = Math.max(m, vlen(b.vel) + Math.abs(b.angVel) * 0.11);
        }
        return m;
      }
    }

    // ====================================================================== //
    // Stones                                                                 //
    // ====================================================================== //

    const ROCK_TYPES = [
      {
        id: "river", name: "River Stone", friction: 0.86, density: 2.6, value: 1.0,
        pts: [11, 14], wide: 1.22, tall: 0.70, jitter: 0.06, texture: "mottle",
        pal: { base: "#9aa4b1", light: "#dbe2ea", dark: "#616a78", accent: "#818b99" },
        snd: { f: 300, q: 3.2, decay: 0.11, gain: 0.8 }
      },
      {
        id: "slate", name: "Slate", friction: 0.93, density: 2.85, value: 0.85,
        pts: [7, 9], wide: 1.62, tall: 0.32, jitter: 0.05, texture: "strata",
        pal: { base: "#6f7684", light: "#aab3c1", dark: "#414753", accent: "#8a92a1" },
        snd: { f: 520, q: 5.5, decay: 0.16, gain: 0.9 }
      },
      {
        id: "granite", name: "Granite", friction: 0.80, density: 2.72, value: 1.2,
        pts: [8, 11], wide: 1.0, tall: 0.88, jitter: 0.12, texture: "speckle",
        pal: { base: "#b0a79c", light: "#eae1d5", dark: "#726960", accent: "#c9b7a4" },
        snd: { f: 420, q: 4, decay: 0.13, gain: 0.85 }
      },
      {
        id: "basalt", name: "Basalt", friction: 0.71, density: 3.0, value: 1.55,
        pts: [5, 7], wide: 0.88, tall: 1.06, jitter: 0.19, texture: "facet",
        pal: { base: "#535865", light: "#8f96a5", dark: "#31353d", accent: "#6b7180" },
        snd: { f: 640, q: 6, decay: 0.1, gain: 0.9 }
      },
      {
        id: "sand", name: "Sandstone", friction: 0.89, density: 2.25, value: 1.0,
        pts: [9, 11], wide: 1.12, tall: 0.64, jitter: 0.09, texture: "band",
        pal: { base: "#d3af80", light: "#f6e2be", dark: "#a37c4d", accent: "#e5c396" },
        snd: { f: 235, q: 2.4, decay: 0.09, gain: 0.7 }
      },
      {
        id: "quartz", name: "Quartz", friction: 0.55, density: 2.65, value: 1.9,
        pts: [6, 8], wide: 0.94, tall: 0.84, jitter: 0.15, texture: "crystal",
        pal: { base: "#e4dfef", light: "#ffffff", dark: "#b3aac8", accent: "#f6eefa" },
        snd: { f: 910, q: 8, decay: 0.22, gain: 0.75 }
      },
      {
        id: "obsidian", name: "Obsidian", friction: 0.43, density: 2.5, value: 2.2,
        pts: [6, 8], wide: 0.98, tall: 0.92, jitter: 0.17, texture: "gloss",
        pal: { base: "#2e2c39", light: "#787292", dark: "#16151c", accent: "#9d92bd" },
        snd: { f: 790, q: 7, decay: 0.19, gain: 0.8 }
      },
      {
        id: "moss", name: "Moss Stone", friction: 0.99, density: 2.6, value: 1.3,
        pts: [11, 14], wide: 1.16, tall: 0.74, jitter: 0.07, texture: "moss",
        pal: { base: "#8e988a", light: "#c2ccba", dark: "#5b6459", accent: "#84a259" },
        snd: { f: 255, q: 2.2, decay: 0.085, gain: 0.65 }
      },
      {
        id: "plinth", name: "Plinth", friction: 0.95, density: 3.0, value: 0,
        pts: [4, 4], wide: 1, tall: 1, jitter: 0, texture: "strata",
        pal: { base: "#4a5361", light: "#77839a", dark: "#242a35", accent: "#5f6b7e" },
        snd: { f: 340, q: 4, decay: 0.14, gain: 0.9 }
      }
    ];
    const TYPE_BY_ID = {};
    for (const t of ROCK_TYPES) TYPE_BY_ID[t.id] = t;

    function convexHull(pts) {
      const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
      if (p.length < 3) return p;
      const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      const lower = [];
      for (const q of p) {
        while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
        lower.push(q);
      }
      const upper = [];
      for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
        upper.push(q);
      }
      lower.pop(); upper.pop();
      return lower.concat(upper);      // CCW
    }

    /** Irregular convex silhouette in the personality of `type`. */
    function makeShape(type, scale) {
      const n = rndInt(type.pts[0], type.pts[1]);
      const raw = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd(-0.22, 0.22);
        const r = scale * (1 + rnd(-type.jitter, type.jitter) * 2.2);
        raw.push({ x: Math.cos(a) * r * type.wide, y: Math.sin(a) * r * type.tall });
      }
      let hull = convexHull(raw);
      // drop near-duplicates, which would give degenerate face normals
      const out = [];
      for (const p of hull) {
        if (!out.length || vlen(vsub(p, out[out.length - 1])) > scale * 0.06) out.push(p);
      }
      if (out.length > 1 && vlen(vsub(out[0], out[out.length - 1])) < scale * 0.06) out.pop();
      return out.length >= 3 ? out : hull;
    }

    // Texture bake resolution: stones are drawn from a pre-rendered sprite so the
    // per-frame cost is one drawImage regardless of how detailed the rock is.
    const REF_PPM = 300;
    const TEX_PAD = 10;

    /**
     * An offscreen drawing surface. The runtime owns every canvas in the DOM
     * (ctx.createCanvas is for display surfaces), so bakes go to an
     * OffscreenCanvas. If the WebView has no OffscreenCanvas we return null and
     * every bake site falls back to drawing live — plainer, but never blank.
     */
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function makeSurface(w, h) {
      if (!CAN_BAKE) return null;
      try { return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0)); }
      catch (_) { return null; }
    }

    function bakeStone(rock) {
      const t = rock.type, verts = rock.body.local;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const v of verts) {
        minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x);
        miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y);
      }
      const W = Math.ceil((maxx - minx) * REF_PPM) + TEX_PAD * 2;
      const H = Math.ceil((maxy - miny) * REF_PPM) + TEX_PAD * 2;
      const ox = -minx * REF_PPM + TEX_PAD;
      const oy = maxy * REF_PPM + TEX_PAD;

      const cv = makeSurface(W, H);
      if (!cv) { rock.tex = null; rock.shadow = null; return; }   // live-draw fallback
      const g = cv.getContext("2d");
      const px = (v) => ({ x: ox + v.x * REF_PPM, y: oy - v.y * REF_PPM });
      const poly = verts.map(px);

      const path = () => {
        g.beginPath();
        g.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
        g.closePath();
      };

      g.save();
      path();
      g.clip();

      // base shading, lit from the upper left
      const lg = g.createLinearGradient(0, 0, W * 0.75, H);
      lg.addColorStop(0, t.pal.light);
      lg.addColorStop(0.30, t.pal.base);
      lg.addColorStop(0.74, t.pal.base);
      lg.addColorStop(1, t.pal.dark);
      g.fillStyle = lg;
      g.fillRect(0, 0, W, H);

      paintTexture(g, t, W, H, rock.seed);

      // fine grain
      g.globalAlpha = 1;
      for (let i = 0; i < (W * H) / 26; i++) {
        const a = rnd(0.02, 0.07);
        g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255," + a + ")" : "rgba(0,0,0," + a + ")";
        g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
      }

      // Skylight: outdoor stone catches cool light on its upper faces.
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "rgba(214,232,255,0.20)");
      sky.addColorStop(0.55, "rgba(214,232,255,0)");
      sky.addColorStop(1, "rgba(20,24,38,0.16)");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);

      // Ambient occlusion hugging the rim. The stroke width has to scale with
      // the stone or a wide brush swallows a small stone whole.
      g.lineJoin = "round";
      const aoMax = Math.min(24, Math.min(W, H) * 0.30);
      const aoStep = Math.max(1.5, aoMax / 9);
      for (let w = aoMax; w > 0; w -= aoStep) {
        g.strokeStyle = "rgba(0,0,0,0.042)";
        g.lineWidth = w;
        path();
        g.stroke();
      }
      g.restore();

      // per-edge rim: bright where the face turns toward the light, dark away
      const light = vnorm({ x: -0.55, y: 0.83 });
      for (let i = 0; i < verts.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const nl = rock.body.localNormals[i];
        const d = vdot(nl, light);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.lineWidth = 2.4;
        g.strokeStyle = d > 0
          ? "rgba(255,255,255," + (0.10 + 0.26 * d).toFixed(3) + ")"
          : "rgba(0,0,0," + (0.10 + 0.24 * -d).toFixed(3) + ")";
        g.stroke();
      }

      rock.tex = cv;
      rock.texOx = ox;
      rock.texOy = oy;

      // soft contact shadow, baked once
      const sp = 16;
      const sv = makeSurface(W + sp * 2, H + sp * 2);
      if (!sv) { rock.shadow = null; return; }
      const sg = sv.getContext("2d");
      sg.translate(sp, sp);
      try { sg.filter = "blur(7px)"; } catch (_) { /* older WebViews: hard shadow */ }
      sg.fillStyle = "rgba(0,0,0,0.55)";
      sg.beginPath();
      sg.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) sg.lineTo(poly[i].x, poly[i].y);
      sg.closePath();
      sg.fill();
      rock.shadow = sv;
      rock.shadowOx = ox + sp;
      rock.shadowOy = oy + sp;
    }

    function paintTexture(g, t, W, H, seed) {
      const p = t.pal;
      switch (t.texture) {
        case "speckle": {
          for (let i = 0; i < (W * H) / 9; i++) {
            const r = rnd(0.5, 2.1);
            const roll = Math.random();
            g.fillStyle = roll < 0.34 ? p.light : roll < 0.62 ? p.dark : p.accent;
            g.globalAlpha = rnd(0.25, 0.7);
            g.beginPath();
            g.arc(Math.random() * W, Math.random() * H, r, 0, TAU);
            g.fill();
          }
          g.globalAlpha = 1;
          break;
        }
        case "strata": {
          const bands = rndInt(7, 13);
          for (let i = 0; i < bands; i++) {
            const y = (i / bands) * H + rnd(-3, 3);
            g.globalAlpha = rnd(0.06, 0.2);
            g.strokeStyle = i % 2 ? p.light : p.dark;
            g.lineWidth = rnd(1.5, 6);
            g.beginPath();
            for (let x = -4; x <= W + 4; x += 6) {
              const yy = y + Math.sin((x / W) * 3.1 + i * 1.7 + seed) * 3.2;
              x === -4 ? g.moveTo(x, yy) : g.lineTo(x, yy);
            }
            g.stroke();
          }
          g.globalAlpha = 1;
          break;
        }
        case "facet": {
          const cx = W / 2, cy = H / 2;
          const n = rndInt(6, 10);
          for (let i = 0; i < n; i++) {
            const a0 = (i / n) * TAU + seed, a1 = a0 + TAU / n;
            const r0 = rnd(0.55, 1.5) * Math.max(W, H);
            g.globalAlpha = rnd(0.06, 0.22);
            g.fillStyle = Math.random() < 0.5 ? p.light : p.dark;
            g.beginPath();
            g.moveTo(cx + rnd(-8, 8), cy + rnd(-8, 8));
            g.lineTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
            g.lineTo(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0);
            g.closePath();
            g.fill();
          }
          g.globalAlpha = 1;
          break;
        }
        case "mottle": {
          for (let i = 0; i < 26; i++) {
            const x = Math.random() * W, y = Math.random() * H, r = rnd(6, Math.max(10, W / 3));
            const rg = g.createRadialGradient(x, y, 0, x, y, r);
            const c = Math.random() < 0.5 ? p.light : p.dark;
            rg.addColorStop(0, c);
            rg.addColorStop(1, "rgba(0,0,0,0)");
            g.globalAlpha = rnd(0.05, 0.16);
            g.fillStyle = rg;
            g.fillRect(x - r, y - r, r * 2, r * 2);
          }
          g.globalAlpha = 1;
          break;
        }
        case "band": {
          for (let i = 0; i < 9; i++) {
            g.globalAlpha = rnd(0.07, 0.19);
            g.strokeStyle = i % 2 ? p.light : p.accent;
            g.lineWidth = rnd(3, 11);
            g.beginPath();
            const base = rnd(0, H);
            for (let x = -4; x <= W + 4; x += 7) {
              const yy = base + Math.sin((x / W) * 4.2 + i + seed) * rnd(4, 9);
              x === -4 ? g.moveTo(x, yy) : g.lineTo(x, yy);
            }
            g.stroke();
          }
          g.globalAlpha = 1;
          break;
        }
        case "crystal": {
          const cx = W * rnd(0.35, 0.65), cy = H * rnd(0.35, 0.65);
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * TAU;
            g.globalAlpha = rnd(0.1, 0.4);
            g.strokeStyle = "#ffffff";
            g.lineWidth = rnd(0.8, 3.4);
            g.beginPath();
            g.moveTo(cx + Math.cos(a) * rnd(0, 10), cy + Math.sin(a) * rnd(0, 10));
            g.lineTo(cx + Math.cos(a) * rnd(W * 0.3, W), cy + Math.sin(a) * rnd(H * 0.3, H));
            g.stroke();
          }
          const rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.5);
          rg.addColorStop(0, "rgba(255,255,255,0.55)");
          rg.addColorStop(1, "rgba(255,255,255,0)");
          g.globalAlpha = 1;
          g.fillStyle = rg;
          g.fillRect(0, 0, W, H);
          break;
        }
        case "gloss": {
          // conchoidal ripples, then a hard specular sweep
          for (let i = 0; i < 7; i++) {
            g.globalAlpha = rnd(0.05, 0.14);
            g.strokeStyle = p.accent;
            g.lineWidth = rnd(1, 3);
            g.beginPath();
            g.arc(W * rnd(-0.2, 0.6), H * rnd(0.2, 1.1), rnd(W * 0.3, W), 0, TAU);
            g.stroke();
          }
          g.globalAlpha = 1;
          const lg = g.createLinearGradient(0, 0, W * 0.8, H * 0.7);
          lg.addColorStop(0, "rgba(255,255,255,0.42)");
          lg.addColorStop(0.24, "rgba(255,255,255,0.05)");
          lg.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = lg;
          g.fillRect(0, 0, W, H);
          break;
        }
        case "moss": {
          for (let i = 0; i < 18; i++) {
            const x = Math.random() * W, y = Math.random() * H, r = rnd(5, W / 3.4);
            const rg = g.createRadialGradient(x, y, 0, x, y, r);
            rg.addColorStop(0, Math.random() < 0.5 ? p.light : p.dark);
            rg.addColorStop(1, "rgba(0,0,0,0)");
            g.globalAlpha = rnd(0.05, 0.14);
            g.fillStyle = rg;
            g.fillRect(x - r, y - r, r * 2, r * 2);
          }
          // moss gathers on the upward faces
          for (let i = 0; i < 30; i++) {
            const x = Math.random() * W, y = rnd(0, H * 0.62);
            const r = rnd(3, 13);
            const rg = g.createRadialGradient(x, y, 0, x, y, r);
            rg.addColorStop(0, "rgba(122,158,74,0.75)");
            rg.addColorStop(0.6, "rgba(96,132,58,0.35)");
            rg.addColorStop(1, "rgba(96,132,58,0)");
            g.globalAlpha = rnd(0.35, 0.85);
            g.fillStyle = rg;
            g.fillRect(x - r, y - r, r * 2, r * 2);
          }
          g.globalAlpha = 1;
          break;
        }
      }
      g.globalAlpha = 1;
    }

    /**
     * Build a stone. `index` shapes the draw: the first few are broad and kind,
     * later ones get smaller and stranger, with a slab every so often to give
     * the player a fresh platform.
     */
    function makeStone(index) {
      let type;
      if (index === 0) type = TYPE_BY_ID.slate;
      else if (index % 5 === 4) type = pick([TYPE_BY_ID.slate, TYPE_BY_ID.river]);
      else if (index < 3) type = pick([TYPE_BY_ID.river, TYPE_BY_ID.sand, TYPE_BY_ID.granite, TYPE_BY_ID.moss]);
      else {
        const pool = [TYPE_BY_ID.river, TYPE_BY_ID.granite, TYPE_BY_ID.sand, TYPE_BY_ID.moss,
                      TYPE_BY_ID.basalt, TYPE_BY_ID.granite, TYPE_BY_ID.basalt];
        if (index >= 5) pool.push(TYPE_BY_ID.quartz);
        if (index >= 7) pool.push(TYPE_BY_ID.obsidian, TYPE_BY_ID.quartz);
        type = pick(pool);
      }
      // stones shrink as the tower grows, with a floor so they stay grabbable
      const shrink = clamp(1 - index * 0.042, 0.64, 1);
      const scale = rnd(0.128, 0.19) * shrink * (index === 0 ? 1.18 : 1);
      const verts = makeShape(type, scale);
      const body = new Body(verts, {
        friction: type.friction,
        density: type.density,
        restitution: 0.02,
        linDamp: 0.2,
        angDamp: 0.4
      });
      const rock = { type, body, seed: Math.random() * 10, index, settledAt: null };
      body.rock = rock;
      bakeStone(rock);
      return rock;
    }

    // ====================================================================== //
    // Audio — stone voices, synthesized                                      //
    // ====================================================================== //
    // A stone strike is a broadband click plus a couple of short inharmonic body
    // modes; big stones ring low and dull, small hard ones ring high and bright.

    let ac = null, master = null, noiseBuf = null, audioDead = false;
    let windNode = null, windGain = null, windFilter = null;
    let grindSrc = null, grindGain = null, grindFilter = null;
    let voices = 0;

    function buildAudio() {
      if (ac || audioDead) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }
      master = ac.createGain();
      master.gain.value = 0.85;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 3.5;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      master.connect(comp);
      comp.connect(ac.destination);

      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      // persistent beds: wind (storm) and stone-on-stone grind (while dragging)
      windFilter = ac.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.value = 520;
      windFilter.Q.value = 0.7;
      windGain = ac.createGain();
      windGain.gain.value = 0;
      windNode = ac.createBufferSource();
      windNode.buffer = noiseBuf; windNode.loop = true;
      windNode.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
      try { windNode.start(0); } catch (_) {}

      grindFilter = ac.createBiquadFilter();
      grindFilter.type = "bandpass";
      grindFilter.frequency.value = 1500;
      grindFilter.Q.value = 2.2;
      grindGain = ac.createGain();
      grindGain.gain.value = 0;
      grindSrc = ac.createBufferSource();
      grindSrc.buffer = noiseBuf; grindSrc.loop = true;
      grindSrc.connect(grindFilter); grindFilter.connect(grindGain); grindGain.connect(master);
      try { grindSrc.start(0); } catch (_) {}

      ctx.onDestroy(() => { try { ac.close(); } catch (_) {} });
      return ac;
    }

    let resuming = false;
    function unlockAudio() {
      if (!buildAudio()) return;
      if (ac.state !== "running" && !resuming) {
        resuming = true;
        let p;
        try { p = ac.resume(); } catch (_) { resuming = false; }
        if (p && p.then) p.then(() => { resuming = false; }, () => { resuming = false; });
        else resuming = false;
      }
      try {
        const s = ac.createBufferSource();
        s.buffer = ac.createBuffer(1, 1, ac.sampleRate || 22050);
        s.connect(ac.destination);
        s.start(0);
      } catch (_) {}
    }

    function env(node, t, peak, attack, decay) {
      node.gain.setValueAtTime(0.0001, t);
      node.gain.linearRampToValueAtTime(peak, t + attack);
      node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    /** Stone-on-stone strike. `speed` in m/s, `size` the stone's bounding radius. */
    function playClack(type, speed, size, hard) {
      if (!ac || ac.state !== "running" || voices > 16) return;
      const amp = clamp(speed / 1.5, 0.06, 1) * type.snd.gain * (hard ? 1 : 0.72);
      if (amp < 0.035) return;
      const t = ac.currentTime;
      // bigger stone ⇒ lower body frequency
      const f = type.snd.f * Math.pow(0.16 / clamp(size, 0.05, 0.4), 0.55) * rnd(0.92, 1.09);
      const dec = type.snd.decay * rnd(0.85, 1.2);
      voices++;

      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      src.playbackRate.value = rnd(0.85, 1.15);
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(f * 1.9, t);
      bp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 0.85), t + dec);
      bp.Q.value = type.snd.q;
      const g = ac.createGain();
      env(g, t, amp * 0.55, 0.0015, dec);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + dec + 0.06);
      src.onended = () => { voices--; };

      // inharmonic body modes
      const ratios = [1, 1.62, 2.39];
      for (let i = 0; i < ratios.length; i++) {
        const o = ac.createOscillator();
        o.type = i === 0 ? "triangle" : "sine";
        o.frequency.value = f * ratios[i] * rnd(0.985, 1.015);
        const og = ac.createGain();
        env(og, t, amp * (0.34 / (i + 1)), 0.001, dec * (1.5 - i * 0.32));
        o.connect(og); og.connect(master);
        o.start(t); o.stop(t + dec * 1.6 + 0.05);
      }

      // low thump so heavy stones land with weight
      const lo = ac.createOscillator();
      lo.type = "sine";
      lo.frequency.setValueAtTime(rnd(105, 145), t);
      lo.frequency.exponentialRampToValueAtTime(52, t + 0.09);
      const lg = ac.createGain();
      env(lg, t, amp * 0.4, 0.002, 0.085);
      lo.connect(lg); lg.connect(master);
      lo.start(t); lo.stop(t + 0.16);
    }

    function playSplash(vol) {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(2800, t);
      lp.frequency.exponentialRampToValueAtTime(280, t + 0.45);
      const g = ac.createGain();
      env(g, t, clamp(vol, 0.1, 1) * 0.4, 0.006, 0.5);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.6);
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.3);
      const og = ac.createGain();
      env(og, t, 0.1 * vol, 0.005, 0.3);
      o.connect(og); og.connect(master);
      o.start(t); o.stop(t + 0.4);
    }

    function playBell(base, gain, decay) {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      const parts = [1, 2.02, 2.98, 5.42];
      const amps = [1, 0.42, 0.26, 0.12];
      for (let i = 0; i < parts.length; i++) {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = base * parts[i] * rnd(0.998, 1.004);
        const g = ac.createGain();
        env(g, t, gain * amps[i], 0.006, decay * (1 - i * 0.16));
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + decay + 0.2);
      }
    }

    function playRumble(vol) {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(260, t);
      lp.frequency.exponentialRampToValueAtTime(70, t + 1.1);
      const g = ac.createGain();
      env(g, t, 0.36 * vol, 0.02, 1.2);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 1.5);
    }

    function playWhoosh() {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
      bp.frequency.exponentialRampToValueAtTime(320, t + 1.3);
      bp.Q.value = 0.9;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 1.6);
    }

    function setBedLevels(windAmt, slideAmt) {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      if (windGain) {
        windGain.gain.setTargetAtTime(clamp(windAmt, 0, 1) * 0.1, t, 0.25);
        windFilter.frequency.setTargetAtTime(380 + windAmt * 700, t, 0.3);
      }
      if (grindGain) {
        grindGain.gain.setTargetAtTime(clamp(slideAmt, 0, 1) * 0.075, t, 0.04);
        grindFilter.frequency.setTargetAtTime(900 + slideAmt * 2600, t, 0.05);
      }
    }

    // background bed via the host music engine
    let musicHandle = null;
    async function startMusic(preset) {
      if (!ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        if (musicHandle) {
          await ctx.music.setPreset(preset, { fadeMs: 900 });
        } else {
          musicHandle = await ctx.music.play({
            preset, volume: 0.3, fadeInMs: 2200, intensity: 0.28, density: 0.3, tempo: 62
          });
        }
      } catch (_) { /* host may block audio while backgrounded; not fatal */ }
    }
    function stopMusic() {
      try { ctx.music.stop({ fadeOutMs: 1200 }); } catch (_) {}
      musicHandle = null;
    }

    function haptic(kind) {
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic(kind); } catch (_) {} }
    }

    // ====================================================================== //
    // Modes                                                                  //
    // ====================================================================== //

    const MODES = {
      zen: {
        id: "zen", name: "Zen", channel: "zen_stack", icon: "🪷",
        blurb: "Still air, forgiving stone. Stack as high as your patience.",
        mult: 1.0, assist: 1.0, slips: 3, friction: 1.0, wind: 0, swell: 0,
        music: "ambient",
        sky: ["#f5d6b4", "#efb995", "#c79b9c", "#7d7fa4", "#4a5378"],
        water: ["#5c6690", "#3b446a"], sun: "#fff0d0", mist: "rgba(255,225,200,0.14)"
      },
      tide: {
        id: "tide", name: "Tide", channel: "tide_stack", icon: "🌊",
        blurb: "The plinth breathes with the swell. Time your placings.",
        mult: 1.6, assist: 0.55, slips: 1, friction: 0.9, wind: 0, swell: 1,
        music: "drift",
        sky: ["#bfe0e6", "#8fc0cd", "#5f93ab", "#3c6382", "#25405e"],
        water: ["#2f7d8e", "#1b4a5e"], sun: "#e8fbff", mist: "rgba(200,240,255,0.16)"
      },
      storm: {
        id: "storm", name: "Storm", channel: "storm_stack", icon: "⛈️",
        blurb: "Gusts, tremors and slick stone. No second chances.",
        mult: 2.4, assist: 0, slips: 0, friction: 0.78, wind: 1, swell: 1.5,
        music: "drone",
        sky: ["#5a5f6e", "#474c5c", "#353947", "#242732", "#15171e"],
        water: ["#2b3040", "#171a24"], sun: "#9aa3b8", mist: "rgba(180,190,210,0.12)"
      }
    };
    const MODE_ORDER = ["zen", "tide", "storm"];

    // ====================================================================== //
    // Surfaces + layout                                                      //
    // ====================================================================== //

    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";
    ui.style.fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";
    ui.style.color = "#f6f2ea";

    const SA = () => ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
    let W = ctx.width, H = ctx.height;

    // camera / projection
    const cam = { y: 0, zoom: 1, shake: 0, shakeX: 0, shakeY: 0 };
    let ppm0 = 1, ppm = 1, baseScreenY = 0;

    function updateProjection() {
      W = ctx.width; H = ctx.height;
      ppm0 = H / 3.4;
      ppm = ppm0 * cam.zoom;
      baseScreenY = H * 0.80;
    }
    const sx = (wx) => W / 2 + wx * ppm + cam.shakeX;
    const sy = (wy) => baseScreenY - (wy - cam.y) * ppm + cam.shakeY;
    const toWorldPt = (px, py) => ({
      x: (px - W / 2 - cam.shakeX) / ppm,
      y: cam.y - (py - baseScreenY - cam.shakeY) / ppm
    });

    const WATER_Y = -0.10;      // world y of the waterline
    const KILL_Y = -1.05;       // stones below this are gone

    // ====================================================================== //
    // Scenery                                                                //
    // ====================================================================== //

    function makeRidge(seed, rough, steps) {
      const pts = [];
      let h = 0.5;
      for (let i = 0; i <= steps; i++) {
        h += (Math.sin(i * 0.7 + seed) + Math.sin(i * 0.23 + seed * 2.1)) * rough * 0.5
           + (Math.random() - 0.5) * rough * 0.35;
        h = clamp(h, 0.12, 1);
        pts.push(h);
      }
      return pts;
    }
    const ridges = [makeRidge(1.3, 0.11, 26), makeRidge(4.7, 0.16, 20), makeRidge(9.1, 0.22, 15)];

    const motes = [];
    for (let i = 0; i < 46; i++) {
      motes.push({ x: Math.random(), y: Math.random(), r: rnd(0.6, 2.4), sp: rnd(0.004, 0.02),
                   ph: Math.random() * TAU, a: rnd(0.15, 0.55) });
    }
    const rain = [];
    for (let i = 0; i < 90; i++) {
      rain.push({ x: Math.random(), y: Math.random(), len: rnd(0.02, 0.06), sp: rnd(0.9, 1.7) });
    }
    const splashes = [];   // transient water rings
    const pops = [];       // floating score text

    // The sky is three full-screen gradient fills, so it is baked once per
    // mode/size and blitted. Without an offscreen surface it is painted live.
    let backdrop = null, backdropKey = "";

    function paintSky(b, mode, BW, BH) {
      const grd = b.createLinearGradient(0, 0, 0, BH);
      const c = mode.sky;
      for (let i = 0; i < c.length; i++) grd.addColorStop(i / (c.length - 1), c[i]);
      b.fillStyle = grd;
      b.fillRect(0, 0, BW, BH);

      const sunX = BW * 0.72, sunY = BH * 0.17;
      const halo = b.createRadialGradient(sunX, sunY, 0, sunX, sunY, BH * 0.34);
      halo.addColorStop(0, mode.sun);
      halo.addColorStop(0.10, mode.id === "storm" ? "rgba(150,160,180,0.20)" : "rgba(255,225,180,0.34)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      b.fillStyle = halo;
      b.fillRect(0, 0, BW, BH);
      b.globalAlpha = mode.id === "storm" ? 0.35 : 0.92;
      b.beginPath();
      b.arc(sunX, sunY, BH * 0.035, 0, TAU);
      b.fillStyle = mode.sun;
      b.fill();
      b.globalAlpha = 1;

      if (mode.id === "storm") {
        const vg = b.createRadialGradient(BW / 2, BH / 2, BH * 0.28, BW / 2, BH / 2, BH * 0.75);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.42)");
        b.fillStyle = vg;
        b.fillRect(0, 0, BW, BH);
      }
    }

    function drawSky(mode) {
      const key = mode.id + ":" + W + "x" + H;
      if (backdropKey !== key || !backdrop) {
        const sc = 1.5;                       // supersample so the sun stays crisp
        const cv = makeSurface(Math.ceil(W * sc), Math.ceil(H * sc));
        if (cv) {
          paintSky(cv.getContext("2d"), mode, cv.width, cv.height);
          backdrop = cv;
          backdropKey = key;
        } else {
          backdrop = null;
        }
      }
      if (backdrop) g.drawImage(backdrop, 0, 0, W, H);
      else paintSky(g, mode, W, H);
    }

    function drawRidges(mode, t) {
      const horizon = baseScreenY - (WATER_Y - cam.y) * ppm;
      const shades = mode.id === "storm"
        ? ["rgba(40,44,56,0.55)", "rgba(30,33,43,0.7)", "rgba(20,22,30,0.85)"]
        : ["rgba(70,80,110,0.30)", "rgba(52,60,88,0.45)", "rgba(36,42,64,0.6)"];
      for (let L = 0; L < 3; L++) {
        const pts = ridges[L];
        const amp = H * (0.10 + L * 0.045);
        const base = horizon + L * 6 - cam.y * ppm * 0.02 * (3 - L);
        g.beginPath();
        g.moveTo(-10, base + 40);
        for (let i = 0; i < pts.length; i++) {
          const x = -10 + ((W + 20) * i) / (pts.length - 1);
          g.lineTo(x, base - pts[i] * amp);
        }
        g.lineTo(W + 10, base + 40);
        g.closePath();
        g.fillStyle = shades[L];
        g.fill();
      }
      // mist band along the waterline
      const mg = g.createLinearGradient(0, horizon - H * 0.09, 0, horizon + 6);
      mg.addColorStop(0, "rgba(255,255,255,0)");
      mg.addColorStop(1, mode.mist);
      g.fillStyle = mg;
      g.fillRect(0, horizon - H * 0.09, W, H * 0.09 + 6);
    }

    function drawWaterBase(mode) {
      const wy = sy(WATER_Y);
      if (wy > H) return;
      const grd = g.createLinearGradient(0, wy, 0, H);
      grd.addColorStop(0, mode.water[0]);
      grd.addColorStop(1, mode.water[1]);
      g.fillStyle = grd;
      g.fillRect(0, wy, W, H - wy);
    }

    /** Ripples and splash rings — drawn after the reflection so they sit on it. */
    function drawWaterSurface(mode, t) {
      const wy = sy(WATER_Y);
      if (wy > H) return;
      g.save();
      g.beginPath();
      g.rect(0, wy, W, H - wy);
      g.clip();
      for (let i = 0; i < 13; i++) {
        const p = i / 13;
        const y = wy + Math.pow(p, 1.75) * (H - wy) + 4;
        const ph = t * 0.0008 * (0.4 + p) + i * 1.7;
        g.beginPath();
        for (let x = -20; x <= W + 20; x += 26) {
          const yy = y + Math.sin(x * 0.011 + ph) * (0.7 + p * 2.2);
          x === -20 ? g.moveTo(x, yy) : g.lineTo(x, yy);
        }
        g.strokeStyle = "rgba(255,255,255," + (0.04 + p * 0.085).toFixed(3) + ")";
        g.lineWidth = 1 + p * 1.5;
        g.stroke();
      }
      // splash rings
      for (const s of splashes) {
        g.beginPath();
        g.ellipse(s.x, s.y, s.r, s.r * 0.28, 0, 0, TAU);
        g.strokeStyle = "rgba(255,255,255," + (s.life * 0.5).toFixed(3) + ")";
        g.lineWidth = 1.6;
        g.stroke();
      }
      g.restore();
    }

    function drawParticles(mode, t, windAmt) {
      if (mode.id === "storm") {
        g.strokeStyle = "rgba(190,205,230,0.30)";
        g.lineWidth = 1.2;
        g.beginPath();
        for (const d of rain) {
          const x = d.x * W + windAmt * 90 * d.sp;
          const y = d.y * H;
          g.moveTo(x, y);
          g.lineTo(x - windAmt * 26 - 5, y + d.len * H);
        }
        g.stroke();
      } else {
        for (const m of motes) {
          const x = m.x * W + Math.sin(t * 0.0004 + m.ph) * 22;
          const y = m.y * H;
          g.beginPath();
          g.arc(x, y, m.r, 0, TAU);
          g.fillStyle = "rgba(255,246,225," + (m.a * (0.5 + 0.5 * Math.sin(t * 0.001 + m.ph))).toFixed(3) + ")";
          g.fill();
        }
      }
    }

    function stepParticles(dt, mode, windAmt) {
      for (const m of motes) {
        m.y -= m.sp * dt;
        m.x += Math.sin(m.ph + m.y * 6) * 0.0004 * dt * 60;
        if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      }
      if (mode.id === "storm") {
        for (const d of rain) {
          d.y += d.sp * dt * 1.5;
          d.x -= (0.12 + windAmt * 0.4) * dt;
          if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); }
          if (d.x < -0.05) d.x = 1.05;
        }
      }
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.r += 90 * dt;
        s.life -= dt * 1.4;
        if (s.life <= 0) splashes.splice(i, 1);
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.rise += 34 * dt;
        p.life -= dt * 0.75;
        if (p.life <= 0) pops.splice(i, 1);
      }
    }

    // ====================================================================== //
    // Stone rendering                                                        //
    // ====================================================================== //

    function stonePath(b) {
      g.beginPath();
      g.moveTo(sx(b.world[0].x), sy(b.world[0].y));
      for (let i = 1; i < b.n; i++) g.lineTo(sx(b.world[i].x), sy(b.world[i].y));
      g.closePath();
    }

    /** Plain shaded polygon, used when the stone has no baked sprite. */
    function drawStoneLive(rock, alpha) {
      const b = rock.body, p = rock.type.pal;
      g.save();
      g.globalAlpha = alpha;
      stonePath(b);
      const lg = g.createLinearGradient(sx(b.minx), sy(b.maxy), sx(b.maxx), sy(b.miny));
      lg.addColorStop(0, p.light);
      lg.addColorStop(0.32, p.base);
      lg.addColorStop(0.76, p.base);
      lg.addColorStop(1, p.dark);
      g.fillStyle = lg;
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = "rgba(0,0,0,0.34)";
      g.stroke();
      g.restore();
    }

    function drawStone(rock, alpha) {
      if (!rock.tex) { drawStoneLive(rock, alpha); return; }
      const b = rock.body;
      const s = ppm / REF_PPM;
      g.save();
      g.globalAlpha = alpha;
      g.translate(sx(b.pos.x), sy(b.pos.y));
      g.rotate(-b.angle);
      g.scale(s, s);
      g.drawImage(rock.tex, -rock.texOx, -rock.texOy);
      g.restore();
    }

    function drawStoneShadow(rock) {
      if (!rock.shadow) return;
      const b = rock.body;
      const s = ppm / REF_PPM;
      g.save();
      g.globalAlpha = 0.30;
      g.translate(sx(b.pos.x) + 5 * cam.zoom, sy(b.pos.y) + 9 * cam.zoom);
      g.rotate(-b.angle);
      g.scale(s, s);
      g.drawImage(rock.shadow, -rock.shadowOx, -rock.shadowOy);
      g.restore();
    }

    // ====================================================================== //
    // Game state                                                             //
    // ====================================================================== //

    const state = {
      screen: "menu",          // menu | play | over
      phase: "idle",           // idle | waiting | held | settling
      mode: MODES.zen,
      world: null,
      plinth: null,
      stones: [],              // settled stones, bottom-up
      loose: [],               // stones tumbling out of play
      current: null,           // the stone in hand or settling
      pending: null,           // the stone waiting to be picked up
      score: 0,
      placed: 0,          // stones successfully balanced; survives a collapse
      slips: 0,
      towerTop: 0,
      calmMs: 0,
      settleMs: 0,
      releasedAt: 0,
      runMs: 0,
      best: {},
      lifetime: 0,
      gust: 0, gustTimer: 5, gustWarn: false,
      swellPhase: 0,
      seatQuality: 0,
      hintTimer: 0
    };

    function plinthShape() {
      const w = 0.40, h = 0.075;
      return [
        { x: -w, y: -h }, { x: w, y: -h },
        { x: w * 0.90, y: h }, { x: -w * 0.90, y: h }
      ];
    }

    let plinthRock = null;

    function buildWorld() {
      const w = new World();
      const verts = plinthShape();
      const plinth = new Body(verts, { kinematic: true, friction: 0.95, restitution: 0.0 });
      // the shape is centred on its own centroid, so lift it until its top is y = 0
      let maxy = -Infinity;
      for (const v of plinth.local) maxy = Math.max(maxy, v.y);
      plinth.pos = { x: 0, y: -maxy };
      plinth.sync();
      w.add(plinth);
      state.plinth = plinth;

      plinthRock = { type: TYPE_BY_ID.plinth, body: plinth, seed: 2.2, index: -1 };
      bakeStone(plinthRock);
      return w;
    }

    function startRun(modeId) {
      const mode = MODES[modeId];
      state.mode = mode;
      state.world = buildWorld();
      state.stones = [];
      state.loose = [];
      state.current = null;
      state.pending = null;
      state.score = 0;
      state.placed = 0;
      state.slips = mode.slips;
      state.towerTop = 0;
      state.runMs = 0;
      state.gust = 0;
      state.gustTimer = 6;
      state.gustWarn = false;
      state.swellPhase = 0;
      state.screen = "play";
      state.phase = "waiting";
      state.hintTimer = 5.5;
      cam.y = 0; cam.zoom = 1; cam.shake = 0;
      splashes.length = 0;
      pops.length = 0;
      serveStone();
      ctx.platform.setScore(0);
      startMusic(mode.music);
      showScreen("play");
      syncHud();
    }

    function serveStone() {
      const rock = makeStone(state.stones.length);
      // stones with the slick faces need a bit more hand to control
      rock.body.friction *= state.mode.friction;
      state.pending = rock;
      state.phase = "waiting";
      positionPending(0);
    }

    function positionPending(t) {
      const r = state.pending;
      if (!r) return;
      const camTopSpawn = cam.y + (0.52 * H) / ppm;
      const y = Math.max(state.towerTop + 0.30, camTopSpawn);
      r.body.pos = { x: r.spawnX != null ? r.spawnX : (r.spawnX = rnd(-0.09, 0.09)),
                     y: y + Math.sin(t * 0.0016) * 0.014 };
      r.body.angle = Math.sin(t * 0.0011 + r.seed) * 0.10;
      r.body.sync();
    }

    function grabStone(rock, worldPt, pointerId) {
      const b = rock.body;
      if (state.pending === rock) {
        state.pending = null;
        state.current = rock;
        state.world.add(b);
        b.vel = { x: 0, y: 0 };
        b.angVel = 0;
      }
      // grip where the finger actually landed — that is what makes it hang right
      let local = b.toLocal(worldPt);
      if (!b.containsPoint(worldPt)) local = vmul(local, 0.55);
      const grab = new Grab(b, local, Math.max(12, b.mass * 105));
      grab.target = worldPt;
      grab.pointerId = pointerId;
      state.world.grabs.push(grab);
      state.phase = "held";
      state.grab = grab;
      unlockAudio();
      ctx.platform.start();
      haptic("light");
      return grab;
    }

    function releaseStone() {
      if (!state.grab) return;
      const b = state.grab.body;
      state.world.grabs = state.world.grabs.filter((x) => x !== state.grab);
      state.grab = null;
      state.phase = "settling";
      state.releasedAt = state.runMs;
      state.calmMs = 0;
      // a whisper of unsettledness, so a release always has a breath of wobble
      const w = state.mode.id === "zen" ? 0.35 : state.mode.id === "tide" ? 0.6 : 0.9;
      b.angVel += rnd(-0.22, 0.22) * w;
      b.vel.x += rnd(-0.014, 0.014) * w;
      haptic("light");
    }

    /** Contact span between the current stone and whatever holds it up. */
    function supportSpan(rock) {
      let minx = Infinity, maxx = -Infinity, found = false;
      for (const [, arb] of state.world.arbiters) {
        if (arb.a !== rock.body && arb.b !== rock.body) continue;
        const other = arb.a === rock.body ? arb.b : arb.a;
        if (other.pos.y > rock.body.pos.y) continue;   // only what is beneath
        for (const c of arb.points) {
          minx = Math.min(minx, c.p.x);
          maxx = Math.max(maxx, c.p.x);
          found = true;
        }
      }
      return found ? maxx - minx : null;
    }

    function stoneWidth(rock) {
      return rock.body.maxx - rock.body.minx;
    }

    function settleStone() {
      const rock = state.current;
      const b = rock.body;
      const newTop = b.maxy;

      // it has to have actually gained the tower height, otherwise it slid off
      if (newTop <= state.towerTop + 0.006) { slip("It slid off"); return; }

      const idx = state.stones.length;
      const settleMs = state.runMs - state.releasedAt;
      const speedQ = clamp(1 - (settleMs - 320) / 2000, 0, 1);
      const span = supportSpan(rock);
      const poiseQ = span == null ? 0.35 : clamp(1 - span / (stoneWidth(rock) * 0.62), 0, 1);
      const bonus = 1 + 0.35 * speedQ + 0.5 * poiseQ;
      const pts = Math.round((14 + 8 * idx) * rock.type.value * state.mode.mult * bonus);

      state.score += pts;
      state.towerTop = newTop;
      rock.settledAt = state.runMs;
      state.stones.push(rock);
      state.current = null;
      state.placed++;
      state.lifetime++;

      let label = "Balanced";
      if (poiseQ > 0.68) label = "Precarious!";
      else if (speedQ > 0.8) label = "Clean seat";
      else if (rock.type.id === "obsidian" || rock.type.id === "quartz") label = rock.type.name;

      pops.push({ wx: b.pos.x, wy: b.maxy, rise: 0, text: "+" + pts, sub: label, life: 1 });
      ctx.platform.setScore(state.score);
      ctx.platform.interact({ type: "stone_placed", stones: state.stones.length, points: pts });
      playBell(rnd(760, 900), 0.075, 0.85);
      haptic(poiseQ > 0.68 ? "success" : "light");

      if (state.stones.length % 5 === 0) {
        playBell(392, 0.16, 3.2);
        haptic("success");
        ctx.platform.milestone("stones_" + state.stones.length, { stones: state.stones.length });
      }
      syncHud();
      serveStone();
    }

    function slip(reason) {
      const rock = state.current;
      if (rock) {
        state.loose.push(rock);
        state.current = null;
      }
      state.slips--;
      haptic("warning");
      if (state.slips < 0) { endRun(reason || "The stone would not sit"); return; }
      toast(reason + " · " + state.slips + " slip" + (state.slips === 1 ? "" : "s") + " left");
      syncHud();
      serveStone();
    }

    function endRun(reason) {
      if (state.screen === "over") return;
      state.screen = "over";
      state.phase = "idle";
      if (state.grab) {
        state.world.grabs = state.world.grabs.filter((x) => x !== state.grab);
        state.grab = null;
      }
      if (state.current) { state.loose.push(state.current); state.current = null; }
      state.pending = null;
      cam.shake = 1;
      playRumble(1);
      haptic("error");
      ctx.platform.fail({ score: state.score, stones: state.placed, mode: state.mode.id });
      try { ctx.music.duck(0.5, 1400); } catch (_) {}
      showOver(reason);
      saveProgress();
      submitScore();
    }

    function collapse() {
      // everything still standing lets go at once
      for (const r of state.stones) state.loose.push(r);
      state.stones = [];
      endRun("The cairn fell");
    }

    // ====================================================================== //
    // Simulation update                                                      //
    // ====================================================================== //

    let accum = 0;

    function updatePhysics(dtSec, t) {
      const w = state.world;
      if (!w) return;
      const mode = state.mode;

      // --- environment forces ---------------------------------------------
      let windAmt = 0;
      if (mode.wind > 0) {
        state.gustTimer -= dtSec;
        if (!state.gustWarn && state.gustTimer < 1.4) {
          state.gustWarn = true;
          playWhoosh();
          toast("Gust incoming", 1200);
        }
        if (state.gustTimer <= 0) {
          state.gust = 1;
          state.gustTimer = rnd(5.5, 9.5);
          state.gustWarn = false;
          state.gustDir = Math.random() < 0.5 ? -1 : 1;
        }
        state.gust = Math.max(0, state.gust - dtSec * 0.62);
        const steady = 0.35 + 0.25 * Math.sin(t * 0.0007);
        windAmt = steady * 0.45 + Math.pow(state.gust, 1.6) * 1.5;
        w.wind = (state.gustDir || 1) * windAmt * 2.4 * mode.wind;
      } else {
        w.wind = 0;
      }

      // --- plinth swell ----------------------------------------------------
      const p = state.plinth;
      if (p) {
        if (mode.swell > 0) {
          const grow = clamp(state.towerTop / 2.0, 0, 1);
          const amp = (0.013 + 0.020 * grow) * mode.swell;
          const om = 0.62;
          state.swellPhase += dtSec * om;
          p.angVel = amp * om * Math.cos(state.swellPhase);
          p.vel.x = 0.045 * mode.swell * om * Math.cos(state.swellPhase * 0.71 + 1.1);
          if (mode.wind > 0 && state.gust > 0.8) {
            p.vel.x += (state.gustDir || 1) * 0.10 * (state.gust - 0.8) * 5;
          }
        } else {
          p.angVel = 0; p.vel.x = 0;
        }
      }

      // --- fixed-step integration -----------------------------------------
      accum += Math.min(dtSec, 0.06);
      let steps = 0;
      while (accum >= SUBSTEP && steps < MAX_SUBSTEPS) {
        // assist torque: nudge a held stone toward sitting on one of its own faces
        if (state.grab && mode.assist > 0) {
          const b = state.grab.body;
          const near = clamp(1 - (b.miny - state.towerTop) / 0.30, 0, 1);
          const k = mode.assist * (0.25 + 0.75 * near);
          if (k > 0.01 && b.restAngles.length && state.grab.angTarget == null) {
            let best = null, bestScore = Infinity;
            for (const ra of b.restAngles) {
              const d = Math.abs(angDiff(ra.angle, b.angle));
              const s = d - ra.w * 0.55;
              if (s < bestScore) { bestScore = s; best = ra; }
            }
            if (best) {
              const d = angDiff(best.angle, b.angle);
              b.angVel += clamp(d * 5.5 * k - b.angVel * 2.4 * k, -8, 8) * SUBSTEP;
            }
          }
        }
        state.world.step(SUBSTEP);
        accum -= SUBSTEP;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) accum = 0;   // do not spiral after a stall

      // --- impacts → sound --------------------------------------------------
      let played = 0;
      for (const im of w.impacts) {
        if (played >= 4) break;
        const rock = (im.b.rock && im.b.rock.index >= 0) ? im.b.rock
                   : (im.a.rock && im.a.rock.index >= 0) ? im.a.rock : null;
        const type = rock ? rock.type : TYPE_BY_ID.slate;
        const size = rock ? rock.body.radius : 0.2;
        if (im.speed > 0.08) {
          playClack(type, im.speed, size, im.speed > 0.55);
          if (im.speed > 0.9) haptic("medium");
          played++;
        }
      }
      w.impacts.length = 0;

      const grinding = state.phase === "held" ? clamp(w.slide / 0.55, 0, 1) : 0;
      setBedLevels(mode.wind > 0 ? windAmt : 0, grinding);

      // --- water / fall handling -------------------------------------------
      const all = state.stones.concat(state.loose, state.current ? [state.current] : []);
      for (const r of all) {
        const b = r.body;
        if (!r.wet && b.miny < WATER_Y && b.vel.y < -0.2) {
          r.wet = true;
          splashes.push({ x: sx(b.pos.x), y: sy(WATER_Y), r: 6, life: 1 });
          playSplash(clamp(-b.vel.y / 3, 0.2, 1));
        }
      }
      for (let i = state.loose.length - 1; i >= 0; i--) {
        const r = state.loose[i];
        if (r.body.pos.y < KILL_Y) {
          state.world.remove(r.body);
          state.loose.splice(i, 1);
        }
      }

      // --- lose conditions --------------------------------------------------
      if (state.screen === "play") {
        for (const r of state.stones) {
          if (r.body.pos.y < -0.03 || Math.abs(r.body.pos.x) > 1.5) { collapse(); return windAmt; }
        }
        if (state.current) {
          const b = state.current.body;
          if (b.pos.y < WATER_Y - 0.02 || Math.abs(b.pos.x) > 1.5) {
            slip(b.pos.y < WATER_Y - 0.02 ? "Into the water" : "It slid off");
            return windAmt;
          }
        }
      }

      // --- settle detection -------------------------------------------------
      if (state.phase === "settling" && state.current) {
        const e = w.energy();
        if (e < 0.055) state.calmMs += dtSec * 1000;
        else state.calmMs = 0;
        const waited = state.runMs - state.releasedAt;
        if (state.calmMs > 420 || (waited > 7000 && e < 0.22)) settleStone();
      }
      return windAmt;
    }

    function updateCamera(dtSec) {
      const top = Math.max(
        state.towerTop,
        state.current ? state.current.body.maxy : 0,
        state.pending ? state.pending.body.maxy : 0
      );
      const zTarget = clamp(2.5 / (top + 0.95), 0.40, 1);
      cam.zoom = lerp(cam.zoom, zTarget, clamp(dtSec * 2.6, 0, 1));
      updateProjection();
      const yTarget = Math.max(0, top - (0.54 * H) / ppm);
      cam.y = lerp(cam.y, yTarget, clamp(dtSec * 3.2, 0, 1));

      if (cam.shake > 0.001) {
        cam.shake = Math.max(0, cam.shake - dtSec * 1.5);
        const m = cam.shake * cam.shake * 16;
        cam.shakeX = rnd(-m, m);
        cam.shakeY = rnd(-m, m);
      } else { cam.shakeX = 0; cam.shakeY = 0; }
    }

    // ====================================================================== //
    // Render                                                                 //
    // ====================================================================== //

    function render(t, windAmt) {
      const mode = state.mode;
      updateProjection();
      g.clearRect(0, 0, W, H);
      drawSky(mode);
      drawRidges(mode, t);

      const waterTop = sy(WATER_Y);
      const towerRocks = state.stones.concat(
        state.current ? [state.current] : [],
        state.loose
      );

      drawWaterBase(mode);

      // reflection, clipped to the water and painted over the water fill
      if (waterTop < H) {
        g.save();
        g.beginPath();
        g.rect(0, waterTop, W, H - waterTop);
        g.clip();
        // A true mirror would throw the cairn's reflection off the bottom of the
        // screen, so squash it — the usual stylisation, and it reads as water.
        g.translate(0, waterTop);
        g.scale(1, -0.45);
        g.translate(0, -waterTop);
        for (const r of towerRocks) drawStone(r, 0.34);
        if (plinthRock) drawStone(plinthRock, 0.34);
        g.restore();
      }

      drawWaterSurface(mode, t);

      // plinth + stones
      if (plinthRock) {
        drawStoneShadow(plinthRock);
        drawStone(plinthRock, 1);
      }
      for (const r of towerRocks) drawStoneShadow(r);
      for (const r of towerRocks) drawStone(r, 1);

      // the waiting stone, breathing
      if (state.pending) {
        const b = state.pending.body;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.003);
        const rr = b.radius * ppm * 1.5;
        const rg = g.createRadialGradient(sx(b.pos.x), sy(b.pos.y), rr * 0.35,
                                          sx(b.pos.x), sy(b.pos.y), rr);
        rg.addColorStop(0, "rgba(255,238,200," + (0.16 + pulse * 0.14).toFixed(3) + ")");
        rg.addColorStop(1, "rgba(255,238,200,0)");
        g.fillStyle = rg;
        g.beginPath();
        g.arc(sx(b.pos.x), sy(b.pos.y), rr, 0, TAU);
        g.fill();
        drawStone(state.pending, 1);
      }

      if (state.screen === "play") drawGuides(t);
      drawParticles(mode, t, windAmt);

      // score pops
      for (const p of pops) {
        g.save();
        g.globalAlpha = clamp(p.life, 0, 1);
        g.textAlign = "center";
        g.font = "700 22px -apple-system,system-ui,sans-serif";
        g.fillStyle = "#fff3d6";
        g.shadowColor = "rgba(0,0,0,0.5)";
        g.shadowBlur = 6;
        const px = sx(p.wx), py = sy(p.wy) - 18 - p.rise;
        g.fillText(p.text, px, py);
        g.font = "600 12px -apple-system,system-ui,sans-serif";
        g.fillStyle = "rgba(255,243,214,0.8)";
        g.fillText(p.sub, px, py + 16);
        g.restore();
      }

    }

    /** Balance line and hand-pressure read-out, drawn only while you are holding. */
    function drawGuides(t) {
      if (!state.stones.length && !state.current) return;

      // combined centre of mass of everything standing
      let m = 0, cx = 0;
      const live = state.stones.concat(state.current ? [state.current] : []);
      for (const r of live) { m += r.body.mass; cx += r.body.pos.x * r.body.mass; }
      if (m <= 0) return;
      cx /= m;

      const off = Math.abs(cx - state.plinth.pos.x);
      const danger = clamp(off / 0.34, 0, 1);
      const top = Math.max(state.towerTop, state.current ? state.current.body.maxy : 0);

      g.save();
      g.setLineDash([5, 7]);
      g.lineWidth = 1.4;
      g.strokeStyle = "rgba(" + Math.round(120 + 135 * danger) + "," +
        Math.round(220 - 130 * danger) + ",180," + (0.22 + 0.34 * danger).toFixed(3) + ")";
      g.beginPath();
      g.moveTo(sx(cx), sy(top + 0.05));
      g.lineTo(sx(cx), sy(-0.04));
      g.stroke();
      g.setLineDash([]);
      // where the weight lands on the plinth
      g.beginPath();
      g.ellipse(sx(cx), sy(0), 9 * cam.zoom, 3.2 * cam.zoom, 0, 0, TAU);
      g.fillStyle = "rgba(255,255,255," + (0.18 + 0.3 * danger).toFixed(3) + ")";
      g.fill();
      g.restore();

      // where the held stone is actually touching — read straight off the solver,
      // sized by how much load each contact is carrying
      if (state.grab) {
        const gb = state.grab.body;
        for (const [, arb] of state.world.arbiters) {
          if (arb.a !== gb && arb.b !== gb) continue;
          for (const c of arb.points) {
            const r = clamp(4 + c.Pn * 260, 3.5, 13) * cam.zoom;
            const px = sx(c.p.x), py = sy(c.p.y);
            const rg = g.createRadialGradient(px, py, 0, px, py, r);
            rg.addColorStop(0, "rgba(255,246,214,0.75)");
            rg.addColorStop(1, "rgba(255,246,214,0)");
            g.fillStyle = rg;
            g.beginPath();
            g.arc(px, py, r, 0, TAU);
            g.fill();
          }
        }
      }

      // hand pressure gauge beside the held stone
      if (state.grab) {
        const b = state.grab.body;
        const load = clamp(state.grab.load(), 0, 1.4);
        const gx = sx(b.maxx) + 16;
        const gy = sy(b.pos.y);
        const hgt = 54;
        g.save();
        g.fillStyle = "rgba(0,0,0,0.30)";
        g.beginPath();
        g.roundRect ? g.roundRect(gx - 4, gy - hgt / 2, 8, hgt, 4)
                    : g.rect(gx - 4, gy - hgt / 2, 8, hgt);
        g.fill();
        const good = load > 0.16 && load < 0.82;
        const fill = clamp(load / 1.2, 0, 1) * hgt;
        g.fillStyle = load >= 0.95 ? "rgba(255,110,110,0.92)"
                    : good ? "rgba(150,232,170,0.92)" : "rgba(255,236,180,0.85)";
        g.beginPath();
        g.roundRect ? g.roundRect(gx - 4, gy + hgt / 2 - fill, 8, fill, 4)
                    : g.rect(gx - 4, gy + hgt / 2 - fill, 8, fill);
        g.fill();
        // the band you want to land in
        g.strokeStyle = "rgba(255,255,255,0.5)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(gx - 7, gy + hgt / 2 - 0.82 / 1.2 * hgt);
        g.lineTo(gx + 7, gy + hgt / 2 - 0.82 / 1.2 * hgt);
        g.stroke();
        g.restore();
      }
    }

    // ====================================================================== //
    // Input                                                                  //
    // ====================================================================== //

    const pointers = new Map();

    function localPoint(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function stoneAt(wp, screenPt) {
      const tol = 26 / ppm;
      const check = (r) => r && r.body.distanceTo(wp) <= tol;
      if (check(state.pending)) return state.pending;
      if (check(state.current)) return state.current;
      return null;
    }

    function settledStoneAt(wp) {
      const tol = 12 / ppm;
      for (let i = state.stones.length - 1; i >= 0; i--) {
        if (state.stones[i].body.distanceTo(wp) <= tol) return state.stones[i];
      }
      return null;
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      if (state.screen !== "play") return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      const sp = localPoint(e);
      const wp = toWorldPt(sp.x, sp.y);
      pointers.set(e.pointerId, { sp, wp, role: null });
      unlockAudio();

      // first finger takes the stone
      if (!state.grab) {
        const rock = stoneAt(wp, sp);
        if (rock) {
          grabStone(rock, wp, e.pointerId);
          pointers.get(e.pointerId).role = "grab";
          state.hintTimer = 0;
          return;
        }
      }
      // a later finger either twists the held stone or steadies one below
      if (state.grab) {
        const steady = settledStoneAt(wp);
        if (steady) {
          steady.body.steadied = true;
          pointers.get(e.pointerId).role = "steady";
          pointers.get(e.pointerId).body = steady.body;
          haptic("light");
          return;
        }
        const gp = pointers.get(state.grab.pointerId);
        if (gp) {
          pointers.get(e.pointerId).role = "twist";
          const gb = state.grab.body;
          state.twist = {
            start: Math.atan2(sp.y - gp.sp.y, sp.x - gp.sp.x),
            angle0: gb.angle,
            id: e.pointerId
          };
          state.grab.angTarget = gb.angle;
        }
      }
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const sp = localPoint(e);
      p.sp = sp;
      p.wp = toWorldPt(sp.x, sp.y);
      if (p.role === "grab" && state.grab) {
        state.grab.target = p.wp;
      } else if (p.role === "twist" && state.grab && state.twist && state.twist.id === e.pointerId) {
        const gp = pointers.get(state.grab.pointerId);
        if (gp) {
          const a = Math.atan2(sp.y - gp.sp.y, sp.x - gp.sp.x);
          // screen y runs down, so a clockwise screen twist is negative in world
          state.grab.angTarget = state.twist.angle0 - (a - state.twist.start);
        }
      }
    }, { passive: false });

    function endPointer(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      if (p.role === "steady" && p.body) p.body.steadied = false;
      if (p.role === "twist" && state.grab) {
        state.grab.angTarget = null;
        state.twist = null;
      }
      if (p.role === "grab") {
        releaseStone();
        // any twisting finger left over stops twisting
        for (const [, q] of pointers) if (q.role === "twist") q.role = null;
        state.twist = null;
      }
    }
    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);
    ctx.listen(canvas, "lostpointercapture", endPointer);

    // ====================================================================== //
    // UI                                                                     //
    // ====================================================================== //

    const esc = (s) => String(s).replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    function el(tag, css, html) {
      const n = tag === "button" ? document.createElement("button") : document.createElement("div");
      if (css) n.style.cssText = css;
      if (html != null) n.innerHTML = html;
      return n;
    }
    const PANEL = "background:rgba(18,20,28,0.94);border-radius:22px;padding:22px 20px;" +
      "box-shadow:0 18px 50px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);";
    const BTN = "pointer-events:auto;border:0;border-radius:14px;padding:13px 20px;font-size:15px;" +
      "font-weight:700;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;";

    // ---- HUD ---------------------------------------------------------------
    const hud = el("div", "position:absolute;left:0;right:0;top:0;padding:10px 14px 0;" +
      "display:none;pointer-events:none;");
    ui.appendChild(hud);

    const hudTop = el("div", "display:flex;align-items:flex-start;justify-content:space-between;gap:8px;");
    hud.appendChild(hudTop);

    const hudLeft = el("div", "text-shadow:0 2px 10px rgba(0,0,0,0.55);");
    hudLeft.innerHTML =
      '<div id="cs" style="font-size:30px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;">0</div>' +
      '<div id="cd" style="font-size:12px;opacity:0.82;margin-top:4px;font-weight:600;">0 stones · 0 cm</div>';
    hudTop.appendChild(hudLeft);

    const hudMid = el("div", "text-align:center;flex:1;text-shadow:0 2px 10px rgba(0,0,0,0.55);");
    hudMid.innerHTML =
      '<div id="cm" style="font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;opacity:0.9;"></div>' +
      '<div id="cp" style="font-size:13px;margin-top:3px;letter-spacing:0.14em;"></div>';
    hudTop.appendChild(hudMid);

    const hudBtns = el("div", "display:flex;gap:7px;");
    const RB = "pointer-events:auto;width:36px;height:36px;border-radius:50%;border:0;cursor:pointer;" +
      "background:rgba(255,255,255,0.16);color:#fff;font-size:16px;line-height:36px;padding:0;" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);-webkit-tap-highlight-color:transparent;";
    const btnBoard = el("button", RB, "🏆");
    const btnHelp = el("button", RB, "?");
    const btnQuit = el("button", RB, "✕");
    hudBtns.appendChild(btnBoard);
    hudBtns.appendChild(btnHelp);
    hudBtns.appendChild(btnQuit);
    hudTop.appendChild(hudBtns);

    const hudScore = hudLeft.querySelector("#cs");
    const hudDetail = hudLeft.querySelector("#cd");
    const hudMode = hudMid.querySelector("#cm");
    const hudPips = hudMid.querySelector("#cp");

    function syncHud() {
      hudScore.textContent = String(state.score);
      const cm = Math.round(state.towerTop * 100);
      hudDetail.textContent = state.stones.length + " stone" +
        (state.stones.length === 1 ? "" : "s") + " · " + cm + " cm";
      hudMode.textContent = state.mode.name;
      hudPips.innerHTML = state.mode.slips > 0
        ? Array.from({ length: state.mode.slips }, (_, i) =>
            '<span style="opacity:' + (i < state.slips ? "0.95" : "0.22") + '">●</span>').join(" ")
        : '<span style="opacity:0.5;font-size:11px;letter-spacing:0.1em;">NO SLIPS</span>';
    }

    // ---- hint / toast ------------------------------------------------------
    const hint = el("div", "position:absolute;left:16px;right:16px;text-align:center;font-size:13px;" +
      "font-weight:600;opacity:0;transition:opacity 0.35s;text-shadow:0 2px 10px rgba(0,0,0,0.6);" +
      "pointer-events:none;");
    ui.appendChild(hint);
    let toastTimer = null;
    function toast(msg, ms) {
      hint.textContent = msg;
      hint.style.opacity = "1";
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { hint.style.opacity = "0"; }, ms || 1900);
    }

    // ---- menu --------------------------------------------------------------
    const menu = el("div", "position:absolute;inset:0;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;padding:24px 20px;pointer-events:auto;" +
      "background:linear-gradient(180deg,rgba(10,12,18,0.10),rgba(10,12,18,0.52));");
    ui.appendChild(menu);

    const menuInner = el("div", "width:100%;max-width:330px;text-align:center;");
    menu.appendChild(menuInner);
    menuInner.appendChild(el("div",
      "font-size:44px;font-weight:200;letter-spacing:0.34em;margin-left:0.34em;" +
      "text-shadow:0 4px 24px rgba(0,0,0,0.6);", "CAIRN"));
    menuInner.appendChild(el("div",
      "font-size:13px;opacity:0.75;margin-top:8px;margin-bottom:22px;font-weight:500;" +
      "text-shadow:0 2px 10px rgba(0,0,0,0.6);",
      "Balance stones. Breathe. Don't rush."));

    const cards = el("div", "display:flex;flex-direction:column;gap:10px;");
    menuInner.appendChild(cards);

    const modeCards = {};
    for (const id of MODE_ORDER) {
      const m = MODES[id];
      const card = el("button",
        "pointer-events:auto;display:flex;align-items:center;gap:13px;text-align:left;width:100%;" +
        "border:1px solid rgba(255,255,255,0.13);border-radius:17px;padding:13px 15px;cursor:pointer;" +
        "background:rgba(255,255,255,0.09);color:#f6f2ea;font-family:inherit;" +
        "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
        "-webkit-tap-highlight-color:transparent;");
      card.innerHTML =
        '<div style="font-size:24px;width:30px;text-align:center;flex:0 0 auto;">' + m.icon + "</div>" +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:16px;font-weight:700;">' + m.name +
            '<span style="opacity:0.5;font-weight:600;font-size:11px;margin-left:7px;">×' +
            m.mult.toFixed(1) + "</span></div>" +
          '<div style="font-size:11.5px;opacity:0.72;margin-top:2px;line-height:1.35;">' +
            esc(m.blurb) + "</div>" +
        "</div>" +
        '<div class="pb" style="font-size:11px;opacity:0.62;text-align:right;flex:0 0 auto;' +
          'font-variant-numeric:tabular-nums;"></div>';
      ctx.listen(card, "click", () => {
        unlockAudio();
        haptic("medium");
        startRun(id);
      });
      cards.appendChild(card);
      modeCards[id] = card;
    }

    const menuFoot = el("div", "margin-top:16px;display:flex;gap:9px;justify-content:center;");
    const btnHow = el("button", BTN + "background:rgba(255,255,255,0.14);color:#f6f2ea;", "How to play");
    const btnBoard2 = el("button", BTN + "background:rgba(255,255,255,0.14);color:#f6f2ea;", "🏆 Boards");
    menuFoot.appendChild(btnHow);
    menuFoot.appendChild(btnBoard2);
    menuInner.appendChild(menuFoot);

    const lifetimeLine = el("div", "margin-top:14px;font-size:11px;opacity:0.5;font-weight:600;");
    menuInner.appendChild(lifetimeLine);

    function refreshMenu() {
      for (const id of MODE_ORDER) {
        const pb = modeCards[id].querySelector(".pb");
        const b = state.best[id];
        pb.innerHTML = b ? '<div style="opacity:0.55;font-size:9.5px;letter-spacing:0.08em;">BEST</div>' +
          '<div style="font-size:14px;font-weight:700;opacity:0.9;">' + b + "</div>" : "";
      }
      lifetimeLine.textContent = state.lifetime
        ? state.lifetime.toLocaleString() + " stones balanced, all told"
        : "";
    }

    // ---- how to play -------------------------------------------------------
    const howPanel = el("div", "position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:22px;pointer-events:auto;background:rgba(8,9,14,0.86);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);");
    ui.appendChild(howPanel);
    const howBox = el("div", PANEL + "width:100%;max-width:340px;max-height:84%;overflow:auto;" +
      "font-size:13.5px;line-height:1.6;");
    howBox.innerHTML =
      '<div style="font-size:19px;font-weight:800;margin-bottom:11px;">How to balance</div>' +
      '<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;">' +
      "<li>👆 <b>Drag the glowing stone</b> onto the plinth, then onto the cairn.</li>" +
      "<li>✊ <b>Where you grab matters</b> — the stone hangs from your finger like a real one.</li>" +
      "<li>⬇️ <b>Press down gently to seat it.</b> Stay in the green on the bar; past the white line you'll shove the cairn over.</li>" +
      "<li>🤏 <b>Two fingers twist</b> the stone you're holding.</li>" +
      "<li>🖐 <b>A second finger steadies a lower stone</b> — your other hand. Priceless in a gust.</li>" +
      "<li>📏 <b>The dotted line is the cairn's weight.</b> Keep it over the plinth.</li>" +
      "<li>🪨 <b>Let go and watch it wobble.</b> When it goes quiet, it counts — grab it again before it settles if you must.</li>" +
      "<li>💎 Quartz and obsidian are slick and worth far more. Slate makes a fresh platform.</li>" +
      "<li>🪷 Zen forgives 3 slips, Tide 1, Storm none. Only a fallen cairn ends a run.</li>" +
      "</ul>";
    const howClose = el("button", BTN + "background:#f0e6d2;color:#1a1c24;width:100%;margin-top:14px;" +
      "position:sticky;bottom:-2px;box-shadow:0 -10px 18px rgba(18,20,28,0.94);", "Got it");
    howBox.appendChild(howClose);
    howPanel.appendChild(howBox);

    // ---- leaderboard -------------------------------------------------------
    const boardPanel = el("div", "position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:22px;pointer-events:auto;background:rgba(8,9,14,0.86);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);");
    ui.appendChild(boardPanel);
    ctx.listen(boardPanel, "click", (e) => {
      if (e.target === boardPanel) boardPanel.style.display = "none";
    });
    const boardBox = el("div", PANEL + "width:100%;max-width:340px;max-height:84%;overflow:auto;");
    boardPanel.appendChild(boardBox);

    // Entry shape is not pinned by the contract, so read every field defensively
    // and escape anything another player supplied.
    const bArr = (o) => !o ? [] : Array.isArray(o) ? o
      : (o.entries || o.rows || o.items || o.leaderboard || o.results ||
         (o.data && (o.data.entries || o.data.rows)) || []);
    const bSelf = (e) => !!(e && (e.self || e.isSelf || e.me || e.you || e.mine || e.isViewer || e.viewer));
    const bName = (e) => e.name || e.displayName || e.handle || e.username ||
      (e.user && (e.user.name || e.user.displayName || e.user.handle || e.user.username)) ||
      (bSelf(e) ? "You" : "Balancer");
    const bVal = (e) => e.label || e.formatted || e.valueLabel || e.display ||
      (typeof e.value === "number" ? e.value.toLocaleString() : (e.value != null ? String(e.value) : "—"));
    const bRank = (e, i) => e.rank != null ? e.rank : (e.position != null ? e.position : i + 1);

    function boardRow(rank, name, val, self) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:10px;' +
        (self ? "background:rgba(255,220,140,0.16);" : "") + '">' +
        '<div style="width:22px;text-align:right;font-weight:800;opacity:0.6;font-size:13px;">' +
          esc(rank) + "</div>" +
        '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
          'font-weight:600;font-size:14px;color:' + (self ? "#ffdf9c" : "#f2ede3") + ';">' +
          esc(name) + "</div>" +
        '<div style="font-variant-numeric:tabular-nums;font-weight:700;font-size:14px;">' +
          esc(val) + "</div></div>";
    }

    function renderBoard(lb) {
      const arr = bArr(lb);
      if (!arr.length) {
        return '<div style="opacity:0.72;text-align:center;padding:18px 0;font-size:13.5px;">' +
          "No cairns here yet — build the first one. 🪨</div>";
      }
      const top = arr.slice(0, 8);
      let html = top.map((e, i) => boardRow(bRank(e, i), bName(e), bVal(e), bSelf(e))).join("");
      const me = (lb && (lb.you || lb.self || lb.viewer || lb.me)) || arr.find(bSelf);
      if (me && !top.some(bSelf)) {
        html += '<div style="height:1px;background:rgba(255,255,255,0.12);margin:7px 2px;"></div>' +
          boardRow(bRank(me, arr.indexOf(me)), bName(me), bVal(me), true);
      }
      return html;
    }

    let boardMode = "zen";
    async function openBoard(modeId) {
      boardMode = modeId || boardMode;
      boardPanel.style.display = "flex";
      haptic("light");
      const tabs = MODE_ORDER.map((id) =>
        '<button data-m="' + id + '" style="pointer-events:auto;flex:1;border:0;cursor:pointer;' +
        "border-radius:11px;padding:8px 4px;font-family:inherit;font-size:12.5px;font-weight:700;" +
        "background:" + (id === boardMode ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)") +
        ";color:" + (id === boardMode ? "#fff" : "rgba(246,242,234,0.6)") + ';">' +
        MODES[id].icon + " " + MODES[id].name + "</button>").join("");
      const head =
        '<div style="font-size:18px;font-weight:800;margin-bottom:3px;">🏆 Tallest Cairns</div>' +
        '<div style="opacity:0.55;font-size:11.5px;margin-bottom:12px;">Global · all time</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:13px;">' + tabs + "</div>";
      boardBox.innerHTML = head +
        '<div style="opacity:0.7;padding:16px 0;text-align:center;font-size:13px;">Loading…</div>';
      wireBoardTabs();

      let inner;
      try {
        const lb = await ctx.memory.record(MODES[boardMode].channel)
          .leaderboard({ scope: "global", period: "all_time" });
        inner = renderBoard(lb);
      } catch (_) {
        inner = '<div style="opacity:0.7;text-align:center;padding:16px 0;font-size:13px;">' +
          "The board isn't reachable right now.</div>";
      }
      if (boardPanel.style.display === "none") return;
      boardBox.innerHTML = head + inner +
        '<div style="text-align:center;margin-top:15px;opacity:0.5;font-size:12px;">Tap outside to close</div>';
      wireBoardTabs();
    }
    function wireBoardTabs() {
      for (const b of boardBox.querySelectorAll("button[data-m]")) {
        ctx.listen(b, "click", () => openBoard(b.dataset.m));
      }
    }

    // ---- game over ---------------------------------------------------------
    const overPanel = el("div", "position:absolute;inset:0;display:none;align-items:center;" +
      "justify-content:center;padding:22px;pointer-events:auto;" +
      "background:linear-gradient(180deg,rgba(8,9,14,0.28),rgba(8,9,14,0.66));");
    ui.appendChild(overPanel);
    const overBox = el("div", PANEL + "width:100%;max-width:320px;text-align:center;");
    overPanel.appendChild(overBox);

    function showOver(reason) {
      hint.style.opacity = "0";           // no stale slip toast under the card
      const cm = Math.round(state.towerTop * 100);
      const best = state.best[state.mode.id] || 0;
      const isBest = state.score > best;
      overBox.innerHTML =
        '<div style="font-size:13px;opacity:0.7;font-weight:600;">' + esc(reason) + "</div>" +
        '<div style="font-size:52px;font-weight:800;line-height:1.15;margin:6px 0 2px;' +
          'font-variant-numeric:tabular-nums;">' + state.score + "</div>" +
        '<div style="font-size:13px;opacity:0.78;font-weight:600;">' +
          state.placed + " stone" + (state.placed === 1 ? "" : "s") +
          " · " + cm + " cm · " + state.mode.name + "</div>" +
        (isBest
          ? '<div style="margin-top:11px;font-size:13px;font-weight:800;color:#ffdf9c;">✨ New personal best</div>'
          : '<div style="margin-top:11px;font-size:12px;opacity:0.55;">Best ' + best + "</div>") +
        '<div id="sub" style="margin-top:9px;font-size:11.5px;opacity:0.5;">Sending to the board…</div>';
      const row = el("div", "display:flex;gap:8px;margin-top:16px;");
      const again = el("button", BTN + "flex:1;background:#f0e6d2;color:#1a1c24;", "Again");
      const boards = el("button", BTN + "background:rgba(255,255,255,0.14);color:#f6f2ea;", "🏆");
      const menuB = el("button", BTN + "background:rgba(255,255,255,0.14);color:#f6f2ea;", "☰");
      ctx.listen(again, "click", () => { haptic("medium"); startRun(state.mode.id); });
      ctx.listen(boards, "click", () => openBoard(state.mode.id));
      ctx.listen(menuB, "click", () => { haptic("light"); toMenu(); });
      row.appendChild(again); row.appendChild(boards); row.appendChild(menuB);
      overBox.appendChild(row);
      showScreen("over");
    }

    function showScreen(which) {
      menu.style.display = which === "menu" ? "flex" : "none";
      hud.style.display = which === "play" ? "block" : "none";
      overPanel.style.display = which === "over" ? "flex" : "none";
      if (which === "menu") refreshMenu();
    }

    function toMenu() {
      state.screen = "menu";
      state.phase = "idle";
      state.pending = null;
      state.current = null;
      state.grab = null;
      decorate();                     // a fresh still-life cairn behind the menu
      cam.y = 0; cam.zoom = 1;
      stopMusic();
      showScreen("menu");
    }

    ctx.listen(btnHelp, "click", () => { howPanel.style.display = "flex"; haptic("light"); });
    ctx.listen(btnHow, "click", () => { howPanel.style.display = "flex"; haptic("light"); });
    ctx.listen(howClose, "click", () => { howPanel.style.display = "none"; });
    ctx.listen(howPanel, "click", (e) => { if (e.target === howPanel) howPanel.style.display = "none"; });
    ctx.listen(btnBoard, "click", () => openBoard(state.mode.id));
    ctx.listen(btnBoard2, "click", () => openBoard(boardMode));
    ctx.listen(btnQuit, "click", () => { haptic("light"); toMenu(); });

    // ====================================================================== //
    // Persistence + leaderboard submit                                       //
    // ====================================================================== //

    async function loadProgress() {
      if (!ctx.capabilities.storage) return;
      try {
        const s = await ctx.storage.get("cairn");
        if (s && typeof s === "object") {
          state.best = s.best || {};
          state.lifetime = s.lifetime || 0;
        }
      } catch (_) {}
    }

    async function saveProgress() {
      if (state.score > (state.best[state.mode.id] || 0)) state.best[state.mode.id] = state.score;
      if (!ctx.capabilities.storage) return;
      try {
        await ctx.storage.set("cairn", { best: state.best, lifetime: state.lifetime });
      } catch (_) {}
    }

    async function submitScore() {
      const note = overBox.querySelector("#sub");
      if (state.score <= 0) { if (note) note.textContent = ""; return; }
      try {
        await ctx.memory.record(state.mode.channel).submit(state.score, {
          label: state.score + " pts · " + state.placed + " stones"
        });
        if (note) note.textContent = "On the " + state.mode.name + " board 🏆";
      } catch (_) {
        if (note) note.textContent = "Couldn't reach the board — score saved locally.";
      }
    }

    // ====================================================================== //
    // Boot                                                                   //
    // ====================================================================== //

    /**
     * A still-life cairn for the menu, so the very first frame already has
     * stones in it. Each stone is seated on the real footprint of the one below
     * (not its bounding radius, which would leave it hanging), then the whole
     * thing is simulated to rest before anything is drawn.
     */
    function decorate(attempt) {
      state.stones = [];
      state.loose = [];
      state.world = buildWorld();
      let top = 0;
      for (let i = 0; i < 4; i++) {
        const r = makeStone(i);
        const b = r.body;
        // sit it on its broadest face, the way a balancer would choose
        let best = null;
        for (const ra of b.restAngles) if (!best || ra.w > best.w) best = ra;
        b.angle = (best ? best.angle : 0) + rnd(-0.05, 0.05);
        b.pos = { x: rnd(-0.025, 0.025), y: 0 };
        b.sync();
        b.pos.y = top - b.miny + 0.004;      // sit its lowest point on the stone below
        b.sync();
        top = b.maxy;
        state.world.add(b);
        state.stones.push(r);
      }
      // let it settle before anything is drawn
      for (let i = 0; i < 420; i++) state.world.step(SUBSTEP);
      state.world.impacts.length = 0;

      // an irregular stone can present a sloped top and shed the one above it;
      // if the still-life shed anything, just draw again
      const kept = state.stones.filter((r) => r.body.pos.y > 0 && Math.abs(r.body.pos.x) < 0.5);
      if (kept.length < 4 && (attempt || 0) < 6) { decorate((attempt || 0) + 1); return; }

      for (const b of state.world.bodies) { b.vel = { x: 0, y: 0 }; b.angVel = 0; }
      let hi = 0;
      for (const r of state.stones) hi = Math.max(hi, r.body.maxy);
      state.towerTop = hi;
    }
    decorate();

    function layout() {
      const sa = SA();
      hud.style.paddingTop = (sa.top + 10) + "px";
      hud.style.paddingLeft = (sa.left + 14) + "px";
      hud.style.paddingRight = (sa.right + 14) + "px";
      hint.style.bottom = (sa.bottom + 84) + "px";
      menu.style.paddingTop = (sa.top + 24) + "px";
      menu.style.paddingBottom = (sa.bottom + 24) + "px";
    }

    updateProjection();
    layout();
    render(0, 0);
    ctx.markVisualReady("first-scene");
    showScreen("menu");
    await loadProgress();
    refreshMenu();

    let clock = 0;
    ctx.onFrame((dtMs, timeMs) => {
      const dt = Math.min(dtMs, 50) / 1000;
      clock = timeMs;
      layout();

      let windAmt = 0;
      if (state.screen === "play") {
        state.runMs += dtMs;
        positionPending(timeMs);
        windAmt = updatePhysics(dt, timeMs) || 0;
        if (state.hintTimer > 0) {
          state.hintTimer -= dt;
          if (state.hintTimer <= 0) toast("Drag the glowing stone down", 2600);
        }
      } else if (state.screen === "over") {
        // let the wreckage keep tumbling behind the card
        windAmt = updatePhysics(dt, timeMs) || 0;
      } else {
        // menu: the still-life cairn just breathes
        accum += Math.min(dt, 0.05);
        let n = 0;
        while (accum >= SUBSTEP && n < 3) { state.world.step(SUBSTEP); accum -= SUBSTEP; n++; }
        state.world.impacts.length = 0;
      }

      stepParticles(dt, state.mode, windAmt);
      updateCamera(dt);
      if (state.screen === "play") syncHud();
      render(timeMs, windAmt);
    });

    ctx.platform.ready();
  }
};
