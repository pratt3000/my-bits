/**
 * Speed — two players, one phone, no turns at all.
 *
 * The phone lies flat between two people and both of them play at the same
 * time, as fast as they can, onto the same two centre piles. Nobody waits for
 * anybody. That makes it the purest thing on a shared screen in this repo:
 * every other card game here has to solve hidden hands and pass-the-phone, and
 * Speed simply does not have the problem — both hands are face up, because
 * both players need to see their own cards and neither can use the other's.
 *
 * The whole design question is therefore reach and identity rather than
 * secrecy. Each player's hand lies along their own edge, rotated to face them,
 * and their draw pile sits at their own end. The two centre piles are shared
 * and sit dead in the middle, equidistant, so neither player has a shorter
 * journey to them.
 *
 * Every pointer is bound to a half of the table on pointerdown for that
 * pointer's whole life, so a hand that strays across the middle cannot start
 * playing the opponent's cards.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so all 52 faces and the
 * back are drawn with canvas paths and baked once into OffscreenCanvases. The
 * overlay is markup on ctx.createRoot() with pointer-events off on the root,
 * because that element sits above the canvas and would otherwise swallow every
 * tap. Pointer maths uses offsetX/offsetY, never getBoundingClientRect.
 */
window.plethoraBit = {
  meta: {
    title: "Speed",
    runtime: "plethora-bit@2",
    tags: ["cards", "multiplayer", "local-multiplayer", "two-player", "fast"],
    permissions: ["backgroundMusic", "haptics", "storage"],
  },

  async init(ctx) {
    /* ---- The 52-card deck, lifted verbatim from tools/kit/kit.js so every
     * card bit in this repo draws exactly the same cards. ---- */
    function roundRect(g, x, y, w, h, r) {
      const k = Math.min(r, w / 2, h / 2);
      g.beginPath();
      g.moveTo(x + k, y);
      g.arcTo(x + w, y,     x + w, y + h, k);
      g.arcTo(x + w, y + h, x,     y + h, k);
      g.arcTo(x,     y + h, x,     y,     k);
      g.arcTo(x,     y,     x + w, y,     k);
      g.closePath();
    }

    /**
     * A soft shadow without the canvas blur filter.
     *
     * Writing ctx.filter = "blur(...)" is rejected at upload: the property also
     * accepts url(#…), so the validator reads any write to it as pulling in a
     * remote resource. Stacking wide translucent strokes gets the same falloff.
     */
    function softShadow(g, pathFn, { spread = 18, alpha = 0.05, step = 2.5 } = {}) {
      g.save();
      g.lineJoin = "round";
      g.lineCap = "round";
      g.strokeStyle = `rgba(0,0,0,${alpha})`;
      for (let w = spread; w >= 2; w -= step) {
        g.lineWidth = w;
        pathFn(g);
        g.stroke();
      }
      g.restore();
    }

    /** Offscreen surface for baking sprites. Never document.createElement("canvas"). */
    function makeSurface(w, h) {
      if (typeof OffscreenCanvas === "undefined") return null;   // older WebViews: draw live
      return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    }

    /* ---------------------------------------------------------------------
     * PLAYING CARDS — a full 52-card deck drawn procedurally.
     *
     * Packaged assets are disabled (maxAssets: 0), so pips and courts are
     * canvas paths. Each face is baked once to an OffscreenCanvas and then
     * blitted, which keeps a hand of twelve cards to twelve drawImage calls.
     * ------------------------------------------------------------------- */
    const SUITS = [
      { id: "S", name: "spades",   colour: "#1b1b22", red: false },
      { id: "H", name: "hearts",   colour: "#c8202f", red: true  },
      { id: "D", name: "diamonds", colour: "#c8202f", red: true  },
      { id: "C", name: "clubs",    colour: "#1b1b22", red: false },
    ];
    const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

    /** Suit glyph as a canvas path, unit-scaled to roughly [-1,1]. */
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
      } else {                                              // clubs
        g.arc(0, -0.42, 0.38, 0, Math.PI * 2);
        g.closePath(); g.moveTo(-0.28, 0.22);
        g.arc(-0.42, 0.16, 0.38, 0, Math.PI * 2);
        g.closePath(); g.moveTo(0.8, 0.16);
        g.arc(0.42, 0.16, 0.38, 0, Math.PI * 2);
        g.closePath();
        g.moveTo(0.09, 0.2); g.lineTo(0.3, 0.95); g.lineTo(-0.3, 0.95); g.lineTo(-0.09, 0.2);
      }
      g.closePath();
      g.fill();
      g.restore();
    }

    /** Pip layout per rank, in card-relative units where x,y are in [-1,1]. */
    const PIPS = {
      A:  [[0, 0]],
      2:  [[0, -0.62], [0, 0.62]],
      3:  [[0, -0.62], [0, 0], [0, 0.62]],
      4:  [[-0.5, -0.62], [0.5, -0.62], [-0.5, 0.62], [0.5, 0.62]],
      5:  [[-0.5, -0.62], [0.5, -0.62], [0, 0], [-0.5, 0.62], [0.5, 0.62]],
      6:  [[-0.5, -0.62], [0.5, -0.62], [-0.5, 0], [0.5, 0], [-0.5, 0.62], [0.5, 0.62]],
      7:  [[-0.5, -0.62], [0.5, -0.62], [0, -0.31], [-0.5, 0], [0.5, 0], [-0.5, 0.62], [0.5, 0.62]],
      8:  [[-0.5, -0.62], [0.5, -0.62], [0, -0.31], [-0.5, 0], [0.5, 0], [0, 0.31], [-0.5, 0.62], [0.5, 0.62]],
      9:  [[-0.5, -0.68], [0.5, -0.68], [-0.5, -0.23], [0.5, -0.23], [0, 0],
           [-0.5, 0.23], [0.5, 0.23], [-0.5, 0.68], [0.5, 0.68]],
      10: [[-0.5, -0.68], [0.5, -0.68], [0, -0.45], [-0.5, -0.23], [0.5, -0.23],
           [-0.5, 0.23], [0.5, 0.23], [0, 0.45], [-0.5, 0.68], [0.5, 0.68]],
    };

    /**
     * Bake one card face. Returns an OffscreenCanvas ready to blit, or null on a
     * WebView with no OffscreenCanvas — callers fall back to drawing live.
     */
    function bakeCard(rank, suitId, w, h, theme = {}) {
      const face = theme.face || "#fdfcf7";
      const edge = theme.edge || "rgba(24,22,30,0.16)";
      const suit = SUITS.find(s => s.id === suitId);
      const ink = suit.red ? (theme.red || "#c8202f") : (theme.black || "#1b1b22");
      const surf = makeSurface(w, h);
      if (!surf) return null;
      const g = surf.getContext("2d");
      const r = Math.min(w, h) * 0.085;

      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      g.fillStyle = face; g.fill();
      g.strokeStyle = edge; g.lineWidth = 1; g.stroke();

      // Corner index: rank over a small suit glyph, mirrored into the far corner
      // so the card reads from either end the way a real one does.
      const cs = w * 0.155;
      const corner = (flip) => {
        g.save();
        if (flip) { g.translate(w, h); g.rotate(Math.PI); }
        g.fillStyle = ink;
        g.font = `700 ${cs}px ui-serif, Georgia, serif`;
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.fillText(rank, w * 0.135, h * 0.135);
        suitPath(g, suitId, w * 0.135, h * 0.208, cs * 0.44);
        g.restore();
      };
      corner(false); corner(true);

      const cx = w * 0.5, cy = h * 0.5;
      if (PIPS[rank]) {
        // Number cards: the classic pip grid, lower pips rotated like the real
        // thing. Nine and ten pack four rows into the same panel, so they get a
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
      return surf;
    }

    /**
     * A court card.
     *
     * Real courts are mirrored half-portraits, and a literal one turns to mud at
     * the ~60px a phone gives a card. This draws a single flat heraldic figure —
     * crown, face, mantle — reading as King/Queen/Jack by its headwear, with the
     * suit colour carrying the rest.
     */
    function drawCourt(g, rank, suitId, ink, w, h) {
      const cx = w * 0.5, cy = h * 0.5;
      const iw = w * 0.66, ih = h * 0.62;
      const x0 = cx - iw / 2, y0 = cy - ih / 2;

      // Panel with a double rule, the way an engraved court is framed.
      roundRect(g, x0, y0, iw, ih, w * 0.045);
      g.fillStyle = "rgba(0,0,0,0.035)"; g.fill();
      g.strokeStyle = ink; g.lineWidth = Math.max(1, w * 0.016); g.stroke();
      roundRect(g, x0 + w * 0.028, y0 + w * 0.028, iw - w * 0.056, ih - w * 0.056, w * 0.03);
      g.strokeStyle = ink; g.lineWidth = Math.max(0.6, w * 0.007); g.stroke();

      g.save();
      roundRect(g, x0 + w * 0.028, y0 + w * 0.028, iw - w * 0.056, ih - w * 0.056, w * 0.03);
      g.clip();

      const fx = cx, fy = cy + ih * 0.02;
      const u = iw * 0.5;                                   // figure unit

      // Mantle: shoulders sweeping to the panel floor.
      g.fillStyle = ink;
      g.beginPath();
      g.moveTo(fx - u * 0.86, y0 + ih);
      g.quadraticCurveTo(fx - u * 0.74, fy + u * 0.16, fx - u * 0.30, fy + u * 0.06);
      g.lineTo(fx + u * 0.30, fy + u * 0.06);
      g.quadraticCurveTo(fx + u * 0.74, fy + u * 0.16, fx + u * 0.86, y0 + ih);
      g.closePath();
      g.fill();

      // Collar notch, so the mantle reads as cloth rather than a blob.
      g.fillStyle = "rgba(253,252,247,0.92)";
      g.beginPath();
      g.moveTo(fx - u * 0.26, fy + u * 0.07);
      g.lineTo(fx, fy + u * 0.42);
      g.lineTo(fx + u * 0.26, fy + u * 0.07);
      g.closePath();
      g.fill();

      // The suit worn on the chest, knocked out of the mantle — drawn in ink it
      // would be ink-on-ink and vanish.
      g.fillStyle = "rgba(253,252,247,0.93)";
      suitPath(g, suitId, fx, fy + u * 0.70, u * 0.38);

      // Face.
      g.fillStyle = "rgba(253,252,247,0.95)";
      g.beginPath();
      g.ellipse(fx, fy - u * 0.30, u * 0.28, u * 0.34, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = ink; g.lineWidth = Math.max(0.7, w * 0.009); g.stroke();

      // Headwear is the only thing separating the three ranks.
      g.fillStyle = ink;
      const hy = fy - u * 0.60;
      if (rank === "K") {                                   // tall crown, five points, cross
        g.beginPath();
        g.moveTo(fx - u * 0.42, hy + u * 0.20);
        g.lineTo(fx - u * 0.42, hy - u * 0.06);
        g.lineTo(fx - u * 0.21, hy + u * 0.10);
        g.lineTo(fx,            hy - u * 0.26);
        g.lineTo(fx + u * 0.21, hy + u * 0.10);
        g.lineTo(fx + u * 0.42, hy - u * 0.06);
        g.lineTo(fx + u * 0.42, hy + u * 0.20);
        g.closePath();
        g.fill();
        g.fillRect(fx - u * 0.05, hy - u * 0.54, u * 0.10, u * 0.26);
        g.fillRect(fx - u * 0.17, hy - u * 0.45, u * 0.34, u * 0.09);
      } else if (rank === "Q") {                            // low coronet with pearls
        g.beginPath();
        g.moveTo(fx - u * 0.40, hy + u * 0.20);
        g.lineTo(fx - u * 0.34, hy - u * 0.10);
        g.lineTo(fx - u * 0.12, hy + u * 0.06);
        g.lineTo(fx,            hy - u * 0.16);
        g.lineTo(fx + u * 0.12, hy + u * 0.06);
        g.lineTo(fx + u * 0.34, hy - u * 0.10);
        g.lineTo(fx + u * 0.40, hy + u * 0.20);
        g.closePath();
        g.fill();
        for (const px of [-0.34, 0, 0.34]) {
          g.beginPath(); g.arc(fx + u * px, hy - u * 0.16, u * 0.065, 0, Math.PI * 2); g.fill();
        }
      } else {                                              // Jack: soft cap and feather
        g.beginPath();
        g.moveTo(fx - u * 0.38, hy + u * 0.20);
        g.quadraticCurveTo(fx - u * 0.40, hy - u * 0.20, fx + u * 0.06, hy - u * 0.20);
        g.quadraticCurveTo(fx + u * 0.40, hy - u * 0.18, fx + u * 0.38, hy + u * 0.20);
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(fx + u * 0.22, hy - u * 0.14);
        g.quadraticCurveTo(fx + u * 0.66, hy - u * 0.52, fx + u * 0.50, hy + u * 0.04);
        g.quadraticCurveTo(fx + u * 0.40, hy - u * 0.12, fx + u * 0.22, hy - u * 0.14);
        g.closePath();
        g.fill();
      }
      g.restore();
    }

    /** Bake the card back — a woven guilloché in one accent colour. */
    function bakeCardBack(w, h, accent = "#2f4d8a") {
      const surf = makeSurface(w, h);
      if (!surf) return null;
      const g = surf.getContext("2d");
      const r = Math.min(w, h) * 0.085;
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      g.fillStyle = accent; g.fill();
      g.save();
      roundRect(g, w * 0.055, h * 0.04, w * 0.89, h * 0.92, r * 0.7);
      g.clip();
      g.strokeStyle = "rgba(255,255,255,0.17)";
      g.lineWidth = Math.max(0.7, w * 0.012);
      const step = w * 0.13;
      for (let i = -h; i < w + h; i += step) {          // lattice
        g.beginPath(); g.moveTo(i, 0);      g.lineTo(i + h, h); g.stroke();
        g.beginPath(); g.moveTo(i + h, 0);  g.lineTo(i, h);     g.stroke();
      }
      g.restore();
      roundRect(g, w * 0.055, h * 0.04, w * 0.89, h * 0.92, r * 0.7);
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = Math.max(1, w * 0.018); g.stroke();
      roundRect(g, 0.5, 0.5, w - 1, h - 1, r);
      g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1; g.stroke();
      return surf;
    }

    /** Bake all 52 faces plus the back once, then blit for the rest of the run. */
    function makeDeckArt(w, h, theme) {
      const faces = {};
      for (const s of SUITS) for (const r of RANKS) faces[r + s.id] = bakeCard(r, s.id, w, h, theme);
      return { faces, back: bakeCardBack(w, h, theme && theme.accent), w, h };
    }

    /** A shuffled 52-card deck. Pass a seeded rng for reproducible tests. */
    function freshDeck(rng = Math.random) {
      const d = [];
      for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s.id, red: s.red, id: r + s.id });
      for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
      }
      return d;
    }

    /** Deterministic rng so a harness run can replay an exact deal. */
    function makeRng(seed) {
      let s = seed >>> 0 || 1;
      return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5;  s >>>= 0;
        return s / 4294967296;
      };
    }


    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const TAU = Math.PI * 2;
    const RANK_VALUE = {};
    RANKS.forEach((r, i) => { RANK_VALUE[r] = i; });      // A=0 … K=12

    /**
     * Legal if the rank is one step from the pile's top, in either
     * direction, with the wrap closed at both ends — Ace sits next to
     * both the King and the two, which is the rule that keeps the game
     * from deadlocking on a King.
     */
    function playsOn(card, top) {
      if (!top) return false;
      const d = Math.abs(RANK_VALUE[card.rank] - RANK_VALUE[top.rank]);
      return d === 1 || d === 12;
    }

    /* ---------------------------------------------------------------
     * Settings and sound
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("speed") || {}; } catch (_) { return {}; }
    })();
    const settings = { hand: saved.hand || 5, mute: !!saved.mute };
    function saveSettings() { try { ctx.storage.set("speed", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "arcade", volume: 0.28, tempo: 132, intensity: 0.4 });
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
          muted = !muted; settings.mute = muted; saveSettings();
          try {
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 220 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ---------------------------------------------------------------
     * Layout. Both hands lie along their owner's own edge and the two
     * centre piles sit dead in the middle, equidistant, so neither
     * player has a shorter reach to them than the other.
     * ------------------------------------------------------------- */
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      L.cw = Math.min(66, (W - 30) / 5.6);
      L.ch = L.cw * 1.4;
      L.midY = H / 2;
      L.centreGap = L.cw * 0.62;
      L.centreX = [W / 2 - L.cw / 2 - L.centreGap / 2, W / 2 + L.cw / 2 + L.centreGap / 2];
      L.sideX = [L.cw * 0.62, W - L.cw * 0.62];
      // Hand rows sit inside the safe area at each end; the draw pile sits
      // outboard of the hand at that player's own corner.
      L.handY = { p1: H - ctx.safeArea.bottom - L.ch * 0.62 - 14,
                  p2: ctx.safeArea.top + L.ch * 0.62 + 14 };
      L.drawY = { p1: L.handY.p1 - L.ch * 0.92, p2: L.handY.p2 + L.ch * 0.92 };
    }
    measure();

    /** Where a hand card sits, given how many are in the hand. */
    function handSlot(who, i, n) {
      const span = Math.min(W - 24, n * (L.cw + 6));
      const x0 = W / 2 - span / 2 + (span / Math.max(n, 1)) / 2;
      return { x: x0 + i * (span / Math.max(n, 1)), y: L.handY[who] };
    }

    /* ---------------------------------------------------------------
     * State
     * ------------------------------------------------------------- */
    const P = {
      p1: { ink: "#33d6ff", css: "#33d6ff", name: "Blue" },
      p2: { ink: "#ff7ad9", css: "#ff7ad9", name: "Pink" },
    };
    // flying starts empty rather than undefined: the frame loop runs from boot,
    // before any deal, and it walks this list every frame.
    let hands = null, draws = null, sides = null, centre = null;
    let flying = [], phase = "menu", winner = null;
    let startedAt = 0, stuckSince = 0, lastPlayAt = 0;

    function deal() {
      const d = freshDeck();
      hands = { p1: d.splice(0, settings.hand), p2: d.splice(0, settings.hand) };
      // Whatever is left after two hands and two side stacks becomes the two
      // draw piles, split evenly — so the deal works for any hand size.
      const sideCount = 6;
      sides = [d.splice(0, sideCount), d.splice(0, sideCount)];
      const half = Math.floor(d.length / 2);
      draws = { p1: d.splice(0, half), p2: d };
      // The centres are STACKS, not single cards. Keeping only the top would
      // throw away every card played, and then there is nothing to recycle
      // when the side stacks run out — the game deadlocks with no way back.
      centre = [[sides[0].pop()], [sides[1].pop()]];
      flying = [];
      winner = null;
      startedAt = performance.now();
      stuckSince = 0;
      lastPlayAt = performance.now();
      phase = "play";
    }

    /** Top up a hand from that player's own draw pile. */
    function refill(who) {
      while (hands[who].length < settings.hand && draws[who].length) {
        hands[who].push(draws[who].pop());
      }
    }

    /** The face-up card on a centre stack. */
    const top = (i) => centre[i][centre[i].length - 1];
    const anyLegal = (who) =>
      hands[who].some((c) => playsOn(c, top(0)) || playsOn(c, top(1)));

    /** Nobody can move and nobody can draw — the game needs new centres. */
    function isStuck() {
      if (phase !== "play") return false;
      for (const who of ["p1", "p2"]) {
        if (anyLegal(who)) return false;
        if (hands[who].length < settings.hand && draws[who].length) return false;
      }
      return true;
    }

    function flipCentres() {
      if (!sides[0].length || !sides[1].length) {
        // Out of replacements. Gather everything buried under the two face-up
        // cards, shuffle it, and split it into fresh side stacks — the same
        // thing you do at a table when the spare piles run out.
        const pool = centre[0].slice(0, -1).concat(centre[1].slice(0, -1));
        centre = [[top(0)], [top(1)]];
        if (pool.length < 2) return;                 // genuinely nothing left
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const half = Math.ceil(pool.length / 2);
        sides = [pool.slice(0, half), pool.slice(half)];
      }
      centre[0].push(sides[0].pop());
      centre[1].push(sides[1].pop());
      stuckSince = 0;
      sound.sting("powerup");
      sound.haptic("medium");
      shake = 0.016;
    }

    /* ---------------------------------------------------------------
     * Rendering
     * ------------------------------------------------------------- */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    let art = null, shake = 0, feltCanvas = null;

    function bakeFelt() {
      const c = makeSurface(W, H);
      if (!c) return null;
      const q = c.getContext("2d");
      const grad = q.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.72);
      grad.addColorStop(0, "#15503a");
      grad.addColorStop(0.62, "#0d3527");
      grad.addColorStop(1, "#06170f");
      q.fillStyle = grad;
      q.fillRect(0, 0, W, H);
      // Felt weave: a fine two-way speckle so the table has a surface under
      // the light rather than being a flat fill.
      q.globalAlpha = 0.05;
      for (let i = 0; i < 5200; i++) {
        q.fillStyle = Math.random() < 0.5 ? "#ffffff" : "#000000";
        q.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
      }
      q.globalAlpha = 1;
      // The centre line, so the two halves read as two halves.
      q.strokeStyle = "rgba(190,240,215,0.10)";
      q.lineWidth = 1.5;
      q.setLineDash([10, 9]);
      q.beginPath(); q.moveTo(0, H / 2); q.lineTo(W, H / 2); q.stroke();
      return c;
    }

    function rebuildArt() {
      art = makeDeckArt(Math.round(L.cw * 2), Math.round(L.ch * 2), { accent: "#1d5f8f" });
      feltCanvas = bakeFelt();
    }
    rebuildArt();

    /** One card, centred on (x,y), optionally rotated and face down. */
    function drawCard(card, x, y, { rot = 0, face = true, lift = 0, glow = null } = {}) {
      const w = L.cw, h = L.ch;
      g.save();
      g.translate(x, y + -lift);
      if (rot) g.rotate(rot);
      softShadow(g, (q) => roundRect(q, -w / 2, -h / 2, w, h, w * 0.09),
                 { spread: 9 + lift * 0.5, alpha: 0.055 });
      if (glow) {
        g.save();
        g.lineJoin = "round";
        for (let s = 13; s >= 2; s -= 2.4) {
          g.strokeStyle = glow + (0.13 * (1 - s / 13) + 0.03).toFixed(3) + ")";
          g.lineWidth = s;
          roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
          g.stroke();
        }
        g.restore();
      }
      const img = face ? (art && art.faces[card.id]) : (art && art.back);
      if (img) g.drawImage(img, -w / 2, -h / 2, w, h);
      else {
        // No OffscreenCanvas: plain rectangles with the rank, fully playable.
        roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
        g.fillStyle = face ? "#fdfcf7" : "#1d5f8f";
        g.fill();
        if (face) {
          g.fillStyle = card.red ? "#c8202f" : "#1b1b22";
          g.font = "700 " + (w * 0.42) + "px ui-serif, Georgia, serif";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(card.rank, 0, 0);
        }
      }
      g.restore();
    }

    function drawPile(list, x, y, rot) {
      const n = Math.min(list.length, 5);
      for (let i = 0; i < n; i++) {
        drawCard(list[list.length - 1 - i], x + i * 0.9, y - i * 0.9, { rot, face: false });
      }
      if (list.length) {
        g.save();
        g.translate(x, y);
        if (rot) g.rotate(rot);
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.font = "800 " + (L.cw * 0.30) + "px -apple-system, system-ui, sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(list.length), 0, 0);
        g.restore();
      }
    }

    function paint() {
      g.save();
      if (shake > 0.0005) {
        g.translate((Math.random() - 0.5) * shake * W, (Math.random() - 0.5) * shake * W);
      }
      if (feltCanvas) g.drawImage(feltCanvas, 0, 0, W, H);
      else { g.fillStyle = "#0d3527"; g.fillRect(0, 0, W, H); }

      if (phase !== "menu") {
        // Side stacks, then the two shared centre piles.
        drawPile(sides[0], L.sideX[0], L.midY, 0);
        drawPile(sides[1], L.sideX[1], L.midY, 0);
        for (let i = 0; i < 2; i++) {
          // A couple of cards of the buried stack peek out, so the middle
          // reads as a growing pile rather than a single floating card.
          const st = centre[i];
          for (let k = Math.max(0, st.length - 3); k < st.length - 1; k++) {
            drawCard(st[k], L.centreX[i] + (st.length - 1 - k) * 1.2,
                     L.midY - (st.length - 1 - k) * 1.2, { face: false });
          }
          if (st.length) drawCard(st[st.length - 1], L.centreX[i], L.midY, {});
        }

        for (const who of ["p1", "p2"]) {
          const rot = who === "p2" ? Math.PI : 0;
          const dx = who === "p1" ? W - L.cw * 0.72 : L.cw * 0.72;
          drawPile(draws[who], dx, L.drawY[who], rot);
          const n = hands[who].length;
          for (let i = 0; i < n; i++) {
            const s = handSlot(who, i, n);
            const card = hands[who][i];
            const live = playsOn(card, top(0)) || playsOn(card, top(1));
            drawCard(card, s.x, s.y, {
              rot,
              lift: live ? 7 : 0,
              glow: live ? (who === "p1" ? "rgba(51,214,255," : "rgba(255,122,217,") : null,
            });
          }
        }

        // Cards in flight, drawn last so they pass over everything.
        for (const f of flying) {
          const t = 1 - Math.pow(1 - f.t, 3);
          drawCard(f.card, f.fx + (f.tx - f.fx) * t, f.fy + (f.ty - f.fy) * t,
                   { rot: f.rot * (1 - t), lift: Math.sin(t * Math.PI) * 16 });
        }
      }
      g.restore();
    }

    /* ---------------------------------------------------------------
     * Input.
     *
     * A pointer is bound to a half of the table on pointerdown and keeps
     * that half until it lifts. Both players are reaching for the same
     * two centre piles at the same time, so without that binding a hand
     * crossing the middle would start playing its opponent's cards.
     * ------------------------------------------------------------- */
    const owners = new Map();

    function tryPlay(who, x, y) {
      const n = hands[who].length;
      let best = -1, bestD = 1e9;
      for (let i = 0; i < n; i++) {
        const s = handSlot(who, i, n);
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0 || bestD > L.cw * 0.95) return false;

      const card = hands[who][best];
      // If it fits both piles, send it to the nearer one — the player is
      // already reaching in that direction.
      const fits = [0, 1].filter((i) => playsOn(card, top(i)));
      if (!fits.length) {
        sound.sting("fail");
        sound.haptic("warning");
        return false;
      }
      const pile = fits.length === 1 ? fits[0]
        : (Math.abs(x - L.centreX[0]) <= Math.abs(x - L.centreX[1]) ? 0 : 1);

      const s = handSlot(who, best, n);
      hands[who].splice(best, 1);
      centre[pile].push(card);
      flying.push({
        card, t: 0, fx: s.x, fy: s.y, tx: L.centreX[pile], ty: L.midY,
        rot: (Math.random() - 0.5) * 0.5,
      });
      refill(who);
      lastPlayAt = performance.now();
      stuckSince = 0;
      sound.sting("tap");
      sound.haptic("light");
      ctx.platform.interact({ type: "play", who });

      if (!hands[who].length && !draws[who].length) win(who);
      return true;
    }

    ctx.listen(canvas, "pointerdown", async (e) => {
      if (phase !== "play") return;
      await sound.unlock();
      const half = e.offsetY > H / 2 ? "p1" : "p2";
      owners.set(e.pointerId, half);
      tryPlay(half, e.offsetX, e.offsetY);
      e.preventDefault();
    }, { passive: false });
    const release = (e) => owners.delete(e.pointerId);
    ctx.listen(canvas, "pointerup", release);
    ctx.listen(canvas, "pointercancel", release);

    async function win(who) {
      phase = "over";
      winner = who;
      const ms = Math.round(performance.now() - startedAt);
      el("over-title").textContent = P[who].name + " is out";
      el("over-title").style.color = P[who].css;
      el("over-line").textContent = (ms / 1000).toFixed(1) + "s";
      el("over").style.display = "flex";
      sound.duck(0.5, 420); sound.sting("win"); sound.haptic("success");
      shake = 0.03;
      ctx.platform.complete({ winner: who, ms });
      // How fast this table emptied a hand — a property of the match rather
      // than of one of the two people playing it.
      try { await ctx.memory.record("fastest_out").submit(ms); } catch (_) {}
    }

    /* ---------------------------------------------------------------
     * Overlay
     * ------------------------------------------------------------- */
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    const BIG = "width:100%;padding:15px;border:none;border-radius:16px;font-family:inherit;" +
      "font-size:16px;font-weight:800;";
    const BTN = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:none;" +
      "background:rgba(255,255,255,0.14);color:#eafff4;font-size:14px;font-family:inherit;padding:0;";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:#eafff4;pointer-events:none;";
    root.innerHTML =
      // Chrome belongs to neither player, so it goes in the dead band between
      // the top hand and the middle — not on the centre line itself, where the
      // two side stacks already live and would sit underneath it.
      '<div style="position:absolute;left:9px;top:' + Math.round(H / 2 - L.ch * 1.7) + 'px;' +
        'display:flex;flex-direction:column;gap:6px;z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">🔊</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
      '</div>' +
      '<div data-el="stuck" style="position:absolute;left:0;right:0;top:50%;' +
        'transform:translateY(-50%);text-align:center;pointer-events:none;font-size:12px;' +
        'letter-spacing:0.24em;text-transform:uppercase;opacity:0;color:#bff0d8;">both stuck — flipping</div>' +
      // Title, with a start button at BOTH ends: either player should be able
      // to begin, and the far one reads theirs the right way up.
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:space-between;' +
        'background:rgba(4,18,12,0.9);z-index:50;padding:' + (ST + 16) + 'px 22px ' + (SB + 16) + 'px;">' +
        '<button data-el="go2" style="' + BIG + 'max-width:230px;transform:rotate(180deg);' +
          'background:' + P.p2.css + ';color:#0b1c16;">Deal</button>' +
        '<div style="text-align:center;">' +
          '<div style="font-size:11px;letter-spacing:0.4em;text-transform:uppercase;opacity:0.5;">No turns</div>' +
          '<div style="font-size:60px;font-weight:900;letter-spacing:-0.03em;line-height:1.05;' +
            'background:linear-gradient(96deg,' + P.p1.css + ',' + P.p2.css + ');' +
            '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">Speed</div>' +
          '<div style="font-size:14.5px;opacity:0.64;line-height:1.55;max-width:260px;margin:10px auto 0;">' +
            'Phone flat, a hand each. Play a card one step above or below either middle pile — ' +
            'both of you at once, as fast as you can.</div>' +
        '</div>' +
        '<button data-el="go1" style="' + BIG + 'max-width:230px;background:' + P.p1.css + ';' +
          'color:#0b1c16;">Deal</button>' +
      '</div>' +
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'flex-direction:column;align-items:center;justify-content:space-between;' +
        'background:rgba(4,18,12,0.92);z-index:55;padding:' + (ST + 16) + 'px 22px ' + (SB + 16) + 'px;">' +
        '<button data-el="again2" style="' + BIG + 'max-width:230px;transform:rotate(180deg);' +
          'background:rgba(255,255,255,0.16);color:#eafff4;">Again</button>' +
        '<div style="text-align:center;">' +
          '<div data-el="over-title" style="font-size:40px;font-weight:900;"></div>' +
          '<div data-el="over-line" style="font-size:15px;opacity:0.6;margin-top:4px;"></div>' +
        '</div>' +
        '<button data-el="again1" style="' + BIG + 'max-width:230px;' +
          'background:rgba(255,255,255,0.16);color:#eafff4;">Again</button>' +
      '</div>' +
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(4,18,12,0.94);z-index:70;padding:24px;">' +
        '<div style="max-width:320px;width:100%;background:rgba(11,40,29,0.98);border-radius:22px;' +
          'padding:22px;border:1px solid rgba(255,255,255,0.10);">' +
          '<div style="font-size:19px;font-weight:800;margin-bottom:11px;">How to play</div>' +
          '<ul style="font-size:14px;line-height:1.72;opacity:0.86;padding-left:18px;margin:0;">' +
            '<li>Phone flat between you. Your five cards lie along your own edge.</li>' +
            '<li><b>There are no turns.</b> Both of you play at the same time, as fast as you can.</li>' +
            '<li>Play a card one rank above or below either middle pile. Aces sit next to both kings and twos.</li>' +
            '<li>Your playable cards lift and glow, so you never have to work it out.</li>' +
            '<li>Your hand refills from your own pile automatically.</li>' +
            '<li>If neither of you can move, the middle flips by itself.</li>' +
            '<li>First to empty their hand <i>and</i> their pile wins.</li>' +
          '</ul>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:17px;' +
            'background:rgba(255,255,255,0.14);color:#eafff4;">Got it</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };
    tap(el("mute"), (e) => { e.target.textContent = sound.toggle() ? "🔇" : "🔊"; });
    if (settings.mute) el("mute").textContent = "🔇";
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });

    const start = async () => {
      ctx.platform.start();
      await sound.unlock();
      el("menu").style.display = "none";
      el("over").style.display = "none";
      deal();
      sound.sting("coin");
    };
    tap(el("go1"), start);
    tap(el("go2"), start);
    tap(el("again1"), start);
    tap(el("again2"), start);

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    ctx.onFrame((dtMs) => {
      const dt = Math.min(dtMs, 50) / 1000;
      if (shake > 0.0004) shake *= Math.pow(0.004, dt);

      for (let i = flying.length - 1; i >= 0; i--) {
        flying[i].t += dt / 0.17;
        if (flying[i].t >= 1) flying.splice(i, 1);
      }

      if (phase === "play") {
        // The deadlock resolves itself after a beat rather than making two
        // people agree that they are both stuck.
        if (isStuck()) {
          if (!stuckSince) stuckSince = performance.now();
          const held = performance.now() - stuckSince;
          el("stuck").style.opacity = String(Math.min(held / 500, 0.75));
          if (held > 900) { flipCentres(); el("stuck").style.opacity = "0"; }
        } else if (stuckSince) {
          stuckSince = 0;
          el("stuck").style.opacity = "0";
        }
        // The bed tightens as hands empty, so the endgame sounds like one.
        const left = hands.p1.length + draws.p1.length + hands.p2.length + draws.p2.length;
        sound.heat(1 - left / 46);
      }

      paint();
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      rebuildArt();
    });

    // A read-only window for the local harness.
    window.__SPEED__ = {
      get phase() { return phase; },
      get winner() { return winner; },
      get hands() { return { p1: hands ? hands.p1.map((c) => c.id) : [], p2: hands ? hands.p2.map((c) => c.id) : [] }; },
      get centre() { return centre ? centre.map((st) => st.length && st[st.length - 1].id) : []; },
      get counts() { return { p1: draws ? draws.p1.length : 0, p2: draws ? draws.p2.length : 0 }; },
      get busy() { return flying.length > 0; },
      handXY: (who, i) => handSlot(who, i, hands[who].length),
      legalIndex: (who) => hands[who].findIndex((c) => playsOn(c, top(0)) || playsOn(c, top(1))),
    };
    ctx.onDestroy(() => { try { delete window.__SPEED__; } catch (_) {} });

    paint();
    ctx.markVisualReady("table dealt");
    ctx.platform.ready();
  },
};
