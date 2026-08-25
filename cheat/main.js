/**
 * Cheat — the lying game, for three to five people around one phone.
 *
 * The whole deck is dealt out. The claim rank marches round the table on its
 * own — Aces, Twos, Threes, wrapping after Kings — and it does not care what
 * anybody is holding. On your turn you put one to four cards FACE DOWN and
 * announce them as the current rank. You may be telling the truth. You may not
 * be. Anybody else may call CHEAT: if you lied you take the whole pile, and if
 * you did not, the caller does.
 *
 * Every turn is two physically different situations on the same slab of glass,
 * and separating them is the design.
 *
 * PLACE is private. The phone is picked up, so the screen is upright and the
 * whole of it belongs to one person: their hand, sorted, laid out in rows with
 * enough of each card showing to pick one out with a thumb. A pass-the-phone
 * cover names who should be holding it and lifts on a TAP, not a hold — the
 * screen behind it has to be tapped four times, and holding a cover open takes
 * a third hand. Exposure is bounded by the player's own commit instead: the
 * instant they play, the hand is gone.
 *
 * CHALLENGE is public. The phone goes flat and every other player gets a CHEAT
 * pad on the edge they are actually sitting at, rotated to face them, all live
 * at once for a few seconds. The race is settled inside the pointerdown
 * handler, synchronously, in the order the runtime delivered the events —
 * deferring it by even a frame would collapse four hands landing together into
 * one tie.
 *
 * Five players is the ceiling and it is not arbitrary. A phone delivers at most
 * five simultaneous touches (iOS caps maxTouchPoints at 5 and simply never
 * sends the sixth), and four is the number that is safe rather than exactly at
 * the limit. Five players means four challengers, which is also exactly the
 * number of edges a phone has — so the touch budget and the geometry cap the
 * game at the same number, and nobody is ever asked to share an edge.
 *
 * The leaderboard is the table's, not a person's: the longest unbroken run of
 * lies that got past this table before anybody caught one. It is never shown
 * during play, because a counter that says "three lies so far" hands the room
 * information the cards are deliberately hiding.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so all 52
 * faces, the back, the cloth and the lamp are painted into OffscreenCanvases at
 * boot and blitted — with a live-drawing fallback for WebViews that have none.
 * The overlay is one markup string on ctx.createRoot() rather than
 * document.createElement, pointer maths uses offsetX/offsetY rather than
 * getBoundingClientRect, and every soft edge is stacked translucent strokes
 * rather than a canvas blur filter. All three are rejected at upload and none
 * of them is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Cheat",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "cards", "party", "bluffing"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {

    /* Every game in this set is set in lowercase Inter. Canvas text comes from
     * a few hundred call sites, so the case change goes in at the one place
     * they all pass through rather than at each of them. Single characters are
     * left alone — card ranks and piece letters are symbols, not words, and
     * "k" on a king reads as a bug. measureText is patched to match, or
     * centred text would be measured at its uppercase width and drift off
     * its own anchor. */
    for (const Proto of [globalThis.CanvasRenderingContext2D,
                         globalThis.OffscreenCanvasRenderingContext2D]) {
      if (!Proto || Proto.prototype.__lcText) continue;
      Proto.prototype.__lcText = true;
      for (const method of ["fillText", "strokeText", "measureText"]) {
        const original = Proto.prototype[method];
        if (!original) continue;
        Proto.prototype[method] = function (text, ...rest) {
          const t = typeof text === "string" && text.length > 1 ? text.toLowerCase() : text;
          return original.call(this, t, ...rest);
        };
      }
    }
    // Inter, from the Plethora font registry, in the three weights it serves.
    // The calls are fire-and-forget with literal arguments: a font is a
    // nicety and the first frame must never wait on one, and the upload
    // validator only accepts loader arguments that are direct literals.
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "400" }); } catch (_) {}
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "600" }); } catch (_) {}
    try { ctx.loadFont("Inter", "inter", "1.0.0", { weight: "700" }); } catch (_) {}
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const easeBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

    /** Escape anything a player typed before it can reach innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ===============================================================
     * PALETTE
     *
     * A back room after midnight: old oxblood cloth, one hot lamp
     * overhead, brass fittings, everything past the pool of light
     * falling away to nearly black. Snap's table is a bright green
     * baize because Snap is a race; this one has to feel like a place
     * where people lie to each other, so the light does the work and
     * the corners are genuinely dark.
     *
     * Every player colour has to survive being laid on warm dark red,
     * so they are all cold or bright — an ochre or a brown player would
     * dissolve into the cloth.
     * ============================================================= */
    const FELT_LIT = "#6f3527", FELT_MID = "#2e1411", FELT_DARK = "#080403";
    const RAIL = "#1b0e08", BRASS = "#e3b657", BRASS_DIM = "rgba(227,182,87,0.42)";
    const CREAM = "#f7edd9", LAMP = "#ffdda0";
    const INK_RED = "#ff5a53", INK_GREEN = "#67e2a4";
    const CARD_THEME = {
      face: "#f9f4e7", edge: "rgba(24,14,8,0.28)",
      red: "#bf1f31", black: "#16141f",
      back: "#14424c", backDeep: "#06212a",
    };
    const IDENT = [
      { name: "Amber",  ink: "#f5c542" },
      { name: "Sky",    ink: "#54cdf2" },
      { name: "Mint",   ink: "#4fe3a6" },
      { name: "Violet", ink: "#bb8dff" },
      { name: "Rose",   ink: "#ff819e" },
    ];
    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const SERIF = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";

    /* ===============================================================
     * SEATING
     *
     * Where people physically are around a phone lying flat. The long
     * sides take two each and the short ends take one, which is how a
     * rectangle actually gets sat around — so five is head-of-table
     * plus two a side, and four is one per edge.
     *
     * Order is clockwise from the near edge, because turn order has to
     * go round the table the way a real hand does. On screen (y down)
     * clockwise reads bottom, left, top, right.
     * ============================================================= */
    const SEATDEF = {
      bottom:   { rad: 0,            along: 238, key: "b" },
      top:      { rad: Math.PI,      along: 224, key: "t" },
      left:     { rad: Math.PI / 2,  along: 206, key: "l" },
      right:    { rad: -Math.PI / 2, along: 206, key: "r" },
      leftTop:  { rad: Math.PI / 2,  along: 178, key: "l" },
      leftLow:  { rad: Math.PI / 2,  along: 178, key: "l" },
      rightTop: { rad: -Math.PI / 2, along: 178, key: "r" },
      rightLow: { rad: -Math.PI / 2, along: 178, key: "r" },
    };
    const SEAT_SETS = {
      3: ["bottom", "left", "right"],
      4: ["bottom", "left", "top", "right"],
      5: ["bottom", "leftLow", "leftTop", "rightTop", "rightLow"],
    };
    const PAD_T = 68, PAD_GAP = 9;
    /** Which way each seat lies from the middle of the table, as a unit-ish
     *  vector. Used to draw the table as a diagram on the picked-up screen. */
    const SEAT_DIR = {
      bottom:   [0, 1],      top:      [0, -1],
      left:     [-1, 0],     right:    [1, 0],
      leftTop:  [-0.9, -0.5], leftLow: [-0.9, 0.5],
      rightTop: [0.9, -0.5],  rightLow: [0.9, 0.5],
    };

    /* ===============================================================
     * SETTINGS — remembered between sessions.
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("cheat") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 4, 3, 5),
      window: saved.window === undefined ? 1 : clamp(saved.window, 0, 2),
      hints: saved.hints === undefined ? 1 : (saved.hints ? 1 : 0),
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("cheat", settings); } catch (_) {} }
    const WINDOW_S = [3.0, 4.5, 6.0];
    let names = Array.isArray(saved.names) ? saved.names.slice(0, 5) : [];

    /* ===============================================================
     * SOUND — a low room tone that tightens the moment the phone goes
     * flat, and a cue on every beat that matters. All of it wrapped:
     * audio is a nicety and must never break a hand of cards.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "drone", volume: 0.26, tempo: 82, intensity: 0.2 });
      return {
        get muted() { return muted; },
        async unlock() {
          if (unlocked) return;
          unlocked = true;
          try { await ctx.music.unlock(); if (!muted) bed = start(); } catch (_) {}
        },
        sting(n) { if (!muted) { try { ctx.music.sting(n); } catch (_) {} } },
        duck(a, ms) { if (!muted) { try { ctx.music.duck(a, ms); } catch (_) {} } },
        heat(v) { if (!muted && bed) { try { bed.setIntensity(clamp(v, 0, 1)); } catch (_) {} } },
        haptic(k) { try { ctx.platform.haptic(k); } catch (_) {} },
        toggle() {
          muted = !muted;
          settings.mute = muted;
          saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 240 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ===============================================================
     * SURFACES
     *
     * Offscreen drawing surfaces are OffscreenCanvas, never
     * document.createElement("canvas") — the latter is rejected at
     * upload. Older WebViews have no OffscreenCanvas at all, so every
     * bake site returns null there and the caller paints live instead.
     * ============================================================= */
    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    }
    /**
     * willReadFrequently pins a bake surface to the CPU backend, which is what
     * a write-once blit source wants: a GPU-backed offscreen is read back
     * across the bus on every drawImage, and a hand of eighteen cards does
     * eighteen of those a frame.
     */
    function surfCtx(s) { return s.getContext("2d", { willReadFrequently: true }); }
    const BAKED = typeof OffscreenCanvas !== "undefined";

    function roundRect(g, x, y, w, h, r) {
      const k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      g.beginPath();
      g.moveTo(x + k, y);
      g.arcTo(x + w, y, x + w, y + h, k);
      g.arcTo(x + w, y + h, x, y + h, k);
      g.arcTo(x, y + h, x, y, k);
      g.arcTo(x, y, x + w, y, k);
      g.closePath();
    }

    /**
     * A soft drop shadow without the canvas blur filter.
     *
     * Writing g.filter = "blur(...)" is rejected at upload: the property also
     * accepts url(#…), so any write to it reads as pulling in a remote
     * resource. Stacked translucent fills give the same falloff for a fraction
     * of the cost, and they are the only shadows in the bit.
     */
    function dropShadow(g, w, h, r, lift) {
      g.fillStyle = "#000";
      for (let i = 5; i >= 1; i--) {
        const k = i / 5;
        const sp = (1.5 + lift * 15) * k;
        g.globalAlpha = 0.075 * (1 - k * 0.45);
        roundRect(g, -w / 2 - sp, -h / 2 - sp + 3 + lift * 11, w + sp * 2, h + sp * 2, r + sp * 0.6);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    /**
     * Letter-spaced small caps, measured by hand so it works on every engine.
     * The per-character widths are memoised: this runs on every pad every
     * frame and measureText is one of the few canvas calls that is not cheap.
     */
    const trackCache = new Map();
    // Set lowercase like the rest of the game. This helper draws one
    // character at a time for its own tracking, and single characters slip
    // past the case fold that every other canvas string goes through.
    function tracked(g, text, x, y, spacing) {
      text = typeof text === "string" ? text.toLowerCase() : text;
      const key = g.font + "|" + text + "|" + spacing;
      let plan = trackCache.get(key);
      if (!plan) {
        const chars = String(text).split("");
        const w = chars.map((c) => g.measureText(c).width);
        let total = -spacing;
        for (const v of w) total += v + spacing;
        plan = { chars, w, total };
        trackCache.set(key, plan);
      }
      let cx = x - plan.total / 2;
      g.textAlign = "left";
      for (let i = 0; i < plan.chars.length; i++) { g.fillText(plan.chars[i], cx, y); cx += plan.w[i] + spacing; }
      g.textAlign = "center";
    }

    /** #rrggbb plus an alpha, without dragging in a colour library. */
    function hexA(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a.toFixed(3) + ")";
    }

    /** Shrink a font until the string fits `max`, so no plaque ever overflows. */
    function fitFont(g, text, weight, px, family, max) {
      let size = px;
      g.font = weight + " " + size + "px " + family;
      let w = g.measureText(text).width;
      if (w > max) {
        size = Math.max(8, Math.floor(size * max / w));
        g.font = weight + " " + size + "px " + family;
      }
      return size;
    }

    /* ===============================================================
     * THE DECK — 52 faces drawn as canvas paths.
     *
     * There are no packaged assets, so pips, courts and the back are all
     * geometry. Each face is baked once at device scale and then
     * blitted, which keeps an eighteen-card hand to eighteen drawImage
     * calls instead of eighteen full repaints.
     * ============================================================= */
    const SUITS = [
      { id: "S", red: false }, { id: "H", red: true },
      { id: "D", red: true },  { id: "C", red: false },
    ];
    const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const RANK_ONE = ["ACE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN",
                      "EIGHT", "NINE", "TEN", "JACK", "QUEEN", "KING"];
    const RANK_MANY = ["ACES", "TWOS", "THREES", "FOURS", "FIVES", "SIXES", "SEVENS",
                       "EIGHTS", "NINES", "TENS", "JACKS", "QUEENS", "KINGS"];
    const COUNT_WORD = ["", "ONE", "TWO", "THREE", "FOUR"];
    const claimWords = (n, ri) => COUNT_WORD[n] + " " + (n === 1 ? RANK_ONE[ri] : RANK_MANY[ri]);

    /** Suit glyph as a path, unit-scaled to roughly [-1, 1]. */
    function suitPath(g, suit, x, y, s) {
      g.save();
      g.translate(x, y);
      g.scale(s, s);
      g.beginPath();
      if (suit === "H") {
        g.moveTo(0, 0.75);
        g.bezierCurveTo(-1.35, -0.15, -0.72, -1.05, 0, -0.45);
        g.bezierCurveTo(0.72, -1.05, 1.35, -0.15, 0, 0.75);
      } else if (suit === "D") {
        g.moveTo(0, -0.95); g.lineTo(0.68, 0); g.lineTo(0, 0.95); g.lineTo(-0.68, 0);
      } else if (suit === "S") {
        g.moveTo(0, -0.95);
        g.bezierCurveTo(0.95, 0.05, 1.15, 0.62, 0.42, 0.62);
        g.bezierCurveTo(0.16, 0.62, 0.08, 0.48, 0.08, 0.4);
        g.lineTo(0.3, 0.95); g.lineTo(-0.3, 0.95); g.lineTo(-0.08, 0.4);
        g.bezierCurveTo(-0.08, 0.48, -0.16, 0.62, -0.42, 0.62);
        g.bezierCurveTo(-1.15, 0.62, -0.95, 0.05, 0, -0.95);
      } else {
        g.arc(0, -0.42, 0.38, 0, TAU);
        g.closePath(); g.moveTo(-0.28, 0.22);
        g.arc(-0.42, 0.16, 0.38, 0, TAU);
        g.closePath(); g.moveTo(0.8, 0.16);
        g.arc(0.42, 0.16, 0.38, 0, TAU);
        g.closePath();
        g.moveTo(0.09, 0.2); g.lineTo(0.3, 0.95); g.lineTo(-0.3, 0.95); g.lineTo(-0.09, 0.2);
      }
      g.closePath();
      g.fill();
      g.restore();
    }

    /** Pip layout per rank, in card-relative units where x and y are in [-1, 1]. */
    const PIPS = {
      A: [[0, 0]],
      2: [[0, -0.62], [0, 0.62]],
      3: [[0, -0.62], [0, 0], [0, 0.62]],
      4: [[-0.5, -0.62], [0.5, -0.62], [-0.5, 0.62], [0.5, 0.62]],
      5: [[-0.5, -0.62], [0.5, -0.62], [0, 0], [-0.5, 0.62], [0.5, 0.62]],
      6: [[-0.5, -0.62], [0.5, -0.62], [-0.5, 0], [0.5, 0], [-0.5, 0.62], [0.5, 0.62]],
      7: [[-0.5, -0.62], [0.5, -0.62], [0, -0.31], [-0.5, 0], [0.5, 0], [-0.5, 0.62], [0.5, 0.62]],
      8: [[-0.5, -0.62], [0.5, -0.62], [0, -0.31], [-0.5, 0], [0.5, 0], [0, 0.31], [-0.5, 0.62], [0.5, 0.62]],
      9: [[-0.5, -0.68], [0.5, -0.68], [-0.5, -0.23], [0.5, -0.23], [0, 0],
          [-0.5, 0.23], [0.5, 0.23], [-0.5, 0.68], [0.5, 0.68]],
      10: [[-0.5, -0.68], [0.5, -0.68], [0, -0.45], [-0.5, -0.23], [0.5, -0.23],
           [-0.5, 0.23], [0.5, 0.23], [0, 0.45], [-0.5, 0.68], [0.5, 0.68]],
    };

    /**
     * A court card.
     *
     * Real courts are mirrored half-portraits and a literal one turns to mud at
     * the sixty pixels a hand of eighteen gives a card. This is a single flat
     * heraldic figure — crown, face, mantle — reading as King, Queen or Jack
     * purely by its headwear, with the suit colour carrying everything else.
     */
    function drawCourt(g, rank, suitId, ink, w, h) {
      const cx = w * 0.5, cy = h * 0.5;
      const iw = w * 0.66, ih = h * 0.60;
      const x0 = cx - iw / 2, y0 = cy - ih / 2;

      roundRect(g, x0, y0, iw, ih, w * 0.045);
      g.fillStyle = "rgba(0,0,0,0.035)"; g.fill();
      g.strokeStyle = ink; g.lineWidth = Math.max(1, w * 0.016); g.stroke();
      roundRect(g, x0 + w * 0.028, y0 + w * 0.028, iw - w * 0.056, ih - w * 0.056, w * 0.03);
      g.strokeStyle = ink; g.lineWidth = Math.max(0.6, w * 0.007); g.stroke();

      g.save();
      roundRect(g, x0 + w * 0.028, y0 + w * 0.028, iw - w * 0.056, ih - w * 0.056, w * 0.03);
      g.clip();

      const fx = cx, fy = cy + ih * 0.03;
      const u = iw * 0.5;

      g.fillStyle = ink;
      g.beginPath();
      g.moveTo(fx - u * 0.86, y0 + ih);
      g.quadraticCurveTo(fx - u * 0.74, fy + u * 0.16, fx - u * 0.30, fy + u * 0.06);
      g.lineTo(fx + u * 0.30, fy + u * 0.06);
      g.quadraticCurveTo(fx + u * 0.74, fy + u * 0.16, fx + u * 0.86, y0 + ih);
      g.closePath();
      g.fill();

      g.fillStyle = "rgba(250,246,236,0.94)";
      g.beginPath();
      g.moveTo(fx - u * 0.26, fy + u * 0.07);
      g.lineTo(fx, fy + u * 0.42);
      g.lineTo(fx + u * 0.26, fy + u * 0.07);
      g.closePath();
      g.fill();

      // The suit is knocked out of the mantle: drawn in ink it would be
      // ink-on-ink and vanish at this size.
      g.fillStyle = "rgba(250,246,236,0.93)";
      suitPath(g, suitId, fx, fy + u * 0.68, u * 0.25);

      g.fillStyle = "rgba(250,246,236,0.96)";
      g.beginPath();
      g.ellipse(fx, fy - u * 0.30, u * 0.28, u * 0.34, 0, 0, TAU);
      g.fill();
      g.strokeStyle = ink; g.lineWidth = Math.max(0.7, w * 0.009); g.stroke();

      // Two dots and a line is the whole difference between a court card and a
      // hooded silhouette at this size.
      g.fillStyle = ink;
      for (const ex of [-0.115, 0.115]) {
        g.beginPath(); g.ellipse(fx + u * ex, fy - u * 0.36, u * 0.036, u * 0.045, 0, 0, TAU); g.fill();
      }
      g.beginPath();
      g.moveTo(fx - u * 0.09, fy - u * 0.18);
      g.quadraticCurveTo(fx, fy - u * 0.13, fx + u * 0.09, fy - u * 0.18);
      g.lineWidth = Math.max(0.8, w * 0.010);
      g.strokeStyle = ink; g.stroke();
      if (rank === "K") {
        g.beginPath();
        g.moveTo(fx - u * 0.26, fy - u * 0.24);
        g.quadraticCurveTo(fx, fy + u * 0.22, fx + u * 0.26, fy - u * 0.24);
        g.quadraticCurveTo(fx, fy - u * 0.06, fx - u * 0.26, fy - u * 0.24);
        g.closePath(); g.fill();
      } else if (rank === "Q") {
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(fx + s * u * 0.26, fy - u * 0.50);
          g.quadraticCurveTo(fx + s * u * 0.46, fy - u * 0.10, fx + s * u * 0.30, fy + u * 0.10);
          g.quadraticCurveTo(fx + s * u * 0.30, fy - u * 0.20, fx + s * u * 0.24, fy - u * 0.42);
          g.closePath(); g.fill();
        }
      }

      g.fillStyle = ink;
      const hy = fy - u * 0.74;
      if (rank === "K") {
        g.beginPath();
        g.moveTo(fx - u * 0.42, hy + u * 0.20);
        g.lineTo(fx - u * 0.42, hy - u * 0.06);
        g.lineTo(fx - u * 0.21, hy + u * 0.10);
        g.lineTo(fx, hy - u * 0.26);
        g.lineTo(fx + u * 0.21, hy + u * 0.10);
        g.lineTo(fx + u * 0.42, hy - u * 0.06);
        g.lineTo(fx + u * 0.42, hy + u * 0.20);
        g.closePath(); g.fill();
        g.fillRect(fx - u * 0.05, hy - u * 0.54, u * 0.10, u * 0.26);
        g.fillRect(fx - u * 0.17, hy - u * 0.45, u * 0.34, u * 0.09);
      } else if (rank === "Q") {
        g.beginPath();
        g.moveTo(fx - u * 0.40, hy + u * 0.20);
        g.lineTo(fx - u * 0.34, hy - u * 0.10);
        g.lineTo(fx - u * 0.12, hy + u * 0.06);
        g.lineTo(fx, hy - u * 0.16);
        g.lineTo(fx + u * 0.12, hy + u * 0.06);
        g.lineTo(fx + u * 0.34, hy - u * 0.10);
        g.lineTo(fx + u * 0.40, hy + u * 0.20);
        g.closePath(); g.fill();
        for (const px of [-0.34, 0, 0.34]) {
          g.beginPath(); g.arc(fx + u * px, hy - u * 0.16, u * 0.065, 0, TAU); g.fill();
        }
      } else {
        g.beginPath();
        g.moveTo(fx - u * 0.38, hy + u * 0.20);
        g.quadraticCurveTo(fx - u * 0.40, hy - u * 0.20, fx + u * 0.06, hy - u * 0.20);
        g.quadraticCurveTo(fx + u * 0.40, hy - u * 0.18, fx + u * 0.38, hy + u * 0.20);
        g.closePath(); g.fill();
        g.beginPath();
        g.moveTo(fx + u * 0.22, hy - u * 0.14);
        g.quadraticCurveTo(fx + u * 0.66, hy - u * 0.52, fx + u * 0.50, hy + u * 0.04);
        g.quadraticCurveTo(fx + u * 0.40, hy - u * 0.12, fx + u * 0.22, hy - u * 0.14);
        g.closePath(); g.fill();
      }
      g.restore();
    }

    /** Paint one card face at (0,0) into whatever context it is handed. */
    function paintCardFace(g, rank, suitId, w, h) {
      const suit = SUITS.find((s) => s.id === suitId);
      const ink = suit.red ? CARD_THEME.red : CARD_THEME.black;
      const r = Math.min(w, h) * 0.085;

      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      const paper = g.createLinearGradient(0, 0, w * 0.35, h);
      paper.addColorStop(0, "#fffdf7");
      paper.addColorStop(0.55, CARD_THEME.face);
      paper.addColorStop(1, "#ece3ce");
      g.fillStyle = paper; g.fill();
      g.strokeStyle = CARD_THEME.edge; g.lineWidth = Math.max(1, w * 0.008); g.stroke();

      roundRect(g, w * 0.035, h * 0.025, w * 0.93, h * 0.95, r * 0.72);
      g.strokeStyle = "rgba(30,22,14,0.075)"; g.lineWidth = Math.max(0.6, w * 0.006); g.stroke();

      // Corner index, mirrored into the far corner so the card reads from
      // either end the way a real one does. In a fanned hand the top-left
      // index is often all you can see, so it is deliberately large.
      const cs = w * 0.175;
      const corner = (flip) => {
        g.save();
        if (flip) { g.translate(w, h); g.rotate(Math.PI); }
        g.fillStyle = ink;
        g.font = "700 " + cs + "px " + SERIF;
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.fillText(rank, w * 0.148, h * 0.145);
        suitPath(g, suitId, w * 0.148, h * 0.222, cs * 0.42);
        g.restore();
      };
      corner(false); corner(true);

      const cx = w * 0.5, cy = h * 0.5;
      if (PIPS[rank]) {
        const dense = rank === "9" || rank === "10";
        const px = w * 0.30;
        const py = h * (dense ? 0.355 : 0.335);
        const ps = w * (dense ? 0.080 : 0.115);
        for (const [ux, uy] of PIPS[rank]) {
          g.save();
          g.translate(cx + ux * px, cy + uy * py);
          if (uy > 0.05) g.rotate(Math.PI);
          g.fillStyle = ink;
          suitPath(g, suitId, 0, 0, ps);
          g.restore();
        }
      } else {
        drawCourt(g, rank, suitId, ink, w, h);
      }
    }

    /** Paint the card back at (0,0): deep teal guilloché under a brass frame. */
    function paintCardBack(g, w, h) {
      const r = Math.min(w, h) * 0.085;
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      const base = g.createLinearGradient(0, 0, w, h);
      base.addColorStop(0, "#1b5a66");
      base.addColorStop(0.55, CARD_THEME.back);
      base.addColorStop(1, CARD_THEME.backDeep);
      g.fillStyle = base; g.fill();

      g.save();
      roundRect(g, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g.clip();
      g.strokeStyle = "rgba(196,240,236,0.12)";
      g.lineWidth = Math.max(0.7, w * 0.011);
      const step = w * 0.115;
      for (let i = -h; i < w + h; i += step) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
        g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
      }
      // Centre medallion: a brass lozenge with the four suits around it, which
      // is what stops the lattice from reading as wallpaper.
      g.translate(w / 2, h / 2);
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.beginPath();
      g.moveTo(0, -h * 0.20); g.lineTo(w * 0.20, 0); g.lineTo(0, h * 0.20); g.lineTo(-w * 0.20, 0);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(227,182,87,0.60)"; g.lineWidth = Math.max(1, w * 0.012); g.stroke();
      g.fillStyle = "rgba(227,182,87,0.72)";
      suitPath(g, "S", 0, -h * 0.085, w * 0.052);
      suitPath(g, "H", 0, h * 0.085, w * 0.052);
      suitPath(g, "D", -w * 0.095, 0, w * 0.052);
      suitPath(g, "C", w * 0.095, 0, w * 0.052);
      g.restore();

      roundRect(g, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g.strokeStyle = "rgba(240,214,160,0.46)"; g.lineWidth = Math.max(1, w * 0.016); g.stroke();
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      g.strokeStyle = "rgba(0,0,0,0.34)"; g.lineWidth = Math.max(1, w * 0.008); g.stroke();
    }

    /** Bake all 52 faces plus the back once, then blit for the rest of the run. */
    function makeDeckArt(w, h, scale) {
      const faces = {};
      for (const s of SUITS) {
        for (const r of RANKS) {
          const surf = surface(w * scale, h * scale);
          if (!surf) return null;
          const c = surfCtx(surf);
          c.scale(scale, scale);
          paintCardFace(c, r, s.id, w, h);
          faces[r + s.id] = surf;
        }
      }
      const bs = surface(w * scale, h * scale);
      if (!bs) return null;
      const bg = surfCtx(bs);
      bg.scale(scale, scale);
      paintCardBack(bg, w, h);
      return { faces, back: bs };
    }

    /** Deterministic rng, so a deal can be replayed exactly in a harness run. */
    function makeRng(seed) {
      let s = seed >>> 0 || 1;
      return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296;
      };
    }

    /** A shuffled 52-card deck. */
    function freshDeck(rng) {
      const d = [];
      for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s.id, red: s.red, id: r + s.id });
      for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = d[i]; d[i] = d[j]; d[j] = t;
      }
      return d;
    }

    /** By rank, then suit. A hand you cannot read is a hand you misplay. */
    function sortHand(hand) {
      const so = { S: 0, H: 1, D: 2, C: 3 };
      hand.sort((a, b) => (RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)) || (so[a.suit] - so[b.suit]));
    }

    /* ===============================================================
     * CANVAS + LAYOUT
     * ============================================================= */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    /* Two different numbers that must not be confused.
     *
     * `bake` caps how much resolution the offscreen card art is drawn at — a
     * memory choice, and 2x is already past what the eye resolves at this
     * size. `dpr` is the scale the runtime used to size the real canvas
     * buffer, so any transform written onto that buffer has to match it
     * exactly. Using the capped one for the transform on a 3x phone draws
     * every frame at two-thirds scale into the top-left corner and leaves
     * the rest of the screen empty. */
    const dpr = ctx.dpr || 1;
    const bake = Math.min(dpr, 2);
    let W = ctx.width, H = ctx.height;

    const CARD_W = 100, CARD_H = 140, CARD_R = 9, SHADOW_PAD = 22;
    const TABLE_S = 0.90, PILE_S = 0.86, REVEAL_S = 0.76;
    const MAX_ROW = 7, PICK_MAX = 4;
    const art = makeDeckArt(CARD_W, CARD_H, bake);

    /**
     * The card shadow, baked once. Live it is five stacked translucent fills
     * per card, and an eighteen-card hand is ninety anti-aliased fills a
     * frame — it dominated the budget. Baked it is one blit, and being one-off
     * it can afford sixteen steps instead of five, so the falloff is smoother
     * than the live version ever was.
     */
    const shadowArt = (function () {
      const sw = CARD_W + SHADOW_PAD * 2, sh = CARD_H + SHADOW_PAD * 2;
      const s = surface(sw * bake, sh * bake);
      if (!s) return null;
      const c = surfCtx(s);
      c.scale(bake, bake);
      c.fillStyle = "#000";
      for (let i = 16; i >= 1; i--) {
        const k = i / 16;
        const sp = SHADOW_PAD * k;
        c.globalAlpha = 0.024;
        roundRect(c, SHADOW_PAD - sp, SHADOW_PAD - sp, CARD_W + sp * 2, CARD_H + sp * 2, CARD_R + sp * 0.7);
        c.fill();
      }
      return s;
    })();

    const L = { pads: {} };
    function layout() {
      W = ctx.width; H = ctx.height;
      const st = ctx.safeArea.top, sb = ctx.safeArea.bottom;
      const n = players.length || settings.players;
      const seats = SEAT_SETS[clamp(n, 3, 5)];

      /* --- the flat-on-the-table view ---
       *
       * The top band is reserved whether or not anybody is sitting in it, so
       * the pile, the ring and the plaques land in exactly the same place at
       * three, four and five players. Letting the table drift upward when the
       * far seat is empty made the whole composition top-heavy and left the
       * bottom third of the screen holding one lonely pad. ---- */
      L.tableTop = st + PAD_GAP + PAD_T + 8;
      L.tableBot = H - sb - PAD_GAP - PAD_T - 8;
      L.cx = W / 2;
      L.cy = (L.tableTop + L.tableBot) / 2;
      // Nothing may sit in the side margins: a pad column mounted beside the
      // pile would be seven pixels wide. The play area is the band between the
      // side pads, and the pile is sized to that band.
      L.bandW = W - 2 * (PAD_GAP + PAD_T);
      L.ringR = Math.min(L.bandW / 2 - 4, (L.tableBot - L.tableTop) / 2 - 26, 118);

      // Where the claim and the verdict are posted: outside the ring, in the
      // slot above and below the pile. How wide they may be depends on whether
      // the side seats reach that far up the screen — with five players the
      // long sides carry two pads each and the plaque has to stay inside the
      // band between them, where with three or four it can run nearly edge to
      // edge. A fixed width covers somebody's call button at one seat count
      // and looks starved at the other.
      L.plaqueY = L.ringR + 54;
      let reach = 0;
      for (const seat of seats) {
        const d = SEATDEF[seat];
        if (d.key !== "l" && d.key !== "r") continue;
        const off = /Top$/.test(seat) ? 104 : /Low$/.test(seat) ? 104 : 0;
        reach = Math.max(reach, off + d.along / 2);
      }
      L.plaqueW = (L.plaqueY - 44 > reach) ? Math.min(W - 44, 300) : L.bandW - 10;

      L.pads = {};
      for (const seat of seats) {
        const d = SEATDEF[seat];
        if (seat === "bottom") {
          L.pads[seat] = { x: W / 2 - d.along / 2, y: H - sb - PAD_GAP - PAD_T, w: d.along, h: PAD_T };
        } else if (seat === "top") {
          // Shifted off centre so the chrome column can live in the corner
          // without covering anybody's call button.
          L.pads[seat] = { x: W * 0.40 - d.along / 2, y: st + PAD_GAP, w: d.along, h: PAD_T };
        } else {
          const off = /Top$/.test(seat) ? -104 : /Low$/.test(seat) ? 104 : 0;
          const x = seat.charAt(0) === "l" ? PAD_GAP : W - PAD_GAP - PAD_T;
          L.pads[seat] = { x, y: L.cy + off - d.along / 2, w: PAD_T, h: d.along };
        }
      }

      /* --- the picked-up, one-person view ---
       *
       * Header, then the table drawn as a small diagram, then the hand held
       * low where a thumb already is, then the commit plaque under it. The
       * diagram is what fills the middle: a thirteen-card hand needs only two
       * rows, and without it the screen is a strip of chrome floating over an
       * acre of empty cloth. ---- */
      L.hdrY = st + 10;
      L.hdrH = 86;
      L.commitH = 60;
      L.commit = { x: 24, y: H - sb - 24 - L.commitH, w: W - 48, h: L.commitH };
      L.handTop = L.hdrY + L.hdrH + 14;
      L.handBot = L.commit.y - 12;
    }

    /* ===============================================================
     * THE ROOM — baked once, blitted every frame.
     *
     * Old cloth under one hot lamp: a weave tile and a noise tile beneath
     * a warm pool, loose fibres, a printed layout ring, a walnut rail and
     * a brass inlay. One drawImage a frame for the whole background.
     * ============================================================= */
    function weaveTile() {
      const s = surface(6, 6);
      if (!s) return null;
      const c = surfCtx(s);
      c.fillStyle = "rgba(255,255,255,0.30)";
      c.fillRect(0, 0, 3, 3); c.fillRect(3, 3, 3, 3);
      c.fillStyle = "rgba(0,0,0,0.34)";
      c.fillRect(3, 0, 3, 1); c.fillRect(0, 3, 3, 1);
      c.fillRect(0, 0, 1, 3); c.fillRect(3, 3, 1, 3);
      return s;
    }
    function noiseTile() {
      const s = surface(96, 96);
      if (!s) return null;
      const c = surfCtx(s);
      const img = c.createImageData(96, 96);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 80 + Math.random() * 175;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      return s;
    }
    const WEAVE = weaveTile(), NOISE = noiseTile();

    function paintRoom(c, rich, poolY) {
      const py = poolY === undefined ? L.cy - H * 0.045 : poolY;
      const pool = c.createRadialGradient(L.cx, py, 8, L.cx, py, Math.max(W, H) * 0.66);
      pool.addColorStop(0.00, FELT_LIT);
      pool.addColorStop(0.22, "#5b291f");
      pool.addColorStop(0.48, FELT_MID);
      pool.addColorStop(0.78, "#150907");
      pool.addColorStop(1.00, FELT_DARK);
      c.fillStyle = pool;
      c.fillRect(0, 0, W, H);

      if (rich && WEAVE) {
        c.save();
        c.globalAlpha = 0.22;
        c.globalCompositeOperation = "overlay";
        c.fillStyle = c.createPattern(WEAVE, "repeat");
        c.fillRect(0, 0, W, H);
        c.restore();
      }
      if (rich && NOISE) {
        c.save();
        c.globalAlpha = 0.12;
        c.globalCompositeOperation = "overlay";
        c.fillStyle = c.createPattern(NOISE, "repeat");
        c.fillRect(0, 0, W, H);
        c.restore();
      }
      if (rich) {
        // Loose fibres. Cloth is never uniform, and a scatter of lit and
        // shadowed specks is what stops a gradient from reading as plastic.
        c.save();
        for (let i = 0; i < 1500; i++) {
          const x = Math.random() * W, y = Math.random() * H;
          const lit = Math.random() < 0.5;
          c.globalAlpha = (lit ? 0.055 : 0.06) * (1 - Math.hypot(x - L.cx, y - py) / Math.max(W, H));
          c.fillStyle = lit ? "#ffd9b4" : "#000000";
          c.fillRect(x, y, 1 + Math.random() * 1.7, 1);
        }
        c.restore();
      }

      // The lamp pool. A stack of translucent discs bands visibly at this
      // size, so the falloff is a real radial gradient instead.
      c.save();
      c.globalCompositeOperation = "lighter";
      const bloom = c.createRadialGradient(L.cx, py, 0, L.cx, py, Math.max(W, H) * 0.50);
      bloom.addColorStop(0.00, "rgba(255,214,150,0.22)");
      bloom.addColorStop(0.30, "rgba(255,201,132,0.085)");
      bloom.addColorStop(0.66, "rgba(255,196,128,0.02)");
      bloom.addColorStop(1.00, "rgba(255,196,128,0)");
      c.fillStyle = bloom;
      c.fillRect(0, 0, W, H);
      c.restore();

      const vig = c.createRadialGradient(L.cx, py, Math.min(W, H) * 0.22, L.cx, py, Math.max(W, H) * 0.68);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.70)");
      c.fillStyle = vig;
      c.fillRect(0, 0, W, H);

      c.strokeStyle = RAIL;
      c.lineWidth = 18;
      c.strokeRect(-9, -9, W + 18, H + 18);
      c.lineWidth = 9;
      c.strokeStyle = "rgba(0,0,0,0.50)";
      c.strokeRect(-4.5, -4.5, W + 9, H + 9);
      roundRect(c, 10.5, 10.5, W - 21, H - 21, 16);
      c.strokeStyle = "rgba(227,182,87,0.14)";
      c.lineWidth = 1.2;
      c.stroke();
    }

    /**
     * The printed layout ring. It is drawn live rather than baked into the
     * cloth because the picked-up screen uses the same background and a ring
     * floating behind somebody's hand reads as a rendering fault, not as a
     * marking on a table nobody is looking down at.
     */
    function drawLayoutRing() {
      g.save();
      g.translate(L.cx, L.cy);
      g.strokeStyle = "rgba(255,232,196,0.055)";
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, L.ringR, 0, TAU); g.stroke();
      g.lineWidth = 1;
      g.beginPath(); g.arc(0, 0, L.ringR + 6, 0, TAU); g.stroke();
      g.strokeStyle = "rgba(0,0,0,0.14)";
      g.beginPath(); g.arc(0, 0, L.ringR + 2.5, 0, TAU); g.stroke();
      g.restore();
    }

    let room = null, roomKey = "";
    function bakeRoom() {
      const key = W + "x" + H + ":" + Math.round(L.cy);
      if (room && key === roomKey) return;
      const s = surface(W * bake, H * bake);
      if (!s) { room = null; return; }
      const c = surfCtx(s);
      c.scale(bake, bake);
      paintRoom(c, true);
      room = s; roomKey = key;
    }

    /* ===============================================================
     * STATE
     * ============================================================= */
    let phase = "menu";     // menu | deal | cover | place | settle | challenge | reveal | verdict | over
    let players = [];
    let pile = [];          // {card, up, ox, oy, rot, flip0}
    let turn = 0, rankIdx = 0, turnNo = 0;
    let claim = null;       // {by, rank, ri, n, lie, emptied}
    const picked = [];      // hand indices, in the order they were chosen
    let challengeOpen = false, challengeT = 0, challengeLen = WINDOW_S[settings.window];
    let caller = -1, revealT = 0, revealN = 0, verdictT = 0, settleT = 0, dealT = 0;
    let bluffRun = 0, bestRun = 0, callsRight = 0, callsWrong = 0, biggestPile = 0;
    let winner = null, banner = null, matchStart = 0, pendingTake = null;
    let shake = 0, sheetOpen = false, sheetSince = 0;
    const flash = { a: 0, ink: "#fff" };
    let handRows = [];      // [[i,...], ...] cached row plan for the hand

    layout();
    bakeRoom();

    function busy() {
      return phase === "deal" || phase === "settle" || phase === "reveal" ||
             phase === "verdict" || flyers.length > 0;
    }

    /* ===============================================================
     * PARTICLES, DUST AND FLYING CARDS
     * ============================================================= */
    const parts = [];
    for (let i = 0; i < 120; i++) parts.push({ life: 0 });
    let partI = 0;
    function spawnPart(x, y, o) {
      const p = parts[partI = (partI + 1) % parts.length];
      p.x = x; p.y = y;
      p.vx = o.vx; p.vy = o.vy;
      p.gr = o.gr === undefined ? 620 : o.gr;
      p.drag = o.drag === undefined ? 0.985 : o.drag;
      p.life = p.max = o.life;
      p.col = o.col; p.kind = o.kind || "spark";
      p.size = o.size; p.rot = Math.random() * TAU; p.vr = (Math.random() - 0.5) * 14;
    }
    function burst(x, y, ink, n, power) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = power * (0.35 + Math.random());
        const shard = Math.random() < 0.45;
        spawnPart(x, y, {
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.35,
          life: 0.42 + Math.random() * 0.55,
          col: shard ? (Math.random() < 0.55 ? CREAM : ink) : (Math.random() < 0.5 ? BRASS : ink),
          kind: shard ? "shard" : "spark",
          size: shard ? 5 + Math.random() * 7 : 1.6 + Math.random() * 2.4,
        });
      }
    }
    function puff(x, y) {
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * TAU;
        spawnPart(x, y, {
          vx: Math.cos(a) * 40, vy: Math.sin(a) * 24 - 8, gr: 36, drag: 0.90,
          life: 0.26 + Math.random() * 0.2, col: "rgba(255,224,178,0.45)", kind: "spark",
          size: 2 + Math.random() * 3,
        });
      }
    }
    function stepParts(dt) {
      for (const p of parts) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += p.gr * dt;
        p.vx *= p.drag; p.vy *= p.drag;
        p.rot += p.vr * dt;
      }
    }

    // Motes turning over in the beam. Fourteen of them, drifting upward and
    // wrapping — the cheapest possible way to say "there is air in this room".
    const motes = [];
    for (let i = 0; i < 14; i++) {
      motes.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.5,
                   v: 4 + Math.random() * 10, ph: Math.random() * TAU });
    }

    const flyers = [];
    function fly(o) { if (flyers.length < 26) flyers.push(o); }
    function stepFlyers(now) {
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i];
        if (now - f.t0 >= f.dur) {
          if (f.onDone) f.onDone();
          flyers.splice(i, 1);
        }
      }
    }

    /* ===============================================================
     * GAME
     * ============================================================= */
    function makePlayers(n) {
      const seats = SEAT_SETS[clamp(n, 3, 5)];
      return seats.map((seat, i) => ({
        seat, rad: SEATDEF[seat].rad,
        name: (names[i] || "").trim() || IDENT[i].name,
        ink: IDENT[i].ink,
        hand: [], press: 0, flashT: 0, callT: 0,
      }));
    }

    function newMatch() {
      players = makePlayers(settings.players);
      layout();
      bakeRoom();
      const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
      const deck = freshDeck(rng);
      for (let i = 0; i < deck.length; i++) players[i % players.length].hand.push(deck[i]);
      for (const p of players) sortHand(p.hand);

      pile = [];
      pendingTake = null;
      turn = 0; rankIdx = 0; turnNo = 0;
      claim = null; picked.length = 0; caller = -1;
      bluffRun = 0; bestRun = 0; callsRight = 0; callsWrong = 0; biggestPile = 0;
      winner = null; banner = null; shake = 0; flash.a = 0;
      flyers.length = 0;
      for (const p of parts) p.life = 0;
      challengeLen = WINDOW_S[settings.window];
      matchStart = performance.now();
      dealT = 0;
      phase = "deal";
      sound.heat(0.2);

      // The deal is decorative — the hands are already correct. Committing
      // state first and animating afterwards is the only ordering that cannot
      // desync, and the busy flag is what stops a tap landing mid-flight.
      const now = performance.now();
      // Five rounds of cards, not the real eleven: the flyer pool is capped
      // and a five-handed deal would silently drop half of them, leaving two
      // seats visibly short-changed.
      for (let k = 0; k < 5; k++) {
        for (let i = 0; i < players.length; i++) {
          const t = padCentre(players[i].seat);
          fly({
            card: null, up: false, t0: now + (k * players.length + i) * 42, dur: 330,
            x0: L.cx, y0: L.cy, r0: -0.04, s0: TABLE_S,
            x1: t.x, y1: t.y, r1: players[i].rad + (Math.random() - 0.5) * 0.5, s1: 0.30,
          });
        }
      }
    }

    function padCentre(seat) {
      const r = L.pads[seat];
      if (!r) return { x: L.cx, y: L.cy };
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }

    /** Start a turn: cover up, name who should be holding the phone. */
    function beginTurn() {
      picked.length = 0;
      caller = -1;
      phase = "cover";
      planHand();
      const p = players[turn];
      shell.el("cover-turn").textContent = "Turn " + (turnNo + 1);
      shell.el("cover-name").textContent = p.name;
      shell.el("cover-name").style.color = p.ink;
      shell.el("cover-claim").textContent = RANK_MANY[rankIdx];
      shell.el("cover-claim").style.color = p.ink;
      shell.el("cover-btn").textContent = "I’m " + p.name + " — show my hand";
      shell.el("cover-btn").style.background =
        "linear-gradient(180deg," + hexA(p.ink, 1) + "," + hexA(p.ink, 0.70) + ")";
      shell.el("cover-table").innerHTML = players.map((q, i) =>
        '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;' +
          'border-radius:11px;font-size:11.5px;background:' +
          (i === turn ? hexA(q.ink, 0.16) : "rgba(255,255,255,0.045)") + ';' +
          'box-shadow:inset 0 0 0 1px ' + hexA(q.ink, i === turn ? 0.55 : 0.20) + ';">' +
          '<span style="width:7px;height:7px;border-radius:50%;background:' + q.ink + ';"></span>' +
          '<span style="opacity:' + (i === turn ? "0.95" : "0.68") + ';">' + esc(q.name) + '</span>' +
          '<b style="font-weight:800;">' + q.hand.length + '</b>' +
        '</span>').join("");
      shell.el("cover-pile").textContent = pile.length === 0
        ? "the pile is empty"
        : pile.length + (pile.length === 1 ? " card on the pile" : " cards on the pile");
      shell.el("cover").style.display = "flex";
      sound.heat(0.18);
    }

    function reveal() {
      shell.el("cover").style.display = "none";
      phase = "place";
      planHand();
      sound.sting("tap");
      sound.haptic("light");
    }

    /** Row plan for the current holder's hand, recomputed when it changes. */
    function planHand() {
      const p = players[turn];
      if (!p) { handRows = []; return; }
      const n = p.hand.length;
      const rows = Math.max(1, Math.ceil(n / MAX_ROW));
      const base = Math.floor(n / rows), extra = n % rows;
      handRows = [];
      let k = 0;
      for (let r = 0; r < rows; r++) {
        const c = base + (r < extra ? 1 : 0);
        const row = [];
        for (let i = 0; i < c; i++) row.push(k++);
        handRows.push(row);
      }
    }

    /**
     * How big the held cards are drawn.
     *
     * A thirteen-card hand needs two rows and a nineteen-card hand needs
     * three, and one fixed size makes the short hand float in an acre of
     * empty cloth. The scale follows the row count instead, so the hand
     * always fills the band it is given.
     */
    function handScale() { return handRows.length >= 3 ? 0.63 : 0.76; }

    /** The top of the hand block, which is also the floor of the diagram. */
    function handTopY() {
      const rows = handRows.length || 1;
      const pitch = Math.min(CARD_H * handScale() + 14, (L.handBot - L.handTop) / rows);
      return L.handBot - pitch * rows;
    }

    /** Where card `i` of the holder's hand sits on screen. */
    function handSlot(i) {
      const sc = handScale();
      const cw = CARD_W * sc, ch = CARD_H * sc;
      const rows = handRows.length || 1;
      const band = L.handBot - L.handTop;
      const pitch = Math.min(ch + 14, band / rows);
      // Anchored to the bottom of the band, not centred in it: cards are held
      // low, and the commit plaque is directly under the last row where a
      // thumb already is.
      const y0 = L.handBot - pitch * rows + pitch / 2;
      for (let r = 0; r < handRows.length; r++) {
        const row = handRows[r];
        const at = row.indexOf(i);
        if (at < 0) continue;
        const step = Math.min(cw * 0.74, (W - 26 - cw) / Math.max(1, row.length - 1));
        const span = (row.length - 1) * step;
        return { x: W / 2 - span / 2 + at * step, y: y0 + r * pitch, r, at };
      }
      return { x: W / 2, y: L.handBot - 50, r: 0, at: 0 };
    }

    /**
     * Which card a finger picked.
     *
     * Scanned in reverse draw order, because cards inside a row overlap by two
     * thirds: aiming at the visible middle of a card would otherwise land on
     * the neighbour drawn over it, and a player who reaches for the card they
     * can plainly see would get a different one.
     */
    function handHit(x, y) {
      const p = players[turn];
      if (!p) return -1;
      const sc = handScale();
      const cw = CARD_W * sc, ch = CARD_H * sc;
      for (let r = handRows.length - 1; r >= 0; r--) {
        const row = handRows[r];
        for (let k = row.length - 1; k >= 0; k--) {
          const i = row[k];
          const s = handSlot(i);
          const lift = picked.indexOf(i) >= 0 ? 18 : 0;
          if (Math.abs(x - s.x) <= cw / 2 + 1 && Math.abs(y - (s.y - lift)) <= ch / 2 + 2) return i;
        }
      }
      return -1;
    }

    function togglePick(i) {
      const at = picked.indexOf(i);
      if (at >= 0) {
        picked.splice(at, 1);
        sound.sting("tap");
        sound.haptic("light");
        return;
      }
      if (picked.length >= PICK_MAX) {
        // Four is the hard ceiling of the game, so the fourth card is not
        // silently swapped out — the oldest is dropped and said so.
        const drop = picked.shift();
        const s = handSlot(drop);
        puff(s.x, s.y);
      }
      picked.push(i);
      const s = handSlot(i);
      puff(s.x, s.y - 18);
      sound.sting("tap");
      sound.haptic("light");
    }

    /** Commit the cards face down and hand the phone back to the table. */
    function commit() {
      const p = players[turn];
      if (!picked.length) return;
      const idx = picked.slice().sort((a, b) => b - a);
      const cards = idx.map((i) => p.hand[i]).reverse();
      for (const i of idx) p.hand.splice(i, 1);
      picked.length = 0;
      planHand();

      const now = performance.now();
      const lie = !cards.every((c) => c.rank === RANKS[rankIdx]);
      claim = { by: turn, ri: rankIdx, rank: RANKS[rankIdx], n: cards.length, lie,
                emptied: p.hand.length === 0 };

      for (let i = 0; i < cards.length; i++) {
        const a = Math.random() * TAU, d = 6 + Math.random() * 7;
        const e = { card: cards[i], up: false, flip0: 0,
                    ox: Math.cos(a) * d, oy: Math.sin(a) * d, rot: (Math.random() - 0.5) * 0.30 };
        pile.push(e);
        fly({
          card: cards[i], up: false, t0: now + i * 78, dur: 300,
          x0: W / 2 + (i - (cards.length - 1) / 2) * 40, y0: L.handBot - 40, r0: 0, s0: 0.7,
          x1: L.cx + e.ox, y1: L.cy + e.oy, r1: e.rot, s1: PILE_S,
          onDone: () => { puff(L.cx + e.ox, L.cy + e.oy); sound.sting("tap"); },
        });
      }

      phase = "settle";
      settleT = 0;
      sound.duck(0.4, 300);
      sound.sting("coin");
      sound.haptic("medium");
      ctx.platform.interact({ type: "place", count: claim.n, rank: claim.rank });
      const left = Math.min.apply(null, players.map((q) => q.hand.length));
      ctx.platform.setProgress(clamp(1 - left / Math.ceil(52 / players.length), 0, 1));
    }

    function openChallenge() {
      phase = "challenge";
      challengeOpen = true;
      challengeT = challengeLen;
      sound.duck(0.5, 380);
      sound.sting("danger");
      sound.haptic("warning");
      sound.heat(0.85);
      ctx.platform.interact({ type: "challenge_open" });
    }

    /**
     * The race, resolved inside the pointerdown handler.
     *
     * Everything here is synchronous on purpose. Four hands landing in the same
     * frame arrive as four pointerdown events in delivery order; the first one
     * to reach this function while the window is open closes it before the
     * second handler runs, so there is exactly one caller and no tie to break.
     * Deferring any part of it to a frame would collapse those arrivals into
     * one.
     */
    function callCheat(i) {
      if (!challengeOpen) return;
      challengeOpen = false;
      caller = i;
      players[i].callT = 1;
      phase = "reveal";
      revealT = 0; revealN = 0;
      shake = 0.7;
      flash.a = 0.55; flash.ink = players[i].ink;
      burst(padCentre(players[i].seat).x, padCentre(players[i].seat).y, players[i].ink, 22, 300);
      banner = { big: players[i].name.toLowerCase() + " CALLS CHEAT",
                 small: "on " + claimWords(claim.n, claim.ri).toLowerCase(),
                 ink: players[i].ink, t: 0, life: 1400 };
      sound.duck(0.6, 460);
      sound.sting("powerup");
      sound.haptic("heavy");
      ctx.platform.interact({ type: "call", by: players[i].name });
    }

    /** Nobody moved. The cards stay face down for good and play goes on. */
    function noCall() {
      challengeOpen = false;
      if (claim.lie) { bluffRun++; bestRun = Math.max(bestRun, bluffRun); }
      banner = { big: "NOBODY CALLED", small: "the cards stay face down",
                 ink: CREAM, t: 0, life: 1500 };
      phase = "verdict"; verdictT = 1.5;
      sound.sting("tap");
      sound.haptic("light");
      sound.heat(0.35);
    }

    /** Flip the claimed cards one at a time, then say who was right. */
    function judge() {
      const shown = pile.slice(-claim.n);
      const truth = shown.every((e) => e.card.rank === claim.rank);
      const loser = truth ? players[caller] : players[claim.by];
      const n = pile.length;
      biggestPile = Math.max(biggestPile, n);

      if (truth) { callsWrong++; }
      else { callsRight++; bluffRun = 0; }

      banner = truth
        ? { big: "THE CLAIM WAS TRUE", small: players[caller].name + " takes " + n + " cards",
            ink: INK_GREEN, t: 0, life: 2900 }
        : { big: players[claim.by].name.toLowerCase() + " WAS LYING",
            small: players[claim.by].name + " takes " + n + " cards",
            ink: INK_RED, t: 0, life: 2900 };

      shake = 1;
      flash.a = 0.7; flash.ink = truth ? INK_GREEN : INK_RED;
      burst(L.cx, L.cy, truth ? INK_GREEN : INK_RED, 32, 330);
      sound.duck(0.6, 520);
      sound.sting(truth ? "success" : "fail");
      sound.haptic(truth ? "success" : "error");
      ctx.platform.milestone(truth ? "bad_call" : "caught", {
        caller: players[caller].name, placer: players[claim.by].name, cards: n,
      });

      // The pile is NOT swept up yet. Whoever just got caught deserves the
      // second and a half where everybody is looking at the two he called an
      // ace; taking the cards immediately throws the reveal away on the frame
      // it lands.
      pendingTake = loser;
      phase = "verdict"; verdictT = 3.0;
    }

    function takePile(p) {
      const target = padCentre(p.seat);
      const now = performance.now();
      const first = Math.max(0, pile.length - 10);
      for (let idx = first; idx < pile.length; idx++) {
        const e = pile[idx];
        const s = pileSlot(idx, L.cx, L.cy, PILE_S);
        fly({
          card: e.card, up: e.up, t0: now + (idx - first) * 26, dur: 380,
          x0: s.x, y0: s.y, r0: s.rot, s0: s.sc,
          x1: target.x, y1: target.y, r1: p.rad + (Math.random() - 0.5) * 1.2, s1: 0.30,
        });
      }
      for (const e of pile) p.hand.push(e.card);
      sortHand(p.hand);
      pile.length = 0;
      p.flashT = 1;
    }

    /** After the banner: somebody has won, or the phone moves on. */
    function afterTurn() {
      const placer = players[claim.by];
      if (claim.emptied && placer.hand.length === 0) { endMatch(placer); return; }
      turnNo++;
      rankIdx = (rankIdx + 1) % RANKS.length;
      turn = (turn + 1) % players.length;
      banner = null;
      beginTurn();
    }

    async function endMatch(p) {
      phase = "over";
      winner = p;
      banner = null;
      burst(L.cx, L.cy, p.ink, 46, 380);
      shake = 1;
      flash.a = 0.6; flash.ink = p.ink;
      sound.duck(0.55, 620);
      sound.sting("win");
      sound.haptic("success");

      shell.el("over-name").textContent = p.name + " wins";
      shell.el("over-name").style.color = p.ink;
      shell.el("over-mirror-name").textContent = p.name + " wins";
      shell.el("over-mirror-name").style.color = p.ink;
      const sub = "emptied their hand on turn " + (turnNo + 1);
      shell.el("over-sub").textContent = sub;
      shell.el("over-mirror-sub").textContent = sub;

      const stat = (label, value, ink) =>
        '<div style="flex:1;min-width:82px;text-align:center;padding:11px 6px;border-radius:14px;' +
          'background:rgba(255,255,255,0.05);box-shadow:inset 0 0 0 1px rgba(227,182,87,0.18);">' +
          '<div style="font-size:23px;font-weight:800;line-height:1;color:' + ink + ';">' + value + '</div>' +
          '<div style="font-size:9.5px;letter-spacing:0.14em;text-transform:lowercase;opacity:0.55;' +
            'margin-top:6px;">' + label + '</div>' +
        '</div>';
      shell.el("over-stats").innerHTML =
        stat("Bluff run", bestRun, BRASS) +
        stat("Caught", callsRight, INK_GREEN) +
        stat("Bad calls", callsWrong, INK_RED);

      shell.el("over-rows").innerHTML =
        '<div style="' + label + 'font-size:9px;margin-bottom:8px;">Cards still held</div>' +
        players.map((q) =>
        '<div style="display:flex;align-items:center;gap:9px;margin:7px 0;">' +
          '<div style="width:9px;height:9px;border-radius:3px;background:' + q.ink + ';flex:none;"></div>' +
          '<div style="width:60px;font-size:13px;flex:none;overflow:hidden;' +
            'opacity:' + (q === p ? "1" : "0.8") + ';font-weight:' + (q === p ? "700" : "400") + ';' +
            'text-overflow:ellipsis;white-space:nowrap;">' + esc(q.name) + '</div>' +
          (q === p
            ? '<div style="flex:1;font-size:9.5px;letter-spacing:0.2em;color:' + q.ink + ';">OUT</div>'
            : '<div style="flex:1;height:8px;border-radius:5px;background:rgba(255,255,255,0.08);overflow:hidden;">' +
              '<div style="width:' + Math.round(clamp(q.hand.length / 26, 0.04, 1) * 100) + '%;height:100%;' +
                'border-radius:5px;background:' + q.ink + ';"></div>' +
            '</div>') +
          '<div style="width:24px;text-align:right;font-size:15px;font-weight:700;flex:none;">' +
            q.hand.length + '</div>' +
        '</div>').join("");
      shell.el("over").style.display = "flex";

      ctx.platform.complete({
        winner: p.name,
        turns: turnNo + 1,
        longestBluffRun: bestRun,
        cheatsCaught: callsRight,
        badCalls: callsWrong,
        durationMs: Math.round(performance.now() - matchStart),
      });
      // The record belongs to the table, not to one of the people sharing the
      // phone: the longest run of lies this room got away with tonight.
      try {
        if (bestRun > 0) {
          await ctx.memory.record("longest_bluff_run").submit(bestRun, {
            label: bestRun + (bestRun === 1 ? " lie" : " lies") + " unbroken",
          });
        }
      } catch (_) { /* offline is fine; the hand still finished */ }
    }

    /* ===============================================================
     * DRAWING
     * ============================================================= */
    /**
     * One card's shadow. Separate from the card so a cluster can share a
     * single shadow: ten cards converging on one spot stack ten shadows and
     * the pile arrives wearing a black hole instead.
     */
    function cardShadow(x, y, rot, scale, lift, alpha) {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      if (shadowArt) {
        const spread = 1 + lift * 1.7;
        const sw = (CARD_W + SHADOW_PAD * 2) * scale * spread;
        const sh = (CARD_H + SHADOW_PAD * 2) * scale * spread;
        g.globalAlpha = clamp(1 - lift * 0.9, 0.25, 1) * (alpha === undefined ? 1 : alpha);
        g.drawImage(shadowArt, -sw / 2, -sh / 2 + (3 + lift * 12) * scale, sw, sh);
        g.globalAlpha = 1;
      } else {
        dropShadow(g, CARD_W * scale, CARD_H * scale, CARD_R * scale, lift);
      }
      g.restore();
    }

    function drawCardAt(x, y, rot, scale, card, faceUp, lift, shadow, alpha) {
      const w = CARD_W * scale, h = CARD_H * scale;
      if (shadow !== false) cardShadow(x, y, rot, scale, lift, alpha);
      g.save();
      if (alpha !== undefined) g.globalAlpha = alpha;
      g.translate(x, y);
      g.rotate(rot);
      const src = faceUp ? (art && card && art.faces[card.id]) : (art && art.back);
      if (src) {
        g.drawImage(src, -w / 2, -h / 2, w, h);
      } else {
        // No OffscreenCanvas on this WebView: paint live. Plainer to run,
        // identical to look at, never a blank rectangle.
        g.save();
        g.translate(-w / 2, -h / 2);
        g.scale(scale, scale);
        if (faceUp && card) paintCardFace(g, card.rank, card.suit, CARD_W, CARD_H);
        else paintCardBack(g, CARD_W, CARD_H);
        g.restore();
      }
      g.restore();
    }

    function rimCard(x, y, rot, scale, col, width, alpha) {
      g.save();
      g.globalAlpha = alpha === undefined ? 1 : alpha;
      g.translate(x, y);
      g.rotate(rot);
      roundRect(g, -CARD_W * scale / 2, -CARD_H * scale / 2, CARD_W * scale, CARD_H * scale, CARD_R * scale);
      g.strokeStyle = col; g.lineWidth = width;
      g.stroke();
      g.restore();
    }
    function dimCard(x, y, rot, scale, a) {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      roundRect(g, -CARD_W * scale / 2, -CARD_H * scale / 2, CARD_W * scale, CARD_H * scale, CARD_R * scale);
      g.fillStyle = "rgba(6,3,2," + a + ")";
      g.fill();
      g.restore();
    }

    function drawMotes(now) {
      const r = L.ringR + 70;
      for (const m of motes) {
        const x = L.cx + (m.x - 0.5) * r * 2 + Math.sin(now * 0.0006 + m.ph) * 12;
        const y = L.cy + (m.y - 0.5) * r * 2 - ((now * 0.001 * m.v) % (r * 2));
        const yy = ((y - (L.cy - r)) % (r * 2) + r * 2) % (r * 2) + (L.cy - r);
        const d = Math.hypot(x - L.cx, yy - L.cy) / r;
        if (d > 1) continue;
        g.globalAlpha = (1 - d) * 0.30 * (0.5 + 0.5 * Math.sin(now * 0.002 + m.ph));
        g.fillStyle = LAMP;
        g.beginPath(); g.arc(x, yy, m.s, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }

    /**
     * Where one pile card sits.
     *
     * Normally: crooked, scattered, buried. During a reveal the claimed cards
     * are pulled out into a spread instead — the payoff of a call is seeing
     * the two hiding among the aces, and three cards in a heap on top of each
     * other says nothing at all.
     */
    function pileSlot(idx, cx, cy, scale) {
      const e = pile[idx];
      if (claim && (phase === "reveal" || phase === "verdict") &&
          idx >= pile.length - claim.n && scale >= PILE_S * 0.9) {
        const k = idx - (pile.length - claim.n), n = claim.n;
        const sc = n >= 4 ? 0.70 : REVEAL_S;
        const cw = CARD_W * sc;
        // Fully separated when four cards will fit side by side, overlapping
        // to the right when they will not — so the top-left index of every
        // card is always the part that survives.
        const step = Math.min(cw + 5, (L.bandW - cw - 10) / Math.max(1, n - 1));
        return { x: cx + (k - (n - 1) / 2) * step, y: cy - 8,
                 rot: (k - (n - 1) / 2) * 0.05, sc, lift: 0.34 };
      }
      const k = scale / PILE_S;
      return { x: cx + e.ox * k, y: cy + e.oy * k, rot: e.rot, sc: scale, lift: 0.06 };
    }

    /** The pile in the middle of the table, growing and crooked. */
    function drawPile(now, cx, cy, scale) {
      const first = Math.max(0, pile.length - 14);
      const hidden = first;
      // The buried cards read as one slab of thickness rather than fourteen
      // more blits — nobody can see them individually anyway.
      if (hidden > 0) {
        const layers = Math.min(6, 1 + Math.round(hidden / 6));
        for (let i = layers; i >= 1; i--) {
          g.save();
          g.translate(cx - i * 0.7, cy - i * 1.25);
          g.rotate(-0.03 + i * 0.005);
          const w = CARD_W * scale, h = CARD_H * scale;
          roundRect(g, -w / 2, -h / 2, w, h, CARD_R * scale);
          g.fillStyle = CARD_THEME.backDeep; g.fill();
          g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 1; g.stroke();
          g.restore();
        }
      }
      for (let idx = first; idx < pile.length; idx++) {
        const e = pile[idx];
        if (flyers.some((f) => f.card === e.card)) continue;
        let face = e.up, sx = 1;
        if (e.flip0) {
          const f = clamp((now - e.flip0) / 340, 0, 1);
          sx = Math.max(Math.abs(Math.cos(f * Math.PI)), 0.02);
          face = f >= 0.5;
          if (f >= 1) e.flip0 = 0;
        }
        const s = pileSlot(idx, cx, cy, scale);
        if (sx < 0.999) {
          // The shadow is laid down unsquashed and the card is squashed on top
          // of it. Squashing both turns the shadow into a tall black smear
          // standing behind a card that is only a few pixels wide.
          cardShadow(s.x, s.y, s.rot, s.sc, 0.30, 0.7);
          g.save();
          g.translate(s.x, s.y);
          g.rotate(s.rot);
          g.scale(sx, 1);
          drawCardAt(0, 0, 0, s.sc, e.card, face, 0, false);
          g.restore();
        } else {
          drawCardAt(s.x, s.y, s.rot, s.sc, e.card, face, s.lift);
        }
        // A revealed card is marked the instant it lands: green if it is what
        // was claimed, red if it is not. That is the whole payoff of a call.
        if (face && e.up && claim && phase !== "menu") {
          const ok = e.card.rank === claim.rank;
          rimCard(s.x, s.y, s.rot, s.sc, ok ? INK_GREEN : INK_RED, 2.6, 0.9);
        }
      }
      if (!pile.length) {
        g.save();
        g.globalAlpha = 0.22;
        g.translate(cx, cy);
        roundRect(g, -CARD_W * scale / 2, -CARD_H * scale / 2, CARD_W * scale, CARD_H * scale, CARD_R * scale);
        g.strokeStyle = CREAM; g.lineWidth = 1.4;
        g.setLineDash([5, 6]); g.stroke(); g.setLineDash([]);
        g.restore();
        g.globalAlpha = 1;
      }
    }

    function plate(x, y, txt, rad) {
      g.save();
      g.translate(x, y);
      if (rad) g.rotate(rad);
      g.font = "700 10.5px " + FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      const tw = g.measureText(txt).width + 24;
      roundRect(g, -tw / 2, -9, tw, 18, 9);
      g.fillStyle = "rgba(10,5,3,0.76)"; g.fill();
      g.strokeStyle = BRASS_DIM; g.lineWidth = 1; g.stroke();
      g.fillStyle = BRASS;
      g.fillText(txt, 0, 0.5);
      g.restore();
    }

    /** The countdown ring around the pile while the window is open. */
    function drawWindowRing(now) {
      const k = clamp(challengeT / challengeLen, 0, 1);
      g.save();
      g.translate(L.cx, L.cy);
      g.lineCap = "round";
      g.strokeStyle = "rgba(255,236,198,0.09)";
      g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, L.ringR, 0, TAU); g.stroke();

      const pulse = 0.5 + 0.5 * Math.sin(now * 0.019);
      for (let i = 4; i >= 1; i--) {
        g.globalAlpha = 0.10 * (1 - i / 5) * (0.4 + 0.6 * pulse) * (0.35 + 0.65 * (1 - k));
        g.strokeStyle = INK_RED;
        g.lineWidth = i * 6;
        g.beginPath(); g.arc(0, 0, L.ringR + i * 2, 0, TAU); g.stroke();
      }
      g.globalAlpha = 1;

      g.strokeStyle = k > 0.34 ? BRASS : INK_RED;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(0, 0, L.ringR, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(k, 0.001));
      g.stroke();
      g.restore();
    }

    /**
     * The claim, said to the whole table.
     *
     * Two plaques back to back above and below the pile, so both ends of the
     * phone read it right way up; the side seats get the same words repeated
     * on their own pad, rotated to them. One centred plaque would be upside
     * down for half the table at the exact moment it matters most.
     */
    function drawClaimPlaques(now) {
      if (!claim) return;
      const p = players[claim.by];
      const words = claimWords(claim.n, claim.ri);
      const w = L.plaqueW, h = 62;
      for (const rad of [0, Math.PI]) {
        g.save();
        g.translate(L.cx, L.cy + (rad === 0 ? L.plaqueY : -L.plaqueY));
        g.rotate(rad);
        roundRect(g, -w / 2, -h / 2, w, h, 15);
        const bg = g.createLinearGradient(0, -h / 2, 0, h / 2);
        bg.addColorStop(0, "rgba(24,11,8,0.90)");
        bg.addColorStop(1, "rgba(9,4,3,0.92)");
        g.fillStyle = bg; g.fill();
        g.strokeStyle = hexA(p.ink, 0.50); g.lineWidth = 1.4; g.stroke();

        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = hexA(p.ink, 0.92);
        g.font = "800 9.5px " + FONT;
        tracked(g, p.name.toLowerCase() + " SAYS", 0, -17, 2.4);
        g.fillStyle = CREAM;
        fitFont(g, words, "800", 25, FONT, w - 24);
        g.fillText(words, 0, 9);
        g.restore();
      }
    }

    /* --- the seat pads -------------------------------------------- */
    function drawPad(p, i, now) {
      const R = L.pads[p.seat];
      if (!R) return;
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      // Nobody is the placer until a claim exists — during the deal there is
      // no turn to dim a pad for.
      const isPlacer = !!claim && i === claim.by;
      const armed = phase === "challenge" && challengeOpen && !isPlacer;
      const side = Math.abs(Math.abs(p.rad) - Math.PI / 2) < 0.1;

      g.save();
      if (p.callT > 0) g.translate((Math.random() - 0.5) * p.callT * 9, (Math.random() - 0.5) * p.callT * 9);
      g.translate(cx, cy);
      const sc = 1 - p.press * 0.03 + p.flashT * 0.02 + (armed ? 0.008 * Math.sin(now * 0.008) : 0);
      g.scale(sc, sc);

      const w = R.w, h = R.h, rr = 19;

      // Armed glow: concentric strokes standing in for the blur we cannot use.
      if (armed) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.018);
        g.strokeStyle = INK_RED;
        for (let k = 3; k >= 1; k--) {
          g.globalAlpha = 0.15 * (1 - k / 4.2) * (0.45 + 0.55 * pulse);
          g.lineWidth = k * 8;
          roundRect(g, -w / 2, -h / 2, w, h, rr);
          g.stroke();
        }
        g.globalAlpha = 1;
      }

      // Body: dark leather lit from the player's own edge. The gradient runs
      // along the seat's own axis, so the colour pools on the side the player
      // is actually sitting on rather than at the top of the screen.
      const nx = -Math.sin(p.rad), ny = Math.cos(p.rad);
      const ext = (Math.abs(nx) * w + Math.abs(ny) * h) / 2;
      roundRect(g, -w / 2, -h / 2, w, h, rr);
      const base = g.createLinearGradient(nx * ext, ny * ext, -nx * ext, -ny * ext);
      base.addColorStop(0.00, "rgba(38,22,16,0.95)");
      base.addColorStop(1.00, "rgba(10,5,4,0.97)");
      g.fillStyle = base; g.fill();
      // The colour is a second pass on top. Folded into the leather gradient it
      // mixed with the red cloth showing through and every pad came out brown.
      const wash = g.createLinearGradient(nx * ext, ny * ext, -nx * ext, -ny * ext);
      const tint = armed ? INK_RED : p.ink;
      wash.addColorStop(0.00, hexA(tint, (armed ? 0.36 : isPlacer ? 0.09 : 0.17) + p.flashT * 0.30));
      wash.addColorStop(0.66, hexA(tint, p.flashT * 0.14));
      g.fillStyle = wash; g.fill();
      g.strokeStyle = armed ? hexA(INK_RED, 0.95) : hexA(p.ink, Math.max(isPlacer ? 0.26 : 0.44, p.flashT));
      g.lineWidth = armed ? 2.4 : 1.3 + p.flashT * 1.6;
      g.stroke();

      roundRect(g, -w / 2 + 6, -h / 2 + 6, w - 12, h - 12, rr - 5);
      g.strokeStyle = "rgba(255,255,255,0.05)";
      g.lineWidth = 1; g.stroke();

      g.fillStyle = armed ? "#ffb0a8" : "rgba(227,182,87,0.32)";
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        g.beginPath(); g.arc(sx * (w / 2 - 11), sy * (h / 2 - 11), 2.1, 0, TAU); g.fill();
      }

      if (p.flashT > 0) {
        const f = easeOut(p.flashT);
        const bloom = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) * 0.62);
        bloom.addColorStop(0.00, "rgba(255,240,214," + (f * 0.15).toFixed(3) + ")");
        bloom.addColorStop(1.00, "rgba(255,240,214,0)");
        roundRect(g, -w / 2, -h / 2, w, h, rr);
        g.fillStyle = bloom; g.fill();
      }

      // Everything below reads right way up from this player's seat.
      g.rotate(p.rad);
      const lw = side ? h : w, lh = side ? w : h;
      g.textAlign = "center"; g.textBaseline = "middle";

      if (armed) {
        g.fillStyle = "#fff0ec";
        const size = Math.round(Math.min(lh * 0.34, 26));
        g.font = "900 " + size + "px " + FONT;
        tracked(g, "CHEAT", 0, -lh * 0.10, 2.6);
        g.fillStyle = hexA(p.ink, 0.86);
        g.font = "700 " + Math.round(Math.min(lh * 0.13, 10)) + "px " + FONT;
        tracked(g, p.name.toLowerCase(), 0, lh * 0.19, 2.2);
        // A drain bar so the window's length is visible from every seat, not
        // only from the ring in the middle of the table.
        const k = clamp(challengeT / challengeLen, 0, 1);
        const bw = lw * 0.56;
        roundRect(g, -bw / 2, lh * 0.34 - 2, bw, 4, 2);
        g.fillStyle = "rgba(255,255,255,0.13)"; g.fill();
        roundRect(g, -bw / 2, lh * 0.34 - 2, bw * k, 4, 2);
        g.fillStyle = k > 0.34 ? BRASS : INK_RED; g.fill();
      } else {
        g.fillStyle = hexA(p.ink, isPlacer ? 0.55 : 0.9);
        g.font = "700 " + Math.round(Math.min(lh * 0.16, 11)) + "px " + FONT;
        tracked(g, p.name.toLowerCase(), 0, -lh * 0.22, 2.6);

        if (isPlacer && claim && phase !== "cover") {
          g.fillStyle = "rgba(247,237,217,0.62)";
          g.font = "700 " + Math.round(Math.min(lh * 0.19, 13)) + "px " + FONT;
          g.fillText("played " + claim.n, 0, lh * 0.10);
          g.fillStyle = hexA(p.ink, 0.42);
          g.font = "600 " + Math.round(Math.min(lh * 0.14, 9.5)) + "px " + FONT;
          tracked(g, p.hand.length + " LEFT", 0, lh * 0.32, 1.8);
        } else {
          g.fillStyle = CREAM;
          g.font = "800 " + Math.round(Math.min(lh * 0.42, 30)) + "px " + FONT;
          g.fillText(String(p.hand.length), 0, lh * 0.10);
          g.fillStyle = hexA(p.ink, 0.45);
          g.font = "600 " + Math.round(Math.min(lh * 0.13, 9)) + "px " + FONT;
          tracked(g, p.hand.length === 1 ? "CARD" : "CARDS", 0, lh * 0.33, 1.8);
        }
      }
      g.restore();
    }

    /* --- the shout ------------------------------------------------ */
    /**
     * The shout, driven by the same clamped game clock as everything else.
     *
     * It used to age off performance.now(), which drifts against the game
     * clock the moment a frame runs long: a two-second stall aged the banner
     * two seconds while the verdict it belongs to advanced by the clamped
     * quarter-second, and the words faded out while the cards they explain
     * were still on the table.
     */
    function drawBanner(now) {
      if (!banner) return;
      const age = banner.t;
      if (age > banner.life) { banner = null; return; }
      const inT = clamp(age / 180, 0, 1);
      const out = clamp((banner.life - age) / 300, 0, 1);
      const pop = easeBack(inT);
      // The same slot as the claim, and for the same reason: a banner across
      // the middle of the table would sit on top of the very cards the call
      // just turned over.
      const w = L.plaqueW, h = 80;
      for (const rad of [0, Math.PI]) {
        g.save();
        g.globalAlpha = out;
        g.translate(L.cx, L.cy + (rad === 0 ? L.plaqueY : -L.plaqueY));
        g.rotate(rad);
        g.scale(pop, pop);
        roundRect(g, -w / 2, -h / 2, w, h, 17);
        g.fillStyle = "rgba(8,4,3,0.90)"; g.fill();
        g.strokeStyle = hexA(banner.ink, 0.8); g.lineWidth = 2; g.stroke();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = banner.ink;
        fitFont(g, banner.big, "900", 21, FONT, w - 26);
        g.fillText(banner.big, 0, -11);
        g.fillStyle = "rgba(247,237,217,0.72)";
        fitFont(g, banner.small, "600", 12, FONT, w - 26);
        g.fillText(banner.small, 0, 17);
        g.restore();
      }
      g.globalAlpha = 1;
    }

    /* --- the private, picked-up screen ---------------------------- */
    function drawHeader(now) {
      const p = players[turn];
      if (!p) return;
      const x = 20, w = W - 40, y = L.hdrY, h = L.hdrH;
      roundRect(g, x, y, w, h, 18);
      const bg = g.createLinearGradient(0, y, 0, y + h);
      bg.addColorStop(0, "rgba(30,14,10,0.92)");
      bg.addColorStop(1, "rgba(10,5,4,0.94)");
      g.fillStyle = bg; g.fill();
      g.strokeStyle = hexA(p.ink, 0.42); g.lineWidth = 1.4; g.stroke();

      g.textAlign = "left"; g.textBaseline = "middle";
      g.fillStyle = hexA(p.ink, 0.9);
      g.font = "800 9.5px " + FONT;
      g.textAlign = "center";
      tracked(g, p.name.toLowerCase() + " · YOU MUST CLAIM", x + w / 2, y + 22, 2.4);

      // The rank the table is on, as a card index rather than a word: it is
      // the one thing on this screen that must be unmistakable.
      g.textAlign = "center";
      g.fillStyle = CREAM;
      const words = RANK_MANY[rankIdx];
      fitFont(g, words, "900", 34, FONT, w - 110);
      g.fillText(words, x + w / 2, y + 56);

      g.save();
      g.translate(x + 34, y + h / 2 + 6);
      g.fillStyle = hexA(p.ink, 0.16);
      roundRect(g, -22, -28, 44, 56, 7);
      g.fill();
      g.strokeStyle = hexA(p.ink, 0.5); g.lineWidth = 1.2; g.stroke();
      g.fillStyle = CREAM;
      g.font = "700 26px " + SERIF;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(RANKS[rankIdx], 0, -6);
      g.fillStyle = hexA(p.ink, 0.8);
      suitPath(g, "S", 0, 15, 7);
      g.restore();
    }

    /** Shorten a name to fit, with a real ellipsis rather than a guess. */
    function clipText(text, max) {
      if (g.measureText(text).width <= max) return text;
      let t = text;
      while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
      return t + "…";
    }

    /**
     * The table, drawn small, on the screen of the person holding the phone.
     *
     * Everybody's count is public at a real table and it is the only evidence
     * there is: a player down to two cards is about to go out, and a pile of
     * thirty is what a bad call costs. Laying the counts out at the seats
     * people are actually sitting in makes that readable at a glance instead
     * of as a list.
     */
    function drawDiagram(now) {
      const top = L.handTop, bot = handTopY();
      const cy = (top + bot) / 2, cx = W / 2;
      const areaH = bot - top;
      const ry = Math.max(56, areaH / 2 - 20);
      const rx = Math.min(118, (W - 28 - 96) / 2);
      const rr = Math.min(96, ry - 22);

      g.save();
      g.strokeStyle = "rgba(255,232,196,0.06)";
      g.lineWidth = 1.4;
      g.setLineDash([4, 7]);
      g.beginPath(); g.ellipse(cx, cy, rr + 22, Math.min(rr + 22, ry - 4), 0, 0, TAU); g.stroke();
      g.setLineDash([]);
      g.restore();

      drawPile(now, cx, cy - 4, 0.58);
      plate(cx, cy + 52, pile.length === 0 ? "pile empty" : pile.length + " on the pile");

      for (let i = 0; i < players.length; i++) {
        const q = players[i];
        const d = SEAT_DIR[q.seat] || [0, 1];
        const me = i === turn;
        const w = 96, h = 30;
        const px = cx + d[0] * rx, py = cy + d[1] * ry;
        roundRect(g, px - w / 2, py - h / 2, w, h, 10);
        g.fillStyle = me ? hexA(q.ink, 0.14) : "rgba(255,255,255,0.05)"; g.fill();
        g.strokeStyle = hexA(q.ink, me ? 0.62 : 0.28); g.lineWidth = 1; g.stroke();
        g.beginPath(); g.arc(px - w / 2 + 11, py, 3.6, 0, TAU);
        g.fillStyle = q.ink; g.fill();
        g.textAlign = "left"; g.textBaseline = "middle";
        g.font = (me ? "700 " : "600 ") + "11px " + FONT;
        g.fillStyle = me ? hexA(q.ink, 0.95) : "rgba(247,237,217,0.74)";
        g.fillText(clipText(me ? "You" : q.name, w - 58), px - w / 2 + 20, py + 0.5);
        g.textAlign = "right";
        g.fillStyle = CREAM;
        g.font = "800 14px " + FONT;
        g.fillText(String(q.hand.length), px + w / 2 - 10, py + 0.5);
      }
      g.textAlign = "center";
    }

    function drawHand(now) {
      const p = players[turn];
      if (!p) return;
      const rank = RANKS[rankIdx];
      const hs = handScale();
      for (let r = 0; r < handRows.length; r++) {
        for (const i of handRows[r]) {
          const s = handSlot(i);
          const sel = picked.indexOf(i);
          const lift = sel >= 0 ? 18 : 0;
          const sc = hs * (sel >= 0 ? 1.06 : 1);
          const real = settings.hints && p.hand[i].rank === rank;
          // Row cards overlap by two thirds, so their shadows would pile up
          // into one dark bar. Each is thinned; only a lifted card, which is
          // genuinely off the table, throws a full one.
          cardShadow(s.x, s.y - lift, 0, sc, sel >= 0 ? 0.5 : 0.08, sel >= 0 ? 1 : 0.4);
          drawCardAt(s.x, s.y - lift, 0, sc, p.hand[i], true, 0, false);
          if (sel >= 0) {
            rimCard(s.x, s.y - lift, 0, sc, "#fff4d8", 2.6, 0.95);
            // The order badge: the claim is "three sevens", so which three is
            // the only thing the player has actually decided.
            g.save();
            g.translate(s.x + CARD_W * sc / 2 - 9, s.y - lift - CARD_H * sc / 2 + 9);
            g.beginPath(); g.arc(0, 0, 10, 0, TAU);
            g.fillStyle = BRASS; g.fill();
            g.strokeStyle = "rgba(40,20,4,0.5)"; g.lineWidth = 1; g.stroke();
            g.fillStyle = "#2a1704";
            g.font = "800 12px " + FONT;
            g.textAlign = "center"; g.textBaseline = "middle";
            g.fillText(String(sel + 1), 0, 0.5);
            g.restore();
          } else if (real) {
            rimCard(s.x, s.y, 0, sc, hexA(BRASS, 0.9), 1.8, 0.7);
          }
        }
      }
    }

    function drawCommit(now) {
      const R = L.commit;
      const on = picked.length > 0;
      const p = players[turn];
      g.save();
      if (on) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
        for (let i = 3; i >= 1; i--) {
          g.globalAlpha = 0.12 * (1 - i / 4) * (0.5 + 0.5 * pulse);
          g.strokeStyle = BRASS; g.lineWidth = i * 7;
          roundRect(g, R.x, R.y, R.w, R.h, 17);
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      roundRect(g, R.x, R.y, R.w, R.h, 17);
      if (on) {
        const grad = g.createLinearGradient(0, R.y, 0, R.y + R.h);
        grad.addColorStop(0, "#f4d68d");
        grad.addColorStop(1, "#c8942b");
        g.fillStyle = grad;
      } else {
        g.fillStyle = "rgba(255,255,255,0.055)";
      }
      g.fill();
      g.strokeStyle = on ? "rgba(255,247,224,0.6)" : "rgba(227,182,87,0.26)";
      g.lineWidth = 1.4;
      g.stroke();

      g.textAlign = "center"; g.textBaseline = "middle";
      if (on) {
        g.fillStyle = "#2a1704";
        const words = "PLAY " + claimWords(picked.length, rankIdx);
        fitFont(g, words, "900", 19, FONT, R.w - 40);
        g.fillText(words, R.x + R.w / 2, R.y + R.h / 2 - 7);
        g.fillStyle = "rgba(42,23,4,0.62)";
        g.font = "700 9.5px " + FONT;
        tracked(g, "FACE DOWN · NOBODY SEES THEM", R.x + R.w / 2, R.y + R.h / 2 + 14, 1.8);
      } else {
        g.fillStyle = "rgba(247,237,217,0.45)";
        g.font = "800 13px " + FONT;
        tracked(g, "TAP 1–4 CARDS", R.x + R.w / 2, R.y + R.h / 2 - 6, 2.4);
        g.fillStyle = "rgba(247,237,217,0.26)";
        g.font = "600 10px " + FONT;
        g.fillText("they do not have to be " + RANK_MANY[rankIdx].toLowerCase(),
          R.x + R.w / 2, R.y + R.h / 2 + 13);
      }
      g.restore();
      if (p && p.press > 0) {
        g.save();
        g.globalAlpha = p.press * 0.2;
        roundRect(g, R.x, R.y, R.w, R.h, 17);
        g.fillStyle = "#000"; g.fill();
        g.restore();
      }
    }

    /* --- the title ------------------------------------------------ */
    /**
     * The hanging light, drawn side-on for the title only.
     *
     * The play screen is a top-down table where the lamp can only be a pool of
     * light; the title is a poster, and a poster gets the lamp itself — cord,
     * shade, bulb and a cone of dust falling onto a fan of cards.
     */
    function drawLamp(now) {
      const ly = H * 0.155;
      const swing = Math.sin(now * 0.00055) * 0.016;
      g.save();
      g.translate(W / 2, 0);
      g.rotate(swing);

      // The beam. A single filled cone has two hard diagonal edges and reads
      // as a folded sheet of paper; three nested ones, widest and faintest
      // outermost, give the falloff a real beam has without touching the blur
      // filter, which is rejected at upload.
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const [lip, base, top, mid] of [[46, 0.86, 0.075, 0.030],
                                           [34, 0.62, 0.185, 0.070]]) {
        const cone = g.createLinearGradient(0, ly, 0, H * 0.90);
        cone.addColorStop(0.00, "rgba(255,216,146," + top + ")");
        cone.addColorStop(0.34, "rgba(255,206,136," + mid + ")");
        cone.addColorStop(1.00, "rgba(255,200,130,0)");
        g.fillStyle = cone;
        g.beginPath();
        g.moveTo(-lip, ly); g.lineTo(lip, ly);
        g.lineTo(W * base, H * 0.95); g.lineTo(-W * base, H * 0.95);
        g.closePath(); g.fill();
      }
      g.restore();

      g.strokeStyle = "#241309"; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(0, -20); g.lineTo(0, ly - 44); g.stroke();

      // Shade: a brass trapezoid with a lit inner lip.
      g.beginPath();
      g.moveTo(-13, ly - 46); g.lineTo(13, ly - 46);
      g.lineTo(38, ly); g.lineTo(-38, ly);
      g.closePath();
      const sh = g.createLinearGradient(-38, ly - 46, 38, ly);
      sh.addColorStop(0, "#4b2c14");
      sh.addColorStop(0.45, "#8a5a24");
      sh.addColorStop(1, "#3a220f");
      g.fillStyle = sh; g.fill();
      g.strokeStyle = "rgba(227,182,87,0.55)"; g.lineWidth = 1.2; g.stroke();

      g.beginPath(); g.ellipse(0, ly, 38, 8, 0, 0, TAU);
      g.fillStyle = "#ffe8bb"; g.fill();

      g.save();
      g.globalCompositeOperation = "lighter";
      const bulb = g.createRadialGradient(0, ly + 2, 0, 0, ly + 2, 92);
      bulb.addColorStop(0.00, "rgba(255,232,180,0.85)");
      bulb.addColorStop(0.22, "rgba(255,214,140,0.30)");
      bulb.addColorStop(1.00, "rgba(255,206,130,0)");
      g.fillStyle = bulb;
      g.beginPath(); g.arc(0, ly + 2, 92, 0, TAU); g.fill();
      g.restore();
      g.restore();
    }

    const FAN = ["7S", "7H", "KD", "7C", "2S"];
    function drawTitleFan(now) {
      const cx = W / 2, cy = H * 0.395, R = 300;
      const rock = Math.sin(now * 0.00065) * 0.028;
      for (let i = 0; i < FAN.length; i++) {
        const k = i - (FAN.length - 1) / 2;
        const a = k * 0.168 + rock;
        const id = FAN[i];
        const card = { id, rank: id.slice(0, -1), suit: id.slice(-1) };
        // Two of them are face down, because the whole game is that you do not
        // know which of the sevens is a two.
        const up = i === 1 || i === 3;
        drawCardAt(cx + Math.sin(a) * R, cy - Math.cos(a) * R + R - (up ? 12 : 0),
          a, 0.92, card, up, up ? 0.22 : 0.08);
      }
    }

    function drawDeal(now) {
      const t = clamp(dealT / 0.6, 0, 1);
      if (t > 0.1) cardShadow(L.cx, L.cy, -0.03, TABLE_S, 0.06);
      for (let i = 0; i < 6; i++) {
        const k = clamp((t - i * 0.07) / 0.3, 0, 1);
        if (k <= 0) continue;
        const p = easeOut(k);
        const a = (i / 6) * TAU + 1.1;
        const x = lerp(L.cx + Math.cos(a) * W * 0.8, L.cx - i * 1.0, p);
        const y = lerp(L.cy + Math.sin(a) * H * 0.6, L.cy - i * 1.3, p);
        drawCardAt(x, y, lerp(a * 1.5, -0.03, p), TABLE_S, null, false, 0, false);
      }
    }

    function drawFlyers(now) {
      for (const f of flyers) {
        if (now < f.t0) continue;
        const t = clamp((now - f.t0) / f.dur, 0, 1);
        const p = easeInOut(t);
        const x = lerp(f.x0, f.x1, p);
        const y = lerp(f.y0, f.y1, p) - Math.sin(Math.PI * p) * 24;
        const s = lerp(f.s0, f.s1, p);
        drawCardAt(x, y, lerp(f.r0, f.r1, p), s, f.card, !!f.up, 0.25 + 0.4 * Math.sin(Math.PI * p));
      }
    }

    function drawParts() {
      for (const p of parts) {
        if (p.life <= 0) continue;
        const t = p.life / p.max;
        g.save();
        g.globalAlpha = clamp(t * 1.3, 0, 1);
        g.translate(p.x, p.y);
        if (p.kind === "shard") {
          g.rotate(p.rot);
          g.fillStyle = p.col;
          roundRect(g, -p.size * 0.35, -p.size * 0.5, p.size * 0.7, p.size, 1.5);
          g.fill();
        } else {
          g.fillStyle = p.col;
          g.beginPath(); g.arc(0, 0, p.size * (0.4 + t * 0.7), 0, TAU); g.fill();
        }
        g.restore();
      }
      g.globalAlpha = 1;
    }

    /* ===============================================================
     * FRAME
     * ============================================================= */
    const TABLE_PHASES = { deal: 1, settle: 1, challenge: 1, reveal: 1, verdict: 1, over: 1 };

    function render(now) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (room) g.drawImage(room, 0, 0, W, H);
      else paintRoom(g, false);

      g.save();
      if (shake > 0.01) {
        g.translate((Math.random() - 0.5) * shake * 15, (Math.random() - 0.5) * shake * 15);
      }

      if (phase === "menu") {
        drawLamp(now);
        drawTitleFan(now);
      } else if (phase === "cover") {
        // Nothing but the room. The cover is opaque, but painting the private
        // screen underneath it is one CSS mistake away from being a leak, and
        // there is no reason to take the bet.
        drawMotes(now);
      } else if (phase === "place") {
        drawMotes(now);
        drawHeader(now);
        drawDiagram(now);
        drawHand(now);
        drawCommit(now);
      } else {
        drawMotes(now);
        drawLayoutRing();
        if (phase === "deal") drawDeal(now);
        else {
          if (phase === "challenge") drawWindowRing(now);
          drawPile(now, L.cx, L.cy, PILE_S);
          if (pile.length) {
            const spread = phase === "reveal" || phase === "verdict";
            plate(L.cx, L.cy + (spread ? 88 : CARD_H * PILE_S / 2 + 18),
              pile.length + (pile.length === 1 ? " card on the pile" : " cards on the pile"));
          }
          if (phase === "settle" || phase === "challenge") drawClaimPlaques(now);
        }
        drawFlyers(now);
        drawParts();
      }
      g.restore();

      if (TABLE_PHASES[phase]) {
        for (let i = 0; i < players.length; i++) drawPad(players[i], i, now);
        drawBanner(now);
        if (phase === "settle") {
          // The beat between the private screen and the public one. It exists
          // so the phone can physically reach the middle of the table before
          // anybody is asked to react to what is on it.
          const k = clamp(settleT / 0.4, 0, 1);
          g.save();
          g.globalAlpha = k * (0.55 + 0.45 * Math.sin(now * 0.006));
          g.fillStyle = BRASS;
          g.font = "800 12px " + FONT;
          g.textAlign = "center"; g.textBaseline = "middle";
          tracked(g, "PHONE DOWN", L.cx, L.cy - L.ringR - 26, 4);
          g.restore();
        }
      }

      if (flash.a > 0.004) {
        // A tint over the whole room, not a wash. Flat at full strength it
        // turned the cloth, the cards and four people's pads one colour.
        g.globalAlpha = flash.a * 0.26;
        g.fillStyle = flash.ink;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    ctx.onFrame((dtMs) => {
      // Two clocks. `dt` is clamped hard and drives decay and easing, where a
      // long stall must not make everything jump. `dtG` is the game clock: the
      // challenge window is a promise to the people at the table and must not
      // quietly stretch because the phone dropped frames.
      const dt = Math.min(dtMs, 60) / 1000;
      const dtG = sheetOpen ? 0 : Math.min(dtMs, 250) / 1000;
      const now = performance.now();

      shake *= Math.pow(0.0022, dt);
      flash.a *= Math.pow(0.0009, dt);
      for (const p of players) {
        p.press = Math.max(0, p.press - dt * 5);
        p.flashT = Math.max(0, p.flashT - dt * 1.6);
        p.callT = Math.max(0, p.callT - dt * 3);
      }
      stepParts(dt);
      stepFlyers(now);
      if (banner) banner.t += dtG * 1000;

      if (phase === "deal") {
        dealT += dtG;
        if (dealT >= 1.0 && !flyers.length) { beginTurn(); }
      } else if (phase === "settle") {
        settleT += dtG;
        if (settleT >= 1.5 && !flyers.length) openChallenge();
      } else if (phase === "challenge") {
        challengeT -= dtG;
        if (challengeT <= 0 && challengeOpen) noCall();
      } else if (phase === "reveal") {
        revealT += dtG;
        const want = Math.min(claim.n, Math.floor(revealT / 0.38) + 1);
        while (revealN < want) {
          const e = pile[pile.length - claim.n + revealN];
          e.flip0 = now;
          e.up = true;
          const ok = e.card.rank === claim.rank;
          sound.sting(ok ? "tap" : "danger");
          sound.haptic(ok ? "light" : "medium");
          revealN++;
        }
        if (revealN >= claim.n && revealT >= claim.n * 0.38 + 0.55) judge();
      } else if (phase === "verdict") {
        verdictT -= dtG;
        if (pendingTake && verdictT <= 1.5) { takePile(pendingTake); pendingTake = null; }
        if (verdictT <= 0 && !flyers.length) afterTurn();
      }

      render(now);
    });

    /* ===============================================================
     * OVERLAY
     *
     * One markup string on the runtime-owned root, queried back out by
     * [data-el]. Bits may not reach into the host DOM and
     * document.createElement is rejected at upload. The root itself is
     * pointer-transparent, or it silently swallows every tap meant for
     * the table underneath; only chrome and full-screen sheets take input.
     * ============================================================= */
    const SAFE_T = ctx.safeArea.top, SAFE_B = ctx.safeArea.bottom;
    const btn = "pointer-events:auto;width:36px;height:36px;border-radius:12px;border:none;" +
      "background:rgba(12,6,4,0.74);color:" + CREAM + ";font-size:15px;line-height:1;" +
      "font-family:inherit;padding:0;box-shadow:inset 0 0 0 1px rgba(227,182,87,0.30);";
    const bigBtn = (bg, fg, edge) => "width:100%;padding:15px;border:none;border-radius:15px;font-family:inherit;" +
      "font-size:16px;font-weight:800;background:" + bg + ";color:" + fg + ";margin-top:11px;" +
      "pointer-events:auto;" + (edge ? "box-shadow:inset 0 0 0 1px " + edge + ";" : "");
    const QUIET = "linear-gradient(180deg,rgba(255,255,255,0.13),rgba(255,255,255,0.05))";
    const QUIET_EDGE = "rgba(227,182,87,0.42)";
    const panel = "max-width:326px;width:100%;background:linear-gradient(180deg,#2a130e,#150907);" +
      "border-radius:22px;padding:22px;box-shadow:inset 0 0 0 1px rgba(227,182,87,0.26),0 20px 60px rgba(0,0,0,0.6);";
    const label = "font-size:11px;letter-spacing:0.24em;text-transform:lowercase;opacity:0.5;";
    // overflow-y:auto so a long panel on a short phone scrolls rather than
    // centring itself off both ends, which puts its close button out of reach.
    const sheetCss = "position:absolute;inset:0;display:none;align-items:center;" +
      "align-items:safe center;justify-content:center;box-sizing:border-box;" +
      "background:rgba(5,2,2,0.92);z-index:80;padding:" + (SAFE_T + 14) + "px 24px " +
      (SAFE_B + 14) + "px;overflow-y:auto;pointer-events:auto;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:" + CREAM + ";pointer-events:none;text-transform:lowercase;";

    /* Form controls do not inherit text-transform: the UA stylesheet pins
     * `text-transform:none` on button/input/select, so the lowercase set on
     * this root stops dead at every button. Stamp them as they are built,
     * rather than threading the declaration through 250 style strings. */
    const lowercaseControls = () => {
      for (const el of root.querySelectorAll("button,input,select,textarea")) {
        if (el.style.textTransform !== "lowercase") el.style.textTransform = "lowercase";
      }
    };
    lowercaseControls();
    new MutationObserver(lowercaseControls).observe(root, { childList: true, subtree: true });
    root.innerHTML =
      /* ---- chrome, in the corner the top pad was shifted to free ---- */
      '<div style="position:absolute;right:9px;top:' + (SAFE_T + 9) + 'px;display:flex;' +
        'flex-direction:column;gap:6px;z-index:90;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btn + 'font-size:17px;">♪</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btn + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btn + '">?</button>' +
      '</div>' +

      /* ---- title ---- */
      '<div data-el="menu" style="position:absolute;inset:0;display:flex;flex-direction:column;' +
        'justify-content:flex-end;align-items:center;z-index:50;pointer-events:auto;box-sizing:border-box;' +
        'padding:0 26px ' + (SAFE_B + 22) + 'px;text-align:center;background:linear-gradient(180deg,' +
        'rgba(6,3,2,0) 26%,rgba(6,3,2,0.30) 42%,rgba(6,3,2,0.90) 58%,rgba(6,3,2,0.98) 100%);">' +
        '<div style="' + label + 'margin-bottom:5px;">Say it like you mean it</div>' +
        '<div style="font-size:70px;font-weight:900;letter-spacing:-0.04em;line-height:0.92;' +
          'background:linear-gradient(178deg,#fff3d8 6%,#e8b957 52%,#9d6a18);-webkit-background-clip:text;' +
          'background-clip:text;-webkit-text-fill-color:transparent;color:transparent;' +
          'text-shadow:0 8px 34px rgba(0,0,0,0.55);">Cheat</div>' +
        '<div style="font-size:14.5px;line-height:1.55;opacity:0.66;max-width:272px;margin-top:9px;">' +
          'Play your cards face down and name them. You may be telling the truth. ' +
          'Anyone can call it.</div>' +
        '<div style="' + label + 'margin:20px 0 9px;">Players</div>' +
        '<div data-el="seats" style="display:flex;gap:9px;width:210px;"></div>' +
        '<div style="width:100%;max-width:252px;">' +
          '<button data-el="names" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + 'font-size:14px;">Add names</button>' +
          '<button data-el="deal" style="' + bigBtn("linear-gradient(180deg,#f4d68d,#c8942b)", "#2a1704") +
            'letter-spacing:0.05em;">Deal</button>' +
        '</div>' +
      '</div>' +

      /* ---- names ---- */
      '<div data-el="namep" style="' + sheetCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="font-size:19px;font-weight:800;">Who is playing?</div>' +
          '<div style="font-size:12.5px;opacity:0.55;margin:5px 0 14px;">Leave any blank and it fills itself in. ' +
            'Names go on the handover screen, so use the ones people answer to.</div>' +
          '<div data-el="namelist"></div>' +
          '<button data-el="namep-close" style="' + bigBtn("linear-gradient(180deg,#f4d68d,#c8942b)", "#2a1704") + '">Done</button>' +
        '</div>' +
      '</div>' +

      /* ---- pass-the-phone cover ----
       *
       * The load-bearing screen. Everything private is behind it. It lifts on
       * a TAP rather than a hold, because the screen underneath has to be
       * tapped several times and holding a cover open takes a third hand;
       * exposure is bounded by the player's own commit instead. ---- */
      '<div data-el="cover" style="position:absolute;inset:0;display:none;flex-direction:column;' +
        'align-items:center;justify-content:center;z-index:70;padding:26px;text-align:center;' +
        'box-sizing:border-box;pointer-events:auto;background:radial-gradient(115% 55% at 50% 42%,' +
        'rgba(28,13,9,0.985),rgba(3,1,1,1));">' +
        '<div data-el="cover-turn" style="' + label + 'font-size:10px;margin-bottom:14px;"></div>' +
        '<div style="' + label + '">Pass the phone to</div>' +
        '<div data-el="cover-name" style="font-size:46px;font-weight:900;line-height:1.04;' +
          'margin:5px 0 4px;letter-spacing:-0.02em;"></div>' +
        '<div style="font-size:13px;opacity:0.55;">and nobody else looks</div>' +
        '<div style="height:1px;width:120px;background:rgba(227,182,87,0.28);margin:20px 0;"></div>' +
        '<div style="' + label + 'font-size:10px;">You must claim</div>' +
        '<div data-el="cover-claim" style="font-size:31px;font-weight:900;letter-spacing:0.02em;' +
          'margin-top:3px;"></div>' +
        // Everybody's count and the size of the pile, which are public at a
        // real table and are the only evidence you have when you are deciding
        // how brazen to be. Without them the handover screen is a dead beat.
        '<div data-el="cover-table" style="display:flex;flex-wrap:wrap;gap:7px;' +
          'justify-content:center;margin-top:22px;max-width:300px;"></div>' +
        '<div data-el="cover-pile" style="font-size:11.5px;opacity:0.48;margin-top:13px;' +
          'letter-spacing:0.10em;"></div>' +
        '<div style="width:100%;max-width:290px;">' +
          '<button data-el="cover-btn" style="' + bigBtn("#fff", "#1a0a03") + 'margin-top:26px;"></button>' +
        '</div>' +
        '<div style="font-size:12px;opacity:0.40;margin-top:14px;line-height:1.5;">' +
          'Only you should see the next screen.<br>It covers itself again the moment you play.</div>' +
      '</div>' +

      /* ---- game over ---- */
      '<div data-el="over" style="position:absolute;inset:0;display:none;flex-direction:column;' +
        'align-items:center;justify-content:center;z-index:60;padding:24px;text-align:center;' +
        'box-sizing:border-box;pointer-events:auto;background:radial-gradient(120% 60% at 50% 45%,' +
        'rgba(22,10,7,0.86),rgba(3,1,1,0.98));">' +
        // The result turned round for the other end of the table. A bare
        // rotated headline reads as a stray duplicate word floating on
        // nothing, so it is the same plate as the main one, just compact.
        '<div style="transform:rotate(180deg);max-width:300px;width:100%;margin-bottom:14px;' +
          'background:linear-gradient(180deg,#2a130e,#150907);border-radius:18px;padding:11px 16px 12px;' +
          'box-shadow:inset 0 0 0 1px rgba(227,182,87,0.24),0 14px 36px rgba(0,0,0,0.5);">' +
          '<div style="' + label + 'font-size:9.5px;">Hand over</div>' +
          '<div data-el="over-mirror-name" style="font-size:24px;font-weight:900;margin-top:2px;' +
            'letter-spacing:-0.02em;line-height:1.15;"></div>' +
          '<div data-el="over-mirror-sub" style="font-size:11px;opacity:0.55;margin-top:3px;"></div>' +
        '</div>' +
        '<div style="' + panel + 'max-width:300px;padding:20px;">' +
          '<div style="' + label + '">Hand over</div>' +
          '<div data-el="over-name" style="font-size:34px;font-weight:900;margin-top:4px;' +
            'letter-spacing:-0.02em;line-height:1.1;"></div>' +
          '<div data-el="over-sub" style="font-size:12.5px;opacity:0.56;margin-top:4px;"></div>' +
          '<div data-el="over-stats" style="display:flex;gap:7px;margin:16px 0 8px;"></div>' +
          '<div style="font-size:10.5px;opacity:0.42;line-height:1.45;">The bluff run is the ' +
            'table’s: how many lies got past everybody before one was caught. It goes to the ' +
            'global board, and is never shown mid-game.</div>' +
          '<div style="height:1px;background:rgba(227,182,87,0.20);margin:14px 0 10px;"></div>' +
          '<div data-el="over-rows"></div>' +
        '</div>' +
        '<div style="width:100%;max-width:300px;">' +
          '<button data-el="again" style="' + bigBtn("linear-gradient(180deg,#f4d68d,#c8942b)", "#2a1704") + '">Deal again</button>' +
          '<button data-el="quit" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + '">Change players</button>' +
        '</div>' +
      '</div>' +

      /* ---- settings ---- */
      '<div data-el="cogp" style="' + sheetCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:16px;">Settings</div>' +
          '<div style="' + label + '">Sound</div>' +
          '<div data-el="mutes" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Call window</div>' +
          '<div data-el="wins" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Mark my real cards</div>' +
          '<div data-el="hints" style="display:flex;gap:8px;margin:9px 0 6px;"></div>' +
          '<div style="font-size:11.5px;opacity:0.42;margin-bottom:16px;">A brass edge on the cards ' +
            'that really are the claimed rank. Only ever on your own screen.</div>' +
          '<div style="' + label + '">Players</div>' +
          '<div data-el="counts" style="display:flex;gap:8px;margin:9px 0 4px;"></div>' +
          '<div style="font-size:12px;opacity:0.42;margin-top:8px;">Changes apply on the next deal.</div>' +
          '<button data-el="cogp-close" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + 'margin-top:16px;">Done</button>' +
          '<button data-el="leave" style="' + bigBtn("rgba(255,90,83,0.16)", "#ff9b95", "rgba(255,90,83,0.42)") +
            'display:none;font-size:14px;">Leave this game</button>' +
        '</div>' +
      '</div>' +

      /* ---- how to play ---- */
      '<div data-el="helpp" style="' + sheetCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:13.5px;line-height:1.6;opacity:0.87;padding-left:18px;margin:0;">' +
            '<li style="margin-bottom:6px;">The whole deck is dealt out. Everybody holds their cards secretly.</li>' +
            '<li style="margin-bottom:6px;">The claim marches round in rank order — <b>Aces, Twos, Threes…</b> ' +
              'wrapping after Kings. It never waits for what you are holding.</li>' +
            '<li style="margin-bottom:6px;">On your turn the phone is yours. Tap <b>1–4 cards</b> and play them ' +
              '<b>face down</b>, claiming them as the current rank.</li>' +
            '<li style="margin-bottom:6px;">They do not have to be that rank. <b>Lying is the game.</b></li>' +
            '<li style="margin-bottom:6px;">Then the phone goes flat and everyone else gets a <b>CHEAT</b> button ' +
              'on their own edge, all live at once. First call wins.</li>' +
            '<li style="margin-bottom:6px;">Called and lying → <b>you take the whole pile</b>. ' +
              'Called and honest → <b>the caller takes it</b>.</li>' +
            '<li style="margin-bottom:6px;">Nobody calls and the cards stay face down for good.</li>' +
            '<li style="margin-bottom:6px;">First to empty their hand wins — but the last play still has to ' +
              'survive its challenge window.</li>' +
            '<li>The table’s longest unbroken run of lies goes to the global board. It is never shown ' +
              'mid-game, because that would tell the room what the cards are hiding.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + 'margin-top:16px;">Got it</button>' +
        '</div>' +
      '</div>';

    const shell = {
      el: (n) => root.querySelector('[data-el="' + n + '"]'),
      tap: (node, fn) => {
        if (!node) return;
        ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
        ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
      },
    };

    /** A row of segmented pills, the only control this bit needs. */
    function pills(host, values, labels, get, set) {
      if (!host) return null;
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;padding:11px 0;border:none;border-radius:12px;' +
        'font-family:inherit;font-size:13.5px;font-weight:700;pointer-events:auto;">' + labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          // A brass chip, the same metal as the Deal button. At 30% over the
          // panel's oxblood the selected chip mixed down to a muddy brown that
          // read as the disabled one, which is the whole job of a segmented
          // control undone.
          b.style.background = on
            ? "linear-gradient(180deg,#f4d68d,#c8942b)"
            : "linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))";
          b.style.color = on ? "#2a1704" : "rgba(247,237,217,0.60)";
          b.style.boxShadow = on
            ? "inset 0 1px 0 rgba(255,250,232,0.55),0 2px 8px rgba(0,0,0,0.4)"
            : "inset 0 0 0 1px rgba(227,182,87,0.16)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        shell.tap(b, () => {
          set(Number(b.dataset.v));
          saveSettings();
          paintAllPills();
          sound.haptic("light");
          sound.sting("tap");
        });
      }
      paint();
      return paint;
    }
    let repaints = [];
    function paintAllPills() { for (const f of repaints) f(); }
    function wirePills() {
      repaints = [
        pills(shell.el("seats"), [3, 4, 5], ["3", "4", "5"],
          () => settings.players, (v) => {
            settings.players = v;
            if (phase === "menu") { layout(); bakeRoom(); }
            renderNames();
          }),
        pills(shell.el("counts"), [3, 4, 5], ["3", "4", "5"],
          () => settings.players, (v) => { settings.players = v; renderNames(); }),
        pills(shell.el("wins"), [0, 1, 2], ["Quick", "Normal", "Slow"],
          () => settings.window, (v) => { settings.window = v; }),
        pills(shell.el("hints"), [1, 0], ["On", "Off"],
          () => settings.hints, (v) => { settings.hints = v; }),
        pills(shell.el("mutes"), [0, 1], ["On", "Muted"],
          () => (sound.muted ? 1 : 0), (v) => {
            if ((v === 1) !== sound.muted) { sound.toggle(); paintMute(); }
          }),
      ].filter(Boolean);
    }

    /** The name sheet. Player text is escaped before it can reach innerHTML. */
    function renderNames() {
      const host = shell.el("namelist");
      if (!host) return;
      host.innerHTML = Array.from({ length: settings.players }, (_, i) =>
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px;">' +
          '<span style="width:11px;height:11px;border-radius:50%;flex:none;background:' + IDENT[i].ink + ';"></span>' +
          '<input data-el="name-' + i + '" maxlength="12" placeholder="' + IDENT[i].name + '" ' +
            'value="' + esc(names[i] || "") + '" autocomplete="off" autocorrect="off" ' +
            'style="flex:1;min-width:0;padding:12px 14px;border-radius:13px;pointer-events:auto;' +
            'border:1px solid rgba(227,182,87,0.22);background:rgba(255,255,255,0.06);' +
            'color:' + CREAM + ';font-family:inherit;font-size:16px;">' +
        '</div>').join("");
    }
    function harvestNames() {
      names = [];
      for (let i = 0; i < 5; i++) {
        const el = shell.el("name-" + i);
        names.push(el ? String(el.value || "").trim().slice(0, 12) : "");
      }
      settings.names = names;
      saveSettings();
    }

    /** One glyph, struck through when muted — an emoji speaker would drag a
     *  second colour palette into a very deliberate one. */
    function paintMute() {
      const b = shell.el("mute");
      b.style.textDecoration = sound.muted ? "line-through" : "none";
      b.style.opacity = sound.muted ? "0.45" : "1";
    }

    /** Open or close a full-screen sheet, freezing the hand while it is up. */
    function showSheet(name, open) {
      shell.el(name).style.display = open ? "flex" : "none";
      if (open === sheetOpen) return;
      sheetOpen = open;
      if (open) { sheetSince = performance.now(); return; }
      // Give back the time the panel was up, or an open challenge window would
      // bill the reader for it and expire while nobody could see it.
      const held = performance.now() - sheetSince;
      for (const e of pile) if (e.flip0) e.flip0 += held;
      for (const f of flyers) f.t0 += held;
    }

    wirePills();
    renderNames();
    paintMute();

    shell.tap(shell.el("mute"), () => { sound.toggle(); paintMute(); paintAllPills(); });
    shell.tap(shell.el("cog"), () => {
      shell.el("leave").style.display = phase === "menu" || phase === "over" ? "none" : "block";
      showSheet("cogp", true);
      paintAllPills();
    });
    shell.tap(shell.el("cogp-close"), () => { showSheet("cogp", false); });
    shell.tap(shell.el("help"), () => { showSheet("helpp", true); });
    shell.tap(shell.el("helpp-close"), () => { showSheet("helpp", false); });
    shell.tap(shell.el("names"), () => { renderNames(); showSheet("namep", true); });
    shell.tap(shell.el("namep-close"), () => { harvestNames(); showSheet("namep", false); });

    async function deal() {
      harvestNames();
      ctx.platform.start({ players: settings.players });
      await sound.unlock();
      shell.el("menu").style.display = "none";
      newMatch();
    }
    shell.tap(shell.el("deal"), deal);
    shell.tap(shell.el("cover-btn"), () => reveal());
    shell.tap(shell.el("again"), () => {
      shell.el("over").style.display = "none";
      newMatch();
      ctx.platform.interact({ type: "replay" });
    });
    function toMenu() {
      shell.el("over").style.display = "none";
      shell.el("cover").style.display = "none";
      phase = "menu";
      players = [];
      pile = [];
      pendingTake = null;
      claim = null;
      picked.length = 0;
      flyers.length = 0;
      banner = null;
      layout(); bakeRoom();
      shell.el("menu").style.display = "flex";
      paintAllPills();
    }
    shell.tap(shell.el("quit"), toMenu);
    shell.tap(shell.el("leave"), () => { showSheet("cogp", false); toMenu(); });

    /* ===============================================================
     * INPUT
     *
     * A pointer is bound to a seat the moment it lands and keeps that
     * seat until it lifts; a seat that already has a live pointer refuses
     * any more. Without both, one player's stray hand drives a
     * neighbour's call button, or one person quietly owns two of them.
     *
     * offsetX/offsetY are measured against e.target, so everything the
     * game surface needs is on the canvas itself — no child element can
     * become the target and report coordinates in its own frame.
     * ============================================================= */
    const owners = new Map();       // pointerId -> seat name
    const held = new Set();         // seats with a live pointer

    function seatAt(x, y) {
      for (const p of players) {
        const R = L.pads[p.seat];
        if (!R) continue;
        // The hit box is grown a little past the paint: a call button that has
        // to be hit exactly is a call button somebody loses a race on.
        if (x >= R.x - 6 && x <= R.x + R.w + 6 && y >= R.y - 6 && y <= R.y + R.h + 6) return p.seat;
      }
      return null;
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      const x = e.offsetX, y = e.offsetY;
      if (sheetOpen) return;

      if (phase === "place") {
        const i = handHit(x, y);
        if (i >= 0) { togglePick(i); e.preventDefault(); return; }
        const R = L.commit;
        if (x >= R.x && x <= R.x + R.w && y >= R.y && y <= R.y + R.h) {
          const p = players[turn];
          if (p) p.press = 1;
          if (!picked.length) { sound.haptic("warning"); sound.sting("fail"); return; }
          commit();
          e.preventDefault();
        }
        return;
      }

      if (phase === "challenge" || phase === "settle" || phase === "reveal" || phase === "verdict") {
        const seat = seatAt(x, y);
        if (!seat) return;
        if (held.has(seat)) return;                 // that pad already has a hand on it
        if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
        owners.set(e.pointerId, seat);
        held.add(seat);
        const i = players.findIndex((p) => p.seat === seat);
        if (i < 0) return;
        players[i].press = 1;
        if (phase === "challenge" && challengeOpen && claim && i !== claim.by) callCheat(i);
        else sound.haptic("light");
        e.preventDefault();
      }
    }, { passive: false });

    const release = (e) => {
      const seat = owners.get(e.pointerId);
      if (!seat) return;
      owners.delete(e.pointerId);
      held.delete(seat);
    };
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    /* ===============================================================
     * RESIZE — the room is measured from the container, so a rotation or
     * a keyboard has to remeasure and rebake rather than stretch.
     * ============================================================= */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      canvas.width = Math.round(ctx.width * dpr);
      canvas.height = Math.round(ctx.height * dpr);
      // Writing canvas.width RESETS the 2D transform to the identity, so the
      // DPR scale ctx.createCanvas2D() installed at boot is gone and every
      // following frame draws at 1:1 in physical pixels — the whole game
      // shrinks into the top-left corner. It has to be re-applied here.
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout();
      bakeRoom();
      planHand();
    });

    /* ===============================================================
     * A read-only window on the game, so the local harness can drive a
     * real hand and assert on what actually happened. It exposes nothing
     * a person at the table cannot already see EXCEPT the current
     * holder's own hand — which is exactly what the person holding the
     * phone is looking at.
     * ============================================================= */
    window.__CHEAT__ = {
      get phase() { return phase; },
      get busy() { return busy(); },
      get turn() { return turn; },
      get turnNo() { return turnNo; },
      get rank() { return RANKS[rankIdx]; },
      get pile() { return pile.length; },
      get claim() { return claim ? { by: claim.by, rank: claim.rank, n: claim.n, lie: claim.lie } : null; },
      get open() { return challengeOpen; },
      get caller() { return caller; },
      get picked() { return picked.slice(); },
      // Only while the cover is actually up off the screen. A probe that can
      // read a hand behind the cover lets a test peek at something no person
      // at the table can see, and then quietly assert on it.
      get hand() {
        return phase === "place" && players[turn] ? players[turn].hand.map((c) => c.id) : [];
      },
      get players() {
        return players.map((p) => ({ name: p.name, seat: p.seat, cards: p.hand.length }));
      },
      get winner() { return winner ? winner.name : null; },
      get bestRun() { return bestRun; },
      get caught() { return callsRight; },
      get badCalls() { return callsWrong; },
      get baked() { return BAKED; },
      get paused() { return sheetOpen; },
      handXY(i) { const s = handSlot(i); return { x: s.x, y: s.y - (picked.indexOf(i) >= 0 ? 18 : 0) }; },
      padXY(seat) { return padCentre(seat); },
      commitXY() { return { x: L.commit.x + L.commit.w / 2, y: L.commit.y + L.commit.h / 2 }; },
    };
    ctx.onDestroy(() => { try { delete window.__CHEAT__; } catch (_) {} });

    // The room and the title fan are on screen before ready() is called, so the
    // host never shows a blank bit for a single frame.
    render(performance.now());
    ctx.markVisualReady("table drawn");
    ctx.platform.ready();
  },
};
