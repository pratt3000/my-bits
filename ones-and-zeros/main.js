// Ones & Zeros — Conway's Game of Life drawn as a living field of digits.
//
// Rules are the classic B3/S23 on a wrapping (toroidal) grid. What is not
// classic is the colour: a newborn cell inherits the circular mean of the three
// neighbours that produced it, so hues are a lineage — you can watch a colour
// travel across the board inside a glider, and see two colonies blend where
// they collide.
//
// Age drives the glyph. A cell is born as a bright "1", crossfades into a
// glowing dot over its first few generations, and dims and drifts in hue the
// longer it survives. The instant it dies it flashes a "0" that fades out.
//
// Everything is procedural: no dependencies, no packaged assets, and the
// starting boards are generated in code.

window.plethoraBit = {
  meta: {
    title: "Ones & Zeros",
    runtime: "plethora-bit@2",
    tags: ["game-of-life", "cellular-automata", "generative", "simulation", "art", "sandbox", "relaxing", "toy"],
    permissions: ["haptics", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    // ---- helpers -----------------------------------------------------------
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const randInt = (n) => Math.floor(Math.random() * n);
    const DEG = Math.PI / 180;
    const FONT = "-apple-system,system-ui,Segoe UI,Roboto,sans-serif";

    const SPEEDS = [
      { label: "🐢", gps: 3 },
      { label: "🐇", gps: 8 },
      { label: "⚡", gps: 16 }
    ];
    const POP_MS = 150;       // birth animation
    const GHOST_MS = 420;     // how long a "0" lingers
    const MORPH = 4;          // generations for 1 -> dot
    const DRIFT = 0.6;        // hue degrees a survivor drifts per generation

    // ---- stamps ------------------------------------------------------------
    // Classic patterns, written as art so they stay readable.
    const STAMPS = [
      { label: "Glider", art: [".O.", "..O", "OOO"] },
      { label: "Ship", art: ["O..O.", "....O", "O...O", ".OOOO"] },
      { label: "R-pento", art: [".OO", "OO.", ".O."] },
      { label: "Acorn", art: [".O.....", "...O...", "OO..OOO"] },
      { label: "Diehard", art: ["......O.", "OO......", ".O...OOO"] },
      {
        label: "Pulsar", art: [
          "..OOO...OOO..",
          ".............",
          "O....O.O....O",
          "O....O.O....O",
          "O....O.O....O",
          "..OOO...OOO..",
          ".............",
          "..OOO...OOO..",
          "O....O.O....O",
          "O....O.O....O",
          "O....O.O....O",
          ".............",
          "..OOO...OOO.."
        ]
      },
      { label: "Pentadec", art: ["..O....O..", "OO.OOOO.OO", "..O....O.."] },
      {
        label: "Gun", art: [
          "........................O...........",
          "......................O.O...........",
          "............OO......OO............OO",
          "...........O...O....OO............OO",
          "OO........O.....O...OO..............",
          "OO........O...O.OO....O.O...........",
          "..........O.....O.......O...........",
          "...........O...O....................",
          "............OO......................"
        ]
      }
    ];
    for (const s of STAMPS) {
      s.w = s.art.reduce((m, r) => Math.max(m, r.length), 0);
      s.h = s.art.length;
      s.cells = [];
      s.art.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === "O") s.cells.push([x, y]);
      });
    }

    // ---- colour table ------------------------------------------------------
    // Cells are drawn thousands of times a second, so every colour string is
    // built once here and then indexed, instead of composed per cell per frame.
    const HUES = 48;
    const LITS = 8;
    const PALETTE = new Array(HUES * LITS);
    for (let h = 0; h < HUES; h++) {
      for (let l = 0; l < LITS; l++) {
        const t = l / (LITS - 1);                       // 0 = newborn, 1 = ancient
        // Vivid rather than pastel: on black, anything above ~78% lightness
        // washes out to white and the hue lineage stops being readable.
        PALETTE[h * LITS + l] = "hsl(" + Math.round(h * 360 / HUES) + "," +
          Math.round(100 - t * 14) + "%," + Math.round(72 - t * 18) + "%)";
      }
    }
    const GHOST_COLORS = new Array(HUES);
    for (let h = 0; h < HUES; h++) {
      GHOST_COLORS[h] = "hsl(" + Math.round(h * 360 / HUES) + ",68%,56%)";
    }
    // deg 0..360 -> palette entry at the given age step (0 = newborn).
    const paint = (deg, lit) => PALETTE[((deg / 7.5) | 0) % HUES * LITS + lit];

    // ---- surfaces ----------------------------------------------------------
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const ui = ctx.createRoot({ touchAction: "manipulation" });
    ui.style.pointerEvents = "none";

    let W = ctx.width;
    let H = ctx.height;

    // ---- grid --------------------------------------------------------------
    let cols = 0;
    let rows = 0;
    let cell = 12;
    let n = 0;
    let alive, next, age, hue, bornAt, diedAt, ghostHue, hcos, hsin;
    let generation = 0;
    let population = 0;
    let glyphFont = 'ui-monospace,SFMono-Regular,Menlo,monospace';

    // `preserve` carries the overlapping part of the board across a resize, so
    // rotating the phone does not throw away what someone just drew.
    function layout(preserve) {
      const oldCols = cols;
      const oldRows = rows;
      const oldAlive = alive;
      const oldAge = age;
      const oldHue = hue;

      const target = clamp(Math.min(W, H) / 34, 9, 18);
      cols = Math.max(24, Math.round(W / target));
      cell = W / cols;
      rows = Math.max(20, Math.ceil(H / cell));
      n = cols * rows;
      alive = new Uint8Array(n);
      next = new Uint8Array(n);
      age = new Uint16Array(n);
      hue = new Float32Array(n);
      bornAt = new Float32Array(n);
      diedAt = new Float32Array(n);
      ghostHue = new Float32Array(n);
      hcos = new Float32Array(n);
      hsin = new Float32Array(n);
      for (let i = 0; i < n; i++) diedAt[i] = -1e9;

      if (preserve && oldAlive) {
        const cw = Math.min(oldCols, cols);
        const ch = Math.min(oldRows, rows);
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            const src = y * oldCols + x;
            if (!oldAlive[src]) continue;
            const dst = y * cols + x;
            alive[dst] = 1;
            age[dst] = oldAge[src];
            hue[dst] = oldHue[src];
            bornAt[dst] = -1e9;          // already settled, so no birth pop
          }
        }
      }
    }

    const idx = (x, y) => ((y + rows) % rows) * cols + ((x + cols) % cols);

    function setCell(x, y, on, h, now) {
      const i = idx(x, y);
      if (on) {
        if (!alive[i]) { alive[i] = 1; age[i] = 0; bornAt[i] = now; }
        hue[i] = (h % 360 + 360) % 360;
      } else if (alive[i]) {
        alive[i] = 0;
        age[i] = 0;
        diedAt[i] = now;
        ghostHue[i] = hue[i];
      }
    }

    // ---- board generators --------------------------------------------------
    // Four recipes, so the dice button keeps producing different-looking runs.
    function clearBoard(now) {
      for (let i = 0; i < n; i++) {
        if (alive[i]) { alive[i] = 0; diedAt[i] = now; ghostHue[i] = hue[i]; }
        age[i] = 0;
      }
      generation = 0;
    }

    function generate(now, recipe) {
      clearBoard(now);
      const pick = recipe != null ? recipe : randInt(4);
      const baseHue = Math.random() * 360;

      if (pick === 0) {
        // Mirror-symmetric soup: symmetry survives for a while and looks
        // deliberate before chaos eats it.
        const bw = Math.floor(cols / 2);
        const bh = Math.floor(rows / 2);
        const x0 = Math.floor(cols * 0.08);
        const y0 = Math.floor(rows * 0.10);
        for (let y = y0; y < bh; y++) {
          for (let x = x0; x < bw; x++) {
            if (Math.random() > 0.46) continue;
            const h = baseHue + (x / cols) * 120;
            setCell(x, y, true, h, now);
            setCell(cols - 1 - x, y, true, h + 40, now);
            setCell(x, rows - 1 - y, true, h + 80, now);
            setCell(cols - 1 - x, rows - 1 - y, true, h + 120, now);
          }
        }
      } else if (pick === 1) {
        // Rainbow band across the middle.
        const y0 = Math.floor(rows * 0.3);
        const y1 = Math.floor(rows * 0.7);
        for (let y = y0; y < y1; y++) {
          for (let x = 2; x < cols - 2; x++) {
            if (Math.random() > 0.34) continue;
            setCell(x, y, true, baseHue + (x / cols) * 300, now);
          }
        }
      } else if (pick === 2) {
        // A scattering of known patterns, each its own colour lineage.
        const kinds = STAMPS.filter((s) => s.w <= cols - 2 && s.h <= rows - 2 && s.w < 12);
        const count = clamp(Math.round((cols * rows) / 900), 3, 10);
        for (let k = 0; k < count; k++) {
          const s = kinds[randInt(kinds.length)];
          stamp(s, 2 + randInt(Math.max(1, cols - s.w - 4)), 2 + randInt(Math.max(1, rows - s.h - 4)),
            baseHue + k * (360 / count), now, true);
        }
      } else {
        // Rings of cells — collapses into a firework of gliders.
        const cx = cols / 2;
        const cy = rows / 2;
        const rings = 2 + randInt(2);
        for (let r = 0; r < rings; r++) {
          const rad = (Math.min(cols, rows) * 0.12) * (r + 1);
          const steps = Math.round(rad * 5);
          for (let s = 0; s < steps; s++) {
            const a = (s / steps) * Math.PI * 2;
            if (Math.random() > 0.7) continue;
            setCell(Math.round(cx + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad),
              true, baseHue + (a / Math.PI) * 90 + r * 40, now);
          }
        }
      }
      generation = 0;
    }

    // Drop a stamp with its top-left at (x, y), or centred when `corner` is off.
    function stamp(s, x, y, h, now, corner) {
      const ox = corner ? x : x - (s.w >> 1);
      const oy = corner ? y : y - (s.h >> 1);
      for (const [dx, dy] of s.cells) {
        setCell(ox + dx, oy + dy, true, h + (dx + dy) * 3, now);
      }
    }

    // A quiet board gets a nudge rather than sitting there as still lifes.
    function sprinkle(now) {
      const x = 3 + randInt(Math.max(1, cols - 6));
      const y = 3 + randInt(Math.max(1, rows - 6));
      const h = Math.random() * 360;
      const s = STAMPS[randInt(3)];
      stamp(s, x, y, h, now, true);
      for (let k = 0; k < 6; k++) {
        setCell(x + randInt(6) - 3, y + randInt(6) - 3, true, h + randInt(40), now);
      }
    }

    // ---- simulation --------------------------------------------------------
    let quiet = 0;            // consecutive generations with almost no change
    let lastTouch = -1e9;     // when the viewer last did something

    function step(now) {
      // Unit vectors for live hues, so a birth can take the circular mean of
      // its parents without doing trig eight times per cell.
      for (let i = 0; i < n; i++) {
        if (alive[i]) {
          const r = hue[i] * DEG;
          hcos[i] = Math.cos(r);
          hsin[i] = Math.sin(r);
        }
      }

      let births = 0;
      let deaths = 0;
      let pop = 0;

      for (let y = 0; y < rows; y++) {
        const up = ((y - 1 + rows) % rows) * cols;
        const mid = y * cols;
        const dn = ((y + 1) % rows) * cols;
        for (let x = 0; x < cols; x++) {
          const xl = (x - 1 + cols) % cols;
          const xr = (x + 1) % cols;
          const i = mid + x;
          let c = 0;
          let sx = 0;
          let sy = 0;
          let j;
          j = up + xl; if (alive[j]) { c++; sx += hcos[j]; sy += hsin[j]; }
          j = up + x;  if (alive[j]) { c++; sx += hcos[j]; sy += hsin[j]; }
          j = up + xr; if (alive[j]) { c++; sx += hcos[j]; sy += hsin[j]; }
          j = mid + xl; if (alive[j]) { c++; sx += hcos[j]; sy += hsin[j]; }
          j = mid + xr; if (alive[j]) { c++; sx += hcos[j]; sy += hsin[j]; }
          j = dn + xl; if (alive[j]) { c++; sx += hcos[j]; sy += hsin[j]; }
          j = dn + x;  if (alive[j]) { c++; sx += hcos[j]; sy += hsin[j]; }
          j = dn + xr; if (alive[j]) { c++; sx += hcos[j]; sy += hsin[j]; }

          if (alive[i]) {
            if (c === 2 || c === 3) {
              next[i] = 1;
              age[i] = age[i] < 65000 ? age[i] + 1 : age[i];
              hue[i] = (hue[i] + DRIFT) % 360;
              pop++;
            } else {
              next[i] = 0;
              age[i] = 0;
              diedAt[i] = now;
              ghostHue[i] = hue[i];
              deaths++;
            }
          } else if (c === 3) {
            next[i] = 1;
            age[i] = 0;
            bornAt[i] = now;
            // Circular mean of the three parents, plus a little mutation.
            let h = Math.atan2(sy, sx) / DEG + (Math.random() - 0.5) * 14;
            hue[i] = (h % 360 + 360) % 360;
            births++;
            pop++;
          } else {
            next[i] = 0;
          }
        }
      }

      const swap = alive;
      alive = next;
      next = swap;
      generation++;

      // Housekeeping: an empty board restarts, a stagnant one gets a sprinkle —
      // but never while the viewer is busy building something.
      const idle = now - lastTouch > 12000;
      if (pop === 0) {
        // A board someone just cleared is theirs to draw on — only reseed once
        // they have genuinely wandered off.
        if (now - lastTouch > 20000) { generate(now); say("A new colony seeded itself."); }
      } else if (births + deaths <= 2) {
        quiet++;
        if (quiet > 24 && idle) { sprinkle(now); quiet = 0; }
      } else {
        quiet = 0;
      }
    }

    // ---- rendering ---------------------------------------------------------
    // The static backdrop (vignette + faint cell grid) is baked once; only live
    // and just-died cells are drawn per frame.
    const back = document.createElement("canvas");
    const backCtx = back.getContext("2d");

    function buildBack() {
      const dpr = ctx.dpr || 1;
      back.width = Math.max(1, Math.round(W * dpr));
      back.height = Math.max(1, Math.round(H * dpr));
      backCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = backCtx;
      const sky = c.createLinearGradient(0, 0, W * 0.4, H);
      sky.addColorStop(0, "#0b0f1e");
      sky.addColorStop(0.5, "#0a0d18");
      sky.addColorStop(1, "#07080f");
      c.fillStyle = sky;
      c.fillRect(0, 0, W, H);

      c.fillStyle = "rgba(120,150,220,0.055)";
      const d = Math.max(1, cell * 0.075);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          c.fillRect(x * cell + cell / 2 - d / 2, y * cell + cell / 2 - d / 2, d, d);
        }
      }

      const vig = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.78);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.55)");
      c.fillStyle = vig;
      c.fillRect(0, 0, W, H);
    }

    function render(now) {
      g.drawImage(back, 0, 0, W, H);
      const glow = population < 900;      // skip the halo pass on busy boards
      const half = cell / 2;
      let live = 0;                       // counted here so the readout stays
                                          // honest while paused and drawing
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "700 " + (cell * 0.86).toFixed(1) + "px " + glyphFont;

      for (let i = 0; i < n; i++) {
        const x = (i % cols) * cell + half;
        const y = ((i / cols) | 0) * cell + half;

        if (alive[i]) {
          live++;
          const a = age[i];
          const mature = clamp(a / 14, 0, 1);
          const pop = clamp((now - bornAt[i]) / POP_MS, 0, 1);
          const ease = pop * (2 - pop);
          const lit = Math.min(LITS - 1, Math.round(mature * (LITS - 1)));
          const color = paint(hue[i], lit);
          const digit = clamp(1 - a / MORPH, 0, 1);      // "1" fading out
          const dot = clamp((a - 1) / MORPH, 0, 1);      // dot fading in

          if (dot > 0) {
            const r = cell * (0.26 + 0.13 * mature) * (0.5 + 0.5 * ease);
            if (glow) {
              g.globalAlpha = 0.22 * dot * ease;
              g.fillStyle = color;
              g.beginPath();
              g.arc(x, y, r * 2.6, 0, Math.PI * 2);
              g.fill();
            }
            g.globalAlpha = dot * ease;
            g.fillStyle = color;
            g.beginPath();
            g.arc(x, y, r, 0, Math.PI * 2);
            g.fill();
          }
          if (digit > 0) {
            g.globalAlpha = digit * ease;
            g.fillStyle = paint(hue[i], 0);
            g.fillText("1", x, y + (1 - ease) * cell * 0.3);
          }
        } else {
          const since = now - diedAt[i];
          if (since >= 0 && since < GHOST_MS) {
            const f = 1 - since / GHOST_MS;
            g.globalAlpha = f * 0.75;
            g.fillStyle = GHOST_COLORS[((ghostHue[i] / 7.5) | 0) % HUES];
            g.fillText("0", x, y);
          }
        }
      }
      g.globalAlpha = 1;
      population = live;

      // Stamp preview follows the last touch so you can see what will land.
      if (armed && hover.on) {
        g.globalAlpha = 0.5 + 0.2 * Math.sin(now * 0.006);
        g.fillStyle = "#eaf2ff";
        const sx = hover.x - (armed.w >> 1);
        const sy = hover.y - (armed.h >> 1);
        for (const [dx, dy] of armed.cells) {
          const px = (((sx + dx) % cols) + cols) % cols;
          const py = (((sy + dy) % rows) + rows) % rows;
          g.fillRect(px * cell + cell * 0.22, py * cell + cell * 0.22, cell * 0.56, cell * 0.56);
        }
        g.globalAlpha = 1;
      }
    }

    // ---- chrome ------------------------------------------------------------
    const CHIP =
      "pointer-events:auto;min-width:44px;height:44px;padding:0 12px;border-radius:14px;border:none;" +
      "font:600 16px/1 " + FONT + ";color:#e8eefc;background:rgba(22,28,48,0.72);" +
      "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;" +
      "justify-content:center;cursor:pointer;touch-action:manipulation;transition:opacity 0.15s,transform 0.12s;" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.45);";

    function chip(label, aria) {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("aria-label", aria || label);
      b.style.cssText = CHIP;
      return b;
    }

    const topBar = document.createElement("div");
    topBar.style.cssText =
      "position:absolute;left:12px;right:12px;top:calc(" + ctx.safeArea.top + "px + 12px);" +
      "display:flex;gap:10px;align-items:center;pointer-events:none;";
    ui.appendChild(topBar);

    const helpBtn = chip("?", "How it works");
    const soundBtn = chip("♪", "Toggle sound");
    const gap = document.createElement("div");
    gap.style.cssText = "flex:1;";
    const stats = document.createElement("div");
    stats.style.cssText =
      "pointer-events:none;height:44px;padding:0 14px;border-radius:14px;display:flex;align-items:center;" +
      "font:600 13px/1 " + FONT + ";color:#cfe0ff;background:rgba(22,28,48,0.72);" +
      "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-variant-numeric:tabular-nums;" +
      "box-shadow:0 2px 14px rgba(0,0,0,0.45);";
    stats.textContent = "gen 0 · 0";
    topBar.append(helpBtn, soundBtn, gap, stats);

    // Stamp tray sits above the transport row and only appears when asked for.
    const tray = document.createElement("div");
    tray.style.cssText =
      "position:absolute;left:0;right:0;bottom:calc(" + ctx.safeArea.bottom + "px + 82px);" +
      "display:none;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;" +
      "padding:4px 12px 6px;pointer-events:auto;";
    ui.appendChild(tray);

    const bottomBar = document.createElement("div");
    bottomBar.style.cssText =
      "position:absolute;left:12px;right:12px;bottom:calc(" + ctx.safeArea.bottom + "px + 22px);" +
      "display:flex;gap:8px;justify-content:center;pointer-events:none;";
    ui.appendChild(bottomBar);

    const playBtn = chip("⏸", "Pause");
    playBtn.style.cssText += "min-width:64px;background:linear-gradient(180deg,#6ee7ff,#4aa8f0);color:#04121f;font-size:19px;";
    const stepBtn = chip("⏭", "Step one generation");
    const diceBtn = chip("🎲", "New random board");
    const clearBtn = chip("🧹", "Clear the board");
    const speedBtn = chip(SPEEDS[1].label, "Speed");
    const stampBtn = chip("✦", "Stamps");
    bottomBar.append(playBtn, stepBtn, diceBtn, clearBtn, speedBtn, stampBtn);

    const toastRow = document.createElement("div");
    toastRow.style.cssText =
      "position:absolute;left:12px;right:12px;top:calc(" + ctx.safeArea.top + "px + 66px);" +
      "display:flex;justify-content:center;pointer-events:none;";
    ui.appendChild(toastRow);
    const toast = document.createElement("div");
    toast.style.cssText =
      "opacity:0;transition:opacity 0.25s;padding:9px 15px;border-radius:14px;text-align:center;" +
      "background:rgba(14,20,38,0.92);color:#e8eefc;font:600 13px/1.35 " + FONT + ";" +
      "box-shadow:0 4px 18px rgba(0,0,0,0.5);";
    toastRow.appendChild(toast);
    let toastToken = 0;
    function say(text) {
      toast.textContent = text;
      toast.style.opacity = "1";
      const mine = ++toastToken;
      ctx.timeout(() => { if (mine === toastToken) toast.style.opacity = "0"; }, 2200);
    }

    const help = document.createElement("div");
    help.style.cssText =
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:22px;" +
      "pointer-events:auto;background:rgba(6,9,20,0.88);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);";
    help.innerHTML =
      '<div style="max-width:330px;color:#e8eefc;font:400 15px/1.55 ' + FONT + ';">' +
      '<h2 style="font:800 22px/1.2 ' + FONT + ';margin-bottom:4px;">Ones &amp; Zeros</h2>' +
      '<p style="opacity:0.6;margin-bottom:12px;">Conway\'s Game of Life</p>' +
      '<ul style="list-style:none;display:grid;gap:9px;">' +
      "<li>• A dead cell with exactly <b>3</b> live neighbours is born.</li>" +
      "<li>• A live cell with <b>2 or 3</b> neighbours survives. Anything else dies.</li>" +
      "<li>• New cells show <b>1</b>, then soften into dots as they survive. A cell that just died flashes <b>0</b>.</li>" +
      "<li>• Colour is inherited — a newborn blends the three neighbours that made it, so hues travel with gliders.</li>" +
      "<li>• <b>Drag</b> to draw or rub out cells. <b>✦</b> drops classic patterns.</li>" +
      "<li>• The edges wrap around, and a board that goes quiet gets a little new life.</li>" +
      "</ul>" +
      '<p style="margin-top:16px;opacity:0.6;">Tap anywhere to close.</p></div>';
    ui.appendChild(help);
    ctx.listen(help, "click", () => { help.style.display = "none"; });

    // ---- sound -------------------------------------------------------------
    let music = null;
    let muted = false;
    async function startMusic() {
      if (music || muted || !ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        music = await ctx.music.play({ preset: "drift", volume: 0.3, fadeInMs: 1600, intensity: 0.35 });
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
    function tick(kind) {
      if (ctx.capabilities.haptics) ctx.platform.haptic(kind || "light");
    }

    // ---- state -------------------------------------------------------------
    let running = true;
    let speedIdx = 1;
    let armed = null;                       // stamp waiting to be placed
    const hover = { on: false, x: 0, y: 0 };
    let brushHue = Math.random() * 360;

    function saveSettings() {
      try { ctx.storage.set("prefs", { speed: speedIdx, muted: muted }); } catch (e) { /* optional */ }
    }

    function setRunning(on) {
      running = on;
      playBtn.textContent = on ? "⏸" : "▶";
      playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    }

    function buildTray() {
      tray.innerHTML = "";
      for (const s of STAMPS) {
        if (s.w > cols - 1 || s.h > rows - 1) continue;   // will not fit this board
        const b = chip(s.label, "Place a " + s.label);
        b.style.cssText += "font-size:13px;flex:0 0 auto;";
        b.dataset.stamp = s.label;
        ctx.listen(b, "click", () => {
          armed = armed === s ? null : s;
          syncTray();
          if (armed) say("Tap the board to place a " + s.label + ".");
          tick("light");
          chime("tap");
        });
        tray.appendChild(b);
      }
      syncTray();
    }
    function syncTray() {
      for (const b of tray.children) {
        const on = !!armed && b.dataset.stamp === armed.label;
        b.style.background = on ? "linear-gradient(180deg,#6ee7ff,#4aa8f0)" : "rgba(22,28,48,0.72)";
        b.style.color = on ? "#04121f" : "#e8eefc";
      }
      stampBtn.style.transform = tray.style.display === "flex" ? "translateY(-2px)" : "none";
    }

    // ---- input -------------------------------------------------------------
    let started = false;
    function begin() {
      if (started) return;
      started = true;
      ctx.platform.start();
      startMusic();
    }

    let painting = 0;                 // 0 none, 1 drawing, -1 erasing
    let lastCellX = -1;
    let lastCellY = -1;
    let lastHaptic = 0;

    function cellAt(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.floor((e.clientX - rect.left) / cell),
        y: Math.floor((e.clientY - rect.top) / cell)
      };
    }

    // Fill the gap between two pointer samples so fast drags do not dot.
    function paintLine(x0, y0, x1, y1, now) {
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      let guard = 0;
      while (guard++ < 512) {
        setCell(x0, y0, painting > 0, brushHue, now);
        brushHue = (brushHue + 7) % 360;
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      begin();
      const now = clockMs;
      lastTouch = now;
      const c = cellAt(e);

      if (armed) {
        stamp(armed, c.x, c.y, Math.random() * 360, now, false);
        ctx.platform.interact({ type: "stamp", pattern: armed.label });
        ctx.platform.milestone("stamp_placed");
        armed = null;
        hover.on = false;
        syncTray();
        tick("success");
        chime("powerup");
        return;
      }

      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      painting = alive[idx(c.x, c.y)] ? -1 : 1;
      lastCellX = c.x;
      lastCellY = c.y;
      setCell(c.x, c.y, painting > 0, brushHue, now);
      brushHue = (brushHue + 11) % 360;
      tick("light");
      ctx.platform.interact({ type: painting > 0 ? "draw" : "erase" });
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      if (armed) {
        const c = cellAt(e);
        hover.on = true;
        hover.x = c.x;
        hover.y = c.y;
        return;
      }
      if (!painting) return;
      e.preventDefault();
      const c = cellAt(e);
      if (c.x === lastCellX && c.y === lastCellY) return;
      paintLine(lastCellX, lastCellY, c.x, c.y, clockMs);
      lastCellX = c.x;
      lastCellY = c.y;
      lastTouch = clockMs;
      if (clockMs - lastHaptic > 90) { lastHaptic = clockMs; tick("light"); }
    }, { passive: false });

    const endPaint = () => { painting = 0; };
    ctx.listen(canvas, "pointerup", endPaint);
    ctx.listen(canvas, "pointercancel", endPaint);
    ctx.listen(canvas, "pointerleave", () => { hover.on = false; });

    ctx.listen(playBtn, "click", () => {
      begin();
      setRunning(!running);
      lastTouch = clockMs;
      tick("medium");
      chime("tap");
      ctx.platform.interact({ type: running ? "play" : "pause" });
    });
    ctx.listen(stepBtn, "click", () => {
      begin();
      setRunning(false);
      step(clockMs);
      lastTouch = clockMs;
      tick("light");
      ctx.platform.interact({ type: "step" });
    });
    ctx.listen(diceBtn, "click", () => {
      begin();
      generate(clockMs);
      lastTouch = clockMs;
      tick("medium");
      chime("coin");
      say("A fresh board.");
      ctx.platform.interact({ type: "generate" });
    });
    ctx.listen(clearBtn, "click", () => {
      begin();
      clearBoard(clockMs);
      lastTouch = clockMs;
      tick("warning");
      chime("fail");
      say("Empty board — draw something.");
      ctx.platform.interact({ type: "clear" });
    });
    ctx.listen(speedBtn, "click", () => {
      begin();
      speedIdx = (speedIdx + 1) % SPEEDS.length;
      speedBtn.textContent = SPEEDS[speedIdx].label;
      lastTouch = clockMs;
      tick("light");
      saveSettings();
      ctx.platform.interact({ type: "speed", value: SPEEDS[speedIdx].gps });
    });
    ctx.listen(stampBtn, "click", () => {
      begin();
      const open = tray.style.display === "flex";
      tray.style.display = open ? "none" : "flex";
      if (open) armed = null;
      syncTray();
      lastTouch = clockMs;
      tick("light");
    });
    ctx.listen(helpBtn, "click", () => {
      help.style.display = help.style.display === "none" ? "flex" : "none";
      tick("light");
    });
    ctx.listen(soundBtn, "click", async () => {
      muted = !muted;
      soundBtn.textContent = muted ? "🔇" : "♪";
      soundBtn.style.opacity = muted ? "0.55" : "1";
      if (muted) {
        if (music) { try { music.stop({ fadeOutMs: 500 }); } catch (e) {} music = null; }
      } else {
        await startMusic();
      }
      saveSettings();
      tick("light");
    });

    // ---- boot --------------------------------------------------------------
    let clockMs = 0;
    layout();
    buildBack();
    buildTray();
    generate(0, 0);
    render(0);
    ctx.markVisualReady("field");

    try {
      const prefs = await ctx.storage.get("prefs");
      if (prefs) {
        if (typeof prefs.speed === "number") {
          speedIdx = clamp(Math.floor(prefs.speed), 0, SPEEDS.length - 1);
          speedBtn.textContent = SPEEDS[speedIdx].label;
        }
        if (prefs.muted) {
          muted = true;
          soundBtn.textContent = "🔇";
          soundBtn.style.opacity = "0.55";
        }
      }
    } catch (e) { /* first visit, or storage unavailable */ }

    ctx.platform.ready();

    let acc = 0;
    let statsAt = 0;
    let musicAt = 0;

    ctx.onFrame((dtMs, timeMs) => {
      const dt = clamp(dtMs, 0, 60);
      clockMs = timeMs;

      if (W !== ctx.width || H !== ctx.height) {
        W = ctx.width;
        H = ctx.height;
        layout(true);
        buildBack();
        buildTray();          // a wider board may now fit bigger patterns
      }

      if (running) {
        acc += dt;
        const stepMs = 1000 / SPEEDS[speedIdx].gps;
        let guard = 0;
        while (acc >= stepMs && guard++ < 4) {
          acc -= stepMs;
          step(timeMs);
        }
      }

      render(timeMs);

      if (timeMs - statsAt > 140) {
        statsAt = timeMs;
        stats.textContent = "gen " + generation + " · " + population;
      }
      // Let the bed swell with the colony.
      if (music && timeMs - musicAt > 1500) {
        musicAt = timeMs;
        try { music.setIntensity(clamp(0.2 + (population / n) * 3.2, 0.2, 0.95)); } catch (e) {}
      }
    });

    // Load the approved mono face for the digits; the system stack carries the
    // first frames, and a failure just leaves that stack in place.
    try {
      await ctx.loadFont("Space Mono", "space-mono", "1.0.0", { weight: "700" });
      glyphFont = '"Space Mono",ui-monospace,SFMono-Regular,Menlo,monospace';
    } catch (e) { /* system monospace is a fine fallback */ }
  }
};
