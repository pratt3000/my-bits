// Morphogen — a generative Plethora Bit.
//
// Alan Turing's 1952 answer to why a leopard has spots: two chemicals, one that
// feeds itself and one that eats it, diffusing at different speeds. Nothing in
// the maths knows what a spot is, yet spots appear — along with coral, worms,
// fingerprints and cell division, depending only on two numbers.
//
// This runs the Gray–Scott form of that reaction live. Tap for a new seed: a new
// species, a new colour, a new way of dropping the first chemical in. Drag to
// pour more in and watch the pattern grow out of your finger.

window.plethoraBit = {
  meta: {
    title: "Morphogen",
    runtime: "plethora-bit@2",
    tags: ["generative", "art", "science", "nature", "simulation", "calm", "sensory"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    // ---- tunables -----------------------------------------------------------
    const TARGET_CELLS = 24000; // grid budget; upscaled to the screen when drawn
    const DU = 0.16;            // how fast the feed chemical spreads
    const DV = 0.08;            // the killer spreads at half the speed — the whole trick
    const MIN_ITER = 3, MAX_ITER = 9;

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

    // ---- species ------------------------------------------------------------
    // Every one of these is the same two equations. Only the feed rate F and the
    // kill rate K differ, and that alone decides whether you get coral or worms.
    const SPECIES = [
      { name: "Coral",       f: 0.0545, k: 0.0620 },
      { name: "Mitosis",     f: 0.0367, k: 0.0649 },
      { name: "Solitons",    f: 0.0300, k: 0.0620 },
      { name: "Worms",       f: 0.0580, k: 0.0650 },
      { name: "Labyrinth",   f: 0.0290, k: 0.0570 },
      { name: "Fingerprint", f: 0.0370, k: 0.0600 },
      { name: "Waves",       f: 0.0140, k: 0.0450 },
      { name: "Holes",       f: 0.0390, k: 0.0580 },
      { name: "Moss",        f: 0.0260, k: 0.0510 },
      { name: "Flicker",     f: 0.0620, k: 0.0609 }
    ];

    // ---- palettes -----------------------------------------------------------
    // Hand-picked ramps rather than random colour: reaction–diffusion reads as a
    // material — shell, ember, patina — and materials have particular colours.
    const PALETTES = [
      { name: "Nacre",    stops: [[0, 8, 14, 30], [0.35, 16, 62, 92], [0.62, 84, 174, 186], [0.84, 206, 232, 226], [1, 255, 255, 252]] },
      { name: "Ember",    stops: [[0, 12, 6, 6], [0.34, 92, 16, 12], [0.6, 198, 68, 18], [0.82, 244, 158, 44], [1, 255, 240, 206]] },
      { name: "Jade",     stops: [[0, 5, 18, 15], [0.36, 12, 68, 52], [0.64, 62, 156, 112], [0.85, 168, 220, 176], [1, 240, 252, 236]] },
      { name: "Amethyst", stops: [[0, 12, 8, 26], [0.34, 62, 22, 96], [0.6, 142, 54, 168], [0.82, 224, 122, 200], [1, 253, 232, 248]] },
      { name: "Bone",     stops: [[0, 24, 16, 12], [0.36, 88, 54, 34], [0.62, 168, 118, 76], [0.84, 226, 196, 152], [1, 250, 242, 228]] },
      { name: "Abyss",    stops: [[0, 3, 4, 14], [0.34, 18, 24, 92], [0.6, 34, 116, 190], [0.82, 116, 214, 236], [1, 236, 252, 255]] },
      { name: "Patina",   stops: [[0, 16, 14, 10], [0.34, 62, 60, 40], [0.6, 62, 148, 128], [0.82, 142, 214, 190], [1, 236, 250, 240]] },
      { name: "Aurora",   stops: [[0, 4, 10, 10], [0.32, 8, 62, 54], [0.56, 30, 158, 108], [0.78, 152, 226, 116], [1, 244, 255, 224]] }
    ];

    function buildLut(pal, invert) {
      const lut = new Uint8Array(256 * 3);
      const stops = pal.stops;
      for (let i = 0; i < 256; i++) {
        const t = invert ? 1 - i / 255 : i / 255;
        let a = stops[0], b = stops[stops.length - 1];
        for (let s = 0; s < stops.length - 1; s++) {
          if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
        }
        const span = b[0] - a[0] || 1;
        const m = (t - a[0]) / span;
        lut[i * 3] = a[1] + (b[1] - a[1]) * m;
        lut[i * 3 + 1] = a[2] + (b[2] - a[2]) * m;
        lut[i * 3 + 2] = a[3] + (b[3] - a[3]) * m;
      }
      return lut;
    }

    // ---- surfaces -----------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const hasOffscreen = typeof OffscreenCanvas === "function";

    let W = 0, H = 0;
    let U = null, V = null, NU = null, NV = null;
    let xm1 = null, xp1 = null, ym1 = null, yp1 = null;
    let off = null, offG = null, image = null;
    let lut = buildLut(PALETTES[0], false);

    function sizeGrid() {
      const cssW = Math.max(1, ctx.width), cssH = Math.max(1, ctx.height);
      const aspect = cssW / cssH;
      W = Math.max(24, Math.round(Math.sqrt(TARGET_CELLS * aspect)));
      H = Math.max(24, Math.round(TARGET_CELLS / W));

      const n = W * H;
      U = new Float32Array(n);
      V = new Float32Array(n);
      NU = new Float32Array(n);
      NV = new Float32Array(n);

      // Wrapped neighbour indices, precomputed so the inner loop has no modulo
      // and the pattern tiles seamlessly instead of pinning at the edges.
      xm1 = new Int32Array(W);
      xp1 = new Int32Array(W);
      for (let x = 0; x < W; x++) {
        xm1[x] = (x - 1 + W) % W;
        xp1[x] = (x + 1) % W;
      }
      ym1 = new Int32Array(H);
      yp1 = new Int32Array(H);
      for (let y = 0; y < H; y++) {
        ym1[y] = ((y - 1 + H) % H) * W;
        yp1[y] = ((y + 1) % H) * W;
      }

      if (!hasOffscreen) return;
      off = new OffscreenCanvas(W, H);
      offG = off.getContext("2d");
      image = offG.createImageData(W, H);
      const d = image.data;
      for (let i = 3; i < d.length; i += 4) d[i] = 255;
    }

    // ---- run state ----------------------------------------------------------
    let seed = randomSeed();
    let species = SPECIES[0], palette = PALETTES[0];
    let F = species.f, K = species.k;
    let iters = 6;
    let sinceCheck = 0;
    let started = false, music = null;
    let lastW = 0, lastH = 0;

    // Drop the first chemical in. How it is dropped changes the whole
    // composition — the reaction only ever grows outward from what it is given.
    function inoculate(r) {
      U.fill(1);
      V.fill(0);
      const shapes = ["drop", "scatter", "ring", "lattice", "band", "dust"];
      const shape = shapes[Math.floor(r() * shapes.length)];

      const blot = (cx, cy, rad) => {
        const r2 = rad * rad;
        for (let y = Math.max(0, cy - rad | 0); y < Math.min(H, cy + rad + 1); y++) {
          for (let x = Math.max(0, cx - rad | 0); x < Math.min(W, cx + rad + 1); x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy > r2) continue;
            const i = y * W + x;
            U[i] = 0.35 + r() * 0.1;
            V[i] = 0.28 + r() * 0.14;
          }
        }
      };

      if (shape === "drop") {
        blot(W / 2, H / 2, Math.max(4, Math.min(W, H) * 0.09));
      } else if (shape === "scatter") {
        const n = 6 + Math.floor(r() * 14);
        for (let i = 0; i < n; i++) blot(r() * W, r() * H, 3 + r() * 6);
      } else if (shape === "ring") {
        const n = 10 + Math.floor(r() * 14);
        const rad = Math.min(W, H) * (0.24 + r() * 0.14);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          blot(W / 2 + Math.cos(a) * rad, H / 2 + Math.sin(a) * rad, 3 + r() * 3);
        }
      } else if (shape === "lattice") {
        const step = 10 + Math.floor(r() * 14);
        for (let y = step; y < H; y += step) {
          for (let x = step; x < W; x += step) blot(x, y, 2 + r() * 2);
        }
      } else if (shape === "band") {
        const cy = H * (0.3 + r() * 0.4);
        const half = Math.max(3, H * 0.035);
        const y0 = Math.max(0, Math.floor(cy - half));
        const y1 = Math.min(H, Math.ceil(cy + half));
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < W; x++) {
            const i = y * W + x;
            U[i] = 0.35; V[i] = 0.3 + r() * 0.1;
          }
        }
      } else {
        for (let i = 0; i < U.length; i++) {
          if (r() < 0.035) { U[i] = 0.4; V[i] = 0.3 + r() * 0.15; }
        }
      }
    }

    function compose(fromSeed) {
      seed = fromSeed % (SEED_MAX + 1);
      const r = mulberry32((seed ^ 0x85ebca6b) >>> 0);
      species = SPECIES[Math.floor(r() * SPECIES.length)];
      // A touch of jitter so two runs of the same species are still not twins.
      F = species.f + (r() - 0.5) * 0.0016;
      K = species.k + (r() - 0.5) * 0.0010;
      palette = PALETTES[Math.floor(r() * PALETTES.length)];
      lut = buildLut(palette, r() < 0.22);
      inoculate(r);
      if (seedChip) seedChip.textContent = seedLabel(seed);
      if (nameChip) nameChip.textContent = species.name + " · " + palette.name;
    }

    // ---- the reaction -------------------------------------------------------
    function stepOnce() {
      const u = U, v = V, nu = NU, nv = NV;
      const f = F, k = K;
      for (let y = 0; y < H; y++) {
        const row = y * W, up = ym1[y], dn = yp1[y];
        for (let x = 0; x < W; x++) {
          const i = row + x;
          const l = row + xm1[x], rr = row + xp1[x];
          const a = up + x, b = dn + x;
          const uc = u[i], vc = v[i];
          // Laplacian as "average of my neighbours, minus me".
          const lapU = (u[l] + u[rr] + u[a] + u[b]) * 0.25 - uc;
          const lapV = (v[l] + v[rr] + v[a] + v[b]) * 0.25 - vc;
          const reaction = uc * vc * vc;
          let un = uc + DU * lapU - reaction + f * (1 - uc);
          let vn = vc + DV * lapV + reaction - (f + k) * vc;
          nu[i] = un < 0 ? 0 : un > 1 ? 1 : un;
          nv[i] = vn < 0 ? 0 : vn > 1 ? 1 : vn;
        }
      }
      U = nu; NU = u;
      V = nv; NV = v;
    }

    // A cheap strided sample of how much killer chemical is left. Near zero
    // means the pattern has burned out.
    function chemicalLevel() {
      let sum = 0, n = 0;
      for (let i = 0; i < V.length; i += 17) { sum += V[i]; n++; }
      return n ? sum / n : 0;
    }

    // ---- rendering ----------------------------------------------------------
    // The colour comes from V, and a cheap directional light off the gradient of
    // V gives the pattern relief, so it reads as carved shell rather than a map.
    function render() {
      if (!image) return;
      const d = image.data;
      const v = V;
      for (let y = 0; y < H; y++) {
        const row = y * W, up = ym1[y], dn = yp1[y];
        for (let x = 0; x < W; x++) {
          const i = row + x;
          const vc = v[i];
          let t = (vc - 0.02) * 2.94;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const gx = v[row + xp1[x]] - v[row + xm1[x]];
          const gy = v[dn + x] - v[up + x];
          // Light from the upper left; ±22% is enough to feel three-dimensional.
          let shade = 1 - (gx + gy) * 3.4;
          shade = shade < 0.78 ? 0.78 : shade > 1.22 ? 1.22 : shade;
          const l = ((t * 255) | 0) * 3;
          const o = i * 4;
          let rr = lut[l] * shade, gg = lut[l + 1] * shade, bb = lut[l + 2] * shade;
          d[o] = rr > 255 ? 255 : rr;
          d[o + 1] = gg > 255 ? 255 : gg;
          d[o + 2] = bb > 255 ? 255 : bb;
        }
      }
      offG.putImageData(image, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      // Default (bilinear) smoothing, not "high". The grid is upscaled about
      // fivefold every frame, and high-quality resampling at that ratio costs
      // more than the chemistry does — on a pattern this soft it is invisible.
      g.imageSmoothingEnabled = true;
      g.drawImage(off, 0, 0, ctx.width, ctx.height);
    }

    // Fallback for WebViews with no OffscreenCanvas: blocky, but alive and never
    // a blank screen.
    function renderBlocks() {
      const cw = ctx.width / W, ch = ctx.height / H;
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const vc = V[y * W + x];
          let t = (vc - 0.02) * 2.94;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const l = ((t * 255) | 0) * 3;
          g.fillStyle = "rgb(" + lut[l] + "," + lut[l + 1] + "," + lut[l + 2] + ")";
          g.fillRect(x * cw, y * ch, cw + 1, ch + 1);
        }
      }
    }

    const paint = hasOffscreen ? render : renderBlocks;

    // ---- overlay ------------------------------------------------------------
    const FONT = "-apple-system,system-ui,'Segoe UI',sans-serif";
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    const chipCss =
      "pointer-events:none;display:inline-flex;align-items:center;gap:6px;" +
      "padding:7px 12px;border-radius:999px;background:rgba(8,10,16,0.44);" +
      "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
      "color:rgba(255,255,255,0.88);font:600 12px/1 " + FONT + ";" +
      "letter-spacing:0.14em;text-transform:uppercase;white-space:nowrap;" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.4);";
    const btnCss =
      "pointer-events:auto;width:42px;height:42px;border-radius:14px;border:none;" +
      "cursor:pointer;background:rgba(8,10,16,0.44);color:rgba(255,255,255,0.9);" +
      "font:600 17px/1 " + FONT + ";backdrop-filter:blur(10px);" +
      "-webkit-backdrop-filter:blur(10px);touch-action:manipulation;" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.4);";

    ui.innerHTML =
      '<div style="position:absolute;left:14px;right:14px;top:' + (ctx.safeArea.top + 12) + 'px;' +
        'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">' +
          '<span style="' + chipCss + '">Seed <b data-el="seed" style="letter-spacing:0.2em;">—</b></span>' +
          '<span data-el="name" style="' + chipCss + 'opacity:0.64;font-size:10px;">—</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button data-el="help" aria-label="How it works" style="' + btnCss + '">?</button>' +
          '<button data-el="again" aria-label="New seed" style="' + btnCss + '">↻</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="hint" style="position:absolute;left:0;right:0;' +
        'bottom:calc(' + ctx.safeArea.bottom + 'px + 26px);text-align:center;' +
        'pointer-events:none;color:rgba(255,255,255,0.66);font:500 13px/1 ' + FONT + ';' +
        'letter-spacing:0.08em;transition:opacity 700ms ease;text-shadow:0 1px 8px rgba(0,0,0,0.7);">' +
        'drag to pour · tap for a new seed</div>' +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;' +
        'align-items:center;justify-content:center;padding:28px;pointer-events:auto;' +
        'background:rgba(5,7,12,0.82);backdrop-filter:blur(6px);' +
        '-webkit-backdrop-filter:blur(6px);">' +
        '<div style="max-width:330px;color:#eef;font:400 15px/1.6 ' + FONT + ';">' +
          '<h2 style="font-size:21px;margin-bottom:6px;letter-spacing:0.02em;">Morphogen</h2>' +
          '<p style="opacity:0.62;font-size:13px;margin-bottom:16px;">Two chemicals. One feeds ' +
            'itself, one eats it, and they spread at different speeds. That is the entire rule — ' +
            'the spots and coral are not drawn, they emerge.</p>' +
          '<ul style="list-style:none;display:grid;gap:11px;">' +
            '<li>• <b>Drag</b> to pour more chemical in and grow the pattern from your finger.</li>' +
            '<li>• <b>Tap</b> for a new seed — a different species, colour and starting drop.</li>' +
            '<li>• Ten species, all the same equation. Only the feed and kill rates differ.</li>' +
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

    function flashHint(text) {
      hint.textContent = text;
      hint.style.opacity = "1";
      ctx.timeout(() => { hint.style.opacity = "0"; }, 3200);
    }

    // ---- music --------------------------------------------------------------
    async function startMusic() {
      if (music || !ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({ preset: "ambient", volume: 0.3, fadeInMs: 2600, intensity: 0.25 });
      } catch (err) {
        ctx.platform.error({ where: "music", message: String(err) });
      }
    }

    // ---- interaction --------------------------------------------------------
    // A tap reseeds; a drag pours. They are told apart on release by how far the
    // finger travelled, so a tap never leaves a stray blob behind.
    let pointerDown = false, moved = 0, downAt = 0;

    function pourAt(px, py) {
      // event.offsetX/offsetY are already canvas-relative, and asking the layout
      // engine for a bounding rect on every pointer move is both a forced reflow
      // and something the upload validator rejects.
      const gx = (px / ctx.width) * W;
      const gy = (py / ctx.height) * H;
      const rad = Math.max(2.5, Math.min(W, H) * 0.045);
      const r2 = rad * rad;
      const x0 = Math.max(0, Math.floor(gx - rad)), x1 = Math.min(W - 1, Math.ceil(gx + rad));
      const y0 = Math.max(0, Math.floor(gy - rad)), y1 = Math.min(H - 1, Math.ceil(gy + rad));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - gx, dy = y - gy;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const fall = 1 - d2 / r2;
          const i = y * W + x;
          V[i] = Math.min(1, V[i] + 0.42 * fall);
          U[i] = Math.max(0, U[i] - 0.32 * fall);
        }
      }
    }

    function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      startMusic();
      hint.style.opacity = "0";
    }

    function reseed(source) {
      compose(randomSeed());
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
      if (music) { try { music.sting("tap"); } catch (e) { /* non-fatal */ } }
      ctx.platform.interact({ type: "reseed", seed: seedLabel(seed), species: species.name, source });
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      pointerDown = true;
      moved = 0;
      downAt = 0;
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      if (!pointerDown) return;
      e.preventDefault();
      moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      if (moved > 8) pourAt(e.offsetX, e.offsetY);
    }, { passive: false });

    function release() {
      if (!pointerDown) return;
      pointerDown = false;
      if (moved <= 8) reseed("canvas");
      else ctx.platform.interact({ type: "pour" });
    }
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    ctx.listen(againBtn, "click", (e) => { e.stopPropagation(); firstGesture(); reseed("button"); });
    ctx.listen(helpBtn, "click", (e) => {
      e.stopPropagation();
      firstGesture();
      panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    });
    ctx.listen(panel, "click", () => { panel.style.display = "none"; });

    // ---- boot ---------------------------------------------------------------
    sizeGrid();
    lastW = ctx.width;
    lastH = ctx.height;
    compose(seed);

    // Run the reaction forward before the first paint. A couple of dozen steps
    // is still just the seed blobs; by 150 the pattern has actually formed, and
    // it keeps growing from there while you watch.
    for (let i = 0; i < 150; i++) stepOnce();
    paint();
    ctx.markVisualReady("first-reaction");

    ctx.onFrame((dtMs) => {
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        sizeGrid();
        compose(seed);
      }

      // Spend whatever the device can afford on chemistry. A slow phone runs the
      // reaction more gently rather than dropping frames.
      if (dtMs > 26 && iters > MIN_ITER) iters--;
      else if (dtMs < 15 && iters < MAX_ITER) iters++;

      for (let i = 0; i < iters; i++) stepOnce();

      // Some feed/kill pairs sit just outside the stable region — the seeded
      // jitter can push one over the edge — and the reaction burns out to a flat
      // field. Rather than leave the viewer looking at a blank colour, fall back
      // to the species' published rates and drop fresh chemical in.
      if (++sinceCheck >= 30) {
        sinceCheck = 0;
        if (chemicalLevel() < 0.006) {
          F = species.f;
          K = species.k;
          inoculate(mulberry32((seed ^ 0x5bd1e995) >>> 0));
          ctx.platform.emit("reaction_revived", { seed: seedLabel(seed), species: species.name });
        }
      }

      paint();
    });

    flashHint("drag to pour · tap for a new seed");
    ctx.platform.ready();
  }
};
