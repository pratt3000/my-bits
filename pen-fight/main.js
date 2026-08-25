/**
 * Pen Fight — the desk game, with real rigid-body physics.
 *
 * Two pens on a polished table. You flick yours; the opponent flicks back. The
 * aim is to push their pen off the edge without losing yours.
 *
 * The physics is the whole point, so it is written out rather than faked:
 *
 *  - A pen is a capsule (a segment with a radius) sliding on a plane. State is
 *    position, velocity, angle and angular velocity — three degrees of freedom.
 *  - A flick is an impulse J applied at the point you actually touched. That
 *    gives dv = J/m and dw = (r x J)/I, so touching the tip spins the pen and
 *    touching the balance point drives it straight. Nothing special-cases this;
 *    it falls out of applying the impulse off the centre of mass.
 *  - Table friction is integrated along the pen rather than applied as a single
 *    drag term, so a pen that is both sliding and spinning loses both together
 *    and stops all at once, the way a real one does.
 *  - Pen-on-pen contact is a capsule/capsule closest-point test resolved with a
 *    normal impulse plus a Coulomb friction impulse, both including the angular
 *    terms — so glancing hits spin the target instead of driving it.
 *  - A rod is rigid, so it does not droop when it hangs over the edge. It stays
 *    flat until its centre of mass crosses, then it tips. The tension of a pen
 *    hanging half off the table is real, not an animation.
 *
 * Tuned so one flick almost never ends it: full power carries a pen roughly one
 * table length, and an equal-mass collision at e = 0.38 passes on well under
 * half the speed. Knocking someone off takes several good hits, or one very
 * well-set-up one.
 *
 * Renderer: three@0.164.1 (ES module via ctx.importModule). Every texture and
 * every sound is generated in-file — packaged assets are disabled.
 */
