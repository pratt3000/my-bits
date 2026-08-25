/**
 * Crazy Eights — the wild-card matching game, for two to four people and one
 * phone that goes round the table.
 *
 * Every other card game in this repo is played with the phone flat and
 * everything public. This one is the opposite: a hand is worthless if the
 * person next to you can read it, so the phone is a physical object that gets
 * handed over, and the design is built around that handover rather than around
 * the cards.
 *
 * Three decisions carry the whole build.
 *
 * The cover is a TAP, not a hold. Hold-to-look is the usual privacy pattern
 * and it is wrong here: the screen behind the cover has to be tapped — you
 * pick a card out of a fan, and after an eight you name a suit — so holding
 * the cover open would take a third hand. Exposure is bounded by the player's
 * own commit instead. The cover lifts on a tap and closes itself the instant
 * they play, draw out, or pass, so the phone is never left sitting on
 * somebody's cards waiting for them to notice.
 *
 * Illegal cards are dimmed, not punished. A hand of seven with two legal cards
 * in it is a puzzle about which of the two to keep, not a memory test about
 * which of the seven is allowed — so the six you cannot play are darkened and
 * are not even hit-testable. A wrong tap is impossible rather than penalised.
 *
 * The fan is scrubbed, not clicked twice. Pressing lifts the card under the
 * finger, sliding re-picks whichever card is now under it, and lifting the
 * finger plays the one that is up. Sliding down off the bottom of the fan
 * cancels. That is one gesture for select-preview-commit, which matters when
 * every turn already costs a handover tap.
 *
 * Contract notes: packaged assets are disabled (maxAssets is 0), so all 52
 * faces, the card back, the felt weave and the whole table are painted into
 * OffscreenCanvases at boot and blitted — with a live-drawing fallback for
 * WebViews that have none. The overlay is one markup string on ctx.createRoot()
 * rather than document.createElement, the root is pointer-transparent so taps
 * reach the fan underneath, pointer maths uses offsetX/offsetY rather than
 * getBoundingClientRect, and every soft shadow is stacked translucent fills
 * rather than a canvas blur filter — all four are rejected at upload and none
 * of them is documented in sdk.md.
 */
