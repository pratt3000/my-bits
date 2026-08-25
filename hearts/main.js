/**
 * Hearts — the full game for exactly four people and one phone.
 *
 * Hearts is a game about ducking. Every heart is a point, the queen of spades
 * is thirteen, and points are the thing you do not want — except when you want
 * all of them at once, which flips twenty-six onto everybody else. The rules
 * that make it Hearts are the awkward ones: the two of clubs is a forced lead,
 * nothing that scores may be played on the very first trick, hearts may not be
 * LED until somebody has already been forced to discard one, and taking every
 * single point is the best hand in the game rather than the worst.
 *
 * On one phone the design problem is that a hand of thirteen cards is secret
 * and the trick in the middle is not. This bit solves it without ever covering
 * the screen: the table — the ring of seats, the four running scores, the cards
 * already thrown — is public and stays on screen the whole time, and the hand
 * is simply NOT DRAWN until the person named on the handoff panel taps to
 * reveal it. The phone travels showing the public table; the secret exists only
 * between one tap and that player's own commit, and their hand slides back off
 * the bottom of the screen the instant they play. Nothing has to be held down,
 * which matters here because the revealed screen is the one you have to tap.
 *
 * The seat ring is drawn RELATIVE to whoever is holding the phone: you are
 * always at the bottom, the player on your left is on the screen's left, across
 * is across. That is both what every card table looks like from your own chair
 * and what makes "pass three to the left" unambiguous. Cards thrown into the
 * middle are rotated to the seat that threw them, so the player opposite you
 * lands theirs upside down exactly as they would on a real table, and each
 * seat's nameplate is turned to face its own chair.
 *
 * The rules engine sits between the RULES markers and knows nothing about
 * drawing, so tools/harness/rules-hearts.mjs can lift it straight out of this
 * file and test the shipped code rather than a copy of it.
 *
 * Contract notes: no packaged assets (maxAssets is 0), so all 52 faces are
 * canvas paths baked into OffscreenCanvases with a live-draw fallback. The
 * overlay is one markup string on ctx.createRoot() with pointer-events off on
 * the root, because that element sits above the canvas and would otherwise
 * swallow every tap. Pointer maths uses offsetX/offsetY, never
 * getBoundingClientRect, and every timer is anchored to a performance.now()
 * timestamp rather than accumulated from frame deltas.
 */
