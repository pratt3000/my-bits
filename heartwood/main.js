// Heartwood — a generative Plethora Bit.
//
// The tree is not drawn, and it is not a fractal either. A cloud of invisible
// points is scattered into the air, and the wood grows toward whichever points
// are nearest, consuming them as it arrives. That single rule — reach for the
// light you can actually reach — produces trunks, forks, competition between
// limbs, and a crown that fills its space, because it is roughly the rule real
// trees use. (Space colonization, after Runions et al.)
//
// Tap for a new seed: a new crown, a new season, a new tree.

window.plethoraBit = {
  meta: {
    title: "Heartwood",
    runtime: "plethora-bit@2",
    tags: ["generative", "art", "nature", "tree", "calm", "sensory", "seasons"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    const TAU = Math.PI * 2;
    const NODE_CAP = 2400;
    const LEAF_CAP = 560;
    const GROW_MS = 2600; // how long the tree takes to reach full size

    // ---- seeded randomness --------------------------------------------------
    function mulberry32(a) {
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const SEED_MAX = 0xffffff;
    const randomSeed = () => Math.floor(Math.random() * SEED_MAX);
    const seedLabel = (s) => s.toString(36).toUpperCase().padStart(5, "0");

    // ---- seasons ------------------------------------------------------------
    // sky: top and bottom colour as RGB. bark: base and tip colour. leaf: the crown's
    // palette, empty for a bare tree. fleck: what drifts through the air.
    const SEASONS = [
      {
        name: "Spring", sky: [[207, 228, 242], [243, 232, 236]], ground: [216, 207, 196],
        bark: [[74, 59, 51], [125, 100, 85]], leaf: ["#f9c7d8", "#fbe0e8", "#f2a8c0", "#ffffff"],
        fleck: "#f9c7d8", flecks: 46, glow: 0
      },
      {
        name: "Summer", sky: [[143, 198, 232], [223, 240, 228]], ground: [199, 201, 166],
        bark: [[62, 53, 41], [111, 96, 70]], leaf: ["#2f6b34", "#3f8c40", "#6aa84f", "#8fbc5a"],
        fleck: "#f6f0b8", flecks: 30, glow: 0
      },
      {
        name: "Autumn", sky: [[232, 201, 160], [245, 227, 205]], ground: [194, 168, 132],
        bark: [[58, 44, 34], [107, 82, 64]], leaf: ["#c8571f", "#e08b26", "#f0bb47", "#9c3b1c"],
        fleck: "#e08b26", flecks: 52, glow: 0
      },
      {
        name: "Winter", sky: [[157, 179, 196], [228, 236, 242]], ground: [232, 238, 242],
        bark: [[47, 49, 56], [88, 92, 102]], leaf: [],
        fleck: "#ffffff", flecks: 70, glow: 0
      },
      {
        name: "Jade", sky: [[13, 43, 42], [22, 73, 67]], ground: [10, 32, 31],
        bark: [[27, 32, 29], [63, 83, 71]], leaf: ["#5fd6a8", "#9ff0c8", "#38b58c", "#d8fff0"],
        fleck: "#9ff0c8", flecks: 34, glow: 0.5
      },
      {
        name: "Ember", sky: [[20, 10, 8], [58, 20, 12]], ground: [22, 11, 7],
        bark: [[20, 15, 13], [58, 42, 34]], leaf: ["#ff6b2c", "#ffb347", "#e03a1f", "#fff0b8"],
        fleck: "#ff9d4d", flecks: 58, glow: 0.85
      },
      {
        name: "Ghost", sky: [[11, 16, 38], [28, 36, 80]], ground: [10, 14, 30],
        bark: [[26, 31, 51], [61, 70, 112]], leaf: ["#dfe7ff", "#ffffff", "#a8b8ee", "#c9d4ff"],
        fleck: "#dfe7ff", flecks: 44, glow: 0.6
      },
      {
        name: "Ink", sky: [[239, 236, 230], [255, 255, 255]], ground: [221, 216, 206],
        bark: [[20, 20, 20], [74, 74, 74]], leaf: ["#1c1c1c", "#3d3d3d", "#6a6a6a", "#8f8f8f"],
        fleck: "#9a9a9a", flecks: 22, glow: 0
      }
    ];

    // ---- surfaces -----------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const hasOffscreen = typeof OffscreenCanvas === "function";

    // ---- run state ----------------------------------------------------------
    let seed = randomSeed();
    let season = SEASONS[0];
    let nodes = [];      // { x, y, parent, gen, width }
    let segments = [];   // drawable, ordered by generation
    let leaves = [];
    let flecks = [];
    let base = { x: 0, y: 0 };
    let crown = { cx: 0, cy: 0, rx: 1, ry: 1 };
    let maxGen = 1;
    let tree = null, treeG = null, bakeScale = 1;
    let bg = null;       // baked sky + ground
    let wg = null;       // persistent space-colonization state
    let drawn = 0;       // how many segments have been committed to the bake
    let growth = 0;      // 0..1
    let clock = 0;
    let started = false, music = null;
    let lastW = 0, lastH = 0;

    // ---- growing the tree ---------------------------------------------------
    // Space colonization: scatter attractors, let the nearest wood reach for
    // them, and delete each one once a branch arrives. Competition between
    // limbs for the same points is what produces a believable silhouette.
    function grow(r) {
      const groundY = ctx.height - ctx.safeArea.bottom - Math.max(38, ctx.height * 0.075);
      const skyTop = ctx.safeArea.top + 70;
      const usableH = Math.max(120, groundY - skyTop);

      const shapes = ["round", "vase", "column", "weeping", "windswept"];
      const shape = shapes[Math.floor(r() * shapes.length)];
      const lean = (r() - 0.5) * ctx.width * 0.1;

      base = { x: ctx.width / 2 + lean * 0.5, y: groundY };

      const crownH = usableH * (0.6 + r() * 0.2);
      crown = {
        cx: ctx.width / 2 + lean,
        cy: groundY - usableH * (0.42 + r() * 0.16),
        rx: ctx.width * (0.3 + r() * 0.14),
        ry: crownH * 0.5
      };
      if (shape === "column") { crown.rx *= 0.58; crown.ry *= 1.16; }
      if (shape === "vase") { crown.rx *= 1.12; crown.ry *= 0.78; }
      if (shape === "weeping") { crown.ry *= 0.9; crown.cy -= usableH * 0.03; }
      if (shape === "windswept") { crown.cx += ctx.width * 0.07; crown.rx *= 0.92; }

      const scaleUnit = Math.min(crown.rx, crown.ry);
      const step = Math.max(2.6, scaleUnit * 0.055);
      const attract = step * 5.2;
      const kill = step * 1.55;

      // Attractor cloud, rejection-sampled into the crown's shape.
      const want = 760 + Math.floor(r() * 520);
      const atts = [];
      for (let guard = 0; atts.length < want && guard < want * 26; guard++) {
        const u = r() * 2 - 1, v = r() * 2 - 1;
        if (u * u + v * v > 1) continue;
        let ax = crown.cx + u * crown.rx;
        let ay = crown.cy + v * crown.ry;
        // Vase hollows out the middle; weeping pulls the cloud down at the edges.
        if (shape === "vase" && u * u + v * v < 0.2) continue;
        if (shape === "weeping") ay += Math.abs(u) * crown.ry * 0.55;
        if (ay > groundY - step * 2) continue;
        atts.push({ x: ax, y: ay, live: true });
      }

      nodes = [{ x: base.x, y: base.y, parent: -1, gen: 0 }];

      // Uniform grid over the nodes so each attractor only tests its neighbours,
      // as a plain object plus flat arrays: integer-keyed bracket lookup and a
      // generation stamp beat a Map and need no clearing between iterations.
      const cellSize = attract;
      const grid = {};
      const cellKey = (ix, iy) => (ix * 73856093) ^ (iy * 19349663);
      function indexNode(i) {
        const k = cellKey(Math.floor(nodes[i].x / cellSize), Math.floor(nodes[i].y / cellSize));
        const bucket = grid[k];
        if (bucket) bucket.push(i); else grid[k] = [i];
      }
      indexNode(0);

      // All of this is kept rather than discarded when the first growth run
      // finishes, so painting light later can add attractors and let the same
      // machinery carry on from where it stopped.
      wg = {
        rng: r, step, cellSize, grid, cellKey, indexNode, atts, scaleUnit,
        attract2: attract * attract,
        kill2: kill * kill,
        remaining: atts.length,
        gen: 0,
        bootstrap: true,   // the trunk may still climb toward the crown
        // Accumulated pull per node. pullGen marks the generation that last
        // wrote an entry, so the arrays never need clearing between iterations.
        pullX: new Float32Array(NODE_CAP + 8),
        pullY: new Float32Array(NODE_CAP + 8),
        pullGen: new Int32Array(NODE_CAP + 8),
        touched: []
      };

      growGenerations(300);
      wg.bootstrap = false;
      finalizeTree();
      leaves = [];
      syncLeaves(r);
      buildFlecks(r);
    }

    // One or more generations of space colonization against the current
    // attractor cloud. Returns how many nodes it managed to add.
    function growGenerations(count) {
      const w = wg;
      if (!w) return 0;
      const r = w.rng;
      const before = nodes.length;

      for (let it = 0; it < count && w.remaining > 0 && nodes.length < NODE_CAP; it++) {
        w.gen++;
        const gen = w.gen;
        w.touched.length = 0;

        for (const a of w.atts) {
          if (!a.live) continue;
          const gx = Math.floor(a.x / w.cellSize), gy = Math.floor(a.y / w.cellSize);
          let best = -1, bestD2 = w.attract2;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const bucket = w.grid[w.cellKey(gx + ox, gy + oy)];
              if (!bucket) continue;
              for (let bi = 0; bi < bucket.length; bi++) {
                const ni = bucket[bi];
                const dx = a.x - nodes[ni].x, dy = a.y - nodes[ni].y;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestD2) { bestD2 = d2; best = ni; }
              }
            }
          }
          if (best < 0) continue;
          if (bestD2 < w.kill2) { a.live = false; w.remaining--; continue; }
          const d = Math.sqrt(bestD2);
          if (w.pullGen[best] !== gen) {
            w.pullGen[best] = gen;
            w.pullX[best] = 0;
            w.pullY[best] = 0;
            w.touched.push(best);
          }
          w.pullX[best] += (a.x - nodes[best].x) / d;
          w.pullY[best] += (a.y - nodes[best].y) / d;
        }

        if (w.touched.length === 0) {
          // Nothing in reach. During the first run that means the trunk has not
          // arrived at the crown yet, so climb. Afterwards it just means the
          // light you painted is out of reach of any branch, and we stop.
          if (!w.bootstrap) break;
          let tip = 0;
          let bestD = Infinity;
          for (let i = 0; i < nodes.length; i++) {
            const dx = crown.cx - nodes[i].x, dy = crown.cy - nodes[i].y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; tip = i; }
          }
          if (bestD < w.step * w.step) break;
          const dx = crown.cx - nodes[tip].x, dy = crown.cy - nodes[tip].y;
          const len = Math.hypot(dx, dy) || 1;
          // Mostly straight up, biased toward the crown, with a little wander.
          const ux = (dx / len) * 0.5 + (r() - 0.5) * 0.14;
          const uy = (dy / len) * 0.5 - 0.62;
          const ul = Math.hypot(ux, uy) || 1;
          nodes.push({
            x: nodes[tip].x + (ux / ul) * w.step,
            y: nodes[tip].y + (uy / ul) * w.step,
            parent: tip, gen
          });
          w.indexNode(nodes.length - 1);
          continue;
        }

        for (let ti = 0; ti < w.touched.length; ti++) {
          if (nodes.length >= NODE_CAP) break;
          const ni = w.touched[ti];
          let ux = w.pullX[ni], uy = w.pullY[ni];
          // A pinch of upward bias and jitter keeps limbs from collapsing onto
          // one another when several attractors pull the same way.
          uy -= 0.22;
          ux += (r() - 0.5) * 0.18;
          const len = Math.hypot(ux, uy) || 1;
          nodes.push({
            x: nodes[ni].x + (ux / len) * w.step,
            y: nodes[ni].y + (uy / len) * w.step,
            parent: ni, gen
          });
          w.indexNode(nodes.length - 1);
        }
      }
      return nodes.length - before;
    }

    // Thickness, bottom-up. Leonardo's rule: a limb's cross-section equals the
    // sum of the limbs it carries. Children always come after parents in the
    // array, so one reverse pass is enough. Rebuilds the drawable segments too,
    // since every width upstream of new growth changes.
    function finalizeTree() {
      const EXP = 2.15;
      const acc = new Float32Array(nodes.length);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const own = acc[i] === 0 ? 1 : Math.pow(acc[i], 1 / EXP);
        nodes[i].width = own;
        if (nodes[i].parent >= 0) acc[nodes[i].parent] += Math.pow(own, EXP);
      }
      const rootW = nodes[0].width || 1;
      const trunkPx = Math.max(3.4, (wg ? wg.scaleUnit : 60) * 0.115);
      for (const n of nodes) n.width = Math.max(0.7, (n.width / rootW) * trunkPx);

      // Nodes are appended one generation at a time, so index order is already
      // generation order and no sort is needed.
      maxGen = 1;
      segments = [];
      for (let i = 1; i < nodes.length; i++) {
        const n = nodes[i], p = nodes[n.parent];
        segments.push({ x0: p.x, y0: p.y, x1: n.x, y1: n.y, w0: p.width, w1: n.width, gen: n.gen });
        if (n.gen > maxGen) maxGen = n.gen;
      }
    }

    // Append just the segments for nodes added since `fromNode`, at a provisional
    // twig width. Used while a stroke is in progress so new growth appears under
    // the finger without re-thickening and re-baking the whole tree every frame.
    function appendSegments(fromNode) {
      const provisional = Math.max(0.8, (wg ? wg.step : 6) * 0.22);
      for (let i = fromNode; i < nodes.length; i++) {
        const n = nodes[i], p = nodes[n.parent];
        if (n.width === undefined) n.width = provisional;
        if (p.width === undefined) p.width = provisional;
        segments.push({ x0: p.x, y0: p.y, x1: n.x, y1: n.y, w0: p.width, w1: n.width, gen: n.gen });
        if (n.gen > maxGen) maxGen = n.gen;
      }
    }

    // Leaves live on tips. Keep the ones whose node is still a tip, drop the ones
    // that have since grown a branch, and leaf any new tips — so foliage does not
    // reshuffle every time the tree is added to.
    function syncLeaves(r) {
      if (!season.leaf.length) { leaves = []; return; }
      const hasChild = new Uint8Array(nodes.length);
      for (let i = 1; i < nodes.length; i++) hasChild[nodes[i].parent] = 1;

      const kept = [];
      for (const lf of leaves) {
        if (lf.node < nodes.length && !hasChild[lf.node]) kept.push(lf);
      }
      leaves = kept;

      const leafed = new Uint8Array(nodes.length);
      for (const lf of leaves) leafed[lf.node] = 1;

      const step = wg ? wg.step : 6;
      for (let i = 1; i < nodes.length && leaves.length < LEAF_CAP; i++) {
        if (hasChild[i] || leafed[i]) continue;
        // Leaves lie along the twig that carries them, not across it.
        const p = nodes[nodes[i].parent];
        const along = Math.atan2(nodes[i].y - p.y, nodes[i].x - p.x);
        const count = 1 + Math.floor(r() * 3);
        for (let c = 0; c < count; c++) {
          leaves.push({
            node: i,
            x: nodes[i].x + (r() - 0.5) * step * 2.2,
            y: nodes[i].y + (r() - 0.5) * step * 2.2,
            r: step * (0.22 + r() * 0.3),
            rot: along + (r() - 0.5) * 1.6,
            color: season.leaf[Math.floor(r() * season.leaf.length)],
            phase: r() * TAU,
            speed: 0.6 + r() * 0.9,
            amp: 0.6 + r() * 1.7,
            gen: nodes[i].gen
          });
        }
      }
    }

    // Drifting air: petals, snow, embers, pollen.
    function buildFlecks(r) {
      flecks = [];
      for (let i = 0; i < season.flecks; i++) {
        flecks.push({
          x: r() * ctx.width,
          y: r() * ctx.height,
          r: 0.8 + r() * 2.1,
          vy: 6 + r() * 20,
          drift: (r() - 0.5) * 14,
          phase: r() * TAU,
          alpha: 0.25 + r() * 0.5
        });
      }
    }

    // Throw away the baked limbs so the next frame re-commits every segment at
    // its corrected width.
    function rebake() {
      if (!treeG) { drawn = 0; return; }
      treeG.clearRect(0, 0, ctx.width, ctx.height);
      drawn = 0;
    }

    function makeBake() {
      if (!hasOffscreen) { tree = null; treeG = null; return; }
      try {
        bakeScale = Math.min(2, ctx.dpr || 1);
        tree = new OffscreenCanvas(
          Math.max(1, Math.round(ctx.width * bakeScale)),
          Math.max(1, Math.round(ctx.height * bakeScale))
        );
        treeG = tree.getContext("2d");
        treeG.scale(bakeScale, bakeScale);
      } catch (e) {
        tree = null;
        treeG = null;
      }
    }

    function compose(fromSeed) {
      seed = fromSeed % (SEED_MAX + 1);
      const r = mulberry32((seed ^ 0x1b873593) >>> 0);
      season = SEASONS[Math.floor(r() * SEASONS.length)];
      grow(r);
      makeBake();
      bakeBackdrop();
      drawn = 0;
      growth = 0;

      if (seedChip) seedChip.textContent = seedLabel(seed);
      if (nameChip) nameChip.textContent = season.name + " · " + nodes.length + " nodes";
    }

    // ---- drawing ------------------------------------------------------------
    function mixRgb(a, b, t) {
      return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," +
        Math.round(a[1] + (b[1] - a[1]) * t) + "," +
        Math.round(a[2] + (b[2] - a[2]) * t) + ")";
    }

    // A tapered quad rather than a stroked line: the trunk has to be able to be
    // forty times thicker than a twig without the joins showing.
    function limb(target, s, tipT) {
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const w0 = s.w0 * 0.5, w1 = s.w1 * 0.5;
      target.fillStyle = mixRgb(season.bark[0], season.bark[1], tipT);
      target.beginPath();
      target.moveTo(s.x0 + nx * w0, s.y0 + ny * w0);
      target.lineTo(s.x1 + nx * w1, s.y1 + ny * w1);
      target.lineTo(s.x1 - nx * w1, s.y1 - ny * w1);
      target.lineTo(s.x0 - nx * w0, s.y0 - ny * w0);
      target.closePath();
      target.fill();
      target.beginPath();
      target.arc(s.x1, s.y1, w1, 0, TAU);
      target.fill();
    }

    // The sky and ground are painted as narrow bands, and the contact shadow as
    // concentric discs, rather than with CanvasGradient objects.
    //
    // The upload validator rejects addColorStop() whenever it cannot resolve the
    // colour argument to a literal, and these colours are chosen from the season
    // table at runtime — it reports that (misleadingly) as "unsupported remote
    // resources". Banding into an offscreen bake costs one drawImage a frame and
    // is indistinguishable from the gradient it replaces.
    function paintBackdrop(t, w, h, step) {
      const s0 = season.sky[0], s1 = season.sky[1];
      for (let y = 0; y < h; y += step) {
        const k = h > 1 ? y / (h - 1) : 0;
        t.fillStyle = "rgb(" + Math.round(s0[0] + (s1[0] - s0[0]) * k) + "," +
          Math.round(s0[1] + (s1[1] - s0[1]) * k) + "," +
          Math.round(s0[2] + (s1[2] - s0[2]) * k) + ")";
        t.fillRect(0, y, w, step);
      }
      // Ground, fading in over its top edge so the tree stands on something.
      const gr = season.ground;
      const top = Math.max(0, Math.round(base.y - 26));
      const fade = Math.max(1, (h - top) * 0.35);
      for (let y = top; y < h; y += step) {
        const a = Math.min(1, (y - top) / fade);
        t.fillStyle = "rgba(" + gr[0] + "," + gr[1] + "," + gr[2] + "," + a.toFixed(3) + ")";
        t.fillRect(0, y, w, step);
      }
    }

    function bakeBackdrop() {
      if (!hasOffscreen) { bg = null; return; }
      try {
        const w = Math.max(1, Math.round(ctx.width));
        const h = Math.max(1, Math.round(ctx.height));
        bg = new OffscreenCanvas(w, h);
        paintBackdrop(bg.getContext("2d"), w, h, 1);
      } catch (e) {
        bg = null;
      }
    }

    function paintSky() {
      if (bg) {
        g.globalAlpha = 1;
        g.drawImage(bg, 0, 0, ctx.width, ctx.height);
      } else {
        paintBackdrop(g, ctx.width, ctx.height, 3);
      }

      const shadowW = Math.min(ctx.width * 0.42, crown.rx * 1.1) * (0.35 + growth * 0.65);
      g.save();
      g.translate(base.x, base.y + 4);
      g.scale(1, 0.24);
      const rings = 16;
      for (let i = rings; i >= 1; i--) {
        const k = i / rings;
        g.fillStyle = "rgba(0,0,0," + (0.045 * (1 - k)).toFixed(4) + ")";
        g.beginPath();
        g.arc(0, 0, shadowW * k, 0, TAU);
        g.fill();
      }
      g.restore();
    }

    function draw(dt) {
      paintSky();

      const revealGen = growth * (maxGen + 1);

      // Commit newly grown limbs to the bake, once each.
      if (treeG) {
        while (drawn < segments.length && segments[drawn].gen <= revealGen) {
          const s = segments[drawn];
          limb(treeG, s, Math.min(1, s.gen / maxGen));
          drawn++;
        }
      }

      // The whole tree leans on the wind, pivoting at the base like a real one.
      const sway = Math.sin(clock * 0.55) * 0.0045 + Math.sin(clock * 0.21 + 1.3) * 0.0032;
      g.save();
      g.translate(base.x, base.y);
      g.rotate(sway);
      g.translate(-base.x, -base.y);

      if (tree) {
        g.drawImage(tree, 0, 0, ctx.width, ctx.height);
      } else {
        // No OffscreenCanvas: draw the limbs live. Heavier, identical picture.
        for (let i = 0; i < segments.length; i++) {
          const s = segments[i];
          if (s.gen > revealGen) break;
          limb(g, s, Math.min(1, s.gen / maxGen));
        }
      }

      // Leaves flutter on top of the sway, and only after their branch arrives.
      if (season.glow > 0) g.globalCompositeOperation = "lighter";
      for (const lf of leaves) {
        const t = revealGen - lf.gen;
        if (t <= 0) continue;
        const pop = t < 2 ? t / 2 : 1;
        const wob = Math.sin(clock * lf.speed + lf.phase) * lf.amp;
        g.globalAlpha = season.glow > 0 ? 0.55 + season.glow * 0.35 : 1;
        g.fillStyle = lf.color;
        g.beginPath();
        g.ellipse(lf.x + wob, lf.y + wob * 0.4, lf.r * pop * 1.7, lf.r * pop * 0.8, lf.rot, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.restore();

      // Air. Drawn outside the sway so it moves independently of the tree.
      for (const f of flecks) {
        f.y += f.vy * dt;
        f.x += Math.sin(clock * 0.7 + f.phase) * f.drift * dt;
        if (f.y > ctx.height + 4) { f.y = -4; f.x = Math.random() * ctx.width; }
        g.globalAlpha = f.alpha;
        g.fillStyle = season.fleck;
        g.beginPath();
        g.arc(f.x, f.y, f.r, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // ---- overlay ------------------------------------------------------------
    const FONT = "-apple-system,system-ui,'Segoe UI',sans-serif";
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    const chipCss =
      "pointer-events:none;display:inline-flex;align-items:center;gap:6px;" +
      "padding:7px 12px;border-radius:999px;background:rgba(18,20,24,0.44);" +
      "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
      "color:rgba(255,255,255,0.92);font:600 12px/1 " + FONT + ";" +
      "letter-spacing:0.14em;text-transform:uppercase;white-space:nowrap;" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.3);";
    const btnCss =
      "pointer-events:auto;width:42px;height:42px;border-radius:14px;border:none;" +
      "cursor:pointer;background:rgba(18,20,24,0.44);color:rgba(255,255,255,0.94);" +
      "font:600 17px/1 " + FONT + ";backdrop-filter:blur(10px);" +
      "-webkit-backdrop-filter:blur(10px);touch-action:manipulation;" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.3);";

    ui.innerHTML =
      '<div style="position:absolute;left:14px;right:14px;top:' + (ctx.safeArea.top + 12) + 'px;' +
        'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">' +
          '<span style="' + chipCss + '">Seed <b data-el="seed" style="letter-spacing:0.2em;">—</b></span>' +
          '<span data-el="name" style="' + chipCss + 'opacity:0.66;font-size:10px;">—</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button data-el="help" aria-label="How it works" style="' + btnCss + '">?</button>' +
          '<button data-el="again" aria-label="New tree" style="' + btnCss + '">↻</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="hint" style="position:absolute;left:0;right:0;' +
        'bottom:calc(' + ctx.safeArea.bottom + 'px + 14px);text-align:center;' +
        'pointer-events:none;color:rgba(255,255,255,0.82);font:500 12px/1 ' + FONT + ';' +
        'letter-spacing:0.12em;text-transform:uppercase;transition:opacity 700ms ease;' +
        'text-shadow:0 1px 6px rgba(0,0,0,0.5);">tap to grow another · drag to paint light</div>' +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;' +
        'align-items:center;justify-content:center;padding:28px;pointer-events:auto;' +
        'background:rgba(8,10,12,0.86);backdrop-filter:blur(6px);' +
        '-webkit-backdrop-filter:blur(6px);">' +
        '<div style="max-width:330px;color:#eef;font:400 15px/1.6 ' + FONT + ';">' +
          '<h2 style="font-size:21px;margin-bottom:6px;letter-spacing:0.02em;">Heartwood</h2>' +
          '<p style="opacity:0.62;font-size:13px;margin-bottom:16px;">Not a fractal. A cloud of ' +
            'invisible points is scattered into the air and the wood grows toward whichever ones ' +
            'are nearest, using each one up as it arrives — roughly what a real tree does.</p>' +
          '<ul style="list-style:none;display:grid;gap:11px;">' +
            '<li>• <b>Tap anywhere</b> to grow another — new crown, new season, new silhouette.</li>' +
            '<li>• <b>Drag anywhere</b> to paint light. Points land under your finger and the ' +
              'nearest wood reaches for them — the same rule it grew by, so what you draw is real growth.</li>' +
            '<li>• Limbs compete for the same points. That competition is what makes the forks.</li>' +
            '<li>• Every branch is as thick as the branches it carries, the way Leonardo noticed.</li>' +
          '</ul>' +
          '<p style="margin-top:18px;opacity:0.55;font-size:13px;">Tap to close.</p>' +
        '</div>' +
      '</div>';

    const seedChip = ui.querySelector('[data-el="seed"]');
    const nameChip = ui.querySelector('[data-el="name"]');
    const hint = ui.querySelector('[data-el="hint"]');
    const panel = ui.querySelector('[data-el="panel"]');
    const helpBtn = ui.querySelector('[data-el="help"]');
    const againBtn = ui.querySelector('[data-el="again"]');

    // ---- music --------------------------------------------------------------
    async function startMusic() {
      if (music || !ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({ preset: "ambient", volume: 0.3, fadeInMs: 2600, intensity: 0.22 });
      } catch (err) {
        ctx.platform.error({ where: "music", message: String(err) });
      }
    }

    // ---- interaction --------------------------------------------------------
    function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      startMusic();
      hint.style.opacity = "0";
    }

    function reseed(source) {
      compose(randomSeed());
      if (ctx.capabilities.haptics) ctx.platform.haptic("medium");
      if (music) { try { music.sting("tap"); } catch (e) { /* non-fatal */ } }
      ctx.platform.interact({ type: "reseed", source, seed: seedLabel(seed), season: season.name });
    }

    // Tap grows a whole new tree. Dragging paints light: attractor points land
    // under your finger and the nearest wood reaches for them, which is the
    // same rule the tree grew by in the first place — so a branch you draw is
    // indistinguishable from one it grew on its own.
    let pointerDown = false, moved = 0, painting = false;

    function paintLight(px, py) {
      if (!wg) return;
      const spread = wg.step * 2.6;
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * TAU;
        const rad = Math.sqrt(Math.random()) * spread;
        const ay = py + Math.sin(a) * rad;
        if (ay > base.y - wg.step) continue; // nothing grows into the ground
        wg.atts.push({ x: px + Math.cos(a) * rad, y: ay, live: true });
        wg.remaining++;
      }
      const before = nodes.length;
      growGenerations(3);
      if (nodes.length > before) appendSegments(before);
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      pointerDown = true;
      moved = 0;
      painting = false;
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      if (!pointerDown) return;
      e.preventDefault();
      moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      if (moved <= 8) return;
      if (!painting) {
        painting = true;
        hint.style.opacity = "0";
        growth = 1; // you have taken over; stop the intro reveal mid-stride
      }
      paintLight(e.offsetX, e.offsetY);
    }, { passive: false });

    function releasePaint() {
      if (!pointerDown) return;
      pointerDown = false;
      if (!painting) { reseed("canvas"); return; }
      painting = false;
      // Now that the stroke is done, re-thicken every limb that gained weight
      // and repaint the bake once, rather than on every frame of the drag.
      finalizeTree();
      syncLeaves(Math.random);
      rebake();
      if (nameChip) nameChip.textContent = season.name + " · " + nodes.length + " nodes";
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
      ctx.platform.interact({ type: "paint_light", nodes: nodes.length });
    }
    ctx.listen(canvas, "pointerup", releasePaint);
    ctx.listen(canvas, "pointercancel", releasePaint);

    ctx.listen(againBtn, "click", (e) => { e.stopPropagation(); firstGesture(); reseed("button"); });
    ctx.listen(helpBtn, "click", (e) => {
      e.stopPropagation();
      firstGesture();
      panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    });
    ctx.listen(panel, "click", () => { panel.style.display = "none"; });

    // ---- boot ---------------------------------------------------------------
    lastW = ctx.width;
    lastH = ctx.height;
    compose(seed);
    draw(0);
    ctx.markVisualReady("ground-and-sky");

    ctx.onFrame((dtMs) => {
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        compose(seed);
      }
      const dt = Math.min(0.05, dtMs / 1000);
      clock += dt;
      if (growth < 1) {
        growth = Math.min(1, growth + dtMs / GROW_MS);
        if (growth >= 1) {
          ctx.platform.milestone("tree_grown", { seed: seedLabel(seed), season: season.name });
        }
      }
      draw(dt);
    });

    ctx.timeout(() => { hint.style.opacity = "0"; }, 4600);
    ctx.platform.ready();
  }
};
