/*
 * Munch Maze
 * The 1980 dot-eating maze chase, rebuilt at the arcade's 224x288 with the
 * documented rules: the same maze, four ghosts with their own targeting,
 * scatter/chase waves, speed tables per level, fright timers, Cruise Elroy,
 * the ghost-house dot counters, fruit, and the tunnel.
 *
 * All art, sound and code is original and hand-made in this file.
 *
 * Runtime: plethora-bit@2 (window.plethoraBit) · 2D canvas · synth audio
 */

window.plethoraBit = {
  meta: {
    title: "Munch Maze",
    runtime: "plethora-bit@2",
    tags: ["arcade", "maze", "retro", "pixel", "score", "mobile"],
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
    const rnd = (a, b) => a + Math.random() * (b - a);
    const canStore = !!(ctx.capabilities && ctx.capabilities.storage);
    const memStore = {};
    const store = {
      get(k, d) { try { const v = canStore ? ctx.storage.get("mm_" + k) : memStore[k]; return v == null ? d : v; } catch (_) { return d; } },
      set(k, v) { try { if (canStore) ctx.storage.set("mm_" + k, v); else memStore[k] = v; } catch (_) {} }
    };
    const canAudio = !!(ctx.capabilities && ctx.capabilities.audio);
    const canHaptic = !!(ctx.capabilities && ctx.capabilities.haptics);
    let muted = !!store.get("muted", false);
    function haptic(k) { if (canHaptic) { try { ctx.platform.haptic(k); } catch (_) {} } }

    // ---- arcade framebuffer: 28x36 tiles of 8px ---------------------------------
    const T = 8, COLS = 28, ROWS = 36, FW = COLS * T, FH = ROWS * T, MAZE_Y = 3;   // maze occupies rows 3..33
    const fbc = new OffscreenCanvas(FW, FH), fb = fbc.getContext("2d");
    fb.imageSmoothingEnabled = false;

    // ---- the maze -------------------------------------------------------------------
    const MAP = [
      "############################",
      "#............##............#",
      "#.####.#####.##.#####.####.#",
      "#o####.#####.##.#####.####o#",
      "#.####.#####.##.#####.####.#",
      "#..........................#",
      "#.####.##.########.##.####.#",
      "#.####.##.########.##.####.#",
      "#......##....##....##......#",
      "######.##### ## #####.######",
      "     #.##### ## #####.#     ",
      "     #.##          ##.#     ",
      "     #.## ###--### ##.#     ",
      "######.## #      # ##.######",
      "      .   #      #   .      ",
      "######.## #      # ##.######",
      "     #.## ######## ##.#     ",
      "     #.##          ##.#     ",
      "     #.## ######## ##.#     ",
      "######.## ######## ##.######",
      "#............##............#",
      "#.####.#####.##.#####.####.#",
      "#.####.#####.##.#####.####.#",
      "#o..##.......  .......##..o#",
      "###.##.##.########.##.##.###",
      "###.##.##.########.##.##.###",
      "#......##....##....##......#",
      "#.##########.##.##########.#",
      "#.##########.##.##########.#",
      "#..........................#",
      "############################"];
    // cell kinds: 0 wall, 1 path, 2 door, 3 house interior, 4 void (outside), 5 tunnel path
    const MH = MAP.length, MW = 28;
    const grid = [];
    for (let y = 0; y < MH; y++) {
      const row = [];
      for (let x = 0; x < MW; x++) {
        const c = MAP[y][x];
        let k = c === "#" ? 0 : c === "-" ? 2 : 1;
        if (c === " ") {
          const side = x < 5 || x > 22;
          if (y === 14 && (x < 6 || x > 21)) k = 5;
          else if (side && y >= 9 && y <= 19) k = 4;
          else if (y >= 13 && y <= 15 && x >= 11 && x <= 16) k = 3;
        }
        row.push(k);
      }
      grid.push(row);
    }
    function cell(x, y) {   // tile coords in maze space; outside the maze horizontally wraps as tunnel
      if (y < 0 || y >= MH) return 0;
      if (x < 0 || x >= MW) return y === 14 ? 5 : 0;
      return grid[y][x];
    }
    const walkable = (x, y, ghost) => { const k = cell(x, y); return k === 1 || k === 5 || (ghost && (k === 2 || k === 3)); };
    let dots = [];   // dots[y][x]: 0 none, 1 dot, 2 energiser
    let dotsLeft = 0;
    function resetDots() {
      dots = MAP.map((r) => r.split("").map((c) => c === "." ? 1 : c === "o" ? 2 : 0));
      dotsLeft = 0; for (const r of dots) for (const v of r) if (v) dotsLeft++;
    }
    resetDots();
    const TOTAL_DOTS = dotsLeft;   // 244

    // maze outline, drawn once into its own layer (blue) and a white copy for the level flash
    function drawMaze(color) {
      const oc = new OffscreenCanvas(FW, FH), c = oc.getContext("2d");
      c.strokeStyle = color; c.lineWidth = 1; c.lineCap = "butt";
      const open = (x, y, mode) => { const k = cell(x, y); return mode === 0 ? (k === 1 || k === 2 || k === 3 || k === 5) : (k === 4 || y < 0 || y >= MH || x < 0 || x >= MW); };
      // an outline pass: lines at inset i from any open side, convex corners radius r, concave corners radius i
      function pass(mode, i, r) {
        for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
          if (cell(tx, ty) !== 0) continue;
          if (mode === 1 && cell(tx, ty) === 4) continue;
          const x = tx * T, y = (ty + MAZE_Y) * T;
          const N = open(tx, ty - 1, mode), S = open(tx, ty + 1, mode), E = open(tx + 1, ty, mode), W = open(tx - 1, ty, mode);
          const NW = open(tx - 1, ty - 1, mode), NE = open(tx + 1, ty - 1, mode), SW = open(tx - 1, ty + 1, mode), SE = open(tx + 1, ty + 1, mode);
          c.beginPath();
          // straight runs
          if (N) { const a = W ? x + i + r : x, b = E ? x + T - i - r : x + T; if (b > a) { c.moveTo(a, y + i + 0.5); c.lineTo(b, y + i + 0.5); } }
          if (S) { const a = W ? x + i + r : x, b = E ? x + T - i - r : x + T; if (b > a) { c.moveTo(a, y + T - i - 0.5); c.lineTo(b, y + T - i - 0.5); } }
          if (W) { const a = N ? y + i + r : y, b = S ? y + T - i - r : y + T; if (b > a) { c.moveTo(x + i + 0.5, a); c.lineTo(x + i + 0.5, b); } }
          if (E) { const a = N ? y + i + r : y, b = S ? y + T - i - r : y + T; if (b > a) { c.moveTo(x + T - i - 0.5, a); c.lineTo(x + T - i - 0.5, b); } }
          c.stroke();
          // convex corners (two adjacent open sides)
          const arc = (cx, cy, rr, a0, a1) => { c.beginPath(); c.arc(cx, cy, rr, a0, a1); c.stroke(); };
          const ii = i + 0.5;
          if (N && W) arc(x + ii + r, y + ii + r, r, Math.PI, Math.PI * 1.5);
          if (N && E) arc(x + T - ii - r, y + ii + r, r, Math.PI * 1.5, Math.PI * 2);
          if (S && W) arc(x + ii + r, y + T - ii - r, r, Math.PI * 0.5, Math.PI);
          if (S && E) arc(x + T - ii - r, y + T - ii - r, r, 0, Math.PI * 0.5);
          // concave corners (diagonal open, both adjacent sides closed)
          if (!N && !W && NW) arc(x, y, ii, 0, Math.PI * 0.5);
          if (!N && !E && NE) arc(x + T, y, ii, Math.PI * 0.5, Math.PI);
          if (!S && !W && SW) arc(x, y + T, ii, Math.PI * 1.5, Math.PI * 2);
          if (!S && !E && SE) arc(x + T, y + T, ii, Math.PI, Math.PI * 1.5);
        }
      }
      pass(0, 2, 3);     // inner lines
      pass(1, 0, 4);     // outer border line
      // the door
      c.fillStyle = "#ffb8de"; c.fillRect(13 * T, (12 + MAZE_Y) * T + 3, 16, 2);
      return oc;
    }
    const mazeBlue = drawMaze("#2121ff"), mazeWhite = drawMaze("#ffffff");

    // ---- font (5x7) ------------------------------------------------------------------------
    const FONT = {
      A: "0E,11,11,1F,11,11,11", B: "1E,11,11,1E,11,11,1E", C: "0E,11,10,10,10,11,0E", D: "1E,11,11,11,11,11,1E",
      E: "1F,10,10,1E,10,10,1F", F: "1F,10,10,1E,10,10,10", G: "0E,11,10,17,11,11,0F", H: "11,11,11,1F,11,11,11",
      I: "0E,04,04,04,04,04,0E", J: "07,02,02,02,02,12,0C", K: "11,12,14,18,14,12,11", L: "10,10,10,10,10,10,1F",
      M: "11,1B,15,15,11,11,11", N: "11,11,19,15,13,11,11", O: "0E,11,11,11,11,11,0E", P: "1E,11,11,1E,10,10,10",
      Q: "0E,11,11,11,15,12,0D", R: "1E,11,11,1E,14,12,11", S: "0F,10,10,0E,01,01,1E", T: "1F,04,04,04,04,04,04",
      U: "11,11,11,11,11,11,0E", V: "11,11,11,11,11,0A,04", W: "11,11,11,15,15,15,0A", X: "11,11,0A,04,0A,11,11",
      Y: "11,11,11,0A,04,04,04", Z: "1F,01,02,04,08,10,1F", "0": "0E,11,13,15,19,11,0E", "1": "04,0C,04,04,04,04,0E",
      "2": "0E,11,01,02,04,08,1F", "3": "1F,02,04,02,01,11,0E", "4": "02,06,0A,12,1F,02,02", "5": "1F,10,1E,01,01,11,0E",
      "6": "06,08,10,1E,11,11,0E", "7": "1F,01,02,04,08,08,08", "8": "0E,11,11,0E,11,11,0E", "9": "0E,11,11,0F,01,02,0C",
      " ": "00,00,00,00,00,00,00", "!": "04,04,04,04,04,00,04", "?": "0E,11,01,02,04,00,04", ".": "00,00,00,00,00,0C,0C",
      "-": "00,00,00,1F,00,00,00", ":": "00,0C,0C,00,0C,0C,00", "/": "01,02,02,04,08,08,10", "'": "04,04,08,00,00,00,00", "\"": "0A,0A,00,00,00,00,00"
    };
    const glyphCache = {};
    function glyph(ch, color) {
      const key = ch + color; let c = glyphCache[key]; if (c) return c;
      const rows = (FONT[ch] || FONT["?"]).split(",");
      const oc = new OffscreenCanvas(8, 8), cc = oc.getContext("2d"); cc.fillStyle = color;
      for (let y = 0; y < 7; y++) { const bits = parseInt(rows[y], 16); for (let x = 0; x < 5; x++) if (bits & (16 >> x)) cc.fillRect(x + 1, y, 1, 1); }
      glyphCache[key] = oc; return oc;
    }
    function text(s, x, y, color) { for (let i = 0; i < s.length; i++) if (s[i] !== " ") fb.drawImage(glyph(s[i], color || "#fff"), x + i * 8, y); }
    function textC(s, cx, y, color) { text(s, Math.round(cx - s.length * 4), y, color); }

    // ---- sprites -----------------------------------------------------------------------------
    const PAL = { R: "#ff0000", P: "#ffb8ff", C: "#00ffff", O: "#ffb852", W: "#ffffff", B: "#2121ff", Y: "#ffff00", K: "#000000",
      r: "#ff0000", g: "#00ff00", s: "#7dd8b0", b: "#4a8cff", t: "#ffb8de", n: "#de9751", w: "#f8f8f8", y: "#ffff00", e: "#ff2b2b", d: "#c8b400", m: "#47b000" };
    function raster(rows) {
      const h = rows.length, w = rows[0].length, oc = new OffscreenCanvas(w, h), c = oc.getContext("2d");
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows[y][x]; if (ch === ".") continue; c.fillStyle = PAL[ch] || "#f0f"; c.fillRect(x, y, 1, 1); }
      return oc;
    }
    const FRUIT_SPR = {
      cherry: raster([
        "..........n.", ".........nn.", "........n...", ".......n....", "......n.....", ".rr..n......", "rrrr.n......", "rrrrrrr.....",
        "rwrrrrrr....", "rrrrrwrr....", ".rrrrrrr....", "..rr.rrr...."]),
      strawberry: raster([
        ".....g......", "...gggggg...", "..gg.gg.gg..", ".rrrrrrrrrr.", "rrwrrrrwrrrr", "rrrrrwrrrrrr", "rrwrrrrrwrrr", "rrrrrwrrrrrr",
        ".rrwrrrrwrr.", ".rrrrrwrrrr.", "..rrrrrrrr..", "....rrrr...."]),
      orange: raster([
        ".....g......", "....gg......", "...gggg.....", "..OOOOOOOO..", ".OOOOOOOOOO.", "OOOOOOOOOOOO", "OOOOOOOOOOOO", "OOOOOOOOOOOO",
        "OOOOOOOOOOOO", ".OOOOOOOOOO.", "..OOOOOOOO..", "...OOOOOO..."]),
      apple: raster([
        ".....nn.....", "....n.......", "..rrr..rrr..", ".rrrrrrrrrr.", "rrrrrrrrrrrr", "rwrrrrrrrrrr", "rwrrrrrrrrrr", "rrrrrrrrrrrr",
        "rrrrrrrrrrrr", ".rrrrrrrrrr.", "..rrrr.rrr..", "............"]),
      melon: raster([
        ".....gg.....", "....gg......", "..mmmmmmmm..", ".mgmmgmmgmm.", "mmmmmmmmmmmm", "mgmmgmmgmmgm", "mmmmmmmmmmmm", "mmgmmgmmgmmm",
        "mmmmmmmmmmmm", ".mgmmgmmgmm.", "..mmmmmmmm..", "...mmmmmm..."]),
      galaxian: raster([
        ".....rr.....", "....rrrr....", "...rrrrrr...", "..yyryyryy..", ".yyyyyyyyyy.", "bbbyyyyyybbb", "bbbbyyyybbbb", "bbb.yyyy.bbb",
        "b...yyyy...b", "....yyyy....", ".....yy.....", "............"]),
      bell: raster([
        ".....yy.....", "....yyyy....", "...yyyyyy...", "...yyyyyy...", "..yyyyyyyy..", "..yyyyyyyy..", ".yyyyyyyyyy.", ".yyyyyyyyyy.",
        "yyyyyyyyyyyy", "wwwwwwwwwwww", "....CCCC....", "............"]),
      key: raster([
        "...CCCCC....", "..CC...CC...", "..CC...CC...", "...CCCCC....", "....CC......", "....CC......", "....CC......", "....CCCC....",
        "....CC......", "....CCCC....", "....CC......", "............"])
    };
    const LIFE_SPR = raster([
      "...YYYYYY...", ".YYYYYYYYY..", "YYYYYYYY....", "YYYYYY......", "YYYY........", "YYYYYY......", "YYYYYYYY....", ".YYYYYYYYY..", "...YYYYYY..."]);

    // ---- audio -------------------------------------------------------------------------------
    let AC = null, master = null;
    function ensureAC() {
      if (AC || !canAudio) return;
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      try { AC = new C(); master = AC.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(AC.destination); } catch (_) { AC = null; }
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
    function seq(notes, step, type, peak) { notes.forEach((f, i) => { if (f) tone(f, i * step, step * 0.9, type, peak); }); }
    // the siren: one oscillator that lives as long as a level is in play, retuned per state
    let siren = null, sirenPhase = 0;
    function sirenOn() { ensureAC(); if (!AC || siren) return; try { const o = AC.createOscillator(), gn = AC.createGain(); o.type = "triangle"; gn.gain.value = 0.0001; o.connect(gn); gn.connect(master); o.start(); siren = { o, gn, kind: "" }; } catch (_) {} }
    function sirenOff() { if (!siren) return; try { siren.gn.gain.setTargetAtTime(0.0001, AC.currentTime, 0.02); siren.o.stop(AC.currentTime + 0.1); } catch (_) {} siren = null; }
    function sirenTick(kind, stage) {
      if (!siren || !AC) return;
      const t = AC.currentTime;
      if (kind !== siren.kind) { siren.kind = kind; try { siren.gn.gain.setTargetAtTime(kind === "off" ? 0.0001 : kind === "eyes" ? 0.05 : 0.07, t, 0.03); } catch (_) {} }
      if (kind === "off") return;
      let period, lo, hi;
      if (kind === "fright") { period = 8; lo = 160; hi = 380; }
      else if (kind === "eyes") { period = 20; lo = 500; hi = 1200; }
      else { period = 26 - stage * 3; lo = 260 + stage * 90; hi = 420 + stage * 120; }
      if (frames % period === 0) { sirenPhase ^= 1; try { siren.o.frequency.cancelScheduledValues(t); siren.o.frequency.setValueAtTime(sirenPhase ? lo : hi, t); siren.o.frequency.linearRampToValueAtTime(sirenPhase ? hi : lo, t + period / 60); } catch (_) {} }
    }
    let wakaSide = 0;
    const sfx = {
      waka() { wakaSide ^= 1; if (wakaSide) tone(520, 0, 0.07, "square", 0.1, 230); else tone(230, 0, 0.07, "square", 0.1, 520); },
      energiser() { tone(300, 0, 0.12, "square", 0.12, 600); },
      ghost() { for (let i = 0; i < 6; i++) tone(300 + i * 140, i * 0.045, 0.06, "square", 0.12); },
      fruit() { seq([784, 1047, 1319, 1568], 0.05, "square", 0.12); },
      death() { for (let i = 0; i < 7; i++) tone(900 - i * 90, i * 0.16, 0.14, "square", 0.12, 500 - i * 50); tone(180, 1.2, 0.12, "square", 0.14, 360); tone(180, 1.4, 0.12, "square", 0.14, 360); },
      start() { seq([494, 988, 740, 622, 988, 740, 622, 0, 523, 1047, 784, 659, 1047, 784, 659], 0.11, "square", 0.11); },
      oneUp() { seq([1319, 1568, 2093, 1568, 2093, 2637], 0.07, "square", 0.12); },
      ui() { tone(880, 0, 0.05, "square", 0.08); }
    };
    function applyMute() { if (master) master.gain.value = muted ? 0 : 0.6; }

    // ---- level tables ---------------------------------------------------------------------------
    const BASE = 75.76 / 60;   // 100% speed in px per frame
    function spec(L) {
      const s = {};
      if (L === 1) Object.assign(s, { pac: 80, pacF: 90, ghost: 75, ghostF: 50, tunnel: 40, elroy1: 80, elroy2: 85 });
      else if (L <= 4) Object.assign(s, { pac: 90, pacF: 95, ghost: 85, ghostF: 55, tunnel: 45, elroy1: 90, elroy2: 95 });
      else if (L <= 20) Object.assign(s, { pac: 100, pacF: 100, ghost: 95, ghostF: 60, tunnel: 50, elroy1: 100, elroy2: 105 });
      else Object.assign(s, { pac: 90, pacF: 90, ghost: 95, ghostF: 60, tunnel: 50, elroy1: 100, elroy2: 105 });
      const el = L === 1 ? 20 : L === 2 ? 30 : L <= 5 ? 40 : L <= 8 ? 50 : L <= 11 ? 60 : L <= 14 ? 80 : L <= 18 ? 100 : 120;
      s.e1 = el; s.e2 = el / 2;
      const fr = [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1][L - 1]; s.fright = fr == null ? 0 : fr;
      s.flashes = [9, 12, 13, 15, 16, 18].indexOf(L) >= 0 ? 3 : 5;
      s.waves = L === 1 ? [7, 20, 7, 20, 5, 20, 5, 1e9] : L <= 4 ? [7, 20, 7, 20, 5, 1033, 1 / 60, 1e9] : [5, 20, 5, 20, 5, 1037, 1 / 60, 1e9];
      s.releaseTimer = L <= 4 ? 4 : 3;
      s.limits = L === 1 ? [0, 30, 60] : L === 2 ? [0, 0, 50] : [0, 0, 0];   // pink, cyan, orange
      const fruits = [["cherry", 100], ["strawberry", 300], ["orange", 500], ["orange", 500], ["apple", 700], ["apple", 700], ["melon", 1000], ["melon", 1000], ["galaxian", 2000], ["galaxian", 2000], ["bell", 3000], ["bell", 3000], ["key", 5000]];
      s.fruit = fruits[Math.min(12, L - 1)];
      return s;
    }

    // ---- actors ----------------------------------------------------------------------------------
    const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];   // up, left, down, right (also the tie-break order)
    const REV = (d) => (d + 2) % 4;
    const tileX = (x) => Math.floor(x / T), tileY = (y) => Math.floor(y / T) - MAZE_Y;
    const centreX = (tx) => tx * T + 4, centreY = (ty) => (ty + MAZE_Y) * T + 4;
    const NO_UP = [[12, 11], [15, 11], [12, 23], [15, 23]];
    const GHOSTS = [
      { name: "red", color: "#ff0000", scatter: [25, -3], home: [112, 116], houseX: 112, limitIdx: -1 },
      { name: "pink", color: "#ffb8ff", scatter: [2, -3], home: [112, 140], houseX: 112, limitIdx: 0 },
      { name: "cyan", color: "#00ffff", scatter: [27, 32], home: [96, 140], houseX: 96, limitIdx: 1 },
      { name: "orange", color: "#ffb852", scatter: [0, 32], home: [128, 140], houseX: 128, limitIdx: 2 }
    ];
    let state = "title";   // title | ready | play | eaten | dying | dead | clear | flash | gameover
    let stateT = 0, frames = 0, started = false;
    let level = 1, score = 0, best = store.get("best", 0), lives = 3, extraGiven = false, S_ = spec(1);
    let pac = null, ghosts = [], fruit = null, fruitT = 0, dotsEaten = 0, popups = [];
    let waveIdx = 0, waveT = 0, globalMode = "scatter", frightT = 0, frightFlash = 0, ghostsEaten = 0, eatenGhost = null;
    let releaseT = 0, globalCounter = -1, fruitsShown = [], levelsCleared = 0, sirenStage = 0;
    let want = 1, pacStop = 0;

    function makeGhost(spec_, i) {
      return Object.assign({}, spec_, { x: spec_.home[0], y: spec_.home[1], dir: i === 0 ? 1 : i === 1 ? 2 : 0, mode: i === 0 ? "scatter" : "house", fright: false, dots: 0, bob: i === 1 ? 1 : -1, elroy: 0, leaveT: 0, entering: 0 });
    }
    function resetActors(full) {
      pac = { x: 112, y: 212, dir: 1, mouth: 0, mouthT: 0, moving: false, deadT: 0 };
      want = 1; pacStop = 0;
      ghosts = GHOSTS.map(makeGhost);
      frightT = 0; ghostsEaten = 0; eatenGhost = null; fruit = null; fruitT = 0; popups = [];
      waveIdx = 0; waveT = 0; globalMode = "scatter"; releaseT = 0;
      globalCounter = full ? -1 : 0;   // after a death the global dot counter takes over
      if (full) { for (const gh of ghosts) gh.dots = 0; }
    }
    function startLevel(L) {
      level = L; S_ = spec(L); resetDots(); dotsEaten = 0; resetActors(true);
      if (fruitsShown[fruitsShown.length - 1] !== S_.fruit[0] || fruitsShown.length === 0) fruitsShown.push(S_.fruit[0]); if (fruitsShown.length > 7) fruitsShown.shift();
    }
    function addScore(n) {
      score += n;
      if (!extraGiven && score >= 10000) { extraGiven = true; lives++; sfx.oneUp(); haptic("success"); }
      if (score > best) { best = score; store.set("best", best); }
      try { ctx.platform.setScore(score); } catch (_) {}
    }

    // ---- movement --------------------------------------------------------------------------------
    function wrap(a) { if (a.x < -8) a.x += FW + 16; else if (a.x > FW + 8) a.x -= FW + 16; }
    function inTunnel(a) { const ty = tileY(a.y), tx = tileX(a.x); return ty === 14 && (tx <= 5 || tx >= 22); }
    function movePac(sp) {
      const tx = tileX(pac.x), ty = tileY(pac.y), cx = centreX(tx), cy = centreY(ty);
      if (want !== pac.dir) {
        if (want === REV(pac.dir)) pac.dir = want;
        else if (walkable(tx + DX[want], ty + DY[want], false)) {
          const vert = DX[want] === 0, off = vert ? pac.x - cx : pac.y - cy;
          if (Math.abs(off) <= 4) { if (vert) pac.x = cx; else pac.y = cy; pac.dir = want; }
        }
      }
      const d = pac.dir, nx = tx + DX[d], ny = ty + DY[d];
      let move = sp;
      if (!walkable(nx, ny, false)) {
        const ahead = DX[d] ? (cx - pac.x) * DX[d] : (cy - pac.y) * DY[d];
        move = clamp(ahead, 0, sp);
      }
      pac.moving = move > 0.01;
      pac.x += DX[d] * move; pac.y += DY[d] * move; wrap(pac);
      if (pac.moving) { pac.mouthT++; pac.mouth = [0, 1, 2, 1][Math.floor(pac.mouthT / 4) % 4]; }
    }
    function target(gh) {
      if (gh.mode === "eyes") return [13, 11];
      if (gh.mode === "scatter") return gh.scatter;
      const px = tileX(pac.x), py = tileY(pac.y), pd = pac.dir;
      if (gh.name === "red") return [px, py];
      if (gh.name === "pink") return [px + DX[pd] * 4 + (pd === 0 ? -4 : 0), py + DY[pd] * 4];
      if (gh.name === "cyan") {
        const ax = px + DX[pd] * 2 + (pd === 0 ? -2 : 0), ay = py + DY[pd] * 2;
        const b = ghosts[0]; const bx = tileX(b.x), by = tileY(b.y);
        return [ax + (ax - bx), ay + (ay - by)];
      }
      const gx = tileX(gh.x), gy = tileY(gh.y);
      return Math.hypot(px - gx, py - gy) > 8 ? [px, py] : gh.scatter;
    }
    function chooseDir(gh, tx, ty) {
      const eyes = gh.mode === "eyes";
      const opts = [];
      for (let d = 0; d < 4; d++) {
        if (d === REV(gh.dir)) continue;
        const nx = tx + DX[d], ny = ty + DY[d];
        const k = cell(nx, ny);
        const ok = k === 1 || k === 5 || (eyes && (k === 2 || k === 3));
        if (!ok) continue;
        if (d === 0 && !gh.fright && !eyes && NO_UP.some(([a, b]) => a === tx && b === ty)) continue;
        opts.push(d);
      }
      if (!opts.length) return REV(gh.dir);
      if (gh.fright && !eyes) return opts[Math.floor(Math.random() * opts.length)];
      const [tgx, tgy] = target(gh);
      let bestD = opts[0], bd = 1e9;
      for (const d of opts) { const nx = tx + DX[d], ny = ty + DY[d]; const dist = (nx - tgx) * (nx - tgx) + (ny - tgy) * (ny - tgy); if (dist < bd) { bd = dist; bestD = d; } }
      return bestD;
    }
    function moveGhost(gh, sp) {
      let rem = sp, guard = 0;
      while (rem > 0.0001 && guard++ < 4) {
        const tx = tileX(gh.x), ty = tileY(gh.y), cx = centreX(tx), cy = centreY(ty);
        const ahead = DX[gh.dir] ? (cx - gh.x) * DX[gh.dir] : (cy - gh.y) * DY[gh.dir];
        if (ahead > 0.0001 && ahead <= rem) {
          gh.x = cx; gh.y = cy; rem -= ahead;
          if (gh.mode === "eyes" && tx === 13 && ty === 11) { gh.mode = "entering"; gh.entering = 0; return; }
          gh.dir = chooseDir(gh, tx, ty);
        } else { gh.x += DX[gh.dir] * rem; gh.y += DY[gh.dir] * rem; rem = 0; }
      }
      wrap(gh);
    }
    function ghostSpeed(gh) {
      if (gh.mode === "eyes") return BASE * 1.6;
      if (inTunnel(gh)) return BASE * S_.tunnel / 100;
      if (gh.fright) return BASE * S_.ghostF / 100;
      if (gh.elroy === 2) return BASE * S_.elroy2 / 100;
      if (gh.elroy === 1) return BASE * S_.elroy1 / 100;
      return BASE * S_.ghost / 100;
    }
    function updateGhost(gh) {
      if (gh.mode === "house") {
        gh.y += gh.bob * 0.35; if (gh.y < 133) { gh.y = 133; gh.bob = 1; } if (gh.y > 147) { gh.y = 147; gh.bob = -1; }
        gh.dir = gh.bob < 0 ? 0 : 2;
        return;
      }
      if (gh.mode === "leaving") {
        const sp = 0.6;
        if (Math.abs(gh.x - 112) > 0.3) { gh.x += Math.sign(112 - gh.x) * sp; gh.dir = gh.x < 112 ? 3 : 1; }
        else if (gh.y > 116) { gh.x = 112; gh.y = Math.max(116, gh.y - sp); gh.dir = 0; }
        else { gh.y = 116; gh.mode = globalMode; gh.dir = 1; gh.fright = frightT > 0 && gh.fright; }
        return;
      }
      if (gh.mode === "entering") {
        const sp = BASE * 1.6;
        if (gh.entering === 0) { gh.x += Math.sign(112 - gh.x) * Math.min(sp, Math.abs(112 - gh.x)); gh.dir = 3; if (Math.abs(gh.x - 112) < 0.2) { gh.x = 112; gh.entering = 1; } }
        else if (gh.entering === 1) { gh.y = Math.min(140, gh.y + sp); gh.dir = 2; if (gh.y >= 140) gh.entering = 2; }
        else if (gh.entering === 2) { const hx = gh.houseX; gh.x += Math.sign(hx - gh.x) * Math.min(sp, Math.abs(hx - gh.x)); gh.dir = hx < gh.x ? 1 : 3; if (Math.abs(gh.x - hx) < 0.2) { gh.x = hx; gh.mode = "leaving"; gh.fright = false; } }
        return;
      }
      moveGhost(gh, ghostSpeed(gh));
    }

    // ---- house release logic -----------------------------------------------------------------------
    function houseGhost() { return ghosts.find((gh) => gh.mode === "house" && gh.limitIdx >= 0) || null; }
    function onDotEaten() {
      releaseT = 0;
      if (globalCounter >= 0) {
        globalCounter++;
        const orange = ghosts[3], cyan = ghosts[2], pink = ghosts[1];
        if (globalCounter === 7 && pink.mode === "house") pink.mode = "leaving";
        if (globalCounter === 17 && cyan.mode === "house") cyan.mode = "leaving";
        if (globalCounter === 32) { if (orange.mode === "house") { orange.mode = "leaving"; globalCounter = -1; } }
        return;
      }
      const gh = houseGhost(); if (!gh) return;
      gh.dots++; if (gh.dots >= S_.limits[gh.limitIdx]) gh.mode = "leaving";
    }
    function releaseByLimits() {
      // ghosts whose personal limit is already met leave straight away (level 3+: everyone)
      if (globalCounter >= 0) return;
      const gh = houseGhost(); if (gh && gh.dots >= S_.limits[gh.limitIdx]) gh.mode = "leaving";
    }

    // ---- the play tick -------------------------------------------------------------------------------
    function setFright() {
      if (S_.fright <= 0) { return; }
      frightT = S_.fright * 60; ghostsEaten = 0;
      for (const gh of ghosts) { if (gh.mode === "eyes" || gh.mode === "entering") continue; gh.fright = true; if (gh.mode === "scatter" || gh.mode === "chase") gh.dir = REV(gh.dir); }
    }
    function switchMode(m) { globalMode = m; for (const gh of ghosts) if (gh.mode === "scatter" || gh.mode === "chase") { gh.mode = m; gh.dir = REV(gh.dir); } }
    function playTick() {
      // waves (paused while frightened)
      if (frightT > 0) {
        frightT--;
        if (frightT === 0) { for (const gh of ghosts) gh.fright = false; }
      } else {
        waveT++;
        if (waveT >= S_.waves[waveIdx] * 60 && waveIdx < 7) { waveIdx++; switchMode(waveIdx % 2 === 0 ? "scatter" : "chase"); waveT = 0; }
      }
      // release timer
      releaseT++;
      if (releaseT >= S_.releaseTimer * 60) { const gh = houseGhost(); if (gh) gh.mode = "leaving"; releaseT = 0; }
      releaseByLimits();
      // Cruise Elroy
      const red = ghosts[0];
      red.elroy = dotsLeft <= S_.e2 ? 2 : dotsLeft <= S_.e1 ? 1 : 0;
      if (ghosts[3].mode === "house" && globalCounter >= 0) red.elroy = 0;
      // pac
      if (pacStop > 0) pacStop--;
      else movePac(BASE * (frightT > 0 ? S_.pacF : S_.pac) / 100);
      const px = tileX(pac.x), py = tileY(pac.y);
      if (py >= 0 && py < MH && px >= 0 && px < MW && dots[py][px]) {
        const v = dots[py][px]; dots[py][px] = 0; dotsLeft--; dotsEaten++;
        addScore(v === 2 ? 50 : 10); pacStop = v === 2 ? 3 : 1;
        if (v === 2) { setFright(); sfx.energiser(); haptic("light"); } else sfx.waka();
        onDotEaten();
        if (dotsEaten === 70 || dotsEaten === 170) { fruit = { kind: S_.fruit[0], pts: S_.fruit[1], x: 112, y: 164 }; fruitT = Math.round(rnd(9.3, 10) * 60); }
        if (dotsLeft === 0) { state = "clear"; stateT = 0; sirenOff(); try { ctx.platform.milestone("level", { level }); } catch (_) {} return; }
      }
      // fruit
      if (fruit) { if (--fruitT <= 0) fruit = null; else if (Math.abs(pac.x - fruit.x) < 8 && Math.abs(pac.y - fruit.y) < 8) { addScore(fruit.pts); popups.push({ x: fruit.x, y: fruit.y, text: String(fruit.pts), t: 120, color: "#ffb8ff" }); sfx.fruit(); haptic("medium"); fruit = null; } }
      // ghosts
      for (const gh of ghosts) updateGhost(gh);
      // collisions (tile based, like the original)
      for (const gh of ghosts) {
        if (gh.mode === "eyes" || gh.mode === "entering" || gh.mode === "house" || gh.mode === "leaving" && gh.y > 120) continue;
        if (tileX(gh.x) === px && tileY(gh.y) === py) {
          if (gh.fright) {
            const pts = 200 * Math.pow(2, ghostsEaten); ghostsEaten++;
            addScore(pts); eatenGhost = gh; gh.fright = false; gh.mode = "eyes";
            popups.push({ x: gh.x, y: gh.y, text: String(pts), t: 60, color: "#00ffff" });
            state = "eaten"; stateT = 0; sfx.ghost(); haptic("medium");
            return;
          }
          state = "dying"; stateT = 0; sirenOff(); haptic("heavy");
          try { ctx.platform.fail({ cause: gh.name + " ghost", score, level }); } catch (_) {}
          return;
        }
      }
      // sounds
      const anyEyes = ghosts.some((gh) => gh.mode === "eyes" || gh.mode === "entering");
      sirenStage = dotsLeft > 180 ? 0 : dotsLeft > 120 ? 1 : dotsLeft > 60 ? 2 : dotsLeft > 20 ? 3 : 4;
      sirenTick(anyEyes ? "eyes" : frightT > 0 ? "fright" : "siren", sirenStage);
    }

    function gameOver() {
      state = "gameover"; stateT = 0; sirenOff();
      try {
        ctx.memory.record("score").submit(score, { label: score.toLocaleString("en-US") + " pts" }).catch(() => {});
        ctx.memory.record("level").submit(level, { label: "level " + level }).catch(() => {});
        ctx.platform.complete({ score, level });
      } catch (_) {}
    }
    function tick() {
      frames++; stateT++;
      for (const p of popups) p.t--; popups = popups.filter((p) => p.t > 0);
      switch (state) {
        case "ready": if (stateT > (levelsCleared === 0 && lives === 3 && dotsEaten === 0 ? 130 : 80)) { state = "play"; stateT = 0; sirenOn(); try { ctx.platform.interact(); } catch (_) {} } break;
        case "play": playTick(); break;
        case "eaten": if (stateT > 50) { state = "play"; stateT = 0; } break;
        case "dying": if (stateT === 60) sfx.death(); if (stateT > 60) pac.deadT++; if (stateT > 170) { lives--; if (lives <= 0) gameOver(); else { resetActors(false); state = "ready"; stateT = 0; } } break;
        case "clear": if (stateT > 60) { state = "flash"; stateT = 0; } break;
        case "flash": if (stateT > 28 * 4) { levelsCleared++; startLevel(level + 1); state = "ready"; stateT = 0; } break;
        case "gameover": if (stateT > 240) { state = "title"; stateT = 0; } break;
      }
    }
    function startGame() {
      score = 0; lives = 3; extraGiven = false; levelsCleared = 0; fruitsShown = [];
      startLevel(1); state = "ready"; stateT = 0; sfx.start();
      try { ctx.platform.setScore(0); } catch (_) {}
    }

    // ---- drawing ------------------------------------------------------------------------------------
    const BODY_A = [
      "....XXXXXX....", "..XXXXXXXXXX..", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX",
      "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XX.XXX..XXX.XX", "X...XX..XX...X"];
    const BODY_B = [
      "....XXXXXX....", "..XXXXXXXXXX..", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX",
      "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", ".XXX.XXXX.XXX.", "..X...XX...X.."];
    const bodyCache = {};
    function body(color, frame) {
      const key = color + frame; if (bodyCache[key]) return bodyCache[key];
      const rows = frame ? BODY_B : BODY_A, oc = new OffscreenCanvas(14, 14), c = oc.getContext("2d"); c.fillStyle = color;
      for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) if (rows[y][x] === "X") c.fillRect(x, y, 1, 1);
      bodyCache[key] = oc; return oc;
    }
    function drawGhost(gh) {
      const x = Math.round(gh.x) - 7, y = Math.round(gh.y) - 7, frame = Math.floor(frames / 8) % 2;
      const eyesOnly = gh.mode === "eyes" || gh.mode === "entering";
      if (!eyesOnly) {
        if (gh.fright) {
          const flash = frightT < S_.flashes * 28 && Math.floor(frightT / 14) % 2 === 1;
          fb.drawImage(body(flash ? "#f8f8f8" : "#2121ff", frame), x, y);
          const fc = flash ? "#ff0000" : "#ffb8ae"; fb.fillStyle = fc;
          fb.fillRect(x + 4, y + 5, 2, 2); fb.fillRect(x + 8, y + 5, 2, 2);
          for (let i = 0; i < 6; i++) fb.fillRect(x + 1 + i * 2, y + 9 + (i % 2), 2, 1);   // zigzag mouth
          return;
        }
        fb.drawImage(body(gh.color, frame), x, y);
      }
      // eyes
      const ex = DX[gh.dir], ey = DY[gh.dir];
      fb.fillStyle = "#fff";
      fb.fillRect(x + 2 + ex, y + 3 + ey, 4, 5); fb.fillRect(x + 8 + ex, y + 3 + ey, 4, 5);
      fb.fillStyle = "#2121ff";
      fb.fillRect(x + 3 + ex * 2, y + 4 + ey * 2, 2, 2); fb.fillRect(x + 9 + ex * 2, y + 4 + ey * 2, 2, 2);
    }
    const pacCache = {};
    function pacSprite(dir, half) {   // 13px round with a wedge mouth of the given half-angle (radians)
      const key = dir + ":" + half.toFixed(2); if (pacCache[key]) return pacCache[key];
      const oc = new OffscreenCanvas(13, 13), c = oc.getContext("2d"); c.fillStyle = "#ffff00";
      const base = [Math.PI * 1.5, Math.PI, Math.PI * 0.5, 0][dir];
      for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
        const dx = x - 6, dy = y - 6; if (dx * dx + dy * dy > 42) continue;
        if (half > 0) { let a = Math.atan2(dy, dx) - base; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.abs(a) < half) continue; }
        c.fillRect(x, y, 1, 1);
      }
      pacCache[key] = oc; return oc;
    }
    function drawPac() {
      const x = Math.round(pac.x) - 6, y = Math.round(pac.y) - 6;
      if (state === "dying") {
        if (stateT < 60) { fb.drawImage(pacSprite(pac.dir, [0, 0.55, 1.05][pac.mouth]), x, y); return; }
        const t = pac.deadT;
        if (t < 90) { fb.drawImage(pacSprite(0, 0.3 + (t / 90) * 2.9), x, y); return; }
        if (t < 110) { fb.strokeStyle = "#ffff00"; fb.lineWidth = 1; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r0 = 3 + (t - 90) * 0.4, r1 = r0 + 2; fb.beginPath(); fb.moveTo(pac.x + Math.cos(a) * r0, pac.y + Math.sin(a) * r0); fb.lineTo(pac.x + Math.cos(a) * r1, pac.y + Math.sin(a) * r1); fb.stroke(); } }
        return;
      }
      fb.drawImage(pacSprite(pac.dir, [0, 0.55, 1.05][pac.mouth]), x, y);
    }
    function drawDots() {
      fb.fillStyle = "#ffb8ae";
      const blinkOn = Math.floor(frames / 10) % 2 === 0;
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        const v = dots[y][x]; if (!v) continue;
        if (v === 1) fb.fillRect(x * T + 3, (y + MAZE_Y) * T + 3, 2, 2);
        else if (blinkOn || state !== "play") { const cx = x * T + 4, cy = (y + MAZE_Y) * T + 4; fb.fillRect(cx - 4, cy - 2, 8, 4); fb.fillRect(cx - 2, cy - 4, 4, 8); fb.fillRect(cx - 3, cy - 3, 6, 6); }
      }
    }
    function pad(n) { return String(Math.max(0, Math.floor(n))); }
    function drawHUD() {
      const on1up = Math.floor(frames / 16) % 2 === 0 || state !== "play";
      if (on1up) text("1UP", 24, 0, "#fff");
      text("HIGH SCORE", 72, 0, "#fff");
      const sc = pad(score || 0); text(sc.length < 2 ? "00" : sc, 56 - Math.max(2, sc.length) * 8, 8, "#fff");
      if (best > 0) { const hs = pad(best); text(hs, 136 - hs.length * 8, 8, "#fff"); }
      for (let i = 0; i < Math.min(lives - 1, 5); i++) fb.drawImage(LIFE_SPR, 16 + i * 16, 273);
      for (let i = 0; i < fruitsShown.length; i++) fb.drawImage(FRUIT_SPR[fruitsShown[i]], 196 - (fruitsShown.length - 1 - i) * 16, 272);
    }
    function drawPlay() {
      fb.fillStyle = "#000"; fb.fillRect(0, 0, FW, FH);
      const white = state === "flash" && Math.floor(stateT / 14) % 2 === 1;
      fb.drawImage(white ? mazeWhite : mazeBlue, 0, 0);
      drawDots();
      if (fruit) fb.drawImage(FRUIT_SPR[fruit.kind], fruit.x - 6, fruit.y - 6);
      if (state !== "flash" && state !== "gameover") {
        const hideGhosts = state === "dying" && stateT > 60 || state === "clear" && stateT > 30;
        if (!hideGhosts) for (const gh of ghosts) { if (state === "eaten" && gh === eatenGhost) continue; drawGhost(gh); }
        if (!(state === "eaten")) drawPac(); 
      }
      for (const p of popups) textC(p.text, p.x, p.y - 3, p.color);
      if (state === "ready") { textC("READY!", 112, 184, "#ffff00"); if (levelsCleared === 0 && lives === 3 && dotsEaten === 0) textC("PLAYER ONE", 112, 136, "#00ffff"); }
      if (state === "gameover") textC("GAME OVER", 112, 184, "#ff0000");
      drawHUD();
    }
    function textBig(s, x, y, color) { for (let i = 0; i < s.length; i++) if (s[i] !== " ") fb.drawImage(glyph(s[i], color), x + i * 16, y, 16, 16); }
    function drawTitle() {
      fb.fillStyle = "#000"; fb.fillRect(0, 0, FW, FH);
      textBig("MUNCH", 72, 28, "#ffff00"); textBig("MAZE", 80, 48, "#2121ff");
      text("CHARACTER / NICKNAME", 40, 84, "#fff");
      const names = [["-SHADOW", "\"CHASER\""], ["-SPEEDY", "\"AMBUSH\""], ["-BASHFUL", "\"FICKLE\""], ["-POKEY", "\"DAWDLE\""]];
      GHOSTS.forEach((gs, i) => {
        const y = 100 + i * 20, shown = Math.min(4, Math.floor(stateT / 40));
        if (i >= shown) return;
        drawGhost({ x: 40, y: y + 7, dir: 1, color: gs.color, fright: false, mode: "scatter" });
        text(names[i][0], 56, y, gs.color); text(names[i][1], 128, y, gs.color);
      });
      if (stateT > 200) {
        fb.fillStyle = "#ffb8ae"; fb.fillRect(83, 203, 2, 2); text("10 PTS", 96, 200, "#fff");
        fb.fillRect(80, 210, 8, 4); fb.fillRect(82, 208, 4, 8); text("50 PTS", 96, 208, "#fff");
      }
      text("HIGH SCORE " + pad(best), 32, 232, "#00ffff");
      text("SWIPE TO STEER", 56, 246, "#fff");
      if (Math.floor(frames / 25) % 2) textC("TAP TO START", 112, 262, "#ffff00");
    }
    function drawFrame() { if (state === "title") drawTitle(); else drawPlay(); }

    // ---- layout + present -----------------------------------------------------------------------------
    const dpr = ctx.dpr || 1;
    let W = ctx.width, Hh = ctx.height, S = 1, ox = 0, oy = 0;
    function layout() {
      W = ctx.width; Hh = ctx.height;
      const availH = Hh - sa.top - sa.bottom - 24;
      S = Math.max(1, Math.floor(Math.min(canvas.width / FW, availH * dpr / FH)));
      ox = Math.floor((canvas.width - FW * S) / 2);
      oy = Math.floor(((sa.top + 8) * dpr + Math.max(0, (availH * dpr - FH * S) * 0.35)));
    }
    layout();
    function present() {
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, canvas.width, canvas.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(fbc, ox, oy, FW * S, FH * S);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.font = "16px ui-monospace,Menlo,Consolas,monospace"; g.fillStyle = "rgba(255,255,255,0.7)"; g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(muted ? "🔇" : "🔊", W - sa.right - 12, sa.top + 18);
    }

    // ---- input ----------------------------------------------------------------------------------------
    let swipe = null;
    function anyStart() {
      if (!started) { started = true; try { ctx.platform.start(); } catch (_) {} }
      ensureAC(); resumeAC();
      if (state === "title") { startGame(); return true; }
      if (state === "gameover" && stateT > 40) { state = "title"; stateT = 0; return true; }
      return false;
    }
    ctx.listen(canvas, "pointerdown", (e) => {
      if (e.clientX > W - sa.right - 44 && e.clientY < sa.top + 34) { muted = !muted; store.set("muted", muted); applyMute(); sfx.ui(); return; }
      if (anyStart()) return;
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    ctx.listen(canvas, "pointermove", (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.hypot(dx, dy) < 12) return;
      want = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 3) : (dy < 0 ? 0 : 2);
      swipe.x = e.clientX; swipe.y = e.clientY;
    });
    const up = (e) => { if (swipe && e.pointerId === swipe.id) swipe = null; };
    ctx.listen(canvas, "pointerup", up); ctx.listen(canvas, "pointercancel", up);
    const KEYMAP = { ArrowUp: 0, KeyW: 0, ArrowLeft: 1, KeyA: 1, ArrowDown: 2, KeyS: 2, ArrowRight: 3, KeyD: 3 };
    ctx.listen(document, "keydown", (e) => {
      if (e.code === "Enter" || e.code === "Space") { anyStart(); e.preventDefault(); return; }
      const d = KEYMAP[e.code]; if (d == null) return; e.preventDefault(); anyStart(); want = d;
    });

    // ---- main loop -------------------------------------------------------------------------------------
    let acc = 0, last = ctx.width + "x" + ctx.height;
    ctx.onFrame((dtMs) => {
      const now = ctx.width + "x" + ctx.height; if (now !== last) { last = now; layout(); }
      acc += Math.min(dtMs, 100);
      let n = 0; while (acc >= 1000 / 60 && n < 6) { acc -= 1000 / 60; tick(); n++; }
      if (n === 6) acc = 0;
      drawFrame(); present();
    });

    // debug hooks for the headless harness
    window.__mmInfo = () => ({ state, stateT, level, score, lives, dotsLeft, dotsEaten, px: Math.round(pac ? pac.x : 0), py: Math.round(pac ? pac.y : 0), dir: pac ? pac.dir : -1, want, fright: frightT, mode: globalMode, wave: waveIdx, ghosts: ghosts.map((gh) => [gh.name, gh.mode, Math.round(gh.x), Math.round(gh.y), gh.dir, gh.fright]), fruit: !!fruit, S, W, Hh });
    window.__mmStart = () => anyStart();
    window.__mmSkip = () => { if (state === "ready") { state = "play"; stateT = 0; sirenOn(); } };
    window.__mmWant = (d) => { want = d; };
    window.__mmWarp = (x, y) => { pac.x = x; pac.y = y; };
    window.__mmFright = () => setFright();
    window.__mmNearlyDone = () => { for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (dots[y][x] && !(y === 29 && x < 4)) { dots[y][x] = 0; } dotsLeft = 0; for (const r of dots) for (const v of r) if (v) dotsLeft++; dotsEaten = TOTAL_DOTS - dotsLeft; };
    window.__mmDie = () => { if (state === "play") { state = "dying"; stateT = 0; sirenOff(); } };
    window.__mmEatAll = () => { for (const r of dots) r.fill(0); dotsLeft = 1; dots[29][1] = 1; dotsEaten = TOTAL_DOTS - 1; };
    window.__mmFruit = () => { dotsEaten = 69; };
    window.__mmRelease = () => { for (const gh of ghosts) if (gh.mode === "house") gh.mode = "leaving"; };

    drawFrame(); present();
    try { ctx.markVisualReady("title"); } catch (_) {}
    ctx.platform.ready();
  }
};
