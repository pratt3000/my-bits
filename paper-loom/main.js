// Paper Loom — a generative Plethora Bit.
//
// A print that lays itself out. The page is cut in two, then each half is cut in
// two, and so on until the pieces are small enough to be worth looking at; every
// piece then picks a motif from a small vocabulary — Truchet arcs, chevrons,
// half-discs, rings — and a colour from a single palette. Nothing is placed by
// hand, and yet the result composes, because the rules that generate it are the
// same rules a designer would use.
//
// Tap for a new seed. The composition rebuilds itself in front of you.

window.plethoraBit = {
  meta: {
    title: "Paper Loom",
    runtime: "plethora-bit@2",
    tags: ["generative", "art", "design", "abstract", "pattern", "calm", "poster"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    const REVEAL_MS = 430;   // how long one piece takes to arrive
    const STAGGER_MS = 900;  // spread of arrival times across the whole page

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

    // ---- palettes -----------------------------------------------------------
    // Flat, printerly palettes. The generator is only as tasteful as its colours,
    // so these are chosen rather than sampled.
    const PALETTES = [
      { name: "Bauhaus", paper: "#efe7d8", colors: ["#d1462f", "#1c4e80", "#f0b323", "#1a1a1a", "#e2d5bd"] },
      { name: "Riso",    paper: "#f7f2e8", colors: ["#ff4f58", "#0f7ac7", "#ffc700", "#2b2b2b", "#00a878"] },
      { name: "Terrazzo",paper: "#f2ede4", colors: ["#e46b5f", "#7a9e7e", "#f0c05a", "#3d4a5c", "#cf9b7f"] },
      { name: "Midnight",paper: "#12131a", colors: ["#f2f0e6", "#e5644e", "#4a90d9", "#f2c14e", "#7b6ce6"] },
      { name: "Sand",    paper: "#e9dfc9", colors: ["#b5651d", "#7c8c69", "#d9b26f", "#3a3a35", "#a4674f"] },
      { name: "Ink",     paper: "#f4f4f2", colors: ["#111111", "#c8102e", "#d9d9d6", "#7a7a78", "#1b1b1b"] },
      { name: "Coast",   paper: "#eef3f4", colors: ["#14505c", "#4f9d9d", "#f0a04b", "#d8c7a8", "#1d1d1d"] },
      { name: "Bloom",   paper: "#fbf0f3", colors: ["#e0507a", "#6a4c93", "#f2b134", "#2d3047", "#8ac6d1"] },
      { name: "Cobalt",  paper: "#0d1b2a", colors: ["#e0e1dd", "#f4a261", "#48cae4", "#e63946", "#a8dadc"] },
      { name: "Moss",    paper: "#e6e8dc", colors: ["#38452f", "#8a9a5b", "#c2703d", "#dcd6c1", "#1f2a1a"] }
    ];

    const MOTIFS = [
      "arcs", "halfdisc", "rings", "stripes", "chevron",
      "dots", "quarter", "cross", "wedge", "sunburst", "eye", "checker", "flat"
    ];

    // ---- surfaces -----------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const hasOffscreen = typeof OffscreenCanvas === "function";

    // ---- run state ----------------------------------------------------------
    let seed = randomSeed();
    let palette = PALETTES[0];
    let cells = [];
    let art = { x: 0, y: 0, w: 1, h: 1 };
    let grain = null;
    let elapsed = 0;
    let settled = false;
    let started = false, music = null;
    let lastW = 0, lastH = 0;

    function artRect() {
      const margin = Math.min(ctx.width, ctx.height) * 0.052;
      const top = ctx.safeArea.top + 64;
      const bottom = ctx.safeArea.bottom + 50;
      return {
        x: margin,
        y: top,
        w: Math.max(20, ctx.width - margin * 2),
        h: Math.max(20, ctx.height - top - bottom)
      };
    }

    // Cut the page down until the pieces are small enough. Splitting the longer
    // side keeps the generator from producing slivers, and the ratios are the
    // ones a person reaches for — halves, thirds, the golden section.
    const RATIOS = [0.5, 0.5, 0.382, 0.618, 0.333, 0.667, 0.28, 0.72];

    function subdivide(x, y, w, h, depth, r, minCell, out) {
      const short = Math.min(w, h);
      const chance = depth < 3 ? 1 : Math.max(0.4, 0.99 - depth * 0.085);
      if (depth < 8 && short > minCell && r() < chance) {
        const vertical = w > h * 1.14 ? true : h > w * 1.14 ? false : r() < 0.5;
        const t = RATIOS[Math.floor(r() * RATIOS.length)];
        if (vertical) {
          const cut = Math.round(w * t);
          if (cut > 2 && w - cut > 2) {
            subdivide(x, y, cut, h, depth + 1, r, minCell, out);
            subdivide(x + cut, y, w - cut, h, depth + 1, r, minCell, out);
            return;
          }
        } else {
          const cut = Math.round(h * t);
          if (cut > 2 && h - cut > 2) {
            subdivide(x, y, w, cut, depth + 1, r, minCell, out);
            subdivide(x, y + cut, w, h - cut, depth + 1, r, minCell, out);
            return;
          }
        }
      }
      out.push({ x, y, w, h, depth });
    }

    function compose(fromSeed) {
      seed = fromSeed % (SEED_MAX + 1);
      const r = mulberry32((seed ^ 0x27d4eb2f) >>> 0);
      palette = PALETTES[Math.floor(r() * PALETTES.length)];
      art = artRect();

      const minCell = Math.min(art.w, art.h) * (0.085 + r() * 0.075);
      cells = [];
      subdivide(art.x, art.y, art.w, art.h, 0, r, minCell, cells);

      // How much of the page stays quiet. A composition that patterns every
      // single piece reads as noise; empty ground is what makes the rest land.
      const density = 0.5 + r() * 0.35;
      // Each composition draws from a subset of the vocabulary, so a page has a
      // recognisable accent instead of showing off every motif at once.
      const vocab = [];
      const vocabSize = 3 + Math.floor(r() * 4);
      const pool = MOTIFS.slice();
      for (let i = 0; i < vocabSize && pool.length; i++) {
        vocab.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
      }

      const order = ["random", "wipe", "radial", "columns"][Math.floor(r() * 4)];
      const cx = art.x + art.w / 2, cy = art.y + art.h / 2;
      const diag = Math.hypot(art.w, art.h) || 1;

      for (const c of cells) {
        c.k = [r(), r(), r(), r(), r(), r()];
        const patterned = r() < density;
        c.motif = patterned ? vocab[Math.floor(r() * vocab.length)] : "flat";

        // Half the pieces sit on the paper; the rest carry a colour field.
        const n = palette.colors.length;
        const onColor = r() < 0.6;
        const bgIdx = Math.floor(r() * n);
        c.bg = onColor ? palette.colors[bgIdx] : palette.paper;
        // The foreground must differ from its ground or the motif disappears.
        let fgIdx = Math.floor(r() * n);
        if (onColor && fgIdx === bgIdx) fgIdx = (bgIdx + 1 + Math.floor(r() * (n - 1))) % n;
        c.fg = palette.colors[fgIdx];
        c.fg2 = palette.colors[(fgIdx + 2) % n];

        let t;
        if (order === "wipe") t = (c.x - art.x + c.y - art.y) / (art.w + art.h);
        else if (order === "radial") t = Math.hypot(c.x + c.w / 2 - cx, c.y + c.h / 2 - cy) / (diag / 2);
        else if (order === "columns") t = (c.x - art.x) / art.w;
        else t = c.k[5];
        c.delay = Math.min(1, Math.max(0, t)) * STAGGER_MS + c.k[4] * 90;
      }

      elapsed = 0;
      settled = false;
      buildGrain(r);

      if (seedChip) seedChip.textContent = seedLabel(seed);
      if (nameChip) nameChip.textContent = palette.name + " · " + cells.length + " pieces";
    }

    // A tile of noise, laid over the finished page so it reads as printed ink on
    // stock rather than flat screen colour.
    function buildGrain(r) {
      if (!hasOffscreen) { grain = null; return; }
      try {
        const size = 96;
        const tile = new OffscreenCanvas(size, size);
        const tg = tile.getContext("2d");
        const img = tg.createImageData(size, size);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = 118 + (r() * 74) | 0;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        tg.putImageData(img, 0, 0);
        grain = g.createPattern(tile, "repeat");
      } catch (e) {
        grain = null;
      }
    }

    // ---- motifs -------------------------------------------------------------
    function drawMotif(c) {
      const { x, y, w, h, k, fg, fg2 } = c;
      const s = Math.min(w, h);

      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();

      g.fillStyle = c.bg;
      g.fillRect(x, y, w, h);
      g.fillStyle = fg;
      g.strokeStyle = fg;

      switch (c.motif) {
        case "arcs": {
          // Truchet: two quarter-arcs on opposite corners. Neighbours line up by
          // accident and the eye joins them into long meandering curves.
          const rad = s / 2;
          g.lineWidth = s * (0.13 + k[1] * 0.14);
          g.lineCap = "butt";
          if (k[2] < 0.5) {
            g.beginPath(); g.arc(x, y, rad, 0, Math.PI / 2); g.stroke();
            g.beginPath(); g.arc(x + w, y + h, rad, Math.PI, Math.PI * 1.5); g.stroke();
          } else {
            g.beginPath(); g.arc(x + w, y, rad, Math.PI / 2, Math.PI); g.stroke();
            g.beginPath(); g.arc(x, y + h, rad, Math.PI * 1.5, Math.PI * 2); g.stroke();
          }
          break;
        }
        case "halfdisc": {
          const turn = Math.floor(k[0] * 4) * (Math.PI / 2);
          g.save();
          g.translate(x + w / 2, y + h / 2);
          g.rotate(turn);
          g.beginPath();
          g.arc(0, Math.min(w, h) / 2, s * 0.5, Math.PI, Math.PI * 2);
          g.fill();
          g.restore();
          break;
        }
        case "rings": {
          const n = 2 + Math.floor(k[1] * 4);
          g.lineWidth = s * 0.07;
          const ccx = x + w * (0.3 + k[2] * 0.4);
          const ccy = y + h * (0.3 + k[3] * 0.4);
          for (let i = 1; i <= n; i++) {
            g.strokeStyle = i % 2 ? fg : fg2;
            g.beginPath();
            g.arc(ccx, ccy, (s * 0.46 * i) / n, 0, Math.PI * 2);
            g.stroke();
          }
          break;
        }
        case "stripes": {
          const turn = Math.floor(k[0] * 4) * (Math.PI / 4);
          const gap = s * (0.14 + k[1] * 0.16);
          g.save();
          g.translate(x + w / 2, y + h / 2);
          g.rotate(turn);
          g.fillStyle = fg;
          const reach = (w + h) * 0.75;
          for (let p = -reach; p < reach; p += gap * 2) {
            g.fillRect(p, -reach, gap, reach * 2);
          }
          g.restore();
          break;
        }
        case "chevron": {
          const n = 2 + Math.floor(k[1] * 4);
          g.lineWidth = s * 0.09;
          g.lineJoin = "miter";
          const turn = Math.floor(k[0] * 4) * (Math.PI / 2);
          g.save();
          g.translate(x + w / 2, y + h / 2);
          g.rotate(turn);
          for (let i = 0; i < n; i++) {
            const off = (i / n - 0.4) * s;
            g.strokeStyle = i % 2 ? fg : fg2;
            g.beginPath();
            g.moveTo(-w * 0.6, off + s * 0.24);
            g.lineTo(0, off - s * 0.16);
            g.lineTo(w * 0.6, off + s * 0.24);
            g.stroke();
          }
          g.restore();
          break;
        }
        case "dots": {
          const cols = 2 + Math.floor(k[0] * 3);
          const rows = Math.max(1, Math.round((cols * h) / w));
          const rr = Math.min(w / cols, h / rows) * (0.22 + k[1] * 0.2);
          for (let iy = 0; iy < rows; iy++) {
            for (let ix = 0; ix < cols; ix++) {
              g.fillStyle = (ix + iy) % 2 ? fg : fg2;
              g.beginPath();
              g.arc(x + ((ix + 0.5) * w) / cols, y + ((iy + 0.5) * h) / rows, rr, 0, Math.PI * 2);
              g.fill();
            }
          }
          break;
        }
        case "quarter": {
          const corner = Math.floor(k[0] * 4);
          const px = corner === 1 || corner === 2 ? x + w : x;
          const py = corner >= 2 ? y + h : y;
          g.beginPath();
          g.moveTo(px, py);
          g.arc(px, py, Math.max(w, h) * (0.7 + k[1] * 0.35), 0, Math.PI * 2);
          g.closePath();
          g.fill();
          break;
        }
        case "cross": {
          const t = s * (0.16 + k[1] * 0.18);
          g.fillRect(x + w / 2 - t / 2, y, t, h);
          g.fillStyle = fg2;
          g.fillRect(x, y + h / 2 - t / 2, w, t);
          break;
        }
        case "wedge": {
          const corner = Math.floor(k[0] * 4);
          g.beginPath();
          if (corner === 0) { g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x, y + h); }
          else if (corner === 1) { g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x, y); }
          else if (corner === 2) { g.moveTo(x + w, y + h); g.lineTo(x, y + h); g.lineTo(x + w, y); }
          else { g.moveTo(x, y + h); g.lineTo(x, y); g.lineTo(x + w, y + h); }
          g.closePath();
          g.fill();
          break;
        }
        case "sunburst": {
          const corner = Math.floor(k[0] * 4);
          const px = corner === 1 || corner === 2 ? x + w : x;
          const py = corner >= 2 ? y + h : y;
          const n = 5 + Math.floor(k[1] * 7);
          g.lineWidth = s * 0.055;
          const reach = Math.hypot(w, h) * 1.05;
          const base = corner === 0 ? 0 : corner === 1 ? Math.PI / 2 : corner === 2 ? Math.PI : Math.PI * 1.5;
          for (let i = 0; i <= n; i++) {
            const a = base + (i / n) * (Math.PI / 2);
            g.strokeStyle = i % 2 ? fg : fg2;
            g.beginPath();
            g.moveTo(px, py);
            g.lineTo(px + Math.cos(a) * reach, py + Math.sin(a) * reach);
            g.stroke();
          }
          break;
        }
        case "eye": {
          const ccx = x + w / 2, ccy = y + h / 2;
          g.beginPath(); g.arc(ccx, ccy, s * 0.4, 0, Math.PI * 2); g.fill();
          g.fillStyle = fg2;
          g.beginPath();
          g.arc(ccx + (k[2] - 0.5) * s * 0.16, ccy + (k[3] - 0.5) * s * 0.16, s * (0.1 + k[1] * 0.12), 0, Math.PI * 2);
          g.fill();
          break;
        }
        case "checker": {
          const n = 2 + Math.floor(k[0] * 3);
          const cw = w / n, ch = h / n;
          for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
              if ((ix + iy) % 2) continue;
              g.fillRect(x + ix * cw, y + iy * ch, cw + 0.5, ch + 0.5);
            }
          }
          break;
        }
        default:
          break; // "flat" — the ground colour is the whole piece
      }

      g.restore();
    }

    // ---- rendering ----------------------------------------------------------
    function draw() {
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.fillStyle = palette.paper;
      g.fillRect(0, 0, ctx.width, ctx.height);

      let pending = false;
      for (const c of cells) {
        const t = (elapsed - c.delay) / REVEAL_MS;
        if (t <= 0) { pending = true; continue; }
        if (t < 1) pending = true;
        const e = t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);

        g.save();
        g.globalAlpha = e;
        if (e < 1) {
          const ccx = c.x + c.w / 2, ccy = c.y + c.h / 2;
          const sc = 0.88 + 0.12 * e;
          g.translate(ccx, ccy);
          g.scale(sc, sc);
          g.translate(-ccx, -ccy);
        }
        drawMotif(c);
        g.restore();
      }
      g.globalAlpha = 1;

      if (grain) {
        g.globalCompositeOperation = "overlay";
        g.globalAlpha = 0.075;
        g.fillStyle = grain;
        g.fillRect(0, 0, ctx.width, ctx.height);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
      }

      return !pending;
    }

    // ---- overlay ------------------------------------------------------------
    const FONT = "-apple-system,system-ui,'Segoe UI',sans-serif";
    const ui = ctx.createRoot({ touchAction: "none" });
    ui.style.pointerEvents = "none";

    const chipCss =
      "pointer-events:none;display:inline-flex;align-items:center;gap:6px;" +
      "padding:7px 12px;border-radius:999px;background:rgba(22,22,26,0.5);" +
      "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
      "color:rgba(255,255,255,0.92);font:600 12px/1 " + FONT + ";" +
      "letter-spacing:0.14em;text-transform:uppercase;white-space:nowrap;" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.28);";
    const btnCss =
      "pointer-events:auto;width:42px;height:42px;border-radius:14px;border:none;" +
      "cursor:pointer;background:rgba(22,22,26,0.5);color:rgba(255,255,255,0.94);" +
      "font:600 17px/1 " + FONT + ";backdrop-filter:blur(10px);" +
      "-webkit-backdrop-filter:blur(10px);touch-action:manipulation;" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.28);";

    ui.innerHTML =
      '<div style="position:absolute;left:14px;right:14px;top:' + (ctx.safeArea.top + 12) + 'px;' +
        'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">' +
          '<span style="' + chipCss + '">Seed <b data-el="seed" style="letter-spacing:0.2em;">—</b></span>' +
          '<span data-el="name" style="' + chipCss + 'opacity:0.66;font-size:10px;">—</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button data-el="help" aria-label="How it works" style="' + btnCss + '">?</button>' +
          '<button data-el="again" aria-label="New composition" style="' + btnCss + '">↻</button>' +
        '</div>' +
      '</div>' +
      '<div data-el="hint" style="position:absolute;left:0;right:0;' +
        'bottom:calc(' + ctx.safeArea.bottom + 'px + 18px);text-align:center;' +
        'pointer-events:none;color:rgba(120,120,130,0.95);font:500 12px/1 ' + FONT + ';' +
        'letter-spacing:0.12em;text-transform:uppercase;transition:opacity 700ms ease;">' +
        'tap for a new composition</div>' +
      '<div data-el="panel" style="position:absolute;inset:0;display:none;' +
        'align-items:center;justify-content:center;padding:28px;pointer-events:auto;' +
        'background:rgba(10,10,14,0.86);backdrop-filter:blur(6px);' +
        '-webkit-backdrop-filter:blur(6px);">' +
        '<div style="max-width:330px;color:#eef;font:400 15px/1.6 ' + FONT + ';">' +
          '<h2 style="font-size:21px;margin-bottom:6px;letter-spacing:0.02em;">Paper Loom</h2>' +
          '<p style="opacity:0.62;font-size:13px;margin-bottom:16px;">The page cuts itself in ' +
            'two, then cuts each half in two, until the pieces are worth looking at. Each piece ' +
            'then picks a motif and a colour on its own.</p>' +
          '<ul style="list-style:none;display:grid;gap:11px;">' +
            '<li>• <b>Tap anywhere</b> for a new seed — new cuts, new motifs, new palette.</li>' +
            '<li>• Watch the pieces arrive: the order they land in is part of the seed too.</li>' +
            '<li>• Ten palettes, thirteen motifs, and a page that never repeats.</li>' +
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
        music = await ctx.music.play({ preset: "cozy", volume: 0.28, fadeInMs: 2200, intensity: 0.28 });
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
    }

    function reseed(source) {
      compose(randomSeed());
      if (ctx.capabilities.haptics) ctx.platform.haptic("light");
      if (music) { try { music.sting("tap"); } catch (e) { /* non-fatal */ } }
      ctx.platform.interact({ type: "reseed", source, seed: seedLabel(seed), palette: palette.name });
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      reseed("canvas");
    }, { passive: false });

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
    // Open on a page that is already half printed — bare paper is technically a
    // first frame but it is not worth looking at — and let the rest land.
    elapsed = (STAGGER_MS + REVEAL_MS) * 0.5;
    draw();
    ctx.markVisualReady("half-printed");

    ctx.onFrame((dtMs) => {
      if (ctx.width !== lastW || ctx.height !== lastH) {
        lastW = ctx.width;
        lastH = ctx.height;
        compose(seed);
        elapsed = STAGGER_MS + REVEAL_MS;
        draw();
        settled = true;
        return;
      }
      if (settled) return; // a finished print costs nothing to keep on screen
      elapsed += dtMs;
      if (draw()) {
        settled = true;
        ctx.platform.milestone("page_printed", { seed: seedLabel(seed), palette: palette.name });
      }
    });

    ctx.timeout(() => { hint.style.opacity = "0"; }, 4200);
    ctx.platform.ready();
  }
};
