/*
 * Sketch Hop — an endless doodle-style vertical jumper.
 *
 * Everything on screen is drawn at runtime: packaged assets are disabled
 * (maxAssets: 0), so the paper, the ink, the creature, the monsters and every
 * sound are generated in code. Sprites are baked once into OffscreenCanvas
 * surfaces so a frame is drawImage calls rather than hundreds of path ops.
 */

window.plethoraBit = {
  meta: {
    title: "Sketch Hop",
    runtime: "plethora-bit@2",
    tags: ["arcade", "game", "jumper", "doodle", "endless", "retro"],
    permissions: ["audio", "backgroundMusic", "haptics", "storage", "motion"]
  },

  async init(ctx) {
    /* ---------------------------------------------------------------- *
     * Palette — a school notebook: cream paper, blue-grey rule, ink.
     * ---------------------------------------------------------------- */
    const INK = "#3b3428";
    const INK_SOFT = "#6d6350";
    const PAPER = "#f6f2df";
    const PAPER_DEEP = "#ece7d0";
    const RULE = "#cfd8c2";
    const RULE_BOLD = "#bcc9ab";

    const GREEN = "#8fc63f";
    const GREEN_DARK = "#6a9c2b";
    const BLUE = "#54b6e0";
    const BLUE_DARK = "#2f87ae";
    const BROWN = "#c08b4a";
    const BROWN_DARK = "#8d5f2b";
    const WHITE_P = "#fbfbf6";
    const YELLOW = "#f2c94c";
    const YELLOW_DARK = "#c69a1e";
    const RED = "#e2574c";
    const RED_DARK = "#a83a31";
    const PURPLE = "#9b6bc9";
    const PURPLE_DARK = "#6f4799";
    const TEAL = "#48c9b0";
    const ORANGE = "#ef8f3c";

    /* ---------------------------------------------------------------- *
     * Deterministic noise. Hand-drawn wobble must be stable per sprite,
     * otherwise every baked line shimmers when redrawn.
     * ---------------------------------------------------------------- */
    function makeRng(seed) {
      let s = (seed >>> 0) || 1;
      return function rng() {
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296;
      };
    }
    const rand = makeRng(0x5eed1e);
    const pick = (arr, r) => arr[Math.floor((r || rand)() * arr.length) % arr.length];
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const lerp = (a, b, t) => a + (b - a) * t;

    /* ---------------------------------------------------------------- *
     * Offscreen bakery. If a WebView has no OffscreenCanvas, makeSurface
     * returns null and every call site falls back to drawing live —
     * plainer, fully playable, never blank.
     * ---------------------------------------------------------------- */
    const HAS_OFFSCREEN = typeof OffscreenCanvas === "function";
    function makeSurface(w, h) {
      if (!HAS_OFFSCREEN) return null;
      try {
        const s = new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
        const g = s.getContext("2d");
        if (!g) return null;
        return { canvas: s, g };
      } catch (err) {
        return null;
      }
    }

    /* ---------------------------------------------------------------- *
     * Ink. Every stroke gets a slight perpendicular wander and a doubled
     * pass at low alpha, which is what reads as "drawn by hand" rather
     * than "drawn by a computer that knows what a line is".
     * ---------------------------------------------------------------- */
    function wobblePoints(pts, amp, r) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        out.push({ x: p.x + (r() - 0.5) * amp, y: p.y + (r() - 0.5) * amp });
      }
      return out;
    }

    // Catmull-Rom through the points so the wobble curves instead of kinking.
    function strokePath(g, pts, closed) {
      if (pts.length < 2) return;
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      const n = pts.length;
      const last = closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i % n];
        const p2 = pts[(i + 1) % n];
        const p3 = pts[(i + 2) % n];
        const a = closed || i > 0 ? p0 : p1;
        const d = closed || i < n - 2 ? p3 : p2;
        g.bezierCurveTo(
          p1.x + (p2.x - a.x) / 6, p1.y + (p2.y - a.y) / 6,
          p2.x - (d.x - p1.x) / 6, p2.y - (d.y - p1.y) / 6,
          p2.x, p2.y
        );
      }
      if (closed) g.closePath();
    }

    // A closed blob: an ellipse pushed around by per-vertex noise.
    function blobPoints(cx, cy, rx, ry, wob, r, steps) {
      const n = steps || 14;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const k = 1 + (r() - 0.5) * wob;
        pts.push({ x: cx + Math.cos(t) * rx * k, y: cy + Math.sin(t) * ry * k });
      }
      return pts;
    }

    function inkFill(g, pts, fill, lineW, closed, r) {
      strokePath(g, pts, closed !== false);
      if (fill) { g.fillStyle = fill; g.fill(); }
      g.strokeStyle = INK;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.lineWidth = lineW;
      g.stroke();
      // Second, lighter pass slightly offset — the pencil going round twice.
      if (r) {
        g.save();
        g.globalAlpha = 0.35;
        g.translate((r() - 0.5) * 0.9, (r() - 0.5) * 0.9);
        strokePath(g, pts, closed !== false);
        g.lineWidth = lineW * 0.7;
        g.stroke();
        g.restore();
      }
    }

    function inkLine(g, x1, y1, x2, y2, lineW, amp, r, color) {
      const segs = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 9));
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        pts.push({ x: lerp(x1, x2, t), y: lerp(y1, y2, t) });
      }
      const w = wobblePoints(pts, amp, r);
      strokePath(g, w, false);
      g.strokeStyle = color || INK;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = lineW;
      g.stroke();
    }

    /* ---------------------------------------------------------------- *
     * Surface + sizing
     * ---------------------------------------------------------------- */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    let W = ctx.width;
    let H = ctx.height;
    let U = 1;                 // unit scale: physics tuned against a 750px-tall phone
    const safe = () => ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    function recomputeScale() {
      W = ctx.width;
      H = ctx.height;
      U = clamp(H / 750, 0.62, 1.9);
    }
    recomputeScale();

    /* ================================================================ *
     * SPRITE BAKERY
     * Each maker returns { canvas, w, h, ax, ay } where ax/ay is the
     * anchor offset from the sprite's top-left to its logical origin,
     * or null when OffscreenCanvas is unavailable.
     * ================================================================ */
    const PAD = 8;
    let BAKE_SCALE = 1;

    function bake(w, h, drawFn) {
      const s = BAKE_SCALE;
      const surf = makeSurface(w * s, h * s);
      if (!surf) return null;
      surf.g.scale(s, s);
      drawFn(surf.g);
      return { canvas: surf.canvas, w, h };
    }

    /* ---- Paper tile ------------------------------------------------ */
    // One seamless graph-paper tile, repeated as a canvas pattern.
    const GRID = 26;
    function bakePaper() {
      const size = GRID * 4;
      return bake(size, size, gg => {
        gg.fillStyle = PAPER;
        gg.fillRect(0, 0, size, size);
        // Faint fibre speckle so large flat areas are not dead.
        const r = makeRng(99);
        for (let i = 0; i < 90; i++) {
          gg.fillStyle = r() > 0.5 ? "rgba(180,172,140,0.10)" : "rgba(255,255,255,0.35)";
          gg.fillRect(r() * size, r() * size, 1.2, 1.2);
        }
        gg.strokeStyle = RULE;
        gg.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
          const p = i * GRID + 0.5;
          gg.beginPath(); gg.moveTo(p, 0); gg.lineTo(p, size); gg.stroke();
          gg.beginPath(); gg.moveTo(0, p); gg.lineTo(size, p); gg.stroke();
        }
        gg.strokeStyle = RULE_BOLD;
        gg.lineWidth = 1.4;
        gg.beginPath(); gg.moveTo(0.7, 0); gg.lineTo(0.7, size); gg.stroke();
        gg.beginPath(); gg.moveTo(0, 0.7); gg.lineTo(size, 0.7); gg.stroke();
      });
    }

    /* ---- The creature ---------------------------------------------- *
     * A round-backed blob with a long upturned snout, two eyes and four
     * stubby legs. Baked facing right; facing left is a mirrored draw.
     * ------------------------------------------------------------- */
    function bakeHopper(snoutUp) {
      const w = 96, h = 84;
      return bake(w, h, gg => {
        const r = makeRng(snoutUp ? 4242 : 1337);
        gg.save();
        const cx = 42, cy = 40;
        const lw = 2.6;

        // Legs first so the body overlaps their tops.
        const legs = [[-19, 20], [-6, 24], [7, 24], [20, 20]];
        for (let i = 0; i < legs.length; i++) {
          const lx = cx + legs[i][0], ly = cy + legs[i][1];
          const bend = (i < 2 ? -1 : 1) * 3;
          inkLine(gg, lx, ly - 6, lx + bend, ly + 9, lw, 1.1, r, INK);
          // foot
          inkLine(gg, lx + bend - 4, ly + 9, lx + bend + 4, ly + 9.5, lw, 0.8, r, INK);
        }

        // Body
        const body = blobPoints(cx, cy, 27, 22, 0.075, makeRng(7), 16);
        inkFill(gg, body, GREEN, lw, true, makeRng(21));

        // Belly shading
        gg.save();
        strokePath(gg, body, true);
        gg.clip();
        gg.fillStyle = "rgba(255,255,255,0.30)";
        gg.beginPath(); gg.ellipse(cx - 8, cy - 9, 17, 12, -0.3, 0, Math.PI * 2); gg.fill();
        gg.fillStyle = "rgba(70,110,20,0.16)";
        gg.beginPath(); gg.ellipse(cx + 6, cy + 12, 20, 9, 0.1, 0, Math.PI * 2); gg.fill();
        gg.restore();

        // Snout — the signature. Up when shooting, forward otherwise.
        const sx = cx + 18, sy = cy - 3;
        const tipX = snoutUp ? cx + 11 : sx + 15;
        const tipY = snoutUp ? cy - 28 : sy - 4;
        const midX = snoutUp ? cx + 18 : sx + 8;
        const midY = snoutUp ? cy - 16 : sy - 4;
        const snout = [
          { x: sx - 3, y: sy + 9 },
          { x: midX + 4, y: midY + 8 },
          { x: tipX + 5, y: tipY + 6 },
          { x: tipX + 1, y: tipY - 4 },
          { x: midX - 5, y: midY - 7 },
          { x: sx - 5, y: sy - 9 }
        ];
        inkFill(gg, snout, GREEN, lw, true, makeRng(33));
        // nostril
        gg.fillStyle = INK;
        gg.beginPath();
        gg.ellipse(tipX + 1, tipY + 0.5, 1.8, 1.5, 0, 0, Math.PI * 2);
        gg.fill();

        // Eyes
        for (let i = 0; i < 2; i++) {
          const ex = cx + 2 + i * 15, ey = cy - 15 - i * 1.5;
          const eye = blobPoints(ex, ey, 7.5, 8, 0.06, makeRng(50 + i), 10);
          inkFill(gg, eye, WHITE_P, 2.1, true, null);
          gg.fillStyle = INK;
          gg.beginPath();
          gg.ellipse(ex + 2.4, ey + (snoutUp ? -1.5 : 0.6), 3, 3.3, 0, 0, Math.PI * 2);
          gg.fill();
          gg.fillStyle = "rgba(255,255,255,0.9)";
          gg.beginPath();
          gg.ellipse(ex + 1.4, ey - 1.4, 1.1, 1.1, 0, 0, Math.PI * 2);
          gg.fill();
        }
        gg.restore();
      });
    }

    /* ---- Platforms -------------------------------------------------- */
    const PLAT_W = 74, PLAT_H = 19;
    function bakePlatform(kind, seed) {
      const w = PLAT_W + PAD * 2, h = PLAT_H + PAD * 2;
      return bake(w, h, gg => {
        const r = makeRng(seed);
        const x = PAD, y = PAD;
        let fill = GREEN, dark = GREEN_DARK;
        if (kind === "move") { fill = BLUE; dark = BLUE_DARK; }
        if (kind === "crumble") { fill = BROWN; dark = BROWN_DARK; }
        if (kind === "vanish") { fill = WHITE_P; dark = "#b9b7a6"; }
        if (kind === "boost") { fill = YELLOW; dark = YELLOW_DARK; }

        const pts = [];
        const steps = 9;
        for (let i = 0; i <= steps; i++) pts.push({ x: x + (PLAT_W * i) / steps, y: y + 2 });
        for (let i = 0; i <= steps; i++) pts.push({ x: x + PLAT_W - (PLAT_W * i) / steps, y: y + PLAT_H - 2 });
        const wob = wobblePoints(pts, 2.2, r);
        inkFill(gg, wob, fill, 2.6, true, makeRng(seed + 5));

        // Top highlight and underside shadow give the bar some body.
        gg.save();
        strokePath(gg, wob, true);
        gg.clip();
        gg.fillStyle = "rgba(255,255,255,0.42)";
        gg.fillRect(x, y, PLAT_W, PLAT_H * 0.35);
        gg.fillStyle = "rgba(0,0,0,0.13)";
        gg.fillRect(x, y + PLAT_H * 0.68, PLAT_W, PLAT_H * 0.32);
        gg.restore();

        if (kind === "crumble") {
          // hatch marks: this one is going to give way
          for (let i = 0; i < 4; i++) {
            const hx = x + 12 + i * 16;
            inkLine(gg, hx, y + 4, hx - 3, y + PLAT_H - 4, 1.5, 1.0, r, dark);
          }
        }
        if (kind === "vanish") {
          gg.setLineDash([5, 4]);
          strokePath(gg, wob, true);
          gg.strokeStyle = INK_SOFT;
          gg.lineWidth = 1.8;
          gg.stroke();
          gg.setLineDash([]);
        }
        if (kind === "move") {
          for (let i = 0; i < 3; i++) {
            const ax = x + 22 + i * 15;
            inkLine(gg, ax, y + PLAT_H / 2, ax + 8, y + PLAT_H / 2, 1.6, 0.7, r, dark);
          }
        }
        if (kind === "boost") {
          inkLine(gg, x + PLAT_W / 2 - 9, y + PLAT_H / 2 + 3, x + PLAT_W / 2, y + 4, 2.0, 0.8, r, YELLOW_DARK);
          inkLine(gg, x + PLAT_W / 2, y + 4, x + PLAT_W / 2 + 9, y + PLAT_H / 2 + 3, 2.0, 0.8, r, YELLOW_DARK);
        }
      });
    }

    /* ---- Power-ups -------------------------------------------------- */
    function bakeSpring(compressed) {
      const w = 30, h = 34;
      return bake(w, h, gg => {
        const r = makeRng(compressed ? 811 : 810);
        const baseY = h - 4;
        const coilTop = compressed ? h - 14 : 8;
        inkLine(gg, 5, baseY, 25, baseY, 2.6, 0.7, r, INK);
        const coils = 4;
        for (let i = 0; i < coils; i++) {
          const y1 = lerp(baseY - 2, coilTop, i / coils);
          const y2 = lerp(baseY - 2, coilTop, (i + 1) / coils);
          inkLine(gg, 8, y1, 22, y2, 2.4, 0.8, r, INK);
          inkLine(gg, 22, y2, 8, y2 - (y1 - y2) * 0.15, 2.4, 0.8, r, INK);
        }
        const cap = [
          { x: 4, y: coilTop }, { x: 26, y: coilTop },
          { x: 26, y: coilTop - 6 }, { x: 4, y: coilTop - 6 }
        ];
        inkFill(gg, wobblePoints(cap, 1.2, r), RED, 2.4, true, null);
      });
    }

    function bakeTrampoline() {
      const w = 60, h = 30;
      return bake(w, h, gg => {
        const r = makeRng(902);
        inkLine(gg, 8, h - 3, 14, h - 12, 2.4, 0.8, r, INK);
        inkLine(gg, w - 8, h - 3, w - 14, h - 12, 2.4, 0.8, r, INK);
        const mat = [
          { x: 6, y: h - 12 }, { x: w / 2, y: h - 17 }, { x: w - 6, y: h - 12 },
          { x: w / 2, y: h - 7 }
        ];
        inkFill(gg, wobblePoints(mat, 1.4, r), PURPLE, 2.6, true, makeRng(903));
        gg.fillStyle = "rgba(255,255,255,0.35)";
        gg.beginPath(); gg.ellipse(w / 2 - 6, h - 13, 10, 3, 0, 0, Math.PI * 2); gg.fill();
      });
    }

    function bakePropeller() {
      const w = 54, h = 34;
      return bake(w, h, gg => {
        const r = makeRng(1010);
        // cap
        const cap = [
          { x: 14, y: h - 6 }, { x: w - 14, y: h - 6 },
          { x: w - 17, y: h - 18 }, { x: 17, y: h - 18 }
        ];
        inkFill(gg, wobblePoints(cap, 1.2, r), BLUE, 2.4, true, null);
        inkLine(gg, 10, h - 6, w - 10, h - 6, 2.4, 0.7, r, INK);
        // stalk + blades
        inkLine(gg, w / 2, h - 18, w / 2, 10, 2.2, 0.6, r, INK);
        const bladeL = [{ x: w / 2 - 2, y: 10 }, { x: 6, y: 5 }, { x: 5, y: 11 }, { x: w / 2 - 2, y: 14 }];
        const bladeR = [{ x: w / 2 + 2, y: 10 }, { x: w - 6, y: 5 }, { x: w - 5, y: 11 }, { x: w / 2 + 2, y: 14 }];
        inkFill(gg, wobblePoints(bladeL, 1.0, r), YELLOW, 2.2, true, null);
        inkFill(gg, wobblePoints(bladeR, 1.0, r), YELLOW, 2.2, true, null);
      });
    }

    function bakeJetpack() {
      const w = 40, h = 52;
      return bake(w, h, gg => {
        const r = makeRng(1111);
        for (let i = 0; i < 2; i++) {
          const bx = 10 + i * 18;
          const tank = blobPoints(bx, 24, 8, 17, 0.05, makeRng(20 + i), 12);
          inkFill(gg, tank, ORANGE, 2.4, true, null);
          gg.fillStyle = "rgba(255,255,255,0.35)";
          gg.beginPath(); gg.ellipse(bx - 2.5, 18, 2.6, 7, 0, 0, Math.PI * 2); gg.fill();
          inkLine(gg, bx - 6, 41, bx + 6, 41, 2.2, 0.6, r, INK);
        }
        inkLine(gg, 12, 14, 28, 14, 2.2, 0.7, r, INK);
      });
    }

    function bakeRocket() {
      const w = 40, h = 62;
      return bake(w, h, gg => {
        const r = makeRng(1212);
        const body = [
          { x: 20, y: 3 }, { x: 30, y: 22 }, { x: 30, y: 46 },
          { x: 10, y: 46 }, { x: 10, y: 22 }
        ];
        inkFill(gg, wobblePoints(body, 1.3, r), RED, 2.6, true, makeRng(1213));
        const finL = [{ x: 10, y: 32 }, { x: 2, y: 48 }, { x: 10, y: 46 }];
        const finR = [{ x: 30, y: 32 }, { x: 38, y: 48 }, { x: 30, y: 46 }];
        inkFill(gg, wobblePoints(finL, 1.0, r), RED_DARK, 2.2, true, null);
        inkFill(gg, wobblePoints(finR, 1.0, r), RED_DARK, 2.2, true, null);
        const port = blobPoints(20, 24, 6, 6, 0.05, makeRng(60), 10);
        inkFill(gg, port, BLUE, 2.2, true, null);
      });
    }

    function bakeShieldPickup() {
      const w = 42, h = 46;
      return bake(w, h, gg => {
        const r = makeRng(1313);
        const s = [
          { x: 21, y: 3 }, { x: 37, y: 12 }, { x: 33, y: 32 },
          { x: 21, y: 43 }, { x: 9, y: 32 }, { x: 5, y: 12 }
        ];
        inkFill(gg, wobblePoints(s, 1.2, r), TEAL, 2.6, true, makeRng(1314));
        gg.fillStyle = "rgba(255,255,255,0.45)";
        gg.beginPath(); gg.ellipse(15, 16, 5, 8, -0.4, 0, Math.PI * 2); gg.fill();
        inkLine(gg, 21, 12, 21, 30, 2.0, 0.7, r, "rgba(255,255,255,0.75)");
        inkLine(gg, 13, 21, 29, 21, 2.0, 0.7, r, "rgba(255,255,255,0.75)");
      });
    }

    /* ---- Monsters ---------------------------------------------------- *
     * Five silhouettes so the climb keeps introducing something new.
     * ------------------------------------------------------------- */
    const MONSTER_KINDS = ["blob", "spike", "cyclops", "toothy", "squid"];
    function bakeMonster(kind) {
      const w = 92, h = 80;
      return bake(w, h, gg => {
        const r = makeRng(kind.length * 977 + kind.charCodeAt(0) * 31);
        const cx = w / 2, cy = h / 2 + 4;
        const lw = 2.7;

        if (kind === "blob") {
          const b = blobPoints(cx, cy, 30, 24, 0.14, makeRng(71), 16);
          inkFill(gg, b, PURPLE, lw, true, makeRng(72));
          for (let i = 0; i < 3; i++) {
            const ex = cx - 14 + i * 14, ey = cy - 8;
            const e = blobPoints(ex, ey, 6.5, 7, 0.05, makeRng(80 + i), 10);
            inkFill(gg, e, WHITE_P, 2.0, true, null);
            gg.fillStyle = INK;
            gg.beginPath(); gg.ellipse(ex, ey + 1, 2.8, 3, 0, 0, Math.PI * 2); gg.fill();
          }
          inkLine(gg, cx - 12, cy + 12, cx + 12, cy + 12, 2.2, 1.2, r, INK);
        } else if (kind === "spike") {
          const pts = [];
          const n = 12;
          for (let i = 0; i < n; i++) {
            const t = (i / n) * Math.PI * 2;
            const rad = i % 2 === 0 ? 30 : 19;
            pts.push({ x: cx + Math.cos(t) * rad, y: cy + Math.sin(t) * rad * 0.86 });
          }
          inkFill(gg, wobblePoints(pts, 1.4, r), RED, lw, true, makeRng(74));
          const e = blobPoints(cx, cy - 3, 9, 9, 0.05, makeRng(75), 10);
          inkFill(gg, e, YELLOW, 2.2, true, null);
          gg.fillStyle = INK;
          gg.beginPath(); gg.ellipse(cx, cy - 2, 3.6, 4, 0, 0, Math.PI * 2); gg.fill();
        } else if (kind === "cyclops") {
          const b = blobPoints(cx, cy, 26, 27, 0.10, makeRng(76), 16);
          inkFill(gg, b, TEAL, lw, true, makeRng(77));
          const e = blobPoints(cx, cy - 4, 13, 13, 0.05, makeRng(78), 12);
          inkFill(gg, e, WHITE_P, 2.3, true, null);
          gg.fillStyle = INK;
          gg.beginPath(); gg.ellipse(cx + 2, cy - 3, 5.5, 6, 0, 0, Math.PI * 2); gg.fill();
          // antenna
          inkLine(gg, cx, cy - 27, cx + 5, cy - 40, 2.2, 1.0, r, INK);
          const knob = blobPoints(cx + 6, cy - 42, 4.5, 4.5, 0.06, makeRng(79), 8);
          inkFill(gg, knob, RED, 2.0, true, null);
          for (let i = 0; i < 4; i++) inkLine(gg, cx - 16 + i * 11, cy + 24, cx - 16 + i * 11, cy + 33, 2.2, 0.9, r, INK);
        } else if (kind === "toothy") {
          const b = blobPoints(cx, cy, 31, 22, 0.10, makeRng(81), 16);
          inkFill(gg, b, ORANGE, lw, true, makeRng(82));
          // grin with teeth
          gg.save();
          strokePath(gg, b, true); gg.clip();
          const mouth = [
            { x: cx - 20, y: cy + 2 }, { x: cx, y: cy + 16 }, { x: cx + 20, y: cy + 2 },
            { x: cx + 20, y: cy + 22 }, { x: cx - 20, y: cy + 22 }
          ];
          inkFill(gg, mouth, "#5b2b12", 2.2, true, null);
          gg.fillStyle = WHITE_P;
          for (let i = 0; i < 5; i++) {
            const tx = cx - 17 + i * 8.5;
            gg.beginPath();
            gg.moveTo(tx, cy + 4 + Math.abs(i - 2) * -1.4 + 3);
            gg.lineTo(tx + 4.4, cy + 4 + Math.abs(i - 2) * -1.4 + 3);
            gg.lineTo(tx + 2.2, cy + 12);
            gg.closePath(); gg.fill();
          }
          gg.restore();
          for (let i = 0; i < 2; i++) {
            const ex = cx - 12 + i * 24, ey = cy - 12;
            const e = blobPoints(ex, ey, 7, 7.5, 0.05, makeRng(90 + i), 10);
            inkFill(gg, e, WHITE_P, 2.0, true, null);
            gg.fillStyle = INK;
            gg.beginPath(); gg.ellipse(ex, ey + 1, 3, 3.2, 0, 0, Math.PI * 2); gg.fill();
          }
        } else {
          // squid — a hovering bell with dangling arms
          const bell = [
            { x: cx - 27, y: cy + 2 }, { x: cx - 20, y: cy - 20 }, { x: cx, y: cy - 27 },
            { x: cx + 20, y: cy - 20 }, { x: cx + 27, y: cy + 2 }, { x: cx, y: cy + 8 }
          ];
          inkFill(gg, wobblePoints(bell, 1.4, r), BLUE, lw, true, makeRng(84));
          for (let i = 0; i < 4; i++) {
            const ax = cx - 16 + i * 11;
            const pts = [
              { x: ax, y: cy + 5 },
              { x: ax + (i % 2 ? 5 : -5), y: cy + 16 },
              { x: ax + (i % 2 ? -3 : 3), y: cy + 28 }
            ];
            strokePath(gg, wobblePoints(pts, 1.0, r), false);
            gg.strokeStyle = INK; gg.lineWidth = 2.3; gg.lineCap = "round"; gg.stroke();
          }
          for (let i = 0; i < 2; i++) {
            const ex = cx - 9 + i * 18, ey = cy - 10;
            const e = blobPoints(ex, ey, 6.5, 7, 0.05, makeRng(95 + i), 10);
            inkFill(gg, e, WHITE_P, 2.0, true, null);
            gg.fillStyle = INK;
            gg.beginPath(); gg.ellipse(ex, ey + 1, 2.8, 3, 0, 0, Math.PI * 2); gg.fill();
          }
        }
      });
    }

    function bakeUfo() {
      const w = 130, h = 74;
      return bake(w, h, gg => {
        const r = makeRng(1414);
        const cx = w / 2, cy = 40;
        const dome = [
          { x: cx - 20, y: cy - 6 }, { x: cx - 13, y: cy - 22 }, { x: cx, y: cy - 27 },
          { x: cx + 13, y: cy - 22 }, { x: cx + 20, y: cy - 6 }
        ];
        inkFill(gg, wobblePoints(dome, 1.2, r), "rgba(120,200,235,0.85)", 2.5, true, null);
        const hull = [
          { x: cx - 52, y: cy - 2 }, { x: cx - 26, y: cy - 12 }, { x: cx + 26, y: cy - 12 },
          { x: cx + 52, y: cy - 2 }, { x: cx + 28, y: cy + 12 }, { x: cx - 28, y: cy + 12 }
        ];
        inkFill(gg, wobblePoints(hull, 1.6, r), "#b9b2d6", 2.7, true, makeRng(1415));
        for (let i = 0; i < 5; i++) {
          const lx = cx - 34 + i * 17;
          const lamp = blobPoints(lx, cy + 8, 4.5, 4, 0.05, makeRng(120 + i), 8);
          inkFill(gg, lamp, i % 2 ? YELLOW : RED, 1.9, true, null);
        }
      });
    }

    function bakeBlackHole() {
      const w = 108, h = 108;
      return bake(w, h, gg => {
        const cx = w / 2, cy = h / 2;
        const grad = gg.createRadialGradient(cx, cy, 2, cx, cy, 50);
        grad.addColorStop(0, "#14121a");
        grad.addColorStop(0.55, "#2f2a3f");
        grad.addColorStop(1, "rgba(90,80,120,0)");
        gg.fillStyle = grad;
        gg.beginPath(); gg.arc(cx, cy, 50, 0, Math.PI * 2); gg.fill();
        // sketchy inward spiral
        const r = makeRng(1515);
        for (let arm = 0; arm < 3; arm++) {
          const pts = [];
          for (let i = 0; i <= 26; i++) {
            const t = i / 26;
            const ang = arm * 2.1 + t * 5.4;
            const rad = lerp(46, 7, t);
            pts.push({ x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad });
          }
          strokePath(gg, wobblePoints(pts, 1.1, r), false);
          gg.strokeStyle = "rgba(232,228,245,0.42)";
          gg.lineWidth = 1.7; gg.lineCap = "round"; gg.stroke();
        }
      });
    }

    /* ================================================================ *
     * AUDIO
     * All effects are synthesized. The bed comes from ctx.music; the
     * bounces are bespoke because the boing is the whole personality of
     * a jumper and no generic sting sounds like one.
     * ================================================================ */
    let AC = null;
    let master = null;
    let muted = false;
    let noiseBuf = null;

    function audioReady() {
      if (!ctx.capabilities || !ctx.capabilities.audio) return null;
      if (AC) return AC;
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = 0.62;
        master.connect(AC.destination);
        // One second of white noise, reused by every noise-based voice.
        const len = Math.floor(AC.sampleRate);
        noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        ctx.onDestroy(() => { try { AC && AC.close(); } catch (e) { /* already gone */ } });
      } catch (err) {
        AC = null;
      }
      return AC;
    }

    function resumeAudio() {
      const ac = audioReady();
      if (ac && ac.state === "suspended") ac.resume().catch(() => {});
    }

    function env(node, t0, peak, attack, decay) {
      const gain = AC.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      node.connect(gain);
      gain.connect(master);
      return gain;
    }

    function tone(type, f0, f1, dur, peak, delay) {
      if (!AC || muted) return;
      const t0 = AC.currentTime + (delay || 0);
      const o = AC.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      env(o, t0, peak, Math.min(0.012, dur * 0.25), dur);
      o.start(t0);
      o.stop(t0 + dur + 0.06);
    }

    function noise(dur, peak, filterType, f0, f1, q, delay) {
      if (!AC || muted || !noiseBuf) return;
      const t0 = AC.currentTime + (delay || 0);
      const src = AC.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = AC.createBiquadFilter();
      f.type = filterType || "bandpass";
      f.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
      f.Q.value = q || 1;
      src.connect(f);
      env(f, t0, peak, 0.004, dur);
      src.start(t0);
      src.stop(t0 + dur + 0.06);
    }

    const sfx = {
      // The jump. Short, springy, pitched up as the climb gets faster.
      boing(power) {
        if (!AC || muted) return;
        const p = clamp(power || 1, 0.6, 2.4);
        const t0 = AC.currentTime;
        const o = AC.createOscillator();
        o.type = "triangle";
        const base = 300 * p;
        o.frequency.setValueAtTime(base, t0);
        o.frequency.exponentialRampToValueAtTime(base * 2.5, t0 + 0.055);
        o.frequency.exponentialRampToValueAtTime(base * 1.35, t0 + 0.16);
        // A touch of vibrato is what stops it sounding like a menu beep.
        const lfo = AC.createOscillator();
        const lfoGain = AC.createGain();
        lfo.frequency.value = 26;
        lfoGain.gain.value = base * 0.16;
        lfo.connect(lfoGain);
        lfoGain.connect(o.frequency);
        env(o, t0, 0.30, 0.008, 0.18);
        o.start(t0); lfo.start(t0);
        o.stop(t0 + 0.26); lfo.stop(t0 + 0.26);
        noise(0.035, 0.07, "highpass", 1800, 900, 1, 0);
      },
      spring() {
        if (!AC || muted) return;
        const t0 = AC.currentTime;
        const o = AC.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(220, t0);
        o.frequency.exponentialRampToValueAtTime(1250, t0 + 0.28);
        const lfo = AC.createOscillator();
        const lg = AC.createGain();
        lfo.frequency.value = 17; lg.gain.value = 90;
        lfo.connect(lg); lg.connect(o.frequency);
        env(o, t0, 0.34, 0.01, 0.34);
        o.start(t0); lfo.start(t0);
        o.stop(t0 + 0.42); lfo.stop(t0 + 0.42);
      },
      trampoline() {
        tone("sine", 180, 900, 0.34, 0.32, 0);
        tone("triangle", 360, 1400, 0.3, 0.14, 0.02);
      },
      crack() {
        noise(0.16, 0.30, "bandpass", 2600, 500, 1.4, 0);
        noise(0.07, 0.18, "highpass", 3800, 2200, 1, 0.03);
        tone("square", 150, 70, 0.11, 0.07, 0);
      },
      vanish() {
        noise(0.2, 0.14, "highpass", 900, 4200, 0.8, 0);
      },
      shoot() {
        tone("square", 1000, 260, 0.07, 0.13, 0);
        noise(0.05, 0.09, "highpass", 2400, 1200, 1, 0);
      },
      squish() {
        noise(0.19, 0.30, "lowpass", 1500, 190, 3, 0);
        tone("triangle", 260, 90, 0.2, 0.16, 0);
      },
      powerup() {
        const seq = [523, 659, 784, 1047];
        for (let i = 0; i < seq.length; i++) tone("square", seq[i], seq[i], 0.09, 0.14, i * 0.055);
      },
      shield() {
        tone("sine", 480, 960, 0.4, 0.2, 0);
        tone("sine", 720, 1440, 0.4, 0.1, 0.04);
      },
      hurt() {
        tone("sawtooth", 420, 90, 0.36, 0.24, 0);
        noise(0.2, 0.16, "lowpass", 1200, 200, 2, 0);
      },
      fall() {
        tone("sawtooth", 620, 70, 0.85, 0.24, 0);
        tone("sine", 310, 40, 0.9, 0.14, 0.03);
      },
      blip() { tone("square", 700, 700, 0.045, 0.09, 0); },
      thud() { noise(0.1, 0.14, "lowpass", 700, 180, 2, 0); },
      ufo() {
        if (!AC || muted) return;
        tone("sine", 900, 1500, 0.5, 0.10, 0);
        tone("sine", 1350, 700, 0.5, 0.07, 0.06);
      }
    };

    // Sustained thrust for propeller / jetpack / rocket. One voice, retuned.
    let thrust = null;
    function startThrust(kind) {
      if (!AC || muted || thrust) return;
      try {
        const src = AC.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const f = AC.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = kind === "propeller" ? 620 : 340;
        f.Q.value = kind === "propeller" ? 3.5 : 1.1;
        const gain = AC.createGain();
        gain.gain.setValueAtTime(0.0001, AC.currentTime);
        gain.gain.exponentialRampToValueAtTime(kind === "propeller" ? 0.10 : 0.17, AC.currentTime + 0.09);
        src.connect(f); f.connect(gain); gain.connect(master);
        src.start();
        // The propeller gets a chop; rockets get a steady roar.
        let lfo = null;
        if (kind === "propeller") {
          lfo = AC.createOscillator();
          const lg = AC.createGain();
          lfo.frequency.value = 22;
          lg.gain.value = 260;
          lfo.connect(lg); lg.connect(f.frequency);
          lfo.start();
        }
        thrust = { src, gain, lfo };
      } catch (err) {
        thrust = null;
      }
    }
    function stopThrust() {
      if (!thrust || !AC) return;
      const t = thrust; thrust = null;
      try {
        t.gain.gain.cancelScheduledValues(AC.currentTime);
        t.gain.gain.setValueAtTime(Math.max(0.0002, t.gain.gain.value), AC.currentTime);
        t.gain.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + 0.16);
        t.src.stop(AC.currentTime + 0.2);
        if (t.lfo) t.lfo.stop(AC.currentTime + 0.2);
      } catch (err) { /* node already stopped */ }
    }

    /* ---- Background bed --------------------------------------------- */
    let musicOn = true;
    let musicHandle = null;
    async function startMusic() {
      if (!ctx.capabilities || !ctx.capabilities.backgroundMusic || !musicOn) return;
      try {
        await ctx.music.unlock();
        musicHandle = await ctx.music.play({
          preset: "chiptune",
          scale: "pentatonic",
          tempo: 116,
          volume: 0.34,
          intensity: 0.5,
          fadeInMs: 900
        });
      } catch (err) {
        musicHandle = null;
      }
    }
    function musicIntensity(v) {
      try { ctx.music.setIntensity(clamp(v, 0, 1)); } catch (err) { /* bed not running */ }
    }
    function duck(a, ms) {
      try { ctx.music.duck(a, ms); } catch (err) { /* bed not running */ }
    }

    /* ================================================================ *
     * GAME MODEL
     * World y grows downward; the camera only ever travels up. Every
     * tunable is multiplied by U so the feel survives a tablet.
     * ================================================================ */
    const G_ACC = 2600;
    const JUMP_V = -1000;
    const SPRING_V = -1680;
    const TRAMP_V = -1950;
    const MONSTER_BOUNCE_V = -1150;
    const MAX_VX = 560;
    const STEER_ACC = 2100;
    const TILT_ACC = 2600;
    const DRAG = 0.86;

    const POWER = {
      propeller: { dur: 2.6, vy: -640, label: "PROPELLER" },
      jetpack: { dur: 3.2, vy: -930, label: "JETPACK" },
      rocket: { dur: 2.2, vy: -1360, label: "ROCKET" }
    };
    const SHIELD_DUR = 8;

    let state = "title";        // title | play | dead
    let hopper = null;
    let platforms = [];
    let monsters = [];
    let bullets = [];
    let particles = [];
    let hazards = [];           // black holes and UFOs
    let camY = 0;               // world y at the top of the screen
    let spawnY = 0;             // highest world y generated so far
    let startY = 0;
    let climb = 0;              // pixels climbed above the start
    let score = 0;
    let best = 0;
    let bopped = 0;
    let runSeed = 1;
    let gen = null;             // per-run rng
    let deathReason = "";
    let deathAt = 0;
    let submitState = "idle";   // idle | sending | ok | error
    let shakeT = 0, shakeAmp = 0;

    const HOP_W = 52, HOP_H = 46;

    function difficulty() {
      // 0 at the start, approaching 1 somewhere near 30 screens up.
      return clamp(climb / (750 * 30), 0, 1);
    }

    function newHopper() {
      return {
        x: W / 2,
        y: startY - 120 * U,
        vx: 0,
        vy: JUMP_V * U * 0.7,
        facing: 1,
        squash: 0,
        power: null,
        powerT: 0,
        shieldT: 0,
        shootT: 0,
        cooldown: 0,
        spin: 0
      };
    }

    function platformAt(x, y, kind, r) {
      const w = PLAT_W * U * (kind === "vanish" ? 0.94 : 1);
      const p = {
        x, y,
        w,
        h: PLAT_H * U,
        kind,
        vx: 0,
        alpha: 1,
        used: false,
        falling: false,
        vy: 0,
        seed: Math.floor(r() * 5),
        item: null,
        itemT: 0
      };
      if (kind === "move") {
        p.vx = (60 + r() * 90) * U * (r() > 0.5 ? 1 : -1);
      }
      if (kind === "boost") {
        // A vertically bobbing platform: rarer, appears higher up.
        p.baseY = y;
        p.bob = 30 * U + r() * 40 * U;
        p.bobT = r() * Math.PI * 2;
      }
      return p;
    }

    function chooseKind(d, r) {
      const roll = r();
      if (d < 0.05) return roll < 0.9 ? "static" : "move";
      const move = 0.16 + d * 0.16;
      const crumble = 0.10 + d * 0.14;
      const vanish = d < 0.18 ? 0 : 0.05 + d * 0.12;
      const boost = d < 0.3 ? 0 : 0.04 + d * 0.05;
      let acc = move;
      if (roll < acc) return "move";
      acc += crumble; if (roll < acc) return "crumble";
      acc += vanish; if (roll < acc) return "vanish";
      acc += boost; if (roll < acc) return "boost";
      return "static";
    }

    function chooseItem(kind, d, r) {
      // Crumble and vanish platforms never carry a power-up: a boost you
      // cannot reliably reach is just a tease.
      if (kind === "crumble" || kind === "vanish") return null;
      const roll = r();
      if (roll < 0.055) return "spring";
      if (roll < 0.080) return "trampoline";
      if (roll < 0.100 + d * 0.01) return "propeller";
      if (roll < 0.114 + d * 0.008) return "jetpack";
      if (roll < 0.121 + d * 0.005) return "rocket";
      if (roll < 0.138 + d * 0.02) return "shield";
      return null;
    }

    // True when a box would sit on top of an existing platform. Used to keep
    // twins from fusing into one long bar and to keep monsters off platforms.
    function overlapsPlatform(x, y, halfW, halfH) {
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (Math.abs(p.y - y) > halfH + p.h * 0.5 + 6 * U) continue;
        if (Math.abs(p.x - x) < halfW + p.w * 0.5 + 8 * U) return true;
      }
      return false;
    }

    function hazardHalf(z) {
      return z.type === "hole"
        ? { w: 46 * U, h: 46 * U }
        : { w: 62 * U, h: 30 * U };
    }

    function generateUpTo(targetY) {
      const r = gen;
      let guard = 0;
      while (spawnY > targetY && guard++ < 400) {
        const d = clamp((startY - spawnY) / (750 * 30), 0, 1);
        const minGap = lerp(58, 74, d) * U;
        const maxGap = lerp(96, 158, d) * U;
        const gap = lerp(minGap, maxGap, Math.pow(r(), 0.8));
        spawnY -= gap;

        const kind = chooseKind(d, r);
        const w = PLAT_W * U;
        const x = lerp(w * 0.55, W - w * 0.55, r());
        const p = platformAt(x, spawnY, kind, r);
        p.item = chooseItem(kind, d, r);
        platforms.push(p);

        // Occasional twin platform on the same row, for route choice. It only
        // lands if it clears the first one — two touching platforms read as a
        // single long bar, which is not the choice we meant to offer.
        if (r() < 0.10 + d * 0.08 && W > 340 * U) {
          const x2 = x < W / 2 ? lerp(W * 0.62, W - w * 0.55, r()) : lerp(w * 0.55, W * 0.38, r());
          const y2 = spawnY - lerp(0, 16, r()) * U;
          if (Math.abs(x2 - x) > w + 26 * U) {
            const k2 = chooseKind(d, r);
            const p2 = platformAt(x2, y2, k2, r);
            p2.item = chooseItem(k2, d, r);
            platforms.push(p2);
          }
        }

        // Monsters
        const mChance = d < 0.03 ? 0 : 0.055 + d * 0.10;
        if (r() < mChance) {
          const kindIdx = Math.min(MONSTER_KINDS.length - 1, Math.floor(r() * (1 + d * 5)));
          const mk = MONSTER_KINDS[kindIdx];
          const drift = mk === "squid" || mk === "spike";
          const mx = lerp(60 * U, W - 60 * U, r());
          const my = spawnY - lerp(30, 56, r()) * U;
          if (!overlapsPlatform(mx, my, 31 * U, 26 * U)) {
            monsters.push({
              kind: mk,
              x: mx,
              y: my,
              w: 62 * U, h: 52 * U,
              vx: drift ? (40 + r() * 70) * U * (r() > 0.5 ? 1 : -1) : 0,
              bobT: r() * Math.PI * 2,
              alive: true,
              hp: mk === "toothy" ? 2 : 1,
              hitT: 0
            });
          }
        }

        // Hazards: a UFO that tows a beam, or a black hole that pulls.
        const hChance = d < 0.12 ? 0 : 0.016 + d * 0.030;
        if (r() < hChance) {
          const isHole = r() < 0.45;
          const hx = lerp(isHole ? 70 * U : 80 * U, W - (isHole ? 70 * U : 80 * U), r());
          const hy = spawnY - (isHole ? 64 : 84) * U;
          if (!overlapsPlatform(hx, hy, (isHole ? 46 : 62) * U, (isHole ? 46 : 30) * U)) {
            hazards.push(isHole
              ? { type: "hole", x: hx, y: hy, r: 42 * U, t: r() * 6 }
              : { type: "ufo", x: hx, y: hy, vx: (50 + r() * 60) * U * (r() > 0.5 ? 1 : -1), t: r() * 6, beam: 0 }
            );
          }
        }
      }

      // Monsters and hazards are placed before the row above them exists, so
      // a later platform can land on top of one. Drop anything left buried.
      for (let i = hazards.length - 1; i >= 0; i--) {
        const z = hazards[i];
        const half = hazardHalf(z);
        if (overlapsPlatform(z.x, z.y, half.w, half.h)) hazards.splice(i, 1);
      }
      for (let i = monsters.length - 1; i >= 0; i--) {
        const m = monsters[i];
        if (overlapsPlatform(m.x, m.y, m.w * 0.5, m.h * 0.5)) monsters.splice(i, 1);
      }
    }

    function resetRun() {
      recomputeScale();
      runSeed = (runSeed * 1103515245 + 12345) >>> 0;
      gen = makeRng(runSeed || 7);
      platforms = [];
      monsters = [];
      bullets = [];
      particles = [];
      hazards = [];
      startY = 0;
      camY = startY - H;
      spawnY = startY;
      climb = 0;
      score = 0;
      bopped = 0;
      deathReason = "";
      submitState = "idle";
      shakeT = 0;

      // A guaranteed ladder of easy ground so nobody dies to the first gap.
      const base = platformAt(W / 2, startY - 24 * U, "static", gen);
      base.w = W * 0.52;
      platforms.push(base);
      let y = startY - 24 * U;
      for (let i = 0; i < 6; i++) {
        y -= (78 + gen() * 26) * U;
        const p = platformAt(lerp(PLAT_W * U * 0.6, W - PLAT_W * U * 0.6, gen()), y, "static", gen);
        platforms.push(p);
      }
      spawnY = y;
      generateUpTo(camY - H);
      hopper = newHopper();
      stopThrust();
    }

    /* ================================================================ *
     * INPUT
     * Two schemes. Touch-steer works everywhere and is the default;
     * tilt is the authentic one and is opt-in behind a button, because
     * motion is a permission-gated capability and must never be the
     * only way to play.
     * ================================================================ */
    let steerMode = "touch";    // touch | tilt
    let tiltReady = false;
    let tiltValue = 0;
    let pointerDown = false;
    let pointerX = 0, pointerY = 0;
    let pressStart = 0, pressMovedBy = 0, pressOx = 0, pressOy = 0;

    async function enableTilt() {
      if (tiltReady) return true;
      try {
        if (ctx.capabilities && ctx.capabilities.motion && ctx.sensors && ctx.sensors.start) {
          const ok = await ctx.sensors.start();
          if (ok) { tiltReady = true; return true; }
        }
        if (ctx.motion && ctx.motion.start) {
          const ok2 = await ctx.motion.start();
          if (ok2 !== false) { tiltReady = !!(ctx.motion.active !== false); return tiltReady; }
        }
      } catch (err) { /* denied — caller falls back to touch */ }
      return false;
    }

    function readTilt() {
      if (!tiltReady) return 0;
      let t = 0;
      try {
        const s = ctx.sensors && ctx.sensors.tilt;
        if (s && typeof s.x === "number") t = s.x;
        else if (ctx.motion && ctx.motion.tilt && typeof ctx.motion.tilt.x === "number") t = ctx.motion.tilt.x;
      } catch (err) { t = 0; }
      if (!isFinite(t)) t = 0;
      // Normalize: sensors report roughly -1..1 or degrees depending on host.
      if (Math.abs(t) > 3) t = t / 45;
      return clamp(t, -1, 1);
    }

    function fireBullet(tx, ty) {
      if (state !== "play" || !hopper || hopper.cooldown > 0) return;
      const nx = hopper.x + 16 * U * hopper.facing;
      const ny = hopper.y - 14 * U;
      let dx = tx - nx;
      let dy = ty - ny;
      // Shots always carry upward: a downward tap still fires up-ish.
      if (dy > -40 * U) dy = -40 * U;
      const len = Math.hypot(dx, dy) || 1;
      const speed = 980 * U;
      bullets.push({
        x: nx, y: ny,
        vx: (dx / len) * speed,
        vy: (dy / len) * speed,
        life: 1.6,
        r: 6 * U
      });
      hopper.shootT = 0.3;
      hopper.cooldown = 0.2;
      sfx.shoot();
      ctx.platform.interact({ type: "shoot" });
    }

    /* ================================================================ *
     * UPDATE
     * ================================================================ */
    function addParticles(x, y, n, color, spread, life, size) {
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const s = rand() * spread;
        particles.push({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - spread * 0.3,
          life: life * (0.6 + rand() * 0.6),
          maxLife: life,
          color,
          size: size * (0.6 + rand() * 0.8),
          rot: rand() * Math.PI,
          vr: (rand() - 0.5) * 8
        });
      }
    }

    function shake(amp) { shakeAmp = Math.max(shakeAmp, amp); shakeT = 0.32; }

    function die(reason) {
      if (state !== "play") return;
      state = "dead";
      deathReason = reason;
      deathAt = performance.now();
      stopThrust();
      if (reason === "fall") sfx.fall(); else sfx.hurt();
      ctx.platform.haptic("error");
      duck(0.6, 900);
      shake(reason === "fall" ? 0 : 12 * U);
      addParticles(hopper.x, hopper.y, 22, GREEN, 380 * U, 0.9, 6 * U);
      ctx.platform.setScore(score);
      ctx.platform.fail({ score, reason, monsters: bopped });
      saveBest();
      submitScore();
    }

    function giveBounce(v, kind) {
      hopper.vy = v * U;
      hopper.squash = -1;
      if (kind === "spring") { sfx.spring(); ctx.platform.haptic("medium"); }
      else if (kind === "trampoline") { sfx.trampoline(); ctx.platform.haptic("medium"); hopper.spin = Math.PI * 4; }
      else { sfx.boing(1 + clamp(climb / 20000, 0, 1)); ctx.platform.haptic("light"); }
    }

    function grantPower(type) {
      if (type === "shield") {
        hopper.shieldT = SHIELD_DUR;
        sfx.shield();
      } else {
        hopper.power = type;
        hopper.powerT = POWER[type].dur;
        hopper.vy = POWER[type].vy * U;
        stopThrust();
        startThrust(type);
        sfx.powerup();
      }
      ctx.platform.haptic("success");
      ctx.platform.milestone("powerup", { type });
      duck(0.35, 500);
      addParticles(hopper.x, hopper.y, 16, YELLOW, 260 * U, 0.7, 5 * U);
    }

    function collectItem(p) {
      const it = p.item;
      p.item = null;
      if (it === "spring") giveBounce(SPRING_V, "spring");
      else if (it === "trampoline") giveBounce(TRAMP_V, "trampoline");
      else grantPower(it);
    }

    function landOn(p) {
      if (p.kind === "crumble") {
        // Brown platforms give way — no bounce, they just go.
        if (!p.falling) {
          p.falling = true;
          p.vy = 60 * U;
          sfx.crack();
          ctx.platform.haptic("light");
          addParticles(p.x, p.y, 10, BROWN, 160 * U, 0.7, 4 * U);
        }
        return;
      }
      if (p.item) { collectItem(p); return; }
      giveBounce(JUMP_V, "plain");
      if (p.kind === "vanish" && !p.used) {
        p.used = true;
        sfx.vanish();
        addParticles(p.x, p.y, 8, "#cfcabb", 120 * U, 0.5, 3 * U);
      }
      addParticles(p.x, p.y - p.h * 0.5, 4, "rgba(120,110,90,0.5)", 90 * U, 0.35, 2.5 * U);
    }

    function stepHopper(dt) {
      const h = hopper;
      const prevFeet = h.y + HOP_H * 0.5 * U;

      // Horizontal steering
      let acc = 0;
      if (steerMode === "tilt" && tiltReady) {
        tiltValue = lerp(tiltValue, readTilt(), 0.35);
        acc = tiltValue * TILT_ACC * U;
      } else if (pointerDown) {
        const dx = pointerX - h.x;
        const dead = 6 * U;
        if (Math.abs(dx) > dead) acc = clamp(dx / (90 * U), -1, 1) * STEER_ACC * U;
      }
      h.vx += acc * dt;
      if (acc === 0) h.vx *= Math.pow(DRAG, dt * 60);
      h.vx = clamp(h.vx, -MAX_VX * U, MAX_VX * U);
      h.x += h.vx * dt;

      // Wrap around the sheet edges
      const halfW = HOP_W * 0.5 * U;
      if (h.x < -halfW) h.x = W + halfW;
      else if (h.x > W + halfW) h.x = -halfW;
      if (Math.abs(h.vx) > 12 * U) h.facing = h.vx > 0 ? 1 : -1;

      // Vertical
      if (h.power) {
        h.powerT -= dt;
        h.vy = POWER[h.power].vy * U;
        const px = h.x + (rand() - 0.5) * 14 * U;
        addParticles(px, h.y + 20 * U, 1, h.power === "propeller" ? "rgba(200,220,255,0.8)" : ORANGE, 90 * U, 0.4, 4 * U);
        if (h.powerT <= 0) { h.power = null; stopThrust(); }
      } else {
        h.vy += G_ACC * U * dt;
      }
      h.y += h.vy * dt;

      if (h.shieldT > 0) h.shieldT -= dt;
      if (h.shootT > 0) h.shootT -= dt;
      if (h.cooldown > 0) h.cooldown -= dt;
      if (h.spin) {
        h.spin -= Math.PI * 8 * dt;
        if (h.spin < 0) h.spin = 0;
      }
      h.squash = lerp(h.squash, 0, 1 - Math.pow(0.001, dt));

      // Platform landing — only while falling, and only on a downward cross.
      if (h.vy > 0 && !h.power) {
        const feet = h.y + HOP_H * 0.5 * U;
        for (let i = 0; i < platforms.length; i++) {
          const p = platforms[i];
          if (p.falling || p.alpha < 0.999) continue;
          const top = p.y - p.h * 0.5;
          if (prevFeet <= top + 1 && feet >= top) {
            if (Math.abs(h.x - p.x) < p.w * 0.5 + halfW * 0.55) {
              h.y = top - HOP_H * 0.5 * U;
              landOn(p);
              break;
            }
          }
        }
      }
    }

    function updatePlay(dt) {
      const substeps = clamp(Math.ceil((Math.abs(hopper.vy) * dt) / (7 * U)), 1, 8);
      const sdt = dt / substeps;
      for (let s = 0; s < substeps; s++) stepHopper(sdt);

      // Camera follows only upward, easing so power-ups do not whip it.
      const target = hopper.y - H * 0.46;
      if (target < camY) camY = lerp(camY, target, 1 - Math.pow(0.0001, dt));
      if (hopper.y - H * 0.46 < camY) camY = hopper.y - H * 0.46;

      climb = Math.max(climb, startY - hopper.y);
      const newScore = Math.floor(climb / (4 * U));
      if (newScore > score) {
        score = newScore;
        ctx.platform.setScore(score);
      }
      generateUpTo(camY - H * 1.2);
      musicIntensity(0.35 + difficulty() * 0.55);

      // Platforms
      for (let i = platforms.length - 1; i >= 0; i--) {
        const p = platforms[i];
        if (p.kind === "move") {
          p.x += p.vx * dt;
          const half = p.w * 0.5;
          if (p.x < half) { p.x = half; p.vx = Math.abs(p.vx); }
          else if (p.x > W - half) { p.x = W - half; p.vx = -Math.abs(p.vx); }
        }
        if (p.kind === "boost") {
          p.bobT += dt * 1.6;
          p.y = p.baseY + Math.sin(p.bobT) * p.bob;
        }
        if (p.falling) { p.vy += G_ACC * U * dt * 0.6; p.y += p.vy * dt; }
        if (p.used) { p.alpha -= dt * 3.4; }
        if (p.y - camY > H + 140 * U || p.alpha <= 0) platforms.splice(i, 1);
      }

      // Monsters
      for (let i = monsters.length - 1; i >= 0; i--) {
        const m = monsters[i];
        m.bobT += dt * 2.2;
        if (m.vx) {
          m.x += m.vx * dt;
          const half = m.w * 0.5;
          if (m.x < half) { m.x = half; m.vx = Math.abs(m.vx); }
          else if (m.x > W - half) { m.x = W - half; m.vx = -Math.abs(m.vx); }
        }
        if (m.hitT > 0) m.hitT -= dt;
        if (m.y - camY > H + 160 * U) { monsters.splice(i, 1); continue; }
        if (!m.alive) continue;

        const dx = Math.abs(hopper.x - m.x);
        const dy = hopper.y - m.y;
        const my = m.y + Math.sin(m.bobT) * 5 * U;
        if (dx < (m.w * 0.5 + HOP_W * 0.35 * U) && Math.abs(hopper.y - my) < (m.h * 0.5 + HOP_H * 0.35 * U)) {
          const stomping = hopper.vy > 0 && dy < -m.h * 0.12;
          if (stomping || hopper.power) {
            m.alive = false;
            bopped++;
            sfx.squish();
            ctx.platform.haptic("medium");
            addParticles(m.x, m.y, 14, PURPLE, 220 * U, 0.7, 5 * U);
            monsters.splice(i, 1);
            if (!hopper.power) giveBounce(MONSTER_BOUNCE_V, "plain");
            ctx.platform.milestone("monster_bopped", { total: bopped });
          } else if (hopper.shieldT > 0) {
            m.alive = false;
            bopped++;
            sfx.squish();
            addParticles(m.x, m.y, 14, TEAL, 220 * U, 0.7, 5 * U);
            monsters.splice(i, 1);
          } else {
            die("monster");
            return;
          }
        }
      }

      // Hazards
      for (let i = hazards.length - 1; i >= 0; i--) {
        const z = hazards[i];
        z.t += dt;
        if (z.type === "ufo") {
          z.x += z.vx * dt;
          const half = 62 * U;
          if (z.x < half) { z.x = half; z.vx = Math.abs(z.vx); }
          else if (z.x > W - half) { z.x = W - half; z.vx = -Math.abs(z.vx); }
          const under = Math.abs(hopper.x - z.x) < 44 * U && hopper.y > z.y && hopper.y - z.y < 260 * U;
          z.beam = lerp(z.beam, under ? 1 : 0, 1 - Math.pow(0.002, dt));
          if (under && z.beam > 0.55 && hopper.shieldT <= 0 && !hopper.power) { die("ufo"); return; }
          if (under && z.beam > 0.2 && Math.abs(z.t % 2 - 1) < 0.02) sfx.ufo();
        } else {
          const dx = hopper.x - z.x, dy = hopper.y - z.y;
          const dist = Math.hypot(dx, dy);
          if (dist < z.r * 3.2 && !hopper.power) {
            // Pull grows sharply near the rim.
            const pull = (1 - dist / (z.r * 3.2));
            hopper.vx -= (dx / (dist || 1)) * pull * 900 * U * dt;
            hopper.vy -= (dy / (dist || 1)) * pull * 900 * U * dt;
          }
          if (dist < z.r * 0.62) { die("hole"); return; }
        }
        if (z.y - camY > H + 200 * U) hazards.splice(i, 1);
      }

      // Bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        let hit = false;
        for (let j = monsters.length - 1; j >= 0; j--) {
          const m = monsters[j];
          if (!m.alive) continue;
          if (Math.abs(b.x - m.x) < m.w * 0.45 && Math.abs(b.y - m.y) < m.h * 0.45) {
            m.hp -= 1;
            m.hitT = 0.18;
            hit = true;
            addParticles(b.x, b.y, 6, INK, 150 * U, 0.4, 3 * U);
            if (m.hp <= 0) {
              m.alive = false;
              bopped++;
              sfx.squish();
              addParticles(m.x, m.y, 14, RED, 220 * U, 0.7, 5 * U);
              monsters.splice(j, 1);
              ctx.platform.milestone("monster_shot", { total: bopped });
            } else {
              sfx.thud();
            }
            break;
          }
        }
        if (hit || b.life <= 0 || b.y - camY < -60 * U) bullets.splice(i, 1);
      }

      if (hopper.y - camY > H + 70 * U) die("fall");
    }

    function updateParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += G_ACC * U * 0.35 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      if (shakeT > 0) {
        shakeT -= dt;
        if (shakeT <= 0) shakeAmp = 0;
      }
    }

    /* ================================================================ *
     * SPRITE CACHE
     * ================================================================ */
    const SP = {};
    let paperPattern = null;
    let spriteScale = 0;

    function buildSprites() {
      BAKE_SCALE = clamp(U * Math.min(ctx.dpr || 1, 2), 0.6, 3);
      spriteScale = U;
      SP.paper = bakePaper();
      SP.hopper = bakeHopper(false);
      SP.hopperUp = bakeHopper(true);
      SP.plat = {
        static: bakePlatform("static", 11),
        move: bakePlatform("move", 22),
        crumble: bakePlatform("crumble", 33),
        vanish: bakePlatform("vanish", 44),
        boost: bakePlatform("boost", 55)
      };
      SP.spring = bakeSpring(false);
      SP.springUp = bakeSpring(true);
      SP.trampoline = bakeTrampoline();
      SP.propeller = bakePropeller();
      SP.jetpack = bakeJetpack();
      SP.rocket = bakeRocket();
      SP.shield = bakeShieldPickup();
      SP.monster = {};
      for (const k of MONSTER_KINDS) SP.monster[k] = bakeMonster(k);
      SP.ufo = bakeUfo();
      SP.hole = bakeBlackHole();
      paperPattern = SP.paper ? g.createPattern(SP.paper.canvas, "repeat") : null;
      BAKE_SCALE = 1;
    }

    function sprite(sp, x, y, scale, rot, alpha, flip) {
      if (!sp) return false;
      const dw = sp.w * U * (scale || 1);
      const dh = sp.h * U * (scale || 1);
      g.save();
      if (alpha !== undefined && alpha < 1) g.globalAlpha = Math.max(0, alpha);
      g.translate(x, y);
      if (rot) g.rotate(rot);
      if (flip) g.scale(-1, 1);
      g.drawImage(sp.canvas, -dw / 2, -dh / 2, dw, dh);
      g.restore();
      return true;
    }

    /* ================================================================ *
     * RENDER
     * ================================================================ */
    function drawPaper() {
      if (paperPattern) {
        const tile = GRID * 4 * U * Math.min(ctx.dpr || 1, 2);
        const off = ((-camY * 1) % tile + tile) % tile;
        g.save();
        g.fillStyle = paperPattern;
        const s = U * Math.min(ctx.dpr || 1, 2);
        g.translate(0, off - tile);
        g.scale(s, s);
        g.fillRect(0, 0, (W / s) + 4, (H / s) + tile / s + 4);
        g.restore();
      } else {
        // No OffscreenCanvas: rule the page live. Plainer, still paper.
        g.fillStyle = PAPER;
        g.fillRect(0, 0, W, H);
        g.strokeStyle = RULE;
        g.lineWidth = 1;
        const step = GRID * U;
        const off = ((-camY) % step + step) % step;
        for (let x = 0; x < W; x += step) {
          g.beginPath(); g.moveTo(Math.floor(x) + 0.5, 0); g.lineTo(Math.floor(x) + 0.5, H); g.stroke();
        }
        for (let y = off - step; y < H; y += step) {
          g.beginPath(); g.moveTo(0, Math.floor(y) + 0.5); g.lineTo(W, Math.floor(y) + 0.5); g.stroke();
        }
      }
      // Margin rule down the left, like a real page.
      g.strokeStyle = "rgba(214,120,120,0.35)";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(Math.round(W * 0.085) + 0.5, 0);
      g.lineTo(Math.round(W * 0.085) + 0.5, H);
      g.stroke();
    }

    function drawPlatform(p) {
      const y = p.y - camY;
      if (y < -60 * U || y > H + 60 * U) return;
      const sp = SP.plat && SP.plat[p.kind];
      const scale = p.w / (PLAT_W * U);
      if (scale > 1.5) { drawWidePlatform(p, y); return; }
      if (!sprite(sp, p.x, y, scale, 0, p.alpha, false)) {
        g.save();
        g.globalAlpha = p.alpha;
        g.fillStyle = p.kind === "move" ? BLUE : p.kind === "crumble" ? BROWN
          : p.kind === "vanish" ? WHITE_P : p.kind === "boost" ? YELLOW : GREEN;
        g.strokeStyle = INK;
        g.lineWidth = 2.4;
        g.beginPath();
        g.rect(p.x - p.w / 2, y - p.h / 2, p.w, p.h);
        g.fill(); g.stroke();
        g.restore();
      }
      if (p.item) drawItem(p, y);
    }

    function drawWidePlatform(p, y) {
      const r = makeRng(p.seed * 977 + 13);
      const hw = p.w * 0.5, hh = p.h * 0.5;
      const pts = [];
      const steps = Math.max(6, Math.round(p.w / (18 * U)));
      for (let i = 0; i <= steps; i++) pts.push({ x: p.x - hw + (p.w * i) / steps, y: y - hh });
      for (let i = 0; i <= steps; i++) pts.push({ x: p.x + hw - (p.w * i) / steps, y: y + hh });
      const fill = p.kind === "move" ? BLUE : p.kind === "crumble" ? BROWN
        : p.kind === "vanish" ? WHITE_P : p.kind === "boost" ? YELLOW : GREEN;
      g.save();
      g.globalAlpha = p.alpha;
      inkFill(g, wobblePoints(pts, 2.2 * U, r), fill, 2.6 * U, true, makeRng(p.seed + 3));
      g.restore();
    }

    // Logical heights, so the anchor maths never has to read a sprite that
    // may not exist when OffscreenCanvas is missing.
    const ITEM_H = { spring: 34, trampoline: 30, propeller: 34, jetpack: 52, rocket: 62, shield: 46 };
    const ITEM_FILL = { spring: RED, trampoline: PURPLE, propeller: BLUE, jetpack: ORANGE, rocket: RED, shield: TEAL };

    function drawItem(p, y) {
      const it = p.item;
      if (!it) return;
      const top = y - p.h * 0.5;
      const ih = (ITEM_H[it] || 32) * U;
      const bob = it === "shield" ? Math.sin(performance.now() / 380) * 3 * U : 0;
      const cy = top - ih * (it === "spring" ? 0.5 : 0.45) + (it === "spring" ? 3 * U : 0) + bob;
      if (sprite(SP[it], p.x, cy, 1, 0, 1, false)) return;

      // Live fallback: a plain inked token in the item's colour. Plainer than
      // the baked art, still readable as "something good is here".
      const r = makeRng(p.seed * 31 + it.length);
      const hw = 13 * U, hh = ih * 0.4;
      const pts = [
        { x: p.x - hw, y: cy + hh }, { x: p.x - hw * 0.7, y: cy - hh },
        { x: p.x + hw * 0.7, y: cy - hh }, { x: p.x + hw, y: cy + hh }
      ];
      g.save();
      inkFill(g, wobblePoints(pts, 1.6 * U, r), ITEM_FILL[it] || YELLOW, 2.4 * U, true, null);
      g.restore();
    }

    function drawMonster(m) {
      const y = m.y - camY + Math.sin(m.bobT) * 5 * U;
      if (y < -90 * U || y > H + 90 * U) return;
      const sp = SP.monster && SP.monster[m.kind];
      const flash = m.hitT > 0;
      if (!sprite(sp, m.x, y, 1, 0, flash ? 0.6 : 1, m.vx < 0)) {
        g.save();
        g.globalAlpha = flash ? 0.6 : 1;
        g.fillStyle = PURPLE; g.strokeStyle = INK; g.lineWidth = 2.4;
        g.beginPath(); g.ellipse(m.x, y, m.w * 0.5, m.h * 0.5, 0, 0, Math.PI * 2);
        g.fill(); g.stroke();
        g.restore();
      }
    }

    function drawHazard(z) {
      const y = z.y - camY;
      if (y < -160 * U || y > H + 160 * U) return;
      if (z.type === "ufo") {
        if (z.beam > 0.02) {
          g.save();
          g.globalAlpha = z.beam * 0.5;
          const grad = g.createLinearGradient(0, y, 0, y + 250 * U);
          grad.addColorStop(0, "rgba(120,220,255,0.9)");
          grad.addColorStop(1, "rgba(120,220,255,0)");
          g.fillStyle = grad;
          g.beginPath();
          g.moveTo(z.x - 26 * U, y + 10 * U);
          g.lineTo(z.x + 26 * U, y + 10 * U);
          g.lineTo(z.x + 74 * U, y + 250 * U);
          g.lineTo(z.x - 74 * U, y + 250 * U);
          g.closePath();
          g.fill();
          g.restore();
        }
        sprite(SP.ufo, z.x, y, 1, 0, 1, false);
      } else {
        const pulse = 1 + Math.sin(z.t * 2.4) * 0.05;
        g.save();
        g.translate(z.x, y);
        g.rotate(z.t * 0.55);
        g.translate(-z.x, -y);
        sprite(SP.hole, z.x, y, pulse, 0, 1, false);
        g.restore();
        if (!SP.hole) {
          g.fillStyle = "#241f30";
          g.beginPath(); g.arc(z.x, y, z.r, 0, Math.PI * 2); g.fill();
        }
      }
    }

    function drawHopper() {
      const h = hopper;
      const y = h.y - camY;
      const stretch = clamp(h.vy / (900 * U), -1, 1);
      const sx = 1 - stretch * 0.13 + h.squash * 0.1;
      const sy = 1 + stretch * 0.16 - h.squash * 0.12;
      const flip = h.facing < 0;
      const sp = h.shootT > 0 ? SP.hopperUp : SP.hopper;

      // Jetpack / rocket ride behind the body.
      if (h.power === "jetpack") sprite(SP.jetpack, h.x - 27 * U * h.facing, y + 8 * U, 0.85, 0, 1, flip);
      if (h.power === "rocket") sprite(SP.rocket, h.x, y + 26 * U, 0.9, 0, 1, flip);

      g.save();
      g.translate(h.x, y);
      if (h.spin) g.rotate(h.spin);
      g.scale(sx, sy);
      g.translate(-h.x, -y);
      if (!sprite(sp, h.x, y, 1, 0, 1, flip)) {
        g.fillStyle = GREEN; g.strokeStyle = INK; g.lineWidth = 2.6;
        g.beginPath(); g.ellipse(h.x, y, HOP_W * 0.5 * U, HOP_H * 0.5 * U, 0, 0, Math.PI * 2);
        g.fill(); g.stroke();
      }
      g.restore();

      if (h.power === "propeller") {
        const spin = performance.now() / 22;
        g.save();
        g.translate(h.x, y - 30 * U);
        g.scale(Math.cos(spin) * 0.9 + 0.1, 1);
        g.translate(-h.x, -(y - 30 * U));
        sprite(SP.propeller, h.x, y - 30 * U, 0.85, 0, 1, false);
        g.restore();
      }

      if (h.shieldT > 0) {
        const fade = h.shieldT < 1.6 ? (Math.sin(h.shieldT * 18) * 0.3 + 0.6) : 0.85;
        g.save();
        g.globalAlpha = fade;
        g.strokeStyle = TEAL;
        g.lineWidth = 3 * U;
        g.beginPath();
        g.arc(h.x, y, 38 * U, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = fade * 0.18;
        g.fillStyle = TEAL;
        g.fill();
        g.restore();
      }
    }

    function drawBullets() {
      for (const b of bullets) {
        const y = b.y - camY;
        g.save();
        g.fillStyle = INK;
        g.beginPath();
        g.ellipse(b.x, y, b.r, b.r * 1.25, 0, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 0.3;
        g.beginPath();
        g.ellipse(b.x, y + b.r * 2.2, b.r * 0.6, b.r * 0.9, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }

    function drawParticles() {
      for (const p of particles) {
        const a = clamp(p.life / p.maxLife, 0, 1);
        g.save();
        g.globalAlpha = a;
        g.fillStyle = p.color;
        g.translate(p.x, p.y - camY);
        g.rotate(p.rot);
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        g.restore();
      }
    }

    /* ================================================================ *
     * TEXT + UI
     * No handwriting face exists in the font registry, so the chalk look
     * comes from a system stack plus an inked double-stroke. Nothing to
     * download, nothing to declare.
     * ================================================================ */

    /* ================================================================ *
     * HAND-INKED ALPHABET
     * The font registry has no handwriting face and system chalk fonts
     * only exist on some phones, so the lettering is drawn here as
     * stroke paths and wobbled like every other line in the bit. Same
     * look on every device, nothing to download.
     * ================================================================ */
    const GLYPHS = {
      "A": "0,1 .5,0 1,1|.18,.66 .82,.66",
      "B": "0,0 0,1|0,0 .72,.08 .72,.42 0,.5|0,.5 .8,.58 .8,.92 0,1",
      "C": ".9,.16 .5,0 .13,.2 .05,.5 .13,.8 .5,1 .9,.84",
      "D": "0,0 0,1|0,0 .6,.06 .86,.35 .86,.66 .6,.95 0,1",
      "E": "0,0 0,1|0,0 .85,.02|0,.5 .64,.5|0,1 .86,.98",
      "F": "0,0 0,1|0,0 .85,.02|0,.5 .6,.5",
      "G": ".9,.16 .5,0 .13,.2 .05,.5 .13,.8 .5,1 .9,.84 .9,.54 .56,.55",
      "H": "0,0 0,1|.86,0 .86,1|0,.5 .86,.5",
      "I": ".1,0 .9,.02|.5,0 .5,1|.1,1 .9,.98",
      "J": ".8,0 .8,.74 .6,.98 .25,.95 .12,.74",
      "K": "0,0 0,1|.86,0 .06,.56|.3,.4 .9,1",
      "L": "0,0 0,1|0,1 .8,.97",
      "M": "0,1 .08,0 .5,.62 .92,0 1,1",
      "N": "0,1 .05,0 .86,1 .9,0",
      "O": ".5,0 .13,.2 .05,.5 .13,.8 .5,1 .88,.8 .95,.5 .88,.2 .5,0",
      "P": "0,0 0,1|0,0 .76,.08 .78,.34 .6,.52 0,.56",
      "Q": ".5,0 .13,.2 .05,.5 .13,.8 .5,1 .88,.8 .95,.5 .88,.2 .5,0|.58,.7 .96,1.06",
      "R": "0,0 0,1|0,0 .76,.08 .78,.34 .6,.52 0,.56|.34,.56 .9,1",
      "S": ".88,.14 .5,0 .15,.13 .18,.38 .55,.5 .86,.63 .82,.88 .45,1 .1,.84",
      "T": "0,0 1,.02|.5,0 .5,1",
      "U": "0,0 .05,.72 .3,.97 .66,.97 .9,.72 .92,0",
      "V": "0,0 .5,1 1,0",
      "W": "0,0 .22,1 .5,.36 .78,1 1,0",
      "X": "0,0 .9,1|.9,0 0,1",
      "Y": "0,0 .45,.52 .9,0|.45,.52 .45,1",
      "Z": "0,0 .9,.02 0,1 .9,.98",
      "0": ".5,0 .15,.2 .1,.5 .15,.8 .5,1 .85,.8 .9,.5 .85,.2 .5,0",
      "1": ".18,.22 .5,0 .5,1|.2,1 .82,.98",
      "2": ".1,.2 .45,0 .82,.16 .8,.42 .1,1 .88,.98",
      "3": ".12,.13 .5,0 .82,.18 .6,.45 .3,.47|.6,.45 .88,.68 .7,.95 .3,1 .08,.85",
      "4": ".68,0 .08,.68 .92,.68|.68,.3 .68,1",
      "5": ".85,.02 .18,0 .12,.42 .5,.36 .85,.52 .82,.85 .45,1 .1,.88",
      "6": ".8,.1 .45,0 .15,.3 .1,.7 .35,.98 .68,.95 .85,.72 .7,.48 .32,.45 .12,.62",
      "7": ".05,0 .92,.02 .42,1",
      "8": ".5,0 .18,.15 .22,.4 .5,.5 .8,.4 .82,.15 .5,0|.5,.5 .16,.62 .12,.85 .5,1 .86,.85 .82,.62 .5,.5",
      "9": ".82,.5 .5,.55 .2,.42 .22,.15 .55,0 .82,.2 .85,.6 .6,.95 .25,1",
      "!": ".5,0 .5,.68|.5,.88 .52,.99",
      "?": ".12,.2 .5,0 .85,.19 .78,.45 .5,.6 .5,.72|.5,.9 .52,1",
      "'": ".55,0 .45,.24",
      "-": ".1,.55 .8,.53",
      ":": ".5,.3 .5,.4|.5,.8 .5,.9",
      ".": ".47,.94 .55,.99",
      ",": ".55,.86 .42,1.14",
      "/": ".85,0 .1,1",
      "(": ".7,0 .34,.5 .7,1",
      ")": ".3,0 .66,.5 .3,1",
      "+": ".12,.55 .82,.55|.47,.22 .47,.88",
      "★": ".5,0 .63,.36 1,.38 .71,.62 .81,1 .5,.78 .19,1 .29,.62 0,.38 .37,.36 .5,0"
    };
    const NARROW = { "I": .62, "1": .72, "!": .42, "'": .38, ":": .42, ".": .42, ",": .42, "-": .78, "(": .5, ")": .5 };
    const GLYPH_CACHE = {};

    function glyphStrokes(ch) {
      if (GLYPH_CACHE[ch]) return GLYPH_CACHE[ch];
      const raw = GLYPHS[ch];
      if (!raw) return null;
      const strokes = raw.split("|").map(s => s.trim().split(/\s+/).map(pair => {
        const c = pair.split(",");
        return { x: parseFloat(c[0]), y: parseFloat(c[1]) };
      }));
      GLYPH_CACHE[ch] = strokes;
      return strokes;
    }

    const TRACK = 0.2;      // gap between glyphs, in cap-height units
    const GWIDTH = 0.66;    // glyph box width, in cap-height units

    function advanceOf(ch) {
      if (ch === " ") return 0.52;
      return (NARROW[ch] || 1) * GWIDTH + TRACK;
    }

    function measureHand(text, size) {
      let w = 0;
      for (const ch of text) w += advanceOf(ch) * size;
      return w - TRACK * size;
    }

    // Wobble is seeded by glyph identity and slot, so redrawing the same
    // label every frame reproduces the same hand rather than shimmering.
    function handText(text, x, y, size, color, align, weightScale, halo) {
      const str = String(text).toUpperCase();
      const total = measureHand(str, size);
      let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
      const top = y - size * 0.5;
      const lw = Math.max(1.4, size * 0.125 * (weightScale || 1));
      const amp = size * 0.035;

      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        const adv = advanceOf(ch) * size;
        const strokes = glyphStrokes(ch);
        if (strokes) {
          const box = (NARROW[ch] || 1) * GWIDTH * size;
          for (let s = 0; s < strokes.length; s++) {
            const r = makeRng(ch.charCodeAt(0) * 131 + i * 17 + s * 7 + 3);
            const pts = strokes[s].map(p => ({ x: cx + p.x * box, y: top + p.y * size }));
            const wob = pts.length > 1 ? wobblePoints(pts, amp, r) : pts;
            if (wob.length === 1) {
              g.fillStyle = color || INK;
              g.beginPath(); g.arc(wob[0].x, wob[0].y, lw * 0.55, 0, Math.PI * 2); g.fill();
              continue;
            }
            g.lineCap = "round";
            g.lineJoin = "round";
            if (halo !== false) {
              strokePath(g, wob, false);
              g.strokeStyle = PAPER;
              g.lineWidth = lw + Math.max(2.4, size * 0.14);
              g.stroke();
            }
            strokePath(g, wob, false);
            g.strokeStyle = color || INK;
            g.lineWidth = lw;
            g.stroke();
            // the pencil going round a second time, fainter and offset
            g.save();
            g.globalAlpha = 0.30;
            g.translate(size * 0.012, size * 0.014);
            strokePath(g, wob, false);
            g.lineWidth = lw * 0.72;
            g.stroke();
            g.restore();
          }
        }
        cx += adv;
      }
      return total;
    }

    function inkText(text, x, y, size, color, align, weight, outline) {
      return handText(text, x, y, size, color, align || "left",
        (weight && weight >= 700) ? 1 : 0.82, outline);
    }

    // Shrink a label until it fits maxW, so no string can ever run out of
    // its panel or its button.
    function fitSize(text, size, maxW) {
      if (!maxW) return size;
      const w = measureHand(String(text).toUpperCase(), size);
      return w > maxW ? Math.max(size * 0.45, size * (maxW / w)) : size;
    }

    function inkTextFit(text, x, y, size, maxW, color, align, weight, outline) {
      return inkText(text, x, y, fitSize(text, size, maxW), color, align, weight, outline);
    }

    let buttons = [];
    function resetButtons() { buttons = []; }

    function drawSpeaker(x, y, s, on) {
      const r = makeRng(606);
      const body = [
        { x: x - s * 0.5, y: y - s * 0.18 }, { x: x - s * 0.2, y: y - s * 0.18 },
        { x: x + s * 0.08, y: y - s * 0.5 }, { x: x + s * 0.08, y: y + s * 0.5 },
        { x: x - s * 0.2, y: y + s * 0.18 }, { x: x - s * 0.5, y: y + s * 0.18 }
      ];
      inkFill(g, wobblePoints(body, s * 0.05, r), INK, s * 0.13, true, null);
      if (on) {
        for (let i = 0; i < 2; i++) {
          const rad = s * (0.26 + i * 0.17);
          g.beginPath();
          g.arc(x + s * 0.14, y, rad, -0.9, 0.9);
          g.strokeStyle = INK;
          g.lineWidth = s * 0.11;
          g.lineCap = "round";
          g.stroke();
        }
      } else {
        inkLine(g, x + s * 0.22, y - s * 0.26, x + s * 0.58, y + s * 0.26, s * 0.12, s * 0.03, r, INK);
        inkLine(g, x + s * 0.58, y - s * 0.26, x + s * 0.22, y + s * 0.26, s * 0.12, s * 0.03, r, INK);
      }
    }

    function drawSwatch(x, y, s, fill) {
      const r = makeRng(Math.round(x * 7 + y * 13) + 91);
      const box = [
        { x: x - s, y: y - s * 0.5 }, { x: x + s, y: y - s * 0.5 },
        { x: x + s, y: y + s * 0.5 }, { x: x - s, y: y + s * 0.5 }
      ];
      inkFill(g, wobblePoints(box, s * 0.16, r), fill, s * 0.28, true, null);
    }

    function inkPanel(x, y, w, h, fill, seed) {
      const r = makeRng(seed || 5);
      const pts = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) pts.push({ x: x + (w * i) / steps, y: y });
      for (let i = 0; i <= steps; i++) pts.push({ x: x + w, y: y + (h * i) / steps });
      for (let i = 0; i <= steps; i++) pts.push({ x: x + w - (w * i) / steps, y: y + h });
      for (let i = 0; i <= steps; i++) pts.push({ x: x, y: y + h - (h * i) / steps });
      const wob = wobblePoints(pts, 3.0, r);
      strokePath(g, wob, true);
      g.fillStyle = fill || "rgba(252,250,240,0.95)";
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.lineJoin = "round";
      g.stroke();
      g.save();
      g.globalAlpha = 0.3;
      g.translate(1.2, 1.4);
      strokePath(g, wob, true);
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }

    function inkButton(id, label, x, y, w, h, fill, size) {
      inkPanel(x, y, w, h, fill || "rgba(255,255,255,0.92)", id.length * 31 + 7);
      if (label) {
        inkTextFit(label, x + w / 2, y + h / 2 + 1, size || 22 * U, w - 18 * U,
          INK, "center", 700, false);
      }
      buttons.push({ id, x, y, w, h });
    }

    function hitButton(px, py) {
      for (let i = buttons.length - 1; i >= 0; i--) {
        const b = buttons[i];
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
      }
      return null;
    }

    /* ---- Persistence + leaderboard ---------------------------------- */
    async function loadBest() {
      if (!ctx.capabilities || !ctx.capabilities.storage) return;
      try {
        const v = await ctx.storage.get("best");
        if (typeof v === "number" && isFinite(v)) best = v;
        const m = await ctx.storage.get("steer");
        if (m === "tilt" || m === "touch") steerMode = m;
        const s = await ctx.storage.get("sound");
        if (s === false) { muted = true; musicOn = false; }
      } catch (err) { /* first run */ }
    }
    async function saveBest() {
      if (score > best) best = score;
      if (!ctx.capabilities || !ctx.capabilities.storage) return;
      try {
        await ctx.storage.set("best", best);
        await ctx.storage.set("steer", steerMode);
        await ctx.storage.set("sound", !muted);
      } catch (err) { /* storage full or denied */ }
    }

    async function submitScore() {
      if (score <= 0) { submitState = "idle"; return; }
      submitState = "sending";
      try {
        await ctx.memory.record("score").submit(score, { label: score + " pts" });
        submitState = "ok";
      } catch (err) {
        submitState = "error";
      }
    }

    let boardRows = null;
    let boardState = "idle";   // idle | loading | ok | error
    let boardScope = "global";
    async function loadBoard(scope) {
      boardScope = scope || boardScope;
      boardState = "loading";
      boardRows = null;
      try {
        const res = await ctx.memory.record("score").leaderboard({ scope: boardScope, period: "all_time" });
        const rows = (res && (res.entries || res.rows || res.leaderboard || res.data)) || [];
        boardRows = Array.isArray(rows) ? rows.slice(0, 10) : [];
        boardState = "ok";
      } catch (err) {
        boardRows = [];
        boardState = "error";
      }
    }

    /* ================================================================ *
     * SCREENS
     * ================================================================ */
    let showHelp = false;
    let showBoard = false;
    let titleT = 0;

    function drawHud() {
      const st = safe().top + 10 * U;

      // A torn strip of paper the HUD sits on, so the score never has to
      // compete with a platform passing behind it.
      const bandH = st + 74 * U;
      g.save();
      g.fillStyle = "rgba(246,242,223,0.88)";
      g.fillRect(0, 0, W, bandH);
      const r = makeRng(4);
      inkLine(g, -4, bandH, W + 4, bandH, 2.0, 3.2, r, "rgba(120,112,90,0.45)");
      g.restore();

      inkText(String(score), 18 * U, st + 22 * U, 44 * U, INK, "left", 700, false);
      inkText("BEST " + best, 20 * U, st + 56 * U, 18 * U, INK_SOFT, "left", 700, false);

      // Controls: sound + help, kept top-right and away from the thumb zone.
      const bs = 40 * U;
      let ry = st + bs + 12 * U;

      // Power-up remaining, as a shrinking inked bar, stacked below them.
      if (hopper && hopper.power) {
        const p = POWER[hopper.power];
        const frac = clamp(hopper.powerT / p.dur, 0, 1);
        const bw = 112 * U, bh = 11 * U;
        const bx = W - bw - 16 * U;
        inkText(p.label, W - 16 * U, ry, 13 * U, INK_SOFT, "right", 700, false);
        ry += 12 * U;
        g.save();
        g.strokeStyle = INK; g.lineWidth = 2.0;
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.beginPath(); g.rect(bx, ry, bw, bh); g.fill(); g.stroke();
        g.fillStyle = hopper.power === "rocket" ? RED : hopper.power === "jetpack" ? ORANGE : BLUE;
        g.fillRect(bx + 2, ry + 2, (bw - 4) * frac, bh - 4);
        g.restore();
        ry += bh + 12 * U;
      }
      if (hopper && hopper.shieldT > 0) {
        inkText("SHIELD " + Math.ceil(hopper.shieldT), W - 16 * U, ry, 15 * U, TEAL, "right", 700, false);
      }

      const sx = W - bs - 14 * U;
      inkButton("sound", "", sx, st - 4 * U, bs, bs, "rgba(255,255,255,0.85)", 19 * U);
      drawSpeaker(sx + bs * 0.52, st - 4 * U + bs * 0.5, bs * 0.46, !muted);
      inkButton("help", "?", W - bs * 2 - 22 * U, st - 4 * U, bs, bs, "rgba(255,255,255,0.85)", 22 * U);
    }

    function drawTitle() {
      const cx = W / 2;
      const top = safe().top;
      const bob = Math.sin(titleT * 2) * 6 * U;

      const titleW = W * 0.84;
      inkTextFit("SKETCH", cx, top + H * 0.17 + bob, 58 * U, titleW, INK, "center", 700, false);
      inkTextFit("HOP", cx, top + H * 0.17 + 52 * U + bob, 58 * U, titleW, GREEN_DARK, "center", 700, false);
      inkTextFit("climb the page, don't fall off", cx, top + H * 0.17 + 94 * U + bob, 15 * U, titleW, INK_SOFT, "center", 700, false);

      // A hopper bouncing on the title screen, drawn from the same sprite.
      const hy = top + H * 0.40 + Math.abs(Math.sin(titleT * 3)) * -46 * U;
      sprite(SP.hopper, cx, hy, 1.15, 0, 1, Math.sin(titleT) < 0);
      const platY = top + H * 0.40 + 40 * U;
      sprite(SP.plat && SP.plat.static, cx, platY, 1, 0, 1, false);

      const bw = Math.min(260 * U, W * 0.7);
      let by = top + H * 0.56;
      inkButton("play", "TAP TO PLAY", cx - bw / 2, by, bw, 56 * U, GREEN, 26 * U);

      by += 70 * U;
      const half = (bw - 10 * U) / 2;
      inkButton("mode_touch", "TOUCH", cx - bw / 2, by, half, 44 * U,
        steerMode === "touch" ? YELLOW : "rgba(255,255,255,0.9)", 18 * U);
      inkButton("mode_tilt", "TILT", cx - bw / 2 + half + 10 * U, by, half, 44 * U,
        steerMode === "tilt" ? YELLOW : "rgba(255,255,255,0.9)", 18 * U);

      by += 58 * U;
      inkButton("help", "HOW TO PLAY", cx - bw / 2, by, bw, 44 * U, "rgba(255,255,255,0.9)", 18 * U);
      by += 54 * U;
      inkButton("board", "LEADERBOARD", cx - bw / 2, by, bw, 44 * U, "rgba(255,255,255,0.9)", 18 * U);

      if (best > 0) {
        inkTextFit("your best  " + best, cx, H - safe().bottom - 30 * U, 19 * U, W * 0.7,
          INK_SOFT, "center", 700, false);
      }
    }

    function drawHelp() {
      const lines = [
        [null, "You bounce forever. Steer, don't fall."],
        [null, steerMode === "tilt" ? "Tilt the phone to steer." : "Hold and drag to steer."],
        [null, "Quick tap shoots ink."],
        [GREEN, "Green holds its ground."],
        [BLUE, "Blue slides sideways."],
        [BROWN, "Brown crumbles."],
        [WHITE_P, "White vanishes after one bounce."],
        [RED, "Springs and trampolines launch you."],
        [ORANGE, "Propeller, jetpack, rocket."],
        [TEAL, "A shield eats one monster."],
        [PURPLE, "Stomp a monster's head."],
        [null, "Dodge UFO beams and black holes."]
      ];
      const pw = Math.min(348 * U, W * 0.92);
      const rowH = 25 * U;
      const ph = Math.min(H * 0.86, 64 * U + lines.length * rowH + 66 * U);
      const px = (W - pw) / 2, py = (H - ph) / 2;
      g.fillStyle = "rgba(30,28,22,0.38)";
      g.fillRect(0, 0, W, H);
      inkPanel(px, py, pw, ph, "rgba(252,250,240,0.98)", 77);
      inkTextFit("HOW TO PLAY", px + pw / 2, py + 30 * U, 25 * U, pw - 40 * U, INK, "center", 700, false);

      let ly = py + 62 * U;
      const textX = px + 40 * U;
      const maxTextW = pw - 54 * U;
      for (const [sw, text] of lines) {
        if (sw) drawSwatch(px + 24 * U, ly, 7.5 * U, sw);
        else {
          g.fillStyle = INK_SOFT;
          g.beginPath(); g.arc(px + 24 * U, ly, 2.2 * U, 0, Math.PI * 2); g.fill();
        }
        inkTextFit(text, textX, ly, 13 * U, maxTextW, sw ? INK : INK_SOFT, "left", 600, false);
        ly += rowH;
      }
      inkButton("close_help", "GOT IT", px + pw / 2 - 68 * U, py + ph - 52 * U, 136 * U, 40 * U, GREEN, 19 * U);
    }

    function drawBoard() {
      const pw = Math.min(340 * U, W * 0.9);
      const ph = Math.min(430 * U, H * 0.76);
      const px = (W - pw) / 2, py = (H - ph) / 2;
      g.fillStyle = "rgba(30,28,22,0.35)";
      g.fillRect(0, 0, W, H);
      inkPanel(px, py, pw, ph, "rgba(252,250,240,0.98)", 88);
      inkTextFit("LEADERBOARD", px + pw / 2, py + 30 * U, 24 * U, pw - 40 * U, INK, "center", 700, false);

      const half = (pw - 46 * U) / 2;
      inkButton("scope_global", "GLOBAL", px + 18 * U, py + 50 * U, half, 34 * U,
        boardScope === "global" ? YELLOW : "rgba(255,255,255,0.9)", 15 * U);
      inkButton("scope_following", "FRIENDS", px + 28 * U + half, py + 50 * U, half, 34 * U,
        boardScope === "following" ? YELLOW : "rgba(255,255,255,0.9)", 15 * U);

      let ly = py + 108 * U;
      if (boardState === "loading") {
        inkText("loading…", px + pw / 2, ly + 40 * U, 18 * U, INK_SOFT, "center", 700, false);
      } else if (boardState === "error") {
        inkText("couldn't load right now", px + pw / 2, ly + 30 * U, 16 * U, INK_SOFT, "center", 700, false);
        inkText("your score is still saved", px + pw / 2, ly + 54 * U, 14 * U, INK_SOFT, "center", 700, false);
      } else if (boardRows && boardRows.length === 0) {
        inkText("no climbs logged yet", px + pw / 2, ly + 30 * U, 16 * U, INK_SOFT, "center", 700, false);
        inkText("be the first", px + pw / 2, ly + 54 * U, 14 * U, INK_SOFT, "center", 700, false);
      } else if (boardRows) {
        for (let i = 0; i < boardRows.length; i++) {
          const row = boardRows[i];
          const name = row.displayName || row.username || row.name || row.handle || "climber";
          const val = row.formatted || row.label || row.value || row.score || 0;
          const mine = row.isViewer || row.isMe || row.self;
          inkText(String(i + 1), px + 18 * U, ly, 14 * U, INK_SOFT, "left", 700, false);
          inkTextFit(String(name).slice(0, 14), px + 42 * U, ly, 14 * U, pw * 0.48,
            mine ? GREEN_DARK : INK, "left", 700, false);
          inkTextFit(String(val), px + pw - 18 * U, ly, 14 * U, pw * 0.3, INK, "right", 700, false);
          ly += 27 * U;
        }
      }
      inkButton("close_board", "BACK", px + pw / 2 - 70 * U, py + ph - 54 * U, 140 * U, 42 * U, "rgba(255,255,255,0.92)", 20 * U);
    }

    const DEATH_TEXT = {
      fall: ["OFF THE PAGE", "you ran out of paper"],
      monster: ["EATEN", "land on their heads instead"],
      ufo: ["ABDUCTED", "never stand under the beam"],
      hole: ["SWALLOWED", "black holes pull from far away"]
    };

    function drawGameOver() {
      const pw = Math.min(322 * U, W * 0.88);
      const ph = Math.min(H * 0.8, 362 * U);
      const px = (W - pw) / 2;
      const py = (H - ph) / 2;
      const maxW = pw - 36 * U;
      g.fillStyle = "rgba(30,28,22,0.36)";
      g.fillRect(0, 0, W, H);
      inkPanel(px, py, pw, ph, "rgba(252,250,240,0.98)", 66);

      const cx = px + pw / 2;
      const txt = DEATH_TEXT[deathReason] || DEATH_TEXT.fall;
      let cy = py + 40 * U;
      inkTextFit(txt[0], cx, cy, 30 * U, maxW, RED_DARK, "center", 700, false);
      cy += 28 * U;
      inkTextFit(txt[1], cx, cy, 13 * U, maxW, INK_SOFT, "center", 700, false);

      cy += 54 * U;
      inkTextFit(String(score), cx, cy, 54 * U, maxW, INK, "center", 700, false);
      cy += 40 * U;
      inkTextFit("points", cx, cy, 13 * U, maxW, INK_SOFT, "center", 700, false);

      cy += 30 * U;
      const isNew = score >= best && score > 0;
      if (isNew) inkTextFit("\u2605 NEW BEST \u2605", cx, cy, 19 * U, maxW, GREEN_DARK, "center", 700, false);
      else inkTextFit("best " + best, cx, cy, 17 * U, maxW, INK_SOFT, "center", 700, false);

      if (bopped > 0) {
        cy += 24 * U;
        inkTextFit(bopped + (bopped === 1 ? " monster squashed" : " monsters squashed"),
          cx, cy, 13 * U, maxW, INK_SOFT, "center", 700, false);
      }
      const sub = submitState === "sending" ? "sending score..."
        : submitState === "ok" ? "score sent to the leaderboard"
          : submitState === "error" ? "score saved on this device" : "";
      if (sub) {
        cy += 22 * U;
        inkTextFit(sub, cx, cy, 12 * U, maxW, INK_SOFT, "center", 700, false);
      }

      const pad = 20 * U;
      const rowH = 34 * U;
      const playH = 44 * U;
      const bottom = py + ph - pad;
      const rowY = bottom - rowH;
      const playY = rowY - playH - 10 * U;
      inkButton("again", "PLAY AGAIN", px + pad, playY, pw - pad * 2, playH, GREEN, 22 * U);
      const halfw = (pw - pad * 2 - 10 * U) / 2;
      inkButton("board", "BOARD", px + pad, rowY, halfw, rowH, "rgba(255,255,255,0.92)", 15 * U);
      inkButton("home", "MENU", px + pad + halfw + 10 * U, rowY, halfw, rowH, "rgba(255,255,255,0.92)", 15 * U);
    }

    /* ================================================================ *
     * FRAME
     * ================================================================ */
    let lastW = 0, lastH = 0;
    let firstFrameDone = false;

    function render() {
      resetButtons();
      g.save();
      if (shakeT > 0 && shakeAmp > 0) {
        const k = shakeT / 0.32;
        g.translate((rand() - 0.5) * shakeAmp * k, (rand() - 0.5) * shakeAmp * k);
      }
      drawPaper();

      if (state !== "title") {
        for (const p of platforms) drawPlatform(p);
        for (const z of hazards) drawHazard(z);
        for (const m of monsters) drawMonster(m);
        drawBullets();
        if (state === "play") drawHopper();
        drawParticles();
      } else {
        drawParticles();
      }
      g.restore();

      if (state === "title") drawTitle();
      else drawHud();
      if (state === "dead") drawGameOver();
      if (showHelp) drawHelp();
      if (showBoard) drawBoard();
    }

    function frame(dtMs) {
      const dt = clamp(dtMs / 1000, 0, 0.05);
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width; lastH = ctx.height;
        recomputeScale();
        if (Math.abs(spriteScale - U) > 0.001) buildSprites();
      }
      titleT += dt;
      if (state === "play" && !showHelp && !showBoard) updatePlay(dt);
      updateParticles(dt);
      render();
      if (!firstFrameDone) {
        firstFrameDone = true;
        ctx.markVisualReady("first-frame");
      }
    }

    /* ================================================================ *
     * WIRING
     * ================================================================ */
    let started = false;
    function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      resumeAudio();
      startMusic();
      // A stored tilt preference cannot be honoured until a gesture exists,
      // so re-arm it here; steering falls back to touch until it lands.
      if (steerMode === "tilt" && !tiltReady) {
        enableTilt().then(ok => { if (!ok) steerMode = "touch"; });
      }
    }

    function beginRun() {
      resetRun();
      state = "play";
      showHelp = false;
      showBoard = false;
      resumeAudio();
      sfx.boing(1);
      ctx.platform.interact({ type: "run_start" });
    }

    async function pressButton(id) {
      sfx.blip();
      if (id === "play") { firstGesture(); beginRun(); return; }
      if (id === "again") { firstGesture(); beginRun(); return; }
      if (id === "home") { state = "title"; showBoard = false; return; }
      if (id === "help") { showHelp = true; return; }
      if (id === "close_help") { showHelp = false; return; }
      if (id === "board" || id === "board2") { showBoard = true; loadBoard(boardScope); return; }
      if (id === "close_board") { showBoard = false; return; }
      if (id === "scope_global") { loadBoard("global"); return; }
      if (id === "scope_following") { loadBoard("following"); return; }
      if (id === "sound") {
        muted = !muted;
        musicOn = !muted;
        if (muted) { stopThrust(); try { ctx.music.stop({ fadeOutMs: 250 }); } catch (e) { /* not playing */ } }
        else { resumeAudio(); startMusic(); }
        saveBest();
        return;
      }
      if (id === "mode_touch") { steerMode = "touch"; saveBest(); return; }
      if (id === "mode_tilt") {
        const ok = await enableTilt();
        steerMode = ok ? "tilt" : "touch";
        if (!ok) {
          // Denied or unsupported: stay on touch and say so on the card.
          showHelp = true;
        }
        saveBest();
        return;
      }
    }

    ctx.listen(canvas, "pointerdown", event => {
      event.preventDefault();
      firstGesture();
      pointerDown = true;
      pointerX = event.offsetX;
      pointerY = event.offsetY;
      pressOx = pointerX; pressOy = pointerY;
      pressMovedBy = 0;
      pressStart = performance.now();
      // A press that lands on a button must not also steer the hopper.
      if (hitButton(pointerX, pointerY)) pointerDown = false;
    }, { passive: false });

    ctx.listen(canvas, "pointermove", event => {
      const x = event.offsetX, y = event.offsetY;
      pressMovedBy = Math.max(pressMovedBy, Math.hypot(x - pressOx, y - pressOy));
      pointerX = x;
      pointerY = y;
    }, { passive: true });

    function endPress(event) {
      const x = event && event.offsetX !== undefined ? event.offsetX : pointerX;
      const y = event && event.offsetY !== undefined ? event.offsetY : pointerY;
      const dur = performance.now() - pressStart;
      const wasTap = dur < 320 && pressMovedBy < 14 * U;
      pointerDown = false;

      const id = hitButton(x, y);
      if (id) { pressButton(id); return; }
      if (showHelp || showBoard) return;
      if (state === "title") { firstGesture(); beginRun(); return; }
      if (state === "dead") return;
      if (state === "play" && (wasTap || steerMode === "tilt")) fireBullet(x, y);
    }

    ctx.listen(canvas, "pointerup", event => { event.preventDefault(); endPress(event); }, { passive: false });
    ctx.listen(canvas, "pointercancel", () => { pointerDown = false; }, { passive: true });
    ctx.listen(canvas, "contextmenu", event => event.preventDefault(), { passive: false });

    /* ---- Boot -------------------------------------------------------- */
    lastW = ctx.width; lastH = ctx.height;
    recomputeScale();
    buildSprites();
    await loadBest();
    resetRun();
    state = "title";

    render();
    ctx.markVisualReady("title");
    ctx.onFrame(frame);
    ctx.platform.ready({ title: "Sketch Hop" });
  }
};
