/**
 * Ratscrew — Egyptian Ratscrew for two to four people around one phone.
 *
 * The phone lies flat in the middle of the table. Everybody gets a pad on the
 * edge nearest them, turned the right way up for where they are sitting. That
 * pad is their face-down stack: on your turn you tap it to throw a card into
 * the centre, and the instant the centre shows a double, a sandwich or a pair
 * of tens, every hand on the table comes down at once and the first one there
 * takes the lot.
 *
 * Four decisions drive the whole build.
 *
 * ONE — the race is settled inside the pointerdown handler, synchronously.
 * Four hands landing in the same frame arrive as four pointerdown events in
 * delivery order; the first one to reach `winSlap` while the window is open
 * closes it before the second handler runs, so a dead heat has exactly one
 * winner and there is no tie to break. Nothing is deferred to a frame or a
 * timeout, because a frame boundary would collapse four distinct arrivals into
 * one. Everyone who lands after that, inside a short grace, is recorded "late"
 * and pays nothing — being second is not a foul.
 *
 * TWO — one pad per player, not one shared pile in the middle. A real table
 * has four hands piling onto the centre; a 390-pixel screen does not have room
 * for that, and a shared target would hand the win to whoever sits nearest it.
 * Each pad is the same size and the same distance from its own player, so
 * "first finger down" means what it says. The pad does double duty as the
 * player's deck, and the ambiguity that creates is resolved by one rule: a live
 * slap always beats your own flip, which is exactly what a human does at a real
 * table. The pad says FLIP or SLAP so it is never a guess.
 *
 * THREE — state commits the instant the tap lands and animates afterwards. The
 * card is in the pile, the tribute is counted and the slap window is open
 * before the card has finished turning over, so the reaction clock is honest.
 * Only the flip is rate-limited (a quarter second, so the table can see the
 * card); slaps are never blocked.
 *
 * FOUR — nothing here is a packaged asset, because there are none
 * (maxAssets is 0). All 52 faces, the card back, the felt weave and the whole
 * table are painted into OffscreenCanvases at boot and blitted, with a
 * live-drawing fallback for WebViews that have no OffscreenCanvas. The overlay
 * is one markup string on ctx.createRoot() rather than document.createElement,
 * pointer maths uses offsetX/offsetY rather than getBoundingClientRect, and
 * every soft shadow is stacked translucent fills rather than a canvas blur
 * filter — all three are rejected at upload and none is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Ratscrew",
    runtime: "plethora-bit@2",
    tags: ["multiplayer", "local-multiplayer", "cards", "party", "reflex"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const rnd = Math.random;

    /** Escape anything that could ever be player-authored before it meets innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ===============================================================
     * PALETTE
     *
     * A back-room card table at one in the morning: dark baize under a
     * single warm bulb, walnut rail, copper inlay. Every player colour
     * has to survive being laid on green, so they are warm-or-cold
     * extremes rather than mid-tones — a sage or an olive player would
     * sink straight into the felt.
     *
     * Two accents are kept strictly apart because they mean opposite
     * things and both arrive as a full-screen flash: GOLD is a good
     * slap, RED is a burn. If they shared a hue nobody could tell at a
     * glance whether they had just won the pile or paid for it.
     * ============================================================= */
    const FELT_LIT = "#1a6b4c", FELT_MID = "#0d4530", FELT_DARK = "#03120c";
    const RAIL = "#241409", COPPER = "#d99a52", COPPER_DIM = "rgba(217,154,82,0.40)";
    const GOLD = "#ffd45e", BURN = "#ff4a4a";
    const CREAM = "#f5edda";
    const CARD_THEME = { face: "#f8f4e9", edge: "rgba(26,18,10,0.26)", red: "#c3202e", black: "#191720" };
    const SEATS = [
      { seat: "bottom", name: "Amber",  ink: "#f6b93b", rad: 0,            suit: "S" },
      { seat: "top",    name: "Coral",  ink: "#ff5c72", rad: Math.PI,      suit: "H" },
      { seat: "left",   name: "Cobalt", ink: "#4aa8ff", rad: Math.PI / 2,  suit: "D" },
      { seat: "right",  name: "Orchid", ink: "#b98cff", rad: -Math.PI / 2, suit: "C" },
    ];
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const SERIF = "ui-serif,Georgia,'Times New Roman',serif";

    const LAND_MS = 195;        // how long a thrown card takes to turn over and settle
    const REVEAL_MS = 105;      // when in that throw the face first becomes legible
    const MIN_REACTION = 90;    // under this a "reaction" is a lucky mid-air mash
    const LOCK_S = 0.85;        // pad freeze after a burn
    const GRACE_MS = 800;       // after a claim, late hands cost nothing
    const COLLECT_MS = 900;     // the beat before a failed tribute is swept up
    const FLIP_LOCK = 0.24;     // minimum gap between flips, so the table sees the card

    const TRIBUTE = { A: 4, K: 3, Q: 2, J: 1 };
    const NUMERIC = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10 };
    const KIND_LABEL = { double: "DOUBLE", sandwich: "SANDWICH", tens: "TENS" };

    /* ===============================================================
     * SETTINGS — remembered between sessions.
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("ratscrew") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 2, 2, 4),
      deal: saved.deal === undefined ? 0 : saved.deal,      // 0 = six each, 1 = whole deck
      tens: saved.tens === undefined ? 1 : saved.tens,      // top-ten slap on/off
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("ratscrew", settings); } catch (_) {} }

    /* ===============================================================
     * SOUND — a low driving bed that tightens as the pile grows, with a
     * cue on every moment that matters. All of it wrapped: audio is a
     * nicety and must never be able to break a hand of cards.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "pulse", volume: 0.26, tempo: 104, intensity: 0.28 });
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
     * willReadFrequently pins the surface to the CPU backend, which is what a
     * write-once blit source wants: a GPU-backed offscreen is read back across
     * the bus on every drawImage, and a table with a dozen cards on it does a
     * dozen of those a frame.
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
     * Writing g.filter to a blur string is rejected at upload: the property
     * also accepts a url reference, so any write to it reads as pulling in a
     * remote resource. Stacking progressively larger translucent fills gives
     * the same falloff, and it is the only shadow in the bit.
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
     * Letter-spaced caps, measured by hand so it works on every engine.
     * Per-character widths are memoised: this runs on every pad every frame
     * and measureText is one of the few canvas calls that is not cheap.
     */
    const trackCache = new Map();
    function tracked(g, text, x, y, spacing) {
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
     * its headwear, with the suit colour carrying everything else. In this game
     * the courts are the cards that matter most (they are the tribute), so they
     * get features: two eyes and a mouth is the whole difference between a
     * court card and a hooded silhouette at this size.
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
      paper.addColorStop(0, "#fffdf6");
      paper.addColorStop(0.55, CARD_THEME.face);
      paper.addColorStop(1, "#ece4d2");
      g.fillStyle = paper; g.fill();
      g.strokeStyle = CARD_THEME.edge; g.lineWidth = Math.max(1, w * 0.008); g.stroke();

      roundRect(g, w * 0.035, h * 0.025, w * 0.93, h * 0.95, r * 0.72);
      g.strokeStyle = "rgba(30,22,14,0.075)"; g.lineWidth = Math.max(0.6, w * 0.006); g.stroke();

      // Corner index, mirrored into the far corner so the card reads from
      // either end the way a real one does. In a game where four people are
      // reading the same card from four sides, that mirror is load-bearing.
      const cs = w * 0.155;
      const corner = (flip) => {
        g.save();
        if (flip) { g.translate(w, h); g.rotate(Math.PI); }
        g.fillStyle = ink;
        g.font = "700 " + cs + "px " + SERIF;
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.fillText(rank, w * 0.135, h * 0.135);
        suitPath(g, suitId, w * 0.135, h * 0.205, cs * 0.30);
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

    /** Paint the card back at (0,0): oxblood guilloché under a copper frame. */
    function paintCardBack(g, w, h) {
      const r = Math.min(w, h) * 0.085;
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      const base = g.createLinearGradient(0, 0, w, h);
      base.addColorStop(0, "#7d2231");
      base.addColorStop(0.55, "#5f1622");
      base.addColorStop(1, "#3d0d15");
      g.fillStyle = base; g.fill();

      g.save();
      roundRect(g, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g.clip();
      g.strokeStyle = "rgba(255,226,190,0.12)";
      g.lineWidth = Math.max(0.7, w * 0.011);
      const step = w * 0.115;
      for (let i = -h; i < w + h; i += step) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
        g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
      }
      // Centre medallion: a copper lozenge with the four suits around it, which
      // is what stops the lattice from reading as wallpaper.
      g.translate(w / 2, h / 2);
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.beginPath();
      g.moveTo(0, -h * 0.20); g.lineTo(w * 0.20, 0); g.lineTo(0, h * 0.20); g.lineTo(-w * 0.20, 0);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(217,154,82,0.62)"; g.lineWidth = Math.max(1, w * 0.012); g.stroke();
      g.fillStyle = "rgba(217,154,82,0.72)";
      suitPath(g, "S", 0, -h * 0.085, w * 0.052);
      suitPath(g, "H", 0, h * 0.085, w * 0.052);
      suitPath(g, "D", -w * 0.095, 0, w * 0.052);
      suitPath(g, "C", w * 0.095, 0, w * 0.052);
      g.restore();

      roundRect(g, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g.strokeStyle = "rgba(240,200,150,0.48)"; g.lineWidth = Math.max(1, w * 0.016); g.stroke();
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

    /** A shuffled 52-card deck. */
    function freshDeck() {
      const d = [];
      for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s.id, red: s.red, id: r + s.id });
      for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = d[i]; d[i] = d[j]; d[j] = t;
      }
      return d;
    }

    /* ===============================================================
     * CANVAS + LAYOUT
     * ============================================================= */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const dpr = Math.min(ctx.dpr || 1, 2);
    let W = ctx.width, H = ctx.height;

    const CARD_W = 100, CARD_H = 140, CARD_R = 9, SHADOW_PAD = 22;
    const art = makeDeckArt(CARD_W, CARD_H, dpr);

    /**
     * The card shadow, baked once.
     *
     * Live it is five stacked translucent fills per card — a dozen cards on the
     * table is sixty anti-aliased fills a frame, and it dominated the budget.
     * Baked it is a single blit, and being one-off it can afford sixteen steps
     * instead of five, so the falloff is smoother than the live version was.
     */
    const shadowArt = (function () {
      const sw = CARD_W + SHADOW_PAD * 2, sh = CARD_H + SHADOW_PAD * 2;
      const s = surface(sw * dpr, sh * dpr);
      if (!s) return null;
      const c = surfCtx(s);
      c.scale(dpr, dpr);
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

      // Each end pad is shortened by the chrome column on the side that is its
      // own player's right — screen-right for the bottom player, screen-left
      // for the top one, who is sitting rotated a half turn. The layout is
      // therefore symmetric under the seat rotation, and it frees the screen's
      // top-right corner for the buttons without stealing from one player only.
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
      L.bandH = bh;
      L.ringR = Math.min(L.bandW / 2 - 12, bh / 2 - 16, 104);
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
    function padCentre(seat) {
      const r = L.rects[seat];
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }

    /* ===============================================================
     * THE TABLE — baked once, blitted every frame.
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
        const v = 90 + rnd() * 165;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      return s;
    }
    const WEAVE = weaveTile(), NOISE = noiseTile();

    function paintTable(c, rich) {
      const pool = c.createRadialGradient(L.px, L.py - H * 0.04, 10, L.px, L.py, Math.max(W, H) * 0.80);
      pool.addColorStop(0.00, FELT_LIT);
      pool.addColorStop(0.30, "#145a3f");
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
        // Loose fibres. Baize is never uniform, and a scatter of lit and
        // shadowed specks is what stops a gradient reading as plastic.
        c.save();
        for (let i = 0; i < 1400; i++) {
          const x = rnd() * W, y = rnd() * H;
          const lit = rnd() < 0.5;
          c.globalAlpha = (lit ? 0.05 : 0.055) * (1 - Math.hypot(x - L.px, y - L.py) / Math.max(W, H));
          c.fillStyle = lit ? "#cfeedd" : "#01120a";
          c.fillRect(x, y, 1 + rnd() * 1.6, 1);
        }
        c.restore();
      }

      // A printed layout ring, pressed into the baize rather than painted on.
      c.save();
      c.translate(L.px, L.py);
      c.strokeStyle = "rgba(255,246,215,0.055)";
      c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, L.ringR + 30, 0, TAU); c.stroke();
      c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, L.ringR + 36, 0, TAU); c.stroke();
      c.strokeStyle = "rgba(0,0,0,0.10)";
      c.beginPath(); c.arc(0, 0, L.ringR + 32.5, 0, TAU); c.stroke();
      c.restore();

      // Lamp bloom. Stacked translucent discs band visibly at this size, so the
      // falloff is a real radial gradient instead.
      c.save();
      c.globalCompositeOperation = "lighter";
      const bloom = c.createRadialGradient(L.px, L.py - H * 0.04, 0, L.px, L.py - H * 0.04, Math.max(W, H) * 0.60);
      bloom.addColorStop(0.00, "rgba(255,228,172,0.16)");
      bloom.addColorStop(0.35, "rgba(255,222,158,0.07)");
      bloom.addColorStop(0.70, "rgba(255,222,158,0.018)");
      bloom.addColorStop(1.00, "rgba(255,222,158,0)");
      c.fillStyle = bloom;
      c.fillRect(0, 0, W, H);
      c.restore();

      const vig = c.createRadialGradient(L.px, L.py, Math.min(W, H) * 0.28, L.px, L.py, Math.max(W, H) * 0.72);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.58)");
      c.fillStyle = vig;
      c.fillRect(0, 0, W, H);

      c.strokeStyle = RAIL;
      c.lineWidth = 18;
      c.strokeRect(-9, -9, W + 18, H + 18);
      c.lineWidth = 9;
      c.strokeStyle = "rgba(0,0,0,0.45)";
      c.strokeRect(-4.5, -4.5, W + 9, H + 9);
      roundRect(c, 10.5, 10.5, W - 21, H - 21, 16);
      c.strokeStyle = "rgba(217,154,82,0.16)";
      c.lineWidth = 1.2;
      c.stroke();
    }

    let table = null;
    function bakeTable() {
      const s = surface(W * dpr, H * dpr);
      if (!s) { table = null; return; }
      const c = surfCtx(s);
      c.scale(dpr, dpr);
      paintTable(c, true);
      table = s;
    }
    bakeTable();

    /* ===============================================================
     * STATE
     * ============================================================= */
    let phase = "menu";               // menu | deal | play | resolve | over
    let players = [];
    let pile = [];                    // index 0 is the bottom of the pile
    let turn = 0;
    let tribute = null;               // { creditor, left, rank }
    let pendingCollect = null;        // { idx, t0, dur, reason }
    let slapNow = null;               // "double" | "sandwich" | "tens" | null
    let slapSince = 0, slapTopId = null;
    let graceUntil = 0, flipLock = 0, lastFlipper = 0;
    let dealT = 0, resolveT = 0;
    let shake = 0, ringPulse = 0;
    let flash = { a: 0, ink: "#fff" };
    let banner = null;
    let bestMs = 0, bestBy = "", lastSlap = null, winner = null, matchStart = 0;
    let outOrder = 0, deckN = 12;
    // A sheet covering the screen stops the clock. An open slap window would
    // otherwise bill whoever opened the settings panel for their reading time.
    let sheetOpen = false, sheetSince = 0;
    const claims = [];                // every hand that came down, in delivery order

    function makePlayers(n) {
      return SEATS.slice(0, n).map((s, i) => ({
        idx: i, seat: s.seat, name: s.name, ink: s.ink, rad: s.rad, suit: s.suit,
        deck: [], held: null, lock: 0, press: 0, flashT: 0, bad: 0, out: false, outAt: 0, took: 0,
      }));
    }

    function newMatch() {
      layout();
      bakeTable();
      players = makePlayers(settings.players);
      const deck = freshDeck();
      const per = settings.deal === 0 ? 6 : Math.floor(52 / settings.players);
      deckN = per * settings.players;
      for (let i = 0; i < deckN; i++) players[i % players.length].deck.push(deck[i]);
      pile = [];
      claims.length = 0;
      turn = 0; tribute = null; pendingCollect = null;
      slapNow = null; slapSince = 0; slapTopId = null;
      graceUntil = 0; flipLock = 0; lastFlipper = 0;
      bestMs = 0; bestBy = ""; lastSlap = null; winner = null; outOrder = 0;
      banner = null; shake = 0; flash.a = 0; ringPulse = 0;
      flyers.length = 0; shocks.length = 0;
      for (const p of parts) p.life = 0;
      dealT = 0; resolveT = 0;
      matchStart = performance.now();
      phase = "deal";
      sound.heat(0.28);
    }

    /* ===============================================================
     * PARTICLES, FLYING CARDS, SHOCKWAVES
     * ============================================================= */
    const parts = [];
    for (let i = 0; i < 150; i++) parts.push({ life: 0 });
    let partI = 0;
    function spawnPart(x, y, o) {
      const p = parts[partI = (partI + 1) % parts.length];
      p.x = x; p.y = y;
      p.vx = o.vx; p.vy = o.vy;
      p.gr = o.gr === undefined ? 620 : o.gr;
      p.drag = o.drag === undefined ? 0.985 : o.drag;
      p.life = p.max = o.life;
      p.col = o.col; p.kind = o.kind || "spark";
      p.size = o.size; p.rot = rnd() * TAU; p.vr = (rnd() - 0.5) * 14;
    }
    function burst(x, y, ink, n, power) {
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU;
        const sp = power * (0.35 + rnd());
        const shard = rnd() < 0.45;
        spawnPart(x, y, {
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.35,
          life: 0.42 + rnd() * 0.55,
          col: shard ? (rnd() < 0.55 ? CREAM : ink) : (rnd() < 0.5 ? COPPER : ink),
          kind: shard ? "shard" : "spark",
          size: shard ? 5 + rnd() * 7 : 1.6 + rnd() * 2.4,
        });
      }
    }
    function puff(x, y) {
      for (let i = 0; i < 5; i++) {
        const a = rnd() * TAU;
        spawnPart(x, y, {
          vx: Math.cos(a) * 42, vy: Math.sin(a) * 26 - 8, gr: 40, drag: 0.90,
          life: 0.26 + rnd() * 0.2, col: "rgba(255,244,214,0.5)", kind: "spark",
          size: 2 + rnd() * 3,
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

    /** Expanding rings. A slap needs a shape that leaves the middle of the
     *  table, not just a colour change on it. */
    const shocks = [];
    function shock(x, y, ink, r0, r1, life, w) {
      if (shocks.length > 8) shocks.shift();
      shocks.push({ x, y, ink, r0, r1, t: 0, life, w });
    }
    function stepShocks(dt) {
      for (let i = shocks.length - 1; i >= 0; i--) {
        shocks[i].t += dt;
        if (shocks[i].t >= shocks[i].life) shocks.splice(i, 1);
      }
    }

    const flyers = [];
    function fly(o) { if (flyers.length < 16) flyers.push(o); }
    function stepFlyers(now) {
      for (let i = flyers.length - 1; i >= 0; i--) {
        if (now - flyers[i].t0 >= flyers[i].dur) flyers.splice(i, 1);
      }
    }

    /* ===============================================================
     * GAME LOGIC
     * ============================================================= */
    /** The top of the pile, with burned cards treated as opaque. */
    function at(i) {
      const e = pile[i];
      return e && !e.faceDown ? e.card : null;
    }

    /**
     * What, if anything, is on the table to be slapped.
     *
     * A pure function of the pile, recomputed after every change, rather than
     * a window that opens and expires. Egyptian Ratscrew has no clock on a
     * double: it sits there being slappable until somebody takes it.
     */
    function slapKind() {
      const n = pile.length;
      if (n < 2) return null;
      const a = at(n - 1), b = at(n - 2), c = at(n - 3);
      if (!a || !b) return null;
      if (a.rank === b.rank) return "double";
      if (c && a.rank === c.rank) return "sandwich";
      if (settings.tens && NUMERIC[a.rank] && NUMERIC[b.rank] &&
          NUMERIC[a.rank] + NUMERIC[b.rank] === 10) return "tens";
      return null;
    }

    /**
     * Recompute the window.
     *
     * `slapSince` is set to the moment the new top card becomes *legible*, not
     * the moment it was committed — the reaction on the leaderboard should be a
     * reaction to something a human could see. A hand that lands before that
     * still wins the pile (it was first), it just does not set a record.
     */
    function refreshSlap(now, delay) {
      const k = slapKind();
      const topId = pile.length ? (at(pile.length - 1) || {}).id : null;
      if (k === slapNow && topId === slapTopId) return;
      slapNow = k;
      slapTopId = topId;
      if (k) {
        slapSince = now + (delay || 0);
        ringPulse = 1;
        shock(L.px, L.py, GOLD, L.ringR * 0.3, L.ringR * 1.25, 0.5, 3);
        sound.sting("danger");
        sound.haptic("warning");
        ctx.platform.interact({ type: "slap_open", kind: k });
      }
    }

    /** Next player round the table who still has cards to throw. */
    function nextWithCards(from, exclude) {
      const n = players.length;
      for (let k = 1; k <= n; k++) {
        const i = (from + k) % n;
        if (i === exclude) continue;
        const p = players[i];
        if (!p.out && p.deck.length > 0) return i;
      }
      return -1;
    }

    function scheduleCollect(idx, now, reason) {
      if (pendingCollect) return;
      pendingCollect = { idx, t0: now, dur: COLLECT_MS, reason };
      sound.sting("coin");
    }

    /**
     * Hand the turn on.
     *
     * If nobody round the table can throw a card, the hand would sit there for
     * ever, so the pile is swept: to the tribute's creditor if there is one —
     * an unpayable tribute is a failed tribute — and otherwise to whoever laid
     * the last card, who is the only person still holding the table.
     */
    function passTurn(from, now) {
      const exclude = tribute ? tribute.creditor : -1;
      const nxt = nextWithCards(from, exclude);
      if (nxt < 0) {
        scheduleCollect(tribute ? tribute.creditor : lastFlipper, now, tribute ? "tribute" : "stall");
        return;
      }
      turn = nxt;
    }

    function flipCard(p, now) {
      if (!p.deck.length) return;
      const card = p.deck.pop();
      const a = rnd() * TAU, d = 6 + rnd() * 7;
      const from = padCentre(p.seat);
      pile.push({
        card, t0: now, landed: false, faceDown: false,
        rot: (rnd() - 0.5) * 0.34, ox: Math.cos(a) * d, oy: Math.sin(a) * d,
        fx: from.x, fy: from.y, fr: p.rad,
      });
      lastFlipper = p.idx;
      flipLock = FLIP_LOCK;
      p.press = 1;
      sound.sting("tap");
      sound.haptic("light");

      const owed = TRIBUTE[card.rank] || 0;
      if (owed > 0) {
        // A face card resets everything: the obligation is now on the next
        // player and it belongs to whoever laid this card, even mid-payment.
        tribute = { creditor: p.idx, left: owed, rank: card.rank };
        passTurn(p.idx, now);
        sound.sting("powerup");
        sound.haptic("medium");
        shock(L.px, L.py, p.ink, L.ringR * 0.2, L.ringR * 0.95, 0.42, 2);
      } else if (tribute) {
        tribute.left--;
        if (tribute.left <= 0 || p.deck.length === 0) {
          scheduleCollect(tribute.creditor, now, "tribute");
        }
        // Otherwise the same player keeps paying, so the turn does not move.
      } else {
        passTurn(p.idx, now);
      }
      refreshSlap(now, REVEAL_MS);
      sound.heat(clamp(0.25 + pile.length / 16, 0.25, 1));
      ctx.platform.setProgress(clamp(1 - players.filter((q) => !q.out).length / players.length + 0.001, 0, 1));
    }

    /**
     * The race, resolved inside the pointerdown handler.
     *
     * Everything here is synchronous on purpose. Several hands landing in the
     * same frame arrive as several pointerdown events in delivery order; the
     * first to reach this function while the window is open closes it before
     * the second handler runs, so there is exactly one winner and no tie to
     * break. Deferring any part of it to a frame would collapse those arrivals
     * into one.
     */
    function winSlap(p, now, kind) {
      const ms = Math.max(1, Math.round(now - slapSince));
      slapNow = null;
      slapTopId = null;
      const n = pile.length;
      claims.push({ seat: p.seat, name: p.name, verdict: "slap", kind, ms, cards: n });
      lastSlap = { seat: p.seat, name: p.name, ms, cards: n, kind };
      if (ms >= MIN_REACTION && (bestMs === 0 || ms < bestMs)) { bestMs = ms; bestBy = p.name; }

      banner = {
        t0: now, ink: p.ink, rad: p.rad, life: 1250,
        big: p.name.toUpperCase() + " SLAPS",
        small: KIND_LABEL[kind] + "   ·   +" + n + " cards   ·   " + ms + " ms",
      };
      // Violence: a white blow-out, a hard shake, two shockwaves and shrapnel
      // off the middle of the table plus a second burst on the winner's own pad
      // so nobody has to ask whose hand it was.
      flash.a = 0.95; flash.ink = "#fff6d8";
      shake = 1;
      p.flashT = 1;
      burst(L.px, L.py, p.ink, 40, 380);
      burst(padCentre(p.seat).x, padCentre(p.seat).y, p.ink, 14, 230);
      shock(L.px, L.py, "#fffdf0", 6, L.ringR * 2.1, 0.42, 5);
      shock(L.px, L.py, p.ink, 4, L.ringR * 1.5, 0.55, 3);
      sound.duck(0.6, 420);
      sound.sting("win");
      sound.haptic("heavy");
      ctx.platform.interact({ type: "slap", by: p.name, kind, ms });
      ctx.platform.milestone("slap", { by: p.name, kind, ms, cards: n });

      award(p, now, "slap");
    }

    /** Sweep the pile to one player, and settle who that leaves with nothing. */
    function award(p, now, how) {
      const n = pile.length;
      if (n) {
        const target = padCentre(p.seat);
        for (const e of pile.slice(-8)) {
          fly({
            card: e.card, faceUp: !e.faceDown, t0: now, dur: 340,
            x0: L.px + e.ox, y0: L.py + e.oy, r0: e.rot,
            x1: target.x, y1: target.y, r1: e.rot + (rnd() - 0.5) * 1.4, s1: 0.34,
          });
        }
        // Picked up as a packet and turned face down under the stack: the card
        // that was on top of the pile ends up deepest in the winner's deck.
        const packet = pile.map((e) => e.card).reverse();
        p.deck.unshift.apply(p.deck, packet);
        p.took += n;
      }
      pile.length = 0;
      tribute = null;
      pendingCollect = null;
      slapNow = null;
      slapTopId = null;
      turn = p.idx;
      graceUntil = now + GRACE_MS;
      flipLock = Math.max(flipLock, 0.5);

      // Running out is only fatal once the pile you might have slapped back
      // into is gone. That is the real rule and it is what keeps a player who
      // just threw their last card in the game for one more heartbeat.
      for (const q of players) {
        if (!q.out && q !== p && q.deck.length === 0) eliminate(q, now);
      }
      ctx.platform.setScore(Math.max.apply(null, players.map((q) => q.deck.length)));
      checkOver(now);
    }

    /** A hand that came down on nothing: one card off your stack, face down,
     *  under the pile — where it cannot shield the card the next flip has to
     *  match against, which would turn a penalty into armour. */
    function burnSlap(p, now) {
      claims.push({ seat: p.seat, name: p.name, verdict: "burn", ms: 0 });
      p.bad = 1;
      flash.a = 0.5; flash.ink = BURN;
      shake = Math.max(shake, 0.5);
      const from = padCentre(p.seat);
      burst(from.x, from.y, BURN, 12, 210);
      sound.sting("fail");
      sound.haptic("error");

      if (!p.deck.length) {
        // Nothing left to pay with. A player on zero who slaps at thin air has
        // spent the one thing keeping them at the table.
        eliminate(p, now, "burn");
        checkOver(now);
        return;
      }
      p.lock = LOCK_S;
      const card = p.deck.pop();
      const a = rnd() * TAU, d = 7 + rnd() * 7;
      pile.unshift({
        card, t0: now - 999, landed: true, faceDown: true,
        rot: (rnd() - 0.5) * 0.34, ox: Math.cos(a) * d, oy: Math.sin(a) * d,
        fx: from.x, fy: from.y, fr: p.rad,
      });
      fly({
        card, faceUp: false, t0: now, dur: 320, s1: 1,
        x0: from.x, y0: from.y, r0: p.rad,
        x1: L.px, y1: L.py, r1: (rnd() - 0.5) * 0.4,
      });
      ctx.platform.interact({ type: "burn", by: p.name });
    }

    function eliminate(q, now, why) {
      q.out = true;
      q.outAt = ++outOrder;
      q.bad = 1;
      burst(padCentre(q.seat).x, padCentre(q.seat).y, BURN, 18, 250);
      shock(padCentre(q.seat).x, padCentre(q.seat).y, BURN, 6, 90, 0.6, 3);
      sound.sting("lose");
      sound.haptic("warning");
      ctx.platform.milestone("eliminated", { name: q.name, why: why || "empty" });
    }

    function checkOver(now) {
      const alive = players.filter((q) => !q.out);
      if (alive.length <= 1 && phase === "play") {
        phase = "resolve";
        resolveT = 1.15;
      }
    }

    async function endMatch() {
      phase = "over";
      const alive = players.filter((q) => !q.out);
      winner = alive.length
        ? alive.reduce((a, b) => (b.deck.length > a.deck.length ? b : a))
        : players.slice().sort((a, b) => b.outAt - a.outAt)[0];

      const title = shell.el("over-title");
      title.textContent = winner ? winner.name + " wins" : "Nobody wins";
      title.style.color = winner ? winner.ink : CREAM;
      const mirror = shell.el("over-mirror");
      mirror.textContent = winner ? winner.name + " wins" : "Nobody wins";
      mirror.style.color = winner ? winner.ink : CREAM;

      const slaps = claims.filter((c) => c.verdict === "slap").length;
      const burns = claims.filter((c) => c.verdict === "burn").length;
      shell.el("over-sub").textContent = bestMs > 0
        ? "fastest slap " + bestMs + " ms · " + esc(bestBy)
        : slaps > 0 ? slaps + (slaps === 1 ? " slap taken" : " slaps taken")
        : "not one clean slap all game";

      const rows = players.slice().sort((a, b) => (b.out ? -1 : 1) - (a.out ? -1 : 1) || b.deck.length - a.deck.length);
      shell.el("over-rows").innerHTML = rows.map((p) => {
        const pct = Math.round(p.deck.length / deckN * 100);
        return '<div style="display:flex;align-items:center;gap:10px;margin:9px 0;' +
          (p.out ? "opacity:0.45;" : "") + '">' +
          '<div style="width:9px;height:9px;border-radius:3px;background:' + p.ink + ';flex:none;"></div>' +
          '<div style="width:56px;font-size:13px;opacity:0.85;flex:none;">' + esc(p.name) + '</div>' +
          '<div style="flex:1;height:8px;border-radius:5px;background:rgba(255,255,255,0.09);overflow:hidden;">' +
            '<div style="width:' + pct + '%;height:100%;border-radius:5px;background:' + p.ink + ';"></div>' +
          '</div>' +
          '<div style="width:34px;text-align:right;font-size:15px;font-weight:700;flex:none;">' +
            (p.out ? '<span style="font-size:10px;letter-spacing:0.14em;opacity:0.8;">OUT</span>' : p.deck.length) +
          '</div>' +
        '</div>';
      }).join("") +
      '<div style="font-size:11.5px;opacity:0.45;margin-top:13px;letter-spacing:0.04em;">' +
        slaps + (slaps === 1 ? " slap" : " slaps") + " · " + burns + (burns === 1 ? " burn" : " burns") +
        " · " + deckN + " cards in play</div>";

      shell.el("over-mirror-rows").innerHTML = players.map((p) =>
        '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;' +
          (p.out ? "opacity:0.45;" : "") + '">' +
          '<span style="width:8px;height:8px;border-radius:3px;background:' + p.ink + ';"></span>' +
          '<span style="opacity:0.72;">' + esc(p.name) + '</span>' +
          '<b style="font-weight:700;">' + (p.out ? "out" : p.deck.length) + '</b>' +
        '</span>').join("");
      shell.el("over").style.display = "flex";

      sound.duck(0.5, 500);
      sound.sting(winner ? "success" : "lose");
      sound.haptic(winner ? "success" : "warning");
      if (winner) {
        burst(L.px, L.py, winner.ink, 46, 380);
        shock(L.px, L.py, winner.ink, 8, L.ringR * 2.2, 0.7, 4);
      }

      ctx.platform.complete({
        winner: winner ? winner.name : "none",
        counts: players.map((p) => ({ name: p.name, cards: p.deck.length, out: p.out })),
        fastestSlapMs: bestMs,
        slaps, burns,
        durationMs: Math.round(performance.now() - matchStart),
      });
      // The record belongs to the match, not to one of the people sharing the
      // phone: the fastest hand that came down on this table tonight.
      try {
        if (bestMs > 0) await ctx.memory.record("fastest_slap").submit(bestMs, { label: bestMs + " ms" });
      } catch (_) { /* offline is fine; the game still finished */ }
    }

    /* ===============================================================
     * DRAWING
     * ============================================================= */
    function cardShadow(x, y, rot, scale, lift) {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      if (shadowArt) {
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
      const src = faceUp ? (art && card && art.faces[card.id]) : (art && art.back);
      if (src) {
        g.drawImage(src, -w / 2, -h / 2, w, h);
      } else {
        // No OffscreenCanvas on this WebView: paint the card live. Plainer to
        // run, identical to look at, never a blank rectangle.
        g.save();
        g.translate(-w / 2, -h / 2);
        g.scale(scale, scale);
        if (faceUp && card) paintCardFace(g, card.rank, card.suit, CARD_W, CARD_H);
        else paintCardBack(g, CARD_W, CARD_H);
        g.restore();
      }
      g.restore();
    }

    /** The centre pile: real thickness underneath, the last few cards on top. */
    function drawPile(now) {
      const n = pile.length;
      if (!n) {
        // An empty middle is a dead middle, so the layout circle keeps a ghost
        // card in it — the table telling you where the next one lands.
        g.save();
        g.globalAlpha = 0.13;
        g.translate(L.px, L.py);
        roundRect(g, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, CARD_R);
        g.strokeStyle = CREAM; g.lineWidth = 1.4;
        g.setLineDash([6, 7]); g.stroke(); g.setLineDash([]);
        g.restore();
        return;
      }
      const buried = Math.max(0, n - 6);
      const slabs = Math.min(6, Math.ceil(buried / 3));
      for (let i = slabs; i >= 1; i--) {
        g.save();
        g.translate(L.px - i * 1.0, L.py - i * 1.5);
        g.rotate(-0.03 + i * 0.006);
        roundRect(g, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, CARD_R);
        g.fillStyle = "#3d0d15"; g.fill();
        g.strokeStyle = "rgba(0,0,0,0.42)"; g.lineWidth = 1; g.stroke();
        g.restore();
      }
      for (const e of pile.slice(-6)) {
        const t = clamp((now - e.t0) / LAND_MS, 0, 1);
        const p = easeOut(t);
        const tx = L.px + e.ox, ty = L.py + e.oy;
        const x = lerp(e.fx, tx, p), y = lerp(e.fy, ty, p);
        const rot = lerp(e.fr, e.rot, p);
        const grow = 1 + 0.13 * (1 - p);
        if (t < 1 && !e.faceDown) {
          // The turn: face down for the first half of the throw and face up for
          // the second, squashed through zero width in between.
          const f = clamp(t / 0.55, 0, 1);
          const sx = Math.abs(Math.cos(f * Math.PI));
          g.save();
          g.translate(x, y);
          g.rotate(rot);
          g.scale(Math.max(sx, 0.02) * grow, grow);
          drawCardAt(0, 0, 0, 1, e.card, f >= 0.5, 0.55 * (1 - p) + 0.05);
          g.restore();
        } else {
          drawCardAt(x, y, rot, grow, e.card, !e.faceDown, 0.05);
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
        drawCardAt(x, y, lerp(f.r0, f.r1, p), s, f.card, f.faceUp, 0.25 + 0.4 * Math.sin(Math.PI * p));
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

    function drawShocks() {
      for (const s of shocks) {
        const k = clamp(s.t / s.life, 0, 1);
        g.save();
        g.globalAlpha = (1 - k) * 0.75;
        g.strokeStyle = s.ink;
        g.lineWidth = s.w * (1 - k * 0.7);
        g.beginPath();
        g.arc(s.x, s.y, lerp(s.r0, s.r1, easeOut(k)), 0, TAU);
        g.stroke();
        g.restore();
      }
      g.globalAlpha = 1;
    }

    /**
     * The middle of the table: a ring that carries the stakes, the tribute and
     * the turn, plus a plate at each end seat naming the state in words.
     */
    function drawRing(now) {
      const stake = clamp(pile.length / Math.max(6, deckN * 0.5), 0, 1);
      g.save();
      g.translate(L.px, L.py);
      g.lineCap = "round";

      g.strokeStyle = "rgba(255,244,214,0.09)";
      g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, L.ringR, 0, TAU); g.stroke();

      if (slapNow) {
        const pulse = 0.55 + 0.45 * Math.sin(now * 0.022);
        for (let i = 1; i <= 5; i++) {
          g.globalAlpha = 0.15 * (1 - i / 6) * (0.45 + 0.55 * pulse);
          g.strokeStyle = GOLD;
          g.lineWidth = i * 5;
          g.beginPath(); g.arc(0, 0, L.ringR + i * 2.5, 0, TAU); g.stroke();
        }
        g.globalAlpha = 1;
      }
      if (ringPulse > 0) {
        g.globalAlpha = ringPulse * 0.8;
        g.strokeStyle = "#fff2c4";
        g.lineWidth = 2 + ringPulse * 5;
        g.beginPath(); g.arc(0, 0, L.ringR * (0.45 + (1 - ringPulse) * 0.62), 0, TAU); g.stroke();
        g.globalAlpha = 1;
      }

      // Stake arc: how much of the table is riding on the next hand down.
      g.strokeStyle = slapNow ? GOLD : COPPER_DIM;
      g.lineWidth = slapNow ? 6 : 2.8;
      g.beginPath();
      g.arc(0, 0, L.ringR, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(stake, 0.001));
      g.stroke();

      // The collect countdown runs the other way round the ring in the
      // creditor's own colour, so the beat you have left to steal it is a
      // shape and not a number.
      if (pendingCollect) {
        const p = players[pendingCollect.idx];
        const k = clamp((now - pendingCollect.t0) / pendingCollect.dur, 0, 1);
        g.strokeStyle = hexA(p.ink, 0.9);
        g.lineWidth = 5;
        g.beginPath();
        g.arc(0, 0, L.ringR - 9, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k), false);
        g.stroke();
      }

      // Tribute pips, in the creditor's colour, sitting on the ring.
      if (tribute) {
        const cred = players[tribute.creditor];
        const total = TRIBUTE[tribute.rank];
        for (let i = 0; i < total; i++) {
          const a = -Math.PI / 2 + (i - (total - 1) / 2) * 0.20;
          const x = Math.cos(a) * (L.ringR + 13), y = Math.sin(a) * (L.ringR + 13);
          const paid = i >= tribute.left;
          g.beginPath();
          g.arc(x, y, paid ? 3 : 4.6, 0, TAU);
          g.fillStyle = paid ? "rgba(255,244,214,0.20)" : cred.ink;
          g.fill();
        }
      }

      // A chevron on the ring pointing at whoever has to act. It is the one
      // piece of state everybody at the table needs at once, and an arrow is
      // the only shape that reads the same from all four sides.
      if (phase === "play" && !slapNow && !pendingCollect && players[turn] && !players[turn].out) {
        const p = players[turn];
        const bob = Math.sin(now * 0.006) * 2.5;
        g.save();
        g.rotate(-p.rad);
        g.translate(0, L.ringR + 16 + bob);
        g.fillStyle = hexA(p.ink, 0.92);
        g.beginPath();
        g.moveTo(0, 7); g.lineTo(-7.5, -5); g.lineTo(7.5, -5);
        g.closePath(); g.fill();
        g.restore();
      }
      g.restore();

      // The status plate, drawn once for each end seat so both of them read it
      // the right way up. The side seats get the same words on their own pad.
      let text = pile.length ? String(pile.length) : "";
      let ink = COPPER, bg = "rgba(6,20,14,0.74)";
      if (slapNow) { text = KIND_LABEL[slapNow]; ink = "#141008"; bg = GOLD; }
      else if (pendingCollect) { text = players[pendingCollect.idx].name.toUpperCase() + " TAKES IT"; ink = players[pendingCollect.idx].ink; }
      else if (tribute) { text = "PAY " + tribute.left; ink = players[tribute.creditor].ink; }
      if (!text) return;
      for (const rad of [0, Math.PI]) {
        g.save();
        g.translate(L.px, L.py);
        g.rotate(rad);
        g.translate(0, L.ringR + 34);
        g.font = "800 12px " + FONT;
        g.textAlign = "center"; g.textBaseline = "middle";
        const pw = g.measureText(text).width + 30;
        const scale = slapNow ? 1 + 0.06 * Math.sin(now * 0.024) : 1;
        g.scale(scale, scale);
        roundRect(g, -pw / 2, -11, pw, 22, 11);
        g.fillStyle = bg; g.fill();
        g.strokeStyle = slapNow ? "rgba(255,255,255,0.5)" : COPPER_DIM;
        g.lineWidth = 1; g.stroke();
        g.fillStyle = ink;
        tracked(g, text, 0, 0.5, 2);
        g.restore();
      }
    }

    /* --- pads ----------------------------------------------------- */
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
      const layers = Math.min(6, 1 + Math.round(count / 5));
      for (let i = layers; i >= 2; i--) {
        g.save();
        g.translate(x - i * 0.9, y - i * 1.5);
        g.rotate(-0.018 * i);
        roundRect(g, -cw / 2, -ch / 2, cw, ch, CARD_R * sc);
        g.fillStyle = "#3d0d15"; g.fill();
        g.strokeStyle = "rgba(0,0,0,0.40)"; g.lineWidth = 1; g.stroke();
        g.restore();
      }
      drawCardAt(x - 0.9, y - 1.5, -0.018, sc, null, false, 0.04);
    }

    function drawPad(p, now) {
      const R = L.rects[p.seat];
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      const armed = !!slapNow && p.lock <= 0 && !p.out;
      const mine = phase === "play" && !slapNow && !pendingCollect && turn === p.idx && !p.out && p.deck.length > 0;
      const owes = tribute && !slapNow && turn === p.idx && !p.out;
      const side = Math.abs(p.rad) > 0.1 && Math.abs(p.rad) < Math.PI - 0.1;

      g.save();
      if (p.bad > 0) g.translate((rnd() - 0.5) * p.bad * 11, (rnd() - 0.5) * p.bad * 11);
      g.translate(cx, cy);
      const sc = 1 - p.press * 0.028 + p.flashT * 0.02;
      g.scale(sc, sc);

      const w = R.w, h = R.h, rr = 20;

      // Armed glow: concentric strokes standing in for the blur we cannot use.
      if (armed || mine) {
        const pulse = 0.5 + 0.5 * Math.sin(now * (armed ? 0.024 : 0.006));
        g.strokeStyle = armed ? GOLD : p.ink;
        for (let i = 3; i >= 1; i--) {
          g.globalAlpha = (armed ? 0.17 : 0.09) * (1 - i / 4.2) * (0.45 + 0.55 * pulse);
          g.lineWidth = i * 8;
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
      base.addColorStop(0.00, "rgba(22,35,27,0.95)");
      base.addColorStop(1.00, "rgba(5,16,11,0.97)");
      g.fillStyle = base;
      g.fill();
      // The colour is a second pass on top. Folded into the leather gradient it
      // mixes with the green showing through and every pad comes out olive.
      const wash = g.createLinearGradient(nx * ext, ny * ext, -nx * ext, -ny * ext);
      const heat = p.out ? 0.05 : (armed ? 0.30 : mine ? 0.26 : 0.13) + p.flashT * 0.55;
      wash.addColorStop(0.00, hexA(armed ? GOLD : p.ink, heat));
      wash.addColorStop(0.62, hexA(p.ink, p.flashT * 0.22));
      g.fillStyle = wash;
      g.fill();
      g.strokeStyle = p.out ? "rgba(255,255,255,0.10)"
        : p.lock > 0 ? "rgba(255,90,90,0.78)"
        : armed ? hexA(GOLD, 0.95)
        : hexA(p.ink, Math.max(mine ? 0.85 : 0.40, p.flashT));
      g.lineWidth = armed || p.lock > 0 || mine ? 2.4 : 1.4 + p.flashT * 1.6;
      g.stroke();

      roundRect(g, -w / 2 + 7, -h / 2 + 7, w - 14, h - 14, rr - 6);
      g.strokeStyle = "rgba(255,255,255,0.055)";
      g.lineWidth = 1;
      g.stroke();

      // Copper rivets.
      g.fillStyle = armed ? GOLD : "rgba(217,154,82,0.32)";
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        g.beginPath();
        g.arc(sx * (w / 2 - 12), sy * (h / 2 - 12), 2.2, 0, TAU);
        g.fill();
      }

      // The win flash is a warm lamp bloom rather than a flat white fill: at
      // full white the pad bleaches to a grey slab at exactly the moment the
      // player's own colour matters most.
      if (p.flashT > 0) {
        const f = easeOut(p.flashT);
        const bloom = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) * 0.62);
        bloom.addColorStop(0.00, "rgba(255,247,226," + (f * 0.28).toFixed(3) + ")");
        bloom.addColorStop(1.00, "rgba(255,247,226,0)");
        roundRect(g, -w / 2, -h / 2, w, h, rr);
        g.fillStyle = bloom;
        g.fill();
      }

      // Everything below reads right way up from this player's seat.
      g.rotate(p.rad);
      const lw = side ? h : w, lh = side ? w : h;
      g.textAlign = "center"; g.textBaseline = "middle";

      if (p.out) {
        g.save();
        roundRect(g, -lw / 2 + 6, -lh / 2 + 6, lw - 12, lh - 12, rr - 6);
        g.clip();
        g.strokeStyle = "rgba(255,255,255,0.05)";
        g.lineWidth = 7;
        for (let i = -lh; i < lw + lh; i += 20) {
          g.beginPath(); g.moveTo(i, -lh / 2); g.lineTo(i - lh, lh / 2); g.stroke();
        }
        g.restore();
        g.fillStyle = "rgba(245,237,218,0.42)";
        g.font = "800 " + Math.round(Math.min(lh * 0.18, 17)) + "px " + FONT;
        tracked(g, p.name.toUpperCase() + " IS OUT", 0, 0, 3.4);
        g.restore();
        return;
      }

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
        tracked(g, "BURNED", 0, -lh * 0.20, 2.6);
        const barW = lw * 0.40 * (p.lock / LOCK_S);
        roundRect(g, -lw * 0.20, lh * 0.20 - 3, lw * 0.40, 6, 3);
        g.fillStyle = "rgba(255,255,255,0.10)"; g.fill();
        roundRect(g, -lw * 0.20, lh * 0.20 - 3, barW, 6, 3);
        g.fillStyle = BURN; g.fill();
        g.restore();
        return;
      }

      // The seat's own suit, pressed into the leather like a maker's mark.
      g.fillStyle = hexA(p.ink, 0.20);
      suitPath(g, p.suit, Math.min(lw * 0.30, 96), lh * 0.02, Math.min(lh * 0.115, 13));

      miniStack(-lw * 0.16, lh * 0.03, p.deck.length, clamp(lh / 140 * 0.52, 0.20, 0.38));

      g.fillStyle = hexA(p.ink, 0.92);
      g.font = "700 " + Math.round(Math.min(lh * 0.13, 12)) + "px " + FONT;
      tracked(g, p.name.toUpperCase(), 0, -lh * 0.27, 3);

      g.fillStyle = armed ? "#fffdf4" : CREAM;
      g.font = "800 " + Math.round(Math.min(lh * 0.40, 46)) + "px " + FONT;
      g.fillText(String(p.deck.length), lw * 0.07, lh * 0.10);

      // One line of state, and only one: SLAP beats everything, then the
      // tribute you owe, then your own turn.
      let chip = null, chipInk = p.ink;
      if (armed) { chip = "SLAP"; chipInk = GOLD; }
      else if (owes) { chip = "PAY " + tribute.left; chipInk = players[tribute.creditor].ink; }
      else if (mine) { chip = "FLIP"; chipInk = p.ink; }
      if (chip) {
        g.fillStyle = chipInk;
        g.font = "800 " + Math.round(Math.min(lh * 0.115, 11)) + "px " + FONT;
        tracked(g, chip, 0, lh * 0.37, 3.5);
      }
      g.restore();
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
      g.font = "800 29px " + FONT;
      const tw = g.measureText(banner.big).width + 44;
      // The shout runs along the winner's own axis, so at a side seat it is the
      // height of the table it has to fit inside, not the width.
      const along = Math.abs(Math.abs(banner.rad) - Math.PI / 2) < 0.1
        ? L.bandH - 24 : L.bandW - 14;
      const fit = Math.min(1, along / tw);

      g.globalAlpha = out;
      g.translate(L.px, L.py);
      g.rotate(banner.rad);
      g.scale(pop * fit, pop * fit);
      roundRect(g, -tw / 2, -40, tw, 80, 18);
      g.fillStyle = "rgba(6,18,12,0.84)"; g.fill();
      g.strokeStyle = hexA(banner.ink, 0.78); g.lineWidth = 2; g.stroke();

      g.fillStyle = banner.ink;
      g.fillText(banner.big, 0, -11);
      g.fillStyle = "rgba(245,237,218,0.78)";
      g.font = "600 11.5px " + FONT;
      tracked(g, banner.small, 0, 17, 0.6);
      g.restore();
    }

    /* --- the deal ------------------------------------------------- */
    function drawDeal(now) {
      const t = clamp(dealT / 1.0, 0, 1);
      const seats = players.length;
      const per = 5;
      for (let i = 0; i < seats * per; i++) {
        const k = clamp((t - i * 0.028) / 0.26, 0, 1);
        if (k <= 0) continue;
        const p = easeOut(k);
        const target = padCentre(players[i % seats].seat);
        const x = lerp(L.px, target.x, p);
        const y = lerp(L.py, target.y, p) - Math.sin(Math.PI * p) * 24;
        const s = lerp(1, 0.34, p);
        drawCardAt(x, y, lerp(0, players[i % seats].rad + (rnd() - 0.5) * 0.06, p),
          s, null, false, 0.35 * Math.sin(Math.PI * p), k > 0.9);
      }
    }

    /* --- the title heap ------------------------------------------- */
    /**
     * A frozen slap: a scruffy heap with two eights lying side by side on top
     * of it, both corner indices showing. It is the whole game in one still,
     * and it is why the title screen needs no diagram.
     *
     * The pair is fanned apart rather than stacked. Squarely overlapped, the
     * upper eight hid the lower one and the picture said "some cards" instead
     * of "a double" — which is the only thing it is there to say.
     */
    const STRAY = [
      { id: "2D", x: -168, y: -132, r: -1.15, a: 0.30 },
      { id: "5C", x: 176, y: 116, r: 0.92, a: 0.26 },
      { id: "AS", x: 150, y: -168, r: 0.44, a: 0.22 },
    ];
    const HEAP = [
      { id: "4C", x: -66, y: 40, r: -0.72 },
      { id: "9D", x: 58, y: 44, r: 0.64 },
      { id: "KS", x: -46, y: -26, r: -0.40 },
      { id: "6H", x: 62, y: -28, r: 0.82 },
      { id: "QC", x: 4, y: 36, r: 0.18 },
      { id: "8S", x: -28, y: 2, r: -0.19 },
      { id: "8H", x: 32, y: -6, r: 0.17 },
    ];
    function drawHeap(now) {
      const cx = W / 2, cy = H * 0.335;
      const rock = Math.sin(now * 0.0008) * 0.02;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.0032);

      // Cards that fell off the table, cropped by the frame. They cost nothing
      // and they are the difference between a product shot and a game in play.
      for (const c of STRAY) {
        g.save();
        g.globalAlpha = c.a;
        const card = { id: c.id, rank: c.id.slice(0, -1), suit: c.id.slice(-1) };
        drawCardAt(cx + c.x, cy + c.y, c.r + rock * 0.5, 0.72, card, true, 0.04);
        g.restore();
      }

      // The impact ring, wider than the heap so it reads as something leaving
      // the pile rather than a halo stuck behind it.
      g.save();
      g.translate(cx, cy);
      for (let i = 5; i >= 1; i--) {
        g.globalAlpha = 0.13 * (1 - i / 6) * (0.35 + 0.65 * pulse);
        g.strokeStyle = GOLD;
        g.lineWidth = i * 8;
        g.beginPath(); g.arc(0, 0, 128 + i * 3, 0, TAU); g.stroke();
      }
      g.globalAlpha = 0.42 + 0.32 * pulse;
      g.strokeStyle = GOLD; g.lineWidth = 1.8;
      g.beginPath(); g.arc(0, 0, 132, 0, TAU); g.stroke();
      g.globalAlpha = 0.18 + 0.14 * pulse;
      g.lineWidth = 1;
      g.beginPath(); g.arc(0, 0, 149 + pulse * 9, 0, TAU); g.stroke();
      // Motes drifting in the lamp light above the felt.
      for (let i = 0; i < 14; i++) {
        const a = i * 0.4488 + now * 0.00016 * (i % 3 ? 1 : -1);
        const rr = 118 + ((i * 37) % 74);
        g.globalAlpha = 0.10 + 0.16 * (0.5 + 0.5 * Math.sin(now * 0.0013 + i));
        g.fillStyle = i % 4 === 0 ? CREAM : GOLD;
        g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.86, 1.5, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      g.restore();

      for (const c of HEAP) {
        const card = { id: c.id, rank: c.id.slice(0, -1), suit: c.id.slice(-1) };
        drawCardAt(cx + c.x, cy + c.y, c.r + rock, 0.90, card, true, 0.10);
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
        g.translate((rnd() - 0.5) * shake * 20, (rnd() - 0.5) * shake * 20);
      }

      if (phase === "menu") {
        drawHeap(now);
      } else if (phase === "deal") {
        drawDeal(now);
      } else {
        drawRing(now);
        drawPile(now);
        drawShocks();
        drawFlyers(now);
        drawParts();
      }
      g.restore();

      if (phase !== "menu") {
        for (const p of players) drawPad(p, now);
        drawBanner(now);
      }

      if (flash.a > 0.004) {
        // A tint over the whole table, not a wash. At full strength the peak
        // frame is a single flat colour and the felt, the cards and three other
        // people's pads all go the winner's yellow at once.
        g.globalAlpha = flash.a * 0.30;
        g.fillStyle = flash.ink;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    ctx.onFrame((dtMs) => {
      // Two clocks. `dt` is clamped hard and drives decay and easing, where a
      // long stall must not make everything jump. `dtG` is the game clock; it
      // stops dead while a full-screen sheet is up, because cards must not be
      // swept and pads must not unlock behind a panel nobody can slap through.
      const dt = Math.min(dtMs, 60) / 1000;
      const dtG = sheetOpen ? 0 : Math.min(dtMs, 250) / 1000;
      const now = performance.now();

      shake *= Math.pow(0.0022, dt);
      flash.a *= Math.pow(0.0009, dt);
      ringPulse = Math.max(0, ringPulse - dt * 2);
      for (const p of players) {
        p.press = Math.max(0, p.press - dt * 5);
        p.flashT = Math.max(0, p.flashT - dt * 2.4);
        p.bad = Math.max(0, p.bad - dt * 3);
        if (p.lock > 0) p.lock = Math.max(0, p.lock - dtG);
      }
      if (flipLock > 0) flipLock = Math.max(0, flipLock - dtG);
      stepParts(dt);
      stepShocks(dt);
      stepFlyers(now);

      if (phase === "deal") {
        dealT += dtG;
        if (dealT >= 1.05) { phase = "play"; flipLock = 0.1; }
      } else if (phase === "play") {
        const top = pile[pile.length - 1];
        if (top && !top.landed && now - top.t0 >= LAND_MS) {
          top.landed = true;
          puff(L.px + top.ox, L.py + top.oy);
        }
        if (pendingCollect && !sheetOpen && now - pendingCollect.t0 >= pendingCollect.dur) {
          const p = players[pendingCollect.idx];
          const n = pile.length;
          banner = {
            t0: now, ink: p.ink, rad: p.rad, life: 1000,
            big: p.name.toUpperCase() + " TAKES IT",
            small: (pendingCollect.reason === "tribute" ? "TRIBUTE UNPAID" : "TABLE STALLED") + "   ·   +" + n + " cards",
          };
          shock(L.px, L.py, p.ink, 6, L.ringR * 1.6, 0.5, 3);
          burst(L.px, L.py, p.ink, 16, 220);
          sound.sting("success");
          sound.haptic("medium");
          award(p, now, "collect");
        }
      } else if (phase === "resolve") {
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
     * pointer-transparent so a slap lands on the table underneath; only
     * the chrome and the full-screen panels take input.
     * ============================================================= */
    const SAFE_T = ctx.safeArea.top, SAFE_B = ctx.safeArea.bottom;
    const btn = "pointer-events:auto;width:38px;height:38px;border-radius:12px;border:none;" +
      "background:rgba(6,22,15,0.72);color:" + CREAM + ";font-size:15px;line-height:1;" +
      "font-family:inherit;padding:0;box-shadow:inset 0 0 0 1px rgba(217,154,82,0.30);";
    const bigBtn = (bg, fg, edge) => "width:100%;padding:15px;border:none;border-radius:15px;font-family:inherit;" +
      "font-size:16px;font-weight:700;background:" + bg + ";color:" + fg + ";margin-top:11px;" +
      "pointer-events:auto;" + (edge ? "box-shadow:inset 0 0 0 1px " + edge + ";" : "");
    const QUIET = "linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.055))";
    const QUIET_EDGE = "rgba(217,154,82,0.42)";
    const GOLDBTN = "linear-gradient(180deg,#ffe08f,#d09a34)";
    const panel = "max-width:322px;width:100%;background:linear-gradient(180deg,#132e1e,#0a1d14);" +
      "border-radius:22px;padding:22px;box-shadow:inset 0 0 0 1px rgba(217,154,82,0.28),0 20px 60px rgba(0,0,0,0.55);";
    const label = "font-size:11px;letter-spacing:0.24em;text-transform:uppercase;opacity:0.52;";
    // overflow-y:auto so a long panel on a short phone scrolls rather than
    // centring itself off both ends, which puts its close button out of reach.
    const sheetCss = "position:absolute;inset:0;display:none;align-items:center;" +
      "align-items:safe center;justify-content:center;" +
      "background:rgba(3,12,8,0.90);z-index:70;padding:" + (SAFE_T + 14) + "px 24px " +
      (SAFE_B + 14) + "px;overflow-y:auto;pointer-events:auto;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:" + CREAM + ";pointer-events:none;";
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
        'padding:0 26px ' + (SAFE_B + 24) + 'px;text-align:center;background:linear-gradient(180deg,' +
        'rgba(3,14,9,0) 18%,rgba(3,14,9,0.22) 36%,rgba(3,14,9,0.88) 54%,rgba(3,14,9,0.98) 100%);">' +
        '<div style="' + label + 'margin-bottom:8px;font-size:10.5px;">Egyptian</div>' +
        '<div style="font-size:47px;font-weight:800;letter-spacing:0.02em;line-height:0.95;' +
          'background:linear-gradient(178deg,#fff6df 6%,#f0c25c 48%,#a3691a);-webkit-background-clip:text;' +
          'background-clip:text;-webkit-text-fill-color:transparent;color:transparent;' +
          'text-shadow:0 8px 30px rgba(0,0,0,0.5);">RATSCREW</div>' +
        '<div style="width:120px;height:1px;background:linear-gradient(90deg,rgba(217,154,82,0),' +
          'rgba(217,154,82,0.75),rgba(217,154,82,0));margin:13px 0 0;"></div>' +
        '<div style="font-size:14px;line-height:1.55;opacity:0.66;max-width:270px;margin-top:12px;">' +
          'Phone flat, a pad each. Tap yours to throw a card. Double, sandwich or tens ' +
          'in the middle and the first hand down takes the pile.</div>' +
        '<div style="' + label + 'margin:20px 0 10px;">Players</div>' +
        '<div data-el="seats" style="display:flex;gap:10px;width:206px;"></div>' +
        '<div style="width:100%;max-width:250px;">' +
          '<button data-el="deal" style="' + bigBtn(GOLDBTN, "#221503") +
            'margin-top:18px;letter-spacing:0.06em;">Deal</button>' +
        '</div>' +
      '</div>' +

      /* ---- game over ---- */
      '<div data-el="over" style="position:absolute;inset:0;display:none;flex-direction:column;' +
        'align-items:center;justify-content:center;z-index:60;padding:26px;text-align:center;' +
        'pointer-events:auto;background:radial-gradient(120% 60% at 50% 45%,rgba(3,16,10,0.82),rgba(2,9,6,0.97));">' +
        // The result, turned round for whoever is sitting at the other end. It
        // is the same plate as the main one, just compact — an eyebrow, the
        // winner and every count — so the far seat is told the whole result
        // rather than shown a stray upside-down word.
        '<div style="transform:rotate(180deg);max-width:300px;width:100%;margin-bottom:18px;' +
          'background:linear-gradient(180deg,#132e1e,#0a1d14);border-radius:18px;padding:12px 16px 13px;' +
          'box-shadow:inset 0 0 0 1px rgba(217,154,82,0.26),0 14px 36px rgba(0,0,0,0.45);">' +
          '<div style="' + label + 'font-size:9.5px;">Game over</div>' +
          '<div data-el="over-mirror" style="font-size:25px;font-weight:800;margin-top:2px;' +
            'letter-spacing:-0.02em;line-height:1.15;"></div>' +
          '<div data-el="over-mirror-rows" style="display:flex;flex-wrap:wrap;gap:6px 13px;' +
            'justify-content:center;margin-top:8px;"></div>' +
        '</div>' +
        '<div style="max-width:300px;width:100%;' + panel + 'padding:22px 20px 20px;">' +
          '<div style="' + label + '">Game over</div>' +
          '<div data-el="over-title" style="font-size:35px;font-weight:800;margin-top:5px;letter-spacing:-0.02em;line-height:1.1;"></div>' +
          '<div data-el="over-sub" style="font-size:12.5px;opacity:0.58;margin-top:5px;letter-spacing:0.04em;"></div>' +
          '<div style="height:1px;background:rgba(217,154,82,0.22);margin:18px 0 14px;"></div>' +
          '<div data-el="over-rows"></div>' +
        '</div>' +
        '<div style="width:100%;max-width:300px;margin-top:16px;">' +
          '<button data-el="again" style="' + bigBtn(GOLDBTN, "#221503") + '">Deal again</button>' +
          '<button data-el="quit" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + '">Change players</button>' +
        '</div>' +
      '</div>' +

      /* ---- settings ---- */
      '<div data-el="cogp" style="' + sheetCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:16px;">Settings</div>' +
          '<div style="' + label + '">Sound</div>' +
          '<div data-el="mutes" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Players</div>' +
          '<div data-el="counts" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Cards each</div>' +
          '<div data-el="deals" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Tens slap</div>' +
          '<div data-el="tenses" style="display:flex;gap:8px;margin:9px 0 4px;"></div>' +
          '<div style="font-size:12px;opacity:0.45;margin-top:8px;line-height:1.5;">' +
            'Tens: two number cards in a row adding to ten. Off by default in some houses — ' +
            'it roughly doubles how often the table is live.</div>' +
          '<button data-el="cogp-close" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + 'margin-top:16px;">Done</button>' +
        '</div>' +
      '</div>' +

      /* ---- how to play ---- */
      '<div data-el="helpp" style="' + sheetCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:13.5px;line-height:1.62;opacity:0.86;padding-left:18px;margin:0;">' +
            '<li>Lay the phone flat. Everyone takes the pad on their own edge — that pad is your face-down stack.</li>' +
            '<li>When your pad says <b>FLIP</b>, tap it to throw your top card into the middle.</li>' +
            '<li>Throw a face card or an ace and the next player owes tribute: ' +
              '<b>4</b> cards for an ace, <b>3</b> for a king, <b>2</b> for a queen, <b>1</b> for a jack.</li>' +
            '<li>If they turn up a face card while paying, the debt <b>flips back</b> onto you and they become the creditor.</li>' +
            '<li>Pay in full without one and the pile is yours.</li>' +
            '<li><b>Slap the moment the middle goes gold.</b> DOUBLE — top two the same rank. ' +
              'SANDWICH — top and third the same. TENS — two number cards adding to ten.</li>' +
            '<li>Every pad is live at once and the <b>first hand down</b> takes the pile. Being second costs nothing.</li>' +
            '<li>Slap at nothing and it is a <b>burn</b>: one card off your stack, face down under the pile, and your pad locks for a moment.</li>' +
            '<li>Out of cards? You stay in until the pile is claimed — so slap your way back in. Burn on empty and you are out for good.</li>' +
            '<li>Last player still holding cards wins. The fastest clean slap of the game goes to the global board.</li>' +
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
        'font-family:inherit;font-size:13.5px;font-weight:600;pointer-events:auto;">' + labels[i] + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          // A copper chip, the same metal as the Deal button. Translucent white
          // over the panel's green mixes down to a khaki that reads as the
          // disabled state — the wrong answer looking no different from the
          // right one is the one thing a segmented control must never do.
          b.style.background = on ? GOLDBTN
            : "linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.045))";
          b.style.color = on ? "#241704" : "rgba(245,237,218,0.62)";
          b.style.boxShadow = on
            ? "inset 0 1px 0 rgba(255,252,238,0.55),0 2px 8px rgba(0,0,0,0.35)"
            : "inset 0 0 0 1px rgba(217,154,82,0.16)";
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
    repaints = [
      pills(shell.el("seats"), [2, 3, 4], ["2", "3", "4"],
        () => settings.players, (v) => { settings.players = v; if (phase === "menu") { layout(); bakeTable(); } }),
      pills(shell.el("counts"), [2, 3, 4], ["2", "3", "4"],
        () => settings.players, (v) => { settings.players = v; }),
      pills(shell.el("deals"), [0, 1], ["Six each", "Whole deck"],
        () => settings.deal, (v) => { settings.deal = v; }),
      pills(shell.el("tenses"), [0, 1], ["Off", "On"],
        () => settings.tens, (v) => { settings.tens = v; }),
      pills(shell.el("mutes"), [0, 1], ["On", "Muted"],
        () => (sound.muted ? 1 : 0), (v) => {
          if ((v === 1) !== sound.muted) { sound.toggle(); paintMute(); }
        }),
    ].filter(Boolean);

    /** One glyph, struck through when muted — an emoji speaker would drag a
     *  second colour palette into a very deliberate one. */
    function paintMute() {
      const b = shell.el("mute");
      b.style.textDecoration = sound.muted ? "line-through" : "none";
      b.style.opacity = sound.muted ? "0.45" : "1";
    }
    paintMute();

    shell.tap(shell.el("mute"), () => { sound.toggle(); paintMute(); paintAllPills(); });

    /** Open or close a full-screen sheet, freezing the game while it is up. */
    function showSheet(name, open) {
      shell.el(name).style.display = open ? "flex" : "none";
      if (open === sheetOpen) return;
      sheetOpen = open;
      if (open) { sheetSince = performance.now(); return; }
      // Give back the time the panel was up, or the reaction clock would bill
      // the reader for it and a live slap window would price itself absurdly.
      const held = performance.now() - sheetSince;
      slapSince += held;
      graceUntil += held;
      if (pendingCollect) pendingCollect.t0 += held;
    }
    shell.tap(shell.el("cog"), () => { showSheet("cogp", true); paintAllPills(); });
    shell.tap(shell.el("cogp-close"), () => { showSheet("cogp", false); });
    shell.tap(shell.el("help"), () => { showSheet("helpp", true); });
    shell.tap(shell.el("helpp-close"), () => { showSheet("helpp", false); });

    shell.tap(shell.el("deal"), async () => {
      ctx.platform.start({ players: settings.players, deal: settings.deal ? "full" : "six", tens: !!settings.tens });
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
      players = [];
      layout(); bakeTable();
      paintAllPills();
    });

    /* ===============================================================
     * INPUT
     *
     * A pointer is bound to a pad the moment it lands and keeps that pad
     * until it lifts; a pad that already has a live pointer refuses any
     * more. Without both, one player's stray hand drives a neighbour's
     * pad, or one person quietly owns two of them.
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
      padDown(p, performance.now());
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

    /**
     * One pad, one tap, and the whole game decided here.
     *
     * The order of these tests is the ruling. A live slap outranks your own
     * flip, because that is what a hand at a real table does — nobody turns a
     * card while a double is sitting there. Everything after that is either a
     * legal throw or a hand that came down on nothing.
     */
    function padDown(p, now) {
      p.press = 1;
      if (phase !== "play") return;              // the menu, the deal and the end are free
      if (p.out) return;
      if (p.lock > 0) { p.bad = Math.max(p.bad, 0.6); sound.haptic("error"); return; }

      if (slapNow) { winSlap(p, now, slapNow); return; }

      if (now < graceUntil) {                    // somebody just beat them to it
        claims.push({ seat: p.seat, name: p.name, verdict: "late",
                      ms: Math.max(1, Math.round(now - slapSince)) });
        p.flashT = Math.max(p.flashT, 0.35);
        sound.haptic("light");
        return;
      }

      // Your own flip is still landing. A second tap here is an eager
      // double-tap on your own card, not a slap at thin air, so it costs
      // nothing — charging for it would make throwing a card feel dangerous.
      if (flipLock > 0) { if (p.idx === turn) return; }

      if (!pendingCollect && flipLock <= 0 && p.idx === turn && p.deck.length > 0) {
        flipCard(p, now);
        return;
      }
      burnSlap(p, now);
    }

    /* ===============================================================
     * RESIZE — the table is measured from the container, so a rotation
     * or a keyboard has to remeasure and rebake rather than stretch.
     * ============================================================= */
    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      canvas.width = Math.round(ctx.width * dpr);
      canvas.height = Math.round(ctx.height * dpr);
      layout();
      bakeTable();
    });

    /* ===============================================================
     * A read-only window on the game, so the local harness can drive a
     * real match and assert on what actually happened. It exposes
     * nothing the bit does not already draw on screen.
     * ============================================================= */
    window.__RATSCREW__ = {
      get phase() { return phase; },
      get busy() { return phase !== "play" || flipLock > 0 || !!pendingCollect; },
      get pile() { return pile.length; },
      get slap() { return slapNow; },
      get turn() { return players[turn] ? players[turn].seat : null; },
      get tribute() { return tribute ? { by: players[tribute.creditor].seat, left: tribute.left, rank: tribute.rank } : null; },
      get collecting() { return pendingCollect ? players[pendingCollect.idx].seat : null; },
      get counts() {
        return players.map((p) => ({ name: p.name, seat: p.seat, cards: p.deck.length, lock: p.lock, out: p.out }));
      },
      get claims() { return claims.slice(); },
      get lastSlap() { return lastSlap; },
      get bestMs() { return bestMs; },
      get winner() { return winner ? winner.name : null; },
      get deckN() { return deckN; },
      get total() { return players.reduce((n, p) => n + p.deck.length, 0) + pile.length; },
      get baked() { return BAKED; },
      get paused() { return sheetOpen; },
      pad(seat) { return padCentre(seat); },
    };
    ctx.onDestroy(() => { try { delete window.__RATSCREW__; } catch (_) {} });

    // The table and the title heap are on screen before ready() is called, so
    // the host never shows a blank bit for a single frame.
    render(performance.now());
    ctx.markVisualReady("table drawn");
    ctx.platform.ready();
  },
};
