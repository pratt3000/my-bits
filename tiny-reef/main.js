// Tiny Reef — a shared aquarium Plethora Bit.
//
// Everyone who opens this sees the same reef. You design one little fish —
// body, colour, pattern, tail, size — and release it into the `reef` objects
// world, where it joins the fish other people have already released. Tap the
// water to sprinkle food and watch the shoal chase it; tap a fish to see its
// name and who made it.
//
// Everything is drawn procedurally on a 2D canvas (packaged assets are
// disabled), and a few "wild" fish keep the tank alive when the reef is quiet
// or unreachable.

window.plethoraBit = {
  meta: {
    title: "Tiny Reef",
    runtime: "plethora-bit@2",
    tags: ["shared", "co-creation", "aquarium", "art", "creative", "relaxing", "fidget", "sensory"],
    permissions: ["haptics", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    // ---- fish traits -------------------------------------------------------
    // Every trait is an index into one of these tables, so a whole fish is a
    // handful of small integers: tiny to store, and with no free text at all —
    // which is what keeps a world anyone can write to safe to render.

    // peak is where the body is deepest (0 = nose, 1 = tail); fat < 1 fills the
    // profile out, fat > 1 slims it down.
    const BODIES = [
      { label: "Disc",    tall: 0.42, peak: 0.40, fat: 0.72, len: 0.95 },
      { label: "Torpedo", tall: 0.26, peak: 0.34, fat: 0.85, len: 1.15 },
      { label: "Needle",  tall: 0.16, peak: 0.30, fat: 1.00, len: 1.40 },
      { label: "Puff",    tall: 0.50, peak: 0.46, fat: 0.58, len: 0.85 }
    ];

    // Curated two-tone reef palettes: a = flank, b = back, c = fins/markings.
    const COLORS = [
      { label: "Coral",     a: "#ff9d6e", b: "#f0562f", c: "#ffd0a8" },
      { label: "Tangerine", a: "#ffc46b", b: "#f28c1c", c: "#ffe3a8" },
      { label: "Lemon",     a: "#fff0a0", b: "#f5c518", c: "#fffad0" },
      { label: "Lime",      a: "#c8f08a", b: "#6fbf3f", c: "#e6ffbd" },
      { label: "Mint",      a: "#a8f0d8", b: "#37bf9a", c: "#d8fff1" },
      { label: "Aqua",      a: "#8fe6f5", b: "#1fa8c9", c: "#d3f7ff" },
      { label: "Sky",       a: "#a9c8ff", b: "#3f6fe0", c: "#dbe6ff" },
      { label: "Cobalt",    a: "#8a9bf0", b: "#3b3fb0", c: "#c8cfff" },
      { label: "Violet",    a: "#d0aaf5", b: "#8b45cf", c: "#eddcff" },
      { label: "Magenta",   a: "#ff9ee0", b: "#df3fa8", c: "#ffd4f2" },
      { label: "Rose",      a: "#ffb0b8", b: "#e04f66", c: "#ffdde1" },
      { label: "Pearl",     a: "#f2f5fa", b: "#b9c6d6", c: "#ffffff" }
    ];

    const PATTERNS = [{ label: "Plain" }, { label: "Stripes" }, { label: "Spots" },
      { label: "Sash" }, { label: "Scales" }];
    const TAILS = [{ label: "Fan" }, { label: "Fork" }, { label: "Moon" }, { label: "Veil" }];
    const SIZES = [{ label: "S", k: 0.72 }, { label: "M", k: 1 }, { label: "L", k: 1.34 }];

    const ADJ = ["Mango", "Pearl", "Sunny", "Wobbly", "Velvet", "Pepper", "Coral", "Nimble",
      "Bubble", "Salty", "Twilight", "Ginger", "Marble", "Lucky", "Sleepy", "Zippy"];
    const NOUN = ["Drifter", "Nibbler", "Blenny", "Tang", "Wisp", "Puffer", "Darter", "Guppy",
      "Snapper", "Minnow", "Flicker", "Goby", "Pilot", "Ripple", "Skipper", "Bloop"];

    const nameOf = (g) => ADJ[g.na] + " " + NOUN[g.nb];

    // ---- helpers -----------------------------------------------------------
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const randInt = (n) => Math.floor(Math.random() * n);
    const lerp = (a, b, t) => a + (b - a) * t;

    // Deterministic PRNG so freckles and décor stay put between frames.
    function seeded(seed) {
      let s = (seed >>> 0) || 1;
      return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function hashId(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
      return h >>> 0;
    }
    const newId = () => "f" + Math.floor(Math.random() * 1e9).toString(36) +
      Math.floor(Math.random() * 1e9).toString(36);

    function randomGene() {
      return {
        b: randInt(BODIES.length), c: randInt(COLORS.length), p: randInt(PATTERNS.length),
        t: randInt(TAILS.length), s: randInt(SIZES.length),
        na: randInt(ADJ.length), nb: randInt(NOUN.length)
      };
    }

    // Compact wire form — short keys keep a mutation far under the size cap.
    const encode = (g) => ({ v: 1, b: g.b, c: g.c, p: g.p, t: g.t, s: g.s, n: [g.na, g.nb] });

    // Anything at all can come back from a world everyone writes to, so clamp
    // every index and reject payloads that are not shaped like a fish.
    function decode(raw) {
      if (!raw || typeof raw !== "object") return null;
      let known = false;
      for (const k of ["b", "c", "p", "t", "s", "n", "na"]) if (k in raw) { known = true; break; }
      if (!known) return null;
      const n = Array.isArray(raw.n) ? raw.n : [raw.na, raw.nb];
      const num = (v, hi) => clamp(Math.floor(Number(v) || 0), 0, hi - 1);
      return {
        b: num(raw.b, BODIES.length), c: num(raw.c, COLORS.length), p: num(raw.p, PATTERNS.length),
        t: num(raw.t, TAILS.length), s: num(raw.s, SIZES.length),
        na: num(n && n[0], ADJ.length), nb: num(n && n[1], NOUN.length)
      };
    }

    // ---- surfaces ----------------------------------------------------------
    // Two runtime canvases: the reef backdrop, painted once and left alone, and
    // the live layer cleared every frame on top of it. Layer order is creation
    // order, so the backdrop has to come first.
    const bgCanvas = ctx.createCanvas2D();
    const bgCtx = bgCanvas.getContext("2d");
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "manipulation" });
    ui.style.pointerEvents = "none"; // taps fall through to the water by default

    const FONT = "-apple-system,system-ui,Segoe UI,Roboto,sans-serif";
    let W = ctx.width;
    let H = ctx.height;
    const floorY = () => H * 0.86;
    const baseLen = () => clamp(Math.min(W, H) * 0.115, 38, 88);

    // ---- scenery -----------------------------------------------------------
    // Water, sand, rocks and coral never change, so they are painted once onto
    // the backdrop layer. Kelp, rays, motes and fish move, and are drawn live
    // on the layer above.
    const sceneSeed = Math.floor(Math.random() * 1e9);
    let kelp = [];
    let motes = [];
    let vents = [];
    let vignette = null;

    function coralBranch(c, x, y, angle, len, width, depth, color, rnd) {
      if (depth <= 0 || len < 3) return;
      const x2 = x + Math.cos(angle) * len;
      const y2 = y + Math.sin(angle) * len;
      c.strokeStyle = color;
      c.lineWidth = width;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(angle - 0.3) * len * 0.6, y + Math.sin(angle - 0.3) * len * 0.6, x2, y2);
      c.stroke();
      const spread = 0.45 + rnd() * 0.4;
      coralBranch(c, x2, y2, angle - spread, len * 0.72, width * 0.7, depth - 1, color, rnd);
      coralBranch(c, x2, y2, angle + spread, len * 0.72, width * 0.7, depth - 1, color, rnd);
    }

    function buildScene() {
      const c = bgCtx;
      c.clearRect(0, 0, W, H);
      const rnd = seeded(sceneSeed);
      const fy = floorY();
      // Décor is sized against the smaller viewport dimension, so a phone does
      // not get a hedge of coral where a tablet gets a tasteful border — and a
      // landscape tank does not fill with wall-sized kelp.
      const u = clamp(Math.min(W, H) / 390, 0.85, 2);

      const water = c.createLinearGradient(0, 0, 0, H);
      water.addColorStop(0, "#0e5f86");
      water.addColorStop(0.35, "#0a4a72");
      water.addColorStop(0.75, "#07304f");
      water.addColorStop(1, "#051f36");
      c.fillStyle = water;
      c.fillRect(0, 0, W, H);

      // Hazy reef silhouettes far behind everything.
      c.fillStyle = "rgba(6,54,80,0.55)";
      for (let i = 0; i < 7; i++) {
        const x = rnd() * W;
        const h = H * (0.10 + rnd() * 0.16);
        c.beginPath();
        c.moveTo(x - h * 0.7, fy + 10);
        c.quadraticCurveTo(x, fy - h, x + h * 0.7, fy + 10);
        c.fill();
      }

      const sand = c.createLinearGradient(0, fy - 20, 0, H);
      sand.addColorStop(0, "#c3a878");
      sand.addColorStop(0.45, "#a08a5f");
      sand.addColorStop(1, "#6b5a3c");
      c.fillStyle = sand;
      c.beginPath();
      c.moveTo(0, H);
      c.lineTo(0, fy + 14);
      for (let x = 0; x <= W; x += 24) {
        c.lineTo(x, fy + Math.sin(x * 0.012) * 9 + Math.sin(x * 0.03) * 4);
      }
      c.lineTo(W, H);
      c.closePath();
      c.fill();

      for (let i = 0; i < 220; i++) {
        const x = rnd() * W;
        const y = fy + 12 + rnd() * (H - fy);
        c.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.16)" : "rgba(80,60,35,0.18)";
        c.fillRect(x, y, 2, 2);
      }

      // Soften the water/sand seam so the floor does not read as a flat band.
      const seam = c.createLinearGradient(0, fy - 46, 0, fy + 30);
      seam.addColorStop(0, "rgba(4,24,44,0)");
      seam.addColorStop(1, "rgba(4,24,44,0.45)");
      c.fillStyle = seam;
      c.fillRect(0, fy - 46, W, 76);

      for (let i = 0; i < Math.round(W / 70); i++) {
        const x = rnd() * W;
        const r = (10 + rnd() * 18) * u;
        const y = fy + 6 + rnd() * 26;
        c.fillStyle = "rgba(38,54,66,0.9)";
        c.beginPath();
        c.ellipse(x, y, r, r * 0.62, rnd() * 0.6 - 0.3, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "rgba(120,160,175,0.16)";
        c.beginPath();
        c.ellipse(x - r * 0.25, y - r * 0.24, r * 0.5, r * 0.24, 0, 0, Math.PI * 2);
        c.fill();
      }

      // Sea-grass tufts along the floor.
      for (let i = 0; i < Math.round(W / 15); i++) {
        const x = rnd() * W;
        const y = fy + 10 + rnd() * 22;
        const h = (10 + rnd() * 16) * u;
        c.strokeStyle = rnd() > 0.5 ? "rgba(46,140,104,0.75)" : "rgba(30,116,100,0.7)";
        c.lineWidth = 2.2 * u;
        c.lineCap = "round";
        for (let k = -1; k <= 1; k++) {
          c.beginPath();
          c.moveTo(x, y);
          c.quadraticCurveTo(x + k * 5 * u, y - h * 0.6, x + k * 11 * u, y - h);
          c.stroke();
        }
      }

      const coralHues = ["#ef6f8e", "#f2a65a", "#7ad4c0", "#c98ae0", "#f0d76a"];
      for (let i = 0; i < Math.round(W / 46); i++) {
        const x = 20 + rnd() * (W - 40);
        const y = fy + 10 + rnd() * 20;
        const color = coralHues[Math.floor(rnd() * coralHues.length)];
        coralBranch(c, x, y, -Math.PI / 2 + (rnd() - 0.5) * 0.5, (11 + rnd() * 15) * u, (4.5 + rnd() * 3) * u, 4, color, rnd);
      }

      // Sea fans.
      for (let i = 0; i < Math.round(W / 130); i++) {
        const x = rnd() * W;
        const y = fy + 12;
        const r = (17 + rnd() * 15) * u;
        c.strokeStyle = "rgba(255,140,170,0.5)";
        c.lineWidth = 1.8 * u;
        for (let a = -1.2; a <= 1.2; a += 0.22) {
          c.beginPath();
          c.moveTo(x, y);
          c.quadraticCurveTo(x + Math.sin(a) * r * 0.5, y - r * 0.6, x + Math.sin(a) * r, y - r);
          c.stroke();
        }
      }

      // Anemones.
      for (let i = 0; i < Math.round(W / 110); i++) {
        const x = rnd() * W;
        const y = fy + 14 + rnd() * 14;
        c.fillStyle = "rgba(140,220,210,0.35)";
        c.beginPath();
        c.ellipse(x, y, 11 * u, 5 * u, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "rgba(180,255,240,0.5)";
        c.lineWidth = 2 * u;
        c.lineCap = "round";
        for (let k = 0; k < 9; k++) {
          const a = -Math.PI / 2 + (k - 4) * 0.19;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a) * 11 * u, y + Math.sin(a) * 11 * u);
          c.stroke();
        }
      }

      // Live scenery, seeded from the same stream so it survives a resize.
      const kr = seeded(sceneSeed ^ 0x9e37);
      kelp = [];
      const stalks = Math.max(4, Math.round(W / 78));
      for (let i = 0; i < stalks; i++) {
        const dark = kr() > 0.5;
        kelp.push({
          x: (i + 0.5) * (W / stalks) + (kr() - 0.5) * 40,
          h: H * (0.14 + kr() * 0.24),
          phase: kr() * Math.PI * 2,
          speed: 0.4 + kr() * 0.35,
          hue: dark ? "rgba(26,108,94,0.9)" : "rgba(40,146,104,0.9)",
          leaf: dark ? "rgba(32,126,106,0.8)" : "rgba(52,164,116,0.8)",
          width: (5 + kr() * 3) * u
        });
      }
      motes = [];
      for (let i = 0; i < 46; i++) {
        motes.push({
          x: kr() * W, y: kr() * H, r: 0.7 + kr() * 1.6,
          vy: -(2 + kr() * 8), vx: (kr() - 0.5) * 5, a: 0.1 + kr() * 0.28
        });
      }
      vents = [];
      for (let i = 0; i < 3; i++) vents.push({ x: kr() * W, next: kr() * 1200 });

      vignette = g.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35,
        W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,12,24,0.45)");
    }

    // Kelp is a tapering ribbon with leaf blades alternating up the stalk, so
    // it reads as a plant rather than a wire.
    function drawKelp(t) {
      const fy = floorY() + 12;
      for (const k of kelp) {
        const segs = 9;
        const at = (u) => {
          const sway = Math.sin(t * 0.0009 * k.speed + k.phase + u * 2.2) * 26 * u * u;
          return { x: k.x + sway, y: fy - k.h * u };
        };
        g.strokeStyle = k.hue;
        g.lineCap = "round";
        // Taper: draw the stalk as a few overlapping strokes of shrinking width.
        for (let i = 0; i < segs; i++) {
          const u0 = i / segs;
          const u1 = (i + 1) / segs;
          const a = at(u0);
          const b = at(u1);
          g.lineWidth = k.width * (1 - u0 * 0.65);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
        g.fillStyle = k.leaf;
        for (let i = 1; i <= 5; i++) {
          const u = i / 6;
          const p = at(u);
          const side = i % 2 ? 1 : -1;
          const lean = Math.sin(t * 0.0009 * k.speed + k.phase + u * 2.2) * 0.35;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(side * 0.9 + lean);
          g.beginPath();
          g.ellipse(k.width * 1.6, 0, k.width * 2.4, k.width * 0.8, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
    }

    function drawRays(t) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++) {
        const sweep = Math.sin(t * 0.00013 + i * 1.7) * 0.10;
        const x = (i + 0.5) * (W / 6) + Math.sin(t * 0.0002 + i) * 22;
        const w = 12 + (i % 3) * 7;
        const grad = g.createLinearGradient(x, -20, x + sweep * H, H * 0.75);
        grad.addColorStop(0, "rgba(190,240,255,0.085)");
        grad.addColorStop(0.45, "rgba(190,240,255,0.04)");
        grad.addColorStop(1, "rgba(190,240,255,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(x - w * 0.4, -20);
        g.lineTo(x + w * 0.4, -20);
        g.lineTo(x + sweep * H + w * 1.6, H * 0.75);
        g.lineTo(x + sweep * H - w * 0.7, H * 0.75);
        g.closePath();
        g.fill();
      }
      g.restore();
    }

    function drawMotes(dt) {
      for (const m of motes) {
        m.y += m.vy * dt * 0.001;
        m.x += m.vx * dt * 0.001;
        if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W; }
        if (m.x < -4) m.x = W + 4;
        if (m.x > W + 4) m.x = -4;
        g.fillStyle = "rgba(220,245,255," + m.a + ")";
        g.beginPath();
        g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        g.fill();
      }
    }

    // ---- fish drawing ------------------------------------------------------
    // Drawn in local space with the nose at -len/2 and the tail base at +len/2,
    // so the same routine paints the reef and the designer preview. Alpha is
    // multiplied into whatever the caller set, so depth fading survives.
    // An almond profile with its deepest point at body.peak, thinning to a
    // pointed snout and a slim peduncle the tail can attach to.
    function halfHeight(body, u) {
      u = clamp(u, 0, 1);
      const p = body.peak;
      const d = u < p ? (u - p) / p : (u - p) / (1 - p);
      const bell = Math.sqrt(Math.max(0, 1 - d * d));
      const peduncle = 0.10 * clamp((u - 0.5) / 0.5, 0, 1);
      return body.tall * Math.max(Math.pow(bell, body.fat), peduncle);
    }

    // Body gradients are per (context, colour, size) and never change, so cache
    // them instead of rebuilding ~30 of them every frame.
    const skinCache = new WeakMap();
    function skinGradient(c, gene, back) {
      let byCtx = skinCache.get(c);
      if (!byCtx) { byCtx = new Map(); skinCache.set(c, byCtx); }
      const key = gene.c + "|" + Math.round(back);
      let grad = byCtx.get(key);
      if (!grad) {
        const col = COLORS[gene.c];
        grad = c.createLinearGradient(0, back, 0, -back);
        grad.addColorStop(0, col.b);
        grad.addColorStop(0.55, col.a);
        grad.addColorStop(1, col.c);
        if (byCtx.size > 120) byCtx.clear();
        byCtx.set(key, grad);
      }
      return grad;
    }

    // `shape` is the body Path2D: fills and clips take it explicitly, because
    // save()/restore() does not restore the context's current path.
    function paintSkin(c, gene, len, body, base, shape) {
      const col = COLORS[gene.c];
      c.fillStyle = skinGradient(c, gene, -halfHeight(body, 0.4) * len);
      c.fill(shape);

      const L = len;
      const p = PATTERNS[gene.p].label;
      if (p === "Stripes") {
        c.fillStyle = col.b;
        c.globalAlpha = base * 0.55;
        for (let i = 0; i < 5; i++) {
          const x = -L * 0.34 + i * L * 0.17;
          c.beginPath();
          c.moveTo(x - L * 0.03, -L);
          c.lineTo(x + L * 0.05, -L);
          c.lineTo(x + L * 0.01, L);
          c.lineTo(x - L * 0.07, L);
          c.closePath();
          c.fill();
        }
      } else if (p === "Spots") {
        const rnd = seeded(hashId(gene.b + ":" + gene.c + ":" + gene.na + ":" + gene.nb));
        c.fillStyle = col.c;
        c.globalAlpha = base * 0.7;
        for (let i = 0; i < 9; i++) {
          const x = (rnd() - 0.4) * L * 0.9;
          const y = (rnd() - 0.5) * L * body.tall * 1.5;
          c.beginPath();
          c.arc(x, y, L * (0.022 + rnd() * 0.03), 0, Math.PI * 2);
          c.fill();
        }
      } else if (p === "Sash") {
        c.fillStyle = col.c;
        c.globalAlpha = base * 0.75;
        c.beginPath();
        c.moveTo(-L * 0.10, -L);
        c.lineTo(L * 0.06, -L);
        c.lineTo(L * 0.18, L);
        c.lineTo(L * 0.02, L);
        c.closePath();
        c.fill();
      } else if (p === "Scales") {
        c.strokeStyle = col.b;
        c.globalAlpha = base * 0.4;
        c.lineWidth = Math.max(1, L * 0.012);
        for (let row = -2; row <= 2; row++) {
          for (let i = 0; i < 6; i++) {
            const x = -L * 0.4 + i * L * 0.15 + (row % 2 ? L * 0.07 : 0);
            const y = row * L * body.tall * 0.42;
            c.beginPath();
            c.arc(x, y, L * 0.055, Math.PI * 0.15, Math.PI * 0.85);
            c.stroke();
          }
        }
      }
      c.globalAlpha = base;
    }

    // t drives the swim wave; beat is how hard the fish is kicking.
    function drawFishLocal(c, gene, len, t, beat) {
      const body = BODIES[gene.b];
      const col = COLORS[gene.c];
      const base = c.globalAlpha;
      const L = len * body.len;
      const wave = (u) => Math.sin(u * 4.6 - t) * (0.012 + 0.06 * u) * L * beat;
      const x0 = -L * 0.5;
      const tail = TAILS[gene.t].label;
      const dh = L * body.tall;                        // deepest half-height
      const px = (u) => x0 + u * L;
      const topY = (u) => wave(u) - halfHeight(body, u) * L;
      const botY = (u) => wave(u) + halfHeight(body, u) * L;
      const edge = "rgba(8,22,38,0.32)";
      const finLine = Math.max(0.8, L * 0.011);

      // Fins are drawn first so the body sits over their roots — that is what
      // makes them read as attached rather than floating alongside.
      c.strokeStyle = edge;
      c.lineWidth = finLine;
      c.lineJoin = "round";
      c.fillStyle = col.a;              // fins share the flank tone, so they
      c.globalAlpha = base * 0.92;      // read as part of the fish, not haze

      // Caudal fin. Its root spans the whole peduncle and starts inside the
      // body, so the body drawn over it hides the join completely. Fin size is
      // a fraction of body *length*, not depth — scaling it off depth gives
      // deep-bodied fish a fan as tall as they are long.
      const ax = px(1);                 // hinge
      const hinge = wave(1);
      const tipY = hinge + (wave(1.18) - hinge) * 0.6;   // the tip lags a little
      const tl = L * (tail === "Veil" ? 0.40 : 0.30);
      const th = L * (0.15 + body.tall * 0.38) * (tail === "Veil" ? 0.85 : 1);
      const ru = 0.86;
      const rx = px(ru);
      const rt = topY(ru);
      const rb = botY(ru);
      c.beginPath();
      c.moveTo(rx, rt);
      if (tail === "Fork") {
        c.quadraticCurveTo(ax + tl * 0.45, tipY - th * 0.6, ax + tl, tipY - th);
        c.quadraticCurveTo(ax + tl * 0.5, tipY, ax + tl * 0.4, tipY);
        c.quadraticCurveTo(ax + tl * 0.5, tipY, ax + tl, tipY + th);
        c.quadraticCurveTo(ax + tl * 0.45, tipY + th * 0.6, rx, rb);
      } else if (tail === "Moon") {
        c.quadraticCurveTo(ax + tl * 0.7, tipY - th * 0.75, ax + tl, tipY - th);
        c.quadraticCurveTo(ax + tl * 0.35, tipY, ax + tl, tipY + th);
        c.quadraticCurveTo(ax + tl * 0.7, tipY + th * 0.75, rx, rb);
      } else if (tail === "Veil") {
        c.bezierCurveTo(ax + tl * 0.4, tipY - th * 0.95, ax + tl * 0.95, tipY - th * 0.9, ax + tl * 1.15, tipY - th * 0.05);
        c.bezierCurveTo(ax + tl * 0.95, tipY + th * 0.5, ax + tl * 0.8, tipY + th * 1.05, ax + tl * 0.45, tipY + th * 0.9);
        c.quadraticCurveTo(ax + tl * 0.15, tipY + th * 0.6, rx, rb);
      } else {
        c.quadraticCurveTo(ax + tl * 0.8, tipY - th * 0.85, ax + tl, tipY - th);
        c.quadraticCurveTo(ax + tl * 0.8, tipY, ax + tl, tipY + th);
        c.quadraticCurveTo(ax + tl * 0.8, tipY + th * 0.85, rx, rb);
      }
      c.closePath();
      c.fill();
      c.stroke();

      // Dorsal sail, anchored on the actual back line.
      const fh = L * (0.10 + body.tall * 0.30);
      c.beginPath();
      c.moveTo(px(0.34), topY(0.34));
      c.quadraticCurveTo(px(0.52), topY(0.5) - fh * 1.7, px(0.74), topY(0.74));
      c.quadraticCurveTo(px(0.54), topY(0.54) - fh * 0.18, px(0.34), topY(0.34));
      c.closePath();
      c.fill();
      c.stroke();

      // Anal fin under the rear half.
      c.beginPath();
      c.moveTo(px(0.58), botY(0.58));
      c.quadraticCurveTo(px(0.7), botY(0.7) + fh * 1.2, px(0.84), botY(0.84));
      c.quadraticCurveTo(px(0.7), botY(0.7) + fh * 0.14, px(0.58), botY(0.58));
      c.closePath();
      c.fill();
      c.stroke();
      c.globalAlpha = base;

      // Body outline: filled with the skin, then edged for definition.
      const N = 20;
      const shape = new Path2D();
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        if (i === 0) shape.moveTo(px(u), topY(u)); else shape.lineTo(px(u), topY(u));
      }
      for (let i = N; i >= 0; i--) {
        const u = i / N;
        shape.lineTo(px(u), botY(u));
      }
      shape.closePath();
      c.save();
      c.clip(shape);
      paintSkin(c, gene, L, body, base, shape);
      c.restore();
      c.strokeStyle = edge;
      c.lineWidth = Math.max(0.9, L * 0.015);
      c.stroke(shape);

      // Pectoral fin, rowing beside the gills.
      const pu = 0.32;
      c.save();
      c.translate(px(pu), wave(pu) + halfHeight(body, pu) * L * 0.5);
      c.rotate(Math.sin(t) * 0.35 + 0.55);
      c.fillStyle = col.a;
      c.globalAlpha = base * 0.85;
      c.beginPath();
      c.ellipse(L * 0.08, 0, L * 0.1, L * 0.04, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = edge;
      c.lineWidth = finLine;
      c.stroke();
      c.restore();
      c.globalAlpha = base;

      // Gill line and face.
      c.strokeStyle = "rgba(8,22,38,0.22)";
      c.lineWidth = finLine;
      c.beginPath();
      c.moveTo(px(0.26), topY(0.26) + dh * 0.12);
      c.quadraticCurveTo(px(0.20), wave(0.22), px(0.26), botY(0.26) - dh * 0.12);
      c.stroke();

      const eu = 0.17;
      const ex = px(eu);
      const ey = wave(eu) - halfHeight(body, eu) * L * 0.42;
      const er = Math.max(1.5, L * 0.05);
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(ex, ey, er, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#10141c";
      c.beginPath();
      c.arc(ex - er * 0.18, ey, er * 0.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.beginPath();
      c.arc(ex - er * 0.42, ey - er * 0.36, er * 0.2, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "rgba(8,22,38,0.3)";
      c.lineWidth = Math.max(0.9, L * 0.014);
      c.beginPath();
      c.moveTo(px(0.015), wave(0.02));
      c.quadraticCurveTo(px(0.06), wave(0.05) + dh * 0.22, px(0.11), wave(0.08) + dh * 0.16);
      c.stroke();
    }

    // ---- reef population ---------------------------------------------------
    const fish = [];          // everything currently swimming
    let myId = null;          // this viewer's fish id in the shared world
    let myGene = null;        // last released design
    let draft = randomGene(); // design being edited in the sheet

    function makeFish(gene, opts) {
      const o = opts || {};
      const z = o.z != null ? o.z : 0.45 + Math.random() * 0.55;
      return {
        id: o.id || null,
        gene: gene,
        by: o.by || null,
        wild: !!o.wild,
        mine: !!o.mine,
        pending: false,
        x: o.x != null ? o.x : Math.random() * W,
        y: o.y != null ? o.y : lerp(H * 0.16, floorY() - 26, Math.random()),
        z: z,
        angle: Math.random() * Math.PI * 2,
        speed: (26 + Math.random() * 22) * SIZES[gene.s].k * 0.85,
        dash: 0,
        beat: 1,
        phase: Math.random() * Math.PI * 2,
        tx: Math.random() * W,
        ty: lerp(H * 0.16, floorY() - 26, Math.random()),
        retarget: 0,
        chomp: 0,
        fresh: 0               // fades in, so arrivals never pop
      };
    }

    function newTarget(f) {
      f.tx = 30 + Math.random() * (W - 60);
      f.ty = lerp(H * 0.14, floorY() - 24, Math.random());
      f.retarget = 1800 + Math.random() * 3600;
    }

    // Wild locals keep the tank alive when the reef is quiet or offline, and
    // make room as real fish arrive.
    function stockWild() {
      const real = fish.filter((f) => !f.wild).length;
      const want = clamp(7 - real, 0, 7);
      const have = fish.filter((f) => f.wild);
      for (let i = have.length; i < want; i++) fish.push(makeFish(randomGene(), { wild: true }));
      for (let i = want; i < have.length; i++) {
        const idx = fish.indexOf(have[i]);
        if (idx >= 0) fish.splice(idx, 1);
      }
    }

    // ---- shared world ------------------------------------------------------
    const REEF = "reef";
    const MAX_REEF = 22;      // keep the tank readable (and cheap) on phones
    let reefOnline = true;
    let syncing = false;

    // The snapshot shape is not pinned by the contract, so read it defensively.
    function readSnapshot(snap) {
      if (!snap) return [];
      let raw = Array.isArray(snap) ? snap
        : snap.objects || snap.items || snap.entries || snap.records ||
          (snap.state && (snap.state.objects || snap.state.items)) ||
          (snap.data && (snap.data.objects || snap.data.items || snap.data.entries)) || [];
      if (!Array.isArray(raw) && raw && typeof raw === "object") {
        raw = Object.keys(raw).map((k) => ({ id: k, object: raw[k] }));
      }
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (const e of raw) {
        if (!e || typeof e !== "object") continue;
        const payload = e.object || e.data || e.value || e.state || e.payload || e;
        const gene = decode(payload);
        if (!gene) continue;
        const id = String(e.id || e.objectId || e.key || payload.id || "");
        if (!id) continue;
        const user = e.user || e.author || e.by || e.creator || null;
        let by = null;
        if (typeof user === "string") by = user;
        else if (user) by = user.handle || user.username || user.displayName || user.name || null;
        by = by ? String(by).slice(0, 18) : null;
        const mine = !!(e.self || e.mine || e.isSelf || e.isViewer || e.you ||
          (user && typeof user === "object" && (user.self || user.isViewer)));
        out.push({ id: id, gene: gene, by: by, mine: mine });
        if (out.length >= 600) break;    // bounded work on a big reef
      }
      return out;
    }

    // The reef can hold more fish than a phone should draw. Show a stable
    // window of it — offset per session so different visitors meet different
    // neighbours — and always keep this viewer's own fish in view.
    const windowOffset = Math.random();
    function pickVisible(list) {
      if (list.length <= MAX_REEF) return list;
      const own = [];
      const rest = [];
      for (const e of list) (e.mine || e.id === myId ? own : rest).push(e);
      const need = Math.max(0, MAX_REEF - own.length);
      const start = Math.floor(windowOffset * rest.length);
      const rotated = rest.slice(start).concat(rest.slice(0, start));
      return own.concat(rotated.slice(0, need));
    }

    // Reconcile a snapshot into the tank without teleporting fish that are
    // already swimming.
    function mergeReef(list) {
      const seen = Object.create(null);
      for (const entry of list) {
        seen[entry.id] = true;
        if (entry.mine && !myId) myId = entry.id;
        const mine = entry.mine || entry.id === myId;
        const existing = fish.find((f) => f.id === entry.id);
        if (existing) {
          existing.gene = entry.gene;
          existing.by = entry.by;
          existing.mine = mine;
          existing.wild = false;
          existing.pending = false;
        } else {
          const rnd = seeded(hashId(entry.id));
          fish.push(makeFish(entry.gene, {
            id: entry.id, by: entry.by, mine: mine,
            x: 40 + rnd() * (W - 80),
            y: lerp(H * 0.16, floorY() - 26, rnd()),
            z: 0.45 + rnd() * 0.55
          }));
        }
        // The platform can tell us a fish is ours on a device that has no
        // local record of it — adopt that design so editing continues to work.
        // Never while the designer is open, or it would rewrite a live edit.
        if (mine && !myGene && !sheetOpen) {
          myGene = entry.gene;
          draft = Object.assign({}, entry.gene);
          makeBtn.textContent = "🎨 Edit your fish";
          syncSheet();
        }
      }
      // Drop reef fish the world no longer has — but never this viewer's own,
      // and never one just released that the snapshot has not caught up with.
      for (let i = fish.length - 1; i >= 0; i--) {
        const f = fish[i];
        if (!f.wild && f.id && !seen[f.id] && !f.pending && !f.mine) fish.splice(i, 1);
      }
      stockWild();
      refreshCount();
    }

    async function pullReef() {
      if (syncing) return;
      syncing = true;
      countChip.style.opacity = "0.55";
      try {
        const snap = await ctx.memory.world(REEF).get();
        mergeReef(pickVisible(readSnapshot(snap)));
        reefOnline = true;
      } catch (err) {
        reefOnline = false;
        stockWild();
        ctx.platform.error({ where: "reef_get", message: String(err) });
      } finally {
        syncing = false;
        countChip.style.opacity = "1";
        refreshCount();
      }
    }

    // A write can be refused (rate limit, moderation). Assume it landed only
    // when nothing in the reply says otherwise.
    function accepted(res) {
      if (!res) return true;
      if (res.ok === false || res.accepted === false || res.rejected === true) return false;
      const status = res.status || res.state || (res.data && res.data.status);
      if (typeof status === "string" && /reject|denied|limit|refus|fail|error/i.test(status)) return false;
      return true;
    }

    async function releaseDraft() {
      const gene = Object.assign({}, draft);
      const id = myId || newId();
      let res = null;
      try {
        res = await ctx.memory.world(REEF).mutate({ id: id, object: encode(gene) });
      } catch (err) {
        ctx.platform.error({ where: "reef_mutate", message: String(err) });
        return { ok: false, offline: true };
      }
      if (!accepted(res)) return { ok: false, offline: false };

      myId = id;
      myGene = gene;
      reefOnline = true;
      try { await ctx.storage.set("mine", { id: id, gene: gene }); } catch (e) { /* storage is a nicety */ }

      const existing = fish.find((f) => f.id === id);
      if (existing) {
        existing.gene = gene;
        existing.mine = true;
        splash(existing.x, existing.y);
      } else {
        const f = makeFish(gene, { id: id, mine: true, x: W * 0.5, y: H * 0.45, z: 0.85 });
        f.pending = true;   // keep it until a snapshot confirms it
        fish.push(f);
        splash(f.x, f.y);
      }
      stockWild();
      refreshCount();
      return { ok: true };
    }

    // ---- food, bubbles, sparkles ------------------------------------------
    const flakes = [];
    const bubbles = [];
    const sparks = [];
    let lastMunch = -1e9;

    function feed(x, y) {
      for (let i = 0; i < 3; i++) {
        if (flakes.length > 26) break;
        flakes.push({
          x: x + (Math.random() - 0.5) * 26,
          y: y + (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 8,
          vy: 8 + Math.random() * 10,
          life: 11000,
          hue: ["#ffd98a", "#ffb26b", "#c9f08a"][randInt(3)],
          spin: Math.random() * Math.PI
        });
      }
      puff(x, y, 3, 18);
    }

    // Bubbles are capped so repeated tapping cannot fog up the tank.
    function puff(x, y, count, spread) {
      for (let i = 0; i < count; i++) {
        if (bubbles.length > 34) return;
        bubbles.push({
          x: x + (Math.random() - 0.5) * spread, y: y,
          r: 1.2 + Math.random() * 2.4, v: 20 + Math.random() * 22, w: Math.random() * 6
        });
      }
    }

    function splash(x, y) {
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 40 + Math.random() * 120;
        sparks.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 900, max: 900, c: "#bff4ff" });
      }
      puff(x, y, 8, 40);
    }

    // ---- chrome ------------------------------------------------------------
    const CHIP_CSS =
      "pointer-events:auto;min-width:42px;height:42px;padding:0 12px;border-radius:14px;border:none;" +
      "font:600 15px/1 " + FONT + ";color:#eaf6ff;background:rgba(6,32,52,0.55);" +
      "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;" +
      "justify-content:center;gap:6px;cursor:pointer;touch-action:manipulation;transition:opacity 0.2s;" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.32);";

    const chipHtml = (id, label, aria, extra) =>
      '<button data-id="' + id + '" aria-label="' + aria + '" style="' + CHIP_CSS + (extra || "") + '">' + label + "</button>";

    // Trait chips inside the designer.
    const TCHIP =
      "flex:0 0 auto;border-radius:12px;border:2px solid transparent;cursor:pointer;touch-action:manipulation;" +
      "font:600 13px/1 " + FONT + ";color:#eaf6ff;background:rgba(255,255,255,0.10);" +
      "min-height:38px;padding:0 12px;display:flex;align-items:center;justify-content:center;" +
      "transition:transform 0.12s ease-out;";

    function traitRowHtml(title, key, items, cell) {
      let html = '<div style="margin-top:10px;">' +
        '<div style="font:700 11px/1 ' + FONT + ';letter-spacing:0.09em;text-transform:uppercase;' +
        'opacity:0.55;margin-bottom:7px;">' + title + "</div>" +
        '<div style="display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:2px 0 3px;">';
      items.forEach((item, i) => {
        html += '<button data-trait="' + key + '" data-i="' + i + '" ' + cell(item) + "</button>";
      });
      return html + "</div></div>";
    }

    const BAR = "position:absolute;left:12px;right:12px;display:flex;pointer-events:none;";

    // Chrome is declared as markup on the runtime-owned root and wired up by
    // data-id. Every label here is a literal from this file — nothing from the
    // shared world ever reaches innerHTML.
    ui.innerHTML =
      '<div style="' + BAR + "top:calc(" + ctx.safeArea.top + 'px + 12px);gap:10px;align-items:center;">' +
        chipHtml("help", "?", "How it works") +
        chipHtml("sound", "\u266a", "Toggle sound") +
        '<div style="flex:1;"></div>' +
        chipHtml("count", "\ud83d\udc20 \u2014", "Fish in the reef \u2014 tap to look for new arrivals",
          "pointer-events:auto;") +
      "</div>" +

      // Centred rows rather than left:50% + translate, so long labels get the
      // full container width instead of half of it and never wrap.
      '<div style="' + BAR + "bottom:calc(" + ctx.safeArea.bottom + 'px + 26px);justify-content:center;">' +
        '<button data-id="make" style="pointer-events:auto;white-space:nowrap;padding:14px 22px;border-radius:22px;' +
        "border:none;cursor:pointer;touch-action:manipulation;font:700 16px/1 " + FONT + ";color:#04202f;" +
        "background:linear-gradient(180deg,#8ff0d8,#37c8b0);" +
        'box-shadow:0 6px 22px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.6);">\ud83c\udfa8 Make your fish</button>' +
      "</div>" +

      '<div style="' + BAR + "top:calc(" + ctx.safeArea.top + 'px + 66px);justify-content:center;">' +
        '<div data-id="toast" style="opacity:0;transition:opacity 0.25s;padding:10px 16px;border-radius:16px;' +
        "background:rgba(5,26,42,0.9);color:#eaf6ff;font:600 14px/1.3 " + FONT + ";text-align:center;" +
        'box-shadow:0 4px 18px rgba(0,0,0,0.4);"></div>' +
      "</div>" +

      // ---- designer sheet --------------------------------------------------
      '<div data-id="sheetWrap" style="position:absolute;inset:0;display:none;align-items:center;' +
      "justify-content:center;padding:16px;pointer-events:auto;opacity:0;transition:opacity 0.18s ease-out;" +
      'background:rgba(3,18,30,0.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);">' +
        '<div data-id="sheet" style="width:100%;max-width:360px;max-height:88%;overflow:auto;' +
        "-webkit-overflow-scrolling:touch;padding:16px 16px calc(" + ctx.safeArea.bottom + "px + 16px);" +
        "border-radius:24px;background:linear-gradient(180deg,rgba(12,48,74,0.98),rgba(6,26,44,0.98));" +
        "color:#eaf6ff;font-family:" + FONT + ";box-shadow:0 16px 50px rgba(0,0,0,0.55);" +
        'transform:scale(0.96);transition:transform 0.18s ease-out;">' +

          '<canvas data-id="preview" style="width:100%;height:126px;display:block;border-radius:16px;' +
          'background:rgba(4,40,64,0.75);"></canvas>' +

          '<div style="display:flex;align-items:center;gap:10px;margin:12px 0 4px;">' +
            '<div data-id="name" style="flex:1;font:800 19px/1.2 ' + FONT + ';min-width:0;overflow:hidden;' +
            'text-overflow:ellipsis;white-space:nowrap;"></div>' +
            chipHtml("dice", "\ud83c\udfb2", "New name", "flex:0 0 auto;background:rgba(255,255,255,0.12);") +
          "</div>" +

          traitRowHtml("Body", "b", BODIES, (item) => 'style="' + TCHIP + '">' + item.label) +
          traitRowHtml("Colour", "c", COLORS, (item) =>
            'aria-label="' + item.label + '" style="' + TCHIP + "width:38px;padding:0;background:linear-gradient(140deg," +
            item.a + "," + item.b + ');">') +
          traitRowHtml("Pattern", "p", PATTERNS, (item) => 'style="' + TCHIP + '">' + item.label) +
          traitRowHtml("Tail", "t", TAILS, (item) => 'style="' + TCHIP + '">' + item.label) +
          traitRowHtml("Size", "s", SIZES, (item) => 'style="' + TCHIP + 'width:38px;padding:0;">' + item.label) +

          '<div style="margin-top:12px;font:500 13px/1.45 ' + FONT + ';opacity:0.62;">' +
          "Your fish joins the reef everyone shares. Come back and redesign it any time.</div>" +

          '<div style="display:flex;gap:10px;margin-top:14px;">' +
            '<button data-id="surprise" style="flex:0 0 auto;padding:14px 16px;border-radius:18px;border:none;' +
            "cursor:pointer;touch-action:manipulation;font:700 15px/1 " + FONT + ";color:#eaf6ff;" +
            'background:rgba(255,255,255,0.13);">\ud83c\udfb2 Surprise</button>' +
            '<button data-id="release" style="flex:1;padding:14px 16px;border-radius:18px;border:none;' +
            "cursor:pointer;touch-action:manipulation;font:800 16px/1 " + FONT + ";color:#04202f;" +
            "background:linear-gradient(180deg,#8ff0d8,#37c8b0);" +
            'box-shadow:inset 0 1px 0 rgba(255,255,255,0.6);">Release \ud83d\udc20</button>' +
          "</div>" +

          '<div data-id="sheetMsg" style="margin-top:10px;font:600 13px/1.4 ' + FONT + ';color:#ffd27f;' +
          'display:none;"></div>' +
        "</div>" +
      "</div>";

    const el = (id) => ui.querySelector('[data-id="' + id + '"]');
    const helpBtn = el("help");
    const soundBtn = el("sound");
    const countChip = el("count");
    const makeBtn = el("make");
    const toast = el("toast");
    const sheetWrap = el("sheetWrap");
    const sheet = el("sheet");
    const preview = el("preview");
    const pv = preview.getContext("2d");
    const nameLabel = el("name");
    const diceBtn = el("dice");
    const surpriseBtn = el("surprise");
    const releaseBtn = el("release");
    const sheetMsg = el("sheetMsg");

    const rows = ["b", "c", "p", "t", "s"].map((key) => ({
      key: key,
      nodes: Array.prototype.slice.call(sheet.querySelectorAll('[data-trait="' + key + '"]'))
    }));

    // One delegated handler for every trait chip.
    ctx.listen(sheet, "click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-trait]") : null;
      if (!b) return;
      const key = b.getAttribute("data-trait");
      const i = Number(b.getAttribute("data-i"));
      draft[key] = i;
      syncSheet();
      tick("light");
      ctx.platform.interact({ type: "design", trait: key, value: i });
    });

    ctx.listen(sheetWrap, "pointerdown", (e) => { if (e.target === sheetWrap) closeSheet(); });

    function refreshCount() {
      const n = fish.filter((f) => !f.wild).length;
      countChip.textContent = reefOnline ? "\ud83d\udc20 " + n : "\ud83d\udc20 solo";
    }

    let toastToken = 0;
    function say(text) {
      toast.textContent = text;
      toast.style.opacity = "1";
      const mine = ++toastToken;
      ctx.timeout(() => { if (mine === toastToken) toast.style.opacity = "0"; }, 2600);
    }

    function syncSheet() {
      nameLabel.textContent = nameOf(draft);
      for (const row of rows) {
        row.nodes.forEach((n, i) => {
          const on = draft[row.key] === i;
          n.style.borderColor = on ? "#8ff0d8" : "transparent";
          n.style.transform = on ? "translateY(-2px)" : "none";
        });
      }
    }

    let sheetOpen = false;
    function openSheet() {
      sheetOpen = true;
      sheetMsg.style.display = "none";
      sheetWrap.style.display = "flex";
      releaseBtn.disabled = false;
      releaseBtn.textContent = myId ? "Update 🐠" : "Release 🐠";
      syncSheet();
      ctx.timeout(() => {
        if (!sheetOpen) return;
        sheetWrap.style.opacity = "1";
        sheet.style.transform = "scale(1)";
      }, 16);
      ctx.platform.interact({ type: "open_designer" });
    }
    function closeSheet() {
      if (!sheetOpen) return;
      sheetOpen = false;
      sheetWrap.style.opacity = "0";
      sheet.style.transform = "scale(0.96)";
      ctx.timeout(() => { if (!sheetOpen) sheetWrap.style.display = "none"; }, 200);
    }

    ctx.listen(diceBtn, "click", () => {
      draft.na = randInt(ADJ.length);
      draft.nb = randInt(NOUN.length);
      syncSheet();
      tick("light");
    });
    ctx.listen(surpriseBtn, "click", () => {
      draft = randomGene();
      syncSheet();
      tick("medium");
      ctx.platform.interact({ type: "surprise" });
    });
    ctx.listen(releaseBtn, "click", async () => {
      if (releaseBtn.disabled) return;
      releaseBtn.disabled = true;
      releaseBtn.textContent = "Releasing…";
      sheetMsg.style.display = "none";
      const wasFirst = !myId;
      const out = await releaseDraft();
      if (out.ok) {
        closeSheet();
        makeBtn.textContent = "🎨 Edit your fish";
        say(wasFirst ? nameOf(myGene) + " joined the reef!" : nameOf(myGene) + " updated.");
        tick("success");
        chime("success");
        ctx.platform.interact({ type: "world_mutation" });
        if (wasFirst) {
          ctx.platform.milestone("first_release");
          ctx.platform.complete({ type: "released" });
        }
        ctx.timeout(() => pullReef(), 2500);
      } else {
        releaseBtn.disabled = false;
        releaseBtn.textContent = myId ? "Update 🐠" : "Release 🐠";
        sheetMsg.textContent = out.offline
          ? "The reef is out of reach right now. Your design is safe — try again in a moment."
          : "The reef turned that one away (you may have released a lot today). Try again later.";
        sheetMsg.style.display = "block";
        tick("warning");
      }
    });
    ctx.listen(makeBtn, "click", () => {
      begin();
      openSheet();
      tick("light");
    });

    // ---- help --------------------------------------------------------------
    ui.insertAdjacentHTML("beforeend",
      '<div data-id="helpPanel" style="position:absolute;inset:0;display:none;align-items:center;' +
      "justify-content:center;padding:22px;pointer-events:auto;background:rgba(3,18,30,0.8);" +
      'backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);">' +
      '<div style="max-width:330px;color:#eaf6ff;font:400 15px/1.55 ' + FONT + ';">' +
      '<h2 style="font:800 22px/1.2 ' + FONT + ';margin-bottom:12px;">Tiny Reef</h2>' +
      '<ul style="list-style:none;display:grid;gap:9px;">' +
      "<li>• Everyone shares this one reef — most of these fish were made by other people.</li>" +
      "<li>• Tap <b>🎨 Make your fish</b> to design yours, then release it into the water.</li>" +
      "<li>• Tap a fish to see its name and who made it. Yours has a soft glow.</li>" +
      "<li>• Tap open water to sprinkle food and watch the shoal chase it.</li>" +
      "<li>• Tap <b>🐠</b> up top to look for newly arrived fish.</li>" +
      "<li>• A few wild fish keep the reef company when it is quiet.</li>" +
      "</ul>" +
      '<p style="margin-top:16px;opacity:0.65;">Tap anywhere to close.</p></div></div>');
    const help = el("helpPanel");
    ctx.listen(help, "click", () => { help.style.display = "none"; });
    ctx.listen(helpBtn, "click", () => {
      help.style.display = help.style.display === "none" ? "flex" : "none";
      tick("light");
    });

    // ---- sound -------------------------------------------------------------
    let music = null;
    let muted = false;
    async function startMusic() {
      if (music || muted || !ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({ preset: "ambient", volume: 0.34, fadeInMs: 1800, intensity: 0.35 });
      } catch (err) {
        ctx.platform.error({ where: "music", message: String(err) });
      }
    }
    function chime(name) {
      if (muted || !ctx.capabilities.backgroundMusic) return;
      try {
        const p = music ? music.sting(name) : ctx.music.sting(name);
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* sound is optional */ }
    }
    function tick(strength) {
      if (ctx.capabilities.haptics) ctx.platform.haptic(strength || "light");
    }
    ctx.listen(soundBtn, "click", async () => {
      muted = !muted;
      soundBtn.textContent = muted ? "🔇" : "♪";
      soundBtn.style.opacity = muted ? "0.55" : "1";
      if (muted) {
        if (music) { try { music.stop({ fadeOutMs: 600 }); } catch (e) {} music = null; }
      } else {
        await startMusic();
      }
      tick("light");
    });

    // ---- input -------------------------------------------------------------
    let started = false;
    function begin() {
      if (started) return;
      started = true;
      ctx.platform.start();
      startMusic();
    }

    const labels = []; // floating name tags from tapped fish

    function hitTest(x, y) {
      let best = null;
      let bestD = Infinity;
      for (const f of fish) {
        const r = Math.max(26, baseLen() * SIZES[f.gene.s].k * f.z * 0.62);
        const d = Math.hypot(f.x - x, f.y - y);
        if (d < r && d < bestD) { best = f; bestD = d; }
      }
      return best;
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      begin();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      if (hit) {
        hit.dash = 900;                   // startled dart
        hit.beat = 2.1;
        newTarget(hit);
        labels.push({ f: hit, life: 2600 });
        tick("light");
        chime("tap");
        ctx.platform.interact({ type: "tap_fish", mine: !!hit.mine, wild: !!hit.wild });
      } else {
        feed(x, y);
        tick("light");
        ctx.platform.interact({ type: "feed" });
      }
    }, { passive: false });

    ctx.listen(countChip, "click", () => {
      begin();
      say(reefOnline ? "Looking for new arrivals…" : "Trying the reef again…");
      pullReef();
      tick("light");
    });

    // ---- simulation --------------------------------------------------------
    // Nudge fish at similar depths apart so the shoal stays readable instead of
    // stacking into a pile.
    function separate() {
      const bl = baseLen();
      for (let i = 0; i < fish.length; i++) {
        const a = fish[i];
        const ar = bl * SIZES[a.gene.s].k * (0.55 + a.z * 0.55) * 0.42;
        for (let j = i + 1; j < fish.length; j++) {
          const b = fish[j];
          if (Math.abs(a.z - b.z) > 0.3) continue;   // different depths may overlap
          const min = ar + bl * SIZES[b.gene.s].k * (0.55 + b.z * 0.55) * 0.42;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > min * min || d2 < 0.02) continue;
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.18;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }

    function stepFish(f, dt, t) {
      // Goal: the nearest flake if one is close, otherwise a wander target.
      let goalX = f.tx;
      let goalY = f.ty;
      let hunting = null;
      let bestD = 190;
      for (const fl of flakes) {
        const d = Math.hypot(fl.x - f.x, fl.y - f.y);
        if (d < bestD) { bestD = d; hunting = fl; }
      }
      if (hunting) { goalX = hunting.x; goalY = hunting.y; }

      f.retarget -= dt;
      if (!hunting && (f.retarget <= 0 || Math.hypot(goalX - f.x, goalY - f.y) < 24)) newTarget(f);

      const want = Math.atan2(goalY - f.y, goalX - f.x);
      let diff = want - f.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = (hunting ? 3.4 : 1.7) * dt * 0.001;
      f.angle += clamp(diff, -turn, turn);

      f.dash = Math.max(0, f.dash - dt);
      const boost = (f.dash > 0 ? 2.6 : 1) * (hunting ? 1.7 : 1);
      const sp = f.speed * boost * (0.7 + f.z * 0.5);
      f.x += Math.cos(f.angle) * sp * dt * 0.001;
      f.y += Math.sin(f.angle) * sp * dt * 0.001 + Math.sin(t * 0.001 + f.phase) * 5 * dt * 0.001;
      f.beat = lerp(f.beat, hunting ? 1.7 : (f.dash > 0 ? 2.1 : 1), 0.05);
      f.chomp = Math.max(0, f.chomp - dt);
      f.fresh = Math.min(1, f.fresh + dt * 0.0012);

      // Soft walls. Pick a fresh random target rather than steering everyone at
      // the middle of the tank, which would slowly pile the whole shoal up.
      const m = 26;
      const top = H * 0.10;
      const bot = floorY() - 14;
      if (f.x < m || f.x > W - m || f.y < top || f.y > bot) {
        f.x = clamp(f.x, m, W - m);
        f.y = clamp(f.y, top, bot);
        if (f.retarget > 900) newTarget(f);
      }

      if (hunting && bestD < 16) {
        const idx = flakes.indexOf(hunting);
        if (idx >= 0) flakes.splice(idx, 1);
        f.chomp = 260;
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * Math.PI * 2;
          sparks.push({ x: f.x, y: f.y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 380, max: 380, c: "#ffe6a8" });
        }
        if (t - lastMunch > 550) { lastMunch = t; chime("coin"); }
      }
    }

    // ---- painting ----------------------------------------------------------
    function drawFish(f, t) {
      const len = baseLen() * SIZES[f.gene.s].k * (0.55 + f.z * 0.55);
      const facingLeft = Math.abs(f.angle) > Math.PI / 2;
      g.save();
      g.translate(f.x, f.y);
      g.rotate(f.angle);
      if (facingLeft) g.scale(1, -1);
      const pop = 1 + (f.chomp > 0 ? 0.12 * (f.chomp / 260) : 0);
      g.scale(pop, pop);
      g.globalAlpha = clamp(0.86 + f.z * 0.14, 0, 1) * (f.wild ? 0.94 : 1) * f.fresh;

      if (f.mine) {
        // A soft halo so you can always find your own fish.
        g.save();
        g.globalCompositeOperation = "lighter";
        const halo = g.createRadialGradient(0, 0, len * 0.1, 0, 0, len * 0.95);
        halo.addColorStop(0, "rgba(143,240,216,0.32)");
        halo.addColorStop(1, "rgba(143,240,216,0)");
        g.fillStyle = halo;
        g.beginPath();
        g.arc(0, 0, len * 0.95, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }

      drawFishLocal(g, f.gene, len, t * 0.006 * (1 + f.beat * 0.6) + f.phase, f.beat);
      g.restore();
      g.globalAlpha = 1;
    }

    function drawLabels(dt) {
      for (let i = labels.length - 1; i >= 0; i--) {
        const l = labels[i];
        l.life -= dt;
        if (l.life <= 0) { labels.splice(i, 1); continue; }
        const f = l.f;
        const name = nameOf(f.gene);
        const sub = f.mine ? "your fish" : f.wild ? "wild" : f.by ? "by " + f.by : "released by someone";
        const len = baseLen() * SIZES[f.gene.s].k * (0.55 + f.z * 0.55);
        const y = f.y - len * 0.75 - 16;
        g.save();
        g.globalAlpha = clamp(l.life / 600, 0, 1);
        g.textAlign = "center";
        g.font = "700 15px " + FONT;
        const nameW = g.measureText(name).width;
        g.font = "500 12px " + FONT;
        const subW = g.measureText(sub).width;
        const w = Math.max(nameW, subW) + 26;
        const x = clamp(f.x, w / 2 + 8, Math.max(w / 2 + 8, W - w / 2 - 8));
        const rx = x - w / 2;
        const ry = y - 34;
        const rr = 12;
        g.fillStyle = "rgba(4,22,36,0.86)";
        g.beginPath();
        g.moveTo(rx + rr, ry);
        g.arcTo(rx + w, ry, rx + w, ry + 44, rr);
        g.arcTo(rx + w, ry + 44, rx, ry + 44, rr);
        g.arcTo(rx, ry + 44, rx, ry, rr);
        g.arcTo(rx, ry, rx + w, ry, rr);
        g.closePath();
        g.fill();
        g.font = "700 15px " + FONT;
        g.fillStyle = f.mine ? "#8ff0d8" : "#eaf6ff";
        g.fillText(name, x, ry + 19);
        g.font = "500 12px " + FONT;
        g.fillStyle = "rgba(234,246,255,0.6)";
        g.fillText(sub, x, ry + 35);
        g.restore();
      }
    }

    function drawFlakes(dt) {
      for (let i = flakes.length - 1; i >= 0; i--) {
        const fl = flakes[i];
        fl.life -= dt;
        if (fl.life <= 0 || fl.y > floorY() + 6) { flakes.splice(i, 1); continue; }
        fl.vx += (Math.random() - 0.5) * 6 * dt * 0.001;
        fl.vx *= 0.99;
        fl.x += fl.vx * dt * 0.001 + Math.sin(fl.y * 0.05) * 0.25;
        fl.y += fl.vy * dt * 0.001;
        fl.spin += dt * 0.004;
        g.save();
        g.translate(fl.x, fl.y);
        g.rotate(fl.spin);
        g.globalAlpha = clamp(fl.life / 1400, 0, 1);
        g.fillStyle = fl.hue;
        g.fillRect(-2.5, -1.6, 5, 3.2);
        g.restore();
      }
      g.globalAlpha = 1;
    }

    function drawBubbles(dt, t) {
      for (const v of vents) {
        v.next -= dt;
        if (v.next <= 0) {
          v.next = 1400 + Math.random() * 3200;
          puff(v.x, floorY() + 8, 1, 10);
        }
      }
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.y -= b.v * dt * 0.001;
        if (b.y < -8) { bubbles.splice(i, 1); continue; }
        const x = b.x + Math.sin(t * 0.003 + b.w) * 4;
        g.strokeStyle = "rgba(210,245,255,0.55)";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, b.y, b.r, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.beginPath();
        g.arc(x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.4, 0, Math.PI * 2);
        g.fill();
      }
    }

    function drawSparks(dt) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        s.x += s.vx * dt * 0.001;
        s.y += s.vy * dt * 0.001;
        s.vy += 30 * dt * 0.001;
        s.vx *= 0.98;
        g.globalAlpha = clamp(s.life / s.max, 0, 1) * 0.9;
        g.fillStyle = s.c;
        g.beginPath();
        g.arc(s.x, s.y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      g.globalAlpha = 1;
    }

    const ordered = [];
    function paint(t, dt) {
      g.clearRect(0, 0, W, H);          // the backdrop layer shows through
      drawRays(t);
      drawKelp(t);
      drawMotes(dt);
      drawFlakes(dt);
      ordered.length = 0;
      for (const f of fish) ordered.push(f);
      ordered.sort((a, b) => a.z - b.z);   // far fish first
      for (const f of ordered) drawFish(f, t);
      drawBubbles(dt, t);
      drawSparks(dt);
      drawLabels(dt);
      if (vignette) {
        g.fillStyle = vignette;
        g.fillRect(0, 0, W, H);
      }
    }

    function drawPreview(t) {
      const dpr = ctx.dpr || 1;
      const w = preview.clientWidth || 300;
      const h = 126;
      if (preview.width !== Math.round(w * dpr) || preview.height !== Math.round(h * dpr)) {
        preview.width = Math.round(w * dpr);
        preview.height = Math.round(h * dpr);
      }
      pv.setTransform(dpr, 0, 0, dpr, 0, 0);
      const water = pv.createLinearGradient(0, 0, 0, h);
      water.addColorStop(0, "#0d5c82");
      water.addColorStop(1, "#062a47");
      pv.fillStyle = water;
      pv.fillRect(0, 0, w, h);
      // The tail extends past the body, so nudge left to centre the whole fish.
      const len = Math.min(w * 0.38, 124) * SIZES[draft.s].k / 1.34;
      pv.save();
      pv.translate(w * 0.5 - len * 0.16, h * 0.52 + Math.sin(t * 0.0016) * 5);
      pv.rotate(Math.sin(t * 0.0011) * 0.09);
      drawFishLocal(pv, draft, len, t * 0.006, 1);
      pv.restore();
    }

    // ---- boot --------------------------------------------------------------
    buildScene();
    stockWild();
    for (const f of fish) f.fresh = 1;    // the opening tank is already settled
    paint(0, 16);                          // a live first frame before ready()
    ctx.markVisualReady("reef");
    refreshCount();

    // Restore this viewer's fish so the sheet opens on their design.
    try {
      const saved = await ctx.storage.get("mine");
      if (saved && saved.gene) {
        const gene = decode(saved.gene);
        if (gene) {
          myGene = gene;
          draft = Object.assign({}, gene);
          myId = saved.id || null;
          makeBtn.textContent = "🎨 Edit your fish";
        }
      }
    } catch (e) { /* first visit, or storage unavailable */ }
    syncSheet();

    ctx.platform.ready();

    // Pull the shared reef right after the first frame, then keep it fresh.
    pullReef().then(() => {
      if (!reefOnline) say("Swimming solo — the shared reef is out of reach.");
    });
    ctx.interval(() => { if (!sheetOpen) pullReef(); }, 30000);

    ctx.onFrame((dtMs, timeMs) => {
      const dt = clamp(dtMs, 0, 60);
      if (W !== ctx.width || H !== ctx.height) {
        // Rescale the shoal with the tank, or a rotation squashes every fish
        // into the floor band the moment the soft walls clamp them.
        const sx = W > 0 ? ctx.width / W : 1;
        const sy = H > 0 ? ctx.height / H : 1;
        W = ctx.width;
        H = ctx.height;
        for (const f of fish) {
          f.x *= sx; f.y *= sy;
          f.tx *= sx; f.ty *= sy;
        }
        buildScene();
      }
      for (const f of fish) stepFish(f, dt, timeMs);
      separate();
      paint(timeMs, dt);
      if (sheetOpen) drawPreview(timeMs);
    });
  }
};
