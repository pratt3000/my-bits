/*
 * Cluck Climb
 * A precision climber in the "charge a jump, flap to fix it" mould: a small
 * chicken, a tall mountain of maroon rock, and only the green ledges are
 * safe. Miss one and you tumble back down. One mountain, the same for
 * everyone, so the times mean something.
 *
 * All art, sound, level generation and code is original and lives in this
 * file. The look follows the genre's flat pixel style: azure sky, rock with
 * an orange and plum outline, cream clouds, a timer and a percent.
 *
 * Runtime: plethora-bit@2 (window.plethoraBit) · 2D canvas · synth audio
 */

window.plethoraBit = {
  meta: {
    title: "Cluck Climb",
    runtime: "plethora-bit@2",
    tags: ["platformer", "precision", "climb", "pixel", "speedrun", "mobile"],
    permissions: ["haptics", "audio", "storage"]
  },

  async init(ctx) {
    "use strict";
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const root = ctx.createRoot({ touchAction: "none" });
    root.style.pointerEvents = "none";
    const sa = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const memStore = {};
    const store = {
      async get(k, d) { try { let v = canStore ? ctx.storage.get("cc_" + k) : memStore[k]; if (v && typeof v.then === "function") v = await v; return v == null ? d : v; } catch (_) { return d; } },
      set(k, v) { try { if (canStore) ctx.storage.set("cc_" + k, v); else memStore[k] = v; } catch (_) {} }
    };
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!(await store.get("muted", false));
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // ---- palette ---------------------------------------------------------------------------------
    const C = { sky: "#1eaaf0", skyHi: "#4cc0ff", rock: "#cb5065", edge: "#f5a048", dark: "#562048", cloud: "#faece0", grass: "#8ce048", grassHi: "#c2f57a",
      white: "#ffffff", red: "#e83a3a", beak: "#f5a048", black: "#141018", gold: "#ffe93a", shade: "#e4dcdc" };

    // ---- physics constants (world px, seconds) ---------------------------------------------------
    const LW = 160, GRAV = 430, R = 4.5;
    const JUMP_MIN = 105, JUMP_RANGE = 125, SIDE_X = 0.58, SIDE_Y = 0.84, FLAP_VY = 95, FLAP_VX = 62, MAX_FLAPS = 3, CHARGE_T = 0.75;
    function launch(dir, c) { const v = JUMP_MIN + JUMP_RANGE * c, a = Math.abs(dir); return { vx: dir * v * SIDE_X, vy: -v * lerp(1, SIDE_Y, a) }; }
    function flapVx(vx, dir) { return dir ? vx * 0.55 + dir * FLAP_VX : vx * 0.8; }

    // ---- deterministic level --------------------------------------------------------------------
    function rng(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    const rand = rng(20260907);
    const rr = (a, b) => a + rand() * (b - a);
    const ledges = [], hazards = [], feathers = [];
    // ---- the pixel mask is built as the level is generated, so the jump simulator sees real rock ----
    const Y_TOP = -2700, LH = 60 - Y_TOP + 1;
    const mask = new Uint8Array(LW * LH);   // 0 sky, 1 rock, 2 grass
    const mi = (x, y) => (y - Y_TOP) * LW + x;
    function rasterPoly(p, v) {
      let y0 = Infinity, y1 = -Infinity; for (const [, y] of p) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let y = Math.max(Y_TOP, Math.floor(y0)); y <= Math.min(60, Math.ceil(y1)); y++) {
        const sy = y + 0.5, xs = [];
        for (let i = 0; i < p.length; i++) {
          const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
          if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + (sy - ay) * (bx - ax) / (by - ay));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(LW, Math.round(xs[k + 1])); x++) mask[mi(x, y)] = v;
      }
    }
    const fill = (p) => rasterPoly(p, 1), carve = (p) => rasterPoly(p, 0);
    const fillRect = (x0, y0, x1, y1) => fill([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    function circlePoly(cx, cy, r) { const p = []; for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return p; }
    function carveSeg(x0, y0, x1, y1, w) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len * w / 2, ny = dx / len * w / 2;
      carve([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
      carve(circlePoly(x0, y0, w / 2)); carve(circlePoly(x1, y1, w / 2));
    }
    const solidM = (x, y) => (x < 0 || x >= LW) ? true : (y < Y_TOP || y > 60) ? (y > 60) : mask[mi(x, y)] > 0;
    function freeSpan(y, nearX) {   // the free run of a row containing nearX (or the widest run)
      let best = null, near = null, s = -1;
      for (let x = 0; x <= LW; x++) {
        const free = x < LW && !solidM(x, y);
        if (free && s < 0) s = x;
        if (!free && s >= 0) { const run = { l: s, r: x - 1 }; if (nearX != null && nearX >= s && nearX <= x - 1) near = run; if (!best || run.r - run.l > best.r - best.l) best = run; s = -1; }
      }
      if (near && near.r - near.l >= 40) return near;
      return best || { l: 0, r: LW - 1 };
    }
    function inPoly(p, x, y) {
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; }
      return inside;
    }
    function bboxOf(poly) { let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity; for (const [x, y] of poly) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); } return { poly, bx0, bx1, by0, by1 }; }
    function blocked(x, y, extra) {
      if (y >= 0) return true;
      if (solidM(Math.floor(x), Math.floor(y))) return true;
      return !!(extra && x >= extra.bx0 && x <= extra.bx1 && y >= extra.by0 && y <= extra.by1 && inPoly(extra.poly, x, y));
    }
    const bodyBlocked = (x, y, extra) => blocked(x + R, y, extra) || blocked(x - R, y, extra) || blocked(x, y - R, extra) || blocked(x, y + R, extra) || blocked(x + 3.2, y + 3.2, extra) || blocked(x - 3.2, y + 3.2, extra) || blocked(x + 3.2, y - 3.2, extra) || blocked(x - 3.2, y - 3.2, extra);
    // simulate jumps from (px,py) and report whether one lands on ledge B without clipping rock
    function reachable(px, py, B, extra, bounces) {
      const dirs = [-1, -0.5, 0, 0.5, 1], charges = [0.35, 0.55, 0.75, 1], flapPlans = [[], [0.3], [0.5], [0.3, 0.6], [0.45, 0.8], [0.25, 0.5, 0.75]];
      const cy = B.y - R;
      for (const d of dirs) for (const c of charges) for (const fp of flapPlans) {
        let { vx, vy } = launch(d, c); let x = px, y = py - 1, t = 0, fi = 0, apexY = py, apexX = px, ok = false;
        const sd = Math.sign(d) || (fp.length ? (B.x0 + B.w / 2 > px ? 1 : -1) : 0);
        for (let i = 0; i < 160; i++) {
          const dt = 1 / 60; t += dt;
          if (fi < fp.length && t >= fp[fi]) { vy = Math.min(vy, 40) - FLAP_VY; vx = flapVx(vx, sd); fi++; }
          const py0 = y; x += vx * dt; y += vy * dt; vy += GRAV * dt;
          if (y < apexY) { apexY = y; apexX = x; }
          if (x < R || x > LW - R) break;
          if (vy > 0 && py0 <= cy && y >= cy) { ok = x >= B.x0 + 3 && x <= B.x1 - 3; break; }
          if (bodyBlocked(x, y, extra)) break;
          if (y > py + 10) break;
        }
        if (ok) return { apexX, apexY };
      }
      void bounces; return null;
    }
    function ledgeReachable(A, B, extra) {
      const pts = [A.x0 + A.w * 0.25, A.x0 + A.w * 0.5, A.x0 + A.w * 0.75];
      let ok = 0, apex = null;
      for (const px of pts) { const r = reachable(px, A.y - R, B, extra); if (r) { ok++; apex = apex || r; } }
      return ok >= 2 ? apex : null;
    }
    function islandPoly(x0, x1, y, depth, span) {
      const w = x1 - x0, cx = (x0 + x1) / 2, kind = rand();
      if (span && x0 - span.l < 10) return [[-20, y], [x1, y], [x1 + 4, y + 6], [x1 - 3, y + depth], [-20, y + depth + 12]];
      if (span && span.r - x1 < 10) return [[x0, y], [LW + 20, y], [LW + 20, y + depth + 12], [x0 + 3, y + depth], [x0 - 4, y + 6]];
      if (kind < 0.4) { const b = Math.max(6, w * rr(0.3, 0.55)); return [[x0, y], [x1, y], [cx + b / 2, y + depth], [cx - b / 2, y + depth]]; }
      if (kind < 0.7) return [[x0, y], [x1, y], [cx + rr(-4, 4), y + depth * 1.2]];
      return [[x0, y], [x1, y], [x1 + 4, y + 6], [x1 - 2, y + depth], [x0 + 2, y + depth], [x0 - 4, y + 6]];
    }
    // place one ledge reachable from `from`, within a horizontal range, at roughly dy above; fills its island at once
    let fallbacks = 0;
    function placeLedge(from, w, dy, opts) {
      opts = opts || {};
      let placed = null, tries = 0;
      while (!placed && tries++ < 60) {
        if (tries % 15 === 0) dy -= 6;
        const y = Math.round(from.y - dy);
        const span = opts.span ? opts.span(y) : freeSpan(y, (from.x0 + from.x1) / 2);
        if (span.r - span.l < w + 6) { dy -= 4; continue; }
        const lo = span.l + 3 + w / 2, hi = span.r - 3 - w / 2;
        const cx = opts.cx != null ? clamp(opts.cx, lo, hi) : rr(lo, hi);
        const pc = (from.x0 + from.x1) / 2;
        if (opts.minDx && Math.abs(cx - pc) < opts.minDx && rand() < 0.8) continue;
        const B = { x0: Math.round(cx - w / 2), x1: Math.round(cx + w / 2), y, w };
        const poly = opts.poly ? opts.poly(B, span) : islandPoly(B.x0, B.x1, y, Math.round(lerp(12, 24, rand()) + w * 0.3), span);
        const apex = ledgeReachable(from, B, bboxOf(poly));
        if (apex) { placed = B; B.apex = apex; fill(poly); ledges.push(B); }
      }
      if (!placed && !opts.noFallback) {
        // guaranteed hop: a short island straight above the previous ledge, clear of rock
        const fw = Math.max(w, 24), fy = Math.round(from.y - 34), fc = clamp((from.x0 + from.x1) / 2, 4 + fw / 2, LW - 4 - fw / 2);
        const B = { x0: Math.round(fc - fw / 2), x1: Math.round(fc + fw / 2), y: fy, w: fw, apex: { apexX: fc, apexY: fy - 20 }, fallback: true };
        carve([[B.x0 - 12, fy + 14], [B.x1 + 12, fy + 14], [B.x1 + 12, fy - 50], [B.x0 - 12, fy - 50]]);
        fill([[B.x0, fy], [B.x1, fy], [fc + 5, fy + 12], [fc - 5, fy + 12]]);
        ledges.push(B); placed = B; fallbacks++;
      }
      return placed;
    }
    function addFeather(x, y) { feathers.push({ x: clamp(Math.round(x), 6, LW - 6), y: Math.round(y), taken: false, t: rand() * 6 }); }
    function addHazard(y, t) {
      const span = freeSpan(y), width = Math.max(16, Math.min(rr(26, 60), span.r - span.l - 16));
      if (span.r - span.l < 40) return;
      const hx = clamp(rr(span.l + 8, span.r - 8), span.l + 8 + width / 2, span.r - 8 - width / 2);
      hazards.push({ x: hx, y, x0: hx - width / 2, x1: hx + width / 2, sp: lerp(18, 48, t) * (rand() < 0.5 ? -1 : 1), t: rand() * 6 });
    }
    // ---- section builders. Each starts from the ledge `from` and returns the topmost ledge ----------
    const ledgeW = (t) => Math.max(11, Math.round(lerp(42, 13, Math.pow(t, 0.85)) + rr(-3, 3)));
    function walls(yBot, yTop, inset, jag) {
      carve([[-20, yBot - 30], [LW + 20, yBot - 30], [LW + 20, yTop - 40], [-20, yTop - 40]]);
      const L = [], Rr = [];
      for (let y = yBot - 30; y >= yTop - 40; y -= 30) { L.push([inset + rr(-3, jag), y + rr(-5, 5)]); Rr.push([LW - inset - rr(-3, jag), y + rr(-5, 5)]); }
      fill([[-20, yBot - 30], ...L, [-20, yTop - 40]]); fill([[LW + 20, yBot - 30], ...Rr, [LW + 20, yTop - 40]]);
    }
    function cavern(from, h, t, opts) {
      opts = opts || {};
      const yBot = from.y, yTop = yBot - h;
      walls(yBot, yTop, opts.inset != null ? opts.inset : lerp(6, 22, t), opts.jag || 10);
      let prev = from; const step = opts.step || lerp(44, 62, t);
      for (let y = yBot - step; y > yTop; y -= step) {
        const w = opts.wide ? Math.round(rr(36, 64)) : ledgeW(t);
        const L = placeLedge(prev, w, prev.y - y, { minDx: lerp(6, 34, t) });
        if (!L) break;
        if (L.apex && rand() < 0.65) addFeather(L.apex.apexX, L.apex.apexY - 4);
        if (opts.hazards && rand() < lerp(0.2, 0.6, t)) addHazard(Math.round((prev.y + L.y) / 2 + rr(-8, 8)), t);
        prev = L;
      }
      return prev;
    }
    function tunnel(from, h, t) {
      const yBot = from.y, yTop = yBot - h, w = lerp(52, 36, t);
      const blockBottom = Math.min(yBot - 44, from.apex ? from.apex.apexY - 12 : yBot - 44);
      fillRect(-20, yTop - 40, LW + 20, blockBottom);
      carve(circlePoly((from.x0 + from.x1) / 2, from.y - 14, 30));   // the entry chamber
      let px = (from.x0 + from.x1) / 2, py = from.y - 14, prev = from, side = px < LW / 2 ? 1 : -1;
      for (let y = yBot - lerp(48, 62, t); y > yTop; y -= lerp(44, 60, t)) {
        let nx = clamp(px + side * rr(34, 70), 24, LW - 24);
        carveSeg(px, py, nx, y, w);
        carve(circlePoly(nx, y, w * 0.62));
        // a ledge sits low in the bend
        const lw = ledgeW(t) + 2;
        const L = placeLedge(prev, lw, prev.y - (y + 8), { cx: nx, span: () => ({ l: nx - w * 0.6, r: nx + w * 0.6 }), poly: (B) => [[B.x0, B.y], [B.x1, B.y], [B.x1 + 3, B.y + 8], [(B.x0 + B.x1) / 2, B.y + 16], [B.x0 - 3, B.y + 8]] });
        if (L) { if (rand() < 0.5) addFeather((px + nx) / 2, (py + y) / 2 - 8); prev = L; }
        px = nx; py = y; side = -side;
      }
      carveSeg(px, py, px, yTop - 46, w * 0.9);   // the exit opens upward into the next section
      return prev;
    }
    function split(from, h, t) {
      const yBot = from.y, yTop = yBot - h;
      walls(yBot, yTop, 4, 4);
      // a central pillar, jagged, with a cap
      const fc = (from.x0 + from.x1) / 2, under = Math.abs(fc - LW / 2) < 34, pb = under ? yBot - 70 : yBot - 20;
      const pts = []; for (let y = pb - 6; y >= yTop + 26; y -= 26) pts.push([LW / 2 + 15 + rr(-4, 4), y + rr(-4, 4)]);
      const left = []; for (let y = yTop + 26; y <= pb - 6; y += 26) left.push([LW / 2 - 15 + rr(-4, 4), y + rr(-4, 4)]);
      fill([[LW / 2, pb], ...pts, [LW / 2, yTop + 18], ...left]);
      let pl = from, pr = from; const step = lerp(48, 62, t);
      const merge = { y: yTop };
      const dbgRow = Math.round(yBot - step); let rowStr = ""; for (let x = 0; x < LW; x += 2) rowStr += solidM(x, dbgRow) ? "#" : "."; splitDbg.push("from=" + from.x0 + "-" + from.x1 + "@" + from.y + " row=" + dbgRow + " " + rowStr + " above=" + (solidM(Math.round((from.x0 + from.x1) / 2), from.y - 12) ? "ROCK" : "air") + "/" + (solidM(Math.round((from.x0 + from.x1) / 2), from.y - 24) ? "ROCK" : "air"));
      for (let y = yBot - step; y > yTop + 20; y -= step) {
        // safe side: wider ledges; risky side: narrow ledges with feathers
        const safeLeft = rand() < 0.5 || y === yBot - step ? true : false;
        const base = clamp(Math.round(ledgeW(t) * 0.7), 11, 26);
        const wL = safeLeft ? base + 6 : Math.max(11, base - 5), wR = safeLeft ? Math.max(11, base - 5) : base + 6;
        const L = placeLedge(pl, wL, pl.y - y, { noFallback: true, span: (yy) => { const s = freeSpan(yy, LW / 4); return { l: s.l, r: Math.min(s.r, LW / 2 - 18) }; } });
        const Rl = placeLedge(pr, wR, pr.y - y, { noFallback: true, span: (yy) => { const s = freeSpan(yy, LW * 3 / 4); return { l: Math.max(s.l, LW / 2 + 18), r: s.r }; } });
        if (L) { pl = L; if (!safeLeft && L.apex) addFeather(L.apex.apexX, L.apex.apexY - 4); }
        if (Rl) { pr = Rl; if (safeLeft && Rl.apex) addFeather(Rl.apex.apexX, Rl.apex.apexY - 4); }
      }
      // merge ledge above the pillar, reachable from both chains
      let top = null, tries = 0;
      while (!top && tries++ < 40) {
        const w = 40, y = merge.y - Math.round(rr(4, 16)), cx = LW / 2 + rr(-16, 16);
        const B = { x0: Math.round(cx - w / 2), x1: Math.round(cx + w / 2), y, w };
        const poly = [[B.x0, y], [B.x1, y], [B.x1 + 6, y + 10], [B.x1 - 4, y + 30], [B.x0 + 4, y + 30], [B.x0 - 6, y + 10]];
        const a = ledgeReachable(pl, B, bboxOf(poly)), b = ledgeReachable(pr, B, bboxOf(poly));
        if (a || b) { top = B; B.apex = a || b; fill(poly); ledges.push(B); }
        else merge.y += 6;
      }
      return top || (pl.y < pr.y ? pl : pr);
    }
    function overhangs(from, h, t) {
      const yBot = from.y, yTop = yBot - h;
      walls(yBot, yTop, lerp(4, 10, t), 6);
      let prev = from, side = (from.x0 + from.x1) / 2 > LW / 2 ? -1 : 1;   // first shelf on the far side
      for (let y = yBot - lerp(50, 64, t); y > yTop; y -= lerp(50, 64, t)) {
        let ext = lerp(0.62, 0.72, t), placed = null, tries = 0;
        ext = Math.min(ext, side < 0 ? (prev.x0 - 8) / LW : 1 - (prev.x1 + 8) / LW);   // never roof over the ledge we jump from
        ext = Math.max(ext, 0.28);
        while (!placed && tries++ < 6) {
          const xe = side < 0 ? Math.round(LW * ext) : Math.round(LW * (1 - ext));
          const w = Math.round(LW * ext) - 10;
          const shelf = (B) => side < 0 ? [[-20, B.y], [xe, B.y], [xe + 6, B.y + 9], [xe - 6, B.y + 30], [-20, B.y + 36]] : [[xe, B.y], [LW + 20, B.y], [LW + 20, B.y + 36], [xe + 6, B.y + 30], [xe - 6, B.y + 9]];
          placed = placeLedge(prev, w, prev.y - y, { cx: side < 0 ? xe - w / 2 - 2 : xe + w / 2 + 2, span: () => ({ l: side < 0 ? 0 : xe - 2, r: side < 0 ? xe + 2 : LW - 1 }), poly: shelf });
          if (!placed) ext -= 0.06;
        }
        if (!placed) break;
        if (rand() < lerp(0.3, 0.7, t)) addHazard(Math.round(placed.y + 14), t);
        if (placed.apex && rand() < 0.6) addFeather(placed.apex.apexX, placed.apex.apexY - 4);
        prev = placed; side = -side;
      }
      return prev;
    }
    // ---- assemble the mountain ---------------------------------------------------------------------
    ledges.push({ x0: 6, x1: LW - 6, y: 0, w: LW - 12 });
    fillRect(-20, 0, LW + 20, 60);
    const plan = [
      ["cavern", 180, { inset: 6, jag: 8 }], ["slabs", 150], ["tunnel", 220], ["cavern", 200, { hazards: true }], ["split", 240],
      ["overhangs", 220], ["tunnel", 240], ["cavern", 200, { hazards: true }], ["split", 240], ["overhangs", 240], ["cavern", 200, { hazards: true, inset: 22 }]
    ];
    let prev = ledges[0], topY = 0; const secLog = [], splitDbg = []; const genT0 = performance.now();
    plan.forEach((sec, i) => {
      const t = i / (plan.length - 1), kind = sec[0], h = sec[1], opts = sec[2] || {};
      const before = ledges.length, y0 = prev.y;
      if (kind === "cavern") prev = cavern(prev, h, t, opts);
      else if (kind === "slabs") prev = cavern(prev, h, t, { wide: true, step: 66, inset: 4, jag: 6 });
      else if (kind === "tunnel") prev = tunnel(prev, h, t);
      else if (kind === "split") prev = split(prev, h, t);
      else if (kind === "overhangs") prev = overhangs(prev, h, t);
      topY = prev.y; secLog.push(kind + ":" + (ledges.length - before) + "/" + (y0 - prev.y));
    });
    window.__ccSecs = secLog; window.__ccSplit = splitDbg;
    const genMs = Math.round(performance.now() - genT0);
    // the summit: a wide nest ledge, reachable from wherever the last section ended
    let summit = null, tries = 0;
    while (!summit && tries++ < 40) {
      const w = 60, y = prev.y - Math.round(rr(36, 46)) + tries * 2, cx = LW / 2 + rr(-10, 10);
      const B = { x0: Math.round(cx - w / 2), x1: Math.round(cx + w / 2), y, w, summit: true };
      const poly = [[B.x0, y], [B.x1, y], [B.x1 + 6, y + 10], [B.x1 - 6, y + 34], [B.x0 + 6, y + 34], [B.x0 - 6, y + 10]];
      if (ledgeReachable(prev, B, bboxOf(poly))) { summit = B; fill(poly); ledges.push(B); }
    }
    if (!summit) { const w = 60, y = prev.y - 30, cx = LW / 2; summit = { x0: cx - 30, x1: cx + 30, y, w, summit: true }; fill([[summit.x0, y], [summit.x1, y], [summit.x1, y + 30], [summit.x0, y + 30]]); ledges.push(summit); }
    topY = summit.y;
    walls(topY, topY - 120, 6, 8);
    // sweep away slivers left between carved shapes
    // (computed against a snapshot so removals cannot cascade along an edge)
    for (let pass = 0; pass < 2; pass++) {
      const snap = mask.slice();
      for (let y = Y_TOP + 1; y < 60; y++) for (let x = 1; x < LW - 1; x++) {
        if (!snap[mi(x, y)]) continue; let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && snap[mi(x + dx, y + dy)]) n++;
        if (n <= 2) mask[mi(x, y)] = 0;
      }
    }
    // grass on every ledge top
    for (const L of ledges) for (let y = L.y; y < L.y + 3; y++) for (let x = L.x0; x <= L.x1; x++) { if (x >= 0 && x < LW && mask[mi(x, y)]) mask[mi(x, y)] = 2; }
    // clouds for the sky (parallax)
    const clouds = [];
    for (let y = 40; y > topY - 200; y -= rr(28, 60)) clouds.push({ x: rr(-10, LW + 10), y, w: rr(18, 44), h: rr(7, 12), k: rand() });
    const TOTAL_FEATHERS = feathers.length;

    // ---- colour the mask ---------------------------------------------------------------------------
    const solid = (x, y) => (x < 0 || x >= LW) ? true : (y < Y_TOP || y > 60) ? false : mask[mi(x, y)] > 0;
    const grassAt = (x, y) => x >= 0 && x < LW && y >= Y_TOP && y <= 60 && mask[mi(x, y)] === 2;
    const levelC = new OffscreenCanvas(LW, LH), lc = levelC.getContext("2d");
    (function paint() {
      const img = lc.createImageData(LW, LH), d = img.data;
      const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      const cols = { rock: hex(C.rock), edge: hex(C.edge), dark: hex(C.dark), grass: hex(C.grass), grassHi: hex(C.grassHi) };
      const near = (x, y, r, pred) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (pred(x + dx, y + dy)) return true; return false; };
      const sky = (x, y) => !solid(x, y);
      for (let y = Y_TOP; y <= 60; y++) for (let x = 0; x < LW; x++) {
        const v = mask[mi(x, y)]; if (!v) continue;
        let c;
        if (v === 2) c = (y === Y_TOP || mask[mi(x, y - 1)] === 0) ? cols.grassHi : cols.grass;
        else if (near(x, y, 1, sky)) c = cols.dark;
        else if (near(x, y, 3, sky)) c = cols.edge;
        else c = cols.rock;
        const o = ((y - Y_TOP) * LW + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
      lc.putImageData(img, 0, 0);
    })();

    // ---- audio -----------------------------------------------------------------------------------
    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const Ctor = window.AudioContext || window.webkitAudioContext; if (!Ctor) return;
      try { AC = new Ctor(); master = AC.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(AC.destination); } catch (_) { AC = null; }
    }
    function resumeAC() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (_) {} } }
    function tone(freq, delay, dur, type, peak, glide) {
      ensureAC(); resumeAC(); if (!AC || muted) return;
      try {
        const o = AC.createOscillator(), gn = AC.createGain(); o.type = type || "square";
        const t = AC.currentTime + (delay || 0);
        o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur * 0.9);
        gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(peak || 0.2, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.02);
      } catch (_) {}
    }
    const sfx = {
      charge(c) { tone(160 + c * 380, 0, 0.05, "triangle", 0.08); },
      jump(c) { tone(260 + 120 * c, 0, 0.16, "sine", 0.22, 620 + 200 * c); },
      flap() { tone(420, 0, 0.07, "sawtooth", 0.1, 160); tone(700, 0.03, 0.05, "triangle", 0.08, 300); },
      land() { tone(140, 0, 0.09, "triangle", 0.22, 70); },
      bounce() { tone(520, 0, 0.05, "square", 0.1, 300); },
      thud() { tone(90, 0, 0.25, "sine", 0.3, 40); tone(60, 0.02, 0.2, "sawtooth", 0.12, 30); },
      collect() { tone(1046, 0, 0.06, "square", 0.1); tone(1568, 0.06, 0.1, "square", 0.1); },
      hurt() { tone(330, 0, 0.12, "sawtooth", 0.16, 120); tone(220, 0.1, 0.12, "square", 0.12, 90); },
      win() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.1, 0.14, "square", 0.12)); },
      ui() { tone(880, 0, 0.05, "square", 0.08); }
    };
    function applyMute() { if (master) master.gain.value = muted ? 0 : 0.6; }

    // ---- state -------------------------------------------------------------------------------------
    let state = "title";   // title | play | won
    let frames = 0, started = false, runT = 0, runStarted = false, bestT = Number(await store.get("bestT", 0)) || 0, bestH = Number(await store.get("bestH", 0)) || 0;
    const P = { x: LW / 2, y: -R, vx: 0, vy: 0, grounded: true, flaps: MAX_FLAPS, dir: 1, face: 1, charging: false, charge: 0, aim: 0, stun: 0, hurt: 0, fallFrom: 0, wing: 0, wingT: 0, land: 0, noFlap: 0 };
    let progress = 0, feathersGot = 0, falls = 0, bigFall = 0, camY = 0, shake = 0, stars = [], puffs = [], lastSubmitH = 0;
    let coachT = 0, plays = Number(await store.get("plays", 0)) || 0, freeFlight = !!(await store.get("free", false));
    const fmtT = (ms) => { const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, c = Math.floor(ms / 10) % 100; return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "." + String(c).padStart(2, "0"); };

    function reset() {
      P.x = LW / 2; P.y = -R; P.vx = 0; P.vy = 0; P.grounded = true; P.flaps = MAX_FLAPS; P.charging = false; P.charge = 0; P.aim = 0; P.stun = 0; P.hurt = 0; P.face = 1; P.fallFrom = -R;
      progress = 0; feathersGot = 0; falls = 0; runT = 0; runStarted = false; stars = []; puffs = []; lastSubmitH = 0;
      for (const f of feathers) f.taken = false;
      camY = clamp(P.y - viewH * 0.6, Y_TOP + 8, 60 - viewH);
    }

    // ---- collision against the pixel mask ------------------------------------------------------------
    const SAMPLES = 16;
    function contact(x, y) {
      let nx = 0, ny = 0, n = 0, grass = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const a = i / SAMPLES * Math.PI * 2, sx = x + Math.cos(a) * R, sy = y + Math.sin(a) * R;
        const px = Math.floor(sx), py = Math.floor(sy);
        if (solid(px, py)) { nx -= Math.cos(a); ny -= Math.sin(a); n++; if (grassAt(px, py)) grass++; }
      }
      if (!n) return null;
      const len = Math.hypot(nx, ny) || 1;
      return { nx: nx / len, ny: ny / len, n, grass };
    }
    function stepPhysics(dt) {
      if (P.stun > 0) P.stun -= dt;
      if (P.hurt > 0) P.hurt -= dt;
      if (P.grounded) {
        // still grounded? (ledge could be left only by jumping)
        return;
      }
      P.vy += GRAV * dt;
      P.vy = Math.min(P.vy, 380);
      // sub-steps so fast falls never tunnel
      const steps = Math.max(1, Math.ceil(Math.hypot(P.vx, P.vy) * dt / 3));
      for (let s = 0; s < steps; s++) {
        P.x += P.vx * dt / steps; P.y += P.vy * dt / steps;
        if (P.x < R) { P.x = R; P.vx = Math.abs(P.vx) * 0.5; }
        if (P.x > LW - R) { P.x = LW - R; P.vx = -Math.abs(P.vx) * 0.5; }
        let c = contact(P.x, P.y), guard = 0;
        while (c && guard++ < 12) {
          // push out along the normal
          P.x += c.nx * 0.6; P.y += c.ny * 0.6;
          const vn = P.vx * c.nx + P.vy * c.ny;
          if (guard === 1) {
            const landing = c.ny < -0.6 && c.grass >= 1 && P.vy > -10;
            if (landing) { landOn(c); return; }
            if (vn < 0) {
              // bounce off rock: lose most of the normal speed, keep some slide
              const e = 0.32; const tx = -c.ny, ty = c.nx; const vt = P.vx * tx + P.vy * ty;
              P.vx = tx * vt * 0.86 - c.nx * vn * e; P.vy = ty * vt * 0.86 - c.ny * vn * e;
              if (-vn > 60) { sfx.bounce(); haptic("light"); }
              if (c.ny < -0.85 && Math.abs(vt) < 30) { P.vx += (rand() < 0.5 ? -1 : 1) * 20; }   // never rest on bare rock
            }
          }
          c = contact(P.x, P.y);
        }
      }
      if (P.y > 60) { P.y = -R; P.x = LW / 2; P.vx = 0; P.vy = 0; }   // safety
    }
    function landOn(c) {
      const fall = P.y - P.fallFrom;
      P.grounded = true; P.vx = 0; P.vy = 0; P.flaps = MAX_FLAPS; P.land = 0.18;
      // settle exactly on the ledge top
      for (let k = 0; k < 8 && contact(P.x, P.y); k++) P.y -= 0.5;
      P.y = Math.round(P.y + R) - R - 0.01;
      // a ledge is only home if the feet are on grass
      if (fall > 90) { P.stun = 0.6; falls++; bigFall = fall; sfx.thud(); haptic("heavy"); shake = 5; for (let i = 0; i < 6; i++) stars.push({ x: P.x + rr(-6, 6), y: P.y - 8 - rr(0, 6), t: 0 }); }
      else { sfx.land(); haptic("light"); for (let i = 0; i < 4; i++) puffs.push({ x: P.x + rr(-5, 5), y: P.y + 3, vx: rr(-14, 14), t: 0 }); }
      const ledge = ledges.find((L) => Math.abs(L.y - (P.y + R)) < 3 && P.x >= L.x0 - 2 && P.x <= L.x1 + 2);
      if (ledge && ledge.summit && state === "play") win();
      void c;
    }
    function doJump() {
      const c = clamp(P.charge, 0.2, 1);
      const v = launch(P.aim, c); P.vx = v.vx; P.vy = v.vy; P.grounded = false; P.charging = false; P.charge = 0;
      P.fallFrom = P.y; P.face = P.aim || P.face; P.y -= 1;
      if (!runStarted) { runStarted = true; try { ctx.platform.interact(); } catch (_) {} }
      sfx.jump(c); haptic("medium"); for (let i = 0; i < 3; i++) puffs.push({ x: P.x + rr(-4, 4), y: P.y + 4, vx: rr(-10, 10), t: 0 });
    }
    function doFlap(dir) {
      if (P.grounded || P.stun > 0) return;
      if (P.flaps <= 0) { P.noFlap = 0.3; sfx.ui(); return; }
      if (!freeFlight) P.flaps--; P.vy = Math.min(P.vy, 40) - FLAP_VY; P.vx = flapVx(P.vx, dir); if (dir) P.face = dir;
      P.fallFrom = Math.min(P.fallFrom, P.y); P.wing = 0.22; sfx.flap(); haptic("light");
    }
    function win() {
      state = "won"; stateT = 0; sfx.win(); haptic("success"); shake = 4;
      const ms = Math.round(runT * 1000);
      if (!freeFlight && (!bestT || ms < bestT)) { bestT = ms; store.set("bestT", bestT); }
      bestH = 100; store.set("bestH", 100);
      try {
        if (!freeFlight) ctx.memory.record("time").submit(ms, { label: fmtT(ms) }).catch(() => {});
        ctx.memory.record("height").submit(100, { label: "100%" }).catch(() => {});
        ctx.memory.record("feathers").submit(feathersGot, { label: feathersGot + "/" + TOTAL_FEATHERS }).catch(() => {});
        ctx.platform.milestone("summit", { timeMs: ms, falls, feathers: feathersGot });
        ctx.platform.complete({ timeMs: ms, falls, feathers: feathersGot, height: 100, mode: freeFlight ? "free" : "classic" });
      } catch (_) {}
    }
    let stateT = 0;
    function tick(dt) {
      frames++; stateT += dt;
      if (shake > 0) shake -= dt * 20;
      for (const s of stars) s.t += dt; stars = stars.filter((s) => s.t < 0.9);
      for (const p of puffs) { p.t += dt; p.x += p.vx * dt; } puffs = puffs.filter((p) => p.t < 0.4);
      for (const h of hazards) { h.t += dt; h.x += h.sp * dt; if (h.x < h.x0) { h.x = h.x0; h.sp = Math.abs(h.sp); } if (h.x > h.x1) { h.x = h.x1; h.sp = -Math.abs(h.sp); } }
      for (const f of feathers) f.t += dt;
      if (state === "title") { P.wingT += dt; return; }
      if (state === "play" && runStarted) runT += dt;
      if (P.charging) { P.charge = clamp(P.charge + dt / CHARGE_T, 0, 1); if (frames % 6 === 0) sfx.charge(P.charge); }
      if (P.wing > 0) P.wing -= dt; if (P.land > 0) P.land -= dt;
      if (state !== "won") stepPhysics(dt);
      // pickups and hazards
      for (const f of feathers) if (!f.taken && Math.abs(f.x - P.x) < 7 && Math.abs(f.y - P.y) < 8) { f.taken = true; feathersGot++; sfx.collect(); haptic("light"); }
      if (P.hurt <= 0 && state === "play") for (const h of hazards) if (Math.abs(h.x - P.x) < 7 && Math.abs(h.y - P.y) < 7) {
        P.hurt = 1.0; P.grounded = false; P.vx = (P.x < h.x ? -1 : 1) * 110; P.vy = -70; P.flaps = 0; P.fallFrom = Math.min(P.fallFrom, P.y); P.charging = false; sfx.hurt(); haptic("heavy"); shake = 4;
      }
      // progress
      const pr = clamp((0 - (P.y + R)) / (0 - topY), 0, 1);
      if (pr > progress) { progress = pr; if (progress * 100 > bestH) { bestH = Math.floor(progress * 100); store.set("bestH", bestH); } if (progress - lastSubmitH >= 0.05 && state === "play") { lastSubmitH = progress; try { ctx.memory.record("height").submit(Math.floor(progress * 100), { label: Math.floor(progress * 100) + "%" }).catch(() => {}); ctx.platform.setScore(Math.floor(progress * 100)); } catch (_) {} } }
      // camera
      const target = P.y - viewH * 0.58;
      camY += (target - camY) * Math.min(1, dt * 5);
      camY = clamp(camY, Y_TOP + 8, 60 - viewH);
    }

    // ---- sprites + font ------------------------------------------------------------------------------
    const PAL = { W: C.white, R: C.red, O: C.beak, K: C.black, S: C.shade, Y: C.gold, D: C.dark, E: C.edge, G: "#c9a227" };
    function raster(rows, flip) {
      const h = rows.length, w = rows[0].length, oc = new OffscreenCanvas(w, h), c = oc.getContext("2d");
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows[y][x]; if (ch === ".") continue; c.fillStyle = PAL[ch] || "#f0f"; c.fillRect(flip ? w - 1 - x : x, y, 1, 1); }
      return oc;
    }
    const SPR = {};
    function def(name, rows) { SPR[name] = raster(rows, false); SPR[name + "_f"] = raster(rows, true); }
    // 14x14 with a plum outline and yellow wings so it reads against clouds
    def("idle", ["......DRD.....", ".....DRRRD....", ".....DWWWWD...", "....DWWKWWWDD.", "....DWWWWWWDOD", "...DWWWWWWWWD.", "..DWYYYWWWWWD.", "..DWYYYYWWWWD.", "..DWWYYWWWWD..", "...DWWWWWWD...", "....DDDDDD....", ".....DOD.DOD..", "....DOODDOOD..", ".....DDD.DDD.."]);
    def("up", ["......DRD.....", ".....DRRRD....", ".DYD.DWWWWD.DD", "..DYDWWKWWWDYD", "...DYWWWWWWDOD", "...DWWWWWWWWD.", "..DWWWWWWWWWD.", "..DWWWWWWWWWD.", "..DWWYYWWWWD..", "...DWWWWWWD...", "....DDDDDD....", ".....DOD.DOD..", "....DOODDOOD..", ".....DDD.DDD.."]);
    def("down", ["......DRD.....", ".....DRRRD....", ".....DWWWWD...", "....DWWKWWWDD.", "....DWWWWWWDOD", "...DWWWWWWWWD.", "DDDDWWWWWWWWDD", "DYYYYWWWWWWYYD", ".DDDDWYYWWWDDD", "...DWWWWWWD...", "....DDDDDD....", ".....DOD.DOD..", "....DOODDOOD..", ".....DDD.DDD.."]);
    def("dizzy", ["......DRD.....", ".....DRRRD....", ".....DWWWWD...", "....DWWSWWWDD.", "....DWWKWWWDOD", "...DWWWWWWWWD.", "..DWYYYWWWWWD.", "..DWYYYYWWWWD.", "..DWWYYWWWWD..", "...DWWWWWWD...", "....DDDDDD....", ".....DOD.DOD..", "....DOODDOOD..", ".....DDD.DDD.."]);
    def("cup", ["G........G", "GYYYYYYYYG", "GYYYYYYYYG", ".GYYYYYYG.", "..GYYYYG..", "...GYYG...", "....YY....", "....YY....", "..YYYYYY..", ".YYYYYYYY."]);
    def("nest", ["..EEEEEEEEEE..", ".EDEDEDEDEDEDE", "DEDEDEDEDEDEDED", ".DDDDDDDDDDDDD.", "..DDDDDDDDDDD.."]);
    def("star", ["..Y..", ".YYY.", "YYYYY", ".YYY.", "..Y.."]);
    def("star2", [".....", "..Y..", ".YYY.", "..Y..", "....."]);
    def("flapdot", ["..W..", ".WWW.", "..W.."]);
    const FONT = {
      A: "0E,11,11,1F,11,11,11", B: "1E,11,11,1E,11,11,1E", C: "0E,11,10,10,10,11,0E", D: "1E,11,11,11,11,11,1E", E: "1F,10,10,1E,10,10,1F", F: "1F,10,10,1E,10,10,10",
      G: "0E,11,10,17,11,11,0F", H: "11,11,11,1F,11,11,11", I: "0E,04,04,04,04,04,0E", J: "07,02,02,02,02,12,0C", K: "11,12,14,18,14,12,11", L: "10,10,10,10,10,10,1F",
      M: "11,1B,15,15,11,11,11", N: "11,11,19,15,13,11,11", O: "0E,11,11,11,11,11,0E", P: "1E,11,11,1E,10,10,10", Q: "0E,11,11,11,15,12,0D", R: "1E,11,11,1E,14,12,11",
      S: "0F,10,10,0E,01,01,1E", T: "1F,04,04,04,04,04,04", U: "11,11,11,11,11,11,0E", V: "11,11,11,11,11,0A,04", W: "11,11,11,15,15,15,0A", X: "11,11,0A,04,0A,11,11",
      Y: "11,11,11,0A,04,04,04", Z: "1F,01,02,04,08,10,1F", "0": "0E,11,13,15,19,11,0E", "1": "04,0C,04,04,04,04,0E", "2": "0E,11,01,02,04,08,1F", "3": "1F,02,04,02,01,11,0E",
      "4": "02,06,0A,12,1F,02,02", "5": "1F,10,1E,01,01,11,0E", "6": "06,08,10,1E,11,11,0E", "7": "1F,01,02,04,08,08,08", "8": "0E,11,11,0E,11,11,0E", "9": "0E,11,11,0F,01,02,0C",
      " ": "00,00,00,00,00,00,00", ":": "00,0C,0C,00,0C,0C,00", ".": "00,00,00,00,00,0C,0C", "%": "19,1A,02,04,08,0B,13", "!": "04,04,04,04,04,00,04", "/": "01,02,02,04,08,08,10", "-": "00,00,00,1F,00,00,00", "(": "02,04,08,08,08,04,02", ")": "08,04,02,02,02,04,08"
    };
    const glyphCache = {};
    function glyph(ch, color) {
      const key = ch + color; let c = glyphCache[key]; if (c) return c;
      const rows = (FONT[ch] || FONT["-"]).split(",");
      const oc = new OffscreenCanvas(6, 8), cc = oc.getContext("2d"); cc.fillStyle = color;
      for (let y = 0; y < 7; y++) { const bits = parseInt(rows[y], 16); for (let x = 0; x < 5; x++) if (bits & (16 >> x)) cc.fillRect(x, y, 1, 1); }
      glyphCache[key] = oc; return oc;
    }
    let fb = null, fbc = null, viewH = 200, S = 1, ox = 0;
    function text(s, x, y, color, scale) {
      scale = scale || 1;
      for (let i = 0; i < s.length; i++) { if (s[i] === " ") continue; fb.drawImage(glyph(s[i], color || C.white), x + i * 6 * scale, y, 6 * scale, 8 * scale); }
    }
    function otext(s, x, y, color, scale) {   // outlined
      scale = scale || 1;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) text(s, x + dx * scale, y + dy * scale, C.black, scale);
      text(s, x, y, color, scale);
    }
    const tw = (s, scale) => s.length * 6 * (scale || 1) - (scale || 1);
    function otextC(s, cx, y, color, scale) { otext(s, Math.round(cx - tw(s, scale) / 2), y, color, scale); }

    // ---- drawing ---------------------------------------------------------------------------------------
    function drawWorld() {
      const cy = Math.round(camY), sx = shake > 0 ? Math.round(rr(-1, 1) * shake * 0.3) : 0;
      // sky
      const grad = fb.createLinearGradient(0, 0, 0, viewH); grad.addColorStop(0, "#1a9cec"); grad.addColorStop(1, "#33b8ff");
      fb.fillStyle = grad; fb.fillRect(0, 0, LW, viewH);
      // clouds, parallax
      fb.fillStyle = C.cloud;
      for (const cl of clouds) {
        const y = cl.y * 0.6 + cy * 0.4 - cy + viewH * 0.1; if (y < -20 || y > viewH + 20) continue;
        const x = cl.x + sx;
        fb.fillRect(Math.round(x - cl.w / 2), Math.round(y), Math.round(cl.w), Math.round(cl.h));
        fb.fillRect(Math.round(x - cl.w / 4), Math.round(y - cl.h * 0.6), Math.round(cl.w / 2), Math.round(cl.h * 0.6));
        fb.fillRect(Math.round(x - cl.w / 2 + 3), Math.round(y + cl.h), Math.round(cl.w - 6), 2);
      }
      // rock
      fb.drawImage(levelC, 0, cy - Y_TOP, LW, viewH, sx, 0, LW, viewH);
      if (cy + viewH > 60) { fb.fillStyle = C.rock; fb.fillRect(0, 61 - cy, LW, viewH); }
      // nest + cup at the summit
      fb.drawImage(SPR.nest, Math.round(LW / 2 - 7) + sx, summit.y - 4 - cy); fb.drawImage(SPR.cup, Math.round(LW / 2 - 5) + sx, summit.y - 13 - cy);
      // feathers
      for (const f of feathers) { if (f.taken) continue; const y = f.y - cy; if (y < -8 || y > viewH + 8) continue; fb.drawImage(Math.floor(f.t * 4) % 2 ? SPR.star : SPR.star2, f.x - 2 + sx, Math.round(y - 2 + Math.sin(f.t * 3) * 1.5)); }
      // hazards: spinning orange diamonds with a plum outline
      for (const h of hazards) {
        const y = h.y - cy; if (y < -10 || y > viewH + 10) continue;
        fb.save(); fb.translate(Math.round(h.x) + sx, Math.round(y)); fb.rotate(h.t * 3);
        fb.fillStyle = C.dark; fb.fillRect(-5, -5, 10, 10); fb.fillStyle = C.edge; fb.fillRect(-4, -4, 8, 8); fb.fillStyle = C.gold; fb.fillRect(-2, -2, 4, 4);
        fb.restore();
      }
      // puffs and stars
      fb.fillStyle = C.cloud; for (const p of puffs) fb.fillRect(Math.round(p.x) + sx, Math.round(p.y - cy - p.t * 12), 2, 2);
      for (const s of stars) fb.drawImage(SPR.star2, Math.round(s.x + Math.sin(s.t * 8 + s.x) * 3) + sx - 2, Math.round(s.y - cy - s.t * 6) - 2);
      // trajectory preview while charging
      if (P.charging) {
        const c = clamp(P.charge, 0.2, 1), v = launch(P.aim, c); let x = P.x, y = P.y, vx = v.vx, vy = v.vy;
        fb.fillStyle = "rgba(255,255,255,0.85)";
        for (let i = 0; i < 40; i++) { const dt = 1 / 60; x += vx * dt; y += vy * dt; vy += GRAV * dt; if (i % 5 === 4) fb.fillRect(Math.round(x) - 1 + sx, Math.round(y - cy) - 1, 2, 2); if (solid(Math.floor(x), Math.floor(y))) break; }
      }
      // the chicken
      const px = Math.round(P.x) - 7 + sx, py = Math.round(P.y) - 8 - cy, flip = P.face < 0;
      const name = P.stun > 0 ? "dizzy" : P.wing > 0.1 ? "up" : P.wing > 0 ? "down" : (!P.grounded && P.vy > 60) ? "down" : "idle";
      const sp = SPR[flip ? name + "_f" : name];
      if (P.hurt > 0 && Math.floor(frames / 3) % 2) { /* blink */ }
      else if (P.charging) { const sq = 1 - P.charge * 0.35; fb.drawImage(sp, px, py + Math.round(14 * (1 - sq)), 14, Math.round(14 * sq)); }
      else if (P.land > 0) { fb.drawImage(sp, px - 1, py + 2, 16, 12); }
      else fb.drawImage(sp, px, py);
      // aim arrow while charging
      if (P.charging && P.aim) { const ax = Math.round(P.x + Math.sign(P.aim) * 11) + sx, ay = py + 5; fb.fillStyle = C.white; fb.fillRect(ax - 2, ay, 4, 2); fb.fillRect(ax + Math.sign(P.aim) * 2, ay - 1, 1, 4); fb.fillRect(ax + Math.sign(P.aim) * 3, ay - 2, 1, 6); }
      // flap pips under the chicken: what is left of this jump
      if (state === "play") {
        const n = freeFlight ? 3 : P.flaps;
        for (let i = 0; i < (freeFlight ? 3 : MAX_FLAPS); i++) { const on = i < n; fb.globalAlpha = on ? 1 : 0.3; fb.drawImage(SPR.flapdot, Math.round(P.x) - 2 + (i - (MAX_FLAPS - 1) / 2) * 6 + sx, py + 16); fb.globalAlpha = 1; }
        if (P.noFlap > 0) { P.noFlap -= 1 / 60; otextC("NO FLAPS", Math.round(P.x), py - 10, C.edge); }
      }
      if (P.stun > 0) for (let i = 0; i < 3; i++) { const a = frames * 0.15 + i * 2.1; fb.drawImage(SPR.star2, px + 6 + Math.round(Math.cos(a) * 7) - 2, py - 3 + Math.round(Math.sin(a) * 2) - 2); }
    }
    function drawHUD() {
      const top = Math.ceil(sa.top * dpr / S) + 3;
      otext(fmtT(Math.round(runT * 1000)), 3, top, C.white);
      const pc = Math.floor(progress * 100) + "%"; otext(pc, LW - 3 - tw(pc), top, C.white);
      if (feathersGot > 0) { fb.drawImage(SPR.star, 3, top + 11); otext(String(feathersGot), 10, top + 10, C.gold); }
      if (state === "play" && plays <= 2) {
        const bottom = viewH - Math.ceil(sa.bottom * dpr / S) - 14;
        if (P.grounded && !P.charging && !runStarted) { otextC("HOLD TO CHARGE A JUMP", LW / 2, bottom - 12, C.white); otextC("DRAG SIDEWAYS TO AIM", LW / 2, bottom, C.white); }
        else if (P.charging) otextC("DRAG FURTHER TO AIM WIDER", LW / 2, bottom, C.white);
        else if (!P.grounded && P.flaps === MAX_FLAPS && runT < 30) { otextC("TAP TO FLAP. TAP LEFT OR", LW / 2, bottom - 12, C.white); otextC("RIGHT OF IT TO STEER", LW / 2, bottom, C.white); }
        else if (P.grounded && falls === 0 && runT < 40 && runStarted) otextC("ONLY GREEN LEDGES HOLD", LW / 2, bottom, C.white);
      }
    }
    function drawTitle() {
      const top = Math.ceil(sa.top * dpr / S) + 14;
      otextC("CLUCK", LW / 2, top + 8, C.gold, 3); otextC("CLIMB", LW / 2, top + 34, C.white, 3);
      otextC("A PRECISION CLIMB", LW / 2, top + 64, C.cloud);
      const y = Math.round(viewH * 0.42);
      otextC("HOLD TO CHARGE A JUMP", LW / 2, y - 12, C.white); otextC("DRAG SIDEWAYS TO AIM", LW / 2, y, C.white); otextC("RELEASE TO JUMP", LW / 2, y + 12, C.white);
      otextC("TAP IN THE AIR TO FLAP", LW / 2, y + 28, C.white); otextC("TAP LEFT OR RIGHT OF IT", LW / 2, y + 40, C.white); otextC("TO STEER THE FLAP", LW / 2, y + 52, C.white);
      otextC("ONLY GREEN LEDGES HOLD", LW / 2, y + 68, C.grassHi); otextC("MISS AND YOU FALL", LW / 2, y + 80, C.edge);
      if (bestT) otextC("BEST " + fmtT(bestT), LW / 2, y + 96, C.gold); else if (bestH) otextC("BEST HEIGHT " + bestH + "%", LW / 2, y + 96, C.gold);
      // mode toggle
      modeBox.y = viewH - Math.ceil(sa.bottom * dpr / S) - 62; modeBox.h = 22;
      fb.fillStyle = "rgba(20,10,30,0.55)"; fb.fillRect(14, modeBox.y, LW - 28, modeBox.h);
      otextC(freeFlight ? "MODE: FREE FLIGHT" : "MODE: CLASSIC", LW / 2, modeBox.y + 3, freeFlight ? C.gold : C.grassHi);
      otextC(freeFlight ? "UNLIMITED FLAPS. NOT RANKED" : "3 FLAPS A JUMP. RANKED", LW / 2, modeBox.y + 13, C.cloud);
      if (Math.floor(frames / 25) % 2) otextC("TAP TO START", LW / 2, viewH - Math.ceil(sa.bottom * dpr / S) - 32, C.gold);
      otext("L" + ledges.length + " H" + (-topY) + " F" + TOTAL_FEATHERS + " X" + fallbacks + " " + genMs + "MS", 2, viewH - Math.ceil(sa.bottom * dpr / S) - 10, C.cloud);
    }
    const modeBox = { y: 0, h: 22 };
    function drawWon() {
      const y = Math.round(viewH * 0.3);
      fb.fillStyle = "rgba(20,10,30,0.7)"; fb.fillRect(10, y - 10, LW - 20, 84);
      otextC(freeFlight ? "FREE FLIGHT" : "BRAVEST!", LW / 2, y, C.gold, 2);
      otextC("TIME " + fmtT(Math.round(runT * 1000)), LW / 2, y + 24, C.white);
      otextC("FALLS " + falls + "   FEATHERS " + feathersGot + "/" + TOTAL_FEATHERS, LW / 2, y + 36, C.white);
      if (bestT) otextC("BEST " + fmtT(bestT), LW / 2, y + 48, C.gold);
      if (stateT > 1.5 && Math.floor(frames / 25) % 2) otextC("TAP TO PLAY AGAIN", LW / 2, y + 64, C.white);
    }
    function drawFrame() {
      drawWorld();
      if (state === "title") drawTitle(); else drawHUD();
      if (state === "won") drawWon();
    }

    // ---- layout + present --------------------------------------------------------------------------------
    const dpr = ctx.dpr || 1;
    let W = ctx.width, Hh = ctx.height;
    function layout() {
      W = ctx.width; Hh = ctx.height;
      S = Math.max(1, Math.floor(canvas.width / LW)); viewH = Math.ceil(canvas.height / S); ox = Math.floor((canvas.width - LW * S) / 2);
      fbc = new OffscreenCanvas(LW, viewH); fb = fbc.getContext("2d"); fb.imageSmoothingEnabled = false;
    }
    layout(); camY = clamp(P.y - viewH * 0.6, Y_TOP + 8, 60 - viewH);
    function present() {
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#12203a"; g.fillRect(0, 0, canvas.width, canvas.height);
      g.imageSmoothingEnabled = false; g.drawImage(fbc, ox, 0, LW * S, viewH * S);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.font = "16px ui-monospace,Menlo,Consolas,monospace"; g.fillStyle = "rgba(255,255,255,0.8)"; g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(muted ? "🔇" : "🔊", W - sa.right - 12, sa.top + 18);
    }

    // ---- input ----------------------------------------------------------------------------------------------
    let touch = null;
    function anyStart() {
      if (!started) { started = true; try { ctx.platform.start(); } catch (_) {} }
      ensureAC(); resumeAC();
      if (state === "title") { reset(); state = "play"; stateT = 0; plays++; store.set("plays", plays); return true; }
      if (state === "won" && stateT > 1.5) { state = "title"; stateT = 0; reset(); return true; }
      return false;
    }
    function worldX(clientX) { return (clientX * dpr - ox) / S; }
    function pressAt(cx) {
      if (P.stun > 0) return;
      if (P.grounded) { P.charging = true; P.charge = 0; P.aim = 0; }
      else { const dx = worldX(cx) - P.x; doFlap(Math.abs(dx) > 10 ? Math.sign(dx) : 0); }
    }
    ctx.listen(canvas, "pointerdown", (e) => {
      if (e.clientX > W - sa.right - 44 && e.clientY < sa.top + 34) { muted = !muted; store.set("muted", muted); applyMute(); sfx.ui(); return; }
      if (state === "title") { const wy = e.clientY * dpr / S; if (wy >= modeBox.y - 4 && wy <= modeBox.y + modeBox.h + 4) { freeFlight = !freeFlight; store.set("free", freeFlight); sfx.ui(); haptic("light"); return; } }
      if (anyStart()) return;
      if (touch) return;
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY };
      pressAt(e.clientX);
    });
    ctx.listen(canvas, "pointermove", (e) => {
      if (!touch || e.pointerId !== touch.id || !P.charging) return;
      const dx = e.clientX - touch.x; P.aim = Math.abs(dx) < 8 ? 0 : clamp(dx / 44, -1, 1); if (P.aim) P.face = Math.sign(P.aim);
    });
    const up = (e) => { if (!touch || e.pointerId !== touch.id) return; touch = null; if (P.charging && P.grounded) doJump(); P.charging = false; };
    ctx.listen(canvas, "pointerup", up); ctx.listen(canvas, "pointercancel", up);
    let keyAim = 0;
    ctx.listen(document, "keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "ArrowLeft" || e.code === "KeyA") { keyAim = -1; if (P.charging) { P.aim = -1; P.face = -1; } e.preventDefault(); }
      if (e.code === "ArrowRight" || e.code === "KeyD") { keyAim = 1; if (P.charging) { P.aim = 1; P.face = 1; } e.preventDefault(); }
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault(); if (anyStart()) return;
        if (P.grounded) { if (P.stun <= 0) { P.charging = true; P.charge = 0; P.aim = keyAim; } } else doFlap(keyAim);
      }
    });
    ctx.listen(document, "keyup", (e) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "ArrowRight" || e.code === "KeyD") { keyAim = 0; if (P.charging) P.aim = 0; }
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { if (P.charging && P.grounded) doJump(); P.charging = false; }
    });

    // ---- main loop --------------------------------------------------------------------------------------------
    let acc = 0, last = ctx.width + "x" + ctx.height;
    ctx.onFrame((dtMs) => {
      const now = ctx.width + "x" + ctx.height; if (now !== last) { last = now; layout(); }
      acc += Math.min(dtMs, 100);
      let n = 0; while (acc >= 1000 / 60 && n < 6) { acc -= 1000 / 60; tick(1 / 60); n++; }
      if (n === 6) acc = 0;
      drawFrame(); present();
    });

    // debug hooks for the headless harness
    window.__ccInfo = () => ({ state, free: freeFlight, genMs, fallbacks, x: Math.round(P.x * 10) / 10, y: Math.round(P.y * 10) / 10, vx: Math.round(P.vx), vy: Math.round(P.vy), grounded: P.grounded, flaps: P.flaps, charging: P.charging, progress: Math.round(progress * 1000) / 10, runT: Math.round(runT * 10) / 10, falls, feathers: feathersGot, total: TOTAL_FEATHERS, ledges: ledges.length, topY, hazards: hazards.length, S, viewH, camY: Math.round(camY) });
    window.__ccStart = () => anyStart();
    window.__ccRow = (y) => { let r = ""; for (let x = 0; x < LW; x += 2) r += mask[mi(x, y)] === 2 ? "g" : mask[mi(x, y)] ? "#" : "."; return r; };
    window.__ccJump = (dir, c) => { if (!P.grounded) return false; P.aim = dir; P.charge = c; P.charging = true; doJump(); return true; };
    window.__ccFlap = (dir) => doFlap(dir);
    window.__ccStep = (n) => { for (let i = 0; i < n; i++) tick(1 / 60); };
    window.__ccWarp = (x, y) => { P.x = x; P.y = y; P.vx = 0; P.vy = 0; P.grounded = true; P.flaps = MAX_FLAPS; camY = P.y - viewH * 0.58; };
    window.__ccLedge = (i) => { const L = ledges[i]; return L ? { x0: L.x0, x1: L.x1, y: L.y, w: L.w } : null; };
    window.__ccFree = (on) => { freeFlight = !!on; };
    window.__ccHold = (on) => { if (on) { P.charging = true; P.charge = 0.6; P.aim = 1; } else { P.charging = false; } };

    drawFrame(); present();
    try { ctx.markVisualReady("title"); } catch (_) {}
    ctx.platform.ready();
  }
};
