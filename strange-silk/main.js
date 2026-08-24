// Strange Silk — a generative Plethora Bit.
//
// An autonomous system draws the picture: a chaotic 2D map is iterated over a
// million times from a single seed, and the density of where the orbit lands
// becomes the image. Nothing is designed by hand — the seed picks the attractor
// family, its four constants and the colour ramp, and the maths does the rest.
//
// Tap for a new seed. Every seed is a different painting, and the same seed
// always paints the same picture.

window.plethoraBit = {
  meta: {
    title: "Strange Silk",
    runtime: "plethora-bit@2",
    tags: ["generative", "art", "abstract", "math", "calm", "sensory", "fidget"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    // ---- tunables -----------------------------------------------------------
    const MAX_PIXELS = 260000;  // working buffer budget; blitted up to the canvas
    const BATCH = 12000;        // orbit steps accumulated per frame
    const FRAMES = 100;         // frames of accumulation before the print rests
    const WARMUP = 1200;        // orbit steps discarded before anything is plotted
    const PROBE = 26000;        // steps used to measure the attractor's extent

    // ---- seeded randomness --------------------------------------------------
    // mulberry32: tiny, fast, and stable across engines, so a seed shown on one
    // phone paints the identical picture on another.
    function mulberry32(a) {
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const SEED_MAX = 0xffffff; // 16.7M seeds, and a short 5-character label
    function randomSeed() {
      return Math.floor(Math.random() * SEED_MAX);
    }
    function seedLabel(seed) {
      return seed.toString(36).toUpperCase().padStart(5, "0");
    }

    // ---- the autonomous systems ---------------------------------------------
    // Four classic chaotic maps. Each takes a point and returns the next one;
    // iterated, the orbit never repeats but never escapes, and the shape it
    // wears out in the plane is the artwork.
    const FAMILIES = [
      {
        name: "de Jong",
        params: (r) => [rng(r, -3, 3), rng(r, -3, 3), rng(r, -3, 3), rng(r, -3, 3)],
        step: (x, y, p) => [
          Math.sin(p[0] * y) - Math.cos(p[1] * x),
          Math.sin(p[2] * x) - Math.cos(p[3] * y)
        ]
      },
      {
        name: "Clifford",
        params: (r) => [rng(r, -2, 2), rng(r, -2, 2), rng(r, -2, 2), rng(r, -2, 2)],
        step: (x, y, p) => [
          Math.sin(p[0] * y) + p[2] * Math.cos(p[0] * x),
          Math.sin(p[1] * x) + p[3] * Math.cos(p[1] * y)
        ]
      },
      {
        name: "Svensson",
        params: (r) => [rng(r, -3, 3), rng(r, -3, 3), rng(r, -3, 3), rng(r, -3, 3)],
        step: (x, y, p) => [
          p[3] * Math.sin(p[0] * x) - Math.sin(p[1] * y),
          p[2] * Math.cos(p[0] * x) + Math.cos(p[1] * y)
        ]
      },
      {
        name: "Fractal Dream",
        params: (r) => [rng(r, -3, 3), rng(r, -3, 3), rng(r, -1.5, 1.5), rng(r, -1.5, 1.5)],
        step: (x, y, p) => [
          Math.sin(y * p[1]) + p[2] * Math.sin(x * p[1]),
          Math.sin(x * p[0]) + p[3] * Math.sin(y * p[0])
        ]
      }
    ];

    function rng(r, lo, hi) {
      return lo + r() * (hi - lo);
    }

    // ---- colour -------------------------------------------------------------
    // Inigo Quilez cosine palettes: three cosine waves out of phase always land
    // on a harmonious ramp, so a random seed can never pick an ugly one.
    function cosinePalette(r) {
      const phase = [r(), r(), r()];
      const freq = r() < 0.35 ? [1, 1, 0.5] : [1, 1, 1];
      const spread = 0.28 + r() * 0.24;
      return (t) => {
        const out = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
          const v = 0.55 + spread * Math.cos(6.28318 * (freq[i] * t + phase[i]));
          out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
        }
        return out;
      };
    }

    // Build a 256-entry lookup so the per-pixel loop is three array reads.
    // Sparse density fades to the ink colour, dense threads bloom to full hue.
    function buildLut(palette, ink) {
      const lut = new Uint8Array(256 * 3);
      for (let i = 0; i < 256; i++) {
        const t = i / 255;
        const rgb = palette(0.15 + t * 0.85);
        const glow = Math.pow(t, 0.62);          // brightness ramp off the ink
        const lift = Math.pow(t, 2.4) * 0.5;     // hottest threads burn to white
        for (let c = 0; c < 3; c++) {
          const v = ink[c] * (1 - glow) + (rgb[c] * glow + lift) * 255;
          lut[i * 3 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
      return lut;
    }

    // ---- surfaces -----------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    // The density buffer lives on an OffscreenCanvas and is blitted up to the
    // display canvas. Bits may not mint canvases through the host document, and
    // ctx.createCanvas() returns a *display* surface, so OffscreenCanvas is the
    // right tool here. Where it is missing we fall back to plotting points
    // straight onto the display canvas with additive blending — plainer, but it
    // never leaves the viewer looking at nothing.
    const hasOffscreen = typeof OffscreenCanvas === "function";

    let bufW = 0, bufH = 0;
    let off = null, offG = null, image = null;
    let acc = null;         // density: how many orbit steps landed on each cell
    let lut = null;
    let maxDensity = 1;

    function sizeBuffers() {
      const cssW = Math.max(1, Math.round(ctx.width));
      const cssH = Math.max(1, Math.round(ctx.height));
      const shrink = Math.min(1, Math.sqrt(MAX_PIXELS / (cssW * cssH)));
      bufW = Math.max(1, Math.round(cssW * shrink));
      bufH = Math.max(1, Math.round(cssH * shrink));

      if (!hasOffscreen) return;
      off = new OffscreenCanvas(bufW, bufH);
      offG = off.getContext("2d");
      image = offG.createImageData(bufW, bufH);
      const data = image.data;
      for (let i = 3; i < data.length; i += 4) data[i] = 255; // opaque alpha
      acc = new Float32Array(bufW * bufH);
    }

    // ---- run state ----------------------------------------------------------
    let seed = randomSeed();
    let family = null, params = null, palette = null, ink = [8, 8, 14];
    let ox = 0, oy = 0;         // live orbit position
    let scale = 1, panX = 0, panY = 0, swap = false;
    let framesDone = 0;
    let settled = false;
    let lastW = 0, lastH = 0;
    let started = false;
    let music = null;

    // Compose a run from a seed: choose the map, its constants, the palette, and
    // fit the orbit's extent to the screen. Some constants collapse the orbit to
    // a dot or a thin loop; those are measured and skipped rather than shown.
    function compose(fromSeed) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const trySeed = (fromSeed + attempt) % (SEED_MAX + 1);
        const r = mulberry32((trySeed ^ 0x9e3779b9) >>> 0);
        const fam = FAMILIES[Math.floor(r() * FAMILIES.length)];
        const p = fam.params(r);

        // Probe the orbit: measure its bounding box and how much of the plane it
        // actually visits, on a coarse 64x64 grid.
        let x = 0.1, y = 0.1;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let escaped = false;
        for (let i = 0; i < WARMUP; i++) {
          const n = fam.step(x, y, p);
          x = n[0]; y = n[1];
        }
        for (let i = 0; i < PROBE; i++) {
          const n = fam.step(x, y, p);
          x = n[0]; y = n[1];
          if (!isFinite(x) || !isFinite(y)) { escaped = true; break; }
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (escaped) continue;

        const spanX = maxX - minX, spanY = maxY - minY;
        if (!(spanX > 0.35) || !(spanY > 0.35)) continue; // collapsed to a point

        const cells = new Uint8Array(64 * 64);
        let filled = 0;
        x = 0.1; y = 0.1;
        for (let i = 0; i < WARMUP; i++) {
          const n = fam.step(x, y, p);
          x = n[0]; y = n[1];
        }
        for (let i = 0; i < PROBE; i++) {
          const n = fam.step(x, y, p);
          x = n[0]; y = n[1];
          const cx = Math.min(63, Math.max(0, ((x - minX) / spanX * 63) | 0));
          const cy = Math.min(63, Math.max(0, ((y - minY) / spanY * 63) | 0));
          const idx = cy * 64 + cx;
          if (!cells[idx]) { cells[idx] = 1; filled++; }
        }
        if (filled < 340) continue; // a bare loop, not a texture — try the next

        // Accepted. Fit it into the frame, turning it a quarter turn when that
        // fills a tall phone better — most attractors are wider than they are
        // high, and a phone is the opposite.
        seed = trySeed;
        family = fam;
        params = p;
        const upright = Math.min(bufW / spanX, bufH / spanY);
        const turned = Math.min(bufW / spanY, bufH / spanX);
        swap = turned > upright;
        const spanU = swap ? spanY : spanX;
        const spanV = swap ? spanX : spanY;
        const midU = swap ? (minY + maxY) / 2 : (minX + maxX) / 2;
        const midV = swap ? (minX + maxX) / 2 : (minY + maxY) / 2;
        const fit = Math.min(bufW / spanU, bufH / spanV) * 0.98;
        scale = fit;
        panX = bufW / 2 - midU * fit;
        panY = bufH / 2 - midV * fit;

        palette = cosinePalette(r);
        const base = palette(r());
        ink = [
          Math.round(6 + base[0] * 16),
          Math.round(6 + base[1] * 16),
          Math.round(10 + base[2] * 20)
        ];
        lut = buildLut(palette, ink);
        return true;
      }
      return false;
    }

    function resetRun(newSeed) {
      if (!compose(newSeed)) compose(randomSeed());
      if (acc) acc.fill(0);
      maxDensity = 1;
      framesDone = 0;
      settled = false;
      ox = 0.1;
      oy = 0.1;
      for (let i = 0; i < WARMUP; i++) {
        const n = family.step(ox, oy, params);
        ox = n[0]; oy = n[1];
      }
      // Clear the display for the direct-draw fallback, which paints cumulatively.
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.fillStyle = `rgb(${ink[0]},${ink[1]},${ink[2]})`;
      g.fillRect(0, 0, ctx.width, ctx.height);
      if (seedChip) seedChip.textContent = seedLabel(seed);
      if (famChip) famChip.textContent = family.name;
    }

    // ---- accumulation and rendering ----------------------------------------
    function accumulate(steps) {
      const step = family.step;
      const p = params;
      let x = ox, y = oy;

      if (acc) {
        for (let i = 0; i < steps; i++) {
          const n = step(x, y, p);
          x = n[0]; y = n[1];
          const px = ((swap ? y : x) * scale + panX) | 0;
          const py = ((swap ? x : y) * scale + panY) | 0;
          if (px >= 0 && px < bufW && py >= 0 && py < bufH) {
            const idx = py * bufW + px;
            const d = acc[idx] + 1;
            acc[idx] = d;
            if (d > maxDensity) maxDensity = d;
          }
        }
      } else {
        // Fallback: additive dots straight onto the display canvas.
        const sx = ctx.width / bufW, sy = ctx.height / bufH;
        const rgb = palette(0.7);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.055;
        g.fillStyle = `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
        for (let i = 0; i < steps; i++) {
          const n = step(x, y, p);
          x = n[0]; y = n[1];
          const px = ((swap ? y : x) * scale + panX) * sx;
          const py = ((swap ? x : y) * scale + panY) * sy;
          if (px >= 0 && px < ctx.width && py >= 0 && py < ctx.height) {
            g.fillRect(px, py, 1, 1);
          }
        }
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
      }

      ox = x;
      oy = y;
    }

    // Map density to colour. Log tone mapping is what makes an attractor read as
    // silk: a handful of cells collect thousands of hits while most collect two
    // or three, and a linear ramp would show only a bright core in a black field.
    //
    // Densities are integers, so the log curve is baked into a table indexed by
    // density and the per-pixel loop becomes four array reads. Rebuilding the
    // table costs maxDensity steps a frame instead of a log call per pixel.
    let idxTable = new Uint8Array(1024);

    function buildIdxTable() {
      const need = Math.max(2, (maxDensity | 0) + 1);
      if (idxTable.length < need) idxTable = new Uint8Array(need * 2);
      const inv = 255 / Math.log1p(maxDensity * 0.85);
      for (let d = 0; d < need; d++) {
        const v = Math.log1p(d * 0.85) * inv;
        idxTable[d] = v > 255 ? 255 : v;
      }
    }

    function tonemap() {
      if (!acc || !image) return;
      buildIdxTable();
      const data = image.data;
      const table = idxTable;
      for (let i = 0, o = 0; i < acc.length; i++, o += 4) {
        const l = table[acc[i]] * 3;
        data[o] = lut[l];
        data[o + 1] = lut[l + 1];
        data[o + 2] = lut[l + 2];
      }
      offG.putImageData(image, 0, 0);
    }

    function blit() {
      if (!off) return;
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.drawImage(off, 0, 0, ctx.width, ctx.height);
    }

    // ---- overlay ------------------------------------------------------------
    // Bits may not reach into the host document, so the whole overlay is declared
    // as markup on the runtime-owned root and the handles are queried back out.
    const FONT = "-apple-system,system-ui,'Segoe UI',sans-serif";
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    const chipCss =
      "pointer-events:none;display:inline-flex;align-items:center;gap:6px;" +
      "padding:7px 12px;border-radius:999px;background:rgba(10,10,18,0.42);" +
      "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
      "color:rgba(255,255,255,0.86);font:600 12px/1 " + FONT + ";" +
      "letter-spacing:0.14em;text-transform:uppercase;white-space:nowrap;" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.35);";
    const btnCss =
      "pointer-events:auto;width:42px;height:42px;border-radius:14px;border:none;" +
      "cursor:pointer;background:rgba(10,10,18,0.42);color:rgba(255,255,255,0.9);" +
      "font:600 17px/1 " + FONT + ";backdrop-filter:blur(10px);" +
      "-webkit-backdrop-filter:blur(10px);touch-action:manipulation;" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.35);";

    ui.innerHTML =
      '<div style="position:absolute;left:14px;right:14px;top:' + (ctx.safeArea.top + 12) + 'px;' +
        'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">' +
          '<span style="' + chipCss + '">Seed <b data-el="seed" style="letter-spacing:0.2em;">—</b></span>' +
          '<span data-el="family" style="' + chipCss + 'opacity:0.62;font-size:10px;">—</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button data-el="help" aria-label="How it works" style="' + btnCss + '">?</button>' +
          '<button data-el="again" aria-label="New seed" style="' + btnCss + '">↻</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="hint" style="position:absolute;left:0;right:0;' +
        'bottom:calc(' + ctx.safeArea.bottom + 'px + 26px);text-align:center;' +
        'pointer-events:none;color:rgba(255,255,255,0.6);font:500 13px/1 ' + FONT + ';' +
        'letter-spacing:0.08em;transition:opacity 700ms ease;text-shadow:0 1px 8px rgba(0,0,0,0.6);">' +
        'tap anywhere for a new seed</div>' +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;' +
        'align-items:center;justify-content:center;padding:28px;pointer-events:auto;' +
        'background:rgba(6,6,12,0.8);backdrop-filter:blur(6px);' +
        '-webkit-backdrop-filter:blur(6px);">' +
        '<div style="max-width:330px;color:#eef;font:400 15px/1.6 ' + FONT + ';">' +
          '<h2 style="font-size:21px;margin-bottom:6px;letter-spacing:0.02em;">Strange Silk</h2>' +
          '<p style="opacity:0.62;font-size:13px;margin-bottom:16px;">Nobody draws this. ' +
            'A chaotic equation is iterated a million times and the picture is simply ' +
            'where its orbit spent time.</p>' +
          '<ul style="list-style:none;display:grid;gap:11px;">' +
            '<li>• <b>Tap anywhere</b> for a new seed — a new equation, new constants, new colours.</li>' +
            '<li>• The seed shown at the top is the whole painting. The same seed always paints the same picture.</li>' +
            '<li>• Bright threads are places the orbit returns to again and again.</li>' +
          '</ul>' +
          '<p style="margin-top:18px;opacity:0.55;font-size:13px;">Tap to close.</p>' +
        '</div>' +
      '</div>';

    const seedChip = ui.querySelector('[data-el="seed"]');
    const famChip = ui.querySelector('[data-el="family"]');
    const hint = ui.querySelector('[data-el="hint"]');
    const panel = ui.querySelector('[data-el="panel"]');
    const helpBtn = ui.querySelector('[data-el="help"]');
    const againBtn = ui.querySelector('[data-el="again"]');

    function flashHint(text) {
      hint.textContent = text;
      hint.style.opacity = "1";
      ctx.timeout(() => { hint.style.opacity = "0"; }, 2800);
    }

    // ---- music --------------------------------------------------------------
    async function startMusic() {
      if (music || !ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({
          preset: "drift",
          volume: 0.34,
          fadeInMs: 2400,
          intensity: 0.3
        });
      } catch (err) {
        ctx.platform.error({ where: "music", message: String(err) });
      }
    }

    // ---- interaction --------------------------------------------------------
    function reseed(source) {
      resetRun(randomSeed());
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
      if (music) { try { music.sting("tap"); } catch (e) { /* non-fatal */ } }
      ctx.platform.interact({ type: "reseed", seed: seedLabel(seed), family: family.name, source });
    }

    function firstGesture() {
      if (started) return;
      started = true;
      ctx.platform.start();
      startMusic();
      hint.style.opacity = "0";
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      reseed("canvas");
    }, { passive: false });

    ctx.listen(againBtn, "click", (e) => {
      e.stopPropagation();
      firstGesture();
      reseed("button");
    });

    ctx.listen(helpBtn, "click", (e) => {
      e.stopPropagation();
      firstGesture();
      panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    });

    ctx.listen(panel, "click", () => { panel.style.display = "none"; });

    // ---- boot ---------------------------------------------------------------
    sizeBuffers();
    lastW = ctx.width;
    lastH = ctx.height;
    resetRun(seed);

    // Put something real on screen before telling the host we are ready.
    accumulate(BATCH * 3);
    framesDone = 3;
    tonemap();
    blit();
    ctx.markVisualReady("first-accumulation");

    ctx.onFrame(() => {
      // Rotation or a resized container: rebuild at the new size, same seed.
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        sizeBuffers();
        resetRun(seed);
      }

      if (settled) return;

      accumulate(BATCH);
      framesDone++;
      tonemap();
      blit();

      if (framesDone >= FRAMES) {
        settled = true;
        ctx.platform.milestone("print_settled", { seed: seedLabel(seed), family: family.name });
      }
    });

    flashHint("tap anywhere for a new seed");
    ctx.platform.ready();
  }
};