window.plethoraBit = {
  meta: {
    title: "Pen Fight",
    runtime: "plethora-bit@2",
    tags: ["3d", "physics", "game", "duel", "flick"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage"]
  },

  async init(ctx) {
    // ===================================================================== //
    // 0. Helpers                                                            //
    // ===================================================================== //
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;

    // Offscreen surfaces for texture bakes. The runtime owns every canvas in
    // the DOM, so bakes go to an OffscreenCanvas; if the WebView lacks it we
    // fall back to a hidden SDK canvas rather than losing the texture.
    const CAN_BAKE = typeof OffscreenCanvas === "function";
    function surface(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (CAN_BAKE) {
        try { return new OffscreenCanvas(w, h); } catch (_) { /* fall through */ }
      }
      const c = ctx.createCanvas2D();
      c.style.display = "none";
      c.width = w; c.height = h;
      return c;
    }

    // ===================================================================== //
    // 1. Immediate first frame — a styled title card, before Three streams in //
    // ===================================================================== //
    // The render surface is claimed first so the UI root lands on top of it in
    // the container; the title card has to sit over the scene, not under it.
    const canvas = ctx.createCanvas({ touchAction: "none" });
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.zIndex = "5";
    // The overlay sits above the render surface, so it has to be transparent to
    // touch or it eats every flick. The curtain re-enables hits for itself.
    ui.style.pointerEvents = "none";
    const SAFE_B = Math.max(ctx.safeArea && ctx.safeArea.bottom || 0, 0);
    const SAFE_T = Math.max(ctx.safeArea && ctx.safeArea.top || 0, 0);

    const GOLD = "#f0c453";
    const GOLD_DIM = "#a9822f";
    const INK = "#0d0b08";

    ui.innerHTML =
      // Transparent and inert, so flicks reach the canvas underneath. Only the
      // curtain takes pointer events, and only while it is up.
      '<div data-el="stage" style="position:absolute;inset:0;overflow:hidden;pointer-events:none;' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;' +
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;color:#f6ecd8;">' +

      // HUD: scores + turn banner
      '<div data-el="hud" style="position:absolute;left:0;right:0;top:' + (SAFE_T + 10) + 'px;' +
      'display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;opacity:0;' +
      'transition:opacity .45s ease;z-index:3;"></div>' +

      // Centre toast (round results)
      '<div data-el="toast" style="position:absolute;left:0;right:0;top:44%;text-align:center;' +
      'pointer-events:none;opacity:0;transition:opacity .3s ease,transform .3s ease;z-index:4;"></div>' +

      // Bottom hint, held above the home indicator
      '<div data-el="hint" style="position:absolute;left:16px;right:16px;bottom:' + (SAFE_B + 16) + 'px;' +
      'text-align:center;font-size:13px;letter-spacing:.055em;text-transform:uppercase;' +
      'color:rgba(246,236,216,.5);pointer-events:none;opacity:0;transition:opacity .35s ease;z-index:3;"></div>' +

      // Title / start / game-over curtain
      '<div data-el="curtain" style="position:absolute;inset:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:18px;text-align:center;padding:32px;z-index:6;' +
      'pointer-events:auto;' +
      'background:radial-gradient(120% 90% at 50% 26%,#241a10 0%,#120d08 48%,#070505 100%);' +
      'transition:opacity .4s ease;">' +
      '<div data-el="ctitle" style="font-size:clamp(44px,15vw,86px);line-height:.9;letter-spacing:.02em;' +
      'font-weight:700;background:linear-gradient(180deg,#fff3cf 0%,' + GOLD + ' 42%,#8f6a22 100%);' +
      '-webkit-background-clip:text;background-clip:text;color:transparent;' +
      'filter:drop-shadow(0 4px 18px rgba(240,196,83,.28));">PEN<br>FIGHT</div>' +
      '<div data-el="csub" style="font-size:14px;line-height:1.65;max-width:19em;' +
      'color:rgba(246,236,216,.62);letter-spacing:.01em;">' +
      'Flick your gold pen. Knock theirs off the table.<br>' +
      'Where you touch it decides how it turns.</div>' +
      '<div data-el="cbtn" style="margin-top:6px;padding:14px 34px;border-radius:999px;' +
      'border:1px solid rgba(240,196,83,.45);background:linear-gradient(180deg,rgba(240,196,83,.2),rgba(240,196,83,.06));' +
      'font-size:14px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:' + GOLD + ';' +
      'box-shadow:0 8px 30px rgba(240,196,83,.14),inset 0 1px 0 rgba(255,240,200,.25);">Tap to play</div>' +
      '<div data-el="cnote" style="font-size:12px;color:rgba(246,236,216,.34);letter-spacing:.05em;"></div>' +
      "</div></div>";

    const elHud = ui.querySelector('[data-el="hud"]');
    const elToast = ui.querySelector('[data-el="toast"]');
    const elHint = ui.querySelector('[data-el="hint"]');
    const elCurtain = ui.querySelector('[data-el="curtain"]');
    const elCTitle = ui.querySelector('[data-el="ctitle"]');
    const elCSub = ui.querySelector('[data-el="csub"]');
    const elCBtn = ui.querySelector('[data-el="cbtn"]');
    const elCNote = ui.querySelector('[data-el="cnote"]');

    ctx.markVisualReady("title");
    ctx.platform.ready();

    // Display font, best-effort — the card already reads fine without it.
    (async () => {
      try {
        await ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0", { weight: "400" });
        elCTitle.style.fontFamily = "'Bebas Neue', Impact, sans-serif";
        elCTitle.style.letterSpacing = ".04em";
      } catch (_) { /* system font is fine */ }
      try { await ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" }); } catch (_) {}
    })();

    function fatal(where, err) {
      elCTitle.innerHTML = "OOPS";
      elCSub.textContent = "Could not start (" + where + ").";
      elCNote.textContent = String(err && err.message || err || "");
      elCBtn.style.display = "none";
      try { ctx.platform.error({ where: where, message: String(err && err.message || err) }); } catch (_) {}
    }

    // ===================================================================== //
    // 2. Three.js                                                           //
    // ===================================================================== //
    let THREE;
    const THREE_URL = "https://libs.plethora.studio/three/0.164.1/three.module.js";
    try {
      THREE = await ctx.importModule("three", "0.164.1");
    } catch (e1) {
      try { THREE = await ctx.importModule(THREE_URL); }
      catch (e2) { fatal("load three", e2 || e1); return; }
    }
    if (THREE && !THREE.WebGLRenderer && THREE.default) THREE = THREE.default;
    if (!THREE || !THREE.WebGLRenderer) { fatal("three exports", new Error("WebGLRenderer missing")); return; }

    try {

    // ===================================================================== //
    // 3. World constants (SI units, metres and kilograms)                   //
    // ===================================================================== //
    const PEN_LEN = 0.148;          // 14.8 cm, a normal ballpoint
    const PEN_RAD = 0.0056;         // 5.6 mm barrel radius
    const PEN_MASS = 0.0092;        // 9.2 g
    const PEN_I = PEN_MASS * PEN_LEN * PEN_LEN / 12;   // thin rod about its centre
    const G = 9.81;

    const MU_TABLE = 0.33;          // pen on polished wood
    const MU_PEN = 0.22;            // pen on pen
    const REST_PEN = 0.34;          // hollow plastic, moderately lively

    // Deeper than it is wide, so the playfield suits a portrait screen and the
    // duel runs up and down the frame rather than across it.
    const TABLE_HX = 0.215;         // half-width  (screen left/right)
    const TABLE_HY = 0.36;          // half-depth  (screen near/far)
    const TABLE_TOP = 0;            // play surface sits at y = 0
    const TABLE_THICK = 0.028;
    // Kept shallow on purpose: a knocked-off pen is the best moment in the game,
    // and a full desk-height drop carries it out of frame before it lands.
    const FLOOR_Y = -0.34;

    // The difficulty dial. At V_MAX a pen coasts 0.53 m, a shade less than the
    // 0.59 m from the start line to the far lip — so a full-power flick down an
    // open table is committed but survivable. It also caps how hard you can ever
    // arrive at the opponent (~0.67 m/s across the opening gap), which after an
    // e = 0.34 exchange moves them about 3 cm. They sit 13 cm from the edge, so
    // a knock-off is four or so clean hits — or one from close range, once you
    // have walked them back. That is the shape of the real game.
    const V_MAX = 1.85;
    const J_MAX = PEN_MASS * V_MAX;
    // A fingertip is a patch, not a point, and it keeps pushing as the pen turns
    // away — so real flicks impart less spin than an ideal point impulse. This
    // scales the angular term only; the "tip spins, centre drives" split stays.
    const SPIN_TRANSFER = 0.55;
    const SPIN_SOFT_CAP = 46;       // rad/s, soft-limited

    // 2D physics plane -> world: (x, y) maps to (x, height, -y).
    // So 2D +y is the far side of the table and 2D -y is the player's side.
    const toWorldX = (p) => p.x;
    const toWorldZ = (p) => -p.y;

    // ===================================================================== //
    // 4. Rigid bodies                                                       //
    // ===================================================================== //
    class Pen {
      constructor(side) {
        this.side = side;                 // "you" | "cpu"
        this.x = 0; this.y = 0;           // centre of mass, table plane
        this.vx = 0; this.vy = 0;
        this.a = 0;                       // heading; axis = (cos a, sin a)
        this.w = 0;                       // angular velocity, +ccw
        this.L = PEN_LEN; this.rad = PEN_RAD;
        this.m = PEN_MASS; this.I = PEN_I;
        this.alive = true;                // still on the table
        this.fall = null;                 // free 3D state once it tips
        this.mesh = null;
        this.glow = null;
        this.slide = 0;                   // for the sliding sound bed
      }
      get ax() { return Math.cos(this.a); }
      get ay() { return Math.sin(this.a); }
      /** World-plane point at signed offset s along the axis from the centre. */
      pointAt(s) { return { x: this.x + this.ax * s, y: this.y + this.ay * s }; }
      ends() { return [this.pointAt(-this.L / 2), this.pointAt(this.L / 2)]; }
      speed() { return Math.hypot(this.vx, this.vy); }
      moving() { return this.speed() > 0.006 || Math.abs(this.w) > 0.09; }
      /** Velocity of the material point at offset r from the centre of mass. */
      velAt(rx, ry) { return { x: this.vx - this.w * ry, y: this.vy + this.w * rx }; }

      /** Apply impulse (jx, jy) at world-plane point p. The whole game is here. */
      impulseAt(p, jx, jy) {
        const rx = p.x - this.x, ry = p.y - this.y;
        this.vx += jx / this.m;
        this.vy += jy / this.m;
        const torque = rx * jy - ry * jx;                 // 2D cross product
        this.w += (torque / this.I) * SPIN_TRANSFER;
        // Soft-limit spin so a dead-on tip strike stays readable, never clipped.
        const s = Math.abs(this.w);
        if (s > SPIN_SOFT_CAP) {
          this.w = Math.sign(this.w) * (SPIN_SOFT_CAP + (s - SPIN_SOFT_CAP) * 0.25);
        }
      }
    }

    const you = new Pen("you");
    const cpu = new Pen("cpu");
    const pens = [you, cpu];

    /**
     * Coulomb friction integrated along the pen instead of applied at the
     * centre. Each sample carries m/N of the load, drags against its own local
     * velocity, and contributes both force and torque. That coupling is why a
     * pen that is spinning and sliding settles out of both at the same moment.
     */
    const FRIC_N = 9;
    function tableFriction(p, dt) {
      const ax = p.ax, ay = p.ay;
      const share = p.m / FRIC_N;
      const jCap = MU_TABLE * share * G * dt;   // friction impulse per sample
      let Jx = 0, Jy = 0, T = 0;
      for (let i = 0; i < FRIC_N; i++) {
        const s = (-0.5 + (i + 0.5) / FRIC_N) * p.L;
        const rx = ax * s, ry = ay * s;
        const vx = p.vx - p.w * ry;
        const vy = p.vy + p.w * rx;
        const sp = Math.hypot(vx, vy);
        if (sp < 1e-7) continue;
        // Never let a sample's friction reverse the motion it is opposing.
        const j = Math.min(jCap, share * sp);
        const fx = -j * vx / sp, fy = -j * vy / sp;
        Jx += fx; Jy += fy;
        T += rx * fy - ry * fx;
      }
      p.vx += Jx / p.m;
      p.vy += Jy / p.m;
      p.w += T / p.I;
      if (Math.hypot(p.vx, p.vy) < 0.004) { p.vx = 0; p.vy = 0; }
      if (Math.abs(p.w) < 0.06) p.w = 0;
    }

    /**
     * Closest points between segments p1q1 and p2q2 (Ericson, Real-Time CD),
     * with the parallel case handled rather than shrugged off.
     *
     * Two parallel pens touch along a band, not at a point, and the textbook
     * routine's degenerate fallback picks an arbitrary end of it. Resolving a
     * broadside hit at one tip is badly wrong — it dumps the energy into spin
     * instead of driving the pen — and broadside is exactly how pens start a
     * round. So when the axes are parallel we take the middle of the overlap,
     * which is where the resultant of a distributed contact actually acts.
     */
    function segSeg(p1, q1, p2, q2) {
      const d1x = q1.x - p1.x, d1y = q1.y - p1.y;
      const d2x = q2.x - p2.x, d2y = q2.y - p2.y;
      const rx = p1.x - p2.x, ry = p1.y - p2.y;
      const a = d1x * d1x + d1y * d1y;
      const e = d2x * d2x + d2y * d2y;
      const f = d2x * rx + d2y * ry;
      let s, t;
      const EPS = 1e-12;
      if (a <= EPS && e <= EPS) { s = 0; t = 0; }
      else if (a <= EPS) { s = 0; t = clamp(f / e, 0, 1); }
      else if (e <= EPS) { t = 0; s = clamp(-(d1x * rx + d1y * ry) / a, 0, 1); }
      else {
        const c = d1x * rx + d1y * ry;
        const b = d1x * d2x + d1y * d2y;
        const denom = a * e - b * b;                 // = a*e*sin^2(angle)
        if (denom <= 1e-8 * a * e) {
          // Parallel. Overlap of B projected onto A, in A's parameter space.
          const u0 = -c / a, u1 = (b - c) / a;
          const lo = Math.max(0, Math.min(u0, u1));
          const hi = Math.min(1, Math.max(u0, u1));
          s = hi >= lo ? (lo + hi) / 2 : (u0 < 0 ? 0 : 1);
          t = clamp((b * s + f) / e, 0, 1);
        } else {
          s = clamp((b * f - c * e) / denom, 0, 1);
          t = (b * s + f) / e;
          if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
          else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
        }
      }
      return {
        c1: { x: p1.x + d1x * s, y: p1.y + d1y * s },
        c2: { x: p2.x + d2x * t, y: p2.y + d2y * t }
      };
    }

    let lastHit = 0;                 // impulse magnitude of the last contact
    let lastHitAt = null;

    /** Capsule/capsule contact with normal + friction impulses and drift fix. */
    function collide(A, B) {
      if (!A.alive || !B.alive) return 0;
      const [a0, a1] = A.ends();
      const [b0, b1] = B.ends();
      const cp = segSeg(a0, a1, b0, b1);
      let dx = cp.c2.x - cp.c1.x, dy = cp.c2.y - cp.c1.y;
      let d = Math.hypot(dx, dy);
      const R = A.rad + B.rad;
      if (d >= R) return 0;

      let nx, ny;
      if (d > 1e-9) { nx = dx / d; ny = dy / d; }
      else { nx = -A.ay; ny = A.ax; d = 0; }        // exactly overlapping axes

      // Split the overlap by inverse mass (equal here, so half each).
      const overlap = (R - d) * 0.8;
      const invA = 1 / A.m, invB = 1 / B.m, invSum = invA + invB;
      A.x -= nx * overlap * (invA / invSum); A.y -= ny * overlap * (invA / invSum);
      B.x += nx * overlap * (invB / invSum); B.y += ny * overlap * (invB / invSum);

      const cx = (cp.c1.x + cp.c2.x) / 2, cy = (cp.c1.y + cp.c2.y) / 2;
      const rax = cx - A.x, ray = cy - A.y;
      const rbx = cx - B.x, rby = cy - B.y;
      const va = A.velAt(rax, ray), vb = B.velAt(rbx, rby);
      const rvx = vb.x - va.x, rvy = vb.y - va.y;
      const vn = rvx * nx + rvy * ny;
      if (vn > 0) return 0;                          // already separating

      const rcA = rax * ny - ray * nx;
      const rcB = rbx * ny - rby * nx;
      const kN = invA + invB + rcA * rcA / A.I + rcB * rcB / B.I;
      const j = -(1 + REST_PEN) * vn / kN;

      A.vx -= j * nx * invA; A.vy -= j * ny * invA; A.w -= j * rcA / A.I;
      B.vx += j * nx * invB; B.vy += j * ny * invB; B.w += j * rcB / B.I;

      // Tangential Coulomb friction — this is what turns glancing hits into spin.
      const tx = -ny, ty = nx;
      const va2 = A.velAt(rax, ray), vb2 = B.velAt(rbx, rby);
      const vt = (vb2.x - va2.x) * tx + (vb2.y - va2.y) * ty;
      const rtA = rax * ty - ray * tx;
      const rtB = rbx * ty - rby * tx;
      const kT = invA + invB + rtA * rtA / A.I + rtB * rtB / B.I;
      let jt = -vt / kT;
      const cap = MU_PEN * Math.abs(j);
      jt = clamp(jt, -cap, cap);

      A.vx -= jt * tx * invA; A.vy -= jt * ty * invA; A.w -= jt * rtA / A.I;
      B.vx += jt * tx * invB; B.vy += jt * ty * invB; B.w += jt * rtB / B.I;

      lastHitAt = { x: cx, y: cy };
      return Math.abs(j);
    }

    /**
     * A rigid rod does not sag over an edge — it is held flat until its centre
     * of mass passes the lip, then it goes. So the test really is just "is the
     * centre of mass still over the table", and the drama of a pen hanging half
     * off is honest rather than staged.
     */
    function offTable(p) {
      return Math.abs(p.x) > TABLE_HX || Math.abs(p.y) > TABLE_HY;
    }
    /** How much of the pen is out past the lip, 0..1 — used for the edge glow. */
    function overhang(p) {
      let out = 0;
      for (let i = 0; i < 12; i++) {
        const s = (-0.5 + (i + 0.5) / 12) * p.L;
        const q = p.pointAt(s);
        if (Math.abs(q.x) > TABLE_HX || Math.abs(q.y) > TABLE_HY) out++;
      }
      return out / 12;
    }

    // --- once a pen tips, it leaves the 2D world and falls in full 3D ------
    function startFall(p) {
      p.alive = false;
      // Outward normal of the edge it went over.
      const ox = Math.abs(p.x) > TABLE_HX ? Math.sign(p.x) : 0;
      const oy = Math.abs(p.y) > TABLE_HY ? Math.sign(p.y) : 0;
      let nx = ox, ny = oy;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;

      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.a);
      // Topple axis: horizontal, perpendicular to the outward normal, signed so
      // the overhanging end swings down rather than up. With outward direction
      // o = (nx, 0, -ny) in world, that axis is (-ny, 0, -nx). Speed going over
      // the lip sets how hard it cartwheels.
      const outSpeed = Math.max(0.12, p.vx * nx + p.vy * ny);
      const axis = new THREE.Vector3(-ny, 0, -nx).normalize();
      p.fall = {
        pos: new THREE.Vector3(toWorldX(p), TABLE_TOP + p.rad, toWorldZ(p)),
        vel: new THREE.Vector3(p.vx, 0.02, -p.vy),
        quat: q,
        spin: axis.multiplyScalar(4.5 + outSpeed * 7).add(new THREE.Vector3(0, p.w * 0.35, 0)),
        rest: 0,
        bounces: 0
      };
      p.vx = p.vy = p.w = 0;
    }

    function stepFall(p, dt) {
      const f = p.fall;
      f.vel.y -= G * dt;
      f.pos.addScaledVector(f.vel, dt);
      const sp = f.spin.length();
      if (sp > 1e-5) {
        const dq = new THREE.Quaternion().setFromAxisAngle(f.spin.clone().normalize(), sp * dt);
        f.quat.premultiply(dq);
      }
      const rest = FLOOR_Y + p.rad;
      if (f.pos.y < rest) {
        f.pos.y = rest;
        if (f.vel.y < -0.25) {
          f.vel.y = -f.vel.y * 0.3;
          f.vel.x *= 0.62; f.vel.z *= 0.62;
          f.spin.multiplyScalar(0.5);
          f.bounces++;
          sfxClatter(clamp(Math.abs(f.vel.y) * 1.6, 0.12, 0.9));
        } else {
          f.vel.set(f.vel.x * 0.85, 0, f.vel.z * 0.85);
          f.spin.multiplyScalar(0.85);
          if (f.vel.lengthSq() < 1e-4) { f.vel.set(0, 0, 0); f.spin.set(0, 0, 0); f.rest = 1; }
        }
      }
    }

    // ===================================================================== //
    // 5. Simulation driver                                                  //
    // ===================================================================== //
    let fellThisTurn = null;                 // first pen to leave the table

    function simulate(dt) {
      // Substep small enough that no pen advances more than ~3 mm, well under
      // the 11 mm a capsule would need to pass through another.
      let vmax = 0;
      for (const p of pens) if (p.alive) vmax = Math.max(vmax, p.speed() + Math.abs(p.w) * p.L * 0.5);
      const steps = clamp(Math.ceil((vmax * dt) / 0.003), 1, 24);
      const h = dt / steps;

      for (let k = 0; k < steps; k++) {
        for (const p of pens) {
          if (!p.alive) continue;
          tableFriction(p, h);
          p.x += p.vx * h;
          p.y += p.vy * h;
          p.a += p.w * h;
        }
        const j = collide(you, cpu);
        if (j > 0) onClack(j);
        for (const p of pens) {
          if (p.alive && offTable(p)) {
            startFall(p);
            if (!fellThisTurn) fellThisTurn = p;
            onKnockOff(p);
          }
        }
      }
      for (const p of pens) if (!p.alive && p.fall && !p.fall.rest) stepFall(p, dt);
    }

    function anyMoving() {
      for (const p of pens) {
        if (p.alive && p.moving()) return true;
        if (!p.alive && p.fall && !p.fall.rest) return true;
      }
      return false;
    }

    // ===================================================================== //
    // 6. Audio — everything synthesised, nothing packaged                   //
    // ===================================================================== //
    let ac = null, master = null, noiseBuf = null, audioDead = false;
    let slideSrc = null, slideGain = null, slideFilt = null;
    let musicHandle = null;

    function buildAudio() {
      if (ac || audioDead) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { audioDead = true; return null; }
      try { ac = new AC(); } catch (_) { audioDead = true; return null; }

      master = ac.createGain();
      master.gain.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -15; comp.ratio.value = 3.6;
      comp.attack.value = 0.002; comp.release.value = 0.22;
      master.connect(comp); comp.connect(ac.destination);

      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      // Persistent bed: pen sliding on wood, gain driven by speed each frame.
      slideFilt = ac.createBiquadFilter();
      slideFilt.type = "bandpass";
      slideFilt.frequency.value = 1750;
      slideFilt.Q.value = 0.85;
      slideGain = ac.createGain();
      slideGain.gain.value = 0;
      slideSrc = ac.createBufferSource();
      slideSrc.buffer = noiseBuf; slideSrc.loop = true;
      slideSrc.connect(slideFilt); slideFilt.connect(slideGain); slideGain.connect(master);
      try { slideSrc.start(0); } catch (_) {}
      return ac;
    }

    function env(g, t, peak, atk, dec) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
    }

    /**
     * Pen on pen: a hollow plastic tube struck. A hard noise transient for the
     * contact, then two short inharmonic tube modes. Louder hits ring lower and
     * longer, the way a heavier strike does.
     */
    function sfxClack(vol, pitch) {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      const v = clamp(vol, 0.05, 1);

      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(2600 * pitch, t);
      bp.frequency.exponentialRampToValueAtTime(1100 * pitch, t + 0.03);
      bp.Q.value = 1.1;
      const ng = ac.createGain();
      env(ng, t, v * 0.5, 0.0012, 0.035);
      src.connect(bp); bp.connect(ng); ng.connect(master);
      src.start(t); src.stop(t + 0.09);

      const modes = [[1, 1], [2.71, 0.42]];
      for (const [mul, amp] of modes) {
        const o = ac.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(940 * pitch * mul, t);
        o.frequency.exponentialRampToValueAtTime(880 * pitch * mul, t + 0.05);
        const g = ac.createGain();
        env(g, t, v * 0.3 * amp, 0.0018, 0.055 / mul);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.16);
      }
    }

    /** The flick itself: a short air/skin whoosh, brighter the harder you go. */
    function sfxFlick(power) {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(420 + 900 * power, t);
      bp.frequency.exponentialRampToValueAtTime(160 + 300 * power, t + 0.12);
      bp.Q.value = 0.6;
      const g = ac.createGain();
      env(g, t, 0.1 + 0.22 * power, 0.004, 0.13);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.2);
    }

    /** Pen hitting the floor after it goes over — lower, boxier, roomier. */
    function sfxClatter(vol) {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      const v = clamp(vol, 0.05, 1);
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(2100, t);
      lp.frequency.exponentialRampToValueAtTime(420, t + 0.16);
      const g = ac.createGain();
      env(g, t, v * 0.42, 0.002, 0.19);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.26);

      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(240, t);
      o.frequency.exponentialRampToValueAtTime(96, t + 0.14);
      const og = ac.createGain();
      env(og, t, v * 0.16, 0.003, 0.16);
      o.connect(og); og.connect(master);
      o.start(t); o.stop(t + 0.3);
    }

    /** Soft tick while a pen teeters on the lip. */
    let lastCreak = 0;
    function sfxCreak() {
      if (!ac || ac.state !== "running") return;
      const t = ac.currentTime;
      if (t - lastCreak < 0.22) return;
      lastCreak = t;
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(rnd(340, 460), t);
      const g = ac.createGain();
      env(g, t, 0.05, 0.004, 0.07);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.12);
    }

    function updateSlideBed() {
      if (!slideGain || !ac || ac.state !== "running") return;
      let s = 0;
      for (const p of pens) if (p.alive) s = Math.max(s, p.speed() + Math.abs(p.w) * 0.02);
      const target = clamp(s * 0.11, 0, 0.13);
      slideGain.gain.setTargetAtTime(target, ac.currentTime, 0.04);
      if (slideFilt) slideFilt.frequency.setTargetAtTime(1200 + clamp(s, 0, 2) * 900, ac.currentTime, 0.06);
    }

    function onClack(j) {
      const vol = clamp(j / (PEN_MASS * 1.2), 0.06, 1);
      lastHit = vol;
      sfxClack(vol, 1 + rnd(-0.09, 0.09));
      if (vol > 0.22 && ctx.capabilities.haptics) {
        try { ctx.platform.haptic(vol > 0.6 ? "medium" : "light"); } catch (_) {}
      }
      if (lastHitAt) sparkAt(lastHitAt, vol);
    }

    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic || musicHandle) return;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "lofi", volume: 0.3, intensity: 0.32, density: 0.4, tempo: 76, fadeInMs: 1600
        });
      } catch (_) { /* silence is acceptable */ }
    }

    // ===================================================================== //
    // 7. Procedural textures                                                //
    // ===================================================================== //
    function woodTexture() {
      const W = 512, H = 700;
      const c = surface(W, H);
      const g = c.getContext("2d");
      // Dark walnut. Kept deliberately deep and low-chroma so the gold reads as
      // the brightest thing on the table.
      const base = g.createLinearGradient(0, 0, 0, H);
      base.addColorStop(0, "#33200f");
      base.addColorStop(0.45, "#432a16");
      base.addColorStop(1, "#25160b");
      g.fillStyle = base; g.fillRect(0, 0, W, H);

      // Grain: long low-frequency waves, then fine capillary lines over them.
      for (let i = 0; i < 190; i++) {
        const y0 = Math.random() * H;
        const amp = rnd(3, 16);
        const freq = rnd(0.004, 0.014);
        const ph = Math.random() * TAU;
        const dark = Math.random() < 0.55;
        g.strokeStyle = dark
          ? "rgba(38,22,11," + rnd(0.05, 0.16).toFixed(3) + ")"
          : "rgba(139,96,56," + rnd(0.04, 0.11).toFixed(3) + ")";
        g.lineWidth = rnd(0.6, 2.6);
        g.beginPath();
        for (let x = 0; x <= W; x += 6) {
          const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph * 2) * amp * 0.22;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      // A couple of knots for character.
      for (let k = 0; k < 3; k++) {
        const kx = rnd(60, W - 60), ky = rnd(60, H - 60), kr = rnd(12, 30);
        for (let r = kr; r > 1; r -= 1.6) {
          g.strokeStyle = "rgba(34,19,9," + (0.03 + 0.09 * (r / kr)).toFixed(3) + ")";
          g.lineWidth = 1.2;
          g.beginPath();
          g.ellipse(kx, ky, r, r * rnd(0.5, 0.72), rnd(0, Math.PI), 0, TAU);
          g.stroke();
        }
      }
      // Fine speckle so the polish is not glassy.
      for (let i = 0; i < 5200; i++) {
        g.fillStyle = Math.random() < 0.5 ? "rgba(240,205,165,.028)" : "rgba(14,7,3,.06)";
        g.fillRect(Math.random() * W, Math.random() * H, 1, rnd(1, 2.5));
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      return tex;
    }

    function woodRoughness() {
      const W = 256, H = 340;
      const c = surface(W, H);
      const g = c.getContext("2d");
      g.fillStyle = "#4a4a4a"; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 130; i++) {
        g.strokeStyle = "rgba(" + (Math.random() < 0.5 ? "20,20,20" : "120,120,120") + "," + rnd(0.05, 0.2).toFixed(3) + ")";
        g.lineWidth = rnd(1, 4);
        const y0 = Math.random() * H, amp = rnd(3, 14), freq = rnd(0.006, 0.02), ph = Math.random() * TAU;
        g.beginPath();
        for (let x = 0; x <= W; x += 8) {
          const y = y0 + Math.sin(x * freq + ph) * amp;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = 2;
      return tex;
    }

    /**
     * A small equirectangular studio: warm key panel, cool rim panel, dark
     * surround. Gold is nothing without something to reflect, and this is the
     * cheapest honest way to give it that.
     */
    function envTexture() {
      const W = 512, H = 256;
      const c = surface(W, H);
      const g = c.getContext("2d");
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#3a2c1c");
      sky.addColorStop(0.42, "#1a1410");
      sky.addColorStop(0.62, "#0d0a08");
      sky.addColorStop(1, "#050404");
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      function panel(cx, cy, rx, ry, col, a) {
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
        grad.addColorStop(0, col);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = a;
        g.save(); g.translate(cx, cy); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
        g.fillStyle = grad;
        g.beginPath(); g.arc(0, 0, Math.max(rx, ry), 0, TAU); g.fill();
        g.restore(); g.globalAlpha = 1;
      }
      panel(150, 56, 130, 74, "#fff2d2", 0.95);   // warm key
      panel(384, 78, 96, 58, "#cfe2ff", 0.5);     // cool rim
      panel(268, 30, 150, 46, "#ffd89a", 0.4);    // soft top wash
      panel(60, 150, 80, 50, "#6b4a22", 0.35);    // bounce
      const tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    /** Soft round falloff — used for glows, the grab dot and the spark burst. */
    function glowTexture(inner, outer) {
      const S = 128;
      const c = surface(S, S);
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      grad.addColorStop(0, inner);
      grad.addColorStop(0.35, outer);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad; g.fillRect(0, 0, S, S);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    /** A ring, for the marker under each pen. */
    function ringTexture(col) {
      const S = 256;
      const c = surface(S, S);
      const g = c.getContext("2d");
      g.clearRect(0, 0, S, S);
      g.strokeStyle = col;
      g.lineWidth = 9;
      g.shadowColor = col; g.shadowBlur = 18;
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 18, 0, TAU); g.stroke();
      g.globalAlpha = 0.4; g.lineWidth = 3;
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 34, 0, TAU); g.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    /** The aim arrow: a tapering bar with a head, drawn pointing along +X. */
    function arrowTexture() {
      const W = 512, H = 128;
      const c = surface(W, H);
      const g = c.getContext("2d");
      g.clearRect(0, 0, W, H);
      const midY = H / 2;
      const headX = W - 118;
      const grad = g.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "rgba(240,196,83,0)");
      grad.addColorStop(0.12, "rgba(240,196,83,.55)");
      grad.addColorStop(0.75, "rgba(255,226,150,.95)");
      grad.addColorStop(1, "rgba(255,246,214,1)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, midY - 9);
      g.lineTo(headX, midY - 17);
      g.lineTo(headX, midY + 17);
      g.lineTo(0, midY + 9);
      g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(W - 4, midY);
      g.lineTo(headX - 6, midY - 46);
      g.lineTo(headX - 6, midY + 46);
      g.closePath(); g.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    /** Dashes, tiled along the predicted travel line. */
    function dashTexture() {
      const W = 64, H = 16;
      const c = surface(W, H);
      const g = c.getContext("2d");
      g.clearRect(0, 0, W, H);
      g.fillStyle = "rgba(255,232,168,.85)";
      g.fillRect(4, H / 2 - 2.5, 34, 5);
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    /** Curved arrow shown when a flick will put real spin on the pen. */
    function spinTexture() {
      const S = 256;
      const c = surface(S, S);
      const g = c.getContext("2d");
      g.clearRect(0, 0, S, S);
      g.strokeStyle = "rgba(255,236,178,.95)";
      g.lineWidth = 13; g.lineCap = "round";
      g.shadowColor = "rgba(255,210,110,.8)"; g.shadowBlur = 14;
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 34, -0.35, Math.PI * 1.25); g.stroke();
      const ax = S / 2 + Math.cos(-0.35) * (S / 2 - 34);
      const ay = S / 2 + Math.sin(-0.35) * (S / 2 - 34);
      g.fillStyle = "rgba(255,240,196,1)";
      g.beginPath();
      g.moveTo(ax + 20, ay - 6);
      g.lineTo(ax - 16, ay - 22);
      g.lineTo(ax - 10, ay + 18);
      g.closePath(); g.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    // ===================================================================== //
    // 8. Scene                                                              //
    // ===================================================================== //
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0806);
    // Starts past the table's far corner (~1.6 m out) so the fog sinks the room
    // away behind the play surface without dimming the rival's half of it.
    scene.fog = new THREE.Fog(0x0a0806, 1.62, 3.1);
    const envMap = envTexture();
    scene.environment = envMap;

    const camera = new THREE.PerspectiveCamera(46, ctx.width / Math.max(1, ctx.height), 0.05, 12);
    const camTarget = new THREE.Vector3(0, 0, 0);
    const camBase = new THREE.Vector3();
    const CAM_TILT = 0.95;            // radians above the table
    const FIT_X = 0.93, FIT_Y = 0.84; // fraction of the frame the table may fill

    // The eight points the frame has to contain: the table's top and lip corners.
    const fitPts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      fitPts.push(new THREE.Vector3(sx * TABLE_HX, TABLE_TOP, sz * TABLE_HY));
      fitPts.push(new THREE.Vector3(sx * TABLE_HX, TABLE_TOP - TABLE_THICK, sz * TABLE_HY));
    }

    /**
     * Frames the table by projecting its corners and stepping the distance until
     * they just fit, then nudging the frustum so the trapezoid sits centred.
     * Solving it numerically beats a closed form here: perspective makes the near
     * edge wider than the far one, so no single trig expression is honest about
     * how much room the table actually needs.
     */
    function fitCamera() {
      const VW = Math.max(1, ctx.width), VH = Math.max(1, ctx.height);
      camera.aspect = VW / VH;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();

      const q = new THREE.Vector3();
      let dist = 1.2, cy = 0;
      for (let it = 0; it < 10; it++) {
        camera.position.set(0, Math.sin(CAM_TILT) * dist, Math.cos(CAM_TILT) * dist);
        camera.lookAt(camTarget);
        camera.updateMatrixWorld(true);
        let xm = 0, ymin = Infinity, ymax = -Infinity;
        for (const p of fitPts) {
          q.copy(p).project(camera);
          xm = Math.max(xm, Math.abs(q.x));
          if (q.y < ymin) ymin = q.y;
          if (q.y > ymax) ymax = q.y;
        }
        cy = (ymin + ymax) / 2;
        const need = Math.max(xm / FIT_X, ((ymax - ymin) / 2) / FIT_Y);
        if (Math.abs(need - 1) < 0.002) break;
        dist = clamp(dist * need, 0.4, 4);
      }

      camBase.set(0, Math.sin(CAM_TILT) * dist, Math.cos(CAM_TILT) * dist);
      camera.position.copy(camBase);
      camera.lookAt(camTarget);
      // Slide the frustum so the table sits centred: an offset of -cy*VH/2 moves
      // the image down by cy in clip space. Pass the real viewport size as the
      // full size — setViewOffset assigns camera.aspect = fullWidth/fullHeight,
      // so handing it 1,1 would silently square the frustum.
      camera.setViewOffset(VW, VH, 0, -cy * VH / 2, VW, VH);
    }
    fitCamera();

    // --- lighting ---------------------------------------------------------
    scene.add(new THREE.HemisphereLight(0xffe3b0, 0x241a12, 0.62));

    // Nearly overhead: a low key throws the far half of the table into shadow,
    // and the rival's pen has to read as clearly as your own.
    const key = new THREE.DirectionalLight(0xfff0d0, 2.5);
    key.position.set(0.34, 1.15, 0.22);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 2.4;
    key.shadow.camera.left = -0.52;
    key.shadow.camera.right = 0.52;
    key.shadow.camera.top = 0.56;
    key.shadow.camera.bottom = -0.56;
    key.shadow.bias = -0.0011;
    key.shadow.radius = 2.4;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x9dc4ff, 0.85);
    rim.position.set(-0.6, 0.5, -0.75);
    scene.add(rim);

    const warmFill = new THREE.PointLight(0xffb867, 1.1, 2.2, 2);
    warmFill.position.set(-0.35, 0.32, 0.3);
    scene.add(warmFill);

    // A dimmer twin over the far half, so the rival's end is lit rather than lost.
    const farFill = new THREE.PointLight(0xffc98a, 0.7, 1.8, 2);
    farFill.position.set(0.28, 0.3, -0.34);
    scene.add(farFill);

    // Rides along with a pen that has gone over the edge. Below the table top is
    // unlit floor, and a knockout deserves to be watched, not guessed at.
    const fallLight = new THREE.PointLight(0xffcf92, 0, 0.75, 2);
    fallLight.visible = false;
    scene.add(fallLight);

    // --- table ------------------------------------------------------------
    const tableGroup = new THREE.Group();
    scene.add(tableGroup);

    const woodMap = woodTexture();
    const woodRough = woodRoughness();
    const topMat = new THREE.MeshStandardMaterial({
      map: woodMap, roughnessMap: woodRough, roughness: 0.42, metalness: 0.06,
      envMapIntensity: 0.75
    });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x33200f, roughness: 0.62, metalness: 0.05 });

    const topGeo = new THREE.BoxGeometry(TABLE_HX * 2, TABLE_THICK, TABLE_HY * 2);
    const topMesh = new THREE.Mesh(topGeo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    topMesh.position.y = TABLE_TOP - TABLE_THICK / 2;
    topMesh.receiveShadow = true;
    tableGroup.add(topMesh);

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xd8a63c, metalness: 1, roughness: 0.22, envMapIntensity: 1.6
    });
    const goldBright = new THREE.MeshStandardMaterial({
      color: 0xffd873, metalness: 1, roughness: 0.13,
      emissive: 0x3a2606, emissiveIntensity: 0.7, envMapIntensity: 1.9
    });

    // Inlay: a thin gold strip set just inside the lip.
    (function inlay() {
      const inset = 0.016, w = 0.0042, h = 0.0016;
      const y = TABLE_TOP + h / 2 - 0.0004;
      const spans = [
        [0, TABLE_HY - inset, TABLE_HX * 2 - inset * 2, w],
        [0, -(TABLE_HY - inset), TABLE_HX * 2 - inset * 2, w],
        [TABLE_HX - inset, 0, w, TABLE_HY * 2 - inset * 2],
        [-(TABLE_HX - inset), 0, w, TABLE_HY * 2 - inset * 2]
      ];
      for (const [x, z, sx, sz] of spans) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), goldMat);
        m.position.set(x, y, -z);
        m.castShadow = false; m.receiveShadow = true;
        tableGroup.add(m);
      }
      // Corner studs.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.0022, 20), goldBright);
        s.position.set(sx * (TABLE_HX - inset), TABLE_TOP + 0.0006, sz * (TABLE_HY - inset));
        tableGroup.add(s);
      }
    })();

    // Apron + legs, so the table reads as furniture rather than a floating slab.
    (function frame() {
      const apronMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0d, roughness: 0.7, metalness: 0.04 });
      const ap = new THREE.Mesh(
        new THREE.BoxGeometry(TABLE_HX * 2 - 0.03, 0.026, TABLE_HY * 2 - 0.03), apronMat);
      ap.position.y = TABLE_TOP - TABLE_THICK - 0.012;
      tableGroup.add(ap);
      const legTop = TABLE_TOP - TABLE_THICK - 0.025;
      const legLen = legTop - FLOOR_Y;                  // reach the floor exactly
      const legGeo = new THREE.CylinderGeometry(0.011, 0.008, legLen, 14);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x241608, roughness: 0.66, metalness: 0.08 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(sx * (TABLE_HX - 0.032), legTop - legLen / 2, sz * (TABLE_HY - 0.032));
        leg.castShadow = true;
        tableGroup.add(leg);
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.012, 16), goldMat);
        cuff.position.set(leg.position.x, TABLE_TOP - TABLE_THICK - 0.042, leg.position.z);
        tableGroup.add(cuff);
      }
    })();

    // Floor, to catch pens that go over.
    (function floor() {
      const g = new THREE.PlaneGeometry(4, 4);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.MeshStandardMaterial({ color: 0x1d1510, roughness: 0.92, metalness: 0.02 });
      const f = new THREE.Mesh(g, m);
      f.position.y = FLOOR_Y;
      f.receiveShadow = true;
      scene.add(f);
    })();

    // ===================================================================== //
    // 9. Pens                                                               //
    // ===================================================================== //
    /**
     * A pen built from primitives along local +X: tip cone, grip, barrel,
     * bands, and a capped end with a clip. Local +X becomes the physics heading
     * once the mesh's rotation.y is set to the body angle.
     */
    function buildPen(scheme) {
      const grp = new THREE.Group();
      const half = PEN_LEN / 2;

      const bodyMat = new THREE.MeshStandardMaterial({
        color: scheme.body, metalness: scheme.metal, roughness: scheme.rough, envMapIntensity: 1.5
      });
      const accentMat = new THREE.MeshStandardMaterial({
        color: scheme.accent, metalness: 0.9, roughness: 0.2,
        emissive: scheme.emissive, emissiveIntensity: 0.55, envMapIntensity: 1.7
      });
      const gripMat = new THREE.MeshStandardMaterial({
        color: scheme.grip, metalness: 0.15, roughness: 0.85, envMapIntensity: 0.6
      });
      const nibMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.85, roughness: 0.35 });

      function part(mesh, cx, rotZ) {
        mesh.rotation.z = rotZ === undefined ? Math.PI / 2 : rotZ;   // cylinders lie along X
        mesh.position.x = cx;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        grp.add(mesh);
        return mesh;
      }

      // Writing end at local -X. rotation.z = +PI/2 sends a primitive's local +Y
      // to -X, so cones and tapers point their narrow end at the nib.
      let x = -half;
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0009, 0.004, 10), nibMat), x + 0.002);
      x += 0.004;
      part(new THREE.Mesh(new THREE.ConeGeometry(0.0042, 0.013, 22), nibMat), x + 0.0065);
      x += 0.013;
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0052, 0.008, 22), accentMat), x + 0.004);
      x += 0.008;
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0056, 0.026, 24), gripMat), x + 0.013);
      x += 0.026;
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0056, 0.0035, 22), accentMat), x + 0.00175);
      x += 0.0035;
      // Main barrel.
      const barrelLen = half * 2 - (x + half) - 0.019;
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.0056, 0.0055, barrelLen, 26), bodyMat), x + barrelLen / 2);
      x += barrelLen;
      // Two bands, then the end cap.
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.00575, 0.00575, 0.0022, 22), accentMat), x + 0.0011);
      x += 0.0038;
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.00575, 0.00575, 0.0022, 22), accentMat), x + 0.0011);
      x += 0.0022;
      const capLen = half - x - 0.0026;
      part(new THREE.Mesh(new THREE.CylinderGeometry(0.0057, 0.0057, capLen, 22), accentMat), x + capLen / 2);
      x += capLen;
      const domeGeo = new THREE.SphereGeometry(0.0057, 20, 14, 0, TAU, 0, Math.PI / 2);
      const dome = new THREE.Mesh(domeGeo, accentMat);
      dome.rotation.z = -Math.PI / 2;
      dome.position.x = x;
      dome.castShadow = true;
      grp.add(dome);

      // Pocket clip along the cap.
      const clip = new THREE.Mesh(new THREE.BoxGeometry(capLen * 0.92, 0.0013, 0.0042), accentMat);
      clip.position.set(x - capLen / 2 - 0.001, 0.0058, 0);
      clip.castShadow = true;
      grp.add(clip);
      const clipTip = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 12, 8), accentMat);
      clipTip.position.set(x - capLen - 0.001, 0.0052, 0);
      grp.add(clipTip);

      return grp;
    }

    const SCHEME_YOU = {
      body: 0xf2c455, accent: 0xfff0c0, grip: 0x2b2117, emissive: 0x6a4a08,
      metal: 1, rough: 0.19
    };
    const SCHEME_CPU = {
      body: 0x424954, accent: 0xb9c2cf, grip: 0x1b1e24, emissive: 0x1a2430,
      metal: 0.95, rough: 0.34
    };

    you.mesh = buildPen(SCHEME_YOU);
    cpu.mesh = buildPen(SCHEME_CPU);
    scene.add(you.mesh, cpu.mesh);

    // Marker rings on the table, so whose pen is whose is never in doubt.
    function makeRing(col) {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        map: ringTexture(col), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: 0.8
      }));
      m.scale.set(0.072, 1, 0.072);
      m.renderOrder = 2;
      scene.add(m);
      return m;
    }
    you.glow = makeRing("rgba(255,206,102,1)");
    cpu.glow = makeRing("rgba(150,178,214,1)");
    cpu.glow.material.opacity = 0.42;

    // ===================================================================== //
    // 10. Aim guide                                                         //
    // ===================================================================== //
    const aim = new THREE.Group();
    aim.visible = false;
    scene.add(aim);
    const AIM_Y = TABLE_TOP + 0.0016;

    function flatPlane(mat) {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(0.5, 0, 0);                 // anchored at its own start
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 5;
      return m;
    }

    const arrowMesh = flatPlane(new THREE.MeshBasicMaterial({
      map: arrowTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false
    }));
    aim.add(arrowMesh);

    const dashMat = new THREE.MeshBasicMaterial({
      map: dashTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, opacity: 0.5
    });
    const dashMesh = flatPlane(dashMat);
    aim.add(dashMesh);

    const grabDot = new THREE.Mesh(
      (function () { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })(),
      new THREE.MeshBasicMaterial({
        map: glowTexture("rgba(255,255,240,1)", "rgba(255,196,80,.75)"),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
      })
    );
    grabDot.scale.set(0.03, 1, 0.03);
    grabDot.renderOrder = 6;
    aim.add(grabDot);

    const spinMesh = new THREE.Mesh(
      (function () { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })(),
      new THREE.MeshBasicMaterial({
        map: spinTexture(), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false, opacity: 0
      })
    );
    spinMesh.scale.set(0.05, 1, 0.05);
    spinMesh.renderOrder = 6;
    aim.add(spinMesh);

    // Impact sparks — a few additive quads thrown from the contact point.
    const sparkTex = glowTexture("rgba(255,246,214,1)", "rgba(255,186,72,.6)");
    const sparks = [];
    for (let i = 0; i < 14; i++) {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        map: sparkTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: 0
      }));
      m.renderOrder = 7;
      m.visible = false;
      scene.add(m);
      sparks.push({ mesh: m, life: 0, vx: 0, vy: 0 });
    }
    function sparkAt(p, power) {
      let n = Math.round(3 + power * 7);
      for (const s of sparks) {
        if (n <= 0) break;
        if (s.life > 0) continue;
        n--;
        s.life = 1;
        const ang = Math.random() * TAU;
        const sp = rnd(0.12, 0.5) * (0.4 + power);
        s.vx = Math.cos(ang) * sp; s.vy = Math.sin(ang) * sp;
        s.mesh.position.set(p.x, TABLE_TOP + 0.002, -p.y);
        s.mesh.scale.set(0.016, 1, 0.016);
        s.mesh.visible = true;
      }
    }
    function stepSparks(dt) {
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt * 2.6;
        if (s.life <= 0) { s.mesh.visible = false; s.mesh.material.opacity = 0; continue; }
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.z -= s.vy * dt;
        s.vx *= 0.9; s.vy *= 0.9;
        s.mesh.material.opacity = s.life * 0.85;
        const sc = 0.014 + (1 - s.life) * 0.03;
        s.mesh.scale.set(sc, 1, sc);
      }
    }

    // Edge warning: a bar that lights up on whichever lip a pen is teetering on.
    const edgeGlowMat = new THREE.MeshBasicMaterial({
      map: glowTexture("rgba(255,120,80,.9)", "rgba(255,90,50,.35)"),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0
    });
    const edgeGlow = (function () {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, edgeGlowMat);
      m.renderOrder = 3;
      scene.add(m);
      return m;
    })();

    // ===================================================================== //
    // 11. HUD                                                               //
    // ===================================================================== //
    let scoreYou = 0, scoreCpu = 0, streak = 0, bestStreak = 0;
    const TARGET = 3;

    function renderHud(turnText, turnColor) {
      const pip = (filled, col) =>
        '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 2.5px;' +
        'background:' + (filled ? col : "rgba(246,236,216,.16)") + ';' +
        (filled ? "box-shadow:0 0 10px " + col + ";" : "") + '"></span>';
      let youPips = "", cpuPips = "";
      for (let i = 0; i < TARGET; i++) {
        youPips += pip(i < scoreYou, GOLD);
        cpuPips += pip(i < scoreCpu, "#93a6c4");
      }
      elHud.innerHTML =
        '<div style="display:flex;align-items:center;gap:18px;font-size:11px;letter-spacing:.18em;' +
        'text-transform:uppercase;font-weight:600;">' +
        '<div style="text-align:right;"><div style="color:' + GOLD + ';">You</div>' +
        '<div style="margin-top:5px;">' + youPips + "</div></div>" +
        '<div style="width:1px;height:26px;background:rgba(246,236,216,.14);"></div>' +
        '<div style="text-align:left;"><div style="color:#93a6c4;">Rival</div>' +
        '<div style="margin-top:5px;">' + cpuPips + "</div></div></div>" +
        '<div style="margin-top:2px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;' +
        'color:' + (turnColor || "rgba(246,236,216,.55)") + ';min-height:15px;">' + (turnText || "") + "</div>" +
        (bestStreak > 0
          ? '<div style="font-size:10px;letter-spacing:.12em;color:rgba(246,236,216,.28);">Best streak ' + bestStreak + "</div>"
          : "");
      elHud.style.opacity = "1";
    }

    let toastSeq = 0;
    function toast(big, small, col) {
      const seq = ++toastSeq;
      elToast.innerHTML =
        '<div style="font-size:clamp(26px,8vw,44px);font-weight:700;letter-spacing:.04em;' +
        'color:' + (col || GOLD) + ';text-shadow:0 4px 26px rgba(0,0,0,.6);">' + big + "</div>" +
        (small ? '<div style="margin-top:6px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;' +
          'color:rgba(246,236,216,.55);">' + small + "</div>" : "");
      elToast.style.opacity = "1";
      elToast.style.transform = "translateY(0)";
      // Sequence token rather than clearTimeout — the SDK owns its timer handles.
      ctx.timeout(() => {
        if (seq !== toastSeq) return;
        elToast.style.opacity = "0";
        elToast.style.transform = "translateY(-8px)";
      }, 1500);
    }

    function hint(text) {
      elHint.textContent = text || "";
      elHint.style.opacity = text ? "1" : "0";
    }

    // ===================================================================== //
    // 12. Input — grab your pen, drag to set direction and power, release    //
    // ===================================================================== //
    const raycaster = new THREE.Raycaster();
    const planeMath = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_TOP);
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();

    /** Screen point -> table-plane point in 2D physics coordinates. */
    function screenToPlane(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(planeMath, hitPoint)) return null;
      return { x: hitPoint.x, y: -hitPoint.z };
    }

    const MAX_DRAG = 0.135;          // metres of drag for full power
    const GRAB_R = 0.05;             // how close to the pen a grab counts

    let drag = null;                 // { s, grab, dir, power, moved, vel }

    function nearestOnPen(p, q) {
      const dx = q.x - p.x, dy = q.y - p.y;
      const s = clamp(dx * p.ax + dy * p.ay, -p.L / 2, p.L / 2);
      const pt = p.pointAt(s);
      return { s: s, pt: pt, dist: Math.hypot(q.x - pt.x, q.y - pt.y) };
    }

    function onDown(e) {
      if (state !== "aim") return;
      const t = e.touches ? e.touches[0] : e;
      const q = screenToPlane(t.clientX, t.clientY);
      if (!q) return;
      const near = nearestOnPen(you, q);
      if (near.dist > GRAB_R) {
        hint("Touch your gold pen to flick it");
        return;
      }
      drag = {
        s: near.s,
        grab: near.pt,
        dir: { x: 0, y: 0 },
        power: 0,
        moved: 0,
        lastQ: q,
        lastT: performance.now(),
        swipe: 0
      };
      aim.visible = true;
      hint("Drag the way you want it to go, then let go");
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic("light"); } catch (_) {} }
    }

    function onMove(e) {
      if (!drag) return;
      const t = e.touches ? e.touches[0] : e;
      const q = screenToPlane(t.clientX, t.clientY);
      if (!q) return;
      if (e.cancelable) e.preventDefault();

      const dx = q.x - drag.grab.x, dy = q.y - drag.grab.y;
      const len = Math.hypot(dx, dy);
      drag.moved = len;
      if (len > 1e-5) { drag.dir = { x: dx / len, y: dy / len }; }
      drag.power = clamp(len / MAX_DRAG, 0, 1);

      // A genuinely fast flick should count for something even if it is short.
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastT) / 1000;
      const sp = Math.hypot(q.x - drag.lastQ.x, q.y - drag.lastQ.y) / dt;
      drag.swipe = Math.max(drag.swipe * 0.86, clamp(sp / 3.2, 0, 1));
      drag.lastQ = q; drag.lastT = now;

      updateAimVisual();
    }

    function onUp() {
      if (!drag) return;
      const power = clamp(Math.max(drag.power, drag.swipe * 0.92), 0, 1);
      const d = drag;
      drag = null;
      aim.visible = false;
      if (power < 0.06 || (d.dir.x === 0 && d.dir.y === 0)) { hint(HINT_AIM); return; }
      flick(you, d.grab, d.dir, power);
      state = "sim";
      settleT = 0;
      fellThisTurn = null;
      hint("");
      renderHud("Your flick", GOLD);
    }

    /** The one place a flick becomes physics. */
    function flick(pen, at, dir, power) {
      const j = J_MAX * power;
      pen.impulseAt(at, dir.x * j, dir.y * j);
      sfxFlick(power);
      if (ctx.capabilities.haptics) {
        try { ctx.platform.haptic(power > 0.7 ? "heavy" : power > 0.35 ? "medium" : "light"); } catch (_) {}
      }
      try { ctx.platform.interact({ kind: "flick", side: pen.side, power: Math.round(power * 100) / 100 }); } catch (_) {}
    }

    function updateAimVisual() {
      if (!drag) return;
      const p = drag.power;
      const gx = drag.grab.x, gz = -drag.grab.y;
      const ang = Math.atan2(drag.dir.y, drag.dir.x);

      grabDot.position.set(gx, AIM_Y, gz);
      const dotS = 0.026 + p * 0.014;
      grabDot.scale.set(dotS, 1, dotS);

      arrowMesh.position.set(gx, AIM_Y, gz);
      arrowMesh.rotation.y = ang;
      arrowMesh.scale.set(0.045 + p * 0.115, 1, 0.026 + p * 0.016);
      arrowMesh.material.opacity = 0.55 + p * 0.45;

      // Predicted travel: constant deceleration mu*g, so d = v^2 / (2*mu*g).
      const v = V_MAX * p;
      const travel = (v * v) / (2 * MU_TABLE * G);
      dashMesh.position.set(gx, AIM_Y - 0.0002, gz);
      dashMesh.rotation.y = ang;
      dashMesh.scale.set(Math.min(travel, 0.75), 1, 0.012);
      dashMat.map.repeat.x = Math.max(1, Math.min(travel, 0.75) / 0.026);
      dashMat.opacity = 0.16 + p * 0.34;

      // Spin preview: exactly the angular term the impulse will deliver.
      const r = drag.s;
      const jMag = J_MAX * p;
      const torque = r * (drag.dir.y * Math.cos(you.a) - drag.dir.x * Math.sin(you.a));
      const wPred = Math.abs(torque * jMag / PEN_I * SPIN_TRANSFER);
      const spinAmt = clamp(wPred / 26, 0, 1);
      spinMesh.material.opacity = spinAmt * 0.85;
      spinMesh.position.set(gx, AIM_Y + 0.0004, gz);
      const ss = 0.03 + spinAmt * 0.03;
      spinMesh.scale.set(ss, 1, ss);
      spinMesh.rotation.y = torque > 0 ? 0 : Math.PI;
    }

    ctx.listen(canvas, "pointerdown", onDown);
    ctx.listen(window, "pointermove", onMove, { passive: false });
    ctx.listen(window, "pointerup", onUp);
    ctx.listen(window, "pointercancel", onUp);

    // ===================================================================== //
    // 13. Opponent                                                          //
    // ===================================================================== //
    /**
     * Aims down the line to your pen — which, since it plays from the far side,
     * naturally shoves you toward your own back edge. Skill controls aim spread
     * and how well it judges power; it climbs a little as your streak does, so
     * a good run keeps getting harder.
     */
    let aiSkill = 0.5;
    function aiPlan() {
      const me = cpu, foe = you;
      const dx = foe.x - me.x, dy = foe.y - me.y;
      const dist = Math.hypot(dx, dy) || 1;
      let dirx = dx / dist, diry = dy / dist;

      // Bias slightly toward the edge your pen is nearest, when it is close to one.
      const edgeDist = Math.min(TABLE_HX - Math.abs(foe.x), TABLE_HY - Math.abs(foe.y));
      if (edgeDist < 0.12) {
        const ex = (TABLE_HX - Math.abs(foe.x) < TABLE_HY - Math.abs(foe.y)) ? Math.sign(foe.x) : 0;
        const ey = ex === 0 ? Math.sign(foe.y) : 0;
        const blend = 0.3 * aiSkill;
        dirx = dirx * (1 - blend) + ex * blend;
        diry = diry * (1 - blend) + ey * blend;
        const l = Math.hypot(dirx, diry) || 1;
        dirx /= l; diry /= l;
      }

      // Aim error shrinks with skill.
      const spread = (1 - aiSkill) * 0.34 + 0.035;
      const jitter = (Math.random() + Math.random() - 1) * spread;
      const ca = Math.cos(jitter), sa = Math.sin(jitter);
      const ax = dirx * ca - diry * sa, ay = dirx * sa + diry * ca;

      // Enough speed to arrive with margin, then misjudged in proportion to how
      // unskilled it is — a weak rival mostly under-hits and falls short.
      const vNeed = Math.sqrt(2 * MU_TABLE * G * Math.max(0.05, dist));
      const want = clamp((vNeed * lerp(1.1, 1.5, aiSkill)) / V_MAX, 0.22, 1);
      const judge = rnd(lerp(0.6, 0.93, aiSkill), lerp(1.0, 1.06, aiSkill));
      let power = clamp(want * judge, 0.18, 1);

      // Don't fire itself off the back of the table if it is already near a lip.
      const myEdge = Math.min(TABLE_HX - Math.abs(me.x), TABLE_HY - Math.abs(me.y));
      if (myEdge < 0.07) power = Math.min(power, 0.72);

      // Contact point: mostly centred (drives straight), with some slop.
      const s = clamp((Math.random() + Math.random() - 1) * (1 - aiSkill) * 0.55, -0.46, 0.46) * me.L;
      return { at: me.pointAt(s), dir: { x: ax, y: ay }, power: power };
    }

    // ===================================================================== //
    // 14. Round flow                                                        //
    // ===================================================================== //
    let state = "intro";          // intro | aim | sim | cpuThink | over
    let settleT = 0;
    let thinkT = 0;
    let cpuMove = null;
    let slowmo = 0;
    let started = false;

    const HINT_AIM = "Touch your gold pen — the end spins it, the middle drives it";

    function layout() {
      // Pens start facing across the table, a good flick apart.
      you.x = rnd(-0.05, 0.05); you.y = -0.23;
      you.a = rnd(-0.22, 0.22);
      cpu.x = rnd(-0.05, 0.05); cpu.y = 0.23;
      cpu.a = Math.PI + rnd(-0.22, 0.22);
      for (const p of pens) {
        p.vx = p.vy = p.w = 0;
        p.alive = true;
        p.fall = null;
        p.mesh.visible = true;
        p.glow.visible = true;
        p.mesh.scale.setScalar(1);
      }
      fellThisTurn = null;
      slowmo = 0;
      edgeGlowMat.opacity = 0;
    }

    function newRound(firstMover) {
      layout();
      state = firstMover === "cpu" ? "cpuThink" : "aim";
      thinkT = 0;
      settleT = 0;
      cpuMove = null;
      renderHud(state === "aim" ? "Your turn" : "Rival's turn", state === "aim" ? GOLD : "#93a6c4");
      hint(state === "aim" ? HINT_AIM : "");
    }

    function onKnockOff(p) {
      slowmo = 0.95;
      try { ctx.music.duck(0.55, 1100); } catch (_) {}
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic(p === cpu ? "success" : "error"); } catch (_) {} }
    }

    function endRound() {
      const lost = fellThisTurn;
      if (!lost) return;
      if (lost === cpu) {
        scoreYou++;
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        aiSkill = clamp(0.5 + streak * 0.07, 0.5, 0.92);
        toast("OFF THE TABLE", "Round to you", GOLD);
        try { ctx.music.sting("success"); } catch (_) {}
        try { ctx.platform.milestone("round_won", { streak: streak }); } catch (_) {}
        saveState();
      } else {
        scoreCpu++;
        if (streak > 0) submitStreak(streak);
        streak = 0;
        aiSkill = clamp(aiSkill - 0.04, 0.45, 0.92);
        toast("YOURS WENT OVER", "Round to the rival", "#adbdd6");
        try { ctx.music.sting("fail"); } catch (_) {}
      }
      renderHud("", null);
      try { ctx.platform.setScore(bestStreak, { rounds: scoreYou }); } catch (_) {}

      if (scoreYou >= TARGET || scoreCpu >= TARGET) {
        ctx.timeout(() => matchOver(scoreYou >= TARGET), 1500);
      } else {
        // Loser of the round flicks first next round — small comeback lever.
        ctx.timeout(() => newRound(lost === cpu ? "cpu" : "you"), 1650);
      }
      state = "over";
    }

    function matchOver(won) {
      state = "intro";
      if (won) {
        try { ctx.platform.complete({ rounds: scoreYou, bestStreak: bestStreak }); } catch (_) {}
      } else {
        try { ctx.platform.fail({ rounds: scoreYou }); } catch (_) {}
      }
      if (streak > 0) { submitStreak(streak); }
      elCTitle.innerHTML = won ? "YOU<br>WIN" : "YOU<br>LOSE";
      elCTitle.style.background = won
        ? "linear-gradient(180deg,#fff3cf 0%," + GOLD + " 42%,#8f6a22 100%)"
        : "linear-gradient(180deg,#dfe7f4 0%,#8fa2bd 45%,#3d4759 100%)";
      elCTitle.style.webkitBackgroundClip = "text";
      elCTitle.style.backgroundClip = "text";
      elCSub.innerHTML = won
        ? "You took it " + scoreYou + "&ndash;" + scoreCpu + ". Streak of " + bestStreak + "."
        : "The rival took it " + scoreCpu + "&ndash;" + scoreYou + ".";
      elCBtn.textContent = "Play again";
      elCNote.textContent = bestStreak > 0 ? "Best round streak: " + bestStreak : "";
      elCurtain.style.display = "flex";
      elCurtain.style.opacity = "1";
      hint("");
      elHud.style.opacity = "0";
    }

    function beginMatch() {
      scoreYou = 0; scoreCpu = 0; streak = 0;
      aiSkill = clamp(0.5 + Math.min(bestStreak, 5) * 0.03, 0.5, 0.72);
      elCurtain.style.opacity = "0";
      ctx.timeout(() => { elCurtain.style.display = "none"; }, 400);
      newRound("you");
      if (!started) {
        started = true;
        try { ctx.platform.start(); } catch (_) {}
      }
      buildAudio();
      if (ac && ac.state === "suspended") { try { ac.resume(); } catch (_) {} }
      startMusic();
    }

    ctx.listen(elCurtain, "pointerdown", (e) => {
      if (e.cancelable) e.preventDefault();
      if (state === "intro") beginMatch();
    });

    // ===================================================================== //
    // 15. Persistence + leaderboard                                         //
    // ===================================================================== //
    function saveState() {
      if (!ctx.capabilities.storage) return;
      try { ctx.storage.set("pf", { best: bestStreak }); } catch (_) {}
    }
    (async function loadState() {
      if (!ctx.capabilities.storage) return;
      try {
        const s = await ctx.storage.get("pf");
        if (s && typeof s.best === "number") {
          bestStreak = s.best;
          elCNote.textContent = "Best round streak: " + bestStreak;
        }
      } catch (_) {}
    })();

    let submitted = -1;
    async function submitStreak(n) {
      if (n <= 0 || n <= submitted) return;
      submitted = n;
      try {
        await ctx.memory.record("win_streak").submit(n, { label: n + (n === 1 ? " round" : " rounds") });
      } catch (_) { /* offline is fine, the game does not depend on it */ }
    }

    // ===================================================================== //
    // 16. Render + main loop                                                //
    // ===================================================================== //
    function syncPen(p) {
      if (p.alive) {
        p.mesh.position.set(toWorldX(p), TABLE_TOP + p.rad, toWorldZ(p));
        p.mesh.quaternion.identity();
        p.mesh.rotation.set(0, p.a, 0);
        p.glow.visible = true;
        p.glow.position.set(toWorldX(p), TABLE_TOP + 0.0009, toWorldZ(p));
      } else if (p.fall) {
        p.mesh.position.copy(p.fall.pos);
        p.mesh.quaternion.copy(p.fall.quat);
        p.glow.visible = false;
      }
    }

    /** Follows whichever pen is in the air, then fades once it settles. */
    function updateFallLight(dt) {
      let f = null;
      for (const p of pens) if (!p.alive && p.fall && !p.fall.rest) { f = p.fall; break; }
      if (f) {
        fallLight.visible = true;
        fallLight.position.set(f.pos.x, f.pos.y + 0.06, f.pos.z);
        fallLight.intensity = Math.min(2.6, fallLight.intensity + dt * 9);
      } else if (fallLight.visible) {
        fallLight.intensity -= dt * 3.2;
        if (fallLight.intensity <= 0) { fallLight.intensity = 0; fallLight.visible = false; }
      }
    }

    function updateEdgeWarning() {
      let worst = 0, wp = null;
      for (const p of pens) {
        if (!p.alive) continue;
        const o = overhang(p);
        if (o > worst) { worst = o; wp = p; }
      }
      if (!wp || worst < 0.12) {
        edgeGlowMat.opacity = Math.max(0, edgeGlowMat.opacity - 0.05);
        return;
      }
      const nearX = TABLE_HX - Math.abs(wp.x) < TABLE_HY - Math.abs(wp.y);
      const t = clamp((worst - 0.12) / 0.5, 0, 1);
      edgeGlowMat.opacity = lerp(edgeGlowMat.opacity, t * 0.75, 0.15);
      if (nearX) {
        edgeGlow.position.set(Math.sign(wp.x) * TABLE_HX, TABLE_TOP + 0.0012, -wp.y);
        edgeGlow.scale.set(0.05, 1, 0.16);
      } else {
        edgeGlow.position.set(wp.x, TABLE_TOP + 0.0012, -Math.sign(wp.y) * TABLE_HY);
        edgeGlow.scale.set(0.16, 1, 0.05);
      }
      if (t > 0.35 && wp.moving()) sfxCreak();
    }

    let lastW = ctx.width, lastH = ctx.height;
    function resize() {
      const w = ctx.width, h = ctx.height;
      renderer.setPixelRatio(Math.min(ctx.nativeDpr || window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      fitCamera();
    }
    ctx.listen(window, "resize", resize);
    resize();

    // Draw one frame now so the table is behind the title card, not black.
    layout();
    syncPen(you); syncPen(cpu);
    renderer.render(scene, camera);

    let camShake = 0;
    ctx.onFrame((dtMs) => {
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width; lastH = ctx.height; resize();
      }
      let dt = Math.min(dtMs, 50) / 1000;

      // Slow motion while a pen goes over the edge — the best moment in the game.
      if (slowmo > 0) {
        slowmo = Math.max(0, slowmo - dt);
        dt *= lerp(1, 0.32, clamp(slowmo / 0.95, 0, 1));
      }

      if (state === "sim" || state === "over" || state === "cpuSim") {
        simulate(dt);
      } else if (state === "aim" || state === "cpuThink") {
        simulate(dt);        // keeps residual motion and fall animations alive
      }

      // Turn resolution.
      if (state === "sim" || state === "cpuSim") {
        if (fellThisTurn && !anyMoving()) {
          endRound();
        } else if (!anyMoving()) {
          settleT += dt;
          if (settleT > 0.22) {
            settleT = 0;
            if (fellThisTurn) endRound();
            else if (state === "sim") {
              state = "cpuThink"; thinkT = 0; cpuMove = null;
              renderHud("Rival's turn", "#93a6c4");
            } else {
              state = "aim";
              renderHud("Your turn", GOLD);
              hint(HINT_AIM);
            }
          }
        } else settleT = 0;
      }

      // Opponent takes a beat, telegraphs, then flicks.
      if (state === "cpuThink") {
        thinkT += dt;
        if (!cpuMove && thinkT > 0.35) {
          cpuMove = aiPlan();
          aim.visible = true;
          const ang = Math.atan2(cpuMove.dir.y, cpuMove.dir.x);
          const gx = cpuMove.at.x, gz = -cpuMove.at.y;
          arrowMesh.position.set(gx, AIM_Y, gz);
          arrowMesh.rotation.y = ang;
          arrowMesh.scale.set(0.045 + cpuMove.power * 0.115, 1, 0.024);
          arrowMesh.material.opacity = 0.4;
          arrowMesh.material.color.setHex(0x8fb0dd);
          grabDot.position.set(gx, AIM_Y, gz);
          grabDot.scale.set(0.022, 1, 0.022);
          grabDot.material.color.setHex(0x8fb0dd);
          dashMesh.visible = false;
          spinMesh.material.opacity = 0;
        }
        if (cpuMove && thinkT > 1.0) {
          aim.visible = false;
          arrowMesh.material.color.setHex(0xffffff);
          grabDot.material.color.setHex(0xffffff);
          dashMesh.visible = true;
          flick(cpu, cpuMove.at, cpuMove.dir, cpuMove.power);
          cpuMove = null;
          state = "cpuSim";
          settleT = 0;
          fellThisTurn = null;
          renderHud("Rival's flick", "#93a6c4");
        }
      }

      // Visual updates.
      syncPen(you); syncPen(cpu);
      updateFallLight(dt);
      you.glow.material.opacity = state === "aim" ? 0.55 + Math.sin(performance.now() / 380) * 0.22 : 0.4;
      stepSparks(dt);
      updateEdgeWarning();
      updateSlideBed();
      if (drag) updateAimVisual();

      // A little shake on heavy contact, always offset from the fitted base so
      // it cannot drift the camera over a long match.
      if (lastHit > 0.3) { camShake = Math.max(camShake, lastHit * 0.5); lastHit = 0; }
      if (camShake > 0.001) {
        camShake *= 0.86;
        camera.position.set(
          camBase.x + rnd(-1, 1) * camShake * 0.006,
          camBase.y + rnd(-1, 1) * camShake * 0.004,
          camBase.z
        );
        camera.lookAt(camTarget);
      } else if (!camera.position.equals(camBase)) {
        camera.position.copy(camBase);
        camera.lookAt(camTarget);
      }

      renderer.render(scene, camera);
    });

    // Title card sits over a rendered table; nothing else to do until a tap.
    renderHud("", null);
    elHud.style.opacity = "0";

    ctx.onDestroy(() => {
      try { if (musicHandle) musicHandle.stop({ fadeOutMs: 500 }); } catch (_) {}
      try { ctx.music.stop({ fadeOutMs: 500 }); } catch (_) {}
      try { if (slideSrc) slideSrc.stop(); } catch (_) {}
      try { if (ac) ac.close(); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
    });

    } catch (err) {
      fatal("init", err);
    }
  }
};