window.plethoraBit = {
  meta: {
    title: "Hearts",
    runtime: "plethora-bit@2",
    tags: ["cards", "multiplayer", "local-multiplayer", "trick-taking", "classic"],
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


/* ===== RULES START ===== */
    /**
     * Hearts, complete, and deliberately free of anything to do with drawing.
     *
     * Everything awkward about the game lives in legalMoves: the forced opening
     * lead, the ban on points during the first trick, the ban on LEADING hearts
     * before they are broken, and the two "unless that is all you have left"
     * escapes that keep those bans from ever making a hand unplayable.
     */
    const HEART = "H";
    const QUEEN_OF_SPADES = "QS";
    const TWO_OF_CLUBS = "2C";
    const ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
    const rankOf = (c) => ORDER.indexOf(c.rank);

    /** Every heart is one, the black lady is thirteen, everything else is free. */
    function cardPoints(c) {
      if (c.suit === HEART) return 1;
      if (c.id === QUEEN_OF_SPADES) return 13;
      return 0;
    }

    /** Left, right, across, hold — and then round again from the top. */
    const PASS_CYCLE = ["left", "right", "across", "hold"];
    const passDirFor = (handNo) => PASS_CYCLE[(handNo - 1) % 4];
    function passTarget(seat, dir) {
      if (dir === "left") return (seat + 1) % 4;
      if (dir === "right") return (seat + 3) % 4;
      if (dir === "across") return (seat + 2) % 4;
      return seat;
    }

    /** A fresh hand of thirteen tricks. `deal` is four arrays of thirteen. */
    function newHand(deal, handNo) {
      return {
        handNo,
        hands: deal.map((h) => h.slice()),
        taken: [[], [], [], []],
        trick: [],                 // { seat, card } in the order they were thrown
        trickNo: 0,
        leader: -1,
        turn: -1,
        heartsBroken: false,
        lastTrick: null,
      };
    }

    /** Whoever holds the two of clubs leads, and must lead exactly that card. */
    function openingLeader(st) {
      for (let s = 0; s < 4; s++) {
        if (st.hands[s].some((c) => c.id === TWO_OF_CLUBS)) return s;
      }
      return 0;
    }

    /**
     * Everything this seat is allowed to play right now.
     *
     * Leading: the very first trick is the two of clubs and nothing else. After
     * that hearts are off the table until they are broken — unless hearts are
     * literally all that is left in the hand, in which case they may be led.
     *
     * Following: you must follow the led suit if you hold it. On the first
     * trick nothing that scores may be played, so hearts and the queen are
     * filtered out of whatever pool you were going to choose from — unless that
     * empties the pool, which can only happen to a hand made entirely of
     * points, and then they are allowed after all.
     */
    function legalMoves(st, seat) {
      const hand = st.hands[seat];
      const first = st.trickNo === 0;
      if (!st.trick.length) {
        if (first) return hand.filter((c) => c.id === TWO_OF_CLUBS);
        if (!st.heartsBroken) {
          const other = hand.filter((c) => c.suit !== HEART);
          return other.length ? other : hand.slice();
        }
        return hand.slice();
      }
      const led = st.trick[0].card.suit;
      const follow = hand.filter((c) => c.suit === led);
      const pool = follow.length ? follow : hand.slice();
      if (first) {
        const clean = pool.filter((c) => cardPoints(c) === 0);
        return clean.length ? clean : pool;
      }
      return pool;
    }
    const isLegal = (st, seat, id) => legalMoves(st, seat).some((c) => c.id === id);

    /** The highest card of the suit that was LED takes it. Nothing trumps. */
    function trickWinner(trick) {
      const led = trick[0].card.suit;
      let best = trick[0];
      for (const p of trick) {
        if (p.card.suit === led && rankOf(p.card) > rankOf(best.card)) best = p;
      }
      return best.seat;
    }

    /**
     * Play one card. The state change lands immediately and the report says
     * what just happened, so the caller animates afterwards and never has to
     * decide anything about the rules itself.
     */
    function playCard(st, seat, id) {
      if (st.turn !== seat) return null;
      if (!isLegal(st, seat, id)) return null;
      const i = st.hands[seat].findIndex((c) => c.id === id);
      const card = st.hands[seat].splice(i, 1)[0];
      st.trick.push({ seat, card });
      // A heart on the table is a broken heart, however it got there.
      if (card.suit === HEART) st.heartsBroken = true;
      const out = {
        card, seat, queen: card.id === QUEEN_OF_SPADES,
        trickDone: false, winner: -1, points: 0, handDone: false,
      };
      if (st.trick.length < 4) {
        st.turn = (seat + 1) % 4;
        return out;
      }
      const w = trickWinner(st.trick);
      const pts = st.trick.reduce((a, p) => a + cardPoints(p.card), 0);
      for (const p of st.trick) st.taken[w].push(p.card);
      out.trickDone = true;
      out.winner = w;
      out.points = pts;
      st.lastTrick = { cards: st.trick.slice(), winner: w, points: pts };
      st.trick = [];
      st.trickNo++;
      st.leader = w;
      st.turn = w;
      if (st.trickNo === 13) { out.handDone = true; st.turn = -1; }
      return out;
    }

    /**
     * Score the hand, moon included.
     *
     * Twenty-six is only reachable by holding every heart AND the queen — the
     * queen alone with twelve hearts is twenty-five, thirteen hearts without
     * her is thirteen — so a twenty-six IS a shot moon and needs no separate
     * test. The shooter takes nothing and everybody else takes the lot.
     */
    function scoreHand(st) {
      const raw = st.taken.map((pile) => pile.reduce((a, c) => a + cardPoints(c), 0));
      const shooter = raw.findIndex((v) => v === 26);
      if (shooter < 0) return { pts: raw, shooter: -1 };
      return { pts: raw.map((_, i) => (i === shooter ? 0 : 26)), shooter };
    }

    /** The game stops the moment anybody reaches the target. Lowest wins. */
    function gameResult(totals, target) {
      if (!totals.some((t) => t >= target)) return null;
      const low = Math.min.apply(null, totals);
      const winners = [];
      for (let i = 0; i < 4; i++) if (totals[i] === low) winners.push(i);
      return { winners, low };
    }
/* ===== RULES END ===== */

    /* ---------------------------------------------------------------
     * Palette. A card room: baize, brass, ivory, and one crimson kept
     * in reserve for the only card in the deck that is worth thirteen.
     * ------------------------------------------------------------- */
    const BAIZE_HI = "#15553D", BAIZE = "#0B3A29", BAIZE_LO = "#04170F";
    const BRASS = "#C9A227", BRASS_HI = "#F0DA96", BRASS_LO = "#6E5711";
    const IVORY = "#F2E9D2", INK = "#071A13";
    const CRIMSON = "#C2263B", CRIMSON_HI = "#F0576B";
    const SEAT_COLOUR = ["#F0C75A", "#E9776A", "#7FCFAE", "#9CB8EE"];
    const DEFAULT_NAMES = ["Ada", "Bo", "Cy", "Dee"];
    const SUIT_DISPLAY = ["C", "D", "S", "H"];
    const SUIT_WORD = { C: "clubs", D: "diamonds", S: "spades", H: "hearts" };

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const esc = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
    const ease = (p) => 1 - Math.pow(1 - p, 3);
    const now = () => performance.now();

    /** Display order: clubs, diamonds, spades, hearts — colours alternating. */
    const sortHand = (h) => h.sort((a, b) =>
      (SUIT_DISPLAY.indexOf(a.suit) - SUIT_DISPLAY.indexOf(b.suit)) || (rankOf(a) - rankOf(b)));

    /* ---------------------------------------------------------------
     * Settings and sound
     * ------------------------------------------------------------- */
    const saved = (function () {
      try { return ctx.storage.get("hearts") || {}; } catch (_) { return {}; }
    })();
    const settings = {
      target: [50, 100, 150].indexOf(saved.target) >= 0 ? saved.target : 100,
      names: Array.isArray(saved.names) && saved.names.length === 4
        ? saved.names.map((s, i) => String(s || DEFAULT_NAMES[i]).slice(0, 8))
        : DEFAULT_NAMES.slice(),
      hints: saved.hints !== false,
      mute: !!saved.mute,
    };
    function saveSettings() { try { ctx.storage.set("hearts", settings); } catch (_) {} }

    const sound = (function () {
      let muted = settings.mute, bed = null, unlocked = false;
      const start = () => ctx.music.play({ preset: "lofi", volume: 0.24, tempo: 84, intensity: 0.26 });
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
            if (muted) { (bed || ctx.music).stop({ fadeOutMs: 240 }); bed = null; }
            else if (unlocked) bed = start();
          } catch (_) {}
          return muted;
        },
      };
    })();

    /* ---------------------------------------------------------------
     * Layout.
     *
     * The seat ring is inscribed around the middle of the table and the
     * hand fans across the bottom. Nothing lives in the side margins:
     * a 390px screen leaves seven pixels beside a full-width board, so
     * the chrome sits in the strip above the ring instead.
     * ------------------------------------------------------------- */
    const ST = ctx.safeArea.top, SB = ctx.safeArea.bottom;
    let W = ctx.width, H = ctx.height;
    const L = {};
    function measure() {
      W = ctx.width; H = ctx.height;
      L.cx = W / 2;
      L.cw = Math.min(70, (W - 104) / 4.1);          // hand card
      L.ch = L.cw * 1.4;
      L.tw = L.cw * 0.8;                             // thrown card
      L.th = L.tw * 1.4;
      L.handY = H - SB - L.ch * 0.62 - 18;
      L.top = ST + 8;
      L.bot = L.handY - L.ch / 2 - 16;
      L.cy = L.top + (L.bot - L.top) * 0.565;
      L.R = Math.min(150, (L.bot - L.top) / 2 - 26);
      L.throwY = L.th * 0.8;
      L.throwX = L.tw * 0.97 + L.th * 0.06;
      L.promptY = L.cy + L.R + 44;
      L.panelTop = L.promptY + 8;
      L.panelBot = H - SB - 14;
    }
    measure();

    /** Where the hand cards sit — the sliver of each is enough to read. */
    function handSlot(i, n, t, lift) {
      const step = n > 1 ? Math.min(L.cw * 0.62, (W - 108) / (n - 1)) : 0;
      const span = step * (n - 1);
      const ang = (i - (n - 1) / 2) * 0.05;
      let y = L.handY + (1 - Math.cos(ang)) * 150 - (lift || 0);
      y += handOffset(i, t);
      return { x: L.cx - span / 2 + i * step, y, rot: ang };
    }

    /**
     * The hand slides up from below the bottom edge when its owner taps to
     * look, and drops back the instant they commit. That slide IS the privacy
     * model — the secret is on screen only between those two moments.
     */
    function handOffset(i, t) {
      if (hideAt) return ease(clamp((t - hideAt) / 220, 0, 1)) * 200;
      if (revealAt) {
        const p = clamp((t - revealAt - i * 9) / 260, 0, 1);
        return (1 - ease(p)) * 190;
      }
      return 0;
    }

    /**
     * How far a card lifts out of the fan — picked for the pass, or legal to
     * play. Three separate places measure this: the painter, the hit test and
     * the harness's tap point. They have to agree or a tap lands on a card the
     * player did not aim at, so they read it from here.
     *
     * The picked lift is what clears the pass button sitting above the fan: a
     * chosen card also carries a wide brass glow, and at the old 21px that
     * glow washed over the bottom of the button.
     */
    const LIFT_PICK = 18, LIFT_LEGAL = 13;

    /** A seat's place in the ring, relative to whoever is holding the phone. */
    const rel = (seat) => (seat - view + 4) % 4;
    const REL_ROT = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

    function plaqueSpot(r) {
      if (r === 0) return { x: L.cx, y: L.cy + L.R, rot: 0 };
      if (r === 1) return { x: L.cx - L.R, y: L.cy, rot: Math.PI / 2 };
      if (r === 2) return { x: L.cx, y: L.cy - L.R, rot: Math.PI };
      return { x: L.cx + L.R, y: L.cy, rot: -Math.PI / 2 };
    }
    function throwSpot(r) {
      if (r === 0) return { x: L.cx, y: L.cy + L.throwY };
      if (r === 1) return { x: L.cx - L.throwX, y: L.cy };
      if (r === 2) return { x: L.cx, y: L.cy - L.throwY };
      return { x: L.cx + L.throwX, y: L.cy };
    }
    /**
     * A card's resting tilt in the middle. Keyed on the card itself rather than
     * on the trick number, because the trick number ticks over the instant the
     * fourth card lands and the card in flight would then aim at one angle and
     * settle at another.
     */
    function jitter(id) {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
      return ((h % 11) - 5) * 0.014;
    }

    /* ---------------------------------------------------------------
     * Game state
     * ------------------------------------------------------------- */
    let players = [];              // { name, colour, total }
    let st = null;                 // the hand in progress, owned by the rules
    let phase = "menu";
    let view = 0;                  // whose chair the screen is drawn from
    let passDir = "left", passSeat = 0, passSel = [[], [], [], []], selected = [];
    let received = [[], [], [], []];
    let anim = null;               // { kind, until, ... } — all times absolute
    let flying = [];               // { card, from, to, at, dur }
    let revealAt = 0, revealUntil = 0, hideAt = 0, trickUntil = 0;
    let shake = 0, queenFlash = 0, lastScore = null, result = null;
    let handNo = 0;

    /**
     * True while anything is moving. The fan sliding up counts: a card's target
     * is 190px away from where it will settle, so a tap taken mid-slide lands
     * on the wrong card. Everything commits first and animates second, and
     * input is refused until the animation lands.
     */
    const busy = () => anim !== null || now() < revealUntil;
    const handPts = (s) => (st ? st.taken[s].reduce((a, c) => a + cardPoints(c), 0) : 0);
    const hasQueen = (s) => !!(st && st.taken[s].some((c) => c.id === QUEEN_OF_SPADES));

    function newGame() {
      players = settings.names.map((n, i) => ({
        name: (n || DEFAULT_NAMES[i]).slice(0, 8), colour: SEAT_COLOUR[i], total: 0,
      }));
      handNo = 0;
      result = null;
      lastScore = null;
      startHand();
    }

    function startHand() {
      handNo++;
      const d = freshDeck();
      const deal = [0, 1, 2, 3].map((i) => sortHand(d.slice(i * 13, i * 13 + 13)));
      st = newHand(deal, handNo);
      passDir = passDirFor(handNo);
      passSel = [[], [], [], []];
      received = [[], [], [], []];
      selected = [];
      flying = [];
      anim = null;
      revealAt = 0; revealUntil = 0; hideAt = 0;
      if (passDir === "hold") return beginPlay();
      passSeat = 0;
      view = 0;
      phase = "passGate";
      paintHud();
    }

    /** Everybody's three change hands at the same moment, as at a table. */
    function executePass() {
      const out = [[], [], [], []];
      for (let s = 0; s < 4; s++) {
        const target = passTarget(s, passDir);
        for (const id of passSel[s]) {
          const i = st.hands[s].findIndex((c) => c.id === id);
          if (i >= 0) out[target].push(st.hands[s].splice(i, 1)[0]);
        }
      }
      for (let s = 0; s < 4; s++) {
        received[s] = out[s].map((c) => c.id);
        st.hands[s] = sortHand(st.hands[s].concat(out[s]));
      }
      beginPlay();
    }

    function beginPlay() {
      const lead = openingLeader(st);
      st.leader = lead;
      st.turn = lead;
      beginTurn();
    }

    function beginTurn() {
      view = st.turn;
      phase = "gate";
      revealAt = 0;
      revealUntil = 0;
      hideAt = 0;
      selected = [];
      paintHud();
    }

    function reveal() {
      const t = now();
      revealAt = t;
      revealUntil = t + 300 + (st.hands[phase === "passGate" ? passSeat : st.turn].length * 9);
      hideAt = 0;
      phase = phase === "passGate" ? "passing" : "turn";
      sound.haptic("light");
      sound.sting("tap");
      paintHud();
    }

    /* --- committing --- */
    function commitPlay(id) {
      if (busy() || phase !== "turn") return;
      const seat = st.turn;
      const n = st.hands[seat].length;
      const idx = st.hands[seat].findIndex((c) => c.id === id);
      if (idx < 0) return;
      const t = now();
      const from = handSlot(idx, n, t, 0);
      const out = playCard(st, seat, id);
      if (!out) {                                   // the rules said no
        sound.sting("fail"); sound.haptic("warning");
        shake = Math.max(shake, 0.006);
        return;
      }
      const to = throwSpot(0);
      flying = [{ card: out.card, from, to, rot: REL_ROT[0] + jitter(out.card.id), at: t, dur: 250 }];
      hideAt = t;
      anim = { kind: "play", until: t + 290, out };
      ctx.platform.interact({ type: "play", card: out.card.id });
      if (out.queen) {
        // The black lady gets her own entrance every single time.
        sound.duck(0.55, 420); sound.sting("danger"); sound.haptic("heavy");
        queenFlash = t; shake = 0.028;
      } else {
        sound.sting("tap"); sound.haptic("light");
      }
    }

    function commitPass() {
      if (busy() || phase !== "passing" || selected.length !== 3) return;
      passSel[passSeat] = selected.slice();
      selected = [];
      const t = now();
      hideAt = t;
      anim = { kind: "passStep", until: t + 240 };
      sound.sting("coin"); sound.haptic("medium");
      paintHud();
    }

    function finishAnim() {
      const kind = anim.kind;
      const out = anim.out;
      anim = null;
      flying = [];
      if (kind === "passStep") {
        passSeat++;
        if (passSeat < 4) { view = passSeat; phase = "passGate"; revealAt = 0; revealUntil = 0; hideAt = 0; paintHud(); }
        else executePass();
        return;
      }
      if (kind === "play") {
        if (!out.trickDone) return beginTurn();
        phase = "trickEnd";
        trickUntil = now() + 1250;
        if (out.points > 0) {
          sound.sting("fail"); sound.haptic("warning");
        } else {
          sound.sting("coin"); sound.haptic("light");
        }
        if (out.points >= 13) shake = Math.max(shake, 0.02);
        paintHud();
        return;
      }
      if (kind === "gather") {
        if (st.trickNo === 13) return endHand();
        beginTurn();
      }
    }

    function startGather() {
      if (phase !== "trickEnd" || busy()) return;
      const t = now();
      anim = { kind: "gather", until: t + 430, at: t };
      paintHud();
    }

    /* --- the end of a hand, and of the game --- */
    async function endHand() {
      const s = scoreHand(st);
      for (let i = 0; i < 4; i++) players[i].total += s.pts[i];
      lastScore = s;
      phase = "handEnd";
      if (s.shooter >= 0) {
        sound.duck(0.6, 520); sound.sting("win"); sound.haptic("success");
        shake = 0.034;
      } else {
        sound.sting("success"); sound.haptic("medium");
      }
      result = gameResult(players.map((p) => p.total), settings.target);
      renderHandEnd();
      sound.heat(clamp(Math.max.apply(null, players.map((p) => p.total)) / settings.target, 0, 1));
    }

    /**
     * The result sheet, reached from the hand sheet rather than stacked on top
     * of it — the last hand's scores are the reason the game ended and deserve
     * to be read before the standings replace them.
     */
    async function finishGame() {
      phase = "over";
      renderOver();
      sound.duck(0.5, 460); sound.sting("win"); sound.haptic("success");
      ctx.platform.complete({
        hands: handNo, target: settings.target, low: result.low,
        winner: players[result.winners[0]].name,
      });
      // The record is the score this TABLE won on — a property of the match,
      // not of whichever of the four people was holding the phone last.
      try {
        await ctx.memory.record("lowest_win").submit(result.low, { label: result.low + " pts" });
      } catch (_) {}
    }

    /* ---------------------------------------------------------------
     * Card art and the felt
     * ------------------------------------------------------------- */
    const canvas = ctx.createCanvas2D({ touchAction: "none" });
    const g = canvas.getContext("2d");
    let art = null, felt = null;

    function bakeFelt() {
      const c = makeSurface(W, H);
      if (!c) return null;
      const q = c.getContext("2d");
      const grad = q.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.max(W, H) * 0.78);
      grad.addColorStop(0, BAIZE_HI);
      grad.addColorStop(0.52, BAIZE);
      grad.addColorStop(1, BAIZE_LO);
      q.fillStyle = grad;
      q.fillRect(0, 0, W, H);
      // Woollen nap: a fine two-way speckle so the light has a surface to sit
      // on instead of a flat fill.
      q.globalAlpha = 0.055;
      for (let i = 0; i < 7000; i++) {
        q.fillStyle = Math.random() < 0.5 ? "#ffffff" : "#000000";
        q.fillRect(Math.random() * W, Math.random() * H, 1.7, 1.7);
      }
      q.globalAlpha = 1;
      // The brass ring the seats sit on, drawn as a double rule the way a
      // table is inlaid.
      q.strokeStyle = "rgba(201,162,39,0.20)"; q.lineWidth = 1.4;
      q.beginPath(); q.arc(L.cx, L.cy, L.R, 0, Math.PI * 2); q.stroke();
      q.strokeStyle = "rgba(201,162,39,0.10)"; q.lineWidth = 0.9;
      q.beginPath(); q.arc(L.cx, L.cy, L.R - 7, 0, Math.PI * 2); q.stroke();
      q.strokeStyle = "rgba(0,0,0,0.20)"; q.lineWidth = 1;
      q.beginPath(); q.arc(L.cx, L.cy, L.R + 2.4, 0, Math.PI * 2); q.stroke();
      // The house rosette at dead centre. The four thrown cards leave a small
      // diamond of bare felt in the middle of every trick and this sits in it.
      q.strokeStyle = "rgba(201,162,39,0.16)";
      q.lineWidth = 1.2;
      q.beginPath(); q.arc(L.cx, L.cy, 21, 0, Math.PI * 2); q.stroke();
      q.lineWidth = 0.8;
      q.beginPath(); q.arc(L.cx, L.cy, 15, 0, Math.PI * 2); q.stroke();
      q.globalAlpha = 0.16;
      q.fillStyle = BRASS;
      suitPath(q, "H", L.cx, L.cy, 7);
      q.globalAlpha = 1;
      // Four hearts inlaid at the quarters, faint, the way a felt is printed.
      q.globalAlpha = 0.055;
      q.fillStyle = BRASS;
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * Math.PI / 2;
        suitPath(q, "H", L.cx + Math.cos(a) * (L.R - 30), L.cy + Math.sin(a) * (L.R - 30), 13);
      }
      q.globalAlpha = 1;
      // A vignette from concentric strokes; the blur filter is not available.
      q.lineJoin = "round";
      for (let i = 0; i < 26; i++) {
        q.strokeStyle = "rgba(0,0,0,0.045)";
        q.lineWidth = 6;
        q.strokeRect(-3 - i * 2.6, -3 - i * 2.6, W + 6 + i * 5.2, H + 6 + i * 5.2);
      }
      return c;
    }

    function rebuildArt() {
      art = makeDeckArt(Math.round(L.cw * 2), Math.round(L.ch * 2), {
        face: "#F7F1E1", edge: "rgba(20,18,14,0.20)",
        red: "#B4202C", black: "#16161C", accent: "#7C1E2B",
      });
      felt = bakeFelt();
    }
    rebuildArt();

    /** One card, centred on (x,y) at whatever size the caller wants. */
    function drawCard(card, x, y, w, h, o) {
      o = o || {};
      g.save();
      g.translate(x, y);
      if (o.rot) g.rotate(o.rot);
      if (o.scale && o.scale !== 1) g.scale(o.scale, o.scale);
      if (o.alpha !== undefined) g.globalAlpha = o.alpha;
      softShadow(g, (q) => roundRect(q, -w / 2, -h / 2, w, h, w * 0.09),
                 { spread: 8 + (o.spread || 0), alpha: 0.06 });
      if (o.queen && o.glowBehind !== true) queenGlow(w, h, o.pulse === undefined ? 1 : o.pulse);
      if (o.glow) {
        g.save();
        g.lineJoin = "round";
        for (let s = 20; s >= 2; s -= 2.4) {
          g.strokeStyle = o.glow + (0.2 * (1 - s / 20) + 0.04).toFixed(3) + ")";
          g.lineWidth = s;
          roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
          g.stroke();
        }
        g.restore();
      }
      const img = o.faceDown ? (art && art.back) : (art && art.faces[card.id]);
      if (img) g.drawImage(img, -w / 2, -h / 2, w, h);
      else {
        roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
        g.fillStyle = o.faceDown ? "#7C1E2B" : "#F7F1E1";
        g.fill();
        if (!o.faceDown) {
          g.fillStyle = card.red ? "#B4202C" : "#16161C";
          g.font = "700 " + (w * 0.4) + "px ui-serif, Georgia, serif";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(card.rank, 0, 0);
        }
      }
      if (o.dim) {
        roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
        g.fillStyle = "rgba(5,24,16,0.52)";
        g.fill();
      }
      if (o.queen) queenRim(w, h, o.pulse === undefined ? 1 : o.pulse);
      if (o.mark) {                                  // a card that was passed in
        g.beginPath();
        g.arc(w / 2 - w * 0.13, -h / 2 + w * 0.13, w * 0.055, 0, Math.PI * 2);
        g.fillStyle = BRASS_HI; g.fill();
        g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 0.8; g.stroke();
      }
      g.restore();
    }

    /**
     * The queen of spades wears a crimson halo wherever she is, built from
     * concentric strokes because the canvas blur filter is rejected at upload.
     *
     * It comes in two pieces on purpose. The soft outer glow spills well past
     * the card, so in an overlapping fan it has to be laid down BEFORE any of
     * the cards or it paints itself across whichever neighbour happens to have
     * been drawn already — a hard-edged pink rectangle sitting on somebody
     * else's card rather than a glow around hers. The thin rim is only a
     * pixel or two out and belongs with the card itself, drawn last so she
     * stays outlined even when she is dimmed.
     */
    function queenGlow(w, h, pulse) {
      g.save();
      g.lineJoin = "round";
      for (let s = 34; s >= 3; s -= 3) {
        const a = (0.2 * (1 - s / 34) + 0.05) * pulse;
        g.strokeStyle = "rgba(178,18,42," + a.toFixed(3) + ")";
        g.lineWidth = s;
        roundRect(g, -w / 2, -h / 2, w, h, w * 0.09);
        g.stroke();
      }
      g.restore();
    }
    function queenRim(w, h, pulse) {
      g.save();
      g.lineJoin = "round";
      g.strokeStyle = "rgba(226,52,74," + (0.55 * pulse).toFixed(3) + ")";
      g.lineWidth = 1.6;
      roundRect(g, -w / 2 - 1, -h / 2 - 1, w + 2, h + 2, w * 0.09);
      g.stroke();
      g.restore();
    }

    /* ---------------------------------------------------------------
     * Painting the table
     * ------------------------------------------------------------- */
    function smallCaps(text, x, y, size, colour, ls, align, maxW) {
      g.save();
      g.fillStyle = colour;
      const s = String(text).toUpperCase();
      let sp = ls === undefined ? size * 0.24 : ls;
      let total = 0;
      const remeasure = () => {
        g.font = "700 " + size + "px -apple-system, system-ui, 'Segoe UI', sans-serif";
        total = 0;
        for (const ch of s) total += g.measureText(ch).width + sp;
        total -= sp;
      };
      remeasure();
      // A name is whatever somebody typed into settings, up to eight
      // characters. Rather than let it run into the score sitting beside it on
      // the nameplate, the lettering shrinks to the room actually left.
      if (maxW > 0 && total > maxW) {
        const k = maxW / total;
        size *= k; sp *= k;
        remeasure();
      }
      g.textAlign = "left"; g.textBaseline = "middle";
      let cx = align === "left" ? x : align === "right" ? x - total : x - total / 2;
      for (const ch of s) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + sp; }
      g.restore();
      return total;
    }

    /** A line of text with a suit pip set into it at the right size. */
    function textWithSuit(text, suit, x, y, size, colour) {
      g.save();
      g.font = "600 " + size + "px -apple-system, system-ui, 'Segoe UI', sans-serif";
      g.textBaseline = "middle";
      const tw = g.measureText(text).width;
      const gw = size * 1.15;
      const x0 = x - (tw + gw) / 2;
      g.textAlign = "left";
      g.fillStyle = colour;
      g.fillText(text, x0, y);
      g.fillStyle = (suit === "H" || suit === "D") ? CRIMSON_HI : IVORY;
      suitPath(g, suit, x0 + tw + gw * 0.55, y, size * 0.46);
      g.restore();
    }

    /** An engraved nameplate: brass frame, enamel inlay, turned to its chair. */
    function drawPlaque(seat, t) {
      const r = rel(seat);
      const spot = plaqueSpot(r);
      const p = players[seat];
      const live = (phase === "passGate" || phase === "passing")
        ? seat === passSeat
        : !!(st && st.turn === seat && (phase === "gate" || phase === "turn"));
      const won = phase === "trickEnd" && st.lastTrick && st.lastTrick.winner === seat;
      const pw = 100, ph = 38;
      g.save();
      g.translate(spot.x, spot.y);
      g.rotate(spot.rot);

      if (live || won) {
        const pulse = 0.5 + 0.5 * Math.sin(t / 320);
        g.save();
        g.lineJoin = "round";
        for (let s = 16; s >= 2; s -= 2.6) {
          g.strokeStyle = (won ? "rgba(240,218,150," : "rgba(240,218,150,")
            + (0.1 * (1 - s / 16) * (0.55 + 0.45 * pulse) + 0.02).toFixed(3) + ")";
          g.lineWidth = s;
          roundRect(g, -pw / 2, -ph / 2, pw, ph, 8);
          g.stroke();
        }
        g.restore();
      }

      const bg = g.createLinearGradient(0, -ph / 2, 0, ph / 2);
      bg.addColorStop(0, BRASS_HI);
      bg.addColorStop(0.42, BRASS);
      bg.addColorStop(1, BRASS_LO);
      roundRect(g, -pw / 2, -ph / 2, pw, ph, 8);
      g.fillStyle = bg; g.fill();
      g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 1; g.stroke();
      roundRect(g, -pw / 2 + 3, -ph / 2 + 3, pw - 6, ph - 6, 6);
      g.fillStyle = "rgba(6,26,18,0.88)"; g.fill();

      g.textBaseline = "middle";
      // Measure the score first: it is right-aligned and immovable, so it is
      // the score that decides how much of the plate the name may have.
      const scoreTxt = String(p.total);
      g.font = "800 16px ui-serif, Georgia, serif";
      const scoreW = g.measureText(scoreTxt).width;
      smallCaps(p.name, -pw / 2 + 9, -ph / 2 + 12.5, 10, p.colour, 1.1, "left",
                pw - 18 - scoreW - 7);
      g.font = "800 16px ui-serif, Georgia, serif";
      g.textAlign = "right";
      g.fillStyle = IVORY;
      g.fillText(scoreTxt, pw / 2 - 9, -ph / 2 + 13.5);

      // Second line: what this hand has cost them so far, and whether the
      // queen is sitting in their pile.
      const hp = handPts(seat);
      g.textAlign = "left";
      let x = -pw / 2 + 9;
      if (hp > 0) {
        g.font = "800 11.5px -apple-system, system-ui, sans-serif";
        g.fillStyle = CRIMSON_HI;
        g.fillText("+" + hp, x, ph / 2 - 11);
        x += g.measureText("+" + hp).width + 7;
      } else if (st && phase !== "menu") {
        g.font = "600 10px -apple-system, system-ui, sans-serif";
        g.fillStyle = "rgba(242,233,210,0.34)";
        g.fillText("clean", x, ph / 2 - 11);
        x += g.measureText("clean").width + 7;
      }
      if (hasQueen(seat)) {
        g.fillStyle = CRIMSON_HI;
        g.font = "800 11px ui-serif, Georgia, serif";
        g.fillText("Q", x, ph / 2 - 11);
        suitPath(g, "S", x + g.measureText("Q").width + 4, ph / 2 - 11.5, 4.6);
      }
      g.restore();
    }

    /**
     * Which way the three cards are travelling, drawn round the ring while the
     * passing round is on. It is the one thing about Hearts that people get
     * wrong at a real table, and the ring is otherwise empty at this point.
     */
    function drawPassFlow(t) {
      if (passDir === "hold") return;
      const rr = L.R * 0.54;
      const frac = (t % 1500) / 1500;
      const head = (ang, tang) => {
        g.save();
        g.translate(L.cx + Math.cos(ang) * rr, L.cy + Math.sin(ang) * rr);
        g.rotate(tang);
        g.beginPath();
        g.moveTo(9, 0); g.lineTo(-4, 5.5); g.lineTo(-4, -5.5);
        g.closePath();
        g.fillStyle = "rgba(240,218,150,0.55)";
        g.fill();
        g.restore();
      };
      g.save();
      g.lineCap = "round";
      g.strokeStyle = "rgba(240,218,150,0.26)";
      g.lineWidth = 2;
      if (passDir === "across") {
        for (const base of [Math.PI / 2, 0]) {
          const dx = Math.cos(base), dy = Math.sin(base);
          g.beginPath();
          g.moveTo(L.cx - dx * (rr - 12), L.cy - dy * (rr - 12));
          g.lineTo(L.cx + dx * (rr - 12), L.cy + dy * (rr - 12));
          g.stroke();
          head(base, base);
          head(base + Math.PI, base);
          // Two dots crossing in opposite directions, because across is a swap.
          for (const sgn of [1, -1]) {
            const u = (sgn > 0 ? frac : 1 - frac) * 2 - 1;
            g.beginPath();
            g.arc(L.cx + dx * u * (rr - 16), L.cy + dy * u * (rr - 16), 2.6, 0, Math.PI * 2);
            g.fillStyle = "rgba(240,218,150,0.6)";
            g.fill();
          }
        }
      } else {
        const dir = passDir === "left" ? 1 : -1;
        for (let k = 0; k < 4; k++) {
          const mid = Math.PI / 2 + k * Math.PI / 2;
          const a0 = mid + dir * 0.34, a1 = mid + dir * 1.22;
          g.beginPath();
          g.arc(L.cx, L.cy, rr, a0, a1, dir < 0);
          g.stroke();
          head(a1, a1 + dir * Math.PI / 2);
          const a = a0 + (a1 - a0) * frac;
          g.beginPath();
          g.arc(L.cx + Math.cos(a) * rr, L.cy + Math.sin(a) * rr, 2.8, 0, Math.PI * 2);
          g.fillStyle = "rgba(240,218,150,0.62)";
          g.fill();
        }
      }
      g.restore();
    }

    function drawHeader(t) {
      const y0 = L.top + 62;
      smallCaps("Hand " + handNo + "   ·   " + (passDir === "hold" ? "no pass" : "pass " + passDir),
                L.cx, y0, 10, "rgba(240,218,150,0.62)");
      // A brass rule with a heart medallion: filled once hearts are broken.
      const y1 = y0 + 32;
      const half = 86;
      g.strokeStyle = "rgba(201,162,39,0.34)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L.cx - half, y1); g.lineTo(L.cx - 17, y1); g.stroke();
      g.beginPath(); g.moveTo(L.cx + 17, y1); g.lineTo(L.cx + half, y1); g.stroke();
      const broken = st && st.heartsBroken;
      g.save();
      if (broken) {
        const pulse = 0.72 + 0.28 * Math.sin(t / 420);
        g.globalAlpha = pulse;
        g.fillStyle = CRIMSON;
        suitPath(g, "H", L.cx, y1, 11);
        g.globalAlpha = 1;
      } else {
        g.strokeStyle = "rgba(240,218,150,0.5)";
        g.lineWidth = 1.4;
        g.save(); g.translate(L.cx, y1); g.scale(11, 11);
        g.beginPath();
        g.moveTo(0, 0.75);
        g.bezierCurveTo(-1.35, -0.15, -0.72, -1.05, 0, -0.45);
        g.bezierCurveTo(0.72, -1.05, 1.35, -0.15, 0, 0.75);
        g.closePath();
        g.restore();
        g.stroke();
      }
      g.restore();
      const y2 = y1 + 26;
      if (phase === "passGate" || phase === "passing" || (anim && anim.kind === "passStep")) {
        smallCaps("Player " + Math.min(passSeat + 1, 4) + " of 4", L.cx, y2, 9.5,
                  "rgba(242,233,210,0.34)");
      } else if (st) {
        const showing = phase === "trickEnd" || (anim && anim.kind === "gather")
          ? st.trickNo                                   // the one on the felt
          : Math.min(st.trickNo + 1, 13);                // the one being played
        smallCaps("Trick " + showing + " of 13", L.cx, y2, 9.5,
                  broken ? "rgba(194,38,59,0.85)" : "rgba(242,233,210,0.34)");
      }
    }

    function drawTrick(t) {
      if (!st) return;
      const gathering = anim && anim.kind === "gather";
      // st.trick is emptied the instant the fourth card completes the trick, so
      // while that card is still flying the other three have to come from
      // lastTrick or they blink out mid-animation.
      const useLast = phase === "trickEnd" || gathering ||
        !!(anim && anim.kind === "play" && anim.out && anim.out.trickDone);
      const list = useLast ? (st.lastTrick ? st.lastTrick.cards : []) : st.trick;
      const wSeat = st.lastTrick ? st.lastTrick.winner : -1;
      for (const p of list) {
        if (flying.some((f) => f.card.id === p.card.id)) continue;
        const r = rel(p.seat);
        let spot = throwSpot(r);
        let scale = 1, alpha = 1;
        if (gathering) {
          const q = ease(clamp((t - anim.at) / 430, 0, 1));
          const dest = plaqueSpot(rel(wSeat));
          spot = { x: spot.x + (dest.x - spot.x) * q, y: spot.y + (dest.y - spot.y) * q };
          scale = 1 - q * 0.72;
          alpha = 1 - q * 0.85;
        }
        const winning = phase === "trickEnd" && p.seat === wSeat && !gathering;
        drawCard(p.card, spot.x, spot.y, L.tw, L.th, {
          rot: REL_ROT[r] + jitter(p.card.id),
          scale, alpha,
          glow: winning ? "rgba(255,231,160," : null,
          queen: p.card.id === QUEEN_OF_SPADES,
          pulse: p.card.id === QUEEN_OF_SPADES ? 0.8 + 0.4 * Math.sin(t / 260) : 1,
        });
      }
    }

    function drawHand(t) {
      const seat = phase === "passing" || (anim && anim.kind === "passStep") ? passSeat : view;
      if (!st || !st.hands[seat]) return;
      const hand = st.hands[seat];
      const n = hand.length;
      const picking = phase === "passing" || (anim && anim.kind === "passStep");
      const fading = !!(anim && anim.kind === "play");
      const legal = picking || fading ? null : legalMoves(st, seat).map((c) => c.id);
      const stateOf = (card) => {
        const chosen = picking && selected.indexOf(card.id) >= 0;
        const ok = picking || fading ? true : legal.indexOf(card.id) >= 0;
        return { chosen, ok,
          lift: chosen ? LIFT_PICK
                       : (!picking && !fading && ok && settings.hints ? LIFT_LEGAL : 0) };
      };
      const qPulse = 0.7 + 0.5 * Math.sin(t / 280);
      // Her glow goes down before any card does. The fan overlaps by nearly
      // two thirds, so a halo painted with her own card lands almost entirely
      // on the neighbour to her left — which reads as a smear on somebody
      // else's card, not a halo on hers.
      const qi = hand.findIndex((c) => c.id === QUEEN_OF_SPADES);
      if (qi >= 0) {
        const q = handSlot(qi, n, t, stateOf(hand[qi]).lift);
        g.save();
        g.translate(q.x, q.y);
        g.rotate(q.rot);
        queenGlow(L.cw, L.ch, qPulse);
        g.restore();
      }
      for (let i = 0; i < n; i++) {
        const card = hand[i];
        const { chosen, ok, lift } = stateOf(card);
        const s = handSlot(i, n, t, lift);
        const isQ = card.id === QUEEN_OF_SPADES;
        drawCard(card, s.x, s.y, L.cw, L.ch, {
          rot: s.rot,
          dim: !picking && !fading && settings.hints && !ok,
          glow: chosen ? "rgba(240,218,150,"
            : (legal && ok && settings.hints && legal.length === 1 ? "rgba(240,218,150," : null),
          queen: isQ,
          glowBehind: isQ,                      // already laid down, above
          pulse: isQ ? qPulse : 1,
          mark: received[seat].indexOf(card.id) >= 0,
          spread: lift * 0.35,
        });
      }
    }

    function drawFlying(t) {
      for (const f of flying) {
        const p = clamp((t - f.at) / f.dur, 0, 1);
        const e = ease(p);
        drawCard(f.card, f.from.x + (f.to.x - f.from.x) * e, f.from.y + (f.to.y - f.from.y) * e,
                 L.cw + (L.tw - L.cw) * e, L.ch + (L.th - L.ch) * e, {
          rot: f.from.rot + (f.rot - f.from.rot) * e,
          spread: Math.sin(e * Math.PI) * 16,
          queen: f.card.id === QUEEN_OF_SPADES,
        });
      }
    }

    /** The brass-framed panel in the bottom band, where the hand would be. */
    function panelFrame(x0, y0, x1, y1) {
      const w = x1 - x0, h = y1 - y0;
      softShadow(g, (q) => roundRect(q, x0, y0, w, h, 16), { spread: 22, alpha: 0.09 });
      roundRect(g, x0, y0, w, h, 16);
      const bg = g.createLinearGradient(0, y0, 0, y1);
      bg.addColorStop(0, "rgba(9,38,27,0.97)");
      bg.addColorStop(1, "rgba(4,20,14,0.98)");
      g.fillStyle = bg; g.fill();
      g.strokeStyle = "rgba(201,162,39,0.55)"; g.lineWidth = 1.4; g.stroke();
      roundRect(g, x0 + 4, y0 + 4, w - 8, h - 8, 12);
      g.strokeStyle = "rgba(201,162,39,0.18)"; g.lineWidth = 0.8; g.stroke();
    }

    function drawGatePanel(t) {
      const seat = phase === "passGate" ? passSeat : st.turn;
      if (seat < 0 || !players[seat]) return;
      const p = players[seat];
      const x0 = 26, x1 = W - 26, y0 = L.panelTop + 6, y1 = L.panelBot;
      panelFrame(x0, y0, x1, y1);
      const mid = (y0 + y1) / 2;
      const bar = g.createLinearGradient(x0, 0, x1, 0);
      bar.addColorStop(0, "rgba(0,0,0,0)");
      bar.addColorStop(0.5, p.colour);
      bar.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = bar;
      g.fillRect(x0 + 40, y0 + 11, x1 - x0 - 80, 2);
      smallCaps("Pass the phone to", L.cx, y0 + 32, 10, "rgba(201,162,39,0.72)");
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "900 36px ui-serif, Georgia, serif";
      g.fillStyle = p.colour;
      g.fillText(p.name, L.cx, mid - 12);

      // NOTHING on this panel may be derived from the hand it is handing over.
      // This is the screen the phone travels on, in full view of all four
      // players: "you are void" would tell the whole table that this seat has
      // none of the led suit, which is the most valuable hidden fact in a
      // trick-taking game. The led suit is already face up on the felt, so it
      // is public and may be named; whether this seat can follow it is not,
      // and drawPrompt says that once the hand is revealed to its owner alone.
      let line = "", suit = null;
      if (phase === "passGate") {
        line = "choose three to pass " + passDir;
      } else if (!st.trick.length) {
        line = st.trickNo === 0 ? "lead the two of clubs" : "yours to lead";
      } else {
        line = "the lead is";
        suit = st.trick[0].card.suit;
      }
      if (suit) textWithSuit(line, suit, L.cx, mid + 16, 14, "rgba(242,233,210,0.66)");
      else {
        g.font = "600 14px -apple-system, system-ui, sans-serif";
        g.fillStyle = "rgba(242,233,210,0.66)";
        g.fillText(line, L.cx, mid + 16);
      }

      g.strokeStyle = "rgba(201,162,39,0.22)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0 + 34, y1 - 44); g.lineTo(x1 - 34, y1 - 44); g.stroke();
      const pulse = 0.55 + 0.45 * Math.sin(t / 460);
      smallCaps("Tap anywhere to look", L.cx, y1 - 24, 10,
                "rgba(240,218,150," + (0.45 + 0.4 * pulse).toFixed(2) + ")");
    }

    function drawPrompt() {
      const seat = st.turn;
      if (seat < 0 || !st.hands[seat]) return;
      const legal = legalMoves(st, seat);
      let line = "", suit = null;
      if (!st.trick.length) {
        if (st.trickNo === 0) { line = "Lead the two of"; suit = "C"; }
        else if (!st.heartsBroken) line = "Your lead — hearts are not broken";
        else line = "Your lead";
      } else {
        const led = st.trick[0].card.suit;
        if (st.hands[seat].some((c) => c.suit === led)) { line = "Follow"; suit = led; }
        else if (st.trickNo === 0) line = "Discard — nothing that scores, first trick";
        else line = "Void — discard anything";
      }
      if (suit) textWithSuit(line, suit, L.cx, L.promptY, 14, "rgba(242,233,210,0.72)");
      else {
        g.textAlign = "center"; g.textBaseline = "middle";
        g.font = "600 14px -apple-system, system-ui, sans-serif";
        g.fillStyle = "rgba(242,233,210,0.72)";
        g.fillText(line, L.cx, L.promptY);
      }
      if (legal.length === 1 && st.hands[seat].length > 1) {
        smallCaps("only one legal card", L.cx, L.promptY + 20, 9, "rgba(240,218,150,0.55)");
      }
    }

    /** The button below counts the cards; this line names who receives them. */
    function drawPassPrompt() {
      const to = players[passTarget(passSeat, passDir)];
      const lead = "Three cards to ";
      g.textAlign = "left"; g.textBaseline = "middle";
      g.font = "600 15px -apple-system, system-ui, sans-serif";
      const lw = g.measureText(lead).width;
      g.font = "800 15px -apple-system, system-ui, sans-serif";
      const nw = g.measureText(to.name).width;
      let x = L.cx - (lw + nw) / 2;
      g.font = "600 15px -apple-system, system-ui, sans-serif";
      g.fillStyle = "rgba(242,233,210,0.66)";
      g.fillText(lead, x, L.promptY - 8);
      g.font = "800 15px -apple-system, system-ui, sans-serif";
      g.fillStyle = to.colour;
      g.fillText(to.name, x + lw, L.promptY - 8);
    }

    /**
     * The trick result takes the same panel the handover uses, so the bottom
     * of the screen is either your hand or one card-shaped message and never a
     * band of bare felt.
     */
    function drawTrickBanner(t) {
      if (!st.lastTrick) return;
      const lt = st.lastTrick;
      const w = players[lt.winner];
      const heavy = lt.cards.some((c) => c.card.id === QUEEN_OF_SPADES);
      const x0 = 26, x1 = W - 26, y0 = L.panelTop + 6, y1 = L.panelBot;
      panelFrame(x0, y0, x1, y1);
      const mid = (y0 + y1) / 2;
      smallCaps("Trick taken", L.cx, y0 + 30, 10, "rgba(201,162,39,0.72)");
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "900 30px ui-serif, Georgia, serif";
      g.fillStyle = w.colour;
      g.fillText(w.name, L.cx, mid - 14);
      g.font = "600 14px -apple-system, system-ui, sans-serif";
      g.fillStyle = "rgba(242,233,210,0.66)";
      g.fillText(heavy ? "takes it, and the black lady with it" : "takes the trick", L.cx, mid + 12);
      if (lt.points > 0) {
        smallCaps(lt.points + (lt.points === 1 ? " point" : " points"), L.cx, mid + 36, 12,
                  heavy ? CRIMSON_HI : "rgba(224,80,100,0.9)");
      } else {
        smallCaps("no points", L.cx, mid + 36, 11, "rgba(242,233,210,0.36)");
      }
      g.strokeStyle = "rgba(201,162,39,0.22)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0 + 34, y1 - 44); g.lineTo(x1 - 34, y1 - 44); g.stroke();
      const pulse = 0.55 + 0.45 * Math.sin(t / 460);
      smallCaps("Tap to carry on", L.cx, y1 - 24, 10,
                "rgba(240,218,150," + (0.45 + 0.4 * pulse).toFixed(2) + ")");
    }

    /** The title spread — a real hand of cards, with her in the middle. */
    const TITLE_CARDS = ["10C", "AH", "QS", "KD", "2C"];
    function drawTitleSpread(t) {
      const cy = L.cy + 40, cw = L.cw * 1.02, ch = cw * 1.4;
      for (let i = 0; i < TITLE_CARDS.length; i++) {
        const id = TITLE_CARDS[i];
        const a = (i - 2) * 0.235;
        const card = { id, rank: id.slice(0, id.length - 1), suit: id.slice(-1) };
        card.red = card.suit === "H" || card.suit === "D";
        const isQ = id === QUEEN_OF_SPADES;
        drawCard(card, L.cx + Math.sin(a) * 210, cy - Math.cos(a) * 210 + 210 - (isQ ? 20 : 0),
                 cw, ch, {
          rot: a, queen: isQ, spread: isQ ? 12 : 2,
          pulse: isQ ? 0.8 + 0.5 * Math.sin(t / 520) : 1,
        });
      }
    }

    function paint() {
      const t = now();
      g.save();
      if (shake > 0.0006) {
        g.translate((Math.random() - 0.5) * shake * W, (Math.random() - 0.5) * shake * W);
      }
      if (felt) g.drawImage(felt, 0, 0, W, H);
      else { g.fillStyle = BAIZE; g.fillRect(0, 0, W, H); }

      if (phase === "menu") {
        drawTitleSpread(t);
        g.restore();
        return;
      }

      drawHeader(t);
      if (phase === "passGate" || phase === "passing" ||
          (anim && anim.kind === "passStep")) drawPassFlow(t);
      for (let s = 0; s < 4; s++) drawPlaque(s, t);
      drawTrick(t);
      if (phase === "turn" || phase === "passing" ||
          (anim && (anim.kind === "play" || anim.kind === "passStep"))) drawHand(t);
      if (phase === "gate" || phase === "passGate") drawGatePanel(t);
      else if (phase === "trickEnd") drawTrickBanner(t);
      else if (phase === "turn" && !anim && st.turn >= 0) drawPrompt();
      else if (phase === "passing") drawPassPrompt();
      drawFlying(t);

      // Her arrival: a crimson ring thrown out from the middle of the table.
      if (queenFlash) {
        const p = clamp((t - queenFlash) / 620, 0, 1);
        if (p >= 1) queenFlash = 0;
        else {
          g.save();
          g.globalAlpha = (1 - p) * 0.75;
          g.strokeStyle = CRIMSON_HI;
          for (let k = 0; k < 3; k++) {
            g.lineWidth = 3 - k * 0.8;
            g.beginPath();
            g.arc(L.cx, L.cy, 24 + p * (150 + k * 44), 0, Math.PI * 2);
            g.stroke();
          }
          g.restore();
        }
      }
      g.restore();
    }

    /* ---------------------------------------------------------------
     * Input. The root overlay sits above the canvas with pointers off,
     * so everything below reaches the felt.
     * ------------------------------------------------------------- */
    function handHit(px, py, t) {
      const seat = phase === "passing" ? passSeat : view;
      const hand = st.hands[seat];
      const n = hand.length;
      const picking = phase === "passing";
      const legal = picking ? null : legalMoves(st, seat).map((c) => c.id);
      for (let i = n - 1; i >= 0; i--) {
        const chosen = picking && selected.indexOf(hand[i].id) >= 0;
        const ok = picking ? true : legal.indexOf(hand[i].id) >= 0;
        const lift = chosen ? LIFT_PICK : (!picking && ok && settings.hints ? LIFT_LEGAL : 0);
        const s = handSlot(i, n, t, lift);
        const dx = px - s.x, dy = py - s.y;
        const c = Math.cos(-s.rot), si = Math.sin(-s.rot);
        const lx = dx * c - dy * si, ly = dx * si + dy * c;
        if (Math.abs(lx) <= L.cw / 2 && Math.abs(ly) <= L.ch / 2) return i;
      }
      return -1;
    }

    ctx.listen(canvas, "pointerdown", async (e) => {
      await sound.unlock();
      const t = now();
      const x = e.offsetX, y = e.offsetY;
      e.preventDefault();
      if (busy()) return;
      if (phase === "gate" || phase === "passGate") return reveal();
      if (phase === "trickEnd") return startGather();
      if (phase === "turn") {
        const i = handHit(x, y, t);
        if (i < 0) return;
        commitPlay(st.hands[view][i].id);
        return;
      }
      if (phase === "passing") {
        const i = handHit(x, y, t);
        if (i < 0) return;
        const id = st.hands[passSeat][i].id;
        const at = selected.indexOf(id);
        if (at >= 0) selected.splice(at, 1);
        else if (selected.length < 3) selected.push(id);
        else { sound.sting("fail"); sound.haptic("warning"); return; }
        sound.haptic("light");
        paintHud();
      }
    }, { passive: false });

    /* ---------------------------------------------------------------
     * Overlay — one markup string, pointers off on the root
     * ------------------------------------------------------------- */
    const FONT = "-apple-system,system-ui,'Segoe UI',Roboto,sans-serif";
    const SERIF = "ui-serif,Georgia,'Times New Roman',serif";
    const BIG = "width:100%;padding:15px;border:none;border-radius:14px;font-family:inherit;" +
      "font-size:16px;font-weight:800;letter-spacing:0.02em;";
    const BTN = "pointer-events:auto;width:34px;height:34px;border-radius:11px;border:none;" +
      "background:rgba(201,162,39,0.17);color:" + IVORY + ";font-size:14px;font-family:inherit;padding:0;";
    // box-sizing matters here: a div defaults to content-box, so max-height:100%
    // on a padded sheet caps the CONTENT at the full height and the padding and
    // border then push the sheet past it — which is how the rules panel ended up
    // 46px taller than the space it was given and spilled under the notch.
    const SHEET = "box-sizing:border-box;background:linear-gradient(180deg,#0B3A29,#06231A);" +
      "border:1px solid rgba(201,162,39,0.42);" +
      "border-radius:20px;box-shadow:0 14px 44px rgba(0,0,0,0.55);";
    const LABEL = "font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(201,162,39,0.7);";

    const root = ctx.createRoot({ touchAction: "none" });
    root.style.cssText += ";font-family:" + FONT + ";color:" + IVORY + ";pointer-events:none;";
    root.innerHTML =
      // Chrome goes in the strip above the ring. Down the side it would sit on
      // the outermost cards: a 390px screen leaves seven pixels there.
      '<div data-el="chrome" style="position:absolute;left:10px;top:' + (ST + 10) + 'px;' +
        'display:none;gap:7px;z-index:40;pointer-events:none;">' +
        '<button data-el="mute" aria-label="Sound" style="' + BTN + '">&#128266;</button>' +
        '<button data-el="help" aria-label="How to play" style="' + BTN + '">?</button>' +
        '<button data-el="cog" aria-label="Settings" style="' + BTN + '">&#9881;</button>' +
      '</div>' +
      '<button data-el="passbtn" style="position:absolute;left:28px;right:28px;top:' +
        Math.round(L.promptY + 8) + 'px;display:none;pointer-events:auto;padding:11px;border:none;' +
        'border-radius:13px;font-family:inherit;font-size:15px;font-weight:800;letter-spacing:0.04em;' +
        'background:linear-gradient(180deg,#F0DA96,#C9A227);color:#2A1D05;">Pass three left</button>' +

      // Title. The spread of cards behind it shows through the gap.
      '<div data-el="menu" style="position:absolute;inset:0;pointer-events:auto;display:flex;' +
        'flex-direction:column;justify-content:space-between;text-align:center;padding:' +
        (ST + 26) + 'px 26px ' + (SB + 20) + 'px;background:linear-gradient(180deg,' +
        'rgba(3,18,12,0.94) 0%,rgba(3,18,12,0.84) 26%,rgba(3,18,12,0.04) 42%,' +
        'rgba(3,18,12,0.04) 58%,rgba(3,18,12,0.86) 74%,rgba(3,18,12,0.96) 100%);z-index:50;">' +
        '<div>' +
          '<div style="' + LABEL + '">Four players · one phone</div>' +
          '<div style="font-family:' + SERIF + ';font-size:62px;font-weight:900;letter-spacing:0.02em;' +
            'line-height:1.06;margin-top:6px;background:linear-gradient(100deg,#F0DA96,#C9A227 55%,#8A6D14);' +
            '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">Hearts</div>' +
          '<div style="font-size:14px;opacity:0.6;line-height:1.5;max-width:280px;margin:8px auto 0;">' +
            'Every heart is a point, the queen of spades is thirteen, and points are the ' +
            'last thing you want — unless you take all of them.</div>' +
        '</div>' +
        '<div>' +
          '<div style="' + LABEL + 'margin-bottom:8px;">Play to</div>' +
          '<div data-el="tc" style="display:flex;gap:8px;justify-content:center;"></div>' +
          '<button data-el="menu-set" style="' + BIG + 'max-width:250px;margin:10px auto 0;display:block;' +
            'background:none;box-shadow:inset 0 0 0 1px rgba(201,162,39,0.34);color:rgba(242,233,210,0.72);' +
            'font-size:14px;padding:11px;">Names &amp; settings</button>' +
          '<button data-el="go" style="' + BIG + 'max-width:250px;margin:10px auto 0;display:block;' +
            'background:linear-gradient(180deg,#F0DA96,#C9A227);color:#2A1D05;">Deal</button>' +
          '<div style="font-size:11.5px;opacity:0.42;margin-top:10px;line-height:1.5;">' +
            'The table stays on screen. Your hand only appears when you tap.</div>' +
        '</div>' +
      '</div>' +

      // End of a hand.
      '<div data-el="hand-end" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(3,18,12,0.9);z-index:60;padding:22px;">' +
        '<div style="width:100%;max-width:330px;' + SHEET + 'padding:22px;">' +
          '<div data-el="he-body"></div>' +
          '<button data-el="he-next" style="' + BIG + 'margin-top:16px;' +
            'background:linear-gradient(180deg,#F0DA96,#C9A227);color:#2A1D05;">Next hand</button>' +
        '</div>' +
      '</div>' +

      // End of the game.
      '<div data-el="over" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(3,18,12,0.94);z-index:70;padding:22px;">' +
        '<div style="width:100%;max-width:330px;' + SHEET + 'padding:24px;">' +
          '<div data-el="ov-body"></div>' +
          '<button data-el="ov-again" style="' + BIG + 'margin-top:18px;' +
            'background:linear-gradient(180deg,#F0DA96,#C9A227);color:#2A1D05;">Play again</button>' +
        '</div>' +
      '</div>' +

      // Rules.
      '<div data-el="helpp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(3,18,12,0.95);z-index:80;padding:' + (ST + 14) + 'px 20px ' + (SB + 14) + 'px;">' +
        // The list scrolls inside the sheet; the way out does not scroll with it.
        // Eleven rules are taller than the screen once the notch and home bar
        // are taken out, and a dismiss button that starts below the fold is a
        // panel with no visible exit.
        '<div style="width:100%;max-width:340px;max-height:100%;display:flex;flex-direction:column;' +
          SHEET + 'padding:22px;">' +
          '<div style="overflow-y:auto;min-height:0;">' +
          '<div style="' + LABEL + '">The rules</div>' +
          '<div style="font-family:' + SERIF + ';font-size:24px;font-weight:800;margin:4px 0 12px;">Hearts</div>' +
          '<ul style="font-size:13.5px;line-height:1.72;opacity:0.86;padding-left:17px;margin:0;">' +
            '<li>Four players, thirteen cards each, the whole deck.</li>' +
            '<li>Before each hand you pass <b>three cards</b> — left, then right, then across, then a hand with no pass at all.</li>' +
            '<li>Whoever holds the <b>two of clubs</b> leads it. Nothing else may be led to the first trick.</li>' +
            '<li><b>Follow the led suit</b> if you can. If you cannot, throw anything you like.</li>' +
            '<li>Nothing that scores may be played on the <b>first trick</b> — no hearts, not the queen — unless points are all you hold.</li>' +
            '<li>Hearts may not be <b>led</b> until somebody has been forced to throw one. If hearts are all you have left, lead them anyway.</li>' +
            '<li>The highest card of the led suit takes the trick and leads the next.</li>' +
            '<li>Each heart is <b>1 point</b>. The queen of spades is <b>13</b>. Points are bad.</li>' +
            '<li><b>Shoot the moon:</b> take every heart <i>and</i> the queen and you score nothing while everybody else takes 26.</li>' +
            '<li>Play stops when somebody reaches the target. <b>Lowest score wins.</b></li>' +
            '<li>The table is public and always on screen. Your hand appears only while you are looking at it, and drops away the moment you play.</li>' +
          '</ul>' +
          '</div>' +
          '<button data-el="helpp-close" style="' + BIG + 'margin-top:16px;flex:none;' +
            'background:rgba(201,162,39,0.2);color:' + IVORY + ';">Got it</button>' +
        '</div>' +
      '</div>' +

      // Settings.
      '<div data-el="setp" style="position:absolute;inset:0;pointer-events:auto;display:none;' +
        'align-items:center;justify-content:center;background:rgba(3,18,12,0.95);z-index:85;padding:' + (ST + 14) + 'px 20px ' + (SB + 14) + 'px;">' +
        '<div style="width:100%;max-width:340px;max-height:100%;display:flex;flex-direction:column;' +
          SHEET + 'padding:22px;">' +
          '<div style="overflow-y:auto;min-height:0;">' +
          '<div style="' + LABEL + '">Settings</div>' +
          '<div style="font-family:' + SERIF + ';font-size:24px;font-weight:800;margin:4px 0 14px;">The table</div>' +
          '<div style="' + LABEL + 'margin-bottom:8px;">Names</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
            [0, 1, 2, 3].map((i) =>
              '<div style="display:flex;align-items:center;gap:7px;">' +
                '<span style="width:9px;height:9px;border-radius:50%;flex:none;background:' +
                  SEAT_COLOUR[i] + ';"></span>' +
                '<input data-el="nm-' + i + '" maxlength="8" placeholder="' + DEFAULT_NAMES[i] + '" ' +
                  'style="width:100%;min-width:0;padding:10px 11px;border-radius:11px;' +
                  'border:1px solid rgba(201,162,39,0.28);background:rgba(255,255,255,0.05);color:' +
                  IVORY + ';font-family:inherit;font-size:15px;">' +
              '</div>').join("") +
          '</div>' +
          '<div style="' + LABEL + 'margin:16px 0 8px;">Play to</div>' +
          '<div data-el="tc2" style="display:flex;gap:8px;"></div>' +
          '<div style="' + LABEL + 'margin:16px 0 8px;">Legal-card hints</div>' +
          '<div data-el="hc" style="display:flex;gap:8px;"></div>' +
          '<button data-el="set-new" style="' + BIG + 'margin-top:18px;' +
            'background:rgba(194,38,59,0.24);color:' + IVORY + ';">Start a new game</button>' +
          '</div>' +
          '<button data-el="setp-close" style="' + BIG + 'margin-top:9px;flex:none;' +
            'background:rgba(201,162,39,0.2);color:' + IVORY + ';">Done</button>' +
        '</div>' +
      '</div>';

    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const tap = (node, fn) => {
      if (!node) return;
      ctx.listen(node, "pointerdown", (e) => e.stopPropagation());
      ctx.listen(node, "click", (e) => { e.stopPropagation(); e.preventDefault(); fn(e); });
    };
    tap(el("mute"), (e) => { e.target.innerHTML = sound.toggle() ? "&#128263;" : "&#128266;"; });
    if (settings.mute) el("mute").innerHTML = "&#128263;";
    tap(el("help"), () => { el("helpp").style.display = "flex"; });
    tap(el("helpp-close"), () => { el("helpp").style.display = "none"; });
    tap(el("cog"), () => { el("setp").style.display = "flex"; });
    tap(el("menu-set"), () => { el("setp").style.display = "flex"; });
    tap(el("setp-close"), () => { readNames(); el("setp").style.display = "none"; });
    tap(el("set-new"), async () => {
      readNames();
      ctx.platform.start();
      await sound.unlock();
      el("setp").style.display = "none";
      el("hand-end").style.display = "none";
      el("over").style.display = "none";
      el("menu").style.display = "none";
      el("chrome").style.display = "flex";
      newGame();
      sound.sting("coin");
    });

    function readNames() {
      for (let i = 0; i < 4; i++) {
        const v = (el("nm-" + i).value || "").trim().slice(0, 8);
        settings.names[i] = v || DEFAULT_NAMES[i];
        if (players[i]) players[i].name = settings.names[i];
      }
      saveSettings();
    }
    for (let i = 0; i < 4; i++) el("nm-" + i).value = settings.names[i];

    function pills(host, values, labels, get, set) {
      host.innerHTML = values.map((v, i) =>
        '<button data-v="' + v + '" style="flex:1;padding:11px 0;border:none;border-radius:12px;' +
        'font-family:inherit;font-size:15px;font-weight:800;">' + labels[i] + '</button>').join("");
      const repaint = () => {
        for (const b of host.querySelectorAll("button")) {
          const on = String(get()) === b.dataset.v;
          b.style.background = on ? "linear-gradient(180deg,#F0DA96,#C9A227)" : "rgba(201,162,39,0.13)";
          b.style.color = on ? "#2A1D05" : "rgba(242,233,210,0.6)";
        }
      };
      for (const b of host.querySelectorAll("button")) {
        tap(b, () => { set(b.dataset.v); saveSettings(); repaint(); syncPills(); sound.haptic("light"); });
      }
      host.__repaint = repaint;
      repaint();
    }
    function syncPills() {
      for (const n of ["tc", "tc2", "hc"]) if (el(n).__repaint) el(n).__repaint();
    }
    pills(el("tc"), [50, 100, 150], ["50", "100", "150"],
          () => settings.target, (v) => { settings.target = Number(v); });
    pills(el("tc2"), [50, 100, 150], ["50", "100", "150"],
          () => settings.target, (v) => { settings.target = Number(v); });
    pills(el("hc"), [true, false], ["On", "Off"],
          () => settings.hints, (v) => { settings.hints = v === "true"; });

    tap(el("go"), async () => {
      el("chrome").style.display = "flex";
      ctx.platform.start();
      await sound.unlock();
      readNames();
      el("menu").style.display = "none";
      sound.sting("coin");
      newGame();
    });
    tap(el("passbtn"), () => commitPass());
    tap(el("he-next"), () => {
      el("hand-end").style.display = "none";
      sound.sting("coin");
      if (result) finishGame();
      else startHand();
    });
    tap(el("ov-again"), () => {
      el("over").style.display = "none";
      el("hand-end").style.display = "none";
      sound.sting("coin");
      newGame();
    });

    /** Everything in the overlay that changes with the phase. */
    function paintHud() {
      // Not while the hand is sliding away: the phase is still "passing" for
      // another 240ms after the commit, and the button would flash back to
      // "choose three more" over cards that have already gone.
      const showPass = phase === "passing" && !anim;
      const b = el("passbtn");
      b.style.display = showPass ? "block" : "none";
      if (showPass) {
        const ready = selected.length === 3;
        b.textContent = ready
          ? "Pass three " + passDir
          : "Choose " + (3 - selected.length) + " more";
        b.style.background = ready ? "linear-gradient(180deg,#F0DA96,#C9A227)" : "rgba(201,162,39,0.05)";
        b.style.color = ready ? "#2A1D05" : "rgba(242,233,210,0.5)";
        b.style.boxShadow = ready ? "0 5px 18px rgba(0,0,0,0.4)" : "inset 0 0 0 1px rgba(201,162,39,0.34)";
      }
    }

    function scoreRows(pts) {
      const max = Math.max(settings.target, 1);
      return players.map((p, i) => {
        const w = clamp(p.total / max, 0, 1) * 100;
        const gain = pts ? pts[i] : 0;
        return '<div style="margin:9px 0;">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:15px;">' +
            '<span style="color:' + p.colour + ';font-weight:800;">' + esc(p.name) + '</span>' +
            '<span style="font-family:' + SERIF + ';font-weight:800;">' +
              (gain ? '<span style="color:' + CRIMSON_HI + ';font-size:12.5px;">+' + gain + '</span>  ' : '') +
              p.total + '</span>' +
          '</div>' +
          '<div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.07);margin-top:5px;' +
            'overflow:hidden;"><div style="height:100%;width:' + w.toFixed(1) + '%;background:' +
            (p.total >= settings.target ? CRIMSON : p.colour) + ';"></div></div>' +
        '</div>';
      }).join("");
    }

    function renderHandEnd() {
      const s = lastScore;
      /*
       * Name the story of the hand rather than announcing that arithmetic
       * happened.
       *
       * All 52 cards have been played by the time this sheet is built, so the
       * queen is always in somebody's pile: any branch sitting after "the
       * queen went to X" is unreachable, and so is "three players escaped
       * clean" — three clean seats means the fourth holds all 26, which is a
       * moon and was caught above. These three are the ones that can actually
       * happen: the moon, the queen arriving with a pile of hearts behind her,
       * and the queen arriving more or less alone.
       */
      const queenTo = [0, 1, 2, 3].find((i) => hasQueen(i));
      let head;
      if (s.shooter >= 0) head = esc(players[s.shooter].name) + " shot the moon";
      else if (queenTo !== undefined && s.pts[queenTo] >= 20)
        head = "The Queen sank " + esc(players[queenTo].name);
      else if (queenTo !== undefined) head = "The Queen went to " + esc(players[queenTo].name);
      else head = "Hand " + handNo + " scored";
      el("he-body").innerHTML =
        '<div style="' + LABEL + '">Hand ' + handNo + ' · ' +
          (passDir === "hold" ? "no pass" : "passed " + passDir) + '</div>' +
        '<div style="font-family:' + SERIF + ';font-size:26px;font-weight:800;margin:4px 0 12px;' +
          'line-height:1.16;">' + head + '</div>' +
        (s.shooter >= 0
          ? '<div style="font-size:13px;line-height:1.6;padding:11px 13px;border-radius:12px;' +
            'background:rgba(194,38,59,0.18);border:1px solid rgba(240,87,107,0.45);margin-bottom:10px;">' +
            'Every heart and the queen. ' + esc(players[s.shooter].name) +
            ' scores nothing and everybody else takes <b>26</b>.</div>'
          : '') +
        scoreRows(s.pts) +
        '<div style="font-size:11.5px;opacity:0.45;margin-top:10px;">First to ' + settings.target +
          ' ends it. Lowest score wins.</div>';
      el("he-next").textContent = result ? "See the result" : "Next hand";
      el("hand-end").style.display = "flex";
    }

    function renderOver() {
      const ranked = players.map((p, i) => ({ p, i })).sort((a, b) => a.p.total - b.p.total);
      const names = result.winners.map((i) => esc(players[i].name)).join(" and ");
      const winColour = players[result.winners[0]].colour;
      el("ov-body").innerHTML =
        '<div style="height:3px;border-radius:2px;margin:-6px 0 16px;background:linear-gradient(90deg,' +
          'rgba(201,162,39,0),' + winColour + ',rgba(201,162,39,0));"></div>' +
        '<div style="' + LABEL + 'text-align:center;">' +
          (result.winners.length > 1 ? "Tied lowest" : "Lowest score") + '</div>' +
        '<div style="font-family:' + SERIF + ';font-size:38px;font-weight:900;text-align:center;' +
          'line-height:1.12;margin:4px 0 2px;color:' + winColour + ';">' + names + '</div>' +
        '<div style="text-align:center;font-size:14px;opacity:0.6;margin-bottom:14px;">' +
          result.low + ' points after ' + handNo + (handNo === 1 ? ' hand' : ' hands') + '</div>' +
        ranked.map((r, n) => {
          const won = result.winners.indexOf(r.i) >= 0;
          return '<div style="display:flex;justify-content:space-between;align-items:baseline;' +
            'padding:8px 10px;margin:0 -10px;border-top:1px solid rgba(201,162,39,0.16);' +
            'font-size:15.5px;' + (won ? 'background:rgba(201,162,39,0.10);' : '') + '">' +
            '<span><span style="opacity:0.35;">' + (n + 1) + '.</span> ' +
              '<span style="color:' + r.p.colour + ';font-weight:800;">' + esc(r.p.name) + '</span>' +
              (won ? '<span style="' + LABEL + 'margin-left:8px;">wins</span>' : '') + '</span>' +
            '<span style="font-family:' + SERIF + ';font-weight:800;' +
              (r.p.total >= settings.target ? 'color:' + CRIMSON_HI + ';' : '') + '">' +
              r.p.total + '</span>' +
          '</div>';
        }).join("") +
        '<div style="' + LABEL + 'text-align:center;margin-top:14px;">Played to ' +
          settings.target + '</div>';
      el("over").style.display = "flex";
    }

    /* ---------------------------------------------------------------
     * Frame
     * ------------------------------------------------------------- */
    ctx.onFrame((dtMs) => {
      // dt is only ever used for decay. Every deadline in this bit is an
      // absolute performance.now() stamp, because a clock accumulated from
      // clamped frame deltas runs slow the moment the device stutters.
      const dt = Math.min(dtMs, 50) / 1000;
      if (shake > 0.0005) shake *= Math.pow(0.004, dt);
      const t = now();
      if (anim && t >= anim.until) finishAnim();
      if (phase === "trickEnd" && !anim && t >= trickUntil) startGather();
      if (hideAt && t - hideAt > 260 && phase !== "turn" && phase !== "passing") hideAt = 0;
      paint();
    });

    ctx.listen(window, "resize", () => {
      if (ctx.width === W && ctx.height === H) return;
      measure();
      rebuildArt();
      // The pass button is positioned off the layout, so it has to follow it.
      el("passbtn").style.top = Math.round(L.promptY + 8) + "px";
    });

    /* ---------------------------------------------------------------
     * A read-only window for the local harness, so a scripted game can
     * drive real taps and assert on real rules.
     * ------------------------------------------------------------- */
    window.__HEARTS__ = {
      get phase() { return phase; },
      get busy() { return busy(); },
      get view() { return view; },
      get turn() { return st ? st.turn : -1; },
      get handNo() { return handNo; },
      get trickNo() { return st ? st.trickNo : -1; },
      get passDir() { return passDir; },
      get passSeat() { return passSeat; },
      get heartsBroken() { return !!(st && st.heartsBroken); },
      get totals() { return players.map((p) => p.total); },
      get names() { return players.map((p) => p.name); },
      get handPts() { return [0, 1, 2, 3].map(handPts); },
      get trick() { return st ? st.trick.map((p) => ({ seat: p.seat, id: p.card.id })) : []; },
      get lastTrick() {
        return st && st.lastTrick
          ? { winner: st.lastTrick.winner, points: st.lastTrick.points,
              ids: st.lastTrick.cards.map((c) => c.card.id) } : null;
      },
      get result() { return result; },
      get target() { return settings.target; },
      get selected() { return selected.slice(); },
      hand(seat) { return st && st.hands[seat] ? st.hands[seat].map((c) => c.id) : []; },
      legal(seat) {
        return st && seat >= 0 && st.hands[seat] ? legalMoves(st, seat).map((c) => c.id) : [];
      },
      /**
       * A point that is guaranteed to land on hand card `i`.
       *
       * Every card but the rightmost is overlapped by its neighbour, and the
       * neighbour is drawn on top — so the CENTRE of card 3 is really card 4.
       * The exposed sliver is the left edge, which is also where a real thumb
       * goes.
       */
      tapXY(i) {
        const seat = phase === "passing" ? passSeat : view;
        const hand = st.hands[seat];
        const picking = phase === "passing";
        const legal = picking ? null : legalMoves(st, seat).map((c) => c.id);
        const chosen = picking && selected.indexOf(hand[i].id) >= 0;
        const ok = picking ? true : legal.indexOf(hand[i].id) >= 0;
        const lift = chosen ? LIFT_PICK : (!picking && ok && settings.hints ? LIFT_LEGAL : 0);
        const s = handSlot(i, hand.length, now(), lift);
        // Nine pixels inside the card's own left edge, in the CARD's frame —
        // the fan is rotated, so an offset measured in screen x walks back
        // under the neighbour as the tilt grows.
        const lx = -L.cw / 2 + 9;
        return { x: s.x + lx * Math.cos(s.rot), y: s.y + lx * Math.sin(s.rot) };
      },
    };
    ctx.onDestroy(() => { try { delete window.__HEARTS__; } catch (_) {} });

    paint();
    ctx.markVisualReady("table set");
    ctx.platform.ready();
  },
};
