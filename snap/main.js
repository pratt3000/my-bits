/**
 * Snap — the card-table race, for two to four people around one phone.
 *
 * The phone lies flat in the middle of the table. Every player gets a slam pad
 * on the edge nearest them, turned the right way up for where they are
 * sitting. Cards flip onto one central pile on a timer; the instant a card
 * lands on another of the same rank, everybody's hand comes down at once and
 * the first one there takes the pile.
 *
 * Three decisions drive the whole build.
 *
 * The race is resolved strictly by the order the runtime delivered
 * `pointerdown`, inside the handler itself. Four hands landing in the same
 * frame produce four pointerdown events in delivery order; the first one to
 * arrive while the match window is open closes it, synchronously, before the
 * second handler runs. Nothing is deferred to a frame or a timeout, because a
 * frame boundary would collapse four distinct arrivals into one tie. Slams
 * that arrive after the pile is claimed are recorded as "late" and cost
 * nothing — being second is not a foul.
 *
 * A pointer is bound to a pad on pointerdown and keeps that pad for its whole
 * life, and a pad already holding a live pointer ignores extra ones. On a
 * shared screen the alternative is a stray finger driving somebody else's
 * control, or one player quietly owning two pads.
 *
 * The deck is stacked. A fair shuffle of 52 cards yields about three
 * rank-adjacent pairs, which is a dull forty seconds of watching cards go by.
 * After shuffling, the deck is walked and a matching partner is swapped
 * forward whenever four to nine cards have passed without one, so a snap
 * arrives every few seconds. It is still a real 52-card deck with every card
 * present exactly once — only the order is arranged.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so all 52
 * faces, the card back, the felt weave and the whole table are painted into
 * OffscreenCanvases at boot and blitted — with a live-drawing fallback for
 * WebViews that have no OffscreenCanvas. The overlay is one markup string on
 * ctx.createRoot() rather than document.createElement, pointer maths uses
 * offsetX/offsetY rather than getBoundingClientRect, and every soft shadow is
 * built from stacked translucent fills rather than a canvas blur filter — all
 * three are rejected at upload and none of them is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Snap",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "cards", "party", "reflex"],
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

    /** Escape anything that could ever be player-authored before it meets innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ===============================================================
     * PALETTE
     *
     * A card room at night: baize under one warm lamp, walnut rail,
     * brass inlay. Every player colour has to survive being laid on
     * green, so they are all warm-or-cold extremes rather than
     * mid-tones — a sage or olive player would disappear into the felt.
     * ============================================================= */
    const FELT_LIT = "#1d7150", FELT_MID = "#0f4b34", FELT_DARK = "#04150e";
    const RAIL = "#26160e", BRASS = "#d8a94a", BRASS_DIM = "rgba(216,169,74,0.40)";
    const CREAM = "#f4ecd8";
    const CARD_THEME = {
      face: "#f8f4e9", edge: "rgba(26,18,10,0.26)",
      red: "#c3202e", black: "#191720", accent: "#7e1f2c",
    };
    const SEATS = [
      { seat: "bottom", name: "Amber",  ink: "#f5b73c", rad: 0,            suit: "S" },
      { seat: "top",    name: "Rose",   ink: "#ff5d7a", rad: Math.PI,      suit: "H" },
      { seat: "left",   name: "Sky",    ink: "#52c7f5", rad: Math.PI / 2,  suit: "D" },
      { seat: "right",  name: "Violet", ink: "#b58cff", rad: -Math.PI / 2, suit: "C" },
    ];
    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const SERIF = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";

    const LAND_MS = 205;        // how long a card takes to turn over and settle
    const MIN_REACTION = 90;    // below this a "reaction" is a lucky mid-air mash
    const LOCK_S = 1.35;        // pad freeze after a false snap
    const DECK_N = 52;

    /* ===============================================================
     * SETTINGS — remembered between sessions.
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("snap") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 2, 2, 4),
      speed: saved.speed === undefined ? 1 : saved.speed,   // 0 slow / 1 brisk / 2 blitz
      rule: saved.rule === undefined ? 0 : saved.rule,      // 0 rank / 1 rank or suit
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("snap", settings); } catch (_) {} }
    const SPEED_MS = [1080, 830, 620];

    /* ===============================================================
     * SOUND — a low, smoky bed that tightens as the stock runs down,
     * with a cue on every moment that matters. All of it wrapped: audio
     * is a nicety and must never be able to break a hand of cards.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "lofi", volume: 0.30, tempo: 96, intensity: 0.25 });
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
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 220 }); bed = null; }
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
     * A 2D context on a bake surface.
     *
     * willReadFrequently pins the surface to the CPU backend, which is exactly
     * what a write-once blit source wants: a GPU-backed offscreen has to be
     * read back across the bus on every single drawImage, and a table with a
     * dozen cards on it does a dozen of those a frame. Measured here it is the
     * difference between one frame a second and a smooth one.
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
     * resource. Stacking progressively larger translucent fills gives the same
     * falloff for a fraction of the cost, and it is the only shadow in the bit.
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
     * frame, and measureText is one of the few canvas calls that is not cheap.
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

    /* ===============================================================
     * THE DECK — 52 faces drawn as canvas paths.
     *
     * There are no packaged assets, so pips, courts and the back are all
     * geometry. Each face is baked once at device scale and then
     * blitted, which keeps a nine-card pile to nine drawImage calls.
     * ============================================================= */
    const SUITS = [
      { id: "S", red: false }, { id: "H", red: true },
      { id: "D", red: true },  { id: "C", red: false },
    ];
    const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

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
     * the hundred pixels a phone gives a card. This is a single flat heraldic
     * figure — crown, face, mantle — reading as King, Queen or Jack purely by
     * its headwear, with the suit colour carrying everything else.
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

      // Features. Two dots and a line is the whole difference between a court
      // card and a hooded silhouette at this size.
      g.fillStyle = ink;
      for (const ex of [-0.115, 0.115]) {
        g.beginPath(); g.ellipse(fx + u * ex, fy - u * 0.36, u * 0.036, u * 0.045, 0, 0, TAU); g.fill();
      }
      g.beginPath();
      g.moveTo(fx - u * 0.09, fy - u * 0.18);
      g.quadraticCurveTo(fx, fy - u * 0.13, fx + u * 0.09, fy - u * 0.18);
      g.lineWidth = Math.max(0.8, w * 0.010);
      g.strokeStyle = ink; g.stroke();
      if (rank === "K") {                                 // beard, and only the King has one
        g.beginPath();
        g.moveTo(fx - u * 0.26, fy - u * 0.24);
        g.quadraticCurveTo(fx, fy + u * 0.22, fx + u * 0.26, fy - u * 0.24);
        g.quadraticCurveTo(fx, fy - u * 0.06, fx - u * 0.26, fy - u * 0.24);
        g.closePath(); g.fill();
      } else if (rank === "Q") {                          // hair falling either side
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

      // Stock: warm paper, very slightly darker toward the edges so a flat
      // rectangle still reads as a physical card under a lamp.
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      const paper = g.createLinearGradient(0, 0, w * 0.35, h);
      paper.addColorStop(0, "#fffdf6");
      paper.addColorStop(0.55, CARD_THEME.face);
      paper.addColorStop(1, "#ece4d2");
      g.fillStyle = paper; g.fill();
      g.strokeStyle = CARD_THEME.edge; g.lineWidth = Math.max(1, w * 0.008); g.stroke();

      roundRect(g, w * 0.035, h * 0.025, w * 0.93, h * 0.95, r * 0.72);
      g.strokeStyle = "rgba(30,22,14,0.075)"; g.lineWidth = Math.max(0.6, w * 0.006); g.stroke();

      // Corner index, mirrored into the far corner so the card reads from
      // either end the way a real one does.
      const cs = w * 0.155;
      const corner = (flip) => {
        g.save();
        if (flip) { g.translate(w, h); g.rotate(Math.PI); }
        g.fillStyle = ink;
        g.font = "700 " + cs + "px " + SERIF;
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.fillText(rank, w * 0.135, h * 0.135);
        suitPath(g, suitId, w * 0.135, h * 0.208, cs * 0.44);
        g.restore();
      };
      corner(false); corner(true);

      const cx = w * 0.5, cy = h * 0.5;
      if (PIPS[rank]) {
        // Nine and ten pack four rows into the same panel, so they get a
        // smaller pip on a taller spread — at one scale they collide.
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

    /** Paint the card back at (0,0): burgundy guilloché under a brass frame. */
    function paintCardBack(g, w, h) {
      const r = Math.min(w, h) * 0.085;
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      const base = g.createLinearGradient(0, 0, w, h);
      base.addColorStop(0, "#8f2534");
      base.addColorStop(0.55, CARD_THEME.accent);
      base.addColorStop(1, "#5d1520");
      g.fillStyle = base; g.fill();

      g.save();
      roundRect(g, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g.clip();
      g.strokeStyle = "rgba(255,226,190,0.13)";
      g.lineWidth = Math.max(0.7, w * 0.011);
      const step = w * 0.115;
      for (let i = -h; i < w + h; i += step) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
        g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
      }
      // Centre medallion: a brass lozenge with the four suits around it, which
      // is what stops the lattice from reading as wallpaper.
      g.translate(w / 2, h / 2);
      g.fillStyle = "rgba(0,0,0,0.20)";
      g.beginPath();
      g.moveTo(0, -h * 0.20); g.lineTo(w * 0.20, 0); g.lineTo(0, h * 0.20); g.lineTo(-w * 0.20, 0);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(216,169,74,0.62)"; g.lineWidth = Math.max(1, w * 0.012); g.stroke();
      g.fillStyle = "rgba(216,169,74,0.72)";
      suitPath(g, "S", 0, -h * 0.085, w * 0.052);
      suitPath(g, "H", 0, h * 0.085, w * 0.052);
      suitPath(g, "D", -w * 0.095, 0, w * 0.052);
      suitPath(g, "C", w * 0.095, 0, w * 0.052);
      g.restore();

      roundRect(g, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g.strokeStyle = "rgba(240,214,160,0.50)"; g.lineWidth = Math.max(1, w * 0.016); g.stroke();
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      g.strokeStyle = "rgba(0,0,0,0.30)"; g.lineWidth = Math.max(1, w * 0.008); g.stroke();
    }

    /** Bake all 52 faces plus the back once, then blit for the rest of the run. */
    function makeDeckArt(w, h, scale) {
      const faces = {};
      for (const s of SUITS) {
        for (const r of RANKS) {
          const surf = surface(w * scale, h * scale);
          if (!surf) return null;
          const g = surfCtx(surf);
          g.scale(scale, scale);
          paintCardFace(g, r, s.id, w, h);
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

    /**
     * Arrange the deck so snaps actually happen.
     *
     * A fair shuffle of 52 cards yields about three rank-adjacent pairs, which
     * is a party game where nothing happens for fifteen seconds at a stretch.
     * This lays the deck out card by card and, once three to seven have gone by
     * without a match, deliberately reaches into the remaining pool for a
     * partner to the card just laid. Every card is still present exactly once —
     * only the order is arranged. A snap arrives every five cards on average
     * and never later than the seventh card of the hand.
     *
     * The order is written back reversed, because the stock is dealt with
     * pop(). Building it forward and dealing it backward was the original bug:
     * plants fail near the end of the layout, where partners have run out, and
     * that end was the first thing anybody saw — whole half-decks went by with
     * no snap at all.
     *
     * On the rank-or-suit rule the natural density is already high, so a
     * natural pair counts as a plant and the reach-in almost never fires.
     */
    function stackDeck(deck, rng, sameSuitCounts) {
      const hit = (a, b) => a.rank === b.rank || (sameSuitCounts && a.suit === b.suit);
      const pool = deck.slice(), out = [];
      const nextGap = () => 3 + Math.floor(rng() * 5);
      let want = nextGap();
      while (pool.length) {
        const prev = out[out.length - 1];
        let idx = -1;
        if (prev && want <= 0) {
          for (let i = 0; i < pool.length; i++) {
            if (pool[i].rank === prev.rank) { idx = i; break; }
          }
        }
        if (idx < 0) idx = Math.floor(rng() * pool.length);
        const card = pool.splice(idx, 1)[0];
        if (prev && hit(card, prev)) want = nextGap();
        else want--;
        out.push(card);
      }
      for (let i = 0; i < deck.length; i++) deck[i] = out[out.length - 1 - i];
      return deck;
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
    const art = makeDeckArt(CARD_W, CARD_H, bake);

    /**
     * The card shadow, baked once.
     *
     * Live, it is five stacked translucent fills per card — twelve cards on the
     * table is sixty anti-aliased fills a frame, and it dominated the budget.
     * Baked it is a single blit, and being one-off it can afford sixteen steps
     * instead of five, so the falloff is smoother than the live version ever was.
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
        c.globalAlpha = 0.022;
        roundRect(c, SHADOW_PAD - sp, SHADOW_PAD - sp, CARD_W + sp * 2, CARD_H + sp * 2, CARD_R + sp * 0.7);
        c.fill();
      }
      return s;
    })();

    const L = {};
    function layout() {
      W = ctx.width; H = ctx.height;
      const st = ctx.safeArea.top, sb = ctx.safeArea.bottom;
      const n = settings.players;
      L.chrome = 46;
      L.sideW = n >= 3 ? Math.round(Math.min(84, W * 0.20)) : 0;
      L.endH = Math.round(H * (n >= 3 ? 0.185 : 0.213));

      // The two end pads are each shortened by the chrome column on the side
      // that is the player's own right — screen-right for the bottom player,
      // screen-left for the top one, who is sitting rotated 180 degrees. The
      // layout is therefore symmetric under the seat rotation, and it frees the
      // screen's top-right corner for the buttons without stealing from one
      // player only.
      L.rects = {
        top: { x: 12, y: st + 6, w: W - 24 - L.chrome, h: L.endH - 12 },
        bottom: { x: 12 + L.chrome, y: H - sb - L.endH + 6, w: W - 24 - L.chrome, h: L.endH - 12 },
      };
      L.bandTop = st + L.endH;
      L.bandBot = H - sb - L.endH;
      const bh = L.bandBot - L.bandTop;
      L.rects.left = { x: 8, y: L.bandTop + bh * 0.15, w: L.sideW - 16, h: bh * 0.70 };
      L.rects.right = { x: W - L.sideW + 8, y: L.bandTop + bh * 0.15, w: L.sideW - 16, h: bh * 0.70 };

      const usedL = n >= 3 ? L.sideW : 0;
      const usedR = n >= 4 ? L.sideW : 0;
      L.px = usedL + (W - usedL - usedR) / 2;
      L.py = (L.bandTop + L.bandBot) / 2;
      // The free band between the side pads. Anything centred on the table has
      // to fit inside it, or it is drawn across somebody's count.
      L.bandW = W - usedL - usedR;
      L.ringR = Math.min((W - usedL - usedR) / 2 - 12, bh / 2 - 16, 118);
      L.sx = L.px - 13;                       // the stock sits a hair behind the pile
      L.sy = L.py - 17;
    }
    layout();

    /** Which player's zone a screen point belongs to, or null for dead table. */
    function seatAt(x, y) {
      const n = players.length || settings.players;
      if (y >= L.bandBot && x > L.chrome) return "bottom";
      if (y <= L.bandTop && x < W - L.chrome) return "top";
      if (n >= 3 && x <= L.sideW && y > L.bandTop && y < L.bandBot) return "left";
      if (n >= 4 && x >= W - L.sideW && y > L.bandTop && y < L.bandBot) return "right";
      return null;
    }

    /* ===============================================================
     * THE TABLE — baked once, blitted every frame.
     *
     * Felt is a weave tile and a noise tile laid under a warm radial pool,
     * a printed layout circle, a walnut rail and a brass inlay. One
     * drawImage a frame for the entire background.
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
        const v = 90 + Math.random() * 165;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      return s;
    }
    const WEAVE = weaveTile(), NOISE = noiseTile();

    function paintTable(c, rich) {
      const pool = c.createRadialGradient(L.px, L.py - H * 0.05, 10, L.px, L.py, Math.max(W, H) * 0.80);
      pool.addColorStop(0.00, FELT_LIT);
      pool.addColorStop(0.30, "#166044");
      pool.addColorStop(0.58, FELT_MID);
      pool.addColorStop(1.00, FELT_DARK);
      c.fillStyle = pool;
      c.fillRect(0, 0, W, H);

      if (rich && WEAVE) {
        c.save();
        c.globalAlpha = 0.20;
        c.globalCompositeOperation = "overlay";
        c.fillStyle = c.createPattern(WEAVE, "repeat");
        c.fillRect(0, 0, W, H);
        c.restore();
      }
      if (rich && NOISE) {
        c.save();
        c.globalAlpha = 0.10;
        c.globalCompositeOperation = "overlay";
        c.fillStyle = c.createPattern(NOISE, "repeat");
        c.fillRect(0, 0, W, H);
        c.restore();
      }
      if (rich) {
        // Loose fibres. Baized cloth is never uniform, and a scatter of lit and
        // shadowed specks is what stops a gradient from reading as plastic.
        c.save();
        for (let i = 0; i < 1400; i++) {
          const x = Math.random() * W, y = Math.random() * H;
          const lit = Math.random() < 0.5;
          c.globalAlpha = (lit ? 0.05 : 0.055) * (1 - Math.hypot(x - L.px, y - L.py) / Math.max(W, H));
          c.fillStyle = lit ? "#cfeedd" : "#01120a";
          c.fillRect(x, y, 1 + Math.random() * 1.6, 1);
        }
        c.restore();
      }

      // A printed layout circle, the way a real table has its markings
      // pressed into the baize rather than painted on top.
      c.save();
      c.translate(L.px, L.py);
      c.strokeStyle = "rgba(255,246,215,0.055)";
      c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, L.ringR + 34, 0, TAU); c.stroke();
      c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, L.ringR + 40, 0, TAU); c.stroke();
      c.strokeStyle = "rgba(0,0,0,0.10)";
      c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, L.ringR + 36.5, 0, TAU); c.stroke();
      c.restore();

      // Lamp bloom. A stack of translucent discs bands visibly at this size,
      // so the falloff is a real radial gradient instead.
      c.save();
      c.globalCompositeOperation = "lighter";
      const bloom = c.createRadialGradient(L.px, L.py - H * 0.05, 0, L.px, L.py - H * 0.05, Math.max(W, H) * 0.62);
      bloom.addColorStop(0.00, "rgba(255,232,182,0.16)");
      bloom.addColorStop(0.35, "rgba(255,226,166,0.07)");
      bloom.addColorStop(0.70, "rgba(255,226,166,0.018)");
      bloom.addColorStop(1.00, "rgba(255,226,166,0)");
      c.fillStyle = bloom;
      c.fillRect(0, 0, W, H);
      c.restore();

      // Vignette, then the rail: walnut with a brass inlay just inside it.
      const vig = c.createRadialGradient(L.px, L.py, Math.min(W, H) * 0.30, L.px, L.py, Math.max(W, H) * 0.72);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.55)");
      c.fillStyle = vig;
      c.fillRect(0, 0, W, H);

      c.strokeStyle = RAIL;
      c.lineWidth = 18;
      c.strokeRect(-9, -9, W + 18, H + 18);
      c.lineWidth = 9;
      c.strokeStyle = "rgba(0,0,0,0.45)";
      c.strokeRect(-4.5, -4.5, W + 9, H + 9);
      roundRect(c, 10.5, 10.5, W - 21, H - 21, 16);
      c.strokeStyle = "rgba(216,169,74,0.16)";
      c.lineWidth = 1.2;
      c.stroke();
    }

    let table = null;
    function bakeTable() {
      const s = surface(W * bake, H * bake);
      if (!s) { table = null; return; }
      const c = surfCtx(s);
      c.scale(bake, bake);
      paintTable(c, true);
      table = s;
    }
    bakeTable();

    /* ===============================================================
     * STATE
     * ============================================================= */
    let phase = "menu";            // menu | deal | count | playing | resolve | over
    let players = [];
    let stock = [], pile = [];
    let matchOpen = false, matchAt = 0, graceUntil = 0;
    let flipTimer = 0, flipEvery = SPEED_MS[settings.speed];
    let dealT = 0, countT = 0, resolveT = 0;
    let shake = 0, missPulse = 0, ringPulse = 0;
    let flash = { a: 0, ink: "#fff" };
    let banner = null;
    let bestMs = 0, lastSnap = null, winner = null, matchStart = 0;
    // A sheet covering the screen stops the hand. Cards would otherwise keep
    // flipping behind a settings panel nobody can slam through, and the open
    // match window would charge whoever opened it for the reading time.
    let sheetOpen = false, sheetSince = 0;
    const claims = [];             // every slam this match, in delivery order

    function makePlayers(n) {
      return SEATS.slice(0, n).map((s) => ({
        seat: s.seat, name: s.name, ink: s.ink, rad: s.rad, suit: s.suit,
        cards: 0, held: null, lock: 0, press: 0, flashT: 0, bad: 0,
      }));
    }

    function newMatch() {
      layout();
      bakeTable();
      players = makePlayers(settings.players);
      const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
      stock = freshDeck(rng);
      if (settings.rule === 0) stackDeck(stock, rng, false);
      pile = [];
      claims.length = 0;
      matchOpen = false; graceUntil = 0; matchAt = 0;
      bestMs = 0; lastSnap = null; winner = null;
      banner = null; shake = 0; missPulse = 0; flash.a = 0;
      flyers.length = 0;
      for (const p of parts) p.life = 0;
      flipEvery = SPEED_MS[settings.speed];
      dealT = 0; countT = 0; resolveT = 0;
      matchStart = performance.now();
      phase = "deal";
      sound.heat(0.25);
    }

    /* ===============================================================
     * PARTICLES + FLYING CARDS
     * ============================================================= */
    const parts = [];
    for (let i = 0; i < 130; i++) parts.push({ life: 0 });
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
          vx: Math.cos(a) * 42, vy: Math.sin(a) * 26 - 8, gr: 40, drag: 0.90,
          life: 0.26 + Math.random() * 0.2, col: "rgba(255,244,214,0.5)", kind: "spark",
          size: 2 + Math.random() * 3,
        });
      }
    }
    function stepParts(dt) {
      for (const p of parts) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gr * dt;
        p.vx *= p.drag; p.vy *= p.drag;
        p.rot += p.vr * dt;
      }
    }

    const flyers = [];
    function fly(o) { if (flyers.length < 14) flyers.push(o); }
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
     * GAME LOGIC
     * ============================================================= */
    function matches(a, b) {
      if (!a || !b) return false;
      return a.rank === b.rank || (settings.rule === 1 && a.suit === b.suit);
    }

    function flipCard(now) {
      // A window that nobody claimed closes the moment the next card leaves the
      // stock — in Snap you miss it, the pile does not wait for you.
      if (matchOpen) { matchOpen = false; missPulse = 1; }
      if (!stock.length) { phase = "resolve"; resolveT = 1.4; return; }
      const card = stock.pop();
      const a = Math.random() * TAU, d = 7 + Math.random() * 6;
      pile.push({
        card, landed: false, t0: now,
        rot: (Math.random() - 0.5) * 0.32,
        ox: Math.cos(a) * d, oy: Math.sin(a) * d,
      });
      const prog = 1 - stock.length / DECK_N;
      // The deal quickens as the stock empties. Nothing dramatic — just enough
      // that the last dozen cards feel like the last dozen cards.
      flipEvery = SPEED_MS[settings.speed] * (1 - 0.22 * prog);
      sound.heat(0.25 + 0.65 * prog);
    }

    function landed(e, now) {
      e.landed = true;
      puff(L.px + e.ox, L.py + e.oy);
      sound.sting("tap");
      sound.haptic("light");
      const top = pile[pile.length - 1], under = pile[pile.length - 2];
      if (top === e && under && matches(top.card, under.card)) openMatch(now);
    }

    function openMatch(now) {
      matchOpen = true;
      matchAt = now;
      ringPulse = 1;
      sound.sting("danger");
      sound.haptic("warning");
      ctx.platform.interact({ type: "match" });
    }

    /**
     * The race, resolved inside the pointerdown handler.
     *
     * Everything here is synchronous on purpose. Four hands landing in the same
     * frame arrive as four pointerdown events in delivery order; the first to
     * reach this function while the window is open closes it before the second
     * handler runs, so there is exactly one winner and no tie to break. Deferring
     * any part of it to a frame would collapse those four arrivals into one.
     */
    function claimPile(p, now) {
      const ms = Math.max(1, Math.round(now - matchAt));
      matchOpen = false;
      graceUntil = now + 900;                 // everyone else is late, not wrong
      claims.push({ seat: p.seat, verdict: "snap", ms });

      const n = pile.length;
      const target = padCentre(p.seat);
      for (const e of pile.slice(-7)) {
        fly({
          card: e.card, t0: now, dur: 330,
          x0: L.px + e.ox, y0: L.py + e.oy, r0: e.rot,
          x1: target.x, y1: target.y, r1: e.rot + (Math.random() - 0.5) * 1.4,
          s1: 0.34,
        });
      }
      p.cards += n;
      pile.length = 0;

      lastSnap = { seat: p.seat, name: p.name, ms, n };
      if (ms >= MIN_REACTION && (bestMs === 0 || ms < bestMs)) bestMs = ms;
      banner = { t0: now, ink: p.ink, rad: p.rad, life: clamp(flipEvery * 1.6, 900, 1700),
        big: p.name.toLowerCase() + " SNAPS", small: "+" + n + " cards   ·   " + ms + " ms" };

      p.flashT = 1;
      shake = 1;
      flash.a = 0.8; flash.ink = p.ink;
      burst(L.px, L.py, p.ink, 34, 340);
      sound.duck(0.55, 420);
      sound.sting("win");
      sound.haptic("heavy");
      ctx.platform.setScore(players.reduce((m, q) => Math.max(m, q.cards), 0));
      ctx.platform.milestone("snap", { by: p.name, ms, cards: n });
      if (p.cards >= DECK_N) { phase = "resolve"; resolveT = 1.0; }
    }

    /** A slam with nothing to snap at: one card off your pile, back to the table. */
    function falseSnap(p, now) {
      claims.push({ seat: p.seat, verdict: "false", ms: 0 });
      p.lock = LOCK_S;
      p.bad = 1;
      if (p.cards > 0) {
        p.cards--;
        const from = padCentre(p.seat);
        fly({
          card: null, t0: now, dur: 340, s1: 1,
          x0: from.x, y0: from.y, r0: p.rad,
          x1: L.px, y1: L.py, r1: (Math.random() - 0.5) * 0.4,
        });
        // Forfeited cards go under the pile, face down. On top they would blank
        // out the card the next flip has to match against, which would turn a
        // penalty into a shield.
        const a = Math.random() * TAU, d = 7 + Math.random() * 6;
        pile.unshift({
          card: null, landed: true, t0: now - LAND_MS,
          rot: (Math.random() - 0.5) * 0.32, ox: Math.cos(a) * d, oy: Math.sin(a) * d,
        });
      }
      flash.a = 0.42; flash.ink = "#ff4a4a";
      shake = Math.max(shake, 0.45);
      burst(padCentre(p.seat).x, padCentre(p.seat).y, "#ff4a4a", 10, 190);
      sound.sting("fail");
      sound.haptic("error");
      ctx.platform.interact({ type: "false_snap", by: p.name });
    }

    function padCentre(seat) {
      const r = L.rects[seat];
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }

    async function endMatch() {
      phase = "over";
      let best = -1, tie = false;
      winner = null;
      for (const p of players) {
        if (p.cards > best) { best = p.cards; winner = p; tie = false; }
        else if (p.cards === best) tie = true;
      }
      if (tie) winner = null;

      const wrap = shell.el("over-title");
      wrap.textContent = winner ? winner.name + " wins" : "Dead heat";
      wrap.style.color = winner ? winner.ink : CREAM;
      const mirror = shell.el("over-mirror");
      mirror.textContent = winner ? winner.name + " wins" : "Dead heat";
      mirror.style.color = winner ? winner.ink : CREAM;
      shell.el("over-mirror-rows").innerHTML = players.map((p) =>
        '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;">' +
          '<span style="width:8px;height:8px;border-radius:3px;background:' + p.ink + ';"></span>' +
          '<span style="opacity:0.72;">' + esc(p.name) + '</span>' +
          '<b style="font-weight:700;">' + p.cards + '</b>' +
        '</span>').join("");
      const dead = pile.length;
      // Only claim nobody snapped when nobody did. A hand where every claim
      // came in under the reaction floor still had snaps in it, and saying
      // otherwise in front of the people who made them is simply wrong.
      const taken = claims.reduce((n, c) => n + (c.verdict === "snap" ? 1 : 0), 0);
      shell.el("over-sub").textContent = bestMs > 0
        ? "fastest snap " + bestMs + " ms"
        : taken > 0
          ? taken + (taken === 1 ? " snap taken" : " snaps taken")
          : "not one clean snap all deck";
      shell.el("over-rows").innerHTML = players.map((p) =>
        '<div style="display:flex;align-items:center;gap:10px;margin:8px 0;">' +
          '<div style="width:9px;height:9px;border-radius:3px;background:' + p.ink + ';flex:none;"></div>' +
          '<div style="width:58px;font-size:13px;opacity:0.82;flex:none;">' + esc(p.name) + '</div>' +
          '<div style="flex:1;height:8px;border-radius:5px;background:rgba(255,255,255,0.09);overflow:hidden;">' +
            '<div style="width:' + Math.round(p.cards / DECK_N * 100) + '%;height:100%;border-radius:5px;background:' + p.ink + ';"></div>' +
          '</div>' +
          '<div style="width:26px;text-align:right;font-size:15px;font-weight:700;flex:none;">' + p.cards + '</div>' +
        '</div>').join("") +
        // Whatever was still on the table when the stock ran out belongs to
        // nobody, and the arithmetic looks broken unless it says so.
        (dead ? '<div style="font-size:11.5px;opacity:0.45;margin-top:13px;letter-spacing:0.04em;">' +
          dead + ' left unclaimed on the table</div>' : "");
      shell.el("over").style.display = "flex";

      sound.duck(0.5, 500);
      sound.sting(winner ? "success" : "lose");
      sound.haptic(winner ? "success" : "warning");
      if (winner) burst(L.px, L.py, winner.ink, 44, 380);

      ctx.platform.complete({
        winner: winner ? winner.name : "draw",
        counts: players.map((p) => ({ name: p.name, cards: p.cards })),
        fastestSnapMs: bestMs,
        durationMs: Math.round(performance.now() - matchStart),
      });
      // The record belongs to the match, not to one of the people sharing the
      // phone: the fastest hand that came down on this table tonight.
      try {
        if (bestMs > 0) await ctx.memory.record("fastest_snap").submit(bestMs, { label: bestMs + " ms" });
      } catch (_) { /* offline is fine; the hand still finished */ }
    }

    /* ===============================================================
     * DRAWING
     * ============================================================= */
    /**
     * One card's shadow. Separate from the card so a cluster of them can share
     * a single shadow: seven cards converging on the same spot stack seven
     * shadows, and the deck arrives wearing a black hole instead.
     */
    function cardShadow(x, y, rot, scale, lift) {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      if (shadowArt) {
        // The higher the card, the wider and fainter the shadow it throws.
        const spread = 1 + lift * 1.7;
        const sw = (CARD_W + SHADOW_PAD * 2) * scale * spread;
        const sh = (CARD_H + SHADOW_PAD * 2) * scale * spread;
        g.globalAlpha = clamp(1 - lift * 0.9, 0.25, 1);
        g.drawImage(shadowArt, -sw / 2, -sh / 2 + (3 + lift * 12) * scale, sw, sh);
        g.globalAlpha = 1;
      } else {
        dropShadow(g, CARD_W * scale, CARD_H * scale, CARD_R * scale, lift);
      }
      g.restore();
    }

    function drawCardAt(x, y, rot, scale, card, faceUp, lift, shadow) {
      const w = CARD_W * scale, h = CARD_H * scale;
      if (shadow !== false) cardShadow(x, y, rot, scale, lift);
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      const src = faceUp ? (art && art.faces[card.id]) : (art && art.back);
      if (src) {
        g.drawImage(src, -w / 2, -h / 2, w, h);
      } else {
        // No OffscreenCanvas on this WebView: paint the card live. Plainer to
        // run, identical to look at, never a blank rectangle.
        g.save();
        g.translate(-w / 2, -h / 2);
        g.scale(scale, scale);
        if (faceUp) paintCardFace(g, card.rank, card.suit, CARD_W, CARD_H);
        else paintCardBack(g, CARD_W, CARD_H);
        g.restore();
      }
      g.restore();
    }

    function drawStock(now) {
      const n = stock.length;
      if (n <= 0) return;
      const layers = Math.min(7, Math.ceil(n / 8));
      for (let i = layers; i >= 1; i--) {
        const k = i / layers;
        g.save();
        g.translate(L.sx - i * 1.1, L.sy - i * 1.4);
        g.rotate(-0.035 + i * 0.004);
        const w = CARD_W, h = CARD_H;
        g.globalAlpha = 0.55 + 0.45 * (1 - k);
        if (i === 1) g.globalAlpha = 1;
        if (i > 1) {
          roundRect(g, -w / 2, -h / 2, w, h, CARD_R);
          g.fillStyle = "#5d1520"; g.fill();
          g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 1; g.stroke();
        }
        g.globalAlpha = 1;
        g.restore();
      }
      drawCardAt(L.sx - 1.1, L.sy - 1.4, -0.031, 1, null, false, 0.06);

      // A brass count plate riveted to the layout ring, so nobody has to guess
      // how much table is left. Drawn twice, back to back, for the two end
      // seats — the ring itself carries the same reading for the side seats.
      const txt = String(n);
      for (const rad of [0, Math.PI]) {
        g.save();
        g.translate(L.px, L.py);
        g.rotate(rad);
        g.translate(0, L.ringR);
        g.font = "700 11px " + FONT;
        g.textAlign = "center"; g.textBaseline = "middle";
        const plateW = g.measureText(txt).width + 22;
        roundRect(g, -plateW / 2, -9, plateW, 18, 9);
        g.fillStyle = "rgba(8,22,15,0.72)"; g.fill();
        g.strokeStyle = BRASS_DIM; g.lineWidth = 1; g.stroke();
        g.fillStyle = BRASS;
        g.fillText(txt, 0, 0.5);
        g.restore();
      }
    }

    /** The depletion ring: how much stock is left, readable from any seat. */
    function drawRing(now) {
      const prog = stock.length / DECK_N;
      g.save();
      g.translate(L.px, L.py);
      g.lineCap = "round";

      g.strokeStyle = "rgba(255,244,214,0.09)";
      g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, L.ringR, 0, TAU); g.stroke();

      if (matchOpen) {
        const pulse = 0.55 + 0.45 * Math.sin(now * 0.020);
        for (let i = 1; i <= 5; i++) {
          g.globalAlpha = 0.11 * (1 - i / 6) * pulse;
          g.strokeStyle = BRASS;
          g.lineWidth = i * 5;
          g.beginPath(); g.arc(0, 0, L.ringR + i * 2.5, 0, TAU); g.stroke();
        }
        g.globalAlpha = 1;
      }
      if (ringPulse > 0) {
        const k = 1 - ringPulse;
        g.globalAlpha = ringPulse * 0.8;
        g.strokeStyle = "#ffe9a8";
        g.lineWidth = 2 + ringPulse * 5;
        g.beginPath(); g.arc(0, 0, L.ringR * (0.45 + k * 0.62), 0, TAU); g.stroke();
        g.globalAlpha = 1;
      }
      if (missPulse > 0) {
        g.globalAlpha = missPulse * 0.5;
        g.strokeStyle = "rgba(255,255,255,0.7)";
        g.lineWidth = 2 + (1 - missPulse) * 8;
        g.beginPath(); g.arc(0, 0, L.ringR + (1 - missPulse) * 22, 0, TAU); g.stroke();
        g.globalAlpha = 1;
      }

      g.strokeStyle = matchOpen ? "#ffd979" : BRASS_DIM;
      g.lineWidth = matchOpen ? 6 : 2.6;
      g.beginPath();
      g.arc(0, 0, L.ringR, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(prog, 0.0001));
      g.stroke();
      g.restore();
    }

    function drawPile(now) {
      const show = pile.slice(-6);
      for (const e of show) {
        const t = clamp((now - e.t0) / LAND_MS, 0, 1);
        const p = easeOut(t);
        const tx = L.px + e.ox, ty = L.py + e.oy;
        const x = lerp(L.sx, tx, p), y = lerp(L.sy, ty, p);
        const rot = lerp(-0.05, e.rot, p);
        const grow = 1 + 0.13 * (1 - p);
        if (t < 1 && e.card) {
          // The turn: the card is face down for the first half of the throw and
          // face up for the second, squashed through zero width in between.
          const f = clamp(t / 0.55, 0, 1);
          const face = f >= 0.5;
          const sx = Math.abs(Math.cos(f * Math.PI));
          g.save();
          g.translate(x, y);
          g.rotate(rot);
          g.scale(Math.max(sx, 0.02) * grow, grow);
          drawCardAt(0, 0, 0, 1, e.card, face, 0.55 * (1 - p) + 0.05);
          g.restore();
        } else {
          drawCardAt(x, y, rot, grow, e.card, !!e.card, 0.05);
        }
      }
    }

    function drawFlyers(now) {
      for (const f of flyers) {
        const t = clamp((now - f.t0) / f.dur, 0, 1);
        const p = easeInOut(t);
        const x = lerp(f.x0, f.x1, p);
        const y = lerp(f.y0, f.y1, p) - Math.sin(Math.PI * p) * 26;
        const s = lerp(1, f.s1, p);
        drawCardAt(x, y, lerp(f.r0, f.r1, p), s, f.card, !!f.card, 0.25 + 0.4 * Math.sin(Math.PI * p));
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

    /* --- slam pads ------------------------------------------------ */
    function drawPad(p, now) {
      const R = L.rects[p.seat];
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      const armed = matchOpen && p.lock <= 0;
      const side = Math.abs(p.rad) > 0.1 && Math.abs(p.rad) < Math.PI - 0.1;

      g.save();
      if (p.bad > 0) g.translate((Math.random() - 0.5) * p.bad * 11, (Math.random() - 0.5) * p.bad * 11);
      g.translate(cx, cy);
      const sc = 1 - p.press * 0.028 + p.flashT * 0.02;
      g.scale(sc, sc);

      const w = R.w, h = R.h, rr = 20;

      // Armed glow: concentric strokes standing in for the blur we cannot use.
      if (armed) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.020);
        g.strokeStyle = p.ink;
        for (let i = 3; i >= 1; i--) {
          g.globalAlpha = 0.13 * (1 - i / 4.2) * (0.45 + 0.55 * pulse);
          g.lineWidth = i * 8;
          roundRect(g, -w / 2, -h / 2, w, h, rr);
          g.stroke();
        }
        g.globalAlpha = 1;
      }

      // Body: dark leather lit from the player's own edge. The gradient runs
      // along the seat's own axis, so the colour always pools on the side the
      // player is actually sitting on rather than at the top of the screen.
      const nx = -Math.sin(p.rad), ny = Math.cos(p.rad);
      const ext = (Math.abs(nx) * w + Math.abs(ny) * h) / 2;
      roundRect(g, -w / 2, -h / 2, w, h, rr);
      const base = g.createLinearGradient(nx * ext, ny * ext, -nx * ext, -ny * ext);
      base.addColorStop(0.00, "rgba(22,35,27,0.95)");
      base.addColorStop(1.00, "rgba(5,16,11,0.97)");
      g.fillStyle = base;
      g.fill();
      // The colour is a second pass on top. Folded into the leather gradient it
      // mixed with the green showing through and every pad came out olive.
      const wash = g.createLinearGradient(nx * ext, ny * ext, -nx * ext, -ny * ext);
      wash.addColorStop(0.00, hexA(p.ink, (armed ? 0.34 : 0.15) + p.flashT * 0.55));
      wash.addColorStop(0.62, hexA(p.ink, p.flashT * 0.22));
      g.fillStyle = wash;
      g.fill();
      g.strokeStyle = p.lock > 0 ? "rgba(255,90,90,0.75)"
        : hexA(p.ink, Math.max(armed ? 0.95 : 0.42, p.flashT));
      g.lineWidth = armed || p.lock > 0 ? 2.4 : 1.4 + p.flashT * 1.6;
      g.stroke();

      // Inner tread, the concentric inset that makes it read as a pad you hit.
      roundRect(g, -w / 2 + 7, -h / 2 + 7, w - 14, h - 14, rr - 6);
      g.strokeStyle = "rgba(255,255,255,0.055)";
      g.lineWidth = 1;
      g.stroke();

      // Brass rivets.
      g.fillStyle = armed ? BRASS : "rgba(216,169,74,0.35)";
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        g.beginPath();
        g.arc(sx * (w / 2 - 12), sy * (h / 2 - 12), 2.2, 0, TAU);
        g.fill();
      }

      // The win flash. It used to be a flat white fill at 0.55, which bleached
      // the pad to a dead grey slab at exactly the moment the player's colour
      // matters most — you won, and your corner of the table stopped being
      // yours. It is a warm lamp bloom now: the colour lives in the ink wash
      // above, and this is only the highlight on top of it.
      if (p.flashT > 0) {
        const f = easeOut(p.flashT);
        const bloom = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) * 0.62);
        bloom.addColorStop(0.00, "rgba(255,247,226," + (f * 0.26).toFixed(3) + ")");
        bloom.addColorStop(1.00, "rgba(255,247,226,0)");
        roundRect(g, -w / 2, -h / 2, w, h, rr);
        g.fillStyle = bloom;
        g.fill();
      }

      // Everything below reads right way up from this player's seat.
      g.rotate(p.rad);
      const lw = side ? h : w, lh = side ? w : h;
      g.textAlign = "center"; g.textBaseline = "middle";

      if (p.lock > 0) {
        g.save();
        roundRect(g, -lw / 2 + 6, -lh / 2 + 6, lw - 12, lh - 12, rr - 6);
        g.clip();
        g.strokeStyle = "rgba(255,90,90,0.16)";
        g.lineWidth = 6;
        for (let i = -lh; i < lw + lh; i += 16) {
          g.beginPath(); g.moveTo(i, -lh / 2); g.lineTo(i - lh, lh / 2); g.stroke();
        }
        g.restore();
        g.fillStyle = "#ff8f8f";
        g.font = "700 " + Math.round(Math.min(lh * 0.15, 14)) + "px " + FONT;
        tracked(g, "FALSE SNAP", 0, -lh * 0.20, 2.2);
        const barW = lw * 0.40 * (p.lock / LOCK_S);
        roundRect(g, -lw * 0.20, lh * 0.20 - 3, lw * 0.40, 6, 3);
        g.fillStyle = "rgba(255,255,255,0.10)"; g.fill();
        roundRect(g, -lw * 0.20, lh * 0.20 - 3, barW, 6, 3);
        g.fillStyle = "#ff5a5a"; g.fill();
      } else {
        // Your winnings sit on your own pad as an actual stack of cards. A
        // progress bar would say the same thing in a language this table does
        // not speak.
        // The seat's own suit, pressed into the leather like a maker's mark.
        g.fillStyle = hexA(p.ink, 0.22);
        suitPath(g, p.suit, Math.min(lw * 0.30, 96), lh * 0.02, Math.min(lh * 0.115, 13));

        miniStack(-lw * 0.16, lh * 0.03, p.cards, clamp(lh / 140 * 0.52, 0.20, 0.38));

        const tx = lw * 0.07;
        g.fillStyle = hexA(p.ink, 0.92);
        g.font = "700 " + Math.round(Math.min(lh * 0.13, 12)) + "px " + FONT;
        tracked(g, p.name.toLowerCase(), 0, -lh * 0.27, 3);

        g.fillStyle = armed ? "#fffdf4" : CREAM;
        g.font = "800 " + Math.round(Math.min(lh * 0.40, 46)) + "px " + FONT;
        g.fillText(String(p.cards), tx, lh * 0.10);

        if (armed) {
          g.fillStyle = BRASS;
          g.font = "700 " + Math.round(Math.min(lh * 0.115, 11)) + "px " + FONT;
          tracked(g, "SLAM", 0, lh * 0.37, 3.5);
        }
      }
      g.restore();
    }

    /** A player's won pile, drawn small. Thickness follows the count. */
    function miniStack(x, y, count, sc) {
      const cw = CARD_W * sc, ch = CARD_H * sc;
      if (count <= 0) {
        g.save();
        g.globalAlpha = 0.20;
        roundRect(g, x - cw / 2, y - ch / 2, cw, ch, CARD_R * sc);
        g.strokeStyle = CREAM; g.lineWidth = 1;
        g.setLineDash([4, 4]); g.stroke(); g.setLineDash([]);
        g.restore();
        return;
      }
      const layers = Math.min(6, 1 + Math.round(count / 9));
      for (let i = layers; i >= 2; i--) {
        g.save();
        g.translate(x - i * 0.9, y - i * 1.5);
        g.rotate(-0.018 * i);
        roundRect(g, -cw / 2, -ch / 2, cw, ch, CARD_R * sc);
        g.fillStyle = "#5d1520"; g.fill();
        g.strokeStyle = "rgba(0,0,0,0.40)"; g.lineWidth = 1; g.stroke();
        g.restore();
      }
      drawCardAt(x - 0.9, y - 1.5, -0.018, sc, null, false, 0.04);
    }

    /** #rrggbb plus an alpha, without dragging in a colour library. */
    function hexA(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a.toFixed(3) + ")";
    }

    /* --- the shout ------------------------------------------------ */
    function drawBanner(now) {
      if (!banner) return;
      const age = now - banner.t0;
      if (age > banner.life) { banner = null; return; }
      const inT = clamp(age / 170, 0, 1);
      const out = clamp((banner.life - age) / 280, 0, 1);
      const pop = 1 + 0.35 * (1 - easeOut(inT));
      g.save();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "800 30px " + FONT;
      const tw = g.measureText(banner.big).width + 44;
      // The shout runs along the winner's own axis, so at a side seat it is the
      // height of the table it has to fit, not the width. Four-handed, a
      // full-size "VIOLET SNAPS" was 60px wider than the gap between the side
      // pads and laid itself straight across two other people's counts.
      const along = Math.abs(Math.abs(banner.rad) - Math.PI / 2) < 0.1
        ? (L.bandBot - L.bandTop) - 24
        : L.bandW - 14;
      const fit = Math.min(1, along / tw);

      g.globalAlpha = out;
      g.translate(L.px, L.py);
      g.rotate(banner.rad);
      g.scale(pop * fit, pop * fit);
      roundRect(g, -tw / 2, -40, tw, 80, 18);
      g.fillStyle = "rgba(6,18,12,0.80)"; g.fill();
      g.strokeStyle = hexA(banner.ink, 0.75); g.lineWidth = 2; g.stroke();

      g.fillStyle = banner.ink;
      g.fillText(banner.big, 0, -11);
      g.fillStyle = "rgba(244,236,216,0.78)";
      g.font = "600 12px " + FONT;
      tracked(g, banner.small, 0, 17, 0.6);
      g.restore();
    }

    /* --- the deal and the count-in -------------------------------- */
    function drawDeal(now) {
      const t = clamp(dealT / 0.85, 0, 1);
      const n = 7;
      // One shadow for the whole arriving deck, laid down first so the cards
      // land on it, and held back until the first card is nearly home.
      if (t > 0.14) cardShadow(L.sx, L.sy, -0.03, 1, 0.06);
      for (let i = 0; i < n; i++) {
        const k = clamp((t - i * 0.065) / 0.30, 0, 1);
        if (k <= 0) continue;
        const p = easeOut(k);
        const a = (i / n) * TAU + 1.1;
        const x = lerp(L.px + Math.cos(a) * W * 0.9, L.sx - i * 1.1, p);
        const y = lerp(L.py + Math.sin(a) * H * 0.7, L.sy - i * 1.4, p);
        drawCardAt(x, y, lerp(a * 1.6, -0.03, p), 1, null, false, 0, false);
      }
    }

    function drawCountIn(now) {
      const lit = Math.min(3, Math.floor(countT / 0.55));
      // Three pips rather than a numeral: a digit is upside down for half the
      // table, and this reads the same from every seat.
      for (let i = 0; i < 3; i++) {
        const on = i < lit;
        const x = L.px + (i - 1) * 26;
        const y = L.py + L.ringR + 30;
        g.beginPath();
        g.arc(x, y, on ? 7 : 5, 0, TAU);
        g.fillStyle = on ? BRASS : "rgba(255,244,214,0.20)";
        g.fill();
        if (on) {
          const age = countT - i * 0.55;
          if (age < 0.4) {
            g.globalAlpha = 1 - age / 0.4;
            g.strokeStyle = BRASS; g.lineWidth = 2;
            g.beginPath(); g.arc(x, y, 7 + age * 40, 0, TAU); g.stroke();
            g.globalAlpha = 1;
          }
        }
      }
    }

    /* --- the title fan -------------------------------------------- */
    const FAN = ["AS", "QH", "7D", "7C", "KS"];
    function drawFan(now) {
      // Swung about a pivot well below the cards, which is what makes a fan
      // look held rather than stacked. The two sevens in the middle sit a
      // little proud of the rest — the whole game in one still.
      // The fan is decoration and the title copy is not, so it is fitted into
      // the band above the copy rather than pinned to a fraction of the
      // height. The copy is a fixed 314px stack sitting on the menu's bottom
      // padding, so where it starts is known without measuring the overlay.
      // Pinned, the fan ran straight through the wordmark on the 517px card
      // the app embeds the bit in — cream text on white card faces, which is
      // the one combination that reads as nothing at all.
      const copyTop = H - (SAFE_B + 26) - 314;
      const UP = 83, DOWN = 96.3;           // the fan's reach either side of cy, at scale 1
      const s = Math.min(1, (copyTop - 14 - 8) / (UP + DOWN));
      const cx = W / 2, cy = Math.min(H * 0.295, copyTop - 14 - DOWN * s), R = 280 * s;
      const rock = Math.sin(now * 0.0007) * 0.03;
      for (let i = 0; i < FAN.length; i++) {
        const k = i - (FAN.length - 1) / 2;
        const a = k * 0.160 + rock;
        const pair = i === 2 || i === 3;
        const card = { id: FAN[i], rank: FAN[i].slice(0, -1), suit: FAN[i].slice(-1) };
        drawCardAt(cx + Math.sin(a) * R, cy - Math.cos(a) * R + R - (pair ? 13 * s : 0),
          a, s, card, true, pair ? 0.20 : 0.07);
      }
    }

    /* ===============================================================
     * FRAME
     * ============================================================= */
    function render(now) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (table) g.drawImage(table, 0, 0, W, H);
      else paintTable(g, false);

      g.save();
      if (shake > 0.01) {
        g.translate((Math.random() - 0.5) * shake * 18, (Math.random() - 0.5) * shake * 18);
      }

      if (phase === "menu") {
        drawFan(now);
      } else {
        if (phase === "deal") drawDeal(now);
        else {
          drawRing(now);
          drawStock(now);
          drawPile(now);
          if (phase === "count") drawCountIn(now);
        }
        drawFlyers(now);
        drawParts();
      }
      g.restore();

      if (phase !== "menu") {
        for (const p of players) drawPad(p, now);
        drawBanner(now);
      }

      if (flash.a > 0.004) {
        // A tint over the whole table, not a wash. At 0.42 the peak frame was
        // a single flat colour: the felt, the cards and three other people's
        // pads all went the winner's yellow at once.
        g.globalAlpha = flash.a * 0.27;
        g.fillStyle = flash.ink;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    ctx.onFrame((dtMs) => {
      // Two clocks. `dt` is clamped hard and drives decay and easing, where a
      // long stall must not make everything jump. `dtG` is the game clock and
      // is barely clamped at all: a card is due 600 ms after the last one
      // whatever the frame rate, and a phone that drops to fifteen frames a
      // second must not quietly halve the speed everybody is racing against.
      const dt = Math.min(dtMs, 60) / 1000;
      const dtG = sheetOpen ? 0 : Math.min(dtMs, 250) / 1000;
      const now = performance.now();

      shake *= Math.pow(0.0022, dt);
      flash.a *= Math.pow(0.0009, dt);
      missPulse = Math.max(0, missPulse - dt * 1.6);
      ringPulse = Math.max(0, ringPulse - dt * 2);
      for (const p of players) {
        p.press = Math.max(0, p.press - dt * 5);
        p.flashT = Math.max(0, p.flashT - dt * 2.4);
        p.bad = Math.max(0, p.bad - dt * 3);
        if (p.lock > 0) p.lock = Math.max(0, p.lock - dtG);
      }
      stepParts(dt);
      stepFlyers(now);

      if (phase === "deal") {
        dealT += dtG;
        if (dealT >= 0.9) { phase = "count"; countT = 0; }
      } else if (phase === "count") {
        const before = Math.floor(countT / 0.55);
        countT += dtG;
        const after = Math.floor(countT / 0.55);
        if (after > before && after <= 3) sound.sting(after === 3 ? "coin" : "tap");
        if (countT >= 1.95) { phase = "playing"; flipTimer = 0.25; }
      } else if (phase === "playing") {
        const top = pile[pile.length - 1];
        if (top && !top.landed && now - top.t0 >= LAND_MS) landed(top, now);
        flipTimer -= dtG;
        if (flipTimer <= 0) {
          flipCard(now);
          flipTimer = flipEvery / 1000;
        }
      } else if (phase === "resolve") {
        const top = pile[pile.length - 1];
        if (top && !top.landed && now - top.t0 >= LAND_MS) landed(top, now);
        resolveT -= dtG;
        if (resolveT <= 0) endMatch();
      }

      render(now);
    });

    /* ===============================================================
     * OVERLAY
     *
     * One markup string on the runtime-owned root, queried back out by
     * [data-el]. Bits may not reach into the host DOM and
     * document.createElement is rejected at upload. The root itself is
     * pointer-transparent so a slam lands on the table underneath;
     * only the chrome and the full-screen panels take input.
     * ============================================================= */
    const SAFE_T = ctx.safeArea.top, SAFE_B = ctx.safeArea.bottom;
    const btn = "pointer-events:auto;width:38px;height:38px;border-radius:12px;border:none;" +
      // Nearly opaque, not merely tinted: these three sit in the corner the
      // title fan reaches into, and at 0.72 a white card face came through
      // them and took the cream glyphs most of the way with it.
      "background:rgba(6,22,15,0.90);color:" + CREAM + ";font-size:15px;line-height:1;" +
      "font-family:inherit;padding:0;box-shadow:inset 0 0 0 1px rgba(216,169,74,0.30);";
    const bigBtn = (bg, fg, edge) => "width:100%;padding:15px;border:none;border-radius:15px;font-family:inherit;" +
      "font-size:16px;font-weight:700;background:" + bg + ";color:" + fg + ";margin-top:11px;" +
      "pointer-events:auto;" + (edge ? "box-shadow:inset 0 0 0 1px " + edge + ";" : "");
    // The way out of a sheet is the only control on it, and a flat translucent
    // slab read as the disabled one. It gets the brass hairline the panels and
    // the pads already wear, so it looks like part of the same table.
    const QUIET = "linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.055))";
    const QUIET_EDGE = "rgba(216,169,74,0.42)";
    const panel = "max-width:322px;width:100%;background:linear-gradient(180deg,#14311f,#0b2015);" +
      "border-radius:22px;padding:22px;box-shadow:inset 0 0 0 1px rgba(216,169,74,0.28),0 20px 60px rgba(0,0,0,0.55);";
    /* 0.58, not 0.52. These eyebrows are 11px and heavily tracked, and at the
     * old dim they measured 4.36:1 on the settings plate — just under the 4.5
     * a label that small has to clear. */
    const label ="font-size:11px;letter-spacing:0.24em;text-transform:lowercase;opacity:0.58;";
    // overflow-y:auto so a long panel on a short phone scrolls rather than
    // centring itself off both ends, which puts its close button out of reach.
    const sheetCss = "position:absolute;inset:0;display:none;align-items:center;" +
      "align-items:safe center;justify-content:center;" +
      "background:rgba(3,12,8,0.90);z-index:70;padding:" + (SAFE_T + 14) + "px 24px " +
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
      /* ---- chrome, in the corner both end pads were shortened to free ---- */
      '<div style="position:absolute;right:10px;top:' + (SAFE_T + 10) + 'px;display:flex;' +
        'flex-direction:column;gap:7px;z-index:65;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btn + 'font-size:17px;">♪</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btn + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btn + '">?</button>' +
      '</div>' +

      /* ---- title ---- */
      '<div data-el="menu" style="position:absolute;inset:0;display:flex;flex-direction:column;' +
        'justify-content:flex-end;align-items:center;z-index:50;pointer-events:auto;' +
        'padding:0 26px ' + (SAFE_B + 26) + 'px;text-align:center;background:linear-gradient(180deg,' +
        'rgba(3,14,9,0) 20%,rgba(3,14,9,0.22) 40%,rgba(3,14,9,0.86) 57%,rgba(3,14,9,0.97) 100%);">' +
        '<div style="' + label + 'margin-bottom:6px;">A card-table race</div>' +
        '<div style="font-size:66px;font-weight:800;letter-spacing:-0.035em;line-height:0.94;' +
          'background:linear-gradient(178deg,#fff6df 6%,#e8b957 52%,#a9741e);-webkit-background-clip:text;' +
          'background-clip:text;-webkit-text-fill-color:transparent;color:transparent;' +
          'text-shadow:0 8px 30px rgba(0,0,0,0.5);">Snap</div>' +
        '<div style="font-size:14.5px;line-height:1.55;opacity:0.66;max-width:264px;margin-top:10px;">' +
          'Phone flat on the table, a pad each. When a card lands on its own rank, ' +
          'first hand down takes the pile.</div>' +
        '<div style="' + label + 'margin:22px 0 10px;">Players</div>' +
        '<div data-el="seats" style="display:flex;gap:10px;width:206px;"></div>' +
        '<div style="width:100%;max-width:250px;">' +
          '<button data-el="deal" style="' + bigBtn("linear-gradient(180deg,#f0cf7f,#cf9a2e)", "#221503") +
            'margin-top:20px;letter-spacing:0.06em;">Deal</button>' +
        '</div>' +
      '</div>' +

      /* ---- match over ---- */
      '<div data-el="over" style="position:absolute;inset:0;display:none;flex-direction:column;' +
        'align-items:center;justify-content:center;z-index:60;padding:26px;text-align:center;' +
        'pointer-events:auto;background:radial-gradient(120% 60% at 50% 45%,rgba(3,16,10,0.82),rgba(2,9,6,0.97));">' +
        // The result, turned round for whoever is sitting at the other end.
        // A bare rotated headline read as a duplicate of the panel below it —
        // the same two words twice, one of them upside down and floating on
        // nothing. It is the same plate as the main one now, just compact: an
        // eyebrow, the winner, and every count, so the far seat is told the
        // whole result rather than shown a stray word. In the flow rather than
        // absolutely placed, or it lands on the panel at some heights.
        '<div style="transform:rotate(180deg);max-width:300px;width:100%;margin-bottom:18px;' +
          'background:linear-gradient(180deg,#14311f,#0b2015);border-radius:18px;padding:12px 16px 13px;' +
          'box-shadow:inset 0 0 0 1px rgba(216,169,74,0.26),0 14px 36px rgba(0,0,0,0.45);">' +
          '<div style="' + label + 'font-size:9.5px;">Hand over</div>' +
          '<div data-el="over-mirror" style="font-size:25px;font-weight:800;margin-top:2px;' +
            'letter-spacing:-0.02em;line-height:1.15;"></div>' +
          '<div data-el="over-mirror-rows" style="display:flex;flex-wrap:wrap;gap:6px 13px;' +
            'justify-content:center;margin-top:8px;"></div>' +
        '</div>' +
        '<div style="max-width:300px;width:100%;' + panel + 'padding:22px 20px 20px;">' +
          '<div style="' + label + '">Hand over</div>' +
          '<div data-el="over-title" style="font-size:36px;font-weight:800;margin-top:5px;letter-spacing:-0.02em;line-height:1.1;"></div>' +
          '<div data-el="over-sub" style="font-size:12.5px;opacity:0.58;margin-top:5px;letter-spacing:0.05em;"></div>' +
          '<div style="height:1px;background:rgba(216,169,74,0.22);margin:18px 0 14px;"></div>' +
          '<div data-el="over-rows"></div>' +
        '</div>' +
        '<div style="width:100%;max-width:300px;margin-top:16px;">' +
          '<button data-el="again" style="' + bigBtn("linear-gradient(180deg,#f0cf7f,#cf9a2e)", "#221503") + '">Deal again</button>' +
          '<button data-el="quit" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + '">Change players</button>' +
        '</div>' +
      '</div>' +

      /* ---- settings ---- */
      '<div data-el="cogp" style="' + sheetCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:16px;">Settings</div>' +
          '<div style="' + label + '">Sound</div>' +
          '<div data-el="mutes" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Flip speed</div>' +
          '<div data-el="speeds" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Snap on</div>' +
          '<div data-el="rules" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Players</div>' +
          '<div data-el="counts" style="display:flex;gap:8px;margin:9px 0 4px;"></div>' +
          // 0.56: the same 4.5:1 floor. This one is the only sentence on the
          // panel and it was the dimmest thing on it.
          '<div style="font-size:12px;opacity:0.56;margin-top:8px;">Changes apply on the next deal.</div>' +
          '<button data-el="cogp-close" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + 'margin-top:16px;">Done</button>' +
        '</div>' +
      '</div>' +

      /* ---- how to play ---- */
      '<div data-el="helpp" style="' + sheetCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:13.5px;line-height:1.62;opacity:0.86;padding-left:18px;margin:0;">' +
            '<li>Lay the phone flat. Everyone takes the pad on their own edge.</li>' +
            '<li>Cards flip onto the middle pile by themselves, one at a time.</li>' +
            '<li>The moment a card lands on <b>another of the same rank</b>, the ring turns gold — slam your pad.</li>' +
            '<li><b>First hand down</b> takes the whole pile. Being second costs nothing.</li>' +
            '<li>Slam when there is no match and it is a <b>false snap</b>: one card off your pile back to the table, and your pad locks for a moment.</li>' +
            '<li>Nobody slams in time? The pile stays and play carries on.</li>' +
            '<li>When the deck runs out, the biggest pile wins the hand.</li>' +
            '<li>Your fastest hand of the night goes to the global board.</li>' +
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
      if (!host) return;
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;padding:11px 0;border:none;border-radius:12px;' +
        'font-family:inherit;font-size:14px;font-weight:600;pointer-events:auto;">' + labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          // A brass chip, the same metal as the Deal button. At 30% over the
          // panel's green the selected chip mixed down to a khaki that read as
          // the disabled one — the wrong answer looked no different from the
          // right one, which is the whole job of a segmented control.
          b.style.background = on
            ? "linear-gradient(180deg,#f2d289,#cf9a2e)"
            : "linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.045))";
          b.style.color = on ? "#241704" : "rgba(244,236,216,0.62)";
          b.style.boxShadow = on
            ? "inset 0 1px 0 rgba(255,252,238,0.55),0 2px 8px rgba(0,0,0,0.35)"
            : "inset 0 0 0 1px rgba(216,169,74,0.16)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        shell.tap(b, () => { set(Number(b.dataset.v)); saveSettings(); paintAllPills(); sound.haptic("light"); sound.sting("tap"); });
      }
      paint();
      return paint;
    }
    let repaints = [];
    function paintAllPills() { for (const f of repaints) f(); }
    function wirePills() {
      repaints = [
        pills(shell.el("seats"), [2, 3, 4], ["2", "3", "4"],
          () => settings.players, (v) => { settings.players = v; if (phase === "menu") { layout(); bakeTable(); } }),
        pills(shell.el("counts"), [2, 3, 4], ["2", "3", "4"],
          () => settings.players, (v) => { settings.players = v; }),
        pills(shell.el("speeds"), [0, 1, 2], ["Slow", "Brisk", "Blitz"],
          () => settings.speed, (v) => { settings.speed = v; }),
        pills(shell.el("rules"), [0, 1], ["Rank", "Rank or suit"],
          () => settings.rule, (v) => { settings.rule = v; }),
        pills(shell.el("mutes"), [0, 1], ["On", "Muted"],
          () => (sound.muted ? 1 : 0), (v) => {
            if ((v === 1) !== sound.muted) { sound.toggle(); paintMute(); }
          }),
      ].filter(Boolean);
    }
    wirePills();

    /** One glyph, struck through when muted — an emoji speaker would drag a
     *  second colour palette into a very deliberate one. */
    function paintMute() {
      const b = shell.el("mute");
      b.style.textDecoration = sound.muted ? "line-through" : "none";
      b.style.opacity = sound.muted ? "0.45" : "1";
    }
    paintMute();

    shell.tap(shell.el("mute"), () => {
      sound.toggle();
      paintMute();
      paintAllPills();
    });
    /** Open or close a full-screen sheet, freezing the hand while it is up. */
    function showSheet(name, open) {
      shell.el(name).style.display = open ? "flex" : "none";
      if (open === sheetOpen) return;
      sheetOpen = open;
      if (open) { sheetSince = performance.now(); return; }
      // Give back the time the panel was up, or the reaction clock would bill
      // the reader for it and an open match window would expire unfairly.
      const held = performance.now() - sheetSince;
      matchAt += held;
      graceUntil += held;
    }
    shell.tap(shell.el("cog"), () => { showSheet("cogp", true); paintAllPills(); });
    shell.tap(shell.el("cogp-close"), () => { showSheet("cogp", false); });
    shell.tap(shell.el("help"), () => { showSheet("helpp", true); });
    shell.tap(shell.el("helpp-close"), () => { showSheet("helpp", false); });

    shell.tap(shell.el("deal"), async () => {
      ctx.platform.start({ players: settings.players });
      await sound.unlock();
      shell.el("menu").style.display = "none";
      newMatch();
    });
    shell.tap(shell.el("again"), () => {
      shell.el("over").style.display = "none";
      newMatch();
      ctx.platform.interact({ type: "replay" });
    });
    shell.tap(shell.el("quit"), () => {
      shell.el("over").style.display = "none";
      shell.el("menu").style.display = "flex";
      phase = "menu";
      layout(); bakeTable();
      paintAllPills();
    });

    /* ===============================================================
     * INPUT
     *
     * A pointer is bound to a pad the moment it lands and keeps that pad
     * until it lifts; a pad that already has a live pointer refuses any
     * more. Without both of those, one player's stray hand drives a
     * neighbour's pad, or one person quietly owns two of them.
     * ============================================================= */
    const owners = new Map();                    // pointerId -> seat

    ctx.listen(canvas, "pointerdown", (e) => {
      const seat = seatAt(e.offsetX, e.offsetY);
      if (!seat) return;
      const p = players.find((q) => q.seat === seat);
      if (!p) return;
      if (p.held !== null) return;               // that pad already has a hand on it
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
      owners.set(e.pointerId, seat);
      p.held = e.pointerId;
      slam(p, performance.now());
      e.preventDefault();
    }, { passive: false });

    const release = (e) => {
      const seat = owners.get(e.pointerId);
      if (!seat) return;
      owners.delete(e.pointerId);
      const p = players.find((q) => q.seat === seat);
      if (p) p.held = null;
    };
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    /** The whole race, decided here and nowhere else. */
    function slam(p, now) {
      p.press = 1;
      if (phase !== "playing" && phase !== "resolve") return;   // countdown and menus are free
      if (p.lock > 0) { p.bad = Math.max(p.bad, 0.5); return; }
      if (matchOpen) { claimPile(p, now); return; }
      if (now < graceUntil) {                                   // somebody just beat them to it
        claims.push({ seat: p.seat, verdict: "late", ms: Math.max(1, Math.round(now - matchAt)) });
        p.flashT = Math.max(p.flashT, 0.35);
        sound.haptic("light");
        return;
      }
      if (!pile.length) return;                                 // nothing on the table to snap at
      falseSnap(p, now);
    }

    /* ===============================================================
     * RESIZE — the table is measured from the container, so a rotation
     * or a keyboard has to remeasure and rebake rather than stretch.
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
      bakeTable();
    });

    /* ===============================================================
     * A read-only window on the game, so the local harness can drive a
     * real hand and assert on what actually happened. It exposes
     * nothing the bit does not already draw on screen.
     * ============================================================= */
    window.__SNAP__ = {
      get phase() { return phase; },
      get stock() { return stock.length; },
      get pile() { return pile.length; },
      get matchOpen() { return matchOpen; },
      get counts() { return players.map((p) => ({ name: p.name, seat: p.seat, cards: p.cards, lock: p.lock })); },
      get claims() { return claims.slice(); },
      get lastSnap() { return lastSnap; },
      get bestMs() { return bestMs; },
      get winner() { return winner ? winner.name : null; },
      get baked() { return BAKED; },
      get paused() { return sheetOpen; },
      pad(seat) { return padCentre(seat); },
    };
    ctx.onDestroy(() => { try { delete window.__SNAP__; } catch (_) {} });

    // The table and the title fan are on screen before ready() is called, so
    // the host never shows a blank bit for a single frame.
    render(performance.now());
    ctx.markVisualReady("table drawn");
    ctx.platform.ready();
  },
};
