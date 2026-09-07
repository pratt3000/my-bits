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
      get(k, d) { try { const v = canStore ? ctx.storage.get("cc_" + k) : memStore[k]; return v == null ? d : v; } catch (_) { return d; } },
      set(k, v) { try { if (canStore) ctx.storage.set("cc_" + k, v); else memStore[k] = v; } catch (_) {} }
    };
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!store.get("muted", false);
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // ---- palette ---------------------------------------------------------------------------------
    const C = { sky: "#1eaaf0", skyHi: "#4cc0ff", rock: "#cb5065", edge: "#f5a048", dark: "#562048", cloud: "#faece0", grass: "#8ce048", grassHi: "#c2f57a",
      white: "#ffffff", red: "#e83a3a", beak: "#f5a048", black: "#141018", gold: "#ffe93a", shade: "#e4dcdc" };

    // ---- physics constants (world px, seconds) ---------------------------------------------------
    const LW = 160, GRAV = 430, R = 4.5;
    const JUMP_MIN = 105, JUMP_RANGE = 125, SIDE_X = 0.58, SIDE_Y = 0.84, FLAP_VY = 95, FLAP_VX = 28, MAX_FLAPS = 2, CHARGE_T = 0.75;
    function launch(dir, c) { const v = JUMP_MIN + JUMP_RANGE * c; return dir === 0 ? { vx: 0, vy: -v } : { vx: dir * v * SIDE_X, vy: -v * SIDE_Y }; }

    // ---- deterministic level --------------------------------------------------------------------
    function rng(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    const rand = rng(20260907);
    const rr = (a, b) => a + rand() * (b - a);
    const polys = [], ledges = [], hazards = [], feathers = [];
    const N = 34;   // ledges above the ground
    // ground
    ledges.push({ x0: 6, x1: LW - 6, y: 0, w: LW - 12 });
    polys.push([[-10, 0], [LW + 10, 0], [LW + 10, 60], [-10, 60]]);
    // simulate a jump from (px,py) and report whether it can land on ledge B
    function reachable(px, py, B) {
      const dirs = [-1, 0, 1], charges = [0.3, 0.45, 0.6, 0.75, 0.9, 1], flapPlans = [[], [0.3], [0.5], [0.3, 0.6], [0.45, 0.8]];
      const cy = B.y - R;
      let bestApex = null;
      for (const d of dirs) for (const c of charges) for (const fp of flapPlans) {
        let { vx, vy } = launch(d, c); let x = px, y = py, t = 0, fi = 0, apexY = py, apexX = px;
        for (let i = 0; i < 150; i++) {
          const dt = 1 / 60; t += dt;
          if (fi < fp.length && t >= fp[fi]) { vy = Math.min(vy, 40) - FLAP_VY; vx += d * FLAP_VX; fi++; }
          const py0 = y; x += vx * dt; y += vy * dt; vy += GRAV * dt;
          if (y < apexY) { apexY = y; apexX = x; }
          if (x < R || x > LW - R) break;
          if (vy > 0 && py0 <= cy && y >= cy) { if (x >= B.x0 + 3 && x <= B.x1 - 3) return { apexX, apexY }; break; }
          if (y > py + 10) break;
        }
      }
      return bestApex;
    }
    function ledgeReachable(A, B) {
      const pts = [A.x0 + A.w * 0.25, A.x0 + A.w * 0.5, A.x0 + A.w * 0.75];
      let ok = 0, apex = null;
      for (const px of pts) { const r = reachable(px, A.y - R, B); if (r) { ok++; apex = apex || r; } }
      return ok >= 2 ? apex : null;
    }
    function island(x0, x1, y, depth) {
      const w = x1 - x0, cx = (x0 + x1) / 2, kind = rand();
      if (kind < 0.45) {   // inverted trapezoid
        const b = Math.max(6, w * rr(0.3, 0.55)); return [[x0, y], [x1, y], [cx + b / 2, y + depth], [cx - b / 2, y + depth]];
      }
      if (kind < 0.75) {   // pointed
        return [[x0, y], [x1, y], [cx + rr(-4, 4), y + depth * 1.2]];
      }
      // chunky slab with a lip
      return [[x0, y], [x1, y], [x1 + 4, y + 6], [x1 - 2, y + depth], [x0 + 2, y + depth], [x0 - 4, y + 6]];
    }
    // side walls first: jagged bands that narrow the channel as you go up
    const EST_TOP = -(N * 54 + 60), knots = [];
    for (let y = 60; y >= EST_TOP - 200; y -= 34) {
      const t = clamp((0 - y) / (0 - EST_TOP), 0, 1);
      knots.push({ y: y + rr(-6, 6), l: lerp(4, 20, t) + rr(-3, 9), r: lerp(4, 20, t) + rr(-3, 9) });
    }
    polys.push([[-20, 60], ...knots.map((k) => [k.l, k.y]), [-20, EST_TOP - 240]]);
    polys.push([[LW + 20, 60], ...knots.map((k) => [LW - k.r, k.y]), [LW + 20, EST_TOP - 240]]);
    function channel(y) {   // widest wall intrusion within 40 px of y
      let l = 0, r = 0; for (const k of knots) if (Math.abs(k.y - y) < 40) { l = Math.max(l, k.l); r = Math.max(r, k.r); }
      return { l: l + 3, r: LW - r - 3 };
    }
    let prev = ledges[0], topY = 0;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      let w = Math.round(lerp(42, 13, Math.pow(t, 0.85)) + rr(-3, 3)); w = Math.max(11, w);
      let dy = lerp(38, 66, t) + rr(-6, 6), placed = null, tries = 0;
      const minDx = lerp(6, 34, t);
      while (!placed && tries++ < 120) {
        if (tries % 30 === 0) dy -= 8;
        const ch = channel(prev.y - dy);
        if (ch.r - ch.l < w + 4) { dy -= 4; continue; }
        const cx = rr(ch.l + w / 2, ch.r - w / 2);
        const pc = (prev.x0 + prev.x1) / 2;
        if (Math.abs(cx - pc) < minDx && rand() < 0.8) continue;
        const B = { x0: Math.round(cx - w / 2), x1: Math.round(cx + w / 2), y: Math.round(prev.y - dy), w };
        const apex = ledgeReachable(prev, B);
        if (apex) { placed = B; B.apex = apex; }
      }
      if (!placed) { const ch = channel(prev.y - 32), cx = clamp((prev.x0 + prev.x1) / 2, ch.l + w / 2, ch.r - w / 2); placed = { x0: Math.round(cx - w / 2), x1: Math.round(cx + w / 2), y: Math.round(prev.y - 32), w, apex: null }; }
      ledges.push(placed);
      polys.push(island(placed.x0, placed.x1, placed.y, Math.round(lerp(14, 26, rand()) + w * 0.35)));
      // a feather near the reference apex on most gaps
      if (placed.apex && rand() < 0.7) feathers.push({ x: clamp(Math.round(placed.apex.apexX), 8, LW - 8), y: Math.round(placed.apex.apexY) - 4, taken: false, t: rand() * 6 });
      // hazards drift across the gap on later stretches
      if (i >= 7 && rand() < lerp(0.15, 0.6, t)) {
        const hy = Math.round((prev.y + placed.y) / 2 + rr(-8, 8));
        const ch = channel(hy), span = Math.min(rr(26, 60), ch.r - ch.l - 16), hx = clamp(rr(ch.l + 8, ch.r - 8), ch.l + 8 + span / 2, ch.r - 8 - span / 2);
        hazards.push({ x: hx, y: hy, x0: hx - span / 2, x1: hx + span / 2, sp: lerp(18, 46, t) * (rand() < 0.5 ? -1 : 1), t: rand() * 6 });
      }
      prev = placed; topY = placed.y;
    }
    // the summit: a wide ledge with the nest
    const summit = { x0: Math.round(LW / 2 - 30), x1: Math.round(LW / 2 + 30), y: topY - 44, w: 60, summit: true };
    ledges.push(summit); polys.push([[summit.x0, summit.y], [summit.x1, summit.y], [summit.x1 + 6, summit.y + 10], [summit.x1 - 6, summit.y + 34], [summit.x0 + 6, summit.y + 34], [summit.x0 - 6, summit.y + 10]]);
    topY = summit.y;
    // clouds for the sky (parallax)
    const clouds = [];
    for (let y = 40; y > topY - 200; y -= rr(28, 60)) clouds.push({ x: rr(-10, LW + 10), y, w: rr(18, 44), h: rr(7, 12), k: rand() });
    const TOTAL_FEATHERS = feathers.length;

    // ---- rasterise the level into a pixel mask and a colour canvas ---------------------------------
    const Y_TOP = topY - 140, LH = 60 - Y_TOP + 1;
    const mask = new Uint8Array(LW * LH);   // 0 sky, 1 rock, 2 grass
    const mi = (x, y) => (y - Y_TOP) * LW + x;
    function fillPoly(p) {
      let y0 = Infinity, y1 = -Infinity; for (const [, y] of p) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let y = Math.max(Y_TOP, Math.floor(y0)); y <= Math.min(60, Math.ceil(y1)); y++) {
        const sy = y + 0.5, xs = [];
        for (let i = 0; i < p.length; i++) {
          const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
          if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + (sy - ay) * (bx - ax) / (by - ay));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(LW, Math.round(xs[k + 1])); x++) mask[mi(x, y)] = 1;
      }
    }
    for (const p of polys) fillPoly(p);
    for (const L of ledges) for (let y = L.y; y < L.y + 3; y++) for (let x = L.x0; x <= L.x1; x++) { if (x >= 0 && x < LW && mask[mi(x, y)]) mask[mi(x, y)] = 2; }
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