window.plethoraBit = {
  meta: {
    title: "Crazy Eights",
    runtime: "plethora-bit@2",
    tags: ["cards", "multiplayer", "local-multiplayer", "party", "turn-based", "family"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const backOut = (t) => { const c = 1.70158; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

    /** Escape anything that could ever be player-authored before it meets innerHTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    /* ===============================================================
     * PALETTE
     *
     * A warm card table: cognac baize under a low brass lamp, walnut
     * rail, parchment cards. Snap's room is green and cold; this one is
     * deliberately the other end of the same building, because the game
     * is slow and social rather than a race.
     *
     * The card BACK is deep indigo rather than the usual burgundy: on a
     * warm brown cloth a red back is the same family as the felt and the
     * stock stops reading as a separate object.
     * ============================================================= */
    const FELT_LIT = "#a35d33", FELT_MID = "#5c2e19", FELT_DARK = "#130601";
    const RAIL = "#2b1610", BRASS = "#e8b95f", BRASS_DIM = "rgba(232,185,95,0.38)";
    const CREAM = "#f8efdb", INK_SOFT = "rgba(248,239,219,0.60)";
    const CARD_THEME = {
      face: "#f9f4e7", edge: "rgba(30,16,8,0.28)",
      red: "#c02231", black: "#1a1721", back: "#1e3157", backDark: "#101c34", backLit: "#2b4a7e",
    };
    /** Four people who all have to be legible on brown cloth at a glance. */
    const SEATS = [
      { name: "Saffron", ink: "#ffb03a" },
      { name: "Rose",    ink: "#ff6f91" },
      { name: "Cobalt",  ink: "#5cb0ff" },
      { name: "Jade",    ink: "#57d9a3" },
    ];
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const SERIF = "ui-serif,Georgia,'Times New Roman',serif";

    const SUITS = [
      { id: "S", red: false }, { id: "H", red: true },
      { id: "D", red: true },  { id: "C", red: false },
    ];
    const SUIT_NAME = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };
    const SUIT_GLYPH = { S: "♠", H: "♥", D: "♦", C: "♣" };
    const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const isRed = (id) => id === "H" || id === "D";

    /** 50 for an eight, 10 for a court, face value otherwise. Ace is one. */
    function penalty(card) {
      if (card.rank === "8") return 50;
      if (card.rank === "J" || card.rank === "Q" || card.rank === "K") return 10;
      if (card.rank === "A") return 1;
      return Number(card.rank);
    }

    /* ===============================================================
     * SETTINGS — remembered between sessions.
     * ============================================================= */
    const saved = (function () {
      try { return ctx.storage.get("crazy8") || {}; } catch (_) { return {}; }
    })();
    const TARGETS = [25, 50, 100, 200];
    const settings = {
      players: clamp(saved.players || 2, 2, 4),
      target: TARGETS.indexOf(saved.target) >= 0 ? saved.target : 100,
      drawRule: saved.drawRule === 1 ? 1 : 0,   // 0 draw until playable / 1 draw one then pass
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("crazy8", settings); } catch (_) {} }

    /* ===============================================================
     * SOUND — a warm, unhurried bed for a game with no clock, and a cue
     * on every moment that matters. All of it wrapped: audio is a nicety
     * and must never be able to break a hand of cards.
     * ============================================================= */
    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "cozy", volume: 0.26, tempo: 84, intensity: 0.22 });
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
     * willReadFrequently pins a bake surface to the CPU backend, which is what
     * a write-once blit source wants: a GPU-backed offscreen is read back over
     * the bus on every drawImage, and a fan of thirteen cards does thirteen of
     * those a frame.
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
     * resource. Stacked translucent fills give the same falloff.
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
     * Memoised: this runs on every plaque every frame and measureText is one
     * of the few canvas calls that is not cheap.
     */
    const trackCache = new Map();
    function trackPlan(g2, text, spacing) {
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
    function trackWidth(g2, text, spacing) { return trackPlan(g2, text, spacing).total; }
    /** Centred on x. */
    function tracked(g2, text, x, y, spacing) {
      return trackedL(g2, text, x - trackPlan(g2, text, spacing).total / 2, y, spacing);
    }
    /** Starting at x rather than centred on it. */
    function trackedL(g2, text, x, y, spacing) {
      const plan = trackPlan(g2, text, spacing);
      let cx = x;
      const align = g2.textAlign;
      g2.textAlign = "left";
      for (let i = 0; i < plan.chars.length; i++) { g2.fillText(plan.chars[i], cx, y); cx += plan.w[i] + spacing; }
      g2.textAlign = align;
      return plan.total;
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
     * geometry. Each face is baked once at device scale and then blitted,
     * which keeps a thirteen-card fan to thirteen drawImage calls.
     * ============================================================= */

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
      9: [[-0.5, -0.68], [0.5, -0.68], [-0.5, -0.23], [0.5, -0.23], [0, 0],
          [-0.5, 0.23], [0.5, 0.23], [-0.5, 0.68], [0.5, 0.68]],
      10: [[-0.5, -0.68], [0.5, -0.68], [0, -0.45], [-0.5, -0.23], [0.5, -0.23],
           [-0.5, 0.23], [0.5, 0.23], [0, 0.45], [-0.5, 0.68], [0.5, 0.68]],
    };

    /**
     * A court card.
     *
     * Real courts are mirrored half-portraits and a literal one turns to mud at
     * the ninety pixels a phone gives a card in a fan. This is a single flat
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

    /**
     * The eight.
     *
     * Eights are the only card in this game with a rule attached, so they do
     * not get the plain eight-pip panel every other number card gets: the pips
     * are laid out in a ring around a struck brass rosette, which is legible
     * as "special" from across a table and still reads as an eight because the
     * eight pips are all there and countable.
     */
    function drawEight(g, suitId, ink, w, h) {
      const cx = w * 0.5, cy = h * 0.5;
      const R = Math.min(w, h) * 0.255;

      // A pressed guilloché disc behind the ring.
      g.save();
      g.beginPath(); g.arc(cx, cy, R * 1.30, 0, TAU);
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.30);
      glow.addColorStop(0, "rgba(232,185,95,0.26)");
      glow.addColorStop(0.62, "rgba(232,185,95,0.10)");
      glow.addColorStop(1, "rgba(232,185,95,0)");
      g.fillStyle = glow; g.fill();
      g.beginPath(); g.arc(cx, cy, R * 0.98, 0, TAU);
      g.strokeStyle = "rgba(174,120,32,0.42)"; g.lineWidth = Math.max(0.7, w * 0.009); g.stroke();
      g.beginPath(); g.arc(cx, cy, R * 0.72, 0, TAU);
      g.strokeStyle = "rgba(174,120,32,0.28)"; g.lineWidth = Math.max(0.5, w * 0.006); g.stroke();
      g.restore();

      // Eight pips on the ring, each turned to face outward.
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * TAU;
        g.save();
        g.translate(cx + Math.cos(a) * R * 1.30, cy + Math.sin(a) * R * 1.30);
        g.rotate(a + Math.PI / 2);
        g.fillStyle = ink;
        suitPath(g, suitId, 0, 0, w * 0.072);
        g.restore();
      }

      // The rosette in the middle: a struck eight-point star in brass.
      g.save();
      g.translate(cx, cy);
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU - Math.PI / 2;
        const rr = i % 2 === 0 ? R * 0.60 : R * 0.27;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      const star = g.createLinearGradient(-R, -R, R, R);
      star.addColorStop(0, "#f2d089");
      star.addColorStop(0.5, "#d3a13f");
      star.addColorStop(1, "#a97722");
      g.fillStyle = star; g.fill();
      g.strokeStyle = "rgba(90,58,10,0.45)"; g.lineWidth = Math.max(0.6, w * 0.007); g.stroke();
      g.fillStyle = "#3a2708";
      g.font = "800 " + (w * 0.155).toFixed(1) + "px " + SERIF;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("8", 0, w * 0.008);
      g.restore();
    }

    /** Paint one card face at (0,0) into whatever context it is handed. */
    function paintCardFace(g, rank, suitId, w, h) {
      const ink = isRed(suitId) ? CARD_THEME.red : CARD_THEME.black;
      const r = Math.min(w, h) * 0.085;

      // Stock: warm paper, very slightly darker toward the edges so a flat
      // rectangle still reads as a physical card under a lamp.
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      const paper = g.createLinearGradient(0, 0, w * 0.55, h);
      paper.addColorStop(0, "#fffdf4");
      paper.addColorStop(0.42, CARD_THEME.face);
      paper.addColorStop(1, "#ece2cd");
      g.fillStyle = paper; g.fill();
      g.strokeStyle = CARD_THEME.edge; g.lineWidth = Math.max(1, w * 0.008); g.stroke();

      roundRect(g, w * 0.035, h * 0.025, w * 0.93, h * 0.95, r * 0.72);
      g.strokeStyle = "rgba(30,22,14,0.075)"; g.lineWidth = Math.max(0.6, w * 0.006); g.stroke();

      // Corner index, mirrored into the far corner so the card reads from
      // either end the way a real one does. In a fan only the top-left corner
      // is ever visible, so this is the character the player actually reads.
      const cs = w * 0.170;
      const corner = (flip) => {
        g.save();
        if (flip) { g.translate(w, h); g.rotate(Math.PI); }
        g.fillStyle = ink;
        g.font = "700 " + cs + "px " + SERIF;
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.fillText(rank, w * 0.140, h * 0.140);
        suitPath(g, suitId, w * 0.140, h * 0.213, cs * 0.30);
        g.restore();
      };
      corner(false); corner(true);

      const cx = w * 0.5, cy = h * 0.5;
      if (rank === "8") {
        drawEight(g, suitId, ink, w, h);
      } else if (PIPS[rank]) {
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

    /** Paint the card back at (0,0): indigo guilloché under a brass frame. */
    function paintCardBack(g, w, h) {
      const r = Math.min(w, h) * 0.085;
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      const base = g.createLinearGradient(0, 0, w, h);
      base.addColorStop(0, CARD_THEME.backLit);
      base.addColorStop(0.55, CARD_THEME.back);
      base.addColorStop(1, CARD_THEME.backDark);
      g.fillStyle = base; g.fill();

      g.save();
      roundRect(g, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g.clip();
      g.strokeStyle = "rgba(196,220,255,0.11)";
      g.lineWidth = Math.max(0.7, w * 0.011);
      const step = w * 0.115;
      for (let i = -h; i < w + h; i += step) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
        g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
      }
      // Centre medallion: a brass lozenge holding a single eight, which is
      // what stops the lattice from reading as wallpaper — and is the game's
      // own mark on the back of every card in the deck.
      g.translate(w / 2, h / 2);
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.beginPath();
      g.moveTo(0, -h * 0.21); g.lineTo(w * 0.21, 0); g.lineTo(0, h * 0.21); g.lineTo(-w * 0.21, 0);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(232,185,95,0.60)"; g.lineWidth = Math.max(1, w * 0.012); g.stroke();
      g.fillStyle = "rgba(232,185,95,0.80)";
      g.font = "800 " + (w * 0.26).toFixed(1) + "px " + SERIF;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("8", 0, h * 0.006);
      g.restore();

      roundRect(g, w * 0.055, h * 0.038, w * 0.89, h * 0.924, r * 0.68);
      g.strokeStyle = "rgba(240,214,160,0.44)"; g.lineWidth = Math.max(1, w * 0.016); g.stroke();
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      g.strokeStyle = "rgba(0,0,0,0.32)"; g.lineWidth = Math.max(1, w * 0.008); g.stroke();
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

    /* ===============================================================
     * CANVAS + LAYOUT
     *
     * Everything lives in horizontal bands. Nothing goes in the side
     * margins: a fan sized to a 390px screen leaves about seven pixels
     * either side, and a side-mounted control would sit on the outermost
     * card in the hand — which is exactly the card a right-handed thumb
     * reaches for first.
     * ============================================================= */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    const dpr = Math.min(ctx.dpr || 1, 2);
    let W = ctx.width, H = ctx.height;

    const CARD_W = 100, CARD_H = 140, CARD_R = 9, SHADOW_PAD = 22;
    const HAND_S = 0.66, TABLE_S = 0.92;
    // The widest the fan is allowed to open, and how far below the screen its
    // pivot sits. Together they decide where the outermost card lands: at 0.60
    // radians on a 455px radius the end cards clear the screen edge with room
    // for the corner a rotated card throws outward, which a flatter fan on a
    // longer radius does not.
    const FAN_ARC = 0.60, FAN_R = 455, FAN_STEP_MAX = 0.112;
    const art = makeDeckArt(CARD_W, CARD_H, dpr);

    /**
     * The card shadow, baked once. Live it is five stacked translucent fills
     * per card, and a thirteen-card fan is sixty-five anti-aliased fills a
     * frame. Baked it is one blit, and being one-off it can afford sixteen
     * steps instead of five, so the falloff is smoother than live ever was.
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
      L.headTop = st + 4;
      L.headH = 42;
      L.railTop = L.headTop + L.headH + 6;
      L.railH = 74;
      L.tableTop = L.railTop + L.railH + 4;

      const bottom = H - sb;
      L.fanY = bottom - 126;                    // centre of the middle card in the fan
      L.fanX = W / 2;
      L.fanR = FAN_R;
      L.promptY = L.fanY - 116;                 // centre of the prompt plaque
      L.promptW = Math.min(W - 44, 322);
      L.promptH = 50;

      L.tableBot = L.promptY - 30;
      L.tableY = (L.tableTop + L.tableBot) / 2 + 4;
      L.tableX = W / 2;
      L.discard = { x: W / 2 + 55, y: L.tableY };
      L.stock = { x: W / 2 - 55, y: L.tableY };
      L.ringR = Math.min(W * 0.44, (L.tableBot - L.tableTop) / 2 - 4, 150);

      // The pass control only exists when a player can neither play nor draw,
      // and it sits in the prompt band rather than under the fan — the fan is
      // where the thumb already is and a button there gets brushed.
      L.pass = { x: W / 2, y: L.promptY, w: 168, h: 44 };
    }
    layout();

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
        const v = 90 + Math.random() * 165;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      return s;
    }
    const WEAVE = weaveTile(), NOISE = noiseTile();

    function paintTable(c, rich) {
      const fx = L.tableX, fy = L.tableY;
      const pool = c.createRadialGradient(fx, fy - H * 0.04, 10, fx, fy, Math.max(W, H) * 0.78);
      pool.addColorStop(0.00, FELT_LIT);
      pool.addColorStop(0.26, "#8a4c28");
      pool.addColorStop(0.56, FELT_MID);
      pool.addColorStop(1.00, FELT_DARK);
      c.fillStyle = pool;
      c.fillRect(0, 0, W, H);

      if (rich && WEAVE) {
        c.save();
        c.globalAlpha = 0.26;
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
        // shadowed specks is what stops a gradient reading as plastic.
        c.save();
        for (let i = 0; i < 1500; i++) {
          const x = Math.random() * W, y = Math.random() * H;
          const lit = Math.random() < 0.5;
          c.globalAlpha = (lit ? 0.055 : 0.06) * (1 - Math.hypot(x - fx, y - fy) / Math.max(W, H));
          c.fillStyle = lit ? "#ffd9b4" : "#160600";
          c.fillRect(x, y, 1 + Math.random() * 1.6, 1);
        }
        c.restore();
      }

      // A printed layout circle, the way a real table has its markings pressed
      // into the baize rather than painted on top.
      c.save();
      c.translate(fx, fy);
      // Struck twice — a light stroke with a dark one just inside it, which is
      // what makes a line look pressed into cloth rather than drawn on it.
      c.strokeStyle = "rgba(0,0,0,0.16)";
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(0, 0, L.ringR - 1.5, 0, TAU); c.stroke();
      c.strokeStyle = "rgba(255,226,178,0.10)";
      c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, L.ringR, 0, TAU); c.stroke();
      c.strokeStyle = "rgba(255,226,178,0.055)";
      c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, L.ringR + 7, 0, TAU); c.stroke();
      // Four suit marks pressed into the cloth on the circle's diagonals.
      const marks = ["S", "H", "D", "C"];
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i / 4) * TAU;
        const mx = Math.cos(a) * (L.ringR - 22), my = Math.sin(a) * (L.ringR - 22);
        c.fillStyle = "rgba(0,0,0,0.17)";
        suitPath(c, marks[i], mx, my + 1, 13);
        c.fillStyle = "rgba(255,226,178,0.075)";
        suitPath(c, marks[i], mx, my, 13);
      }
      c.restore();

      // Lamp bloom. A stack of translucent discs bands visibly at this size,
      // so the falloff is a real radial gradient instead.
      c.save();
      c.globalCompositeOperation = "lighter";
      const bloom = c.createRadialGradient(fx, fy - H * 0.05, 0, fx, fy - H * 0.05, Math.max(W, H) * 0.58);
      bloom.addColorStop(0.00, "rgba(255,214,150,0.20)");
      bloom.addColorStop(0.32, "rgba(255,208,140,0.085)");
      bloom.addColorStop(0.70, "rgba(255,208,140,0.020)");
      bloom.addColorStop(1.00, "rgba(255,208,140,0)");
      c.fillStyle = bloom;
      c.fillRect(0, 0, W, H);
      c.restore();

      const vig = c.createRadialGradient(fx, fy, Math.min(W, H) * 0.22, fx, fy, Math.max(W, H) * 0.70);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(0.65, "rgba(6,2,0,0.30)");
      vig.addColorStop(1, "rgba(4,1,0,0.68)");
      c.fillStyle = vig;
      c.fillRect(0, 0, W, H);

      c.strokeStyle = RAIL;
      c.lineWidth = 18;
      c.strokeRect(-9, -9, W + 18, H + 18);
      c.lineWidth = 9;
      c.strokeStyle = "rgba(0,0,0,0.45)";
      c.strokeRect(-4.5, -4.5, W + 9, H + 9);
      roundRect(c, 10.5, 10.5, W - 21, H - 21, 16);
      c.strokeStyle = "rgba(232,185,95,0.15)";
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
    let phase = "menu";        // menu | deal | cover | play | suit | round | match
    let players = [];          // {name, ink, hand[], score, roundPts}
    let stock = [], discard = [];
    let turn = 0, roundNo = 0, starter = 0;
    let named = null;          // the suit an eight named, or null
    let revealed = false;      // is the holder's hand face up?
    let selected = -1;         // index into the holder's hand
    let activeId = null;       // the pointer currently scrubbing the fan
    let flyer = null;          // the single card in the air
    let drawQueue = 0;         // cards still to be drawn this action
    let passes = 0;            // consecutive players who could do nothing
    let roundWinner = -1, matchWinner = -1, lastClose = 0;
    let dealT = 0, waitT = 0, waitFn = null;
    let shake = 0, stockPulse = 0, discardPulse = 0;
    let banner = null;
    let flash = { a: 0, ink: "#fff" };
    let sheetOpen = false;
    let matchStart = 0, roundStart = 0;

    /** A one-shot delay driven by the frame clock, so a sheet pauses it too. */
    function after(sec, fn) { waitT = sec; waitFn = fn; }

    /** Everything that blocks input. Play scripts poll this, never a sleep. */
    function busy() {
      return !!flyer || waitT > 0 || drawQueue > 0 || phase === "deal";
    }

    function top() { return discard[discard.length - 1] || null; }
    function activeSuit() { return named || (top() ? top().suit : null); }

    function isLegal(card) {
      const t = top();
      if (!t) return true;
      if (card.rank === "8") return true;
      if (named) return card.suit === named;
      return card.suit === t.suit || card.rank === t.rank;
    }
    function legalIndices(hand) {
      const out = [];
      for (let i = 0; i < hand.length; i++) if (isLegal(hand[i])) out.push(i);
      return out;
    }
    function canDraw() { return stock.length > 0 || discard.length > 1; }

    /* ===============================================================
     * DEAL AND ROUNDS
     * ============================================================= */
    function newMatch() {
      layout(); bakeTable();
      players = SEATS.slice(0, settings.players).map((s) => ({
        name: s.name, ink: s.ink, hand: [], score: 0, roundPts: 0, pulse: 0,
      }));
      roundNo = 0; starter = 0;
      matchWinner = -1; lastClose = 0;
      matchStart = performance.now();
      newRound();
    }

    function newRound() {
      roundNo++;
      roundWinner = -1;
      passes = 0;
      named = null;
      selected = -1;
      revealed = false;
      flyer = null; drawQueue = 0;
      banner = null;
      for (const p of players) { p.hand = []; p.roundPts = 0; p.pulse = 0; }

      const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
      stock = freshDeck(rng);
      const per = players.length >= 4 ? 5 : 7;
      for (let k = 0; k < per; k++) for (const p of players) p.hand.push(stock.pop());
      for (const p of players) sortHand(p.hand);

      discard = [stock.pop()];
      // House rule, stated on the rules card: if the turn-up is an eight the
      // suit it shows stands, rather than the dealer naming one out of turn.
      named = discard[0].rank === "8" ? discard[0].suit : null;

      turn = starter % players.length;
      starter++;
      roundStart = performance.now();
      dealT = 0;
      phase = "deal";
      sound.heat(0.22);
      try { ctx.platform.setProgress(clamp(topScore() / settings.target, 0, 1)); } catch (_) {}
    }

    /** By suit, then by rank — a hand you cannot read is a hand you misplay. */
    function sortHand(hand) {
      const so = { S: 0, H: 1, C: 2, D: 3 };
      hand.sort((a, b) => (so[a.suit] - so[b.suit]) || (RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)));
    }

    function topScore() { return players.reduce((m, p) => Math.max(m, p.score), 0); }

    /* ===============================================================
     * TURNS
     * ============================================================= */
    function showCover() {
      revealed = false;
      selected = -1;
      activeId = null;
      phase = "cover";
      const p = players[turn];
      shell.el("cover-name").textContent = p.name;
      shell.el("cover-name").style.color = p.ink;
      shell.el("cover-btn").textContent = "I’m " + p.name + " — show my hand";
      shell.el("cover-btn").style.background = "linear-gradient(180deg," + hexA(p.ink, 1) + "," + hexA(p.ink, 0.72) + ")";
      shell.el("cover-count").textContent = p.hand.length + (p.hand.length === 1 ? " card" : " cards");
      shell.el("cover-count").style.color = p.ink;
      const t = top();
      shell.el("cover-need").innerHTML = t
        ? "On the pile: <b>" + esc(t.rank) + "</b>" +
          '<span style="color:' + (isRed(t.suit) ? "#ff8b92" : CREAM) + ';">' + SUIT_GLYPH[t.suit] + "</span>" +
          (named ? '  ·  eight live, follow <span style="color:' +
            (isRed(named) ? "#ff8b92" : CREAM) + ';">' + SUIT_GLYPH[named] + "</span>" : "")
        : "";
      shell.el("cover").style.display = "flex";
    }

    function reveal() {
      shell.el("cover").style.display = "none";
      revealed = true;
      phase = "play";
      sound.haptic("light");
      sound.sting("tap");
      const legal = legalIndices(players[turn].hand);
      if (!legal.length) { stockPulse = 1; sound.sting("fail"); }
      try { ctx.platform.interact({ type: "reveal", player: players[turn].name }); } catch (_) {}
    }

    function nextTurn() {
      turn = (turn + 1) % players.length;
      showCover();
    }

    /* ===============================================================
     * PLAYING A CARD
     *
     * The state commits immediately and the animation runs on top of it,
     * with input blocked by busy() until it lands. Anything else and a
     * second tap during the flight plays a card out of a hand that has
     * already changed size.
     * ============================================================= */
    function playCard(i) {
      const p = players[turn];
      const card = p.hand[i];
      if (!card || !isLegal(card)) return;

      const slot = fanSlot(i, p.hand.length);
      p.hand.splice(i, 1);
      selected = -1;
      passes = 0;

      const jitterA = (Math.random() - 0.5) * 0.30;
      const a = Math.random() * TAU, d = 5 + Math.random() * 7;
      discard.push(Object.assign({}, card, { rot: jitterA, ox: Math.cos(a) * d, oy: Math.sin(a) * d }));
      if (card.rank !== "8") named = null;

      flyer = {
        card, target: "discard", t0: performance.now(), dur: 300,
        x0: slot.x, y0: slot.y - 30, r0: slot.a, s0: HAND_S * 1.13,
        x1: L.discard.x + discard[discard.length - 1].ox,
        y1: L.discard.y + discard[discard.length - 1].oy,
        r1: jitterA, s1: TABLE_S,
        onDone: () => afterPlay(card, p),
      };
      sound.sting("tap");
      sound.haptic("medium");
      try { ctx.platform.interact({ type: "play", card: card.id, by: p.name }); } catch (_) {}
    }

    function afterPlay(card, p) {
      discardPulse = 1;
      shake = Math.max(shake, card.rank === "8" ? 0.5 : 0.22);
      burst(L.discard.x, L.discard.y, card.rank === "8" ? BRASS : hexA(p.ink, 1), card.rank === "8" ? 26 : 12,
        card.rank === "8" ? 300 : 190);
      sound.haptic("light");

      if (p.hand.length === 0) { after(0.42, () => endRound(players.indexOf(p))); return; }

      if (p.hand.length === 1) {
        p.pulse = 1;
        say(p.name.toUpperCase() + " HAS ONE CARD", "one card left", p.ink, 1500);
        sound.sting("danger");
        sound.haptic("warning");
      }

      if (card.rank === "8") {
        // The suit picker stays on the player's own revealed screen, because
        // naming a suit is part of the same turn — sending the phone on and
        // asking the next player to name it would leak the eight's owner.
        phase = "suit";
        sound.sting("powerup");
        openSuitPicker();
        return;
      }
      after(0.30, nextTurn);
    }

    /* ---- naming a suit ------------------------------------------- */
    function openSuitPicker() {
      const p = players[turn];
      shell.el("suit-who").textContent = p.name;
      shell.el("suit-who").style.color = p.ink;
      shell.el("suitp").style.display = "flex";
    }
    function nameSuit(s) {
      named = s;
      shell.el("suitp").style.display = "none";
      phase = "play";
      flash.a = 0.5; flash.ink = isRed(s) ? "#ff6f7d" : "#ffe6bd";
      burst(L.discard.x, L.discard.y, isRed(s) ? "#ff6f7d" : CREAM, 22, 260);
      say(SUIT_NAME[s].toUpperCase(), "named by " + players[turn].name, isRed(s) ? "#ff8b92" : CREAM, 1250);
      sound.sting("coin");
      sound.haptic("success");
      try { ctx.platform.interact({ type: "name_suit", suit: s }); } catch (_) {}
      after(0.45, nextTurn);
    }

    /* ===============================================================
     * DRAWING
     *
     * Default rule is the strict one: keep drawing until something is
     * playable. The alternative — one card and your turn is over — is a
     * settings toggle rather than a house argument.
     * ============================================================= */
    function recycle() {
      if (stock.length || discard.length <= 1) return;
      const t = discard.pop();
      const rng = makeRng((Date.now() ^ (discard.length * 2654435761)) >>> 0);
      const pool = discard.map((c) => ({ rank: c.rank, suit: c.suit, red: c.red, id: c.id }));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      stock = pool;
      discard = [t];
      say("PILE RESHUFFLED", stock.length + " cards back in the deck", BRASS, 1300);
      sound.sting("coin");
    }

    function startDraw() {
      if (!canDraw()) return;
      // The strict rule has no card limit, so neither does this: the run stops
      // when something is playable or when there is genuinely nothing left to
      // draw. 52 is a guard against a logic error, not a house rule.
      drawQueue = settings.drawRule === 1 ? 1 : 52;
      stepDraw();
    }

    function stepDraw() {
      const p = players[turn];
      if (drawQueue <= 0) { finishDraw(); return; }
      if (!stock.length) recycle();
      if (!stock.length) { drawQueue = 0; finishDraw(); return; }

      const card = stock.pop();
      p.hand.push(card);                              // committed, then animated
      const idx = p.hand.length - 1;
      const slot = fanSlot(idx, p.hand.length);
      drawQueue--;
      // A run of draws is a cascade, not a queue of individual deals. At the
      // single-card pace a bad hand spent eight seconds watching cards fly
      // before its owner could do anything.
      const run = drawQueue > 0;
      flyer = {
        card, target: "hand", handIndex: idx, t0: performance.now(), dur: run ? 125 : 240,
        x0: L.stock.x, y0: L.stock.y, r0: -0.03, s0: TABLE_S,
        x1: slot.x, y1: slot.y, r1: slot.a, s1: HAND_S,
        faceUp: revealed,
        onDone: () => {
          sortHand(p.hand);
          stockPulse = 0.6;
          sound.sting("tap");
          sound.haptic("light");
          if (settings.drawRule === 0 && legalIndices(p.hand).length) drawQueue = 0;
          if (drawQueue > 0 && canDraw()) after(0.03, stepDraw);
          else finishDraw();
        },
      };
      sound.haptic("selection");
    }

    function finishDraw() {
      drawQueue = 0;
      const p = players[turn];
      const legal = legalIndices(p.hand);
      if (legal.length) {
        // The strict rule: you drew until you could play, so now you play.
        if (settings.drawRule === 0) say("PLAY IT", "the deck gave you one", BRASS, 900);
        return;
      }
      // Nothing playable and nothing left to draw: the turn is over.
      passes++;
      say("NO PLAY", p.name + " passes", "#ffb3a0", 1100);
      sound.sting("fail");
      sound.haptic("error");
      if (passes >= players.length) { after(0.7, () => endRound(-1)); return; }
      after(0.7, nextTurn);
    }

    function doPass() {
      passes++;
      const p = players[turn];
      say("NO PLAY", p.name + " passes", "#ffb3a0", 1100);
      sound.sting("fail");
      sound.haptic("error");
      if (passes >= players.length) { after(0.6, () => endRound(-1)); return; }
      after(0.5, nextTurn);
    }

    /* ===============================================================
     * SCORING
     * ============================================================= */
    async function endRound(winnerIdx) {
      phase = "round";
      roundWinner = winnerIdx;
      revealed = false;
      let left = 0;
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        p.roundPts = i === winnerIdx ? 0 : p.hand.reduce((n, c) => n + penalty(c), 0);
        p.score += p.roundPts;
        if (i !== winnerIdx) left += p.hand.length;
      }
      lastClose = left;

      const done = topScore() >= settings.target;
      const w = winnerIdx >= 0 ? players[winnerIdx] : null;

      shell.el("round-eyebrow").textContent = done ? "Final round" : "Round " + roundNo;
      shell.el("round-title").textContent = w ? w.name + " goes out" : "Nobody can move";
      shell.el("round-title").style.color = w ? w.ink : CREAM;
      shell.el("round-sub").textContent = w
        ? (left === 0 ? "an exact finish"
          : left + (left === 1 ? " card" : " cards") +
            (players.length > 2 ? " left between the rest" : " still in hand"))
        : "the deck is spent and no one has a legal card";
      shell.el("round-rows").innerHTML = scoreRows();
      shell.el("round-btn").textContent = done ? "See the result" : "Next round";
      shell.el("round").style.display = "flex";

      if (w) {
        flash.a = 0.7; flash.ink = w.ink;
        shake = 1;
        burst(W / 2, L.tableY, w.ink, 46, 380);
        sound.duck(0.5, 460);
        sound.sting("success");
        sound.haptic("success");
      } else {
        sound.sting("lose");
        sound.haptic("warning");
      }

      try {
        ctx.platform.milestone("round", {
          round: roundNo, winner: w ? w.name : "blocked", cardsLeft: left,
        });
        ctx.platform.setProgress(clamp(topScore() / settings.target, 0, 1));
      } catch (_) {}

      // The record belongs to the ROUND, not to one of the people sharing the
      // phone: how little was still in everybody else's hands when somebody
      // went out. A blocked round never produced a finish, so it never scores.
      try {
        if (winnerIdx >= 0) {
          await ctx.memory.record("closest_round").submit(left, {
            label: left + (left === 1 ? " card" : " cards") + " left",
          });
        }
      } catch (_) { /* offline is fine; the round still finished */ }
    }

    function scoreRows() {
      const ord = players.map((p, i) => ({ p, i })).sort((a, b) => a.p.score - b.p.score);
      return ord.map(({ p, i }) =>
        '<div style="display:flex;align-items:center;gap:9px;margin:9px 0;">' +
          '<div style="width:9px;height:9px;border-radius:3px;background:' + p.ink + ';flex:none;"></div>' +
          '<div style="width:60px;font-size:13px;opacity:0.86;flex:none;">' + esc(p.name) + '</div>' +
          '<div style="width:40px;text-align:right;font-size:12.5px;flex:none;color:' +
            (p.roundPts ? "#ffb3a0" : "rgba(248,239,219,0.40)") + ';">' +
            (p.roundPts ? "+" + p.roundPts : "—") + '</div>' +
          '<div style="flex:1;height:7px;border-radius:4px;background:rgba(255,255,255,0.09);overflow:hidden;">' +
            '<div style="width:' + Math.round(clamp(p.score / settings.target, 0, 1) * 100) +
              '%;height:100%;border-radius:4px;background:' + p.ink + ';"></div>' +
          '</div>' +
          '<div style="width:32px;text-align:right;font-size:15px;font-weight:700;flex:none;">' + p.score + '</div>' +
        '</div>').join("") +
        '<div style="font-size:11px;opacity:0.44;margin-top:12px;letter-spacing:0.06em;">' +
          'First past ' + settings.target + ' ends it · lowest score wins</div>';
    }

    async function endMatch() {
      phase = "match";
      let best = Infinity;
      matchWinner = -1;
      let tie = false;
      players.forEach((p, i) => {
        if (p.score < best) { best = p.score; matchWinner = i; tie = false; }
        else if (p.score === best) tie = true;
      });
      const w = tie ? null : players[matchWinner];
      if (tie) matchWinner = -1;

      shell.el("match-title").textContent = w ? w.name + " wins" : "Level pegging";
      shell.el("match-title").style.color = w ? w.ink : CREAM;
      shell.el("match-sub").textContent = w
        ? "lowest score after " + roundNo + (roundNo === 1 ? " round" : " rounds")
        : "two hands finished on the same score";
      shell.el("match-rows").innerHTML = scoreRows();
      shell.el("match").style.display = "flex";

      flash.a = 0.85; flash.ink = w ? w.ink : CREAM;
      shake = 1;
      if (w) burst(W / 2, H * 0.42, w.ink, 60, 420);
      sound.duck(0.55, 560);
      sound.sting(w ? "win" : "lose");
      sound.haptic(w ? "success" : "warning");

      try {
        ctx.platform.complete({
          winner: w ? w.name : "draw",
          rounds: roundNo,
          scores: players.map((p) => ({ name: p.name, score: p.score })),
          durationMs: Math.round(performance.now() - matchStart),
        });
      } catch (_) {}
    }

    /* ===============================================================
     * PARTICLES + BANNER
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

    function say(big, small, ink, life) {
      banner = { t0: performance.now(), big, small, ink, life: life || 1200 };
    }

    /* ===============================================================
     * DRAWING
     * ============================================================= */
    /**
     * One card's shadow, separate from the card so a cluster can share a single
     * one. Five discards landing within a dozen pixels of each other stack five
     * shadows and the pile arrives wearing a black hole; a fan of thirteen is
     * worse. Callers that draw a group pass `shadow: false` on the cards and
     * lay one shadow down first.
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
        g.globalAlpha = alpha === undefined ? 1 : alpha;
        dropShadow(g, CARD_W * scale, CARD_H * scale, CARD_R * scale, lift);
        g.globalAlpha = 1;
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

    /** Darken a card in place, for the ones this player is not allowed to use. */
    function dimCard(x, y, rot, scale) {
      const w = CARD_W * scale, h = CARD_H * scale;
      g.save();
      g.translate(x, y); g.rotate(rot);
      roundRect(g, -w / 2, -h / 2, w, h, CARD_R * scale);
      g.fillStyle = "rgba(30,13,4,0.46)"; g.fill();
      g.strokeStyle = "rgba(0,0,0,0.26)"; g.lineWidth = 1; g.stroke();
      g.restore();
    }

    /** A warm rim on the cards this player may actually play. */
    function rimCard(x, y, rot, scale, col, weight, alpha) {
      const w = CARD_W * scale, h = CARD_H * scale;
      g.save();
      g.translate(x, y); g.rotate(rot);
      g.globalAlpha = alpha;
      roundRect(g, -w / 2 + 1, -h / 2 + 1, w - 2, h - 2, CARD_R * scale);
      g.strokeStyle = col; g.lineWidth = weight; g.stroke();
      g.restore();
      g.globalAlpha = 1;
    }

    /* ---- the fan -------------------------------------------------- */
    function fanSlot(i, n) {
      const step = n > 1 ? Math.min(FAN_STEP_MAX, FAN_ARC / (n - 1)) : 0;
      const a = (i - (n - 1) / 2) * step;
      const R = L.fanR;
      return { x: L.fanX + Math.sin(a) * R, y: L.fanY + R - Math.cos(a) * R, a };
    }

    /** Is (x,y) inside card i's rectangle, in that card's own rotated frame? */
    function overCard(i, n, x, y) {
      const s = fanSlot(i, n);
      const lift = i === selected ? 30 : 0;
      const dx = x - s.x, dy = y - (s.y - lift);
      const c = Math.cos(-s.a), si = Math.sin(-s.a);
      const rx = dx * c - dy * si, ry = dx * si + dy * c;
      return Math.abs(rx) <= CARD_W * HAND_S / 2 && Math.abs(ry) <= CARD_H * HAND_S / 2;
    }

    /**
     * Which card a finger has picked out of the fan.
     *
     * The obvious answer — the topmost card whose rectangle contains the point
     * — is what the eye sees but not what the hand means. In a ten-card fan
     * each card shows a thirty-pixel sliver, so aiming at the *middle* of a
     * card lands on its right-hand neighbour, and a player who reaches for the
     * card they can plainly see gets a different one. (It cost a play script an
     * infinite loop before it cost a person a turn.)
     *
     * So the scan is topmost-first over the LEGAL cards only. Illegal cards
     * are dimmed and unusable anyway, so they cannot shadow a playable card
     * out from under a finger: put a thumb across a bright card and a dim one
     * and the bright one is what lifts.
     */
    function fanHit(x, y) {
      const hand = players[turn] ? players[turn].hand : [];
      const n = hand.length;
      for (let i = n - 1; i >= 0; i--) {
        if (!isLegal(hand[i])) continue;
        if (overCard(i, n, x, y)) return i;
      }
      return -1;
    }

    function drawHand(now) {
      if (!players[turn]) return;
      const hand = players[turn].hand;
      const n = hand.length;
      const ink = players[turn].ink;
      const act = phase === "play" && revealed && !busy();
      for (let i = 0; i < n; i++) {
        if (flyer && flyer.target === "hand" && flyer.handIndex === i) continue;
        const s = fanSlot(i, n);
        const sel = i === selected;
        const legal = revealed && isLegal(hand[i]);
        const lift = sel ? 30 : (legal && act ? 4 : 0);
        const sc = HAND_S * (sel ? 1.13 : 1);
        const x = s.x, y = s.y - lift;
        // Fan cards overlap by two thirds, so their shadows pile up under the
        // hand into one dark bar. Each is thinned; only the lifted card, which
        // is genuinely off the table, throws a full one.
        cardShadow(x, y, s.a, sc, sel ? 0.55 : 0.09, sel ? 1 : 0.42);
        drawCardAt(x, y, s.a, sc, hand[i], revealed, 0, false);
        if (revealed && !legal) dimCard(x, y, s.a, sc);
        else if (revealed && sel) rimCard(x, y, s.a, sc, "#fff4d8", 2.4, 0.95);
        else if (revealed && legal && act) rimCard(x, y, s.a, sc, hexA(ink, 1), 1.6, 0.55);
      }
    }

    /* ---- the piles ------------------------------------------------ */
    function drawStock(now) {
      const n = stock.length;
      const armed = phase === "play" && revealed && !busy() &&
        legalIndices(players[turn] ? players[turn].hand : []).length === 0 && canDraw();

      if (armed || stockPulse > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
        g.save();
        g.translate(L.stock.x, L.stock.y);
        for (let i = 4; i >= 1; i--) {
          g.globalAlpha = (armed ? 0.11 : 0.06 * stockPulse) * (1 - i / 5.2) * (0.5 + 0.5 * pulse);
          g.strokeStyle = BRASS;
          g.lineWidth = i * 7;
          roundRect(g, -CARD_W * TABLE_S / 2 - 4, -CARD_H * TABLE_S / 2 - 4,
            CARD_W * TABLE_S + 8, CARD_H * TABLE_S + 8, 12);
          g.stroke();
        }
        g.restore();
        g.globalAlpha = 1;
      }

      if (n <= 0) {
        g.save();
        g.translate(L.stock.x, L.stock.y);
        g.globalAlpha = 0.30;
        roundRect(g, -CARD_W * TABLE_S / 2, -CARD_H * TABLE_S / 2, CARD_W * TABLE_S, CARD_H * TABLE_S, CARD_R * TABLE_S);
        g.strokeStyle = CREAM; g.lineWidth = 1.4;
        g.setLineDash([5, 5]); g.stroke(); g.setLineDash([]);
        g.restore();
        g.globalAlpha = 1;
      } else {
        const layers = Math.min(6, Math.ceil(n / 6));
        for (let i = layers; i >= 2; i--) {
          g.save();
          g.translate(L.stock.x - i * 0.9, L.stock.y - i * 1.3);
          g.rotate(-0.03 + i * 0.004);
          const w = CARD_W * TABLE_S, h = CARD_H * TABLE_S;
          roundRect(g, -w / 2, -h / 2, w, h, CARD_R * TABLE_S);
          g.fillStyle = CARD_THEME.backDark; g.fill();
          g.strokeStyle = "rgba(0,0,0,0.42)"; g.lineWidth = 1; g.stroke();
          g.restore();
        }
        drawCardAt(L.stock.x - 0.9, L.stock.y - 1.3, -0.026, TABLE_S, null, false, 0.06);
      }

      // Brass count plate under the deck.
      const txt = n > 0 ? String(n) : "empty";
      g.save();
      g.translate(L.stock.x, L.stock.y + CARD_H * TABLE_S / 2 + 16);
      g.font = "700 10.5px " + FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      const tw = g.measureText(txt).width + 24;
      roundRect(g, -tw / 2, -9, tw, 18, 9);
      g.fillStyle = "rgba(18,7,2,0.72)"; g.fill();
      g.strokeStyle = BRASS_DIM; g.lineWidth = 1; g.stroke();
      g.fillStyle = BRASS;
      g.fillText(txt, 0, 0.5);
      g.restore();

      if (armed) {
        g.save();
        g.translate(L.stock.x, L.stock.y - CARD_H * TABLE_S / 2 - 15);
        g.fillStyle = BRASS;
        g.font = "800 10.5px " + FONT;
        g.textAlign = "center"; g.textBaseline = "middle";
        tracked(g, "TAP TO DRAW", 0, 0, 2.6);
        g.restore();
      }
    }

    function drawDiscard(now) {
      const skip = flyer && flyer.target === "discard" ? 1 : 0;
      const end = discard.length - skip;
      const show = discard.slice(Math.max(0, end - 4), end);
      if (show.length) {
        // One shadow for the whole pile, thrown by the card on top of it.
        const t0 = show[show.length - 1];
        cardShadow(L.discard.x + (t0.ox || 0), L.discard.y + (t0.oy || 0), t0.rot || 0, TABLE_S, 0.06);
        for (const e of show) {
          drawCardAt(L.discard.x + (e.ox || 0), L.discard.y + (e.oy || 0), e.rot || 0, TABLE_S, e, true, 0.06, false);
        }
      }
      if (!show.length) {
        g.save();
        g.globalAlpha = 0.24;
        g.translate(L.discard.x, L.discard.y);
        roundRect(g, -CARD_W * TABLE_S / 2, -CARD_H * TABLE_S / 2, CARD_W * TABLE_S, CARD_H * TABLE_S, CARD_R * TABLE_S);
        g.strokeStyle = CREAM; g.lineWidth = 1.4;
        g.setLineDash([5, 5]); g.stroke(); g.setLineDash([]);
        g.restore();
        g.globalAlpha = 1;
      }
      if (discardPulse > 0) {
        g.save();
        g.globalAlpha = discardPulse * 0.55;
        g.strokeStyle = "#ffe6b8";
        g.lineWidth = 1.5 + (1 - discardPulse) * 5;
        const k = 1 - discardPulse;
        g.translate(L.discard.x, L.discard.y);
        roundRect(g, -CARD_W * TABLE_S / 2 - k * 20, -CARD_H * TABLE_S / 2 - k * 20,
          CARD_W * TABLE_S + k * 40, CARD_H * TABLE_S + k * 40, CARD_R + k * 14);
        g.stroke();
        g.restore();
        g.globalAlpha = 1;
      }
    }

    /**
     * The named suit.
     *
     * An eight changes what everybody has to follow and there is no card on
     * the table saying so, so it gets a physical object: a parchment token
     * pinned above the pile. Parchment rather than brass because the black
     * suits vanish on metal, and the whole point of the token is legibility.
     */
    function drawNamedSuit(now) {
      if (!named) return;
      const x = L.discard.x, y = L.discard.y - CARD_H * TABLE_S / 2 - 22;
      const bob = Math.sin(now * 0.0022) * 1.6;
      g.save();
      g.translate(x, y + bob);
      for (let i = 3; i >= 1; i--) {
        g.globalAlpha = 0.09 * (1 - i / 4);
        g.fillStyle = BRASS;
        g.beginPath(); g.arc(0, 0, 19 + i * 4, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      g.beginPath(); g.arc(0, 0, 18, 0, TAU);
      const disc = g.createLinearGradient(-18, -18, 18, 18);
      disc.addColorStop(0, "#fffaf0");
      disc.addColorStop(1, "#e6d8bb");
      g.fillStyle = disc; g.fill();
      g.strokeStyle = "rgba(174,120,32,0.75)"; g.lineWidth = 1.6; g.stroke();
      g.beginPath(); g.arc(0, 0, 14.5, 0, TAU);
      g.strokeStyle = "rgba(174,120,32,0.30)"; g.lineWidth = 0.9; g.stroke();
      g.fillStyle = isRed(named) ? CARD_THEME.red : CARD_THEME.black;
      suitPath(g, named, 0, 0.5, 9.5);
      g.restore();

      g.save();
      g.fillStyle = BRASS;
      g.font = "800 9px " + FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      tracked(g, "MUST FOLLOW", x, y - 30 + bob, 2.2);
      g.restore();
    }

    /**
     * The opponents' rail.
     *
     * Card counts are public information — that is the whole reason a hidden
     * hand is playable at all — so they get real estate rather than a footnote.
     * The plaques are ordered by whose turn comes next, left to right, so the
     * strip doubles as the turn order and the leftmost is always the person
     * the phone is about to reach.
     */
    function drawRail(now) {
      const n = players.length;
      if (n < 2) return;
      const others = [];
      for (let k = 1; k < n; k++) others.push((turn + k) % n);

      const gap = 8;
      const pw = Math.min(212, (W - 24 - gap * (others.length - 1)) / others.length);
      const startX = (W - (pw * others.length + gap * (others.length - 1))) / 2;
      const y = L.railTop, h = L.railH;
      const wide = pw >= 150;

      for (let k = 0; k < others.length; k++) {
        const p = players[others[k]];
        const x = startX + k * (pw + gap);
        const next = k === 0 && others.length > 1;
        const one = p.hand.length === 1;

        g.save();
        if (p.pulse > 0) g.translate((Math.random() - 0.5) * p.pulse * 5, (Math.random() - 0.5) * p.pulse * 5);

        roundRect(g, x, y, pw, h, 14);
        const body = g.createLinearGradient(x, y, x, y + h);
        body.addColorStop(0, "rgba(40,21,12,0.90)");
        body.addColorStop(1, "rgba(16,7,3,0.94)");
        g.fillStyle = body; g.fill();
        g.fillStyle = hexA(p.ink, k === 0 ? 0.15 : 0.06);
        g.fill();
        g.strokeStyle = hexA(p.ink, k === 0 ? 0.80 : 0.30);
        g.lineWidth = k === 0 ? 1.7 : 1.1;
        g.stroke();

        if (one) {
          const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
          g.globalAlpha = 0.28 + 0.36 * pulse;
          roundRect(g, x - 2.5, y - 2.5, pw + 5, h + 5, 16);
          g.strokeStyle = "#ff9d6b"; g.lineWidth = 2;
          g.stroke();
          g.globalAlpha = 1;
        }

        // A little fan of backs, so a count is also a picture of a hand.
        const fx = x + (wide ? 32 : 25), fy = y + h / 2 + 3;
        const shown = Math.min(4, p.hand.length);
        for (let i = 0; i < shown; i++) {
          const a = (i - (shown - 1) / 2) * 0.30;
          drawCardAt(fx + Math.sin(a) * 15, fy - Math.cos(a) * 5, a, 0.185, null, false, 0.03, false);
        }
        if (p.hand.length === 0) {
          g.globalAlpha = 0.28;
          roundRect(g, fx - 9, fy - 13, 18, 26, 3);
          g.strokeStyle = CREAM; g.lineWidth = 1;
          g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
          g.globalAlpha = 1;
        }

        const tx = x + (wide ? 62 : 47);
        g.textAlign = "left"; g.textBaseline = "alphabetic";

        g.fillStyle = hexA(p.ink, 0.95);
        g.font = "800 10px " + FONT;
        trackedL(g, p.name.toUpperCase(), tx, y + 23, 1.7);

        g.fillStyle = CREAM;
        g.font = "800 26px " + FONT;
        g.fillText(String(p.hand.length), tx, y + 51);
        const numW = g.measureText(String(p.hand.length)).width;

        g.fillStyle = one ? "#ff9d6b" : INK_SOFT;
        g.font = "700 8.5px " + FONT;
        trackedL(g, one ? "ONE CARD" : "CARDS", tx + numW + 8, y + 43, 1.5);

        // On a wide plaque the running score goes to the far edge, or the left
        // half is a column of text against forty empty pixels of leather.
        g.fillStyle = "rgba(248,239,219,0.46)";
        g.font = "600 9.5px " + FONT;
        if (wide) {
          g.textAlign = "right";
          g.font = "700 15px " + FONT;
          g.fillStyle = "rgba(248,239,219,0.80)";
          g.fillText(String(p.score), x + pw - 18, y + 47);
          g.font = "700 8px " + FONT;
          g.fillStyle = "rgba(248,239,219,0.42)";
          g.textAlign = "left";
          trackedL(g, "PTS", x + pw - 18 - trackWidth(g, "PTS", 1.6), y + 60, 1.6);
        } else {
          g.fillText(p.score + " pts", tx + numW + 8, y + 56);
        }

        // "Up next" is a double chevron rather than the word, because on a
        // three-opponent rail each plaque is 117px wide and the word landed on
        // top of the name. The brighter border carries most of the meaning
        // anyway; this is the confirmation.
        if (next) {
          g.fillStyle = BRASS;
          for (const [dx, al] of [[0, 1], [-7, 0.45]]) {
            g.globalAlpha = al;
            g.beginPath();
            g.moveTo(x + pw - 17 + dx, y + 11);
            g.lineTo(x + pw - 11 + dx, y + 16);
            g.lineTo(x + pw - 17 + dx, y + 21);
            g.closePath(); g.fill();
          }
          g.globalAlpha = 1;
        }
        g.restore();
      }
      g.textAlign = "center";
      g.textBaseline = "middle";
    }

    /* ---- the prompt band ------------------------------------------ */
    /**
     * The prompt band.
     *
     * Only drawn while a player is actually looking at their hand. It used to
     * be drawn in every phase, and the cover, the suit sheet and the result
     * panel all sit on translucent grounds — so a ghost of "ROSE · 1 card
     * plays" printed itself faintly through every one of them.
     */
    function drawPrompt(now) {
      if (phase !== "play") return;
      const p = players[turn];
      if (!p) return;
      const x = W / 2, y = L.promptY;
      const w = L.promptW, h = L.promptH;

      const legal = legalIndices(p.hand);
      const stuck = revealed && !legal.length && !canDraw();
      if (stuck) { drawPassButton(now); return; }

      g.save();
      roundRect(g, x - w / 2, y - h / 2, w, h, 15);
      const body = g.createLinearGradient(x, y - h / 2, x, y + h / 2);
      body.addColorStop(0, "rgba(38,20,12,0.86)");
      body.addColorStop(1, "rgba(16,7,3,0.90)");
      g.fillStyle = body; g.fill();
      g.strokeStyle = hexA(p.ink, revealed ? 0.55 : 0.22);
      g.lineWidth = 1.2; g.stroke();

      g.textBaseline = "middle";
      g.textAlign = "left";
      g.beginPath(); g.arc(x - w / 2 + 18, y, 4.5, 0, TAU);
      g.fillStyle = p.ink; g.fill();
      g.fillStyle = hexA(p.ink, 0.95);
      g.font = "800 10.5px " + FONT;
      g.fillText(p.name.toUpperCase(), x - w / 2 + 29, y - 9);

      g.font = "600 12px " + FONT;
      let msg = "";
      if (!revealed) msg = "pass the phone along";
      else if (legal.length) msg = legal.length + (legal.length === 1 ? " card plays" : " cards play");
      else if (canDraw()) msg = "nothing plays — tap the deck";
      else msg = "nothing plays";
      g.fillStyle = legal.length || !revealed ? INK_SOFT : "#ffb3a0";
      g.fillText(msg, x - w / 2 + 29, y + 9);

      // What has to be matched, drawn rather than named, and laid out from the
      // right edge inward so the pieces cannot collide at any rank width.
      const t = top();
      if (t) {
        const suit = activeSuit();
        g.textBaseline = "middle";
        g.fillStyle = isRed(suit) ? "#ff8b92" : CREAM;
        suitPath(g, suit, x + w / 2 - 28, y - 1, 12);
        let cur = x + w / 2 - 44;                    // right edge of the next item
        g.font = "700 9px " + FONT;
        const small = named ? "EIGHT" : "OR";
        g.fillStyle = named ? BRASS : INK_SOFT;
        const sw = trackWidth(g, small, 1.6);
        trackedL(g, small, cur - sw, y, 1.6);
        cur -= sw + 9;
        if (!named) {
          g.fillStyle = CREAM;
          g.font = "800 19px " + SERIF;
          g.textAlign = "right";
          g.fillText(t.rank, cur, y);
        }
      }
      g.restore();
      g.textAlign = "center";
      g.textBaseline = "middle";
    }

    function drawPassButton(now) {
      const b = L.pass;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
      g.save();
      roundRect(g, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 14);
      const grad = g.createLinearGradient(b.x, b.y - b.h / 2, b.x, b.y + b.h / 2);
      grad.addColorStop(0, "#f2d089");
      grad.addColorStop(1, "#cf9a2e");
      g.fillStyle = grad; g.fill();
      g.globalAlpha = 0.25 + 0.25 * pulse;
      g.strokeStyle = "#ffeec2"; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = "#2a1a04";
      g.font = "800 13px " + FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      tracked(g, "NOTHING TO PLAY — PASS", b.x, b.y, 1.4);
      g.restore();
    }

    /* ---- header --------------------------------------------------- */
    function drawHeader(now) {
      if (phase === "menu") return;
      const y = L.headTop + L.headH / 2;
      g.save();
      g.textBaseline = "alphabetic";
      g.textAlign = "left";
      g.fillStyle = BRASS;
      g.font = "800 9.5px " + FONT;
      trackedL(g, "ROUND " + roundNo, 15, y - 3, 2.2);
      g.fillStyle = INK_SOFT;
      g.font = "600 10px " + FONT;
      g.fillText("first past " + settings.target + " ends it · lowest wins", 15, y + 12);
      g.restore();
      g.textAlign = "center";
      g.textBaseline = "middle";
    }

    /* ---- banner --------------------------------------------------- */
    function drawBanner(now) {
      if (!banner) return;
      const age = now - banner.t0;
      if (age > banner.life) { banner = null; return; }
      const inT = clamp(age / 200, 0, 1);
      const out = clamp((banner.life - age) / 300, 0, 1);
      const pop = 0.72 + 0.28 * backOut(inT);
      const y = L.tableY - 4;
      g.save();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.globalAlpha = out;
      g.translate(W / 2, y);
      g.scale(pop, pop);
      g.font = "800 22px " + FONT;
      const tw = Math.min(g.measureText(banner.big).width + 40, W - 40);
      roundRect(g, -tw / 2, -30, tw, 60, 16);
      g.fillStyle = "rgba(14,5,2,0.86)"; g.fill();
      g.strokeStyle = hexA(banner.ink[0] === "#" ? banner.ink : "#ffffff", 0.72);
      g.lineWidth = 1.8; g.stroke();
      g.fillStyle = banner.ink;
      g.fillText(banner.big, 0, -8);
      g.fillStyle = INK_SOFT;
      g.font = "600 11px " + FONT;
      tracked(g, banner.small, 0, 14, 0.5);
      g.restore();
      g.globalAlpha = 1;
    }

    /* ---- the deal -------------------------------------------------- */
    function drawDeal(now) {
      const t = clamp(dealT / 1.0, 0, 1);
      // Cards converge into the stock, then the turn-up leaves it for the pile.
      const n = 8;
      if (t > 0.12) cardShadow(L.stock.x, L.stock.y, -0.03, TABLE_S, 0.06);
      for (let i = 0; i < n; i++) {
        const k = clamp((t - i * 0.055) / 0.34, 0, 1);
        if (k <= 0) continue;
        const p = easeOut(k);
        const a = (i / n) * TAU + 0.9;
        const x = lerp(L.stock.x + Math.cos(a) * W * 0.9, L.stock.x - i * 0.9, p);
        const y = lerp(L.stock.y + Math.sin(a) * H * 0.6, L.stock.y - i * 1.3, p);
        drawCardAt(x, y, lerp(a * 1.5, -0.03, p), TABLE_S, null, false, 0, false);
      }
      if (t > 0.72) {
        const k = clamp((t - 0.72) / 0.28, 0, 1);
        const p = easeOut(k);
        const x = lerp(L.stock.x, L.discard.x, p);
        const y = lerp(L.stock.y, L.discard.y, p) - Math.sin(Math.PI * p) * 24;
        const f = clamp(k / 0.6, 0, 1);
        const sx = Math.abs(Math.cos(f * Math.PI));
        g.save();
        g.translate(x, y);
        g.scale(Math.max(sx, 0.02), 1);
        drawCardAt(0, 0, 0, TABLE_S, discard[0], f >= 0.5, 0.4 * (1 - p) + 0.05);
        g.restore();
      }
    }

    /* ---- the title fan --------------------------------------------- */
    const FAN = ["8S", "QH", "8D", "KC", "8H"];
    function drawTitleFan(now) {
      const cx = W / 2, cy = H * 0.295, R = 320;
      const rock = Math.sin(now * 0.00065) * 0.028;
      for (let i = 0; i < FAN.length; i++) {
        const k = i - (FAN.length - 1) / 2;
        const a = k * 0.190 + rock;
        const wild = FAN[i][0] === "8";
        const card = { id: FAN[i], rank: FAN[i].slice(0, -1), suit: FAN[i].slice(-1) };
        const fx = cx + Math.sin(a) * R, fy = cy - Math.cos(a) * R + R - (wild ? 15 : 0);
        cardShadow(fx, fy, a, 1, wild ? 0.22 : 0.07, 0.5);
        drawCardAt(fx, fy, a, 1, card, true, 0, false);
      }
    }

    /* ---- the card in the air ---------------------------------------- */
    function drawFlyer(now) {
      if (!flyer) return;
      const f = flyer;
      const t = clamp((now - f.t0) / f.dur, 0, 1);
      const p = easeInOut(t);
      const x = lerp(f.x0, f.x1, p);
      const y = lerp(f.y0, f.y1, p) - Math.sin(Math.PI * p) * 30;
      const s = lerp(f.s0, f.s1, p);
      const faceUp = f.target === "discard" ? true : !!f.faceUp;
      drawCardAt(x, y, lerp(f.r0, f.r1, p), s, f.card, faceUp, 0.30 + 0.4 * Math.sin(Math.PI * p));
    }

    /* ===============================================================
     * FRAME
     * ============================================================= */
    function render(now) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (table) g.drawImage(table, 0, 0, W, H);
      else paintTable(g, false);

      g.save();
      if (shake > 0.01) g.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);

      if (phase === "menu") {
        drawTitleFan(now);
      } else if (phase === "deal") {
        drawDeal(now);
      } else {
        drawStock(now);
        drawDiscard(now);
        drawNamedSuit(now);
        drawFlyer(now);
        drawHand(now);
        drawParts();
      }
      g.restore();

      if (phase !== "menu" && phase !== "deal") {
        drawRail(now);
        drawPrompt(now);
        drawHeader(now);
        drawBanner(now);
      }

      if (flash.a > 0.004) {
        g.globalAlpha = flash.a * 0.24;
        g.fillStyle = flash.ink;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 60) / 1000;
      const dtG = sheetOpen ? 0 : Math.min(dtMs, 120) / 1000;
      const now = performance.now();

      shake *= Math.pow(0.0022, dt);
      flash.a *= Math.pow(0.0012, dt);
      stockPulse = Math.max(0, stockPulse - dt * 1.5);
      discardPulse = Math.max(0, discardPulse - dt * 2.2);
      for (const p of players) p.pulse = Math.max(0, p.pulse - dt * 1.3);
      stepParts(dt);

      if (flyer && !sheetOpen && now - flyer.t0 >= flyer.dur) {
        const f = flyer;
        flyer = null;
        if (f.onDone) f.onDone();
      } else if (flyer && sheetOpen) {
        flyer.t0 += dtMs;                       // hold the card in the air
      }

      if (waitT > 0) {
        waitT -= dtG;
        if (waitT <= 0) { const f = waitFn; waitT = 0; waitFn = null; if (f) f(); }
      }

      if (phase === "deal") {
        dealT += dtG;
        if (dealT >= 1.05) showCover();
      }

      render(now);
    });

    /* ===============================================================
     * OVERLAY
     *
     * One markup string on the runtime-owned root, queried back out by
     * [data-el]. The root itself is pointer-transparent, because it is
     * created after the canvas and would otherwise swallow every tap
     * meant for the fan; each control opts back in.
     * ============================================================= */
    const SAFE_T = ctx.safeArea.top, SAFE_B = ctx.safeArea.bottom;
    const btn = "pointer-events:auto;width:36px;height:36px;border-radius:12px;border:none;" +
      "background:rgba(24,10,4,0.74);color:" + CREAM + ";font-size:15px;line-height:1;" +
      "font-family:inherit;padding:0;box-shadow:inset 0 0 0 1px rgba(232,185,95,0.30);";
    const bigBtn = (bg, fg, edge) => "width:100%;padding:15px;border:none;border-radius:15px;font-family:inherit;" +
      "font-size:16px;font-weight:700;background:" + bg + ";color:" + fg + ";margin-top:11px;" +
      "pointer-events:auto;" + (edge ? "box-shadow:inset 0 0 0 1px " + edge + ";" : "");
    const QUIET = "linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.055))";
    const QUIET_EDGE = "rgba(232,185,95,0.42)";
    const GOLD = "linear-gradient(180deg,#f4d492,#cf9a2e)";
    // box-sizing is explicit on every padded block. Chrome's UA sheet gives
    // buttons border-box and divs content-box, so a panel with width:100% and
    // 22px of padding came out 44px wider than the column it sits in and hung
    // off both edges of the screen — while the buttons under it lined up fine.
    const panel = "box-sizing:border-box;max-width:326px;width:100%;" +
      "background:linear-gradient(180deg,#4a2513,#261006);" +
      "border-radius:22px;padding:22px;box-shadow:inset 0 0 0 1px rgba(232,185,95,0.30),0 20px 60px rgba(0,0,0,0.6);";
    const label = "font-size:11px;letter-spacing:0.24em;text-transform:uppercase;opacity:0.52;";
    const sheetCss = "box-sizing:border-box;position:absolute;inset:0;display:none;align-items:center;" +
      "align-items:safe center;justify-content:center;" +
      "background:rgba(12,5,2,0.90);z-index:80;padding:" + (SAFE_T + 14) + "px 24px " +
      (SAFE_B + 14) + "px;overflow-y:auto;pointer-events:auto;";
    const resultCss = "box-sizing:border-box;position:absolute;inset:0;display:none;flex-direction:column;" +
      "align-items:center;align-items:safe center;justify-content:center;z-index:65;padding:" +
      (SAFE_T + 16) + "px 22px " + (SAFE_B + 16) + "px;text-align:center;overflow-y:auto;pointer-events:auto;" +
      "background:radial-gradient(130% 62% at 50% 42%,rgba(34,15,6,0.80),rgba(9,3,1,0.965));";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:" + CREAM + ";pointer-events:none;";
    root.innerHTML =
      /* ---- chrome: a horizontal strip, never a side column ---- */
      '<div style="position:absolute;right:10px;top:' + (SAFE_T + 6) + 'px;display:flex;' +
        'gap:7px;z-index:70;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + btn + 'font-size:16px;">♪</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + btn + '">⚙</button>' +
        '<button data-el="help" aria-label="How to play" style="' + btn + '">?</button>' +
      '</div>' +

      /* ---- title ---- */
      '<div data-el="menu" style="position:absolute;inset:0;display:flex;flex-direction:column;' +
        'justify-content:flex-end;align-items:center;z-index:50;pointer-events:auto;' +
        'padding:0 26px ' + (SAFE_B + 24) + 'px;text-align:center;background:linear-gradient(180deg,' +
        'rgba(14,5,2,0) 18%,rgba(14,5,2,0.24) 38%,rgba(14,5,2,0.88) 56%,rgba(12,4,1,0.98) 100%);">' +
        '<div style="' + label + 'margin-bottom:4px;">Wild cards, one phone</div>' +
        '<div style="font-size:52px;font-weight:800;letter-spacing:-0.035em;line-height:0.92;' +
          'background:linear-gradient(178deg,#fff6e3 2%,#f2ca79 44%,#c48f31 100%);-webkit-background-clip:text;' +
          'background-clip:text;-webkit-text-fill-color:transparent;color:transparent;' +
          'text-shadow:0 8px 30px rgba(0,0,0,0.55);">Crazy Eights</div>' +
        '<div style="font-size:14px;line-height:1.55;opacity:0.66;max-width:272px;margin-top:9px;">' +
          'Match the pile by rank or suit. Play an eight and name any suit you like. ' +
          'The phone goes round — your hand is yours alone.</div>' +
        '<div style="' + label + 'margin:18px 0 8px;">Players</div>' +
        '<div data-el="seats" style="display:flex;gap:9px;width:210px;"></div>' +
        '<div style="' + label + 'margin:14px 0 8px;">Play to</div>' +
        '<div data-el="targets" style="display:flex;gap:7px;width:250px;"></div>' +
        '<div style="width:100%;max-width:250px;">' +
          '<button data-el="deal" style="' + bigBtn(GOLD, "#241704") +
            'margin-top:18px;letter-spacing:0.06em;">Deal</button>' +
        '</div>' +
      '</div>' +

      /* ---- the handover cover ----
       * Full-bleed so a peeking tap cannot reach the fan underneath, but
       * transparent at the top: the pile, the deck and everybody's counts are
       * public information and there is no reason to hide them while the phone
       * is in the air. Only the hand is secret, and the hand is drawn face
       * down until the cover lifts. ---- */
      '<div data-el="cover" style="box-sizing:border-box;position:absolute;inset:0;display:none;' +
        'flex-direction:column;justify-content:flex-end;align-items:center;z-index:55;pointer-events:auto;' +
        'padding:0 24px ' + (SAFE_B + 22) + 'px;text-align:center;background:linear-gradient(180deg,' +
        'rgba(16,6,2,0) 0%,rgba(16,6,2,0.05) 40%,rgba(15,5,2,0.55) 52%,rgba(11,4,1,0.965) 64%,' +
        'rgba(9,3,1,0.99) 100%);">' +
        '<div data-el="cover-need" style="font-size:12.5px;opacity:0.62;margin-bottom:18px;"></div>' +
        '<div style="' + label + '">Pass the phone to</div>' +
        '<div data-el="cover-name" style="font-size:44px;font-weight:800;line-height:1.06;' +
          'letter-spacing:-0.02em;margin-top:2px;"></div>' +
        '<div data-el="cover-count" style="font-size:12.5px;font-weight:700;letter-spacing:0.16em;' +
          'text-transform:uppercase;opacity:0.85;margin-top:4px;"></div>' +
        '<div style="width:100%;max-width:306px;">' +
          '<button data-el="cover-btn" style="' + bigBtn("#fff", "#1a0a03") +
            'margin-top:20px;font-size:15px;"></button>' +
        '</div>' +
        '<div style="font-size:12px;opacity:0.44;line-height:1.5;margin-top:12px;max-width:260px;">' +
          'Only you should see the next screen.<br>It covers itself again the moment you play.</div>' +
      '</div>' +

      /* ---- name a suit ---- */
      '<div data-el="suitp" style="position:absolute;inset:0;display:none;flex-direction:column;' +
        'justify-content:flex-end;align-items:center;z-index:60;pointer-events:auto;' +
        'padding:0 24px ' + (SAFE_B + 22) + 'px;text-align:center;background:linear-gradient(180deg,' +
        'rgba(16,6,2,0) 22%,rgba(16,6,2,0.55) 40%,rgba(12,4,1,0.97) 62%);">' +
        '<div style="' + label + '">Wild eight</div>' +
        '<div style="font-size:26px;font-weight:800;margin-top:2px;line-height:1.15;">' +
          '<span data-el="suit-who"></span> names the suit</div>' +
        '<div style="font-size:12.5px;opacity:0.55;margin-top:5px;">Everyone must follow it until the next eight.</div>' +
        '<div style="display:flex;gap:9px;margin-top:18px;width:100%;max-width:320px;">' +
          '<button data-el="suit-S" style="' + suitBtnCss(false) + '">♠</button>' +
          '<button data-el="suit-H" style="' + suitBtnCss(true) + '">♥</button>' +
          '<button data-el="suit-D" style="' + suitBtnCss(true) + '">♦</button>' +
          '<button data-el="suit-C" style="' + suitBtnCss(false) + '">♣</button>' +
        '</div>' +
      '</div>' +

      /* ---- round over ---- */
      '<div data-el="round" style="' + resultCss + '">' +
        '<div style="' + panel + '">' +
          '<div data-el="round-eyebrow" style="' + label + '"></div>' +
          '<div data-el="round-title" style="font-size:31px;font-weight:800;margin-top:4px;' +
            'letter-spacing:-0.02em;line-height:1.1;"></div>' +
          '<div data-el="round-sub" style="font-size:12.5px;opacity:0.58;margin-top:5px;"></div>' +
          '<div style="height:1px;background:rgba(232,185,95,0.22);margin:16px 0 10px;"></div>' +
          '<div data-el="round-rows"></div>' +
        '</div>' +
        '<div style="width:100%;max-width:326px;">' +
          '<button data-el="round-btn" style="' + bigBtn(GOLD, "#241704") + '">Next round</button>' +
        '</div>' +
      '</div>' +

      /* ---- match over ---- */
      '<div data-el="match" style="' + resultCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="' + label + '">Game over</div>' +
          '<div data-el="match-title" style="font-size:36px;font-weight:800;margin-top:4px;' +
            'letter-spacing:-0.02em;line-height:1.1;"></div>' +
          '<div data-el="match-sub" style="font-size:12.5px;opacity:0.58;margin-top:5px;"></div>' +
          '<div style="height:1px;background:rgba(232,185,95,0.22);margin:16px 0 10px;"></div>' +
          '<div data-el="match-rows"></div>' +
        '</div>' +
        '<div style="width:100%;max-width:326px;">' +
          '<button data-el="again" style="' + bigBtn(GOLD, "#241704") + '">Play again</button>' +
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
          '<div style="' + label + '">If you cannot play</div>' +
          '<div data-el="rules" style="display:flex;gap:8px;margin:9px 0 18px;"></div>' +
          '<div style="' + label + '">Play to</div>' +
          '<div data-el="targs" style="display:flex;gap:7px;margin:9px 0 4px;"></div>' +
          '<div style="font-size:12px;opacity:0.45;margin-top:10px;line-height:1.45;">' +
            'The target applies straight away. A new player count starts a fresh game.</div>' +
          '<button data-el="cogp-close" style="' + bigBtn(GOLD, "#241704") + 'margin-top:16px;">Done</button>' +
          // Somebody has to be able to walk away from a half-played game
          // without closing the bit; without this the only route back to the
          // title is playing the whole thing out.
          '<button data-el="leave" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + 'margin-top:8px;">Leave this game</button>' +
        '</div>' +
      '</div>' +

      /* ---- how to play ---- */
      '<div data-el="helpp" style="' + sheetCss + '">' +
        '<div style="' + panel + '">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:12px;">How to play</div>' +
          '<ul style="font-size:13px;line-height:1.5;opacity:0.88;padding-left:17px;margin:0;">' +
            '<li style="margin-bottom:6px;">Seven cards each (five with four players), one turned up to start the pile.</li>' +
            '<li style="margin-bottom:6px;">The cover names who should be holding the phone. Tap to see your hand; it closes again the moment you play.</li>' +
            '<li style="margin-bottom:6px;">Match the pile’s <b>rank</b> or its <b>suit</b>. Cards you cannot play are dimmed and cannot be tapped.</li>' +
            '<li style="margin-bottom:6px;">Press a card to lift it, slide to change your mind, lift your finger to play. Slide off the bottom to cancel.</li>' +
            '<li style="margin-bottom:6px;">Any <b>eight is wild</b>: play it on anything and name the suit that follows.</li>' +
            '<li style="margin-bottom:6px;">Nothing plays? <b>Tap the deck</b> and keep drawing until something fits. If the deck runs dry the pile is shuffled back in.</li>' +
            '<li style="margin-bottom:6px;">First to empty a hand wins the round. Everyone else scores what they hold: <b>50</b> an eight, <b>10</b> a court, face value otherwise.</li>' +
            '<li style="margin-bottom:6px;">Those are penalties: when someone crosses the target, the <b>lowest</b> score wins.</li>' +
            '<li>Fewest cards left between the losers goes to the global board.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + bigBtn(QUIET, CREAM, QUIET_EDGE) + 'margin-top:16px;">Got it</button>' +
        '</div>' +
      '</div>';

    function suitBtnCss(red) {
      return "flex:1;pointer-events:auto;border:none;border-radius:16px;font-family:inherit;" +
        "font-size:34px;line-height:1;padding:16px 0 18px;font-weight:700;" +
        "background:linear-gradient(180deg,#fffaf0,#e4d5b6);color:" + (red ? CARD_THEME.red : CARD_THEME.black) + ";" +
        "box-shadow:inset 0 0 0 1px rgba(174,120,32,0.55),0 8px 20px rgba(0,0,0,0.45);";
    }

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
          b.style.background = on ? GOLD
            : "linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.045))";
          b.style.color = on ? "#241704" : "rgba(248,239,219,0.62)";
          b.style.boxShadow = on
            ? "inset 0 1px 0 rgba(255,252,238,0.55),0 2px 8px rgba(0,0,0,0.35)"
            : "inset 0 0 0 1px rgba(232,185,95,0.16)";
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
        pills(shell.el("seats"), [2, 3, 4], ["2", "3", "4"],
          () => settings.players, (v) => { settings.players = v; }),
        pills(shell.el("counts"), [2, 3, 4], ["2", "3", "4"],
          () => settings.players, (v) => { settings.players = v; }),
        pills(shell.el("targets"), TARGETS, TARGETS.map(String),
          () => settings.target, (v) => { settings.target = v; }),
        pills(shell.el("targs"), TARGETS, TARGETS.map(String),
          () => settings.target, (v) => { settings.target = v; }),
        pills(shell.el("rules"), [0, 1], ["Until you can", "One then pass"],
          () => settings.drawRule, (v) => { settings.drawRule = v; }),
        pills(shell.el("mutes"), [0, 1], ["On", "Muted"],
          () => (sound.muted ? 1 : 0), (v) => {
            if ((v === 1) !== sound.muted) { sound.toggle(); paintMute(); }
          }),
      ].filter(Boolean);
    }
    wirePills();

    function paintMute() {
      const b = shell.el("mute");
      b.style.textDecoration = sound.muted ? "line-through" : "none";
      b.style.opacity = sound.muted ? "0.45" : "1";
    }
    paintMute();

    shell.tap(shell.el("mute"), () => { sound.toggle(); paintMute(); paintAllPills(); });

    function showSheet(name, open) {
      shell.el(name).style.display = open ? "flex" : "none";
      sheetOpen = open;
    }
    shell.tap(shell.el("cog"), () => { showSheet("cogp", true); paintAllPills(); });
    shell.tap(shell.el("cogp-close"), () => { showSheet("cogp", false); });
    shell.tap(shell.el("help"), () => { showSheet("helpp", true); });
    shell.tap(shell.el("helpp-close"), () => { showSheet("helpp", false); });

    shell.tap(shell.el("deal"), async () => {
      try { ctx.platform.start({ players: settings.players, target: settings.target }); } catch (_) {}
      await sound.unlock();
      shell.el("menu").style.display = "none";
      newMatch();
    });
    shell.tap(shell.el("cover-btn"), () => reveal());
    for (const s of ["S", "H", "D", "C"]) shell.tap(shell.el("suit-" + s), () => nameSuit(s));
    shell.tap(shell.el("round-btn"), () => {
      shell.el("round").style.display = "none";
      if (topScore() >= settings.target) endMatch();
      else newRound();
    });
    shell.tap(shell.el("again"), () => {
      shell.el("match").style.display = "none";
      newMatch();
      try { ctx.platform.interact({ type: "replay" }); } catch (_) {}
    });
    function toMenu() {
      for (const n of ["match", "round", "cover", "suitp"]) shell.el(n).style.display = "none";
      shell.el("menu").style.display = "flex";
      phase = "menu";
      players = [];
      flyer = null; drawQueue = 0; waitT = 0; waitFn = null; banner = null;
      layout(); bakeTable();
      paintAllPills();
    }
    shell.tap(shell.el("quit"), toMenu);
    shell.tap(shell.el("leave"), () => { showSheet("cogp", false); toMenu(); });

    /* ===============================================================
     * INPUT
     *
     * One pointer owns the fan at a time, bound on pointerdown and kept
     * for that pointer's whole life. Two thumbs on a shared phone is not
     * a hypothetical here: the person whose turn it is not will point at
     * a card, and their finger must not move somebody else's selection.
     * ============================================================= */
    function inRect(x, y, r) {
      return x >= r.x - r.w / 2 && x <= r.x + r.w / 2 && y >= r.y - r.h / 2 && y <= r.y + r.h / 2;
    }
    function hitStock(x, y) {
      const w = CARD_W * TABLE_S + 26, h = CARD_H * TABLE_S + 26;
      return inRect(x, y, { x: L.stock.x, y: L.stock.y, w, h });
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      if (sheetOpen || phase !== "play" || !revealed || busy()) return;
      const x = e.offsetX, y = e.offsetY;
      const p = players[turn];
      const legal = legalIndices(p.hand);

      if (!legal.length) {
        if (canDraw() && hitStock(x, y)) {
          e.preventDefault();
          sound.haptic("medium");
          startDraw();
          return;
        }
        if (!canDraw() && inRect(x, y, L.pass)) { e.preventDefault(); doPass(); return; }
        return;
      }
      if (activeId !== null) return;                     // one hand on the fan
      const i = fanHit(x, y);
      if (i < 0 || !isLegal(p.hand[i])) return;
      activeId = e.pointerId;
      selected = i;
      sound.haptic("selection");
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
      e.preventDefault();
    }, { passive: false });

    ctx.listen(canvas, "pointermove", (e) => {
      if (activeId === null || e.pointerId !== activeId) return;
      const x = e.offsetX, y = e.offsetY;
      // Sliding down off the fan is the escape hatch: a card lifted by
      // accident has to be droppable without playing it.
      if (y > L.fanY + CARD_H * HAND_S * 0.8) { selected = -1; return; }
      const p = players[turn];
      const i = fanHit(x, y);
      if (i >= 0 && isLegal(p.hand[i]) && i !== selected) {
        selected = i;
        sound.haptic("selection");
      }
    });

    const releaseFan = (play) => (e) => {
      if (activeId === null || e.pointerId !== activeId) return;
      activeId = null;
      const i = selected;
      if (play && i >= 0 && phase === "play" && revealed && !busy()) playCard(i);
      else selected = -1;
    };
    ctx.listen(canvas, "pointerup", releaseFan(true));
    ctx.listen(canvas, "pointercancel", releaseFan(false));

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
     * real hand and assert on what actually happened. It exposes nothing
     * the bit does not already draw on screen for whoever is holding it.
     * ============================================================= */
    window.__EIGHTS__ = {
      get phase() { return phase; },
      get busy() { return busy(); },
      get revealed() { return revealed; },
      get turn() { return turn; },
      get round() { return roundNo; },
      get target() { return settings.target; },
      get named() { return named; },
      get top() { const t = top(); return t ? t.id : null; },
      get stock() { return stock.length; },
      get pile() { return discard.length; },
      get players() {
        return players.map((p) => ({ name: p.name, cards: p.hand.length, score: p.score, round: p.roundPts }));
      },
      get hand() { return players[turn] ? players[turn].hand.map((c) => c.id) : []; },
      get legal() { return players[turn] ? legalIndices(players[turn].hand) : []; },
      get canDraw() { return canDraw(); },
      get roundWinner() { return roundWinner >= 0 ? players[roundWinner].name : null; },
      get matchWinner() { return matchWinner >= 0 ? players[matchWinner].name : null; },
      get lastClose() { return lastClose; },
      get baked() { return BAKED; },
      /**
       * A point that actually lands on card i — the middle of the sliver it
       * shows, not the middle of the card, most of which is under its
       * neighbour. Returning the centre made a play script tap card 0 and
       * select card 1 forever.
       */
      handXY(i) {
        const n = players[turn] ? players[turn].hand.length : 0;
        const s = fanSlot(i, n);
        const lift = i === selected ? 30 : 0;
        if (i >= n - 1) return { x: s.x, y: s.y - lift };
        const nx = fanSlot(i + 1, n);
        const gap = Math.hypot(nx.x - s.x, nx.y - s.y);
        const off = clamp(CARD_W * HAND_S / 2 - gap / 2, 0, CARD_W * HAND_S / 2 - 6);
        return { x: s.x - Math.cos(s.a) * off, y: s.y - lift - Math.sin(s.a) * off };
      },
      stockXY() { return { x: L.stock.x, y: L.stock.y }; },
      passXY() { return { x: L.pass.x, y: L.pass.y }; },
    };
    ctx.onDestroy(() => { try { delete window.__EIGHTS__; } catch (_) {} });

    // The table and the title fan are on screen before ready() is called, so
    // the host never shows a blank bit for a single frame.
    render(performance.now());
    ctx.markVisualReady("table drawn");
    ctx.platform.ready();
  },
};
