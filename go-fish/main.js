/**
 * Go Fish — the asking game, for two to four people and one phone, played in
 * bright open water.
 *
 * Go Fish is a game about what everybody overheard. The cards in your hand
 * matter far less than the fact that Sunny asked Minnow for kings two turns
 * ago and did not get them. On a table that information is free — it is said
 * out loud. On one phone it is not free at all, and getting it back is the
 * whole design problem.
 *
 * Four decisions carry the build.
 *
 * The ask rule is enforced by construction. You may only ask for a rank you
 * already hold, and this is the rule casual play gets wrong every time. Rather
 * than accept an illegal ask and scold, the ask screen simply *is* your hand:
 * the tappable things are the rank groups you are holding, so an illegal ask
 * cannot be expressed. The same goes for the target — only players who still
 * have cards are offered, because asking an empty-handed player is not a move.
 *
 * Every ask is then printed on a full-screen public board, and printed a
 * second time upside down above it. The phone can lie flat in the middle of
 * the table and the person opposite reads "SNAPPER ASKS SUNNY FOR SEVENS" the
 * right way up. Nothing about the game works if that beat is missable, so it
 * is a screen of its own rather than a toast, and it holds until it is read.
 *
 * The cover is a TAP, not a hold. Hold-to-look is the usual privacy pattern
 * and it is wrong here: the screen behind the cover has to be tapped three
 * times — a rank, a player, then the ask — so holding it open would take a
 * third hand. Exposure is bounded by the player's own commit instead. The
 * cover lifts on a tap and closes itself the instant the ask is sent, so the
 * phone is never left sitting on somebody's cards.
 *
 * State commits before it animates. Cards move between hands the moment a beat
 * is entered and the flight is decoration over the top, so a tap that skips
 * the animation can never desynchronise the game from the picture. `busy` is
 * exposed for the harness to poll rather than have it guess at a sleep.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so all 52
 * faces, the card back, the water, the fish and the bubbles are canvas paths,
 * baked into OffscreenCanvases where they are reused — with a live-drawing
 * fallback for WebViews that have no OffscreenCanvas. The whole game UI is
 * canvas, and the overlay is one markup string on ctx.createRoot() carrying
 * only the chrome and the two sheets; the root is pointer-transparent because
 * it sits above the canvas and would otherwise swallow every tap. Pointer
 * maths uses offsetX/offsetY rather than getBoundingClientRect, and every soft
 * edge is stacked translucent fills rather than a canvas blur filter — all of
 * these are rejected at upload and none is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Go Fish",
    runtime: "plethora-bit@2",
    tags: ["cards", "multiplayer", "local-multiplayer", "family", "turn-based", "party"],
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
    const easeIn = (t) => t * t * t;
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const backOut = (t) => { const c = 1.9; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

    /** Escape anything that could ever be player-authored before it meets innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;" }[c] || "&quot;"));

    /* ===============================================================
     * PALETTE
     *
     * Deep water lit from above: a bright aqua ceiling falling through
     * teal to a near-black floor, with sand and coral as the only warm
     * notes. Every player colour has to read against blue from the top
     * of the screen to the bottom, so they are all warm or acid — a
     * blue or a sea-green player would simply disappear into the water.
     * ============================================================= */
    const SEA_SKY = "#5fe6f0";
    const SEA_HIGH = "#22b6d8";
    const SEA_MID = "#0a6f9e";
    const SEA_DEEP = "#063a63";
    const SEA_ABYSS = "#04182c";
    const SAND = "#f2dca8";
    const CORAL = "#ff7a5c";
    const SUN = "#ffe089";
    const FOAM = "#f2fdff";
    const NIGHT = "#04202f";

    const CARD_THEME = {
      face: "#fdfcf5",
      edge: "rgba(6,40,60,0.20)",
      red: "#e0344a",
      black: "#123a52",           // deep-sea navy, not black: the whole bit is water
    };
    const BACKS = [
      { name: "Deep", a: "#0d6f9c", b: "#073f63" },
      { name: "Coral", a: "#f0664a", b: "#a32f28" },
      { name: "Kelp", a: "#17845f", b: "#0a4a37" },
    ];

    /**
     * The four fish. Names, not colours: "pass to Sunny" is a sentence a
     * six-year-old can act on, and every one of them survives being laid on
     * water at any depth.
     */
    const FISH = [
      { name: "Snapper", ink: "#ff6b52", dim: "#a83420" },
      { name: "Sunny", ink: "#ffcf45", dim: "#b58600" },
      { name: "Minnow", ink: "#5cf0bd", dim: "#0f9d75" },
      { name: "Angel", ink: "#c79bff", dim: "#7b4ad6" },
    ];

    const FONT = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const SERIF = "Inter,-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";

    const RANK_WORD = {
      A: "ACES", 2: "TWOS", 3: "THREES", 4: "FOURS", 5: "FIVES", 6: "SIXES",
      7: "SEVENS", 8: "EIGHTS", 9: "NINES", 10: "TENS", J: "JACKS", Q: "QUEENS", K: "KINGS",
    };
    const RANK_ONE = {
      A: "ACE", 2: "TWO", 3: "THREE", 4: "FOUR", 5: "FIVE", 6: "SIX",
      7: "SEVEN", 8: "EIGHT", 9: "NINE", 10: "TEN", J: "JACK", Q: "QUEEN", K: "KING",
    };

    /* ===============================================================
     * SETTINGS — remembered between sessions.
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("gofish") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      players: clamp(saved.players || 2, 2, 4),
      pace: saved.pace === undefined ? 1 : clamp(saved.pace, 0, 2),   // 0 calm / 1 brisk / 2 snappy
      back: saved.back === undefined ? 0 : clamp(saved.back, 0, 2),
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("gofish", settings); } catch (_) {} }
    const PACE = [1.35, 1.0, 0.62];
    const pace = () => PACE[settings.pace];

    /* ===============================================================
     * SOUND — a soft bubbling bed under a cue on every beat that
     * matters. All of it wrapped: audio is a nicety and must never be
     * able to break a hand of cards.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "bubble", volume: 0.26, tempo: 104, intensity: 0.30 });
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
     * An offscreen drawing surface is OffscreenCanvas, never
     * document.createElement("canvas") — the latter is rejected at
     * upload. Older WebViews have no OffscreenCanvas at all, so every
     * bake returns null there and the caller paints live instead.
     * ============================================================= */
    function surface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;
      return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    }
    /**
     * willReadFrequently pins a bake surface to the CPU backend, which is what
     * a write-once blit source wants: a GPU-backed offscreen is read back
     * across the bus on every drawImage, and a hand of twelve cards does a
     * dozen of those per frame.
     */
    function surfCtx(s) { return s.getContext("2d", { willReadFrequently: true }); }
    const BAKED = typeof OffscreenCanvas !== "undefined";

    function roundRect(g2, x, y, w, h, r) {
      const k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      g2.beginPath();
      g2.moveTo(x + k, y);
      g2.arcTo(x + w, y, x + w, y + h, k);
      g2.arcTo(x + w, y + h, x, y + h, k);
      g2.arcTo(x, y + h, x, y, k);
      g2.arcTo(x, y, x + w, y, k);
      g2.closePath();
    }

    /**
     * A soft drop shadow without the canvas blur filter.
     *
     * Writing g.filter = "blur(...)" is rejected at upload: the property also
     * accepts url(#…), so any write to it reads as pulling in a remote
     * resource. Stacking progressively larger translucent fills gives the same
     * falloff, and it is the only shadow in the bit.
     */
    function dropShadow(g2, w, h, r, lift) {
      g2.fillStyle = "#001622";
      for (let i = 5; i >= 1; i--) {
        const k = i / 5;
        const sp = (1.5 + lift * 15) * k;
        g2.globalAlpha = 0.075 * (1 - k * 0.45);
        roundRect(g2, -w / 2 - sp, -h / 2 - sp + 3 + lift * 11, w + sp * 2, h + sp * 2, r + sp * 0.6);
        g2.fill();
      }
      g2.globalAlpha = 1;
    }

    /** #rrggbb plus an alpha, without dragging in a colour library. */
    function hexA(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a.toFixed(3) + ")";
    }

    /**
     * Letter-spaced small caps, measured by hand so it lands the same on every
     * engine. The per-character widths are memoised: this runs on labels every
     * frame and measureText is one of the few canvas calls that is not cheap.
     */
    const trackCache = new Map();
    // Set lowercase like the rest of the game. This helper draws one
    // character at a time for its own tracking, and single characters slip
    // past the case fold that every other canvas string goes through.
    function trackPlan(g2, text, spacing) {
      text = typeof text === "string" ? text.toLowerCase() : text;
      const key = g2.font + "|" + text + "|" + spacing;
      let plan = trackCache.get(key);
      if (!plan) {
        const chars = String(text).split("");
        const w = chars.map((c) => g2.measureText(c).width);
        let total = -spacing;
        for (const v of w) total += v + spacing;
        plan = { chars, w, total };
        trackCache.set(key, plan);
      }
      return plan;
    }
    function tracked(g2, text, x, y, spacing) {
      const plan = trackPlan(g2, text, spacing);
      let cx = x - plan.total / 2;
      const prev = g2.textAlign;
      g2.textAlign = "left";
      for (let i = 0; i < plan.chars.length; i++) { g2.fillText(plan.chars[i], cx, y); cx += plan.w[i] + spacing; }
      g2.textAlign = prev;
    }
    function trackedW(g2, text, spacing) { return trackPlan(g2, text, spacing).total; }

    /** Set a font, shrinking it until the text fits the width it is given. */
    function fitFont(g2, text, maxW, size, weight, family) {
      let s = size;
      g2.font = weight + " " + s + "px " + (family || FONT);
      const w = g2.measureText(text).width;
      if (w > maxW && w > 0) {
        s = Math.max(8, Math.floor(s * maxW / w));
        g2.font = weight + " " + s + "px " + (family || FONT);
      }
      return s;
    }

    /* ===============================================================
     * THE DECK — 52 faces drawn as canvas paths.
     *
     * There are no packaged assets, so pips, courts and the back are all
     * geometry. Each face is baked once at device scale and then
     * blitted, which keeps a hand of a dozen cards to a dozen
     * drawImage calls.
     * ============================================================= */
    const SUITS = [
      { id: "S", red: false }, { id: "H", red: true },
      { id: "D", red: true }, { id: "C", red: false },
    ];
    const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

    /** Suit glyph as a path, unit-scaled to roughly [-1, 1]. */
    function suitPath(g2, suit, x, y, s) {
      g2.save();
      g2.translate(x, y);
      g2.scale(s, s);
      g2.beginPath();
      if (suit === "H") {
        g2.moveTo(0, 0.75);
        g2.bezierCurveTo(-1.35, -0.15, -0.72, -1.05, 0, -0.45);
        g2.bezierCurveTo(0.72, -1.05, 1.35, -0.15, 0, 0.75);
      } else if (suit === "D") {
        g2.moveTo(0, -0.95); g2.lineTo(0.68, 0); g2.lineTo(0, 0.95); g2.lineTo(-0.68, 0);
      } else if (suit === "S") {
        g2.moveTo(0, -0.95);
        g2.bezierCurveTo(0.95, 0.05, 1.15, 0.62, 0.42, 0.62);
        g2.bezierCurveTo(0.16, 0.62, 0.08, 0.48, 0.08, 0.4);
        g2.lineTo(0.3, 0.95); g2.lineTo(-0.3, 0.95); g2.lineTo(-0.08, 0.4);
        g2.bezierCurveTo(-0.08, 0.48, -0.16, 0.62, -0.42, 0.62);
        g2.bezierCurveTo(-1.15, 0.62, -0.95, 0.05, 0, -0.95);
      } else {
        g2.arc(0, -0.42, 0.38, 0, TAU);
        g2.closePath(); g2.moveTo(-0.28, 0.22);
        g2.arc(-0.42, 0.16, 0.38, 0, TAU);
        g2.closePath(); g2.moveTo(0.8, 0.16);
        g2.arc(0.42, 0.16, 0.38, 0, TAU);
        g2.closePath();
        g2.moveTo(0.09, 0.2); g2.lineTo(0.3, 0.95); g2.lineTo(-0.3, 0.95); g2.lineTo(-0.09, 0.2);
      }
      g2.closePath();
      g2.fill();
      g2.restore();
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
     * Real courts are mirrored half-portraits and a literal one turns to mud
     * at the hundred pixels a phone gives a card. This is a single flat
     * heraldic figure — crown, face, mantle — reading as King, Queen or Jack
     * purely by its headwear, with the suit colour carrying everything else.
     */
    function drawCourt(g2, rank, suitId, ink, w, h) {
      const cx = w * 0.5, cy = h * 0.5;
      const iw = w * 0.66, ih = h * 0.60;
      const x0 = cx - iw / 2, y0 = cy - ih / 2;

      roundRect(g2, x0, y0, iw, ih, w * 0.045);
      g2.fillStyle = "rgba(6,40,60,0.05)"; g2.fill();
      g2.strokeStyle = ink; g2.lineWidth = Math.max(1, w * 0.016); g2.stroke();
      roundRect(g2, x0 + w * 0.028, y0 + w * 0.028, iw - w * 0.056, ih - w * 0.056, w * 0.03);
      g2.strokeStyle = ink; g2.lineWidth = Math.max(0.6, w * 0.007); g2.stroke();

      g2.save();
      roundRect(g2, x0 + w * 0.028, y0 + w * 0.028, iw - w * 0.056, ih - w * 0.056, w * 0.03);
      g2.clip();

      const fx = cx, fy = cy + ih * 0.03;
      const u = iw * 0.5;

      g2.fillStyle = ink;
      g2.beginPath();
      g2.moveTo(fx - u * 0.86, y0 + ih);
      g2.quadraticCurveTo(fx - u * 0.74, fy + u * 0.16, fx - u * 0.30, fy + u * 0.06);
      g2.lineTo(fx + u * 0.30, fy + u * 0.06);
      g2.quadraticCurveTo(fx + u * 0.74, fy + u * 0.16, fx + u * 0.86, y0 + ih);
      g2.closePath();
      g2.fill();

      g2.fillStyle = "rgba(253,252,245,0.94)";
      g2.beginPath();
      g2.moveTo(fx - u * 0.26, fy + u * 0.07);
      g2.lineTo(fx, fy + u * 0.42);
      g2.lineTo(fx + u * 0.26, fy + u * 0.07);
      g2.closePath();
      g2.fill();

      // The suit is knocked out of the mantle: drawn in ink it would be
      // ink-on-ink and vanish at this size.
      g2.fillStyle = "rgba(253,252,245,0.93)";
      suitPath(g2, suitId, fx, fy + u * 0.68, u * 0.25);

      g2.fillStyle = "rgba(253,252,245,0.96)";
      g2.beginPath();
      g2.ellipse(fx, fy - u * 0.30, u * 0.28, u * 0.34, 0, 0, TAU);
      g2.fill();
      g2.strokeStyle = ink; g2.lineWidth = Math.max(0.7, w * 0.009); g2.stroke();

      // Two dots and a line is the whole difference between a court card and a
      // hooded silhouette at this size.
      g2.fillStyle = ink;
      for (const ex of [-0.115, 0.115]) {
        g2.beginPath(); g2.ellipse(fx + u * ex, fy - u * 0.36, u * 0.036, u * 0.045, 0, 0, TAU); g2.fill();
      }
      g2.beginPath();
      g2.moveTo(fx - u * 0.09, fy - u * 0.18);
      g2.quadraticCurveTo(fx, fy - u * 0.12, fx + u * 0.09, fy - u * 0.18);
      g2.lineWidth = Math.max(0.8, w * 0.010);
      g2.strokeStyle = ink; g2.stroke();
      if (rank === "K") {
        g2.beginPath();
        g2.moveTo(fx - u * 0.26, fy - u * 0.24);
        g2.quadraticCurveTo(fx, fy + u * 0.22, fx + u * 0.26, fy - u * 0.24);
        g2.quadraticCurveTo(fx, fy - u * 0.06, fx - u * 0.26, fy - u * 0.24);
        g2.closePath(); g2.fill();
      } else if (rank === "Q") {
        for (const s of [-1, 1]) {
          g2.beginPath();
          g2.moveTo(fx + s * u * 0.26, fy - u * 0.50);
          g2.quadraticCurveTo(fx + s * u * 0.46, fy - u * 0.10, fx + s * u * 0.30, fy + u * 0.10);
          g2.quadraticCurveTo(fx + s * u * 0.30, fy - u * 0.20, fx + s * u * 0.24, fy - u * 0.42);
          g2.closePath(); g2.fill();
        }
      }

      g2.fillStyle = ink;
      const hy = fy - u * 0.74;
      if (rank === "K") {
        g2.beginPath();
        g2.moveTo(fx - u * 0.42, hy + u * 0.20);
        g2.lineTo(fx - u * 0.42, hy - u * 0.06);
        g2.lineTo(fx - u * 0.21, hy + u * 0.10);
        g2.lineTo(fx, hy - u * 0.26);
        g2.lineTo(fx + u * 0.21, hy + u * 0.10);
        g2.lineTo(fx + u * 0.42, hy - u * 0.06);
        g2.lineTo(fx + u * 0.42, hy + u * 0.20);
        g2.closePath(); g2.fill();
        g2.fillRect(fx - u * 0.05, hy - u * 0.54, u * 0.10, u * 0.26);
        g2.fillRect(fx - u * 0.17, hy - u * 0.45, u * 0.34, u * 0.09);
      } else if (rank === "Q") {
        g2.beginPath();
        g2.moveTo(fx - u * 0.40, hy + u * 0.20);
        g2.lineTo(fx - u * 0.34, hy - u * 0.10);
        g2.lineTo(fx - u * 0.12, hy + u * 0.06);
        g2.lineTo(fx, hy - u * 0.16);
        g2.lineTo(fx + u * 0.12, hy + u * 0.06);
        g2.lineTo(fx + u * 0.34, hy - u * 0.10);
        g2.lineTo(fx + u * 0.40, hy + u * 0.20);
        g2.closePath(); g2.fill();
        for (const px of [-0.34, 0, 0.34]) {
          g2.beginPath(); g2.arc(fx + u * px, hy - u * 0.16, u * 0.065, 0, TAU); g2.fill();
        }
      } else {
        g2.beginPath();
        g2.moveTo(fx - u * 0.38, hy + u * 0.20);
        g2.quadraticCurveTo(fx - u * 0.40, hy - u * 0.20, fx + u * 0.06, hy - u * 0.20);
        g2.quadraticCurveTo(fx + u * 0.40, hy - u * 0.18, fx + u * 0.38, hy + u * 0.20);
        g2.closePath(); g2.fill();
        g2.beginPath();
        g2.moveTo(fx + u * 0.22, hy - u * 0.14);
        g2.quadraticCurveTo(fx + u * 0.66, hy - u * 0.52, fx + u * 0.50, hy + u * 0.04);
        g2.quadraticCurveTo(fx + u * 0.40, hy - u * 0.12, fx + u * 0.22, hy - u * 0.14);
        g2.closePath(); g2.fill();
      }
      g2.restore();
    }

    /** Paint one card face at (0,0) into whatever context it is handed. */
    function paintCardFace(g2, rank, suitId, w, h) {
      const suit = SUITS.find((s) => s.id === suitId);
      const ink = suit.red ? CARD_THEME.red : CARD_THEME.black;
      const r = Math.min(w, h) * 0.085;

      roundRect(g2, 0.5, 0.5, w - 1, h - 1, r);
      const paper = g2.createLinearGradient(0, 0, w * 0.4, h);
      paper.addColorStop(0, "#ffffff");
      paper.addColorStop(0.55, CARD_THEME.face);
      paper.addColorStop(1, "#e9f0f0");
      g2.fillStyle = paper; g2.fill();
      g2.strokeStyle = CARD_THEME.edge; g2.lineWidth = Math.max(1, w * 0.008); g2.stroke();

      roundRect(g2, w * 0.035, h * 0.025, w * 0.93, h * 0.95, r * 0.72);
      g2.strokeStyle = "rgba(18,58,82,0.08)"; g2.lineWidth = Math.max(0.6, w * 0.006); g2.stroke();

      // Corner index, mirrored into the far corner so the card reads from
      // either end the way a real one does.
      const cs = w * 0.165;
      const corner = (flip) => {
        g2.save();
        if (flip) { g2.translate(w, h); g2.rotate(Math.PI); }
        g2.fillStyle = ink;
        g2.font = "800 " + cs + "px " + FONT;
        g2.textAlign = "center"; g2.textBaseline = "alphabetic";
        g2.fillText(rank, w * 0.145, h * 0.140);
        suitPath(g2, suitId, w * 0.145, h * 0.212, cs * 0.42);
        g2.restore();
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
          g2.save();
          g2.translate(cx + ux * px, cy + uy * py);
          if (uy > 0.05) g2.rotate(Math.PI);
          g2.fillStyle = ink;
          suitPath(g2, suitId, 0, 0, ps);
          g2.restore();
        }
      } else {
        drawCourt(g2, rank, suitId, ink, w, h);
      }
    }

    /**
     * Paint the card back at (0,0): fish scales under a foam frame.
     *
     * Overlapping arcs in rows is exactly how a scale pattern is built, and it
     * is the one motif that says "fish" without drawing one on every card.
     */
    function paintCardBack(g2, w, h, which) {
      const sk = BACKS[which] || BACKS[0];
      const r = Math.min(w, h) * 0.085;
      roundRect(g2, 0.5, 0.5, w - 1, h - 1, r);
      const base = g2.createLinearGradient(0, 0, w * 0.4, h);
      base.addColorStop(0, sk.a);
      base.addColorStop(1, sk.b);
      g2.fillStyle = base; g2.fill();

      g2.save();
      roundRect(g2, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g2.clip();

      const sc = w * 0.17;                       // scale radius
      for (let row = -1; row * sc * 0.62 < h + sc; row++) {
        const y = row * sc * 0.62;
        const off = (row % 2) ? sc * 0.5 : 0;
        for (let cxp = -sc; cxp < w + sc; cxp += sc) {
          g2.beginPath();
          g2.arc(cxp + off, y, sc * 0.52, Math.PI * 0.06, Math.PI * 0.94);
          g2.strokeStyle = "rgba(255,255,255,0.16)";
          g2.lineWidth = Math.max(0.8, w * 0.011);
          g2.stroke();
          g2.beginPath();
          g2.arc(cxp + off, y - w * 0.010, sc * 0.52, Math.PI * 0.10, Math.PI * 0.90);
          g2.strokeStyle = "rgba(0,20,34,0.14)";
          g2.lineWidth = Math.max(0.7, w * 0.008);
          g2.stroke();
        }
      }

      // A medallion with one fish in it, which is what stops the scales from
      // reading as wallpaper.
      g2.translate(w / 2, h / 2);
      g2.beginPath();
      g2.arc(0, 0, w * 0.235, 0, TAU);
      g2.fillStyle = "rgba(2,24,40,0.28)"; g2.fill();
      g2.strokeStyle = "rgba(242,253,255,0.55)"; g2.lineWidth = Math.max(1, w * 0.014); g2.stroke();
      g2.fillStyle = "rgba(242,253,255,0.80)";
      drawFish(g2, 0, 0, w * 0.155, "rgba(242,253,255,0.86)", 1, 0, true);
      g2.restore();

      roundRect(g2, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g2.strokeStyle = "rgba(242,253,255,0.42)"; g2.lineWidth = Math.max(1, w * 0.016); g2.stroke();
      roundRect(g2, 0.5, 0.5, w - 1, h - 1, r);
      g2.strokeStyle = "rgba(0,20,34,0.30)"; g2.lineWidth = Math.max(1, w * 0.008); g2.stroke();
    }

    /* ===============================================================
     * FISH — one path, used for the background swimmers, the seat
     * markers, the card back medallion and the go-fish beat.
     * ============================================================= */
    function drawFish(g2, x, y, s, col, dir, wag, flat) {
      g2.save();
      g2.translate(x, y);
      g2.scale(dir < 0 ? -1 : 1, 1);
      const tw = Math.sin(wag) * s * 0.12;

      // Tail, behind the body.
      g2.beginPath();
      g2.moveTo(-0.50 * s, 0);
      g2.lineTo(-1.02 * s + tw, -0.44 * s);
      g2.quadraticCurveTo(-0.82 * s, 0, -1.02 * s + tw, 0.44 * s);
      g2.closePath();
      g2.fillStyle = col; g2.fill();

      // Dorsal and pectoral fins.
      g2.beginPath();
      g2.moveTo(0.30 * s, -0.30 * s);
      g2.quadraticCurveTo(0.00 * s, -0.72 * s, -0.34 * s, -0.28 * s);
      g2.closePath();
      g2.fill();
      g2.beginPath();
      g2.moveTo(0.30 * s, 0.14 * s);
      g2.quadraticCurveTo(0.06 * s, 0.54 * s, -0.10 * s, 0.20 * s);
      g2.closePath();
      g2.fill();

      // Body.
      g2.beginPath();
      g2.moveTo(1.02 * s, 0);
      g2.bezierCurveTo(0.62 * s, -0.46 * s, -0.10 * s, -0.44 * s, -0.56 * s, -0.20 * s);
      g2.bezierCurveTo(-0.76 * s, -0.10 * s, -0.76 * s, 0.10 * s, -0.56 * s, 0.20 * s);
      g2.bezierCurveTo(-0.10 * s, 0.44 * s, 0.62 * s, 0.46 * s, 1.02 * s, 0);
      g2.closePath();
      g2.fill();

      if (!flat) {
        // Belly light and a gill line: two marks, and the silhouette becomes
        // an animal.
        g2.save();
        g2.clip();
        g2.fillStyle = "rgba(255,255,255,0.26)";
        g2.beginPath();
        g2.ellipse(0.16 * s, 0.20 * s, 0.62 * s, 0.20 * s, 0, 0, TAU);
        g2.fill();
        g2.fillStyle = "rgba(0,24,42,0.16)";
        g2.beginPath();
        g2.ellipse(0.10 * s, -0.30 * s, 0.66 * s, 0.16 * s, 0, 0, TAU);
        g2.fill();
        g2.restore();
        g2.strokeStyle = "rgba(0,24,42,0.20)";
        g2.lineWidth = Math.max(0.8, s * 0.045);
        g2.beginPath();
        g2.moveTo(0.34 * s, -0.28 * s);
        g2.quadraticCurveTo(0.22 * s, 0, 0.34 * s, 0.26 * s);
        g2.stroke();
      }

      // Eye.
      g2.fillStyle = flat ? "rgba(4,32,47,0.85)" : "#ffffff";
      g2.beginPath(); g2.arc(0.60 * s, -0.10 * s, 0.115 * s, 0, TAU); g2.fill();
      if (!flat) {
        g2.fillStyle = NIGHT;
        g2.beginPath(); g2.arc(0.63 * s, -0.10 * s, 0.058 * s, 0, TAU); g2.fill();
        g2.fillStyle = "rgba(255,255,255,0.9)";
        g2.beginPath(); g2.arc(0.60 * s, -0.13 * s, 0.022 * s, 0, TAU); g2.fill();
      }
      g2.restore();
    }

    /** Bake all 52 faces plus the back once, then blit for the rest of the run. */
    let art = null;
    function makeDeckArt(w, h, scale) {
      const faces = {};
      for (const s of SUITS) {
        for (const r of RANKS) {
          const surf = surface(w * scale, h * scale);
          if (!surf) return null;
          const g2 = surfCtx(surf);
          g2.scale(scale, scale);
          paintCardFace(g2, r, s.id, w, h);
          faces[r + s.id] = surf;
        }
      }
      return { faces, back: bakeBack(w, h, scale) };
    }
    function bakeBack(w, h, scale) {
      const bs = surface(w * scale, h * scale);
      if (!bs) return null;
      const bg2 = surfCtx(bs);
      bg2.scale(scale, scale);
      paintCardBack(bg2, w, h, settings.back);
      return bs;
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

    /* ===============================================================
     * CANVAS + LAYOUT
     * ============================================================= */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const dpr = Math.min(ctx.dpr || 1, 2);
    let W = ctx.width, H = ctx.height;

    const CARD_W = 100, CARD_H = 140, CARD_R = 9, SHADOW_PAD = 22;
    art = makeDeckArt(CARD_W, CARD_H, dpr);

    /**
     * The card shadow, baked once.
     *
     * Live it is five stacked translucent fills per card; a book of four cards
     * plus a hand behind it is thirty anti-aliased fills a frame. Baked it is
     * one blit, and being one-off it can afford sixteen steps instead of five,
     * so the falloff is smoother than the live version ever was.
     */
    const shadowArt = (function () {
      const sw = CARD_W + SHADOW_PAD * 2, sh = CARD_H + SHADOW_PAD * 2;
      const s = surface(sw * dpr, sh * dpr);
      if (!s) return null;
      const c = surfCtx(s);
      c.scale(dpr, dpr);
      c.fillStyle = "#001622";
      for (let i = 20; i >= 1; i--) {
        const k = i / 20;                       // 1 is the outermost ring
        const sp = SHADOW_PAD * k;
        // Weighted so the outer rings are nearly nothing. A constant alpha
        // builds a flat plateau of shadow the full width of the pad, and at a
        // large card that plateau reads as a grey mount around the card.
        c.globalAlpha = 0.013 * (1 - k * 0.75);
        roundRect(c, SHADOW_PAD - sp, SHADOW_PAD - sp, CARD_W + sp * 2, CARD_H + sp * 2, CARD_R + sp * 0.7);
        c.fill();
      }
      return s;
    })();

    // Declared here rather than with the rest of the state, because layout()
    // runs immediately and reads the seat count out of it — a `let` further
    // down the file is still in its dead zone at that point.
    let players = [];            // { name, ink, dim, hand[], books[] }

    const L = {};
    function layout() {
      W = ctx.width; H = ctx.height;
      const st = ctx.safeArea.top, sb = ctx.safeArea.bottom;
      L.top = st;
      L.bot = H - sb;
      L.pad = 22;
      L.innerW = W - L.pad * 2;
      L.headY = st + 8;
      L.headH = 50;
      L.contentY = L.headY + L.headH + 12;

      // --- ask screen ---
      L.askBtnH = 62;
      L.askBtnY = L.bot - 14 - L.askBtnH;
      L.chipH = 78;
      L.chipY = L.askBtnY - 16 - L.chipH;
      L.chipLabelY = L.chipY - 14;
      L.handTop = L.contentY + 30;
      L.handBot = L.chipLabelY - 26;

      // --- beat screen ---
      //
      // Built bottom-up: the table strip is fixed to the bottom edge, the
      // ocean sits just above it, and the plaque takes whatever is left
      // between the upside-down repeat and the ocean. Four players is the
      // tight case — the strip is 40px taller and the plaque has to be
      // clamped rather than centred, or a book headline lands on the mirror.
      const n = Math.max(2, players.length || settings.players);
      L.stripRowH = n >= 4 ? 44 : 50;
      L.stripBot = L.bot - 12;
      L.stripTop = L.stripBot - (n * L.stripRowH + 38);
      L.oceanY = L.stripTop - 56;
      L.mirrorY = L.top + 84;
      // The plaque takes the band between the upside-down repeat and the
      // ocean, and shrinks to fit it. The beats are drawn against a nominal
      // 330px of height; clamping the position alone was not enough — on a
      // short phone with four players there is only 207px there, and a
      // "FISHED IT OUT" headline reached up through the mirror plate.
      L.plaqueTop = L.mirrorY + 34;
      L.plaqueBot = L.oceanY - 40;
      L.plaqueY = (L.plaqueTop + L.plaqueBot) / 2;
      L.plaqueScale = clamp((L.plaqueBot - L.plaqueTop) / 330, 0.60, 1);
    }
    layout();

    /* ===============================================================
     * WATER — baked once, blitted every frame.
     *
     * The gradient, the floor, the reef and the far weed are static and
     * cost one drawImage. The shafts, the fish, the bubbles and the near
     * weed move, so they are painted live over the top.
     * ============================================================= */
    // Declared above bakeWater(), which runs at boot and fills them in: a `let`
    // further down the file is still in its dead zone at that point.
    let mark = null, markW = 0, markH = 0, markBig = 0;

    function paintWater(c, rich) {
      const grad = c.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0.00, SEA_SKY);
      grad.addColorStop(0.13, SEA_HIGH);
      grad.addColorStop(0.44, SEA_MID);
      grad.addColorStop(0.80, SEA_DEEP);
      grad.addColorStop(1.00, SEA_ABYSS);
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);

      // Surface ripple: a band of bright lenses right at the top, which is
      // what tells the eye it is looking up through water rather than at a
      // blue wall.
      if (rich) {
        c.save();
        for (let i = 0; i < 46; i++) {
          const x = (i * 53.7) % W;
          const y = 3 + ((i * 31.3) % 46);
          const w = 26 + ((i * 17) % 60);
          c.globalAlpha = 0.12 * (1 - y / 52);
          c.fillStyle = FOAM;
          c.beginPath();
          c.ellipse(x, y, w * 0.5, 2.2, 0, 0, TAU);
          c.fill();
        }
        c.restore();
      }

      // God rays, baked in. They were live for a while — five full-height
      // wedges under a "lighter" composite — and on a software rasteriser that
      // single decision cost eighty milliseconds a frame, more than everything
      // else on the screen put together. Baked they are free, and the motion
      // that actually reads is carried by three narrow live ones on top.
      if (rich) {
        c.save();
        c.globalCompositeOperation = "lighter";
        for (let i = 0; i < 5; i++) {
          const x = (i + 0.5) / 5 * W + ((i * 37) % 23) - 11;
          const w = W * (0.11 + ((i * 29) % 11) / 100);
          const rg = c.createLinearGradient(0, 0, 0, H * 0.86);
          rg.addColorStop(0, "rgba(198,252,255,0.085)");
          rg.addColorStop(0.55, "rgba(140,232,255,0.038)");
          rg.addColorStop(1, "rgba(120,220,255,0)");
          c.fillStyle = rg;
          c.beginPath();
          c.moveTo(x - w * 0.22, 0);
          c.lineTo(x + w * 0.22, 0);
          c.lineTo(x + w * 0.85, H * 0.86);
          c.lineTo(x - w * 0.62, H * 0.86);
          c.closePath();
          c.fill();
        }
        c.restore();
      }

      // Depth vignette, so the sand and the reef sit in front of it
      // rather than under it. Painted last, the floor came out as mud — the
      // one warm thing on the screen was the first thing the vignette ate.
      const vig = c.createRadialGradient(W * 0.5, H * 0.40, Math.min(W, H) * 0.26,
                                         W * 0.5, H * 0.5, Math.max(W, H) * 0.80);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(1,14,26,0.48)");
      c.fillStyle = vig;
      c.fillRect(0, 0, W, H);

      // Reef silhouettes standing on the floor. They are behind the sand, so
      // they read as coral heads planted in it rather than stuck on top.
      const fy = H * 0.895;
      if (rich) {
        const REEF = ["#0f5f6b", "#134c6a", "#1c5f5a"];
        const FANS = ["rgba(255,138,104,0.34)", "rgba(255,196,120,0.28)", "rgba(198,146,255,0.26)"];
        c.save();
        for (let i = 0; i < 11; i++) {
          const x = (i * 47 + 17) % (W + 60) - 30;
          const hh = 30 + ((i * 37) % 56);
          c.fillStyle = REEF[i % REEF.length];
          c.beginPath();
          c.moveTo(x - hh * 0.62, fy + 30);
          c.quadraticCurveTo(x - hh * 0.30, fy + 26 - hh, x, fy + 24 - hh * 0.72);
          c.quadraticCurveTo(x + hh * 0.34, fy + 26 - hh * 1.08, x + hh * 0.66, fy + 30);
          c.closePath();
          c.fill();
          if (i % 3 === 0) {
            // A sea fan: five short splayed fronds sharing one stem, which is
            // the only place on the screen the palette is allowed to shout.
            // Long single strokes read as sticks pushed into the sand — the
            // spread and the shared root are what make it an animal.
            const col = FANS[((i / 3) | 0) % FANS.length];
            c.strokeStyle = col;
            c.lineCap = "round";
            const fh = hh * 0.62;
            for (let k = -2; k <= 2; k++) {
              c.lineWidth = 3.4 - Math.abs(k) * 0.5;
              c.beginPath();
              c.moveTo(x, fy + 28);
              c.quadraticCurveTo(x + k * 7, fy + 28 - fh * 0.55, x + k * 13, fy + 26 - fh);
              c.stroke();
            }
            c.strokeStyle = col;
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(x - 22, fy + 26 - fh * 0.62);
            c.quadraticCurveTo(x, fy + 20 - fh * 0.80, x + 22, fy + 26 - fh * 0.62);
            c.stroke();
          }
        }
        c.restore();
      }

      // Sand.
      c.save();
      c.beginPath();
      c.moveTo(0, H);
      c.lineTo(0, fy + 18);
      for (let x = 0; x <= W; x += 26) {
        c.quadraticCurveTo(x + 13, fy + 12 + Math.sin(x * 0.031) * 12, x + 26, fy + 18 + Math.sin(x * 0.017) * 9);
      }
      c.lineTo(W, H);
      c.closePath();
      const sandG = c.createLinearGradient(0, fy, 0, H);
      sandG.addColorStop(0, "rgba(246,226,176,0.92)");
      sandG.addColorStop(0.45, "rgba(208,178,132,0.80)");
      sandG.addColorStop(1, "rgba(120,102,86,0.72)");
      c.fillStyle = sandG;
      c.fill();
      if (rich) {
        // Grains, so the sand is a surface rather than a swatch.
        c.save();
        c.clip();
        for (let i = 0; i < 260; i++) {
          const x = Math.random() * W, y = fy + 6 + Math.random() * (H - fy);
          c.globalAlpha = 0.12 + Math.random() * 0.18;
          c.fillStyle = Math.random() < 0.5 ? "#fff4d8" : "#7d6a52";
          c.fillRect(x, y, 1.4, 1.4);
        }
        c.restore();
      }
      c.restore();

      // A warm bounce off the sand, which is what stops the bottom of the
      // screen from reading as a hole.
      const glow = c.createLinearGradient(0, fy - 90, 0, fy + 20);
      glow.addColorStop(0, "rgba(255,214,140,0)");
      glow.addColorStop(1, "rgba(255,214,140,0.16)");
      c.fillStyle = glow;
      c.fillRect(0, fy - 90, W, 112);
    }

    let water = null;
    function bakeWater() {
      bakeMark();
      const s = surface(W * dpr, H * dpr);
      if (!s) { water = null; return; }
      const c = surfCtx(s);
      c.scale(dpr, dpr);
      paintWater(c, true);
      water = s;
    }
    bakeWater();

    /* --- live water motion ---------------------------------------- */
    const shafts = [];
    for (let i = 0; i < 2; i++) {
      shafts.push({ x: 0.28 + i * 0.42, w: 0.35 + Math.random() * 0.6, sp: 0.05 + Math.random() * 0.07, ph: Math.random() * TAU });
    }
    /**
     * The live shimmer over the baked rays.
     *
     * Three narrow wedges rather than five wide ones, source-over rather than
     * "lighter", and only down as far as the light actually reaches. That is a
     * tenth of the blended area of the version this replaced, and the drift is
     * the only part of a god ray the eye tracks anyway.
     */
    function drawShafts(t) {
      const deep = H * 0.55;
      g.save();
      for (const s of shafts) {
        const x = (s.x + Math.sin(t * s.sp + s.ph) * 0.055) * W;
        const w = 34 + s.w * 90;
        const a = 0.050 + 0.030 * Math.sin(t * s.sp * 1.7 + s.ph);
        const grad = g.createLinearGradient(0, 0, 0, deep);
        grad.addColorStop(0, "rgba(206,253,255," + a.toFixed(3) + ")");
        grad.addColorStop(1, "rgba(150,236,255,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(x - w * 0.22, 0);
        g.lineTo(x + w * 0.22, 0);
        g.lineTo(x + w * 0.72, deep);
        g.lineTo(x - w * 0.52, deep);
        g.closePath();
        g.fill();
      }
      g.restore();
    }

    const swimmers = [];
    function seedSwimmers() {
      swimmers.length = 0;
      const pal = ["#ffd166", "#ff8a5c", "#7de3ff", "#c1f7d5", "#ffb0d0", "#a8e6ff"];
      for (let i = 0; i < 7; i++) {
        const depth = i < 2 ? 0 : i < 5 ? 1 : 2;            // 0 far, 2 near
        swimmers.push({
          // A ten-pixel fish in the distance does not need a clipped belly
          // highlight and a gill line; it needs to cost nothing.
          flat: depth < 2,
          x: Math.random(), y: 0.08 + Math.random() * 0.80,
          s: [7, 12, 19][depth] * (0.75 + Math.random() * 0.6),
          v: [0.012, 0.022, 0.036][depth] * (0.7 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),
          a: [0.20, 0.38, 0.62][depth],
          col: pal[i % pal.length],
          ph: Math.random() * TAU,
          bob: 0.010 + Math.random() * 0.020,
        });
      }
    }
    seedSwimmers();
    function stepSwimmers(dt) {
      for (const f of swimmers) {
        f.x += f.v * dt;
        if (f.x < -0.16) f.x = 1.16;
        if (f.x > 1.16) f.x = -0.16;
      }
    }
    function drawSwimmers(t) {
      for (const f of swimmers) {
        const y = (f.y + Math.sin(t * 0.9 + f.ph) * f.bob) * H;
        g.globalAlpha = f.a;
        drawFish(g, f.x * W, y, f.s, f.col, f.v > 0 ? 1 : -1, t * 7 + f.ph, f.flat);
      }
      g.globalAlpha = 1;
    }

    const bubbles = [];
    function seedBubbles() {
      bubbles.length = 0;
      for (let i = 0; i < 28; i++) {
        bubbles.push({
          x: Math.random(), y: Math.random(), r: 1.4 + Math.random() * 4.6,
          v: 0.035 + Math.random() * 0.075, ph: Math.random() * TAU,
          drift: 0.006 + Math.random() * 0.016,
        });
      }
    }
    seedBubbles();
    function stepBubbles(dt) {
      for (const b of bubbles) {
        b.y -= b.v * dt;
        if (b.y < -0.03) { b.y = 1.04; b.x = Math.random(); }
      }
    }
    /** One bubble, baked: forty-four of them live was ninety stroked arcs a frame. */
    const bubbleArt = (function () {
      const R = 16;
      const s = surface(R * 2 * dpr, R * 2 * dpr);
      if (!s) return null;
      const c = surfCtx(s);
      c.scale(dpr, dpr);
      c.translate(R, R);
      const r = R - 3;
      c.fillStyle = "rgba(242,253,255,0.20)";
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
      c.strokeStyle = "rgba(242,253,255,0.95)";
      c.lineWidth = 2.2;
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.beginPath(); c.arc(-r * 0.34, -r * 0.36, r * 0.28, 0, TAU); c.fill();
      return s;
    })();
    function drawBubbles(t) {
      g.save();
      g.globalAlpha = 0.34;
      for (const b of bubbles) {
        const x = (b.x + Math.sin(t * 1.4 + b.ph) * b.drift) * W;
        const y = b.y * H;
        const d = b.r * 2.4;
        if (bubbleArt) {
          g.drawImage(bubbleArt, x - d / 2, y - d / 2, d, d);
        } else {
          g.strokeStyle = FOAM;
          g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, b.r, 0, TAU); g.stroke();
        }
      }
      g.restore();
      g.globalAlpha = 1;
    }

    /**
     * The near weed, which sways: baking it would freeze the sway.
     *
     * Each frond is a filled shape that tapers to a point rather than a stroke
     * of constant width. A stroked line at this scale reads as a stick pushed
     * into the sand; the taper is the entire difference between that and a
     * plant.
     */
    function drawWeed(t) {
      const fy = H * 0.895 + 30;
      g.save();
      for (let i = 0; i < 9; i++) {
        const x = (i * 53 + 22) % W;
        const hh = 50 + ((i * 71) % 96);
        const sway = Math.sin(t * 0.8 + i * 1.3) * 16;
        const bw = 5 + (i % 3) * 2.2;
        g.fillStyle = i % 2 ? "rgba(11,84,72,0.62)" : "rgba(16,110,86,0.52)";
        g.beginPath();
        g.moveTo(x - bw, fy);
        g.quadraticCurveTo(x - bw * 0.5 + sway * 0.5, fy - hh * 0.55, x + sway, fy - hh);
        g.quadraticCurveTo(x + bw * 0.6 + sway * 0.5, fy - hh * 0.55, x + bw, fy);
        g.closePath();
        g.fill();
      }
      g.restore();
    }

    /* ===============================================================
     * PARTICLES
     * ============================================================= */
    const parts = [];
    for (let i = 0; i < 150; i++) parts.push({ life: 0 });
    let partI = 0;
    function spawnPart(x, y, o) {
      const p = parts[partI = (partI + 1) % parts.length];
      p.x = x; p.y = y;
      p.vx = o.vx; p.vy = o.vy;
      p.gr = o.gr === undefined ? -140 : o.gr;             // bubbles rise
      p.drag = o.drag === undefined ? 0.975 : o.drag;
      p.life = p.max = o.life;
      p.col = o.col; p.kind = o.kind || "bubble";
      p.size = o.size; p.rot = Math.random() * TAU; p.vr = (Math.random() - 0.5) * 12;
    }
    function burst(x, y, ink, n, power) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = power * (0.35 + Math.random());
        const shard = Math.random() < 0.35;
        spawnPart(x, y, {
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.2,
          life: 0.5 + Math.random() * 0.7,
          gr: shard ? 320 : -150,
          col: shard ? (Math.random() < 0.5 ? SUN : ink) : FOAM,
          kind: shard ? "shard" : "bubble",
          size: shard ? 4 + Math.random() * 6 : 1.8 + Math.random() * 4.2,
        });
      }
    }
    function fizz(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.0;
        spawnPart(x, y, {
          vx: Math.cos(a) * 40, vy: Math.sin(a) * 60, gr: -190, drag: 0.94,
          life: 0.4 + Math.random() * 0.45, col: FOAM, kind: "bubble",
          size: 1.4 + Math.random() * 3.4,
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
    function drawParts() {
      for (const p of parts) {
        if (p.life <= 0) continue;
        const t = p.life / p.max;
        g.save();
        g.globalAlpha = clamp(t * 1.25, 0, 1);
        g.translate(p.x, p.y);
        if (p.kind === "shard") {
          g.rotate(p.rot);
          g.fillStyle = p.col;
          roundRect(g, -p.size * 0.34, -p.size * 0.5, p.size * 0.68, p.size, 1.5);
          g.fill();
        } else {
          g.strokeStyle = p.col;
          g.lineWidth = 1.2;
          g.beginPath(); g.arc(0, 0, p.size * (0.45 + t * 0.7), 0, TAU); g.stroke();
          g.globalAlpha *= 0.4;
          g.fillStyle = p.col;
          g.beginPath(); g.arc(0, 0, p.size * (0.45 + t * 0.7), 0, TAU); g.fill();
        }
        g.restore();
      }
      g.globalAlpha = 1;
    }

    /* ===============================================================
     * CARD DRAWING
     * ============================================================= */
    function cardShadow(x, y, rot, scale, lift) {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      if (shadowArt) {
        const spread = 1 + lift * 1.7;
        const sw = (CARD_W + SHADOW_PAD * 2) * scale * spread;
        const sh = (CARD_H + SHADOW_PAD * 2) * scale * spread;
        g.globalAlpha = clamp(1 - lift * 0.85, 0.25, 1);
        g.drawImage(shadowArt, -sw / 2, -sh / 2 + (3 + lift * 12) * scale, sw, sh);
        g.globalAlpha = 1;
      } else {
        dropShadow(g, CARD_W * scale, CARD_H * scale, CARD_R * scale, lift);
      }
      g.restore();
    }

    function drawCardAt(x, y, rot, scale, card, faceUp, lift, shadow) {
      const w = CARD_W * scale, h = CARD_H * scale;
      if (shadow !== false) cardShadow(x, y, rot, scale, lift === undefined ? 0.05 : lift);
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
        else paintCardBack(g, CARD_W, CARD_H, settings.back);
        g.restore();
      }
      g.restore();
    }

    /** A stack of card backs, used for the ocean. */
    function drawStack(x, y, count, scale) {
      if (count <= 0) {
        g.save();
        g.globalAlpha = 0.32;
        roundRect(g, x - CARD_W * scale / 2, y - CARD_H * scale / 2, CARD_W * scale, CARD_H * scale, CARD_R * scale);
        g.strokeStyle = FOAM; g.lineWidth = 1.5;
        g.setLineDash([5, 5]); g.stroke(); g.setLineDash([]);
        g.restore();
        return;
      }
      const layers = Math.min(6, 1 + Math.round(count / 7));
      for (let i = layers; i >= 2; i--) {
        g.save();
        g.translate(x - i * 1.0, y - i * 1.6);
        g.rotate(-0.016 * i);
        roundRect(g, -CARD_W * scale / 2, -CARD_H * scale / 2, CARD_W * scale, CARD_H * scale, CARD_R * scale);
        g.fillStyle = BACKS[settings.back].b; g.fill();
        g.strokeStyle = "rgba(0,20,34,0.4)"; g.lineWidth = 1; g.stroke();
        g.restore();
      }
      drawCardAt(x - 1.0, y - 1.6, -0.016, scale, null, false, 0.05);
    }

    /* ===============================================================
     * IMMEDIATE-MODE UI
     *
     * The whole game surface is canvas, so buttons are rectangles that
     * register themselves as they are drawn and are hit-tested in
     * reverse on pointerdown. Whatever was painted last is on top, which
     * is exactly the answer a tap wants.
     * ============================================================= */
    let hot = [];
    const press = new Map();
    function pressOf(id) { return press.get(id) || 0; }
    function hitTest(x, y) {
      for (let i = hot.length - 1; i >= 0; i--) {
        const b = hot[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
      }
      return null;
    }
    function zone(id, x, y, w, h) { hot.push({ id, x, y, w, h }); }

    /**
     * The one button style in the bit: a rounded pill with a bright face and a
     * darker rim below it, so it reads as a physical thing to push. Pressing
     * sinks it into its own shadow rather than just tinting it.
     */
    function button(id, x, y, w, h, label, o) {
      o = o || {};
      const on = o.enabled !== false;
      // Registered whether or not it is enabled. A disabled button that is not
      // even a target swallows the tap into the background, and the player
      // gets no answer at all to "why did nothing happen?" — the handler
      // decides what a press means, not the hit test.
      zone(id, x, y, w, h);
      const pr = pressOf(id);
      const sink = pr * 4;
      const r = o.radius === undefined ? Math.min(h / 2, 22) : o.radius;

      g.save();
      if (on) {
        roundRect(g, x, y + 5, w, h, r);
        g.fillStyle = o.rim || "rgba(2,26,44,0.55)";
        g.fill();
      }
      roundRect(g, x, y + sink, w, h, r);
      if (!on) {
        g.fillStyle = "rgba(4,32,52,0.78)";
        g.fill();
        g.strokeStyle = "rgba(242,253,255,0.20)";
        g.lineWidth = 1.4;
        g.stroke();
      } else {
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, o.top || FOAM);
        grad.addColorStop(1, o.bottom || "#bfe9f5");
        g.fillStyle = grad;
        g.fill();
        g.strokeStyle = o.edge || "rgba(255,255,255,0.75)";
        g.lineWidth = 1.3;
        g.stroke();
        // A highlight along the top lip.
        g.save();
        roundRect(g, x, y + sink, w, h, r);
        g.clip();
        g.globalAlpha = 0.5;
        g.fillStyle = "rgba(255,255,255,0.75)";
        roundRect(g, x + 4, y + sink + 3, w - 8, h * 0.34, r * 0.7);
        g.fill();
        g.restore();
      }
      g.fillStyle = on ? (o.ink || NIGHT) : "rgba(242,253,255,0.42)";
      g.textAlign = "center"; g.textBaseline = "middle";
      const size = o.size || Math.min(19, h * 0.36);
      fitFont(g, label, w - 26, size, "800");
      if (o.track) {
        tracked(g, label, x + w / 2, y + sink + h / 2 + 0.5, o.track);
      } else {
        g.fillText(label, x + w / 2, y + sink + h / 2 + 0.5);
      }
      g.restore();
    }

    /** A translucent panel: the only container shape in the bit. */
    function panel(x, y, w, h, o) {
      o = o || {};
      g.save();
      roundRect(g, x, y, w, h, o.radius || 24);
      const grad = g.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, o.top || "rgba(6,54,84,0.72)");
      grad.addColorStop(1, o.bottom || "rgba(3,30,52,0.80)");
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = o.edge || "rgba(242,253,255,0.18)";
      g.lineWidth = o.line || 1.4;
      g.stroke();
      g.restore();
    }

    /**
     * A tracked small-caps label that shrinks to the width it is given.
     *
     * Letter-spacing is what makes a caption read as a caption, and it is also
     * what silently pushes it off both ends of a 390px screen: the spacing is
     * not part of measureText, so a label that "fits" is 40px too wide once it
     * is tracked. Measuring the tracked plan and scaling from that is the only
     * version that holds.
     */
    function label(text, x, y, o) {
      o = o || {};
      g.save();
      g.fillStyle = o.col || "rgba(242,253,255,0.55)";
      g.textAlign = "center"; g.textBaseline = "middle";
      let size = o.size || 11;
      let track = o.track === undefined ? 2.6 : o.track;
      const maxW = o.maxW || (W - 24);
      g.font = "700 " + size + "px " + FONT;
      const w = trackedW(g, text, track);
      if (w > maxW) {
        const k = maxW / w;
        size = Math.max(7, size * k);
        track = track * k;
        g.font = "700 " + size.toFixed(2) + "px " + FONT;
      }
      tracked(g, text, x, y, track);
      g.restore();
    }

    /* ===============================================================
     * STATE
     * ============================================================= */
    let phase = "menu";          // menu | deal | cover | ask | beat | over
    let ocean = [];
    let turn = 0;
    let selRank = null, selTarget = -1;
    let matchStart = 0, winner = null, topBooks = 0, asksMade = 0;
    let shake = 0, flashA = 0, flashInk = FOAM;
    const talk = [];             // public log: { asker, target, rank, got }

    let beats = [], beatI = -1, beatT = 0, beatDur = 0, beatsDone = null;
    let dealT = 0, dealPlan = [];
    let bookAnim = null;
    const flyers = [];

    function busy() {
      return phase === "deal" || phase === "beat" || flyers.length > 0 || !!bookAnim;
    }

    function handSize(n) { return n === 2 ? 7 : 5; }

    function makePlayers(n) {
      return FISH.slice(0, n).map((f) => ({
        name: f.name, ink: f.ink, dim: f.dim, hand: [], books: [], pulse: 0, shakeT: 0,
      }));
    }

    /** Group a hand by rank, in deck order — a hand you cannot read is a hand
     *  you misplay, and a child reads a sorted hand and nothing else. */
    function groupsOf(hand) {
      const by = new Map();
      for (const c of hand) {
        if (!by.has(c.rank)) by.set(c.rank, []);
        by.get(c.rank).push(c);
      }
      const out = [];
      for (const r of RANKS) if (by.has(r)) out.push({ rank: r, cards: by.get(r) });
      return out;
    }

    function targetsFor(i) {
      const out = [];
      for (let j = 0; j < players.length; j++) if (j !== i && players[j].hand.length) out.push(j);
      return out;
    }

    function newMatch() {
      layout();
      bakeWater();
      players = makePlayers(settings.players);
      layout();
      const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
      ocean = freshDeck(rng);
      turn = 0;
      selRank = null; selTarget = -1;
      winner = null; topBooks = 0; asksMade = 0;
      talk.length = 0;
      flyers.length = 0;
      bookAnim = null;
      beats = []; beatI = -1; beatsDone = null;
      for (const p of parts) p.life = 0;
      matchStart = performance.now();

      // The deal itself: cards leave the ocean immediately and the flight is
      // decoration, so a skipped animation can never lose a card.
      const per = handSize(players.length);
      dealPlan = [];
      for (let k = 0; k < per; k++) {
        for (let i = 0; i < players.length; i++) {
          const card = ocean.pop();
          players[i].hand.push(card);
          dealPlan.push({ to: i, card, at: (dealPlan.length) * 0.055 });
        }
      }
      dealT = 0;
      phase = "deal";
      sound.heat(0.3);
    }

    /* ===============================================================
     * FLYING CARDS
     * ============================================================= */
    function fly(o) {
      if (flyers.length > 26) flyers.shift();
      flyers.push(o);
    }
    function stepFlyers(now) {
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i];
        if (now - f.t0 >= f.dur + (f.delay || 0)) {
          if (f.onDone) f.onDone();
          flyers.splice(i, 1);
        }
      }
    }
    function drawFlyers(now) {
      for (const f of flyers) {
        const t = clamp((now - f.t0 - (f.delay || 0)) / f.dur, 0, 1);
        if (t <= 0) continue;
        const p = easeInOut(t);
        const x = lerp(f.x0, f.x1, p);
        const y = lerp(f.y0, f.y1, p) - Math.sin(Math.PI * p) * (f.arc === undefined ? 42 : f.arc);
        const s = lerp(f.s0 === undefined ? 1 : f.s0, f.s1 === undefined ? 1 : f.s1, p);
        const rot = lerp(f.r0 || 0, f.r1 || 0, p);
        let face = !!f.faceUp;
        let sx = 1;
        if (f.flip) {
          // Turn the card over through the middle of the flight: face down on
          // the way out, face up on the way in, squashed through zero width.
          const k = clamp((t - 0.25) / 0.5, 0, 1);
          face = k >= 0.5;
          sx = Math.max(0.03, Math.abs(Math.cos(k * Math.PI)));
        }
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.scale(sx, 1);
        drawCardAt(0, 0, 0, s, f.card, face, 0.28 + 0.42 * Math.sin(Math.PI * p));
        g.restore();
      }
    }

    /* ===============================================================
     * BEATS — the public board.
     *
     * Every beat commits its state change on entry and then animates, so
     * skipping the animation with a tap is always safe. `after` may
     * splice further beats in, which is how a book that completes in the
     * middle of an exchange gets its own moment.
     * ============================================================= */
    function runBeats(list, done) {
      beats = list;
      beatI = -1;
      beatsDone = done || null;
      phase = "beat";
      nextBeat();
    }
    function nextBeat() {
      if (beatI >= 0 && beats[beatI] && beats[beatI].after) beats[beatI].after();
      beatI++;
      if (beatI >= beats.length) {
        beats = []; beatI = -1;
        const fn = beatsDone; beatsDone = null;
        if (fn) fn();
        return;
      }
      beatT = 0;
      beatDur = beats[beatI].dur * pace();
      if (beats[beatI].enter) beats[beatI].enter();
    }
    function skipBeat() {
      if (beatI < 0 || beatT < 0.12) return;
      flyers.length = 0;
      if (bookAnim) { bookAnim = null; }
      nextBeat();
    }
    const beat = () => (beatI >= 0 ? beats[beatI] : null);

    /* ===============================================================
     * GAME LOGIC
     * ============================================================= */
    function findBook(p) {
      const gs = groupsOf(p.hand);
      for (const gr of gs) if (gr.cards.length >= 4) return gr.rank;
      return null;
    }
    /** Lift a completed book out of a hand. Returns the four cards. */
    function takeBook(p, rank) {
      const four = [];
      for (let i = p.hand.length - 1; i >= 0 && four.length < 4; i--) {
        if (p.hand[i].rank === rank) four.unshift(p.hand.splice(i, 1)[0]);
      }
      p.books.push({ rank, cards: four });
      topBooks = Math.max(topBooks, p.books.length);
      return four;
    }
    function bookBeat(pi, rank) {
      return {
        id: "book", dur: 1.9, data: { p: pi, rank },
        enter() {
          const p = players[pi];
          const cards = takeBook(p, rank);
          bookAnim = { pi, rank, cards, t0: performance.now(), dur: 1500 * pace() };
          sound.duck(0.55, 460);
          sound.sting("powerup");
          sound.haptic("heavy");
          p.pulse = 1;
          try {
            ctx.platform.milestone("book", { by: p.name, rank });
            ctx.platform.setScore(topBooks);
            ctx.platform.setProgress(1 - (ocean.length / 52));
          } catch (_) {}
        },
        after() {
          bookAnim = null;
          const again = findBook(players[pi]);
          if (again) beats.splice(beatI + 1, 0, bookBeat(pi, again));
        },
      };
    }
    function pushBooksAfter(pi) {
      const r = findBook(players[pi]);
      if (r) beats.splice(beatI + 1, 0, bookBeat(pi, r));
    }

    function drawFromOcean(pi) {
      if (!ocean.length) return null;
      const card = ocean.pop();
      players[pi].hand.push(card);
      return card;
    }

    /** Ocean stack position on the public board. */
    function oceanPos() { return { x: W * 0.5 - 36, y: L.oceanY }; }
    /** Where a player's row sits on the public board — also a flight target. */
    function stripPos(i) {
      const y = L.stripTop + 16 + i * L.stripRowH + L.stripRowH * 0.5;
      return { x: L.pad + 34, y };
    }

    function commitAsk() {
      if (selRank === null || selTarget < 0) return;
      const ai = turn, ti = selTarget, rank = selRank;
      const asker = players[ai], target = players[ti];
      const taken = target.hand.filter((c) => c.rank === rank);
      selRank = null; selTarget = -1;
      asksMade++;

      const list = [];
      list.push({
        id: "ask", dur: 1.65, data: { a: ai, t: ti, rank },
        enter() {
          sound.sting("tap");
          sound.haptic("medium");
          try { ctx.platform.interact({ type: "ask", by: asker.name, of: target.name, rank }); } catch (_) {}
        },
      });

      if (taken.length) {
        list.push({
          id: "give", dur: 1.85, data: { a: ai, t: ti, rank, n: taken.length },
          enter() {
            // State first, flight second.
            target.hand = target.hand.filter((c) => c.rank !== rank);
            for (const c of taken) asker.hand.push(c);
            talk.push({ asker: asker.name, target: target.name, rank, got: taken.length });
            const from = stripPos(ti), to = stripPos(ai);
            const now = performance.now();
            taken.forEach((c, k) => fly({
              card: c, faceUp: true, t0: now, delay: k * 90 * pace(), dur: 620 * pace(),
              x0: from.x, y0: from.y, x1: to.x, y1: to.y,
              s0: 0.34, s1: 0.34, r0: -0.2, r1: 0.2, arc: 70,
            }));
            asker.pulse = 1;
            sound.sting("coin");
            sound.haptic("success");
            fizz(to.x, to.y, 10);
          },
          after() { pushBooksAfter(ai); },
        });
        list.push({ id: "again", dur: 1.15, data: { a: ai }, enter() { sound.sting("tap"); } });
        // Back through beginTurn, not straight to the cover. Going again with
        // an empty hand is a real position — the four cards that completed the
        // book may have been the whole hand — and it has to draw, or pass if
        // the water has run out. Routing to showCover() put a player on the
        // ask screen with nothing to ask, which the play script caught.
        runBeats(list, () => beginTurn());
        return;
      }

      // Go fish.
      list.push({
        id: "fish", dur: 1.55, data: { a: ai, t: ti, rank },
        enter() {
          talk.push({ asker: asker.name, target: target.name, rank, got: 0 });
          target.shakeT = 1;
          shake = Math.max(shake, 0.5);
          sound.sting("fail");
          sound.haptic("warning");
        },
      });

      if (!ocean.length) {
        runBeats(list, () => advanceTurn());
        return;
      }

      const peek = ocean[ocean.length - 1];
      const got = peek.rank === rank;
      list.push({
        id: "draw", dur: 1.35, data: { a: ai, got },
        enter() {
          const card = drawFromOcean(ai);
          // Fishing out the very rank you asked for is public: you say so and
          // you go again. It belongs on the same line of the table log as the
          // ask that caused it.
          if (got && talk.length) talk[talk.length - 1].caught = true;
          const from = oceanPos(), to = stripPos(ai);
          fly({
            card, faceUp: got, flip: got, t0: performance.now(), dur: 660 * pace(),
            x0: from.x, y0: from.y, x1: to.x, y1: to.y,
            s0: 0.5, s1: 0.34, r0: 0.1, r1: -0.15, arc: 60,
          });
          sound.sting(got ? "success" : "tap");
          sound.haptic("light");
          fizz(from.x, from.y, 8);
        },
        after() { pushBooksAfter(ai); },
      });

      if (got) {
        list.push({
          id: "caught", dur: 1.75, data: { a: ai, rank },
          enter() {
            players[ai].pulse = 1;
            sound.sting("powerup");
            sound.haptic("success");
            burst(W * 0.5, L.plaqueY, players[ai].ink, 18, 220);
          },
        });
        list.push({ id: "again", dur: 1.15, data: { a: ai }, enter() { sound.sting("tap"); } });
        runBeats(list, () => beginTurn());
      } else {
        runBeats(list, () => advanceTurn());
      }
    }

    function overNow() {
      return ocean.length === 0 && players.filter((p) => p.hand.length > 0).length <= 1;
    }

    function advanceTurn() {
      if (overNow()) { endGame(); return; }
      let guard = 0;
      do {
        turn = (turn + 1) % players.length;
        guard++;
      } while (guard < players.length * 3 && players[turn].hand.length === 0 && ocean.length === 0);
      beginTurn();
    }

    function beginTurn() {
      if (overNow()) { endGame(); return; }
      const p = players[turn];
      if (p.hand.length === 0) {
        if (!ocean.length) { advanceTurn(); return; }
        runBeats([{
          id: "refill", dur: 1.6, data: { a: turn },
          enter() {
            const card = drawFromOcean(turn);
            const from = oceanPos(), to = stripPos(turn);
            fly({ card, faceUp: false, t0: performance.now(), dur: 640 * pace(),
                  x0: from.x, y0: from.y, x1: to.x, y1: to.y, s0: 0.5, s1: 0.34, arc: 60 });
            sound.sting("tap"); sound.haptic("light");
          },
          after() { pushBooksAfter(turn); },
        }], () => beginTurn2());
        return;
      }
      beginTurn2();
    }
    function beginTurn2() {
      if (overNow()) { endGame(); return; }
      if (!targetsFor(turn).length) {
        // Everybody else is empty-handed: there is nobody to ask, so the only
        // move left is to fish.
        if (!ocean.length) { advanceTurn(); return; }
        runBeats([{
          id: "nobody", dur: 1.7, data: { a: turn },
          enter() {
            const card = drawFromOcean(turn);
            const from = oceanPos(), to = stripPos(turn);
            fly({ card, faceUp: false, t0: performance.now(), dur: 640 * pace(),
                  x0: from.x, y0: from.y, x1: to.x, y1: to.y, s0: 0.5, s1: 0.34, arc: 60 });
            sound.sting("tap");
          },
          after() { pushBooksAfter(turn); },
        }], () => advanceTurn());
        return;
      }
      showCover();
    }

    function showCover() {
      if (overNow()) { endGame(); return; }
      selRank = null; selTarget = -1;
      phase = "cover";
      sound.heat(0.3 + 0.5 * (1 - ocean.length / 52));
    }

    async function endGame() {
      phase = "over";
      let best = -1;
      winner = null;
      let tie = false;
      for (const p of players) {
        if (p.books.length > best) { best = p.books.length; winner = p; tie = false; }
        else if (p.books.length === best) tie = true;
      }
      if (tie) winner = null;
      topBooks = Math.max(topBooks, best);

      sound.duck(0.55, 520);
      sound.sting(winner ? "win" : "lose");
      sound.haptic(winner ? "success" : "warning");
      if (winner) burst(W * 0.5, H * 0.34, winner.ink, 46, 340);
      flashA = 0.55; flashInk = winner ? winner.ink : FOAM;

      try {
        ctx.platform.setScore(best);
        ctx.platform.complete({
          winner: winner ? winner.name : "tie",
          books: players.map((p) => ({ name: p.name, books: p.books.length })),
          asks: asksMade,
          durationMs: Math.round(performance.now() - matchStart),
        });
      } catch (_) {}
      // The record belongs to the match, not to one of the people sharing the
      // phone: the biggest haul of books this table landed in one game.
      try {
        if (best > 0) await ctx.memory.record("most_books").submit(best, { label: best + (best === 1 ? " book" : " books") });
      } catch (_) { /* offline is fine; the game still finished */ }
    }

    /* ===============================================================
     * DRAWING — SHARED PIECES
     * ============================================================= */
    /** A player's marker: their fish, in their colour. */
    function seatFish(x, y, s, p, t, dir) {
      drawFish(g, x, y, s, p.ink, dir === undefined ? 1 : dir, t * 5);
    }

    /** A book, drawn as a small fan of its four cards with the rank over it. */
    function drawBook(x, y, book, scale, showRank) {
      for (let i = 0; i < book.cards.length; i++) {
        const a = (i - 1.5) * 0.16;
        drawCardAt(x + Math.sin(a) * 22 * scale * 2, y - Math.cos(a) * 6 * scale, a, scale,
          book.cards[i], true, 0.05, i === 0);
      }
      if (showRank) {
        g.save();
        g.fillStyle = SUN;
        g.font = "800 " + Math.round(13 * scale * 3.4) + "px " + FONT;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(book.rank, x, y + CARD_H * scale * 0.5 + 11);
        g.restore();
      }
    }

    /** A row of tiny book spines: how a player's score reads at a glance. */
    function drawBookSpines(x, y, p, w) {
      const n = p.books.length;
      if (!n) {
        g.save();
        g.globalAlpha = 0.30;
        g.strokeStyle = FOAM; g.lineWidth = 1.2;
        g.setLineDash([3, 4]);
        roundRect(g, x, y - 11, 22, 22, 5);
        g.stroke();
        g.setLineDash([]);
        g.restore();
        return;
      }
      const step = Math.min(20, (w - 26) / Math.max(1, n));
      for (let i = 0; i < n; i++) {
        const bx = x + i * step;
        g.save();
        g.translate(bx, y);
        g.rotate(-0.05 + i * 0.012);
        roundRect(g, 0, -13, 22, 26, 4);
        g.fillStyle = CARD_THEME.face;
        g.fill();
        g.strokeStyle = hexA(p.ink, 0.85);
        g.lineWidth = 1.4;
        g.stroke();
        g.fillStyle = NIGHT;
        g.font = "800 " + (p.books[i].rank === "10" ? 11 : 14) + "px " + FONT;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(p.books[i].rank, 11, 0.5);
        g.restore();
      }
    }

    /* ===============================================================
     * SCREEN — TITLE
     * ============================================================= */
    /** The wordmark, painted once into its own surface at layout time. */
    function bakeMark() {
      const probe = surface(8, 8);
      if (!probe) { mark = null; return; }
      const pc = surfCtx(probe);
      markBig = fitFont(pc, "GO FISH", W - 52, 90, "900");
      const tw = pc.measureText("GO FISH").width;
      markW = Math.ceil(tw + markBig * 0.42);
      markH = Math.ceil(markBig * 1.5);
      const s = surface(markW * dpr, markH * dpr);
      if (!s) { mark = null; return; }
      const c = surfCtx(s);
      c.scale(dpr, dpr);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "900 " + markBig + "px " + FONT;
      c.lineJoin = "round";
      // The outline is a stroke, not a shadow filter — writing g.filter is
      // rejected at upload because the property also accepts url(#…).
      c.strokeStyle = "rgba(2,22,38,0.5)";
      c.lineWidth = markBig * 0.17;
      c.strokeText("GO FISH", markW / 2, markH / 2);
      c.strokeStyle = "rgba(2,22,38,0.62)";
      c.lineWidth = markBig * 0.09;
      c.strokeText("GO FISH", markW / 2, markH / 2);
      const wm = c.createLinearGradient(0, markH / 2 - markBig * 0.6, 0, markH / 2 + markBig * 0.6);
      wm.addColorStop(0, "#ffffff");
      wm.addColorStop(0.40, SUN);
      wm.addColorStop(1, CORAL);
      c.fillStyle = wm;
      c.fillText("GO FISH", markW / 2, markH / 2);
      mark = s;
    }

    const FAN = ["7H", "7S", "7D", "7C"];
    function drawMenu(now) {
      const t = now / 1000;
      const cx = W / 2;
      const band = L.bot - L.top;
      const at = (k) => L.top + band * k;

      // A fan of four sevens: the book you are trying to land, held up. Only
      // the outermost card carries a shadow — four overlapping shadows stack
      // into one black cloud behind the fan, which is what it looked like.
      const fy = at(0.195);
      const rock = Math.sin(t * 0.7) * 0.035;
      for (let i = 0; i < FAN.length; i++) {
        const k = i - (FAN.length - 1) / 2;
        const a = k * 0.20 + rock;
        const card = { id: FAN[i], rank: FAN[i].slice(0, -1), suit: FAN[i].slice(-1) };
        drawCardAt(cx + Math.sin(a) * 250, fy - Math.cos(a) * 250 + 250 + Math.sin(t * 1.2 + i) * 4,
          a, 0.92, card, true, 0.06);
      }

      // Wordmark, baked. Fitted to the screen rather than to a guess — at 86px
      // "GO FISH" ran off both edges of a 390px phone — and blitted rather
      // than restroked, because two outline passes of 78px text with round
      // joins is one of the most expensive things a rasteriser can be handed.
      const ty = at(0.455);
      const big = markBig || 60;
      if (mark) {
        g.drawImage(mark, cx - markW / 2, ty - markH / 2, markW, markH);
      } else {
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = SUN;
        fitFont(g, "GO FISH", W - 52, 90, "900");
        g.fillText("GO FISH", cx, ty);
        g.restore();
      }

      label("PASS THE PHONE · LAND THE BOOKS", cx, ty + big * 0.60,
        { size: 12, track: 3.4, maxW: W - 56 });

      g.save();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = "rgba(242,253,255,0.62)";
      g.font = "500 14px " + FONT;
      g.fillText("Ask one player for a rank you are holding.", cx, ty + big * 0.60 + 34);
      g.fillText("Four of a kind is a book. Most books wins.", cx, ty + big * 0.60 + 56);
      g.restore();

      // Player count.
      const py = at(0.72);
      label("HOW MANY PLAYERS", cx, py - 26, { size: 11, col: "rgba(242,253,255,0.5)" });
      const bw = 74, gap = 12;
      const totalW = bw * 3 + gap * 2;
      for (let i = 0; i < 3; i++) {
        const n = i + 2;
        const on = settings.players === n;
        button("pl" + n, cx - totalW / 2 + i * (bw + gap), py, bw, 56, String(n), {
          top: on ? SUN : "rgba(8,60,92,0.66)",
          bottom: on ? "#f5b942" : "rgba(4,36,60,0.72)",
          ink: on ? NIGHT : "rgba(242,253,255,0.75)",
          edge: on ? "rgba(255,255,255,0.8)" : "rgba(242,253,255,0.22)",
          rim: on ? "rgba(140,74,10,0.5)" : "rgba(2,20,34,0.5)",
          size: 25,
        });
      }
      g.save();
      g.fillStyle = "rgba(242,253,255,0.5)";
      g.font = "600 12.5px " + FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(settings.players === 2 ? "seven cards each" : "five cards each", cx, py + 76);
      g.restore();

      // Deal.
      button("deal", L.pad + 20, L.bot - 108, L.innerW - 40, 68, "DEAL", {
        top: "#8df0c8", bottom: "#20b98a", ink: "#02261c",
        rim: "rgba(2,60,44,0.6)", edge: "rgba(255,255,255,0.7)", size: 23, track: 4,
      });
    }

    /* ===============================================================
     * SCREEN — THE COVER
     *
     * The load-bearing screen. Nothing secret is drawn while it is up,
     * because the hand is simply not painted in this phase — there is no
     * layer to see through and nothing to shoulder-surf.
     * ============================================================= */
    function drawCover(now) {
      const t = now / 1000;
      const p = players[turn];
      const cx = W / 2;

      // A deep scrim, so the water reads as far below the surface.
      g.fillStyle = "rgba(2,18,32,0.72)";
      g.fillRect(0, 0, W, H);

      label("PASS THE PHONE TO", cx, L.top + 62, { size: 12, track: 3.4 });

      // The player's fish, big and swimming on the spot, inside a lit ring.
      // A flat disc at 22% opacity read as a grey plate — the halo has to be
      // additive to look like light in water rather than paint on top of it.
      const fy = L.top + 178;
      g.save();
      g.globalCompositeOperation = "lighter";
      const halo = g.createRadialGradient(cx, fy, 4, cx, fy, 96 + Math.sin(t * 1.6) * 5);
      halo.addColorStop(0, hexA(p.ink, 0.34));
      halo.addColorStop(0.55, hexA(p.ink, 0.10));
      halo.addColorStop(1, hexA(p.ink, 0));
      g.fillStyle = halo;
      g.fillRect(cx - 120, fy - 120, 240, 240);
      g.restore();
      g.save();
      g.strokeStyle = hexA(p.ink, 0.45);
      g.lineWidth = 2;
      g.beginPath(); g.arc(cx, fy, 78, 0, TAU); g.stroke();
      g.strokeStyle = hexA(p.ink, 0.18);
      g.lineWidth = 1;
      g.beginPath(); g.arc(cx, fy, 88 + Math.sin(t * 1.6) * 3, 0, TAU); g.stroke();
      g.restore();
      seatFish(cx + Math.sin(t * 0.9) * 6, fy + Math.sin(t * 1.4) * 3, 58, p, t, 1);

      g.save();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = p.ink;
      fitFont(g, p.name.toLowerCase(), L.innerW - 20, 52, "900");
      g.fillText(p.name.toLowerCase(), cx, L.top + 296);
      g.restore();

      g.save();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = "rgba(242,253,255,0.62)";
      g.font = "600 15px " + FONT;
      g.fillText(p.hand.length + (p.hand.length === 1 ? " card in hand" : " cards in hand") +
        "  ·  " + p.books.length + (p.books.length === 1 ? " book" : " books"), cx, L.top + 332);
      g.restore();

      // What the table already heard.
      //
      // This is the information the game actually runs on, and it is the one
      // thing a player on a passed phone cannot get by looking up. The cover
      // is the natural moment to hand it back: they are holding the phone and
      // have nothing to do yet. The panel keeps its place whether or not there
      // is anything in it, so the screen does not reflow between turns.
      const rows = talk.slice(-3).reverse();
      const ty = L.top + 366;
      const rowsH = 34 + 3 * 30;
      panel(L.pad, ty, L.innerW, rowsH, { radius: 20 });
      label("WHAT THE TABLE HEARD", W / 2, ty + 20, { size: 10, track: 2.8, col: "rgba(242,253,255,0.42)" });
      g.save();
      g.textAlign = "left"; g.textBaseline = "middle";
      if (!rows.length) {
        g.textAlign = "center";
        g.fillStyle = "rgba(242,253,255,0.38)";
        g.font = "500 13.5px " + FONT;
        g.fillText("Nothing asked yet — you are first.", W / 2, ty + rowsH / 2 + 8);
      }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const y = ty + 50 + i * 30;
        let x = L.pad + 15;
        const put = (txt, col, weight) => {
          g.fillStyle = col;
          g.font = weight + " 13px " + FONT;
          g.fillText(txt, x, y);
          x += g.measureText(txt).width;
        };
        const fp = players.find((q) => q.name === r.asker);
        const tp = players.find((q) => q.name === r.target);
        put(r.asker, fp ? fp.ink : FOAM, "700");
        put(" asked ", "rgba(242,253,255,0.55)", "500");
        put(r.target, tp ? tp.ink : FOAM, "700");
        put(" for " + RANK_WORD[r.rank].toLowerCase(), "rgba(242,253,255,0.55)", "500");
        put(r.got ? "  got " + r.got : r.caught ? "  fished it out" : "  went fishing",
          r.got || r.caught ? "#7ff0c0" : CORAL, "700");
      }
      g.restore();

      // A face-down fan tucked behind the button: the cover should look like a
      // hand held against the chest, not like a dialog.
      const fanY = L.bot - 196;
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.14;
        drawCardAt(cx + Math.sin(a) * 190, fanY - Math.cos(a) * 190 + 190, a, 0.44, null, false, 0.08, i === 0);
      }

      button("reveal", L.pad + 14, L.bot - 142, L.innerW - 28, 66,
        "I'M " + p.name.toLowerCase() + " — SHOW MY HAND", {
          top: p.ink, bottom: p.dim, ink: "#0a1620",
          rim: "rgba(2,20,34,0.6)", edge: "rgba(255,255,255,0.6)", size: 17,
        });

      g.save();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = "rgba(242,253,255,0.42)";
      g.font = "500 13px " + FONT;
      g.fillText("Only you should see the next screen.", W / 2, L.bot - 54);
      g.fillText("It closes itself the moment you ask.", W / 2, L.bot - 34);
      g.restore();
    }

    /* ===============================================================
     * SCREEN — THE ASK
     * ============================================================= */
    let handCells = [];
    /**
     * Lay the hand out as one card per rank you hold.
     *
     * The column count follows the number of ranks rather than being fixed, so
     * a hand of four ranks gets two big columns instead of three columns with
     * a hole in the second row. Every row is then centred on its own, because
     * a last row of one card left-aligned under a full row reads as a bug.
     */
    function computeHand() {
      const p = players[turn];
      const gs = groupsOf(p.hand);
      const n = gs.length;
      const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 12 ? 4 : 5;
      const gap = cols <= 2 ? 16 : cols === 3 ? 13 : 10;
      let cw = (L.innerW - gap * (cols - 1)) / cols;
      let ch = cw * 1.40;
      const pill = 32;
      const rows = Math.ceil(n / cols);
      const availH = L.handBot - L.handTop;
      const need = rows * (ch + pill) + (rows - 1) * 12;
      let k = 1;
      if (need > availH) k = availH / need;
      // Never let one big group balloon past a comfortable card size.
      cw = Math.min(cw * k, 150);
      ch = cw * 1.40;
      const ph = Math.max(24, pill * k);
      const cellH = ch + ph;
      const totalH = rows * cellH + (rows - 1) * 12 * k;
      const y0 = L.handTop + Math.max(0, (availH - totalH) / 2);
      handCells = gs.map((gr, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const inRow = Math.min(cols, n - r * cols);
        const rowW = inRow * cw + (inRow - 1) * gap;
        return {
          rank: gr.rank, cards: gr.cards,
          x: (W - rowW) / 2 + c * (cw + gap), y: y0 + r * (cellH + 12 * k),
          w: cw, h: ch, ph,
        };
      });
    }

    function drawAsk(now) {
      const t = now / 1000;
      const p = players[turn];
      computeHand();

      // Header: who is holding the phone, what the ocean has left. The chrome
      // buttons live in the top-right corner, so the header stops short of it.
      g.save();
      g.textAlign = "left"; g.textBaseline = "middle";
      const hy = L.headY + L.headH / 2;
      seatFish(L.pad + 16, hy, 15, p, t, 1);
      g.fillStyle = p.ink;
      g.font = "800 20px " + FONT;
      g.fillText(p.name, L.pad + 36, hy - 8);
      g.fillStyle = "rgba(242,253,255,0.55)";
      g.font = "600 12px " + FONT;
      g.fillText(p.books.length + (p.books.length === 1 ? " book" : " books") +
        "  ·  ocean " + ocean.length, L.pad + 36, hy + 12);
      g.restore();

      label("TAP A RANK YOU ARE HOLDING", W / 2, L.contentY + 2, { size: 11 });

      // The hand.
      for (let i = 0; i < handCells.length; i++) {
        const c = handCells[i];
        const sel = c.rank === selRank;
        const lift = sel ? 10 : 0;
        const pr = pressOf("cell" + i);
        zone("cell" + i, c.x - 4, c.y - 4, c.w + 8, c.h + c.ph + 8);

        const sc = c.w / CARD_W;
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2 - lift + pr * 3;

        if (sel) {
          // A glow ring, built from concentric strokes: the canvas blur
          // filter is rejected at upload.
          g.save();
          for (let k2 = 4; k2 >= 1; k2--) {
            g.globalAlpha = 0.11 * (1 - k2 / 5.5) * (0.7 + 0.3 * Math.sin(t * 5));
            g.strokeStyle = p.ink;
            g.lineWidth = k2 * 7;
            roundRect(g, c.x - 3, c.y - 3 - lift, c.w + 6, c.h + 6, 14);
            g.stroke();
          }
          g.restore();
        }

        // The stack: the extra cards of this rank peek out behind the front
        // one, so a pair is visibly a pair before you read the count. Drawn
        // back to front, with the front card square on the cell centre — the
        // rank pill sits under that card, and any other order slid the two
        // apart as the group grew.
        const off = Math.min(7, c.w * 0.085);
        for (let b2 = c.cards.length - 1; b2 >= 0; b2--) {
          drawCardAt(cx + b2 * off, cy - b2 * off * 0.62, -b2 * 0.032, sc, c.cards[b2], true, 0.06);
        }

        // The rank pill. Go Fish is a game about ranks, so the rank is set in
        // type rather than left to be read off a corner index.
        const pw = Math.min(c.w, 82);
        const px = cx - pw / 2, py = c.y + c.h - lift + pr * 3 - 2;
        roundRect(g, px, py, pw, c.ph - 4, (c.ph - 4) / 2);
        g.fillStyle = sel ? p.ink : "rgba(3,32,52,0.86)";
        g.fill();
        g.strokeStyle = sel ? "rgba(255,255,255,0.8)" : hexA(p.ink, 0.45);
        g.lineWidth = 1.4;
        g.stroke();
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = sel ? "#0a1620" : FOAM;
        const rs = Math.round(Math.min(20, (c.ph - 4) * 0.62));
        g.font = "900 " + rs + "px " + FONT;
        const txt = c.rank + (c.cards.length > 1 ? "  ×" + c.cards.length : "");
        fitFont(g, txt, pw - 12, rs, "900");
        g.fillText(txt, cx, py + (c.ph - 4) / 2 + 0.5);
        g.restore();
      }

      // Who to ask.
      const targets = targetsFor(turn);
      label("ASK WHO?", W / 2, L.chipLabelY, { size: 11 });
      const n = targets.length;
      const gapC = 10;
      const cwC = (L.innerW - gapC * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const q = players[targets[i]];
        const sel = selTarget === targets[i];
        const x = L.pad + i * (cwC + gapC);
        const pr = pressOf("chip" + i);
        zone("chip" + i, x, L.chipY, cwC, L.chipH);

        const sink = pr * 3;
        const yy = L.chipY + sink;
        roundRect(g, x, yy + 4, cwC, L.chipH, 20);
        g.fillStyle = "rgba(2,26,44,0.5)"; g.fill();
        roundRect(g, x, yy, cwC, L.chipH, 20);
        if (sel) {
          const grad = g.createLinearGradient(0, yy, 0, yy + L.chipH);
          grad.addColorStop(0, q.ink);
          grad.addColorStop(1, q.dim);
          g.fillStyle = grad;
        } else {
          g.fillStyle = "rgba(7,58,88,0.62)";
        }
        g.fill();
        g.strokeStyle = sel ? "rgba(255,255,255,0.85)" : hexA(q.ink, 0.55);
        g.lineWidth = sel ? 2 : 1.4;
        g.stroke();

        const ccx = x + cwC / 2;
        // Dark on the filled chip: the fish drawn in the player's own colour
        // on a chip filled with that same colour disappears completely.
        drawFish(g, ccx, yy + 24, Math.min(16, cwC * 0.16), sel ? "#0b1a24" : q.ink, 1, (t + i) * 5);
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = sel ? "#0a1620" : q.ink;
        fitFont(g, q.name, cwC - 14, 16, "800");
        g.fillText(q.name, ccx, yy + 47);
        g.fillStyle = sel ? "rgba(10,22,32,0.72)" : "rgba(242,253,255,0.58)";
        const sub = q.hand.length + (q.hand.length === 1 ? " card" : " cards") +
          (q.books.length ? "  ·  " + q.books.length + (q.books.length === 1 ? " book" : " books") : "");
        fitFont(g, sub, cwC - 12, 11.5, "600");
        g.fillText(sub, ccx, yy + 64);
        g.restore();
      }

      // The ask itself. The disabled state still has to say what it is waiting
      // for, or a child taps it four times and decides the game is broken.
      const ready = selRank !== null && selTarget >= 0;
      const lbl = ready
        ? "ASK " + players[selTarget].name.toLowerCase() + " FOR " + RANK_WORD[selRank]
        : selRank === null ? "PICK A RANK" : "NOW PICK WHO TO ASK";
      button("ask", L.pad, L.askBtnY, L.innerW, L.askBtnH, lbl, {
        enabled: ready,
        top: SUN, bottom: "#f2a93c", ink: NIGHT,
        rim: "rgba(122,64,6,0.55)", edge: "rgba(255,255,255,0.8)", size: 18, track: 1.6,
      });
    }

    /* ===============================================================
     * SCREEN — THE PUBLIC BOARD
     * ============================================================= */
    /** One line, for the mirrored plate and the log. */
    function beatHeadline() {
      const b = beat();
      if (!b) return "";
      const d = b.data || {};
      const a = players[d.a], tg = players[d.t];
      switch (b.id) {
        case "ask": return a.name.toLowerCase() + " ASKS " + tg.name.toLowerCase() + " FOR " + RANK_WORD[d.rank];
        case "give": return tg.name.toLowerCase() + " HANDS OVER " + d.n + " " +
          (d.n === 1 ? RANK_ONE[d.rank] : RANK_WORD[d.rank]);
        case "fish": return tg.name.toLowerCase() + " SAYS GO FISH";
        case "draw": return a.name.toLowerCase() + " TAKES ONE FROM THE OCEAN";
        case "caught": return a.name.toLowerCase() + " FISHED IT OUT";
        case "book": return players[d.p].name.toLowerCase() + " LANDS A BOOK OF " + RANK_WORD[d.rank];
        case "again": return a.name.toLowerCase() + " GOES AGAIN";
        case "refill": return a.name.toLowerCase() + " IS OUT OF CARDS — DRAWS ONE";
        case "nobody": return "NOBODY LEFT TO ASK — " + a.name.toLowerCase() + " FISHES";
        default: return "";
      }
    }

    /** The big rank plate: a card blown up until the rank is the whole point. */
    function rankPlate(cx, cy, w, h, rank, ink) {
      g.save();
      g.translate(cx, cy);
      g.rotate(-0.025);
      cardShadow(0, 0, -0.025, w / CARD_W, 0.4);
      roundRect(g, -w / 2, -h / 2, w, h, w * 0.11);
      const grad = g.createLinearGradient(0, -h / 2, 0, h / 2);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, "#e2eff2");
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = hexA(ink, 0.65);
      g.lineWidth = 3;
      g.stroke();
      roundRect(g, -w / 2 + 8, -h / 2 + 8, w - 16, h - 16, w * 0.08);
      g.strokeStyle = "rgba(18,58,82,0.14)";
      g.lineWidth = 1.4;
      g.stroke();

      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = CARD_THEME.black;
      const rs = fitFont(g, rank, w * 0.74, h * 0.52, "900");
      g.fillText(rank, 0, -h * 0.10);

      const pipS = w * 0.062;
      const spread = w * 0.17;
      for (let i = 0; i < 4; i++) {
        const s = SUITS[i];
        g.fillStyle = s.red ? CARD_THEME.red : CARD_THEME.black;
        suitPath(g, s.id, (i - 1.5) * spread, h * 0.245, pipS);
      }
      g.restore();
      return rs;
    }

    function nameRow(cx, y, a, tg, arrowCol) {
      g.save();
      g.textAlign = "left"; g.textBaseline = "middle";
      g.font = "800 19px " + FONT;
      const w1 = g.measureText(a.name.toLowerCase()).width;
      const w2 = g.measureText(tg.name.toLowerCase()).width;
      const arrow = 44;
      const total = 22 + w1 + arrow + w2 + 22;
      let x = cx - total / 2;
      seatFish(x + 10, y, 12, a, performance.now() / 1000, 1);
      x += 22;
      g.fillStyle = a.ink;
      g.fillText(a.name.toLowerCase(), x, y);
      x += w1;
      g.fillStyle = arrowCol || "rgba(242,253,255,0.6)";
      g.textAlign = "center";
      g.font = "800 20px " + FONT;
      g.fillText("➜", x + arrow / 2, y - 1);
      x += arrow;
      g.textAlign = "left";
      g.font = "800 19px " + FONT;
      g.fillStyle = tg.ink;
      g.fillText(tg.name.toLowerCase(), x, y);
      x += w2;
      seatFish(x + 12, y, 12, tg, performance.now() / 1000, 1);
      g.restore();
    }

    function drawPublicStrip(now) {
      const t = now / 1000;
      panel(L.pad - 6, L.stripTop, L.innerW + 12, L.stripBot - L.stripTop, { radius: 22 });
      label("AT THE TABLE", W / 2, L.stripTop + 12, { size: 9.5, track: 2.6, col: "rgba(242,253,255,0.38)" });
      const rh = Math.min(40, L.stripRowH - 6);
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const pos = stripPos(i);
        const y = pos.y;
        const sh = p.shakeT > 0 ? (Math.random() - 0.5) * p.shakeT * 8 : 0;
        g.save();
        g.translate(sh, 0);
        if (i === turn) {
          roundRect(g, L.pad + 2, y - rh / 2, L.innerW - 4, rh, 14);
          g.fillStyle = hexA(p.ink, 0.12);
          g.fill();
          g.strokeStyle = hexA(p.ink, 0.42);
          g.lineWidth = 1.2;
          g.stroke();
        }
        if (p.pulse > 0) {
          g.save();
          g.globalAlpha = p.pulse * 0.5;
          roundRect(g, L.pad + 2, y - rh / 2, L.innerW - 4, rh, 14);
          g.fillStyle = p.ink;
          g.fill();
          g.restore();
        }
        seatFish(L.pad + 20, y, 13, p, t + i, 1);
        g.save();
        g.textAlign = "left"; g.textBaseline = "middle";
        g.fillStyle = p.ink;
        g.font = "800 14px " + FONT;
        g.fillText(p.name, L.pad + 38, y);
        g.fillStyle = "rgba(242,253,255,0.5)";
        g.font = "600 11.5px " + FONT;
        g.fillText(p.hand.length + (p.hand.length === 1 ? " card" : " cards"), L.pad + 38, y + 14);
        g.restore();
        drawBookSpines(L.pad + 118, y, p, L.innerW - 130);
        g.restore();
      }
    }

    function drawBeat(now) {
      const b = beat();
      if (!b) return;
      const d = b.data || {};
      const t = beatT / Math.max(0.001, beatDur);
      const inT = clamp(beatT / (0.22 * pace()), 0, 1);
      const pop = backOut(inT);
      const cx = W / 2;

      zone("skip", 0, 0, W, H);

      // A scrim under the board so a plaque never has to compete with a fish.
      g.fillStyle = "rgba(2,20,36,0.52)";
      g.fillRect(0, 0, W, H);

      // The upside-down repeat, for whoever is sitting opposite. A phone flat
      // on the table has two long edges and the game is only fair if both of
      // them can read what was just asked.
      const head = beatHeadline();
      if (head) {
        g.save();
        g.translate(cx, L.mirrorY);
        g.rotate(Math.PI);
        panel(-L.innerW / 2, -26, L.innerW, 52, { radius: 18, top: "rgba(4,44,70,0.7)", bottom: "rgba(2,26,44,0.78)" });
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "rgba(242,253,255,0.88)";
        const s = fitFont(g, head, L.innerW - 26, 15, "800");
        g.fillText(head, 0, 1);
        g.fillStyle = "rgba(242,253,255,0.34)";
        g.font = "700 8.5px " + FONT;
        tracked(g, "FOR THE FAR SIDE", 0, -18, 2);
        g.restore();
      }

      g.save();
      g.translate(cx, L.plaqueY);
      g.scale(pop * L.plaqueScale, pop * L.plaqueScale);
      g.translate(-cx, -L.plaqueY);

      const py = L.plaqueY;
      if (b.id === "ask") {
        nameRow(cx, py - 118, players[d.a], players[d.t]);
        label("ASKS FOR", cx, py - 88, { size: 11, track: 3.4 });
        rankPlate(cx, py + 4, 168, 214, d.rank, players[d.a].ink);
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = SUN;
        g.font = "900 26px " + FONT;
        fitFont(g, RANK_WORD[d.rank], L.innerW - 40, 26, "900");
        tracked(g, RANK_WORD[d.rank], cx, py + 140, 3);
        g.restore();
      } else if (b.id === "give") {
        label(players[d.t].name.toLowerCase() + " HANDS OVER", cx, py - 118, { size: 12, track: 3, col: players[d.t].ink });
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = FOAM;
        g.font = "900 96px " + FONT;
        g.fillText(String(d.n), cx, py - 26);
        g.fillStyle = SUN;
        const word = d.n === 1 ? RANK_ONE[d.rank] : RANK_WORD[d.rank];
        fitFont(g, word, L.innerW - 40, 30, "900");
        tracked(g, word, cx, py + 40, 3);
        g.fillStyle = players[d.a].ink;
        g.font = "800 17px " + FONT;
        g.fillText("to " + players[d.a].name, cx, py + 78);
        g.restore();
      } else if (b.id === "fish") {
        // The one moment in Go Fish everybody actually shouts.
        const wob = Math.sin(beatT * 9) * 0.05;
        g.save();
        g.translate(cx, py - 20);
        g.rotate(wob);
        g.textAlign = "center"; g.textBaseline = "middle";
        g.lineJoin = "round";
        const s = fitFont(g, "GO FISH!", W - 56, 66, "900");
        g.strokeStyle = "rgba(2,22,38,0.6)";
        g.lineWidth = 11;
        g.strokeText("GO FISH!", 0, 0);
        const grad = g.createLinearGradient(0, -s * 0.6, 0, s * 0.6);
        grad.addColorStop(0, "#fff2c8");
        grad.addColorStop(0.5, SUN);
        grad.addColorStop(1, CORAL);
        g.fillStyle = grad;
        g.fillText("GO FISH!", 0, 0);
        g.restore();
        drawFish(g, cx - 90 + Math.sin(beatT * 2.4) * 22, py + 76, 34, "#ffd166", 1, beatT * 9);
        drawFish(g, cx + 96 + Math.sin(beatT * 2.1 + 2) * 20, py + 106, 24, "#7de3ff", -1, beatT * 8);
        label(players[d.a].name.toLowerCase() + " HAS NO " + RANK_WORD[d.rank] + " FROM " + players[d.t].name.toLowerCase(),
          cx, py + 148, { size: 11, track: 2.2 });
      } else if (b.id === "draw" || b.id === "refill" || b.id === "nobody") {
        label(b.id === "refill" ? "HAND EMPTY" : b.id === "nobody" ? "NOBODY LEFT TO ASK" : "FROM THE OCEAN",
          cx, py - 96, { size: 11, track: 3.2 });
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = players[d.a].ink;
        const s = fitFont(g, players[d.a].name.toLowerCase() + " DRAWS", L.innerW - 30, 34, "900");
        g.fillText(players[d.a].name.toLowerCase() + " DRAWS", cx, py - 48);
        g.restore();
        seatFish(cx, py + 26, 40, players[d.a], now / 1000, 1);
      } else if (b.id === "caught") {
        label("STRAIGHT OUT OF THE WATER", cx, py - 130, { size: 11, track: 3 });
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "#8df0c8";
        fitFont(g, "FISHED IT OUT!", L.innerW - 30, 38, "900");
        g.fillText("FISHED IT OUT!", cx, py - 96);
        g.restore();
        rankPlate(cx, py + 20, 152, 194, d.rank, "#8df0c8");
        label(players[d.a].name.toLowerCase() + " GOES AGAIN", cx, py + 142, { size: 11.5, track: 3, col: players[d.a].ink });
      } else if (b.id === "book") {
        drawBookBeat(now, d);
      } else if (b.id === "again") {
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = players[d.a].ink;
        fitFont(g, players[d.a].name.toLowerCase(), L.innerW - 30, 46, "900");
        g.fillText(players[d.a].name.toLowerCase(), cx, py - 24);
        g.restore();
        label("GOES AGAIN", cx, py + 22, { size: 14, track: 5, col: FOAM });
        seatFish(cx, py + 78, 34, players[d.a], now / 1000, 1);
      }
      g.restore();

      // The ocean, always on the board: everybody can see how much water is
      // left, and it is where the drawn cards come from. The count sits
      // beside the stack rather than under it — under it, it collided with
      // whatever the strip put at the top of its panel.
      const op = oceanPos();
      drawStack(op.x, op.y, ocean.length, 0.46);
      g.save();
      g.textAlign = "left"; g.textBaseline = "middle";
      g.fillStyle = FOAM;
      g.font = "800 26px " + FONT;
      g.fillText(String(ocean.length), op.x + 34, op.y - 7);
      g.fillStyle = "rgba(242,253,255,0.40)";
      g.font = "700 9.5px " + FONT;
      const plan = trackPlan(g, "IN THE OCEAN", 2.2);
      tracked(g, "IN THE OCEAN", op.x + 34 + plan.total / 2, op.y + 14, 2.2);
      g.restore();

      drawPublicStrip(now);

      // Tap-to-continue, once the beat has been up long enough to read. It
      // lives inside the table panel because every other band of the screen
      // already belongs to something.
      if (beatT > 0.5 * pace()) {
        g.save();
        g.globalAlpha = 0.34 + 0.24 * Math.sin(now * 0.005);
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = FOAM;
        g.font = "700 9.5px " + FONT;
        tracked(g, "TAP TO CARRY ON", W / 2, L.stripBot - 13, 2.4);
        g.restore();
      }
    }

    /**
     * The book landing.
     *
     * Four cards leave the hand, spread into a fan in mid-water, turn face up
     * together and then slam down onto the shelf with a shockwave and a burst
     * of bubbles. It is the only thing in Go Fish worth celebrating, so it is
     * the only animation that gets the whole screen.
     */
    function drawBookBeat(now, d) {
      const p = players[d.p];
      const cx = W / 2, py = L.plaqueY;
      const anim = bookAnim;
      const t = anim ? clamp((now - anim.t0) / anim.dur, 0, 1) : 1;
      const cards = anim ? anim.cards : (p.books[p.books.length - 1] || { cards: [] }).cards;

      label(p.name.toLowerCase() + " LANDS A BOOK", cx, py - 150, { size: 12, track: 3.2, col: p.ink });

      // Phase 1: gather and rise. Phase 2: fan and flip. Phase 3: slam.
      const gather = clamp(t / 0.30, 0, 1);
      const fanT = clamp((t - 0.26) / 0.34, 0, 1);
      const slam = clamp((t - 0.66) / 0.34, 0, 1);

      const from = stripPos(d.p);
      const scale = lerp(0.34, 0.86, easeOut(gather)) * lerp(1, 0.92, slam);
      const cy = lerp(from.y, py + 6, easeOut(gather)) + easeIn(slam) * 26;

      if (slam > 0.02) {
        // Shockwave.
        const k = easeOut(slam);
        g.save();
        g.globalAlpha = (1 - k) * 0.75;
        g.strokeStyle = SUN;
        g.lineWidth = 3 + (1 - k) * 8;
        g.beginPath();
        g.ellipse(cx, cy + 40, 40 + k * 240, 12 + k * 66, 0, 0, TAU);
        g.stroke();
        g.globalAlpha = (1 - k) * 0.4;
        g.strokeStyle = FOAM;
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(cx, cy + 40, 20 + k * 300, 6 + k * 84, 0, 0, TAU);
        g.stroke();
        g.restore();
      }

      for (let i = 0; i < cards.length; i++) {
        const a = (i - 1.5) * 0.24 * fanT;
        const spread = (i - 1.5) * 42 * fanT * (scale / 0.86);
        const face = fanT > 0.5;
        const sx = fanT > 0.28 && fanT < 0.72 ? Math.max(0.05, Math.abs(Math.cos((fanT - 0.28) / 0.44 * Math.PI))) : 1;
        g.save();
        g.translate(cx + spread, cy - Math.abs(spread) * 0.10);
        g.rotate(a * 1.2);
        g.scale(sx, 1);
        drawCardAt(0, 0, 0, scale, cards[i], face, 0.45 * (1 - slam) + 0.05);
        g.restore();
      }

      if (t > 0.66) {
        g.save();
        g.textAlign = "center"; g.textBaseline = "middle";
        g.globalAlpha = clamp((t - 0.66) / 0.2, 0, 1);
        g.fillStyle = SUN;
        const s = fitFont(g, RANK_WORD[d.rank], L.innerW - 40, 34, "900");
        tracked(g, RANK_WORD[d.rank], cx, py + 128, 3.2);
        g.fillStyle = "rgba(242,253,255,0.62)";
        g.font = "700 12px " + FONT;
        g.fillText("book " + p.books.length, cx, py + 156);
        g.restore();
      }
    }

    /* ===============================================================
     * SCREEN — THE RESULT
     * ============================================================= */
    function drawOver(now) {
      const t = now / 1000;
      const cx = W / 2;
      const band = L.bot - L.top;
      const at = (k) => L.top + band * k;
      g.fillStyle = "rgba(2,18,32,0.74)";
      g.fillRect(0, 0, W, H);

      // The mirrored result, so the far side of the table is told the outcome
      // rather than shown a stray upside-down word. Held clear of the chrome
      // in the corner, which it used to sit underneath.
      g.save();
      g.translate(cx, at(0.051));
      g.rotate(Math.PI);
      panel(-L.innerW / 2, -30, L.innerW, 60, { radius: 18 });
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = winner ? winner.ink : FOAM;
      fitFont(g, winner ? winner.name.toLowerCase() + " WINS" : "DEAD HEAT", L.innerW - 30, 22, "900");
      g.fillText(winner ? winner.name.toLowerCase() + " WINS" : "DEAD HEAT", 0, -6);
      g.fillStyle = "rgba(242,253,255,0.6)";
      fitFont(g, players.map((p) => p.name + " " + p.books.length).join("   ·   "), L.innerW - 30, 11.5, "600");
      g.fillText(players.map((p) => p.name + " " + p.books.length).join("   ·   "), 0, 14);
      g.restore();

      label("THE OCEAN IS EMPTY", cx, at(0.168), { size: 11, track: 3.4 });

      g.save();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = winner ? winner.ink : FOAM;
      const title = winner ? winner.name.toLowerCase() + " WINS" : "DEAD HEAT";
      fitFont(g, title, L.innerW - 20, 46, "900");
      g.fillText(title, cx, at(0.223));
      g.fillStyle = "rgba(242,253,255,0.6)";
      g.font = "600 14px " + FONT;
      g.fillText(topBooks + (topBooks === 1 ? " book" : " books") + " · " + asksMade + " asks", cx, at(0.267));
      g.restore();

      if (winner) seatFish(cx + Math.sin(t) * 8, at(0.330), 34, winner, t, 1);

      // Everybody's reef, in the order they landed. The block is centred in
      // whatever is left between the winner and the buttons rather than
      // stacked from the top, which left a hand's-width of dead water under a
      // two-player result.
      const rowsTop = at(0.395), rowsBot = L.bot - 166;
      const rowH = Math.min(86, (rowsBot - rowsTop) / players.length);
      const y0 = rowsTop + Math.max(0, (rowsBot - rowsTop - rowH * players.length) / 2);
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const y = y0 + i * rowH;
        const h = rowH - 10;
        panel(L.pad - 4, y, L.innerW + 8, h, { radius: 16 });
        seatFish(L.pad + 18, y + h / 2, 13, p, t + i, 1);
        g.save();
        g.textAlign = "left"; g.textBaseline = "middle";
        g.fillStyle = p.ink;
        g.font = "800 16px " + FONT;
        g.fillText(p.name, L.pad + 38, y + h / 2 - 9);
        g.fillStyle = "rgba(242,253,255,0.52)";
        g.font = "600 11.5px " + FONT;
        g.fillText(p.books.length + (p.books.length === 1 ? " book" : " books"), L.pad + 38, y + h / 2 + 10);
        g.restore();
        drawBookSpines(L.pad + 116, y + h / 2, p, L.innerW - 126);
      }

      button("again", L.pad, L.bot - 148, L.innerW, 62, "DEAL AGAIN", {
        top: "#8df0c8", bottom: "#20b98a", ink: "#02261c",
        rim: "rgba(2,60,44,0.6)", edge: "rgba(255,255,255,0.7)", size: 19, track: 2.6,
      });
      button("tomenu", L.pad, L.bot - 76, L.innerW, 56, "CHANGE PLAYERS", {
        top: "rgba(12,74,110,0.8)", bottom: "rgba(5,42,68,0.86)", ink: FOAM,
        rim: "rgba(2,20,34,0.5)", edge: "rgba(242,253,255,0.3)", size: 16, track: 2.4,
      });
    }

    /* ===============================================================
     * FRAME
     * ============================================================= */
    function render(now) {
      hot = [];
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = now / 1000;

      if (water) g.drawImage(water, 0, 0, W, H);
      else paintWater(g, false);
      drawShafts(t);
      drawSwimmers(t);
      drawWeed(t);
      drawBubbles(t);

      g.save();
      if (shake > 0.01) {
        g.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
      }

      if (phase === "menu") drawMenu(now);
      else if (phase === "deal") drawDeal(now);
      else if (phase === "cover") drawCover(now);
      else if (phase === "ask") drawAsk(now);
      else if (phase === "beat") drawBeat(now);
      else if (phase === "over") drawOver(now);

      drawFlyers(now);
      drawParts();
      g.restore();

      if (flashA > 0.004) {
        g.globalAlpha = flashA * 0.24;
        g.fillStyle = flashInk;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    function drawDeal(now) {
      const cx = W / 2;
      label("DEALING", cx, L.top + 96, { size: 12, track: 4 });
      const op = { x: cx, y: H * 0.42 };
      const left = dealPlan.filter((d) => dealT < d.at + 0.45).length;
      drawStack(op.x, op.y, Math.max(1, ocean.length + left), 0.62);

      for (const d of dealPlan) {
        const k = clamp((dealT - d.at) / 0.45, 0, 1);
        if (k <= 0 || k >= 1) continue;
        const to = stripPos(d.to);
        const p = easeInOut(k);
        const x = lerp(op.x, to.x, p);
        const y = lerp(op.y, to.y, p) - Math.sin(Math.PI * p) * 54;
        drawCardAt(x, y, lerp(0.1, -0.2, p), lerp(0.62, 0.34, p), null, false, 0.4);
      }
      drawPublicStrip(now);
    }

    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 60) / 1000;
      const now = performance.now();

      shake *= Math.pow(0.0025, dt);
      flashA *= Math.pow(0.0012, dt);
      for (const p of players) {
        p.pulse = Math.max(0, p.pulse - dt * 2.2);
        p.shakeT = Math.max(0, p.shakeT - dt * 2.6);
      }
      for (const [k, v] of press) {
        const nv = v - dt * 5;
        if (nv <= 0) press.delete(k); else press.set(k, nv);
      }
      stepSwimmers(dt);
      stepBubbles(dt);
      stepParts(dt);
      stepFlyers(now);

      if (phase === "deal") {
        dealT += dt;
        const last = dealPlan.length ? dealPlan[dealPlan.length - 1].at + 0.5 : 0;
        if (dealT >= last + 0.25) {
          // Anything dealt as four of a kind is laid down before the first
          // turn, the way it is at a real table.
          for (let i = 0; i < players.length; i++) {
            let r;
            while ((r = findBook(players[i]))) {
              takeBook(players[i], r);
              players[i].pulse = 1;
              sound.sting("coin");
            }
          }
          try { ctx.platform.setScore(0); } catch (_) {}
          beginTurn();
        }
      } else if (phase === "beat") {
        beatT += dt;
        if (bookAnim && now - bookAnim.t0 > bookAnim.dur * 0.68 && !bookAnim.popped) {
          bookAnim.popped = true;
          const p = stripPos(bookAnim.pi);
          burst(W / 2, L.plaqueY + 46, players[bookAnim.pi].ink, 30, 300);
          fizz(W / 2, L.plaqueY + 40, 14);
          shake = Math.max(shake, 0.75);
          flashA = 0.4; flashInk = SUN;
          sound.haptic("heavy");
        }
        if (beatT >= beatDur) { flyers.length = 0; bookAnim = null; nextBeat(); }
      }

      render(now);
    });

    /* ===============================================================
     * OVERLAY
     *
     * Only the chrome and the two sheets. The root itself is
     * pointer-transparent: it is created after the canvas and sits on
     * top of it, and without this it silently swallows every tap meant
     * for the game — the bit boots, renders and animates perfectly
     * while ignoring the player.
     * ============================================================= */
    const SAFE_T = ctx.safeArea.top, SAFE_B = ctx.safeArea.bottom;
    const btn = "pointer-events:auto;width:38px;height:38px;border-radius:13px;border:none;" +
      "background:rgba(3,38,60,0.72);color:" + FOAM + ";font-size:16px;line-height:1;" +
      "font-family:inherit;padding:0;box-shadow:inset 0 0 0 1px rgba(242,253,255,0.22);";
    const bigBtn = (bg, fg, edge) => "width:100%;padding:15px;border:none;border-radius:16px;font-family:inherit;" +
      "font-size:16px;font-weight:800;background:" + bg + ";color:" + fg + ";margin-top:12px;" +
      "pointer-events:auto;" + (edge ? "box-shadow:inset 0 0 0 1px " + edge + ";" : "");
    const QUIET = "linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06))";
    const QUIET_EDGE = "rgba(242,253,255,0.35)";
    const sheetPanel = "max-width:326px;width:100%;background:linear-gradient(180deg,#0b4c72,#052236);" +
      "border-radius:24px;padding:22px;box-shadow:inset 0 0 0 1px rgba(242,253,255,0.20),0 20px 60px rgba(0,10,20,0.6);";
    const lbl = "font-size:11px;letter-spacing:0.24em;text-transform:lowercase;opacity:0.55;";
    // overflow-y:auto so a long sheet on a short phone scrolls rather than
    // centring itself off both ends, which puts its close button out of reach.
    const sheetCss = "position:absolute;inset:0;display:none;align-items:center;" +
      "align-items:safe center;justify-content:center;" +
      "background:rgba(2,16,30,0.92);z-index:70;padding:" + (SAFE_T + 14) + "px 24px " +
      (SAFE_B + 14) + "px;overflow-y:auto;pointer-events:auto;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:" + FOAM + ";pointer-events:none;text-transform:lowercase;";

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
      '<div style="position:absolute;right:10px;top:' + (SAFE_T + 10) + 'px;display:flex;' +
        'gap:7px;z-index:65;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btn + 'font-size:17px;">♪</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btn + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btn + '">?</button>' +
      '</div>' +

      '<div data-el="cogp" style="' + sheetCss + '">' +
        '<div style="' + sheetPanel + '">' +
          '<div style="font-size:20px;font-weight:800;margin-bottom:16px;">Settings</div>' +
          '<div style="' + lbl + '">Sound</div>' +
          '<div data-el="mutes" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + lbl + '">Players</div>' +
          '<div data-el="counts" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + lbl + '">Pace of the table</div>' +
          '<div data-el="paces" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + lbl + '">Card backs</div>' +
          '<div data-el="backs" style="display:flex;gap:8px;margin:9px 0 4px;"></div>' +
          '<div style="font-size:12px;opacity:0.5;margin-top:10px;line-height:1.5;">' +
            'Player count applies on the next deal. Pace sets how long each public ' +
            'announcement holds — you can always tap to move it along.</div>' +
          '<button data-el="cogp-close" style="' + bigBtn(QUIET, FOAM, QUIET_EDGE) + 'margin-top:16px;">Done</button>' +
        '</div>' +
      '</div>' +

      '<div data-el="helpp" style="' + sheetCss + '">' +
        '<div style="' + sheetPanel + '">' +
          '<div style="font-size:20px;font-weight:800;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:13.5px;line-height:1.66;opacity:0.88;padding-left:18px;margin:0;">' +
            '<li>Everyone gets a hand — <b>seven cards</b> with two players, five with three or four. The rest is the <b>ocean</b>.</li>' +
            '<li>The phone goes round. The cover names who should be holding it; tap it to see your hand.</li>' +
            '<li>On your turn, ask <b>one named player</b> for <b>one rank</b>.</li>' +
            '<li><b>You may only ask for a rank you are already holding.</b> This bit will only offer you the ranks in your own hand, so you cannot get it wrong.</li>' +
            '<li>If they have any, they hand over <b>all of them</b> and you go again.</li>' +
            '<li>If they have none they say <b>go fish</b> and you draw one card. Draw the very rank you asked for and you go again; otherwise the turn passes.</li>' +
            '<li>Four of a kind is a <b>book</b>. It is laid face up at once and it scores.</li>' +
            '<li>Every ask is printed on a big public board — <b>upside down as well</b>, so the far side of the table reads it too. Remembering those asks is the whole game.</li>' +
            '<li>Run out of cards with water left? You draw one at the start of your turn.</li>' +
            '<li>When the ocean is dry and the hands are gone, <b>most books wins</b>.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + bigBtn(QUIET, FOAM, QUIET_EDGE) + 'margin-top:16px;">Got it</button>' +
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

    /** A row of segmented pills — the only control the sheets need. */
    function pills(host, values, labels, get, set) {
      if (!host) return null;
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;padding:11px 0;border:none;border-radius:13px;' +
        'font-family:inherit;font-size:13.5px;font-weight:700;pointer-events:auto;">' + esc(labels[i]) + '</button>').join("");
      const paint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on
            ? "linear-gradient(180deg,#ffe089,#f0a93a)"
            : "linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.05))";
          b.style.color = on ? "#08202e" : "rgba(242,253,255,0.62)";
          b.style.boxShadow = on
            ? "inset 0 1px 0 rgba(255,255,255,0.6),0 2px 8px rgba(0,10,20,0.4)"
            : "inset 0 0 0 1px rgba(242,253,255,0.16)";
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
      pills(shell.el("mutes"), [0, 1], ["On", "Muted"],
        () => (sound.muted ? 1 : 0), (v) => { if ((v === 1) !== sound.muted) { sound.toggle(); paintMute(); } }),
      pills(shell.el("counts"), [2, 3, 4], ["2", "3", "4"],
        () => settings.players, (v) => { settings.players = v; if (phase === "menu") layout(); }),
      pills(shell.el("paces"), [0, 1, 2], ["Calm", "Brisk", "Snappy"],
        () => settings.pace, (v) => { settings.pace = v; }),
      pills(shell.el("backs"), [0, 1, 2], BACKS.map((b) => b.name),
        () => settings.back, (v) => { settings.back = v; if (art) art.back = bakeBack(CARD_W, CARD_H, dpr); }),
    ].filter(Boolean);

    /** One glyph, struck through when muted — an emoji speaker would drag a
     *  second colour palette into a very deliberate one. */
    function paintMute() {
      const b = shell.el("mute");
      b.style.textDecoration = sound.muted ? "line-through" : "none";
      b.style.opacity = sound.muted ? "0.45" : "1";
    }
    paintMute();

    let sheetOpen = false;
    function showSheet(name, open) {
      shell.el(name).style.display = open ? "flex" : "none";
      sheetOpen = open;
    }
    shell.tap(shell.el("mute"), () => { sound.toggle(); paintMute(); paintAllPills(); });
    shell.tap(shell.el("cog"), () => { showSheet("cogp", true); paintAllPills(); });
    shell.tap(shell.el("cogp-close"), () => { showSheet("cogp", false); });
    shell.tap(shell.el("help"), () => { showSheet("helpp", true); });
    shell.tap(shell.el("helpp-close"), () => { showSheet("helpp", false); });

    /* ===============================================================
     * INPUT
     *
     * Turn-based, so this only has to stop a second finger acting at the same
     * instant as the first — somebody leaning in over the holder's shoulder,
     * not a second player.
     *
     * That was originally a "one live pointer" latch, held from pointerdown
     * until the matching pointerup. It is the obvious design and it is a trap:
     * a pointerup can go missing — the OS takes the touch for a system
     * gesture, the app is backgrounded mid-tap, a capture is lost without a
     * cancel — and then the latch never opens again. The bit renders and
     * animates perfectly while ignoring every tap for the rest of the session,
     * and the player has no way to clear it.
     *
     * A time window cannot get stuck. Two contacts inside 140ms are one
     * person's second finger or a double tap and neither should act twice;
     * anything later is a new tap and is always accepted.
     * ============================================================= */
    let lastTapAt = -1e9;

    ctx.listen(canvas, "pointerdown", (e) => {
      if (sheetOpen) return;
      const now = performance.now();
      if (now - lastTapAt < 140) return;
      lastTapAt = now;
      const b = hitTest(e.offsetX, e.offsetY);
      if (b) {
        press.set(b.id, 1);
        dispatch(b.id, e.offsetX, e.offsetY);
      }
      e.preventDefault();
    }, { passive: false });

    async function dispatch(id, x, y) {
      if (id === "pl2" || id === "pl3" || id === "pl4") {
        settings.players = Number(id.slice(2));
        saveSettings();
        layout();
        paintAllPills();
        sound.sting("tap"); sound.haptic("light");
        return;
      }
      if (id === "deal") {
        try { ctx.platform.start({ players: settings.players }); } catch (_) {}
        await sound.unlock();
        sound.sting("coin"); sound.haptic("medium");
        newMatch();
        return;
      }
      if (id === "reveal") {
        phase = "ask";
        selRank = null;
        // Two-handed, there is exactly one player you could possibly ask, and
        // making somebody tap the only chip on the screen is a tax rather than
        // a decision. Pre-picked, the button reads "ASK SUNNY FOR …" the
        // moment a rank is chosen.
        const only = targetsFor(turn);
        selTarget = only.length === 1 ? only[0] : -1;
        sound.sting("tap"); sound.haptic("light");
        return;
      }
      if (id === "skip") { skipBeat(); return; }
      // Both pickers SET, they do not toggle.
      //
      // Toggling looks harmless and is a dead end. Two-handed, the only
      // opponent is pre-selected for you — and a toggling chip then lets you
      // switch that selection off, leaving a chip that looks unpicked, an ask
      // button that will not light, and no other player to choose instead. The
      // three-handed endgame reaches the same place the moment somebody runs
      // out of cards. Nothing is lost by making them set-only: the ask is a
      // separate, explicit button, so there is never anything to cancel.
      if (id.startsWith("cell")) {
        const c = handCells[Number(id.slice(4))];
        if (!c) return;
        const was = selRank;
        selRank = c.rank;
        sound.sting("tap"); sound.haptic("light");
        if (was !== selRank) fizz(c.x + c.w / 2, c.y + c.h / 2, 6);
        return;
      }
      if (id.startsWith("chip")) {
        const targets = targetsFor(turn);
        const ti = targets[Number(id.slice(4))];
        if (ti === undefined) return;
        selTarget = ti;
        sound.sting("tap"); sound.haptic("light");
        return;
      }
      if (id === "ask") {
        if (selRank === null || selTarget < 0) { sound.haptic("light"); return; }
        sound.haptic("medium");
        commitAsk();
        return;
      }
      if (id === "again") {
        sound.sting("tap");
        newMatch();
        try { ctx.platform.interact({ type: "replay" }); } catch (_) {}
        return;
      }
      if (id === "tomenu") {
        phase = "menu";
        players = [];
        layout();
        bakeWater();
        sound.sting("tap");
        return;
      }
    }

    /* ===============================================================
     * RESIZE — the water is measured from the container, so a rotation
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
      bakeWater();
    });

    /* ===============================================================
     * A read-only window on the game, so the local harness can play a
     * real hand and assert on what actually happened. It exposes
     * nothing the bit does not already draw on screen.
     * ============================================================= */
    window.__GOFISH__ = {
      get phase() { return phase; },
      get busy() { return busy(); },
      get ocean() { return ocean.length; },
      get turn() { return turn; },
      get turnName() { return players[turn] ? players[turn].name : null; },
      get hands() { return players.map((p) => p.hand.length); },
      get books() { return players.map((p) => p.books.length); },
      get bookRanks() { return players.map((p) => p.books.map((b) => b.rank)); },
      get names() { return players.map((p) => p.name); },
      get ranksInHand() { return players[turn] ? groupsOf(players[turn].hand).map((x) => x.rank) : []; },
      get targets() { return players.length ? targetsFor(turn) : []; },
      get selRank() { return selRank; },
      get selTarget() { return selTarget; },
      get talk() { return talk.slice(-8); },
      get winner() { return winner ? winner.name : null; },
      get topBooks() { return topBooks; },
      get asks() { return asksMade; },
      get baked() { return BAKED; },
      get beat() { return beat() ? beat().id : null; },
      /** How long the current public beat has been up, and whether a tap on it
       *  would advance it — a beat holds briefly so a stray double tap cannot
       *  skip two of them. */
      get beatT() { return beatI >= 0 ? beatT : 0; },
      get canSkip() { return beatI >= 0 && beatT >= 0.12; },
      /** Centre of a registered hot zone, so the harness taps what a thumb
       *  would rather than a coordinate somebody typed in. */
      zone(id) {
        for (const b of hot) if (b.id === id) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        return null;
      },
      get zones() { return hot.map((b) => b.id); },
      /** The whole deck, accounted for: nothing may go missing mid-game. */
      get census() {
        let n = ocean.length;
        for (const p of players) n += p.hand.length + p.books.length * 4;
        return n;
      },
    };
    ctx.onDestroy(() => { try { delete window.__GOFISH__; } catch (_) {} });

    // The water and the title are on screen before ready() is called, so the
    // host never shows a blank bit for a single frame.
    render(performance.now());
    ctx.markVisualReady("water drawn");
    ctx.platform.ready();
  },
};
