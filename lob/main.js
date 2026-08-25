/**
 * Lob — artillery for two people and one phone.
 *
 * Two tanks at opposite ends of a destructible landscape. On your turn you set
 * an angle and a power, pick one of eight single-use weapons and fire. The
 * shell arcs under gravity and a crosswind, bites a crater out of the ground
 * and hurts anything inside the blast. Turns alternate until somebody is at
 * zero.
 *
 * Four decisions drive the whole build.
 *
 * **Both control decks are on screen at once, one at each physical end.** The
 * bottom deck belongs to Azure, the top deck to Ember and is drawn rotated a
 * half turn so it reads right-way-up from that seat. Only the deck whose turn
 * it is lights up; the other is scrimmed and refuses input. That means neither
 * player ever loses sight of their own health or their remaining arsenal, and
 * neither ever has to reach across the other's hands.
 *
 * **Angle is measured relative to your own line of fire, not to the screen.**
 * Zero points flat at your opponent, 90 is straight up, 180 is over your own
 * shoulder. Both players read the same number and mean the same shot. The
 * alternative — an absolute 0–180 compass — would make Ember's useful range
 * 90–180 and every printed hint wrong for one of the two people playing. It
 * also makes the aim dome work for both seats: local "right" on a rotated deck
 * is screen-left, which is exactly where Ember's opponent is.
 *
 * **The battlefield never rotates.** Spinning the world a half turn between
 * turns is a lovely piece of juice, but it cannot coexist with two decks that
 * are both visible — the dimmed one would end up at the wrong end. So the
 * terrain stays put, both players watch the same shell, and only the chrome
 * turns. Every deck hit-test runs through the single inverse of the single
 * render transform, in `screenToDeck`, so there is exactly one place for that
 * bug to live.
 *
 * **The ground is one number per screen column.** A Float32Array of surface
 * heights makes craters, tunnels, dirt piles and pedestals all the same three
 * lines of code, keeps collision to one array read, and lets the contour
 * banding be five copies of one polyline offset downward. It cannot represent
 * caves or overhangs, so there are no cave weapons: the Auger digs a shaft
 * from the surface down, which a heightmap represents exactly.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so the arcade
 * lettering is a hand-built 5x7 block font drawn as canvas rects, and every
 * icon is a path. The overlay is one markup string on ctx.createRoot() rather
 * than document.createElement, pointer maths uses offsetX/offsetY rather than
 * getBoundingClientRect, and soft glows are stacked strokes rather than a
 * canvas blur filter — all three are rejected at upload and none of them are
 * documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Lob",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "artillery", "two-player", "arcade", "turn-based"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
    const TAU = Math.PI * 2;
    const RAD = Math.PI / 180;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    /** Escape anything that could ever be player-authored before innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* Cheap deterministic hash — stars, grain and debris jitter all need a
     * stable "random" that does not change every frame. */
    function hash(n) {
      n = (n ^ 61) ^ (n >>> 16);
      n = (n + (n << 3)) | 0;
      n = n ^ (n >>> 4);
      n = Math.imul(n, 0x27d4eb2d);
      n = n ^ (n >>> 15);
      return (n >>> 0) / 4294967296;
    }

    /* =================================================================
     * PALETTE
     *
     * A violet night that burns to rose at the horizon, over amber
     * contour terrain. The terrain is the loudest thing on screen and it
     * is the thing the whole game is about, so it gets the warm end of
     * the spectrum entirely to itself.
     * ================================================================= */
    const SKY = [
      [0.00, "#05040E"], [0.40, "#0B0822"], [0.66, "#1E0B3C"],
      [0.85, "#4A1150"], [1.00, "#8E1B4B"],
    ];
    const BANDS = [
      { d: 0,   c: "#FFE066" },   // rim highlight, the hot edge of the world
      { d: 3,   c: "#F5A524" },
      { d: 20,  c: "#D2601A" },
      { d: 50,  c: "#A8400F" },
      { d: 90,  c: "#7A2C11" },
      { d: 138, c: "#4E1B0B" },
    ];
    const DIRT_DARK = "#3A1409";
    const OUTLINE = "#1B0716";

    const DECK_SLAB_A = "#12131C";
    const DECK_SLAB_B = "#05050A";
    const PLATE = "#181B26";
    const PLATE_HI = "#353C51";
    const PLATE_LO = "#000000";
    const INSET = "#05060B";
    const INSET_EDGE = "#282E3D";
    const LABEL = "#8E97AD";
    const VALUE = "#E8EEFB";

    const PLAYERS_DEF = [
      { name: "AZURE", ink: "#29D3F0", dim: "#0E5566", glow: "rgba(41,211,240," },
      { name: "EMBER", ink: "#FF6A3C", dim: "#6E2410", glow: "rgba(255,106,60," },
    ];

    /* =================================================================
     * BLOCK FONT — a 5x7 arcade face built from canvas rects.
     *
     * There are no packaged assets and no remote font URLs, so the display
     * face is drawn rather than loaded. Each glyph is 35 characters of
     * "#" and "."; a whole string becomes one Path2D of rects and one
     * fill, which keeps a HUD full of lettering to a handful of draw
     * calls per frame.
     * ================================================================= */
    /**
     * The 5x7 arcade face, one glyph per key, seven rows of five. Written
     * out rather than packed so a wrong pixel is visible in the source.
     */
    const GLYPHS = {
      "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
      "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
      "C": [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
      "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
      "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
      "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
      "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
      "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
      "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
      "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
      "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
      "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
      "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
      "N": ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
      "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
      "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
      "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
      "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
      "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
      "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
      "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
      "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
      "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
      "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
      "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
      "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
      "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
      "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
      "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
      "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
      "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
      "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
      "6": [".###.", "#...#", "#....", "####.", "#...#", "#...#", ".###."],
      "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
      "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
      "9": [".###.", "#...#", "#...#", ".####", "....#", "#...#", ".###."],
      " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
      ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
      "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
      "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
      "?": [".###.", "#...#", "....#", "..##.", "..#..", ".....", "..#.."],
      ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
      "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
      "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
      "*": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."],
      "^": [".###.", "#...#", "#...#", ".###.", ".....", ".....", "....."],
      ">": ["#....", ".#...", "..#..", "...#.", "..#..", ".#...", "#...."],
      "<": ["....#", "...#.", "..#..", ".#...", "..#..", "...#.", "....#"],
      ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
      "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
    };
    const FONT = {};
    for (const k in GLYPHS) FONT[k] = GLYPHS[k].join("");

    /** Advance width of a block string at pixel size s. */
    const blockW = (t, s) => (t.length ? t.length * 6 * s - s : 0);

    /** One Path2D of rects for a whole string; one fill draws it. */
    function blockPath(text, x, y, s, into) {
      const p = into || new Path2D();
      let cx = x;
      const t = String(text).toUpperCase();
      for (let i = 0; i < t.length; i++) {
        const gl = FONT[t[i]];
        if (gl) {
          for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 5; c++) {
              if (gl.charCodeAt(r * 5 + c) === 35) p.rect(cx + c * s, y + r * s, s, s);
            }
          }
        }
        cx += 6 * s;
      }
      return p;
    }

    /**
     * Draw arcade lettering. `align` positions horizontally, `y` is the top of
     * the cap height. A hard offset shadow rather than a soft one — this face
     * belongs to a cabinet, not to a print job.
     */
    function blockText(g, text, x, y, s, opts) {
      const o = opts || {};
      const w = blockW(String(text), s);
      const ax = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
      if (o.shadow) {
        g.fillStyle = o.shadowColour || "rgba(0,0,0,0.85)";
        g.fill(blockPath(text, ax + (o.shadow[0] || 0), y + (o.shadow[1] || 0), s));
      }
      if (o.outline) {
        // One combined path, filled once. Eight separate fills stack their
        // alpha over each other, so a half-faded number came back ringed in
        // solid black instead of fading with the rest of it.
        const halo = new Path2D();
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx || dy) blockPath(text, ax + dx * s * 0.4, y + dy * s * 0.4, s, halo);
          }
        }
        g.fillStyle = o.outline;
        g.fill(halo);
      }
      g.fillStyle = o.colour || VALUE;
      g.fill(blockPath(text, ax, y, s));
      return w;
    }

    /* =================================================================
     * CANVAS PRIMITIVES
     * ================================================================= */
    function rr(g, x, y, w, h, r) {
      const k = Math.min(r, w / 2, h / 2);
      g.beginPath();
      g.moveTo(x + k, y);
      g.arcTo(x + w, y, x + w, y + h, k);
      g.arcTo(x + w, y + h, x, y + h, k);
      g.arcTo(x, y + h, x, y, k);
      g.arcTo(x, y, x + w, y, k);
      g.closePath();
    }

    /**
     * The machined plate every control is built from: a rounded slab with a
     * light bevel along its top-left and a black one along its bottom-right.
     * Pressing inverts the two, which is the whole of the press animation.
     */
    function plate(g, x, y, w, h, r, o) {
      const opt = o || {};
      const pressed = !!opt.pressed;
      rr(g, x, y, w, h, r);
      if (opt.fill) {
        g.fillStyle = opt.fill;
      } else {
        const grad = g.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0, "#1E2230");
        grad.addColorStop(1, "#101320");
        g.fillStyle = grad;
      }
      g.fill();
      g.save();
      g.clip();
      g.lineWidth = 2;
      g.strokeStyle = pressed ? PLATE_LO : (opt.hi || PLATE_HI);
      g.beginPath();
      g.moveTo(x + 1, y + h);
      g.lineTo(x + 1, y + r * 0.6);
      g.quadraticCurveTo(x + 1, y + 1, x + r * 0.6, y + 1);
      g.lineTo(x + w, y + 1);
      g.stroke();
      g.strokeStyle = pressed ? (opt.hi || PLATE_HI) : PLATE_LO;
      g.beginPath();
      g.moveTo(x + w - 1, y);
      g.lineTo(x + w - 1, y + h - r * 0.6);
      g.quadraticCurveTo(x + w - 1, y + h - 1, x + w - r * 0.6, y + h - 1);
      g.lineTo(x, y + h - 1);
      g.stroke();
      g.restore();
    }

    /** A darker recess sunk into a plate, where readouts live. */
    function inset(g, x, y, w, h, r, fill) {
      rr(g, x, y, w, h, r);
      g.fillStyle = fill || INSET;
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = INSET_EDGE;
      g.stroke();
    }

    /**
     * A glow without the canvas blur filter, which is rejected at upload
     * because the property also accepts url(#…). Stacked strokes of
     * increasing width and falling alpha give the same falloff.
     */
    function glowStroke(g, pathFn, colour, width, alpha) {
      g.save();
      g.lineJoin = "round";
      g.lineCap = "round";
      for (let i = 3; i >= 1; i--) {
        g.strokeStyle = colour + (alpha * (0.18 * i * i * 0.36)).toFixed(3) + ")";
        g.lineWidth = width * (1 + i * 1.1);
        pathFn(g);
        g.stroke();
      }
      g.restore();
    }

    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;   // older WebViews draw live
      return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    }

    /* =================================================================
     * SETTINGS
     * ================================================================= */
    const saved = (function () {
      try { return ctx.storage.get("lob") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      arsenal: saved.arsenal === "wild" ? "wild" : "mirror",
      wind: saved.wind === undefined ? 1 : clamp(saved.wind | 0, 0, 2),
      armour: [60, 80, 120].indexOf(saved.armour) >= 0 ? saved.armour : 80,
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("lob", settings); } catch (_) {} }
    const WIND_MAX = [0, 0.013, 0.026];

    /* =================================================================
     * SOUND
     *
     * An arcade bed that tightens as the losing tank's armour falls, a
     * sting on every moment that matters, and a duck before each blast so
     * the explosion has room. All of it inside try/catch: audio is a
     * nicety and must never be able to stop a match.
     * ================================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "arcade", volume: 0.3, tempo: 108, intensity: 0.25 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        heat(v) { if (!muted) { try { (bed || ctx.music).setIntensity(clamp(v, 0, 1)); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted;
          settings.mute = muted;
          saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 200 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* =================================================================
     * LAYOUT
     *
     * Two decks pinned to the two physical ends inside the safe area, the
     * battlefield in the band between them. Nothing lives in the side
     * margins: a 390px-wide screen leaves about seven pixels each side,
     * and a button column there would sit exactly on top of a tank.
     * ================================================================= */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");

    let W = 0, H = 0;
    let SAFE_T = 0, SAFE_B = 0;
    let DECK_H = 0, TOP_Y = 0, BOT_Y = 0, BF_TOP = 0, BF_BOT = 0, BF_H = 0;
    let DL = null, DSC = 1;

    function measure() {
      W = Math.max(240, ctx.width);
      H = Math.max(420, ctx.height);
      SAFE_T = ctx.safeArea.top || 0;
      SAFE_B = ctx.safeArea.bottom || 0;
      const usable = H - SAFE_T - SAFE_B;
      DECK_H = Math.round(clamp(Math.min(usable * 0.276, (usable - 250) / 2), 176, 224));
      DSC = DECK_H / 210;
      TOP_Y = SAFE_T;
      BOT_Y = H - SAFE_B - DECK_H;
      BF_TOP = TOP_Y + DECK_H;
      BF_BOT = BOT_Y;
      BF_H = BF_BOT - BF_TOP;

      // Deck-local geometry. Written against a 390x210 deck and stretched
      // proportionally, so every control keeps a >=48px touch target.
      const M = 11;
      const innerW = W - M * 2;
      const domeW = Math.round(innerW * 0.494);
      const rx = M + domeW + 8;
      const rw = W - M - rx;
      const sw = 48;
      const vw = rw - sw * 2 - 8;
      const y = (v) => Math.round(v * DSC);
      DL = {
        rail:   { x: M, y: y(6),   w: innerW, h: y(30) },
        dome:   { x: M, y: y(44),  w: domeW,  h: y(102) },
        angM:   { x: rx,               y: y(44), w: sw, h: y(50) },
        angV:   { x: rx + sw + 4,      y: y(44), w: vw, h: y(50) },
        angP:   { x: rx + sw + vw + 8, y: y(44), w: sw, h: y(50) },
        powM:   { x: rx,               y: y(96), w: sw, h: y(50) },
        powV:   { x: rx + sw + 4,      y: y(96), w: vw, h: y(50) },
        powP:   { x: rx + sw + vw + 8, y: y(96), w: sw, h: y(50) },
        weapon: { x: M, y: y(152), w: domeW, h: y(50) },
        fire:   { x: M + domeW + 12, y: y(152), w: innerW - domeW - 12, h: y(50) },
      };
      DL.domeOx = DL.dome.x + DL.dome.w / 2;
      DL.domeOy = DL.dome.y + DL.dome.h - y(4);
      DL.domeR = Math.min(DL.dome.w / 2 - 6, DL.dome.h - y(14));
    }

    function fitCanvas() {
      measure();
      const dpr = ctx.dpr || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fitCanvas();

    /* --- the one render transform, and its one inverse -------------------
     * Ember's deck is drawn rotated a half turn about its own centre. Every
     * pointer that lands on it is mapped back through exactly this inverse
     * and nothing else, which is the only way that transform stays honest. */
    function deckTop(who) { return who === 0 ? BOT_Y : TOP_Y; }
    function pushDeck(gg, who) {
      gg.save();
      if (who === 0) gg.translate(0, BOT_Y);
      else { gg.translate(W, TOP_Y + DECK_H); gg.rotate(Math.PI); }
    }
    function deckToScreen(who, lx, ly) {
      return who === 0
        ? { x: lx, y: BOT_Y + ly }
        : { x: W - lx, y: TOP_Y + DECK_H - ly };
    }
    function screenToDeck(who, px, py) {
      return who === 0
        ? { x: px, y: py - BOT_Y }
        : { x: W - px, y: TOP_Y + DECK_H - py };
    }
    const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

    /* =================================================================
     * WEAPONS
     *
     * Twelve behaviours, not twelve damage numbers. Every one of them
     * changes what you have to think about: where the shell splits, which
     * way the ground slopes, whether there is anything between you and
     * the target, whether you would rather move the hill than the tank.
     * ================================================================= */
    const WEAPONS = [
      { id: "lob", name: "Lobber", tag: "The dependable one.",
        dmg: 32, rad: 36, crater: 30, ink: "#FFE066", icon: "lob" },
      { id: "buck", name: "Buckshot", tag: "Splits five ways at apex.",
        dmg: 15, rad: 26, crater: 22, ink: "#FF9E4D", icon: "buck", apex: "split", n: 5, spread: 7 },
      { id: "mort", name: "Mortar", tag: "Steep arc. Clears walls.",
        dmg: 38, rad: 46, crater: 46, ink: "#FFB03B", icon: "mort", steep: 72 },
      { id: "roll", name: "Roller", tag: "Lands, then runs downhill.",
        dmg: 34, rad: 34, crater: 32, ink: "#7CE38B", icon: "roll", hit: "roll" },
      { id: "bounce", name: "Bouncer", tag: "Skips off the ground.",
        dmg: 30, rad: 32, crater: 28, ink: "#FF6FD0", icon: "bounce", hit: "bounce", bounces: 3 },
      { id: "auger", name: "Auger", tag: "Drills down, then blows.",
        dmg: 34, rad: 30, crater: 28, ink: "#C07BFF", icon: "auger", hit: "dig", depth: 116, bore: 11 },
      { id: "rail", name: "Railgun", tag: "Flat and fast. No wind.",
        dmg: 36, rad: 26, crater: 22, ink: "#FF3B6B", icon: "rail", grav: 0, windK: 0, speed: 2.0 },
      { id: "sky", name: "Skyfall", tag: "Seven bombs from above.",
        dmg: 14, rad: 24, crater: 20, ink: "#5AC8FF", icon: "sky", hit: "strike", n: 7, band: 112 },
      { id: "chain", name: "Chain Shot", tag: "Four blasts, walking away.",
        dmg: 15, rad: 30, crater: 26, ink: "#FFD24D", icon: "chain", hit: "chain", n: 4, step: 42 },
      { id: "hail", name: "Hailstorm", tag: "Ten droplets from the apex.",
        dmg: 9, rad: 18, crater: 14, ink: "#8FE9FF", icon: "hail", apex: "hail", n: 10, band: 0.34 },
      { id: "dirt", name: "Dirt Bomb", tag: "Dumps a hill. No damage.",
        dmg: 0, rad: 0, crater: 60, ink: "#C98A4B", icon: "dirt", fill: true },
      { id: "wall", name: "Bulwark", tag: "Builds cover. No shot.",
        dmg: 0, rad: 0, crater: 0, ink: "#9FB4D6", icon: "wall", instant: "wall" },
    ];
    const WBY = {};
    for (const w of WEAPONS) WBY[w.id] = w;

    /** 24x24 glyphs, drawn rather than parsed, so each one can carry weight. */
    function drawIcon(gg, id, x, y, s, ink) {
      gg.save();
      gg.translate(x, y);
      gg.scale(s / 24, s / 24);
      gg.lineCap = "round";
      gg.lineJoin = "round";
      gg.strokeStyle = ink;
      gg.fillStyle = ink;
      gg.lineWidth = 2.2;
      const dot = (px, py, r) => { gg.beginPath(); gg.arc(px, py, r, 0, TAU); gg.fill(); };
      const arc = (px, py, r, a0, a1) => { gg.beginPath(); gg.arc(px, py, r, a0, a1); gg.stroke(); };
      const line = (x0, y0, x1, y1) => { gg.beginPath(); gg.moveTo(x0, y0); gg.lineTo(x1, y1); gg.stroke(); };
      const shell = (px, py, rot) => {
        gg.save(); gg.translate(px, py); gg.rotate(rot);
        gg.beginPath();
        gg.moveTo(0, -6); gg.lineTo(3, -1); gg.lineTo(3, 5); gg.lineTo(-3, 5); gg.lineTo(-3, -1);
        gg.closePath(); gg.fill();
        gg.restore();
      };
      if (id === "lob") { shell(12, 12, -0.7); line(3, 20, 8, 16); }
      else if (id === "buck") { dot(12, 14, 3.4); for (let i = 0; i < 5; i++) { const a = -Math.PI + i * (Math.PI / 4); dot(12 + Math.cos(a) * 8, 14 + Math.sin(a) * 8, 1.9); } }
      else if (id === "mort") { gg.beginPath(); gg.moveTo(2, 21); gg.quadraticCurveTo(12, -6, 22, 21); gg.stroke(); dot(22, 21, 2.4); }
      else if (id === "roll") { dot(16, 15, 4.2); line(3, 21, 21, 21); arc(16, 15, 8, -2.6, -1.2); line(4, 12, 9, 19); }
      else if (id === "bounce") { dot(19, 8, 3); gg.beginPath(); gg.moveTo(2, 20); gg.quadraticCurveTo(7, 8, 12, 20); gg.quadraticCurveTo(16, 11, 19, 18); gg.stroke(); line(1, 21, 23, 21); }
      else if (id === "auger") { gg.beginPath(); gg.moveTo(7, 2); gg.lineTo(17, 2); gg.lineTo(12, 22); gg.closePath(); gg.fill(); gg.strokeStyle = "#1B0716"; gg.lineWidth = 1.6; line(8, 8, 16, 8); line(9, 13, 15, 13); }
      else if (id === "rail") { gg.beginPath(); gg.moveTo(3, 12); gg.lineTo(16, 12); gg.lineTo(13, 7); gg.lineTo(22, 13); gg.lineTo(13, 19); gg.lineTo(16, 14); gg.lineTo(3, 14); gg.closePath(); gg.fill(); }
      else if (id === "sky") { for (let i = 0; i < 3; i++) shell(6 + i * 6, 8 + i * 4, 0.2); gg.lineWidth = 1.5; line(4, 2, 7, 5); line(11, 2, 14, 5); }
      else if (id === "chain") { for (let i = 0; i < 3; i++) dot(5 + i * 7, 15 - i * 2, 3.2 - i * 0.4); gg.lineWidth = 1.6; line(3, 21, 21, 21); }
      else if (id === "hail") { arc(12, 9, 6, Math.PI, TAU); gg.beginPath(); gg.moveTo(6, 9); gg.lineTo(18, 9); gg.stroke(); for (let i = 0; i < 4; i++) line(5 + i * 4.4, 14, 4 + i * 4.4, 21); }
      else if (id === "dirt") { gg.beginPath(); gg.moveTo(1, 21); gg.quadraticCurveTo(12, 8, 23, 21); gg.closePath(); gg.fill(); dot(7, 6, 2.2); dot(15, 3, 1.8); dot(19, 8, 1.6); }
      else if (id === "wall") { gg.fillRect(8, 4, 8, 18); gg.fillRect(5, 4, 14, 4); gg.strokeStyle = "#1B0716"; gg.lineWidth = 1.4; line(8, 12, 16, 12); }
      gg.restore();
    }

    /* =================================================================
     * TERRAIN
     *
     * One surface height per screen column. Craters, dirt domes and drill
     * shafts are all "raise or lower a run of columns", which is why the
     * ground can be genuinely destructible without a physics engine.
     * ================================================================= */
    let surf = null, surfT = null, bandPaths = null, silh = null, terrainDirty = true;
    let backRidge = null;

    /**
     * A second, softer skyline behind the playable ground. It is decoration
     * only — nothing collides with it — but it is what stops the sky reading
     * as an empty rectangle above a cutout.
     */
    function makeBackRidge() {
      const ph = Math.random() * 100, ph2 = Math.random() * 100;
      let avg = 0;
      for (let x = 0; x < W; x++) avg += surf[x];
      avg /= W;
      const base = avg - BF_H * 0.10;
      backRidge = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        backRidge[x] = base
          - Math.sin(x * 0.0102 + ph) * BF_H * 0.075
          - Math.sin(x * 0.0271 + ph2) * BF_H * 0.032
          - Math.sin(x * 0.0533 + ph) * BF_H * 0.014;
      }
    }

    function genTerrain() {
      const n = W;
      surf = new Float32Array(n);
      surfT = new Float32Array(n);

      // Midpoint displacement on a grid comfortably wider than the screen,
      // then resampled — a raw per-column random is noise, not landscape.
      let size = 1;
      while (size < n) size <<= 1;
      const a = new Float64Array(size + 1);
      const base = BF_TOP + BF_H * 0.62;
      const span = BF_H * 0.24;
      a[0] = base + (Math.random() - 0.5) * span * 0.5;
      a[size] = base + (Math.random() - 0.5) * span * 0.5;
      let step = size, amp = span;
      while (step > 1) {
        const half = step >> 1;
        for (let i = half; i < size; i += step) {
          a[i] = (a[i - half] + a[i + half]) / 2 + (Math.random() * 2 - 1) * amp;
        }
        step = half;
        amp *= 0.53;
      }
      for (let x = 0; x < n; x++) surf[x] = a[Math.round(x / (n - 1) * size)];

      // A single soft ridge in the middle often enough to matter: it is what
      // makes the Mortar and the Bouncer worth carrying.
      const bump = Math.random() < 0.7 ? BF_H * (0.06 + Math.random() * 0.15) : 0;
      const bx = 0.5 + (Math.random() - 0.5) * 0.22;
      for (let x = 0; x < n; x++) {
        const t = clamp(1 - Math.abs(x / n - bx) / 0.30, 0, 1);
        surf[x] -= bump * t * t * (3 - 2 * t);
      }

      // Two passes of a 9-tap box blur: cliffs stay, single-pixel spikes go.
      const tmp = new Float32Array(n);
      for (let pass = 0; pass < 2; pass++) {
        for (let x = 0; x < n; x++) {
          let s = 0, c = 0;
          for (let k = -4; k <= 4; k++) {
            const i = x + k;
            if (i >= 0 && i < n) { s += surf[i]; c++; }
          }
          tmp[x] = s / c;
        }
        surf.set(tmp);
      }

      const hi = BF_TOP + BF_H * 0.34, lo = BF_BOT - 20;
      for (let x = 0; x < n; x++) surf[x] = clamp(surf[x], hi, lo);
      surfT.set(surf);
      terrainDirty = true;
      makeBackRidge();
      makeSky();
    }

    /** Flatten a pad so a tank starts level rather than clinging to a cliff. */
    function levelPad(cx, half) {
      const x0 = Math.max(0, Math.round(cx - half)), x1 = Math.min(W - 1, Math.round(cx + half));
      let s = 0;
      for (let x = x0; x <= x1; x++) s += surf[x];
      const avg = s / (x1 - x0 + 1);
      for (let x = x0; x <= x1; x++) {
        const t = clamp(1 - Math.abs(x - cx) / (half * 1.7), 0, 1);
        surf[x] = lerp(surf[x], avg, t);
      }
      surfT.set(surf);
      terrainDirty = true;
    }

    /** Bite a circular crater out of the ground. */
    function carve(cx, cy, r) {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = r * r - dx * dx;
        if (d2 <= 0) continue;
        const d = Math.sqrt(d2);
        if (cy - d <= surfT[x]) surfT[x] = Math.min(BF_BOT, Math.max(surfT[x], cy + d));
      }
      terrainDirty = true;
    }

    /** The mirror of a crater: drop a dome of dirt on top of the ground. */
    function pile(cx, cy, r) {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = r * r - dx * dx;
        if (d2 <= 0) continue;
        const d = Math.sqrt(d2);
        if (cy + d >= surfT[x]) surfT[x] = Math.max(BF_TOP + 10, Math.min(surfT[x], cy - d));
      }
      terrainDirty = true;
    }

    /** A hard-edged wall, used by the Bulwark. */
    function raiseWall(cx, halfW, height) {
      const x0 = Math.max(0, Math.round(cx - halfW)), x1 = Math.min(W - 1, Math.round(cx + halfW));
      for (let x = x0; x <= x1; x++) {
        const t = clamp(1 - Math.abs(x - cx) / halfW, 0, 1);
        const h = height * Math.sqrt(Math.max(0, t)) * (0.55 + 0.45 * t);
        surfT[x] = Math.max(BF_TOP + 10, Math.min(surfT[x], surfT[x] - h));
      }
      terrainDirty = true;
    }

    function groundAt(x) {
      const i = clamp(Math.round(x), 0, W - 1);
      return surf[i];
    }

    /** Rebuild the five contour polylines. Only when the ground actually moved. */
    function buildBands() {
      bandPaths = [];
      const stepX = 3;
      for (const b of BANDS) {
        const p = new Path2D();
        p.moveTo(-2, BF_BOT + 4);
        p.lineTo(-2, Math.min(surf[0] + b.d, BF_BOT + 4));
        for (let x = 0; x < W; x += stepX) p.lineTo(x, Math.min(surf[x] + b.d, BF_BOT + 4));
        p.lineTo(W - 1, Math.min(surf[W - 1] + b.d, BF_BOT + 4));
        p.lineTo(W + 2, Math.min(surf[W - 1] + b.d, BF_BOT + 4));
        p.lineTo(W + 2, BF_BOT + 4);
        p.closePath();
        bandPaths.push(p);
      }
      silh = new Path2D();
      silh.moveTo(-2, surf[0]);
      for (let x = 0; x < W; x += stepX) silh.lineTo(x, surf[x]);
      silh.lineTo(W - 1, surf[W - 1]);
      silh.lineTo(W + 2, surf[W - 1]);
      terrainDirty = false;
    }

    /* =================================================================
     * PARTICLES
     *
     * Debris is the whole point of blowing up a hill, so chunks carry the
     * colour of the band they came out of and tumble under the same
     * gravity as the shell.
     * ================================================================= */
    const debris = [];
    const rings = [];
    const smoke = [];
    const pops = [];
    const streaks = [];

    function burstDebris(x, y, n, power, ink) {
      for (let i = 0; i < n; i++) {
        if (debris.length > 220) break;
        const a = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.5;
        const sp = power * (0.35 + Math.random() * 0.9);
        debris.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          s: 2 + Math.random() * 4.5, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.5,
          life: 40 + Math.random() * 55, t: 0,
          c: ink || BANDS[1 + ((Math.random() * 4) | 0)].c,
        });
      }
    }
    function burstSmoke(x, y, n, r) {
      for (let i = 0; i < n; i++) {
        if (smoke.length > 90) break;
        smoke.push({
          x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r * 0.6,
          vx: (Math.random() - 0.5) * 0.7, vy: -0.25 - Math.random() * 0.55,
          r: r * (0.30 + Math.random() * 0.4), life: 42 + Math.random() * 40, t: 0,
        });
      }
    }
    /**
     * Shot feedback — damage, cover — belongs to whoever pulled the trigger,
     * so it is drawn in that seat's frame. `turn` is still the shooter every
     * time this is called: the turn only flips at the end of `endTurn`, after
     * the damage total has been popped.
     */
    function popNumber(x, y, text, ink) {
      pops.push({ x, y, text, ink, flip: turn === 1, t: 0, life: 62 });
    }

    /* =================================================================
     * MATCH STATE
     * ================================================================= */
    const GRAV = 0.30;          // world px per 1/60s step, squared
    const MK = 0.125;           // muzzle speed per unit of power
    const STEP_MS = 1000 / 60;

    let phase = "title";        // title | aim | flight | resolve | over
    let players = null;
    let turn = 0;
    let volley = 1;
    let wind = 0;
    let winner = -1;
    let bestShot = 0;
    let shotsFired = 0;
    let shotDamage = 0;
    let suddenRounds = 0;
    let lastReason = "";
    let arsenalOpen = false;
    let bannerT = 0, bannerFor = 0;
    let resolveT = 0;
    let settleT = 0, flightAge = 0;
    let shakeMag = 0, shakeX = 0, shakeY = 0;
    let flash = 0;
    let titleT = 0, demoT = 90;
    const shots = [];
    const pending = [];

    function newPlayer(i) {
      const d = PLAYERS_DEF[i];
      const x = i === 0 ? Math.round(W * 0.13) : Math.round(W * 0.87);
      return {
        i, name: d.name, ink: d.ink, dim: d.dim, glow: d.glow,
        x, y: 0, facing: i === 0 ? 1 : -1,
        hp: settings.armour, maxHp: settings.armour,
        ang: 45, pow: 62, sel: 0, hand: [],
        fall: 0, tilt: 0, hurt: 0, recoil: 0,
      };
    }

    /** Deal a hand: two Lobbers so nobody is ever without a shot, six more. */
    function dealHand() {
      const pool = WEAPONS.filter((w) => w.id !== "lob").slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      const ids = ["lob", "lob"].concat(pool.slice(0, 6).map((w) => w.id));
      for (let i = ids.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
      }
      return ids.map((id) => ({ id, used: false }));
    }

    function newWind() {
      const m = WIND_MAX[settings.wind];
      wind = m === 0 ? 0 : (Math.random() * 2 - 1) * m;
      if (m > 0 && Math.abs(wind) < m * 0.2) wind = (wind < 0 ? -1 : 1) * m * 0.2;
    }

    function newMatch() {
      genTerrain();
      players = [newPlayer(0), newPlayer(1)];
      levelPad(players[0].x, 16);
      levelPad(players[1].x, 16);
      for (const p of players) p.y = groundAt(p.x);
      const a = dealHand();
      players[0].hand = a;
      players[1].hand = settings.arsenal === "mirror"
        ? a.map((h) => ({ id: h.id, used: false }))
        : dealHand();
      turn = 0; volley = 1; winner = -1;
      bestShot = 0; shotsFired = 0; shotDamage = 0; lastReason = ""; suddenRounds = 0;
      shots.length = 0; pending.length = 0;
      debris.length = 0; rings.length = 0; smoke.length = 0; pops.length = 0;
      newWind();
      selectFirstUnused(players[0]);
      selectFirstUnused(players[1]);
      phase = "aim";
      bannerT = 78; bannerFor = 0;
      sound.heat(0.25);
      paintChrome();
    }

    function selectFirstUnused(p) {
      const i = p.hand.findIndex((h) => !h.used);
      p.sel = i < 0 ? 0 : i;
    }
    const selWeapon = (p) => WBY[p.hand[p.sel] ? p.hand[p.sel].id : "lob"];
    const ammoLeft = (p) => p.hand.reduce((n, h) => n + (h.used ? 0 : 1), 0);

    /* =================================================================
     * FIRING
     * ================================================================= */
    function muzzle(p, angOverride) {
      const ang = angOverride === undefined ? p.ang : angOverride;
      const wa = ang * RAD;
      const dx = p.facing * Math.cos(wa), dy = -Math.sin(wa);
      return { x: p.x + dx * 17, y: p.y - 10 + dy * 17, dx, dy };
    }

    function spawnShell(p, w, ang, pow, opts) {
      const m = muzzle(p, ang);
      const v = pow * MK * (w.speed || 1);
      const s = Object.assign({
        x: m.x, y: m.y, vx: m.dx * v, vy: m.dy * v,
        w, owner: p.i, mode: "fly", age: 0, apexDone: false,
        bounces: 0, trail: [], dug: 0, clear: 9,
      }, opts || {});
      shots.push(s);
      return s;
    }

    function fire() {
      if (phase !== "aim" || arsenalOpen) return;
      const p = players[turn];
      const slot = p.hand[p.sel];
      if (!slot || slot.used) { selectFirstUnused(p); return; }
      const w = WBY[slot.id];
      slot.used = true;
      shotsFired++;
      shotDamage = 0;
      phase = "flight";
      settleT = 0;
      flightAge = 0;
      p.recoil = 10;
      sound.duck(0.4, 320);
      sound.sting("danger");
      sound.haptic("medium");
      ctx.platform.interact({ type: "fire", weapon: w.id, by: p.name });

      if (w.instant === "wall") {
        // No projectile: the Bulwark is a turn spent on cover instead of damage.
        raiseWall(p.x + p.facing * 30, 24, 84);
        burstDebris(p.x + p.facing * 30, p.y - 20, 16, 2.2, "#C98A4B");
        burstSmoke(p.x + p.facing * 30, p.y - 30, 6, 26);
        popNumber(p.x + p.facing * 30, p.y - 56, "COVER", "#9FB4D6");
        settleT = 26;
        return;
      }

      let ang = p.ang, pow = p.pow;
      if (w.steep && ang < w.steep) {
        // The Mortar re-solves the shot you dialled in as the steep lob that
        // covers the same flat-ground distance — same landing, over the hill.
        const v0 = pow * MK;
        const range = (v0 * v0 * Math.sin(2 * ang * RAD)) / GRAV;
        const na = w.steep;
        const nv = Math.sqrt(Math.max(1, (range * GRAV) / Math.sin(2 * na * RAD)));
        ang = na;
        pow = clamp(nv / MK, 5, 100);
      }
      const s = spawnShell(p, w, ang, pow);
      s.windK = w.windK === undefined ? 1 : w.windK;
      s.gravK = w.grav === undefined ? 1 : w.grav;
    }

    /* =================================================================
     * DETONATION
     * ================================================================= */
    function detonate(x, y, w, owner, opts) {
      const o = opts || {};
      const rad = o.rad === undefined ? w.rad : o.rad;
      const dmg = o.dmg === undefined ? w.dmg : o.dmg;
      const crater = o.crater === undefined ? w.crater : o.crater;

      if (w.fill) pile(x, y, crater);
      else if (crater > 0) carve(x, y, crater);

      const power = clamp(rad / 22, 0.6, 3.2);
      rings.push({ x, y, r: 2, max: Math.max(18, rad * 1.3), t: 0, life: 24 });
      // A thin white shock front running ahead of the fireball. Two rings at
      // different speeds is most of what separates a blast from a circle.
      rings.push({ x, y, r: 2, max: Math.max(26, rad * 2.2), t: 0, life: 14, shock: true });
      burstDebris(x, y, Math.round(8 + rad * 0.5), power * 1.5, w.fill ? "#C98A4B" : null);
      burstSmoke(x, y, Math.round(4 + rad * 0.16), rad * 0.9);
      flash = Math.min(1, flash + rad / 120);
      shakeMag = Math.min(16, shakeMag + rad * 0.16);
      sound.sting(rad > 40 ? "powerup" : "tap");
      sound.haptic(rad > 40 ? "heavy" : "light");

      if (dmg > 0 && rad > 0) {
        for (const p of players) {
          const d = Math.hypot(p.x - x, p.y - 8 - y);
          if (d >= rad) continue;
          const hit = Math.round(dmg * Math.pow(1 - d / rad, 1.3));
          if (hit <= 0) continue;
          hurt(p, hit, owner);
        }
      }
      settleT = Math.max(settleT, 22);
    }

    function hurt(p, amount, owner) {
      p.hp = Math.max(0, p.hp - amount);
      p.hurt = 16;
      // Clear of the hull: at 34 the glyph run landed across the turret of the
      // tank it was reporting on, which is the one thing you want to see.
      popNumber(p.x, p.y - 48, "-" + amount, p.i === owner ? "#FF5A5A" : p.ink);
      if (owner !== undefined && owner !== p.i) shotDamage += amount;
      sound.haptic("light");
      const low = Math.min(players[0].hp, players[1].hp) / Math.max(1, settings.armour);
      sound.heat(clamp(1 - low, 0.2, 1));
    }

    /* =================================================================
     * SIMULATION — one fixed 60Hz step.
     *
     * Everything that decides the outcome runs here, never on the frame
     * delta, so a stuttering phone and a headless test agree on where the
     * shell landed.
     * ================================================================= */
    function simStep() {
      // --- terrain settling: craters collapse rather than snap ---
      let moving = false;
      for (let x = 0; x < W; x++) {
        const d = surfT[x] - surf[x];
        if (d > 0.4 || d < -0.4) { surf[x] += d * 0.24; moving = true; }
        else if (d !== 0) surf[x] = surfT[x];
      }
      if (moving) terrainDirty = true;

      // --- tanks fall into whatever is left under them ---
      for (const p of players) {
        const gy = groundAt(p.x);
        if (p.y < gy - 0.6) {
          p.fall += 0.34;
          p.y = Math.min(gy, p.y + p.fall);
          if (p.y >= gy - 0.01) {
            const drop = p.fall;
            p.y = gy;
            p.fall = 0;
            if (drop > 2.6) {
              const dmgF = Math.min(26, Math.round((drop - 2.6) * 5));
              if (dmgF > 0) {
                hurt(p, dmgF);
                lastReason = p.name + " FELL";
                burstDebris(p.x, p.y, 10, 1.6);
              }
            }
          }
          moving = true;
        } else if (p.y > gy) {
          p.y = gy;                                   // dirt piled under it
        }
        const l = groundAt(p.x - 8), r = groundAt(p.x + 8);
        p.tilt = clamp(Math.atan2(r - l, 16), -0.62, 0.62);
        if (p.hurt > 0) p.hurt--;
        if (p.recoil > 0) p.recoil--;
      }
      if (moving) settleT = Math.max(settleT, 6);

      // --- scheduled sub-blasts (Chain Shot) ---
      for (let i = pending.length - 1; i >= 0; i--) {
        const q = pending[i];
        if (--q.t <= 0) {
          pending.splice(i, 1);
          detonate(q.x, q.y, q.w, q.owner, q.opts);
        }
      }

      // --- projectiles ---
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.age++;
        if (s.age > 620) { shots.splice(i, 1); continue; }

        if (s.mode === "roll") { stepRoller(s, i); continue; }
        if (s.mode === "dig") { stepDigger(s, i); continue; }

        const gk = s.gravK === undefined ? 1 : s.gravK;
        const wk = s.windK === undefined ? 1 : s.windK;
        s.vy += GRAV * gk;
        s.vx += wind * wk;

        const speed = Math.hypot(s.vx, s.vy);
        const sub = clamp(Math.ceil(speed / 3), 1, 10);
        let dead = false;
        for (let k = 0; k < sub && !dead; k++) {
          s.x += s.vx / sub;
          s.y += s.vy / sub;
          if (s.clear > 0) s.clear--;

          // apex behaviours fire the instant the shell stops climbing
          if (!s.apexDone && s.vy >= 0 && s.w.apex) {
            s.apexDone = true;
            if (s.w.apex === "split") { splitShell(s); shots.splice(i, 1); dead = true; break; }
            if (s.w.apex === "hail") { hailFrom(s); shots.splice(i, 1); dead = true; break; }
          }

          if (s.x < -60 || s.x > W + 60 || s.y > BF_BOT + 30) {
            shots.splice(i, 1); dead = true; break;
          }
          if (s.y < BF_TOP - 900) { shots.splice(i, 1); dead = true; break; }

          // direct hit on a hull
          if (s.clear <= 0) {
            let struck = null;
            for (const p of players) {
              if (s.y > BF_TOP - 40 && Math.abs(p.x - s.x) < 13 && Math.abs(p.y - 8 - s.y) < 12) struck = p;
            }
            if (struck) { impact(s, i, s.x, s.y, true); dead = true; break; }
          }

          if (s.y >= BF_TOP && s.clear <= 0 && s.x >= 0 && s.x < W && s.y >= groundAt(s.x)) {
            impact(s, i, s.x, groundAt(s.x), false);
            dead = true; break;
          }
        }
        if (dead) continue;

        s.trail.push(s.x, s.y);
        if (s.trail.length > 76) s.trail.splice(0, 2);
      }

      // --- cosmetics ---
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.vy += 0.30;
        d.x += d.vx; d.y += d.vy; d.r += d.vr;
        d.t++;
        if (d.y > BF_BOT + 12 || d.t > d.life) debris.splice(i, 1);
        else if (d.y >= groundAt(d.x) && d.vy > 0) { d.vy *= -0.24; d.vx *= 0.55; d.y = groundAt(d.x); }
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        const s2 = smoke[i];
        s2.x += s2.vx; s2.y += s2.vy; s2.vy *= 0.985; s2.r *= 1.018; s2.t++;
        if (s2.t > s2.life) smoke.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t++;
        r.r = r.max * (1 - Math.pow(1 - r.t / r.life, 2.6));
        if (r.t > r.life) rings.splice(i, 1);
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t++;
        if (pops[i].t > pops[i].life) pops.splice(i, 1);
      }
      // wind streaks: the only readout of the wind that is not a number
      if (settings.wind > 0 && streaks.length < 26 && Math.random() < 0.22) {
        streaks.push({ x: wind > 0 ? -20 : W + 20, y: BF_TOP + 12 + Math.random() * BF_H * 0.42,
                       len: Math.random() * 16, t: 0, life: 90 + Math.random() * 60 });
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s3 = streaks[i];
        s3.x += wind * 170;
        s3.t++;
        if (s3.t > s3.life || s3.x < -40 || s3.x > W + 40) streaks.splice(i, 1);
      }

      if (shakeMag > 0.05) {
        shakeMag *= 0.86;
        shakeX = (Math.random() - 0.5) * shakeMag;
        shakeY = (Math.random() - 0.5) * shakeMag;
      } else { shakeMag = 0; shakeX = 0; shakeY = 0; }
      if (flash > 0) flash *= 0.82;
      if (settleT > 0) settleT--;
      if (bannerT > 0) bannerT--;

      // Watchdog. Whatever goes wrong in a weapon behaviour, the turn has to
      // come back: a couch game that freezes mid-shot is unrecoverable.
      if (phase === "flight" && ++flightAge > 900) {
        shots.length = 0;
        pending.length = 0;
        settleT = 0;
      }
    }

    /** Terminal contact for a flying shell — dispatch to whatever it does. */
    function impact(s, idx, x, y, onTank) {
      shots.splice(idx, 1);
      const w = s.w;
      // A sub-shell only ever explodes. Without this the Skyfall bomblets
      // each call in another airstrike and the flight never ends.
      if (s.sub) { detonate(x, y, w, s.owner); return; }
      if (w.hit === "roll" && !onTank) {
        shots.push({ x, y: groundAt(x) - 3, vx: Math.sign(s.vx) * 0.8, vy: 0, w, owner: s.owner,
                     mode: "roll", age: 0, trail: s.trail, rollT: 0, clear: 0 });
        return;
      }
      if (w.hit === "bounce" && !onTank && s.bounces < (w.bounces || 3)) {
        const l = groundAt(clamp(x - 5, 0, W - 1)), r = groundAt(clamp(x + 5, 0, W - 1));
        const nx = (l - r), ny = 10;                      // surface normal, unnormalised
        const nl = Math.hypot(nx, ny) || 1;
        const ux = nx / nl, uy = -ny / nl;
        const dot = s.vx * ux + s.vy * uy;
        s.vx = (s.vx - 2 * dot * ux) * 0.62;
        s.vy = (s.vy - 2 * dot * uy) * 0.62;
        s.x = x + s.vx * 0.4;
        s.y = groundAt(x) - 5;
        s.bounces++;
        s.clear = 5;
        shots.push(s);
        carve(x, y, 10);
        burstDebris(x, y, 5, 1.1);
        sound.sting("tap");
        return;
      }
      if (w.hit === "dig" && !onTank) {
        shots.push({ x, y, vx: 0, vy: 0, w, owner: s.owner, mode: "dig", age: 0, dug: 0, trail: s.trail });
        return;
      }
      if (w.hit === "strike") {
        detonate(x, y, w, s.owner, { dmg: 0, rad: 0, crater: 12 });
        for (let i = 0; i < (w.n || 7); i++) {
          const bx = x + (i - (w.n - 1) / 2) * (w.band / w.n) + (Math.random() - 0.5) * 8;
          shots.push({ x: bx, y: BF_TOP - 40 - i * 16, vx: 0, vy: 2.2 + Math.random() * 0.6,
                       w, owner: s.owner, mode: "fly", age: 0, apexDone: true, clear: 0,
                       trail: [], windK: 0.5, gravK: 1, sub: true });
        }
        sound.sting("danger");
        return;
      }
      if (w.hit === "chain") {
        const dir = Math.sign(s.vx) || 1;
        detonate(x, y, w, s.owner);
        for (let i = 1; i < (w.n || 4); i++) {
          const px = clamp(x + dir * w.step * i, 2, W - 3);
          pending.push({ x: px, y: groundAt(px) - 2, w, owner: s.owner, t: i * 8, opts: null });
        }
        return;
      }
      detonate(x, y, w, s.owner);
    }

    function splitShell(s) {
      const w = s.w;
      const base = Math.atan2(s.vy, s.vx);
      const sp = Math.hypot(s.vx, s.vy) * 0.92;
      for (let i = 0; i < w.n; i++) {
        const a = base + (i - (w.n - 1) / 2) * (w.spread * RAD);
        shots.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                     w, owner: s.owner, mode: "fly", age: 0, apexDone: true, clear: 0,
                     trail: [], windK: 1, gravK: 1, sub: true });
      }
      rings.push({ x: s.x, y: s.y, r: 2, max: 26, t: 0, life: 14 });
      sound.sting("coin");
    }

    function hailFrom(s) {
      const w = s.w;
      for (let i = 0; i < w.n; i++) {
        // Droplets keep the parent's forward speed, spread about it. Dropping
        // them straight down would rain on the middle of the map, which is
        // where an apex always is and never where anybody is standing.
        const k = (i - (w.n - 1) / 2) / w.n;
        const dx = k * 14;
        shots.push({ x: s.x + dx, y: s.y - Math.random() * 10,
                     vx: s.vx * (1 + k * w.band * 2), vy: 0.4 + Math.random() * 0.5,
                     w, owner: s.owner, mode: "fly", age: 0, apexDone: true, clear: 0,
                     trail: [], windK: 0.7, gravK: 0.85, sub: true });
      }
      rings.push({ x: s.x, y: s.y, r: 2, max: 30, t: 0, life: 16 });
      sound.sting("coin");
    }

    /** The Roller: follows the slope downhill and blows where it settles. */
    function stepRoller(s, idx) {
      s.rollT++;
      const gL = groundAt(s.x - 3), gR = groundAt(s.x + 3);
      const slope = (gR - gL) / 6;
      s.vx += -slope * 0.55;
      s.vx *= 0.985;
      if (Math.abs(s.vx) > 4.2) s.vx = Math.sign(s.vx) * 4.2;
      s.x += s.vx;
      s.y = groundAt(s.x) - 3;
      s.trail.push(s.x, s.y);
      if (s.trail.length > 40) s.trail.splice(0, 2);
      let struck = null;
      for (const p of players) if (Math.abs(p.x - s.x) < 14) struck = p;
      if (struck || Math.abs(s.vx) < 0.16 || s.rollT > 260 || s.x < 3 || s.x > W - 4) {
        shots.splice(idx, 1);
        detonate(clamp(s.x, 2, W - 3), s.y, s.w, s.owner);
      }
    }

    /** The Auger: a shaft, one column run at a time, then a blast at the bottom. */
    function stepDigger(s, idx) {
      const speed = 3.4;
      s.y += speed;
      s.dug += speed;
      const bore = s.w.bore || 11;
      const x0 = Math.max(0, Math.round(s.x - bore)), x1 = Math.min(W - 1, Math.round(s.x + bore));
      for (let x = x0; x <= x1; x++) {
        const t = 1 - Math.abs(x - s.x) / (bore + 1);
        const yy = s.y - (1 - t) * 6;
        if (surfT[x] < yy) surfT[x] = Math.min(BF_BOT, yy);
        if (surf[x] < yy) surf[x] = Math.min(BF_BOT, yy);
      }
      terrainDirty = true;
      if (s.dug % 8 < speed) burstDebris(s.x, s.y - 6, 3, 1.1);
      if (s.dug >= (s.w.depth || 116) || s.y >= BF_BOT - 4) {
        shots.splice(idx, 1);
        detonate(s.x, Math.min(s.y, BF_BOT - 4), s.w, s.owner);
      }
    }

    /* =================================================================
     * TURN FLOW
     * ================================================================= */
    function flightSettled() {
      return shots.length === 0 && pending.length === 0 && settleT <= 0;
    }

    function endTurn() {
      if (shotDamage > bestShot) bestShot = shotDamage;
      try { ctx.platform.setScore(bestShot); } catch (_) {}
      if (shotDamage > 0) {
        popNumber(W / 2, BF_TOP + BF_H * 0.36, shotDamage + " DAMAGE", players[turn].ink);
        sound.sting("success");
      }
      const dead = players.filter((p) => p.hp <= 0);
      if (dead.length) {
        // The firing player takes it even in a double knockout: they landed
        // the shot that ended the match.
        const foe = players[1 - turn];
        finish(foe.hp <= 0 ? turn : 1 - turn, foe.hp <= 0 ? "KNOCKED OUT" : "SELF DESTRUCT");
        return;
      }
      if (ammoLeft(players[0]) === 0 && ammoLeft(players[1]) === 0) {
        if (players[0].hp !== players[1].hp) {
          finish(players[0].hp > players[1].hp ? 0 : 1, "OUT OF SHELLS");
          return;
        }
        // Dead level and dry: one Lobber each until it breaks. Three rounds
        // of that and neither of them can shoot, so call it what it is.
        if (++suddenRounds > 3) { finish(-1, "DEAD HEAT"); return; }
        for (const p of players) p.hand.push({ id: "lob", used: false });
        lastReason = "SUDDEN DEATH";
      }
      turn = 1 - turn;
      if (turn === 0) volley++;
      newWind();
      selectFirstUnused(players[turn]);
      phase = "aim";
      bannerT = 66; bannerFor = turn;
      paintChrome();
    }

    async function finish(who, reason) {
      phase = "over";
      winner = who;
      lastReason = reason;
      sound.duck(0.6, 500);
      sound.sting(who < 0 ? "fail" : "win");
      sound.haptic("heavy");
      flash = 1;
      shakeMag = who < 0 ? 0 : 14;
      const title = who < 0 ? "DEAD HEAT" : players[who].name + " WINS";
      const ink = who < 0 ? "#E8EEFB" : players[who].ink;
      shell.el("over-name").textContent = title;
      shell.el("over-name").style.color = ink;
      shell.el("over-mini").textContent = title;
      shell.el("over-mini").style.color = ink;
      shell.el("over-mini-sub").textContent =
        "AZURE " + players[0].hp + "  ·  EMBER " + players[1].hp +
        "  ·  BIGGEST SHOT " + bestShot;
      shell.el("over-line").textContent = reason.toLowerCase();
      shell.el("over-hp0").textContent = players[0].hp;
      shell.el("over-hp1").textContent = players[1].hp;
      shell.el("over-stat").textContent = bestShot;
      shell.el("over-sub").textContent = shotsFired + " shells fired over " + volley + " volleys";
      shell.el("over").style.display = "flex";
      try {
        ctx.platform.complete({ winner: who < 0 ? "draw" : players[who].name, bestShot, shots: shotsFired });
      } catch (_) {}
      // The record is a property of the match, not of either of the two people
      // holding the phone: the single biggest shell either of them landed.
      try {
        if (bestShot > 0) await ctx.memory.record("best_shot").submit(bestShot, { label: bestShot + " damage" });
      } catch (_) { /* offline is fine; the match still finished */ }
    }

    /* =================================================================
     * DRAWING — battlefield
     * ================================================================= */
    let skyGrad = null, skyArt = null;
    /**
     * The sky gradient ends at the horizon, not at the bottom of the window.
     * Spread over the whole battlefield the rose glow would sit under three
     * hundred pixels of dirt and never be seen; anchored to the average
     * terrain height it burns exactly where the silhouette cuts it.
     */
    function makeSky() {
      let avg = BF_TOP + BF_H * 0.45;
      const src = backRidge || surf;
      if (src) {
        let a = 0;
        for (let x = 0; x < W; x++) a += src[x];
        avg = a / W;
      }
      if (!isFinite(avg)) avg = BF_TOP + BF_H * 0.45;
      const end = clamp(avg + 14, BF_TOP + 60, BF_BOT);
      skyGrad = g.createLinearGradient(0, BF_TOP - 6, 0, end);
      for (const [t, c] of SKY) skyGrad.addColorStop(t, c);
      // Interpolating that gradient across the window every frame is a
      // per-pixel cost; blitting the same pixels is not.
      skyArt = surface(W, BF_H + 16);
      if (skyArt) {
        const sg = skyArt.getContext("2d");
        sg.setTransform(1, 0, 0, 1, 0, -(BF_TOP - 8));
        sg.fillStyle = skyGrad;
        sg.fillRect(0, BF_TOP - 8, W, BF_H + 16);
      }
    }

    function drawSky(gg, t) {
      if (skyArt) gg.drawImage(skyArt, 0, BF_TOP - 8);
      else { gg.fillStyle = skyGrad; gg.fillRect(-8, BF_TOP - 8, W + 16, BF_H + 16); }
      // Stars, hashed so they never crawl, twinkling on alpha only.
      for (let i = 0; i < 54; i++) {
        const hx = hash(i * 3 + 1), hy = hash(i * 7 + 5), hp = hash(i * 11 + 3);
        const x = hx * W;
        const y = BF_TOP + hy * BF_H * 0.62;
        const a = 0.28 + 0.42 * (0.5 + 0.5 * Math.sin(t * 0.0013 * (0.5 + hp) + hp * 9));
        gg.fillStyle = "rgba(255,238,220," + a.toFixed(3) + ")";
        const s = hp > 0.9 ? 2 : 1;
        gg.fillRect(x | 0, y | 0, s, s);
      }
      // Wind streaks: motion is the readout.
      gg.strokeStyle = "rgba(255,205,190,0.30)";
      gg.lineWidth = 1;
      for (const s of streaks) {
        const a = Math.sin((s.t / s.life) * Math.PI);
        gg.globalAlpha = a * 0.42;
        gg.beginPath();
        gg.moveTo(s.x, s.y);
        gg.lineTo(s.x - Math.sign(wind) * (9 + s.len), s.y);
        gg.stroke();
      }
      gg.globalAlpha = 1;
    }

    let terrainArt = null, terrainArtOK = true;
    const TPAD = 8;

    /**
     * The landscape only changes when something blows up, so it is baked once
     * and blitted. Five full-width band fills plus two clipped texture passes
     * on every frame is by a wide margin the most expensive thing in the bit,
     * and on a software rasteriser it costs the frame rate outright.
     */
    function drawTerrain(gg) {
      if (!terrainArtOK) { paintTerrain(gg); return; }
      const th = Math.ceil(BF_H + TPAD * 2);
      if (!terrainArt || terrainArt.width !== Math.ceil(W) || terrainArt.height !== th) {
        terrainArt = surface(W, th);
        if (!terrainArt) { terrainArtOK = false; paintTerrain(gg); return; }
        terrainDirty = true;
      }
      if (terrainDirty || !bandPaths) {
        buildBands();
        const tg = terrainArt.getContext("2d");
        tg.setTransform(1, 0, 0, 1, 0, -(BF_TOP - TPAD));
        tg.clearRect(0, BF_TOP - TPAD, W, th);
        paintTerrain(tg);
      }
      gg.drawImage(terrainArt, 0, BF_TOP - TPAD);
    }

    /** Paint the landscape in world coordinates, into whatever context. */
    function paintTerrain(gg) {
      // Also the live path on a WebView with no OffscreenCanvas, where nothing
      // else ever clears the dirty flag.
      if (terrainDirty || !bandPaths) buildBands();
      if (backRidge) {
        gg.beginPath();
        gg.moveTo(-2, BF_BOT + 4);
        gg.lineTo(-2, backRidge[0]);
        for (let x = 0; x < W; x += 4) gg.lineTo(x, backRidge[x]);
        gg.lineTo(W + 2, backRidge[W - 1]);
        gg.lineTo(W + 2, BF_BOT + 4);
        gg.closePath();
        const bg = gg.createLinearGradient(0, backRidge[0] - 30, 0, BF_BOT);
        bg.addColorStop(0, "#4A1152");
        bg.addColorStop(0.5, "#2C0E3E");
        bg.addColorStop(1, "#190826");
        gg.fillStyle = bg;
        gg.fill();
        gg.strokeStyle = "rgba(255,150,180,0.22)";
        gg.lineWidth = 1.4;
        gg.beginPath();
        gg.moveTo(-2, backRidge[0]);
        for (let x = 0; x < W; x += 4) gg.lineTo(x, backRidge[x]);
        gg.lineTo(W + 2, backRidge[W - 1]);
        gg.stroke();
      }
      // A dark line laid down first, half of which the bands cover: what is
      // left is a hard outline above the hot rim, which is what makes the
      // silhouette read at phone size.
      gg.lineJoin = "round";
      gg.strokeStyle = OUTLINE;
      gg.lineWidth = 5;
      gg.stroke(silh);
      for (let i = 0; i < BANDS.length; i++) {
        gg.fillStyle = BANDS[i].c;
        gg.fill(bandPaths[i]);
      }
      // Per-column jitter on the top two bands, so the contour edge is not a
      // machined curve, plus vertical brush streaks through the deep body.
      gg.save();
      gg.clip(bandPaths[1]);
      for (let x = 0; x < W; x += 5) {
        const j = hash(x * 977 + 13);
        gg.globalAlpha = 0.14 + j * 0.2;
        gg.fillStyle = j > 0.5 ? "#FFCB5A" : "#C9761C";
        gg.fillRect(x, surf[x] + 2, 5, 8 + j * 12);
      }
      gg.globalAlpha = 1;
      gg.restore();
      gg.save();
      gg.clip(bandPaths[0]);
      gg.strokeStyle = "rgba(0,0,0,0.075)";
      gg.lineWidth = 2.4;
      for (let i = 0; i < 30; i++) {
        const x = hash(i * 131 + 7) * W;
        const y0 = surf[clamp(x | 0, 0, W - 1)] + 12 + hash(i * 53) * 40;
        gg.beginPath();
        gg.moveTo(x, y0);
        gg.lineTo(x + (hash(i * 17) - 0.5) * 8, y0 + 40 + hash(i * 91) * 90);
        gg.stroke();
      }
      gg.restore();
    }

    function drawTank(gg, p, t) {
      const ink = p.ink;
      gg.save();
      gg.translate(p.x, p.y);
      gg.rotate(p.tilt);
      if (p.hurt > 0) {
        gg.globalAlpha = p.hurt % 4 < 2 ? 0.55 : 1;
      }
      // Treads
      gg.fillStyle = "#171A22";
      rr(gg, -15, -6, 30, 7, 3);
      gg.fill();
      gg.fillStyle = p.dim;
      for (let i = 0; i < 6; i++) { gg.beginPath(); gg.arc(-11.5 + i * 4.6, -2.5, 1.7, 0, TAU); gg.fill(); }
      // Hull, outlined hard
      const grad = gg.createLinearGradient(0, -12, 0, -4);
      grad.addColorStop(0, ink);
      grad.addColorStop(1, p.dim);
      gg.beginPath();
      gg.moveTo(-13, -6); gg.lineTo(13, -6); gg.lineTo(9, -13); gg.lineTo(-9, -13);
      gg.closePath();
      gg.fillStyle = grad;
      gg.fill();
      gg.strokeStyle = OUTLINE;
      gg.lineWidth = 2;
      gg.stroke();
      // Turret
      gg.beginPath();
      gg.arc(0, -13, 5.6, Math.PI, TAU);
      gg.closePath();
      gg.fillStyle = ink;
      gg.fill();
      gg.strokeStyle = OUTLINE;
      gg.lineWidth = 1.6;
      gg.stroke();
      gg.restore();

      // Barrel: drawn in world space, not hull space, because the number on
      // the deck is a world angle and these two must never disagree.
      const wa = (p.facing > 0 ? p.ang : 180 - p.ang) * RAD;
      const bx = p.x, by = p.y - 15;
      const rec = p.recoil > 0 ? -p.recoil * 0.35 : 0;
      const ex = bx + Math.cos(wa) * (19 + rec), ey = by - Math.sin(wa) * (19 + rec);
      gg.lineCap = "round";
      gg.strokeStyle = OUTLINE;
      gg.lineWidth = 5.5;
      gg.beginPath(); gg.moveTo(bx, by); gg.lineTo(ex, ey); gg.stroke();
      gg.strokeStyle = "#D3DCEA";
      gg.lineWidth = 2.6;
      gg.beginPath(); gg.moveTo(bx, by); gg.lineTo(ex, ey); gg.stroke();

      // Active tank wears a pulsing halo so you always know whose shot it is.
      if (phase !== "title" && p.i === turn && phase !== "over") {
        const a = 0.28 + 0.2 * Math.sin(t * 0.006);
        gg.strokeStyle = p.glow + a.toFixed(3) + ")";
        gg.lineWidth = 2;
        gg.beginPath();
        gg.arc(p.x, p.y - 9, 22 + Math.sin(t * 0.006) * 2, 0, TAU);
        gg.stroke();
      }
      // Armour pip above the hull — readable from both seats, no text.
      const bw = 30, frac = p.hp / p.maxHp;
      gg.fillStyle = "rgba(0,0,0,0.62)";
      rr(gg, p.x - bw / 2 - 1, p.y - 33, bw + 2, 6, 3); gg.fill();
      gg.fillStyle = frac > 0.5 ? p.ink : frac > 0.22 ? "#FFB03B" : "#FF4A4A";
      if (frac > 0) { rr(gg, p.x - bw / 2, p.y - 32, Math.max(2, bw * frac), 4, 2); gg.fill(); }
    }

    function drawShots(gg) {
      for (const s of shots) {
        // Trail: a polyline fading tail-ward. No blur filter anywhere.
        if (s.trail && s.trail.length >= 4) {
          const n = s.trail.length / 2;
          gg.lineCap = "round";
          for (let i = 1; i < n; i++) {
            const k = i / n;
            gg.strokeStyle = "rgba(255,232,190," + (k * k * 0.72).toFixed(3) + ")";
            gg.lineWidth = 1 + k * 1.8;
            gg.beginPath();
            gg.moveTo(s.trail[(i - 1) * 2], s.trail[(i - 1) * 2 + 1]);
            gg.lineTo(s.trail[i * 2], s.trail[i * 2 + 1]);
            gg.stroke();
          }
        }
        if (s.mode === "dig") continue;
        const r = s.sub ? 2.2 : 3.2;
        gg.fillStyle = OUTLINE;
        gg.beginPath(); gg.arc(s.x, s.y, r + 1.4, 0, TAU); gg.fill();
        gg.fillStyle = s.w.ink;
        gg.beginPath(); gg.arc(s.x, s.y, r, 0, TAU); gg.fill();
        gg.fillStyle = "#FFFFFF";
        gg.beginPath(); gg.arc(s.x - r * 0.3, s.y - r * 0.3, r * 0.42, 0, TAU); gg.fill();
      }
    }

    function drawFx(gg) {
      for (const s of smoke) {
        const k = s.t / s.life;
        gg.fillStyle = "rgba(58,30,30," + ((1 - k) * 0.52).toFixed(3) + ")";
        gg.beginPath(); gg.arc(s.x, s.y, s.r * (0.5 + k), 0, TAU); gg.fill();
      }
      for (const d of debris) {
        const k = d.t / d.life;
        gg.save();
        gg.translate(d.x, d.y);
        gg.rotate(d.r);
        gg.globalAlpha = clamp(1.5 - k * 1.5, 0, 1);
        gg.fillStyle = d.c;
        gg.fillRect(-d.s / 2, -d.s / 2, d.s, d.s);
        gg.restore();
      }
      gg.globalAlpha = 1;
      for (const r of rings) {
        const k = r.t / r.life;
        if (r.shock) {
          gg.strokeStyle = "rgba(255,244,214," + ((1 - k) * (1 - k) * 0.6).toFixed(3) + ")";
          gg.lineWidth = Math.max(0.8, 3.4 * (1 - k));
          gg.beginPath(); gg.arc(r.x, r.y, Math.max(1, r.r), 0, TAU); gg.stroke();
          continue;
        }
        const cols = ["#FFF6D0", "#FFD873", "#FF8A25", "#D42409"];
        const ci = Math.min(3, Math.floor(k * 4));
        const lw = lerp(11, 1.6, k);
        // Three stacked strokes fake the glow a blur filter is not allowed to.
        for (let j = 3; j >= 1; j--) {
          gg.strokeStyle = cols[ci];
          gg.globalAlpha = (1 - k * 0.75) * (j === 1 ? 1 : j === 2 ? 0.34 : 0.15);
          gg.lineWidth = lw * (j === 1 ? 1 : j === 2 ? 2.4 : 4.4);
          gg.beginPath();
          gg.arc(r.x, r.y, Math.max(1, r.r), 0, TAU);
          gg.stroke();
        }
        gg.globalAlpha = 1;
        if (k < 0.5) {
          const a = (0.5 - k) * 2;
          gg.fillStyle = "rgba(255,248,220," + (a * a).toFixed(3) + ")";
          gg.beginPath(); gg.arc(r.x, r.y, r.r * 0.82, 0, TAU); gg.fill();
          gg.fillStyle = "rgba(255,190,90," + (a * 0.55).toFixed(3) + ")";
          gg.beginPath(); gg.arc(r.x, r.y, r.r * 1.05, 0, TAU); gg.fill();
        }
      }
      for (const p of pops) {
        const k = p.t / p.life;
        const s = p.text.length > 4 ? 3 : 4;
        gg.globalAlpha = clamp(1.6 - k * 1.8, 0, 1);
        gg.save();
        // Rotate about the middle of the glyph run so a flipped number lands
        // in exactly the rectangle an unflipped one would.
        const half = blockW(String(p.text), s) / 2;
        gg.translate(clamp(p.x, Math.min(half + 4, W / 2), Math.max(W - half - 4, W / 2)),
                     p.y - k * 30 + 3.5 * s);
        if (p.flip) gg.rotate(Math.PI);
        // Hard dark outline rather than a drop shadow: these numbers land on
        // top of the fireball that caused them, and Ember's orange ink over an
        // orange blast is the one pairing this palette cannot survive.
        blockText(gg, p.text, 0, -3.5 * s, s,
          { align: "center", colour: p.ink, outline: "rgba(0,0,0,0.92)" });
        gg.restore();
        gg.globalAlpha = 1;
      }
    }

    /** Shells above the sky get a marker pinned to the top of the window. */
    function drawOffscreen(gg) {
      for (const s of shots) {
        if (s.y >= BF_TOP - 2) continue;
        const x = clamp(s.x, 10, W - 10);
        gg.fillStyle = s.w.ink;
        gg.beginPath();
        gg.moveTo(x, BF_TOP + 3);
        gg.lineTo(x - 6, BF_TOP + 13);
        gg.lineTo(x + 6, BF_TOP + 13);
        gg.closePath();
        gg.fill();
      }
    }

    function drawBattlefield(gg, t) {
      gg.save();
      gg.beginPath();
      gg.rect(0, BF_TOP, W, BF_H);
      gg.clip();
      gg.save();
      gg.translate(shakeX, shakeY);
      drawSky(gg, t);
      drawTerrain(gg);
      for (const p of players || []) drawTank(gg, p, t);
      drawShots(gg);
      drawFx(gg);
      gg.restore();
      drawOffscreen(gg);
      if (flash > 0.02) {
        gg.fillStyle = "rgba(255,236,190," + (flash * 0.4).toFixed(3) + ")";
        gg.fillRect(0, BF_TOP, W, BF_H);
      }
      // Volley counter. Centred so it belongs to neither seat, and turned to
      // face whoever is acting — same rule as the banner and the damage
      // numbers, so no text in this window is ever upside down for the player
      // it is currently talking to.
      if (phase !== "title") {
        gg.globalAlpha = 0.5;
        gg.save();
        gg.translate(W / 2, BF_TOP + 9 + 7);
        if (turn === 1) gg.rotate(Math.PI);
        blockText(gg, "VOLLEY " + volley, 0, -7, 2, { align: "center", colour: "#F0C9B4" });
        gg.restore();
        gg.globalAlpha = 1;
      }
      gg.restore();

      // Heavy machined frame around the window.
      gg.strokeStyle = "#000000";
      gg.lineWidth = 6;
      gg.strokeRect(-3, BF_TOP - 3, W + 6, BF_H + 6);
      gg.strokeStyle = "#2B3040";
      gg.lineWidth = 2;
      gg.beginPath();
      gg.moveTo(0, BF_TOP + 1); gg.lineTo(W, BF_TOP + 1);
      gg.moveTo(0, BF_BOT - 1); gg.lineTo(W, BF_BOT - 1);
      gg.stroke();
      gg.fillStyle = "#394054";
      for (let x = 14; x < W - 6; x += 46) {
        gg.beginPath(); gg.arc(x, BF_TOP + 5, 1.6, 0, TAU); gg.fill();
        gg.beginPath(); gg.arc(x, BF_BOT - 5, 1.6, 0, TAU); gg.fill();
      }
    }

    /* =================================================================
     * DRAWING — the control decks
     * ================================================================= */
    /* -----------------------------------------------------------------
     * The decks are baked.
     *
     * Slab, grain, every plate frame, the protractor and every fixed label
     * are identical on every frame of a match, and re-cutting them live cost
     * more than everything else in the bit put together on a software
     * rasteriser. They go to an OffscreenCanvas once per layout and blit;
     * only the readouts, the needle and the press states are drawn live.
     * Everything is baked in the lit state, because the deck that is not
     * playing is dimmed by a single scrim laid over the top.
     * ----------------------------------------------------------------- */
    const deckArt = [null, null];
    let deckArtOK = true, deckArtKey = "";

    function paintDeckStatic(gg, who) {
      const p = players[who];

      const slab = gg.createLinearGradient(0, 0, 0, DECK_H);
      slab.addColorStop(0, who === 0 ? DECK_SLAB_A : DECK_SLAB_B);
      slab.addColorStop(1, who === 0 ? DECK_SLAB_B : DECK_SLAB_A);
      gg.fillStyle = slab;
      gg.fillRect(0, 0, W, DECK_H);
      // Brushed grain. A flat fill reads as a bug rather than a panel.
      gg.strokeStyle = "rgba(120,140,180,0.10)";
      gg.lineWidth = 1;
      for (let x = 0; x < W; x += 3) {
        gg.globalAlpha = 0.03 + hash(x * 31) * 0.05;
        gg.beginPath(); gg.moveTo(x + 0.5, 0); gg.lineTo(x + 0.5, DECK_H); gg.stroke();
      }
      gg.globalAlpha = 1;
      // Hairline where the deck meets the battlefield frame.
      gg.fillStyle = "rgba(150,175,220,0.16)";
      gg.fillRect(0, who === 0 ? 0 : DECK_H - 1, W, 1);

      // rail: name chip, armour recess
      const R = DL.rail;
      const nameW = Math.round(blockW(p.name, 3) + 16);
      plate(gg, R.x, R.y, nameW, R.h, 8, { fill: p.dim });
      blockText(gg, p.name, R.x + nameW / 2, R.y + (R.h - 21) / 2, 3,
        { align: "center", colour: "#FFFFFF", shadow: [1.5, 1.5] });
      inset(gg, R.x + nameW + 8, R.y, R.w - nameW - 8 - 58 - 6, R.h, 7);

      // dome plate and protractor
      const D = DL.dome;
      plate(gg, D.x, D.y, D.w, D.h, 10);
      const ox = DL.domeOx, oy = DL.domeOy, RR = DL.domeR;
      gg.save();
      gg.beginPath();
      gg.moveTo(D.x + 4, oy);
      gg.arc(ox, oy, RR + 4, Math.PI, TAU);
      gg.closePath();
      gg.clip();
      gg.fillStyle = "#04050A";
      gg.fillRect(D.x, D.y, D.w, D.h);
      gg.strokeStyle = "rgba(140,160,200,0.13)";
      gg.lineWidth = 1;
      for (let i = 1; i <= 4; i++) { gg.beginPath(); gg.arc(ox, oy, RR * i / 4, Math.PI, TAU); gg.stroke(); }
      for (let a = 0; a <= 180; a += 15) {
        const big = a % 45 === 0;
        gg.strokeStyle = big ? "rgba(160,180,220,0.32)" : "rgba(140,160,200,0.13)";
        gg.lineWidth = big ? 1.4 : 1;
        gg.beginPath();
        gg.moveTo(ox + Math.cos(a * RAD) * RR * (big ? 0.78 : 0.90), oy - Math.sin(a * RAD) * RR * (big ? 0.78 : 0.90));
        gg.lineTo(ox + Math.cos(a * RAD) * RR, oy - Math.sin(a * RAD) * RR);
        gg.stroke();
      }
      gg.restore();
      gg.fillStyle = "rgba(180,200,240,0.42)";
      gg.font = "700 9px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
      gg.textAlign = "center";
      gg.textBaseline = "alphabetic";
      gg.fillText("0", ox + RR - 4, oy - 5);
      gg.fillText("90", ox, oy - RR + 11);
      gg.fillText("180", ox - RR + 8, oy - 5);
      gg.textAlign = "left";
      gg.fillStyle = LABEL;
      gg.fillText("WIND", D.x + 9, D.y + 15);

      // steppers and readouts
      drawStepper(gg, DL.angM, "-", true);
      drawStepper(gg, DL.angP, "+", true);
      drawStepper(gg, DL.powM, "-", true);
      drawStepper(gg, DL.powP, "+", true);
      for (const [r, label] of [[DL.angV, "ANGLE"], [DL.powV, "POWER"]]) {
        plate(gg, r.x, r.y, r.w, r.h, 10);
        inset(gg, r.x + 5, r.y + 5, r.w - 10, r.h - 10, 7);
        gg.fillStyle = LABEL;
        gg.font = "700 9px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
        gg.textAlign = "center";
        gg.fillText(label, r.x + r.w / 2, r.y + 17);
      }

      // weapon plate shell and icon recess
      const Wp = DL.weapon;
      plate(gg, Wp.x, Wp.y, Wp.w, Wp.h, 10);
      const tile = Math.round(Wp.h - 14);
      inset(gg, Wp.x + 7, Wp.y + 7, tile, tile, 7, "#0A0C13");

      // fire button, in this player's own colour
      const F = DL.fire;
      plate(gg, F.x, F.y, F.w, F.h, 12, { fill: p.ink, hi: "rgba(255,255,255,0.55)" });
      blockText(gg, "FIRE", F.x + F.w / 2, F.y + (F.h - 28) / 2, 4,
        { align: "center", colour: "#07131A", shadow: [2, 2], shadowColour: "rgba(255,255,255,0.28)" });
    }

    function bakeDecks() {
      const key = W + "x" + DECK_H + ":" + settings.armour;
      if (deckArtKey === key && deckArt[0]) return;
      deckArtKey = key;
      for (let who = 0; who < 2; who++) {
        const s = surface(W, DECK_H);
        if (!s) { deckArtOK = false; return; }
        const dg = s.getContext("2d");
        dg.setTransform(1, 0, 0, 1, 0, 0);
        dg.clearRect(0, 0, W, DECK_H);
        paintDeckStatic(dg, who);
        deckArt[who] = s;
      }
    }

    let pressed = null;          // {name} for the 90ms press animation

    function isPressed(n) { return pressed && pressed.name === n; }

    /**
     * A deck changes only when a readout changes, and the canvas is never
     * cleared outside the battlefield window, so a deck whose signature is
     * unchanged can simply be left standing from the previous frame. On a
     * phone that is two big blits and a dozen text paths saved on most frames.
     */
    const deckSig = ["", ""];
    function deckSignature(who) {
      const p = players[who];
      // The layout has to be part of this, not the baked key: the bake only
      // runs after the signature test, so keying on it would let a resize
      // leave both decks frozen at their old size forever.
      return who + "|" + W + "x" + DECK_H + "|" + phase + "|" + turn + "|" + p.hp +
        "|" + p.ang + "|" + p.pow + "|" + p.sel + "|" + ammoLeft(p) + "|" +
        wind.toFixed(4) + "|" + (pressed ? pressed.name : "") + "|" + arsenalOpen;
    }

    function drawDeck(gg, who, t) {
      const sig = deckSignature(who);
      if (sig === deckSig[who]) return;
      deckSig[who] = sig;
      const p = players[who];
      const active = phase !== "title" && phase !== "over" && who === turn;
      pushDeck(gg, who);

      if (phase === "title") {
        // The title screen scrims the decks; drawing their contents underneath
        // just shows through as mirrored ghost text.
        const slab = gg.createLinearGradient(0, 0, 0, DECK_H);
        slab.addColorStop(0, "#0B0C14");
        slab.addColorStop(1, "#050509");
        gg.fillStyle = slab;
        gg.fillRect(0, 0, W, DECK_H);
        gg.restore();
        return;
      }

      if (deckArtOK) bakeDecks();
      if (deckArtOK && deckArt[who]) gg.drawImage(deckArt[who], 0, 0);
      else paintDeckStatic(gg, who);

      // --- press states, drawn under the live content ---
      const pressKey = (n) => isPressed(who + ":" + n);
      for (const [n, sign] of [["angM", "-"], ["angP", "+"], ["powM", "-"], ["powP", "+"]]) {
        if (pressKey(n)) drawStepper(gg, DL[n], sign, true, true);
      }
      if (pressKey("weapon")) {
        plate(gg, DL.weapon.x, DL.weapon.y, DL.weapon.w, DL.weapon.h, 10, { pressed: true });
        inset(gg, DL.weapon.x + 7, DL.weapon.y + 7, DL.weapon.h - 14, DL.weapon.h - 14, 7, "#0A0C13");
      }
      if (pressKey("fire")) {
        plate(gg, DL.fire.x, DL.fire.y, DL.fire.w, DL.fire.h, 12,
          { pressed: true, fill: p.ink, hi: "rgba(255,255,255,0.55)" });
        blockText(gg, "FIRE", DL.fire.x + DL.fire.w / 2, DL.fire.y + (DL.fire.h - 28) / 2, 4,
          { align: "center", colour: "#07131A" });
      }

      // --- armour ---
      const R = DL.rail;
      const nameW = Math.round(blockW(p.name, 3) + 16);
      const hbX = R.x + nameW + 8, hbW = R.w - nameW - 8 - 58 - 6;
      const segs = 20, pad = 4;
      const segW = (hbW - pad * 2 - (segs - 1) * 2) / segs;
      const frac = p.hp / p.maxHp;
      const filled = Math.ceil(frac * segs);
      gg.fillStyle = frac > 0.5 ? p.ink : frac > 0.22 ? "#FFB03B" : "#FF4A4A";
      for (let i = 0; i < filled; i++) gg.fillRect(hbX + pad + i * (segW + 2), R.y + 6, segW, R.h - 12);
      gg.fillStyle = "rgba(120,140,180,0.09)";
      for (let i = filled; i < segs; i++) gg.fillRect(hbX + pad + i * (segW + 2), R.y + 6, segW, R.h - 12);
      blockText(gg, String(p.hp), R.x + R.w, R.y + (R.h - 21) / 2, 3,
        { align: "right", colour: VALUE, shadow: [1.5, 1.5] });

      // --- readouts ---
      // Three digits (power 100, angle 100+) are wider than the value plate on
      // a narrow phone, so the glyph size is fitted to the plate rather than
      // fixed at 4, and the run is anchored to the bottom of the plate so it
      // keeps sitting under the baked label whatever size it comes out.
      // …and the plate itself shrinks with the deck on a short phone, where a
      // fixed 28px glyph run climbs into the baked label above it.
      const fitV = (txt, r) =>
        Math.min(4, (r.w - 10) / (String(txt).length * 6 - 1), (r.h - 22) / 7);
      const drawV = (val, r) => {
        const txt = String(Math.round(val));
        const s = fitV(txt, r);
        blockText(gg, txt, r.x + r.w / 2, r.y + r.h - 7 * s - 2, s, { align: "center", colour: VALUE });
      };
      drawV(p.ang, DL.angV);
      drawV(p.pow, DL.powV);

      // --- weapon ---
      const Wp = DL.weapon, w = selWeapon(p);
      const tile = Math.round(Wp.h - 14);
      drawIcon(gg, w.icon, Wp.x + 7 + tile * 0.14, Wp.y + 7 + tile * 0.14, tile * 0.72, w.ink);
      gg.fillStyle = VALUE;
      gg.font = "700 13px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
      gg.textAlign = "left";
      gg.textBaseline = "alphabetic";
      let nm = w.name;
      while (gg.measureText(nm).width > Wp.w - tile - 22 && nm.length > 4) nm = nm.slice(0, -1);
      gg.fillText(nm, Wp.x + tile + 15, Wp.y + Wp.h * 0.46);
      gg.fillStyle = LABEL;
      gg.font = "600 10px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
      gg.fillText(ammoLeft(p) + " SHELLS LEFT", Wp.x + tile + 15, Wp.y + Wp.h * 0.78);

      // --- dome: needle, pivot, wind ---
      drawDomeLive(gg, p, active);

      // --- fire glow, only while it can actually be pressed ---
      if (active && phase === "aim") {
        const F = DL.fire;
        glowStroke(gg, (gc) => { rr(gc, F.x, F.y, F.w, F.h, 12); }, p.glow, 3, 0.9);
      } else {
        gg.fillStyle = "rgba(5,6,11,0.45)";
        rr(gg, DL.fire.x, DL.fire.y, DL.fire.w, DL.fire.h, 12);
        gg.fill();
      }

      // One scrim, drawn last, so nothing inside has to know whose turn it is.
      if (!active) {
        gg.fillStyle = "rgba(4,5,11,0.64)";
        gg.fillRect(0, 0, W, DECK_H);
      }
      gg.restore();
    }

    function drawStepper(gg, r, sign, active, isDown) {
      plate(gg, r.x, r.y, r.w, r.h, 10, { pressed: !!isDown });
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      gg.strokeStyle = active ? "#C9D3E6" : "#4E5568";
      gg.lineWidth = 4;
      gg.lineCap = "round";
      gg.beginPath();
      gg.moveTo(cx - 10, cy); gg.lineTo(cx + 10, cy);
      if (sign === "+") { gg.moveTo(cx, cy - 10); gg.lineTo(cx, cy + 10); }
      gg.stroke();
    }

    /**
     * The live half of the aim dome.
     *
     * Local "right" is always toward the opponent, because Ember's deck is
     * rotated a half turn and their opponent is off the other side of the
     * screen. So one dome, one mapping, two seats — and the wind arrows can
     * be shown in each player's own frame rather than the world's.
     */
    function drawDomeLive(gg, p, active) {
      const D = DL.dome;
      const ox = DL.domeOx, oy = DL.domeOy, R = DL.domeR;

      const a = p.ang * RAD;
      const nr = R * (p.pow / 100);
      const nx = ox + Math.cos(a) * nr, ny = oy - Math.sin(a) * nr;
      if (active) {
        glowStroke(gg, (gc) => { gc.beginPath(); gc.moveTo(ox, oy); gc.lineTo(nx, ny); }, p.glow, 2, 1);
      }
      gg.strokeStyle = active ? p.ink : "#59607A";
      gg.lineWidth = 3;
      gg.lineCap = "round";
      gg.beginPath(); gg.moveTo(ox, oy); gg.lineTo(nx, ny); gg.stroke();
      gg.fillStyle = active ? "#FFFFFF" : "#59607A";
      gg.beginPath(); gg.arc(nx, ny, 4, 0, TAU); gg.fill();

      // A tank at the pivot, barrel matching, so the number has a picture.
      gg.fillStyle = active ? p.ink : "#394054";
      rr(gg, ox - 9, oy - 6, 18, 6, 2); gg.fill();
      gg.beginPath(); gg.arc(ox, oy - 6, 4, Math.PI, TAU); gg.fill();
      gg.strokeStyle = OUTLINE;
      gg.lineWidth = 1.4;
      rr(gg, ox - 9, oy - 6, 18, 6, 2); gg.stroke();

      // Relative wind: which way it will push YOUR shell, in your own frame.
      const relW = wind * p.facing;
      const wx = D.x + 40, wy = D.y + 11;
      gg.font = "700 9px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
      gg.textAlign = "left";
      gg.textBaseline = "alphabetic";
      if (settings.wind === 0) {
        gg.fillStyle = "#5C6479";
        gg.fillText("CALM", wx, D.y + 15);
      } else {
        const strength = Math.abs(relW) / WIND_MAX[2];
        for (let i = 0; i < 5; i++) {
          const on = strength * 5 > i;
          gg.fillStyle = on ? (relW > 0 ? "#7CE38B" : "#FF7A6B") : "rgba(140,160,200,0.16)";
          const dir = relW > 0 ? 1 : -1;
          gg.beginPath();
          gg.moveTo(wx + i * 8, wy);
          gg.lineTo(wx + i * 8 + dir * 5, wy + 4);
          gg.lineTo(wx + i * 8, wy + 8);
          gg.closePath();
          gg.fill();
        }
      }
    }
    /* =================================================================
     * DRAWING — arsenal overlay
     *
     * Full screen, rotated to whichever seat opened it, so nobody reads
     * their own hand upside down.
     * ================================================================= */
    let arsGrid = null;
    function arsenalLayout() {
      const cw = Math.floor((W - 22 * 2 - 10) / 2);
      const ch = 86;
      const gx = 22, gy = Math.round(H * 0.5 - (4 * ch + 3 * 10) / 2 + 14);
      return { cw, ch, gx, gy, gap: 10 };
    }
    function arsCell(i) {
      const L = arsGrid || (arsGrid = arsenalLayout());
      const col = i % 2, row = (i / 2) | 0;
      return { x: L.gx + col * (L.cw + L.gap), y: L.gy + row * (L.ch + L.gap), w: L.cw, h: L.ch };
    }
    function arsCloseRect() {
      const L = arsGrid || (arsGrid = arsenalLayout());
      return { x: W / 2 - 80, y: L.gy + 4 * (L.ch + L.gap) + 8, w: 160, h: 52 };
    }
    /** One transform for the whole overlay, one inverse for its hit-tests. */
    function pushScreenFlip(gg, who) {
      gg.save();
      if (who === 1) { gg.translate(W, H); gg.rotate(Math.PI); }
    }
    function screenFlipPoint(who, px, py) {
      return who === 1 ? { x: W - px, y: H - py } : { x: px, y: py };
    }

    function drawArsenal(gg) {
      const p = players[turn];
      gg.fillStyle = "rgba(3,4,9,0.93)";
      gg.fillRect(0, 0, W, H);
      pushScreenFlip(gg, turn);
      const L = arsGrid || (arsGrid = arsenalLayout());
      blockText(gg, p.name + " ARSENAL", W / 2, L.gy - 56, 3,
        { align: "center", colour: p.ink, shadow: [2, 2] });
      gg.fillStyle = LABEL;
      gg.font = "600 11px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
      gg.textAlign = "center";
      gg.textBaseline = "alphabetic";
      gg.fillText("EVERY SHELL FIRES ONCE, THEN IT IS GONE", W / 2, L.gy - 16);

      for (let i = 0; i < p.hand.length && i < 8; i++) {
        const c = arsCell(i);
        const slot = p.hand[i];
        const w = WBY[slot.id];
        const sel = i === p.sel;
        plate(gg, c.x, c.y, c.w, c.h, 12, {
          fill: slot.used ? "#0B0C12" : sel ? "#1F2536" : PLATE,
          hi: sel ? p.ink : PLATE_HI,
        });
        if (sel && !slot.used) {
          gg.strokeStyle = p.ink;
          gg.lineWidth = 2;
          rr(gg, c.x + 1, c.y + 1, c.w - 2, c.h - 2, 11);
          gg.stroke();
        }
        gg.globalAlpha = slot.used ? 0.3 : 1;
        inset(gg, c.x + 10, c.y + 10, 40, 40, 8, "#0A0C13");
        drawIcon(gg, w.icon, c.x + 15, c.y + 15, 30, w.ink);
        gg.fillStyle = slot.used ? "#5D6478" : VALUE;
        gg.font = "700 13px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
        gg.textAlign = "left";
        let nm = w.name;
        while (gg.measureText(nm).width > c.w - 60 && nm.length > 4) nm = nm.slice(0, -1);
        gg.fillText(nm, c.x + 58, c.y + 26);
        gg.fillStyle = LABEL;
        gg.font = "600 10px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
        gg.fillText(w.dmg > 0 ? "DMG " + w.dmg + "  ·  R" + w.rad : "NO DAMAGE", c.x + 58, c.y + 42);
        gg.font = "500 10px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
        gg.fillStyle = "#6E7689";
        const tag = w.tag;
        let line = tag;
        if (gg.measureText(line).width > c.w - 22) {
          while (gg.measureText(line + "\u2026").width > c.w - 22 && line.length > 6) line = line.slice(0, -1);
          line += "\u2026";
        }
        gg.fillText(line, c.x + 11, c.y + 68);
        if (slot.used) {
          gg.strokeStyle = "#FF4A4A";
          gg.lineWidth = 2;
          gg.beginPath();
          gg.moveTo(c.x + 10, c.y + c.h - 12);
          gg.lineTo(c.x + c.w - 10, c.y + 14);
          gg.stroke();
        }
        gg.globalAlpha = 1;
      }
      const cl = arsCloseRect();
      plate(gg, cl.x, cl.y, cl.w, cl.h, 12, { pressed: isPressed("ars:close") });
      blockText(gg, "CLOSE", cl.x + cl.w / 2, cl.y + (cl.h - 21) / 2, 3,
        { align: "center", colour: VALUE });
      gg.restore();
    }

    /* =================================================================
     * DRAWING — banner and title
     * ================================================================= */
    function drawBanner(gg) {
      if (bannerT <= 0 || !players) return;
      const p = players[bannerFor];
      const k = 1 - bannerT / 66;
      const slide = k < 0.18 ? (k / 0.18) : k > 0.84 ? (1 - (k - 0.84) / 0.16) : 1;
      const h = 40;
      const y = BF_TOP + BF_H * 0.20 - h / 2;
      gg.save();
      gg.beginPath(); gg.rect(0, BF_TOP, W, BF_H); gg.clip();
      gg.globalAlpha = slide;
      const grad = gg.createLinearGradient(0, y, W, y);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.18, p.glow + "0.86)");
      grad.addColorStop(0.82, p.glow + "0.86)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      gg.fillStyle = grad;
      gg.fillRect(0, y, W, h);
      gg.fillStyle = "rgba(0,0,0,0.45)";
      gg.fillRect(0, y, W, 2);
      gg.fillRect(0, y + h - 2, W, 2);
      const label = lastReason && bannerFor === turn && lastReason === "SUDDEN DEATH"
        ? "SUDDEN DEATH" : p.name + " FIRES";
      // The banner is addressed to one player, so it is drawn in that player's
      // frame. The battlefield never rotates, but "EMBER FIRES" printed
      // upside down at the exact moment it is Ember's turn is the one piece of
      // world-space text nobody can defend.
      gg.save();
      gg.translate(W / 2, y + h / 2);
      if (p.i === 1) gg.rotate(Math.PI);
      blockText(gg, label, 0, -10.5, 3,
        { align: "center", colour: "#07131A", shadow: [1.5, 1.5], shadowColour: "rgba(255,255,255,0.3)" });
      gg.restore();
      gg.restore();
      gg.globalAlpha = 1;
    }

    function drawTitle(gg, t) {
      // Scrim that leaves the live battlefield showing through its middle.
      const gr = gg.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, "rgba(3,4,10,0.97)");
      gr.addColorStop(BF_TOP / H - 0.02, "rgba(3,4,10,0.94)");
      gr.addColorStop(BF_TOP / H + 0.03, "rgba(3,4,10,0.10)");
      gr.addColorStop(BF_BOT / H - 0.03, "rgba(3,4,10,0.20)");
      gr.addColorStop(BF_BOT / H + 0.02, "rgba(3,4,10,0.94)");
      gr.addColorStop(1, "rgba(3,4,10,0.97)");
      gg.fillStyle = gr;
      gg.fillRect(0, 0, W, H);

      const logoY = TOP_Y + Math.round(DECK_H * 0.09);
      const s = Math.min(10, Math.floor(W / 26));
      // Layered extrude: the drop is the depth, the fills are the face.
      for (let d = 7; d >= 1; d--) {
        blockText(gg, "LOB", W / 2 + d * 1.1, logoY + d * 1.1, s,
          { align: "center", colour: d > 4 ? "#2A0C22" : "#5A1030" });
      }
      const lg = gg.createLinearGradient(0, logoY, 0, logoY + s * 7);
      lg.addColorStop(0, "#FFE066");
      lg.addColorStop(0.55, "#FF9E3C");
      lg.addColorStop(1, "#FF4B6E");
      const path = blockPath("LOB", W / 2 - blockW("LOB", s) / 2, logoY, s);
      gg.fillStyle = lg;
      gg.fill(path);

      gg.fillStyle = "#B9A8C6";
      gg.font = "600 12px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
      gg.textAlign = "center";
      gg.fillText("A R T I L L E R Y   F O R   T W O", W / 2, logoY + s * 7 + 22);

      // Weapon strip: eight of the twelve go into every match, so show them.
      const ic = 30, gapI = 6;
      const total = 8 * ic + 7 * gapI;
      let ix = W / 2 - total / 2;
      const iy = logoY + s * 7 + 32;
      for (let i = 0; i < 8; i++) {
        const w = WEAPONS[i];
        inset(gg, ix, iy, ic, ic, 7, "rgba(255,255,255,0.035)");
        gg.globalAlpha = 0.85;
        drawIcon(gg, w.icon, ix + 4, iy + 4, ic - 8, w.ink);
        gg.globalAlpha = 1;
        ix += ic + gapI;
      }
      gg.fillStyle = "#7E86A0";
      gg.font = "600 10px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
      gg.textAlign = "center";
      gg.fillText("TWELVE WEAPONS  \u00b7  EIGHT EACH  \u00b7  ONE SHOT EACH", W / 2, iy + ic + 16);

      // Seat map, so the layout is obvious before the first shot.
      const seat = (label, def, y, flip) => {
        const tw = blockW(label, 2);
        const x0 = -(tw + 24) / 2;
        gg.save();
        gg.translate(W / 2, y);
        if (flip) gg.rotate(Math.PI);
        gg.fillStyle = def.ink;
        rr(gg, x0, -3, 17, 5, 2); gg.fill();
        gg.beginPath(); gg.arc(x0 + 8.5, -3, 4.4, Math.PI, TAU); gg.fill();
        gg.strokeStyle = def.ink;
        gg.lineWidth = 2;
        gg.beginPath(); gg.moveTo(x0 + 8.5, -7); gg.lineTo(x0 + 17, -13); gg.stroke();
        blockText(gg, label, x0 + 24, -7, 2, { align: "left", colour: def.ink });
        gg.restore();
      };
      seat("EMBER SITS HERE", PLAYERS_DEF[1], TOP_Y + DECK_H - 20, true);
      seat("AZURE SITS HERE", PLAYERS_DEF[0], BOT_Y + 24, false);
    }

    /* =================================================================
     * OVERLAY — one markup string on the runtime-owned root.
     *
     * Bits may not touch the host document, so every panel is declared
     * here and queried back by [data-el]. The root is transparent to
     * pointers: it is created after the canvas and would otherwise
     * swallow every tap meant for a control deck.
     * ================================================================= */
    const FONTF = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
    const CHROME_Y = BF_TOP + 8;
    const START_Y = BOT_Y + Math.round(DECK_H * 0.42);
    const CARD_W = Math.min(334, W - 34);
    // Ten rules did not fit in 596px, so the card faded its own text out under
    // a scroll mask and then left 150px of empty screen below itself — which
    // reads as broken rather than as scrollable. Take the height that is
    // actually there; the copy was trimmed to match.
    const HELP_TOP = Math.max(SAFE_T + 12, Math.round(H * 0.075));
    const HELP_H = Math.min(H - HELP_TOP - SAFE_B - 20, 740);
    const SET_TOP = Math.max(SAFE_T + 24, Math.round(H * 0.17));
    const SET_H = 496;
    const OVER_TOP = Math.round(H * 0.30);
    const OVER_H = 250;

    const btn = "pointer-events:auto;width:36px;height:36px;border-radius:12px;border:none;" +
      "background:rgba(12,15,24,0.58);color:#CBD6EA;font-size:15px;line-height:1;" +
      "font-family:inherit;padding:0;box-shadow:0 0 0 1px rgba(140,160,200,0.16);";
    const bigBtn = (bg, fg) =>
      "pointer-events:auto;border:none;border-radius:14px;font-family:inherit;font-size:15px;" +
      "font-weight:700;letter-spacing:0.06em;background:" + bg + ";color:" + fg + ";";
    const cardCss = (top, h) =>
      "position:absolute;left:" + Math.round((W - CARD_W) / 2) + "px;top:" + top + "px;width:" +
      CARD_W + "px;height:" + h + "px;background:linear-gradient(180deg,#171B27,#0D1018);" +
      "border-radius:20px;border:1px solid rgba(140,160,200,0.14);box-shadow:0 18px 60px rgba(0,0,0,0.6);" +
      "padding:20px;box-sizing:border-box;overflow:hidden;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONTF + ";color:#E8EEFB;pointer-events:none;" +
      "-webkit-font-smoothing:antialiased;";
    root.innerHTML =
      // chrome, tucked into the sky above the terrain where nothing is ever tapped
      '<div data-el="chrome" style="position:absolute;left:10px;top:' + CHROME_Y + 'px;display:flex;gap:6px;' +
        'z-index:30;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btn +
          (settings.mute ? "text-decoration:line-through;opacity:0.5;" : "") + '">&#9835;</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btn + '">&#9881;</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btn + '">?</button>' +
      '</div>' +

      // title
      '<div data-el="title" style="position:absolute;inset:0;z-index:40;pointer-events:none;">' +
        '<button data-el="start" style="' + bigBtn("linear-gradient(96deg,#29D3F0,#FF6A3C)", "#06121A") +
          'position:absolute;left:50%;transform:translateX(-50%);top:' + START_Y + 'px;' +
          'width:214px;height:56px;font-size:17px;">START MATCH</button>' +
        '<div style="position:absolute;left:0;right:0;top:' + (START_Y + 66) + 'px;text-align:center;' +
          'font-size:12px;opacity:0.5;line-height:1.6;padding:0 34px;">' +
          'Lay the phone flat between you. Each deck faces its own seat.</div>' +
      '</div>' +

      // match over
      '<div data-el="over" style="position:absolute;inset:0;z-index:60;display:none;pointer-events:auto;' +
        'background:rgba(3,4,10,0.90);">' +
        // The result repeated upside down for the player at the far end. One
        // rotated wrapper, so the score line stays *under* the headline from
        // that seat rather than above it.
        '<div style="position:absolute;left:0;right:0;top:' + (SAFE_T + 22) + 'px;' +
          'text-align:center;transform:rotate(180deg);">' +
          '<div data-el="over-mini" style="font-size:22px;font-weight:800;' +
            'letter-spacing:0.14em;"></div>' +
          '<div data-el="over-mini-sub" style="font-size:12px;opacity:0.6;' +
            'letter-spacing:0.07em;margin-top:6px;"></div>' +
        '</div>' +
        '<div style="' + cardCss(OVER_TOP, OVER_H) + 'text-align:center;">' +
          '<div data-el="over-name" style="font-size:32px;font-weight:800;letter-spacing:0.12em;"></div>' +
          '<div data-el="over-line" style="font-size:12.5px;opacity:0.55;margin-top:6px;"></div>' +
          '<div style="display:flex;gap:8px;margin-top:12px;">' +
            '<div style="flex:1;padding:8px 0;border-radius:12px;background:rgba(41,211,240,0.10);' +
              'box-shadow:inset 0 0 0 1px rgba(41,211,240,0.30);">' +
              '<div style="font-size:9px;letter-spacing:0.2em;color:#29D3F0;opacity:0.8;">AZURE</div>' +
              '<div data-el="over-hp0" style="font-size:19px;font-weight:800;color:#29D3F0;">0</div></div>' +
            '<div style="flex:1;padding:8px 0;border-radius:12px;background:rgba(255,106,60,0.10);' +
              'box-shadow:inset 0 0 0 1px rgba(255,106,60,0.30);">' +
              '<div style="font-size:9px;letter-spacing:0.2em;color:#FF6A3C;opacity:0.8;">EMBER</div>' +
              '<div data-el="over-hp1" style="font-size:19px;font-weight:800;color:#FF6A3C;">0</div></div>' +
          '</div>' +
          '<div style="margin-top:10px;padding:10px;border-radius:14px;background:rgba(255,255,255,0.045);">' +
            '<div style="font-size:10px;letter-spacing:0.24em;opacity:0.5;">BIGGEST SHOT</div>' +
            '<div data-el="over-stat" style="font-size:34px;font-weight:800;line-height:1.15;' +
              'background:linear-gradient(96deg,#FFE066,#FF6A3C);-webkit-background-clip:text;' +
              'background-clip:text;-webkit-text-fill-color:transparent;">0</div>' +
            '<div data-el="over-sub" style="font-size:11px;opacity:0.45;"></div>' +
          '</div>' +
        '</div>' +
        '<button data-el="again" style="' + bigBtn("linear-gradient(96deg,#29D3F0,#FF6A3C)", "#06121A") +
          'position:absolute;left:50%;transform:translateX(-50%);top:' + (OVER_TOP + OVER_H + 18) + 'px;' +
          'width:214px;height:54px;font-size:16px;">NEW MATCH</button>' +
      '</div>' +

      // how to play
      '<div data-el="helpp" style="position:absolute;inset:0;z-index:70;display:none;pointer-events:auto;' +
        'background:rgba(3,4,10,0.93);">' +
        '<div style="' + cardCss(HELP_TOP, HELP_H) + '">' +
          '<div style="font-size:19px;font-weight:800;letter-spacing:0.1em;">HOW TO PLAY</div>' +
          '<ul data-el="helpl" style="font-size:13.5px;line-height:1.56;opacity:0.86;padding-left:17px;' +
            'margin:12px 0 0;height:' + (HELP_H - 150) + 'px;overflow-y:auto;padding-bottom:4px;">' +
            '<li>Two players, one phone. <b style="color:#29D3F0">Azure</b> takes the bottom edge, ' +
              '<b style="color:#FF6A3C">Ember</b> the top.</li>' +
            '<li>Your deck sits at <b>your own end</b>, right-way-up from your seat. It lights on your turn; the other one is dead.</li>' +
            '<li><b>Angle</b> is measured from your own line of fire: <b>0</b> is flat at your opponent, <b>90</b> straight up, <b>180</b> over your own shoulder.</li>' +
            '<li>Drag the aim dome to set angle and power at once. The <b>&minus;</b> and <b>+</b> pads nudge by one &mdash; hold to repeat.</li>' +
            '<li>Wind pushes every shell sideways. The arrows in your dome show which way it pushes <b>your</b> shot.</li>' +
            '<li><b>There is no trajectory preview.</b> Fire, watch where it lands, correct. That is the entire game.</li>' +
            '<li>Tap the weapon plate for your arsenal. Eight shells, each fires <b>once</b>.</li>' +
            '<li>The ground is real. Blow it out from under a tank and it <b>falls and takes the damage</b>.</li>' +
            '<li>First to zero armour wins. If both run dry, the healthier tank takes it.</li>' +
            '<li>The <b>biggest single shot</b> of the match goes to the global board.</li>' +
          '</ul>' +
          // Shown only when there is genuinely more list below the fold; a mask
          // greying out the last line of a list that already fits is a lie.
          '<div data-el="helpfade" style="position:absolute;left:1px;right:1px;top:' + (HELP_H - 128) +
            'px;height:36px;display:none;pointer-events:none;' +
            'background:linear-gradient(180deg,rgba(13,16,24,0),rgba(13,16,24,0.97));"></div>' +
        '</div>' +
        '<button data-el="helpp-close" style="' + bigBtn("rgba(160,190,240,0.16)", "#E8EEFB") +
          'position:absolute;left:50%;transform:translateX(-50%);top:' + (HELP_TOP + HELP_H - 66) + 'px;' +
          'width:' + (CARD_W - 40) + 'px;height:46px;">GOT IT</button>' +
      '</div>' +

      // settings
      '<div data-el="setp" style="position:absolute;inset:0;z-index:70;display:none;pointer-events:auto;' +
        'background:rgba(3,4,10,0.93);">' +
        '<div style="' + cardCss(SET_TOP, SET_H) + '">' +
          '<div style="font-size:19px;font-weight:800;letter-spacing:0.1em;">SETTINGS</div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;opacity:0.45;margin:15px 0 7px;">ARSENALS</div>' +
          '<div data-el="arsrow" style="display:flex;gap:8px;"></div>' +
          '<div style="font-size:11px;opacity:0.4;margin-top:6px;">' +
            'Mirrored deals you both the same eight shells. Wild draws each hand separately.</div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;opacity:0.45;margin:14px 0 7px;">WIND</div>' +
          '<div data-el="windrow" style="display:flex;gap:8px;"></div>' +
          '<div style="font-size:11px;opacity:0.4;margin-top:6px;">' +
            'A crosswind bends every shell. Calm turns it off entirely.</div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;opacity:0.45;margin:14px 0 7px;">ARMOUR</div>' +
          '<div data-el="hprow" style="display:flex;gap:8px;"></div>' +
          '<div style="font-size:10px;letter-spacing:0.22em;opacity:0.45;margin:14px 0 7px;">SOUND</div>' +
          '<div data-el="sndrow" style="display:flex;gap:8px;"></div>' +
          '<div data-el="setnote" style="font-size:11px;opacity:0.4;line-height:1.5;margin-top:13px;">' +
            'Arsenal and armour apply to the next match.</div>' +
        '</div>' +
        '<button data-el="setp-close" style="' + bigBtn("rgba(160,190,240,0.16)", "#E8EEFB") +
          'position:absolute;left:50%;transform:translateX(-50%);top:' + (SET_TOP + SET_H - 66) + 'px;' +
          'width:' + (CARD_W - 40) + 'px;height:46px;">DONE</button>' +
      '</div>';

    const shell = {
      el: (n) => root.querySelector('[data-el="' + n + '"]'),
      tap: (node, fn) => {
        if (!node) return;
        ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
        ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
      },
    };

    function pillRow(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + esc(String(v)) + '" style="pointer-events:auto;flex:1;padding:11px 0;border:none;' +
        'border-radius:12px;font-family:inherit;font-size:13.5px;font-weight:700;">' +
        esc(labels[i]) + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          // The chosen pill wears the game's own cyan. Two greys a shade apart
          // is not a selected state — it is a coin toss, and this panel is the
          // only surface in the bit that had no colour on it at all.
          b.style.background = on
            ? "linear-gradient(180deg,rgba(41,211,240,0.26),rgba(41,211,240,0.11))"
            : "rgba(160,190,240,0.07)";
          b.style.color = on ? "#BFF3FF" : "rgba(220,232,255,0.5)";
          b.style.boxShadow = on ? "inset 0 0 0 1.5px rgba(41,211,240,0.72)" : "none";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        shell.tap(b, () => { set(b.dataset.v); saveSettings(); paint(); sound.sting("tap"); sound.haptic("light"); });
      }
      paint();
    }
    pillRow(shell.el("arsrow"), ["mirror", "wild"], ["Mirrored", "Wild draw"],
      () => settings.arsenal, (v) => { settings.arsenal = v; });
    pillRow(shell.el("windrow"), ["0", "1", "2"], ["Calm", "Breeze", "Gale"],
      () => String(settings.wind), (v) => { settings.wind = v | 0; if (phase === "title") newWind(); });
    pillRow(shell.el("hprow"), ["60", "80", "120"], ["60", "80", "120"],
      () => String(settings.armour), (v) => { settings.armour = v | 0; });
    pillRow(shell.el("sndrow"), ["on", "off"], ["Sound on", "Muted"],
      () => (sound.muted ? "off" : "on"),
      (v) => { if ((v === "off") !== sound.muted) syncMute(sound.toggle()); });

    /** The arsenal is drawn on the canvas, which sits under the overlay root,
     *  so the chrome has to get out of its way rather than float over it. */
    function showChrome() {
      const n = shell.el("chrome");
      if (n) n.style.display = arsenalOpen ? "none" : "flex";
    }
    function paintChrome() { showChrome(); }

    /** One mute state, two places to change it. */
    function syncMute(m) {
      const n = shell.el("mute");
      if (n) {
        n.style.textDecoration = m ? "line-through" : "none";
        n.style.opacity = m ? "0.5" : "1";
      }
      const row = shell.el("sndrow");
      if (row) for (const b of row.querySelectorAll("button")) {
        const on = b.dataset.v === (m ? "off" : "on");
        b.style.background = on ? "linear-gradient(180deg,#2C3446,#1B2130)" : "rgba(160,190,240,0.07)";
        b.style.color = on ? "#FFFFFF" : "rgba(220,232,255,0.5)";
        b.style.boxShadow = on ? "inset 0 0 0 1px rgba(160,190,240,0.4)" : "none";
      }
    }
    shell.tap(shell.el("mute"), () => { syncMute(sound.toggle()); });
    shell.tap(shell.el("cog"), () => { shell.el("setp").style.display = "block"; });
    shell.tap(shell.el("setp-close"), () => { shell.el("setp").style.display = "none"; });
    /** The scroll mask only appears when something is actually masked. */
    function syncHelpFade() {
      const ul = shell.el("helpl"), fade = shell.el("helpfade");
      if (!ul || !fade) return;
      const more = ul.scrollHeight - ul.clientHeight - ul.scrollTop;
      fade.style.display = more > 4 ? "block" : "none";
    }
    if (shell.el("helpl")) ctx.listen(shell.el("helpl"), "scroll", syncHelpFade);
    shell.tap(shell.el("help"), () => {
      shell.el("helpp").style.display = "block";
      syncHelpFade();
    });
    shell.tap(shell.el("helpp-close"), () => { shell.el("helpp").style.display = "none"; });

    shell.tap(shell.el("start"), async () => {
      try { ctx.platform.start(); } catch (_) {}
      await sound.unlock();
      shell.el("title").style.display = "none";
      newMatch();
    });
    shell.tap(shell.el("again"), async () => {
      await sound.unlock();
      shell.el("over").style.display = "none";
      newMatch();
      try { ctx.platform.interact({ type: "replay" }); } catch (_) {}
    });

    /* =================================================================
     * INPUT
     *
     * A pointer is bound to whatever control it landed on, for that
     * pointer's whole life, and only the active deck accepts one at all.
     * A second finger landing while a control is held is ignored, so one
     * player can never drive two things at once — or their opponent's.
     * ================================================================= */
    const held = new Map();          // pointerId -> {kind, ...}
    let repeatKey = null, repeatAge = 0;

    function pressFx(name) {
      pressed = { name };
      ctx.timeout(() => { if (pressed && pressed.name === name) pressed = null; }, 90);
    }

    function domeSet(p, lx, ly) {
      const dx = lx - DL.domeOx, dy = ly - DL.domeOy;
      let a = Math.atan2(-dy, dx) / RAD;
      if (a < 0) a = dx >= 0 ? 0 : 180;
      p.ang = clamp(Math.round(a), 0, 180);
      p.pow = clamp(Math.round(Math.hypot(dx, dy) / DL.domeR * 100), 5, 100);
    }

    function stepValue(p, key, dir) {
      if (key === "ang") p.ang = clamp(p.ang + dir, 0, 180);
      else p.pow = clamp(p.pow + dir, 5, 100);
      sound.sting("tap");
      sound.haptic("light");
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      e.preventDefault();
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
      const px = e.offsetX, py = e.offsetY;

      if (arsenalOpen) {
        const q = screenFlipPoint(turn, px, py);
        const p = players[turn];
        for (let i = 0; i < p.hand.length && i < 8; i++) {
          if (inRect(q, arsCell(i))) {
            if (!p.hand[i].used) {
              p.sel = i;
              sound.sting("coin");
              sound.haptic("light");
              arsenalOpen = false;
              showChrome();
            } else { sound.sting("fail"); }
            return;
          }
        }
        if (inRect(q, arsCloseRect())) { pressFx("ars:close"); arsenalOpen = false; sound.sting("tap"); }
        showChrome();
        return;
      }

      if (phase !== "aim" || !players) return;
      if (held.size > 0) return;                 // one live pointer per deck
      const who = py >= BOT_Y ? 0 : py <= BF_TOP ? 1 : -1;
      if (who !== turn) {
        if (who >= 0) sound.sting("fail");       // the dimmed deck refuses, audibly
        return;
      }
      const L = screenToDeck(who, px, py);
      const p = players[who];

      if (inRect(L, DL.dome)) {
        held.set(e.pointerId, { kind: "dome", who });
        domeSet(p, L.x, L.y);
        sound.haptic("light");
        return;
      }
      const steppers = [
        ["angM", "ang", -1], ["angP", "ang", 1], ["powM", "pow", -1], ["powP", "pow", 1],
      ];
      for (const [rect, key, dir] of steppers) {
        if (inRect(L, DL[rect])) {
          held.set(e.pointerId, { kind: "step", key, dir, who });
          pressFx(who + ":" + rect);
          repeatKey = { key, dir, who };
          repeatAge = 0;
          stepValue(p, key, dir);
          return;
        }
      }
      if (inRect(L, DL.weapon)) {
        held.set(e.pointerId, { kind: "weapon", who });
        pressFx(who + ":weapon");
        return;
      }
      if (inRect(L, DL.fire)) {
        held.set(e.pointerId, { kind: "fire", who });
        pressFx(who + ":fire");
        return;
      }
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      const h = held.get(e.pointerId);
      if (!h) return;
      e.preventDefault();
      if (h.kind === "dome") {
        const L = screenToDeck(h.who, e.offsetX, e.offsetY);
        domeSet(players[h.who], L.x, L.y);
      }
    }, { passive: false });

    function release(e) {
      const h = held.get(e.pointerId);
      if (!h) return;
      held.delete(e.pointerId);
      if (h.kind === "step") { repeatKey = null; pressed = null; }
      if (phase !== "aim") return;
      const L = screenToDeck(h.who, e.offsetX, e.offsetY);
      if (h.kind === "fire" && inRect(L, DL.fire)) fire();
      if (h.kind === "weapon" && inRect(L, DL.weapon)) {
        arsGrid = null;
        arsenalOpen = true;
        showChrome();
        sound.sting("tap");
      }
    }
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    /* =================================================================
     * FRAME
     * ================================================================= */
    genTerrain();
    players = [newPlayer(0), newPlayer(1)];
    levelPad(players[0].x, 16);
    levelPad(players[1].x, 16);
    for (const p of players) p.y = groundAt(p.x);
    players[0].hand = dealHand();
    players[1].hand = players[0].hand.map((h) => ({ id: h.id, used: false }));
    newWind();

    let acc = 0, frameNo = 0;
    ctx.onFrame((dtMs, now) => {
      frameNo++;
      const t = now === undefined ? performance.now() : now;
      acc += Math.min(dtMs, 120);
      let steps = 0;
      while (acc >= STEP_MS && steps < 14) {
        acc -= STEP_MS;
        steps++;
        simStep();
        // A shell above the roof of the world is dead time; run it faster so
        // a big mortar does not stall the match.
        if (shots.length && shots.every((s) => s.y < BF_TOP - 20)) { simStep(); simStep(); }
      }

      if (phase === "flight" && flightSettled()) {
        phase = "resolve";
        resolveT = 26;
      } else if (phase === "resolve") {
        if (--resolveT <= 0) endTurn();
      }

      if (phase === "title") {
        // A demo shell every few seconds, so the title screen is the game.
        titleT++;
        if (--demoT <= 0) {
          demoT = 190;
          const p = players[(titleT >> 6) & 1];
          p.ang = 38 + Math.random() * 22;
          p.pow = 58 + Math.random() * 22;
          const s = spawnShell(p, WBY.lob, p.ang, p.pow);
          s.windK = 1; s.gravK = 1;
        }
      }

      // Only the two safe-area strips are ever left uncovered, so there is no
      // reason to pay for a full-screen clear and fill behind the deck art.
      g.setTransform(ctx.dpr || 1, 0, 0, ctx.dpr || 1, 0, 0);
      g.fillStyle = "#05060B";
      if (SAFE_T > 0) g.fillRect(0, 0, W, SAFE_T);
      if (SAFE_B > 0) g.fillRect(0, H - SAFE_B, W, SAFE_B);

      drawBattlefield(g, t);
      drawDeck(g, 1, t);
      drawDeck(g, 0, t);
      drawBanner(g);
      if (phase === "title") { drawTitle(g, t); deckSig[0] = deckSig[1] = ""; }
      if (arsenalOpen) { drawArsenal(g); deckSig[0] = deckSig[1] = ""; }

      // Stepper auto-repeat: slow at first, then quick, the way a real one does.
      if (repeatKey && phase === "aim") {
        repeatAge++;
        const delay = 22;
        if (repeatAge > delay) {
          const speed = repeatAge > delay + 70 ? 1 : repeatAge > delay + 26 ? 2 : 4;
          if ((repeatAge - delay) % speed === 0) stepValue(players[repeatKey.who], repeatKey.key, repeatKey.dir);
        }
      }
    });

    /* --- resize: a rotation or a keyboard changes the whole layout ------- */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      const oldW = W, oldTop = BF_TOP, oldH = BF_H;
      fitCanvas();
      arsGrid = null;
      deckSig[0] = deckSig[1] = "";
      // Rescale the ground rather than regenerate it: a live match must not
      // lose its craters because somebody turned the phone.
      if (surf && oldW > 1) {
        const remap = (src) => {
          const out = new Float32Array(W);
          for (let x = 0; x < W; x++) {
            const o = clamp(Math.round(x / (W - 1) * (oldW - 1)), 0, oldW - 1);
            out[x] = BF_TOP + (src[o] - oldTop) / oldH * BF_H;
          }
          return out;
        };
        surf = remap(surf);
        surfT = new Float32Array(surf);
        // The decorative skyline is the same length as the ground and has to be
        // remapped with it — a short array here reads past its end, and the NaN
        // that comes back poisons the sky gradient rather than throwing.
        if (backRidge) backRidge = remap(backRidge);
        terrainDirty = true;
        for (const p of players) {
          p.x = clamp(p.x / oldW * W, 12, W - 12);
          p.y = groundAt(p.x);
        }
      }
      makeSky();
    });

    /* =================================================================
     * PROBE — read-only, for the local harness.
     *
     * Geometry accessors so a test can tap the same pixels a thumb would,
     * plus the physics constants so it can solve its own shot rather than
     * being handed one. Nothing here mutates the match.
     * ================================================================= */
    window.__LOB__ = {
      get phase() { return phase; },
      get busy() { return phase !== "aim"; },
      get turn() { return turn; },
      get volley() { return volley; },
      get winner() { return winner; },
      get reason() { return lastReason; },
      get bestShot() { return bestShot; },
      get shots() { return shotsFired; },
      get arsenalOpen() { return arsenalOpen; },
      get live() {
        return { frame: frameNo, resolveT, settleT, shots: shots.length,
                 pending: pending.length, rings: rings.length, debris: debris.length };
      },
      get hp() { return players ? [players[0].hp, players[1].hp] : [0, 0]; },
      get aim() { return players ? { ang: players[turn].ang, pow: players[turn].pow } : null; },
      get hand() {
        return players ? players[turn].hand.map((h, i) => ({ i, id: h.id, used: h.used })) : [];
      },
      get weapon() { return players ? selWeapon(players[turn]).id : null; },
      /** Screen centre of a named deck control, for the player whose turn it is. */
      hit(name) {
        const r = DL[name];
        if (!r) return null;
        return deckToScreen(turn, r.x + r.w / 2, r.y + r.h / 2);
      },
      /** Screen point inside the aim dome that means this angle and power. */
      domePoint(ang, pow) {
        const r = DL.domeR * clamp(pow, 5, 100) / 100;
        return deckToScreen(turn, DL.domeOx + Math.cos(ang * RAD) * r,
                                  DL.domeOy - Math.sin(ang * RAD) * r);
      },
      /** Screen centre of an arsenal cell (overlay must be open). */
      cellXY(i) {
        const c = arsCell(i);
        return screenFlipPoint(turn, c.x + c.w / 2, c.y + c.h / 2);
      },
      closeXY() {
        const c = arsCloseRect();
        return screenFlipPoint(turn, c.x + c.w / 2, c.y + c.h / 2);
      },
      startXY() { return { x: W / 2, y: START_Y + 28 }; },
      /** Chrome and panel buttons, so a test taps pixels rather than nodes. */
      chromeXY(which) {
        const i = which === "mute" ? 0 : which === "cog" ? 1 : 2;
        return { x: 10 + i * 42 + 18, y: CHROME_Y + 18 };
      },
      panelCloseXY(which) {
        return which === "help"
          ? { x: W / 2, y: HELP_TOP + HELP_H - 43 }
          : { x: W / 2, y: SET_TOP + SET_H - 43 };
      },
      againXY() { return { x: W / 2, y: OVER_TOP + OVER_H + 45 }; },
      /** Everything needed to integrate the same trajectory this bit does. */
      physics() {
        const p = players[turn], foe = players[1 - turn];
        const m = muzzle(p);
        return {
          grav: GRAV, mk: MK, wind, facing: p.facing,
          px: p.x, py: p.y, ox: m.x, oy: m.y, fx: foe.x, fy: foe.y - 8,
          bfTop: BF_TOP, bfBot: BF_BOT, w: W,
          surf: Array.prototype.slice.call(surf),
        };
      },
    };
    ctx.onDestroy(() => { try { delete window.__LOB__; } catch (_) {} });

    // Draw one full frame before telling the host we are alive, so a cold
    // start never shows a blank rectangle.
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#05060B";
    g.fillRect(0, 0, W, H);
    drawBattlefield(g, performance.now());
    drawDeck(g, 1, performance.now());
    drawDeck(g, 0, performance.now());
    drawTitle(g, performance.now());
    ctx.markVisualReady("battlefield drawn");
    ctx.platform.ready();
  },
};
